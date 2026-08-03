/**
 * Godbound system for Foundry VTT.
 * Original author: jasonwocky. Migrated from Foundry 0.7.x to v13/v14.
 */

// Import Modules
import {GodboundActor, isMobCardinality, bloodWaterGiftData, cardinalityTokenSize, frayAttackData, fixGameIconPath} from "./actor.js";
import {GodboundItem} from "./item.js";
import {GodboundTokenDocument} from "./token.js";
import {GodboundItemSheet} from "./item-sheet.js";
import {GodboundActorSheet} from "./actor-sheet.js";
import {EffortCommitmentDialog} from "./effortCommitmentDialog.js";
import {PlayerRollDialog} from "./playerRollDialog.js";
import {Capitalize, Label, esc, itemChatImage, buildDamageFormula} from "./misc.js";
import {registerFullAccessSettings, registerFullAccessSocket} from "./fullAccess.js";
import {importGodboundActorFromFile} from "./export-import.js";

// v13+ removed the bare global `renderTemplate`; use the namespaced API (same as
// the other modules) so chat cards rendered from this file keep working.
const renderTemplate = foundry.applications.handlebars.renderTemplate;

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", async function () {
    console.log(`Initializing Godbound System`);

    /**
     * Set an initiative formula for the system
     * @type {String}
     */
    CONFIG.Combat.initiative = {
        formula: "1d20",
        decimals: 2
    };

    // Define custom Document classes
    CONFIG.Actor.documentClass = GodboundActor;
    CONFIG.Item.documentClass = GodboundItem;
    CONFIG.Token.documentClass = GodboundTokenDocument;

    // Godbound-flavoured status conditions. These become the clickable status
    // icons on the Token HUD and drive Foundry's native ActiveEffect system, so
    // conditions are visible on tokens and can be toggled by hand or applied by
    // gifts/effects. Icons are core Foundry svgs so nothing extra needs shipping.
    CONFIG.statusEffects = [
        {id: 'dead',        name: 'Мёртв',            img: 'icons/svg/skull.svg'},
        {id: 'dying',       name: 'При смерти',       img: 'icons/svg/blood.svg'},
        {id: 'unconscious', name: 'Без сознания',     img: 'icons/svg/unconscious.svg'},
        {id: 'prone',       name: 'Ничком',           img: 'icons/svg/falling.svg'},
        {id: 'blind',       name: 'Ослеплён',         img: 'icons/svg/blind.svg'},
        {id: 'deaf',        name: 'Оглох',            img: 'icons/svg/deaf.svg'},
        {id: 'frightened',  name: 'Испуган',          img: 'icons/svg/terror.svg'},
        {id: 'stunned',     name: 'Оглушён',          img: 'icons/svg/daze.svg'},
        {id: 'restrained',  name: 'Скован',           img: 'icons/svg/net.svg'},
        {id: 'paralyzed',   name: 'Парализован',      img: 'icons/svg/paralysis.svg'},
        {id: 'poisoned',    name: 'Отравлен',         img: 'icons/svg/poison.svg'},
        {id: 'burning',     name: 'Горит',            img: 'icons/svg/fire.svg'},
        {id: 'frozen',      name: 'Заморожен',        img: 'icons/svg/frozen.svg'},
        {id: 'sickened',    name: 'Дурнота',          img: 'icons/svg/acid.svg'},
        {id: 'slowed',      name: 'Замедлен',         img: 'icons/svg/downgrade.svg'},
        {id: 'hasted',      name: 'Ускорен',          img: 'icons/svg/upgrade.svg'},
        {id: 'invisible',   name: 'Невидим',          img: 'icons/svg/invisible.svg'},
        {id: 'silenced',    name: 'Немота',           img: 'icons/svg/silenced.svg'},
        {id: 'blessed',     name: 'Благословлён',     img: 'icons/svg/angel.svg'},
        {id: 'marked',      name: 'Приложено Усилие', img: 'icons/svg/aura.svg'},
        {id: 'bloodwater',  name: 'Кровь как вода',   img: 'icons/svg/blood.svg'},
    ];
    // Keep the combat-tracker "defeated" toggle mapped to the dead condition.
    CONFIG.specialStatusEffects = foundry.utils.mergeObject(
        CONFIG.specialStatusEffects || {}, {DEFEATED: 'dead'});

    // Register sheet application classes. Core no longer registers default
    // sheets in v13+, so we simply register ours as the default.
    foundry.documents.collections.Actors.registerSheet("godbound", GodboundActorSheet, {
        types: ["pc", "npc", "faction", "godwalker"],
        makeDefault: true
    });
    foundry.documents.collections.Items.registerSheet("godbound", GodboundItemSheet, {
        makeDefault: true
    });

    registerFullAccessSettings();

    // Register system settings
    game.settings.register("godbound", "macroShorthand", {
        name: "Сокращённый синтаксис макросов",
        hint: "Включает сокращённый синтаксис макросов, позволяющий ссылаться на характеристики напрямую, например @str вместо @attributes.str.value. Отключите, если нужна возможность ссылаться на полную модель характеристики, например @attributes.str.label.",
        scope: "world",
        type: Boolean,
        default: true,
        config: true
    });

    // One-time-migration marker: the ready-time backfills (token bars, sight,
    // blood-water gift) only need to run until every pre-existing actor/token has
    // been brought up to the current defaults. Once a pass completes it stamps
    // this with BACKFILL_VERSION so later logins skip the whole world scan.
    game.settings.register("godbound", "backfillVersion", {
        scope: "world", config: false, type: Number, default: 0
    });

    Handlebars.registerHelper('concat', function() {
        var outStr = '';
        for (var arg in arguments) {
            if (typeof arguments[arg] != 'object') {
                outStr += arguments[arg];
            }
        }
        return outStr;
    });

    Handlebars.registerHelper('orderedEach', function(obj, keys, options) {
        let accum = '';
        for(let i = 0; i < keys.length; i++) {
            let value = obj[keys[i]];
            if(value) {
                accum += options.fn(value);
            }
        }
        return accum;
    });

    Handlebars.registerHelper('toLowerCase', function(str) {
        // Guard against undefined/null (mirrors the `select` helper below) so a
        // missing field can't throw and abort the whole template render.
        return String(str ?? '').toLowerCase();
    });

    Handlebars.registerHelper('cap', function(str) {
        return Capitalize(str);
    });

    const DAMAGE_TYPE_NAMES = {
        physical: 'Физический', fire: 'Огонь', cold: 'Холод', lightning: 'Молния',
        acid: 'Кислота', poison: 'Яд', disease: 'Болезнь', magic: 'Магия',
        holy: 'Свет', unholy: 'Тьма'
    };
    Handlebars.registerHelper('dmgType', function(key) {
        return DAMAGE_TYPE_NAMES[key] || Capitalize(key);
    });

    Handlebars.registerHelper("ifeq", function(arg1, arg2, options) {
        if (arg1 === arg2) {
            return options.fn(this);
        }
    });

    Handlebars.registerHelper("unlesseq", function(arg1, arg2, options) {
        if (arg1 !== arg2) {
            return options.fn(this);
        }
    });

    Handlebars.registerHelper("ifcombatpower", function(actorId, itemId, options) {
        let actor = game.actors.get(actorId);
        if(actor) {
            let item = actor.items.get(itemId);
            if(item) {
                if(item.system.combatPower) {
                    if(item.type === 'artifactPower') {
                        let artifactId = item.system.artifactId;
                        let artifact = actor.items.get(artifactId);
                        if(!artifact || !artifact.system.completed || !artifact.system.bound) {
                            return;
                        }
                    }
                    return options.fn(this);
                }
            }
        }
    });

    Handlebars.registerHelper("ifneq", function(arg1, arg2, options) {
        if (arg1 !== arg2) {
            return options.fn(this);
        }
    });

    Handlebars.registerHelper('times', function(n, options) {
        var accum = '';
        for(var i = 0; i < n; ++i)
            accum += options.fn(i);
        return accum;
    });

    Handlebars.registerHelper('add', function(a1, a2) {
        return a1 + a2;
    });

    // Русские имена типов чакра-слотов Богохода.
    Handlebars.registerHelper('slotName', function(key) {
        return {fire: 'Огонь', metal: 'Металл', void: 'Пустота', water: 'Вода', wind: 'Ветер'}[key] || key;
    });

    Handlebars.registerHelper('json', function(context) {
        return JSON.stringify(context);
    });

    // The core `select` block helper was removed from Foundry core; the sheets
    // still rely on it, so provide a compatible implementation. It marks the
    // <option> whose value matches `selected` with the `selected` attribute.
    Handlebars.registerHelper('select', function(selected, options) {
        const escaped = Handlebars.escapeExpression(selected == null ? '' : String(selected));
        const pattern = new RegExp('value=["\']' + escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']');
        const html = options.fn(this);
        return html.replace(pattern, '$& selected');
    });

    // Guard `checked` in case core no longer registers it.
    if (!Handlebars.helpers.checked) {
        Handlebars.registerHelper('checked', function(value) {
            return value ? 'checked' : '';
        });
    }

    /**
     * Resolve the actor a chat-card button refers to.
     *
     * Most NPCs are placed as UNLINKED tokens, whose synthetic actor is not in
     * game.actors and — crucially — REUSES the base actor's id. So an id alone
     * cannot tell three copies of the same goblin apart: game.actors.get(id)
     * returns the shared prototype, and searching the canvas by id always finds
     * the first copy. Every card therefore also bakes the token's UUID, which is
     * unique per placed token; the id is only the fallback for legacy messages
     * already stored in the world (and for linked/world actors).
     */
    function resolveCardActor({tokenUuid, actorId} = {}) {
        if (tokenUuid) {
            const doc = fromUuidSync?.(tokenUuid);
            const actor = doc?.actor ?? (doc?.documentName === 'Actor' ? doc : null);
            if (actor) return actor;
        }
        if (actorId) {
            const match = (t) => t?.actor && t.actor.id === actorId;
            const tok = Array.from(game.user.targets).find(match)
                || canvas.tokens?.controlled?.find(match)
                || canvas.tokens?.placeables?.find(match);
            if (tok?.actor) return tok.actor;
            const actor = game.actors.get(actorId);
            if (actor) return actor;
        }
        return null;
    }
    game.Godbound = game.Godbound || {};
    game.Godbound.resolveCardActor = resolveCardActor;

    $(document).on('click', '.damage-formula-roll', ev => {
        let span = $(ev.currentTarget);
        let formula = span.data('formula');
        let actor = resolveCardActor({tokenUuid: span.data('tokenUuid'), actorId: span.data('actorId')});
        if (actor) {
            let damageSource = actor.items.get(span.data('damageSource'));
            actor.rollDamage(damageSource, formula);
        }
    });

    $(document).on('click', '.apply-damage-btn', async ev => {
        let $btn = $(ev.currentTarget);
        let actorId = $btn.data('targetActorId');
        let tokenUuid = $btn.data('targetTokenUuid');
        let actor = resolveCardActor({tokenUuid, actorId});
        if (!actor) {
            // No target was baked in at roll time (or the button is being reused) -
            // resolve live against whatever is currently targeted/selected instead.
            let target = game.user.targets.values().next().value || canvas.tokens?.controlled?.[0];
            actor = target?.actor;
        }
        if (!actor) {
            ui.notifications.warn("Выберите (Target) или выделите цель, чтобы нанести урон.");
            return;
        }
        let amount = parseInt($btn.data('amount'));
        let damageType = $btn.data('damageType');
        let isMagic = $btn.data('isMagic') === true || $btn.data('isMagic') === 'true';
        let saveType = $btn.data('saveType');
        if (!isNaN(amount)) {
            // Save-for-half: if the power allows a saving throw, roll it for the
            // target and halve the damage on success. NPCs use their flat save
            // number; PCs use the matching computed save. A d20 result >= the
            // save target succeeds.
            let saveNote = '';
            if (saveType) {
                let saveTarget = actor.type === 'pc'
                    ? actor.system.computed?.saves?.[saveType]?.save
                    : actor.system.save;
                if (typeof saveTarget === 'number') {
                    let saveRoll = new Roll('1d20');
                    await saveRoll.evaluate();
                    if (game.dice3d) await game.dice3d.showForRoll(saveRoll, game.user, true);
                    // Natural 1 always fails, natural 20 always succeeds.
                    const nat = saveRoll.dice?.[0]?.results?.[0]?.result;
                    const saved = nat === 20 || (nat !== 1 && saveRoll.total >= saveTarget);
                    if (saved) {
                        amount = Math.floor(amount / 2);
                        saveNote = ` [спас ${saveRoll.total}${nat === 20 ? ' (нат.20)' : '≥' + saveTarget}: ½]`;
                    } else {
                        saveNote = ` [провал ${saveRoll.total}${nat === 1 ? ' (нат.1)' : '<' + saveTarget}]`;
                    }
                }
            }
            let mitigated = actor._mitigateDamage ? actor._mitigateDamage(amount, damageType, isMagic) : amount;
            if (actor.type === 'pc') {
                await actor.applyDamage(amount, damageType, isMagic);
            } else {
                await actor.applyHDDamage(amount, damageType, isMagic);
            }
            // The button is deliberately never spent: the same damage roll gets
            // walked across several targets, and the first click quite often lands
            // on the wrong one and has to be repeated on the right target. So every
            // click simply applies the damage again to whoever is resolved now.
            // That makes the label the ONLY in-chat confirmation a click registered,
            // so it is refreshed EVERY time (with a ×N counter) rather than written
            // once. The note lives in its own node so it is replaced, not appended;
            // messages already stored in the world still hold legacy
            // <input type="button">, whose label lives in `value` and has no children.
            const applied = (Number($btn.data('gbApplyCount')) || 0) + 1;
            $btn.data('gbApplyCount', applied);
            const note = `нанесено: ${mitigated}${saveNote}` + (applied > 1 ? ` ×${applied}` : '');
            $btn.addClass('used');
            if ($btn.is('input')) {
                if (!$btn.data('gbBaseLabel')) $btn.data('gbBaseLabel', $btn.val());
                $btn.val(`${$btn.data('gbBaseLabel')} (${note})`);
            } else {
                let $note = $btn.find('.gb-btn__note');
                if (!$note.length) $note = $(`<span class="gb-btn__note"></span>`).appendTo($btn);
                $note.text(note);
            }
            // Re-trigger the flash so a repeat click is visibly acknowledged even
            // when the text happens to be identical.
            $btn.removeClass('gb-btn--flash');
            void $btn[0].offsetWidth;
            $btn.addClass('gb-btn--flash');
        }
    });

    // A gift/word/artifact-power posted to chat with a saveType set shows this button.
    // Whoever clicks it rolls the save for their OWN assigned character (not a stored
    // target), since the poster doesn't know in advance who the effect will land on.
    $(document).on('click', '.gift-save-roll-btn', ev => {
        let $btn = $(ev.currentTarget);
        let save = $btn.data('save');
        let giftName = $btn.data('giftName');
        // Optional pre-rolled damage (theurgy / low magic): apply on a FAILED save.
        let dmgNormal = $btn.data('dmgNormal');
        let dmgStraight = $btn.data('dmgStraight');
        let dmgType = $btn.data('damageType');
        let dmgIsMagic = $btn.data('isMagic');
        let hasDamage = dmgNormal !== undefined && dmgNormal !== '' && dmgNormal !== null;
        // Damage FORMULA (power-use cards, e.g. an Art level with effectType=save):
        // nothing is pre-rolled there, so the damage is rolled here on a failed save.
        let dmgFormula = $btn.data('dmgFormula');
        let actor = game.user.character;
        if (!actor) {
            let controlled = canvas?.tokens?.controlled?.[0];
            actor = controlled?.actor;
        }
        if (!actor) {
            ui.notifications.warn("Нет назначенного персонажа для броска спасброска. Выберите токен или назначьте персонажа.");
            return;
        }
        // NPCs have a single flat save number used for EVERY save type (Стойкость /
        // Уклонение / Дух all resolve to system.save); only PCs have per-type saves.
        let saveData = actor.type === 'npc'
            ? {save: actor.system.save}
            : actor.system.computed?.saves?.[save];
        if (!saveData || typeof saveData.save !== 'number') {
            ui.notifications.warn(`У ${actor.name} нет спасброска "${Label(save)}".`);
            return;
        }
        PlayerRollDialog.create(actor, {rollType: `Спасбросок: ${Label(save)}`}, async (data) => {
            let template = 'systems/godbound/templates/chat/saving-throw-result.html';
            let chatData = {
                author: game.user.id,
                speaker: ChatMessage.getSpeaker({actor}),
            };
            let templateData = {
                title: 'Спасбросок',
                details: `${Label(save)} против «${giftName}» - ${data.modifier < 0 ? 'Трудно' : data.modifier > 0 ? 'Легко' : 'Обычно'}`,
                data: data,
            };
            let roll = new Roll('1d20 + @difficulty', {difficulty: data.modifier});
            await roll.evaluate();
            let target = saveData.save;
            // Natural 1 always fails, natural 20 always succeeds.
            const nat = roll.dice?.[0]?.results?.[0]?.result;
            let result = {
                isSuccess: nat === 20 || (nat !== 1 && roll.total >= target),
                isFailure: nat === 1 || (nat !== 20 && roll.total < target),
                target: target,
            };
            result.className = result.isSuccess ? 'result-msg-success' : 'result-msg-failure';
            templateData.roll = await roll.render();
            templateData.result = result;
            templateData.data.actor = actor;
            // On a failed save, offer a one-click "Нанести урон" against the same
            // character that just rolled (the effect landed on them).
            chatData.rolls = [roll];
            if (result.isFailure && hasDamage) {
                templateData.data.damage = {
                    normal: dmgNormal,
                    straight: dmgStraight,
                    damageType: dmgType,
                    isMagic: dmgIsMagic,
                    targetActorId: actor.id,
                };
            } else if (result.isFailure && (dmgFormula || Number($btn.data('dmgBonus')))) {
                // No pre-rolled numbers on the card — roll the damage now. Кубик
                // необязателен: плоский урон приходит одним лишь бонусом.
                const formula = buildDamageFormula(dmgFormula, $btn.data('dmgBonus'));
                try {
                    const dmgRoll = new Roll(formula);
                    await dmgRoll.evaluate();
                    templateData.data.damage = {
                        normal: actor._toNormalDamage ? actor._toNormalDamage(dmgRoll) : dmgRoll.total,
                        straight: dmgRoll.total,
                        damageType: dmgType || 'magic',
                        isMagic: dmgIsMagic ?? true,
                        targetActorId: actor.id,
                        rollHtml: await dmgRoll.render(),
                    };
                    chatData.rolls.push(dmgRoll);
                } catch (e) {
                    console.warn('Godbound | не удалось бросить урон по формуле', formula, e);
                }
            }
            chatData.content = await renderTemplate(template, templateData);
            if (game.dice3d) {
                await game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind);
                await ChatMessage.create(chatData);
            } else {
                chatData.sound = CONFIG.sounds.dice;
                await ChatMessage.create(chatData);
            }
        });
    });

    // "Activate Divine Fury" button on the 0-HP chat prompt. Anyone who owns the
    // hero (or a GM) can click it to spend a charge and keep fighting.
    $(document).on('click', '.divine-fury-activate', ev => {
        const $btn = $(ev.currentTarget);
        const actor = resolveCardActor({tokenUuid: $btn.data('tokenUuid'), actorId: $btn.data('actorId')});
        if (!actor) { ui.notifications.warn('Актёр не найден.'); return; }
        if (!actor.isOwner) { ui.notifications.warn('Нет прав на этого персонажа.'); return; }
        actor.activateDivineFury();
    });

    // "Attack again": re-run the same attack from its chat card. Useful after a hit
    // (green) or a miss (red) — pick a new/other target with the targeting tool and
    // click to roll the identical attack again. Resolves against whatever token is
    // currently targeted, exactly like the original roll.
    $(document).on('click', '.attack-again-btn', async ev => {
        let $btn = $(ev.currentTarget);
        let actor = resolveCardActor({tokenUuid: $btn.data('tokenUuid'), actorId: $btn.data('actorId')});
        if (!actor) { ui.notifications.warn('Актёр не найден для повторной атаки.'); return; }
        let item = actor.items.get($btn.data('itemId'));
        if (!item) { ui.notifications.warn('Атака не найдена (предмет удалён?).'); return; }
        await actor.rollAttack(item);
    });

    $(document).on('click', '.instant-auto-save', ev => {
        let span = $(ev.currentTarget);
        let actor = resolveCardActor({tokenUuid: span.data('tokenUuid'), actorId: span.data('actorId')});
        if (actor) {
            actor.autoSave();
        }
    });

    if(!game.Godbound) {
        game.Godbound = {};
    }
    game.Godbound.executeGodboundItemMacro = executeGodboundItemMacro;
    Hooks.on("hotbarDrop", (bar, data, slot) => {
        if (data.type === "Item") {
            createGodboundMacro(data, slot);
            return false;
        }
    });

    // The default Token HUD only has two resource bars (used here for HP and
    // Armor), so there's no bar left for Effort. Inject a small readout of
    // free/total Effort into the HUD instead so it's visible at a glance.
    Hooks.on("renderTokenHUD", (hud, html) => {
        const actor = hud?.object?.actor;
        if (!actor) return;
        const eff = actor.system?.computed?.effort;
        const total = actor.system?.effort?.total;
        if (!eff || typeof eff.available !== "number" || typeof total !== "number") return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        root.querySelector(".gb-effort-hud")?.remove();
        const el = document.createElement("div");
        el.className = "gb-effort-hud";
        el.title = "Свободное / Всего Усилий";
        el.textContent = `Усилие: ${eff.available}/${total}`;
        root.appendChild(el);
    });

    // Add an "Import character" button to the Actors sidebar so a character
    // exported from another world can be brought in even when this world has no
    // character to open a sheet from yet.
    Hooks.on("renderActorDirectory", (app, html) => {
        if (!game.user.can("ACTOR_CREATE")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector(".godbound-import-actor")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "godbound-import-actor";
        btn.innerHTML = `<i class="fas fa-file-import"></i> Импорт персонажа`;
        btn.addEventListener("click", () => importGodboundActorFromFile());
        const header = root.querySelector(".directory-header") || root.querySelector("header");
        if (header) header.after(btn);
        else root.prepend(btn);
    });

    // Auto-toggle the death indicator when HP/HD crosses zero. Only the active
    // GM writes the change so it isn't applied several times over in multi-GM
    // games. A PC at 0 HP is dying; an NPC at 0 HD is dead.
    Hooks.on("updateActor", async (actor, changed) => {
        if (game.users?.activeGM !== game.user) return;

        // Gaining a NEW level restores the once-per-level Divine Fury, so the counter
        // shown on the sheet refills by itself (the GM can still set it by hand).
        const touchedLevel = ("system.level" in changed)
            || foundry.utils.hasProperty(changed, "system.level");
        if (actor.type === 'pc' && touchedLevel) {
            const level = actor.system.level || 0;
            const usedAt = actor.system.divineFury?.usedAtLevel || 0;
            const left = Number(actor.system.divineFury?.remaining ?? 1) || 0;
            if (level > usedAt && left < 1) {
                try {
                    await actor.update({'system.divineFury.remaining': 1}, {godboundFuryUse: true});
                    ui.notifications?.info(`${actor.name}: Божественная ярость восстановлена (новый уровень).`);
                } catch (e) {
                    console.warn("Godbound | could not refresh divine fury for", actor?.name, e);
                }
            }
        }

        const touchedHp = foundry.utils.hasProperty(changed, "system.hp.current");
        const touchedHd = foundry.utils.hasProperty(changed, "system.hd.current");
        if (!touchedHp && !touchedHd) return;
        try {
            if (actor.type === 'pc' && touchedHp) {
                const dying = (actor.system.hp?.current ?? 1) <= 0;
                const wasDying = actor.statuses.has('dying');
                if (wasDying !== dying) {
                    await actor.toggleStatusEffect('dying', {active: dying});
                }
                // Just dropped to 0 HP: if the hero still has Divine Fury charges,
                // post a chat prompt (visible to all) with a one-click activate button.
                if (dying && !wasDying) {
                    const level = actor.system.level || 0;
                    const available = level > (actor.system.divineFury?.usedAtLevel || 0);
                    if (available) {
                        // Bake the token UUID too (like every other chat-card button)
                        // so resolveCardActor can disambiguate an unlinked-token hero
                        // instead of falling back to the shared base-actor id.
                        const tokenUuid = actor.token?.uuid
                            ?? actor.getActiveTokens?.()[0]?.document?.uuid ?? '';
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({actor}),
                            content:
                                `<div class="godbound chat-block gb-card gb-card--fury">` +
                                `<h2 class="gb-title"><span class="gb-title__text">0 ОЗ!</span></h2>` +
                                `<div class="gb-actor">` +
                                `<div class="gb-portraits"><img class="gb-portrait" src="${esc(actor.img)}" alt=""></div>` +
                                `<div class="gb-names"><span class="gb-name" title="${esc(actor.name)}">${esc(actor.name)}</span>` +
                                `<span class="gb-sub">при смерти</span></div></div>` +
                                `<div class="gb-note">Войти в Божественную ярость? Лечение до ½ макс. ОЗ, ` +
                                `+${level} Усилия, освобождение от связывающей магии.</div>` +
                                `<div class="gb-actions"><div class="gb-btns gb-btns--1">` +
                                `<button type="button" class="gb-btn gb-btn--danger divine-fury-activate" data-actor-id="${actor.id}" data-token-uuid="${esc(tokenUuid)}">` +
                                `<i class="fas fa-khanda"></i> Активировать ярость</button>` +
                                `</div></div></div>`,
                        });
                    }
                }
            } else if (actor.type === 'npc' && touchedHd) {
                const dead = (actor.system.hd?.current ?? 1) <= 0;
                if (actor.statuses.has('dead') !== dead) {
                    await actor.toggleStatusEffect('dead', {active: dead});
                }
            }
        } catch (e) {
            console.warn("Godbound | could not sync death status for", actor?.name, e);
        }
    });

    // Floating combat text: whenever an actor's HP (PC) or HD (NPC/token) changes,
    // scroll a "+N" (green heal) or "-N" (red damage) above each of its tokens. This
    // runs on preUpdate so the OLD value is still readable for the delta, and on every
    // connected client so the whole table sees the number, not just whoever applied it.
    Hooks.on("preUpdateActor", (actor, changed) => {
        if (!canvas?.ready) return;
        let path = null;
        if (foundry.utils.hasProperty(changed, "system.hp.current")) path = "system.hp.current";
        else if (foundry.utils.hasProperty(changed, "system.hd.current")) path = "system.hd.current";
        if (!path) return;
        const oldVal = foundry.utils.getProperty(actor, path);
        const newVal = foundry.utils.getProperty(changed, path);
        if (typeof oldVal !== "number" || typeof newVal !== "number") return;
        const delta = newVal - oldVal;
        if (!delta) return;
        const text = `${delta > 0 ? "+" : ""}${delta}`;
        const fill = delta > 0 ? 0x33dd33 : 0xdd3333;
        for (const token of actor.getActiveTokens()) {
            try {
                canvas.interface.createScrollingText(token.center, text, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
                    direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    distance: 2 * (token.h || 100),
                    fontSize: 28,
                    fill,
                    stroke: 0x000000,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            } catch (e) { /* canvas text is best-effort; never block the update */ }
        }
    });

    // Compendium container items can carry a flags.godbound payload describing the
    // child items that belong with them, so dragging one entry from a compendium
    // brings its whole kit. Once embedded on an actor the children are spawned
    // pointing at the parent's *actual* embedded id, and the flag is dropped so it
    // only runs once:
    //   - "art" (traditions / theurgy)  -> pendingLevels -> artLevel children
    //   - "artifact" (example artifacts) -> pendingPowers -> artifactPower children
    Hooks.on("createItem", async (item, options, userId) => {
        if (userId !== game.user.id) return;
        if (!item.parent || item.parent.documentName !== "Actor") return;
        if (item.type === "art") {
            const pending = item.getFlag("godbound", "pendingLevels");
            if (!pending || !pending.length) return;
            const levels = pending.map(l => ({
                name: l.name || `Уровень ${l.level}`,
                type: "artLevel",
                system: Object.assign(
                    {artId: item.id, level: l.level, description: l.description, usable: true, effortCost: 1},
                    l.system || {}
                )
            }));
            await item.parent.createEmbeddedDocuments("Item", levels);
            await item.unsetFlag("godbound", "pendingLevels");
        } else if (item.type === "artifact") {
            const pending = item.getFlag("godbound", "pendingPowers");
            if (!pending || !pending.length) return;
            const powers = pending.map(p => ({
                name: p.name,
                type: "artifactPower",
                img: p.img || item.img,
                system: Object.assign(
                    {artifactId: item.id, description: p.description || "", effortCost: p.effortCost || 1},
                    p.system || {}
                )
            }));
            await item.parent.createEmbeddedDocuments("Item", powers);
            await item.unsetFlag("godbound", "pendingPowers");
        }
    });
});

