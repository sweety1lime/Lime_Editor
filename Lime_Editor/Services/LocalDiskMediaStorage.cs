using Microsoft.AspNetCore.Hosting;
using Serilog;
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Дефолтное хранилище: файлы на локальном диске в wwwroot/media/{userId}/{storedFileName},
    // отдаются StaticFiles по /media/{userId}/{file}. Имя папки = MediaController.MediaFolder
    // (единый источник, чтобы URL и раскладка не разъехались).
    public sealed class LocalDiskMediaStorage : IMediaStorage
    {
        private readonly IWebHostEnvironment _env;

        public LocalDiskMediaStorage(IWebHostEnvironment env)
        {
            _env = env;
        }

        private string Folder => Controllers.MediaController.MediaFolder;

        public string LocalRootForMaintenance => Path.Combine(_env.WebRootPath, Folder);

        private string UserDir(int userId) => Path.Combine(_env.WebRootPath, Folder, userId.ToString());

        public async Task SaveAsync(int userId, string storedFileName, byte[] bytes, CancellationToken ct = default)
        {
            var dir = UserDir(userId);
            Directory.CreateDirectory(dir);
            await File.WriteAllBytesAsync(SafeFilePath(userId, storedFileName), bytes, ct);
        }

        public void Delete(int userId, string storedFileName)
        {
            if (!TrySafeFilePath(userId, storedFileName, out var path))
            {
                Log.Warning("Rejected unsafe media file name {StoredFileName} for user {UserId}", storedFileName, userId);
                return;
            }

            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        public void DeleteUserFolder(int userId)
        {
            try
            {
                var dir = UserDir(userId);
                if (Directory.Exists(dir))
                {
                    Directory.Delete(dir, recursive: true);
                }
            }
            catch (Exception ex)
            {
                // Не валим вызывающую операцию (например, удаление аккаунта) из-за файловой ошибки.
                Log.Warning(ex, "Не удалось удалить папку медиа пользователя {UserId}", userId);
            }
        }

        public string PublicUrl(int userId, string storedFileName)
        {
            if (!IsSafeStoredFileName(storedFileName))
            {
                throw new ArgumentException("Stored file name must not contain path segments.", nameof(storedFileName));
            }

            return $"/{Folder}/{userId}/{Uri.EscapeDataString(storedFileName)}";
        }

        private string SafeFilePath(int userId, string storedFileName)
        {
            if (!TrySafeFilePath(userId, storedFileName, out var path))
            {
                throw new ArgumentException("Stored file name must not contain path segments.", nameof(storedFileName));
            }

            return path;
        }

        private bool TrySafeFilePath(int userId, string storedFileName, out string path)
        {
            path = null;
            if (!IsSafeStoredFileName(storedFileName))
            {
                return false;
            }

            var dir = Path.GetFullPath(UserDir(userId));
            var candidate = Path.GetFullPath(Path.Combine(dir, storedFileName));
            var prefix = dir.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? dir
                : dir + Path.DirectorySeparatorChar;

            if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            path = candidate;
            return true;
        }

        private static bool IsSafeStoredFileName(string storedFileName)
        {
            return !string.IsNullOrWhiteSpace(storedFileName) &&
                   storedFileName.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 &&
                   storedFileName.IndexOf('/') < 0 &&
                   storedFileName.IndexOf('\\') < 0 &&
                   string.Equals(storedFileName, Path.GetFileName(storedFileName), StringComparison.Ordinal);
        }
    }
}
