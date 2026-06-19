using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Этап 3: публичная галерея сообщества.
    public class CommunityTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public CommunityTests(WebFactory factory) => _factory = factory;

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

        private async Task SeedSiteAsync(int userId, string name, string slug, bool published, bool inGallery, string publishedDocJson = null)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site
            {
                Name = name,
                Folder = "<html><body>x</body></html>",
                UserId = userId,
                TemplateId = 4,
                Slug = slug,
                IsPublished = published,
                ShowInGallery = inGallery,
                PublishedDocumentJson = publishedDocJson,
            });
            await db.SaveChangesAsync();
        }

        [Fact]
        public async Task Gallery_ShowsOnlyPublishedOptedInSites()
        {
            // Имена латиницей: дефолтный HtmlEncoder Razor кодирует кириллицу
            // в числовые сущности, и Assert.Contains по сырому HTML её не находит.
            var user = await CreateUserAsync("galya");
            await SeedSiteAsync(user.Id, "VisibleInGallery", "in-gallery", published: true, inGallery: true);
            await SeedSiteAsync(user.Id, "HiddenFromGallery", "hidden-site", published: true, inGallery: false);
            await SeedSiteAsync(user.Id, "DraftSite", "draft-site", published: false, inGallery: true);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/Community/Index");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();

            Assert.Contains("VisibleInGallery", body);
            Assert.DoesNotContain("HiddenFromGallery", body);
            Assert.DoesNotContain("DraftSite", body);
            Assert.Contains("/u/galya/in-gallery", body); // ссылка на публичную страницу
        }

        [Fact]
        public async Task Gallery_IsPublic_ForAnonymous()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/Community/Index?sort=popular");
            response.EnsureSuccessStatusCode();
        }

        [Theory]
        [InlineData("/Community/Like")]
        [InlineData("/Community/Clone")]
        [InlineData("/Community/ToggleGallery")]
        public async Task Mutations_RequireAuth(string url)
        {
            var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
            });
            var response = await client.PostAsync(url, new FormUrlEncodedContent(Array.Empty<System.Collections.Generic.KeyValuePair<string, string>>()));
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? "");
        }

        [Fact]
        public async Task PublishedSiteView_IncrementsViewsCounter()
        {
            var user = await CreateUserAsync("vera");
            await SeedSiteAsync(user.Id, "Счётчик", "counter", published: true, inGallery: true,
                publishedDocJson: "{\"version\":1,\"blocks\":[{\"id\":\"x\",\"type\":\"heading\",\"content\":{\"text\":\"Hi\"}}]}");

            var client = _factory.CreateClient();
            (await client.GetAsync("/u/vera/counter")).EnsureSuccessStatusCode();
            (await client.GetAsync("/u/vera/counter")).EnsureSuccessStatusCode();

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            var site = await db.Sites.AsNoTracking().FirstAsync(s => s.UserId == user.Id && s.Slug == "counter");
            Assert.Equal(2, site.ViewsCount);
        }
    }
}
