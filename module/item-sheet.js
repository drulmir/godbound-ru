import {TypeNames, esc, isPlainDescription, itemChatImage} from "./misc.js";

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {foundry.appv1.sheets.ItemSheet}
 */
export class GodboundItemSheet extends foundry.appv1.sheets.ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["godbound", "sheet", "item"],
        width: 624,
        height: 'auto',
        resizable: true,
        tabs: [{navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attrs"}],
      }
    );
  }

  get template() {
    const path = "systems/godbound/templates/item";
    return `${path}/${this.item.type}-sheet.html`;
  }
  /* -------------------------------------------- */

  /** @override */
  getData() {
    const context = super.getData();
    context.item = this.item;
    context.system = this.item.system;
    context.dtypes = ["String", "Number", "Boolean"];
    if(this.item.type === 'artifact' && this.item.actor) {
      let lookup = this.item.actor.system.computed.artifactIdx[this.item.id];
      if(lookup) {
        context.artifactPowers = lookup.artifactPowers;
      } else {
        context.artifactPowers = [];
      }
    }
    if(this.item.type === 'divineGift') {
      const boundNames = this.item.actor
        ? this.item.actor.items.filter(i => i.type === 'boundWord').map(i => i.name)
        : [];
      // Always include the gift's currently-assigned Word, even if the actor
      // doesn't (yet) have that Word bound, so the link is never hidden.
      if(this.item.system.word && !boundNames.includes(this.item.system.word)) {
        boundNames.push(this.item.system.word);
      }
      context.actorBoundWordNames = boundNames;
    }
    return context;
  }
  /** @override */
  _getSubmitData(updateData) {
    const data = super._getSubmitData(updateData);
    // Safety net: whatever caused a stray "," to slip into a Number field
    // (Russian numpad decimal key, OS-level autocorrect/predictive text on
    // blur, etc.), strip it here before it ever reaches the item update.
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (typeof value === 'number' && Number.isNaN(value)) {
        const el = this.form.querySelector(`[name="${key}"]`);
        if (el && el.dataset.dtype === 'Number') {
          const cleaned = String(el.value).replace(/[,.]/g, '');
          data[key] = cleaned === '' || cleaned === '-' ? 0 : Number(cleaned);
        }
      }
    }
    return data;
  }

  /* -------------------------------------------- */

  activateListeners(html) {
    super.activateListeners(html);

    // Russian keyboards send "," from the numpad decimal key, and every
    // numeric field here is an integer anyway, so just strip any decimal
    // separator the user types instead of trying to parse it. Handling both
    // "input" (as they type) and "change"/"blur" (right before Foundry's own
    // submitOnChange handler reads the value) so nothing slips through.
    html.find('input[data-dtype="Number"]').on('input change blur', ev => {
      const el = ev.currentTarget;
      if (/[,.]/.test(el.value)) {
        el.value = el.value.replace(/[,.]/g, '');
      }
    });

    html.find('.item-name').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      item.sheet.render(true);
    });

    // Toggle an inline short-description panel directly beneath the item row.
    html.find('.item-expand').click(ev => {
      $(ev.currentTarget).closest('.item').next('.item-summary').slideToggle(150);
    });

    html.find('.item-chat').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      let item;
      if(li && li.data("itemId") && this.actor) {
        item = this.actor.items.get(li.data("itemId"));
      } else {
        item = this.item;
      }
      if(this.actor) {
        this.actor.demonstratePower(item);
      } else {
        ChatMessage.create({
          content:
            `<div class="godbound chat-block gb-card gb-card--power">` +
            `<h2 class="gb-title"><span class="gb-title__text">${esc(TypeNames(item.type) || 'Предмет')}</span></h2>` +
            `<div class="gb-actor">` +
            `<div class="gb-portraits"><img class="gb-portrait" src="${esc(itemChatImage(item))}" alt=""></div>` +
            `<div class="gb-names"><span class="gb-name" title="${esc(item.name)}">${esc(item.name)}</span></div></div>` +
            `<div class="gb-desc${isPlainDescription(item.system.description) ? ' gb-desc--pre' : ''}">` +
            `${item.system.description ?? ''}</div></div>`,
        });
      }
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;
    html.find('.item-maybe-delete').click(ev => {
      if(this.maybeDeleteActive) {
        html.find('.item-delete').hide();
        this.maybeDeleteActive = false;
      } else {
        html.find('.item-delete').show();
        this.maybeDeleteActive = true;
      }
    });
    html.find('.item-delete').click(ev => {
      if(this.item.type === 'artifact') {
        if(this.item.actor && this.item.actor.hasArtifactPowersUnder(this.item.id)) {
          ui.notifications.warn("Сначала удалите силы артефакта по отдельности, затем удаляйте артефакт.");
          return;
        }
      }
      if(this.item.actor) {
        this.item.actor.deleteEmbeddedDocuments('Item', [this.item.id]);
      }
    });

    html.find('.itemAdder').click(async ev => {
      const $i = $(ev.currentTarget);
      if(this.item.type !== 'artifact') {
        ui.notifications.error("Создавать вложенные предметы могут только артефакты");
        return;
      }
      if(!this.item.actor) {
        ui.notifications.error("Нельзя добавить силы артефакту без владельца");
        return;
      }
      this.actor.createEmbeddedDocuments('Item', [{name: TypeNames($i.data('itemType')), type: $i.data('itemType'), system: {artifactId: this.item.id}}], {renderSheet: true});
    });

  }
}