async function createGodboundMacro(data, slot) {
    // v13/v14 drops provide {type, uuid} rather than an embedded data payload.
    const item = await fromUuid(data.uuid);
    if (!item || !item.parent) {
        ui.notifications.warn("Кнопки макросов можно создавать только для предметов во владении");
        return false;
    }
    // Bake the item's UUID rather than a bare id: it also identifies the OWNER,
    // so it keeps working for items that live on an unlinked token's actor
    // (whose id is shared with the prototype). The name is kept as a second
    // argument purely so the macro can still be matched by name on whichever
    // character the player has selected. JSON.stringify handles quotes and
    // backslashes in item names, which plain interpolation used to break on.
    const command = `game.Godbound.executeGodboundItemMacro(${JSON.stringify(item.uuid)}, ${JSON.stringify(item.name)});`;
    let macro = game.macros.find(m => (m.name === item.name) && (m.command === command));
    if (!macro) {
        macro = await Macro.create({
            name: item.name,
            type: "script",
            img: itemChatImage(item),
            command: command,
            flags: { "godbound.itemMacro": true }
        });
    }
    game.user.assignHotbarMacro(macro, slot);
    return false;
}

/**
 * Run an item from a hotbar macro.
 *
 * Accepts two call shapes, because macros created before this change are
 * already sitting in players' hotbars and must keep working:
 *   new:    (itemUuid, itemName)
 *   legacy: (itemId, itemName, actorId)
 * A UUID always contains a dot ("Actor.abc.Item.def"); a bare document id never
 * does, which is what tells the two apart.
 *
 * The old version asked ChatMessage.getSpeaker() FIRST, so merely having some
 * other token selected on the canvas made it look for the ability on that
 * token's actor and fail with "нет предмета с именем …". Ownership is resolved
 * in a deliberate order instead: the character you are actually controlling
 * first (so the ability hits the right token copy, and a shared macro works for
 * whoever is selected), then the actor the macro was built from.
 */
