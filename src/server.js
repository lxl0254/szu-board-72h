import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  AI_CONFIG,
  AI_ENABLED,
  AI_PROVIDER_LABEL,
  ALL_DEPARTMENTS,
  DEFAULT_DEPARTMENTS,
  HOST,
  PORT,
  PUBLIC_DIR,
  normalizeDepartmentSelection
} from "./config.js";
import { SummaryCache, createContentHash, createSummaryCacheKey } from "./cache.js";
import { SzuBoardClient, SessionExpiredError } from "./source.js";
import {
  buildAiSummary,
  buildRuleSummary,
  currentSummaryMode,
  SUMMARY_CACHE_VERSION
} from "./summarize.js";

const boardClient = new SzuBoardClient();
const summaryCache = new SummaryCache();
let queryRunning = false;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function createSecurityHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function isTrustedLocalRequest(request) {
  const origin = request.headers.origin;
  const expectedOrigin = `http://${HOST}:${PORT}`;
  if (origin && origin !== expectedOrigin) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  return true;
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      ...createSecurityHeaders(),
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not Found");
  }
}

function createSse(response) {
  response.writeHead(200, {
    ...createSecurityHeaders(),
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");

  return {
    send(event, data) {
      if (!response.writableEnded) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
    end() {
      if (!response.writableEnded) response.end();
    }
  };
}

function toNoticePayload(notice, bullets, summarySource, contentHash) {
  return {
    id: notice.id,
    department: notice.department,
    category: notice.category,
    title: notice.title,
    publishedAt: new Date(notice.publishedAt).toISOString(),
    updatedAt: notice.updatedAt ? new Date(notice.updatedAt).toISOString() : null,
    url: notice.url,
    bullets,
    summarySource,
    exactTime: notice.exactTime,
    contentHash
  };
}

async function runWithConcurrency(items, limit, mapper) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function prepareNoticeSummary(notice) {
  const contentHash = createContentHash(
    `${notice.title}\n${notice.contentText}\n${notice.updatedAt?.toISOString?.() || ""}`
  );
  const versionPrefix = `summary-v${SUMMARY_CACHE_VERSION}`;
  const model = AI_ENABLED ? `${versionPrefix}:${AI_CONFIG.model}` : `${versionPrefix}:rules`;
  const aiCacheKey = createSummaryCacheKey({
    id: notice.id,
    contentHash,
    updatedAt: notice.updatedAt?.toISOString?.() || "",
    model
  });

  if (AI_ENABLED) {
    const cachedAi = await summaryCache.get(aiCacheKey);
    if (cachedAi?.bullets?.length) {
      return {
        notice,
        contentHash,
        bullets: cachedAi.bullets,
        summarySource: "ai",
        needsAi: false
      };
    }
  }

  const ruleCacheKey = createSummaryCacheKey({
    id: notice.id,
    contentHash,
    updatedAt: notice.updatedAt?.toISOString?.() || "",
    model: `${versionPrefix}:rules`
  });
  const cachedRules = await summaryCache.get(ruleCacheKey);
  if (cachedRules?.bullets?.length) {
    return {
      notice,
      contentHash,
      bullets: cachedRules.bullets,
      summarySource: "rules",
      needsAi: AI_ENABLED
    };
  }

  const bullets = buildRuleSummary({
    title: notice.title,
    text: notice.contentText
  });
  await summaryCache.set(ruleCacheKey, {
    bullets,
    summarySource: "rules",
    model: `${versionPrefix}:rules`
  });

  return {
    notice,
    contentHash,
    bullets,
    summarySource: "rules",
    needsAi: AI_ENABLED
  };
}

async function handleQueryStream(request, response) {
  if (!isTrustedLocalRequest(request)) {
    sendJson(response, 403, { error: "仅允许本机页面发起查询。" });
    return;
  }
  if (queryRunning) {
    sendJson(response, 409, { error: "已有查询正在执行。" });
    return;
  }

  queryRunning = true;
  const stream = createSse(response);
  const abortController = new AbortController();
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  const departments = normalizeDepartmentSelection(
    requestUrl.searchParams.getAll("department"),
    DEFAULT_DEPARTMENTS
  );
  let clientDisconnected = false;
  response.on("close", () => {
    if (!response.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  try {
    const session = await boardClient.checkSession();
    if (session.status !== "ready") {
      stream.send("warning", {
        code: "SESSION_REQUIRED",
        message: "请先登录深圳大学统一身份认证。"
      });
      stream.send("done", {
        status: "session-required",
        generatedAt: new Date().toISOString(),
        total: 0,
        byDepartment: Object.fromEntries(departments.map((department) => [department, 0])),
        warnings: []
      });
      return;
    }

    const collected = await boardClient.collect({
      departments,
      onProgress(progress) {
        stream.send("progress", progress);
      }
    });

    stream.send("progress", {
      stage: "summarizing",
      completed: 0,
      total: collected.notices.length
    });

    const prepared = [];
    for (const [index, notice] of collected.notices.entries()) {
      const item = await prepareNoticeSummary(notice);
      prepared.push(item);
      stream.send("notice", toNoticePayload(
        item.notice,
        item.bullets,
        item.summarySource,
        item.contentHash
      ));
      stream.send("progress", {
        stage: "summarizing",
        completed: index + 1,
        total: collected.notices.length
      });
    }

    const warnings = [...collected.warnings];
    let aiFailureCount = 0;

    if (AI_ENABLED) {
      stream.send("progress", {
        stage: "refining",
        completed: 0,
        total: prepared.filter((item) => item.needsAi).length
      });

      let aiCompleted = 0;
      const aiConcurrency = AI_CONFIG.provider === "deepseek" ? 1 : 3;
      await runWithConcurrency(prepared.filter((item) => item.needsAi), aiConcurrency, async (item) => {
        if (abortController.signal.aborted) return;

        try {
          const aiBullets = await buildAiSummary({
            title: item.notice.title,
            text: item.notice.contentText,
            signal: abortController.signal
          });
          if (!aiBullets?.length) throw new Error("AI 未返回有效摘要。");

          const cacheKey = createSummaryCacheKey({
            id: item.notice.id,
            contentHash: item.contentHash,
            updatedAt: item.notice.updatedAt?.toISOString?.() || "",
            model: `summary-v${SUMMARY_CACHE_VERSION}:${AI_CONFIG.model}`
          });
          await summaryCache.set(cacheKey, {
            bullets: aiBullets,
            summarySource: "ai",
            model: `summary-v${SUMMARY_CACHE_VERSION}:${AI_CONFIG.model}`
          });
          stream.send("summary", {
            id: item.notice.id,
            bullets: aiBullets,
            summarySource: "ai"
          });
        } catch (error) {
          if (!abortController.signal.aborted) aiFailureCount += 1;
        } finally {
          aiCompleted += 1;
          stream.send("progress", {
            stage: "refining",
            completed: aiCompleted,
            total: prepared.filter((candidate) => candidate.needsAi).length
          });
        }
      });
    }

    if (aiFailureCount > 0) {
      warnings.push({
        code: "AI_FALLBACK",
        message: `${aiFailureCount} 条通知未能生成 AI 摘要，已保留规则摘要。`
      });
    }
    for (const warning of warnings) stream.send("warning", warning);

    const byDepartment = Object.fromEntries(
      departments.map((department) => [
        department,
        collected.notices.filter((notice) => notice.department === department).length
      ])
    );

    stream.send("done", {
      status: warnings.length ? "partial" : "ok",
      generatedAt: new Date().toISOString(),
      windowStart: collected.window.start.toISOString(),
      windowEnd: collected.window.end.toISOString(),
      total: collected.notices.length,
      byDepartment,
      warnings,
      summaryMode: currentSummaryMode(),
      aiPending: false
    });
  } catch (error) {
    if (!clientDisconnected) {
      const sessionExpired = error instanceof SessionExpiredError;
      stream.send("warning", {
        code: sessionExpired ? "SESSION_EXPIRED" : "QUERY_FAILED",
        message: sessionExpired ? error.message : "查询失败，请稍后重试。"
      });
      stream.send("done", {
        status: sessionExpired ? "session-expired" : "error",
        generatedAt: new Date().toISOString(),
        total: 0,
        byDepartment: Object.fromEntries(departments.map((department) => [department, 0])),
        warnings: []
      });
    }
  } finally {
    queryRunning = false;
    stream.end();
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/api/session/status") {
    try {
      const status = await boardClient.checkSession();
      sendJson(response, 200, status);
    } catch (error) {
      console.error("检查登录状态失败：", error);
      sendJson(response, 200, {
        status: "anonymous",
        lastCheckedAt: new Date().toISOString(),
        error: "无法检查登录状态。"
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/departments") {
    sendJson(response, 200, {
      departments: ALL_DEPARTMENTS,
      defaults: DEFAULT_DEPARTMENTS
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/open") {
    if (!isTrustedLocalRequest(request)) {
      sendJson(response, 403, { error: "仅允许本机页面打开登录窗口。" });
      return;
    }
    try {
      const result = await boardClient.openLogin();
      sendJson(response, 200, result);
    } catch (error) {
      console.error("打开登录窗口失败：", error);
      sendJson(response, 500, { error: "无法打开登录窗口，请确认已安装 Playwright Chromium。" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session/qr") {
    if (!isTrustedLocalRequest(request)) {
      sendJson(response, 403, { error: "仅允许本机页面获取登录二维码。" });
      return;
    }
    try {
      const image = await boardClient.getLoginQr({
        refresh: url.searchParams.get("refresh") === "1"
      });
      response.writeHead(200, {
        ...createSecurityHeaders(),
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
        "Content-Length": image.length
      });
      response.end(image);
    } catch (error) {
      console.error("获取登录二维码失败：", error);
      sendJson(response, 500, { error: "无法获取登录二维码。" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/clear") {
    if (!isTrustedLocalRequest(request)) {
      sendJson(response, 403, { error: "仅允许本机页面清除会话。" });
      return;
    }
    await boardClient.clearSession();
    await summaryCache.clear();
    sendJson(response, 200, { status: "anonymous" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/query/stream") {
    await handleQueryStream(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response, url.pathname);
    return;
  }

  sendJson(response, 405, { error: "Method Not Allowed" });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("请求处理失败：", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal Server Error" });
    else response.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`公文通摘要已启动：http://${HOST}:${PORT}`);
  console.log(`摘要模式：${currentSummaryMode() === "ai" ? `AI (${AI_PROVIDER_LABEL})` : "本地规则"}`);
});

async function shutdown() {
  server.close();
  await boardClient.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
