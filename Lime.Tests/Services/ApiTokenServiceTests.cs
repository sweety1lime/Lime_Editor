using System;
using System.Threading.Tasks;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Lime.Tests.Services
{
    // MCP/AI-agent API (Wave 1 п.5): персональные токены доступа. Тот же принцип, что у
    // пароля — хранится только хэш, сырое значение доступно один раз при создании.
    public class ApiTokenServiceTests
    {
        private static LimeEditorContext NewContext()
        {
            var options = new DbContextOptionsBuilder<LimeEditorContext>()
                .UseInMemoryDatabase("apitoken_" + Guid.NewGuid().ToString("N"))
                .Options;
            return new LimeEditorContext(options);
        }

        [Fact]
        public async Task Generate_ThenValidate_RoundTripsToSameUser()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            var (token, raw) = await svc.GenerateAsync(42, "мой агент");

            Assert.NotEqual(raw, token.TokenHash); // хэш никогда не равен сырому значению
            var userId = await svc.ValidateAsync(raw);
            Assert.Equal(42, userId);
        }

        [Fact]
        public async Task Validate_UnknownToken_ReturnsNull()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            Assert.Null(await svc.ValidateAsync("совсем-не-тот-токен"));
        }

        [Fact]
        public async Task Validate_RevokedToken_ReturnsNull()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            var (token, raw) = await svc.GenerateAsync(7, "тест");
            await svc.RevokeAsync(7, token.Id);

            Assert.Null(await svc.ValidateAsync(raw));
        }

        [Fact]
        public async Task Revoke_WrongUser_DoesNotRevoke()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            var (token, raw) = await svc.GenerateAsync(7, "тест");

            var revoked = await svc.RevokeAsync(999, token.Id); // чужой userId
            Assert.False(revoked);
            Assert.Equal(7, await svc.ValidateAsync(raw)); // токен всё ещё жив
        }

        [Fact]
        public async Task ListAsync_OnlyReturnsOwnActiveTokens()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            var (mine, _) = await svc.GenerateAsync(1, "мой");
            var (revokedMine, _) = await svc.GenerateAsync(1, "отозванный");
            await svc.GenerateAsync(2, "чужой");
            await svc.RevokeAsync(1, revokedMine.Id);

            var list = await svc.ListAsync(1);
            Assert.Single(list);
            Assert.Equal(mine.Id, list[0].Id);
        }

        [Fact]
        public async Task Validate_UsesConstantShapeHash_NotPlaintext()
        {
            using var db = NewContext();
            var svc = new ApiTokenService(db);
            var (token, raw) = await svc.GenerateAsync(1, "x");

            // Хэш — hex SHA-256 (64 символа), не совпадает по длине/содержимому с сырым токеном.
            Assert.Equal(64, token.TokenHash.Length);
            Assert.DoesNotContain(raw, token.TokenHash, StringComparison.Ordinal);
        }
    }
}
