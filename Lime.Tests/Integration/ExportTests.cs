using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.Extensions.DependencyInjection;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Xunit;

namespace Lime.Tests.Integration
{
    // «Eject» в Next.js (Итерация 4): экспорт сайта в фуллстак-проект.
    public class ExportTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public ExportTests(WebFactory factory) => _factory = factory;

        private static string ReadEntry(ZipArchive zip, string name)
        {
            var e = zip.GetEntry(name);
            Assert.NotNull(e);
            using var r = new StreamReader(e.Open());
            return r.ReadToEnd();
        }

        [Fact]
        public void NextExport_ProducesRunnableFullstackProject()
        {
            using var scope = _factory.Services.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<NextExportService>();

            var doc = "{\"version\":1,\"pages\":[{\"slug\":\"\",\"title\":\"H\",\"blocks\":[" +
                      "{\"id\":\"x\",\"type\":\"collectionList\",\"content\":{\"collection\":\"goods\"}}]}]}";
            var col = new Collection { Id = 1, SiteId = 1, Name = "Goods", Slug = "goods", SchemaJson = "[{\"name\":\"title\",\"type\":\"text\",\"label\":\"T\"}]" };
            var rec = new CollectionRecord { Id = 1, CollectionId = 1, DataJson = "{\"title\":\"Виджет\"}" };

            var bytes = svc.BuildZip("My Site", doc, new[] { col }, new[] { rec });
            Assert.True(bytes.Length > 2000);

            using var ms = new MemoryStream(bytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            var names = zip.Entries.Select(e => e.FullName).ToHashSet();

            // Каркас проекта на месте.
            foreach (var n in new[] {
                "package.json", "next.config.mjs", "prisma/schema.prisma", "prisma/seed.mjs",
                "lib/limedoc.cjs", "lib/doc.json", "lib/render.mjs", "lib/data.mjs",
                "app/layout.jsx", "app/page.jsx", "app/[slug]/page.jsx", "app/api/form/route.js",
                "app/lime.css" })
            {
                Assert.Contains(n, names);
            }

            // Документ встроен.
            Assert.Contains("collectionList", ReadEntry(zip, "lib/doc.json"));
            // Переиспользован НАШ рендерер (а не сгенерён заново).
            var limedoc = ReadEntry(zip, "lib/limedoc.cjs");
            Assert.Contains("renderPage", limedoc);
            Assert.Contains("module.exports", limedoc);
            // Сид содержит коллекцию и запись.
            var seed = ReadEntry(zip, "prisma/seed.mjs");
            Assert.Contains("goods", seed);
            Assert.Contains("Виджет", seed);
            // CSS склеен (дизайн-система).
            Assert.Contains("lime-block", ReadEntry(zip, "app/lime.css"));
            // package.json валидно начинается.
            Assert.Contains("\"next\"", ReadEntry(zip, "package.json"));
        }

        [Fact]
        public void NextExport_Idiomatic_ProducesReactComponents()
        {
            using var scope = _factory.Services.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<NextExportService>();

            var doc = "{\"version\":1,\"theme\":{\"accent\":\"#84cc16\"},\"pages\":[{\"slug\":\"\",\"title\":\"H\",\"blocks\":[" +
                      "{\"id\":\"h1\",\"type\":\"heading\",\"content\":{\"text\":\"Привет\"},\"styles\":{\"base\":{\"color\":\"#fff\"}}}," +
                      "{\"id\":\"p1\",\"type\":\"pricing\"}]}]}";

            var bytes = svc.BuildZip("Site", doc, new Collection[0], new CollectionRecord[0], idiomatic: true);
            using var ms = new MemoryStream(bytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            var names = zip.Entries.Select(e => e.FullName).ToHashSet();

            // Идиоматичный каркас: компоненты + скомпилированный CSS + doc-модуль.
            Assert.Contains("components/Blocks.jsx", names);
            Assert.Contains("app/blocks.css", names);
            Assert.Contains("lib/doc.mjs", names);
            Assert.Contains("lib/renderblock.mjs", names);

            var blocks = ReadEntry(zip, "components/Blocks.jsx");
            Assert.Contains("export function Block", blocks);
            Assert.Contains("case 'pricing'", blocks);          // настоящий компонент для тарифов
            Assert.Contains("lime-block__heading", blocks);

            var css = ReadEntry(zip, "app/blocks.css");
            Assert.Contains("--lt-accent:#84cc16", css);          // тема скомпилирована
            Assert.Contains("[data-block-id=\"h1\"]{color:#fff;}", css); // стиль блока скомпилирован

            var docMjs = ReadEntry(zip, "lib/doc.mjs");
            Assert.Contains("export const doc", docMjs);
            Assert.Contains("Привет", docMjs);

            // layout импортирует оба css.
            Assert.Contains("blocks.css", ReadEntry(zip, "app/layout.jsx"));
        }

        // Stage 8.3: идиоматичный React-экспорт не теряет паритет с движком — reusable-классы
        // навешиваются на секцию (их CSS уже в blocks.css), а v2 design-блоки уходят в engine-fallback.
        [Fact]
        public void NextExport_Idiomatic_PreservesClassesAndRoutesDesignToEngine()
        {
            using var scope = _factory.Services.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<NextExportService>();

            var doc = "{\"version\":2,\"theme\":{\"classes\":[{\"cls\":\"pill\",\"styles\":{\"base\":{\"borderRadius\":\"999px\"}}}]}," +
                      "\"pages\":[{\"slug\":\"\",\"title\":\"H\",\"blocks\":[" +
                      "{\"id\":\"h1\",\"type\":\"heading\",\"content\":{\"text\":\"T\"},\"classes\":[\"pill\"]}," +
                      "{\"id\":\"free\",\"type\":\"container\",\"design\":{\"base\":{\"layout\":{\"mode\":\"free\"}}},\"children\":[" +
                      "{\"id\":\"fc\",\"type\":\"heading\",\"content\":{\"text\":\"F\"},\"design\":{\"base\":{\"frame\":{\"x\":10,\"y\":20,\"width\":100,\"height\":40}}}}]}]}]}";

            var bytes = svc.BuildZip("Site", doc, new Collection[0], new CollectionRecord[0], idiomatic: true);
            using var ms = new MemoryStream(bytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);

            var blocks = ReadEntry(zip, "components/Blocks.jsx");
            var css = ReadEntry(zip, "app/blocks.css");

            // Reusable-класс компилируется И секция его навешивает (не теряется).
            Assert.Contains(".lime-c-pill{border-radius:999px;}", css);
            Assert.Contains("clsClass", blocks);
            // v2 design учитывается в gate complex → такие блоки идут в engine-fallback (RawBlock).
            Assert.Contains("b.design", blocks);
            // Геометрия free-child скомпилирована в общий CSS (одинаково с publish).
            Assert.Contains("position:absolute;left:10px;top:20px;width:100px;height:40px", css);
        }

        [Fact]
        public void NextExport_HandlesEmptyDocAndNoCollections()
        {
            using var scope = _factory.Services.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<NextExportService>();
            var bytes = svc.BuildZip("Empty", null, new Collection[0], new CollectionRecord[0]);
            using var ms = new MemoryStream(bytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            // Даже пустой сайт даёт валидный каркас.
            Assert.NotNull(zip.GetEntry("package.json"));
            Assert.Contains("[]", ReadEntry(zip, "prisma/seed.mjs")); // пустой сид-массив
        }
    }
}
