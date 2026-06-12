using System.Collections.Generic;

namespace Lime_Editor.Services
{
    public enum AssetIncludeMode
    {
        All,
        Whitelist,
        OnlyReferencedInHtml
    }

    public sealed class AssetFolder
    {
        public string Source { get; init; }
        public string Dest { get; init; }
        public AssetIncludeMode Mode { get; init; } = AssetIncludeMode.All;
        public IReadOnlyList<string> Whitelist { get; init; }
        public bool Recursive { get; init; } = true;
    }

    public sealed class TemplateExportConfig
    {
        public int TemplateId { get; init; }
        public string ZipFileName { get; init; }
        public string HtmlPrefix { get; init; }
        public string HtmlSuffix { get; init; }
        public IReadOnlyList<(string From, string To)> HtmlReplacements { get; init; }
        public IReadOnlyList<AssetFolder> AssetFolders { get; init; }
    }
}
