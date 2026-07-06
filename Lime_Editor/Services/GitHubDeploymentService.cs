using Lime_Editor.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

#nullable disable

namespace Lime_Editor.Services
{
    public sealed class GitHubDeploymentService
    {
        public const string OAuthConnectionKind = "oauth";
        public const string OAuthDeploymentMode = "oauth-public";

        private readonly LimeEditorContext _db;
        private readonly NextExportService _next;
        private readonly IEntitlementService _entitlements;
        private readonly GitHubApiClient _api;
        private readonly IConfiguration _config;
        private readonly IDataProtector _stateProtector;
        private readonly IDataProtector _tokenProtector;

        public GitHubDeploymentService(
            LimeEditorContext db,
            NextExportService next,
            IEntitlementService entitlements,
            GitHubApiClient api,
            IConfiguration config,
            IDataProtectionProvider dataProtectionProvider)
        {
            _db = db;
            _next = next;
            _entitlements = entitlements;
            _api = api;
            _config = config;
            _stateProtector = dataProtectionProvider.CreateProtector("lime.github.oauth.state.v1");
            _tokenProtector = dataProtectionProvider.CreateProtector("lime.github.oauth.token.v1");
        }

        public bool IsOAuthConfigured =>
            !string.IsNullOrWhiteSpace(_config["GitHub:OAuthApp:ClientId"]) &&
            !string.IsNullOrWhiteSpace(_config["GitHub:OAuthApp:ClientSecret"]);

        public async Task<bool> HasOAuthConnectionAsync(int userId, CancellationToken ct = default)
        {
            return await _db.GitHubConnections.AsNoTracking()
                .AnyAsync(c => c.UserId == userId && c.Kind == OAuthConnectionKind && !c.Revoked, ct);
        }

        public Uri CreateQuickDeployAuthorizationUrl(int userId, int siteId, string style, string callbackUrl)
        {
            if (!IsOAuthConfigured)
            {
                throw new GitHubDeploymentException("github_oauth_not_configured", "GitHub OAuth is not configured.");
            }

            var verifier = NewCodeVerifier();
            var state = new OAuthState
            {
                UserId = userId,
                SiteId = siteId,
                Style = NormalizeStyle(style),
                CodeVerifier = verifier,
                ExpiresAtUtc = DateTime.UtcNow.AddMinutes(10),
            };

            var protectedState = _stateProtector.Protect(JsonConvert.SerializeObject(state));
            var query = new Dictionary<string, string>
            {
                ["client_id"] = _config["GitHub:OAuthApp:ClientId"],
                ["redirect_uri"] = callbackUrl,
                ["scope"] = _config["GitHub:OAuthApp:Scope"] ?? "public_repo",
                ["state"] = protectedState,
                ["code_challenge"] = CodeChallenge(verifier),
                ["code_challenge_method"] = "S256",
                ["allow_signup"] = "true",
            };

            return new Uri(QueryHelpers.AddQueryString("https://github.com/login/oauth/authorize", query));
        }

        public async Task<GitHubDeployResult> CompleteQuickOAuthAndDeployAsync(
            int userId,
            string code,
            string state,
            string callbackUrl,
            CancellationToken ct = default)
        {
            var payload = ReadState(userId, state);
            var token = await _api.ExchangeOAuthCodeAsync(new GitHubOAuthSettings
            {
                ClientId = _config["GitHub:OAuthApp:ClientId"],
                ClientSecret = _config["GitHub:OAuthApp:ClientSecret"],
            }, code, callbackUrl, payload.CodeVerifier, ct);

            var githubUser = await _api.GetCurrentUserAsync(token.AccessToken, ct);
            await UpsertOAuthConnectionAsync(userId, githubUser, token, ct);

            return await DeployQuickOAuthAsync(userId, payload.SiteId, payload.Style, ct);
        }

        public async Task<GitHubDeployResult> DeployQuickOAuthAsync(
            int userId,
            int siteId,
            string style,
            CancellationToken ct = default)
        {
            style = NormalizeStyle(style);
            var connection = await _db.GitHubConnections
                .FirstOrDefaultAsync(c => c.UserId == userId && c.Kind == OAuthConnectionKind && !c.Revoked, ct);
            if (connection == null)
            {
                throw new GitHubDeploymentException("github_not_connected", "GitHub is not connected.");
            }

            var site = await _db.Sites.FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId, ct);
            if (site == null)
            {
                throw new GitHubDeploymentException("site_not_found", "Site was not found.");
            }

