import { parseSourceDate, parseSourceDateTime } from "./time.js";

export function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseListRows(rawRows, baseUrl) {
  return rawRows
    .map((row) => {
      const cells = Array.isArray(row.cells) ? row.cells.map(cleanText) : [];
      const title = cleanText(row.title);
      const href = String(row.href || "");
      if (cells.length < 6 || !href || !/view\.asp\?id=\d+/i.test(href)) return null;

      const idMatch = href.match(/[?&]id=(\d+)/i);
      if (!idMatch) return null;

      return {
        id: idMatch[1],
        category: cells[1],
        department: cells[2].split("·")[0].trim(),
        title,
        url: new URL(href, baseUrl).href,
        listDate: cells[5],
        listDateValue: parseSourceDate(cells[5])
      };
    })
    .filter(Boolean);
}

export function parseDetailMetadata({ metaText, updatedText, listDate }) {
  const publishMatch = String(metaText || "").match(
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)/
  );
  const publishedAt =
    parseSourceDateTime(publishMatch?.[1]) || parseSourceDate(listDate) || null;

  const updateMatch = String(updatedText || "").match(/更新于\s*([^）)]+)/);
  const updatedAt = updateMatch ? parseSourceDateTime(updateMatch[1]) : null;

  return {
    publishedAt,
    updatedAt: updatedAt && publishedAt && updatedAt > publishedAt ? updatedAt : null,
    exactTime: Boolean(publishMatch)
  };
}

export function parseNoticeId(url) {
  return String(url || "").match(/[?&]id=(\d+)/)?.[1] || "";
}

