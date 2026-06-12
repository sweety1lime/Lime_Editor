using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    public class PublishedSiteTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public PublishedSiteTests(WebFactory factory) => _factory = factory;

        private async Task<ApplicationUser> CreateUserAsync(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var existing = await userManager.FindByNameAsync(userName);
            if (existing != null) return existing;
            var user = new ApplicationUser { UserName = userName, Email = userName + "@test.local" };
            var result = await userManager.CreateAsync(user, "TestPass1!");
            Assert.True(result.Succeeded);
            return user;
        }

        private async Task SeedSiteAsync(int userId, string slug, bool isPublished, string body, string publishedDocJson = null)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site
            {
                Name = "Test",
                Folder = body,
                UserId = userId,
                TemplateId = 1,
                Slug = slug,
                IsPublished = isPublished,
                PublishedDocumentJson = publishedDocJson,
            });
            await db.SaveChangesAsync();
        }

        // Многостраничный документ движка B для роутов /u/{user}/{slug}/{page} (этап 0.3).
        private const string MultiPageDoc = @"{
            ""version"": 1,
            ""pages"": [
                { ""slug"": """", ""title"": ""Главная"", ""blocks"": [ { ""id"": ""h1"", ""type"": ""heading"", ""content"": { ""text"": ""HomeBlock"" } } ] },
                { ""slug"": ""about"", ""title"": ""О нас"", ""blocks"": [ { ""id"": ""a1"", ""type"": ""text"", ""content"": { ""text"": ""AboutBlock"" } } ] }
            ]
        }";

        [Fact]
        public async Task PublishedSite_ReturnsHtml_WhenPublished()
        {
            var user = await CreateUserAsync("alice");
            await SeedSiteAsync(user.Id, "my-page", isPublished: true, body: "<html><body><h1>Hello</h1></body></html>");

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/alice/my-page");
            response.EnsureSuccessStatusCode();
            Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("<h1>Hello</h1>", body);
        }

        [Fact]
        public async Task PublishedSite_StripsEditorControls()
        {
            var user = await CreateUserAsync("dave");
            var folder = @"<html><body>
                <a id=""del"" onclick=""savPage()"">Сохранить</a>
                <a id=""del1"" onclick=""downloadSite()"">Скачать</a>
                <h1>Public content</h1>
                <script src=""/js/saveTemplate.js""></script>
            </body></html>";
            await SeedSiteAsync(user.Id, "clean", isPublished: true, body: folder);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/dave/clean");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("<h1>Public content</h1>", body);
            Assert.DoesNotContain("savPage", body);
            Assert.DoesNotContain("downloadSite", body);
            Assert.DoesNotContain("saveTemplate.js", body);
        }

        [Fact]
        public async Task PublishedSite_Returns404_WhenNotPublished()
        {
            var user = await CreateUserAsync("bob");
            await SeedSiteAsync(user.Id, "draft", isPublished: false, body: "<h1>Draft</h1>");

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/bob/draft");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task PublishedSite_Returns404_WhenUserDoesNotExist()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/no-such-user/some-slug");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task DocSite_HomePage_RendersOnlyItsBlocks_WithRealNavLinks()
        {
            var user = await CreateUserAsync("erin");
            await SeedSiteAsync(user.Id, "multi", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: MultiPageDoc);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/erin/multi");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("HomeBlock", body);
            Assert.DoesNotContain("AboutBlock", body); // не вся «простыня», а одна страница
            Assert.Contains("href=\"/u/erin/multi/about\"", body); // реальные URL, не hash
            Assert.DoesNotContain("data-lime-pages", body);
        }

        [Fact]
        public async Task DocSite_InnerPage_HasOwnContent_AndPerPageTitle()
        {
            var user = await CreateUserAsync("frank");
            await SeedSiteAsync(user.Id, "multi2", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: MultiPageDoc);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/frank/multi2/about");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("AboutBlock", body);
            Assert.DoesNotContain("HomeBlock", body);
            Assert.Contains("<title>О нас — Test</title>", body); // per-page title
        }

        [Fact]
        public async Task DocSite_UnknownPage_Returns404()
        {
            var user = await CreateUserAsync("grace");
            await SeedSiteAsync(user.Id, "multi3", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: MultiPageDoc);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/grace/multi3/no-such-page");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task LegacySite_InnerPagePath_Returns404()
        {
            var user = await CreateUserAsync("henry");
            await SeedSiteAsync(user.Id, "legacy-one", isPublished: true, body: "<html><body><h1>Legacy</h1></body></html>");

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/henry/legacy-one/about");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task PublishedSite_Returns404_WhenSlugDoesNotExist()
        {
            var user = await CreateUserAsync("charlie");
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/charlie/no-such-slug");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }
}
