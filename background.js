// IRCTC Tatkal Assistant - MV3 service worker.
// Responsibilities: storage, alarms, tab orchestration, and optional read-only
// pre-decision. All booking actions remain in the IRCTC page UI.
try {
  importScripts("config.js");
} catch {}

const CFG = self.TATKAL_CONFIG || {};
const ALARM_PREWARM = "tatkal-ui-prewarm";
const ALARM_EXECUTE = "tatkal-ui-execute";

const runtimeState = {
  targetEpochMs: 0,
  activeTabId: null
};

function sendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  } catch {}
}

function log(text, cls = "log-action") {
  sendRuntimeMessage({ action: "log", text, cls });
}

function status(state, text) {
  sendRuntimeMessage({ action: "statusUpdate", state, text });
}

async function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function storageSet(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

async function alarmClear(name) {
  return new Promise(resolve => chrome.alarms.clear(name, resolve));
}

async function tabsQuery(query) {
  return new Promise(resolve => chrome.tabs.query(query, resolve));
}

async function tabsCreate(createProperties) {
  return new Promise(resolve => chrome.tabs.create(createProperties, resolve));
}

async function tabsUpdate(tabId, updateProperties) {
  return new Promise(resolve => chrome.tabs.update(tabId, updateProperties, resolve));
}

async function tabsGet(tabId) {
  return new Promise(resolve => chrome.tabs.get(tabId, tab => resolve(chrome.runtime.lastError ? null : tab)));
}

async function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}

async function sendUiMessage(tabId, message) {
  try {
    return await tabsSendMessage(tabId, message);
  } catch (error) {
    log("IRCTC assistant script not ready; reloading tab once.", "log-warn");
    await tabsUpdate(tabId, { url: CFG.IRCTC_MAIN || "https://www.irctc.co.in/nget/train-search" });
    await waitForTabReady(tabId, CFG.PAGE_WAIT_MS || 25000);
    return tabsSendMessage(tabId, message);
  }
}

function notify(title, message, settings = {}) {
  if (settings.desktopNotif === false || !chrome.notifications) return;
  chrome.notifications.create("tatkal-ui-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 1
  }, () => void chrome.runtime.lastError);
}

function parseJourneyDate(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseTimeOverride(timeText, baseDate) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?::(\d{1,3}))?$/.exec(String(timeText || "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const ms = Number(String(match[4] || 0).padEnd(3, "0").slice(0, 3));
  if (hour > 23 || minute > 59 || second > 59) return null;

  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    second,
    ms
  ).getTime();
}

function computeTatkalTarget(journey = {}, settings = {}) {
  const journeyDate = parseJourneyDate(journey.journeyDate);
  if (!journeyDate) return Date.now();

  const targetDate = new Date(journeyDate);
  targetDate.setDate(targetDate.getDate() - 1);

  const override = parseTimeOverride(settings.timeSearch, targetDate);
  if (override) return override;

  const cls = String(journey.travelClass || "").toUpperCase();
  const isAc = (CFG.AC_CLASSES || []).includes(cls);
  const hour = isAc ? (CFG.TATKAL_AC_HOUR || 10) : (CFG.TATKAL_NON_AC_HOUR || 11);
  const minute = isAc ? (CFG.TATKAL_AC_MINUTE || 0) : (CFG.TATKAL_NON_AC_MINUTE || 0);

  return new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    hour,
    minute,
    0,
    0
  ).getTime();
}

