import test from "node:test";
import assert from "node:assert/strict";
import {
  createRollingWindow,
  isWithinWindow,
  parseSourceDateTime,
  startOfShanghaiDay
} from "../src/time.js";

test("rolling window is exactly 72 hours ending at the query time", () => {
  const now = new Date("2026-09-19T10:22:37.000Z");
  const window = createRollingWindow(now);

  assert.equal(window.end.toISOString(), "2026-09-19T10:22:37.000Z");
  assert.equal(window.start.toISOString(), "2026-09-16T10:22:37.000Z");
});

test("source time is interpreted in Asia/Shanghai", () => {
  assert.equal(
    parseSourceDateTime("2026/9/16 17:05:00").toISOString(),
    "2026-09-16T09:05:00.000Z"
  );
});

test("rolling boundary includes the exact start and rejects one second earlier", () => {
  const window = createRollingWindow(new Date("2026-09-19T10:22:37.000Z"));

  assert.equal(isWithinWindow(parseSourceDateTime("2026/9/16 18:22:37"), window), true);
  assert.equal(isWithinWindow(parseSourceDateTime("2026/9/16 18:22:36"), window), false);
});

test("cutoff day starts at Shanghai midnight", () => {
  const value = new Date("2026-09-16T10:22:37.000Z");
  assert.equal(startOfShanghaiDay(value).toISOString(), "2026-09-15T16:00:00.000Z");
});

