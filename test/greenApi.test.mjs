import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone,
  withChatSuffix,
  withoutChatSuffix,
  extractTextMessage,
  normalizeNotificationBody,
  appendChat,
  mergeRestored,
  appendIncoming,
  appendOutgoing,
  updateMessage,
  historyToMessages,
  mergeHistory,
  assertOk,
  assertOkQuota,
  quotaErrorMsg,
  createGreenApi,
} from "../src/greenApi.js";

test("normalizePhone normalizes RF phone numbers for CheckAccount", () => {
  assert.equal(normalizePhone("89991234567"), "79991234567"); // 8-format
  assert.equal(normalizePhone("+7 999 123-45-67"), "79991234567");
  assert.equal(normalizePhone("9991234567"), "79991234567"); // bare 10 digits
  assert.equal(normalizePhone("375291234567"), "375291234567"); // RB passthrough
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");
});

test("withChatSuffix appends @c.us only when missing", () => {
  assert.equal(withChatSuffix("10000000"), "10000000@c.us");
  assert.equal(withChatSuffix("10000000@c.us"), "10000000@c.us");
  assert.equal(withChatSuffix(""), "");
  assert.equal(withoutChatSuffix("10000000@c.us"), "10000000");
  assert.equal(withoutChatSuffix("10000000"), "10000000");
});

test("quotaErrorMsg parses 466 bodies; assertOkQuota throws friendly message", async () => {
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

  await assertOkQuota({ ok: true }, "тест"); // passes through
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

test("extractTextMessage parses incoming text webhook and ignores others", () => {
  const body = {
    typeWebhook: "incomingMessageReceived",
    idMessage: "1763115112345",
    timestamp: 1763115112,
    senderData: { chatId: "10000000", senderName: "Иван" },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: "Привет!" },
    },
  };
  const msg = extractTextMessage(body);
  assert.equal(msg.idMessage, "1763115112345");
  assert.equal(msg.chatId, "10000000@c.us");
  assert.equal(msg.senderName, "Иван");
  assert.equal(msg.text, "Привет!");

  assert.equal(
    extractTextMessage({ typeWebhook: "stateInstanceChanged" }),
    null,
  ); // status webhook
  assert.equal(
    extractTextMessage({
      ...body,
      messageData: { typeMessage: "outgoingMessageReceived" },
    }),
    null,
  );
  assert.equal(extractTextMessage(null), null);
  assert.equal(
    extractTextMessage({
      typeWebhook: "incomingMessageReceived",
      messageData: { typeMessage: "textMessage", textMessageData: {} },
    }),
    null,
  ); // empty text
});

test("normalizeNotificationBody parses string or passes object through", () => {
  assert.equal(normalizeNotificationBody("null"), null);
  assert.equal(normalizeNotificationBody(null), null);
  const obj = { receiptId: 1, body: {} };
  assert.equal(normalizeNotificationBody(obj), obj);
  const parsed = normalizeNotificationBody(JSON.stringify(obj));
  assert.equal(parsed.receiptId, 1);
});

