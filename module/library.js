/**
 * "Редактируемая библиотека" — the GM (and assistant GMs) can edit every entry of
 * the system's own compendium packs (Слова, Дары, теургия, враги, ...) straight
 * in the compendium browser, and those edits stick.
 *
 * Two halves:
 *  1. Auto-unlock. System packs ship locked by Foundry convention, so nothing in
 *     them is editable until the GM toggles the edit lock pack by pack. On ready
 *     the primary GM unlocks every godbound.* pack (while the world setting is on),
 *     so the compendium is editable out of the box. Edits go straight into
 *     systems/godbound/packs/* — the library itself, shared by every world on
 *     this install.
 *  2. World mirror. A system update replaces packs/* wholesale, which would wipe
 *     those edits. So every create/update/delete of a pack document is also
 *     mirrored into a hidden world setting (godbound.libraryOverrides). On ready
 *     the primary GM compares each mirrored entry with what the pack holds now
 *     and re-applies it when they differ — the world remembers the GM's version
 *     of the library and restores it into the pack.
 */

const SCOPE = "godbound";
const SETTING_EDITABLE = "libraryEditable";
const SETTING_OVERRIDES = "libraryOverrides";
const PACK_PREFIX = "godbound.";

// True while syncLibrary() is writing into the packs, so our own hooks don't
// mirror the restore back into the setting (and don't record the delete half of
// a delete+recreate as "the GM deleted this").
let syncing = false;

// Edits queued for the next flush, keyed "packId|docId". A sheet edit fires one
// update per field, each carrying the whole document, so writes are coalesced.
const pending = new Map();
let flushChain = Promise.resolve();

export function registerLibrarySettings() {
  game.settings.register(SCOPE, SETTING_EDITABLE, {
    name: "Библиотека: редактирование Ведущим",
    hint: "Снимает замок со всех компендиумов системы (Слова и Дары, теургия, враги, артефакты…), чтобы Ведущий мог править их прямо в библиотеке. Правки сохраняются и в самой библиотеке, и в мире: после обновления системы они восстанавливаются автоматически. Выключение снова запирает компендиумы.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: editable => { if (isPrimaryGM()) setPackLocks(!editable); }
  });
  // {[packId]: {[docId]: {data, ts} | {deleted: true, ts}}}
  game.settings.register(SCOPE, SETTING_OVERRIDES, {
    scope: "world", config: false, type: Object, default: {}
  });
}

export function registerLibraryHooks() {
  for (const type of ["Actor", "Item", "ActiveEffect"]) {
    Hooks.on(`create${type}`, (doc, options, userId) => recordChange(doc, userId, false));
    Hooks.on(`update${type}`, (doc, changes, options, userId) => recordChange(doc, userId, false));
    Hooks.on(`delete${type}`, (doc, options, userId) => recordChange(doc, userId, true));
  }
}

function isPrimaryGM() {
  return game.users?.activeGM === game.user;
}

function isLibraryPack(packId) {
  return typeof packId === "string" && packId.startsWith(PACK_PREFIX);
}

/**
 * Mirror a pack document change into the world setting. Runs on the editing
 * client only (userId is the author of the change), so a table with several
 * GM clients records each edit once.
 */
function recordChange(doc, userId, deleted) {
  if (syncing || userId !== game.user.id) return;
  // An embedded item/effect of a pack actor is stored as part of the actor, so
  // whatever changed, the thing to remember is the top-level document.
  let root = doc;
  while (root.parent) root = root.parent;
  if (!isLibraryPack(root.pack)) return;
  if (root !== doc) deleted = false;
  const entry = deleted
    ? {deleted: true, ts: Date.now()}
    : {data: mirrorData(root), ts: Date.now()};
  pending.set(`${root.pack}|${root.id}`, entry);
  scheduleFlush();
}

// Per-user ownership is meaningless inside a compendium (the pack's own
// ownership from system.json applies), and Foundry stamps the creating user as
// OWNER on every create — so a mirrored copy keeps only the default level.
function mirrorData(doc) {
  const data = doc.toObject();
  if (data.ownership) data.ownership = {default: data.ownership.default ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE};
  return data;
}

const scheduleFlush = foundry.utils.debounce(() => {
  // Chain flushes so a burst of edits can't read a stale store mid-write.
  flushChain = flushChain.then(flushPending).catch(e =>
    console.warn("Godbound | не удалось сохранить правку библиотеки в мир", e));
}, 400);

