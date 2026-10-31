/* ==========================================================================
   views.js - every screen in the app.
   Each render function paints into #view and then wires its own events.
   ========================================================================== */
(function (global) {
  "use strict";

  var esc = global.Util.esc;
  var t = global.t;
  var S = global.Store;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function view() { return document.getElementById("view"); }
  function go(path) { global.App.navigate(path); }

  /* ------------------------------------------------------- shared renderers */

  function statusBadge(status) {
    return '<span class="badge s-' + esc(status) + '">' + esc(t("status." + status)) + "</span>";
  }

  function personName(p) {
    if (!p) { return "—"; }
    return p.name || "—";
  }

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/);
    var s = (parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "");
    return s.toUpperCase();
  }

  function lookup(list, id) {
    for (var i = 0; i < (list || []).length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function label(list, id) {
    var item = lookup(list, id);
    return item ? (item.en) : (id || "—");
  }

  function tagDesc(tag) {
    if (!tag) { return ""; }
    return (tag.descEn);
  }

  function tagChip(no, opts) {
    opts = opts || {};
    return '<span class="tag-chip' + (opts.link ? " link" : "") + '"' +
      (opts.link ? ' data-tag="' + esc(no) + '"' : "") + ">" + esc(no) +
      (opts.removable ? ' <span class="x" data-remove="' + esc(no) + '">×</span>' : "") +
      "</span>";
  }

  /* The author owns their handover. Everyone else can comment and attach,
     but not change what was written. Administration is the escape hatch for
     a record whose author has left. */
  function canEditHandover(rec) {
    if (S.isAdmin()) { return true; }
    if (rec && rec.archived) { return false; }
    var me = global.App.user();
    return !!(me && rec && rec.createdBy && rec.createdBy.id === me.id);
  }

  function emptyBlock(message) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 24 24" width="42" height="42"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zM7 12h10v2H7zm0-4h10v2H7zm0 8h7v2H7z"/></svg>' +
      "<p>" + esc(message) + "</p></div>";
  }

  function handoverCard(h) {
    var st = S.structure();
    var tagHtml = (h.tags || []).slice(0, 4).map(function (no) { return tagChip(no); }).join(" ");
    var more = (h.tags || []).length > 4 ? ' <span class="faint small">+' + ((h.tags || []).length - 4) + "</span>" : "";
    var when = (h.archived || (h.importedFrom && h.updatedAt === h.createdAt))
      ? (h.createdAt ? global.Fmt.date(h.createdAt) : t("arc.dateUnknown"))
      : global.Fmt.ago(h.updatedAt);
    var place = h.area ? label(st.areas, h.area) : (h.location || "");
    return '<div class="row-card" data-id="' + esc(h.id) + '">' +
      '<div class="r1">' +
        "<h4>" + esc(h.title || "—") + "</h4>" +
        (unseenSet[h.id] ? '<span class="badge s-unseen">' + esc(t("ho.unseenBadge")) + "</span>" : "") +
        statusBadge(h.status) +
        (h.archived ? archiveBadge(h) : "") +
        (h.restricted && !inMgrView() ? restrictedBadge() : "") +
      "</div>" +
      (h.snippet ? '<div class="snippet">' + esc(h.snippet) + "</div>" : "") +
      '<div class="r2">' +
        "<span>" + esc(personName(h.createdBy)) + "</span>" +
        "<span>" + esc(when) + "</span>" +
        (place ? "<span>" + esc(place) + "</span>" : "") +
        (h.commentCount ? "<span>\u{1F4AC} " + global.Fmt.num(h.commentCount) + "</span>" : "") +
        (h.attachmentCount ? "<span>\u{1F4CE} " + global.Fmt.num(h.attachmentCount) + "</span>" : "") +
        (h.openActions ? '<span class="act-count">' + esc(t("act.openCount", { n: global.Fmt.num(h.openActions) })) + "</span>" : "") +
      "</div>" +
      "<div class=\"chips\" style=\"margin-top:8px\">" + tagHtml + more + "</div>" +
      "</div>";
  }

  /* Actions required: open ones first, then done, then those copied from
     the old sheets (whose outcome is not known). */
  function actionLabel(a) {
    if (a.status === "done") { return t("act.doneBy", { name: personName(a.doneBy), date: global.Fmt.dateTime(a.doneAt) }); }
    if (a.status === "old") { return t("act.fromOld"); }
    return t("act.addedBy", { name: personName(a.by), date: a.at ? global.Fmt.dateTime(a.at) : "" });
  }
  function actionOrder(a) { return a.status === "open" ? 0 : a.status === "done" ? 1 : 2; }

  function restrictedBadge() {
    return '<span class="badge s-restricted" title="' + esc(t("mgr.notice")) + '"><svg viewBox="0 0 24 24" width="11" height="11" style="vertical-align:-1px;margin-inline-end:3px"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9z"/></svg>' + esc(t("mgr.badge")) + "</span>";
  }

  /* Manager views: which database the signed-in manager is looking at. */
  function isMgr() { return !!(global.App.isManager && global.App.isManager()); }
  function inMgrView() { return isMgr() && S.getView() === "managers"; }
  function viewPill() {
    if (!isMgr()) { return ""; }
    var v = S.getView();
    return '<span class="view-pill v-' + v + '">' + esc(t("view.pill." + v)) + "</span>";
  }
  function viewSub(fallback) {
    return isMgr() ? t(S.getView() === "managers" ? "view.subMgr" : "view.subEng") : fallback;
  }
  var LOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9z"/></svg>';

  function archiveBadge(h) {
    var text = t("arc.badge");
    return '<span class="badge" style="background:var(--bg-sunken);color:var(--text-soft)">' + esc(text) + "</span>";
  }

  function wireCards(root) {
    $$(".row-card", root).forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest("[data-tag]")) { return; }
        go("#/handover/" + el.getAttribute("data-id"));
      });
    });
    $$("[data-tag]", root).forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        go("#/equipment/" + encodeURIComponent(el.getAttribute("data-tag")));
      });
    });
  }

  /* ============================== DASHBOARD ============================== */

  async function dashboard() {
    view().innerHTML = '<div class="empty">' + esc(t("common.loading")) + "</div>";
    var all = await S.listHandovers();
    var st = S.structure();
    var me = global.App.user();
    var today = global.Fmt.isoDay(new Date());
    var weekFrom = daysAgo(6), monthFrom = daysAgo(29);
    function within(h, from) {
      return h.status !== "draft" && h.createdAt && global.Fmt.isoDay(h.createdAt) >= from;
    }

    var submittedToday = all.filter(function (h) {
      return !h.archived && h.createdAt && global.Fmt.isoDay(h.createdAt) === today && h.status !== "draft";
    });
    var lastWeek = all.filter(function (h) { return within(h, weekFrom); });
    var lastMonth = all.filter(function (h) { return within(h, monthFrom); });
    var followUps = lastMonth.filter(function (h) { return h.status === S.FOLLOWUP; });
    var withActions = all.filter(function (h) { return h.openActions > 0; });
    function mine(h) { return me && h.createdBy && h.createdBy.id === me.id; }
    var myDrafts = all.filter(function (h) { return h.status === "draft" && mine(h); });
    var mySubmitted = all.filter(function (h) { return h.status !== "draft" && mine(h); });
    var unseen = await unseenIds(true);
    var notSeen = all.filter(function (h) { return unseen[h.id]; });

    var byArea = {}, byType = {};
    lastMonth.forEach(function (h) {
      if (h.area) { byArea[h.area] = (byArea[h.area] || 0) + 1; }
      (h.tags || []).forEach(function (no) {
        var tag = S.tagByNumber(no);
        if (tag && tag.type) { byType[tag.type] = (byType[tag.type] || 0) + 1; }
      });
    });

    function countRows(map, list) {
      var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
      if (!keys.length) { return '<p class="faint small">' + esc(t("common.none")) + "</p>"; }
      var max = map[keys[0]] || 1;
      return keys.map(function (k) {
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">' +
          '<span class="small" style="flex:0 0 150px">' + esc(label(list, k)) + "</span>" +
          '<span style="flex:1 1 auto;height:8px;border-radius:4px;background:var(--bg-sunken);overflow:hidden">' +
            '<span style="display:block;height:100%;width:' + Math.round((map[k] / max) * 100) + '%;background:var(--accent)"></span>' +
          "</span>" +
          '<b class="small" style="flex:0 0 26px;text-align:end">' + global.Fmt.num(map[k]) + "</b>" +
        "</div>";
      }).join("");
    }

    var recentTags = {};
    all.slice(0, 40).forEach(function (h) {
      (h.tags || []).forEach(function (no) { if (!recentTags[no]) { recentTags[no] = h.updatedAt; } });
    });
    var recentTagList = Object.keys(recentTags).slice(0, 12);

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("dash.title")) + viewPill() + "</h1><p>" + esc(viewSub(t("dash.sub"))) + "</p></div>" +
        '<div class="spacer"></div>' +
        '<button class="btn primary" id="new-ho">' + esc(t("ho.new")) + "</button>" +
      "</div>" +

      '<div class="grid stats">' +
        stat(submittedToday.length, t("dash.submittedToday"), "#/handovers?d=today") +
        stat(lastWeek.length, t("dash.lastWeek"), "#/handovers?d=week") +
        stat(followUps.length, t("dash.followUps"), "#/handovers?s=" + S.FOLLOWUP + "&d=month") +
        stat(withActions.length, t("dash.openActions"), "#/handovers?s=actions") +
        stat(mySubmitted.length, t("dash.mySubmitted"), "#/handovers?s=notdraft&mine=1") +
        stat(myDrafts.length, t("dash.myDrafts"), "#/handovers?s=draft&mine=1") +
        stat(notSeen.length, t("dash.notSeen"), "#/handovers?s=unseen", notSeen.length > 0 ? "attn" : "") +
      "</div>" +

      '<div class="grid two" style="margin-top:16px">' +
        '<div class="card"><h3>' + esc(t("dash.byArea")) + "</h3>" + countRows(byArea, st.areas) + "</div>" +
        '<div class="card"><h3>' + esc(t("dash.byType")) + "</h3>" + countRows(byType, st.equipmentTypes) + "</div>" +
      "</div>" +

      '<div class="card" style="margin-top:16px"><h3>' + esc(t("dash.recentTags")) + "</h3>" +
        (recentTagList.length
          ? '<div class="chips">' + recentTagList.map(function (no) { return tagChip(no, { link: true }); }).join(" ") + "</div>"
          : '<p class="faint small">' + esc(t("common.none")) + "</p>") +
      "</div>" +

      '<h3 style="margin:22px 0 10px">' + esc(t("dash.recent")) + "</h3>" +
      (all.length
        ? '<div class="list">' + all.slice(0, 8).map(handoverCard).join("") + "</div>"
        : emptyBlock(t("dash.empty")));

    $("#new-ho").addEventListener("click", function () { go("#/handover/new"); });
    $$(".stat").forEach(function (el) {
      el.addEventListener("click", function () { go(el.getAttribute("data-go")); });
    });
    wireCards(view());
  }

  /* yyyy-mm-dd of the day n days before today (local time). */
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return global.Fmt.isoDay(d);
  }

  function stat(n, labelText, href, alert) {
    var cls = alert === true ? " alert" : (alert ? " " + alert : "");
    return '<div class="stat' + cls + '" data-go="' + esc(href) + '">' +
      '<div class="n">' + global.Fmt.num(n) + "</div>" +
      '<div class="l">' + esc(labelText) + "</div></div>";
  }

  /* ============================ HANDOVER LIST ============================ */

  var listFilters = { q: "", status: "", area: "", from: "", to: "", creator: "", worked: "", tag: "", src: "", mine: false };
  var LIST_PAGE = 200;
  var lastListRows = [];

  async function handoverList(query) {
    var st = S.structure();
    var all = await S.listHandovers();

    if (query) {
      if (query.s && (S.STATUSES.indexOf(query.s) >= 0 || query.s === "notdraft" || query.s === "unseen" || query.s === "actions")) { listFilters.status = query.s; }
      if (query.d === "today") { listFilters.from = global.Fmt.isoDay(new Date()); listFilters.to = ""; }
      if (query.tag) { listFilters.q = query.tag; }
      if (query.d === "week") { listFilters.from = daysAgo(6); listFilters.to = ""; }
      if (query.d === "month") { listFilters.from = daysAgo(29); listFilters.to = ""; }
      if (query.mine && global.App.user()) { listFilters.creator = global.App.user().id; }
    }

    var statusOptions = ['<option value="">' + esc(t("ho.status")) + " \u2013 " + esc(t("common.all")) + "</option>",
      '<option value="unseen">' + esc(t("ho.unseen")) + "</option>",
      '<option value="actions">' + esc(t("act.filter")) + "</option>",
      '<option value="notdraft">' + esc(t("ho.notDraft")) + "</option>"]
      .concat(S.STATUSES.map(function (s) { return '<option value="' + s + '">' + esc(t("status." + s)) + "</option>"; }))
      .join("");

    var hasArchive = all.some(function (h) { return h.archived; });
    var unseen = await unseenIds(true);
    var shown = LIST_PAGE;

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("ho.list")) + viewPill() + "</h1><p>" + esc(viewSub(t("ho.listSub"))) + "</p></div>" +
        '<div class="spacer"></div><div class="btn-row">' +
          '<button class="btn" id="imp-open">' + esc(t("imp.open")) + "</button>" +
          '<button class="btn primary" id="new-ho">' + esc(t("ho.new")) + "</button></div></div>" +

      '<div class="filters">' +
        '<input type="search" id="f-q" placeholder="' + esc(t("search.placeholder")) + '" style="min-width:230px">' +
        '<select id="f-status">' + statusOptions + "</select>" +
        '<select id="f-area"><option value="">' + esc(t("ho.area")) + " – " + esc(t("common.all")) + "</option>" +
          st.areas.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc((a.en)) + "</option>"; }).join("") + "</select>" +
        '<select id="f-worked" title="' + esc(t("ho.workedBy")) + '"><option value="">' + esc(t("ho.workedBy")) + " \u2013 " + esc(t("common.anyone")) + "</option>" +
          peopleOptions(listFilters.worked) + "</select>" +
        '<input type="date" id="f-from" title="' + esc(t("ho.from")) + '">' +
        '<input type="date" id="f-to" title="' + esc(t("ho.to")) + '">' +
        '<input id="f-tag" placeholder="' + esc(t("ho.filterTag")) + '" style="min-width:140px">' +
        (hasArchive
          ? '<select id="f-src" title="' + esc(t("arc.filter")) + '">' +
              '<option value="">' + esc(t("arc.filterAll")) + "</option>" +
              '<option value="live">' + esc(t("arc.filterLive")) + "</option>" +
              '<option value="archive">' + esc(t("arc.filterArchive")) + "</option></select>"
          : "") +
        '<button class="btn sm ghost" id="f-clear">' + esc(t("common.clear")) + "</button>" +
        '<button class="btn sm" id="f-export">' + esc(t("ho.exportCsv")) + "</button>" +
      "</div>" +
      '<div id="f-chips" class="chips" style="margin:-4px 0 12px"></div>' +
      '<div id="ho-results"></div>';

    $("#f-q").value = listFilters.q;
    $("#f-status").value = listFilters.status;
    $("#f-area").value = listFilters.area;
    $("#f-worked").value = listFilters.worked;
    $("#f-from").value = listFilters.from;
    $("#f-to").value = listFilters.to;
    $("#f-tag").value = listFilters.tag;
    if ($("#f-src")) { $("#f-src").value = listFilters.src; }

    function apply() {
      listFilters.q = $("#f-q").value;
      listFilters.status = $("#f-status").value;
      listFilters.area = $("#f-area").value;
      listFilters.worked = $("#f-worked").value;
      listFilters.from = $("#f-from").value;
      listFilters.to = $("#f-to").value;
      listFilters.tag = $("#f-tag").value;
      listFilters.src = $("#f-src") ? $("#f-src").value : "";
      shown = LIST_PAGE;
      render();
    }

    function render() {
      var q = global.Util.normalize(listFilters.q);
      var now = new Date();
      var rows = all.filter(function (h) {
        if (listFilters.status === "unseen") { if (!unseen[h.id]) { return false; } }
        else if (listFilters.status === "actions") { if (!(h.openActions > 0)) { return false; } }
        else if (listFilters.status === "notdraft") { if (h.status === "draft") { return false; } }
        else if (listFilters.status && h.status !== listFilters.status) { return false; }

        if (listFilters.area && h.area !== listFilters.area) { return false; }
        if (listFilters.creator && (!h.createdBy || h.createdBy.id !== listFilters.creator)) { return false; }
        if (listFilters.worked) {
          var byAuthor = h.createdBy && h.createdBy.id === listFilters.worked;
          if (!byAuthor && (h.teamIds || []).indexOf(listFilters.worked) < 0) { return false; }
        }
        if (listFilters.src === "live" && h.archived) { return false; }
        if (listFilters.src === "archive" && !h.archived) { return false; }
        if ((listFilters.from || listFilters.to) && !h.createdAt) { return false; }
        if (listFilters.from && global.Fmt.isoDay(h.createdAt) < listFilters.from) { return false; }
        if (listFilters.to && global.Fmt.isoDay(h.createdAt) > listFilters.to) { return false; }
        if (listFilters.tag) {
          var want = global.Util.normalize(listFilters.tag);
          var onTag = (h.tags || []).some(function (n) { return global.Util.normalize(n).indexOf(want) >= 0; });
          if (!onTag) { return false; }
        }
        if (q && S.searchText(h).indexOf(q) < 0) { return false; }
        return true;
      });

      lastListRows = rows;
      // "Written by" comes only from the dashboard tile, so show it as a chip
      // that can be removed rather than as another dropdown.
      var author = listFilters.creator ? S.userById(listFilters.creator) : null;
      $("#f-chips").innerHTML = listFilters.creator
        ? '<span class="tag-chip" style="font-family:inherit">' + esc(t("ho.writtenBy")) + ": " +
            esc(author ? personName(author) : listFilters.creator) + ' <span class="x" id="f-creator-x">\u00d7</span></span>'
        : "";
      if ($("#f-creator-x")) {
        $("#f-creator-x").addEventListener("click", function () { listFilters.creator = ""; shown = LIST_PAGE; render(); });
      }
      // Thousands of imported entries would make one giant page, so draw a
      // page at a time. Filters and the CSV export still cover every match.
      var visible = rows.slice(0, shown);
      $("#ho-results").innerHTML =
        '<p class="small faint" style="margin:0 0 10px">' + esc(t("ho.results", { n: global.Fmt.num(rows.length) })) +
          (rows.length > visible.length ? " \u00b7 " + esc(t("arc.showing", { shown: global.Fmt.num(visible.length), n: global.Fmt.num(rows.length) })) : "") +
        "</p>" +
        (rows.length ? '<div class="list">' + visible.map(handoverCard).join("") + "</div>"
                     : emptyBlock(all.length ? t("ho.none") : t("ho.noneYet"))) +
        (rows.length > visible.length
          ? '<div style="text-align:center;margin:14px 0"><button class="btn" id="ho-more">' +
              esc(t("arc.showMore", { n: global.Fmt.num(Math.min(LIST_PAGE, rows.length - visible.length)) })) + "</button></div>"
          : "");
      wireCards($("#ho-results"));
      if ($("#ho-more")) {
        $("#ho-more").addEventListener("click", function () { shown += LIST_PAGE; render(); });
      }
    }

    $("#f-q").addEventListener("input", global.Util.debounce(apply, 220));
    ["#f-status", "#f-area", "#f-worked", "#f-from", "#f-to", "#f-src"].forEach(function (sel) {
      if ($(sel)) { $(sel).addEventListener("change", apply); }
    });
    $("#f-tag").addEventListener("input", global.Util.debounce(apply, 220));
    $("#f-clear").addEventListener("click", function () {
      listFilters = { q: "", status: "", area: "", from: "", to: "", creator: "", worked: "", tag: "", src: "", mine: false };
      handoverList(null);
    });
    $("#f-export").addEventListener("click", function () { exportHandovers(lastListRows); });
    $("#imp-open").addEventListener("click", function () { go("#/handover/import"); });
    $("#new-ho").addEventListener("click", function () { go("#/handover/new"); });

    render();
  }

  /* ------------------------------------------------------------- CSV export */

  function csvCell(v) {
    var str = (v === null || v === undefined) ? "" : String(v);
    if (/[",;\n\r]/.test(str)) { return '"' + str.replace(/"/g, '""') + '"'; }
    return str;
  }

  function downloadCsv(filename, head, rows) {
    var lines = [head].concat(rows).map(function (r) { return r.map(csvCell).join(","); });
    // The BOM makes Excel read the file as UTF-8 (degree signs, µ, etc.).
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* Exports whatever the list filters currently match - date range, creator,
     area, equipment tag, status or free text. */
  async function exportHandovers(headers) {
    if (!headers || !headers.length) { global.UI.toast(t("ho.exportNone")); return; }
    global.UI.busy(true, t("ho.exportPreparing"));
    try {
      var st = S.structure();
      var rows = [];
      var fullById = {};
      (await S.getHandovers(headers.map(function (h) { return h.id; }))).forEach(function (r) { fullById[r.id] = r; });
      for (var i = 0; i < headers.length; i++) {
        var rec = fullById[headers[i].id] || headers[i];
        var upper = upperOf(rec.tags);
        rows.push([
          rec.id,
          rec.title || "",
          t("status." + rec.status) + (rec.legacyStatus && !/^(info|info \+ follow up|follow up)$/i.test(rec.legacyStatus) ? " (" + rec.legacyStatus + ")" : ""),
          rec.area ? label(st.areas, rec.area) : (rec.location || ""),
          personName(rec.createdBy),
          rec.archived ? (rec.createdAt ? global.Fmt.date(rec.createdAt) : "") : global.Fmt.dateTime(rec.createdAt),
          rec.archived && !rec.createdAt ? "" : global.Fmt.dateTime(rec.updatedAt),
          rec.dueDate ? global.Fmt.date(rec.dueDate) : "",
          (rec.tags || []).join(" | "),
          upper === "\u2014" ? "" : upper,
          (rec.team || []).map(function (m) { return personName(m); }).join(" | "),
          (rec.attachments || []).length,
          rec.description || "",
          (rec.actions || []).map(function (a) {
            return a.text + " [" + t("act.st." + (a.status || "open")) + (a.status === "done" ? ": " + personName(a.doneBy) + " " + global.Fmt.date(a.doneAt) : "") + "]";
          }).join(" | "),
          (rec.comments || []).map(function (c) {
            return personName(c.by) + " (" + global.Fmt.date(c.at) + "): " + c.text;
          }).join(" | ")
        ]);
      }
      downloadCsv("handovers-" + global.Fmt.isoDay(new Date()) + ".csv", [
        t("csv.id"), t("ho.title"), t("ho.status"), t("ho.area"), t("ho.createdBy"),
        t("ho.createdAt"), t("ho.updatedAt"), t("ho.due"), t("ho.tags"), t("eq.upper"),
        t("ho.team"), t("ho.attachments"), t("ho.description"), t("act.label"), t("ho.comments")
      ], rows);
      global.UI.toast(t("ho.exportDone", { n: global.Fmt.num(rows.length) }), "ok");
    } catch (e) {
      global.UI.toast(t("err.read"), "err");
    }
    global.UI.busy(false);
  }

  function audOption(value, title, desc) {
    return '<label class="kind-opt aud-' + value + '">' +
      '<input type="radio" name="f-aud" value="' + value + '">' +
      '<span class="kind-mark" aria-hidden="true"></span>' +
      '<span class="kind-body"><span class="kind-title">' + esc(title) + "</span>" +
        '<span class="kind-desc">' + esc(desc) + "</span></span>" +
      "</label>";
  }
  var formViewHook = null;

  function kindOption(value, title, desc) {
    return '<label class="kind-opt kind-' + value + '">' +
      '<input type="radio" name="f-kind" value="' + value + '">' +
      '<span class="kind-mark" aria-hidden="true"></span>' +
      '<span class="kind-body"><span class="kind-title">' + esc(title) + "</span>" +
        '<span class="kind-desc">' + esc(desc) + "</span></span>" +
      "</label>";
  }

  /* People grouped by role, for the "Worked on by" filter. */
  function peopleOptions(selected) {
    var groups = [
      { label: t("ho.engineers"), roles: ["engineer"] },
      { label: t("ho.managers"), roles: ["manager"] },
      { label: t("ho.supervisors"), roles: ["supervisor"] },
      { label: t("ho.technicians"), roles: ["technician"] },
      { label: t("ho.others"), roles: ["administrator", "viewer", ""] }
    ];
    var list = S.users().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return groups.map(function (g) {
      var members = list.filter(function (u) { return g.roles.indexOf(u.role || "") >= 0; });
      if (!members.length) { return ""; }
      return '<optgroup label="' + esc(g.label) + '">' + members.map(function (u) {
        return '<option value="' + esc(u.id) + '"' + (u.id === selected ? " selected" : "") + ">" +
          esc(personName(u)) + (u.active === false ? " (" + esc(t("ho.inactive")) + ")" : "") + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
  }

  function teamDropdownShell(prefix, label) {
    return '<div class="dropdown">' +
      '<button type="button" class="btn dd-btn" id="' + prefix + '-btn">' + esc(label) + "</button>" +
      '<div class="dropdown-panel hidden" id="' + prefix + '-panel"></div></div>';
  }

  /* ============================ HANDOVER FORM ============================ */

  async function handoverForm(id) {
    var st = S.structure();
    var isNew = !id || id === "new";
    var rec = null;

    if (!isNew) {
      rec = await S.getHandover(id);
      if (!rec) { view().innerHTML = emptyBlock(t("err.notFound")); return; }
      if (!canEditHandover(rec)) { view().innerHTML = emptyBlock(t(rec.archived ? "arc.cannotEdit" : "own.cannotEdit")); return; }
      var lock = await S.readLock(id);
      var me = global.App.user();
      if (lock && lock.by && me && lock.by !== me.id) {
        var proceed = await global.UI.confirm(
          t("ho.lockedBy", { name: lock.name, time: global.Fmt.time(lock.at) }),
          { okLabel: t("ho.lockedTakeOver") }
        );
        if (!proceed) { go("#/handover/" + id); return; }
      }
      await S.writeLock(id, global.App.user());
    }

    var chosenTags = rec ? (rec.tags || []).slice() : [];
    var chosenActions = rec ? JSON.parse(JSON.stringify(rec.actions || [])) : [];
    var chosenTeam = rec ? (rec.team || []).slice() : [];

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(isNew ? t("ho.new") : t("ho.edit")) + "</h1></div>" +
        (isNew ? '<div class="spacer"></div><button class="btn ghost" id="f-import">' + esc(t("imp.open")) + "</button>" : "") +
      "</div>" +
      '<div class="card" style="max-width:840px">' +
        '<div class="field"><label>' + esc(t("ho.title")) + ' <span class="req">*</span></label>' +
          '<input class="input" id="f-title" maxlength="160" placeholder="' + esc(t("ho.titlePh")) + '">' +
          '<div class="err-msg hidden" id="e-title"></div></div>' +

        '<div class="field"><label>' + esc(t("ho.description")) + ' <span class="req">*</span></label>' +
          '<textarea class="input" id="f-desc" rows="7" placeholder="' + esc(t("ho.descriptionPh")) + '"></textarea>' +
          '<div class="err-msg hidden" id="e-desc"></div></div>' +

        '<div class="field"><label>' + esc(t("act.label")) + ' <span class="faint">(' + esc(t("common.optional")) + ')</span></label>' +
          '<div class="act-list" id="act-edit"></div>' +
          '<div class="act-add-row"><input class="input" id="act-input" maxlength="400" placeholder="' + esc(t("act.ph")) + '">' +
            '<button class="btn" type="button" id="act-add">' + esc(t("act.add")) + "</button></div>" +
          '<div class="small faint" style="margin-top:6px">' + esc(t("act.hint")) + "</div></div>" +

        '<div class="form-row">' +
          '<div class="field"><label>' + esc(t("ho.area")) + "</label>" +
            '<div style="display:flex;gap:7px">' +
              '<select class="input" id="f-area">' + areaOptions(rec ? rec.area : "") + "</select>" +
              '<button class="btn" id="f-area-add" title="' + esc(t("area.add")) + '" style="flex:none">+</button>' +
            "</div></div>" +
          '<div class="field"><label>' + esc(t("ho.due")) + ' <span class="faint">(' + esc(t("common.optional")) + ')</span></label>' +
            '<input type="date" class="input" id="f-due"></div>' +
        "</div>" +

        (isNew ? '<div class="field hidden" id="f-aud-box"></div>' : "") +

        '<div class="field"><label>' + esc(t("ho.kind")) + ' <span class="req">*</span></label>' +
          '<div class="kind-picker" id="f-kind" role="radiogroup">' +
            kindOption("info", t("status.info"), t("ho.kindInfo")) +
            kindOption(S.FOLLOWUP, t("status." + S.FOLLOWUP), t("ho.kindFollow")) +
          "</div>" +
          '<div class="small faint" style="margin-top:7px">' + esc(t("ho.kindHint")) + "</div></div>" +

        '<div class="field"><label>' + esc(t("ho.team")) + "</label>" +
          '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:10px">' +
            teamDropdownShell("dd-eng", t("ho.engineers")) +
            teamDropdownShell("dd-tech", t("ho.technicians")) +
          "</div>" +
          '<div class="chips" id="team-chips"></div>' +
          '<div class="small faint" style="margin-top:6px">' + esc(t("ho.teamHint")) + "</div></div>" +

        '<div class="field"><label>' + esc(t("ho.tags")) + ' <span class="faint">(' + esc(t("common.optional")) + ')</span></label>' +
          '<div class="chips" id="tag-chips" style="margin-bottom:8px"></div>' +
          '<input class="input" id="tag-input" autocomplete="off" placeholder="' + esc(t("ho.tagsPh")) + '">' +
          '<div class="chips" id="tag-sugs" style="margin-top:8px"></div>' +
          '<div class="small faint" style="margin-top:6px">' + esc(t("ho.tagsHint")) + "</div>" +
          '<div class="err-msg hidden" id="e-tags"></div></div>' +


        '<div class="btn-row" style="margin-top:8px">' +
          '<button class="btn primary" id="btn-submit">' + esc(isNew ? t("ho.submit") : t("ho.saveChanges")) + "</button>" +
          (isNew || (rec && rec.status === "draft")
            ? '<button class="btn" id="btn-draft">' + esc(t("ho.saveDraft")) + "</button>" : "") +
          '<button class="btn ghost" id="btn-cancel">' + esc(t("common.cancel")) + "</button>" +
        "</div>" +
      "</div>";

    if (rec) {
      $("#f-title").value = rec.title || "";
      $("#f-desc").value = rec.description || "";
      $("#f-due").value = rec.dueDate ? global.Fmt.isoDay(rec.dueDate) : "";
    }
    // Drafts remember which kind they were going to be; default is Info.
    var kindNow = rec ? (rec.status !== "draft" ? rec.status : (rec.kind || "info")) : "info";

    /* A manager writing a new handover: in the managers' view it goes to the
       managers' database; in the engineers' view they must say who sees it. */
    var chosenAud = null;
    function renderAud() {
      var box = $("#f-aud-box");
      if (!box) { return; }
      if (!isMgr()) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      box.classList.remove("hidden");
      if (inMgrView()) {
        box.innerHTML = "<label>" + esc(t("aud.label")) + "</label>" +
          '<div class="aud-note">' + LOCK_SVG + "<span>" + esc(t("aud.noteMgr")) + "</span></div>";
        return;
      }
      box.innerHTML = "<label>" + esc(t("aud.label")) + ' <span class="req">*</span></label>' +
        '<div class="kind-picker" role="radiogroup">' +
          audOption("all", t("aud.all"), t("aud.allDesc")) +
          audOption("managers", t("aud.mgr"), t("aud.mgrDesc")) +
        "</div>" +
        '<div class="err-msg hidden" id="e-aud"></div>';
      $$('input[name="f-aud"]').forEach(function (r) {
        r.checked = r.value === chosenAud;
        r.addEventListener("change", function () {
          chosenAud = r.value;
          var e = $("#e-aud");
          if (e) { e.classList.add("hidden"); }
        });
      });
    }
    renderAud();
    formViewHook = renderAud;
    $$('input[name="f-kind"]').forEach(function (r) { r.checked = r.value === kindNow; });
    function chosenKind() {
      var r = document.querySelector('input[name="f-kind"]:checked');
      return r ? r.value : "info";
    }

    /* Actions required on the form: open ones can be reworded or removed;
       done ones are history and stay as they are. */
    function syncActionTexts() {
      $$("#act-edit [data-act-text]").forEach(function (inp) {
        var a = chosenActions.filter(function (x) { return x.id === inp.getAttribute("data-act-text"); })[0];
        if (a) { a.text = inp.value; }
      });
    }
    function renderActEdit() {
      var list = chosenActions.slice().sort(function (a, b) { return actionOrder(a) - actionOrder(b); });
      $("#act-edit").innerHTML = list.length ? list.map(function (a) {
        if (a.status === "open") {
          return '<div class="act open"><span class="act-mark" aria-hidden="true"></span>' +
            '<input class="input act-text-input" data-act-text="' + esc(a.id) + '" maxlength="400" value="' + esc(a.text) + '">' +
            '<button type="button" class="btn sm ghost" data-act-rm="' + esc(a.id) + '" title="' + esc(t("common.remove")) + '">\u00d7</button></div>';
        }
        return '<div class="act ' + esc(a.status) + '"><span class="act-mark" aria-hidden="true"></span>' +
          '<div class="act-body"><div class="act-text">' + esc(a.text) + '</div><div class="act-meta">' + esc(actionLabel(a)) + "</div></div></div>";
      }).join("") : "";
      $$("#act-edit [data-act-rm]").forEach(function (b) {
        b.addEventListener("click", function () {
          syncActionTexts();
          chosenActions = chosenActions.filter(function (x) { return x.id !== b.getAttribute("data-act-rm"); });
          renderActEdit();
        });
      });
    }
    function addActionFromInput() {
      var text = $("#act-input").value.trim();
      if (!text) { return; }
      syncActionTexts();
      chosenActions.push({ id: global.Util.uuid(), text: text, status: "open", isNew: true });
      $("#act-input").value = "";
      renderActEdit();
    }
    renderActEdit();
    $("#act-add").addEventListener("click", addActionFromInput);
    $("#act-input").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addActionFromInput(); } });

    function renderChips() {
      $("#tag-chips").innerHTML = chosenTags.length
        ? chosenTags.map(function (no) { return tagChip(no, { removable: true }); }).join(" ")
        : '<span class="faint small">' + esc(t("common.none")) + "</span>";
      $$("#tag-chips [data-remove]").forEach(function (x) {
        x.addEventListener("click", function () {
          chosenTags = chosenTags.filter(function (n) { return n !== x.getAttribute("data-remove"); });
          renderChips();
        });
      });
    }
    renderChips();

    function renderSugs() {
      var q = global.Util.normalize($("#tag-input").value);
      if (!q) { $("#tag-sugs").innerHTML = ""; return; }
      var matches = S.tags().filter(function (tag) {
        if (chosenTags.indexOf(tag.tagNo) >= 0) { return false; }
        var hay = global.Util.normalize(tag.tagNo + " " + tag.descEn);
        return hay.indexOf(q) >= 0;
      }).slice(0, 8);
      $("#tag-sugs").innerHTML = matches.length
        ? matches.map(function (tag) {
            return '<span class="tag-chip link" data-add="' + esc(tag.tagNo) + '">' +
              esc(tag.tagNo) + ' <span class="faint" style="font-weight:400">' + esc(tagDesc(tag)) + "</span></span>";
          }).join(" ")
        : '<button class="btn sm" data-new="1">' +
            esc(t("eq.addMissing", { tag: $("#tag-input").value.trim().toUpperCase() })) + "</button>";
      $$("#tag-sugs [data-add]").forEach(function (el) {
        el.addEventListener("click", function () {
          chosenTags.push(el.getAttribute("data-add"));
          $("#tag-input").value = "";
          $("#tag-sugs").innerHTML = "";
          renderChips();
        });
      });
      var newBtn = $("#tag-sugs [data-new]");
      if (newBtn) {
        newBtn.addEventListener("click", function () {
          tagDialog({
            prefillNo: $("#tag-input").value.trim().toUpperCase(),
            onDone: function (tag) {
              chosenTags.push(tag.tagNo);
              $("#tag-input").value = "";
              $("#tag-sugs").innerHTML = "";
              renderChips();
            }
          });
        });
      }
    }
    /* Engineers dropdown lists everyone who is not a technician, so the
       supervisor is selectable too. Technicians dropdown lists technicians. */
    function teamCandidates(kind) {
      var me = global.App.user();
      return S.users().filter(function (u) {
        if (u.active === false) { return false; }
        if (me && u.id === me.id) { return false; }
        return kind === "tech" ? u.role === "technician" : u.role !== "technician";
      }).sort(function (a, b) { return personName(a).localeCompare(personName(b)); });
    }

    function buildTeamPanel(prefix, kind) {
      var people = teamCandidates(kind);
      var panel = $("#" + prefix + "-panel");
      panel.innerHTML = people.length ? people.map(function (u) {
        var on = chosenTeam.some(function (m) { return m.id === u.id; });
        return "<label><input type=\"checkbox\" data-uid=\"" + esc(u.id) + "\"" + (on ? " checked" : "") + ">" +
          "<span>" + esc(personName(u)) + "</span>" +
          '<span class="dd-role">' + esc(u.jobTitle || t("role." + (u.role || "technician"))) + "</span></label>";
      }).join("") : '<div class="dd-empty">' + esc(t("common.none")) + "</div>";

      $$("#" + prefix + "-panel input[data-uid]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var u = S.userById(cb.getAttribute("data-uid"));
          if (!u) { return; }
          if (cb.checked) {
            if (!chosenTeam.some(function (m) { return m.id === u.id; })) {
              chosenTeam.push({
                id: u.id, name: u.name,
                role: u.role || "technician", jobTitle: u.jobTitle || ""
              });
            }
          } else {
            chosenTeam = chosenTeam.filter(function (m) { return m.id !== u.id; });
          }
          renderTeam();
        });
      });
    }

    function renderTeam() {
      var engN = chosenTeam.filter(function (m) { return m.role !== "technician"; }).length;
      var techN = chosenTeam.filter(function (m) { return m.role === "technician"; }).length;
      $("#dd-eng-btn").textContent = t("ho.engineers") + (engN ? " \u00b7 " + global.Fmt.num(engN) : "");
      $("#dd-tech-btn").textContent = t("ho.technicians") + (techN ? " \u00b7 " + global.Fmt.num(techN) : "");

      $("#team-chips").innerHTML = chosenTeam.length
        ? chosenTeam.map(function (m) {
            return '<span class="tag-chip" style="font-family:inherit">' + esc(personName(m)) +
              '<span class="faint" style="font-weight:400"> \u00b7 ' +
              esc(m.jobTitle || t("role." + (m.role || "technician"))) + "</span>" +
              ' <span class="x" data-rm-team="' + esc(m.id) + '">\u00d7</span></span>';
          }).join(" ")
        : '<span class="faint small">' + esc(t("ho.teamNone")) + "</span>";

      $$("#team-chips [data-rm-team]").forEach(function (x) {
        x.addEventListener("click", function () {
          chosenTeam = chosenTeam.filter(function (m) { return m.id !== x.getAttribute("data-rm-team"); });
          renderTeam();
        });
      });

      buildTeamPanel("dd-eng", "eng");
      buildTeamPanel("dd-tech", "tech");
    }
    renderTeam();

    [["dd-eng-btn", "dd-eng-panel"], ["dd-tech-btn", "dd-tech-panel"]].forEach(function (pair) {
      $("#" + pair[0]).addEventListener("click", function (e) {
        e.stopPropagation();
        var panel = $("#" + pair[1]);
        var wasOpen = !panel.classList.contains("hidden");
        $$(".dropdown-panel").forEach(function (p) { p.classList.add("hidden"); });
        panel.classList.toggle("hidden", wasOpen);
      });
    });

    $("#tag-input").addEventListener("input", global.Util.debounce(renderSugs, 140));
    $("#f-area-add").addEventListener("click", function () {
      newAreaDialog(function (code) { $("#f-area").innerHTML = areaOptions(code); });
    });


    async function save(status) {
      var title = $("#f-title").value.trim();
      var desc = $("#f-desc").value.trim();
      var ok = true;
      function setErr(sel, msg) {
        var el = $(sel);
        el.textContent = msg || "";
        el.classList.toggle("hidden", !msg);
        if (msg) { ok = false; }
      }
      setErr("#e-title", title ? "" : t("err.titleRequired"));
      setErr("#e-desc", desc ? "" : t("err.descRequired"));
      var restricted;
      if (isNew && isMgr()) {
        if (inMgrView()) { restricted = "managers"; }
        else if (!chosenAud) { setErr("#e-aud", t("aud.required")); }
        else if (chosenAud === "managers") { restricted = "managers"; }
      }
      if (!ok) {
        var firstErr = document.querySelector(".err-msg:not(.hidden)");
        if (firstErr && firstErr.scrollIntoView) { firstErr.scrollIntoView({ block: "center" }); }
        return;
      }

      var me = global.App.user();
      var now = new Date().toISOString();
      // A line still in the box counts as added.
      if ($("#act-input").value.trim()) { addActionFromInput(); }
      syncActionTexts();
      var actions = chosenActions.filter(function (a) { return a.status !== "open" || String(a.text || "").trim(); }).map(function (a) {
        var out = JSON.parse(JSON.stringify(a));
        out.text = String(out.text || "").trim();
        if (out.isNew) { delete out.isNew; out.by = { id: me.id, name: me.name }; out.at = now; }
        return out;
      });
      global.UI.busy(true, t("common.saving"));
      try {
        if (isNew) {
          rec = {
            id: global.Util.uuid(),
            version: 0,
            title: title, description: desc,
            plant: "", area: $("#f-area").value,
            unit: "", shift: "",
            tags: chosenTags,
            team: chosenTeam,
            actions: actions,
            status: status,
            kind: chosenKind(),
            dueDate: $("#f-due").value || null,
            createdBy: { id: me.id, name: me.name },
            restricted: restricted,
            createdAt: now,
            updatedAt: now,
            history: [{ status: status, by: personName(me), byId: me.id, at: now }],
            comments: [],
            attachments: []
          };
          await S.saveHandover(rec);
          if (status !== "draft") {
            await S.addNotification({ type: "handover", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: title });
          }
        } else {
          var expected = rec.version || 0;
          rec.title = title;
          rec.description = desc;
          rec.area = $("#f-area").value;
          rec.tags = chosenTags;
          rec.team = chosenTeam;
          rec.actions = actions;
          rec.dueDate = $("#f-due").value || null;
          rec.kind = chosenKind();
          var wasDraft = rec.status === "draft";
          if (status !== rec.status) {
            rec.status = status;
            rec.history = (rec.history || []).concat([{ status: status, by: personName(me), byId: me.id, at: now }]);
          }
          await S.saveHandoverChecked(rec, expected);
          await S.releaseLock(rec.id);
          if (wasDraft && status !== "draft") {
            await S.addNotification({ type: "handover", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: title });
          }
        }
        global.UI.busy(false);
        global.UI.toast(isNew ? (isMgr() ? t(restricted ? "aud.savedMgr" : "aud.savedAll") : t("ho.created")) : t("ho.updated"), "ok");
        go("#/handover/" + rec.id);
      } catch (e) {
        global.UI.busy(false);
        if (e && e.name === "ConflictError") { global.UI.toast(t("ho.conflict"), "err"); }
        else { global.UI.toast(t("err.write"), "err"); }
      }
    }

    $("#btn-submit").addEventListener("click", function () { save(chosenKind()); });
    if ($("#btn-draft")) { $("#btn-draft").addEventListener("click", function () { save("draft"); }); }
    if ($("#f-import")) { $("#f-import").addEventListener("click", function () { go("#/handover/import"); }); }
    $("#btn-cancel").addEventListener("click", function () {
      if (rec && rec.id) { S.releaseLock(rec.id); go("#/handover/" + rec.id); }
      else { go("#/handovers"); }
    });
  }

  function selectField(id, labelText, list, selected) {
    return '<div class="field"><label>' + esc(labelText) + "</label>" +
      '<select class="input" id="' + id + '">' +
      '<option value="">' + esc(t("common.select")) + "</option>" +
      (list || []).map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === selected ? " selected" : "") + ">" +
          esc((o.en)) + "</option>";
      }).join("") +
      "</select></div>";
  }

  /* =========================== HANDOVER DETAIL =========================== */

  async function handoverDetail(id) {
    var rec = await S.getHandover(id);
    if (!rec) { view().innerHTML = emptyBlock(t("err.notFound")); return; }
    var st = S.structure();
    var me = global.App.user();
    var mayEdit = canEditHandover(rec);
    markHandoverSeen(rec.id);

    var activity = (rec.history || []).map(function (h) {
      return { at: h.at, text: t("ho.statusChanged") + ": " + t("status." + h.status), who: h.by };
    });
    (rec.comments || []).forEach(function (c) { activity.push({ at: c.at, text: t(c.actionId ? "act.activityDone" : "ho.commentAdded"), who: personName(c.by) }); });
    (rec.actions || []).forEach(function (a) {
      if (a.at && a.status !== "old") { activity.push({ at: a.at, text: t("act.activityAdded") + ": " + a.text, who: personName(a.by) }); }
    });
    (rec.attachments || []).forEach(function (a) { activity.push({ at: a.at, text: t("ho.attachmentAdded") + ": " + a.name, who: a.by ? personName(a.by) : "" }); });
    if (rec.importedFrom === "excel") {
      activity.push({ at: rec.importedAt || rec.createdAt, text: t("imp.activity"), who: personName(rec.importedBy || rec.createdBy) });
    }
    if (rec.archived) {
      activity.push({ at: rec.createdAt, dateOnly: true, text: t("arc.imported") + (rec.legacyStatus ? " \u00b7 " + rec.legacyStatus : ""), who: personName(rec.createdBy) });
    }
    activity.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
    var createdText = (rec.archived || rec.importedFrom)
      ? (rec.createdAt ? global.Fmt.date(rec.createdAt) : t("arc.dateUnknown"))
      : global.Fmt.dateTime(rec.createdAt);
    var authorText = personName(rec.createdBy) +
      (rec.archived && rec.createdBy && rec.createdBy.original && rec.createdBy.original !== rec.createdBy.name
        ? " (" + t("arc.writtenAs") + " \u201c" + rec.createdBy.original + "\u201d)" : "");
    var notice = "";
    if (rec.archived) { notice = t("arc.banner", { source: rec.source || "Excel" }); }
    else if (rec.restricted) { notice = t("mgr.notice") + (mayEdit ? "" : " " + t("own.onlyAuthor", { name: personName(rec.createdBy) })); }
    else if (!mayEdit) { notice = t("own.onlyAuthor", { name: personName(rec.createdBy) }); }

    view().innerHTML =
      '<div class="page-head">' +
        "<div>" +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            "<h1>" + esc(rec.title) + "</h1>" + statusBadge(rec.status) + (rec.archived ? archiveBadge(rec) : "") + (rec.restricted ? restrictedBadge() : "") +
          "</div>" +
          '<p>' + esc(t("ho.createdBy")) + " " + esc(authorText) + " · " + esc(createdText) + "</p>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<div class="btn-row">' +
          (mayEdit ? '<button class="btn" id="btn-status">' + esc(t("ho.changeStatus")) + "</button>" : "") +
          (mayEdit ? '<button class="btn" id="btn-edit">' + esc(t("common.edit")) + "</button>" : "") +
          (mayEdit ? '<button class="btn danger" id="btn-delete">' + esc(t("del.button")) + "</button>" : "") +
          '<button class="btn ghost" id="btn-back">' + esc(t("common.back")) + "</button>" +
        "</div>" +
      "</div>" +
      (notice
        ? '<div id="ho-notice" style="background:var(--bg-sunken);color:var(--text-soft);padding:10px 13px;' +
          'border-radius:var(--radius-s);margin-bottom:14px;font-size:.87rem">' + esc(notice) + "</div>"
        : "") +

      '<div class="detail-grid">' +
        "<div>" +
          '<div class="card"><h3>' + esc(t("ho.description")) + "</h3>" +
            '<div class="prose">' + esc(rec.description || "") + "</div></div>" +

          '<div class="card" id="act-card"><h3>' + esc(t("act.label")) + ' <span class="faint small" id="act-sum"></span></h3>' +
            '<div class="act-list" id="act-view"></div>' +
            '<div class="act-add-row"><input class="input" id="act-new" maxlength="400" placeholder="' + esc(t("act.addPh")) + '">' +
              '<button class="btn" id="act-new-btn" type="button">' + esc(t("act.add")) + "</button></div>" +
            '<div class="small faint" style="margin-top:6px">' + esc(t(rec.restricted ? "act.whoMgr" : "act.whoAll")) + "</div>" +
          "</div>" +

          '<div class="card"><h3>' + esc(t("ho.attachments")) + " (" + global.Fmt.num((rec.attachments || []).length) + ")</h3>" +
            '<div class="attach-grid" id="attach-grid"></div>' +
            '<div class="dropzone" id="dropzone" style="margin-top:12px">' + esc(t("ho.dropFiles")) + "<br>" +
              '<span class="small faint">' + esc(t("ho.fileTypes", { mb: global.Util.MAX_MB })) + "</span></div>" +
            '<div class="btn-row attach-btns" style="margin-top:10px">' +
              '<button class="btn" id="btn-camera">' + esc(t("pwa.takePhoto")) + "</button>" +
              '<button class="btn ghost" id="btn-pick">' + esc(t("pwa.chooseFiles")) + "</button></div>" +
            '<input type="file" id="file-input" multiple class="hidden">' +
            '<input type="file" id="camera-input" accept="image/*" capture="environment" class="hidden">' +
          "</div>" +

          '<div class="card"><h3>' + esc(t("ho.comments")) + " (" + global.Fmt.num((rec.comments || []).length) + ")</h3>" +
            '<div id="comment-list"></div>' +
            '<div style="margin-top:12px">' +
              '<select class="input hidden" id="c-done" style="margin-bottom:8px"></select>' +
              '<textarea class="input" id="c-text" rows="3" placeholder="' + esc(t("ho.commentPh")) + '"></textarea>' +
              '<div class="btn-row" style="margin-top:8px">' +
                '<button class="btn primary" id="c-post">' + esc(t("ho.post")) + "</button>" +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +

        "<div>" +
          '<div class="card"><h3>' + esc(t("eq.details")) + "</h3>" +
            '<div class="meta-list">' +
              meta(t("ho.status"), statusBadge(rec.status), true) +
              (rec.archived && rec.legacyStatus ? meta(t("arc.original"), esc(rec.legacyStatus)) : "") +
              meta(t("ho.area"), esc(rec.area ? label(st.areas, rec.area) : "\u2014")) +
              (rec.location ? meta(t("arc.location"), esc(rec.location)) : "") +
              meta(t("eq.upper"), esc(upperOf(rec.tags))) +
              meta(t("ho.team"), (rec.team && rec.team.length)
                ? rec.team.map(function (m) { return esc(personName(m)); }).join(", ")
                : "\u2014") +
              meta(t("ho.due"), rec.dueDate ? esc(global.Fmt.date(rec.dueDate)) : "—") +
              (rec.archived && rec.updatedAt === rec.createdAt ? "" : meta(t("ho.updatedAt"), esc(global.Fmt.dateTime(rec.updatedAt)))) +
              (rec.archived && rec.source ? meta(t("arc.source"), esc(rec.source)) : "") +
              meta(t("ho.tags"), '<div class="chips">' + (rec.tags || []).map(function (no) { return tagChip(no, { link: true }); }).join(" ") + "</div>", true) +
            "</div>" +
          "</div>" +
          '<div class="card"><h3>' + esc(t("ho.history")) + "</h3>" +
            '<div class="timeline">' + activity.map(function (a) {
              var when = a.dateOnly ? (a.at ? global.Fmt.date(a.at) : t("arc.dateUnknown")) : global.Fmt.dateTime(a.at);
              return '<div class="tl-item"><div class="t">' + esc(when) + "</div>" +
                '<div class="b">' + esc(a.text) + (a.who ? ' <span class="faint">· ' + esc(a.who) + "</span>" : "") + "</div></div>";
            }).join("") + "</div>" +
          "</div>" +
        "</div>" +
      "</div>";

    renderActions();
    renderComments();
    renderAttachments();
    wireCards(view());
    $("#act-new-btn").addEventListener("click", addActionHere);
    $("#act-new").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addActionHere(); } });
    $("#c-done").addEventListener("change", function () {
      $("#c-text").placeholder = $("#c-done").value ? t("act.donePh") : t("ho.commentPh");
    });

    $("#btn-back").addEventListener("click", function () { go("#/handovers"); });
    if (mayEdit) {
      $("#btn-edit").addEventListener("click", function () { go("#/handover/" + rec.id + "/edit"); });
      $("#btn-status").addEventListener("click", changeStatus);
      $("#btn-delete").addEventListener("click", deleteThis);
    }
    $("#c-post").addEventListener("click", postComment);

    $("#dropzone").addEventListener("click", function () { $("#file-input").click(); });
    $("#file-input").addEventListener("change", function (e) { addFiles(e.target.files); });
    $("#camera-input").addEventListener("change", function (e) { addFiles(e.target.files); });
    $("#btn-camera").addEventListener("click", function () { $("#camera-input").click(); });
    $("#btn-pick").addEventListener("click", function () { $("#file-input").click(); });
    ["dragenter", "dragover"].forEach(function (ev) {
      $("#dropzone").addEventListener(ev, function (e) { e.preventDefault(); $("#dropzone").classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      $("#dropzone").addEventListener(ev, function (e) { e.preventDefault(); $("#dropzone").classList.remove("over"); });
    });
    $("#dropzone").addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });

    async function deleteThis() {
      var lock = null;
      try { lock = await S.readLock(rec.id); } catch (e) { lock = null; }
      var msg = t("del.confirm", { title: rec.title || "\u2014" });
      if (lock && lock.by && me && lock.by !== me.id) { msg += " " + t("del.beingEdited", { name: lock.name }); }
      var ok = await global.UI.confirm(msg, { title: t("del.title"), okLabel: t("del.button"), danger: true });
      if (!ok) { return; }
      global.UI.busy(true, t("common.saving"));
      try {
        await S.deleteHandover(rec.id, me);
        try {
          await S.addNotification({ type: "deleted", actor: { id: me.id, name: me.name }, handoverId: "", title: rec.title, restricted: rec.restricted || undefined });
        } catch (e) { /* the deletion itself succeeded */ }
        global.UI.busy(false);
        global.UI.toast(t("del.done"), "ok");
        go("#/handovers");
      } catch (e) {
        global.UI.busy(false);
        S.log("delete failed", e && (e.name + ": " + e.message));
        global.UI.toast(e && e.name === "NotFoundError" ? t("err.notFound") : t("err.write"), "err");
      }
    }

    function meta(k, v, raw) {
      return '<div class="m"><span class="k">' + esc(k) + '</span><span class="v">' + (raw ? v : v) + "</span></div>";
    }

    function actionById(id) { return (rec.actions || []).filter(function (a) { return a.id === id; })[0] || null; }

    function renderActions() {
      var list = (rec.actions || []).slice().sort(function (a, b) {
        return actionOrder(a) - actionOrder(b) || String(a.at || "").localeCompare(String(b.at || ""));
      });
      var open = list.filter(function (a) { return a.status === "open"; });
      $("#act-sum").textContent = list.length ? "\u00b7 " + t("act.sumOpen", { n: global.Fmt.num(open.length), total: global.Fmt.num(list.length) }) : "";
      $("#act-view").innerHTML = list.length ? list.map(function (a) {
        return '<div class="act ' + esc(a.status || "open") + '" data-act="' + esc(a.id) + '"><span class="act-mark" aria-hidden="true"></span>' +
          '<div class="act-body"><div class="act-text">' + esc(a.text) + "</div>" +
            '<div class="act-meta">' + esc(actionLabel(a)) +
              (a.status === "done" && a.doneComment ? ' \u00b7 <a href="#" data-goto-comment="' + esc(a.doneComment) + '">' + esc(t("act.seeComment")) + "</a>" : "") +
            "</div></div>" +
          (a.status === "open" ? '<button type="button" class="btn sm" data-act-done="' + esc(a.id) + '">' + esc(t("act.markDone")) + "</button>" : "") +
          "</div>";
      }).join("") : '<p class="faint small" style="margin:0 0 10px">' + esc(t("act.none")) + "</p>";

      var sel = $("#c-done");
      var keep = sel.value;
      sel.innerHTML = '<option value="">' + esc(t("act.noneDone")) + "</option>" + open.map(function (a) {
        return '<option value="' + esc(a.id) + '">' + esc(t("act.completes", { text: a.text.length > 90 ? a.text.slice(0, 88) + "\u2026" : a.text })) + "</option>";
      }).join("");
      sel.value = open.some(function (a) { return a.id === keep; }) ? keep : "";
      sel.classList.toggle("hidden", !open.length);

      $$("#act-view [data-act-done]").forEach(function (b) {
        b.addEventListener("click", function () {
          sel.value = b.getAttribute("data-act-done");
          $("#c-text").placeholder = t("act.donePh");
          $("#c-text").scrollIntoView({ block: "center" });
          $("#c-text").focus();
        });
      });
      $$("#act-view [data-goto-comment]").forEach(function (l) {
        l.addEventListener("click", function (e) {
          e.preventDefault();
          var el = document.getElementById("cm-" + l.getAttribute("data-goto-comment"));
          if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 1600); }
        });
      });
    }

    async function addActionHere() {
      var text = $("#act-new").value.trim();
      if (!text) { $("#act-new").focus(); return; }
      global.UI.busy(true, t("common.saving"));
      try {
        rec = await S.addAction(rec.id, {
          id: global.Util.uuid(), text: text, status: "open",
          by: { id: me.id, name: me.name }, at: new Date().toISOString()
        });
        await S.addNotification({ type: "action", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: rec.title, text: text });
        $("#act-new").value = "";
        global.UI.busy(false);
        global.UI.toast(t("act.added"), "ok");
        handoverDetail(rec.id);
      } catch (e) { global.UI.busy(false); global.UI.toast(t("err.write"), "err"); }
    }

    function renderComments() {
      var list = (rec.comments || []).slice().sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
      $("#comment-list").innerHTML = list.length ? list.map(function (c) {
        var done = c.actionId ? actionById(c.actionId) : null;
        return '<div class="comment" id="cm-' + esc(c.id) + '"><span class="avatar">' + esc(initials(personName(c.by))) + "</span>" +
          '<div class="c-body"><div class="c-head"><b>' + esc(personName(c.by)) + "</b>" +
            '<span class="faint small">' + esc(global.Fmt.dateTime(c.at)) + "</span></div>" +
            (done ? '<div class="c-done">\u2713 ' + esc(t("act.doneLabel")) + ": " + esc(done.text) + "</div>" : "") +
            '<div class="c-text">' + esc(c.text) + "</div></div></div>";
      }).join("") : '<p class="faint small">' + esc(t("common.none")) + "</p>";
    }

    function renderAttachments() {
      var list = rec.attachments || [];
      $("#attach-grid").innerHTML = list.length ? list.map(function (a) {
        var icon = global.Util.ext(a.name).toUpperCase();
        return '<div class="attach" data-att="' + esc(a.stored) + '">' +
          (global.Util.isImage(a.name)
            ? '<div class="ficon" data-thumb="' + esc(a.stored) + '">' + esc(icon) + "</div>"
            : '<div class="ficon">' + esc(icon) + "</div>") +
          '<span class="fname">' + esc(a.name) + "</span>" +
          '<span class="fsize">' + esc(global.Fmt.bytes(a.size)) + "</span></div>";
      }).join("") : '<p class="faint small">' + esc(t("common.none")) + "</p>";

      $$("#attach-grid .attach").forEach(function (el) {
        el.addEventListener("click", function () { openAttachment(el.getAttribute("data-att")); });
      });
      // Load image thumbnails lazily so a long list does not stall on the share.
      $$("#attach-grid [data-thumb]").forEach(async function (el) {
        try {
          var file = await S.getAttachmentFile(rec.id, el.getAttribute("data-thumb"));
          var img = document.createElement("img");
          img.src = URL.createObjectURL(file);
          el.replaceWith(img);
        } catch (e) { /* leave the extension badge */ }
      });
    }

    async function openAttachment(stored) {
      var att = (rec.attachments || []).filter(function (a) { return a.stored === stored; })[0];
      if (!att) { return; }
      try {
        var file = await S.getAttachmentFile(rec.id, stored);
        var url = URL.createObjectURL(file);
        var body = document.createElement("div");
        if (global.Util.isImage(att.name)) {
          body.innerHTML = '<img src="' + url + '" style="max-width:100%;border-radius:8px">';
        } else if (global.Util.ext(att.name) === "pdf") {
          body.innerHTML = '<embed src="' + url + '" type="application/pdf" style="width:100%;height:68vh;border:0;border-radius:8px">';
        } else {
          body.innerHTML = '<p class="muted">' + esc(att.name) + " · " + esc(global.Fmt.bytes(att.size)) + "</p>";
        }
        global.UI.modal({
          title: att.name, body: body, wide: true,
          buttons: [
            { label: t("common.close"), value: null },
            {
              label: t("common.download"), primary: true,
              before: function () {
                var a = document.createElement("a");
                a.href = url; a.download = att.name;
                document.body.appendChild(a); a.click(); a.remove();
                return false;
              }
            }
          ]
        }).then(function () { URL.revokeObjectURL(url); });
      } catch (e) { global.UI.toast(t("err.read"), "err"); }
    }

    async function addFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) { return; }
      global.UI.busy(true, t("common.saving"));
      var uploaded = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!global.Util.isAllowed(f.name)) { global.UI.toast(t("err.fileType", { name: f.name }), "err"); continue; }
        if (f.size > global.Util.MAX_MB * 1024 * 1024) { global.UI.toast(t("err.fileTooLarge", { name: f.name, mb: global.Util.MAX_MB }), "err"); continue; }
        try {
          var att = await S.putAttachment(rec.id, f);
          att.by = { id: me.id, name: me.name };
          uploaded.push(att);
        } catch (e) { global.UI.toast(t("err.write"), "err"); }
      }
      try {
        if (uploaded.length) {
          rec = await S.appendAttachments(rec.id, uploaded);
          await S.addNotification({ type: "attachment", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: rec.title });
        }
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
      $("#file-input").value = "";
      $("#camera-input").value = "";
      renderAttachments();
    }

    async function postComment() {
      var text = $("#c-text").value.trim();
      var actionId = $("#c-done").value || "";
      if (!text) {
        if (actionId) { global.UI.toast(t("act.needText"), "err"); }
        $("#c-text").focus();
        return;
      }
      global.UI.busy(true, t("common.saving"));
      try {
        var comment = { id: global.Util.uuid(), text: text, at: new Date().toISOString(), by: { id: me.id, name: me.name } };
        if (actionId) { comment.actionId = actionId; }
        rec = await S.appendComment(rec.id, comment);
        var done = actionId ? actionById(actionId) : null;
        await S.addNotification(done
          ? { type: "actionDone", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: rec.title, text: done.text }
          : { type: "comment", actor: { id: me.id, name: me.name }, handoverId: rec.id, title: rec.title });
        $("#c-text").value = "";
        $("#c-text").placeholder = t("ho.commentPh");
        global.UI.busy(false);
        if (done) { global.UI.toast(t("act.doneToast"), "ok"); handoverDetail(rec.id); return; }
        renderComments();
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    }

    async function changeStatus() {
      var body = document.createElement("div");
      body.innerHTML = '<div class="field"><label>' + esc(t("ho.status")) + "</label>" +
        '<select class="input" id="st-sel">' + S.STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === rec.status ? " selected" : "") + ">" + esc(t("status." + s)) + "</option>";
        }).join("") + "</select></div>";
      var chosen = await global.UI.modal({
        title: t("ho.changeStatus"), body: body,
        buttons: [
          { label: t("common.cancel"), value: null },
          { label: t("common.save"), primary: true, before: function (b) { return $("#st-sel", b).value; } }
        ]
      });
      if (!chosen || chosen === rec.status) { return; }
      global.UI.busy(true, t("common.saving"));
      try {
        rec = await S.setStatus(rec.id, chosen, personName(me), me.id);
        await S.addNotification({
          type: "status", actor: { id: me.id, name: me.name },
          handoverId: rec.id, title: rec.title, status: chosen
        });
        global.UI.toast(t("ho.statusChanged"), "ok");
        handoverDetail(rec.id);
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    }
  }

  /* ============================== EQUIPMENT ============================== */

  /* Options for an area <select>, including a blank "not set" entry. */
  function areaOptions(selected, extra) {
    var st = S.structure();
    var out = '<option value="">' + esc(extra || t("common.select")) + "</option>";
    (st.areas || []).forEach(function (a) {
      out += '<option value="' + esc(a.id) + '"' + (a.id === selected ? " selected" : "") + ">" +
        esc((a.en)) + "</option>";
    });
    return out;
  }

  /* Asks for a new area code and appends it to the plant structure. */
  function newAreaDialog(onDone) {
    var body = document.createElement("div");
    body.innerHTML =
      '<div class="field"><label>' + esc(t("area.new")) + ' <span class="req">*</span></label>' +
        '<input class="input" id="a-code" placeholder="WDDM" maxlength="24"></div>' +
      '<div class="err-msg hidden" id="a-err"></div>';
    global.UI.modal({
      title: t("area.add"), body: body,
      buttons: [
        { label: t("common.cancel"), value: null },
        {
          label: t("common.add"), primary: true,
          before: function (b) {
            var code = $("#a-code", b).value.trim();
            if (!code) { return false; }
            var clash = (S.structure().areas || []).some(function (a) {
              return a.id.toLowerCase() === code.toLowerCase();
            });
            if (clash) {
              $("#a-err", b).textContent = t("area.exists");
              $("#a-err", b).classList.remove("hidden");
              return false;
            }
            return code;
          }
        }
      ]
    }).then(async function (code) {
      if (!code) { return; }
      try {
        await S.addArea(code, code);
        global.UI.toast(t("area.added"), "ok");
        if (onDone) { onDone(code); }
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
    });
  }

  /* The upper equipment behind a set of tag numbers, de-duplicated. */
  function upperOf(tagNos) {
    var seen = {}, out = [];
    (tagNos || []).forEach(function (no) {
      var tg = S.tagByNumber(no);
      if (tg && tg.upper && !seen[tg.upper]) { seen[tg.upper] = true; out.push(tg.upper); }
    });
    return out.length ? out.join(", ") : "—";
  }

  function upperDatalist(id) {
    return '<datalist id="' + id + '">' +
      S.upperEquipmentList().map(function (u) { return '<option value="' + esc(u) + '">'; }).join("") +
      "</datalist>";
  }

  var eqFilters = { q: "", area: "", upper: "", type: "" };
  var EQ_LIMIT = 300;

  async function equipmentList() {
    var st = S.structure();
    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("eq.title")) + "</h1><p>" + esc(t("eq.sub")) + "</p></div>" +
        '<div class="spacer"></div><button class="btn primary" id="add-tag">' + esc(t("eq.add")) + "</button></div>" +
      '<div class="filters">' +
        '<input type="search" id="q" placeholder="' + esc(t("eq.searchPh")) + '" style="min-width:240px">' +
        '<input id="f-upper" list="upper-list" placeholder="' + esc(t("eq.upperPh")) + '" style="min-width:190px">' +
        upperDatalist("upper-list") +
        '<select id="f-type"><option value="">' + esc(t("eq.type")) + " – " + esc(t("common.all")) + "</option>" +
          (st.equipmentTypes || []).map(function (x) {
            return '<option value="' + esc(x.id) + '">' + esc((x.en)) + "</option>";
          }).join("") + "</select>" +
        '<select id="f-area">' + areaOptions("", t("eq.area") + " – " + t("common.all")) + "</select>" +
        '<button class="btn sm ghost" id="f-clear">' + esc(t("common.clear")) + "</button>" +
      "</div>" +
      '<div id="eq-count" class="small faint" style="margin-bottom:10px"></div>' +
      '<div class="card" style="padding:0;overflow:hidden"><table class="table"><thead><tr>' +
        "<th>" + esc(t("eq.tagNumber")) + "</th><th>" + esc(t("ho.description")) + "</th>" +
        "<th>" + esc(t("eq.type")) + "</th><th>" + esc(t("eq.upper")) + "</th><th>" + esc(t("eq.area")) + "</th>" +
      '</tr></thead><tbody id="eq-body"></tbody></table></div>';

    $("#q").value = eqFilters.q;
    $("#f-upper").value = eqFilters.upper;
    $("#f-type").value = eqFilters.type;
    $("#f-area").value = eqFilters.area;

    function matches() {
      var q = global.Util.normalize(eqFilters.q);
      var up = global.Util.normalize(eqFilters.upper);
      return S.tags().filter(function (tag) {
        if (eqFilters.type && tag.type !== eqFilters.type) { return false; }
        if (eqFilters.area && (tag.area || "") !== eqFilters.area) { return false; }
        if (up && global.Util.normalize(tag.upper || "").indexOf(up) < 0) { return false; }
        if (q && global.Util.normalize(
              tag.tagNo + " " + (tag.descEn || "") + " " + (tag.upper || "")
            ).indexOf(q) < 0) { return false; }
        return true;
      });
    }

    function render() {
      var rows = matches();
      var shown = rows.slice(0, EQ_LIMIT);
      $("#eq-count").textContent = rows.length > EQ_LIMIT
        ? t("eq.showing", { n: global.Fmt.num(EQ_LIMIT), total: global.Fmt.num(rows.length) })
        : t("admin.tagCount", { n: global.Fmt.num(rows.length) });

      $("#eq-body").innerHTML = shown.length ? shown.map(function (tag) {
        return '<tr data-tag="' + esc(tag.tagNo) + '" style="cursor:pointer">' +
          '<td><b class="mono">' + esc(tag.tagNo) + "</b>" +
            (tag.active === false ? ' <span class="faint small">(' + esc(t("eq.inactive")) + ")</span>" : "") + "</td>" +
          "<td>" + esc(tagDesc(tag)) + "</td>" +
          "<td>" + esc(label(S.structure().equipmentTypes, tag.type)) + "</td>" +
          '<td class="mono small">' + esc(tag.upper || "—") + "</td>" +
          "<td>" + esc(tag.area ? label(S.structure().areas, tag.area) : "—") + "</td></tr>";
      }).join("") : '<tr><td colspan="5">' + emptyBlock(t("eq.none")) + "</td></tr>";

      $$("#eq-body tr[data-tag]").forEach(function (tr) {
        tr.addEventListener("click", function () {
          go("#/equipment/" + encodeURIComponent(tr.getAttribute("data-tag")));
        });
      });
    }

    $("#q").addEventListener("input", global.Util.debounce(function () { eqFilters.q = $("#q").value; render(); }, 200));
    $("#f-upper").addEventListener("input", global.Util.debounce(function () { eqFilters.upper = $("#f-upper").value; render(); }, 200));
    $("#f-type").addEventListener("change", function () { eqFilters.type = $("#f-type").value; render(); });
    $("#f-area").addEventListener("change", function () { eqFilters.area = $("#f-area").value; render(); });
    $("#f-clear").addEventListener("click", function () {
      eqFilters = { q: "", area: "", upper: "", type: "" };
      equipmentList();
    });
    $("#add-tag").addEventListener("click", function () { tagDialog({ onDone: render }); });
    render();
  }

  /* Add or edit an equipment tag. opts: {tag, prefillNo, onDone} */
  function tagDialog(opts) {
    opts = opts || {};
    var existing = opts.tag || null;
    var st = S.structure();
    var body = document.createElement("div");
    body.innerHTML =
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("eq.tagNumber")) + ' <span class="req">*</span></label>' +
          '<input class="input mono" id="n-no" placeholder="PIT-C002"' + (existing ? " disabled" : "") + "></div>" +
        '<div class="field"><label>' + esc(t("eq.upper")) + "</label>" +
          '<input class="input mono" id="n-upper" list="dlg-upper" placeholder="GF-LP">' +
          upperDatalist("dlg-upper") + "</div>" +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("eq.descEn")) + '</label><input class="input" id="n-en"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("eq.type")) + "</label>" +
          '<select class="input" id="n-type">' + (st.equipmentTypes || []).map(function (x) {
            return '<option value="' + esc(x.id) + '">' + esc((x.en)) + "</option>";
          }).join("") + "</select></div>" +
        '<div class="field"><label>' + esc(t("eq.area")) + "</label>" +
          '<select class="input" id="n-area">' + areaOptions(existing ? existing.area : "") + "</select></div>" +
        '<div class="field"><label>' + esc(t("eq.uom")) + '</label><input class="input" id="n-uom" placeholder="barg"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>LRV</label><input class="input" id="n-lrv"></div>' +
        '<div class="field"><label>URV</label><input class="input" id="n-urv"></div>' +
        '<div class="field"><label>' + esc(t("eq.valveSize")) + '</label><input class="input" id="n-size"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("eq.service")) + '</label><input class="input" id="n-service"></div>' +
        '<div class="field"><label>' + esc(t("eq.serial")) + '</label><input class="input" id="n-serial"></div>' +
      "</div>" +
      '<div class="field"><label>' + esc(t("eq.comment")) + '</label><input class="input" id="n-comment"></div>' +
      '<div class="err-msg hidden" id="n-err"></div>';

    var seed = existing || { tagNo: opts.prefillNo || "" };
    body.querySelector("#n-no").value = seed.tagNo || "";
    body.querySelector("#n-upper").value = seed.upper || "";
    body.querySelector("#n-en").value = seed.descEn || "";
    body.querySelector("#n-uom").value = seed.uom || "";
    body.querySelector("#n-lrv").value = seed.lrv || "";
    body.querySelector("#n-urv").value = seed.urv || "";
    body.querySelector("#n-size").value = seed.valveSize || "";
    body.querySelector("#n-service").value = seed.service || "";
    body.querySelector("#n-serial").value = seed.serial || "";
    body.querySelector("#n-comment").value = seed.comment || "";
    if (existing && existing.type) { body.querySelector("#n-type").value = existing.type; }

    global.UI.modal({
      title: existing ? t("common.edit") + " — " + existing.tagNo : t("eq.addTitle"),
      body: body, wide: true,
      buttons: [
        { label: t("common.cancel"), value: null },
        {
          label: t("common.save"), primary: true,
          before: function (b) {
            var no = existing ? existing.tagNo : $("#n-no", b).value.trim().toUpperCase();
            var err = $("#n-err", b);
            if (!no) { err.textContent = t("err.tagNumberRequired"); err.classList.remove("hidden"); return false; }
            if (!existing && S.tagByNumber(no)) { err.textContent = t("eq.duplicate"); err.classList.remove("hidden"); return false; }
            var typeId = $("#n-type", b).value;
            var upper = $("#n-upper", b).value.trim();
            var descEn = $("#n-en", b).value.trim();
            return {
              tagNo: no,
              upper: upper,
              alt: existing ? (existing.alt || []) : [],
              descEn: descEn || ((S.TYPE_EN[typeId] || "Instrument") + (upper ? " on " + upper : "")),
              type: typeId,
              area: $("#n-area", b).value,
              uom: $("#n-uom", b).value.trim(),
              lrv: $("#n-lrv", b).value.trim(),
              urv: $("#n-urv", b).value.trim(),
              valveSize: $("#n-size", b).value.trim(),
              swHealthy: existing ? (existing.swHealthy || "") : "",
              swActive: existing ? (existing.swActive || "") : "",
              pcvSp: existing ? (existing.pcvSp || "") : "",
              service: $("#n-service", b).value.trim(),
              serial: $("#n-serial", b).value.trim(),
              system: existing ? (existing.system || "") : "",
              comment: $("#n-comment", b).value.trim(),
              active: existing ? (existing.active !== false) : true,
              createdAt: existing ? (existing.createdAt || "") : new Date().toISOString()
            };
          }
        }
      ]
    }).then(async function (tag) {
      if (!tag) { return; }
      global.UI.busy(true, t("common.saving"));
      try {
        await S.upsertTag(tag);
        global.UI.toast(t("eq.added"), "ok");
        if (opts.onDone) { opts.onDone(tag); }
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    });
  }

  async function equipmentDetail(tagNo) {
    var tag = S.tagByNumber(tagNo);
    if (!tag) { view().innerHTML = emptyBlock(t("err.notFound")); return; }
    var st = S.structure();
    var all = await S.listHandovers();
    var related = all.filter(function (h) { return (h.tags || []).indexOf(tag.tagNo) >= 0; });
    var open = related.filter(function (h) { return h.status !== "info"; });
    var past = related.filter(function (h) { return h.status === "info"; });

    // The timeline is built from the records themselves - no separate audit log.
    var events = [];
    var fulls = await S.getHandovers(related.map(function (h) { return h.id; }));
    for (var i = 0; i < fulls.length; i++) {
      var full = fulls[i];
      if (!full) { continue; }
      if (full.archived && full.createdAt) {
        events.push({ at: full.createdAt, dateOnly: true, text: full.title + " \u2014 " + (full.legacyStatus || t("arc.badge")), who: personName(full.createdBy), id: full.id });
      }
      (full.history || []).forEach(function (x) {
        events.push({ at: x.at, text: full.title + " — " + t("status." + x.status), who: x.by, id: full.id });
      });
      (full.comments || []).forEach(function (c) {
        events.push({ at: c.at, text: full.title + " — " + c.text.slice(0, 90), who: personName(c.by), id: full.id });
      });
    }
    events.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });

    var range = "";
    if (tag.lrv !== "" || tag.urv !== "") {
      range = (tag.lrv === "" ? "0" : tag.lrv) + " – " + (tag.urv === "" ? "?" : tag.urv) + (tag.uom ? " " + tag.uom : "");
    }

    view().innerHTML =
      '<div class="page-head"><div>' +
        "<h1>" + esc(tag.tagNo) + "</h1><p>" + esc(tagDesc(tag)) + "</p></div>" +
        '<div class="spacer"></div>' +
        '<div class="btn-row"><button class="btn primary" id="new-for-tag">' + esc(t("ho.new")) + "</button>" +
        '<button class="btn" id="edit-tag">' + esc(t("common.edit")) + "</button>" +
        '<button class="btn ghost" id="btn-back">' + esc(t("common.back")) + "</button></div>" +
      "</div>" +

      '<div class="detail-grid">' +
        "<div>" +
          '<div class="card"><h3>' + esc(t("eq.openHandovers")) + " (" + global.Fmt.num(open.length) + ")</h3>" +
            (open.length ? '<div class="list">' + open.map(handoverCard).join("") + "</div>"
                         : '<p class="faint small">' + esc(t("eq.noHandovers")) + "</p>") +
          "</div>" +
          '<div class="card"><h3>' + esc(t("eq.pastHandovers")) + " (" + global.Fmt.num(past.length) + ")</h3>" +
            (past.length ? '<div class="list">' + past.map(handoverCard).join("") + "</div>"
                         : '<p class="faint small">' + esc(t("common.none")) + "</p>") +
          "</div>" +
        "</div>" +
        "<div>" +
          '<div class="card"><h3>' + esc(t("eq.details")) + '</h3><div class="meta-list">' +
            m(t("eq.type"), label(st.equipmentTypes, tag.type)) +
            m(t("eq.upper"), tag.upper || "—") +
            (tag.alt && tag.alt.length ? m(t("eq.alsoOn"), tag.alt.join(", ")) : "") +
            m(t("eq.area"), tag.area ? label(st.areas, tag.area) : "—") +
            m(t("ho.status"), tag.active === false ? t("eq.inactive") : t("eq.active")) +
          "</div></div>" +
          '<div class="card"><h3>' + esc(t("eq.calibration")) + '</h3><div class="meta-list">' +
            m(t("eq.range"), range || "—") +
            m(t("eq.uom"), tag.uom || "—") +
            (tag.valveSize ? m(t("eq.valveSize"), tag.valveSize + '"') : "") +
            (tag.swHealthy ? m(t("eq.swHealthy"), tag.swHealthy) : "") +
            (tag.swActive ? m(t("eq.swActive"), tag.swActive) : "") +
            (tag.pcvSp ? m(t("eq.pcvSp"), tag.pcvSp) : "") +
            (tag.service ? m(t("eq.service"), tag.service) : "") +
            (tag.serial ? m(t("eq.serial"), tag.serial) : "") +
            (tag.comment ? m(t("eq.comment"), tag.comment) : "") +
          "</div></div>" +
          '<div class="card"><h3>' + esc(t("eq.timeline")) + "</h3>" +
            (events.length ? '<div class="timeline">' + events.slice(0, 40).map(function (e) {
              return '<div class="tl-item" data-goto="' + esc(e.id) + '" style="cursor:pointer">' +
                '<div class="t">' + esc(e.dateOnly ? global.Fmt.date(e.at) : global.Fmt.dateTime(e.at)) + "</div>" +
                '<div class="b">' + esc(e.text) + (e.who ? ' <span class="faint">· ' + esc(e.who) + "</span>" : "") + "</div></div>";
            }).join("") + "</div>" : '<p class="faint small">' + esc(t("eq.noHandovers")) + "</p>") +
          "</div>" +
        "</div>" +
      "</div>";

    function m(k, v) { return '<div class="m"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>"; }

    wireCards(view());
    $("#btn-back").addEventListener("click", function () { go("#/equipment"); });
    $("#new-for-tag").addEventListener("click", function () { go("#/handover/new"); });
    $("#edit-tag").addEventListener("click", function () {
      tagDialog({ tag: tag, onDone: function () { equipmentDetail(tagNo); } });
    });
    $$("[data-goto]").forEach(function (el) {
      el.addEventListener("click", function () { go("#/handover/" + el.getAttribute("data-goto")); });
    });
  }

  /* ============================ NOTIFICATIONS ============================ */

  function notifText(n) {
    var who = personName(n.actor);
    if (n.type === "handover") { return t("notif.newHandover", { user: who }); }
    if (n.type === "comment") { return t("notif.newComment", { user: who }); }
    if (n.type === "action") { return t("notif.action", { user: who }) + (n.text ? ": " + n.text : ""); }
    if (n.type === "actionDone") { return t("notif.actionDone", { user: who }) + (n.text ? ": " + n.text : ""); }
    if (n.type === "attachment") { return t("notif.newAttachment", { user: who }); }
    if (n.type === "deleted") { return t("notif.deleted", { user: who }); }
    if (n.type === "import") { return t("notif.imported", { user: who, n: n.count || "" }); }
    if (n.type === "status") { return t("notif.statusChanged", { user: who, status: t("status." + n.status) }); }
    return n.title || "";
  }

  /* Read state is kept in the database per person, so it follows them from
     phone to PC: everything up to "mark all as read", plus single ones opened. */
  function isUnread(n) { return S.isUnread(n); }
  function markRead(n) { S.markRead(n); }
  function markAllRead() { unseenSet = {}; return S.markAllRead(); }

  /* "Not seen yet" = a handover with an unread notification for this person
     (new handover, comment, attachment or status change by someone else).
     Opening the handover - from anywhere - marks those notifications read.
     The feed is read once and kept for 20 s so screens do not re-read the
     share on every click. */
  var notifCache = { at: 0, list: null };
  var unseenSet = {};

  async function recentNotifications(force) {
    if (!force && notifCache.list && Date.now() - notifCache.at < 20000) { return notifCache.list; }
    var list = [];
    try { list = await S.listNotifications(300); } catch (e) { list = notifCache.list || []; }
    notifCache = { at: Date.now(), list: list };
    return list;
  }

  async function unseenIds(force) {
    var me = global.App.user();
    var list = await recentNotifications(force);
    var set = {};
    list.forEach(function (n) { if (n.handoverId && isUnread(n, me)) { set[n.handoverId] = true; } });
    unseenSet = set;
    return set;
  }

  async function markHandoverSeen(id) {
    var me = global.App.user();
    var list = await recentNotifications(false);
    var changed = 0;
    list.forEach(function (n) {
      if (n.handoverId === id && isUnread(n, me)) { markRead(n, me); changed++; }
    });
    delete unseenSet[id];
    if (changed) {
      global.App.adjustUnread(-changed);
      global.App.refreshBadges();
    }
  }

  async function notifications() {
    view().innerHTML = '<div class="empty">' + esc(t("common.loading")) + "</div>";
    var list = await recentNotifications(true);
    var me = global.App.user();

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("notif.title")) + "</h1><p>" + esc(t("notif.sub")) + "</p></div>" +
        '<div class="spacer"></div><button class="btn" id="mark-all">' + esc(t("notif.markAll")) + "</button></div>" +
      (list.length ? '<div class="list">' + list.map(function (n) {
        var unread = isUnread(n, me);
        return '<div class="row-card' + (unread ? " unread" : "") + '" data-id="' + esc(n.handoverId || "") + '" data-nid="' + esc(n.id || "") + '"' +
          (unread ? ' style="border-inline-start:3px solid var(--accent)"' : "") + ">" +
          '<div class="r1"><h4>' + esc(notifText(n)) + "</h4>" +
            (unread ? '<span class="badge s-info unread-badge">' + esc(t("notif.unread")) + "</span>" : "") + "</div>" +
          (n.title ? '<div class="snippet">' + esc(n.title) + "</div>" : "") +
          '<div class="r2"><span>' + esc(global.Fmt.dateTime(n.at)) + "</span></div></div>";
      }).join("") + "</div>" : emptyBlock(t("notif.none")));

    var byId = {};
    list.forEach(function (n) { if (n.id) { byId[n.id] = n; } });

    $$(".row-card").forEach(function (el) {
      el.addEventListener("click", function () {
        var n = byId[el.getAttribute("data-nid")];
        if (n && isUnread(n, me)) {
          markRead(n, me);
          // Update the row and the counters straight away, before moving on.
          el.classList.remove("unread");
          el.style.borderInlineStart = "";
          var b = el.querySelector(".unread-badge");
          if (b) { b.remove(); }
          global.App.adjustUnread(-1);
          global.App.refreshBadges();
        }
        var id = el.getAttribute("data-id");
        if (id) { go("#/handover/" + id); }
      });
    });
    $("#mark-all").addEventListener("click", async function () {
      try { await markAllRead(me); } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.App.refreshBadges();
      notifications();
    });
  }

  /* ================================ PROFILE ================================ */

  async function profile() {
    var me = global.App.user();
    var st = S.structure();
    var all = await S.listHandovers();
    var mine = all.filter(function (h) { return h.createdBy && me && h.createdBy.id === me.id; });

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("profile.title")) + "</h1></div></div>" +
      '<div class="detail-grid"><div>' +
        '<div class="card">' +
          '<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">' +
            '<span class="avatar lg">' + esc(initials(personName(me))) + "</span>" +
            "<div><h3 style=\"margin:0\">" + esc(personName(me)) + "</h3>" +
            '<p class="faint small" style="margin:2px 0 0">' + esc(me && me.jobTitle ? me.jobTitle : "") + "</p></div>" +
          "</div>" +
          '<div class="meta-list">' +
            row(t("profile.employeeId"), me && me.employeeId) +
            row(t("profile.department"), me && me.department) +
            row(t("profile.role"), me && me.role ? t("role." + me.role) : "") +
          "</div>" +
          '<div class="btn-row" style="margin-top:16px">' +
            '<button class="btn" id="switch-user">' + esc(t("profile.switchUser")) + "</button>" +
            '<button class="btn ghost" id="sign-out">' + esc(t("profile.signOut")) + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="card"><h3>' + esc(t("profile.myHandovers")) + " (" + global.Fmt.num(mine.length) + ")</h3>" +
          (mine.length ? '<div class="list">' + mine.slice(0, 10).map(handoverCard).join("") + "</div>"
                       : '<p class="faint small">' + esc(t("ho.noneYet")) + "</p>") +
        "</div>" +
      "</div><div>" +
        '<div class="card"><h3>' + esc(t("auth.change")) + "</h3>" +
          '<div class="field"><label>' + esc(t("auth.currentPassword")) + "</label>" +
            '<input type="password" class="input" id="cp-old" autocomplete="current-password"></div>' +
          '<div class="field"><label>' + esc(t("auth.newPassword")) + "</label>" +
            '<input type="password" class="input" id="cp-new" autocomplete="new-password"></div>' +
          '<div class="field"><label>' + esc(t("auth.confirmPassword")) + "</label>" +
            '<input type="password" class="input" id="cp-new2" autocomplete="new-password"></div>' +
          '<div class="err-msg hidden" id="cp-err"></div>' +
          '<button class="btn" id="cp-save">' + esc(t("common.save")) + "</button></div>" +
        '<div class="card"><h3>' + esc(t("pwa.installTitle")) + "</h3>" +
          '<div class="small" id="install-help"></div></div>' +
        '<div class="card"><h3>' + esc(t("pwa.aboutTitle")) + "</h3>" +
          '<p class="small faint" style="margin:0">' + esc(t("pwa.about", { v: global.APP_VERSION || "" })) + "</p>" +
          '<div class="btn-row" style="margin-top:10px"><button class="btn sm ghost" id="app-update">' + esc(t("pwa.checkUpdate")) + "</button></div></div>" +
      "</div></div>";

    function row(k, v) {
      return '<div class="m"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v || "—") + "</span></div>";
    }

    wireCards(view());
    $("#switch-user").addEventListener("click", function () { global.App.pickUser(true); });
    $("#sign-out").addEventListener("click", function () { global.App.signOut(); });
    if (global.App.installHelp) { global.App.installHelp($("#install-help")); }
    $("#app-update").addEventListener("click", function () { if (global.App.checkUpdate) { global.App.checkUpdate(true); } });
    $("#cp-save").addEventListener("click", async function () {
      var err = $("#cp-err");
      var oldPw = $("#cp-old").value, a = $("#cp-new").value, b = $("#cp-new2").value;
      function fail(msg) { err.textContent = msg; err.classList.remove("hidden"); }
      err.classList.add("hidden");
      if (a.length < 6) { fail(t("auth.short")); return; }
      if (a !== b) { fail(t("auth.mismatch")); return; }
      global.UI.busy(true, t("common.saving"));
      try {
        await S.changePassword(oldPw, a);
        $("#cp-old").value = ""; $("#cp-new").value = ""; $("#cp-new2").value = "";
        global.UI.toast(t("auth.changed"), "ok");
      } catch (e) {
        if (e && e.name === "WrongPassword") { global.UI.busy(false); fail(t("auth.wrong")); return; }
        global.UI.toast(t("err.write"), "err");
      }
      global.UI.busy(false);
    });
  }

  /* ================================= ADMIN ================================= */

  async function admin() {
    if (!S.isAdmin()) { return adminGate(); }
    var st = S.structure();

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("admin.title")) + "</h1><p>" + esc(t("admin.sub")) + "</p></div>" +
      "</div>" +

      '<div class="card"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        "<div><h3>" + esc(t("area.manage")) + '</h3><p class="small faint" style="margin:0">' + esc(t("area.manageSub")) + "</p></div>" +
        '<div style="flex:1"></div><button class="btn" id="add-area">' + esc(t("area.add")) + "</button></div>" +
        '<div class="chips" id="area-chips" style="margin-top:12px"></div></div>' +

      '<div class="card"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        "<div><h3>" + esc(t("admin.staff")) + '</h3><p class="small faint" style="margin:0">' + esc(t("admin.staffSub")) + "</p></div>" +
        '<div style="flex:1"></div>' +
        '<button class="btn" id="load-staff">' + esc(t("admin.loadStaff")) + "</button>" +
        '<button class="btn primary" id="add-staff">' + esc(t("admin.addStaff")) + "</button></div>" +
        '<table class="table" style="margin-top:12px"><thead><tr>' +
          "<th>" + esc(t("profile.name")) + "</th><th>" + esc(t("profile.jobTitle")) + "</th>" +
          "<th>" + esc(t("profile.role")) + "</th><th>" + esc(t("profile.employeeId")) + "</th>" +
          "<th>" + esc(t("auth.password")) + "</th><th></th>" +
        '</tr></thead><tbody id="staff-body"></tbody></table></div>' +

      '<div class="card"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        "<div><h3>" + esc(t("admin.tags")) + '</h3><p class="small faint" style="margin:0" id="tag-count"></p></div>' +
        '<div style="flex:1"></div>' +
        '<button class="btn" id="add-tag">' + esc(t("eq.add")) + "</button>" +
        '<button class="btn" id="imp-btn">' + esc(t("admin.import")) + "</button>" +
        '<input type="file" id="imp-file" accept=".json,application/json" class="hidden"></div>' +
        '<p class="small faint" style="margin-top:10px">' + esc(t("admin.importDesc")) + "</p>" +
        '<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">' +
          '<div class="filters" style="margin-bottom:8px">' +
            '<input id="bulk-q" placeholder="' + esc(t("eq.searchPh")) + '" style="min-width:230px">' +
            '<select id="bulk-area">' + areaOptions("") + "</select>" +
            '<button class="btn sm" id="bulk-go">' + esc(t("admin.bulkArea")) + "</button>" +
          "</div>" +
          '<p class="small faint" id="bulk-count"></p>' +
        "</div></div>" +

      '<h3 style="margin:22px 0 4px">' + esc(t("db.sectionTitle")) + "</h3>" +
      '<p class="small faint" style="margin:0 0 12px">' + esc(t("db.sectionDesc")) + "</p>" +
      '<div class="db-cards">' + dbCard("engineers") + dbCard("managers") + "</div>" +

      '<div class="card"><h3>' + esc(t("del.adminTitle")) + "</h3>" +
        '<p class="small faint">' + esc(t("del.adminDesc")) + "</p>" +
        '<div class="btn-row" style="margin-bottom:10px"><button class="btn sm" id="del-restore-all">' + esc(t("del2.restoreAll")) + "</button>" +
          '<button class="btn sm danger" id="del-empty">' + esc(t("del2.emptyBin")) + "</button></div>" +
        '<div id="deleted-list"><p class="faint small">' + esc(t("common.loading")) + "</p></div></div>" +

      '<div class="card"><h3>' + esc(t("admin.backup")) + "</h3>" +
        '<p class="small faint">' + esc(t("admin.backupDesc")) + "</p>" +
        '<div class="btn-row"><button class="btn" id="backup">' + esc(t("admin.backup")) + "</button></div></div>" +

      '<div class="card"><h3>' + esc(t("folder.title")) + "</h3>" +
        '<p class="small faint">' + esc(t("folder.cardDesc")) + "</p>" +
        '<div class="btn-row"><button class="btn primary" id="move-open">' + esc(t("folder.open")) + "</button></div></div>" +

      '<div class="card"><h3>' + esc(t("del2.title")) + "</h3>" +
        '<p class="small faint">' + esc(t("del2.cardDesc")) + "</p>" +
        '<div class="btn-row"><button class="btn danger" id="delete-open">' + esc(t("del2.open")) + "</button></div></div>";

    /* ---- areas ---- */
    function renderAreas() {
      var areas = S.structure().areas || [];
      $("#area-chips").innerHTML = areas.length ? areas.map(function (a) {
        return '<span class="tag-chip">' + esc((a.en)) +
          ' <span class="x" data-rm-area="' + esc(a.id) + '">×</span></span>';
      }).join(" ") : '<span class="faint small">' + esc(t("common.none")) + "</span>";
      $$("[data-rm-area]").forEach(function (x) {
        x.addEventListener("click", async function () {
          var ok = await global.UI.confirm(t("area.removeConfirm"), { danger: true, okLabel: t("common.remove") });
          if (!ok) { return; }
          await S.removeArea(x.getAttribute("data-rm-area"));
          renderAreas();
        });
      });
    }
    renderAreas();
    $("#add-area").addEventListener("click", function () { newAreaDialog(renderAreas); });

    /* ---- staff ---- */
    function renderStaff() {
      var list = S.users();
      $("#staff-body").innerHTML = list.length ? list.map(function (u) {
        return "<tr" + (u.active === false ? ' style="opacity:.55"' : "") + ">" +
          "<td><b>" + esc(personName(u)) + "</b>" + (u.isAdmin ? ' <span class="badge s-info">' + esc(t("admin.adminBadge")) + "</span>" : "") + "</td>" +
          "<td>" + esc(u.jobTitle || "—") + "</td>" +
          "<td>" + esc(u.role ? t("role." + u.role) : "—") + "</td>" +
          "<td>" + esc(u.employeeId || "\u2014") + "</td>" +
          "<td>" + (!S.canSignIn(Object.assign({}, u, { active: true }))
            ? '<span class="small faint">' + esc(t("auth.noAccount")) + "</span>"
            : u.password
              ? '<span class="small">' + esc(global.Fmt.date(u.passwordSetAt)) + "</span>"
              : '<span class="small faint">' + esc(t("auth.noPassword")) + "</span>") + "</td>" +
          '<td class="actions">' +
            (u.password && S.canSignIn(Object.assign({}, u, { active: true })) ? '<button class="btn sm ghost" data-reset="' + esc(u.id) + '">' + esc(t("auth.reset")) + "</button> " : "") +
            '<button class="btn sm ghost" data-edit="' + esc(u.id) + '">' + esc(t("common.edit")) + "</button> " +
            '<button class="btn sm ghost" data-toggle="' + esc(u.id) + '">' +
              esc(u.active === false ? t("admin.activate") : t("admin.deactivate")) + "</button>" +
          "</td></tr>";
      }).join("") : '<tr><td colspan="6">' + emptyBlock(t("gate.who.empty")) + "</td></tr>";

      $$("[data-reset]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var u = S.userById(b.getAttribute("data-reset"));
          if (!u) { return; }
          var ok = await global.UI.confirm(t("auth.resetConfirm", { name: personName(u) }));
          if (!ok) { return; }
          global.UI.busy(true, t("common.saving"));
          try {
            await S.clearUserPassword(u.id);
            global.UI.toast(t("auth.resetDone"), "ok");
            renderStaff();
          } catch (e) { global.UI.toast(t("err.write"), "err"); }
          global.UI.busy(false);
        });
      });

      $$("[data-edit]").forEach(function (b) {
        b.addEventListener("click", function () { staffDialog(S.userById(b.getAttribute("data-edit")), renderStaff); });
      });
      $$("[data-toggle]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var id = b.getAttribute("data-toggle");
          var u = S.userById(id);
          await S.setUserActive(id, u ? (u.active === false) : true);
          renderStaff();
        });
      });
    }
    renderStaff();

    /* ---- tags ---- */
    function bulkMatches() {
      var q = global.Util.normalize($("#bulk-q").value);
      if (!q) { return []; }
      return S.tags().filter(function (tag) {
        return global.Util.normalize(
          tag.tagNo + " " + (tag.upper || "") + " " + (tag.descEn || "")
        ).indexOf(q) >= 0;
      });
    }
    function renderTagCount() {
      $("#tag-count").textContent = t("admin.tagCount", { n: global.Fmt.num(S.tags().length) });
      $("#bulk-count").textContent = t("admin.tagCount", { n: global.Fmt.num(bulkMatches().length) });
    }
    renderTagCount();

    $("#bulk-q").addEventListener("input", global.Util.debounce(renderTagCount, 220));
    $("#add-tag").addEventListener("click", function () { tagDialog({ onDone: renderTagCount }); });
    $("#bulk-go").addEventListener("click", async function () {
      var rows = bulkMatches();
      var area = $("#bulk-area").value;
      if (!rows.length) { return; }
      var ok = await global.UI.confirm(t("admin.bulkArea") + " — " + global.Fmt.num(rows.length));
      if (!ok) { return; }
      var ids = {};
      rows.forEach(function (r) { ids[r.tagNo] = true; });
      global.UI.busy(true, t("common.saving"));
      try {
        await S.bulkSetArea(Object.keys(ids), area);
        global.UI.toast(t("admin.bulkAreaDone", { n: global.Fmt.num(rows.length) }), "ok");
        renderTagCount();
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    });

    $("#imp-btn").addEventListener("click", function () { $("#imp-file").click(); });
    $("#imp-file").addEventListener("change", async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) { return; }
      global.UI.busy(true, t("common.loading"));
      try {
        var rows = JSON.parse(await file.text());
        if (!Array.isArray(rows)) { throw new Error("not-a-list"); }
        var res = await S.importTags(rows);
        global.UI.toast(t("admin.importDone", {
          added: global.Fmt.num(res.added), updated: global.Fmt.num(res.updated)
        }), "ok");
        renderTagCount();
      } catch (err) {
        global.UI.toast(t("admin.importBad"), "err");
      }
      global.UI.busy(false);
      $("#imp-file").value = "";
    });

    /* ---- settings ---- */
    $("#add-staff").addEventListener("click", function () { staffDialog(null, renderStaff); });
    $("#load-staff").addEventListener("click", async function () {
      global.UI.busy(true, t("common.saving"));
      try {
        var was = S.users().length;
        await S.loadStandardStaff();
        var added = S.users().length - was;
        global.UI.toast(added ? t("admin.loadStaffDone", { n: global.Fmt.num(added) }) : t("admin.loadStaffNone"), "ok");
        renderStaff();
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    });
    $("#backup").addEventListener("click", async function () {
      global.UI.busy(true);
      try {
        var bundle = await S.exportBackup();
        var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "handover-backup-" + global.Fmt.isoDay(new Date()) + ".json";
        document.body.appendChild(a); a.click(); a.remove();
        global.UI.toast(t("admin.backupDone"), "ok");
      } catch (e) { global.UI.toast(t("err.read"), "err"); }
      global.UI.busy(false);
    });
    /* ---- deleted handovers ---- */
    async function renderDeleted() {
      var list = [];
      try { list = await S.listDeleted(); } catch (e) { list = []; }
      $("#deleted-list").innerHTML = list.length
        ? '<table class="table"><thead><tr><th>' + esc(t("ho.title")) + "</th><th>" + esc(t("ho.createdBy")) + "</th>" +
            "<th>" + esc(t("del.deletedBy")) + "</th><th></th></tr></thead><tbody>" +
            list.map(function (d) {
              return "<tr><td><b>" + esc(d.title || "\u2014") + "</b>" +
                  (d.archived ? ' <span class="faint small">\u00b7 ' + esc(t("arc.badge")) + "</span>" : "") + "</td>" +
                "<td>" + esc(personName(d.createdBy)) + "</td>" +
                "<td>" + esc(personName(d.deletedBy)) + ' <span class="faint small">\u00b7 ' + esc(global.Fmt.dateTime(d.deletedAt)) + "</span></td>" +
                '<td class="actions"><button class="btn sm" data-restore="' + esc(d.id) + '">' + esc(t("del.restore")) + "</button></td></tr>";
            }).join("") + "</tbody></table>"
        : '<p class="faint small">' + esc(t("del.none")) + "</p>";
      $$("[data-restore]").forEach(function (b) {
        b.addEventListener("click", async function () {
          global.UI.busy(true, t("common.saving"));
          try {
            var rec = await S.restoreHandover(b.getAttribute("data-restore"), global.App.user());
            global.UI.toast(t("del.restored", { title: rec.title || "" }), "ok");
            renderDeleted();
          } catch (e) { global.UI.toast(t("err.write"), "err"); }
          global.UI.busy(false);
        });
      });
    }
    renderDeleted();
    $("#del-restore-all").addEventListener("click", async function () {
      var ok = await global.UI.confirm(t("del2.restoreAllConfirm"), { okLabel: t("del2.restoreAll") });
      if (!ok) { return; }
      global.UI.busy(true, t("common.saving"));
      try { var n = await S.restoreAll(); global.UI.toast(t("del2.restored", { n: global.Fmt.num(n) }), "ok"); }
      catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
      renderDeleted();
    });
    $("#del-empty").addEventListener("click", function () { go("#/delete-handovers?state=deleted"); });

    /* ---- imports, one set per database ---- */
    async function renderArchiveStatus() {
      try { await S.loadArchive(); } catch (e) { /* shown as none */ }
      ["engineers", "managers"].forEach(function (db) {
        var info = S.archiveInfo(db);
        var el = $("#arc-status-" + db);
        if (el) {
          el.textContent = info
            ? t("arc.current", { n: global.Fmt.num(info.count), date: global.Fmt.dateTime(info.importedAt), by: info.by || "\u2014" })
            : t("arc.none");
        }
      });
    }
    renderArchiveStatus();
    $$("[data-bulk-tpl]").forEach(function (b) { b.addEventListener("click", function () { downloadTemplate(true); }); });
    $$("[data-bulk-open]").forEach(function (b) {
      b.addEventListener("click", function () { go("#/handover/import?mode=admin&db=" + b.getAttribute("data-bulk-open")); });
    });
    $$("[data-arc-clear]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var db = b.getAttribute("data-arc-clear");
        var info = S.archiveInfo(db);
        var n = info ? info.count : 0;
        if (!n) { global.UI.toast(t("arc.clearNone")); return; }
        var ok = await global.UI.confirm(t("arc.clearConfirm", { n: global.Fmt.num(n), db: t("view.pill." + db) }),
          { title: t("arc.clear"), okLabel: t("arc.clearGo", { n: global.Fmt.num(n) }), danger: true });
        if (!ok) { return; }
        global.UI.busy(true, t("arc.clearing", { n: 0 }));
        try {
          var done = await S.clearArchive(db, function (k) {
            var el = document.getElementById("busy-label");
            if (el) { el.textContent = t("arc.clearing", { n: global.Fmt.num(k) }); }
          });
          global.UI.toast(t("arc.cleared", { n: global.Fmt.num(done) }), "ok");
        } catch (e) { global.UI.toast(t("err.write") + " " + ((e && e.message) || ""), "err"); }
        global.UI.busy(false);
        renderArchiveStatus();
      });
    });
    $$("[data-arc-open]").forEach(function (b) {
      b.addEventListener("click", function () { go("#/archive-import?db=" + b.getAttribute("data-arc-open")); });
    });

    $("#move-open").addEventListener("click", function () { go("#/move-data"); });
    $("#delete-open").addEventListener("click", function () { go("#/delete-handovers"); });
  }

  function dbCard(db) {
    return '<div class="card db-card v-' + db + '"><h3>' + esc(t("view.pill." + db)) + "</h3>" +
      '<p class="small faint" style="margin:0">' + esc(t("db.desc." + db)) + "</p>" +
      "<h4>" + esc(t("db.archive")) + "</h4>" +
      '<p class="small" id="arc-status-' + db + '" style="margin:0 0 4px"></p>' +
      '<p class="small faint" style="margin:0 0 8px">' + esc(t("db.archiveDesc")) + "</p>" +
      '<div class="btn-row"><button class="btn" id="arc-open-' + db + '" data-arc-open="' + db + '">' + esc(t("db.archiveOpen")) + "</button>" +
        '<button class="btn danger ghost" id="arc-clear-' + db + '" data-arc-clear="' + db + '">' + esc(t("arc.clear")) + "</button></div>" +
      "<h4>" + esc(t("db.bulk")) + "</h4>" +
      '<p class="small faint" style="margin:0 0 8px">' + esc(t("db.bulkDesc." + db)) + "</p>" +
      '<div class="btn-row"><button class="btn" id="bulk-tpl-' + db + '" data-bulk-tpl="' + db + '">' + esc(t("imp.adminDownload")) + "</button>" +
        '<button class="btn primary" id="bulk-open-' + db + '" data-bulk-open="' + db + '">' + esc(t("imp.adminOpen")) + "</button></div>" +
      "</div>";
  }

  function adminGate() {
    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("admin.title")) + "</h1></div></div>" +
      '<div class="card" style="max-width:480px">' +
        "<h3>" + esc(t("admin.locked")) + "</h3>" +
        '<p class="small faint">' + esc(t("admin.onlyAdmins")) + "</p>" +
      "</div>";
  }

  function staffDialog(existing, onDone) {
    var roles = ["administrator", "manager", "supervisor", "engineer", "technician", "viewer"];
    var body = document.createElement("div");
    body.innerHTML =
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("admin.nameEn")) + ' <span class="req">*</span></label><input class="input" id="s-en"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("profile.employeeId")) + '</label><input class="input" id="s-emp"></div>' +
        '<div class="field"><label>' + esc(t("profile.jobTitle")) + '</label><input class="input" id="s-job"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label>' + esc(t("profile.department")) + '</label><input class="input" id="s-dep"></div>' +
        '<div class="field"><label>' + esc(t("profile.role")) + "</label>" +
          '<select class="input" id="s-role">' + roles.map(function (r) {
            return '<option value="' + r + '">' + esc(t("role." + r)) + "</option>";
          }).join("") + "</select></div>" +
      "</div>" +
      '<label class="check-line"><input type="checkbox" id="s-admin"> <span>' + esc(t("admin.isAdmin")) + "</span></label>" +
      '<p class="small faint" style="margin:4px 0 0">' + esc(t("admin.isAdminDesc")) + "</p>" +
      '<div class="err-msg hidden" id="s-err"></div>';

    if (existing) {
      body.querySelector("#s-en").value = existing.name || "";
      body.querySelector("#s-emp").value = existing.employeeId || "";
      body.querySelector("#s-job").value = existing.jobTitle || "";
      body.querySelector("#s-dep").value = existing.department || "";
      body.querySelector("#s-role").value = existing.role || "engineer";
      body.querySelector("#s-admin").checked = !!existing.isAdmin;
    }

    global.UI.modal({
      title: existing ? t("admin.editStaff") : t("admin.addStaff"),
      body: body, wide: true,
      buttons: [
        { label: t("common.cancel"), value: null },
        {
          label: t("common.save"), primary: true,
          before: function (b) {
            var name = $("#s-en", b).value.trim();
            if (!name) {
              $("#s-err", b).textContent = t("err.nameRequired");
              $("#s-err", b).classList.remove("hidden");
              return false;
            }
            return {
              id: existing ? existing.id : global.Util.uuid(),
              name: name,
              employeeId: $("#s-emp", b).value.trim(),
              jobTitle: $("#s-job", b).value.trim(),
              department: $("#s-dep", b).value.trim(),
              role: $("#s-role", b).value,
              isAdmin: $("#s-admin", b).checked,
              active: existing ? (existing.active !== false) : true,
              createdAt: existing ? existing.createdAt : new Date().toISOString()
            };
          }
        }
      ]
    }).then(async function (user) {
      if (!user) { return; }
      global.UI.busy(true, t("common.saving"));
      try {
        await S.upsertUser(user);
        global.UI.toast(t("admin.staffSaved"), "ok");
        if (onDone) { onDone(); }
      } catch (e) { global.UI.toast(t("err.write"), "err"); }
      global.UI.busy(false);
    });
  }

  /* ================================ SEARCH ================================ */

  async function search(q) {
    var query = global.Util.normalize(q);
    view().innerHTML = '<div class="empty">' + esc(t("common.loading")) + "</div>";
    if (!query) { view().innerHTML = emptyBlock(t("search.none")); return; }

    var all = await S.listHandovers();
    var hoHits = all.filter(function (h) { return S.searchText(h).indexOf(query) >= 0; });
    try {
      var seen = {};
      hoHits.forEach(function (h) { seen[h.id] = true; });
      var byIdAll = {};
      all.forEach(function (h) { byIdAll[h.id] = h; });
      (await S.searchIds(q.trim())).forEach(function (id) {
        if (!seen[id] && byIdAll[id]) { seen[id] = true; hoHits.push(byIdAll[id]); }
      });
    } catch (e) { /* offline: the list search above still works */ }
    var tagHits = S.tags().filter(function (tag) {
      return global.Util.normalize(tag.tagNo + " " + tag.descEn).indexOf(query) >= 0;
    });
    var peopleHits = S.users().filter(function (u) {
      return global.Util.normalize(u.name + " " + (u.jobTitle || "")).indexOf(query) >= 0;
    });

    var commentHits = [];
    try { commentHits = await S.searchComments(q.trim()); } catch (e) { commentHits = []; }

    var total = hoHits.length + tagHits.length + peopleHits.length + commentHits.length;

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("search.title")) + "</h1><p>" + esc(t("search.for", { q: q })) + "</p></div></div>" +
      (total === 0 ? emptyBlock(t("search.none")) :
        (hoHits.length ? "<h3>" + esc(t("search.handovers")) + " (" + global.Fmt.num(hoHits.length) + ')</h3><div class="list" style="margin-bottom:18px">' +
          hoHits.slice(0, 25).map(handoverCard).join("") + "</div>" +
          (hoHits.length > 25
            ? '<div style="margin:-6px 0 18px"><button class="btn sm" id="s-all">' + esc(t("arc.viewAll", { n: global.Fmt.num(hoHits.length) })) + "</button></div>"
            : "") : "") +
        (tagHits.length ? "<h3>" + esc(t("search.tags")) + " (" + global.Fmt.num(tagHits.length) + ')</h3><div class="chips" style="margin-bottom:18px">' +
          tagHits.slice(0, 40).map(function (tag) { return tagChip(tag.tagNo, { link: true }); }).join(" ") + "</div>" : "") +
        (commentHits.length ? "<h3>" + esc(t("search.comments")) + " (" + global.Fmt.num(commentHits.length) + ')</h3><div class="card" style="margin-bottom:18px">' +
          commentHits.slice(0, 20).map(function (c) {
            return '<div class="comment" data-id="' + esc(c.handoverId) + '" style="cursor:pointer">' +
              '<span class="avatar">' + esc(initials(personName(c.by))) + "</span>" +
              '<div class="c-body"><div class="c-head"><b>' + esc(personName(c.by)) + "</b>" +
              '<span class="faint small">' + esc(c.title) + " · " + esc(global.Fmt.dateTime(c.at)) + "</span></div>" +
              '<div class="c-text">' + esc(c.text.slice(0, 220)) + "</div></div></div>";
          }).join("") + "</div>" : "") +
        (peopleHits.length ? "<h3>" + esc(t("search.people")) + '</h3><div class="card">' +
          peopleHits.map(function (u) {
            return '<div style="display:flex;gap:10px;align-items:center;padding:7px 0">' +
              '<span class="avatar">' + esc(initials(personName(u))) + "</span><div><b>" + esc(personName(u)) + "</b>" +
              '<div class="faint small">' + esc(u.jobTitle || "") + "</div></div></div>";
          }).join("") + "</div>" : "")
      );

    wireCards(view());
    if ($("#s-all")) {
      $("#s-all").addEventListener("click", function () {
        listFilters = { q: q, status: "", area: "", from: "", to: "", creator: "", worked: "", tag: "", src: "", mine: false };
        go("#/handovers");
      });
    }
    $$(".comment[data-id]").forEach(function (el) {
      el.addEventListener("click", function () { go("#/handover/" + el.getAttribute("data-id")); });
    });
  }


  /* ============================ EXCEL IMPORT ============================ */

  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* The templates read their dropdowns (Area, Written by, Worked with) from a
     hidden "Lists" sheet through named ranges that grow with the list. Here
     that sheet is rewritten with the areas and staff currently in the shared
     folder, so a template downloaded today always offers today's choices. */
  function templateWithLiveLists(b64) {
    var X = global.XLSX;
    var cfb = X.CFB.read(b64, { type: "base64" });
    var dec = new TextDecoder("utf-8");
    function read(p) { var e = X.CFB.find(cfb, "/" + p); return e ? dec.decode(e.content) : ""; }
    function write(p, xml) {
      var e = X.CFB.find(cfb, "/" + p);
      if (!e) { return false; }
      e.content = new TextEncoder().encode(xml);
      e.size = e.content.length;
      return true;
    }
    function sheetPath(name) {
      var tag = new RegExp('<sheet\\b[^>]*\\bname="' + name + '"[^>]*>').exec(read("xl/workbook.xml"));
      if (!tag) { return null; }
      var rid = /r:id="([^"]+)"/.exec(tag[0])[1];
      var rel = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>').exec(read("xl/_rels/workbook.xml.rels"));
      if (!rel) { return null; }
      var target = /Target="([^"]+)"/.exec(rel[0])[1];
      return target.charAt(0) === "/" ? target.slice(1) : "xl/" + target;
    }
    var listsPath = sheetPath("Lists");
    if (!listsPath) { return null; }

    var byName = function (a, b) { return String(a).localeCompare(String(b)); };
    var active = S.users().filter(function (u) { return u.active !== false; });
    var cols = {
      A: ["Areas"].concat((S.structure().areas || []).map(function (a) { return a.id; })),
      B: ["Status", "Info", "Info & Follow-up", "Draft"],
      C: ["Authors"].concat(active.filter(function (u) { return ["engineer", "manager", "administrator"].indexOf(u.role) >= 0; })
                                  .map(function (u) { return u.name; }).sort(byName)),
      D: ["Staff"].concat(active.map(function (u) { return u.name; }).sort(byName))
    };
    var letters = Object.keys(cols);
    var n = Math.max.apply(null, letters.map(function (l) { return cols[l].length; }));
    var rows = "";
    for (var r = 0; r < n; r++) {
      var cells = "";
      letters.forEach(function (l) {
        var v = cols[l][r];
        if (v !== undefined && v !== "") { cells += '<c r="' + l + (r + 1) + '" t="inlineStr"><is><t>' + xmlEsc(v) + "</t></is></c>"; }
      });
      rows += '<row r="' + (r + 1) + '">' + cells + "</row>";
    }
    write(listsPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D' + n + '"/>' +
      "<sheetData>" + rows + "</sheetData></worksheet>");

    return X.CFB.write(cfb, { fileType: "zip", type: "array", compression: true });
  }

  /* The Excel reader (large) is loaded only when an import or template is used. */
  function downloadTemplate(admin) {
    global.App.needXlsx().then(function () { downloadTemplateNow(admin); },
      function () { global.UI.toast(t("imp.noReader"), "err"); });
  }

  function downloadTemplateNow(admin) {
    var b64 = admin ? global.HANDOVER_IMPORT_TEMPLATE_ADMIN : global.HANDOVER_IMPORT_TEMPLATE;
    if (!b64) { global.UI.toast(t("err.read"), "err"); return; }
    var bytes = null;
    try { bytes = global.XLSX ? templateWithLiveLists(b64) : null; }
    catch (e) { S.log("template: could not insert live lists", e && e.message); bytes = null; }
    if (!bytes) {      // fall back to the template as shipped
      var bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    }
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = admin ? "Handover_Bulk_Import_Template_Admin.xlsx" : "Handover_Import_Template.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  var IMPORT_MAX = 500, IMPORT_MAX_ADMIN = 3000;

  function normHeader(s) { return String(s || "").toLowerCase().replace(/[*:]/g, "").replace(/\s+/g, " ").trim(); }
  function normText(s) { return String(s === null || s === undefined ? "" : s).replace(/\r\n?/g, "\n").trim(); }

  /* Excel serial number, a Date, or text such as 14/10/2026, 14-10-2026,
     2026-10-14 or "14 Oct 2026" -> {y, m, d}. Day comes first, as in Egypt. */
  function parseSheetDate(v) {
    if (v === null || v === undefined || v === "") { return null; }
    if (typeof v === "number" && global.XLSX) {
      var p = global.XLSX.SSF.parse_date_code(v);
      return p ? { y: p.y, m: p.m, d: p.d } : null;
    }
    if (v instanceof Date && !isNaN(v)) { return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() }; }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) { return okDate(+m[1], +m[2], +m[3]); }
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))) {
      var y = +m[3]; if (y < 100) { y += 2000; }
      return okDate(y, +m[2], +m[1]);
    }
    var t2 = Date.parse(s);
    if (!isNaN(t2)) { var d = new Date(t2); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
    return null;
  }
  function okDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) { return null; }
    var dt = new Date(y, m - 1, d);
    return dt.getMonth() === m - 1 ? { y: y, m: m, d: d } : null;
  }
  function ymdIso(p) { return new Date(p.y, p.m - 1, p.d, 12, 0, 0).toISOString(); }
  function ymdDay(p) { return p.y + "-" + String(p.m).padStart(2, "0") + "-" + String(p.d).padStart(2, "0"); }

  function splitList(v) {
    return normText(v).split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Full name, or any part of it ("Walid", "Sayed Hamed") when only one
     person matches. Active staff win over people who have left. */
  function personCandidates(name) {
    var n = global.Util.normalize(name);
    if (!n) { return []; }
    var list = S.users();
    var exact = list.filter(function (u) { return global.Util.normalize(u.name) === n; });
    if (exact.length) { return exact.slice(0, 1); }
    var partial = list.filter(function (u) {
      var un = global.Util.normalize(u.name);
      return un.indexOf(n) === 0 || (" " + un + " ").indexOf(" " + n + " ") >= 0;
    });
    // Same tolerance as the old-sheet import: initials and "El"/"Abdel"
    // spellings ignored, so "K. Nabil" or "Abd Elrazek" still find the person.
    if (!partial.length) {
      var tk = nameTokens(name), comp = tk.join("");
      if (tk.length) {
        partial = list.filter(function (u) {
          var ut = nameTokens(u.name);
          return tk.every(function (x) { return ut.indexOf(x) >= 0; }) || (comp.length >= 5 && ut.join("").indexOf(comp) >= 0);
        });
      }
    }
    var act = partial.filter(function (u) { return u.active !== false; });
    return act.length ? act : partial;
  }
  function whoIs(raw, many) {
    var n = global.Util.normalize(raw);
    var first = function (x) { return global.Util.normalize(x.name).indexOf(n) === 0 ? 0 : 1; };
    many = many.slice().sort(function (a, b) { return first(a) - first(b) || a.name.localeCompare(b.name); });
    var names = many.slice(0, 4).map(function (x) { return x.name; });
    if (many.length > 4) { names.push("+" + (many.length - 4)); }
    return t("imp.whoIs", { v: raw, list: names.join(", ") });
  }
  function matchPerson(name) {
    var c = personCandidates(name);
    return c.length === 1 ? c[0] : null;
  }

  /* Same author + same day + same title = the same handover. The author is
     their staff id, or their written name for former colleagues. */
  function authorKey(p) { return p && p.id ? "id:" + p.id : "name:" + global.Util.normalize(p && p.name); }
  function dupKey(author, day, title) { return authorKey(author) + "|" + day + "|" + global.Util.normalize(title); }

  /* Reads the workbook and checks every row; nothing is saved here.
     admin = the bulk template, with a "Written by" column per row. */
  function analyseWorkbook(wb, existing, admin) {
    var me = global.App.user();
    var name = wb.SheetNames.filter(function (n) { return /^handovers?$/i.test(n); })[0] ||
               wb.SheetNames.filter(function (n) { return !/^(how to fill|lists)$/i.test(n); })[0];
    var rows = global.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    var hIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      if (rows[i].some(function (c) { return normHeader(c) === "title"; })) { hIdx = i; break; }
    }
    var noHeader = admin ? t("imp.noHeaderAdmin") : t("imp.noHeader");
    if (hIdx < 0) { return { error: noHeader }; }
    var col = {};
    rows[hIdx].forEach(function (c, j) {
      var h = normHeader(c);
      if (h === "date") { col.date = j; }
      else if (h === "written by" || h === "author" || h === "by" || h === "engineer") { col.by = j; }
      else if (h === "title") { col.title = j; }
      else if (h === "description") { col.desc = j; }
      else if (h === "area") { col.area = j; }
      else if (h === "status") { col.status = j; }
      else if (h === "equipment tags" || h === "tags" || h === "tag") { col.tags = j; }
      else if (h === "worked with" || h === "team" || /^worked with \d+$/.test(h)) { (col.team = col.team || []).push(j); }
      else if (h === "due date" || h === "due") { col.due = j; }
      else if (h === "action required" || h === "actions required" || h === "actions") { col.act = j; }
    });
    if (col.date === undefined || col.desc === undefined || (admin && col.by === undefined)) { return { error: noHeader }; }

    var areas = S.structure().areas || [];
    var seen = {};
    (existing || []).forEach(function (h) {
      if (!h.createdBy || !h.createdAt) { return; }
      if (!admin && !(me && h.createdBy.id === me.id)) { return; }
      seen[dupKey(h.createdBy, global.Fmt.isoDay(h.createdAt), h.title)] = true;
    });
    var out = [];
    for (var r = hIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      var get = function (k) {
        if (col[k] === undefined) { return ""; }
        if (Array.isArray(col[k])) { return col[k].map(function (j) { return normText(row[j]); }).filter(Boolean).join(", "); }
        return row[col[k]];
      };
      if (!row.some(function (c) { return normText(c) !== ""; })) { continue; }
      var it = { line: r + 1, errors: [], warnings: [], tags: [], newTags: [], team: [] };
      var d = parseSheetDate(get("date"));
      if (!normText(get("date"))) { it.errors.push(t("imp.eDate")); }
      else if (!d) { it.errors.push(t("imp.eDateBad", { v: normText(get("date")) })); }
      else {
        it.date = d;
        if (new Date(d.y, d.m - 1, d.d) > new Date()) { it.warnings.push(t("imp.wFuture")); }
      }

      if (admin) {
        var byTxt = normText(get("by"));
        if (!byTxt) { it.errors.push(t("imp.eBy")); }
        else {
          var u0 = matchPerson(byTxt);
          var many = u0 ? [] : personCandidates(byTxt);
          if (many.length > 1) {
            it.errors.push(t("imp.eByAmbig", { v: whoIs(byTxt, many) }));
          } else if (u0) { it.author = { id: u0.id, name: u0.name, role: u0.role || "" }; }
          else { it.author = { id: null, name: byTxt, role: "" }; it.warnings.push(t("imp.wBy", { v: byTxt })); }
        }
      } else if (me) {
        it.author = { id: me.id, name: me.name, role: me.role || "" };
      }

      it.title = normText(get("title"));
      it.desc = normText(get("desc"));
      // Actions required: one per line (or separated by ";").
      it.actions = normText(get("act")).split(/\s*(?:\n|;)\s*/).map(function (x) { return x.replace(/^(?:[-\u2022*]+\s*|\d+[.)]\s+)/, "").trim(); }).filter(Boolean);
      if (!it.title) { it.errors.push(t("imp.eTitle")); }
      if (it.title.length > 160) { it.title = it.title.slice(0, 160); it.warnings.push(t("imp.wTitleLong")); }
      if (!it.desc) { it.errors.push(t("imp.eDesc")); }

      var st = global.Util.normalize(get("status"));
      if (!st || st === "info") { it.status = "info"; }
      else if (/fol+o?w/.test(st)) { it.status = S.FOLLOWUP; }
      else if (st === "draft") { it.status = "draft"; }
      else { it.errors.push(t("imp.eStatus", { v: normText(get("status")) })); }

      var areaTxt = normText(get("area"));
      if (areaTxt) {
        var hit = areas.filter(function (a) {
          return a.id.toLowerCase() === areaTxt.toLowerCase() || String(a.en || "").toLowerCase() === areaTxt.toLowerCase();
        })[0];
        if (hit) { it.area = hit.id; }
        else { it.area = areaTxt.toUpperCase(); it.newArea = true; it.warnings.push(t("imp.wArea", { v: it.area })); }
      } else { it.area = ""; }

      splitList(get("tags")).forEach(function (raw) {
        var no = raw.toUpperCase().replace(/\s+/g, "");
        var tg = S.tagByNumber(no);
        if (tg) { if (it.tags.indexOf(tg.tagNo) < 0) { it.tags.push(tg.tagNo); } }
        else if (it.tags.indexOf(no) < 0) { it.tags.push(no); it.newTags.push(no); }
      });
      if (it.newTags.length) { it.warnings.push(t("imp.wTags", { v: it.newTags.join(", ") })); }

      var unknown = [];
      var ambiguous = [];
      splitList(get("team")).forEach(function (raw) {
        var u = matchPerson(raw);
        if (u && it.author && u.id === it.author.id) { return; }
        if (!u && it.author && global.Util.normalize(raw) === global.Util.normalize(it.author.name)) { return; }
        if (u) {
          if (!it.team.some(function (m) { return m.id === u.id; })) {
            it.team.push({ id: u.id, name: u.name, role: u.role || "technician", jobTitle: u.jobTitle || "" });
          }
        } else if (personCandidates(raw).length > 1) {
          ambiguous.push(whoIs(raw, personCandidates(raw)));
        } else { unknown.push(raw); it.team.push({ id: null, name: raw }); }
      });
      if (unknown.length) { it.warnings.push(t("imp.wTeam", { v: unknown.join(", ") })); }
      if (ambiguous.length) { it.warnings.push(t("imp.wTeamAmbig", { v: ambiguous.join("; ") })); }

      var dueTxt = normText(get("due"));
      if (dueTxt) {
        var dd = parseSheetDate(get("due"));
        if (dd) { it.due = ymdDay(dd); } else { it.warnings.push(t("imp.wDue", { v: dueTxt })); }
      }

      if (it.date && it.title && it.author) {
        var key = dupKey(it.author, ymdDay(it.date), it.title);
        if (seen[key]) { it.skip = true; it.warnings.push(admin ? t("imp.wDupAdmin") : t("imp.wDup")); }
        seen[key] = true;
      }
      it.ok = !it.errors.length && !it.skip;
      out.push(it);
    }
    var max = admin ? IMPORT_MAX_ADMIN : IMPORT_MAX;
    if (out.length > max) { return { error: t("imp.tooMany", { n: global.Fmt.num(max) }) }; }
    return { sheet: name, items: out };
  }

  /* A file dropped anywhere on the import page is imported; on other pages
     a stray drop must not make the browser leave the app to open the file. */
  var importDropTarget = null, pageDropInstalled = false;
  function installPageDrop() {
    if (pageDropInstalled) { return; }
    pageDropInstalled = true;
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; };
    document.addEventListener("dragover", function (e) {
      if (!hasFiles(e) || e.defaultPrevented) { return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = $("#imp-drop") ? "copy" : "none";
    });
    document.addEventListener("drop", function (e) {
      if (!hasFiles(e) || e.defaultPrevented) { return; }
      e.preventDefault();
      if ($("#imp-drop") && importDropTarget) { importDropTarget(e.dataTransfer.files); }
    });
  }

  async function handoverImport(query) {
    var me = global.App.user();
    var admin = !!(query && query.mode === "admin");
    var db = admin ? (query.db === "managers" ? "managers" : "engineers") : "";
    if (!global.XLSX) { view().innerHTML = emptyBlock(t("imp.noReader")); return; }
    if (admin && !S.isAdmin()) {
      view().innerHTML = emptyBlock(t("imp.adminLocked")) +
        '<div style="text-align:center"><button class="btn primary" id="imp-unlock">' + esc(t("nav.admin")) + "</button></div>";
      $("#imp-unlock").addEventListener("click", function () { go("#/admin"); });
      return;
    }
    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t(admin ? "imp.adminTitle" : "imp.title")) +
        (admin ? '<span class="view-pill v-' + db + '">' + esc(t("view.pill." + db)) + "</span>" : viewPill()) + "</h1><p>" +
        esc(admin ? t("imp.adminSubDb." + db) : t("imp.sub")) + "</p></div>" +
        '<div class="spacer"></div><button class="btn ghost" id="imp-back">' + esc(t("common.back")) + "</button></div>" +
      '<div class="grid two">' +
        '<div class="card"><h3>' + esc(t("imp.step1")) + "</h3>" +
          '<p class="small faint">' + esc(t(admin ? "imp.adminStep1Desc" : "imp.step1Desc")) + "</p>" +
          '<button class="btn" id="imp-tpl">' + esc(t(admin ? "imp.adminDownload" : "imp.download")) + "</button></div>" +
        '<div class="card"><h3>' + esc(t("imp.step2")) + "</h3>" +
          '<p class="small faint">' + esc(admin ? t("imp.adminStep2Desc") : (isMgr() ? t(inMgrView() ? "imp.step2DescMgr" : "imp.step2DescMgrChoose") : t("imp.step2Desc"))) + "</p>" +
          '<div class="dropzone imp-drop" id="imp-drop">' +
            '<div class="imp-drop-icon" aria-hidden="true">&#8681;</div>' +
            '<div class="imp-drop-text">' + esc(t("imp.dropHere")) + "</div>" +
            '<div class="small faint" style="margin:6px 0 10px">' + esc(t("imp.or")) + "</div>" +
            '<button class="btn primary" id="imp-pick" type="button">' + esc(t("imp.choose")) + "</button>" +
          "</div>" +
          '<input type="file" id="imp-file" accept=".xlsx,.xls,.xlsm,.csv" class="hidden"></div>' +
      "</div>" +
      '<div id="imp-result" style="margin-top:16px"></div>';

    $("#imp-back").addEventListener("click", function () { go(admin ? "#/admin" : "#/handovers"); });
    $("#imp-tpl").addEventListener("click", function () { downloadTemplate(admin); });
    $("#imp-pick").addEventListener("click", function (e) { e.stopPropagation(); $("#imp-file").click(); });
    $("#imp-file").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) { handleFile(file); }
    });

    // Drag and drop: onto the box, or anywhere on this page.
    var zone = $("#imp-drop"), depth = 0;
    zone.addEventListener("click", function () { $("#imp-file").click(); });
    zone.addEventListener("dragenter", function (e) { e.preventDefault(); depth++; zone.classList.add("over"); });
    zone.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; zone.classList.remove("over"); } });
    zone.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      depth = 0; zone.classList.remove("over");
      droppedFiles(e.dataTransfer && e.dataTransfer.files);
    });
    importDropTarget = droppedFiles;
    installPageDrop();

    function droppedFiles(files) {
      if (!files || !files.length) { return; }
      if (files.length > 1) { global.UI.toast(t("imp.dropOne"), "err"); return; }
      if (!/\.(xlsx|xlsm|xls|csv)$/i.test(files[0].name)) { global.UI.toast(t("imp.dropType", { v: files[0].name }), "err"); return; }
      handleFile(files[0]);
    }

    async function handleFile(file) {
      var res;
      global.UI.busy(true, t("common.loading"));
      try {
        var wb = global.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: false });
        res = analyseWorkbook(wb, admin ? await S.allHeaders() : await S.listHandovers(), admin);
      } catch (err) {
        S.log("excel import: could not read", err && err.message);
        res = { error: t("imp.badFile") };
      }
      global.UI.busy(false);
      showPreview(file.name, res);
    }

    function showPreview(fileName, res) {
      var box = $("#imp-result");
      if (res.error) { box.innerHTML = '<div class="card"><p class="err-msg">' + esc(res.error) + "</p></div>"; return; }
      var items = res.items;
      var ready = items.filter(function (x) { return x.ok; });
      var skipped = items.length - ready.length;
      var warned = ready.filter(function (x) { return x.warnings.length; }).length;
      var authors = {};
      ready.forEach(function (x) { authors[authorKey(x.author)] = true; });
      box.innerHTML =
        '<div class="card">' +
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
            "<div><h3 style=\"margin:0\">" + esc(t("imp.preview", { file: fileName })) + "</h3>" +
            '<p class="small faint" style="margin:4px 0 0">' +
              esc(t("imp.summary", { ok: global.Fmt.num(ready.length), warn: global.Fmt.num(warned), skip: global.Fmt.num(skipped) })) +
              (admin ? " · " + esc(t("imp.authors", { n: global.Fmt.num(Object.keys(authors).length) })) : "") + "</p></div>" +
            '<div class="spacer" style="flex:1"></div>' +
            '<button class="btn primary" id="imp-go"' + (ready.length ? "" : " disabled") + ">" +
              esc(t("imp.go", { n: global.Fmt.num(ready.length) })) + "</button>" +
          "</div>" +
          '<div style="overflow:auto;margin-top:12px"><table class="table imp-table"><thead><tr>' +
            "<th>" + esc(t("imp.row")) + "</th><th>" + esc(t("imp.date")) + "</th>" +
            (admin ? "<th>" + esc(t("imp.byCol")) + "</th>" : "") +
            "<th>" + esc(t("ho.title")) + "</th>" +
            "<th>" + esc(t("ho.area")) + "</th><th>" + esc(t("ho.status")) + "</th><th>" + esc(t("ho.tags")) + "</th>" +
            "<th>" + esc(t("ho.team")) + "</th><th>" + esc(t("imp.notes")) + "</th>" +
          "</tr></thead><tbody>" +
          items.map(function (x) {
            var cls = x.errors.length || x.skip ? "imp-bad" : (x.warnings.length ? "imp-warn" : "imp-ok");
            return '<tr class="' + cls + '"><td>' + x.line + "</td>" +
              "<td>" + esc(x.date ? global.Fmt.date(ymdIso(x.date)) : "—") + "</td>" +
              (admin ? "<td>" + esc(x.author ? x.author.name : "—") + "</td>" : "") +
              "<td>" + esc(x.title || "—") + (x.actions.length ? '<div class="act-count" style="margin-top:4px">' + esc(t("act.openCount", { n: x.actions.length })) + "</div>" : "") + "</td>" +
              "<td>" + esc(x.area || "—") + "</td>" +
              "<td>" + (x.status ? statusBadge(x.status) : "—") + "</td>" +
              "<td>" + esc(x.tags.join(", ") || "—") + "</td>" +
              "<td>" + esc(x.team.map(function (m) { return m.name; }).join(", ") || "—") + "</td>" +
              "<td>" + x.errors.map(function (m) { return '<div class="imp-e">' + esc(m) + "</div>"; }).join("") +
                       x.warnings.map(function (m) { return '<div class="imp-w">' + esc(m) + "</div>"; }).join("") +
                       (!x.errors.length && !x.warnings.length ? '<span class="faint">' + esc(t("imp.okRow")) + "</span>" : "") + "</td></tr>";
          }).join("") +
          "</tbody></table></div></div>";
      if (ready.length) { $("#imp-go").addEventListener("click", function () { runImport(ready, Object.keys(authors).length); }); }
    }

    async function runImport(ready, authorCount) {
      var n = global.Fmt.num(ready.length);
      var toManagers = false;
      if (!admin && isMgr() && !inMgrView()) {
        // A manager in the engineers' view decides who sees the imported rows.
        var choice = await global.UI.modal({
          title: t("aud.importTitle"),
          body: "<p>" + esc(t("aud.importBody", { n: n })) + "</p>",
          buttons: [
            { label: t("common.cancel"), value: null },
            { label: t("aud.all"), value: "all" },
            { label: t("aud.mgr"), value: "managers", primary: true }
          ]
        });
        if (!choice) { return; }
        toManagers = choice === "managers";
      } else {
        toManagers = admin ? db === "managers" : inMgrView();
        var msg = admin ? t("imp.adminConfirmDb", { n: n, p: global.Fmt.num(authorCount), db: t("view.pill." + db) })
                        : t(toManagers ? "imp.confirmMgr" : "imp.confirm", { n: n });
        var ok = await global.UI.confirm(msg, { okLabel: t("imp.go", { n: n }) });
        if (!ok) { return; }
      }
      global.UI.busy(true, t("common.saving"));
      try {
        var newAreas = {}, newTags = {};
        ready.forEach(function (x) {
          if (x.newArea && x.area) { newAreas[x.area] = { id: x.area, en: x.area }; }
          x.newTags.forEach(function (no) { newTags[no] = { tagNo: no, type: "OT", area: x.area || "", descEn: t("imp.tagDesc") }; });
        });
        if (Object.keys(newAreas).length) { await S.addAreas(Object.keys(newAreas).map(function (k) { return newAreas[k]; })); }
        if (Object.keys(newTags).length) { await S.importTags(Object.keys(newTags).map(function (k) { return newTags[k]; })); }
        var now = new Date().toISOString();
        var recs = ready.map(function (x) {
          var at = ymdIso(x.date);
          var rec = {
            id: global.Util.uuid(), version: 0,
            title: x.title, description: x.desc,
            plant: "", area: x.area || "", unit: "", shift: "",
            tags: x.tags, team: x.team,
            actions: x.actions.map(function (text) {
              return { id: global.Util.uuid(), text: text, status: "open", by: x.author.id ? { id: x.author.id, name: x.author.name } : { id: null, name: x.author.name }, at: at };
            }),
            status: x.status, kind: x.status === "draft" ? "info" : x.status,
            dueDate: x.due || null,
            createdBy: x.author.id ? { id: x.author.id, name: x.author.name } : { id: null, name: x.author.name },
            createdAt: at, updatedAt: at,
            history: [{ status: x.status, by: x.author.name, byId: x.author.id, at: at }],
            comments: [], attachments: [],
            importedFrom: "excel", importedAt: now,
            importedBy: me ? { id: me.id, name: me.name } : null
          };
          if (toManagers) { rec.restricted = "managers"; }
          return rec;
        });
        await S.addHandovers(recs, function (i, n) {
          var lab = document.getElementById("busy-label");
          if (lab) { lab.textContent = t("imp.progress", { i: global.Fmt.num(i), n: global.Fmt.num(n) }); }
        });
        // One notice for everyone, one for managers about manager-only rows.
        var open = recs.filter(function (r) { return !r.restricted; }).length;
        var closed = recs.length - open;
        var actor = { id: me.id, name: me.name };
        try {
          if (open) { await S.addNotification({ type: "import", actor: actor, handoverId: "", count: open, title: t("imp.notifTitle", { n: open }) }); }
          if (closed) { await S.addNotification({ type: "import", actor: actor, handoverId: "", count: closed, title: t("imp.notifTitle", { n: closed }), restricted: "managers" }); }
        } catch (e) { /* the import itself succeeded */ }
        global.UI.busy(false);
        global.UI.toast(t(toManagers ? "imp.doneMgr" : "imp.done", { n: global.Fmt.num(recs.length) }), "ok");
        listFilters = { q: "", status: "", area: "", from: "", to: "", creator: admin ? "" : me.id, worked: "", tag: "", src: "", mine: false };
        go("#/handovers");
      } catch (err) {
        global.UI.busy(false);
        S.log("excel import failed", err && (err.name + ": " + err.message));
        global.UI.toast(t("err.write"), "err");
      }
    }
  }

  /* ======================= OLD HANDOVER ARCHIVE IMPORT =======================
     Administration loads the old handover sheets into ONE database's archive:
     the engineers' or the managers'. Each is imported on its own and replaces
     only its own archive. Accepts the old Excel sheets themselves (every sheet
     of every file is read) or a prepared archive file (.json). */

  var OLD_AREA_ALIASES = {
    "PHASE VII": "PHVII", "PHASE 7": "PHVII", "PH VII": "PHVII", "PH7": "PHVII",
    "PHASE V": "PHV", "PHASE 5": "PHV", "PH V": "PHV", "PH5": "PHV",
    "ROSETTA": "ROS", "TL": "T/L"
  };

  /* Stable 16-hex id from text, so importing the same sheet again gives the
     same ids (comments added to imported entries stay attached). */
  function hash64(str) {
    var h1 = 0x811c9dc5, h2 = 0x9747b28c;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822519);
    }
    h2 = Math.imul(h2 ^ (h1 >>> 15), 3266489917);
    return ("0000000" + (h1 >>> 0).toString(16)).slice(-8) + ("0000000" + (h2 >>> 0).toString(16)).slice(-8);
  }

  /* Lower-case name words without initials ("M.", "A.") or a separate
     "El"/"Al"; a leading "el" is dropped from longer words so "ElKhadragy",
     "El Khadragy" and "Khadragy" all compare the same. */
  function nameTokens(s) {
    return String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z؀-ۿ]+/g, " ").trim().split(" ")
      .filter(function (x) { return x.length >= 2 && x !== "el" && x !== "al"; })
      .map(function (x) { return (x.length > 5 ? x.replace(/^el/, "") : x).replace(/^abd(el|ul|al)/, "abd"); });
  }

  /* Edit distance allowing one swap of neighbouring letters (OSA). */
  function typoDistance(a, b) {
    if (Math.abs(a.length - b.length) > 1) { return 2; }
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  /* Words the old sheets used in the "Action Required" columns as a state
     rather than an action: N/A, Open, Noted, Closed, Info, Follow up ... */
  function isStatusWord(v) {
    v = String(v || "").trim();
    return !v || /^(n\/?a|na|none|nil|-+|open(ed)?|noted|updated|closed?|completed?|done|in progress|info|fyi|no|yes|fol+o?w\s*-?\s*up)\.?\s*(\(.*\))?$/i.test(v);
  }

  function oldSheetDate(v, monthFirst) {
    var p = parseSheetDate(v);
    if (!p && typeof v === "string") {
      var m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(v);
      if (m) { p = monthFirst ? okDate(+m[3], +m[1], +m[2]) : okDate(+m[3], +m[2], +m[1]) || okDate(+m[3], +m[1], +m[2]); }
    }
    return p;
  }

  function oldHeaderMap(row) {
    var col = {}, inUpdate = false;
    function set(k, j) { if (col[k] === undefined) { col[k] = j; } }
    row.forEach(function (c, j) {
      var h = normHeader(c);
      if (!h) { return; }
      if (h === "progress" || h === "updated by" || h === "update") { inUpdate = true; }
      if (h === "date" || h === "date of handover") { if (!inUpdate) { set("date", j); } else { set("updDate", j); } }
      else if (/^date ?-? ?text$/.test(h)) { set("dateText", j); }
      else if (["by", "name", "written by", "author", "engineer", "engineer name"].indexOf(h) >= 0) { set("by", j); }
      else if (h === "subject" || h === "title") { set("title", j); }
      else if (h === "description" || h === "details") { set("desc", j); }
      else if (h === "status" || h === "for") { set("status", j); }
      else if (h === "location" || h === "area" || h === "plant area") { set("location", j); }
      else if (h === "action required") { if (!inUpdate) { set("action", j); } else { set("updAction", j); } }
      else if (h === "progress" || h === "update") { set("progress", j); }
      else if (h === "updated by") { set("updBy", j); }
      else if (h === "documents" || h === "document") { set("docs", j); }
    });
    return col;
  }

  function cellOf(x, k) { return x.col[k] === undefined ? "" : x.row[x.col[k]]; }

  /* files: [{ name, wb }]. Returns the records plus everything the preview
     shows. Nothing is written here. */
  function convertOldSheets(files, db) {
    var prefix = db === "managers" ? "arcm-x" : "arc-x";
    var areas = S.structure().areas || [];
    var areaIds = {};
    areas.forEach(function (a) { areaIds[String(a.id).toUpperCase()] = a.id; });
    var tagIndex = {};
    S.tags().forEach(function (tg) { tagIndex[String(tg.tagNo).toUpperCase().replace(/-/g, "")] = tg.tagNo; });
    var staff = S.users().map(function (u) { var tk = nameTokens(u.name); return { u: u, tokens: tk, compact: tk.join("") }; });
    var thisYear = new Date().getFullYear();

    var nameCache = {};
    function matchStaff(raw) {
      if (nameCache.hasOwnProperty(raw)) { return nameCache[raw]; }
      var tk = nameTokens(raw), comp = tk.join(""), hit = null;
      if (tk.length) {
        var c = staff.filter(function (s) {
          return tk.every(function (x) { return s.tokens.indexOf(x) >= 0; }) || (comp.length >= 5 && s.compact.indexOf(comp) >= 0);
        });
        if (c.length > 1) {
          var acc = c.filter(function (s) { return ACCOUNT_ROLES_UI.indexOf(s.u.role || "") >= 0; });
          if (acc.length) { c = acc; }
        }
        if (c.length > 1) {
          var exact = c.filter(function (s) { return s.compact === comp; });
          if (exact.length === 1) { c = exact; }
        }
        hit = c.length === 1 ? c[0].u : null;
      }
      nameCache[raw] = hit;
      return hit;
    }

    // Pass 1: read every recognisable sheet into raw rows.
    var sheets = [], rows = [];
    files.forEach(function (f) {
      f.wb.SheetNames.forEach(function (sn) {
        var data = global.XLSX.utils.sheet_to_json(f.wb.Sheets[sn], { header: 1, raw: true, defval: "" });
        var hIdx = -1, col = null;
        for (var i = 0; i < Math.min(data.length, 8); i++) {
          var m = oldHeaderMap(data[i] || []);
          if (m.desc !== undefined && (m.date !== undefined || m.dateText !== undefined)) { hIdx = i; col = m; break; }
        }
        var info = { file: f.name, sheet: sn, rows: 0, used: 0, ok: hIdx >= 0 };
        sheets.push(info);
        if (hIdx < 0) { return; }
        var source = f.wb.SheetNames.length > 1 ? f.name + " · " + sn : f.name;
        for (var r = hIdx + 1; r < data.length; r++) {
          var item = { row: data[r] || [], col: col, source: source };
          info.rows++;
          item.desc = normText(cellOf(item, "desc"));
          item.title = normText(cellOf(item, "title"));
          if (!item.desc && !item.title) { continue; }
          info.used++;
          rows.push(item);
        }
      });
    });

    // Pass 2: people. Names not on the staff list are grouped by spelling
    // (Lakosha / LAkosha / M.Lakosha) and kept as text.
    var formerCount = {};
    function splitNames(raw) {
      return normText(raw).split(/\s*(?:\/|&|,|\+|\band\b)\s*/i).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    rows.forEach(function (x) {
      x.names = splitNames(cellOf(x, "by"));
      x.names.forEach(function (n) {
        if (matchStaff(n)) { return; }
        var key = nameTokens(n).join(" ");
        if (!key) { return; }
        var g = formerCount[key] = formerCount[key] || { n: 0, variants: {} };
        g.n++;
        g.variants[n] = (g.variants[n] || 0) + 1;
      });
    });
    // A one-word spelling joins the only longer name that ends with it.
    var formerKeys = Object.keys(formerCount), mergeTo = {};
    formerKeys.forEach(function (k) {
      if (k.indexOf(" ") >= 0) { return; }
      var longer = formerKeys.filter(function (o) { return o !== k && o.indexOf(" ") > 0 && o.split(" ").pop() === k; });
      if (longer.length === 1) { mergeTo[k] = longer[0]; }
    });
    var groups = {};
    formerKeys.forEach(function (k) {
      var to = mergeTo[k] || k;
      var g = groups[to] = groups[to] || { n: 0, variants: {} };
      g.n += formerCount[k].n;
      Object.keys(formerCount[k].variants).forEach(function (v) { g.variants[v] = (g.variants[v] || 0) + formerCount[k].variants[v]; });
    });
    // A rare spelling one typo away from a common one joins it (Laksoha -> Lakosha).
    var fuzzyTo = {};
    Object.keys(groups).forEach(function (k) {
      if (groups[k].n > 3 || k.length < 5) { return; }
      var best = null;
      Object.keys(groups).forEach(function (o) {
        if (o === k || groups[o].n <= groups[k].n * 5 || o.split(" ").length !== k.split(" ").length) { return; }
        if (typoDistance(k, o) <= 1 && (!best || groups[o].n > groups[best].n)) { best = o; }
      });
      if (best) { fuzzyTo[k] = best; }
    });
    Object.keys(fuzzyTo).forEach(function (k) {
      var g = groups[fuzzyTo[k]];
      g.n += groups[k].n;
      Object.keys(groups[k].variants).forEach(function (v) { g.variants[v] = (g.variants[v] || 0) + groups[k].variants[v]; });
      delete groups[k];
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      // The fullest spelling that is used more than a couple of times.
      var floor = Math.max(2, g.n * 0.01);
      var vs = Object.keys(g.variants);
      var usable = vs.filter(function (v) { return g.variants[v] >= floor; });
      var best = (usable.length ? usable : vs).sort(function (a, b) {
        return nameTokens(b).length - nameTokens(a).length || g.variants[b] - g.variants[a];
      })[0];
      if (best === best.toLowerCase()) { best = best.replace(/\b[a-z]/g, function (ch) { return ch.toUpperCase(); }); }
      g.display = best;
    });
    function person(n) {
      var u = matchStaff(n);
      if (u) { return { id: u.id, name: u.name, role: u.role || "" }; }
      var key = nameTokens(n).join(" ");
      if (!key) { return { id: null, name: n }; }
      var k2 = mergeTo[key] || key;
      var g = groups[fuzzyTo[k2] || k2];
      return { id: null, name: g ? g.display : n };
    }

    // Pass 3: records.
    var stats = { files: files.length, sheets: sheets, rows: 0, records: 0, duplicates: 0, undated: 0, tagged: 0, updates: 0, actions: 0,
                  years: {}, people: {}, areas: {}, locations: {} };
    var seen = {}, records = [], locCount = {};
    rows.forEach(function (x) {
      stats.rows++;
      var dateCell = cellOf(x, "date");
      var d = oldSheetDate(dateCell, false) || oldSheetDate(cellOf(x, "dateText"), true);
      if (d && (d.y > thisYear || d.y < 1990)) { d = null; }
      var names = x.names;
      var author = names.length ? person(names[0]) : { id: null, name: "" };
      var team = [];
      names.slice(1).forEach(function (n) {
        var p = person(n);
        if (author.id ? p.id === author.id : p.name === author.name) { return; }
        if (!team.some(function (m) { return m.name === p.name; })) {
          team.push(p.id ? { id: p.id, name: p.name, role: p.role || "engineer", jobTitle: "" } : { id: null, name: p.name });
        }
      });

      var desc = x.desc || x.title;
      var action = normText(cellOf(x, "action"));
      if (isStatusWord(action)) { action = ""; }
      var docs = normText(cellOf(x, "docs"));
      if (docs) { desc += "\n\n" + t("arcx.documents") + ": " + docs; }
      var title = x.title || desc.split("\n")[0];
      if (title.length > 90) { title = title.slice(0, 87).replace(/\s+\S*$/, "") + "…"; }

      var key = (d ? ymdDay(d) : "nodate") + "|" + (author.id || global.Util.normalize(author.name)) + "|" +
                global.Util.normalize(desc).slice(0, 400);
      if (seen[key]) { stats.duplicates++; return; }
      seen[key] = true;

      // Area: the Location column, or a plant area named at the very start.
      var loc = normText(cellOf(x, "location")).replace(/\s+/g, " ");
      var area = "", locationText = "";
      if (loc) {
        var up = OLD_AREA_ALIASES[loc.toUpperCase()] || loc.toUpperCase();
        if (areaIds[up]) { area = areaIds[up]; }
        else { locationText = loc; locCount[up] = (locCount[up] || 0) + 1; }
      } else {
        var lead = /^([A-Za-z0-9\/]+)/.exec(x.title || x.desc);
        if (lead && areaIds[lead[1].toUpperCase()]) { area = areaIds[lead[1].toUpperCase()]; }
      }

      // Instrument tags named in the subject or description (register only).
      var tags = [];
      ((x.title + " " + x.desc).toUpperCase().match(/[A-Z0-9][A-Z0-9-]{2,24}/g) || []).forEach(function (tok) {
        var compact = tok.replace(/-/g, "");
        if (compact.length < 5 || !/[A-Z]/.test(compact) || !/\d/.test(compact)) { return; }
        var no = tagIndex[compact];
        if (no && tags.indexOf(no) < 0) { tags.push(no); }
      });

      var createdAt = d ? ymdIso(d) : null;
      var rec = {
        id: prefix + hash64(key),
        title: title,
        description: desc,
        status: "closed",
        legacyStatus: normText(cellOf(x, "status")),
        area: area,
        location: locationText,
        tags: tags,
        team: team,
        createdBy: author.id
          ? { id: author.id, name: author.name, original: names[0] !== author.name ? names[0] : undefined }
          : { id: null, name: author.name, original: names[0] && names[0] !== author.name ? names[0] : undefined },
        createdAt: createdAt,
        dateUnknown: d ? undefined : true,
        source: x.source,
        comments: []
      };
      if (!rec.createdBy.original) { delete rec.createdBy.original; }

      // Managers' sheet: "Action Required", then one round of update
      // (Progress / Updated by / Date / Action Required). The progress becomes
      // a comment; an action marked Closed there is recorded as done; others
      // stay as written in the old sheet (their outcome is unknown).
      var progress = normText(cellOf(x, "progress")), updAction = normText(cellOf(x, "updAction"));
      var ud = oldSheetDate(cellOf(x, "updDate"), false);
      var ub = normText(cellOf(x, "updBy"));
      var who = ub ? person(splitNames(ub)[0] || ub) : { id: null, name: "\u2014" };
      var updAt = ud ? ymdIso(ud) : createdAt;
      var commentId = "";
      if (progress) {
        commentId = "c-" + hash64(rec.id + progress);
        rec.comments.push({ id: commentId, text: progress, at: updAt, by: { id: who.id || null, name: who.name }, imported: true });
        stats.updates++;
      }
      rec.actions = [];
      if (action) {
        var closed = /^(closed?|completed?|done)\.?$/i.test(updAction);
        var act = { id: "a-" + hash64(rec.id + action), text: action, status: closed ? "done" : "old", by: { id: author.id || null, name: author.name }, at: createdAt };
        if (closed) { act.doneBy = { id: who.id || null, name: who.name }; act.doneAt = updAt; if (commentId) { act.doneComment = commentId; } }
        rec.actions.push(act);
      }
      if (updAction && !isStatusWord(updAction)) {
        rec.actions.push({ id: "a-" + hash64(rec.id + "u" + updAction), text: updAction, status: "old", by: { id: who.id || null, name: who.name }, at: updAt });
      }
      if (rec.actions.length) { stats.actions += rec.actions.length; } else { delete rec.actions; }

      records.push(rec);
      stats.records++;
      if (!d) { stats.undated++; } else { stats.years[d.y] = (stats.years[d.y] || 0) + 1; }
      if (tags.length) { stats.tagged++; }
      if (area) { stats.areas[area] = (stats.areas[area] || 0) + 1; }
      var pk = (author.id || "") + "|" + author.name;
      var ps = stats.people[pk] = stats.people[pk] || { name: author.name, id: author.id, role: author.role || "", n: 0, spellings: {} };
      ps.n++;
      if (names[0]) { ps.spellings[names[0]] = true; }
    });

    // Locations written 20+ times become plant areas, as with the first import.
    var newAreas = [];
    Object.keys(locCount).forEach(function (up) {
      if (locCount[up] >= 20 && up.length <= 14) { newAreas.push({ id: up, en: up }); }
    });
    if (newAreas.length) {
      var promote = {};
      newAreas.forEach(function (a) { promote[a.id] = true; });
      records.forEach(function (r) {
        var canon = r.location ? (OLD_AREA_ALIASES[r.location.toUpperCase()] || r.location.toUpperCase()) : "";
        if (canon && promote[canon]) {
          r.area = canon;
          stats.areas[r.area] = (stats.areas[r.area] || 0) + 1;
          r.location = "";
        }
      });
    }
    stats.newAreas = newAreas;
    return {
      bundle: {
        kind: "plant-handover-archive", audience: db, records: records, areas: newAreas,
        sources: files.map(function (f) { return f.name; })
      },
      stats: stats
    };
  }

  var ACCOUNT_ROLES_UI = ["engineer", "manager", "administrator"];

  async function archiveImport(query) {
    var db = query && query.db === "managers" ? "managers" : "engineers";
    if (!S.isAdmin()) {
      view().innerHTML = emptyBlock(t("imp.adminLocked")) +
        '<div style="text-align:center"><button class="btn primary" id="imp-unlock">' + esc(t("nav.admin")) + "</button></div>";
      $("#imp-unlock").addEventListener("click", function () { go("#/admin"); });
      return;
    }
    if (!global.XLSX) { view().innerHTML = emptyBlock(t("imp.noReader")); return; }
    try { await S.loadArchive(); } catch (e) { /* shown as none */ }
    var info = S.archiveInfo(db);
    var other = db === "managers" ? "engineers" : "managers";

    view().innerHTML =
      '<div class="page-head"><div><h1>' + esc(t("arcx.title")) +
        '<span class="view-pill v-' + db + '">' + esc(t("view.pill." + db)) + "</span></h1>" +
        "<p>" + esc(t("arcx.sub." + db)) + "</p></div>" +
        '<div class="spacer"></div><button class="btn ghost" id="arc-back">' + esc(t("common.back")) + "</button></div>" +
      '<div class="card db-card v-' + db + '">' +
        '<p class="small" style="margin:0 0 6px"><b>' + esc(t("arcx.now")) + "</b> " +
          esc(info ? t("arc.current", { n: global.Fmt.num(info.count), date: global.Fmt.dateTime(info.importedAt), by: info.by || "—" }) : t("arc.none")) + "</p>" +
        '<p class="small faint" style="margin:0 0 12px">' + esc(t("arcx.how", { other: t("view.pill." + other) })) + "</p>" +
        '<div class="dropzone imp-drop" id="imp-drop">' +
          '<div class="imp-drop-icon" aria-hidden="true">&#8681;</div>' +
          '<div class="imp-drop-text">' + esc(t("arcx.dropHere")) + "</div>" +
          '<div class="small faint" style="margin:6px 0 10px">' + esc(t("imp.or")) + "</div>" +
          '<button class="btn primary" id="arc-pick" type="button">' + esc(t("arcx.choose")) + "</button>" +
        "</div>" +
        '<input type="file" id="arc-file" multiple accept=".xlsx,.xlsm,.xls,.json,application/json" class="hidden">' +
      "</div>" +
      '<div id="arc-result" style="margin-top:16px"></div>';

    $("#arc-back").addEventListener("click", function () { go("#/admin"); });
    $("#arc-pick").addEventListener("click", function (e) { e.stopPropagation(); $("#arc-file").click(); });
    $("#arc-file").addEventListener("change", function (e) {
      var list = Array.prototype.slice.call(e.target.files || []);
      e.target.value = "";
      handleFiles(list);
    });
    var zone = $("#imp-drop"), depth = 0;
    zone.addEventListener("click", function () { $("#arc-file").click(); });
    zone.addEventListener("dragenter", function (e) { e.preventDefault(); depth++; zone.classList.add("over"); });
    zone.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; zone.classList.remove("over"); } });
    zone.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      depth = 0; zone.classList.remove("over");
      handleFiles(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []));
    });
    importDropTarget = function (files) { handleFiles(Array.prototype.slice.call(files || [])); };
    installPageDrop();

    async function handleFiles(list) {
      if (!list.length) { return; }
      var bad = list.filter(function (f) { return !/\.(xlsx|xlsm|xls|json)$/i.test(f.name); });
      if (bad.length) { global.UI.toast(t("arcx.badType", { v: bad[0].name }), "err"); return; }
      var json = list.filter(function (f) { return /\.json$/i.test(f.name); });
      if (json.length && list.length > 1) { global.UI.toast(t("arcx.jsonAlone"), "err"); return; }
      global.UI.busy(true, t("arcx.reading"));
      var result = null, error = "";
      try {
        if (json.length) {
          var bundle = null;
          try { bundle = JSON.parse(await json[0].text()); } catch (e) { bundle = null; }
          if (!bundle || bundle.kind !== "plant-handover-archive" || !Array.isArray(bundle.records)) { error = t("arc.badFile"); }
          else if ((bundle.audience || "engineers") !== db) { error = t("arcx.wrongDb", { db: t("view.pill." + (bundle.audience || "engineers")) }); }
          else { result = { bundle: bundle, stats: null, fileNames: [json[0].name] }; }
        } else {
          var files = [];
          for (var i = 0; i < list.length; i++) {
            var lab = document.getElementById("busy-label");
            if (lab) { lab.textContent = t("arcx.readingFile", { name: list[i].name }); }
            files.push({ name: list[i].name, wb: global.XLSX.read(new Uint8Array(await list[i].arrayBuffer()), { type: "array", cellDates: false }) });
          }
          result = convertOldSheets(files, db);
          result.fileNames = list.map(function (f) { return f.name; });
          if (!result.bundle.records.length) { error = t("arcx.nothing"); }
        }
      } catch (err) {
        S.log("archive import: could not read", err && err.message);
        error = t("imp.badFile");
      }
      global.UI.busy(false);
      if (error) { $("#arc-result").innerHTML = '<div class="card"><p class="err-msg">' + esc(error) + "</p></div>"; return; }
      showPreview(result);
    }

    function statBox(n, text) {
      return '<div class="stat" style="cursor:default"><div class="n">' + n + '</div><div class="l">' + esc(text) + "</div></div>";
    }

    function showPreview(res) {
      var b = res.bundle, st = res.stats, n = b.records.length;
      var html = '<div class="card">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<div><h3 style="margin:0">' + esc(t("imp.preview", { file: res.fileNames.join(", ") })) + "</h3>" +
          '<p class="small faint" style="margin:4px 0 0">' + esc(st
            ? t("arcx.summary", { n: global.Fmt.num(n), dup: global.Fmt.num(st.duplicates), rows: global.Fmt.num(st.rows) })
            : t("arcx.summaryJson", { n: global.Fmt.num(n) })) + "</p></div>" +
          '<div class="spacer" style="flex:1"></div>' +
          '<button class="btn primary" id="arc-go">' + esc(t("arcx.go", { n: global.Fmt.num(n), db: t("view.pill." + db) })) + "</button>" +
        "</div>" +
        (info ? '<p class="imp-w" style="margin:12px 0 0">' + esc(t("arcx.replaces", { n: global.Fmt.num(info.count), db: t("view.pill." + db) })) + "</p>" : "");

      if (st) {
        var years = Object.keys(st.years).sort();
        html += '<div class="grid stats" style="margin-top:14px">' +
          statBox(global.Fmt.num(n), t("arcx.sHandovers")) +
          statBox(years.length ? esc(years[0] + (years.length > 1 ? "–" + years[years.length - 1] : "")) : "—", t("arcx.sYears")) +
          statBox(global.Fmt.num(st.undated), t("arcx.sUndated")) +
          statBox(global.Fmt.num(st.tagged), t("arcx.sTagged")) +
          statBox(global.Fmt.num(Object.keys(st.areas).reduce(function (s0, k) { return s0 + st.areas[k]; }, 0)), t("arcx.sArea")) +
          statBox(global.Fmt.num(st.updates), t("arcx.sUpdates")) +
          statBox(global.Fmt.num(st.actions), t("arcx.sActions")) +
          "</div>";
        if (st.newAreas.length) {
          html += '<p class="small" style="margin:12px 0 0">' + esc(t("arcx.newAreas", { v: st.newAreas.map(function (a) { return a.id; }).join(", ") })) + "</p>";
        }

        var people = Object.keys(st.people).map(function (k) { return st.people[k]; }).sort(function (a, c) { return c.n - a.n; });
        html += "<h4 style=\"margin:18px 0 6px\">" + esc(t("arcx.whoTitle")) + "</h4>" +
          '<p class="small faint" style="margin:0 0 8px">' + esc(t("arcx.whoDesc")) + "</p>" +
          '<div style="overflow:auto;max-height:420px"><table class="table imp-table"><thead><tr>' +
            "<th>" + esc(t("arcx.savedAs")) + "</th><th>" + esc(t("arcx.spellings")) + "</th><th>" + esc(t("arcx.match")) + "</th><th>" + esc(t("arcx.count")) + "</th>" +
          "</tr></thead><tbody>" +
          people.map(function (p) {
            var spell = Object.keys(p.spellings);
            return '<tr class="' + (p.id ? "imp-ok" : "imp-warn") + '"><td><b>' + esc(p.name || t("arcx.noName")) + "</b></td>" +
              "<td>" + esc(spell.slice(0, 6).join(", ") + (spell.length > 6 ? " +" + (spell.length - 6) : "")) + "</td>" +
              "<td>" + esc(p.id ? t("arcx.onStaff", { role: t("role." + (p.role || "engineer")) }) : (p.name ? t("arcx.former") : "—")) + "</td>" +
              "<td>" + global.Fmt.num(p.n) + "</td></tr>";
          }).join("") +
          "</tbody></table></div>";

        html += "<h4 style=\"margin:18px 0 6px\">" + esc(t("arcx.sheetsTitle")) + "</h4>" +
          '<div style="overflow:auto"><table class="table"><thead><tr><th>' + esc(t("arcx.file")) + "</th><th>" + esc(t("arcx.sheet")) +
          "</th><th>" + esc(t("arcx.rowsRead")) + "</th></tr></thead><tbody>" +
          st.sheets.map(function (sh) {
            return "<tr><td>" + esc(sh.file) + "</td><td>" + esc(sh.sheet) + "</td><td>" +
              (sh.ok ? global.Fmt.num(sh.used) : '<span class="faint">' + esc(t("arcx.noHeader")) + "</span>") + "</td></tr>";
          }).join("") + "</tbody></table></div>";
      }
      html += "</div>";
      $("#arc-result").innerHTML = html;
      $("#arc-go").addEventListener("click", function () { runArchiveImport(res); });
    }

    async function runArchiveImport(res) {
      var n = res.bundle.records.length;
      var ok = await global.UI.confirm(
        t(info ? "arcx.confirmReplace" : "arcx.confirm", { n: global.Fmt.num(n), db: t("view.pill." + db), old: info ? global.Fmt.num(info.count) : "0" }),
        { okLabel: t("arcx.go", { n: global.Fmt.num(n), db: t("view.pill." + db) }) });
      if (!ok) { return; }
      global.UI.busy(true, t("common.saving"));
      try {
        var me = global.App.user();
        var done = await S.importArchive(res.bundle, me ? me.name : "", function (i, total, name) {
          var lab = document.getElementById("busy-label");
          if (lab) { lab.textContent = t("arc.progress", { i: global.Fmt.num(i), n: global.Fmt.num(total), name: name }); }
        }, db);
        global.UI.busy(false);
        global.UI.toast(t("arcx.done", { n: global.Fmt.num(done.count), db: t("view.pill." + db) }), "ok");
        go("#/admin");
      } catch (err) {
        global.UI.busy(false);
        S.log("archive import failed", err && (err.name + ": " + err.message));
        global.UI.toast(err && err.name === "AudienceError" ? t("arcx.wrongDb", { db: t("view.pill." + err.audience) })
          : err && err.name === "FormatError" ? t("arc.badFile") : t("err.write"), "err");
      }
    }
  }

  global.Views = {
    dashboard: dashboard,
    handoverList: handoverList,
    handoverForm: handoverForm,
    handoverDetail: handoverDetail,
    handoverImport: handoverImport,
    archiveImport: archiveImport,
    onViewChange: function () { if (formViewHook) { formViewHook(); } },
    equipmentList: equipmentList,
    equipmentDetail: equipmentDetail,
    notifications: notifications,
    profile: profile,
    admin: admin,
    search: search,
    notifText: notifText,
    isUnread: isUnread,
    personName: personName,
    initials: initials
  };
})(window);
