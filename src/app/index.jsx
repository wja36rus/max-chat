// [app] Точка входа приложения.
//
// Слой app (верхний): собирает приложение из страниц. Здесь живёт только
// «гейт логина» — есть ли сохранённые креды, какую страницу показать
// (LoginPage vs ChatPage) и как выйти из аккаунта (почистить storage).
// Самих бизнес-сценариев в этом слое нет — они в pages/features.

import { useState } from "react";
import LoginPage from "../pages/login/index.jsx";
import ChatPage from "../pages/chat/index.jsx";
import { clearChats } from "../shared/lib/chats-storage.js";

const CRED_KEY = "max-chat.credentials";

/**
 * Точка входа: роутинг Login ↔ Chat и хранение кредов в localStorage.
 * @returns {object} React-компонент
 */
export default function App() {
  const [credentials, setCredentials] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CRED_KEY) || "null");
    } catch {
      return null;
    }
  });

  if (!credentials) return <LoginPage onLogin={setCredentials} />;

  return (
    <ChatPage
      key={credentials.idInstance + credentials.apiTokenInstance}
      credentials={credentials}
      onLogout={() => {
        localStorage.removeItem(CRED_KEY);
        clearChats(sessionStorage, credentials.idInstance);
        setCredentials(null);
      }}
    />
  );
}
