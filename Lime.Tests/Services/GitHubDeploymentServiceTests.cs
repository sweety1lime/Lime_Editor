using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Lime.Tests.Services
{
    // GitHub-деплой (Wave 1 п.4): OAuth-state подписан DataProtection, токен хранится
    // зашифрованным, деплой гейтится владением сайтом и тарифом. Сеть заменена скриптованным
    // HttpMessageHandler — guard-тесты дополнительно проверяют, что до сети дело не доходит.
    public class GitHubDeploymentServiceTests
    {
        private const string SampleDoc = /*lang=json*/ @"{
            ""version"": 1,
            ""theme"": { ""classes"": [] },
            ""components"": {},
            ""pages"": [{ ""id"": ""p0"", ""slug"": """", ""title"": ""Главная"", ""blocks"": [
                { ""id"": ""b1"", ""type"": ""heading"", ""content"": { ""text"": ""Заголовок"" } }
            ] }]
        }";

        // ===== Обвязка =====

        private static LimeEditorContext NewContext()
        {
            var options = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("github_" + Guid.NewGuid().ToString("N"))
                .Options;
            return new LimeEditorContext(options);
        }

        private static string WwwRoot()
        {
            var dir = AppContext.BaseDirectory;
            var root = Path.GetFullPath(Path.Combine(dir, "..", "..", "..", ".."));
            var path = Path.Combine(root, "Lime_Editor", "wwwroot");
            Assert.True(Directory.Exists(path), $"wwwroot не найден: {path}");
            return path;
        }

        private static IConfiguration NewConfig(bool oauthConfigured)
        {
            var values = new Dictionary<string, string>();
            if (oauthConfigured)
            {
                values["GitHub:OAuthApp:ClientId"] = "test-client-id";
                values["GitHub:OAuthApp:ClientSecret"] = "test-client-secret";
            }

            return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        }

        private static GitHubDeploymentService NewService(
            LimeEditorContext db,
            HttpMessageHandler handler,
            IDataProtectionProvider dataProtection,
            bool oauthConfigured = true,
            Plan plan = null)
        {
            var env = new FakeWebHostEnvironment(WwwRoot());
            var next = new NextExportService(env, new JsDocumentRenderer(
                Path.Combine(WwwRoot(), "js", "lime", "lime-doc.js")));
            return new GitHubDeploymentService(
                db,
                next,
                new FakeEntitlements(plan ?? new Plan { Code = "pro", Name = "Pro", AllowExport = true }),
                new GitHubApiClient(new FakeHttpClientFactory(handler)),
                NewConfig(oauthConfigured),
                dataProtection);
        }

        private static GitHubConnection SeedConnection(
            LimeEditorContext db, IDataProtectionProvider dp, int userId, string rawToken = "gho_test", bool revoked = false)
        {
            var connection = new GitHubConnection
            {
                UserId = userId,
                Kind = GitHubDeploymentService.OAuthConnectionKind,
                GitHubUserId = 777,
                Login = "octo",
                // Тот же protector-путь, что в сервисе — иначе Unprotect не совпадёт.
                AccessTokenProtected = dp.CreateProtector("lime.github.oauth.token.v1").Protect(rawToken),
                Scope = "public_repo",
                TokenType = "bearer",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Revoked = revoked,
            };
            db.GitHubConnections.Add(connection);
            db.SaveChanges();
            return connection;
        }

        private static Site SeedSite(LimeEditorContext db, int userId, int siteId = 5, string slug = "portfolio")
        {
            var site = new Site
            {
                IdSite = siteId,
                UserId = userId,
                Name = "Портфолио",
                Folder = "folder",
                Slug = slug,
                DocumentJson = SampleDoc,
            };
            db.Sites.Add(site);
            db.SaveChanges();
            return site;
        }

        private static async Task<GitHubDeploymentException> AssertDeployThrows(
            GitHubDeploymentService svc, string expectedCode, int userId = 1, int siteId = 5)
        {
            var ex = await Assert.ThrowsAsync<GitHubDeploymentException>(
                () => svc.DeployQuickOAuthAsync(userId, siteId, "blob"));
            Assert.Equal(expectedCode, ex.Code);
            return ex;
        }

        // ===== Конфигурация OAuth =====

        [Fact]
        public void IsOAuthConfigured_FalseWithoutClientIdAndSecret()
        {
            using var db = NewContext();
            var svc = NewService(db, new RouterHandler(), new EphemeralDataProtectionProvider(), oauthConfigured: false);
            Assert.False(svc.IsOAuthConfigured);
        }

        [Fact]
        public void IsOAuthConfigured_TrueWhenBothSet()
        {
            using var db = NewContext();
            var svc = NewService(db, new RouterHandler(), new EphemeralDataProtectionProvider());
            Assert.True(svc.IsOAuthConfigured);
        }

        [Fact]
        public void CreateAuthorizationUrl_Throws_WhenNotConfigured()
        {
            using var db = NewContext();
            var svc = NewService(db, new RouterHandler(), new EphemeralDataProtectionProvider(), oauthConfigured: false);
            var ex = Assert.Throws<GitHubDeploymentException>(
                () => svc.CreateQuickDeployAuthorizationUrl(1, 5, "blob", "https://app/cb"));
            Assert.Equal("github_oauth_not_configured", ex.Code);
        }

        [Fact]
        public void CreateAuthorizationUrl_BuildsPkceQuery()
        {
            using var db = NewContext();
            var svc = NewService(db, new RouterHandler(), new EphemeralDataProtectionProvider());

            var uri = svc.CreateQuickDeployAuthorizationUrl(1, 5, "blob", "https://app/cb");
            var query = QueryHelpers.ParseQuery(uri.Query);

            Assert.StartsWith("https://github.com/login/oauth/authorize", uri.ToString());
            Assert.Equal("test-client-id", query["client_id"]);
            Assert.Equal("https://app/cb", query["redirect_uri"]);
            Assert.Equal("public_repo", query["scope"]); // дефолт, когда Scope не задан
            Assert.Equal("S256", query["code_challenge_method"]);
            Assert.False(string.IsNullOrWhiteSpace(query["code_challenge"]));
            Assert.False(string.IsNullOrWhiteSpace(query["state"]));
            // state непрозрачен для клиента: это DataProtection-пейлоад, а не голый JSON
            Assert.DoesNotContain("userId", (string)query["state"], StringComparison.OrdinalIgnoreCase);
        }

        // ===== OAuth state =====

        [Fact]
        public async Task CompleteOAuth_GarbageState_ThrowsBadState_WithoutHttp()
        {
            using var db = NewContext();
            var handler = new RouterHandler(); // без маршрутов: любой HTTP-вызов упадёт
            var svc = NewService(db, handler, new EphemeralDataProtectionProvider());

            var ex = await Assert.ThrowsAsync<GitHubDeploymentException>(
                () => svc.CompleteQuickOAuthAndDeployAsync(1, "code", "мусор-а-не-state", "https://app/cb"));
            Assert.Equal("bad_state", ex.Code);
            Assert.Empty(handler.Requests);
        }

        [Fact]
        public async Task CompleteOAuth_StateMintedForAnotherUser_ThrowsBadState_WithoutHttp()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            var dp = new EphemeralDataProtectionProvider();
            var svc = NewService(db, handler, dp);

            var uri = svc.CreateQuickDeployAuthorizationUrl(1, 5, "blob", "https://app/cb");
            var state = (string)QueryHelpers.ParseQuery(uri.Query)["state"];

            // Валидный state пользователя 1 нельзя доиграть от имени пользователя 2.
            var ex = await Assert.ThrowsAsync<GitHubDeploymentException>(
                () => svc.CompleteQuickOAuthAndDeployAsync(2, "code", state, "https://app/cb"));
            Assert.Equal("bad_state", ex.Code);
            Assert.Empty(handler.Requests);
        }

        // ===== Подключение =====

        [Fact]
        public async Task HasOAuthConnection_FiltersRevokedAndForeign()
        {
            using var db = NewContext();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1);
            SeedConnection(db, dp, userId: 2, revoked: true);
            var svc = NewService(db, new RouterHandler(), dp);

            Assert.True(await svc.HasOAuthConnectionAsync(1));
            Assert.False(await svc.HasOAuthConnectionAsync(2)); // отозвано
            Assert.False(await svc.HasOAuthConnectionAsync(3)); // чужой userId
        }

        // ===== Guards деплоя (все — до единого HTTP-вызова) =====

        [Fact]
        public async Task Deploy_WithoutConnection_ThrowsNotConnected()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            SeedSite(db, userId: 1);
            var svc = NewService(db, handler, new EphemeralDataProtectionProvider());

            await AssertDeployThrows(svc, "github_not_connected");
            Assert.Empty(handler.Requests);
        }

        [Fact]
        public async Task Deploy_RevokedConnection_ThrowsNotConnected()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1, revoked: true);
            SeedSite(db, userId: 1);
            var svc = NewService(db, handler, dp);

            await AssertDeployThrows(svc, "github_not_connected");
            Assert.Empty(handler.Requests);
        }

        [Fact]
        public async Task Deploy_ForeignSite_ThrowsSiteNotFound()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1);
            SeedSite(db, userId: 99); // сайт другого владельца — tenant-изоляция
            var svc = NewService(db, handler, dp);

            await AssertDeployThrows(svc, "site_not_found");
            Assert.Empty(handler.Requests);
        }

        [Fact]
        public async Task Deploy_FreePlan_ThrowsExportNotAllowed()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1);
            SeedSite(db, userId: 1);
            var svc = NewService(db, handler, dp,
                plan: new Plan { Code = "free", Name = "Free", AllowExport = false });

            await AssertDeployThrows(svc, "export_not_allowed");
            Assert.Empty(handler.Requests);
        }

        [Fact]
        public async Task Deploy_CorruptStoredToken_ThrowsTokenUnreadable()
        {
            using var db = NewContext();
            var handler = new RouterHandler();
            var dp = new EphemeralDataProtectionProvider();
            var connection = SeedConnection(db, dp, userId: 1);
            connection.AccessTokenProtected = "не-расшифруется";
            db.SaveChanges();
            SeedSite(db, userId: 1);
            var svc = NewService(db, handler, dp);

            await AssertDeployThrows(svc, "github_token_unreadable");
            Assert.Empty(handler.Requests);
        }

        // ===== Полный деплой против скриптованного GitHub API =====

        [Fact]
        public async Task Deploy_FirstTime_CreatesRepoPushesCommitAndPersistsDeployment()
        {
            using var db = NewContext();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1);
            SeedSite(db, userId: 1, slug: "portfolio");

            var handler = new RouterHandler();
            // Имя свободно → создаём репозиторий (slug + обязательный префикс lime-).
            handler.Map(HttpMethod.Get, "/repos/octo/lime-portfolio", HttpStatusCode.NotFound, "{\"message\":\"Not Found\"}");
            handler.Map(HttpMethod.Post, "/user/repos", HttpStatusCode.Created, @"{
                ""id"": 123, ""name"": ""lime-portfolio"", ""full_name"": ""octo/lime-portfolio"",
                ""html_url"": ""https://github.com/octo/lime-portfolio"",
                ""default_branch"": ""main"", ""owner"": { ""login"": ""octo"" } }");
            handler.Map(HttpMethod.Get, "/repos/octo/lime-portfolio/git/ref/heads/main", HttpStatusCode.NotFound, "{\"message\":\"Not Found\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/blobs", HttpStatusCode.Created, "{\"sha\":\"blob-sha\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/trees", HttpStatusCode.Created, "{\"sha\":\"tree-sha\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/commits", HttpStatusCode.Created, "{\"sha\":\"commit-sha\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/refs", HttpStatusCode.Created, "{}");

            var svc = NewService(db, handler, dp);
            var result = await svc.DeployQuickOAuthAsync(1, 5, "blob");

            Assert.True(result.CreatedRepository);
            Assert.Equal("octo", result.Owner);
            Assert.Equal("lime-portfolio", result.Repo);
            Assert.Equal("main", result.Branch);
            Assert.Equal("commit-sha", result.CommitSha);
            Assert.Contains(Uri.EscapeDataString("https://github.com/octo/lime-portfolio"), result.VercelImportUrl);

            // Имя репозитория в create-запросе прошло санитизацию RepoNameFor.
            var create = handler.Requests.Single(r => r.Method == HttpMethod.Post && r.Path == "/user/repos");
            Assert.Equal("lime-portfolio", JObject.Parse(create.Body).Value<string>("name"));

            // Экспорт не пустой: хотя бы один blob ушёл в репозиторий.
            Assert.NotEmpty(handler.Requests.Where(r => r.Path == "/repos/octo/lime-portfolio/git/blobs"));

            // Новый репозиторий без head → ветка создаётся через POST git/refs, не PATCH.
            Assert.Contains(handler.Requests, r => r.Method == HttpMethod.Post && r.Path == "/repos/octo/lime-portfolio/git/refs");

            var deployment = db.GitHubSiteDeployments.Single();
            Assert.Equal(5, deployment.SiteId);
            Assert.Equal(1, deployment.UserId);
            Assert.Equal(GitHubDeploymentService.OAuthDeploymentMode, deployment.Mode);
            Assert.Equal("octo", deployment.Owner);
            Assert.Equal("lime-portfolio", deployment.Repo);
            Assert.Equal("commit-sha", deployment.LastCommitSha);
            Assert.Null(deployment.LastError);
        }

        [Fact]
        public async Task Deploy_SecondTime_UpdatesExistingBranchViaPatch()
        {
            using var db = NewContext();
            var dp = new EphemeralDataProtectionProvider();
            SeedConnection(db, dp, userId: 1);
            SeedSite(db, userId: 1, slug: "portfolio");
            db.GitHubSiteDeployments.Add(new GitHubSiteDeployment
            {
                SiteId = 5,
                UserId = 1,
                Mode = GitHubDeploymentService.OAuthDeploymentMode,
                Owner = "octo",
                Repo = "lime-portfolio",
                Branch = "main",
                CreatedAt = DateTime.UtcNow,
            });
            db.SaveChanges();

            var handler = new RouterHandler();
            handler.Map(HttpMethod.Get, "/repos/octo/lime-portfolio", HttpStatusCode.OK, @"{
                ""id"": 123, ""name"": ""lime-portfolio"", ""full_name"": ""octo/lime-portfolio"",
                ""html_url"": ""https://github.com/octo/lime-portfolio"",
                ""default_branch"": ""main"", ""owner"": { ""login"": ""octo"" } }");
            handler.Map(HttpMethod.Get, "/repos/octo/lime-portfolio/git/ref/heads/main", HttpStatusCode.OK,
                "{\"object\":{\"sha\":\"old-head\"}}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/blobs", HttpStatusCode.Created, "{\"sha\":\"blob-sha\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/trees", HttpStatusCode.Created, "{\"sha\":\"tree-sha\"}");
            handler.Map(HttpMethod.Post, "/repos/octo/lime-portfolio/git/commits", HttpStatusCode.Created, "{\"sha\":\"commit-2\"}");
            handler.Map(new HttpMethod("PATCH"), "/repos/octo/lime-portfolio/git/refs/heads/main", HttpStatusCode.OK, "{}");

            var svc = NewService(db, handler, dp);
            var result = await svc.DeployQuickOAuthAsync(1, 5, "blob");

            Assert.False(result.CreatedRepository);
            Assert.Equal("commit-2", result.CommitSha);
            // Существующая ветка обновляется PATCH'ем, а не создаётся заново.
            Assert.Contains(handler.Requests, r => r.Method.Method == "PATCH");
            Assert.DoesNotContain(handler.Requests, r => r.Method == HttpMethod.Post && r.Path.EndsWith("/git/refs"));

            // Родитель коммита — старый head (история не переписывается).
            var commit = handler.Requests.Single(r => r.Path.EndsWith("/git/commits"));
            Assert.Contains("old-head", commit.Body);

            Assert.Equal("commit-2", db.GitHubSiteDeployments.Single().LastCommitSha);
        }

        // ===== Фейки =====

        private sealed class FakeEntitlements : IEntitlementService
        {
            private readonly Plan _plan;
            public FakeEntitlements(Plan plan) { _plan = plan; }
            public Task<Plan> ResolvePlanAsync(OwnerRef owner, CancellationToken ct = default) => Task.FromResult(_plan);
            public Task<UsageStatus> GetUsageAsync(OwnerRef owner, string meter, CancellationToken ct = default)
                => Task.FromResult(new UsageStatus());
            public Task IncrementAsync(OwnerRef owner, string meter, int n = 1, CancellationToken ct = default)
                => Task.CompletedTask;
            public Task<bool> CanCreateSiteAsync(OwnerRef owner, CancellationToken ct = default) => Task.FromResult(true);
            public Task<bool> CanUploadAsync(OwnerRef owner, long extraBytes, CancellationToken ct = default) => Task.FromResult(true);
        }

        private sealed class FakeHttpClientFactory : IHttpClientFactory
        {
            private readonly HttpMessageHandler _handler;
            public FakeHttpClientFactory(HttpMessageHandler handler) { _handler = handler; }

            public HttpClient CreateClient(string name)
            {
                // BaseAddress как в Startup: относительные пути клиента должны резолвиться.
                var baseAddress = name == "github-oauth" ? "https://github.com/" : "https://api.github.com/";
                return new HttpClient(_handler, disposeHandler: false) { BaseAddress = new Uri(baseAddress) };
            }
        }

        private sealed record RecordedRequest(HttpMethod Method, string Path, string Body);

        // Скриптованный GitHub API: маршрут (метод+путь) → ответ. Всё незамапленное — ошибка,
        // поэтому guard-тесты с пустым роутером заодно доказывают отсутствие сетевых вызовов.
        private sealed class RouterHandler : HttpMessageHandler
        {
            private readonly List<(HttpMethod Method, string Path, HttpStatusCode Status, string Json)> _routes = new();
            public List<RecordedRequest> Requests { get; } = new();

            public void Map(HttpMethod method, string path, HttpStatusCode status, string json)
                => _routes.Add((method, path, status, json));

            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(ct);
                var path = request.RequestUri.AbsolutePath;
                Requests.Add(new RecordedRequest(request.Method, path, body));

                var route = _routes.FirstOrDefault(r => r.Method == request.Method && r.Path == path);
                if (route.Json == null)
                {
                    throw new InvalidOperationException($"Незамапленный HTTP-вызов: {request.Method} {path}");
                }

                return new HttpResponseMessage(route.Status)
                {
                    Content = new StringContent(route.Json, Encoding.UTF8, "application/json"),
                };
            }
        }

        private sealed class FakeWebHostEnvironment : IWebHostEnvironment
        {
            public FakeWebHostEnvironment(string webRoot)
            {
                WebRootPath = webRoot;
                ContentRootPath = Path.GetFullPath(Path.Combine(webRoot, ".."));
            }

            public string WebRootPath { get; set; }
            public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
            public string ApplicationName { get; set; } = "Lime.Tests";
            public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
            public string ContentRootPath { get; set; }
            public string EnvironmentName { get; set; } = "Test";
        }
    }
}
