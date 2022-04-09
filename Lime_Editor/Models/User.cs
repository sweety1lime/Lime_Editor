using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class User
    {
        public User()
        {
            Sites = new HashSet<Site>();
        }

        public int IdUser { get; set; }
        [Required(ErrorMessage = "Введите логин")]
        [StringLength(50, MinimumLength = 3, ErrorMessage = "Длина строки должна быть от 3 до 50 символов")]
        public string Login { get; set; }
        [Required(ErrorMessage = "Введите пароль")]
        public string Password { get; set; }
        [Required(ErrorMessage = "Введите почту")]
        [StringLength(50, MinimumLength = 3, ErrorMessage = "Длина строки должна быть от 3 до 50 символов")]
        public string Email { get; set; }
        public string Name { get; set; }

        public virtual ICollection<Site> Sites { get; set; }
    }
}
