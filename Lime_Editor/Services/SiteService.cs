using Lime_Editor.Models;
using Microsoft.EntityFrameworkCore;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    public class SiteService : ISiteService
    {
        private readonly LimeEditorContext db;

        public SiteService(LimeEditorContext context)
        {
            db = context;
        }

        public async Task<bool> UserOwnsSiteAsync(int userId, int? siteId)
        {
            if (siteId == null)
            {
                return false;
            }

            return await db.Sites.AnyAsync(s => s.IdSite == siteId && s.UserId == userId);
        }

        public async Task<SiteDashboardResult> GetDashboardAsync(int userId)
        {
            var rows = await (
                from s in db.Sites
                where s.UserId == userId
                join t in db.Templates on s.TemplateId equals t.IdTemplate into tj
                from t in tj.DefaultIfEmpty()
                select new { Site = s, Template = t }
            ).ToListAsync();

            foreach (var row in rows)
            {
                row.Site.TemplateInfo = row.Template;
            }

            var siteIds = rows.Select(r => r.Site.IdSite ?? 0).ToList();
            var leadCounts = await db.FormSubmissions
                .Where(f => !f.IsRead && siteIds.Contains(f.SiteId))
                .GroupBy(f => f.SiteId)
                .Select(g => new { SiteId = g.Key, Count = g.Count() })
                .ToListAsync();

            var model = new SiteControlModel { Sites = rows.Select(r => r.Site).ToList() };
            return new SiteDashboardResult(model, leadCounts.ToDictionary(x => x.SiteId, x => x.Count));
        }

        public Task<Site> GetOwnedSiteAsync(int userId, int siteId)
        {
            return db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId);
        }

        public async Task<bool> DeleteSiteAsync(int userId, int? siteId)
        {
            if (siteId == null)
            {
                return false;
            }

            var site = await GetOwnedSiteAsync(userId, siteId.Value);
            if (site == null)
            {
                return false;
            }

            db.Sites.Remove(site);
            await db.SaveChangesAsync();
            return true;
        }

        public async Task<bool> RenameSiteAsync(int userId, int siteId, string name)
        {
            var site = await GetOwnedSiteAsync(userId, siteId);
            if (site == null)
            {
                return false;
            }

            site.Name = name;
            await db.SaveChangesAsync();
            return true;
        }

        public async Task<bool> UnpublishAsync(int userId, int siteId)
        {
            var site = await GetOwnedSiteAsync(userId, siteId);
            if (site == null)
            {
                return false;
            }

            site.IsPublished = false;
            await db.SaveChangesAsync();
            return true;
        }

        public async Task<string> GenerateUniqueSlugAsync(int userId, string baseName)
        {
            var baseSlug = SlugGenerator.Generate(baseName);
            var slug = baseSlug;
            var i = 1;

            while (await db.Sites.AnyAsync(s => s.UserId == userId && s.Slug == slug))
            {
                slug = $"{baseSlug}-{i++}";
            }

            return slug;
        }
    }
}
