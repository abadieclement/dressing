/* Couche de compatibilité.
   L'app appelle claude.use("db" | "user" | "assets" | "sample" | "downloads").
   Ici ces appels sont branchés sur Supabase (données, photos, connexion),
   sur le relais "claude-proxy" (IA) et sur le navigateur (téléchargements). */
(function () {
  "use strict";
  var CFG = window.DRESSING_CONFIG || {};
  var configured = !!(CFG.url && CFG.anonKey && !/VOTRE/.test(CFG.url + CFG.anonKey) && window.supabase);
  var sb = null, session = null, readyP = null, API = {};

  function mkErr(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function clean(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  // ---------- Connexion ----------
  function gate() {
    return new Promise(function (resolve) {
      var st = document.createElement("style");
      st.textContent =
        "#gate{position:fixed;inset:0;z-index:300;background:var(--bg,#f1f3f8);color:var(--ink,#0d1321);display:grid;place-items:center;padding:24px;font-family:var(--font-body,system-ui,sans-serif)}" +
        "#gate form{width:min(360px,100%);display:flex;flex-direction:column;gap:12px}" +
        "#gate h1{margin:0 0 4px;font-family:var(--font-display,inherit);font-weight:800;font-size:38px;letter-spacing:-.04em;line-height:1}" +
        "#gate p{margin:0 0 8px;color:var(--muted,#5a6479);font-size:14px}" +
        "#gate input{min-height:50px;border:1.5px solid var(--line,#dbe0ec);border-radius:10px;padding:0 14px;font:inherit;font-size:16px;background:var(--surface,#fff);color:inherit}" +
        "#gate button{min-height:50px;border:0;border-radius:10px;background:var(--accent,#2a43a6);color:var(--accent-ink,#fff);font:inherit;font-weight:700;font-size:16px}" +
        "#gate button[disabled]{opacity:.6}#gate .err{color:#b3261e;font-size:14px;min-height:20px;margin:0}";
      document.head.appendChild(st);
      var g = document.createElement("div");
      g.id = "gate";
      g.innerHTML = '<form autocomplete="on"><h1>Dressing</h1><p>Connecte-toi pour retrouver ton dressing.</p>' +
        '<input type="email" name="email" placeholder="E-mail" autocomplete="username" autocapitalize="off" required>' +
        '<input type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" required>' +
        '<p class="err" role="alert"></p><button type="submit">Se connecter</button></form>';
      document.body.appendChild(g);
      var f = g.querySelector("form"), err = g.querySelector(".err"), btn = g.querySelector("button");
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        btn.disabled = true; err.textContent = "";
        var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (r.error || !r.data || !r.data.session) {
          err.textContent = "E-mail ou mot de passe incorrect.";
          btn.disabled = false; return;
        }
        g.remove(); st.remove();
        resolve(r.data.session);
      });
    });
  }
  function ready() {
    if (readyP) return readyP;
    readyP = (async function () {
      sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      var r = await sb.auth.getSession();
      session = r.data && r.data.session ? r.data.session : await gate();
      sb.auth.onAuthStateChange(function (ev, s) {
        if (ev === "SIGNED_OUT") location.reload();
        else if (s) session = s;
      });
      return session;
    })();
    return readyP;
  }
  async function token() {
    var r = await sb.auth.getSession();
    if (!r.data || !r.data.session) throw mkErr("not_granted", "Session expirée");
    return r.data.session.access_token;
  }

  // ---------- Données ----------
  function mkSnap(map) {
    var docs = [];
    map.forEach(function (d, id) { docs.push({ id: id, exists: true, data: function () { return d; } }); });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }
  function mkDb(uid) {
    var colls = {}, chan = null;
    function st(coll) { return colls[coll] || (colls[coll] = { map: new Map(), subs: [], p: null, loaded: false }); }
    async function fetchAll(coll) {
      var out = [], from = 0, step = 1000;
      for (;;) {
        var r = await sb.from("docs").select("id,data").eq("coll", coll).order("id").range(from, from + step - 1);
        if (r.error) throw r.error;
        out = out.concat(r.data);
        if (r.data.length < step) break;
        from += step;
      }
      return out;
    }
    function emit(coll) {
      var s = st(coll); if (!s.loaded) return;
      var snap = mkSnap(s.map);
      s.subs.slice().forEach(function (sub) { try { sub.ok(snap); } catch (e) { if (window.console) console.error(e); } });
    }
    async function load(coll) {
      var s = st(coll), rows = await fetchAll(coll);
      s.map = new Map(rows.map(function (r) { return [r.id, r.data]; }));
      s.loaded = true;
    }
    function listen() {
      if (chan) return;
      chan = sb.channel("dressing-docs").on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "user_id=eq." + uid }, function (p) {
        var rec = p.eventType === "DELETE" ? p.old : p.new;
        if (!rec || !rec.coll || !colls[rec.coll] || !colls[rec.coll].loaded) return;
        var s = colls[rec.coll];
        if (p.eventType === "DELETE") s.map.delete(rec.id); else s.map.set(rec.id, rec.data);
        emit(rec.coll);
      }).subscribe();
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") return;
        Object.keys(colls).forEach(function (coll) {
          var s = colls[coll]; if (!s.loaded) return;
          fetchAll(coll).then(function (rows) {
            var next = new Map(rows.map(function (r) { return [r.id, r.data]; }));
            if (JSON.stringify(Array.from(next)) !== JSON.stringify(Array.from(s.map))) { s.map = next; emit(coll); }
          }).catch(function () { /* on garde l'état local */ });
        });
      });
    }
    async function write(coll, apply, remote) {
      var s = st(coll), before = s.loaded ? new Map(s.map) : null;
      if (s.loaded) { apply(s.map); emit(coll); }
      var r;
      try { r = await remote(); } catch (e) { r = { error: e }; }
      if (r && r.error) {
        if (before) { s.map = before; emit(coll); }
        throw mkErr("write_failed", r.error.message || "Écriture impossible");
      }
    }
    function docRef(coll, id) {
      return {
        id: id, path: coll + "/" + id,
        set: function (data) {
          var d = clean(data);
          return write(coll, function (m) { m.set(id, d); }, function () {
            return sb.from("docs").upsert({ user_id: uid, coll: coll, id: id, data: d, updated_at: new Date().toISOString() }, { onConflict: "user_id,coll,id" });
          });
        },
        update: function (patch) {
          var p = clean(patch);
          return write(coll, function (m) { if (m.has(id)) m.set(id, Object.assign({}, m.get(id), p)); }, function () {
            return sb.rpc("doc_update", { p_coll: coll, p_id: id, p_patch: p });
          });
        },
        delete: function () {
          return write(coll, function (m) { m.delete(id); }, function () {
            return sb.from("docs").delete().eq("coll", coll).eq("id", id);
          });
        },
        get: async function () {
          var s = st(coll);
          if (s.loaded) { var d = s.map.get(id); return { id: id, exists: !!d, data: function () { return d; } }; }
          var r = await sb.from("docs").select("data").eq("coll", coll).eq("id", id).maybeSingle();
          if (r.error) throw r.error;
          return { id: id, exists: !!r.data, data: function () { return r.data ? r.data.data : undefined; } };
        },
        collection: function (name) { return collRef(coll + "/" + id + "/" + name); }
      };
    }
    function collRef(coll) {
      return {
        path: coll,
        doc: function (id) { return docRef(coll, id || uuid()); },
        onSnapshot: function (ok, err) {
          var s = st(coll), sub = { ok: ok, err: err };
          s.subs.push(sub);
          listen();
          (s.p || (s.p = load(coll))).then(function () { if (s.subs.indexOf(sub) >= 0) ok(mkSnap(s.map)); })
            .catch(function (e) { s.p = null; if (err) err(e); });
          return function () { var i = s.subs.indexOf(sub); if (i >= 0) s.subs.splice(i, 1); };
        }
      };
    }
    return {
      collection: collRef,
      doc: function (path) {
        var parts = path.split("/"), id = parts.pop();
        return docRef(parts.join("/"), id);
      }
    };
  }

  // ---------- Photos ----------
  function mkAssets(uid) {
    return {
      upload: async function (blob, opts) {
        var id = uid + "/" + uuid(), type = (opts && opts.type) || blob.type || "image/jpeg";
        var r = await sb.storage.from("photos").upload(id, blob, { contentType: type, cacheControl: "31536000", upsert: false });
        if (r.error) throw mkErr("upload_failed", r.error.message);
        return { id: id, url: "blob/" + id, sizeBytes: blob.size, contentType: type };
      },
      delete: async function (id) {
        var r = await sb.storage.from("photos").remove([id]);
        if (r.error) throw mkErr("delete_failed", r.error.message);
      },
      list: async function () { return { assets: [], usage: null }; }
    };
  }

  // ---------- IA ----------
  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result), i = s.indexOf(","); res({ media_type: blob.type || "image/jpeg", data: s.slice(i + 1) }); };
      r.onerror = function () { rej(mkErr("images_unavailable")); };
      r.readAsDataURL(blob);
    });
  }
  function parseJson(text) {
    var t = String(text || "").trim();
    if (!t) throw mkErr("empty_completion");
    try { return JSON.parse(t); } catch (e) { /* on cherche l'objet dans le texte */ }
    var f = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(f); } catch (e) { /* suite */ }
    var a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* suite */ } }
    throw mkErr("invalid_json");
  }
  function mkSample() {
    async function ask(input, opts) {
      var prompt = typeof input === "string" ? input : (Array.isArray(input) ? input.map(function (m) { return m.content; }).join("\n\n") : "");
      var imgs = opts.images ? (Array.isArray(opts.images) ? opts.images : [opts.images]) : [];
      var images = await Promise.all(imgs.map(toB64));
      var ctl = new AbortController(), timedOut = false;
      var to = setTimeout(function () { timedOut = true; ctl.abort(); }, 90000);
      if (opts.signal) {
        if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener("abort", function () { ctl.abort(); });
      }
      try {
        var res = await fetch(CFG.url + "/functions/v1/claude-proxy", {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()), apikey: CFG.anonKey },
          body: JSON.stringify({ prompt: prompt, images: images, tier: opts.modelTier || "default" })
        });
        var j = null; try { j = await res.json(); } catch (e) { /* corps vide */ }
        if (!res.ok) {
          var c = j && j.error && j.error.code;
          if (res.status === 401 || res.status === 403) throw mkErr("not_granted");
          if (res.status === 429) throw mkErr("rate_limited");
          throw mkErr(c || "error", j && j.error && j.error.message);
        }
        return j.text;
      } catch (e) {
        if (e && e.name === "AbortError") throw mkErr(timedOut ? "error" : "cancelled", timedOut ? "Délai dépassé" : "Arrêté");
        throw e;
      } finally { clearTimeout(to); }
    }
    return {
      limits: async function () { return { images: { maxCount: 4 } }; },
      json: async function (input, opts) { return parseJson(await ask(input, opts || {})); }
    };
  }

  // ---------- Téléchargements ----------
  function mkDownloads() {
    var mimes = { csv: "text/csv;charset=utf-8", json: "application/json", zip: "application/zip" };
    return {
      save: async function (r) {
        var ext = String(r.filename || "").split(".").pop().toLowerCase();
        var blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: mimes[ext] || "application/octet-stream" });
        var mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
        if (mobile && navigator.canShare && window.File) {
          var file = new File([blob], r.filename, { type: blob.type });
          if (navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file] }); return { status: "saved" }; }
            catch (e) { if (e && e.name === "AbortError") throw mkErr("declined"); /* sinon on tente le lien */ }
          }
        }
        var a = document.createElement("a"), url = URL.createObjectURL(blob);
        a.href = url; a.download = r.filename; a.style.display = "none";
        document.body.appendChild(a); a.click();
        setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
        return { status: "saved" };
      }
    };
  }

  // ---------- Point d'entrée ----------
  window.claude = {
    use: async function (name) {
      if (!configured) return null;
      try { await ready(); } catch (e) { return null; }
      var uid = session.user.id;
      if (!API.db) {
        API.db = mkDb(uid); API.assets = mkAssets(uid); API.sample = mkSample(); API.downloads = mkDownloads();
        API.user = { id: async function () { return uid; }, me: async function () { return { id: uid }; }, isOwner: function () { return true; }, canEdit: function () { return true; } };
      }
      return API[name] || null;
    }
  };
  window.__dressingShim = { parseJson: parseJson, configured: configured };

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () { /* hors ligne indisponible */ }); });
  }
})();
