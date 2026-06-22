using Lime_Editor.Models;
using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 0.2: сборка publish-страницы вокруг контента — кастомный <head>-код из doc.head
    // (санитайзится) и заголовок страницы.
    public class PublishedPageBuilderTests
    {
        [Fact]
        public void WrapCustomHtml_InjectsSanitizedHead_FromDocumentJson()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var docJson = /*lang=json*/
                "{ \"version\":1, \"head\": \"<meta name=\\\"verify\\\" content=\\\"ok\\\"><script>bad()</script>\" }";

            var html = PublishedPageBuilder.WrapCustomHtml("<div class=\"lime-doc-page\"></div>", site, docJson);

            Assert.Contains("name=\"verify\"", html);   // безопасный meta попал в head
            Assert.DoesNotContain("bad()", html);        // <script> из head вырезан
            // Кастомный head вставлен внутри <head> (до </head>).
            Assert.True(html.IndexOf("name=\"verify\"") < html.IndexOf("</head>"));
        }

        [Fact]
        public void WrapCustomHtml_NoDocumentJson_StillBuilds()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml("<div class=\"lime-doc-page\"></div>", site);
            Assert.Contains("<title>", html);
            Assert.Contains("lime-published", html);
        }

        // Этап 3.4: гейт тарифа — на планах без AllowCustomCode из снапшота вырезаются
        // doc.customCss и doc.head, остальной документ (блоки/тема) сохраняется.
        [Fact]
        public void StripCustomCode_RemovesCustomCssAndHead_KeepsRest()
        {
            var docJson = /*lang=json*/
                "{\"version\":1,\"customCss\":\".x{color:red}\",\"head\":\"<meta name=\\\"v\\\">\",\"blocks\":[{\"id\":\"a\"}]}";

            var stripped = PublishedPageBuilder.StripCustomCode(docJson);

            Assert.DoesNotContain("customCss", stripped);
            Assert.DoesNotContain("\"head\"", stripped);
            Assert.DoesNotContain("color:red", stripped);
            Assert.Contains("\"blocks\"", stripped);   // контент сохранён
            Assert.Contains("\"version\"", stripped);
        }

        [Fact]
        public void StripCustomCode_NoCustomCode_ReturnsUnchanged()
        {
            var docJson = "{\"version\":1,\"blocks\":[{\"id\":\"a\"}]}";
            Assert.Same(docJson, PublishedPageBuilder.StripCustomCode(docJson));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not json")]
        public void StripCustomCode_EmptyOrBroken_ReturnsInput(string input)
        {
            Assert.Equal(input, PublishedPageBuilder.StripCustomCode(input));
        }

        // Forward-compat (страховка перед schema v2): единственный C#-код, делающий round-trip
        // документа (JObject), ОБЯЗАН сохранять незнакомые поля — иначе v1 и v2 не смогут
        // сосуществовать за feature-flag. Здесь будущее поле v2 переживает strip кастом-кода.
        [Fact]
        public void StripCustomCode_PreservesUnknownFields()
        {
            var docJson = /*lang=json*/
                "{\"version\":2,\"customCss\":\".x{}\",\"futureLayout\":{\"mode\":\"free\"},\"pages\":[{\"id\":\"p0\"}]}";

            var stripped = PublishedPageBuilder.StripCustomCode(docJson);
            var doc = Newtonsoft.Json.Linq.JObject.Parse(stripped);

            Assert.Null(doc["customCss"]);                       // гейт сработал
            Assert.Equal(2, (int)doc["version"]);                // версия сохранена
            Assert.NotNull(doc["futureLayout"]);                 // незнакомое поле НЕ потеряно
            Assert.Equal("free", (string)doc["futureLayout"]["mode"]);
            Assert.NotNull(doc["pages"]);
        }
    }
}
