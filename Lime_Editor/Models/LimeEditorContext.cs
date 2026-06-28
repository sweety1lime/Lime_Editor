using Lime_Editor.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class LimeEditorContext : IdentityDbContext<ApplicationUser, IdentityRole<int>, int>
    {
        // Текущий пользователь для global query filter. null → фильтр отключён (аноним/фон/миграции/тесты).
        private readonly int? _currentUserId;

        public LimeEditorContext()
        {
        }

        // Единственный конструктор с DbContextOptions (иначе EF не выберет однозначно).
        // ICurrentUser необязателен: при отсутствии (тесты/фон) фильтр тенанта отключается.
        public LimeEditorContext(DbContextOptions<LimeEditorContext> options, ICurrentUser currentUser = null)
            : base(options)
        {
            _currentUserId = currentUser?.UserId;
        }

        public virtual DbSet<Site> Sites { get; set; }
        public virtual DbSet<Template> Templates { get; set; }
        public virtual DbSet<TypeTemplate> TypeTemplates { get; set; }
        public virtual DbSet<MediaAsset> MediaAssets { get; set; }
        public virtual DbSet<FormSubmission> FormSubmissions { get; set; }
        public virtual DbSet<SiteLike> SiteLikes { get; set; }
        public virtual DbSet<Plan> Plans { get; set; }
        public virtual DbSet<Subscription> Subscriptions { get; set; }
        public virtual DbSet<UsageCounter> UsageCounters { get; set; }
        public virtual DbSet<BillingEvent> BillingEvents { get; set; }
        public virtual DbSet<Collection> Collections { get; set; }
        public virtual DbSet<CollectionRecord> CollectionRecords { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Обязательно для Identity — конфигурирует таблицы AspNet*.
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<Site>(entity =>
            {
                entity.HasKey(e => e.IdSite)
                    .HasName("PK__Sites__A2DC903C1CED58AB");

                entity.Property(e => e.IdSite).HasColumnName("Id_Site");

                entity.Property(e => e.Folder)
                    .IsRequired()
                    .IsUnicode(false);

                entity.Property(e => e.DraftFolder).IsUnicode(false);
                entity.Property(e => e.DocumentJson).IsUnicode(false);
                entity.Property(e => e.PublishedDocumentJson).IsUnicode(false);
                entity.Property(e => e.OriginalDocumentJson).IsUnicode(false);
                entity.Property(e => e.MetaTitle).HasMaxLength(200);
                entity.Property(e => e.MetaDescription).HasMaxLength(400);
                entity.Property(e => e.OgImage).HasMaxLength(400);

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.UserId).HasColumnName("User_Id");

                entity.Property(e => e.TemplateId).HasColumnName("Template_Id");

                entity.Property(e => e.Slug).HasMaxLength(120).IsUnicode(false);
                entity.Property(e => e.IsPublished).HasDefaultValue(false);
                entity.Property(e => e.PublishedAt);

                // На пару (UserId, Slug) накладывается уникальность — у одного пользователя
                // не может быть двух сайтов с одинаковым slug. NULL slug разрешён множеством.
                entity.HasIndex(s => new { s.UserId, s.Slug })
                    .IsUnique()
                    .HasFilter("\"Slug\" IS NOT NULL");

                // Сайт принадлежит пользователю; при удалении пользователя его сайты удаляются.
                entity.HasOne<ApplicationUser>()
                    .WithMany()
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);

                // Tenant-изоляция в архитектуру: по умолчанию запрос видит только сайты текущего
                // пользователя — забытый "&& UserId ==" больше не утечёт чужими данными.
                // Когда пользователя нет (аноним/фон/тесты данных) — фильтр отключён.
                // Легитимные кросс-тенантные чтения (публичный показ /u, галерея, админка,
                // sitemap, приём публичных форм) явно вызывают IgnoreQueryFilters().
                // Сравнение через nullable (== _currentUserId, без .Value) — иначе InMemory-провайдер
                // вычисляет .Value при null и падает «Nullable object must have a value».
                entity.HasQueryFilter(s => _currentUserId == null || s.UserId == _currentUserId);
            });

            modelBuilder.Entity<Template>(entity =>
            {
                entity.HasKey(e => e.IdTemplate)
                    .HasName("PK__Template__8F91BE5EDFE8DD90");

                entity.Property(e => e.IdTemplate).HasColumnName("Id_Template");

                entity.Property(e => e.FolderPreview)
                    .IsRequired()
                    .IsUnicode(false)
                    .HasColumnName("Folder_Preview");

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.TypeId).HasColumnName("Type_Id");
            });

            modelBuilder.Entity<TypeTemplate>(entity =>
            {
                entity.HasKey(e => e.IdType)
                    .HasName("PK__Type_Tem__1A20A3D5996588A6");

                entity.ToTable("Type_Templates");

                entity.Property(e => e.IdType).HasColumnName("Id_Type");

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);
            });

            modelBuilder.Entity<MediaAsset>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.OriginalName).IsRequired().HasMaxLength(255);
                entity.Property(e => e.StoredFileName).IsRequired().HasMaxLength(80);
                entity.Property(e => e.ContentType).HasMaxLength(120);
                entity.HasIndex(e => e.UserId);

                // Удаление пользователя удаляет его медиа (файлы на диске чистятся отдельно при удалении).
                entity.HasOne<ApplicationUser>()
                    .WithMany()
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<FormSubmission>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.DataJson).IsRequired();
                entity.Property(e => e.IpAddress).HasMaxLength(64);
                entity.HasIndex(e => e.SiteId);

                // Заявка принадлежит сайту; при удалении сайта его заявки удаляются.
                entity.HasOne<Site>()
                    .WithMany()
                    .HasForeignKey(e => e.SiteId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            // ===== Биллинг/тарифы (этап 3.4) =====
            modelBuilder.Entity<Plan>(entity =>
            {
                entity.HasKey(e => e.Code);
                entity.Property(e => e.Code).HasMaxLength(32);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Currency).HasMaxLength(8);
                entity.Property(e => e.PriceMonthly).HasPrecision(10, 2);
            });

            modelBuilder.Entity<Subscription>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.PlanCode).IsRequired().HasMaxLength(32);
                entity.Property(e => e.Provider).HasMaxLength(40);
                // Один активный план на владельца.
                entity.HasIndex(e => new { e.OwnerKind, e.OwnerId }).IsUnique();
                entity.HasOne<Plan>()
                    .WithMany()
                    .HasForeignKey(e => e.PlanCode)
                    .OnDelete(DeleteBehavior.Restrict);
                // OwnerId — не FK (может быть юзер или воркспейс); чистим подписки юзера в коде при удалении.
            });

            modelBuilder.Entity<UsageCounter>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Meter).IsRequired().HasMaxLength(40);
                // Один счётчик на (владелец, метр, месяц).
                entity.HasIndex(e => new { e.OwnerKind, e.OwnerId, e.Meter, e.PeriodStart }).IsUnique();
            });

            modelBuilder.Entity<BillingEvent>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Provider).IsRequired().HasMaxLength(40);
                entity.Property(e => e.ProviderEventId).IsRequired().HasMaxLength(200);
                entity.Property(e => e.Status).HasMaxLength(20);
                // Идемпотентность: повтор того же события провайдера отсекается уникальным индексом.
                entity.HasIndex(e => new { e.Provider, e.ProviderEventId }).IsUnique();
            });

            modelBuilder.Entity<SiteLike>(entity =>
            {
                entity.HasKey(e => e.Id);
                // Один лайк на пару (сайт, пользователь).
                entity.HasIndex(e => new { e.SiteId, e.UserId }).IsUnique();
                entity.HasOne<Site>()
                    .WithMany()
                    .HasForeignKey(e => e.SiteId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasOne<ApplicationUser>()
                    .WithMany()
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            // Коллекции данных (фуллстак). Принадлежат сайту; каскад при удалении сайта.
            modelBuilder.Entity<Collection>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Slug).IsRequired().HasMaxLength(120);
                entity.Property(e => e.SchemaJson).IsRequired();
                // У одного сайта slug коллекции уникален.
                entity.HasIndex(e => new { e.SiteId, e.Slug }).IsUnique();
                entity.HasOne<Site>()
                    .WithMany()
                    .HasForeignKey(e => e.SiteId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<CollectionRecord>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.DataJson).IsRequired();
                entity.HasIndex(e => e.CollectionId);
                entity.HasOne<Collection>()
                    .WithMany()
                    .HasForeignKey(e => e.CollectionId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            // Стартовые данные: 1 тип + 3 шаблона (Id совпадает со значением meta "templateId" в Template_{1,2,3}.cshtml).
            modelBuilder.Entity<TypeTemplate>().HasData(
                new TypeTemplate { IdType = 1, Name = "Landing" }
            );

            modelBuilder.Entity<Template>().HasData(
                new Template { IdTemplate = 1, Name = "Ruby",        FolderPreview = "/images/Template_1/Preview_1.png",        TypeId = 1 },
                new Template { IdTemplate = 2, Name = "Sublime",     FolderPreview = "/images/Template_2/Template_Preview.png", TypeId = 1 },
                new Template { IdTemplate = 3, Name = "Coming Soon", FolderPreview = "/images/Template_3/Preview.png",          TypeId = 1 },
                // Id = 4 — псевдо-шаблон "Custom", на нём строятся сайты из "Создать сайт".
                new Template { IdTemplate = 4, Name = "Custom",      FolderPreview = "/images/cover-1.jpg",                     TypeId = 1 }
            );

            // Тарифы (этап 3.4). Free.MonthlyAiCredits совпадает с прежней квотой Ai:MonthlyFreeQuota.
            // Лимит -1 = безлимит. Платежей пока нет — Pro/Business выдаются вручную (админ).
            modelBuilder.Entity<Plan>().HasData(
                new Plan { Code = "free",     Name = "Free",     Description = "Старт: попробовать конструктор.",        PriceMonthly = 0m,    Currency = "RUB", MaxSites = 3,  MonthlyAiCredits = 10,   MaxStorageMb = 100,   MaxCustomDomains = 0,  AllowExport = false, AllowCustomCode = false, FeaturesJson = "{}" },
                new Plan { Code = "pro",      Name = "Pro",      Description = "Для фрилансеров: домены, экспорт, больше AI.", PriceMonthly = 790m,  Currency = "RUB", MaxSites = 25, MonthlyAiCredits = 300,  MaxStorageMb = 5120,  MaxCustomDomains = 3,  AllowExport = true,  AllowCustomCode = true,  FeaturesJson = "{}" },
                new Plan { Code = "business", Name = "Business", Description = "Студии и команды: максимум лимитов.",       PriceMonthly = 2490m, Currency = "RUB", MaxSites = -1, MonthlyAiCredits = 2000, MaxStorageMb = 51200, MaxCustomDomains = 25, AllowExport = true,  AllowCustomCode = true,  FeaturesJson = "{}" }
            );

            OnModelCreatingPartial(modelBuilder);
        }

        partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
    }
}
