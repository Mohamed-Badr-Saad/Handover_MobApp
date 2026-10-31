/* ==========================================================================
   app.js - startup, sign-in, manager views, routing and the phone chrome
   (bottom tab bar, install hint, offline banner, new-version banner).
   Data and security live in Supabase (see store.js); this file only decides
   which screen to show.
   ========================================================================== */
(function (global) {
  "use strict";

  global.APP_VERSION = "1.1.4";

  var esc = global.Util.esc;
  var t = global.t;
  var S = global.Store;

  var state = {
    user: null,
    parts: ["dashboard"],
    query: {},
    wired: false,
    ticker: null,
    unread: 0,
    roster: [],
    installPrompt: null,
    swReg: null
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }

  function describeError(e) {
    if (!e) { return t("err.read"); }
    if (e.name === "WrongPassword") { return t("auth.wrong"); }
    if (e.name === "ConfirmEmailOn") { return t("pwa.confirmEmailOn"); }
    if (e.name === "AccountExists") { return t("pwa.accountExists"); }
    if (!navigator.onLine || /fetch|network|load failed|timed? ?out/i.test(e.message || "")) { return t("pwa.cannotReach"); }
    return e.message || String(e);
  }

  /* ================================= GATE ================================= */

  function showGate(title, bodyHtml, footHtml) {
    $("#app").classList.add("hidden");
    $("#gate").classList.remove("hidden");
    $("#gate-title").textContent = t("app.name");
    $("#gate-sub").textContent = title || t("app.tagline");
    $("#gate-body").innerHTML = bodyHtml;
    $("#gate-foot").innerHTML = (footHtml || ("v" + esc(global.APP_VERSION))) + gateInstallLink() + global.Credits.html("credits-gate");
    var gi = document.getElementById("g-install");
    if (gi) { gi.addEventListener("click", function () { promptInstall(); }); }
    if (global.UI.scanPasswords) { global.UI.scanPasswords($("#gate-body")); }
  }
  function hideGate() {
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
  }
  function box(kind, text) {
    if (!text) { return ""; }
    var bg = kind === "err" ? "var(--danger-soft)" : "var(--accent-soft)";
    var fg = kind === "err" ? "var(--danger)" : "var(--accent)";
    return '<div style="background:' + bg + ";color:" + fg + ';padding:10px 12px;border-radius:var(--radius-s);' +
      'margin-bottom:14px;font-size:.87rem;white-space:pre-wrap">' + esc(text) + "</div>";
  }

  function gateMessage(text, retry) {
    showGate("", '<div class="gate-step">' + box("err", text) +
      (retry ? '<button class="btn primary" id="g-retry">' + esc(t("common.retry")) + "</button>" : "") + "</div>");
    if (retry) { $("#g-retry").addEventListener("click", function () { boot(); }); }
  }

  async function gatePickUser(errorText) {
    showGate(t("gate.who.title"), '<div class="gate-step"><p>' + esc(t("pwa.loading")) + "</p></div>");
    try {
      state.roster = await S.roster();
      try { global.Prefs.set("roster", state.roster); } catch (e) { /* cache only */ }
    } catch (e) {
      state.roster = global.Prefs.get("roster", []) || [];
      if (!state.roster.length) { gateMessage(describeError(e), true); return; }
    }
    if (!state.roster.length) { gateMessage(t("pwa.noRoster"), true); return; }

    var last = global.Prefs.get("lastStaff", "");
    showGate(t("gate.who.title"),
      '<div class="gate-step">' + box("err", errorText) + "<p>" + esc(t("pwa.whoDesc")) + "</p>" +
      '<div class="field"><select class="input" id="g-user">' +
        '<option value="">—</option>' +
        state.roster.map(function (u) {
          return '<option value="' + esc(u.id) + '"' + (u.id === last ? " selected" : "") + ">" + esc(u.name) +
            (u.job_title ? " — " + esc(u.job_title) : "") + "</option>";
        }).join("") +
      "</select></div>" +
      '<button class="btn primary" id="g-ok" style="width:100%">' + esc(t("common.confirm")) + "</button></div>");

    function go() {
      var id = $("#g-user").value;
      var u = state.roster.filter(function (x) { return x.id === id; })[0];
      if (u) { global.Prefs.set("lastStaff", u.id); gatePassword(u); }
    }
    $("#g-ok").addEventListener("click", go);
    $("#g-user").addEventListener("change", function () { if ($("#g-user").value) { go(); } });
  }

  function gatePassword(u, errorText, forceMode) {
    var fresh = forceMode ? forceMode === "create" : !u.has_account;
    showGate(fresh ? t("auth.setTitle") : t("auth.enterTitle"),
      '<div class="gate-step">' + box("err", errorText) +
        "<p>" + esc(t(fresh ? "auth.setDesc" : "auth.enterDesc", { name: u.name })) + "</p>" +
        '<form id="g-form" autocomplete="on" onsubmit="return false">' +
        '<input type="text" name="username" autocomplete="username" value="' + esc(u.name) + '" class="hidden" readonly>' +
        '<div class="field"><label>' + esc(t(fresh ? "auth.newPassword" : "auth.password")) + "</label>" +
          '<input type="password" class="input" id="a-pw" autocomplete="' + (fresh ? "new-password" : "current-password") + '"></div>' +
        (fresh ? '<div class="field"><label>' + esc(t("auth.confirmPassword")) + "</label>" +
          '<input type="password" class="input" id="a-pw2" autocomplete="new-password"></div>' : "") +
        '<button type="submit" class="btn primary" id="a-go" style="width:100%">' + esc(t(fresh ? "auth.create" : "auth.signIn")) + "</button>" +
        "</form>" +
        '<button class="btn ghost" id="a-other" style="width:100%;margin-top:8px">' + esc(t("auth.notYou")) + "</button>" +
      "</div>");

    async function submit() {
      var pw = $("#a-pw").value;
      if (fresh) {
        if (pw.length < 6) { gatePassword(u, t("auth.short"), forceMode); return; }
        if (pw !== $("#a-pw2").value) { gatePassword(u, t("auth.mismatch"), forceMode); return; }
      } else if (!pw) { $("#a-pw").focus(); return; }
      $("#a-go").disabled = true;
      $("#a-go").textContent = t("pwa.signingIn");
      var wasFirst = fresh && !state.roster.some(function (x) { return x.has_account; });
      try {
        var me = fresh ? await S.createAccount(u.id, pw) : await S.signIn(u.id, pw);
        if (!me) { throw new Error(t("pwa.noRoster")); }
        await afterSignIn(wasFirst && me.isAdmin);
      } catch (e) {
        S.log("signin", (e && e.name) + " " + (e && e.message));
        if (e && e.name === "AccountExists") { u.has_account = true; gatePassword(u, describeError(e), "signin"); return; }
        gatePassword(u, describeError(e), forceMode);
      }
    }
    $("#g-form").addEventListener("submit", submit);
    $("#a-other").addEventListener("click", function () { gatePickUser(""); });
    setTimeout(function () { var el = $("#a-pw"); if (el) { el.focus(); } }, 50);
  }

  async function afterSignIn(firstAdmin) {
    showGate("", '<div class="gate-step"><p>' + esc(t("pwa.loading")) + "</p></div>");
    try { await S.loadMaster(); }
    catch (e) { gateMessage(describeError(e), true); return; }
    state.user = S.me();
    if (!state.user) { await S.signOut(); gatePickUser(t("pwa.noRoster")); return; }
    paintAdmin();
    startView();
    if (firstAdmin) { setTimeout(function () { global.UI.toast(t("pwa.firstAdmin"), "ok"); }, 600); }
  }

  /* ============================ MANAGER VIEWS ============================== */

  function isManager() { return !!(state.user && state.user.role === "manager"); }

  function startView() {
    if (!isManager()) { S.setView("engineers"); paintViewSwitch(); enterApp(); return; }
    var chosen = global.Session.get("view." + state.user.id, null);
    if (chosen) { S.setView(chosen); paintViewSwitch(); enterApp(); return; }
    gateChooseView();
  }

  function viewCard(v, last) {
    return '<button type="button" class="view-card v-' + v + (last === v ? " last" : "") + '" data-view="' + v + '">' +
      '<span class="view-card-title">' + esc(t("view." + v)) + "</span>" +
      '<span class="view-card-desc">' + esc(t("view." + v + "Desc")) + "</span>" +
      '<span class="view-card-count" id="vc-' + v + '">&nbsp;</span>' +
      (last === v ? '<span class="view-card-last">' + esc(t("view.last")) + "</span>" : "") +
      "</button>";
  }

  function gateChooseView() {
    var last = global.Prefs.get("view." + state.user.id, "");
    showGate(t("view.title"),
      '<div class="gate-step"><p>' + esc(t("view.desc", { name: state.user.name })) + "</p>" +
        '<div class="view-cards">' + viewCard("managers", last) + viewCard("engineers", last) + "</div>" +
        '<p class="small faint" style="margin-top:12px">' + esc(t("view.hint")) + "</p></div>");
    $$(".view-card").forEach(function (b) {
      b.addEventListener("click", function () { chooseView(b.getAttribute("data-view"), true); });
    });
    (async function () {
      try {
        var before = S.getView();
        S.setView("managers");
        var m = (await S.listHandovers()).length;
        S.setView("engineers");
        var e = (await S.listHandovers()).length;
        S.setView(before);
        var em = document.getElementById("vc-managers"), ee = document.getElementById("vc-engineers");
        if (em) { em.textContent = t("view.count", { n: global.Fmt.num(m) }); }
        if (ee) { ee.textContent = t("view.count", { n: global.Fmt.num(e) }); }
      } catch (err) { /* counts are a nicety */ }
    })();
  }

  function chooseView(v, fromGate) {
    S.setView(v);
    if (state.user) {
      global.Session.set("view." + state.user.id, S.getView());
      global.Prefs.set("view." + state.user.id, S.getView());
    }
    paintViewSwitch();
    if (fromGate) { enterApp(); return; }
    refreshBadges();
    global.UI.toast(t("view.switched", { v: t("view." + S.getView()) }));
    if (state.parts && state.parts[0] === "handover" && (state.parts[1] === "new" || state.parts[2] === "edit")) {
      if (global.Views.onViewChange) { global.Views.onViewChange(); }
      return;
    }
    render();
  }

  function paintViewSwitch() {
    var el = $("#view-switch");
    var mgr = isManager();
    document.body.classList.toggle("in-managers-view", mgr && S.getView() === "managers");
    document.body.classList.toggle("is-manager", mgr);
    if (!el) { return; }
    el.classList.toggle("hidden", !mgr);
    $$("#view-switch [data-view]").forEach(function (b) {
      var on = b.getAttribute("data-view") === S.getView();
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function paintAdmin() {
    $$(".admin-only").forEach(function (el) { el.classList.toggle("hidden", !S.isAdmin()); });
  }

  /* ================================ APP ================================ */

  function enterApp() {
    hideGate();
    paintUserChip();
    refreshBadges();
    if (!state.ticker) { state.ticker = setInterval(refreshBadges, 60000); }
    var start = parsePath(global.location.hash);
    if (!global.location.hash || start.parts[0] === "dashboard") { navigate("dashboard", true); }
    else { state.parts = start.parts; state.query = start.query; render(); }
    setTimeout(maybeShowInstall, 1500);
  }

  function paintCredits() {
    var nf = document.getElementById("nav-credits");
    if (nf && !nf.innerHTML) { nf.innerHTML = global.Credits.html("credits-nav"); }
  }

  function paintUserChip() {
    paintCredits();
    var name = state.user ? state.user.name : "";
    $("#user-name-label").textContent = name;
    $("#user-avatar").textContent = state.user ? global.Views.initials(name) : "?";
  }

  function paintUnread(unread) {
    state.unread = unread;
    var txt = unread > 99 ? "99+" : global.Fmt.num(unread);
    [["#nav-unread"], ["#tab-unread"]].forEach(function (sel) {
      var el = $(sel[0]);
      if (el) { el.textContent = txt; el.classList.toggle("hidden", unread === 0); }
    });
    var dot = $("#bell-dot");
    if (dot) { dot.classList.toggle("hidden", unread === 0); }
    try {
      if (navigator.setAppBadge) { if (unread) { navigator.setAppBadge(unread); } else { navigator.clearAppBadge(); } }
    } catch (e) { /* not supported */ }
  }
  function adjustUnread(delta) { paintUnread(Math.max(0, (state.unread || 0) + delta)); }

  async function refreshBadges() {
    if (!S.connected() || !navigator.onLine) { return; }
    try {
      var list = await S.listNotifications(100);
      paintUnread(list.filter(function (n) { return S.isUnread(n); }).length);
    } catch (e) { /* offline for a moment */ }
  }

  /* ================================= ROUTING =================================
     Screens follow the address after "#", so the phone's Back button and
     the browser history work as expected. */

  function parsePath(str) {
    var raw = String(str || "dashboard").replace(/^#\/?/, "").replace(/^\//, "");
    var query = {};
    var qPos = raw.indexOf("?");
    if (qPos >= 0) {
      raw.slice(qPos + 1).split("&").forEach(function (pair) {
        if (!pair) { return; }
        var kv = pair.split("=");
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
      raw = raw.slice(0, qPos);
    }
    var parts = raw.split("/").filter(Boolean);
    return { parts: parts.length ? parts : ["dashboard"], query: query };
  }

  function isFormRoute(parts) { return parts[0] === "handover" && (parts[1] === "new" || parts[2] === "edit" || parts[1] === "import"); }

  function navigate(str, replace) {
    var r = parsePath(str);
    var hash = "#/" + r.parts.join("/") +
      (Object.keys(r.query).length ? "?" + Object.keys(r.query).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(r.query[k]);
      }).join("&") : "");
    // Leaving a form after saving should not leave the form in the Back history.
    if (replace || isFormRoute(state.parts)) {
      try { global.history.replaceState(null, "", hash); } catch (e) { /* ignore */ }
      state.parts = r.parts; state.query = r.query;
      render();
      return;
    }
    if (global.location.hash === hash) { state.parts = r.parts; state.query = r.query; render(); return; }
    global.location.hash = hash;          // hashchange -> render
  }

  function onHashChange() {
    if (!S.connected()) { return; }
    var r = parsePath(global.location.hash);
    state.parts = r.parts; state.query = r.query;
    render();
  }

  var LAZY = {};
  function loadScript(src) {
    if (!LAZY[src]) {
      LAZY[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src; s.onload = resolve;
        s.onerror = function () { delete LAZY[src]; reject(new Error("could not load " + src)); };
        document.head.appendChild(s);
      });
    }
    return LAZY[src];
  }
  function needXlsx() {
    return Promise.all([loadScript("js/vendor/xlsx.full.min.js"), loadScript("js/import-template.js")]);
  }

  /* One screen is drawn at a time; if the person moves on while a screen is
     still loading, the newest choice is drawn right after, so a slow screen
     can never paint over the one they asked for last. */
  var drawing = null, drawAgain = false;
  async function render() {
    if (drawing) { drawAgain = true; return drawing; }
    drawing = draw();
    try { await drawing; } finally { drawing = null; }
    if (drawAgain) { drawAgain = false; return render(); }
  }

  async function draw() {
    if (!S.connected()) { return; }
    var parts = state.parts, query = state.query;
    var head = parts[0] || "dashboard";
    var tabKey = head === "handover" && parts[1] === "new" ? "handover/new"
      : (head === "handover" || head === "search") ? "handovers"
      : ["dashboard", "handovers", "notifications"].indexOf(head) >= 0 ? head : "more";

    $$(".nav-item").forEach(function (el) {
      var key = el.getAttribute("data-route");
      el.classList.toggle("active", key === head || (key === "handovers" && head === "handover") ||
        (key === "admin" && (head === "archive-import" || head === "move-data" || head === "delete-handovers")));
    });
    $$(".tab").forEach(function (el) { el.classList.toggle("active", el.getAttribute("data-tab") === tabKey); });
    document.body.classList.remove("search-open");
    if (head !== "dashboard") { $("#install-banner").classList.add("hidden"); }
    global.scrollTo(0, 0);

    try {
      if ((head === "handover" && parts[1] === "import") || head === "archive-import") {
        document.getElementById("view").innerHTML = '<div class="empty">' + esc(t("common.loading")) + "</div>";
        await needXlsx();
      }
      if (head === "dashboard") { await global.Views.dashboard(); }
      else if (head === "handovers") { await global.Views.handoverList(query); }
      else if (head === "handover") {
        if (parts[1] === "new") { global.Views.handoverForm("new"); }
        else if (parts[1] === "import") { await global.Views.handoverImport(query); }
        else if (parts[2] === "edit") { await global.Views.handoverForm(parts[1]); }
        else { await global.Views.handoverDetail(parts[1]); }
      }
      else if (head === "equipment") {
        if (parts[1]) { await global.Views.equipmentDetail(decodeURIComponent(parts[1])); }
        else { await global.Views.equipmentList(); }
      }
      else if (head === "notifications") { await global.Views.notifications(); }
      else if (head === "profile") { await global.Views.profile(); }
      else if (head === "admin") { await global.Views.admin(); }
      else if (head === "archive-import") { await global.Views.archiveImport(query); }
      else if (head === "move-data") { await global.MoveData.page(); }
      else if (head === "delete-handovers") { await global.MoveData.deletePage(query); }
      else if (head === "search") { await global.Views.search(query.q || ""); }
      else if (head === "more") { more(); }
      else { navigate("dashboard", true); }
    } catch (e) {
      S.log("render", head, e && e.message);
      document.getElementById("view").innerHTML =
        '<div class="empty"><p>' + esc(t("err.read")) + "</p>" +
        '<p class="small faint">' + esc(describeError(e)) + "</p>" +
        '<button class="btn" id="err-retry">' + esc(t("common.retry")) + "</button></div>";
      var retry = $("#err-retry");
      if (retry) { retry.addEventListener("click", function () { S.invalidate(); render(); }); }
    }
  }

  /* "More" (phones): everything that is not on the tab bar. */
  function more() {
    function item(route, icon, label, sub, cls) {
      return '<button class="more-item' + (cls ? " " + cls : "") + '" data-more="' + route + '">' + icon +
        "<span>" + esc(label) + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</span></button>";
    }
    var ic = {
      eq: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 3h-1.6a7.4 7.4 0 0 0-1.1-2.6l1.1-1.1-1.4-1.4-1.1 1.1A7.4 7.4 0 0 0 13 4.7V3h-2v1.7a7.4 7.4 0 0 0-2.6 1.1L7.3 4.7 5.9 6.1 7 7.2A7.4 7.4 0 0 0 5.9 11H4.1v2h1.8c.2.9.6 1.8 1.1 2.6l-1.1 1.1 1.4 1.4 1.1-1.1c.8.5 1.7.9 2.6 1.1V21h2v-1.9c.9-.2 1.8-.6 2.6-1.1l1.1 1.1 1.4-1.4-1.1-1.1c.5-.8.9-1.7 1.1-2.6h1.6v-2z"/></svg>',
      search: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>',
      imp: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-18-5.5 5.5 1.4 1.4L11 5.8V16h2V5.8l3.1 3.1 1.4-1.4L12 2z"/></svg>',
      user: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-9 2-9 5v3h18v-3c0-3-5-5-9-5z"/></svg>',
      admin: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4z"/></svg>',
      phone: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M17 1H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 18H7V5h10v14z"/></svg>',
      out: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 3h8v2H4v14h8v2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>'
    };
    var u = state.user;
    document.getElementById("view").innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("nav.more")) + "</h1></div></div>" +
      '<div class="card"><div class="more-user"><span class="avatar lg">' + esc(global.Views.initials(u.name)) + "</span>" +
        "<div><b>" + esc(u.name) + '</b><div class="small faint">' + esc(u.jobTitle || "") +
        (u.isAdmin ? " · " + esc(t("admin.adminBadge")) : "") + "</div></div></div>" +
      '<div class="more-list">' +
        item("search", ic.search, t("nav.search"), "") +
        item("equipment", ic.eq, t("nav.equipment"), "") +
        item("handover/import", ic.imp, t("imp.open"), "") +
        item("profile", ic.user, t("nav.profile"), t("auth.change")) +
        (S.isAdmin() ? item("admin", ic.admin, t("nav.admin"), "") : "") +
        (isStandalone() ? "" : item("install", ic.phone, t("pwa.installTitle"), "")) +
        item("signout", ic.out, t("profile.signOut"), "", "danger") +
      "</div></div>" +
      '<div class="card more-about"><div class="small faint">' + esc(t("app.name")) + " v" + esc(global.APP_VERSION) +
        " \u00b7 " + esc(t("org.short")) + " " + esc(t("org.dept")) + "</div>" + global.Credits.html() + "</div>";
    $$("[data-more]").forEach(function (b) {
      b.addEventListener("click", function () {
        var r = b.getAttribute("data-more");
        if (r === "signout") { signOut(); return; }
        if (r === "install") { showInstallHelp(); return; }
        if (r === "search") { openSearch(); return; }
        navigate(r);
      });
    });
  }

  function openSearch() {
    document.body.classList.add("search-open");
    var inp = $("#global-search");
    inp.focus();
  }

  /* ============================ INSTALL / UPDATE ============================ */

  /* Which browser are we in - decides how installing works. */
  function platform() {
    var ua = navigator.userAgent || "";
    if (isIos()) { return /crios|fxios|edgios|opios|gsa\//i.test(ua) ? "ios-other" : "ios-safari"; }
    if (/android/i.test(ua)) { return /chrome|samsungbrowser|edga?\//i.test(ua) && !/; wv\)|fb_iab|instagram/i.test(ua) ? "android" : "android-other"; }
    if (/edg\/|chrome\//i.test(ua)) { return "desktop"; }
    return "desktop-other";
  }

  function installSteps() {
    var p = platform();
    var keys = {
      "android": ["pwa.stepAndroid1", "pwa.stepAndroid2"],
      "android-other": ["pwa.stepAndroidOther"],
      "ios-safari": ["pwa.stepIos1", "pwa.stepIos2", "pwa.stepIos3"],
      "ios-other": ["pwa.stepIosOther1", "pwa.stepIosOther2"],
      "desktop": ["pwa.stepDesktop"],
      "desktop-other": ["pwa.stepDesktopOther"]
    }[p];
    return '<ol class="install-steps">' + keys.map(function (k) { return "<li>" + esc(t(k)) + "</li>"; }).join("") + "</ol>";
  }

  /* Card / dialog body: one-tap install where the browser allows it,
     otherwise the steps for this phone. */
  function installHelp(el) {
    if (!el) { return; }
    if (isStandalone()) { el.innerHTML = "<p>" + esc(t("pwa.installed")) + "</p>"; return; }
    el.innerHTML =
      '<div class="install-hero"><img src="img/icon-192.png" alt="" width="64" height="64">' +
        "<div><b>" + esc(t("app.name")) + '</b><div class="small faint">' + esc(t("pwa.whyInstall")) + "</div></div></div>" +
      (state.installPrompt
        ? '<button class="btn primary install-big" data-install-now>' + esc(t("pwa.installNow")) + "</button>" +
          '<p class="small faint" style="margin:8px 0 0">' + esc(t("pwa.orManually")) + "</p>"
        : "") +
      installSteps() +
      '<p class="small faint" style="margin:8px 0 0">' + esc(t("pwa.alreadyInstalled")) + "</p>";
    var b = el.querySelector("[data-install-now]");
    if (b) { b.addEventListener("click", promptInstall); }
  }

  var sheetOpen = null;
  function showInstallHelp() {
    global.Session.set("installAsked", true);
    var body = document.createElement("div");
    body.className = "install-sheet";
    installHelp(body);
    sheetOpen = body;
    $("#install-banner").classList.add("hidden");
    global.UI.modal({ title: t("pwa.installTitle"), body: body, buttons: [
      { label: t("pwa.later"), value: null }
    ] }).then(function () {
      sheetOpen = null;
      global.Session.set("installAsked", true);
    });
  }

  async function promptInstall() {
    var p = state.installPrompt;
    if (!p) { showInstallHelp(); return; }
    state.installPrompt = null;
    $("#install-banner").classList.add("hidden");
    try {
      p.prompt();
      var choice = await p.userChoice;
      if (choice && choice.outcome === "accepted") {
        global.UI.toast(t("pwa.installing"), "ok");
        var close = document.getElementById("modal-close");
        if (sheetOpen && close) { close.click(); }
      }
    } catch (e) { /* dismissed */ }
  }

  /* Opened in Chrome / Safari instead of the installed app: invite to install.
     The full card once per visit; after that a small banner on the dashboard. */
  function maybeShowInstall() {
    if (isStandalone() || !state.user) { return; }
    if (sheetOpen) { $("#install-banner").classList.add("hidden"); return; }
    if (!global.Session.get("installAsked", false) && !sheetOpen && $("#modal-host").classList.contains("hidden")) {
      showInstallHelp();
      return;
    }
    if ((state.parts[0] || "dashboard") !== "dashboard") { return; }
    if (Date.now() - Number(global.Prefs.get("installLater", 0)) < 864e5) { return; }
    $("#install-text").textContent = state.installPrompt ? t("pwa.installBanner") : t("pwa.installBannerManual");
    $("#install-go").textContent = state.installPrompt ? t("pwa.installNow") : t("pwa.howTo");
    $("#install-banner").classList.remove("hidden");
  }

  /* On the sign-in screen: a small install link under the card. */
  function gateInstallLink() {
    if (isStandalone()) { return ""; }
    return '<div style="margin-top:10px"><button class="btn sm ghost" id="g-install">' + esc(t("pwa.installTitle")) + "</button></div>";
  }

  function wireServiceWorker() {
    if (!("serviceWorker" in navigator) || !global.isSecureContext) { return; }
    // Reload only when the person chose "Reload" for a new version - not when
    // the very first service worker takes over (that would interrupt sign-in).
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!state.wantReload) { return; }
      state.wantReload = false;
      global.location.reload();
    });
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      state.swReg = reg;
      function offer() { if (reg.waiting && navigator.serviceWorker.controller) { $("#update-banner").classList.remove("hidden"); } }
      offer();
      reg.addEventListener("updatefound", function () {
        var nw = reg.installing;
        if (nw) { nw.addEventListener("statechange", function () { if (nw.state === "installed") { offer(); } }); }
      });
    }).catch(function (e) { S.log("sw", e && e.message); });
  }

  function checkUpdate(manual) {
    var reg = state.swReg;
    if (!reg) { if (manual) { global.UI.toast(t("pwa.upToDate")); } return; }
    reg.update().then(function () {
      setTimeout(function () {
        if (reg.waiting) { $("#update-banner").classList.remove("hidden"); }
        else if (manual && !reg.installing) { global.UI.toast(t("pwa.upToDate"), "ok"); }
      }, 1500);
    }).catch(function () { if (manual) { global.UI.toast(t("pwa.cannotReach"), "err"); } });
  }

  function paintOnline() {
    var off = !navigator.onLine;
    $("#offline-banner").classList.toggle("hidden", !off);
  }

  /* ============================== CHROME WIRING ============================== */

  function wireChrome() {
    if (state.wired) { return; }
    state.wired = true;

    $$(".nav-item").forEach(function (el) {
      el.addEventListener("click", function (e) { e.preventDefault(); navigate(el.getAttribute("data-route")); });
    });
    $$(".tab").forEach(function (el) {
      el.addEventListener("click", function () { navigate(el.getAttribute("data-tab")); });
    });
    $("#bell-btn").addEventListener("click", function () { navigate("notifications"); });
    $("#user-chip").addEventListener("click", function () { navigate("profile"); });
    $("#fab-new").addEventListener("click", function () { navigate("handover/new"); });
    $("#search-toggle").addEventListener("click", function () {
      if (document.body.classList.contains("search-open")) { document.body.classList.remove("search-open"); }
      else { openSearch(); }
    });
    $$("#view-switch [data-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-view") !== S.getView()) { chooseView(b.getAttribute("data-view"), false); }
      });
    });

    var searchBox = $("#global-search");
    searchBox.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && searchBox.value.trim()) {
        searchBox.blur();
        navigate("search?q=" + encodeURIComponent(searchBox.value.trim()));
      }
      if (e.key === "Escape") { document.body.classList.remove("search-open"); }
    });
    searchBox.addEventListener("blur", function () {
      setTimeout(function () { if (!searchBox.value) { document.body.classList.remove("search-open"); } }, 150);
    });

    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".dropdown")) { return; }
      $$(".dropdown-panel").forEach(function (panel) { panel.classList.add("hidden"); });
    });

    global.addEventListener("hashchange", onHashChange);
    global.addEventListener("online", async function () {
      paintOnline();
      S.invalidate();
      // opened without a connection: confirm who is signed in now that we can
      try { if (state.user) { await S.loadMe(); await S.loadMaster(); paintAdmin(); } } catch (e) { /* stay on saved data */ }
      refreshBadges();
    });
    global.addEventListener("offline", paintOnline);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.user) { S.invalidate(); refreshBadges(); checkUpdate(false); }
    });

    global.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      state.installPrompt = e;
      if (sheetOpen) { installHelp(sheetOpen); return; }       // add the one-tap button to the open card
      if (state.user) { maybeShowInstall(); }
    });
    global.addEventListener("appinstalled", function () {
      $("#install-banner").classList.add("hidden");
      global.UI.toast(t("pwa.installedNow"), "ok");
    });
    $("#install-go").addEventListener("click", promptInstall);
    $("#install-later").addEventListener("click", function () {
      global.Prefs.set("installLater", Date.now());
      $("#install-banner").classList.add("hidden");
    });
    $("#update-go").addEventListener("click", function () {
      var reg = state.swReg;
      if (reg && reg.waiting) { state.wantReload = true; reg.waiting.postMessage("skip-waiting"); }
      else { global.location.reload(); }
    });

    // A session that ends elsewhere (password reset by an administrator, expiry).
    S.client.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT" && state.user) {
        state.user = null;
        S.signOut().then(function () { gatePickUser(""); });
      }
    });
  }

  /* ================================== BOOT ================================== */

  async function signOut() {
    var who = state.user;
    state.user = null;
    if (who) { global.Session.remove("view." + who.id); }
    S.setView("engineers");
    paintViewSwitch();
    paintUnread(0);
    await S.signOut();
    try { global.history.replaceState(null, "", "#/"); } catch (e) { /* ignore */ }
    global.UI.toast(t("pwa.signedOut"));
    gatePickUser("");
  }

  async function boot() {
    global.I18N.setLang("en");
    wireChrome();
    paintOnline();
    var cfg = global.HANDOVER_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseKey) { gateMessage(t("pwa.notConfigured"), false); return; }

    var session = null;
    try { session = await S.currentSession(); } catch (e) { session = null; }
    if (!session) { gatePickUser(""); return; }
    showGate("", '<div class="gate-step"><p>' + esc(t("pwa.loading")) + "</p></div>");
    try {
      var me = await S.loadMe();
      if (!me) { await S.signOut(); gatePickUser(""); return; }
      await afterSignIn(false);
    } catch (e) {
      gateMessage(describeError(e), true);
    }
  }

  global.App = {
    user: function () { return state.user; },
    refreshBadges: refreshBadges,
    adjustUnread: adjustUnread,
    pickUser: function () { signOut(); },
    signOut: signOut,
    isManager: isManager,
    chooseView: function (v) { chooseView(v, false); },
    navigate: navigate,
    route: render,
    reboot: boot,
    needXlsx: needXlsx,
    installHelp: installHelp,
    checkUpdate: checkUpdate
  };

  wireServiceWorker();
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
  else { boot(); }
})(window);
