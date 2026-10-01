// Сценарии фичи «чат»: пользовательские действия поверх API и сущностей.
//
// Страницы не ходят в shared/api напрямую — только через действия фичи.
// Так приложение знает про MAX (CheckAccount, chatId) на уровне фичи,
// а страница остаётся тонкой оркестрацией состояния и виджетов.
//
// Примечание: действий нет в shared, потому что здесь живёт предметная
// логика: «номер без аккаунта MAX — это ошибка», «не отправлено — значит,
// черновик сохраняем».

import { appendOutgoing, updateMessage } from "../../entities/chat/index.js";
import { makeLocalMessage } from "../../entities/message/index.js";

/**
 * Открывает/создаёт чат по номеру телефона: resolved номер → chatId через
 * CheckAccount (в MAX chatId — числовой id аккаунта, а не телефон).
 * Бросает Error с понятным текстом (пустой номер, нет аккаунта, квота).
 * @param {object} api — клиент GREEN-API (createGreenApi)
 * @param {string} phone — сырой ввод пользователя
 * @returns {Promise<{chatId: string, phone: string}>}
 */
export async function openChatByPhone(api, phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) throw new Error("Введите номер телефона.");
  const chatId = await api.checkAccount(digits);
  return { chatId, phone: digits };
}

/**
 * Отправка текста: добавляет локальное сообщение «в полёте», зовёт
 * sendMessage, обновляет статус на реальный idMessage. Ошибки не выбрасывает:
 * статус сообщения становится "failed", текст уходит в onError, возвращается
 * false — композер по нему решает, чистить ли черновик.
 * @param {object} deps
 * @param {object} deps.api — клиент GREEN-API
 * @param {string} deps.chatId
 * @param {string} deps.text
 * @param {string} deps.localId — временный id до ответа API
 * @param {Function} deps.setChats — setState для списка чатов
 * @param {Function} [deps.onError] — колбэк показа ошибки
 * @returns {Promise<boolean>} true — API принял сообщение
 */
export async function sendText({ api, chatId, text, localId, setChats, onError }) {
  if (!chatId || typeof text !== "string" || !text.trim()) return false;

  // Оптимистичная отправка: показываем сообщение сразу со статусом sending.
  setChats((prev) => appendOutgoing(prev, chatId, makeLocalMessage(text, localId)));

  try {
    const idMessage = await api.sendMessage(chatId, text);
    setChats((prev) =>
      updateMessage(prev, chatId, localId, { idMessage, status: "sent" }),
    );
    return true;
  } catch (err) {
    setChats((prev) =>
      updateMessage(prev, chatId, localId, { status: "failed" }),
    );
    if (onError) onError(`Не отправлено: ${err.message}`);
    return false;
  }
}
