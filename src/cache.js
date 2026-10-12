import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_FILE } from "./config.js";

export function createContentHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function createSummaryCacheKey({ id, contentHash, updatedAt, model }) {
  return [id, contentHash, updatedAt || "", model || "rules"].join(":");
}

export class SummaryCache {
  constructor(filePath = CACHE_FILE) {
    this.filePath = filePath;
    this.entries = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.entries) return this.entries;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.entries = parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("摘要缓存读取失败，将使用空缓存。");
      }
      this.entries = {};
    }

    return this.entries;
  }

  async get(key) {
    const entries = await this.load();
    return entries[key] || null;
  }

  async set(key, value) {
    const entries = await this.load();
    entries[key] = {
      bullets: value.bullets,
      summarySource: value.summarySource,
      model: value.model || "rules",
      cachedAt: new Date().toISOString()
    };
    await this.persist();
  }

  async clear() {
    this.entries = {};
    await this.persist();
  }

  async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, JSON.stringify(this.entries, null, 2), "utf8");
      await rename(tempPath, this.filePath);
    });
    return this.writeQueue;
  }
}

export function safeCacheFilePath() {
  return path.resolve(CACHE_FILE);
}
