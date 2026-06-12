using System.Text;

namespace Lime_Editor.Services
{
    public static class SlugGenerator
    {
        // Безопасный для URL slug: оставляем буквы/цифры (включая кириллицу), пробелы/подчёркивания → "-",
        // схлопываем повторные дефисы, ASCII -> lowercase. Кириллица сохраняется как есть (URL-кодирование
        // браузер сделает сам), но без знаков пунктуации.
        public static string Generate(string source)
        {
            if (string.IsNullOrWhiteSpace(source))
            {
                return "site";
            }

            var sb = new StringBuilder(source.Length);
            foreach (var ch in source.Trim().ToLowerInvariant())
            {
                if (char.IsLetterOrDigit(ch))
                {
                    sb.Append(ch);
                }
                else if (ch == ' ' || ch == '-' || ch == '_')
                {
                    sb.Append('-');
                }
            }

            var slug = sb.ToString();
            while (slug.Contains("--"))
            {
                slug = slug.Replace("--", "-");
            }
            slug = slug.Trim('-');
            return string.IsNullOrEmpty(slug) ? "site" : slug;
        }
    }
}
