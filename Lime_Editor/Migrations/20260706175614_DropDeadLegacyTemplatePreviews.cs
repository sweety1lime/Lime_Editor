using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class DropDeadLegacyTemplatePreviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 1,
                column: "Folder_Preview",
                value: "");

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 2,
                column: "Folder_Preview",
                value: "");

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 3,
                column: "Folder_Preview",
                value: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 1,
                column: "Folder_Preview",
                value: "/images/Template_1/Preview_1.png");

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 2,
                column: "Folder_Preview",
                value: "/images/Template_2/Template_Preview.png");

            migrationBuilder.UpdateData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 3,
                column: "Folder_Preview",
                value: "/images/Template_3/Preview.png");
        }
    }
}
