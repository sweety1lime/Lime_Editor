using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    public class HomeController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IDocumentRenderer _docRenderer;
        private readonly IEntitlementService _entitlements;
        private readonly ISiteService _sites;

        public HomeController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            IDocumentRenderer docRenderer,
            IEntitlementService entitlements,
            ISiteService sites)
        {
            db = context;
            _userManager = userManager;
            _docRenderer = docRenderer;
            _entitlements = entitlements;
            _sites = sites;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        private Task<bool> UserOwnsSiteAsync(int? siteId)
        {
            return _sites.UserOwnsSiteAsync(CurrentUserId, siteId);
        }

        public async Task<IActionResult> Index()
        {
            if (User?.Identity?.IsAuthenticated == true)
            {
                return RedirectToAction(nameof(MySites));
            }

            var templates = await db.Templates
                .AsNoTracking()
                .Where(t => t.IdTemplate != TemplateExportConfigs.CustomTemplateId)
                .OrderBy(t => t.IdTemplate)
                .ToListAsync();
            return View(templates);
        }

        [Authorize]
        public async Task<IActionResult> MySites()
        {
            var dashboard = await _sites.GetDashboardAsync(CurrentUserId);
            ViewBag.LeadCounts = dashboard.LeadCounts;
            return View(dashboard.Model);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> UpdateSite(SiteControlModel controlModel)
        {
            var site = JsonConvert.DeserializeObject<Site>(controlModel.Site);
            if (site == null || !await UserOwnsSiteAsync(site.IdSite))
            {
                return Forbid();
            }

            return RedirectToAction(nameof(EditDoc), new { siteId = site.IdSite });
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DeleteSite(SiteControlModel controlModel)
        {
            var site = JsonConvert.DeserializeObject<Site>(controlModel.Site);
            if (site == null || !await _sites.DeleteSiteAsync(CurrentUserId, site.IdSite))
            {
                return Forbid();
            }

            return RedirectToAction(nameof(MySites), "Home");
        }

        [Authorize]
        public IActionResult Templates()
        {
            return View();
        }

        [Authorize]
        public async Task<IActionResult> EditDoc(int? siteId)
        {
            var vm = new ConstructorViewModel
            {
                SiteId = null,
                SiteName = "Новый сайт (движок B)",
                DocumentJson = null,
            };

            if (siteId.HasValue)
            {
                var site = await _sites.GetOwnedSiteAsync(CurrentUserId, siteId.Value);
                if (site == null)
                {
                    return Forbid();
                }

                if (site.TemplateId != TemplateExportConfigs.CustomTemplateId)
                {
                    return BadRequest("Этот сайт нельзя редактировать через движок B.");
                }

                vm.SiteId = site.IdSite;
                vm.SiteName = site.Name;
                vm.MetaTitle = site.MetaTitle;
                vm.MetaDescription = site.MetaDescription;
                vm.OgImage = site.OgImage;
                vm.DocumentJson = site.DocumentJson;
                vm.DocVersion = site.UpdatedAt?.Ticks ?? 0;
                vm.HasOriginalBackup = !string.IsNullOrEmpty(site.OriginalDocumentJson);
            }

            return View(vm);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> EditTemplatesPost(
            string html, int? siteId, string metaTitle, string metaDescription, string ogImage,
            string documentJson = null, bool auto = false, long baseVersion = -1)
        {
            var userId = CurrentUserId;

            static string Norm(string v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
            metaTitle = Norm(metaTitle);
            metaDescription = Norm(metaDescription);
            ogImage = Norm(ogImage);

            if (siteId.HasValue)
            {
                var site = await _sites.GetOwnedSiteAsync(userId, siteId.Value);
                if (site == null)
                {
                    return Forbid();
                }

                if (site.TemplateId != TemplateExportConfigs.CustomTemplateId)
                {
                    return BadRequest("Этот сайт нельзя редактировать через Custom-конструктор.");
                }

                if (Site.IsVersionConflict(baseVersion, site.UpdatedAt))
                {
                    return Conflict(new { error = "version", version = site.UpdatedAt?.Ticks ?? 0 });
                }

                site.MetaTitle = metaTitle;
                site.MetaDescription = metaDescription;
                site.OgImage = ogImage;
                if (documentJson != null)
                {
                    if (Site.ShouldBackupOriginal(site.OriginalDocumentJson, site.DocumentJson, documentJson))
                    {
                        site.OriginalDocumentJson = site.DocumentJson;
                    }

                    site.DocumentJson = documentJson;
                }

                site.DraftFolder = WrapCustomHtml(html, site);
                if (!site.IsPublished)
                {
                    site.Folder = site.DraftFolder;
                }

                site.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
                return auto ? Json(new { version = site.UpdatedAt.Value.Ticks }) : RedirectToAction(nameof(MySites));
            }

            if (!await _entitlements.CanCreateSiteAsync(OwnerRef.ForUser(userId)))
            {
                return auto ? StatusCode(403, new { error = "site_limit" }) : RedirectToAction("Index", "Billing");
            }

            var name = "Новый сайт";
            var created = new Site
            {
                Name = name,
                UserId = userId,
                TemplateId = TemplateExportConfigs.CustomTemplateId,
                Slug = await _sites.GenerateUniqueSlugAsync(userId, name),
                IsPublished = false,
                MetaTitle = metaTitle,
                MetaDescription = metaDescription,
                OgImage = ogImage,
                DocumentJson = documentJson,
                UpdatedAt = DateTime.UtcNow,
            };
            created.Folder = WrapCustomHtml(html, created);
            created.DraftFolder = created.Folder;
            db.Sites.Add(created);
            await db.SaveChangesAsync();
            return auto ? Json(new { version = created.UpdatedAt.Value.Ticks }) : RedirectToAction(nameof(MySites));
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> RestoreOriginal(int siteId)
        {
            var site = await _sites.GetOwnedSiteAsync(CurrentUserId, siteId);
            if (site == null)
            {
                return Forbid();
            }

            if (string.IsNullOrEmpty(site.OriginalDocumentJson))
            {
                return BadRequest(new { error = "no_backup" });
            }

            site.DocumentJson = site.OriginalDocumentJson;
            var body = _docRenderer.RenderSite(site.OriginalDocumentJson);
            site.DraftFolder = PublishedPageBuilder.WrapCustomHtml(body, site, site.OriginalDocumentJson);
            if (!site.IsPublished)
            {
                site.Folder = site.DraftFolder;
            }

            site.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(EditDoc), new { siteId });
        }

        private static string WrapCustomHtml(string innerHtml, Site site)
        {
            return PublishedPageBuilder.WrapCustomHtml(innerHtml, site, site.DocumentJson);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Publish(int idSite)
        {
            var userId = CurrentUserId;
            var target = await _sites.GetOwnedSiteAsync(userId, idSite);
            if (target == null)
            {
                return Forbid();
            }

            if (string.IsNullOrEmpty(target.Slug))
            {
                target.Slug = await _sites.GenerateUniqueSlugAsync(userId, target.Name);
            }

            if (!string.IsNullOrEmpty(target.DocumentJson))
            {
                var plan = await _entitlements.ResolvePlanAsync(OwnerRef.ForUser(userId));
                target.PublishedDocumentJson = plan.AllowCustomCode
                    ? target.DocumentJson
                    : PublishedPageBuilder.StripCustomCode(target.DocumentJson);
                var body = _docRenderer.RenderSite(target.PublishedDocumentJson);
                target.Folder = PublishedPageBuilder.WrapCustomHtml(body, target, target.PublishedDocumentJson);
            }

            target.IsPublished = true;
            target.PublishedAt = DateTime.UtcNow;
            target.ShowInGallery = true;
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(MySites));
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Unpublish(int idSite)
        {
            if (!await _sites.UnpublishAsync(CurrentUserId, idSite))
            {
                return Forbid();
            }

            return RedirectToAction(nameof(MySites));
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ChangeName(string site, int idSite)
        {
            if (!await _sites.RenameSiteAsync(CurrentUserId, idSite, site))
            {
                return Forbid();
            }

            return RedirectToAction(nameof(MySites), "Home");
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
