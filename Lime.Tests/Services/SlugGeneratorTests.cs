using Lime_Editor.Services;
using Xunit;

namespace Lime.Tests.Services
{
    public class SlugGeneratorTests
    {
        [Theory]
        [InlineData("Hello World", "hello-world")]
        [InlineData("  Hello   World  ", "hello-world")]
        [InlineData("My_Awesome_Site", "my-awesome-site")]
        [InlineData("Hello---World", "hello-world")]
        [InlineData("Punctuation, here! it is.", "punctuation-here-it-is")]
        [InlineData("Foo123", "foo123")]
        public void Generate_BasicCases(string input, string expected)
        {
            Assert.Equal(expected, SlugGenerator.Generate(input));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("!!!")]
        [InlineData("---")]
        public void Generate_FallsBackToSite_ForEmptyOrPunctuationOnly(string input)
        {
            Assert.Equal("site", SlugGenerator.Generate(input));
        }

        [Fact]
        public void Generate_PreservesCyrillicLetters()
        {
            // Кириллица допустима, ToLowerInvariant её приводит к нижнему регистру.
            Assert.Equal("мой-сайт", SlugGenerator.Generate("Мой Сайт"));
        }

        [Theory]
        [InlineData("../evil", "evil")]
        [InlineData("..\\evil", "evil")]
        [InlineData("safe/name", "safename")]
        public void Generate_RemovesPathSeparators(string input, string expected)
        {
            Assert.Equal(expected, SlugGenerator.Generate(input));
        }
    }
}
