using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Фоновая чистка: удаляет файлы в wwwroot/media/{userId}/*, для которых нет записи в MediaAssets.
    // Защита от race condition: трогаем только файлы старше MinAge (свежий upload мог не успеть закоммитить DB).
    public sealed class OrphanMediaCleanupService : BackgroundService
    {
        private readonly IServiceProvider _services;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<OrphanMediaCleanupService> _logger;

        public static readonly TimeSpan Interval = TimeSpan.FromHours(24);
        public static readonly TimeSpan InitialDelay = TimeSpan.FromMinutes(5);
        public static readonly TimeSpan MinAge = TimeSpan.FromHours(1);

        public OrphanMediaCleanupService(
            IServiceProvider services,
            IWebHostEnvironment env,
            ILogger<OrphanMediaCleanupService> logger)
        {
            _services = services;
            _env = env;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(InitialDelay, stoppingToken); }
            catch (TaskCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _services.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
                    var mediaRoot = Path.Combine(_env.WebRootPath, Controllers.MediaController.MediaFolder);
                    var deleted = await CleanupAsync(db, mediaRoot, MinAge, stoppingToken);
                    if (deleted > 0)
                    {
                        _logger.LogInformation("Orphan media cleanup: удалено {Count} файлов", deleted);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Orphan media cleanup упал — следующий запуск через {Interval}", Interval);
                }

                try { await Task.Delay(Interval, stoppingToken); }
                catch (TaskCanceledException) { return; }
            }
        }

        // Метод выделен публичным/статичным, чтобы тесты гоняли логику напрямую без BackgroundService.
        public static async Task<int> CleanupAsync(
            LimeEditorContext db,
            string mediaRoot,
            TimeSpan minAge,
            CancellationToken ct = default)
        {
            if (!Directory.Exists(mediaRoot))
            {
                return 0;
            }

            // "Известные" файлы по составному ключу UserId/StoredFileName — точное соответствие раскладке на диске.
            var known = new HashSet<string>(
                await db.MediaAssets
                    .Select(m => m.UserId + "/" + m.StoredFileName)
                    .ToListAsync(ct),
                StringComparer.Ordinal);

            var minWriteTime = DateTime.UtcNow - minAge;
            var deleted = 0;

            foreach (var userDir in Directory.EnumerateDirectories(mediaRoot))
            {
                var userId = Path.GetFileName(userDir);
                foreach (var file in Directory.EnumerateFiles(userDir))
                {
                    ct.ThrowIfCancellationRequested();

                    var fileName = Path.GetFileName(file);
                    var key = userId + "/" + fileName;
                    if (known.Contains(key))
                    {
                        continue;
                    }

                    var info = new FileInfo(file);
                    if (info.LastWriteTimeUtc > minWriteTime)
                    {
                        // Файл свежее MinAge — возможно, ещё не успели закоммитить запись, не трогаем.
                        continue;
                    }

                    try
                    {
                        info.Delete();
                        deleted++;
                    }
                    catch (IOException)
                    {
                        // Файл занят другим процессом — попробуем в следующий заход.
                    }
                }
            }

            return deleted;
        }
    }
}
