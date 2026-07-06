using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

#nullable disable

namespace Lime_Editor.Services
{
    public sealed class GitHubApiClient
    {
        private readonly IHttpClientFactory _httpClientFactory;

        public GitHubApiClient(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        public async Task<GitHubOAuthToken> ExchangeOAuthCodeAsync(
            GitHubOAuthSettings settings,
            string code,
            string redirectUri,
            string codeVerifier,
            CancellationToken ct = default)
        {
            var client = _httpClientFactory.CreateClient("github-oauth");
            using var req = new HttpRequestMessage(HttpMethod.Post, "login/oauth/access_token");
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            req.Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = settings.ClientId,
                ["client_secret"] = settings.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
                ["code_verifier"] = codeVerifier,
            });

            var json = await SendForJsonAsync(client, req, ct);
            if (!string.IsNullOrEmpty(json.Value<string>("error")))
            {
                throw new GitHubDeploymentException("oauth_failed",
                    json.Value<string>("error_description") ?? json.Value<string>("error") ?? "GitHub OAuth failed.");
            }

            var token = json.Value<string>("access_token");
            if (string.IsNullOrWhiteSpace(token))
            {
                throw new GitHubDeploymentException("oauth_failed", "GitHub did not return an access token.");
            }

            return new GitHubOAuthToken
            {
                AccessToken = token,
                Scope = json.Value<string>("scope") ?? "",
                TokenType = json.Value<string>("token_type") ?? "bearer",
            };
        }

        public async Task<GitHubUserInfo> GetCurrentUserAsync(string token, CancellationToken ct = default)
        {
            var json = await SendGitHubJsonAsync(token, HttpMethod.Get, "user", null, ct);
            return new GitHubUserInfo
            {
                Id = json.Value<long>("id"),
                Login = json.Value<string>("login"),
                HtmlUrl = json.Value<string>("html_url"),
            };
        }

        public async Task<GitHubRepositoryInfo> GetRepositoryAsync(
            string token,
            string owner,
            string repo,
            CancellationToken ct = default)
        {
            try
            {
                var json = await SendGitHubJsonAsync(token, HttpMethod.Get, $"repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}", null, ct);
                return ParseRepository(json);
            }
            catch (GitHubDeploymentException ex) when (ex.Code == "github_404")
            {
                return null;
            }
        }

        public async Task<GitHubRepositoryInfo> CreatePublicRepositoryAsync(
            string token,
            string name,
            string description,
            CancellationToken ct = default)
        {
            var body = new JObject
            {
                ["name"] = name,
                ["description"] = description ?? "",
                ["private"] = false,
                ["auto_init"] = false,
            };
            var json = await SendGitHubJsonAsync(token, HttpMethod.Post, "user/repos", body, ct);
            return ParseRepository(json);
        }

        public async Task<GitHubCommitResult> CreateOrUpdateFullTreeCommitAsync(
            string token,
            GitHubRepositoryInfo repo,
            IReadOnlyList<GitHubExportFile> files,
            string branch,
            string message,
            CancellationToken ct = default)
        {
            if (files == null || files.Count == 0)
            {
                throw new GitHubDeploymentException("empty_export", "The generated export did not contain any files.");
            }

            branch = string.IsNullOrWhiteSpace(branch) ? "main" : branch;
            var headSha = await GetBranchHeadShaAsync(token, repo.Owner, repo.Name, branch, ct);
            var blobEntries = new List<GitHubTreeFile>(files.Count);

            foreach (var file in files)
            {
                var blobSha = await CreateBlobAsync(token, repo.Owner, repo.Name, file.Bytes, ct);
                blobEntries.Add(new GitHubTreeFile { Path = file.Path, BlobSha = blobSha });
            }

            var treeSha = await CreateTreeAsync(token, repo.Owner, repo.Name, blobEntries, ct);
            var commitSha = await CreateCommitAsync(token, repo.Owner, repo.Name, treeSha, headSha, message, ct);

            if (string.IsNullOrEmpty(headSha))
            {
                await CreateRefAsync(token, repo.Owner, repo.Name, branch, commitSha, ct);
            }
            else
            {
                await UpdateRefAsync(token, repo.Owner, repo.Name, branch, commitSha, ct);
            }

            return new GitHubCommitResult
            {
                Sha = commitSha,
                HtmlUrl = $"{repo.HtmlUrl}/commit/{commitSha}",
                Branch = branch,
            };
        }

        private static GitHubRepositoryInfo ParseRepository(JObject json)
        {
            return new GitHubRepositoryInfo
            {
                Id = json.Value<long>("id"),
                Owner = json["owner"]?.Value<string>("login"),
                Name = json.Value<string>("name"),
                FullName = json.Value<string>("full_name"),
                HtmlUrl = json.Value<string>("html_url"),
                DefaultBranch = json.Value<string>("default_branch") ?? "main",
            };
        }

