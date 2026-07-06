#nullable enable
using System.Collections.Generic;

namespace Lime_Editor.Services
{
    public record ApplyCommandsResult(int Applied, List<string> Affected, string DocumentJson);

    public interface IDocumentCommandEngine
    {
        // documentJson — текущий документ; commandsJson — уже провалидированный JSON-массив
        // команд (см. AiContentService.TryParseCommands). Применяет их через тот же
        // lime-commands.js, что использует браузер — единый источник правды для мутации.
        ApplyCommandsResult Apply(string documentJson, string commandsJson);
    }
}