async function executeGodboundItemMacro(...args) {
    let uuid = null, itemId = null, itemName = null, actorId = null;
    if (typeof args[0] === 'string' && args[0].includes('.')) {
        [uuid, itemName] = args;
    } else {
        [itemId, itemName, actorId] = args;
    }

    let baked = null;
    if (uuid) { try { baked = await fromUuid(uuid); } catch (e) { baked = null; } }
    if (baked) {
        itemId = baked.id;
        itemName = itemName || baked.name;
    }

    // Кандидаты в порядке убывания приоритета.
    const candidates = [];
    for (const token of (canvas?.tokens?.controlled ?? [])) if (token.actor) candidates.push(token.actor);
    for (const token of Array.from(game.user.targets ?? [])) if (token.actor) candidates.push(token.actor);
    if (game.user.character) candidates.push(game.user.character);
    if (baked?.parent) candidates.push(baked.parent);
    if (actorId) {
        const byId = game.actors.get(actorId);
        if (byId) candidates.push(byId);
    }

    let actor = null, item = null;
    for (const candidate of candidates) {
        if (!candidate?.items) continue;
        const found = (itemId && candidate.items.get(itemId))
            || (itemName && candidate.items.find(i => i.name === itemName));
        if (found) { actor = candidate; item = found; break; }
    }
    // Последняя попытка: предмет из UUID вместе с его владельцем.
    if (!item && baked?.parent) { actor = baked.parent; item = baked; }

    if (!item || !actor) {
        // Формулировка намеренно без слова «предмет»: в модели данных Foundry
        // Дары, Слова и Атаки — это документы типа Item, но за столом их так
        // никто не называет, и старое «нет предмета с именем …» заставляло
        // искать причину не там.
        return ui.notifications.warn(
            `«${itemName || uuid || itemId}» не найдено ни у выделенного токена, ни у вашего персонажа. ` +
            `Выделите токен того, кому это принадлежит, или назначьте себе персонажа.`);
    }

    // Диспетчеризация ровно как на листе персонажа. Раньше здесь были только
    // четыре типа, и Слова, уровни Искусств и прочее при нажатии молча ничего
    // не делали; теперь любой предмет как минимум выводит своё описание в чат.
    switch (item.type) {
        case 'attack':
            return actor.rollAttack(item);
        case 'autoHitAttack':
        case 'multiDieDamageRoll':
            return actor.rollDamage(item);
        case 'boundWord':
            return actor.useWord(item);
        case 'artLevel': {
            const effect = item.system?.effectType;
            if (effect && effect !== 'none') return actor.rollArtEffect(item);
            return actor.usePower(item);
        }
        case 'divineGift':
        case 'divineMiracle':
        case 'artifactPower':
        case 'art':
            return actor.usePower(item);
        default:
            return actor.showItemDescription(item);
    }
}

