using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Пользовательская коллекция данных сайта (фуллстак, Итерация 3): аналог «таблицы»
    // в no-code. Схема полей хранится как JSON, сами записи — в CollectionRecord.
    // Привязана к сайту (FK на Sites.IdSite, каскадное удаление), как FormSubmission.
    public class Collection
    {
        public int Id { get; set; }

        // Сайт-владелец. FK на Sites.IdSite (каскад).
        public int SiteId { get; set; }

        // Человеческое имя («Товары», «Посты»).
        public string Name { get; set; }

        // Машинный slug — используется в блоке collectionList и скрытом поле формы __collection.
        public string Slug { get; set; }

        // Схема полей как JSON-массив: [{ "name":"title", "type":"text", "label":"Заголовок" }].
        // Типы: text | longtext | number | date | bool | image.
        public string SchemaJson { get; set; }

        public DateTime CreatedAt { get; set; }
    }
}
