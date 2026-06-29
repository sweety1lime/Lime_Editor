using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Linq;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Бэклог безопасности: строгий CSP на публичной отдаче /u (защита от stored-XSS,
    // пока публикации на одном origin), базовые заголовки — на всех ответах.
    public class SecurityHeadersTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public SecurityHeadersTests(WebFactory factory) => _factory = factory;

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

        private async Task SeedSiteAsync(int userId, string slug, string publishedDocJson)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site
            {
                Name = "Test",
                Folder = "<html><body>legacy</body></html>",
                UserId = userId,
                TemplateId = 1,
                Slug = slug,
                IsPublished = true,
                PublishedDocumentJson = publishedDocJson,
            });
            await db.SaveChangesAsync();
        }

        private const string SinglePageDoc =
            "{\"version\":1,\"blocks\":[{\"id\":\"x\",\"type\":\"heading\",\"content\":{\"text\":\"Hello\"}}]}";

        [Fact]
        public async Task PublishedPage_HasStrictCsp_AndBaselineHeaders()
        {
            var user = await CreateUserAsync("sec-pub");
            await SeedSiteAsync(user.Id, "secpage", SinglePageDoc);

            var client = _factory.CreateClient();
            var response = await client.GetAsync("/u/sec-pub/secpage");
            response.EnsureSuccessStatusCode();

            Assert.True(response.Headers.TryGetValues("Content-Security-Policy", out var csp));
            var policy = csp.First();
            // script-src без 'unsafe-inline' — это и есть защита от инъекции скриптов в контент.
            Assert.Contains("script-src 'self' https://cdn.jsdelivr.net", policy);
            Assert.DoesNotContain("script-src 'self' 'unsafe-inline'", policy);
            // style-src 'unsafe-inline' обязателен (движок эмитит inline-стили) — страница не должна сломаться.
            Assert.Contains("style-src 'self' 'unsafe-inline'", policy);
            Assert.Contains("object-src 'none'", policy);
            Assert.Contains("frame-ancestors 'self'", policy);
            Assert.Contains("report-uri /Security/CspReport", policy);

            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").First());
            Assert.True(response.Headers.Contains("Referrer-Policy"));
            Assert.Equal("camera=(), microphone=(), geolocation=(), payment=()",
                response.Headers.GetValues("Permissions-Policy").First());
            Assert.False(response.Headers.Contains("Content-Security-Policy-Report-Only"));
        }

        [Fact]
        public async Task AppPage_HasBaselineHeaders_AndReportOnlyCsp()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/Home/SignIn");
            response.EnsureSuccessStatusCode();

            // На страницы приложения строгий CSP пока не вешаем (редактор использует inline-скрипты),
            // но базовая защита от clickjacking/MIME-sniffing должна быть.
            Assert.False(response.Headers.Contains("Content-Security-Policy"));
            Assert.True(response.Headers.TryGetValues("Content-Security-Policy-Report-Only", out var reportOnly));
            var policy = reportOnly.First();
            Assert.Contains("default-src 'self'", policy);
            Assert.Contains("form-action 'self'", policy);
            Assert.Contains("object-src 'none'", policy);
            Assert.Contains("report-uri /Security/CspReport", policy);
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").First());
            Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").First());
            Assert.Equal("camera=(), microphone=(), geolocation=(), payment=()",
                response.Headers.GetValues("Permissions-Policy").First());
        }
    }
}
