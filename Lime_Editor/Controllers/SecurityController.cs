using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Lime_Editor.Controllers
{
    [Route("Security")]
    public class SecurityController : Controller
    {
        public const int MaxCspReportBytes = 16 * 1024;

        private readonly ILogger<SecurityController> _logger;

        public SecurityController(ILogger<SecurityController> logger)
        {
            _logger = logger;
        }

        [AllowAnonymous]
        [HttpPost("CspReport")]
        [IgnoreAntiforgeryToken]
        [RequestSizeLimit(MaxCspReportBytes)]
        [EnableRateLimiting("public-write")]
        public async Task<IActionResult> CspReport()
        {
            if (Request.ContentLength == 0)
            {
                return Ok();
            }

            string body;
            using (var reader = new StreamReader(Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096))
            {
                body = await reader.ReadToEndAsync();
            }

            if (string.IsNullOrWhiteSpace(body))
            {
                return Ok();
            }

            try
            {
                var token = JToken.Parse(body);
                foreach (var report in ExtractReports(token).Take(5))
                {
                    _logger.LogInformation(
                        "CSP violation report: directive={Directive} blocked={BlockedUri} document={DocumentUri} source={SourceFile}",
                        Clean(report["violated-directive"] ?? report["effective-directive"] ?? report["effectiveDirective"]),
                        Clean(report["blocked-uri"] ?? report["blockedURL"]),
                        Clean(report["document-uri"] ?? report["documentURL"]),
                        Clean(report["source-file"] ?? report["sourceFile"]));
                }
            }
            catch (JsonException)
            {
                _logger.LogDebug("Ignoring malformed CSP report payload.");
            }

            return Ok();
        }

        private static IEnumerable<JObject> ExtractReports(JToken token)
        {
            if (token is JArray array)
            {
                foreach (var item in array)
                {
                    foreach (var report in ExtractReports(item))
                    {
                        yield return report;
                    }
                }
                yield break;
            }

            if (token is not JObject obj)
            {
                yield break;
            }

            if (obj["csp-report"] is JObject classic)
            {
                yield return classic;
                yield break;
            }

            if (obj["body"] is JObject reportingApiBody)
            {
                yield return reportingApiBody;
            }
        }

        private static string Clean(JToken token)
        {
            var value = token?.ToString() ?? "";
            if (Uri.TryCreate(value, UriKind.Absolute, out var uri))
            {
                value = uri.GetLeftPart(UriPartial.Path);
            }

            value = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
            return value.Length <= 200 ? value : value.Substring(0, 200);
        }
    }
}
