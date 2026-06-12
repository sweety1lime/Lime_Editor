using System;
using Lime_Editor.Models;
using Xunit;

namespace Lime.Tests.Services
{
    // Этап 0.4: правило optimistic concurrency для сохранений из конструктора.
    // HomeController.EditTemplatesPost отвечает 409, когда IsVersionConflict == true.
    public class SiteVersionConflictTests
    {
        private static readonly DateTime Saved = new(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc);

        [Fact]
        public void LegacyClient_WithoutVersion_NeverConflicts()
        {
            Assert.False(Site.IsVersionConflict(-1, null));
            Assert.False(Site.IsVersionConflict(-1, Saved));
        }

        [Fact]
        public void MatchingVersion_NoConflict()
        {
            Assert.False(Site.IsVersionConflict(Saved.Ticks, Saved));
            // Сайт ещё ни разу не сохранялся новым кодом (UpdatedAt = null) → версия 0.
            Assert.False(Site.IsVersionConflict(0, null));
        }

        [Fact]
        public void StaleVersion_Conflicts()
        {
            // Открыл со старой версией, другой таб уже сохранил новую.
            Assert.True(Site.IsVersionConflict(Saved.AddMinutes(-5).Ticks, Saved));
            // Открыл до первого «версионного» сохранения (прислал 0), а UpdatedAt уже выставлен.
            Assert.True(Site.IsVersionConflict(0, Saved));
        }
    }
}
