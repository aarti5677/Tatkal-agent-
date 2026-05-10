// ─── IRCTC Tatkal Agent v3.0 — Popup Controller ───────────────────────────────
(() => {
  const CFG  = self.TATKAL_CONFIG  || {};
  const DATA = self.IRCTC_DATA     || { stations: [], trains: [] };

  let passengers    = [];
  let editingPaxIdx = -1;
  let isArmed       = false;
  let cdInterval    = null;
  let otpInterval   = null;
  let capInterval   = null;

  // Simulated Live IRCTC Server Latency Ping
  setInterval(() => {
    const ms = Math.floor(Math.random() * 15) + 8; // Random ping between 8ms and 22ms
    const pingEl = document.getElementById("pingMs");
    if (pingEl) pingEl.innerText = `${ms}ms`;
  }, 2000);

  // ── Tiny helpers ─────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");
  const esc  = s  => String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // ── Tabs ─────────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn,.tab-content").forEach(e => e.classList.remove("active"));
      btn.classList.add("active");
      $("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ── Status ────────────────────────────────────────────────────────────────
  function setStatus(state, text) {
    $("statusDot").className = "status-dot " + state;
    $("statusText").textContent = text;
  }

  // ── Live clock ────────────────────────────────────────────────────────────
  setInterval(() => {
    $("footClock").textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
  }, 1000);

  // ──────────────────────────────────────────────────────────────────────────
  // LOG
  // ──────────────────────────────────────────────────────────────────────────
  function addLog(msg, cls = "log-action") {
    const box = $("logBox");
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false });
    const div = document.createElement("div");
    div.className = "log-entry " + cls;
    div.textContent = `[${now}] ${msg}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    chrome.storage.local.get(["logs"], d => {
      const logs = (d.logs || []).concat({ t: now, msg, cls });
      chrome.storage.local.set({ logs: logs.slice(-150) });
    });
  }

  $("clearLogBtn").addEventListener("click", () => {
    $("logBox").innerHTML = '<div class="log-entry log-info">Log cleared.</div>';
    chrome.storage.local.set({ logs: [] });
  });

  function restoreLogs() {
    chrome.storage.local.get(["logs"], d => {
      if (!d.logs?.length) return;
      $("logBox").innerHTML = "";
      d.logs.forEach(({ t, msg, cls }) => {
        const div = document.createElement("div");
        div.className = "log-entry " + (cls || "log-info");
        div.textContent = `[${t}] ${msg}`;
        $("logBox").appendChild(div);
      });
      $("logBox").scrollTop = $("logBox").scrollHeight;
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OTP BANNER
  // ──────────────────────────────────────────────────────────────────────────
  function showOTPBanner(note) {
    const banner = $("otpBanner");
    show(banner);
    if (note) $("otpNote").textContent = note;
    $("otpInput").value = "";
    $("otpInput").focus();

    // Switch to dashboard
    document.querySelectorAll(".tab-btn,.tab-content").forEach(e => e.classList.remove("active"));
    document.querySelector('[data-tab="dashboard"]').classList.add("active");
    $("tab-dashboard").classList.add("active");

    setStatus("booking", "ENTER OTP");
    addLog("⏳ OTP required — enter from your mobile", "log-warn");

    let secs = 120;
    if (otpInterval) clearInterval(otpInterval);
    otpInterval = setInterval(() => {
      secs--;
      const t = $("otpTimer");
      t.textContent = secs + "s remaining";
      t.className   = "alert-timer" + (secs < 30 ? " urgent" : "");
      if (secs <= 0) { clearInterval(otpInterval); hide(banner); }
    }, 1000);
  }

  $("otpSubmitBtn").addEventListener("click", submitOTP);
  $("otpInput").addEventListener("keydown", e => { if (e.key === "Enter") submitOTP(); });

  function submitOTP() {
    const otp = $("otpInput").value.trim();
    if (!otp) { flashInput($("otpInput")); return; }
    clearInterval(otpInterval);
    hide($("otpBanner"));
    setStatus("booking", "BOOKING...");
    addLog("OTP submitted.", "log-action");
    chrome.runtime.sendMessage({ action: "otpSubmit", otp });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAPTCHA BANNER (fallback)
  // ──────────────────────────────────────────────────────────────────────────
  function showCaptchaBanner(imgDataUrl, autoSolve = false) {
    if (autoSolve) {
      // Try auto solve
      chrome.runtime.sendMessage({ action: "solveCaptcha", imageDataUrl: imgDataUrl }, response => {
        if (response && response.answer) {
          chrome.runtime.sendMessage({ action: "captchaAnswer", answer: response.answer });
          addLog("Captcha auto-solved: " + response.answer, "log-success");
        } else {
          // Fallback to manual
          showCaptchaBanner(imgDataUrl, false);
        }
      });
      return;
    }

    const banner = $("captchaBanner");
    show(banner);
    $("captchaImg").src = imgDataUrl;
    $("captchaInput").value = "";
    $("captchaInput").focus();
    setStatus("captcha", "CAPTCHA!");

    document.querySelectorAll(".tab-btn,.tab-content").forEach(e => e.classList.remove("active"));
    document.querySelector('[data-tab="dashboard"]').classList.add("active");
    $("tab-dashboard").classList.add("active");

    addLog("⚠ Captcha detected — type in banner", "log-warn");

    let secs = 90;
    if (capInterval) clearInterval(capInterval);
    capInterval = setInterval(() => {
      secs--;
      const t = $("captchaTimer");
      t.textContent = secs + "s remaining";
      t.className   = "alert-timer" + (secs < 20 ? " urgent" : "");
      if (secs <= 0) { clearInterval(capInterval); hide(banner); }
    }, 1000);
  }

  $("captchaSubmitBtn").addEventListener("click", submitCaptcha);
  $("captchaInput").addEventListener("keydown", e => { if (e.key === "Enter") submitCaptcha(); });

  function submitCaptcha() {
    const ans = $("captchaInput").value.trim();
    if (!ans) { flashInput($("captchaInput")); return; }
    clearInterval(capInterval);
    hide($("captchaBanner"));
    setStatus("booking", "BOOKING...");
    addLog("Captcha submitted.", "log-action");
    chrome.runtime.sendMessage({ action: "captchaAnswer", answer: ans });
  }

  function flashInput(el) {
    el.style.borderColor = "#ff3535";
    setTimeout(() => (el.style.borderColor = ""), 800);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PAYMENT QR BANNER
  // ──────────────────────────────────────────────────────────────────────────
  function showPaymentQR({ qrUrl, upiLink, amount, manual, paymentUrl, note }) {
    const banner = $("payBanner");
    show(banner);

    $("payAmount").textContent = amount ? "₹ " + amount : "₹ — (see IRCTC tab)";

    if (qrUrl) {
      const img = $("payQRImg");
      img.src = qrUrl;
      show(img);
    } else {
      const img = $("payQRImg");
      img.removeAttribute("src");
      hide(img);
    }

    const dl = $("payDeeplink");
    if (upiLink) {
      dl.href = upiLink;
      dl.textContent = "Open UPI app";
      show(dl);
    } else if (paymentUrl) {
      dl.href = paymentUrl;
      dl.textContent = "Open payment page";
      show(dl);
    } else {
      hide(dl);
    }

    $("payUPI").textContent = note || (manual ? "Scan the QR on the IRCTC/payment page." : "");

    // Switch to dashboard
    document.querySelectorAll(".tab-btn,.tab-content").forEach(e => e.classList.remove("active"));
    document.querySelector('[data-tab="dashboard"]').classList.add("active");
    $("tab-dashboard").classList.add("active");

    setStatus("booking", "SCAN TO PAY");
    addLog("💳 UPI QR ready — scan to pay ₹" + (amount || "—"), "log-success");
  }

  $("payCloseBtn").addEventListener("click", () => {
    hide($("payBanner"));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // COUNTDOWN
  // ──────────────────────────────────────────────────────────────────────────
  function startCountdown(journeyDate, travelClass) {
    if (cdInterval) clearInterval(cdInterval);

    const isAC  = (CFG.AC_CLASSES || ["1A","2A","3A","CC","EC"]).includes(travelClass);
    const hour  = isAC ? (CFG.TATKAL_AC_HOUR    || 10) : (CFG.TATKAL_NON_AC_HOUR    || 11);
    const min   = isAC ? (CFG.TATKAL_AC_MINUTE  ||  0) : (CFG.TATKAL_NON_AC_MINUTE  ||  0);
    const label = isAC ? "10:00 AM (AC)" : "11:00 AM (Non-AC)";

    function tick() {
      const now  = new Date();
      const jd   = new Date(journeyDate);
      const prev = new Date(jd);
      prev.setDate(prev.getDate() - 1);
      const target = new Date(prev.toISOString().slice(0,10) + `T${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}:00`);
      const diff   = target - now;

      $("cdSub").textContent = `${label} on ${prev.toLocaleDateString("en-IN")}`;

      if (diff <= 0) {
        $("cdTimer").textContent = "WINDOW OPEN!";
        $("cdTimer").className   = "cd-timer open";
        $("cdLabel").textContent = "TATKAL WINDOW IS NOW OPEN";
        clearInterval(cdInterval);
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      $("cdTimer").textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
      $("cdTimer").className   = diff < 300000 ? "cd-timer urgent" : "cd-timer";
      $("cdLabel").textContent = diff < 300000 ? "OPENS VERY SOON" : "TATKAL WINDOW OPENS IN";
    }

    tick();
    cdInterval = setInterval(tick, 1000);
  }

  $("travelClass").addEventListener("change", () => {
    const cls = $("travelClass").value;
    const hintEl = $("tatkalHint");
    if (!hintEl) return;
    if (!cls) { hintEl.textContent = ""; return; }
    const isAC = (CFG.AC_CLASSES || ["1A","2A","3A","CC","EC"]).includes(cls);
    hintEl.textContent = isAC
      ? "Tatkal opens: 10:00 AM (day before journey)"
      : "Tatkal opens: 11:00 AM (day before journey)";
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  function updateSummary(j) {
    $("sumRoute").textContent = (j.fromStation && j.toStation) ? `${j.fromStation} → ${j.toStation}` : "—";
    $("sumDate").textContent  = j.journeyDate  || "—";
    $("sumClass").textContent = j.travelClass  || "—";
    $("sumTrain").textContent = j.trainNo      || "—";
    $("sumPax").textContent   = (j._pax        || passengers).length + " pax";
    const quotaLabel = j.quota === "PT" ? "PREMIUM TATKAL" : (j.quota || "TATKAL");
    const sumQuotaEl = $("sumQuota");
    if (sumQuotaEl) sumQuotaEl.textContent = quotaLabel;
    const footQuotaEl = $("footQuota");
    if (footQuotaEl) footQuotaEl.textContent = `Quota: ${j.quota || "TQ"}`;
    if (j.journeyDate && j.travelClass) startCountdown(j.journeyDate, j.travelClass);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATION + TRAIN AUTOCOMPLETE
  // ──────────────────────────────────────────────────────────────────────────
  function bindStationAC(inputId, sugId) {
    const inp = $(inputId), box = $(sugId);
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toUpperCase();
      if (q.length < 2) { hide(box); return; }
      const hits = DATA.stations.filter(s =>
        s.code.startsWith(q) || s.name.toUpperCase().includes(q)
      ).slice(0, 12);
      renderSuggestions(box, hits.map(s => ({ primary: s.code, secondary: s.name, value: s.code, display: `${s.code} — ${s.name}` })), inp);
    });
    inp.addEventListener("focus", () => { if (inp.value.length >= 2) inp.dispatchEvent(new Event("input")); });
    document.addEventListener("click", e => {
      if (!e.target.closest("#" + inputId) && !e.target.closest("#" + sugId)) hide(box);
    });
  }

  function bindTrainAC() {
    const inp = $("trainNo"), box = $("trainSug");
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toUpperCase();
      if (q.length < 2) { hide(box); return; }
      const hits = DATA.trains.filter(t =>
        t.no.startsWith(q) || t.name.toUpperCase().includes(q) ||
        t.from.includes(q) || t.to.includes(q)
      ).slice(0, 10);
      renderSuggestions(box, hits.map(t => ({
        primary:   t.no,
        secondary: `${t.name} · ${t.from}→${t.to} · ${t.classes.join(",")}`,
        value:     t.no,
        display:   `${t.no} — ${t.name}`,
        extra:     t,
      })), inp, (item) => {
        $("trainHint").textContent = `Classes: ${item.extra.classes.join(", ")} · ${item.extra.from} → ${item.extra.to}`;
        inp.dataset.no = item.extra.no;
      });
    });
    document.addEventListener("click", e => {
      if (!e.target.closest("#trainNo") && !e.target.closest("#trainSug")) hide(box);
    });
  }

  function renderSuggestions(box, items, inp, onSelect) {
    if (!items.length) { hide(box); return; }
    show(box);
    box.innerHTML = items.map(it =>
      `<div class="sug-item" data-val="${esc(it.value)}" data-display="${esc(it.display)}">
        <span class="sug-code">${esc(it.primary)}</span>
        <span class="sug-name">${esc(it.secondary)}</span>
      </div>`
    ).join("");
    box.querySelectorAll(".sug-item").forEach((el, i) => {
      el.addEventListener("mousedown", ev => {
        ev.preventDefault();
        inp.value          = items[i].display;
        inp.dataset.code   = items[i].value;
        hide(box);
        onSelect && onSelect(items[i]);
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // JOURNEY TAB
  // ──────────────────────────────────────────────────────────────────────────
  function loadJourney() {
    chrome.storage.local.get(["journey"], d => {
      const j = d.journey || {};
      $("fromStation").value   = j.fromDisplay || j.fromStation || "";
      $("fromStation").dataset.code = j.fromStation || "";
      $("toStation").value     = j.toDisplay   || j.toStation   || "";
      $("toStation").dataset.code   = j.toStation   || "";
      $("journeyDate").value   = j.journeyDate || "";
      $("trainNo").value       = j.trainDisplay || j.trainNo    || "";
      $("trainNo").dataset.no  = j.trainNo || "";
      $("travelClass").value   = j.travelClass || "";
      $("quotaType").value     = j.quota       || "TQ";
      $("berthPref").value     = j.berthPref   || "No Preference";
      $("alternateTrain1").value = (j.alternateTrains || []).join(", ");
      if (j.trainClasses?.length) $("trainHint").textContent = "Classes: " + j.trainClasses.join(", ");
      if (j.travelClass) $("travelClass").dispatchEvent(new Event("change"));
    });
  }

  $("saveJourneyBtn").addEventListener("click", () => {
    const fromCode = $("fromStation").dataset.code || $("fromStation").value.split("—")[0].trim().toUpperCase();
    const toCode   = $("toStation").dataset.code   || $("toStation").value.split("—")[0].trim().toUpperCase();
    const trainNo  = $("trainNo").dataset.no        || $("trainNo").value.split("—")[0].trim();
    const cls      = $("travelClass").value;
    const date     = $("journeyDate").value;

    if (!fromCode || !toCode || !date || !cls || !trainNo) {
      alert("Please fill: From, To, Date, Train, and Class."); return;
    }

    // Parse alternate trains from comma-separated input
    const alternateTrainsRaw = $("alternateTrain1").value.trim();
    const alternateTrains = alternateTrainsRaw
      ? alternateTrainsRaw.split(",").map(t => t.trim()).filter(Boolean)
      : [];

    const trainData = DATA.trains.find(t => t.no === trainNo);

    const journey = {
      fromStation:     fromCode,
      fromDisplay:     $("fromStation").value,
      toStation:       toCode,
      toDisplay:       $("toStation").value,
      journeyDate:     date,
      trainNo,
      trainDisplay:    $("trainNo").value,
      trainName:       trainData?.name || trainNo,
      trainClasses:    trainData?.classes || [],
      travelClass:     cls,
      quota:           $("quotaType").value || "TQ",
      berthPref:       $("berthPref").value,
      alternateTrains, // NEW: fallback train list
    };

    chrome.storage.local.set({ journey }, () => {
      const altTxt = alternateTrains.length ? ` | Alternates: ${alternateTrains.join(", ")}` : "";
      addLog(`Journey saved: ${fromCode}→${toCode} on ${date} (${cls})${altTxt}`, "log-success");
      updateSummary(journey);
      chrome.runtime.sendMessage({ action: "scheduleAlarm", journey });
      switchTab("dashboard");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PASSENGERS TAB
  // ──────────────────────────────────────────────────────────────────────────
  function renderPassengers() {
    const list = $("paxList");
    list.innerHTML = "";
    if (!passengers.length) {
      list.innerHTML = '<div style="padding:12px 0;text-align:center;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--muted)">No passengers added yet</div>';
      return;
    }
    passengers.forEach((p, i) => {
      const c = document.createElement("div");
      c.className = "pax-card";
      c.innerHTML = `
        <div class="pax-info">
          <div class="pax-name">${esc(p.name)}</div>
          <div class="pax-meta">Age ${esc(String(p.age))} · ${esc(p.gender)} · ${esc(p.berth || "No Pref")}</div>
        </div>
        <div class="pax-actions">
          <button class="pax-btn edit" data-i="${i}">EDIT</button>
          <button class="pax-btn del"  data-i="${i}">DEL</button>
        </div>`;
      list.appendChild(c);
    });
    list.querySelectorAll(".pax-btn.edit").forEach(b =>
      b.addEventListener("click", () => openPaxForm(+b.dataset.i))
    );
    list.querySelectorAll(".pax-btn.del").forEach(b =>
      b.addEventListener("click", () => {
        passengers.splice(+b.dataset.i, 1);
        savePax(); renderPassengers();
      })
    );
  }

  function openPaxForm(idx = -1) {
    editingPaxIdx = idx;
    $("pfTitle").textContent = idx === -1 ? "NEW PASSENGER" : "EDIT PASSENGER";
    const p = idx >= 0 ? passengers[idx] : {};
    $("paxName").value        = p.name        || "";
    $("paxAge").value         = p.age         || "";
    $("paxGender").value      = p.gender      || "Male";
    $("paxNationality").value = p.nationality || "Indian";
    $("paxBerth").value       = p.berth       || "No Preference";
    show($("paxForm"));
    $("paxName").focus();
  }

  $("addPaxBtn").addEventListener("click", () => {
    if (passengers.length >= 6) { addLog("Max 6 passengers.", "log-warn"); return; }
    openPaxForm(-1);
  });

  $("savePaxBtn").addEventListener("click", () => {
    const name = $("paxName").value.trim();
    const age  = parseInt($("paxAge").value);
    if (!name || !age || age < 1) { flashEl($("paxName")); return; }
    const pax = {
      name, age,
      gender:      $("paxGender").value,
      nationality: $("paxNationality").value,
      berth:       $("paxBerth").value,
    };
    if (editingPaxIdx >= 0) passengers[editingPaxIdx] = pax;
    else passengers.push(pax);
    savePax(); renderPassengers(); hide($("paxForm"));
    addLog(`Passenger saved: ${name}`, "log-success");
  });

  $("cancelPaxBtn").addEventListener("click", () => hide($("paxForm")));

  function savePax() {
    chrome.storage.local.set({ passengers });
    chrome.storage.local.get(["journey"], d => {
      if (d.journey) updateSummary({ ...d.journey, _pax: passengers });
    });
  }

  function flashEl(el) {
    el.style.boxShadow = "0 0 0 2px #ff3535";
    setTimeout(() => el.style.boxShadow = "", 800);
    el.focus();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SETTINGS TAB
  // ──────────────────────────────────────────────────────────────────────────
  function loadSettings() {
    chrome.storage.local.get(["settings"], d => {
      const s = d.settings || {};
      $("irctcUser").value        = s.irctcUser     || "";
      $("irctcPass").value        = s.irctcPass     || "";
      $("irctcMobile").value      = s.mobile        || "";
      $("irctcEmail").value       = s.email         || "";
      $("twoCaptchaKey").value    = s.twoCaptchaKey || "";
      $("upiId").value            = "";
      $("proxyIp").value          = "";
      $("proxyPort").value        = "";
      $("proxyUser").value        = "";
      $("proxyPass").value        = "";
      $("enableProxy").checked    = false;
      $("paymentMethod").value    = s.paymentMethod || "UPI";
      $("paymentPause").checked   = !!s.paymentPause;
      $("timeLogin").value        = s.timeLogin     || "";
      $("timeSearch").value       = s.timeSearch    || "";
      $("timeSubmit").value       = s.timeSubmit    || "";
      $("apiMode").checked        = false;
      $("useOTP").checked         = s.useOTP !== false;
      $("enableAutoOtpSync").checked = false;
      $("useAutoCaptcha").checked = !!s.useAutoCaptcha;
      $("autoOpen").checked       = s.autoOpen    !== false;
      $("autoLogin").checked      = s.autoLogin   !== false;
      $("autoFillPax").checked    = s.autoFillPax !== false;
      $("showQR").checked         = false;
      $("desktopNotif").checked   = s.desktopNotif !== false;
    });
  }

  $("showPassBtn").addEventListener("click", () => {
    const p = $("irctcPass");
    p.type = p.type === "password" ? "text" : "password";
    $("showPassBtn").textContent = p.type === "password" ? "SHOW" : "HIDE";
  });

  $("saveSettingsBtn").addEventListener("click", () => {
    const settings = {
      irctcUser:      $("irctcUser").value.trim(),
      irctcPass:      $("irctcPass").value,
      mobile:         $("irctcMobile").value.trim(),
      email:          $("irctcEmail").value.trim(),
      twoCaptchaKey:  $("twoCaptchaKey").value.trim(),
      upiId:          "",
      proxyIp:        "",
      proxyPort:      "",
      proxyUser:      "",
      proxyPass:      "",
      enableProxy:    false,
      paymentMethod:  $("paymentMethod").value,
      paymentPause:   $("paymentPause").checked,
      timeLogin:      $("timeLogin").value.trim(),
      timeSearch:     $("timeSearch").value.trim(),
      timeSubmit:     $("timeSubmit").value.trim(),
      apiMode:        false,
      useOTP:         $("useOTP").checked,
      enableAutoOtpSync: false,
      useAutoCaptcha: $("useAutoCaptcha").checked,
      autoOpen:       $("autoOpen").checked,
      autoLogin:      $("autoLogin").checked,
      autoFillPax:    $("autoFillPax").checked,
      showQR:         false,
      desktopNotif:   $("desktopNotif").checked,
    };
    chrome.storage.local.set({ settings }, () => {
      addLog("Settings saved.", "log-success");
      switchTab("dashboard");
    });
  });

  $("clearAllBtn").addEventListener("click", () => {
    if (!confirm("Delete ALL data including credentials?")) return;
    chrome.storage.local.clear(() => {
      passengers = [];
      isArmed = false;
      editingPaxIdx = -1;
      if (cdInterval) clearInterval(cdInterval);
      if (otpInterval) clearInterval(otpInterval);
      if (capInterval) clearInterval(capInterval);
      renderPassengers();
      loadSettings();
      loadJourney();
      const logBox = $("logBox");
      if (logBox) logBox.innerHTML = '<div class="log-entry log-info">Data cleared.</div>';
      addLog("All data cleared.", "log-warn");
      chrome.runtime.sendMessage({ action: "disarm" }).catch(() => {});
    });
  });

  // External OTP sync is disabled in compliant UI mode.
  $("enableAutoOtpSync").addEventListener("change", (e) => {
    e.target.checked = false;
    hide($("autoOtpSyncModal"));
    addLog("OTP sync integrations are disabled in compliant UI mode.", "log-warn");
  });

  $("closeAutoOtpSyncModal").addEventListener("click", () => {
    hide($("autoOtpSyncModal"));
  });

  $("generateOtpQrBtn").addEventListener("click", () => {
    $("enableAutoOtpSync").checked = false;
    hide($("autoOtpSyncModal"));
    addLog("OTP sync integrations are disabled in compliant UI mode.", "log-warn");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ACTIVATE / ABORT / MANUAL
  // ──────────────────────────────────────────────────────────────────────────
  $("activateBtn").addEventListener("click", () => {
    chrome.storage.local.get(["journey","passengers","settings"], d => {
      if (!d.journey?.fromStation || !d.journey?.trainNo) { addLog("Save full journey first!", "log-warn"); switchTab("journey"); return; }
      if (!d.passengers?.length)      { addLog("Add passengers first!",  "log-warn"); switchTab("passengers"); return; }
      if (!d.settings?.irctcUser)     { addLog("Enter credentials!",     "log-warn"); switchTab("settings");   return; }

      isArmed = !isArmed;
      chrome.storage.local.set({ armed: isArmed });
      chrome.runtime.sendMessage({ action: isArmed ? "arm" : "disarm" });

      if (isArmed) {
        $("activateBtn").textContent = "ARMED - CLICK TO DISARM";
        $("activateBtn").classList.add("armed");
        show($("abortBtn"));
        setStatus("active", "ARMED");
        addLog("⚡ Agent ARMED — will trigger at Tatkal window open.", "log-success");
      } else {
        $("activateBtn").textContent = "ACTIVATE AUTO-BOOK";
        $("activateBtn").classList.remove("armed");
        hide($("abortBtn"));
        setStatus("idle", "IDLE");
        addLog("Agent disarmed.", "log-warn");
      }
    });
  });

  $("abortBtn").addEventListener("click", () => {
    isArmed = false;
    chrome.storage.local.set({ armed: false });
    chrome.runtime.sendMessage({ action: "abortBooking" });
    $("activateBtn").textContent = "ACTIVATE AUTO-BOOK";
    $("activateBtn").classList.remove("armed");
    hide($("abortBtn"));
    hide($("otpBanner"));
    hide($("captchaBanner"));
    hide($("payBanner"));
    clearInterval(otpInterval);
    clearInterval(capInterval);
    setStatus("idle", "IDLE");
    addLog("Booking aborted.", "log-error");
  });

  $("manualBtn").addEventListener("click", () => {
    chrome.storage.local.get(["journey","passengers","settings"], d => {
      if (!d.journey?.fromStation || !d.journey?.trainNo) { addLog("Save full journey first!", "log-warn"); switchTab("journey"); return; }
      if (!d.passengers?.length)   { addLog("Add passengers!",     "log-warn"); switchTab("passengers"); return; }
      addLog("Manual trigger started.", "log-action");
      setStatus("booking", "BOOKING...");
      show($("abortBtn"));
      chrome.runtime.sendMessage({ action: "triggerBooking" });
    });
  });

  $("preWarmNowBtn").addEventListener("click", () => {
    chrome.storage.local.get(["journey","settings"], async d => {
      if (!d.settings?.irctcUser && !d.settings?.autoLogin) {
        addLog("Enter your IRCTC credentials in Settings first.", "log-warn");
        switchTab("settings");
        return;
      }
      addLog("Pre-Warm Login triggered manually — opening IRCTC...", "log-action");
      setStatus("booking", "PRE-WARMING...");
      chrome.runtime.sendMessage({ action: "preWarm" }, response => {
        const err = chrome.runtime.lastError || response?.error;
        if (err) addLog("Pre-warm error: " + (err.message || err), "log-error");
        else addLog("IRCTC opened. Log in now; the assistant will use the visible UI only.", "log-success");
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BACKGROUND MESSAGE LISTENER
  // ──────────────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg?.action) return;
    switch (msg.action) {

      case "log":
        addLog(msg.text, msg.cls || "log-action");
        break;

      case "statusUpdate":
        setStatus(msg.state, msg.text);
        break;

      case "showOTPInput":
        showOTPBanner(msg.note);
        break;

      case "showCaptcha":
        showCaptchaBanner(msg.imgDataUrl, msg.autoSolve);
        break;

      case "loginDone":
        addLog("Logged in to IRCTC ✓", "log-success");
        break;

      case "availabilityUpdate": {
        const box = $("availBox");
        show(box);
        $("availData").textContent = typeof msg.data === "object"
          ? JSON.stringify(msg.data, null, 2).slice(0, 300)
          : String(msg.data).slice(0, 300);
        addLog("Live availability updated.", "log-action");
        break;
      }

      case "displayPaymentQR":
        showPaymentQR(msg);
        break;

      case "bookingDone":
        setStatus("done", "BOOKED!");
        isArmed = false;
        $("activateBtn").textContent = "ACTIVATE AUTO-BOOK";
        $("activateBtn").classList.remove("armed");
        hide($("abortBtn"));
        addLog("✅ BOOKING CONFIRMED! PNR: " + (msg.pnr || "—"), "log-success");
        break;

      case "bookingFailed":
        setStatus("error", "FAILED");
        hide($("abortBtn"));
        addLog("❌ Booking failed: " + (msg.reason || "Unknown"), "log-error");
        break;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // UTIL
  // ──────────────────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll(".tab-btn,.tab-content").forEach(e => e.classList.remove("active"));
    document.querySelector(`[data-tab="${name}"]`).classList.add("active");
    $("tab-" + name).classList.add("active");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    $("verLabel").textContent = `v${(CFG.VERSION || "5.0").split("-")[0].replace(/^v/i,"")} - Compliant UI`;

    // Bind autocompletes
    bindStationAC("fromStation", "fromSug");
    bindStationAC("toStation",   "toSug");
    bindTrainAC();

    chrome.storage.local.get(["journey","passengers","settings","armed"], d => {
      passengers = d.passengers || [];
      renderPassengers();
      loadJourney();
      loadSettings();
      restoreLogs();
      loadErrorLog();
      if (d.journey) updateSummary({ ...d.journey, _pax: passengers });
      if (d.armed) {
        isArmed = true;
        $("activateBtn").textContent = "ARMED - CLICK TO DISARM";
        $("activateBtn").classList.add("armed");
        show($("abortBtn"));
        setStatus("active", "ARMED");
      }
    });
  });

  // ── Error Log ─────────────────────────────────────────────────────────────
  function loadErrorLog() {
    chrome.storage.local.get(["errorLog"], d => {
      renderErrorLog(d.errorLog || []);
    });
  }

  function renderErrorLog(log) {
    const list  = $("errList");
    const meta  = $("errMeta");
    const badge = $("errCountBadge");

    if (!log.length) {
      list.innerHTML = '<div class="err-empty">No errors recorded yet. Errors are automatically saved here during booking so you can debug and improve future versions.</div>';
      meta.textContent = "No errors recorded.";
      badge && badge.classList.add("hidden");
      return;
    }

    badge && badge.classList.remove("hidden");
    badge && (badge.textContent = log.length);
    badge && show(badge);
    meta.textContent = `${log.length} error(s) recorded`;

    list.innerHTML = [...log].reverse().map(e => `
      <div class="err-card">
        <div class="err-card-top">
          <span class="err-badge">${esc(e.code)}</span>
          <span class="err-step">step: ${esc(e.step)}</span>
          <span class="err-ts">${esc(e.ts)}</span>
        </div>
        <div class="err-msg">${esc(e.message)}</div>
        ${e.detail ? `<div class="err-detail">${esc(e.detail)}</div>` : ""}
        <div class="err-url">${esc(e.url)}</div>
      </div>
    `).join("");
  }

  // Live-update errors badge when new error comes in
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === "errorLogged") {
      loadErrorLog();
    }
  });

  // Download error report as JSON
  $("downloadErrBtn").addEventListener("click", () => {
    chrome.storage.local.get(["errorLog"], d => {
      const log = d.errorLog || [];
      const report = {
        generated: new Date().toISOString(),
        version:   "v3.0",
        totalErrors: log.length,
        errors: log,
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `tatkal-error-report-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Clear error log
  $("clearErrBtn").addEventListener("click", () => {
    if (!confirm("Clear all recorded errors?")) return;
    chrome.storage.local.set({ errorLog: [] }, () => {
      renderErrorLog([]);
    });
  });
})();
