import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  AUTH_HOST,
  BOARD_URL,
  BROWSER_PROFILE_DIR,
  DATA_DIR,
  DEFAULT_DEPARTMENTS
} from "./config.js";
import { cleanText, parseDetailMetadata, parseListRows } from "./parsers.js";
import { createRollingWindow, isWithinWindow, startOfShanghaiDay } from "./time.js";

export class SessionExpiredError extends Error {
  constructor(message = "深大登录会话已失效，请重新登录。") {
    super(message);
    this.name = "SessionExpiredError";
    this.code = "SESSION_EXPIRED";
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function removeProfileSafely() {
  const target = path.resolve(BROWSER_PROFILE_DIR);
  const relative = path.relative(path.resolve(DATA_DIR), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("拒绝清理数据目录之外的路径。");
  }
  return rm(target, { recursive: true, force: true });
}

export class SzuBoardClient {
  constructor({ userDataDir = BROWSER_PROFILE_DIR } = {}) {
    this.userDataDir = userDataDir;
    this.context = null;
    this.headless = true;
    this.lastCheckedAt = null;
    this.status = "unknown";
  }

  async ensureContext({ headless = true } = {}) {
    if (this.context && this.headless !== headless) {
      await this.context.close();
      this.context = null;
    }

    if (this.context) return this.context;

    await mkdir(DATA_DIR, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless,
      viewport: headless ? { width: 1365, height: 900 } : null,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai"
    });
    this.headless = headless;
    this.context.on("close", () => {
      this.context = null;
    });
    return this.context;
  }

  async openLogin() {
    try {
      const context = await this.ensureContext({ headless: false });
      const pages = context.pages();
      const page = pages[0] || (await context.newPage());
      await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.bringToFront();
      this.status = "checking";
      return { status: "opened" };
    } catch {
      const context = await this.ensureContext({ headless: true });
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      this.status = "checking";
      return { status: "qr" };
    }
  }

  async getLoginQr({ refresh = false } = {}) {
    const context = await this.ensureContext({ headless: true });
    const page = context.pages()[0] || (await context.newPage());
    if (refresh || !this.isAuthenticatedUrl(page.url())) {
      await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    if (this.isAuthenticatedUrl(page.url())) {
      throw new Error("当前会话已经登录。");
    }

    const qrCode = page.locator('img[src*="qrCode/getCode"]:visible').first();
    await qrCode.waitFor({ state: "visible", timeout: 15000 });
    return qrCode.screenshot({ type: "png" });
  }

  isAuthenticatedUrl(value) {
    try {
      const url = new URL(value);
      return url.hostname === "www1.szu.edu.cn" && url.pathname.startsWith("/board");
    } catch {
      return false;
    }
  }

  async checkSession({ openIfAnonymous = false } = {}) {
    if (openIfAnonymous && !this.context) {
      return this.openLogin();
    }

    const context = await this.ensureContext({ headless: this.context ? this.headless : true });
    const page = context.pages()[0] || (await context.newPage());

    try {
      const currentUrl = page.url();
      let currentHost = "";
      try {
        currentHost = new URL(currentUrl).hostname;
      } catch {
        currentHost = "";
      }

      if (currentHost !== AUTH_HOST) {
        await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      }
      const authenticated = this.isAuthenticatedUrl(page.url());
      this.status = authenticated ? "ready" : "anonymous";
      this.lastCheckedAt = new Date().toISOString();
      return {
        status: this.status,
        lastCheckedAt: this.lastCheckedAt,
        urlHost: new URL(page.url()).hostname
      };
    } catch (error) {
      this.status = "anonymous";
      this.lastCheckedAt = new Date().toISOString();
      return {
        status: this.status,
        lastCheckedAt: this.lastCheckedAt,
        error: "无法连接公文通。"
      };
    }
  }

  async assertAuthenticated(page) {
    try {
      const host = new URL(page.url()).hostname;
      if (host === AUTH_HOST) throw new SessionExpiredError();
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
    }

    const authenticated = this.isAuthenticatedUrl(page.url());
    if (!authenticated) throw new SessionExpiredError();
  }

  async queryDepartment(page, department) {
    await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.assertAuthenticated(page);

    await page.locator('select[name="dayy"]').selectOption("7#1周内");
    await page.locator('select[name="from_username"]').selectOption(department);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.locator('input[name="searchb1"]').click()
    ]);
    await this.assertAuthenticated(page);

    const rawRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tr"))
        .map((row) => {
          const cells = Array.from(row.querySelectorAll(":scope > td")).map(
            (cell) => cell.innerText || cell.textContent || ""
          );
          const link = row.querySelector("a[href*='view.asp']");
          if (cells.length !== 6 || !link) return null;
          return {
            cells,
            href: link.getAttribute("href"),
            title: link.textContent || ""
          };
        })
        .filter(Boolean)
    );

