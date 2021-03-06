using Lime_Editor.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    public class HomeController : Controller
    {
        private readonly IWebHostEnvironment _environment;
        private LimeEditorContext db;
        public HomeController(IWebHostEnvironment IHostingEnvironment, LimeEditorContext context)
        {
            _environment = IHostingEnvironment;
            db = context;
        }

        public IActionResult Index()
        {
            return View();
        }

        public IActionResult SignIn()
        {
            if (HttpContext.Session.Keys.Contains("AuthUser"))
            {
                return RedirectToAction("MySites", "Home");
            }
            return View();
        }
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SignIn(LoginModel model)
        {

            if (ModelState.IsValid)
            {
                User user = await db.Users.FirstOrDefaultAsync(u => u.Login == model.Login && u.Password == model.Password);
                if (user != null)
                {
                    HttpContext.Session.SetString("AuthUser", model.Login);
                    await Authenticate(model.Login); // аутентификация

                    return RedirectToAction("MySites", "Home");
                }
                ModelState.AddModelError("", "Некорректные логин и(или) пароль");


            }

            return RedirectToAction("SignIn", "Home");

        }
        private async Task Authenticate(string userName)
        {
            // создаем один claim
            var claims = new List<Claim>
            {
                new Claim(ClaimsIdentity.DefaultNameClaimType, userName)
            };
            // создаем объект ClaimsIdentity
            ClaimsIdentity id = new ClaimsIdentity(claims, "ApplicationCookie", ClaimsIdentity.DefaultNameClaimType, ClaimsIdentity.DefaultRoleClaimType);
            // установка аутентификационных куки
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(id));
        }
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("SignIn");
        }
        public IActionResult SignUp()
        {
            return View();
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SignUp(User person)
        {
            if (ModelState.IsValid)
            {
                db.Users.Add(person);
                await db.SaveChangesAsync();
                return RedirectToAction("SignIn");
            }

            else
            {
                return View(person);
            }

        }

        public IActionResult MySites()
        {
            var siteController = new SiteControlModel();
            if (HttpContext.Session.Keys.Contains("AuthUser"))
            {
                var user = HttpContext.Session.GetString("AuthUser");
                siteController.Sites = db.Sites.Where(x => x.UserId == db.Users.First(u => u.Login == user).IdUser).ToList();
                foreach (var site in siteController.Sites)
                    siteController.Sites.First(s => s == site).TemplateInfo = db.Templates.First(t => t.IdTemplate == site.TemplateId);
            }
            return View(siteController);
        }
        [HttpPost]
        public IActionResult UpdateSite(SiteControlModel controlModel)
        {
            HttpContext.Session.SetString("SiteData", controlModel.Site);
            return RedirectToAction("PageToEdit", "Template");
        }
        [HttpPost]
        public IActionResult DeleteSite(SiteControlModel controlModel)
        {
            var site = (Site)JsonConvert.DeserializeObject(controlModel.Site, typeof(Site));
            var siteToRemove = db.Sites.First(x => x.IdSite == site.IdSite);
            db.Sites.Remove(siteToRemove);
            db.SaveChanges();
            return RedirectToAction("MySites", "Home");
        }


        public IActionResult Templates()
        {
            var templates = db.Templates.ToList();
            return View(templates);
        }

        [HttpPost]
        public IActionResult EditTemplatesPost(string html)
        {
            string user = "";
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html lang=\"ru_RU\"> " +
                "\n <head> \n " +
                "<meta charset=\"utf - 8\"> \n" +
                "<meta name=\"viewport\" content=\"width = device - width, initial - scale = 1.0\"> \n" +
                "<title>Тестовый</title> \n" +
                "<link href=\"css/bootstrap.min.css\" rel=\"stylesheet\"/> \n" +
                "<link href=\"css/bootstrap.css\" rel=\"stylesheet\"/> \n" +
                "<link href=\"css/mainMeow.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/responsive.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/Themes.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/TypeHeader_1.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/TypeHeader_2.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/TypeFooter_1.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/NewTextEdit.css\" rel=\"stylesheet\" \n/>" +
                "</head> \n" +
                "<body style=\"padding: inherit; overflow - x: hidden;\"> \n" +
                html +
                "\n </body> \n" +
                "</html>";
            currentHtml = currentHtml.Replace("/images", "images");
            currentHtml = currentHtml.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");

            if (HttpContext.Session.Keys.Contains("AuthUser"))
                user = HttpContext.Session.GetString("AuthUser"); 

            string directory = System.Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + $@"\{user}-проекты";
            if (!System.IO.Directory.Exists(directory))
                System.IO.Directory.CreateDirectory(directory);
            System.IO.File.WriteAllText(directory + @"\index.html", currentHtml);
            Directory.CreateDirectory(directory + "\\css");
            Directory.CreateDirectory(directory + "\\images");
            string[] reqiredCss = new[] { "bootstrap.min.css", "bootstrap.css", "mainMeow.css", "responsive.css", "Themes.css", "TypeHeader_1.css", "TypeHeader_2.css", "TypeFooter_1.css", "NewTextEdit.css" };
            string[] filePaths = Directory.GetFiles(_environment.WebRootPath + "\\css\\main\\");
            foreach (var filePath in filePaths)
            {
                if (reqiredCss.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newPath = directory + "\\css\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newPath, true);
                    }
                }

            }

            string[] pathImg = Directory.GetFiles(_environment.WebRootPath + "\\images\\");
            foreach (var filePath in pathImg)
            {
                if (html.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newPath = directory + "\\images\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newPath, true);
                    }
                }

            }

            return Ok();
        }

        public IActionResult EditTemplates()
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            return View(imageModel);
        }

        [HttpPost]
        public IActionResult EditTemplates(string name)
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            if (HttpContext.Request.Form.Files != null)
            {
                var file = HttpContext.Request.Form.Files.First();
                if (file.Length > 0)
                {
                    string fileName = ContentDispositionHeaderValue.Parse(file.ContentDisposition).FileName.Trim('"');

                    var myUniqueFileName = Convert.ToString(Guid.NewGuid());
                    var FileExtension = Path.GetExtension(fileName);
                    string newFileName = myUniqueFileName + FileExtension;
                    fileName = Path.Combine(_environment.WebRootPath, "demoimages") + $@"\{newFileName}";

                    using (FileStream fs = System.IO.File.Create(fileName))
                    {
                        file.CopyTo(fs);
                        fs.Flush();
                    }
                    imageModel.UrlImage = $"/demoimages/{newFileName}";
                }
            }
            return View(imageModel);
        }

        public IActionResult Profile()
        {
            var profile = new User();
            if (HttpContext.Session.Keys.Contains("AuthUser"))
            {
                
               var user = HttpContext.Session.GetString("AuthUser");
               profile = db.Users.First(x => x.Login == user);
            }
            return View(profile);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public IActionResult EditProfile(User user)
        {
            if (ModelState.IsValid)
            {
                //var index = db.Users.ToList().FindIndex(x => x.IdUser == user.IdUser);
                db.Users.Update(user);
                db.SaveChanges();
                return RedirectToAction("Profile");
            }

            else
            {
                return View(user);
            }

         
        }


        public IActionResult SavetoUser(string html)
        {
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            var sites = new Site();
            var user = "";
            sites.Name = "NewSite";
            if (HttpContext.Session.Keys.Contains("AuthUser"))
                user = HttpContext.Session.GetString("AuthUser");
            sites.UserId = db.Users.First(x => x.Login == user).IdUser.Value;
            sites.Folder = currentHtml;
            sites.TemplateId = Convert.ToInt32(html.Substring(html.IndexOf("id=\"templateId ") + 15, 1));
            db.Sites.Add(sites);
            db.SaveChanges();
            return RedirectToAction("MySites", "Home");
        }

        [HttpPost]
        public IActionResult ChangeName(string site, int idSite)
        {
            db.Sites.First(x => x.IdSite.Value == idSite).Name = site;
            db.SaveChanges();
            return RedirectToAction("MySites", "Home");
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