// Bump when a new one-time backfill needs to run for existing worlds.
const BACKFILL_VERSION = 3;

Hooks.once("ready", async () => {
    registerFullAccessSocket();
    // Only the PRIMARY GM runs the backfills (so a multi-GM table doesn't run them
    // several times over), and only until this world has been stamped with the
    // current BACKFILL_VERSION - after that the whole world scan is skipped.
    if (game.users?.activeGM === game.user &&
        game.settings.get("godbound", "backfillVersion") < BACKFILL_VERSION) {
        try {
            await backfillTokenBars();
            await backfillTokenSight();
            await backfillBloodWater();
            await backfillMobTokenSizes();
            await backfillFrayAndIcons();
            await game.settings.set("godbound", "backfillVersion", BACKFILL_VERSION);
        } catch (e) {
            console.error("Godbound | one-time backfill pass failed", e);
        }
    }
});

// Give every existing Mob NPC the "Кровь как вода" gift if it doesn't have it yet.
async function backfillBloodWater() {
    let added = 0;
    for (const actor of game.actors) {
        if (actor.type !== 'npc' || !isMobCardinality(actor.system?.cardinality)) continue;
        if (actor.items.some(i => i.name === 'Кровь как вода')) continue;
        try { await actor.createEmbeddedDocuments('Item', [bloodWaterGiftData()]); added++; }
        catch (e) { console.warn('Godbound | blood-water backfill failed for', actor?.name, e); }
    }
    if (added > 0) ui.notifications?.info(`Godbound: добавлен дар «Кровь как вода» у ${added} толп(ы).`);
}

