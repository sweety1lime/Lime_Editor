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
            var (error, _) = await UploadCoreAsync(file);
            if (error != null)
            {
                TempData["Error"] = error;
            }
            return RedirectToAction(nameof(Index));
        }

        // JSON-вариант того же аплоада — для XHR из конструктора (кастомные шрифты в модалке
        // темы, Lottie-JSON из инспектора). Общая логика — UploadCoreAsync, ответ { ok, url, ... }.
        [HttpPost]
        [ValidateAntiForgeryToken]
        [RequestSizeLimit(MediaUploadSecurity.MaxUploadRequestBytes)]
        [EnableRateLimiting("upload")]
        [Produces("application/json")]
        public async Task<IActionResult> ApiUpload(IFormFile file)
        {
            var (error, asset) = await UploadCoreAsync(file);
            if (error != null)
            {
                return BadRequest(new { ok = false, error });
            }
            return Json(new
            {
                ok = true,
                id = asset.Id,
                url = _storage.PublicUrl(asset.UserId, asset.StoredFileName),
                name = asset.OriginalName,
                contentType = asset.ContentType,
                sizeBytes = asset.SizeBytes,
            });
        }

        // Единый пайплайн аплоада: гейты (размер/расширение/MIME/тариф) → ветка по виду файла
        // (картинка → ImageSharp; SVG → санитайзер; шрифт/Lottie → структурная проверка,
        // сохранение как есть) → хранилище + запись MediaAsset. Возвращает (error, asset).
        private async Task<(string error, MediaAsset asset)> UploadCoreAsync(IFormFile file)
        {
            if (file == null || file.Length == 0)
            {
                return ("Файл не выбран.", null);
            }

            // Размер + MIME + расширение — три уровня проверки.
            if (file.Length > MaxBytes)
            {
                return ($"Файл больше {MaxBytes / 1024 / 1024} МБ.", null);
            }
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            var kind = MediaUploadSecurity.Classify(ext);
            if (kind == null)
            {
                return ("Допустимы только " + string.Join(", ", AllowedExtensions), null);
            }
            if (!MediaUploadSecurity.IsAllowedContentType(ext, file.ContentType))
            {
                return ("Тип файла не совпадает с расширением.", null);
            }

            // Лимит хранилища по тарифу (этап 3.4). file.Length — верхняя оценка (после сжатия меньше).
            if (!await _entitlements.CanUploadAsync(OwnerRef.ForUser(CurrentUserId), file.Length))
            {
                return ("Достигнут лимит хранилища по вашему тарифу.", null);
            }

            await using var memory = new MemoryStream();
            await file.CopyToAsync(memory);
            var uploadedBytes = memory.ToArray();

            byte[] finalBytes;
            string finalExtension;
            string finalContentType;

            switch (kind.Value)
            {
                case MediaKind.Image:
                {
                    var signatureLength = Math.Min(uploadedBytes.Length, MediaUploadSecurity.SignatureLength);
                    if (!MediaUploadSecurity.HasAllowedSignature(ext, uploadedBytes.AsSpan(0, signatureLength)))
                    {
                        return ("Формат файла не совпадает с расширением.", null);
                    }
                    // Сжимаем сервером: ресайз до 1920px, JPEG q82 (либо сохраняем PNG/WebP/GIF в их формате).
                    ProcessedImage processed;
                    try
                    {
                        using var imageInput = new MemoryStream(uploadedBytes, writable: false);
                        processed = await _imageProcessor.ProcessAsync(imageInput, ext);
                    }
                    catch (Exception ex) when (ex is InvalidDataException || ex is UnknownImageFormatException || ex is ImageFormatException)
                    {
                        return ("Не удалось обработать изображение: " + ex.Message, null);
                    }
                    finalBytes = processed.Bytes;
                    finalExtension = processed.Extension;
                    finalContentType = processed.ContentType;
                    break;
                }
                case MediaKind.Svg:
                {
                    if (!MediaUploadSecurity.LooksLikeSvg(uploadedBytes))
                    {
                        return ("Файл не похож на SVG.", null);
                    }
                    // Санитайзер: XML-парс без DTD + вычистка скриптоспособного (см. SvgSanitizer).
                    var sanitized = SvgSanitizer.Sanitize(System.Text.Encoding.UTF8.GetString(uploadedBytes));
                    if (sanitized == null)
                    {
                        return ("SVG не удалось разобрать (битый XML?).", null);
                    }
                    finalBytes = System.Text.Encoding.UTF8.GetBytes(sanitized);
                    finalExtension = ".svg";
                    finalContentType = "image/svg+xml";
                    break;
                }
                case MediaKind.Font:
                {
                    var signatureLength = Math.Min(uploadedBytes.Length, MediaUploadSecurity.SignatureLength);
                    if (!MediaUploadSecurity.HasAllowedSignature(ext, uploadedBytes.AsSpan(0, signatureLength)))
                    {
                        return ("Файл не похож на WOFF/WOFF2-шрифт.", null);
                    }
                    finalBytes = uploadedBytes;
                    finalExtension = ext;
                    finalContentType = ext == ".woff2" ? "font/woff2" : "font/woff";
                    break;
                }
                case MediaKind.LottieJson:
                default:
                {
                    if (!MediaUploadSecurity.LooksLikeJson(uploadedBytes))
                    {
                        return ("Файл не похож на JSON.", null);
                    }
                    // Честный парс + признаки Lottie (версия и слои) — чтобы /media не превращался
                    // в хостинг произвольных JSON.
                    try
                    {
                        var json = Newtonsoft.Json.Linq.JObject.Parse(System.Text.Encoding.UTF8.GetString(uploadedBytes));
                        if (json["v"] == null || json["layers"] is not Newtonsoft.Json.Linq.JArray)
                        {
                            return ("JSON не похож на Lottie-анимацию (нет v/layers).", null);
                        }
                    }
                    catch (Newtonsoft.Json.JsonException)
                    {
                        return ("JSON не удалось разобрать.", null);
                    }
                    finalBytes = uploadedBytes;
                    finalExtension = ".json";
                    finalContentType = "application/json";
                    break;
                }
            }

            var userId = CurrentUserId;
            // Имя в хранилище — Guid + расширение (у картинок может отличаться от исходного, напр. .jpeg → .jpg).
            var storedName = Guid.NewGuid().ToString("N") + finalExtension;
            await _storage.SaveAsync(userId, storedName, finalBytes);

            var asset = new MediaAsset
            {
                UserId = userId,
                OriginalName = Path.GetFileName(file.FileName),
                StoredFileName = storedName,
                ContentType = finalContentType,
                SizeBytes = finalBytes.LongLength,
                UploadedAt = DateTime.UtcNow,
            };
            db.MediaAssets.Add(asset);
            await db.SaveChangesAsync();
            return (null, asset);
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
