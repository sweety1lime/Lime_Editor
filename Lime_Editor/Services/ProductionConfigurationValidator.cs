using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Lime_Editor.Services
{
    public static class ProductionConfigurationValidator
    {
        public static void Validate(IServiceProvider services)
        {
            var env = services.GetRequiredService<IHostEnvironment>();
            var config = services.GetRequiredService<IConfiguration>();
            Validate(env.EnvironmentName, config);
        }

        public static void Validate(string environmentName, IConfiguration config)
        {
            if (!string.Equals(environmentName, Environments.Production, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var errors = new List<string>();

            if (string.IsNullOrWhiteSpace(config.GetConnectionString("connect")))
            {
                errors.Add("ConnectionStrings:connect is required in Production.");
            }

            var allowedHosts = SplitList(config["AllowedHosts"]).ToArray();
            if (allowedHosts.Length == 0 ||
                allowedHosts.Any(h => h == "*") ||
                allowedHosts.All(IsLocalHost))
            {
                errors.Add("AllowedHosts must contain the public production host, not '*', empty, or localhost-only.");
            }

            var trustsAllForwardedHeaders = IsTrue(config["ForwardedHeaders:TrustAll"]);
            var knownForwardedProxies = SplitList(config["ForwardedHeaders:KnownProxies"]).ToArray();
            var knownForwardedNetworks = SplitList(config["ForwardedHeaders:KnownNetworks"]).ToArray();
            if (!trustsAllForwardedHeaders &&
                knownForwardedProxies.Length == 0 &&
                knownForwardedNetworks.Length == 0)
            {
                errors.Add("ForwardedHeaders must explicitly trust the reverse proxy: set ForwardedHeaders:TrustAll=true for a closed proxy-only Docker network, or configure ForwardedHeaders:KnownProxies/KnownNetworks.");
            }

            var smtpHost = config["SMTP_HOST"];
            var smtpFrom = config["SMTP_FROM"];
            var smtpEnabled = !string.IsNullOrWhiteSpace(smtpHost) || !string.IsNullOrWhiteSpace(smtpFrom);
            if (smtpEnabled && (string.IsNullOrWhiteSpace(smtpHost) || string.IsNullOrWhiteSpace(smtpFrom)))
            {
                errors.Add("SMTP_HOST and SMTP_FROM must be configured together.");
            }

            if (config.GetValue<bool>("Identity:RequireConfirmedEmail") &&
                (string.IsNullOrWhiteSpace(smtpHost) || string.IsNullOrWhiteSpace(smtpFrom)))
            {
                errors.Add("Identity:RequireConfirmedEmail=true requires SMTP_HOST and SMTP_FROM.");
            }

            var aiBaseUrl = config["AI_BASE_URL"];
            var aiApiKey = config["AI_API_KEY"];
            if (HasExactlyOne(aiBaseUrl, aiApiKey))
            {
                errors.Add("AI_BASE_URL and AI_API_KEY must be configured together.");
            }

            if (errors.Count > 0)
            {
                throw new InvalidOperationException("Invalid production configuration: " + string.Join(" ", errors));
            }
        }

        private static IEnumerable<string> SplitList(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                yield break;
            }

            foreach (var item in value.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var trimmed = item.Trim();
                if (trimmed.Length > 0)
                {
                    yield return trimmed;
                }
            }
        }

        private static bool IsLocalHost(string host)
        {
            return string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasExactlyOne(string left, string right)
        {
            return string.IsNullOrWhiteSpace(left) != string.IsNullOrWhiteSpace(right);
        }

        private static bool IsTrue(string value)
        {
            return bool.TryParse(value, out var parsed) && parsed;
        }
    }
}
