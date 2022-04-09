using System;
using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class TypeTemplate
    {
        public TypeTemplate()
        {
            Templates = new HashSet<Template>();
        }

        public int IdType { get; set; }
        public string Name { get; set; }

        public virtual ICollection<Template> Templates { get; set; }
    }
}
