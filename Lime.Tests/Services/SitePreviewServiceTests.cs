using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Lime.Tests.Services
{
    // Скриншот-превью публикаций: рендер → /media/previews/{id}.png → OgImage.
    // Рендер подменён фейком — логика записи/гейтов тестируется без браузера.
    public class SitePreviewServiceTests : IDisposable
    {
        private sealed class FakeRenderer : ISitePreviewRenderer
        {
            public byte[] Result = { 1, 2, 3 };
            public int Calls;
            public string LastUrl = "";
            public Task<byte[]> RenderPngAsync(string url, int width, int height, CancellationToken ct = default)
            {
                Calls++;
                LastUrl = url;
                return Task.FromResult(Result);
            }
        }

        private sealed class FakeEnv : IWebHostEnvironment
        {
            public string WebRootPath { get; set; }
            public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
            public string ApplicationName { get; set; } = "Lime.Tests";
            public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
            public string ContentRootPath { get; set; }
            public string EnvironmentName { get; set; } = "Test";
        }

        private readonly string _webRoot;

        public SitePreviewServiceTests()
        {
            _webRoot = Path.Combine(Path.GetTempPath(), "lime_preview_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_webRoot);
        }

        public void Dispose()
        {
            try { Directory.Delete(_webRoot, recursive: true); } catch { /* best effort */ }
        }

        private static LimeEditorContext NewDb()
        {
            var opts = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("preview_" + Guid.NewGuid().ToString("N"))
                .Options;
            return new LimeEditorContext(opts);
        }

        private SitePreviewService NewSvc(LimeEditorContext db, FakeRenderer renderer)
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string>
            {
                ["Preview:BaseUrl"] = "http://localhost:5000",
            }).Build();
            return new SitePreviewService(db, renderer, new FakeEnv { WebRootPath = _webRoot, ContentRootPath = _webRoot },
                config, NullLogger<SitePreviewService>.Instance);
        }

        private static void SeedSite(LimeEditorContext db, int siteId, bool published = true, string ogImage = null)
        {
            db.Users.Add(new ApplicationUser { Id = siteId + 7000, UserName = "owner" + siteId });
            db.Sites.Add(new Site
            {
                IdSite = siteId,
                Name = "Сайт",
                Folder = "x",
                UserId = siteId + 7000,
                Slug = "my-site",
                IsPublished = published,
                OgImage = ogImage,
            });
            db.SaveChanges();
        }

        [Fact]
        public async Task Render_PublishedSite_WritesFileAndSetsOgImage()
        {
            using var db = NewDb();
            SeedSite(db, 11);
            var renderer = new FakeRenderer();
            var ok = await NewSvc(db, renderer).RenderAndStoreAsync(11);

            Assert.True(ok);
            Assert.Equal("http://localhost:5000/u/owner11/my-site", renderer.LastUrl);
            Assert.True(File.Exists(Path.Combine(_webRoot, "media", "previews", "11.png")));
            var og = db.Sites.Single().OgImage;
            Assert.StartsWith("/media/previews/11.png?v=", og);
        }

        [Fact]
        public async Task Render_UserSetOgImage_IsNotTouched_AndNotRendered()
        {
            using var db = NewDb();
            SeedSite(db, 12, ogImage: "/media/5/custom.png");
            var renderer = new FakeRenderer();
            var ok = await NewSvc(db, renderer).RenderAndStoreAsync(12);

            Assert.False(ok);
            Assert.Equal(0, renderer.Calls); // впустую не рендерим
            Assert.Equal("/media/5/custom.png", db.Sites.Single().OgImage);
        }

        [Fact]
        public async Task Render_PreviousAutoPreview_IsRefreshed()
        {
            using var db = NewDb();
            SeedSite(db, 13, ogImage: "/media/previews/13.png?v=1");
            var renderer = new FakeRenderer();
            var ok = await NewSvc(db, renderer).RenderAndStoreAsync(13);

            Assert.True(ok); // своё авто-превью обновляем при повторной публикации
            Assert.NotEqual("/media/previews/13.png?v=1", db.Sites.Single().OgImage);
        }

        [Fact]
        public async Task Render_UnpublishedOrMissing_SkipsQuietly()
        {
            using var db = NewDb();
            SeedSite(db, 14, published: false);
            var renderer = new FakeRenderer();

            Assert.False(await NewSvc(db, renderer).RenderAndStoreAsync(14));
            Assert.False(await NewSvc(db, renderer).RenderAndStoreAsync(999));
            Assert.Equal(0, renderer.Calls);
        }

        [Fact]
        public async Task Render_RendererUnavailable_LeavesEverythingUntouched()
        {
            using var db = NewDb();
            SeedSite(db, 15);
            var renderer = new FakeRenderer { Result = null };
            var ok = await NewSvc(db, renderer).RenderAndStoreAsync(15);

            Assert.False(ok);
            Assert.Null(db.Sites.Single().OgImage);
            Assert.False(File.Exists(Path.Combine(_webRoot, "media", "previews", "15.png")));
        }
    }
}
