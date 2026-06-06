using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class LimeEditorContext : IdentityDbContext<ApplicationUser, IdentityRole<int>, int>
    {
        public LimeEditorContext()
        {
        }

        public LimeEditorContext(DbContextOptions<LimeEditorContext> options)
            : base(options)
        {
        }

        public virtual DbSet<Site> Sites { get; set; }
        public virtual DbSet<Template> Templates { get; set; }
        public virtual DbSet<TypeTemplate> TypeTemplates { get; set; }

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

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.UserId).HasColumnName("User_Id");

                entity.Property(e => e.TemplateId).HasColumnName("Template_Id");

                // Сайт принадлежит пользователю; при удалении пользователя его сайты удаляются.
                entity.HasOne<ApplicationUser>()
                    .WithMany()
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
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

            OnModelCreatingPartial(modelBuilder);
        }

        partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
    }
}
