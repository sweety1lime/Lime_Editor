using Lime_Editor.Models;
using Lime_Editor.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor
{
    public class Startup
    {
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddDbContext<LimeEditorContext>(x => x.UseNpgsql(Configuration.GetConnectionString("connect")));

            services.AddIdentity<ApplicationUser, IdentityRole<int>>(options =>
            {
                options.Password.RequiredLength = 6;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireDigit = false;
                options.User.RequireUniqueEmail = true;
                options.SignIn.RequireConfirmedAccount = false; // подтверждение email добавим позже
            })
                .AddEntityFrameworkStores<LimeEditorContext>()
                .AddDefaultTokenProviders();

            services.ConfigureApplicationCookie(options =>
            {
                options.LoginPath = "/Home/SignIn";
                options.AccessDeniedPath = "/Home/SignIn";
                options.LogoutPath = "/Home/Logout";
            });

            services.AddDistributedMemoryCache();
            services.AddSession();
            // Разрешаем XHR-вызовам присылать токен в заголовке X-CSRF-TOKEN.
            services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");
            services.AddSingleton<ITemplateExportService, TemplateExportService>();
            services.AddSingleton<NextExportService>(); // «eject» в Next.js (Итерация 4)
            services.AddSingleton<IImageProcessor, ImageSharpProcessor>();
            // Серверная компиляция JSON-документов движка B (этап 0.2): singleton кэширует
            // исходник lime-doc.js, Jint-движок создаётся на каждый RenderSite.
            services.AddSingleton<IDocumentRenderer, JsDocumentRenderer>();
            // AI-генерация (этап 2): OpenAI-совместимый агрегатор (доступен из РФ),
            // конфиг через env AI_BASE_URL/AI_API_KEY + appsettings Ai:*.
            services.AddHttpClient("ai", c => c.Timeout = TimeSpan.FromSeconds(120));
            services.AddSingleton<IAiProvider, OpenAiCompatibleProvider>();
            services.AddSingleton<AiContentService>();
            // Прокси фотостока (Фаза 1): ключ через env STOCK_PEXELS_KEY. Сервер ходит
            // в Pexels, отдаёт фронту тот же формат, что /Media/ApiList.
            services.AddHttpClient("stock", c => c.Timeout = TimeSpan.FromSeconds(20));
            services.AddHostedService<OrphanMediaCleanupService>();
            services.AddHealthChecks()
                .AddDbContextCheck<LimeEditorContext>("database");
            services.AddControllersWithViews();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
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
            app.UseStaticFiles();

            app.UseRouting();

            app.UseAuthentication();
            app.UseAuthorization();
            app.UseSession();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapHealthChecks("/health");
                // Публичный хостинг сайтов: /u/{username}/{slug}[/{page}] → PublishedSiteController.Show.
                // Префикс "u" выбран чтобы не конфликтовать с {controller}/{action}.
                // {page?} — страница многостраничного сайта движка B (этап 0.3).
                endpoints.MapControllerRoute(
                    name: "publishedSite",
                    pattern: "u/{username}/{slug}/{page?}",
                    defaults: new { controller = "PublishedSite", action = "Show" });
                endpoints.MapControllerRoute(
                    name: "default",
                    pattern: "{controller=Home}/{action=Index}/{id?}");
            });
        }
    }
}
