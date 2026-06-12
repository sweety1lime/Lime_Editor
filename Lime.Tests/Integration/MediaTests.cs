using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    public class MediaTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public MediaTests(WebFactory factory) => _factory = factory;

        [Theory]
        [InlineData("/Media/Index")]
        public async Task Media_RedirectsToSignIn_WhenAnonymous(string url)
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
