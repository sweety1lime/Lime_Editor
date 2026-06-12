/*
 * Lime Constructor — модульный редактор страниц.
 *
 * Архитектура: DOM-first. State == содержимое #lime-workspace. SortableJS перетасовывает
 * DOM, контрол-классы (.is-selected, .lime-block-grip) при сохранении вырезаются.
 *
 * Совместимость: legacy DemoGenerator.js / saveTemplate.js не подключаются. Старые сохранённые
 * сайты редактируются через legacy PageToEdit (см. TemplateController.PageToEdit).
 */
(function () {
    "use strict";

    var ws = document.getElementById("lime-workspace");
    if (!ws) return;

    var saveBtn = document.querySelector("[data-save-action]");
    var downloadBtn = document.querySelector("[data-download-action]");
    var siteId = saveBtn ? (saveBtn.dataset.siteId || "") : "";

    function csrfToken() {
        var m = document.querySelector('meta[name="X-CSRF-TOKEN"]');
        return m ? m.content : "";
    }

    function uuid() {
        return "b" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    }

    // ===== BLOCKS LIBRARY =====
    // Each entry: id, name, icon, html-template (string returning block content innerHTML).
    var BLOCKS = {
        cover: {
            name: "Обложка",
            icon: "▢",
            category: "basic",
            template: function () {
                return '<div class="lime-block__cover" data-bg="">' +
                    '<div class="lime-block__cover-uptitle" contenteditable="true">Your brand</div>' +
                    '<h1 class="lime-block__cover-title" contenteditable="true">Заголовок страницы<br>в две строки</h1>' +
                    '<p class="lime-block__cover-desc" contenteditable="true">Короткое описание о том, чем вы помогаете клиентам.</p>' +
                    '<a href="#" class="lime-block__cover-cta" contenteditable="true">Начать &rarr;</a>' +
                    '</div>';
            }
        },
        heading: {
            name: "Заголовок",
            icon: "T",
            category: "basic",
            template: function () {
                return '<h2 class="lime-block__heading" contenteditable="true">Раздел</h2>';
            }
        },
        text: {
            name: "Текст",
            icon: "¶",
            category: "basic",
            template: function () {
                return '<p class="lime-block__text" contenteditable="true">Здесь история, описание услуги, абзац о компании. Кликни и редактируй.</p>';
            }
        },
        cta: {
            name: "CTA",
            icon: "◉",
            category: "basic",
            template: function () {
                return '<div class="lime-block__cta">' +
                    '<h3 contenteditable="true">Готов начать?</h3>' +
                    '<p contenteditable="true">Опиши предложение в одной строке.</p>' +
                    '<a href="#" class="lime-block__cta-btn" contenteditable="true">Действие &rarr;</a>' +
                    '</div>';
            }
        },
        features: {
            name: "Фичи",
            icon: "✦",
            category: "basic",
            template: function () {
                var card = function (icon, title, desc) {
                    return '<div class="lime-block__feature">' +
                        '<div class="lime-block__feature-icon">' + icon + '</div>' +
                        '<h4 class="lime-block__feature-title" contenteditable="true">' + title + '</h4>' +
                        '<p class="lime-block__feature-desc" contenteditable="true">' + desc + '</p>' +
                        '</div>';
                };
                return '<div class="lime-block__features">' +
                    card("⚡", "Быстро", "Запуск за минуты, не за дни.") +
                    card("🎨", "Стильно", "Современные шаблоны на любой вкус.") +
                    card("🔒", "Надёжно", "Шифрование, бэкапы, доступность 24/7.") +
                    '</div>';
            }
        },
        gallery: {
            name: "Галерея",
            icon: "▦",
            category: "advanced",
            template: function () {
                var placeholder = '<div class="lime-block__gallery-item" data-lime-pick-image>+ выбрать</div>';
                return '<div class="lime-block__gallery">' + placeholder + placeholder + placeholder + '</div>';
            }
        },
        pricing: {
            name: "Цены",
            icon: "$",
            category: "advanced",
            template: function () {
                var card = function (name, price, items) {
                    var lis = items.map(function (i) { return '<li contenteditable="true">' + i + '</li>'; }).join("");
                    return '<div class="lime-block__price-card">' +
                        '<h4 contenteditable="true">' + name + '</h4>' +
                        '<div class="price" contenteditable="true">' + price + '</div>' +
                        '<ul>' + lis + '</ul>' +
                        '<a href="#" class="lime-btn lime-btn--soft" contenteditable="true">Выбрать</a>' +
                        '</div>';
                };
                return '<div class="lime-block__pricing">' +
                    card("Старт", "₽0", ["1 сайт", "Базовая поддержка", "Subdomain"]) +
                    card("Pro", "₽490/мес", ["10 сайтов", "Приоритетная поддержка", "Свой домен"]) +
                    card("Команда", "₽1 290/мес", ["Безлимит", "Team workspace", "SLA 99.9%"]) +
                    '</div>';
            }
        },
        contact: {
            name: "Форма",
            icon: "✉",
            category: "advanced",
            // Рабочая форма приёма заявок. action/__siteId/lime_ts проставляет сервер при отдаче
            // опубликованной страницы (PublishedSiteController). lime_hp — honeypot против ботов.
            // Названия полей (name="Имя"…) становятся ключами в инбоксе заявок.
            template: function () {
                return '<form class="lime-block__contact" data-lime-form id="lime-form" novalidate>' +
                    '<h3 contenteditable="true" style="text-align:center;margin-bottom:16px;">Связаться</h3>' +
                    '<div class="lime-form-hp" aria-hidden="true" style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;">' +
                        '<label>Не заполняйте это поле<input type="text" name="lime_hp" tabindex="-1" autocomplete="off"></label>' +
                    '</div>' +
                    '<label contenteditable="true">Имя</label><input type="text" name="Имя" placeholder="Иван" required>' +
                    '<label contenteditable="true">Email</label><input type="email" name="Email" placeholder="you@example.com" required>' +
                    '<label contenteditable="true">Телефон</label><input type="tel" name="Телефон" placeholder="+7 900 000-00-00">' +
                    '<label contenteditable="true">Сообщение</label><textarea name="Сообщение" rows="4" placeholder="Расскажите о проекте..."></textarea>' +
                    '<button type="submit" class="lime-block__cta-btn" style="display:block;width:100%;text-align:center;border:0;cursor:pointer;" contenteditable="true">Отправить</button>' +
                    '</form>';
            }
        },
        video: {
            name: "Видео",
            icon: "▶",
            category: "advanced",
            template: function () {
                return '<div class="lime-block__video">' +
                    '<div class="lime-block__video-placeholder" data-lime-set-video>' +
                    '+ Вставь ссылку YouTube' +
                    '</div></div>';
            }
        },
        spacer: {
            name: "Отступ",
            icon: "↕",
            category: "basic",
            template: function () { return '<div class="lime-block__spacer"></div>'; }
        },

        navbar: {
            name: "Навбар",
            icon: "≡",
            category: "layout",
            template: function () {
                var link = function (t) { return '<a href="#" contenteditable="true">' + t + '</a>'; };
                return '<nav class="lime-block__navbar">' +
                    '<div class="lime-block__navbar-brand" contenteditable="true">Моя компания</div>' +
                    '<div class="lime-block__navbar-links">' +
                        link("Главная") + link("О нас") + link("Услуги") + link("Контакты") +
                    '</div>' +
                    '<a href="#" class="lime-block__navbar-cta" contenteditable="true">Начать</a>' +
                    '</nav>';
            }
        },
        footer: {
            name: "Футер",
            icon: "▭",
            category: "layout",
            template: function () {
                var col = function (title, items) {
                    var lis = items.map(function (t) { return '<li><a href="#" contenteditable="true">' + t + '</a></li>'; }).join("");
                    return '<div class="lime-block__footer-col">' +
                        '<h5 contenteditable="true">' + title + '</h5>' +
                        '<ul>' + lis + '</ul>' +
                        '</div>';
                };
                return '<footer class="lime-block__footer">' +
                    '<div class="lime-block__footer-cols">' +
                        col("Компания", ["О нас", "Команда", "Карьера"]) +
                        col("Продукт", ["Возможности", "Цены", "FAQ"]) +
                        col("Связь", ["Email", "Telegram", "GitHub"]) +
                    '</div>' +
                    '<div class="lime-block__footer-bottom" contenteditable="true">© 2026 Моя компания. Все права защищены.</div>' +
                    '</footer>';
            }
        },
        twoCol: {
            name: "2 колонки",
            icon: "▥",
            category: "layout",
            template: function () {
                return '<div class="lime-block__two-col">' +
                    '<div contenteditable="true"><h3>Левая колонка</h3><p>Текст слева. Можно использовать для описания, изображения или формы.</p></div>' +
                    '<div contenteditable="true"><h3>Правая колонка</h3><p>Текст справа. Можно использовать для деталей, фичей или CTA.</p></div>' +
                    '</div>';
            }
        },
        testimonials: {
            name: "Отзывы",
            icon: "❝",
            category: "advanced",
            template: function () {
                var card = function (quote, author, role) {
                    return '<div class="lime-block__testi-card">' +
                        '<p class="lime-block__testi-quote" contenteditable="true">«' + quote + '»</p>' +
                        '<div class="lime-block__testi-author">' +
                            '<div class="lime-block__testi-avatar"></div>' +
                            '<div>' +
                                '<div class="lime-block__testi-name" contenteditable="true">' + author + '</div>' +
                                '<div class="lime-block__testi-role" contenteditable="true">' + role + '</div>' +
                            '</div>' +
                        '</div></div>';
                };
                return '<div class="lime-block__testimonials">' +
                    card("Отличный продукт, всё интуитивно.", "Анна К.", "Маркетолог") +
                    card("Запустил лендинг за час, без кода.", "Иван С.", "Стартапер") +
                    card("Поддержка отвечает быстро.", "Мария В.", "Дизайнер") +
                    '</div>';
            }
        },
        accordion: {
            name: "FAQ / Аккордеон",
            icon: "▼",
            category: "advanced",
            template: function () {
                var item = function (q, a) {
                    return '<details class="lime-block__faq-item"><summary contenteditable="true">' + q + '</summary>' +
                        '<div contenteditable="true">' + a + '</div></details>';
                };
                return '<div class="lime-block__faq">' +
                    item("Сколько стоит?", "Бесплатный тариф навсегда. Pro — 490₽/мес.") +
                    item("Можно ли подключить свой домен?", "Да, на Pro-тарифе.") +
                    item("Кому подойдёт?", "Маркетологам, фрилансерам, малому бизнесу — всем кому нужен лендинг без кода.") +
                    '</div>';
            }
        },
        heroBg: {
            name: "Hero c фоном",
            icon: "▣",
            category: "layout",
            template: function () {
                return '<div class="lime-block__hero-bg" data-lime-pick-image style="background-image:url(/images/cover-1.jpg)">' +
                    '<div class="lime-block__hero-bg-overlay"></div>' +
                    '<div class="lime-block__hero-bg-content">' +
                        '<h1 contenteditable="true">Заголовок на фоне</h1>' +
                        '<p contenteditable="true">Описание поверх изображения. Клик на блок → "🎨 Свойства" → "Цвет фона" заменит overlay.</p>' +
                        '<a href="#" class="lime-block__hero-bg-cta" contenteditable="true">Узнать больше →</a>' +
                    '</div>' +
                    '</div>';
            }
        },

        stats: {
            name: "Статистика",
            icon: "#",
            category: "advanced",
            template: function () {
                var stat = function (n, l) {
                    return '<div class="lime-block__stat">' +
                        '<div class="lime-block__stat-num" contenteditable="true">' + n + '</div>' +
                        '<div class="lime-block__stat-label" contenteditable="true">' + l + '</div>' +
                        '</div>';
                };
                return '<div class="lime-block__stats">' +
                    stat("10K+", "Пользователей") +
                    stat("99.9%", "Аптайм") +
                    stat("24/7", "Поддержка") +
                    stat("4.9★", "Рейтинг") +
                    '</div>';
            }
        },
        logos: {
            name: "Логотипы",
            icon: "❖",
            category: "advanced",
            template: function () {
                var logo = '<div class="lime-block__logo" data-lime-pick-image>+ лого</div>';
                return '<div class="lime-block__logos">' + logo + logo + logo + logo + logo + '</div>';
            }
        },
        steps: {
            name: "Шаги",
            icon: "№",
            category: "advanced",
            template: function () {
                var step = function (n, t, d) {
                    return '<div class="lime-block__step">' +
                        '<div class="lime-block__step-num">' + n + '</div>' +
                        '<div class="lime-block__step-body">' +
                            '<h4 contenteditable="true">' + t + '</h4>' +
                            '<p contenteditable="true">' + d + '</p>' +
                        '</div></div>';
                };
                return '<div class="lime-block__steps">' +
                    step("1", "Зарегистрируйся", "Создай аккаунт за минуту.") +
                    step("2", "Собери сайт", "Перетаскивай блоки в конструкторе.") +
                    step("3", "Опубликуй", "Жми «Опубликовать» — сайт онлайн.") +
                    '</div>';
            }
        },
        table: {
            name: "Таблица",
            icon: "▤",
            category: "advanced",
            template: function () {
                var th = function (t) { return '<th contenteditable="true">' + t + '</th>'; };
                var td = function (t) { return '<td contenteditable="true">' + t + '</td>'; };
                return '<table class="lime-block__table">' +
                    '<thead><tr>' + th("Тариф") + th("Цена") + th("Что входит") + '</tr></thead>' +
                    '<tbody>' +
                        '<tr>' + td("Старт") + td("₽0") + td("1 сайт, subdomain") + '</tr>' +
                        '<tr>' + td("Pro") + td("₽490") + td("10 сайтов, свой домен") + '</tr>' +
                        '<tr>' + td("Команда") + td("₽1 290") + td("Безлимит, SLA") + '</tr>' +
                    '</tbody>' +
                    '</table>';
            }
        },
        imageText: {
            name: "Картинка + текст",
            icon: "◧",
            category: "layout",
            template: function () {
                return '<div class="lime-block__img-text">' +
                    '<div class="lime-block__img-text-media" data-lime-pick-image>+ выбрать изображение</div>' +
                    '<div class="lime-block__img-text-body">' +
                        '<h3 contenteditable="true">Заголовок раздела</h3>' +
                        '<p contenteditable="true">Расскажи о продукте или услуге. Картинка слева, текст справа — классическая связка для лендинга.</p>' +
                        '<a href="#" class="lime-block__cta-btn" contenteditable="true">Подробнее →</a>' +
                    '</div>' +
                    '</div>';
            }
        },
        socials: {
            name: "Соцсети",
            icon: "♥",
            category: "layout",
            template: function () {
                var link = function (t) { return '<a href="#" class="lime-block__social" contenteditable="true">' + t + '</a>'; };
                return '<div class="lime-block__socials">' +
                    link("Telegram") + link("VK") + link("Instagram") + link("YouTube") +
                    '</div>';
            }
        },
        buttonGroup: {
            name: "Кнопки",
            icon: "⬚",
            category: "basic",
            template: function () {
                return '<div class="lime-block__btn-group">' +
                    '<a href="#" class="lime-block__cta-btn" contenteditable="true">Основное действие</a>' +
                    '<a href="#" class="lime-block__btn-ghost" contenteditable="true">Вторично</a>' +
                    '</div>';
            }
        },
        divider: {
            name: "Разделитель",
            icon: "—",
            category: "basic",
            template: function () {
                return '<div class="lime-block__divider"><span></span></div>';
            }
        },
        embed: {
            name: "Свой код / Embed",
            icon: "</>",
            category: "advanced",
            // Произвольный HTML рендерится в изолированном sandbox-iframe (см. setEmbed).
            template: function () {
                return '<div class="lime-block__embed" data-lime-embed-edit>' +
                    '<div class="lime-block__embed-placeholder">+ Вставить HTML / embed-код (карта, виджет, форма)</div>' +
                    '</div>';
            }
        }
    };

    // Готовые секции — комбинации блоков «под задачу» (вставляются одной кнопкой).
    var SECTIONS = {
        starter: ["navbar", "cover", "features", "cta", "footer"],
        product: ["heroBg", "imageText", "stats", "pricing", "cta"],
        contact: ["heading", "text", "contact", "socials"]
    };

    // ===== HISTORY (undo/redo) =====
    var HISTORY_LIMIT = 50;
    var history = { stack: [], idx: -1, suppress: false };

    function snapshot() { return ws.innerHTML; }

    function restore(html) {
        history.suppress = true;
        ws.innerHTML = html;
        history.suppress = false;
        deselectAll(); // selection invalidated
        showPlaceholderIfEmpty();
        updateHistoryButtons();
    }

    function pushHistory() {
        if (history.suppress) return;
        var snap = snapshot();
        // Не пушим если совпадает с последним
        if (history.idx >= 0 && history.stack[history.idx] === snap) return;
        history.stack = history.stack.slice(0, history.idx + 1);
        history.stack.push(snap);
        if (history.stack.length > HISTORY_LIMIT) {
            history.stack.shift();
        } else {
            history.idx++;
        }
        updateHistoryButtons();
        scheduleAutosave();
    }

    function undo() {
        if (history.idx <= 0) return;
        history.idx--;
        restore(history.stack[history.idx]);
    }

    function redo() {
        if (history.idx >= history.stack.length - 1) return;
        history.idx++;
        restore(history.stack[history.idx]);
    }

    function updateHistoryButtons() {
        var u = document.querySelector("[data-history-action='undo']");
        var r = document.querySelector("[data-history-action='redo']");
        if (u) u.disabled = history.idx <= 0;
        if (r) r.disabled = history.idx >= history.stack.length - 1;
    }

    // ===== ADD BLOCK =====
    function addBlock(type) {
        var spec = BLOCKS[type];
        if (!spec) return;
        var block = document.createElement("section");
        block.className = "lime-block";
        block.dataset.blockType = type;
        block.dataset.blockId = uuid();
        block.innerHTML =
            '<span class="lime-block-grip" aria-hidden="true">⋮⋮</span>' +
            '<div class="lime-block__inner">' + spec.template() + '</div>';
        var placeholder = ws.querySelector(".lime-workspace__placeholder");
        if (placeholder) placeholder.remove();
        ws.appendChild(block);
        selectBlock(block);
        block.scrollIntoView({ behavior: "smooth", block: "center" });
        pushHistory();
    }

    // Вставка готовой секции — последовательность блоков из SECTIONS.
    function addSection(key) {
        var list = SECTIONS[key];
        if (!list) return;
        list.forEach(function (type) { addBlock(type); });
    }

    // ===== SELECTION + TOOLBAR =====
    var selected = null;

    function deselectAll() {
        if (selected) {
            selected.classList.remove("is-selected");
            selected = null;
        }
        hideToolbar();
        refreshInspector();
    }

    function selectBlock(b) {
        if (selected === b) return;
        if (selected) selected.classList.remove("is-selected");
        selected = b;
        selected.classList.add("is-selected");
        showToolbar(b);
        refreshInspector();
    }

    function ensureToolbar() {
        var t = document.querySelector(".lime-block-toolbar");
        if (t) return t;
        t = document.createElement("div");
        t.className = "lime-block-toolbar";
        t.innerHTML =
            '<button type="button" class="lime-block-toolbar__btn" data-action="up" title="Вверх">↑</button>' +
            '<button type="button" class="lime-block-toolbar__btn" data-action="down" title="Вниз">↓</button>' +
            '<span class="lime-block-toolbar__sep"></span>' +
            '<button type="button" class="lime-block-toolbar__btn" data-action="properties" title="Свойства">🎨</button>' +
            '<button type="button" class="lime-block-toolbar__btn" data-action="duplicate" title="Дублировать">⎘</button>' +
            '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-action="delete" title="Удалить">✕</button>';
        document.body.appendChild(t);
        t.addEventListener("click", handleToolbarClick);
        return t;
    }

    function showToolbar(block) {
        var t = ensureToolbar();
        var rect = block.getBoundingClientRect();
        t.style.top = (window.scrollY + rect.top - 38) + "px";
        t.style.left = (window.scrollX + rect.right - 160) + "px";
        t.classList.add("is-visible");
    }

    function hideToolbar() {
        var t = document.querySelector(".lime-block-toolbar");
        if (t) t.classList.remove("is-visible");
    }

    function handleToolbarClick(e) {
        var btn = e.target.closest("[data-action]");
        if (!btn || !selected) return;
        var action = btn.dataset.action;
        if (action === "delete") {
            if (confirm("Удалить блок?")) {
                selected.remove();
                deselectAll();
                showPlaceholderIfEmpty();
                pushHistory();
            }
        } else if (action === "duplicate") {
            var clone = selected.cloneNode(true);
            clone.dataset.blockId = uuid();
            selected.parentNode.insertBefore(clone, selected.nextSibling);
            selectBlock(clone);
            pushHistory();
        } else if (action === "up") {
            var prev = selected.previousElementSibling;
            if (prev && prev.classList.contains("lime-block")) {
                selected.parentNode.insertBefore(selected, prev);
                showToolbar(selected);
                refreshInspector();
                pushHistory();
            }
        } else if (action === "down") {
            var next = selected.nextElementSibling;
            if (next && next.classList.contains("lime-block")) {
                selected.parentNode.insertBefore(next, selected);
                showToolbar(selected);
                refreshInspector();
                pushHistory();
            }
        } else if (action === "properties") {
            // Подсветить inspector — он и так открыт, но визуально намекнём
            var inspector = document.querySelector(".lime-editor__inspector");
            if (inspector) inspector.scrollTo({ top: 0, behavior: "smooth" });
        }
    }

    function showPlaceholderIfEmpty() {
        if (ws.querySelectorAll(".lime-block").length === 0) {
            ws.innerHTML = '<div class="lime-workspace__placeholder">' +
                '<div class="lime-workspace__placeholder-icon">✨</div>' +
                '<div>Выбери блок слева — и начни собирать страницу.</div></div>';
        }
    }

    ws.addEventListener("click", function (e) {
        if (e.target.closest(".lime-block-toolbar")) return;
        if (e.target.closest("[contenteditable]")) return;
        if (e.target.closest("[data-lime-pick-image]")) {
            openMediaPicker(e.target.closest("[data-lime-pick-image]"));
            return;
        }
        if (e.target.closest("[data-lime-set-video]")) {
            promptVideo(e.target.closest("[data-lime-set-video]"));
            return;
        }
        var embedEdit = e.target.closest("[data-lime-embed-edit]");
        if (embedEdit) {
            var embedBlock = embedEdit.closest(".lime-block");
            if (embedBlock) selectBlock(embedBlock);
            openEmbedModal(embedEdit);
            return;
        }
        var block = e.target.closest(".lime-block");
        if (block && block.parentNode === ws) {
            selectBlock(block);
        }
    });

    document.addEventListener("click", function (e) {
        // Click outside workspace/toolbar/sidebar/topbar/modal → deselect.
        // Sidebar и topbar в виде исключений: клик "Добавить блок" в сайдбаре сразу же
        // вызывал selectBlock(новый), а потом этот глобальный handler срабатывал bubbling-ом
        // и тут же сбрасывал выбор. То же для theme-toggle, device-toggle, save-кнопок.
        if (
            !e.target.closest("#lime-workspace") &&
            !e.target.closest(".lime-block-toolbar") &&
            !e.target.closest(".lime-editor__sidebar") &&
            !e.target.closest(".lime-editor__topbar") &&
            !e.target.closest(".lime-editor__inspector") &&
            !e.target.closest(".lime-modal-backdrop")
        ) {
            deselectAll();
        }
    });

    window.addEventListener("scroll", function () {
        if (selected) showToolbar(selected);
    }, { passive: true });

    // В редакторе формы не отправляются — это design-time. Реальный submit работает только
    // на опубликованной странице (там сервер проставляет action/__siteId/lime_ts).
    ws.addEventListener("submit", function (e) { e.preventDefault(); });

    // ===== SIDEBAR =====
    document.querySelectorAll("[data-add-block]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            // stopPropagation чтобы document.click handler (deselectAll) гарантированно не сработал.
            e.stopPropagation();
            addBlock(btn.dataset.addBlock);
        });
    });

    document.querySelectorAll("[data-add-section]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            addSection(btn.dataset.addSection);
        });
    });

    var search = document.getElementById("lime-block-search");
    if (search) {
        search.addEventListener("input", function () {
            var q = search.value.toLowerCase().trim();
            document.querySelectorAll(".lime-block-tile").forEach(function (tile) {
                var name = (tile.textContent || "").toLowerCase();
                tile.classList.toggle("is-hidden", q && name.indexOf(q) === -1);
            });
        });
    }

    // ===== SORTABLE =====
    if (window.Sortable) {
        new window.Sortable(ws, {
            handle: ".lime-block-grip",
            animation: 160,
            ghostClass: "sortable-ghost",
            chosenClass: "sortable-chosen",
            onEnd: function (evt) {
                if (selected) showToolbar(selected);
                if (evt.oldIndex !== evt.newIndex) pushHistory();
            }
        });
    }

    // ===== DEVICE PREVIEW =====
    document.querySelectorAll("[data-device]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll("[data-device]").forEach(function (b) { b.classList.remove("is-active"); });
            btn.classList.add("is-active");
            ws.setAttribute("data-device", btn.dataset.device);
            if (selected) setTimeout(function () { showToolbar(selected); }, 250);
        });
    });

    // ===== MEDIA PICKER =====
    var pickerTarget = null;

    function openMediaPicker(target) {
        pickerTarget = target;
        var modal = document.getElementById("lime-media-modal");
        if (!modal) return;
        modal.classList.add("is-open");
        loadMediaList();
        wireMediaUpload();
    }

    var mediaUploadWired = false;
    function wireMediaUpload() {
        if (mediaUploadWired) return;
        var input = document.getElementById("lime-media-upload");
        var status = document.getElementById("lime-media-status");
        if (!input) return;
        mediaUploadWired = true;
        input.addEventListener("change", function () {
            if (!input.files || input.files.length === 0) return;
            var file = input.files[0];
            var form = new FormData();
            form.append("file", file);
            status.style.display = "block";
            status.textContent = "Загружаю " + file.name + "...";
            status.className = "lime-text-muted";
            var token = csrfToken();
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/Media/Upload");
            xhr.setRequestHeader("X-CSRF-TOKEN", token);
            xhr.onload = function () {
                if (xhr.status === 200 || xhr.status === 302) {
                    status.textContent = "✓ Загружено. Обновляю список...";
                    status.className = "lime-text-success";
                    loadMediaList();
                    setTimeout(function () { status.style.display = "none"; }, 1500);
                } else {
                    status.textContent = "✗ Ошибка загрузки: " + xhr.status;
                    status.className = "lime-text-danger";
                }
                input.value = ""; // сбросить, чтобы можно было загрузить тот же файл повторно
            };
            xhr.onerror = function () {
                status.textContent = "✗ Сетевая ошибка";
                status.className = "lime-text-danger";
                input.value = "";
            };
            xhr.send(form);
        });
    }

    function closeMediaPicker() {
        var modal = document.getElementById("lime-media-modal");
        if (modal) modal.classList.remove("is-open");
        pickerTarget = null;
    }

    function loadMediaList() {
        var grid = document.getElementById("lime-media-grid");
        if (!grid) return;
        grid.innerHTML = '<div class="lime-text-muted">Загрузка...</div>';
        fetch("/Media/ApiList", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (items) {
                if (!items || items.length === 0) {
                    grid.innerHTML = '<div class="lime-picker-empty">Пусто. Загрузи изображения в <a href="/Media/Index" target="_blank" class="lime-text-accent">Медиа</a>.</div>';
                    return;
                }
                grid.innerHTML = items.map(function (it) {
                    return '<div class="lime-picker-item" data-url="' + it.url + '" title="' + (it.name || "") + '">' +
                        '<img src="' + it.url + '" alt="' + (it.name || "") + '" loading="lazy">' +
                        '</div>';
                }).join("");
            })
            .catch(function () {
                grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>';
            });
    }

    document.addEventListener("click", function (e) {
        var item = e.target.closest("#lime-media-grid .lime-picker-item");
        if (item) {
            var url = item.dataset.url;
            if (pickerTarget && url) {
                if (pickerTarget.classList.contains("lime-block__gallery-item")) {
                    pickerTarget.innerHTML = '<img src="' + url + '" alt="">';
                    pickerTarget.removeAttribute("data-lime-pick-image");
                } else {
                    pickerTarget.innerHTML = '<img src="' + url + '" alt="">';
                }
            }
            closeMediaPicker();
            return;
        }
        if (e.target.closest("[data-lime-modal-close]")) {
            closeMediaPicker();
        }
    });

    function promptVideo(target) {
        var url = window.prompt("Ссылка YouTube (https://youtube.com/watch?v=... или https://youtu.be/...)");
        if (!url) return;
        var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
        if (!m) { alert("Не распознал ссылку YouTube."); return; }
        var id = m[1];
        var container = target.parentNode;
        container.innerHTML = '<iframe src="https://www.youtube.com/embed/' + id +
            '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    }

    // ===== EMBED (свой HTML в sandbox-iframe) =====
    var embedTarget = null;

    function openEmbedModal(target) {
        embedTarget = target;
        var modal = document.getElementById("lime-embed-modal");
        if (!modal) return;
        var ta = document.getElementById("lime-embed-input");
        if (ta) ta.value = target.dataset.embedSrc ? decodeURIComponent(target.dataset.embedSrc) : "";
        modal.classList.add("is-open");
    }

    function closeEmbedModal() {
        var modal = document.getElementById("lime-embed-modal");
        if (modal) modal.classList.remove("is-open");
        embedTarget = null;
    }

    // Раскладываем пользовательский HTML в изолированный sandbox-iframe (без allow-same-origin —
    // код не имеет доступа к родительскому origin). Исходник храним в data-embed-src для повторной правки.
    function setEmbed(target, html) {
        if (!html || !html.trim()) {
            target.removeAttribute("data-embed-src");
            target.innerHTML = '<div class="lime-block__embed-placeholder">+ Вставить HTML / embed-код (карта, виджет, форма)</div>';
            return;
        }
        target.dataset.embedSrc = encodeURIComponent(html);
        var doc = '<!doctype html><meta charset="utf-8">' +
            '<style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif}</style>' + html;
        var frame = document.createElement("iframe");
        frame.className = "lime-block__embed-frame";
        frame.setAttribute("sandbox", "allow-scripts allow-popups allow-forms");
        frame.setAttribute("loading", "lazy");
        frame.srcdoc = doc;
        target.innerHTML = "";
        target.appendChild(frame);
    }

    document.addEventListener("click", function (e) {
        if (e.target.closest("[data-lime-embed-close]")) { closeEmbedModal(); return; }
        if (e.target.closest("[data-lime-embed-insert]")) {
            if (!embedTarget) return;
            var ta = document.getElementById("lime-embed-input");
            setEmbed(embedTarget, ta ? ta.value : "");
            closeEmbedModal();
            pushHistory();
        }
    });

    // ===== INSPECTOR (right panel: block properties) =====
    var inspectorEl = document.querySelector(".lime-editor__inspector");

    var PADDING_PRESETS = {
        none: "0",
        xs: "8px",
        sm: "16px",
        md: "24px",
        lg: "48px",
        xl: "80px",
    };
    var BG_SWATCHES = [
        "#a78bfa", "#38bdf8", "#4ade80", "#fbbf24",
        "#f87171", "#f472b6", "#0a0612", "#f4f0ff",
    ];
    var TEXT_SWATCHES = [
        "#f4f0ff", "#0a0612", "#a78bfa", "#38bdf8",
        "#fbbf24", "#f87171", "#9a93b8", "#ffffff",
    ];
    var FONT_FAMILIES = [
        { label: "Inter", value: "'Inter', system-ui, sans-serif" },
        { label: "Систем.", value: "system-ui, -apple-system, sans-serif" },
        { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
        { label: "Mono", value: "ui-monospace, 'Cascadia Code', monospace" },
    ];
    var SHADOW_PRESETS = {
        none: "none",
        sm: "0 1px 2px rgba(0,0,0,.12)",
        md: "0 6px 18px rgba(0,0,0,.18)",
        lg: "0 18px 50px rgba(0,0,0,.30)",
    };

    // Debounce истории для непрерывных контролов (range/color) — иначе каждый микросдвиг пушит снапшот.
    var inspectorChangeDebounce;
    function debouncedHistory() {
        clearTimeout(inspectorChangeDebounce);
        inspectorChangeDebounce = setTimeout(pushHistory, 400);
    }

    function escAttr(s) { return String(s).replace(/"/g, "&quot;"); }

    // Контролы ширины применяются к внутренней обёртке блока (.lime-block__inner).
    function innerOf(block) { return block.querySelector(".lime-block__inner") || block; }

    // ---- HTML-билдеры контролов (добавить стиль = добавить строчку в renderInspectorForBlock) ----
    function sectionTitle(t) { return '<div class="lime-inspector__section-title">' + t + '</div>'; }

    function details(title, body) {
        return '<details class="lime-inspector__details"><summary>' + title + '</summary>' +
            '<div class="lime-inspector__section" style="margin-top: var(--space-2);">' + body + '</div></details>';
    }

    // Сегментированный переключатель: каждая кнопка ставит фиксированное значение style[prop].
    // target === "inner" → применяется к .lime-block__inner.
    function segment(prop, cur, opts, target) {
        return '<div class="lime-segmented">' + opts.map(function (o) {
            var active = (cur === o.val) ? "is-active" : "";
            return '<button type="button" class="' + active + '" data-set data-prop="' + prop +
                '" data-val="' + escAttr(o.val) + '"' + (target ? ' data-target="' + target + '"' : '') +
                (o.title ? ' title="' + o.title + '"' : '') + '>' + o.label + '</button>';
        }).join("") + '</div>';
    }

    function fontSelect(cur) {
        return '<select class="lime-select" data-prop="fontFamily">' +
            '<option value="">— по умолчанию —</option>' +
            FONT_FAMILIES.map(function (f) {
                var sel = (cur === f.value) ? ' selected' : '';
                return '<option value="' + escAttr(f.value) + '"' + sel + '>' + f.label + '</option>';
            }).join("") +
            '</select>';
    }

    // Лейбл + ползунок + текущее значение. attrs — строка доп. data-атрибутов (data-prop/data-unit/data-target или data-grad).
    function rangeRow(label, attrs, cur, min, max, step, unit) {
        var num = parseFloat(cur);
        if (isNaN(num)) num = min;
        var shown = (cur !== undefined && cur !== null && cur !== "") ? cur : (num + (unit || ""));
        return '<div class="lime-prop-row"><span class="lime-prop-row__label">' + label + '</span>' +
            '<div class="lime-range-row">' +
                '<input type="range" class="lime-range" ' + attrs + ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + num + '">' +
                '<span class="lime-range__val">' + shown + '</span>' +
            '</div></div>';
    }

    function swatchesHtml(colors, kind) {
        return colors.map(function (c) {
            return '<button type="button" class="lime-color-swatch" data-swatch="' + kind + '" data-val="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
        }).join("");
    }

    // Выравнивание ограниченного по ширине блока (через margin auto на .lime-block__inner).
    function alignBlockSegment(inner) {
        var ml = inner.style.marginLeft, mr = inner.style.marginRight;
        var cur = "left";
        if (ml === "auto" && mr === "auto") cur = "center";
        else if (ml === "auto") cur = "right";
        return '<div class="lime-segmented">' +
            ["left", "center", "right"].map(function (a) {
                var icon = a === "left" ? "◀" : a === "center" ? "≡" : "▶";
                return '<button type="button" class="' + (cur === a ? "is-active" : "") + '" data-align-block="' + a + '" title="' + a + '">' + icon + '</button>';
            }).join("") +
            '</div>';
    }

    // Разбор сохранённого linear-gradient(...) на угол + 2 цвета (для редактирования).
    function parseGradient(v) {
        var def = { angle: 135, c1: "#a78bfa", c2: "#38bdf8" };
        if (!v || v.indexOf("linear-gradient") < 0) return def;
        var m = v.match(/linear-gradient\(\s*([\d.]+)deg\s*,\s*([^,]+),\s*([^)]+)\)/i);
        if (!m) return def;
        return { angle: parseFloat(m[1]) || 135, c1: rgbToHex(m[2].trim()), c2: rgbToHex(m[3].trim()) };
    }

    // Собирает linear-gradient из текущих значений контролов градиента и пишет в backgroundImage.
    function applyGradient() {
        if (!selected || !inspectorEl) return;
        var c1 = inspectorEl.querySelector('[data-grad="c1"]');
        var c2 = inspectorEl.querySelector('[data-grad="c2"]');
        var ang = inspectorEl.querySelector('[data-grad="angle"]');
        if (!c1 || !c2) return;
        var a = ang ? ang.value : 135;
        selected.style.backgroundImage = 'linear-gradient(' + a + 'deg, ' + c1.value + ', ' + c2.value + ')';
    }

    function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // Ограничивает пользовательский CSS селектором блока (простой скоупинг flat-правил).
    // Голые декларации без { } оборачиваются в правило для самого блока. @-правила не трогаем.
    function scopeCss(css, sel) {
        if (css.indexOf("{") === -1) {
            return sel + " {\n" + css + "\n}";
        }
        return css.replace(/([^{}]+)\{([^{}]*)\}/g, function (whole, selectors, body) {
            if (selectors.trim().charAt(0) === "@") return whole;
            var scoped = selectors.split(",").map(function (one) {
                one = one.trim();
                return one ? sel + " " + one : "";
            }).filter(Boolean).join(", ");
            return scoped + " {" + body + "}";
        });
    }

    // Применяет «свой CSS» блока: хранит исходник в data-lime-css-src, генерит scoped <style> внутри блока.
    function applyCustomCss(block, raw) {
        if (!block) return;
        var styleEl = block.querySelector(":scope > style[data-lime-css]");
        if (!raw || !raw.trim()) {
            block.removeAttribute("data-lime-css-src");
            if (styleEl) styleEl.remove();
            return;
        }
        block.dataset.limeCssSrc = encodeURIComponent(raw);
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.setAttribute("data-lime-css", "");
            block.insertBefore(styleEl, block.firstChild);
        }
        styleEl.textContent = scopeCss(raw, '[data-block-id="' + (block.dataset.blockId || "") + '"]');
    }

    function renderInspectorEmpty() {
        if (!inspectorEl) return;
        inspectorEl.innerHTML =
            '<div class="lime-inspector__empty">' +
            'Выбери блок в workspace, чтобы редактировать его стили.' +
            '</div>';
    }

    function renderInspectorForBlock(block) {
        if (!inspectorEl) return;
        var type = block.dataset.blockType || "block";
        var s = block.style;
        var inner = innerOf(block);
        var maxW = inner.style.maxWidth || "";
        var widthMode = maxW ? "boxed" : "full";

        var padOpts = Object.keys(PADDING_PRESETS).map(function (k) {
            return { val: PADDING_PRESETS[k], label: k.toUpperCase() };
        });

        var html =
            '<div class="lime-inspector__head">' +
                '<div class="lime-inspector__title">Свойства<small>Блок: ' + type + '</small></div>' +
                '<button type="button" class="lime-block-toolbar__btn" data-inspector-action="reset" title="Сбросить стили">↺</button>' +
            '</div>';

        // Фон
        html +=
            '<div class="lime-inspector__section">' + sectionTitle("Фон") +
                '<div class="lime-color-row">' +
                    '<input type="color" class="lime-color-input" data-prop="backgroundColor" value="' + rgbToHex(s.backgroundColor) + '">' +
                    '<button type="button" class="lime-color-clear" data-clear="backgroundColor" title="Убрать фон"></button>' +
                    '<span class="lime-prop-row__label">Цвет фона</span>' +
                '</div>' +
                '<div class="lime-color-row__swatches">' + swatchesHtml(BG_SWATCHES, "bg") + '</div>' +
            '</div>';

        // Градиент фона (сворачиваемо)
        var g = parseGradient(s.backgroundImage);
        html += details("Градиент фона",
            '<div class="lime-color-row">' +
                '<input type="color" class="lime-color-input" data-grad="c1" value="' + g.c1 + '">' +
                '<input type="color" class="lime-color-input" data-grad="c2" value="' + g.c2 + '">' +
                '<button type="button" class="lime-color-clear" data-clear="backgroundImage" title="Убрать градиент"></button>' +
                '<span class="lime-prop-row__label">2 цвета</span>' +
            '</div>' +
            rangeRow("Угол", 'data-grad="angle"', g.angle + "°", 0, 360, 1, "°")
        );

        // Цвет текста
        html +=
            '<div class="lime-inspector__section">' + sectionTitle("Цвет текста") +
                '<div class="lime-color-row">' +
                    '<input type="color" class="lime-color-input" data-prop="color" value="' + rgbToHex(s.color) + '">' +
                    '<button type="button" class="lime-color-clear" data-clear="color" title="Убрать"></button>' +
                    '<span class="lime-prop-row__label">Цвет текста</span>' +
                '</div>' +
                '<div class="lime-color-row__swatches">' + swatchesHtml(TEXT_SWATCHES, "text") + '</div>' +
            '</div>';

        // Типографика (сворачиваемо)
        html += details("Типографика",
            rangeRow("Размер", 'data-prop="fontSize" data-unit="px"', s.fontSize, 12, 80, 1, "px") +
            rangeRow("Межстрочный", 'data-prop="lineHeight"', s.lineHeight, 1, 2.4, 0.05, "") +
            '<div class="lime-prop-row"><span class="lime-prop-row__label">Жирность</span></div>' +
            segment("fontWeight", s.fontWeight, [
                { val: "400", label: "Об." }, { val: "600", label: "П/ж" },
                { val: "700", label: "Ж" }, { val: "800", label: "Чёрн." }
            ]) +
            '<div class="lime-prop-row"><span class="lime-prop-row__label">Шрифт</span></div>' +
            fontSelect(s.fontFamily) +
            '<div class="lime-prop-row"><span class="lime-prop-row__label">Выравнивание текста</span></div>' +
            segment("textAlign", s.textAlign, [
                { val: "left", label: "◀", title: "left" },
                { val: "center", label: "≡", title: "center" },
                { val: "right", label: "▶", title: "right" }
            ])
        );

        // Внутренние отступы
        html +=
            '<div class="lime-inspector__section">' + sectionTitle("Внутренние отступы") +
                segment("padding", s.padding, padOpts) +
            '</div>';
        html += details("Точные отступы (T R B L)",
            rangeRow("Сверху", 'data-prop="paddingTop" data-unit="px"', s.paddingTop, 0, 160, 2, "px") +
            rangeRow("Справа", 'data-prop="paddingRight" data-unit="px"', s.paddingRight, 0, 160, 2, "px") +
            rangeRow("Снизу", 'data-prop="paddingBottom" data-unit="px"', s.paddingBottom, 0, 160, 2, "px") +
            rangeRow("Слева", 'data-prop="paddingLeft" data-unit="px"', s.paddingLeft, 0, 160, 2, "px")
        );

        // Внешние отступы
        html += details("Внешние отступы",
            rangeRow("Сверху", 'data-prop="marginTop" data-unit="px"', s.marginTop, 0, 200, 2, "px") +
            rangeRow("Снизу", 'data-prop="marginBottom" data-unit="px"', s.marginBottom, 0, 200, 2, "px")
        );

        // Граница и скругление
        html += details("Граница и скругление",
            rangeRow("Толщина", 'data-prop="borderWidth" data-unit="px"', s.borderWidth, 0, 12, 1, "px") +
            '<div class="lime-prop-row"><span class="lime-prop-row__label">Стиль</span></div>' +
            segment("borderStyle", s.borderStyle, [
                { val: "none", label: "Нет" }, { val: "solid", label: "—" },
                { val: "dashed", label: "- -" }, { val: "dotted", label: "···" }
            ]) +
            '<div class="lime-color-row">' +
                '<input type="color" class="lime-color-input" data-prop="borderColor" value="' + rgbToHex(s.borderColor) + '">' +
                '<button type="button" class="lime-color-clear" data-clear="borderColor" title="Убрать"></button>' +
                '<span class="lime-prop-row__label">Цвет границы</span>' +
            '</div>' +
            rangeRow("Скругление", 'data-prop="borderRadius" data-unit="px"', s.borderRadius, 0, 64, 1, "px")
        );

        // Тень
        html += details("Тень",
            segment("boxShadow", s.boxShadow, [
                { val: "none", label: "Нет" }, { val: SHADOW_PRESETS.sm, label: "S" },
                { val: SHADOW_PRESETS.md, label: "M" }, { val: SHADOW_PRESETS.lg, label: "L" }
            ])
        );

        // Размер блока
        html +=
            '<div class="lime-inspector__section">' + sectionTitle("Размер блока") +
                '<div class="lime-segmented">' +
                    '<button type="button" class="' + (widthMode === "full" ? "is-active" : "") + '" data-width-full>На весь экран</button>' +
                    '<button type="button" class="' + (widthMode === "boxed" ? "is-active" : "") + '" data-set data-prop="maxWidth" data-val="1100px" data-target="inner">Ограничить</button>' +
                '</div>' +
                rangeRow("Макс. ширина", 'data-prop="maxWidth" data-unit="px" data-target="inner"', maxW, 320, 1600, 10, "px") +
                '<div class="lime-prop-row"><span class="lime-prop-row__label">Выравнивание блока</span></div>' +
                alignBlockSegment(inner) +
                rangeRow("Мин. высота", 'data-prop="minHeight" data-unit="px"', s.minHeight, 0, 800, 10, "px") +
            '</div>';

        // Анимация при скролле (data-anim* на блоке — проигрывается на опубликованной странице).
        var anim = block.dataset.anim || "";
        var animDelay = block.dataset.animDelay || "0";
        var animDur = block.dataset.animDuration || "0.7";
        var animOpts = [
            ["", "Нет"], ["fade-up", "↑ Fade"], ["fade-in", "Fade"],
            ["zoom", "Zoom"], ["slide-left", "← Slide"], ["slide-right", "Slide →"]
        ];
        html +=
            '<div class="lime-inspector__section">' + sectionTitle("Анимация при скролле") +
                '<div class="lime-segmented lime-segmented--wrap">' +
                    animOpts.map(function (o) {
                        return '<button type="button" class="' + (anim === o[0] ? "is-active" : "") + '" data-anim-set="' + o[0] + '">' + o[1] + '</button>';
                    }).join("") +
                '</div>' +
                rangeRow("Задержка", 'data-anim-range="animDelay"', animDelay + "ms", 0, 1000, 50, "ms") +
                rangeRow("Длительность", 'data-anim-range="animDuration"', animDur + "s", 0.2, 2, 0.1, "s") +
            '</div>';

        // Свой CSS (для продвинутых) — селекторы автоматически ограничиваются этим блоком.
        var cssSrc = block.dataset.limeCssSrc ? decodeURIComponent(block.dataset.limeCssSrc) : "";
        html += details("Свой CSS (для блока)",
            '<textarea class="lime-css-input" data-lime-css-input rows="5" spellcheck="false" placeholder="color: #fff;&#10;h2 { letter-spacing: 1px; }">' + escHtml(cssSrc) + '</textarea>' +
            '<div class="lime-text-muted" style="font-size:11px;">Селекторы автоматически ограничиваются этим блоком. Голые свойства применяются к блоку.</div>'
        );

        html +=
            '<div class="lime-inspector__actions">' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-inspector-action="reset">Сбросить все стили блока</button>' +
            '</div>';

        inspectorEl.innerHTML = html;
    }

    function refreshInspector() {
        if (selected) renderInspectorForBlock(selected);
        else renderInspectorEmpty();
    }

    // Утилита: rgb(167, 139, 250) → #a78bfa. Нужна для <input type="color">.
    function rgbToHex(rgb) {
        if (!rgb) return "#000000";
        if (rgb[0] === "#") return rgb;
        var m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) return "#000000";
        var toHex = function (n) { var h = parseInt(n, 10).toString(16); return h.length < 2 ? "0" + h : h; };
        return "#" + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
    }

    // Обновление текстового значения рядом с ползунком.
    function updateRangeLabel(input, unit) {
        if (input.type !== "range") return;
        var row = input.closest(".lime-range-row");
        var lbl = row ? row.querySelector(".lime-range__val") : null;
        if (lbl) lbl.textContent = input.value + (unit || "");
    }

    if (inspectorEl) {
        // Один input-handler на все непрерывные контролы (range/color/select).
        inspectorEl.addEventListener("input", function (e) {
            e.stopPropagation();
            if (!selected) return;
            var t = e.target;
            // Градиент собирается из нескольких контролов.
            if (t.hasAttribute("data-grad")) {
                applyGradient();
                updateRangeLabel(t, "°");
                debouncedHistory();
                return;
            }
            // Свой CSS блока.
            if (t.hasAttribute("data-lime-css-input")) {
                applyCustomCss(selected, t.value);
                debouncedHistory();
                return;
            }
            // Анимация — пишем в data-* блока (не inline-стиль).
            if (t.hasAttribute("data-anim-range")) {
                var ak = t.dataset.animRange; // "animDelay" | "animDuration"
                selected.dataset[ak] = t.value;
                updateRangeLabel(t, ak === "animDelay" ? "ms" : "s");
                debouncedHistory();
                return;
            }
            if (t.hasAttribute("data-prop")) {
                var unit = t.dataset.unit || "";
                var tgt = (t.dataset.target === "inner") ? innerOf(selected) : selected;
                tgt.style[t.dataset.prop] = (t.value === "" ? "" : t.value + unit);
                updateRangeLabel(t, unit);
                debouncedHistory();
            }
        });

        // Один click-handler на все кнопочные контролы (свотчи/сегменты/пресеты/очистка/сброс).
        inspectorEl.addEventListener("click", function (e) {
            e.stopPropagation();
            if (!selected) return;
            var el;
            if ((el = e.target.closest("[data-swatch]"))) {
                if (el.dataset.swatch === "bg") selected.style.backgroundColor = el.dataset.val;
                else selected.style.color = el.dataset.val;
                refreshInspector(); pushHistory(); return;
            }
            if ((el = e.target.closest("[data-set]"))) {
                var setTgt = (el.dataset.target === "inner") ? innerOf(selected) : selected;
                setTgt.style[el.dataset.prop] = el.dataset.val;
                refreshInspector(); pushHistory(); return;
            }
            if ((el = e.target.closest("[data-anim-set]"))) {
                var av = el.dataset.animSet;
                if (av) selected.dataset.anim = av;
                else delete selected.dataset.anim;
                refreshInspector(); pushHistory(); return;
            }
            if (e.target.closest("[data-width-full]")) {
                var inr = innerOf(selected);
                inr.style.maxWidth = ""; inr.style.marginLeft = ""; inr.style.marginRight = "";
                refreshInspector(); pushHistory(); return;
            }
            if ((el = e.target.closest("[data-align-block]"))) {
                var inr2 = innerOf(selected), a = el.dataset.alignBlock;
                inr2.style.marginLeft = (a === "center" || a === "right") ? "auto" : "0";
                inr2.style.marginRight = (a === "center" || a === "left") ? "auto" : "0";
                refreshInspector(); pushHistory(); return;
            }
            if ((el = e.target.closest("[data-clear]"))) {
                var clrTgt = (el.dataset.target === "inner") ? innerOf(selected) : selected;
                el.dataset.clear.split(",").forEach(function (p) { clrTgt.style[p.trim()] = ""; });
                refreshInspector(); pushHistory(); return;
            }
            if (e.target.closest("[data-inspector-action='reset']")) {
                if (confirm("Сбросить все inline-стили блока?")) {
                    selected.removeAttribute("style");
                    var inr3 = innerOf(selected);
                    if (inr3 !== selected) inr3.removeAttribute("style");
                    refreshInspector(); pushHistory();
                }
            }
        });
        renderInspectorEmpty();
    }

    // ===== SAVE =====
    function collectHtml() {
        var clone = ws.cloneNode(true);
        clone.querySelectorAll(".lime-block-grip").forEach(function (g) { g.remove(); });
        clone.querySelectorAll(".lime-block-toolbar").forEach(function (g) { g.remove(); });
        clone.querySelectorAll(".is-selected").forEach(function (b) { b.classList.remove("is-selected"); });
        clone.querySelectorAll(".lime-workspace__placeholder").forEach(function (p) { p.remove(); });
        return clone.innerHTML;
    }

    function seoVal(id) { var el = document.getElementById(id); return el ? el.value : ""; }

    function buildSaveForm(auto) {
        var html = collectHtml();
        var form = new FormData();
        form.append("html", html);
        if (siteId) form.append("siteId", siteId);
        form.append("metaTitle", seoVal("lime-seo-title"));
        form.append("metaDescription", seoVal("lime-seo-desc"));
        form.append("ogImage", seoVal("lime-seo-og"));
        if (auto) form.append("auto", "true");
        return { form: form, html: html };
    }

    function save() {
        deselectAll();
        var built = buildSaveForm(false);
        if (!built.html.trim()) {
            alert("Добавь хотя бы один блок.");
            return;
        }
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Home/EditTemplatesPost");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            if (xhr.status === 200 || xhr.status === 302) {
                window.location.href = "/Home/MySites";
            } else {
                alert("Ошибка сохранения: " + xhr.status);
            }
        };
        xhr.onerror = function () { alert("Сетевая ошибка."); };
        xhr.send(built.form);
    }

    // ===== АВТОСЕЙВ (только для существующих сайтов — у нового нет siteId) =====
    var autosaveTimer, autosaveEnabled = false, autosaveDirty = false, autosaving = false;

    function setSaveStatus(text, cls) {
        var el = document.querySelector("[data-save-status]");
        if (!el) return;
        el.textContent = text;
        el.className = "lime-text-muted lime-save-status" + (cls ? " " + cls : "");
    }

    function scheduleAutosave() {
        if (!autosaveEnabled || !siteId) return;
        autosaveDirty = true;
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(runAutosave, 2500);
    }

    function runAutosave() {
        if (!siteId || autosaving) return;
        var built = buildSaveForm(true);
        if (!built.html.trim()) return;
        autosaving = true;
        autosaveDirty = false;
        setSaveStatus("Сохранение…");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Home/EditTemplatesPost");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            autosaving = false;
            if (xhr.status >= 200 && xhr.status < 400) {
                var t = new Date();
                var hh = ("0" + t.getHours()).slice(-2), mm = ("0" + t.getMinutes()).slice(-2);
                setSaveStatus("Сохранено " + hh + ":" + mm);
                if (autosaveDirty) scheduleAutosave();
            } else {
                setSaveStatus("Ошибка автосохранения", "lime-text-danger");
            }
        };
        xhr.onerror = function () { autosaving = false; setSaveStatus("Нет сети", "lime-text-danger"); };
        xhr.send(built.form);
    }

    function download() {
        deselectAll();
        var html = collectHtml();
        var form = new FormData();
        form.append("html", html);
        form.append("templateId", "4");
        var token = csrfToken();
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Template/DownloadSite");
        xhr.setRequestHeader("X-CSRF-TOKEN", token);
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (xhr.status !== 200) { alert("Ошибка: " + xhr.status); return; }
            var cd = xhr.getResponseHeader("Content-Disposition") || "";
            var m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd);
            var fn = m ? decodeURIComponent(m[1]) : "MySite.zip";
            var url = URL.createObjectURL(xhr.response);
            var a = document.createElement("a");
            a.href = url; a.download = fn;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        xhr.send(form);
    }

    if (saveBtn) saveBtn.addEventListener("click", save);
    if (downloadBtn) downloadBtn.addEventListener("click", download);

    // Превью scroll-анимаций прямо в редакторе (одноразовый проигрыш).
    var previewBtn = document.querySelector("[data-anim-preview]");
    if (previewBtn) {
        previewBtn.addEventListener("click", function () {
            if (window.LimeAnim) window.LimeAnim.play(ws);
        });
    }

    // ===== CONTENTEDITABLE undo trigger (debounced) =====
    var editDebounce;
    ws.addEventListener("input", function (e) {
        if (!e.target.closest("[contenteditable]")) return;
        clearTimeout(editDebounce);
        editDebounce = setTimeout(pushHistory, 600);
    });

    // ===== KEYBOARD SHORTCUTS =====
    document.addEventListener("keydown", function (e) {
        var inEditor = document.activeElement && document.activeElement.closest(".lime-editor");
        if (!inEditor) return;
        var ctrl = e.ctrlKey || e.metaKey;
        if (!ctrl) return;
        if (e.key === "z" || e.key === "Z") {
            if (e.shiftKey) { e.preventDefault(); redo(); }
            else { e.preventDefault(); undo(); }
        } else if (e.key === "y" || e.key === "Y") {
            e.preventDefault();
            redo();
        }
    });

    // ===== TOPBAR HISTORY BUTTONS =====
    var undoBtn = document.querySelector("[data-history-action='undo']");
    var redoBtn = document.querySelector("[data-history-action='redo']");
    if (undoBtn) undoBtn.addEventListener("click", function () { undo(); });
    if (redoBtn) redoBtn.addEventListener("click", function () { redo(); });

    // ===== SEO-модалка =====
    var seoOpenBtn = document.querySelector("[data-seo-open]");
    var seoModal = document.getElementById("lime-seo-modal");
    if (seoOpenBtn && seoModal) {
        seoOpenBtn.addEventListener("click", function () { seoModal.classList.add("is-open"); });
    }
    document.addEventListener("click", function (e) {
        if (seoModal && e.target.closest("[data-seo-close]")) seoModal.classList.remove("is-open");
    });
    ["lime-seo-title", "lime-seo-desc", "lime-seo-og"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener("input", scheduleAutosave);
    });

    // ===== INIT =====
    showPlaceholderIfEmpty();
    pushHistory(); // зафиксировать стартовое состояние, чтобы первое действие можно было откатить
    autosaveEnabled = true; // автосейв включаем после фиксации стартового снапшота
})();
