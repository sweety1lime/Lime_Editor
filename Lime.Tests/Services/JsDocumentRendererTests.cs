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

        [Fact]
        public void RenderSite_NullAndEmptyDoc_DoNotThrow()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            Assert.Contains("lime-doc-page", renderer.RenderSite(null));
            Assert.Contains("lime-doc-page", renderer.RenderSite("{}"));
        }

        [Fact]
        public void RenderSite_CyclicComponent_TerminatesByDepthLimit()
        {
            var renderer = new JsDocumentRenderer(EnginePath());
            var doc = @"{ ""version"": 1,
                ""components"": { ""loop"": { ""block"": { ""type"": ""spacer"",
                    ""children"": [ { ""id"": ""s1"", ""type"": ""component"", ""ref"": ""loop"" } ] } } },
                ""blocks"": [ { ""id"": ""c1"", ""type"": ""component"", ""ref"": ""loop"" } ] }";
            var html = renderer.RenderSite(doc); // не должен зависнуть/упасть
            Assert.Contains("lime-doc-page", html);
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

        // GOLDEN: сервер (Jint) == клиент (node) байт-в-байт на одном lime-doc.js.
        // Если node недоступен в окружении — тест тихо проходит (golden гоняется в dev/CI, где node есть).
        [Fact]
        public void RenderSite_MatchesNodeOutput_Golden()
        {
            var enginePath = EnginePath();
            var docFile = Path.Combine(Path.GetTempPath(), "lime-golden-" + Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(docFile, SampleDoc);
            try
            {
                var script =
                    "const L=require(process.argv[1]);" +
                    "const fs=require('fs');" +
                    "const doc=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));" +
                    "process.stdout.write(L.renderSite(doc));";
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

                string nodeHtml;
                try
                {
                    using var proc = Process.Start(psi);
                    nodeHtml = proc.StandardOutput.ReadToEnd();
                    proc.WaitForExit(15000);
                    if (proc.ExitCode != 0)
                    {
                        throw new Xunit.Sdk.XunitException("node упал: " + proc.StandardError.ReadToEnd());
                    }
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    return; // node не установлен — golden пропускаем
                }

                var jintHtml = new JsDocumentRenderer(enginePath).RenderSite(SampleDoc);
                Assert.Equal(nodeHtml, jintHtml);
            }
            finally
            {
                File.Delete(docFile);
            }
        }
    }
}
