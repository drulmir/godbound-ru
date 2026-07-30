/**
 * "Полный доступ" — lets the GM designate which user roles (besides the GM, who
 * always qualifies) may grant themselves full owner permission on any actor/token,
 * even ones they don't normally own. Since only the GM's client can actually write
 * ownership changes for a document it doesn't already own, a non-GM's request is
 * relayed over the socket and carried out by a GM client after re-checking the
 * setting server-side-equivalent (the requester's real role, not anything they
 * could spoof in their own client).
 */

import {esc} from "./misc.js";

const SETTING_SCOPE = "godbound";
const ROLE_SETTINGS = {
  [CONST.USER_ROLES.PLAYER]: "fullAccessRolePlayer",
  [CONST.USER_ROLES.TRUSTED]: "fullAccessRoleTrusted",
  [CONST.USER_ROLES.ASSISTANT]: "fullAccessRoleAssistant"
};
const SOCKET_NAME = "system.godbound";

export function registerFullAccessSettings() {
  game.settings.register(SETTING_SCOPE, "fullAccessRolePlayer", {
    name: "Полный доступ: роль Игрок",
    hint: "Разрешить пользователям с ролью «Игрок» запрашивать кнопку «Полный доступ» на листах персонажей/NPC.",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(SETTING_SCOPE, "fullAccessRoleTrusted", {
    name: "Полный доступ: роль Доверенный",
    hint: "Разрешить пользователям с ролью «Доверенный игрок» запрашивать кнопку «Полный доступ».",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(SETTING_SCOPE, "fullAccessRoleAssistant", {
    name: "Полный доступ: роль Помощник ГМ",
    hint: "Разрешить пользователям с ролью «Помощник ГМ» запрашивать кнопку «Полный доступ».",
    scope: "world", config: true, type: Boolean, default: true
  });
}

export function hasFullEditPrivilege(user) {
  if (!user) return false;
  if (user.isGM) return true;
  const settingKey = ROLE_SETTINGS[user.role];
  return settingKey ? !!game.settings.get(SETTING_SCOPE, settingKey) : false;
}

async function grantOwnership(actor, userId) {
  const ownership = foundry.utils.deepClone(actor.ownership);
  ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  await actor.update({ ownership });
}

export async function requestFullAccess(actor) {
  if (game.user.isGM) {
    await grantOwnership(actor, game.user.id);
    ui.notifications.info(`Выдан полный доступ к «${actor.name}».`);
    return;
  }
  if (!hasFullEditPrivilege(game.user)) {
    ui.notifications.warn("Ваша роль не имеет права на полный доступ.");
    return;
  }
  // Fire-and-forget socket messages are dropped if no one is listening, so warn
  // instead of falsely reporting success when there is no GM to handle the request.
  if (!game.users?.activeGM) {
    ui.notifications.warn("Нет активного Ведущего — запрос некому обработать. Попробуйте, когда ГМ будет в игре.");
    return;
  }
  game.socket.emit(SOCKET_NAME, { type: "requestFullAccess", actorId: actor.id, userId: game.user.id });
  ui.notifications.info("Запрос на полный доступ отправлен ГМ.");
}

export function registerFullAccessSocket() {
  game.socket.on(SOCKET_NAME, async data => {
    // Only the PRIMARY GM handles the request, so a table with several GM/assistant
    // clients doesn't run grantOwnership (and rebroadcast the update) once per GM.
    if (game.users?.activeGM !== game.user) return;
    if (data?.type !== "requestFullAccess") return;
    const requester = game.users.get(data.userId);
    const actor = game.actors.get(data.actorId);
    if (!requester || !actor) return;
    // The requester's real role is re-checked from game.users (NOT the payload), so
    // an unprivileged user can never be granted access even by a forged message.
    if (!hasFullEditPrivilege(requester)) return;
    // The payload's userId is not authenticated to its actual sender, so a spoofed
    // message could name another privileged user. Require an explicit GM approval
    // before granting - turning this into a "player requests → GM approves" flow.
    const approved = await foundry.appv1.api.Dialog.confirm({
      title: "Запрос полного доступа",
      content: `<p>Выдать <b>${esc(requester.name)}</b> полный доступ к «<b>${esc(actor.name)}</b>»?</p>`
    });
    if (approved) await grantOwnership(actor, requester.id);
  });
}
