using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;

namespace Lime_Editor.Services
{
    // Текущее использование метра против лимита тарифа.
    public sealed class UsageStatus
    {
        public int Used { get; set; }
        public int Limit { get; set; }
    }

    // Тарифы и лимиты (этап 3.4). Резолвит план владельца (нет подписки → Free),
    // считает периодические метры (UsageCounter) и абсолютные ресурсы (COUNT/SUM).
    public interface IEntitlementService
    {
        Task<Plan> ResolvePlanAsync(OwnerRef owner, CancellationToken ct = default);
        Task<UsageStatus> GetUsageAsync(OwnerRef owner, string meter, CancellationToken ct = default);
        Task IncrementAsync(OwnerRef owner, string meter, int n = 1, CancellationToken ct = default);
        Task<bool> CanCreateSiteAsync(OwnerRef owner, CancellationToken ct = default);
        Task<bool> CanUploadAsync(OwnerRef owner, long extraBytes, CancellationToken ct = default);
    }
}
