using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Lime_Editor.Mcp;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Lime.Tests.Mcp
{
    // MCP/AI-agent API (Wave 1 п.5): SiteTools резолвит LimeEditorContext по DI (подтверждено
    // живым спайком) — tenant-изоляция приходит бесплатно через global query filter. Здесь
    // проверяем ровно это: чужой сайт не виден/не редактируется, конфликт версии не даёт
    // затереть чужую правку.
    public class SiteToolsTests
    {
        private sealed class StubUser : ICurrentUser
        {
            public StubUser(int? id) => UserId = id;
            public int? UserId { get; }
        }

        private static string EnginePath()
        {
            var dir = AppContext.BaseDirectory;
            var root = Path.GetFullPath(Path.Combine(dir, "..", "..", "..", ".."));
            var path = Path.Combine(root, "Lime_Editor", "wwwroot", "js", "lime", "lime-commands.js");
            Assert.True(File.Exists(path), $"lime-commands.js не найден: {path}");
            return path;
        }

        private static DbContextOptions<LimeEditorContext> NewOptions() =>
            new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("sitetools_" + Guid.NewGuid().ToString("N"))
                .Options;

        private const string DocJson = /*lang=json*/ @"{
            ""version"": 1, ""theme"": { ""classes"": [] }, ""components"": {},
            ""pages"": [{ ""id"": ""p0"", ""slug"": """", ""title"": ""Главная"", ""blocks"": [
                { ""id"": ""b1"", ""type"": ""heading"", ""content"": { ""text"": ""Привет"" } }
            ] }]
        }";

        private static void Seed(DbContextOptions<LimeEditorContext> options)
        {
            using var db = new LimeEditorContext(options, new StubUser(null));
            db.Sites.Add(new Site { IdSite = 1, UserId = 10, Name = "Сайт A", Folder = "x", TemplateId = 1, DocumentJson = DocJson, UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
            db.Sites.Add(new Site { IdSite = 2, UserId = 10, Name = "Сайт A2", Folder = "x", TemplateId = 1, DocumentJson = DocJson, UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
            db.Sites.Add(new Site { IdSite = 3, UserId = 20, Name = "Сайт B (чужой)", Folder = "x", TemplateId = 1, DocumentJson = DocJson, UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
            db.SaveChanges();
        }

        private static SiteTools ToolsFor(DbContextOptions<LimeEditorContext> options, int userId)
        {
            var stubUser = new StubUser(userId);
            var db = new LimeEditorContext(options, stubUser);
            return new SiteTools(db, new JsCommandEngine(EnginePath()), stubUser);
        }

        [Fact]
        public async Task ListSites_OnlyReturnsCallersOwnSites()
        {
            var options = NewOptions();
            Seed(options);

            var result = await ToolsFor(options, 10).ListSites();

            Assert.Equal(2, result.Count);
            Assert.All(result, s => Assert.Contains("Сайт A", s.Name));
        }

        // Регрессия на реальный баг, найденный живым E2E (не юнит-тестами): в MCP-запросе
        // ambient global query filter LimeEditorContext оказался no-op (конструктор контекста
        // захватывает _currentUserId раньше, чем ApiTokenAuthenticationHandler успевает
        // проставить claim). SiteTools больше не полагается на этот амбиентный фильтр — здесь
        // явно эмулируем именно ту поломку (контекст сконструирован БЕЗ пользователя, т.е.
        // фильтр выключен) и проверяем, что собственная explicit-фильтрация SiteTools всё
        // равно не даёт увидеть чужой сайт.
        [Fact]
        public async Task ListSites_EvenIfAmbientContextFilterIsDisabled_StillIsolatesByOwnExplicitFilter()
        {
            var options = NewOptions();
            Seed(options);
            var dbWithNoAmbientFilter = new LimeEditorContext(options, new StubUser(null)); // фильтр выключен
            var tools = new SiteTools(dbWithNoAmbientFilter, new JsCommandEngine(EnginePath()), new StubUser(10));

            var result = await tools.ListSites();

            Assert.Equal(2, result.Count);
            Assert.All(result, s => Assert.Contains("Сайт A", s.Name));
        }

        [Fact]
        public async Task GetSiteDocument_OtherUsersSite_ReturnsNull()
        {
            var options = NewOptions();
            Seed(options);

            var doc = await ToolsFor(options, 10).GetSiteDocument(3); // сайт пользователя 20

            Assert.Null(doc);
        }

        [Fact]
        public async Task GetSiteDocument_OwnSite_ReturnsDocumentAndVersion()
        {
            var options = NewOptions();
            Seed(options);

            var doc = await ToolsFor(options, 10).GetSiteDocument(1);

            Assert.NotNull(doc);
            Assert.Contains("Привет", doc!.DocumentJson);
            Assert.True(long.Parse(doc.UpdatedAtVersion) > 0);
        }

        [Fact]
        public async Task ApplyCommands_OtherUsersSite_ReturnsSiteNotFound()
        {
            var options = NewOptions();
            Seed(options);

            var result = await ToolsFor(options, 10).ApplyCommands(
                3, @"[{""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""x""}}]", "0");

            Assert.False(result.Ok);
            Assert.Equal("site_not_found", result.Error);
        }

        [Fact]
        public async Task ApplyCommands_ValidCommand_PersistsAndBumpsVersion()
        {
            var options = NewOptions();
            Seed(options);
            var baseVersion = (await ToolsFor(options, 10).GetSiteDocument(1))!.UpdatedAtVersion;

            var result = await ToolsFor(options, 10).ApplyCommands(
                1, @"[{""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""Обновлено""}}]", baseVersion);

            Assert.True(result.Ok);
            Assert.Equal(1, result.Applied);
            Assert.Contains("b1", result.Affected!);

            var reread = await ToolsFor(options, 10).GetSiteDocument(1);
            Assert.Contains("Обновлено", reread!.DocumentJson);
            Assert.True(long.Parse(reread.UpdatedAtVersion) > long.Parse(baseVersion));
        }

        [Fact]
        public async Task ApplyCommands_StaleBaseVersion_ReturnsConflictWithoutMutating()
        {
            var options = NewOptions();
            Seed(options);

            var result = await ToolsFor(options, 10).ApplyCommands(
                1, @"[{""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""Затирание""}}]", "0");

            Assert.False(result.Ok);
            Assert.Equal("version_conflict", result.Error);

            var reread = await ToolsFor(options, 10).GetSiteDocument(1);
            Assert.DoesNotContain("Затирание", reread!.DocumentJson);
        }
    }
}
