using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Authorize]
    public class TemplateController : Controller
    {
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly ITemplateExportService _exportService;

        public TemplateController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            ITemplateExportService exportService)
        {
            db = context;
            _userManager = userManager;
            _exportService = exportService;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        public ActionResult PageToEdit()
        {
            if (HttpContext.Session.Keys.Contains("SiteData"))
            {
                var siteJson = HttpContext.Session.GetString("SiteData");
                var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));

                // Custom (TemplateId=4) — теперь живёт в новом конструкторе, не в legacy view.
                if (site.TemplateId == Services.TemplateExportConfigs.CustomTemplateId)
                {
                    return RedirectToAction("EditTemplates", "Home", new { siteId = site.IdSite });
                }

                site.Folder = site.Folder.Replace("savPage()", "updatePage()");
                // Старые сохранённые сайты содержали разные плейсхолдеры на кнопке "Скачать"
                // (poop/temp/Sublime). Теперь у всех — одна точка входа downloadSite().
                site.Folder = site.Folder.Replace("onclick=\"poop\"",    "onclick=\"downloadSite()\"");
                site.Folder = site.Folder.Replace("onclick=\"temp\"",    "onclick=\"downloadSite()\"");
                site.Folder = site.Folder.Replace("onclick=\"Sublime\"", "onclick=\"downloadSite()\"");
                return View(site);
            }

            return View();
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> UpdateSitecheck(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));

            // Owner-проверка: даже если в сессии лежит чужой IdSite, пишем только в свой сайт.
            var target = await db.Sites.FirstOrDefaultAsync(x => x.IdSite == site.IdSite);
            if (target == null)
            {
                return NotFound();
            }
            if (target.UserId != CurrentUserId)
            {
                return Forbid();
            }

            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            site.Folder = currentHtml;

            HttpContext.Session.SetString("SiteData", JsonConvert.SerializeObject(site));

            target.Folder = currentHtml;
            await db.SaveChangesAsync();
            return RedirectToAction("PageToEdit");
        }

        // Единый эндпоинт скачивания: вместо трёх (SaveRuby / SaveSublime / SaveCoomingSoon) — один,
        // отдающий ZIP в браузер. Конфигурация шаблонов — в TemplateExportConfigs.
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DownloadSite(string html, int templateId)
        {
            var result = await _exportService.ExportAsync(templateId, html);
            return File(result.ZipBytes, "application/zip", result.FileName);
        }

        public ActionResult Template_1() => View();
        public ActionResult Template_1_Preview() => View();
        public ActionResult Template_2() => View();
        public ActionResult Template_2_Preview() => View();
        public ActionResult Template_3() => View();
        public ActionResult Template_3_Preview() => View();
    }
}
