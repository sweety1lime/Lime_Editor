using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Журнал вебхуков платёжного провайдера (этап 3.4): идемпотентность + аудит.
    // ProviderEventId уникален в паре с Provider — повторная доставка вебхука НЕ
    // обрабатывается дважды (защита от replay). Реальный провайдер подключим позже,
    // но безопасный скелет (подпись + дедуп) строим сразу.
    public class BillingEvent
    {
        public int Id { get; set; }
        public string Provider { get; set; }         // "yookassa" | "manual" | ...
        public string ProviderEventId { get; set; }  // id события у провайдера (ключ идемпотентности)
        public string Type { get; set; }
        public string Payload { get; set; }          // сырое тело (для аудита/разбора)
        public string Status { get; set; }           // received | processed | failed
        public DateTime ReceivedAt { get; set; }
        public DateTime? ProcessedAt { get; set; }
        public string Error { get; set; }
    }
}
