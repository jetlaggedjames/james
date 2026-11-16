// Text-art engine: photos, animated GIFs and videos rendered as characters (fills the frame, cover crop).
(function () {
  const RAMP = " .'`^,:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const L = RAMP.length - 1;
  const CW = 0.6; // IBM Plex Mono advance width ÷ font size
  window.motionOK = () => document.documentElement.dataset.motion !== "reduced" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cache = new Map();
  const once = (key, fn) => (cache.has(key) ? cache.get(key) : (cache.set(key, fn()), cache.get(key)));
  const loadImg = src => once(src, () => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
  }));
  const loadVideo = src => once(src, () => new Promise(res => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    v.addEventListener("loadeddata", () => res(v), { once: true });
    v.addEventListener("error", () => res(null), { once: true });
  }));
  const loadFrames = src => !/\.(gif|webp)$/i.test(src) || !("ImageDecoder" in window) ? Promise.resolve(null)
    : once("frames:" + src, async () => {
      try {
        const dec = new ImageDecoder({ data: await (await fetch(src)).arrayBuffer(), type: /gif$/i.test(src) ? "image/gif" : "image/webp" });
        await dec.tracks.ready;
        const n = dec.tracks.selectedTrack.frameCount;
        if (n < 2) return null;
        const out = [];
        for (let i = 0; i < n; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          out.push({ bmp: await createImageBitmap(image), dur: Math.max(40, (image.duration || 80000) / 1000) });
          image.close();
        }
        return out;
      } catch (e) { return null; }
    });
  window.preloadArt = item => item.type === "video" ? loadVideo(item.src) : loadImg(item.src).catch(() => {});

  class Art {
    constructor(pre, opts = {}) {
      this.pre = pre; this.opts = opts;           // opts: {cols, minFont, fit: "cover" | "contain"}
      this.token = 0; this.queued = false; this.media = null; this.ended = null; this.stats = null;
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    size(w, h) {
      this.fs = Math.max(this.opts.minFont || 4, w / (this.opts.cols || 200) / CW);
      this.cols = Math.max(10, Math.floor(w / (this.fs * CW)));
      this.rows = Math.max(5, Math.floor(h / this.fs));
      this.pre.style.fontSize = this.fs + "px";
      const n = this.cols * this.rows;
      if (!this.cur || this.cur.length !== n) {
        this.cur = new Uint8Array(n); this.tgt = new Uint8Array(n); this.delay = new Float32Array(n);
      }
      this.stats = null;
    }
    sample(src, w, h, live = false) {
      const c = this.canvas, x = this.ctx, C = this.cols, R = this.rows;
      if (c.width !== C || c.height !== R) { c.width = C; c.height = R; }
      const asp = 1 / CW, boxW = C, boxH = R * asp;
      const s = this.opts.fit === "contain" ? Math.min(boxW / w, boxH / h) : Math.max(boxW / w, boxH / h);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = "#fff"; x.fillRect(0, 0, C, R);
      x.imageSmoothingQuality = "high";
      x.save(); x.scale(1, 1 / asp); x.translate(boxW / 2, boxH / 2);
      x.drawImage(src, -w * s / 2, -h * s / 2, w * s, h * s);
      x.restore();
      const d = x.getImageData(0, 0, C, R).data, n = C * R;
      const lum = this._lum && this._lum.length === n ? this._lum : (this._lum = new Float32Array(n));
      const out = this._out && this._out.length === n ? this._out : (this._out = new Float32Array(n));
      for (let i = 0; i < n; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      // unsharp mask: pulls edges (panel seams, trusses) out of haze; gentler on video grain
      const sharp = this.isVideo ? 0.25 : 0.6;
      for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
        let sum = 0, k = 0;
        for (let dr = -1; dr <= 1; dr++) { const rr = r + dr; if (rr < 0 || rr >= R) continue;
          for (let dq = -1; dq <= 1; dq++) { const qq = q + dq; if (qq >= 0 && qq < C) { sum += lum[rr * C + qq]; k++; } } }
        const i = r * C + q;
        out[i] = lum[i] + sharp * (lum[i] - sum / k);
      }
      // background = most common tone; it becomes blank paper
      const hist = new Uint32Array(64);
      for (let i = 0; i < n; i++) hist[Math.min(63, Math.max(0, (lum[i] * 64) | 0))]++;
      let mb = 0; for (let b = 1; b < 64; b++) if (hist[b] > hist[mb]) mb = b;
      const share = hist[mb] / n;
      let bg = (mb + 0.5) / 64;
      const st = Math.max(1, n >> 12), sm = [];
      for (let i = 0; i < n; i += st) sm.push(out[i]);
      sm.sort((a, b) => a - b);
      let lo = sm[Math.floor(sm.length * 0.02)], hi = sm[Math.floor(sm.length * 0.98)];
      if (live && this.stats) { const k = 0.15, p = this.stats; bg = p.bg + (bg - p.bg) * k; lo = p.lo + (lo - p.lo) * k; hi = p.hi + (hi - p.hi) * k; }
      this.stats = { bg, lo, hi };
      const darkBg = bg < 0.35;                         // night sky: bright things are the ink
      const useBg = share > 0.06;
      const ref = useBg ? bg : (darkBg ? lo : hi);
      const span = Math.max(0.04, darkBg ? hi - ref : ref - lo);
      const spanUp = Math.max(0.04, hi - ref);
      const dead = this.isVideo ? 0.13 : (useBg ? 0.09 : 0.07);
      for (let i = 0; i < n; i++) {
        let v = darkBg ? (out[i] - ref) / span : (ref - out[i]) / span;
        // light background: things brighter than the sky (plumes, flames) still show, at reduced weight
        if (this.isVideo && !darkBg && v < 0) v = ((out[i] - ref) / spanUp) * 0.6;
        v = Math.min(1, v);
        this.tgt[i] = v < dead ? 0 : Math.round(Math.pow((v - dead) / (1 - dead), 1.2) * L);
      }
    }
    requestDraw() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; this.draw(); });
    }
    draw() {
      const C = this.cols, R = this.rows, cur = this.cur, lines = new Array(R);
      for (let r = 0; r < R; r++) {
        let s = "";
        for (let c = 0, i = r * C; c < C; c++, i++) s += RAMP[cur[i]];
        lines[r] = s;
      }
      this.pre.textContent = lines.join("\n");
    }
    roll(my) {
      if (!motionOK()) { this.cur.set(this.tgt); this.requestDraw(); return Promise.resolve(); }
      const t0 = performance.now(), C = this.cols;
      for (let i = 0; i < this.tgt.length; i++) this.delay[i] = t0 + ((i % C) / C) * 700 + Math.random() * 400;
      return new Promise(done => {
        const tick = now => {
          if (my !== this.token) return done();
          let moving = false;
          const cur = this.cur, tgt = this.tgt, dl = this.delay;
          for (let i = 0; i < cur.length; i++) {
            const a = cur[i], b = tgt[i];
            if (a === b) continue;
            moving = true;
            if (now >= dl[i]) cur[i] = a < b ? Math.min(b, a + 3) : Math.max(b, a - 3);
          }
          this.draw();
          if (moving) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
      });
    }
    stop() { this.token++; if (this.media) this.media.pause(); this.media = null; }
    async show(item) {
      this.stop();
      const my = this.token;
      this.ended = null;
      this.isVideo = item.type === "video";
      if (this.isVideo) {
        const v = await loadVideo(item.src);
        if (!v || my !== this.token) return;
        this.media = v;
        if (v.currentTime !== 0) { v.currentTime = 0; await new Promise(r => v.addEventListener("seeked", r, { once: true })); }
        this.stats = null;
        this.sample(v, v.videoWidth, v.videoHeight);
        this.ended = new Promise(r => v.addEventListener("ended", r, { once: true }));
        await this.roll(my);
        if (my !== this.token) return;
        v.play().catch(() => {});
        const cur = this.cur, tgt = this.tgt;
        const frame = () => {
          if (my !== this.token || v.ended) return;
          this.sample(v, v.videoWidth, v.videoHeight, true);
          for (let i = 0; i < cur.length; i++) {          // ignore one-step flicker
            const dl = tgt[i] - cur[i];
            if (dl > 1 || dl < -1 || tgt[i] === 0) cur[i] = tgt[i];
          }
          this.requestDraw();
          v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
        };
        v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
        return;
      }
      const [img, frames] = await Promise.all([loadImg(item.src).catch(() => null), loadFrames(item.src)]);
      if (my !== this.token || !img) return;
      const first = frames ? frames[0].bmp : img;
      this.sample(first, first.width, first.height);
      await this.roll(my);
      if (!frames || my !== this.token) return;
      let f = 0;
      const play = () => {
        if (my !== this.token) return;
        f = (f + 1) % frames.length;
        const b = frames[f].bmp;
        this.sample(b, b.width, b.height, true); this.cur.set(this.tgt); this.requestDraw();
        setTimeout(play, frames[f].dur);
      };
      setTimeout(play, frames[0].dur);
    }
  }
  window.AsciiArt = Art;
})();
