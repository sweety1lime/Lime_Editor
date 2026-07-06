# Вендоры публикации: лицензии и почему выбраны именно они

Все рантаймы шипятся self-hosted из `wwwroot/js/vendor/` (CSP публикаций: `script-src 'self'`, CDN запрещён).

| Вендор | Версия | Лицензия | Зачем |
|---|---|---|---|
| GSAP core | 3.12.5 | Standard "no charge" | reveal/parallax/pin/scrub-сцены (`lime-animate.js`) |
| ScrollTrigger | 3.12.5 | Standard "no charge" | scroll-хореография |
| SplitType | 0.3.4 | **MIT** | split-типографика (строки/слова/буквы) |
| Lenis | 1.3.4 | **MIT** | инерционный скролл (`theme.motion.smooth`) |
| lottie-web (light) | 5.12.2 | **MIT** | нативный Lottie-блок (`lime-lottie.js`, только same-origin .json) |
| Sortable | — | MIT | только редактор (dnd), в публикацию не шипится |

## Почему SplitType, а не GSAP SplitText

С GSAP 3.13 (после покупки Webflow, 2025) все бонус-плагины формально бесплатны, но новая
Standard-лицензия содержит оговорку про продукты, **конкурирующие с Webflow** — конструктор
сайтов под неё подпадает напрямую. Поэтому:

- новые возможности закрываем MIT-альтернативами: **SplitType** (split-типографика),
  **Lenis** (smooth scroll) — нулевой лицензионный риск;
- GSAP core + ScrollTrigger 3.12.x уже шипились до смены лицензии; **TODO: перед коммерческим
  запуском перепроверить условия GSAP Standard License для site-builder-использования**
  (вариант отхода: IntersectionObserver-reveal + CSS scroll-driven animations, либо Motion (MIT)).

## Самописное (без вендора)

- `lime-webgl.js` — WebGL1-частицы и hover-искажение картинок, ~350 строк, без three.js.
- `lime-loader.js` — прелоадер; `lime-polish.js` — курсор/магнит-кнопки/прогресс; `lime-pages.js` — шторка переходов.
