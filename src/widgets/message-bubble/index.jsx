// [widgets/message-bubble] Пузырь сообщения.
//
// Время всегда в формате HH:MM (локаль ru-RU); для исходящих дополнительно
// статус: «Отправка…» / «Не отправлено» / галочка ✓.
// timestamp — всегда СЕКУНДЫ (см. entities/message/makeLocalMessage).

/**
 * @param {object} props
 * @param {object} props.msg
 */
export function MessageBubble({ msg }) {
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
