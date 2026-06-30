using System;
using System.IO;
using Xunit;

namespace Lime.Tests.Integration
{
    public class DeploymentConfigTests
    {
        private static string RepoRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Lime_Editor.sln")))
            {
                dir = dir.Parent;
            }

            Assert.NotNull(dir);
            return dir.FullName;
        }

        private static string ReadRootFile(string relativePath) =>
            File.ReadAllText(Path.Combine(RepoRoot(), relativePath));

        [Fact]
        public void EnvExample_DoesNotShipDefaultDatabasePassword()
        {
            var env = ReadRootFile(".env.example");

            Assert.Contains("POSTGRES_PASSWORD=", env);
            Assert.DoesNotContain("POSTGRES_PASSWORD=changeme", env, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("IDENTITY_REQUIRE_CONFIRMED_EMAIL=false", env);
        }

        [Fact]
        public void GitIgnore_KeepsLocalEnvFilesOutOfGit()
        {
            var gitignore = ReadRootFile(".gitignore");

            Assert.Contains(".env", gitignore);
            Assert.Contains(".env.*", gitignore);
            Assert.Contains("!.env.example", gitignore);
        }

        [Fact]
        public void ProductionCompose_PassesDocumentedRuntimeSecretsToApp()
        {
            var compose = ReadRootFile("compose.prod.yml");

            Assert.Contains("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?", compose);
            Assert.Contains("ConnectionStrings__connect:", compose);
            Assert.Contains("AllowedHosts: ${DOMAIN:?", compose);
            Assert.Contains("ForwardedHeaders__TrustAll: ${FORWARDED_HEADERS_TRUST_ALL:-true}", compose);
            Assert.Contains("ForwardedHeaders__KnownProxies: ${FORWARDED_HEADERS_KNOWN_PROXIES:-}", compose);
            Assert.Contains("ForwardedHeaders__KnownNetworks: ${FORWARDED_HEADERS_KNOWN_NETWORKS:-}", compose);
            Assert.Contains("Identity__RequireConfirmedEmail: ${IDENTITY_REQUIRE_CONFIRMED_EMAIL:-false}", compose);
            Assert.Contains("AI_BASE_URL: ${AI_BASE_URL:-}", compose);
            Assert.Contains("AI_API_KEY: ${AI_API_KEY:-}", compose);
            Assert.Contains("STOCK_PEXELS_KEY: ${STOCK_PEXELS_KEY:-}", compose);
            Assert.Contains("SMTP_HOST: ${SMTP_HOST:-}", compose);
            Assert.Contains("SMTP_PASSWORD: ${SMTP_PASSWORD:-}", compose);
        }

        [Fact]
        public void SecurityDoc_CoversProductionChecklistAndExternalBlockers()
        {
            var security = ReadRootFile("SECURITY.md");

            Assert.Contains("AllowedHosts", security);
            Assert.Contains("POSTGRES_PASSWORD", security);
            Assert.Contains("FORWARDED_HEADERS_TRUST_ALL", security);
            Assert.Contains("FORWARDED_HEADERS_KNOWN_PROXIES", security);
            Assert.Contains("Identity__RequireConfirmedEmail=true", security);
            Assert.Contains("SMTP_HOST", security);
            Assert.Contains("SMTP_FROM", security);
            Assert.Contains("AI_API_KEY", security);
            Assert.Contains("STOCK_PEXELS_KEY", security);
            Assert.Contains("Redis", security);
            Assert.Contains("S3/R2", security);
            Assert.Contains("Error tracking", security);
            Assert.Contains("dotnet test Lime_Editor.sln", security);
            Assert.Contains("dotnet list Lime_Editor.sln package --vulnerable --include-transitive", security);
            Assert.Contains("npm audit --audit-level=moderate", security);
        }
    }
}
