using System;
using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class Template
    {
        public int? IdTemplate { get; set; }
        public string Name { get; set; }
        public string FolderPreview { get; set; }
        public int TypeId { get; set; }
    }
}
