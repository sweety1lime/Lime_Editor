using Lime_Editor.Models;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    public class FormControllerTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public FormControllerTests(WebFactory factory) => _factory = factory;

        private async Task<int> SeedPublishedSiteAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            var siteId = 300000 + Math.Abs(Guid.NewGuid().GetHashCode() % 100000);
            db.Sites.Add(new Site
            {
                IdSite = siteId,
                Name = "Form Site",
                Folder = "<html></html>",
                UserId = 1,
                TemplateId = 1,
                Slug = "form-site",
                IsPublished = true,
                PublishedDocumentJson = "{\"version\":1,\"blocks\":[]}",
            });
            await db.SaveChangesAsync();
            return siteId;
        }

        private static FormUrlEncodedContent ValidForm(int siteId) =>
            new(new[]
            {
                new KeyValuePair<string, string>("__siteId", siteId.ToString()),
                new KeyValuePair<string, string>("lime_ts", DateTimeOffset.UtcNow.AddSeconds(-2).ToUnixTimeSeconds().ToString()),
                new KeyValuePair<string, string>("name", "Alice"),
            });

        [Fact]
        public async Task Submit_DoesNotRedirectToExternalReferer()
        {
            var siteId = await SeedPublishedSiteAsync();
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var req = new HttpRequestMessage(HttpMethod.Post, "/Form/Submit") { Content = ValidForm(siteId) };
            req.Headers.Referrer = new Uri("https://evil.test/phish");

            var response = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.False(response.Headers.Contains("Location"));
        }

        [Fact]
        public async Task Submit_AllowsLocalReferer()
        {
            var siteId = await SeedPublishedSiteAsync();
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var req = new HttpRequestMessage(HttpMethod.Post, "/Form/Submit") { Content = ValidForm(siteId) };
            req.Headers.TryAddWithoutValidation("Referer", "/u/test/form-site");

            var response = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Equal("/u/test/form-site?lime_sent=1#lime-form", response.Headers.Location?.ToString());
        }

        [Fact]
        public async Task Submit_IsRateLimitedByClientIp()
        {
            var siteId = await SeedPublishedSiteAsync();
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            var ip = "203.0.113." + Math.Abs(Guid.NewGuid().GetHashCode() % 200 + 1);

            for (var i = 0; i < 20; i++)
            {
                using var allowed = new HttpRequestMessage(HttpMethod.Post, "/Form/Submit") { Content = ValidForm(siteId) };
                allowed.Headers.TryAddWithoutValidation("X-Forwarded-For", ip);
                var allowedResponse = await client.SendAsync(allowed);
                Assert.Equal(HttpStatusCode.OK, allowedResponse.StatusCode);
            }

            using var rejected = new HttpRequestMessage(HttpMethod.Post, "/Form/Submit") { Content = ValidForm(siteId) };
            rejected.Headers.TryAddWithoutValidation("X-Forwarded-For", ip);
            var rejectedResponse = await client.SendAsync(rejected);

            Assert.Equal((HttpStatusCode)429, rejectedResponse.StatusCode);
        }
    }
}
