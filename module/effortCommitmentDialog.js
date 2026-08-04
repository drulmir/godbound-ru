const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class EffortCommitmentDialog extends foundry.appv1.api.Dialog {
    static async create(actor, item, opts, onComplete) {
        let dialogContent = 'systems/godbound/templates/dialogues/effort-commitment-dialog-content.html';

        let template = await renderTemplate(dialogContent,
            Object.assign({name: item.name, description: item.system.description}, opts)
        );
        new EffortCommitmentDialog(actor, item, {content: template}, onComplete, opts).render(true);
    }

    constructor(actor, item, dialogData, onComplete, opts) {
        let buttons = {};
        let commitmentOptions = item.getCommitmentOptions();
        commitmentOptions.forEach(opt => {
            buttons[opt.id] = {
                icon: `<i class="${opt.iClass}"></i>`,
                label: opt.name,
                callback: (html) => {
                    onComplete(opt.actorFnRef);
                }
            };
        });
        buttons.no = {
            icon: "<i class='fas fa-times'></i>",
            label: `Отмена`
        }
        dialogData = Object.assign({
            title: `Приложить Усилие`,
            buttons,
        }, dialogData);
        super(dialogData);
        this.actor = actor;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}