function targetLabel(epochMs) {
  return new Date(epochMs).toLocaleString("en-IN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

async function scheduleArmedRun() {
  const { journey = {}, passengers = [], settings = {} } =
    await storageGet(["journey", "passengers", "settings"]);

  if (!journey.fromStation || !journey.toStation || !journey.journeyDate || !journey.trainNo || !journey.travelClass) {
    throw new Error("Save complete journey details before arming.");
  }
  if (!Array.isArray(passengers) || !passengers.length) {
    throw new Error("Add at least one passenger before arming.");
  }

  const targetEpochMs = computeTatkalTarget(journey, settings);
  const preloadLeadMs = CFG.PRELOAD_LEAD_MS || 120000;
  const prewarmEpochMs = Math.max(Date.now() + 1000, targetEpochMs - preloadLeadMs);
  runtimeState.targetEpochMs = targetEpochMs;

  await alarmClear(ALARM_PREWARM);
  await alarmClear(ALARM_EXECUTE);
  chrome.alarms.create(ALARM_PREWARM, { when: prewarmEpochMs });
  chrome.alarms.create(ALARM_EXECUTE, { when: Math.max(Date.now() + 1000, targetEpochMs) });
  await storageSet({ armed: true, nextTargetEpochMs: targetEpochMs });

  log("Armed UI assistant for " + targetLabel(targetEpochMs), "log-success");
  status("active", "ARMED");
  notify("Tatkal assistant armed", "UI flow scheduled for " + targetLabel(targetEpochMs), settings);

  if (targetEpochMs - Date.now() <= preloadLeadMs) {
    await prepareBookingTab({ mode: "prepare", targetEpochMs });
  }

  return { targetEpochMs };
}

async function ensureIrctcTab(settings = {}) {
  const tabs = await tabsQuery({ url: "https://www.irctc.co.in/*" });
  const existing = tabs.find(tab => tab.id === runtimeState.activeTabId) || tabs[0];
  if (existing?.id) {
    runtimeState.activeTabId = existing.id;
    await tabsUpdate(existing.id, { active: true });
    return existing;
  }

  if (settings.autoOpen === false) {
    throw new Error("No IRCTC tab is open and Auto-Open is disabled.");
  }

  const tab = await tabsCreate({ url: CFG.IRCTC_MAIN || "https://www.irctc.co.in/nget/train-search", active: true });
  runtimeState.activeTabId = tab.id;
  await waitForTabReady(tab.id, CFG.PAGE_WAIT_MS || 25000);
  return tab;
}

async function waitForTabReady(tabId, timeoutMs) {
  const tab = await tabsGet(tabId);
  if (tab?.status === "complete") return;

  await new Promise(resolve => {
    let done = false;
    const timer = setTimeout(finish, timeoutMs);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToIrctcTabs(message) {
  const tabs = await tabsQuery({ url: "https://www.irctc.co.in/*" });
  await Promise.allSettled(tabs.map(tab => tabsSendMessage(tab.id, message)));
}

function defaultTarget(journey = {}) {
  return {
    targetTrain: String(journey.trainNo || "").trim(),
    targetClass: String(journey.travelClass || "").trim().toUpperCase()
  };
}

function validateReadOnlyUrl(urlText) {
  const base = CFG.IRCTC_BASE || "https://www.irctc.co.in";
  const url = new URL(urlText, base);
  if (url.origin !== base) {
    throw new Error("Read-only prefetch must use " + base);
  }
  if (url.protocol !== "https:") {
    throw new Error("Read-only prefetch must use HTTPS.");
  }
  const path = (url.pathname + url.search).toLowerCase();
  const blocked = CFG.READ_ONLY_PREFETCH?.BLOCKED_PATH_PARTS || [];
  if (blocked.some(part => path.includes(part))) {
    throw new Error("Blocked non-read-only prefetch path: " + url.pathname);
  }
  return url;
}

async function runReadOnlyPrefetch(journey = {}, settings = {}) {
  const enabled = settings.readOnlyPrefetch === true ||
    (settings.apiMode === true && Boolean(settings.readOnlyPrefetchUrl));
  if (!enabled) return null;

  if (!settings.readOnlyPrefetchUrl) {
    log("Read-only prefetch requested without a same-origin URL; using saved target.", "log-warn");
    return null;
  }

  const url = validateReadOnlyUrl(settings.readOnlyPrefetchUrl);
  log("Read-only prefetch: " + url.pathname, "log-action");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Read-only prefetch returned " + response.status);

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json() : await response.text();
  return extractPrefetchTarget(data, journey);
}

function extractPrefetchTarget(data, journey = {}) {
  const candidates = [
    String(journey.trainNo || ""),
    ...(Array.isArray(journey.alternateTrains) ? journey.alternateTrains.map(String) : [])
  ].map(s => s.trim()).filter(Boolean);

  const text = typeof data === "string" ? data : JSON.stringify(data || {});
  const targetTrain = candidates.find(train => text.includes(train)) || candidates[0] || "";
  return {
    targetTrain,
    targetClass: String(journey.travelClass || "").trim().toUpperCase()
  };
}

async function chooseTarget(journey, settings) {
  const fallback = defaultTarget(journey);
  try {
    const prefetched = await runReadOnlyPrefetch(journey, settings);
    return {
      targetTrain: prefetched?.targetTrain || fallback.targetTrain,
      targetClass: prefetched?.targetClass || fallback.targetClass
    };
  } catch (error) {
    log("Read-only prefetch skipped: " + error.message, "log-warn");
    return fallback;
  }
}

async function prepareBookingTab({ mode, targetEpochMs }) {
  const { journey = {}, passengers = [], settings = {} } =
    await storageGet(["journey", "passengers", "settings"]);
  const tab = await ensureIrctcTab(settings);
  await waitForTabReady(tab.id, CFG.PAGE_WAIT_MS || 25000);

  const target = await chooseTarget(journey, settings);
  await sendUiMessage(tab.id, {
    action: "prefetchResult",
    targetTrain: target.targetTrain,
    targetClass: target.targetClass
  }).catch(() => {});

  const action = mode === "start" ? "startBooking" : "prepareBooking";
  await sendUiMessage(tab.id, {
    action,
    journey,
    passengers,
    settings,
    targetTrain: target.targetTrain,
    targetClass: target.targetClass,
    targetEpochMs
  });

  log((mode === "start" ? "Started" : "Prepared") + " UI flow in IRCTC tab.", "log-action");
}

async function preWarmOnly() {
  const { journey = {}, settings = {} } = await storageGet(["journey", "settings"]);
  const tab = await ensureIrctcTab(settings);
  await waitForTabReady(tab.id, CFG.PAGE_WAIT_MS || 25000);

  const target = await chooseTarget(journey, settings);
  await sendUiMessage(tab.id, {
    action: "prefetchResult",
    targetTrain: target.targetTrain,
    targetClass: target.targetClass
  }).catch(() => {});

  await sendUiMessage(tab.id, {
    action: "preWarm",
    journey,
    settings,
    targetTrain: target.targetTrain,
    targetClass: target.targetClass
  });

  log("Prewarm UI flow sent to IRCTC tab.", "log-action");
}

async function abortAll() {
  await alarmClear(ALARM_PREWARM);
  await alarmClear(ALARM_EXECUTE);
  await storageSet({ armed: false });
  await sendToIrctcTabs({ action: "abortBooking" });
  status("idle", "IDLE");
  log("UI assistant aborted.", "log-warn");
}

chrome.alarms.onAlarm.addListener(alarm => {
  (async () => {
    const { armed, nextTargetEpochMs } = await storageGet(["armed", "nextTargetEpochMs"]);
    if (!armed) return;

    if (alarm.name === ALARM_PREWARM) {
      log("Prewarm alarm fired.", "log-action");
      await prepareBookingTab({ mode: "prepare", targetEpochMs: nextTargetEpochMs || runtimeState.targetEpochMs });
    }

    if (alarm.name === ALARM_EXECUTE) {
      log("Execution alarm fired.", "log-action");
      await prepareBookingTab({ mode: "start", targetEpochMs: Date.now() });
    }
  })().catch(error => {
    log("Alarm error: " + error.message, "log-error");
    status("error", "FAILED");
  });
});

chrome.runtime.onInstalled.addListener(() => {
  log("Compliant UI assistant installed. Booking APIs, proxying, and captcha solving are disabled.", "log-success");
});

async function solveCaptcha(imageDataUrl, apiKey) {
  if (!apiKey) return null;

  try {
    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();

    // Upload to 2captcha
    const formData = new FormData();
    formData.append('key', apiKey);
    formData.append('method', 'base64');
    formData.append('body', imageDataUrl.split(',')[1]); // base64 part
    formData.append('json', '1');

    const uploadRes = await fetch('http://2captcha.com/in.php', {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();

    if (uploadData.status !== 1) {
      log('Captcha upload failed: ' + uploadData.request, 'log-error');
      return null;
    }

    const captchaId = uploadData.request;
    log('Captcha uploaded, ID: ' + captchaId, 'log-action');

    // Poll for result
    for (let i = 0; i < 60; i++) { // 60 attempts, ~30 seconds
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const pollRes = await fetch(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
      const pollData = await pollRes.json();

      if (pollData.status === 1) {
        log('Captcha solved: ' + pollData.request, 'log-success');
        return pollData.request;
      } else if (pollData.request === 'CAPTCHA_NOT_READY') {
        continue;
      } else {
        log('Captcha solve failed: ' + pollData.request, 'log-error');
        return null;
      }
    }

    log('Captcha solve timed out', 'log-warn');
    return null;
  } catch (error) {
    log('Captcha solve error: ' + error.message, 'log-error');
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.action) return;

  (async () => {
    switch (msg.action) {
      // ... existing cases ...

      case "solveCaptcha": {
        const { imageDataUrl } = msg;
        const { settings = {} } = await storageGet(["settings"]);
        const answer = await solveCaptcha(imageDataUrl, settings.twoCaptchaKey);
        sendResponse({ answer });
        break;
      }

      // ... existing cases ...
    }
  })().catch(error => {
    log(error.message, "log-error");
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
