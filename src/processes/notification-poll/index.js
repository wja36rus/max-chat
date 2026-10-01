// [processes] Фоновый процесс приёма сообщений: FIFO-поллинг.
//
// Цикл: receiveNotification → разбор → обработка → deleteNotification.
// Уведомление удаляется из очереди ТОЛЬКО после успешной обработки — при
// сбое GREEN-API переотдаст его повторно, а нижний слой (appendIncoming)
// дедуплицирует по idMessage. Обычно 429/квота возвращаются до delete,
// поэтому очередь не «съедает» сообщения при проблемах.
//
// Процесс не знает про UI-состояние: только эмитит события через handlers.
// StrictMode-двойной маунт безопасен: cancelled-флаг гасит старый цикл.

import { useEffect } from "react";
import { extractTextMessage } from "../../entities/message/index.js";
import { sleep } from "../../shared/lib/sleep.js";

/** Пауза между запросами, когда очередь пуста. */
export const POLL_IDLE_MS = 1500;
/** Пауза после ошибки поллинга. */
export const POLL_ERROR_MS = 4000;

/**
 * Запускает FIFO-поллинг входящих уведомлений.
 * @param {object} api — клиент GREEN-API
 * @param {object} handlers
 * @param {(msg: object) => void} [handlers.onMessage] — входящее текстовое сообщение
 * @param {(quota: object) => void} [handlers.onQuota] — вебхук quotaExceeded
 * @param {(text: string) => void} [handlers.onError] — сбой поллинга
 * @param {() => void} [handlers.onClear] — очередь пуста, можно сбросить статус поллинга
 */
export function useNotificationPoll(api, handlers) {
  const { onMessage, onQuota, onError, onClear } = handlers;

  useEffect(() => {
    let cancelled = false;

    const loop = async () => {
      while (!cancelled) {
        let wait = POLL_IDLE_MS;
        try {
          const n = await api.receiveNotification();
          if (n) {
            const type = n.body?.typeWebhook ?? "?";
            const mType = n.body?.messageData?.typeMessage ?? "";

            // quotaExceeded: месячная квота тарифа Developer достигнута —
            // показываем это вместо тихого удаления уведомления.
            if (type === "quotaExceeded") {
              onQuota?.(n.body?.quotaData ?? {});
            }

            const msg = extractTextMessage(n.body);
            console.log(
              `[MAX] notif receiptId=${n.receiptId} ${type}${mType ? `/${mType}` : ""} -> ${msg ? "text" : "skip"}`,
            );
            if (msg) onMessage?.(msg);

            await api.deleteNotification(n.receiptId);
          }
          // Квитация «всё чисто» — только на пустом опросе. Это (в отличие от
          // прежнего кода) НЕ сбрасывает только что показанный баннер квоты.
          if (n === null) onClear?.();
        } catch (err) {
          wait = POLL_ERROR_MS;
          console.error(`[MAX] poll error: ${err.message}`);
          onError?.(err.message);
        }
        await sleep(wait);
      }
    };

    loop();
    return () => {
      cancelled = true;
    };
  }, [api]);
}
