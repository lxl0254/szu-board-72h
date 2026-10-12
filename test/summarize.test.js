import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuleSummary,
  extractNoticeLines,
  parseAiBullets,
  toSpokenChinese
} from "../src/summarize.js";

test("rule summary removes page chrome and keeps actionable notice content", () => {
  const summary = buildRuleSummary({
    title: "关于做好毕业生生源信息绑定工作的通知",
    text: [
      "深大新闻网",
      "一、填报对象",
      "2027届全体本科毕业生须在9月20日前完成生源信息绑定。",
      "二、办理方式",
      "请登录就业系统核对姓名、身份证号和联系方式并提交。",
      "如有疑问，请于工作时间联系学生部。",
      "版权所有©深圳大学信息中心"
    ].join("\n")
  });

  assert.equal(summary.length >= 2, true);
  assert.equal(summary.some((item) => item.includes("生源信息绑定")), true);
  assert.equal(summary.some((item) => item.includes("版权所有")), false);
  assert.equal(summary.some((item) => item.includes("深大新闻网")), false);
});

test("rule summary turns formal notice wording into spoken Chinese", () => {
  const summary = buildRuleSummary({
    title: "工作安排通知",
    text: [
      "为进一步做好本次工作，现就有关事项通知如下。",
      "请各单位务必于9月24日前提交相关材料。",
      "如有疑问，请联系工作人员，特此通知。"
    ].join("\n")
  });
  const combined = summary.join("");

  assert.equal(
    toSpokenChinese("为进一步做好本次工作，现就有关事项通知如下。").includes("为了"),
    true
  );
  assert.equal(combined.includes("一定要"), true, combined);
  assert.equal(combined.includes("如果有疑问"), true, combined);
  assert.equal(combined.includes("特此通知"), false);
  assert.equal(combined.includes("请各单位"), false);
  assert.equal(combined.includes("相关材料"), false);
});

test("extractNoticeLines removes metadata and attribution lines", () => {
  const lines = extractNoticeLines(
    "校团委 2026/9/2 15:27:00\n正文内容应当保留下来。\n撰稿：张老师\n审核：李老师"
  );

  assert.deepEqual(lines, ["校团委 2026/9/2 15:27:00", "正文内容应当保留下来。"]);
});

test("long notice paragraphs are split into selectable sentences", () => {
  const longParagraph = [
    "请各学院按要求开展自查。",
    "各单位须于9月24日前提交整改材料。",
    "相关材料通过邮件报送教务部。"
  ].join("");
  const lines = extractNoticeLines(longParagraph.padEnd(720, "补充说明"));
  const summary = buildRuleSummary({ title: "工作通知", text: longParagraph.repeat(20) });

  assert.equal(lines.length > 1, true);
  assert.equal(summary.length >= 2, true);
  assert.equal(summary.some((item) => item.includes("9月24日")), true);
});

test("AI bullet parser accepts JSON objects and code fences", () => {
  assert.deepEqual(
    parseAiBullets('```json\n{"bullets":["第一条要点","第二条要点"]}\n```'),
    ["第一条要点", "第二条要点"]
  );
  assert.deepEqual(parseAiBullets('{"bullets":["只用一句话概括"]}'), ["只用一句话概括"]);
});

test("AI bullet parser falls back to null for malformed or incomplete output", () => {
  assert.equal(parseAiBullets("not json"), null);
  assert.equal(parseAiBullets('{"bullets":[]}'), null);
});
