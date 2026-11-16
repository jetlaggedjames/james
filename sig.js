// James's block signature, rendered as characters.
//  - drawSignature(pre, widthPx, animate): the homepage name (signs itself, or appears instantly)
//  - header mark: small text version in the nav bar; on hover, light streams out of it as drifting characters
(function () {
  const S = window.SIG, BX = S.box[0], BY = S.box[1], BW = S.box[2] - S.box[0], BH = S.box[3] - S.box[1];
  const CW = 0.6;
  const polyLen = p => { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; };
  const STEPS = S.steps.map(step => step.map(p => ({ p, len: polyLen(p) })));
  const ease = t => 1 - Math.pow(1 - t, 2);
  let T = 0;
  const PLAN = STEPS.map(step => {
    const dur = Math.max(140, Math.max(...step.map(s => s.len)) / 2.4);
    const it = { step, start: T, dur }; T += dur + 60; return it;
  });
  const DRAW_MS = T;

  // rasterize into a C×R grid; prog(stepIndex) → 0..1 drawn
  function raster(C, R, thick, prog) {
    const cells = new Uint8Array(C * R);
    const uc = (C - thick - 1) / BW, ur = uc * CW;
    const y0 = (R - BH * ur) / 2;
    const stepU = 0.3 / uc;
    PLAN.forEach((it, si) => {
      const e = prog(si); if (e <= 0) return;
      for (const s of it.step) {
        let left = s.len * e;
        for (let i = 1; i < s.p.length && left > 0; i++) {
          const [ax, ay] = s.p[i - 1], [bx, by] = s.p[i];
          const seg = Math.hypot(bx - ax, by - ay), use = Math.min(seg, left);
          for (let t = 0; t <= use; t += stepU) {
            const c = Math.round((ax - BX + (bx - ax) * t / seg) * uc);
            const r = Math.round(y0 + (ay - BY + (by - ay) * t / seg) * ur);
            for (let k = 0; k < thick; k++) if (c + k >= 0 && c + k < C && r >= 0 && r < R) cells[r * C + c + k] = 1;
          }
          left -= seg;
        }
      }
    });
    return cells;
  }
  const toText = (cells, C, R) => {
    const out = new Array(R);
    for (let r = 0; r < R; r++) { let s = ""; for (let c = 0, i = r * C; c < C; c++, i++) s += cells[i] ? "#" : " "; out[r] = s; }
    return out.join("\n");
  };
  const gridFor = (cols, thick) => ({ C: cols, R: Math.round(BH * ((cols - thick - 1) / BW) * CW) + 2 });

  window.drawSignature = function (pre, widthPx, animate) {
    const cols = Math.max(48, Math.min(110, Math.round(widthPx / 5.4)));
    const thick = cols >= 70 ? 2 : 1;
    const { C, R } = gridFor(cols, thick);
    pre.style.fontSize = widthPx / (C * CW) + "px";
    if (!animate || !motionOK()) { pre.textContent = toText(raster(C, R, thick, () => 1), C, R); return Promise.resolve(); }
    return new Promise(done => {
      const t0 = performance.now() + 250;
      const tick = now => {
        const t = Math.max(0, now - t0);
        pre.textContent = toText(raster(C, R, thick, si => { const it = PLAN[si]; return ease(Math.min(1, Math.max(0, (t - it.start) / it.dur))); }), C, R);
        t < DRAW_MS ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });
  };

  // ---------------- header mark + light streams ----------------
  function initMark() {
    const mark = document.querySelector(".mark"), top = document.querySelector(".top");
    if (!mark || !top) return;
    const { C, R } = gridFor(46, 1);
    mark.querySelector("pre").textContent = toText(raster(C, R, 1, () => 1), C, R);

    const rays = document.createElement("pre");
    rays.className = "rays"; rays.setAttribute("aria-hidden", "true");
    top.prepend(rays);
    const FS = 9, CWpx = FS * CW, N = 26;
    // each ray: angle + a few particles drifting outward; brightness falls off with distance
    const RAYS = Array.from({ length: N }, (_, k) => ({
      a: (k / N) * Math.PI * 2 + (k % 2 ? 0.06 : -0.04),
      len: 5 + ((k * 5) % 7),
      speed: 0.006 + ((k * 7) % 5) * 0.0012,
      phase: (k * 0.37) % 1,
    }));
    const GLYPH = ["*", "+", ":", "·", "."];      // near → far
    let on = 0, target = 0, raf = 0;
    function frame(now) {
      on += (target - on) * (target ? 0.09 : 0.14);
      const W = top.clientWidth, H = top.clientHeight;
      const cols = Math.ceil(W / CWpx), rows = Math.ceil(H / FS);
      const mr = mark.getBoundingClientRect(), tr = top.getBoundingClientRect();
      const cx = (mr.left - tr.left + mr.width / 2) / CWpx, cy = (mr.top - tr.top + mr.height / 2) / FS;
      const rx = mr.width / 2 / CWpx + 0.5, ry = mr.height / 2 / FS + 0.3;
      const lvl = new Uint8Array(cols * rows), ch = new Array(cols * rows);
      for (const ray of RAYS) {
        const ca = Math.cos(ray.a), sa = Math.sin(ray.a), len = ray.len * on;
        for (let p = 0; p < 3; p++) {                       // three particles per ray
          const s = (((now * ray.speed * 0.1 + ray.phase + p / 3) % 1)) * len;
          const f = s / Math.max(1, ray.len);                // 0 near → 1 far
          if (f > 1) continue;
          const x = Math.round(cx + ca * (rx + s)), y = Math.round(cy + sa * (ry + s * CW));
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const g = Math.min(4, Math.floor(f * 5)), L = 4 - g + 1;
          const i = y * cols + x;
          if (L > lvl[i]) { lvl[i] = L; ch[i] = GLYPH[g]; }
        }
      }
      let html = "";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) { const i = y * cols + x; html += lvl[i] ? `<i class="l${lvl[i]}">${ch[i]}</i>` : " "; }
        html += "\n";
      }
      rays.innerHTML = html;
      rays.style.opacity = Math.min(1, on * 1.2);
      if (on > 0.02 || target) raf = requestAnimationFrame(frame); else { rays.innerHTML = ""; raf = 0; }
    }
    const start = () => { if (!motionOK()) return; target = 1; if (!raf) raf = requestAnimationFrame(frame); };
    const stop = () => target = 0;
    mark.addEventListener("mouseenter", start); mark.addEventListener("focus", start);
    mark.addEventListener("mouseleave", stop); mark.addEventListener("blur", stop);
  }
  initMark();
})();
