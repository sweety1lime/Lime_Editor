using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Email-уведомление владельцу о новой заявке: письмо уходит после сохранения в инбокс,
    // спам (honeypot) писем не порождает, сбой почты не роняет приём заявки.
    public class FormEmailNotificationTests : IClassFixture<WebFactory>
    {
        private sealed class CapturingEmailSender : IEmailSender
        {
            public readonly List<(string To, string Subject, string Body)> Sent = new();
            public bool IsConfigured => true;
            public Task SendAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default)
            {
                Sent.Add((toEmail, subject, htmlBody));
                return Task.CompletedTask;
            }
        }

        private readonly WebFactory _factory;

        public FormEmailNotificationTests(WebFactory factory) => _factory = factory;

        private static (WebApplicationFactory<Lime_Editor.Program> Factory, CapturingEmailSender Email) WithCapturedEmail(WebFactory factory)
        {
            var capture = new CapturingEmailSender();
            var derived = factory.WithWebHostBuilder(b =>
                b.ConfigureServices(s => s.AddSingleton<IEmailSender>(capture)));
            return (derived, capture);
        }

        private static async Task<int> SeedSiteWithOwnerAsync(WebApplicationFactory<Lime_Editor.Program> factory, string ownerEmail)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            var ownerId = 500000 + Math.Abs(Guid.NewGuid().GetHashCode() % 100000);
            db.Users.Add(new ApplicationUser
            {
                Id = ownerId,
                UserName = "owner" + ownerId,
                NormalizedUserName = "OWNER" + ownerId,
                Email = ownerEmail,
                NormalizedEmail = ownerEmail.ToUpperInvariant(),
            });
            var siteId = ownerId + 1;
            db.Sites.Add(new Site
            {
                IdSite = siteId,
                Name = "Кофейня «Зерно»",
                Folder = "<html></html>",
                UserId = ownerId,
                TemplateId = 1,
                Slug = "zerno",
                IsPublished = true,
            });
            await db.SaveChangesAsync();
            return siteId;
        }

        private static FormUrlEncodedContent ValidForm(int siteId, string name = "Алиса") =>
            new(new[]
            {
                new KeyValuePair<string, string>("__siteId", siteId.ToString()),
                new KeyValuePair<string, string>("lime_ts", DateTimeOffset.UtcNow.AddSeconds(-2).ToUnixTimeSeconds().ToString()),
                new KeyValuePair<string, string>("name", name),
                new KeyValuePair<string, string>("comment", "<b>жирный</b> текст"),
            });

        [Fact]
        public async Task Submit_SendsNotificationToOwner_WithEncodedFields()
        {
            var (factory, email) = WithCapturedEmail(_factory);
            var siteId = await SeedSiteWithOwnerAsync(factory, "owner@test.local");
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            var response = await client.PostAsync("/Form/Submit", ValidForm(siteId));

            Assert.True((int)response.StatusCode < 400);
            var sent = Assert.Single(email.Sent);
            Assert.Equal("owner@test.local", sent.To);
            Assert.Contains("Кофейня «Зерно»", sent.Subject);
            Assert.Contains("Алиса", sent.Body);
            Assert.Contains("/Form/Inbox?siteId=" + siteId, sent.Body);
            // Пользовательский ввод энкодится — HTML не протекает в письмо как разметка.
            Assert.DoesNotContain("<b>жирный</b>", sent.Body);
            Assert.Contains("&lt;b&gt;жирный&lt;/b&gt;", sent.Body);
        }

        [Fact]
        public async Task Submit_Honeypot_DoesNotSendEmail()
        {
            var (factory, email) = WithCapturedEmail(_factory);
            var siteId = await SeedSiteWithOwnerAsync(factory, "owner2@test.local");
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            var form = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("__siteId", siteId.ToString()),
                new KeyValuePair<string, string>("lime_hp", "bot-filled"),
                new KeyValuePair<string, string>("name", "Бот"),
            });
            var response = await client.PostAsync("/Form/Submit", form);

            Assert.True((int)response.StatusCode < 400);
            Assert.Empty(email.Sent);
        }
    }
}
