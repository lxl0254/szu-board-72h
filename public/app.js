const DEFAULT_DEPARTMENTS = [
  "校团委",
  "教务部",
  "学生部",
  "时光学生社区管理委员会",
  "物理与光电工程学院"
];

const DEPARTMENT_STORAGE_KEY = "szu-board-selected-departments";

const state = {
  departments: [...DEFAULT_DEPARTMENTS],
  allDepartments: [],
  notices: new Map(),
  warnings: [],
  filter: "全部",
  sessionStatus: "checking",
  sessionTimer: null,
  queryRunning: false,
  doneReceived: false,
  byDepartment: Object.fromEntries(DEFAULT_DEPARTMENTS.map((department) => [department, 0])),
  summaryMode: "rules",
  dialogDepartments: [...DEFAULT_DEPARTMENTS]
};

const elements = {
  sessionStatus: document.querySelector("#sessionStatus"),
  sessionStatusText: document.querySelector("#sessionStatusText"),
  loginButton: document.querySelector("#loginButton"),
  clearButton: document.querySelector("#clearButton"),
  queryButton: document.querySelector("#queryButton"),
  summaryMode: document.querySelector("#summaryMode"),
  lastQueryText: document.querySelector("#lastQueryText"),
  windowText: document.querySelector("#windowText"),
  progressWrap: document.querySelector("#progressWrap"),
  progressBar: document.querySelector("#progressBar"),
  progressText: document.querySelector("#progressText"),
  resultCount: document.querySelector("#resultCount"),
  filterTabs: document.querySelector("#filterTabs"),
  warningList: document.querySelector("#warningList"),
  noticeList: document.querySelector("#noticeList"),
  emptyTemplate: document.querySelector("#emptyStateTemplate"),
  noticeTemplate: document.querySelector("#noticeTemplate"),
  loginDialog: document.querySelector("#loginDialog"),
  loginQrImage: document.querySelector("#loginQrImage"),
  loginDialogStatus: document.querySelector("#loginDialogStatus"),
  refreshLoginQr: document.querySelector("#refreshLoginQr"),
  closeLoginDialog: document.querySelector("#closeLoginDialog"),
  selectedCount: document.querySelector("#selectedCount"),
  selectedUnits: document.querySelector("#selectedUnits"),
  openDepartmentDialog: document.querySelector("#openDepartmentDialog"),
  resetDepartments: document.querySelector("#resetDepartments"),
  departmentDialog: document.querySelector("#departmentDialog"),
  departmentSearch: document.querySelector("#departmentSearch"),
  departmentDialogCount: document.querySelector("#departmentDialogCount"),
  departmentOptions: document.querySelector("#departmentOptions"),
  closeDepartmentDialog: document.querySelector("#closeDepartmentDialog"),
  cancelDepartmentDialog: document.querySelector("#cancelDepartmentDialog"),
  saveDepartmentDialog: document.querySelector("#saveDepartmentDialog")
};

function normalizeDepartments(value, fallback = DEFAULT_DEPARTMENTS) {
  const catalog = state.allDepartments.length ? state.allDepartments : ALL_DEFAULT_FALLBACK;
  const selected = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const department = String(item || "").trim();
    if (!catalog.includes(department) || seen.has(department)) continue;
    seen.add(department);
    selected.push(department);
  }
  return selected.length ? selected : [...fallback];
}

const ALL_DEFAULT_FALLBACK = [...DEFAULT_DEPARTMENTS];

function loadStoredDepartments() {
  try {
    const stored = JSON.parse(localStorage.getItem(DEPARTMENT_STORAGE_KEY) || "[]");
    return normalizeDepartments(stored, DEFAULT_DEPARTMENTS);
  } catch {
    return [...DEFAULT_DEPARTMENTS];
  }
}

