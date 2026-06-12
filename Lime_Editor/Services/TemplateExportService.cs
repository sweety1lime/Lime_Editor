using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;

namespace Lime_Editor.Services
{
    public sealed class TemplateExportService : ITemplateExportService
    {
        private readonly IWebHostEnvironment _env;

        public TemplateExportService(IWebHostEnvironment env)
        {
            _env = env;
        }

        public Task<ExportResult> ExportAsync(int templateId, string innerHtml)
        {
            if (!TemplateExportConfigs.All.TryGetValue(templateId, out var config))
            {
                throw new ArgumentException($"Неизвестный templateId: {templateId}", nameof(templateId));
            }

            var finalHtml = BuildHtml(innerHtml ?? string.Empty, config);
            var zipBytes = BuildZip(finalHtml, config);
            return Task.FromResult(new ExportResult(zipBytes, config.ZipFileName));
        }

        private static string BuildHtml(string innerHtml, TemplateExportConfig config)
        {
            var html = config.HtmlPrefix + innerHtml + config.HtmlSuffix;
            html = html.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");
            foreach (var (from, to) in config.HtmlReplacements)
            {
                html = html.Replace(from, to);
            }
            return html;
        }

        private byte[] BuildZip(string html, TemplateExportConfig config)
        {
            using var ms = new MemoryStream();
            using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                AddString(archive, "index.html", html);
                foreach (var folder in config.AssetFolders)
                {
                    AddFolder(archive, folder, html);
                }
            }
            return ms.ToArray();
        }

        private static void AddString(ZipArchive archive, string entryName, string content)
        {
            var entry = archive.CreateEntry(entryName);
            using var w = new StreamWriter(entry.Open());
            w.Write(content);
        }

        private void AddFolder(ZipArchive archive, AssetFolder folder, string html)
        {
            var sourceRoot = Path.Combine(_env.WebRootPath, folder.Source.Replace('/', Path.DirectorySeparatorChar));
            if (!Directory.Exists(sourceRoot))
            {
                return;
            }

            var searchOption = folder.Recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            var files = Directory.GetFiles(sourceRoot, "*", searchOption);

            foreach (var file in files)
            {
                var fileName = Path.GetFileName(file);
                if (!ShouldInclude(folder, fileName, html))
                {
                    continue;
                }

                var relPath = Path.GetRelativePath(sourceRoot, file).Replace(Path.DirectorySeparatorChar, '/');
                var entryName = string.IsNullOrEmpty(folder.Dest) ? relPath : $"{folder.Dest}/{relPath}";

                var entry = archive.CreateEntry(entryName);
                using var src = File.OpenRead(file);
                using var dest = entry.Open();
                src.CopyTo(dest);
            }
        }

        private static bool ShouldInclude(AssetFolder folder, string fileName, string html) => folder.Mode switch
        {
            AssetIncludeMode.All => true,
            AssetIncludeMode.Whitelist => folder.Whitelist != null && folder.Whitelist.Contains(fileName),
            AssetIncludeMode.OnlyReferencedInHtml => html.Contains(fileName),
            _ => true,
        };
    }
}
