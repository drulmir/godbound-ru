/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {foundry.appv1.sheets.ActorSheet}
 */
import {PlayerRollDialog} from "./playerRollDialog.js";
import {TypeNames, ArtCategoryName, Label, ART_CATEGORIES} from "./misc.js";
import {hasFullEditPrivilege, requestFullAccess} from "./fullAccess.js";
import {exportGodboundActor, importGodboundActorFromFile} from "./export-import.js";

const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class GodboundActorSheet extends foundry.appv1.sheets.ActorSheet {

  /** @override */
	static get defaultOptions() {
	  return foundry.utils.mergeObject(super.defaultOptions, {
  	  classes: ["godbound", "sheet", "actor"],
      width: 750,
      height: 875,
      submitOnChange: true,
      tabs: [{navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "attrs"}],
      dragDrop: [{dragSelector: ".item-list .item", dropSelector: null}]
    });
  }

  get template() {
    const path = "systems/godbound/templates/actor";
    return `${path}/${this.actor.type}-sheet.html`;
  }
  /* -------------------------------------------- */

  /** @override */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    // Export the whole character (system data, items, effects, flags, token,
    // portrait) to a JSON file that can be imported into another world.
    buttons.unshift({
      label: "Экспорт",
      class: "godbound-export",
      icon: "fas fa-file-export",
      onclick: () => exportGodboundActor(this.actor)
    });
    // Import a character JSON, creating a new actor in this world.
    if (game.user.can("ACTOR_CREATE")) {
      buttons.unshift({
        label: "Импорт",
        class: "godbound-import",
        icon: "fas fa-file-import",
        onclick: () => importGodboundActorFromFile()
      });
    }
    // Per-character sheet background: pick any image (default is the parchment).
    if (this.actor.isOwner) {
      buttons.unshift({
        label: "Фон",
        class: "godbound-bg",
        icon: "fas fa-image",
        onclick: () => this._pickSheetBackground()
      });
    }
    if (!this.actor.isOwner && hasFullEditPrivilege(game.user)) {
      buttons.unshift({
        label: "Полный доступ",
        class: "godbound-full-access",
        icon: "fas fa-user-lock",
        onclick: () => requestFullAccess(this.actor)
      });
    }
    return buttons;
  }

  // Open a file picker to choose this character's sheet background image; store it
  // in a flag and re-render. Picking the parchment restores the default look.
  async _pickSheetBackground() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation
      || foundry.applications?.apps?.FilePicker || FilePicker;
    const current = this.actor.getFlag('godbound', 'sheetBg') || 'systems/godbound/assets/parchment.jpg';
    new FP({
      type: 'image',
      current,
      callback: async (path) => {
        await this.actor.setFlag('godbound', 'sheetBg', path);
        this.render(false);
      }
    }).render(true);
  }

  /** @override */
  getData() {
    const context = super.getData();
    context.actor = this.actor;
    context.system = this.actor.system;
    context.items = this.actor.items;
    context.dtypes = ["String", "Number", "Boolean"];
    // Gates GM-only editable fields in the templates (e.g. Divine Fury uses left).
    context.isGM = game.user.isGM;
    // Custom per-character sheet background (null → default parchment via CSS).
    context.sheetBg = this.actor.getFlag('godbound', 'sheetBg') || null;
    if (this.actor.type === 'pc' || this.actor.type === 'npc') {
      const arts = this.actor.system.computed.arts || {};
      context.artCategories = ART_CATEGORIES.map(c => ({
        id: c.id,
        name: c.name,
        entries: arts[c.id] || []
      }));
    }
    return context;
  }

  /** @override */
  _getSubmitData(updateData) {
    const data = super._getSubmitData(updateData);
    // Safety net: whatever caused a stray "," to slip into a Number field
    // (Russian numpad decimal key, OS-level autocorrect/predictive text on
    // blur, etc.), strip it here before it ever reaches the actor update.
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

    // Apply the per-character sheet background to the whole window-content (so it
    // fills the frame/padding too, not just the scrollable form). Empty flag falls
    // back to the default parchment defined in CSS.
    const bg = this.actor.getFlag('godbound', 'sheetBg');
    const wc = this.element?.find?.('.window-content');
    if (wc && wc.length) {
      if (bg) wc.css({backgroundImage: `url("${bg}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat'});
      else wc.css({backgroundImage: '', backgroundSize: '', backgroundPosition: '', backgroundRepeat: ''});
    }

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

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

    html.find('.word-use').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.useWord(item);
    });

    // Toggle an inline short-description panel directly beneath the item row.
    html.find('.item-expand').click(ev => {
      $(ev.currentTarget).closest('.item').next('.item-summary').slideToggle(150);
    });

    // Single "use" button for powers: commits Effort per the power's settings
    // and posts its description to chat.
    html.find('.power-use').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.usePower(item);
    });

    // Theurgy effect roll (attack / save) attached to an Art level.
    html.find('.art-effect-roll').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.rollArtEffect(item);
    });

    // Faction turn actions ("Общие Действия Фракций").
    html.find('.faction-action').click(ev => {
      const key = $(ev.currentTarget).data('factionAction');
      this.actor.factionAction(key);
    });

    // Custom (user-defined) faction actions. Stored as a plain array in
    // system.faction.customActions; add/delete/edit rewrite the whole array to
    // avoid Foundry turning a dotted numeric path into an object.
    html.find('.faction-custom-add').click(async ev => {
      const list = foundry.utils.deepClone(this.actor.system.faction?.customActions || []);
      list.push({name: 'Новое действие', note: ''});
      await this.actor.update({'system.faction.customActions': list});
    });
    html.find('.faction-custom-delete').click(async ev => {
      const idx = Number($(ev.currentTarget).data('index'));
      const list = foundry.utils.deepClone(this.actor.system.faction?.customActions || []);
      if (idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      await this.actor.update({'system.faction.customActions': list});
    });
    html.find('.faction-custom-roll').click(ev => {
      const idx = Number($(ev.currentTarget).data('index'));
      this.actor.factionCustomAction(idx);
    });
    html.find('.faction-custom-input').change(async ev => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      const idx = Number($(el).data('index'));
      const field = $(el).data('field');
      const list = foundry.utils.deepClone(this.actor.system.faction?.customActions || []);
      if (!list[idx]) return;
      list[idx][field] = el.value;
      await this.actor.update({'system.faction.customActions': list});
    });

    html.find('.item-chat').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.demonstratePower(item);
    });

    html.find('.item-effort-return').click(ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = $(ev.currentTarget).parents('.item');
      this.actor.releaseItemEffort(li.data("itemId"));
    });

    html.find('.item-day-effort').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.commitEffortPrompt(item, 'commitEffortForDay');
    });

    html.find('.item-scene-effort').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.commitEffortPrompt(item, 'commitEffortForScene');
    });

    html.find('.item-atWill-effort').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.commitEffortPrompt(item, 'commitEffortAtWill');
    });

    html.find('.itemAdder').click(async ev => {
      const $i = $(ev.currentTarget);
      const type = $i.data('itemType');
      const itemData = {name: TypeNames(type), type};
      const category = $i.data('itemCategory');
      if (category) {
        itemData.system = {category};
        itemData.name = ArtCategoryName(category);
      }
      const artifactId = $i.data('artifactId');
      if (artifactId) {
        itemData.system = Object.assign({}, itemData.system, {artifactId});
      }
      const artId = $i.data('artId');
      if (artId) {
        // A new Art level inherits its parent Art's description (a copy, so it
        // can be trimmed to the specific spell) and gets the next sequential
        // level number, pre-filling it with that tradition/theurgy's text.
        const parentArt = this.actor.items.get(artId);
        const existingLevels = this.actor.items.filter(
          it => it.type === 'artLevel' && it.system.artId === artId).length;
        const nextLevel = existingLevels + 1;
        itemData.system = Object.assign({}, itemData.system, {
          artId,
          level: nextLevel,
          description: parentArt?.system?.description || ''
        });
        itemData.name = `${parentArt?.name || 'Уровень'} — ур. ${nextLevel}`;
      }
      this.actor.createEmbeddedDocuments('Item', [itemData], {renderSheet: true});
    });

    // Delete Inventory Item
    html.find('.item-delete').click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      this.actor.deleteEmbeddedDocuments('Item', [li.data("itemId")]);
      li.slideUp(200, () => this.render(false));
    });

    // Broadcast the actor's token/portrait image to every connected player,
    // shown centered on their screen via the core image popout share feature.
    html.find('.token-image-share').click(ev => {
      const src = this.actor.img;
      const PopoutCls = foundry.applications?.apps?.ImagePopout ?? ImagePopout;
      const popout = new PopoutCls(src, {title: this.actor.name, uuid: this.actor.uuid});
      popout.render(true);
      if (typeof popout.shareImage === 'function') {
        popout.shareImage();
      }
    });

    html.find('.reset-scene').click(ev => {
      this.actor.resetScene();
    });

    html.find('.reset-day').click(ev => {
      this.actor.resetDay();
    });

    // Show where Effort is currently invested and hand it back per power, instead of
    // nudging the aggregate ± counters by hand (which used to drift out of sync).
    html.find('.effort-release').click(ev => {
      this.actor.openEffortReleaseDialog();
    });

    html.find('.effortSpend').click(ev => {
      const $i = $(ev.currentTarget);
      let effortCategory = $i.data('effortCategory');
      let effortChange = parseInt($i.data('effortChange'));
      // Coerce to 0: newer categories (e.g. healing) may be absent on actors that
      // predate the field, and undefined + 1 would write NaN.
      const cur = Number(this.actor.system.effort[effortCategory]) || 0;
      if(effortChange > 0 && this.actor.canSpendEffort(effortChange)) {
        this.actor.update({system: {effort: {[effortCategory]: cur + effortChange}}});
      } else if(effortChange < 0 && this.actor.canReclaimEffort(effortChange, effortCategory)) {
        this.actor.update({system: {effort: {[effortCategory]: cur + effortChange}}});
      }
    });

    html.find('.attr-roll').click(ev => {
      let attr = $(ev.currentTarget).data('attr');
      PlayerRollDialog.create(this.actor, {rollType: `Проверка: ${Label(attr)}`}, async (data) => {
        let template = 'systems/godbound/templates/chat/attr-roll-result.html';
        let chatData = {
          author: game.user.id,
          speaker: ChatMessage.getSpeaker({actor: this.actor}),
        };
        let templateData = {
          title: 'Проверка характеристики',
          details: `${Label(attr)} - ${data.modifier < 0 ? 'Трудно' : data.modifier > 0 ? 'Легко' : 'Обычно'}`,
          data: data,
        }
        // Godbound attribute check: roll 1d20 (+ situational modifier) against the
        // check value, which is 21 − attribute score. Higher-than-or-equal succeeds.
        let roll = new Roll('1d20 + @difficulty', {
          difficulty: data.modifier,
        });
        await roll.evaluate();
        let target = 21 - this.actor.system.attributes[attr].score;
        let result = {
          isSuccess: roll.total >= target,
          isFailure: roll.total < target,
          target: target,
        }
        result.className = result.isSuccess ? 'result-msg-success' : 'result-msg-failure';
        templateData.roll = await roll.render();
        templateData.result = result;
        templateData.data.actor = this.actor;
        chatData.content = await renderTemplate(template, templateData);
        chatData.rolls = [roll];
        // Dice So Nice
        if (game.dice3d) {
          await game.dice3d.showForRoll(
            roll,
            game.user,
            true,
            chatData.whisper,
            chatData.blind
          );
          ChatMessage.create(chatData);
        } else {
          chatData.sound = CONFIG.sounds.dice;
          ChatMessage.create(chatData);
        }
      });
    })

    html.find('.attack-roll').click(async ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.rollAttack(item);
    });

    html.find('.morale-roll').click(async ev => {
      this.actor.rollMorale();
    });

    // Roll the NPC's tactics table (d6), whispered blind to the GM(s). Handled here
    // with this.actor so it works on unlinked token sheets too.
    html.find('.roll-tactic-btn').click(async ev => {
      this.actor.rollTactics();
    });

    html.find('.fray-roll').click(async ev => {
      this.actor.rollFray();
    });

    // Quick manual HP/HD adjustment on the sheet itself - covers the common case
    // (heal, or damage with no attack roll) without needing a chat message at all.
    html.find('.quick-damage-btn').click(async ev => {
      const amount = parseInt($(ev.currentTarget).siblings('.quick-hp-amount').val()) || 0;
      if (amount <= 0) return;
      if (this.actor.type === 'pc') await this.actor.applyDamage(amount);
      else await this.actor.applyHDDamage(amount);
    });

    html.find('.quick-heal-btn').click(async ev => {
      const amount = parseInt($(ev.currentTarget).siblings('.quick-hp-amount').val()) || 0;
      if (amount <= 0) return;
      await this.actor.applyHeal(amount);
    });

    html.find('.autoattack-roll').click(ev => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data("itemId"));
      this.actor.rollDamage(item)
    });

    html.find('.save-roll').click(ev => {
      let save = $(ev.currentTarget).data('save');
      PlayerRollDialog.create(this.actor, {rollType: `Спасбросок: ${Label(save)}`}, async (data) => {
        let template = 'systems/godbound/templates/chat/saving-throw-result.html';
        let chatData = {
          author: game.user.id,
          speaker: ChatMessage.getSpeaker({actor: this.actor}),
        };
        let templateData = {
          title: 'Спасбросок',
          details: `${Label(save)} - ${data.modifier < 0 ? 'Трудно' : data.modifier > 0 ? 'Легко' : 'Обычно'}`,
          data: data,
        }
        let roll = new Roll('1d20 + @difficulty', {
          difficulty: data.modifier,
        });
        await roll.evaluate();
        let target = this.actor.system.computed.saves[save].save;
        // Natural 1 always fails, natural 20 always succeeds (Godbound saving throws).
        const nat = roll.dice?.[0]?.results?.[0]?.result;
        let result = {
          isSuccess: nat === 20 || (nat !== 1 && roll.total >= target),
          isFailure: nat === 1 || (nat !== 20 && roll.total < target),
          target: target,
        }
        result.className = result.isSuccess ? 'result-msg-success' : 'result-msg-failure';
        templateData.roll = await roll.render();
        templateData.result = result;
        templateData.data.actor = this.actor;
        chatData.content = await renderTemplate(template, templateData);
        chatData.rolls = [roll];
        // Dice So Nice
        if (game.dice3d) {
          await game.dice3d.showForRoll(
            roll,
            game.user,
            true,
            chatData.whisper,
            chatData.blind
          );
          ChatMessage.create(chatData);
        } else {
          chatData.sound = CONFIG.sounds.dice;
          ChatMessage.create(chatData);
        }
      });
    })

    html.find('#hpdmg').click(async ev => {
      let adjStr = html.find('#hpadjust').val();
      let adj = parseInt(adjStr);
      if(String(adj) !== adjStr || adj < -1) {
        ui.notifications.error("Значение урона по ОЗ должно быть положительным числом");
        return;
      }
      html.find('#hpadjust').val('0');
      await this.actor.applyDamage(adj);
    });

    html.find('#hddmg').click(async ev => {
      let adjStr = html.find('#hdadjust').val();
      let adj = parseInt(adjStr);
      if(String(adj) !== adjStr || adj < -1) {
        ui.notifications.error("Значение урона по КЗ должно быть положительным числом");
        return;
      }
      html.find('#hdadjust').val('0');
      await this.actor.applyHDDamage(adj);
    });

    html.find('#hdheal').click(async ev => {
      let adjStr = html.find('#hdadjust').val();
      let adj = parseInt(adjStr);
      if(String(adj) !== adjStr || adj < 1) {
        ui.notifications.error("Значение лечения по КЗ должно быть положительным числом");
        return;
      }
      html.find('#hdadjust').val('0');
      await this.actor.applyHeal(adj);
    });
  }
}
