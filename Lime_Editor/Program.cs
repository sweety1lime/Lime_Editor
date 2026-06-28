using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor
{
    public class Program
    {
        public static void Main(string[] args)
        {
            // Bootstrap-логгер до построения хоста — чтобы падения на старте было видно в stdout.
            Log.Logger = new LoggerConfiguration()
                .WriteTo.Console()
                .CreateBootstrapLogger();

            try
            {
                Log.Information("Запуск Lime_Editor");
                var host = CreateHostBuilder(args).Build();
                ApplyMigrationsWithRetry(host);
                EnsureAdminInfrastructureAsync(host).GetAwaiter().GetResult();
                host.Run();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Сбой при старте приложения");
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .UseSerilog((context, services, configuration) => configuration
                    .ReadFrom.Configuration(context.Configuration)
                    .ReadFrom.Services(services)
                    .Enrich.FromLogContext()
                    // RequestId в шаблоне — чтобы correlation-id был виден прямо в консольных логах.
                    .WriteTo.Console(outputTemplate:
                        "[{Timestamp:HH:mm:ss} {Level:u3}] {RequestId} {Message:lj}{NewLine}{Exception}"))
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                });

        public const string AdminRole = "Admin";

        // Создаёт роль Admin (если её нет) и промоутит первого админа, указанного в конфиге:
        // appsettings.json -> "InitialAdmin": { "Username": "..." }
        // или env: InitialAdmin__Username=alice
        // Юзера с таким UserName должны зарегистрировать сами через /Home/SignUp; здесь только выдача роли.
        private static async Task EnsureAdminInfrastructureAsync(IHost host)
        {
            using var scope = host.Services.CreateScope();
            var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();

            if (!await roleManager.RoleExistsAsync(AdminRole))
            {
                await roleManager.CreateAsync(new IdentityRole<int>(AdminRole));
                Log.Information("Создана роль {Role}", AdminRole);
            }

            var initialAdminUsername = config["InitialAdmin:Username"];
            if (string.IsNullOrWhiteSpace(initialAdminUsername))
            {
                return;
            }

            var user = await userManager.FindByNameAsync(initialAdminUsername);
            if (user == null)
            {
                Log.Warning("InitialAdmin: пользователь {Username} не найден — зарегистрируй его через /Home/SignUp, затем перезапусти приложение", initialAdminUsername);
                return;
            }
            if (!await userManager.IsInRoleAsync(user, AdminRole))
            {
                await userManager.AddToRoleAsync(user, AdminRole);
                Log.Information("Пользователь {Username} получил роль {Role}", initialAdminUsername, AdminRole);
            }
        }

        // В docker-compose Postgres стартует медленнее приложения — даём миграциям несколько попыток.
        // Для in-memory провайдера (используется в тестах) Migrate() не поддерживается — там EnsureCreated.
        private static void ApplyMigrationsWithRetry(IHost host)
        {
            const int maxAttempts = 10;
            using var scope = host.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LimeEditorContext>();
            if (!db.Database.IsRelational())
            {
                db.Database.EnsureCreated();
                Log.Information("Не-реляционный провайдер БД — выполнен EnsureCreated()");
                return;
            }
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    db.Database.Migrate();
                    Log.Information("Миграции применены (попытка {Attempt})", attempt);
                    return;
                }
                catch (Exception ex) when (attempt < maxAttempts)
                {
                    Log.Warning(ex, "Миграции не применились, попытка {Attempt}/{Max}", attempt, maxAttempts);
                    Thread.Sleep(TimeSpan.FromSeconds(2));
                }
            }
        }
    }
}
