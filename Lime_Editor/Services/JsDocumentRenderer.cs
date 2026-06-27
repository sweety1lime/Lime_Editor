using System;
using System.IO;
using Jint;

namespace Lime_Editor.Services
{
    // Исполняет lime-doc.js (тот же файл, что грузит браузер) через Jint —
    // «один рендерер» сохраняется буквально, Node в проде не нужен.
    // Engine у Jint не потокобезопасен → создаём на каждый вызов; публикация
    // редкая операция, парсинг ~300 строк ES5 — миллисекунды.
    public class JsDocumentRenderer : IDocumentRenderer
    {
        private readonly string _engineSource;

        public JsDocumentRenderer(Microsoft.AspNetCore.Hosting.IWebHostEnvironment env)
            : this(Path.Combine(env.WebRootPath, "js", "lime", "lime-doc.js"))
        {
        }

        // Для тестов — путь к lime-doc.js напрямую.
        public JsDocumentRenderer(string enginePath)
        {
            _engineSource = File.ReadAllText(enginePath);
        }

        public string RenderSite(string documentJson)
        {
            var engine = CreateEngine(documentJson);
            var result = engine.Evaluate("module.exports.renderSite(JSON.parse(__docJson))");
            return result.AsString();
        }

        public DocumentPage RenderPage(string documentJson, string pageSlug, string baseUrl, string dataJson = null, string recordJson = null)
        {
            var engine = CreateEngine(documentJson);
            engine.SetValue("__slug", pageSlug ?? "");
            engine.SetValue("__base", baseUrl ?? "");
            engine.SetValue("__data", dataJson ?? "null");
            engine.SetValue("__record", recordJson ?? "null");
            var result = engine.Evaluate(
                "module.exports.renderPage(JSON.parse(__docJson), __slug, { baseUrl: __base, data: JSON.parse(__data), record: JSON.parse(__record) })");
            if (result.IsNull() || result.IsUndefined())
            {
                return null;
            }
            var obj = result.AsObject();
            return new DocumentPage(
                obj.Get("title").AsString(),
                obj.Get("body").AsString());
        }

        public string CompileCss(string documentJson)
        {
            var engine = CreateEngine(documentJson);
            var result = engine.Evaluate("module.exports.compileDocCss(JSON.parse(__docJson))");
            return result.AsString();
        }

        private Engine CreateEngine(string documentJson)
        {
            var engine = new Engine(options => options
                .LimitRecursion(256)
                .TimeoutInterval(TimeSpan.FromSeconds(5)));
            // UMD-шим: lime-doc.js при наличии module.exports экспортируется как CommonJS.
            engine.Execute("var module = { exports: {} };");
            engine.Execute(_engineSource);
            engine.SetValue("__docJson", documentJson ?? "null");
            return engine;
        }
    }
}
