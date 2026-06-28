using Lime_Editor.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using System;
using System.IO;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Services
{
    public class LocalDiskMediaStorageTests : IDisposable
    {
        private readonly string _webRoot;
        private readonly LocalDiskMediaStorage _storage;

        // Минимальный фейк окружения: важен только WebRootPath.
        private sealed class FakeEnv : IWebHostEnvironment
        {
            public string WebRootPath { get; set; }
            public IFileProvider WebRootFileProvider { get; set; }
            public string ApplicationName { get; set; } = "Test";
            public string ContentRootPath { get; set; }
            public IFileProvider ContentRootFileProvider { get; set; }
            public string EnvironmentName { get; set; } = "Test";
        }

        public LocalDiskMediaStorageTests()
        {
            _webRoot = Path.Combine(Path.GetTempPath(), "mediastore_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_webRoot);
            _storage = new LocalDiskMediaStorage(new FakeEnv { WebRootPath = _webRoot, ContentRootPath = _webRoot });
        }

        public void Dispose()
        {
            try { Directory.Delete(_webRoot, recursive: true); } catch { /* not critical */ }
        }

        [Fact]
        public async Task Save_WritesFile_UnderUserFolder()
        {
            await _storage.SaveAsync(5, "a.jpg", new byte[] { 1, 2, 3 });

            var path = Path.Combine(_webRoot, "media", "5", "a.jpg");
            Assert.True(File.Exists(path));
            Assert.Equal(3, new FileInfo(path).Length);
        }

        [Fact]
        public async Task Delete_RemovesOnlyThatFile()
        {
            await _storage.SaveAsync(5, "a.jpg", new byte[] { 1 });
            await _storage.SaveAsync(5, "b.jpg", new byte[] { 2 });

            _storage.Delete(5, "a.jpg");

            Assert.False(File.Exists(Path.Combine(_webRoot, "media", "5", "a.jpg")));
            Assert.True(File.Exists(Path.Combine(_webRoot, "media", "5", "b.jpg")));
        }

        [Fact]
        public void Delete_Missing_IsNoOp()
        {
            // Не бросает, если файла нет.
            _storage.Delete(99, "nope.jpg");
        }

        [Fact]
        public async Task DeleteUserFolder_RemovesAllUserFiles()
        {
            await _storage.SaveAsync(7, "a.jpg", new byte[] { 1 });
            await _storage.SaveAsync(7, "b.jpg", new byte[] { 2 });

            _storage.DeleteUserFolder(7);

            Assert.False(Directory.Exists(Path.Combine(_webRoot, "media", "7")));
        }

        [Fact]
        public void PublicUrl_MatchesServedPath()
        {
            Assert.Equal("/media/5/a.jpg", _storage.PublicUrl(5, "a.jpg"));
        }

        [Fact]
        public void LocalRootForMaintenance_PointsToMediaRoot()
        {
            Assert.Equal(Path.Combine(_webRoot, "media"), _storage.LocalRootForMaintenance);
        }
    }
}
