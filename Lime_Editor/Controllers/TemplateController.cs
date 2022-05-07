using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    public class TemplateController : Controller
    {
        private readonly IWebHostEnvironment _environment;

        public TemplateController(IWebHostEnvironment IHostingEnvironment)
        {
            _environment = IHostingEnvironment;
        }
       
        public ActionResult PageToEdit()
        {
            if (HttpContext.Session.Keys.Contains("SiteData"))
            {
                var siteJson = HttpContext.Session.GetString("SiteData");
                var site = (Site)JsonConvert.DeserializeObject(siteJson, typeof(Site));
                return View(site);
            }

            return View();
        }
        
        public ActionResult Template_1()
        {
            return View();
        }
        public ActionResult Template_1_Preview()
        {
            return View();
        }
    }
}
