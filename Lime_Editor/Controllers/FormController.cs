using Lime_Editor.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // Приём лидов с опубликованных сайтов + инбокс заявок для владельца.
    // Submit публичный (анонимный, без antiforgery — публичная страница статична и токена не несёт),
    // защита от спама: honeypot-поле + мягкий timetrap. Инбокс — только для владельца сайта.
    public class FormController : Controller
    {
        // Служебные поля, которые не сохраняем как данные заявки.
        private const string HoneypotField = "lime_hp";
        private const string SiteIdField = "__siteId";
        private const string TimestampField = "lime_ts";
        private const string CollectionField = "__collection";

        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;

        public FormController(LimeEditorContext context, UserManager<ApplicationUser> userManager)
        {
            db = context;
            _userManager = userManager;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        [AllowAnonymous]
        [HttpPost]
        [IgnoreAntiforgeryToken] // публичная статичная страница токена не несёт; защита — honeypot+timetrap
        [EnableRateLimiting("public-write")] // анти-спам по IP
        public async Task<IActionResult> Submit()
        {
            var form = Request.Form;

            // 1) Honeypot: поле скрыто от людей; если заполнено — это бот. Молча «принимаем» и выходим.
            if (!string.IsNullOrEmpty(form[HoneypotField]))
            {
                return BackToSite(form, sent: false);
            }

            // 2) Сайт должен существовать и быть опубликованным.
            if (!int.TryParse(form[SiteIdField], out var siteId))
            {
                return BadRequest();
            }
            // Публичный приём формы: проверяем чужой опубликованный сайт — обходим tenant-фильтр.
            var siteExists = await db.Sites
                .AsNoTracking()
                .IgnoreQueryFilters()
                .AnyAsync(s => s.IdSite == siteId && s.IsPublished);
            if (!siteExists)
            {
                return NotFound();
            }

            // 3) Timetrap (мягкий): метку времени вставляет сервер при отдаче страницы.
            //    Мгновенная (бот) или устаревшая отправка — отбрасываем без сохранения.
            if (long.TryParse(form[TimestampField], out var ts))
            {
                var ageSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts;
                if (ageSeconds < 1 || ageSeconds > 86400)
                {
                    return BackToSite(form, sent: false);
                }
            }

            // 4) Собираем поля формы (кроме служебных) в словарь.
            var data = new Dictionary<string, string>();
            foreach (var kv in form)
            {
                if (kv.Key == HoneypotField || kv.Key == SiteIdField || kv.Key == TimestampField || kv.Key == CollectionField)
                {
                    continue;
                }
                data[kv.Key] = kv.Value.ToString();
            }
            if (data.Count == 0)
            {
                return BackToSite(form, sent: false);
            }

            // Фуллстак: если форма нацелена на коллекцию данных сайта — пишем запись туда.
            var collectionSlug = form[CollectionField].ToString();
            if (!string.IsNullOrEmpty(collectionSlug))
            {
                var collection = await db.Collections
                    .FirstOrDefaultAsync(c => c.SiteId == siteId && c.Slug == collectionSlug);
                if (collection != null)
                {
                    db.CollectionRecords.Add(new CollectionRecord
                    {
                        CollectionId = collection.Id,
                        DataJson = JsonConvert.SerializeObject(data),
                        CreatedAt = DateTime.UtcNow,
                    });
                    await db.SaveChangesAsync();
                    return BackToSite(form, sent: true);
                }
                // Коллекция не найдена/чужая → не теряем заявку, падаем в обычный инбокс.
            }

            db.FormSubmissions.Add(new FormSubmission
            {
                SiteId = siteId,
                DataJson = JsonConvert.SerializeObject(data),
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
                SubmittedAt = DateTime.UtcNow,
                IsRead = false,
            });
            await db.SaveChangesAsync();

            return BackToSite(form, sent: true);
        }

        // Возврат посетителя обратно на страницу сайта (по Referer). Если Referer нет —
        // отдаём минимальную страницу «Спасибо».
        private IActionResult BackToSite(Microsoft.AspNetCore.Http.IFormCollection form, bool sent)
        {
            var referer = Request.Headers["Referer"].ToString();
            if (!string.IsNullOrEmpty(referer))
            {
                var sep = referer.Contains('?') ? "&" : "?";
                return Redirect(sent ? $"{referer}{sep}lime_sent=1#lime-form" : referer);
            }
            if (sent)
            {
                return Content(
                    "<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;text-align:center;padding:48px;\">" +
                    "<h1>Спасибо! 🎉</h1><p>Заявка отправлена.</p></body></html>",
                    "text/html; charset=utf-8");
            }
            return Ok();
        }

        [Authorize]
        public async Task<IActionResult> Inbox(int siteId)
        {
            var userId = CurrentUserId;
            var site = await db.Sites
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId);
            if (site == null)
            {
                return Forbid();
            }

            var submissions = await db.FormSubmissions
                .Where(f => f.SiteId == siteId)
                .OrderByDescending(f => f.SubmittedAt)
                .ToListAsync();

            // Помечаем новые как прочитанные — бейдж «новые» в личном кабинете обнулится.
            var unread = submissions.Where(f => !f.IsRead).ToList();
            if (unread.Count > 0)
            {
                foreach (var f in unread)
                {
                    f.IsRead = true;
                }
                await db.SaveChangesAsync();
            }

            ViewBag.SiteName = site.Name;
            ViewBag.SiteId = siteId;
            return View(submissions);
        }

        [Authorize]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DeleteSubmission(int id)
        {
            var userId = CurrentUserId;
            var sub = await db.FormSubmissions.FirstOrDefaultAsync(f => f.Id == id);
            if (sub == null)
            {
                return NotFound();
            }
            // Ownership: заявку можно удалить только владельцу её сайта.
            var owns = await db.Sites.AnyAsync(s => s.IdSite == sub.SiteId && s.UserId == userId);
            if (!owns)
            {
                return Forbid();
            }

            var siteId = sub.SiteId;
            db.FormSubmissions.Remove(sub);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Inbox), new { siteId });
        }
    }
}
