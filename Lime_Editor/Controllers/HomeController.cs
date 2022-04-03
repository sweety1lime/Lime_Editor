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

            var currentHtml = "<!DOCTYPE html> \n " +
                "<html lang=\"ru_RU\"> " +
                "\n <head> \n " +
                "<meta charset=\"utf - 8\"> \n" +
                "<meta name=\"viewport\" content=\"width = device - width, initial - scale = 1.0\"> \n" +
                "<title>Тестовый</title> \n" +
                "<link href=\"css/bootstrap.min.css\" rel=\"stylesheet\"/> \n" +
                "<link href=\"css/bootstrap.css\" rel=\"stylesheet\"/> \n" +
                "<link href=\"css/mainMeow.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/responsive.css\" rel=\"stylesheet\" \n/>" +
                "<link href=\"css/Themes.css\" rel=\"stylesheet\" \n/>" +
                "</head> \n" +
                "<body> \n" +
                html+
                "\n </body> \n" +
                "</html>";
            currentHtml = currentHtml.Replace("/images", "images");
            currentHtml = currentHtml.Replace("contenteditable=\"true\"", "contenteditable=\"false\"");
            string directory = System.Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + @"\Тестовые проекты";
            if (!System.IO.Directory.Exists(directory))
                System.IO.Directory.CreateDirectory(directory);
            System.IO.File.WriteAllText(directory + @"\test.html", currentHtml);
            Directory.CreateDirectory(directory + "\\css");
            Directory.CreateDirectory(directory + "\\images");
            string[] reqiredCss = new[] { "bootstrap.min.css", "bootstrap.css", "mainMeow.css", "responsive.css" , "Themes.css" };
            string[] filePaths = Directory.GetFiles(_environment.WebRootPath + "\\css\\main\\"); //файл2.css, файл3.css, файл4.css
            foreach (var filePath in filePaths)
            {
                if (reqiredCss.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newPath = directory+ "\\css\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newPath, true);
                    }
                }

            }

            string[] pathImg = Directory.GetFiles(_environment.WebRootPath + "\\images\\"); //файл2.css, файл3.css, файл4.css
            foreach (var filePath in pathImg)
            {
                if (html.Contains(filePath.Substring(filePath.LastIndexOf("\\") + 1)))
                {
                    string path = filePath;
                    string newPath = directory + "\\images\\" + filePath.Substring(filePath.LastIndexOf("\\") + 1);
                    FileInfo fileInf = new FileInfo(path);
                    if (fileInf.Exists)
                    {
                        fileInf.CopyTo(newPath, true);
                    }
                }

            }

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
