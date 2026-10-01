// [shared/hooks] Автопрокрутка ленты сообщений вниз.
//
// Скроллит только когда выросло число сообщений АКТИВНОГО чата (или чат
// переключили). Фоновая работа — восстановление чата, история, входящее
// в другой чат — не должна дёргать вью: иначе сбивается позиция чтения.

import { useEffect, useRef } from "react";

const INITIAL_COUNT = -1;

/**
 * Прокручивает контейнер к низу при росте числа сообщений.
 * @param {React.RefObject} containerRef — ref на контейнер с overflow
 * @param {number|undefined} messageCount — количество сообщений активного чата
 *   (undefined — активного чата нет, не скроллим)
 */
export function useAutoScroll(containerRef, messageCount) {
  const lastCountRef = useRef(INITIAL_COUNT);

  useEffect(() => {
    if (typeof messageCount !== "number") return; // нет активного чата
    if (messageCount === lastCountRef.current) return; // ничего не изменилось
    lastCountRef.current = messageCount;

    const el = containerRef.current;
    if (el?.scrollHeight) el.scrollTo({ top: el.scrollHeight });
  }, [containerRef, messageCount]);
}
