using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Authorize]
    public class MediaController : Controller
    {
        public const string MediaFolder = "media";
        public const long MaxBytes = MediaUploadSecurity.MaxFileBytes;
        public static readonly string[] AllowedExtensions = MediaUploadSecurity.AllowedExtensions;
        private const int MaxStockQueryLength = 120;
        private const int MaxStockPage = 10;

        private readonly LimeEditorContext db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IMediaStorage _storage;
        private readonly IImageProcessor _imageProcessor;
        private readonly IHttpClientFactory _httpFactory;
        private readonly IEntitlementService _entitlements;

        public MediaController(
            LimeEditorContext context,
            UserManager<ApplicationUser> userManager,
            IMediaStorage storage,
            IImageProcessor imageProcessor,
            IHttpClientFactory httpFactory,
            IEntitlementService entitlements)
        {
            db = context;
            _userManager = userManager;
            _storage = storage;
            _imageProcessor = imageProcessor;
            _httpFactory = httpFactory;
            _entitlements = entitlements;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        public async Task<IActionResult> Index()
        {
            var userId = CurrentUserId;
            var items = await db.MediaAssets
                .Where(m => m.UserId == userId)
                .OrderByDescending(m => m.UploadedAt)
                .ToListAsync();
            ViewBag.UserId = userId;
            return View(items);
        }

        // JSON-эндпоинт для media-picker в конструкторе. Только свои файлы текущего юзера.
        [HttpGet]
        [Produces("application/json")]
        public async Task<IActionResult> ApiList()
        {
            var userId = CurrentUserId;
            // Материализуем, затем строим URL через хранилище (его нельзя звать внутри EF-проекции).
            var assets = await db.MediaAssets
                .Where(m => m.UserId == userId)
                .OrderByDescending(m => m.UploadedAt)
                .ToListAsync();
            var items = assets.Select(m => new
            {
                id = m.Id,
                url = _storage.PublicUrl(userId, m.StoredFileName),
                name = m.OriginalName,
                contentType = m.ContentType,
                sizeBytes = m.SizeBytes,
                uploadedAt = m.UploadedAt,
            });
            return Json(items);
        }

        // Прокси поиска фотостока (Pexels). Ключ — env STOCK_PEXELS_KEY; без него
        // фронту приходит { configured:false } и вкладка «Сток» показывает подсказку.
        // Отдаём только URL картинок (хотлинк) — тот же контракт, что у ApiList.
        [HttpGet]
        [Produces("application/json")]
        [EnableRateLimiting("external-api")]
        public async Task<IActionResult> Stock(string q, int page = 1)
        {
            q = q?.Trim();
            if (!string.IsNullOrEmpty(q) && q.Length > MaxStockQueryLength)
            {
                q = q.Substring(0, MaxStockQueryLength);
            }
            page = Math.Clamp(page, 1, MaxStockPage);

            var key = Environment.GetEnvironmentVariable("STOCK_PEXELS_KEY") ?? "";
            if (string.IsNullOrEmpty(key))
            {
                return Json(new { configured = false });
            }
            if (string.IsNullOrWhiteSpace(q))
            {
                return Json(new { configured = true, items = Array.Empty<object>() });
            }
            try
            {
                var http = _httpFactory.CreateClient("stock");
                var url = "https://api.pexels.com/v1/search?per_page=24&page=" + page +
                          "&query=" + Uri.EscapeDataString(q);
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.TryAddWithoutValidation("Authorization", key);
                using var resp = await http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    return Json(new { configured = true, items = Array.Empty<object>(), error = (int)resp.StatusCode });
                }
                var body = await resp.Content.ReadAsStringAsync();
                var json = Newtonsoft.Json.Linq.JObject.Parse(body);
                var photos = json["photos"] as Newtonsoft.Json.Linq.JArray ?? new Newtonsoft.Json.Linq.JArray();
                var items = photos
                    .Select(p => new
                    {
                        url = (string)(p["src"]?["large"]) ?? (string)(p["src"]?["original"]),
                        thumb = (string)(p["src"]?["medium"]) ?? (string)(p["src"]?["large"]),
                        name = (string)(p["alt"]) ?? "Pexels",
                    })
                    .Where(x => !string.IsNullOrEmpty(x.url))
                    .ToArray();
                return Json(new { configured = true, items });
            }
            catch
            {
                return Json(new { configured = true, items = Array.Empty<object>(), error = -1 });
            }
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(MediaUploadSecurity.MaxUploadRequestBytes)]
        [EnableRateLimiting("upload")]
        public async Task<IActionResult> Upload(IFormFile file)
        {
            if (file == null || file.Length == 0)
            {
                TempData["Error"] = "Файл не выбран.";
                return RedirectToAction(nameof(Index));
            }

            // Размер + MIME + расширение — три уровня проверки.
            if (file.Length > MaxBytes)
            {
                TempData["Error"] = $"Файл больше {MaxBytes / 1024 / 1024} МБ.";
                return RedirectToAction(nameof(Index));
            }
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!AllowedExtensions.Contains(ext))
            {
                TempData["Error"] = "Допустимы только " + string.Join(", ", AllowedExtensions);
                return RedirectToAction(nameof(Index));
            }
            if (!MediaUploadSecurity.IsAllowedContentType(ext, file.ContentType))
            {
                TempData["Error"] = "Файл должен быть изображением.";
                return RedirectToAction(nameof(Index));
            }

            // Лимит хранилища по тарифу (этап 3.4). file.Length — верхняя оценка (после сжатия меньше).
            if (!await _entitlements.CanUploadAsync(OwnerRef.ForUser(CurrentUserId), file.Length))
            {
                TempData["Error"] = "Достигнут лимит хранилища по вашему тарифу.";
                return RedirectToAction(nameof(Index));
            }

            // Сжимаем сервером: ресайз до 1920px, JPEG q82 (либо сохраняем PNG/WebP/GIF в их формате).
            // В буфер сначала, потом через процессор, потом на диск — иначе нельзя гарантировать
            // что Content-Length формы соответствует реальному файлу.
            ProcessedImage processed;
            try
            {
                await using var memory = new MemoryStream();
                await file.CopyToAsync(memory);
                var uploadedBytes = memory.ToArray();
                var signatureLength = Math.Min(uploadedBytes.Length, MediaUploadSecurity.SignatureLength);
                if (!MediaUploadSecurity.HasAllowedSignature(ext, uploadedBytes.AsSpan(0, signatureLength)))
                {
                    TempData["Error"] = "Формат файла не совпадает с расширением.";
                    return RedirectToAction(nameof(Index));
                }

                using var imageInput = new MemoryStream(uploadedBytes, writable: false);
                processed = await _imageProcessor.ProcessAsync(imageInput, ext);
            }
            catch (Exception ex) when (ex is InvalidDataException || ex is UnknownImageFormatException || ex is ImageFormatException)
            {
                TempData["Error"] = "Не удалось обработать изображение: " + ex.Message;
                return RedirectToAction(nameof(Index));
            }

            var userId = CurrentUserId;
            // Имя в хранилище — Guid + расширение от процессора (может отличаться от исходного, напр. .jpeg → .jpg).
            var storedName = Guid.NewGuid().ToString("N") + processed.Extension;
            await _storage.SaveAsync(userId, storedName, processed.Bytes);

            db.MediaAssets.Add(new MediaAsset
            {
                UserId = userId,
                OriginalName = Path.GetFileName(file.FileName),
                StoredFileName = storedName,
                ContentType = processed.ContentType,
                SizeBytes = processed.Bytes.LongLength,
                UploadedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();

            return RedirectToAction(nameof(Index));
        }


        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(RequestBodyLimits.SmallFormBytes)]
        public async Task<IActionResult> Delete(int id)
        {
            var userId = CurrentUserId;
            // Ownership-check встроена в WHERE — чужой id просто не найдётся.
            var asset = await db.MediaAssets.FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId);
            if (asset == null)
            {
                return NotFound();
            }

            _storage.Delete(userId, asset.StoredFileName);
            db.MediaAssets.Remove(asset);
            await db.SaveChangesAsync();
            return RedirectToAction(nameof(Index));
        }
    }
}
