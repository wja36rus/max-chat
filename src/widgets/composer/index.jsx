// [widgets/composer] Поле ввода сообщения.
//
// Черновик живёт локально (useState) и очищается ТОЛЬКО когда onSend вернул
// true — то есть API принял сообщение. При ошибке (квота 466, сеть) текст
// остаётся, чтобы пользователь не терял написанное.

import { useState } from "react";

/**
 * @param {object} props
 * @param {(text: string) => Promise<boolean>} props.onSend — true, если отправлено
 */
export function Composer({ onSend }) {
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
