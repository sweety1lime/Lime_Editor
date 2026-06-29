using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // Коллекции данных сайта (фуллстак): пользователь определяет «таблицу» (поля),
    // наполняет записями; формы пишут сюда (FormController), блок collectionList — читает.
    // Всё строго в рамках своих сайтов (ownership), как в FormController/MediaController.
    [Authorize]
    public class DataController : Controller
    {
        private static readonly string[] FieldTypes = { "text", "longtext", "number", "date", "bool", "image" };

        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly AiContentService _ai;
        private readonly IEntitlementService _entitlements;
        private readonly ILogger<DataController> _logger;
        private readonly int _maxTokens;

        public DataController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            AiContentService ai,
            IEntitlementService entitlements,
            IConfiguration config,
            ILogger<DataController> logger)
        {
            db = context;
            _userManager = userManager;
            _ai = ai;
            _entitlements = entitlements;
            _logger = logger;
            _maxTokens = config.GetValue("Ai:MaxTokens", 4000);
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        // Загружает сайт, только если он принадлежит текущему пользователю.
        private Task<Site> OwnedSiteAsync(int siteId)
            => db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == CurrentUserId);

        // Загружает коллекцию вместе с проверкой владения её сайтом.
        private async Task<Collection> OwnedCollectionAsync(int id)
        {
            var col = await db.Collections.FirstOrDefaultAsync(c => c.Id == id);
            if (col == null) return null;
            var owns = await db.Sites.AnyAsync(s => s.IdSite == col.SiteId && s.UserId == CurrentUserId);
            return owns ? col : null;
        }

        // JSON-список коллекций сайта — для пикеров в конструкторе (форма/collectionList).
        [HttpGet]
        [Produces("application/json")]
        public async Task<IActionResult> ApiList(int siteId)
        {
            var site = await OwnedSiteAsync(siteId);
            if (site == null) return Forbid();
            var cols = await db.Collections
                .Where(c => c.SiteId == siteId)
                .OrderBy(c => c.Name)
                .Select(c => new { slug = c.Slug, name = c.Name, schemaJson = c.SchemaJson })
                .ToListAsync();
            return Json(cols);
        }

        // Список коллекций сайта.
        public async Task<IActionResult> Index(int siteId)
        {
            var site = await OwnedSiteAsync(siteId);
            if (site == null) return Forbid();

            var collections = await db.Collections
                .Where(c => c.SiteId == siteId)
                .OrderBy(c => c.Name)
                .ToListAsync();

            // Кол-во записей по каждой коллекции — для подписи в списке.
            var ids = collections.Select(c => c.Id).ToList();
            var counts = await db.CollectionRecords
                .Where(r => ids.Contains(r.CollectionId))
                .GroupBy(r => r.CollectionId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count);

            ViewBag.SiteId = siteId;
            ViewBag.SiteName = site.Name;
            ViewBag.Counts = counts;
            return View(collections);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> Create(int siteId, string name)
        {
            var site = await OwnedSiteAsync(siteId);
            if (site == null) return Forbid();
            if (string.IsNullOrWhiteSpace(name)) return RedirectToAction(nameof(Index), new { siteId });

            var slug = await UniqueSlugAsync(siteId, name);
            var col = new Collection
            {
                SiteId = siteId,
                Name = name.Trim(),
                Slug = slug,
                SchemaJson = "[]",
                CreatedAt = DateTime.UtcNow,
            };
            db.Collections.Add(col);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Edit), new { id = col.Id });
        }

        // AI CMS-ассистент (этап 2.4): «опиши коллекцию» → AI собирает схему + примеры записей,
        // создаём коллекцию и редиректим в редактор схемы (всё дальше правится вручную).
        [HttpPost]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("ai")]
        [RequestSizeLimit(RequestBodyLimits.AiSmallBytes)]
        public async Task<IActionResult> CreateWithAi(int siteId, string description)
        {
            var site = await OwnedSiteAsync(siteId);
            if (site == null) return Forbid();
            if (string.IsNullOrWhiteSpace(description) || description.Length > 2000)
            {
                TempData["AiError"] = "Опиши коллекцию в пару предложений.";
                return RedirectToAction(nameof(Index), new { siteId });
            }
            if (!_ai.IsConfigured)
            {
                TempData["AiError"] = "AI не настроен на сервере.";
                return RedirectToAction(nameof(Index), new { siteId });
            }

            var owner = OwnerRef.ForUser(CurrentUserId);
            var usage = await _entitlements.GetUsageAsync(owner, "ai");
            if (usage.Used >= usage.Limit)
            {
                TempData["AiError"] = $"Лимит AI-генераций исчерпан ({usage.Used}/{usage.Limit}).";
                return RedirectToAction(nameof(Index), new { siteId });
            }

            try
            {
                var json = await _ai.SuggestCollectionAsync(description.Trim(), _maxTokens, HttpContext.RequestAborted);
                await _entitlements.IncrementAsync(owner, "ai");

                var spec = JObject.Parse(json);
                var name = (string)spec["name"];
                var fields = (JArray)spec["fields"];
                var col = new Collection
                {
                    SiteId = siteId,
                    Name = string.IsNullOrWhiteSpace(name) ? "Коллекция" : name.Trim(),
                    Slug = await UniqueSlugAsync(siteId, name),
                    SchemaJson = fields.ToString(Formatting.None),
                    CreatedAt = DateTime.UtcNow,
                };
                db.Collections.Add(col);
                await db.SaveChangesAsync();

                if (spec["records"] is JArray recs)
                {
                    foreach (var r in recs)
                    {
                        if (r is not JObject ro) continue;
                        db.CollectionRecords.Add(new CollectionRecord
                        {
                            CollectionId = col.Id,
                            DataJson = ro.ToString(Formatting.None),
                            CreatedAt = DateTime.UtcNow,
                        });
                    }
                    await db.SaveChangesAsync();
                }
                return RedirectToAction(nameof(Edit), new { id = col.Id });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI collection create failed for user {UserId}", CurrentUserId);
                TempData["AiError"] = "AI не смог собрать коллекцию — попробуй переформулировать.";
                return RedirectToAction(nameof(Index), new { siteId });
            }
        }

        // Редактор схемы коллекции (поля).
        public async Task<IActionResult> Edit(int id)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();
            ViewBag.Fields = ParseFields(col.SchemaJson);
            ViewBag.FieldTypes = FieldTypes;
            return View(col);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> AddField(int id, string fieldName, string fieldType, string fieldLabel)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();

            var name = Slugify(fieldName);
            if (string.IsNullOrEmpty(name)) return RedirectToAction(nameof(Edit), new { id });
            if (!FieldTypes.Contains(fieldType)) fieldType = "text";

            var fields = ParseFields(col.SchemaJson);
            // Имя поля уникально внутри коллекции.
            if (!fields.Any(f => f.Name == name))
            {
                fields.Add(new FieldDef { Name = name, Type = fieldType, Label = string.IsNullOrWhiteSpace(fieldLabel) ? fieldName : fieldLabel.Trim() });
                col.SchemaJson = JsonConvert.SerializeObject(fields);
                await db.SaveChangesAsync();
            }
            return RedirectToAction(nameof(Edit), new { id });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> RemoveField(int id, string fieldName)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();
            var fields = ParseFields(col.SchemaJson);
            fields.RemoveAll(f => f.Name == fieldName);
            col.SchemaJson = JsonConvert.SerializeObject(fields);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Edit), new { id });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> DeleteCollection(int id)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();
            var siteId = col.SiteId;
            db.Collections.Remove(col); // записи уйдут каскадом
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Index), new { siteId });
        }

        // Список записей коллекции + форма добавления.
        public async Task<IActionResult> Records(int id)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();
            var records = await db.CollectionRecords
                .Where(r => r.CollectionId == id)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();
            ViewBag.Fields = ParseFields(col.SchemaJson);
            ViewBag.Records = records; // List<CollectionRecord>; DataJson парсим в вьюхе
            return View(col);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.DataFormBytes)]
        public async Task<IActionResult> AddRecord(int id)
        {
            var col = await OwnedCollectionAsync(id);
            if (col == null) return Forbid();

            var fields = ParseFields(col.SchemaJson);
            var data = new Dictionary<string, string>();
            foreach (var f in fields)
            {
                data[f.Name] = Request.Form["f_" + f.Name].ToString();
            }
            db.CollectionRecords.Add(new CollectionRecord
            {
                CollectionId = id,
                DataJson = JsonConvert.SerializeObject(data),
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Records), new { id });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> DeleteRecord(int id)
        {
            var rec = await db.CollectionRecords.FirstOrDefaultAsync(r => r.Id == id);
            if (rec == null) return NotFound();
            var col = await OwnedCollectionAsync(rec.CollectionId);
            if (col == null) return Forbid();
            db.CollectionRecords.Remove(rec);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Records), new { id = rec.CollectionId });
        }

        // ----- helpers -----
        // Имена свойств в JSON — lowercase: их читает рендерер lime-doc.js (f.name/f.type/f.label)
        // и редактор. PascalCase ломал бы биндинг полей в collectionList.
        public class FieldDef
        {
            [JsonProperty("name")] public string Name { get; set; }
            [JsonProperty("type")] public string Type { get; set; }
            [JsonProperty("label")] public string Label { get; set; }
        }

        private static List<FieldDef> ParseFields(string schemaJson)
        {
            try
            {
                return JsonConvert.DeserializeObject<List<FieldDef>>(schemaJson) ?? new List<FieldDef>();
            }
            catch
            {
                return new List<FieldDef>();
            }
        }

        private static JObject SafeParse(string json)
        {
            try { return JObject.Parse(json ?? "{}"); }
            catch { return new JObject(); }
        }

        private static string Slugify(string s)
        {
            var slug = SlugGenerator.Generate(s ?? "");
            return string.IsNullOrEmpty(slug) ? "" : slug.Replace("-", "_");
        }

        private async Task<string> UniqueSlugAsync(int siteId, string name)
        {
            var baseSlug = SlugGenerator.Generate(name);
            if (string.IsNullOrEmpty(baseSlug)) baseSlug = "collection";
            var slug = baseSlug;
            var i = 1;
            while (await db.Collections.AnyAsync(c => c.SiteId == siteId && c.Slug == slug))
            {
                slug = baseSlug + "-" + i++;
            }
            return slug;
        }
    }
}
