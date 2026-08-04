game.actors.forEach(a => {
    // Пропускаем актёров без запаса Усилия (например постройки godbound-city):
    // их строгая схема данных отвергла бы запись system.effort с ошибкой.
    if (!a.system?.effort) return;
    a.resetScene();
});
ChatMessage.create({
    content:
        `<div class="godbound chat-block gb-card gb-card--rest">` +
        `<h2 class="gb-title"><span class="gb-title__text">Новая сцена</span></h2>` +
        `<ul class="gb-list"><li>Усилие сцены возвращено.</li></ul></div>`,
});
