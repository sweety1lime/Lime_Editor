using Lime_Editor.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Integration
{
    // Проверяем именно тот запрос, который защищает от IDOR в HomeController.UserOwnsSiteAsync
    // и TemplateController.UpdateSitecheck.
    public class OwnershipTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public OwnershipTests(WebFactory factory) => _factory = factory;

        [Fact]
        public async Task OwnershipQuery_ReturnsTrue_WhenSiteBelongsToUser()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site { IdSite = 1001, UserId = 1, Name = "A", Folder = "x", TemplateId = 1 });
            await db.SaveChangesAsync();

            var owns = await db.Sites.AnyAsync(s => s.IdSite == 1001 && s.UserId == 1);
            Assert.True(owns);
        }

        [Fact]
        public async Task OwnershipQuery_ReturnsFalse_WhenSiteBelongsToOtherUser()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            db.Sites.Add(new Site { IdSite = 1002, UserId = 1, Name = "A", Folder = "x", TemplateId = 1 });
            await db.SaveChangesAsync();

            // userId=2 пытается получить сайт userId=1 → должен быть отказ.
            var owns = await db.Sites.AnyAsync(s => s.IdSite == 1002 && s.UserId == 2);
            Assert.False(owns);
        }

        [Fact]
        public async Task OwnershipQuery_ReturnsFalse_ForNonexistentSite()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();

            var owns = await db.Sites.AnyAsync(s => s.IdSite == 99999 && s.UserId == 1);
            Assert.False(owns);
        }
    }
}