            var plan = await _entitlements.ResolvePlanAsync(OwnerRef.ForUser(userId), ct);
            if (!plan.AllowExport)
            {
                throw new GitHubDeploymentException("export_not_allowed", "GitHub deploy is available on paid plans.");
            }

            var token = UnprotectToken(connection);
            var deployment = await _db.GitHubSiteDeployments
                .FirstOrDefaultAsync(d => d.SiteId == siteId && d.UserId == userId && d.Mode == OAuthDeploymentMode, ct);

            GitHubRepositoryInfo repo = null;
            var createdRepo = false;
            if (deployment != null)
            {
                repo = await _api.GetRepositoryAsync(token, deployment.Owner, deployment.Repo, ct);
            }

            if (repo == null)
            {
                var repoName = deployment?.Repo ?? await FindAvailableRepoNameAsync(token, connection.Login, site, ct);
                repo = await _api.CreatePublicRepositoryAsync(token, repoName, $"Exported from Lime: {site.Name}", ct);
                createdRepo = true;
            }

            var files = await BuildExportFilesAsync(site, style, ct);
            var branch = deployment?.Branch ?? repo.DefaultBranch ?? "main";
            if (string.Equals(branch, "master", StringComparison.OrdinalIgnoreCase) && createdRepo)
            {
                branch = "main";
            }

            var commit = await _api.CreateOrUpdateFullTreeCommitAsync(
                token,
                repo,
                files,
                branch,
                $"Deploy {site.Name} from Lime",
                ct);

            var now = DateTime.UtcNow;
            if (deployment == null)
            {
                deployment = new GitHubSiteDeployment
                {
                    SiteId = siteId,
                    UserId = userId,
                    Mode = OAuthDeploymentMode,
                    CreatedAt = now,
                };
                _db.GitHubSiteDeployments.Add(deployment);
            }

            deployment.Owner = repo.Owner;
            deployment.Repo = repo.Name;
            deployment.RepoId = repo.Id;
            deployment.Branch = commit.Branch;
            deployment.Style = style;
            deployment.LastCommitSha = commit.Sha;
            deployment.LastPushedAt = now;
            deployment.UpdatedAt = now;
            deployment.LastError = null;
            connection.LastUsedAt = now;
            connection.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);

