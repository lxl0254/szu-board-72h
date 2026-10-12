import test from "node:test";
import assert from "node:assert/strict";
import { parseDetailMetadata, parseListRows } from "../src/parsers.js";

test("parseListRows keeps valid six-cell notice rows", () => {
  const rows = parseListRows(
    [
      {
        cells: [
          "1",
          "学工",
          "校团委 · ",
          "· 深圳大学团员与青年发展研究中心暨荔锋菁讲团成员招募通知",
          "",
          "2026-9-17"
        ],
        href: "view.asp?id=580982",
        title: "深圳大学团员与青年发展研究中心暨荔锋菁讲团成员招募通知"
      },
      {
        cells: ["菜单"],
        href: "/view.asp?id=12",
        title: "教师事务"
      }
    ],
    "https://www1.szu.edu.cn/board/"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "580982");
  assert.equal(rows[0].department, "校团委");
  assert.equal(rows[0].url, "https://www1.szu.edu.cn/board/view.asp?id=580982");
  assert.equal(rows[0].listDate, "2026-9-17");
});

test("parseDetailMetadata uses original publish time and later update time", () => {
  const metadata = parseDetailMetadata({
    metaText: "教务部 2026/9/16 17:05:00",
    updatedText: "（更新于2026/9/16 17:34:00）",
    listDate: "2026-9-16"
  });

  assert.equal(metadata.publishedAt.toISOString(), "2026-09-16T09:05:00.000Z");
  assert.equal(metadata.updatedAt.toISOString(), "2026-09-16T09:34:00.000Z");
  assert.equal(metadata.exactTime, true);
});

test("parseDetailMetadata does not treat an older updated-at as an update", () => {
  const metadata = parseDetailMetadata({
    metaText: "学生部 2026/9/18 09:00:00",
    updatedText: "（更新于2026/9/17 09:00:00）",
    listDate: "2026-9-18"
  });

  assert.equal(metadata.updatedAt, null);
});

