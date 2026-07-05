// 京都はんなり見張り番 - ポップアップUI ロジック

import { pickPhrase, pickPraise, PHRASES } from "../shared/phrases.js";

const $ = (id) => document.getElementById(id);

let state = null;

init();

async function init() {
  try {
    state = await chrome.runtime.sendMessage({ type: "getState" });
    if (!state) throw new Error("バックグラウンドから状態を取得できまへんどした");
    renderSnooze();
    renderGacha();
    renderToday();
    renderWeek();
    renderSettings();
    renderFooter();
    bindEvents();
  } catch (e) {
    console.error("Failed to initialize popup:", e);
    $("footer-msg").textContent = "堪忍え、うまく読み込めまへんどした。開き直しとぉくれやす。";
  }
}

// ---- 皮肉ガチャ ----

function randomGachaPhrase() {
  const siteIds = Object.keys(PHRASES);
  const siteId = siteIds[Math.floor(Math.random() * siteIds.length)];
  const level = 1 + Math.floor(Math.random() * 3);
  return pickPhrase(siteId, level);
}

function renderGacha() {
  $("gacha-phrase").textContent = randomGachaPhrase();
}

// ---- 今日の使用状況 ----

function renderToday() {
  const dayStats = state?.stats?.[state.today];
  const list = $("site-list");
  list.innerHTML = "";

  if (!dayStats || Object.keys(dayStats.sites).length === 0) {
    $("empty-today").classList.remove("hidden");
    $("today-total").textContent = "0分";
    return;
  }

  const entries = Object.entries(dayStats.sites)
    .map(([id, s]) => ({ id, ...s, def: state.siteDefs.find((d) => d.id === id) }))
    .filter((e) => e.def)
    .sort((a, b) => b.minutes - a.minutes);

  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const max = Math.max(60, ...entries.map((e) => e.minutes));
  $("today-total").textContent = formatMinutes(total);

  for (const e of entries) {
    const li = document.createElement("li");
    const pct = Math.round((e.minutes / max) * 100);
    li.innerHTML = `
      <div class="site-row">
        <span>${e.def.emoji} ${escapeHtml(e.def.name)}</span>
        <span>
          <span class="mins">${formatMinutes(e.minutes)}</span>
          <span class="nags">催促 ${e.nags} 回</span>
        </span>
      </div>
      <div class="bar"><span class="${e.minutes >= 60 ? "warn" : ""}" style="width:${pct}%"></span></div>
    `;
    list.appendChild(li);
  }
}

// ---- 週間チャート ----

function renderWeek() {
  const chart = $("week-chart");
  chart.innerHTML = "";

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const dayStats = state?.stats?.[key];
    const minutes = dayStats
      ? Object.values(dayStats.sites).reduce((a, s) => a + s.minutes, 0)
      : 0;
    days.push({ key, minutes, label: "日月火水木金土"[d.getDay()], isToday: i === 0 });
  }

  const max = Math.max(60, ...days.map((d) => d.minutes));
  for (const d of days) {
    const col = document.createElement("div");
    col.className = "week-col";
    const h = Math.max(2, Math.round((d.minutes / max) * 56));
    col.innerHTML = `
      <span class="week-mins">${d.minutes > 0 ? d.minutes : ""}</span>
      <div class="week-bar ${d.isToday ? "today" : ""}" style="height:${h}px" title="${d.key}: ${d.minutes}分"></div>
      <span class="week-label">${d.label}</span>
    `;
    chart.appendChild(col);
  }
}

// ---- 設定 ----

function renderSnooze() {
  $("snooze-banner").classList.toggle("hidden", !state.snoozedToday);
}

function renderSettings() {
  $("notify-enabled").checked = state.settings.notifyEnabled;
  $("popup-enabled").checked = state.settings.popupEnabled;
  $("snooze-toggle").checked = state.snoozedToday;
  $("dev-mode").checked = !!state.settings.devMode;
  renderDevCard();
}

function renderDevCard() {
  const dev = !!state.settings.devMode;
  $("dev-card").classList.toggle("hidden", !dev);
  if (!dev) return;
  $("notify-interval").value = state.settings.notifyIntervalMin;
  $("popup-interval").value = state.settings.popupIntervalMin;
  $("test-mode").checked = !!state.settings.testMode;
}

function renderFooter() {
  const dayStats = state?.stats?.[state.today];
  const total = dayStats
    ? Object.values(dayStats.sites).reduce((a, s) => a + s.minutes, 0)
    : 0;
  // 使いすぎていない日は褒めてあげる
  if (total < 30) {
    $("footer-msg").textContent = pickPraise();
  } else if (total < 120) {
    $("footer-msg").textContent = "ほどほどに、おきばりやす。";
  } else {
    $("footer-msg").textContent = "…もう何も言わしまへん。（言うてますけど）";
  }
}

function bindEvents() {
  $("gacha-btn").addEventListener("click", renderGacha);

  $("notify-enabled").addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({
      type: "setSettings",
      settings: { notifyEnabled: e.target.checked }
    });
  });

  $("popup-enabled").addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({
      type: "setSettings",
      settings: { popupEnabled: e.target.checked }
    });
  });

  $("snooze-toggle").addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({
      type: e.target.checked ? "snoozeToday" : "unsnooze"
    });
    state = await chrome.runtime.sendMessage({ type: "getState" });
    renderSnooze();
  });

  // ---- 開発モード ----

  $("dev-mode").addEventListener("change", async (e) => {
    await applySettings({ devMode: e.target.checked });
    renderDevCard();
  });

  $("test-mode").addEventListener("change", async (e) => {
    await applySettings({ testMode: e.target.checked });
    showTestResult(
      e.target.checked
        ? "テストモード開始どす。30秒ごとに10分ぶん進みますえ。"
        : "テストモードを終いました。ふつうの時の流れに戻りますえ。",
      true
    );
  });

  $("notify-interval").addEventListener("change", async (e) => {
    await applySettings({ notifyIntervalMin: e.target.value });
    e.target.value = state.settings.notifyIntervalMin; // 検証後の値を反映
  });

  $("popup-interval").addEventListener("change", async (e) => {
    await applySettings({ popupIntervalMin: e.target.value });
    e.target.value = state.settings.popupIntervalMin;
  });

  $("test-notify-btn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "testNotify" });
    showTestResult(res?.message ?? "うまくいきまへんどした。", res?.ok);
  });

  $("test-popup-btn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "testPopup" });
    showTestResult(res?.message ?? "うまくいきまへんどした。", res?.ok);
  });
}

// 設定を保存し、バックグラウンドで検証された値でローカル状態を更新する
async function applySettings(patch) {
  const res = await chrome.runtime.sendMessage({ type: "setSettings", settings: patch });
  if (res?.settings) state.settings = res.settings;
}

function showTestResult(message, ok) {
  const el = $("test-result");
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", !ok);
}

// ---- ユーティリティ ----

function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}`;
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
