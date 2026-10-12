import { AI_CONFIG, AI_ENABLED } from "./config.js";

export const SUMMARY_CACHE_VERSION = 4;

const BOILERPLATE_PATTERNS = [
  /深大新闻网/,
  /版权所有/,
  /咨询电话/,
  /校内报警/,
  /物业服务/,
  /学生区网络/,
  /关闭窗口/,
  /打印张贴版/,
  /（更新于/,
  /浏览\)/,
  /^首页/,
  /^校园公文通/
];

const KEYWORD_SCORES = [
  ["截止", 9],
  ["完成", 7],
  ["报名", 8],
  ["时间", 7],
  ["地点", 7],
  ["对象", 7],
  ["须", 4],
  ["要求", 6],
  ["申请", 6],
  ["办理", 5],
  ["提交", 5],
  ["评审", 5],
  ["考试", 5],
  ["招聘", 5],
  ["活动", 4],
  ["安排", 4],
  ["联系", 3]
];

const SPOKEN_REPLACEMENTS = [
  [/为进一步/g, "为了"],
  [/现就([^，。；]{0,24})有关事项通知如下/g, "现在把$1相关事项说一下"],
  [/现将有关事项通知如下/g, "相关事项如下"],
  [/有关事项通知如下/g, "相关事项如下"],
  [/通知如下/g, "要点如下"],
  [/请各学院（部）/g, "各学院（部）要"],
  [/请各单位/g, "各单位要"],
  [/请各相关单位/g, "相关单位要"],
  [/请全体/g, "所有"],
  [/须于/g, "要在"],
  [/需于/g, "要在"],
  [/应于/g, "要在"],
  [/请于/g, "要在"],
  [/须/g, "需要"],
  [/需/g, "需要"],
  [/应当/g, "要"],
  [/务必/g, "一定要"],
  [/严禁/g, "千万别"],
  [/不得/g, "不能"],
  [/如有/g, "如果有"],
  [/如遇/g, "如果遇到"],
  [/若/g, "如果"],
  [/届时/g, "到时候"],
  [/本次/g, "这次"],
  [/为方便/g, "为了方便"],
  [/相关材料/g, "材料"],
  [/特此通知[。.]?/g, ""],
  [/烦请/g, "请大家"],
  [/请登录/g, "记得登录"],
  [/请填写/g, "记得填写"],
  [/请提交/g, "记得提交"],
  [/请关注/g, "记得关注"],
  [/请参加/g, "记得参加"]
];

const SPOKEN_LABEL_REPLACEMENTS = [
  [/^报名截止日期[:：]\s*/, "报名截止到"],
  [/^截止日期[:：]\s*/, "截止到"],
  [/^截止时间[:：]\s*/, "截止时间是"],
  [/^讲座时间[:：]\s*/, "讲座时间是"],
  [/^座谈时间[:：]\s*/, "座谈时间是"],
  [/^活动时间[:：]\s*/, "活动时间是"],
  [/^时间[:：]\s*/, "时间是"],
  [/^讲座地点[:：]\s*/, "讲座地点在"],
  [/^座谈地点[:：]\s*/, "座谈地点在"],
  [/^活动地点[:：]\s*/, "活动地点在"],
  [/^地点[:：]\s*/, "地点在"],
  [/^填报对象[:：]\s*/, "需要填表的是"],
  [/^参加对象[:：]\s*/, "面向"],
  [/^对象[:：]\s*/, "面向"]
];

function normalizeLine(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*\d+[.、]\s*/, "")
    .replace(/^\s*[（(][一二三四五六七八九十\d]+[）)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtPunctuation(value, limit = 72) {
  const text = normalizeLine(value);
  if (text.length <= limit) return text;

  const candidate = text.slice(0, limit + 1);
  const cut = Math.max(
    candidate.lastIndexOf("；"),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("，"),
    candidate.lastIndexOf("：")
  );
  if (cut >= 28) return `${candidate.slice(0, cut + 1)}`;
  return `${candidate.slice(0, limit)}…`;
}

export function toSpokenChinese(value) {
  let text = normalizeLine(value);
  for (const [pattern, replacement] of SPOKEN_LABEL_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of SPOKEN_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return normalizeLine(text);
}

function scoreLine(line, index) {
  let score = Math.max(0, 5 - index * 0.2);
  for (const [keyword, weight] of KEYWORD_SCORES) {
    if (line.includes(keyword)) score += weight;
  }
  if (line.length >= 20 && line.length <= 180) score += 2;
  if (line.length > 320) score -= 3;
  return score;
}

export function extractNoticeLines(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .flatMap((line) => {
      const normalized = line.trim();
      if (normalized.length <= 700) return [normalized];
      return normalized.split(/(?<=[。！？；])/).map((part) => part.trim());
    })
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line)))
    .filter((line) => line.length >= 10 && line.length <= 700)
    .filter((line) => !/^撰稿[：:]|^审核[：:]|^摄影[：:]|^编辑[：:]/.test(line));
}

export function buildRuleSummary({ text, title }) {
  const cleanTitle = normalizeLine(title);
  const lines = extractNoticeLines(text).filter((line) => line !== cleanTitle);
  if (!lines.length) return ["正文比较短，建议打开原文看看完整内容。"];

  const ranked = lines
    .map((line, index) => ({ line, index, score: scoreLine(line, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  for (const candidate of ranked) {
    const spokenLine = truncateAtPunctuation(toSpokenChinese(candidate.line));
    if (!spokenLine || selected.some((item) => item.spokenLine === spokenLine)) continue;
    selected.push({ ...candidate, spokenLine });
    if (selected.length === Math.min(4, Math.max(2, Math.ceil(lines.length / 8)))) break;
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map((item) => item.spokenLine);
}

function stripCodeFence(value) {
  const text = String(value || "").trim();
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function parseAiBullets(value) {
  const raw = stripCodeFence(value);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const bullets = Array.isArray(parsed) ? parsed : parsed?.bullets || parsed?.sentences;
  if (!Array.isArray(bullets)) return null;

  const cleaned = bullets
    .map((item) => normalizeLine(item))
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => (item.length > 100 ? `${item.slice(0, 100)}…` : item));

  if (!cleaned.length) return null;
  return cleaned;
}

export async function buildAiSummary({ title, text, signal }) {
  if (!AI_ENABLED) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_CONFIG.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        temperature: 0.1,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              "你是校园通知摘要编辑。只能依据原文总结，不得补充或推断。请用自然简洁的日常口语，像同学之间转告消息，用一到两句话概括核心事件，总计不超过 120 字。只讲清谁、在什么时间、要做什么或发生了什么；不要逐项罗列次要细节，不要写公文体，避免“为进一步”“现就”“特此通知”“有关事项通知如下”。输出严格 JSON：{\"bullets\":[\"一句话概括\"]}，bullets 数组只放 1 至 2 句话。"
          },
          {
            role: "user",
            content: `标题：${title}\n\n通知正文：\n${String(text || "").slice(0, 8000)}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI 服务返回 ${response.status}`);
    }

    const payload = await response.json();
    return parseAiBullets(payload?.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function currentSummaryMode() {
  return AI_ENABLED ? "ai" : "rules";
}
