#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using Jint;
using Newtonsoft.Json.Linq;

namespace Lime_Editor.Services
{
    // Исполняет lime-commands.js (тот же файл, что грузит браузер) через Jint — зеркалит
    // JsDocumentRenderer's паттерн: singleton кэширует исходник, Engine создаётся на каждый
    // вызов (не потокобезопасен). Переиспользует dryRunAiCommands без единой правки JS —
    // тот же клон-примени-верни-документ, что использует preview браузера.
    public class JsCommandEngine : IDocumentCommandEngine
    {
        private readonly string _engineSource;

        public JsCommandEngine(Microsoft.AspNetCore.Hosting.IWebHostEnvironment env)
            : this(Path.Combine(env.WebRootPath, "js", "lime", "lime-commands.js"))
        {
        }

        // Для тестов — путь к lime-commands.js напрямую.
        public JsCommandEngine(string enginePath)
        {
            _engineSource = File.ReadAllText(enginePath);
        }

        public ApplyCommandsResult Apply(string documentJson, string commandsJson)
        {
            var engine = new Engine(options => options
                .LimitRecursion(256)
                .TimeoutInterval(TimeSpan.FromSeconds(5)));
            engine.Execute("var module = { exports: {} };");
            engine.Execute(_engineSource);
            engine.SetValue("__docJson", documentJson ?? "null");
            engine.SetValue("__commandsJson", commandsJson ?? "[]");

            var resultJson = engine.Evaluate(
                "JSON.stringify(module.exports.dryRunAiCommands(JSON.parse(__docJson), JSON.parse(__commandsJson)))"
            ).AsString();

            var obj = JObject.Parse(resultJson);
            var applied = obj.Value<int?>("applied") ?? 0;
            var affected = obj["affected"]?.ToObject<List<string>>() ?? new List<string>();
            var newDocumentJson = obj["result"] != null
                ? obj["result"]!.ToString(Newtonsoft.Json.Formatting.None)
                : (documentJson ?? "null");
            return new ApplyCommandsResult(applied, affected, newDocumentJson);
        }
    }
}
