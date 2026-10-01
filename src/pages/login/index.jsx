// [pages/login] Страница входа: idInstance + apiTokenInstance.
//
// Проверяет пару через getStateInstance (аккаунт должен быть авторизован в
// личном кабинете и не забанен), и только в этом случае пропускает дальше.

import { useMemo, useState } from "react";
import { createGreenApi } from "../../shared/api/green-api.js";

const CRED_KEY = "max-chat.credentials";

/**
 * @param {object} props
 * @param {(creds: {idInstance: string, apiTokenInstance: string}) => void} props.onLogin —
 *   вызывается после успешной проверки; креды сохраняет вызывающий слой (app).
 */
export default function LoginPage({ onLogin }) {
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
