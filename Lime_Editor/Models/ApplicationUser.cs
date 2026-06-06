using Microsoft.AspNetCore.Identity;

namespace Lime_Editor.Models
{
    // Пользователь приложения на базе ASP.NET Core Identity.
    // Логин хранится в UserName, пароль — в PasswordHash (хешируется Identity).
    public class ApplicationUser : IdentityUser<int>
    {
        public string Name { get; set; }
        public string LastName { get; set; }
    }
}
