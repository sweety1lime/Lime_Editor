#nullable enable
using System.Collections.Generic;

namespace Lime_Editor.Models
{
    // MCP/AI-agent API (Wave 1 п.5): страница управления персональными токенами доступа.
    public class ApiTokensViewModel
    {
        public List<ApiToken> Tokens { get; set; } = new();
        // Сырое значение только что созданного токена — показывается один раз (TempData).
        public string? NewToken { get; set; }
    }
}
