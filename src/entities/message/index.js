// Сущность «сообщение» — модель сообщения и парсеры сырых payload-ов
// GREEN-API (вебхук receiveNotification, элементы GetChatHistory) в неё.
//
// Слой entities зависит только от shared. Текстовый клиент: всё, что не
// «textMessage» или пустой текст — отбрасывается ещё на входе.

import { withChatSuffix } from "../../shared/lib/chat-id.js";

/**
 * Парсит тело входящего вебхука в сообщение, пригодное для UI.
 * @param {object} body — разобранное уведомление receiveNotification
 * @returns {{
 *   idMessage: string, chatId: string, senderName: string,
 *   phone: string, text: string, timestamp: number
 * }|null} null — если это не текстовое сообщение или текст пуст
 */
export function extractTextMessage(body) {
  if (!body || typeof body !== "object") return null;
  if (body.typeWebhook !== "incomingMessageReceived") return null;
  const md = body.messageData;
  if (!md || md.typeMessage !== "textMessage") return null;
  const text = md?.textMessageData?.textMessage;
  if (typeof text !== "string" || !text) return null;
  const raw = body.senderData?.chatId || "";
  return {
    idMessage: body.idMessage,
    // The API sometimes omits the @c.us suffix in chatId — add it if missing.
    chatId: raw.includes("@") ? raw : raw + "@c.us",
    senderName: body.senderData?.senderName || "Неизвестный",
    phone: String(body.senderData?.senderPhoneNumber ?? ""),
    text,
    timestamp: Number(body.timestamp) || Date.now(),
  };
}

/**
 * Маппит элементы GetChatHistory (новые сверху) в сообщения UI. Только текст:
 * не-текстовые и пустые отбрасываем.
 * @param {object[]} items — ответ getChatHistory
 * @returns {object[]} сообщения {idMessage, chatId, direction, status, senderName, text, timestamp}
 */
export function historyToMessages(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || it.typeMessage !== "textMessage") continue;
    const text = it.textMessage;
    if (typeof text !== "string" || !text) continue;
    out.push({
      idMessage: it.idMessage,
      chatId: withChatSuffix(it.chatId),
      direction: it.type === "outgoing" ? "out" : "in",
      status: it.type === "outgoing" ? it.statusMessage || "sent" : "received",
      senderName: it.senderName || "",
      text,
      timestamp: Number(it.timestamp) || 0,
    });
  }
  return out;
}

/**
 * Создаёт локальное (ещё не доставленное) сообщение с меткой времени
 * в СЕКУНДАХ — как у API, чтобы сортировка и время в пузыре были едины
 * (Date.now() в мс ломал и то и другое).
 * @param {string} text
 * @param {string} localId — временный id до ответа sendMessage
 * @returns {{idMessage: string, text: string, timestamp: number}}
 */
export function makeLocalMessage(text, localId) {
  return { idMessage: localId, text, timestamp: Math.floor(Date.now() / 1000) };
}
