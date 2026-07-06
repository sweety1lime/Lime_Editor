using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 3.4: тарифы/лимиты. EntitlementService — единственная точка резолва плана и квот.
    public class EntitlementServiceTests
    {
        // InMemory-контекст с засеянными тарифами (как HasData; страхуемся ручным сидом).
        private static LimeEditorContext NewDb()
        {
            var opts = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("ent_" + Guid.NewGuid().ToString("N"))
                .Options;
            var db = new LimeEditorContext(opts);
            db.Database.EnsureCreated();
            if (!db.Plans.Any())
            {
                db.Plans.AddRange(
                    new Plan { Code = "free", Name = "Free", Currency = "RUB", MaxSites = 3, MonthlyAiCredits = 10, MaxStorageMb = 100, AllowExport = false },
                    new Plan { Code = "pro", Name = "Pro", Currency = "RUB", MaxSites = 25, MonthlyAiCredits = 300, MaxStorageMb = 5120, AllowExport = true });
                db.SaveChanges();
            }
            return db;
        }

        // Сервис с конфигом: бета-флаг Entitlements:BetaUnlockPro по умолчанию выключен.
        private static EntitlementService NewSvc(LimeEditorContext db, bool betaUnlockPro = false)
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string>
            {
                ["Entitlements:BetaUnlockPro"] = betaUnlockPro ? "true" : "false",
            }).Build();
            return new EntitlementService(db, config);
        }

        [Fact]
        public async Task ResolvePlan_NoSubscription_ReturnsFree()
        {
            using var db = NewDb();
            var svc = NewSvc(db);
            var plan = await svc.ResolvePlanAsync(OwnerRef.ForUser(1));
            Assert.Equal("free", plan.Code);
        }

        [Fact]
        public async Task ResolvePlan_ActiveSubscription_ReturnsThatPlan()
        {
            using var db = NewDb();
            db.Subscriptions.Add(new Subscription
            {
                OwnerKind = OwnerKind.User, OwnerId = 7, PlanCode = "pro", Status = SubscriptionStatus.Active,
                CurrentPeriodStart = DateTime.UtcNow, CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                Provider = "manual", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            db.SaveChanges();
            var svc = NewSvc(db);
            Assert.Equal("pro", (await svc.ResolvePlanAsync(OwnerRef.ForUser(7))).Code);
        }

        [Fact]
        public async Task ResolvePlan_ExpiredSubscription_FallsBackToFree()
        {
            using var db = NewDb();
            db.Subscriptions.Add(new Subscription
            {
                OwnerKind = OwnerKind.User, OwnerId = 7, PlanCode = "pro", Status = SubscriptionStatus.Active,
                CurrentPeriodStart = DateTime.UtcNow.AddDays(-60), CurrentPeriodEnd = DateTime.UtcNow.AddDays(-1),
                Provider = "manual", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            db.SaveChanges();
            var svc = NewSvc(db);
            Assert.Equal("free", (await svc.ResolvePlanAsync(OwnerRef.ForUser(7))).Code);
        }

        [Fact]
        public async Task Usage_Increment_TracksAgainstPlanLimit()
        {
            using var db = NewDb();
            var svc = NewSvc(db);
            var owner = OwnerRef.ForUser(3);

            var before = await svc.GetUsageAsync(owner, "ai");
            Assert.Equal(0, before.Used);
            Assert.Equal(10, before.Limit); // free

            await svc.IncrementAsync(owner, "ai");
            await svc.IncrementAsync(owner, "ai");

            Assert.Equal(2, (await svc.GetUsageAsync(owner, "ai")).Used);
        }

        [Fact]
        public async Task BetaUnlockPro_FreeUser_ResolvesProPlan()
        {
            using var db = NewDb();
            var svc = NewSvc(db, betaUnlockPro: true);
            var plan = await svc.ResolvePlanAsync(OwnerRef.ForUser(1));

            Assert.Equal("pro", plan.Code);
            Assert.True(plan.AllowExport); // экспорт/GitHub-деплой доступны на бете
        }

        [Fact]
        public async Task BetaUnlockPro_PaidSubscription_Unaffected()
        {
            using var db = NewDb();
            // План business уже засеян HasData (EnsureCreated) — добавлять не нужно.
            db.Subscriptions.Add(new Subscription
            {
                OwnerKind = OwnerKind.User, OwnerId = 8, PlanCode = "business", Status = SubscriptionStatus.Active,
                CurrentPeriodStart = DateTime.UtcNow, CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                Provider = "manual", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            db.SaveChanges();
            var svc = NewSvc(db, betaUnlockPro: true);

            // Флаг апгрейдит только Free — реальная платная подписка остаётся своей.
            Assert.Equal("business", (await svc.ResolvePlanAsync(OwnerRef.ForUser(8))).Code);
        }

        [Fact]
        public async Task CanCreateSite_RespectsMaxSites()
        {
            using var db = NewDb();
            for (var i = 0; i < 3; i++) // free.MaxSites = 3
                db.Sites.Add(new Site { Name = "s" + i, UserId = 5, Folder = "x", TemplateId = 4 });
            db.SaveChanges();
            var svc = NewSvc(db);

            Assert.False(await svc.CanCreateSiteAsync(OwnerRef.ForUser(5))); // лимит выбран
            Assert.True(await svc.CanCreateSiteAsync(OwnerRef.ForUser(6)));  // 0 сайтов
        }
    }
}
