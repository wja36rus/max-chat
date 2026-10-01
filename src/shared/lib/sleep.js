// Задержка вне контекста setTimeout — используется фоном (поллинг, загрузка
// истории) для создания интервалов между запросами.

/**
 * Ждёт указанное число миллисекунд; resolve — без значения.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
