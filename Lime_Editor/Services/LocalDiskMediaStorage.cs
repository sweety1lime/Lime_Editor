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
            await File.WriteAllBytesAsync(Path.Combine(dir, storedFileName), bytes, ct);
        }

        public void Delete(int userId, string storedFileName)
        {
            var path = Path.Combine(UserDir(userId), storedFileName);
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

        public string PublicUrl(int userId, string storedFileName) => $"/{Folder}/{userId}/{storedFileName}";
    }
}