// One-time pass: every PC gets the fray die «Кость Схватки» if missing, and
// items still pointing at the game-icons-net module (not installed → no icon)
// are switched to core Foundry icons.
async function backfillFrayAndIcons() {
    let icons = 0, fray = 0;
    for (const actor of game.actors) {
        const updates = [];
        for (const it of actor.items) {
            const fixedImg = fixGameIconPath(it.img);
            if (fixedImg) updates.push({_id: it.id, img: fixedImg});
        }
        if (updates.length) {
            try { await actor.updateEmbeddedDocuments('Item', updates); icons += updates.length; }
            catch (e) { console.warn('Godbound | icon backfill failed for', actor?.name, e); }
        }
        if (actor.type === 'pc' && !actor.items.some(i =>
            i.type === 'autoHitAttack' && (i.system?.fray || i.name === 'Кость Схватки'))) {
            try { await actor.createEmbeddedDocuments('Item', [frayAttackData()]); fray++; }
            catch (e) { console.warn('Godbound | fray backfill failed for', actor?.name, e); }
        }
    }
    if (icons > 0 || fray > 0) {
        ui.notifications?.info(`Godbound: исправлено иконок предметов: ${icons}, добавлена «Кость Схватки»: ${fray} перс.`);
    }
}

// One-time pass: bring every existing NPC (and their placed tokens) to the
// cardinality footprint — Одиночка 1×1, малая толпа 2×2, большая 3×3, огромная 4×4.
async function backfillMobTokenSizes() {
    let fixed = 0;
    for (const actor of game.actors) {
        if (actor.type !== 'npc') continue;
        const size = cardinalityTokenSize(actor.system?.cardinality);
        if (actor.prototypeToken?.width !== size || actor.prototypeToken?.height !== size) {
            try { await actor.update({prototypeToken: {width: size, height: size}}); fixed++; }
            catch (e) { console.warn('Godbound | mob-size backfill failed for actor', actor?.name, e); }
        }
    }
    for (const scene of game.scenes) {
        const updates = [];
        for (const token of scene.tokens) {
            if (token.actor?.type !== 'npc') continue;
            const size = cardinalityTokenSize(token.actor.system?.cardinality);
            if (token.width !== size || token.height !== size) {
                updates.push({_id: token.id, width: size, height: size});
            }
        }
        if (updates.length) {
            try { await scene.updateEmbeddedDocuments('Token', updates); fixed += updates.length; }
            catch (e) { console.warn('Godbound | mob-size backfill failed for scene', scene?.name, e); }
        }
    }
    if (fixed > 0) ui.notifications?.info(`Godbound: размеры токенов по численности исправлены у ${fixed} объект(ов).`);
}

