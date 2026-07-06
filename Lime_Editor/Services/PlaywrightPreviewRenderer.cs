#nullable enable
using Microsoft.Extensions.Logging;
using Microsoft.Playwright;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Headless-Chromium рендер превью через Microsoft.Playwright. Singleton: один браузер
    // на процесс, страницы одноразовые. Если браузер не установлен (прод-образ без Chromium) —
    // самовыключается после первой неудачи запуска и больше не пытается до рестарта.
    public sealed class PlaywrightPreviewRenderer : ISitePreviewRenderer, IAsyncDisposable
    {
        private readonly ILogger<PlaywrightPreviewRenderer> _logger;
        private readonly SemaphoreSlim _gate = new(1, 1);
        private IPlaywright? _playwright;
        private IBrowser? _browser;
        private bool _disabled;

        public PlaywrightPreviewRenderer(ILogger<PlaywrightPreviewRenderer> logger)
        {
            _logger = logger;
        }

        public async Task<byte[]?> RenderPngAsync(string url, int width, int height, CancellationToken ct = default)
        {
            if (_disabled) return null;

            await _gate.WaitAsync(ct);
            try
            {
                if (_browser == null)
                {
                    try
                    {
                        _playwright ??= await Playwright.CreateAsync();
                        _browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = true });
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        // Chromium отсутствует (см. .env.example про PREVIEW_ENABLED) — фича мягко выключается.
                        _disabled = true;
                        _logger.LogWarning(ex, "Превью-рендер недоступен (Chromium не установлен?) — скриншоты публикаций выключены до рестарта");
                        return null;
                    }
                }

                var page = await _browser.NewPageAsync(new BrowserNewPageOptions
                {
                    ViewportSize = new ViewportSize { Width = width, Height = height },
                    IgnoreHTTPSErrors = true, // dev-сертификат localhost
                });
                try
                {
                    // Load, не NetworkIdle: страницы с embed'ами (YouTube и т.п.) держат сеть
                    // занятой бесконечно — networkidle на них просто не наступает.
                    await page.GotoAsync(url, new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.Load,
                        Timeout = 15000,
                    });
                    // Reveal-анимации (GSAP) стартуют по IntersectionObserver — на скриншоте контент
                    // остался бы полупрозрачным. Гасим анимации и форсим видимость (как visual-тесты).
                    await page.AddStyleTagAsync(new PageAddStyleTagOptions
                    {
                        Content = "*,*::before,*::after{animation:none!important;transition:none!important}" +
                                  "[data-anim]{opacity:1!important;transform:none!important;visibility:visible!important}",
                    });
                    await page.WaitForTimeoutAsync(800); // шрифты/картинки первого экрана
                    return await page.ScreenshotAsync(new PageScreenshotOptions { Type = ScreenshotType.Png });
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Ошибка конкретной страницы (таймаут/редирект) — не выключаем рендер целиком.
                    _logger.LogWarning(ex, "Не удалось снять превью {Url}", url);
                    return null;
                }
                finally
                {
                    await page.CloseAsync();
                }
            }
            finally
            {
                _gate.Release();
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (_browser != null) await _browser.DisposeAsync();
            _playwright?.Dispose();
            _gate.Dispose();
        }
    }
}
