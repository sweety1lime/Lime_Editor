using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System;
using System.IO;
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
                site.Folder = site.Folder.Replace("savPage()", "updatePage()");
                site.Folder = site.Folder.Replace("poop", "downloadCommingSoon()");
                site.Folder = site.Folder.Replace("temp", "downloadTemp()");
                site.Folder = site.Folder.Replace("Sublime", "downloadSublime()");
                return View(site);
            }

            return View();
        }

        [HttpPost]
        public IActionResult UpdateSitecheck(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));

            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            site.Folder = currentHtml;

            HttpContext.Session.SetString("SiteData", JsonConvert.SerializeObject(site));

            db.Sites.First(x => x.IdSite == site.IdSite).Folder = currentHtml;
            db.SaveChanges();
            return RedirectToAction("PageToEdit");
        }

        [HttpPost]
        public IActionResult SaveRuby(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));
            var user = "";
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            currentHtml = currentHtml.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");
            currentHtml = currentHtml.Replace("../vendor/Template_1/", "vendor/");
            currentHtml = currentHtml.Replace("/js/Template_1/", "js/");
            currentHtml = currentHtml.Replace("../css/Template_1/", "css/");
            currentHtml = currentHtml.Replace("../images/Template_1/", "images/");

            if (HttpContext.Session.Keys.Contains("AuthUser"))
                user = HttpContext.Session.GetString("AuthUser");
            string directory = System.Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + $@"\{user}-RubyTemplate";
            if (!System.IO.Directory.Exists(directory))
                System.IO.Directory.CreateDirectory(directory);
            System.IO.File.WriteAllText(directory + @"\index.html", currentHtml);
            Directory.CreateDirectory(directory + "\\css");
            Directory.CreateDirectory(directory + "\\vendor");
            Directory.CreateDirectory(directory + "\\images");
            Directory.CreateDirectory(directory + "\\js");
            string[] reqiredCss = new[] { "style.min.css"};
            string[] filePaths = Directory.GetFiles(_environment.WebRootPath + "\\css\\Template_1\\");
            foreach (var filePath in filePaths)
            {
                if (reqiredCss.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newCssPath = directory + "\\css\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newCssPath, true);
                    }
                }

            }

            string[] reqiredJs = new[] { "app.min.js" };
            string[] fileJsPaths = Directory.GetFiles(_environment.WebRootPath + "\\js\\Template_1\\");
            foreach (var filePath in fileJsPaths)
            {
                if (reqiredJs.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newJsPath = directory + "\\js\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newJsPath, true);
                    }
                }

            }


            var oldPath = _environment.WebRootPath + "\\vendor\\Template_1\\";
            var newPath = directory + "\\vendor\\";

            foreach (string dirPath in Directory.GetDirectories(oldPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldPath, newPath));

            //Скопировать все файлы. И перезаписать(если такие существуют)
            foreach (string pathBuBu in Directory.GetFiles(oldPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldPath, newPath), true);

            string[] pathImg = Directory.GetFiles(_environment.WebRootPath + "\\images\\Template_1\\");
            foreach (var filePath in pathImg)
            {
                if (html.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newImagePath = directory + "\\images\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newImagePath, true);
                    }
                }

            }

            return Ok();
        }

        [HttpPost]
        public IActionResult SaveSublime(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));
            var user = "";
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            currentHtml = currentHtml.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");
            currentHtml = currentHtml.Replace("/js/Template_2/", "js/");
            currentHtml = currentHtml.Replace("/css/Template_2/", "css/");
            currentHtml = currentHtml.Replace("/images/Template_2/", "images/");
            currentHtml = currentHtml.Replace("class=\"changethis\"", "class=\"otstup\"");

            if (HttpContext.Session.Keys.Contains("AuthUser"))
                user = HttpContext.Session.GetString("AuthUser");
            string directory = System.Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + $@"\{user}-SublimeTemplate";
            if (!System.IO.Directory.Exists(directory))
                System.IO.Directory.CreateDirectory(directory);
            System.IO.File.WriteAllText(directory + @"\index.html", currentHtml);
            Directory.CreateDirectory(directory + "\\css");
            Directory.CreateDirectory(directory + "\\images");
            Directory.CreateDirectory(directory + "\\js");
            Directory.CreateDirectory(directory + "\\fonts");

            var oldCssPath = _environment.WebRootPath + "\\css\\Template_2\\";
            var newCssPath = directory + "\\css\\";

            foreach (string dirPath in Directory.GetDirectories(oldCssPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldCssPath, newCssPath));

            foreach (string pathBuBu in Directory.GetFiles(oldCssPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldCssPath, newCssPath), true);


            var oldJsPath = _environment.WebRootPath + "\\js\\Template_2\\";
            var newJsPath = directory + "\\js\\";

            foreach (string dirPath in Directory.GetDirectories(oldJsPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldJsPath, newJsPath));

            foreach (string pathBuBu in Directory.GetFiles(oldJsPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldJsPath, newJsPath), true);

            var oldFontPath = _environment.WebRootPath + "\\fonts\\Template_2\\";
            var newFontPath = directory + "\\fonts\\";

            foreach (string dirPath in Directory.GetDirectories(oldFontPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldFontPath, newFontPath));

            foreach (string pathBuBu in Directory.GetFiles(oldFontPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldFontPath, newFontPath), true);

            var oldImagePath = _environment.WebRootPath + "\\images\\Template_2\\";
            var newImagePath = directory + "\\images\\";

            foreach (string dirPath in Directory.GetDirectories(oldImagePath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldImagePath, newImagePath));

            foreach (string pathBuBu in Directory.GetFiles(oldImagePath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldImagePath, newImagePath), true);


           

            return Ok();
        }

        [HttpPost]
        public IActionResult SaveCoomingSoon(string html)
        {
            var siteJson = HttpContext.Session.GetString("SiteData");
            var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));
            var user = "";
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            currentHtml = currentHtml.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");
            currentHtml = currentHtml.Replace("/js/Template_3/", "js/");
            currentHtml = currentHtml.Replace("/css/Template_3/", "css/");
            currentHtml = currentHtml.Replace("/images/Template_3/", "images/");
            currentHtml = currentHtml.Replace("/vendor/Template_3/", "vendor/");
            currentHtml = currentHtml.Replace("/fonts/Template_3/", "fonts/");

            if (HttpContext.Session.Keys.Contains("AuthUser"))
                user = HttpContext.Session.GetString("AuthUser");
            string directory = System.Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + $@"\{user}-ComingSoonTemplate";
            if (!System.IO.Directory.Exists(directory))
                System.IO.Directory.CreateDirectory(directory);
            System.IO.File.WriteAllText(directory + @"\index.html", currentHtml);
            Directory.CreateDirectory(directory + "\\css");
            Directory.CreateDirectory(directory + "\\images");
            Directory.CreateDirectory(directory + "\\vendor");
            Directory.CreateDirectory(directory + "\\js");
            Directory.CreateDirectory(directory + "\\fonts");

            var oldCssPath = _environment.WebRootPath + "\\css\\Template_3\\";
            var newCssPath = directory + "\\css\\";

            foreach (string dirPath in Directory.GetDirectories(oldCssPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldCssPath, newCssPath));

            foreach (string pathBuBu in Directory.GetFiles(oldCssPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldCssPath, newCssPath), true);


            var oldJsPath = _environment.WebRootPath + "\\js\\Template_3\\";
            var newJsPath = directory + "\\js\\";

            foreach (string dirPath in Directory.GetDirectories(oldJsPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldJsPath, newJsPath));

            foreach (string pathBuBu in Directory.GetFiles(oldJsPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldJsPath, newJsPath), true);

            var oldFontPath = _environment.WebRootPath + "\\fonts\\Template_3\\";
            var newFontPath = directory + "\\fonts\\";

            foreach (string dirPath in Directory.GetDirectories(oldFontPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldFontPath, newFontPath));

            foreach (string pathBuBu in Directory.GetFiles(oldFontPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldFontPath, newFontPath), true);

            var oldVendorPath = _environment.WebRootPath + "\\vendor\\Template_3\\";
            var newVendorPath = directory + "\\vendor\\";

            foreach (string dirPath in Directory.GetDirectories(oldVendorPath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldVendorPath, newVendorPath));

            foreach (string pathBuBu in Directory.GetFiles(oldVendorPath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldVendorPath, newVendorPath), true);

            var oldImagePath = _environment.WebRootPath + "\\images\\Template_3\\";
            var newImagePath = directory + "\\images\\";

            foreach (string dirPath in Directory.GetDirectories(oldImagePath, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dirPath.Replace(oldImagePath, newImagePath));

            foreach (string pathBuBu in Directory.GetFiles(oldImagePath, "*.*", SearchOption.AllDirectories))
                System.IO.File.Copy(pathBuBu, pathBuBu.Replace(oldImagePath, newImagePath), true);

            return Ok();
        }

        public ActionResult Template_1()
        {
            return View();
        }
        public ActionResult Template_1_Preview()
        {
            return View();
        }

        public ActionResult Template_2()
        {
            return View();
        }
        public ActionResult Template_2_Preview()
        {
            return View();
        }

        public ActionResult Template_3()
        {
            return View();
        }
        public ActionResult Template_3_Preview()
        {
            return View();
        }
    }
}
