using System.ComponentModel.DataAnnotations;

namespace Lime_Editor.Models
{
    public class ProfileViewModel
    {
        // Хранится только для отображения; на сервере текущий пользователь определяется по cookie,
        // а не по этому полю, чтобы исключить подмену чужого профиля.
        public int Id { get; set; }

        public string Name { get; set; }

        public string LastName { get; set; }

        [Required(ErrorMessage = "Не указан логин")]
        [StringLength(50, MinimumLength = 2, ErrorMessage = "Логин должен быть от 2 до 50 символов")]
        [RegularExpression(UserNamePolicy.RegexPattern, ErrorMessage = UserNamePolicy.ErrorMessage)]
        public string Login { get; set; }

        [Required(ErrorMessage = "Не указана почта")]
        [EmailAddress(ErrorMessage = "Некорректный формат почты")]
        public string Email { get; set; }

        // Необязательное: если заполнено — пароль будет изменён.
        [DataType(DataType.Password)]
        public string Password { get; set; }

        [DataType(DataType.Password)]
        public string CurrentPassword { get; set; }
    }
}
