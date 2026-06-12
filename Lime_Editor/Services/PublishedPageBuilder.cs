using Lime_Editor.Models;

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
        public static string WrapCustomHtml(string innerHtml, Site site, string pageTitle = null)
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

            // GSAP + рантайм scroll-анимаций подключаем только если в контенте есть блоки с data-anim.
            var animScripts = (innerHtml != null && innerHtml.Contains("data-anim"))
                ? "<script src=\"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js\" defer></script>\n" +
                  "<script src=\"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js\" defer></script>\n" +
                  "<script src=\"/js/lime/lime-animate.js\" defer></script>\n"
                : string.Empty;
            // Рантайм hash-роутинга — только для многостраничных сайтов (движок B).
            if (innerHtml != null && innerHtml.Contains("data-lime-pages"))
            {
                animScripts += "<script src=\"/js/lime/lime-pages.js\" defer></script>\n";
            }
            return "<!DOCTYPE html>\n" +
                   "<html lang=\"ru\">\n<head>\n" +
                   "<meta charset=\"utf-8\">\n" +
                   "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
                   $"<meta name=\"templateId\" content=\"{TemplateExportConfigs.CustomTemplateId}\">\n" +
                   $"<title>{safeTitle}</title>\n" +
                   seo +
                   "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
                   "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
                   "<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/tokens.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/base.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/components.css\">\n" +
                   "<link rel=\"stylesheet\" href=\"/css/lime/constructor.css\">\n" +
                   animScripts +
                   "</head>\n<body>\n" +
                   (innerHtml ?? string.Empty) + "\n" +
                   "</body>\n</html>";
        }
    }
}
