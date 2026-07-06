#nullable enable
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lime_Editor.Auth
{
    // Bearer-токен → ClaimsPrincipal с ClaimTypes.NameIdentifier = UserId. Схема регистрируется
    // ДОПОЛНИТЕЛЬНО к cookie-схеме Identity (не заменяет её) — только для MCP/API-эндпоинтов.
    // Populating именно этот claim важно: на нём завязан весь остальной tenant-isolation
    // (ICurrentUser/LimeEditorContext global query filter) — ничего больше чинить не нужно.
    public class ApiTokenAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string SchemeName = "ApiToken";

        private readonly ApiTokenService _tokens;

        public ApiTokenAuthenticationHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder,
            ApiTokenService tokens)
            : base(options, logger, encoder)
        {
            _tokens = tokens;
        }

        protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var header = Request.Headers.Authorization.ToString();
            if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", System.StringComparison.OrdinalIgnoreCase))
            {
                return AuthenticateResult.NoResult();
            }

            var raw = header["Bearer ".Length..].Trim();
            var userId = await _tokens.ValidateAsync(raw);
            if (userId == null)
            {
                return AuthenticateResult.Fail("Invalid or revoked API token.");
            }

            var claims = new[] { new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()) };
            var identity = new ClaimsIdentity(claims, SchemeName);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, SchemeName);
            return AuthenticateResult.Success(ticket);
        }
    }
}
