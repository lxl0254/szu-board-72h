import { SOURCE_TIME_ZONE, WINDOW_HOURS } from "./config.js";

const SHANGHAI_OFFSET_HOURS = 8;

function dateFromShanghaiParts(parts) {
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour || 0) - SHANGHAI_OFFSET_HOURS,
      Number(parts.minute || 0),
      Number(parts.second || 0)
    )
  );
}

export function parseSourceDateTime(value) {
  const match = String(value || "").match(
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/
  );
  if (!match) return null;

  return dateFromShanghaiParts({
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
    second: match[6]
  });
}

export function parseSourceDate(value) {
  const match = String(value || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;

  return dateFromShanghaiParts({
    year: match[1],
    month: match[2],
    day: match[3]
  });
}

export function startOfShanghaiDay(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOURCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return dateFromShanghaiParts({
    year: get("year"),
    month: get("month"),
    day: get("day")
  });
}

export function createRollingWindow(now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  return { start, end };
}

export function isWithinWindow(value, window) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time >= window.start.getTime() && time <= window.end.getTime();
}

export function formatShanghaiDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SOURCE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

