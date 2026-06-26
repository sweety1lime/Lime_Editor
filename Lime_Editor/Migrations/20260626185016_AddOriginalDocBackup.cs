using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class AddOriginalDocBackup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OriginalDocumentJson",
                table: "Sites",
                type: "text",
                unicode: false,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OriginalDocumentJson",
                table: "Sites");
        }
    }
}
