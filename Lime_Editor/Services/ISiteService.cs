using Lime_Editor.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    public interface ISiteService
    {
        Task<bool> UserOwnsSiteAsync(int userId, int? siteId);
        Task<SiteDashboardResult> GetDashboardAsync(int userId);
        Task<Site> GetOwnedSiteAsync(int userId, int siteId);
        Task<bool> DeleteSiteAsync(int userId, int? siteId);
        Task<bool> RenameSiteAsync(int userId, int siteId, string name);
        Task<bool> UnpublishAsync(int userId, int siteId);
        Task<string> GenerateUniqueSlugAsync(int userId, string baseName);
    }

    public class SiteDashboardResult
    {
        public SiteDashboardResult(SiteControlModel model, Dictionary<int, int> leadCounts)
        {
            Model = model;
            LeadCounts = leadCounts;
        }

        public SiteControlModel Model { get; }
        public Dictionary<int, int> LeadCounts { get; }
    }
}
