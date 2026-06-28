using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Account-фичи (GDPR-минимум): экспорт данных и удаление аккаунта.
    // Удаление через [Authorize] требует входа; здесь проверяем гейт авторизации и
    // изоляцию экспорта по владельцу (на уровне того же запроса, что в HomeController.ExportMyData).
    public class AccountDataTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public AccountDataTests(WebFactory factory) => _factory = factory;

        [Theory]
        [InlineData("/Home/ExportMyData")]
        public async Task AccountEndpoints_RedirectToSignIn_WhenAnonymous(string url)
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });

            var response = await client.GetAsync(url);

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? string.Empty);
        }

        [Fact]
        public async Task ExportQuery_SelectsOnlyOwnSites()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site { IdSite = 2001, UserId = 7, Name = "Mine", Folder = "x", TemplateId = 1 });
            db.Sites.Add(new Site { IdSite = 2002, UserId = 8, Name = "Other", Folder = "x", TemplateId = 1 });
            await db.SaveChangesAsync();

            // Тот же фильтр, что в ExportMyData — экспорт не должен утащить чужой сайт.
            var mine = await db.Sites.AsNoTracking().Where(s => s.UserId == 7).ToListAsync();

            Assert.Single(mine);
            Assert.Equal(2001, mine[0].IdSite);
            Assert.DoesNotContain(mine, s => s.UserId != 7);
        }

        [Fact]
        public async Task ConfirmEmail_WithoutToken_RedirectsToSignIn_NotError()
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });

            // Битая/пустая ссылка подтверждения не должна валить сервер — мягкий редирект на вход.
            var response = await client.GetAsync("/Home/ConfirmEmail");

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? string.Empty);
        }

        [Fact]
        public async Task EmailConfirmationToken_RoundTrips_AndConfirmsUser()
        {
            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { UserName = "confirmme", Email = "confirmme@test.local" };
            Assert.True((await userManager.CreateAsync(user, "TestPass1!")).Succeeded);
            Assert.False(await userManager.IsEmailConfirmedAsync(user));

            var token = await userManager.GenerateEmailConfirmationTokenAsync(user);
            var result = await userManager.ConfirmEmailAsync(user, token);

            Assert.True(result.Succeeded);
            Assert.True(await userManager.IsEmailConfirmedAsync(user));
        }
    }
}
