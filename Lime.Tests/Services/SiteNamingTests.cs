using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    // Автонейминг сайта из AI-промпта (doc.meta.aiPrompt) — вместо стены «Новый сайт».
    public class SiteNamingTests
    {
        [Fact]
        public void FromPrompt_CutsAtDashAndCapitalizes()
        {
            Assert.Equal("Кофейня «Зерно» в Казани",
                SiteNaming.FromPrompt("кофейня «Зерно» в Казани — обжариваем сами, доставка по городу"));
        }

        [Fact]
        public void FromPrompt_CutsAtSentenceEnd()
        {
            Assert.Equal("Студия дизайна интерьеров",
                SiteNaming.FromPrompt("студия дизайна интерьеров. Работаем по всей России, портфолио из 50 проектов"));
        }

        [Fact]
        public void FromPrompt_CollapsesWhitespaceAndCapsLength()
        {
            var name = SiteNaming.FromPrompt("личный   бренд\nкоуча по публичным выступлениям для руководителей и предпринимателей среднего бизнеса");
            Assert.NotNull(name);
            Assert.True(name.Length <= 60);
            Assert.StartsWith("Личный бренд коуча", name);
            Assert.DoesNotContain("\n", name);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("х")] // слишком коротко для имени
        public void FromPrompt_EmptyOrTiny_ReturnsNull(string prompt)
        {
            Assert.Null(SiteNaming.FromPrompt(prompt));
        }

        [Fact]
        public void FromDocument_ReadsMetaAiPrompt()
        {
            var doc = "{\"version\":1,\"meta\":{\"aiPrompt\":\"SaaS для команд — таск-трекер\"},\"pages\":[]}";
            Assert.Equal("SaaS для команд", SiteNaming.FromDocument(doc));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("{\"version\":1}")] // без meta
        [InlineData("не json")]
        public void FromDocument_MissingOrBroken_ReturnsNull(string doc)
        {
            Assert.Null(SiteNaming.FromDocument(doc));
        }
    }
}
