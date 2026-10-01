// Хранение открытых чатов в sessionStorage.
//
// Храним ТОЛЬКО { chatId, title, phone } — без сообщений (история берётся
// из API через GetChatHistory при загрузке). Ключ привязан к idInstance,
// чтобы разные аккаунты не смешивались. Функции принимают storage наружу —
// так их можно тестировать с фейковым хранилищем.

export const CHATS_PREFIX = "max-chat.chats.";

/**
 * Ключ sessionStorage для списка чатов инстанса.
 * @param {string} idInstance
 * @returns {string}
 */
export const chatsKey = (idInstance) => `${CHATS_PREFIX}${idInstance}`;

/**
 * Читает и нормализует сохранённый список: отбрасывает битые записи,
 * оставляет только знакомые поля (chatId/title/phone).
 * @param {Storage} storage — sessionStorage (или фейк в тестах)
 * @param {string} idInstance
 * @returns {{chatId: string, title: string, phone: string}[]}
 */
export function loadChats(storage, idInstance) {
  let stored = [];
  try {
    stored = JSON.parse(storage.getItem(chatsKey(idInstance)) || "[]");
  } catch {
    stored = [];
  }
  const items = Array.isArray(stored) ? stored : [];
  return items
    .filter((c) => c && c.chatId)
    .map((c) => ({
      chatId: c.chatId,
      title: c.title,
      phone: c.phone,
    }));
}

/**
 * Сохраняет список открытых чатов (id/телефон/имя, без сообщений).
 * @param {Storage} storage
 * @param {string} idInstance
 * @param {{chatId: string, title: string, phone: string}[]} chats
 */
export function saveChats(storage, idInstance, chats) {
  storage.setItem(
    chatsKey(idInstance),
    JSON.stringify(
      chats.map((c) => ({
        chatId: c.chatId,
        title: c.title,
        phone: c.phone,
      })),
    ),
  );
}

/**
 * Удаляет сохранённые чаты инстанса (при выходе из аккаунта).
 * @param {Storage} storage
 * @param {string} idInstance
 */
export function clearChats(storage, idInstance) {
  storage.removeItem(chatsKey(idInstance));
}
