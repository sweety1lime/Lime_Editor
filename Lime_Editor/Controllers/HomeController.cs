using Lime_Editor.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http.Headers;

namespace Lime_Editor.Controllers
{
    public class HomeController : Controller
    {
        private readonly IWebHostEnvironment _environment;
        public HomeController(IWebHostEnvironment IHostingEnvironment)
        {
            _environment = IHostingEnvironment;
        }

        public IActionResult Index()
        {
            return View();
        }

        public IActionResult SignIn()
        {
            return View();
        }

        public IActionResult SignUp()
        {
            return View();
        }

        public IActionResult MySites()
        {
            return View();
        }

        public IActionResult Templates()
        {
            return View();
        }

        [HttpPost]
        public IActionResult EditTemplatesPost(string html)
        {
            System.IO.File.WriteAllText("test.txt", html);

            Debug.WriteLine(html);

            return Ok();
        }

        public IActionResult EditTemplates()
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            return View(imageModel);
        }

        [HttpPost]
        public IActionResult EditTemplates(string name)
        {
            var imageModel = new ImageModel { UrlImage = "/images/cover-1.jpg" };
            if (HttpContext.Request.Form.Files != null)
            {
                var file = HttpContext.Request.Form.Files.First();
                if (file.Length > 0)
                {
                    string fileName = ContentDispositionHeaderValue.Parse(file.ContentDisposition).FileName.Trim('"');

                    var myUniqueFileName = Convert.ToString(Guid.NewGuid());
                    var FileExtension = Path.GetExtension(fileName);
                    string newFileName = myUniqueFileName + FileExtension;
                    fileName = Path.Combine(_environment.WebRootPath, "demoimages") + $@"\{newFileName}";

                    using (FileStream fs = System.IO.File.Create(fileName))
                    {
                        file.CopyTo(fs);
                        fs.Flush();
                    }
                    imageModel.UrlImage = $"/demoimages/{newFileName}";
                }
            }
            return View(imageModel);
        }

        public IActionResult Profile()
        {
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
