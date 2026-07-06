using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Lime_Editor.Migrations
{
    /// <inheritdoc />
    public partial class AddGitHubDeployments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GitHubConnections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    GitHubUserId = table.Column<long>(type: "bigint", nullable: false),
                    Login = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    AccessTokenProtected = table.Column<string>(type: "text", nullable: false),
                    Scope = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    TokenType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revoked = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GitHubConnections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GitHubConnections_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GitHubSiteDeployments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SiteId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Mode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Owner = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Repo = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RepoId = table.Column<long>(type: "bigint", nullable: true),
                    Branch = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Style = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    LastCommitSha = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    LastPushedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    VercelProjectId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    VercelUrl = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GitHubSiteDeployments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GitHubSiteDeployments_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GitHubSiteDeployments_Sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "Sites",
                        principalColumn: "Id_Site",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GitHubConnections_GitHubUserId",
                table: "GitHubConnections",
                column: "GitHubUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GitHubConnections_UserId_Kind",
                table: "GitHubConnections",
                columns: new[] { "UserId", "Kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GitHubSiteDeployments_SiteId_Mode",
                table: "GitHubSiteDeployments",
                columns: new[] { "SiteId", "Mode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GitHubSiteDeployments_UserId",
                table: "GitHubSiteDeployments",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GitHubConnections");

            migrationBuilder.DropTable(
                name: "GitHubSiteDeployments");
        }
    }
}
