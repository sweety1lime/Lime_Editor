#nullable enable
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Фоновый воркер превью: publish кладёт siteId в SitePreviewQueue, здесь — рендер и запись.
    // Publish-запрос не ждёт браузер; ошибка одного превью не трогает остальные.
    public sealed class SitePreviewWorker : BackgroundService
    {
        private readonly IServiceProvider _services;
        private readonly SitePreviewQueue _queue;
        private readonly IConfiguration _config;
        private readonly ILogger<SitePreviewWorker> _logger;

        public SitePreviewWorker(
            IServiceProvider services,
            SitePreviewQueue queue,
            IConfiguration config,
            ILogger<SitePreviewWorker> logger)
        {
            _services = services;
            _queue = queue;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_config.GetValue("Preview:Enabled", true))
            {
                return;
            }

            await foreach (var siteId in _queue.ReadAllAsync(stoppingToken))
            {
                try
                {
                    using var scope = _services.CreateScope();
                    var svc = scope.ServiceProvider.GetRequiredService<SitePreviewService>();
                    await svc.RenderAndStoreAsync(siteId, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Превью сайта {SiteId} не удалось", siteId);
                }
            }
        }
    }
}
