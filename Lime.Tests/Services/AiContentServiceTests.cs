using System;
using System.Linq;
using Lime_Editor.Models;
using Lime_Editor.Services;
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
        public void AiUsage_CurrentPeriod_IsFirstOfMonthUtc()
        {
            var p = AiUsage.CurrentPeriod(new DateTime(2026, 6, 11, 23, 59, 0, DateTimeKind.Utc));
            Assert.Equal(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc), p);
            Assert.Equal(DateTimeKind.Utc, p.Kind);
        }
    }
}