async function flushPending() {
  if (!pending.size) return;
  const store = foundry.utils.deepClone(game.settings.get(SCOPE, SETTING_OVERRIDES) ?? {});
  for (const [key, entry] of pending) {
    const [packId, id] = key.split("|");
    (store[packId] ??= {})[id] = entry;
  }
  pending.clear();
  await game.settings.set(SCOPE, SETTING_OVERRIDES, store);
}

/** Lock or unlock every system pack. Primary GM only (it writes a world setting). */
export async function setPackLocks(locked) {
  for (const pack of game.packs) {
    if (!isLibraryPack(pack.collection) || pack.locked === locked) continue;
    try { await pack.configure({locked}); }
    catch (e) { console.warn(`Godbound | не удалось ${locked ? "запереть" : "отпереть"} ${pack.collection}`, e); }
  }
}

// _stats (modifiedTime, lastModifiedBy…) differ after every write and after a
// delete+recreate, and ownership gets the creator stamped in (see mirrorData),
// so both are dropped before comparing pack vs mirror. Both sides go through
// JSON so undefined vs missing keys don't count as a change.
const IGNORED_KEYS = new Set(["_stats", "ownership"]);
function comparable(obj) {
  const strip = v => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) if (!IGNORED_KEYS.has(k)) out[k] = strip(x);
      return out;
    }
    return v;
  };
  return strip(JSON.parse(JSON.stringify(obj ?? null)));
}

/**
 * Re-apply the world mirror onto the packs: anything the packs no longer hold in
 * the GM's version (a fresh system install, an update, a reverted pack folder)
 * is restored. Packs are unlocked for the duration and re-locked afterwards if
 * the world has editing switched off.
 */
export async function syncLibrary() {
  const store = game.settings.get(SCOPE, SETTING_OVERRIDES) ?? {};
  const editable = game.settings.get(SCOPE, SETTING_EDITABLE);
  let applied = 0, failed = 0;
  syncing = true;
  try {
    for (const [packId, entries] of Object.entries(store)) {
      const pack = game.packs.get(packId);
      if (!pack || !isLibraryPack(packId)) continue;
      const wasLocked = pack.locked;
      if (wasLocked) await pack.configure({locked: false});
      const cls = pack.documentClass;
      for (const [id, entry] of Object.entries(entries)) {
        try {
          const existing = await pack.getDocument(id);
          if (entry.deleted) {
            if (existing) { await cls.deleteDocuments([id], {pack: packId}); applied++; }
            continue;
          }
          if (existing && foundry.utils.objectsEqual(comparable(existing.toObject()), comparable(entry.data))) continue;
          // Replace rather than update: an update with recursive:false is murky for
          // embedded collections (pack actors carry their gifts inline), while a
          // recreate with the same _id is exact and nothing in a pack references
          // the document instance itself.
          if (existing) await cls.deleteDocuments([id], {pack: packId});
          await cls.createDocuments([entry.data], {pack: packId, keepId: true, godboundRestore: true});
          applied++;
        } catch (e) {
          failed++;
          console.warn(`Godbound | не удалось восстановить ${packId}.${id} из мира`, e);
        }
      }
      if (wasLocked && !editable) await pack.configure({locked: true});
    }
  } finally {
    syncing = false;
  }
  if (applied) ui.notifications?.info(`Godbound: восстановлено правок библиотеки из мира: ${applied}.`);
  if (failed) ui.notifications?.warn(`Godbound: не удалось восстановить правок библиотеки: ${failed} (см. консоль).`);
  return {applied, failed};
}

/** Forget the world's mirror of the library (the packs themselves are untouched). */
export async function clearLibraryOverrides() {
  await game.settings.set(SCOPE, SETTING_OVERRIDES, {});
  ui.notifications?.info("Godbound: зеркало правок библиотеки в мире очищено.");
}

/** Ready-time entry point: unlock (if enabled) and restore. Primary GM only. */
export async function initLibrary() {
  if (!isPrimaryGM()) return;
  try {
    if (game.settings.get(SCOPE, SETTING_EDITABLE)) await setPackLocks(false);
    await syncLibrary();
  } catch (e) {
    console.error("Godbound | library init failed", e);
  }
}
