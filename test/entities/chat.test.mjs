import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendChat,
  mergeRestored,
  appendIncoming,
  appendOutgoing,
  updateMessage,
  mergeHistory,
} from "../../src/entities/chat/index.js";

test("appendChat создаёт пустой чат и не дублирует", () => {
  const once = appendChat([], "79991234567@c.us", "79991234567");
  assert.equal(once.length, 1);
  assert.equal(once[0].title, "79991234567");
  assert.equal(once[0].messages.length, 0);
  assert.equal(appendChat(once, "79991234567@c.us", "другое"), once);
  const two = appendChat(once, "79991112233@c.us", "x");
  assert.equal(two.length, 2);
});

test("mergeRestored добавляет недостающие чаты, существующие не трогает", () => {
  const existing = appendChat([], "10000000@c.us", "Иван", "79991234567");
  const withMsg = appendIncoming(existing, {
    idMessage: "in1",
    chatId: "10000000@c.us",
    senderName: "Иван",
    phone: "79991234567",
    text: "Привет",
    timestamp: 1,
  });
  // Восстановление идёт после того, как поллинг уже добавил сообщение в чат:
  // сообщение должно уцелеть, добавится только недостающий чат.
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

test("appendIncoming создаёт чат и дедуплицирует по idMessage", () => {
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

  const again = appendIncoming(once, msg); // тот же id -> та же ссылка
  assert.equal(again, once);

  const second = appendIncoming(once, {
    ...msg,
    idMessage: "2",
    text: "Как дела?",
  });
  assert.equal(second[0].messages.length, 2);
});

test("appendOutgoing + updateMessage отслеживают жизненный цикл отправки", () => {
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

test("mergeHistory дедуплицирует, сортирует по времени, существующие впереди", () => {
  const existing = [
    { idMessage: "a", text: "старое", timestamp: 300 },
    { idMessage: "b", text: "новое", timestamp: 500 },
  ];
  // История приходит от API НОВЫМИ сверху.
  const history = [
    { idMessage: "b", text: "новое", timestamp: 500 }, // дубль — победит существующее
    { idMessage: "c", text: "середина", timestamp: 400 },
    { idMessage: "a", text: "старое", timestamp: 300 }, // дубль с тем же временем
  ];
  const merged = mergeHistory(existing, history);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((m) => m.idMessage), ["a", "c", "b"]); // по возрастанию
  assert.equal(merged[0], existing[0]); // существующее сохранено как есть
  assert.equal(merged[2], existing[1]);

  // Равные timestamp: стабильная сортировка оставляет существующее первым.
  const tied = mergeHistory(
    [{ idMessage: "x", timestamp: 1 }],
    [
      { idMessage: "y", timestamp: 1 },
      { idMessage: "x", timestamp: 1 },
    ],
  );
  assert.deepEqual(tied.map((m) => m.idMessage), ["x", "y"]);
});
