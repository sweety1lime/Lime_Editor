using System;
using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Microsoft.EntityFrameworkCore;

namespace Lime_Editor.Services
{
    public interface IBillingService
    {
        // Идемпотентная запись вебхука: true — новое событие (нужно обработать),
        // false — повтор (уже видели, пропускаем).
        Task<bool> TryRecordEventAsync(string provider, string eventId, string type, string payload, CancellationToken ct = default);
    }

    public class BillingService : IBillingService
    {
        private readonly LimeEditorContext _db;

        public BillingService(LimeEditorContext db)
        {
            _db = db;
        }

        public async Task<bool> TryRecordEventAsync(string provider, string eventId, string type, string payload, CancellationToken ct = default)
        {
            var exists = await _db.BillingEvents
                .AnyAsync(e => e.Provider == provider && e.ProviderEventId == eventId, ct);
            if (exists) return false;

            _db.BillingEvents.Add(new BillingEvent
            {
                Provider = provider,
                ProviderEventId = eventId,
                Type = type,
                Payload = payload,
                Status = "received",
                ReceivedAt = DateTime.UtcNow,
            });
            try
            {
                await _db.SaveChangesAsync(ct);
                return true;
            }
            catch (DbUpdateException)
            {
                // Гонка двух доставок: уникальный индекс (Provider, ProviderEventId) отсёк дубль.
                return false;
            }
        }
    }
}
