(function() {
    // ---------- НАСТРОЙКИ ----------
    const DEFAULT_SETTINGS = {
        host: '192.168.1.1',
        port: 8192,
        username: 'admin',
        password: '7P3frRpJe5D@JUk',
        enabled: true
    };

    let settings = {};
    let torrentComments = [];
    let hashesLoaded = false;
    let pendingItems = [];
    let isFetching = false;

    // ---------- ЗАГРУЗКА НАСТРОЕК ----------
    function loadSettings() {
        settings = Object.assign({}, DEFAULT_SETTINGS);
    }

    // ---------- ЗАПРОС К QBITTORRENT (без кеша) ----------
    function fetchTorrents(callback) {
        if (!settings.enabled) {
            hashesLoaded = true;
            torrentComments = [];
            callback([]);
            return;
        }

        let url = `http://${settings.host}:${settings.port}/qbittorrent/api/v2/torrents/info`;
        let headers = {};
        if (settings.username && settings.password) {
            let auth = btoa(settings.username + ':' + settings.password);
            headers['Authorization'] = 'Basic ' + auth;
        }

        fetch(url, { method: 'GET', headers: headers })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                torrentComments = data
                    .map(t => t.comment)
                    .filter(c => c && c.startsWith('http'));
                hashesLoaded = true;
                callback(torrentComments);
            })
            .catch(err => {
                console.error('[qBittorrent] Ошибка запроса:', err);
                hashesLoaded = true;
                torrentComments = [];
                callback([]);
            });
    }

    // ---------- ПРОВЕРКА И ПОДСВЕТКА ----------
    function isTorrentDownloaded(guid) {
        return guid && torrentComments.indexOf(guid) !== -1;
    }

    function applyHighlight(item, guid) {
        if (isTorrentDownloaded(guid)) {
            item.addClass('torrent-downloaded');
            if (!item.find('.torrent-downloaded-icon').length) {
                item.append('<div class="torrent-downloaded-icon">✔</div>');
            }
        } else {
            item.removeClass('torrent-downloaded');
            item.find('.torrent-downloaded-icon').remove();
        }
    }

    function processPending() {
        if (hashesLoaded && pendingItems.length) {
            pendingItems.forEach(function(p) {
                applyHighlight(p.item, p.guid);
            });
            pendingItems = [];
        }
    }

    // ---------- ОБРАБОТЧИК СОБЫТИЙ ----------
    function onTorrentEvent(event) {
        if (event.type === 'render') {
            let element = event.element;
            let item = event.item;
            let guid = element.Guid;
            if (element && guid) {
                if (hashesLoaded) {
                    applyHighlight(item, guid);
                } else {
                    pendingItems.push({ guid: guid, item: item });
                    if (!isFetching) {
                        isFetching = true;
                        fetchTorrents(function(comments) {
                            hashesLoaded = true;
                            isFetching = false;
                            processPending();
                        });
                    }
                }
            }
        }
    }

    // ---------- ДОБАВЛЕНИЕ СТИЛЕЙ ----------
    function addStyles(css) {
        if (typeof Lampa !== 'undefined' && Lampa.Style && typeof Lampa.Style.add === 'function') {
            Lampa.Style.add(css);
            return;
        }
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ----------
    function init() {
        try {
            loadSettings();
            Lampa.Listener.follow('torrent', onTorrentEvent);
            addStyles(`
                .torrent-item.torrent-downloaded {
                    background-color: rgba(0, 255, 0, 0.2) !important;
                    border-left: 4px solid #00ff00;
                }
                .torrent-downloaded-icon {
                    position: absolute;
                    top: 5px;
                    right: 5px;
                    color: #00ff00;
                    font-size: 20px;
                    font-weight: bold;
                    text-shadow: 0 0 5px #000;
                }
            `);
        } catch(e) {
            console.error('[qBittorrent] Ошибка инициализации:', e);
        }
    }

    // ---------- ОЖИДАНИЕ ГОТОВНОСТИ LAMPA ----------
    function waitForLampa() {
        if (typeof Lampa !== 'undefined' && Lampa.Listener && Lampa.Storage) {
            init();
        } else {
            setTimeout(waitForLampa, 500);
        }
    }

    waitForLampa();
})();