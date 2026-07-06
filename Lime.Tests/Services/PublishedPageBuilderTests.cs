using Lime_Editor.Models;
using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 0.2: сборка publish-страницы вокруг контента — кастомный <head>-код из doc.head
    // (санитайзится) и заголовок страницы.
    public class PublishedPageBuilderTests
    {
        [Fact]
        public void WrapCustomHtml_InjectsSanitizedHead_FromDocumentJson()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var docJson = /*lang=json*/
                "{ \"version\":1, \"head\": \"<meta name=\\\"verify\\\" content=\\\"ok\\\"><script>bad()</script>\" }";

            var html = PublishedPageBuilder.WrapCustomHtml("<div class=\"lime-doc-page\"></div>", site, docJson);

            Assert.Contains("name=\"verify\"", html);   // безопасный meta попал в head
            Assert.DoesNotContain("bad()", html);        // <script> из head вырезан
            // Кастомный head вставлен внутри <head> (до </head>).
            Assert.True(html.IndexOf("name=\"verify\"") < html.IndexOf("</head>"));
        }

        [Fact]
        public void WrapCustomHtml_NoDocumentJson_StillBuilds()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml("<div class=\"lime-doc-page\"></div>", site);
            Assert.Contains("<title>", html);
            Assert.Contains("lime-published", html);
        }

        // Viral-петля: бейдж «Сделано в Lime» на каждой публикации (стандарт рынка).
        [Fact]
        public void WrapCustomHtml_ContainsMadeWithBadge_OnceBeforeBodyClose()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml("<main>контент</main>", site);

            Assert.Contains("lime-made-badge", html);
            Assert.Contains("Сделано в Lime", html);
            Assert.Equal(html.IndexOf("lime-made-badge"), html.LastIndexOf("lime-made-badge"));
            Assert.True(html.IndexOf("lime-made-badge") < html.IndexOf("</body>"));
            // Ссылка root-relative с utm; без скриптов — иначе строгий CSP публикаций её убил бы.
            Assert.Contains("href=\"/?utm_source=site-badge\"", html);
            Assert.Contains("rel=\"noopener\"", html);
        }

        // Этап 3.6: per-page/record SEO перекрывает site-уровень; canonical/twitter/JSON-LD; AEO-безопасность.
        [Fact]
        public void WrapCustomHtml_PerPageSeoCanonicalTwitterJsonLd()
        {
            var site = new Site { Name = "Сайт", IdSite = 1, MetaDescription = "сайт-описание", OgImage = "/site-og.png" };
            var html = PublishedPageBuilder.WrapCustomHtml("<div></div>", site, null,
                pageTitle: "Пост",
                canonicalUrl: "https://x/u/u/s/post/1-a",
                metaDescription: "описание записи",
                ogImage: "/rec.png",
                jsonLd: "{\"@type\":\"Article\",\"headline\":\"Пост</script>\"}");
            Assert.Contains("<link rel=\"canonical\" href=\"https://x/u/u/s/post/1-a\">", html);
            Assert.Contains("property=\"og:url\"", html);
            Assert.Contains("name=\"twitter:card\"", html);
            Assert.Contains("описание записи", html);            // per-page перекрыл site-уровень
            Assert.DoesNotContain("сайт-описание", html);
            Assert.Contains("content=\"/rec.png\"", html);       // per-record og-картинка
            Assert.Contains("application/ld+json", html);
            Assert.Contains("og:type\" content=\"article", html); // canonical → article
            Assert.DoesNotContain("</script>\"}", html);          // payload не закрывает <script>
        }

        [Fact]
        public void PageSeo_ReadsPerPageDescriptionAndOg()
        {
            var doc = "{\"version\":1,\"pages\":[{\"slug\":\"\",\"title\":\"H\"},{\"slug\":\"about\",\"description\":\"про нас\",\"ogImage\":\"/a.png\"}]}";
            var (d, og) = PublishedPageBuilder.PageSeo(doc, "about");
            Assert.Equal("про нас", d);
            Assert.Equal("/a.png", og);
            var (d2, og2) = PublishedPageBuilder.PageSeo(doc, "");
            Assert.Null(d2);
            Assert.Null(og2);
        }

        // Этап 3.4: гейт тарифа — на планах без AllowCustomCode из снапшота вырезаются
        // doc.customCss и doc.head, остальной документ (блоки/тема) сохраняется.
        [Fact]
        public void StripCustomCode_RemovesCustomCssAndHead_KeepsRest()
        {
            var docJson = /*lang=json*/
                "{\"version\":1,\"customCss\":\".x{color:red}\",\"head\":\"<meta name=\\\"v\\\">\",\"blocks\":[{\"id\":\"a\"}]}";

            var stripped = PublishedPageBuilder.StripCustomCode(docJson);

            Assert.DoesNotContain("customCss", stripped);
            Assert.DoesNotContain("\"head\"", stripped);
            Assert.DoesNotContain("color:red", stripped);
            Assert.Contains("\"blocks\"", stripped);   // контент сохранён
            Assert.Contains("\"version\"", stripped);
        }

        [Fact]
        public void StripCustomCode_NoCustomCode_ReturnsUnchanged()
        {
            var docJson = "{\"version\":1,\"blocks\":[{\"id\":\"a\"}]}";
            Assert.Same(docJson, PublishedPageBuilder.StripCustomCode(docJson));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not json")]
        public void StripCustomCode_EmptyOrBroken_ReturnsInput(string input)
        {
            Assert.Equal(input, PublishedPageBuilder.StripCustomCode(input));
        }

        // Премиум-слой: рантаймы подключаются строго по маркерам в контенте — страница без
        // моушна не тащит ни GSAP, ни вендоры (перф-бюджет публикации).
        [Fact]
        public void WrapCustomHtml_NoMotionMarkers_NoMotionScripts()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml("<div class=\"lime-doc-page\"></div>", site);

            Assert.DoesNotContain("gsap.min.js", html);
            Assert.DoesNotContain("split-type.min.js", html);
            Assert.DoesNotContain("lenis.min.js", html);
            Assert.DoesNotContain("lime-webgl.js", html);
            Assert.DoesNotContain("lime-loader.js", html);
            Assert.DoesNotContain("lime-loader-overlay", html);
            Assert.DoesNotContain("lottie_light.min.js", html);
            Assert.Contains("lime-polish.js", html); // сигнатурный лоск — всегда
        }

        [Fact]
        public void WrapCustomHtml_SplitAnim_IncludesSplitTypeBeforeAnimate()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                "<section class=\"lime-block\" data-anim=\"split-chars\"></section>", site);

            Assert.Contains("gsap.min.js", html);
            Assert.Contains("split-type.min.js", html);
            // SplitType раньше lime-animate: defer-скрипты исполняются по порядку документа.
            Assert.True(html.IndexOf("split-type.min.js") < html.IndexOf("lime-animate.js"));
        }

        [Fact]
        public void WrapCustomHtml_PlainAnim_NoSplitType()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                "<section class=\"lime-block\" data-anim=\"fade-up\"></section>", site);

            Assert.Contains("lime-animate.js", html);
            Assert.DoesNotContain("split-type.min.js", html);
        }

        [Fact]
        public void WrapCustomHtml_SmoothMarker_IncludesLenis()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                "<div class=\"lime-doc-page\" data-lime-smooth=\"1\"></div>", site);

            Assert.Contains("lenis.min.js", html);
        }

        [Theory]
        [InlineData("<div class=\"lime-block__layer--particles\" data-gl-particles=\"1\"></div>")]
        [InlineData("<section class=\"lime-block lime-fx-gl-distort\"></section>")]
        public void WrapCustomHtml_WebGlMarkers_IncludeWebGlRuntime(string content)
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(content, site);

            Assert.Contains("lime-webgl.js", html);
        }

        // Прелоадер: оверлей инжектится сервером в начало <body> (CSP публикаций запрещает
        // инлайн-скрипты), стиль пробрасывается из data-lime-loader, скрипт подключён.
        [Theory]
        [InlineData("counter")]
        [InlineData("bar")]
        public void WrapCustomHtml_LoaderMarker_InjectsOverlayAndScript(string style)
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                $"<div class=\"lime-doc-page\" data-lime-loader=\"{style}\"></div>", site);

            Assert.Contains("lime-loader.js", html);
            Assert.Contains("data-lime-loader-overlay", html);
            Assert.Contains($"data-style=\"{style}\"", html);
            // Оверлей — в начале body, до контента.
            Assert.True(html.IndexOf("data-lime-loader-overlay") < html.IndexOf("lime-doc-page"));
        }

        [Fact]
        public void WrapCustomHtml_LottieMarker_IncludesPlayerAndRuntime()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                "<div class=\"lime-block__lottie-stage\" data-lime-lottie data-src=\"/media/1/a.json\"></div>", site);

            Assert.Contains("lottie_light.min.js", html);
            Assert.Contains("lime-lottie.js", html);
            // Плеер раньше рантайма: defer-скрипты исполняются по порядку документа.
            Assert.True(html.IndexOf("lottie_light.min.js") < html.IndexOf("lime-lottie.js"));
        }

        [Fact]
        public void WrapCustomHtml_LoaderMarkerUnknownStyle_NoOverlay()
        {
            var site = new Site { Name = "Сайт", IdSite = 1 };
            var html = PublishedPageBuilder.WrapCustomHtml(
                "<div class=\"lime-doc-page\" data-lime-loader=\"evil\"></div>", site);

            Assert.DoesNotContain("lime-loader.js", html);
            Assert.DoesNotContain("data-lime-loader-overlay", html);
        }

        // Forward-compat (страховка перед schema v2): единственный C#-код, делающий round-trip
        // документа (JObject), ОБЯЗАН сохранять незнакомые поля — иначе v1 и v2 не смогут
        // сосуществовать за feature-flag. Здесь будущее поле v2 переживает strip кастом-кода.
        [Fact]
        public void StripCustomCode_PreservesUnknownFields()
        {
            var docJson = /*lang=json*/
                "{\"version\":2,\"customCss\":\".x{}\",\"futureLayout\":{\"mode\":\"free\"},\"pages\":[{\"id\":\"p0\"}]}";

            var stripped = PublishedPageBuilder.StripCustomCode(docJson);
            var doc = Newtonsoft.Json.Linq.JObject.Parse(stripped);

            Assert.Null(doc["customCss"]);                       // гейт сработал
            Assert.Equal(2, (int)doc["version"]);                // версия сохранена
            Assert.NotNull(doc["futureLayout"]);                 // незнакомое поле НЕ потеряно
            Assert.Equal("free", (string)doc["futureLayout"]["mode"]);
            Assert.NotNull(doc["pages"]);
        }
    }
}
