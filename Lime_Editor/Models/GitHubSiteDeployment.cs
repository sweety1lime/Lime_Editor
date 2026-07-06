using System;

#nullable disable

namespace Lime_Editor.Models
{
    public class GitHubSiteDeployment
    {
        public int Id { get; set; }
        public int SiteId { get; set; }
        public int UserId { get; set; }
        public string Mode { get; set; }
        public string Owner { get; set; }
        public string Repo { get; set; }
        public long? RepoId { get; set; }
        public string Branch { get; set; }
        public string Style { get; set; }
        public string LastCommitSha { get; set; }
        public DateTime? LastPushedAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public string LastError { get; set; }
        public string VercelProjectId { get; set; }
        public string VercelUrl { get; set; }
    }
}
