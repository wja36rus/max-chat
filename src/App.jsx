import { useMemo, useState, useEffect, useRef } from "react";
import {
  createGreenApi,
  appendChat,
  appendIncoming,
  appendOutgoing,
  updateMessage,
  extractTextMessage,
  mergeRestored,
  historyToMessages,
  mergeHistory,
} from "./greenApi.js";

const CRED_KEY = "max-chat.credentials";
const POLL_IDLE_MS = 1500; // no notification in queue
const POLL_ERROR_MS = 4000; // retry after a failed poll
const chatsKey = (idInstance) => `max-chat.chats.${idInstance}`;

export default function App() {
  const [credentials, setCredentials] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CRED_KEY) || "null");
    } catch {
      return null;
    }
  });

  if (!credentials) return <LoginScreen onLogin={setCredentials} />;

  return (
    <ChatScreen
      key={credentials.idInstance + credentials.apiTokenInstance}
      credentials={credentials}
      onLogout={() => {
        localStorage.removeItem(CRED_KEY);
        sessionStorage.removeItem(chatsKey(credentials.idInstance));
        setCredentials(null);
      }}
    />
  );
}

function LoginScreen({ onLogin }) {
  const [idInstance, setIdInstance] = useState("");
  const [apiTokenInstance, setApiTokenInstance] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const api = useMemo(
    () => createGreenApi({ idInstance, apiTokenInstance }),
    [idInstance, apiTokenInstance],
  );

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.getStateInstance();
      localStorage.setItem(
        CRED_KEY,
        JSON.stringify({ idInstance, apiTokenInstance }),
      );
      onLogin({ idInstance, apiTokenInstance });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="brand">
        <div className="logo">М</div>
        <h1>MAX Chat</h1>
        <p>Чат для мессенджера MAX на базе GREEN-API</p>
      </div>
      <form onSubmit={submit}>
        <label>
          idInstance
          <input
            value={idInstance}
            onChange={(e) => setIdInstance(e.target.value)}
            placeholder="1101000001"
            autoComplete="off"
          />
        </label>
        <label>
          apiTokenInstance
          <input
            value={apiTokenInstance}
            onChange={(e) => setApiTokenInstance(e.target.value)}
            placeholder="a1b2c3d4..."
            autoComplete="off"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button
          type="submit"
          disabled={!idInstance.trim() || !apiTokenInstance.trim() || loading}
        >
          {loading ? "Проверяем…" : "Войти"}
        </button>
        <p className="hint">
          Данные хранятся только в вашем браузере (localStorage).
        </p>
      </form>
    </div>
  );
}