// When an NPC's cardinality changes: resize its token footprint (Одиночка 1×1,
// малая толпа 2×2, большая 3×3, огромная 4×4) and, if it became a Mob, add
// "Кровь как вода" if missing.
Hooks.on("updateActor", async (actor, changed) => {
    if (game.users?.activeGM !== game.user) return;
    if (actor.type !== 'npc') return;
    if (!foundry.utils.hasProperty(changed, "system.cardinality")) return;
    const card = actor.system?.cardinality;
    const size = cardinalityTokenSize(card);
    try {
        if (actor.prototypeToken?.width !== size || actor.prototypeToken?.height !== size) {
            await actor.update({prototypeToken: {width: size, height: size}});
        }
        for (const token of actor.getActiveTokens()) {
            if (token.document.width !== size || token.document.height !== size) {
                await token.document.update({width: size, height: size});
            }
        }
    } catch (e) { console.warn('Godbound | could not resize token for', actor?.name, e); }
    if (isMobCardinality(card) && !actor.items.some(i => i.name === 'Кровь как вода')) {
        try { await actor.createEmbeddedDocuments('Item', [bloodWaterGiftData()]); }
        catch (e) { console.warn('Godbound | could not add blood-water gift to', actor?.name, e); }
    }
});

/**
 * Turn vision on for existing actors (including those organised in folders) and
 * for tokens already placed on scenes, matching the new prototype-token default:
 * sight enabled, range 120, 160° arc. Idempotent - documents already configured
 * that way are skipped, so it costs nothing on later loads.
 */
