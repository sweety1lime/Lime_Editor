using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System;
using System.Linq;

namespace Lime_Editor.Controllers
{
    public class TemplateController : Controller
    {
        private readonly IWebHostEnvironment _environment;
        private LimeEditorContext db;

        public TemplateController(IWebHostEnvironment IHostingEnvironment, LimeEditorContext context)
        {
            _environment = IHostingEnvironment;
            db = context;
        }

        public ActionResult PageToEdit()
        {
            if (HttpContext.Session.Keys.Contains("SiteData"))
            {
                var siteJson = HttpContext.Session.GetString("SiteData");
                var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));
                site.Folder = site.Folder.Replace("savPage()", "freshawakady()"); 
                return View(site);
            }

            return View();
        }

        [HttpPost]
        public IActionResult UpdateSite(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));

            var currentHtml = "<!DOCTYPE html> \n " +
                "<html lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            site.Folder = currentHtml;

            HttpContext.Session.SetString("SiteData", JsonConvert.SerializeObject(site));

            db.Sites.First(x => x.IdSite == site.IdSite).Folder = currentHtml;
            db.SaveChanges();
            return RedirectToAction("PageToEdit");
        }

        public ActionResult Template_1()
        {
            return View();
        }
        public ActionResult Template_1_Preview()
        {
            return View();
        }
    }
}
