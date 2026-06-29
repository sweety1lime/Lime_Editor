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

        // Кастомный код в <head> (этап 0.2): владелец вставляет верификации, мета-теги, шрифты,
        // глобальные <style>/<link>. Пока публикации живут на одном origin с Identity-cookie
        // (отдельный домен публикаций — этап 0.6), произвольный <script> = stored-XSS, поэтому
        // здесь whitelist БЕЗОПАСНЫХ тегов: meta, link, style. Скрипты/iframe/base и on*-атрибуты
        // вырезаются. Аналитика-скрипты разблокируются после 0.6.
        private static readonly System.Collections.Generic.HashSet<string> HeadAllowedTags =
            new(System.StringComparer.OrdinalIgnoreCase) { "meta", "link", "style" };

        private static bool IsSafeHeadUrl(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.StartsWith("//"))
            {
                return false;
            }

            if (Uri.TryCreate(value, UriKind.Absolute, out var uri))
            {
                return uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps;
            }

            var firstSpecial = value.IndexOfAny(new[] { '/', '?', '#' });
            var firstColon = value.IndexOf(':');
            return firstColon < 0 || (firstSpecial >= 0 && firstColon > firstSpecial);
        }

        public static string SanitizeHead(string headHtml)
        {
            if (string.IsNullOrWhiteSpace(headHtml))
            {
                return string.Empty;
            }

            var doc = new HtmlDocument { OptionWriteEmptyNodes = true };
            doc.LoadHtml(headHtml);

            var sb = new System.Text.StringBuilder();
            foreach (var node in doc.DocumentNode.ChildNodes)
            {
                if (node.NodeType != HtmlNodeType.Element) continue;
                if (!HeadAllowedTags.Contains(node.Name)) continue;
                if (node.Name.Equals("meta", System.StringComparison.OrdinalIgnoreCase) &&
                    node.GetAttributeValue("http-equiv", "").Equals("refresh", System.StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                // Снимаем on*-обработчики на разрешённых тегах (на <style> их нет, но <link>/<meta> могут нести).
                var onAttrs = node.Attributes
                    .Where(a => a.Name.StartsWith("on", System.StringComparison.OrdinalIgnoreCase))
                    .ToList();
                foreach (var a in onAttrs) a.Remove();

                // <link> только безопасных видов: rel должен быть из набора (никаких import как вектор).
                if (node.Name.Equals("link", System.StringComparison.OrdinalIgnoreCase))
                {
                    var rel = node.GetAttributeValue("rel", "").ToLowerInvariant();
                    var okRel = rel.Contains("stylesheet") || rel.Contains("preconnect") ||
                                rel.Contains("dns-prefetch") || rel.Contains("preload") ||
                                rel.Contains("icon") || rel.Contains("manifest");
                    if (!okRel) continue;
                    if (!IsSafeHeadUrl(node.GetAttributeValue("href", ""))) continue;
                }

                sb.Append(node.OuterHtml).Append('\n');
            }
            return sb.ToString();
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
