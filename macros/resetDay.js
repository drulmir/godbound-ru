// Отдых всей группы: восстановить ОЗ/КЗ, освободить Усилие дня и сцены у каждого
// актёра, затем один раз объявить новый день. Пер-актёрные карточки подавляются
// (announce:false), чтобы чат не заполнялся одинаковыми объявлениями.
(async () => {
    for (const a of game.actors) {
        await a.resetDay({announce: false});
    }
    await ChatMessage.create({
        content:
            `<div class="godbound chat-block gb-card gb-card--rest">` +
            `<h2 class="gb-title"><span class="gb-title__text">Наступил новый день</span></h2>` +
            `<ul class="gb-list">` +
            `<li>Здоровье всех персонажей восстановлено.</li>` +
            `<li>Усилие дня и сцены возвращено.</li>` +
            `<li>Связанные артефакты остаются связанными; сброшено лишь их Усилие дня/сцены.</li>` +
            `</ul></div>`,
    });
})();
