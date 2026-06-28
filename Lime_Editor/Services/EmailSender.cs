using Serilog;
using System;
using System.Net;
using System.Net.Mail;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // SMTP-отправитель писем. Конфиг — только через env (как у AI-провайдера):
    //   SMTP_HOST, SMTP_PORT (по умолчанию 587), SMTP_USER, SMTP_PASSWORD,
    //   SMTP_FROM (адрес отправителя), SMTP_SSL (true/false, по умолчанию true=STARTTLS).
    // Если SMTP_HOST/SMTP_FROM не заданы — письмо не уходит, а логируется (IsConfigured=false).
    // Так forgot-password работает в dev без почты, а в проде включается одной переменной.
    public class EmailSender : IEmailSender
    {
        private readonly string _host;
        private readonly int _port;
        private readonly string _user;
        private readonly string _password;
        private readonly string _from;
        private readonly bool _enableSsl;

        public EmailSender()
        {
            _host = Environment.GetEnvironmentVariable("SMTP_HOST") ?? "";
            _port = int.TryParse(Environment.GetEnvironmentVariable("SMTP_PORT"), out var p) ? p : 587;
            _user = Environment.GetEnvironmentVariable("SMTP_USER") ?? "";
            _password = Environment.GetEnvironmentVariable("SMTP_PASSWORD") ?? "";
            _from = Environment.GetEnvironmentVariable("SMTP_FROM") ?? "";
            _enableSsl = !string.Equals(Environment.GetEnvironmentVariable("SMTP_SSL"), "false",
                StringComparison.OrdinalIgnoreCase);
        }

        public bool IsConfigured => !string.IsNullOrEmpty(_host) && !string.IsNullOrEmpty(_from);

        public async Task SendAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default)
        {
            if (!IsConfigured)
            {
                // Лог-режим: письмо никуда не уходит, но видно в логах (тело не пишем целиком, чтобы
                // не светить ссылки-токены сверх необходимого — пишем факт и адресата).
                Log.Information("EMAIL (лог-режим, SMTP не настроен) → {To}: {Subject}", toEmail, subject);
                return;
            }

            using var message = new MailMessage
            {
                From = new MailAddress(_from),
                Subject = subject,
                Body = htmlBody,
                IsBodyHtml = true,
            };
            message.To.Add(toEmail);

            using var client = new SmtpClient(_host, _port)
            {
                EnableSsl = _enableSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
            };
            if (!string.IsNullOrEmpty(_user))
            {
                client.Credentials = new NetworkCredential(_user, _password);
            }

            await client.SendMailAsync(message, ct);
        }
    }
}
