(() => {
    // --- НАСТРОЙКИ ---
    const SERVER_URL = 'http://192.168.1.1:8192';
    // -----------------

    // Функция для запросов (используем fetch, но обёртка)
    function request(url) {
        return fetch(url).then(r => r.text());
    }

    // Добавляем пункт в главное меню
    Lampa.Listener.follow('app', function(event) {
        if (event.type === 'ready') {
            Lampa.Activity.push({
                id: 'my_media',
                title: 'Моя видеотека',
                icon: 'folder',
                component: 'my_media_main'
            });
        }
    });

    // Компонент для отображения файлов и папок
    Lampa.Component.add('my_media_main', {
        render: function() {
            // Получаем текущий путь из параметров (если есть)
            let path = this.params && this.params.path ? this.params.path : '';
            let container = document.createElement('div');
            container.className = 'frame';
            let scroll = document.createElement('div');
            scroll.className = 'scroll';
            container.appendChild(scroll);

            // Заголовок
            let title = path ? '📂 ' + path : '📂 Корневая папка';
            let titleEl = document.createElement('div');
            titleEl.style.cssText = 'padding: 15px; font-size: 20px; font-weight: bold; color: #fff;';
            titleEl.textContent = title;
            scroll.appendChild(titleEl);

            // Кнопка "Назад" (если не в корне)
            if (path) {
                let backBtn = document.createElement('div');
                backBtn.className = 'my-media-item';
                backBtn.style.cssText = 'padding: 10px; border-bottom: 1px solid #333; cursor: pointer; color: #ffcc00;';
                backBtn.textContent = '⬅️ Назад';
                backBtn.addEventListener('click', function() {
                    let parentPath = path.split('/').slice(0, -1).join('/');
                    Lampa.Activity.push({
                        component: 'my_media_main',
                        params: { path: parentPath }
                    });
                });
                scroll.appendChild(backBtn);
            }

            // Загружаем список файлов
            let url = SERVER_URL + '/' + (path ? path + '/' : '');
            request(url)
                .then(function(html) {
                    let parser = new DOMParser();
                    let doc = parser.parseFromString(html, 'text/html');
                    let links = doc.querySelectorAll('a');

                    let items = [];
                    links.forEach(function(link) {
                        let href = link.getAttribute('href');
                        let name = link.textContent.trim();
                        if (href === '../') return;
                        let isFolder = href.endsWith('/');
                        items.push({ name, href, isFolder });
                    });

                    // Сортировка: сначала папки, потом файлы
                    items.sort(function(a, b) {
                        if (a.isFolder && !b.isFolder) return -1;
                        if (!a.isFolder && b.isFolder) return 1;
                        return a.name.localeCompare(b.name);
                    });

                    if (items.length === 0) {
                        let empty = document.createElement('div');
                        empty.style.cssText = 'padding: 20px; color: #888;';
                        empty.textContent = 'Папка пуста';
                        scroll.appendChild(empty);
                    }

                    items.forEach(function(item) {
                        let el = document.createElement('div');
                        el.className = 'my-media-item';
                        let icon = item.isFolder ? '📁' : '🎬';
                        let color = item.isFolder ? '#4fc3f7' : '#81c784';
                        el.style.cssText = 'padding: 10px; border-bottom: 1px solid #333; cursor: pointer; color: ' + color + ';';
                        el.textContent = icon + ' ' + item.name;

                        el.addEventListener('click', function() {
                            if (item.isFolder) {
                                let newPath = path ? path + '/' + item.name : item.name;
                                Lampa.Activity.push({
                                    component: 'my_media_main',
                                    params: { path: newPath }
                                });
                            } else {
                                let fileUrl = SERVER_URL + '/' + (path ? path + '/' + item.name : item.name);
                                if (item.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)) {
                                    Lampa.Player.play({ url: fileUrl, title: item.name });
                                } else {
                                    alert('Это не видеофайл: ' + item.name);
                                }
                            }
                        });

                        scroll.appendChild(el);
                    });
                })
                .catch(function(err) {
                    let errorMsg = document.createElement('div');
                    errorMsg.style.cssText = 'color: red; padding: 20px;';
                    errorMsg.textContent = 'Ошибка загрузки: ' + err;
                    scroll.appendChild(errorMsg);
                });

            return container;
        },
        destroy: function() {
            // Очистка при необходимости
        }
    });

    // Добавляем настройки (опционально)
    Lampa.Settings.add({
        title: 'Медиатека',
        group: 'Мои плагины',
        name: 'media_provider',
        type: 'static',
        value: 'Моя медиатека',
        onChange: function() {}
    });

})();
