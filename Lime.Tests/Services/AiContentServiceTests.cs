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
    }
}
