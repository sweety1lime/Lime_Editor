using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // Сообщество (этап 3): публичная галерея опубликованных сайтов, лайки,
    // «использовать как шаблон» (клонирование чужой наработки к себе).
    public class CommunityController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IDocumentRenderer _docRenderer;

        public CommunityController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            IDocumentRenderer docRenderer)
        {
            db = context;
            _userManager = userManager;
            _docRenderer = docRenderer;
        }

        private int? CurrentUserIdOrNull =>
            User?.Identity?.IsAuthenticated == true ? int.Parse(_userManager.GetUserId(User)) : null;

        // Публичная галерея. sort: new | popular.
        [AllowAnonymous]
        public async Task<IActionResult> Index(string sort = "new")
        {
            var userId = CurrentUserIdOrNull;

            var query =
                from s in db.Sites.AsNoTracking()
                join u in db.Users on s.UserId equals u.Id
                where s.IsPublished && s.ShowInGallery && s.Slug != null
                select new CommunityCard
                {
                    SiteId = s.IdSite.Value,
                    Name = s.Name,
                    Author = u.UserName,
                    Slug = s.Slug,
                    OgImage = s.OgImage,
                    ViewsCount = s.ViewsCount,
                    Likes = db.SiteLikes.Count(l => l.SiteId == s.IdSite),
                    LikedByMe = userId != null && db.SiteLikes.Any(l => l.SiteId == s.IdSite && l.UserId == userId),
                    IsDocEngine = s.PublishedDocumentJson != null,
                };

            query = sort == "popular"
                ? query.OrderByDescending(c => c.Likes).ThenByDescending(c => c.ViewsCount)
                : query.OrderByDescending(c => c.SiteId);

            return View(new CommunityViewModel
            {
                Cards = await query.Take(60).ToListAsync(),
                Sort = sort == "popular" ? "popular" : "new",
            });
        }

        // Лайк-тоггл. Форма с редиректом обратно в галерею — работает без JS.
        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Like(int siteId, string sort = "new")
        {
            var userId = CurrentUserIdOrNull.Value;
            var canLike = await db.Sites.AnyAsync(s => s.IdSite == siteId && s.IsPublished && s.ShowInGallery);
            if (!canLike)
            {
                return NotFound();
            }
            var existing = await db.SiteLikes.FirstOrDefaultAsync(l => l.SiteId == siteId && l.UserId == userId);
            if (existing != null)
            {
                db.SiteLikes.Remove(existing);
            }
            else
            {
                db.SiteLikes.Add(new SiteLike { SiteId = siteId, UserId = userId, CreatedAt = DateTime.UtcNow });
            }
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Index), new { sort });
        }

        // «Использовать как шаблон»: клонирует сайт из галереи в аккаунт текущего
        // пользователя как черновик. Для движка B источник правды — опубликованный
        // JSON-снапшот (его и копируем; HTML пересобирает сервер). Legacy — копия блоба.
        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Clone(int siteId)
        {
            var userId = CurrentUserIdOrNull.Value;
            var source = await db.Sites.AsNoTracking()
                .FirstOrDefaultAsync(s => s.IdSite == siteId && s.IsPublished && s.ShowInGallery);
            if (source == null)
            {
                return NotFound();
            }

            var name = source.Name + " (копия)";
            var clone = new Site
            {
                Name = name.Length > 100 ? name.Substring(0, 100) : name,
                UserId = userId,
                Slug = await GenerateUniqueSlugAsync(userId, name),
                IsPublished = false,
                ShowInGallery = false,
                MetaTitle = source.MetaTitle,
                MetaDescription = source.MetaDescription,
                OgImage = source.OgImage,
                UpdatedAt = DateTime.UtcNow,
            };

            if (!string.IsNullOrEmpty(source.PublishedDocumentJson))
            {
                // Движок B: клонируем снапшот как рабочий документ нового сайта.
                clone.TemplateId = TemplateExportConfigs.CustomTemplateId;
                clone.DocumentJson = source.PublishedDocumentJson;
                var body = _docRenderer.RenderSite(clone.DocumentJson);
                clone.Folder = PublishedPageBuilder.WrapCustomHtml(body, clone, clone.DocumentJson);
                clone.DraftFolder = clone.Folder;
            }
            else
            {
                // Legacy: копия опубликованного HTML-блоба.
                clone.TemplateId = source.TemplateId;
                clone.Folder = source.Folder;
                clone.DraftFolder = source.Folder;
            }

            db.Sites.Add(clone);
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        // Показ/скрытие собственного сайта в галерее (кнопка в MySites).
        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ToggleGallery(int idSite)
        {
            var userId = CurrentUserIdOrNull.Value;
            var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == idSite && s.UserId == userId);
            if (site == null)
            {
                return Forbid();
            }
            site.ShowInGallery = !site.ShowInGallery;
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        private async Task<string> GenerateUniqueSlugAsync(int userId, string baseName)
        {
            var baseSlug = SlugGenerator.Generate(baseName);
            var slug = baseSlug;
            var i = 1;
            while (await db.Sites.AnyAsync(s => s.UserId == userId && s.Slug == slug))
            {
                slug = $"{baseSlug}-{i++}";
            }
            return slug;
        }
    }
}
