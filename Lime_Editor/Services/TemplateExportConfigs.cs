using System.Collections.Generic;

namespace Lime_Editor.Services
{
    // Декларативное описание трёх готовых шаблонов и одного "custom" (EditTemplates).
    // Раньше эта логика была дублем в SaveRuby/SaveSublime/SaveCoomingSoon (по ~70 строк каждый).
    public static class TemplateExportConfigs
    {
        // Совпадает с IdTemplate=4 в LimeEditorContext seed — Site.TemplateId для "Создать сайт"-потока.
        public const int CustomTemplateId = 4;

        public static readonly IReadOnlyDictionary<int, TemplateExportConfig> All =
            new Dictionary<int, TemplateExportConfig>
            {
                [1] = BuildRuby(),
                [2] = BuildSublime(),
                [3] = BuildComingSoon(),
                [CustomTemplateId] = BuildCustom(),
            };

        private static TemplateExportConfig BuildCustom() => new TemplateExportConfig
        {
            TemplateId = CustomTemplateId,
            ZipFileName = "MySite.zip",
            // Подключаем дизайн-систему lime + сохраняем backward-compat: bootstrap/mainMeow тоже включены
            // на случай если пользователь добавил блоки старого формата.
            HtmlPrefix =
                "<!DOCTYPE html>\n<html lang=\"ru\">\n<head>\n" +
                "<meta charset=\"utf-8\">\n" +
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
                "<title>Мой сайт</title>\n" +
                "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
                "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
                "<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n" +
                "<link href=\"css/lime/tokens.css\" rel=\"stylesheet\">\n" +
                "<link href=\"css/lime/base.css\" rel=\"stylesheet\">\n" +
                "<link href=\"css/lime/components.css\" rel=\"stylesheet\">\n" +
                "<link href=\"css/lime/constructor.css\" rel=\"stylesheet\">\n" +
                "<link href=\"css/bootstrap.min.css\" rel=\"stylesheet\">\n" +
                "<link href=\"css/mainMeow.css\" rel=\"stylesheet\">\n" +
                "</head>\n<body>\n",
            HtmlSuffix = "\n</body>\n</html>",
            HtmlReplacements = new[]
            {
                ("/css/lime/", "css/lime/"),
                ("/images", "images"),
            },
            AssetFolders = new[]
            {
                new AssetFolder
                {
                    Source = "css/lime",
                    Dest = "css/lime",
                    Mode = AssetIncludeMode.Whitelist,
                    Whitelist = new[]
                    {
                        "tokens.css", "base.css", "components.css", "constructor.css",
                    },
                    Recursive = false,
                },
                new AssetFolder
                {
                    Source = "css/main",
                    Dest = "css",
                    Mode = AssetIncludeMode.Whitelist,
                    Whitelist = new[]
                    {
                        "bootstrap.min.css","mainMeow.css",
                    },
                    Recursive = false,
                },
                new AssetFolder
                {
                    Source = "images",
                    Dest = "images",
                    Mode = AssetIncludeMode.OnlyReferencedInHtml,
                    Recursive = false,
                },
            },
        };

        private static TemplateExportConfig BuildRuby() => new TemplateExportConfig
        {
            TemplateId = 1,
            ZipFileName = "RubyTemplate.zip",
            HtmlPrefix = "<!DOCTYPE html>\n<html id=\"userSpace\" lang=\"ru_RU\">\n",
            HtmlSuffix = "\n</html>",
            HtmlReplacements = new[]
            {
                ("../vendor/Template_1/", "vendor/"),
                ("/js/Template_1/", "js/"),
                ("../css/Template_1/", "css/"),
                ("../images/Template_1/", "images/"),
            },
            AssetFolders = new[]
            {
                new AssetFolder
                {
                    Source = "css/Template_1", Dest = "css",
                    Mode = AssetIncludeMode.Whitelist,
                    Whitelist = new[] { "style.min.css" },
                    Recursive = false,
                },
                new AssetFolder
                {
                    Source = "js/Template_1", Dest = "js",
                    Mode = AssetIncludeMode.Whitelist,
                    Whitelist = new[] { "app.min.js" },
                    Recursive = false,
                },
                new AssetFolder { Source = "vendor/Template_1", Dest = "vendor" },
                new AssetFolder
                {
                    Source = "images/Template_1", Dest = "images",
                    Mode = AssetIncludeMode.OnlyReferencedInHtml,
                    Recursive = false,
                },
            },
        };

        private static TemplateExportConfig BuildSublime() => new TemplateExportConfig
        {
            TemplateId = 2,
            ZipFileName = "SublimeTemplate.zip",
            HtmlPrefix = "<!DOCTYPE html>\n<html id=\"userSpace\" lang=\"ru_RU\">\n",
            HtmlSuffix = "\n</html>",
            HtmlReplacements = new[]
            {
                ("/js/Template_2/", "js/"),
                ("/css/Template_2/", "css/"),
                ("/images/Template_2/", "images/"),
                ("class=\"changethis\"", "class=\"otstup\""),
            },
            AssetFolders = new[]
            {
                new AssetFolder { Source = "css/Template_2",    Dest = "css" },
                new AssetFolder { Source = "js/Template_2",     Dest = "js" },
                new AssetFolder { Source = "fonts/Template_2",  Dest = "fonts" },
                new AssetFolder { Source = "images/Template_2", Dest = "images" },
            },
        };

        private static TemplateExportConfig BuildComingSoon() => new TemplateExportConfig
        {
            TemplateId = 3,
            ZipFileName = "ComingSoonTemplate.zip",
            HtmlPrefix = "<!DOCTYPE html>\n<html id=\"userSpace\" lang=\"ru_RU\">\n",
            HtmlSuffix = "\n</html>",
            HtmlReplacements = new[]
            {
                ("/js/Template_3/", "js/"),
                ("/css/Template_3/", "css/"),
                ("/images/Template_3/", "images/"),
                ("/vendor/Template_3/", "vendor/"),
                ("/fonts/Template_3/", "fonts/"),
            },
            AssetFolders = new[]
            {
                new AssetFolder { Source = "css/Template_3",    Dest = "css" },
                new AssetFolder { Source = "js/Template_3",     Dest = "js" },
                new AssetFolder { Source = "fonts/Template_3",  Dest = "fonts" },
                new AssetFolder { Source = "vendor/Template_3", Dest = "vendor" },
                new AssetFolder { Source = "images/Template_3", Dest = "images" },
            },
        };
    }
}
