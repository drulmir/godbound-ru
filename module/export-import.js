/**
 * Godbound character export / import.
 *
 * Exports an actor as a self-contained JSON file carrying EVERYTHING that is
 * filled in on the sheet: the full `system` model, every embedded item (with
 * their original _ids preserved, since Godbound items reference each other by
 * id - artId, artifactId, damageSource, etc.), active effects, flags, the
 * prototype token, portrait/token art paths and the actor name/type. The file
 * can be imported into another world to recreate the character exactly.
 */

const SCHEMA_VERSION = 1;

/** Turn an arbitrary actor name into a safe file name. */
function _fileSafe(name) {
    const cleaned = String(name || "persona")
        .replace(/[\\/:*?"<>|]+/g, "")   // characters illegal in file names
        .trim()
        .replace(/\s+/g, "_");
    return cleaned || "persona";
}

/** Trigger a browser download of a text payload. */
function _download(filename, text) {
    const blob = new Blob([text], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the selected file's text (or null). */
function _pickFileText() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.style.display = "none";
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
    });
}

/** Strip world-specific bookkeeping so the actor can live in any world. */
function _stripWorldKeys(data) {
    delete data._id;
    delete data.folder;
    delete data.ownership;
    delete data._stats;
    delete data.sort;
    return data;
}

/**
 * Export a single actor to a downloaded JSON file.
 * @param {Actor} actor
 */
export function exportGodboundActor(actor) {
    if (!actor) return;
    // toObject() returns the full *source* data, including embedded items and
    // effects with their real _ids, prototypeToken, flags, img and system.
    const actorData = _stripWorldKeys(actor.toObject());
    const payload = {
        __godboundExport: true,
        schema: SCHEMA_VERSION,
        system: game.system.id,
        systemVersion: game.system.version,
        exportedAt: new Date().toISOString(),
        actor: actorData
    };
    _download(`godbound-${_fileSafe(actor.name)}.json`, JSON.stringify(payload, null, 2));
    ui.notifications?.info(`Персонаж «${actor.name}» экспортирован.`);
}

/**
 * Parse raw file text into usable actor source data. Accepts our wrapped
 * export format, a bare actor.toObject() dump, or Foundry's native actor
 * export JSON.
 * @returns {object|null}
 */
function _parseActorData(raw) {
    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (e) {
        ui.notifications?.error("Файл не является корректным JSON.");
        return null;
    }
    const actorData = obj && obj.__godboundExport ? obj.actor : obj;
    if (!actorData || typeof actorData !== "object" || !actorData.system || !actorData.type) {
        ui.notifications?.error("Файл не содержит данных персонажа Godbound.");
        return null;
    }
    if (obj && obj.__godboundExport && obj.system && obj.system !== game.system.id) {
        ui.notifications?.warn(`Файл создан в другой системе (${obj.system}). Импорт может пройти некорректно.`);
    }
    // A file written by a newer export format may carry fields this version cannot
    // interpret. Warn (Foundry's schema validation still sanitises unknown data),
    // so the header fields we write actually guard the round trip.
    if (obj && obj.__godboundExport && typeof obj.schema === "number" && obj.schema > SCHEMA_VERSION) {
        ui.notifications?.warn(`Файл создан более новой версией формата (схема ${obj.schema} > ${SCHEMA_VERSION}). Часть данных может импортироваться неполно.`);
    }
    return actorData;
}

/**
 * Import a character from a JSON file, creating a brand-new actor in this world.
 * This is the "world to world" transfer path. Embedded item ids are preserved
 * (keepEmbeddedIds defaults true on create) so internal references survive.
 */
export async function importGodboundActorFromFile() {
    if (!game.user.can("ACTOR_CREATE")) {
        ui.notifications?.warn("Недостаточно прав для создания персонажей.");
        return;
    }
    const raw = await _pickFileText();
    if (!raw) return;
    const parsed = _parseActorData(raw);
    if (!parsed) return;

    const data = _stripWorldKeys(foundry.utils.deepClone(parsed));
    try {
        const created = await Actor.create(data, {renderSheet: true});
        if (created) {
            const itemCount = created.items?.size ?? 0;
            ui.notifications?.info(`Импортирован персонаж «${created.name}» (предметов: ${itemCount}).`);
        }
    } catch (e) {
        console.error("Godbound | actor import failed", e);
        ui.notifications?.error(`Не удалось импортировать персонажа: ${e.message}`);
    }
}
