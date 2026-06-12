using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Провайдер под OpenAI-совместимый endpoint /chat/completions.
    // Выбран потому, что РУ-агрегаторы (VseGPT, ProxyAPI, OpenRouter) говорят на этом
    // формате — сервер ходит на доступный из РФ url, оплата рублями, VPN не нужен
    // ни пользователям (вызовы серверные), ни серверу.
    // Конфиг: env AI_BASE_URL + AI_API_KEY; модель — appsettings Ai:Model.
    public class OpenAiCompatibleProvider : IAiProvider
    {
        private readonly IHttpClientFactory _httpFactory;
        private readonly string _baseUrl;
        private readonly string _apiKey;
        private readonly string _model;

        public OpenAiCompatibleProvider(IHttpClientFactory httpFactory, IConfiguration config)
        {
            _httpFactory = httpFactory;
            _baseUrl = (Environment.GetEnvironmentVariable("AI_BASE_URL") ?? "").TrimEnd('/');
            _apiKey = Environment.GetEnvironmentVariable("AI_API_KEY") ?? "";
            _model = config["Ai:Model"] ?? "anthropic/claude-haiku-4-5";
        }

        public bool IsConfigured => !string.IsNullOrEmpty(_baseUrl) && !string.IsNullOrEmpty(_apiKey);

        public async Task<string> CompleteAsync(string system, string user, int maxTokens, CancellationToken ct = default)
        {
            if (!IsConfigured)
            {
                throw new InvalidOperationException("AI-провайдер не сконфигурирован (AI_BASE_URL/AI_API_KEY).");
            }

            var payload = new
            {
                model = _model,
                max_tokens = maxTokens,
                messages = new object[]
                {
                    new { role = "system", content = system },
                    new { role = "user", content = user },
                },
            };

            var http = _httpFactory.CreateClient("ai");
            using var req = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/chat/completions");
            req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + _apiKey);
            req.Content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");

            using var resp = await http.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                // Не тащим тело ответа агрегатора пользователю — только статус в лог/исключение.
                throw new HttpRequestException($"AI-провайдер ответил {(int)resp.StatusCode}.");
            }

            var json = JObject.Parse(body);
            var text = json["choices"]?[0]?["message"]?["content"]?.ToString();
            if (string.IsNullOrWhiteSpace(text))
            {
                throw new HttpRequestException("AI-провайдер вернул пустой ответ.");
            }
            return text;
        }
    }
}
