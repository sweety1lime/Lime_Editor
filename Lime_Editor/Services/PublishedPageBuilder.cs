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
        // canonicalUrl / metaDescription / ogImage / jsonLd — per-page или per-record SEO (этап 3.6):
        // если переданы, перекрывают site-уровень; null → поведение как раньше (site-уровень).
        // jsonLd — готовая строка JSON-LD (Article/Product) для AEO; вставляется в <script type=ld+json>.
        public static string WrapCustomHtml(string innerHtml, Site site, string documentJson = null, string pageTitle = null,
            string canonicalUrl = null, string metaDescription = null, string ogImage = null, string jsonLd = null)
        {
            var rawTitle = !string.IsNullOrWhiteSpace(site?.MetaTitle) ? site.MetaTitle
                         : (!string.IsNullOrWhiteSpace(site?.Name) ? site.Name : "Мой сайт");
            if (!string.IsNullOrWhiteSpace(pageTitle))
            {
                rawTitle = pageTitle + " — " + rawTitle;
            }
            var safeTitle = System.Net.WebUtility.HtmlEncode(rawTitle);

            // Описание/картинка: per-page/record (аргумент) > site-уровень.
            var desc = !string.IsNullOrWhiteSpace(metaDescription) ? metaDescription : site?.MetaDescription;
            var og = !string.IsNullOrWhiteSpace(ogImage) ? ogImage : site?.OgImage;

            var seo = "<meta property=\"og:type\" content=\"" + (string.IsNullOrEmpty(canonicalUrl) ? "website" : "article") + "\">\n" +
                      $"<meta property=\"og:title\" content=\"{safeTitle}\">\n" +
                      "<meta name=\"twitter:card\" content=\"summary_large_image\">\n" +
                      $"<meta name=\"twitter:title\" content=\"{safeTitle}\">\n";
            if (!string.IsNullOrWhiteSpace(desc))
            {
                var safeDesc = System.Net.WebUtility.HtmlEncode(desc);
                seo += $"<meta name=\"description\" content=\"{safeDesc}\">\n" +
                       $"<meta property=\"og:description\" content=\"{safeDesc}\">\n" +
                       $"<meta name=\"twitter:description\" content=\"{safeDesc}\">\n";
            }
            if (!string.IsNullOrWhiteSpace(og))
            {
                var safeOg = System.Net.WebUtility.HtmlEncode(og);
                seo += $"<meta property=\"og:image\" content=\"{safeOg}\">\n" +
                       $"<meta name=\"twitter:image\" content=\"{safeOg}\">\n";
            }
            if (!string.IsNullOrWhiteSpace(canonicalUrl))
            {
                var safeUrl = System.Net.WebUtility.HtmlEncode(canonicalUrl);
                seo += $"<link rel=\"canonical\" href=\"{safeUrl}\">\n" +
                       $"<meta property=\"og:url\" content=\"{safeUrl}\">\n";
            }
            // JSON-LD (AEO): экранируем "</" чтобы не закрыть <script> пользовательскими данными.
            if (!string.IsNullOrWhiteSpace(jsonLd))
            {
                seo += "<script type=\"application/ld+json\">" + jsonLd.Replace("</", "<\\/") + "</script>\n";
            }

            // GSAP + рантайм scroll-движения подключаем, если в контенте есть любой маркер
            // движения: reveal (data-anim), параллакс, sticky или бегущая строка.
            var hasMotion = innerHtml != null && (
                innerHtml.Contains("data-anim") ||
                innerHtml.Contains("data-parallax") ||
                innerHtml.Contains("data-sticky") ||
                innerHtml.Contains("data-marquee") ||
                innerHtml.Contains("data-scene"));
            // Split-типографика (anim="split-*") тянет SplitType ПЕРЕД lime-animate (defer выполняется по порядку).
            var hasSplit = innerHtml != null && innerHtml.Contains("data-anim=\"split");
            var animScripts = hasMotion
                ? "<script src=\"/js/vendor/gsap.min.js\" defer></script>\n" +
                  "<script src=\"/js/vendor/ScrollTrigger.min.js\" defer></script>\n" +
                  (hasSplit ? "<script src=\"/js/vendor/split-type.min.js\" defer></script>\n" : string.Empty) +
                  "<script src=\"/js/lime/lime-animate.js\" defer></script>\n"
                : string.Empty;
            // Инерционный скролл (theme.motion.smooth → data-lime-smooth): Lenis до lime-polish,
            // который его инициализирует (и синхронизирует со ScrollTrigger при его наличии).
            if (innerHtml != null && innerHtml.Contains("data-lime-smooth"))
            {
                animScripts += "<script src=\"/js/vendor/lenis.min.js\" defer></script>\n";
            }
            // Курируемые WebGL-эффекты: частицы-слой и/или дисторт картинок.
            if (innerHtml != null && (innerHtml.Contains("data-gl-particles") || innerHtml.Contains("lime-fx-gl-")))
            {
                animScripts += "<script src=\"/js/lime/lime-webgl.js\" defer></script>\n";
            }
            // Нативный Lottie (медиа-волна): self-hosted плеер + рантайм режимов (auto/hover/scroll).
            if (innerHtml != null && innerHtml.Contains("data-lime-lottie"))
            {
                animScripts += "<script src=\"/js/vendor/lottie_light.min.js\" defer></script>\n" +
                               "<script src=\"/js/lime/lime-lottie.js\" defer></script>\n";
            }
            // Рантайм hash-роутинга — только для многостраничных сайтов (движок B).
            if (innerHtml != null && innerHtml.Contains("data-lime-pages"))
            {
                animScripts += "<script src=\"/js/lime/lime-pages.js\" defer></script>\n";
            }
            // Интерактивные блоки (этап 1.2): рантайм tabs/carousel/lightbox/countdown/modal — при наличии.
            if (innerHtml != null && (innerHtml.Contains("data-lime-tabs") || innerHtml.Contains("data-lime-carousel") ||
                innerHtml.Contains("data-lime-lightbox") || innerHtml.Contains("data-lime-countdown") || innerHtml.Contains("data-lime-modal")))
            {
                animScripts += "<script src=\"/js/lime/lime-interactions.js\" defer></script>\n";
            }
            // Прелоадер (theme.motion.loader → data-lime-loader="bar|counter"): оверлей инжектим
            // СЕРВЕРОМ в начало <body> — инлайн-скрипты запрещены CSP, а вставка из defer-скрипта
            // мигала бы контентом. Прогресс и снятие ведёт lime-loader.js; без JS шторку прячет CSS.
            var loaderOverlay = string.Empty;
            var loaderMatch = innerHtml != null
                ? System.Text.RegularExpressions.Regex.Match(innerHtml, "data-lime-loader=\"(bar|counter)\"")
                : System.Text.RegularExpressions.Match.Empty;
            if (loaderMatch.Success)
            {
                animScripts += "<script src=\"/js/lime/lime-loader.js\" defer></script>\n";
                loaderOverlay =
                    $"<div class=\"lime-loader\" data-lime-loader-overlay data-style=\"{loaderMatch.Groups[1].Value}\">" +
                    "<div class=\"lime-loader__inner\">" +
                    "<div class=\"lime-loader__count\">0</div>" +
                    "<div class=\"lime-loader__bar\"><i></i></div>" +
                    "</div></div>\n";
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
                   loaderOverlay +
                   (innerHtml ?? string.Empty) + "\n" +
                   MadeWithBadge +
                   "</body>\n</html>";
        }

        // Per-page SEO из документа (этап 3.6): (description, ogImage) страницы со slug. (null,null) — нет.
        public static (string description, string ogImage) PageSeo(string documentJson, string pageSlug)
        {
            try
            {
                if (JObject.Parse(documentJson)["pages"] is JArray pages)
                {
                    foreach (var p in pages)
                    {
                        if (((string)p["slug"] ?? "") == (pageSlug ?? ""))
                            return ((string)p["description"], (string)p["ogImage"]);
                    }
                }
            }
            catch { /* битый JSON → без per-page SEO */ }
            return (null, null);
        }

        // Бейдж «Сделано в Lime» — viral-петля (стандарт рынка: Framer/Durable/Mixo).
        // Ссылка root-relative: публикации живут на одном origin с приложением, "/" — лендинг.
        // Инлайн-стили: строгий CSP публичных страниц разрешает style="" (script — нет).
        // Когда разморозится биллинг — гейтить по плану (снятие бейджа = мотиватор апгрейда).
        private const string MadeWithBadge =
            "<a class=\"lime-made-badge\" href=\"/?utm_source=site-badge\" target=\"_blank\" rel=\"noopener\" " +
            "style=\"position:fixed;right:14px;bottom:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;" +
            "font:500 12px/1 system-ui,sans-serif;padding:7px 12px;border-radius:999px;background:rgba(8,10,7,.85);" +
            "color:#eef2e9;text-decoration:none;border:1px solid rgba(197,242,78,.35);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);\">" +
            "<span style=\"color:#c5f24e;\">&#9679;</span>Сделано в Lime</a>\n";

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
