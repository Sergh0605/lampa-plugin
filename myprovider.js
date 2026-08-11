(function () {
    'use strict';

    var SERVER_URL = 'http://192.168.1.1:8192';

    // ==================== Стили ====================
    var styles = `
        .my-media__item.selector {
            padding: 8px 12px;
            margin: 2px 0;
            cursor: pointer;
            transition: background-color 0.2s, color 0.2s;
            color: #ccc;
        }

        .my-media__item.selector.active {
            background-color: rgba(255, 255, 255, 0.85) !important;
            border-radius: 4px;
            color: #000 !important;
        }

        .my-media__item.selector.active .my-media__item-text {
            color: #000 !important;
        }

        .my-media__title {
            padding: 8px 12px;
            font-size: 20px;
            font-weight: bold;
            color: #fff;
        }

        .my-media__empty,
        .my-media__error {
            padding: 8px 12px;
            color: #888;
        }

        .my-media__error {
            color: #ff4444;
        }
    `;

    var styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    // ==================== HTTP запрос ====================
    function request(url) {
        return new Promise(function (resolve, reject) {
            if (Lampa.Request && Lampa.Request.get) {
                Lampa.Request.get(url, resolve, reject);
            } else {
                fetch(url)
                    .then(function (r) { return r.text(); })
                    .then(resolve)
                    .catch(reject);
            }
        });
    }

    // ==================== Парсинг списка файлов ====================
    function parseDirListing(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var links = doc.querySelectorAll('a');
        var items = [];

        links.forEach(function (link) {
            var href = link.getAttribute('href');
            var name = link.textContent.trim();

            if (!href || href === '../') return;

            var isFolder = href.endsWith('/');

            items.push({
                name: name.replace(/\/$/, ''),
                href: href,
                isFolder: isFolder
            });
        });

        items.sort(function (a, b) {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        });

        return items;
    }

    // ==================== Компонент ====================
    function MyMediaComponent(object) {
        var scroll = new Lampa.Scroll({
            mask: true,
            over: true
        });

        var html = $('<div class="my-media" style="padding-left:100px;"></div>');

        var path = (object.params && object.params.path) || '';

        this.create = function () {
            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };

        // ---------- Подсветка ----------
        this.setActive = function (el) {
            scroll.render()
                .find('.my-media__item.selector')
                .removeClass('active');

            $(el).addClass('active');
        };

        // ---------- Навигация ----------
        this.start = function () {
            var _this = this;

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },

                up: function () {
                    if (Navigator.canmove('up')) {
                        Navigator.move('up');
                    } else {
                        Lampa.Controller.toggle('head');
                    }
                },

                down: function () {
                    if (Navigator.canmove('down')) {
                        Navigator.move('down');
                    }
                },

                left: function () {
                    if (Navigator.canmove('left')) {
                        Navigator.move('left');
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },

                right: function () {
                    if (Navigator.canmove('right')) {
                        Navigator.move('right');
                    }
                },

                back: this.back
            });

            Lampa.Controller.toggle('content');
            this.load(_this);
        };

        // ---------- Загрузка ----------
        this.load = function (_this) {
            var title = document.createElement('div');
            title.className = 'my-media__title';
            title.textContent = path
                ? '📂 ' + path
                : '📂 Корневая папка';

            html.empty().append(title);
            scroll.clear();
            html.append(scroll.render());

            // Кнопка Назад
            if (path) {
                var back = $('<div class="my-media__item selector">⬅️ Назад</div>');

                back.on('hover:focus', function () {
                    _this.setActive(this);
                });

                back.on('hover:enter', function () {
                    var parentPath = path
                        .split('/')
                        .slice(0, -1)
                        .join('/');

                    Lampa.Activity.push({
                        url: '',
                        title: 'Моя видеотека',
                        component: 'my_media_main',
                        params: {
                            path: parentPath
                        }
                    });
                });

                scroll.append(back);
            }

            request(SERVER_URL + '/' + (path ? path + '/' : ''))
                .then(function (raw) {
                    var items = parseDirListing(raw);

                    if (!items.length) {
                        scroll.append(
                            $('<div class="my-media__empty">Папка пуста</div>')
                        );
                    } else {
                        items.forEach(function (item) {
                            var icon = item.isFolder ? '📁' : '🎬';

                            var el = $(
                                '<div class="my-media__item selector">' +
                                    '<span class="my-media__item-text">' +
                                        icon + ' ' + item.name +
                                    '</span>' +
                                '</div>'
                            );

                            // Подсветка при получении фокуса
                            el.on('hover:focus', function () {
                                _this.setActive(this);
                            });

                            // Выбор элемента
                            el.on('hover:enter', function () {
                                if (item.isFolder) {
                                    var newPath = path
                                        ? path + '/' + item.name
                                        : item.name;

                                    Lampa.Activity.push({
                                        url: '',
                                        title: 'Моя видеотека',
                                        component: 'my_media_main',
                                        params: {
                                            path: newPath
                                        }
                                    });
                                } else if (item.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)) {
                                    var fileUrl = SERVER_URL + '/' +
                                        (path ? path + '/' + item.name : item.name);

                                    Lampa.Player.play({
                                        url: fileUrl,
                                        title: item.name
                                    });

                                    Lampa.Player.playlist([{
                                        url: fileUrl,
                                        title: item.name
                                    }]);
                                } else {
                                    Lampa.Noty.show('Это не видеофайл: ' + item.name);
                                }
                            });

                            scroll.append(el);
                        });
                    }

                    // Регистрируем коллекцию для навигации
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());

                    // Подсвечиваем первый элемент
                    setTimeout(function () {
                        var first = scroll.render()
                            .find('.my-media__item.selector')
                            .first();

                        if (first.length) {
                            first.addClass('active');
                        }
                    }, 0);
                })
                .catch(function (err) {
                    scroll.append(
                        $('<div class="my-media__error">Ошибка загрузки: ' + err + '</div>')
                    );
                });
        };
    }

    // ==================== Регистрация компонента ====================
    Lampa.Component.add('my_media_main', MyMediaComponent);

    // ==================== Пункт меню ====================
    var menuAdded = false;

    Lampa.Listener.follow('app', function (event) {
        if (event.type === 'ready' && !menuAdded) {
            menuAdded = true;

            var menuItem = $(
                '<li class="menu__item selector" data-action="my_media">' +
                    '<div class="menu__ico"><svg></svg></div>' +
                    '<div class="menu__text">Моя видеотека</div>' +
                '</li>'
            );

            menuItem.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Моя видеотека',
                    component: 'my_media_main',
                    page: 1
                });
            });

            $('.menu .menu__list').eq(0).append(menuItem);
        }
    });

})();
