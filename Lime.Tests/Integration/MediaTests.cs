using Lime_Editor.Models;
using Lime_Editor.Controllers;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using System.Threading;
using Xunit;

namespace Lime.Tests.Integration
{
    public class MediaTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public MediaTests(WebFactory factory) => _factory = factory;

        private async Task<ApplicationUser> CreateUserAsync(string userName, string password = "TestPass1!")
        {
            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var existing = await userManager.FindByNameAsync(userName);
            if (existing != null) return existing;
            var user = new ApplicationUser { UserName = userName, Email = userName + "@test.local", EmailConfirmed = true };
            Assert.True((await userManager.CreateAsync(user, password)).Succeeded);
            return user;
        }

        private static string AntiForgeryToken(string html)
        {
            var match = Regex.Match(html, "name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"");
            Assert.True(match.Success, "Antiforgery token not found.");
            return WebUtility.HtmlDecode(match.Groups[1].Value);
        }

        private async Task<HttpClient> CreateSignedInClientAsync(string userName)
        {
            await CreateUserAsync(userName);
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            var signIn = await client.GetAsync("/Home/SignIn");
            signIn.EnsureSuccessStatusCode();
            var token = AntiForgeryToken(await signIn.Content.ReadAsStringAsync());
            var response = await client.PostAsync("/Home/SignIn", new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("Login", userName),
                new KeyValuePair<string, string>("Password", "TestPass1!"),
                new KeyValuePair<string, string>("__RequestVerificationToken", token),
            }));
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            return client;
        }

        private sealed class CapturingHandler : HttpMessageHandler
        {
            public Uri RequestUri { get; private set; }

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                RequestUri = request.RequestUri;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"photos\":[]}")
                });
            }
        }

        private sealed class CapturingHttpClientFactory : IHttpClientFactory
        {
            public CapturingHandler Handler { get; } = new CapturingHandler();

            public HttpClient CreateClient(string name) => new HttpClient(Handler);
        }

        [Theory]
        [InlineData("/Media/Index")]
        public async Task Media_RedirectsToSignIn_WhenAnonymous(string url)
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
            });
            var response = await client.GetAsync(url);
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? string.Empty);
        }

        [Fact]
        public async Task Upload_RejectsFileWithMismatchedSignature()
        {
            var userName = "media-signature";
            var user = await CreateUserAsync(userName);
            var client = await CreateSignedInClientAsync(userName);
            var index = await client.GetAsync("/Media/Index");
            index.EnsureSuccessStatusCode();
            var token = AntiForgeryToken(await index.Content.ReadAsStringAsync());

            using var content = new MultipartFormDataContent();
            content.Add(new StringContent(token), "__RequestVerificationToken");
            var fakeImage = new ByteArrayContent(new byte[] { (byte)'%', (byte)'P', (byte)'D', (byte)'F', 0x2D });
            fakeImage.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            content.Add(fakeImage, "file", "invoice.jpg");

            var response = await client.PostAsync("/Media/Upload", content);

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            Assert.False(await db.MediaAssets.AnyAsync(m => m.UserId == user.Id));
        }

        [Fact]
        public async Task Stock_ClampsPageAndQueryBeforeProviderRequest()
        {
            var previousKey = Environment.GetEnvironmentVariable("STOCK_PEXELS_KEY");
            try
            {
                Environment.SetEnvironmentVariable("STOCK_PEXELS_KEY", "test-key");
                var httpFactory = new CapturingHttpClientFactory();
                var controller = new MediaController(null, null, null, null, httpFactory, null);

                await controller.Stock("  " + new string('x', 200) + "  ", page: 999);

                var uri = httpFactory.Handler.RequestUri;
                Assert.NotNull(uri);
                Assert.Contains("page=10", uri.Query);
                Assert.Contains("query=" + new string('x', 120), uri.Query);
                Assert.DoesNotContain(new string('x', 121), uri.Query);
            }
            finally
            {
                Environment.SetEnvironmentVariable("STOCK_PEXELS_KEY", previousKey);
            }
        }
    }
}
