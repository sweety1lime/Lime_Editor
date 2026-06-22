using System.Collections.Generic;

namespace Lime_Editor.Models
{
    public class AdminUserRow
    {
        public int Id { get; set; }
        public string UserName { get; set; }
        public string Email { get; set; }
        public bool IsAdmin { get; set; }
        public int SitesCount { get; set; }
        public string PlanCode { get; set; } = "free"; // текущий тариф (этап 3.4)
    }

    public class AdminSiteRow
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Slug { get; set; }
        public bool IsPublished { get; set; }
        public string OwnerUserName { get; set; }
        public int OwnerId { get; set; }
        public string TemplateName { get; set; }
    }

    public class AdminDashboardModel
    {
        public int UsersTotal { get; set; }
        public int SitesTotal { get; set; }
        public int PublishedSitesTotal { get; set; }
        public int AdminsTotal { get; set; }
    }

    public class AdminUsersViewModel
    {
        public IList<AdminUserRow> Users { get; set; } = new List<AdminUserRow>();
        public IList<string> PlanCodes { get; set; } = new List<string>(); // для выпадашки выдачи тарифа
    }

    public class AdminSitesViewModel
    {
        public IList<AdminSiteRow> Sites { get; set; } = new List<AdminSiteRow>();
    }
}