            return new GitHubDeployResult
            {
                Owner = repo.Owner,
                Repo = repo.Name,
                RepositoryUrl = repo.HtmlUrl,
                CommitSha = commit.Sha,
                CommitUrl = commit.HtmlUrl,
                Branch = commit.Branch,
                CreatedRepository = createdRepo,
                VercelImportUrl = "https://vercel.com/new/clone?repository-url=" + Uri.EscapeDataString(repo.HtmlUrl),
            };
        }

        private async Task UpsertOAuthConnectionAsync(
            int userId,
            GitHubUserInfo githubUser,
            GitHubOAuthToken token,
            CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var connection = await _db.GitHubConnections
                .FirstOrDefaultAsync(c => c.UserId == userId && c.Kind == OAuthConnectionKind, ct);
            if (connection == null)
            {
                connection = new GitHubConnection
                {
                    UserId = userId,
                    Kind = OAuthConnectionKind,
                    CreatedAt = now,
                };
                _db.GitHubConnections.Add(connection);
            }

            connection.GitHubUserId = githubUser.Id;
            connection.Login = githubUser.Login;
            connection.AccessTokenProtected = _tokenProtector.Protect(token.AccessToken);
            connection.Scope = token.Scope ?? "";
            connection.TokenType = token.TokenType ?? "bearer";
            connection.UpdatedAt = now;
            connection.Revoked = false;
            await _db.SaveChangesAsync(ct);
        }

        private async Task<IReadOnlyList<GitHubExportFile>> BuildExportFilesAsync(Site site, string style, CancellationToken ct)
        {
            var siteId = site.IdSite ?? 0;
            var docJson = !string.IsNullOrEmpty(site.PublishedDocumentJson) ? site.PublishedDocumentJson : site.DocumentJson;
            var collections = await _db.Collections.Where(c => c.SiteId == siteId).ToListAsync(ct);
            var colIds = collections.Select(c => c.Id).ToList();
            var records = await _db.CollectionRecords.Where(r => colIds.Contains(r.CollectionId)).ToListAsync(ct);
            var idiomatic = string.Equals(style, "jsx", StringComparison.OrdinalIgnoreCase);
            var zip = _next.BuildZip(site.Name, docJson, collections, records, idiomatic);
            return ReadZipFiles(zip);
        }

        private async Task<string> FindAvailableRepoNameAsync(string token, string owner, Site site, CancellationToken ct)
        {
            var baseName = RepoNameFor(site);
            var candidate = baseName;
            for (var i = 0; i < 25; i++)
            {
                var existing = await _api.GetRepositoryAsync(token, owner, candidate, ct);
                if (existing == null)
                {
                    return candidate;
                }

                candidate = $"{baseName}-{i + 2}";
            }

            throw new GitHubDeploymentException("repo_name_unavailable", "Could not find an available repository name.");
        }

        private static IReadOnlyList<GitHubExportFile> ReadZipFiles(byte[] zipBytes)
        {
            var files = new Dictionary<string, GitHubExportFile>(StringComparer.OrdinalIgnoreCase);
            using var ms = new MemoryStream(zipBytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            foreach (var entry in zip.Entries)
            {
                if (string.IsNullOrWhiteSpace(entry.Name))
                {
                    continue;
                }

                var path = NormalizeZipPath(entry.FullName);
                if (path == null)
                {
                    continue;
                }

                using var src = entry.Open();
                using var dst = new MemoryStream();
                src.CopyTo(dst);
                files[path] = new GitHubExportFile { Path = path, Bytes = dst.ToArray() };
            }

            return files.Values.OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase).ToList();
        }

        private static string NormalizeZipPath(string path)
        {
            path = (path ?? "").Replace('\\', '/').Trim('/');
            if (path.Length == 0 || path.StartsWith("/", StringComparison.Ordinal) || path.Contains("../") || path.Contains("/.."))
            {
                return null;
            }

            return path;
        }

        private static string RepoNameFor(Site site)
        {
            var raw = string.IsNullOrWhiteSpace(site.Slug) ? site.Name : site.Slug;
            var sb = new StringBuilder();
            foreach (var ch in (raw ?? "").Trim().ToLowerInvariant())
            {
                if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
                {
                    sb.Append(ch);
                }
                else if (ch == '-' || ch == '_' || ch == '.')
                {
                    sb.Append('-');
                }
                else if (char.IsWhiteSpace(ch))
                {
                    sb.Append('-');
                }
            }

            var name = sb.ToString();
            while (name.Contains("--"))
            {
                name = name.Replace("--", "-");
            }

            name = name.Trim('-', '.');
            if (string.IsNullOrWhiteSpace(name))
            {
                name = "site-" + (site.IdSite?.ToString() ?? "export");
            }

            if (!name.StartsWith("lime-", StringComparison.OrdinalIgnoreCase))
            {
                name = "lime-" + name;
            }

            return name.Length <= 90 ? name : name.Substring(0, 90).Trim('-', '.');
        }

        private string UnprotectToken(GitHubConnection connection)
        {
            try
            {
                return _tokenProtector.Unprotect(connection.AccessTokenProtected);
            }
            catch (Exception ex)
            {
                throw new GitHubDeploymentException("github_token_unreadable", "Stored GitHub token could not be read: " + ex.Message);
            }
        }

        private OAuthState ReadState(int userId, string state)
        {
            if (string.IsNullOrWhiteSpace(state))
            {
                throw new GitHubDeploymentException("bad_state", "Missing GitHub OAuth state.");
            }

            OAuthState payload;
            try
            {
                payload = JsonConvert.DeserializeObject<OAuthState>(_stateProtector.Unprotect(state));
            }
            catch (Exception ex)
            {
                throw new GitHubDeploymentException("bad_state", "Invalid GitHub OAuth state: " + ex.Message);
            }

            if (payload == null || payload.UserId != userId || payload.ExpiresAtUtc < DateTime.UtcNow)
            {
                throw new GitHubDeploymentException("bad_state", "GitHub OAuth state expired or does not match the current user.");
            }

            return payload;
        }

        private static string NormalizeStyle(string style)
        {
            return string.Equals(style, "jsx", StringComparison.OrdinalIgnoreCase) ? "jsx" : "blob";
        }

        private static string NewCodeVerifier()
        {
            return WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        }

        private static string CodeChallenge(string verifier)
        {
            return WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        }

        private sealed class OAuthState
        {
            public int UserId { get; set; }
            public int SiteId { get; set; }
            public string Style { get; set; }
            public string CodeVerifier { get; set; }
            public DateTime ExpiresAtUtc { get; set; }
        }
    }
}
