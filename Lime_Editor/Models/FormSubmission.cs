using System;

#nullable disable

namespace Lime_Editor.Models
{
    // Заявка (лид) с опубликованного сайта: посетитель отправил форму на /u/{user}/{slug}.
    // Набор полей задаётся владельцем в конструкторе, поэтому значения храним как JSON-словарь
    // {"Имя":"...","Email":"...","Сообщение":"..."} — без жёсткой схемы колонок.
    public class FormSubmission
    {
        public int Id { get; set; }

        // Сайт, которому принадлежит заявка. FK на Sites.IdSite (каскадное удаление вместе с сайтом).
        public int SiteId { get; set; }

        // Поля формы как JSON-словарь.
        public string DataJson { get; set; }

        // IP отправителя (для анти-абуза/диагностики). Может быть null.
        public string IpAddress { get; set; }

        public DateTime SubmittedAt { get; set; }

        // Прочитана ли заявка владельцем (для бейджа «новые» в личном кабинете).
        public bool IsRead { get; set; }
    }
}
