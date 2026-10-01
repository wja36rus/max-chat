// [widgets/error-banner] Баннер ошибки/предупреждения.
//
// Один и тот же вид для: ошибок действий пользователя (отправка, создание
// чата) и статусов поллинга (сбой приёма, квота). Кнопка «×» закрывает.

/**
 * @param {object} props
 * @param {string|null} props.message
 * @param {() => void} props.onClose
 */
export function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="error banner">
      {message}
      <button onClick={onClose}>×</button>
    </div>
  );
}
