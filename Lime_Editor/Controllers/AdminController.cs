using Lime_Editor.Models;
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
        public async Task<IActionResult> RepublishAll()
        {
            var sites = await db.Sites
                .Where(s => s.IsPublished && s.PublishedDocumentJson != null)
                .ToListAsync();
            var ok = 0;
            var failed = 0;
            foreach (var site in sites)
            {
                try
                {
                    var body = _docRenderer.RenderSite(site.PublishedDocumentJson);
                    site.Folder = Services.PublishedPageBuilder.WrapCustomHtml(body, site);
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
            var publishedCount = await db.Sites.CountAsync(s => s.IsPublished);
            var sitesCount = await db.Sites.CountAsync();
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
                    SitesCount = db.Sites.Count(s => s.UserId == u.Id),
                }
            ).ToListAsync();

            foreach (var r in rows)
            {
                r.IsAdmin = adminUserIds.Contains(r.Id);
            }

            return View(new AdminUsersViewModel { Users = rows });
        }

        public async Task<IActionResult> Sites()
        {
            var rows = await (
                from s in db.Sites
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
        public async Task<IActionResult> DeleteSite(int idSite)
        {
            var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == idSite);
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
