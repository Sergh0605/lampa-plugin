# Воспроизведение торрентов из списка qBittorrent

## Цель

Enter на строке торрента в экране qBittorrent запускает воспроизведение **как в списках
торрентов фильмов**: через TorrServer пользователя, в нативном `Lampa.Player`,
с нативным запоминанием места (resume через `Lampa.Timeline`).

## Проверенные факты (app.min.js текущей сборки + официальные доки Lampa)

- `Lampa.TorrServer` **не** торчит наружу; вместо него — прямые HTTP-вызовы к TorrServer
  через `new Lampa.Reguest()` (auth Basic подставляет сам `Reguest`, если URL совпадает
  с настроенным `torrserver_url[_two]` и включён `torrserver_auth`).
- Добавление: `POST {ts}/torrents`, JSON `{action:"add", link, title:"[LAMPA] "+title,
  poster, data, save_to_db, category}` (дословно как ядро).
- Стрим: `{ts}/stream/<urlencode(basename)>?link=<infohash>&index=<fileId>&play`
  (GST-вариант: `{ts}/gst/<hash>/master.m3u8?index=<id>&audio=0`, если включён `torrserver_gts`).
- Файлы: `POST {ts}/torrents`, JSON `{action:"get", hash}` → `file_stats[]` (индексы брать только отсюда).
- Плеер: `Lampa.Player.play({url, title, torrent_hash, id?, timeline?})` — ядро само определяет
  торрент-стрим, ведёт heartbeat/статистику, разруливает webOS/Android/GST.
- Resume нативный: `Lampa.Timeline.view(fileHash)` читает `{time, duration}`;
  `fileHash = Lampa.Utils.hash(path)` по правилу ядра (`is_file` → hash от `path`);
  сохранение и диалог «Начать с HH:MM?» крутит само ядро (`needToContinue`,
  настройка `player_timeurstamp` пользователя).
- Магниты: `magnet_uri` из qB (`/torrents/info`); фолбэк — `magnet:?xt=urn:btih:<infohash_v1>`.

## Архитектура

- qBittorrent остаётся только источником magnet'а и статусов (подсветка/управление — без изменений).
- Никаких прямых файловых URL, никакого nginx-маппинга, никаких sequential-хаков, своего resume-стора нет.
- Весь код — в существующий один IIFE-файл (`plugins/local_torrents_highlight/local_torrents_highlight.js`), без бандлера (контракт AGENTS.md).

## Шаги

0. **Верификация в коде сборки** (без гаданий, grep по `app.min.js` из контейнера `lampa-test`):
   - [ ] опциональность `category`/`save_to_db` в `add` (что если не слать);
   - [ ] триггер нативного файлового браузера (`torrent_file list_open`) — можно ли вызвать напрямую; если нет → фолбэк: свой `Select` по `file_stats`;
   - [ ] точная форма ответа `Timeline.view(hash)` при отсутствии записи;
   - [ ] при каких условиях save loop пишет без предзаданного `timeline` (важно для первого просмотра);
    - [ ] условие GST (`x$x` рядом с `Storage.field("torrserver_gts")`);
   - [ ] `Lampa.Utils.hash` доступен из плагина (ожидается да: `window.Lampa={...,Utils,...}`).
 1. **Код** (всё в существующий один IIFE-файл):
   - `getMagnet(rec)`: `magnet_uri` → фолбэк infohash-магнит;
   - `tsAdd()`: payload дословно как у ядра;
   - `tsFiles()`: `{action:"get", hash}` → `file_stats`;
   - `streamUrl()`: формула ядра + GST-ветка по итогам шага 0 ;
   - `resolveFile()`: 1 видеофайл → играть сразу с его `index`; несколько → нативный браузер, иначе свой `Select` (имя + размер, дефолт — самый большой);
   - Enter на строке → цепочка выше → `Player.play({url, title, torrent_hash, id, timeline})`.
2. **Ошибки**: TorrServer недоступен / не добавился → `Noty {style:'error'}` + запись в лог коллектора (без секретов).
3. **Тест-матрица вручную** (флоу: `__BUILD__` → `lampa-test` → `curl 200` → Ctrl+F5):
   - новый торрент не из клиента (чистый magnet);
   - докачанный (Аватар);
   - недокачанный (прогресс<1 — нужен живой кейс; если нет, пометить непокрытым);
   - мультифайл (MobLand S01 — файловый браузер/пикер);
   - resume: стоп на середине → играть → нативный диалог → сверить продолжение;
   - TorrServer выключен → внятная ошибка без зависаний;
   - пульт: Enter/Назад/выход из плеера.
4. **После реализации**: пара строк в `AGENTS.md` (играем только через TorrServer пользователя,
   никаких прямых файловых URL) + коммит в `release/3.0` + пуш.

## Не входит в v1

Свои resume-сторы/модалки, TorrServer-транскодинг как дефолт, «следующая серия» автоматом,
удаление из TorrServer после просмотра, IPTV/webOS-особенности сверх того что делает ядро.

## Проверено вручную

- [ ] (заполняется по ходу тестов)
