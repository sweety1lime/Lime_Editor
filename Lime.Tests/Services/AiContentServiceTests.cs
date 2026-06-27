using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 2: контракт «модель возвращает JSON-блоки, сервер валидирует».
    // TryParseBlocks — единственная точка, через которую вывод модели попадает в документ.
    public class AiContentServiceTests
    {
        [Fact]
        public void ValidJson_ParsesWhitelistedBlocks()
        {
            var raw = @"{""blocks"":[
                {""type"":""cover"",""content"":{""title"":""Кофейня Зерно"",""desc"":""Свежая обжарка"",""cta"":""Заказать""}},
                {""type"":""features"",""content"":{""items"":[{""icon"":""☕"",""title"":""Обжарка"",""desc"":""Своя""}]}},
                {""type"":""cta"",""content"":{""title"":""Попробуй"",""btn"":""Заказать""}}
            ]}";
            var blocks = AiContentService.TryParseBlocks(raw);
            Assert.NotNull(blocks);
            Assert.Equal(3, blocks.Count);
            Assert.Equal("cover", blocks[0]["type"].ToString());
            Assert.Equal("Кофейня Зерно", blocks[0]["content"]["title"].ToString());
        }

        [Fact]
        public void MarkdownFencedJson_IsUnwrapped()
        {
            var raw = "```json\n{\"blocks\":[{\"type\":\"text\",\"content\":{\"text\":\"Привет\"}}]}\n```";
            var blocks = AiContentService.TryParseBlocks(raw);
            Assert.NotNull(blocks);
            Assert.Single(blocks);
        }

        [Fact]
        public void Garbage_ReturnsNull()
        {
            Assert.Null(AiContentService.TryParseBlocks("Вот ваш лендинг! Надеюсь, понравится."));
            Assert.Null(AiContentService.TryParseBlocks(""));
            Assert.Null(AiContentService.TryParseBlocks(null));
            Assert.Null(AiContentService.TryParseBlocks("{\"notblocks\":1}"));
        }

        [Fact]
        public void UnknownTypesAndFields_AreDroppedSilently()
        {
            var raw = @"{""blocks"":[
                {""type"":""script"",""content"":{""src"":""evil.js""}},
                {""type"":""image"",""content"":{""src"":""http://evil/x.png""}},
                {""type"":""text"",""content"":{""text"":""Ок"",""onclick"":""alert(1)"",""html"":""<b>x</b>""}}
            ]}";
            var blocks = AiContentService.TryParseBlocks(raw);
            Assert.Single(blocks); // выжил только text
            var content = blocks[0]["content"];
            Assert.Equal("Ок", content["text"].ToString());
            Assert.Null(content["onclick"]);
            Assert.Null(content["html"]);
        }

        [Fact]
        public void Caps_AreEnforced()
        {
            var manyBlocks = string.Join(",", Enumerable.Repeat(@"{""type"":""text"",""content"":{""text"":""x""}}", 30));
            var blocks = AiContentService.TryParseBlocks($@"{{""blocks"":[{manyBlocks}]}}");
            Assert.Equal(20, blocks.Count); // максимум 20 блоков

            var longText = new string('а', 5000);
            var capped = AiContentService.TryParseBlocks($@"{{""blocks"":[{{""type"":""text"",""content"":{{""text"":""{longText}""}}}}]}}");
            Assert.Equal(600, capped[0]["content"]["text"].ToString().Length); // поле обрезано

            var manyItems = string.Join(",", Enumerable.Repeat(@"{""num"":""1"",""label"":""x""}", 15));
            var stats = AiContentService.TryParseBlocks($@"{{""blocks"":[{{""type"":""stats"",""content"":{{""items"":[{manyItems}]}}}}]}}");
            Assert.Equal(6, ((Newtonsoft.Json.Linq.JArray)stats[0]["content"]["items"]).Count); // items ≤ 6
        }

        [Fact]
        public void EmptyBlocks_AreDropped()
        {
            // text без текста и features без валидных items — бесполезны, выбрасываем.
            var raw = @"{""blocks"":[
                {""type"":""text"",""content"":{}},
                {""type"":""features"",""content"":{""items"":[]}},
                {""type"":""divider"",""content"":{}}
            ]}";
            var blocks = AiContentService.TryParseBlocks(raw);
            Assert.Single(blocks);
            Assert.Equal("divider", blocks[0]["type"].ToString());
        }

        [Fact]
        public void BareArray_AlsoAccepted()
        {
            var blocks = AiContentService.TryParseBlocks(@"[{""type"":""heading"",""content"":{""text"":""Раздел""}}]");
            Assert.Single(blocks);
        }

        [Fact]
        public void UsageCounter_CurrentPeriod_IsFirstOfMonthUtc()
        {
            var p = UsageCounter.CurrentPeriod(new DateTime(2026, 6, 11, 23, 59, 0, DateTimeKind.Utc));
            Assert.Equal(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc), p);
            Assert.Equal(DateTimeKind.Utc, p.Kind);
        }

        // ===== Этап 2.1: AI-правка выделенного блока =====
        // Тот же контракт: модель отдаёт только текст, сервер применяет по известным путям.
        private sealed class StubProvider : IAiProvider
        {
            private readonly string _response;
            public string LastUser;
            public StubProvider(string response) { _response = response; }
            public bool IsConfigured => true;
            public Task<string> CompleteAsync(string system, string user, int maxTokens, CancellationToken ct = default)
            {
                LastUser = user;
                return Task.FromResult(_response);
            }
        }

        [Fact]
        public async Task EditBlock_RewritesText_PreservesStructureAndSkipsLinks()
        {
            var block = @"{
                ""id"":""b1"",""type"":""cover"",
                ""styles"":{""base"":{""color"":""#ffffff""}},
                ""content"":{""title"":""Старый заголовок"",""desc"":""Старое описание"",""cta"":""Жми""},
                ""children"":[{""id"":""b2"",""type"":""buttonGroup"",""content"":{""primary"":""Купить"",""href"":""https://x.test""}}]
            }";
            var patch = @"{""content.title"":""Новый заголовок"",""content.desc"":""Новое описание"",""content.cta"":""Поехали"",""children[0].content.primary"":""Заказать""}";
            var stub = new StubProvider(patch);
            var svc = new AiContentService(stub);

            var edited = await svc.EditBlockAsync(block, "сделай смелее", 4000);
            var o = JObject.Parse(edited);

            Assert.Equal("Новый заголовок", o["content"]["title"].ToString());
            Assert.Equal("Поехали", o["content"]["cta"].ToString());
            Assert.Equal("Заказать", o["children"][0]["content"]["primary"].ToString());
            Assert.Equal("https://x.test", o["children"][0]["content"]["href"].ToString()); // ссылку не трогаем
            Assert.Equal("#ffffff", o["styles"]["base"]["color"].ToString());                // стили сохранены
            Assert.Equal("b2", o["children"][0]["id"].ToString());                            // id сохранён
            Assert.DoesNotContain("https://x.test", stub.LastUser);                           // ссылку модели не показываем
            Assert.Contains("content.title", stub.LastUser);
        }

        [Fact]
        public async Task EditBlock_NoEditableText_ReturnsNull()
        {
            var block = @"{""type"":""image"",""content"":{""src"":""https://x/y.png""}}";
            var svc = new AiContentService(new StubProvider("{}"));
            Assert.Null(await svc.EditBlockAsync(block, "что угодно", 4000));
        }

        [Fact]
        public async Task EditBlock_CapsLongValues()
        {
            var block = @"{""type"":""text"",""content"":{""text"":""коротко""}}";
            var patch = "{\"content.text\":\"" + new string('я', 5000) + "\"}";
            var svc = new AiContentService(new StubProvider(patch));
            var edited = await svc.EditBlockAsync(block, "длиннее", 4000);
            Assert.Equal(600, JObject.Parse(edited)["content"]["text"].ToString().Length);
        }

        [Fact]
        public async Task EditBlock_GarbageResponse_Throws()
        {
            var block = @"{""type"":""text"",""content"":{""text"":""привет""}}";
            var svc = new AiContentService(new StubProvider("это не json"));
            await Assert.ThrowsAsync<FormatException>(() => svc.EditBlockAsync(block, "перепиши", 4000));
        }

        [Fact]
        public void TryParseEditMap_HandlesFenceAndGarbage()
        {
            Assert.NotNull(AiContentService.TryParseEditMap("```json\n{\"a\":\"b\"}\n```"));
            Assert.Null(AiContentService.TryParseEditMap("это не json"));
            Assert.Null(AiContentService.TryParseEditMap("[1,2,3]")); // массив — не объект патча
            Assert.Null(AiContentService.TryParseEditMap(""));
        }

        // ===== Этап 10.2: AI отдаёт список команд =====
        [Fact]
        public void TryParseCommands_KeepsAllowedDropsRest()
        {
            var raw = @"{""commands"":[
                {""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""Привет""}},
                {""type"":""setStyle"",""payload"":{""id"":""b2"",""prop"":""color"",""value"":""#f00""}},
                {""type"":""renameNode"",""payload"":{""id"":""b1"",""name"":""x""}},
                {""type"":""setContent"",""payload"":""нет объекта""},
                {""type"":""evilEval"",""payload"":{}}
            ]}";
            var cmds = AiContentService.TryParseCommands(raw);
            Assert.NotNull(cmds);
            Assert.Equal(2, cmds.Count); // только setContent + setStyle
            Assert.Equal("setContent", cmds[0]["type"].ToString());
            Assert.Equal("b1", cmds[0]["payload"]["id"].ToString());
        }

        [Fact]
        public void TryParseCommands_HandlesFenceBareArrayAndGarbage()
        {
            Assert.NotNull(AiContentService.TryParseCommands("```json\n{\"commands\":[]}\n```")); // пустой — валиден
            Assert.Single(AiContentService.TryParseCommands(@"[{""type"":""removeBlock"",""payload"":{""id"":""b1""}}]"));
            Assert.Null(AiContentService.TryParseCommands("это не json"));
            Assert.Null(AiContentService.TryParseCommands(""));
            Assert.Null(AiContentService.TryParseCommands(@"{""notcommands"":1}"));
        }

        [Fact]
        public void TryParseCommands_EnforcesCountAndLength()
        {
            var many = string.Join(",", Enumerable.Repeat(@"{""type"":""removeBlock"",""payload"":{""id"":""b""}}", 60));
            Assert.Equal(40, AiContentService.TryParseCommands($@"{{""commands"":[{many}]}}").Count);

            var longVal = new string('я', 5000);
            var capped = AiContentService.TryParseCommands(
                $@"{{""commands"":[{{""type"":""setContent"",""payload"":{{""id"":""b1"",""field"":""text"",""value"":""{longVal}""}}}}]}}");
            Assert.Equal(600, capped[0]["payload"]["value"].ToString().Length); // строка payload урезана
        }

        [Fact]
        public async Task SuggestCommands_ParsesModelOutput()
        {
            var stub = new StubProvider(@"{""commands"":[{""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""color"",""value"":""#0f0""}}]}");
            var svc = new AiContentService(stub);
            var json = await svc.SuggestCommandsAsync(@"{""blocks"":[{""id"":""b1""}]}", "сделай зелёным", 4000);
            var arr = JArray.Parse(json);
            Assert.Single(arr);
            Assert.Equal("setStyle", arr[0]["type"].ToString());
            Assert.Contains("сделай зелёным", stub.LastUser);
        }

        [Fact]
        public async Task SuggestCommands_EmptyListIsValid()
        {
            var svc = new AiContentService(new StubProvider(@"{""commands"":[]}"));
            var json = await svc.SuggestCommandsAsync("{}", "ничего", 4000);
            Assert.Equal("[]", json.Replace(" ", ""));
        }

        [Fact]
        public async Task SuggestCommands_GarbageThrows()
        {
            var svc = new AiContentService(new StubProvider("совсем не json"));
            await Assert.ThrowsAsync<FormatException>(() => svc.SuggestCommandsAsync("{}", "правка", 4000));
        }

        // ===== Этап 10.4: insertBlock несёт целую секцию — структура валидируется whitelist'ом =====
        [Fact]
        public void TryParseCommands_InsertBlock_KeepsCleanSectionDropsEvil()
        {
            var raw = @"{""commands"":[
                {""type"":""insertBlock"",""payload"":{""block"":{""type"":""cta"",""content"":{""title"":""Готовы?"",""btn"":""Начать"",""onclick"":""alert(1)""}}}},
                {""type"":""insertBlock"",""payload"":{""block"":{""type"":""script"",""content"":{""src"":""evil.js""}}}},
                {""type"":""insertBlock"",""payload"":{""nothing"":1}}
            ]}";
            var cmds = AiContentService.TryParseCommands(raw);
            Assert.Single(cmds); // только валидная cta-секция
            var block = (JObject)cmds[0]["payload"]["block"];
            Assert.Equal("cta", block["type"].ToString());
            Assert.Equal("Готовы?", block["content"]["title"].ToString());
            Assert.Null(block["content"]["onclick"]); // чужое поле вырезано
        }

        [Fact]
        public void CleanBlock_WhitelistsTypeAndFields()
        {
            Assert.Null(AiContentService.CleanBlock(JObject.Parse(@"{""type"":""iframe"",""content"":{""src"":""x""}}")));
            Assert.Null(AiContentService.CleanBlock(JObject.Parse(@"{""type"":""text"",""content"":{}}"))); // пустой текст
            var feat = AiContentService.CleanBlock(JObject.Parse(@"{""type"":""features"",""content"":{""items"":[{""title"":""A"",""desc"":""B""}]}}"));
            Assert.NotNull(feat);
            Assert.Single((JArray)feat["content"]["items"]);
        }

        // ===== Этап 10.5: Responsive-AI «адаптировать мобилку» — фильтр защищает десктоп =====
        [Fact]
        public void FilterResponsiveCommands_KeepsOnlyTargetBreakpointStyleAndDesign()
        {
            var cmds = AiContentService.TryParseCommands(@"{""commands"":[
                {""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""font-size"",""value"":""20px"",""breakpoint"":""mobile""}},
                {""type"":""setDesign"",""payload"":{""id"":""b1"",""breakpoint"":""mobile"",""field"":""layout"",""value"":{}}},
                {""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""color"",""value"":""#f00"",""breakpoint"":""base""}},
                {""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""color"",""value"":""#0f0""}},
                {""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""нет""}},
                {""type"":""removeBlock"",""payload"":{""id"":""b1""}}
            ]}");
            var mobile = AiContentService.FilterResponsiveCommands(cmds, "mobile");
            Assert.Equal(2, mobile.Count); // только mobile setStyle + setDesign; base/без-bp/content/remove отброшены
            Assert.All(mobile, c => Assert.Equal("mobile", c["payload"]["breakpoint"].ToString()));
        }

        [Fact]
        public void FilterResponsiveCommands_RejectsBaseAndUnknownBreakpoint()
        {
            var cmds = AiContentService.TryParseCommands(@"{""commands"":[{""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""color"",""value"":""#f00"",""breakpoint"":""mobile""}}]}");
            Assert.Empty(AiContentService.FilterResponsiveCommands(cmds, "base"));
            Assert.Empty(AiContentService.FilterResponsiveCommands(cmds, "desktop"));
            Assert.Empty(AiContentService.FilterResponsiveCommands(null, "mobile"));
        }

        [Fact]
        public async Task SuggestResponsive_FiltersModelOutputToBreakpoint()
        {
            // Модель «промахнулась» и вернула в т.ч. правку десктопа и контента — должны выжить только mobile-стили.
            var stub = new StubProvider(@"{""commands"":[
                {""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""font-size"",""value"":""18px"",""breakpoint"":""mobile""}},
                {""type"":""setStyle"",""payload"":{""id"":""b1"",""prop"":""font-size"",""value"":""40px"",""breakpoint"":""base""}},
                {""type"":""setContent"",""payload"":{""id"":""b1"",""field"":""text"",""value"":""смена текста""}}
            ]}");
            var svc = new AiContentService(stub);
            var json = await svc.SuggestResponsiveAsync(@"{""block"":{""id"":""b1""}}", "адаптируй", "mobile", 4000);
            var arr = JArray.Parse(json);
            Assert.Single(arr);
            Assert.Equal("mobile", arr[0]["payload"]["breakpoint"].ToString());
            Assert.Equal("18px", arr[0]["payload"]["value"].ToString());
        }

        // ===== Этап 2.4: AI CMS-ассистент — схема коллекции + примеры записей =====
        [Fact]
        public void TryParseCollection_ValidSchemaAndRecords()
        {
            var raw = @"{""name"":""Посты"",""fields"":[
                {""name"":""title"",""type"":""text"",""label"":""Заголовок""},
                {""name"":""cover"",""type"":""image"",""label"":""Обложка""},
                {""name"":""body"",""type"":""longtext"",""label"":""Текст""}
            ],""records"":[{""title"":""Первый"",""body"":""Тело"",""cover"":""""}]}";
            var col = AiContentService.TryParseCollection(raw);
            Assert.NotNull(col);
            Assert.Equal("Посты", col["name"].ToString());
            var fields = (JArray)col["fields"];
            Assert.Equal(3, fields.Count);
            Assert.Equal("title", fields[0]["name"].ToString());
            Assert.Equal("image", fields[1]["type"].ToString());
            var recs = (JArray)col["records"];
            Assert.Single(recs);
            Assert.Equal("Первый", recs[0]["title"].ToString());
        }

        [Fact]
        public void TryParseCollection_CoercesUnknownTypeSlugifiesAndDedupesFields()
        {
            var raw = @"{""name"":""X"",""fields"":[
                {""name"":""Big Title!"",""type"":""richtext"",""label"":""T""},
                {""name"":""Big Title!"",""type"":""text"",""label"":""dup""},
                {""name"":""price"",""type"":""number"",""label"":""Цена""}
            ]}";
            var col = AiContentService.TryParseCollection(raw);
            var fields = (JArray)col["fields"];
            Assert.Equal(2, fields.Count);                       // дубль по slug отброшен
            Assert.Equal("text", fields[0]["type"].ToString()); // неизвестный richtext → text
            var n0 = fields[0]["name"].ToString();
            Assert.DoesNotContain(" ", n0);                      // slugified
            Assert.DoesNotContain("!", n0);
            Assert.Equal("number", fields[1]["type"].ToString());
        }

        [Fact]
        public void TryParseCollection_RecordsKeepOnlyKnownFields()
        {
            var raw = @"{""name"":""X"",""fields"":[{""name"":""title"",""type"":""text"",""label"":""T""}],
                ""records"":[{""title"":""Ок"",""evil"":""<script>"",""extra"":123}]}";
            var col = AiContentService.TryParseCollection(raw);
            var rec = (JObject)((JArray)col["records"])[0];
            Assert.Equal("Ок", rec["title"].ToString());
            Assert.Null(rec["evil"]);  // чужое поле отброшено
            Assert.Null(rec["extra"]);
        }

        [Fact]
        public void TryParseCollection_Garbage_ReturnsNull()
        {
            Assert.Null(AiContentService.TryParseCollection("не json"));
            Assert.Null(AiContentService.TryParseCollection(""));
            Assert.Null(AiContentService.TryParseCollection(null));
            Assert.Null(AiContentService.TryParseCollection(@"{""name"":""X""}"));               // нет fields
            Assert.Null(AiContentService.TryParseCollection(@"{""fields"":[{""type"":""text""}]}")); // поле без имени → 0 валидных
        }

        [Fact]
        public void TryParseCollection_UnwrapsFence()
        {
            var col = AiContentService.TryParseCollection("```json\n{\"name\":\"Y\",\"fields\":[{\"name\":\"title\",\"type\":\"text\",\"label\":\"T\"}]}\n```");
            Assert.NotNull(col);
            Assert.Equal("Y", col["name"].ToString());
        }

        [Fact]
        public async Task SuggestCollection_GarbageThrows()
        {
            var svc = new AiContentService(new StubProvider("совсем не json"));
            await Assert.ThrowsAsync<FormatException>(() => svc.SuggestCollectionAsync("блог о кофе", 4000));
        }

        [Fact]
        public async Task SuggestCollection_ValidStubReturnsJson()
        {
            var svc = new AiContentService(new StubProvider(@"{""name"":""Меню"",""fields"":[{""name"":""dish"",""type"":""text"",""label"":""Блюдо""}],""records"":[{""dish"":""Латте""}]}"));
            var json = await svc.SuggestCollectionAsync("кофейня", 4000);
            var col = JObject.Parse(json);
            Assert.Equal("Меню", col["name"].ToString());
            Assert.Single((JArray)col["fields"]);
            Assert.Equal("Латте", ((JArray)col["records"])[0]["dish"].ToString());
        }
    }
}
