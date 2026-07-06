using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using System;
using System.IO;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Services
{
    public class OrphanMediaCleanupTests : IDisposable
    {
        private readonly string _mediaRoot;

        public OrphanMediaCleanupTests()
        {
            _mediaRoot = Path.Combine(Path.GetTempPath(), "orphan_test_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_mediaRoot);
        }

        public void Dispose()
        {
            try { Directory.Delete(_mediaRoot, recursive: true); } catch { /* not critical */ }
        }

        private LimeEditorContext NewDb()
        {
            var opts = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("orphan_" + Guid.NewGuid().ToString("N"))
                .Options;
            return new LimeEditorContext(opts);
        }

        private void CreateUserFile(int userId, string fileName, DateTime? writeTime = null)
        {
            var userDir = Path.Combine(_mediaRoot, userId.ToString());
            Directory.CreateDirectory(userDir);
            var path = Path.Combine(userDir, fileName);
            File.WriteAllText(path, "x");
            if (writeTime.HasValue)
            {
                File.SetLastWriteTimeUtc(path, writeTime.Value);
            }
        }

        [Fact]
        public async Task Cleanup_SkipsPreviewsFolder()
        {
            // Авто-превью публикаций живут в /media/previews без записей в MediaAssets —
            // чистильщик обязан обходить папку стороной, иначе снёс бы все превью через час.
            var previewsDir = Path.Combine(_mediaRoot, SitePreviewService.PreviewsFolder);
            Directory.CreateDirectory(previewsDir);
            var file = Path.Combine(previewsDir, "42.png");
            File.WriteAllText(file, "png");
            File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddDays(-30));
            using var db = NewDb();

            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, _mediaRoot, TimeSpan.FromHours(1));

            Assert.Equal(0, deleted);
            Assert.True(File.Exists(file));
        }

        [Fact]
        public async Task Cleanup_DeletesOrphanFile_OlderThanMinAge()
        {
            CreateUserFile(1, "orphan.jpg", DateTime.UtcNow.AddHours(-2));
            using var db = NewDb();

            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, _mediaRoot, TimeSpan.FromHours(1));

            Assert.Equal(1, deleted);
            Assert.False(File.Exists(Path.Combine(_mediaRoot, "1", "orphan.jpg")));
        }

        [Fact]
        public async Task Cleanup_KeepsKnownFile()
        {
            CreateUserFile(1, "known.jpg", DateTime.UtcNow.AddHours(-2));
            using var db = NewDb();
            db.MediaAssets.Add(new MediaAsset
            {
                UserId = 1,
                OriginalName = "k.jpg",
                StoredFileName = "known.jpg",
                ContentType = "image/jpeg",
                SizeBytes = 1,
                UploadedAt = DateTime.UtcNow.AddHours(-2),
            });
            await db.SaveChangesAsync();

            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, _mediaRoot, TimeSpan.FromHours(1));

            Assert.Equal(0, deleted);
            Assert.True(File.Exists(Path.Combine(_mediaRoot, "1", "known.jpg")));
        }

        [Fact]
        public async Task Cleanup_SkipsFreshOrphan_YoungerThanMinAge()
        {
            // Файл создан только что — может ещё не закоммиченный upload. Не трогаем.
            CreateUserFile(1, "fresh.jpg");
            using var db = NewDb();

            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, _mediaRoot, TimeSpan.FromHours(1));

            Assert.Equal(0, deleted);
            Assert.True(File.Exists(Path.Combine(_mediaRoot, "1", "fresh.jpg")));
        }

        [Fact]
        public async Task Cleanup_KeepsFileOfOtherUser_WhenSameNameButDifferentUserDir()
        {
            // Один и тот же StoredFileName ("a.jpg") встречается у двух юзеров — это легально, потому что
            // путь содержит userId. Ключ — userId/file, а не просто file.
            CreateUserFile(1, "a.jpg", DateTime.UtcNow.AddHours(-2));
            CreateUserFile(2, "a.jpg", DateTime.UtcNow.AddHours(-2));
            using var db = NewDb();
            db.MediaAssets.Add(new MediaAsset
            {
                UserId = 2,
                OriginalName = "a.jpg",
                StoredFileName = "a.jpg",
                ContentType = "image/jpeg",
                SizeBytes = 1,
                UploadedAt = DateTime.UtcNow.AddHours(-2),
            });
            await db.SaveChangesAsync();

            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, _mediaRoot, TimeSpan.FromHours(1));

            // User 1 — orphan → удалён; User 2 — known → остался.
            Assert.Equal(1, deleted);
            Assert.False(File.Exists(Path.Combine(_mediaRoot, "1", "a.jpg")));
            Assert.True(File.Exists(Path.Combine(_mediaRoot, "2", "a.jpg")));
        }

        [Fact]
        public async Task Cleanup_HandlesMissingMediaRoot_Gracefully()
        {
            using var db = NewDb();
            var deleted = await OrphanMediaCleanupService.CleanupAsync(db, Path.Combine(Path.GetTempPath(), "no_such_" + Guid.NewGuid().ToString("N")), TimeSpan.FromHours(1));
            Assert.Equal(0, deleted);
        }
    }
}
