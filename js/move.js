/* ==========================================================================
   move.js - Administration -> "Move data from the shared-folder app".
   Reads the HandoverData folder of the shared-folder app (Chrome/Edge on a
   PC: File System Access API) and copies everything into Supabase:
   staff & roles, areas, equipment tags, handovers with actions, comments and
   attachments, deleted handovers, and both old-sheet archives.
   Safe to repeat: rows keep (or derive) the same ids, so nothing is doubled.
   ========================================================================== */
(function (global) {
  "use strict";

  var S = global.Store;
  var t = global.t;
  var esc = global.Util.esc;

  function $(sel) { return document.querySelector(sel); }
  function view() { return document.getElementById("view"); }

  async function sub(dir, names) {
    var d = dir;
    for (var i = 0; i < names.length; i++) {
      try { d = await d.getDirectoryHandle(names[i]); } catch (e) { return null; }
    }
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

  /* ------------------------------------------------------------------ scan */

  async function scan(root) {
    var data = (await sub(root, ["data"])) || ((await sub(root, ["master"])) ? root : null);
    if (!data) { return null; }
    var master = await sub(data, ["master"]);
    var users = master ? await readJson(master, "users.json") : null;
    var structure = master ? await readJson(master, "structure.json") : null;
    var tags = master ? await readJson(master, "equipment_tags.json") : null;
    var hoDir = await sub(data, ["handovers"]);
    var delDir = await sub(data, ["deleted"]);
    var attDir = await sub(data, ["attachments"]);
    var arc = {};
    var arcCount = {};
    var dirs = { engineers: "archive", managers: "archive-managers" };
    for (var aud in dirs) {
      var d = await sub(data, [dirs[aud]]);
      var m = d ? await readJson(d, "manifest.json") : null;
      arc[aud] = m && Array.isArray(m.buckets) ? { dir: d, manifest: m } : null;
      arcCount[aud] = m ? Number(m.count) || 0 : 0;
    }
    var hoFiles = (await names(hoDir, "file")).filter(function (n) { return /\.json$/i.test(n); });
    var delFiles = (await names(delDir, "file")).filter(function (n) { return /\.json$/i.test(n); });
    var attFolders = await names(attDir, "directory");
    var attCount = 0;
    for (var i = 0; i < attFolders.length; i++) {
      attCount += (await names(await sub(attDir, [attFolders[i]]), "file")).length;
    }
    if (!users && !hoFiles.length && !arc.engineers && !arc.managers) { return null; }
    return {
      data: data, hoDir: hoDir, delDir: delDir, attDir: attDir, arc: arc,
      users: users && Array.isArray(users.users) ? users.users : [],
      areas: structure && Array.isArray(structure.areas) ? structure.areas : [],
      tags: tags && Array.isArray(tags.tags) ? tags.tags : (Array.isArray(tags) ? tags : []),
      hoFiles: hoFiles, delFiles: delFiles, attCount: attCount, arcCount: arcCount
    };
  }

  /* ------------------------------------------------------------------ staff */

  /* Old ids (e.g. "u-opr952") -> new staff ids, matched by employee id, then name. */
  async function moveStaff(oldUsers) {
    function findNew(u) {
      var emp = String(u.employeeId || "").trim().toLowerCase();
      var list = S.users();
      for (var i = 0; i < list.length; i++) {
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
      var row = {
        id: hit ? hit.id : null, name: hit ? hit.name : u.name,
        employeeId: u.employeeId || (hit ? hit.employeeId : ""),
        jobTitle: u.jobTitle || (hit ? hit.jobTitle : ""), department: u.department || (hit ? hit.department : ""),
        role: role, active: u.active !== false && u.active !== "False", isAdmin: hit ? hit.isAdmin : false
      };
      await S.upsertUser(row);
      if (hit) { updated++; } else { added++; }
      var now = findNew(u);
      if (now) { map[u.id] = now.id; }
    }
    // ids that are already new staff ids map to themselves (second run)
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

  /* ------------------------------------------------------------------ page */

  async function page() {
    var me = global.App.user();
    if (!S.isAdmin()) { global.App.navigate("admin"); return; }
    var supported = typeof global.showDirectoryPicker === "function";
    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("move.title")) + "</h1><p>" + esc(t("move.desc")) + "</p></div></div>" +
      '<div class="card" style="max-width:820px" id="mv-card">' +
        (supported
          ? '<button class="btn primary" id="mv-pick">' + esc(t("move.choose")) + "</button>"
          : '<p class="faint">' + esc(t("move.unsupported")) + "</p>") +
        '<div id="mv-body" style="margin-top:14px"></div>' +
      "</div>";
    if (!supported) { return; }

    $("#mv-pick").addEventListener("click", async function () {
      var root;
      try { root = await global.showDirectoryPicker({ mode: "read" }); }
      catch (e) { return; }
      $("#mv-body").innerHTML = '<p class="faint">' + esc(t("move.reading")) + "</p>";
      var found = await scan(root);
      if (!found) { $("#mv-body").innerHTML = '<p class="err-msg">' + esc(t("move.notFolder")) + "</p>"; return; }
      $("#mv-body").innerHTML =
        "<p>" + esc(t("move.found", {
          staff: global.Fmt.num(found.users.length), areas: global.Fmt.num(found.areas.length),
          tags: global.Fmt.num(found.tags.length), handovers: global.Fmt.num(found.hoFiles.length + found.delFiles.length),
          attachments: global.Fmt.num(found.attCount), arcE: global.Fmt.num(found.arcCount.engineers),
          arcM: global.Fmt.num(found.arcCount.managers)
        })) + "</p>" +
        '<button class="btn primary" id="mv-go">' + esc(t("move.start")) + "</button>" +
        '<div id="mv-steps" class="small" style="margin-top:14px;display:flex;flex-direction:column;gap:6px"></div>';
      $("#mv-go").addEventListener("click", function () { $("#mv-go").disabled = true; $("#mv-pick").disabled = true; run(found, me); });
    });
  }

  function stepRow(key) {
    var box = $("#mv-steps");
    var el = document.getElementById("mv-" + key);
    if (!el && box) {
      el = document.createElement("div");
      el.id = "mv-" + key;
      box.appendChild(el);
    }
    return function (state, detail) {
      if (!el) { return; }
      var icon = state === "ok" ? "✓" : state === "err" ? "✗" : "···";
      var color = state === "ok" ? "var(--success)" : state === "err" ? "var(--danger)" : "var(--text-faint)";
      el.innerHTML = '<b style="color:' + color + ';display:inline-block;width:18px">' + icon + "</b>" +
        esc(t("move.step." + key)) + (detail ? ' <span class="faint">— ' + esc(detail) + "</span>" : "");
    };
  }

  var archiveOverrides = {}, archiveDeleted = {};

  async function run(found, me) {
    var total = 0;
    var map = {};
    var remap = null;
    async function step(key, fn) {
      var paint = stepRow(key);
      paint("run");
      try { var detail = await fn(function (d) { paint("run", d); }); paint("ok", detail || ""); return true; }
      catch (e) { S.log("move", key, e && e.message); paint("err", (e && e.message) || String(e)); return false; }
    }

    var ok = await step("staff", async function () {
      var r = await moveStaff(found.users);
      map = r.map;
      remap = remapper(map);
      return "+" + r.added + " / " + r.updated;
    });
    if (!ok) { return; }

    await step("areas", async function () { return "+" + (await S.addAreas(found.areas)); });

    await step("tags", async function () {
      if (!found.tags.length) { return "0"; }
      var r = await S.importTags(found.tags);
      return "+" + r.added + " / " + r.updated;
    });

    var moved = [];
    await step("handovers", async function (progress) {
      var files = found.hoFiles.map(function (n) { return { dir: found.hoDir, name: n, deleted: false }; })
        .concat(found.delFiles.map(function (n) { return { dir: found.delDir, name: n, deleted: true }; }));
      var batch = [], skipped = 0;
      archiveOverrides = {}; archiveDeleted = {};
      async function flush() {
        if (!batch.length) { return; }
        var ids = await S.moveRecords(batch);
        batch.forEach(function (rec, i) { moved.push({ rec: rec, id: ids[i] }); });
        batch = [];
        progress(global.Fmt.num(moved.length) + " / " + global.Fmt.num(files.length));
      }
      for (var i = 0; i < files.length; i++) {
        var rec = await readJson(files[i].dir, files[i].name);
        if (rec && rec.record && typeof rec.record === "object") {
          // deleted handovers are kept as { id, deletedAt, deletedBy, record: {...} }
          var wrap = rec;
          rec = Object.assign({}, wrap.record, { deletedAt: wrap.deletedAt, deletedBy: wrap.deletedBy });
        }
        if (!rec || !rec.id) { skipped++; continue; }
        if (files[i].deleted && !rec.deletedAt) { rec.deletedAt = rec.updatedAt || new Date().toISOString(); }
        if (rec.archived || S.isArchiveId(rec.id)) {
          // an old-sheet entry someone commented on / added actions to: it replaces
          // the copy in the archive files; a deleted one is deleted after the archive move
          if (rec.deletedAt) { archiveDeleted[rec.id] = rec; } else { archiveOverrides[rec.id] = rec; }
          continue;
        }
        batch.push(remap(rec));
        if (batch.length >= 100) { await flush(); }
      }
      await flush();
      total += moved.length;
      return global.Fmt.num(moved.length) + (skipped ? " · " + t("move.skipped", { n: skipped }) : "");
    });

    await step("attachments", async function (progress) {
      var withFiles = moved.filter(function (m) { return (m.rec.attachments || []).length; });
      if (!withFiles.length || !found.attDir) { return "0"; }
      var have = await S.attachmentIdsOf(withFiles.map(function (m) { return m.id; }));
      var done = 0, skipped = 0, missing = 0;
      for (var i = 0; i < withFiles.length; i++) {
        var m = withFiles[i];
        var dir = await sub(found.attDir, [m.rec.id]);
        for (var j = 0; j < m.rec.attachments.length; j++) {
          var att = m.rec.attachments[j];
          var aid = S.keepOrDerive(att.id, "f:" + m.id + ":" + (att.stored || att.name));
          if (have[aid]) { skipped++; continue; }
          var file = dir ? await readFile(dir, att.stored || att.name) : null;
          if (!file) { missing++; continue; }
          await S.moveAttachment(m.id, att, file);
          done++;
          progress(global.Fmt.num(done));
        }
      }
      return global.Fmt.num(done) + (skipped ? " · " + t("move.skipped", { n: skipped }) : "") +
        (missing ? " · " + missing + " missing" : "");
    });

    var arcSteps = { engineers: "archiveE", managers: "archiveM" };
    for (var aud in arcSteps) {
      /* eslint-disable no-loop-func */
      await step(arcSteps[aud], (function (audience) {
        return async function (progress) {
          var a = found.arc[audience];
          if (!a) { return "0"; }
          var records = [], seen = {};
          for (var i = 0; i < a.manifest.buckets.length; i++) {
            var file = await readJson(a.dir, a.manifest.buckets[i] + ".json");
            if (file && Array.isArray(file.records)) {
              file.records.forEach(function (r) {
                if (!r || !r.id) { return; }
                seen[r.id] = true;
                records.push(remap(archiveOverrides[r.id] || r));
              });
            }
            progress(a.manifest.buckets[i]);
          }
          Object.keys(archiveOverrides).forEach(function (id) {
            if (!seen[id] && S.audienceOfId(id) === audience) { records.push(remap(archiveOverrides[id])); }
          });
          var res = await S.importArchive({ kind: "plant-handover-archive", audience: audience, records: records, areas: [] },
            me ? me.name : "", function (n, of) { progress(n + " / " + of); }, audience);
          total += res.count;
          var gone = Object.keys(archiveDeleted).filter(function (id) { return S.audienceOfId(id) === audience; });
          if (gone.length) { await S.deleteByLegacyIds(gone, me); }
          return global.Fmt.num(res.count) + (gone.length ? " \u00b7 " + gone.length + " deleted" : "");
        };
      })(aud));
    }

    S.invalidate();
    try {
      await S.addNotification({ type: "import", actor: { id: me.id, name: me.name }, handoverId: "", title: t("move.title"), count: total });
    } catch (e) { /* the move itself is done */ }
    var box = $("#mv-steps");
    if (box) {
      var end = document.createElement("p");
      end.style.marginTop = "10px";
      end.innerHTML = "<b>" + esc(t("move.done", { n: global.Fmt.num(total) })) + "</b>";
      box.appendChild(end);
    }
    global.UI.toast(t("move.done", { n: global.Fmt.num(total) }), "ok");
    var pick = $("#mv-pick");
    if (pick) { pick.disabled = false; }
  }

  global.MoveData = { page: page, scan: scan, remapper: remapper };
})(window);
