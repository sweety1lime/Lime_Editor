using System.Net;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Lime.Tests.Integration
{
    public class SmokeTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public SmokeTests(WebFactory factory) => _factory = factory;

        [Fact]
        public async Task Health_ReturnsHealthy()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/health");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal("Healthy", body);
        }

        [Fact]
        public async Task MySites_RequiresAuth_RedirectsToSignIn()
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });
            var response = await client.GetAsync("/Home/MySites");
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? string.Empty);
        }

        [Fact]
        public async Task SignIn_Get_Returns200()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/Home/SignIn");
            response.EnsureSuccessStatusCode();
        }
    }
}
