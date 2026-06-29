using System;
using System.Collections.Generic;
using System.Linq;

namespace Lime_Editor.Services
{
    public static class MediaUploadSecurity
    {
        public const long MaxFileBytes = 5 * 1024 * 1024;
        public const long MaxUploadRequestBytes = MaxFileBytes + 64 * 1024;
        public const int SignatureLength = 12;
        public static readonly string[] AllowedExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

        private static readonly Dictionary<string, string[]> ContentTypes = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = new[] { "image/jpeg", "image/jpg", "image/pjpeg" },
            [".jpeg"] = new[] { "image/jpeg", "image/jpg", "image/pjpeg" },
            [".png"] = new[] { "image/png", "image/x-png" },
            [".gif"] = new[] { "image/gif" },
            [".webp"] = new[] { "image/webp" },
        };

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
                default:
                    return false;
            }
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
