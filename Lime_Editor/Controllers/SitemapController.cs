using Lime_Editor.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    // SEO (Фаза 4): sitemap.xml со всеми опубликованными сайтами + robots.txt.
    // Без авторизации — это публичные служебные файлы для поисковиков.
    [AllowAnonymous]
    public class SitemapController : Controller
    {
        private readonly LimeEditorContext db;

        public SitemapController(LimeEditorContext context)
        {
            db = context;
        }

        [Route("sitemap.xml")]
        public async Task<IActionResult> Index()
        {
            var baseUrl = $"{Request.Scheme}://{Request.Host}";
            var sites = await (from s in db.Sites
                               where s.IsPublished && s.Slug != null
                               join u in db.Users on s.UserId equals u.Id
                               select new { u.UserName, s.Slug, s.PublishedAt, s.UpdatedAt })
                              .ToListAsync();

            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            sb.Append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
            foreach (var s in sites)
            {
                var loc = $"{baseUrl}/u/{Uri.EscapeDataString(s.UserName)}/{Uri.EscapeDataString(s.Slug)}";
                sb.Append("  <url><loc>").Append(System.Security.SecurityElement.Escape(loc)).Append("</loc>");
                var lastmod = s.UpdatedAt ?? s.PublishedAt;
                if (lastmod != null)
                {
                    sb.Append("<lastmod>").Append(lastmod.Value.ToString("yyyy-MM-dd")).Append("</lastmod>");
                }
                sb.Append("</url>\n");
            }
            sb.Append("</urlset>");
            return Content(sb.ToString(), "application/xml", Encoding.UTF8);
        }

        [Route("robots.txt")]
        public IActionResult Robots()
        {
            var baseUrl = $"{Request.Scheme}://{Request.Host}";
            var body = "User-agent: *\nAllow: /\nSitemap: " + baseUrl + "/sitemap.xml\n";
            return Content(body, "text/plain", Encoding.UTF8);
        }
    }
}
