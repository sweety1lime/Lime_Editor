using System.Collections.Generic;

#nullable disable

namespace Lime_Editor.Services
{
    public sealed class GitHubOAuthSettings
    {
        public string ClientId { get; set; }
        public string ClientSecret { get; set; }
    }

    public sealed class GitHubOAuthToken
    {
        public string AccessToken { get; set; }
        public string Scope { get; set; }
        public string TokenType { get; set; }
    }

    public sealed class GitHubUserInfo
    {
        public long Id { get; set; }
        public string Login { get; set; }
        public string HtmlUrl { get; set; }
    }

    public sealed class GitHubRepositoryInfo
    {
        public long Id { get; set; }
        public string Owner { get; set; }
        public string Name { get; set; }
        public string FullName { get; set; }
        public string HtmlUrl { get; set; }
        public string DefaultBranch { get; set; }
    }

    public sealed class GitHubCommitResult
    {
        public string Sha { get; set; }
        public string HtmlUrl { get; set; }
        public string Branch { get; set; }
    }

    public sealed class GitHubDeployResult
    {
        public string Owner { get; set; }
        public string Repo { get; set; }
        public string RepositoryUrl { get; set; }
        public string CommitSha { get; set; }
        public string CommitUrl { get; set; }
        public string Branch { get; set; }
        public string VercelImportUrl { get; set; }
        public bool CreatedRepository { get; set; }
    }

    public sealed class GitHubExportFile
    {
        public string Path { get; set; }
        public byte[] Bytes { get; set; }
    }

    public sealed class GitHubTreeFile
    {
        public string Path { get; set; }
        public string BlobSha { get; set; }
    }

    public sealed class GitHubExportBundle
    {
        public IReadOnlyList<GitHubExportFile> Files { get; set; }
    }
}
