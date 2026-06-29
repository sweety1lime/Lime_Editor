using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
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
    }
}
