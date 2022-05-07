using System;
using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class User
    {

        public int? IdUser { get; set; }
        public string Login { get; set; }
        public string Password { get; set; }
        public string Email { get; set; }
        public string Name { get; set; }

    }
}
