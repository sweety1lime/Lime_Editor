using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Microsoft.EntityFrameworkCore;

namespace Lime_Editor.Services
{
    // Реализация тарифов/лимитов (этап 3.4). Scoped — использует LimeEditorContext.
    public class EntitlementService : IEntitlementService
    {
        public const string FreePlanCode = "free";

        // Страховка: если тарифы почему-то не засеяны (свежая БД до миграции, кривой сид) —
        // не роняем приложение NRE, а отдаём встроенный Free.
        private static readonly Plan DefaultFreePlan = new Plan
        {
            Code = FreePlanCode, Name = "Free", Currency = "RUB",
            MaxSites = 3, MonthlyAiCredits = 10, MaxStorageMb = 100,
            MaxCustomDomains = 0, AllowExport = false, AllowCustomCode = false, FeaturesJson = "{}",
        };

        private readonly LimeEditorContext _db;

        public EntitlementService(LimeEditorContext db)
        {
            _db = db;
        }

        // План владельца: активная/триал подписка с непросроченным периодом → её план,
        // иначе Free. Если Free почему-то не засидился — вернём null (вызов упадёт явно).
        public async Task<Plan> ResolvePlanAsync(OwnerRef owner, CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var sub = await _db.Subscriptions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.OwnerKind == owner.Kind && s.OwnerId == owner.Id, ct);

            var code = FreePlanCode;
            if (sub != null
                && (sub.Status == SubscriptionStatus.Active || sub.Status == SubscriptionStatus.Trialing)
                && (sub.CurrentPeriodEnd == null || sub.CurrentPeriodEnd > now))
            {
                code = sub.PlanCode;
            }

            return await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code, ct)
                   ?? await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Code == FreePlanCode, ct)
                   ?? DefaultFreePlan;
        }

        private static int MeterLimit(Plan plan, string meter) => meter switch
        {
            "ai" => plan.MonthlyAiCredits,
            _ => 0,
        };

        public async Task<UsageStatus> GetUsageAsync(OwnerRef owner, string meter, CancellationToken ct = default)
        {
            var plan = await ResolvePlanAsync(owner, ct);
            var period = UsageCounter.CurrentPeriod(DateTime.UtcNow);
            var row = await _db.UsageCounters.AsNoTracking().FirstOrDefaultAsync(
                u => u.OwnerKind == owner.Kind && u.OwnerId == owner.Id && u.Meter == meter && u.PeriodStart == period, ct);
            return new UsageStatus { Used = row?.Used ?? 0, Limit = MeterLimit(plan, meter) };
        }

        public async Task IncrementAsync(OwnerRef owner, string meter, int n = 1, CancellationToken ct = default)
        {
            var period = UsageCounter.CurrentPeriod(DateTime.UtcNow);
            var row = await _db.UsageCounters.FirstOrDefaultAsync(
                u => u.OwnerKind == owner.Kind && u.OwnerId == owner.Id && u.Meter == meter && u.PeriodStart == period, ct);
            if (row == null)
            {
                row = new UsageCounter
                {
                    OwnerKind = owner.Kind,
                    OwnerId = owner.Id,
                    Meter = meter,
                    PeriodStart = period,
                    Used = 0,
                };
                _db.UsageCounters.Add(row);
            }
            row.Used += n;
            await _db.SaveChangesAsync(ct);
        }

        // Абсолютный лимит сайтов. Сейчас owner = пользователь → считаем его сайты.
        public async Task<bool> CanCreateSiteAsync(OwnerRef owner, CancellationToken ct = default)
        {
            var plan = await ResolvePlanAsync(owner, ct);
            if (plan.MaxSites < 0) return true;
            // Считаем сайты ЯВНО заданного owner (не текущего посетителя) — обходим tenant-фильтр.
            var count = await _db.Sites.IgnoreQueryFilters().CountAsync(s => s.UserId == owner.Id, ct);
            return count < plan.MaxSites;
        }

        // Абсолютный лимит хранилища (сумма размеров медиа владельца + новый файл).
        public async Task<bool> CanUploadAsync(OwnerRef owner, long extraBytes, CancellationToken ct = default)
        {
            var plan = await ResolvePlanAsync(owner, ct);
            if (plan.MaxStorageMb < 0) return true;
            var used = await _db.MediaAssets.Where(m => m.UserId == owner.Id).SumAsync(m => (long?)m.SizeBytes, ct) ?? 0L;
            return used + extraBytes <= (long)plan.MaxStorageMb * 1024 * 1024;
        }
    }
}