function saveDepartments() {
  try {
    localStorage.setItem(DEPARTMENT_STORAGE_KEY, JSON.stringify(state.departments));
  } catch {
    addWarning({ code: "STORAGE_FAILED", message: "无法在本机保存单位选择。" });
  }
}

function updateUnitControls() {
  elements.selectedCount.textContent = `已选 ${state.departments.length} 个单位`;
  elements.openDepartmentDialog.disabled = state.queryRunning || !state.allDepartments.length;
  elements.resetDepartments.disabled = state.queryRunning;
}

function renderSelectedUnits() {
  elements.selectedUnits.replaceChildren();
  for (const department of state.departments) {
    const chip = document.createElement("span");
    chip.className = "unit-chip";
    const label = document.createElement("span");
    label.textContent = department;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.disabled = state.queryRunning || state.departments.length <= 1;
    remove.setAttribute("aria-label", `删除 ${department}`);
    remove.title = state.departments.length <= 1 ? "至少保留一个查询单位" : `删除 ${department}`;
    remove.addEventListener("click", () => {
      state.departments = state.departments.filter((item) => item !== department);
      state.filter = "全部";
      saveDepartments();
      render();
    });
    chip.append(label, remove);
    elements.selectedUnits.append(chip);
  }
  updateUnitControls();
}

function renderDepartmentOptions(query = "") {
  const keyword = String(query || "").trim().toLowerCase();
  const options = state.allDepartments.filter((department) =>
    department.toLowerCase().includes(keyword)
  );
  elements.departmentOptions.replaceChildren();

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "department-option-empty";
    empty.textContent = "没有匹配的发文单位";
    elements.departmentOptions.append(empty);
    return;
  }

  for (const department of options) {
    const label = document.createElement("label");
    label.className = "department-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = department;
    checkbox.checked = state.dialogDepartments.includes(department);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!state.dialogDepartments.includes(department)) state.dialogDepartments.push(department);
      } else {
        state.dialogDepartments = state.dialogDepartments.filter((item) => item !== department);
      }
      updateDepartmentDialogCount();
    });
    const text = document.createElement("span");
    text.textContent = department;
    label.append(checkbox, text);
    elements.departmentOptions.append(label);
  }
}

function updateDepartmentDialogCount() {
  elements.departmentDialogCount.textContent =
    `已选 ${state.dialogDepartments.length} / ${state.allDepartments.length} 个单位`;
}

function showDepartmentManager() {
  try {
    state.dialogDepartments = [...state.departments];
    elements.departmentSearch.value = "";
    renderDepartmentOptions();
    updateDepartmentDialogCount();
    elements.departmentDialog.showModal();
  } catch {
    addWarning({ code: "DEPARTMENT_DIALOG_FAILED", message: "无法打开单位选择窗口。" });
  }
}

function persistDialogDepartments() {
  if (!state.dialogDepartments.length) {
    addWarning({ code: "NO_DEPARTMENT", message: "请至少保留一个查询单位。" });
    return;
  }
  state.departments = normalizeDepartments(state.dialogDepartments);
  saveDepartments();
  elements.departmentDialog.close();
  state.filter = "全部";
  state.notices.clear();
  state.doneReceived = false;
  render();
}

