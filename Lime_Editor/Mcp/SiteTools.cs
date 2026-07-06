#nullable enable
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Lime_Editor.Mcp
{
    // UpdatedAtVersion/baseVersion — строка, не число: это DateTime.Ticks (64-битный long), а
    // JSON-числа в JS/большинстве MCP-клиентов теряют точность за пределами 2^53 (~16 цифр),
    // Ticks обычно 18-19 цифр — round-trip через число тихо портит значение (найдено живым E2E:
    // baseVersion, отправленный клиентом, не совпадал с тем же значением на сервере).
    public record SiteSummary(int Id, string? Slug, string Name, string UpdatedAtVersion, bool IsPublished);
    public record SiteDocument(int Id, string DocumentJson, string UpdatedAtVersion);
    public record ApplyCommandsToolResult(bool Ok, string? Error, int Applied, List<string>? Affected, string? NewVersion);

    // MCP-инструменты (Wave 1 п.5, experience-builder план): «получить JSON сайта, применить
    // команды, список сайтов» — ровно 3, как названо в плане, без лишнего.
    //
    // ВАЖНО (найдено живым E2E, не юнит-тестами): LimeEditorContext.HasQueryFilter захватывает
    // _currentUserId ОДИН РАЗ в конструкторе контекста; в MCP-запросе (Stateless HTTP-транспорт)
    // этот scoped-инстанс, судя по всему, конструируется до того, как ApiTokenAuthenticationHandler
    // успевает проставить claim на HttpContext.User — глобальный фильтр тихо превращается в no-op
    // (внешний E2E показал утечку чужих сайтов, хотя юнит-тесты с ручным конструированием
    // LimeEditorContext(options, StubUser) проходили — там таймингов ASP.NET-пайплайна просто нет).
    // Поэтому здесь НЕ полагаемся на амбиентный фильтр — фильтруем по ICurrentUser явно в каждом
    // запросе (тот же сервис, что фильтр использует внутри, но читается свежо на месте вызова).
    [McpServerToolType]
    public class SiteTools
    {
        private readonly LimeEditorContext _db;
        private readonly IDocumentCommandEngine _commands;
        private readonly ICurrentUser _currentUser;

        public SiteTools(LimeEditorContext db, IDocumentCommandEngine commands, ICurrentUser currentUser)
        {
            _db = db;
            _commands = commands;
            _currentUser = currentUser;
        }

        private int RequireUserId()
        {
            return _currentUser.UserId ?? throw new InvalidOperationException("MCP tool call without an authenticated user.");
        }

        private static string VersionOf(DateTime? updatedAt) =>
            (updatedAt?.Ticks ?? 0).ToString(CultureInfo.InvariantCulture);

        [McpServerTool, Description("Список сайтов текущего пользователя (id, slug, название, версия, опубликован ли).")]
        public async Task<List<SiteSummary>> ListSites()
        {
            var userId = RequireUserId();
            var sites = await _db.Sites.IgnoreQueryFilters()
                .Where(s => s.UserId == userId)
                .OrderByDescending(s => s.UpdatedAt)
                .ToListAsync();
            return sites.Select(s => new SiteSummary(
                s.IdSite ?? 0, s.Slug, s.Name, VersionOf(s.UpdatedAt), s.IsPublished)).ToList();
        }

        [McpServerTool, Description("Текущий (черновой) JSON-документ сайта по его id.")]
        public async Task<SiteDocument?> GetSiteDocument(int siteId)
        {
            var userId = RequireUserId();
            var site = await _db.Sites.IgnoreQueryFilters()
                .FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId);
            if (site == null) return null;
            return new SiteDocument(site.IdSite ?? 0, site.DocumentJson ?? "null", VersionOf(site.UpdatedAt));
        }

        [McpServerTool, Description(
            "Применяет список команд редактирования ({type,payload}, тот же формат, что и AI-конвейер " +
            "редактора) к документу сайта. baseVersion — строка-версия, полученная из GetSiteDocument " +
            "(передавай её как есть, не как число — это Ticks, JSON-числа его portят); при расхождении " +
            "с текущей версией сайта команды НЕ применяются (кто-то уже поменял сайт).")]
        public async Task<ApplyCommandsToolResult> ApplyCommands(int siteId, string commandsJson, string baseVersion)
        {
            var userId = RequireUserId();
            var site = await _db.Sites.IgnoreQueryFilters()
                .FirstOrDefaultAsync(s => s.IdSite == siteId && s.UserId == userId);
            if (site == null)
            {
                return new ApplyCommandsToolResult(false, "site_not_found", 0, null, null);
            }
            if (!long.TryParse(baseVersion, NumberStyles.Integer, CultureInfo.InvariantCulture, out var baseVersionTicks))
            {
                return new ApplyCommandsToolResult(false, "invalid_base_version", 0, null, VersionOf(site.UpdatedAt));
            }
            if (Site.IsVersionConflict(baseVersionTicks, site.UpdatedAt))
            {
                return new ApplyCommandsToolResult(false, "version_conflict", 0, null, VersionOf(site.UpdatedAt));
            }

            var validated = AiContentService.TryParseCommands(commandsJson);
            if (validated == null || validated.Count == 0)
            {
                return new ApplyCommandsToolResult(false, "no_valid_commands", 0, null, VersionOf(site.UpdatedAt));
            }

            var validatedJson = Newtonsoft.Json.JsonConvert.SerializeObject(validated);
            var result = _commands.Apply(site.DocumentJson ?? "null", validatedJson);
            if (result.Applied == 0)
            {
                return new ApplyCommandsToolResult(false, "nothing_applied", 0, null, VersionOf(site.UpdatedAt));
            }

            site.DocumentJson = result.DocumentJson;
            site.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return new ApplyCommandsToolResult(true, null, result.Applied, result.Affected, VersionOf(site.UpdatedAt));
        }
    }
}
