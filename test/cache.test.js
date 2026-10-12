import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SummaryCache, createContentHash, createSummaryCacheKey } from "../src/cache.js";

test("summary cache stores only summary metadata and reloads it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "szu-board-cache-"));
  const filePath = path.join(directory, "cache.json");

  try {
    const contentHash = createContentHash("notice body");
    const key = createSummaryCacheKey({
      id: "1",
      contentHash,
      updatedAt: "2026-09-19T10:00:00.000Z",
      model: "rules"
    });
    const cache = new SummaryCache(filePath);
    await cache.set(key, {
      bullets: ["要点一", "要点二"],
      summarySource: "rules",
      model: "rules"
    });

    const reloaded = new SummaryCache(filePath);
    const value = await reloaded.get(key);
    assert.deepEqual(value.bullets, ["要点一", "要点二"]);

    const raw = await readFile(filePath, "utf8");
    assert.equal(raw.includes("notice body"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
