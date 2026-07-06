using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Authorize]
    public class GitHubController : Controller
    {
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly GitHubDeploymentService _github;
        private readonly LimeEditorContext _db;
        private readonly IEntitlementService _entitlements;
        private readonly IConfiguration _config;

        public GitHubController(
            UserManager<ApplicationUser> userManager,
            GitHubDeploymentService github,
            LimeEditorContext db,
            IEntitlementService entitlements,
            IConfiguration config)
        {
            _userManager = userManager;
            _github = github;
            _db = db;
            _entitlements = entitlements;
            _config = config;
        }

        private int CurrentUserId => int.Parse(_userManager.GetUserId(User));

        [HttpGet]
        public async Task<IActionResult> Deploy(int siteId, CancellationToken ct = default)
        {
            var userId = CurrentUserId;
            var site = await _db.Sites.AsNoTracking()
                .FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId, ct);
            if (site == null)
            {
                return Forbid();
            }

            var plan = await _entitlements.ResolvePlanAsync(OwnerRef.ForUser(userId), ct);
            var hasConnection = await _github.HasOAuthConnectionAsync(userId, ct);
            var deployment = await _db.GitHubSiteDeployments.AsNoTracking()
                .FirstOrDefaultAsync(d =>
                    d.SiteId == siteId &&
                    d.UserId == userId &&
                    d.Mode == GitHubDeploymentService.OAuthDeploymentMode,
                    ct);

            var repoUrl = deployment == null
                ? null
                : $"https://github.com/{deployment.Owner}/{deployment.Repo}";

            var vm = new GitHubDeployViewModel
            {
                SiteId = siteId,
                SiteName = site.Name,
                Slug = site.Slug,
                IsPublished = site.IsPublished,
                HasUnpublishedChanges = site.HasUnpublishedChanges,
                HasDocument = !string.IsNullOrWhiteSpace(site.DocumentJson) || !string.IsNullOrWhiteSpace(site.PublishedDocumentJson),
                PlanName = plan?.Name ?? "Free",
                AllowExport = plan?.AllowExport == true,
                IsOAuthConfigured = _github.IsOAuthConfigured,
                HasOAuthConnection = hasConnection,
                IsGitHubAppConfigured = !string.IsNullOrWhiteSpace(_config["GitHub:AppId"]) &&
                    !string.IsNullOrWhiteSpace(_config["GitHub:PrivateKeyBase64"]),
                ExistingRepoOwner = deployment?.Owner,
                ExistingRepoName = deployment?.Repo,
                ExistingRepoUrl = repoUrl,
                ExistingVercelImportUrl = string.IsNullOrWhiteSpace(repoUrl)
                    ? null
                    : "https://vercel.com/new/clone?repository-url=" + Uri.EscapeDataString(repoUrl),
                LastPushedAt = deployment?.LastPushedAt,
            };

            return View(vm);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [EnableRateLimiting("external-api")]
        public async Task<IActionResult> QuickDeploy(int siteId, string style = "blob", CancellationToken ct = default)
        {
            if (!await _github.HasOAuthConnectionAsync(CurrentUserId, ct))
            {
                return RedirectToGitHubAuthorizationOrReport(siteId, style);
            }

            return await DeployOrReportAsync(siteId, style, ct);
        }

        [HttpGet]
        [EnableRateLimiting("external-api")]
        public async Task<IActionResult> OAuthCallback(string code, string state, string error = null, CancellationToken ct = default)
        {
            if (!string.IsNullOrWhiteSpace(error))
            {
                TempData["GitHubDeployError"] = "Подключение GitHub отменено или отклонено.";
                return RedirectToAction("MySites", "Home");
            }

            if (string.IsNullOrWhiteSpace(code))
            {
                TempData["GitHubDeployError"] = "GitHub не вернул код авторизации. Попробуй подключить ещё раз.";
                return RedirectToAction("MySites", "Home");
            }

            try
            {
                var result = await _github.CompleteQuickOAuthAndDeployAsync(
                    CurrentUserId,
                    code,
                    state,
                    CallbackUrl(),
                    ct);
                StoreSuccess(result);
            }
            catch (GitHubDeploymentException ex) when (ex.Code == "export_not_allowed")
            {
                return RedirectToAction("Index", "Billing");
            }
            catch (GitHubDeploymentException ex)
            {
                StoreError(ex);
            }

            return RedirectToAction("MySites", "Home");
        }

        private async Task<IActionResult> DeployOrReportAsync(int siteId, string style, CancellationToken ct)
        {
            try
            {
                var result = await _github.DeployQuickOAuthAsync(CurrentUserId, siteId, style, ct);
                StoreSuccess(result);
            }
            catch (GitHubDeploymentException ex) when (ex.Code == "github_not_connected" || ex.Code == "github_token_unreadable")
            {
                return RedirectToGitHubAuthorizationOrReport(siteId, style);
            }
            catch (GitHubDeploymentException ex) when (ex.Code == "export_not_allowed")
            {
                return RedirectToAction("Index", "Billing");
            }
            catch (GitHubDeploymentException ex)
            {
                StoreError(ex);
            }

            return RedirectToAction("MySites", "Home");
        }

        private void StoreSuccess(GitHubDeployResult result)
        {
            TempData["GitHubDeployMessage"] = result.CreatedRepository
                ? $"Создал публичный репозиторий {result.Owner}/{result.Repo} и отправил туда код сайта."
                : $"Обновил код сайта в репозитории {result.Owner}/{result.Repo}.";
            TempData["GitHubDeployUrl"] = result.RepositoryUrl;
            TempData["GitHubDeployVercelUrl"] = result.VercelImportUrl;
        }

        private void StoreError(GitHubDeploymentException ex)
        {
            TempData["GitHubDeployError"] = ex.Code switch
            {
                "bad_state" => "Сессия подключения GitHub истекла. Запусти деплой ещё раз.",
                "empty_export" => "Экспорт сайта получился пустым. Проверь содержимое сайта и попробуй снова.",
                "github_api" => "GitHub не принял запрос. Проверь доступ к аккаунту и попробуй снова.",
                "github_oauth_not_configured" => "GitHub OAuth ещё не настроен на сервере.",
                "github_token_unreadable" => "Не удалось прочитать сохранённое подключение GitHub. Подключи GitHub заново.",
                "oauth_failed" => "GitHub не завершил авторизацию. Попробуй подключить аккаунт ещё раз.",
                "repo_name_unavailable" => "Не получилось подобрать свободное имя репозитория в GitHub.",
                "site_not_found" => "Сайт не найден или у тебя нет доступа к нему.",
                _ => "Не получилось отправить сайт в GitHub. Попробуй ещё раз чуть позже.",
            };
        }

        private IActionResult RedirectToGitHubAuthorizationOrReport(int siteId, string style)
        {
            try
            {
                return Redirect(CreateAuthorizeUrl(siteId, style).ToString());
            }
            catch (GitHubDeploymentException ex)
            {
                StoreError(ex);
                return RedirectToAction("MySites", "Home");
            }
        }

        private System.Uri CreateAuthorizeUrl(int siteId, string style)
        {
            return _github.CreateQuickDeployAuthorizationUrl(CurrentUserId, siteId, style, CallbackUrl());
        }

        private string CallbackUrl()
        {
            return Url.Action(nameof(OAuthCallback), "GitHub", null, Request.Scheme);
        }
    }
}
