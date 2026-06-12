using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    public sealed record ExportResult(byte[] ZipBytes, string FileName);

    public interface ITemplateExportService
    {
        Task<ExportResult> ExportAsync(int templateId, string innerHtml);
    }
}
