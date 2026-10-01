// Сценарий фичи «чат»: восстановление сохранённых чатов после перезагрузки.
//
// sessionStorage хранит только {chatId,title,phone}. При монтировании страницы
// каждый сохранённый чат освежается в фоне: getContactInfo → (если «мёртвый»
// chatId) checkAccount → GetChatHistory. Историю грузим ПО ОДНОМУ чату за раз
// с паузой ~1.2 с: у GetChatHistory лимит 1 запрос/с (иначе 429).

import { historyToMessages } from "../../entities/message/index.js";

/**
 * Пауза между запросами истории соседних чатов — бюджет лимита 1 зап/с.
 */
export const HISTORY_REQUEST_DELAY_MS = 1200;

/**
 * Освежает один сохранённый чат: актуальное имя + история (последние 100).
 * Никогда не бросает ошибку: всё, что можно пережить (429, 466 квоты,
 * «мёртвый» номер), возвращается как есть — патч без messages.
 *
 * @param {object} api — клиент GREEN-API
 * @param {{chatId: string, title: string, phone: string}} saved — из sessionStorage
 * @returns {Promise<{chatId: string, title: string, messages?: object[]}>}
 */
export async function refreshSavedChat(api, saved) {
  let chatId = saved.chatId;
  let title = saved.title;

  // 1) Актуальное имя и проверка, что чат жив. Если getContactInfo падает
  // (или chatId «умер»), пробуем переразрешить номер через CheckAccount.
  try {
    const info = await api.getContactInfo(saved.chatId);
    if (info.name && info.chatId) {
      chatId = info.chatId;
      title = info.name;
    }
  } catch {
    if (saved.phone) {
      try {
        chatId = await api.checkAccount(saved.phone);
      } catch {
        /* keep the stored chat as-is */
      }
    }
  }

  // 2) История для ТЕКУЩЕГО (возможно, переразрешённого) chatId.
  //    ровно 1 запрос/с → паузу делает вызывающий цикл.
  //    ponytail: равномерная пауза между чатами — упрощение вместо ретрая с
  //    backoff при 429; потолок: при квоте историю просто не покажем, живые
  //    сообщения всё равно придут через поллинг.
  let messages;
  try {
    const history = historyToMessages(await api.getChatHistory(chatId, 100));
    if (history.length) messages = history;
  } catch {
    /* rate limit / quota — history is best-effort */
  }

  return { chatId, title, messages };
}
