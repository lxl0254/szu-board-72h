import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(currentDir, "..");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const DATA_DIR = path.join(ROOT_DIR, ".data");
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, "playwright-profile");
export const CACHE_FILE = path.join(DATA_DIR, "cache.json");

export const HOST = "127.0.0.1";
export const PORT = Number.parseInt(process.env.PORT || "3210", 10);

export const BOARD_ORIGIN = "https://www1.szu.edu.cn";
export const BOARD_URL = `${BOARD_ORIGIN}/board/`;
export const AUTH_HOST = "authserver.szu.edu.cn";
export const SOURCE_TIME_ZONE = "Asia/Shanghai";
export const WINDOW_HOURS = 72;

export {
  ALL_DEPARTMENTS,
  DEFAULT_DEPARTMENTS,
  DEPARTMENT_SET,
  normalizeDepartmentSelection
} from "./departments.js";

const customAi = {
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_MODEL || "",
  baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
};

const localDeepSeek = {
  apiKey: process.env.OLLAMA_API_KEY || "ollama",
  model: process.env.OLLAMA_MODEL || "deepseek-r1:1.5b",
  baseUrl: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/+$/, "")
};

export const AI_CONFIG = customAi.apiKey && customAi.model
  ? { ...customAi, provider: "custom" }
  : { ...localDeepSeek, provider: "deepseek" };

export const AI_PROVIDER_LABEL = AI_CONFIG.provider === "deepseek"
  ? `DeepSeek ${AI_CONFIG.model}（本地免费）`
  : AI_CONFIG.model;

export const AI_ENABLED = true;
