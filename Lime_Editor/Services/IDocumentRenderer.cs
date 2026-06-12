namespace Lime_Editor.Services
{
    // Серверная компиляция JSON-документа движка B в publish-HTML (этап 0.2).
    // Контракт: вывод байт-в-байт совпадает с клиентским LimeDoc.renderSite(doc),
    // потому что исполняется тот же wwwroot/js/lime/lime-doc.js.
    // Результат рендера одной страницы (этап 0.3).
    public sealed record DocumentPage(string Title, string Body);

    public interface IDocumentRenderer
    {
        // documentJson — содержимое Site.DocumentJson/PublishedDocumentJson.
        // Возвращает внутренности <body> (style + страницы), без обёртки head —
        // её добавляет PublishedPageBuilder.WrapCustomHtml.
        string RenderSite(string documentJson);

        // Рендер одной страницы с реальными URL в навигации (/u/user/slug/page).
        // null — страницы с таким slug в документе нет (→ 404).
        DocumentPage RenderPage(string documentJson, string pageSlug, string baseUrl);
    }
}
