using Lime_Editor.Models;
using Lime_Editor.Services;
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
        private readonly ITemplateExportService _exportService;
        private readonly IDocumentRenderer _docRenderer;

        public HomeController(
            IWebHostEnvironment environment,
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            SignInManager<ApplicationUser> signInManager,
            ITemplateExportService exportService,
            IDocumentRenderer docRenderer)
        {
            _environment = environment;
            db = context;
            _userManager = userManager;
            _signInManager = signInManager;
            _exportService = exportService;
            _docRenderer = docRenderer;
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

        public async Task<IActionResult> Index()
        {
            if (User?.Identity?.IsAuthenticated == true)
            {
                return RedirectToAction(nameof(MySites));
            }
            // На лендинге показываем 3 публичных шаблона (без Custom Id=4).
            var templates = await db.Templates
                .AsNoTracking()
                .Where(t => t.IdTemplate != TemplateExportConfigs.CustomTemplateId)
                .OrderBy(t => t.IdTemplate)
                .ToListAsync();
            return View(templates);
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
            // Один запрос с LEFT JOIN вместо N+1 (раньше: 1 запрос Sites + по запросу на каждый сайт).
            var rows = await (
                from s in db.Sites
                where s.UserId == userId
                join t in db.Templates on s.TemplateId equals t.IdTemplate into tj
                from t in tj.DefaultIfEmpty()
                select new { Site = s, Template = t }
            ).ToListAsync();

            foreach (var row in rows)
            {
                row.Site.TemplateInfo = row.Template;
            }

            // Счётчик новых (непрочитанных) заявок на каждый сайт — для бейджа «Заявки (N)».
            var siteIds = rows.Select(r => r.Site.IdSite ?? 0).ToList();
            var leadCounts = await db.FormSubmissions
                .Where(f => !f.IsRead && siteIds.Contains(f.SiteId))
                .GroupBy(f => f.SiteId)
                .Select(g => new { SiteId = g.Key, Count = g.Count() })
                .ToListAsync();
            ViewBag.LeadCounts = leadCounts.ToDictionary(x => x.SiteId, x => x.Count);

            var model = new SiteControlModel { Sites = rows.Select(r => r.Site).ToList() };
            return View(model);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
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
        [ValidateAntiForgeryToken]
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

        // Новый редактор на JSON-движке (Трек B). Strangler: рядом со старым EditTemplates.
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
                var userId = CurrentUserId;
                var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId.Value && s.UserId == userId);
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
                // UPDATE — редактируем существующий Custom-сайт (пишем в черновик).
                var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId.Value && s.UserId == userId);
                if (site == null)
                {
                    return Forbid();
                }
                if (site.TemplateId != TemplateExportConfigs.CustomTemplateId)
                {
                    return BadRequest("Этот сайт нельзя редактировать через Custom-конструктор.");
                }
                // Optimistic concurrency (этап 0.4): клиент прислал версию, с которой
                // открыл документ. Расхождение = документ сохранён из другого окна —
                // 409, а не молчаливый last-write-wins.
                if (Site.IsVersionConflict(baseVersion, site.UpdatedAt))
                {
                    return Conflict(new { error = "version", version = site.UpdatedAt?.Ticks ?? 0 });
                }
                site.MetaTitle = metaTitle;
                site.MetaDescription = metaDescription;
                site.OgImage = ogImage;
                if (documentJson != null) site.DocumentJson = documentJson;
                site.DraftFolder = WrapCustomHtml(html, site);
                // Неопубликованный сайт держим синхронным (Folder обязателен в БД);
                // опубликованный — Folder меняется только при повторной Publish.
                if (!site.IsPublished)
                {
                    site.Folder = site.DraftFolder;
                }
                site.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
                // Автосейву возвращаем свежую версию — клиент продолжает цепочку с неё.
                return auto ? Json(new { version = site.UpdatedAt.Value.Ticks }) : RedirectToAction("MySites");
            }

            // CREATE — новый сайт.
            var name = "Новый сайт";
            var slug = await GenerateUniqueSlugAsync(userId, name);
            var created = new Site
            {
                Name = name,
                UserId = userId,
                TemplateId = TemplateExportConfigs.CustomTemplateId,
                Slug = slug,
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
            return auto ? Json(new { version = created.UpdatedAt.Value.Ticks }) : RedirectToAction("MySites");
        }

        // Wrap для сохранения Folder в БД вынесен в Services.PublishedPageBuilder (этап 0.2) —
        // он нужен и Publish здесь, и RepublishAll в админке.
        private static string WrapCustomHtml(string innerHtml, Site site)
            => Services.PublishedPageBuilder.WrapCustomHtml(innerHtml, site);

        private async Task<string> GenerateUniqueSlugAsync(int userId, string baseName)
        {
            var baseSlug = SlugGenerator.Generate(baseName);
            var slug = baseSlug;
            var i = 1;
            while (await db.Sites.AnyAsync(s => s.UserId == userId && s.Slug == slug))
            {
                slug = $"{baseSlug}-{i++}";
            }
            return slug;
        }

        [Authorize]
        public async Task<IActionResult> EditTemplates(int? siteId)
        {
            var vm = new ConstructorViewModel
            {
                SiteId = null,
                SiteName = "Новый сайт",
                BodyHtml = string.Empty,
            };
            if (siteId.HasValue)
            {
                var userId = CurrentUserId;
                var site = await db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId.Value && s.UserId == userId);
                if (site == null)
                {
                    return Forbid();
                }
                if (site.TemplateId != TemplateExportConfigs.CustomTemplateId)
                {
                    // Не Custom — отправляем в legacy-редактор через UpdateSite-flow (через сессию).
                    HttpContext.Session.SetString("SiteData", Newtonsoft.Json.JsonConvert.SerializeObject(site));
                    return RedirectToAction("PageToEdit", "Template");
                }
                vm.SiteId = site.IdSite;
                vm.SiteName = site.Name;
                vm.MetaTitle = site.MetaTitle;
                vm.MetaDescription = site.MetaDescription;
                vm.OgImage = site.OgImage;
                vm.DocumentJson = site.DocumentJson;
                // Редактируем черновик (если есть), иначе опубликованный снапшот.
                var editSource = string.IsNullOrEmpty(site.DraftFolder) ? site.Folder : site.DraftFolder;
                vm.BodyHtml = Services.PublishedHtmlSanitizer.ExtractBodyForEditor(editSource);
            }
            return View(vm);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
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
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SavetoUser(string html, int templateId)
        {
            var name = "Новый сайт";
            var slug = await GenerateUniqueSlugAsync(CurrentUserId, name);
            var currentHtml = "<!DOCTYPE html> \n " +
                "<html id=\"userSpace\" lang=\"ru_RU\"> " +
                html + "\n" +
                "</html>";
            db.Sites.Add(new Site
            {
                Name = name,
                UserId = CurrentUserId,
                Folder = currentHtml,
                TemplateId = templateId,
                Slug = slug,
                IsPublished = false,
            });
            await db.SaveChangesAsync();
            return RedirectToAction("MySites", "Home");
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Publish(int idSite)
        {
            if (!await UserOwnsSiteAsync(idSite))
            {
                return Forbid();
            }
            var target = await db.Sites.FirstAsync(s => s.IdSite == idSite);
            // Старые сайты (созданные до миграции AddPublishingAndCustomTemplate) имеют Slug = NULL —
            // на лету генерим уникальный slug из имени, иначе публичный URL будет /u/{user}/ → 404.
            if (string.IsNullOrEmpty(target.Slug))
            {
                target.Slug = await GenerateUniqueSlugAsync(CurrentUserId, target.Name);
            }
            if (!string.IsNullOrEmpty(target.DocumentJson))
            {
                // Движок B (этап 0.2): сервер сам компилирует publish-HTML из JSON тем же
                // lime-doc.js, что и клиент. Снапшот JSON фиксируем отдельно — DocumentJson
                // дальше живёт как черновик автосейва, а republish идёт из снапшота.
                target.PublishedDocumentJson = target.DocumentJson;
                var body = _docRenderer.RenderSite(target.PublishedDocumentJson);
                target.Folder = PublishedPageBuilder.WrapCustomHtml(body, target);
            }
            else if (!string.IsNullOrEmpty(target.DraftFolder))
            {
                // Legacy-путь: промоут клиентского черновика в опубликованный снапшот.
                target.Folder = target.DraftFolder;
            }
            target.IsPublished = true;
            target.PublishedAt = DateTime.UtcNow;
            // Сообщество (этап 3): опубликованный сайт по умолчанию виден в галерее
            // (он и так публичен по ссылке); скрыть можно кнопкой в «Мои сайты».
            target.ShowInGallery = true;
            await db.SaveChangesAsync();
            return RedirectToAction("MySites");
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Unpublish(int idSite)
        {
            if (!await UserOwnsSiteAsync(idSite))
            {
                return Forbid();
            }
            var target = await db.Sites.FirstAsync(s => s.IdSite == idSite);
            target.IsPublished = false;
            await db.SaveChangesAsync();
            return RedirectToAction("MySites");
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
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
