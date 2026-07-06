using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Lime_Editor.Services
{
    // Вид загружаемого медиа — определяет ветку обработки в MediaController.Upload:
    // Image → ImageSharp-процессор; Svg → XML-санитайзер; Font/LottieJson → структурная
    // проверка и сохранение как есть. Не-медиа расширения не классифицируются вовсе.
    public enum MediaKind
    {
        Image,
        Svg,
        Font,
        LottieJson,
    }

    public static class MediaUploadSecurity
    {
        public const long MaxFileBytes = 5 * 1024 * 1024;
        public const long MaxUploadRequestBytes = MaxFileBytes + 64 * 1024;
        public const int SignatureLength = 12;

        // Растровые изображения — исторический список, идёт через ImageSharp-процессор.
        public static readonly string[] ImageExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        // Медиа-гэпы (волна после Премиум-слоя): вектор, шрифты файлом и Lottie-анимации.
        public static readonly string[] SvgExtensions = { ".svg" };
        public static readonly string[] FontExtensions = { ".woff2", ".woff" };
        public static readonly string[] LottieExtensions = { ".json" };

        // Полный белый список для гейта контроллера (и сообщений об ошибке).
        public static readonly string[] AllowedExtensions =
            ImageExtensions.Concat(SvgExtensions).Concat(FontExtensions).Concat(LottieExtensions).ToArray();

        private static readonly Dictionary<string, string[]> ContentTypes = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = new[] { "image/jpeg", "image/jpg", "image/pjpeg" },
            [".jpeg"] = new[] { "image/jpeg", "image/jpg", "image/pjpeg" },
            [".png"] = new[] { "image/png", "image/x-png" },
            [".gif"] = new[] { "image/gif" },
            [".webp"] = new[] { "image/webp" },
            [".svg"] = new[] { "image/svg+xml" },
            // Браузеры шлют для шрифтов кто во что горазд (вплоть до octet-stream) —
            // настоящая проверка формата это сигнатура wOF2/wOFF ниже.
            [".woff2"] = new[] { "font/woff2", "application/font-woff2", "application/octet-stream" },
            [".woff"] = new[] { "font/woff", "application/font-woff", "application/x-font-woff", "application/octet-stream" },
            [".json"] = new[] { "application/json", "text/plain", "application/octet-stream" },
        };

        public static MediaKind? Classify(string extension)
        {
            var ext = NormalizeExtension(extension);
            if (ImageExtensions.Contains(ext)) return MediaKind.Image;
            if (SvgExtensions.Contains(ext)) return MediaKind.Svg;
            if (FontExtensions.Contains(ext)) return MediaKind.Font;
            if (LottieExtensions.Contains(ext)) return MediaKind.LottieJson;
            return null;
        }

        public static bool IsAllowedContentType(string extension, string contentType)
        {
            if (string.IsNullOrWhiteSpace(contentType))
            {
                return false;
            }

            var cleanType = contentType.Split(';')[0].Trim();
            return ContentTypes.TryGetValue(NormalizeExtension(extension), out var allowed) &&
                   allowed.Contains(cleanType, StringComparer.OrdinalIgnoreCase);
        }

        public static bool HasAllowedSignature(string extension, ReadOnlySpan<byte> header)
        {
            switch (NormalizeExtension(extension))
            {
                case ".jpg":
                case ".jpeg":
                    return header.Length >= 3 &&
                           header[0] == 0xFF &&
                           header[1] == 0xD8 &&
                           header[2] == 0xFF;
                case ".png":
                    return header.Length >= 8 &&
                           header[0] == 0x89 &&
                           header[1] == 0x50 &&
                           header[2] == 0x4E &&
                           header[3] == 0x47 &&
                           header[4] == 0x0D &&
                           header[5] == 0x0A &&
                           header[6] == 0x1A &&
                           header[7] == 0x0A;
                case ".gif":
                    return StartsWithAscii(header, "GIF87a") || StartsWithAscii(header, "GIF89a");
                case ".webp":
                    return header.Length >= 12 &&
                           StartsWithAscii(header, "RIFF") &&
                           header[8] == (byte)'W' &&
                           header[9] == (byte)'E' &&
                           header[10] == (byte)'B' &&
                           header[11] == (byte)'P';
                case ".woff2":
                    return StartsWithAscii(header, "wOF2");
                case ".woff":
                    return StartsWithAscii(header, "wOFF");
                default:
                    return false;
            }
        }

        // SVG — текстовый формат, бинарной сигнатуры нет: ищем "<svg" в начале файла
        // (допуская BOM/пролог/комментарии). Это лишь быстрый гейт — настоящая защита
        // дальше в SvgSanitizer (парсинг XML + вычистка скриптоспособного).
        public static bool LooksLikeSvg(ReadOnlySpan<byte> content)
        {
            var probe = content.Length > 1024 ? content.Slice(0, 1024) : content;
            var text = DecodeAsciiLower(probe);
            return text.Contains("<svg", StringComparison.Ordinal);
        }

        // Lottie-JSON: первый непробельный символ — «{». Структуру (layers/v) проверяет
        // контроллер честным парсингом JSON.
        public static bool LooksLikeJson(ReadOnlySpan<byte> content)
        {
            for (var i = 0; i < content.Length; i++)
            {
                var b = content[i];
                // BOM UTF-8
                if (i == 0 && content.Length >= 3 && b == 0xEF && content[1] == 0xBB && content[2] == 0xBF) { i += 2; continue; }
                if (b == (byte)' ' || b == (byte)'\t' || b == (byte)'\r' || b == (byte)'\n') continue;
                return b == (byte)'{';
            }
            return false;
        }

        private static string DecodeAsciiLower(ReadOnlySpan<byte> bytes)
        {
            var sb = new StringBuilder(bytes.Length);
            foreach (var b in bytes)
            {
                sb.Append(b >= 0x20 && b < 0x7F ? char.ToLowerInvariant((char)b) : ' ');
            }
            return sb.ToString();
        }

        private static string NormalizeExtension(string extension)
        {
            if (string.IsNullOrWhiteSpace(extension))
            {
                return string.Empty;
            }

            var value = extension.Trim().ToLowerInvariant();
            return value.StartsWith(".", StringComparison.Ordinal) ? value : "." + value;
        }

        private static bool StartsWithAscii(ReadOnlySpan<byte> value, string prefix)
        {
            if (value.Length < prefix.Length)
            {
                return false;
            }

            for (var i = 0; i < prefix.Length; i++)
            {
                if (value[i] != (byte)prefix[i])
                {
                    return false;
                }
            }

            return true;
        }
    }
}
