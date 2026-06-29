using System.ComponentModel.DataAnnotations;

namespace Lime_Editor.Models
{
    public class RegisterViewModel
    {
        [Required(ErrorMessage = "Не указана почта")]
        [EmailAddress(ErrorMessage = "Некорректный формат почты")]
        public string Email { get; set; }

        [Required(ErrorMessage = "Не указан логин")]
        [StringLength(50, MinimumLength = 2, ErrorMessage = "Логин должен быть от 2 до 50 символов")]
        public string Login { get; set; }

        [Required(ErrorMessage = "Не указан пароль")]
        [MinLength(8, ErrorMessage = "Пароль должен быть не короче 8 символов")]
        [DataType(DataType.Password)]
        public string Password { get; set; }
    }
}
