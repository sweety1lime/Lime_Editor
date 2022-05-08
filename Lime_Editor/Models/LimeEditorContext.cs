using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

#nullable disable

namespace Lime_Editor.Models
{
    public partial class LimeEditorContext : DbContext
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
        public virtual DbSet<User> Users { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.HasAnnotation("Relational:Collation", "Cyrillic_General_CI_AS");

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

            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.IdUser)
                    .HasName("PK__User__D03DEDCB15E5FBBC");

                entity.ToTable("User");

                entity.Property(e => e.IdUser).HasColumnName("Id_User");

                entity.Property(e => e.Email)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.Login)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.Name)
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.LastName)
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.Password)
                    .IsRequired()
                    .HasMaxLength(20)
                    .IsUnicode(false);
            });

            OnModelCreatingPartial(modelBuilder);
        }

        partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
    }
}
