using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    // Абстракция LLM-провайдера (этап 2). Сегодня — один OpenAI-совместимый агрегатор
    // (VseGPT/OpenRouter/ProxyAPI), завтра — маршрутизация по тарифам: free → дешёвая
    // модель, платный → сильнее. Смена провайдера/модели = конфиг, не код.
    public interface IAiProvider
    {
        // false, если AI_API_KEY не задан — фичи AI выключены, кнопки отвечают «не настроено».
        bool IsConfigured { get; }

        // Один chat-completion вызов: system + user → текст ответа модели.
        Task<string> CompleteAsync(string system, string user, int maxTokens, CancellationToken ct = default);
    }
}
