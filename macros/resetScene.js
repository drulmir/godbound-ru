game.actors.forEach(a => {
    a.resetScene();
});
ChatMessage.create({
    content:
        `<div class="godbound chat-block gb-card gb-card--rest">` +
        `<h2 class="gb-title"><span class="gb-title__text">Новая сцена</span></h2>` +
        `<ul class="gb-list"><li>Усилие сцены возвращено.</li></ul></div>`,
});
