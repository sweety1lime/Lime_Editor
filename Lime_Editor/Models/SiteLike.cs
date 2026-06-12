using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Лайк сайта в галерее сообщества (этап 3). Один пользователь — один лайк на сайт.
    public class SiteLike
    {
        public int Id { get; set; }
        public int SiteId { get; set; }
        public int UserId { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
