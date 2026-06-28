using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Хранилище загруженных пользователями медиа. Дефолт — LocalDiskMediaStorage (wwwroot/media/{userId}).
    // Абстракция вводится, чтобы позже подключить S3/R2 без правок контроллеров: SaveAsync/Delete/
    // PublicUrl станут операциями объектного хранилища. Раскладка ключей — {userId}/{storedFileName}.
    public interface IMediaStorage
    {
        // Сохранить файл пользователя (создаёт «папку»/префикс при необходимости).
        Task SaveAsync(int userId, string storedFileName, byte[] bytes, CancellationToken ct = default);

        // Удалить один файл (no-op, если его нет).
        void Delete(int userId, string storedFileName);

        // Удалить все файлы пользователя (при удалении аккаунта).
        void DeleteUserFolder(int userId);

        // Публичный URL для отдачи файла фронту (media-picker, превью).
        string PublicUrl(int userId, string storedFileName);

        // Корень на локальном диске для orphan-cleanup. null — хранилище не файловое (S3):
        // фоновая чистка осиротевших файлов тогда не применяется (её роль берут lifecycle-правила бакета).
        string LocalRootForMaintenance { get; }
    }
}
