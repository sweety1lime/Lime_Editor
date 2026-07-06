#nullable enable
using System;

namespace Lime_Editor.Models
{
    // Персональный токен доступа (MCP/AI-agent API, Wave 1 п.5): позволяет скрипту/агенту
    // пользователя авторизоваться без браузерной cookie-сессии. Роль намеренно НЕ привязана
    // к MCP в названии — тот же токен пригоден для любого будущего программного API.
    // Хранится только хэш (SHA-256) — сырое значение показывается пользователю один раз при
    // создании и больше нигде не восстанавливается (тот же принцип, что у пароля).
    public class ApiToken
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public string TokenHash { get; set; } = "";
        public string Label { get; set; } = "";
        public DateTime CreatedAt { get; set; }
        public DateTime? LastUsedAt { get; set; }
        public bool Revoked { get; set; }
    }
}
