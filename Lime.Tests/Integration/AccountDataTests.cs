using Lime_Editor.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
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

        private async Task CreateUserAsync(string userName, string password = "TestPass1!")
        {
            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            if (await userManager.FindByNameAsync(userName) != null) return;
            var user = new ApplicationUser { UserName = userName, Email = userName + "@test.local", EmailConfirmed = true };
            Assert.True((await userManager.CreateAsync(user, password)).Succeeded);
        }

        private static string AntiForgeryToken(string html)
        {
            var match = Regex.Match(html, "name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"");
            Assert.True(match.Success, "Antiforgery token not found.");
            return WebUtility.HtmlDecode(match.Groups[1].Value);
        }

        private static bool IsValidModel(object model)
        {
            return Validator.TryValidateObject(
                model,
                new ValidationContext(model),
                new List<ValidationResult>(),
                validateAllProperties: true);
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
        public async Task SignUpPage_UsesServerPasswordMinimumLength()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/Home/SignUp");
            response.EnsureSuccessStatusCode();
            var html = await response.Content.ReadAsStringAsync();

            Assert.Contains("minlength=\"8\"", html);
            Assert.DoesNotContain("minlength=\"6\"", html);
        }

        [Fact]
        public async Task SignUpPage_UsesSharedUserNamePolicy()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/Home/SignUp");
            response.EnsureSuccessStatusCode();
            var html = await response.Content.ReadAsStringAsync();

            Assert.Contains($"pattern=\"{UserNamePolicy.HtmlPattern}\"", html);
            Assert.DoesNotContain("[A-z0-9.]{2,50}", html);
        }

        [Theory]
        [InlineData("alice")]
        [InlineData("alice-1")]
        [InlineData("alice_1.test")]
        public void AccountModels_AcceptAllowedLoginCharacters(string login)
        {
            Assert.True(IsValidModel(new RegisterViewModel
            {
                Login = login,
                Email = login + "@test.local",
                Password = "TestPass1!",
            }));
            Assert.True(IsValidModel(new ProfileViewModel
            {
                Login = login,
                Email = login + "@test.local",
            }));
        }

        [Theory]
        [InlineData("bad/user")]
        [InlineData("bad\\user")]
        [InlineData("bad user")]
        [InlineData("bad@user")]
        [InlineData("a")]
        public void AccountModels_RejectUnsafeLoginCharacters(string login)
        {
            Assert.False(IsValidModel(new RegisterViewModel
            {
                Login = login,
                Email = "safe@test.local",
                Password = "TestPass1!",
            }));
            Assert.False(IsValidModel(new ProfileViewModel
            {
                Login = login,
                Email = "safe@test.local",
            }));
        }

        [Fact]
        public async Task Logout_Get_DoesNotSignOut()
        {
            var client = await CreateSignedInClientAsync("logout-get");

            var logout = await client.GetAsync("/Home/Logout");
            Assert.Equal(HttpStatusCode.Redirect, logout.StatusCode);

            var profile = await client.GetAsync("/Home/Profile");
            Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
        }

        [Fact]
        public async Task Logout_Post_RequiresAntiforgery()
        {
            var client = await CreateSignedInClientAsync("logout-post");

            var response = await client.PostAsync("/Home/Logout", new FormUrlEncodedContent(System.Array.Empty<KeyValuePair<string, string>>()));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [Fact]
        public async Task EditProfile_AllowsNonSensitiveChanges_WithoutCurrentPassword()
        {
            var userName = "profile-basic";
            var client = await CreateSignedInClientAsync(userName);
            var profile = await client.GetAsync("/Home/Profile");
            profile.EnsureSuccessStatusCode();
            var token = AntiForgeryToken(await profile.Content.ReadAsStringAsync());

            var response = await client.PostAsync("/Home/EditProfile", new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("Login", userName),
                new KeyValuePair<string, string>("Email", userName + "@test.local"),
                new KeyValuePair<string, string>("Name", "Safe"),
                new KeyValuePair<string, string>("LastName", "Change"),
                new KeyValuePair<string, string>("Password", ""),
                new KeyValuePair<string, string>("CurrentPassword", ""),
                new KeyValuePair<string, string>("__RequestVerificationToken", token),
            }));

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await userManager.FindByNameAsync(userName);
            Assert.Equal("Safe", user.Name);
            Assert.Equal("Change", user.LastName);
        }

        [Fact]
        public async Task EditProfile_SensitiveChangesRequireCurrentPassword()
        {
            var userName = "profile-sensitive";
            var client = await CreateSignedInClientAsync(userName);
            var profile = await client.GetAsync("/Home/Profile");
            profile.EnsureSuccessStatusCode();
            var token = AntiForgeryToken(await profile.Content.ReadAsStringAsync());

            var response = await client.PostAsync("/Home/EditProfile", new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("Login", userName + "-new"),
                new KeyValuePair<string, string>("Email", userName + "-new@test.local"),
                new KeyValuePair<string, string>("Name", "Attempt"),
                new KeyValuePair<string, string>("LastName", ""),
                new KeyValuePair<string, string>("Password", "NewPass1!"),
                new KeyValuePair<string, string>("CurrentPassword", ""),
                new KeyValuePair<string, string>("__RequestVerificationToken", token),
            }));

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.NotNull(await userManager.FindByNameAsync(userName));
            Assert.Null(await userManager.FindByNameAsync(userName + "-new"));
        }

        [Fact]
        public async Task EditProfile_EmailChange_WithCurrentPassword_ResetsEmailConfirmation()
        {
            var userName = "profile-email-reset";
            var newEmail = userName + "-new@test.local";
            var client = await CreateSignedInClientAsync(userName);
            var profile = await client.GetAsync("/Home/Profile");
            profile.EnsureSuccessStatusCode();
            var token = AntiForgeryToken(await profile.Content.ReadAsStringAsync());

            var response = await client.PostAsync("/Home/EditProfile", new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("Login", userName),
                new KeyValuePair<string, string>("Email", newEmail),
                new KeyValuePair<string, string>("Name", ""),
                new KeyValuePair<string, string>("LastName", ""),
                new KeyValuePair<string, string>("Password", ""),
                new KeyValuePair<string, string>("CurrentPassword", "TestPass1!"),
                new KeyValuePair<string, string>("__RequestVerificationToken", token),
            }));

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await userManager.FindByNameAsync(userName);
            Assert.Equal(newEmail, user.Email);
            Assert.False(await userManager.IsEmailConfirmedAsync(user));
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