    return parseListRows(rawRows, BOARD_URL).filter(
      (notice) => cleanText(notice.department) === department
    );
  }

  async queryDepartmentWithRetry(page, department) {
    try {
      return await this.queryDepartment(page, department);
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      await delay(600);
      return this.queryDepartment(page, department);
    }
  }

  async fetchNoticeDetail(notice) {
    const context = await this.ensureContext({ headless: this.headless });
    const page = await context.newPage();

    try {
      await page.goto(notice.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.assertAuthenticated(page);

      const snapshot = await page.evaluate(() => {
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const multiline = (value) =>
          String(value || "")
            .replace(/\u00a0/g, " ")
            .split(/\r?\n+/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join("\n");
        const titleElements = Array.from(
          document.querySelectorAll('td[align="center"] span, table[width="86%"] span')
        )
          .filter((element) => clean(element.textContent).length >= 4);
        const titleCandidates = titleElements.map((element) => clean(element.textContent));
        const title =
          titleCandidates[0] || clean(document.title).replace(/—深圳大学内部网$/, "");

        const linkedContentCell = titleElements[0]
          ?.closest("tr")
          ?.nextElementSibling?.nextElementSibling?.querySelector("td");
        const candidateCells = Array.from(document.querySelectorAll("td"))
          .map((cell) => ({
            text: cell.innerText || cell.textContent || "",
            structureCount: cell.querySelectorAll("p, div, br").length
          }))
          .filter((cell) => clean(cell.text).length >= 80 && cell.structureCount > 0)
          .sort((a, b) => clean(b.text).length - clean(a.text).length);

        return {
          title,
          metaText: clean(document.querySelector('font[color="#808080"]')?.textContent),
          updatedText: clean(document.body.innerText).match(/（更新于[^）]+）/)?.[0] || "",
          contentText: multiline(linkedContentCell?.innerText || candidateCells[0]?.text)
        };
      });

      const meta = parseDetailMetadata({
        metaText: snapshot.metaText,
        updatedText: snapshot.updatedText,
        listDate: notice.listDate
      });

      return {
        ...notice,
        title: snapshot.title || notice.title,
        contentText: snapshot.contentText,
        publishedAt: meta.publishedAt,
        updatedAt: meta.updatedAt,
        exactTime: meta.exactTime
      };
    } finally {
      await page.close();
    }
  }

  async collect({ departments = DEFAULT_DEPARTMENTS, onProgress } = {}) {
    const context = await this.ensureContext({ headless: this.headless });
    const page = context.pages()[0] || (await context.newPage());
    await this.assertAuthenticated(await this.ensureBoardPage(page));

    const window = createRollingWindow();
    const cutoffDay = startOfShanghaiDay(window.start);
    const notices = [];
    const warnings = [];

    for (let index = 0; index < departments.length; index += 1) {
      const department = departments[index];
      onProgress?.({
        stage: "listing",
        department,
        completed: index,
        total: departments.length
      });

      try {
        const rows = await this.queryDepartmentWithRetry(page, department);
        const possible = rows.filter((notice) => {
          if (!notice.listDateValue) return false;
          return notice.listDateValue.getTime() >= cutoffDay.getTime();
        });

        const details = await mapLimit(possible, 3, async (notice) => {
          try {
            return await this.fetchNoticeDetail(notice);
          } catch (error) {
            if (error instanceof SessionExpiredError) throw error;
            return { ...notice, detailError: true };
          }
        });

        for (const detail of details) {
          if (detail.detailError) {
            if (detail.listDateValue?.getTime() > cutoffDay.getTime()) {
              notices.push({
                ...detail,
                publishedAt: detail.listDateValue,
                exactTime: false
              });
            } else {
              warnings.push({
                code: "DETAIL_TIME_UNKNOWN",
                department,
                message: `“${detail.title}”位于时间边界附近，因详情读取失败而未纳入。`
              });
            }
            continue;
          }

          if (!detail.publishedAt || !isWithinWindow(detail.publishedAt, window)) continue;
          notices.push(detail);
        }
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        warnings.push({
          code: "DEPARTMENT_FAILED",
          department,
          message: `${department} 查询失败，已保留其他单位结果。`
        });
      }

      onProgress?.({
        stage: "listing",
        department,
        completed: index + 1,
        total: departments.length
      });
    }

    const deduplicated = Array.from(
      notices.reduce((map, notice) => {
        if (!map.has(notice.id)) map.set(notice.id, notice);
        return map;
      }, new Map()).values()
    );
    deduplicated.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    return { notices: deduplicated, warnings, window };
  }

  async ensureBoardPage(page) {
    await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    return page;
  }

  async clearSession() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    await removeProfileSafely();
    this.status = "anonymous";
    this.lastCheckedAt = new Date().toISOString();
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
