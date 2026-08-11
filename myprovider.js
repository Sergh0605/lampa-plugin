(() => {
    // --- НАСТРОЙКИ ---
    const SERVER_URL = 'http://192.168.1.41:8192';  // <-- Меняйте здесь при необходимости
    // -----------------

    // Настройки плагина в меню Lampa
    Lampa.Settings.add({
        title: 'Медиатека',
        group: 'Мои плагины',
        name: 'media_provider',
        type: 'static',
        value: 'Моя медиатека',
        onChange: () => {}
    });

    // Функция для запросов к HTTP-серверу
    function request(url) {
        return fetch(url).then(r => r.text());
    }

    // Добавляем пункт в главное меню
    Lampa.Listener.follow('app', event => {
        if (event.type === 'ready') {
            Lampa.Activity.push({
                id: 'my_media',
                title: 'Моя видеотека',
                icon: 'folder',
                component: 'my_media_main'
            });
        }
    });

    // Компонент для отображения списка файлов (с поддержкой путей)
    Lampa.Component.add('my_media_main', function() {
        let self = this;
        let path = self.params.path || ''; // текущий путь (подпапка)

        // Функция для получения содержимого папки
        function loadFolder(folderPath) {
            let url = SERVER_URL + '/' + folderPath;
            return request(url);
        }

        // Рендер списка
        self.render = function() {
            let frame = $('<div class="frame"><div class="scroll"></div></div>');
            let scroll = frame.find('.scroll');

            // Показываем название текущей папки
            let title = path ? '📂 ' + path : '📂 Корневая папка';
            let titleEl = $('<div style="padding: 15px; font-size: 20px; font-weight: bold; color: #fff;">' + title + '</div>');
            scroll.append(titleEl);

            // Если мы не в корне, добавляем кнопку "Назад"
            if (path) {
                let backBtn = $('<div class="my-media-item" style="padding: 10px; border-bottom: 1px solid #333; cursor: pointer; color: #ffcc00;">⬅️ Назад</div>');
                backBtn.on('click', function() {
                    // Переходим на уровень выше
                    let parentPath = path.split('/').slice(0, -1).join('/');
                    Lampa.Activity.push({
                        component: 'my_media_main',
                        params: { path: parentPath }
                    });
                });
                scroll.append(backBtn);
            }

            // Загружаем список файлов
            loadFolder(path)
                .then(html => {
                    let parser = new DOMParser();
                    let doc = parser.parseFromString(html, 'text/html');
                    let links = doc.querySelectorAll('a');

                    let items = [];
                    links.forEach(link => {
                        let href = link.getAttribute('href');
                        let name = link.textContent.trim();

                        // Пропускаем ссылку на родительскую папку (..)
                        if (href === '../') return;

                        let isFolder = href.endsWith('/');
                        let isFile = !isFolder;

                        items.push({ name, href, isFolder, isFile });
                    });

                    // Сортируем: сначала папки, потом файлы
                    items.sort((a, b) => {
                        if (a.isFolder && !b.isFolder) return -1;
                        if (!a.isFolder && b.isFolder) return 1;
                        return a.name.localeCompare(b.name);
                    });

                    if (items.length === 0) {
                        scroll.append('<div style="padding: 20px; color: #888;">Папка пуста</div>');
                    }

                    items.forEach(item => {
                        let icon = item.isFolder ? '📁' : '🎬';
                        let color = item.isFolder ? '#4fc3f7' : '#81c784';
                        let el = $(`
                            <div class="my-media-item" style="padding: 10px; border-bottom: 1px solid #333; cursor: pointer; color: ${color};">
                                ${icon} ${item.name}
                            </div>
                        `);

                        el.on('click', () => {
                            if (item.isFolder) {
                                // Переходим в подпапку
                                let newPath = path ? path + '/' + item.name : item.name;
                                Lampa.Activity.push({
                                    component: 'my_media_main',
                                    params: { path: newPath }
                                });
                            } else {
                                // Воспроизводим файл
                                let fileUrl = SERVER_URL + '/' + (path ? path + '/' + item.name : item.name);
                                if (item.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)) {
                                    Lampa.Player.play({ url: fileUrl, title: item.name });
                                } else {
                                    alert('Это не видеофайл: ' + item.name);
                                }
                            }
                        });

                        scroll.append(el);
                    });
                })
                .catch(err => {
                    scroll.html(`<div style="color: red; padding: 20px;">Ошибка загрузки: ${err}</div>`);
                });

            return frame;
        };

        self.destroy = function() {
            // очистка, если нужна
        };
    });
})();
