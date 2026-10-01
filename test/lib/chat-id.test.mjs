import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withChatSuffix,
  withoutChatSuffix,
} from "../../src/shared/lib/chat-id.js";

test("withChatSuffix appends @c.us only when missing", () => {
  assert.equal(withChatSuffix("10000000"), "10000000@c.us");
  assert.equal(withChatSuffix("10000000@c.us"), "10000000@c.us");
  assert.equal(withChatSuffix(""), "");
});

test("withoutChatSuffix strips @c.us to the API wire format", () => {
  assert.equal(withoutChatSuffix("10000000@c.us"), "10000000");
  assert.equal(withoutChatSuffix("10000000"), "10000000"); // no suffix — as-is
});
