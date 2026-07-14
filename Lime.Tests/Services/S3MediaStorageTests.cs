using Lime_Editor.Services;
using System;
using Xunit;

namespace Lime.Tests.Services
{
    // S3-адаптер хранилища (медиа-инфраструктура): проверяем контракты, не требующие сети —
    // построение публичных URL, отказ на небезопасные имена, нормализацию конфига.
    // Сетевые операции (Put/Delete/List) — тонкие обёртки над AWSSDK, их проверит живой бакет.
    public class S3MediaStorageTests
    {
        private static S3MediaStorage Create(string baseUrl = "https://media.example.com")
            => new S3MediaStorage(s3: null, bucket: "lime-media", publicBaseUrl: baseUrl);

        [Fact]
        public void PublicUrl_BuildsBucketUrl_WithUserPrefix()
        {
            var url = Create().PublicUrl(42, "abc123.jpg");
            Assert.Equal("https://media.example.com/42/abc123.jpg", url);
        }

        [Fact]
        public void PublicUrl_TrimsTrailingSlashOfBaseUrl()
        {
            var url = Create("https://media.example.com/").PublicUrl(7, "x.png");
            Assert.Equal("https://media.example.com/7/x.png", url);
        }

        [Theory]
        [InlineData("../secret.png")]
        [InlineData("a/b.png")]
        [InlineData("a\\b.png")]
        [InlineData("")]
        [InlineData("   ")]
        public void PublicUrl_RejectsUnsafeStoredNames(string name)
        {
            Assert.Throws<ArgumentException>(() => Create().PublicUrl(1, name));
        }

        [Fact]
        public void Ctor_RequiresBucketAndPublicBaseUrl()
        {
            Assert.Throws<ArgumentException>(() => new S3MediaStorage(null, "", "https://x"));
            Assert.Throws<ArgumentException>(() => new S3MediaStorage(null, "bucket", " "));
        }

        [Fact]
        public void LocalRootForMaintenance_IsNull_SoDiskCleanupSkips()
        {
            // Контракт IMediaStorage: null = не файловое хранилище, orphan-cleanup по диску не идёт.
            Assert.Null(Create().LocalRootForMaintenance);
        }

        // Общая проверка имён (используется и диском, и S3): защита от путевых сегментов в ключе.
        [Theory]
        [InlineData("abc123.jpg", true)]
        [InlineData("f00d.woff2", true)]
        [InlineData("../up.png", false)]
        [InlineData("dir/f.png", false)]
        [InlineData("dir\\f.png", false)]
        [InlineData("", false)]
        public void StoredFileNames_IsSafe(string name, bool expected)
        {
            Assert.Equal(expected, StoredFileNames.IsSafe(name));
        }
    }
}
