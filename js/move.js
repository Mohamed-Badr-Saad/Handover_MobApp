/* ==========================================================================
   move.js - Administration tools that work with files and folders:
     * Shared folder: EXPORT the whole database
         - "HandoverData copy": the shared-folder app's own format (it can open
           it as a fallback; this app can import it back)
         - "Backup file": plant-handover-backup.json (+ attachments folder)
     * Shared folder: IMPORT a HandoverData folder (old app or an export) or a
       backup file / folder. Safe to repeat: rows keep (or derive) their ids.
     * DELETE handovers - all or by filter - recoverable or permanent.
   Folders need Chrome or Edge on a PC (File System Access API). On phones the
   backup file can still be downloaded and imported.
   ========================================================================== */
(function (global) {
  "use strict";

  var S = global.Store;
  var t = global.t;
  var esc = global.Util.esc;

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function view() { return document.getElementById("view"); }
  function canFolders() { return typeof global.showDirectoryPicker === "function"; }
  function num(n) { return global.Fmt.num(n || 0); }

  /* ------------------------------------------------------------------ folder helpers */

  async function sub(dir, names) {
    var d = dir;
    for (var i = 0; i < names.length; i++) {
      try { d = await d.getDirectoryHandle(names[i]); } catch (e) { return null; }
    }
    return d;
  }
  async function mkdir(dir, names) {
    var d = dir;
    for (var i = 0; i < names.length; i++) { d = await d.getDirectoryHandle(names[i], { create: true }); }
    return d;
  }
  async function readFile(dir, name) {
    try { return await (await dir.getFileHandle(name)).getFile(); } catch (e) { return null; }
  }
  async function readJson(dir, name) {
    var f = await readFile(dir, name);
    if (!f) { return null; }
    try { return JSON.parse(await f.text()); } catch (e) { return null; }
  }
  async function writeFile(dir, name, data) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }
  function writeJson(dir, name, obj) { return writeFile(dir, name, JSON.stringify(obj, null, 1)); }
  async function names(dir, kind) {
    var out = [];
    if (!dir) { return out; }
    var it = dir.values();
    for (;;) {
      var step = await it.next();
      if (step.done) { break; }
      if (!kind || step.value.kind === kind) { out.push(step.value.name); }
    }
    return out.sort();
  }

  function norm(s) { return global.Util.normalize(String(s || "")).replace(/\s+/g, " ").trim(); }
  function stamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }
  function safeName(n) { return String(n || "file").replace(/[\\/:*?"<>|]+/g, "_").slice(-120); }

  /* ================================================================== sources
     Every import reads from a "source" with the same shape, whether it is a
     HandoverData folder or a backup file:
       users, areas, tags, counts,
       records()   -> handovers written in an app (old record shape), incl. deleted
       archive(db) -> old-sheet entries of one database
       file(id, a) -> the attachment file, or null                              */

  /* HandoverData folder (shared-folder app, or an export from this app).
     The record files are the truth: the month index files ("summaries") are
     ignored, so an entry whose file was removed is never brought back, and a
     handover listed in deleted/ stays deleted even if its file is still there. */
  async function folderSource(root) {
    var data = (await sub(root, ["data"])) || ((await sub(root, ["master"])) ? root : null);
    if (!data) { return null; }
    var master = await sub(data, ["master"]);
    var users = master ? await readJson(master, "users.json") : null;
    var structure = master ? await readJson(master, "structure.json") : null;
    var tags = master ? await readJson(master, "equipment_tags.json") : null;
    var hoDir = await sub(data, ["handovers"]);
    var delDir = await sub(data, ["deleted"]);
    var attDir = await sub(data, ["attachments"]);
    var arc = {}, arcCount = { engineers: 0, managers: 0 };
    var dirs = { engineers: "archive", managers: "archive-managers" };
    for (var aud in dirs) {
      var d = await sub(data, [dirs[aud]]);
      var m = d ? await readJson(d, "manifest.json") : null;
      arc[aud] = m && Array.isArray(m.buckets) ? { dir: d, manifest: m } : null;
      arcCount[aud] = m ? Number(m.count) || 0 : 0;
    }
    var hoFiles = (await names(hoDir, "file")).filter(function (n) { return /\.json$/i.test(n); });
    var delFiles = (await names(delDir, "file")).filter(function (n) { return /\.json$/i.test(n); });
    var attCount = 0;
    var attFolders = await names(attDir, "directory");
    for (var i = 0; i < attFolders.length; i++) { attCount += (await names(await sub(attDir, [attFolders[i]]), "file")).length; }
    if (!users && !hoFiles.length && !arc.engineers && !arc.managers) { return null; }

    var overrides = {}, archiveDeleted = {};
    var src = {
      kind: "folder",
      users: users && Array.isArray(users.users) ? users.users : [],
      areas: structure && Array.isArray(structure.areas) ? structure.areas : [],
      tags: tags && Array.isArray(tags.tags) ? tags.tags : (Array.isArray(tags) ? tags : []),
      counts: { handovers: hoFiles.length + delFiles.length, attachments: attCount, arcE: arcCount.engineers, arcM: arcCount.managers },
      overrides: overrides, archiveDeleted: archiveDeleted,
      records: async function (progress) {
        var byId = {};
        for (var k = 0; k < delFiles.length; k++) {
          var w = await readJson(delDir, delFiles[k]);
          if (!w || !w.id || w.restored) { continue; }
          var rec = w.record && typeof w.record === "object" ? Object.assign({}, w.record) : Object.assign({}, w);
          rec.id = rec.id || w.id;
          rec.deletedAt = w.deletedAt || rec.deletedAt || new Date().toISOString();
          rec.deletedBy = w.deletedBy || rec.deletedBy || null;
          delete rec.record;
          byId[rec.id] = rec;
        }
        for (var j = 0; j < hoFiles.length; j++) {
          var r = await readJson(hoDir, hoFiles[j]);
          if (!r || !r.id || byId[r.id]) { continue; }        // deleted wins over a left-over file
          byId[r.id] = r;
          if (progress && j % 50 === 0) { progress(j + "/" + hoFiles.length); }
        }
        var out = [];
        Object.keys(byId).forEach(function (id) {
          var rec = byId[id];
          if (rec.archived || S.isArchiveId(rec.id)) {
            if (rec.deletedAt) { archiveDeleted[rec.id] = rec; } else { overrides[rec.id] = rec; }
          } else { out.push(rec); }
        });
        return out;
      },
      archive: async function (audience, progress) {
        var a = arc[audience];
        var list = [], seen = {};
        if (a) {
          for (var b = 0; b < a.manifest.buckets.length; b++) {
            var file = await readJson(a.dir, a.manifest.buckets[b] + ".json");
            (file && Array.isArray(file.records) ? file.records : []).forEach(function (r) {
              if (!r || !r.id) { return; }
              seen[r.id] = true;
              list.push(overrides[r.id] || r);
            });
            if (progress) { progress(a.manifest.buckets[b]); }
          }
        }
        Object.keys(overrides).forEach(function (id) {
          if (!seen[id] && S.audienceOfId(id) === audience) { list.push(overrides[id]); }
        });
        return list;
      },
      file: async function (oldId, att) {
        var dir = attDir ? await sub(attDir, [oldId]) : null;
        return dir ? await readFile(dir, att.stored || att.name) : null;
      }
    };
    return src;
  }

  /* Backup made by this app: plant-handover-backup.json, optionally with its
     attachments/ folder next to it. */
  function backupSource(bundle, dir) {
    if (!bundle || bundle.kind !== "plant-handover-backup" || !Array.isArray(bundle.records)) { return null; }
    var arc = bundle.archive || {};
    var attCount = 0;
    bundle.records.concat(arc.engineers || [], arc.managers || []).forEach(function (r) { attCount += (r.attachments || []).length; });
    var overrides = {}, archiveDeleted = {};
    return {
      kind: "backup", hasFiles: !!dir,
      users: bundle.users || [], areas: bundle.areas || [], tags: bundle.tags || [],
      counts: { handovers: bundle.records.length, attachments: attCount,
                arcE: (arc.engineers || []).length, arcM: (arc.managers || []).length },
      overrides: overrides, archiveDeleted: archiveDeleted,
      records: async function () {
        var out = [];
        bundle.records.forEach(function (r) {
          if (r.archived || S.isArchiveId(r.id)) { if (r.deletedAt) { archiveDeleted[r.id] = r; } else { overrides[r.id] = r; } }
          else { out.push(JSON.parse(JSON.stringify(r))); }
        });
        return out;
      },
      archive: async function (audience) {
        return (arc[audience] || []).map(function (r) {
          if (r.deletedAt) { archiveDeleted[r.id] = r; }
          return JSON.parse(JSON.stringify(r));
        });
      },
      file: async function (oldId, att) {
        if (!dir) { return null; }
        var d = await sub(dir, ["attachments", oldId]);
        return d ? await readFile(d, att.stored || att.name) : null;
      }
    };
  }

  /* ================================================================== import */

  /* Old staff ids (e.g. "u-opr952") -> staff ids here, by employee id, then name. */
  async function moveStaff(oldUsers) {
    function findNew(u) {
      var emp = String(u.employeeId || "").trim().toLowerCase();
      var list = S.users();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === u.id) { return list[i]; }
        if (emp && String(list[i].employeeId || "").trim().toLowerCase() === emp) { return list[i]; }
      }
      var n = norm(u.name);
      for (var j = 0; j < list.length; j++) { if (n && norm(list[j].name) === n) { return list[j]; } }
      return null;
    }
    var map = {}, added = 0, updated = 0;
    for (var i = 0; i < oldUsers.length; i++) {
      var u = oldUsers[i];
      if (!u || !u.name) { continue; }
      var hit = findNew(u);
      var role = ["administrator", "manager", "supervisor", "engineer", "technician", "viewer"].indexOf(u.role) >= 0 ? u.role : "technician";
      await S.upsertUser({
        id: hit ? hit.id : null, name: hit ? hit.name : u.name,
        employeeId: u.employeeId || (hit ? hit.employeeId : ""),
        jobTitle: u.jobTitle || (hit ? hit.jobTitle : ""), department: u.department || (hit ? hit.department : ""),
        role: role, active: u.active !== false && u.active !== "False", isAdmin: hit ? hit.isAdmin : !!u.isAdmin
      });
      if (hit) { updated++; } else { added++; }
      var now = findNew(u);
      if (now) { map[u.id] = now.id; }
    }
    S.users().forEach(function (x) { map[x.id] = x.id; });
    return { map: map, added: added, updated: updated };
  }

  function remapper(map) {
    function id(x) { return x && Object.prototype.hasOwnProperty.call(map, x) ? map[x] : null; }
    function person(p) { return p ? { id: id(p.id), name: p.name || "", original: p.original } : p; }
    return function (rec) {
      rec.createdBy = person(rec.createdBy) || { id: null, name: "" };
      if (rec.importedBy) { rec.importedBy = person(rec.importedBy); }
      if (rec.deletedBy) { rec.deletedBy = person(rec.deletedBy); }
      rec.team = (rec.team || []).map(function (m) { var o = Object.assign({}, m); o.id = id(m.id); return o; });
      (rec.comments || []).forEach(function (c) { c.by = person(c.by); });
      (rec.actions || []).forEach(function (a) { a.by = person(a.by); if (a.doneBy) { a.doneBy = person(a.doneBy); } });
      (rec.attachments || []).forEach(function (a) { a.by = person(a.by); });
      (rec.history || []).forEach(function (h) { if (h.byId) { h.byId = id(h.byId); } });
      return rec;
    };
  }

  function stepRow(boxSel, key, label) {
    var box = $(boxSel);
    var el = document.getElementById("st-" + key);
    if (!el && box) { el = document.createElement("div"); el.id = "st-" + key; box.appendChild(el); }
    return function (state, detail) {
      if (!el) { return; }
      var icon = state === "ok" ? "✓" : state === "err" ? "✗" : "···";
      var color = state === "ok" ? "var(--success)" : state === "err" ? "var(--danger)" : "var(--text-faint)";
      el.innerHTML = '<b style="color:' + color + ';display:inline-block;width:18px">' + icon + "</b>" +
        esc(label || t("move.step." + key)) + (detail ? ' <span class="faint">— ' + esc(detail) + "</span>" : "");
    };
  }
  function stepper(boxSel) {
    var failed = 0;
    async function step(key, fn, label) {
      var paint = stepRow(boxSel, key, label);
      paint("run");
      try { var detail = await fn(function (d) { paint("run", String(d)); }); paint("ok", detail || ""); return true; }
      catch (e) { failed++; S.log("folder", key, e && e.message); paint("err", (e && e.message) || String(e)); return false; }
    }
    step.failed = function () { return failed; };
    return step;
  }

  async function runImport(src, me) {
    $("#st-box-imp").innerHTML = "";
    var step = stepper("#st-box-imp");
    var total = 0, remap = null, moved = [];

    var ok = await step("staff", async function () {
      var r = await moveStaff(src.users);
      remap = remapper(r.map);
      return "+" + r.added + " / " + r.updated;
    });
    if (!ok) { return; }
    await step("areas", async function () { return "+" + (await S.addAreas(src.areas)); });
    await step("tags", async function () {
      if (!src.tags.length) { return "0"; }
      var r = await S.importTags(src.tags);
      return "+" + r.added + " / " + r.updated;
    });

    await step("handovers", async function (progress) {
      var list = await src.records(progress);
      for (var i = 0; i < list.length; i += 100) {
        var batch = list.slice(i, i + 100).map(remap);
        var ids = await S.moveRecords(batch);
        batch.forEach(function (rec, k) { moved.push({ rec: rec, id: ids[k] }); });
        progress(num(moved.length) + " / " + num(list.length));
      }
      total += moved.length;
      return num(moved.length);
    });

    await step("attachments", async function (progress) {
      var withFiles = moved.filter(function (m) { return (m.rec.attachments || []).length; });
      if (!withFiles.length) { return "0"; }
      var have = await S.attachmentIdsOf(withFiles.map(function (m) { return m.id; }));
      var done = 0, skipped = 0, missing = 0;
      for (var i = 0; i < withFiles.length; i++) {
        var m = withFiles[i];
        for (var j = 0; j < m.rec.attachments.length; j++) {
          var att = m.rec.attachments[j];
          var aid = S.keepOrDerive(att.id, "f:" + m.id + ":" + (att.stored || att.name));
          if (have[aid]) { skipped++; continue; }
          var file = await src.file(m.rec.id, att);
          if (!file) { missing++; continue; }
          await S.moveAttachment(m.id, att, file);
          done++;
          progress(num(done));
        }
      }
      return num(done) + (skipped ? " · " + t("move.skipped", { n: skipped }) : "") +
        (missing ? " · " + t("move.missing", { n: missing }) : "");
    });

    var arcSteps = { engineers: "archiveE", managers: "archiveM" };
    for (var aud in arcSteps) {
      /* eslint-disable no-loop-func */
      await step(arcSteps[aud], (function (audience) {
        return async function (progress) {
          // deleted old-sheet entries are imported too, then moved to "Deleted handovers"
          var list = await src.archive(audience, progress), seen = {};
          list.forEach(function (r) { seen[r.id] = true; });
          Object.keys(src.archiveDeleted).forEach(function (id) {
            if (!seen[id] && S.audienceOfId(id) === audience) { list.push(src.archiveDeleted[id]); }
          });
          var records = list.map(function (r) { return remap(JSON.parse(JSON.stringify(r))); });
          var count = 0;
          if (records.length) {
            var res = await S.importArchive({ kind: "plant-handover-archive", audience: audience, records: records, areas: [] },
              me ? me.name : "", function (n, of) { progress(n + " / " + of); }, audience);
            count = res.count;
          }
          total += count;
          var gone = Object.keys(src.archiveDeleted).filter(function (id) { return S.audienceOfId(id) === audience; });
          if (gone.length) { await S.adminDelete({ legacy: gone, state: "active" }, "recoverable"); }
          return num(count) + (gone.length ? " · " + t("move.deletedKept", { n: gone.length }) : "");
        };
      })(aud));
    }

    S.invalidate();
    try { await S.addNotification({ type: "import", actor: { id: me.id, name: me.name }, handoverId: "", title: t("folder.importTitle"), count: total }); }
    catch (e) { /* the import itself is done */ }
    var end = document.createElement("p");
    end.style.marginTop = "10px";
    end.innerHTML = "<b>" + esc(t("move.done", { n: num(total) })) + "</b>";
    $("#st-box-imp").appendChild(end);
    global.UI.toast(t("move.done", { n: num(total) }), step.failed() ? "err" : "ok");
  }

  /* ================================================================== export */

  function person(id, name, original) {
    var p = { id: id || null, name: name || "" };
    if (original) { p.original = original; }
    return p;
  }

  /* A database row (+ children) -> the shared-folder app's record shape. */
  function toOld(item) {
    var h = item.h;
    var archived = !!h.archived;
    var rec = {
      id: archived && h.legacy_id ? h.legacy_id : h.id,
      version: h.version || 1,
      title: h.title || "", description: h.description || "",
      plant: "", area: h.area || "", unit: "", shift: "", location: h.location || "",
      tags: h.tags || [], team: h.team || [],
      status: h.status || "info", kind: h.kind || undefined, dueDate: h.due_date || null,
      createdBy: person(h.created_by, h.created_by_name, h.created_by_original),
      createdAt: h.created_at || null,
      updatedAt: archived && h.date_unknown ? null : (h.updated_at || h.created_at || null),
      history: h.history || [],
      restricted: h.db === "managers" ? "managers" : undefined,
      importedFrom: archived ? undefined : (h.imported_from || undefined),
      importedAt: h.imported_at || undefined
    };
    if (archived) {
      rec.archived = true;
      rec.legacyStatus = h.legacy_status || undefined;
      rec.source = h.source || undefined;
      rec.dateUnknown = h.date_unknown ? true : undefined;
      if (h.updated_at && String(h.updated_at).slice(0, 4) === "1990") { rec.updatedAt = rec.createdAt; }
    }
    if (h.deleted_at) { rec.deletedAt = h.deleted_at; rec.deletedBy = person(h.deleted_by, h.deleted_by_name); }
    rec.actions = (item.actions || []).map(function (a) {
      var x = { id: a.legacy_id || a.id, text: a.text, status: a.status, by: person(a.by_id, a.by_name), at: a.at };
      if (a.done_by_id || a.done_by_name) { x.doneBy = person(a.done_by_id, a.done_by_name); }
      if (a.done_at) { x.doneAt = a.done_at; }
      if (a.done_comment) { x.doneComment = a.done_comment; }
      return x;
    });
    rec.comments = (item.comments || []).map(function (c) {
      var x = { id: c.legacy_id || c.id, text: c.text, at: c.at, by: person(c.by_id, c.by_name) };
      if (c.action_id) { x.actionId = c.action_id; }
      return x;
    });
    rec.attachments = (item.attachments || []).map(function (f) {
      return { id: f.id, name: f.name, stored: String(f.id).slice(0, 8) + "_" + safeName(f.name), type: f.mime || "",
               size: f.size || 0, at: f.at, by: person(f.by_id, f.by_name), path: f.path };
    });
    return rec;
  }

  /* the shared-folder app's month index ("summary") entry for a record */
  function headerOf(h) {
    return {
      id: h.id, title: h.title, status: h.status, plant: h.plant, area: h.area, unit: h.unit, shift: h.shift,
      tags: h.tags || [], teamIds: (h.team || []).map(function (m) { return m && m.id; }).filter(Boolean),
      restricted: h.restricted || undefined, importedFrom: h.importedFrom || undefined, hv: 2,
      createdBy: h.createdBy, createdAt: h.createdAt, updatedAt: h.updatedAt, dueDate: h.dueDate || null,
      commentCount: (h.comments || []).length,
      openActions: (h.actions || []).filter(function (a) { return a && a.status === "open"; }).length || undefined,
      attachmentCount: (h.attachments || []).length,
      snippet: String(h.description || "").slice(0, 220)
    };
  }

  function strip(rec) {
    var out = JSON.parse(JSON.stringify(rec));
    (out.attachments || []).forEach(function (a) { delete a.path; });
    return out;
  }

  function oldUsers() {
    return S.users().map(function (u) {
      return { id: u.id, name: u.name, employeeId: u.employeeId || "", jobTitle: u.jobTitle || "", department: u.department || "",
               role: u.role || "technician", active: u.active !== false, isAdmin: u.isAdmin || undefined };
    });
  }
  function oldAreas() { return S.structure().areas.map(function (a) { return { id: a.id, en: a.en, ar: a.en }; }); }
  function oldTags() { return S.allTags().map(function (x) { return Object.assign({}, x); }); }

  async function gather(progress) {
    var items = await S.exportRecords(function (n) { progress(t("folder.reading", { n: num(n) })); });
    var all = items.map(toOld);
    var live = [], archive = { engineers: [], managers: [] }, deleted = [];
    all.forEach(function (r) {
      if (r.deletedAt) { deleted.push(r); }
      if (r.archived) { if (!r.deletedAt) { archive[r.restricted === "managers" ? "managers" : "engineers"].push(r); } }
      else if (!r.deletedAt) { live.push(r); }
    });
    return { all: all, live: live, archive: archive, deleted: deleted };
  }

  async function copyAttachments(records, attRoot, progress) {
    var done = 0, failed = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!(r.attachments || []).length) { continue; }
      var dir = await mkdir(attRoot, [r.id]);
      for (var j = 0; j < r.attachments.length; j++) {
        var a = r.attachments[j];
        try {
          var blob = await S.downloadFile(a.path);
          await writeFile(dir, a.stored, blob);
          done++;
        } catch (e) { failed++; }
        progress(num(done));
      }
    }
    return { done: done, failed: failed };
  }

  async function exportHandoverData(parent, me) {
    $("#st-box-exp").innerHTML = "";
    var step = stepper("#st-box-exp");
    var folderName = "HandoverData_" + stamp();
    var data = null, set = null;
    await step("exp-read", async function (progress) {
      set = await gather(progress);
      return t("folder.readDone", { n: num(set.all.length) });
    }, t("folder.step.read"));
    if (!set) { return; }
    await step("exp-master", async function () {
      data = await mkdir(parent, [folderName, "data"]);
      var master = await mkdir(data, ["master"]);
      await mkdir(data, ["notifications"]); await mkdir(data, ["locks"]);
      await writeJson(master, "users.json", { users: oldUsers() });
      var st = S.structure();
      await writeJson(master, "structure.json", { plants: [], areas: oldAreas(), units: [], shifts: st.shifts, equipmentTypes: st.equipmentTypes });
      await writeJson(master, "equipment_tags.json", { tags: oldTags() });
      return num(S.users().length) + " / " + num(st.areas.length) + " / " + num(S.allTags().length);
    }, t("folder.step.master"));
    if (!data) { return; }
    await step("exp-handovers", async function (progress) {
      var ho = await mkdir(data, ["handovers"]);
      var shards = {};
      for (var i = 0; i < set.live.length; i++) {
        var r = set.live[i];
        await writeJson(ho, r.id + ".json", strip(r));
        var key = String(r.createdAt || new Date().toISOString()).slice(0, 7);
        (shards[key] = shards[key] || { month: key, items: {} }).items[r.id] = headerOf(r);
        if (i % 20 === 0) { progress(num(i) + " / " + num(set.live.length)); }
      }
      // the search "summary": built only from the files written above, so it can
      // never list a handover that is not there
      var idx = await mkdir(data, ["index"]);
      var keys = Object.keys(shards);
      for (var k = 0; k < keys.length; k++) { shards[keys[k]].updatedAt = new Date().toISOString(); await writeJson(idx, keys[k] + ".json", shards[keys[k]]); }
      var del = await mkdir(data, ["deleted"]);
      for (var d = 0; d < set.deleted.length; d++) {
        var x = set.deleted[d];
        await writeJson(del, x.id + ".json", { id: x.id, title: x.title, createdBy: x.createdBy, createdAt: x.createdAt,
          archived: !!x.archived, deletedAt: x.deletedAt, deletedBy: x.deletedBy || null, record: strip(x) });
      }
      return num(set.live.length) + " · " + t("folder.deletedN", { n: num(set.deleted.length) });
    }, t("folder.step.handovers"));
    await step("exp-archive", async function (progress) {
      var dirs = { engineers: "archive", managers: "archive-managers" }, counts = [];
      for (var aud in dirs) {
        var list = set.archive[aud];
        counts.push(num(list.length));
        if (!list.length) { continue; }
        var dir = await mkdir(data, [dirs[aud]]);
        var buckets = {};
        list.forEach(function (r) {
          var b = r.createdAt ? String(r.createdAt).slice(0, 4) : "undated";
          (buckets[b] = buckets[b] || []).push(strip(r));
        });
        var keys = Object.keys(buckets).sort();
        for (var i = 0; i < keys.length; i++) { await writeJson(dir, keys[i] + ".json", { bucket: keys[i], records: buckets[keys[i]] }); progress(aud + " " + keys[i]); }
        await writeJson(dir, "manifest.json", { kind: "plant-handover-archive-manifest", audience: aud, importedAt: new Date().toISOString(),
          by: me ? me.name : "", sources: ["Plant Handover mobile export"], count: list.length, buckets: keys });
      }
      return counts.join(" / ");
    }, t("folder.step.archive"));
    await step("exp-files", async function (progress) {
      var res = await copyAttachments(set.all, await mkdir(data, ["attachments"]), progress);
      return num(res.done) + (res.failed ? " · " + t("folder.filesFailed", { n: res.failed }) : "");
    }, t("folder.step.files"));
    await writeFile(await mkdir(parent, [folderName]), "README.txt",
      "Plant Handover - export of " + new Date().toString() + "\r\n" +
      "Format: HandoverData (the shared-folder app's own format).\r\n" +
      "- Shared-folder app: open index.html and choose THIS folder (" + folderName + ").\r\n" +
      "  Everyone sets a new password the first time (passwords are not exported).\r\n" +
      "- Mobile app: Administration > Shared folder > Import, and choose this folder.\r\n");
    finishExport(folderName, step);
  }

  async function exportBackup(parent, me) {
    $("#st-box-exp").innerHTML = "";
    var step = stepper("#st-box-exp");
    var set = null, bundle = null;
    await step("exp-read", async function (progress) {
      set = await gather(progress);
      return t("folder.readDone", { n: num(set.all.length) });
    }, t("folder.step.read"));
    if (!set) { return; }
    bundle = {
      kind: "plant-handover-backup", format: 2, exportedAt: new Date().toISOString(), by: me ? me.name : "",
      users: oldUsers(), areas: oldAreas(), tags: oldTags(),
      records: set.all.filter(function (r) { return !r.archived || r.deletedAt; }).map(strip),
      archive: { engineers: set.archive.engineers.map(strip), managers: set.archive.managers.map(strip) }
    };
    var json = JSON.stringify(bundle);
    if (!parent) {
      // phone / no folder access: download the file (attachments are not included)
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = "plant-handover-backup_" + stamp() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      stepRow("#st-box-exp", "exp-dl", t("folder.step.download"))("ok", t("folder.noFiles"));
      global.UI.toast(t("folder.exported", { name: a.download }), "ok");
      return;
    }
    var folderName = "Plant_Handover_backup_" + stamp();
    var dir = null;
    await step("exp-json", async function () {
      dir = await mkdir(parent, [folderName]);
      await writeFile(dir, "plant-handover-backup.json", json);
      return global.Fmt.bytes(json.length);
    }, t("folder.step.json"));
    if (!dir) { return; }
    await step("exp-files", async function (progress) {
      var res = await copyAttachments(set.all, await mkdir(dir, ["attachments"]), progress);
      return num(res.done) + (res.failed ? " · " + t("folder.filesFailed", { n: res.failed }) : "");
    }, t("folder.step.files"));
    finishExport(folderName, step);
  }

  function finishExport(folderName, step) {
    var end = document.createElement("p");
    end.style.marginTop = "10px";
    end.innerHTML = "<b>" + esc(t("folder.exported", { name: folderName })) + "</b>";
    $("#st-box-exp").appendChild(end);
    global.UI.toast(t("folder.exported", { name: folderName }), step.failed() ? "err" : "ok");
  }

  /* ================================================================== page: shared folder */

  async function page() {
    var me = global.App.user();
    if (!S.isAdmin()) { global.App.navigate("admin"); return; }
    var folders = canFolders();
    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("folder.title")) + "</h1><p>" + esc(t("folder.sub")) + "</p></div>" +
        '<div class="spacer"></div><button class="btn ghost" id="fd-back">' + esc(t("common.back")) + "</button></div>" +
      (folders ? "" : '<div class="card" style="max-width:820px"><p class="small" style="margin:0">' + esc(t("folder.noFolderApi")) + "</p></div>") +

      '<div class="card" style="max-width:820px"><h3>' + esc(t("folder.exportTitle")) + "</h3>" +
        '<p class="small faint">' + esc(t("folder.exportDesc")) + "</p>" +
        '<div class="kind-picker" role="radiogroup" style="margin:10px 0">' +
          fmtOption("handoverdata", t("folder.fmtHD"), t("folder.fmtHDDesc"), !folders) +
          fmtOption("backup", t("folder.fmtBK"), t("folder.fmtBKDesc"), false) +
        "</div>" +
        '<button class="btn primary" id="fd-export">' + esc(t(folders ? "folder.exportGo" : "folder.exportDl")) + "</button>" +
        '<div id="st-box-exp" class="small" style="margin-top:14px;display:flex;flex-direction:column;gap:6px"></div></div>' +

      '<div class="card" style="max-width:820px"><h3>' + esc(t("folder.importTitle")) + "</h3>" +
        '<p class="small faint">' + esc(t("folder.importDesc")) + "</p>" +
        '<div class="btn-row">' +
          (folders ? '<button class="btn primary" id="fd-pick">' + esc(t("folder.pickFolder")) + "</button>" : "") +
          '<button class="btn" id="fd-pickfile">' + esc(t("folder.pickFile")) + "</button>" +
          '<input type="file" id="fd-file" accept=".json,application/json" class="hidden"></div>' +
        '<div id="fd-found" style="margin-top:12px"></div>' +
        '<div id="st-box-imp" class="small" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div></div>';

    $$('input[name="fd-fmt"]').forEach(function (r) { r.checked = r.value === (folders ? "handoverdata" : "backup"); });
    $("#fd-back").addEventListener("click", function () { global.App.navigate("admin"); });

    $("#fd-export").addEventListener("click", async function () {
      var fmt = (document.querySelector('input[name="fd-fmt"]:checked') || {}).value || "backup";
      var parent = null;
      if (folders) {
        try { parent = await global.showDirectoryPicker({ mode: "readwrite", id: "handover-export" }); }
        catch (e) { return; }
      } else if (fmt === "handoverdata") { global.UI.toast(t("folder.noFolderApi"), "err"); return; }
      $("#fd-export").disabled = true;
      try {
        if (fmt === "handoverdata") { await exportHandoverData(parent, me); } else { await exportBackup(parent, me); }
      } catch (e) { global.UI.toast(t("err.write") + " " + ((e && e.message) || ""), "err"); }
      $("#fd-export").disabled = false;
    });

    function showFound(src) {
      if (!src) { $("#fd-found").innerHTML = '<p class="err-msg">' + esc(t("folder.notRecognised")) + "</p>"; return; }
      $("#fd-found").innerHTML =
        "<p>" + esc(t("move.found", {
          staff: num(src.users.length), areas: num(src.areas.length), tags: num(src.tags.length),
          handovers: num(src.counts.handovers), attachments: num(src.counts.attachments),
          arcE: num(src.counts.arcE), arcM: num(src.counts.arcM)
        })) + "</p>" +
        (src.kind === "backup" && !src.hasFiles && src.counts.attachments ? '<p class="small faint">' + esc(t("folder.noFilesImport")) + "</p>" : "") +
        '<button class="btn primary" id="fd-go">' + esc(t("move.start")) + "</button>";
      $("#fd-go").addEventListener("click", async function () {
        $("#fd-go").disabled = true;
        try { await runImport(src, me); } catch (e) { global.UI.toast(t("err.write"), "err"); }
      });
    }

    if ($("#fd-pick")) {
      $("#fd-pick").addEventListener("click", async function () {
        var root;
        try { root = await global.showDirectoryPicker({ mode: "read", id: "handover-import" }); } catch (e) { return; }
        $("#fd-found").innerHTML = '<p class="faint">' + esc(t("move.reading")) + "</p>";
        $("#st-box-imp").innerHTML = "";
        var bundle = await readJson(root, "plant-handover-backup.json");
        showFound(bundle ? backupSource(bundle, root) : await folderSource(root));
      });
    }
    $("#fd-pickfile").addEventListener("click", function () { $("#fd-file").click(); });
    $("#fd-file").addEventListener("change", async function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { return; }
      $("#st-box-imp").innerHTML = "";
      var bundle = null;
      try { bundle = JSON.parse(await f.text()); } catch (err) { bundle = null; }
      showFound(backupSource(bundle, null));
      $("#fd-file").value = "";
    });
  }

  function fmtOption(value, title, desc, disabled) {
    return '<label class="kind-opt"' + (disabled ? ' style="opacity:.5"' : "") + '>' +
      '<input type="radio" name="fd-fmt" value="' + value + '"' + (disabled ? " disabled" : "") + ">" +
      '<span class="kind-mark" aria-hidden="true"></span>' +
      '<span class="kind-body"><span class="kind-title">' + esc(title) + "</span>" +
        '<span class="kind-desc">' + esc(desc) + "</span></span></label>";
  }

  /* ================================================================== page: delete handovers */

  async function deletePage(query) {
    if (!S.isAdmin()) { global.App.navigate("admin"); return; }
    var st = S.structure();
    var people = S.users().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    function sel(id, opts) {
      return '<select class="input" id="' + id + '">' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>";
      }).join("") + "</select>";
    }
    function field(label, html) { return '<div class="field"><label>' + esc(label) + "</label>" + html + "</div>"; }

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("del2.title")) + "</h1><p>" + esc(t("del2.sub")) + "</p></div>" +
        '<div class="spacer"></div><button class="btn ghost" id="dl-back">' + esc(t("common.back")) + "</button></div>" +
      '<div class="card" style="max-width:820px"><h3>' + esc(t("del2.which")) + "</h3>" +
        '<div class="form-row">' +
          field(t("del2.db"), sel("dl-db", [["all", t("del2.dbAll")], ["engineers", t("view.pill.engineers")], ["managers", t("view.pill.managers")]])) +
          field(t("del2.source"), sel("dl-source", [["all", t("del2.srcAll")], ["archive", t("del2.srcArchive")], ["app", t("del2.srcApp")]])) +
        "</div>" +
        '<div class="form-row">' +
          field(t("del2.from"), '<input type="date" class="input" id="dl-from">') +
          field(t("del2.to"), '<input type="date" class="input" id="dl-to">') +
        "</div>" +
        '<div class="form-row">' +
          field(t("ho.area"), sel("dl-area", [["", t("del2.any")]].concat(st.areas.map(function (a) { return [a.id, a.en]; })))) +
          field(t("ho.createdBy"), sel("dl-author", [["", t("del2.anyone")]].concat(people.map(function (u) { return [u.id, u.name]; })))) +
        "</div>" +
        '<div class="form-row">' +
          field(t("ho.status"), sel("dl-status", [["", t("del2.any")], ["info", t("status.info")], ["info_followup", t("status.info_followup")], ["draft", t("status.draft")]])) +
          field(t("del2.q"), '<input class="input" id="dl-q" placeholder="' + esc(t("del2.qPh")) + '">') +
        "</div>" +
        field(t("del2.state"), sel("dl-state", [["active", t("del2.stActive")], ["deleted", t("del2.stDeleted")], ["any", t("del2.stAny")]])) +
        '<div class="btn-row"><button class="btn" id="dl-count">' + esc(t("del2.count")) + "</button>" +
          '<button class="btn ghost" id="dl-clear">' + esc(t("del2.reset")) + "</button></div>" +
        '<div id="dl-result" style="margin-top:12px"></div>' +
      "</div>" +

      '<div class="card" style="max-width:820px"><h3>' + esc(t("del2.how")) + ' <span class="req">*</span></h3>' +
        '<div class="kind-picker" role="radiogroup">' +
          modeOption("recoverable", t("del2.modeRec"), t("del2.modeRecDesc")) +
          modeOption("permanent", t("del2.modePerm"), t("del2.modePermDesc")) +
        "</div>" +
        '<div class="err-msg hidden" id="dl-mode-err"></div>' +
        '<p class="small faint" style="margin:12px 0 6px">' + esc(t("del2.exportFirst")) + "</p>" +
        '<div class="btn-row"><button class="btn" id="dl-export">' + esc(t("del2.exportBtn")) + "</button>" +
          '<button class="btn danger" id="dl-go" disabled>' + esc(t("del2.go")) + "</button></div>" +
        '<div id="dl-done" class="small" style="margin-top:12px"></div>' +
      "</div>";

    var lastCount = null;
    function filter() {
      return {
        db: $("#dl-db").value, source: $("#dl-source").value, state: $("#dl-state").value,
        from: $("#dl-from").value, to: $("#dl-to").value, area: $("#dl-area").value,
        author: $("#dl-author").value, status: $("#dl-status").value, q: $("#dl-q").value.trim()
      };
    }
    function chosenMode() { var r = document.querySelector('input[name="dl-mode"]:checked'); return r ? r.value : ""; }
    function stale() { lastCount = null; $("#dl-go").disabled = true; $("#dl-result").innerHTML = ""; }
    ["#dl-db", "#dl-source", "#dl-state", "#dl-from", "#dl-to", "#dl-area", "#dl-author", "#dl-status"].forEach(function (s) { $(s).addEventListener("change", stale); });
    $("#dl-q").addEventListener("input", stale);
    $$('input[name="dl-mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        $("#dl-mode-err").classList.add("hidden");
        // only permanent deletion applies to handovers already in "Deleted handovers"
        if (r.value === "recoverable" && $("#dl-state").value !== "active") { $("#dl-state").value = "active"; stale(); }
      });
    });
    $("#dl-back").addEventListener("click", function () { global.App.navigate("admin"); });
    if (query && query.state === "deleted") {
      // "Empty Deleted handovers": everything already in the bin, permanently
      $("#dl-state").value = "deleted";
      var perm = document.querySelector('input[name="dl-mode"][value="permanent"]');
      if (perm) { perm.checked = true; }
    }
    $("#dl-export").addEventListener("click", function () { global.App.navigate("move-data"); });
    $("#dl-clear").addEventListener("click", function () {
      ["#dl-from", "#dl-to", "#dl-q"].forEach(function (s) { $(s).value = ""; });
      ["#dl-area", "#dl-author", "#dl-status"].forEach(function (s) { $(s).value = ""; });
      $("#dl-db").value = "all"; $("#dl-source").value = "all"; $("#dl-state").value = "active";
      stale();
    });

    $("#dl-count").addEventListener("click", async function () {
      $("#dl-result").innerHTML = '<p class="faint small">' + esc(t("common.loading")) + "</p>";
      try {
        var c = await S.adminCount(filter());
        lastCount = c;
        $("#dl-result").innerHTML = "<p><b>" + esc(t("del2.matches", { n: num(c.total) })) + "</b></p>" +
          '<p class="small faint" style="margin:0">' + esc(t("del2.breakdown", {
            e: num(c.engineers), m: num(c.managers), a: num(c.archive), p: num(c.app), d: num(c.deleted), f: num(c.attachments)
          })) + "</p>";
        $("#dl-go").disabled = !c.total;
      } catch (e) { $("#dl-result").innerHTML = '<p class="err-msg">' + esc((e && e.message) || "") + "</p>"; }
    });

    $("#dl-go").addEventListener("click", async function () {
      var mode = chosenMode();
      if (!mode) {
        $("#dl-mode-err").textContent = t("del2.chooseMode");
        $("#dl-mode-err").classList.remove("hidden");
        return;
      }
      if (!lastCount || !lastCount.total) { return; }
      var f = filter();
      if (mode === "recoverable" && f.state !== "active") { f.state = "active"; }
      var n = num(lastCount.total);
      var ok;
      if (mode === "permanent") {
        var body = document.createElement("div");
        body.innerHTML = "<p>" + esc(t("del2.confirmPerm", { n: n })) + "</p>" +
          '<div class="field"><label>' + esc(t("del2.typeDelete")) + '</label><input class="input" id="dl-type" autocomplete="off"></div>' +
          '<div class="err-msg hidden" id="dl-type-err"></div>';
        ok = await global.UI.modal({
          title: t("del2.modePerm"), body: body,
          buttons: [
            { label: t("common.cancel"), value: null },
            { label: t("del2.goN", { n: n }), kind: "danger", value: true, before: function (b) {
                if ($("#dl-type", b).value.trim().toUpperCase() !== "DELETE") {
                  $("#dl-type-err", b).textContent = t("del2.typeWrong");
                  $("#dl-type-err", b).classList.remove("hidden");
                  return false;
                }
                return true;
              } }
          ]
        });
      } else {
        ok = await global.UI.confirm(t("del2.confirmRec", { n: n }), { title: t("del2.modeRec"), okLabel: t("del2.goN", { n: n }), danger: true });
      }
      if (!ok) { return; }
      global.UI.busy(true, t("del2.working", { n: 0 }));
      try {
        var res = await S.adminDelete(f, mode, function (k) {
          var el = document.getElementById("busy-label");
          if (el) { el.textContent = t("del2.working", { n: num(k) }); }
        });
        var msg = t(mode === "permanent" ? "del2.donePerm" : "del2.doneRec", { n: num(res.count) }) +
          (res.files ? " " + t("del2.filesRemoved", { n: num(res.files) }) : "") +
          (res.failedFiles ? " " + t("del2.filesLeft", { n: num(res.failedFiles) }) : "");
        $("#dl-done").innerHTML = "<b>" + esc(msg) + "</b>";
        global.UI.toast(msg, "ok");
        stale();
      } catch (e) { global.UI.toast(t("err.write") + " " + ((e && e.message) || ""), "err"); }
      global.UI.busy(false);
    });
  }

  function modeOption(value, title, desc) {
    return '<label class="kind-opt' + (value === "permanent" ? " kind-info_followup" : "") + '">' +
      '<input type="radio" name="dl-mode" value="' + value + '">' +
      '<span class="kind-mark" aria-hidden="true"></span>' +
      '<span class="kind-body"><span class="kind-title">' + esc(title) + "</span>" +
        '<span class="kind-desc">' + esc(desc) + "</span></span></label>";
  }

  global.MoveData = {
    page: page, deletePage: deletePage,
    // exposed for tests
    folderSource: folderSource, backupSource: backupSource, toOld: toOld, remapper: remapper
  };
})(window);
