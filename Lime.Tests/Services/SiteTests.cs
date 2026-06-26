using Lime_Editor.Models;
using Xunit;

namespace Lime.Tests.Services
{
    // Раскатка Editor V2: резервная копия исходного документа снимается ОДИН раз перед первой
    // реальной правкой. Решение вынесено в чистый предикат Site.ShouldBackupOriginal.
    public class SiteTests
    {
        [Fact]
        public void ShouldBackup_OnFirstRealEdit()
        {
            // Бэкапа нет, документ был, входящая правка отличается → снимаем копию.
            Assert.True(Site.ShouldBackupOriginal(existingBackup: null, currentDoc: "{\"v\":1}", incomingDoc: "{\"v\":2}"));
        }

        [Fact]
        public void ShouldNotBackup_WhenBackupAlreadyExists()
        {
            // Копия уже снята — больше не трогаем (оригинал остаётся неизменным).
            Assert.False(Site.ShouldBackupOriginal(existingBackup: "{\"orig\":1}", currentDoc: "{\"v\":2}", incomingDoc: "{\"v\":3}"));
        }

        [Fact]
        public void ShouldNotBackup_OnNoOpAutosave()
        {
            // Автосейв без изменений (current == incoming) бэкап не плодит.
            Assert.False(Site.ShouldBackupOriginal(existingBackup: null, currentDoc: "{\"v\":1}", incomingDoc: "{\"v\":1}"));
        }

        [Fact]
        public void ShouldNotBackup_WhenNoPriorDocument()
        {
            // Новый/legacy-блоб сайт без DocumentJson — нечего сохранять.
            Assert.False(Site.ShouldBackupOriginal(existingBackup: null, currentDoc: null, incomingDoc: "{\"v\":1}"));
        }
    }
}
