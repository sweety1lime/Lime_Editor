using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Serilog.Context;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Middleware
{
    // Correlation-id (zero-infra часть observability из ROADMAP M1.2): каждому запросу присваивается
    // X-Request-Id — из входящего заголовка, если он безопасный, иначе генерируется. Кладётся в
    // Serilog LogContext (все логи запроса несут RequestId) и возвращается клиенту в ответе. Это
    // связывает обращение пользователя с логами уже сейчас, до подключения агрегатора/Sentry.
    public static class RequestCorrelationMiddleware
    {
        public const string HeaderName = "X-Request-Id";
        private const int MaxLength = 64;

        public static IApplicationBuilder UseLimeRequestCorrelation(this IApplicationBuilder app)
        {
            return app.Use(async (ctx, next) =>
            {
                var requestId = Sanitize(ctx.Request.Headers[HeaderName]) ?? Guid.NewGuid().ToString("N");
                ctx.TraceIdentifier = requestId;

                // OnStarting — чтобы заголовок пережил Response.Clear() обработчика ошибок.
                ctx.Response.OnStarting(() =>
                {
                    ctx.Response.Headers[HeaderName] = requestId;
                    return Task.CompletedTask;
                });

                using (LogContext.PushProperty("RequestId", requestId))
                {
                    await next();
                }
            });
        }

        // Входящий id принимаем только если он «адекватный» (буквы/цифры/-/_, до 64 символов) —
        // иначе через него можно протащить перевод строки/мусор в логи (log forging).
        private static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > MaxLength)
            {
                return null;
            }

            return value.All(c => char.IsLetterOrDigit(c) || c == '-' || c == '_') ? value : null;
        }
    }
}
