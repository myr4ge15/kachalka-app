# Шрифты приложения — Onest и Sofia Sans Condensed (самохостинг)

Редизайн **Aurora Glass** использует **Onest** — современный геометрический
гротеск с полной поддержкой кириллицы, лицензия **SIL Open Font License 1.1**
(бесплатно, в т.ч. для веб-встраивания). Шрифт самохостится со своего origin,
поэтому CSP (`font-src 'self'`) менять не нужно и Google Fonts не задействован.

> ⚠️ Изначально в плане была **Sora** — от неё отказались: у Sora нет
> кириллических глифов (только `latin`/`latin-ext`), и весь русский текст падал
> бы на системный фолбэк. Onest — прямая замена того же «духа» с кириллицей.

## Что положить в эту папку

`src/index.css` (блок `@font-face` вверху файла) ждёт файлы этих начертаний.
Предпочтительно `.woff2` (легче на ~40%), но `.ttf` тоже подхватится — в `src`
перечислены оба формата, грузится первый доступный:

| Начертание | weight | файл |
|------------|--------|------|
| Regular    | 400    | `Onest-Regular.woff2`  (или `.ttf`) |
| SemiBold   | 600    | `Onest-SemiBold.woff2` (или `.ttf`) |
| Bold       | 700    | `Onest-Bold.woff2`     (или `.ttf`) |
| ExtraBold  | 800    | `Onest-ExtraBold.woff2`(или `.ttf`) |

Файлы из `Onest.zip` (Google Fonts → «Download family» даёт статические `.ttf`)
достаточно распаковать и переименовать под имена выше, если они отличаются.
Пока файлов нет — приложение работает на системном фолбэк-стеке
(`system-ui, -apple-system, 'Segoe UI', Roboto`), кириллица остаётся читаемой.

**Сейчас (v6.3.5):** лежат оба формата. `.woff2` сжаты из этих же `.ttf` без
подмножеств (fontTools, все 534 глифа, кириллица на месте) — ~26–28 КБ вместо ~64 КБ.
`.ttf` остаются запасным вариантом во втором `src` и как исходник для пересжатия:
`python -c "from fontTools.ttLib import TTFont; f=TTFont('Onest-Regular.ttf'); f.flavor='woff2'; f.save('Onest-Regular.woff2')"`
(нужны пакеты `fonttools` и `brotli`).

## Sofia Sans Condensed — цифры и заголовки (редизайн «Спорт-блоки», v6)

Сжатый спортивный гротеск с кириллицей (SIL OFL 1.1) для крупных чисел и заголовков
экранов. Лежит готовыми `.woff2` — только нужные начертания и подмножества:

| Начертание | weight | файлы |
|------------|--------|-------|
| ExtraBold  | 800    | `SofiaSansCondensed-ExtraBold-latin.woff2`, `…-cyrillic.woff2` |
| Black      | 900    | `SofiaSansCondensed-Black-latin.woff2`, `…-cyrillic.woff2` |

Подмножества разделены `unicode-range` в `@font-face` (`src/index.css`): браузер качает
кириллический файл только если на экране есть кириллица. Источник — пакет
`@fontsource/sofia-sans-condensed` (статические файлы Google Fonts).

## Лицензия

Onest © The Onest Project Authors, распространяется под SIL Open Font License,
Version 1.1. Положите рядом файл `OFL.txt` из архива шрифта (требование лицензии
при встраивании).

Sofia Sans Condensed © The Sofia Sans Project Authors, SIL Open Font License 1.1 —
текст лицензии в `OFL-SofiaSansCondensed.txt`.
