// Escape a value for safe interpolation into chat-card HTML (text *and*
// attribute positions). Actor/item names are user-supplied and regularly
// contain quotes or angle brackets, which would otherwise break the markup
// or the data-* attributes the chat click handlers read back.
export const esc = (val) => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Почти все описания предметов правятся в обычной <textarea> (см. шаблоны
// templates/item/*.html), поэтому их единственная разметка — переводы строк:
// без white-space:pre-wrap многоабзацный Дар слипается в чате в одну простыню.
// Но типы invocation и multiDieDamageRoll используют богатый редактор
// ({{editor}}), и вот там pre-wrap наоборот добавил бы пустые строки между
// блочными тегами. Отличаем одно от другого по наличию блочной разметки.
const BLOCK_HTML = /<(?:p|div|ul|ol|li|h[1-6]|table|blockquote|pre|section)\b/i;
export const isPlainDescription = (text) => !BLOCK_HTML.test(String(text ?? ''));

// Foundry подставляет новым предметам безликий «мешок», а иногда картинки нет
// вовсе. В карточке чата это выглядит как пустой медальон рядом с названием
// атаки, поэтому боевые предметы без собственной иконки получают осмысленную
// заглушку — удар кулаком из набора иконок ядра (ничего доставлять не нужно).
const GENERIC_ITEM_IMAGES = new Set([
    'icons/svg/item-bag.svg',
    'icons/svg/mystery-man.svg',
    'icons/svg/blank.svg',
]);
const FIST = 'icons/skills/melee/unarmed-punch-fist.webp';
const TYPE_FALLBACK_IMAGE = {
    attack: FIST,
    autoHitAttack: FIST,
    multiDieDamageRoll: FIST,
};

/** Icon to show for an item on a chat card, with a per-type fallback. */
export const itemChatImage = (item) => {
    const img = item?.img;
    if (img && !GENERIC_ITEM_IMAGES.has(img)) return img;
    return TYPE_FALLBACK_IMAGE[item?.type] || img || 'icons/svg/item-bag.svg';
};

export const SafeNum = (val) => {
    if(!val) return 0;
    let number = parseInt(val);
    return isNaN(number) ? 0 : number;
}

export const Capitalize = (val) => {
    if(!val) return '';
    return val.slice(0, 1).toUpperCase() + val.slice(1);
}

/**
 * Собрать формулу урона из пары полей «кубик» + «бонус».
 *
 * Куча даров и Искусств наносит ПЛОСКИЙ урон без броска («урон, равный уровню»,
 * «3 очка повреждений»). На листе это записывается пустым левым полем и числом
 * в правом. Раньше такая запись просто игнорировалась (формула не собиралась
 * вовсе), поэтому кнопка урона либо молчала, либо падала на `new Roll(undefined)`.
 *
 * @returns {string} формула для Roll, либо '' если урона нет вообще.
 */
export const buildDamageFormula = (damageRoll, damageBonus) => {
    const dice = String(damageRoll ?? '').trim();
    const bonus = SafeNum(damageBonus);
    if (dice && bonus) return `${dice}${bonus > 0 ? '+' : ''}${bonus}`;
    if (dice) return dice;
    if (bonus) return String(bonus);
    return '';
}

/**
 * Подпись модификатора броска для чата: «Обычно», «Легко (+4)», «Трудно (−4)»,
 * а для произвольного числа — просто «+2» / «−3».
 */
export const modifierLabel = (mod) => {
    const m = Number(mod) || 0;
    if (m === 0) return 'Обычно';
    const signed = m > 0 ? `+${m}` : `−${Math.abs(m)}`;
    if (m === 4) return `Легко (${signed})`;
    if (m === -4) return `Трудно (${signed})`;
    return `Модификатор ${signed}`;
};

/**
 * Значки активации силы для карточки чата — как метки «Действие / Бонусное
 * действие» в D&D: как силу включают (Постоянно / Мгновенно / В свой ход /
 * Действие / Кара) и чем за неё платят (Без Усилия / По желанию / Сцена / День).
 * Флаги берутся с листа предмета; у предметов без флагов (оружие, сокровища)
 * значков просто нет.
 *
 * @param {Item} item
 * @param {string} [committed] — фактически вложенное Усилие (atWill/scene/day):
 *        этот значок подсвечивается.
 * @returns {string} HTML набора <span class="gb-tag">, может быть пустой строкой.
 */
export const powerTagsHtml = (item, committed) => {
    const s = item?.system ?? {};
    const tags = [];
    const add = (label, icon, cls = '') =>
        tags.push(`<span class="gb-tag${cls ? ' ' + cls : ''}"><i class="fas ${icon}"></i> ${label}</span>`);
    if (s.greater) add('Больший', 'fa-star', 'gb-tag--greater');
    if (s.constant) add('Постоянно', 'fa-infinity', 'gb-tag--activation');
    if (s.instant) add('Мгновенно', 'fa-bolt', 'gb-tag--activation');
    if (s.onTurn) add('В свой ход', 'fa-hourglass-half', 'gb-tag--activation');
    if (s.action) add('Действие', 'fa-hand-fist', 'gb-tag--activation');
    if (s.smite) add('Кара', 'fa-meteor', 'gb-tag--smite');
    // Чудо без отметок о цене всё равно стоит Усилие на день (см. usePower).
    const day = s.day || (item?.type === 'divineMiracle' && !s.atWill && !s.scene);
    const effort = [
        ['noEffort', s.noEffort, 'Без Усилия', 'fa-circle-play'],
        ['atWill', s.atWill, 'По желанию', 'fa-power-off'],
        ['scene', s.scene, 'Сцена', 'fa-clock'],
        ['day', day, 'День', 'fa-sun'],
    ];
    for (const [key, on, label, icon] of effort) {
        if (key === committed) {
            add(`Усилие: ${label.toLowerCase()}`, icon, 'gb-tag--effort gb-tag--committed');
        } else if (on && !committed) {
            add(label, icon, 'gb-tag--effort');
        }
    }
    return tags.join('');
};

/** Есть ли у предмета хоть какой-то урон (бросок или плоское число). */
export const hasDamage = (system) => !!buildDamageFormula(system?.damageRoll, system?.damageBonus);

/** В формуле нет ни одного кубика — это плоский, уже посчитанный урон. */
export const isFlatFormula = (formula) => !/\dd\d|\bd\d/i.test(String(formula ?? ''));

const names = {
    boundWord: 'Слово',
    divineGift: 'Дар',
    divineMiracle: 'Чудо',
    attack: 'Атака',
    autoHitAttack: 'Атака',
    multiDieDamageRoll: 'Атака',
    project: 'Проект',
    item: 'Предмет',
    artifact: 'Артефакт',
    treasure: 'Сокровище',
    invocation: 'Воззвание',
    cult: 'Культ',
    tactic: 'Тактика',
    godwalkerPart: 'Деталь Богохода',
    prosthetic: 'Протез',
    artifactPower: 'Дар артефакта',
    art: 'Искусство',
    artLevel: 'Уровень',
    fact: 'Факт',
    language: 'Язык',
}

export const TypeNames = (type) => {
    return names[type];
}

// Human-readable Russian labels for attribute and save keys, used in chat output.
const labels = {
    str: 'Сила', dex: 'Ловкость', con: 'Телосложение',
    int: 'Интеллект', wis: 'Мудрость', cha: 'Харизма',
    hardiness: 'Стойкость', evasion: 'Уклонение', spirit: 'Дух',
    brawn: 'Мощь', will: 'Воля', wit: 'Ум',
    grip: 'Хватка', observation: 'Наблюдение',
    normal: 'Обычно', upperHand: 'Преимущество', againstTheOdds: 'Против шансов',
};

export const Label = (key) => {
    return labels[key] || Capitalize(key);
}

// The Art item type groups several distinct sub-categories that are displayed
// as separate sections on the actor sheet.
export const ART_CATEGORIES = [
    {id: 'martialStrife', name: 'Боевые Раздоры', hasLevel: false, hasEffort: true},
    {id: 'trueStrifeTechnique', name: 'Техники Истинного Раздора', hasLevel: false, hasEffort: true},
    {id: 'lowMagic', name: 'Низшая Магия', hasLevel: true, hasEffort: false},
    {id: 'invocationGate', name: 'Воззвания Врат', hasLevel: true, hasEffort: false},
    {id: 'invocationPath', name: 'Воззвания Пути', hasLevel: true, hasEffort: false},
    {id: 'invocationThrone', name: 'Воззвания Трона', hasLevel: true, hasEffort: false},
];

const artCategoryNames = ART_CATEGORIES.reduce((acc, c) => {
    acc[c.id] = c.name;
    return acc;
}, {});

export const ArtCategoryName = (id) => {
    return artCategoryNames[id] || id;
}