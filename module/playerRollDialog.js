import {SafeNum} from "./misc.js";

const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class PlayerRollDialog extends foundry.appv1.api.Dialog {
    static async create(actor, opts, onComplete) {
        let dialogContent = 'systems/godbound/templates/dialogues/player-roll-dialog-content.html';

        let template = await renderTemplate(dialogContent,
            Object.assign({}, opts)
        );
        new PlayerRollDialog(actor, {content: template}, onComplete, opts).render(true);
    }

    constructor(actor, dialogData, onComplete, opts) {
        dialogData = Object.assign({
            title: `Бросок`,
            buttons: {
                yes: {
                    icon: "<i class='fas fa-check'></i>",
                    label: `Бросить`,
                    callback: (html) => {
                        let modifier = SafeNum(html.find('#modifier').val());
                        onComplete(Object.assign({}, opts, {
                            modifier
                        }));
                    }
                },
                no: {
                    icon: "<i class='fas fa-times'></i>",
                    label: `Отмена`
                }
            },
            default: 'yes'
        }, dialogData);
        super(dialogData);
        this.actor = actor;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}
