using Microsoft.AspNetCore.Http;

namespace Lime_Editor.Services
{
    // Результат проверки вебхука провайдера: подпись валидна + извлечённый id события
    // (ключ идемпотентности) и тип.
    public sealed class WebhookResult
    {
        public bool Valid { get; init; }
        public string EventId { get; init; }
        public string Type { get; init; }
    }

    // Абстракция платёжного провайдера (этап 3.4). Реального провайдера (ЮKassa и т.п.)
    // подключим позже — поменяется реализация, не код контроллера. Подпись вебхука
    // проверяется здесь (это и есть аутентификация вебхука; CSRF/cookie не применяются).
    public interface IPaymentProvider
    {
        string Name { get; }
        WebhookResult VerifyAndParse(string rawBody, IHeaderDictionary headers);
    }

    // Пока платежей нет: вебхуки не принимаем (Valid=false), планы выдаёт админ вручную.
    // Безопасный скелет (дедуп/журнал) уже на месте — при подключении провайдера здесь
    // появится реальная проверка подписи и разбор тела.
    public class ManualPaymentProvider : IPaymentProvider
    {
        public string Name => "manual";

        public WebhookResult VerifyAndParse(string rawBody, IHeaderDictionary headers)
            => new WebhookResult { Valid = false };
    }
}
