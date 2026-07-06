using Lime_Editor.Auth;
using Lime_Editor.Controllers;
using Lime_Editor.Middleware;
using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading.RateLimiting;
using System.Threading.Tasks;

namespace Lime_Editor
{
    public class Startup
    {
        private readonly IWebHostEnvironment _environment;

        public Startup(IConfiguration configuration, IWebHostEnvironment environment)
        {
            Configuration = configuration;
            _environment = environment;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            // Текущий пользователь запроса — для EF global query filter (изоляция тенантов).
            // Контекст БД инжектит ICurrentUser и фильтрует Site по владельцу автоматически.
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUser, CurrentUser>();

            services.AddDbContext<LimeEditorContext>(x => x.UseNpgsql(Configuration.GetConnectionString("connect")));

            services.AddIdentity<ApplicationUser, IdentityRole<int>>(options =>
            {
                // Парольная политика продукта: минимум 8 символов и хотя бы одна цифра.
                // Заглавные/спецсимволы НЕ требуем намеренно — не выталкиваем пользователей в
                // менеджеры паролей на ровном месте, но 8+цифра отсекает тривиальные пароли.
                options.Password.RequiredLength = 8;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireDigit = true;
                options.User.AllowedUserNameCharacters = UserNamePolicy.AllowedCharacters;
                options.User.RequireUniqueEmail = true;
                // Подтверждение email: код готов (письмо шлётся при регистрации, есть ConfirmEmail).
                // Enforcement включается флагом Identity:RequireConfirmedEmail — после подключения
                // боевого SMTP. По умолчанию false, чтобы dev/без-почты не блокировал вход.
                options.SignIn.RequireConfirmedAccount = Configuration.GetValue<bool>("Identity:RequireConfirmedEmail");
                // Защита от брутфорса: PasswordSignInAsync вызывается с lockoutOnFailure: true,
                // поэтому эти настройки реально применяются. 5 неудач → блок на 15 минут.
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.Lockout.AllowedForNewUsers = true;
            })
                .AddEntityFrameworkStores<LimeEditorContext>()
                .AddDefaultTokenProviders();

            services.ConfigureApplicationCookie(options =>
            {
                options.LoginPath = "/Home/SignIn";
                options.AccessDeniedPath = "/Home/SignIn";
                options.LogoutPath = "/Home/Logout";
                // HttpOnly уже дефолт. SecurePolicy=SameAsRequest (дефолт) + ForwardedHeaders ниже:
                // за TLS-прокси схема становится https → cookie помечается Secure в проде,
                // а в dev/тестах по http остаётся обычной (иначе авторизация бы не работала).
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.ExpireTimeSpan = TimeSpan.FromHours(8);
                options.SlidingExpiration = true;
            });

            // Reverse-proxy headers are accepted only from explicitly configured trusted proxies.
            // The bundled Docker compose opts into TrustAll because the app service is not published.
            services.Configure<ForwardedHeadersOptions>(ConfigureForwardedHeaders);

            services.Configure<FormOptions>(options =>
            {
                options.MultipartBodyLengthLimit = MediaUploadSecurity.MaxUploadRequestBytes;
            });

            services.AddDistributedMemoryCache();
            services.AddSession(options =>
            {
                options.IdleTimeout = TimeSpan.FromMinutes(30);
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            });
            // Разрешаем XHR-вызовам присылать токен в заголовке X-CSRF-TOKEN.
            services.AddAntiforgery(o =>
            {
                o.HeaderName = "X-CSRF-TOKEN";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Lax;
                o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            });
            var dataProtection = services.AddDataProtection();
            var dataProtectionKeysPath = Configuration["DataProtection:KeysPath"];
            if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
            {
                dataProtection.PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));
            }
            else if (_environment.IsEnvironment("Test"))
            {
                var testKeysPath = Path.Combine(Path.GetTempPath(), "Lime_Editor", "DataProtection-Keys");
                Directory.CreateDirectory(testKeysPath);
                dataProtection.PersistKeysToFileSystem(new DirectoryInfo(testKeysPath));
            }
            services.AddSingleton<ITemplateExportService, TemplateExportService>();
            services.AddSingleton<NextExportService>(); // «eject» в Next.js (Итерация 4)
            services.AddSingleton<IImageProcessor, ImageSharpProcessor>();
            // Хранилище медиа за абстракцией (Фаза 5): дефолт — локальный диск. Позже здесь
            // подключится S3/R2 без правок контроллеров. Singleton: зависит только от IWebHostEnvironment.
            services.AddSingleton<IMediaStorage, LocalDiskMediaStorage>();
            // Транзакционные письма (восстановление пароля). SMTP через env (SMTP_*),
            // без него — лог-режим (см. EmailSender). Singleton: состояние только из env.
            services.AddSingleton<IEmailSender, EmailSender>();
            // Серверная компиляция JSON-документов движка B (этап 0.2): singleton кэширует
            // исходник lime-doc.js, Jint-движок создаётся на каждый RenderSite.
            services.AddSingleton<IDocumentRenderer, JsDocumentRenderer>();
            // AI-генерация (этап 2): OpenAI-совместимый агрегатор (доступен из РФ),
            // конфиг через env AI_BASE_URL/AI_API_KEY + appsettings Ai:*.
            services.AddHttpClient("ai", c => c.Timeout = TimeSpan.FromSeconds(120));
            services.AddSingleton<IAiProvider, OpenAiCompatibleProvider>();
            services.AddSingleton<AiContentService>();
            services.AddHttpClient("github-oauth", c =>
            {
                c.BaseAddress = new Uri("https://github.com/");
                c.Timeout = TimeSpan.FromSeconds(30);
                c.DefaultRequestHeaders.UserAgent.ParseAdd("Lime-Editor/1.0");
            });
            services.AddHttpClient("github", c =>
            {
                c.BaseAddress = new Uri("https://api.github.com/");
                c.Timeout = TimeSpan.FromSeconds(60);
                c.DefaultRequestHeaders.UserAgent.ParseAdd("Lime-Editor/1.0");
                c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
                c.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            });
            services.AddSingleton<GitHubApiClient>();
            services.AddScoped<GitHubDeploymentService>();
            // Тарифы/лимиты (этап 3.4): scoped — работает с LimeEditorContext.
            services.AddScoped<IEntitlementService, EntitlementService>();
            services.AddScoped<ISiteService, SiteService>();
            // Платёжный провайдер (пока ручной) + идемпотентный приём вебхуков.
            services.AddSingleton<IPaymentProvider, ManualPaymentProvider>();
            services.AddScoped<IBillingService, BillingService>();
            // Прокси фотостока (Фаза 1): ключ через env STOCK_PEXELS_KEY. Сервер ходит
            // в Pexels, отдаёт фронту тот же формат, что /Media/ApiList.
            services.AddHttpClient("stock", c => c.Timeout = TimeSpan.FromSeconds(20));
            services.AddHostedService<OrphanMediaCleanupService>();
            services.AddHealthChecks()
                .AddDbContextCheck<LimeEditorContext>("database");

