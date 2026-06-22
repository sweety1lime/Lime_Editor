using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Lime_Editor.Controllers
{
    // Тарифы пользователя (этап 3.4). Index — текущий план + использование; Webhook —
    // безопасный приём событий провайдера (подпись + идемпотентность). Реальную оплату
    // подключим позже; планы пока выдаёт админ (AdminController.SetPlan).
    [Authorize]
    public class BillingController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IEntitlementService _entitlements;
        private readonly IPaymentProvider _payments;
        private readonly IBillingService _billing;

        public BillingController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            IEntitlementService entitlements,
            IPaymentProvider payments,
            IBillingService billing)
        {
            db = context;
            _userManager = userManager;
            _entitlements = entitlements;
            _payments = payments;
            _billing = billing;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        public async Task<IActionResult> Index()
        {
            var owner = OwnerRef.ForUser(CurrentUserId);
            var plan = await _entitlements.ResolvePlanAsync(owner);
            var ai = await _entitlements.GetUsageAsync(owner, "ai");
            var sites = await db.Sites.CountAsync(s => s.UserId == CurrentUserId);
            var storageBytes = await db.MediaAssets.Where(m => m.UserId == CurrentUserId).SumAsync(m => (long?)m.SizeBytes) ?? 0L;
            var plans = await db.Plans.AsNoTracking().OrderBy(p => p.PriceMonthly).ToListAsync();

            return View(new BillingViewModel
            {
                Plan = plan,
                AiUsed = ai.Used,
                AiLimit = ai.Limit,
                SitesUsed = sites,
                StorageUsedMb = storageBytes / 1024 / 1024,
                AllPlans = plans,
            });
        }

        // Приём вебхуков провайдера. Анонимно (зовёт сервер провайдера) и без antiforgery —
        // аутентификация = проверка подписи в IPaymentProvider. Идемпотентность по BillingEvent.
        [HttpPost]
        [AllowAnonymous]
        [IgnoreAntiforgeryToken]
        [EnableRateLimiting("public-write")]
        public async Task<IActionResult> Webhook()
        {
            string body;
            using (var reader = new StreamReader(Request.Body, Encoding.UTF8))
            {
                body = await reader.ReadToEndAsync();
            }

            var res = _payments.VerifyAndParse(body, Request.Headers);
            if (!res.Valid || string.IsNullOrEmpty(res.EventId))
            {
                return BadRequest();
            }

            var isNew = await _billing.TryRecordEventAsync(_payments.Name, res.EventId, res.Type, body);
            if (!isNew)
            {
                return Ok(new { duplicate = true }); // повтор доставки — уже обработано
            }

            // TODO(3.4): применить событие к подписке, когда подключим реального провайдера.
            return Ok();
        }
    }
}
