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
            Assert.False(MediaUploadSecurity.HasAllowedSignature(".svg", new byte[] { (byte)'<', (byte)'s', (byte)'v', (byte)'g' }));
        }
    }
}