        private async Task<string> CreateBlobAsync(string token, string owner, string repo, byte[] bytes, CancellationToken ct)
        {
            var body = new JObject
            {
                ["content"] = Convert.ToBase64String(bytes),
                ["encoding"] = "base64",
            };
            var json = await SendGitHubJsonAsync(token, HttpMethod.Post, RepoPath(owner, repo, "git/blobs"), body, ct);
            return json.Value<string>("sha");
        }

        private async Task<string> CreateTreeAsync(string token, string owner, string repo, IReadOnlyList<GitHubTreeFile> files, CancellationToken ct)
        {
            var tree = new JArray(files.Select(f => new JObject
            {
                ["path"] = f.Path,
                ["mode"] = "100644",
                ["type"] = "blob",
                ["sha"] = f.BlobSha,
            }));
            var body = new JObject { ["tree"] = tree };
            var json = await SendGitHubJsonAsync(token, HttpMethod.Post, RepoPath(owner, repo, "git/trees"), body, ct);
            return json.Value<string>("sha");
        }

        private async Task<string> CreateCommitAsync(
            string token,
            string owner,
            string repo,
            string treeSha,
            string parentSha,
            string message,
            CancellationToken ct)
        {
            var parents = new JArray();
            if (!string.IsNullOrEmpty(parentSha))
            {
                parents.Add(parentSha);
            }

            var body = new JObject
            {
                ["message"] = message,
                ["tree"] = treeSha,
                ["parents"] = parents,
            };
            var json = await SendGitHubJsonAsync(token, HttpMethod.Post, RepoPath(owner, repo, "git/commits"), body, ct);
            return json.Value<string>("sha");
        }

        private async Task<string> GetBranchHeadShaAsync(string token, string owner, string repo, string branch, CancellationToken ct)
        {
            try
            {
                var json = await SendGitHubJsonAsync(token, HttpMethod.Get, RepoPath(owner, repo, $"git/ref/heads/{Uri.EscapeDataString(branch)}"), null, ct);
                return json["object"]?.Value<string>("sha");
            }
            catch (GitHubDeploymentException ex) when (ex.Code == "github_404")
            {
                return null;
            }
        }

        private Task CreateRefAsync(string token, string owner, string repo, string branch, string commitSha, CancellationToken ct)
        {
            var body = new JObject
            {
                ["ref"] = $"refs/heads/{branch}",
                ["sha"] = commitSha,
            };
            return SendGitHubJsonAsync(token, HttpMethod.Post, RepoPath(owner, repo, "git/refs"), body, ct);
        }

        private Task UpdateRefAsync(string token, string owner, string repo, string branch, string commitSha, CancellationToken ct)
        {
            var body = new JObject
            {
                ["sha"] = commitSha,
                ["force"] = false,
            };
            return SendGitHubJsonAsync(token, new HttpMethod("PATCH"), RepoPath(owner, repo, $"git/refs/heads/{Uri.EscapeDataString(branch)}"), body, ct);
        }

        private async Task<JObject> SendGitHubJsonAsync(
            string token,
            HttpMethod method,
            string path,
            JObject body,
            CancellationToken ct)
        {
            var client = _httpClientFactory.CreateClient("github");
            using var req = new HttpRequestMessage(method, path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (body != null)
            {
                req.Content = JsonContent(body);
            }

            return await SendForJsonAsync(client, req, ct);
        }

        private static async Task<JObject> SendForJsonAsync(HttpClient client, HttpRequestMessage req, CancellationToken ct)
        {
            using var res = await client.SendAsync(req, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                var code = res.StatusCode == HttpStatusCode.NotFound ? "github_404" : "github_api";
                var message = TryReadGitHubMessage(text) ?? $"{(int)res.StatusCode} {res.ReasonPhrase}";
                throw new GitHubDeploymentException(code, message);
            }

            return string.IsNullOrWhiteSpace(text) ? new JObject() : JObject.Parse(text);
        }

        private static string TryReadGitHubMessage(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }

            try
            {
                var json = JObject.Parse(text);
                var msg = json.Value<string>("message");
                var docs = json.Value<string>("documentation_url");
                return string.IsNullOrWhiteSpace(docs) ? msg : $"{msg} ({docs})";
            }
            catch (JsonException)
            {
                return text;
            }
        }

        private static HttpContent JsonContent(JObject body)
        {
            return new StringContent(body.ToString(Formatting.None), Encoding.UTF8, "application/json");
        }

        private static string RepoPath(string owner, string repo, string suffix)
        {
            return $"repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}/{suffix}";
        }
    }
}