function ChatScreen({ credentials, onLogout }) {
  const api = useMemo(
    () =>
      createGreenApi({
        idInstance: credentials.idInstance,
        apiTokenInstance: credentials.apiTokenInstance,
      }),
    [credentials],
  );

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  // error — человеческое действие (отправка, создание чата);
  // pollError — только от поллинга. Поллинг чистит лишь своё, чтобы
  // пустой опрос не стирал ошибку отправки каждые 1.5 с.
  const [error, setError] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [restored, setRestored] = useState(false);
  const bottomRef = useRef(null);
  const sendingRef = useRef(0);
  const activeChatIdRef = useRef(null);
  const scrollCountRef = useRef(-1); // last message count we scrolled for

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // Restore chats from sessionStorage (ids/phones) and refresh their names
  // and message history via the API. Both runs (StrictMode double-mount) are
  // idempotent.
  useEffect(() => {
    let stored = [];
    try {
      stored = JSON.parse(
        sessionStorage.getItem(chatsKey(credentials.idInstance)) || "[]",
      );
    } catch {
      stored = [];
    }
    const saved = stored
      .filter((c) => c && c.chatId)
      .map((c) => ({ chatId: c.chatId, title: c.title, phone: c.phone }));
    if (saved.length) {
      // Merge, don't replace: a chat the poll already created (incoming
      // message during mount) must keep its messages.
      setChats((prev) => mergeRestored(prev, saved));
      setActiveChatId((id) => id ?? saved[0].chatId);
    }
    setRestored(true);
    // Background refresh, one chat at a time: getContactInfo gives the fresh
    // display name and proves the chat still exists; dead chatIds fall back to
    // checkAccount(phone). Then GetChatHistory fills in the messages — the API
    // rate-limits it to 1 rps, so chats are spaced ~1.2 s apart. All setChats
    // are idempotent by chatId/idMessage, so StrictMode double-mount is harmless.
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const c of saved) {
        let chatId = c.chatId;
        try {
          const info = await api.getContactInfo(c.chatId);
          if (info.name && info.chatId) {
            chatId = info.chatId;
            const title = info.name;
            setChats((prev) =>
              prev.map((ch) =>
                ch.chatId === c.chatId ? { ...ch, chatId, title } : ch,
              ),
            );
            if (c.chatId === activeChatIdRef.current) setActiveChatId(chatId);
          }
        } catch {
          if (c.phone) {
            try {
              chatId = await api.checkAccount(c.phone);
              setChats((prev) =>
                prev.map((ch) =>
                  ch.chatId === c.chatId ? { ...ch, chatId } : ch,
                ),
              );
              if (c.chatId === activeChatIdRef.current) setActiveChatId(chatId);
            } catch {
              /* keep the stored chat as-is */
            }
          }
        }
        // History for the current (possibly remapped) chatId. 429/466 are
        // expected on the free tariff — skip quietly, live messages still
        // arrive via the poll.
        try {
          const history = historyToMessages(
            await api.getChatHistory(chatId, 100),
          );
          if (history.length) {
            setChats((prev) =>
              prev.map((ch) =>
                ch.chatId === chatId
                  ? { ...ch, messages: mergeHistory(ch.messages, history) }
                  : ch,
              ),
            );
          }
        } catch {
          /* rate limit / quota — history is best-effort */
        }
        await sleep(1200);
      }
    })();
  }, [api, credentials.idInstance]);

  // Persist open chats (id/phone/title only) to sessionStorage.
  useEffect(() => {
    if (!restored) return;
    sessionStorage.setItem(
      chatsKey(credentials.idInstance),
      JSON.stringify(
        chats.map((c) => ({
          chatId: c.chatId,
          title: c.title,
          phone: c.phone,
        })),
      ),
    );
  }, [chats, restored, credentials.idInstance]);

  // Poll GREEN-API for incoming notifications (HTTP API, FIFO queue).
  // StrictMode dev double-mount spins two loops briefly; the cancelled flag
  // plus appendIncoming's dedup make that harmless.
  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        let wait = POLL_IDLE_MS;
        try {
          const n = await api.receiveNotification();
          if (n) {
            const type = n.body?.typeWebhook ?? "?";
            const mType = n.body?.messageData?.typeMessage ?? "";
            // quotaExceeded: monthly Developer-tariff chat limit reached —
            // show it instead of silently deleting the notification.
            if (type === "quotaExceeded") {
              const q = n.body?.quotaData ?? {};
              const desc =
                q.description ||
                `достигнут месячный лимит (${q.used}/${q.total})`;
              setPollError(`Ошибка приёма сообщений: ${desc}`);
            }
            const msg = extractTextMessage(n.body);
            console.log(
              `[MAX] notif receiptId=${n.receiptId} ${type}${mType ? "/" + mType : ""} -> ${msg ? "text" : "skip"}`,
            );
            if (msg) {
              setChats((prev) => appendIncoming(prev, msg));
              setActiveChatId((id) => id ?? msg.chatId);
            }
            await api.deleteNotification(n.receiptId);
          }
          setPollError(null);
        } catch (err) {
          wait = POLL_ERROR_MS;
          console.error(`[MAX] poll error: ${err.message}`);
          setPollError(`Ошибка приёма сообщений: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    };
    loop();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const activeChat = chats.find((c) => c.chatId === activeChatId);

  // Scroll the active chat to the bottom only when the active chat itself
  // changed (grew a message or switched). Other-chat notifications and
  // background restore remaps must not yank the view or the draft position.
  useEffect(() => {
    const active = chats.find((c) => c.chatId === activeChatId);
    if (!active) return;
    const lastLen = scrollCountRef.current;
    if (active.messages.length === lastLen) return;
    scrollCountRef.current = active.messages.length;
    const bottom = bottomRef.current;
    if (bottom?.scrollHeight) bottom.scrollTo({ top: bottom.scrollHeight });
  }, [chats, activeChatId]);

  // Returns true only if the API accepted the message — the Composer clears
  // its textarea on success but keeps the draft on failure (previously the
  // draft was wiped even when sendMessage errored, e.g. on quota 466).
  async function send(text) {
    if (!activeChatId || !text.trim()) return false;
    const localId = `local-${Date.now()}-${sendingRef.current++}`;
    const message = { idMessage: localId, text, timestamp: Date.now() };
    setChats((prev) => appendOutgoing(prev, activeChatId, message));
    try {
      const idMessage = await api.sendMessage(activeChatId, text);
      setChats((prev) =>
        updateMessage(prev, activeChatId, localId, {
          idMessage,
          status: "sent",
        }),
      );
      return true;
    } catch (err) {
      setChats((prev) =>
        updateMessage(prev, activeChatId, localId, { status: "failed" }),
      );
      setError(`Не отправлено: ${err.message}`);
      return false;
    }
  }

  function openChat(chatId) {
    setActiveChatId(chatId);
    setError(null);
  }

  async function createChat(phone) {
    const phoneNumber = String(phone ?? "").replace(/\D/g, "");
    if (!phoneNumber) {
      setError("Введите номер телефона.");
      return;
    }
    let chatId;
    try {
      // MAX chatIds are numeric account ids, not phone numbers: resolve the
      // number via CheckAccount (this is also the "create chat" request).
      chatId = await api.checkAccount(phoneNumber);
    } catch (err) {
      setError(err.message);
      return;
    }
    setChats((prev) => appendChat(prev, chatId, phoneNumber, phoneNumber));
    setActiveChatId(chatId);
    setError(null);
  }

  return (
    <div className="chat">
      <div className="sidebar">
        <div className="sidebar-head">
          <div className="logo small">М</div>
          <button className="logout" onClick={onLogout}>
            Выйти
          </button>
        </div>
        <h2 className="section-title">Новый чат</h2>
        <form
          className="new-chat"
          onSubmit={(e) => {
            e.preventDefault();
            createChat(new FormData(e.currentTarget).get("phone"));
          }}
        >
          <input name="phone" placeholder="79991234567" autoComplete="off" />
          <button type="submit">+</button>
        </form>
        <p className="hint">
          Введите номер — чат будет создан после проверки в MAX.
        </p>
        <h2 className="section-title">Чаты</h2>
        <ul className="chat-list">
          {chats.map((chat) => (
            <ChatItem
              key={chat.chatId}
              chat={chat}
              active={chat.chatId === activeChatId}
              onClick={() => openChat(chat.chatId)}
            />
          ))}
        </ul>
        {!chats.length && (
          <p className="empty-hint">
            Создайте чат или дождитесь первого входящего сообщения.
          </p>
        )}
      </div>

      <main>
        <div className="messages" ref={bottomRef}>
          {activeChat?.messages.map((m) => (
            <Bubble key={m.idMessage} msg={m} />
          ))}
        </div>
        {error && (
          <div className="error banner">
            {error}
            <button
              onClick={() => {
                setError(null);
                setPollError(null);
              }}
            >
              ×
            </button>
          </div>
        )}
        {!error && pollError && (
          <div className="error banner">
            {pollError}
            <button onClick={() => setPollError(null)}>×</button>
          </div>
        )}
        {!activeChat && (
          <p className="empty-main">Выберите или создайте чат слева.</p>
        )}
        {activeChat && <Composer onSend={send} />}
      </main>
    </div>
  );
}

function ChatItem({ chat, active, onClick }) {
  const last = chat.messages[chat.messages.length - 1];
  return (
    <li className={active ? "active" : ""} onClick={onClick}>
      <div className="chat-title">{chat.title}</div>
      {last && (
        <div className="chat-preview">
          {last.direction === "out" ? "Вы: " : ""}
          {last.text}
        </div>
      )}
    </li>
  );
}

function Bubble({ msg }) {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta =
    msg.direction === "out"
      ? msg.status === "sending"
        ? "Отправка…"
        : msg.status === "failed"
          ? "Не отправлено"
          : `✓ ${time}`
      : time;
  return (
    <div
      className={`bubble ${msg.direction === "out" ? "out" : "in"} ${msg.status === "failed" ? "failed" : ""}`}
    >
      <p>{msg.text}</p>
      <span className={msg.status === "failed" ? "failed-time" : ""}>
        {meta}
      </span>
    </div>
  );
}

function Composer({ onSend }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    // Clear the draft only when the message actually went out.
    if (await onSend(value)) setText("");
    setSending(false);
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Введите сообщение…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" disabled={sending || !text.trim()}>
        ➤
      </button>
    </form>
  );
}
