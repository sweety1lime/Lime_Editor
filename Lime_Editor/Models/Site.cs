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
        // Folder — опубликованный снапшот (его отдаёт PublishedSiteController).
        public string Folder { get; set; }
        // DraftFolder — рабочая версия из конструктора. Публикация копирует Draft → Folder.
        public string DraftFolder { get; set; }
        // DocumentJson — JSON-документ нового движка (Трек B). null у legacy блоб-сайтов.
        // Это ЧЕРНОВИК: автосейв конструктора перезаписывает его.
        public string DocumentJson { get; set; }
        // Снапшот JSON на момент публикации (этап 0.2). Folder опубликованного сайта
        // компилируется сервером именно из него — republish не утащит черновик в прод.
        public string PublishedDocumentJson { get; set; }
        public int UserId { get; set; }
        public int TemplateId { get; set; }

        // Публикация (Фаза 3): сайт доступен по /u/{username}/{slug}, когда IsPublished = true.
        public string Slug { get; set; }
        public bool IsPublished { get; set; }
        public DateTime? PublishedAt { get; set; }

        // Момент последнего сохранения из конструктора (этап 0.4). Используется как
        // версия для optimistic concurrency: клиент шлёт Ticks, расхождение → 409.
        public DateTime? UpdatedAt { get; set; }

        // Правило конфликта версий: baseVersion < 0 — клиент без поддержки версий
        // (legacy), проверка пропускается; иначе любая разница с текущей версией = конфликт.
        public static bool IsVersionConflict(long baseVersion, DateTime? updatedAt)
            => baseVersion >= 0 && baseVersion != (updatedAt?.Ticks ?? 0);

        // SEO-мета для опубликованной страницы.
        public string MetaTitle { get; set; }
        public string MetaDescription { get; set; }
        public string OgImage { get; set; }

        // Сообщество (этап 3): показывать в публичной галерее /Community.
        // Publish ставит true (сайт и так публичен по ссылке), владелец может скрыть.
        public bool ShowInGallery { get; set; }
        // Счётчик просмотров публичной страницы (все страницы сайта суммарно).
        public int ViewsCount { get; set; }

        // Есть несохранённые в публикацию изменения (draft отличается от опубликованного).
        [NotMapped]
        public bool HasUnpublishedChanges =>
            IsPublished && !string.IsNullOrEmpty(DraftFolder) && DraftFolder != Folder;

        [NotMapped]
        public Template TemplateInfo { get; set; }
    }
}
