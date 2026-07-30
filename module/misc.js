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