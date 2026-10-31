/* ==========================================================================
   core.js - small helpers the rest of the app leans on:
   preferences, formatting, DOM/UI bits, and hashing.
   ========================================================================== */
(function (global) {
  "use strict";

  var t = global.t;

  /* ---------------------------------------------------------------- Util */

  function uuid() {
    if (global.crypto && typeof crypto.randomUUID === "function") { return crypto.randomUUID(); }
    // Fallback for older engines - still collision-safe enough for filenames.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function esc(s) {
    if (s === null || s === undefined) { return ""; }
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* Lower-case, single-spaced text so search ignores case and stray spaces. */
  function normalize(s) {
    if (!s) { return ""; }
    return String(s).toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Weak, but only reached where SubtleCrypto is unavailable. */
  function weakHash(salted) {
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var j = 0; j < salted.length; j++) {
      h1 = (h1 ^ salted.charCodeAt(j)) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + salted.charCodeAt(j) * (j + 7)) >>> 0;
    }
    return "fnv" + h1.toString(16) + h2.toString(16);
  }

  function sha256(text) {
    var salted = "plant-handover:" + text;
    if (global.crypto && global.crypto.subtle && typeof TextEncoder === "function") {
      try {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(salted)).then(function (buf) {
          var bytes = new Uint8Array(buf), out = "";
          for (var i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, "0"); }
          return out;
        }).catch(function () {
          // Some origins expose crypto.subtle but reject the call.
          return weakHash(salted);
        });
      } catch (e) { /* falls through */ }
    }
    return Promise.resolve(weakHash(salted));
  }

  /* ------------------------------------------------------------- Secrets
     Passwords are stored as a salted PBKDF2 hash, never in the clear. The
     hash sits in users.json on the share where everyone can read it, so this
     raises the cost of guessing a password rather than making it impossible -
     the same honest limit as the administrator password. */

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, "0"); }
    return out;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) { out[i] = parseInt(hex.substr(i * 2, 2), 16); }
    return out;
  }

  function randomHex(byteCount) {
    var a = new Uint8Array(byteCount);
    if (global.crypto && global.crypto.getRandomValues) { crypto.getRandomValues(a); }
    else { for (var i = 0; i < a.length; i++) { a[i] = Math.floor(Math.random() * 256); } }
    return bytesToHex(a);
  }

  var PBKDF2_ITERATIONS = 150000;

  function derive(password, saltHex, iterations) {
    if (!global.crypto || !global.crypto.subtle || typeof TextEncoder !== "function") {
      return Promise.reject(new Error("no-subtle"));
    }
    var enc = new TextEncoder();
    return crypto.subtle
      .importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits({
          name: "PBKDF2", salt: hexToBytes(saltHex), iterations: iterations, hash: "SHA-256"
        }, key, 256);
      })
      .then(function (bits) { return bytesToHex(new Uint8Array(bits)); });
  }

  /* Returns a record safe to store: {v, iter, salt, hash}. */
  function makeSecret(password) {
    var salt = randomHex(16);
    return derive(password, salt, PBKDF2_ITERATIONS).then(function (hash) {
      return { v: 2, iter: PBKDF2_ITERATIONS, salt: salt, hash: hash };
    }).catch(function () {
      // PBKDF2 unavailable - fall back to a salted digest rather than refuse.
      return sha256(salt + ":" + password).then(function (hash) {
        return { v: 1, salt: salt, hash: hash };
      });
    });
  }

  /* Accepts the new record, the older salted form, and the original bare
     sha256 string the administrator password used, so nothing needs resetting. */
  function verifySecret(password, record) {
    if (!record) { return Promise.resolve(false); }
    if (typeof record === "string") {
      return sha256(password).then(function (h) { return h === record; });
    }
    if (record.v === 2) {
      return derive(password, record.salt, record.iter || PBKDF2_ITERATIONS)
        .then(function (h) { return h === record.hash; })
        .catch(function () { return false; });
    }
    if (record.v === 1) {
      return sha256(record.salt + ":" + password).then(function (h) { return h === record.hash; });
    }
    return Promise.resolve(false);
  }

  /* ----------------------------------------------------------- Preferences
     Per-PC settings (who is signed in, read notifications).
     localStorage can be unavailable on file:// in some setups, so this
     silently degrades to memory for the session rather than throwing. */

  var memoryPrefs = {};
  var lsOk = (function () {
    try { localStorage.setItem("__ho", "1"); localStorage.removeItem("__ho"); return true; }
    catch (e) { return false; }
  })();

  var Prefs = {
    available: lsOk,
    get: function (key, fallback) {
      var raw;
      if (lsOk) { try { raw = localStorage.getItem("ho." + key); } catch (e) { raw = null; } }
      else { raw = memoryPrefs[key]; }
      if (raw === null || raw === undefined) { return fallback; }
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      if (lsOk) { try { localStorage.setItem("ho." + key, raw); } catch (e) { memoryPrefs[key] = raw; } }
      else { memoryPrefs[key] = raw; }
    },
    remove: function (key) {
      if (lsOk) { try { localStorage.removeItem("ho." + key); } catch (e) {} }
      delete memoryPrefs[key];
    }
  };

  /* ------------------------------------------------------------ Formatting */

  function locale() { return "en-GB"; }

  function parseDate(v) {
    if (!v) { return null; }
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  var Fmt = {
    date: function (v) {
      var d = parseDate(v);
      if (!d) { return "—"; }
      try { return new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "short", year: "numeric" }).format(d); }
      catch (e) { return d.toDateString(); }
    },
    dateTime: function (v) {
      var d = parseDate(v);
      if (!d) { return "—"; }
      try {
        return new Intl.DateTimeFormat(locale(), {
          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
        }).format(d);
      } catch (e) { return d.toLocaleString(); }
    },
    time: function (v) {
      var d = parseDate(v);
      if (!d) { return "—"; }
      try { return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d); }
      catch (e) { return d.toTimeString().slice(0, 5); }
    },
    /* "just now" / "14 min" / "3 h" for today, a real date beyond that. */
    ago: function (v) {
      var d = parseDate(v);
      if (!d) { return "—"; }
      var mins = Math.floor((Date.now() - d.getTime()) / 60000);
      if (mins < 1) { return t("common.justNow"); }
      if (mins < 60) { return new Intl.NumberFormat(locale()).format(mins) + " min"; }
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) { return new Intl.NumberFormat(locale()).format(hrs) + " h"; }
      return Fmt.date(d);
    },
    num: function (n) {
      try { return new Intl.NumberFormat(locale()).format(n || 0); }
      catch (e) { return String(n || 0); }
    },
    bytes: function (n) {
      if (!n && n !== 0) { return "—"; }
      if (n < 1024) { return Fmt.num(n) + " B"; }
      if (n < 1024 * 1024) { return Fmt.num(Math.round(n / 1024)) + " KB"; }
      return Fmt.num(Math.round(n / 104857.6) / 10) + " MB";
    },
    /* yyyy-mm-dd in local time, for <input type="date"> and day grouping. */
    isoDay: function (v) {
      var d = parseDate(v) || new Date();
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var day = String(d.getDate()).padStart(2, "0");
      return d.getFullYear() + "-" + m + "-" + day;
    }
  };

  /* -------------------------------------------------------------- UI bits */

  var toastHost = null, busyEl = null, busyCount = 0;

  function toast(message, kind) {
    if (!toastHost) { toastHost = document.getElementById("toast-host"); }
    if (!toastHost) { return; }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .25s";
      el.style.opacity = "0";
      setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 260);
    }, kind === "err" ? 5200 : 2800);
  }

  function busy(on, label) {
    if (!busyEl) { busyEl = document.getElementById("busy"); }
    if (!busyEl) { return; }
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    var lab = document.getElementById("busy-label");
    if (lab) { lab.textContent = label || t("common.loading"); }
    busyEl.classList.toggle("hidden", busyCount === 0);
  }

  /* Promise-based modal. buttons: [{label, kind, value, primary}]
     `render` receives the body element so callers can wire up their own DOM. */
  function modal(opts) {
    return new Promise(function (resolve) {
      var host = document.getElementById("modal-host");
      var titleEl = document.getElementById("modal-title");
      var bodyEl = document.getElementById("modal-body");
      var footEl = document.getElementById("modal-foot");
      var box = host.querySelector(".modal");

      titleEl.textContent = opts.title || "";
      bodyEl.innerHTML = "";
      footEl.innerHTML = "";
      box.classList.toggle("wide", !!opts.wide);

      if (typeof opts.body === "string") { bodyEl.innerHTML = opts.body; }
      else if (opts.body) { bodyEl.appendChild(opts.body); }

      var done = false;
      function close(value) {
        if (done) { return; }
        done = true;
        host.classList.add("hidden");
        document.removeEventListener("keydown", onKey);
        bodyEl.innerHTML = "";
        footEl.innerHTML = "";
        resolve(value);
      }
      function onKey(e) { if (e.key === "Escape") { close(undefined); } }

      (opts.buttons || [{ label: t("common.close"), value: undefined }]).forEach(function (b) {
        var btn = document.createElement("button");
        btn.className = "btn" + (b.primary ? " primary" : "") + (b.kind ? " " + b.kind : "");
        btn.textContent = b.label;
        btn.addEventListener("click", function () {
          if (b.before) {
            var r = b.before(bodyEl);
            if (r === false) { return; }
            if (r && typeof r.then === "function") {
              r.then(function (rv) { if (rv !== false) { close(rv === undefined ? b.value : rv); } });
              return;
            }
            if (r !== undefined && r !== true) { close(r); return; }
          }
          close(b.value);
        });
        footEl.appendChild(btn);
      });

      document.getElementById("modal-close").onclick = function () { close(undefined); };
      document.getElementById("modal-backdrop").onclick = function () { close(undefined); };
      document.addEventListener("keydown", onKey);

      host.classList.remove("hidden");
      if (opts.render) { opts.render(bodyEl, close); }
      var focusable = bodyEl.querySelector("input, textarea, select");
      if (focusable) { setTimeout(function () { focusable.focus(); }, 40); }
    });
  }

  function confirm(message, opts) {
    opts = opts || {};
    return modal({
      title: opts.title || t("common.confirm"),
      body: "<p>" + esc(message) + "</p>",
      buttons: [
        { label: t("common.cancel"), value: false },
        { label: opts.okLabel || t("common.confirm"), value: true, primary: !opts.danger, kind: opts.danger ? "danger" : "" }
      ]
    }).then(function (v) { return v === true; });
  }

  /* --------------------------------------------------------- File helpers */

  var ALLOWED = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "heic": "image/heic", "heif": "image/heif", "webp": "image/webp",
    "pdf": "application/pdf",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain"
  };
  var MAX_MB = 20;

  function ext(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }
  function isAllowed(name) { return Object.prototype.hasOwnProperty.call(ALLOWED, ext(name)); }
  function isImage(name) { var e = ext(name); return e === "jpg" || e === "jpeg" || e === "png" || e === "webp"; }

  /* Keeps a filename safe for a Windows share while staying recognisable. */
  function safeName(name) {
    return String(name || "file")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  global.Util = {
    uuid: uuid, esc: esc, debounce: debounce, normalize: normalize, sha256: sha256,
    ext: ext, isAllowed: isAllowed, isImage: isImage, safeName: safeName,
    makeSecret: makeSecret, verifySecret: verifySecret, randomHex: randomHex,
    ALLOWED: ALLOWED, MAX_MB: MAX_MB
  };
  var Session = {
    get: function (key, fallback) {
      try {
        var raw = sessionStorage.getItem("ho." + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return memoryPrefs["session." + key] === undefined ? fallback : memoryPrefs["session." + key]; }
    },
    set: function (key, value) {
      try { sessionStorage.setItem("ho." + key, JSON.stringify(value)); }
      catch (e) { memoryPrefs["session." + key] = value; }
    },
    remove: function (key) {
      try { sessionStorage.removeItem("ho." + key); } catch (e) {}
      delete memoryPrefs["session." + key];
    }
  };

  global.Prefs = Prefs;
  global.Session = Session;
  global.Fmt = Fmt;
  /* ---------------------------------------------------- Show-password eye
     Every password box in the app gets an eye button that switches between
     dots and plain text. Done with one observer so gate screens, dialogs and
     admin cards all get it without each view having to remember. */

  var EYE_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
  var EYE_SHUT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M2.8 4.2 4.2 2.8l17 17-1.4 1.4-3.2-3.2A10.6 10.6 0 0 1 12 19c-5 0-9-4.5-10-7a13 13 0 0 1 3.6-4.6L2.8 4.2zM12 5c5 0 9 4.5 10 7a12.7 12.7 0 0 1-2.9 4l-3.2-3.2A4.5 4.5 0 0 0 10.2 7.1L8.1 5A10.4 10.4 0 0 1 12 5zm-4.4 5 1.5 1.5a2.5 2.5 0 0 0 3.3 3.3l1.5 1.5A4.5 4.5 0 0 1 7.6 10z"/></svg>';

  function addPasswordEye(input) {
    if (input.getAttribute("data-eye")) { return; }
    input.setAttribute("data-eye", "1");
    var hadFocus = document.activeElement === input;
    var wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.tabIndex = -1;
    btn.setAttribute("aria-label", t("auth.show"));
    btn.title = t("auth.show");
    btn.innerHTML = EYE_OPEN;
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btn.addEventListener("click", function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = showing ? EYE_OPEN : EYE_SHUT;
      btn.title = t(showing ? "auth.show" : "auth.hide");
      btn.setAttribute("aria-label", btn.title);
      btn.classList.toggle("on", !showing);
    });
    wrap.appendChild(btn);
    if (hadFocus) { input.focus(); }
  }

  function scanPasswords(root) {
    var list = (root || document).querySelectorAll('input[type="password"]:not([data-eye])');
    for (var i = 0; i < list.length; i++) { addPasswordEye(list[i]); }
  }

  function watchPasswords() {
    scanPasswords(document);
    if (typeof MutationObserver !== "function") { return; }
    new MutationObserver(function () { scanPasswords(document); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", watchPasswords); }
  else { watchPasswords(); }

  global.UI = { toast: toast, busy: busy, modal: modal, confirm: confirm, scanPasswords: scanPasswords };
})(window);