async function backfillTokenSight() {
    const SIGHT = {enabled: true, range: 120, angle: 160};
    const needs = (s) => !s || s.enabled !== true || s.range !== SIGHT.range || s.angle !== SIGHT.angle;
    let fixed = 0;
    // Batch all prototype-token fixes into one Actor.updateDocuments call instead
    // of an awaited round-trip per actor.
    const actorUpdates = [];
    for (const actor of game.actors) {
        if (needs(actor.prototypeToken?.sight)) {
            actorUpdates.push({_id: actor.id, prototypeToken: {sight: SIGHT}});
        }
    }
    if (actorUpdates.length) {
        try { await Actor.updateDocuments(actorUpdates); fixed += actorUpdates.length; }
        catch (e) { console.error("Godbound | failed to backfill actor sight", e); }
    }
    // One batched updateEmbeddedDocuments per scene for its already-placed tokens.
    for (const scene of game.scenes) {
        const tokenUpdates = [];
        for (const token of scene.tokens) {
            if (needs(token.sight)) tokenUpdates.push({_id: token.id, sight: SIGHT});
        }
        if (tokenUpdates.length) {
            try { await scene.updateEmbeddedDocuments("Token", tokenUpdates); fixed += tokenUpdates.length; }
            catch (e) { console.error("Godbound | failed to backfill token sight for scene", scene?.name, e); }
        }
    }
    console.log(`Godbound | token sight backfill complete, updated ${fixed} document(s)`);
    if (fixed > 0) {
        ui.notifications?.info(`Godbound: включено зрение (120, угол 160°) у ${fixed} объект(ов).`);
    }
}

/**
 * One-time fixup for actors created before this system explicitly set
 * prototypeToken.bar1/bar2 in Actor#_preCreate - those actors were left with
 * no HP/Armor bar attribute assigned, so neither shows on the Token HUD.
 */
