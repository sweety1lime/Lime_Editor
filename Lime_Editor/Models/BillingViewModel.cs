using System.Collections.Generic;

namespace Lime_Editor.Models
{
    // Страница /Billing: текущий тариф пользователя + использование + список планов.
    public class BillingViewModel
    {
        public Plan Plan { get; set; }
        public int AiUsed { get; set; }
        public int AiLimit { get; set; }
        public int SitesUsed { get; set; }
        public long StorageUsedMb { get; set; }
        public IList<Plan> AllPlans { get; set; } = new List<Plan>();
    }
}
