#nullable enable
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Скриншот страницы для превью публикации (карточки MySites/галереи + og:image).
    // null — рендер недоступен (нет браузера в окружении) или страница не отрисовалась:
    // вызывающий тихо остаётся на текущей заглушке (тем-градиент), фича деградирует мягко.
    public interface ISitePreviewRenderer
    {
        Task<byte[]?> RenderPngAsync(string url, int width, int height, CancellationToken ct = default);
    }
}