async function loadDepartmentCatalog() {
  try {
    const response = await fetch("/api/departments", { cache: "no-store" });
    const payload = await response.json();
    state.allDepartments = Array.isArray(payload.departments) ? payload.departments : [];
    state.departments = loadStoredDepartments();
    state.byDepartment = Object.fromEntries(state.departments.map((department) => [department, 0]));
    render();
  } catch {
    addWarning({ code: "DEPARTMENTS_FAILED", message: "无法加载发文单位清单。" });
  }
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatWindow(start, end) {
  if (!start || !end) return "查询时自动计算时间范围";
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${formatter.format(new Date(start))} 至 ${formatter.format(new Date(end))}`;
}

function setSessionStatus(status, lastCheckedAt) {
  state.sessionStatus = status;
  elements.sessionStatus.dataset.status = status;

  if (status === "ready") {
    elements.sessionStatusText.textContent = "已连接公文通";
    elements.loginButton.hidden = true;
    if (elements.loginDialog.open) elements.loginDialog.close();
    render();
    return;
  }

  elements.loginButton.hidden = false;
  if (status === "checking") {
    elements.sessionStatusText.textContent = "正在检查登录";
  } else if (lastCheckedAt) {
    elements.sessionStatusText.textContent = "需要登录";
  } else {
    elements.sessionStatusText.textContent = "登录状态未知";
  }
  render();
}

async function checkSession({ silent = false } = {}) {
  if (!silent) setSessionStatus("checking");
  try {
    const response = await fetch("/api/session/status", { cache: "no-store" });
    const payload = await response.json();
    setSessionStatus(payload.status === "ready" ? "ready" : "anonymous", payload.lastCheckedAt);
    if (payload.status === "ready" && state.sessionTimer) {
      clearInterval(state.sessionTimer);
      state.sessionTimer = null;
    }
    return payload.status === "ready";
  } catch {
    setSessionStatus("anonymous");
    return false;
  }
}

function startSessionPolling() {
  if (state.sessionTimer) clearInterval(state.sessionTimer);
  let attempts = 0;
  state.sessionTimer = setInterval(async () => {
    attempts += 1;
    const ready = await checkSession({ silent: true });
    if (ready || attempts >= 150) {
      clearInterval(state.sessionTimer);
      state.sessionTimer = null;
    }
  }, 2000);
}

async function openLogin() {
  elements.loginButton.disabled = true;
  elements.loginButton.querySelector("span").textContent = "等待登录";
  setSessionStatus("checking");

  try {
    const response = await fetch("/api/session/open", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法打开登录窗口");
    if (payload.status === "qr") {
      refreshQrCode();
      elements.loginDialog.showModal();
    }
    startSessionPolling();
  } catch (error) {
    addWarning({ code: "LOGIN_FAILED", message: error.message });
    setSessionStatus("anonymous");
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.querySelector("span").textContent = "登录公文通";
  }
}

function refreshQrCode() {
  elements.loginDialogStatus.textContent = "等待扫码";
  elements.loginQrImage.src = `/api/session/qr?refresh=1&t=${Date.now()}`;
}

async function clearSession() {
  const confirmed = window.confirm("清除本机保存的深大登录会话和摘要缓存？");
  if (!confirmed) return;

  elements.clearButton.disabled = true;
  try {
    await fetch("/api/session/clear", { method: "POST" });
    state.notices.clear();
    state.warnings = [];
    state.doneReceived = false;
    render();
    setSessionStatus("anonymous");
  } finally {
    elements.clearButton.disabled = false;
  }
}

function setProgress({ stage, department, completed = 0, total = 0 }) {
  elements.progressWrap.hidden = false;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 10;
  elements.progressBar.style.width = `${percent}%`;

  const labels = {
    listing: department ? `正在查询 ${department}` : "正在查询发文单位",
    summarizing: "正在生成规则摘要",
    refining: "规则摘要已显示，正在生成 AI 摘要"
  };
  const suffix = total ? ` ${completed}/${total}` : "";
  elements.progressText.textContent = `${labels[stage] || "正在处理"}${suffix}`;
}

function addWarning(warning) {
  if (!warning?.message || state.warnings.some((item) => item.message === warning.message)) return;
  state.warnings.push(warning);
  renderWarnings();
}

function renderWarnings() {
  elements.warningList.replaceChildren();
  for (const warning of state.warnings) {
    const item = document.createElement("div");
    item.className = "warning-item";
    item.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path></svg>';
    const text = document.createElement("span");
    text.textContent = warning.message;
    item.append(text);
    elements.warningList.append(item);
  }
}

function updateNotice(payload) {
  const current = state.notices.get(payload.id) || {};
  state.notices.set(payload.id, { ...current, ...payload });
}

function renderFilters() {
  const total = state.notices.size;
  const definitions = [
    { name: "全部", count: total },
    ...state.departments.map((department) => ({
      name: department,
      count: state.byDepartment[department] || 0
    }))
  ];

  elements.filterTabs.replaceChildren();
  for (const definition of definitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.setAttribute("aria-pressed", String(state.filter === definition.name));
    button.textContent = definition.name;
    const count = document.createElement("span");
    count.textContent = definition.count;
    button.append(count);
    button.addEventListener("click", () => {
      state.filter = definition.name;
      render();
    });
    elements.filterTabs.append(button);
  }
}

function renderNotice(notice) {
  const fragment = elements.noticeTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".notice-item");
  const department = fragment.querySelector(".department-badge");
  const category = fragment.querySelector(".category-label");
  const summaryLabel = fragment.querySelector(".summary-label");
  const link = fragment.querySelector(".notice-title a");
  const title = link.querySelector("span");
  const time = fragment.querySelector(".notice-time");
  const list = fragment.querySelector(".summary-list");

  article.dataset.noticeId = notice.id;
  department.textContent = notice.department;
  category.textContent = notice.category || "通知";
  summaryLabel.textContent = notice.summarySource === "ai" ? "AI 摘要" : "规则摘要";
  summaryLabel.dataset.source = notice.summarySource;
  link.href = notice.url;
  title.textContent = notice.title;

  let timeText = `发布：${formatDateTime(notice.publishedAt)}`;
  if (notice.updatedAt) timeText += ` · 更新：${formatDateTime(notice.updatedAt)}`;
  if (!notice.exactTime) timeText += " · 日级时间";
  time.textContent = timeText;

  for (const bullet of notice.bullets || []) {
    const item = document.createElement("li");
    item.textContent = bullet;
    list.append(item);
  }

  return fragment;
}

function renderEmptyState() {
  const fragment = elements.emptyTemplate.content.cloneNode(true);
  const title = fragment.querySelector("#emptyTitle");
  const message = fragment.querySelector("#emptyMessage");

  if (state.queryRunning) {
    title.textContent = "正在查询";
    message.textContent = "结果会随查询进度逐步显示。";
  } else if (state.sessionStatus !== "ready") {
    title.textContent = "尚未连接公文通";
    message.textContent = "登录深圳大学统一身份认证后即可查询。";
  } else if (state.filter !== "全部") {
    title.textContent = `${state.filter}暂无通知`;
    message.textContent = "该单位在近 72 小时内没有新发布内容。";
  } else if (state.notices.size === 0 && state.doneReceived) {
    title.textContent = "近 72 小时暂无通知";
    message.textContent = `${state.departments.length} 个已选发文单位在时间范围内没有新发布内容。`;
  } else {
    title.textContent = "准备查询";
    message.textContent = "点击“查询近 72 小时”开始获取公文通信息。";
  }

  return fragment;
}

function render() {
  renderSelectedUnits();
  renderFilters();
  elements.noticeList.replaceChildren();
  renderWarnings();

  const notices = Array.from(state.notices.values())
    .filter((notice) => state.filter === "全部" || notice.department === state.filter)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  elements.resultCount.textContent = String(notices.length);

  if (!notices.length) {
    elements.noticeList.append(renderEmptyState());
    return;
  }

  for (const notice of notices) {
    elements.noticeList.append(renderNotice(notice));
  }
}

function finishQuery(payload) {
  state.queryRunning = false;
  state.doneReceived = true;
  elements.queryButton.disabled = false;
  elements.queryButton.classList.remove("is-loading");
  elements.queryButton.querySelector("span").textContent = "查询近 72 小时";

  if (payload.byDepartment) state.byDepartment = payload.byDepartment;
  if (payload.summaryMode) {
    state.summaryMode = payload.summaryMode;
    elements.summaryMode.textContent =
      payload.summaryMode === "ai" ? "本地 DeepSeek · 一到两句" : "口语化规则摘要";
  }
  elements.lastQueryText.textContent = payload.generatedAt
    ? `上次查询：${formatDateTime(payload.generatedAt)}`
    : "查询完成";
  elements.windowText.textContent = formatWindow(payload.windowStart, payload.windowEnd);
  elements.progressWrap.hidden = true;

  if (payload.status === "session-expired" || payload.status === "session-required") {
    setSessionStatus("anonymous");
  }
  render();
}

function startQuery() {
  if (state.queryRunning) return;

  if (!state.departments.length) {
    addWarning({ code: "NO_DEPARTMENT", message: "请先添加至少一个查询单位。" });
    return;
  }

  if (state.sessionStatus !== "ready") {
    openLogin();
    addWarning({
      code: "SESSION_REQUIRED",
      message: "请先在打开的深大官方页面完成登录，然后再次点击查询。"
    });
    return;
  }

  state.notices.clear();
  state.warnings = [];
  state.byDepartment = Object.fromEntries(state.departments.map((department) => [department, 0]));
  state.filter = "全部";
  state.queryRunning = true;
  state.doneReceived = false;
  elements.queryButton.disabled = true;
  elements.queryButton.classList.add("is-loading");
  elements.queryButton.querySelector("span").textContent = "查询中";
  elements.lastQueryText.textContent = "正在查询";
  elements.progressWrap.hidden = false;
  elements.progressBar.style.width = "6%";
  elements.progressText.textContent = "正在连接公文通";
  render();

  const query = new URLSearchParams();
  for (const department of state.departments) query.append("department", department);
  const source = new EventSource(`/api/query/stream?${query.toString()}`);

  source.addEventListener("progress", (event) => {
    setProgress(JSON.parse(event.data));
  });

  source.addEventListener("notice", (event) => {
    updateNotice(JSON.parse(event.data));
    render();
  });

  source.addEventListener("summary", (event) => {
    const payload = JSON.parse(event.data);
    const current = state.notices.get(payload.id);
    if (!current) return;
    updateNotice({ ...current, ...payload });
    render();
  });

  source.addEventListener("warning", (event) => {
    addWarning(JSON.parse(event.data));
  });

  source.addEventListener("done", (event) => {
    state.doneReceived = true;
    finishQuery(JSON.parse(event.data));
    source.close();
  });

  source.onerror = () => {
    if (state.doneReceived) return;
    state.doneReceived = true;
    finishQuery({ status: "error", generatedAt: new Date().toISOString() });
    addWarning({ code: "STREAM_FAILED", message: "查询连接中断，请重试。" });
    source.close();
  };
}

elements.loginButton.addEventListener("click", openLogin);
elements.clearButton.addEventListener("click", clearSession);
elements.queryButton.addEventListener("click", startQuery);
elements.refreshLoginQr.addEventListener("click", refreshQrCode);
elements.closeLoginDialog.addEventListener("click", () => elements.loginDialog.close());
elements.openDepartmentDialog.addEventListener("click", () => showDepartmentManager());
elements.resetDepartments.addEventListener("click", () => {
  state.departments = [...DEFAULT_DEPARTMENTS];
  state.notices.clear();
  state.doneReceived = false;
  state.filter = "全部";
  saveDepartments();
  render();
});
elements.departmentSearch.addEventListener("input", (event) => {
  renderDepartmentOptions(event.target.value);
});
elements.closeDepartmentDialog.addEventListener("click", () => elements.departmentDialog.close());
elements.cancelDepartmentDialog.addEventListener("click", () => elements.departmentDialog.close());
elements.saveDepartmentDialog.addEventListener("click", persistDialogDepartments);

render();
loadDepartmentCatalog();
checkSession();
