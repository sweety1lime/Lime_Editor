using Amazon.S3;
using Amazon.S3.Model;
using Serilog;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // S3-совместимое хранилище медиа (AWS S3 / Cloudflare R2 / MinIO) за IMediaStorage.
    // Включается конфигом MediaStorage:Provider=s3 (см. Startup) — до этого весь код живёт
    // на LocalDiskMediaStorage, контроллеры не меняются вообще (ради этого абстракция и вводилась).
    //
    // Раскладка ключей — та же, что на диске: {userId}/{storedFileName}. Публичные URL строятся
    // от MediaStorage:S3:PublicBaseUrl (публичный домен бакета/CDN, например https://media.example.com):
    // приложение файлы НЕ проксирует, их отдаёт сам бакет — иначе терялся бы смысл выноса.
    public sealed class S3MediaStorage : IMediaStorage
    {
        private readonly IAmazonS3 _s3;
        private readonly string _bucket;
        private readonly string _publicBaseUrl;

        public S3MediaStorage(IAmazonS3 s3, string bucket, string publicBaseUrl)
        {
            if (string.IsNullOrWhiteSpace(bucket))
            {
                throw new ArgumentException("S3 bucket must be configured.", nameof(bucket));
            }
            if (string.IsNullOrWhiteSpace(publicBaseUrl))
            {
                throw new ArgumentException("S3 public base URL must be configured.", nameof(publicBaseUrl));
            }

            _s3 = s3;
            _bucket = bucket;
            _publicBaseUrl = publicBaseUrl.TrimEnd('/');
        }

        // Не файловое хранилище: orphan-cleanup по диску не применяется,
        // его роль берут lifecycle-правила бакета.
        public string LocalRootForMaintenance => null;

        public async Task SaveAsync(int userId, string storedFileName, byte[] bytes, CancellationToken ct = default)
        {
            var key = SafeKey(userId, storedFileName);
            using var stream = new MemoryStream(bytes, writable: false);
            await _s3.PutObjectAsync(new PutObjectRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = stream,
                ContentType = ContentTypeOf(storedFileName),
                // Контент под GUID-именами не меняется никогда — тот же кэш-контракт,
                // что у StaticFiles для /media (см. Startup.OnPrepareResponse).
                Headers = { CacheControl = "public, max-age=31536000, immutable" },
            }, ct);
        }

        public void Delete(int userId, string storedFileName)
        {
            if (!StoredFileNames.IsSafe(storedFileName))
            {
                Log.Warning("Rejected unsafe media file name {StoredFileName} for user {UserId}", storedFileName, userId);
                return;
            }

            try
            {
                _s3.DeleteObjectAsync(new DeleteObjectRequest
                {
                    BucketName = _bucket,
                    Key = $"{userId}/{storedFileName}",
                }).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                // Не валим вызывающую операцию из-за сетевой ошибки — файл-сирота дешевле,
                // чем сломанное удаление ассета (его добьёт lifecycle-правило бакета).
                Log.Warning(ex, "Не удалось удалить медиа {StoredFileName} пользователя {UserId} из S3", storedFileName, userId);
            }
        }

        public void DeleteUserFolder(int userId)
        {
            try
            {
                string continuationToken = null;
                do
                {
                    var page = _s3.ListObjectsV2Async(new ListObjectsV2Request
                    {
                        BucketName = _bucket,
                        Prefix = $"{userId}/",
                        ContinuationToken = continuationToken,
                    }).GetAwaiter().GetResult();

                    if (page.S3Objects.Count > 0)
                    {
                        _s3.DeleteObjectsAsync(new DeleteObjectsRequest
                        {
                            BucketName = _bucket,
                            Objects = page.S3Objects.Select(o => new KeyVersion { Key = o.Key }).ToList(),
                        }).GetAwaiter().GetResult();
                    }

                    continuationToken = page.IsTruncated == true ? page.NextContinuationToken : null;
                } while (continuationToken != null);
            }
            catch (Exception ex)
            {
                // Как и на диске: удаление аккаунта не должно падать из-за файловой ошибки.
                Log.Warning(ex, "Не удалось удалить медиа-префикс пользователя {UserId} из S3", userId);
            }
        }

        public string PublicUrl(int userId, string storedFileName)
        {
            if (!StoredFileNames.IsSafe(storedFileName))
            {
                throw new ArgumentException("Stored file name must not contain path segments.", nameof(storedFileName));
            }

            return $"{_publicBaseUrl}/{userId}/{Uri.EscapeDataString(storedFileName)}";
        }

        private static string SafeKey(int userId, string storedFileName)
        {
            if (!StoredFileNames.IsSafe(storedFileName))
            {
                throw new ArgumentException("Stored file name must not contain path segments.", nameof(storedFileName));
            }

            return $"{userId}/{storedFileName}";
        }

        // Content-Type в объекте нужен бакету, который отдаёт файл сам (без нашего StaticFiles).
        private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
            [".gif"] = "image/gif",
            [".webp"] = "image/webp",
            [".svg"] = "image/svg+xml",
            [".woff2"] = "font/woff2",
            [".woff"] = "font/woff",
            [".json"] = "application/json",
            [".mp4"] = "video/mp4",
            [".webm"] = "video/webm",
        };

        private static string ContentTypeOf(string storedFileName)
        {
            var ext = Path.GetExtension(storedFileName);
            return ext != null && ContentTypes.TryGetValue(ext, out var ct) ? ct : "application/octet-stream";
        }
    }

    // Общая проверка имени файла в хранилище: GUID+расширение из MediaController, без
    // путевых сегментов. Вынесена из LocalDiskMediaStorage, чтобы S3-адаптер не дублировал.
    public static class StoredFileNames
    {
        public static bool IsSafe(string storedFileName)
        {
            return !string.IsNullOrWhiteSpace(storedFileName) &&
                   storedFileName.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 &&
                   storedFileName.IndexOf('/') < 0 &&
                   storedFileName.IndexOf('\\') < 0 &&
                   string.Equals(storedFileName, Path.GetFileName(storedFileName), StringComparison.Ordinal);
        }
    }
}
