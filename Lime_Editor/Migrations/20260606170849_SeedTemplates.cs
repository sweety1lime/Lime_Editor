using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class SeedTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "Templates",
                columns: new[] { "Id_Template", "Folder_Preview", "Name", "Type_Id" },
                values: new object[,]
                {
                    { 1, "/images/Template_1/Preview_1.png", "Ruby", 1 },
                    { 2, "/images/Template_2/Template_Preview.png", "Sublime", 1 },
                    { 3, "/images/Template_3/Preview.png", "Coming Soon", 1 }
                });

            migrationBuilder.InsertData(
                table: "Type_Templates",
                columns: new[] { "Id_Type", "Name" },
                values: new object[] { 1, "Landing" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 1);

            migrationBuilder.DeleteData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 2);

            migrationBuilder.DeleteData(
                table: "Templates",
                keyColumn: "Id_Template",
                keyValue: 3);

            migrationBuilder.DeleteData(
                table: "Type_Templates",
                keyColumn: "Id_Type",
                keyValue: 1);
        }
    }
}
