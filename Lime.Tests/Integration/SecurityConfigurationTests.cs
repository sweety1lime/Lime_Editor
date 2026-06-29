using Lime_Editor.Controllers;
using Lime_Editor.Models;
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
            var cspReport = typeof(SecurityController).GetMethod(nameof(SecurityController.CspReport));

            AssertRequestSizeLimit(upload, MediaUploadSecurity.MaxUploadRequestBytes);
            AssertRequestSizeLimit(submit, RequestBodyLimits.PublicFormBytes);
            AssertRequestSizeLimit(webhook, RequestBodyLimits.WebhookBytes);
            AssertRequestSizeLimit(cspReport, SecurityController.MaxCspReportBytes);
        }

        [Fact]
        public void EditorExportAndAiPostActions_HaveRequestSizeLimits()
        {
            AssertRequestSizeLimit(
                typeof(HomeController).GetMethod(nameof(HomeController.EditTemplatesPost)),
                RequestBodyLimits.EditorDocumentBytes);
            AssertRequestSizeLimit(
                typeof(TemplateController).GetMethod(nameof(TemplateController.DownloadSite)),
                RequestBodyLimits.EditorDocumentBytes);
            AssertRequestSizeLimit(
                typeof(AiController).GetMethod(nameof(AiController.Generate)),
                RequestBodyLimits.AiSmallBytes);
            AssertRequestSizeLimit(
                typeof(AiController).GetMethod(nameof(AiController.Rewrite)),
                RequestBodyLimits.AiMediumBytes);
            AssertRequestSizeLimit(
                typeof(AiController).GetMethod(nameof(AiController.EditBlock)),
                RequestBodyLimits.AiLargeBytes);
            AssertRequestSizeLimit(
                typeof(AiController).GetMethod(nameof(AiController.Suggest)),
                RequestBodyLimits.AiLargeBytes);
        }

        [Fact]
        public void DataPostActions_HaveRequestSizeLimits()
        {
            AssertSmallFormLimit(typeof(DataController).GetMethod(nameof(DataController.Create)));
            AssertRequestSizeLimit(
                typeof(DataController).GetMethod(nameof(DataController.CreateWithAi)),
                RequestBodyLimits.AiSmallBytes);
            AssertSmallFormLimit(typeof(DataController).GetMethod(nameof(DataController.AddField)));
            AssertSmallFormLimit(typeof(DataController).GetMethod(nameof(DataController.RemoveField)));
            AssertSmallFormLimit(typeof(DataController).GetMethod(nameof(DataController.DeleteCollection)));
            AssertRequestSizeLimit(
                typeof(DataController).GetMethod(nameof(DataController.AddRecord)),
                RequestBodyLimits.DataFormBytes);
            AssertSmallFormLimit(typeof(DataController).GetMethod(nameof(DataController.DeleteRecord)));
        }

        [Fact]
        public void SmallAuthenticatedPostActions_HaveRequestSizeLimits()
        {
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.UpdateSite)));
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.DeleteSite)));
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.RestoreOriginal)));
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.Publish)));
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.Unpublish)));
            AssertSmallFormLimit(typeof(HomeController).GetMethod(nameof(HomeController.ChangeName)));

            AssertSmallFormLimit(typeof(CommunityController).GetMethod(nameof(CommunityController.Like)));
            AssertSmallFormLimit(typeof(CommunityController).GetMethod(nameof(CommunityController.Clone)));
            AssertSmallFormLimit(typeof(CommunityController).GetMethod(nameof(CommunityController.ToggleGallery)));
            AssertSmallFormLimit(typeof(FormController).GetMethod(nameof(FormController.DeleteSubmission)));
            AssertSmallFormLimit(typeof(MediaController).GetMethod(nameof(MediaController.Delete)));

            AssertSmallFormLimit(typeof(AdminController).GetMethod(nameof(AdminController.RepublishAll)));
            AssertSmallFormLimit(typeof(AdminController).GetMethod(nameof(AdminController.SetPlan)));
            AssertSmallFormLimit(typeof(AdminController).GetMethod(nameof(AdminController.ToggleAdmin)));
            AssertSmallFormLimit(typeof(AdminController).GetMethod(nameof(AdminController.DeleteUser)));
            AssertSmallFormLimit(typeof(AdminController).GetMethod(nameof(AdminController.DeleteSite)));
        }

        [Fact]
        public void AccountPostActions_HaveRequestSizeLimits()
        {
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.SignIn),
                new[] { typeof(LoginModel) }));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(nameof(AccountController.LogoutPost)));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.ForgotPassword),
                new[] { typeof(string) }));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.ResetPassword),
                new[] { typeof(string), typeof(string), typeof(string) }));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.SignUp),
                new[] { typeof(RegisterViewModel) }));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.EditProfile),
                new[] { typeof(ProfileViewModel) }));
            AssertSmallFormLimit(typeof(AccountController).GetMethod(
                nameof(AccountController.DeleteMyAccount),
                new[] { typeof(string) }));
        }

        [Fact]
        public void HeavyExportActions_HaveRateLimits()
        {
            AssertRateLimit(typeof(ExportController).GetMethod(nameof(ExportController.Nextjs)), "export");
            AssertRateLimit(typeof(TemplateController).GetMethod(nameof(TemplateController.DownloadSite)), "export");
            AssertRateLimit(typeof(AccountController).GetMethod(nameof(AccountController.ExportMyData)), "export");
        }

        [Fact]
        public void SensitivePostActions_HaveExplicitSecurityAttributes()
        {
            var restoreOriginal = typeof(HomeController).GetMethod(nameof(HomeController.RestoreOriginal));
            var webhook = typeof(BillingController).GetMethod(nameof(BillingController.Webhook));
            var cspReport = typeof(SecurityController).GetMethod(nameof(SecurityController.CspReport));

            AssertHasAttribute(restoreOriginal, typeof(AuthorizeAttribute));

            AssertHasAttribute(webhook, typeof(AllowAnonymousAttribute));
            AssertHasAttribute(webhook, typeof(IgnoreAntiforgeryTokenAttribute));
            AssertRateLimit(webhook, "public-write");

            AssertHasAttribute(cspReport, typeof(AllowAnonymousAttribute));
            AssertHasAttribute(cspReport, typeof(IgnoreAntiforgeryTokenAttribute));
            AssertRateLimit(cspReport, "public-write");
        }

        private static void AssertRequestSizeLimit(MethodInfo method, long expectedBytes)
        {
            var attr = method.CustomAttributes.Single(a => a.AttributeType == typeof(RequestSizeLimitAttribute));
            Assert.Equal(expectedBytes, attr.ConstructorArguments.Single().Value);
        }

        private static void AssertSmallFormLimit(MethodInfo method)
        {
            AssertRequestSizeLimit(method, RequestBodyLimits.SmallFormBytes);
        }

        private static void AssertRateLimit(MethodInfo method, string expectedPolicy)
        {
            var attr = method.CustomAttributes.Single(a => a.AttributeType == typeof(EnableRateLimitingAttribute));
            Assert.Equal(expectedPolicy, attr.ConstructorArguments.Single().Value);
        }

        private static void AssertHasAttribute(MethodInfo method, Type attributeType)
        {
            Assert.Contains(method.CustomAttributes, a => a.AttributeType == attributeType);
        }
    }
}
