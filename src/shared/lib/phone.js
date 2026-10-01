// Нормализация телефонного номера для CheckAccount.
//
// MAX принимает только номера РФ (7) и РБ (375):
//   "8XXXXXXXXXX" (российский префикс) → "7XXXXXXXXXX"
//   10 цифр (местный номер)            → "7" + номер
//   всё остальное                      → цифры как есть

/**
 * Приводит введённый телефон к формату, который ждёт CheckAccount.
 * @param {string|number|null} phone — номер в любом виде («8-», «+7», с пробелами)
 * @returns {string} цифры номера
 */
export function normalizePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    return "7" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "7" + digits;
  }
  return digits;
}
