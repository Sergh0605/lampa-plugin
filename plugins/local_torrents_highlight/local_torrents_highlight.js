(function() {
    function startLocalTorrentsHighlight() {
        window.local_torrents_highlight_ready = true;

        var network = new Lampa.Reguest();
        var apiNet = new Lampa.Reguest();

        // Маркер сборки: обновляется каждую итерацию отладки (см. AGENTS.md).
        // По нему агент отличает логи нового прогона от старых.
        var __BUILD__ = '2026-10-19T03-10';

        // Локальная разработка без публикации наружу:
        // креды, секреты и адреса сервисов в коде допустимы.
        // Уборку секретов делаем позже отдельной задачей.
        var DEFAULTS = {
            host: '192.168.1.1',
            port: '8192',
            username: 'admin',
            password: '7P3frRpJe5D@JUk',
            enabled: true,
            debug: true,
            collectorUrl: 'http://192.168.1.1:9101/log'
        };

        // Категории для закачки — только эти две (решение пользователя).
        var CATS = ['Фильмы', 'Сериалы'];

        // Состояния qBittorrent v5.x (новые stopped* + старые paused* для совместимости).
        var DL_STATES = ['downloading', 'metadl', 'stalledDL', 'checkingDL', 'allocating',
            'queuedDL', 'forcedDL', 'checkingResumeData', 'moving'];
        var UP_STATES = ['uploading', 'stalledUP', 'checkingUP', 'queuedUP', 'forcedUP'];

        var KIND = {
            dl:      { cls: 'torrent-downloading',    icon: '⬇', label: 'Качается' },
            up:      { cls: 'torrent-seeding',        icon: '⬆', label: 'Раздаётся' },
            done:    { cls: 'torrent-stopped-done',   icon: '⏸', label: 'Скачан · остановлен' },
            stopped: { cls: 'torrent-stopped-undone', icon: '⏸', label: 'Остановлен · не докачан' }
        };

        // comment(url) -> {hash, state, progress, name, dlspeed, upspeed, eta}
        var torrentMap = {};
        var lastStateByHash = {};
        var urlsLoaded = false;
        var pendingItems = [];
        var isFetching = false;
        var fetchStartAt = 0;
        var fetchOkOnce = false;
        var visibleItems = [];
        var pollTimer = 0;

        function isEnabled() {
            return Lampa.Storage.field('local_torrents_highlight_enabled') !== false;
        }

        function buildApiUrl(path) {
            var host = Lampa.Storage.field('local_torrents_highlight_host') || DEFAULTS.host;
            var port = Lampa.Storage.field('local_torrents_highlight_port') || DEFAULTS.port;
            return 'http://' + host + ':' + port + '/qbittorrent/api/v2' + path;
        }

        function buildAuthHeaders() {
            var username = Lampa.Storage.field('local_torrents_highlight_username');
            var password = Lampa.Storage.field('local_torrents_highlight_password');
            if (username === '' || username === undefined || username === null) username = DEFAULTS.username;
            if (password === '' || password === undefined || password === null) password = DEFAULTS.password;
            if (username && password) {
                try {
                    return { 'Authorization': 'Basic ' + btoa(username + ':' + password) };
                } catch (e) { /* btoa недоступен */ }
            }
            return {};
        }

        function resetCache() {
            urlsLoaded = false;
            torrentMap = {};
            pendingItems = [];
            isFetching = false;
            try { network.clear(); } catch (e) {}
        }

        function isDebug() {
            return Lampa.Storage.field('local_torrents_highlight_debug') !== false;
        }

        function collectorUrl() {
            return Lampa.Storage.field('local_torrents_highlight_collector') || DEFAULTS.collectorUrl;
        }

        function shortGuid(guid) {
            guid = String(guid || '');
            return guid.length > 48 ? guid.slice(0, 36) + '...' : guid;
        }

        function esc(s) {
            return String(s === undefined || s === null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function formatSize(b) {
            b = Number(b) || 0;
            if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' ГБ';
            if (b >= 1048576) return Math.round(b / 1048576) + ' МБ';
            if (b >= 1024) return Math.round(b / 1024) + ' КБ';
            return b + ' Б';
        }

        function formatSpeed(b) {
            b = Number(b) || 0;
            if (b >= 1048576) return (b / 1048576).toFixed(1) + ' МБ/с';
            if (b >= 1024) return Math.round(b / 1024) + ' КБ/с';
            return b + ' Б/с';
        }

        function formatEta(s) {
            s = Number(s);
            if (!isFinite(s) || s < 0 || s >= 8640000) return '—';
            var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
            if (h > 0) return h + ' ч ' + m + ' мин';
            if (m > 0) return m + ' мин';
            return 'меньше минуты';
        }

        // Контракт логов (см. AGENTS.md):
        // console.log для DevTools + батч-POST на коллектор для агента.
        // Пароль и заголовки авторизации никогда не логируем.
        // Отдельный Reguest и очередь с флешем не чаще 1 раза в 2с —
        // иначе шторм запросов вешает страницу.
        var logNet = new Lampa.Reguest();
        var logQueue = [];
        var logFlushTimer = 0;
        var logFailStreak = 0;
        var renderTotal = 0;
        var renderMatched = 0;

        function log(level, msg, data) {
            var line = '[LocalTorrentsHighlight:' + __BUILD__ + '] ' + level + ' ' + msg
                + (data === undefined || data === null ? '' : ' ' + data);
            try {
                if (level === 'error') console.error(line);
                else console.log(line);
            } catch (e) {}
            if (!isDebug()) return;
            if (logFailStreak >= 5) return; // коллектор мёртв — не спамим
            logQueue.push({ build: __BUILD__, level: level, msg: String(msg).slice(0, 1200), data: String(data === undefined || data === null ? '' : data).slice(0, 1200) });
            if (logQueue.length > 200) logQueue.splice(0, logQueue.length - 200);
            if (!logFlushTimer) {
                logFlushTimer = setTimeout(function() {
                    logFlushTimer = 0;
                    flushLogs();
                }, 2000);
            }
        }

        function flushLogs() {
            if (!logQueue.length) return;
            var batch = logQueue.splice(0, 50);
            try {
                logNet.silent(
                    collectorUrl(),
                    function() { logFailStreak = 0; if (logQueue.length && !logFlushTimer) { logFlushTimer = setTimeout(function() { logFlushTimer = 0; flushLogs(); }, 2000); } },
                    function() { logFailStreak++; if (logQueue.length && !logFlushTimer) { logFlushTimer = setTimeout(function() { logFlushTimer = 0; flushLogs(); }, 2000); } },
                    JSON.stringify(batch),
                    { timeout: 5000 }
                );
            } catch (e) {}
        }

        function stateKind(state, progress) {
            if (DL_STATES.indexOf(state) !== -1) return 'dl';
            if (UP_STATES.indexOf(state) !== -1) return 'up';
            if ((Number(progress) || 0) >= 1) return 'done';
            return 'stopped';
        }

        // Пин optimistичного статуса: refetch сразу после действия может вернуть
        // ещё не применённое состояние (стоп применяется секундами) и мигнуть
        // бейджем обратно. Пин держит показ 15 с, серверное подтверждение приходит следом.
        var pinnedKind = {}; // hash -> {kind, until}
        function pinKind(hash, kind, ms) {
            if (!hash) return;
            pinnedKind[hash] = { kind: kind, until: Date.now() + (ms || 15000) };
            try {
                var ks = Object.keys(pinnedKind);
                if (ks.length > 50) { for (var i = 0; i < ks.length - 50; i++) delete pinnedKind[ks[i]]; }
            } catch (e) {}
        }
        function unpinKind(hash) { try { delete pinnedKind[hash]; } catch (e) {} }
        function pinnedOr(kind, hash) {
            try {
                var p = pinnedKind[hash];
                if (p && Date.now() < p.until) return p.kind;
                if (p) delete pinnedKind[hash];
            } catch (e) {}
            return kind;
        }

        // ---------- ЗАПРОС К QBITTORRENT (фоном, без оверлея) ----------
        function fetchTorrents(callback) {
            fetchStartAt = Date.now();
            if (!isEnabled()) {
                urlsLoaded = true;
                torrentMap = {};
                callback([]);
                return;
            }

            network.silent(
                buildApiUrl('/torrents/info'),
                function(data) {
                    try {
                        var map = {};
                        (data && data.length ? data : []).forEach(function(t) {
                            if (t.comment && t.comment.indexOf('http') === 0) {
                                var prev = lastStateByHash[t.hash];
                                if (prev && prev !== t.state) {
                                    log('info', 'state changed', shortGuid(t.name) + ' ' + prev + ' -> ' + t.state);
                                }
                                map[t.comment] = {
                                    hash: t.hash, state: t.state, progress: t.progress,
                                    name: t.name, dlspeed: t.dlspeed, upspeed: t.upspeed, eta: t.eta,
                                    size: t.size, comment: t.comment || ''
                                };
                            }
                        });
                        torrentMap = map;
                        fetchOkOnce = true;
                        var fresh = {};
                        Object.keys(map).forEach(function(c) { fresh[map[c].hash] = map[c].state; });
                        lastStateByHash = fresh;
                        try { tryStampPending(); } catch (e) {}
                        prevFetchHashes = currentHashes();
                    } catch (e) {
                        torrentMap = {};
                    }
                    urlsLoaded = true;
                    log('info', 'fetch ok', 'count=' + Object.keys(torrentMap).length);
                    callback(torrentMap);
                },
                function(jqXHR) {
                    var code = 'unknown';
                    try { code = network.errorCode(jqXHR); } catch (e) {}
                    urlsLoaded = true;
                    torrentMap = {};
                    log('error', 'fetch fail', 'status=' + code);
                    callback({});
                },
                null,
                { timeout: 8000, dataType: 'json', headers: buildAuthHeaders() }
            );
        }

        function refreshData(done) {
            resetCache();
            isFetching = true;
            fetchTorrents(function() {
                isFetching = false;
                try { updateVisibleBadges(); } catch (e) { log('error', 'update fail', String(e && e.message || e).slice(0, 100)); }
                if (done) done();
            });
        }

        function currentHashes() {
            return Object.keys(torrentMap).map(function(c) { return torrentMap[c].hash; });
        }

        // Простановка коммента после закачки из Lampa.
        // Слепок в момент клика ненадёжен (карта может быть пуста из-за resetCache),
        // поэтому сравниваем ПОСЛЕДОВАТЕЛЬНЫЕ fetch: новый hash = тот, которого
        // не было в прошлом опросе. Лишних запросов нет — проверка на плановых info.
        // Пишем только если там пусто или ссылка (свои пометки не трогаем).
        var pendingStamps = []; // {guid, ts}
        var prevFetchHashes = [];

        function queueStamp(guid) {
            pendingStamps.push({ guid: guid, ts: Date.now() });
            if (pendingStamps.length > 10) pendingStamps.splice(0, pendingStamps.length - 10);
            log('info', 'add bind queued', shortGuid(guid));
        }

        function tryStampPending() {
            if (!pendingStamps.length) return;
            var cur = currentHashes();
            if (!prevFetchHashes.length) return; // базового опроса ещё не было — ждём
            var fresh = cur.filter(function(h) { return prevFetchHashes.indexOf(h) === -1; });
            var now = Date.now();
            var rest = [];
            pendingStamps.forEach(function(p) {
                if (now - p.ts > 5 * 60 * 1000) {
                    log('error', 'add bind expired', shortGuid(p.guid));
                    return;
                }
                rest.push(p);
            });
            if (fresh.length === 1 && rest.length) {
                var p0 = rest.shift();
                var br = null, bks = Object.keys(torrentMap), bi;
                for (bi = 0; bi < bks.length; bi++) {
                    if (torrentMap[bks[bi]].hash === fresh[0]) { br = torrentMap[bks[bi]]; break; }
                }
                var cc = br && br.comment ? String(br.comment) : '';
                if (cc === p0.guid) {
                    log('info', 'add stamped', 'already matches ' + shortGuid(p0.guid));
                } else if (!cc || cc.indexOf('http') === 0) {
                    log('info', 'add bind', shortGuid(p0.guid) + ' -> ' + String(fresh[0]).slice(0, 12));
                        apiPost('/torrents/setComment', { hashes: fresh[0], comment: p0.guid }, 'Комментарий проставлен', null, true);
                } else {
                    log('info', 'add bind skip', 'custom comment kept');
                }
            } else if (fresh.length > 1 && rest.length) {
                log('info', 'add bind ambiguous', 'fresh=' + fresh.length);
            }
            pendingStamps = rest;
        }

        // ---------- БЕЙДЖ СТАТУСА НА СТРОКЕ ----------
        // Бейдж статуса. На строках экрана qBittorrent заполняет штатные слоты
        // (.torrent-item__* как в списке торрентов фильма), на карточках раздач —
        // компактный оверлей поверх существующих деталей.
        function renderBadge(item, rec) {
            try {
                item.removeClass('torrent-downloading torrent-seeding torrent-stopped-done torrent-stopped-undone');
                item.find('.torrent-lth-icon,.torrent-lth-progress,.torrent-lth-stats').remove();
                if (!rec) return;
                var kind = pinnedOr(stateKind(rec.state, rec.progress), rec.hash);
                var meta = KIND[kind];
                item.addClass(meta.cls);
                var det = item.find('.lth-details');
                if (det.length) {
                    var pct = Math.floor((Number(rec.progress) || 0) * 100);
                    var d = '';
                    if (kind === 'dl') d = '<div class="torrent-item__tracker">' + esc(meta.label) + '</div><div class="torrent-item__bitrate">Скорость: <span>' + esc(formatSpeed(rec.dlspeed)) + '</span></div><div class="torrent-item__seeds">Прогресс: <span>' + pct + '%</span></div>';
                    else if (kind === 'up') d = '<div class="torrent-item__tracker">' + esc(meta.label) + '</div><div class="torrent-item__seeds">Отдача: <span>' + esc(formatSpeed(rec.upspeed)) + '</span></div>';
                    else d = '<div class="torrent-item__tracker">' + esc(meta.label) + '</div>';
                    d += '<div class="torrent-item__size">' + esc(formatSize(rec.size)) + '</div>';
                    if (kind === 'dl') d += '<div class="torrent-item__bitrate">Осталось: <span>' + esc(formatEta(rec.eta)) + '</span></div>';
                    det.html(d);
                    item.append($('<div class="torrent-lth-icon">' + meta.icon + '</div>'));
                    if (kind === 'dl') item.append($('<div class="torrent-lth-progress"><i style="width:' + pct + '%"></i></div>'));
                } else {
                    item.append($('<div class="torrent-lth-icon">' + meta.icon + '</div>'));
                    if (kind === 'dl') {
                        var pct2 = Math.floor((Number(rec.progress) || 0) * 100);
                        item.append($('<div class="torrent-lth-progress"><i style="width:' + pct2 + '%"></i></div>'));
                        item.append($('<div class="torrent-lth-stats">' + pct2 + '% · ' + formatSpeed(rec.dlspeed) + ' · осталось ' + formatEta(rec.eta) + '</div>'));
                    } else if (kind === 'up') {
                        item.append($('<div class="torrent-lth-stats">⬆ ' + formatSpeed(rec.upspeed) + '</div>'));
                    }
                }
            } catch (e) {}
        }

        function updateVisibleBadges() {
            visibleItems.forEach(function(p) {
                try {
                    if (!p.item || !p.item.length) return;
                    var node = p.item[0];
                    if (node.ownerDocument && !$.contains(node.ownerDocument, node)) return;
                    renderBadge(p.item, torrentMap[p.guid]);
                } catch (e) {}
            });
            try { qbRefresh(false); } catch (e) {}
        }

        function processPending() {
            if (urlsLoaded && pendingItems.length) {
                var matched = 0;
                pendingItems.forEach(function(p) {
                    var r = torrentMap[p.guid];
                    if (r) matched++;
                    renderBadge(p.item, r);
                });
                log('info', 'pending processed', 'total=' + pendingItems.length + ' matched=' + matched);
                pendingItems = [];
            }
        }

        function onTorrentEvent(event) {
            if (!event || event.type !== 'render') return;
            var element = event.element;
            var item = event.item;
            var guid = element && element.Guid;
            if (!element || !guid || !item) return;
            try {
                if (!item.data('lth-bound')) {
                    item.data('lth-bound', true);
                    item.on('hover:long.lth', function() { openTorrentMenu(element, item); });
                }
            } catch (e) {}
            visibleItems.push({ item: item, guid: guid, element: element });
            if (visibleItems.length > 300) visibleItems.splice(0, visibleItems.length - 300);
            if (urlsLoaded) {
                renderTotal++;
                var live = torrentMap[guid];
                if (live) {
                    renderMatched++;
                    renderBadge(item, live);
                    log('info', 'render match -> highlight applied', shortGuid(guid));
                } else {
                    renderBadge(item, null);
                    // miss не логируем каждый — только сводка, иначе шторм
                    if (renderTotal % 25 === 0) log('info', 'render progress', 'total=' + renderTotal + ' matched=' + renderMatched);
                }
            } else {
                pendingItems.push({ guid: guid, item: item, element: element });
                if (pendingItems.length > 300) pendingItems.shift();
                if (!isFetching) {
                    isFetching = true;
                    log('info', 'fetch start', buildApiUrl('/torrents/info'));
                    fetchTorrents(function() {
                        isFetching = false;
                        try { processPending(); } catch (e) { log('error', 'pending fail', String(e && e.message || e).slice(0, 100)); }
                        // Любой завершившийся fetch обновляет всё, включая экран qBittorrent,
                        // иначе открытый экран так и останется пустым до следующего опроса
                        try { updateVisibleBadges(); } catch (e) { log('error', 'update fail', String(e && e.message || e).slice(0, 100)); }
                    });
                }
            }
        }

        // ---------- ДЕЙСТВИЯ С ТОРРЕНТАМИ ----------
        function apiPost(path, params, actionName, onDone, noToast) {
            apiNet.silent(
                buildApiUrl(path),
                function() {
                    log('info', actionName, 'ok');
                    if (!noToast) { try { Lampa.Noty.show(actionName + ' — OK'); } catch (e) {} }
                    // Либо кастомный onDone вызывающей стороны, либо дефолтный refetch.
                    // Оба сразу НЕЛЬЗЯ: второй resetCache() через Reguest.clear() гасит
                    // колбэк первого запроса, и привязка/обновление теряются молча.
                    if (onDone) onDone(true);
                    else refreshData();
                },
                function(jqXHR) {
                    var code = 'unknown';
                    try { code = apiNet.errorCode(jqXHR); } catch (e) {}
                    log('error', actionName, 'fail status=' + code);
                    try { Lampa.Noty.show('Ошибка: ' + actionName + ' (' + code + ')', { style: 'error' }); } catch (e) {}
                    if (onDone) onDone(false);
                },
                params,
                // dataType text: экшены qBittorrent отвечают пустым телом/"Ok.",
                // с dataType json jQuery роняет parsererror при статусе 200
                { timeout: 10000, dataType: 'text', headers: buildAuthHeaders() }
            );
        }

        function lastCategory() {
            var c = '';
            try { c = Lampa.Storage.get('local_torrents_highlight_lastcat', ''); } catch (e) {}
            if (CATS.indexOf(c) === -1) c = CATS[0];
            return c;
        }

        function orderedCats() {
            var last = lastCategory();
            var list = CATS.slice();
            list.sort(function(a, b) { return (a === last ? -1 : 0) - (b === last ? -1 : 0); });
            return list;
        }

        function statusLine(rec) {
            var kind = stateKind(rec.state, rec.progress);
            var pct = Math.floor((Number(rec.progress) || 0) * 100);
            if (kind === 'dl') return KIND.dl.label + ' ' + pct + '% · ' + formatSpeed(rec.dlspeed) + ' · осталось ' + formatEta(rec.eta);
            if (kind === 'up') return KIND.up.label + ' · ⬆ ' + formatSpeed(rec.upspeed);
            return KIND[kind].label;
        }

        function prevControllerName() {
            try {
                var c = Lampa.Controller.enabled();
                if (c && c.name) return c.name;
            } catch (e) {}
            return '';
        }

        function resolveMagnet(element) {
            var m = (element.MagnetUri || '').replace(/^\s+|\s+$/g, '');
            if (m) return { magnet: m, src: 'magneturi' };
            var h = String(element.InfoHash || '').replace(/^\s+|\s+$/g, '');
            // Голый infohash качается через DHT — трекеры подтянутся с пиров
            if (/^[0-9a-fA-F]{40}$/.test(h)) return { magnet: 'magnet:?xt=urn:btih:' + h.toLowerCase(), src: 'infohash' };
            var link = String(element.Link || '');
            // Jackett отдаёт .torrent через /dl/ без ".torrent" в пути: /dl/<трекер>/?jackett_apikey=..&file=...torrent
            if (/\.torrent/i.test(link) || link.indexOf('/dl/') !== -1) return { magnet: link, src: 'link' };
            return { magnet: '', src: 'none' };
        }

        // Возврат фокуса на строку нашего экрана после закрытия меню/диалога.
        // Без этого после Back фокус висит в пустоте и стрелки «молчат».
        function qbRefocus(item) {
            try {
                if (!item || !item.length || !item.hasClass || !item.hasClass('lth-row') || !qbScroll) return;
                if (!$.contains(document, item[0])) return; // строку уже перестроили — фокусом займётся ребилд
                Lampa.Controller.toggle('content');
                Lampa.Controller.collectionFocus(item[0], qbScroll.render());
            } catch (e) {}
        }

        function openTorrentMenu(element, item) {
            var guid = element.Guid;
            var name = element.Title || element.title || shortGuid(guid);
            var rec = torrentMap[guid];
            var back = prevControllerName();

            function onBack() {
                if (back) { try { Lampa.Controller.toggle(back); } catch (e) {} }
                qbRefocus(item);
            }

            if (!rec) {
                // Новый торрент: выбор категории = сразу закачка (один клик).
                // MagnetUri у парсера часто пуст — фолбэки: InfoHash -> DHT-magnet, Link -> .torrent-файл
                var src = resolveMagnet(element);
                if (!src.magnet) {
                    log('error', 'add skip', 'guid=' + shortGuid(guid) + ' link=' + String(element.Link || '').slice(0, 300) + ' details=' + String(element.Details || '').slice(0, 200) + ' infohash=' + shortGuid(element.InfoHash));
                    try { Lampa.Noty.show('Нет magnet-ссылки для закачки', { style: 'error' }); } catch (e) {}
                    return;
                }
                var items = orderedCats().map(function(cat) {
                    return { title: '⬇ Скачать в «' + cat + '»', act: 'add', cat: cat };
                });
                try {
                    Lampa.Select.show({
                        title: String(name).slice(0, 80),
                        items: items,
                        onBack: onBack,
                        onSelect: function(sel) {
                            try { Lampa.Select.close(); } catch (e) {}
                            if (!sel || !sel.act) return;
                            if (sel.act === 'add' && sel.cat) {
                                log('info', 'add via', src.src + ' cat=' + sel.cat);
                                addTorrent(src.magnet, sel.cat, String(name).slice(0, 80), guid);
                            }
                        }
                    });
                } catch (e) {
                    log('error', 'menu open fail', String(e && e.message || e).slice(0, 200));
                }
                return;
            }

            // Существующий торрент
            var kind = stateKind(rec.state, rec.progress);
            var toggleTitle = (kind === 'dl' || kind === 'up') ? '⏸ Остановить' : '▶ Продолжить';
            var menu = [
                { title: toggleTitle, act: 'toggle' },
                { title: '↻ Обновить статус', act: 'refresh' },
                { title: '🗑 Удалить с файлами', act: 'delete' }
            ];
            try {
                Lampa.Select.show({
                    title: String(rec.name || name).slice(0, 60) + ' — ' + statusLine(rec),
                    items: menu,
                    onBack: onBack,
                    onSelect: function(sel) {
                        try { Lampa.Select.close(); } catch (e) {}
                        if (!sel || !sel.act) return;
                        if (sel.act === 'toggle') {
                            var toStop = (kind === 'dl' || kind === 'up');
                            // Оптимистично красим сразу, подтверждение приедет опросом;
                            // при ошибке — откат к прежнему состоянию
                            var live = torrentMap[guid];
                            var prevState = live ? live.state : '';
                            if (live) {
                                live.state = toStop
                                    ? ((Number(live.progress) || 0) >= 1 ? 'stoppedUP' : 'stoppedDL')
                                    : ((Number(live.progress) || 0) >= 1 ? 'uploading' : 'downloading');
                                pinKind(live.hash, toStop ? ((Number(live.progress) || 0) >= 1 ? 'done' : 'stopped') : ((Number(live.progress) || 0) >= 1 ? 'up' : 'dl'), 15000);
                                try { renderBadge(item, live); updateVisibleBadges(); } catch (e) {}
                            }
                            var afterToggle = function(ok) {
                                if (!ok && live) {
                                    live.state = prevState;
                                    unpinKind(live.hash);
                                    try { renderBadge(item, live); updateVisibleBadges(); } catch (e) {}
                                    log('info', 'toggle revert', prevState);
                                } else if (ok) {
                                    refreshData();
                                }
                            };
                            if (toStop) apiPost('/torrents/stop', { hashes: rec.hash }, 'Остановлен', afterToggle);
                            else apiPost('/torrents/start', { hashes: rec.hash }, 'Запущен', afterToggle);
                        } else if (sel.act === 'refresh') {
                            refreshData();
                            try { Lampa.Noty.show('Статус обновлён'); } catch (e) {}
                        } else if (sel.act === 'delete') {
                            confirmDelete(rec, guid, item);
                        }
                    }
                });
            } catch (e) {
                log('error', 'menu open fail', String(e && e.message || e).slice(0, 200));
            }
        }

        function addTorrent(magnet, category, name, guid) {
            log('info', 'add start', 'cat=' + category + ' ' + shortGuid(name));
            apiPost('/torrents/add', { urls: magnet, category: category }, 'Добавлено в «' + category + '»', function(ok) {
                if (ok) {
                    try { Lampa.Storage.set('local_torrents_highlight_lastcat', category); } catch (e) {}
                    // Ключ в comment для будущей сверки — подхватится ближайшим info
                    queueStamp(guid);
                    refreshData();
                }
            });
        }

        function confirmDelete(rec, guid, item) {
            var label = String(rec.name || rec.hash).slice(0, 80);
            try {
                Lampa.Modal.open({
                    title: 'Удалить с файлами?',
                    html: $('<div style="padding:1em">' + esc(label) + '<br><br>Торрент и все файлы будут удалены с диска.</div>'),
                    buttons: [
                        { name: 'Отмена', onSelect: function() { try { Lampa.Modal.close(); } catch (e) {} qbRefocus(item); } },
                        { name: 'Да, удалить', onSelect: function() {
                            try { Lampa.Modal.close(); } catch (e) {}
                            var backup = torrentMap[guid];
                            try { delete torrentMap[guid]; renderBadge(item, null); updateVisibleBadges(); } catch (e) {}
                            apiPost('/torrents/delete', { hashes: rec.hash, deleteFiles: 'true' }, 'Удалён с файлами', function(ok) {
                                if (!ok && backup) {
                                    torrentMap[guid] = backup;
                                    try { renderBadge(item, backup); updateVisibleBadges(); } catch (e) {}
                                    log('info', 'delete revert', shortGuid(guid));
                                    qbRefocus(item);
                                } else if (ok) {
                                    refreshData(function() {
                                        try {
                                            if (!qbActive || !qbHtml || !qbScroll) return;
                                            var first = qbHtml.find('.lth-row.selector').first();
                                            if (first.length) {
                                                Lampa.Controller.toggle('content');
                                                Lampa.Controller.collectionFocus(first[0], qbScroll.render());
                                            }
                                        } catch (e) {}
                                    });
                                }
                            });
                        } }
                    ]
                });
            } catch (e) {
                log('error', 'delete modal fail', String(e && e.message || e).slice(0, 200));
            }
        }

        function init() {
            Lampa.Lang.add({
                local_torrents_highlight_settings: { ru: 'Подсветка локальных торрентов', en: 'Local torrents highlight' },
                local_torrents_highlight_enabled: { ru: 'Включить подсветку', en: 'Enable highlight' },
                local_torrents_highlight_host: { ru: 'Хост qBittorrent (nginx)', en: 'qBittorrent host (nginx)' },
                local_torrents_highlight_port: { ru: 'Порт nginx', en: 'Nginx port' },
                local_torrents_highlight_username: { ru: 'Логин', en: 'Username' },
                local_torrents_highlight_password: { ru: 'Пароль', en: 'Password' },
                local_torrents_highlight_debug: { ru: 'Отладка (логи на коллектор)', en: 'Debug (logs to collector)' },
                local_torrents_highlight_collector: { ru: 'URL коллектора логов', en: 'Log collector URL' }
            });

            Lampa.Template.add('local_torrents_highlight_css', [
                '<style>',
                '.torrent-item.torrent-downloading {',
                ' background-color: rgba(255,200,0,0.18) !important;',
                ' border-left: 4px solid #ffcc00;',
                '}',
                '.torrent-item.torrent-seeding {',
                ' background-color: rgba(0,255,0,0.20) !important;',
                ' border-left: 4px solid #00ff00;',
                '}',
                '.torrent-item.torrent-stopped-done {',
                ' background-color: rgba(0,150,255,0.18) !important;',
                ' border-left: 4px solid #0090ff;',
                '}',
                '.torrent-item.torrent-stopped-undone {',
                ' background-color: rgba(255,60,60,0.15) !important;',
                ' border-left: 4px solid #ff4444;',
                '}',
                '.torrent-lth-icon {',
                ' position: absolute;',
                ' top: 0.6em;',
                ' right: 0.8em;',
                ' font-size: 1.4em;',
                ' font-weight: bold;',
                ' text-shadow: 0 0 5px #000;',
                '}',
                '.torrent-lth-progress {',
                ' height: 0.35em;',
                ' background: rgba(255,255,255,0.15);',
                ' margin: 0.6em 0 0;',
                ' border-radius: 0.3em;',
                ' overflow: hidden;',
                '}',
                '.torrent-lth-progress i {',
                ' display: block;',
                ' height: 100%;',
                ' background: #ffcc00;',
                '}',
                '.torrent-lth-stats {',
                ' font-size: 11px;',
                ' color: #ccc;',
                ' padding: 0 6px 4px;',
                '}',
                '.lth-screen {',
                ' padding: 0 1.5em;',
                '}',
                '.lth-screen-title {',
                ' padding: 0.5em 0;',
                ' font-size: 1.4em;',
                ' font-weight: bold;',
                ' color: #fff;',
                '}',
                '</style>'
            ].join(''));

            $('body').append(Lampa.Template.get('local_torrents_highlight_css', {}, true));

            Lampa.SettingsApi.addComponent({
                component: 'local_torrents_highlight',
                name: Lampa.Lang.translate('local_torrents_highlight_settings'),
                icon: '<svg width="44" height="44" viewBox="0 0 44 44" fill="none"><rect x="6" y="6" width="32" height="32" rx="6" stroke="currentColor" stroke-width="2"/><path d="M15 22l5 5 9-10" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_enabled', type: 'trigger', default: true },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_enabled') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_host', type: 'input', values: '', placeholder: '192.168.1.1', default: '192.168.1.1' },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_host') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_port', type: 'input', values: '', placeholder: '8192', default: '8192' },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_port') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_username', type: 'input', values: '', placeholder: 'admin', default: 'admin' },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_username') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_password', type: 'input', values: '', placeholder: '7P3frRpJe5D@JUk', default: '7P3frRpJe5D@JUk' },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_password') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_debug', type: 'trigger', default: true },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_debug') },
                onChange: function() { resetCache(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'local_torrents_highlight',
                param: { name: 'local_torrents_highlight_collector', type: 'input', values: '', placeholder: 'http://192.168.1.1:9101/log', default: 'http://192.168.1.1:9101/log' },
                field: { name: Lampa.Lang.translate('local_torrents_highlight_collector') },
                onChange: function() { resetCache(); }
            });

            try {
                Lampa.Storage.listener.follow('change', function(e) {
                    if (e && e.name && e.name.indexOf('local_torrents_highlight_') === 0) resetCache();
                });
            } catch (e) {}

            // ---------- ЭКРАН QBittorrent: все локальные торренты ----------
            var qbScroll = null;
            var qbHtml = null;
            var qbStruct = null;
            var qbFocusedHash = '';
            var qbActive = false;
            var qbMenuAdded = false;

            function QbittorrentScreen() {
                var scroll = new Lampa.Scroll({ mask: true, over: true });
                var html = $('<div class="lth-screen"><div class="lth-screen-title">qBittorrent</div></div>');
                qbScroll = scroll;
                qbHtml = html;
                var _this = this;

                this.create = function() { return this.render(); };
                this.render = function() { return html; };
                this.back = function() { Lampa.Activity.backward(); };
                this.pause = function() {};
                    this.stop = function() { qbActive = false; };
                    this.destroy = function() {
                        qbActive = false;
                        qbScroll = null;
                        qbHtml = null;
                        qbStruct = null;
                        try { scroll.destroy(); } catch (e) {}
                        html.remove();
                    };

                this.setActive = function(el) {
                    try {
                        html.find('.lth-row.selector').removeClass('active');
                        $(el).addClass('active');
                        var h = $(el).data('hash');
                        if (h) qbFocusedHash = h;
                    } catch (e) {}
                };

                this.start = function() {
                    // Контроллер экрана — штатный 'content' (как в myprovider):
                    // тогда нативный down из шапки (toggle('content')) возвращается к нам.
                    // toggle всегда ставит фокус в список (запомненная строка или первая).
                    Lampa.Controller.add('content', {
                        toggle: function() {
                            if (!qbActive) return;
                            try {
                                Lampa.Controller.collectionSet(scroll.render());
                                var sc = scroll.render();
                                var target = null;
                                if (qbFocusedHash) {
                                    var found = sc.find('.lth-row').filter(function() { return $(this).data('hash') === qbFocusedHash; });
                                    if (found.length) target = found[0];
                                }
                                if (target) {
                                    Lampa.Controller.collectionFocus(target, sc);
                                } else {
                                    var first = sc.find('.lth-row.selector').first();
                                    if (first.length) {
                                        first.addClass('active');
                                        qbFocusedHash = first.data('hash') || '';
                                        Lampa.Controller.collectionFocus(first[0], sc);
                                    }
                                }
                            } catch (e) {}
                        },
                        up: function() {
                            var cm = false;
                            try { cm = Navigator.canmove('up'); } catch (e) {}
                            if (cm) Navigator.move('up');
                            else Lampa.Controller.toggle('head');
                        },
                        down: function() {
                            var cm = false;
                            try { cm = Navigator.canmove('down'); } catch (e) {}
                            if (cm) Navigator.move('down');
                            // внизу списка стоим на месте — фокус из списка не уводим
                        },
                        left: function() {
                            if (Navigator.canmove('left')) Navigator.move('left');
                            else Lampa.Controller.toggle('menu');
                        },
                        right: function() {
                            if (Navigator.canmove('right')) Navigator.move('right');
                        },
                        back: this.back
                    });
                    Lampa.Controller.toggle('content');
                    qbActive = true;
                    log('info', 'screen open', 'count=' + Object.keys(torrentMap).length + ' loaded=' + urlsLoaded + ' fetching=' + isFetching);
                    if (!isFetching && (!urlsLoaded || !Object.keys(torrentMap).length)) {
                        isFetching = true;
                        fetchTorrents(function() {
                            isFetching = false;
                            try { updateVisibleBadges(); } catch (e) { log('error', 'update fail', String(e && e.message || e).slice(0, 100)); }
                        });
                    } else if (isFetching) {
                        log('info', 'screen open wait', 'fetch in flight, waiting for it');
                    }
                    qbRefresh(true);
                    // Страховка: если fetch уже идёт или колбэк потерялся — дотянуть
                    // перестройку через пару секунд, пока экран открыт
                    (function() {
                        var n = 0;
                        var wt = setInterval(function() {
                            n++;
                            if (!qbActive || n > 3) { clearInterval(wt); return; }
                            try { qbRefresh(false); } catch (e) {}
                            if (Object.keys(torrentMap).length) clearInterval(wt);
                        }, 1500);
                    })();
                };

                this.load = function() { qbRefresh(true); };
            }

            function qbRow(rec, comment) {
                // Разметка один в один как штатный .torrent-item списка торрентов фильма:
                // тот же масштаб, отступы и правила скролла из коробки.
                var row = $('<div class="torrent-item lth-row selector layer--visible layer--render">'
                    + '<div class="torrent-item__title">' + esc(rec.name) + '</div>'
                    + '<div class="torrent-item__details lth-details"></div>'
                    + '</div>');
                row.data('hash', rec.hash);
                row.data('guid', comment);
                    row.on('hover:focus', function() {
                        try {
                            if (qbHtml) qbHtml.find('.lth-row.selector').removeClass('active');
                            row.addClass('active');
                            qbFocusedHash = rec.hash;
                            // Подтягиваем viewport к сфокусированной строке — вызов
                            // один в один как в штатном списке (jQuery-объект + true).
                            // Перед этим фиксируем высоту бокса, иначе скроллить нечего.
                            try { qbFitScroll(); } catch (e) {}
                            if (qbScroll) qbScroll.update($(this), true);
                        } catch (e) {}
                    });
                row.on('hover:enter', function() {
                    openTorrentMenu({ Guid: comment, Title: rec.name }, row);
                });
                renderBadge(row, rec);
                return row;
            }

            // Высота скролл-бокса: ограничиваем вьюпортом по факту (замер, не CSS-гадание).
            // Без этого бокс растёт вместе с контентом и update() превращается в no-op.
            // Высота скролл-бокса: ограничиваем вьюпортом по факту (замер, не CSS-гадание).
            // Без этого бокс растёт вместе с контентом и update() превращается в no-op.
            function qbFitScroll() {
                try {
                    if (!qbScroll || !qbHtml) return;
                    var sc = qbScroll.render();
                    var el = (sc && typeof sc.get === 'function') ? sc.get(0) : sc;
                    if (el && el.getBoundingClientRect) {
                        var h = Math.max(200, window.innerHeight - el.getBoundingClientRect().top - 16);
                        var cur = parseInt(el.style.maxHeight || '0', 10);
                        if (Math.abs(cur - h) > 20) el.style.maxHeight = h + 'px';
                        el.style.overflow = 'hidden';
                    }
                } catch (e) {}
            }

            function qbRefresh(force) {
                if (!qbActive || !qbScroll || !qbHtml) return;
                try { qbFitScroll(); } catch (e) {}
                var modalOpen = false;
                try {
                    // Пока открыто меню/диалог — DOM-фокус не трогаем
                    modalOpen = (Lampa.Select && Lampa.Select.opened && Lampa.Select.opened()) ||
                                (Lampa.Modal && Lampa.Modal.opened && Lampa.Modal.opened());
                } catch (e) {}
                var keys = Object.keys(torrentMap);
                var struct = keys.map(function(c) { return torrentMap[c].hash; }).join(',');
                try {
                    // Перестраиваем при смене набора ИЛИ при рассинхроне DOM и данных
                    // (карта есть, а строк на экране нет — иначе пустота висит вечно).
                    var hasRows = false;
                    try { hasRows = qbHtml.find('.lth-row.selector').length > 0; } catch (e) {}
                    if (qbStruct !== struct || (keys.length && !hasRows)) {
                        if (qbStruct === struct && keys.length) log('info', 'screen recover', 'count=' + keys.length);
                        qbStruct = struct;
                        log('info', 'screen rebuild', 'count=' + keys.length);
                        qbHtml.find('.lth-screen-title').text('qBittorrent · ' + keys.length);
                        qbHtml.find('.lth-row').remove();
                        keys.forEach(function(comment) {
                            qbScroll.append(qbRow(torrentMap[comment], comment));
                        });
                        if (!keys.length) {
                            qbScroll.append($('<div class="torrent-item lth-row"><div class="torrent-item__title">' + (fetchOkOnce ? 'Список пуст' : 'Загрузка…') + '</div></div>'));
                        }
                        var sc = qbScroll.render();
                        qbHtml.append(sc);
                        try { qbFitScroll(); } catch (e) {}
                        Lampa.Controller.collectionSet(sc);
                        if (!modalOpen) {
                            var target = null;
                            if (qbFocusedHash) {
                                var found = sc.find('.lth-row').filter(function() { return $(this).data('hash') === qbFocusedHash; });
                                if (found.length) target = found[0];
                            }
                            if (target) {
                                Lampa.Controller.collectionFocus(target, sc);
                            } else {
                                // Нет запомненного фокуса (первое построение после пустого экрана,
                                // удаление сфокусированной строки): ставим на первую, но только
                                // если активен наш контроллер — чужой фокус не трогаем
                                var cur = null;
                                try { cur = Lampa.Controller.enabled(); } catch (e) {}
                                if (cur && cur.name === 'content') {
                                    var first = sc.find('.lth-row.selector').first();
                                    if (first.length) {
                                        first.addClass('active');
                                        qbFocusedHash = first.data('hash') || '';
                                        Lampa.Controller.collectionFocus(first[0], sc);
                                    }
                                }
                            }
                        }
                    } else {
                        // Тот же набор — только статусы/прогресс, на месте, фокус не трогаем
                        qbHtml.find('.lth-row').each(function() {
                            var g = $(this).data('guid');
                            if (g) renderBadge($(this), torrentMap[g]);
                        });
                    }
                } catch (e) {
                    log('error', 'screen refresh fail', String(e && e.message || e).slice(0, 200));
                }
            }

            Lampa.Component.add('lth_qbittorrent', QbittorrentScreen);

            // Пункт в главном меню (только в init, один раз)
            if (!qbMenuAdded) {
                qbMenuAdded = true;
                try {
                    var qbMenuItem = $('<li class="menu__item selector" data-action="lth_qbittorrent">'
                        + '<div class="menu__ico"><svg width="34" height="34" viewBox="0 0 44 44" fill="none">'
                        + '<rect x="6" y="10" width="32" height="24" rx="4" stroke="currentColor" stroke-width="2"/>'
                        + '<path d="M15 19h14M15 25h14M15 31h9" stroke="currentColor" stroke-width="2"/></svg></div>'
                        + '<div class="menu__text">qBittorrent</div></li>');
                    qbMenuItem.on('hover:enter', function() {
                        Lampa.Activity.push({ url: '', title: 'qBittorrent', component: 'lth_qbittorrent', page: 1 });
                    });
                    $('.menu .menu__list').eq(0).append(qbMenuItem);
                    log('info', 'menu added', 'qBittorrent');
                } catch (e) {
                    log('error', 'menu add fail', String(e && e.message || e).slice(0, 200));
                }
            }

            Lampa.Listener.follow('torrent', onTorrentEvent);

            // Опрос статусов раз в 10 с (один тихий запрос, в лог только смены/error)
            try {
                if (!pollTimer) {
                    pollTimer = setInterval(function() {
                        if (!isEnabled()) return;
                        if (isFetching) {
                            // Защита от вечного зависания: Reguest.clear() может молча
                            // погасить колбэк, и флаг уже не сбросится никогда
                            if (fetchStartAt && Date.now() - fetchStartAt > 30000) {
                                log('error', 'fetch stuck, reset', '');
                                isFetching = false;
                            } else {
                                return;
                            }
                        }
                        isFetching = true;
                        fetchTorrents(function() {
                            isFetching = false;
                            try { updateVisibleBadges(); } catch (e) { log('error', 'update fail', String(e && e.message || e).slice(0, 100)); }
                        });
                    }, 10000);
                }
            } catch (e) {}

            // Меню: штатное поведение Lampa, без фиксации.

            // Перехват необработанных ошибок страницы на коллектор,
            // чтобы агент видел стек (напр. при открытии раздела настроек).
            try {
                window.addEventListener('error', function(e) {
                    var msg = (e && e.message) || 'unknown error';
                    var err = (e && e.error) || null;
                    var stack = (err && err.stack) || '';
                    var where = ((e && e.filename) || '?') + ':' + ((e && e.lineno) || 0) + ':' + ((e && e.colno) || 0);
                    log('error', 'window.onerror', 'msg=' + String(msg).slice(0, 200) + ' at=' + where + ' stack=' + String(stack).replace(/\s+/g, ' ').slice(0, 1200));
                });
                window.addEventListener('unhandledrejection', function(e) {
                    var r = e && e.reason;
                    log('error', 'unhandledrejection', String((r && (r.stack || r.message)) || r).slice(0, 600));
                });
            } catch (e) {}

            log('info', 'init', 'build=' + __BUILD__
                + ' host=' + (Lampa.Storage.field('local_torrents_highlight_host') || DEFAULTS.host)
                + ' port=' + (Lampa.Storage.field('local_torrents_highlight_port') || DEFAULTS.port)
                + ' user=' + (Lampa.Storage.field('local_torrents_highlight_username') || DEFAULTS.username));
        }

        if (window.appready) init();
        else Lampa.Listener.follow('app', function(e) { if (e.type == 'ready') init(); });
    }

    if (!window.local_torrents_highlight_ready) startLocalTorrentsHighlight();
})();
