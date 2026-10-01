// [widgets/new-chat-form] Форма создания чата по номеру телефона.
//
// Номер отдаётся onCreate «как есть» — резолюцию и валидацию делает фича
// (openChatByPhone): здесь не нужен ни стейт, ни нормализация.

/**
 * @param {object} props
 * @param {(phone: string) => void} props.onCreate — юзер ввёл номер
 */
export function NewChatForm({ onCreate }) {
  return (
    <form
      className="new-chat"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(new FormData(e.currentTarget).get("phone"));
      }}
    >
      <input name="phone" placeholder="79991234567" autoComplete="off" />
      <button type="submit">+</button>
    </form>
  );
}
