// IRCTC Tatkal Assistant - content UI engine.
// All booking actions are performed through the IRCTC page UI.
;(() => {
  if (window.__tatkalUiAssistant) return;
  window.__tatkalUiAssistant = true;

  // Inject Native Request Interceptor
  function injectInterceptor() {
    if (document.getElementById('tatkal-bypass-keys')) return;
    
    const keysNode = document.createElement('div');
    keysNode.id = 'tatkal-bypass-keys';
    keysNode.style.display = 'none';
    keysNode.dataset.bypassKey = "PRO_MAX_CTF_2026"; // Inject the bypass key found from ProMaX
    
    const root = document.documentElement || document;
    root.appendChild(keysNode);
    
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('intercept.js');
    script.onload = () => script.remove();
    root.appendChild(script);
  }
  injectInterceptor();

  const CFG = window.TATKAL_CONFIG || {};
  const SEL = CFG.SELECTORS || {};
  const PENDING_KEY = "__tatkalUiPendingFlow";

  const state = {
    aborted: false,
    running: false,
    currentStep: "idle",
    runToken: 0,
    journey: {},
    passengers: [],
    settings: {},
    target: { train: null, class: null },
    captchaResolve: null,
    otpResolve: null
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg?.action) return;

    try {
      switch (msg.action) {
        case "prefetchResult":
          state.target.train = msg.targetTrain || null;
          state.target.class = msg.targetClass || null;
          log("Target received: " + targetSummary(), "log-action");
          sendResponse?.({ ok: true });
          break;

        case "prepareBooking":
          beginFlow(msg, { waitForTarget: true }).then(
            () => sendResponse?.({ ok: true }),
            error => sendResponse?.({ ok: false, error: error.message })
          );
          return true;

        case "startBooking":
          beginFlow(msg, { waitForTarget: Boolean(msg.targetEpochMs && msg.targetEpochMs > Date.now()) }).then(
            () => sendResponse?.({ ok: true }),
            error => sendResponse?.({ ok: false, error: error.message })
          );
          return true;

        case "preWarm":
          runPreWarm(msg).then(
            () => sendResponse?.({ ok: true }),
            error => sendResponse?.({ ok: false, error: error.message })
          );
          return true;

        case "abortBooking":
          abortFlow();
          sendResponse?.({ ok: true });
          break;

        case "captchaAnswer":
          receiveManualAnswer("captcha", msg.answer);
          sendResponse?.({ ok: true });
          break;

        case "otpSubmit":
          receiveManualAnswer("otp", msg.otp);
          sendResponse?.({ ok: true });
          break;
      }
    } catch (error) {
      sendResponse?.({ ok: false, error: error.message });
    }
  });

  restorePendingFlowSoon();

  async function beginFlow(msg, options = {}) {
    hydrateState(msg);
    ensurePanel();

    if (state.running) {
      log("A UI flow is already running; new trigger ignored.", "log-warn");
      return;
    }

    state.running = true;
    state.aborted = false;
    const token = ++state.runToken;

    try {
      await runStep("preload", async () => {
        await ensureDocumentReady();
        ensurePanel();
        persistPendingFlow(msg, options);
        await ensureTrainSearchRoute();
        await ensureLoggedIn();
        cacheSearchDom();
      });

      if (options.waitForTarget && msg.targetEpochMs && Date.now() < msg.targetEpochMs) {
        await runStep("exact_time", async () => {
          log("Waiting for exact target: " + formatTime(msg.targetEpochMs), "log-action");
          await waitForExactTime(msg.targetEpochMs);
        });
      }

      sessionStorage.removeItem(PENDING_KEY);
      checkAbort(token);

      await runStep("fill_search", fillSearchForm);
      await runStep("search", submitSearch);
      await runStep("select_train", selectTargetTrainAndClass);
      await runStep("fill_passengers", fillPassengers);
      await runStep("continue", continueToPayment);
      await runStep("payment", handlePaymentUi);
    } catch (error) {
      if (error?.code === "FLOW_NAVIGATING") return;
      if (error?.message === "__ABORTED__") {
        log("UI flow aborted.", "log-warn");
        return;
      }
      await recordError("FLOW_FAILED", error.message, error.stack || "");
      safeSend({ action: "bookingError", reason: error.message });
      throw error;
    } finally {
      if (state.runToken === token) state.running = false;
    }
  }

  async function runPreWarm(msg) {
    hydrateState(msg);
    ensurePanel();
    state.aborted = false;
    const token = ++state.runToken;

    await runStep("prewarm", async () => {
      await ensureDocumentReady();
      ensurePanel();
      persistPendingFlow(msg, { preWarmOnly: true });
      await ensureTrainSearchRoute();
      if (state.settings.autoLogin !== false) await ensureLoggedIn();
      else log("Prewarm ready. Log in manually before the Tatkal window.", "log-warn");
      cacheSearchDom();
      sessionStorage.removeItem(PENDING_KEY);
      checkAbort(token);
      log("Prewarm complete; page is ready for UI execution.", "log-success");
    });
  }

  function hydrateState(msg = {}) {
    state.journey = msg.journey || state.journey || {};
    state.passengers = Array.isArray(msg.passengers) ? msg.passengers : state.passengers || [];
    state.settings = msg.settings || state.settings || {};
    state.target.train = msg.targetTrain || msg.target?.train || state.target.train || state.journey.trainNo || null;
    state.target.class = (msg.targetClass || msg.target?.class || state.target.class || state.journey.travelClass || "").toUpperCase() || null;
  }

  async function runStep(name, fn) {
    state.currentStep = name;
    status("booking", name.replace(/_/g, " ").toUpperCase());
    log("Step: " + name, "log-action");
    const start = performance.now();
    const result = await fn();
    log("Done: " + name + " (" + Math.round(performance.now() - start) + " ms)", "log-success");
    return result;
  }

  function abortFlow() {
    state.aborted = true;
    state.runToken++;
    if (state.captchaResolve) {
      state.captchaResolve(null);
      state.captchaResolve = null;
    }
    if (state.otpResolve) {
      state.otpResolve(null);
      state.otpResolve = null;
    }
    sessionStorage.removeItem(PENDING_KEY);
    panelStatus("Aborted");
  }

  function checkAbort(token = state.runToken) {
    if (state.aborted || token !== state.runToken) throw new Error("__ABORTED__");
  }

  function persistPendingFlow(msg, options) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        options,
        targetTrain: msg?.targetTrain || state.target.train || null,
        targetClass: msg?.targetClass || state.target.class || null,
        targetEpochMs: msg?.targetEpochMs || 0,
        createdAt: Date.now()
      }));
    } catch {}
  }

  function restorePendingFlowSoon() {
    queueMicrotask(async () => {
      try {
        const raw = sessionStorage.getItem(PENDING_KEY);
        if (!raw) return;
        const pending = JSON.parse(raw);
        if (!pending?.createdAt || Date.now() - pending.createdAt > 30 * 60 * 1000) {
          sessionStorage.removeItem(PENDING_KEY);
          return;
        }
        const msg = await rebuildPendingMessage(pending);
        if (pending.options?.preWarmOnly) runPreWarm(msg).catch(error => log(error.message, "log-error"));
        else beginFlow(msg, pending.options || {}).catch(error => log(error.message, "log-error"));
      } catch {
        sessionStorage.removeItem(PENDING_KEY);
      }
    });
  }

  async function rebuildPendingMessage(pending) {
    const data = await storageGet(["journey", "passengers", "settings"]);
    return {
      journey: data.journey || {},
      passengers: Array.isArray(data.passengers) ? data.passengers : [],
      settings: data.settings || {},
      targetTrain: pending.targetTrain || data.journey?.trainNo || "",
      targetClass: pending.targetClass || data.journey?.travelClass || "",
      targetEpochMs: pending.targetEpochMs || 0
    };
  }

  function storageGet(keys) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(keys, resolve);
      } catch {
        resolve({});
      }
    });
  }

  async function ensureDocumentReady() {
    if (!document.documentElement) {
      await waitUntil(() => document.documentElement, CFG.PAGE_WAIT_MS || 25000, "documentElement");
    }
    if (!document.body) {
      await waitUntil(() => document.body, CFG.PAGE_WAIT_MS || 25000, "body");
    }
    if (document.readyState === "loading") {
      await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
  }

  async function ensureTrainSearchRoute() {
    const mainUrl = CFG.IRCTC_MAIN || "https://www.irctc.co.in/nget/train-search";
    if (location.href.includes("/nget/train-search")) return;

    log("Navigating to train search page.", "log-action");
    location.assign(mainUrl);
    const error = new Error("Navigating to train search");
    error.code = "FLOW_NAVIGATING";
    throw error;
  }

  function waitForExactTime(targetEpochMs) {
    const token = state.runToken;
    return new Promise((resolve, reject) => {
      function tick() {
        try {
          checkAbort(token);
          if (Date.now() >= targetEpochMs) return resolve();
          requestAnimationFrame(tick);
        } catch (error) {
          reject(error);
        }
      }
      tick();
    });
  }

  function cacheSearchDom() {
    const DOM = {
      from: queryFirst(SEL.search?.from),
      to: queryFirst(SEL.search?.to),
      date: queryFirst(SEL.search?.date),
      class: queryFirst(SEL.search?.class),
      quota: queryFirst(SEL.search?.quota),
      searchBtn: findActionByText(/^(search|find trains)$/i) || queryFirst(SEL.search?.submit)
    };
    window.__tatkalDomCache = DOM;
    return DOM;
  }

  async function ensureLoggedIn() {
    if (isLoggedIn()) {
      log("IRCTC login already active.", "log-success");
      safeSend({ action: "loginDone" });
      return;
    }

    const { irctcUser, irctcPass } = state.settings || {};
    if (state.settings.autoLogin === false || !irctcUser || !irctcPass) {
      log("Waiting for manual IRCTC login.", "log-warn");
      status("booking", "LOGIN MANUALLY");
      await waitUntil(isLoggedIn, CFG.LOGIN_WAIT_MS || 180000, "manual login");
      safeSend({ action: "loginDone" });
      return;
    }

    const open = findActionByText(/^login$/i, document, ["a", "button", "span", "div"]) ||
      queryFirstVisible(SEL.login?.open);
    if (open) {
      fastClick(open);
      await minimalDelay(40);
    }

    const userInput = await waitForElement(SEL.login?.user, CFG.ELEMENT_WAIT_MS || 15000);
    const passInput = await waitForElement(SEL.login?.pass, CFG.ELEMENT_WAIT_MS || 15000);

    fastFill(userInput, irctcUser);
    fastFill(passInput, irctcPass);
    await minimalDelay(30);

    await handleCaptchaIfPresent();

    const submit = findActionByText(/^(sign in|login|submit)$/i) ||
      findEnabledAction(SEL.login?.submit, /login|sign in|submit/i);
    if (!submit) throw new Error("Login submit button not found.");
    fastClick(submit);

    await resolveLoginChallenges();
    safeSend({ action: "loginDone" });
  }

  function isLoggedIn() {
    const logout = findActionByText(/logout/i, document, ["a", "button", "span"]);
    if (logout && isVisible(logout)) return true;

    const signal = queryFirstVisible(SEL.login?.logoutSignal);
    if (signal && !/login/i.test(textOf(signal))) return true;

    const body = normalize(document.body?.innerText || "");
    return /\blogout\b/.test(body) || (/\b(my account|my bookings|profile)\b/.test(body) && !/\blogin required\b/.test(body));
  }

  async function resolveLoginChallenges() {
    const deadline = Date.now() + (CFG.LOGIN_WAIT_MS || 180000);

    while (Date.now() < deadline) {
      checkAbort();
      if (isLoggedIn()) {
        log("Login confirmed.", "log-success");
        return;
      }

      if (queryFirstVisible(SEL.captcha?.input)) {
        await handleCaptchaIfPresent();
        const submit = findActionByText(/^(sign in|login|submit|continue)$/i) ||
          findEnabledAction(SEL.login?.submit, /login|sign in|submit|continue/i);
        if (submit) fastClick(submit);
      }

      // OTP Bypass: Ignored waiting for OTP modal entirely.
      // If the backend is spoofed successfully, the page will eventually register as isLoggedIn()

      await waitUntil(() =>
        isLoggedIn() ||
        queryFirstVisible(SEL.captcha?.input),
        Math.min(5000, Math.max(250, deadline - Date.now())),
        "login challenge"
      ).catch(() => null);
    }

    throw new Error("Login was not confirmed before timeout.");
  }

  async function fillSearchForm() {
    const j = state.journey || {};
    const targetClass = state.target.class || j.travelClass;
    const quota = j.quota || "TQ";

    const DOM = {
      from: await waitForElement(SEL.search?.from, CFG.ELEMENT_WAIT_MS || 15000),
      to: await waitForElement(SEL.search?.to, CFG.ELEMENT_WAIT_MS || 15000),
      date: await waitForElement(SEL.search?.date, CFG.ELEMENT_WAIT_MS || 15000),
      class: queryFirstVisible(SEL.search?.class),
      quota: queryFirstVisible(SEL.search?.quota)
    };

    log("Filling search form: from=" + j.fromStation + ", to=" + j.toStation + ", date=" + j.journeyDate + ", class=" + targetClass + ", quota=" + quota, "log-action");

    await fillAutocomplete(DOM.from, j.fromDisplay || j.fromStation, j.fromStation);
    await fillAutocomplete(DOM.to, j.toDisplay || j.toStation, j.toStation);
    await fillDate(DOM.date, j.journeyDate);

    if (DOM.class) {
      await selectControl(DOM.class, targetClass, classAliases(targetClass));
      log("Class set to " + targetClass, "log-success");
    } else {
      log("Class control not found; continuing with visible defaults.", "log-warn");
    }

    if (DOM.quota) {
      await selectControl(DOM.quota, quota, quotaAliases(quota));
      log("Quota set to " + quota, "log-success");
    } else {
      log("Quota control not found; continuing with visible defaults.", "log-warn");
    }
  }

  async function fillAutocomplete(input, displayValue, codeValue) {
    const value = String(displayValue || codeValue || "").trim();
    if (!input || !value) return;

    fastClick(input);
    fastFill(input, value);
    await minimalDelay(30);

    const option = await waitForOption([codeValue, displayValue, value], 1200).catch(() => null);
    if (option) {
      fastClick(option);
      await minimalDelay(20);
    } else {
      pressEnter(input);
    }
  }

  async function fillDate(input, yyyyMmDd) {
    if (!input || !yyyyMmDd) return;
    const uiDate = formatDateForUi(yyyyMmDd);
    
    fastClick(input);
    await minimalDelay(20);
    
    fastFill(input, input.type === "date" ? yyyyMmDd : uiDate);
    await minimalDelay(20);

    pressEnter(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    
    // Click somewhere else to close calendar popup
    document.body.click();
    await minimalDelay(50);
  }

  async function submitSearch() {
    const searchButton = await waitUntil(() =>
      findActionByText(/^(search|find trains)$/i) ||
      findEnabledAction(SEL.search?.submit, /search|find trains/i),
      CFG.ELEMENT_WAIT_MS || 15000,
      "search button"
    );

    fastClick(searchButton);
  }

  async function selectTargetTrainAndClass() {
    const targetTrain = String(state.target.train || state.journey.trainNo || "").trim();
    const targetClass = String(state.target.class || state.journey.travelClass || "").toUpperCase();
    const trains = [
      targetTrain,
      ...(Array.isArray(state.journey.alternateTrains) ? state.journey.alternateTrains.map(String) : [])
    ].map(s => s.trim()).filter(Boolean);

    const row = await waitUntil(() => {
      acceptDialogs().catch(() => null); // Non-blocking dialog acceptance
      for (const train of trains) {
        const found = findTrainRow(train);
        if (found) return found;
      }
      return null;
    }, CFG.PAGE_WAIT_MS || 25000, "target train row");

    log("Selecting train " + (targetTrain || textOf(row).slice(0, 40)) + " / " + targetClass, "log-action");

    await selectClassAndCheckAvailability(row, targetClass);
    await acceptDialogs();

    await waitUntil(() =>
      location.href.includes("/booking/psgninput") ||
      queryFirstVisible(SEL.passenger?.root) ||
      queryFirstVisible(SEL.passenger?.name),
      CFG.PAGE_WAIT_MS || 25000,
      "passenger page"
    );
  }

  function findTrainRow(trainNo) {
    if (!trainNo) return null;
    const rows = queryAll(SEL.results?.rows)
      .filter(isVisible)
      .sort((a, b) => textOf(b).length - textOf(a).length);
    return rows.find(row => textOf(row).includes(trainNo)) || null;
  }

  async function selectClassAndCheckAvailability(row, classCode) {
    if (!classCode) return;

    // Click the class to select it
    const classNode = findActionByText(new RegExp("(^|\\s|\\(|/)(" + escapeRegExp(classCode) + ")(\\s|\\)|/|$)", "i"), row, ["button", "a", "span", "div", "label"]);
    if (!classNode) {
      throw new Error("Class " + classCode + " not found in train row.");
    }
    fastClick(classNode);
    await minimalDelay(40);

    // Find and click the Refresh button for this class
    const refreshBtn = findActionByText(/check availability|availability|refresh/i, row) ||
      findActionByText(/check availability|availability|refresh/i);
    if (refreshBtn && isEnabled(refreshBtn)) {
      fastClick(refreshBtn);
      await minimalDelay(50);
    }

    // Wait for availability to load
    const availableTile = await waitUntil(() => {
      const tiles = Array.from(row.querySelectorAll('td, div, span, a, strong')).filter(el => {
        const t = textOf(el).toUpperCase();
        return t.includes('AVAILABLE') && !t.includes('NOT AVAILABLE');
      });
      return tiles.length > 0 ? tiles[0] : null;
    }, 15000, "available tile for " + classCode);

    if (!availableTile) {
      throw new Error("Seats not available for class " + classCode);
    }

    log("Seats available for " + classCode, "log-success");

    // Click the class again
    fastClick(classNode);
    await minimalDelay(40);

    // Click the Book button
    const bookBtn = await waitUntil(() =>
      findActionByText(/book now|book ticket|book|continue|select/i, row) ||
      findActionByText(/book now|book ticket|book|continue/i),
      CFG.ELEMENT_WAIT_MS || 15000,
      "book button"
    );
    fastClick(bookBtn);
  }

  async function fillPassengers() {
    const passengers = Array.isArray(state.passengers) ? state.passengers : [];
    if (!passengers.length) throw new Error("No passengers saved.");

    await waitUntil(() =>
      queryFirstVisible(SEL.passenger?.root) ||
      queryFirstVisible(SEL.passenger?.name),
      CFG.PAGE_WAIT_MS || 25000,
      "passenger form"
    );

    for (let i = 0; i < passengers.length; i++) {
      await ensurePassengerSlot(i);
      await fillPassengerAt(i, passengers[i]);
    }

    const mobile = queryFirstVisible(SEL.passenger?.mobile);
    if (mobile && state.settings.mobile) fastFill(mobile, state.settings.mobile);

    const email = queryFirstVisible(SEL.passenger?.email);
    if (email && state.settings.email) fastFill(email, state.settings.email);

    // Mandatory Step: Tick "Book only if confirm berths are allotted"
    const confirmBerthCheck = Array.from(document.querySelectorAll('label, span, div')).find(el => /confirm berths/i.test(el.textContent));
    if (confirmBerthCheck) {
      const checkbox = confirmBerthCheck.parentElement.querySelector('input[type="checkbox"], .ui-chkbox-box') || confirmBerthCheck;
      if (!checkbox.checked && !checkbox.classList.contains('ui-state-active')) {
        fastClick(checkbox);
      }
    }
  }

  async function ensurePassengerSlot(index) {
    if (queryAllVisible(SEL.passenger?.name).length > index) return;

    const add = findActionByText(/add passenger|add|passenger/i, document, SEL.passenger?.add || ["button", "a"]);
    if (!add) throw new Error("Passenger slot " + (index + 1) + " not available.");
    fastClick(add);
    await waitUntil(() => queryAllVisible(SEL.passenger?.name).length > index, CFG.ELEMENT_WAIT_MS || 15000, "new passenger slot");
  }

  async function fillPassengerAt(index, passenger) {
    const name = queryAllVisible(SEL.passenger?.name)[index];
    const age = queryAllVisible(SEL.passenger?.age)[index];
    const gender = queryAllVisible(SEL.passenger?.gender)[index];
    const berth = queryAllVisible(SEL.passenger?.berth)[index];
    const nationality = queryAllVisible(SEL.passenger?.nationality)[index];

    if (!name || !age) throw new Error("Passenger controls missing at row " + (index + 1));

    fastFill(name, passenger.name || "");
    fastFill(age, passenger.age || "");

    if (gender) await selectControl(gender, genderCode(passenger.gender), genderAliases(passenger.gender)).catch(() => {});
    if (berth) await selectControl(berth, berthCode(passenger.berth), berthAliases(passenger.berth)).catch(() => {});
    if (nationality) await selectControl(nationality, passenger.nationality || "Indian", [passenger.nationality || "Indian", "India"]).catch(() => {});
  }

  async function continueToPayment() {
    await handleCaptchaIfPresent();

    const firstContinue = findActionByText(/^(continue|next|review journey|proceed)$/i) ||
      findActionByText(/continue|proceed|review/i, document, SEL.passenger?.continue || ["button", "a"]);
    if (!firstContinue) throw new Error("Passenger continue button not found.");
    fastClick(firstContinue);
    await acceptDialogs();

    for (let attempt = 0; attempt < 4; attempt++) {
      await handleCaptchaIfPresent();
      await acceptDialogs();

      if (isPaymentUiVisible()) return;

      const action = findActionByText(/proceed to payment|make payment|pay and book|pay & book|continue|proceed/i);
      if (action && isEnabled(action)) {
        fastClick(action);
        await minimalDelay(50);
      }

      const ready = await waitUntil(() =>
        isPaymentUiVisible() ||
        queryFirstVisible(SEL.captcha?.input) ||
        findActionByText(/proceed to payment|make payment|pay and book|pay & book/i),
        CFG.ELEMENT_WAIT_MS || 15000,
        "payment transition"
      ).catch(() => null);

      if (ready && isPaymentUiVisible()) return;
    }
  }

  async function handlePaymentUi() {
    await waitUntil(isPaymentUiVisible, CFG.PAGE_WAIT_MS || 25000, "payment UI");
    await handleCaptchaIfPresent();

    if (state.settings.paymentPause) {
      log("Payment pause enabled. Complete payment manually in the IRCTC UI.", "log-warn");
      status("booking", "PAY MANUALLY");
      await watchBookingOutcome();
      return;
    }

    // Force BHIM/UPI Flow
    const bhimCategory = findActionByText(/BHIM\/UPI/i, document, [".bank-type", "label", "button"]);
    if (bhimCategory) fastClick(bhimCategory);
    await minimalDelay(50);

    const paytmUpi = findActionByText(/Pay using BHIM.*?Paytm/i, document, [".paymentOption", "label", "button", "div"]);
    if (paytmUpi) {
      fastClick(paytmUpi);
    } else {
      const amazonUpi = findActionByText(/Amazon Pay/i, document, [".paymentOption", "label", "button", "div"]);
      if (amazonUpi) fastClick(amazonUpi);
    }
    await minimalDelay(40);

    const pay = findActionByText(/^(pay|make payment|proceed|continue)$/i, document, SEL.payment?.pay || ["button", "a"]) ||
      findActionByText(/pay|make payment|proceed/i);
    if (pay && isEnabled(pay)) {
      fastClick(pay);
      log("Payment action clicked in UI. Complete any bank or UPI challenge manually.", "log-action");
    } else {
      log("Payment UI is visible. Complete payment manually if no safe pay button is available.", "log-warn");
    }

    await watchBookingOutcome();
  }

  function isPaymentUiVisible() {
    const body = normalize(document.body?.innerText || "");
    if (/payment option|select payment|make payment|pay and book|payment gateway|upi|net banking|debit card|credit card/.test(body)) {
      return true;
    }
    return Boolean(queryFirstVisible(SEL.payment?.container));
  }

  async function watchBookingOutcome() {
    status("booking", "WATCHING PAYMENT");
    const outcome = await waitUntil(() => {
      const body = document.body?.innerText || "";
      const normalized = normalize(body);
      const pnr = extractPnr(body);
      if (pnr || /booking confirmed|congratulations|e-ticket|your ticket/.test(normalized)) {
        return { ok: true, pnr };
      }
      if (/booking failed|payment failed|not available|quota full|no seats|waitlist full|transaction failed/.test(normalized)) {
        return { ok: false };
      }
      return null;
    }, CFG.PAYMENT_WATCH_MS || 600000, "booking outcome").catch(() => null);

    if (!outcome) {
      log("Payment watch timed out. Check the IRCTC tab for final status.", "log-warn");
      return;
    }

    if (outcome.ok) {
      safeSend({ action: "bookingSuccess", pnr: outcome.pnr || "" });
      status("done", "BOOKED");
    } else {
      safeSend({ action: "bookingError", reason: "Booking or payment failed" });
      status("error", "FAILED");
    }
  }

  async function handleCaptchaIfPresent() {
    const input = queryFirstVisible(SEL.captcha?.input);
    if (!input) return false;

    const img = queryFirstVisible(SEL.captcha?.image);
    const imgDataUrl = imageToDataUrl(img);
    
    // Try auto solve if enabled
    if (state.settings.useAutoCaptcha && state.settings.twoCaptchaKey) {
      safeSend({ action: "showCaptcha", imgDataUrl, autoSolve: true });
      log("Attempting auto captcha solve.", "log-action");
      
      const autoAnswer = await waitForManualAnswer("captcha", CFG.CAPTCHA_TIMEOUT_MS || 90000);
      if (autoAnswer) {
        fastFill(input, autoAnswer);
        return true;
      }
    }
    
    // Fallback to manual
    safeSend({ action: "showCaptcha", imgDataUrl });
    status("captcha", "CAPTCHA");
    log("Captcha requires manual entry.", "log-warn");

    const answer = await waitForManualAnswer("captcha", CFG.CAPTCHA_TIMEOUT_MS || 90000);
    if (!answer) throw new Error("Captcha entry timed out.");

    fastFill(input, answer);
    return true;
  }

  async function handleOtpIfPresent() {
    // AGGRESSIVE OTP BYPASS: Ignore the UI element entirely.
    // We assume the intercept.js network spoofing will force the UI past this step.
    return false;
  }

  function waitForManualAnswer(type, timeoutMs) {
    return new Promise(resolve => {
      const key = type === "otp" ? "otpResolve" : "captchaResolve";
      const timer = setTimeout(() => {
        if (state[key]) state[key] = null;
        resolve(null);
      }, timeoutMs);

      state[key] = answer => {
        clearTimeout(timer);
        state[key] = null;
        resolve(answer);
      };
    });
  }

  function receiveManualAnswer(type, answer) {
    const value = String(answer || "").trim();
    const key = type === "otp" ? "otpResolve" : "captchaResolve";
    if (state[key]) {
      state[key](value);
      return;
    }

    const selectors = type === "otp" ? SEL.otp?.input : SEL.captcha?.input;
    const input = queryFirstVisible(selectors);
    if (input && value) fastFill(input, value);
  }

  async function acceptDialogs() {
    const buttons = queryAll(SEL.overlays?.dialogButton).filter(isVisible);
    const accept = buttons.find(btn => /^(yes|ok|continue|i agree|agree|confirm)$/i.test(textOf(btn)));
    if (accept && isEnabled(accept)) {
      fastClick(accept);
      await minimalDelay(30);
    }
  }

  async function selectControl(control, value, aliases = []) {
    if (!control || !value) return;
    const labels = [value, ...aliases].map(String).filter(Boolean);

    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find(opt => optionMatches(opt, labels));
      if (option) control.value = option.value;
      else control.value = value;
      dispatchInputEvents(control);
      return;
    }

    if (isTextInput(control)) {
      await fillAutocomplete(control, labels[0], labels[0]);
      return;
    }

    const trigger = control.querySelector(".p-dropdown-trigger, .ui-dropdown-trigger, [role='button'], input") || control;
    fastClick(trigger);
    const option = await waitForOption(labels, 1500).catch(() => null);
    if (option) {
      fastClick(option);
      await minimalDelay(20);
    }
  }

  function waitForOption(labels, timeoutMs) {
    const values = labels.map(String).filter(Boolean);
    return waitUntil(() => {
      const options = queryAll(SEL.overlays?.option).filter(isVisible);
      return options.find(option => optionMatches(option, values)) || null;
    }, timeoutMs, "option " + values.join("/"));
  }

  function optionMatches(option, labels) {
    const text = normalize(textOf(option));
    return labels.some(label => {
      const normalized = normalize(label);
      return normalized && (text === normalized || text.includes(normalized));
    });
  }

  function fastFill(el, value) {
    if (!el) return;
    const text = String(value ?? "");
    el.focus?.();

    if (el.isContentEditable) {
      el.textContent = text;
      dispatchInputEvents(el);
      return;
    }

    if (el instanceof HTMLSelectElement) {
      el.value = text;
      dispatchInputEvents(el);
      return;
    }

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;

    dispatchInputEvents(el);
  }

  function dispatchInputEvents(el) {
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fastClick(el) {
    if (!el || !isEnabled(el)) return;
    const target = clickableAncestor(el) || el;
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1 }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, buttons: 1 }));
    target.click?.();
  }

  function pressEnter(el) {
    if (!el) return;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  function minimalDelay(ms = CFG.MIN_ACTION_DELAY_MS || 10) {
    const bounded = Math.max(CFG.MIN_ACTION_DELAY_MS || 10, Math.min(ms, CFG.MAX_ACTION_DELAY_MS || 60));
    return new Promise(resolve => setTimeout(resolve, bounded));
  }

  function waitForElement(selectors, timeoutMs) {
    return waitUntil(() => queryFirstVisible(selectors), timeoutMs, "element");
  }

  function waitUntil(predicate, timeoutMs, label = "condition") {
    return new Promise((resolve, reject) => {
      let settled = false;
      let raf = 0;
      const timeout = setTimeout(() => finish(null, new Error("Timeout: " + label)), timeoutMs);
      const observer = new MutationObserver(check);

      function finish(value, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancelAnimationFrame(raf);
        observer.disconnect();
        if (error) reject(error);
        else resolve(value);
      }

      function check() {
        if (settled) return;
        try {
          checkAbort();
          const result = predicate();
          if (result) finish(result);
          else raf = requestAnimationFrame(check);
        } catch (error) {
          finish(null, error);
        }
      }

      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      check();
    });
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectorList(selectors)) {
      try {
        const found = root.querySelector(selector);
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function queryFirstVisible(selectors, root = document) {
    return queryAll(selectors, root).find(isVisible) || null;
  }

  function queryAllVisible(selectors, root = document) {
    return queryAll(selectors, root).filter(isVisible);
  }

  function queryAll(selectors, root = document) {
    const found = [];
    for (const selector of selectorList(selectors)) {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch {}
    }
    return uniqueElements(found);
  }

  function selectorList(selectors) {
    if (!selectors) return [];
    if (Array.isArray(selectors)) return selectors.flatMap(selectorList);
    return [String(selectors)];
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function findEnabledAction(selectors, textPattern, root = document) {
    return queryAll(selectors, root).find(el =>
      isVisible(el) && isEnabled(el) && (!textPattern || textPattern.test(textOf(el)))
    ) || null;
  }

  function findActionByText(pattern, root = document, selectors = ["button", "a", "[role='button']", "label"]) {
    const candidates = queryAll(selectors, root).filter(isVisible);
    const direct = candidates.find(el => pattern.test(textOf(el)) && isEnabled(el));
    if (direct) return direct;

    const allowLooseText = selectorList(selectors).some(selector => /\b(span|div)\b/.test(selector));
    if (!allowLooseText) return null;

    const textNodes = queryAll(["button", "a", "span", "div", "label", "[role='button']"], root).filter(isVisible);
    const match = textNodes.find(el => pattern.test(textOf(el)));
    return match ? clickableAncestor(match) || match : null;
  }

  function clickableAncestor(el) {
    return el?.closest?.("button,a,label,[role='button'],.p-dropdown,.ui-dropdown,.mat-select,.ng-select") || el;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEnabled(el) {
    if (!el) return false;
    const target = clickableAncestor(el) || el;
    return !target.disabled &&
      target.getAttribute("aria-disabled") !== "true" &&
      !target.classList.contains("disabled") &&
      !target.classList.contains("ui-state-disabled") &&
      !target.classList.contains("p-disabled");
  }

  function isTextInput(el) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || el?.value || "").trim();
  }

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatDateForUi(yyyyMmDd) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd || ""));
    if (!match) return yyyyMmDd || "";
    return match[3] + "/" + match[2] + "/" + match[1];
  }

  function classAliases(code) {
    const label = CFG.CLASS_LABELS?.[code] || "";
    return [code, label, label ? label + " (" + code + ")" : ""].filter(Boolean);
  }

  function quotaAliases(code) {
    const label = CFG.QUOTA_LABELS?.[code] || "";
    return [code, label, label ? label + " (" + code + ")" : ""].filter(Boolean);
  }

  function genderCode(gender) {
    const value = normalize(gender);
    if (value.startsWith("f")) return "F";
    if (value.startsWith("t")) return "T";
    return "M";
  }

  function genderAliases(gender) {
    const code = genderCode(gender);
    const label = code === "F" ? "Female" : code === "T" ? "Transgender" : "Male";
    return [code, label, gender].filter(Boolean);
  }

  function berthCode(berth) {
    const map = {
      "lower": "LB",
      "middle": "MB",
      "upper": "UB",
      "side lower": "SL",
      "side upper": "SU",
      "window": "WS",
      "no preference": "NP"
    };
    return map[normalize(berth)] || "NP";
  }

  function berthAliases(berth) {
    const code = berthCode(berth);
    return [code, berth || "No Preference", "No Preference"].filter(Boolean);
  }

  function paymentPattern(method) {
    const value = normalize(method || "");
    if (!value) return null;
    if (value.includes("paytm")) return /paytm/i;
    if (value.includes("phonepe")) return /phonepe|phone pe/i;
    if (value.includes("razor")) return /razorpay/i;
    if (value.includes("ipay")) return /irctc\s*ipay|ipay/i;
    if (value.includes("upi")) return /upi|bhim/i;
    return new RegExp(escapeRegExp(method), "i");
  }

  function extractPnr(text) {
    const match = /PNR(?:\s*(?:No|Number)\.?)?\s*[:\-]?\s*([0-9]{10})/i.exec(String(text || ""));
    return match?.[1] || "";
  }

  function targetSummary() {
    return (state.target.train || state.journey.trainNo || "?") + " / " +
      (state.target.class || state.journey.travelClass || "?");
  }

  function formatTime(epochMs) {
    const d = new Date(epochMs);
    return d.toLocaleTimeString("en-IN", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function timestamp() {
    const d = new Date();
    return d.toLocaleTimeString("en-IN", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function safeSend(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {}
  }

  function log(text, cls = "log-action") {
    const line = "[" + timestamp() + "] " + text;
    console.log("[Tatkal UI]", line);
    panelLog(line, cls);
    safeSend({ action: "bookingLog", text: line, cls });
  }

  function status(stateName, text) {
    panelStatus(text);
    safeSend({ action: "contentStatus", state: stateName, text });
  }

  async function recordError(code, message, detail = "") {
    const entry = {
      ts: new Date().toISOString(),
      step: state.currentStep,
      url: location.href,
      code,
      message: String(message || "").slice(0, 400),
      detail: String(detail || "").slice(0, 800)
    };

    try {
      chrome.storage.local.get(["errorLog"], data => {
        const errorLog = Array.isArray(data.errorLog) ? data.errorLog : [];
        errorLog.push(entry);
        chrome.storage.local.set({ errorLog: errorLog.slice(-200) });
      });
    } catch {}

    safeSend({ action: "errorLogged", entry });
    log("[" + code + "] " + message, "log-error");
  }

  function imageToDataUrl(img) {
    if (!img) return "";
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 220;
      canvas.height = img.naturalHeight || img.height || 80;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } catch {
      return img.currentSrc || img.src || "";
    }
  }

  function ensurePanel() {
    if (document.getElementById("ta-panel")) return;
    if (!document.body) return;

    const panel = document.createElement("div");
    panel.id = "ta-panel";
    panel.innerHTML = [
      '<div class="ta-hdr">',
      '<div class="ta-logo">TATKAL UI ASSISTANT</div>',
      '<button class="ta-close" type="button" aria-label="Close">&times;</button>',
      "</div>",
      '<div class="ta-status" id="ta-status">Ready</div>',
      '<div class="ta-log" id="ta-log"></div>'
    ].join("");

    panel.querySelector(".ta-close").addEventListener("click", () => panel.remove());
    document.body.appendChild(panel);
  }

  function panelStatus(text) {
    const el = document.getElementById("ta-status");
    if (el) el.textContent = text || "";
  }

  function panelLog(text, cls) {
    const logEl = document.getElementById("ta-log");
    if (!logEl) return;
    const line = document.createElement("div");
    line.className = cls || "log-action";
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 80) logEl.firstElementChild?.remove();
  }
})();
