// GREEN-API MAX client (v3, HTTP API) + pure helpers.
// Docs: https://green-api.com/v3/docs/api/sending/SendMessage/  (receiving: .../api/receiving/)

export const API_URL = "https://api.green-api.com";

// MAX accepts only RF (7) and RB (375) phone numbers.
//  8XXXXXXXXXX (RF style) -> 7XXXXXXXXXX  ("8" is the local RF trunk prefix)
//  10 digits               -> 7XXXXXXXXXX  (local number without country code)
//  Anything else: pass digits through as-is.
export function normalizePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    return "7" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "7" + digits;
  }
  return digits;
}

// chatId from the API may omit the "@c.us" suffix — add it back.
export function withChatSuffix(chatId) {
  if (!chatId) return "";
  return chatId.includes("@") ? chatId : chatId + "@c.us";
}

export function withoutChatSuffix(chatId) {
  return String(chatId ?? "").replace(/@\w+\.us$/, "");
}

// Parse the body of an incoming-message notification into a plain message
// object, or return null for anything we should not display.
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

// receiveNotification returns either a JSON object or the literal "null"
// (queue empty). Normalize whatever came back.
export function normalizeNotificationBody(body) {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

export function appendChat(chats, chatId, title, phone = "") {
  if (chats.some((c) => c.chatId === chatId)) return chats;
  return [{ chatId, title, phone, messages: [] }, ...chats];
}

// Merge restored chats from sessionStorage into the in-memory list: existing
// chats (any messages the poll already appended) win, only missing ones are
// added. Runs on mount; never replaces what the poll has seen.
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

// Map GetChatHistory items (newest-first) to our message shape. The app is
// text-only, so non-text messages and empty texts are dropped.
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

// Merge fetched history (newest-first) into a chat's existing messages:
// dedup by idMessage (existing wins), append missing, then sort ascending by
// timestamp. Stable sort keeps local/poll messages first on timestamp ties.
export function mergeHistory(messages, history) {
  const seen = new Set(messages.map((m) => m.idMessage));
  const missing = history.filter((m) => !seen.has(m.idMessage));
  return [...messages, ...missing].sort((a, b) => a.timestamp - b.timestamp);
}

export function assertOk(res, action) {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${action}: неверный idInstance или apiTokenInstance.`);
    }
    if (res.status === 429) {
      throw new Error(`${action}: слишком много запросов — подождите немного.`);
    }
    throw new Error(`${action}: сервер ответил ошибкой ${res.status}.`);
  }
}

// GREEN-API Developer tariff: 466 = monthly quota exceeded, body carries
// per-method (invokeStatus) and per-chat (correspondentsStatus) limits.
export function quotaErrorMsg(body = {}) {
  const parts = [];
  const inv = body.invokeStatus;
  if (inv?.status === "QUOTE_EXCEEDED" && inv.total) {
    parts.push(`метод ${inv.method}: ${inv.used}/${inv.total}`);
  }
  const corr = body.correspondentsStatus;
  if (corr?.status === "QUOTE_EXCEEDED" && corr.total) {
    parts.push(`чаты: ${corr.used}/${corr.total}`);
  }
  return parts.join("; ");
}

// Like assertOk, but reads the body so 466 (quota) becomes a human message
// instead of a bare status code. Must be awaited before res.json().
export async function assertOkQuota(res, action) {
  if (res.ok) return;
  let body = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  if (res.status === 466 && body) {
    const detail = quotaErrorMsg(body);
    if (detail) {
      throw new Error(
        `${action}: достигнут месячный лимит тарифа Developer (${detail}). Увеличьте тариф в кабинете console.green-api.com.`,
      );
    }
  }
  assertOk(res, action);
}

export function createGreenApi(
  { idInstance, apiTokenInstance, apiUrl = API_URL },
  fetchImpl = fetch,
) {
  const url = (method, ...parts) =>
    `${apiUrl}/waInstance${idInstance}/${method}/${[...parts, apiTokenInstance].join("/")}`;

  return {
    async getStateInstance() {
      let res;
      try {
        res = await fetchImpl(url("getStateInstance"), {
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Проверка логина", err);
      }
      assertOk(res, "Проверка логина");
      const data = await res.json();
      if (data?.stateInstance !== "authorized") {
        throw new Error(
          `Аккаунт не авторизован (${data?.stateInstance ?? "неизвестно"}). Проверьте пару idInstance / apiTokenInstance.`,
        );
      }
      return data.stateInstance;
    },

    async sendMessage(chatId, message) {
      let res;
      try {
        res = await fetchImpl(url("sendMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, message }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Отправка сообщения", err);
      }
      await assertOkQuota(res, "Отправка сообщения");
      const data = await res.json();
      return data?.idMessage ?? "sent";
    },

    // Resolve a phone number to a MAX chatId (required before you can send:
    // MAX chatIds are numeric account ids, not phone numbers).
    async checkAccount(phone) {
      const phoneNumber = normalizePhone(phone);
      let res;
      try {
        res = await fetchImpl(url("checkAccount"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: Number(phoneNumber) }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Проверка номера", err);
      }
      await assertOkQuota(res, "Проверка номера");
      const data = await res.json();
      if (data?.status === false && data?.reason) {
        throw new Error(`Проверка номера: ${data.reason}`);
      }
      if (!data?.exist) {
        throw new Error("Этот номер не зарегистрирован в MAX.");
      }
      return withChatSuffix(data.chatId);
    },

    // Refresh chat info (name) for a chatId, e.g. when restoring chats.
    async getContactInfo(chatId) {
      let res;
      try {
        res = await fetchImpl(url("getContactInfo"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: withoutChatSuffix(chatId) }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Информация о контакте", err);
      }
      await assertOkQuota(res, "Информация о контакте");
      const data = await res.json();
      return {
        chatId: withChatSuffix(data.chatId || chatId),
        name: data?.name || "",
        phoneNumber: data?.phoneNumber || 0,
      };
    },

    // Full chat list of the instance (used when restoring from sessionStorage).
    async getChats() {
      let res;
      try {
        res = await fetchImpl(url("getChats"), {
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Список чатов", err);
      }
      await assertOkQuota(res, "Список чатов");
      return await res.json();
    },

    // Message history of a chat, newest-first (GetChatHistory returns
    // items sorted by timestamp descending). Rate limit: 1 rps.
    async getChatHistory(chatId, count = 100) {
      let res;
      try {
        res = await fetchImpl(url("getChatHistory"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: withoutChatSuffix(chatId), count }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("История чата", err);
      }
      await assertOkQuota(res, "История чата");
      return await res.json();
    },

    async receiveNotification() {
      let res;
      try {
        res = await fetchImpl(url("receiveNotification"), {
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Получение уведомлений", err);
      }
      const text = await res.text();
      // ReceiveNotification fails with this 400 when a custom webhookUrl is set
      // in the cabinet — the most common "nothing arrives" misconfiguration.
      if (!res.ok && res.status === 400) {
        const detail = normalizeNotificationBody(text);
        const reason = String(
          detail?.message ?? detail?.details ?? "",
        ).toLowerCase();
        if (reason.includes("custom webhook url")) {
          throw new Error(
            "Приём сообщений отключён: в настройках инстанса задан webhookUrl. Очистите его в личном кабинете GREEN-API и подождите минуту.",
          );
        }
      }
      if (!res.ok && res.status === 466) {
        const detail = quotaErrorMsg(normalizeNotificationBody(text));
        if (detail) {
          throw new Error(
            `Получение уведомлений: достигнут месячный лимит тарифа Developer (${detail}). Увеличьте тариф в кабинете console.green-api.com.`,
          );
        }
      }
      assertOk(res, "Получение уведомлений");
      const body = normalizeNotificationBody(text);
      if (!body) return null;
      // Some GREEN-API builds double-encode body as a JSON string — normalize both.
      return {
        receiptId: body.receiptId,
        body: normalizeNotificationBody(body.body),
      };
    },

    async deleteNotification(receiptId) {
      let res;
      try {
        res = await fetchImpl(url("deleteNotification", String(receiptId)), {
          method: "DELETE", // fetch defaults to GET — GREEN-API requires DELETE here
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        return; // best-effort: a failed delete means the receipt is re-delivered (dedup handles it)
      }
      assertOk(res, "Удаление уведомления");
    },
  };
}

function friendlyNetworkError(action, err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new Error(
      `${action}: сервер не ответил за 20 секунд. Попробуйте ещё раз.`,
    );
  }
  // ponytailless exception: CORS block surfaces as a TypeError("Failed to fetch").
  return new Error(
    `${action}: не удалось подключиться к API. Возможно, GREEN-API блокирует запросы из браузера (CORS) — попробуйте Vite-прокси из README.`,
  );
}
