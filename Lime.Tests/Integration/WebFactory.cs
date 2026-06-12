using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Linq;

namespace Lime.Tests.Integration
{
    // Подменяет реальный Npgsql DbContext на InMemory — тесты не зависят от внешнего Postgres.
    // Один экземпляр БД на фабрику (Guid в имени), внутри тестов можно очищать/наполнять.
    public sealed class WebFactory : WebApplicationFactory<Lime_Editor.Program>
    {
        private readonly string _dbName = "limetest_" + Guid.NewGuid().ToString("N");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Test");
            builder.ConfigureServices(services =>
            {
                var descriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(DbContextOptions<LimeEditorContext>));
                if (descriptor != null) services.Remove(descriptor);

                services.AddDbContext<LimeEditorContext>(o =>
                    o.UseInMemoryDatabase(_dbName));
            });
        }
    }
}
