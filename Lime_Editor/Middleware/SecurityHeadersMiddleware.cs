using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System;

namespace Lime_Editor.Middleware
{
    // Security-заголовки (бэклог безопасности из ROADMAP). Базовые заголовки — на все ответы;
    // строгий CSP — только на публичные страницы /u/{user}/{slug} (это поверхность stored-XSS:
    // чужой контент на одном origin с Identity-cookie). Это «in-code» половина пункта
    // «отдельный домен + CSP»; вынос публикаций на отдельный домен — инфраструктурная вторая
    // половина (делается при деплое, см. ROADMAP «Бэклог безопасности»).
    public static class SecurityHeadersMiddleware
    {
        private const string CspReportUri = "; report-uri /Security/CspReport";

        // CSP для публичных страниц.
        //  - script-src ТОЛЬКО 'self' и БЕЗ 'unsafe-inline': движок lime-doc.js не эмитит
        //    inline-скриптов, все рантаймы (включая GSAP) — self-hosted из /js/*, поэтому это
        //    не ломает страницу, но блокирует инъекции <script>/on*-атрибутов из пользовательского
        //    контента (stored-XSS). ВАЖНО: CDN-хостов в script-src быть не должно — разрешённый
        //    cdn.jsdelivr.net означал бы «любой npm-пакет», т.е. обход CSP через кастомный <head>
        //    Pro-тарифа (произвольный JS на одном origin с Identity-cookie посетителей).
        //  - style-src с 'unsafe-inline' ОБЯЗАТЕЛЕН: движок эмитит <style> и style="" из
        //    темы/классов/блоков; nonce тут не применим (стили генерятся одинаково в 3 местах).
        //  - frame-src https: и img-src https: — для пользовательских embed-сцен (sandbox-iframe),
        //    YouTube и картинок из медиа/фотостока/OG.
        private const string PublishedCsp =
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src 'self' data: blob: https:; " +
            "media-src 'self' https: data:; " +
            "frame-src https:; " +
            "connect-src 'self'; " +
            "form-action 'self'; " +
            "base-uri 'self'; " +
            "object-src 'none'; " +
            "frame-ancestors 'self'";

        private const string AppReportOnlyCsp =
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src 'self' data: blob: https:; " +
            "media-src 'self' https: data:; " +
            "frame-src 'self' https:; " +
            "connect-src 'self'; " +
            "form-action 'self'; " +
            "base-uri 'self'; " +
            "object-src 'none'; " +
            "frame-ancestors 'self'";

        public static IApplicationBuilder UseLimeSecurityHeaders(this IApplicationBuilder app)
        {
            return app.Use(async (ctx, next) =>
            {
                // OnStarting: заголовки выставляются непосредственно перед отправкой, поэтому
                // переживают Response.Clear() обработчика ошибок и применяются к финальному ответу.
                var isPublished = ctx.Request.Path.StartsWithSegments("/u");
                ctx.Response.OnStarting(() =>
                {
                    var h = ctx.Response.Headers;
                    h["X-Content-Type-Options"] = "nosniff";
                    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
                    h["X-Frame-Options"] = "SAMEORIGIN";
                    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";

                    if (ctx.User?.Identity?.IsAuthenticated == true)
                    {
                        h["Cache-Control"] = "no-store, no-cache, max-age=0";
                        h["Pragma"] = "no-cache";
                        h["Expires"] = "Thu, 01 Jan 1970 00:00:00 GMT";
                    }

                    if (isPublished)
                    {
                        h["Content-Security-Policy"] = PublishedCsp + CspReportUri;
                    }
                    else if (IsHtmlResponse(ctx))
                    {
                        h["Content-Security-Policy-Report-Only"] = AppReportOnlyCsp + CspReportUri;
                    }
                    return System.Threading.Tasks.Task.CompletedTask;
                });

                await next();
            });
        }

        private static bool IsHtmlResponse(HttpContext ctx)
        {
            var contentType = ctx.Response.ContentType;
            return !string.IsNullOrEmpty(contentType) &&
                   contentType.IndexOf("text/html", StringComparison.OrdinalIgnoreCase) >= 0;
        }
    }
}
