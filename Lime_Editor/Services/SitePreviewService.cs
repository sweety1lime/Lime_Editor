#nullable enable
using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Очередь превью: publish кладёт siteId, фоновый воркер рендерит — публикация не ждёт браузер.
    // Bounded + DropOldest: при шторме публикаций старые задания вытесняются, утечки нет.
    public sealed class SitePreviewQueue
    {
        private readonly Channel<int> _channel = Channel.CreateBounded<int>(
            new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropOldest });

        public void Enqueue(int siteId) => _channel.Writer.TryWrite(siteId);

        public IAsyncEnumerable<int> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
    }

    // Скриншот опубликованной страницы → wwwroot/media/previews/{siteId}.png → Site.OgImage.
    // Превью видно в карточках MySites/галереи и в og:image публикации. Пользовательский
    // OgImage (задан руками) НЕ перезаписывается — обновляем только свои авто-превью.
    public sealed class SitePreviewService
    {
        // Резервная подпапка в /media: OrphanMediaCleanup обходит её стороной (это не user-медиа).
        public const string PreviewsFolder = "previews";
        public const int Width = 1200;  // стандарт og:image
        public const int Height = 630;

        private readonly LimeEditorContext _db;
        private readonly ISitePreviewRenderer _renderer;
        private readonly IWebHostEnvironment _env;
        private readonly IConfiguration _config;
        private readonly ILogger<SitePreviewService> _logger;
        private readonly IServer? _server;

        public SitePreviewService(
            LimeEditorContext db,
            ISitePreviewRenderer renderer,
            IWebHostEnvironment env,
            IConfiguration config,
            ILogger<SitePreviewService> logger,
            IServer? server = null)
        {
            _db = db;
            _renderer = renderer;
            _env = env;
            _config = config;
            _logger = logger;
            _server = server;
        }

        public async Task<bool> RenderAndStoreAsync(int siteId, CancellationToken ct = default)
        {
            // Воркер работает вне запроса — амбиентного пользователя нет, фильтр обходим явно.
            var target = await _db.Sites.IgnoreQueryFilters()
                .Where(s => s.IdSite == siteId)
                .Join(_db.Users, s => s.UserId, u => u.Id, (s, u) => new { Site = s, u.UserName })
                .FirstOrDefaultAsync(ct);
            if (target == null || !target.Site.IsPublished ||
                string.IsNullOrEmpty(target.Site.Slug) || string.IsNullOrEmpty(target.UserName))
            {
                return false;
            }

            // Пользовательский og-image не трогаем — рендерить впустую тоже незачем.
            var previewPrefix = $"/media/{PreviewsFolder}/";
            if (!string.IsNullOrEmpty(target.Site.OgImage) &&
                !target.Site.OgImage.StartsWith(previewPrefix, StringComparison.Ordinal))
            {
                return false;
            }

            var baseUrl = ResolveBaseUrl();
            if (baseUrl == null)
            {
                return false; // TestServer/нет адресов — превью просто не делаем
            }

            var url = $"{baseUrl}/u/{Uri.EscapeDataString(target.UserName)}/{Uri.EscapeDataString(target.Site.Slug)}";
            var png = await _renderer.RenderPngAsync(url, Width, Height, ct);
            if (png == null || png.Length == 0)
            {
                return false;
            }

            var dir = Path.Combine(_env.WebRootPath, "media", PreviewsFolder);
            Directory.CreateDirectory(dir);
            await File.WriteAllBytesAsync(Path.Combine(dir, siteId + ".png"), png, ct);

            // /media/** отдаётся с immutable-кэшом — версия в query, чтобы браузер увидел новое превью.
            target.Site.OgImage = $"{previewPrefix}{siteId}.png?v={DateTime.UtcNow.Ticks}";
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("Превью сайта {SiteId} обновлено", siteId);
            return true;
        }

        // База для self-request: конфиг Preview:BaseUrl, иначе первый адрес Kestrel
        // (предпочитаем http — не спотыкаться о dev-сертификат).
        private string? ResolveBaseUrl()
        {
            var configured = _config["Preview:BaseUrl"];
            if (!string.IsNullOrWhiteSpace(configured))
            {
                return configured.TrimEnd('/');
            }

            var addresses = _server?.Features.Get<IServerAddressesFeature>()?.Addresses;
            var address = addresses?.OrderBy(a => a.StartsWith("https", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .FirstOrDefault();
            if (string.IsNullOrEmpty(address))
            {
                return null;
            }

            return address.Replace("//+", "//localhost").Replace("//*", "//localhost")
                .Replace("//[::]", "//localhost").Replace("//0.0.0.0", "//localhost")
                .TrimEnd('/');
        }
    }
}
