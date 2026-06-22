using System;

#nullable disable

namespace Lime_Editor.Models
{
    public enum SubscriptionStatus : byte
    {
        Trialing = 0,
        Active = 1,
        PastDue = 2,
        Canceled = 3,
        Expired = 4,
    }

    // Подписка владельца на тариф (этап 3.4). Нет строки → Free (резолвится лениво
    // в EntitlementService). Один активный план на владельца (уникальный индекс).
    public class Subscription
    {
        public int Id { get; set; }
        public OwnerKind OwnerKind { get; set; }
        public int OwnerId { get; set; }
        public string PlanCode { get; set; }       // FK → Plan.Code
        public SubscriptionStatus Status { get; set; }

        public DateTime CurrentPeriodStart { get; set; }
        public DateTime? CurrentPeriodEnd { get; set; }   // null = бессрочно (ручная выдача)
        public bool CancelAtPeriodEnd { get; set; }

        // Заполняется при подключении реального провайдера (ЮKassa и т.п.). Пока "manual".
        public string Provider { get; set; }
        public string ExternalCustomerId { get; set; }
        public string ExternalSubscriptionId { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
