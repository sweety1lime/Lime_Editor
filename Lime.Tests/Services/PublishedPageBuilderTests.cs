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
    }
}
