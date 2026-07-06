using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    // Медиа-волна: аплоад SVG разрешён ТОЛЬКО через санитайзер — SVG на нашем origin
    // при прямом открытии исполняет скрипты (stored-XSS рядом с Identity-cookie).
    public class SvgSanitizerTests
    {
        [Fact]
        public void Sanitize_KeepsPlainVectorContent()
        {
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">" +
                      "<circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"#84cc16\"/>" +
                      "<path d=\"M0 0h10v10z\" style=\"opacity:.5\"/></svg>";
            var result = SvgSanitizer.Sanitize(svg);
            Assert.NotNull(result);
            Assert.Contains("circle", result);
            Assert.Contains("#84cc16", result);
            Assert.Contains("opacity:.5", result);
        }

        [Fact]
        public void Sanitize_StripsScriptAndEventHandlers()
        {
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\">" +
                      "<script>alert(2)</script>" +
                      "<rect width=\"5\" height=\"5\" onclick=\"alert(3)\"/></svg>";
            var result = SvgSanitizer.Sanitize(svg);
            Assert.NotNull(result);
            Assert.DoesNotContain("script", result);
            Assert.DoesNotContain("alert", result);
            Assert.DoesNotContain("onload", result);
            Assert.DoesNotContain("onclick", result);
            Assert.Contains("rect", result); // безопасный сосед уцелел
        }

        [Fact]
        public void Sanitize_StripsForeignObjectSubtree()
        {
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\">" +
                      "<foreignObject><body xmlns=\"http://www.w3.org/1999/xhtml\"><script>alert(1)</script></body></foreignObject>" +
                      "<circle r=\"1\"/></svg>";
            var result = SvgSanitizer.Sanitize(svg);
            Assert.NotNull(result);
            Assert.DoesNotContain("foreignObject", result);
            Assert.DoesNotContain("alert", result);
            Assert.Contains("circle", result);
        }

        [Fact]
        public void Sanitize_StripsJavascriptHrefs_KeepsInternalAndDataImage()
        {
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">" +
                      "<a href=\"javascript:alert(1)\"><text>x</text></a>" +
                      "<use xlink:href=\"#ok\"/>" +
                      "<use xlink:href=\"https://evil.example/x.svg#f\"/>" +
                      "<image href=\"data:image/png;base64,AAAA\"/></svg>";
            var result = SvgSanitizer.Sanitize(svg);
            Assert.NotNull(result);
            Assert.DoesNotContain("javascript:", result);
            Assert.DoesNotContain("evil.example", result); // внешние href вычищены
            Assert.Contains("#ok", result);                 // внутренние ссылки живут
            Assert.Contains("data:image/png", result);      // инлайн-растр живёт
        }

        [Fact]
        public void Sanitize_RejectsDtdAndNonSvg()
        {
            // DOCTYPE (XXE) → парс с DtdProcessing.Prohibit падает → null.
            Assert.Null(SvgSanitizer.Sanitize("<!DOCTYPE svg [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><svg>&x;</svg>"));
            Assert.Null(SvgSanitizer.Sanitize("<html><body>не svg</body></html>"));
            Assert.Null(SvgSanitizer.Sanitize("просто текст"));
            Assert.Null(SvgSanitizer.Sanitize(""));
            Assert.Null(SvgSanitizer.Sanitize(null));
        }
    }
}
