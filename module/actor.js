import {TypeNames, Label, esc, isPlainDescription, itemChatImage, buildDamageFormula} from "./misc.js";
import {EffortCommitmentDialog} from "./effortCommitmentDialog.js";

const renderTemplate = foundry.applications.handlebars.renderTemplate;

// Cardinalities that count as a Mob (Толпа). Mobs automatically carry the
// "Кровь как вода" gift.
export const MOB_CARDINALITIES = ['SmallMob', 'LargeMob', 'VastMob'];
export const isMobCardinality = (c) => MOB_CARDINALITIES.includes(c);
// Token footprint (in grid squares, N×N) per cardinality: single 1×1,
// Small Mob 2×2, Large Mob 3×3, Vast Mob 4×4.
export const CARDINALITY_TOKEN_SIZE = {
    Individual: 1, 'Одиночка': 1, SmallMob: 2, LargeMob: 3, VastMob: 4,
};
export const cardinalityTokenSize = (c) => CARDINALITY_TOKEN_SIZE[c] || 1;

// Стартовая авто-атака «Кость Схватки» (fray die 1к8) — должна быть у каждого
// персонажа-ПС. Иконка из ядра Foundry, чтобы не зависеть от модулей.
export const frayAttackData = () => ({
    name: 'Кость Схватки', type: 'autoHitAttack',
    img: 'icons/svg/sword.svg',
    system: {damageRoll: '1d8', fray: true}
});

// Старые версии системы ссылались на иконки модуля game-icons-net, который
// может быть не установлен — тогда предметы остаются без иконки. Замена на
// иконки из ядра Foundry (существуют в любой установке).
export const GAME_ICON_FIX = {
    'sword-spin.svg': 'icons/svg/sword.svg',
    'shield-reflect.svg': 'icons/svg/holy-shield.svg',
    'halt.svg': 'icons/svg/daze.svg',
    'hypersonic-bolt.svg': 'icons/svg/lightning.svg',
    'explosion-rays.svg': 'icons/svg/explosion.svg',
};
export const fixGameIconPath = (img) => {
    if (!(img || '').startsWith('modules/game-icons-net/')) return null;
    return GAME_ICON_FIX[img.split('/').pop()] || 'icons/svg/item-bag.svg';
};

/**
 * Describe a targeted token for a chat card's "apply damage" buttons.
 *
 * The token UUID is what actually identifies the victim: unlinked tokens (the
 * default for NPCs) share their base actor's id, so three copies of the same
 * goblin would otherwise all carry the same `id` and every button would hit
 * whichever copy the canvas happened to list first. The id is kept only as a
 * fallback for world/linked actors and for chat messages already stored in the
 * world before this field existed.
 */
const targetRef = (t) => ({
    id: t.actor.id,
    uuid: t.document?.uuid ?? null,
    name: t.document?.name ?? t.name,
});
// The "Blood Runs Like Water" mob gift, added to every Mob NPC.
export const bloodWaterGiftData = () => ({
    name: 'Кровь как вода', type: 'divineGift', img: 'icons/svg/blood.svg',
    system: {
        description: 'Толпа настолько многочисленна, что её удары сыплются без промаха. В свой ход толпа может совершить атаку, автоматически попадающую по цели, — но до начала её следующего хода все атаки по самой толпе тоже автоматически попадают. Активируйте (метка на токене), снимите в начале своего следующего хода.',
        free: true, combatPower: true, action: true, noEffort: true,
    },
});

export class GodboundActor extends Actor {

    /**
     * system.json's primaryTokenAttribute/secondaryTokenAttribute are only a
     * suggested default for the Token Config UI - they don't actually get
     * written onto a new Actor's prototypeToken.bar1/bar2. Without this, no
     * token (new or old) has an attribute assigned, so the HUD shows nothing
     * for HP/Armor. Set them explicitly whenever they haven't already been
     * set (e.g. by a compendium import that specifies its own bars).
     */
    async _preCreate(data, options, user) {
        await super._preCreate(data, options, user);
        // Vision on by default for every token type: sight works without any light
        // source out to 120 units with a 160° arc. Applied whenever sight isn't
        // already switched on - so brand-new actors and compendium enemies (whose
        // default sight is disabled) get vision, while anything that already has
        // vision deliberately enabled (e.g. an imported character) is left as-is.
        const incomingSight = foundry.utils.getProperty(data, "prototypeToken.sight");
        if (!(incomingSight && incomingSight.enabled === true)) {
            this.updateSource({
                prototypeToken: {sight: {enabled: true, range: 120, angle: 160}}
            });
        }
        // Only pc/npc populate computed.hp.bar / computed.armor.bar. Pointing any
        // other type's token at those (empty) paths just shows a blank bar, so
        // restrict the bar assignment to the types that actually fill them.
        if (this.type === 'pc' || this.type === 'npc') {
            this.updateSource({
                prototypeToken: {
                    bar1: {attribute: "computed.hp.bar"},
                    bar2: {attribute: "computed.armor.bar"}
                }
            });
        }
        // Mobs carry the "Кровь как вода" gift from the start.
        if (this.type === 'npc' && isMobCardinality(foundry.utils.getProperty(data, 'system.cardinality'))) {
            const existing = foundry.utils.getProperty(data, 'items') || [];
            if (!existing.some(i => i.name === 'Кровь как вода')) {
                this.updateSource({items: [...existing, bloodWaterGiftData()]});
            }
        }
        // Token footprint scales with the mob size (1×1 single, 2×2 small,
        // 3×3 large, 4×4 vast) unless the incoming data already specifies its
        // own dimensions.
        if (this.type === 'npc') {
            const incoming = foundry.utils.getProperty(data, 'prototypeToken');
            if (!(incoming && (incoming.width || incoming.height))) {
                const size = cardinalityTokenSize(foundry.utils.getProperty(data, 'system.cardinality'));
                this.updateSource({prototypeToken: {width: size, height: size}});
            }
        }
        // Every PC gets the fray die: new (empty) actors receive the whole starter
        // kit below; imported actors that already carry items still get the fray
        // attack appended when it is missing.
        if (this.type === 'pc' && data.items && data.items.length) {
            const incoming = foundry.utils.getProperty(data, 'items') || [];
            const hasFray = incoming.some(i =>
                i.type === 'autoHitAttack' && (i.system?.fray || i.name === 'Кость Схватки'));
            if (!hasFray) {
                this.updateSource({items: [...incoming, frayAttackData()]});
            }
        }
        if (this.type === 'pc' && !(data.items && data.items.length)) {
            this.updateSource({
                items: [
                    frayAttackData(),
                    {
                        name: 'Успех на спасброске', type: 'divineMiracle',
                        img: 'icons/svg/holy-shield.svg',
                        system: {
                            description: "Преуспеть в проваленном спасброске",
                            effortCost: 1,
                            instant: true,
                        }
                    },
                    {
                        name: 'Развеять эффект', type: 'divineMiracle',
                        img: 'icons/svg/daze.svg',
                        system: {
                            description: "Развеять подходящий эффект, мгновенно — если он направлен прямо на вас.",
                            effortCost: 1,
                            action: true,
                            instant: true,
                        }
                    },
                    {
                        name: 'Божественный Гнев', type: 'divineMiracle',
                        img: 'icons/svg/lightning.svg',
                        system: {
                            description: "Вы поражаете выбранного врага в пределах видимости энергиями Слова, нанося @RollDmg[leveld8] урона. Вы всегда невосприимчивы к гневу своих связанных Слов, как и другие сущности, владеющие подобными силами.",
                            effortCost: 1,
                            smite: true,
                            action: true,
                            combatPower: true,
                        }
                    },
                    {
                        name: 'Корона Ярости', type: 'divineMiracle',
                        img: 'icons/svg/explosion.svg',
                        system: {
                            description: "Вы обрушиваете поток энергии своего Слова на группу врагов, задевая всех в радиусе 30 футов от точки в пределах вашей видимости. Каждая жертва получает @RollDmg[halfLeveld8] урона. Ярость может избирательно щадить союзников в области, но тогда жертвы получают подходящий спасбросок, чтобы противостоять эффекту. Вы всегда невосприимчивы к яростям своих связанных Слов, как и другие сущности, владеющие подобными силами.",
                            effortCost: 1,
                            smite: true,
                            action: true,
                            combatPower: true,
                        }
                    },
                ]
            });
        }
    }

    /**
     * Belt-and-suspenders floor: whatever path an update to current HP/HD comes
     * through (actor sheet input, the default Token HUD damage control, or our
     * own applyDamage/applyHDDamage), never let it persist below 0.
     */
    async _preUpdate(changed, options, user) {
        // Only a GM may hand-edit the remaining Divine Fury uses. The legitimate spend
        // from activateDivineFury passes {godboundFuryUse:true} and is let through, so a
        // player can still activate their own rage - they just can't refill the counter.
        // `changed` may carry either a flat dotted key or a nested object, so check both.
        const FURY_KEY = "system.divineFury.remaining";
        if (!game.user.isGM && !options?.godboundFuryUse
            && ((FURY_KEY in changed) || foundry.utils.hasProperty(changed, FURY_KEY))) {
            delete changed[FURY_KEY];
            if (changed.system?.divineFury) delete changed.system.divineFury.remaining;
            ui.notifications?.warn("Изменять запас Божественной ярости может только Ведущий.");
        }

        // Clamp current HP into [0, max]. max is derived (computed.hp.max), so a
        // stray sheet edit can't push current above the character's real maximum.
        const hpCurrent = foundry.utils.getProperty(changed, "system.hp.current");
        if (typeof hpCurrent === "number") {
            const hpMax = this.system.computed?.hp?.max;
            let v = Math.max(hpCurrent, 0);
            if (typeof hpMax === "number" && v > hpMax) v = hpMax;
            if (v !== hpCurrent) foundry.utils.setProperty(changed, "system.hp.current", v);
        }
        // Clamp current HD into [0, max]. If the same update also edits hd.max,
        // clamp against the incoming max, not the stale one.
        const hdCurrent = foundry.utils.getProperty(changed, "system.hd.current");
        if (typeof hdCurrent === "number") {
            const newHdMax = foundry.utils.getProperty(changed, "system.hd.max");
            const hdMax = typeof newHdMax === "number" ? newHdMax : this.system?.hd?.max;
            let v = Math.max(hdCurrent, 0);
            if (typeof hdMax === "number" && hdMax > 0 && v > hdMax) v = hdMax;
            if (v !== hdCurrent) foundry.utils.setProperty(changed, "system.hd.current", v);
        }
        return super._preUpdate(changed, options, user);
    }

