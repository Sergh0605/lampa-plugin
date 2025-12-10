(() => {

    Lampa.Settings.add({
        title: 'Медиатека',
        group: 'Мои плагины',
        name: 'media_provider',
        type: 'static',
        value: 'Моя медиатека',
        onChange: () => {}
    });

    function request(url) {
        return fetch(url).then(r => r.json());
    }

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

    Lampa.Component.add('my_media_main', {

        render() {
            let frame = $('<div class="my-media-frame"><div class="scroll"></div></div>');
            let scroll = frame.find('.scroll');

            request('http://192.168.1.100:3000/shows')
                .then(list => {
                    list.forEach(name => {
                        scroll.append(`<div class="card">${name}</div>`);
                    });
                });

            return frame;
        },

        destroy() {}

    });

})();
