using System;

#nullable disable

namespace Lime_Editor.Models
{
    public class GitHubDeployViewModel
    {
        public int SiteId { get; set; }
        public string SiteName { get; set; }
        public string Slug { get; set; }
        public bool IsPublished { get; set; }
        public bool HasUnpublishedChanges { get; set; }
        public bool HasDocument { get; set; }

        public string PlanName { get; set; }
        public bool AllowExport { get; set; }
        public bool IsOAuthConfigured { get; set; }
        public bool HasOAuthConnection { get; set; }
        public bool IsGitHubAppConfigured { get; set; }

        public string ExistingRepoOwner { get; set; }
        public string ExistingRepoName { get; set; }
        public string ExistingRepoUrl { get; set; }
        public string ExistingVercelImportUrl { get; set; }
        public DateTime? LastPushedAt { get; set; }

        public bool HasExistingQuickDeploy => !string.IsNullOrWhiteSpace(ExistingRepoUrl);
    }
}
