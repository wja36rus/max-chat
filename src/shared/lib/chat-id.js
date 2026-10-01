// Работа с chatId.
//
// У GREEN-API.MAX chatId — числовой идентификатор аккаунта («10000000»),
// который в URL-путях и некоторых методах передаётся БЕЗ суффикса «@c.us»,
// а в payload вебхуков иногда С суффиксом. Эти функции приводят формат.

/**
 * Добавляет суффикс «@c.us», если его нет.
 * @param {string} chatId
 * @returns {string}
 */
export function withChatSuffix(chatId) {
  if (!chatId) return "";
  return chatId.includes("@") ? chatId : chatId + "@c.us";
}

/**
 * Убирает суффикс «@c.us» — формат тел запросов к API.
 * @param {*} chatId
 * @returns {string}
 */
export function withoutChatSuffix(chatId) {
  return String(chatId ?? "").replace(/@\w+\.us$/, "");
}
