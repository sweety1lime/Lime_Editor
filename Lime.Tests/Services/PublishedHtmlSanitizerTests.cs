using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    public class PublishedHtmlSanitizerTests
    {
        [Fact]
        public void Strips_EditorControlIds()
        {
            var html = @"<html><body>
                <a id=""del"" onclick=""savPage()"">Сохранить</a>
                <a id=""del1"" onclick=""downloadSite()"">Скачать</a>
                <a id=""del2"" href=""/Home/MySites"">Выйти</a>
                <h1>Content</h1>
            </body></html>";
            var clean = PublishedHtmlSanitizer.Sanitize(html);
            Assert.DoesNotContain("savPage", clean);
            Assert.DoesNotContain("downloadSite", clean);
            Assert.DoesNotContain("id=\"del", clean);
            Assert.Contains("<h1>Content</h1>", clean);
        }

        [Fact]
        public void SanitizeHead_AllowsSafeTags_StripsScriptsAndHandlers()
        {
            // Этап 0.2: кастомный <head>-код — whitelist meta/link/style, без script/on*/iframe/base.
            var head = "<meta name=\"yandex-verification\" content=\"abc\">" +
                       "<link rel=\"stylesheet\" href=\"https://cdn/x.css\">" +
                       "<style>.x{color:red}</style>" +
                       "<script>steal(document.cookie)</script>" +
                       "<base href=\"https://evil/\">" +
                       "<link rel=\"import\" href=\"https://evil/x.html\">" +
                       "<meta http-equiv=\"refresh\" content=\"0;url=https://evil\" onload=\"x()\">";
            var clean = PublishedHtmlSanitizer.SanitizeHead(head);

            Assert.Contains("yandex-verification", clean);
            Assert.Contains("stylesheet", clean);
            Assert.Contains(".x{color:red}", clean);
            Assert.DoesNotContain("steal", clean);            // <script> вырезан
            Assert.DoesNotContain("<base", clean);            // <base> не в whitelist
            Assert.DoesNotContain("rel=\"import\"", clean);   // опасный rel у link
            Assert.DoesNotContain("onload", clean);           // on*-атрибуты сняты
        }

        [Fact]
        public void SanitizeHead_EmptyOrNull_ReturnsEmpty()
        {
            Assert.Equal(string.Empty, PublishedHtmlSanitizer.SanitizeHead(null));
            Assert.Equal(string.Empty, PublishedHtmlSanitizer.SanitizeHead("   "));
        }

        [Fact]
        public void Strips_SaveTemplateScript()
        {
            var html = @"<html><body><h1>X</h1><script src=""/js/saveTemplate.js""></script></body></html>";
            var clean = PublishedHtmlSanitizer.Sanitize(html);
            Assert.DoesNotContain("saveTemplate.js", clean);
            Assert.Contains("<h1>X</h1>", clean);
        }

        [Fact]
        public void RemovesContentEditableAttribute()
        {
            var html = @"<html><body><h1 contenteditable=""true"">Edit me</h1></body></html>";
            var clean = PublishedHtmlSanitizer.Sanitize(html);
            Assert.DoesNotContain("contenteditable", clean);
            Assert.Contains("Edit me", clean);
        }

        [Fact]
        public void KeepsTemplate1ContentIntact()
        {
            // Кнопки del/del1/del2 убрать, но кастомный header/footer не трогать.
            var html = @"<html><body>
                <nav class=""navbar""><a class=""navbar-brand"" href=""#"">Lime</a>
                <a id=""del"" onclick=""savPage()"">Сохранить</a></nav>
                <main><h1>Hero</h1></main>
            </body></html>";
            var clean = PublishedHtmlSanitizer.Sanitize(html);
            Assert.Contains("navbar-brand", clean);
            Assert.Contains("<h1>Hero</h1>", clean);
            Assert.DoesNotContain("savPage", clean);
        }

        [Fact]
        public void HandlesEmpty()
        {
            Assert.Equal("", PublishedHtmlSanitizer.Sanitize(""));
            Assert.Null(PublishedHtmlSanitizer.Sanitize(null));
        }

        [Fact]
        public void ExtractBodyForEditor_ReturnsBodyInnerHtml_WithoutEditorChrome()
        {
            var html = @"<html><head><title>X</title></head><body>
                <div id=""del"" onclick=""savPage()"">controls</div>
                <section class=""lime-block""><h1 contenteditable=""true"">Привет</h1></section>
                <script src=""/js/saveTemplate.js""></script>
            </body></html>";

            var body = PublishedHtmlSanitizer.ExtractBodyForEditor(html);

            Assert.DoesNotContain("savPage", body);
            Assert.DoesNotContain("id=\"del\"", body);
            Assert.DoesNotContain("saveTemplate.js", body);
            Assert.Contains("<h1", body);
            Assert.Contains("contenteditable=\"true\"", body); // contenteditable СОХРАНЯЕТСЯ для редактирования
            Assert.Contains("Привет", body);
            Assert.DoesNotContain("<body", body, System.StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void ExtractBodyForEditor_HandlesEmpty()
        {
            Assert.Equal(string.Empty, PublishedHtmlSanitizer.ExtractBodyForEditor(""));
            Assert.Equal(string.Empty, PublishedHtmlSanitizer.ExtractBodyForEditor(null));
        }
    }
}
