import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../../src/shared/lib/phone.js";

test("normalizePhone normalizes RF phone numbers for CheckAccount", () => {
  assert.equal(normalizePhone("89991234567"), "79991234567"); // 8-format
  assert.equal(normalizePhone("+7 999 123-45-67"), "79991234567");
  assert.equal(normalizePhone("9991234567"), "79991234567"); // bare 10 digits
  assert.equal(normalizePhone("375291234567"), "375291234567"); // RB passthrough
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");
});