test("mergeRestored adds missing chats without touching existing ones", () => {
  const existing = appendChat([], "10000000@c.us", "Иван", "79991234567");
  const withMsg = appendIncoming(existing, {
    idMessage: "in1",
    chatId: "10000000@c.us",
    senderName: "Иван",
    phone: "79991234567",
    text: "Привет",
    timestamp: 1,
  });
  // Restore runs after the poll already appended a message to the same chat:
  // the message must survive, only the missing chat is added.
  const merged = mergeRestored(withMsg, [
    { chatId: "10000000@c.us", title: "Иван", phone: "79991234567" },
    { chatId: "10000001@c.us", title: "Пётр", phone: "79990000000" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].messages[0].idMessage, "in1"); // preserved
  assert.deepEqual(merged[1], {
    chatId: "10000001@c.us",
    title: "Пётр",
    phone: "79990000000",
    messages: [],
  });
});

test("appendChat creates an empty chat and never duplicates", () => {
  const once = appendChat([], "79991234567@c.us", "79991234567");
  assert.equal(once.length, 1);
  assert.equal(once[0].title, "79991234567");
  assert.equal(once[0].messages.length, 0);
  assert.equal(appendChat(once, "79991234567@c.us", "другое"), once);
  const two = appendChat(once, "79991112233@c.us", "x");
  assert.equal(two.length, 2);
});

test("appendIncoming creates a chat and dedups by idMessage", () => {
  const msg = {
    idMessage: "1",
    chatId: "79991234567@c.us",
    senderName: "Иван",
    text: "Привет",
    timestamp: 100,
  };
  const once = appendIncoming([], msg);
  assert.equal(once.length, 1);
  assert.equal(once[0].title, "Иван");
  assert.equal(once[0].messages[0].direction, "in");

  const again = appendIncoming(once, msg); // same id -> unchanged reference
  assert.equal(again, once);

  const second = appendIncoming(once, {
    ...msg,
    idMessage: "2",
    text: "Как дела?",
  });
  assert.equal(second[0].messages.length, 2);
});

test("appendOutgoing + updateMessage track send lifecycle", () => {
  const chats = appendOutgoing([], "79991234567@c.us", {
    idMessage: "local-1",
    text: "Тест",
    timestamp: 1,
  });
  const msg = chats[0].messages[0];
  assert.equal(msg.direction, "out");
  assert.equal(msg.status, "sending");

  const done = updateMessage(chats, "79991234567@c.us", "local-1", {
    idMessage: "real-1",
    status: "sent",
  });
  assert.equal(done[0].messages[0].status, "sent");
  assert.equal(done[0].messages[0].idMessage, "real-1");

  const failed = updateMessage(chats, "79991234567@c.us", "local-1", {
    status: "failed",
  });
  assert.equal(failed[0].messages[0].status, "failed");
});

test("createGreenApi builds correct URLs and handles http errors", async () => {
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

  await api.sendMessage("79991234567@c.us", "Привет");
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
  assert.equal(extractTextMessage(n1.body).text, "Привет");

  const n2 = await api.receiveNotification();
  assert.equal(n2.receiptId, 2);
  assert.equal(extractTextMessage(n2.body).text, "Привет");

  assert.equal(await api.receiveNotification(), null);
});

test("createGreenApi surfaces friendly errors", async () => {
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

test("assertOk passes on 2xx and throws with status otherwise", async () => {
  assertOk({ ok: true }, "тест");
  await assert.rejects(
    async () => assertOk({ ok: false, status: 429 }, "тест"),
    /слишком много/,
  );
  await assert.rejects(
    async () => assertOk({ ok: false, status: 500 }, "тест"),
    /500/,
  );
});

test("historyToMessages maps GetChatHistory items, text-only", () => {
  const items = [
    {
      type: "outgoing",
      idMessage: "h1",
      timestamp: 200,
      statusMessage: "delivered",
      typeMessage: "textMessage",
      chatId: "10000000",
      textMessage: "Привет!",
    },
    {
      type: "incoming",
      idMessage: "h2",
      timestamp: 100,
      typeMessage: "textMessage",
      chatId: "10000000@c.us",
      senderName: "Иван",
      textMessage: "Здравствуй",
    },
    {
      type: "incoming",
      idMessage: "h3",
      timestamp: 50,
      typeMessage: "extendedTextMessage",
      textMessage: "x",
    },
    {
      type: "incoming",
      idMessage: "h4",
      timestamp: 40,
      typeMessage: "textMessage",
      textMessage: "",
    },
    {
      type: "outgoing",
      idMessage: "h5",
      typeMessage: "textMessage",
      chatId: "10000000",
      textMessage: "пусто",
    },
  ];
  const msgs = historyToMessages(items);
  assert.equal(msgs.length, 3); // h1, h2, h5 — non-text/empty dropped
  assert.equal(msgs[0].direction, "out");
  assert.equal(msgs[0].status, "delivered");
  assert.equal(msgs[0].chatId, "10000000@c.us"); // suffix added
  assert.equal(msgs[1].direction, "in");
  assert.equal(msgs[1].status, "received");
  assert.equal(msgs[1].senderName, "Иван");
  assert.equal(msgs[1].chatId, "10000000@c.us"); // already-suffixed kept
  assert.deepEqual(historyToMessages(null), []);
});

test("mergeHistory dedups by idMessage, ascending with existing first", () => {
  const existing = [
    { idMessage: "a", text: "старое", timestamp: 300 },
    { idMessage: "b", text: "новое", timestamp: 500 },
  ];
  // History comes newest-first (API order).
  const history = [
    { idMessage: "b", text: "новое", timestamp: 500 }, // dup — existing wins
    { idMessage: "c", text: "середина", timestamp: 400 },
    { idMessage: "a", text: "старое", timestamp: 300 }, // dup with same ts
  ];
  const merged = mergeHistory(existing, history);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((m) => m.idMessage),
    ["a", "c", "b"], // ascending by timestamp
  );
  assert.equal(merged[0], existing[0]); // existing identity preserved
  assert.equal(merged[2], existing[1]);
  // Same timestamp: existing stays first (stable sort).
  const tied = mergeHistory(
    [{ idMessage: "x", timestamp: 1 }],
    [
      { idMessage: "y", timestamp: 1 },
      { idMessage: "x", timestamp: 1 },
    ],
  );
  assert.deepEqual(
    tied.map((m) => m.idMessage),
    ["x", "y"],
  );
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
