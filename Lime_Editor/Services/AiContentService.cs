using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
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

        // ===== Правка выделенного блока по промпту (этап 2.1) =====
        // Безопасность та же, что у генерации: модель меняет ТОЛЬКО текстовые значения
        // существующих полей (структуру/стили/ссылки/id не трогает). Сервер отдаёт модели
        // лишь текст, применяет правки по известным путям и режет длину. URL/цвета/иконки/
        // enum/id модели не показываются вовсе — нечего ломать.
        private const int MaxEditFields = 80;
        private static readonly HashSet<string> NonTextKeys = new(StringComparer.OrdinalIgnoreCase)
        {
            "href", "url", "link", "src", "videoSrc", "poster", "youtubeId", "embed", "code",
            "platform", "slug", "id", "cid", "ref", "anchor", "action", "target", "type",
            "image", "img", "media", "icon", "bg", "color",
        };

        private const string EditSystemPrompt =
@"Ты — редактор контента лендингов Lime. Тебе дан JSON-объект: ключ — путь к текстовому полю блока, значение — текущий текст.
Перепиши КАЖДОЕ значение по инструкции пользователя.
Верни СТРОГО JSON-объект с ТЕМИ ЖЕ ключами и переписанными значениями — без markdown и без пояснений.
Правила: сохраняй язык оригинала, если инструкция не требует перевода; не добавляй и не удаляй ключи;
значения — только строки; не вставляй HTML и ссылки; держи длину близко к оригиналу.";

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

        // «✨ AI: переписать» для выделенного блока/секции (вместе с детьми).
        // Возвращает тот же блок c переписанными текстами; null — если переписывать нечего
        // (контроллер ответит no_text). FormatException — если модель не дала валидный патч.
        public async Task<string> EditBlockAsync(string blockJson, string instruction, int maxTokens, CancellationToken ct = default)
        {
            JObject block;
            try { block = JObject.Parse(blockJson); }
            catch (JsonReaderException) { throw new FormatException("Некорректный блок."); }

            var fields = new Dictionary<string, JValue>();
            CollectEditable(block, "", fields);
            if (fields.Count == 0) return null;

            var map = new JObject();
            foreach (var kv in fields) map[kv.Key] = kv.Value.Value<string>();
            var user = $"Инструкция: {instruction}\n\nПоля:\n{map.ToString(Formatting.None)}";

            var patch = TryParseEditMap(await _provider.CompleteAsync(EditSystemPrompt, user, maxTokens, ct));
            if (patch == null)
            {
                patch = TryParseEditMap(await _provider.CompleteAsync(
                    EditSystemPrompt,
                    user + "\n\nВАЖНО: верни ТОЛЬКО валидный JSON-объект с теми же ключами, без markdown.",
                    maxTokens, ct));
            }
            if (patch == null) throw new FormatException("Модель вернула невалидный ответ.");

            var applied = 0;
            foreach (var prop in patch.Properties())
            {
                if (prop.Value.Type != JTokenType.String) continue;
                if (!fields.TryGetValue(prop.Name, out var node)) continue; // чужие ключи игнорим
                var nv = Cap(prop.Value.ToString());
                if (!string.IsNullOrEmpty(nv)) { node.Value = nv; applied++; }
            }
            if (applied == 0) throw new FormatException("Модель не переписала ни одного поля.");
            return block.ToString(Formatting.None);
        }

        // Рекурсивно собирает редактируемые текстовые поля из content блока и из content
        // его детей. Путь (content.title, children[0].content.items[1].desc) — стабильный
        // ключ для сопоставления ответа модели с узлом дерева.
        private static void CollectEditable(JObject block, string prefix, Dictionary<string, JValue> fields)
        {
            if (fields.Count >= MaxEditFields) return;
            if (block["content"] is JObject content) CollectNode(content, prefix + "content", fields);
            if (block["children"] is JArray children)
            {
                for (var i = 0; i < children.Count && fields.Count < MaxEditFields; i++)
                    if (children[i] is JObject child) CollectEditable(child, prefix + "children[" + i + "].", fields);
            }
        }

        private static void CollectNode(JToken node, string path, Dictionary<string, JValue> fields)
        {
            if (fields.Count >= MaxEditFields) return;
            if (node is JObject o)
            {
                foreach (var p in o.Properties())
                {
                    if (NonTextKeys.Contains(p.Name)) continue; // ссылки/цвета/иконки/enum — не текст
                    CollectNode(p.Value, path + "." + p.Name, fields);
                    if (fields.Count >= MaxEditFields) return;
                }
            }
            else if (node is JArray a)
            {
                for (var i = 0; i < a.Count && fields.Count < MaxEditFields; i++)
                    CollectNode(a[i], path + "[" + i + "]", fields);
            }
            else if (node is JValue v && v.Type == JTokenType.String)
            {
                if (IsEditableValue(v.Value<string>())) fields[path] = v;
            }
        }

        // Текст «достоин переписывания»: не URL/якорь/цвет/почта и содержит хоть одну букву
        // (отсекает голые числа, hex-цвета, ссылки, протокол-строки).
        private static bool IsEditableValue(string v)
        {
            if (string.IsNullOrWhiteSpace(v)) return false;
            var t = v.Trim();
            if (t.StartsWith("http://") || t.StartsWith("https://") || t.StartsWith("//") ||
                t.StartsWith("/") || t.StartsWith("#") || t.StartsWith("data:") ||
                t.StartsWith("mailto:") || t.StartsWith("tel:") || t.StartsWith("www.")) return false;
            if (Regex.IsMatch(t, "^#?[0-9a-fA-F]{3,8}$")) return false; // hex-цвет без #
            if (t.IndexOf('@') >= 0 && t.IndexOf('.') >= 0 && t.IndexOf(' ') < 0) return false; // почта
            foreach (var c in t) if (char.IsLetter(c)) return true;
            return false;
        }

        // Парсинг + валидация ответа модели. public static — покрыто юнит-тестами.
        // Возвращает null, если JSON не разобрался; иначе список очищенных блоков
        // (мусорные типы/поля молча отброшены).
        public static List<JObject> TryParseBlocks(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            // Модели любят оборачивать в ```json ... ``` — срезаем.
            var s = StripFence(raw);

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

        // Срезает markdown-ограждение ```...``` вокруг JSON (модели любят его добавлять).
        private static string StripFence(string raw)
        {
            var s = raw.Trim();
            if (s.StartsWith("```"))
            {
                var firstNl = s.IndexOf('\n');
                if (firstNl >= 0) s = s.Substring(firstNl + 1);
                var fence = s.LastIndexOf("```", StringComparison.Ordinal);
                if (fence >= 0) s = s.Substring(0, fence);
                s = s.Trim();
            }
            return s;
        }

        // Ответ модели на правку: JSON-объект путь→новый текст. null, если не разобрался
        // или это не объект. public static — покрыто юнит-тестами.
        public static JObject TryParseEditMap(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            try { return JToken.Parse(StripFence(raw)) as JObject; }
            catch (JsonReaderException) { return null; }
        }

        private static string Cap(string v)
        {
            if (v == null) return null;
            v = v.Trim();
            return v.Length > MaxFieldLength ? v.Substring(0, MaxFieldLength) : v;
        }
    }
}