            // MCP/AI-agent API (Wave 1 п.5): персональные токены + инструменты list/get/apply.
            // Схема "ApiToken" — ДОПОЛНИТЕЛЬНАЯ к cookie-схеме Identity (default остаётся ею же,
            // AddIdentity уже её выставил) — не переопределяем DefaultScheme, только регистрируем.
            services.AddScoped<ApiTokenService>();
            services.AddSingleton<IDocumentCommandEngine, JsCommandEngine>();
            services.AddAuthentication()
                .AddScheme<AuthenticationSchemeOptions, ApiTokenAuthenticationHandler>(
                    ApiTokenAuthenticationHandler.SchemeName, null);
            services.AddMcpServer()
                .WithHttpTransport(o => o.Stateless = true)
                .WithToolsFromAssembly();

            // Anti-CSRF safe-by-default: каждый небезопасный метод (POST/PUT/DELETE) требует токен,
            // кроме помеченных [IgnoreAntiforgeryToken] (вебхук провайдера, публичная форма).
            // Так новые POST-экшены защищены автоматически, а не «не забыть навесить атрибут».
            services.AddControllersWithViews(o =>
                o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));

            // Rate limiting (этап безопасности): троттлинг по IP/пользователю на чувствительные
            // эндпоинты. Брутфорс логина (в пару к Identity-lockout), спам публичных форм, burst
            // дорогих AI-вызовов (поверх квоты тарифа). Применяется атрибутом [EnableRateLimiting].
            // IP берётся после ForwardedHeaders → за прокси это реальный клиент, а не прокси.
            services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

                options.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    ClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));

                options.AddPolicy("public-write", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    ClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));

                options.AddPolicy("upload", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    UserOrClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));

                options.AddPolicy("ai", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    UserOrClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));

                options.AddPolicy("export", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    UserOrClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1) }));

                options.AddPolicy("external-api", ctx => RateLimitPartition.GetFixedWindowLimiter(
                    UserOrClientKey(ctx),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
            });
        }

        // Ключ партиции лимитера: IP клиента (после ForwardedHeaders — реальный, не прокси).
        private static string ClientKey(HttpContext ctx) =>
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        private void ConfigureForwardedHeaders(ForwardedHeadersOptions options)
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            var forwardLimit = Configuration.GetValue<int?>("ForwardedHeaders:ForwardLimit");
            options.ForwardLimit = forwardLimit.HasValue && forwardLimit.Value > 0 ? forwardLimit.Value : 1;

            // TrustAll is for closed Docker-network deployments where only the reverse proxy is public.
            // Other deployments should set KnownProxies or KnownNetworks instead.
            if (Configuration.GetValue<bool>("ForwardedHeaders:TrustAll"))
            {
                options.KnownNetworks.Clear();
                options.KnownProxies.Clear();
                return;
            }

            foreach (var proxy in SplitConfigList(Configuration["ForwardedHeaders:KnownProxies"]))
            {
                options.KnownProxies.Add(ParseIpAddress(proxy, "ForwardedHeaders:KnownProxies"));
            }

            foreach (var network in SplitConfigList(Configuration["ForwardedHeaders:KnownNetworks"]))
            {
                options.KnownNetworks.Add(ParseIpNetwork(network, "ForwardedHeaders:KnownNetworks"));
            }
        }

        private static IEnumerable<string> SplitConfigList(string value)
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

        private static IPAddress ParseIpAddress(string value, string key)
        {
            if (IPAddress.TryParse(value, out var address))
            {
                return address;
            }

            throw new InvalidOperationException($"{key} contains invalid IP address '{value}'.");
        }

        private static Microsoft.AspNetCore.HttpOverrides.IPNetwork ParseIpNetwork(string value, string key)
        {
            var parts = value.Split('/');
            if (parts.Length == 2 &&
                IPAddress.TryParse(parts[0], out var prefix) &&
                int.TryParse(parts[1], out var prefixLength))
            {
                return new Microsoft.AspNetCore.HttpOverrides.IPNetwork(prefix, prefixLength);
            }

            throw new InvalidOperationException($"{key} contains invalid CIDR network '{value}'.");
        }

        // Для AI: по пользователю, если аутентифицирован (иначе IP) — лимит на аккаунт, не на NAT.
        private static string UserOrClientKey(HttpContext ctx) =>
            ctx.User?.Identity?.IsAuthenticated == true
                ? "u:" + ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                : "ip:" + ClientKey(ctx);

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            // Самым первым — чтобы все последующие middleware видели исходную схему/IP от прокси.
            app.UseForwardedHeaders();

            // Сразу после — correlation-id: все логи запроса (и заголовки/ошибки) несут RequestId.
            app.UseLimeRequestCorrelation();

            // Security-заголовки — на все ответы (включая статику и страницы ошибок).
            // Строгий CSP вешается только на публичную отдачу /u (см. middleware).
            app.UseLimeSecurityHeaders();

            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
                // HTTPS-редирект — только локально. В контейнере за reverse-proxy (Caddy/Nginx)
                // приложение слушает plain HTTP, TLS делает proxy.
                app.UseHttpsRedirection();
            }
            else
            {
                app.UseExceptionHandler("/Home/Error");
                app.UseHsts();
            }
            app.UseStaticFiles(new StaticFileOptions
            {
                OnPrepareResponse = ctx =>
                {
                    // Загруженные медиа хранятся под GUID-именами (MediaController) — контент по URL
                    // не меняется никогда, поэтому год + immutable: повторные визиты опубликованных
                    // сайтов не перекачивают hero-картинки (LCP-бюджет showcase-страниц).
                    if (ctx.Context.Request.Path.StartsWithSegments("/" + MediaController.MediaFolder))
                    {
                        ctx.Context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                    }
                }
            });

            app.UseRouting();

            app.UseAuthentication();
            app.UseAuthorization();
            // После авторизации — чтобы AI-политика партиционировала по пользователю.
            app.UseRateLimiter();
            app.UseSession();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapHealthChecks("/health");
                // Публичный хостинг сайтов: /u/{username}/{slug}[/{page}] → PublishedSiteController.Show.
                // Префикс "u" выбран чтобы не конфликтовать с {controller}/{action}.
                // {page?} — страница многостраничного сайта движка B (этап 0.3).
                // SEO/AEO (этап 3.6): карты сайта для поисковиков и AI-краулеров. Литеральные
                // сегменты — специфичнее {page?}, поэтому регистрируем ПЕРЕД общими маршрутами.
                endpoints.MapControllerRoute(
                    name: "publishedSitemap",
                    pattern: "u/{username}/{slug}/sitemap.xml",
                    defaults: new { controller = "PublishedSite", action = "Sitemap" });
                endpoints.MapControllerRoute(
                    name: "publishedLlms",
                    pattern: "u/{username}/{slug}/llms.txt",
                    defaults: new { controller = "PublishedSite", action = "LlmsTxt" });
                // Динамическая страница записи (CMS 2.0): /u/{user}/{slug}/{page}/{record}
                // → страница-шаблон, привязанная к коллекции, рендерится для одной записи.
                endpoints.MapControllerRoute(
                    name: "publishedRecord",
                    pattern: "u/{username}/{slug}/{page}/{record}",
                    defaults: new { controller = "PublishedSite", action = "ShowRecord" });
                endpoints.MapControllerRoute(
                    name: "publishedSite",
                    pattern: "u/{username}/{slug}/{page?}",
                    defaults: new { controller = "PublishedSite", action = "Show" });
                endpoints.MapControllerRoute(
                    name: "default",
                    pattern: "{controller=Home}/{action=Index}/{id?}");
                // MCP/AI-agent API: только по персональному Bearer-токену (схема "ApiToken",
                // НЕ cookie-сессия); "external-api" — уже существовавшая, но нигде не
                // использовавшаяся политика троттлинга (30/мин на пользователя) — заведена
                // явно под такой случай, переиспользуем как есть.
                endpoints.MapMcp("/mcp")
                    .RequireAuthorization(policy => policy
                        .AddAuthenticationSchemes(ApiTokenAuthenticationHandler.SchemeName)
                        .RequireAuthenticatedUser())
                    .RequireRateLimiting("external-api");
            });
        }
    }
}
