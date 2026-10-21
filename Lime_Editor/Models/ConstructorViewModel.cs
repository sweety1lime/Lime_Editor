namespace Lime_Editor.Models
{
    public class ConstructorViewModel
    {
        public int? SiteId { get; set; }
        public string SiteName { get; set; }

        // SEO-мета (правится в редакторе, прокидывается в head опубликованной страницы).
        public string MetaTitle { get; set; }
        public string MetaDescription { get; set; }
        public string OgImage { get; set; }

        // JSON-документ — источник правды страницы.
        public string DocumentJson { get; set; }

        // Версия документа (Site.UpdatedAt.Ticks) для optimistic concurrency:
        // сохранение со старой версией → 409, второй таб не затрёт правки молча. 0 — новый сайт.
        public long DocVersion { get; set; }

        // Есть резервная копия исходного документа (раскатка Editor V2) → показываем «Восстановить оригинал».
        public bool HasOriginalBackup { get; set; }
    }
}
