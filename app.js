/* =========================================
   LifePlan – Dashboard + Accounts
   ========================================= */

const buttons = document.querySelectorAll(".navButton");
const APP_VERSION = "V1.1.77";
const page = document.getElementById("pageContent");

// ---------- Default empty plan ----------
const defaultPlan = {
  meta: {
    name: "Untitled Plan",
    created: new Date().toISOString().slice(0, 10),
    lastSaved: null,
    version: "0.4.0",
    wizardComplete: false
  },
  settings: {
    showWizardOnNew: true,
    linkDates: true,
    autoHideSidebar: false,
    expertMode: false,
    wheelIncrement: 1
  },
  isJoint: true,
  people: [
    { id: "p1", name: "", dateOfBirth: "", role: "Primary" },
    { id: "p2", name: "", dateOfBirth: "", role: "Partner" }
  ],
  accounts: [],
  income: [],
  spend: {
    essentialAnnual: 0,
    targetBase: 0,              // annual NES target in today's money (0 until user/reset sets it)
    fundUntil: new Date().getFullYear() + 30,
    showInflation: false,
    inflationRate: 0.025,       // 2.5% default
    // per-year overrides for target line: { "2030": 12000, ... }
    targetOverrides: {},
    modelRatio: 1,
    bandPct: 0.1,
    minNetWorthAtFund: 0,       // residual savings target at Fund until (£)
    // user-defined spend pots: [{ id, name, amountAnnual }]
    pots: []
  },
  scale: {
    startYear: new Date().getFullYear(),
    endYear: new Date().getFullYear() + 40
  },
  dashboard: {
    widgets: ["spend_stack", "stacked_nw"]
  }
};

// ---------- Current Plan ----------
let currentPlan = loadCurrentPlan();

function loadCurrentPlan() {
  try {
    const saved = localStorage.getItem("lifeplan_current");
    if (saved) {
      const data = JSON.parse(saved);
      // Ensure accounts array exists (for older saves)
      if (!data.accounts) data.accounts = [];
      if (!data.income) data.income = [];
      if (!data.spend) {
        data.spend = {
          essentialAnnual: 0,
          targetBase: 0,
          fundUntil: (data.scale?.startYear || new Date().getFullYear()) + 30,
          showInflation: false,
          inflationRate: 0.025,
          targetOverrides: {},
          modelRatio: 1,
          bandPct: 0.1,
          pots: []
        };
      }
      if (data.spend.modelRatio == null) data.spend.modelRatio = 1;
      if (data.spend.minNetWorthAtFund == null) data.spend.minNetWorthAtFund = 0;
      if (data.spend.bandPct == null) data.spend.bandPct = 0.1;
      if (data.spend.targetBase == null || isNaN(Number(data.spend.targetBase))) data.spend.targetBase = 0;
      if (!data.scale) data.scale = { startYear: new Date().getFullYear(), endYear: new Date().getFullYear() + 40 };
      if (!data.dashboard) data.dashboard = { widgets: ["spend_stack", "stacked_nw"] };
      if (!data.settings) data.settings = {};
      data.settings = {
        showWizardOnNew: true,
        expertMode: false,
        wheelIncrement: 1,
        ...data.settings
      };
      data.settings.wheelIncrement = Math.max(1, Math.round(Number(data.settings.wheelIncrement) || 1));
      if (data.meta && data.meta.wizardComplete === undefined) {
        const empty = !(data.accounts || []).length && !(data.income || []).length;
        data.meta.wizardComplete = !empty; // empty plans still get wizard
      }
      if (!data.strategies) data.strategies = null; // ensureStrategies will seed default
      return data;
    }
  } catch (e) {}
  return structuredClone(defaultPlan);
}

function autoSave() {
  if (!_undoIgnore && typeof pushUndoSnapshot === "function") {
    // throttle snapshots
    clearTimeout(window._undoPushT);
    window._undoPushT = setTimeout(() => pushUndoSnapshot(), 400);
  }
  currentPlan.meta.lastSaved = new Date().toISOString();
  localStorage.setItem("lifeplan_current", JSON.stringify(currentPlan));
  updateSaveStatus();
}

function updateSaveStatus() {
  let el = document.getElementById("saveStatus");
  if (!el) {
    const actions = document.querySelector(".page-header .header-actions");
    if (actions) {
      el = document.createElement("span");
      el.id = "saveStatus";
      el.className = "save-status";
      actions.prepend(el);
    }
  }
  if (!el) return;
  const ver = (typeof APP_VERSION !== "undefined") ? APP_VERSION + " · " : "";
  if (currentPlan.meta?.lastSaved) {
    const d = new Date(currentPlan.meta.lastSaved);
    el.textContent = ver + "Auto-saved " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    el.textContent = ver + "Not saved yet";
  }
  // Sidebar version stamp
  const sideVer = document.querySelector(".sidebar-bottom .version");
  if (sideVer && typeof APP_VERSION !== "undefined") sideVer.textContent = APP_VERSION;
}


function getInflationPct() {
  const r = Number(currentPlan.spend?.inflationRate);
  if (isFinite(r)) return r * 100;
  return 2.5;
}

/** Resolve effective annual growth % from mode fields */
function resolveGrowthPct(obj) {
  let mode = obj?.growthMode || (obj?.inflate === false ? "none" : "inflation");
  if (mode === "custom") mode = "other";
  const infl = getInflationPct();
  if (mode === "inflation") return infl;
  if (mode === "inflation_plus") return infl + (Number(obj.growthAdj) || 0);
  if (mode === "none") return 0;
  // other / free rate
  if (obj.growthCustom != null) return Number(obj.growthCustom) || 0;
  if (obj.annualGrowth != null) return Number(obj.annualGrowth) || 0;
  if (obj.growthRate != null) return Number(obj.growthRate) || 0;
  return infl;
}

function renderGrowthModeFields(prefix, obj, defaultCustom) {
  // Normalize legacy "custom" free-rate → "other"
  let mode = obj?.growthMode || "inflation";
  if (mode === "custom") mode = "other";
  const infl = getInflationPct();
  const other = obj?.growthCustom != null ? obj.growthCustom : (defaultCustom != null ? defaultCustom : (obj?.growthRate ?? obj?.annualGrowth ?? 5));
  const adj = obj?.growthAdj != null ? obj.growthAdj : 0;
  const valShow = mode === "inflation" ? infl : (mode === "inflation_plus" ? adj : other);
  return `
    <div class="form-group growth-mode-block">
      <label>Growth rate</label>
      <div class="growth-rate-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="${prefix}GrowthMode" onchange="onGrowthModeChange('${prefix}')" style="flex:1;min-width:140px;">
          <option value="inflation" ${mode === "inflation" ? "selected" : ""}>Inflation</option>
          <option value="other" ${mode === "other" ? "selected" : ""}>Other rate</option>
          <option value="inflation_plus" ${mode === "inflation_plus" ? "selected" : ""}>Inflation adjusted</option>
          <option value="custom" disabled>Custom</option>
        </select>
        <input type="number" id="${prefix}GrowthVal" step="0.1" style="width:88px;"
          value="${valShow}"
          ${mode === "inflation" ? "readonly" : ""}>
        <span class="field-hint" id="${prefix}GrowthHint" style="flex:1;min-width:120px;">
          ${mode === "inflation" ? `% locked (${infl.toFixed(1)}%)` :
            mode === "inflation_plus" ? `adj → effective ${(infl + adj).toFixed(1)}%` :
            "% per year"}
        </span>
      </div>
    </div>`;
}

function onGrowthModeChange(prefix) {
  const mode = document.getElementById(prefix + "GrowthMode")?.value || "inflation";
  const val = document.getElementById(prefix + "GrowthVal");
  const hint = document.getElementById(prefix + "GrowthHint");
  const infl = getInflationPct();
  if (!val) return;
  if (mode === "inflation") {
    val.value = String(infl);
    val.readOnly = true;
    if (hint) hint.textContent = `% locked (${infl.toFixed(1)}%)`;
  } else if (mode === "inflation_plus") {
    val.readOnly = false;
    const adj = parseFloat(val.value) || 0;
    if (hint) hint.textContent = `adj → effective ${(infl + adj).toFixed(1)}%`;
    val.oninput = () => {
      const a = parseFloat(val.value) || 0;
      if (hint) hint.textContent = `adj → effective ${(infl + a).toFixed(1)}%`;
    };
  } else if (mode === "other") {
    val.readOnly = false;
    if (hint) hint.textContent = "% per year";
  } else {
    val.readOnly = true;
    if (hint) hint.textContent = "Coming later";
  }
}
window.onGrowthModeChange = onGrowthModeChange;

function readGrowthModeFields(prefix) {
  const mode = document.getElementById(prefix + "GrowthMode")?.value || "inflation";
  const raw = parseFloat(document.getElementById(prefix + "GrowthVal")?.value);
  const infl = getInflationPct();
  const out = { growthMode: mode };
  if (mode === "inflation") {
    out.growthRate = infl;
    out.annualGrowth = infl;
  } else if (mode === "inflation_plus") {
    out.growthAdj = isFinite(raw) ? raw : 0;
    out.growthRate = infl + out.growthAdj;
    out.annualGrowth = out.growthRate;
  } else if (mode === "other") {
    out.growthCustom = isFinite(raw) ? raw : 0;
    out.growthRate = out.growthCustom;
    out.annualGrowth = out.growthCustom;
  } else {
    out.growthRate = infl;
    out.annualGrowth = infl;
  }
  return out;
}


// ---------- Undo / Redo (25 steps) ----------
const UNDO_LIMIT = 25;
let undoStack = [];
let redoStack = [];
let _undoIgnore = false;

function pushUndoSnapshot(label) {
  if (_undoIgnore) return;
  try {
    const snap = JSON.stringify(currentPlan);
    if (undoStack.length && undoStack[undoStack.length - 1].data === snap) return;
    const lab = label || window._lastActionLabel || "Plan change";
    undoStack.push({ data: snap, label: lab, t: Date.now() });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  } catch (e) {}
}
function noteAction(label) {
  window._lastActionLabel = label || "Plan change";
}
window.noteAction = noteAction;

function showUndoToast(msg) {
  document.getElementById("undoToast")?.remove();
  const t = document.createElement("div");
  t.id = "undoToast";
  t.className = "undo-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(window._undoToastT);
  window._undoToastT = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 280);
  }, 4000);
}

function undoPlan() {
  if (undoStack.length < 2) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  if (!prev) return;
  _undoIgnore = true;
  try {
    currentPlan = JSON.parse(prev.data);
    autoSave();
    const active = document.querySelector(".navButton.active");
    if (active) active.click();
    else {
      page.innerHTML = renderDashboard();
      if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
    }
    showUndoToast("Undid → back to: " + (prev.label || "earlier plan state"));
  } finally {
    _undoIgnore = false;
    updateUndoRedoButtons();
    updateSaveStatus();
  }
}

function redoPlan() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(next);
  _undoIgnore = true;
  try {
    currentPlan = JSON.parse(next.data);
    autoSave();
    const active = document.querySelector(".navButton.active");
    if (active) active.click();
    showUndoToast("Redid → " + (next.label || "restored change"));
  } finally {
    _undoIgnore = false;
    updateUndoRedoButtons();
    updateSaveStatus();
  }
}

function updateUndoRedoButtons() {
  const u = document.getElementById("btnUndo");
  const r = document.getElementById("btnRedo");
  if (u) u.disabled = undoStack.length < 2;
  if (r) r.disabled = redoStack.length < 1;
}
window.undoPlan = undoPlan;
window.redoPlan = redoPlan;

// ---------- File helpers ----------
function householdLabel() {
  const names = (currentPlan.people || []).map(p => p.name).filter(Boolean);
  if (!names.length) return "No Name";
  if (names.length === 1) return names[0] + "'s";
  if (names.length === 2) return names[0] + " & " + names[1] + "'s";
  return names.slice(0, -1).join(", ") + " & " + names[names.length - 1] + "'s";
}

function planTitle() {
  return (currentPlan.meta?.name && String(currentPlan.meta.name).trim()) || "Untitled plan";
}

/** Custom modal — avoids browser "This page says" chrome */
function appConfirm(message, { yesLabel = "Yes", noLabel = "No", cancelLabel = "Cancel", showCancel = true, alertOnly = false } = {}) {
  return new Promise(resolve => {
    document.getElementById("appDialog")?.remove();
    const backdrop = document.createElement("div");
    backdrop.id = "appDialog";
    backdrop.className = "app-dialog-backdrop";
    const actions = alertOnly
      ? `<button type="button" class="btn-primary" data-r="yes">${yesLabel}</button>`
      : `${showCancel ? `<button type="button" class="btn-secondary" data-r="cancel">${cancelLabel}</button>` : ""}
          <button type="button" class="btn-secondary" data-r="no">${noLabel}</button>
          <button type="button" class="btn-primary" data-r="yes">${yesLabel}</button>`;
    backdrop.innerHTML = `
      <div class="app-dialog" role="dialog" aria-modal="true">
        <div class="app-dialog-body">${String(message).replace(/\n/g, "<br>")}</div>
        <div class="app-dialog-actions">${actions}</div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        backdrop.remove();
        resolve(btn.dataset.r);
      });
    });
  });
}
window.appConfirm = appConfirm;

function appAlert(message) {
  return appConfirm(message, { yesLabel: "OK", alertOnly: true }).then(() => {});
}
window.appAlert = appAlert;

/** Replace browser chrome ("This page says…") for simple alerts */
window.alert = function (message) {
  appAlert(String(message == null ? "" : message));
};

/**
 * Async confirm that returns boolean. Prefer this over native confirm().
 * Usage: if (!(await appConfirmYesNo("Delete?"))) return;
 */
async function appConfirmYesNo(message, yesLabel = "Yes", noLabel = "No") {
  const r = await appConfirm(message, { yesLabel, noLabel, showCancel: false });
  return r === "yes";
}
window.appConfirmYesNo = appConfirmYesNo;

function defaultDownloadFilename() {
  // Prefer explicit file name from a prior load/save
  if (currentPlan.meta?.fileName) return currentPlan.meta.fileName;
  const peopleBit = (currentPlan.people || []).map(p => p.name).filter(Boolean).join("-") || "Plan";
  const titleBit = planTitle();
  return (peopleBit + "___" + titleBit)
    .replace(/[^a-z0-9\- _]/gi, "")
    .replace(/\s+/g, " ")
    .trim() + ".lifeplan.json";
}

function triggerDownload(filename) {
  const blob = new Blob([JSON.stringify(currentPlan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  currentPlan.meta.fileName = filename;
  currentPlan.meta.lastSaved = new Date().toISOString();
  autoSave();
  updateSaveStatus();
  updateSidebarPlanLabel();
}

/** Save — reuse last file name; warn about overwrite (browser always downloads a new copy). */
async function savePlan() {
  const name = currentPlan.meta?.fileName || defaultDownloadFilename();
  if (currentPlan.meta?.fileName) {
    if (!(await appConfirmYesNo("Overwrite / replace the file named:\n\n" + name + "\n\n(Your browser will download a file with this name — replace the old one in your Downloads folder if needed.)", "Save", "Cancel"))) {
      return;
    }
  } else {
    if (!(await appConfirmYesNo("Save as:\n\n" + name + "\n\nContinue?", "Save", "Cancel"))) return;
  }
  noteAction("Save plan");
  triggerDownload(name);
}
window.savePlan = savePlan;

/** Save As — choose a new name */
function savePlanAs() {
  const suggested = defaultDownloadFilename().replace(/\.lifeplan\.json$/i, "");
  const entered = prompt("Save As — file name (without path):", suggested);
  if (entered === null) return;
  let filename = entered.trim() || suggested;
  if (!/\.json$/i.test(filename)) filename += ".lifeplan.json";
  noteAction("Save plan as");
  triggerDownload(filename);
}
window.savePlanAs = savePlanAs;

// Back-compat alias
function downloadPlan() { savePlanAs(); }

function importPlan() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.lifeplan.json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.people) {
          alert("This does not look like a valid LifePlan file.");
          return;
        }
        if (!data.accounts) data.accounts = [];
        if (!data.income) data.income = [];
        if (!data.spend) {
          data.spend = {
            essentialAnnual: 0, targetBase: 0,
            fundUntil: (data.scale?.startYear || new Date().getFullYear()) + 30,
            showInflation: false, inflationRate: 0.025,
            targetOverrides: {}, modelRatio: 1, bandPct: 0.1, pots: []
          };
        }
        if (!data.scale) data.scale = { startYear: new Date().getFullYear(), endYear: new Date().getFullYear() + 40 };
        if (!data.dashboard) data.dashboard = { widgets: ["spend_stack", "stacked_nw"] };
        if (!data.meta) data.meta = {};
        data.meta.fileName = file.name;
        currentPlan = data;
        autoSave();
        updateSidebarPlanLabel();
        const active = document.querySelector(".navButton.active");
        if (active) active.click();
        alert("Plan imported successfully!");
      } catch (err) {
        alert("Could not read that file.");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

async function newPlan() {
  const choice = await appConfirm(
    "Start a new blank plan?\n\nYes — save this plan first, then start new\nNo — start new without saving\nCancel — keep working on this plan",
    { yesLabel: "Yes, save first", noLabel: "No, don't save", cancelLabel: "Cancel" }
  );
  if (choice === "cancel") return;
  if (choice === "yes") {
    savePlanAs();
  }
  currentPlan = structuredClone(defaultPlan);
  currentPlan.meta.wizardComplete = false;
  currentPlan.meta.fileName = null;
  currentPlan.meta.name = "Untitled plan";
  // people start empty-named so sidebar shows "No Name"
  autoSave();
  updateSidebarPlanLabel();
  const active = document.querySelector(".navButton.active");
  if (active) active.click();
  if (currentPlan.settings?.showWizardOnNew !== false) {
    setTimeout(() => startWizard(), 100);
  }
}

function updateSidebarPlanLabel() {
  const nameEl = document.querySelector(".sidebar-bottom .user-name");
  const planEl = document.querySelector(".sidebar-bottom .user-plan");
  const names = (currentPlan.people || []).map(p => p.name).filter(Boolean);
  // Top line: household (or "No Name") — bottom: plan title
  if (nameEl) {
    nameEl.textContent = names.length ? (householdLabel() + " Plan") : "No Name";
  }
  if (planEl) planEl.textContent = planTitle();
  const av = document.querySelector(".sidebar-bottom .avatar");
  if (av) {
    av.textContent = names.length ? names.map(x => x[0]).join("").slice(0, 2).toUpperCase() : "—";
  }
}
window.updateSidebarPlanLabel = updateSidebarPlanLabel;

function openPlanNameEditor() {
  document.getElementById("planNamePop")?.remove();
  const pop = document.createElement("div");
  pop.id = "planNamePop";
  pop.className = "plan-name-pop";
  pop.innerHTML = `
    <div class="plan-name-pop-title">Plan identity</div>
    <div class="form-group">
      <label>Household (people)</label>
      <input type="text" id="pnHousehold" value="${escapeHtml(householdLabel())}" readonly title="Edit names on the People page">
    </div>
    <div class="form-group">
      <label>Plan name</label>
      <input type="text" id="pnTitle" value="${escapeHtml(planTitle())}" placeholder="e.g. First plan">
    </div>
    <p class="field-hint">File name will be like: ${(currentPlan.people || []).map(p => p.name).filter(Boolean).join("-") || "Plan"}___${planTitle()}.lifeplan.json</p>
    <div class="node-edit-actions">
      <button type="button" class="btn-primary btn-sm" id="pnApply">Apply</button>
      <button type="button" class="btn-secondary btn-sm" id="pnClose">✕</button>
    </div>`;
  document.body.appendChild(pop);
  const card = document.querySelector(".sidebar-bottom .user-card");
  if (card) {
    const r = card.getBoundingClientRect();
    pop.style.left = Math.min(window.innerWidth - 280, Math.max(8, r.left)) + "px";
    pop.style.bottom = (window.innerHeight - r.top + 8) + "px";
  }
  pop.querySelector("#pnClose").onclick = () => pop.remove();
  pop.querySelector("#pnApply").onclick = () => {
    currentPlan.meta.name = (document.getElementById("pnTitle").value || "Plan").trim();
    // If they had an auto-generated file name, clear so next save uses new convention
    if (currentPlan.meta.fileName && /___/.test(currentPlan.meta.fileName)) {
      currentPlan.meta.fileName = null;
    }
    autoSave();
    updateSidebarPlanLabel();
    pop.remove();
  };
  document.getElementById("pnTitle")?.focus();
}
window.openPlanNameEditor = openPlanNameEditor;

// ---------- Helpers ----------
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "£" + Math.round(n).toLocaleString();
}

function getPersonName(id) {
  const p = currentPlan.people.find(x => x.id === id);
  return p && p.name ? p.name : "—";
}

function uid() {
  return "a" + Math.random().toString(36).slice(2, 9);
}

// Calculate simple current net worth (sum of start balances)
function calcNetWorth() {
  let total = 0;
  currentPlan.accounts.forEach(acc => {
    total += Number(acc.startBalance) || 0;
  });
  return total;
}

// Projected series using plan scale
function getPlanYears() {
  const start = currentPlan.scale?.startYear || new Date().getFullYear();
  const end = currentPlan.scale?.endYear || start + 40;
  const years = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

function calcAccountSeries(acc, years) {
  const startBal = Number(acc.startBalance) || 0;
  const growth = resolveGrowthPct(acc) / 100;
  const accStart = acc.startDate ? new Date(acc.startDate).getFullYear() : years[0];
  const values = [];
  const overridden = [];
  years.forEach(y => {
    const yearsPassed = Math.max(0, y - accStart);
    let val = startBal * Math.pow(1 + growth, yearsPassed);
    let isOver = false;
    if (acc.overrides && Object.keys(acc.overrides).length) {
      const idx = y - accStart;
      if (acc.overrides[idx] !== undefined) {
        val = acc.overrides[idx];
        isOver = true;
      } else {
        const overrideYears = Object.keys(acc.overrides).map(Number).sort((a, b) => a - b);
        for (const oy of overrideYears) {
          if (accStart + oy <= y) val = acc.overrides[oy];
        }
      }
    }
    values.push(Math.round(val));
    overridden.push(isOver);
  });
  return { values, overridden };
}

/** Fraction of a calendar year this income is active (start/end dates). */
function incomeYearFraction(inc, year) {
  const y0 = new Date(year, 0, 1).getTime();
  const y1 = new Date(year + 1, 0, 1).getTime();
  const start = inc.startDate ? new Date(inc.startDate).getTime() : y0;
  const end = inc.endDate ? new Date(inc.endDate).getTime() + 86400000 : y1; // inclusive end day
  const from = Math.max(y0, start);
  const to = Math.min(y1, end);
  if (to <= from) return 0;
  return Math.min(1, Math.max(0, (to - from) / (y1 - y0)));
}

function calcIncomeForYear(year) {
  let annual = 0;
  const planStart = currentPlan.scale?.startYear || new Date().getFullYear();
  (currentPlan.income || []).forEach(inc => {
    const startY = inc.startDate ? new Date(inc.startDate).getFullYear() : planStart;
    const endY = inc.endDate ? new Date(inc.endDate).getFullYear() : 9999;
    if (year < startY || year > endY) return;
    const frac = incomeYearFraction(inc, year);
    if (frac <= 0) return;
    // Amounts are "as of now / as entered" — only grow from plan start (or income start if later).
    // Avoids inflating a current state pension from a 2007 SPA date for 19 years.
    const growthBaseYear = Math.max(startY, planStart);
    const yearsPassed = Math.max(0, year - growthBaseYear);

    if (inc.type === "db_pension") {
      // Split: inflating part + flat part (already in expected-at-start terms)
      const infl0 = Number(inc.dbInflatingAnnual);
      const flat0 = Number(inc.dbFlatAnnual);
      const total0 = Number(inc.dbIncomeAnnual) || ((Number(inc.amountMonthly) || 0) * 12);
      const inflating = isFinite(infl0) ? infl0 : total0;
      const flat = isFinite(flat0) ? flat0 : 0;
      const custom = inc.dbCustomRate != null && inc.dbCustomRate !== "" ? Number(inc.dbCustomRate) / 100 : null;
      const rate = custom != null && isFinite(custom) ? custom : getInflationRate();
      const part = inflating * Math.pow(1 + rate, yearsPassed) + flat;
      annual += part * frac;
      return;
    }

    const growth = resolveGrowthPct(inc) / 100;
    const monthly = (Number(inc.amountMonthly) || 0) * Math.pow(1 + growth, yearsPassed);
    annual += monthly * 12 * frac;
  });
  return annual;
}


// ---------- STRATEGY (default drawdown / surplus) ----------
const CASH_TYPES = ["current_savings", "cash_isa", "premium_bonds"];
const DEFAULT_WITHDRAWAL_ORDER = ["current_savings"];
const DEFAULT_SURPLUS_ORDER = ["current_savings"];
const FULL_WITHDRAWAL_ORDER = [
  "current_savings", "cash_isa", "premium_bonds",
  "gia", "s_and_s_isa", "other", "sipp", "sipp_drawdown"
];
const FULL_SURPLUS_ORDER = [
  "current_savings", "cash_isa", "s_and_s_isa", "sipp", "gia", "premium_bonds", "other"
  // sipp_drawdown intentionally omitted — cannot add contributions
];

function ensureStrategies() {
  const start = currentPlan.scale?.startYear || new Date().getFullYear();
  const end = currentPlan.scale?.endYear || start + 40;
  if (!currentPlan.strategies || !currentPlan.strategies.length) {
    currentPlan.strategies = [{
      id: "default",
      preset: "steady",
      name: "Default / Steady",
      isDefault: true,
      fromYear: start,
      toYear: end,
      cashBufferMonths: 24,
      withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER.slice(),
      surplusOrder: DEFAULT_SURPLUS_ORDER.slice(),
      notes: "All flows through current/savings. Simple default so the model always works."
    }];
  }
  // Keep default spanning plan if years were never customised
  currentPlan.strategies.forEach(s => {
    if (s.fromYear == null) s.fromYear = start;
    if (s.toYear == null) s.toYear = end;
    if (!s.preset) s.preset = s.isDefault ? "steady" : "steady";
    // Steady / default hub: force current_savings-only flow
    if (s.preset === "steady" || s.isDefault) {
      if (!s.withdrawalOrder || s.withdrawalOrder.length !== 1 || s.withdrawalOrder[0] !== "current_savings") {
        s.withdrawalOrder = DEFAULT_WITHDRAWAL_ORDER.slice();
      }
      if (!s.surplusOrder || s.surplusOrder.length !== 1 || s.surplusOrder[0] !== "current_savings") {
        s.surplusOrder = DEFAULT_SURPLUS_ORDER.slice();
      }
    }
  });
  return currentPlan.strategies;
}

const STRATEGY_PRESETS = [
  { key: "steady", name: "Default / Steady", tone: "green", icon: "⌂" },
  { key: "building", name: "Building", tone: "purple", icon: "⚒" },
  { key: "retire", name: "Starting to Retire", tone: "teal", icon: "🛋" },
  { key: "late", name: "Late Life", tone: "orange", icon: "♿" }
];

function getStrategyForYear(year) {
  ensureStrategies();
  const list = currentPlan.strategies;
  const hit = list.find(s => year >= (s.fromYear || 0) && year <= (s.toYear || 9999));
  return hit || list.find(s => s.isDefault) || list[0];
}

function cashBufferTarget(strategy) {
  ensureSpend();
  const essential = (currentPlan.spend.pots || [])
    .filter(p => p.isEssential)
    .reduce((s, p) => s + (Number(p.amountAnnual) || 0), 0)
    || (Number(currentPlan.spend.essentialAnnual) || 20000);
  const months = Number(strategy?.cashBufferMonths) || 24;
  return (essential / 12) * months;
}

/**
 * Year-by-year projection with strategy: grow → income − spend → draw/surplus by order.
 * Optional targetFn(year) overrides NES for goal-seek simulations.
 * opts.allowNegative — for goal-seek only: track unmet shortfall so NW can go below 0
 *   (avoids the “flat zero plateau” where any overspend still shows endNW = 0).
 */
function calcProjectedNetWorth(targetFn, opts) {
  ensureStrategies();
  const years = getPlanYears();
  const accounts = currentPlan.accounts || [];
  const allowNegative = !!(opts && opts.allowNegative);

  const balances = {};
  const series = {};
  accounts.forEach(acc => {
    balances[acc.id] = Number(acc.startBalance) || 0;
    series[acc.id] = {
      name: acc.name,
      color: acc.themeColor || "#7C3AED",
      values: [],
      overridden: [],
      type: acc.type
    };
  });

  let cumIncome = 0;
  let cumSpend = 0;
  let unmetDebt = 0; // cumulative shortfall when pots can't cover spend
  const incomeValues = [];
  const spendValues = [];
  const interestByYear = {};
  const interestDetailByYear = {};

  years.forEach((year, yi) => {
    const strat = getStrategyForYear(year);
    let yearInterest = 0;
    const interestDetail = [];

    accounts.forEach(acc => {
      const growth = resolveGrowthPct(acc) / 100;
      const accStart = acc.startDate ? new Date(acc.startDate).getFullYear() : years[0];
      let isOver = false;
      if (year < accStart) {
        balances[acc.id] = 0;
      } else if (acc.overrides && Object.keys(acc.overrides).length) {
        const idx = year - accStart;
        if (acc.overrides[idx] !== undefined) {
          balances[acc.id] = Number(acc.overrides[idx]);
          isOver = true;
        } else if (acc.overrides[year] !== undefined) {
          balances[acc.id] = Number(acc.overrides[year]);
          isOver = true;
        } else if (yi > 0) {
          const before = balances[acc.id] || 0;
          balances[acc.id] = before * (1 + growth);
          const earned = (balances[acc.id] || 0) - before;
          if (Math.abs(earned) > 0.001) {
            yearInterest += earned;
            interestDetail.push({ name: (acc.name || "Account") + " interest", amount: earned, type: acc.type });
          }
        }
      } else if (yi === 0) {
        balances[acc.id] = Number(acc.startBalance) || 0;
      } else {
        const before = balances[acc.id] || 0;
        balances[acc.id] = before * (1 + growth);
        const earned = (balances[acc.id] || 0) - before;
        if (Math.abs(earned) > 0.001) {
          yearInterest += earned;
          interestDetail.push({ name: (acc.name || "Account") + " interest", amount: earned, type: acc.type });
        }
      }
      series[acc.id]._over = isOver;
    });

    interestByYear[year] = yearInterest;
    interestDetailByYear[year] = interestDetail;

    const income = calcIncomeForYear(year);
    const tax = typeof calcTaxForYear === "function" ? calcTaxForYear(year) : 0;
    const spend = getTotalOutflowForYear(year, targetFn);
    // Growth already applied. Cashflow: income − tax − spend (incl. one-offs)
    let net = income - tax - spend;
    cumIncome += income + yearInterest;
    cumSpend += spend;
    incomeValues.push(Math.round(cumIncome));
    spendValues.push(-Math.round(cumSpend));

    function accountsOfType(type) {
      return accounts
        .filter(a => a.type === type)
        .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));
    }
    function hubAcc() {
      const hubs = accountsOfType("current_savings");
      return hubs[0] || accounts[0] || null;
    }
    function resolveActionAccount(act) {
      if (act.accountId) {
        const byId = accounts.find(a => a.id === act.accountId);
        if (byId) return byId;
      }
      if (act.accountType) {
        const list = accountsOfType(act.accountType);
        if (list.length) return list[0];
      }
      return null;
    }
    function transferBetween(fromId, toId, amount) {
      if (!fromId || !toId || fromId === toId || amount <= 0) return 0;
      const toAcc = accounts.find(a => a.id === toId);
      // SIPP in drawdown cannot receive contributions / surplus top-ups
      if (toAcc && isSippDrawdownType(toAcc.type)) return 0;
      const avail = Math.max(0, balances[fromId] || 0);
      const move = Math.min(amount, avail);
      balances[fromId] = avail - move;
      balances[toId] = (balances[toId] || 0) + move;
      return move;
    }

    // 1) Shortfall: draw from specific action accounts first, then withdrawal order
    if (net < 0) {
      let need = -net;
      for (const act of (strat.actions || [])) {
        if (need <= 0) break;
        if (act.type !== "draw_account" && act.type !== "draw_type") continue;
        const acc = resolveActionAccount(act);
        if (!acc) continue;
        const avail = Math.max(0, balances[acc.id] || 0);
        const take = Math.min(need, avail);
        balances[acc.id] = avail - take;
        need -= take;
      }
      const order = (strat.withdrawalOrder && strat.withdrawalOrder.length)
        ? strat.withdrawalOrder
        : DEFAULT_WITHDRAWAL_ORDER;
      for (const type of order) {
        if (need <= 0) break;
        for (const acc of accountsOfType(type)) {
          if (need <= 0) break;
          const avail = Math.max(0, balances[acc.id] || 0);
          const take = Math.min(need, avail);
          balances[acc.id] = avail - take;
          need -= take;
        }
      }
      // Still short after emptying pots
      if (need > 0) {
        if (allowNegative) unmetDebt += need;
        // live model: spend simply can't happen beyond cash — NW floors at 0
      }
    }

    // 2) Surplus: pay down unmet debt first (goal-seek), then land in hub
    const surplusIn = Math.max(0, net);
    if (net > 0) {
      let surplus = net;
      if (allowNegative && unmetDebt > 0) {
        const pay = Math.min(unmetDebt, surplus);
        unmetDebt -= pay;
        surplus -= pay;
      }
      if (surplus > 0) {
        const sOrder = (strat.surplusOrder && strat.surplusOrder.length)
          ? strat.surplusOrder
          : DEFAULT_SURPLUS_ORDER;
        let placed = false;
        for (const type of sOrder) {
          if (isSippDrawdownType(type)) continue;
          const list = accountsOfType(type).filter(a => !isSippDrawdownType(a.type));
          if (list.length) {
            balances[list[0].id] = (balances[list[0].id] || 0) + surplus;
            placed = true;
            break;
          }
        }
        if (!placed && accounts.length) {
          const hub = hubAcc();
          if (hub) balances[hub.id] = (balances[hub.id] || 0) + surplus;
        }
      }
    }

    // 3) Custom actions (transfers, buffer) — after cashflow has hit the hub
    const hub = hubAcc();
    for (const act of (strat.actions || [])) {
      if (act.type === "transfer_fixed") {
        const target = resolveActionAccount(act);
        if (!hub || !target) continue;
        transferBetween(hub.id, target.id, Number(act.amount) || 0);
      } else if (act.type === "transfer_pct") {
        const target = resolveActionAccount(act);
        if (!hub || !target) continue;
        const pct = (Number(act.amount) || 0) / 100;
        const amt = Math.max(0, surplusIn * pct);
        transferBetween(hub.id, target.id, amt);
      } else if (act.type === "topup_buffer") {
        if (!hub) continue;
        const targetBuf = typeof cashBufferTarget === "function" ? cashBufferTarget(strat) : 0;
        let cashNow = accounts
          .filter(a => CASH_TYPES.includes(a.type))
          .reduce((s, a) => s + Math.max(0, balances[a.id] || 0), 0);
        if (cashNow < targetBuf) {
          // Prefer funding buffer into current_savings (already hub); if buffer includes other cash types, top those next
          const gap = targetBuf - cashNow;
          // Ensure hub has priority — no-op if cash is only hub; otherwise move from hub to other cash types is unusual
          // Keep surplus in hub for buffer purposes (already there).
        }
      }
    }

    accounts.forEach(acc => {
      const v = balances[acc.id] || 0;
      series[acc.id].values.push(Math.round(allowNegative ? v : Math.max(0, v)));
      series[acc.id].overridden.push(!!series[acc.id]._over);
    });
    // Store running unmet debt on a synthetic series for goal-seek totals
    if (allowNegative) {
      if (!series.__debt) {
        series.__debt = { name: "Unmet", color: "#94A3B8", values: [], overridden: [], excludeFromTotal: false, isDebt: true };
      }
      series.__debt.values.push(-Math.round(unmetDebt));
      series.__debt.overridden.push(false);
    }
  });

  if ((currentPlan.income || []).length) {
    series["__income"] = {
      name: "Income (cumulative)",
      color: "#10B981",
      values: incomeValues,
      overridden: years.map(() => false),
      excludeFromTotal: true
    };
  }
  if (currentPlan.spend) {
    series["__spend"] = {
      name: "Spend (cumulative, info)",
      color: getThemeColor("spend"),
      values: spendValues,
      overridden: years.map(() => false),
      excludeFromTotal: true
    };
  }

  // Net worth = sum of pot balances only (income/spend already applied via strategy)
  // With allowNegative, __debt values are negative and included so totals can go below 0
  const totals = years.map((_, i) =>
    Object.values(series).reduce((s, ser) => {
      if (ser.excludeFromTotal) return s;
      return s + (ser.values[i] || 0);
    }, 0)
  );
  return { years, series, totals, interestByYear, interestDetailByYear };
}

// ---- Strategy timeline UI ----
function renderStrategyPage() {
  ensureStrategies();
  ensureSpend();
  const years = getPlanYears();
  const y0 = years[0];
  const y1 = years[years.length - 1];
  packStrategyTimeline(y0, y1);
  const fundUntil = currentPlan.spend?.fundUntil || y1;
  const blocks = currentPlan.strategies;
  const n = Math.max(1, y1 - y0 + 1);

  const yearTicks = years.map((y, i) => {
    const show = i === 0 || i === years.length - 1 || y % 5 === 0;
    return show ? `<span class="tl-year" style="left:${((y - y0) / n) * 100}%">${y}</span>` : "";
  }).join("");

  const fundPct = Math.min(100, Math.max(0, ((fundUntil - y0) / n) * 100));

  const blockHtml = blocks.map(s => {
    const preset = STRATEGY_PRESETS.find(p => p.key === s.preset) || STRATEGY_PRESETS[0];
    const left = ((s.fromYear - y0) / n) * 100;
    const width = ((s.toYear - s.fromYear + 1) / n) * 100;
    return `
      <div class="tl-block tone-${preset.tone}" data-id="${s.id}"
           style="left:${left}%;width:${Math.max(width, 1.5)}%;"
           title="Double-click to edit · Drag ends to resize">
        <div class="tl-handle tl-handle-l" data-edge="start"></div>
        <div class="tl-block-inner">
          <span class="tl-block-icon">${preset.icon}</span>
          <span class="tl-block-name">${escapeHtml(s.name)}</span>
          <span class="tl-block-years">${s.fromYear}–${s.toYear}</span>
        </div>
        <div class="tl-handle tl-handle-r" data-edge="end"></div>
      </div>`;
  }).join("");

  const palette = STRATEGY_PRESETS.map(p => `
    <div class="palette-chip tone-${p.tone}" draggable="true" data-preset="${p.key}">
      <span class="tl-block-icon">${p.icon}</span>
      ${escapeHtml(p.name)}
    </div>`).join("");

  return `
    <div class="page strategy-timeline-page">
      <header class="page-header">
        <div>
          <h1>Strategy</h1>
          <p class="subtitle">Life-stage blocks on your plan timeline</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="tl-shell">
        <div class="tl-ruler">
          <div class="tl-ruler-track">${yearTicks}</div>
        </div>

        <div class="tl-canvas" id="tlCanvas">
          <div class="tl-grid"></div>
          <div class="tl-fund-line" style="left:${fundPct}%" title="Fund until ${fundUntil}">
            <span class="tl-fund-label">${fundUntil}</span>
          </div>
          <div class="tl-blocks" id="tlBlocks">${blockHtml}</div>
          <div class="tl-title-overlay">Long-term life planner</div>
        </div>

        <div class="tl-palette">
          <div class="tl-palette-label">Available blocks (drag onto timeline)</div>
          <div class="tl-palette-row" id="tlPalette">${palette}</div>
          <p class="field-hint">Drag a block onto the timeline to add a life stage (existing blocks split to make room). Double-click a block to edit rules and actions.</p>
        </div>
      </div>
    </div>
  `;
}

/** Pack strategies into contiguous [y0,y1] — edges meet, full coverage, no overlaps */
function packStrategyTimeline(y0, y1) {
  ensureStrategies();
  let list = currentPlan.strategies.slice().sort((a, b) => a.fromYear - b.fromYear);
  if (!list.length) {
    ensureStrategies();
    list = currentPlan.strategies.slice();
  }
  const range = y1 - y0 + 1;
  let spans = list.map(s => Math.max(1, (s.toYear - s.fromYear + 1) || 1));
  let sum = spans.reduce((a, b) => a + b, 0) || 1;
  spans = spans.map(s => Math.max(1, Math.round(s * range / sum)));
  sum = spans.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum > range && guard++ < 1000) {
    for (let i = spans.length - 1; i >= 0 && sum > range; i--) {
      if (spans[i] > 1) { spans[i]--; sum--; }
    }
  }
  while (sum < range) { spans[spans.length - 1]++; sum++; }
  let y = y0;
  list.forEach((s, i) => {
    s.fromYear = y;
    s.toYear = y + spans[i] - 1;
    y = s.toYear + 1;
  });
  currentPlan.strategies = list;
}

function setStrategyBoundary(id, edge, year, y0, y1) {
  const list = currentPlan.strategies.slice().sort((a, b) => a.fromYear - b.fromYear);
  const i = list.findIndex(s => s.id === id);
  if (i < 0) return;
  year = Math.max(y0, Math.min(y1, year));

  if (edge === "start" && i > 0) {
    const prev = list[i - 1];
    const cur = list[i];
    let b = year - 1;
    b = Math.max(prev.fromYear, Math.min(cur.toYear - 1, b));
    prev.toYear = b;
    cur.fromYear = b + 1;
  } else if (edge === "end" && i < list.length - 1) {
    const cur = list[i];
    const next = list[i + 1];
    let b = year;
    b = Math.max(cur.fromYear, Math.min(next.toYear - 1, b));
    cur.toYear = b;
    next.fromYear = b + 1;
  }
  currentPlan.strategies = list;
}

function moveStrategyToYear(id, dropYear, y0, y1) {
  const list = currentPlan.strategies.slice().sort((a, b) => a.fromYear - b.fromYear);
  const i = list.findIndex(s => s.id === id);
  if (i < 0) return;
  let j = list.findIndex(s => dropYear >= s.fromYear && dropYear <= s.toYear);
  if (j < 0) j = dropYear <= list[0].fromYear ? 0 : list.length - 1;
  if (i === j) return;
  const [item] = list.splice(i, 1);
  // after removal, adjust j
  if (j > i) j--;
  list.splice(j, 0, item);
  currentPlan.strategies = list;
  packStrategyTimeline(y0, y1);
}

function attachStrategyTimeline() {
  const canvas = document.getElementById("tlCanvas");
  const blocksEl = document.getElementById("tlBlocks");
  if (!canvas || !blocksEl) return;

  const years = getPlanYears();
  const y0 = years[0];
  const y1 = years[years.length - 1];
  const n = Math.max(1, y1 - y0);

  function yearFromX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(y0 + pct * n);
  }

  function refreshTimeline() {
    packStrategyTimeline(y0, y1);
    autoSave();
    page.innerHTML = renderStrategyPage();
    attachStrategyTimeline();
    updateSaveStatus();
  }

  function paintBlock(block, s) {
    const range = y1 - y0 + 1;
    const left = ((s.fromYear - y0) / range) * 100;
    const width = ((s.toYear - s.fromYear + 1) / range) * 100;
    block.style.left = left + "%";
    block.style.width = Math.max(width, 1.5) + "%";
    const label = block.querySelector(".tl-block-years");
    if (label) label.textContent = s.fromYear + "–" + s.toYear;
  }

  // Live-update all blocks from data
  function paintAll() {
    blocksEl.querySelectorAll(".tl-block").forEach(block => {
      const s = currentPlan.strategies.find(x => x.id === block.dataset.id);
      if (s) paintBlock(block, s);
    });
  }

  blocksEl.querySelectorAll(".tl-block").forEach(block => {
    const id = block.dataset.id;

    block.addEventListener("dblclick", e => {
      if (e.target.classList.contains("tl-handle")) return;
      openStrategyBlockEditor(id);
    });

    // Resize = move shared boundary with neighbour
    block.querySelectorAll(".tl-handle").forEach(handle => {
      handle.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        const edge = handle.dataset.edge;
        const onMove = ev => {
          const y = yearFromX(ev.clientX);
          setStrategyBoundary(id, edge, y, y0, y1);
          paintAll();
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          autoSave();
          updateSaveStatus();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });

    // Drag body = pick up and reorder
    block.addEventListener("mousedown", e => {
      if (e.target.classList.contains("tl-handle")) return;
      if (e.detail > 1) return;
      e.preventDefault();
      e.stopPropagation();
      const s = currentPlan.strategies.find(x => x.id === id);
      if (!s) return;

      block.classList.add("tl-dragging");
      const ghost = block.cloneNode(true);
      ghost.classList.add("tl-ghost");
      ghost.style.pointerEvents = "none";
      ghost.style.opacity = "0.85";
      ghost.style.zIndex = "20";
      blocksEl.appendChild(ghost);

      const onMove = ev => {
        const dropY = yearFromX(ev.clientX);
        // Preview position: shift ghost under cursor year
        const range = y1 - y0 + 1;
        const span = s.toYear - s.fromYear + 1;
        let nf = Math.max(y0, Math.min(dropY, y1 - span + 1));
        const left = ((nf - y0) / range) * 100;
        const width = (span / range) * 100;
        ghost.style.left = left + "%";
        ghost.style.width = Math.max(width, 1.5) + "%";
        // Highlight target slot
        blocksEl.querySelectorAll(".tl-block").forEach(b => b.classList.remove("tl-drop-target"));
        const target = currentPlan.strategies.find(x => dropY >= x.fromYear && dropY <= x.toYear && x.id !== id);
        if (target) {
          const el = blocksEl.querySelector(`.tl-block[data-id="${target.id}"]`);
          if (el) el.classList.add("tl-drop-target");
        }
      };
      const onUp = ev => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        block.classList.remove("tl-dragging");
        ghost.remove();
        blocksEl.querySelectorAll(".tl-block").forEach(b => b.classList.remove("tl-drop-target"));
        const dropY = yearFromX(ev.clientX);
        moveStrategyToYear(id, dropY, y0, y1);
        refreshTimeline();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      onMove(e);
    });
  });

  document.querySelectorAll(".palette-chip").forEach(chip => {
    chip.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/preset", chip.dataset.preset);
    });
  });
  canvas.addEventListener("dragover", e => e.preventDefault());
  canvas.addEventListener("drop", e => {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/preset");
    if (!key) return;
    const preset = STRATEGY_PRESETS.find(p => p.key === key);
    if (!preset) return;
    const dropY = yearFromX(e.clientX);
    insertStrategyBlock(preset, dropY, y0, y1);
    refreshTimeline();
  });
}

/** Insert new block at dropY; split host block so edges meet; full range stays covered */
function insertStrategyBlock(preset, dropY, y0, y1) {
  ensureStrategies();
  packStrategyTimeline(y0, y1);
  const list = currentPlan.strategies.slice().sort((a, b) => a.fromYear - b.fromYear);
  let hostIdx = list.findIndex(s => dropY >= s.fromYear && dropY <= s.toYear);
  if (hostIdx < 0) hostIdx = 0;
  const host = list[hostIdx];
  const hostSpan = host.toYear - host.fromYear + 1;

  const newBlock = {
    id: uid(),
    preset: preset.key,
    name: preset.name,
    isDefault: false,
    fromYear: dropY,
    toYear: dropY,
    cashBufferMonths: preset.key === "late" ? 36 : 24,
    withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER.slice(),
    surplusOrder: DEFAULT_SURPLUS_ORDER.slice(),
    actions: [],
    notes: preset.key === "steady"
      ? "All flows through current/savings."
      : "Edit actions to define how money moves in this stage."
  };

  // Split host: left | new | right (right only if room)
  // Give new ~1/3 of host or min 2 years when possible
  const newSpan = Math.max(1, Math.min(hostSpan - 1, Math.max(2, Math.floor(hostSpan / 3))));
  const leftSpan = Math.max(0, dropY - host.fromYear);
  // Rebuild sequence
  const next = [];
  for (let i = 0; i < list.length; i++) {
    if (i !== hostIdx) {
      next.push(list[i]);
      continue;
    }
    if (leftSpan >= 1) {
      next.push({ ...host, toYear: dropY - 1 });
    }
    next.push(newBlock);
    const rightStart = dropY + newSpan;
    if (rightStart <= host.toYear && hostSpan - leftSpan - newSpan >= 1) {
      next.push({
        ...host,
        id: uid(),
        isDefault: false,
        fromYear: rightStart,
        toYear: host.toYear
      });
    } else if (leftSpan < 1 && hostSpan > newSpan) {
      // drop at start of host: new then remainder
      next.push({
        ...host,
        id: host.id,
        isDefault: host.isDefault,
        fromYear: dropY + newSpan,
        toYear: host.toYear
      });
    }
  }

  // If host was fully replaced by new only
  if (!next.includes(newBlock)) next.push(newBlock);

  // Dedupe accidental double host remnants
  const seen = new Set();
  currentPlan.strategies = next.filter(s => {
    if (seen.has(s.id) && s.id !== newBlock.id) return false;
    seen.add(s.id);
    return true;
  });

  if (!currentPlan.strategies.some(s => s.isDefault)) {
    const st = currentPlan.strategies.find(s => s.preset === "steady") || currentPlan.strategies[0];
    if (st) st.isDefault = true;
  }
  packStrategyTimeline(y0, y1);
}

function typeLabel(v) {
  return (ACCOUNT_TYPES.find(t => t.value === v) || {}).label || v;
}

function openStrategyBlockEditor(id) {
  const s = currentPlan.strategies.find(x => x.id === id);
  if (!s) return;
  if (!s.actions) s.actions = [];
  if (!s.withdrawalOrder) s.withdrawalOrder = DEFAULT_WITHDRAWAL_ORDER.slice();
  if (!s.surplusOrder) s.surplusOrder = DEFAULT_SURPLUS_ORDER.slice();

  const panel = document.getElementById("slidePanel");
  const backdrop = document.getElementById("slideBackdrop");
  const buffer = cashBufferTarget(s);

  const wOrder = (s.withdrawalOrder || []).map((t, i) =>
    `<li class="strat-edit-row" data-kind="w" data-idx="${i}">
      <span class="strat-num">${i + 1}</span>
      <span>${typeLabel(t)}</span>
      <button type="button" class="btn-icon" onclick="stratMoveOrder('w','${id}',${i},-1)" title="Up">↑</button>
      <button type="button" class="btn-icon" onclick="stratMoveOrder('w','${id}',${i},1)" title="Down">↓</button>
    </li>`).join("");

  const sOrder = (s.surplusOrder || []).map((t, i) =>
    `<li class="strat-edit-row" data-kind="s" data-idx="${i}">
      <span class="strat-num">${i + 1}</span>
      <span>${typeLabel(t)}</span>
      <button type="button" class="btn-icon" onclick="stratMoveOrder('s','${id}',${i},-1)" title="Up">↑</button>
      <button type="button" class="btn-icon" onclick="stratMoveOrder('s','${id}',${i},1)" title="Down">↓</button>
    </li>`).join("");

  const actionTypes = [
    { value: "draw_account", label: "Draw from account (shortfall)" },
    { value: "topup_buffer", label: "Top up cash buffer" },
    { value: "transfer_fixed", label: "Transfer fixed £ to account" },
    { value: "transfer_pct", label: "Transfer % of surplus to account" }
  ];

  const accounts = currentPlan.accounts || [];
  function accountOptionsForType(type, selectedId) {
    const list = accounts.filter(a => !type || a.type === type);
    if (!list.length) {
      return `<option value="">No accounts of this type</option>`;
    }
    return list.map(a =>
      `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${escapeHtml(a.name || "Account")}</option>`
    ).join("");
  }

  const actionsHtml = (s.actions.length ? s.actions : []).map((a, i) => {
    const t = a.accountType || "cash_isa";
    return `
    <div class="action-row" data-idx="${i}">
      <select class="act-type" data-idx="${i}">
        ${actionTypes.map(x => `<option value="${x.value}" ${a.type === x.value ? "selected" : ""}>${x.label}</option>`).join("")}
      </select>
      <select class="act-account-type" data-idx="${i}" onchange="stratActionTypeChanged('${id}', ${i}, this.value)">
        ${ACCOUNT_TYPES.map(x => `<option value="${x.value}" ${t === x.value ? "selected" : ""}>${x.label}</option>`).join("")}
      </select>
      <select class="act-account-id" data-idx="${i}">
        ${accountOptionsForType(t, a.accountId)}
      </select>
      <input type="number" class="act-amount" data-idx="${i}" value="${a.amount ?? 0}" title="£ or %" step="1">
      <button type="button" class="btn-icon danger" onclick="stratRemoveAction('${id}',${i})">✕</button>
    </div>`;
  }).join("") || `<p class="field-hint">No custom actions yet — withdrawal/surplus orders below still apply. Add actions for finer control.</p>`;

  panel.innerHTML = `
    <div class="slide-header">
      <h2>Edit strategy</h2>
      <button class="btn-icon" onclick="closeStrategyEditor()">✕</button>
    </div>
    <div class="slide-body">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="seName" value="${escapeHtml(s.name)}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>From year</label>
          <input type="number" id="seFrom" value="${s.fromYear}">
        </div>
        <div class="form-group">
          <label>To year</label>
          <input type="number" id="seTo" value="${s.toYear}">
        </div>
        <div class="form-group">
          <label>Cash buffer (months essential)</label>
          <input type="number" id="seBuffer" value="${s.cashBufferMonths || 24}">
        </div>
      </div>
      <p class="field-hint">Buffer target ≈ ${formatMoney(buffer)}</p>
      <div class="form-group">
        <label>Notes</label>
        <input type="text" id="seNotes" value="${escapeHtml(s.notes || "")}">
      </div>

      <h3 class="se-section">Actions</h3>
      <p class="settings-desc">Optional step-by-step rules (runs in order). Leave empty to use the lists below.</p>
      <div id="seActions">${actionsHtml}</div>
      <button type="button" class="btn-secondary" style="margin-top:8px;" onclick="stratAddAction('${id}')">+ Add action</button>

      <div class="strategy-orders" style="margin-top:20px;">
        <div>
          <h4>Withdrawal order</h4>
          <p class="settings-desc">When spend exceeds income</p>
          <ol class="strat-list" id="seWOrder">${wOrder}</ol>
        </div>
        <div>
          <h4>Surplus order</h4>
          <p class="settings-desc">After buffer top-up</p>
          <ol class="strat-list" id="seSOrder">${sOrder}</ol>
        </div>
      </div>
    </div>
    <div class="slide-footer">
      <button class="btn-secondary" onclick="closeStrategyEditor()">Cancel</button>
      ${!s.isDefault ? `<button class="btn-secondary" style="color:#DC2626;" onclick="stratDeleteBlock('${id}')">Delete block</button>` : ""}
      <button class="btn-primary" onclick="saveStrategyBlockEditor('${id}')">Save</button>
    </div>
  `;
  panel.classList.add("wide", "open");
  backdrop.classList.add("open");
}

function closeStrategyEditor() {
  document.getElementById("slidePanel").classList.remove("open", "wide");
  document.getElementById("slideBackdrop").classList.remove("open");
}
window.closeStrategyEditor = closeStrategyEditor;

function saveStrategyBlockEditor(id) {
  const s = currentPlan.strategies.find(x => x.id === id);
  if (!s) return;
  s.name = document.getElementById("seName").value.trim() || s.name;
  s.fromYear = parseInt(document.getElementById("seFrom").value, 10) || s.fromYear;
  s.toYear = parseInt(document.getElementById("seTo").value, 10) || s.toYear;
  s.cashBufferMonths = parseFloat(document.getElementById("seBuffer").value) || 24;
  s.notes = document.getElementById("seNotes").value.trim();
  if (s.toYear <= s.fromYear) s.toYear = s.fromYear + 1;

  // Read actions from DOM
  const rows = document.querySelectorAll("#seActions .action-row");
  s.actions = Array.from(rows).map(row => ({
    type: row.querySelector(".act-type").value,
    accountType: row.querySelector(".act-account-type").value,
    accountId: row.querySelector(".act-account-id")?.value || "",
    amount: parseFloat(row.querySelector(".act-amount").value) || 0
  }));

  autoSave();
  closeStrategyEditor();
  page.innerHTML = renderStrategyPage();
  attachStrategyTimeline();
  updateSaveStatus();
}
window.saveStrategyBlockEditor = saveStrategyBlockEditor;

function stratAddAction(id) {
  const s = currentPlan.strategies.find(x => x.id === id);
  if (!s) return;
  if (!s.actions) s.actions = [];
  // persist current form fields into s first for name etc optional skip
  const firstIsa = (currentPlan.accounts || []).find(a => a.type === "cash_isa");
  const firstAny = (currentPlan.accounts || [])[0];
  s.actions.push({
    type: "transfer_fixed",
    accountType: firstIsa ? "cash_isa" : (firstAny?.type || "current_savings"),
    accountId: (firstIsa || firstAny)?.id || "",
    amount: 1000
  });
  openStrategyBlockEditor(id);
}
window.stratAddAction = stratAddAction;

function stratActionTypeChanged(stratId, idx, type) {
  const s = currentPlan.strategies.find(x => x.id === stratId);
  if (!s || !s.actions[idx]) return;
  // Preserve other fields from DOM before re-open
  const rows = document.querySelectorAll("#seActions .action-row");
  s.actions = Array.from(rows).map(row => ({
    type: row.querySelector(".act-type").value,
    accountType: row.querySelector(".act-account-type").value,
    accountId: row.querySelector(".act-account-id")?.value || "",
    amount: parseFloat(row.querySelector(".act-amount").value) || 0
  }));
  s.actions[idx].accountType = type;
  const match = (currentPlan.accounts || []).find(a => a.type === type);
  s.actions[idx].accountId = match ? match.id : "";
  openStrategyBlockEditor(stratId);
}
window.stratActionTypeChanged = stratActionTypeChanged;

function stratRemoveAction(id, idx) {
  const s = currentPlan.strategies.find(x => x.id === id);
  if (!s || !s.actions) return;
  s.actions.splice(idx, 1);
  openStrategyBlockEditor(id);
}
window.stratRemoveAction = stratRemoveAction;

function stratMoveOrder(kind, id, idx, dir) {
  const s = currentPlan.strategies.find(x => x.id === id);
  if (!s) return;
  const arr = kind === "w" ? s.withdrawalOrder : s.surplusOrder;
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  const t = arr[idx];
  arr[idx] = arr[j];
  arr[j] = t;
  openStrategyBlockEditor(id);
}
window.stratMoveOrder = stratMoveOrder;

async function stratDeleteBlock(id) {
  if (!(await appConfirmYesNo("Remove this strategy block from the timeline?"))) return;
  currentPlan.strategies = currentPlan.strategies.filter(s => s.id !== id);
  if (!currentPlan.strategies.length) {
    currentPlan.strategies = null;
    ensureStrategies();
  }
  autoSave();
  closeStrategyEditor();
  page.innerHTML = renderStrategyPage();
  attachStrategyTimeline();
  updateSaveStatus();
}
window.stratDeleteBlock = stratDeleteBlock;
window.openStrategyBlockEditor = openStrategyBlockEditor;

/** Shape target for a year (user's thinking — before model ratio) */
/**
 * Inflation factor from plan start → year.
 * All engine maths is nominal; display can divide by this to show today's money.
 */
function inflationFactor(year) {
  const start = currentPlan.scale?.startYear || new Date().getFullYear();
  const rate = Number(currentPlan.spend?.inflationRate);
  const r = isNaN(rate) ? 0.025 : rate;
  return Math.pow(1 + r, Math.max(0, year - start));
}

function getInflationRate() {
  const rate = Number(currentPlan.spend?.inflationRate);
  return isNaN(rate) ? 0.025 : rate;
}

/** Nominal amount → display amount (today's money if inflation toggle off) */
function toDisplayMoney(nominal, year) {
  if (currentPlan.spend?.showInflation) return nominal;
  const f = inflationFactor(year);
  return f > 0 ? nominal / f : nominal;
}

/** Display amount → nominal (for storing edits made while viewing today's money or inflated) */
function fromDisplayMoney(display, year) {
  if (currentPlan.spend?.showInflation) return display;
  return display * inflationFactor(year);
}

/**
 * Target in TODAY'S MONEY (real). User thinks and edits in real terms;
 * engine multiplies by inflationFactor for nominal cashflows.
 */
function getTargetForYear(year) {
  const sp = currentPlan.spend || {};
  const raw = Number(sp.targetBase);
  const base = isNaN(raw) ? 0 : Math.max(0, raw);
  const fundUntil = sp.fundUntil || 9999;
  if (year > fundUntil) return 0;
  if (sp.targetOverrides && sp.targetOverrides[year] !== undefined) {
    return Math.max(0, Number(sp.targetOverrides[year]));
  }
  return base;
}

/** Default bandwidth as fraction (default 10%) */
function getBandPct() {
  const b = Number(currentPlan.spend?.bandPct);
  return isNaN(b) ? 0.1 : Math.max(0, b);
}

function markUserTouch(year) {
  ensureSpend();
  if (!currentPlan.spend.userTouched) currentPlan.spend.userTouched = {};
  currentPlan.spend.userTouched[year] = true;
}

function isUserTouched(year) {
  return !!(currentPlan.spend?.userTouched && currentPlan.spend.userTouched[year]);
}

/** Per-year bandwidth (override or default) */
function getBandPctForYear(year) {
  const sp = currentPlan.spend || {};
  if (sp.bandOverrides && sp.bandOverrides[year] !== undefined) {
    const v = Number(sp.bandOverrides[year]);
    if (!isNaN(v)) return Math.max(0, v);
  }
  return getBandPct();
}

function toMonthly(annual) { return (Number(annual) || 0) / 12; }
function toAnnual(monthly) { return (Number(monthly) || 0) * 12; }

function getModelRatio() {
  const r = Number(currentPlan.spend?.modelRatio);
  return isNaN(r) || r <= 0 ? 1 : r;
}

/**
 * After Fund until: NES fills the gap so total spend ≈ income
 * (no further draw on savings). Nominal income − essential − pots − one-offs.
 */
function getPostFundNesNominal(year) {
  const inc = typeof calcIncomeForYear === "function" ? calcIncomeForYear(year) : 0;
  const tax = typeof calcTaxForYear === "function" ? calcTaxForYear(year) : 0;
  const pots = (currentPlan.spend?.pots || []).reduce((s, p) => s + getPotAmountForYear(p, year), 0);
  const one = typeof getOneOffsForYear === "function" ? getOneOffsForYear(year) : 0;
  // After fund-until: spend tracks net income (not gross) so tax does not silently drain pots
  return Math.max(0, inc - tax - pots - one);
}

/**
 * NES in TODAY'S MONEY (real): Target_y × ModelRatio
 * After fund-until: back out inflation from nominal gap-to-income.
 */
function getNonEssentialRealForYear(year) {
  const fundUntil = currentPlan.spend?.fundUntil || 9999;
  if (year > fundUntil) {
    return toDisplayMoney(getPostFundNesNominal(year), year);
  }
  return Math.max(0, getTargetForYear(year) * getModelRatio());
}

/**
 * NES NOMINAL for the projection engine (matches Excel “with inflation”):
 *   real target × modelRatio × inflationFactor(year)
 * After Fund until: total spend tracks income (NES = income − other spend).
 */
function getNonEssentialForYear(year) {
  const fundUntil = currentPlan.spend?.fundUntil || 9999;
  if (year > fundUntil) return getPostFundNesNominal(year);
  return getNonEssentialRealForYear(year) * inflationFactor(year);
}

/** Display NES for charts/metrics (respects show-inflation toggle) */
function getNonEssentialDisplayForYear(year) {
  return currentPlan.spend?.showInflation
    ? getNonEssentialForYear(year)
    : getNonEssentialRealForYear(year);
}

function getMinForYear(year) {
  const t = getNonEssentialDisplayForYear(year);
  return Math.max(0, t * (1 - getBandPctForYear(year)));
}

function getMaxForYear(year) {
  const t = getNonEssentialDisplayForYear(year);
  return t * (1 + getBandPctForYear(year));
}

/** Nominal cashflow for a pot in a year (for NW engine). */
function getPotAmountForYear(pot, year) {
  if (year < (pot.fromYear || 0) || year > (pot.toYear || 9999)) return 0;
  let base = (pot.overrides && pot.overrides[year] !== undefined)
    ? Number(pot.overrides[year])
    : (Number(pot.amountAnnual) || 0);
  const mode = pot.growthMode || (pot.inflate === false ? "none" : "inflation");
  if (mode !== "none") {
    const start = currentPlan.scale?.startYear || new Date().getFullYear();
    const rate = resolveGrowthPct({
      growthMode: mode === "none" ? "custom" : mode,
      growthRate: mode === "custom" ? (pot.growthCustom || 0) : undefined,
      growthCustom: pot.growthCustom,
      growthAdj: pot.growthAdj,
      annualGrowth: pot.growthCustom
    }) / 100;
    if (mode === "custom" && !pot.growthCustom && pot.inflate === false) {
      /* flat */
    } else if (mode !== "none") {
      base = base * Math.pow(1 + rate, Math.max(0, year - start));
    }
  }
  return base;
}

function getEssentialForYear(year) {
  ensureSpend();
  const pot = (currentPlan.spend.pots || []).find(p => p.isEssential);
  if (pot) return getPotAmountForYear(pot, year);
  return Number(currentPlan.spend.essentialAnnual) || 0;
}

function getLifestylePotsForYear(year) {
  return (currentPlan.spend?.pots || [])
    .filter(p => !p.isEssential)
    .reduce((s, p) => s + getPotAmountForYear(p, year), 0);
}

/** Recurring spend only (essential + lifestyle pots + non-essential). Excludes one-offs. */
function getSpendForYear(year, targetOverrideFn) {
  const nonEssential = targetOverrideFn ? targetOverrideFn(year) : getNonEssentialForYear(year);
  return getEssentialForYear(year) + getLifestylePotsForYear(year) + Math.max(0, nonEssential);
}

function getOneOffsForYear(year) {
  ensureSpend();
  let total = (currentPlan.spend.oneOffs || [])
    .filter(o => Number(o.year) === Number(year))
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);
  // DB pension tax-free lump sum in start year
  (currentPlan.income || []).forEach(inc => {
    if (inc.type !== "db_pension") return;
    const startY = inc.startDate ? new Date(inc.startDate).getFullYear() : null;
    if (startY === Number(year) && Number(inc.dbLumpSum) > 0) total += Number(inc.dbLumpSum);
  });
  return total;
}

/** Full cash outflow for projection: recurring + one-offs */
function getTotalOutflowForYear(year, targetOverrideFn) {
  return getSpendForYear(year, targetOverrideFn) + getOneOffsForYear(year);
}

/** Default UK-style bands (simplified) — stored per person, editable */
function defaultPersonTax() {
  return {
    useTax: true,
    personalAllowance: 12570,
    bands: [
      { from: 0, to: 37700, rate: 20 },
      { from: 37700, to: 125140, rate: 40 },
      { from: 125140, to: null, rate: 45 }
    ],
    niRate: 8,
    niThreshold: 12570
  };
}

function ensurePersonTax(p) {
  if (!p.tax) p.tax = defaultPersonTax();
  if (p.tax.bands == null) p.tax = { ...defaultPersonTax(), ...p.tax };
  return p.tax;
}

/** Taxable income for a person in a year (from income sources tagged to them or unassigned→primary) */
function taxableIncomeForPerson(personId, year) {
  const primaryId = currentPlan.people?.[0]?.id;
  const planStart = currentPlan.scale?.startYear || year;
  let total = 0;
  (currentPlan.income || []).forEach(inc => {
    if (inc.taxable === false) return;
    // Incomes use personId (legacy ownerId still accepted)
    const owner = inc.personId || inc.ownerId || primaryId;
    if (personId && owner !== personId) return;
    const start = inc.startDate ? new Date(inc.startDate).getFullYear() : planStart;
    const end = inc.endDate ? new Date(inc.endDate).getFullYear() : 9999;
    if (year < start || year > end) return;
    const frac = incomeYearFraction(inc, year);
    if (frac <= 0) return;
    const growthBaseYear = Math.max(start, planStart);
    const growth = resolveGrowthPct(inc) / 100;
    const monthly = (Number(inc.amountMonthly) || 0) * Math.pow(1 + growth, Math.max(0, year - growthBaseYear));
    total += monthly * 12 * frac;
  });
  return total;
}

function taxOnAmount(amount, taxCfg) {
  if (!taxCfg || taxCfg.useTax === false) return 0;
  let remaining = Math.max(0, amount - (Number(taxCfg.personalAllowance) || 0));
  let tax = 0;
  const bands = taxCfg.bands || [];
  for (const b of bands) {
    if (remaining <= 0) break;
    const from = Number(b.from) || 0;
    const to = b.to == null ? Infinity : Number(b.to);
    const width = Math.max(0, to - from);
    const slice = Math.min(remaining, width);
    tax += slice * ((Number(b.rate) || 0) / 100);
    remaining -= slice;
  }
  // Simple NI on amount above threshold
  const niBase = Math.max(0, amount - (Number(taxCfg.niThreshold) || 0));
  tax += niBase * ((Number(taxCfg.niRate) || 0) / 100);
  return tax;
}

function calcTaxForYear(year) {
  const people = currentPlan.people || [];
  if (!people.length) return 0;
  let total = 0;
  people.forEach(p => {
    ensurePersonTax(p);
    if (p.tax.useTax === false) return;
    const gross = taxableIncomeForPerson(p.id, year);
    total += taxOnAmount(gross, p.tax);
  });
  return total;
}


/**
 * Pot display: engine amount is always nominal (getPotAmountForYear).
 * showInflation ON  → show nominal
 * showInflation OFF → back out plan inflation (not the pot's own rate)
 */
function getPotDisplayForYear(pot, year) {
  const nominal = getPotAmountForYear(pot, year);
  return toDisplayMoney(nominal, year);
}

/** @deprecated use toDisplayMoney — kept for older call sites */
function displayInflate(amount, year) {
  return toDisplayMoney(amount, year);
}

/** Simulate NW path using the real projection engine (strategy + pots). */
function simulateNetWorthPath(targetFn, opts) {
  const { totals } = calcProjectedNetWorth(targetFn, opts);
  return totals;
}

/**
 * Goal-seek a uniform multiplier on a base target schedule so that:
 * - min NW over years up to fundUntil ≈ 1 (nearly zero, not negative)
 * Uses binary search on the factor.
 */
function goalSeekTargetFactor(baseTargetsByYear) {
  const years = getPlanYears();
  const fundUntil = currentPlan.spend?.fundUntil || years[years.length - 1];
  const relevantIdx = years.map((y, i) => (y <= fundUntil ? i : -1)).filter(i => i >= 0);
  if (!relevantIdx.length) return 1;

  const baseSum = Object.values(baseTargetsByYear || {}).reduce((a, b) => a + (Number(b) || 0), 0);

  const evalFactor = (f) => {
    const path = simulateNetWorthPath(y => {
      if (y > fundUntil) return 0;
      const base = baseTargetsByYear[y] ?? 0; // real
      return Math.max(0, base * f * inflationFactor(y)); // nominal
    }, { allowNegative: true });
    let minNW = Infinity;
    let endNW = path[relevantIdx[relevantIdx.length - 1]] ?? 0;
    relevantIdx.forEach(i => { minNW = Math.min(minNW, path[i]); });
    return { minNW, endNW, path };
  };

  // Empty plan / no resources: keep ratio at 1 (no phantom spend multiplier)
  const zeroSpend = evalFactor(0);
  if (zeroSpend.endNW <= 0.5 && zeroSpend.minNW <= 0.5) {
    return baseSum > 0 ? 0 : 1;
  }
  if (baseSum <= 0) return 1;

  // Binary search factor: higher spend → lower NW
  let lo = 0, hi = 20;
  for (let i = 0; i < 8; i++) {
    const { minNW } = evalFactor(hi);
    if (minNW < 1) break;
    hi *= 2;
    if (hi > 1000) break;
  }

  let best = 1;
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const { minNW, endNW } = evalFactor(mid);
    best = mid;
    if (Math.abs(endNW) < 0.5 && minNW >= -0.5) break;
    if (endNW > 0.5) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Essential + other pots (not NES) + one-offs for a year — annual £ */
function getFixedSpendForYear(year) {
  ensureSpend();
  let total = 0;
  (currentPlan.spend.pots || []).forEach(p => {
    total += getPotAmountForYear(p, year) || 0;
  });
  (currentPlan.spend.oneOffs || []).forEach(o => {
    if (Number(o.year) === Number(year)) total += Number(o.amount) || 0;
  });
  return total;
}

/**
 * Net cash available to fund NES in a year (before drawing capital):
 * income − tax − essential/pots − one-offs
 */
function netCashForNes(year) {
  const inc = calcIncomeForYear(year) || 0;
  const tax = (typeof calcTaxForYear === "function" ? calcTaxForYear(year) : 0) || 0;
  const fixed = getFixedSpendForYear(year) || 0;
  return inc - tax - fixed;
}

/**
 * Reset targets — starting shape for NES.
 *
 * Logic (matches “I earn £1,000 → I can spend ~£1,000”):
 * 1. Opening capital C spread evenly: C / nYears
 * 2. Plus first plan-year net cash (income − tax − fixed spend)
 * 3. modelRatio = 1, clear per-year overrides
 *
 * Why not goal-seek a flat S to end NW = 0?
 * Income often grows (default = inflation). A flat S that clears end NW
 * averages later, higher incomes → e.g. £1,804/mo instead of £1,000.
 * Reset is a starting point; Solve balance fine-tunes later.
 */
function resetTargets() {
  ensureSpend();
  const years = getPlanYears();
  const fundUntil = currentPlan.spend.fundUntil || years[years.length - 1];
  const relevant = years.filter(y => y <= fundUntil);
  const nYears = relevant.length || 1;
  const y0 = relevant[0] || years[0];

  const capital = Math.max(0, calcNetWorth());
  const capitalPa = capital / nYears;
  let incomePa = netCashForNes(y0);
  // If first year is partial/zero, fall back to max near-term net cash
  if (incomePa < 1) {
    for (let i = 0; i < Math.min(5, relevant.length); i++) {
      incomePa = Math.max(incomePa, netCashForNes(relevant[i]));
    }
  }

  const annual = Math.max(0, capitalPa + Math.max(0, incomePa));

  currentPlan.spend.targetBase = Math.round(annual);
  currentPlan.spend.modelRatio = 1;
  currentPlan.spend.targetOverrides = {};
  currentPlan.spend.bandOverrides = {};
  currentPlan.spend.userTouched = {};
  currentPlan.spend.minOverrides = {};
  currentPlan.spend.maxOverrides = {};
  autoSave();
}

function applyModelRatioSolve(clearHighlights) {
  ensureSpend();
  const years = getPlanYears();
  const fundUntil = currentPlan.spend.fundUntil || years[years.length - 1];
  const relevant = years.filter(y => y <= fundUntil);
  const baseByYear = {};
  years.forEach(y => {
    baseByYear[y] = y <= fundUntil ? getTargetForYear(y) : 0;
  });
  let sum = Object.values(baseByYear).reduce((a, b) => a + (Number(b) || 0), 0);
  if (sum <= 0) {
    resetTargets();
    if (clearHighlights) currentPlan.spend.userTouched = {};
    finishSolveFeedback();
    return;
  }

  const minResidual = Math.max(0, Number(currentPlan.spend.minNetWorthAtFund) || 0);
  const endTol = 50;

  // Already balanced at current ratio → do nothing (avoids £1000 → £927 no-op drift)
  if (typeof getPlanBalanceStatus === "function") {
    const st = getPlanBalanceStatus();
    const endGap = Math.abs((st.endNWRaw || st.endNW || 0) - minResidual);
    if (st.code === "ok" && endGap < 100) {
      if (clearHighlights) currentPlan.spend.userTouched = {};
      autoSave();
      finishSolveFeedback();
      return;
    }
  }

  // Seek f where unclamped end NW ≈ minResidual (default 0)
  // Also require minNW not deeply negative when possible
  const fundIdx = years.indexOf(fundUntil);
  const seekOpts = { allowNegative: true };
  const evalF = (f) => {
    const path = simulateNetWorthPath(y => {
      if (y > fundUntil) return 0;
      return Math.max(0, (baseByYear[y] ?? 0) * f * inflationFactor(y));
    }, seekOpts);
    let minNW = Infinity;
    relevant.forEach(y => {
      const i = years.indexOf(y);
      minNW = Math.min(minNW, path[i] ?? 0);
    });
    const endNW = path[fundIdx >= 0 ? fundIdx : path.length - 1] ?? 0;
    return { endNW, minNW };
  };

  const atOne = evalF(1);
  if (Math.abs(atOne.endNW - minResidual) < endTol && atOne.minNW >= -50) {
    currentPlan.spend.modelRatio = 1;
    if (clearHighlights) currentPlan.spend.userTouched = {};
    autoSave();
    finishSolveFeedback();
    return;
  }

  let hi = 20;
  for (let i = 0; i < 12; i++) {
    if (evalF(hi).endNW <= minResidual + 0.5) break;
    hi *= 1.5;
    if (hi > 500) break;
  }
  let lo = 0, best = 1;
  for (let iter = 0; iter < 48; iter++) {
    const mid = (lo + hi) / 2;
    const { endNW } = evalF(mid);
    if (endNW > minResidual + 0.5) {
      lo = mid;
      best = mid;
    } else {
      hi = mid;
      best = mid;
    }
  }
  // Only snap to 1 when essentially exact — a 2% snap hid needed ratios like 0.98
  if (Math.abs(best - 1) < 0.001) best = 1;
  currentPlan.spend.modelRatio = isFinite(best) && best > 0 ? best : 1;
  if (currentPlan.spend.modelRatio > 50) currentPlan.spend.modelRatio = 50;
  if (currentPlan.spend.modelRatio < 0.0001) currentPlan.spend.modelRatio = 0.0001;
  if (clearHighlights) currentPlan.spend.userTouched = {};
  autoSave();
  finishSolveFeedback();
}

function finishSolveFeedback() {
  const bal = typeof getPlanBalanceStatus === "function" ? getPlanBalanceStatus() : null;
  if (!bal) return;
  if (bal.code === "ok") {
    playSolveSuccess();
  } else {
    playSolveFail();
    showPlanWarningPopup(bal);
  }
  // Refresh warning strip if on dashboard
  if (typeof refreshDashboardBalanceStatus === "function") {
    try { refreshDashboardBalanceStatus(); } catch (e) {}
  }
}

function solvePlanBalance() {
  noteAction("Solve balance (NES ratio)");
  applyModelRatioSolve(false);
}
window.solvePlanBalance = solvePlanBalance;

function rebaseTargets() {
  // Rebase: shift level; clear highlights so shape is the new baseline
  applyModelRatioSolve(true);
}



// ---------- Motion / chart animation ----------
function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { return false; }
}

let _lastGaugeAngle = 0;

function animateSvgPaths(root, duration) {
  if (!root || prefersReducedMotion()) return;
  const ms = duration || 650;
  root.querySelectorAll("path[stroke]:not([fill='none'][stroke-dasharray])").forEach(path => {
    try {
      if (path.getAttribute("fill") && path.getAttribute("fill") !== "none") return; // skip areas
      const len = path.getTotalLength();
      if (!len || len < 2) return;
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect(); // reflow
      path.style.transition = `stroke-dashoffset ${ms}ms ease-out`;
      path.style.strokeDashoffset = "0";
      setTimeout(() => {
        path.style.transition = "";
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
      }, ms + 40);
    } catch (e) {}
  });
}

function fadeInChartCard(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove("chart-fade-in");
  void el.offsetWidth;
  el.classList.add("chart-fade-in");
}

// ---------- Dashboard HTML snapshot ----------
const dashboardHTML = page.innerHTML;

// ---------- RENDER: PEOPLE ----------
function renderPersonTaxSection(p, idx) {
  const t = ensurePersonTax(p);
  const bands = (t.bands || []).map((b, bi) => `
    <div class="tax-band-row" data-idx="${idx}" data-bi="${bi}">
      <input type="number" class="tax-from" data-idx="${idx}" data-bi="${bi}" value="${b.from ?? 0}" title="From">
      <input type="number" class="tax-to" data-idx="${idx}" data-bi="${bi}" value="${b.to == null ? "" : b.to}" placeholder="∞" title="To">
      <input type="number" class="tax-rate" data-idx="${idx}" data-bi="${bi}" value="${b.rate ?? 0}" title="Rate %" step="0.1">
    </div>`).join("");
  return `
    <details class="person-tax-details">
      <summary>Tax &amp; NI (this person)</summary>
      <div class="person-tax-body">
        <label class="inline-check"><input type="checkbox" class="tax-use" data-idx="${idx}" ${t.useTax !== false ? "checked" : ""}> Apply tax to this person's taxable income</label>
        <div class="form-row" style="margin-top:8px;">
          <div class="form-group"><label>Personal allowance £</label>
            <input type="number" class="tax-pa" data-idx="${idx}" value="${t.personalAllowance ?? 12570}"></div>
          <div class="form-group"><label>NI threshold £</label>
            <input type="number" class="tax-ni-th" data-idx="${idx}" value="${t.niThreshold ?? 12570}"></div>
          <div class="form-group"><label>NI rate %</label>
            <input type="number" class="tax-ni-rate" data-idx="${idx}" value="${t.niRate ?? 8}" step="0.1"></div>
        </div>
        <p class="field-hint">Bands: from → to (blank = no upper limit), rate %</p>
        <div class="tax-bands-head"><span>From</span><span>To</span><span>Rate %</span></div>
        ${bands}
        <p class="field-hint">Tax is subtracted in the projection so income − tax − spend = change in pots. Savings/investments: use a lower growth rate for tax drag — see Help.</p>
      </div>
    </details>`;
}

function renderPeoplePage() {
  if (!currentPlan.people || !currentPlan.people.length) {
    currentPlan.people = [
      { id: "p1", name: "", dateOfBirth: "", photo: null },
      { id: "p2", name: "", dateOfBirth: "", photo: null }
    ];
  }
  currentPlan.people.forEach((p, i) => {
    if (!p.id) p.id = "p" + (i + 1);
    if (p.photo === undefined) p.photo = null;
  });

  const cards = currentPlan.people.map((p, idx) => {
    const title = p.name ? escapeHtml(p.name) : (idx === 0 ? "Person 1" : idx === 1 ? "Person 2" : "Person " + (idx + 1));
    const role = idx === 0 ? "Primary" : (idx === 1 ? "Partner" : "Additional");
    const avatar = p.photo
      ? `<img class="person-avatar-img" src="${p.photo}" alt="">`
      : `<span class="person-avatar-icon">👤</span>`;
    const canRemove = idx >= 2;
    return `
      <div class="person-card" data-idx="${idx}">
        <div class="person-card-header">
          <label class="person-avatar-wrap" title="Click to add / change photo">
            <input type="file" accept="image/*" class="person-photo-input" data-idx="${idx}" hidden>
            <div class="person-avatar">${avatar}</div>
          </label>
          <div style="flex:1;">
            <h3>${title}</h3>
            <div class="person-role">${role}</div>
          </div>
          ${canRemove ? `<button type="button" class="btn-icon danger person-remove" data-idx="${idx}" title="Remove">✕</button>` : ""}
        </div>
        <div class="form-group">
          <label>Name</label>
          <input type="text" class="person-name" data-idx="${idx}" placeholder="e.g. Name" value="${escapeHtml(p.name || "")}">
        </div>
        <div class="form-group">
          <label>Date of Birth</label>
          <input type="date" class="person-dob" data-idx="${idx}" value="${p.dateOfBirth || ""}">
        </div>
        ${renderPersonTaxSection(p, idx)}
      </div>`;
  }).join("");

  return `
    <div class="page people-page">
      <header class="page-header">
        <div>
          <h1>People</h1>
          <p class="subtitle">Who is included in this financial plan</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
          <button class="btn-primary" type="button" id="addPersonBtn">+ Add person</button>
        </div>
      </header>

      <div class="joint-toggle joint-switch-row">
        <label class="mode-switch compact" title="Off = only the first person is active on the plan">
          <span class="mode-side ${!currentPlan.isJoint ? "active" : ""}">One person</span>
          <input type="checkbox" id="jointPlan" ${currentPlan.isJoint ? "checked" : ""}>
          <span class="mode-track"><span class="mode-knob"></span></span>
          <span class="mode-side ${currentPlan.isJoint ? "active" : ""}">Joint / household</span>
        </label>
        <span class="field-hint">Two named people are treated as a shared household. Switch off to focus on person 1 only.</span>
      </div>

      <div class="people-grid ${currentPlan.isJoint ? "is-joint" : "is-solo"}">
        ${cards}
      </div>
    </div>
  `;
}

function attachPeopleListeners() {
  const joint = document.getElementById("jointPlan");
  if (!joint) return;

  const applyJointUI = () => {
    const on = joint.checked;
    currentPlan.isJoint = on;
    const grid = document.querySelector(".people-grid");
    if (grid) {
      grid.classList.toggle("is-joint", on);
      grid.classList.toggle("is-solo", !on);
    }
    document.querySelectorAll(".joint-switch-row .mode-side").forEach((el, i) => {
      el.classList.toggle("active", on ? i === 1 : i === 0);
    });
    // Grey-out person 2+ when solo
    document.querySelectorAll(".person-card").forEach((card, idx) => {
      if (idx === 0) {
        card.classList.remove("person-disabled");
        card.querySelectorAll("input,select,button").forEach(el => { if (!el.classList.contains("person-photo-input")) el.disabled = false; });
      } else {
        card.classList.toggle("person-disabled", !on);
        card.querySelectorAll("input,select,button").forEach(el => {
          if (el.classList.contains("person-photo-input")) return;
          el.disabled = !on;
        });
      }
    });
  };

  const saveAll = () => {
    currentPlan.isJoint = joint.checked;
    // Two named people ⇒ joint household for labelling
    const namedCount = currentPlan.people.filter(p => (p.name || "").trim()).length;
    if (namedCount >= 2) currentPlan.isJoint = true;
    document.querySelectorAll(".person-name").forEach(inp => {
      const i = parseInt(inp.dataset.idx, 10);
      if (currentPlan.people[i]) currentPlan.people[i].name = inp.value.trim();
    });
    document.querySelectorAll(".person-dob").forEach(inp => {
      const i = parseInt(inp.dataset.idx, 10);
      if (currentPlan.people[i]) currentPlan.people[i].dateOfBirth = inp.value;
    });
    const names = currentPlan.people.map(p => p.name).filter(Boolean);
    if (names.length) currentPlan.meta.name = names.join(" & ");
    autoSave();
  };

  joint.addEventListener("change", () => { applyJointUI(); saveAll(); });
  applyJointUI();
  document.querySelectorAll(".person-name").forEach(inp => {
    inp.addEventListener("input", () => {
      saveAll();
      const i = parseInt(inp.dataset.idx, 10);
      const h = inp.closest(".person-card")?.querySelector("h3");
      if (h) h.textContent = inp.value.trim() || (i === 0 ? "Person 1" : i === 1 ? "Person 2" : "Person " + (i + 1));
    });
  });
  document.querySelectorAll(".person-dob").forEach(inp => inp.addEventListener("change", () => {
    const chk = isReasonableDob(inp.value);
    if (inp.value && !chk.ok) {
      alert(chk.msg);
      return;
    }
    saveAll();
  }));

  const saveTax = () => {
    document.querySelectorAll(".person-card").forEach(card => {
      const i = parseInt(card.querySelector(".person-name")?.dataset.idx, 10);
      if (isNaN(i) || !currentPlan.people[i]) return;
      const p = currentPlan.people[i];
      ensurePersonTax(p);
      const use = card.querySelector(".tax-use");
      if (use) p.tax.useTax = use.checked;
      const pa = card.querySelector(".tax-pa");
      if (pa) p.tax.personalAllowance = parseFloat(pa.value) || 0;
      const nth = card.querySelector(".tax-ni-th");
      if (nth) p.tax.niThreshold = parseFloat(nth.value) || 0;
      const nr = card.querySelector(".tax-ni-rate");
      if (nr) p.tax.niRate = parseFloat(nr.value) || 0;
      p.tax.bands = [];
      card.querySelectorAll(".tax-band-row").forEach(row => {
        const from = parseFloat(row.querySelector(".tax-from")?.value) || 0;
        const toRaw = row.querySelector(".tax-to")?.value;
        const to = toRaw === "" || toRaw == null ? null : parseFloat(toRaw);
        const rate = parseFloat(row.querySelector(".tax-rate")?.value) || 0;
        p.tax.bands.push({ from, to, rate });
      });
    });
    autoSave();
  };
  document.querySelectorAll(".tax-use, .tax-pa, .tax-ni-th, .tax-ni-rate, .tax-from, .tax-to, .tax-rate").forEach(el => {
    el.addEventListener("change", saveTax);
  });

  document.querySelectorAll(".person-photo-input").forEach(inp => {
    inp.addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 800000) {
        alert("Please use a smaller image (under ~800KB).");
        return;
      }
      const i = parseInt(inp.dataset.idx, 10);
      const reader = new FileReader();
      reader.onload = () => {
        if (currentPlan.people[i]) {
          currentPlan.people[i].photo = reader.result;
          autoSave();
          page.innerHTML = renderPeoplePage();
          attachPeopleListeners();
          updateSaveStatus();
        }
      };
      reader.readAsDataURL(file);
    });
  });

  document.querySelectorAll(".person-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!(await appConfirmYesNo("Remove this person from the plan?"))) return;
      const i = parseInt(btn.dataset.idx, 10);
      if (i < 2) return;
      currentPlan.people.splice(i, 1);
      autoSave();
      page.innerHTML = renderPeoplePage();
      attachPeopleListeners();
      updateSaveStatus();
    });
  });

  document.getElementById("addPersonBtn")?.addEventListener("click", () => {
    currentPlan.people.push({ id: uid(), name: "", dateOfBirth: "", photo: null });
    autoSave();
    page.innerHTML = renderPeoplePage();
    attachPeopleListeners();
    updateSaveStatus();
  });
}

// ---------- RENDER: ACCOUNTS LIST ----------
function renderAccountsPage() {
  const accounts = currentPlan.accounts || [];

  let rows = "";
  if (accounts.length === 0) {
    rows = `
      <div class="empty-state">
        <div class="empty-icon">◫</div>
        <h3>No accounts yet</h3>
        <p>Add your first account to start building your net worth picture.</p>
        <button class="btn-primary" onclick="openAccountEditor()">+ Add Account</button>
      </div>
    `;
  } else {
    rows = `
      <div class="accounts-table">
        <div class="accounts-table-header" style="grid-template-columns: 2fr 1.2fr 1.2fr 1fr 1fr 110px;">
          <span>Account</span>
          <span>Owner</span>
          <span>Type</span>
          <span class="text-right">Balance</span>
          <span class="text-right">Growth</span>
          <span></span>
        </div>
        <div id="accountsSortList" class="sortable-list">
        ${accounts.map((acc, idx) => {
          const typeLabel = (ACCOUNT_TYPES.find(t => t.value === acc.type) || {}).label || acc.type || "—";
          return `
          <div class="accounts-table-row sortable-row" draggable="true" data-id="${acc.id}" data-idx="${idx}" style="grid-template-columns: 2fr 1.2fr 1.2fr 1fr 1fr 110px;">
            <div class="acc-name">
              <span class="acc-dot" style="background:${acc.themeColor || '#7C3AED'}"></span>
              ${escapeHtml(acc.name)}
            </div>
            <div>${escapeHtml(getPersonName(acc.ownerId))}</div>
            <div class="acc-type">${escapeHtml(typeLabel)}</div>
            <div class="text-right">${formatMoney(acc.startBalance)}</div>
            <div class="text-right">${acc.annualGrowth != null ? acc.annualGrowth + '%' : '—'}</div>
            <div class="acc-actions">
              <button class="btn-icon" onclick="openAccountEditor('${acc.id}')" title="Edit">✎</button>
              <button class="btn-icon danger" onclick="deleteAccount('${acc.id}')" title="Delete">✕</button>
              <span class="drag-handle" title="Drag to reorder" aria-label="Reorder">☰</span>
            </div>
          </div>`;
        }).join("")}
        </div>
      </div>

      <div class="accounts-summary-bar">
        <div>
          <span class="label">Net Worth (from accounts)</span>
          <span class="value">${formatMoney(calcNetWorth())}</span>
        </div>
        <button class="btn-primary" onclick="openAccountEditor()">+ Add Account</button>
      </div>
    `;
  }

  return `
    <div class="page accounts-page">
      <header class="page-header">
        <div>
          <h1>Accounts</h1>
          <p class="subtitle">Cash, investments, pensions, property & liabilities</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      ${rows}
      <div class="collapse-section open" style="margin-top:16px;" data-section="accChart">
        <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
          <span>Accounts over time</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <div class="acc-chart-toolbar" id="accountsChartToolbar"></div>
          <div id="accountsOverviewChart" class="accounts-overview-chart"></div>
        </div>
      </div>
    ${renderTypeColorSettings("accounts")}
    </div>
  `;
}

function drawIncomeOverviewChart() {
  const el = document.getElementById("incomeOverviewChart");
  if (!el) return;
  const years = getPlanYears();
  const left = 52, bottom = 52, top = 12, w = 900, h = 220;
  const innerH = h - bottom - top;
  const step = years.length > 1 ? (w - left - 10) / (years.length - 1) : w - left;
  const values = years.map(y => calcIncomeForYear(y) / 12);
  const maxV = Math.max(...values, 1) * 1.15;
  let path = "", grid = "", xLabels = "";
  for (let i = 0; i <= 3; i++) {
    const val = maxV - (maxV / 3) * i;
    const y = top + (innerH / 3) * i;
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 4}" y="${y + 3}" text-anchor="end" class="scale-label">£${Math.round(val).toLocaleString()}</text>`;
  }
  years.forEach((y, i) => {
    if (!(i === 0 || i === years.length - 1 || y % 5 === 0)) return;
    const x = left + i * step;
    const ly = h - 10;
    xLabels += `<text x="${x}" y="${ly}" text-anchor="end" class="scale-label year-label" transform="rotate(-32 ${x} ${ly})">${y}</text>`;
  });
  const pts = values.map((v, i) => `${left + i * step},${top + innerH - (v / maxV) * innerH}`);
  path = `<path d="M ${pts.join(" L ")}" fill="none" stroke="#059669" stroke-width="2.5"/>`;
  el.innerHTML = `<svg width="100%" height="${h + 12}" viewBox="0 0 ${w} ${h}" style="overflow:visible">${grid}${path}${xLabels}</svg>
    <p class="field-hint">Monthly equivalent of annual income by plan year</p>`;
  animateSvgPaths(el.querySelector("svg"), 550);
  fadeInChartCard(el);
}

function drawAccountsOverviewChart() {
  const el = document.getElementById("accountsOverviewChart");
  const toolbar = document.getElementById("accountsChartToolbar");
  if (!el) return;
  const years = getPlanYears();
  const accounts = currentPlan.accounts || [];
  if (!accounts.length) {
    el.innerHTML = `<p class="field-hint">Add accounts to see the chart.</p>`;
    if (toolbar) toolbar.innerHTML = "";
    return;
  }
  // Standalone growth path per account (start balance × growth^n) — clearer than strategy drain
  const series = {};
  accounts.forEach(acc => {
    const g = resolveGrowthPct(acc) / 100;
    const startY = acc.startDate ? new Date(acc.startDate).getFullYear() : years[0];
    let bal = Number(acc.startBalance) || 0;
    const values = years.map(y => {
      if (y < startY) return 0;
      if (y === startY) return bal;
      // compound from start
      const n = y - startY;
      return bal * Math.pow(1 + g, n);
    });
    series[acc.id] = { name: acc.name || "Account", color: acc.themeColor || getAccountTypeColor(acc.type), values };
  });
  const accIds = Object.keys(series);
  if (!window._accChartVisible) window._accChartVisible = {};
  accIds.forEach(id => { if (window._accChartVisible[id] === undefined) window._accChartVisible[id] = true; });

  if (toolbar) {
    toolbar.innerHTML = `<span class="field-hint" style="width:100%;margin-bottom:4px;">Growth path by account (before strategy transfers). Click to show/hide.</span>` +
      accIds.map(id => {
        const on = window._accChartVisible[id] !== false;
        return `<button type="button" class="acc-series-btn${on ? " on" : ""}" data-id="${id}">
          <span class="legend-swatch" style="background:${series[id].color}"></span>${escapeHtml(series[id].name)}
        </button>`;
      }).join("");
    toolbar.querySelectorAll(".acc-series-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        window._accChartVisible[btn.dataset.id] = !window._accChartVisible[btn.dataset.id];
        drawAccountsOverviewChart();
      });
    });
  }

  const visible = accIds.filter(id => window._accChartVisible[id] !== false);
  const left = 58, bottom = 50, top = 18, right = 20;
  const w = 920, h = 280;
  const innerW = w - left - right;
  const innerH = h - bottom - top;
  const step = years.length > 1 ? innerW / (years.length - 1) : innerW;
  let maxV = 1;
  visible.forEach(id => series[id].values.forEach(v => { maxV = Math.max(maxV, v || 0); }));
  maxV = Math.max(maxV * 1.1, 1);

  let grid = "", paths = "", markers = "", xLabels = "";
  for (let i = 0; i <= 4; i++) {
    const val = maxV * (1 - i / 4);
    const y = top + (innerH * i) / 4;
    grid += `<line x1="${left}" y1="${y}" x2="${w - right}" y2="${y}" stroke="#EEF2F7"/>`;
    const lab = val >= 1000 ? "£" + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + "k" : "£" + Math.round(val);
    grid += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="scale-label">${lab}</text>`;
  }
  years.forEach((y, i) => {
    if (!(i === 0 || i === years.length - 1 || y % 5 === 0)) return;
    const x = left + i * step;
    xLabels += `<text x="${x}" y="${h - 10}" text-anchor="end" class="scale-label year-label" transform="rotate(-32 ${x} ${h - 10})">${y}</text>`;
  });
  visible.forEach(id => {
    const s = series[id];
    const pts = s.values.map((v, i) => `${left + i * step},${top + innerH - ((v || 0) / maxV) * innerH}`);
    paths += `<path d="M ${pts.join(" L ")}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => {
      if (!(i === 0 || i === s.values.length - 1 || years[i] % 5 === 0)) return;
      const x = left + i * step, y = top + innerH - ((v || 0) / maxV) * innerH;
      markers += `<circle cx="${x}" cy="${y}" r="3.5" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>`;
    });
  });
  el.innerHTML = `<svg width="100%" height="${h + 10}" viewBox="0 0 ${w} ${h}" style="overflow:visible;background:#FAFBFC;border-radius:12px;">${grid}${paths}${markers}${xLabels}</svg>`;
  animateSvgPaths(el.querySelector("svg"), 500);
  fadeInChartCard(el);
}


function attachSortableList(listId, arrayKey) {
  const list = document.getElementById(listId);
  if (!list) return;
  let dragEl = null;
  list.querySelectorAll(".sortable-row").forEach(row => {
    row.addEventListener("dragstart", e => {
      dragEl = row;
      row.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", row.dataset.id || ""); } catch (err) {}
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      dragEl = null;
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dragEl || dragEl === row) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over", "drag-over-before", "drag-over-after"));
      row.classList.add("drag-over", before ? "drag-over-before" : "drag-over-after");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const arr = currentPlan[arrayKey] || [];
      const fromId = dragEl.dataset.id;
      const toId = row.dataset.id;
      const from = arr.findIndex(x => x.id === fromId);
      const to = arr.findIndex(x => x.id === toId);
      if (from < 0 || to < 0) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      const [item] = arr.splice(from, 1);
      let insertAt = arr.findIndex(x => x.id === toId);
      if (!before) insertAt += 1;
      if (insertAt < 0) insertAt = arr.length;
      arr.splice(insertAt, 0, item);
      autoSave();
      const page = arrayKey === "accounts" ? "accounts" : "income";
      const active = document.querySelector(`.navButton[data-page="${page}"]`);
      if (active) active.click();
    });
  });
}
window.attachSortableList = attachSortableList;

async function deleteAccount(id) {
  if (!(await appConfirmYesNo("Delete this account?"))) return;
  currentPlan.accounts = currentPlan.accounts.filter(a => a.id !== id);
  autoSave();
  // Re-render
  const active = document.querySelector(".navButton.active");
  if (active) active.click();
}

// ---------- SLIDE-OUT ACCOUNT EDITOR (with interactive graph) ----------
let editingAccountId = null;
let editorOverrides = {};
let editorChartState = {};


function ensureTypeColors() {
  if (!currentPlan.typeColors) currentPlan.typeColors = {};
  if (!currentPlan.typeColors.accounts) {
    currentPlan.typeColors.accounts = {
      current_savings: "#2563EB",
      cash_isa: "#0EA5E9",
      s_and_s_isa: "#7C3AED",
      premium_bonds: "#14B8A6",
      gia: "#6366F1",
      sipp: "#D946EF",
      sipp_drawdown: "#A21CAF",
      other: "#94A3B8"
    };
  }
  if (!currentPlan.typeColors.income) {
    currentPlan.typeColors.income = {
      employment: "#059669",
      pension: "#0D9488",
      rental: "#0284C7",
      dividend: "#4F46E5",
      other: "#64748B"
    };
  }
  if (!currentPlan.typeColors.spend) {
    currentPlan.typeColors.spend = {
      essential: "#94A3B8",
      nonessential: getThemeColor("spend") || "#EAB308"
    };
  }
  return currentPlan.typeColors;
}

function getAccountTypeColor(type) {
  ensureTypeColors();
  return currentPlan.typeColors.accounts[type] || "#94A3B8";
}

function getIncomeTypeColor(type) {
  ensureTypeColors();
  return currentPlan.typeColors.income[type] || "#059669";
}

function renderTypeColorSettings(kind) {
  ensureTypeColors();
  let rows = "";
  if (kind === "accounts") {
    rows = ACCOUNT_TYPES.map(t => `
      <div class="type-color-row">
        <span>${t.label}</span>
        <input type="color" data-kind="accounts" data-type="${t.value}" value="${getAccountTypeColor(t.value)}">
      </div>`).join("");
  } else if (kind === "income") {
    const types = (typeof INCOME_TYPES !== "undefined" ? INCOME_TYPES : []);
    rows = types.map(t => `
      <div class="type-color-row">
        <span>${t.label}</span>
        <input type="color" data-kind="income" data-type="${t.value}" value="${getIncomeTypeColor(t.value)}">
      </div>`).join("");
  } else if (kind === "spend") {
    ensureTypeColors();
    rows = `
      <div class="type-color-row"><span>Essential</span>
        <input type="color" data-kind="spend" data-type="essential" value="${currentPlan.typeColors.spend.essential}"></div>
      <div class="type-color-row"><span>Non Essential Spend</span>
        <input type="color" data-kind="spend" data-type="nonessential" value="${currentPlan.typeColors.spend.nonessential}"></div>`;
  }
  return `
    <div class="collapse-section type-color-settings" style="margin-top:20px;">
      <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
        <span>Colours</span>
        <span class="collapse-chevron">▾</span>
      </button>
      <div class="collapse-body">
        <p class="settings-desc" style="margin-top:0;">Colours for types, charts and NES.</p>
        <div class="type-color-stack">${rows}</div>
      </div>
    </div>`;
}

function attachTypeColorListeners() {
  document.querySelectorAll(".type-color-row input[type=color]").forEach(inp => {
    inp.addEventListener("input", () => {
      ensureTypeColors();
      const kind = inp.dataset.kind;
      const type = inp.dataset.type;
      currentPlan.typeColors[kind][type] = inp.value;
      if (kind === "spend" && type === "nonessential") {
        ensureThemeColors();
        currentPlan.themeColors.spend = inp.value;
      }
      autoSave();
    });
  });
}


const ACCOUNT_TYPES = [
  { value: "current_savings", label: "Current / Savings" },
  { value: "cash_isa", label: "Cash ISA" },
  { value: "s_and_s_isa", label: "Stocks & Shares ISA" },
  { value: "premium_bonds", label: "Premium Bonds" },
  { value: "gia", label: "General Investment Account" },
  { value: "sipp", label: "SIPP" },
  { value: "sipp_drawdown", label: "SIPP in drawdown" },
  { value: "other", label: "Other" }
];

function isSippDrawdownType(t) {
  return t === "sipp_drawdown";
}

function openAccountEditor(id = null) {
  editingAccountId = id;
  const acc = id ? currentPlan.accounts.find(a => a.id === id) : null;
  editorOverrides = acc && acc.overrides ? { ...acc.overrides } : {};

  const ownerOptions = currentPlan.people
    .filter(p => p.name)
    .map(p => `<option value="${p.id}" ${acc && acc.ownerId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");

  const typeOptions = ACCOUNT_TYPES.map(t =>
    `<option value="${t.value}" ${acc && acc.type === t.value ? "selected" : (!acc && t.value === "current_savings" ? "selected" : "")}>${t.label}</option>`
  ).join("");

  const panel = document.getElementById("slidePanel");
  const backdrop = document.getElementById("slideBackdrop");

  panel.innerHTML = `
    <div class="slide-header">
      <h2>${acc ? "Edit Account" : "New Account"}</h2>
      <button class="btn-icon" onclick="closeAccountEditor()">✕</button>
    </div>

    <div class="slide-body editor-with-chart">
      <div class="editor-controls">
        <div class="form-group">
          <label>Account Name</label>
          <input type="text" id="edName" value="${acc ? escapeHtml(acc.name) : ""}" placeholder="e.g. Main ISA">
        </div>

        <div class="form-group">
          <label>Owner</label>
          <select id="edOwner">
            <option value="">— Select person —</option>
            ${ownerOptions || '<option value="" disabled>Add people first</option>'}
          </select>
        </div>

        <div class="form-group">
          <label>Account Type</label>
          <select id="edType" onchange="toggleAccountPensionFields()">${typeOptions}</select>
        </div>
        <div id="edPensionFields" style="display:none;">
          <div id="edSippAccumFields">
            <div class="form-group">
              <label>Planned drawdown start (month)</label>
              <input type="month" id="edDrawdownStart" value="${acc && acc.drawdownStart ? String(acc.drawdownStart).slice(0,7) : ""}">
            </div>
            <p class="field-hint">Accumulation SIPP — you can still contribute. When you start drawdown, switch the type to <strong>SIPP in drawdown</strong> (or add a separate drawdown pot). Auto-convert on that date is planned later.</p>
          </div>
          <div id="edSippDdFields" style="display:none;">
            <p class="field-hint" style="margin-top:0;">This pot is already in drawdown. <strong>You cannot add contributions</strong> to it (strategy surplus transfers are blocked). Withdrawals come out via strategy shortfall rules like other pots.</p>
          </div>
          <div class="form-group">
            <label>Tax-free cash</label>
            <select id="edTaxFreeMode">
              <option value="none" ${!acc || !acc.taxFreeMode || acc.taxFreeMode === "none" ? "selected" : ""}>Not taken / tax-free as you withdraw (UFPLS-style)</option>
              <option value="pcls25" ${acc && acc.taxFreeMode === "pcls25" ? "selected" : ""}>25% tax-free lump sum already taken (or take at start)</option>
            </select>
          </div>
          <p class="field-hint">Enter the pot value you expect at the relevant date (with growth). PCLS / UFPLS notes feed later tax rules.</p>
        </div>

        <div class="form-group">
          <label>Start Date</label>
          <input type="date" id="edStart" value="${acc ? (acc.startDate || "2026-01-01") : "2026-01-01"}">
        </div>

        <div class="form-group">
          <label>Starting Balance (£)</label>
          <input type="number" id="edBalance" value="${acc ? acc.startBalance : 10000}" step="100">
        </div>

        ${renderGrowthModeFields("ed", acc ? { growthMode: acc.growthMode, growthRate: acc.annualGrowth, growthCustom: acc.growthCustom, growthAdj: acc.growthAdj, annualGrowth: acc.annualGrowth } : { growthMode: "inflation" }, 5)}

        <div class="form-group">
          <label>Theme Colour</label>
          <input type="color" id="edColor" value="${acc ? (acc.themeColor || "#7C3AED") : "#7C3AED"}">
        </div>
      </div>

      <div class="editor-chart-area">
        <div class="chart-toolbar">
          <h3>Projected Balance <span class="override-badge" id="edOverrideBadge" style="display:none">Has overrides</span></h3>
          <div class="chart-hint">Drag points · Double-click for exact value</div>
        </div>
        <div class="chart-container" id="edChartContainer">
          <div class="drag-tooltip" id="edTooltip"></div>
          <div class="modal-overlay" id="edModal">
            <div class="modal-card">
              <h4>Edit Point</h4>
              <div class="sub">Set exact value or % change from previous year</div>
              <div>
                <label>Target Value (£)</label>
                <input type="number" id="edModalVal">
              </div>
              <div>
                <label>Or % Change from Previous</label>
                <input type="number" step="0.1" id="edModalPct" placeholder="e.g. 7.5">
              </div>
              <div class="modal-actions">
                <button class="btn-apply" id="edModalApply">Apply</button>
                <button class="btn-reset" id="edModalReset">Reset Point</button>
                <button class="btn-cancel" id="edModalCancel">Cancel</button>
              </div>
            </div>
          </div>
          <svg id="edSvg" width="100%" height="100%" viewBox="0 0 480 260" preserveAspectRatio="none">
            <defs>
              <linearGradient id="edGrad" x1="0" y1="0" x2="0" y2="1">
                <stop id="edGradStop" offset="0%" stop-color="#7C3AED" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <g id="edGrid" transform="translate(50,15)"></g>
            <g id="edScales" transform="translate(50,15)"></g>
            <g transform="translate(50,15)">
              <path id="edArea" fill="url(#edGrad)"></path>
              <path id="edLine" fill="none" stroke="#7C3AED" stroke-width="2.5"></path>
              <g id="edPoints"></g>
            </g>
          </svg>
        </div>
      </div>
    </div>

    <div class="slide-footer">
      <button class="btn-secondary" onclick="resetEditorOverrides()">Reset Overrides</button>
      <button class="btn-secondary" onclick="closeAccountEditor()">Cancel</button>
      <button class="btn-primary" onclick="saveAccountFromEditor()">Save Account</button>
    </div>
  `;

  backdrop.classList.add("open");
  panel.classList.add("open");
  panel.classList.add("wide"); // wider panel for chart

  toggleAccountPensionFields();
  // Wire chart after DOM is ready
  setTimeout(initEditorChart, 30);
}

function closeAccountEditor() {
  document.getElementById("slidePanel").classList.remove("open", "wide");
  document.getElementById("slideBackdrop").classList.remove("open");
  editingAccountId = null;
  editorOverrides = {};
}

// Generic close used by backdrop
function closeSlide() {
  closeAccountEditor();
  closeIncomeEditor();
}
window.closeSlide = closeSlide;

async function resetEditorOverrides() {
  if (Object.keys(editorOverrides).length === 0) return;
  if (await appConfirmYesNo("Clear all manual point overrides?")) {
    editorOverrides = {};
    updateEditorChart();
  }
}

function saveAccountFromEditor() {
  const name = document.getElementById("edName").value.trim();
  if (!name) {
    alert("Please give the account a name.");
    return;
  }

  const data = {
    id: editingAccountId || uid(),
    name,
    ownerId: document.getElementById("edOwner").value,
    type: document.getElementById("edType").value,
    drawdownStart: document.getElementById("edDrawdownStart")?.value || "",
    taxFreeMode: document.getElementById("edTaxFreeMode")?.value || "none",
    startDate: document.getElementById("edStart").value,
    startBalance: parseFloat(document.getElementById("edBalance").value) || 0,
    ...(() => { const g = readGrowthModeFields("ed"); return { annualGrowth: g.annualGrowth, growthMode: g.growthMode, growthCustom: g.growthCustom, growthAdj: g.growthAdj }; })(),
    themeColor: document.getElementById("edColor").value,
    overrides: { ...editorOverrides }
  };

  if (editingAccountId) {
    const idx = currentPlan.accounts.findIndex(a => a.id === editingAccountId);
    if (idx >= 0) currentPlan.accounts[idx] = data;
  } else {
    currentPlan.accounts.push(data);
  }

  autoSave();
  closeAccountEditor();

  const active = document.querySelector(".navButton.active");
  if (active && active.dataset.page === "accounts") active.click();
}

// ---- Interactive chart logic for the editor ----
function initEditorChart() {
  const inputs = ["edBalance", "edGrowthVal", "edColor", "edStart", "edGrowthMode"];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateEditorChart);
      el.addEventListener("change", updateEditorChart);
    }
  });

  document.getElementById("edModalApply")?.addEventListener("click", applyEditorModal);
  document.getElementById("edModalReset")?.addEventListener("click", resetEditorPoint);
  document.getElementById("edModalCancel")?.addEventListener("click", () => {
    document.getElementById("edModal").style.display = "none";
  });

  updateEditorChart();
}

function updateEditorChart() {
  const amountEl = document.getElementById("edBalance");
  const growthEl = document.getElementById("edGrowthVal");
  const colorEl  = document.getElementById("edColor");
  const startEl  = document.getElementById("edStart");
  const endEl    = document.getElementById("edEnd");
  if (!amountEl) return;

  const startVal   = parseFloat(amountEl.value) || 0;
  const growthRate = (resolveGrowthPct({
    growthMode: document.getElementById("edGrowthMode")?.value,
    growthRate: parseFloat(growthEl?.value) || 0,
    growthAdj: document.getElementById("edGrowthMode")?.value === "inflation_plus" ? parseFloat(growthEl?.value) || 0 : 0,
    growthCustom: document.getElementById("edGrowthMode")?.value === "custom" ? parseFloat(growthEl?.value) || 0 : 0,
    annualGrowth: parseFloat(growthEl?.value) || 0
  }) || 0) / 100;
  const color      = colorEl.value || "#7C3AED";
  const startYear  = new Date(startEl.value || "2026-01-01").getFullYear();
  const endYear    = new Date(endEl.value || "2045-01-01").getFullYear();
  const pointsCount = Math.max(2, endYear - startYear + 1);

  let values = [];
  for (let i = 0; i < pointsCount; i++) {
    if (editorOverrides[i] !== undefined) values.push(editorOverrides[i]);
    else if (i === 0) values.push(startVal);
    else values.push(values[i - 1] * (1 + growthRate));
  }

  const maxVal = Math.max(...values, 100) * 1.12;
  const minVal = 0;
  const width = 400, height = 200;
  const stepX = pointsCount > 1 ? width / (pointsCount - 1) : width;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - minVal) / (maxVal - minVal)) * height;
    return { x, y, v, i };
  });

  const linePath = "M " + points.map(p => `${p.x},${p.y}`).join(" L ");
  const areaPath = `M 0,${height} L ` + points.map(p => `${p.x},${p.y}`).join(" L ") + ` L ${width},${height} Z`;

  document.getElementById("edLine").setAttribute("d", linePath);
  document.getElementById("edLine").setAttribute("stroke", color);
  document.getElementById("edArea").setAttribute("d", areaPath);
  document.getElementById("edGradStop").setAttribute("stop-color", color);

  // Points
  let ptsHtml = "";
  points.forEach(p => {
    const isOver = editorOverrides[p.i] !== undefined;
    const c = isOver ? "#F97316" : color;
    ptsHtml += `<circle class="chart-point-handle" data-index="${p.i}" cx="${p.x}" cy="${p.y}" r="5" fill="${c}" stroke="#fff" stroke-width="2"/>`;
  });
  document.getElementById("edPoints").innerHTML = ptsHtml;

  // Grid & scales – clearer labels, no overlap
  let grid = "", scales = "";
  for (let i = 0; i <= 4; i++) {
    const y = (height / 4) * i;
    const label = Math.round(maxVal - (maxVal / 4) * i);
    if (i < 4) grid += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="3 3"/>`;
    const labelText = label >= 1000
      ? "£" + (label / 1000).toFixed(label % 1000 === 0 ? 0 : 1) + "k"
      : "£" + label;
    scales += `<text x="-10" y="${y + 4}" text-anchor="end" class="scale-label">${labelText}</text>`;
  }
  const maxLabels = 7;
  const labelEvery = Math.max(1, Math.ceil((pointsCount - 1) / (maxLabels - 1)));
  for (let i = 0; i < pointsCount; i++) {
    if (i % labelEvery === 0 || i === pointsCount - 1) {
      scales += `<text x="${i * stepX}" y="${height + 20}" text-anchor="middle" class="scale-label">${startYear + i}</text>`;
    }
  }
  document.getElementById("edGrid").innerHTML = grid;
  document.getElementById("edScales").innerHTML = scales;

  document.getElementById("edOverrideBadge").style.display =
    Object.keys(editorOverrides).length ? "inline-block" : "none";

  // Store for interactions
  editorChartState = { maxVal, minVal, height, width, stepX, values, startYear, pointsCount };

  // Attach drag / dblclick
  const handles = document.querySelectorAll("#edPoints .chart-point-handle");
  handles.forEach(handle => {
    const index = parseInt(handle.dataset.index);

    handle.onmouseenter = () => {
      if (editorChartState.dragging != null) return;
      showEdTooltip(index);
    };
    handle.onmouseleave = () => {
      if (editorChartState.dragging == null) document.getElementById("edTooltip").style.display = "none";
    };
    handle.onmousedown = (e) => {
      e.preventDefault();
      editorChartState.dragging = index;
      document.getElementById("edTooltip").style.display = "block";
      window.addEventListener("mousemove", onEdDrag);
      window.addEventListener("mouseup", onEdDragEnd);
    };
    handle.ondblclick = (e) => {
      e.stopPropagation();
      editorChartState.modalIndex = index;
      document.getElementById("edModalVal").value = Math.round(editorChartState.values[index]);
      if (index > 0 && editorChartState.values[index - 1]) {
        const pct = ((editorChartState.values[index] - editorChartState.values[index - 1]) / editorChartState.values[index - 1]) * 100;
        document.getElementById("edModalPct").value = pct.toFixed(1);
      } else {
        document.getElementById("edModalPct").value = "";
      }
      document.getElementById("edModal").style.display = "flex";
    };
  });
}

function showEdTooltip(index) {
  const s = editorChartState;
  let pct = "Start";
  if (index > 0) {
    const prev = s.values[index - 1];
    const p = prev ? ((s.values[index] - prev) / prev) * 100 : 0;
    pct = `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  }
  const y = s.height - ((s.values[index] - s.minVal) / (s.maxVal - s.minVal)) * s.height;
  const container = document.getElementById("edChartContainer");
  const rect = container.getBoundingClientRect();
  const left = ((50 + index * s.stepX) / 480) * rect.width;
  const top  = ((15 + y) / 260) * rect.height;
  const tip = document.getElementById("edTooltip");
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.innerHTML = `${s.startYear + index}: £${Math.round(s.values[index]).toLocaleString()} (${pct})`;
  tip.style.display = "block";
}

function onEdDrag(e) {
  const s = editorChartState;
  if (s.dragging == null) return;
  const svg = document.getElementById("edSvg");
  const rect = svg.getBoundingClientRect();
  const scaleY = 260 / rect.height;
  const relY = (e.clientY - rect.top) * scaleY - 15;
  const clamped = Math.max(0, Math.min(s.height, relY));
  const newVal = Math.max(0, Math.round(s.maxVal - (clamped / s.height) * s.maxVal));
  editorOverrides[s.dragging] = newVal;
  updateEditorChart();
  showEdTooltip(s.dragging);
}

function onEdDragEnd() {
  editorChartState.dragging = null;
  document.getElementById("edTooltip").style.display = "none";
  window.removeEventListener("mousemove", onEdDrag);
  window.removeEventListener("mouseup", onEdDragEnd);
}

function applyEditorModal() {
  const idx = editorChartState.modalIndex;
  if (idx == null) return;
  const val = parseFloat(document.getElementById("edModalVal").value);
  const pct = parseFloat(document.getElementById("edModalPct").value);

  if (!isNaN(val) && document.getElementById("edModalVal").value !== "") {
    editorOverrides[idx] = val;
  } else if (!isNaN(pct) && idx > 0) {
    const prev = editorChartState.values[idx - 1] || 0;
    editorOverrides[idx] = Math.round(prev * (1 + pct / 100));
  }
  document.getElementById("edModal").style.display = "none";
  updateEditorChart();
}

function resetEditorPoint() {
  const idx = editorChartState.modalIndex;
  if (idx != null) delete editorOverrides[idx];
  document.getElementById("edModal").style.display = "none";
  updateEditorChart();
}

// ---------- RENDER: DASHBOARD (live data) ----------
// ---------- DASHBOARD WIDGETS ----------
const WIDGET_OPTIONS = [
  { id: "networth", label: "Projected Net Worth" },
  { id: "stacked_nw", label: "Net Worth" },
  { id: "cashflow", label: "Income vs Spend" },
  { id: "rolling", label: "Annual Change" },
  { id: "spend_cats", label: "Spend by Category" },
  { id: "spend_stack", label: "All Spend (stacked)" },
  { id: "breakdown", label: "Accounts Breakdown" },
  { id: "income", label: "Income Summary" },
  { id: "blank", label: "Empty" }
];

// Dashboard metric year selection (0 = plan start year index)
let dashMetricYear = { nw: null, spend: null, income: null, cash: null };

function getDashYear(key) {
  const years = getPlanYears();
  const now = new Date().getFullYear();
  if (dashMetricYear[key] == null) {
    const idx = years.indexOf(now);
    dashMetricYear[key] = idx >= 0 ? idx : 0;
  }
  dashMetricYear[key] = Math.max(0, Math.min(years.length - 1, dashMetricYear[key]));
  return years[dashMetricYear[key]];
}

function refreshDashboardView() {
  page.innerHTML = renderDashboard();
  if (typeof attachNwHover === "function") attachNwHover();
  if (typeof attachPieHovers === "function") attachPieHovers();
  if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
  updateSaveStatus();
}

function syncLinkedDashYears(idx) {
  const years = getPlanYears();
  const keys = ["nw", "spend", "income", "cash"];
  const safe = Math.max(0, Math.min(years.length - 1, idx));
  keys.forEach(k => { dashMetricYear[k] = safe; });
}

function shiftDashYear(key, delta) {
  const years = getPlanYears();
  if (dashMetricYear[key] == null) getDashYear(key);
  dashMetricYear[key] = Math.max(0, Math.min(years.length - 1, dashMetricYear[key] + delta));
  if (currentPlan.settings?.linkDates) {
    syncLinkedDashYears(dashMetricYear[key]);
  }
  refreshDashboardView();
}
window.shiftDashYear = shiftDashYear;

function resetDashYear(key) {
  const years = getPlanYears();
  const now = new Date().getFullYear();
  const idx = years.indexOf(now);
  const i = idx >= 0 ? idx : 0;
  dashMetricYear[key] = i;
  if (currentPlan.settings?.linkDates) {
    syncLinkedDashYears(i);
  }
  refreshDashboardView();
}
window.resetDashYear = resetDashYear;

function toggleDashInflation() {
  ensureSpend();
  currentPlan.spend.showInflation = !currentPlan.spend.showInflation;
  autoSave();
  refreshDashboardView();
}
window.toggleDashInflation = toggleDashInflation;

// Visibility state for chart components (shared mini + expand)
let chartVisibility = { __total: true };

function ensureVisibility(series) {
  Object.keys(series).forEach(id => {
    if (chartVisibility[id] === undefined) chartVisibility[id] = true;
  });
  if (chartVisibility.__total === undefined) chartVisibility.__total = true;
}

function toggleChartItem(id) {
  chartVisibility[id] = !chartVisibility[id];
  const active = document.querySelector(".navButton.active");
  if (active && active.dataset.page === "dashboard") {
    page.innerHTML = renderDashboard();
  }
  if (document.getElementById("expandOverlay")?.classList.contains("open")) {
    refreshExpandNetWorth();
  }
}
window.toggleChartItem = toggleChartItem;

function miniPie(segments, size) {
  const segs = (segments || []).filter(s => s);
  let total = segs.reduce((s, x) => s + Math.max(0, Number(x.value) || 0), 0);
  // If all zero, still draw equal slices so the pie is visible
  const display = segs.map(s => ({
    name: s.name || "Item",
    value: Math.max(0, Number(s.value) || 0),
    color: s.color || "#94A3B8",
    weight: total > 0 ? Math.max(0, Number(s.value) || 0) : 1
  }));
  const weightTotal = display.reduce((s, x) => s + x.weight, 0) || 1;
  if (!display.length) {
    return `<svg class="mini-pie-svg" width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#E2E8F0"/></svg>`;
  }
  let angle = -90;
  let paths = "";
  display.forEach(seg => {
    const portion = seg.weight / weightTotal;
    const sweep = Math.max(portion * 360, 0.5);
    const a0 = angle * Math.PI / 180;
    const a1 = (angle + sweep) * Math.PI / 180;
    const x0 = 20 + 16 * Math.cos(a0), y0 = 20 + 16 * Math.sin(a0);
    const x1 = 20 + 16 * Math.cos(a1), y1 = 20 + 16 * Math.sin(a1);
    const large = sweep > 180 ? 1 : 0;
    const label = seg.name + ": £" + Math.round(seg.value).toLocaleString();
    paths += `<path class="pie-slice" data-tip="${label.replace(/"/g, "&quot;")}" d="M 20 20 L ${x0} ${y0} A 16 16 0 ${large} 1 ${x1} ${y1} Z" fill="${seg.color}" style="cursor:pointer"><title>${label}</title></path>`;
    angle += sweep;
  });
  return `<svg class="mini-pie-svg" width="${size}" height="${size}" viewBox="0 0 40 40">${paths}</svg>`;
}

function attachPieHovers() {
  document.querySelectorAll(".pie-slice").forEach(slice => {
    slice.addEventListener("mouseenter", e => {
      const tip = document.getElementById("graphTooltip") || createGraphTooltip();
      tip.textContent = slice.dataset.tip || "";
      tip.style.display = "block";
    });
    slice.addEventListener("mousemove", e => {
      const tip = document.getElementById("graphTooltip");
      if (tip) { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
    });
    slice.addEventListener("mouseleave", () => {
      const tip = document.getElementById("graphTooltip");
      if (tip) tip.style.display = "none";
    });
  });
}

function renderMiniNetWorthChart() {
  const { years, series, totals } = calcProjectedNetWorth();
  const hasData = currentPlan.accounts.length || (currentPlan.income || []).length || (currentPlan.spend?.pots || []).length;
  if (!hasData || years.length < 2) {
    return `<div class="chart-placeholder"><div class="placeholder-text">Add accounts or income to see projection</div></div>`;
  }
  ensureVisibility(series);

  const lines = [];
  if (chartVisibility.__total) lines.push({ name: "Total", color: "#7C3AED", values: totals, id: "__total", overridden: null, isTotal: true });
  Object.keys(series).forEach(id => {
    if (chartVisibility[id]) lines.push({ ...series[id], id, isTotal: false });
  });

  const allVals = lines.length ? lines.flatMap(l => l.values) : totals;
  const maxV = Math.max(...allVals, 1);
  const minV = Math.min(...allVals, 0);
  const range = maxV - minV || 1;
  const left = 48, bottom = 28, top = 10;
  const w = 440, h = 175;
  const innerW = w - left - 8;
  const innerH = h - bottom - top;
  const step = years.length > 1 ? innerW / (years.length - 1) : innerW;

  let grid = "", paths = "", markers = "";
  for (let i = 0; i <= 4; i++) {
    const val = maxV - (range / 4) * i;
    const y = top + (innerH / 4) * i;
    const label = val >= 1000 || val <= -1000 ? "£" + (val / 1000).toFixed(val >= 10000 || val <= -10000 ? 0 : 1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
  }

  lines.forEach(l => {
    const pts = l.values.map((v, i) => {
      const x = left + i * step;
      const y = top + innerH - ((v - minV) / range) * innerH;
      return { x, y, i, v };
    });
    const strokeW = l.isTotal ? 2.8 : 1.6;
    paths += `<path d="M ${pts.map(p => `${p.x},${p.y}`).join(" L ")}" fill="none" stroke="${l.color}" stroke-width="${strokeW}" opacity="${l.isTotal ? 1 : 0.85}"/>`;
    pts.forEach(p => {
      const isOver = l.overridden && l.overridden[p.i];
      const r = isOver ? 4 : 3;
      const fill = isOver ? "#F97316" : l.color;
      markers += `<circle class="nw-hover-pt" data-year="${years[p.i]}" data-val="${p.v}" data-name="${escapeHtml(l.name)}" cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
    });
  });

  let xLabels = "";
  const many = years.length > 12;
  years.forEach((y, i) => {
    const show = !many || i === 0 || i === years.length - 1 || y % 5 === 0;
    if (!show) return;
    const x = left + i * step;
    if (many) {
      xLabels += `<text x="${x}" y="${h - 4}" text-anchor="end" class="scale-label year-label" transform="rotate(-35 ${x} ${h - 4})">${y}</text>`;
    } else {
      xLabels += `<text x="${x}" y="${h - 8}" text-anchor="middle" class="scale-label">${y}</text>`;
    }
  });

  const legendItems = [
    `<span class="legend-item ${chartVisibility.__total ? "" : "off"}" onclick="toggleChartItem('__total')">
      <span class="legend-swatch" style="background:#7C3AED"></span>Total
    </span>`
  ];
  Object.keys(series).forEach(id => {
    legendItems.push(`
      <span class="legend-item ${chartVisibility[id] ? "" : "off"}" onclick="toggleChartItem('${id}')">
        <span class="legend-swatch" style="background:${series[id].color}"></span>${escapeHtml(series[id].name)}
      </span>`);
  });

  return `
    <div class="mini-chart-wrap" id="nwMiniChart">
      <svg width="100%" height="${many ? 200 : 185}" viewBox="0 0 ${w} ${h + (many ? 18 : 0)}">
        ${grid}${paths}${markers}${xLabels}
      </svg>
      <div class="chart-legend">${legendItems.join("")}</div>
    </div>`;
}

function attachNwHover() {
  document.querySelectorAll(".nw-hover-pt").forEach(pt => {
    pt.addEventListener("mouseenter", e => {
      const tip = document.getElementById("graphTooltip") || createGraphTooltip();
      tip.textContent = `${pt.dataset.name} ${pt.dataset.year}: £${Math.round(Number(pt.dataset.val)).toLocaleString()}`;
      tip.style.display = "block";
    });
    pt.addEventListener("mousemove", e => {
      const tip = document.getElementById("graphTooltip");
      if (tip) { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
    });
    pt.addEventListener("mouseleave", () => {
      const tip = document.getElementById("graphTooltip");
      if (tip) tip.style.display = "none";
    });
  });
}

function renderStackedNwWidget() {
  const years = getPlanYears();
  const { series } = calcProjectedNetWorth();
  const ids = Object.keys(series).filter(id => id !== "__spend" && id !== "__income");
  if (!ids.length || years.length < 2) {
    return `<div class="chart-placeholder"><div class="placeholder-text">Add accounts to see net worth</div></div>`;
  }
  // Cumulative stack layers for area chart (every year)
  const n = years.length;
  const layers = ids.map(id => ({
    id,
    name: series[id].name,
    color: series[id].color,
    values: series[id].values.map(v => Math.max(0, v || 0))
  }));
  const tops = layers.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    let run = 0;
    layers.forEach((layer, li) => {
      run += layer.values[i];
      tops[li][i] = run;
    });
  }
  const maxV = Math.max(...tops[tops.length - 1], 1);
  const left = 52, bottom = 28, top = 10, w = 440, h = 180;
  const innerH = h - bottom - top;
  const step = (w - left - 8) / (n - 1);
  const yOf = (v) => top + innerH - (v / maxV) * innerH;

  let areas = "", grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = maxV - (maxV / 4) * i;
    const y = top + (innerH / 4) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
  }
  for (let li = layers.length - 1; li >= 0; li--) {
    const topPts = [];
    const botPts = [];
    for (let i = 0; i < n; i++) {
      const x = left + i * step;
      topPts.push(`${x},${yOf(tops[li][i])}`);
      const bot = li === 0 ? 0 : tops[li - 1][i];
      botPts.unshift(`${x},${yOf(bot)}`);
    }
    areas += `<path d="M ${topPts.join(" L ")} L ${botPts.join(" L ")} Z" fill="${layers[li].color}" opacity="0.75"/>`;
  }
  // Top outline
  const outline = tops[tops.length - 1].map((v, i) => `${left + i * step},${yOf(v)}`).join(" L ");
  areas += `<path d="M ${outline}" fill="none" stroke="#4C1D95" stroke-width="1.5"/>`;

  let xLabels = "";
  const every = Math.max(1, Math.ceil((n - 1) / 6));
  years.forEach((y, i) => {
    if (i % every === 0 || i === n - 1) {
      xLabels += `<text x="${left + i * step}" y="${h - 6}" text-anchor="middle" class="scale-label">${y}</text>`;
    }
  });
  // Hover points on total
  let markers = "";
  tops[tops.length - 1].forEach((v, i) => {
    markers += `<circle class="nw-hover-pt" data-name="Total" data-year="${years[i]}" data-val="${v}" cx="${left + i * step}" cy="${yOf(v)}" r="3" fill="#4C1D95" stroke="#fff" stroke-width="1"/>`;
  });

  return `<div class="mini-chart-wrap">
    <svg width="100%" height="190" viewBox="0 0 ${w} ${h}">${grid}${areas}${markers}${xLabels}</svg>
  </div>`;
}

function renderCashflowWidget() {
  const years = getPlanYears();
  if (years.length < 2) {
    return `<div class="chart-placeholder"><div class="placeholder-text">Need plan years</div></div>`;
  }
  const income = years.map(y => calcIncomeForYear(y));
  const spend = years.map(y => getSpendForYear(y));
  const net = income.map((inc, i) => inc - spend[i]);
  const maxV = Math.max(...income, ...spend, 1);
  const left = 52, bottom = 28, top = 10, w = 440, h = 190;
  const mid = top + (h - bottom - top) / 2;
  const halfH = (h - bottom - top) / 2 - 4;
  const step = (w - left - 8) / (years.length - 1);
  const yInc = (v) => mid - (v / maxV) * halfH;
  const ySp = (v) => mid + (v / maxV) * halfH;
  const yNet = (v) => mid - (v / maxV) * halfH;

  let grid = `<line x1="${left}" y1="${mid}" x2="${w - 8}" y2="${mid}" stroke="#CBD5E1" stroke-width="1.5"/>`;
  // Y labels
  for (let i = 0; i <= 2; i++) {
    const val = maxV - (maxV / 2) * i;
    const y = mid - halfH + (halfH * i);
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(0) + "k" : "£" + Math.round(val);
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
    if (i < 2) grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
  }
  for (let i = 1; i <= 2; i++) {
    const val = (maxV / 2) * i;
    const y = mid + (halfH / 2) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(0) + "k" : "£" + Math.round(val);
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
  }

  // Income area (above)
  const incTop = income.map((v, i) => `${left + i * step},${yInc(v)}`).join(" L ");
  const incBase = years.map((_, i) => `${left + (years.length - 1 - i) * step},${mid}`).join(" L ");
  const incomeArea = `<path d="M ${incTop} L ${incBase} Z" fill="#86EFAC" opacity="0.55"/>`;
  const incomeLine = `<path d="M ${incTop}" fill="none" stroke="#16A34A" stroke-width="1.8"/>`;

  // Spend area (below)
  const spTop = spend.map((v, i) => `${left + i * step},${ySp(v)}`).join(" L ");
  const spBase = years.map((_, i) => `${left + (years.length - 1 - i) * step},${mid}`).join(" L ");
  const spendCol = getThemeColor("spend");
  const spendArea = `<path d="M ${spTop} L ${spBase} Z" fill="${spendCol}" opacity="0.35"/>`;
  const spendLine = `<path d="M ${spTop}" fill="none" stroke="${spendCol}" stroke-width="1.8"/>`;

  // Net line
  const netPts = net.map((v, i) => `${left + i * step},${yNet(v)}`).join(" L ");
  const netLine = `<path d="M ${netPts}" fill="none" stroke="#7C3AED" stroke-width="2.2"/>`;

  let markers = "";
  years.forEach((y, i) => {
    markers += `<circle class="nw-hover-pt" data-name="Income" data-year="${y}" data-val="${income[i]}" cx="${left + i * step}" cy="${yInc(income[i])}" r="2.5" fill="#16A34A" stroke="#fff" stroke-width="1"/>`;
    markers += `<circle class="nw-hover-pt" data-name="Spend" data-year="${y}" data-val="${spend[i]}" cx="${left + i * step}" cy="${ySp(spend[i])}" r="2.5" fill="${spendCol}" stroke="#fff" stroke-width="1"/>`;
    markers += `<circle class="nw-hover-pt" data-name="Net" data-year="${y}" data-val="${net[i]}" cx="${left + i * step}" cy="${yNet(net[i])}" r="2.5" fill="#7C3AED" stroke="#fff" stroke-width="1"/>`;
  });

  let xLabels = "";
  const every = Math.max(1, Math.ceil((years.length - 1) / 6));
  years.forEach((y, i) => {
    if (i % every === 0 || i === years.length - 1) {
      xLabels += `<text x="${left + i * step}" y="${h - 6}" text-anchor="middle" class="scale-label">${y}</text>`;
    }
  });

  return `<div class="mini-chart-wrap">
    <svg width="100%" height="200" viewBox="0 0 ${w} ${h}">${grid}${incomeArea}${spendArea}${incomeLine}${spendLine}${netLine}${markers}${xLabels}</svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#86EFAC"></span>Income</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${spendCol}"></span>Spend</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#7C3AED"></span>Net</span>
    </div>
  </div>`;
}

function renderRollingWidget() {
  const { years, totals } = calcProjectedNetWorth();
  if (years.length < 2) {
    return `<div class="chart-placeholder"><div class="placeholder-text">Need at least two years</div></div>`;
  }
  const deltas = totals.map((v, i) => i === 0 ? 0 : v - totals[i - 1]);
  const maxAbs = Math.max(...deltas.map(Math.abs), 1);
  const left = 52, bottom = 28, top = 10, w = 440, h = 180;
  const mid = top + (h - bottom - top) / 2;
  const halfH = (h - bottom - top) / 2 - 2;
  const step = (w - left - 8) / (years.length - 1);
  const yOf = (d) => mid - (d / maxAbs) * halfH;

  let grid = `<line x1="${left}" y1="${mid}" x2="${w - 8}" y2="${mid}" stroke="#CBD5E1"/>`;
  for (let i = 0; i <= 2; i++) {
    const val = maxAbs - (maxAbs / 2) * i;
    const y = mid - halfH + (halfH * i);
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(0) + "k" : "£" + Math.round(val);
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
  }
  for (let i = 1; i <= 2; i++) {
    const val = (maxAbs / 2) * i;
    const y = mid + (halfH / 2) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(0) + "k" : "£" + Math.round(val);
    grid += `<text x="${left - 6}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
  }

  // Area for positive / negative separately
  const posPts = deltas.map((d, i) => `${left + i * step},${yOf(Math.max(0, d))}`);
  const negPts = deltas.map((d, i) => `${left + i * step},${yOf(Math.min(0, d))}`);
  const baseBack = years.map((_, i) => `${left + (years.length - 1 - i) * step},${mid}`).join(" L ");
  const posArea = `<path d="M ${posPts.join(" L ")} L ${baseBack} Z" fill="#6EE7B7" opacity="0.5"/>`;
  const negArea = `<path d="M ${negPts.join(" L ")} L ${baseBack} Z" fill="#FCA5A5" opacity="0.5"/>`;
  const line = `<path d="M ${deltas.map((d, i) => `${left + i * step},${yOf(d)}`).join(" L ")}" fill="none" stroke="#6366F1" stroke-width="2"/>`;

  let markers = "";
  years.forEach((y, i) => {
    if (i === 0) return;
    markers += `<circle class="nw-hover-pt" data-name="Change" data-year="${y}" data-val="${deltas[i]}" cx="${left + i * step}" cy="${yOf(deltas[i])}" r="3" fill="${deltas[i] >= 0 ? "#059669" : "#DC2626"}" stroke="#fff" stroke-width="1"/>`;
  });

  let xLabels = "";
  const every = Math.max(1, Math.ceil((years.length - 1) / 6));
  years.forEach((y, i) => {
    if (i % every === 0 || i === years.length - 1) {
      xLabels += `<text x="${left + i * step}" y="${h - 6}" text-anchor="middle" class="scale-label">${y}</text>`;
    }
  });

  return `<div class="mini-chart-wrap">
    <svg width="100%" height="190" viewBox="0 0 ${w} ${h}">${grid}${posArea}${negArea}${line}${markers}${xLabels}</svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:#6EE7B7"></span>Increase</span>
      <span class="legend-item"><span class="legend-swatch" style="background:#FCA5A5"></span>Decrease</span>
    </div>
  </div>`;
}

function renderSpendCatsWidget() {
  ensureSpend();
  const year = getDashYear("spend");
  const pots = currentPlan.spend?.pots || [];
  const target = getTargetForYear(year);
  const cats = [
    ...pots.map(p => ({ name: p.name, value: getPotDisplayForYear(p, year) / 12, color: p.color || "#94A3B8" })),
    { name: "Non Essential Spend", value: (currentPlan.spend?.showInflation ? displayInflate(target, year) : target) / 12, color: getThemeColor("spend") }
  ].filter(c => c.value > 0);
  if (!cats.length) {
    return `<div class="chart-placeholder"><div class="placeholder-text">Add spend pots to see categories</div></div>`;
  }
  const maxV = Math.max(...cats.map(c => c.value), 1);
  const left = 100, top = 8, barH = 18, gap = 10;
  const w = 440, chartW = 300;
  let rows = "";
  cats.forEach((c, i) => {
    const y = top + i * (barH + gap);
    const bw = (c.value / maxV) * chartW;
    rows += `<text x="${left - 8}" y="${y + 13}" text-anchor="end" class="scale-label">${escapeHtml(c.name)}</text>`;
    rows += `<rect class="nw-hover-pt" data-name="${escapeHtml(c.name)}" data-year="${year}" data-val="${c.value}" x="${left}" y="${y}" width="${Math.max(2, bw)}" height="${barH}" rx="4" fill="${c.color}" opacity="0.85"/>`;
    rows += `<text x="${left + bw + 6}" y="${y + 13}" class="scale-label">${formatMoney(c.value)}/mo</text>`;
  });
  const h = top + cats.length * (barH + gap) + 8;
  return `<div class="mini-chart-wrap">
    <div style="font-size:11px;color:#94A3B8;margin-bottom:4px;">Monthly average · ${year}</div>
    <svg width="100%" height="${Math.max(120, h)}" viewBox="0 0 ${w} ${h}">${rows}</svg>
  </div>`;
}

function renderBreakdownWidget() {
  const typeTotals = {};
  ACCOUNT_TYPES.forEach(t => typeTotals[t.value] = 0);
  currentPlan.accounts.forEach(a => {
    const bal = Number(a.startBalance) || 0;
    if (typeTotals[a.type] !== undefined) typeTotals[a.type] += bal;
  });
  const netWorth = calcNetWorth();
  return `
    <div class="breakdown-list">
      ${ACCOUNT_TYPES.map(t => `
        <div class="breakdown-row">
          <span>${t.label}</span>
          <strong>${formatMoney(typeTotals[t.value] || 0)}</strong>
        </div>`).join("")}
      <div class="breakdown-row total"><span>Net Worth</span> <strong>${formatMoney(netWorth)}</strong></div>
    </div>`;
}

function renderIncomeWidget() {
  const year = (typeof getDashYear === "function" ? getDashYear("income") : null)
    || currentPlan.scale?.startYear
    || new Date().getFullYear();
  const planStart = currentPlan.scale?.startYear || year;
  const items = currentPlan.income || [];
  const rows = [];
  let earnedAnnual = 0;
  items.forEach(inc => {
    const start = inc.startDate ? new Date(inc.startDate).getFullYear() : planStart;
    const end = inc.endDate ? new Date(inc.endDate).getFullYear() : 9999;
    if (year < start || year > end) return;
    const growthBase = Math.max(start, planStart);
    const growth = resolveGrowthPct(inc) / 100;
    let annual;
    if (inc.type === "db_pension") {
      annual = (Number(inc.dbIncomeAnnual) || ((Number(inc.amountMonthly) || 0) * 12)) * Math.pow(1 + growth, Math.max(0, year - growthBase));
    } else {
      annual = (Number(inc.amountMonthly) || 0) * 12 * Math.pow(1 + growth, Math.max(0, year - growthBase));
    }
    annual *= (typeof incomeYearFraction === "function" ? incomeYearFraction(inc, year) : 1);
    earnedAnnual += annual;
    const display = typeof toDisplayMoney === "function" ? toDisplayMoney(annual, year) : annual;
    rows.push({ name: inc.name || "Income", monthly: display / 12 });
  });
  let interest = 0;
  try {
    const proj = calcProjectedNetWorth();
    interest = (proj.interestByYear && proj.interestByYear[year]) || 0;
    ((proj.interestDetailByYear && proj.interestDetailByYear[year]) || []).forEach(d => {
      const display = typeof toDisplayMoney === "function" ? toDisplayMoney(d.amount, year) : d.amount;
      rows.push({ name: d.name || "Interest", monthly: display / 12, isInterest: true });
    });
  } catch (e) {}
  const taxAnnual = typeof calcTaxForYear === "function" ? calcTaxForYear(year) : 0;
  const taxDisp = typeof toDisplayMoney === "function" ? toDisplayMoney(taxAnnual, year) : taxAnnual;
  const intDisp = typeof toDisplayMoney === "function" ? toDisplayMoney(interest, year) : interest;
  const grossDisp = (typeof toDisplayMoney === "function" ? toDisplayMoney(earnedAnnual + interest, year) : earnedAnnual + interest);
  const netDisp = grossDisp - taxDisp;
  if (!rows.length && !interest) {
    return `<div class="chart-placeholder"><div class="placeholder-text">No income sources yet</div></div>`;
  }
  return `
    <div class="breakdown-list">
      <div class="field-hint" style="margin-bottom:6px;">Year ${year} · figures £/month</div>
      ${rows.map(r => `
        <div class="breakdown-row">
          <span>${escapeHtml(r.name)}${r.isInterest ? ' <em class="field-hint">(interest)</em>' : ""}</span>
          <strong>${formatMoney(r.monthly)}</strong>
        </div>`).join("")}
      ${taxAnnual > 0 ? `<div class="breakdown-row"><span>Tax &amp; NI</span> <strong style="color:#DC2626;">−${formatMoney(taxDisp / 12)}</strong></div>` : ""}
      <div class="breakdown-row total"><span>Net (after tax)</span> <strong>${formatMoney(netDisp / 12)}</strong></div>
      <div class="breakdown-row"><span class="field-hint">Gross + interest</span> <span class="field-hint">${formatMoney(grossDisp / 12)}</span></div>
    </div>`;
}

function renderWidgetContent(widgetId) {
  if (widgetId === "networth") return renderMiniNetWorthChart();
  if (widgetId === "stacked_nw") return renderStackedNwWidget();
  if (widgetId === "cashflow") return renderCashflowWidget();
  if (widgetId === "rolling") return renderRollingWidget();
  if (widgetId === "spend_cats") return renderSpendCatsWidget();
  if (widgetId === "spend_stack") return renderSpendStackWidget();
  if (widgetId === "breakdown") return renderBreakdownWidget();
  if (widgetId === "income") return renderIncomeWidget();
  return `<div class="chart-placeholder"><div class="placeholder-text">Empty widget – choose a view</div></div>`;
}

function renderSpendStackWidget() {
  const mode = currentPlan.settings?.spendStackMode || "area";
  return `<div class="mini-chart-wrap" id="dashSpendStackWrap" data-mode="${mode}">
    <div class="chart-mode-row">
      <span class="field-hint">All spend · £/mo</span>
      <label class="mode-switch compact">
        <span class="mode-side ${mode === "line" ? "active" : ""}">Line</span>
        <input type="checkbox" id="dashSpendStackMode" ${mode === "area" ? "checked" : ""} onchange="setSpendStackMode(this.checked ? 'area' : 'line', 'dash')">
        <span class="mode-track"><span class="mode-knob"></span></span>
        <span class="mode-side ${mode === "area" ? "active" : ""}">Area</span>
      </label>
    </div>
    <div id="dashSpendStackInner"></div>
  </div>`;
}

function metricCard(opts) {
  const year = getDashYear(opts.key);
  const pie = miniPie(opts.pieSegments || [], 56);
  const heroClass = opts.hero ? " is-hero" : "";
  let stackHtml = "";
  if (opts.open != null && opts.close != null && !opts.hideOc) {
    const d = opts.close - opts.open;
    const up = d > 0;
    const flat = Math.abs(d) < 0.5;
    const arrow = flat ? "→" : (up ? "▲" : "▼");
    const cls = flat ? "delta-flat" : (up ? "delta-up" : "delta-down");
    stackHtml = `
      <div class="card-oc-stack${opts.emphasizeOc ? " oc-emphasis" : ""}">
        <div class="oc-open" title="Opening balance">${formatMoney(opts.open)}</div>
        <div class="oc-delta ${cls}" title="Change">${arrow} ${formatMoney(Math.abs(d))}</div>
        <div class="oc-close" title="Closing balance">${formatMoney(opts.close)}</div>
      </div>`;
  } else {
    stackHtml = `<div class="card-value hero" ${opts.titleExtra ? `title="${escapeHtml(opts.titleExtra)}"` : ""}>${opts.value}</div>`;
  }
  const statusHtml = opts.statusLabel
    ? `<div class="metric-status status-${opts.statusTone || "on"}">${escapeHtml(opts.statusLabel)}</div>`
    : "";
  const spark = opts.sparkHtml || "";
  return `
    <div class="summary-card tone-${opts.tone || "neutral"}${heroClass}" ondblclick="resetDashYear('${opts.key}')" title="${opts.titleExtra ? escapeHtml(opts.titleExtra) + ' · ' : ''}Scroll wheel changes year · Double-click resets to current year">
      <div class="card-top card-top-row">
        <div class="card-top-left">
          <div class="card-label">${opts.label}</div>
          ${statusHtml}
        </div>
        <div class="year-wheel-col">
          <div class="year-wheel-side year-with-title" data-key="${opts.key}" onwheel="handleYearWheel(event, '${opts.key}')">
            <button type="button" class="year-btn" onclick="event.stopPropagation();shiftDashYear('${opts.key}',-1)" title="Earlier year">▲</button>
            <span class="year-label-metric">${year}</span>
            <button type="button" class="year-btn" onclick="event.stopPropagation();shiftDashYear('${opts.key}',1)" title="Later year">▼</button>
          </div>
          ${agesLabelForYear(year) ? `<span class="year-age-hint" title="Age turning in ${year}${agesNamesHint() ? " · " + agesNamesHint() : ""}">Age ${agesLabelForYear(year)}</span>` : ""}
        </div>
      </div>
      <div class="card-main">
        <div class="card-main-left">
          ${stackHtml}
          ${opts.extraLine || ""}
          <div class="card-meta">${opts.meta}</div>
          ${spark}
        </div>
        <div class="card-side card-side-pie-only">
          <div class="card-pie">${pie}</div>
        </div>
      </div>
    </div>`;
}

function miniBarChart(values, color) {
  if (!values || !values.length) return "";
  const w = 132, h = 36, pad = 2, gap = 1;
  const max = Math.max(...values.map(v => Math.abs(v)), 1);
  const n = values.length;
  const barW = Math.max(2, (w - pad * 2 - gap * (n - 1)) / n);
  const reduced = prefersReducedMotion();
  let bars = "";
  values.forEach((v, i) => {
    const bh = Math.max(1, (Math.abs(v) / max) * (h - pad * 2));
    const x = pad + i * (barW + gap);
    const y = h - pad - bh;
    const tip = "£" + Math.round(v).toLocaleString() + "/mo";
    const delay = reduced ? 0 : (i * 18);
    bars += `<rect class="mini-bar${reduced ? "" : " mini-bar-grow"}" x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${color || "#059669"}" opacity="0.85" rx="1" style="transform-origin:${x + barW/2}px ${h - pad}px;animation-delay:${delay}ms">
      <title>${tip}</title>
    </rect>`;
  });
  return `<svg class="metric-spark" viewBox="0 0 ${w} ${h}" width="100%" height="36" preserveAspectRatio="none">${bars}</svg>`;
}

function handleYearWheel(e, key) {
  e.preventDefault();
  e.stopPropagation();
  const delta = e.deltaY > 0 ? 1 : -1;
  // Use shiftDashYear so linkDates applies (same as arrow buttons)
  shiftDashYear(key, delta);
  const tip = document.getElementById("graphTooltip") || createGraphTooltip();
  const years = getPlanYears();
  const y = years[dashMetricYear[key]] ?? getDashYear(key);
  tip.textContent = `${key === "nw" ? "Net worth" : key === "spend" ? "Spend" : key === "income" ? "Income" : "Cash"} · ${y}`;
  tip.style.display = "block";
  tip.style.left = (e.clientX + 12) + "px";
  tip.style.top = (e.clientY - 28) + "px";
  clearTimeout(window._yearTipTimer);
  window._yearTipTimer = setTimeout(() => { tip.style.display = "none"; }, 900);
}
window.handleYearWheel = handleYearWheel;


function renderOneOffDashStrip() {
  ensureSpend();
  const year = getDashYear("spend");
  const list = (currentPlan.spend.oneOffs || []).filter(o => Number(o.year) === Number(year));
  const bal = typeof getPlanBalanceStatus === "function" ? getPlanBalanceStatus() : null;
  const warn = bal && bal.code && bal.code !== "ok";
  const warnHtml = warn
    ? `<div class="plan-warn-strip" title="${escapeHtml(bal.message)}"><strong>Plan warning</strong> ${escapeHtml(bal.message)}</div>`
    : "";
  let oneHtml;
  if (!list.length) {
    oneHtml = `<div class="oneoff-dash-strip muted">No one-off spends in ${year}</div>`;
  } else {
    const total = list.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const items = list.map(o => `${escapeHtml(o.name || "One-off")} ${formatMoney(o.amount)}${o.month ? " · m" + o.month : ""}`).join(" · ");
    oneHtml = `<div class="oneoff-dash-strip"><strong>One-offs ${year}</strong> ${formatMoney(total)} <span class="field-hint">${items}</span> <em>(not in monthly spend)</em></div>`;
  }
  return warnHtml + oneHtml;
}

// ---------- Sounds (Web Audio — no external files) ----------
function soundEnabled() {
  return currentPlan.settings?.soundEnabled !== false;
}

function playTone({ freq = 880, duration = 0.12, type = "sine", gain = 0.08, slideTo }) {
  if (!soundEnabled()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!window._lifeplanAudioCtx) window._lifeplanAudioCtx = new Ctx();
    const ctx = window._lifeplanAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch (e) {}
}

function playSolveSuccess() {
  // Soft bell: two quick highs
  playTone({ freq: 880, duration: 0.1, type: "sine", gain: 0.07 });
  setTimeout(() => playTone({ freq: 1320, duration: 0.18, type: "sine", gain: 0.06 }), 90);
}

function playSolveFail() {
  // Descending “eh-uhh”
  playTone({ freq: 220, duration: 0.22, type: "triangle", gain: 0.09, slideTo: 140 });
  setTimeout(() => playTone({ freq: 160, duration: 0.28, type: "triangle", gain: 0.08, slideTo: 100 }), 200);
}

function showPlanWarningPopup(bal) {
  if (!bal || bal.code === "ok" || !bal.message) return;
  document.getElementById("planWarnPop")?.remove();
  const pop = document.createElement("div");
  pop.id = "planWarnPop";
  pop.className = "plan-warn-pop";
  const title = bal.code === "underfunded" ? "Not enough money"
    : bal.code === "shape" ? "Plan shape warning"
    : bal.code === "under" ? "Plan not fully balanced"
    : "Plan warning";
  pop.innerHTML = `
    <div class="plan-warn-pop-title">${title}</div>
    <p>${escapeHtml(bal.message)}</p>
    <div class="node-edit-actions">
      <button type="button" class="btn-primary btn-sm" id="planWarnOk">OK</button>
    </div>`;
  document.body.appendChild(pop);
  pop.querySelector("#planWarnOk").onclick = () => pop.remove();
  setTimeout(() => { if (pop.parentNode) pop.remove(); }, 12000);
}
window.showPlanWarningPopup = showPlanWarningPopup;

function renderDashboard() {
  ensureSpend();
  const years = getPlanYears();
  const { series, totals, interestByYear, interestDetailByYear } = calcProjectedNetWorth();
  const widgets = (currentPlan.dashboard && currentPlan.dashboard.widgets) || ["spend_stack", "stacked_nw"];
  const typeTotals = {};
  ACCOUNT_TYPES.forEach(t => typeTotals[t.value] = 0);
  currentPlan.accounts.forEach(a => {
    const bal = Number(a.startBalance) || 0;
    if (typeTotals[a.type] !== undefined) typeTotals[a.type] += bal;
  });

  ensureTypeColors();
  // Metric values for selected years — opening / closing where meaningful
  const nwYear = getDashYear("nw");
  const nwIdx = Math.max(0, years.indexOf(nwYear));
  const nwCloseNom = nwIdx >= 0 && totals[nwIdx] != null ? totals[nwIdx] : calcNetWorth();
  const nwOpenNom = nwIdx > 0 && totals[nwIdx - 1] != null ? totals[nwIdx - 1] : calcNetWorth();
  const nwClose = toDisplayMoney(nwCloseNom, nwYear);
  const nwOpen = toDisplayMoney(nwOpenNom, nwIdx > 0 ? years[nwIdx - 1] : nwYear);
  const nwPie = Object.keys(series).filter(id => !id.startsWith("__")).map(id => ({
    name: series[id].name,
    value: Math.max(0, toDisplayMoney(series[id].values[nwIdx] || 0, nwYear)),
    color: series[id].color
  }));

  const spendYear = getDashYear("spend");
  // Spend display respects inflation toggle (engine is always nominal)
  const spendAnnualNom = getSpendForYear(spendYear);
  const spendAnnual = toDisplayMoney(spendAnnualNom, spendYear);
  const spendMonthly = spendAnnual / 12;
  const spendPrevYear = years[Math.max(0, years.indexOf(spendYear) - 1)] || spendYear;
  const spendPrevAnnual = toDisplayMoney(getSpendForYear(spendPrevYear), spendPrevYear);
  const spendPie = [
    ...(currentPlan.spend?.pots || []).map(p => ({
      name: p.name,
      value: toDisplayMoney(getPotAmountForYear(p, spendYear), spendYear),
      color: p.isEssential ? (currentPlan.typeColors.spend.essential) : (p.color || "#94A3B8")
    })),
    { name: "Non Essential Spend", value: getNonEssentialDisplayForYear(spendYear), color: currentPlan.typeColors.spend.nonessential || getThemeColor("spend") }
  ];
  const nesMonthly = toMonthly(getNonEssentialDisplayForYear(spendYear));

  const incYear = getDashYear("income");
  const earnedInc = calcIncomeForYear(incYear);
  const intInc = (interestByYear && interestByYear[incYear]) || 0;
  const taxInc = typeof calcTaxForYear === "function" ? calcTaxForYear(incYear) : 0;
  const incGrossNom = earnedInc + intInc;
  const incNetNom = incGrossNom - taxInc;
  const incGrossAnnual = toDisplayMoney(incGrossNom, incYear);
  const incAnnual = toDisplayMoney(incNetNom, incYear); // net (with interest) — primary
  const incMonthly = incAnnual / 12;
  const incGrossMonthly = incGrossAnnual / 12;
  const incPrevYear = years[Math.max(0, years.indexOf(incYear) - 1)] || incYear;
  const incPrevAnnual = toDisplayMoney(
    calcIncomeForYear(incPrevYear) + ((interestByYear && interestByYear[incPrevYear]) || 0),
    incPrevYear
  );
  const incPie = (currentPlan.income || []).map((inc) => {
    const start = inc.startDate ? new Date(inc.startDate).getFullYear() : years[0];
    const end = inc.endDate ? new Date(inc.endDate).getFullYear() : 9999;
    const active = incYear >= start && incYear <= end;
    const growth = resolveGrowthPct(inc) / 100;
    const growthBase = Math.max(start, years[0] || start);
    const monthlyNom = active ? (Number(inc.amountMonthly) || 0) * Math.pow(1 + growth, Math.max(0, incYear - growthBase)) : 0;
    return {
      name: inc.name || "Income",
      value: toDisplayMoney(monthlyNom * 12, incYear),
      color: inc.color || getIncomeTypeColor(inc.type)
    };
  });
  ((interestDetailByYear && interestDetailByYear[incYear]) || []).forEach(d => {
    if (Math.abs(d.amount) > 0.5) {
      incPie.push({
        name: d.name,
        value: toDisplayMoney(d.amount, incYear),
        color: getAccountTypeColor(d.type) || "#94A3B8"
      });
    }
  });
  const incomeHoverLines = incPie
    .filter(p => Math.abs(p.value) > 0.5)
    .map(p => `${p.name}: ${formatMoney(p.value / 12)}/mo`)
    .join(" · ");

  // Cash reserve: accessible cash types only (crash buffer)
  const cashTypes = ["current_savings", "cash_isa", "premium_bonds"];
  // Year-aware cash from projected series where account type matches
  let cashOpen = 0, cashClose = 0;
  const cashPieMap = { current_savings: 0, cash_isa: 0, premium_bonds: 0 };
  currentPlan.accounts.forEach(acc => {
    if (!cashTypes.includes(acc.type)) return;
    const s = series[acc.id];
    const openV = s && nwIdx > 0 ? (s.values[nwIdx - 1] || 0) : (Number(acc.startBalance) || 0);
    const closeV = s ? (s.values[nwIdx] || 0) : (Number(acc.startBalance) || 0);
    const openY = nwIdx > 0 ? years[nwIdx - 1] : nwYear;
    cashOpen += toDisplayMoney(openV, openY);
    cashClose += toDisplayMoney(closeV, nwYear);
    cashPieMap[acc.type] = (cashPieMap[acc.type] || 0) + toDisplayMoney(closeV, nwYear);
  });
  // If no series match, fall back to start balances
  if (cashClose === 0 && cashOpen === 0) {
    cashTypes.forEach(t => { cashPieMap[t] = typeTotals[t] || 0; });
    cashClose = cashTypes.reduce((s, t) => s + (typeTotals[t] || 0), 0);
    cashOpen = cashClose;
  }
  const cashYear = getDashYear("cash");
  const cashIdx = Math.max(0, years.indexOf(cashYear));
  // Recompute cash for cash card's selected year
  cashOpen = 0; cashClose = 0;
  cashPieMap.current_savings = 0; cashPieMap.cash_isa = 0; cashPieMap.premium_bonds = 0;
  currentPlan.accounts.forEach(acc => {
    if (!cashTypes.includes(acc.type)) return;
    const s = series[acc.id];
    const o = s && cashIdx > 0 ? (s.values[cashIdx - 1] ?? (Number(acc.startBalance) || 0)) : (Number(acc.startBalance) || 0);
    const c = s ? (s.values[cashIdx] ?? (Number(acc.startBalance) || 0)) : (Number(acc.startBalance) || 0);
    cashOpen += o;
    cashClose += c;
    cashPieMap[acc.type] = (cashPieMap[acc.type] || 0) + c;
  });
  const cashPie = [
    { name: "Current / Savings", value: cashPieMap.current_savings || 0, color: getAccountTypeColor("current_savings") },
    { name: "Cash ISA", value: cashPieMap.cash_isa || 0, color: getAccountTypeColor("cash_isa") },
    { name: "Premium Bonds", value: cashPieMap.premium_bonds || 0, color: getAccountTypeColor("premium_bonds") }
  ];

  const showInf = currentPlan.spend?.showInflation;

  const widgetsTop = (widgets || []).slice(0, 2);
  while (widgetsTop.length < 2) widgetsTop.push("networth");
  const widgetCards = widgetsTop.map((wid, idx) => {
    const opts = WIDGET_OPTIONS.map(o =>
      `<option value="${o.id}" ${o.id === wid ? "selected" : ""}>${o.label}</option>`
    ).join("");
    return `
      <div class="chart-card widget-slot" data-slot="${idx}" ondblclick="expandWidget(${idx})">
        <div class="chart-header">
          <select class="widget-select" onchange="changeWidget(${idx}, this.value)">
            ${opts}
          </select>
          <span class="expand-hint">Double-click to expand</span>
        </div>
        <div class="chart-area-live">
          ${renderWidgetContent(wid)}
        </div>
      </div>`;
  }).join("");

  const bal = getPlanBalanceStatus();
  const statusLabel = bal.code === "ok" ? "On target"
    : bal.code === "underfunded" ? "Underfunded"
    : bal.code === "shape" ? "Shape warning"
    : bal.status === "over" ? "Over budget" : "Under budget";
  const statusTone = bal.code === "ok" ? "on" : (bal.code === "underfunded" || bal.status === "over") ? "over" : "under";
  // Next 12 months income sparkline from selected year
  const incSparkVals = [];
  for (let m = 0; m < 12; m++) {
    const y = incYear; // yearly model: flat within year for now
    incSparkVals.push((calcIncomeForYear(y) + ((interestByYear && interestByYear[y]) || 0)) / 12);
  }
  // slight variation using following years if available
  const yi0 = Math.max(0, years.indexOf(incYear));
  for (let m = 0; m < 12; m++) {
    const y = years[Math.min(years.length - 1, yi0 + Math.floor(m / 12))] || incYear;
    const yy = years[Math.min(years.length - 1, yi0)] || incYear;
    // use current + next year blend for shape
  }
  const sparkYears = [];
  for (let i = 0; i < 12; i++) {
    const y = years[Math.min(years.length - 1, yi0 + (i === 0 ? 0 : 0))] || incYear;
    sparkYears.push((calcIncomeForYear(years[Math.min(years.length - 1, yi0)] || incYear) + ((interestByYear && interestByYear[years[Math.min(years.length - 1, yi0)]]) || 0)) / 12);
  }
  // Use next 12 calendar months as 12 equal steps of this year + next if multi-year
  const sparkVals = [];
  for (let i = 0; i < 12; i++) {
    const yIdx = Math.min(years.length - 1, yi0 + (i >= 6 ? 1 : 0));
    const y = years[yIdx] || incYear;
    sparkVals.push((calcIncomeForYear(y) + ((interestByYear && interestByYear[y]) || 0)) / 12);
  }

  return `
    <div class="page dashboard-page">
      <header class="page-header page-header-compact">
        <div>
          <h1>Good morning${currentPlan.people[0]?.name ? ", " + escapeHtml(currentPlan.people[0].name) : ""} <span class="emoji">☀</span></h1>
          <p class="subtitle">Here's your financial overview</p>
        </div>
        <div class="header-actions header-actions-row">
          <label class="mode-switch compact inflation-switch" title="Toggle display between today's money and nominal (with inflation)">
            <span class="mode-side ${!showInf ? "active" : ""}">Today's £</span>
            <input type="checkbox" ${showInf ? "checked" : ""} onchange="toggleDashInflation()">
            <span class="mode-track"><span class="mode-knob"></span></span>
            <span class="mode-side ${showInf ? "active" : ""}">With inflation</span>
          </label>
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="summary-cards four-metrics">
        ${metricCard({
          key: "spend",
          label: "Monthly Spend",
          value: formatMoney(spendMonthly),
          meta: `${formatMoney(spendAnnual)} / year · Non Essential Spend ${formatMoney(nesMonthly)}/mo`,
          pieSegments: spendPie,
          tone: "violet",
          hero: true,
          statusLabel,
          statusTone,
          extraLine: `<div class="card-nes-line">Non Essential Spend <strong>${formatMoney(nesMonthly)}</strong><span class="field-hint"> / mo</span></div>`
        })}
        ${metricCard({
          key: "nw",
          label: "Net Worth",
          value: formatMoney(nwClose),
          open: nwOpen,
          close: nwClose,
          emphasizeOc: true,
          meta: `${currentPlan.accounts.length} account${currentPlan.accounts.length === 1 ? "" : "s"} · ${nwYear}`,
          pieSegments: nwPie,
          tone: "purple"
        })}
        ${metricCard({
          key: "cash",
          label: "Cash Reserve",
          value: formatMoney(cashClose),
          open: cashOpen,
          close: cashClose,
          emphasizeOc: true,
          meta: `Cash-like pots · ${cashYear}`,
          pieSegments: cashPie,
          tone: "sky"
        })}
        ${metricCard({
          key: "income",
          label: "Income (monthly)",
          value: formatMoney(incMonthly),
          hideOc: true,
          meta: `Net (incl. interest) · ${formatMoney(incAnnual)}/yr · tax ~${formatMoney(toDisplayMoney(taxInc, incYear) / 12)}/mo`,
          pieSegments: incPie,
          tone: "emerald",
          titleExtra: incomeHoverLines || "No income this year",
          extraLine: `<div class="card-nes-line field-hint">Gross <strong>${formatMoney(incGrossMonthly)}</strong><span class="field-hint"> / mo</span></div>`,
          sparkHtml: `<div class="spark-box"><div class="spark-box-title">Next 12 months</div>${miniBarChart(sparkVals, "#059669")}</div>`
        })}
      </div>

      <div id="planStatusStrip">${renderOneOffDashStrip()}</div>

      <div class="charts-row two">
        ${widgetCards}
      </div>

      <div class="dash-noness-panel" id="dashNonessPanel">
        <div class="noness-head">
          <div>
            <strong>Non Essential Spend</strong>
            <span class="field-hint" style="margin-left:8px;">View only · double-click to edit</span>
          </div>
          <button class="btn-primary btn-sm" type="button" id="dashSolveBalance">Solve balance</button>
        </div>
        <div class="noness-body" id="dashNonessBody" title="Double-click to open Non Essential Spend editor">
          <div class="spend-chart-wrap compact" id="dashTargetChartWrap"></div>
          <div id="dashGaugeWrap" class="noness-gauge">${renderBalanceGauge()}</div>
        </div>
      </div>
    </div>
  `;
}




function refreshDashboardBalanceStatus() {
  try {
    const bal = getPlanBalanceStatus();
    const card = document.querySelector(".summary-card.tone-violet .metric-status, .summary-card.is-hero .metric-status");
    if (card) {
      const label = bal.code === "ok" ? "On target"
        : bal.code === "underfunded" ? "Underfunded"
        : bal.code === "shape" ? "Shape warning"
        : bal.status === "over" ? "Over budget" : "Under budget";
      card.textContent = label;
      card.className = "metric-status status-" + (bal.code === "ok" ? "on" : (bal.code === "underfunded" || bal.status === "over") ? "over" : "under");
    }
  } catch (e) {}
  const spendHero = document.querySelector(".summary-card.is-hero .card-value.hero, .summary-card.tone-violet .card-value.hero");
  if (spendHero && typeof getSpendForYear === "function") {
    const y = getDashYear("spend");
    spendHero.textContent = formatMoney(toDisplayMoney(getSpendForYear(y), y) / 12);
  }
  const g = document.getElementById("dashGaugeWrap");
  if (g && typeof renderBalanceGauge === "function") {
    g.innerHTML = renderBalanceGauge();
    if (typeof animateGaugeNeedles === "function") animateGaugeNeedles(g);
  }
  const strip = document.getElementById("planStatusStrip");
  if (strip && typeof renderOneOffDashStrip === "function") {
    strip.innerHTML = renderOneOffDashStrip();
  }
}
window.refreshDashboardBalanceStatus = refreshDashboardBalanceStatus;

function openNonEssentialBubble() {
  document.getElementById("nonessBubble")?.remove();
  const backdrop = document.createElement("div");
  backdrop.id = "nonessBubble";
  backdrop.className = "noness-bubble-backdrop";
  backdrop.innerHTML = `
    <div class="noness-bubble" role="dialog" aria-label="Non Essential Spend">
      <div class="noness-bubble-head">
        <strong>Non Essential Spend</strong>
        <button type="button" class="btn-icon" id="nonessBubbleClose" title="Close">✕</button>
      </div>
      <div class="noness-bubble-body">
        <div class="spend-balance-row spend-balance-row-v">
          <div class="spend-chart-col">
            <p class="chart-hint" style="margin:0 0 8px;">
              £ / month · Drag · double-click · wheel (Alt = bandwidth)
            </p>
            <div class="spend-chart-wrap" id="bubbleTargetChartWrap"></div>
            <div class="node-tools-bar">
              <div class="wheel-mode-row">
                <span class="wheel-mode-label">Wheel adjusts</span>
                <label class="mode-switch">
                  <span class="mode-side active">Value £</span>
                  <input type="checkbox" id="bubbleWheelMode">
                  <span class="mode-track"><span class="mode-knob"></span></span>
                  <span class="mode-side">Bandwidth %</span>
                </label>
                <input type="number" id="bubbleWheelInc" class="wheel-inc-input" min="1" step="1" value="1">
                <span class="field-hint wheel-inc-hint">step</span>
              </div>
              <label class="subtle-toggle">
                <input type="checkbox" id="bubbleMultiSelect" ${currentPlan.settings?.multiNodeSelect ? "checked" : ""}>
                Multi-select nodes
              </label>
            </div>
          </div>
          <div class="spend-gauge-col">
            <div id="bubbleGaugeWrap"></div>
            <div class="spend-toolbar-vertical">
              <div class="form-group" style="margin:0;">
                <label>Fund until</label>
                <input type="number" id="bubbleFundUntil" value="${currentPlan.spend.fundUntil || getPlanYears().slice(-1)[0]}">
              </div>
              <div class="form-group" style="margin:0;">
                <label>Bandwidth %</label>
                <input type="number" id="bubbleBandPct" value="${Math.round((typeof getBandPct === "function" ? getBandPct() : 0.1) * 100)}" min="0" max="50" step="1">
              </div>
              <button class="btn-secondary" type="button" id="bubbleReset"
                title="FIRST SETUP — flat targets then solve. Use once when plan is first filled in.">Reset targets</button>
              <button class="btn-secondary" type="button" id="bubbleRebase"
                title="KEEP SHAPE — shift level after pots change a lot.">Rebase targets</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
    else if (typeof refreshDashboardView === "function") refreshDashboardView();
  };
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.getElementById("nonessBubbleClose")?.addEventListener("click", close);

  const paint = () => {
    document.getElementById("bubbleGaugeWrap").innerHTML = renderBalanceGauge();
    animateGaugeNeedles(document.getElementById("bubbleGaugeWrap"));
    drawTargetChart("bubbleTargetChartWrap");
  };
  paint();

  document.getElementById("bubbleFundUntil")?.addEventListener("change", e => {
    currentPlan.spend.fundUntil = parseInt(e.target.value, 10);
    autoSave(); paint();
  });
  document.getElementById("bubbleBandPct")?.addEventListener("change", e => {
    currentPlan.spend.bandPct = (parseFloat(e.target.value) || 0) / 100;
    autoSave(); paint();
  });
  document.getElementById("bubbleReset")?.addEventListener("click", async () => {
    if (!(await appConfirmYesNo("Reset targets?"))) return;
    resetTargets(); paint();
    if (typeof refreshDashboardBalanceStatus === "function") refreshDashboardBalanceStatus();
  });
  document.getElementById("bubbleRebase")?.addEventListener("click", async () => {
    if (!(await appConfirmYesNo("Rebase targets?"))) return;
    rebaseTargets(); paint();
    if (typeof refreshDashboardBalanceStatus === "function") refreshDashboardBalanceStatus();
  });
  document.getElementById("bubbleWheelMode")?.addEventListener("change", e => {
    window._wheelMode = e.target.checked ? "band" : "value";
    syncWheelIncInput(document.getElementById("bubbleWheelInc"));
  });
  document.getElementById("bubbleWheelInc")?.addEventListener("change", e => {
    ensureWheelSettings();
    if (window._wheelMode === "band") {
      let v = parseFloat(e.target.value);
      if (!isFinite(v) || v < 0.5) v = 0.5;
      v = Math.round(v * 2) / 2;
      e.target.value = String(v);
      currentPlan.settings.wheelBandIncrement = v;
    } else {
      let v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) v = 1;
      e.target.value = String(v);
      currentPlan.settings.wheelIncrement = v;
    }
    autoSave();
  });
  syncWheelIncInput(document.getElementById("bubbleWheelInc"));
  document.getElementById("bubbleMultiSelect")?.addEventListener("change", e => {
    if (!currentPlan.settings) currentPlan.settings = {};
    currentPlan.settings.multiNodeSelect = e.target.checked;
    if (!e.target.checked) window._selectedYears = new Set();
    autoSave();
    paint();
  });
}
window.openNonEssentialBubble = openNonEssentialBubble;

function attachDashboardSpendPanel() {
  ensureSpend();
  const run = () => {
    const el = document.getElementById("dashTargetChartWrap");
    if (el) drawTargetChart("dashTargetChartWrap");
    const g = document.getElementById("dashGaugeWrap");
    if (g) {
      g.innerHTML = renderBalanceGauge();
      animateGaugeNeedles(g);
    }
    if (document.getElementById("dashSpendStackInner")) {
      drawSpendStackChart("dashSpendStackInner", { compact: true });
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 50);
  setTimeout(run, 200);

  const solveBtn = document.getElementById("dashSolveBalance");
  if (solveBtn && !solveBtn.dataset.bound) {
    solveBtn.dataset.bound = "1";
    solveBtn.addEventListener("click", async () => {
      if (!(await appConfirmYesNo("Solve balance?\n\nKeeps your target shape and adjusts the model ratio so net worth reaches your minimum savings at Fund until without going negative earlier."))) return;
      solvePlanBalance();
      run();
      if (typeof refreshDashboardBalanceStatus === "function") refreshDashboardBalanceStatus();
      // Full refresh keeps monthly spend + status correct
      if (typeof refreshDashboardView === "function") {
        try { refreshDashboardView(); } catch (e) {}
      }
      updateSaveStatus();
    });
  }
  const body = document.getElementById("dashNonessBody");
  if (body && !body.dataset.bound) {
    body.dataset.bound = "1";
    body.addEventListener("dblclick", e => {
      e.preventDefault();
      openNonEssentialBubble();
    });
  }
}

function changeWidget(slot, widgetId) {
  if (!currentPlan.dashboard) currentPlan.dashboard = { widgets: ["spend_stack", "stacked_nw"] };
  currentPlan.dashboard.widgets[slot] = widgetId;
  autoSave();
  page.innerHTML = renderDashboard();
  attachNwHover();
  attachPieHovers();
  if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
}

// Expanded widget view
let expandedComponents = {}; // id -> visible

function expandWidget(slot) {
  const widgets = currentPlan.dashboard?.widgets || [];
  const wid = widgets[slot];
  const overlay = document.getElementById("expandOverlay");
  if (!overlay) return;

  let title = (WIDGET_OPTIONS.find(o => o.id === wid) || {}).label || "Widget";
  let body = "";

  if (wid === "networth") {
    const { series } = calcProjectedNetWorth();
    ensureVisibility(series);

    const legend = [
      `<span class="legend-item ${chartVisibility.__total ? "" : "off"}" onclick="toggleChartItem('__total')">
        <span class="legend-swatch" style="background:#7C3AED"></span>Total
      </span>`
    ];
    Object.keys(series).forEach(id => {
      legend.push(`
        <span class="legend-item ${chartVisibility[id] ? "" : "off"}" onclick="toggleChartItem('${id}')">
          <span class="legend-swatch" style="background:${series[id].color}"></span>${escapeHtml(series[id].name)}
        </span>`);
    });

    body = `
      <div class="expand-controls chart-legend">${legend.join("")}</div>
      <div class="expand-chart" id="expandChartArea"></div>
    `;
    overlay.innerHTML = `
      <div class="expand-panel">
        <div class="expand-header">
          <h2>${title}</h2>
          <button class="btn-icon" onclick="closeExpand()">✕</button>
        </div>
        <div class="expand-body">${body}</div>
      </div>`;
    overlay.classList.add("open");
    setTimeout(refreshExpandNetWorth, 20);
    return;
  }

  // Generic expand for other widgets
  body = renderWidgetContent(wid);
  overlay.innerHTML = `
    <div class="expand-panel">
      <div class="expand-header">
        <h2>${title}</h2>
        <button class="btn-icon" onclick="closeExpand()">✕</button>
      </div>
      <div class="expand-body">${body}</div>
    </div>`;
  overlay.classList.add("open");
}

function toggleComponent(id, on) {
  expandedComponents[id] = on;
}

function refreshExpandNetWorth() {
  const area = document.getElementById("expandChartArea");
  if (!area) return;
  const { years, series, totals } = calcProjectedNetWorth();
  ensureVisibility(series);

  // Also refresh legend active states
  const legendEl = document.querySelector(".expand-controls.chart-legend");
  if (legendEl) {
    const { series: s2 } = calcProjectedNetWorth();
    ensureVisibility(s2);
    let legend = [
      `<span class="legend-item ${chartVisibility.__total ? "" : "off"}" onclick="toggleChartItem('__total')">
        <span class="legend-swatch" style="background:#7C3AED"></span>Total
      </span>`
    ];
    Object.keys(s2).forEach(id => {
      legend.push(`
        <span class="legend-item ${chartVisibility[id] ? "" : "off"}" onclick="toggleChartItem('${id}')">
          <span class="legend-swatch" style="background:${s2[id].color}"></span>${escapeHtml(s2[id].name)}
        </span>`);
    });
    legendEl.innerHTML = legend.join("");
  }

  const lines = [];
  if (chartVisibility.__total) lines.push({ name: "Total", color: "#7C3AED", values: totals, isTotal: true, overridden: null });
  Object.keys(series).forEach(id => {
    if (chartVisibility[id]) lines.push({ ...series[id], isTotal: false });
  });

  if (!lines.length || years.length < 2) {
    area.innerHTML = `<div class="chart-placeholder"><div class="placeholder-text">No series selected</div></div>`;
    return;
  }

  const allVals = lines.flatMap(l => l.values);
  const maxV = Math.max(...allVals, 1);
  const minV = Math.min(...allVals, 0);
  const range = maxV - minV || 1;
  const w = 960, h = 420, left = 64, bottom = 48, top = 12;
  const innerH = h - bottom - top;
  const step = (w - left - 10) / (years.length - 1);

  let grid = "", paths = "", markers = "";
  for (let i = 0; i <= 5; i++) {
    const val = maxV - (range / 5) * i;
    const y = top + (innerH / 5) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="scale-label">${label}</text>`;
  }

  lines.forEach(l => {
    const pts = l.values.map((v, i) => {
      const x = left + i * step;
      const y = top + innerH - ((v - minV) / range) * innerH;
      return { x, y, i };
    });
    const strokeW = l.isTotal ? 3 : 1.8;
    paths += `<path d="M ${pts.map(p => `${p.x},${p.y}`).join(" L ")}" fill="none" stroke="${l.color}" stroke-width="${strokeW}" opacity="${l.isTotal ? 1 : 0.9}"/>`;
    pts.forEach(p => {
      const isOver = l.overridden && l.overridden[p.i];
      const r = isOver ? 5 : 3;
      const fill = isOver ? "#F97316" : l.color;
      markers += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`;
    });
  });

  let xLabels = "";
  const many = years.length > 12;
  years.forEach((y, i) => {
    const show = !many || i === 0 || i === years.length - 1 || y % 5 === 0;
    if (!show) return;
    const x = left + i * step;
    if (many) {
      xLabels += `<text x="${x}" y="${h - 6}" text-anchor="end" class="scale-label year-label" transform="rotate(-35 ${x} ${h - 6})">${y}</text>`;
    } else {
      xLabels += `<text x="${x}" y="${h - 12}" text-anchor="middle" class="scale-label">${y}</text>`;
    }
  });

  area.innerHTML = `
    <svg width="100%" height="440" viewBox="0 0 ${w} ${h}">
      ${grid}${paths}${markers}${xLabels}
    </svg>`;
}

function closeExpand() {
  const overlay = document.getElementById("expandOverlay");
  if (overlay) overlay.classList.remove("open");
}

// ---------- SETTINGS ----------
function ensureThemeColors() {
  if (!currentPlan.themeColors) {
    currentPlan.themeColors = {
      spend: "#EAB308",      // gold default
      income: "#059669",
      networth: "#7C3AED",
      cash: "#2563EB"
    };
  }
  if (!currentPlan.themeColors.spend) currentPlan.themeColors.spend = "#EAB308";
  return currentPlan.themeColors;
}

function getThemeColor(key) {
  const c = ensureThemeColors();
  return c[key] || "#7C3AED";
}


function isLocalAppCopy() {
  try {
    const h = location.hostname;
    return location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "";
  } catch (e) { return false; }
}
window.isLocalAppCopy = isLocalAppCopy;

async function resetForLaunch() {
  if (!isLocalAppCopy()) {
    await appAlert("Reset for launch is only available on a local copy of the app.");
    return;
  }
  const ok = await appConfirmYesNo(
    "Reset for launch?\n\nSets first-time UI defaults:\n• Inflation display off (today's money)\n• Auto-hide menu off\n• Link dashboard dates on\n• Dashboard charts: All spend (stacked) + Net worth\n\nDoes not clear people, accounts or income.",
    "Reset defaults",
    "Cancel"
  );
  if (!ok) return;
  ensureSpend();
  currentPlan.spend.showInflation = false;
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.autoHideSidebar = false;
  currentPlan.settings.linkDates = true;
  currentPlan.settings.showWizardOnNew = true;
  currentPlan.settings.expertMode = false;
  window._wizardSavedWidgets = null;
  if (!currentPlan.dashboard) currentPlan.dashboard = {};
  // Two large boxes: all spend stacked + net worth
  currentPlan.dashboard.widgets = ["spend_stack", "stacked_nw", "spend_stack", "stacked_nw"];
  // Prefer first two slots if only two charts
  const w = currentPlan.dashboard.widgets;
  if (w.length >= 2) currentPlan.dashboard.widgets = ["spend_stack", "stacked_nw"];
  autoSave();
  if (typeof applyAutoHideSidebar === "function") applyAutoHideSidebar();
  await appAlert("Launch defaults applied. Open Dashboard to see the chart choices.");
  const active = document.querySelector(".navButton.active");
  if (active) active.click();
}
window.resetForLaunch = resetForLaunch;

function renderSettingsPage() {
  ensureWizardMeta();
  if (!currentPlan.settings) currentPlan.settings = {};
  if (currentPlan.settings.wheelIncrement == null) currentPlan.settings.wheelIncrement = 1;
  currentPlan.settings.wheelIncrement = Math.max(1, Math.round(Number(currentPlan.settings.wheelIncrement) || 1));

  const s = currentPlan.scale || { startYear: new Date().getFullYear(), endYear: new Date().getFullYear() + 40 };
  const tc = ensureThemeColors();
  const wheel = currentPlan.settings.wheelIncrement;

  return `
    <div class="page settings-page">
      <header class="page-header">
        <div>
          <h1>Settings</h1>
          <p class="subtitle">Plan scale and preferences</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Plan files</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <p class="settings-desc">Auto-saves in this browser. Use Save / Save As for portable .lifeplan.json files.</p>
          <div class="settings-inline">
            <button class="btn-secondary" onclick="importPlan()">Import Plan…</button>
            <button class="btn-primary" onclick="savePlan()">Save</button>
            <button class="btn-secondary" onclick="savePlanAs()">Save As…</button>
            <button class="btn-secondary" onclick="newPlan()">New Plan</button>
          </div>
        </div>
      </div>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Setup wizard</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <p class="settings-desc">Guided tour with a pause after Income. Resume anytime.</p>
          <div class="settings-inline wrap">
            <label class="inline-check"><input type="checkbox" id="setShowWizard" ${(currentPlan.settings?.showWizardOnNew !== false) ? "checked" : ""} onchange="toggleShowWizard(this.checked)"> Show wizard for new plans</label>
            <label class="inline-check"><input type="checkbox" id="setWizardDone" ${currentPlan.meta?.wizardComplete ? "checked" : ""} onchange="toggleWizardComplete(this.checked)"> Wizard completed</label>
            <button class="btn-secondary" onclick="restartWizardFresh()">Restart wizard</button>
            <button class="btn-primary" onclick="resumeWizard()">Continue wizard</button>
          </div>
        </div>
      </div>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Spend</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <div class="settings-inline wrap">
            <label class="inline-check"><input type="checkbox" id="setExpertMode" ${currentPlan.settings?.expertMode ? "checked" : ""} onchange="toggleExpertMode(this.checked)"> Expert mode</label>
          </div>
          <p class="field-hint">Expert mode allows advanced NES node editing on the dashboard. Wheel step is set on the Spend / NES tools bar.</p>
        </div>
      </div>

      <div class="settings-section open" id="adminResetSection" hidden>
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Admin</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <p class="settings-desc">For app development only — shown on local copies. Resets UI defaults as for a first-time user (does not delete people/accounts data unless you also New Plan).</p>
          <button type="button" class="btn-secondary" onclick="resetForLaunch()">Reset for launch</button>
        </div>
      </div>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Plan scale &amp; display</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <div class="settings-inline">
            <div class="form-group inline-field">
              <label>Start year</label>
              <input type="number" id="scaleStart" value="${s.startYear}" min="2000" max="2100">
            </div>
            <div class="form-group inline-field">
              <label>End year</label>
              <input type="number" id="scaleEnd" value="${s.endYear}" min="2000" max="2150">
            </div>
            <button class="btn-primary" onclick="saveScale()">Save scale</button>
          </div>
          <div class="settings-inline wrap" style="margin-top:14px;flex-direction:column;align-items:flex-start;">
            <label class="inline-check"><input type="checkbox" id="setLinkDates" ${currentPlan.settings?.linkDates ? "checked" : ""} onchange="toggleLinkDates(this.checked)"> Link dates on dashboard metrics</label>
            <p class="settings-desc" style="margin:0 0 10px 1.5rem;">When on, the four top metric years move, scroll and reset together.</p>
            <label class="inline-check"><input type="checkbox" id="setAutoHideSidebar" ${currentPlan.settings?.autoHideSidebar ? "checked" : ""} onchange="toggleAutoHideSidebar(this.checked)"> Auto-hide side menu</label>
            <p class="settings-desc" style="margin:0 0 8px 1.5rem;">Menu hides until the pointer is near the left edge; stays open briefly after you leave.</p>
            <label class="inline-check"><input type="checkbox" id="setSound" ${currentPlan.settings?.soundEnabled !== false ? "checked" : ""} onchange="toggleSoundEnabled(this.checked)"> Sound effects</label>
            <p class="settings-desc" style="margin:0 0 8px 1.5rem;">Bell when Solve balances; soft alert when it can’t fully balance.</p>
          </div>
        </div>
      </div>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>ISA allowances</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <p class="settings-desc">Annual subscription limits. Because the plan is yearly, money taken out of an ISA is treated as out for good — we only track the annual allowance, not a lifetime pot cap. Overall ISA max / max cash rules can be added when regulations settle.</p>
          <div class="settings-inline wrap">
            <div class="form-group inline-field">
              <label>Annual ISA allowance £</label>
              <input type="number" id="setIsaAnnual" value="${Number(currentPlan.settings?.isaAnnualAllowance) || 20000}" min="0" step="100">
            </div>
            <div class="form-group inline-field">
              <label>Max cash ISA (optional) £</label>
              <input type="number" id="setIsaCashMax" value="${currentPlan.settings?.isaCashMax != null ? currentPlan.settings.isaCashMax : ""}" min="0" step="100" placeholder="Optional">
            </div>
            <button class="btn-primary" type="button" onclick="saveIsaSettings()">Save ISA limits</button>
          </div>
        </div>
      </div>

      <div class="settings-section open">
        <button type="button" class="settings-section-head" onclick="this.parentElement.classList.toggle('open')">
          <span>Colours</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="settings-section-body">
          <div class="settings-inline wrap">
            <div class="form-group inline-field">
              <label>Spend</label>
              <input type="color" id="themeSpend" value="${tc.spend}">
            </div>
            <div class="form-group inline-field">
              <label>Income</label>
              <input type="color" id="themeIncome" value="${tc.income}">
            </div>
            <div class="form-group inline-field">
              <label>Net worth</label>
              <input type="color" id="themeNw" value="${tc.networth}">
            </div>
            <div class="form-group inline-field">
              <label>Cash</label>
              <input type="color" id="themeCash" value="${tc.cash}">
            </div>
            <button class="btn-primary" onclick="saveThemeColors()">Save colours</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachSettingsListeners() {
  const wheel = document.getElementById("setWheelInc");
  if (!wheel) return;
  const saveWheel = () => {
    if (!currentPlan.settings) currentPlan.settings = {};
    let v = parseInt(wheel.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    wheel.value = String(v);
    currentPlan.settings.wheelIncrement = v;
    autoSave();
    updateSaveStatus();
  };
  wheel.addEventListener("change", saveWheel);
  wheel.addEventListener("blur", saveWheel);
}

function saveThemeColors() {
  ensureThemeColors();
  currentPlan.themeColors.spend = document.getElementById("themeSpend").value;
  currentPlan.themeColors.income = document.getElementById("themeIncome").value;
  currentPlan.themeColors.networth = document.getElementById("themeNw").value;
  currentPlan.themeColors.cash = document.getElementById("themeCash").value;
  autoSave();
  updateSaveStatus();
  alert("Colours saved. Charts will use the new theme.");
}
window.saveThemeColors = saveThemeColors;

function toggleShowWizard(on) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.showWizardOnNew = !!on;
  autoSave();
}
window.toggleShowWizard = toggleShowWizard;

function toggleWizardComplete(on) {
  ensureWizardMeta();
  currentPlan.meta.wizardComplete = !!on;
  if (on) currentPlan.meta.wizardPaused = false;
  autoSave();
  updateContinueWizardBtn();
}
window.toggleWizardComplete = toggleWizardComplete;

function toggleExpertMode(on) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.expertMode = !!on;
  autoSave();
}
function toggleLinkDates(on) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.linkDates = !!on;
  if (on) {
    const years = getPlanYears();
    let idx = dashMetricYear.spend ?? dashMetricYear.nw ?? 0;
    Object.keys(dashMetricYear).forEach(k => { dashMetricYear[k] = idx; });
  }
  autoSave();
  if (typeof refreshDashboardView === "function") refreshDashboardView();
}
window.toggleLinkDates = toggleLinkDates;

function toggleAutoHideSidebar(on) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.autoHideSidebar = !!on;
  autoSave();
  applySidebarAutoHide();
}

function toggleSoundEnabled(on) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.soundEnabled = !!on;
  autoSave();
}
window.toggleSoundEnabled = toggleSoundEnabled;
window.toggleAutoHideSidebar = toggleAutoHideSidebar;

function applySidebarAutoHide() {
  const app = document.querySelector(".app");
  const side = document.querySelector(".sidebar");
  if (!app || !side) return;
  // clean previous
  if (window._sidebarEdgeHandler) {
    document.removeEventListener("mousemove", window._sidebarEdgeHandler);
    window._sidebarEdgeHandler = null;
  }
  clearTimeout(window._sidebarHideT);
  if (!currentPlan.settings?.autoHideSidebar) {
    app.classList.remove("sidebar-autohide", "sidebar-peek");
    return;
  }
  app.classList.add("sidebar-autohide");
  let overSidebar = false;
  const show = () => {
    app.classList.add("sidebar-peek");
    clearTimeout(window._sidebarHideT);
  };
  const scheduleHide = () => {
    clearTimeout(window._sidebarHideT);
    window._sidebarHideT = setTimeout(() => {
      if (!overSidebar) app.classList.remove("sidebar-peek");
    }, 1400);
  };
  window._sidebarEdgeHandler = (e) => {
    if (e.clientX <= 12) show();
    else if (!overSidebar && e.clientX > 280) scheduleHide();
  };
  document.addEventListener("mousemove", window._sidebarEdgeHandler);
  side.addEventListener("mouseenter", () => { overSidebar = true; show(); });
  side.addEventListener("mouseleave", () => { overSidebar = false; scheduleHide(); });
}
window.toggleExpertMode = toggleExpertMode;

function saveSpendSettings() {
  if (!currentPlan.settings) currentPlan.settings = {};
  let w = parseInt(document.getElementById("setWheelInc")?.value, 10);
  if (isNaN(w) || w < 1) w = 1;
  currentPlan.settings.wheelIncrement = w;
  currentPlan.settings.expertMode = !!document.getElementById("setExpertMode")?.checked;
  autoSave();
  updateSaveStatus();
}
window.saveSpendSettings = saveSpendSettings;

function saveIsaSettings() {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.isaAnnualAllowance = parseFloat(document.getElementById("setIsaAnnual")?.value) || 20000;
  const cash = document.getElementById("setIsaCashMax")?.value;
  currentPlan.settings.isaCashMax = cash === "" || cash == null ? null : (parseFloat(cash) || 0);
  autoSave();
  updateSaveStatus();
}
window.saveIsaSettings = saveIsaSettings;

function ensureWheelSettings() {
  if (!currentPlan.settings) currentPlan.settings = {};
  if (currentPlan.settings.wheelIncrement == null) {
    currentPlan.settings.wheelIncrement = 1;
  }
  if (currentPlan.settings.wheelBandIncrement == null) {
    currentPlan.settings.wheelBandIncrement = 0.5;
  }
  // Migrate: keep value integer
  currentPlan.settings.wheelIncrement = Math.max(1, Math.round(Number(currentPlan.settings.wheelIncrement) || 1));
  let b = Number(currentPlan.settings.wheelBandIncrement);
  if (!isFinite(b) || b <= 0) b = 0.5;
  // Snap to 0.5 steps
  b = Math.round(b * 2) / 2;
  currentPlan.settings.wheelBandIncrement = Math.max(0.5, b);
}

function getWheelIncrement() {
  ensureWheelSettings();
  return currentPlan.settings.wheelIncrement;
}

function getWheelBandIncrement() {
  ensureWheelSettings();
  return currentPlan.settings.wheelBandIncrement;
}

function syncWheelIncInput(inputEl) {
  if (!inputEl) return;
  ensureWheelSettings();
  const band = window._wheelMode === "band";
  if (band) {
    inputEl.step = "0.5";
    inputEl.min = "0.5";
    inputEl.value = String(getWheelBandIncrement());
    inputEl.title = "Bandwidth step (% points)";
  } else {
    inputEl.step = "1";
    inputEl.min = "1";
    inputEl.value = String(getWheelIncrement());
    inputEl.title = "Value step (£/mo)";
  }
}

function isExpertMode() {
  return !!currentPlan.settings?.expertMode;
}

function updateContinueWizardBtn() {
  ensureWizardMeta();
  let btn = document.getElementById("continueWizardBtn");
  if (!btn) {
    const side = document.querySelector(".sidebar-bottom") || document.querySelector(".sidebar");
    if (!side) return;
    btn = document.createElement("button");
    btn.id = "continueWizardBtn";
    btn.type = "button";
    btn.className = "continue-wizard-btn";
    side.insertBefore(btn, side.firstChild);
  }
  const done = !!currentPlan.meta.wizardComplete;
  const pausedMidway = !done && (currentPlan.meta.wizardPaused || currentPlan.meta.wizardPath);
  btn.hidden = false;
  btn.onclick = () => {
    if (pausedMidway) {
      // Resume at the step where they paused
      resumeWizard();
      return;
    }
    // Completed (or never started a path): open welcome / options
    wizardPath = null;
    wizardStep = 0;
    currentPlan.meta.wizardPath = null;
    currentPlan.meta.wizardStep = 0;
    currentPlan.meta.wizardPaused = false;
    autoSave();
    showWizardUI();
  };
  btn.innerHTML = done
    ? `<span class="wiz-ico" aria-hidden="true">🪄</span> Wizard`
    : `<span class="wiz-ico" aria-hidden="true">🪄</span> Continue wizard`;
}
window.updateContinueWizardBtn = updateContinueWizardBtn;


function saveScale() {
  const start = parseInt(document.getElementById("scaleStart").value, 10);
  const end = parseInt(document.getElementById("scaleEnd").value, 10);
  if (!start || !end || end <= start) {
    alert("Please enter a valid start and end year (end must be after start).");
    return;
  }
  currentPlan.scale = { startYear: start, endYear: end };
  autoSave();
  updateSaveStatus();
  alert("Plan scale saved. Graphs will use " + start + " – " + end + ".");
}

// ---------- INCOME ----------
const INCOME_TYPES = [
  { value: "employment", label: "Employment" },
  { value: "db_pension", label: "Defined Benefit Pension" },
  { value: "state_pension", label: "State Pension" },
  { value: "other", label: "Other" }
];

function renderIncomePage() {
  const items = currentPlan.income || [];

  let rows = "";
  if (items.length === 0) {
    rows = `
      <div class="empty-state">
        <div class="empty-icon">£</div>
        <h3>No income sources yet</h3>
        <p>Add your salary, pensions and other income to build your plan.</p>
        <button class="btn-primary" onclick="openIncomeEditor()">+ Add Income</button>
      </div>
    `;
  } else {
    rows = `
      <div class="accounts-table">
        <div class="accounts-table-header" style="grid-template-columns: 2fr 1.2fr 1.4fr 1fr 1fr 0.8fr 110px;">
          <span>Name</span>
          <span>Person</span>
          <span>Type</span>
          <span class="text-right">Monthly</span>
          <span>Start</span>
          <span>Taxable</span>
          <span></span>
        </div>
        <div id="incomeSortList" class="sortable-list">
        ${items.map((inc, idx) => {
          const typeLabel = (INCOME_TYPES.find(t => t.value === inc.type) || {}).label || inc.type || "—";
          return `
          <div class="accounts-table-row sortable-row" draggable="true" data-id="${inc.id}" data-idx="${idx}" style="grid-template-columns: 2fr 1.2fr 1.4fr 1fr 1fr 0.8fr 110px;">
            <div class="acc-name"><span class="acc-dot" style="background:${inc.color || '#059669'}"></span>${escapeHtml(inc.name)}</div>
            <div>${escapeHtml(getPersonName(inc.personId))}</div>
            <div class="acc-type">${escapeHtml(typeLabel)}</div>
            <div class="text-right"> ${formatMoney(inc.amountMonthly)}</div>
            <div>${inc.startDate || "—"}</div>
            <div>${inc.taxable !== false ? "Yes" : "No"}</div>
            <div class="acc-actions">
              <button class="btn-icon" onclick="openIncomeEditor('${inc.id}')" title="Edit">✎</button>
              <button class="btn-icon danger" onclick="deleteIncome('${inc.id}')" title="Delete">✕</button>
              <span class="drag-handle" title="Drag to reorder" aria-label="Reorder">☰</span>
            </div>
          </div>`;
        }).join("")}
        </div>
      </div>

      <div class="accounts-summary-bar">
        <div>
          <span class="label">Total monthly income (current sources)</span>
          <span class="value">${formatMoney(items.reduce((s, i) => s + (Number(i.amountMonthly) || 0), 0))}</span>
        </div>
        <button class="btn-primary" onclick="openIncomeEditor()">+ Add Income</button>
      </div>
    `;
  }

  return `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Income</h1>
          <p class="subtitle">Salary, pensions and other income sources</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      ${rows}
    <div class="collapse-section open" style="margin-top:16px;">
        <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
          <span>Income over time</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <div id="incomeOverviewChart" class="accounts-overview-chart"></div>
        </div>
      </div>
    ${renderTypeColorSettings("income")}
    </div>
  `;
}

async function deleteIncome(id) {
  if (!(await appConfirmYesNo("Delete this income source?"))) return;
  currentPlan.income = currentPlan.income.filter(i => i.id !== id);
  autoSave();
  const active = document.querySelector(".navButton.active");
  if (active) active.click();
}

let editingIncomeId = null;

function openIncomeEditor(id = null) {
  editingIncomeId = id;
  const inc = id ? currentPlan.income.find(i => i.id === id) : null;
  ensureAssumptions();

  const personOptions = currentPlan.people
    .filter(p => p.name)
    .map(p => `<option value="${p.id}" ${inc && inc.personId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");

  const typeOptions = INCOME_TYPES.map(t =>
    `<option value="${t.value}" ${inc && inc.type === t.value ? "selected" : (!inc && t.value === "employment" ? "selected" : "")}>${t.label}</option>`
  ).join("");

  const panel = document.getElementById("slidePanel");
  const backdrop = document.getElementById("slideBackdrop");

  panel.innerHTML = `
    <div class="slide-header">
      <h2>${inc ? "Edit Income" : "New Income"}</h2>
      <button class="btn-icon" onclick="closeIncomeEditor()">✕</button>
    </div>

    <div class="slide-body">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="incName" value="${inc ? escapeHtml(inc.name) : ""}" placeholder="e.g. Daniel Salary">
      </div>

      <div class="form-group">
        <label>Person</label>
        <select id="incPerson">
          <option value="">— Select person —</option>
          ${personOptions || '<option value="" disabled>Add people first</option>'}
        </select>
      </div>

      <div class="form-group">
        <label>Type</label>
        <select id="incType">${typeOptions}</select>
      </div>

      <!-- Standard amount (employment / other / state after populate) -->
      <div id="incStandardFields">
        <div class="form-group">
          <label>Amount</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="number" id="incAmount" value="${inc ? (inc.amountInput != null ? inc.amountInput : inc.amountMonthly) : 3000}" step="10" style="flex:1;min-width:100px;">
            <select id="incFreq" style="width:auto;">
              <option value="monthly" ${(inc?.amountFreq || "monthly") === "monthly" ? "selected" : ""}>Monthly</option>
              <option value="weekly" ${inc?.amountFreq === "weekly" ? "selected" : ""}>Weekly</option>
              <option value="yearly" ${inc?.amountFreq === "yearly" ? "selected" : ""}>Yearly</option>
            </select>
          </div>
          <p class="field-hint" id="incAnnualHint" style="margin-top:6px;"></p>
        </div>
        <div id="incStatePensionTools" style="display:none;margin-bottom:12px;">
          <button type="button" class="btn-secondary btn-sm" id="incPopulateState">Populate from assumptions (age-based)</button>
          <p class="field-hint">Uses Assumptions → State pension defaults. Grows the quoted figure with inflation from the assumption year to the start date.</p>
        </div>
      </div>

      <!-- Defined benefit specific -->
      <div id="incDbFields" style="display:none;">
        <div class="settings-card" style="margin:0 0 12px;padding:12px;">
          <p class="field-hint" style="margin:0 0 10px;">
            Enter the pension <strong>as you expect it at the start date</strong> — include any growth and inflation built into the scheme’s projection.
            Most people take this figure from an annual statement or online modeller.
          </p>
          <div class="form-group">
            <label>Expected income (£ / year at start)</label>
            <input type="number" id="incDbIncome" value="${inc?.dbIncomeAnnual != null ? inc.dbIncomeAnnual : (inc?.amountMonthly ? inc.amountMonthly * 12 : 0)}" step="100">
          </div>
          <div class="form-group">
            <label>Tax-free lump sum (£) at start (optional)</label>
            <input type="number" id="incDbLumpSum" value="${inc?.dbLumpSum != null ? inc.dbLumpSum : 0}" step="100">
            <span class="field-hint">Modelled as a one-off in the start year (not in monthly spend).</span>
          </div>
          <div class="form-group">
            <label>Amount that increases with inflation (£ / year of the income above)</label>
            <input type="number" id="incDbInflating" value="${inc?.dbInflatingAnnual != null ? inc.dbInflatingAnnual : (inc?.dbIncomeAnnual || 0)}" step="100">
          </div>
          <div class="form-group">
            <label>Amount that does <em>not</em> increase (£ / year)</label>
            <input type="number" id="incDbFlat" value="${inc?.dbFlatAnnual != null ? inc.dbFlatAnnual : 0}" step="100">
          </div>
          <div class="form-group">
            <label>Custom increase rate on the inflating part (% / year, blank = plan inflation)</label>
            <input type="number" id="incDbCustomRate" value="${inc?.dbCustomRate != null ? inc.dbCustomRate : ""}" step="0.1" placeholder="e.g. 2.5">
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" id="incStart" value="${inc ? (inc.startDate || "") : "2026-01-01"}">
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="date" id="incEnd" value="${inc ? (inc.endDate || "") : ""}" placeholder="Leave blank if ongoing">
        </div>
      </div>
      <p class="field-hint">First / last calendar year is pro‑rated from the start and end dates.</p>

      <div id="incGrowthWrap">
        ${renderGrowthModeFields("inc", inc ? { growthMode: inc.growthMode, growthRate: inc.growthRate, growthCustom: inc.growthCustom, growthAdj: inc.growthAdj } : { growthMode: "inflation" }, 2.5)}
      </div>

      <div class="form-group">
        <label>Colour</label>
        <input type="color" id="incColor" value="${inc ? (inc.color || "#059669") : "#059669"}">
      </div>

      <div class="form-group" id="incPensionContribWrap">
        <label>Pension contribution</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="number" id="incPensionVal" value="${inc ? (inc.pensionValue ?? 0) : 0}" step="10" style="flex:1;">
          <select id="incPensionUnit" style="width:72px;">
            <option value="pct" ${!inc || inc.pensionUnit !== "£" ? "selected" : ""}>%</option>
            <option value="£" ${inc && inc.pensionUnit === "£" ? "selected" : ""}>£</option>
          </select>
        </div>
        <span class="field-hint">Of gross monthly pay (or fixed £ / month)</span>
      </div>

      <div class="joint-toggle" style="margin-top:8px;">
        <input type="checkbox" id="incTaxable" ${!inc || inc.taxable !== false ? "checked" : ""}>
        <label for="incTaxable">Taxable (tax rules are set per person under People)</label>
      </div>
    </div>

    <div class="slide-footer">
      <button class="btn-secondary" onclick="closeIncomeEditor()">Cancel</button>
      <button class="btn-primary" onclick="saveIncomeFromEditor()">Save Income</button>
    </div>
  `;

  panel.classList.remove("wide");
  panel.classList.add("wide");
  backdrop.classList.add("open");
  panel.classList.add("open");

  const syncIncHint = () => {
    const raw = parseFloat(document.getElementById("incAmount")?.value) || 0;
    const freq = document.getElementById("incFreq")?.value || "monthly";
    let annual = raw;
    if (freq === "weekly") annual = raw * 52;
    else if (freq === "monthly") annual = raw * 12;
    const hint = document.getElementById("incAnnualHint");
    if (hint) hint.textContent = `→ £${Math.round(annual).toLocaleString()} per year (model uses this)`;
  };
  document.getElementById("incAmount")?.addEventListener("input", syncIncHint);
  document.getElementById("incFreq")?.addEventListener("change", syncIncHint);
  syncIncHint();

  const syncTypeUI = () => {
    const t = document.getElementById("incType")?.value;
    const std = document.getElementById("incStandardFields");
    const db = document.getElementById("incDbFields");
    const stateTools = document.getElementById("incStatePensionTools");
    const growth = document.getElementById("incGrowthWrap");
    const pens = document.getElementById("incPensionContribWrap");
    if (t === "db_pension") {
      if (std) std.style.display = "none";
      if (db) db.style.display = "";
      if (growth) growth.style.display = "none";
      if (pens) pens.style.display = "none";
    } else {
      if (std) std.style.display = "";
      if (db) db.style.display = "none";
      if (growth) growth.style.display = "";
      if (pens) pens.style.display = t === "employment" ? "" : "none";
      if (stateTools) stateTools.style.display = t === "state_pension" ? "" : "none";
    }
  };
  document.getElementById("incType")?.addEventListener("change", syncTypeUI);
  syncTypeUI();

  document.getElementById("incPopulateState")?.addEventListener("click", () => {
    populateStatePensionFromAssumptions();
  });
}

function formatDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function populateStatePensionFromAssumptions() {
  const a = ensureAssumptions();
  const sp = a.statePension || {};
  const baseAnnual = Number(sp.annualAmount) || 11500; // illustrative full new state pension
  const baseYear = Number(sp.quoteYear) || new Date().getFullYear();
  const grow = sp.growWithInflation !== false;
  const spaAge = Number(sp.spaAge) || 67;

  // Start date = SPA birthday for selected person (or first person with DOB)
  const personId = document.getElementById("incPerson")?.value;
  let person = (currentPlan.people || []).find(p => p.id === personId);
  if (!person?.dateOfBirth) {
    person = (currentPlan.people || []).find(p => p.dateOfBirth) || person;
  }
  let startY;
  let spaNote = "";
  if (person?.dateOfBirth) {
    const dob = new Date(person.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const spaDate = new Date(dob.getFullYear() + spaAge, dob.getMonth(), dob.getDate());
      const startEl = document.getElementById("incStart");
      if (startEl) startEl.value = formatDateYMD(spaDate);
      startY = spaDate.getFullYear();
      spaNote = ` Start set to ${person.name || "person"}’s ${spaAge}th birthday (${formatDateYMD(spaDate)}).`;
    }
  }
  if (startY == null) {
    const startStr = document.getElementById("incStart")?.value;
    startY = startStr ? new Date(startStr).getFullYear() : (currentPlan.scale?.startYear || baseYear);
    if (!person?.dateOfBirth) {
      spaNote = " Add a date of birth on People to set start to their SPA birthday automatically.";
    }
  }

  const rate = getInflationRate();
  let annual = baseAnnual;
  if (grow && startY > baseYear) {
    annual = baseAnnual * Math.pow(1 + rate, startY - baseYear);
  }
  const monthly = annual / 12;
  const amt = document.getElementById("incAmount");
  const freq = document.getElementById("incFreq");
  if (amt) amt.value = Math.round(monthly);
  if (freq) freq.value = "monthly";
  const name = document.getElementById("incName");
  if (name && !name.value.trim()) name.value = "State Pension";
  document.getElementById("incAmount")?.dispatchEvent(new Event("input"));
  const msg = `State pension set to about £${Math.round(monthly).toLocaleString()}/mo in ${startY}` +
    (grow && startY > baseYear ? ` (grown from £${Math.round(baseAnnual).toLocaleString()}/yr in ${baseYear}).` : ".") +
    spaNote;
  if (typeof appAlert === "function") appAlert(msg);
  else alert(msg);
}
window.populateStatePensionFromAssumptions = populateStatePensionFromAssumptions;

function fillIncomeTaxBandRows(bands) {
  const wrap = document.getElementById("incTaxBandRows");
  if (!wrap) return;
  const list = (bands && bands.length) ? bands : defaultTaxBands();
  while (list.length < 4) list.push({ from: 0, to: null, rate: 0 });
  wrap.innerHTML = list.slice(0, 4).map((b, i) => `
    <div class="tax-band-row" data-idx="${i}">
      <div class="form-group"><label>From (£)</label>
        <input type="number" class="inc-tax-from" value="${b.from ?? 0}" step="10"></div>
      <div class="form-group"><label>To (£)</label>
        <input type="number" class="inc-tax-to" value="${b.to == null ? "" : b.to}" placeholder="No limit" step="10"></div>
      <div class="form-group"><label>Rate (%)</label>
        <input type="number" class="inc-tax-rate" value="${b.rate ?? 0}" step="0.1"></div>
    </div>`).join("");
}

function toggleIncomeTaxBands(on) {
  const w = document.getElementById("incTaxBandsWrap");
  if (w) w.style.display = on ? "" : "none";
  if (on && document.getElementById("incTaxBandRows") && !document.getElementById("incTaxBandRows").children.length) {
    fillIncomeTaxBandRows(ensureAssumptions().taxBands);
  }
}
window.toggleIncomeTaxBands = toggleIncomeTaxBands;

function openAssumptionsFromIncome() {
  closeIncomeEditor();
  const btn = document.querySelector('.navButton[data-page="assumptions"]');
  if (btn) btn.click();
}
window.openAssumptionsFromIncome = openAssumptionsFromIncome;

function closeIncomeEditor() {
  document.getElementById("slidePanel").classList.remove("open", "wide");
  document.getElementById("slideBackdrop").classList.remove("open");
  editingIncomeId = null;
}

function saveIncomeFromEditor() {
  const name = document.getElementById("incName").value.trim();
  if (!name) {
    alert("Please give this income source a name.");
    return;
  }

  const taxable = document.getElementById("incTaxable").checked;
  let taxBands = null;
  if (taxable) {
    taxBands = Array.from(document.querySelectorAll("#incTaxBandRows .tax-band-row")).map(row => {
      const toVal = row.querySelector(".inc-tax-to").value;
      return {
        from: parseFloat(row.querySelector(".inc-tax-from").value) || 0,
        to: toVal === "" ? null : parseFloat(toVal),
        rate: parseFloat(row.querySelector(".inc-tax-rate").value) || 0
      };
    });
  }
  const type = document.getElementById("incType").value;
  let amountInput = parseFloat(document.getElementById("incAmount")?.value) || 0;
  let amountFreq = document.getElementById("incFreq")?.value || "monthly";
  let amountMonthly = amountInput;
  if (amountFreq === "weekly") amountMonthly = amountInput * 52 / 12;
  else if (amountFreq === "yearly") amountMonthly = amountInput / 12;

  let dbFields = {};
  if (type === "db_pension") {
    const dbIncome = parseFloat(document.getElementById("incDbIncome")?.value) || 0;
    const dbInflating = parseFloat(document.getElementById("incDbInflating")?.value);
    const dbFlat = parseFloat(document.getElementById("incDbFlat")?.value) || 0;
    const dbLump = parseFloat(document.getElementById("incDbLumpSum")?.value) || 0;
    const dbCustom = document.getElementById("incDbCustomRate")?.value;
    dbFields = {
      dbIncomeAnnual: dbIncome,
      dbInflatingAnnual: isFinite(dbInflating) ? dbInflating : dbIncome,
      dbFlatAnnual: dbFlat,
      dbLumpSum: dbLump,
      dbCustomRate: dbCustom === "" || dbCustom == null ? null : parseFloat(dbCustom)
    };
    amountMonthly = dbIncome / 12;
    amountInput = dbIncome;
    amountFreq = "yearly";
  }

  const growth = type === "db_pension"
    ? { growthRate: 0, growthMode: "inflation", growthCustom: 0, growthAdj: 0 }
    : (() => { const g = readGrowthModeFields("inc"); return { growthRate: g.growthRate, growthMode: g.growthMode, growthCustom: g.growthCustom, growthAdj: g.growthAdj }; })();

  const data = {
    id: editingIncomeId || uid(),
    name,
    personId: document.getElementById("incPerson").value,
    type,
    amountInput,
    amountFreq,
    amountMonthly,
    startDate: document.getElementById("incStart").value,
    endDate: document.getElementById("incEnd").value || null,
    ...growth,
    ...dbFields,
    taxable,
    taxBands,
    pensionValue: parseFloat(document.getElementById("incPensionVal")?.value) || 0,
    pensionUnit: document.getElementById("incPensionUnit")?.value || "pct",
    ni: document.getElementById("incNi")?.value !== "no",
    color: document.getElementById("incColor")?.value || "#059669"
  };

  if (editingIncomeId) {
    const idx = currentPlan.income.findIndex(i => i.id === editingIncomeId);
    if (idx >= 0) currentPlan.income[idx] = data;
  } else {
    currentPlan.income.push(data);
  }

  autoSave();
  closeIncomeEditor();

  const active = document.querySelector(".navButton.active");
  if (active && active.dataset.page === "income") active.click();
}

// ---------- SPEND PAGE ----------
function ensureSpend() {
  const startY = currentPlan.scale?.startYear || new Date().getFullYear();
  const endY = currentPlan.scale?.endYear || startY + 40;
  if (!currentPlan.spend) {
    currentPlan.spend = {
      targetBase: 0,
      targetFactor: 1,
      fundUntil: startY + 30,
      showInflation: false,
      inflationRate: 0.025,
      targetOverrides: {},
      minOverrides: {},
      maxOverrides: {},
      modelRatio: 1,
      bandPct: 0.1,
      pots: []
    };
  }
  if (!currentPlan.spend.targetOverrides) currentPlan.spend.targetOverrides = {};
  if (!currentPlan.spend.minOverrides) currentPlan.spend.minOverrides = {};
  if (!currentPlan.spend.maxOverrides) currentPlan.spend.maxOverrides = {};
  if (!currentPlan.spend.pots) currentPlan.spend.pots = [];
  if (currentPlan.spend.modelRatio == null) currentPlan.spend.modelRatio = 1;
  if (currentPlan.spend.bandPct == null) currentPlan.spend.bandPct = 0.1;
  if (!currentPlan.spend.bandOverrides) currentPlan.spend.bandOverrides = {};
  if (currentPlan.spend.targetFactor == null) currentPlan.spend.targetFactor = 1;
  if (currentPlan.spend.targetBase == null || isNaN(Number(currentPlan.spend.targetBase))) {
    currentPlan.spend.targetBase = 0;
  }
  if (!currentPlan.spend.oneOffs) currentPlan.spend.oneOffs = [];

  // Migrate legacy essentialAnnual into a non-removable pot
  if (!currentPlan.spend.pots.some(p => p.isEssential)) {
    const amount = currentPlan.spend.essentialAnnual != null ? currentPlan.spend.essentialAnnual : 0;
    currentPlan.spend.pots.unshift({
      id: "essential",
      name: "Essential",
      amountAnnual: amount,
      fromYear: startY,
      toYear: endY,
      inflate: true,
      color: "#94A3B8",
      overrides: {},
      isEssential: true
    });
    delete currentPlan.spend.essentialAnnual;
  }
  // Normalise pot fields
  currentPlan.spend.pots.forEach(p => {
    if (p.fromYear == null) p.fromYear = startY;
    if (p.toYear == null) p.toYear = endY;
    if (p.inflate == null) p.inflate = true;
    if (!p.color) p.color = p.isEssential ? "#94A3B8" : pastelColor();
    if (!p.overrides) p.overrides = {};
  });
}

function pastelColor() {
  const pastels = ["#93C5FD", "#A5B4FC", "#C4B5FD", "#F9A8D4", "#FDBA74", "#6EE7B7", "#67E8F9"];
  return pastels[Math.floor(Math.random() * pastels.length)];
}


/**
 * Plan health using an unclamped path so overspend is visible (NW can go negative).
 *
 * status:
 *  - on          balanced near fund-until
 *  - underfunded not enough money (would go overdrawn)
 *  - over        spending too hard / residual negative shape
 *  - under       money left at fund-until (could spend more, or front-loaded)
 *  - shape       hits ~0 early then wealth rebuilds (front-loaded spend)
 */
function getPlanBalanceStatus() {
  ensureSpend();
  const years = getPlanYears();
  const fundUntil = currentPlan.spend.fundUntil || years[years.length - 1];
  // Unclamped path — reveals true shortfalls the floored live model hides
  const path = simulateNetWorthPath(y => getNonEssentialForYear(y), { allowNegative: true });
  let minNW = Infinity;
  let endNW = 0;
  let minIdx = 0;
  let nMonths = 0;
  const relevant = [];
  years.forEach((y, i) => {
    if (y <= fundUntil) {
      const v = path[i] ?? 0;
      if (v < minNW) { minNW = v; minIdx = i; }
      if (y === fundUntil) endNW = v;
      nMonths += 12;
      relevant.push({ y, i, v });
    }
  });
  if (!isFinite(minNW)) minNW = 0;
  if (nMonths < 12) nMonths = 12;

  const minResidual = Math.max(0, Number(currentPlan.spend?.minNetWorthAtFund) || 0);
  const onBand = Math.max(100, nMonths * 2);
  const endGap = endNW - minResidual;
  const endDisp = Math.abs(endGap) < onBand ? 0 : endGap;
  const perMonth = endDisp / nMonths;

  // Shape: hits near-zero well before fund-until, then ends higher (front-loaded)
  let shapeIssue = false;
  if (relevant.length > 3) {
    const earlyCut = Math.floor(relevant.length * 0.7);
    const hitEarlyZero = relevant.slice(0, earlyCut).some(r => r.v <= onBand);
    const minYear = years[minIdx];
    if (hitEarlyZero && endNW > onBand * 5 && minYear < fundUntil - 2) {
      shapeIssue = true;
    }
  }

  let status = "on";
  let needle = 0;
  let code = "ok";
  let message = "";

  if (minNW < -onBand) {
    status = "over";
    code = "underfunded";
    needle = Math.max(-1, Math.min(-0.15, minNW / 30000));
    message = "Not enough money to fund this plan without going overdrawn. Reduce spend, extend fund-until, or add income/capital.";
  } else if (shapeIssue) {
    status = "under";
    code = "shape";
    needle = Math.min(1, Math.max(0.15, endNW / 50000));
    message = "Plan never goes permanently overdrawn, but wealth hits near zero before fund-until and then rebuilds. That usually means too much spend early (or too little later). Consider shifting NES later.";
  } else if (Math.abs(endGap) <= onBand && minNW >= -onBand) {
    status = "on";
    code = "ok";
    needle = 0;
    message = "";
  } else if (endNW < -onBand) {
    status = "over";
    code = "over";
    needle = Math.max(-1, Math.min(-0.05, perMonth / 500));
    message = "Net worth is short at fund-until. Reduce overall NES or add resources.";
  } else {
    status = "under";
    code = "under";
    needle = Math.min(1, Math.max(0.05, perMonth / 500));
    message = "Money left at fund-until — the plan works but isn’t fully balanced. You could spend more overall, or use Solve balance.";
  }

  return {
    status, code, message, needle, minNW, endNW: endDisp, endNWRaw: endNW,
    perMonth, nMonths, modelRatio: getModelRatio(),
    minYear: years[minIdx], fundUntil
  };
}

function renderBalanceGauge() {
  const { status, code, needle, minNW, endNW, perMonth, message } = getPlanBalanceStatus();
  const angle = Math.max(-75, Math.min(75, needle * 75));
  const fromAngle = (typeof _lastGaugeAngle === "number") ? _lastGaugeAngle : angle;
  _lastGaugeAngle = angle;
  const label = code === "ok" ? "On target"
    : code === "underfunded" ? "Underfunded"
    : code === "shape" ? "Shape warning"
    : status === "over" ? "Over budget"
    : "Under budget";
  const color = code === "ok" ? "#16A34A" : (code === "underfunded" || status === "over") ? "#DC2626" : "#CA8A04";
  const perMoLabel = formatMoney(perMonth);
  const totalLabel = formatMoney(endNW);
  const gradId = "gaugeGrad_" + Math.random().toString(36).slice(2, 7);
  const reduced = prefersReducedMotion();
  return `
    <div class="balance-gauge" title="Min NW ${formatMoney(minNW)} · Fund-until NW ${totalLabel}">
      <div class="gauge-value-top">${perMoLabel}<span class="gauge-unit">/mo</span></div>
      <div class="gauge-caption">Effect per month</div>
      <svg viewBox="0 0 120 72" width="130" height="78">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#DC2626"/>
            <stop offset="35%" stop-color="#22C55E"/>
            <stop offset="50%" stop-color="#16A34A"/>
            <stop offset="65%" stop-color="#22C55E"/>
            <stop offset="100%" stop-color="#EAB308"/>
          </linearGradient>
        </defs>
        <path d="M 12 58 A 48 48 0 0 1 108 58" fill="none" stroke="url(#${gradId})" stroke-width="10" stroke-linecap="round"/>
        <line x1="60" y1="10" x2="60" y2="22" stroke="#0F172A" stroke-width="2"/>
        <g class="gauge-needle" data-angle="${angle}" style="transform-origin:60px 58px;transform:rotate(${reduced ? angle : fromAngle}deg);transition:${reduced ? "none" : "transform 0.55s cubic-bezier(0.22,1,0.36,1)"}">
          <line x1="60" y1="58" x2="60" y2="20" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="60" cy="58" r="4" fill="#0F172A"/>
        </g>
      </svg>
      <div class="gauge-label" style="color:${color}">${label}</div>
      <div class="gauge-total">Effect on total net worth<br><strong>${totalLabel}</strong></div>
      ${message ? `<div class="gauge-hint">${escapeHtml(message)}</div>` : ""}
    </div>`;
}

function animateGaugeNeedles(root) {
  if (prefersReducedMotion()) return;
  (root || document).querySelectorAll(".gauge-needle").forEach(g => {
    const a = parseFloat(g.getAttribute("data-angle"));
    if (isNaN(a)) return;
    requestAnimationFrame(() => {
      g.style.transform = `rotate(${a}deg)`;
    });
  });
}

function renderSpendPage() {
  ensureSpend();
  const sp = currentPlan.spend;
  const years = getPlanYears();

  return `
    <div class="page spend-page">
      <header class="page-header">
        <div>
          <h1>Spend</h1>
          <p class="subtitle">Shape spending over the plan · figures in ${sp.showInflation ? "inflated (future)" : "today's"} money</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="spend-top-bar">
        <div class="money-note" style="margin:0;flex:1;">
          ${sp.showInflation
            ? "Showing nominal £ (with inflation)."
            : "Showing today's money."}
        </div>
        <label class="mode-switch compact inflation-switch" title="Toggle display between today's money and nominal (with inflation)">
          <span class="mode-side ${!sp.showInflation ? "active" : ""}">Today's £</span>
          <input type="checkbox" id="spInflation" ${sp.showInflation ? "checked" : ""}>
          <span class="mode-track"><span class="mode-knob"></span></span>
          <span class="mode-side ${sp.showInflation ? "active" : ""}">With inflation</span>
        </label>
      </div>

      <!-- Non Essential Spend + balance -->
      <div class="collapse-section open" data-section="target">
        <button type="button" class="collapse-header" onclick="toggleSpendSection('target')">
          <span>Non Essential Spend</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <div class="spend-balance-row spend-balance-row-v">
            <div class="spend-chart-col">
              <p class="chart-hint" style="margin:0 0 8px;">
                Figures are <strong>£ / month</strong>. Non Essential Spend = target × model ratio (${getModelRatio().toFixed(3)}).
                Drag nodes · double-click to edit · wheel adjusts value (hold <kbd>Alt</kbd> for bandwidth).
              </p>
              <div class="spend-chart-wrap" id="targetChartWrap"></div>
              <div class="node-tools-bar">
                <div class="wheel-mode-row" title="Toggle what the mouse wheel adjusts. Hold Alt for temporary bandwidth when on Value.">
                  <span class="wheel-mode-label">Wheel adjusts</span>
                  <label class="mode-switch">
                    <span class="mode-side ${!(typeof window !== "undefined" && window._wheelMode === "band") ? "active" : ""}">Value £</span>
                    <input type="checkbox" id="spWheelModeToggle" ${typeof window !== "undefined" && window._wheelMode === "band" ? "checked" : ""}>
                    <span class="mode-track"><span class="mode-knob"></span></span>
                    <span class="mode-side ${typeof window !== "undefined" && window._wheelMode === "band" ? "active" : ""}">Bandwidth %</span>
                  </label>
                  <input type="number" id="spWheelInc" class="wheel-inc-input"
                    min="${(typeof window !== "undefined" && window._wheelMode === "band") ? 0.5 : 1}"
                    step="${(typeof window !== "undefined" && window._wheelMode === "band") ? 0.5 : 1}"
                    value="${(typeof window !== "undefined" && window._wheelMode === "band")
                      ? (Number(currentPlan.settings?.wheelBandIncrement) || 0.5)
                      : Math.max(1, Math.round(Number(currentPlan.settings?.wheelIncrement) || 1))}"
                    title="Step for current wheel mode">
                  <span class="field-hint wheel-inc-hint">step</span>
                </div>
                <label class="subtle-toggle" title="Ctrl/Cmd+click toggle · Shift+click range · wheel moves all selected">
                  <input type="checkbox" id="spMultiSelect" ${currentPlan.settings?.multiNodeSelect ? "checked" : ""}>
                  Multi-select nodes
                </label>
                <div class="blend-tools" title="Select two or more years, then blend values between the first and last selected">
                  <span class="wheel-mode-label">Blend</span>
                  <button type="button" class="btn-secondary btn-sm" id="spBlendLinear">Straight</button>
                  <button type="button" class="btn-secondary btn-sm" id="spBlendEase">Curve</button>
                </div>
              </div>
            </div>
            <div class="spend-gauge-col">
              <div id="spGaugeWrap">${renderBalanceGauge()}</div>
              <div class="spend-toolbar-vertical">
                <div class="form-group" style="margin:0;">
                  <label>Fund until</label>
                  <input type="number" id="spFundUntil" value="${sp.fundUntil}" min="${years[0]}" max="${years[years.length-1]}">
                </div>
                <div class="form-group inline-field">
                  <label>Min. savings at fund until (£)</label>
                  <input type="number" id="spMinNW" value="${Math.round(Number(sp.minNetWorthAtFund) || 0)}" min="0" step="1000" title="Solver aims to leave at least this much net worth at Fund until (not zero)">
                </div>
                <div class="form-group" style="margin:0;">
                  <label>Bandwidth %</label>
                  <input type="number" id="spBandPct" value="${Math.round(getBandPct()*100)}" min="0" max="50" step="1" title="Default ± band around NES">
                </div>
                <button class="btn-secondary" id="spResetTargets" type="button"
                  title="FIRST SETUP — Use once when the plan is mostly filled in. Builds a flat target shape until Fund until, then solves the model ratio so net worth lands near £0. Clears manual node highlights.">
                  Reset targets
                </button>
                <button class="btn-secondary" id="spRebaseTargets" type="button"
                  title="KEEP YOUR SHAPE — Use later when pots changed a lot (e.g. markets or savings). Shifts the whole target level up or down so the plan balances again, without redesigning year-by-year thinking.">
                  Rebase targets
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- All spend stacked -->
      <div class="collapse-section open" data-section="allspend" style="margin-top:12px;">
        <button type="button" class="collapse-header" onclick="toggleSpendSection('allspend')">
          <span>All spend</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <div class="chart-mode-row" id="spStackModeRow">
            <span class="field-hint">Bottom → top: Essential, pots, one-offs, Non Essential Spend · £/mo</span>
            <label class="mode-switch compact" title="Stacked area or separate lines">
              <span class="mode-side ${(currentPlan.settings?.spendStackMode || "area") === "line" ? "active" : ""}">Line</span>
              <input type="checkbox" id="spStackModeToggle" ${(currentPlan.settings?.spendStackMode || "area") === "area" ? "checked" : ""}>
              <span class="mode-track"><span class="mode-knob"></span></span>
              <span class="mode-side ${(currentPlan.settings?.spendStackMode || "area") === "area" ? "active" : ""}">Area</span>
            </label>
          </div>
          <div class="spend-chart-wrap" id="spendChartWrap"></div>
        </div>
      </div>

      <!-- Essential (own section) -->
      <div class="collapse-section open" data-section="essential" style="margin-top:12px;">
        <button type="button" class="collapse-header" onclick="toggleSpendSection('essential')">
          <span>Essential spend</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <p class="field-hint">Core living costs. Included in monthly spend. Not removable.</p>
          <div id="spEssentialBlock"></div>
        </div>
      </div>

      <div class="collapse-section open" data-section="pots" style="margin-top:12px;">
        <button type="button" class="collapse-header" onclick="toggleSpendSection('pots')">
          <span>Other recurring pots</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
            <button class="btn-primary" type="button" id="spAddPot">+ Add pot</button>
          </div>
          <div id="spPotsList"></div>
        </div>
      </div>

      <div class="collapse-section open" data-section="oneoffs" style="margin-top:12px;">
        <button type="button" class="collapse-header" onclick="toggleSpendSection('oneoffs')">
          <span>One-off spends</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <p class="field-hint">Wedding, car, etc. Deducted from pots in that year but not included in headline monthly spend. Shown on the dashboard strip. <strong>Not inflated</strong> — enter the amount in the money of that year (build inflation into the figure yourself).</p>
          <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
            <button class="btn-primary" type="button" id="spAddOneOff">+ Add one-off</button>
          </div>
          <div id="spOneOffList"></div>
        </div>
      </div>
    ${renderTypeColorSettings("spend")}
    </div>
  `;
}

function toggleSpendSection(id) {
  const sec = document.querySelector(`.collapse-section[data-section="${id}"]`);
  if (!sec) return;
  sec.classList.toggle("open");
}
window.toggleSpendSection = toggleSpendSection;

function updateSpendGaugeOnly() {
  const g = document.getElementById("spGaugeWrap");
  if (!g || typeof renderBalanceGauge !== "function") return;
  g.innerHTML = renderBalanceGauge();
  if (typeof animateGaugeNeedles === "function") animateGaugeNeedles(g);
}
window.updateSpendGaugeOnly = updateSpendGaugeOnly;

function refreshSpendView() {
  updateSpendGaugeOnly();
  if (document.getElementById("targetChartWrap")) drawTargetChart("targetChartWrap");
  if (document.getElementById("spendChartWrap") || document.getElementById("spendStackChart")) {
    try { drawSpendStackChart("spendChartWrap"); } catch (e) { try { drawSpendStackChart(); } catch (e2) {} }
  }
  updateSaveStatus();
}
window.refreshSpendView = refreshSpendView;

function attachSpendListeners() {
  ensureSpend();
  const saveFields = () => {
    const fu = document.getElementById("spFundUntil");
    if (fu) currentPlan.spend.fundUntil = parseInt(fu.value, 10) || currentPlan.scale.endYear;
    const infOn = !!document.getElementById("spInflation")?.checked;
    currentPlan.spend.showInflation = infOn;
    document.querySelectorAll(".inflation-switch .mode-side").forEach((el, i) => {
      el.classList.toggle("active", infOn ? i === 1 : i === 0);
    });
    autoSave();
    // Full refresh keeps subtitle + charts consistent
    if (typeof refreshSpendView === "function") {
      const pageEl = document.getElementById("pageContent");
      if (pageEl) {
        pageEl.innerHTML = renderSpendPage();
        attachSpendListeners();
      }
    } else {
      drawTargetChart();
      drawSpendStackChart();
      renderPotsList();
    }
  };

  document.getElementById("spMultiSelect")?.addEventListener("change", e => {
    if (!currentPlan.settings) currentPlan.settings = {};
    currentPlan.settings.multiNodeSelect = e.target.checked;
    if (!e.target.checked) window._selectedYears = new Set();
    autoSave();
    drawTargetChart("targetChartWrap");
  });
  document.getElementById("spBlendLinear")?.addEventListener("click", () => {
    if (typeof window.blendNesBetweenAnchors === "function") window.blendNesBetweenAnchors("linear");
  });
  document.getElementById("spBlendEase")?.addEventListener("click", () => {
    if (typeof window.blendNesBetweenAnchors === "function") window.blendNesBetweenAnchors("ease");
  });
  document.getElementById("spStackModeToggle")?.addEventListener("change", e => {
    setSpendStackMode(e.target.checked ? "area" : "line", "spend");
  });
  document.getElementById("spWheelModeToggle")?.addEventListener("change", e => {
    window._wheelMode = e.target.checked ? "band" : "value";
    document.querySelectorAll(".mode-side").forEach((el, i) => {
      el.classList.toggle("active", e.target.checked ? i === 1 : i === 0);
    });
    syncWheelIncInput(document.getElementById("spWheelInc"));
  });
  document.getElementById("spWheelInc")?.addEventListener("change", e => {
    ensureWheelSettings();
    if (window._wheelMode === "band") {
      let v = parseFloat(e.target.value);
      if (!isFinite(v) || v < 0.5) v = 0.5;
      v = Math.round(v * 2) / 2;
      e.target.value = String(v);
      currentPlan.settings.wheelBandIncrement = v;
    } else {
      let v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) v = 1;
      e.target.value = String(v);
      currentPlan.settings.wheelIncrement = v;
    }
    autoSave();
  });
  syncWheelIncInput(document.getElementById("spWheelInc"));

  document.getElementById("spFundUntil")?.addEventListener("change", saveFields);
  document.getElementById("spMinNW")?.addEventListener("change", () => {
    ensureSpend();
    currentPlan.spend.minNetWorthAtFund = Math.max(0, parseFloat(document.getElementById("spMinNW")?.value) || 0);
    autoSave();
    if (typeof refreshSpendView === "function") refreshSpendView();
  });
  document.getElementById("spFundUntil")?.addEventListener("input", () => {
    const fu = document.getElementById("spFundUntil");
    if (fu) currentPlan.spend.fundUntil = parseInt(fu.value, 10) || currentPlan.scale.endYear;
    drawTargetChart();
    drawSpendStackChart();
  });
  document.getElementById("spInflation")?.addEventListener("change", saveFields);
  document.getElementById("spResetTargets")?.addEventListener("click", async () => {
    if (!(await appConfirmYesNo("Reset targets?\n\nFirst-time setup: sets a flat target shape until Fund until, then solves the model ratio so the plan balances. Use once when the plan is first filled in."))) return;
    resetTargets();
    refreshSpendView();
  });
  document.getElementById("spRebaseTargets")?.addEventListener("click", async () => {
    if (!(await appConfirmYesNo("Rebase targets?\n\nKeeps your target shape (the thinking) but shifts the level so the plan balances again — e.g. after savings grew more than expected."))) return;
    rebaseTargets();
    refreshSpendView();
  });
  document.getElementById("spBandPct")?.addEventListener("change", () => {
    const v = parseFloat(document.getElementById("spBandPct").value);
    currentPlan.spend.bandPct = isNaN(v) ? 0.1 : v / 100;
    autoSave();
    drawTargetChart();
  });
  document.getElementById("spAddPot")?.addEventListener("click", () => {
    const startY = currentPlan.scale.startYear;
    const endY = currentPlan.scale.endYear;
    currentPlan.spend.pots.push({
      id: uid(),
      name: "Spend pot " + currentPlan.spend.pots.filter(p => !p.isEssential).length + 1,
      amountAnnual: 2000, // stored annual; UI shows monthly
      fromYear: startY,
      toYear: endY,
      inflate: true,
      color: pastelColor(),
      overrides: {},
      isEssential: false
    });
    autoSave();
    renderPotsList();
    drawSpendStackChart();
  });

  animateGaugeNeedles(document.getElementById("spGaugeWrap"));
  renderEssentialBlock();
  renderPotsList();
  renderOneOffList();
  document.getElementById("spAddOneOff")?.addEventListener("click", () => {
    ensureSpend();
    if (!currentPlan.spend.oneOffs) currentPlan.spend.oneOffs = [];
    currentPlan.spend.oneOffs.push({
      id: uid(),
      name: "One-off",
      year: currentPlan.scale?.startYear || new Date().getFullYear(),
      month: 6,
      amount: 5000
    });
    autoSave();
    renderOneOffList();
  });
  const paintSpend = () => {
    drawTargetChart("targetChartWrap");
    drawSpendStackChart("spendChartWrap");
    const g = document.getElementById("spGaugeWrap");
    if (g) g.innerHTML = renderBalanceGauge();
  };
  paintSpend();
  requestAnimationFrame(() => requestAnimationFrame(paintSpend));
  setTimeout(paintSpend, 50);
  setTimeout(paintSpend, 200);
}

function renderEssentialBlock() {
  ensureSpend();
  const el = document.getElementById("spEssentialBlock");
  if (!el) return;
  const pot = (currentPlan.spend.pots || []).find(p => p.isEssential);
  if (!pot) { el.innerHTML = "<p class='field-hint'>No essential pot</p>"; return; }
  const years = getPlanYears();
  el.innerHTML = `
    <div class="pot-controls essential-controls" data-id="${pot.id}">
      <div class="form-group">
        <label>Base amount (£ / month)</label>
        <input type="number" class="ess-amount" value="${Math.round(toMonthly(pot.amountAnnual) * 100) / 100}" step="10">
      </div>
      <div class="form-group">
        <label>From year</label>
        <input type="number" class="ess-from" value="${pot.fromYear}" min="${years[0]}" max="${years[years.length-1]}">
      </div>
      <div class="form-group">
        <label>To year</label>
        <input type="number" class="ess-to" value="${pot.toYear}" min="${years[0]}" max="${years[years.length-1]}">
      </div>
      <div class="form-group" style="margin:0;min-width:150px;">
        <label>Growth</label>
        <select class="ess-growth-mode pot-inline-select" id="ess-gm">
          <option value="inflation" ${(!pot.growthMode || pot.growthMode === "inflation") ? "selected" : ""}>Inflation</option>
          <option value="other" ${pot.growthMode === "other" || pot.growthMode === "custom" ? "selected" : ""}>Other rate</option>
          <option value="inflation_plus" ${pot.growthMode === "inflation_plus" ? "selected" : ""}>Inflation adjusted</option>
          <option value="custom" disabled>Custom</option>
        </select>
      </div>
      <div class="form-group" style="margin:0;min-width:72px;">
        <label>${pot.growthMode === "inflation_plus" ? "Adj %" : "Rate %"}</label>
        <input type="number" class="ess-growth-val pot-inline-input" step="0.1"
          value="${pot.growthMode === "inflation_plus" ? (pot.growthAdj ?? 0) : (pot.growthMode === "inflation" || !pot.growthMode ? getInflationPct() : (pot.growthCustom ?? 0))}"
          ${(!pot.growthMode || pot.growthMode === "inflation") ? "readonly" : ""}>
      </div>
      <span class="field-hint ess-growth-hint" style="align-self:flex-end;padding-bottom:8px;">${
        pot.growthMode === "inflation_plus" ? ("→ " + (getInflationPct() + (Number(pot.growthAdj)||0)).toFixed(1) + "%") :
        (pot.growthMode === "inflation" || !pot.growthMode) ? (getInflationPct().toFixed(1) + "%") : ""
      }</span>
    </div>
    <div class="pot-chart-wrap" id="potChart-${pot.id}"></div>`;
  const refresh = () => {
    autoSave();
    drawSpendStackChart();
    drawPotChart(pot.id);
    updateSpendGaugeOnly();
  };
  el.querySelector(".ess-amount")?.addEventListener("input", e => {
    pot.amountAnnual = toAnnual(parseFloat(e.target.value) || 0);
    refresh();
  });
  el.querySelector(".ess-from")?.addEventListener("change", e => { pot.fromYear = parseInt(e.target.value, 10); refresh(); });
  el.querySelector(".ess-to")?.addEventListener("change", e => { pot.toYear = parseInt(e.target.value, 10); refresh(); });
  const syncEssGrowth = () => {
    const mode = el.querySelector(".ess-growth-mode")?.value || "inflation";
    pot.growthMode = mode;
    pot.inflate = mode === "inflation" || mode === "inflation_plus";
    const raw = parseFloat(el.querySelector(".ess-growth-val")?.value);
    if (mode === "other") pot.growthCustom = isFinite(raw) ? raw : 0;
    if (mode === "inflation_plus") pot.growthAdj = isFinite(raw) ? raw : 0;
    const gv = el.querySelector(".ess-growth-val");
    if (gv) {
      gv.readOnly = (mode === "inflation");
      if (mode === "inflation") gv.value = String(getInflationPct());
    }
    const hint = el.querySelector(".ess-growth-hint");
    if (hint) {
      if (mode === "inflation_plus") hint.textContent = "→ " + (getInflationPct() + (isFinite(raw) ? raw : 0)).toFixed(1) + "%";
      else if (mode === "inflation") hint.textContent = getInflationPct().toFixed(1) + "%";
      else hint.textContent = "";
    }
    refresh();
  };
  el.querySelector(".ess-growth-mode")?.addEventListener("change", syncEssGrowth);
  el.querySelector(".ess-growth-val")?.addEventListener("change", syncEssGrowth);
  drawPotChart(pot.id);
}

function renderOneOffList() {
  ensureSpend();
  const el = document.getElementById("spOneOffList");
  if (!el) return;
  const years = getPlanYears();
  const list = currentPlan.spend.oneOffs || [];
  if (!list.length) {
    el.innerHTML = `<p class="field-hint">No one-off spends yet.</p>`;
    return;
  }
  el.innerHTML = list.map(o => `
    <div class="oneoff-row" data-id="${o.id}">
      <input type="text" class="oo-name" value="${escapeHtml(o.name || "")}" placeholder="Name">
      <input type="number" class="oo-year" value="${o.year}" min="${years[0]}" max="${years[years.length-1]}" title="Year">
      <input type="number" class="oo-month" value="${o.month || 1}" min="1" max="12" title="Month">
      <input type="number" class="oo-amount" value="${o.amount || 0}" step="100" title="Amount £">
      <button type="button" class="btn-secondary oo-del" style="color:#DC2626;">Remove</button>
    </div>`).join("");
  el.querySelectorAll(".oneoff-row").forEach(row => {
    const id = row.dataset.id;
    const get = () => currentPlan.spend.oneOffs.find(x => x.id === id);
    const save = () => { autoSave(); updateSpendGaugeOnly(); };
    row.querySelector(".oo-name")?.addEventListener("input", e => { const o = get(); if (o) { o.name = e.target.value; save(); } });
    row.querySelector(".oo-year")?.addEventListener("change", e => { const o = get(); if (o) { o.year = parseInt(e.target.value, 10); save(); } });
    row.querySelector(".oo-month")?.addEventListener("change", e => { const o = get(); if (o) { o.month = parseInt(e.target.value, 10); save(); } });
    row.querySelector(".oo-amount")?.addEventListener("input", e => { const o = get(); if (o) { o.amount = parseFloat(e.target.value) || 0; save(); } });
    row.querySelector(".oo-del")?.addEventListener("click", async () => {
      if (!(await appConfirmYesNo("Remove this one-off spend?"))) return;
      currentPlan.spend.oneOffs = currentPlan.spend.oneOffs.filter(x => x.id !== id);
      autoSave();
      renderOneOffList();
      updateSpendGaugeOnly();
    });
  });
}

function renderPotsList() {
  ensureSpend();
  const el = document.getElementById("spPotsList");
  if (!el) return;
  const years = getPlanYears();
  const pots = (currentPlan.spend.pots || []).filter(p => !p.isEssential);

  el.innerHTML = pots.map(p => `
    <div class="collapse-section open pot-section" data-pot="${p.id}" style="margin-bottom:10px;">
      <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
        <span style="display:flex;align-items:center;gap:8px;">
          <span class="legend-swatch" style="background:${p.color}"></span>
          ${escapeHtml(p.name) || "Spend pot"} · ${formatMoney(toMonthly(p.amountAnnual))}/mo
          ${p.isEssential ? '<span class="badge" style="margin-left:6px;">Essential</span>' : ""}
        </span>
        <span class="collapse-chevron">▾</span>
      </button>
      <div class="collapse-body">
        <div class="pot-controls" data-id="${p.id}">
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="pot-name" value="${escapeHtml(p.name)}" ${p.isEssential ? "readonly" : ""}>
          </div>
          <div class="form-group">
            <label>Base amount (£ / month)</label>
            <input type="number" class="pot-amount" value="${Math.round(toMonthly(p.amountAnnual) * 100) / 100}" step="10">
          </div>
          <div class="form-group">
            <label>From year</label>
            <input type="number" class="pot-from" value="${p.fromYear}" min="${years[0]}" max="${years[years.length-1]}">
          </div>
          <div class="form-group">
            <label>To year</label>
            <input type="number" class="pot-to" value="${p.toYear}" min="${years[0]}" max="${years[years.length-1]}">
          </div>
          <div class="form-group">
            <label>Colour</label>
            <input type="color" class="pot-color" value="${p.color || "#94A3B8"}">
          </div>
          <div class="form-group" style="margin:0;min-width:140px;">
            <label>Growth</label>
            <select class="pot-growth-mode pot-inline-select">
              <option value="inflation" ${(!p.growthMode || p.growthMode === "inflation") ? "selected" : ""}>Inflation</option>
              <option value="other" ${p.growthMode === "other" || p.growthMode === "custom" ? "selected" : ""}>Other rate</option>
              <option value="inflation_plus" ${p.growthMode === "inflation_plus" ? "selected" : ""}>Inflation adjusted</option>
              <option value="custom" disabled>Custom</option>
            </select>
          </div>
          <div class="form-group" style="margin:0;min-width:70px;">
            <label>${p.growthMode === "inflation_plus" ? "Adj %" : "Rate %"}</label>
            <input type="number" class="pot-growth-val pot-inline-input" step="0.1"
              value="${p.growthMode === "inflation_plus" ? (p.growthAdj ?? 0) : (p.growthMode === "inflation" || !p.growthMode ? getInflationPct() : (p.growthCustom ?? 0))}"
              ${(!p.growthMode || p.growthMode === "inflation") ? "readonly" : ""}>
          </div>
          <span class="field-hint pot-growth-hint" style="align-self:flex-end;padding-bottom:8px;">${
            p.growthMode === "inflation_plus" ? ("→ " + (getInflationPct() + (Number(p.growthAdj)||0)).toFixed(1) + "%") :
            (p.growthMode === "inflation" || !p.growthMode) ? (getInflationPct().toFixed(1) + "%") : ""
          }</span>
          <button type="button" class="btn-secondary pot-reset" title="Clear year overrides">Reset</button>
          ${p.isEssential ? "" : '<button type="button" class="btn-secondary pot-del" style="color:#DC2626;border-color:#FECACA;">Remove</button>'}
        </div>
        <div class="pot-chart-wrap" id="potChart-${p.id}"></div>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".pot-controls").forEach(row => {
    const id = row.dataset.id;
    const pot = () => currentPlan.spend.pots.find(x => x.id === id);
    const refresh = () => {
      autoSave();
      drawSpendStackChart();
      drawPotChart(id);
      updateSpendGaugeOnly();
    };

    row.querySelector(".pot-name")?.addEventListener("input", e => { const p = pot(); if (p && !p.isEssential) { p.name = e.target.value; refresh(); } });
    row.querySelector(".pot-amount")?.addEventListener("input", e => { const p = pot(); if (p) { p.amountAnnual = toAnnual(parseFloat(e.target.value) || 0); refresh(); } });
    row.querySelector(".pot-from")?.addEventListener("change", e => { const p = pot(); if (p) { p.fromYear = parseInt(e.target.value, 10); refresh(); } });
    row.querySelector(".pot-to")?.addEventListener("change", e => { const p = pot(); if (p) { p.toYear = parseInt(e.target.value, 10); refresh(); } });
    row.querySelector(".pot-color")?.addEventListener("input", e => { const p = pot(); if (p) { p.color = e.target.value; refresh(); renderPotsList(); } });
    const syncPotGrowth = () => {
      const p = pot(); if (!p) return;
      const mode = row.querySelector(".pot-growth-mode")?.value || "inflation";
      p.growthMode = mode;
      p.inflate = mode === "inflation" || mode === "inflation_plus";
      const raw = parseFloat(row.querySelector(".pot-growth-val")?.value);
      if (mode === "other") p.growthCustom = isFinite(raw) ? raw : 0;
      if (mode === "inflation_plus") p.growthAdj = isFinite(raw) ? raw : 0;
      const gv = row.querySelector(".pot-growth-val");
      if (gv) {
        gv.readOnly = mode === "inflation";
        if (mode === "inflation") gv.value = String(getInflationPct());
      }
      const hint = row.querySelector(".pot-growth-hint");
      if (hint) {
        if (mode === "inflation_plus") hint.textContent = "→ " + (getInflationPct() + (isFinite(raw) ? raw : 0)).toFixed(1) + "%";
        else if (mode === "inflation") hint.textContent = getInflationPct().toFixed(1) + "%";
        else hint.textContent = "";
      }
      refresh();
    };
    row.querySelector(".pot-growth-mode")?.addEventListener("change", syncPotGrowth);
    row.querySelector(".pot-growth-val")?.addEventListener("change", syncPotGrowth);
    row.querySelector(".pot-reset")?.addEventListener("click", async () => {
      if (!(await appConfirmYesNo("Reset this pot's year overrides back to the base amount?"))) return;
      const p = pot();
      if (p) { p.overrides = {}; refresh(); }
    });
    row.querySelector(".pot-del")?.addEventListener("click", async () => {
      if (!(await appConfirmYesNo("Remove this spend pot? This cannot be undone."))) return;
      currentPlan.spend.pots = currentPlan.spend.pots.filter(x => x.id !== id);
      autoSave();
      renderPotsList();
      drawSpendStackChart();
      updateSpendGaugeOnly();
    });
  });

  pots.forEach(p => drawPotChart(p.id));
}

function drawPotChart(potId) {
  const wrap = document.getElementById("potChart-" + potId);
  const pot = currentPlan.spend.pots.find(p => p.id === potId);
  if (!wrap || !pot) return;

  const years = getPlanYears();
  const values = years.map(y => toMonthly(getPotDisplayForYear(pot, y)));
  const maxV = Math.max(...values, 50) * 1.2;
  const left = 52, bottom = 52, top = 10;
  const w = 860, h = 190;
  const innerH = h - bottom - top;
  const step = years.length > 1 ? (w - left - 8) / (years.length - 1) : w - left;
  const yOf = (v) => top + innerH - (v / maxV) * innerH;

  let path = "", markers = "", grid = "";
  const pts = values.map((v, i) => {
    const x = left + i * step;
    const y = yOf(v);
    return { x, y, i, v };
  });
  path = `<path d="M ${pts.map(p => `${p.x},${p.y}`).join(" L ")}" fill="none" stroke="${pot.color}" stroke-width="2.5"/>`;
  pts.forEach(p => {
    const isOver = pot.overrides && pot.overrides[years[p.i]] !== undefined;
    const active = years[p.i] >= pot.fromYear && years[p.i] <= pot.toYear;
    if (!active) return;
    markers += `<circle class="pot-handle" data-pot="${potId}" data-idx="${p.i}" data-year="${years[p.i]}" cx="${p.x}" cy="${p.y}" r="6" fill="${isOver ? "#F97316" : pot.color}" stroke="#fff" stroke-width="2" style="cursor:ns-resize"/>`;
  });
  for (let i = 0; i <= 3; i++) {
    const val = maxV - (maxV / 3) * i;
    const y = top + (innerH / 3) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 4}" y="${y + 3}" text-anchor="end" class="scale-label">${label}</text>`;
  }
  let xLabels = "";
  years.forEach((y, i) => {
    const show = i === 0 || i === years.length - 1 || y % 5 === 0;
    if (!show) return;
    const x = left + i * step;
    xLabels += `<text x="${x}" y="${h - 2}" text-anchor="end" class="scale-label year-label" transform="rotate(-35 ${x} ${h - 2})">${y}</text>`;
  });

  wrap.innerHTML = `
    <svg class="pot-svg" data-pot="${potId}" width="100%" height="185" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${grid}${path}${markers}${xLabels}
    </svg>
  `;

  const svg = wrap.querySelector("svg");

  function eventToSvg(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  function valueFromSvgY(svgY) {
    const clamped = Math.max(top, Math.min(top + innerH, svgY));
    return maxV - ((clamped - top) / innerH) * maxV;
  }

  // Invert display value → stored base (today's money)
  function displayToStored(displayVal, year) {
    const start = currentPlan.scale.startYear;
    const rate = currentPlan.spend.inflationRate || 0.025;
    const yp = Math.max(0, year - start);
    if (currentPlan.spend.showInflation) {
      return pot.inflate ? displayVal / Math.pow(1 + rate, yp) : displayVal;
    }
    return pot.inflate ? displayVal : displayVal * Math.pow(1 + rate, yp);
  }

  svg.querySelectorAll(".pot-handle").forEach(handle => {
    handle.addEventListener("mouseenter", () => {
      const tip = document.getElementById("graphTooltip") || createGraphTooltip();
      const yr = handle.dataset.year;
      const val = values[parseInt(handle.dataset.idx, 10)];
      tip.textContent = `${yr}: £${Math.round(val).toLocaleString()}/mo`;
      tip.style.display = "block";
    });
    handle.addEventListener("mousemove", e => {
      const tip = document.getElementById("graphTooltip");
      if (tip) { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
    });
    handle.addEventListener("mouseleave", () => {
      const tip = document.getElementById("graphTooltip");
      if (tip) tip.style.display = "none";
    });
    handle.addEventListener("dblclick", e => {
      e.preventDefault();
      const year = parseInt(handle.dataset.year, 10);
      const current = toMonthly(pot.overrides[year] !== undefined ? pot.overrides[year] : pot.amountAnnual);
      const entered = prompt(`Value for ${year} (£ / month, today's money):`, String(Math.round(current * 100) / 100));
      if (entered === null) return;
      const num = parseFloat(entered);
      if (isNaN(num)) return;
      pot.overrides[year] = toAnnual(num);
      autoSave();
      drawPotChart(potId);
      drawSpendStackChart();
    });
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      const year = parseInt(handle.dataset.year, 10);

      const onMove = (ev) => {
        const { y: svgY } = eventToSvg(ev);
        const displayValMo = Math.max(0, valueFromSvgY(svgY));
        const storedAnnual = Math.round(displayToStored(toAnnual(displayValMo), year));
        pot.overrides[year] = storedAnnual;

        const showMo = toMonthly(getPotDisplayForYear(pot, year));
        handle.setAttribute("cy", yOf(showMo));
        handle.setAttribute("fill", "#F97316");

        const tip = document.getElementById("graphTooltip") || createGraphTooltip();
        tip.textContent = `${year}: £${Math.round(showMo).toLocaleString()}/mo`;
        tip.style.display = "block";
        tip.style.left = (ev.clientX + 12) + "px";
        tip.style.top = (ev.clientY - 28) + "px";
      };
      const onUp = () => {
        autoSave();
        drawPotChart(potId);
        drawSpendStackChart();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

function createGraphTooltip() {
  const tip = document.createElement("div");
  tip.id = "graphTooltip";
  tip.style.cssText = "position:fixed;display:none;background:#0F172A;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;pointer-events:none;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);";
  document.body.appendChild(tip);
  return tip;
}

// Multi-select nodes on non-essential chart
window._selectedYears = window._selectedYears || new Set();
window._lastSelectedYear = null;
window._wheelMode = window._wheelMode || "value"; // value | band

function isMultiSelectEnabled() {
  return !!(currentPlan.settings && currentPlan.settings.multiNodeSelect);
}

function drawTargetChart(wrapId) {
  ensureSpend();
  const wrap = document.getElementById(wrapId || "targetChartWrap")
    || document.getElementById("bubbleTargetChartWrap")
    || document.getElementById("dashTargetChartWrap")
    || document.getElementById("targetChartWrap");
  if (!wrap) return;
  const years = getPlanYears();
  const sp = currentPlan.spend;

  // Display NES monthly (real or nominal per toggle) — engine still uses nominal
  const targets = years.map(y => toMonthly(getNonEssentialDisplayForYear(y)));
  const mins = years.map(y => toMonthly(getMinForYear(y)));
  const maxs = years.map(y => toMonthly(getMaxForYear(y)));

  // Values are already in the active display space
  const inflateVal = (v) => v;
  const deflateVal = (v) => v;

  const tShow = targets;
  const minShow = mins;
  const maxShow = maxs;

  const allVals = [...tShow, ...minShow, ...maxShow, 0];
  // Keep a stable scale; only expand if values exceed it
  if (!window._targetScaleMax || window._targetScaleMax < Math.max(...allVals, 1) * 1.05) {
    window._targetScaleMax = Math.max(...allVals, 100) * 1.2;
  }
  if (!window._targetDragging) {
    // Always leave headroom so a flat zero NES line is still visible
    window._targetScaleMax = Math.max(...allVals, 50) * 1.2;
  }
  const maxV = window._targetScaleMax || 60;
  const minV = 0;
  const range = maxV - minV || 1;
  const compact = wrap.classList.contains("compact") || wrap.id === "dashTargetChartWrap";
  const left = 52, bottom = compact ? 72 : 70, top = 12;
  const w = compact ? 640 : 920, h = compact ? 220 : 280;
  const innerH = h - bottom - top;
  const step = years.length > 1 ? (w - left - 10) / (years.length - 1) : w - left;

  const yOf = (v) => top + innerH - ((v - minV) / range) * innerH;
  const linePath = (vals, color, width) => {
    const pts = vals.map((v, i) => `${left + i * step},${yOf(v)}`);
    return `<path class="line-${color.replace("#","")}" d="M ${pts.join(" L ")}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  };
  const makeMarkers = (vals, kind, color, overKey) => vals.map((v, i) => {
    const isOver = isUserTouched(years[i]);
    // Selection ring only on editable NES charts (not dashboard view-only)
    const showSel = !wrap.classList.contains("compact") && wrap.id !== "dashTargetChartWrap"
      && window._selectedYears && window._selectedYears.has(years[i]);
    const fill = isOver ? "#F97316" : color;
    const stroke = showSel ? "#1D4ED8" : "#fff";
    const sw = showSel ? 3 : 2;
    const r = showSel ? 7 : 6;
    return `<circle class="target-handle${showSel ? " is-selected" : ""}" data-kind="${kind}" data-idx="${i}" data-year="${years[i]}" cx="${left + i * step}" cy="${yOf(v)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" style="cursor:ns-resize"/>
      <circle class="target-handle-hit" data-kind="${kind}" data-idx="${i}" data-year="${years[i]}" cx="${left + i * step}" cy="${yOf(v)}" r="14" fill="transparent" style="cursor:ns-resize"/>`;
  }).join("");

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = maxV - (range / 4) * i;
    const y = top + (innerH / 4) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 6}" y="${y + 4}" text-anchor="end" class="scale-label">${label}</text>`;
  }
  let xLabels = "";
  years.forEach((y, i) => {
    const x = left + i * step;
    xLabels += `<text x="${x}" y="${h - 6}" text-anchor="end" class="scale-label year-label" transform="rotate(-45 ${x} ${h - 6})">${y}</text>`;
  });

  // Band area path
  let bandPath = "";
  if (maxShow.length) {
    const topPts = maxShow.map((v, i) => `${left + i * step},${yOf(v)}`).join(" L ");
    const botPts = minShow.map((v, i) => `${left + i * step},${yOf(v)}`).reverse().join(" L ");
    bandPath = `<path d="M ${topPts} L ${botPts} Z" fill="${getThemeColor("spend")}" opacity="0.15"/>`;
  }

  const svgId = "targetSvg_" + (wrap.id || "main");
  wrap.innerHTML = `
    <svg id="${svgId}" width="100%" height="${h + 8}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      ${bandPath}
      ${linePath(tShow, getThemeColor("spend"), 2.8)}
      ${makeMarkers(tShow, "target", getThemeColor("spend"), "targetOverrides")}
      ${xLabels}
    </svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:${getThemeColor("spend")}"></span>NES / mo</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${getThemeColor("spend")};opacity:0.3"></span>±band (default ${Math.round(getBandPct()*100)}%)</span>
    </div>
  `;

  const svg = document.getElementById(svgId);
  if (!svg) return;
  const activeWrapId = wrap.id || "targetChartWrap";
  // Dashboard chart is always view-only; edit via double-click bubble
  const dashReadOnly = activeWrapId === "dashTargetChartWrap";
  if (!window._targetDragging) {
    animateSvgPaths(svg, 600);
    fadeInChartCard(wrap);
  }

  // Convert client mouse position → SVG user coordinates (handles scaling correctly)
  function clientToSvgY(clientY) {
    const pt = svg.createSVGPoint();
    pt.x = 0;
    pt.y = clientY;
    // Use a point at the same screen X as the SVG origin for Y-only mapping
    const ctm = svg.getScreenCTM();
    if (!ctm) return top + innerH / 2;
    const inv = ctm.inverse();
    // Map client (0, clientY) is wrong; need actual client X too — use event
    return null; // filled by caller with both coords
  }

  function eventToSvg(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  function valueFromSvgY(svgY) {
    const clamped = Math.max(top, Math.min(top + innerH, svgY));
    return maxV - ((clamped - top) / innerH) * range;
  }

  function refreshTargetUI() {
    autoSave();
    drawTargetChart(activeWrapId);
    const g = document.getElementById("spGaugeWrap") || document.getElementById("bubbleGaugeWrap") || document.getElementById("dashGaugeWrap");
    if (g) {
      g.innerHTML = renderBalanceGauge();
      if (typeof animateGaugeNeedles === "function") animateGaugeNeedles(g);
    }
    // Keep dashboard metric status in sync when editing targets / solve
    if (typeof refreshDashboardBalanceStatus === "function") refreshDashboardBalanceStatus();
  }

  function setYearMonthlyValue(year, monthlyDisplay) {
    // monthlyDisplay is in the current view (real or nominal). Store REAL target.
    const ratio = getModelRatio() || 1;
    ensureSpend();
    if (!sp.targetOverrides) sp.targetOverrides = {};
    let realAnnual = toAnnual(Math.max(0, monthlyDisplay));
    if (sp.showInflation) {
      // User edited nominal — convert back to today's money for storage
      realAnnual = realAnnual / inflationFactor(year);
    }
    sp.targetOverrides[year] = Math.round(realAnnual / ratio);
    markUserTouch(year);
  }

  function openNodeMenu(year, anchorEl) {
    document.getElementById("nodeEditPop")?.remove();
    let yearsList = [year];
    // Multi-edit whenever more than one year is selected and the double-clicked year is in the set
    // (do not require multiNodeSelect for the menu itself — selection may already exist)
    if (window._selectedYears && window._selectedYears.size > 1 && window._selectedYears.has(year)) {
      yearsList = [...window._selectedYears].sort((a, b) => a - b);
    }
    const curMo = Math.round(toMonthly(getNonEssentialDisplayForYear(year)) * 100) / 100;
    const curBand = Math.round(getBandPctForYear(year) * 1000) / 10;
    const multi = yearsList.length > 1;
    const pop = document.createElement("div");
    pop.id = "nodeEditPop";
    pop.className = "node-edit-pop";
    const title = multi ? `${yearsList.length} years (${yearsList[0]}–${yearsList[yearsList.length - 1]})` : String(year);
    pop.innerHTML = `
      <div class="node-edit-title">${title}</div>
      <div class="node-edit-row">
        <label class="node-edit-lab">Value (£/mo)${multi ? " → all" : ""}</label>
        <input type="number" id="nodeEditVal" step="1" value="${curMo}">
      </div>
      <div class="node-edit-row">
        <label class="node-edit-lab">Bandwidth %</label>
        <input type="number" id="nodeEditBand" step="0.5" value="${curBand}">
      </div>
      ${multi ? `<p class="field-hint" style="margin:0 0 8px;">Apply sets the same value on every selected year. Use <strong>Blend</strong> on the toolbar to taper between two anchors.</p>` : ""}
      <div class="node-edit-actions">
        <button type="button" class="btn-primary btn-sm" id="nodeEditApply">Apply</button>
        <button type="button" class="btn-secondary btn-sm" id="nodeEditReset">Reset</button>
        <button type="button" class="btn-secondary btn-sm" id="nodeEditClose">✕</button>
      </div>
    `;
    document.body.appendChild(pop);
    const place = () => {
      const r = (anchorEl || svg).getBoundingClientRect();
      pop.style.left = Math.min(window.innerWidth - 260, Math.max(8, r.left + r.width / 2 - 110)) + "px";
      pop.style.top = Math.min(window.innerHeight - 220, r.bottom + 8) + "px";
    };
    place();
    pop.querySelector("#nodeEditClose").onclick = () => pop.remove();
    pop.querySelector("#nodeEditReset").onclick = () => {
      yearsList.forEach(y => {
        if (sp.targetOverrides) delete sp.targetOverrides[y];
        if (sp.bandOverrides) delete sp.bandOverrides[y];
        if (sp.userTouched) delete sp.userTouched[y];
      });
      pop.remove();
      refreshTargetUI();
    };
    pop.querySelector("#nodeEditApply").onclick = () => {
      const n = parseFloat(pop.querySelector("#nodeEditVal").value);
      const b = parseFloat(pop.querySelector("#nodeEditBand").value);
      yearsList.forEach(y => {
        if (!isNaN(n)) setYearMonthlyValue(y, n);
        if (!isNaN(b)) {
          if (!sp.bandOverrides) sp.bandOverrides = {};
          sp.bandOverrides[y] = Math.max(0, b) / 100;
          markUserTouch(y);
        }
      });
      pop.remove();
      refreshTargetUI();
    };
    pop.querySelector("#nodeEditVal").focus();
    const onDoc = (ev) => {
      if (!pop.contains(ev.target) && ev.target !== anchorEl) {
        pop.remove();
        document.removeEventListener("mousedown", onDoc);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  }

  /** Fill years between two anchor years with a linear or ease curve of display monthly values */
  window.blendNesBetweenAnchors = function blendNesBetweenAnchors(mode) {
    ensureSpend();
    const sel = window._selectedYears ? [...window._selectedYears].sort((a, b) => a - b) : [];
    if (sel.length < 2) {
      alert("Select at least two years (use Shift or Ctrl), then Blend.");
      return;
    }
    const y0 = sel[0];
    const y1 = sel[sel.length - 1];
    const v0 = toMonthly(getNonEssentialDisplayForYear(y0));
    const v1 = toMonthly(getNonEssentialDisplayForYear(y1));
    const span = y1 - y0 || 1;
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / span;
      let tt = t;
      if (mode === "ease") {
        // smoothstep
        tt = t * t * (3 - 2 * t);
      }
      const v = v0 + (v1 - v0) * tt;
      setYearMonthlyValue(y, Math.max(0, Math.round(v * 100) / 100));
      window._selectedYears.add(y);
    }
    refreshTargetUI();
  };

  // Prevent page scroll while pointer is over this chart
  svg.addEventListener("wheel", e => {
    e.preventDefault();
  }, { passive: false });

  const bindHandle = (handle) => {
    // Prefer visible handle for feedback; hits use same year
    if (dashReadOnly) {
      handle.style.cursor = "default";
      handle.addEventListener("mouseenter", () => {
        const tip = document.getElementById("graphTooltip") || createGraphTooltip();
        const idx = parseInt(handle.dataset.idx, 10);
        const year = handle.dataset.year;
        const val = tShow[idx];
        tip.textContent = `${year}: £${Math.round(val).toLocaleString()}/mo (view only — double-click this panel to edit)`;
        tip.style.display = "block";
      });
      handle.addEventListener("mousemove", e => {
        const tip = document.getElementById("graphTooltip");
        if (tip) { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
      });
      handle.addEventListener("mouseleave", () => {
        const tip = document.getElementById("graphTooltip");
        if (tip) tip.style.display = "none";
      });
      return;
    }
    handle.addEventListener("mouseenter", () => {
      const tip = document.getElementById("graphTooltip") || createGraphTooltip();
      const idx = parseInt(handle.dataset.idx, 10);
      const year = handle.dataset.year;
      const val = tShow[idx];
      const band = Math.round(getBandPctForYear(parseInt(year, 10)) * 100);
      const sel = window._selectedYears && window._selectedYears.has(parseInt(year, 10));
      tip.textContent = sel
        ? `${year}: £${Math.round(val).toLocaleString()}/mo · ±${band}% · selected · wheel/drag to adjust`
        : `${year}: £${Math.round(val).toLocaleString()}/mo · click to select · double-click to edit`;
      tip.style.display = "block";
    });
    handle.addEventListener("mousemove", e => {
      const tip = document.getElementById("graphTooltip");
      if (tip) { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
    });
    handle.addEventListener("mouseleave", () => {
      const tip = document.getElementById("graphTooltip");
      if (tip) tip.style.display = "none";
    });

    handle.addEventListener("wheel", e => {
      e.preventDefault();
      e.stopPropagation();
      const year = parseInt(handle.dataset.year, 10);
      // Only adjust highlighted/selected nodes — not mere hover
      if (!window._selectedYears) window._selectedYears = new Set();
      if (!window._selectedYears.has(year)) {
        const tip = document.getElementById("graphTooltip") || createGraphTooltip();
        tip.textContent = `${year}: click to select, then wheel to adjust`;
        tip.style.display = "block";
        tip.style.left = (e.clientX + 12) + "px";
        tip.style.top = (e.clientY - 28) + "px";
        return;
      }
      const step = getWheelIncrement();
      const delta = e.deltaY < 0 ? step : -step;
      const mode = e.altKey ? "band" : (window._wheelMode || "value");
      let yearsToEdit = [...window._selectedYears];
      if (!yearsToEdit.length) yearsToEdit = [year];
      yearsToEdit.forEach(y => {
        if (mode === "band") {
          if (!sp.bandOverrides) sp.bandOverrides = {};
          const curB = getBandPctForYear(y) * 100;
          const bandStep = getWheelBandIncrement();
          const dir = e.deltaY < 0 ? 1 : -1;
          const next = Math.max(0, Math.min(80, curB + dir * bandStep));
          sp.bandOverrides[y] = next / 100;
          markUserTouch(y);
        } else {
          const cur = Math.round(toMonthly(getNonEssentialDisplayForYear(y)));
          setYearMonthlyValue(y, Math.max(0, Math.round((cur + delta) * 100) / 100));
        }
      });
      const nonEssMo = toMonthly(getNonEssentialDisplayForYear(year));
      handle.setAttribute("cy", yOf(inflateVal(nonEssMo, year)));
      handle.setAttribute("fill", "#F97316");
      const tip = document.getElementById("graphTooltip") || createGraphTooltip();
      const band = Math.round(getBandPctForYear(year) * 1000) / 10;
      tip.textContent = mode === "band"
        ? `${yearsToEdit.length > 1 ? yearsToEdit.length + " yrs" : year}: band ±${band}% (Alt+wheel)`
        : `${yearsToEdit.length > 1 ? yearsToEdit.length + " yrs · " : ""}${year}: £${Math.round(nonEssMo).toLocaleString()}/mo`;
      tip.style.display = "block";
      clearTimeout(window._wheelSaveT);
      window._wheelSaveT = setTimeout(() => refreshTargetUI(), 280);
    }, { passive: false });

    handle.addEventListener("mousedown", e => {
      e.stopPropagation();
      const year = parseInt(handle.dataset.year, 10);
      if (!window._selectedYears) window._selectedYears = new Set();

      // Selection: Ctrl/Cmd toggle, Shift range (when multi on), plain click = only this node
      if (e.shiftKey && isMultiSelectEnabled() && window._lastSelectedYear != null) {
        e.preventDefault();
        const a = years.indexOf(window._lastSelectedYear);
        const b = years.indexOf(year);
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          for (let i = lo; i <= hi; i++) window._selectedYears.add(years[i]);
        }
        window._lastSelectedYear = year;
        refreshTargetUI();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && isMultiSelectEnabled()) {
        e.preventDefault();
        if (window._selectedYears.has(year)) window._selectedYears.delete(year);
        else window._selectedYears.add(year);
        window._lastSelectedYear = year;
        refreshTargetUI();
        return;
      }
      // Plain click / drag start: select this node only (unless already part of multi group and dragging)
      if (!window._selectedYears.has(year) || !isMultiSelectEnabled() || window._selectedYears.size <= 1) {
        window._selectedYears = new Set([year]);
        window._lastSelectedYear = year;
      }

      const startY = e.clientY;
      const startX = e.clientX;
      let dragging = false;
      const dragYears = (window._selectedYears.has(year) && window._selectedYears.size > 1)
        ? [...window._selectedYears]
        : [year];
      const startVals = {};
      dragYears.forEach(y => { startVals[y] = toMonthly(getNonEssentialDisplayForYear(y)); });

      const onMove = (ev) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 5 && Math.abs(ev.clientX - startX) < 5) return;
          dragging = true;
          window._targetDragging = true;
        }
        const { y: svgY } = eventToSvg(ev);
        let displayVal = Math.max(0, valueFromSvgY(svgY));
        let todayVal = Math.round(deflateVal(displayVal, year));
        const deltaMo = todayVal - startVals[year];
        dragYears.forEach(y => {
          setYearMonthlyValue(y, Math.max(0, Math.round((startVals[y] + deltaMo) * 100) / 100));
        });
        const nonEssMo = toMonthly(getNonEssentialDisplayForYear(year));
        handle.setAttribute("cy", yOf(inflateVal(nonEssMo, year)));
        handle.setAttribute("fill", "#F97316");
        const tip = document.getElementById("graphTooltip") || createGraphTooltip();
        tip.textContent = `${dragYears.length > 1 ? dragYears.length + " years · " : ""}${year}: £${Math.round(nonEssMo).toLocaleString()}/mo`;
        tip.style.display = "block";
        tip.style.left = (ev.clientX + 12) + "px";
        tip.style.top = (ev.clientY - 28) + "px";
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window._targetDragging = false;
        if (!dragging) {
          const now = Date.now();
          if (window._nodeClickYear === year && now - (window._nodeClickAt || 0) < 400) {
            // Double-click — keep multi-selection if this year is part of it
            window._nodeClickYear = null;
            openNodeMenu(year, handle);
          } else {
            window._nodeClickYear = year;
            window._nodeClickAt = now;
            window._selectedYears = window._selectedYears || new Set();
            // Only collapse selection when clicking a node that is NOT already selected
            // (preserves multi-select through the first click of a double-click)
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
              if (!window._selectedYears.has(year)) {
                window._selectedYears = new Set([year]);
                window._lastSelectedYear = year;
              }
            }
            refreshTargetUI();
          }
          return;
        }
        refreshTargetUI();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  };

  svg.querySelectorAll(".target-handle, .target-handle-hit").forEach(el => bindHandle(el));
}

function getSpendStackLayers() {
  ensureSpend();
  const years = getPlanYears();
  const sp = currentPlan.spend;
  // Stack order (bottom → top): Essential, other pots, One-offs, Non Essential Spend
  const essential = (sp.pots || []).find(p => p.isEssential);
  const otherPots = (sp.pots || []).filter(p => !p.isEssential);
  const layers = [];
  if (essential) {
    layers.push({
      name: essential.name || "Essential",
      color: essential.color || "#94A3B8",
      values: years.map(y => toMonthly(getPotDisplayForYear(essential, y)))
    });
  }
  otherPots.forEach(p => {
    layers.push({
      name: p.name,
      color: p.color || "#94A3B8",
      values: years.map(y => toMonthly(getPotDisplayForYear(p, y)))
    });
  });
  const oneOffs = years.map(y => {
    const list = (sp.oneOffs || []).filter(o => Number(o.year) === Number(y));
    return toMonthly(list.reduce((s, o) => s + (Number(o.amount) || 0), 0));
  });
  if (oneOffs.some(v => v > 0)) {
    layers.push({ name: "One-offs", color: "#F87171", values: oneOffs });
  }
  layers.push({
    name: "Non Essential Spend",
    color: getThemeColor("spend"),
    values: years.map(y => toMonthly(getNonEssentialDisplayForYear(y)))
  });
  return { years, layers };
}

function setSpendStackMode(mode, which) {
  if (!currentPlan.settings) currentPlan.settings = {};
  currentPlan.settings.spendStackMode = mode === "line" ? "line" : "area";
  autoSave();
  if (which === "dash") {
    drawSpendStackChart("dashSpendStackInner", { compact: true });
    // update switch labels if present
    const wrap = document.getElementById("dashSpendStackWrap");
    if (wrap) {
      wrap.querySelectorAll(".mode-side").forEach((el, i) => {
        el.classList.toggle("active", mode === "area" ? i === 1 : i === 0);
      });
    }
  } else {
    drawSpendStackChart("spendChartWrap");
    const row = document.getElementById("spStackModeToggle");
    if (row) {
      document.querySelectorAll("#spStackModeRow .mode-side").forEach((el, i) => {
        el.classList.toggle("active", mode === "area" ? i === 1 : i === 0);
      });
    }
  }
}
window.setSpendStackMode = setSpendStackMode;

function drawSpendStackChart(wrapId, opts = {}) {
  ensureSpend();
  const wrap = document.getElementById(wrapId || "spendChartWrap");
  if (!wrap) return;
  const { years, layers } = getSpendStackLayers();
  if (!years.length) {
    wrap.innerHTML = `<div class="chart-placeholder"><div class="placeholder-text">No years in plan scale</div></div>`;
    return;
  }
  const mode = currentPlan.settings?.spendStackMode || "area";
  const compact = !!opts.compact;
  const n = years.length;
  const cum = layers.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    let running = 0;
    layers.forEach((layer, li) => {
      running += Math.max(0, layer.values[i] || 0);
      cum[li][i] = running;
    });
  }
  const totalMax = layers.length ? Math.max(...cum[cum.length - 1], 1) : 1;
  const lineMax = Math.max(...layers.flatMap(l => l.values), 1);
  const maxV = (mode === "line" ? lineMax : totalMax) * 1.08;
  const left = compact ? 48 : 56;
  const bottom = compact ? 28 : 40;
  const top = 12;
  const w = compact ? 440 : 920;
  const h = compact ? 180 : 280;
  const innerH = h - bottom - top;
  const step = n > 1 ? (w - left - 10) / (n - 1) : w - left;
  const yOf = (v) => top + innerH - (v / maxV) * innerH;

  let body = "";
  if (mode === "area") {
    for (let li = layers.length - 1; li >= 0; li--) {
      const topPts = [];
      const botPts = [];
      for (let i = 0; i < n; i++) {
        const x = left + i * step;
        topPts.push(`${x},${yOf(cum[li][i])}`);
        const bot = li === 0 ? 0 : cum[li - 1][i];
        botPts.unshift(`${x},${yOf(bot)}`);
      }
      body += `<path d="M ${topPts.join(" L ")} L ${botPts.join(" L ")} Z" fill="${layers[li].color}" opacity="0.88"/>`;
    }
  } else {
    layers.forEach(layer => {
      const pts = layer.values.map((v, i) => `${left + i * step},${yOf(Math.max(0, v || 0))}`).join(" L ");
      body += `<path d="M ${pts}" fill="none" stroke="${layer.color}" stroke-width="2"/>`;
    });
  }

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = maxV - (maxV / 4) * i;
    const y = top + (innerH / 4) * i;
    const label = val >= 1000 ? "£" + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + "k" : "£" + Math.round(val);
    grid += `<line x1="${left}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#F1F5F9"/>`;
    grid += `<text x="${left - 6}" y="${y + 4}" text-anchor="end" class="scale-label">${label}</text>`;
  }
  let xLabels = "";
  const every = compact ? Math.max(1, Math.ceil((n - 1) / 6)) : 1;
  years.forEach((y, i) => {
    if (!compact || i % every === 0 || i === n - 1) {
      const x = left + i * step;
      if (compact) {
        xLabels += `<text x="${x}" y="${h - 6}" text-anchor="middle" class="scale-label">${y}</text>`;
      } else {
        xLabels += `<text x="${x}" y="${h - 6}" text-anchor="end" class="scale-label year-label" transform="rotate(-45 ${x} ${h - 6})">${y}</text>`;
      }
    }
  });

  // Hover markers on total (area) or first layer points
  let markers = "";
  const hoverVals = mode === "area" && layers.length
    ? cum[cum.length - 1]
    : (layers[0] ? layers[0].values : []);
  hoverVals.forEach((v, i) => {
    markers += `<circle class="nw-hover-pt" data-name="${mode === "area" ? "Total spend" : (layers[0]?.name || "Spend")}" data-year="${years[i]}" data-val="${v}" cx="${left + i * step}" cy="${yOf(v)}" r="3" fill="#0F172A" stroke="#fff" stroke-width="1" opacity="0.85"/>`;
  });

  const legend = layers.map(l =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${l.color}"></span>${escapeHtml(l.name)}</span>`
  ).join("");

  wrap.innerHTML = `
    <svg width="100%" height="${compact ? 190 : 300}" viewBox="0 0 ${w} ${h}">
      ${grid}${body}${markers}${xLabels}
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
  if (typeof attachNwHover === "function") attachNwHover();
}
window.drawSpendStackChart = drawSpendStackChart;


// ---------- ASSUMPTIONS (defaults: inflation, tax, etc.) ----------
function defaultTaxBands() {
  // Illustrative UK-style bands (annual £) — user can edit
  return [
    { from: 0, to: 12570, rate: 0 },
    { from: 12570, to: 50270, rate: 20 },
    { from: 50270, to: 125140, rate: 40 },
    { from: 125140, to: null, rate: 45 }
  ];
}

function ensureAssumptions() {
  if (!currentPlan.assumptions) {
    currentPlan.assumptions = {
      inflationRate: 0.025,
      taxBands: defaultTaxBands(),
      niEmployeeRate: 8, // % illustrative
      niThreshold: 12570
    };
  }
  if (!currentPlan.assumptions.taxBands || currentPlan.assumptions.taxBands.length < 4) {
    currentPlan.assumptions.taxBands = defaultTaxBands();
  }
  if (currentPlan.assumptions.niEmployeeRate == null) currentPlan.assumptions.niEmployeeRate = 8;
  if (currentPlan.assumptions.niThreshold == null) currentPlan.assumptions.niThreshold = 12570;
  // State pension defaults (illustrative full new State Pension — edit as needed)
  if (!currentPlan.assumptions.statePension) {
    currentPlan.assumptions.statePension = {
      annualAmount: 11502, // ~2024/25 full new SP order of magnitude
      quoteYear: new Date().getFullYear(),
      growWithInflation: true,
      spaAge: 67
    };
  }
  return currentPlan.assumptions;
}

function renderAssumptionsPage() {
  const a = ensureAssumptions();
  ensureSpend();
  const infPct = ((currentPlan.spend?.inflationRate != null ? currentPlan.spend.inflationRate : a.inflationRate) * 100);
  const bands = a.taxBands;
  const bandRows = bands.map((b, i) => `
    <div class="tax-band-row" data-idx="${i}">
      <div class="form-group"><label>From (£)</label>
        <input type="number" class="tax-from" value="${b.from ?? 0}" step="10"></div>
      <div class="form-group"><label>To (£)</label>
        <input type="number" class="tax-to" value="${b.to == null ? "" : b.to}" placeholder="No limit" step="10"></div>
      <div class="form-group"><label>Rate (%)</label>
        <input type="number" class="tax-rate" value="${b.rate ?? 0}" step="0.1"></div>
    </div>`).join("");

  return `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Assumptions</h1>
          <p class="subtitle">Defaults that feed the model — inflation, tax and other rules</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="settings-card">
        <h3>Inflation</h3>
        <p class="settings-desc">Default annual inflation used for display and pots that rise with inflation.</p>
        <div class="form-group" style="max-width:200px;">
          <label>Inflation rate (% / year)</label>
          <input type="number" id="assumeInflation" value="${infPct}" step="0.1" min="0" max="20">
        </div>
      </div>

      <div class="settings-card" style="margin-top:16px;">
        <h3>Income tax bands</h3>
        <p class="settings-desc">Illustrative annual bands used when an income source is marked taxable. Not formal tax advice — edit to match your situation.</p>
        <div class="tax-band-grid">${bandRows}</div>
        <button type="button" class="btn-secondary" style="margin-top:10px;" onclick="resetTaxBands()">Reset to default bands</button>
      </div>

      <div class="settings-card" style="margin-top:16px;">
        <h3>National Insurance</h3>
        <p class="settings-desc">Simple employee NI rate applied above threshold (illustrative).</p>
        <div class="form-row" style="max-width:400px;">
          <div class="form-group">
            <label>Threshold (£ / year)</label>
            <input type="number" id="assumeNiThreshold" value="${a.niThreshold}" step="10">
          </div>
          <div class="form-group">
            <label>Employee rate (%)</label>
            <input type="number" id="assumeNiRate" value="${a.niEmployeeRate}" step="0.1">
          </div>
        </div>
      </div>

      <div class="settings-card" style="margin-top:16px;">
        <h3>State pension defaults</h3>
        <p class="settings-desc">Used by Income → State pension → “Populate from assumptions”. Not official forecasts — set the full amount you expect and the year that quote relates to. If grow-with-inflation is on, the figure is increased from the quote year to the income start date.</p>
        <div class="form-row" style="max-width:520px;flex-wrap:wrap;">
          <div class="form-group">
            <label>Full amount (£ / year)</label>
            <input type="number" id="assumeSpAnnual" value="${a.statePension.annualAmount}" step="10">
          </div>
          <div class="form-group">
            <label>Quote year</label>
            <input type="number" id="assumeSpYear" value="${a.statePension.quoteYear}" min="2000" max="2100">
          </div>
          <div class="form-group">
            <label>SPA age (info)</label>
            <input type="number" id="assumeSpAge" value="${a.statePension.spaAge || 67}" min="60" max="75">
          </div>
        </div>
        <label class="inline-check" style="margin-top:8px;">
          <input type="checkbox" id="assumeSpGrow" ${a.statePension.growWithInflation !== false ? "checked" : ""}>
          Grow with plan inflation from quote year to start date
        </label>
      </div>

      <button class="btn-primary" onclick="saveAssumptions()" style="margin-top:16px;">Save assumptions</button>
    </div>
  `;
}

function resetTaxBands() {
  ensureAssumptions();
  currentPlan.assumptions.taxBands = defaultTaxBands();
  autoSave();
  page.innerHTML = renderAssumptionsPage();
  updateSaveStatus();
}
window.resetTaxBands = resetTaxBands;

function saveAssumptions() {
  ensureAssumptions();
  ensureSpend();
  const pct = parseFloat(document.getElementById("assumeInflation").value);
  const rate = isNaN(pct) ? 0.025 : pct / 100;
  currentPlan.assumptions.inflationRate = rate;
  currentPlan.spend.inflationRate = rate;
  currentPlan.assumptions.niThreshold = parseFloat(document.getElementById("assumeNiThreshold")?.value) || 0;
  currentPlan.assumptions.niEmployeeRate = parseFloat(document.getElementById("assumeNiRate")?.value) || 0;
  const rows = document.querySelectorAll(".tax-band-row");
  currentPlan.assumptions.taxBands = Array.from(rows).map(row => {
    const toVal = row.querySelector(".tax-to").value;
    return {
      from: parseFloat(row.querySelector(".tax-from").value) || 0,
      to: toVal === "" ? null : parseFloat(toVal),
      rate: parseFloat(row.querySelector(".tax-rate").value) || 0
    };
  });
  currentPlan.assumptions.statePension = {
    annualAmount: parseFloat(document.getElementById("assumeSpAnnual")?.value) || 11502,
    quoteYear: parseInt(document.getElementById("assumeSpYear")?.value, 10) || new Date().getFullYear(),
    spaAge: parseInt(document.getElementById("assumeSpAge")?.value, 10) || 67,
    growWithInflation: !!document.getElementById("assumeSpGrow")?.checked
  };
  autoSave();
  updateSaveStatus();
  if (typeof appAlert === "function") appAlert("Assumptions saved.");
  else alert("Assumptions saved.");
}
window.saveAssumptions = saveAssumptions;

// ---------- PLANS (templates) ----------
function renderPlansPage() {
  ensureSpend();
  ensureAssumptions();
  return `
    <div class="page plans-page">
      <header class="page-header">
        <div>
          <h1>Plans</h1>
          <p class="subtitle">Templates that shape one part of the model — apply, then tweak</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="collapse-section open" data-section="plans-spend">
        <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
          <span>Spend</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <p class="settings-desc">Templates write NES targets (today’s money). You can still edit nodes on Spend afterwards.</p>
          <div class="plan-template-grid">
            <button type="button" class="plan-template-card" onclick="openSpendToRetirementBubble()">
              <div class="plan-template-icon">📉</div>
              <div class="plan-template-title">Spend to retirement</div>
              <p class="plan-template-desc">NES tracks inflation until a retirement age, then falls in real terms (e.g. 1% below inflation, then 2%). Ideal for a gentle late-life taper.</p>
              <span class="plan-template-cta">Open →</span>
            </button>
          </div>
        </div>
      </div>

      <div class="collapse-section open" data-section="plans-strategy" style="margin-top:16px;">
        <button type="button" class="collapse-header" onclick="this.parentElement.classList.toggle('open')">
          <span>Strategy</span>
          <span class="collapse-chevron">▾</span>
        </button>
        <div class="collapse-body">
          <p class="settings-desc">Strategy packs (building, starting to retire, late life) will appear here. For now use the Strategy timeline directly.</p>
          <div class="plan-template-grid">
            <div class="plan-template-card is-disabled">
              <div class="plan-template-icon">🗺</div>
              <div class="plan-template-title">Coming soon</div>
              <p class="plan-template-desc">Pre-built timeline blocks and action sets you can drop onto the strategy lane.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
window.renderPlansPage = renderPlansPage;

function personAgeInYear(person, year) {
  if (!person || !person.dateOfBirth) return null;
  const dob = new Date(person.dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  return year - dob.getFullYear();
}

function openSpendToRetirementBubble() {
  document.getElementById("planTemplateBubble")?.remove();
  ensureSpend();
  ensureAssumptions();
  const years = getPlanYears();
  const person = (currentPlan.people || []).find(p => p.name) || (currentPlan.people || [])[0];
  const spa = Number(currentPlan.assumptions?.statePension?.spaAge) || 67;
  const baseMo = Math.round(toMonthly(getNonEssentialDisplayForYear(years[0]) || currentPlan.spend.targetBase || 0));

  const backdrop = document.createElement("div");
  backdrop.id = "planTemplateBubble";
  backdrop.className = "noness-bubble-backdrop";
  backdrop.innerHTML = `
    <div class="noness-bubble plan-template-bubble" role="dialog" aria-label="Spend to retirement">
      <div class="noness-bubble-head">
        <strong>Spend to retirement</strong>
        <button type="button" class="btn-icon" id="ptClose" title="Close">✕</button>
      </div>
      <div class="noness-bubble-body">
        <p class="settings-desc" style="margin-top:0;">
          Builds NES targets in <strong>today’s money</strong>: flat in real terms until retirement age,
          then declining by a real % each year, then a steeper decline after the later age.
          Uses ${person?.name ? `<strong>${escapeHtml(person.name)}</strong>’s` : "the first person’s"} date of birth when set; otherwise ages are measured from the plan start year.
        </p>
        <div class="form-row" style="flex-wrap:wrap;">
          <div class="form-group">
            <label>Starting NES (£ / month, today’s money)</label>
            <input type="number" id="ptBaseMo" value="${baseMo}" min="0" step="10">
          </div>
          <div class="form-group">
            <label>Retirement age</label>
            <input type="number" id="ptRetireAge" value="${spa}" min="50" max="80" step="1">
          </div>
          <div class="form-group">
            <label>Later age (steeper taper)</label>
            <input type="number" id="ptLaterAge" value="${Math.min(80, spa + 7)}" min="55" max="95" step="1">
          </div>
        </div>
        <div class="form-row" style="flex-wrap:wrap;">
          <div class="form-group">
            <label>Real change until retirement (% / year)</label>
            <input type="number" id="ptRateEarly" value="0" step="0.1" title="0 = tracks inflation">
          </div>
          <div class="form-group">
            <label>Real change retirement → later (% / year)</label>
            <input type="number" id="ptRateMid" value="-1" step="0.1">
          </div>
          <div class="form-group">
            <label>Real change after later age (% / year)</label>
            <input type="number" id="ptRateLate" value="-2" step="0.1">
          </div>
        </div>
        <p class="field-hint">Negative = below inflation (e.g. −1 means 1% below inflation each year in real terms).</p>
        <div class="node-edit-actions" style="margin-top:14px;">
          <button type="button" class="btn-primary" id="ptImplement">Implement</button>
          <button type="button" class="btn-secondary" id="ptCancel">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("open"));

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.getElementById("ptClose")?.addEventListener("click", close);
  document.getElementById("ptCancel")?.addEventListener("click", close);
  document.getElementById("ptImplement")?.addEventListener("click", () => {
    implementSpendToRetirement({
      baseMonthly: parseFloat(document.getElementById("ptBaseMo")?.value) || 0,
      retireAge: parseInt(document.getElementById("ptRetireAge")?.value, 10) || 67,
      laterAge: parseInt(document.getElementById("ptLaterAge")?.value, 10) || 74,
      rateEarly: parseFloat(document.getElementById("ptRateEarly")?.value) || 0,
      rateMid: parseFloat(document.getElementById("ptRateMid")?.value) || -1,
      rateLate: parseFloat(document.getElementById("ptRateLate")?.value) || -2,
      person
    });
    close();
  });
}
window.openSpendToRetirementBubble = openSpendToRetirementBubble;

function implementSpendToRetirement(opts) {
  ensureSpend();
  const years = getPlanYears();
  const fundUntil = currentPlan.spend.fundUntil || years[years.length - 1];
  const startY = years[0];
  let realAnnual = Math.max(0, (opts.baseMonthly || 0) * 12);
  const person = opts.person;
  const hasDob = !!(person && person.dateOfBirth);

  if (!currentPlan.spend.targetOverrides) currentPlan.spend.targetOverrides = {};
  if (!currentPlan.spend.userTouched) currentPlan.spend.userTouched = {};

  years.forEach((y, idx) => {
    if (y > fundUntil) {
      currentPlan.spend.targetOverrides[y] = 0;
      return;
    }
    let age;
    if (hasDob) {
      age = personAgeInYear(person, y);
    } else {
      // Treat plan start as "current age unknown" — map retireAge to years from start using SPA as offset
      // Simpler: year offset from start where "retire" is retireAge years after an assumed current age 0 at start? 
      // Better: assume person is (retireAge - years to retirement). Without DOB, use calendar: 
      // first year = as if age = retireAge - (fund span fraction) — actually use:
      // age proxy = retireAge - (years from now until we hit "retirement year")
      // Default retirement year = start + max(0, something). User expects ages 67/74 — without DOB we 
      // interpret "retirement age" as the calendar year when startYear + (retireAge - assumedAge).
      // Assumed current age from SPA assumption: if SPA 67 and we're applying taper from 67, without DOB
      // use: age = retireAge - (years until a default retirement year). 
      // Practical approach: treat plan start year as age (retireAge - 0) only if... 
      // Simplest UX without DOB: map retireAge/laterAge to years: 
      // retirementYear = startY + max(0, opts.retireAge - 55) as soft default? 
      // Even simpler: use ages as if person is `spaAge - 20` today... messy.
      // Documented approach: without DOB, retirement year = startY (immediate) if retireAge low — NO.
      // Use: age = (opts.retireAge - 10) + (y - startY)  so if retireAge=67, start age=57.
      age = (opts.retireAge - 10) + (y - startY);
    }

    if (idx > 0) {
      let r = opts.rateEarly / 100;
      if (age >= opts.laterAge) r = opts.rateLate / 100;
      else if (age >= opts.retireAge) r = opts.rateMid / 100;
      realAnnual = Math.max(0, realAnnual * (1 + r));
    }
    currentPlan.spend.targetOverrides[y] = Math.round(realAnnual);
    currentPlan.spend.userTouched[y] = true;
  });

  currentPlan.spend.targetBase = Math.round((opts.baseMonthly || 0) * 12);
  currentPlan.spend.modelRatio = 1;
  autoSave();

  if (typeof appAlert === "function") {
    appAlert("Spend to retirement applied to NES targets through Fund until. Review on the Spend page — then Reset/Rebase or Solve if you want the plan to balance.");
  } else {
    alert("Spend to retirement applied.");
  }
  // Jump to spend so they see the shape
  const btn = document.querySelector('.navButton[data-page="spend"]');
  if (btn) btn.click();
}
window.implementSpendToRetirement = implementSpendToRetirement;

// ---------- REPORTS ----------
function renderReportsPage() {
  const peopleNames = currentPlan.people.filter(p => p.name).map(p => p.name).join(" & ") || "Your plan";
  return `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Reports</h1>
          <p class="subtitle">Summaries and printable documents from your plan</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>

      <div class="report-cards">
        <div class="report-card">
          <div class="report-card-icon">📄</div>
          <div class="report-card-body">
            <h3>Annual Report</h3>
            <p>A clear snapshot of where you are now and where the plan is heading — metrics, tables and charts ready to print or save as PDF.</p>
            <p class="report-meta">Plan: <strong>${escapeHtml(currentPlan.meta?.name || "Untitled")}</strong> · ${escapeHtml(peopleNames)}</p>
            <button class="btn-primary" onclick="generateAnnualReport()">Generate Annual Report</button>
          </div>
        </div>
        <div class="report-card">
          <div class="report-card-icon">📊</div>
          <div class="report-card-body">
            <h3>The Figures</h3>
            <p>Year-by-year table: monthly &amp; yearly spend, Non Essential Spend, income, cash reserve and net worth — with and without inflation.</p>
            <p class="report-meta">Compact print layout · use browser Print → Save as PDF</p>
            <button class="btn-primary" onclick="generateFiguresReport()">Generate The Figures</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Age a person turns during calendar year y (birthday in that year). */
function ageTurningInYear(person, year) {
  if (!person?.dateOfBirth) return null;
  const dob = new Date(person.dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  return year - dob.getFullYear();
}

function agesLabelForYear(year) {
  const named = (currentPlan.people || []).filter(p => p.name && p.dateOfBirth);
  if (!named.length) return "";
  const parts = named.map(p => {
    const a = ageTurningInYear(p, year);
    return a != null ? String(a) : "—";
  });
  return parts.join("/");
}

function agesNamesHint() {
  const named = (currentPlan.people || []).filter(p => p.name && p.dateOfBirth);
  if (named.length < 2) return named[0]?.name || "";
  return named.map(p => p.name).join("/");
}

function generateFiguresReport() {
  ensureSpend();
  const years = getPlanYears();
  const { series, totals, interestByYear } = calcProjectedNetWorth();
  const cashIds = (currentPlan.accounts || [])
    .filter(a => CASH_TYPES.includes(a.type))
    .map(a => a.id);
  const peopleWithDob = (currentPlan.people || []).filter(p => p.name && p.dateOfBirth);
  const ageHeader = peopleWithDob.length
    ? peopleWithDob.map(p => p.name.split(/\s+/)[0]).join("/")
    : "Age";

  const rowsReal = [];
  const rowsNom = [];
  years.forEach((y, i) => {
    const nesNom = getNonEssentialForYear(y);
    const potsNom = (currentPlan.spend.pots || []).reduce((s, p) => s + getPotAmountForYear(p, y), 0);
    const oneOff = getOneOffsForYear(y);
    const spendNom = potsNom + nesNom + oneOff;
    const incNom = calcIncomeForYear(y) + ((interestByYear && interestByYear[y]) || 0);
    const nwNom = totals[i] ?? 0;
    let cashNom = 0;
    cashIds.forEach(id => { cashNom += (series[id]?.values[i] || 0); });
    const ages = agesLabelForYear(y) || "—";

    const pack = (spend, nes, inc, cash, nw, one) => ({
      y, ages,
      mo: spend / 12,
      yr: spend,
      nes: nes / 12,
      inc: inc / 12,
      cash,
      nw,
      one
    });

    rowsNom.push(pack(spendNom, nesNom, incNom, cashNom, nwNom, oneOff));
    rowsReal.push(pack(
      toDisplayMoney(spendNom, y),
      toDisplayMoney(nesNom, y),
      toDisplayMoney(incNom, y),
      toDisplayMoney(cashNom, y),
      toDisplayMoney(nwNom, y),
      toDisplayMoney(oneOff, y)
    ));
  });

  const fmt = (n) => "£" + Math.round(n).toLocaleString();
  const table = (rows, title, note) => `
    <h2>${title}</h2>
    <p class="note">${note}</p>
    <table>
      <thead>
        <tr>
          <th>Year</th>
          <th>${escapeHtml(ageHeader)}</th>
          <th class="num">Spend /mo</th>
          <th class="num">Spend /yr</th>
          <th class="num">NES /mo</th>
          <th class="num">Income /mo</th>
          <th class="num">Cash</th>
          <th class="num">Net worth</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${r.y}</td>
          <td>${r.ages}</td>
          <td class="num">${fmt(r.mo)}</td>
          <td class="num">${fmt(r.yr)}${r.one > 0.5 ? "*" : ""}</td>
          <td class="num">${fmt(r.nes)}</td>
          <td class="num">${fmt(r.inc)}</td>
          <td class="num">${fmt(r.cash)}</td>
          <td class="num">${fmt(r.nw)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="note">Ages are the age each person turns in that calendar year. * Yearly spend includes one-offs. NES = Non Essential Spend.</p>
  `;

  const name = currentPlan.meta?.planTitle || currentPlan.meta?.name || "Plan";
  const people = (currentPlan.people || []).filter(p => p.name).map(p => p.name).join(" & ") || "—";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>The Figures — ${escapeHtml(name)}</title>
    <style>
      body { font-family: system-ui, sans-serif; color: #0F172A; margin: 24px; font-size: 11px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 20px 0 6px; color: #4C1D95; }
      .sub { color: #64748B; margin-bottom: 12px; }
      .note { color: #64748B; font-size: 10px; margin: 4px 0 8px; }
      .toolbar { margin-bottom: 16px; }
      .toolbar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: none; background: #7C3AED; color: #fff; cursor: pointer; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #E2E8F0; padding: 4px 6px; text-align: left; }
      th { background: #F8FAFC; font-weight: 600; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      @media print {
        body { margin: 12mm; }
        .toolbar { display: none; }
        .section-2 { page-break-before: always; }
      }
    </style></head><body>
    <div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
    <h1>The Figures</h1>
    <p class="sub">${escapeHtml(name)} · ${escapeHtml(people)} · Generated ${new Date().toLocaleDateString()}</p>
    <div class="section-1">
      ${table(rowsReal, "Today's money (inflation backed out)", "Display values with plan inflation removed — easier to compare lifestyle over time.")}
    </div>
    <div class="section-2">
      ${table(rowsNom, "With inflation (nominal)", "What the cashflows look like in the pounds of each year.")}
    </div>
    </body></html>`;

  // Open report without auto-print (auto-print was blocking interaction when returning to the app)
  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to generate the report.");
    return;
  }
  w.document.write(html);
  w.document.close();
  // Ensure main window stays usable
  try { window.focus(); } catch (e) {}
}
window.generateFiguresReport = generateFiguresReport;

function generateAnnualReport() {
  ensureSpend();
  const years = getPlanYears();
  const startY = years[0];
  const endY = years[years.length - 1];
  const fundUntil = currentPlan.spend?.fundUntil || endY;
  const nw = calcNetWorth();
  const { series, totals } = calcProjectedNetWorth();
  const fundIdx = Math.max(0, years.indexOf(fundUntil));
  const nwAtFund = totals[fundIdx] ?? totals[totals.length - 1] ?? 0;
  const nwAtEnd = totals[totals.length - 1] ?? 0;

  const people = currentPlan.people.filter(p => p.name);
  const peopleLine = people.map(p => {
    const age = p.dateOfBirth ? (startY - new Date(p.dateOfBirth).getFullYear()) : null;
    return age != null ? `${p.name} (age ~${age} in ${startY})` : p.name;
  }).join(" · ") || "No people added yet";

  const monthlyIncome = (currentPlan.income || []).reduce((s, i) => s + (Number(i.amountMonthly) || 0), 0);
  const essential = (currentPlan.spend?.pots || []).find(p => p.isEssential);
  const essentialAmt = essential ? (Number(essential.amountAnnual) || 0) : 0;
  const potsOther = (currentPlan.spend?.pots || []).filter(p => !p.isEssential);
  const potsTotal = potsOther.reduce((s, p) => s + (Number(p.amountAnnual) || 0), 0);
  const targetNow = getTargetForYear(startY);
  const totalSpendNow = essentialAmt + potsTotal + targetNow;

  // Narrative
  const outlook =
    nwAtFund >= 0
      ? `On the current path, projected resources at ${fundUntil} remain non-negative, with an estimated net position of ${formatMoney(nwAtFund)} at that point.`
      : `On the current path, resources are projected to run short before ${fundUntil}. Reviewing spend targets or income may help.`;

  const accountsRows = (currentPlan.accounts || []).map(a => {
    const typeLabel = (ACCOUNT_TYPES.find(t => t.value === a.type) || {}).label || a.type || "—";
    return `<tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(typeLabel)}</td>
      <td>${escapeHtml(getPersonName(a.ownerId))}</td>
      <td class="num">${formatMoney(a.startBalance)}</td>
      <td class="num">${a.annualGrowth != null ? a.annualGrowth + "%" : "—"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">No accounts in this plan yet.</td></tr>`;

  const incomeRows = (currentPlan.income || []).map(i => {
    const typeLabel = (INCOME_TYPES.find(t => t.value === i.type) || {}).label || i.type || "—";
    return `<tr>
      <td>${escapeHtml(i.name)}</td>
      <td>${escapeHtml(typeLabel)}</td>
      <td>${escapeHtml(getPersonName(i.personId))}</td>
      <td class="num">${formatMoney(i.amountMonthly)}/mo</td>
      <td>${i.startDate || "—"} → ${i.endDate || "ongoing"}</td>
      <td>${i.taxable !== false ? "Yes" : "No"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No income sources yet.</td></tr>`;

  const potRows = (currentPlan.spend?.pots || []).map(p => `<tr>
      <td>${escapeHtml(p.name)}${p.isEssential ? " <span class=\"tag\">Essential</span>" : ""}</td>
      <td class="num">${formatMoney(p.amountAnnual)}/yr</td>
      <td>${p.fromYear || "—"} – ${p.toYear || "—"}</td>
      <td>${p.inflate ? "Yes" : "No"}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">No spend pots yet.</td></tr>`;

  // Simple SVG net worth chart for the report
  const chartYears = years;
  const chartVals = totals;
  const cMax = Math.max(...chartVals, 1);
  const cMin = Math.min(...chartVals, 0);
  const cRange = cMax - cMin || 1;
  const cw = 720, ch = 200, cleft = 50, cbottom = 28, ctop = 10;
  const cInnerH = ch - cbottom - ctop;
  const cStep = chartYears.length > 1 ? (cw - cleft - 10) / (chartYears.length - 1) : cw - cleft;
  const cPts = chartVals.map((v, i) => {
    const x = cleft + i * cStep;
    const y = ctop + cInnerH - ((v - cMin) / cRange) * cInnerH;
    return `${x},${y}`;
  });
  const areaPath = `M ${cleft},${ctop + cInnerH} L ${cPts.join(" L ")} L ${cleft + (chartYears.length - 1) * cStep},${ctop + cInnerH} Z`;
  const linePath = `M ${cPts.join(" L ")}`;
  let cGrid = "";
  for (let i = 0; i <= 4; i++) {
    const val = cMax - (cRange / 4) * i;
    const y = ctop + (cInnerH / 4) * i;
    const label = val >= 1000 || val <= -1000 ? "£" + (val / 1000).toFixed(0) + "k" : "£" + Math.round(val);
    cGrid += `<line x1="${cleft}" y1="${y}" x2="${cw - 10}" y2="${y}" stroke="#E2E8F0"/>`;
    cGrid += `<text x="${cleft - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748B">${label}</text>`;
  }
  let cX = "";
  const every = Math.max(1, Math.ceil((chartYears.length - 1) / 8));
  chartYears.forEach((y, i) => {
    if (i % every === 0 || i === chartYears.length - 1) {
      cX += `<text x="${cleft + i * cStep}" y="${ch - 8}" text-anchor="middle" font-size="10" fill="#64748B">${y}</text>`;
    }
  });

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const planName = currentPlan.meta?.name || "Untitled Plan";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Annual Report — ${escapeHtml(planName)}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #0F172A;
    line-height: 1.5;
    margin: 0;
    background: #F1F5F9;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    background: #0F172A; color: #fff;
    padding: 12px 20px;
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px;
  }
  .toolbar button {
    background: #7C3AED; color: #fff; border: none;
    padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer;
  }
  .toolbar button.secondary { background: #334155; }
  .toolbar span { font-size: 13px; opacity: 0.85; }
  .sheet {
    max-width: 820px;
    margin: 24px auto;
    background: #fff;
    box-shadow: 0 4px 24px rgba(15,23,42,0.08);
    border-radius: 4px;
  }
  .page-block {
    padding: 40px 48px;
    page-break-after: always;
    min-height: 1000px;
  }
  .page-block:last-child { page-break-after: auto; }
  .brand {
    display: flex; align-items: center; gap: 12px; margin-bottom: 28px;
  }
  .brand-mark {
    width: 40px; height: 40px; border-radius: 10px;
    background: linear-gradient(135deg, #7C3AED, #2563EB);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px;
  }
  .brand-name { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
  .brand-sub { font-size: 12px; color: #64748B; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.03em; }
  h2 { font-size: 18px; margin: 28px 0 12px; color: #0F172A; border-bottom: 2px solid #7C3AED; padding-bottom: 6px; display: inline-block; }
  h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748B; margin: 20px 0 8px; }
  .lede { font-size: 15px; color: #334155; max-width: 560px; margin-bottom: 24px; }
  .meta-line { font-size: 13px; color: #64748B; margin-bottom: 20px; }
  .metrics {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0 28px;
  }
  .metric {
    background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px 18px;
  }
  .metric.accent { background: linear-gradient(135deg, #F5F3FF, #EEF2FF); border-color: #DDD6FE; }
  .metric .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; }
  .metric .value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; }
  .metric .hint { font-size: 12px; color: #94A3B8; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 8px 0 16px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748B; border-bottom: 1px solid #E2E8F0; padding: 8px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid #F1F5F9; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.muted { color: #94A3B8; font-style: italic; }
  .tag { font-size: 10px; background: #E2E8F0; color: #475569; padding: 1px 6px; border-radius: 4px; }
  .callout {
    background: #F0FDF4; border-left: 4px solid #22C55E; padding: 14px 16px; border-radius: 0 10px 10px 0;
    font-size: 14px; color: #14532D; margin: 16px 0;
  }
  .callout.warn { background: #FFF7ED; border-left-color: #F97316; color: #9A3412; }
  .chart-box { background: #FAFBFC; border: 1px solid #F1F5F9; border-radius: 12px; padding: 12px; margin: 12px 0 20px; }
  .footer-note { font-size: 11px; color: #94A3B8; margin-top: 32px; border-top: 1px solid #F1F5F9; padding-top: 12px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  ul.clean { margin: 8px 0; padding-left: 18px; font-size: 14px; color: #334155; }
  ul.clean li { margin-bottom: 6px; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    .sheet { box-shadow: none; margin: 0; max-width: none; }
    .page-block { padding: 0; min-height: auto; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span>LifePlan · Annual Report · ${escapeHtml(planName)}</span>
    <div>
      <button class="secondary" onclick="window.close()">Close</button>
      <button onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>

  <div class="sheet">
    <!-- PAGE 1: Snapshot -->
    <div class="page-block">
      <div class="brand">
        <div class="brand-mark">LP</div>
        <div>
          <div class="brand-name">LifePlan</div>
          <div class="brand-sub">Personal finance outlook</div>
        </div>
      </div>
      <h1>Annual Report</h1>
      <p class="meta-line">${escapeHtml(planName)} · Prepared ${today}<br/>${escapeHtml(peopleLine)}</p>
      <p class="lede">
        This report summarises your current position and the projected path through
        <strong>${startY}</strong> to <strong>${endY}</strong>, with a planning horizon to fund until
        <strong>${fundUntil}</strong>. Figures are drawn directly from your LifePlan model.
      </p>

      <div class="metrics">
        <div class="metric accent">
          <div class="label">Net worth (now)</div>
          <div class="value">${formatMoney(nw)}</div>
          <div class="hint">${(currentPlan.accounts || []).length} account${(currentPlan.accounts || []).length === 1 ? "" : "s"}</div>
        </div>
        <div class="metric">
          <div class="label">Monthly income</div>
          <div class="value">${formatMoney(monthlyIncome)}</div>
          <div class="hint">${formatMoney(monthlyIncome * 12)} / year</div>
        </div>
        <div class="metric">
          <div class="label">Annual spend (now)</div>
          <div class="value">${formatMoney(totalSpendNow)}</div>
          <div class="hint">Essential ${formatMoney(essentialAmt)} · pots ${formatMoney(potsTotal)} · target ${formatMoney(targetNow)}</div>
        </div>
        <div class="metric">
          <div class="label">Projected at fund until (${fundUntil})</div>
          <div class="value">${formatMoney(nwAtFund)}</div>
          <div class="hint">End of plan (${endY}): ${formatMoney(nwAtEnd)}</div>
        </div>
      </div>

      <div class="callout ${nwAtFund < 0 ? "warn" : ""}">${outlook}</div>

      <h3>Plan scale</h3>
      <ul class="clean">
        <li>Projection years: <strong>${startY} – ${endY}</strong></li>
        <li>Fund until: <strong>${fundUntil}</strong></li>
        <li>Inflation assumption (model default): <strong>2.5% per year</strong></li>
        <li>Report values reflect the plan as saved in this browser session.</li>
      </ul>
      <p class="footer-note">Page 1 · Snapshot · LifePlan</p>
    </div>

    <!-- PAGE 2: Now -->
    <div class="page-block">
      <div class="brand">
        <div class="brand-mark">LP</div>
        <div><div class="brand-name">Where you are now</div><div class="brand-sub">${escapeHtml(planName)}</div></div>
      </div>

      <h2>Accounts</h2>
      <table>
        <thead>
          <tr><th>Account</th><th>Type</th><th>Owner</th><th class="num">Balance</th><th class="num">Growth</th></tr>
        </thead>
        <tbody>${accountsRows}</tbody>
      </table>

      <h2>Income</h2>
      <table>
        <thead>
          <tr><th>Source</th><th>Type</th><th>Person</th><th class="num">Amount</th><th>Period</th><th>Taxable</th></tr>
        </thead>
        <tbody>${incomeRows}</tbody>
      </table>

      <h2>Spend pots</h2>
      <table>
        <thead>
          <tr><th>Pot</th><th class="num">Base amount</th><th>Years</th><th>Rises with inflation</th></tr>
        </thead>
        <tbody>${potRows}</tbody>
      </table>
      <p class="footer-note">Page 2 · Current position · LifePlan</p>
    </div>

    <!-- PAGE 3: Future -->
    <div class="page-block">
      <div class="brand">
        <div class="brand-mark">LP</div>
        <div><div class="brand-name">Looking ahead</div><div class="brand-sub">${startY} – ${endY}</div></div>
      </div>

      <h2>Projected net worth</h2>
      <p class="lede" style="font-size:13px;">
        Combined path of accounts, cumulative income and cumulative spend (including target non-essential spend).
        This is a deterministic illustration, not a guarantee.
      </p>
      <div class="chart-box">
        <svg width="100%" viewBox="0 0 ${cw} ${ch}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${cGrid}
          <path d="${areaPath}" fill="url(#repGrad)"/>
          <path d="${linePath}" fill="none" stroke="#7C3AED" stroke-width="2.5"/>
          ${cX}
        </svg>
      </div>

      <div class="two-col">
        <div>
          <h3>Spend shape</h3>
          <ul class="clean">
            <li>Essential: <strong>${formatMoney(essentialAmt)}</strong> / year</li>
            <li>Other pots: <strong>${formatMoney(potsTotal)}</strong> / year base</li>
            <li>Target (non-essential) in ${startY}: <strong>${formatMoney(targetNow)}</strong></li>
            <li>Fund until year: <strong>${fundUntil}</strong></li>
          </ul>
        </div>
        <div>
          <h3>Milestones</h3>
          <ul class="clean">
            <li>Start (${startY}): <strong>${formatMoney(totals[0] || nw)}</strong></li>
            <li>Fund until (${fundUntil}): <strong>${formatMoney(nwAtFund)}</strong></li>
            <li>Plan end (${endY}): <strong>${formatMoney(nwAtEnd)}</strong></li>
            <li>Income sources: <strong>${(currentPlan.income || []).length}</strong></li>
          </ul>
        </div>
      </div>

      <div class="callout">
        Tip: Use <strong>Reset targets</strong> or <strong>Rebase targets</strong> on the Spend page if you want the model to level non-essential spend so resources are drawn down toward zero by your fund-until year.
      </div>
      <p class="footer-note">Page 3 · Outlook · LifePlan</p>
    </div>

    <!-- PAGE 4: Notes -->
    <div class="page-block">
      <div class="brand">
        <div class="brand-mark">LP</div>
        <div><div class="brand-name">Notes &amp; assumptions</div><div class="brand-sub">${escapeHtml(planName)}</div></div>
      </div>

      <h2>How to read this report</h2>
      <ul class="clean">
        <li><strong>Net worth (now)</strong> is the sum of account starting balances in the plan.</li>
        <li><strong>Projections</strong> grow each account by its annual rate (with any year overrides you set), add income, and subtract spend pots plus the target line.</li>
        <li><strong>Today's money vs inflation:</strong> the live app can toggle display; this report uses the model’s stored cashflow path.</li>
        <li><strong>Tax</strong> is only lightly represented (taxable flags on income). Full tax modelling is not applied in this version.</li>
      </ul>

      <h2>What this is not</h2>
      <ul class="clean">
        <li>Not regulated financial advice.</li>
        <li>Not a stochastic forecast — markets and life events will differ.</li>
        <li>Not a complete tax, benefit or pension-rules engine (yet).</li>
      </ul>

      <h2>Next steps you might take</h2>
      <ul class="clean">
        <li>Keep account balances and income up to date after each annual review.</li>
        <li>Shape the Target line on Spend so non-essential outgo matches how you want to live at different ages.</li>
        <li>Re-run this report after material changes and keep a dated PDF with your records.</li>
      </ul>

      <p class="footer-note">
        Page 4 · Notes · Generated ${today} by LifePlan · Plan file: ${escapeHtml(planName)}
      </p>
    </div>
  </div>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to view the annual report.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
window.generateAnnualReport = generateAnnualReport;

// ---------- Generic page ----------
function renderGenericPage(title) {
  return `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>${title}</h1>
          <p class="subtitle">This section is ready for components</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status"></span>
        </div>
      </header>
      <div class="page-placeholder">
        <h2>${title}</h2>
        <p>Empty page – we can design the components for this section next.</p>
      </div>
    </div>
  `;
}

// ---------- Navigation ----------
buttons.forEach(button => {
  button.addEventListener("click", (e) => {
    const pageName = button.dataset.page;
    // Help (and any nav without data-page) — do not switch page
    if (!pageName) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    buttons.forEach(b => b.classList.remove("active"));
    button.classList.add("active");

    const title = button.innerText.trim();

    if (pageName === "dashboard") {
      page.innerHTML = renderDashboard();
      attachNwHover();
      attachPieHovers();
      if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
      updateSaveStatus();
      return;
    }
    if (pageName === "people") {
      page.innerHTML = renderPeoplePage();
      attachPeopleListeners();
      updateSaveStatus();
      return;
    }
    if (pageName === "accounts") {
      page.innerHTML = renderAccountsPage();
      attachTypeColorListeners();
      if (typeof attachSortableList === "function") attachSortableList("accountsSortList", "accounts");
      if (typeof drawAccountsOverviewChart === "function") drawAccountsOverviewChart();
      updateSaveStatus();
      return;
    }
    if (pageName === "income") {
      page.innerHTML = renderIncomePage();
      attachTypeColorListeners();
      if (typeof attachSortableList === "function") attachSortableList("incomeSortList", "income");
      if (typeof drawIncomeOverviewChart === "function") drawIncomeOverviewChart();
      updateSaveStatus();
      return;
    }
    if (pageName === "spend") {
      page.innerHTML = renderSpendPage();
      attachSpendListeners();
      attachTypeColorListeners();
      updateSaveStatus();
      return;
    }
    if (pageName === "strategy") {
      page.innerHTML = renderStrategyPage();
      attachStrategyTimeline();
      updateSaveStatus();
      return;
    }
    if (pageName === "assumptions") {
      page.innerHTML = renderAssumptionsPage();
      updateSaveStatus();
      return;
    }
    if (pageName === "settings") {
      page.innerHTML = renderSettingsPage();
      if (typeof attachSettingsListeners === "function") attachSettingsListeners();
      const adm = document.getElementById("adminResetSection");
      if (adm && typeof isLocalAppCopy === "function" && isLocalAppCopy()) adm.hidden = false;
      updateSaveStatus();
      return;
    }
    if (pageName === "reports") {
      page.innerHTML = renderReportsPage();
      updateSaveStatus();
      return;
    }
    if (pageName === "plans") {
      page.innerHTML = renderPlansPage();
      updateSaveStatus();
      return;
    }

    page.innerHTML = renderGenericPage(title);
    updateSaveStatus();
  });
});

// Expose functions
window.importPlan = importPlan;
window.downloadPlan = downloadPlan;
window.newPlan = newPlan;
window.openAccountEditor = openAccountEditor;
window.closeAccountEditor = closeAccountEditor;
window.saveAccountFromEditor = saveAccountFromEditor;

function toggleAccountPensionFields() {
  const t = document.getElementById("edType")?.value;
  const box = document.getElementById("edPensionFields");
  const accum = document.getElementById("edSippAccumFields");
  const dd = document.getElementById("edSippDdFields");
  const isSipp = t === "sipp";
  const isDd = t === "sipp_drawdown";
  if (box) box.style.display = (isSipp || isDd) ? "block" : "none";
  if (accum) accum.style.display = isSipp ? "block" : "none";
  if (dd) dd.style.display = isDd ? "block" : "none";
}
window.toggleAccountPensionFields = toggleAccountPensionFields;
window.deleteAccount = deleteAccount;
window.openIncomeEditor = openIncomeEditor;
window.closeIncomeEditor = closeIncomeEditor;
window.saveIncomeFromEditor = saveIncomeFromEditor;
window.deleteIncome = deleteIncome;
window.resetEditorOverrides = resetEditorOverrides;
window.changeWidget = changeWidget;
window.expandWidget = expandWidget;
window.closeExpand = closeExpand;
window.toggleComponent = toggleComponent;
window.refreshExpandNetWorth = refreshExpandNetWorth;
window.saveScale = saveScale;



// ========== SETUP WIZARD (guided tour) ==========
// Steps: name → people → accounts → income → spend → done
let wizardStep = 0;
/** path: null | "tour" | "build" */
let wizardPath = null;

const WIZARD_TOUR = [
  { id: "people", page: "people", label: "People",
    message: "Add the people on this plan. Click <strong>People</strong> if needed, then fill in names and details. When you're ready, press Continue." },
  { id: "accounts", page: "accounts", label: "Accounts",
    message: "Add your pots of money. Open <strong>Accounts</strong> and use <strong>+ Add Account</strong>. Add as many as you like, then Continue." },
  { id: "income", page: "income", label: "Income",
    message: "Add regular income under <strong>Income</strong> — salary, pension or other. Skip if none for now." },
  { id: "pause", title: "Good time to pause",
    message: "A natural place to pause. Fill in People, Accounts and Income properly when you can. Resume from <strong>Settings → Continue wizard</strong> or the sidebar button." },
  { id: "spend", page: "spend", label: "Spend",
    message: "On <strong>Spend</strong>, set essential costs and Non Essential Spend. Explore the graphs, then continue." },
  { id: "done", title: "You're set" }
];

const WIZARD_BUILD = [
  { id: "intro" },
  { id: "you" },
  { id: "partner" },
  { id: "money" },
  { id: "statepension" },
  { id: "income" },
  { id: "spend" },
  { id: "horizon" },
  { id: "done" }
];

/** Plan scale: start = current year, end = year youngest person turns 100; fund until = end */
function applyPlanScaleFromPeople() {
  const nowY = new Date().getFullYear();
  const people = (currentPlan.people || []).filter(p => p.name && p.dateOfBirth);
  let endY = nowY + 40;
  if (people.length) {
    let maxEnd = nowY;
    people.forEach(p => {
      const dob = new Date(p.dateOfBirth);
      if (isNaN(dob.getTime())) return;
      const turn100 = dob.getFullYear() + 100;
      if (turn100 > maxEnd) maxEnd = turn100;
    });
    endY = Math.max(nowY + 5, maxEnd);
  }
  if (!currentPlan.scale) currentPlan.scale = {};
  currentPlan.scale.startYear = nowY;
  currentPlan.scale.endYear = endY;
  ensureSpend();
  currentPlan.spend.fundUntil = endY;
}

function ensureWizardMeta() {
  if (!currentPlan.meta) currentPlan.meta = {};
  if (currentPlan.meta.wizardComplete === undefined) currentPlan.meta.wizardComplete = false;
  if (currentPlan.meta.wizardPaused === undefined) currentPlan.meta.wizardPaused = false;
  if (currentPlan.meta.wizardStep === undefined) currentPlan.meta.wizardStep = 0;
  if (currentPlan.meta.wizardPath === undefined) currentPlan.meta.wizardPath = null;
  if (!currentPlan.settings) currentPlan.settings = { showWizardOnNew: true, expertMode: false, wheelIncrement: 1 };
  if (currentPlan.settings.expertMode === undefined) currentPlan.settings.expertMode = false;
  if (currentPlan.settings.wheelIncrement === undefined) currentPlan.settings.wheelIncrement = 1;
  // Wizard must never invent or overwrite display settings such as linkDates
}


function shouldShowWizard() {
  ensureWizardMeta();
  if (currentPlan.settings.showWizardOnNew === false) return false;
  if (currentPlan.meta.wizardComplete) return false;
  if (currentPlan.meta.wizardPaused) return false;
  return true;
}

function startWizard(fromStep) {
  ensureWizardMeta();
  currentPlan.meta.wizardPaused = false;
  currentPlan.meta.wizardComplete = false;
  // Resume in-progress path; otherwise welcome
  if (fromStep == null) {
    wizardPath = currentPlan.meta.wizardPath || null;
    wizardStep = currentPlan.meta.wizardStep || 0;
  } else {
    wizardStep = fromStep;
    wizardPath = currentPlan.meta.wizardPath;
  }
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  showWizardUI();
}
window.startWizard = startWizard;

function restartWizardFresh() {
  ensureWizardMeta();
  currentPlan.meta.wizardPath = null;
  currentPlan.meta.wizardStep = 0;
  currentPlan.meta.wizardPaused = false;
  currentPlan.meta.wizardComplete = false;
  wizardPath = null;
  wizardStep = 0;
  autoSave();
  showWizardUI();
}
window.restartWizardFresh = restartWizardFresh;

function resumeWizard() {
  ensureWizardMeta();
  currentPlan.meta.wizardPaused = false;
  wizardStep = currentPlan.meta.wizardStep || 0;
  wizardPath = currentPlan.meta.wizardPath || null;
  autoSave();
  showWizardUI();
}
window.resumeWizard = resumeWizard;

function pauseWizard() {
  ensureWizardMeta();
  currentPlan.meta.wizardPaused = true;
  currentPlan.meta.wizardStep = wizardStep;
  currentPlan.meta.wizardPath = wizardPath;
  autoSave();
  hideWizardUI();
  updateSaveStatus();
  updateContinueWizardBtn();
}
window.pauseWizard = pauseWizard;

function completeWizard() {
  ensureWizardMeta();
  currentPlan.meta.wizardComplete = true;
  currentPlan.meta.wizardPaused = false;
  currentPlan.meta.wizardStep = 0;
  currentPlan.meta.wizardPath = null;
  wizardPath = null;
  // Do not touch dashboard.widgets — wizard must leave chart choices alone
  autoSave();
  hideWizardUI();
  goToPage("dashboard");
  updateSidebarUser();
  updateContinueWizardBtn();
}
window.completeWizard = completeWizard;

function hideWizardUI() {
  const ov = document.getElementById("wizardOverlay");
  if (ov) { ov.hidden = true; ov.classList.remove("tour-mode", "modal-mode"); }
  document.querySelectorAll(".wizard-highlight").forEach(el => el.classList.remove("wizard-highlight"));
}

function showWizardUI() {
  const ov = document.getElementById("wizardOverlay");
  if (!ov) return;
  ov.hidden = false;
  renderWizardUI();
}

function goToPage(pageName) {
  const btn = document.querySelector(`.navButton[data-page="${pageName}"]`);
  if (btn) btn.click();
  else if (pageName === "dashboard") {
    document.querySelectorAll(".navButton").forEach(b => b.classList.remove("active"));
    const d = document.querySelector('.navButton[data-page="dashboard"]');
    if (d) d.classList.add("active");
    page.innerHTML = renderDashboard();
    if (typeof attachNwHover === "function") attachNwHover();
    if (typeof attachPieHovers === "function") attachPieHovers();
    if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
  }
}

function highlightNav(pageName) {
  document.querySelectorAll(".wizard-highlight").forEach(el => el.classList.remove("wizard-highlight"));
  const btn = document.querySelector(`.navButton[data-page="${pageName}"]`);
  if (btn) btn.classList.add("wizard-highlight");
}

function wizardFooterNote() {
  return `<p class="wizard-footnote">You can add more later from the menu. <strong>Help</strong> is always available if you get stuck.</p>`;
}

function renderWizardUI() {
  ensureWizardMeta();
  if (!wizardPath) {
    renderWizardWelcome();
    return;
  }
  if (wizardPath === "build") {
    renderWizardBuild();
    return;
  }
  renderWizardTour();
}

function renderWizardWelcome() {
  const ov = document.getElementById("wizardOverlay");
  const body = document.getElementById("wizardBody");
  const bar = document.getElementById("wizardProgressBar");
  if (!ov || !body) return;
  if (bar) bar.style.width = "8%";
  ov.classList.remove("tour-mode");
  ov.classList.add("modal-mode");
  body.innerHTML = `
    <div class="wizard-step wizard-welcome">
      <div class="wizard-mascot" aria-hidden="true">£</div>
      <div class="wizard-badge">Welcome to LifePlan</div>
      <h2>Let's get your plan started</h2>
      <p class="wizard-lead">LifePlan works whether you're early career, mid-life, or already drawing pensions. Choose how you'd like to begin.</p>
      <div class="wizard-choice-grid">
        <button type="button" class="wizard-choice" onclick="wizardChoosePath('about')">
          <strong>Tell me what this is</strong>
          <span>A short plain-English overview of the idea</span>
        </button>
        <button type="button" class="wizard-choice" onclick="wizardChoosePath('tour')">
          <strong>Show me around</strong>
          <span>Guided walk through the real screens</span>
        </button>
        <button type="button" class="wizard-choice wizard-choice-primary" onclick="wizardChoosePath('build')">
          <strong>Build me a basic plan</strong>
          <span>Answer a few questions — we'll set up people, savings, income and spend</span>
        </button>
      </div>
      <div class="wizard-actions">
        <button type="button" class="btn-secondary" onclick="pauseWizard()">Skip for now</button>
      </div>
      ${wizardFooterNote()}
    </div>`;
}

async function wizardChoosePath(path) {
  if (path === "about") {
    renderWizardAbout();
    return;
  }
  if (path === "build") {
    const hasData =
      (currentPlan.accounts || []).length > 0 ||
      (currentPlan.income || []).length > 0 ||
      (currentPlan.people || []).some(p => (p.name || "").trim()) ||
      (currentPlan.spend?.pots || []).some(p => p.isEssential && p.amountAnnual > 0);
    if (hasData) {
      const ok = await appConfirmYesNo(
        "Build a basic plan again?\n\nThis will overwrite people, accounts, income and spend set up by the wizard (or that already exist). Continue?",
        "Overwrite & rebuild",
        "Cancel"
      );
      if (!ok) return;
      // Soft clear of core plan content for a clean wizard build — keep dashboard chart choices
      const savedDashboard = currentPlan.dashboard
        ? JSON.parse(JSON.stringify(currentPlan.dashboard))
        : null;
      const savedSettings = currentPlan.settings
        ? JSON.parse(JSON.stringify(currentPlan.settings))
        : null;
      currentPlan.people = [
        { id: "p1", name: "", dateOfBirth: "", photo: null },
        { id: "p2", name: "", dateOfBirth: "", photo: null }
      ];
      currentPlan.accounts = [];
      currentPlan.income = [];
      currentPlan.isJoint = false;
      if (currentPlan.spend) {
        currentPlan.spend.pots = (currentPlan.spend.pots || []).filter(p => p.isEssential).map(p => ({ ...p, amountAnnual: 0, overrides: {} }));
        if (!currentPlan.spend.pots.length) {
          ensureSpend();
          const ess = currentPlan.spend.pots.find(p => p.isEssential);
          if (ess) ess.amountAnnual = 0;
        }
        currentPlan.spend.targets = {};
        currentPlan.spend.modelRatio = 1;
      }
      if (savedDashboard) currentPlan.dashboard = savedDashboard;
      if (savedSettings) currentPlan.settings = savedSettings;
      autoSave();
    }
  }
  wizardPath = path === "build" ? "build" : "tour";
  wizardStep = 0;
  currentPlan.meta.wizardPath = wizardPath;
  currentPlan.meta.wizardStep = 0;
  currentPlan.meta.wizardComplete = false;
  autoSave();
  updateContinueWizardBtn();
  renderWizardUI();
}
window.wizardChoosePath = wizardChoosePath;

function renderWizardAbout() {
  const body = document.getElementById("wizardBody");
  const bar = document.getElementById("wizardProgressBar");
  if (!body) return;
  if (bar) bar.style.width = "15%";
  body.innerHTML = `
    <div class="wizard-step">
      <div class="wizard-badge">The idea</div>
      <h2>Spend-led planning</h2>
      <p class="wizard-lead">Most tools ask “how much do you need to retire?”. LifePlan works the other way:</p>
      <ul class="wizard-bullets">
        <li>You put in <strong>pots of money</strong> and <strong>income</strong></li>
        <li>The model works out a sustainable <strong>monthly spend</strong></li>
        <li>You can shape spend over life (more earlier, less later) and rebalance anytime</li>
      </ul>
      <p class="wizard-lead">It isn't formal financial advice — it's a clear picture you can adjust.</p>
      <div class="wizard-actions">
        <button type="button" class="btn-secondary" onclick="renderWizardWelcome()">Back</button>
        <button type="button" class="btn-primary" onclick="wizardChoosePath('build')">Build a basic plan</button>
        <button type="button" class="btn-secondary" onclick="wizardChoosePath('tour')">Show me around</button>
      </div>
    </div>`;
}
window.renderWizardWelcome = renderWizardWelcome;

function renderWizardTour() {
  const ov = document.getElementById("wizardOverlay");
  const body = document.getElementById("wizardBody");
  const bar = document.getElementById("wizardProgressBar");
  if (!ov || !body) return;

  const step = WIZARD_TOUR[wizardStep] || WIZARD_TOUR[0];
  const total = WIZARD_TOUR.length;
  if (bar) bar.style.width = ((wizardStep + 1) / total * 100) + "%";

  if (step.id === "pause") {
    ov.classList.remove("tour-mode");
    ov.classList.add("modal-mode");
    document.querySelectorAll(".wizard-highlight").forEach(el => el.classList.remove("wizard-highlight"));
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Checkpoint</div>
        <h2>Good time to pause</h2>
        <p class="wizard-lead">${step.message}</p>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause for now</button>
          <button type="button" class="btn-secondary" onclick="wizardTourBackToStart()">All options</button>
          <button type="button" class="btn-primary" onclick="wizardTourNext()">Continue to Spend</button>
        </div>
      </div>`;
    return;
  }

  if (step.id === "done") {
    ov.classList.remove("tour-mode");
    ov.classList.add("modal-mode");
    document.querySelectorAll(".wizard-highlight").forEach(el => el.classList.remove("wizard-highlight"));
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Tour complete</div>
        <h2>You're ready to explore</h2>
        <p class="wizard-lead">Use the <strong>dashboard</strong> for monthly spend and balance. Refine details anytime from the menu.</p>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="wizardTourBackToStart()">All options</button>
          <button type="button" class="btn-secondary" onclick="wizardChoosePath('build')">Build a basic plan</button>
          <button type="button" class="btn-primary" onclick="completeWizard()">Go to dashboard</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  ov.classList.add("tour-mode");
  ov.classList.remove("modal-mode");
  goToPage(step.page);
  setTimeout(() => highlightNav(step.page), 50);

  body.innerHTML = `
    <div class="wizard-coach">
      <div class="wizard-badge">Tour · ${wizardStep + 1} of ${total}</div>
      <h3>${step.label}</h3>
      <p class="wizard-lead">${step.message}</p>
      <div class="wizard-actions">
        <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
        <button type="button" class="btn-secondary" onclick="wizardTourBackToStart()">All options</button>
        ${wizardStep > 0 ? `<button type="button" class="btn-secondary" onclick="wizardTourBack()">Back</button>` : ""}
        <button type="button" class="btn-primary" onclick="wizardTourNext()">Continue</button>
      </div>
    </div>`;
}

function wizardTourBackToStart() {
  wizardPath = null;
  wizardStep = 0;
  currentPlan.meta.wizardPath = null;
  currentPlan.meta.wizardStep = 0;
  autoSave();
  renderWizardWelcome();
}
window.wizardTourBackToStart = wizardTourBackToStart;

function wizardTourNext() {
  wizardStep = Math.min(wizardStep + 1, WIZARD_TOUR.length - 1);
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardTour();
}
window.wizardTourNext = wizardTourNext;

function wizardTourBack() {
  wizardStep = Math.max(wizardStep - 1, 0);
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardTour();
}
window.wizardTourBack = wizardTourBack;

// ---------- Build-a-plan path ----------
function renderWizardBuild() {
  const ov = document.getElementById("wizardOverlay");
  const body = document.getElementById("wizardBody");
  const bar = document.getElementById("wizardProgressBar");
  if (!ov || !body) return;
  ov.classList.remove("tour-mode");
  ov.classList.add("modal-mode");
  document.querySelectorAll(".wizard-highlight").forEach(el => el.classList.remove("wizard-highlight"));

  const steps = WIZARD_BUILD;
  const step = steps[wizardStep] || steps[0];
  if (bar) bar.style.width = ((wizardStep + 1) / steps.length * 100) + "%";
  const p0 = currentPlan.people[0] || {};
  const p1 = currentPlan.people[1] || {};
  const ageFromDob = (dob) => {
    if (!dob) return "";
    const d = new Date(dob);
    if (isNaN(d.getTime())) return "";
    return String(new Date().getFullYear() - d.getFullYear());
  };

  if (step.id === "intro") {
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · intro</div>
        <h2>We'll build a simple starter plan</h2>
        <p class="wizard-lead">In the next few steps we'll add:</p>
        <ul class="wizard-bullets">
          <li>You (and optionally a partner)</li>
          <li>One savings account</li>
          <li>Income sources you choose (including state pension if relevant)</li>
          <li>Essential spend, then a balanced Non Essential Spend shape</li>
        </ul>
        <p class="wizard-lead">You don't need perfect numbers — use estimates. Pause anytime and finish later from <strong>Continue wizard</strong>. Everything can be edited on the real screens afterwards.</p>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardTourBackToStart()">All options</button>
          <button type="button" class="btn-primary" onclick="wizardBuildNext()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "you") {
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>About you</h2>
        <p class="wizard-lead">Date of birth drives ages on reports and state pension timing. Approximate is fine — you can correct it under People.</p>
        <div class="form-row">
          <div class="form-group">
            <label>Your name</label>
            <input type="text" id="wizName" placeholder="e.g. Alex" value="${escapeHtml(p0.name || "")}">
          </div>
          <div class="form-group">
            <label>Date of birth</label>
            <input type="date" id="wizDob" value="${p0.dateOfBirth || ""}">
          </div>
        </div>
        <div class="form-group">
          <label>Plan title <span class="field-hint">(optional)</span></label>
          <input type="text" id="wizPlanTitle" placeholder="e.g. Household plan" value="${escapeHtml(currentPlan.meta?.planTitle || "")}">
        </div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSaveYou()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    setTimeout(() => document.getElementById("wizName")?.focus(), 40);
    return;
  }

  if (step.id === "partner") {
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>Anyone else on this plan?</h2>
        <p class="wizard-lead">Leave blank if it's just you. Adding a second person makes this a shared household plan automatically.</p>
        <div class="form-row">
          <div class="form-group">
            <label>Partner / other name</label>
            <input type="text" id="wizPartnerName" placeholder="Optional" value="${escapeHtml(p1.name || "")}">
          </div>
          <div class="form-group">
            <label>Their date of birth</label>
            <input type="date" id="wizPartnerDob" value="${p1.dateOfBirth || ""}">
          </div>
        </div>
        <div class="wizard-done-box" style="margin-top:12px;">
          <strong>So far:</strong> ${escapeHtml(p0.name || "You")} is on the plan.
          Edit people anytime under <strong>People</strong>.
        </div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSavePartner()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "money") {
    const savings = (currentPlan.accounts || []).find(a => a.type === "current_savings") || {};
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>Accessible savings</h2>
        <p class="wizard-lead">We'll add one <strong>Current / Savings</strong> pot. Growth is set to track <strong>inflation</strong> for now — change rate or mode later on the account under Accounts.</p>
        <div class="form-group">
          <label>Balance today (£)</label>
          <input type="number" id="wizSavBal" min="0" step="100" value="${savings.startBalance != null ? savings.startBalance : 10000}">
        </div>
        <div class="wizard-done-box">
          <strong>Keep accounts simple where you can</strong> — one of each type is usually enough (e.g. one Cash ISA, one SIPP). The fewer you have, the easier LifePlan is to use. Multiple accounts of the same type are allowed if you need them. Add more anytime from Accounts.
        </div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSaveMoney()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "horizon") {
    applyPlanScaleFromPeople();
    const startY = currentPlan.scale?.startYear || new Date().getFullYear();
    const endY = currentPlan.scale?.endYear || startY + 40;
    const fundY = currentPlan.spend?.fundUntil || endY;
    const minNW = Math.round(Number(currentPlan.spend?.minNetWorthAtFund) || 0);
    const ageEnd = agesAtYearHint(endY);
    const ageFund = agesAtYearHint(fundY);
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>How far should the plan run?</h2>
        <p class="wizard-lead">Defaults assume the youngest person lives to 100 — change either year if that does not suit you.</p>

        <div class="wizard-done-box" style="margin-bottom:14px;">
          <strong>Plan end year</strong>
          <span class="field-hint" id="wizEndAgeLabel" style="display:block;margin:4px 0 8px;">${ageEnd ? "Ages in that year: " + escapeHtml(ageEnd) : "Add dates of birth to show ages"}</span>
          <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.45;">How far graphs and reports go. It does not change how long savings support your spending.</p>
          <div class="form-group" style="margin:0;">
            <label>Plan end year <span class="field-hint" id="wizEndAgeInline">${ageEnd ? "(" + escapeHtml(ageEnd) + ")" : ""}</span></label>
            <input type="number" id="wizEndYear" min="${startY + 1}" value="${endY}">
          </div>
        </div>

        <div class="wizard-done-box" style="margin-bottom:14px;">
          <strong>Fund until</strong>
          <span class="field-hint" id="wizFundAgeLabel" style="display:block;margin:4px 0 8px;">${ageFund ? "Ages in that year: " + escapeHtml(ageFund) : "Add dates of birth to show ages"}</span>
          <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.45;">LifePlan works out spending so savings help finance you <em>until this year</em>. After that, spend is matched to income only (no further draw on savings). You may want an earlier year than 100 if you only need that support for part of life.</p>
          <div class="form-group" style="margin:0 0 12px;">
            <label>Fund until <span class="field-hint" id="wizFundAgeInline">${ageFund ? "(" + escapeHtml(ageFund) + ")" : ""}</span></label>
            <input type="number" id="wizFundUntil" min="${startY}" value="${fundY}">
          </div>
          <div class="form-group" style="margin:0;">
            <label>Minimum savings at Fund until (£)</label>
            <input type="number" id="wizMinNW" min="0" step="1000" value="${minNW}">
            <p class="field-hint" style="margin-top:6px;">A cushion left in the plan at Fund until (for example £10,000). <strong>0</strong> means the solver can aim for empty pots. Solve balance / Reset targets aim for at least this amount.</p>
          </div>
        </div>

        <p class="field-hint">Fund until cannot be after the plan end year.</p>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSaveHorizon()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    setTimeout(() => {
      const syncAges = () => {
        const e = parseInt(document.getElementById("wizEndYear")?.value, 10);
        const f = parseInt(document.getElementById("wizFundUntil")?.value, 10);
        const set = (year, labelId, inlineId) => {
          const hint = year ? agesAtYearHint(year) : "";
          const lab = document.getElementById(labelId);
          const inl = document.getElementById(inlineId);
          if (lab) lab.textContent = hint ? "Ages in that year: " + hint : "Add dates of birth to show ages";
          if (inl) inl.textContent = hint ? "(" + hint + ")" : "";
        };
        set(e, "wizEndAgeLabel", "wizEndAgeInline");
        set(f, "wizFundAgeLabel", "wizFundAgeInline");
        if (e && f && f > e) {
          const fEl = document.getElementById("wizFundUntil");
          if (fEl) fEl.value = String(e);
          set(e, "wizFundAgeLabel", "wizFundAgeInline");
        }
      };
      document.getElementById("wizEndYear")?.addEventListener("input", syncAges);
      document.getElementById("wizFundUntil")?.addEventListener("input", syncAges);
    }, 30);
    return;
  }

  if (step.id === "statepension") {
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>State pension</h2>
        <p class="wizard-lead">If you tick yes, a default State Pension is <strong>automatically added to your incomes</strong> (using Assumptions — start at state pension age from date of birth). Check and change the amount later under Income.</p>
        <label class="inline-check" style="display:block;margin:12px 0;">
          <input type="checkbox" id="wizStatePension" checked>
          Yes — include state pension for ${escapeHtml(p0.name || "me")}
        </label>
        ${p1.name ? `
        <label class="inline-check" style="display:block;margin:8px 0;">
          <input type="checkbox" id="wizStatePension2" checked>
          Yes — include state pension for ${escapeHtml(p1.name)}
        </label>` : ""}
        <div class="wizard-done-box">We'll set the start date to each person's state pension age birthday. Untick if not relevant.</div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSaveStatePension()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "income") {
    const list = currentPlan.income || [];
    const personOpts = (currentPlan.people || []).filter(p => p.name).map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join("") || `<option value="p1">${escapeHtml(p0.name || "You")}</option>`;
    const typeOpts = INCOME_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join("");
    const listHtml = list.length
      ? `<ul class="wizard-inc-list">${list.map(i => {
          const tl = (INCOME_TYPES.find(t => t.value === i.type) || {}).label || i.type;
          return `<li><strong>${escapeHtml(i.name)}</strong> · ${escapeHtml(tl)} · ${formatMoney(i.amountMonthly)}/mo · ${escapeHtml(getPersonName(i.personId))}</li>`;
        }).join("")}</ul>`
      : `<p class="field-hint">No incomes added yet.</p>`;
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>Income</h2>
        <p class="wizard-lead">Add your salary, pension or other regular money. Leave amount at 0 and skip if none — savings-only plans still work.</p>
        <div class="form-row">
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="wizIncName" value="Main income" placeholder="e.g. Salary">
          </div>
          <div class="form-group">
            <label>Who</label>
            <select id="wizIncPerson">${personOpts}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Type</label>
            <select id="wizIncType">${typeOpts}</select>
          </div>
          <div class="form-group">
            <label>Start date</label>
            <input type="date" id="wizIncStart" value="${(currentPlan.scale?.startYear || new Date().getFullYear())}-01-01">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Amount</label>
            <input type="number" id="wizIncAmt" min="0" step="50" value="0">
          </div>
          <div class="form-group">
            <label>Paid</label>
            <select id="wizIncFreq">
              <option value="monthly" selected>Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div class="wizard-actions" style="justify-content:flex-start;margin-top:12px;">
          <button type="button" class="btn-primary" onclick="wizardBuildAddIncome()">+ Add this income</button>
        </div>
        <div style="margin-top:12px;">
          <strong style="font-size:12px;color:#64748B;">Added so far</strong>
          ${listHtml}
        </div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildFinishIncome()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "spend") {
    ensureSpend();
    const ess = (currentPlan.spend.pots || []).find(p => p.isEssential);
    const essMo = ess ? Math.round(toMonthly(ess.amountAnnual)) : 1500;
    body.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-badge">Build · ${wizardStep + 1} of ${steps.length}</div>
        <h2>Essential monthly spend</h2>
        <p class="wizard-lead">Housing, food, bills — the must-pays. Next we'll run <strong>Reset targets</strong> and <strong>Rebase</strong> so Non Essential Spend is a sensible starting shape.</p>
        <div class="form-group">
          <label>Essential spend (£ / month)</label>
          <input type="number" id="wizEssMo" min="0" step="50" value="${essMo}">
        </div>
        <div class="wizard-done-box">
          You can reshape Non Essential Spend on the Spend page anytime, then Solve balance on the dashboard.
        </div>
        <div class="wizard-actions">
          <button type="button" class="btn-secondary" onclick="pauseWizard()">Pause</button>
          <button type="button" class="btn-secondary" onclick="wizardBuildBack()">Back</button>
          <button type="button" class="btn-primary" onclick="wizardBuildSaveSpend()">Continue</button>
        </div>
        ${wizardFooterNote()}
      </div>`;
    return;
  }

  if (step.id === "done") {
    renderWizardBuildDone();
  }
}

function wizardBuildNext() {
  wizardStep = Math.min(wizardStep + 1, WIZARD_BUILD.length - 1);
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildNext = wizardBuildNext;

function dobFromAge(age) {
  const a = parseInt(age, 10);
  if (!a || a < 1 || a > 120) return "";
  const y = new Date().getFullYear() - a;
  return `${y}-06-15`;
}

function isReasonableDob(dobStr) {
  if (!dobStr) return { ok: true };
  const d = new Date(dobStr);
  if (isNaN(d.getTime())) return { ok: false, msg: "Please enter a valid date of birth." };
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (age < 0 || age > 150) {
    return {
      ok: false,
      msg: "That date of birth looks wrong (age must be between 0 and 150). Check you entered the full year, e.g. 1969 not 69."
    };
  }
  if (d.getFullYear() < 1850) {
    return { ok: false, msg: "Year of birth looks too early. Please use a four-digit year (e.g. 1969)." };
  }
  return { ok: true };
}

function wizardBuildSaveYou() {
  const name = (document.getElementById("wizName")?.value || "").trim();
  if (!name) {
    alert("Please enter your name.");
    return;
  }
  const dob = document.getElementById("wizDob")?.value || "";
  const dobCheck = isReasonableDob(dob);
  if (!dobCheck.ok) {
    alert(dobCheck.msg);
    return;
  }
  const title = (document.getElementById("wizPlanTitle")?.value || "").trim();
  if (!currentPlan.people[0]) currentPlan.people[0] = { id: "p1", name: "", dateOfBirth: "", photo: null };
  currentPlan.people[0].name = name;
  if (dob) currentPlan.people[0].dateOfBirth = dob;
  if (!currentPlan.meta) currentPlan.meta = {};
  currentPlan.meta.planTitle = title || "Plan";
  if (!currentPlan.meta.name) currentPlan.meta.name = "Plan";
  // Scale updates after partner step when we know full household
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "partner");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  updateSidebarUser();
  updateSidebarPlanLabel();
  renderWizardBuild();
}
window.wizardBuildSaveYou = wizardBuildSaveYou;

function wizardBuildSavePartner() {
  const name = (document.getElementById("wizPartnerName")?.value || "").trim();
  const dob = document.getElementById("wizPartnerDob")?.value || "";
  if (name) {
    const dobCheck = isReasonableDob(dob);
    if (dob && !dobCheck.ok) {
      alert(dobCheck.msg);
      return;
    }
    if (!currentPlan.people[1]) currentPlan.people[1] = { id: "p2", name: "", dateOfBirth: "", photo: null };
    currentPlan.people[1].name = name;
    if (dob) currentPlan.people[1].dateOfBirth = dob;
  } else if (currentPlan.people[1] && !currentPlan.people[1].name) {
    // leave empty second slot
  }
  const named = (currentPlan.people || []).filter(p => (p.name || "").trim()).length;
  currentPlan.isJoint = named >= 2;
  // Scale defaults only — do not touch settings (link dates, etc.)
  applyPlanScaleFromPeople();
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "money");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  updateSidebarUser();
  renderWizardBuild();
}
window.wizardBuildSavePartner = wizardBuildSavePartner;

function agesAtYearHint(year) {
  const people = (currentPlan.people || []).filter(p => p.name && p.dateOfBirth);
  if (!people.length) return "";
  return people.map(p => {
    const a = ageTurningInYear(p, year);
    return `${p.name.split(/\s+/)[0]} ${a != null ? a : "—"}`;
  }).join(" · ");
}

function wizardBuildSaveHorizon() {
  const endY = parseInt(document.getElementById("wizEndYear")?.value, 10);
  const fundY = parseInt(document.getElementById("wizFundUntil")?.value, 10);
  const startY = currentPlan.scale?.startYear || new Date().getFullYear();
  if (!endY || endY <= startY) {
    alert("Plan end year must be after the start year (" + startY + ").");
    return;
  }
  if (!fundY || fundY < startY) {
    alert("Fund until must be on or after the plan start year.");
    return;
  }
  if (fundY > endY) {
    alert("Fund until cannot be after the plan end year. Extend the end year first, or lower Fund until.");
    return;
  }
  if (!currentPlan.scale) currentPlan.scale = {};
  currentPlan.scale.startYear = startY;
  currentPlan.scale.endYear = endY;
  ensureSpend();
  currentPlan.spend.fundUntil = fundY;
  currentPlan.spend.minNetWorthAtFund = Math.max(0, parseFloat(document.getElementById("wizMinNW")?.value) || 0);
  // Align essential pot span with plan scale
  (currentPlan.spend.pots || []).forEach(p => {
    if (p.isEssential) {
      p.fromYear = startY;
      p.toYear = endY;
    }
  });
  // Now fund-until is set — shape and balance the plan (same as Reset then Rebase)
  try {
    if (typeof resetTargets === "function") resetTargets();
    if (typeof rebaseTargets === "function") rebaseTargets();
  } catch (e) {
    console.warn("wizard balance", e);
  }
  // Horizon is last data step before summary — never touch settings here
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "done");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildSaveHorizon = wizardBuildSaveHorizon;

function wizardAddStatePensionForPerson(person) {
  if (!person?.id) return;
  ensureAssumptions();
  if (!currentPlan.income) currentPlan.income = [];
  if (currentPlan.income.some(i => i.type === "state_pension" && i.personId === person.id)) return;
  const spa = Number(currentPlan.assumptions?.statePension?.spaAge) || 67;
  let startDate = `${currentPlan.scale?.startYear || new Date().getFullYear()}-01-01`;
  if (person.dateOfBirth) {
    const dob = new Date(person.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const spaDate = new Date(dob.getFullYear() + spa, dob.getMonth(), dob.getDate());
      startDate = formatDateYMD(spaDate);
    }
  }
  const sp = currentPlan.assumptions.statePension || {};
  const baseAnnual = Number(sp.annualAmount) || 11502;
  const baseYear = Number(sp.quoteYear) || new Date().getFullYear();
  const startY = new Date(startDate).getFullYear();
  const rate = getInflationRate();
  let annual = baseAnnual;
  if (sp.growWithInflation !== false && startY > baseYear) {
    annual = baseAnnual * Math.pow(1 + rate, startY - baseYear);
  }
  currentPlan.income.push({
    id: uid(),
    name: "State Pension" + (person.name ? ` (${person.name})` : ""),
    personId: person.id,
    type: "state_pension",
    amountInput: Math.round(annual / 12),
    amountFreq: "monthly",
    amountMonthly: annual / 12,
    startDate,
    endDate: null,
    growthMode: "inflation",
    growthRate: 0,
    taxable: true,
    color: "#0EA5E9"
  });
}

async function wizardBuildSaveStatePension() {
  const overSpa = [];
  const checkAge = (person, checked) => {
    if (!checked || !person?.dateOfBirth) return;
    const age = ageTurningInYear(person, new Date().getFullYear());
    if (age != null && age >= 67) overSpa.push(person.name || "Someone");
  };
  const c1 = !!document.getElementById("wizStatePension")?.checked;
  const c2 = !!document.getElementById("wizStatePension2")?.checked;
  if (c1) wizardAddStatePensionForPerson(currentPlan.people[0]);
  if (c2 && currentPlan.people[1]?.name) wizardAddStatePensionForPerson(currentPlan.people[1]);
  checkAge(currentPlan.people[0], c1);
  checkAge(currentPlan.people[1], c2);
  if (overSpa.length) {
    await appAlert(
      "A default state pension amount has been added for " + overSpa.join(" and ") +
      " (age 67+). Please check and update the figure under Income — the Assumptions default may not match what you actually receive."
    );
  }
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "income");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildSaveStatePension = wizardBuildSaveStatePension;

function wizardBuildSaveMoney() {
  const bal = parseFloat(document.getElementById("wizSavBal")?.value) || 0;
  if (!currentPlan.accounts) currentPlan.accounts = [];
  let acc = currentPlan.accounts.find(a => a.type === "current_savings");
  const owner = currentPlan.people[0]?.id || "p1";
  const infPct = (typeof getInflationRate === "function" ? getInflationRate() : 0.025) * 100;
  if (!acc) {
    acc = {
      id: uid(),
      name: "Savings",
      ownerId: owner,
      type: "current_savings",
      startDate: `${currentPlan.scale?.startYear || new Date().getFullYear()}-01-01`,
      startBalance: bal,
      annualGrowth: infPct,
      growthMode: "inflation",
      themeColor: "#7C3AED",
      overrides: {}
    };
    currentPlan.accounts.push(acc);
  } else {
    acc.startBalance = bal;
    acc.growthMode = "inflation";
    acc.annualGrowth = infPct;
    if (!acc.name) acc.name = "Savings";
  }
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "statepension");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildSaveMoney = wizardBuildSaveMoney;

function wizardBuildAddIncome() {
  const amt = parseFloat(document.getElementById("wizIncAmt")?.value) || 0;
  const freq = document.getElementById("wizIncFreq")?.value || "monthly";
  const name = (document.getElementById("wizIncName")?.value || "Income").trim();
  const type = document.getElementById("wizIncType")?.value || "employment";
  const personId = document.getElementById("wizIncPerson")?.value || currentPlan.people[0]?.id || "p1";
  const startDate = document.getElementById("wizIncStart")?.value || `${currentPlan.scale?.startYear || new Date().getFullYear()}-01-01`;
  let monthly = amt;
  if (freq === "weekly") monthly = amt * 52 / 12;
  else if (freq === "yearly") monthly = amt / 12;
  if (amt <= 0) {
    alert("Enter an amount greater than 0, or Continue without adding.");
    return;
  }
  if (!currentPlan.income) currentPlan.income = [];
  currentPlan.income.push({
    id: uid(),
    name,
    personId,
    type,
    amountInput: amt,
    amountFreq: freq,
    amountMonthly: monthly,
    startDate,
    endDate: null,
    growthMode: "inflation",
    growthRate: 0,
    taxable: type !== "state_pension",
    color: type === "state_pension" ? "#0EA5E9" : "#059669"
  });
  autoSave();
  renderWizardBuild();
}
window.wizardBuildAddIncome = wizardBuildAddIncome;

async function wizardBuildFinishIncome() {
  const amt = parseFloat(document.getElementById("wizIncAmt")?.value) || 0;
  if (amt > 0) {
    const ok = await appConfirmYesNo(
      "You entered an amount but have not pressed “+ Add this income”.\n\nAdd it now before continuing?",
      "Add it",
      "Continue without adding"
    );
    if (ok) {
      wizardBuildAddIncome();
      // stay on step so they see the list
      return;
    }
  }
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "spend");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildFinishIncome = wizardBuildFinishIncome;

function wizardBuildSaveSpend() {
  ensureSpend();
  const essMo = parseFloat(document.getElementById("wizEssMo")?.value);
  const essAnnual = (isFinite(essMo) ? essMo : 1500) * 12;
  let ess = (currentPlan.spend.pots || []).find(p => p.isEssential);
  if (!ess) {
    ess = {
      id: "essential",
      name: "Essential",
      amountAnnual: essAnnual,
      fromYear: currentPlan.scale.startYear,
      toYear: currentPlan.scale.endYear,
      inflate: true,
      color: "#94A3B8",
      overrides: {},
      isEssential: true
    };
    currentPlan.spend.pots.unshift(ess);
  } else {
    ess.amountAnnual = essAnnual;
  }
  // Reset/rebase runs after horizon (fund until + min savings) is known
  wizardStep = WIZARD_BUILD.findIndex(s => s.id === "horizon");
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildSaveSpend = wizardBuildSaveSpend;

function wizardBuildBack() {
  wizardStep = Math.max(0, wizardStep - 1);
  currentPlan.meta.wizardStep = wizardStep;
  autoSave();
  renderWizardBuild();
}
window.wizardBuildBack = wizardBuildBack;

function renderWizardBuildDone() {
  const body = document.getElementById("wizardBody");
  const bar = document.getElementById("wizardProgressBar");
  if (!body) return;
  if (bar) bar.style.width = "100%";

  const name = currentPlan.people[0]?.name || "You";
  const partner = currentPlan.people[1]?.name;
  const sav = (currentPlan.accounts || []).find(a => a.type === "current_savings");
  const inc = (currentPlan.income || [])[0];
  const ess = (currentPlan.spend?.pots || []).find(p => p.isEssential);
  const years = getPlanYears();
  const y0 = years[0] || new Date().getFullYear();
  const nesMo = typeof getNonEssentialDisplayForYear === "function"
    ? Math.round(toMonthly(getNonEssentialDisplayForYear(y0)))
    : 0;
  const spendMo = typeof getSpendForYear === "function"
    ? Math.round(toMonthly(toDisplayMoney(getSpendForYear(y0), y0)))
    : nesMo;

  body.innerHTML = `
    <div class="wizard-step">
      <div class="wizard-badge">Done</div>
      <h2>Your basic plan is ready</h2>
      <p class="wizard-lead">Here's what we set up for <strong>${escapeHtml(name)}</strong>${partner ? ` &amp; <strong>${escapeHtml(partner)}</strong>` : ""}. Treat every figure as a starting point — change anything that doesn't look right.</p>
      <ul class="wizard-summary">
        <li><strong>People</strong> — ${escapeHtml(name)}${partner ? ", " + escapeHtml(partner) : ""}</li>
        <li><strong>Savings</strong> — ${sav ? formatMoney(sav.startBalance) + " @ " + (sav.annualGrowth ?? "—") + "%" : "—"}</li>
        <li><strong>Income</strong> — ${inc && inc.amountMonthly ? formatMoney(inc.amountMonthly) + "/mo (" + escapeHtml(inc.name) + ")" : "None added"}</li>
        <li><strong>Essential</strong> — ${ess ? formatMoney(toMonthly(ess.amountAnnual)) + "/mo" : "—"}</li>
        <li><strong>Non Essential Spend (start)</strong> — about ${formatMoney(nesMo)}/mo</li>
        <li><strong>Total monthly spend (start)</strong> — about ${formatMoney(spendMo)}</li>
      </ul>
      <div class="wizard-done-box">
        <strong>Suggested next steps</strong>
        <ol style="margin:8px 0 0 1.1rem;padding:0;">
          <li>Read <strong>Help → Things you should know</strong> — short guide to the gauge, Solve balance, and today’s money</li>
          <li>Open the <strong>Dashboard</strong> — check monthly spend and the balance gauge</li>
          <li>Add more accounts or incomes if you need them</li>
          <li>On <strong>Spend</strong>, reshape Non Essential Spend or run Solve balance</li>
        </ol>
      </div>
      <div class="wizard-actions">
        <button type="button" class="btn-secondary" onclick="completeWizard();openHelp('know');">Things you should know</button>
        <button type="button" class="btn-secondary" onclick="goToPage('spend');hideWizardUI();">Review spend</button>
        <button type="button" class="btn-primary" onclick="completeWizard()">Go to dashboard</button>
      </div>
      ${wizardFooterNote()}
    </div>`;
}

function updateSidebarUser() {
  // Household (bold) + plan title underneath — double-click opens editor
  updateSidebarPlanLabel();
  const card = document.getElementById("userCard") || document.querySelector(".sidebar-bottom .user-card");
  if (card) {
    card.title = "Double-click to edit plan name";
    card.ondblclick = openPlanNameEditor;
  }
}
window.updateSidebarUser = updateSidebarUser;

function renamePlanInline() {
  openPlanNameEditor();
  return;
  const current = currentPlan.meta?.name || "Untitled Plan";
  const next = prompt("Plan name:", current);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  currentPlan.meta.name = trimmed;
  autoSave();
  updateSidebarUser();
  // Refresh header if on dashboard
  const active = document.querySelector(".navButton.active");
  if (active && active.dataset.page === "dashboard") refreshDashboardView();
}
window.renamePlanInline = renamePlanInline;


// ========== HELP SYSTEM ==========
const HELP_TREE = {
  id: "home",
  title: "Help home",
  body: `
    <p><strong>Welcome to LifePlan</strong> — a spend-led lifelong money model. You put in people, pots, income and spending; the app projects balances over the plan years and helps you find a sustainable monthly spend.</p>
    <p>Use the topics list (☰) to jump around. Help opens on the section that matches the page you are on.</p>
    <p>This guide will grow as features are finished — treat it as a starter.</p>
  `,
  children: [
    {
      id: "know",
      title: "Things you should know",
      body: `
        <p>A short starter for everyday use of LifePlan.</p>
        <h3>Monthly spend</h3>
        <p>The main number: what the plan suggests you can spend each month. It combines essential costs, other spend pots, and <strong>Non Essential Spend (NES)</strong>.</p>
        <h3>The gauge</h3>
        <p>Shows whether the plan is roughly <strong>on target</strong> (green), under-funded or over-spending (red / yellow). The pointer is the estimated effect on <em>monthly</em> spend if you rebalanced to hit Fund until cleanly.</p>
        <h3>Solve balance</h3>
        <p>Keeps the <em>shape</em> of your NES targets and scales them so net worth reaches your <strong>minimum savings</strong> (default £0) at <strong>Fund until</strong>, without going negative earlier. It does not wipe hand-tuned years. Use after big changes to savings, income or targets.</p>
        <h3>Reset vs Rebase targets</h3>
        <p><strong>Reset</strong> — first-time setup: flat targets then solve. <strong>Rebase</strong> — keep your shape, shift the level (e.g. after markets moved).</p>
        <h3>Today’s money switch</h3>
        <p>Calculations always use inflation behind the scenes. With the switch <em>off</em>, charts and numbers show values in today’s money (easier to compare lifestyle). With it <em>on</em>, you see nominal pounds of each year.</p>
        <h3>Fund until</h3>
        <p>LifePlan finances your spending from savings <em>until</em> this year. After that, total spend is matched to income only (no further draw on pots). You may want Fund until earlier than plan end if you only need support for part of life. Plan end year is only how far graphs run.</p>
        <h3>Minimum savings at Fund until</h3>
        <p>Instead of aiming for £0, set a cushion (e.g. £10,000). <strong>Solve balance</strong> / Reset / Rebase aim for at least that residual net worth at Fund until.</p>
        <h3>Save your work</h3>
        <p>The browser keeps a working copy automatically. Use <strong>Save / Save as</strong> for a portable <code>.lifeplan.json</code> file you can back up or share.</p>
        <h3>Accounts tip</h3>
        <p>Prefer one account per type where you can — fewer pots make LifePlan easier to read and adjust.</p>
      `
    },
    {
      id: "dashboard",
      title: "Dashboard",
      body: `
        <p>Your overview: key metrics, charts, and day-to-day controls for balancing the plan.</p>
        <ul>
          <li><strong>Top cards</strong> — monthly spend, net worth, cash reserve, income. Change year with the side control or mouse wheel; double-click resets to this year. Optional <em>link dates</em> in Settings keeps the four years in sync.</li>
          <li><strong>Charts</strong> — pick what each large chart shows; double-click to expand.</li>
          <li><strong>NES panel</strong> — view shape; double-click for the full editor bubble. <em>Solve balance</em> lands net worth near £0 at Fund until.</li>
          <li><strong>Warnings</strong> — red strip if the plan is underfunded, leaves money unused, or hits zero early then rebuilds.</li>
        </ul>
      `,
      children: [
        { id: "dashboard-metrics", title: "Metric cards", body: "<p>Net worth and cash show opening and closing for the selected year (display follows the inflation toggle). Income includes earned sources plus estimated interest. Hover income for a breakdown.</p>" },
        { id: "dashboard-solve", title: "Solve balance", body: "<p>Keeps your target <em>shape</em> and adjusts the model ratio so unclamped net worth is about zero at Fund until. If already on target, Solve does nothing (avoids drift). Setup of shape and Fund until lives on the Spend page.</p>" },
        { id: "dashboard-gauge", title: "Balance gauge", body: "<p><strong>Effect per month</strong> spreads leftover or shortfall over the months to Fund until. Labels: On target, Underfunded, Shape warning, Under/Over budget. A soft sound can play after Solve (Settings → Sound effects).</p>" },
        { id: "dashboard-warnings", title: "Plan warnings", body: "<p><strong>Underfunded</strong> — not enough money without going overdrawn. <strong>Shape</strong> — hits ~£0 before fund-until then rebuilds (often too much early spend). <strong>Under budget</strong> — money left at fund-until. Warnings appear as a red strip above one-offs and as a popup after Solve when needed.</p>" }
      ]
    },
    {
      id: "accounts",
      title: "Accounts",
      body: `
        <p>Every pot of money — current/savings, ISAs, SIPP, and so on. New accounts default to Current / Savings.</p>
        <ul>
          <li>Add, edit or delete from the list (delete asks for confirmation).</li>
          <li>Growth: Inflation / Other rate / Inflation adjusted (Custom reserved).</li>
          <li>Override individual years on the account chart where supported.</li>
        </ul>
      `,
      children: [
        { id: "accounts-types", title: "Account types", body: "<p>LifePlan works best when you keep accounts simple: ideally <strong>one of each type</strong> you need (one Current/Savings, one Cash ISA, one SIPP, and so on). The fewer accounts you have, the easier LifePlan is to use. You <em>can</em> add multiple accounts of the same type if you need them — strategy can target a specific account by name — but start minimal.</p>" },
        { id: "accounts-growth", title: "Growth & interest", body: "<p>Interest is applied on the balance at the start of each projection step (opening-style), before income/spend transfers. With <em>Show inflation</em> off, displayed balances back out plan inflation (so a 1.5% account can look like it falls in real terms when inflation is 2.5%).</p>" },
        { id: "accounts-sipp", title: "SIPP (DC)", body: "<p><strong>SIPP</strong> — accumulation pot; optional planned drawdown month and tax-free cash mode. You can still contribute.</p><p><strong>SIPP in drawdown</strong> — separate type for a pot already in drawdown. Strategy will not add surplus into it. Tax-free options: 25% PCLS taken, or tax-free as you withdraw. Auto-convert from SIPP on the planned month is on the roadmap; for now switch the type (or split pots) when drawdown starts.</p>" }
      ]
    },
    {
      id: "income",
      title: "Income",
      body: `
        <p>Regular money in: employment, defined benefit pension, state pension, and other. Amount can be entered weekly, monthly or yearly; the model stores a monthly equivalent. First/last years are pro-rated from start/end dates.</p>
      `,
      children: [
        { id: "income-tax", title: "Tax", body: "<p>Tax is set <strong>per person</strong> under People. Taxable sources are summed and tax is subtracted in the projection. Savings &amp; investing tax is not modelled in detail — use a lower growth rate for tax drag if needed.</p>" },
        { id: "income-db", title: "Defined benefit pension", body: "<p>Enter the income you expect <em>at the start date</em> (scheme statement / modeller). Split the part that increases with inflation (or a custom rate) from any flat part. Optional tax-free lump sum is taken as a one-off in the start year (not in monthly spend).</p>" },
        { id: "income-state", title: "State pension", body: "<p>Use <strong>Populate from assumptions</strong> to fill amount from Assumptions → State pension defaults. The quote can be grown with plan inflation from the quote year to the income start date. Set SPA age there for reference.</p>" }
      ]
    },
    {
      id: "spend",
      title: "Spend",
      body: `
        <p>Essential pots, one-offs, and non-essential (NES) lifestyle spend. Figures are shown per month. Calculations always run in nominal terms; the inflation toggle only changes what you <em>see</em> and edit.</p>
        <ul>
          <li>Drag nodes or use the scroll wheel (step on the NES toolbar).</li>
          <li>Double-click a node (or a multi-selection) for value, bandwidth, or reset.</li>
          <li>Blend: select two or more years, then Straight or Curve to taper between anchors.</li>
          <li>Reset / Rebase on Spend; Solve on the dashboard for day-to-day balance.</li>
        </ul>
      `,
      children: [
        { id: "spend-essential", title: "Essential pots", body: "<p>First pot is Essential and cannot be removed. Other pots can be added with from/to years, growth mode, and colour.</p>" },
        { id: "spend-noness", title: "NES (non-essential)", body: "<p>Targets are stored in <strong>today’s money</strong>. The engine multiplies by the inflation factor each year so NES tracks inflation in nominal cashflows. Display: Show inflation on = nominal; off = real.</p><p><strong>Reset targets</strong> — starting shape from capital/years + first-year net cash; ratio = 1.</p><p><strong>Rebase / Solve</strong> — scale the model ratio so the plan balances (unclamped path so overspend is visible).</p><p><strong>Multi-select</strong> — Ctrl/Cmd toggle, Shift range; double-click edits all selected; wheel moves them together. <strong>Blend</strong> fills a straight line or smooth curve between the first and last selected year.</p>" },
        { id: "spend-oneoff", title: "One-off spends", body: "<p>Named spends by year (and optional month). Deducted from wealth that year but not included in headline monthly spend. Shown on the dashboard strip.</p>" },
        { id: "spend-inflation", title: "Inflation toggle", body: "<p>Behind the scenes everything is nominal. With the toggle off, displayed values (and NES edits) are inflation-backed-out using the plan inflation rate — not each item’s own growth rate.</p>" }
      ]
    },
    {
      id: "people",
      title: "People",
      body: "<p>Who is on the plan. Names, dates of birth, joint flag, optional photo. Accounts and income can be linked to a person. Tax settings live per person.</p>",
      children: [
        { id: "people-joint", title: "Joint plans", body: "<p>One shared household model (not separate dual ledgers). Ownership tags still help you see whose pot is whose.</p>" }
      ]
    },
    {
      id: "strategy",
      title: "Strategy",
      body: `
        <p>Life-stage blocks on a timeline control how money moves when there is surplus or shortfall, plus optional actions (e.g. transfer a fixed amount into a named ISA).</p>
        <p>Default / Steady: everything through Current / Savings first, then actions can move money to specific accounts.</p>
      `,
      children: [
        { id: "strategy-timeline", title: "Timeline blocks", body: "<p>Blocks cover the plan years edge-to-edge (no overlap). Drag to reorder; resize edges to change years. Double-click a block to edit actions.</p>" },
        { id: "strategy-actions", title: "Actions", body: "<p>Pick action type, account type, then the specific account name, and amount. Transfers run after income/spend has hit the hub each year.</p>" }
      ]
    },
    {
      id: "plans",
      title: "Plans (templates)",
      body: `
        <p>Pre-built shapes you can apply to one part of the model (spend, strategy, …), then tweak. Templates have defaults and can be adjusted before you implement.</p>
        <p>They do not replace your whole file — they write targets or rules into the current plan.</p>
      `,
      children: [
        { id: "plans-spend", title: "Spend templates", body: "<p><strong>Spend to retirement</strong> builds an NES target that tracks inflation until a retirement age, then falls in real terms (e.g. 1% below inflation, then 2%). Uses the first person’s date of birth when available. Implement writes year overrides; you can still edit nodes afterwards.</p>" },
        { id: "plans-strategy", title: "Strategy templates", body: "<p>Placeholder for packs such as “starting to retire” or “building ISAs”. Coming next.</p>" }
      ]
    },
    {
      id: "reports",
      title: "Reports",
      body: "<p>Create summaries such as an annual PDF report. More report types can be added over time.</p>",
      children: []
    },
    {
      id: "assumptions",
      title: "Assumptions",
      body: "<p>Defaults that feed the model: inflation, illustrative tax bands, NI, and state pension quote (amount, year, SPA age, grow with inflation).</p>",
      children: [
        { id: "assumptions-state", title: "State pension defaults", body: "<p>Used by Income → State pension → Populate. Edit the full annual amount and the year that quote relates to. Optional growth from quote year to the income start date uses plan inflation.</p>" }
      ]
    },
    {
      id: "settings",
      title: "Settings",
      body: `
        <p>Plan files (import / save / save as / new), wizard, spend controls, plan scale years, link dates, auto-hide menu, sound effects, and theme colours.</p>
      `,
      children: [
        { id: "settings-spend", title: "Spend settings", body: "<p>Wheel step and multi-select also appear on the NES toolbar. Expert mode (when off) makes dashboard NES view-only.</p>" },
        { id: "settings-wizard", title: "Wizard", body: "<p>Guided setup with a pause after Income. Continue wizard from the sidebar or Settings until you mark the wizard completed.</p>" },
        { id: "settings-sound", title: "Sound", body: "<p>Optional soft bell when Solve balances; alert tone when it cannot fully balance. Toggle under Plan scale &amp; display.</p>" }
      ]
    },
    {
      id: "concepts",
      title: "How the model thinks",
      body: `
        <p>Unlike “how much do I need to retire?”, LifePlan asks what monthly spend is sustainable given pots, income and strategy, across life stages — not a single retirement cliff.</p>
        <ul>
          <li>Interest on opening-style balances each year</li>
          <li>Cashflow through Current / Savings unless strategy says otherwise</li>
          <li>NES targets in today’s money × inflation factor in the engine</li>
          <li>Solve balance scales non-essential spend to fund-until ≈ £0</li>
        </ul>
      `,
      children: [
        { id: "concepts-interest", title: "Interest timing", body: "<p>Calculated on the balance at the start of the year step (before that year’s transfers). Same idea as using opening balance in a spreadsheet — avoids circular references with mid-year moves.</p>" },
        { id: "concepts-tax", title: "Tax philosophy", body: "<p>Early versions stay light. Complex investment taxation is often better as a net return adjustment than full CGT/dividend engines.</p>" },
        { id: "concepts-pensions", title: "Pensions (DC / DB)", body: "<p><strong>DC (SIPP account):</strong> pot value with optional drawdown notes. <strong>DB (income):</strong> expected income at start, inflating vs flat parts, optional lump sum. <strong>State:</strong> populate from Assumptions.</p>" },
        { id: "concepts-balance", title: "Balance & zero floor", body: "<p>Live pots do not go below £0. Health checks use an unclamped path so overspend still shows as underfunded. A tiny residual is treated as on-target (same idea as using 0.00001 in a spreadsheet goal-seek).</p>" }
      ]
    }
  ]
};

let helpPath = ["home"]; // stack of ids from root

function findHelpNode(id, node = HELP_TREE) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const f = findHelpNode(id, c);
    if (f) return f;
  }
  return null;
}

function findHelpPath(id, node = HELP_TREE, trail = []) {
  const here = trail.concat(node.id);
  if (node.id === id) return here;
  for (const c of node.children || []) {
    const f = findHelpPath(id, c, here);
    if (f) return f;
  }
  return null;
}

function pageToHelpId(pageName) {
  const map = {
    dashboard: "dashboard",
    accounts: "accounts",
    income: "income",
    spend: "spend",
    people: "people",
    strategy: "strategy",
    reports: "reports",
    assumptions: "assumptions",
    settings: "settings",
    events: "home",
    plans: "plans",
    results: "home"
  };
  return map[pageName] || "home";
}

function currentPageName() {
  const active = document.querySelector(".navButton.active");
  return active?.dataset?.page || "dashboard";
}

function openHelp(topicId) {
  const startId = topicId || pageToHelpId(currentPageName());
  const path = findHelpPath(startId) || ["home"];
  helpPath = path;
  const panel = document.getElementById("helpPanel");
  const backdrop = document.getElementById("helpBackdrop");
  if (!panel || !backdrop) return;
  panel.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
  renderHelp();
}
window.openHelp = openHelp;

function closeHelp() {
  const panel = document.getElementById("helpPanel");
  const backdrop = document.getElementById("helpBackdrop");
  if (panel) {
    panel.classList.remove("open");
    setTimeout(() => { panel.hidden = true; }, 220);
  }
  if (backdrop) backdrop.hidden = true;
  const nav = document.getElementById("helpNavDropdown");
  if (nav) nav.hidden = true;
}
window.closeHelp = closeHelp;

function toggleHelpNav() {
  const nav = document.getElementById("helpNavDropdown");
  if (!nav) return;
  if (nav.hidden) {
    nav.hidden = false;
    renderHelpNav();
  } else {
    nav.hidden = true;
  }
}
window.toggleHelpNav = toggleHelpNav;

function renderHelpNav() {
  const nav = document.getElementById("helpNavDropdown");
  if (!nav) return;
  const lines = [];
  function walk(node, level) {
    const active = helpPath[helpPath.length - 1] === node.id;
    lines.push(`<button type="button" class="help-nav-item level-${level}${active ? " active" : ""}" onclick="goHelp('${node.id}')">${escapeHtml(node.title)}</button>`);
    (node.children || []).forEach(c => walk(c, Math.min(2, level + 1)));
  }
  walk(HELP_TREE, 0);
  nav.innerHTML = lines.join("");
}

function goHelp(id) {
  const path = findHelpPath(id);
  if (!path) return;
  helpPath = path;
  const nav = document.getElementById("helpNavDropdown");
  if (nav) nav.hidden = true;
  renderHelp();
}
window.goHelp = goHelp;

function renderHelp() {
  const id = helpPath[helpPath.length - 1] || "home";
  const node = findHelpNode(id) || HELP_TREE;
  const body = document.getElementById("helpBody");
  const crumb = document.getElementById("helpBreadcrumb");
  if (crumb) {
    crumb.innerHTML = helpPath.map((hid, i) => {
      const n = findHelpNode(hid);
      const label = escapeHtml(n?.title || hid);
      if (i === helpPath.length - 1) return `<span>${label}</span>`;
      return `<button type="button" onclick="goHelp('${hid}')">${label}</button> <span>›</span> `;
    }).join("");
  }
  if (!body) return;
  const children = (node.children || []).map(c =>
    `<button type="button" class="help-child-link" onclick="goHelp('${c.id}')">${escapeHtml(c.title)} →</button>`
  ).join("");
  body.innerHTML = `
    <h2>${escapeHtml(node.title)}</h2>
    ${node.body || ""}
    ${children ? `<h3>In this section</h3><div class="help-children">${children}</div>` : ""}
    <p class="help-note">Help content is a living draft — wording will track product changes.</p>
  `;
}



function maybeShowFirstVisitWelcome() {
  try {
    if (localStorage.getItem("lifeplan_welcomed") === "1") return;
  } catch (e) {}
  ensureWizardMeta();
  // Only when plan is essentially empty / new
  const empty = !(currentPlan.accounts || []).length && !(currentPlan.income || []).length;
  if (!empty && currentPlan.meta?.wizardComplete) return;

  const bar = document.createElement("div");
  bar.id = "welcomeBanner";
  bar.className = "welcome-banner";
  bar.innerHTML = `
    <div class="welcome-banner-inner">
      <div>
        <strong>Welcome to LifePlan</strong>
        <p>This is your private plan in this browser. Use the <em>Continue wizard</em> button (sidebar) for a guided setup — People, Accounts, Income, then Spend. You can pause anytime and return later.</p>
      </div>
      <div class="welcome-actions">
        <button type="button" class="btn-primary" id="welcomeStartWiz">Start wizard</button>
        <button type="button" class="btn-secondary" id="welcomeDismiss">Dismiss</button>
      </div>
    </div>`;
  const content = document.querySelector(".content") || document.body;
  content.insertBefore(bar, content.firstChild);
  document.getElementById("welcomeStartWiz")?.addEventListener("click", () => {
    try { localStorage.setItem("lifeplan_welcomed", "1"); } catch (e) {}
    bar.remove();
    if (typeof startWizard === "function") startWizard(0);
  });
  document.getElementById("welcomeDismiss")?.addEventListener("click", () => {
    try { localStorage.setItem("lifeplan_welcomed", "1"); } catch (e) {}
    bar.remove();
  });
  // Ensure continue wizard visible for new users
  if (currentPlan.meta) currentPlan.meta.wizardComplete = false;
  if (typeof updateContinueWizardBtn === "function") updateContinueWizardBtn();
}

// Initial dashboard render with live data
page.innerHTML = renderDashboard();
if (typeof attachNwHover === "function") attachNwHover();
if (typeof attachPieHovers === "function") attachPieHovers();
if (typeof attachDashboardSpendPanel === "function") attachDashboardSpendPanel();
if (typeof updateSidebarUser === "function") updateSidebarUser();
if (typeof updateSidebarPlanLabel === "function") updateSidebarPlanLabel();
if (typeof updateContinueWizardBtn === "function") updateContinueWizardBtn();
if (typeof pushUndoSnapshot === "function") pushUndoSnapshot("Initial");
if (typeof applySidebarAutoHide === "function") applySidebarAutoHide();
if (typeof shouldShowWizard === "function" && shouldShowWizard()) {
  setTimeout(() => startWizard(), 200);
} else if (typeof maybeShowFirstVisitWelcome === "function") {
  setTimeout(() => maybeShowFirstVisitWelcome(), 300);
}
