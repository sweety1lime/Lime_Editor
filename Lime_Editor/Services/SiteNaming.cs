#nullable enable
using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Lime_Editor.Services
{
    // Автонейминг сайта из AI-промпта (клиент кладёт его в doc.meta.aiPrompt при генерации):
    // «кофейня «Зерно» в Казани — обжариваем сами, доставка…» → «Кофейня «Зерно» в Казани».
    // Иначе дашборд превращается в стену одинаковых «Новый сайт».
    public static class SiteNaming
    {
        private const int MaxNameLength = 60;

        // Разделители, после которых обычно идут детали, а не название.
        private static readonly string[] Cutters = { " — ", " – ", ". ", "! ", "? ", "; ", ": " };

        public static string? FromDocument(string? documentJson)
        {
            if (string.IsNullOrWhiteSpace(documentJson)) return null;
            try
            {
                var prompt = (string?)JObject.Parse(documentJson)["meta"]?["aiPrompt"];
                return FromPrompt(prompt);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        public static string? FromPrompt(string? prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt)) return null;

            // Схлопываем переносы/повторные пробелы — имя однострочное.
            var name = string.Join(" ", prompt.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

            // Первое предложение/сегмент до тире-двоеточия — обычно и есть название.
            foreach (var cutter in Cutters)
            {
                var idx = name.IndexOf(cutter, StringComparison.Ordinal);
                if (idx >= 8) { name = name[..idx]; break; }
            }

            if (name.Length > MaxNameLength)
            {
                var cut = name.LastIndexOf(' ', MaxNameLength);
                name = name[..(cut > 20 ? cut : MaxNameLength)];
            }

            name = name.TrimEnd(' ', '.', ',', '!', '?', ';', ':', '—', '–', '-');
            if (name.Length < 2) return null;

            // Промпты пишут с маленькой буквы — имя сайта с заглавной.
            return char.ToUpper(name[0]) + name[1..];
        }
    }
}
