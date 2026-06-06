using Lime_Editor.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http.Headers;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    public class HomeController : Controller
    {
        private readonly IWebHostEnvironment _environment;
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly SignInManager<ApplicationUser> _signInManager;

        public HomeController(
            IWebHostEnvironment environment,
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            SignInManager<ApplicationUser> signInManager)
        {
            _environment = environment;
            db = context;
            _userManager = userManager;
            _signInManager = signInManager;
        }

        // Id текущего аутентифицированного пользователя (для [Authorize]-действий).
        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        // Проверка, что сайт принадлежит текущему пользователю (защита от IDOR).
        private async Task<bool> UserOwnsSiteAsync(int? siteId)
        {
            if (siteId == null)
            {
                return false;
            }
            return await db.Sites.AnyAsync(s => s.IdSite == siteId && s.UserId == CurrentUserId);
        }

        public IActionResult Index()
        {
            return View();
        }

        public IActionResult SignIn()
        {
            if (User.Identity != null && User.Identity.IsAuthenticated)
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
                var result = await _signInManager.PasswordSignInAsync(
                    model.Login, model.Password, isPersistent: false, lockoutOnFailure: true);
                if (result.Succeeded)
                {
                    return RedirectToAction("MySites", "Home");
                }
                ModelState.AddModelError("", "Некорректные логин и(или) пароль");
            }

            return View(model);
        }

        public async Task<IActionResult> Logout()
        {
            await _signInManager.SignOutAsync();
            return RedirectToAction("SignIn");
        }

        public IActionResult SignUp()
        {
            return View();
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SignUp(RegisterViewModel model)
        {
            if (ModelState.IsValid)
            {
                var user = new ApplicationUser { UserName = model.Login, Email = model.Email };
                var result = await _userManager.CreateAsync(user, model.Password);
                if (result.Succeeded)
                {
                    return RedirectToAction("SignIn");
                }

                foreach (var error in result.Errors)
                {
                    ModelState.AddModelError("", error.Description);
                }
            }

            return View(model);
        }

        [Authorize]
        public async Task<IActionResult> MySites()
        {
            var userId = CurrentUserId;
            var siteController = new SiteControlModel
            {
                Sites = await db.Sites.Where(s => s.UserId == userId).ToListAsync()
            };
            foreach (var site in siteController.Sites)
            {
                site.TemplateInfo = await db.Templates.FirstOrDefaultAsync(t => t.IdTemplate == site.TemplateId);
            }
            return View(siteController);
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> UpdateSite(SiteControlModel controlModel)
        {
            var site = (Site)JsonConvert.DeserializeObject(controlModel.Site, typeof(Site));
            if (!await UserOwnsSiteAsync(site.IdSite))
            {
                return Forbid();
            }
            HttpContext.Session.SetString("SiteData", controlModel.Site);
            return RedirectToAction("PageToEdit", "Template");
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> DeleteSite(SiteControlModel controlModel)
        {
            var site = (Site)JsonConvert.DeserializeObject(controlModel.Site, typeof(Site));
            if (!await UserOwnsSiteAsync(site.IdSite))
            {
                return Forbid();
            }
            var siteToRemove = await db.Sites.FirstAsync(x => x.IdSite == site.IdSite);
            db.Sites.Remove(siteToRemove);
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        [Authorize]
        public async Task<IActionResult> Templates()
        {
            var templates = await db.Templates.ToListAsync();
            return View(templates);
        }

        [Authorize]
        [HttpPost]
        public IActionResult EditTemplatesPost(string html)
        {
            var user = User.Identity?.Name ?? "user";
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

        [Authorize]
        public IActionResult EditTemplates()
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            return View(imageModel);
        }

        [Authorize]
        [HttpPost]
        public IActionResult EditTemplates(string name)
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            if (HttpContext.Request.Form.Files != null && HttpContext.Request.Form.Files.Count > 0)
            {
                var file = HttpContext.Request.Form.Files.First();
                if (file.Length > 0)
                {
                    // Валидация загрузки: только изображения и ограничение размера.
                    const long maxBytes = 5 * 1024 * 1024; // 5 МБ
                    var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
                    var rawName = ContentDispositionHeaderValue.Parse(file.ContentDisposition).FileName.Trim('"');
                    var extension = Path.GetExtension(rawName).ToLowerInvariant();

                    if (file.Length > maxBytes || !allowedExtensions.Contains(extension)
                        || !file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                    {
                        return BadRequest("Допустимы только изображения до 5 МБ.");
                    }

                    var myUniqueFileName = Convert.ToString(Guid.NewGuid());
                    string newFileName = myUniqueFileName + extension;
                    var savePath = Path.Combine(_environment.WebRootPath, "demoimages", newFileName);

                    using (FileStream fs = System.IO.File.Create(savePath))
                    {
                        file.CopyTo(fs);
                        fs.Flush();
                    }
                    imageModel.UrlImage = $"/demoimages/{newFileName}";
                }
            }
            return View(imageModel);
        }

        [Authorize]
        public async Task<IActionResult> Profile()
        {
            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction("SignIn");
            }

            var model = new ProfileViewModel
            {
                Id = user.Id,
                Login = user.UserName,
                Email = user.Email,
                Name = user.Name,
                LastName = user.LastName
            };
            return View(model);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> EditProfile(ProfileViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return View("Profile", model);
            }

            // Текущий пользователь берётся из cookie, а не из формы — нельзя отредактировать чужой профиль.
            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction("SignIn");
            }

            user.Name = model.Name;
            user.LastName = model.LastName;
            user.Email = model.Email;
            user.UserName = model.Login;

            var updateResult = await _userManager.UpdateAsync(user);
            if (!updateResult.Succeeded)
            {
                foreach (var error in updateResult.Errors)
                {
                    ModelState.AddModelError("", error.Description);
                }
                return View("Profile", model);
            }

            if (!string.IsNullOrEmpty(model.Password))
            {
                var token = await _userManager.GeneratePasswordResetTokenAsync(user);
                await _userManager.ResetPasswordAsync(user, token, model.Password);
            }

            await _signInManager.RefreshSignInAsync(user);
            return RedirectToAction("Profile");
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> SavetoUser(string html)
        {
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            var sites = new Site
            {
                Name = "NewSite",
                UserId = CurrentUserId,
                Folder = currentHtml,
                TemplateId = Convert.ToInt32(html.Substring(html.IndexOf("id=\"templateId ") + 15, 1))
            };
            db.Sites.Add(sites);
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> ChangeName(string site, int idSite)
        {
            if (!await UserOwnsSiteAsync(idSite))
            {
                return Forbid();
            }
            var target = await db.Sites.FirstAsync(x => x.IdSite.Value == idSite);
            target.Name = site;
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
