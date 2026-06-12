using Lime_Editor.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using System;
using System.IO;
using System.IO.Compression;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Services
{
    // Покрывает ITemplateExportService — критичный путь Фазы 2 (ZIP, replace-правила, asset whitelist).
    public class TemplateExportServiceTests : IDisposable
    {
        private readonly string _wwwroot;
        private readonly TemplateExportService _service;

        public TemplateExportServiceTests()
        {
            _wwwroot = Path.Combine(Path.GetTempPath(), "limetest_" + Guid.NewGuid().ToString("N"));
            BuildFixtureAssets();
            _service = new TemplateExportService(new FakeEnv { WebRootPath = _wwwroot });
        }

        public void Dispose()
        {
            try { Directory.Delete(_wwwroot, recursive: true); } catch { /* лог не нужен */ }
        }

        private void BuildFixtureAssets()
        {
            // Ruby (TemplateId=1): whitelist style.min.css, app.min.js; vendor — всё; images — только referenced.
            CreateFile("css/Template_1/style.min.css", "/* ruby */");
            CreateFile("css/Template_1/ignored.css", "/* skip */");
            CreateFile("js/Template_1/app.min.js", "// ruby");
            CreateFile("js/Template_1/skipped.js", "// skip");
            CreateFile("vendor/Template_1/bootstrap/bootstrap.min.css", "/* bootstrap */");
            CreateFile("images/Template_1/cover.jpg", "JPGCOVER");
            CreateFile("images/Template_1/stray.jpg", "JPGSTRAY");

            // Sublime (TemplateId=2): копируем все css, js, fonts, images.
            CreateFile("css/Template_2/main.css", "/* sublime */");
            CreateFile("js/Template_2/jquery.js", "// jq");
            CreateFile("fonts/Template_2/font.woff", "FONT");
            CreateFile("images/Template_2/bg.jpg", "BG");

            // ComingSoon (TemplateId=3): все папки.
            CreateFile("css/Template_3/util.css", "/* css */");

            // Custom (TemplateId=4): whitelist css/main + css/lime + referenced images.
            CreateFile("css/main/bootstrap.min.css", "/* boot */");
            CreateFile("css/main/mainMeow.css", "/* meow */");
            CreateFile("css/main/skip.css", "/* skip */");
            CreateFile("css/lime/tokens.css", "/* tokens */");
            CreateFile("css/lime/base.css", "/* base */");
            CreateFile("css/lime/components.css", "/* components */");
            CreateFile("css/lime/constructor.css", "/* constructor */");
            CreateFile("css/lime/skip.css", "/* skip */");
            CreateFile("images/cover-1.jpg", "JPGCOVER1");
            CreateFile("images/unused.jpg", "JPGUNUSED");
        }

        private void CreateFile(string relPath, string content)
        {
            var full = Path.Combine(_wwwroot, relPath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }

        private static async Task<string> ReadEntryText(byte[] zip, string entryName)
        {
            using var ms = new MemoryStream(zip);
            using var archive = new ZipArchive(ms, ZipArchiveMode.Read);
            var entry = archive.GetEntry(entryName);
            if (entry == null) return null;
            using var reader = new StreamReader(entry.Open());
            return await reader.ReadToEndAsync();
        }

        private static bool EntryExists(byte[] zip, string entryName)
        {
            using var ms = new MemoryStream(zip);
            using var archive = new ZipArchive(ms, ZipArchiveMode.Read);
            return archive.GetEntry(entryName) != null;
        }

        [Theory]
        [InlineData(1, "RubyTemplate.zip")]
        [InlineData(2, "SublimeTemplate.zip")]
        [InlineData(3, "ComingSoonTemplate.zip")]
        [InlineData(4, "MySite.zip")]
        public async Task ExportAsync_UsesExpectedFileName(int templateId, string expected)
        {
            var result = await _service.ExportAsync(templateId, "<p>Hello</p>");
            Assert.Equal(expected, result.FileName);
        }

        [Fact]
        public async Task ExportAsync_ThrowsForUnknownTemplateId()
        {
            await Assert.ThrowsAsync<ArgumentException>(
                () => _service.ExportAsync(999, "<p>Hi</p>"));
        }

        [Fact]
        public async Task ExportAsync_WrapsHtml_AndZipContainsIndex()
        {
            var result = await _service.ExportAsync(1, "<p>Hello</p>");
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            Assert.NotNull(html);
            Assert.Contains("<!DOCTYPE html>", html);
            Assert.Contains("<html id=\"userSpace\"", html);
            Assert.Contains("<p>Hello</p>", html);
        }

        [Fact]
        public async Task ExportAsync_ConvertsContentEditableTrueToFalse()
        {
            var result = await _service.ExportAsync(1, "<p contenteditable=\"true\">Hi</p>");
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            Assert.Contains("contenteditable=\"false\"", html);
            Assert.DoesNotContain("contenteditable=\"true\"", html);
        }

        [Fact]
        public async Task ExportAsync_AppliesRubyReplacements()
        {
            var input = "<link href=\"../css/Template_1/style.min.css\">"
                      + "<script src=\"/js/Template_1/app.min.js\"></script>"
                      + "<img src=\"../images/Template_1/cover.jpg\">";
            var result = await _service.ExportAsync(1, input);
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            Assert.Contains("css/style.min.css", html);
            Assert.Contains("js/app.min.js", html);
            Assert.Contains("images/cover.jpg", html);
            Assert.DoesNotContain("../css/Template_1/", html);
        }

        [Fact]
        public async Task ExportAsync_AppliesSublimeChangethisRename()
        {
            var result = await _service.ExportAsync(2, "<div class=\"changethis\">x</div>");
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            Assert.Contains("class=\"otstup\"", html);
            Assert.DoesNotContain("class=\"changethis\"", html);
        }

        [Fact]
        public async Task ExportAsync_Ruby_IncludesWhitelistedCssOnly()
        {
            var result = await _service.ExportAsync(1, "<p>Hello</p>");
            Assert.True(EntryExists(result.ZipBytes, "css/style.min.css"));
            Assert.False(EntryExists(result.ZipBytes, "css/ignored.css"));
        }

        [Fact]
        public async Task ExportAsync_Ruby_IncludesWhitelistedJsOnly()
        {
            var result = await _service.ExportAsync(1, "<p>Hello</p>");
            Assert.True(EntryExists(result.ZipBytes, "js/app.min.js"));
            Assert.False(EntryExists(result.ZipBytes, "js/skipped.js"));
        }

        [Fact]
        public async Task ExportAsync_Ruby_VendorCopiedRecursively()
        {
            var result = await _service.ExportAsync(1, "<p>Hello</p>");
            Assert.True(EntryExists(result.ZipBytes, "vendor/bootstrap/bootstrap.min.css"));
        }

        [Fact]
        public async Task ExportAsync_Ruby_IncludesImage_OnlyIfReferenced()
        {
            // В HTML упомянут только cover.jpg, stray.jpg не должен попасть.
            var result = await _service.ExportAsync(1, "<img src=\"cover.jpg\">");
            Assert.True(EntryExists(result.ZipBytes, "images/cover.jpg"));
            Assert.False(EntryExists(result.ZipBytes, "images/stray.jpg"));
        }

        [Fact]
        public async Task ExportAsync_Custom_AppliesImagesReplacement()
        {
            var result = await _service.ExportAsync(4, "<img src=\"/images/cover-1.jpg\">");
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            Assert.Contains("src=\"images/cover-1.jpg\"", html);
        }

        [Fact]
        public async Task ExportAsync_Custom_IncludesWhitelistedCssAndReferencedImage()
        {
            var result = await _service.ExportAsync(4, "<img src=\"cover-1.jpg\">");
            Assert.True(EntryExists(result.ZipBytes, "css/bootstrap.min.css"));
            Assert.True(EntryExists(result.ZipBytes, "css/mainMeow.css"));
            Assert.False(EntryExists(result.ZipBytes, "css/skip.css"));
            Assert.True(EntryExists(result.ZipBytes, "images/cover-1.jpg"));
            Assert.False(EntryExists(result.ZipBytes, "images/unused.jpg"));
        }

        [Fact]
        public async Task ExportAsync_Custom_IncludesLimeDesignSystem()
        {
            var result = await _service.ExportAsync(4, "<p>Hello</p>");
            Assert.True(EntryExists(result.ZipBytes, "css/lime/tokens.css"));
            Assert.True(EntryExists(result.ZipBytes, "css/lime/base.css"));
            Assert.True(EntryExists(result.ZipBytes, "css/lime/components.css"));
            Assert.True(EntryExists(result.ZipBytes, "css/lime/constructor.css"));
            Assert.False(EntryExists(result.ZipBytes, "css/lime/skip.css"));
        }

        [Fact]
        public async Task ExportAsync_Custom_HtmlReferencesLimeStylesRelative()
        {
            var result = await _service.ExportAsync(4, "<p>Hello</p>");
            var html = await ReadEntryText(result.ZipBytes, "index.html");
            // Должна быть относительная ссылка css/lime/, не /css/lime/
            Assert.Contains("href=\"css/lime/tokens.css\"", html);
            Assert.DoesNotContain("/css/lime/", html);
        }

        private class FakeEnv : IWebHostEnvironment
        {
            public string WebRootPath { get; set; }
            public IFileProvider WebRootFileProvider { get; set; }
            public string ApplicationName { get; set; } = "Lime_Editor.Tests";
            public string ContentRootPath { get; set; } = ".";
            public IFileProvider ContentRootFileProvider { get; set; }
            public string EnvironmentName { get; set; } = "Test";
        }
    }
}
