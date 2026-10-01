// Сущность «чат» — модель списка чатов (лексема: массив {chatId,title,phone,messages}).
//
// Все функции чистые: не мутируют входные массивы, возвращают новое состояние.
// Именно эти reducer-ы применяются из setChats, поэтому поллинг и рестор
// никогда не «перетирают» друг друга — только дополняют/дедуплицируют.

/**
 * Создаёт чат, если такого chatId ещё нет: пустой, без сообщений.
 * @param {{chatId: string, title: string, phone: string, messages: object[]}[]} chats
 * @param {string} chatId
 * @param {string} title
 * @param {string} [phone]
 * @returns {object[]}
 */
export function appendChat(chats, chatId, title, phone = "") {
  if (chats.some((c) => c.chatId === chatId)) return chats;
  return [{ chatId, title, phone, messages: [] }, ...chats];
}

/**
 * Восстанавливает чаты из sessionStorage: существующие (с сообщениями, уже
 * пришедшими из поллинга во время монтирования) не трогает, добавляет только
 * отсутствующие и всегда с пустой историей.
 * @param {object[]} chats — текущее состояние
 * @param {{chatId: string, title: string, phone: string}[]} saved — из storage
 * @returns {object[]}
 */
export function mergeRestored(chats, saved) {
  const result = [...chats];
  for (const c of saved) {
    if (result.some((ch) => ch.chatId === c.chatId)) continue;
    result.push({
      chatId: c.chatId,
      title: c.title,
      phone: c.phone,
      messages: [],
    });
  }
  return result;
}

/**
 * Добавляет входящее сообщение нужному чату (создаёт чат, если такого нет).
 * Дедуп по idMessage: повторный вебхук/доставка безвредны.
 * @param {object[]} chats
 * @param {object} message — из extractTextMessage
 * @returns {object[]}
 */
export function appendIncoming(chats, message) {
  const msg = { ...message, direction: "in", status: "received" };
  const i = chats.findIndex((c) => c.chatId === message.chatId);
  if (i < 0) {
    return [
      {
        chatId: message.chatId,
        title: message.senderName,
        phone: message.phone,
        messages: [msg],
      },
      ...chats,
    ];
  }
  if (chats[i].messages.some((m) => m.idMessage === message.idMessage))
    return chats;
  const next = [...chats];
  next[i] = { ...chats[i], messages: [...chats[i].messages, msg] };
  return next;
}

/**
 * Добавляет своё (исходящее) сообщение «в полёте» со статусом sending.
 * @param {object[]} chats
 * @param {string} chatId
 * @param {object} message — из makeLocalMessage
 * @returns {object[]}
 */
export function appendOutgoing(chats, chatId, message) {
  const msg = { ...message, direction: "out", status: "sending" };
  const i = chats.findIndex((c) => c.chatId === chatId);
  if (i < 0) {
    return [{ chatId, title: chatId, messages: [msg] }, ...chats];
  }
  const next = [...chats];
  next[i] = { ...chats[i], messages: [...chats[i].messages, msg] };
  return next;
}

/**
 * Патчит сообщение по idMessage: меняет статус (sending→sent/read/failed),
 * подставляет реальный idMessage из ответа sendMessage.
 * @param {object[]} chats
 * @param {string} chatId
 * @param {string} idMessage
 * @param {object} patch — например {status:"sent", idMessage:"176…"}
 * @returns {object[]}
 */
export function updateMessage(chats, chatId, idMessage, patch) {
  return chats.map((chat) =>
    chat.chatId !== chatId
      ? chat
      : {
          ...chat,
          messages: chat.messages.map((m) =>
            m.idMessage === idMessage ? { ...m, ...patch } : m,
          ),
        },
  );
}

/**
 * Вливает историю (GetChatHistory, новые сверху) в существующие сообщения:
 * дедуп по idMessage (существующие побеждают), добираем недостающие и
 * сортируем по возрастанию timestamp. Стабильная сортировка оставляет
 * локальные/поллинговые сообщения первыми при равном времени.
 * @param {object[]} messages — текущие сообщения чата
 * @param {object[]} history — из historyToMessages
 * @returns {object[]}
 */
export function mergeHistory(messages, history) {
  const seen = new Set(messages.map((m) => m.idMessage));
  const missing = history.filter((m) => !seen.has(m.idMessage));
  return [...messages, ...missing].sort((a, b) => a.timestamp - b.timestamp);
}
