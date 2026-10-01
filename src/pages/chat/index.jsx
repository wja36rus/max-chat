// [pages/chat] Страница чата: оркестрация состояния поверх фич/процессов.
//
// 1. Восстанавливает чаты из sessionStorage (мгновенно) и в фоне освежает
//    имя + историю через фичу restore.refreshSavedChat.
// 2. Сохраняет изменения списка чатов обратно в sessionStorage.
// 3. Запускает процесс приёма сообщений (процессы/notification-poll).
// 4. Композирует виджеты: список, лента, композер, баннеры.
//
// Слой pages собирает, но не содержит предметной логики: «как создать чат»,
// «как отправить» и «как восстанавливать» — в features/chat.

import { useEffect, useMemo, useRef, useState } from "react";
import { createGreenApi } from "../../shared/api/green-api.js";
import { useNotificationPoll } from "../../processes/notification-poll/index.js";
import { useAutoScroll } from "../../shared/hooks/use-auto-scroll.js";
import { loadChats, saveChats } from "../../shared/lib/chats-storage.js";
import { sleep } from "../../shared/lib/sleep.js";
import {
  mergeRestored,
  appendChat,
  appendIncoming,
  mergeHistory,
} from "../../entities/chat/index.js";
import {
  refreshSavedChat,
  HISTORY_REQUEST_DELAY_MS,
} from "../../features/chat/restore.js";
import { openChatByPhone, sendText } from "../../features/chat/actions.js";
import { ErrorBanner } from "../../widgets/error-banner/index.jsx";
import { ChatList } from "../../widgets/chat-list/index.jsx";
import { Composer } from "../../widgets/composer/index.jsx";
import { MessageList } from "../../widgets/message-list/index.jsx";
import { NewChatForm } from "../../widgets/new-chat-form/index.jsx";

/**
 * @param {object} props
 * @param {{idInstance: string, apiTokenInstance: string}} props.credentials
 * @param {() => void} props.onLogout
 */
export default function ChatPage({ credentials, onLogout }) {
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
  // restored — чтобы не пересохранять пустой список до первого восстановления.
  const [restored, setRestored] = useState(false);

  const bottomRef = useRef(null);
  const sendingRef = useRef(0);
  const activeChatIdRef = useRef(null);

  // Всегда актуальный activeChatId — для фоновых задач (рестор, поллинг),
  // чтобы не тащить сам объект в замыкания/эффекты.
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // ---------- Восстановление + фоновая загрузка имени/истории ----------
  useEffect(() => {
    const saved = loadChats(sessionStorage, credentials.idInstance);
    if (saved.length) {
      // Merge, don't replace: a chat the poll already created (incoming
      // message during mount) must keep its messages.
      setChats((prev) => mergeRestored(prev, saved));
      setActiveChatId((id) => id ?? saved[0].chatId);
    }
    setRestored(true);

    // Фон, по одному чату за раз: имя (getContactInfo / checkAccount) →
    // история (GetChatHistory, 1 зап/с → пауза 1.2 с между чатами).
    // Все setChats идемпотентны (mergeRestored, mergeHistory), StrictMode
    // двойной маунт безвреден.
    (async () => {
      for (const c of saved) {
        const patch = await refreshSavedChat(api, c);

        // 1) Имя и возможный ремап chatId — по СТАРОМУ chatId.
        if (patch.chatId !== c.chatId || patch.title !== c.title) {
          setChats((prev) =>
            prev.map((ch) =>
              ch.chatId === c.chatId
                ? { ...ch, chatId: patch.chatId, title: patch.title }
                : ch,
            ),
          );
          if (
            c.chatId === activeChatIdRef.current &&
            patch.chatId !== c.chatId
          ) {
            setActiveChatId(patch.chatId);
          }
        }

        // 2) История — по ТЕКУЩЕМУ chatId. Отдельный setChats: при двойном
        //    маунте (StrictMode) ремап из другого цикла уже мог поменять chatId.
        if (patch.messages) {
          setChats((prev) =>
            prev.map((ch) =>
              ch.chatId === patch.chatId
                ? { ...ch, messages: mergeHistory(ch.messages, patch.messages) }
                : ch,
            ),
          );
        }
        await sleep(HISTORY_REQUEST_DELAY_MS);
      }
    })();
  }, [api, credentials.idInstance]);

  // ---------- Персист: открытые чаты (id/телефон/имя) в sessionStorage ----------
  useEffect(() => {
    if (!restored) return;
    saveChats(sessionStorage, credentials.idInstance, chats);
  }, [chats, restored, credentials.idInstance]);

  // ---------- Приём сообщений: FIFO-поллинг ----------
  useNotificationPoll(api, {
    onMessage: (msg) => {
      setChats((prev) => appendIncoming(prev, msg));
      setActiveChatId((id) => id ?? msg.chatId);
    },
    onQuota: (quota) => {
      const desc =
        quota.description ||
        `достигнут месячный лимит (${quota.used}/${quota.total})`;
      setPollError(`Ошибка приёма сообщений: ${desc}`);
    },
    onError: (text) => setPollError(`Ошибка приёма сообщений: ${text}`),
    onClear: () => setPollError(null),
  });

  const activeChat = chats.find((c) => c.chatId === activeChatId);

  // ---------- Скролл только для активного чата ----------
  useAutoScroll(bottomRef, activeChat?.messages.length);

  // ---------- Действия пользователя ----------

  // Возвращает true только если API принял сообщение: по этому признаку
  // композер чистит поле ввода (иначе черновик теряется при 466 и др.).
  async function send(text) {
    if (!activeChatId) return false;
    const localId = `local-${Date.now()}-${sendingRef.current++}`;
    return sendText({
      api,
      chatId: activeChatId,
      text,
      localId,
      setChats,
      onError: setError,
    });
  }

  function createChat(phone) {
    openChatByPhone(api, phone)
      .then(({ chatId, phone: digits }) => {
        setChats((prev) => appendChat(prev, chatId, digits, digits));
        setActiveChatId(chatId);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }

  function openChat(chatId) {
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
        <NewChatForm onCreate={createChat} />
        <p className="hint">
          Введите номер — чат будет создан после проверки в MAX.
        </p>
        <h2 className="section-title">Чаты</h2>
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={openChat}
        />
        {!chats.length && (
          <p className="empty-hint">
            Создайте чат или дождитесь первого входящего сообщения.
          </p>
        )}
      </div>

      <main>
        <MessageList messages={activeChat?.messages} bottomRef={bottomRef} />

        <ErrorBanner
          message={error}
          onClose={() => {
            setError(null);
            setPollError(null);
          }}
        />
        {!error && (
          <ErrorBanner message={pollError} onClose={() => setPollError(null)} />
        )}

        {!activeChat && (
          <p className="empty-main">Выберите или создайте чат слева.</p>
        )}
        {activeChat && <Composer onSend={send} />}
      </main>
    </div>
  );
}
