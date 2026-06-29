using System;
using System.Diagnostics;
using System.IO;
using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 0.2: серверная компиляция JSON-документа движка B.
    // Главная гарантия — golden-тест: Jint на сервере и node (как прокси клиента)
    // исполняют один и тот же lime-doc.js и обязаны дать байт-в-байт одинаковый HTML.
    public class JsDocumentRendererTests
    {
        // Документ задействует всё подряд: тему, стили по брейкпоинтам, children,
        // компоненты, медиа-блоки и многостраничность с hash-роутингом.
        private const string SampleDoc = /*lang=json*/ @"{
            ""version"": 1,
            ""theme"": { ""accent"": ""#ff5500"", ""bg"": ""#101018"" },
            ""components"": {
                ""hero"": { ""name"": ""Хедер"", ""block"": {
                    ""type"": ""cover"",
                    ""content"": { ""title"": ""Общий хедер"" },
                    ""styles"": { ""base"": { ""color"": ""#fff"" } },
                    ""children"": [ { ""id"": ""hk1"", ""type"": ""text"", ""content"": { ""text"": ""Из компонента"" } } ]
                } }
            },
            ""pages"": [
                { ""slug"": """", ""title"": ""Главная"", ""blocks"": [
                    { ""id"": ""b1"", ""type"": ""component"", ""ref"": ""hero"" },
                    { ""id"": ""b2"", ""type"": ""heading"", ""content"": { ""text"": ""Спец<символы> & \""кавычки\"""" },
                      ""styles"": { ""base"": { ""fontSize"": ""40px"" }, ""mobile"": { ""fontSize"": ""24px"" } },
                      ""css"": ""h2 { letter-spacing: 2px }"" },
                    { ""id"": ""b3"", ""type"": ""image"", ""content"": { ""src"": ""/media/u1/x.jpg"", ""alt"": ""Фото"", ""caption"": ""Подпись"" } }
                ] },
                { ""slug"": ""about"", ""title"": ""О нас"", ""blocks"": [
                    { ""id"": ""b4"", ""type"": ""video"", ""content"": { ""youtubeId"": ""dQw4w9WgXcQ"" } },
                    { ""id"": ""b5"", ""type"": ""gallery"", ""content"": { ""items"": [ { ""src"": ""/media/u1/a.jpg"" } ] } }
                ] }
            ]
        }";

        private const string V2FreeDoc = /*lang=json*/ @"{
            ""version"": 2, ""theme"": {}, ""components"": {},
            ""pages"": [{ ""id"": ""p0"", ""slug"": """", ""title"": ""Free"", ""blocks"": [
                { ""id"": ""free"", ""type"": ""container"", ""content"": {},
                  ""design"": { ""base"": {
                    ""layout"": { ""mode"": ""free"", ""padding"": { ""top"": 16, ""right"": 16, ""bottom"": 16, ""left"": 16 } },
                    ""size"": { ""width"": { ""mode"": ""fill"" }, ""height"": { ""mode"": ""fixed"", ""value"": 480 } }
                  } },
                  ""children"": [
                    { ""id"": ""free-title"", ""type"": ""heading"", ""content"": { ""text"": ""Свободный hero"" },
                      ""design"": { ""base"": { ""frame"": { ""x"": 40, ""y"": 80, ""width"": 360, ""height"": 100, ""rotation"": 0 } },
                                      ""mobile"": { ""frame"": { ""x"": 16, ""width"": 280 } } } }
                  ] }
            ] }]
        }";

        // Stage 8.2: общий комплексный fixture (тот же файл гоняет node self-test) — 5 эталонных
        // макетов + v2 design + компоненты/варианты/overrides + формы/медиа/CMS/анимации старого
        // формата + неизвестный тип/поля. Критерий §8: один fixture без структурных различий.
        private static string ParityFixturePath()
        {
            var dir = AppContext.BaseDirectory;
            var root = Path.GetFullPath(Path.Combine(dir, "..", "..", "..", ".."));
            var path = Path.Combine(root, "tests", "fixtures", "editor-v2-parity.json");
            Assert.True(File.Exists(path), $"parity fixture не найден: {path}");
            return path;
        }

        [Fact]
        public void ParityFixture_PublishAndExport_MatchNodeOutput_Golden()
        {
            var enginePath = EnginePath();
            var docFile = ParityFixturePath();
            // publish (renderSite), export-CSS (compileDocCss) и per-page (renderPage) — сервер==node.
            var nodeSite = TryRunNode(enginePath, docFile, "L.renderSite(doc)");
            var nodeCss = TryRunNode(enginePath, docFile, "L.compileDocCss(doc)");
            var nodePage = TryRunNode(enginePath, docFile, "L.renderPage(doc,'about',{baseUrl:'/u/user/site'}).body");
            if (nodeSite == null || nodeCss == null || nodePage == null) return; // node не установлен
            var docJson = File.ReadAllText(docFile);
            var renderer = new JsDocumentRenderer(enginePath);
            Assert.Equal(nodeSite, renderer.RenderSite(docJson));
            Assert.Equal(nodeCss, renderer.CompileCss(docJson));
            Assert.Equal(nodePage, renderer.RenderPage(docJson, "about", "/u/user/site").Body);
        }

        [Fact]
        public void ParityFixture_Publish_HasNoEditorOnlyArtifacts()
        {
            var docJson = File.ReadAllText(ParityFixturePath());
            var html = new JsDocumentRenderer(EnginePath()).RenderSite(docJson);
            foreach (var marker in new[] { "contenteditable", "data-field", "data-doc-pick", "data-doc-video",
                "data-doc-embed", "data-doc-gallery-add", "data-layer-id", "lime-block-grip",
                "lime-doc-drop-hint", "lime-doc-media-swap", "data-node-hidden", "data-node-locked" })
            {
                Assert.DoesNotContain(marker, html);
            }
            Assert.DoesNotContain("СЕКРЕТ", html);                              // hidden-узел не публикуется
            Assert.Contains("Неизвестный блок: futuristicWidget3000", html);    // неизвестный тип → fallback, не краш
            Assert.DoesNotContain("experimentalGlow", html);                    // неизвестные поля не утекают
        }

        private static string EnginePath()
        {
            // Lime.Tests/bin/Debug/net8.0 → корень репо → Lime_Editor/wwwroot/js/lime/lime-doc.js
            var dir = AppContext.BaseDirectory;
            var root = Path.GetFullPath(Path.Combine(dir, "..", "..", "..", ".."));
            var path = Path.Combine(root, "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js");
            Assert.True(File.Exists(path), $"lime-doc.js не найден: {path}");
            return path;
        }

        [Fact]
        public void RenderSite_CompilesFullDocument()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            var html = renderer.RenderSite(SampleDoc);

            // Тема, страницы, hash-роутинг
            Assert.Contains("--lt-accent:#ff5500", html);
            Assert.Contains("data-lime-pages", html);
            Assert.Contains("data-lime-page=\"about\"", html);
            // Компонент с children
            Assert.Contains("Общий хедер", html);
            Assert.Contains("Из компонента", html);
            // Экранирование пользовательского текста
            Assert.Contains("Спец&lt;символы&gt; &amp;", html);
            // Стили: base + mobile media + scoped css
            Assert.Contains("[data-block-id=\"b2\"]{font-size:40px;}", html);
            Assert.Contains("@media(max-width:640px){[data-block-id=\"b2\"]{font-size:24px;}}", html);
            Assert.Contains("[data-block-id=\"b2\"] h2", html);
            // Медиа-блоки без редакторских хуков
            Assert.Contains("youtube.com/embed/dQw4w9WgXcQ", html);
            Assert.DoesNotContain("data-doc-pick", html);
        }

        [Fact]
        public void RenderSite_CompilesReusableClassesAndTokens()
        {
            // Этап 0.1: переиспользуемые style-классы и расширенные токены должны компилироваться
            // и на сервере (Jint исполняет тот же lime-doc.js) — инвариант «один рендер везде».
            var renderer = new JsDocumentRenderer(EnginePath());
            var doc = /*lang=json*/ @"{
                ""version"": 1,
                ""theme"": {
                    ""palette"": [ ""#112233"", ""#445566"" ],
                    ""classes"": [
                        { ""cls"": ""btnX"", ""name"": ""Кнопка"", ""styles"": {
                            ""base"": { ""color"": ""#fff"", ""padding"": ""12px"" },
                            ""hover"": { ""color"": ""#84cc16"" }
                        } },
                        { ""cls"": ""bad name"", ""styles"": { ""base"": { ""color"": ""#000"" } } }
                    ]
                },
                ""blocks"": [
                    { ""id"": ""bc1"", ""type"": ""cta"", ""content"": { ""title"": ""T"" }, ""classes"": [ ""btnX"" ] }
                ]
            }";
            var html = renderer.RenderSite(doc);

            Assert.Contains(".lime-c-btnX{color:#fff;padding:12px;}", html);
            Assert.Contains(".lime-c-btnX:hover{color:#84cc16;}", html);
            Assert.Contains("class=\"lime-block lime-c-btnX\"", html);
            // Невалидный cls (с пробелом) отброшен whitelist'ом safeCls.
            Assert.DoesNotContain("bad name", html);
            // Расширенные токены: палитра + фиксированные шкалы.
            Assert.Contains("--lt-c1:#112233;", html);
            Assert.Contains("--lt-space-4:16px;", html);
            Assert.Contains("--lt-text-2xl:1.5rem;", html);
        }

        // Stage 8.1: значения/имена стилей и сырой block.css не должны выходить из CSS-правила (})
        // или закрывать <style> (</style>) на серверном publish-пути (он НЕ прогоняет HTML-санитайзер
        // — экранирование рендерера и есть граница безопасности, см. PublishedSiteController).
        private const string MaliciousStylesDoc = /*lang=json*/ @"{
            ""version"": 1,
            ""theme"": { ""classes"": [
                { ""cls"": ""evil"", ""styles"": { ""base"": { ""color"": ""red}body{display:none"" } } },
                { ""cls"": ""safe"", ""styles"": { ""base"": { ""color"": ""#0f0"", ""padding"": ""10px"" } } }
            ] },
            ""pages"": [ { ""slug"": """", ""title"": ""T"", ""blocks"": [
                { ""id"": ""m1"", ""type"": ""text"", ""content"": { ""text"": ""x"" }, ""styles"": { ""base"": {
                    ""color"": ""red}html{display:none"", ""boxShadow"": ""0 8px 24px rgba(0,0,0,.3)"", ""fontSize"": ""16px"" } } },
                { ""id"": ""m2"", ""type"": ""text"", ""content"": { ""text"": ""y"" },
                  ""css"": ""color:red} body{display:none} </style><script>alert(1)</script>"" }
            ] } ]
        }";

        [Fact]
        public void RenderSite_StyleValues_AreSanitizedAgainstCssBreakout()
        {
            // CompileCss = сырой CSS документа (без <style>-обёртки renderSite) — на нём проверяем,
            // что компиляция не образует постороннее правило и не закрывает <style>.
            var css = new JsDocumentRenderer(EnginePath()).CompileCss(MaliciousStylesDoc);
            // Breakout-значение/класс отброшены; безопасные соседи уцелели.
            Assert.DoesNotContain("}html{display:none", css);
            Assert.DoesNotContain("color:red}body", css);
            Assert.Contains("box-shadow:0 8px 24px rgba(0,0,0,.3)", css);
            Assert.Contains(".lime-c-safe{color:#0f0;padding:10px;}", css);
            // Граница безопасности: ни стиль-значение, ни сырой block.css не могут ЗАКРЫТЬ <style>
            // (</style>), поэтому любой оставшийся текст остаётся инертным внутри <style>-блока.
            Assert.DoesNotContain("</style", css);
        }

        [Fact]
        public void RenderSite_SocialHref_SanitizesUnsafeSchemes()
        {
            var doc = /*lang=json*/ @"{
                ""version"": 1,
                ""pages"": [ { ""slug"": """", ""title"": ""T"", ""blocks"": [
                    { ""id"": ""s1"", ""type"": ""socials"", ""content"": { ""items"": [
                        { ""platform"": ""Bad"", ""url"": ""javascript:alert(1)"" },
                        { ""platform"": ""Good"", ""url"": ""https://example.com/profile"" }
                    ] } }
                ] } ]
            }";

            var html = new JsDocumentRenderer(EnginePath()).RenderSite(doc);

            Assert.DoesNotContain("javascript:alert", html);
            Assert.Contains("href=\"#\"", html);
            Assert.Contains("href=\"https://example.com/profile\"", html);
        }

        [Fact]
        public void RenderSite_NullAndEmptyDoc_DoNotThrow()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            Assert.Contains("lime-doc-page", renderer.RenderSite(null));
            Assert.Contains("lime-doc-page", renderer.RenderSite("{}"));
        }

        // Циклическая вложенность компонента: instance внутри собственного definition'а.
        private const string CyclicDoc = /*lang=json*/ @"{ ""version"": 1, ""theme"": {},
            ""components"": { ""loop"": { ""block"": { ""type"": ""frame"",
                ""children"": [
                    { ""id"": ""inner"", ""type"": ""text"", ""content"": { ""text"": ""Внутри"" } },
                    { ""id"": ""s1"", ""type"": ""component"", ""ref"": ""loop"" }
                ] } } },
            ""pages"": [ { ""slug"": """", ""title"": ""T"",
                ""blocks"": [ { ""id"": ""c1"", ""type"": ""component"", ""ref"": ""loop"" } ] } ] }";

        [Fact]
        public void RenderSite_CyclicComponent_GuardRendersInnerOnce()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            var html = renderer.RenderSite(CyclicDoc); // не должен зависнуть/упасть/раздуться
            Assert.Contains("lime-doc-page", html);
            // Cycle guard вырождает вложенный instance в пустоту → внутренний текст ровно один раз,
            // никакого взрыва на MAX_DEPTH уровней.
            Assert.Equal(1, CountOccurrences(html, "Внутри"));
            // В publish маркер цикла не выводится.
            Assert.DoesNotContain("__component_cycle", html);
        }

        [Fact]
        public void RenderSite_CyclicComponent_MatchesNodeOutput_Golden()
        {
            var enginePath = EnginePath();
            var docFile = WriteTempDoc(CyclicDoc);
            try
            {
                var nodeHtml = TryRunNode(enginePath, docFile, "L.renderSite(doc)");
                var nodeCss = TryRunNode(enginePath, docFile, "L.compileDocCss(doc)");
                if (nodeHtml == null || nodeCss == null) return; // node не установлен
                var renderer = new JsDocumentRenderer(enginePath);
                Assert.Equal(nodeHtml, renderer.RenderSite(CyclicDoc));
                Assert.Equal(nodeCss, renderer.CompileCss(CyclicDoc));
            }
            finally { File.Delete(docFile); }
        }

        private static int CountOccurrences(string haystack, string needle)
        {
            int count = 0, i = 0;
            while ((i = haystack.IndexOf(needle, i, StringComparison.Ordinal)) >= 0) { count++; i += needle.Length; }
            return count;
        }

        [Fact]
        public void RenderPage_ReturnsSinglePage_WithRealNavAndTitle()
        {
            var renderer = new JsDocumentRenderer(EnginePath());

            var home = renderer.RenderPage(SampleDoc, "", "/u/user/site");
            Assert.NotNull(home);
            Assert.Contains("Общий хедер", home.Body);
            Assert.DoesNotContain("dQw4w9WgXcQ", home.Body); // блоки второй страницы не утекли
            Assert.Contains("href=\"/u/user/site/about\"", home.Body);
            Assert.Contains("class=\"is-active\"", home.Body);
            Assert.DoesNotContain("data-lime-pages", home.Body);

            var about = renderer.RenderPage(SampleDoc, "about", "/u/user/site");
            Assert.Equal("О нас", about.Title);
            Assert.Contains("dQw4w9WgXcQ", about.Body);
            Assert.DoesNotContain("Общий хедер", about.Body);
        }

        [Fact]
        public void RenderPage_UnknownSlug_ReturnsNull()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            Assert.Null(renderer.RenderPage(SampleDoc, "no-such", "/u/user/site"));
        }

        // CMS 2.0: страница-шаблон (page.collection) с блоками content.bind рендерится для одной
        // записи — значения берутся из recordJson. Инвариант «один рендер»: Jint == браузер.
        private const string TemplateDoc = /*lang=json*/ @"{
            ""version"": 1, ""theme"": {}, ""components"": {},
            ""pages"": [
                { ""slug"": """", ""title"": ""Главная"", ""blocks"": [
                    { ""id"": ""cl"", ""type"": ""collectionList"", ""content"": { ""collection"": ""posts"" } } ] },
                { ""slug"": ""post"", ""title"": ""Пост"", ""collection"": ""posts"", ""blocks"": [
                    { ""id"": ""h"", ""type"": ""heading"", ""content"": { ""bind"": ""title"" } },
                    { ""id"": ""t"", ""type"": ""text"", ""content"": { ""bind"": ""body"" } } ] }
            ]
        }";

        [Fact]
        public void RenderPage_BindsRecordFieldsOnTemplatePage()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            var record = @"{ ""title"": ""Привет<b>"", ""body"": ""Тело поста"" }";
            var page = renderer.RenderPage(TemplateDoc, "post", "/u/u/s", null, record);
            Assert.NotNull(page);
            Assert.Contains("lime-block__heading\">Привет&lt;b&gt;", page.Body); // значение записи + экранирование
            Assert.Contains("lime-block__text\">Тело поста", page.Body);
            Assert.DoesNotContain("data-field", page.Body); // публикация без редакторских хуков

            // Без записи — обычный рендер со статичным дефолтом блока.
            var plain = renderer.RenderPage(TemplateDoc, "post", "/u/u/s");
            Assert.Contains("lime-block__heading\">Раздел", plain.Body);
        }

        // GOLDEN: сервер (Jint) == клиент (node) байт-в-байт на одном lime-doc.js.
        // Это tripwire инварианта «один рендер везде»: ЛЮБАЯ правка движка (включая будущий v2),
        // меняющая вывод golden-fixture, валит тест. Покрываем оба контракта: publish (renderSite)
        // и export (compileDocCss). node нет в окружении → тест тихо проходит (golden гоняется в dev/CI).
        [Fact]
        public void RenderSite_MatchesNodeOutput_Golden()
        {
            var enginePath = EnginePath();
            var docFile = WriteTempDoc(SampleDoc);
            try
            {
                var nodeHtml = TryRunNode(enginePath, docFile, "L.renderSite(doc)");
                if (nodeHtml == null) return; // node не установлен
                Assert.Equal(nodeHtml, new JsDocumentRenderer(enginePath).RenderSite(SampleDoc));
            }
            finally { File.Delete(docFile); }
        }

        [Fact]
        public void V2Free_RenderAndCss_MatchNodeOutput()
        {
            var enginePath = EnginePath();
            var docFile = WriteTempDoc(V2FreeDoc);
            try
            {
                var nodeHtml = TryRunNode(enginePath, docFile, "L.renderSite(doc)");
                var nodeCss = TryRunNode(enginePath, docFile, "L.compileDocCss(doc)");
                if (nodeHtml == null || nodeCss == null) return;
                var renderer = new JsDocumentRenderer(enginePath);
                var serverHtml = renderer.RenderSite(V2FreeDoc);
                var serverCss = renderer.CompileCss(V2FreeDoc);
                Assert.Equal(nodeHtml, serverHtml);
                Assert.Equal(nodeCss, serverCss);
                Assert.Contains("data-design=\"1\"", serverHtml);
                Assert.Contains("position:absolute;left:40px;top:80px", serverCss);
                Assert.Contains("@media(max-width:640px)", serverCss);
            }
            finally { File.Delete(docFile); }
        }

        [Fact]
        public void CompileCss_MatchesNodeOutput_Golden()
        {
            var enginePath = EnginePath();
            var docFile = WriteTempDoc(SampleDoc);
            try
            {
                var nodeCss = TryRunNode(enginePath, docFile, "L.compileDocCss(doc)");
                if (nodeCss == null) return; // node не установлен
                Assert.Equal(nodeCss, new JsDocumentRenderer(enginePath).CompileCss(SampleDoc));
            }
            finally { File.Delete(docFile); }
        }

        private static string WriteTempDoc(string json)
        {
            var f = Path.Combine(Path.GetTempPath(), "lime-golden-" + Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(f, json);
            return f;
        }

        // Запускает node с lime-doc.js и JS-выражением над doc; возвращает stdout.
        // null — node не установлен (golden пропускаем). Бросает при ненулевом коде выхода.
        private static string TryRunNode(string enginePath, string docFile, string jsExpr)
        {
            var script =
                "const L=require(process.argv[1]);" +
                "const fs=require('fs');" +
                "const doc=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));" +
                "process.stdout.write(" + jsExpr + ");";
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                // node пишет UTF-8; без явной кодировки Windows читает stdout в кодировке консоли (CP866).
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
            };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add(script);
            psi.ArgumentList.Add(enginePath);
            psi.ArgumentList.Add(docFile);
            try
            {
                using var proc = Process.Start(psi);
                var outp = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(15000);
                if (proc.ExitCode != 0)
                {
                    throw new Xunit.Sdk.XunitException("node упал: " + proc.StandardError.ReadToEnd());
                }
                return outp;
            }
            catch (System.ComponentModel.Win32Exception)
            {
                return null; // node не установлен — golden пропускаем
            }
        }
    }
}
