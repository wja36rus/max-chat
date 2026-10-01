import { test } from "node:test";
import assert from "node:assert/strict";
import { openChatByPhone, sendText } from "../../src/features/chat/actions.js";
import {
  refreshSavedChat,
  HISTORY_REQUEST_DELAY_MS,
} from "../../src/features/chat/restore.js";

// --- openChatByPhone ---

test("openChatByPhone резолвит номер через CheckAccount", async () => {
  const api = {
    async checkAccount(phone) {
      // openChatByPhone отдаёт цифры как есть; нормализацию 8→7 делает
      // сам клиент checkAccount (normalizePhone) — это не его забота.
      assert.equal(phone, "89991234567");
      return "10000000@c.us";
    },
  };
  const { chatId, phone } = await openChatByPhone(api, "89991234567");
  assert.equal(chatId, "10000000@c.us");
  assert.equal(phone, "89991234567");
});

test("openChatByPhone: пустой номер → понятная ошибка, API не дёргаем", async () => {
  let called = false;
  const api = {
    async checkAccount() {
      called = true;
      return "x@c.us";
    },
  };
  await assert.rejects(
    () => openChatByPhone(api, ""),
    /Введите номер телефона/,
  );
  assert.equal(called, false);
});

test("openChatByPhone прокидывает ошибку CheckAccount (нет аккаунта)", async () => {
  const api = {
    async checkAccount() {
      throw new Error("Этот номер не зарегистрирован в MAX.");
    },
  };
  await assert.rejects(
    () => openChatByPhone(api, "79990000000"),
    /не зарегистрирован/,
  );
});

// --- sendText ---

test("sendText: оптимистичная отправка → статус sent с реальным idMessage", async () => {
  let chats = [];
  const api = {
    async sendMessage(chatId, text) {
      // Композер уже отдаёт текст без пробелов по краям — sendText шлёт как есть.
      assert.equal(chatId, "1@c.us");
      assert.equal(text, "Привет");
      return "real-42";
    },
  };
  const setChats = (fn) => {
    chats = fn(chats);
  };
  let errorText = null;
  const onError = (t) => (errorText = t);

  const ok = await sendText({
    api,
    chatId: "1@c.us",
    text: "Привет",
    localId: "local-1",
    setChats,
    onError,
  });

  assert.equal(ok, true);
  assert.equal(errorText, null);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].messages[0].status, "sent");
  assert.equal(chats[0].messages[0].idMessage, "real-42");
});

test("sendText: ошибка API → статус failed, onError, false (черновик не теряем)", async () => {
  let chats = [];
  const api = {
    async sendMessage() {
      throw new Error("достигнут месячный лимит тарифа Developer");
    },
  };
  const setChats = (fn) => {
    chats = fn(chats);
  };
  const errors = [];
  const onError = (t) => errors.push(t);

  const ok = await sendText({
    api,
    chatId: "1@c.us",
    text: "Привет",
    localId: "local-1",
    setChats,
    onError,
  });

  assert.equal(ok, false);
  assert.equal(chats[0].messages[0].status, "failed");
  assert.equal(chats[0].messages[0].idMessage, "local-1"); // как было
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("Не отправлено"));
});

test("sendText: пустой/нет чата → false без вызова API", async () => {
  const api = {
    async sendMessage() {
      throw new Error("не должен зваться");
    },
  };
  const setChats = () => {};
  assert.equal(
    await sendText({
      api,
      chatId: "1@c.us",
      text: "   ",
      localId: "l",
      setChats,
    }),
    false,
  );
  assert.equal(
    await sendText({ api, chatId: null, text: "x", localId: "l", setChats }),
    false,
  );
});

// --- refreshSavedChat (restore) ---

test("refreshSavedChat: имя + история для живого чата", async () => {
  const api = {
    async getContactInfo(chatId) {
      return { chatId: "10000001@c.us", name: "Иван" };
    },
    async checkAccount() {
      throw new Error("не должен зваться");
    },
    async getChatHistory(chatId, count) {
      assert.equal(chatId, "10000001@c.us"); // история для ТЕКУЩЕГО chatId
      assert.equal(count, 100);
      return [
        {
          type: "incoming",
          idMessage: "h1",
          timestamp: 100,
          typeMessage: "textMessage",
          textMessage: "Привет",
        },
      ];
    },
  };

  const patch = await refreshSavedChat(api, {
    chatId: "10000000@c.us",
    title: "старое имя",
    phone: "79991234567",
  });
  assert.equal(patch.chatId, "10000001@c.us"); // ремап
  assert.equal(patch.title, "Иван");
  assert.equal(patch.messages.length, 1);
  assert.equal(patch.messages[0].text, "Привет");
  assert.equal(
    HISTORY_REQUEST_DELAY_MS,
    1200,
    "пауза 1.2 c — бюджет лимита 1 зап/с",
  );
});

test("refreshSavedChat: мёртвый chatId → фолбэк на checkAccount по номеру", async () => {
  const api = {
    async getContactInfo() {
      throw new Error("500");
    },
    async checkAccount(phone) {
      assert.equal(phone, "79991234567");
      return "20000000@c.us";
    },
    async getChatHistory(chatId) {
      assert.equal(chatId, "20000000@c.us");
      return [];
    },
  };
  const patch = await refreshSavedChat(api, {
    chatId: "10000000@c.us",
    title: "старое имя",
    phone: "79991234567",
  });
  assert.equal(patch.chatId, "20000000@c.us");
  assert.equal(patch.title, "старое имя"); // имя не обновилось — не было данных
  assert.equal(patch.messages, undefined); // история пустая
});

test("refreshSavedChat: тихий сбой истории (квота 466/429) → нет messages", async () => {
  const api = {
    async getContactInfo(chatId) {
      return { chatId, name: "Иван" };
    },
    async getChatHistory() {
      throw new Error(
        "История чата: слишком много запросов — подождите немного.",
      );
    },
  };
  const patch = await refreshSavedChat(api, {
    chatId: "1@c.us",
    title: "Иван",
    phone: "",
  });
  assert.equal(patch.chatId, "1@c.us");
  assert.equal(patch.title, "Иван");
  assert.equal(patch.messages, undefined); // живые сообщения придёт через поллинг
});
