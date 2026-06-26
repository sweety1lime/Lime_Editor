using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // AI-эндпоинты конструктора (этап 2). Ключ провайдера живёт только на сервере;
    // квота берётся из тарифа пользователя (этап 3.4, EntitlementService, метр "ai")
    // и тратится только при успешной генерации.
    [Authorize]
    [EnableRateLimiting("ai")] // burst-guard поверх квоты тарифа; партиция — по пользователю
    public class AiController : Controller
    {
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly AiContentService _ai;
        private readonly IEntitlementService _entitlements;
        private readonly ILogger<AiController> _logger;
        private readonly int _maxTokens;
        private const string Meter = "ai";

        public AiController(
            UserManager<ApplicationUser> userManager,
            AiContentService ai,
            IEntitlementService entitlements,
            IConfiguration config,
            ILogger<AiController> logger)
        {
            _userManager = userManager;
            _ai = ai;
            _entitlements = entitlements;
            _logger = logger;
            _maxTokens = config.GetValue("Ai:MaxTokens", 4000);
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));
        private OwnerRef Owner => OwnerRef.ForUser(CurrentUserId);

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

            var usage = await _entitlements.GetUsageAsync(Owner, Meter);
            if (usage.Used >= usage.Limit)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = usage.Limit });
            }

            try
            {
                var blocksJson = await _ai.GenerateLandingAsync(prompt.Trim(), _maxTokens, HttpContext.RequestAborted);
                await _entitlements.IncrementAsync(Owner, Meter);
                return Content(
                    $"{{\"blocks\":{blocksJson},\"used\":{usage.Used + 1},\"limit\":{usage.Limit}}}",
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

            var usage = await _entitlements.GetUsageAsync(Owner, Meter);
            if (usage.Used >= usage.Limit)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = usage.Limit });
            }

            try
            {
                var result = await _ai.RewriteTextAsync(text, instruction.Trim(), HttpContext.RequestAborted);
                await _entitlements.IncrementAsync(Owner, Meter);
                return Json(new { text = result, used = usage.Used + 1, limit = usage.Limit });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI rewrite failed for user {UserId}", CurrentUserId);
                return StatusCode(502, new { error = "ai_failed" });
            }
        }

        // Правка выделенного блока/секции по промпту (этап 2.1). Клиент шлёт поддерево
        // блока (content + children); сервер переписывает только тексты и возвращает блок.
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> EditBlock(string block, string instruction)
        {
            if (string.IsNullOrWhiteSpace(block) || block.Length > 20000 ||
                string.IsNullOrWhiteSpace(instruction) || instruction.Length > 300)
            {
                return BadRequest(new { error = "input" });
            }
            if (!_ai.IsConfigured)
            {
                return StatusCode(503, new { error = "not_configured" });
            }

            var usage = await _entitlements.GetUsageAsync(Owner, Meter);
            if (usage.Used >= usage.Limit)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = usage.Limit });
            }

            try
            {
                var edited = await _ai.EditBlockAsync(block, instruction.Trim(), _maxTokens, HttpContext.RequestAborted);
                if (edited == null)
                {
                    return UnprocessableEntity(new { error = "no_text" }); // в блоке нет текста для правки
                }
                await _entitlements.IncrementAsync(Owner, Meter);
                return Content(
                    $"{{\"block\":{edited},\"used\":{usage.Used + 1},\"limit\":{usage.Limit}}}",
                    "application/json");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI edit failed for user {UserId}", CurrentUserId);
                return StatusCode(502, new { error = "ai_failed" });
            }
        }

        // Правка по промпту через СПИСОК КОМАНД (этап 10.2). Клиент шлёт контекст (выбранное
        // поддерево + тема), сервер просит модель вернуть валидируемые команды. Клиент re-валидирует
        // и применяет одной undo-транзакцией с подтверждением — некорректный ответ не портит документ.
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Suggest(string context, string instruction, string breakpoint = null)
        {
            if (string.IsNullOrWhiteSpace(context) || context.Length > 20000 ||
                string.IsNullOrWhiteSpace(instruction) || instruction.Length > 300)
            {
                return BadRequest(new { error = "input" });
            }
            // breakpoint = tablet|mobile → Responsive-AI (адаптация без правки десктопа); иначе обычная правка.
            var responsive = breakpoint == "tablet" || breakpoint == "mobile";
            if (!_ai.IsConfigured)
            {
                return StatusCode(503, new { error = "not_configured" });
            }

            var usage = await _entitlements.GetUsageAsync(Owner, Meter);
            if (usage.Used >= usage.Limit)
            {
                return StatusCode(429, new { error = "quota", used = usage.Used, limit = usage.Limit });
            }

            try
            {
                var commands = responsive
                    ? await _ai.SuggestResponsiveAsync(context, instruction.Trim(), breakpoint, _maxTokens, HttpContext.RequestAborted)
                    : await _ai.SuggestCommandsAsync(context, instruction.Trim(), _maxTokens, HttpContext.RequestAborted);
                await _entitlements.IncrementAsync(Owner, Meter);
                return Content(
                    $"{{\"commands\":{commands},\"used\":{usage.Used + 1},\"limit\":{usage.Limit}}}",
                    "application/json");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI suggest failed for user {UserId}", CurrentUserId);
                return StatusCode(502, new { error = "ai_failed" });
            }
        }

        // Остаток квоты — для бейджа в модалке.
        [HttpGet]
        public async Task<IActionResult> Quota()
        {
            var usage = await _entitlements.GetUsageAsync(Owner, Meter);
            return Json(new { used = usage.Used, limit = usage.Limit, configured = _ai.IsConfigured });
        }
    }
}
