using HtmlAgilityPack;
using System;
using System.Linq;

namespace Lime_Editor.Services
{
    // Перед публичной отдачей убирает редакторские контролы из сохранённого HTML:
    //  - кнопки с id "del"/"del1"/"del2" (Сохранить/Скачать/Выйти и панель custom-сайта);
    //  - <script src=".../saveTemplate.js"> — публичной странице редакторский JS не нужен;
    //  - editable-маркеры (contenteditable, draggable) на всякий случай.
    public static class PublishedHtmlSanitizer
    {
        private static readonly string[] EditorControlIds = { "del", "del1", "del2" };

        public static string Sanitize(string html)
        {
            if (string.IsNullOrEmpty(html))
            {
                return html;
            }

            var doc = new HtmlDocument
            {
                OptionAutoCloseOnEnd = true,
                OptionWriteEmptyNodes = true,
            };
            doc.LoadHtml(html);

            foreach (var id in EditorControlIds)
            {
                var node = doc.GetElementbyId(id);
                node?.Remove();
            }

            // Вырезаем <script> из <body> — пользовательский JS из контента на публичной странице не нужен
            // (доверенные скрипты GSAP/рантайма лежат в <head>; произвольный код идёт через sandbox-iframe,
            // где он изолирован в srcdoc-атрибуте и сюда как DOM-узел не попадает).
            var bodyScripts = doc.DocumentNode.SelectNodes("//body//script")?.ToList();
            if (bodyScripts != null)
            {
                foreach (var s in bodyScripts) s.Remove();
            }

            // Снимаем on*-обработчики (inline JS) со всех элементов — защита от stored-XSS.
            var withAttrs = doc.DocumentNode.SelectNodes("//*[@*]")?.ToList();
            if (withAttrs != null)
            {
                foreach (var node in withAttrs)
                {
                    var onAttrs = node.Attributes
                        .Where(a => a.Name.StartsWith("on", System.StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    foreach (var a in onAttrs) a.Remove();
                }
            }

            // Снимаем contenteditable="true" на случай если кто-то открыл публичную ссылку из админки/inspect'а.
            var editable = doc.DocumentNode
                .SelectNodes("//*[@contenteditable]")
                ?.ToList();
            if (editable != null)
            {
                foreach (var n in editable)
                {
                    n.Attributes["contenteditable"].Remove();
                }
            }

            return doc.DocumentNode.OuterHtml;
        }

        // Извлекает содержимое <body> из сохранённого Folder, выкидывая редакторскую обвязку,
        // но СОХРАНЯЯ contenteditable (для повторного редактирования). Используется когда
        // существующий Custom-сайт открывается в новом конструкторе.
        public static string ExtractBodyForEditor(string html)
        {
            if (string.IsNullOrEmpty(html))
            {
                return string.Empty;
            }

            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            foreach (var id in EditorControlIds)
            {
                var node = doc.GetElementbyId(id);
                node?.Remove();
            }

            var saveScripts = doc.DocumentNode
                .SelectNodes("//script[contains(@src, 'saveTemplate.js')]")
                ?.ToList();
            if (saveScripts != null)
            {
                foreach (var s in saveScripts) s.Remove();
            }

            var body = doc.DocumentNode.SelectSingleNode("//body");
            return body != null ? body.InnerHtml : doc.DocumentNode.InnerHtml;
        }

        // Делает формы-блоки (`<form data-lime-form>`) рабочими на опубликованной странице:
        //  - проставляет action="/Form/Submit" и method="post";
        //  - вставляет скрытый __siteId (привязка заявки к сайту) и lime_ts (метка времени для timetrap).
        // Вызывается ПОСЛЕ Sanitize, при отдаче публичной страницы — id берётся из БД, а не из HTML-блоба
        // (чтобы копия/дубль сайта не унаследовала чужой id).
        public static string InjectFormEndpoints(string html, int siteId)
        {
            if (string.IsNullOrEmpty(html))
            {
                return html;
            }

            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            var forms = doc.DocumentNode.SelectNodes("//form[@data-lime-form]")?.ToList();
            if (forms == null || forms.Count == 0)
            {
                return html;
            }

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            foreach (var form in forms)
            {
                form.SetAttributeValue("action", "/Form/Submit");
                form.SetAttributeValue("method", "post");

                // Префиксом добавляем два скрытых поля. CreateNode возвращает один узел,
                // поэтому оборачиваем фрагмент и переносим его детей в начало формы.
                var fragment = HtmlNode.CreateNode("<div></div>");
                fragment.InnerHtml =
                    $"<input type=\"hidden\" name=\"__siteId\" value=\"{siteId}\">" +
                    $"<input type=\"hidden\" name=\"lime_ts\" value=\"{ts}\">";
                foreach (var child in fragment.ChildNodes.ToList())
                {
                    form.PrependChild(child);
                }
            }

            return doc.DocumentNode.OuterHtml;
        }
    }
}
