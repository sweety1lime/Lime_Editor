using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Correlation-id middleware: каждый ответ несёт X-Request-Id; безопасный входящий id
    // прокидывается насквозь, мусорный — заменяется сгенерированным (защита от log forging).
    public class RequestCorrelationTests : IClassFixture<WebFactory>
    {
        private const string Header = "X-Request-Id";
        private readonly WebFactory _factory;

        public RequestCorrelationTests(WebFactory factory) => _factory = factory;

        private static string HeaderValue(HttpResponseMessage resp) =>
            resp.Headers.TryGetValues(Header, out var values) ? values.FirstOrDefault() : null;

        [Fact]
        public async Task Response_AlwaysCarries_RequestId()
        {
            var client = _factory.CreateClient();

            var resp = await client.GetAsync("/Home/SignIn");

            Assert.False(string.IsNullOrEmpty(HeaderValue(resp)));
        }

        [Fact]
        public async Task SafeIncomingRequestId_IsEchoedBack()
        {
            var client = _factory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Get, "/Home/SignIn");
            req.Headers.Add(Header, "trace-abc-123");

            var resp = await client.SendAsync(req);

            Assert.Equal("trace-abc-123", HeaderValue(resp));
        }

        [Fact]
        public async Task UnsafeIncomingRequestId_IsReplaced()
        {
            var client = _factory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Get, "/Home/SignIn");
            req.Headers.TryAddWithoutValidation(Header, "bad/value with spaces");

            var resp = await client.SendAsync(req);

            var echoed = HeaderValue(resp);
            Assert.False(string.IsNullOrEmpty(echoed));
            Assert.NotEqual("bad/value with spaces", echoed);
        }
    }
}
