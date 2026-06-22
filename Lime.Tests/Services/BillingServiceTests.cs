using System;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 3.4: идемпотентный приём вебхуков платёжного провайдера.
    public class BillingServiceTests
    {
        private static LimeEditorContext NewDb()
        {
            var opts = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("bill_" + Guid.NewGuid().ToString("N"))
                .Options;
            var db = new LimeEditorContext(opts);
            db.Database.EnsureCreated();
            return db;
        }

        [Fact]
        public async Task TryRecordEvent_FirstTrue_DuplicateFalse()
        {
            using var db = NewDb();
            var svc = new BillingService(db);
            Assert.True(await svc.TryRecordEventAsync("yookassa", "evt-1", "payment.succeeded", "{}"));
            Assert.False(await svc.TryRecordEventAsync("yookassa", "evt-1", "payment.succeeded", "{}")); // повтор доставки
            Assert.Equal(1, await db.BillingEvents.CountAsync());
        }

        [Fact]
        public async Task TryRecordEvent_DifferentIds_BothRecorded()
        {
            using var db = NewDb();
            var svc = new BillingService(db);
            Assert.True(await svc.TryRecordEventAsync("yookassa", "evt-1", "t", "{}"));
            Assert.True(await svc.TryRecordEventAsync("yookassa", "evt-2", "t", "{}"));
            Assert.Equal(2, await db.BillingEvents.CountAsync());
        }
    }
}
