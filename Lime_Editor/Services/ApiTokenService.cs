#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Lime_Editor.Services
{
    // Персональные токены доступа (MCP/AI-agent API, Wave 1 п.5). Тот же принцип, что у
    // пароля: хранится только хэш, сырое значение отдаётся пользователю ровно один раз при
    // создании и больше нигде не восстанавливается.
    public class ApiTokenService
    {
        private readonly LimeEditorContext _db;

        public ApiTokenService(LimeEditorContext db)
        {
            _db = db;
        }

        private static string Hash(string rawToken)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
            return Convert.ToHexString(bytes);
        }

        // Возвращает сырое значение токена — единственный момент, когда оно доступно.
        public async Task<(ApiToken Token, string RawToken)> GenerateAsync(int userId, string label)
        {
            var raw = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            var token = new ApiToken
            {
                UserId = userId,
                TokenHash = Hash(raw),
                Label = string.IsNullOrWhiteSpace(label) ? "Без названия" : label.Trim(),
                CreatedAt = DateTime.UtcNow,
                Revoked = false,
            };
            _db.ApiTokens.Add(token);
            await _db.SaveChangesAsync();
            return (token, raw);
        }

        // null — токен неизвестен/отозван. Best-effort обновление LastUsedAt (не блокирует ответ).
        public async Task<int?> ValidateAsync(string rawToken)
        {
            if (string.IsNullOrWhiteSpace(rawToken)) return null;
            var hash = Hash(rawToken);
            var token = await _db.ApiTokens
                .FirstOrDefaultAsync(t => t.TokenHash == hash && !t.Revoked);
            if (token == null) return null;
            token.LastUsedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return token.UserId;
        }

        public async Task<List<ApiToken>> ListAsync(int userId)
        {
            return await _db.ApiTokens
                .Where(t => t.UserId == userId && !t.Revoked)
                .OrderByDescending(t => t.CreatedAt)
                .ToListAsync();
        }

        public async Task<bool> RevokeAsync(int userId, int tokenId)
        {
            var token = await _db.ApiTokens
                .FirstOrDefaultAsync(t => t.Id == tokenId && t.UserId == userId);
            if (token == null) return false;
            token.Revoked = true;
            await _db.SaveChangesAsync();
            return true;
        }
    }
}
