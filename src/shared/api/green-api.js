// HTTP-клиент GREEN-API (MAX) — слой shared/api.
//
// Единственное место, которое знает про сеть: формирование URL, метод,
// заголовки, таймауты, разбор ошибок (включая квоты тарифа «Разработчик»).
// Ниже по слоям (entities/features/...) клиент используется как зависимость,
// инжектируемая через createGreenApi({...}).
//
// Документация API: https://green-api.com/v3/docs/api/sending/SendMessage/

import { normalizePhone } from "../lib/phone.js";

export const API_URL = "https://api.green-api.com";

/**
 * Проверяет HTTP-статус и бросает человекочитаемую ошибку.
 * @param {Response} res
 * @param {string} action — действие, к которому относится ошибка («Отправка сообщения»)
 */
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
/**
 * Человекочитаемое описание квоты из тела 466-ответа (пусто, если лимитов нет).
 * @param {object} body
 * @returns {string}
 */
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

/**
 * Как assertOk, но сперва читает тело, чтобы 466 (квота) превратить в понятное
 * сообщение, а не голый код. Должен вызываться ДО res.json().
 * @param {Response} res
 * @param {string} action
 */
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

/**
 * Создаёт клиент GREEN-API. fetchImpl инжектируется для тестов.
 * @param {{idInstance: string, apiTokenInstance: string, apiUrl?: string}} config
 * @param {Function} [fetchImpl]
 * @returns {{
 *   getStateInstance(): Promise<string>,
 *   sendMessage(chatId, message): Promise<string>,
 *   checkAccount(phone): Promise<string>,
 *   getContactInfo(chatId): Promise<{chatId, name, phoneNumber}>,
 *   getChats(): Promise<object[]>,
 *   getChatHistory(chatId, count): Promise<object[]>,
 *   receiveNotification(): Promise<{receiptId, body}|null>,
 *   deleteNotification(receiptId): Promise<void>
 * }}
 */
export function createGreenApi(
  { idInstance, apiTokenInstance, apiUrl = API_URL },
  fetchImpl = fetch,
) {
  // apiTokenInstance идёт СРАЗУ после метода; доп. сегменты (receiptId у
  // deleteNotification) — ПОСЛЕ токена: .../deleteNotification/{token}/{receiptId}.
  const url = (method, ...parts) =>
    `${apiUrl}/waInstance${idInstance}/${method}/${[apiTokenInstance, ...parts].join("/")}`;

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
      return data.chatId;
    },

    // Refresh chat info (name) for a chatId, e.g. when restoring chats.
    async getContactInfo(chatId) {
      let res;
      try {
        res = await fetchImpl(url("getContactInfo"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Информация о контакте", err);
      }
      await assertOkQuota(res, "Информация о контакте");
      const data = await res.json();
      return {
        chatId: data.chatId || chatId,
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

    // Instance settings: which notification types the instance emits and
    // whether a custom webhookUrl is set (must be empty for HTTP-API polling).
    async getSettings() {
      let res;
      try {
        res = await fetchImpl(url("getSettings"), {
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Настройки инстанса", err);
      }
      assertOk(res, "Настройки инстанса");
      return await res.json();
    },

    // Enable incoming/outgoing/state notifications and clear webhookUrl so the
    // FIFO HTTP-API queue actually receives messages (docs: «Получение
    // уведомлений через HTTP API» — настройка инстанса обязательна).
    async setSettings(settings) {
      let res;
      try {
        res = await fetchImpl(url("setSettings"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        throw friendlyNetworkError("Настройки инстанса", err);
      }
      await assertOkQuota(res, "Настройки инстанса");
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
          body: JSON.stringify({ chatId, count }),
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

// receiveNotification returns either a JSON object or the literal "null"
// (queue empty). Normalize whatever came back.
/**
 * Приводит тело ответа receiveNotification к объекту или null: парсит
 * строковый JSON, в том числе завёрнутый в строку ещё раз (двойное кодирование).
 * @param {*} body
 * @returns {object|null}
 */
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

function friendlyNetworkError(action, err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new Error(
      `${action}: сервер не ответил за 20 секунд. Попробуйте ещё раз.`,
    );
  }
  // CORS-bloc surfaces as a generic TypeError("Failed to fetch") — explain it
  // instead of showing a raw network error.
  return new Error(
    `${action}: не удалось подключиться к API. Возможно, GREEN-API блокирует запросы из браузера (CORS) — попробуйте Vite-прокси из README.`,
  );
}
