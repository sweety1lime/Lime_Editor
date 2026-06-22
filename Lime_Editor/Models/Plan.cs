#nullable disable

namespace Lime_Editor.Models
{
    // Тариф (этап 3.4). Каталог планов сидится миграцией (free/pro/business).
    // Лимит -1 = безлимит. Платежей пока нет — план выдаётся вручную (админ) или Free по умолчанию.
    public class Plan
    {
        public string Code { get; set; }          // PK: "free" | "pro" | "business"
        public string Name { get; set; }
        public string Description { get; set; }
        public decimal PriceMonthly { get; set; }
        public string Currency { get; set; }       // "RUB"

        public int MaxSites { get; set; }          // -1 = безлимит
        public int MonthlyAiCredits { get; set; }  // лимит метра "ai" в месяц
        public int MaxStorageMb { get; set; }      // -1 = безлимит
        public int MaxCustomDomains { get; set; }
        public bool AllowExport { get; set; }      // экспорт в Next.js
        public bool AllowCustomCode { get; set; }  // глобальный CSS/head

        public string FeaturesJson { get; set; }   // прочие флаги/мета (расширяемо без миграций)
    }
}
