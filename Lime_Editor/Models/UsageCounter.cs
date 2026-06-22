using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Периодический счётчик потребления (этап 3.4) — обобщение прежнего AiUsage.
    // Meter: "ai" (далее "exports" и т.п.). Период — календарный месяц UTC,
    // новый месяц = новая строка, счётчик с нуля. Абсолютные ресурсы (сайты, хранилище)
    // тут НЕ считаются — они меряются COUNT/SUM по факту в EntitlementService.
    public class UsageCounter
    {
        public int Id { get; set; }
        public OwnerKind OwnerKind { get; set; }
        public int OwnerId { get; set; }
        public string Meter { get; set; }
        public DateTime PeriodStart { get; set; }
        public int Used { get; set; }

        public static DateTime CurrentPeriod(DateTime utcNow)
            => new(utcNow.Year, utcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
    }
}
