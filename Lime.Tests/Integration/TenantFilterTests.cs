using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using Xunit;

namespace Lime.Tests.Integration
{
    // EF global query filter изолирует сайты по владельцу. Проверяем на InMemory-провайдере
    // (HasQueryFilter применяется провайдер-независимо) через стаб ICurrentUser.
    public class TenantFilterTests
    {
        private sealed class StubUser : ICurrentUser
        {
            public StubUser(int? id) => UserId = id;
            public int? UserId { get; }
        }

        private static DbContextOptions<LimeEditorContext> NewOptions() =>
            new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("tenant_" + Guid.NewGuid().ToString("N"))
                .Options;

        private static void Seed(DbContextOptions<LimeEditorContext> options)
        {
            // Сидим без пользователя (фильтр отключён) — кладём сайты двух владельцев.
            using var db = new LimeEditorContext(options, new StubUser(null));
            db.Sites.Add(new Site { IdSite = 1, UserId = 10, Name = "A", Folder = "x", TemplateId = 1 });
            db.Sites.Add(new Site { IdSite = 2, UserId = 20, Name = "B", Folder = "x", TemplateId = 1 });
            db.SaveChanges();
        }

        [Fact]
        public void Filter_HidesOtherUsersSites_ForAuthenticatedUser()
        {
            var options = NewOptions();
            Seed(options);

            using var db = new LimeEditorContext(options, new StubUser(10));
            var sites = db.Sites.ToList();

            Assert.Single(sites);
            Assert.Equal(10, sites[0].UserId);
        }

        [Fact]
        public void Filter_Disabled_WhenNoCurrentUser()
        {
            var options = NewOptions();
            Seed(options);

            // Аноним/фон (UserId == null) — видит всё (публичный показ, sitemap, фоновые задачи).
            using var db = new LimeEditorContext(options, new StubUser(null));

            Assert.Equal(2, db.Sites.Count());
        }

        [Fact]
        public void IgnoreQueryFilters_SeesAllSites_EvenAsUser()
        {
            var options = NewOptions();
            Seed(options);

            // Кросс-тенантные пути (галерея/админка/публичный показ) обходят фильтр явно.
            using var db = new LimeEditorContext(options, new StubUser(10));

            Assert.Equal(2, db.Sites.IgnoreQueryFilters().Count());
        }
    }
}
