using Lime_Editor.Controllers;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using System;
using System.Linq;
using System.Reflection;
using Xunit;

namespace Lime.Tests.Integration
{
    public class SecurityConfigurationTests : IClassFixture<WebFactory>
    {
        private readonly WebFactory _factory;

        public SecurityConfigurationTests(WebFactory factory) => _factory = factory;

        [Fact]
        public void ApplicationCookie_UsesExplicitSecuritySettings()
        {
            using var scope = _factory.Services.CreateScope();
            var options = scope.ServiceProvider
                .GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
                .Get(IdentityConstants.ApplicationScheme);

            Assert.True(options.Cookie.HttpOnly);
            Assert.Equal(SameSiteMode.Lax, options.Cookie.SameSite);
            Assert.Equal(CookieSecurePolicy.SameAsRequest, options.Cookie.SecurePolicy);
            Assert.Equal(TimeSpan.FromHours(8), options.ExpireTimeSpan);
            Assert.True(options.SlidingExpiration);
        }

        [Fact]
        public void SessionAndAntiforgeryCookies_UseExplicitSecuritySettings()
        {
            using var scope = _factory.Services.CreateScope();
            var session = scope.ServiceProvider.GetRequiredService<IOptions<SessionOptions>>().Value;
            var antiforgery = scope.ServiceProvider.GetRequiredService<IOptions<AntiforgeryOptions>>().Value;

            Assert.Equal(TimeSpan.FromMinutes(30), session.IdleTimeout);
            Assert.True(session.Cookie.HttpOnly);
            Assert.Equal(SameSiteMode.Lax, session.Cookie.SameSite);
            Assert.Equal(CookieSecurePolicy.SameAsRequest, session.Cookie.SecurePolicy);

            Assert.Equal("X-CSRF-TOKEN", antiforgery.HeaderName);
            Assert.True(antiforgery.Cookie.HttpOnly);
            Assert.Equal(SameSiteMode.Lax, antiforgery.Cookie.SameSite);
            Assert.Equal(CookieSecurePolicy.SameAsRequest, antiforgery.Cookie.SecurePolicy);
        }

        [Fact]
        public void FormOptions_LimitMultipartUploadsBeforeAction()
        {
            using var scope = _factory.Services.CreateScope();
            var options = scope.ServiceProvider.GetRequiredService<IOptions<FormOptions>>().Value;

            Assert.Equal(MediaUploadSecurity.MaxUploadRequestBytes, options.MultipartBodyLengthLimit);
        }

        [Fact]
        public void UploadAndPublicSubmit_HaveRequestSizeLimits()
        {
            var upload = typeof(MediaController).GetMethod(nameof(MediaController.Upload));
            var submit = typeof(FormController).GetMethod(nameof(FormController.Submit));
            var webhook = typeof(BillingController).GetMethod(nameof(BillingController.Webhook));

            AssertRequestSizeLimit(upload, MediaUploadSecurity.MaxUploadRequestBytes);
            AssertRequestSizeLimit(submit, 64 * 1024);
            AssertRequestSizeLimit(webhook, 64 * 1024);
        }

        [Fact]
        public void SensitivePostActions_HaveExplicitSecurityAttributes()
        {
            var restoreOriginal = typeof(HomeController).GetMethod(nameof(HomeController.RestoreOriginal));
            var webhook = typeof(BillingController).GetMethod(nameof(BillingController.Webhook));

            AssertHasAttribute(restoreOriginal, typeof(AuthorizeAttribute));

            AssertHasAttribute(webhook, typeof(AllowAnonymousAttribute));
            AssertHasAttribute(webhook, typeof(IgnoreAntiforgeryTokenAttribute));
            var rateLimit = webhook.CustomAttributes.Single(a => a.AttributeType == typeof(EnableRateLimitingAttribute));
            Assert.Equal("public-write", rateLimit.ConstructorArguments.Single().Value);
        }

        private static void AssertRequestSizeLimit(MethodInfo method, long expectedBytes)
        {
            var attr = method.CustomAttributes.Single(a => a.AttributeType == typeof(RequestSizeLimitAttribute));
            Assert.Equal(expectedBytes, attr.ConstructorArguments.Single().Value);
        }

        private static void AssertHasAttribute(MethodInfo method, Type attributeType)
        {
            Assert.Contains(method.CustomAttributes, a => a.AttributeType == attributeType);
        }
    }
}
