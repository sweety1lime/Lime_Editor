using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Linq;
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

        // Одностраничный документ движка B.
        private const string SinglePageDoc =
            "{\"version\":1,\"blocks\":[{\"id\":\"x\",\"type\":\"heading\",\"content\":{\"text\":\"Hello\"}}]}";

        [Fact]
        public async Task PublishedSite_ReturnsHtml_WhenPublished()
        {
            var user = await CreateUserAsync("alice");
            await SeedSiteAsync(user.Id, "my-page", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: SinglePageDoc);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/alice/my-page");
            response.EnsureSuccessStatusCode();
            Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("Hello", body);
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

        // Фуллстак (B3): блок collectionList на опубликованной странице рендерит реальные
        // записи из БД (per-request), которые сервер подаёт через BuildCollectionDataAsync → RenderPage.
        private const string CollectionDoc =
            "{\"version\":1,\"pages\":[{\"slug\":\"\",\"title\":\"Home\",\"blocks\":[" +
            "{\"id\":\"cl\",\"type\":\"collectionList\",\"content\":{\"collection\":\"goods\"}}]}]}";

        private async Task SeedCollectionAsync(int siteId, string slug, string schemaJson, params string[] recordJsons)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            var col = new Collection { SiteId = siteId, Name = slug, Slug = slug, SchemaJson = schemaJson, CreatedAt = System.DateTime.UtcNow };
            db.Collections.Add(col);
            await db.SaveChangesAsync();
            foreach (var rj in recordJsons)
            {
                db.CollectionRecords.Add(new CollectionRecord { CollectionId = col.Id, DataJson = rj, CreatedAt = System.DateTime.UtcNow });
            }
            await db.SaveChangesAsync();
        }

        [Fact]
        public async Task CollectionList_RendersRecordsFromDb_OnPublishedPage()
        {
            var user = await CreateUserAsync("iris");
            await SeedSiteAsync(user.Id, "shop", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: CollectionDoc);
            // siteId сидированного сайта
            int siteId;
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
                siteId = await db.Sites.Where(s => s.UserId == user.Id && s.Slug == "shop").Select(s => s.IdSite ?? 0).FirstAsync();
            }
            await SeedCollectionAsync(siteId, "goods",
                "[{\"name\":\"title\",\"type\":\"text\",\"label\":\"Название\"}]",
                "{\"title\":\"Виджет Про\"}", "{\"title\":\"Штука\"}");

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/iris/shop");
            response.EnsureSuccessStatusCode();
            var html = await response.Content.ReadAsStringAsync();
            Assert.Contains("lime-block__collection", html);
            Assert.Contains("Виджет Про", html); // реальные данные из БД
            Assert.Contains("Штука", html);
            Assert.Contains("Название", html);    // метка поля из схемы
        }

        [Fact]
        public async Task CollectionList_EmptyCollection_RendersNoCards_OnPublishedPage()
        {
            var user = await CreateUserAsync("jane");
            await SeedSiteAsync(user.Id, "shop2", isPublished: true, body: "<html><body>legacy</body></html>", publishedDocJson: CollectionDoc);
            // коллекции нет вовсе → блок пуст, страница отдаётся (200), без карточек
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/jane/shop2");
            response.EnsureSuccessStatusCode();
            var html = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("lime-cl-card", html);
        }
    }
}
