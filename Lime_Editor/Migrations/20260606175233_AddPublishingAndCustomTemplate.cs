using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class AddPublishingAndCustomTemplate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Sites_User_Id",
                table: "Sites");

            migrationBuilder.AddColumn<bool>(
                name: "IsPublished",
                table: "Sites",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAt",
                table: "Sites",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Slug",
                table: "Sites",
                type: "character varying(120)",
                unicode: false,
                maxLength: 120,
                nullable: true);

            migrationBuilder.InsertData(
                table: "Templates",
                columns: new[] { "Id_Template", "Folder_Preview", "Name", "Type_Id" },
                values: new object[] { 4, "/images/cover-1.jpg", "Custom", 1 });

            migrationBuilder.CreateIndex(
                name: "IX_Sites_User_Id_Slug",
                table: "Sites",
                columns: new[] { "User_Id", "Slug" },
                unique: true,
                filter: "\"Slug\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Sites_User_Id_Slug",
                table: "Sites");

            migrationBuilder.DeleteData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 4);

            migrationBuilder.DropColumn(
                name: "IsPublished",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "PublishedAt",
                table: "Sites");

            migrationBuilder.DropColumn(
                name: "Slug",
                table: "Sites");

            migrationBuilder.CreateIndex(
                name: "IX_Sites_User_Id",
                table: "Sites",
                column: "User_Id");
        }
    }
}
