import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGreenApi,
  assertOk,
  assertOkQuota,
  quotaErrorMsg,
  normalizeNotificationBody,
} from "../../src/shared/api/green-api.js";

test("createGreenApi строит корректные URL, метод и тело", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return {
      ok: true,
      status: 200,
      async json() {
        return { idMessage: "m1" };
      },
      async text() {
        return "null";
      },
    };
  };
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    fetchImpl,
  );

  const sent = await api.sendMessage("79991234567@c.us", "Привет");
  assert.equal(sent, "m1");
  assert.equal(
    calls[0][0],
    "https://api.green-api.com/waInstance1101/sendMessage/tok",
  );
  assert.equal(calls[0][1].method, "POST");
  assert.equal(
    calls[0][1].body,
    JSON.stringify({ chatId: "79991234567@c.us", message: "Привет" }),
  );

  const n = await api.receiveNotification();
  assert.equal(n, null); // "null" body -> no notification

  await api.deleteNotification(42);
  assert.equal(
    calls.at(-1)[0],
    "https://api.green-api.com/waInstance1101/deleteNotification/42/tok",
  );
  assert.equal(
    calls.at(-1)[1].method,
    "DELETE", // GET would never advance the FIFO queue
  );
});

test("checkAccount resolves a phone to a MAX chatId", async () => {
  const calls = [];
  const json = async () => ({
    exist: true,
    chatId: "10000000",
    fromCache: true,
  });
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        async json() {
          return json();
        },
      };
    },
  );

  const chatId = await api.checkAccount("89991234567"); // 8-format input
  assert.equal(chatId, "10000000@c.us"); // suffix added, numeric MAX id
  assert.equal(
    calls[0][0],
    "https://api.green-api.com/waInstance1101/checkAccount/tok",
  );
  assert.equal(calls[0][1].method, "POST");
  assert.equal(
    JSON.parse(calls[0][1].body).phoneNumber,
    79991234567, // normalized to 7-format before sending
  );

  const missing = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    async () => ({
      ok: true,
      status: 200,
      async json() {
        return { exist: false, chatId: "", fromCache: false };
      },
    }),
  );
  await assert.rejects(
    () => missing.checkAccount("79990000000"),
    /не зарегистрирован/,
  );
});

test("getContactInfo posts chatId and normalizes the returned id", async () => {
  const calls = [];
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            chatId: "10000000",
            name: "Ходабрыш",
            phoneNumber: 79876543210,
          };
        },
      };
    },
  );
  const info = await api.getContactInfo("10000000@c.us");
  assert.equal(
    calls[0][0],
    "https://api.green-api.com/waInstance1101/getContactInfo/tok",
  );
  assert.equal(calls[0][1].method, "POST");
  assert.equal(JSON.parse(calls[0][1].body).chatId, "10000000"); // suffix stripped
  assert.equal(info.chatId, "10000000@c.us"); // suffix re-added
  assert.equal(info.name, "Ходабрыш");
});

test("getChats returns the instance chat list", async () => {
  const calls = [];
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        async json() {
          return [
            { chatId: "10000000", name: "Ходабрыш", type: "user" },
            { chatId: "10000001", name: "Иван", type: "user" },
          ];
        },
      };
    },
  );
  const chats = await api.getChats();
  assert.equal(
    calls[0][0],
    "https://api.green-api.com/waInstance1101/getChats/tok",
  );
  assert.equal(chats.length, 2);
  assert.equal(chats[0].name, "Ходабрыш");
});

test("getChatHistory posts chatId with count, strips the suffix", async () => {
  const calls = [];
  const items = [
    {
      type: "outgoing",
      idMessage: "h1",
      timestamp: 1,
      typeMessage: "textMessage",
      textMessage: "Привет",
    },
  ];
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        async json() {
          return items;
        },
      };
    },
  );
  const history = await api.getChatHistory("10000000@c.us", 100);
  assert.equal(
    calls[0][0],
    "https://api.green-api.com/waInstance1101/getChatHistory/tok",
  );
  assert.equal(calls[0][1].method, "POST");
  assert.equal(JSON.parse(calls[0][1].body).chatId, "10000000"); // suffix stripped
  assert.equal(JSON.parse(calls[0][1].body).count, 100);
  assert.equal(history, items);
});

test("receive pipeline survives double-encoded bodies and advances the queue", async () => {
  const webhook = {
    typeWebhook: "incomingMessageReceived",
    idMessage: "m1",
    timestamp: 1000,
    senderData: { chatId: "79991234567", senderName: "Иван" },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: "Привет" },
    },
  };
  const queue = [
    JSON.stringify({ receiptId: 1, body: webhook }), // object body
    JSON.stringify({ receiptId: 2, body: JSON.stringify(webhook) }), // double-encoded string
    "null",
  ];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return queue.shift();
    },
  });
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "tok" },
    fetchImpl,
  );

  const n1 = await api.receiveNotification();
  assert.equal(n1.receiptId, 1);
  assert.equal(n1.body.typeWebhook, "incomingMessageReceived");

  const n2 = await api.receiveNotification();
  assert.equal(n2.receiptId, 2);
  assert.equal(n2.body.idMessage, "m1"); // double-encoding normalized

  assert.equal(await api.receiveNotification(), null);
});

test("quotaErrorMsg/assertOkQuota: 466 → человекочитаемое сообщение", async () => {
  // Голый парсер без сети.
  assert.equal(
    quotaErrorMsg({
      invokeStatus: {
        method: "sendMessage",
        used: 100,
        total: 100,
        status: "QUOTE_EXCEEDED",
      },
      correspondentsStatus: { used: 3, total: 3, status: "QUOTE_EXCEEDED" },
    }),
    "метод sendMessage: 100/100; чаты: 3/3",
  );
  assert.equal(quotaErrorMsg({}), "");

  // assertOkQuota: 2xx — проход; 466 с телом — квота.
  await assertOkQuota({ ok: true }, "тест");
  await assert.rejects(
    async () =>
      assertOkQuota(
        {
          ok: false,
          status: 466,
          async text() {
            return JSON.stringify({
              invokeStatus: {
                method: "checkAccount",
                used: 100,
                total: 100,
                status: "QUOTE_EXCEEDED",
              },
            });
          },
        },
        "Проверка номера",
      ),
    /месячный лимит тарифа Developer \(метод checkAccount: 100\/100\).*/,
  );
});

test("assertOk maps 401/403/429/прочее на понятные ошибки", async () => {
  assertOk({ ok: true }, "тест");
  await assert.rejects(
    async () => assertOk({ ok: false, status: 429 }, "тест"),
    /слишком много/,
  );
  await assert.rejects(
    async () => assertOk({ ok: false, status: 500 }, "тест"),
    /500/,
  );
  await assert.rejects(
    async () => assertOk({ ok: false, status: 401 }, "тест"),
    /неверный idInstance/,
  );
});

test("createGreenApi превращает сетевые сбои в дружелюбные ошибки", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  const api = createGreenApi(
    { idInstance: "1101", apiTokenInstance: "bad" },
    fetchImpl,
  );
  await assert.rejects(
    () => api.getStateInstance(),
    /неверный idInstance или apiTokenInstance/,
  );
});

test("normalizeNotificationBody: парсит строку, объект пропускает, мусор → null", () => {
  assert.equal(normalizeNotificationBody("null"), null);
  assert.equal(normalizeNotificationBody(null), null);
  const obj = { receiptId: 1, body: {} };
  assert.equal(normalizeNotificationBody(obj), obj);
  const parsed = normalizeNotificationBody(JSON.stringify(obj));
  assert.equal(parsed.receiptId, 1);
});
