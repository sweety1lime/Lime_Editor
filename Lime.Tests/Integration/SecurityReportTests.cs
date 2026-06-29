using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    public class SecurityReportTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public SecurityReportTests(WebFactory factory) => _factory = factory;

        [Fact]
        public async Task CspReport_AcceptsAnonymousReport_WithoutAntiforgery()
        {
            var client = _factory.CreateClient();
            const string payload =
                "{\"csp-report\":{\"violated-directive\":\"script-src\",\"blocked-uri\":\"https://evil.test/x.js\",\"document-uri\":\"https://lime.test/Home/SignIn?token=secret\"}}";
            using var content = new StringContent(payload, Encoding.UTF8, "application/csp-report");

            var response = await client.PostAsync("/Security/CspReport", content);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task CspReport_IgnoresMalformedPayload()
        {
            var client = _factory.CreateClient();
            using var content = new StringContent("{not-json", Encoding.UTF8, "application/csp-report");

            var response = await client.PostAsync("/Security/CspReport", content);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }
}
