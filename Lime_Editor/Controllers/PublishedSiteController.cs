using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Collections.Generic;
using System.Linq;
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

            // Все сайты — движок B (Движок A удалён): каждая страница — свой URL. Рендерим из
            // опубликованного JSON-снапшота тем же lime-doc.js, что и клиент; навигация
            // получает реальные ссылки /u/{user}/{slug}/{page}. Контент собирается рендерером
            // с экранированием — санитайзер HTML-блоба тут не нужен.
            if (string.IsNullOrEmpty(site.PublishedDocumentJson))
            {
                return NotFound();
            }
            var baseUrl = $"/u/{username}/{slug}";
            // Фуллстак: если документ содержит блок collectionList — подгружаем данные
            // коллекций сайта (per-request, живые) и отдаём рендереру.
            var dataJson = await BuildCollectionDataAsync(site.IdSite ?? 0, site.PublishedDocumentJson);
            var rendered = _docRenderer.RenderPage(site.PublishedDocumentJson, page ?? "", baseUrl, dataJson);
            if (rendered == null)
            {
                return NotFound();
            }
            // Для главной title сайта, для внутренних — «Страница — Сайт».
            var pageTitle = string.IsNullOrEmpty(page) ? null : rendered.Title;
            var html = PublishedPageBuilder.WrapCustomHtml(rendered.Body, site, site.PublishedDocumentJson, pageTitle);
            html = PublishedHtmlSanitizer.InjectFormEndpoints(html, site.IdSite ?? 0);
            return Content(html, "text/html");
        }

        // Карта данных коллекций { "<slug>": { fields, records } } для блока collectionList.
        // Возвращает null, если документ не использует динамику или коллекций нет.
        private async Task<string> BuildCollectionDataAsync(int siteId, string documentJson)
        {
            if (string.IsNullOrEmpty(documentJson) || siteId == 0 || documentJson.IndexOf("collectionList", System.StringComparison.Ordinal) < 0)
            {
                return null;
            }

            var collections = await db.Collections
                .AsNoTracking()
                .Where(c => c.SiteId == siteId)
                .ToListAsync();
            if (collections.Count == 0) return null;

            var colIds = collections.Select(c => c.Id).ToList();
            var records = await db.CollectionRecords
                .AsNoTracking()
                .Where(r => colIds.Contains(r.CollectionId))
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();

            var map = new Dictionary<string, object>();
            foreach (var col in collections)
            {
                JArray fields;
                try { fields = JArray.Parse(col.SchemaJson); } catch { fields = new JArray(); }
                var recs = records
                    .Where(r => r.CollectionId == col.Id)
                    .Take(200) // мягкий потолок на коллекцию
                    .Select(r => { try { return JObject.Parse(r.DataJson); } catch { return new JObject(); } })
                    .ToList();
                map[col.Slug] = new { fields, records = recs };
            }
            return JsonConvert.SerializeObject(map);
        }
    }
}
