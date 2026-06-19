using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Authorize]
    public class TemplateController : Controller
    {
        private readonly ITemplateExportService _exportService;

        public TemplateController(ITemplateExportService exportService)
        {
            _exportService = exportService;
        }

        // Экспорт сайта в ZIP (статический хостинг). Единственная сохранившаяся точка
        // входа TemplateController после удаления Движка A. Конфигурация — TemplateExportConfigs.
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DownloadSite(string html, int templateId)
        {
            var result = await _exportService.ExportAsync(templateId, html);
            return File(result.ZipBytes, "application/zip", result.FileName);
        }
    }
}
