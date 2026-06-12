using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // AI-эндпоинты конструктора (этап 2). Ключ провайдера живёт только на сервере;
    // freemium-квота проверяется ДО вызова и тратится только при успешной генерации.
    [Authorize]
    public class AiController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly AiContentService _ai;
        private readonly ILogger<AiController> _logger;
        private readonly int _quota;
        private readonly int _maxTokens;

        public AiController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            AiContentService ai,
            IConfiguration config,
            ILogger<AiController> logger)
        {
            db = context;
            _userManager = userManager;
            _ai = ai;
            _logger = logger;
            _quota = config.GetValue("Ai:MonthlyFreeQuota", 10);
            _maxTokens = config.GetValue("Ai:MaxTokens", 4000);
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Generate(string prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > 2000)
            {
                return BadRequest(new { error = "prompt" });
            }
            if (!_ai.IsConfigured)
            {
                return StatusCode(503, new { error = "not_configured" });
            }

            var usage = await GetUsageAsync();
            if (usage.Used >= _quota)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = _quota });
            }

            try
            {
                var blocksJson = await _ai.GenerateLandingAsync(prompt.Trim(), _maxTokens, HttpContext.RequestAborted);
                usage.Used++;
                await db.SaveChangesAsync();
                return Content(
                    $"{{\"blocks\":{blocksJson},\"used\":{usage.Used},\"limit\":{_quota}}}",
                    "application/json");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI generate failed for user {UserId}", CurrentUserId);
                return StatusCode(502, new { error = "ai_failed" });
            }
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Rewrite(string text, string instruction)
        {
            if (string.IsNullOrWhiteSpace(text) || text.Length > 4000 ||
                string.IsNullOrWhiteSpace(instruction) || instruction.Length > 300)
            {
                return BadRequest(new { error = "input" });
            }
            if (!_ai.IsConfigured)
            {
                return StatusCode(503, new { error = "not_configured" });
            }

            var usage = await GetUsageAsync();
            if (usage.Used >= _quota)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = _quota });
            }

            try
            {
                var result = await _ai.RewriteTextAsync(text, instruction.Trim(), HttpContext.RequestAborted);
                usage.Used++;
                await db.SaveChangesAsync();
                return Json(new { text = result, used = usage.Used, limit = _quota });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI rewrite failed for user {UserId}", CurrentUserId);
                return StatusCode(502, new { error = "ai_failed" });
            }
        }

        // Остаток квоты — для бейджа в модалке.
        [HttpGet]
        public async Task<IActionResult> Quota()
        {
            var usage = await GetUsageAsync();
            await db.SaveChangesAsync(); // фиксируем созданную строку периода, если её не было
            return Json(new { used = usage.Used, limit = _quota, configured = _ai.IsConfigured });
        }

        private async Task<AiUsage> GetUsageAsync()
        {
            var userId = CurrentUserId;
            var period = AiUsage.CurrentPeriod(DateTime.UtcNow);
            var usage = await db.AiUsages.FirstOrDefaultAsync(u => u.UserId == userId && u.PeriodStart == period);
            if (usage == null)
            {
                usage = new AiUsage { UserId = userId, PeriodStart = period, Used = 0 };
                db.AiUsages.Add(usage);
            }
            return usage;
        }
    }
}
