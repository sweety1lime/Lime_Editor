using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // AI-генерация контента для движка B (этап 2).
    // Принцип безопасности из роадмапа: модель возвращает НЕ HTML, а JSON-блоки по
    // жёсткому контракту (типы = enum существующих блоков движка). Сервер валидирует
    // и отбрасывает всё лишнее; рендерер движка экранирует тексты — санитайз не нужен.
    public class AiContentService
    {
        private readonly IAiProvider _provider;

        public AiContentService(IAiProvider provider)
        {
            _provider = provider;
        }

        public bool IsConfigured => _provider.IsConfigured;

        // Типы блоков, которые разрешено генерировать (только текстовые — модель не
        // должна выдумывать URL картинок/видео).
        private static readonly Dictionary<string, string[]> BlockFields = new()
        {
            ["cover"] = new[] { "uptitle", "title", "desc", "cta" },
            ["heading"] = new[] { "text" },
            ["text"] = new[] { "text" },
            ["cta"] = new[] { "title", "desc", "btn" },
            ["buttonGroup"] = new[] { "primary", "secondary" },
            ["divider"] = Array.Empty<string>(),
            ["spacer"] = Array.Empty<string>(),
        };
        // Блоки со списками: имя поля-списка и поля элемента.
        private static readonly Dictionary<string, (string list, string[] fields)> ListBlocks = new()
        {
            ["features"] = ("items", new[] { "icon", "title", "desc" }),
            ["stats"] = ("items", new[] { "num", "label" }),
        };

        private const int MaxBlocks = 20;
        private const int MaxItems = 6;
        private const int MaxFieldLength = 600;

        private const string SystemPrompt =
@"Ты — генератор лендингов конструктора Lime. По описанию бизнеса собери страницу из готовых блоков.

Верни СТРОГО JSON без пояснений и без markdown-ограждений, по схеме:
{""blocks"":[{""type"":""<тип>"",""content"":{...}}]}

Доступные типы и поля content (все поля — строки):
- cover: uptitle, title, desc, cta — обложка, всегда первая
- heading: text — заголовок секции
- text: text — абзац
- features: items — массив из 3-6 объектов {icon (один эмодзи), title, desc}
- stats: items — массив из 3-4 объектов {num (короткое число вида ""10K+""), label}
- cta: title, desc, btn — призыв к действию, обычно последний
- buttonGroup: primary, secondary — пара кнопок
- divider: без полей
- spacer: без полей

Правила: 5-9 блоков; язык — язык описания пользователя; тексты конкретные и продающие,
без плейсхолдеров вида [название]; никаких других типов и полей.";

        // Описание бизнеса → провалидированный JSON-массив блоков (строка для клиента).
        // Невалидный ответ → один ретрай с требованием чистого JSON.
        public async Task<string> GenerateLandingAsync(string prompt, int maxTokens, CancellationToken ct = default)
        {
            var raw = await _provider.CompleteAsync(SystemPrompt, prompt, maxTokens, ct);
            var blocks = TryParseBlocks(raw);
            if (blocks == null)
            {
                raw = await _provider.CompleteAsync(
                    SystemPrompt,
                    prompt + "\n\nВАЖНО: предыдущий ответ не распарсился. Верни ТОЛЬКО валидный JSON по схеме, ничего больше.",
                    maxTokens, ct);
                blocks = TryParseBlocks(raw);
            }
            if (blocks == null || blocks.Count == 0)
            {
                throw new FormatException("Модель не вернула валидные блоки.");
            }
            return JsonConvert.SerializeObject(blocks);
        }

        // «✨ Переписать»: короткий вызов без контракта блоков.
        public async Task<string> RewriteTextAsync(string text, string instruction, CancellationToken ct = default)
        {
            var system = "Ты — редактор текстов лендингов. Перепиши текст по инструкции. " +
                         "Сохрани язык оригинала. Верни ТОЛЬКО переписанный текст без кавычек и пояснений.";
            var user = $"Инструкция: {instruction}\n\nТекст:\n{text}";
            var result = await _provider.CompleteAsync(system, user, 1000, ct);
            result = result.Trim().Trim('"');
            return result.Length > 2000 ? result.Substring(0, 2000) : result;
        }

        // Парсинг + валидация ответа модели. public static — покрыто юнит-тестами.
        // Возвращает null, если JSON не разобрался; иначе список очищенных блоков
        // (мусорные типы/поля молча отброшены).
        public static List<JObject> TryParseBlocks(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var s = raw.Trim();
            // Модели любят оборачивать в ```json ... ``` — срезаем.
            if (s.StartsWith("```"))
            {
                var firstNl = s.IndexOf('\n');
                if (firstNl >= 0) s = s.Substring(firstNl + 1);
                var fence = s.LastIndexOf("```", StringComparison.Ordinal);
                if (fence >= 0) s = s.Substring(0, fence);
                s = s.Trim();
            }

            JToken root;
            try { root = JToken.Parse(s); }
            catch (JsonReaderException) { return null; }

            var arr = root is JObject o ? o["blocks"] as JArray : root as JArray;
            if (arr == null) return null;

            var result = new List<JObject>();
            foreach (var item in arr)
            {
                if (result.Count >= MaxBlocks) break;
                if (item is not JObject b) continue;
                var type = b["type"]?.ToString();
                if (string.IsNullOrEmpty(type)) continue;
                var content = b["content"] as JObject ?? new JObject();

                if (BlockFields.TryGetValue(type, out var fields))
                {
                    var clean = new JObject();
                    foreach (var f in fields)
                    {
                        var v = Cap(content[f]?.ToString());
                        if (!string.IsNullOrEmpty(v)) clean[f] = v;
                    }
                    // Текстовый блок без единого поля бесполезен (кроме divider/spacer).
                    if (fields.Length > 0 && clean.Count == 0) continue;
                    result.Add(new JObject { ["type"] = type, ["content"] = clean });
                }
                else if (ListBlocks.TryGetValue(type, out var spec))
                {
                    var items = new JArray();
                    if (content[spec.list] is JArray srcItems)
                    {
                        foreach (var si in srcItems)
                        {
                            if (items.Count >= MaxItems) break;
                            if (si is not JObject so) continue;
                            var cleanItem = new JObject();
                            foreach (var f in spec.fields)
                            {
                                var v = Cap(so[f]?.ToString());
                                if (!string.IsNullOrEmpty(v)) cleanItem[f] = v;
                            }
                            if (cleanItem.Count > 0) items.Add(cleanItem);
                        }
                    }
                    if (items.Count == 0) continue;
                    result.Add(new JObject
                    {
                        ["type"] = type,
                        ["content"] = new JObject { [spec.list] = items },
                    });
                }
                // Неизвестный тип — отбрасываем молча.
            }
            return result;
        }

        private static string Cap(string v)
        {
            if (v == null) return null;
            v = v.Trim();
            return v.Length > MaxFieldLength ? v.Substring(0, MaxFieldLength) : v;
        }
    }
}
