using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // «Eject» (Итерация 4): отдаёт сайт как готовый фуллстак-проект Next.js (ZIP).
    // Только владельцу сайта. Хостинг-публикация остаётся дефолтом — это доп-выход «в код».
    [Authorize]
    public class ExportController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly NextExportService _next;
        private readonly IEntitlementService _entitlements;

        public ExportController(LimeEditorContext context, UserManager<ApplicationUser> userManager, NextExportService next, IEntitlementService entitlements)
        {
            db = context;
            _userManager = userManager;
            _next = next;
            _entitlements = entitlements;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        // style: "blob" (движок рендерит HTML) | "jsx" (настоящие React-компоненты + fallback).
        [HttpGet]
        [EnableRateLimiting("export")]
        public async Task<IActionResult> Nextjs(int siteId, string style = "blob")
        {
            var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == CurrentUserId);
            if (site == null) return Forbid();

            // Экспорт в код — фича платных тарифов (этап 3.4).
            var plan = await _entitlements.ResolvePlanAsync(OwnerRef.ForUser(CurrentUserId));
            if (!plan.AllowExport) return RedirectToAction("Index", "Billing");

            // Опубликованный снапшот предпочтительнее (стабилен); иначе текущий черновик.
            var docJson = !string.IsNullOrEmpty(site.PublishedDocumentJson) ? site.PublishedDocumentJson : site.DocumentJson;

            var collections = await db.Collections.Where(c => c.SiteId == siteId).ToListAsync();
            var colIds = collections.Select(c => c.Id).ToList();
            var records = await db.CollectionRecords.Where(r => colIds.Contains(r.CollectionId)).ToListAsync();

            var idiomatic = string.Equals(style, "jsx", System.StringComparison.OrdinalIgnoreCase);
            var zip = _next.BuildZip(site.Name, docJson, collections, records, idiomatic);
            var slug = SlugGenerator.Generate(string.IsNullOrWhiteSpace(site.Slug) ? site.Name : site.Slug);
            return File(zip, "application/zip", slug + (idiomatic ? "-nextjs-react.zip" : "-nextjs.zip"));
        }
    }
}
