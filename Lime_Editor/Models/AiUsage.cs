using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Счётчик AI-генераций пользователя за календарный месяц (этап 2, freemium-квота).
    // Квота проверяется на сервере ПЕРЕД каждым вызовом провайдера.
    public class AiUsage
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        // Первый день месяца (UTC) — ключ периода. Новый месяц = новая строка, счётчик с нуля.
        public DateTime PeriodStart { get; set; }
        public int Used { get; set; }

        public static DateTime CurrentPeriod(DateTime utcNow)
            => new(utcNow.Year, utcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
    }
}
