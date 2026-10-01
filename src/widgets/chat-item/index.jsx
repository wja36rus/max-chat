// [widgets/chat-item] Строка чата в списке слева:
// имя + последнее сообщение (с префиксом «Вы:» для исходящих).

/**
 * @param {object} props
 * @param {object} props.chat — чат из списка ({chatId,title,phone,messages})
 * @param {boolean} props.active
 * @param {() => void} props.onClick
 */
export function ChatItem({ chat, active, onClick }) {
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