    /**
     * The HP token bar points at the derived path "computed.hp.bar", so the
     * default bar-editing logic would write to computed.hp.bar.value - a value
     * rebuilt every prepareData and thus never persisted. Redirect edits to the
     * real stored field: hp.current for PCs, hd.current for everything else.
     * Clamped to [0, max] so it can't go negative or above maximum.
     */
    async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
        if (attribute === "computed.hp.bar") {
            if (this.type === "pc") {
                const max = this.system.computed?.hp?.max ?? Infinity;
                let current = isDelta ? this.system.hp.current + value : value;
                current = Math.min(Math.max(current, 0), max);
                return this.update({"system.hp.current": current});
            }
            if (this.type === "npc") {
                const max = this.system.hd.max;
                let current = isDelta ? this.system.hd.current + value : value;
                current = Math.min(Math.max(current, 0), max);
                return this.update({"system.hd.current": current});
            }
            // Other types (e.g. faction) have no hd field - don't invent one.
        }
        return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
    }

    prepareData() {
        super.prepareData();

        // Make separate methods for each Actor type (character, npc, etc.) to keep
        // things organized.
        if (this.type === 'pc') this._preparePcData();

        if (this.type === 'npc') this._prepareNpcData();

        if (this.type === 'faction') this._prepareFactionData();

        if (this.type === 'pc' || this.type === 'npc') this._preparePassives();
    }

    // Standalone Faction actor (own type/token). Mirrors the faction bookkeeping the
    // NPC sheet does: tally Dominion committed to Projects and expose free Dominion.
    _prepareFactionData() {
        const data = this.system;
        data.computed = {};
        let dominionSpent = 0;
        if (this.items) {
            this.items.forEach(i => {
                if (i.type === 'project') dominionSpent += (i.system.committedDominion || 0);
            });
        }
        data.computed.faction = {
            dominion: {
                spent: dominionSpent,
                free: (data.faction?.dominion?.total || 0) - dominionSpent,
            },
        };
    }

    // Aggregate every owned item's system.passive (boundWord, divineGift, artifactPower)
    // into a single always-on summary: a flat damage reduction plus sets of damage types
    // the actor is immune/resistant/vulnerable to. Used by the "Пассивки" tab and by
    // applyDamage/applyHDDamage to auto-mitigate incoming damage.
    _preparePassives() {
        const data = this.system;
        const list = [];
        const immune = new Set();
        const resistant = new Set();
        const vulnerable = new Set();
        let reduction = 0;

        const splitTypes = (s) => (s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        if (this.items) {
            this.items.forEach(i => {
                const p = i.system?.passive;
                if (!p) return;
                const itemImmune = splitTypes(p.immune);
                const itemResistant = splitTypes(p.resistant);
                const itemVulnerable = splitTypes(p.vulnerable);
                const itemReduction = Number(p.reduction) || 0;
                if (!itemReduction && !itemImmune.length && !itemResistant.length && !itemVulnerable.length) return;

                reduction += itemReduction;
                itemImmune.forEach(t => immune.add(t));
                itemResistant.forEach(t => resistant.add(t));
                itemVulnerable.forEach(t => vulnerable.add(t));
                list.push({
                    name: i.name,
                    reduction: itemReduction,
                    immune: itemImmune,
                    resistant: itemResistant,
                    vulnerable: itemVulnerable
                });
            });
        }

        data.computed.passives = {
            reduction,
            immune: Array.from(immune),
            resistant: Array.from(resistant),
            vulnerable: Array.from(vulnerable),
            list
        };
    }

    // Apply an actor's passives to a raw incoming damage amount for a given damage type.
    // Immunity zeroes it outright (unless the source is magical and the type is the
    // generic "physical"/mundane-weapon immunity, which magic bypasses); resistance halves
    // it; vulnerability doubles it; the flat reduction is subtracted last.
    _mitigateDamage(amount, damageType, isMagic) {
        const passives = this.system.computed?.passives;
        if (!passives || !damageType) return amount;
        const type = damageType.toLowerCase();
        if (type === 'physical' && isMagic) return amount;
        if (passives.immune.includes(type)) return 0;
        if (passives.vulnerable.includes(type)) amount *= 2;
        if (passives.resistant.includes(type)) amount = Math.floor(amount / 2);
        if (amount > 0) amount = Math.max(0, amount - passives.reduction);
        return amount;
    }

    _preparePcData() {
        const data = this.system;

        // Make a new Object that holds computed data and keeps it separate from anything else
        data.computed = {};

        data.computed.attributes = {};
        for (let k of Object.keys(data.attributes)) {
            const computedAtt = {};
            const srcAtt = data.attributes[k];
            const score = srcAtt.score;
            if (score <= 3) {
                computedAtt.mod = -3;
            } else if (score <= 5) {
                computedAtt.mod = -2;
            } else if (score <= 8) {
                computedAtt.mod = -1;
            } else if (score >= 19) {
                computedAtt.mod = 4;
            } else if (score >= 18) {
                computedAtt.mod = 3;
            } else if (score >= 16) {
                computedAtt.mod = 2;
            } else if (score >= 13) {
                computedAtt.mod = 1;
            } else {
                computedAtt.mod = 0;
            }
            computedAtt.check = 21 - score;
            data.computed.attributes[k] = computedAtt;
        }

        data.computed.saves = {};
        this._prepareSave(data.level, data.saves, data.computed.saves, data.computed.attributes, 'hardiness', 'str', 'con');
        this._prepareSave(data.level, data.saves, data.computed.saves, data.computed.attributes, 'evasion', 'dex', 'int');
        this._prepareSave(data.level, data.saves, data.computed.saves, data.computed.attributes, 'spirit', 'wis', 'cha');

        data.computed.armor = {};
        switch (data.armor.type) {
            case "light":
                data.computed.armor.baseAc = 7;
                break;
            case "medium":
                data.computed.armor.baseAc = 5;
                break;
            case "heavy":
            case "divine":
                data.computed.armor.baseAc = 3;
                break;
            default:
                data.computed.armor.baseAc = 9;
        }
        let ac = data.computed.armor.baseAc;
        if (data.armor.shield) {
            ac -= 1;
        }
        ac -= data.armor.bonus;
        // Guard the armour attribute lookup: a migrated/hand-edited actor whose
        // armor.attribute is missing or not one of the six keys would otherwise
        // read `.mod` off undefined and throw, aborting the whole sheet render.
        ac -= (data.computed.attributes[data.armor.attribute]?.mod
            ?? data.computed.attributes.dex?.mod ?? 0);
        data.computed.armor.ac = ac;
        // Shaped as a {value, max} pair so Foundry's token attribute-bar picker
        // (Token Config > Resources, and the default Token HUD bars) can find
        // and use Armor - a bare number isn't recognized as a trackable bar.
        data.computed.armor.bar = { value: ac, max: data.computed.armor.baseAc };
        if (data.armor.penalizeHardiness) {
            data.computed.saves.hardiness.penalty = 4;
            data.computed.saves.hardiness.save += 4;
        }
        if (data.armor.penalizeEvasion) {
            data.computed.saves.evasion.penalty = 4;
            data.computed.saves.evasion.save += 4;
        }
        if (data.armor.penalizeSpirit) {
            data.computed.saves.spirit.penalty = 4;
            data.computed.saves.spirit.save += 4;
        }

        data.computed.effort = {};
        data.computed.effort.available =
            data.effort.total - (
                data.effort.atWill +
                data.effort.scene +
                data.effort.day +
                (data.effort.healing || 0)
            )
        ;
        data.computed.effort.spent = data.effort.total - data.computed.effort.available;
        // Shaped for the token resource bar: show currently-free Effort, not the max pool.
        data.computed.effort.bar = { value: data.computed.effort.available, max: data.effort.total };

        data.computed.influence = {};
        data.computed.influence.spent = data.influence.contributed;
        data.computed.dominion = {};
        data.computed.dominion.spent = data.dominion.contributed;
        data.computed.dominion.income = data.dominion.otherIncome;
        data.computed.giftPoints = {};
        data.computed.giftPoints.spent = data.giftPoints.contributed;
        if(this.items) {
            this.items.forEach(i => {
                if(i.type === 'project') {
                    data.computed.dominion.spent += i.system.committedDominion;
                    data.computed.influence.spent += i.system.committedInfluence;
                } else if(i.type === 'artifact') {
                    data.computed.dominion.spent += i.system.committedDominion;
                } else if(i.type === 'cult') {
                    data.computed.dominion.income += i.system.income;
                } else if(i.type === 'boundWord') {
                    if(!i.system.free) data.computed.giftPoints.spent += 3;
                } else if(i.type === 'divineGift') {
                    if(!i.system.free) data.computed.giftPoints.spent += i.system.greater ? 2 : 1;
                }
            });
        }
        data.computed.influence.available = data.influence.total - data.computed.influence.spent;
        data.computed.dominion.available = data.dominion.total - data.computed.dominion.spent;
        data.computed.giftPoints.available = data.giftPoints.total - data.computed.giftPoints.spent;

        data.computed.hp = {};
        data.computed.hp.max = 8 + data.computed.attributes.con.mod + (
            (data.level - 1) * (4 + Math.ceil(data.computed.attributes.con.mod / 2))
        );
        // Floor current HP at 0 for display (matches the persisted-value floor
        // enforced in applyDamage/_preUpdate) so a stale negative value on an
        // existing actor doesn't show/report as negative either.
        if (data.hp.current < 0) data.hp.current = 0;
        // Shaped as a {value, max} pair so the default Token HUD bar (and Token
        // Config's attribute picker) render HP as a proper bar with a floor/ceiling
        // instead of a bare, unclamped number.
        data.computed.hp.bar = { value: data.hp.current, max: data.computed.hp.max };

        // Divine Fury ("Божественная ярость"): usable at 0 HP; it does NOT return on
        // rest, only when the hero gains a NEW level. The remaining uses are stored as
        // a plain counter so the table can see how many are left; the counter is
        // decremented by activateDivineFury and refilled on level-up (see gb.js). Only
        // a GM may edit it by hand - enforced in _preUpdate.
        const furyUsedAt = data.divineFury?.usedAtLevel || 0;
        const furyLeft = Number(data.divineFury?.remaining ?? 1) || 0;
        data.computed.divineFury = {
            remaining: furyLeft,
            available: furyLeft > 0,
            usedAtLevel: furyUsedAt,
        };

        this._prepareArtifacts(data);

        // Group Art items by their category for the Arts tab. Each Art entry
        // can have several Art Levels nested beneath it.
        this._prepareArts(data);
    }

    // Group Artifacts with the Artifact Powers that belong to them. Shared by
    // PC and NPC: imported NPCs carry artifacts too, and without this their
    // Artifacts tab would have nothing to render.
    _prepareArtifacts(data) {
        let artifactIdx = {};
        data.computed.artifacts = [];
        if(this.items && this.items.size > 0) {
            this.items.forEach(i => {
                let entry = null;
                if(i.type === 'artifact') {
                    entry = artifactIdx[i.id];
                    if(!entry) {
                        entry = {
                            item: null,
                            artifactPowers: []
                        };
                        artifactIdx[i.id] = entry;
                    }
                    entry.item = i;
                    data.computed.artifacts.push(entry);
                } else if(i.type === 'artifactPower') {
                    entry = artifactIdx[i.system.artifactId];
                    if(!entry) {
                        entry = {
                            item: null,
                            artifactPowers: []
                        };
                        artifactIdx[i.system.artifactId] = entry;
                    }
                    entry.artifactPowers.push(i);
                }
            });
        }
        data.computed.artifactIdx = artifactIdx;
    }

    // Group Art items by their category for the Arts (Theurgy) tab. Each Art
    // entry can have several Art Levels nested beneath it. Shared by PC and NPC
    // so both actor types get the same theurgy tab.
    _prepareArts(data) {
        data.computed.arts = {};
        let artIdx = {};
        if(this.items) {
            this.items.forEach(i => {
                if(i.type === 'art') {
                    let cat = i.system.category || 'martialStrife';
                    if(!data.computed.arts[cat]) data.computed.arts[cat] = [];
                    let entry = artIdx[i.id];
                    if(!entry) {
                        entry = {item: i, levels: []};
                        artIdx[i.id] = entry;
                    } else {
                        entry.item = i;
                    }
                    data.computed.arts[cat].push(entry);
                }
            });
            this.items.forEach(i => {
                if(i.type === 'artLevel') {
                    let entry = artIdx[i.system.artId];
                    if(entry) entry.levels.push(i);
                }
            });
        }
        data.computed.artIdx = artIdx;
    }

    _prepareSave(level, src, dest, atts, name, att1, att2) {
        dest[name] = {};
        dest[name].base = 15 - Math.max(
            atts[att1].mod,
            atts[att2].mod
        ) - Math.max(level - 1, 0);
        dest[name].penalty = 0;
        dest[name].save = dest[name].base - src[name].bonus;
    }

    _prepareNpcData() {
        const data = this.system;

        // Make a new Object that holds computed data and keeps it separate from anything else
        data.computed = {};

        // Whether this NPC is a Mob (Толпа). Drives the extra "per-member HP" line
        // and the mob-only auto-hit gift / token sizing.
        data.computed.isMob = isMobCardinality(data.cardinality);
        // Remaining members of the mob = total current HD (КЗ) ÷ one member's HD
        // (КЗ одного), rounded up so a partially-wounded member still counts as
        // present. `mobTotal` is the same at full HD, for an "X / Y" readout.
        if (data.computed.isMob) {
            const perMember = Number(data.mobHd?.max) || 0;
            data.computed.mobRemaining = perMember > 0 ? Math.ceil((Number(data.hd?.current) || 0) / perMember) : 0;
            data.computed.mobTotal = perMember > 0 ? Math.ceil((Number(data.hd?.max) || 0) / perMember) : 0;
        }

        data.computed.effort = {};
        data.computed.effort.available =
            data.effort.total - (
                data.effort.atWill +
                data.effort.scene +
                data.effort.day +
                (data.effort.healing || 0)
            )
        ;
        data.computed.effort.spent = data.effort.total - data.computed.effort.available;
        data.computed.effort.bar = { value: data.computed.effort.available, max: data.effort.total };

        // Floor current HD at 0, same as PC HP, and expose it under the same
        // "computed.hp.bar" path as PCs so a single Token attribute-bar config
        // works for both actor types.
        if (data.hd.current < 0) data.hd.current = 0;
        data.computed.hp = { bar: { value: data.hd.current, max: data.hd.max } };

        // Shaped as a {value, max} pair so Armor can be picked as a Token
        // resource bar, same as for PCs.
        data.computed.armor = { bar: { value: data.ac, max: data.ac } };

        if(data.numActions > data.numAttacks) {
            data.computed.extraActions = data.numActions - data.numAttacks;
        }

        data.computed.saves = {};
        data.computed.saves.npc = {
            save: data.save
        };

        data.computed.faction = {};
        let dominionSpent = 0;
        if(this.items) {
            this.items.forEach(i => {
                if(i.type === 'project') {
                    dominionSpent += (i.system.committedDominion || 0);
                }
            });
        }
        data.computed.faction.dominion = {
            spent: dominionSpent,
            free: data.faction.dominion.total - dominionSpent
        };

        // Group Art items (theurgy / low magic) so NPCs get the same Arts tab as PCs.
        this._prepareArts(data);
        // Same for Artifacts: imported NPCs own them just as PCs do.
        this._prepareArtifacts(data);
    }

    _extractBonus(roll) {
        let runningTotal = 0;
        for(let i = 0; i < roll.dice.length; i++) {
            for(let j = 0; j < roll.dice[i].results.length; j++) {
                runningTotal += roll.dice[i].results[j].result;
            }
        }
        return roll.total - runningTotal;
    }

    _sortedDiceResults(roll) {
        let results = [];
        for(let i = 0; i < roll.dice.length; i++) {
            for(let j = 0; j < roll.dice[i].results.length; j++) {
                results.push(roll.dice[i].results[j].result);
            }
        }
        // Sort numerically-descending. A bare .sort() sorts lexicographically,
        // which misorders any face value >= 10 (d10/d12/d20) and would then add
        // the damage bonus to the wrong die in _toNormalDamage.
        results.sort((a, b) => b - a);
        return results;
    }

    _toNormalDamage(roll) {
        let bonus = this._extractBonus(roll);
        let results = this._sortedDiceResults(roll);
        // Плоский урон без единого кубика (например «урон, равный уровню») уже задан
        // в очках повреждений — таблицу перевода к нему применять не к чему. Раньше
        // здесь получалось `undefined + бонус` = NaN, и NaN проваливался в последнюю
        // ветку таблицы, из-за чего ЛЮБОЙ плоский урон превращался в ровно 4.
        if (results.length === 0) return roll.total;
        results[0] = results[0] + bonus;
        let runningTotal = 0;
        for(let i = 0; i < results.length; i++) {
            let roll = results[i];
            if(roll < 2) {
            } else if(roll < 6) {
                runningTotal += 1;
            } else if(roll < 10) {
                runningTotal += 2;
            } else {
                runningTotal += 4;
            }
        }
        return runningTotal;
    }

    // Toggle a barely-visible AoE zone template on the canvas for a power
    // (gift / art / invocation) whose description defines an area in feet.
    // First click spawns the zone centered on the actor's token (drag it to a
    // point afterwards if the effect is targeted); second click removes it.
    // The template is an ordinary MeasuredTemplate, so it can also be deleted
    // from the template layer like any other.
    async toggleAoeZone(item) {
        const cfg = item?.system?.aoe;
        const baseRadius = Number(cfg?.radius) || 0;
        if (!cfg?.enabled || baseRadius <= 0) {
            ui.notifications.warn(`У «${item?.name ?? '?'}» не заполнена зона (поле «Зона (футы)» на листе).`);
            return;
        }
        if (!canvas?.scene) {
            ui.notifications.warn('Нет активной сцены для размещения зоны.');
            return;
        }
        const existing = canvas.scene.templates.filter(t =>
            t.flags?.godbound?.zoneItemId === item.id &&
            t.flags?.godbound?.zoneActorId === this.id);
        if (existing.length) {
            await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', existing.map(t => t.id));
            return;
        }
        // «на уровень» — множим на уровень персонажа (у НИП — на макс. КЗ).
        const level = Number(this.system.level) || Number(this.system.hd?.max) || 1;
        const radius = baseRadius * (cfg.perLevel ? level : 1);
        const token = this.getActiveTokens()[0];
        const center = token
            ? token.center
            : {x: canvas.stage.pivot.x, y: canvas.stage.pivot.y};
        const shape = cfg.shape || 'circle';
        const data = {
            t: shape,
            x: center.x,
            y: center.y,
            distance: radius,
            direction: 0,
            // Едва заметная серая заливка/граница, чтобы зона не мешала игре.
            fillColor: '#9a9a9a',
            borderColor: '#8a8a8a',
            flags: {godbound: {zoneItemId: item.id, zoneActorId: this.id, zoneName: item.name}}
        };
        if (shape === 'cone') data.angle = 53.13;
        if (shape === 'ray') data.width = Number(cfg.width) || 5;
        if (shape === 'rect') {
            // rect-шаблон задаётся диагональю: квадрат со стороной radius.
            data.distance = Math.hypot(radius, radius);
            data.direction = 45;
        }
        try {
            await this._placeZoneInteractive(data);
        } catch (e) {
            // Фолбэк: без интерактивного размещения просто ставим на токен.
            console.warn('godbound | интерактивное размещение зоны недоступно, ставлю на токен', e);
            await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [data]);
        }
    }

    // Ghost-preview placement: the template follows the cursor on the template
    // layer; left click places it there, right click cancels.
    async _placeZoneInteractive(data) {
        const doc = new CONFIG.MeasuredTemplate.documentClass(data, {parent: canvas.scene});
        const template = new CONFIG.MeasuredTemplate.objectClass(doc);
        const initialLayer = canvas.activeLayer;
        await template.draw();
        canvas.templates.activate();
        canvas.templates.preview.addChild(template);

        return new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                canvas.stage.off('pointermove', onMove);
                canvas.stage.off('pointerdown', onConfirm);
                canvas.app.view.oncontextmenu = null;
                template.destroy();
                initialLayer?.activate();
            };
            const localPos = ev => ev.getLocalPosition
                ? ev.getLocalPosition(canvas.templates)
                : ev.data.getLocalPosition(canvas.templates);
            const onMove = ev => {
                ev.stopPropagation();
                const pos = localPos(ev);
                doc.updateSource({x: pos.x, y: pos.y});
                template.refresh();
            };
            const onConfirm = async ev => {
                if (ev.button !== 0) return;
                const pos = localPos(ev);
                finish();
                await canvas.scene.createEmbeddedDocuments('MeasuredTemplate',
                    [foundry.utils.mergeObject(data, {x: pos.x, y: pos.y})]);
                resolve(true);
            };
            canvas.stage.on('pointermove', onMove);
            canvas.stage.on('pointerdown', onConfirm);
            canvas.app.view.oncontextmenu = () => { finish(); resolve(false); };
        });
    }

    // Create the Attack item described inside a Divine Gift (e.g. «Рука-коса»)
    // on this actor. Works on unlinked token actors too — the attack lands on
    // the token's own copy. Skips creation if an attack with the same name is
    // already present, so the button can be pressed safely any number of times.
    async addGiftAttack(gift) {
        const cfg = gift?.system?.attack;
        if (!cfg?.enabled) {
            ui.notifications.warn(`У дара «${gift?.name ?? '?'}» не заполнена атака (включите «Дар даёт атаку» на листе дара).`);
            return null;
        }
        const name = (cfg.name || '').trim() || gift.name;
        const existing = this.items.find(i => i.type === 'attack' && i.name === name);
        if (existing) {
            ui.notifications.info(`Атака «${name}» уже есть у ${this.name} — повторно не добавлена.`);
            return existing;
        }
        const [created] = await this.createEmbeddedDocuments('Item', [{
            name,
            type: 'attack',
            img: gift.img,
            system: {
                attr: cfg.attr || 'str',
                hitBonus: Number(cfg.hitBonus) || 0,
                range: cfg.range || '',
                area: cfg.area || '',
                damageRoll: cfg.damageRoll || '',
                damageBonus: Number(cfg.damageBonus) || 0,
                magic: !!cfg.magic,
                damageType: cfg.damageType || 'physical',
                guaranteedMinDamage: Number(cfg.guaranteedMinDamage) || 0,
                autoHit: !!cfg.autoHit,
                maxDamage: !!cfg.maxDamage,
                areaAttack: !!cfg.areaAttack,
                notes: `Атака дара «${gift.name}»`
            }
        }]);
        ui.notifications.info(`Атака «${name}» добавлена ${this.name}.`);
        return created;
    }

    async rollAttack(item) {
        let template = 'systems/godbound/templates/chat/attack-roll-result.html';
        let chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
        };
        let attrBonus = 0;
        if(this.system.computed.attributes && item.system.attr) {
            attrBonus = this.system.computed.attributes[item.system.attr]?.mod || 0;
        }
        let templateData = {
            title: `Атака`,
            data: {},
        };
        // Godbound armor is a descending target number (lower AC = harder to
        // hit), so build the roll to directly produce the hit number: the
        // dice and every bonus/upgrade are subtracted from 20 up front,
        // rather than rolling a normal d20+bonuses total and subtracting
        // afterward. hitNumber <= target AC means a hit (e.g. AC 1 is hit by
        // anything showing 1 or less).
        let roll = new Roll('20 - 1d20 - @attrBonus - @levelBonus - @toHitBonus - @itemBonus', {
            attrBonus: attrBonus,
            levelBonus: this.system.level || 0,
            toHitBonus: this.system.toHitBonus || 0,
            itemBonus: item.system.hitBonus
        });
        await roll.evaluate();
        templateData.roll = await roll.render();
        let hitNumber = roll.total;

        // Area attacks (e.g. "Дождь Молний") hit every currently-targeted token at once
        // with the same roll, instead of only the first one selected.
        const isAreaAttack = !!item.system.areaAttack;
        const tokens = Array.from(game.user.targets);
        const targetTokens = isAreaAttack ? tokens : tokens.slice(0, 1);

        let targetAc = null;
        if (targetTokens.length > 0) {
            let firstActor = targetTokens[0].actor;
            if (firstActor) {
                // Only pc (computed.armor.ac) and npc (system.ac) actually have an
                // Armor Class. Any other type (e.g. faction) has none, so leave
                // targetAc null rather than reading an undefined field - otherwise
                // `hitNumber <= undefined` renders a bogus miss on every roll.
                targetAc = firstActor.type === 'pc' ? firstActor.system.computed?.armor?.ac
                    : firstActor.type === 'npc' ? firstActor.system.ac
                    : null;
            }
            templateData.data.targetToken = {
                name: targetTokens[0].document?.name ?? targetTokens[0].name,
                img: targetTokens[0].document?.texture?.src ?? targetTokens[0].actor?.img
            };
        }
        let isCheckedForSuccess = typeof targetAc === 'number';
        // "Auto-hit" gifts (e.g. "Стрела Неодолимого Мастерства", "Икона гнები") bypass the
        // armor check entirely for this attack while active.
        // "Кровь как вода" forces auto-hit: the mob's own attacks auto-hit, and any
        // attack against a mob with the status active auto-hits too.
        const attackerBloodWater = this.statuses?.has?.('bloodwater');
        const targetBloodWater = targetTokens[0]?.actor?.statuses?.has?.('bloodwater');
        const autoHit = !!item.system.autoHit || !!attackerBloodWater || !!targetBloodWater;
        let isSuccess = autoHit || (isCheckedForSuccess && hitNumber <= targetAc);
        let isFailure = !autoHit && isCheckedForSuccess && hitNumber > targetAc;
        // Natural 20 always hits, natural 1 always misses (auto-hit gifts still auto-hit).
        const natAtk = roll.dice?.[0]?.results?.[0]?.result;
        if (!autoHit && isCheckedForSuccess) {
            if (natAtk === 20) { isSuccess = true; isFailure = false; }
            else if (natAtk === 1) { isSuccess = false; isFailure = true; }
        }
        templateData.result = {
            isSuccess,
            isFailure,
            isCheckedForSuccess: isCheckedForSuccess || autoHit,
        };
        if (templateData.result.isCheckedForSuccess) {
            templateData.result.className = templateData.result.isSuccess ? 'result-msg-success' : 'result-msg-failure';
        }

        // Roll damage alongside the attack roll instead of deferring it to a
        // separate click.
        // Кубик урона необязателен: атака может наносить плоский урон (пустое левое
        // поле + число справа). buildDamageFormula собирает оба случая, '0' — на случай
        // атаки вообще без урона, чтобы карточка не падала на пустой формуле.
        let damageBonus = attrBonus + (item.system.damageBonus || 0);
        let damageFormula = buildDamageFormula(item.system.damageRoll, damageBonus) || '0';
        let damageRoll = new Roll(damageFormula);
        // "Max-damage" gifts (e.g. "Разрушитель Бункеров") treat the damage roll as if
        // every die came up maximum, instead of actually rolling it.
        await damageRoll.evaluate(item.system.maxDamage ? {maximize: true} : undefined);
        templateData.damageRoll = await damageRoll.render();
        templateData.damageResult = {
            straightDamage: damageRoll.total,
            normalDamage: this._toNormalDamage(damageRoll),
        };
        // Some weapons (e.g. death scythes) guarantee a minimum amount of damage even on
        // a miss - the roll never fully whiffs. On a miss the target takes exactly that
        // minimum (not the rolled damage), so the card gets a dedicated button for it
        // instead of silently inflating the rolled numbers.
        const minDamage = item.system.guaranteedMinDamage || 0;
        if (minDamage > 0 && templateData.result.isFailure) {
            templateData.result.missMinDamage = minDamage;
        }
        templateData.data.damageType = item.system.damageType || 'physical';
        templateData.data.isMagic = !!item.system.magic;
        templateData.data.targetActorId = targetTokens[0]?.actor?.id ?? null;
        templateData.data.targetTokenUuid = targetTokens[0]?.document?.uuid ?? null;
        templateData.data.targets = targetTokens
            .filter(t => t.actor)
            .map(t => targetRef(t));
        templateData.data.isAreaAttack = isAreaAttack && templateData.data.targets.length > 1;
        templateData.data.actor = this;
        templateData.data.actorUuid = this.uuid;
        templateData.data.item = item;
        templateData.data.itemImg = itemChatImage(item);
        chatData.content = await renderTemplate(template, templateData);
        chatData.rolls = [roll, damageRoll];
        if (game.dice3d) {
            await game.dice3d.showForRoll(
                roll,
                game.user,
                true,
                chatData.whisper,
                chatData.blind
            );
            await game.dice3d.showForRoll(
                damageRoll,
                game.user,
                true,
                chatData.whisper,
                chatData.blind
            );
            await ChatMessage.create(chatData);
        } else {
            chatData.sound = CONFIG.sounds.dice;
            await ChatMessage.create(chatData);
        }
    }

    /**
     * Theurgy (Art level) effect roll. Each Art level can be configured to make
     * an attack roll, force a saving throw, or neither (opt-out). "attack" reuses
     * the normal attack pipeline (to-hit vs target AC + damage); "save" posts a
     * damage card whose configured saveType lets the target roll for half.
     */
    async rollArtEffect(item) {
        const type = item.system.effectType || 'none';
        if (type === 'none') {
            ui.notifications.info('У этого эффекта не задано воздействие (Атака/Спасбросок).');
            return;
        }
        // Урон может быть как броском («1к8+2»), так и плоским числом без кубика
        // (пустое поле кубика + число в бонусе) — Искусства сплошь и рядом наносят
        // фиксированный урон, и такую запись тоже нужно принимать.
        const formula = buildDamageFormula(item.system.damageRoll, item.system.damageBonus);
        if (type === 'attack') {
            if (!formula) { ui.notifications.warn('Для атаки задайте урон: формулу броска или плоское число в поле бонуса.'); return; }
            await this.rollAttack(item);
            return;
        }
        // save: the damage formula is OPTIONAL. Empty formula → a pure saving throw
        // (no damage). Formula present → a saving throw where a FAILED save applies
        // that damage (success negates it).
        const saveType = (item.system.saveType && item.system.saveType !== 'none') ? item.system.saveType : null;
        if (!saveType) { ui.notifications.warn('Выберите тип спасброска для этого эффекта.'); return; }
        await this._postTheurgySave(item, saveType, formula || null);
    }

    /**
     * Post a theurgy saving-throw card: the target rolls the given save, and (if a
     * damage formula is provided) a pre-rolled "damage on failure" block is shown for
     * the GM to apply when the save is failed. Success negates the effect.
     */
    async _postTheurgySave(item, saveType, formula) {
        const saveLabel = Label(saveType);
        const chatData = {author: game.user.id, speaker: ChatMessage.getSpeaker({actor: this})};
        let damageBlock = '';
        const rolls = [];
        let normal, straight, damageType;
        if (formula) {
            const dmgRoll = new Roll(formula);
            await dmgRoll.evaluate();
            rolls.push(dmgRoll);
            normal = this._toNormalDamage(dmgRoll);
            straight = dmgRoll.total;
            damageType = item.system.damageType || 'magic';
            damageBlock =
                `<div class="gb-subtitle">Урон при провале</div>` +
                `${await dmgRoll.render()}` +
                `<div class="gb-stats">` +
                `<div class="gb-stat"><span class="gb-stat__label">Обычный урон</span><span class="gb-stat__value">${normal}</span></div>` +
                `<div class="gb-stat"><span class="gb-stat__label">Прямой урон</span><span class="gb-stat__value">${straight}</span></div>` +
                `</div>` +
                `<div class="gb-actions">` +
                `<div class="gb-btns">` +
                `<button type="button" class="gb-btn apply-damage-btn" data-amount="${normal}" data-damage-type="${damageType}" data-is-magic="true">Обычный урон</button>` +
                `<button type="button" class="gb-btn gb-btn--danger apply-damage-btn" data-amount="${straight}" data-damage-type="${damageType}" data-is-magic="true">Прямой урон</button>` +
                `</div></div>`;
        }
        const theurgyDesc = this.replaceItemDescriptionMacros(item);
        chatData.content =
            `<div class="godbound chat-block gb-card gb-card--power">` +
            `<h2 class="gb-title"><span class="gb-title__text">${esc(item.name)}</span></h2>` +
            `<div class="gb-desc${isPlainDescription(theurgyDesc) ? ' gb-desc--pre' : ''}">${theurgyDesc}</div>` +
            `<div class="gb-note">Спасбросок цели: <b>${esc(saveLabel)}</b>` +
            (formula ? ' — успех сводит эффект на нет, провал наносит урон ниже.' : ' — успех сводит эффект на нет, провал — эффект действует.') + `</div>` +
            `<div class="gb-actions"><div class="gb-btns gb-btns--1">` +
            `<button type="button" class="gb-btn gb-btn--primary gift-save-roll-btn" data-save="${saveType}" data-gift-name="${esc(item.name)}"` +
            (formula ? ` data-dmg-normal="${normal}" data-dmg-straight="${straight}" data-damage-type="${damageType}" data-is-magic="true"` : '') +
            `><i class="fas fa-shield-halved"></i> Бросить спасбросок (${esc(saveLabel)})</button>` +
            `</div></div>` +
            damageBlock + `</div>`;
        if (rolls.length) { chatData.rolls = rolls; chatData.sound = CONFIG.sounds.dice; }
        await ChatMessage.create(chatData);
    }

    async rollDamage(source, formula) {
        if(!formula) {
            formula = source.system?.computed?.damageFormula
                || buildDamageFormula(source.system?.damageRoll, source.system?.damageBonus);
        }
        if(!formula) {
            ui.notifications.warn(`У «${source?.name ?? '?'}» не задан урон: укажите формулу броска или плоское число в поле бонуса.`);
            return;
        }
        let template = 'systems/godbound/templates/chat/damage-roll-result.html';
        let chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
        };
        let templateData = {
            title: `Урон`,
            data: {},
        };
        let roll = new Roll(formula);
        await roll.evaluate();
        templateData.roll = await roll.render();
        templateData.result = {
            straightDamage: roll.total,
            normalDamage: this._toNormalDamage(roll),
        };
        templateData.data.actor = this;
        templateData.data.item = source;
        templateData.data.itemImg = itemChatImage(source);
        // Bake in the currently-targeted tokens plus the source power's damage
        // type / magic flag / saving throw, so the damage card can apply to each
        // target and, when the power allows a save, auto-roll it for half damage.
        const damageType = source.system?.damageType || 'physical';
        const isMagic = !!source.system?.magic
            || ['divineGift','divineMiracle','artifactPower','artLevel','boundWord'].includes(source.type);
        const saveType = (source.system?.saveType && source.system.saveType !== 'none')
            ? source.system.saveType : null;
        templateData.data.damageType = damageType;
        templateData.data.isMagic = isMagic;
        templateData.data.saveType = saveType;
        templateData.data.saveLabel = saveType ? Label(saveType) : null;
        templateData.data.targets = Array.from(game.user.targets)
            .filter(t => t.actor)
            .map(t => targetRef(t));
        chatData.content = await renderTemplate(template, templateData);
        chatData.rolls = [roll];
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
    }

    /**
     * Godbound Fray Die. Once per round a Godbound may auto-hit a SINGLE lesser
     * foe (an NPC whose HD is below the Godbound's level) - no attack roll, but
     * the damage is applied by hand from the chat card exactly like a normal
     * attack. Only the first currently-targeted token is used.
     */
    async rollFray() {
        const frayItem = this.items.find(i =>
            i.type === 'autoHitAttack' && (i.system.fray || i.name === 'Кость Схватки'));
        if (!frayItem) {
            ui.notifications.warn('Не найдена «Кость Схватки» (авто-атака). Добавьте её на вкладке «Бой».');
            return;
        }
        const token = Array.from(game.user.targets)[0];
        if (!token) {
            ui.notifications.warn('Выделите одну цель (Target) для Кости Схватки.');
            return;
        }
        const target = token.actor;
        if (!target || target.type !== 'npc') {
            ui.notifications.warn('Костью Схватки можно бить только НИП.');
            return;
        }
        const level = this.system.level || 0;
        // "Меньший противник" is judged by CURRENT HD (КЗ), not maximum — a foe
        // worn down to a low current HD counts as lesser and can be finished off.
        const hd = target.system.hd?.current ?? 0;
        if (hd > level) {
            ui.notifications.warn(`Костью Схватки можно бить только меньшего противника — текущее КЗ не выше вашего уровня (КЗ ${hd} > уровень ${level}).`);
            return;
        }

        const formula = frayItem.system.computed?.damageFormula || frayItem.system.damageRoll || '1d8';
        const roll = new Roll(formula);
        await roll.evaluate();

        const template = 'systems/godbound/templates/chat/damage-roll-result.html';
        const chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
            rolls: [roll],
        };
        const templateData = {
            title: 'Кость Схватки',
            roll: await roll.render(),
            result: {straightDamage: roll.total, normalDamage: this._toNormalDamage(roll)},
            data: {
                actor: this,
                item: frayItem,
                itemImg: itemChatImage(frayItem),
                damageType: frayItem.system.damageType || 'physical',
                isMagic: !!frayItem.system.magic,
                saveType: null,
                saveLabel: null,
                targets: [targetRef(token)],
            },
        };
        chatData.content = await renderTemplate(template, templateData);
        if (game.dice3d) {
            await game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind);
        } else {
            chatData.sound = CONFIG.sounds.dice;
        }
        await ChatMessage.create(chatData);
    }

    async rollMorale() {
        let template = 'systems/godbound/templates/chat/morale-roll-result.html';
        let chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
        };
        let templateData = {
            title: `Мораль`,
            data: {},
        };
        let formula = '2d6';
        let roll = new Roll(formula);
        await roll.evaluate();
        let target = this.system.morale;
        let result = {
            isSuccess: roll.total <= target,
            isFailure: roll.total > target,
            target: target,
        }
        result.className = result.isSuccess ? 'result-msg-success' : 'result-msg-failure';
        templateData.roll = await roll.render();
        templateData.result = result;
        templateData.data.actor = this;

        chatData.content = await renderTemplate(template, templateData);
        chatData.rolls = [roll];
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
    }

    /**
     * Roll a d6 against this NPC's tactics table (system.tactics[0..5]) and show the
     * result in a private window to whoever clicked (normally the GM). Deliberately
     * NOT posted to chat: the tactic is Ведущий-only information and posting one card
     * per roll just clutters the log. Called from the sheet with `this.actor`, so it
     * works for both world actors and unlinked token actors.
     */
    async rollTactics() {
        const tactics = this.system.tactics || [];
        const roll = new Roll('1d6');
        await roll.evaluate();
        const idx = roll.total - 1;
        const text = (tactics[idx] && String(tactics[idx]).trim()) || '(не заполнено)';
        new foundry.appv1.api.Dialog({
            title: `Тактика — ${this.name}`,
            content:
                `<div class="godbound chat-block gb-card gb-card--tactics">` +
                `<h2 class="gb-title"><span class="gb-title__text">Тактика</span></h2>` +
                `<div class="gb-actor">` +
                `<div class="gb-portraits"><img class="gb-portrait" src="${esc(this.img)}" alt=""></div>` +
                `<div class="gb-names"><span class="gb-name" title="${esc(this.name)}">${esc(this.name)}</span>` +
                `<span class="gb-sub">Бросок d6 — видно только вам</span></div></div>` +
                `<div class="gb-stats gb-stats--1">` +
                `<div class="gb-stat"><span class="gb-stat__label">Результат</span>` +
                `<span class="gb-stat__value">${roll.total}</span></div></div>` +
                `<div class="gb-desc">${esc(text)}</div></div>`,
            buttons: {
                reroll: {
                    icon: '<i class="fas fa-dice-d6"></i>', label: 'Перебросить',
                    callback: () => this.rollTactics()
                },
                close: {icon: '<i class="fas fa-times"></i>', label: 'Закрыть'},
            },
            default: 'close',
        }).render(true);
    }

    async demonstrateDoc(item) {
        let pdfCode = item.system.pdfCode;
        let pdfPage = item.system.pdfPage;
        if(ui && ui.PDFoundry && pdfCode && pdfPage) {
            ui.PDFoundry.openPDFByCode(pdfCode, {page: pdfPage});
        }
    }

    async demonstratePower(item, effortCommitment) {
        let template = 'systems/godbound/templates/chat/power-result.html';
        let chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
        };
        let templateData = {
            title: TypeNames(item.type),
            data: {},
        };
        templateData.data.actor = this;
        templateData.data.item = item;
        templateData.data.itemImg = itemChatImage(item);
        if(effortCommitment) {
            templateData.data.effort = {[effortCommitment]: true};
        }
        if(!effortCommitment) {
            templateData.data.actions = {};
            if(item.system.day) templateData.data.actions.day = true;
            if(item.system.scene) templateData.data.actions.scene = true;
            if(item.system.atWill) templateData.data.actions.atWill = true;
            if(item.system.day) templateData.data.actions.day = true;
        }
        templateData.data.description = this.replaceItemDescriptionMacros(item);
        // Описания из <textarea> держатся на переводах строк — им нужен pre-wrap;
        // текст из богатого редактора уже размечен тегами и его портит.
        templateData.data.descriptionIsPlain = isPlainDescription(templateData.data.description);
        chatData.content = await renderTemplate(template, templateData);
        ChatMessage.create(chatData);
    }

    _replaceRollDmgMacro(item, formula) {
        let replacement = formula.replace('halfLevel', Math.ceil(this.system.level / 2));
        replacement = replacement.replace('level', this.system.level);
        return `<span class="damage-formula-roll" data-formula="${replacement}" data-actor-id="${this.id}" data-damage-source="${item.id}">${replacement}</span>`;
    }

    canSpendEffort(amount) {
        if(this.system.computed.effort.available >= amount) {
            return true;
        } else {
            ui.notifications.warn("Недостаточно Усилия");
            return false;
        }
    }

    canReclaimEffort(amount, type) {
        if(this.system.effort[type] >= amount * -1) {
            return true;
        } else {
            ui.notifications.warn(`Нельзя вернуть столько Усилия (${amount}, ${type})`);
            return false;
        }
    }

    _calcActualEffortCost(item, effortCost) {
        if(effortCost) return effortCost;
        if(['divineMiracle', 'artifactPower', 'art', 'artLevel'].includes(item.type)) {
            // Respect the power's configured cost (minimum 1). Was Math.min(x, 1),
            // which silently capped every cost at 1 so effortCost > 1 was free.
            return Math.max(item.system.effortCost || 1, 1);
        }
        return 1;
    }

    _determineEffortTarget(item) {
        if(item.type !== 'artifactPower') return this;
        return this.items.get(item.system.artifactId);
    }

    async commitEffortForDay(item, effortCost) {
        // Artifacts are always bound with permanent at-will Effort, never a
        // day commitment - route any "bind" request through the at-will path.
        if(item.type === 'artifact') {
            return this.commitEffortAtWill(item);
        }
        effortCost = this._calcActualEffortCost(item, effortCost);
        let target = this._determineEffortTarget(item);
        if (target.canSpendEffort(effortCost)) {
            await target.update({system: {effort: {day: target.system.effort.day + effortCost}}});
            await this._recordItemEffort(item, 'day', effortCost);
            await this.demonstratePower(item, 'day');
        }
    }
    async commitEffortForScene(item, effortCost) {
        effortCost = this._calcActualEffortCost(item, effortCost);
        let target = this._determineEffortTarget(item);
        if (target.canSpendEffort(effortCost)) {
            await target.update({system: {effort: {scene: target.system.effort.scene + effortCost}}});
            await this._recordItemEffort(item, 'scene', effortCost);
            await this.demonstratePower(item, 'scene');
        }
    }

    async commitEffortAtWill(item, effortCost) {
        // Binding an artifact: the at-will Effort is committed by the bound-flag
        // coupling in GodboundItem#_preUpdate, so just flip the flag (and post to
        // chat only if the bind actually went through - it's vetoed on no Effort).
        if(item.type === 'artifact') {
            if(item.system.bound) {
                ui.notifications.warn("Артефакт уже связан");
                return;
            }
            await item.update({system: {bound: true}});
            if(item.system.bound) await this.demonstratePower(item, 'atWill');
            return;
        }
        effortCost = this._calcActualEffortCost(item, effortCost);
        let target = this._determineEffortTarget(item);
        if(target.canSpendEffort(effortCost)) {
            await target.update({system: {effort: {atWill: target.system.effort.atWill + effortCost}}});
            await this._recordItemEffort(item, 'atWill', effortCost);
            await this.demonstratePower(item, 'atWill');
        }
    }

    /**
     * Ask "how much Effort?" in a tiny numeric popup, then commit that amount via the
     * given commit function. Pre-fills the power's configured cost so a single click +
     * Enter is the common case, but the number can be bumped up (e.g. hitting several
     * targets at once). Committing again later just adds to what the power already
     * holds - _recordItemEffort accumulates - so a second use shows 2, not 1.
     *
     * @param {Item}   item    the power being activated
     * @param {string} fnName  'commitEffortAtWill' | 'commitEffortForScene' | 'commitEffortForDay' | 'demonstratePower'
     */
    async commitEffortPrompt(item, fnName) {
        // A No-Effort power just prints; nothing to size.
        if (!fnName || fnName === 'demonstratePower') return this.demonstratePower(item);
        // Binding an artifact always costs exactly one at-will point - no amount to pick.
        if (item.type === 'artifact') return this[fnName](item);

        const labels = {
            commitEffortAtWill: 'по желанию',
            commitEffortForScene: 'на сцену',
            commitEffortForDay: 'на день',
        };
        const label = labels[fnName] || '';
        const def = this._calcActualEffortCost(item);
        const content =
            `<div class="godbound gb-dialog">` +
            `<p class="gb-dialog__text">«${esc(item.name)}» — сколько Усилия приложить` +
            `${label ? ` <span style="opacity:.7;">(${label})</span>` : ''}?</p>` +
            `<input type="number" class="gb-effort-amount" value="${def}" min="1" step="1" ` +
            `style="width:100%;text-align:center;font-size:18px;font-weight:bold;">` +
            `</div>`;

        return new Promise((resolve) => {
            const commit = async (html) => {
                const root = html?.[0] ?? html;
                let amount = Math.floor(Number(root?.querySelector('.gb-effort-amount')?.value));
                if (!Number.isFinite(amount) || amount < 1) amount = 1;
                await this[fnName](item, amount);
                resolve(amount);
            };
            const dlg = new foundry.appv1.api.Dialog({
                title: 'Приложить Усилие',
                content,
                buttons: {
                    ok: {icon: '<i class="fas fa-check"></i>', label: 'Приложить', callback: commit},
                    cancel: {icon: '<i class="fas fa-times"></i>', label: 'Отмена', callback: () => resolve(0)},
                },
                default: 'ok',
                render: (html) => {
                    const root = html?.[0] ?? html;
                    const inp = root?.querySelector('.gb-effort-amount');
                    if (inp) {
                        inp.focus();
                        inp.select();
                        // Enter in the field confirms, so you never touch the mouse.
                        inp.addEventListener('keydown', async (ev) => {
                            if (ev.key === 'Enter') { ev.preventDefault(); await commit(html); dlg.close(); }
                        });
                    }
                },
            });
            dlg.render(true);
        });
    }

    /**
     * Remember how much Effort a specific power is holding, so it can be handed back
     * later without hand-editing the aggregate ± counters (which is what used to drift
     * out of sync). Words already record this themselves in useWord(); an artifact's
     * own effort block is a pool, not an investment, so it is skipped.
     */
    async _recordItemEffort(item, type, amount) {
        if (!item?.update || !amount) return;
        if (item.type === 'artifact') return;
        const cur = Number(item.system?.effort?.[type]) || 0;
        try {
            await item.update({system: {effort: {[type]: cur + amount}}});
        } catch (e) {
            console.warn('Godbound | could not record committed Effort on', item?.name, e);
        }
    }

    /** Every owned power that currently holds committed Effort, biggest first. */
    getCommittedEffortItems() {
        const rows = [];
        for (const item of this.items) {
            if (item.type === 'artifact') continue;   // its effort block is the pool side
            const e = item.system?.effort;
            if (!e) continue;
            const atWill = Number(e.atWill) || 0;
            const scene = Number(e.scene) || 0;
            const day = Number(e.day) || 0;
            const total = atWill + scene + day;
            if (total > 0) rows.push({item, atWill, scene, day, total});
        }
        return rows.sort((a, b) => b.total - a.total);
    }

    /**
     * Hand back everything one power is holding, to whichever pool it was taken from:
     * the actor, or the parent artifact in the case of an artifact power.
     */
    async releaseItemEffort(itemId) {
        const item = this.items.get(itemId);
        if (!item) { ui.notifications.warn('Предмет не найден.'); return 0; }
        const e = item.system?.effort || {};
        const held = {
            atWill: Number(e.atWill) || 0,
            scene: Number(e.scene) || 0,
            day: Number(e.day) || 0,
        };
        const total = held.atWill + held.scene + held.day;
        if (total <= 0) { ui.notifications.info(`«${item.name}»: вложенного Усилия нет.`); return 0; }
        const target = this._determineEffortTarget(item);
        if (!target) { ui.notifications.warn('Не найден источник Усилия (артефакт удалён?).'); return 0; }
        const patch = {};
        for (const type of ['atWill', 'scene', 'day']) {
            if (!held[type]) continue;
            patch[type] = Math.max(0, (Number(target.system.effort?.[type]) || 0) - held[type]);
        }
        await target.update({system: {effort: patch}});
        await item.update({system: {effort: {atWill: 0, scene: 0, day: 0}}});
        ui.notifications.info(`Возвращено Усилие: ${total} — «${item.name}».`);
        return total;
    }

    /** Show where Effort is currently invested, and hand it back in one click. */
    async openEffortReleaseDialog() {
        const rows = this.getCommittedEffortItems();
        const num = (n) => n ? String(n) : '—';
        const content = rows.length
            ? `<div class="godbound gb-dialog">` +
              `<table style="width:100%;font-size:13px;">` +
              `<thead><tr><th style="text-align:left;">Куда вложено</th>` +
              `<th title="По желанию">Жел.</th><th>Сцена</th><th>День</th><th>Всего</th><th></th></tr></thead><tbody>` +
              rows.map(r =>
                  `<tr>` +
                  `<td style="text-align:left;">${esc(r.item.name)}` +
                  `<span style="opacity:.6;"> — ${esc(TypeNames(r.item.type) || r.item.type)}</span></td>` +
                  `<td style="text-align:center;">${num(r.atWill)}</td>` +
                  `<td style="text-align:center;">${num(r.scene)}</td>` +
                  `<td style="text-align:center;">${num(r.day)}</td>` +
                  `<td style="text-align:center;"><b>${r.total}</b></td>` +
                  `<td style="text-align:center;"><a class="gb-effort-return" data-item-id="${r.item.id}" ` +
                  `title="Вернуть это Усилие"><i class="fas fa-rotate-left"></i></a></td>` +
                  `</tr>`).join('') +
              `</tbody></table></div>`
            : `<div class="godbound gb-dialog"><p class="gb-dialog__text">Сейчас Усилие никуда не вложено.</p></div>`;

        const buttons = {};
        if (rows.length) {
            buttons.all = {
                icon: '<i class="fas fa-rotate-left"></i>', label: 'Вернуть всё',
                callback: async () => {
                    for (const r of this.getCommittedEffortItems()) await this.releaseItemEffort(r.item.id);
                }
            };
        }
        buttons.close = {icon: '<i class="fas fa-times"></i>', label: 'Закрыть'};

        const dlg = new foundry.appv1.api.Dialog({
            title: `Вложенное Усилие — ${this.name}`,
            content,
            buttons,
            default: 'close',
            render: (html) => {
                const root = html[0] ?? html;
                root.querySelectorAll('.gb-effort-return').forEach(a => {
                    a.addEventListener('click', async (ev) => {
                        ev.preventDefault();
                        await this.releaseItemEffort(a.dataset.itemId);
                        await dlg.close();
                        // Reopen with the refreshed list while anything is still held.
                        if (this.getCommittedEffortItems().length) this.openEffortReleaseDialog();
                    });
                });
            },
        });
        dlg.render(true);
    }

    async autoSave() {
        let items = this.items.filter(i => i.name === 'Успех на спасброске');
        if(items.length < 1) {
            ui.notifications.error("Не найдено Чудо «Успех на спасброске»");
        } else {
            let ownedItem = this.items.get(items[0].id);
            await this.commitEffortForDay(ownedItem, ownedItem.system.effortCost);
        }
    }

    replaceItemDescriptionMacros(item) {
        let description = item.system.description || '';

        let segments = description.split(/(@.*?\[.*?])/g);
        let result = [];
        for(let i = 0; i < segments.length; i++) {
            let parsed = segments[i].match(/@(.*?)\[(.*?)]/);
            if(!parsed) {
                result.push(segments[i]);
            } else {
                let macro = segments[i];
                if(parsed[1] === 'RollDmg') {
                    result.push(this._replaceRollDmgMacro(item, parsed[2]));
                } else {
                    result.push(macro);
                }
            }
        }
        return result.join('');
    }

    hasArtifactPowersUnder(id) {
        let lookup = this.system.computed.artifactIdx[id];
        return lookup && lookup.artifactPowers.length > 0;
    }

    /**
     * Invoke a bound Word: spend one Effort of the Word's configured commitment
     * type, tally it against both the Word and the actor's overall Effort, and
     * post the Word's description to chat.
     */
    async useWord(item) {
        let type = item.system.commitType || 'day';
        if (this.canSpendEffort(1)) {
            let wordEffort = item.system.effort || {atWill: 0, scene: 0, day: 0};
            await item.update({system: {effort: {[type]: (wordEffort[type] || 0) + 1}}});
            await this.update({system: {effort: {[type]: this.system.effort[type] + 1}}});
            await this.demonstratePower(item, type);
        }
    }

    /** Post an item's description to chat without committing any Effort. */
    async showItemDescription(item) {
        await this.demonstratePower(item);
    }

    /**
     * Use a power (Gift, Miracle, Artifact Power, Art). Commits Effort according
     * to the power's activation settings and posts its description to chat.
     * If the power supports several commitment types, a chooser is shown.
     */
    async usePower(item) {
        // "Кровь как вода" isn't a normal power - using it toggles the mob's
        // auto-hit state (and its token marker) instead of committing Effort.
        if (item.name === 'Кровь как вода') {
            return this.toggleBloodWater();
        }
        let options = item.getCommitmentOptions();
        if (options.length === 0) {
            // Miracles default to a once-per-day commitment; everything else
            // with no activation flags just prints its description.
            if (item.type === 'divineMiracle') {
                await this.commitEffortPrompt(item, 'commitEffortForDay');
            } else {
                await this.demonstratePower(item);
            }
        } else if (options.length === 1) {
            await this.commitEffortPrompt(item, options[0].actorFnRef);
        } else {
            await EffortCommitmentDialog.create(this, item, {}, (choice) => {
                if (choice) {
                    this.commitEffortPrompt(item, choice);
                }
            });
        }
    }

    /**
     * "Кровь как вода" (Blood Runs Like Water) — the Mob auto-hit toggle. Turning it
     * on marks the token (like poison) and means the mob's attacks auto-hit AND every
     * attack against the mob auto-hits until the start of its next turn. The GM turns
     * it off at the start of the mob's next turn.
     */
    async toggleBloodWater() {
        const wasActive = this.statuses?.has('bloodwater');
        try { await this.toggleStatusEffect('bloodwater', {active: !wasActive}); } catch (e) { /* best-effort */ }
        const content = wasActive
            ? `<div class="godbound chat-block gb-card gb-card--info">` +
              `<h2 class="gb-title"><span class="gb-title__text">Кровь как вода</span></h2>` +
              `<div class="gb-lines"><p><strong>${esc(this.name)}</strong>: эффект больше не активен.</p></div></div>`
            : `<div class="godbound chat-block gb-card gb-card--fury">` +
              `<h2 class="gb-title"><span class="gb-title__text">Кровь как вода</span></h2>` +
              `<div class="gb-tags"><span class="gb-tag gb-tag--smite"><i class="fas fa-droplet"></i> Толпа</span></div>` +
              `<div class="gb-lines"><p><strong>${esc(this.name)}</strong>: атаки толпы <b>автоматически попадают</b>. ` +
              `Но до начала её следующего хода <b>все атаки по ней тоже автоматически попадают</b>.</p></div>` +
              `<div class="gb-note">Снимите метку в начале своего следующего хода.</div></div>`;
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor: this}),
            content,
        });
    }

    async resetScene() {
        await this.update({system: {effort: {scene: 0}}});
        if(this.items) {
            // Clear the per-item record on everything that tracks one (Words, Gifts,
            // Miracles, Arts, artifact powers, artifacts) so it stays in step with the
            // actor's counters and the "return Effort" list doesn't show stale rows.
            for(let item of this.items.contents) {
                if(item.system?.effort && ('scene' in item.system.effort)) {
                    await item.update({system: {effort: {scene: 0}}});
                }
            }
        }
    }

    /**
     * A full night's rest / new day: restore all HP (PC) or HD (NPC) to maximum,
     * clear the day and scene Effort commitments, and refresh day/scene Effort on
     * Words and artifacts. Artifact *binding* is deliberately permanent - a bound
     * artifact keeps holding its at-will Effort until it is unbound by hand, so it
     * is NOT reset here (nor is any at-will Effort).
     */
    async resetDay({announce = true} = {}) {
        // Healing Effort is committed for the day, so a night's rest hands it back too.
        const patch = {effort: {day: 0, scene: 0, healing: 0}};
        if (this.type === 'pc') {
            const max = this.system.computed?.hp?.max;
            if (typeof max === 'number') patch.hp = {current: max};
            // Divine Fury does NOT refresh on rest (only on gaining a level), but a
            // day's rest ends any lingering rage and removes its temporary Effort.
            const furyEffort = this.system.divineFury?.furyEffort || 0;
            if (furyEffort) {
                patch.effort.total = Math.max(0, (this.system.effort?.total || 0) - furyEffort);
                patch.divineFury = {furyEffort: 0};
            }
        } else if (this.type === 'npc') {
            const max = this.system.hd?.max;
            if (typeof max === 'number') patch.hd = {current: max};
        }
        await this.update({system: patch});
        if(this.items) {
            // Clear the per-item day/scene record on everything that tracks one, so it
            // stays in step with the actor's counters. At-will is deliberately left
            // alone: a bound artifact keeps holding its permanent at-will Effort.
            for(let item of this.items.contents) {
                if(item.system?.effort && ('day' in item.system.effort)) {
                    await item.update({system: {effort: {day: 0, scene: 0}}});
                }
            }
        }
        // Announce the rest to everyone so the table can see who took a new day.
        // Suppressed (announce:false) when a bulk macro rests every actor at once
        // and posts its own single summary card instead of one per actor.
        if (announce) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({actor: this}),
                content:
                    `<div class="godbound chat-block gb-card gb-card--rest">` +
                    `<h2 class="gb-title"><span class="gb-title__text">Новый день</span></h2>` +
                    `<div class="gb-actor">` +
                    `<div class="gb-portraits"><img class="gb-portrait" src="${esc(this.img)}" alt=""></div>` +
                    `<div class="gb-names"><span class="gb-name" title="${esc(this.name)}">${esc(this.name)}</span>` +
                    `<span class="gb-sub">Отдых завершён</span></div></div>` +
                    `<ul class="gb-list"><li>Здоровье восстановлено полностью.</li>` +
                    `<li>Усилие дня и сцены освобождено.</li></ul></div>`
            });
        }
    }

    /**
     * Divine Fury ("Божественная ярость") — Godbound core rules. When a Godbound is
     * brought to 0 HP they may enter a divine rage:
     *  • instantly heal to half max HP (round up);
     *  • gain extra Effort equal to their level (temporary, for the rage);
     *  • break free of any binding/dominating magic and be immune to it while raging.
     * It can be used once and does NOT return on rest — the hero must gain a NEW level
     * before raging again. The rage lasts `level` rounds; afterwards the hero is
     * helpless for 5 rounds (gifts off, no actions, auto-fail saves), and being dropped
     * to 0 HP during or right after the rage is permanent death. Those timing effects
     * are the GM's to run, so they are spelled out in the chat card.
     */
    async activateDivineFury() {
        if (this.type !== 'pc') { ui.notifications.warn('Божественная ярость доступна только персонажам.'); return; }
        const level = this.system.level || 0;
        const remaining = Number(this.system.divineFury?.remaining ?? 1) || 0;
        if (remaining <= 0) { ui.notifications.warn('Божественная ярость исчерпана — вернётся при получении нового уровня (или её вернёт Ведущий).'); return; }
        if ((this.system.hp?.current ?? 1) > 0) { ui.notifications.warn('Божественную ярость можно активировать только при 0 ОЗ.'); return; }

        const maxHp = this.system.computed?.hp?.max ?? 0;
        const healTo = Math.max(1, Math.ceil(maxHp / 2));
        const prevFuryEffort = this.system.divineFury?.furyEffort || 0;
        const newTotal = (this.system.effort?.total || 0) - prevFuryEffort + level;
        await this.update({
            'system.hp.current': healTo,
            'system.divineFury.remaining': remaining - 1,  // spend one use
            'system.divineFury.usedAtLevel': level,   // record the level it was spent at
            'system.divineFury.furyEffort': level,     // temporary Effort granted by the rage
            'system.effort.total': newTotal,
        }, {godboundFuryUse: true});  // legitimate spend - exempt from the GM-only guard
        // Break free of binding / domination: clear death + restraint conditions.
        for (const st of ['dying', 'restrained', 'paralyzed', 'stunned', 'unconscious']) {
            try { if (this.statuses?.has(st)) await this.toggleStatusEffect(st, {active: false}); } catch (e) { /* best-effort */ }
        }
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor: this}),
            content:
                `<div class="godbound chat-block gb-card gb-card--fury">` +
                `<h2 class="gb-title"><span class="gb-title__text">Божественная ярость</span></h2>` +
                `<div class="gb-tags"><span class="gb-tag gb-tag--smite"><i class="fas fa-khanda"></i> Один раз за уровень</span></div>` +
                `<div class="gb-actor">` +
                `<div class="gb-portraits"><img class="gb-portrait" src="${esc(this.img)}" alt=""></div>` +
                `<div class="gb-names"><span class="gb-name" title="${esc(this.name)}">${esc(this.name)}</span>` +
                `<span class="gb-sub">черпает силу божественной энергии</span></div></div>` +
                `<div class="gb-stats">` +
                `<div class="gb-stat"><span class="gb-stat__label">ОЗ восстановлено</span><span class="gb-stat__value">${healTo}</span></div>` +
                `<div class="gb-stat"><span class="gb-stat__label">Усилие ярости</span><span class="gb-stat__value">+${level}</span></div>` +
                `</div>` +
                `<ul class="gb-list">` +
                `<li>Освобождение от связывающей и подчиняющей магии; на время ярости её нельзя наложить снова.</li>` +
                `<li>Длительность — до <b>${level}</b> раунд(ов).</li>` +
                `<li>После ярости — беспомощность 5 раундов: дары неактивны, нет действий, авто-провал спасбросков.</li>` +
                `<li>Падение до 0 ОЗ во время или сразу после ярости — <b>окончательная смерть</b>.</li>` +
                `</ul>` +
                `<div class="gb-note">Снова впасть в ярость можно только получив новый уровень.</div></div>`,
        });
    }

    async applyDamage(amount, damageType, isMagic) {
        amount = this._mitigateDamage(amount, damageType, isMagic);
        let hpUpdate = {};
        let bonus = this.system.hp.bonus;
        let current = this.system.hp.current;
        if(bonus > 0) {
            let damageToBonus = Math.min(amount, bonus);
            hpUpdate.bonus = bonus - damageToBonus;
            amount -= damageToBonus;
        }
        if(amount > 0) {
            hpUpdate.current = Math.max(0, current - amount);
        }
        await this.update({system: {hp: hpUpdate}});
    }

    async applyHDDamage(amount, damageType, isMagic) {
        // Only actors with an HD track (npc) can take HD damage. The damage
        // dispatchers route every non-pc actor here, so a faction (no system.hd)
        // would otherwise throw reading hd.current - no-op with a warning instead.
        if (!this.system.hd || typeof this.system.hd.current !== 'number') {
            ui.notifications?.warn(`У «${this.name}» нет запаса КЗ — урон не применён.`);
            return;
        }
        amount = this._mitigateDamage(amount, damageType, isMagic);
        let hdUpdate = {};
        let current = this.system.hd.current;
        if(amount > 0) {
            hdUpdate.current = Math.max(0, current - amount);
        }
        await this.update({system: {hd: hdUpdate}});
    }

    // Restores hit points/hit dice, capped at the actor's maximum. Never touches
    // bonus HP - bonus HP is a separate temporary pool, not something "healed".
    async applyHeal(amount) {
        if (!amount || amount <= 0) return;
        if (this.type === 'pc') {
            let max = this.system.computed?.hp?.max ?? Infinity;
            let current = Math.min(max, this.system.hp.current + amount);
            await this.update({system: {hp: {current}}});
        } else {
            // Same guard as applyHDDamage: only actors with an HD track can be
            // healed on it; a faction actor has no system.hd.
            if (!this.system.hd || typeof this.system.hd.max !== 'number') {
                ui.notifications?.warn(`У «${this.name}» нет запаса КЗ — лечение не применено.`);
                return;
            }
            let max = this.system.hd.max;
            let current = Math.min(max, this.system.hd.current + amount);
            await this.update({system: {hd: {current}}});
        }
    }

    // ============================================================
    //  Faction turn actions ("Общие Действия Фракций")
    //  The faction lives on the NPC actor (system.faction). These methods roll
    //  the faction's action die, resolve Trouble checks / Contests, apply the
    //  deterministic resource changes (Владычество / Сплочённость / Неприятности)
    //  and post a chat card. Steps that need GM judgement (which Feature applies,
    //  comparing against another faction) are spelled out in the card text.
    // ============================================================

    get factionDie() { return this.system.faction?.actionDie || '1d6'; }

    // Dominion cost of an "Unlikely" (Невероятное) change, scaling with Might:
    // village(1)=2 ... world empire(5+)=32.
    factionUnlikelyCost() { return Math.min(2 ** (this.system.faction?.power || 1), 32); }

    async _factionMessage(title, lines, roll) {
        // `lines` is trusted system-authored markup (bold/italic markers), so it is
        // interpolated as HTML; only the actor-supplied title/name go through esc().
        const body = lines.map(l => `<p>${l}</p>`).join('');
        const chatData = {
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({actor: this}),
            content:
                `<div class="godbound chat-block gb-card gb-card--faction">` +
                `<h2 class="gb-title"><span class="gb-title__text">Фракция</span></h2>` +
                `<div class="gb-actor">` +
                `<div class="gb-portraits"><img class="gb-portrait" src="${esc(this.img)}" alt=""></div>` +
                `<div class="gb-names"><span class="gb-name" title="${esc(title)}">${esc(title)}</span>` +
                `<span class="gb-sub" title="${esc(this.name)}">${esc(this.name)}</span></div></div>` +
                `<div class="gb-lines">${body}</div></div>`,
        };
        if (roll) { chatData.rolls = [roll]; chatData.sound = CONFIG.sounds.dice; }
        await ChatMessage.create(chatData);
    }

    // Roll the faction action die; `twice` keeps the WORST of two rolls (used when
    // a Feature only weakly fits the attempted action).
    async _factionRoll({twice = false} = {}) {
        const die = this.factionDie;
        const roll = new Roll(twice ? `{${die},${die}}kl1` : die);
        await roll.evaluate();
        return roll;
    }

    // A Trouble check succeeds when the die roll is strictly greater than the
    // faction's current Trouble score (more Trouble = harder).
    async _troubleCheck({twice = false} = {}) {
        const trouble = this.system.faction?.trouble?.current || 0;
        const roll = await this._factionRoll({twice});
        return {roll, total: roll.total, trouble, success: roll.total > trouble};
    }

    _factionNumberDialog(title, label, def = 1) {
        return new Promise(resolve => {
            new foundry.appv1.api.Dialog({
                title,
                content: `<div class="godbound gb-dialog"><p class="gb-dialog__text">${label}</p>` +
                    `<input type="number" class="gb-fac-num" value="${def}" min="0"/></div>`,
                buttons: {
                    ok: {icon: '<i class="fas fa-check"></i>', label: 'ОК',
                        callback: html => resolve(Number($(html).find('.gb-fac-num').val()) || 0)},
                    cancel: {icon: '<i class="fas fa-times"></i>', label: 'Отмена', callback: () => resolve(null)},
                },
                default: 'ok',
                close: () => resolve(null),
            }).render(true);
        });
    }

    _factionChoiceDialog(title, prompt, choices) {
        // choices: [{key, label}]
        return new Promise(resolve => {
            const buttons = {};
            for (const c of choices) buttons[c.key] = {label: c.label, callback: () => resolve(c.key)};
            new foundry.appv1.api.Dialog({
                title, content: `<div class="godbound gb-dialog"><p class="gb-dialog__text">${prompt}</p></div>`,
                buttons, default: choices[0]?.key, close: () => resolve(null),
            }).render(true);
        });
    }

    _res(ok) { return ok ? '<b class="gb-ok">успех</b>' : '<b class="gb-fail">провал</b>'; }

    async factionAction(key) {
        if (this.type !== 'npc' && this.type !== 'faction') { ui.notifications.warn('Действия фракций доступны только у НИП или Фракции.'); return; }
        switch (key) {
            case 'gather':   return this._facGather();
            case 'enact':    return this._facEnact();
            case 'cohesion': return this._facCohesion();
            case 'help':     return this._facHelp();
            case 'attack':   return this._facAttack();
            case 'expand':   return this._facInvolve('expand');
            case 'remove':   return this._facInvolve('remove');
            case 'spend':    return this._facSpend();
            default: ui.notifications.warn(`Неизвестное действие фракции: ${key}`);
        }
    }

    // --- Своё (пользовательское) действие фракции ---
    // Rolls the faction action die and posts the custom action's name + note. The
    // GM interprets the result; nothing is auto-applied (custom actions are free-form).
    async factionCustomAction(index) {
        if (this.type !== 'npc' && this.type !== 'faction') { ui.notifications.warn('Действия фракций доступны только у НИП или Фракции.'); return; }
        const list = this.system.faction?.customActions || [];
        const action = list[index];
        if (!action) { ui.notifications.warn('Действие не найдено.'); return; }
        const roll = await this._factionRoll();
        const lines = [`Бросок Кости Действий (${this.factionDie}): <b>${roll.total}</b>.`];
        if (action.note) lines.push(action.note);
        await this._factionMessage(action.name || 'Своё действие', lines, roll);
    }

    // --- Накопить Силы (Внутреннее) ---
    async _facGather() {
        const power = this.system.faction?.power || 1;
        const {roll, total, trouble, success} = await this._troubleCheck();
        const lines = [`Проверка Неприятностей: <b>${total}</b> ${success ? '&gt;' : '≤'} ${trouble} — ${this._res(success)}.`];
        if (success) {
            const gain = Math.ceil(power / 2);
            const cur = this.system.faction?.dominion?.total || 0;
            await this.update({'system.faction.dominion.total': cur + gain});
            lines.push(`Получено Владычества: <b>+${gain}</b> (½ Могущества ${power}). Теперь всего: <b>${cur + gain}</b>.`);
        } else {
            lines.push('Проблема всё портит — Владычество не получено.');
        }
        await this._factionMessage('Накопить Силы (Внутреннее)', lines, roll);
    }

    // --- Восстановить Сплочённость (Внутреннее) ---
    async _facCohesion() {
        const coh = this.system.faction?.cohesion || {current: 1, max: 1};
        if (coh.current >= coh.max) { ui.notifications.info('Сплочённость уже на максимуме.'); return; }
        const cost = this.factionUnlikelyCost();
        const dom = this.system.faction?.dominion?.total || 0;
        if (dom < cost) { ui.notifications.warn(`Недостаточно Владычества: нужно ${cost}, есть ${dom}.`); return; }
        const {roll, total, trouble, success} = await this._troubleCheck();
        const patch = {'system.faction.dominion.total': dom - cost};
        const lines = [
            `Стоимость (Невероятное изменение): потрачено <b>${cost}</b> Владычества.`,
            `Проверка Неприятностей: <b>${total}</b> ${success ? '&gt;' : '≤'} ${trouble} — ${this._res(success)}.`,
        ];
        if (success) {
            patch['system.faction.cohesion.current'] = Math.min(coh.max, coh.current + 1);
            lines.push(`Восстановлено <b>+1</b> Сплочённости (теперь ${Math.min(coh.max, coh.current + 1)}/${coh.max}).`);
        } else {
            lines.push('Владычество потрачено впустую — Сплочённость не восстановлена.');
        }
        lines.push('<i>Нужна подходящая Особенность (на усмотрение Ведущего).</i>');
        await this.update(patch);
        await this._factionMessage('Восстановить Сплочённость (Внутреннее)', lines, roll);
    }

    // --- Помочь Союзнику (Внешнее) ---
    async _facHelp() {
        const dom = this.system.faction?.dominion?.total || 0;
        const amount = await this._factionNumberDialog('Помочь Союзнику', `Сколько Владычества передать союзнику? (доступно ${dom})`, 1);
        if (amount == null || amount <= 0) return;
        if (amount > dom) { ui.notifications.warn(`Недостаточно Владычества (есть ${dom}).`); return; }
        const {roll, total, trouble, success} = await this._troubleCheck();
        await this.update({'system.faction.dominion.total': dom - amount});
        const lines = [`Проверка Неприятностей: <b>${total}</b> ${success ? '&gt;' : '≤'} ${trouble} — ${this._res(success)}.`];
        if (success) lines.push(`<b>${amount}</b> Владычества передано союзнику — начислите их фракции-получателю вручную.`);
        else lines.push(`Проблема портит помощь: <b>${amount}</b> Владычества потеряно впустую.`);
        await this._factionMessage('Помочь Союзнику (Внешнее)', lines, roll);
    }

    // --- Принять Изменение (Внутреннее) ---
    async _facEnact() {
        const mode = await this._factionChoiceDialog('Принять Изменение', 'Что делает фракция?', [
            {key: 'solve', label: 'Решить Проблему'},
            {key: 'feature', label: 'Создать Особенность'},
            {key: 'general', label: 'Общее изменение'},
        ]);
        if (!mode) return;
        const trouble = this.system.faction?.trouble?.current || 0;
        const dom = this.system.faction?.dominion?.total || 0;

        if (mode === 'solve') {
            if (trouble <= 0) { ui.notifications.info('У фракции нет Проблем.'); return; }
            // Special check: succeed on a roll <= total Trouble (more trouble = easier to ease one).
            const roll = await this._factionRoll();
            const success = roll.total <= trouble;
            const lines = [`Особая проверка: <b>${roll.total}</b> ${success ? '≤' : '&gt;'} ${trouble} (Неприятности) — ${this._res(success)}.`];
            const patch = {};
            if (success) {
                patch['system.faction.trouble.current'] = Math.max(0, trouble - 1);
                lines.push('Одна Проблема уменьшена на <b>1</b> очко (обновите текст Проблем).');
            } else {
                lines.push('Всё идёт наперекосяк — Владычество пропадает зря.');
            }
            if (Object.keys(patch).length) await this.update(patch);
            await this._factionMessage('Принять Изменение · Решить Проблему (Внутреннее)', lines, roll);
            return;
        }

        if (mode === 'feature') {
            const cost = await this._factionNumberDialog('Создать Особенность', `Масштаб изменения — сколько Владычества потратить? (доступно ${dom})`, this.factionUnlikelyCost());
            if (cost == null) return;
            if (cost > dom) { ui.notifications.warn(`Недостаточно Владычества (есть ${dom}).`); return; }
            const {roll, total, success} = await this._troubleCheck();
            const patch = {'system.faction.dominion.total': dom - cost, 'system.faction.trouble.current': trouble + 1};
            const lines = [
                `Потрачено <b>${cost}</b> Владычества.`,
                `Проверка Неприятностей: <b>${total}</b> ${success ? '&gt;' : '≤'} ${trouble} — ${this._res(success)}.`,
            ];
            if (success) lines.push('Новая Особенность создана, но возникла связанная <b>Проблема +1</b> очко (реакция на изменение).');
            else lines.push('Усилий не хватило: Владычество потеряно, а виновная <b>Проблема +1</b> очко.');
            await this.update(patch);
            await this._factionMessage('Принять Изменение · Создать Особенность (Внутреннее)', lines, roll);
            return;
        }

        // general
        const cost = await this._factionNumberDialog('Общее изменение', `Сколько Владычества потратить на изменение? (доступно ${dom})`, this.factionUnlikelyCost());
        if (cost == null) return;
        if (cost > dom) { ui.notifications.warn(`Недостаточно Владычества (есть ${dom}).`); return; }
        await this.update({'system.faction.dominion.total': dom - cost});
        await this._factionMessage('Принять Изменение (Внутреннее)', [`Потрачено <b>${cost}</b> Владычества на изменение устройства фракции.`]);
    }

    // --- Атаковать Соперника (Внешнее) — Противоборство ---
    async _facAttack() {
        const weak = await this._factionChoiceDialog('Атаковать Соперника',
            'Насколько выбранная Особенность подходит к атаке?', [
                {key: 'good', label: 'Хорошо (обычный бросок)'},
                {key: 'weak', label: 'Слабо (дважды, худший)'},
            ]);
        if (!weak) return;
        const roll = await this._factionRoll({twice: weak === 'weak'});
        const power = this.system.faction?.power || 1;
        await this._factionMessage('Атаковать Соперника (Внешнее) · Противоборство', [
            `Бросок атакующего (Кость Действий ${this.factionDie}${weak === 'weak' ? ', дважды-худший' : ''}): <b>${roll.total}</b>.`,
            'Защитник бросает свою Кость Действий соответствующей Особенностью. Выше — победитель.',
            `Если побеждает атакующий: защитник выбирает — потерять очко Сплочённости, пожертвовать Особенностью, или получить/увеличить Проблему на 1 очко.`,
            `Разница Могущества добавляется к очкам Проблем (Могущество атакующего = <b>${power}</b>).`,
        ], roll);
    }

    // --- Расширить / Устранить Участие (Внешнее) — Противоборство ---
    async _facInvolve(kind) {
        const title = kind === 'expand' ? 'Расширить Участие' : 'Устранить Участие';
        const weak = await this._factionChoiceDialog(title,
            'Насколько выбранная Особенность подходит?', [
                {key: 'good', label: 'Хорошо (обычный бросок)'},
                {key: 'weak', label: 'Слабо (дважды, худший)'},
            ]);
        if (!weak) return;
        const roll = await this._factionRoll({twice: weak === 'weak'});
        const die = this.factionDie;
        const maxInv = 2 * (parseInt((die.split('d')[1]) || '6', 10) || 6);
        const lines = [
            `Бросок (Кость Действий ${die}${weak === 'weak' ? ', дважды-худший' : ''}): <b>${roll.total}</b>.`,
            'Обе стороны бросают Противоборство подходящими Особенностями. Выше — победитель.',
        ];
        if (kind === 'expand') {
            lines.push('При победе: <b>+1 Участие</b> в цели (обновите поле «Участие»). Максимум Участия в сопернике — удвоенный максимум Кости Действий (' + maxInv + ').');
        } else {
            lines.push('При победе: влияющая фракция теряет <b>1 очко Участия</b> в вас (за раз удаляется только одно).');
        }
        await this._factionMessage(`${title} (Внешнее) · Противоборство`, lines, roll);
    }

    // --- Потратить Участие (Особое) ---
    async _facSpend() {
        const amount = await this._factionNumberDialog('Потратить Участие', 'Сколько очков Участия потратить?', 1);
        if (amount == null || amount <= 0) return;
        await this._factionMessage('Потратить Участие (Особое)', [
            `Потрачено <b>${amount}</b> очк. Участия. Варианты применения:`,
            `• Украсть у цели <b>${amount}</b> Владычества (если действие цели требует Владычества, после кражи ей должно хватить, иначе оно проваливается).`,
            `• Изменить бросок Неприятностей/Противоборства цели на величину до <b>${amount}</b> (но не больше своей Кости Действий). До броска — стоит только Участия; после броска — ещё столько же Владычества.`,
            `<i>Обновите поле «Участие» и Владычество вручную по итогу.</i>`,
        ]);
    }
}
