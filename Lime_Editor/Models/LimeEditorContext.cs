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
                    .HasName("PK__Sites__A2DC903CF456388F");

                entity.Property(e => e.IdSite).HasColumnName("Id_Site");

                entity.Property(e => e.Folder)
                    .IsRequired()
                    .IsUnicode(false);

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.TypeId).HasColumnName("Type_Id");

                entity.Property(e => e.UserId).HasColumnName("User_Id");

                entity.HasOne(d => d.Type)
                    .WithMany(p => p.Sites)
                    .HasForeignKey(d => d.TypeId)
                    .OnDelete(DeleteBehavior.ClientSetNull)
                    .HasConstraintName("FK__Sites__Type_Id__571DF1D5");

                entity.HasOne(d => d.User)
                    .WithMany(p => p.Sites)
                    .HasForeignKey(d => d.UserId)
                    .OnDelete(DeleteBehavior.ClientSetNull)
                    .HasConstraintName("FK__Sites__User_Id__5629CD9C");
            });

            modelBuilder.Entity<Template>(entity =>
            {
                entity.HasKey(e => e.IdTemplate)
                    .HasName("PK__Template__8F91BE5EAA169E15");

                entity.Property(e => e.IdTemplate).HasColumnName("Id_Template");

                entity.Property(e => e.FolderPreview)
                    .IsRequired()
                    .IsUnicode(false)
                    .HasColumnName("Folder_Preview");

                entity.Property(e => e.FolderTemplate)
                    .IsRequired()
                    .IsUnicode(false)
                    .HasColumnName("Folder_Template");

                entity.Property(e => e.Name)
                    .IsRequired()
                    .HasMaxLength(100)
                    .IsUnicode(false);

                entity.Property(e => e.TypeId).HasColumnName("Type_Id");

                entity.HasOne(d => d.Type)
                    .WithMany(p => p.Templates)
                    .HasForeignKey(d => d.TypeId)
                    .OnDelete(DeleteBehavior.ClientSetNull)
                    .HasConstraintName("FK__Templates__Type___534D60F1");
            });

            modelBuilder.Entity<TypeTemplate>(entity =>
            {
                entity.HasKey(e => e.IdType)
                    .HasName("PK__Type_Tem__1A20A3D5233A9D9D");

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
                    .HasName("PK__User__D03DEDCB18817026");

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
