// [widgets/chat-list] Список чатов в сайдбаре.

import { ChatItem } from "../chat-item/index.jsx";

/**
 * @param {object} props
 * @param {object[]} props.chats
 * @param {string|null} props.activeChatId
 * @param {(chatId: string) => void} props.onSelect
 */
export function ChatList({ chats, activeChatId, onSelect }) {
  return (
    <ul className="chat-list">
      {chats.map((chat) => (
        <ChatItem
          key={chat.chatId}
          chat={chat}
          active={chat.chatId === activeChatId}
          onClick={() => onSelect(chat.chatId)}
        />
      ))}
    </ul>
  );
}
