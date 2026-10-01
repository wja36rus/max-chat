// [widgets/message-list] Лента сообщений активного чата.

import { MessageBubble } from "../message-bubble/index.jsx";

/**
 * @param {object} props
 * @param {object[]|undefined} props.messages — сообщения активного чата
 * @param {React.RefObject} props.bottomRef — контейнер, на который вешается useAutoScroll
 */
export function MessageList({ messages, bottomRef }) {
  return (
    <div className="messages" ref={bottomRef}>
      {messages?.map((m) => (
        <MessageBubble key={m.idMessage} msg={m} />
      ))}
    </div>
  );
}
