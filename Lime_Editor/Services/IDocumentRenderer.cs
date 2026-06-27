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
        // dataJson — JSON-карта данных коллекций { "<slug>": { fields, records } } для
        // блока collectionList (фуллстак). null/пусто — динамических блоков нет.
        // recordJson — одна запись коллекции для страницы-шаблона (CMS 2.0, /blog/:slug):
        // блоки с content.bind/bindSrc берут значения из неё. null — обычная страница.
        DocumentPage RenderPage(string documentJson, string pageSlug, string baseUrl, string dataJson = null, string recordJson = null);

        // Весь CSS документа (тема + стили всех блоков) — для идиоматичного экспорта в Next.js.
        string CompileCss(string documentJson);
    }
}
