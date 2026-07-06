using System;
using System.IO;
using Lime_Editor.Services;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Lime.Tests.Services
{
    // MCP/AI-agent API (Wave 1 п.5): JsCommandEngine исполняет lime-commands.js через Jint —
    // тот же dryRunAiCommands, что применяет preview браузера, без единой правки JS-исходника.
    public class JsCommandEngineTests
    {
        private const string SampleDoc = /*lang=json*/ @"{
            ""version"": 1,
            ""theme"": { ""classes"": [] },
            ""components"": {},
            ""pages"": [{ ""id"": ""p0"", ""slug"": """", ""title"": ""Главная"", ""blocks"": [
                { ""id"": ""b1"", ""type"": ""heading"", ""content"": { ""text"": ""Старый заголовок"" } }
            ] }]
        }";

        private static string EnginePath()
        {
            var dir = AppContext.BaseDirectory;
            var root = Path.GetFullPath(Path.Combine(dir, "..", "..", "..", ".."));
            var path = Path.Combine(root, "Lime_Editor", "wwwroot", "js", "lime", "lime-commands.js");
            Assert.True(File.Exists(path), $"lime-commands.js не найден: {path}");
            return path;
        }

        [Fact]
        public void Apply_SetContentMutatesDocument()
        {
            var commands = @"[{""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""Новый заголовок""}}]";
            var engine = new JsCommandEngine(EnginePath());
            var result = engine.Apply(SampleDoc, commands);

            Assert.Equal(1, result.Applied);
            Assert.Contains("b1", result.Affected);
            var doc = JObject.Parse(result.DocumentJson);
            Assert.Equal("Новый заголовок",
                (string)doc["pages"][0]["blocks"][0]["content"]["text"]);
        }

        [Fact]
        public void Apply_TargetingUnknownBlockId_IsNoOp()
        {
            var commands = @"[{""type"":""setContent"",""payload"":{""id"":""no-such-block"",""field"":""text"",""value"":""x""}}]";
            var engine = new JsCommandEngine(EnginePath());
            var result = engine.Apply(SampleDoc, commands);

            Assert.Equal(0, result.Applied);
            Assert.Empty(result.Affected);
            var doc = JObject.Parse(result.DocumentJson);
            Assert.Equal("Старый заголовок",
                (string)doc["pages"][0]["blocks"][0]["content"]["text"]);
        }

        [Fact]
        public void Apply_EmptyCommandList_ReturnsOriginalDocumentUnchanged()
        {
            var engine = new JsCommandEngine(EnginePath());
            var result = engine.Apply(SampleDoc, "[]");

            Assert.Equal(0, result.Applied);
            var doc = JObject.Parse(result.DocumentJson);
            Assert.Equal("Старый заголовок",
                (string)doc["pages"][0]["blocks"][0]["content"]["text"]);
        }
    }
}
