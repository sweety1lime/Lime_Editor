using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Серверное сжатие/ресайз: ограничивает максимальную сторону, перекодирует с фиксированным качеством,
    // сохраняет исходный формат (PNG/WebP — без потерь относительно формата, JPG — с заданным quality).
    // GIF не трогаем, чтобы анимация осталась.
    public sealed class ImageSharpProcessor : IImageProcessor
    {
        public const int MaxDimension = 1920;
        public const int JpegQuality = 82;

        // Сверх этих размеров не загружаем в память (DOS / decompression bomb защита).
        // 8000x8000 RGBA ~ 256 МБ — это и так уже много, но загрузка остановится до полной деком­прессии.
        public const int HardMaxWidth = 8000;
        public const int HardMaxHeight = 8000;

        public async Task<ProcessedImage> ProcessAsync(Stream input, string originalExtension, CancellationToken ct = default)
        {
            var ext = (originalExtension ?? string.Empty).ToLowerInvariant();

            // Identify читает только метаданные — дёшево и безопасно. Если в файле бомба — поймаем тут.
            input.Position = 0;
            var info = await Image.IdentifyAsync(input, ct);
            if (info == null)
            {
                throw new InvalidDataException("Не удалось распознать изображение.");
            }
            if (info.Width > HardMaxWidth || info.Height > HardMaxHeight)
            {
                throw new InvalidDataException($"Изображение слишком большое ({info.Width}×{info.Height}).");
            }

            // GIF: оставляем как есть — анимация теряется при resize/re-encode.
            if (ext == ".gif")
            {
                input.Position = 0;
                using var ms = new MemoryStream();
                await input.CopyToAsync(ms, ct);
                return new ProcessedImage(ms.ToArray(), ".gif", "image/gif", info.Width, info.Height);
            }

            input.Position = 0;
            using var image = await Image.LoadAsync(input, ct);

            if (image.Width > MaxDimension || image.Height > MaxDimension)
            {
                image.Mutate(x => x.Resize(new ResizeOptions
                {
                    Size = new Size(MaxDimension, MaxDimension),
                    Mode = ResizeMode.Max,
                }));
            }

            using var output = new MemoryStream();
            switch (ext)
            {
                case ".png":
                    await image.SaveAsPngAsync(output, ct);
                    return new ProcessedImage(output.ToArray(), ".png", "image/png", image.Width, image.Height);

                case ".webp":
                    await image.SaveAsWebpAsync(output, ct);
                    return new ProcessedImage(output.ToArray(), ".webp", "image/webp", image.Width, image.Height);

                default:
                    // .jpg / .jpeg / всё прочее, что ImageSharp смог открыть — приводим к JPEG q82.
                    await image.SaveAsJpegAsync(output, new JpegEncoder { Quality = JpegQuality }, ct);
                    return new ProcessedImage(output.ToArray(), ".jpg", "image/jpeg", image.Width, image.Height);
            }
        }
    }
}
