using Lime_Editor.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using Xunit;

namespace Lime.Tests.Services
{
    public class ProductionConfigurationValidatorTests
    {
        [Fact]
        public void Validate_SkipsNonProductionEnvironment()
        {
            var config = Config();

            ProductionConfigurationValidator.Validate(Environments.Development, config);
        }

        [Fact]
        public void Validate_AllowsValidProductionConfiguration()
        {
            var config = Config(new Dictionary<string, string>
            {
                ["ConnectionStrings:connect"] = "Host=db;Database=lime;Username=lime;Password=secret",
                ["AllowedHosts"] = "lime.example.com",
                ["SMTP_HOST"] = "smtp.example.com",
                ["SMTP_FROM"] = "no-reply@lime.example.com",
                ["Identity:RequireConfirmedEmail"] = "true",
                ["AI_BASE_URL"] = "https://api.example.com/v1",
                ["AI_API_KEY"] = "secret",
            });

            ProductionConfigurationValidator.Validate(Environments.Production, config);
        }

        [Theory]
        [InlineData("")]
        [InlineData("*")]
        [InlineData("localhost")]
        [InlineData("localhost;127.0.0.1")]
        public void Validate_RejectsUnsafeProductionHosts(string allowedHosts)
        {
            var config = ValidConfig();
            config["AllowedHosts"] = allowedHosts;

            var ex = Assert.Throws<InvalidOperationException>(() =>
                ProductionConfigurationValidator.Validate(Environments.Production, config));

            Assert.Contains("AllowedHosts", ex.Message);
        }

        [Fact]
        public void Validate_RejectsMissingProductionConnectionString()
        {
            var config = ValidConfig();
            config["ConnectionStrings:connect"] = "";

            var ex = Assert.Throws<InvalidOperationException>(() =>
                ProductionConfigurationValidator.Validate(Environments.Production, config));

            Assert.Contains("ConnectionStrings:connect", ex.Message);
        }

        [Fact]
        public void Validate_RejectsConfirmedEmailWithoutSmtp()
        {
            var config = ValidConfig();
            config["Identity:RequireConfirmedEmail"] = "true";
            config["SMTP_HOST"] = "";
            config["SMTP_FROM"] = "";

            var ex = Assert.Throws<InvalidOperationException>(() =>
                ProductionConfigurationValidator.Validate(Environments.Production, config));

            Assert.Contains("RequireConfirmedEmail", ex.Message);
        }

        [Theory]
        [InlineData("smtp.example.com", "")]
        [InlineData("", "no-reply@lime.example.com")]
        public void Validate_RejectsPartialSmtpConfiguration(string host, string from)
        {
            var config = ValidConfig();
            config["SMTP_HOST"] = host;
            config["SMTP_FROM"] = from;

            var ex = Assert.Throws<InvalidOperationException>(() =>
                ProductionConfigurationValidator.Validate(Environments.Production, config));

            Assert.Contains("SMTP_HOST and SMTP_FROM", ex.Message);
        }

        [Theory]
        [InlineData("https://api.example.com/v1", "")]
        [InlineData("", "secret")]
        public void Validate_RejectsPartialAiConfiguration(string baseUrl, string apiKey)
        {
            var config = ValidConfig();
            config["AI_BASE_URL"] = baseUrl;
            config["AI_API_KEY"] = apiKey;

            var ex = Assert.Throws<InvalidOperationException>(() =>
                ProductionConfigurationValidator.Validate(Environments.Production, config));

            Assert.Contains("AI_BASE_URL and AI_API_KEY", ex.Message);
        }

        private static IConfigurationRoot ValidConfig()
        {
            return Config(new Dictionary<string, string>
            {
                ["ConnectionStrings:connect"] = "Host=db;Database=lime;Username=lime;Password=secret",
                ["AllowedHosts"] = "lime.example.com",
            });
        }

        private static IConfigurationRoot Config(Dictionary<string, string> values = null)
        {
            return new ConfigurationBuilder()
                .AddInMemoryCollection(values ?? new Dictionary<string, string>())
                .Build();
        }
    }
}
