using System;
using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class Site
    {
        public int IdSite { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
        public int UserId { get; set; }
        public int TypeId { get; set; }

        public virtual Template Type { get; set; }
        public virtual User User { get; set; }
    }
}
