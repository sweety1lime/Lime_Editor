using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Одна запись пользовательской коллекции. Значения полей — JSON-словарь
    // { "title":"...", "price":"..." } по схеме Collection.SchemaJson (без жёстких колонок).
    public class CollectionRecord
    {
        public int Id { get; set; }

        // Коллекция-владелец. FK на Collections.Id (каскад).
        public int CollectionId { get; set; }

        public string DataJson { get; set; }

        public DateTime CreatedAt { get; set; }
    }
}
