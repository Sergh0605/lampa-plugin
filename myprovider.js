(function () {
    'use strict';

    // --- НАСТРОЙКИ ---
    var SERVER_URL = 'http://192.168.1.1:8192'; // проверьте, что это реальный адрес вашего сервера
    // -----------------

    function request(url) {
        return new Promise(function (resolve, reject) {
            // Lampa.Reguest — обёртка над XHR, встроенная в Lampa (умеет таймауты и т.п.)
            var net = new Lampa.Reguest();
            net.timeout(8000);
            net.native(url, resolve, reject, false, { dataType: 'text' });
        });
    }

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
            items.push({ name: name, href: href, isFolder: isFolder });
        });

        items.sort(function (a, b) {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        });

        return items;
    }

    // Компонент — конструктор, как того требует Lampa
    function MyMediaComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="my-media"></div>');
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

        this.start = function () {
            var _this = this;

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');

            this.load(_this);
        };

        this.load = function (_this) {
            var title = $('<div class="my-media__title">' +
                (path ? '📂 ' + Lampa.Utils.escapeHtml(path) : '📂 Корневая папка') +
                '</div>');
            html.empty().append(title);
            scroll.render().appendChild ? null : null; // no-op safeguard
            html.append(scroll.render());
            scroll.clear();

            if (path) {
                var back = Lampa.Template.get('my_media_item', {
                    title: '⬅️ Назад'
                }, true);
                back.on('hover:enter', function () {
                    var parentPath = path.split('/').slice(0, -1).join('/');
                    Lampa.Activity.push({
                        url: '',
                        title: 'Моя видеотека',
                        component: 'my_media_main',
                        params: { path: parentPath }
                    });
                });
                scroll.append(back);
            }

            request(SERVER_URL + '/' + (path ? path + '/' : ''))
                .then(function (raw) {
                    var items = parseDirListing(raw);

                    if (!items.length) {
                        scroll.append($('<div class="my-media__empty">Папка пуста</div>'));
                    }

                    items.forEach(function (item) {
                        var icon = item.isFolder ? '📁' : '🎬';
                        var el = $('<div class="my-media__item selector">' + icon + ' ' +
                            Lampa.Utils.escapeHtml(item.name) + '</div>');

                        el.on('hover:enter', function () {
                            if (item.isFolder) {
                                var newPath = path ? path + '/' + item.name : item.name;
                                Lampa.Activity.push({
                                    url: '',
                                    title: 'Моя видеотека',
                                    component: 'my_media_main',
                                    params: { path: newPath }
                                });
                            } else if (item.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)) {
                                var fileUrl = SERVER_URL + '/' + (path ? path + '/' + item.name : item.name);
                                Lampa.Player.play({ url: fileUrl, title: item.name });
                                Lampa.Player.playlist([{ url: fileUrl, title: item.name }]);
                            } else {
                                Lampa.Noty.show('Это не видеофайл: ' + item.name);
                            }
                        });

                        scroll.append(el);
                    });

                    Lampa.Controller.toggle('content');
                })
                .catch(function (err) {
                    scroll.append($('<div class="my-media__error">Ошибка загрузки: ' + err + '</div>'));
                });
        };
    }

    // Регистрируем компонент
    Lampa.Component.add('my_media_main', MyMediaComponent);

    // Пункт в главном меню — добавляем один раз, а не на каждый 'ready'
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
