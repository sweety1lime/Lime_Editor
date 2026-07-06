using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    public class MediaUploadSecurityTests
    {
        [Theory]
        [InlineData(".jpg", "image/jpeg")]
        [InlineData(".jpeg", "image/pjpeg")]
        [InlineData(".png", "image/png")]
        [InlineData(".gif", "image/gif")]
        [InlineData(".webp", "image/webp")]
        public void IsAllowedContentType_AcceptsExpectedImageTypes(string extension, string contentType)
        {
            Assert.True(MediaUploadSecurity.IsAllowedContentType(extension, contentType));
        }

        [Theory]
        [InlineData(".jpg", "image/svg+xml")]
        [InlineData(".png", "application/octet-stream")]
        [InlineData(".gif", "image/png")]
        [InlineData(".webp", "")]
        public void IsAllowedContentType_RejectsUnexpectedTypes(string extension, string contentType)
        {
            Assert.False(MediaUploadSecurity.IsAllowedContentType(extension, contentType));
        }

        [Fact]
        public void HasAllowedSignature_AcceptsKnownImageMagicBytes()
        {
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".jpg", new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".png", new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }));
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".gif", new byte[] { (byte)'G', (byte)'I', (byte)'F', (byte)'8', (byte)'9', (byte)'a' }));
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".webp", new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F', 0x01, 0x00, 0x00, 0x00, (byte)'W', (byte)'E', (byte)'B', (byte)'P' }));
        }

        [Fact]
        public void HasAllowedSignature_RejectsMismatchedOrUnknownBytes()
        {
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".jpg", new byte[] { (byte)'%', (byte)'P', (byte)'D', (byte)'F' }));
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".png", new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
            // У SVG нет бинарной сигнатуры — он идёт через LooksLikeSvg + SvgSanitizer.
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".svg", new byte[] { (byte)'<', (byte)'s', (byte)'v', (byte)'g' }));
        }

        // ===== Медиа-волна: SVG / шрифты / Lottie-JSON =====

        [Theory]
        [InlineData(".svg", "image/svg+xml")]
        [InlineData(".woff2", "font/woff2")]
        [InlineData(".woff2", "application/octet-stream")] // браузеры часто шлют octet-stream для шрифтов
        [InlineData(".woff", "font/woff")]
        [InlineData(".json", "application/json")]
        public void IsAllowedContentType_AcceptsNewMediaKinds(string extension, string contentType)
        {
            Assert.True(MediaUploadSecurity.IsAllowedContentType(extension, contentType));
        }

        [Theory]
        [InlineData(".jpg", MediaKind.Image)]
        [InlineData(".svg", MediaKind.Svg)]
        [InlineData(".woff2", MediaKind.Font)]
        [InlineData(".woff", MediaKind.Font)]
        [InlineData(".json", MediaKind.LottieJson)]
        public void Classify_MapsExtensionsToKinds(string extension, MediaKind expected)
        {
            Assert.Equal(expected, MediaUploadSecurity.Classify(extension));
        }

        [Fact]
        public void Classify_UnknownExtension_ReturnsNull()
        {
            Assert.Null(MediaUploadSecurity.Classify(".exe"));
            Assert.Null(MediaUploadSecurity.Classify(".html"));
            Assert.Null(MediaUploadSecurity.Classify(""));
        }

        [Fact]
        public void HasAllowedSignature_AcceptsWoffMagicBytes()
        {
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".woff2", "wOF2xxxx"u8.ToArray()));
            Assert.True(MediaUploadSecurity.HasAllowedSignature(".woff", "wOFFxxxx"u8.ToArray()));
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".woff2", "wOFFxxxx"u8.ToArray())); // woff ≠ woff2
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".woff", "GIF89a"u8.ToArray()));
        }

        [Fact]
        public void LooksLikeSvg_FindsSvgTagWithPrologAndBom()
        {
            Assert.True(MediaUploadSecurity.LooksLikeSvg("<svg xmlns=\"x\"></svg>"u8.ToArray()));
            Assert.True(MediaUploadSecurity.LooksLikeSvg("<?xml version=\"1.0\"?>\n<!-- c -->\n<svg/>"u8.ToArray()));
            Assert.False(MediaUploadSecurity.LooksLikeSvg("<html><body>nope</body></html>"u8.ToArray()));
            Assert.False(MediaUploadSecurity.LooksLikeSvg(new byte[] { 0xFF, 0xD8, 0xFF }));
        }

        [Fact]
        public void LooksLikeJson_RequiresLeadingBrace()
        {
            Assert.True(MediaUploadSecurity.LooksLikeJson("{\"v\":\"5\"}"u8.ToArray()));
            Assert.True(MediaUploadSecurity.LooksLikeJson("  \r\n {}"u8.ToArray()));
            Assert.True(MediaUploadSecurity.LooksLikeJson(new byte[] { 0xEF, 0xBB, 0xBF, (byte)'{', (byte)'}' })); // BOM
            Assert.False(MediaUploadSecurity.LooksLikeJson("[1,2]"u8.ToArray())); // lottie — объект, не массив
            Assert.False(MediaUploadSecurity.LooksLikeJson("<svg/>"u8.ToArray()));
        }
    }
}