async function backfillTokenBars() {
    const HP_BAR = "computed.hp.bar";
    const ARMOR_BAR = "computed.armor.bar";
    let fixed = 0;
    // Batch prototype-token bar fixes into a single Actor.updateDocuments call.
    const actorUpdates = [];
    for (const actor of game.actors) {
        // Only pc/npc populate these derived bar paths.
        if (actor.type !== 'pc' && actor.type !== 'npc') continue;
        const bar1 = actor.prototypeToken?.bar1?.attribute;
        const bar2 = actor.prototypeToken?.bar2?.attribute;
        if (bar1 !== HP_BAR || bar2 !== ARMOR_BAR) {
            actorUpdates.push({_id: actor.id, prototypeToken: {
                bar1: {attribute: HP_BAR}, bar2: {attribute: ARMOR_BAR}
            }});
        }
    }
    if (actorUpdates.length) {
        try { await Actor.updateDocuments(actorUpdates); fixed += actorUpdates.length; }
        catch (e) { console.error("Godbound | failed to fix prototype token bars", e); }
    }
    // Tokens already placed on a scene keep their own bar1/bar2 (copied from
    // the prototype at drop time), so fixing the actor alone doesn't help them.
    for (const scene of game.scenes) {
        const tokenUpdates = [];
        for (const token of scene.tokens) {
            const tType = token.actor?.type;
            if (tType && tType !== 'pc' && tType !== 'npc') continue;
            const bar1 = token.bar1?.attribute;
            const bar2 = token.bar2?.attribute;
            if (bar1 !== HP_BAR || bar2 !== ARMOR_BAR) {
                tokenUpdates.push({_id: token.id, bar1: {attribute: HP_BAR}, bar2: {attribute: ARMOR_BAR}});
            }
        }
        if (tokenUpdates.length) {
            try { await scene.updateEmbeddedDocuments("Token", tokenUpdates); fixed += tokenUpdates.length; }
            catch (e) { console.error("Godbound | failed to fix token bars for scene", scene?.name, e); }
        }
    }
    console.log(`Godbound | token bar backfill complete, updated ${fixed} document(s)`);
    if (fixed > 0) {
        ui.notifications?.info(`Godbound: обновлены полосы токенов (HP снизу, Броня сверху) у ${fixed} объект(ов). Переоткройте HUD токена.`);
    }
}

/* -------------------------------------------- */
/*  GM-тултип при наведении на токен            */
/* -------------------------------------------- */

// The GM sees a compact stat card next to a token on plain hover, without
// having to open the token HUD (right-click) or the sheet.
function gbRemoveTokenTooltip() {
    document.getElementById('gb-token-tooltip')?.remove();
}

function gbTokenTooltipHtml(actor) {
    const e = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const sys = actor.system;
    const rows = [];
    const row = (label, value) => rows.push(
        `<div class="gb-tt-row"><span>${label}</span><b>${value}</b></div>`);
    if (actor.type === 'pc') {
        row('Уровень', e(sys.level));
        row('ОЗ', `${e(sys.hp?.current)} / ${e(sys.computed?.hp?.max)}`);
        row('КБ', e(sys.computed?.armor?.ac));
        const sv = sys.computed?.saves;
        if (sv) row('Спасброски', `Ст ${e(sv.hardiness?.save)}+ · Ук ${e(sv.evasion?.save)}+ · Дух ${e(sv.spirit?.save)}+`);
        row('Усилие', `${e(sys.computed?.effort?.available ?? 0)} / ${e(sys.effort?.total ?? 0)}`);
    } else if (actor.type === 'npc') {
        row('КЗ', `${e(sys.hd?.current)} / ${e(sys.hd?.max)}`);
        if (sys.computed?.isMob) {
            row('Бойцов', `${e(sys.computed.mobRemaining)}${sys.computed.mobTotal ? ' / ' + e(sys.computed.mobTotal) : ''}`);
        }
        row('КБ', e(sys.ac));
        row('Спасбросок', `${e(sys.save)}+`);
        row('Мораль', e(sys.morale));
        if (sys.move) row('Движение', e(sys.move));
        row('Атаки', `${e(sys.numAttacks ?? 1)} (действий: ${e(sys.numActions ?? 1)})`);
        if (Number(sys.effort?.total) > 0) {
            row('Усилие', `${e(sys.computed?.effort?.available ?? 0)} / ${e(sys.effort.total)}`);
        }
    } else if (actor.type === 'faction') {
        const f = sys.faction || {};
        row('Мощь', e(f.power));
        row('Кость действия', e(f.actionDie));
        row('Сплочённость', `${e(f.cohesion?.current)} / ${e(f.cohesion?.max)}`);
        row('Проблемы', `${e(f.trouble?.current ?? 0)} / ${e(f.trouble?.max ?? 6)}`);
    }
    return `<div class="gb-tt-name">${e(actor.name)}</div>${rows.join('')}`;
}

Hooks.on('hoverToken', (token, hovered) => {
    if (!game.user?.isGM) return;
    gbRemoveTokenTooltip();
    if (!hovered || !token?.actor) return;
    const div = document.createElement('div');
    div.id = 'gb-token-tooltip';
    div.className = 'godbound';
    div.innerHTML = gbTokenTooltipHtml(token.actor);
    document.body.appendChild(div);
    // Ставим карточку справа от токена; если не влезает — слева/в пределах окна.
    let pt;
    try {
        pt = canvas.clientCoordinatesFromCanvas({x: token.document.x + token.w, y: token.document.y});
    } catch (err) {
        const t = token.worldTransform;
        pt = {x: t.tx + token.w * canvas.stage.scale.x, y: t.ty};
    }
    let left = pt.x + 10;
    let top = pt.y;
    const r = div.getBoundingClientRect();
    if (left + r.width > window.innerWidth - 8) {
        try {
            const p2 = canvas.clientCoordinatesFromCanvas({x: token.document.x, y: token.document.y});
            left = p2.x - r.width - 10;
        } catch (err) {
            left = window.innerWidth - r.width - 8;
        }
    }
    top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
});

Hooks.on('canvasPan', gbRemoveTokenTooltip);
Hooks.on('deleteToken', gbRemoveTokenTooltip);
Hooks.on('canvasTearDown', gbRemoveTokenTooltip);
