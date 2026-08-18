# Altitude Code

Минималистичный offline-first редактор кода для iPad. Первая версия работает как PWA: проекты и файлы хранятся в браузере, а весь интерфейс и все языковые модули заранее кэшируются Service Worker.

## Выбранный стек

- **Vite + TypeScript без UI-фреймворка** — небольшой runtime, простой DOM и минимум архитектурных зависимостей для будущего desktop-клиента.
- **CodeMirror 6** — модульный, легче Monaco и рассчитан на browser/touch-ввод. Monaco официально не поддерживает mobile browsers.
- **IndexedDB** — основное долговременное хранилище проектов.
- **localStorage recovery journal** — необязательная синхронная страховочная копия. При недоступном `localStorage` редактор продолжает работать на IndexedDB и показывает статус `Reduced recovery`.
- **vite-plugin-pwa / Workbox** — precache всех production-ресурсов и offline navigation fallback.
- **fflate** — локальный ZIP-экспорт без CDN и сетевых запросов.

Все npm-зависимости входят в production bundle. Runtime-зависимостей от CDN или API нет.

## Возможности MVP

- проекты: создание, выбор, переименование и удаление;
- файлы: создание, переименование, удаление и пути вида `src/App.cs`;
- CodeMirror: номера строк, C#-подсветка, отступы, Tab, Undo/Redo, поиск, автозакрытие скобок и кавычек;
- простые C# completion-подсказки для ключевых слов и `Console.*`;
- языковые режимы C#, Python, JavaScript, TypeScript, HTML, CSS, JSON и plain text;
- IndexedDB-автосохранение через 350 мс и принудительный flush при скрытии/закрытии приложения;
- восстановление незаписанных изменений из аварийного журнала;
- восстановление последнего открытого проекта и файла;
- ZIP-экспорт с обычной файловой структурой;
- responsive explorer для landscape и portrait;
- полный production precache для запуска без сети.

## Запуск на Linux

Требуется Node.js 20 или новее.

```bash
cd "/home/euo/Код/Ide для Ipad"
npm install
npm run dev
```

Открыть `http://localhost:5173`. Development-режим предназначен для разработки, а offline нужно проверять на production-сборке.

## Production build

```bash
npm test
npm run build
npm run preview
```

Готовый статический сайт находится в `dist/`. Его можно разместить на любом HTTPS static hosting без отдельного backend.

## Установка на iPad

Service Worker в Safari требует **HTTPS**. Адрес вида `http://192.168.x.x:4173` подходит для просмотра интерфейса, но не гарантирует установку offline-кэша.

1. Разместить содержимое `dist/` на HTTPS-адресе или отдать его из локальной сети через HTTPS-сервер с доверенным iPad сертификатом.
2. Один раз открыть адрес в Safari при наличии сети.
3. Дождаться индикатора `Offline cached` в верхней панели.
4. В Safari выбрать **Share → Add to Home Screen**.
5. Запустить Altitude с домашнего экрана, создать файл и дождаться статуса `Saved`.
6. Включить авиарежим и повторно открыть приложение.

Не очищайте Website Data для адреса приложения: Safari удалит вместе с ним IndexedDB. Регулярный `Export ZIP` остаётся независимой резервной копией.

## Архитектура

```text
src/
  autocomplete/   простые и будущие completion providers
  components/     UI приложения
  editor/         CodeMirror adapter, темы и language adapters
  filesystem/     ZIP и будущий import/export
  projects/       платформонезависимые модели проекта и файлов
  storage/        IndexedDB, recovery journal, save coordinator
public/
  icons/           локальные PWA-ресурсы
```

`Project`, `ProjectFile`, определение языка и export-логика не зависят от UI-фреймворка. Это оставляет возможность позже переиспользовать модели и editor adapters в desktop-оболочке, не превращая текущий MVP в Linux IDE раньше времени.

## Проверки

```bash
npm run check
npm test
npm run build
```

Тесты проверяют сохранение/восстановление проекта в IndexedDB и восстановление одновременных незаписанных правок нескольких файлов.
