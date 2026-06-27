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
            var dataJson = await BuildCollectionDataAsync(site.IdSite ?? 0, site.PublishedDocumentJson, baseUrl);
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

        // Динамическая страница записи (CMS 2.0): /u/{user}/{slug}/{page}/{record}.
        // {page} — страница-шаблон, привязанная к коллекции (page.collection); {record} = "{id}-{slug}".
        // Рендерим шаблон с одной записью (блоки с content.bind берут значения из неё).
        public async Task<IActionResult> ShowRecord(string username, string slug, string page, string record)
        {
            var user = await _userManager.FindByNameAsync(username);
            if (user == null) return NotFound();

            var site = await db.Sites
                .FirstOrDefaultAsync(s => s.UserId == user.Id && s.Slug == slug && s.IsPublished);
            if (site == null || string.IsNullOrEmpty(site.PublishedDocumentJson)) return NotFound();

            // Страница должна быть шаблоном записи (привязана к коллекции).
            var templates = CollectionTemplatePages(site.PublishedDocumentJson); // pageSlug -> collectionSlug
            if (!templates.TryGetValue(page ?? "", out var colSlug)) return NotFound();

            var sid = site.IdSite ?? 0;
            var col = await db.Collections.AsNoTracking()
                .FirstOrDefaultAsync(c => c.SiteId == sid && c.Slug == colSlug);
            if (col == null) return NotFound();

            var recId = LeadingInt(record);
            if (recId == 0) return NotFound();
            var rec = await db.CollectionRecords.AsNoTracking()
                .FirstOrDefaultAsync(r => r.Id == recId && r.CollectionId == col.Id);
            if (rec == null) return NotFound();

            site.ViewsCount++;
            await db.SaveChangesAsync();

            var baseUrl = $"/u/{username}/{slug}";
            var dataJson = await BuildCollectionDataAsync(sid, site.PublishedDocumentJson, baseUrl);
            var rendered = _docRenderer.RenderPage(site.PublishedDocumentJson, page, baseUrl, dataJson, rec.DataJson);
            if (rendered == null) return NotFound();

            var pageTitle = RecordTitle(col.SchemaJson, rec.DataJson) ?? rendered.Title;
            var html = PublishedPageBuilder.WrapCustomHtml(rendered.Body, site, site.PublishedDocumentJson, pageTitle);
            html = PublishedHtmlSanitizer.InjectFormEndpoints(html, sid);
            return Content(html, "text/html");
        }

        // Карта данных коллекций { "<slug>": { fields, records } } для блока collectionList.
        // В каждую запись кладёт _id и (если коллекция привязана к странице-шаблону) _url —
        // ссылку на детальную /u/.../{templatePage}/{id}-{slug}. null, если динамики/коллекций нет.
        private async Task<string> BuildCollectionDataAsync(int siteId, string documentJson, string baseUrl)
        {
            if (string.IsNullOrEmpty(documentJson) || siteId == 0 || documentJson.IndexOf("collection", System.StringComparison.Ordinal) < 0)
            {
                return null;
            }

            var collections = await db.Collections
                .AsNoTracking()
                .Where(c => c.SiteId == siteId)
                .ToListAsync();
            if (collections.Count == 0) return null;

            // collectionSlug -> templatePageSlug (для ссылок карточек на детальную страницу).
            var tmplByCol = new Dictionary<string, string>();
            foreach (var kv in CollectionTemplatePages(documentJson))
            {
                if (!string.IsNullOrEmpty(kv.Key)) tmplByCol[kv.Value] = kv.Key; // value=col, key=pageSlug
            }

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
                var titleField = FirstTextField(col.SchemaJson);
                tmplByCol.TryGetValue(col.Slug, out var tmplPage);
                var recs = records
                    .Where(r => r.CollectionId == col.Id)
                    .Take(200) // мягкий потолок на коллекцию
                    .Select(r =>
                    {
                        JObject o;
                        try { o = JObject.Parse(r.DataJson); } catch { o = new JObject(); }
                        o["_id"] = r.Id;
                        if (!string.IsNullOrEmpty(tmplPage))
                        {
                            var titleVal = titleField != null ? (string)o[titleField] : null;
                            o["_url"] = RecordUrl(baseUrl, tmplPage, r.Id, titleVal);
                        }
                        return o;
                    })
                    .ToList();
                map[col.Slug] = new { fields, records = recs };
            }
            return JsonConvert.SerializeObject(map);
        }

        // pageSlug -> collectionSlug для страниц-шаблонов (page.collection задан).
        private static Dictionary<string, string> CollectionTemplatePages(string documentJson)
        {
            var map = new Dictionary<string, string>();
            try
            {
                var pages = JObject.Parse(documentJson)["pages"] as JArray;
                if (pages != null)
                {
                    foreach (var p in pages)
                    {
                        var col = (string)p["collection"];
                        if (!string.IsNullOrEmpty(col)) map[(string)p["slug"] ?? ""] = col;
                    }
                }
            }
            catch { /* битый JSON → нет шаблонов */ }
            return map;
        }

        // Первое текстовое поле схемы (для заголовка/slug записи).
        private static string FirstTextField(string schemaJson)
        {
            try
            {
                foreach (var f in JArray.Parse(schemaJson ?? "[]"))
                {
                    var t = (string)f["type"];
                    if (t == "text" || t == "longtext") return (string)f["name"];
                }
            }
            catch { /* нет схемы */ }
            return null;
        }

        private static string RecordTitle(string schemaJson, string dataJson)
        {
            var tf = FirstTextField(schemaJson);
            if (tf == null) return null;
            try { return (string)JObject.Parse(dataJson ?? "{}")[tf]; } catch { return null; }
        }

        // URL детальной: base + "/" + pageSlug + "/" + id["-"slug]. slug — из заголовка записи.
        private static string RecordUrl(string baseUrl, string pageSlug, int id, string titleValue)
        {
            var s = SlugGenerator.Generate(titleValue ?? "");
            var rec = string.IsNullOrEmpty(s) ? id.ToString() : id + "-" + s;
            return baseUrl + "/" + pageSlug + "/" + rec;
        }

        // Ведущее целое из "{id}-{slug}" (матч записи по id, остаток игнорируем).
        private static int LeadingInt(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            int i = 0;
            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;
            return i > 0 && int.TryParse(s.Substring(0, i), out var n) ? n : 0;
        }
    }
}
