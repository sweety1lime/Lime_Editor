using System;

#nullable disable

namespace Lime_Editor.Models
{
    public class GitHubConnection
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public string Kind { get; set; }
        public long GitHubUserId { get; set; }
        public string Login { get; set; }
        public string AccessTokenProtected { get; set; }
        public string Scope { get; set; }
        public string TokenType { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public DateTime? LastUsedAt { get; set; }
        public bool Revoked { get; set; }
    }
}
