import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatsKey,
  loadChats,
  saveChats,
  clearChats,
} from "../../src/shared/lib/chats-storage.js";

// Фейковое хранилище — sessionStorage в node-тестах нет.
function fakeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("chats-storage: round-trip сохраняет только id/телефон/имя", () => {
  const storage = fakeStorage();
  const chats = [
    {
      chatId: "10000000@c.us",
      title: "Иван",
      phone: "79991234567",
      messages: [{ idMessage: "m1" }], // сообщения не должны попасть в storage
    },
  ];
  saveChats(storage, "1101", chats);

  assert.ok(storage.getItem(chatsKey("1101")).includes("10000000@c.us"));
  assert.ok(!storage.getItem(chatsKey("1101")).includes("m1")); // без истории
  assert.ok(!storage.getItem(chatsKey("1101")).includes("messages"));

  const loaded = loadChats(storage, "1101");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].chatId, "10000000@c.us");
  assert.equal(loaded[0].title, "Иван");
  assert.equal(loaded[0].phone, "79991234567");
  assert.equal(loaded[0].messages, undefined); // восстановление без истории
});

test("chats-storage: битые и пустые данные читаются как []", () => {
  const storage = fakeStorage();
  assert.deepEqual(loadChats(storage, "1101"), []); // ничего не сохранено
  storage.setItem(chatsKey("1101"), "{not json");
  assert.deepEqual(loadChats(storage, "1101"), []);
  storage.setItem(chatsKey("1101"), JSON.stringify([null, { title: "без id" }]));
  assert.deepEqual(loadChats(storage, "1101"), []); // отфильтровано
});

test("chats-storage: разные idInstance не пересекаются; clear удаляет", () => {
  const storage = fakeStorage();
  saveChats(storage, "1101", [{ chatId: "1@c.us", title: "A", phone: "" }]);
  assert.deepEqual(loadChats(storage, "1101"), [
    { chatId: "1@c.us", title: "A", phone: "" },
  ]);
  assert.deepEqual(loadChats(storage, "1102"), []);

  clearChats(storage, "1101");
  assert.deepEqual(loadChats(storage, "1101"), []);
});
