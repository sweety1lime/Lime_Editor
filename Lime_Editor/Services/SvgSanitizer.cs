using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;

namespace Lime_Editor.Services
{
    // Санитайзер загружаемых SVG (медиа-волна). SVG — это XML-документ, который при прямом
    // открытии по URL исполняет <script> и on*-атрибуты на нашем origin (stored-XSS рядом
    // с Identity-cookie). Стратегия: честный XML-парс без DTD (XXE отрезан) + вычистка всего
    // скриптоспособного, вторым эшелоном — CSP script-src 'none' на /media/*.svg (Startup).
    // Возвращает null, если файл не парсится как XML/не SVG — такой аплоад отклоняется.
    public static class SvgSanitizer
    {
        // Элементы, способные исполнять код или встраивать чужой документ. foreignObject
        // позволяет вложить произвольный HTML (включая <script>) — режем целиком.
        private static readonly HashSet<string> ForbiddenElements = new(StringComparer.OrdinalIgnoreCase)
        {
            "script", "foreignObject", "iframe", "embed", "object", "audio", "video", "annotation-xml",
        };

        // href/xlink:href оставляем только на внутренние ссылки (#id) и инлайн-растр
        // (data:image/*) — внешние URL это утечка/трекинг и потенциальный вектор.
        private static bool IsSafeHref(string value)
        {
            var v = (value ?? "").Trim();
            if (v.Length == 0) return true;
            if (v.StartsWith("#", StringComparison.Ordinal)) return true;
            return v.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) &&
                   !v.StartsWith("data:image/svg", StringComparison.OrdinalIgnoreCase);
        }

        // Значение атрибута с javascript:/vbscript:/data:text — вычищаем (страховка на случай
        // экзотических атрибутов-ссылок вне href; пробелы/управляющие внутри схемы игнорируем).
        private static bool HasScriptScheme(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            var compact = new string(value.Where(c => !char.IsWhiteSpace(c) && !char.IsControl(c)).ToArray());
            return compact.Contains("javascript:", StringComparison.OrdinalIgnoreCase) ||
                   compact.Contains("vbscript:", StringComparison.OrdinalIgnoreCase) ||
                   compact.Contains("data:text/", StringComparison.OrdinalIgnoreCase);
        }

        public static string Sanitize(string svgText)
        {
            if (string.IsNullOrWhiteSpace(svgText)) return null;

            XDocument doc;
            try
            {
                var settings = new XmlReaderSettings
                {
                    DtdProcessing = DtdProcessing.Prohibit, // XXE/entity-бомбы не проходят
                    XmlResolver = null,
                    MaxCharactersFromEntities = 0,
                };
                using var stringReader = new StringReader(svgText);
                using var reader = XmlReader.Create(stringReader, settings);
                doc = XDocument.Load(reader, LoadOptions.None);
            }
            catch (XmlException)
            {
                return null;
            }

            if (doc.Root == null || !string.Equals(doc.Root.Name.LocalName, "svg", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            // Снести запрещённые элементы целиком (со всем поддеревом).
            doc.Root.DescendantsAndSelf()
                .Where(e => ForbiddenElements.Contains(e.Name.LocalName))
                .ToList()
                .ForEach(e => e.Remove());

            foreach (var el in doc.Root.DescendantsAndSelf())
            {
                foreach (var attr in el.Attributes().ToList())
                {
                    var local = attr.Name.LocalName;
                    // Обработчики событий: onload/onclick/onerror/... — всё, что начинается с on.
                    if (local.StartsWith("on", StringComparison.OrdinalIgnoreCase))
                    {
                        attr.Remove();
                        continue;
                    }
                    if (string.Equals(local, "href", StringComparison.OrdinalIgnoreCase) && !IsSafeHref(attr.Value))
                    {
                        attr.Remove();
                        continue;
                    }
                    if (HasScriptScheme(attr.Value))
                    {
                        attr.Remove();
                    }
                }
            }

            return doc.ToString(SaveOptions.DisableFormatting);
        }
    }
}
