#nullable enable
namespace Lime_Editor.Models
{
    public static class UserNamePolicy
    {
        public const string AllowedCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
        public const string HtmlPattern = "[A-Za-z0-9._\\-]{2,50}";
        public const string RegexPattern = "^" + HtmlPattern + "$";
        public const string ErrorMessage = "Логин должен быть от 2 до 50 символов: латиница, цифры, точка, дефис или подчёркивание";
    }
}
