using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Authorize(Roles = Program.AdminRole)]
    public class AdminController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly Services.IDocumentRenderer _docRenderer;

        public AdminController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            Services.IDocumentRenderer docRenderer)
        {
            db = context;
            _userManager = userManager;
            _docRenderer = docRenderer;
        }

        // Пересборка всех опубликованных сайтов движка B из их JSON-снапшотов (этап 0.2).
        // Нужна после правок рендерера/разметки блоков: фиксы доезжают до уже
        // опубликованных страниц без пересохранения каждым пользователем.
        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> RepublishAll()
        {
            // Админ оперирует сайтами всех пользователей — обходим tenant-фильтр.
            var sites = await db.Sites.IgnoreQueryFilters()
                .Where(s => s.IsPublished && s.PublishedDocumentJson != null)
                .ToListAsync();
            var ok = 0;
            var failed = 0;
            foreach (var site in sites)
            {
                try
                {
                    var body = _docRenderer.RenderSite(site.PublishedDocumentJson);
                    site.Folder = Services.PublishedPageBuilder.WrapCustomHtml(body, site, site.PublishedDocumentJson);
                    ok++;
                }
                catch
                {
                    // Битый документ не должен ронять пересборку остальных.
                    failed++;
                }
            }
            await db.SaveChangesAsync();
            TempData["AdminMessage"] = failed == 0
                ? $"Пересобрано сайтов: {ok}."
                : $"Пересобрано: {ok}, с ошибками: {failed}.";
            return RedirectToAction(nameof(Index));
        }

        public async Task<IActionResult> Index()
        {
            // Админ-дашборд считает сайты всех пользователей — обходим tenant-фильтр.
            var publishedCount = await db.Sites.IgnoreQueryFilters().CountAsync(s => s.IsPublished);
            var sitesCount = await db.Sites.IgnoreQueryFilters().CountAsync();
            var usersCount = await db.Users.CountAsync();
            var adminsCount = await (
                from ur in db.UserRoles
                join r in db.Roles on ur.RoleId equals r.Id
                where r.Name == Program.AdminRole
                select ur.UserId
            ).CountAsync();

            return View(new AdminDashboardModel
            {
                UsersTotal = usersCount,
                SitesTotal = sitesCount,
                PublishedSitesTotal = publishedCount,
                AdminsTotal = adminsCount,
            });
        }

        public async Task<IActionResult> Users()
        {
            // Один запрос с подсчётом сайтов и флагом Admin через subquery.
            var adminUserIds = await (
                from ur in db.UserRoles
                join r in db.Roles on ur.RoleId equals r.Id
                where r.Name == Program.AdminRole
                select ur.UserId
            ).ToListAsync();

            var rows = await (
                from u in db.Users
                select new AdminUserRow
                {
                    Id = u.Id,
                    UserName = u.UserName,
                    Email = u.Email,
                    SitesCount = db.Sites.IgnoreQueryFilters().Count(s => s.UserId == u.Id),
                }
            ).ToListAsync();

            // Текущий тариф каждого пользователя (этап 3.4): нет подписки → free.
            var planByUser = await db.Subscriptions
                .Where(s => s.OwnerKind == OwnerKind.User)
                .ToDictionaryAsync(s => s.OwnerId, s => s.PlanCode);
            var planCodes = await db.Plans.OrderBy(p => p.PriceMonthly).Select(p => p.Code).ToListAsync();

            foreach (var r in rows)
            {
                r.IsAdmin = adminUserIds.Contains(r.Id);
                r.PlanCode = planByUser.TryGetValue(r.Id, out var pc) ? pc : "free";
            }

            return View(new AdminUsersViewModel { Users = rows, PlanCodes = planCodes });
        }

        // Ручная выдача тарифа (этап 3.4). Платежей пока нет — так включаем Pro/Business
        // на тест. days=null → бессрочно; иначе период до now+days.
        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> SetPlan(int userId, string planCode, int? days)
        {
            var plan = await db.Plans.FindAsync(planCode);
            if (plan == null)
            {
                TempData["Error"] = "Нет такого тарифа.";
                return RedirectToAction(nameof(Users));
            }

            var now = System.DateTime.UtcNow;
            var sub = await db.Subscriptions
                .FirstOrDefaultAsync(s => s.OwnerKind == OwnerKind.User && s.OwnerId == userId);
            if (sub == null)
            {
                sub = new Subscription { OwnerKind = OwnerKind.User, OwnerId = userId, CreatedAt = now };
                db.Subscriptions.Add(sub);
            }
            sub.PlanCode = planCode;
            sub.Status = SubscriptionStatus.Active;
            sub.CurrentPeriodStart = now;
            sub.CurrentPeriodEnd = days.HasValue ? now.AddDays(days.Value) : (System.DateTime?)null;
            sub.Provider = "manual";
            sub.UpdatedAt = now;
            await db.SaveChangesAsync();

            TempData["AdminMessage"] = $"Тариф «{planCode}» выдан пользователю #{userId}.";
            return RedirectToAction(nameof(Users));
        }

        public async Task<IActionResult> Sites()
        {
            var rows = await (
                from s in db.Sites.IgnoreQueryFilters()
                join u in db.Users on s.UserId equals u.Id
                join t in db.Templates on s.TemplateId equals t.IdTemplate into tj
                from t in tj.DefaultIfEmpty()
                orderby s.IdSite descending
                select new AdminSiteRow
                {
                    Id = s.IdSite.Value,
                    Name = s.Name,
                    Slug = s.Slug,
                    IsPublished = s.IsPublished,
                    OwnerUserName = u.UserName,
                    OwnerId = u.Id,
                    TemplateName = t != null ? t.Name : "—",
                }
            ).ToListAsync();

            return View(new AdminSitesViewModel { Sites = rows });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> ToggleAdmin(int userId)
        {
            // Защита: текущий админ не может снять роль с самого себя случайно — иначе можно остаться без админа.
            var currentUserId = int.Parse(_userManager.GetUserId(User));
            var user = await _userManager.FindByIdAsync(userId.ToString());
            if (user == null)
            {
                return NotFound();
            }
            var isAdmin = await _userManager.IsInRoleAsync(user, Program.AdminRole);
            if (isAdmin && user.Id == currentUserId)
            {
                TempData["Error"] = "Нельзя снять с себя роль Admin.";
                return RedirectToAction(nameof(Users));
            }
            if (isAdmin)
            {
                await _userManager.RemoveFromRoleAsync(user, Program.AdminRole);
            }
            else
            {
                await _userManager.AddToRoleAsync(user, Program.AdminRole);
            }
            return RedirectToAction(nameof(Users));
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> DeleteUser(int userId)
        {
            var currentUserId = int.Parse(_userManager.GetUserId(User));
            if (userId == currentUserId)
            {
                TempData["Error"] = "Нельзя удалить самого себя.";
                return RedirectToAction(nameof(Users));
            }
            var user = await _userManager.FindByIdAsync(userId.ToString());
            if (user == null)
            {
                return NotFound();
            }
            // Сайты удалятся каскадом по FK на ApplicationUser.
            await _userManager.DeleteAsync(user);
            return RedirectToAction(nameof(Users));
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> DeleteSite(int idSite)
        {
            // Админ удаляет любой сайт — обходим tenant-фильтр.
            var site = await db.Sites.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.IdSite == idSite);
            if (site == null)
            {
                return NotFound();
            }
            db.Sites.Remove(site);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Sites));
        }
    }
}
