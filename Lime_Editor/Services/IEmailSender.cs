using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Отправка транзакционных писем (восстановление пароля, подтверждение email).
    // Реализация EmailSender шлёт через SMTP, если он сконфигурирован env-переменными,
    // иначе пишет письмо в лог (dev/раскатка без почтового провайдера) — фича не падает.
    public interface IEmailSender
    {
        // true, если задан реальный SMTP. UI может, например, не показывать «забыли пароль»,
        // если письма всё равно некуда слать (сейчас не скрываем — лог-режим рабочий для dev).
        bool IsConfigured { get; }

        Task SendAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default);
    }
}
