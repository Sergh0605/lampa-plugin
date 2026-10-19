# AGENTS.md — lampa_plugins

Коллекция плагинов Lampa. Один плагин = одна папка. Без npm-сборки, vanilla JS.

## Layout

- `plugins/<name>/<name>.js` — entry point, имя папки = имя файла.
- Рядом по мере роста: `component.js`, `api.js`, `css/style.css`.
- Дистрибутив — один IIFE-файл, без `import`/`require`/бандлера.

## Plugin contract (не нарушать)

- Работать только через `window.Lampa`: `Listener, Storage, Reguest (через new), Lang, Template, Activity, Component, SettingsApi, Manifest, Player/PlayerVideo, Select/Modal/Noty`.
- Guard обязателен:
```js
function startMyPlugin(){ window.my_plugin_ready = true; /* ... */ function init(){ /* Template/Lang/Component/Settings/Menu */ } if (window.appready) init(); else Lampa.Listener.follow('app', function(e){ if(e.type=='ready') init(); }); }
if(!window.my_plugin_ready) startMyPlugin();
```
- Не вызывать `Activity.push()`, не читать `.menu__list`, не трогать Settings вне `init()`.
- Сеть — только `Lampa.Reguest`, хранение — только `Lampa.Storage`, CSS — инжект через `Lampa.Template`. `fetch/localStorage` не использовать.
- `SettingsApi`: для `type:'input'` обязательно `values:''` (пустая строка). Без него рендер настроек падает `Cannot read properties of undefined (reading '<значение>')`: Lampa делает `d$a[name]=values`, а показ ищет `d$a[name][value]`.
- Секреты: проект локальный, без публикации наружу. Креды, секреты и адреса сервисов в коде допустимы (дефолты в `DEFAULTS` + `SettingsApi`). Уборку секретов делать только отдельной задачей, не по умолчанию.

## Ручной тест (единственный способ, только вручную)

- Фиксированные порты, не менять: Lampa web (`androschuk/lampa`, внутри `:80`) → `9100`, коллектор логов → `9101`.
  Адресация с тестового ПК: все сервисы доступны только через `192.168.1.1:<порт>` (проброс портов на роутере).
  Везде использовать `192.168.1.1`, не адрес сервера (`192.168.1.41`) и не `localhost`:
  Lampa `http://192.168.1.1:9100`, плагин `http://192.168.1.1:8192/lampa-test/<name>.js`, коллектор `http://192.168.1.1:9101/log`.
- Состав: `docker-compose.test.yml` в корне репо (`lampa:9100` + `log-collector:9101`), боевой `~/docker/docker-compose.yml` не трогать.
  Существующая инфра: `media-server` (`nginx:alpine`, `8192:80`, root `/mnt/storage/media`, CORS `*`), реальный qBittorrent для ручных прогонов.
- Жизненный цикл: контейнеры поднимаются один раз и живут между итерациями отладки. `down/rm` — только по явной команде «закончили».
  Каждая итерация: правка → `__BUILD__=<timestamp>` в файл → `cp plugins/<name>/<name>.js /mnt/storage/media/lampa-test/<name>.js` →
  проверка `curl → 200` → жёсткая перезагрузка страницы Lampa (Ctrl+F5).
- URL плагина стабильный, в Lampa → Расширения прописывается один раз (список расширений хранится в браузере под origin `http://192.168.1.1:9100`,
  рестарт контейнеров его не стирает). Query `?run=` в URL не добавлять, для корреляции использовать маркер `__BUILD__` в логах.
- В `lampa-test/` — один файл на время теста, после цикла стереть. Тест только на реальном qBittorrent.
- ЗАПРЕЩЕНО создавать/изменять/удалять любые другие файлы в `/mnt/storage/media/` (`movies/`, `tvshows/`, `*.js` в корне).
  ЗАПРЕЩЕНО править `~/docker/docker-compose.yml` и `~/docker/media-server/nginx.conf`.

## Логи

- `docker logs lampa` бесполезны: код выполняется в браузере на другой машине в LAN. Логи пишет сам плагин.
- Контракт логов: `console.log('<Name>', ...)` + POST через `Lampa.Reguest.silent` на коллектор (`SettingsApi`: `debug` вкл, `collectorUrl` дефолт `http://192.168.1.1:9101/log`).
  Логировать без пароля: `init BUILD`, `fetch start/ok(count)/fail(status)`, `render match` каждый + сводка `miss` (не чаще 1 на 25 рендеров), `highlight applied/removed`.
  Отправка на коллектор — только батчами через отдельный `Lampa.Reguest`, флеш не чаще 1 раза в 2 с, стоп после 5 подряд fails. POST на каждый рендер ЗАПРЕЩЕН — вешает страницу.
- Хранение: файл на хосте (читает агент, пользователь не читает). Ротация вручную при необходимости.

## Проверок нет

- `npm test/lint/typecheck` нет. Проверка = отсутствие синтаксических ошибок + ручной тест в Lampa по URL выше.
