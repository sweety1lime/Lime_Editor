using Lime_Editor.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Lime_Editor.Services
{
    // Сборка полного publish-HTML вокруг скомпилированного контента Custom-сайта
    // (head с SEO/OG, шрифты, lime-CSS, GSAP/hash-роутинг рантаймы по маркерам).
    // Вынесено из HomeController (этап 0.2), чтобы Publish и RepublishAll
    // в разных контроллерах собирали страницу одинаково.
    public static class PublishedPageBuilder
    {
        // pageTitle — заголовок конкретной страницы многостраничного сайта (этап 0.3):
        // <title> становится «Страница — Сайт». Для главной/одностраничных не передаётся.
        // documentJson — JSON движка B: из него берётся doc.head (кастомный <head>-код, этап 0.2),
        // который санитайзится и вставляется в head. customCss уже в body-стиле (его эмитит движок).
        public static string WrapCustomHtml(string innerHtml, Site site, string documentJson = null, string pageTitle = null)
        {
            var rawTitle = !string.IsNullOrWhiteSpace(site?.MetaTitle) ? site.MetaTitle
                         : (!string.IsNullOrWhiteSpace(site?.Name) ? site.Name : "Мой сайт");
            if (!string.IsNullOrWhiteSpace(pageTitle))
            {
                rawTitle = pageTitle + " — " + rawTitle;
            }
            var safeTitle = System.Net.WebUtility.HtmlEncode(rawTitle);

            var seo = "<meta property=\"og:type\" content=\"website\">\n" +
                      $"<meta property=\"og:title\" content=\"{safeTitle}\">\n";
            if (!string.IsNullOrWhiteSpace(site?.MetaDescription))
            {
                var safeDesc = System.Net.WebUtility.HtmlEncode(site.MetaDescription);
                seo += $"<meta name=\"description\" content=\"{safeDesc}\">\n" +
                       $"<meta property=\"og:description\" content=\"{safeDesc}\">\n";
            }
            if (!string.IsNullOrWhiteSpace(site?.OgImage))
            {
                var safeOg = System.Net.WebUtility.HtmlEncode(site.OgImage);
                seo += $"<meta property=\"og:image\" content=\"{safeOg}\">\n";
            }

            // GSAP + рантайм scroll-движения подключаем, если в контенте есть любой маркер
            // движения: reveal (data-anim), параллакс, sticky или бегущая строка.
            var hasMotion = innerHtml != null && (
                innerHtml.Contains("data-anim") ||
                innerHtml.Contains("data-parallax") ||
                innerHtml.Contains("data-sticky") ||
                innerHtml.Contains("data-marquee") ||
                innerHtml.Contains("data-scene"));
            var animScripts = hasMotion
                ? "<script src=\"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js\" defer></script>\n" +
                  "<script src=\"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js\" defer></script>\n" +
                  "<script src=\"/js/lime/lime-animate.js\" defer></script>\n"
                : string.Empty;
            // Рантайм hash-роутинга — только для многостраничных сайтов (движок B).
            if (innerHtml != null && innerHtml.Contains("data-lime-pages"))
            {
                animScripts += "<script src=\"/js/lime/lime-pages.js\" defer></script>\n";
            }
            // Кастомный <head>-код владельца (этап 0.2): meta/link/style после санитайза.
            var customHead = PublishedHtmlSanitizer.SanitizeHead(ExtractDocHead(documentJson));
            return "<!DOCTYPE html>\n" +
                   "<html lang=\"ru\">\n<head>\n" +
                   "<meta charset=\"utf-8\">\n" +
                   "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
                   $"<meta name=\"templateId\" content=\"{TemplateExportConfigs.CustomTemplateId}\">\n" +
                   $"<title>{safeTitle}</title>\n" +
                   seo +
                   "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
                   "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
                   BuildFontsLink(innerHtml) +
                   "<link rel=\"stylesheet\" href=\"/css/lime/tokens.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/base.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/components.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/constructor.css\">\n" +
                   animScripts +
                   // Лёгкий сигнатурный лоск (Фаза 4): прогресс скролла. Без GSAP, на каждой странице.
                   "<script src=\"/js/lime/lime-polish.js\" defer></script>\n" +
                   customHead +
                   "</head>\n<body class=\"lime-published\">\n" +
                   (innerHtml ?? string.Empty) + "\n" +
                   "</body>\n</html>";
        }

        // Гейт тарифа (этап 3.4): на планах без AllowCustomCode произвольный CSS/<head> не должен
        // попадать в публикацию. Вырезаем doc.customCss и doc.head из снапшота ПЕРЕД компиляцией —
        // тогда их не эмитит ни движок (customCss), ни сборка head (ExtractDocHead), а republish
        // из снапшота остаётся чистым. Битый/пустой JSON → возвращаем как есть (не ломаем publish).
        public static string StripCustomCode(string documentJson)
        {
            if (string.IsNullOrWhiteSpace(documentJson)) return documentJson;
            try
            {
                var doc = JObject.Parse(documentJson);
                var removed = doc.Remove("customCss");
                removed |= doc.Remove("head");
                return removed ? doc.ToString(Formatting.None) : documentJson;
            }
            catch (JsonException)
            {
                return documentJson;
            }
        }

        // Курируемые Google Fonts → их css2-параметры. Inter грузим всегда (базовый),
        // остальные — только если семейство реально используется в контенте, чтобы
        // страница оставалась лёгкой. ВАЖНО: список ИМЁН обязан совпадать с
        // wwwroot/js/lime/lime-fonts.js (там же UI-пикер и live-загрузка в редакторе).
        private static readonly (string Name, string Param)[] FontFamilies =
        {
            // Без засечек
            ("Roboto", "Roboto:wght@400;500;700;900"),
            ("Open Sans", "Open+Sans:wght@400;500;600;700;800"),
            ("Montserrat", "Montserrat:wght@400;500;600;700;800"),
            ("Poppins", "Poppins:wght@400;500;600;700;800"),
            ("Manrope", "Manrope:wght@400;500;600;700;800"),
            ("Lato", "Lato:wght@400;700;900"),
            ("Nunito", "Nunito:wght@400;600;700;800"),
            ("Raleway", "Raleway:wght@400;500;600;700;800"),
            ("Work Sans", "Work+Sans:wght@400;500;600;700;800"),
            ("DM Sans", "DM+Sans:wght@400;500;700"),
            ("Space Grotesk", "Space+Grotesk:wght@400;500;600;700"),
            ("Onest", "Onest:wght@400;500;600;700;800"),
            ("Rubik", "Rubik:wght@400;500;600;700;800"),
            ("Mulish", "Mulish:wght@400;600;700;800"),
            ("Plus Jakarta Sans", "Plus+Jakarta+Sans:wght@400;500;600;700;800"),
            // С засечками
            ("Playfair Display", "Playfair+Display:wght@400;500;600;700;800"),
            ("Merriweather", "Merriweather:wght@400;700;900"),
            ("Lora", "Lora:wght@400;500;600;700"),
            ("PT Serif", "PT+Serif:wght@400;700"),
            ("Cormorant Garamond", "Cormorant+Garamond:wght@400;500;600;700"),
            ("EB Garamond", "EB+Garamond:wght@400;500;600;700"),
            ("Bitter", "Bitter:wght@400;500;600;700;800"),
            ("Instrument Serif", "Instrument+Serif:ital@0;1"),
            // Дисплейные
            ("Unbounded", "Unbounded:wght@400;500;600;700;800"),
            ("Bebas Neue", "Bebas+Neue"),
            ("Oswald", "Oswald:wght@400;500;600;700"),
            ("Archivo", "Archivo:wght@400;500;600;700;800"),
            ("Comfortaa", "Comfortaa:wght@400;500;600;700"),
            ("Righteous", "Righteous"),
            // Рукописные
            ("Caveat", "Caveat:wght@400;500;600;700"),
            ("Dancing Script", "Dancing+Script:wght@400;500;600;700"),
            ("Pacifico", "Pacifico"),
            ("Lobster", "Lobster"),
            // Моноширинные
            ("JetBrains Mono", "JetBrains+Mono:wght@400;500;600;700"),
            ("Fira Code", "Fira+Code:wght@400;500;600;700"),
            ("IBM Plex Mono", "IBM+Plex+Mono:wght@400;500;600;700"),
            ("Space Mono", "Space+Mono:wght@400;700"),
        };

        // Достаёт строковое свойство doc.head из JSON движка B (этап 0.2). Любая ошибка
        // парсинга/отсутствие поля → пустая строка (кастомного head-кода нет).
        private static string ExtractDocHead(string documentJson)
        {
            if (string.IsNullOrWhiteSpace(documentJson)) return string.Empty;
            try
            {
                using var d = System.Text.Json.JsonDocument.Parse(documentJson);
                if (d.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object &&
                    d.RootElement.TryGetProperty("head", out var h) &&
                    h.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    return h.GetString() ?? string.Empty;
                }
            }
            catch (System.Text.Json.JsonException) { /* битый JSON — head нет */ }
            return string.Empty;
        }

        private static string BuildFontsLink(string innerHtml)
        {
            var families = new System.Collections.Generic.List<string> { "Inter:wght@400;500;600;700;800" };
            if (!string.IsNullOrEmpty(innerHtml))
            {
                foreach (var f in FontFamilies)
                {
                    // Ищем имя в кавычках ('Lobster'), как оно выходит в font-family/--lt-font —
                    // чтобы не сработать на случайное слово в тексте страницы.
                    if (innerHtml.Contains("'" + f.Name + "'", System.StringComparison.OrdinalIgnoreCase))
                    {
                        families.Add(f.Param);
                    }
                }
            }
            var query = string.Join("&family=", families);
            return "<link href=\"https://fonts.googleapis.com/css2?family=" + query + "&display=swap\" rel=\"stylesheet\">\n";
        }
    }
}
