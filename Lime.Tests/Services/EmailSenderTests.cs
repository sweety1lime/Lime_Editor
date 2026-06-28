using Lime_Editor.Services;
using System;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Services
{
    // EmailSender без SMTP-конфига должен работать в лог-режиме: IsConfigured=false и
    // SendAsync не бросает (forgot-password не падает в dev/без почтового провайдера).
    public class EmailSenderTests
    {
        [Fact]
        public void IsConfigured_False_WhenSmtpEnvMissing()
        {
            Environment.SetEnvironmentVariable("SMTP_HOST", null);
            Environment.SetEnvironmentVariable("SMTP_FROM", null);

            var sender = new EmailSender();

            Assert.False(sender.IsConfigured);
        }

        [Fact]
        public async Task SendAsync_DoesNotThrow_InLogMode()
        {
            Environment.SetEnvironmentVariable("SMTP_HOST", null);
            Environment.SetEnvironmentVariable("SMTP_FROM", null);

            var sender = new EmailSender();

            // Лог-режим: письмо не уходит, исключения быть не должно.
            await sender.SendAsync("user@test.local", "Тема", "<p>тело</p>");
        }

        [Fact]
        public void IsConfigured_True_WhenHostAndFromSet()
        {
            Environment.SetEnvironmentVariable("SMTP_HOST", "smtp.example.com");
            Environment.SetEnvironmentVariable("SMTP_FROM", "no-reply@example.com");
            try
            {
                var sender = new EmailSender();
                Assert.True(sender.IsConfigured);
            }
            finally
            {
                Environment.SetEnvironmentVariable("SMTP_HOST", null);
                Environment.SetEnvironmentVariable("SMTP_FROM", null);
            }
        }
    }
}
