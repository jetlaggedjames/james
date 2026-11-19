// Dashboard helpers for the online setup.
//  GH.commit(files, message)  — writes files to the GitHub repo in ONE commit (only files that changed are uploaded).
//                               Cloudflare Pages sees the commit and republishes the site automatically.
//  processPhoto(file)          — in-browser version of the photo pipeline: upright, resized to 2400px,
//                               invisible watermark, 640px thumbnail, camera details read from EXIF.
// The GitHub token lives only in this browser's storage (never in the site's files).
(function () {
  const ls = {
    get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------------- GitHub ----------------
  const cfg = () => ({ repo: ls.get("gh.repo").replace(/[^\w.\-\/]/g, ""), branch: ls.get("gh.branch") || "main", token: ls.get("gh.token").replace(/[^A-Za-z0-9_]/g, "") });
  async function api(path, opts = {}) {
    const c = cfg();
    let r;
    for (let attempt = 1; ; attempt++) {          // retry dropped connections a few times before giving up
      try {
        r = await fetch(`https://api.github.com/repos/${c.repo}${path}`, {
          ...opts,
          headers: { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
        });
        if (r.status >= 500 && attempt < 4) throw new Error("server " + r.status);
        break;
      } catch (e) {
        if (attempt >= 4) throw new Error("couldn't reach GitHub (" + e.message + "). Check your connection and try again");
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
    if (!r.ok) {
      const m = (await r.json().catch(() => ({}))).message || r.statusText;
      throw new Error(r.status === 401 ? "GitHub rejected the token" : r.status === 404 ? "repo not found (check the name and the token's access)" :
        r.status === 409 ? "the repo is empty: create it with a README first" : `GitHub ${r.status}: ${m}`);
    }
    return r.status === 204 ? null : r.json();
  }
  async function b64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function gitSha(blob) {                       // git's own hash, to skip files GitHub already has
    const buf = new Uint8Array(await blob.arrayBuffer());
    const head = new TextEncoder().encode(`blob ${buf.length}\0`);
    const all = new Uint8Array(head.length + buf.length); all.set(head); all.set(buf, head.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", all))].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  async function commit(files, message, progress = () => {}) {   // files: [{path, blob}]
    const c = cfg();
    const ref = await api(`/git/ref/heads/${encodeURIComponent(c.branch)}`);
    const head = await api(`/git/commits/${ref.object.sha}`);
    const tree = await api(`/git/trees/${head.tree.sha}?recursive=1`);
    const have = new Map(tree.tree.filter(t => t.type === "blob").map(t => [t.path, t.sha]));
    const entries = [];
    let i = 0;
    for (const f of files) {
      progress(++i, files.length, f.path);
      if (have.get(f.path) === await gitSha(f.blob)) continue;
      const b = await api("/git/blobs", { method: "POST", body: JSON.stringify({ content: await b64(f.blob), encoding: "base64" }) });
      entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
    }
    if (!entries.length) return 0;
    const t = await api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }) });
    const cm = await api("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
    await api(`/git/refs/heads/${encodeURIComponent(c.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: cm.sha }) });
    return entries.length;
  }
  window.GH = {
    cfg, commit, ls,
    ready: () => { const c = cfg(); return !!(c.repo && c.token); },
    // git hash of a file as it is on GitHub right now (null if missing)
    remoteSha: async path => {
      try { const r = await api(`/contents/${path}?ref=${encodeURIComponent(cfg().branch)}`); return r.sha; } catch (e) { return null; }
    },
    sha: gitSha,
    check: () => api(""),
  };

  // ---------------- photo pipeline (browser) ----------------
  function readExif(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o < v.byteLength - 10) {
      const mk = v.getUint16(o), len = v.getUint16(o + 2);
      if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
      if ((mk & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
    return {};
  }
  function parseTiff(v, t) {
    const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le), out = {};
    const str = (p, n) => { let s = ""; for (let i = 0; i < n; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
    const rat = p => u32(p) / (u32(p + 4) || 1);
    function ifd(off, tags) {
      const n = u16(t + off);
      for (let i = 0; i < n; i++) {
        const e = t + off + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), vo = e + 8;
        const ptr = cnt * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] || 1) > 4 ? t + u32(vo) : vo;
        if (tags[tag]) out[tags[tag]] = type === 2 ? str(ptr, cnt) : type === 3 ? u16(ptr) : type === 4 ? u32(ptr) : (type === 5 || type === 10) ? rat(ptr) : null;
      }
    }
    try {
      ifd(u32(t + 4), { 0x010F: "make", 0x0110: "model", 0x8769: "exif" });
      if (out.exif) ifd(out.exif, { 0x9003: "date", 0x829A: "exposure", 0x829D: "fnum", 0x8827: "iso", 0x920A: "focal", 0xA434: "lens" });
    } catch (e) {}
    return out;
  }
  function exifFields(x) {
    const f = {};
    if (x.model) f.camera = /450D|Rebel XSi/i.test(x.model) ? "Canon EOS Rebel XSi" : (x.model.startsWith(x.make || "#") ? x.model : `${x.make || ""} ${x.model}`.trim());
    if (x.date) f.date = x.date.slice(0, 10).replace(/:/g, "-");
    if (x.lens) f.lens = x.lens;
    const s = [];
    if (x.focal) s.push(Math.round(x.focal) + "mm");
    if (x.fnum) s.push("f/" + (+x.fnum.toFixed(1)));
    if (x.exposure) s.push(x.exposure >= 1 ? x.exposure + "s" : "1/" + Math.round(1 / x.exposure) + "s");
    if (x.iso) s.push("ISO " + x.iso);
    if (s.length) f.settings = s.join(" · ");
    return f;
  }
  const toBlob = (c, q) => new Promise(r => c.toBlob(r, "image/jpeg", q));
  function draw(src, w, h, rotate = 0) {
    const c = document.createElement("canvas");
    const swap = rotate % 180 !== 0;
    c.width = swap ? h : w; c.height = swap ? w : h;
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.translate(c.width / 2, c.height / 2); x.rotate(rotate * Math.PI / 180);
    x.drawImage(src, -w / 2, -h / 2, w, h);
    x.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }
  function watermark(c, owner = "James") {     // ~1% opacity, tiled; invisible unless levels are pushed hard
    const x = c.getContext("2d"), w = c.width, h = c.height, fs = Math.max(18, Math.round(w / 22)), span = Math.max(w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-24 * Math.PI / 180);
    x.font = `${fs}px Consolas, "IBM Plex Mono", monospace`;
    let row = 0;
    for (let y = -span; y < span; y += fs * 3) {
      row++;
      x.fillStyle = row % 2 ? "rgba(255,255,255,0.008)" : "rgba(0,0,0,0.008)";
      for (let X = -span + (row % 2) * fs * 3.5; X < span; X += fs * 7) x.fillText("© " + owner, X, y);
    }
    x.restore();
  }
  async function thumbOf(c) {
    const s = Math.min(1, 640 / Math.max(c.width, c.height));
    return toBlob(draw(c, Math.round(c.width * s), Math.round(c.height * s)), 0.8);
  }
  window.processPhoto = async function (file) {
    const meta = /jpe?g$/i.test(file.type || file.name) ? exifFields(readExif(await file.arrayBuffer())) : {};
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = draw(bmp, Math.round(bmp.width * s), Math.round(bmp.height * s));
    watermark(c);
    const full = await toBlob(c, 0.88);
    return { full, thumb: await thumbOf(c), w: c.width, h: c.height, bytes: full.size, ...meta };
  };
  window.rotatePhoto = async function (blob, deg) {
    const bmp = await createImageBitmap(blob);
    const c = draw(bmp, bmp.width, bmp.height, deg);
    const full = await toBlob(c, 0.9);
    return { full, thumb: await thumbOf(c), w: c.width, h: c.height, bytes: full.size };
  };
})();
