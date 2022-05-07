using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    public class TemplateController : Controller
    {
        // GET: TemplateController
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
