import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextMessage,
  historyToMessages,
  makeLocalMessage,
} from "../../src/entities/message/index.js";

test("extractTextMessage парсит входящий вебхук и игнорирует остальное", () => {
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
  assert.equal(msg.timestamp, 1763115112); // секунды, как у API

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

test("historyToMessages маппит GetChatHistory, только текст", () => {
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
  assert.equal(msgs.length, 3); // h1, h2, h5 — не-текст/пустые отброшены
  assert.equal(msgs[0].direction, "out");
  assert.equal(msgs[0].status, "delivered");
  assert.equal(msgs[0].chatId, "10000000@c.us"); // суффикс добавлен
  assert.equal(msgs[1].direction, "in");
  assert.equal(msgs[1].status, "received");
  assert.equal(msgs[1].senderName, "Иван");
  assert.equal(msgs[1].chatId, "10000000@c.us"); // уже с суффиксом — как есть
  assert.deepEqual(historyToMessages(null), []);
});

test("makeLocalMessage создаёт локальное сообщение в СЕКУНДАХ", () => {
  const before = Math.floor(Date.now() / 1000);
  const msg = makeLocalMessage("Привет", "local-1");
  const after = Math.floor(Date.now() / 1000);
  assert.equal(msg.idMessage, "local-1");
  assert.equal(msg.text, "Привет");
  assert.ok(msg.timestamp >= before && msg.timestamp <= after); // секунды
  assert.ok(msg.timestamp < Date.now(), "timestamp не в миллисекундах");
});
