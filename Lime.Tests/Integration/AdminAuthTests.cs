using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    public class AdminAuthTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public AdminAuthTests(WebFactory factory) => _factory = factory;

        [Theory]
        [InlineData("/Admin/Index")]
        [InlineData("/Admin/Users")]
        [InlineData("/Admin/Sites")]
        public async Task AdminRoutes_RedirectToSignIn_WhenAnonymous(string url)
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
            });
            var response = await client.GetAsync(url);
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Contains("/Home/SignIn", response.Headers.Location?.ToString() ?? string.Empty);
        }
    }
}
