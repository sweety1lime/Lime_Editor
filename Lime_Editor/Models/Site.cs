using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class Site
    {
        public int? IdSite { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
        public int UserId { get; set; }
        public int TemplateId { get; set; }

        [NotMapped]
        public Template TemplateInfo { get; set; }
    }
}
