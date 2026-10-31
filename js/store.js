/* ==========================================================================
   store.js - all data goes through here, to and from Supabase.
   Keeps the same Store API the screens (views.js) already use, so the screens
   work the same as in the shared-folder app. Security is enforced by the
   database (Row Level Security); this file never decides who may see what.
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.HANDOVER_CONFIG;
  /* Without a connection, fail at once instead of waiting for retries. */
  function quickFetch(input, init) {
    if (global.navigator.onLine === false) { return Promise.reject(new TypeError("Failed to fetch (offline)")); }
    return global.fetch(input, init);
  }
  var sb = global.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "ho-auth" },
    global: { fetch: quickFetch },
    db: { retry: false }            // a failed read is shown at once with a Retry button
  });

  var STATUSES = ["draft", "info", "info_followup"];
  var FOLLOWUP = "info_followup";
  var TYPE_EN = { TX: "Transmitter", GA: "Gauge", XV: "On-Off Valve", SW: "Switch", CV: "Control Valve", PCV: "PCV", OT: "Other" };
  var SIGN_IN_ROLES = ["engineer", "manager", "administrator"];

  var me = null;                                  // my staff row (app shape)
  var master = { staff: [], areas: [], tags: [] };
  var currentView = "engineers";
  var logLines = [];

  function log() {
    var line = new Date().toISOString().slice(11, 19) + " " + Array.prototype.join.call(arguments, " ");
    logLines.push(line);
    if (logLines.length > 400) { logLines.shift(); }
    try { console.log("[store]", line); } catch (e) { /* no console */ }
  }

  /* Supabase answers { data, error }; turn an error into an exception with a
     name the screens understand. */
  function must(res, what) {
    if (res && res.error) {
      var e = new Error((what ? what + ": " : "") + (res.error.message || "request failed"));
      e.name = res.error.code === "42501" || /row-level security|not allowed|administrators only/i.test(res.error.message || "")
        ? "PermissionError" : (res.error.name || "RequestError");
      e.code = res.error.code;
      log("error", e.message);
      throw e;
    }
    return res ? res.data : null;
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) { return global.crypto.randomUUID(); }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function chunks(list, n) {
    var out = [];
    for (var i = 0; i < list.length; i += n) { out.push(list.slice(i, i + n)); }
    return out;
  }

  /* ---------------------------------------------------------------- small cache (IndexedDB) */

  var idb = (function () {
    var dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise(function (resolve, reject) {
          var req = global.indexedDB.open("plant-handover", 1);
          req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }
      return dbp;
    }
    function op(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction("kv", mode);
          var req = fn(tx.objectStore("kv"));
          tx.oncomplete = function () { resolve(req ? req.result : undefined); };
          tx.onerror = tx.onabort = function () { resolve(undefined); };
        });
      }).catch(function () { return undefined; });
    }
    return {
      get: function (k) { return op("readonly", function (s) { return s.get(k); }); },
      set: function (k, v) { return op("readwrite", function (s) { s.put(v, k); return null; }); },
      clear: function () { return op("readwrite", function (s) { s.clear(); return null; }); }
    };
  })();

  /* ---------------------------------------------------------------- shapes */

  function normalizeStatus(o) {
    if (!o) { return "info"; }
    if (STATUSES.indexOf(o.status) >= 0) { return o.status; }
    if (o.archived || o.legacyStatus) {
      return /fol+o?w?\s*-?\s*up|folloup|follwup|long-term/i.test(String(o.legacyStatus || "")) ? FOLLOWUP : "info";
    }
    return "info";
  }

  function staffOut(r) {
    return {
      id: r.id, employeeId: r.employee_id || "", name: r.name, jobTitle: r.job_title || "",
      department: r.department || "", role: r.role || "", active: r.active !== false,
      isAdmin: !!r.is_admin, password: r.auth_user_id ? true : null, hasAccount: !!r.auth_user_id,
      passwordSetAt: r.password_set_at || null, readAllAt: r.read_all_at || null
    };
  }

  function tagOut(r) {
    return {
      tagNo: r.tag_no, type: r.type || "OT", upper: r.upper_equipment || "", lrv: r.lrv || "", urv: r.urv || "",
      unit_: r.unit || "", valveSize: r.valve_size || "", descEn: r.description || "", area: r.area || "",
      active: r.active !== false
    };
  }
  function tagIn(t) {
    return {
      tag_no: String(t.tagNo || "").toUpperCase().trim(), type: t.type || "OT", upper_equipment: t.upper || "",
      lrv: t.lrv == null ? "" : String(t.lrv), urv: t.urv == null ? "" : String(t.urv), unit: t.unit_ || t.unit || "",
      valve_size: t.valveSize == null ? "" : String(t.valveSize), description: t.descEn || "", area: t.area || "",
      active: t.active !== false, updated_at: new Date().toISOString()
    };
  }

  var HEADER_COLS = "id,legacy_id,db,title,snippet,status,area,location,tags,team_ids,due_date,created_by,created_by_name," +
    "created_by_original,created_at,updated_at,changed_at,archived,legacy_status,date_unknown,imported_from,source," +
    "comment_count,attachment_count,open_actions,deleted_at,deleted_by_name";

  function headerOut(r) {
    var h = {
      id: r.id, legacyId: r.legacy_id || undefined, db: r.db, title: r.title || "", snippet: r.snippet || "",
      area: r.area || "", location: r.location || "", tags: r.tags || [], teamIds: r.team_ids || [],
      restricted: r.db === "managers" ? "managers" : undefined,
      importedFrom: r.imported_from === "excel" ? "excel" : undefined,
      createdBy: { id: r.created_by || null, name: r.created_by_name || "", original: r.created_by_original || undefined },
      createdAt: r.created_at || null, updatedAt: r.updated_at || r.created_at || null, dueDate: r.due_date || null,
      commentCount: r.comment_count || 0, attachmentCount: r.attachment_count || 0,
      openActions: r.open_actions || undefined,
      archived: r.archived ? true : undefined, fromArchive: !!r.archived, legacyStatus: r.legacy_status || undefined,
      dateUnknown: r.date_unknown ? true : undefined, source: r.source || undefined,
      deletedAt: r.deleted_at || null, deletedByName: r.deleted_by_name || null, status: r.status
    };
    h.status = normalizeStatus(h);
    return h;
  }

  function personRef(id, name) { return { id: id || null, name: name || "" }; }

  function recordOut(r, actions, comments, attachments) {
    var rec = headerOut(r);
    rec.description = r.description || "";
    rec.kind = r.kind || undefined;
    rec.team = r.team || [];
    rec.history = r.history || [];
    rec.version = r.version || 1;
    rec.importedAt = r.imported_at || undefined;
    rec.importedBy = r.imported_by ? { id: r.imported_by, name: (userById(r.imported_by) || {}).name || "" } : undefined;
    rec.actions = (actions || []).map(function (a) {
      return {
        id: a.id, text: a.text, status: a.status, by: personRef(a.by_id, a.by_name), at: a.at,
        doneBy: a.done_by_id || a.done_by_name ? personRef(a.done_by_id, a.done_by_name) : undefined,
        doneAt: a.done_at || undefined, doneComment: a.done_comment || undefined
      };
    });
    rec.comments = (comments || []).map(function (c) {
      return { id: c.id, text: c.text, at: c.at, by: personRef(c.by_id, c.by_name), actionId: c.action_id || undefined };
    });
    rec.attachments = (attachments || []).map(function (a) {
      return { id: a.id, name: a.name, size: a.size, mime: a.mime, stored: a.path, at: a.at, by: personRef(a.by_id, a.by_name) };
    });
    return rec;
  }

  function rowIn(rec) {
    return {
      id: rec.id, db: rec.restricted === "managers" ? "managers" : "engineers",
      title: rec.title || "", description: rec.description || "", status: rec.status || "info", kind: rec.kind || null,
      area: rec.area || "", location: rec.location || "", tags: rec.tags || [], team: rec.team || [],
      due_date: rec.dueDate ? String(rec.dueDate).slice(0, 10) : null,
      created_by: rec.createdBy && rec.createdBy.id ? rec.createdBy.id : null,
      created_by_name: rec.createdBy ? rec.createdBy.name || "" : "",
      created_at: rec.createdAt || new Date().toISOString(),
      updated_at: rec.updatedAt || rec.createdAt || new Date().toISOString(),
      history: rec.history || [],
      imported_from: rec.importedFrom || null, imported_at: rec.importedAt || null,
      imported_by: rec.importedBy && rec.importedBy.id ? rec.importedBy.id : null
    };
  }

  function actionIn(handoverId, a) {
    return {
      id: a.id && /^[0-9a-f-]{36}$/i.test(a.id) ? a.id : uuid(), handover_id: handoverId, text: a.text,
      status: a.status || "open", by_id: a.by && a.by.id ? a.by.id : null, by_name: a.by ? a.by.name || "" : "",
      at: a.at || new Date().toISOString()
    };
  }

  /* ---------------------------------------------------------------- sign-in */

  function loginEmail(staffId) { return "staff-" + String(staffId).toLowerCase() + "@" + CFG.loginDomain; }

  async function roster() {
    return must(await sb.rpc("sign_in_roster"), "roster") || [];
  }

  async function signIn(staffId, password) {
    var res = await sb.auth.signInWithPassword({ email: loginEmail(staffId), password: password });
    if (res.error) {
      var e = new Error(res.error.message || "sign-in failed");
      e.name = /invalid login|invalid credentials/i.test(res.error.message || "") ? "WrongPassword" : "AuthError";
      throw e;
    }
    return loadMe();
  }

  /* First time: make the login, then claim the roster entry with it. */
  async function createAccount(staffId, password) {
    var res = await sb.auth.signUp({ email: loginEmail(staffId), password: password });
    if (res.error) {
      var e = new Error(res.error.message || "could not create the account");
      e.name = /already registered|already exists/i.test(res.error.message || "") ? "AccountExists" : "AuthError";
      throw e;
    }
    if (!res.data || !res.data.session) {
      var c = new Error("Supabase asks to confirm the e-mail address. Switch off \"Confirm email\" in Authentication settings.");
      c.name = "ConfirmEmailOn";
      throw c;
    }
    must(await sb.rpc("claim_account", { p_staff: staffId }), "claim");
    return loadMe();
  }

  function isNetworkError(e) {
    return !global.navigator.onLine || /failed to fetch|network|load failed|fetch failed|timed? ?out/i.test((e && e.message) || "");
  }

  /* Who am I. Without a connection the last known answer is used, so the
     app still opens on a phone with no signal (read-only, saved data). */
  async function loadMe() {
    var row;
    try {
      if (!global.navigator.onLine) { throw new Error("offline: network"); }
      row = must(await sb.rpc("me"), "me");
    } catch (e) {
      if (isNetworkError(e)) {
        var saved = await idb.get("me");
        var sess = await currentSession();
        if (saved && sess && sess.user && saved.authId === sess.user.id) { me = saved.me; offline = true; return me; }
      }
      throw e;
    }
    if (Array.isArray(row)) { row = row[0]; }
    me = row && row.id ? staffOut(row) : null;
    offline = false;
    if (me) { var s2 = await currentSession(); idb.set("me", { me: me, authId: s2 && s2.user ? s2.user.id : null }); }
    return me;
  }
  var offline = false;

  async function currentSession() {
    var res = await sb.auth.getSession();
    return res && res.data ? res.data.session : null;
  }

  async function signOut() {
    me = null;
    cache.map = null; cache.since = null; cache.sorted = null;
    idb.set("me", null);
    try { await sb.auth.signOut(); } catch (e) { /* offline */ }
  }

  async function changePassword(oldPw, newPw) {
    if (!me) { throw new Error("not signed in"); }
    var check = await sb.auth.signInWithPassword({ email: loginEmail(me.id), password: oldPw });
    if (check.error) { var e = new Error("wrong password"); e.name = "WrongPassword"; throw e; }
    must(await sb.auth.updateUser({ password: newPw }), "password");
  }

  /* ---------------------------------------------------------------- master lists */

  /* Every row, 1000 at a time. A second sort column keeps the pages stable
     when many rows share the same value (e.g. tags saved in one go). */
  async function fetchAll(table, cols, orderCol, filter) {
    var out = [], from = 0, page = 1000;
    var tie = table === "equipment_tags" ? "tag_no" : "id";
    for (;;) {
      var q = sb.from(table).select(cols || "*").order(orderCol, { ascending: true });
      if (orderCol !== tie) { q = q.order(tie, { ascending: true }); }
      q = q.range(from, from + page - 1);
      if (filter) { q = filter(q); }
      var rows = must(await q, table) || [];
      out = out.concat(rows);
      if (rows.length < page) { break; }
      from += page;
    }
    return out;
  }

  async function loadMaster() {
    var results;
    try {
      if (!global.navigator.onLine) { throw new Error("offline: network"); }
      results = await Promise.all([
        fetchAll("staff", "*", "name"),
        fetchAll("areas", "*", "sort")
      ]);
      idb.set("master", { staff: results[0], areas: results[1] });
    } catch (e) {
      var saved = isNetworkError(e) ? await idb.get("master") : null;
      if (!saved) { throw e; }
      results = [saved.staff, saved.areas];
    }
    master.staff = results[0].map(staffOut);
    master.areas = results[1];
    try { await loadTags(); }
    catch (e2) {
      var st = await idb.get("tags2");
      if (!st || !isNetworkError(e2)) { throw e2; }
      master.tags = (st.list || []).map(tagOut).filter(function (t) { return t.active !== false; });
    }
    if (me) { me = userById(me.id) || me; }
  }

  async function loadTags(full) {
    var saved = full ? null : await idb.get("tags2");
    var since = saved && saved.since;
    var map = {};
    if (saved && saved.list) { saved.list.forEach(function (t) { map[t.tag_no] = t; }); }
    var rows = await fetchAll("equipment_tags", "*", "updated_at", since ? function (q) { return q.gt("updated_at", since); } : null);
    rows.forEach(function (t) { map[t.tag_no] = t; if (!since || t.updated_at > since) { since = t.updated_at; } });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    master.allTags = list.map(tagOut);
    master.tags = master.allTags.filter(function (t) { return t.active !== false; });
    idb.set("tags2", { list: list, since: since });
  }

  function users() { return master.staff; }
  function userById(id) {
    for (var i = 0; i < master.staff.length; i++) { if (master.staff[i].id === id) { return master.staff[i]; } }
    return null;
  }
  function canSignIn(u) { return !!u && u.active !== false && (SIGN_IN_ROLES.indexOf(u.role || "") >= 0 || u.isAdmin); }
  function tags() { return master.tags; }
  function allTags() { return master.allTags || master.tags; }
  function tagByNumber(no) {
    var n = String(no || "").toUpperCase();
    for (var i = 0; i < master.tags.length; i++) { if (master.tags[i].tagNo === n) { return master.tags[i]; } }
    return null;
  }
  function upperEquipmentList() {
    var seen = {};
    master.tags.forEach(function (t) { if (t.upper) { seen[t.upper] = true; } });
    return Object.keys(seen).sort();
  }
  function structure() {
    return {
      areas: master.areas.map(function (a) { return { id: a.id, en: a.name || a.id }; }),
      equipmentTypes: Object.keys(TYPE_EN).map(function (k) { return { id: k, en: TYPE_EN[k] }; }),
      shifts: [{ id: "day", en: "Day shift" }, { id: "night", en: "Night shift" }],
      units: []
    };
  }

  async function addArea(code, name) {
    var id = String(code || "").trim().toUpperCase();
    if (!id) { return false; }
    must(await sb.from("areas").upsert({ id: id, name: name || id, sort: master.areas.length }, { onConflict: "id", ignoreDuplicates: true }), "area");
    master.areas = await fetchAll("areas", "*", "sort");
    return true;
  }
  async function addAreas(list) {
    var have = {};
    master.areas.forEach(function (a) { have[a.id.toLowerCase()] = true; });
    var fresh = (list || []).filter(function (a) { return a && a.id && !have[String(a.id).toLowerCase()]; });
    if (!fresh.length) { return 0; }
    must(await sb.from("areas").upsert(fresh.map(function (a, i) {
      return { id: String(a.id).toUpperCase(), name: a.en || a.id, sort: master.areas.length + i };
    }), { onConflict: "id", ignoreDuplicates: true }), "areas");
    master.areas = await fetchAll("areas", "*", "sort");
    return fresh.length;
  }
  async function removeArea(id) {
    must(await sb.from("areas").delete().eq("id", id), "area");
    master.areas = master.areas.filter(function (a) { return a.id !== id; });
  }

  async function importTags(rows) {
    var have = {};
    master.tags.forEach(function (t) { have[t.tagNo] = true; });
    var list = (rows || []).map(tagIn).filter(function (t) { return t.tag_no; });
    var added = 0, updated = 0;
    list.forEach(function (t) { if (have[t.tag_no]) { updated++; } else { added++; } });
    var parts = chunks(list, 500);
    for (var i = 0; i < parts.length; i++) {
      must(await sb.from("equipment_tags").upsert(parts[i], { onConflict: "tag_no" }), "tags");
    }
    await loadTags();
    return { added: added, updated: updated };
  }
  async function upsertTag(t) {
    must(await sb.from("equipment_tags").upsert(tagIn(t), { onConflict: "tag_no" }), "tag");
    await loadTags();
    return tagByNumber(t.tagNo);
  }
  async function bulkSetArea(tagNos, area) {
    var parts = chunks(tagNos || [], 200);
    for (var i = 0; i < parts.length; i++) {
      must(await sb.from("equipment_tags").update({ area: area || "", updated_at: new Date().toISOString() }).in("tag_no", parts[i]), "tags");
    }
    await loadTags();
  }

  /* ---------------------------------------------------------------- staff (administration) */

  async function upsertUser(u) {
    var row = {
      employee_id: u.employeeId || null, name: u.name, job_title: u.jobTitle || "", department: u.department || "",
      role: u.role || "technician", active: u.active !== false, is_admin: !!u.isAdmin
    };
    if (u.id && userById(u.id)) { must(await sb.from("staff").update(row).eq("id", u.id), "staff"); }
    else { must(await sb.from("staff").insert(row), "staff"); }
    master.staff = (await fetchAll("staff", "*", "name")).map(staffOut);
  }
  async function setUserActive(id, active) {
    must(await sb.from("staff").update({ active: !!active }).eq("id", id), "staff");
    master.staff = (await fetchAll("staff", "*", "name")).map(staffOut);
  }
  async function loadStandardStaff() {
    var rows = (global.SEED_STAFF || []).map(function (p) {
      return { employee_id: p.employeeId, name: p.name, job_title: p.jobTitle || "", department: p.department || "",
               role: p.role || "technician", active: p.active !== false };
    });
    must(await sb.from("staff").upsert(rows, { onConflict: "employee_id", ignoreDuplicates: true }), "staff");
    master.staff = (await fetchAll("staff", "*", "name")).map(staffOut);
  }
  async function clearUserPassword(id) {
    must(await sb.rpc("admin_reset_login", { p_staff: id }), "reset");
    master.staff = (await fetchAll("staff", "*", "name")).map(staffOut);
  }

  /* ---------------------------------------------------------------- views (managers) */

  function isAdmin() { return !!(me && me.isAdmin); }

  function viewerIsManager() { return !!(me && me.role === "manager"); }
  function setView(v) { currentView = v === "managers" ? "managers" : "engineers"; cache.sorted = null; }
  function getView() { return viewerIsManager() ? currentView : "engineers"; }
  function inScope(h) {
    if (!h) { return true; }
    return getView() === "managers" ? (h.restricted === "managers" || h.db === "managers") : !(h.restricted === "managers" || h.db === "managers");
  }
  function canView(h) { return !h || !h.restricted || viewerIsManager(); }

  /* ---------------------------------------------------------------- handover list (synced) */

  var cache = { map: null, since: null, at: 0, sorted: null, key: "" };

  function byNewest(a, b) {
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  }

  async function syncHeaders(force) {
    if (!me) { return; }
    var key = "hdr:" + me.id + ":" + me.role;
    if (cache.key !== key) { cache = { map: null, since: null, at: 0, sorted: null, key: key }; }
    if (!cache.map) {
      var saved = await idb.get(key);
      cache.map = saved && saved.map ? saved.map : {};
      cache.since = saved ? saved.since : null;
      cache.reset = saved ? saved.reset || "" : "";
      cache.tsince = saved ? saved.tsince || null : null;
      // a list saved by an older version has no deletion cursor: start afresh
      if (cache.since && !cache.tsince) { cache.map = {}; cache.since = null; }
    }
    if (!force && Date.now() - cache.at < 15000) { return; }
    if (!global.navigator.onLine && Object.keys(cache.map).length) { return; }
    // An administrator removed a set of entries (e.g. old sheets): start the list afresh.
    try {
      var rs = must(await sb.from("settings").select("value").eq("key", "list_reset").maybeSingle(), "settings");
      var mark = rs && rs.value ? String(rs.value.at || "") : "";
      if (mark !== (cache.reset || "")) { cache.map = {}; cache.since = null; cache.sorted = null; cache.reset = mark; }
    } catch (e) { /* keep the saved list */ }
    var since = cache.since, from = 0, page = 1000, latest = since, changed = 0;
    // Starting from nothing: deletions so far do not matter, only those from now on.
    if (!since) {
      try {
        var last = must(await sb.from("handover_tombstones").select("at").order("at", { ascending: false }).limit(1), "tombstones") || [];
        cache.tsince = last.length ? last[0].at : "1970-01-01T00:00:00Z";
      } catch (e) { cache.tsince = cache.tsince || "1970-01-01T00:00:00Z"; }
    }
    for (;;) {
      var q = sb.from("handovers").select(HEADER_COLS).order("changed_at", { ascending: true }).order("id", { ascending: true })
        .range(from, from + page - 1);
      if (since) { q = q.gt("changed_at", since); }
      var rows;
      try { rows = must(await q, "handovers") || []; }
      catch (e) { if (Object.keys(cache.map).length) { log("sync failed, using saved list"); break; } throw e; }
      rows.forEach(function (r) { cache.map[r.id] = headerOut(r); if (!latest || r.changed_at > latest) { latest = r.changed_at; } });
      changed += rows.length;
      if (rows.length < page) { break; }
      from += page;
    }
    // Handovers deleted for good since last time: drop them from the saved
    // list, so they no longer appear in lists, counts or search on this phone.
    var gone = 0;
    if (since && cache.tsince) {
      var tfrom = 0, tl = cache.tsince;
      for (;;) {
        var trows;
        try {
          trows = must(await sb.from("handover_tombstones").select("id,at").gt("at", cache.tsince)
            .order("at", { ascending: true }).range(tfrom, tfrom + 999), "tombstones") || [];
        } catch (e) { break; }
        trows.forEach(function (r) { if (cache.map[r.id]) { delete cache.map[r.id]; gone++; } if (r.at > tl) { tl = r.at; } });
        if (trows.length < 1000) { break; }
        tfrom += 1000;
      }
      if (tl !== cache.tsince) { cache.tsince = tl; gone = gone || -1; }
    }
    cache.at = Date.now();
    if (changed || gone || !since) {
      cache.since = latest;
      cache.sorted = null;
      idb.set(key, { map: cache.map, since: cache.since, reset: cache.reset || "", tsince: cache.tsince || null });
    }
  }

  function allSorted() {
    if (!cache.sorted) {
      cache.sorted = Object.keys(cache.map || {}).map(function (k) { return cache.map[k]; })
        .filter(function (h) { return !h.deletedAt; }).sort(byNewest);
    }
    return cache.sorted;
  }

  async function listHandovers(force) {
    await syncHeaders(!!force);
    return allSorted().filter(inScope);
  }
  async function allHeaders() {
    await syncHeaders(true);
    return allSorted().slice();
  }
  function invalidate() { cache.at = 0; }

  function searchText(h) {
    if (h._hay) { return h._hay; }
    var who = h.createdBy ? [h.createdBy.name, h.createdBy.original].join(" ") : "";
    h._hay = global.Util.normalize([h.title, h.snippet, (h.tags || []).join(" "), who, h.location, h.legacyStatus].join(" "));
    return h._hay;
  }

  /* Server search over full descriptions (old entries included). */
  async function searchIds(q) {
    var ids = must(await sb.rpc("search_handovers", { q: q, lim: 300 }), "search") || [];
    return ids.map(function (x) { return typeof x === "string" ? x : (x.search_handovers || x.id); });
  }

  /* Comments are searched on the server; only handovers in the current view. */
  async function searchComments(q) {
    var pat = "%" + String(q || "").replace(/[%_\\]/g, "\\$&") + "%";
    var rows = must(await sb.from("handover_comments").select("handover_id,text,by_id,by_name,at")
      .ilike("text", pat).order("at", { ascending: false }).limit(60), "search") || [];
    await syncHeaders(false);
    return rows.map(function (r) {
      var h = cache.map && cache.map[r.handover_id];
      if (!h || h.deletedAt || !inScope(h)) { return null; }
      return { handoverId: r.handover_id, title: h.title, text: r.text || "", by: personRef(r.by_id, r.by_name), at: r.at };
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------------- one handover */

  async function getHandover(id) {
    var res = await Promise.all([
      sb.from("handovers").select("*").eq("id", id).maybeSingle(),
      sb.from("handover_actions").select("*").eq("handover_id", id).order("at", { ascending: true }),
      sb.from("handover_comments").select("*").eq("handover_id", id).order("at", { ascending: true }),
      sb.from("handover_attachments").select("*").eq("handover_id", id).order("at", { ascending: true })
    ]);
    var row = must(res[0], "handover");
    if (!row || row.deleted_at) { return null; }
    return recordOut(row, must(res[1]), must(res[2]), must(res[3]));
  }

  async function getHandovers(ids) {
    var out = [];
    var parts = chunks(ids, 150);
    for (var i = 0; i < parts.length; i++) {
      var res = await Promise.all([
        sb.from("handovers").select("*").in("id", parts[i]),
        sb.from("handover_actions").select("*").in("handover_id", parts[i]),
        sb.from("handover_comments").select("*").in("handover_id", parts[i]),
        sb.from("handover_attachments").select("id,handover_id,name,size,mime,path,by_id,by_name,at").in("handover_id", parts[i])
      ]);
      var rows = must(res[0]) || [], acts = must(res[1]) || [], coms = must(res[2]) || [], atts = must(res[3]) || [];
      rows.forEach(function (r) {
        out.push(recordOut(r,
          acts.filter(function (a) { return a.handover_id === r.id; }),
          coms.filter(function (c) { return c.handover_id === r.id; }),
          atts.filter(function (a) { return a.handover_id === r.id; })));
      });
    }
    return out;
  }

  async function saveHandover(rec) {
    var row = rowIn(rec);
    row.version = 1;
    must(await sb.from("handovers").insert(row), "save");
    if ((rec.actions || []).length) {
      must(await sb.from("handover_actions").insert(rec.actions.map(function (a) { return actionIn(rec.id, a); })), "actions");
    }
    invalidate();
    return rec;
  }

  /* Saves an edit only if nobody else saved in between (version check). */
  async function saveHandoverChecked(rec, expected) {
    var row = rowIn(rec);
    delete row.id; delete row.created_by; delete row.created_by_name; delete row.created_at; delete row.db;
    delete row.imported_from; delete row.imported_at; delete row.imported_by;
    row.updated_at = new Date().toISOString();
    row.version = (expected || 0) + 1;
    var done = must(await sb.from("handovers").update(row).eq("id", rec.id).eq("version", expected || 0).select("id"), "save");
    if (!done || !done.length) { var c = new Error("changed by someone else"); c.name = "ConflictError"; throw c; }
    rec.version = row.version;
    // actions required: add new ones, reword open ones, remove deleted open ones
    var existing = must(await sb.from("handover_actions").select("*").eq("handover_id", rec.id)) || [];
    var keep = {};
    var adds = [];
    for (var i = 0; i < (rec.actions || []).length; i++) {
      var a = rec.actions[i];
      var old = existing.filter(function (x) { return x.id === a.id; })[0];
      if (!old) { adds.push(actionIn(rec.id, a)); continue; }
      keep[old.id] = true;
      if (old.status === "open" && old.text !== a.text) {
        must(await sb.from("handover_actions").update({ text: a.text }).eq("id", old.id), "action");
      }
    }
    if (adds.length) { must(await sb.from("handover_actions").insert(adds), "actions"); }
    var gone = existing.filter(function (x) { return !keep[x.id] && x.status === "open"; }).map(function (x) { return x.id; });
    if (gone.length) { must(await sb.from("handover_actions").delete().in("id", gone), "actions"); }
    invalidate();
    return rec;
  }

  async function updateWithRetry(id, fn) {
    for (var i = 0; i < 5; i++) {
      var row = must(await sb.from("handovers").select("id,version,history,status").eq("id", id).maybeSingle(), "handover");
      if (!row) { var nf = new Error("not-found"); nf.name = "NotFoundError"; throw nf; }
      var patch = fn(row);
      patch.version = row.version + 1;
      var done = must(await sb.from("handovers").update(patch).eq("id", id).eq("version", row.version).select("id"), "save");
      if (done && done.length) { invalidate(); return getHandover(id); }
    }
    var c = new Error("changed by someone else"); c.name = "ConflictError"; throw c;
  }

  function setStatus(id, status, byName, byId) {
    return updateWithRetry(id, function (row) {
      var now = new Date().toISOString();
      return { status: status, updated_at: now, history: (row.history || []).concat([{ status: status, by: byName, byId: byId, at: now }]) };
    });
  }

  async function deleteHandover(id, by) {
    var done = must(await sb.from("handovers").update({
      deleted_at: new Date().toISOString(), deleted_by: by && by.id ? by.id : null, deleted_by_name: by ? by.name || "" : ""
    }).eq("id", id).select("id"), "delete");
    if (!done || !done.length) { var e = new Error("not-found"); e.name = "NotFoundError"; throw e; }
    invalidate();
  }
  async function restoreHandover(id) {
    if (isAdmin()) { must(await sb.rpc("admin_restore_handovers", { p_ids: [id] }), "restore"); }
    else { must(await sb.from("handovers").update({ deleted_at: null, deleted_by: null, deleted_by_name: null }).eq("id", id), "restore"); }
    invalidate();
    var rec = null;
    try { rec = await getHandover(id); } catch (e) { rec = null; }
    return rec || { id: id, title: "" };
  }
  async function restoreAll() {
    var n = Number(must(await sb.rpc("admin_restore_handovers", { p_ids: null }), "restore")) || 0;
    invalidate();
    return n;
  }
  async function listDeleted() {
    var rows = isAdmin()
      ? must(await sb.rpc("admin_deleted_list", { p_limit: 500 }), "deleted") || []
      : must(await sb.from("handovers").select(HEADER_COLS + ",deleted_by").not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }).limit(200), "deleted") || [];
    return rows.map(function (r) {
      var h = headerOut(r);
      h.deletedBy = { id: r.deleted_by || null, name: r.deleted_by_name || "" };
      return h;
    });
  }

  /* ---------------------------------------------------------------- administrator: delete by filter */

  function cleanFilter(f) {
    var out = {};
    Object.keys(f || {}).forEach(function (k) { if (f[k] !== "" && f[k] !== null && f[k] !== undefined) { out[k] = f[k]; } });
    return out;
  }
  async function adminCount(filter) {
    return must(await sb.rpc("admin_count_handovers", { p: cleanFilter(filter) }), "count") || {};
  }
  /* mode "recoverable" (to Deleted handovers) or "permanent". Runs in batches
     until nothing matches; removes attachment files of permanently deleted ones. */
  async function adminDelete(filter, mode, onProgress) {
    var total = 0, files = 0, failedFiles = 0;
    for (;;) {
      var r = must(await sb.rpc("admin_delete_handovers", { p: cleanFilter(filter), p_mode: mode, p_limit: 1000 }), "delete") || {};
      var n = Number(r.n) || 0;
      total += n;
      var paths = r.paths || [];
      for (var i = 0; i < paths.length; i += 100) {
        var part = paths.slice(i, i + 100);
        var res = await sb.storage.from("attachments").remove(part);
        if (res.error) { failedFiles += part.length; } else { files += part.length; }
      }
      if (onProgress) { onProgress(total); }
      if (n === 0) { break; }
    }
    invalidate();
    await syncHeaders(true);
    return { count: total, files: files, failedFiles: failedFiles };
  }

  /* ---------------------------------------------------------------- administrator: export */

  async function exportRecords(onProgress) {
    var out = [], after = null;
    for (;;) {
      var page = must(await sb.rpc("admin_export_page", { p_after: after, p_limit: 500 }), "export") || [];
      out = out.concat(page);
      if (onProgress) { onProgress(out.length); }
      if (page.length < 500) { break; }
      after = page[page.length - 1].h.id;
    }
    return out;
  }
  async function downloadFile(path) {
    return must(await sb.storage.from("attachments").download(path), "download");
  }

  async function appendComment(id, comment) {
    must(await sb.rpc("add_comment", { p_handover: id, p_text: comment.text, p_action: comment.actionId || null }), "comment");
    invalidate();
    return getHandover(id);
  }

  async function addAction(id, action) {
    must(await sb.from("handover_actions").insert(actionIn(id, action)), "action");
    invalidate();
    return getHandover(id);
  }

  /* ---------------------------------------------------------------- attachments (Storage) */

  function safeName(n) { return String(n || "file").replace(/[^\w.\-]+/g, "_").slice(-80); }

  /* Phone photos are shrunk before upload (free plan: 1 GB in total). */
  function shrinkImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "") || file.size < 700 * 1024) { resolve(file); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = CFG.photoMaxSide || 1600;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          var name = String(file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
          try { resolve(new File([blob], name, { type: "image/jpeg" })); } catch (e) { blob.name = name; resolve(blob); }
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function putAttachment(handoverId, file) {
    var f = await shrinkImage(file);
    var id = uuid();
    var path = handoverId + "/" + id + "-" + safeName(f.name || file.name);
    must(await sb.storage.from("attachments").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false }), "upload");
    return { id: id, name: f.name || file.name, size: f.size, mime: f.type || "", stored: path, at: new Date().toISOString() };
  }

  async function appendAttachments(id, list) {
    must(await sb.from("handover_attachments").insert(list.map(function (a) {
      return { id: a.id, handover_id: id, name: a.name, size: a.size || 0, mime: a.mime || "", path: a.stored,
               by_id: a.by && a.by.id ? a.by.id : (me ? me.id : null), by_name: a.by ? a.by.name : (me ? me.name : ""), at: a.at };
    })), "attachments");
    invalidate();
    return getHandover(id);
  }

  async function getAttachmentFile(handoverId, stored) {
    var blob = must(await sb.storage.from("attachments").download(stored), "download");
    var name = String(stored).split("/").pop().replace(/^[0-9a-f-]{36}-/, "");
    try { return new File([blob], name, { type: blob.type }); } catch (e) { blob.name = name; return blob; }
  }

  /* ---------------------------------------------------------------- notifications */

  var reads = { ids: {}, readAllAt: null, at: 0 };

  function notifOut(n) {
    return {
      id: n.id, type: n.type, actor: personRef(n.actor_id, n.actor_name), handoverId: n.handover_id || "",
      title: n.title || "", text: n.text || undefined, status: n.status || undefined, count: n.count || undefined,
      at: n.at, db: n.db, restricted: n.db === "managers" ? "managers" : undefined
    };
  }

  async function addNotification(n) {
    var row = {
      type: n.type, actor_id: n.actor && n.actor.id ? n.actor.id : (me ? me.id : null),
      actor_name: n.actor ? n.actor.name || "" : (me ? me.name : ""),
      handover_id: n.handoverId || null, title: n.title || "", text: n.text || null, status: n.status || null,
      count: n.count || null, db: n.restricted === "managers" ? "managers" : "engineers"
    };
    must(await sb.from("notifications").insert(row), "notification");
    return n;
  }

  async function loadReads() {
    if (!me) { return reads; }
    var rows = must(await sb.from("notification_reads").select("notification_id").eq("staff_id", me.id).limit(2000), "reads") || [];
    var mine = must(await sb.from("staff").select("read_all_at").eq("id", me.id).maybeSingle(), "me") || {};
    var ids = {};
    rows.forEach(function (r) { ids[r.notification_id] = true; });
    reads = { ids: ids, readAllAt: mine.read_all_at || null, at: Date.now() };
    return reads;
  }

  async function listNotifications(limit, everything) {
    if (!global.navigator.onLine) { throw new Error("offline: network"); }
    var rows = must(await sb.from("notifications").select("*").order("at", { ascending: false }).limit(limit || 300), "notifications") || [];
    if (Date.now() - reads.at > 20000) { try { await loadReads(); } catch (e) { /* keep old */ } }
    return rows.map(notifOut).filter(function (n) { return everything ? true : inScope(n); });
  }

  function isUnread(n) {
    if (!n || !me) { return false; }
    if (n.actor && n.actor.id === me.id) { return false; }
    if (reads.readAllAt && String(n.at) <= String(reads.readAllAt)) { return false; }
    return !reads.ids[n.id];
  }
  function markRead(n) {
    if (!n || !n.id || !me || reads.ids[n.id]) { return; }
    reads.ids[n.id] = true;
    sb.from("notification_reads").upsert({ staff_id: me.id, notification_id: n.id }, { onConflict: "staff_id,notification_id", ignoreDuplicates: true })
      .then(function (r) { if (r.error) { log("mark read failed", r.error.message); } });
  }
  async function markAllRead() {
    reads.readAllAt = new Date().toISOString();
    reads.ids = {};
    must(await sb.rpc("mark_all_read"), "read");
  }

  /* ---------------------------------------------------------------- imports */

  async function addHandovers(list, onProgress) {
    var parts = chunks(list, 200), done = 0;
    for (var i = 0; i < parts.length; i++) {
      must(await sb.from("handovers").insert(parts[i].map(function (rec) { var r = rowIn(rec); r.version = 1; return r; })), "import");
      var acts = [];
      parts[i].forEach(function (rec) { (rec.actions || []).forEach(function (a) { acts.push(actionIn(rec.id, a)); }); });
      if (acts.length) { must(await sb.from("handover_actions").insert(acts), "actions"); }
      done += parts[i].length;
      if (onProgress) { onProgress(done, list.length); }
    }
    invalidate();
    return list.length;
  }

  var archiveStats = {};
  /* Administrator: remove every old-sheet entry of one database (in batches). */
  async function clearArchive(db, onProgress) {
    var total = 0;
    for (;;) {
      var n = Number(must(await sb.rpc("admin_clear_archive", { p_db: db === "managers" ? "managers" : "engineers", p_limit: 1500 }), "clear")) || 0;
      total += n;
      if (onProgress) { onProgress(total); }
      if (n === 0) { break; }
    }
    cache.map = {}; cache.since = null; cache.sorted = null; cache.at = 0;
    await loadArchive();
    return total;
  }

  async function loadArchive() {
    var rows = [];
    try { rows = must(await sb.rpc("archive_info"), "archive") || []; } catch (e) { rows = []; }
    archiveStats = {};
    rows.forEach(function (r) { archiveStats[r.db] = { count: Number(r.count) || 0, importedAt: r.last_import, by: "", sources: [] }; });
    return archiveStats;
  }
  function archiveInfo(db) { return archiveStats[db || "engineers"] || null; }
  function archivedRecord() { return null; }
  function audienceOfId(id) { return /^arcm-/.test(String(id || "")) ? "managers" : "engineers"; }
  function isArchiveId(id) { return /^arcm?-/.test(String(id || "")); }

  /* The old-sheet bundle (made by the import page) -> import_archive() in batches. */
  async function importArchive(bundle, byName, onProgress, audience) {
    audience = audience === "managers" ? "managers" : "engineers";
    if (!bundle || bundle.kind !== "plant-handover-archive" || !Array.isArray(bundle.records)) {
      var bad = new Error("not-archive"); bad.name = "FormatError"; throw bad;
    }
    if ((bundle.audience || "engineers") !== audience) {
      var wrong = new Error("archive for " + (bundle.audience || "engineers")); wrong.name = "AudienceError";
      wrong.audience = bundle.audience || "engineers"; throw wrong;
    }
    var recs = bundle.records.map(function (r) {
      var person = r.createdBy || {};
      return {
        legacy_id: r.id, title: r.title || "", description: r.description || "",
        status: normalizeStatus({ status: r.status, archived: true, legacyStatus: r.legacyStatus }),
        area: r.area || "", location: r.location || "", tags: r.tags || [], team: r.team || [],
        created_by: person.id || null, created_by_name: person.name || "", created_by_original: person.original || null,
        created_at: r.createdAt || null, legacy_status: r.legacyStatus || null, date_unknown: !r.createdAt,
        source: r.source || null,
        actions: (r.actions || []).map(function (a) {
          return { legacy_id: a.id, text: a.text, status: a.status || "old", by_id: a.by && a.by.id, by_name: a.by ? a.by.name : "",
                   at: a.at || null, done_by_id: a.doneBy && a.doneBy.id, done_by_name: a.doneBy ? a.doneBy.name : null, done_at: a.doneAt || null };
        }),
        comments: (r.comments || []).map(function (c) {
          return { legacy_id: c.id, text: c.text, by_id: c.by && c.by.id, by_name: c.by ? c.by.name : "", at: c.at || null };
        })
      };
    });
    var parts = chunks(recs, 250), count = 0;
    for (var i = 0; i < parts.length; i++) {
      if (onProgress) { onProgress(i + 1, parts.length + 1, (i * 250 + 1) + "-" + (i * 250 + parts[i].length)); }
      count += Number(must(await sb.rpc("import_archive", { p_db: audience, p_records: parts[i] }), "archive")) || 0;
    }
    var addedAreas = await addAreas(bundle.areas || []);
    if (onProgress) { onProgress(parts.length + 1, parts.length + 1, "done"); }
    invalidate();
    await loadArchive();
    return { count: count, buckets: parts.length, areas: addedAreas };
  }

  /* ---------------------------------------------------------------- move from the shared-folder app */

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(x) { return UUID_RE.test(String(x || "")); }

  /* Same text -> same id, so moving the data twice never doubles a row. */
  function uuidFrom(text) {
    var str = String(text), hex = "";
    for (var k = 0; k < 4; k++) {
      var h = 0x811c9dc5 ^ (k * 0x9e3779b1);
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
      hex += ("00000000" + (h >>> 0).toString(16)).slice(-8);
    }
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-5" + hex.slice(13, 16) + "-" +
      ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20) + "-" + hex.slice(20, 32);
  }
  function keepOrDerive(id, salt) { return isUuid(id) ? String(id).toLowerCase() : uuidFrom(salt + ":" + id); }

  /* Whole records from the shared-folder app (ids already mapped to the new
     staff ids by the caller). Handovers are updated if already moved;
     actions and comments already moved are left as they are. */
  async function moveRecords(list) {
    var now = new Date().toISOString();
    var rows = [], acts = [], coms = [];
    list.forEach(function (rec) {
      var id = keepOrDerive(rec.id, "h");
      var r = rowIn(rec);
      r.id = id;
      r.version = Number(rec.version) || 1;
      r.created_at = rec.createdAt || null;
      r.updated_at = rec.updatedAt || rec.createdAt || now;
      r.kind = rec.kind || null;
      r.deleted_at = rec.deletedAt || null;
      r.deleted_by = rec.deletedBy && rec.deletedBy.id ? rec.deletedBy.id : null;
      r.deleted_by_name = rec.deletedBy ? rec.deletedBy.name || "" : null;
      if (!r.deleted_at) { r.deleted_by_name = null; }
      rows.push(r);
      var actionIds = {};
      (rec.actions || []).forEach(function (a) {
        var aid = keepOrDerive(a.id, "a:" + id);
        actionIds[a.id] = aid;
        acts.push({
          id: aid, handover_id: id, text: a.text || "", status: ["open", "done", "old"].indexOf(a.status) >= 0 ? a.status : "open",
          by_id: a.by && a.by.id ? a.by.id : null, by_name: a.by ? a.by.name || "" : "", at: a.at || r.created_at || now,
          done_by_id: a.doneBy && a.doneBy.id ? a.doneBy.id : null, done_by_name: a.doneBy ? a.doneBy.name || null : null,
          done_at: a.doneAt || null, done_comment: a.doneComment ? keepOrDerive(a.doneComment, "c:" + id) : null
        });
      });
      (rec.comments || []).forEach(function (c) {
        coms.push({
          id: keepOrDerive(c.id, "c:" + id), handover_id: id, text: c.text || "", by_id: c.by && c.by.id ? c.by.id : null,
          by_name: c.by ? c.by.name || "" : "", at: c.at || now, action_id: c.actionId ? (actionIds[c.actionId] || null) : null,
          imported: true
        });
      });
    });
    // one database call per batch, run as the owner (managers' records included)
    must(await sb.rpc("admin_move_handovers", { p_handovers: rows, p_actions: acts, p_comments: coms, p_attachments: [] }), "move");
    invalidate();
    return rows.map(function (r) { return r.id; });
  }

  async function deleteByLegacyIds(legacyIds, by) {
    var parts = chunks(legacyIds, 150);
    for (var i = 0; i < parts.length; i++) {
      must(await sb.from("handovers").update({
        deleted_at: new Date().toISOString(), deleted_by: by && by.id ? by.id : null, deleted_by_name: by ? by.name || "" : ""
      }).in("legacy_id", parts[i]).is("deleted_at", null), "delete");
    }
    invalidate();
  }

  async function attachmentIdsOf(handoverIds) {
    var have = {};
    var parts = chunks(handoverIds, 150);
    for (var i = 0; i < parts.length; i++) {
      (must(await sb.from("handover_attachments").select("id").in("handover_id", parts[i]), "attachments") || [])
        .forEach(function (a) { have[a.id] = true; });
    }
    return have;
  }

  async function moveAttachment(handoverId, att, file) {
    var f = await shrinkImage(file);
    var id = keepOrDerive(att.id, "f:" + handoverId + ":" + (att.stored || att.name));
    var name = att.name || file.name || "file";
    if (f !== file) { name = String(name).replace(/\.[^.]+$/, "") + ".jpg"; }
    var path = handoverId + "/" + id + "-" + safeName(name);
    must(await sb.storage.from("attachments").upload(path, f, { contentType: f.type || att.type || "application/octet-stream", upsert: true }), "upload");
    must(await sb.rpc("admin_move_handovers", { p_handovers: [], p_actions: [], p_comments: [], p_attachments: [{
      id: id, handover_id: handoverId, name: name, size: f.size || 0, mime: f.type || att.type || "", path: path,
      by_id: att.by && att.by.id ? att.by.id : null, by_name: att.by ? att.by.name || "" : "", at: att.at || new Date().toISOString()
    }] }), "attachment");
    return id;
  }

  /* ---------------------------------------------------------------- backup */

  async function exportBackup() {
    var hs = await fetchAll("handovers", "*", "created_at");
    var ids = hs.map(function (h) { return h.id; });
    var acts = [], coms = [], atts = [];
    var parts = chunks(ids, 300);
    for (var i = 0; i < parts.length; i++) {
      var r = await Promise.all([
        sb.from("handover_actions").select("*").in("handover_id", parts[i]),
        sb.from("handover_comments").select("*").in("handover_id", parts[i]),
        sb.from("handover_attachments").select("*").in("handover_id", parts[i])
      ]);
      acts = acts.concat(must(r[0]) || []); coms = coms.concat(must(r[1]) || []); atts = atts.concat(must(r[2]) || []);
    }
    return {
      kind: "plant-handover-cloud-backup", exportedAt: new Date().toISOString(), by: me ? me.name : "",
      staff: master.staff, areas: master.areas, tags: master.tags,
      handovers: hs, actions: acts, comments: coms, attachments: atts,
      notifications: await listNotifications(500, true)
    };
  }

  /* ---------------------------------------------------------------- misc kept for the screens */

  function withTimeout(p) { return p; }
  async function readLock() { return null; }
  async function writeLock() { return null; }
  async function releaseLock() { return null; }

  global.Store = {
    STATUSES: STATUSES, FOLLOWUP: FOLLOWUP, TYPE: TYPE_EN, normalizeStatus: normalizeStatus,
    client: sb, idb: idb,
    // sign-in
    roster: roster, signIn: signIn, createAccount: createAccount, signOut: signOut, loadMe: loadMe,
    currentSession: currentSession, changePassword: changePassword,
    me: function () { return me; }, isAdmin: isAdmin,
    connected: function () { return !!me; },
    isOffline: function () { return offline || !global.navigator.onLine; }, isNetworkError: isNetworkError,
    // master lists
    loadMaster: loadMaster, loadTags: loadTags, users: users, userById: userById, canSignIn: canSignIn,
    tags: tags, allTags: allTags, tagByNumber: tagByNumber, upperEquipmentList: upperEquipmentList, structure: structure,
    addArea: addArea, addAreas: addAreas, removeArea: removeArea,
    importTags: importTags, upsertTag: upsertTag, bulkSetArea: bulkSetArea,
    upsertUser: upsertUser, setUserActive: setUserActive, loadStandardStaff: loadStandardStaff,
    clearUserPassword: clearUserPassword,
    // views
    viewerIsManager: viewerIsManager, setView: setView, getView: getView, inScope: inScope, canView: canView,
    // handovers
    listHandovers: listHandovers, allHeaders: allHeaders, syncHeaders: syncHeaders, invalidate: invalidate,
    searchText: searchText, searchIds: searchIds, searchComments: searchComments,
    getHandover: getHandover, getHandovers: getHandovers, saveHandover: saveHandover,
    saveHandoverChecked: saveHandoverChecked, setStatus: setStatus,
    deleteHandover: deleteHandover, restoreHandover: restoreHandover, listDeleted: listDeleted, restoreAll: restoreAll,
    adminCount: adminCount, adminDelete: adminDelete, exportRecords: exportRecords, downloadFile: downloadFile,
    appendComment: appendComment, addAction: addAction,
    putAttachment: putAttachment, appendAttachments: appendAttachments, getAttachmentFile: getAttachmentFile,
    // notifications
    addNotification: addNotification, listNotifications: listNotifications, loadReads: loadReads,
    isUnread: isUnread, markRead: markRead, markAllRead: markAllRead,
    // imports, archive, backup
    addHandovers: addHandovers, importArchive: importArchive, clearArchive: clearArchive, loadArchive: loadArchive, archiveInfo: archiveInfo,
    archivedRecord: archivedRecord, audienceOfId: audienceOfId, isArchiveId: isArchiveId, exportBackup: exportBackup,
    moveRecords: moveRecords, deleteByLegacyIds: deleteByLegacyIds, attachmentIdsOf: attachmentIdsOf, moveAttachment: moveAttachment, keepOrDerive: keepOrDerive, isUuid: isUuid,
    // compatibility
    log: log, logText: function () { return logLines.join("\n"); }, withTimeout: withTimeout,
    readLock: readLock, writeLock: writeLock, releaseLock: releaseLock
  };
})(window);
