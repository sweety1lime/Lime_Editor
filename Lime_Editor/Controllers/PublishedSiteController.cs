using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // Публичная отдача опубликованных сайтов: /u/{username}/{slug}. Без авторизации.
    [AllowAnonymous]
    public class PublishedSiteController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IDocumentRenderer _docRenderer;

        public PublishedSiteController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            IDocumentRenderer docRenderer)
        {
            db = context;
            _userManager = userManager;
            _docRenderer = docRenderer;
        }

        public async Task<IActionResult> Show(string username, string slug, string page = null)
        {
            var user = await _userManager.FindByNameAsync(username);
            if (user == null)
            {
                return NotFound();
            }

            // Без AsNoTracking: тут же инкрементируем счётчик просмотров (этап 3).
            var site = await db.Sites
                .FirstOrDefaultAsync(s => s.UserId == user.Id && s.Slug == slug && s.IsPublished);
            if (site == null)
            {
                return NotFound();
            }

            site.ViewsCount++;
            await db.SaveChangesAsync();

            // Сайты движка B (этап 0.3): каждая страница — свой URL. Рендерим из
            // опубликованного JSON-снапшота тем же lime-doc.js, что и клиент; навигация
            // получает реальные ссылки /u/{user}/{slug}/{page}, hash-роутинг остаётся
            // только превью в редакторе. Контент собирается рендерером с экранированием —
            // санитайзер HTML-блоба тут не нужен.
            if (!string.IsNullOrEmpty(site.PublishedDocumentJson))
            {
                var baseUrl = $"/u/{username}/{slug}";
                var rendered = _docRenderer.RenderPage(site.PublishedDocumentJson, page ?? "", baseUrl);
                if (rendered == null)
                {
                    return NotFound();
                }
                // Для главной title сайта, для внутренних — «Страница — Сайт».
                var pageTitle = string.IsNullOrEmpty(page) ? null : rendered.Title;
                var html = PublishedPageBuilder.WrapCustomHtml(rendered.Body, site, pageTitle);
                html = PublishedHtmlSanitizer.InjectFormEndpoints(html, site.IdSite ?? 0);
                return Content(html, "text/html");
            }

            // Legacy-сайты одностраничные — внутренних страниц у них нет.
            if (!string.IsNullOrEmpty(page))
            {
                return NotFound();
            }

            // Перед отдачей вычищаем редакторские контролы — это публичная страница, а не редактор.
            var cleanHtml = PublishedHtmlSanitizer.Sanitize(site.Folder);
            // Делаем формы-блоки рабочими: проставляем endpoint и привязку к сайту по id из БД.
            cleanHtml = PublishedHtmlSanitizer.InjectFormEndpoints(cleanHtml, site.IdSite ?? 0);
            return Content(cleanHtml, "text/html");
        }
    }
}
