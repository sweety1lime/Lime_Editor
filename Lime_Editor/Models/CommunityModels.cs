using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Models
{
    // Карточка сайта в галерее сообщества (этап 3).
    public class CommunityCard
    {
        public int SiteId { get; set; }
        public string Name { get; set; }
        public string Author { get; set; }
        public string Slug { get; set; }
        public string OgImage { get; set; }
        public int Likes { get; set; }
        public int ViewsCount { get; set; }
        public bool LikedByMe { get; set; }
        public bool IsDocEngine { get; set; }

        // Палитра опубликованного документа для превью-заглушки (когда нет OgImage).
        // Заполняются ТОЛЬКО валидированными hex-цветами (см. CommunityController) —
        // значения уходят в style-атрибут, произвольная строка была бы style-инъекцией.
        public string ThemeAccent { get; set; }
        public string ThemeAccent2 { get; set; }

        public string PublicUrl => $"/u/{Author}/{Slug}";
    }

    public class CommunityViewModel
    {
        public List<CommunityCard> Cards { get; set; } = new();
        public string Sort { get; set; } = "new";
    }
}
