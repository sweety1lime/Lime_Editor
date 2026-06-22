using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class AddBilling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // AiUsages переносится в UsageCounters и дропается в конце Up (после создания таблицы).

            migrationBuilder.CreateTable(
                name: "BillingEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ProviderEventId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "text", nullable: true),
                    Payload = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Error = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Plans",
                columns: table => new
                {
                    Code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    PriceMonthly = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    MaxSites = table.Column<int>(type: "integer", nullable: false),
                    MonthlyAiCredits = table.Column<int>(type: "integer", nullable: false),
                    MaxStorageMb = table.Column<int>(type: "integer", nullable: false),
                    MaxCustomDomains = table.Column<int>(type: "integer", nullable: false),
                    AllowExport = table.Column<bool>(type: "boolean", nullable: false),
                    AllowCustomCode = table.Column<bool>(type: "boolean", nullable: false),
                    FeaturesJson = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Plans", x => x.Code);
                });

            migrationBuilder.CreateTable(
                name: "UsageCounters",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OwnerKind = table.Column<byte>(type: "smallint", nullable: false),
                    OwnerId = table.Column<int>(type: "integer", nullable: false),
                    Meter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Used = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsageCounters", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Subscriptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OwnerKind = table.Column<byte>(type: "smallint", nullable: false),
                    OwnerId = table.Column<int>(type: "integer", nullable: false),
                    PlanCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<byte>(type: "smallint", nullable: false),
                    CurrentPeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CurrentPeriodEnd = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelAtPeriodEnd = table.Column<bool>(type: "boolean", nullable: false),
                    Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ExternalCustomerId = table.Column<string>(type: "text", nullable: true),
                    ExternalSubscriptionId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Subscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Subscriptions_Plans_PlanCode",
                        column: x => x.PlanCode,
                        principalTable: "Plans",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "Plans",
                columns: new[] { "Code", "AllowCustomCode", "AllowExport", "Currency", "Description", "FeaturesJson", "MaxCustomDomains", "MaxSites", "MaxStorageMb", "MonthlyAiCredits", "Name", "PriceMonthly" },
                values: new object[,]
                {
                    { "business", true, true, "RUB", "Студии и команды: максимум лимитов.", "{}", 25, -1, 51200, 2000, "Business", 2490m },
                    { "free", false, false, "RUB", "Старт: попробовать конструктор.", "{}", 0, 3, 100, 10, "Free", 0m },
                    { "pro", true, true, "RUB", "Для фрилансеров: домены, экспорт, больше AI.", "{}", 3, 25, 5120, 300, "Pro", 790m }
                });

            migrationBuilder.CreateIndex(
                name: "IX_BillingEvents_Provider_ProviderEventId",
                table: "BillingEvents",
                columns: new[] { "Provider", "ProviderEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Subscriptions_OwnerKind_OwnerId",
                table: "Subscriptions",
                columns: new[] { "OwnerKind", "OwnerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Subscriptions_PlanCode",
                table: "Subscriptions",
                column: "PlanCode");

            migrationBuilder.CreateIndex(
                name: "IX_UsageCounters_OwnerKind_OwnerId_Meter_PeriodStart",
                table: "UsageCounters",
                columns: new[] { "OwnerKind", "OwnerId", "Meter", "PeriodStart" },
                unique: true);

            // Перенос истории квот AI: AiUsages → UsageCounters (метр "ai", владелец = User).
            // Источник имел уникальность (UserId, PeriodStart) → дублей в (0, UserId, 'ai', PeriodStart) нет.
            migrationBuilder.Sql(@"INSERT INTO ""UsageCounters"" (""OwnerKind"", ""OwnerId"", ""Meter"", ""PeriodStart"", ""Used"")
SELECT 0, ""UserId"", 'ai', ""PeriodStart"", ""Used"" FROM ""AiUsages"";");

            migrationBuilder.DropTable(
                name: "AiUsages");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BillingEvents");

            migrationBuilder.DropTable(
                name: "Subscriptions");

            migrationBuilder.DropTable(
                name: "UsageCounters");

            migrationBuilder.DropTable(
                name: "Plans");

            migrationBuilder.CreateTable(
                name: "AiUsages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Used = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiUsages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiUsages_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiUsages_UserId_PeriodStart",
                table: "AiUsages",
                columns: new[] { "UserId", "PeriodStart" },
                unique: true);
        }
    }
}
