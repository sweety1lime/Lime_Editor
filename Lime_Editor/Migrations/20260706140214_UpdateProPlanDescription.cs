using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class UpdateProPlanDescription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Plans",
                keyColumn: "Code",
                keyValue: "pro",
                column: "Description",
                value: "Для фрилансеров: экспорт кода, свой CSS и больше AI.");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "Plans",
                keyColumn: "Code",
                keyValue: "pro",
                column: "Description",
                value: "Для фрилансеров: домены, экспорт, больше AI.");
        }
    }
}
