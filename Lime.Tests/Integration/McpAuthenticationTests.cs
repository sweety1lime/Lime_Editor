using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Newtonsoft.Json;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // MCP/AI-agent API (Wave 1 п.5): /mcp принимает только валидный Bearer-токен схемы
    // "ApiToken" — ни анонимный доступ, ни мусорный/отозванный токен не проходят.
    public class McpAuthenticationTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public McpAuthenticationTests(WebFactory factory) => _factory = factory;

        private async Task<(int UserId, ApiToken Token, string Raw)> CreateUserWithTokenAsync(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await userManager.FindByNameAsync(userName);
            if (user == null)
            {
                user = new ApplicationUser { UserName = userName, Email = userName + "@test.local", EmailConfirmed = true };
                Assert.True((await userManager.CreateAsync(user, "TestPass1!")).Succeeded);
            }
            var apiTokens = scope.ServiceProvider.GetRequiredService<ApiTokenService>();
            var (token, raw) = await apiTokens.GenerateAsync(user.Id, "test");
            return (user.Id, token, raw);
        }

        private HttpClient McpClient()
        {
            var client = _factory.CreateClient();
            client.DefaultRequestHeaders.Accept.Clear();
            client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            client.DefaultRequestHeaders.Accept.ParseAdd("text/event-stream");
            return client;
        }

        private static StringContent McpToolsListBody()
        {
            var payload = new { jsonrpc = "2.0", id = 1, method = "tools/list", @params = new { } };
            return new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
        }

        [Fact]
        public async Task Mcp_NoToken_Returns401()
        {
            var client = McpClient();
            var resp = await client.PostAsync("/mcp", McpToolsListBody());
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }

        [Fact]
        public async Task Mcp_GarbageToken_Returns401()
        {
            var client = McpClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-token");
            var resp = await client.PostAsync("/mcp", McpToolsListBody());
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }

        [Fact]
        public async Task Mcp_ValidToken_Returns200()
        {
            var (_, _, raw) = await CreateUserWithTokenAsync("mcp_valid_user");
            var client = McpClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", raw);
            var resp = await client.PostAsync("/mcp", McpToolsListBody());
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        }

        [Fact]
        public async Task Mcp_RevokedToken_Returns401()
        {
            var (userId, token, raw) = await CreateUserWithTokenAsync("mcp_revoked_user");
            using (var scope = _factory.Services.CreateScope())
            {
                var apiTokens = scope.ServiceProvider.GetRequiredService<ApiTokenService>();
                Assert.True(await apiTokens.RevokeAsync(userId, token.Id));
            }

            var client = McpClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", raw);
            var resp = await client.PostAsync("/mcp", McpToolsListBody());
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
    }
}
