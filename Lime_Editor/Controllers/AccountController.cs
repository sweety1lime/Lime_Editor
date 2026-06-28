using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Route("Home")]
    public class AccountController : Controller
    {
        private readonly IMediaStorage _mediaStorage;
        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly SignInManager<ApplicationUser> _signInManager;
        private readonly IEmailSender _emailSender;

        public AccountController(
            IMediaStorage mediaStorage,
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            SignInManager<ApplicationUser> signInManager,
            IEmailSender emailSender)
        {
            _mediaStorage = mediaStorage;
            db = context;
            _userManager = userManager;
            _signInManager = signInManager;
            _emailSender = emailSender;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        private static string HomeView(string name) => $"~/Views/Home/{name}.cshtml";

        [HttpGet("SignIn")]
        public IActionResult SignIn()
        {
            if (User.Identity != null && User.Identity.IsAuthenticated)
            {
                return RedirectToAction("MySites", "Home");
            }

            return View(HomeView("SignIn"));
        }

        [HttpPost("SignIn")]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("auth")]
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

            return View(HomeView("SignIn"), model);
        }

        [HttpGet("Logout")]
        public async Task<IActionResult> Logout()
        {
            await _signInManager.SignOutAsync();
            return RedirectToAction(nameof(SignIn));
        }

        [HttpGet("ForgotPassword")]
        public IActionResult ForgotPassword()
        {
            return View(HomeView("ForgotPassword"));
        }

        [HttpPost("ForgotPassword")]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("auth")]
        public async Task<IActionResult> ForgotPassword(string email)
        {
            if (!string.IsNullOrWhiteSpace(email))
            {
                var user = await _userManager.FindByEmailAsync(email);
                if (user != null)
                {
                    var token = await _userManager.GeneratePasswordResetTokenAsync(user);
                    var encoded = WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(token));
                    var link = Url.Action(nameof(ResetPassword), null,
                        new { email = user.Email, token = encoded }, Request.Scheme);
                    var html = $"<p>Чтобы задать новый пароль в Lime, перейдите по ссылке:</p>" +
                               $"<p><a href=\"{link}\">Сбросить пароль</a></p>" +
                               $"<p>Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>";
                    await _emailSender.SendAsync(user.Email, "Сброс пароля — Lime", html);
                }
            }

            ViewBag.Sent = true;
            return View(HomeView("ForgotPassword"));
        }

        [HttpGet("ResetPassword")]
        public IActionResult ResetPassword(string email, string token)
        {
            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(token))
            {
                return RedirectToAction(nameof(SignIn));
            }

            ViewBag.Email = email;
            ViewBag.Token = token;
            return View(HomeView("ResetPassword"));
        }

        [HttpPost("ResetPassword")]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("auth")]
        public async Task<IActionResult> ResetPassword(string email, string token, string password)
        {
            ViewBag.Email = email;
            ViewBag.Token = token;
            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(token) || string.IsNullOrEmpty(password))
            {
                ModelState.AddModelError("", "Заполните новый пароль.");
                return View(HomeView("ResetPassword"));
            }

            var user = await _userManager.FindByEmailAsync(email);
            if (user == null)
            {
                ModelState.AddModelError("", "Ссылка недействительна или устарела.");
                return View(HomeView("ResetPassword"));
            }

            string decoded;
            try
            {
                decoded = System.Text.Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token));
            }
            catch (FormatException)
            {
                ModelState.AddModelError("", "Ссылка недействительна или устарела.");
                return View(HomeView("ResetPassword"));
            }

            var result = await _userManager.ResetPasswordAsync(user, decoded, password);
            if (!result.Succeeded)
            {
                foreach (var error in result.Errors)
                {
                    ModelState.AddModelError("", error.Description);
                }

                return View(HomeView("ResetPassword"));
            }

            TempData["Message"] = "Пароль обновлён — войдите с новым паролем.";
            return RedirectToAction(nameof(SignIn));
        }

        [HttpGet("SignUp")]
        public IActionResult SignUp()
        {
            return View(HomeView("SignUp"));
        }

        [HttpPost("SignUp")]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("auth")]
        public async Task<IActionResult> SignUp(RegisterViewModel model)
        {
            if (ModelState.IsValid)
            {
                var user = new ApplicationUser { UserName = model.Login, Email = model.Email };
                var result = await _userManager.CreateAsync(user, model.Password);
                if (result.Succeeded)
                {
                    return RedirectToAction(nameof(SignIn));
                }

                foreach (var error in result.Errors)
                {
                    ModelState.AddModelError("", error.Description);
                }
            }

            return View(HomeView("SignUp"), model);
        }

        [Authorize]
        [HttpGet("Profile")]
        public async Task<IActionResult> Profile()
        {
            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction(nameof(SignIn));
            }

            var model = new ProfileViewModel
            {
                Id = user.Id,
                Login = user.UserName,
                Email = user.Email,
                Name = user.Name,
                LastName = user.LastName
            };

            return View(HomeView("Profile"), model);
        }

        [Authorize]
        [HttpPost("EditProfile")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> EditProfile(ProfileViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return View(HomeView("Profile"), model);
            }

            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction(nameof(SignIn));
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

                return View(HomeView("Profile"), model);
            }

            if (!string.IsNullOrEmpty(model.Password))
            {
                var token = await _userManager.GeneratePasswordResetTokenAsync(user);
                await _userManager.ResetPasswordAsync(user, token, model.Password);
            }

            await _signInManager.RefreshSignInAsync(user);
            return RedirectToAction(nameof(Profile));
        }

        [Authorize]
        [HttpGet("ExportMyData")]
        public async Task<IActionResult> ExportMyData()
        {
            var userId = CurrentUserId;
            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction(nameof(SignIn));
            }

            var sites = await db.Sites.AsNoTracking().Where(s => s.UserId == userId).ToListAsync();
            var siteIds = sites.Select(s => s.IdSite).ToList();
            var media = await db.MediaAssets.AsNoTracking().Where(m => m.UserId == userId).ToListAsync();
            var collections = await db.Collections.AsNoTracking().Where(c => siteIds.Contains(c.SiteId)).ToListAsync();
            var collectionIds = collections.Select(c => c.Id).ToList();
            var records = await db.CollectionRecords.AsNoTracking().Where(r => collectionIds.Contains(r.CollectionId)).ToListAsync();
            var forms = await db.FormSubmissions.AsNoTracking().Where(f => siteIds.Contains(f.SiteId)).ToListAsync();
            var subscriptions = await db.Subscriptions.AsNoTracking()
                .Where(s => s.OwnerKind == OwnerKind.User && s.OwnerId == userId).ToListAsync();
            var usage = await db.UsageCounters.AsNoTracking()
                .Where(u => u.OwnerKind == OwnerKind.User && u.OwnerId == userId).ToListAsync();

            var export = new
            {
                exportedAt = DateTime.UtcNow,
                profile = new { user.Id, user.UserName, user.Email, user.Name, user.LastName },
                sites,
                media,
                collections,
                records,
                forms,
                subscriptions,
                usage
            };
            var json = JsonConvert.SerializeObject(export, Formatting.Indented);
            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            return File(bytes, "application/json", $"lime-data-{userId}-{DateTime.UtcNow:yyyyMMdd}.json");
        }

        [Authorize]
        [HttpPost("DeleteMyAccount")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DeleteMyAccount(string password)
        {
            var user = await _userManager.GetUserAsync(User);
            if (user == null)
            {
                return RedirectToAction(nameof(SignIn));
            }

            if (string.IsNullOrEmpty(password) || !await _userManager.CheckPasswordAsync(user, password))
            {
                TempData["Error"] = "Неверный пароль — аккаунт не удалён.";
                return RedirectToAction(nameof(Profile));
            }

            var userId = user.Id;

            var subs = db.Subscriptions.Where(s => s.OwnerKind == OwnerKind.User && s.OwnerId == userId);
            var counters = db.UsageCounters.Where(u => u.OwnerKind == OwnerKind.User && u.OwnerId == userId);
            db.Subscriptions.RemoveRange(subs);
            db.UsageCounters.RemoveRange(counters);
            await db.SaveChangesAsync();

            await _signInManager.SignOutAsync();
            var result = await _userManager.DeleteAsync(user);
            if (!result.Succeeded)
            {
                Serilog.Log.Error("Не удалось удалить аккаунт {UserId}: {Errors}", userId,
                    string.Join("; ", result.Errors.Select(e => e.Description)));
                TempData["Error"] = "Не удалось удалить аккаунт. Попробуйте позже.";
                return RedirectToAction(nameof(Profile));
            }

            _mediaStorage.DeleteUserFolder(userId);
            return RedirectToAction("Index", "Home");
        }
    }
}
