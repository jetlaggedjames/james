// Shared: settings (theme/motion), header, footer, signature strokes, odometer, cabinet tabs, zoom picker,
// page transitions, text morph.
(function () {
  window.motionOK = window.motionOK || (() => document.documentElement.dataset.motion !== "reduced" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const root = document.documentElement;
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
  };
  const applyPrefs = () => {
    const t = store.get("theme"); t ? (root.dataset.theme = t) : delete root.dataset.theme;
    const m = store.get("motion"); m ? (root.dataset.motion = m) : delete root.dataset.motion;
  };
  applyPrefs();

  // ---- signature, traced from James's drawing (units = pixels of the original sketch) ----
  window.SIG = {
    box: [40, 140, 1064, 505],
    steps: [
      [[[52,162],[300,148],[700,158],[1035,165],[1040,250],[1052,465],[900,470],[490,475],[300,495],[92,495],[92,330],[65,170],[52,162]]],
      [[[300,150],[290,260],[300,493]], [[485,158],[490,477]], [[700,158],[715,330],[715,474]], [[875,163],[895,330],[897,472]]],
      [[[92,262],[180,252],[183,380]]],                          // J
      [[[365,233],[412,232]]], [[[400,312],[400,430],[410,475]]], // A
      [[[572,268],[575,473]]], [[[628,265],[635,472]]],          // M
      [[[788,252],[880,252]]],                                   // E
      [[[815,360],[978,366]]],                                   // E → S in one go
      [[[955,250],[1037,255]]],                                  // S
    ],
  };

  // ---- odometer: each digit is a strip that rolls to its value (continues from the last value) ----
  const STRIP = Array.from({ length: 10 }, (_, i) => `<i>${i}</i>`).join("");
  window.odometer = function (el, value, width = 3, delay = 0) {
    const s = String(Math.max(0, value | 0)).padStart(width, "0");
    if (!el._digits || el._digits.length !== s.length) {
      el.classList.add("odo");
      el.innerHTML = [...s].map(() => `<span class="od"><span class="st">${STRIP}</span></span>`).join("");
      el._digits = [...el.querySelectorAll(".st")];
      el.offsetWidth; // commit the 0 state so the first roll animates
    }
    el._digits.forEach((st, i) => {
      st.style.transitionDelay = delay + i * 70 + "ms";
      st.style.transform = `translateY(-${+s[i] * 10}%)`;
    });
  };

  // ---- cabinet tabs; the outline runs along the edges to the tab you pick ----
  window.Tabs = function (el, items, active, onChange) {
    el.classList.add("tabs");
    el.innerHTML = items.map(t => `<button type="button" data-id="${t.id}" class="${t.id === active ? "on" : ""}">${t.label}${
      t.count != null ? `<span class="n" data-n="${t.count}"></span>` : ""}</button>`).join("") +
      `<svg class="snake" aria-hidden="true"><path class="base"/><path class="hi"/></svg>`;
    el.querySelectorAll(".n").forEach((n, i) => odometer(n, +n.dataset.n, 2, 150 + i * 50));
    const svg = el.querySelector("svg"), base = svg.querySelector(".base"), hi = svg.querySelector(".hi");
    let cur = el.querySelector(".on") || el.querySelector("button"), anim = null;
    cur.classList.add("on");
    const geo = () => {
      const e = el.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${e.width} ${e.height}`);
      return { w: e.width, top: 0.75, bot: Math.round(e.height) - 0.75, e };
    };
    const box = (b, g) => { const r = b.getBoundingClientRect(); return { l: Math.round(r.left - g.e.left) + 0.5, r: Math.round(r.right - g.e.left) - 0.5 }; };
    const settle = () => {
      if (anim) { anim.cancel(); anim = null; }
      const g = geo(), a = box(cur, g);
      base.setAttribute("d", `M0 ${g.bot} H${g.w}`);
      hi.style.strokeDasharray = "none"; hi.style.strokeDashoffset = 0;
      hi.setAttribute("d", `M${a.l} ${g.bot} V${g.top} H${a.r} V${g.bot}`);
    };
    settle();
    new ResizeObserver(settle).observe(el);
    document.fonts && document.fonts.ready.then(settle);
    el.addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b || b === cur) return;
      const g = geo(), a = box(cur, g), n = box(b, g), h = g.bot - g.top;
      if (anim) anim.cancel();
      cur.classList.remove("on"); b.classList.add("on"); cur = b;
      onChange(b.dataset.id);
      if (!motionOK()) return settle();
      // one continuous path: old outline → along the baseline → new outline
      const right = n.l > a.l;
      hi.setAttribute("d", right
        ? `M${a.l} ${g.bot} V${g.top} H${a.r} V${g.bot} H${n.l} V${g.top} H${n.r} V${g.bot}`
        : `M${a.r} ${g.bot} V${g.top} H${a.l} V${g.bot} H${n.r} V${g.top} H${n.l} V${g.bot}`);
      const T = hi.getTotalLength(), Lo = 2 * h + (a.r - a.l), Ln = 2 * h + (n.r - n.l), GAP = T + 10;
      // the visible dash shrinks from the old outline's length to the new one's while sliding to the end
      anim = hi.animate([
        { strokeDasharray: `${Lo} ${GAP}`, strokeDashoffset: 0 },
        { strokeDasharray: `${Math.max(Lo, Ln) * 0.6} ${GAP}`, strokeDashoffset: -(T - Ln) * 0.55, offset: 0.55 },
        { strokeDasharray: `${Ln} ${GAP}`, strokeDashoffset: -(T - Ln) },
      ], { duration: 460, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" });
      anim.onfinish = () => settle(); // settle() cancels the held end state and draws the clean outline
    });
  };

  // ---- zoom picker; an ink blob stretches from one option to the next ----
  window.Zoomer = function (el, stops, value, onChange) {
    el.classList.add("zoomer");
    el.innerHTML = `<span class="ink"></span>` + stops.map(s =>
      `<button type="button" data-c="${s.cols}" title="${s.cols} per row" aria-label="${s.cols} per row"><i style="grid-template-columns:repeat(${s.k},1fr)">${"<b></b>".repeat(s.k * s.k)}</i></button>`).join("");
    const ink = el.querySelector(".ink"), btns = [...el.querySelectorAll("button")];
    let on = null;
    const rect = b => ({ left: b.offsetLeft, width: b.offsetWidth });
    function select(cols, animate) {
      const b = btns.reduce((a, x) => Math.abs(+x.dataset.c - cols) < Math.abs(+a.dataset.c - cols) ? x : a);
      if (b === on) return;
      const from = on && rect(on), to = rect(b);
      btns.forEach(x => x.classList.toggle("on", x === b));
      if (animate && from && motionOK()) {
        const l = Math.min(from.left, to.left), r = Math.max(from.left + from.width, to.left + to.width);
        ink.animate([
          { left: from.left + "px", width: from.width + "px", borderRadius: "2px" },
          { left: l + "px", width: r - l + "px", borderRadius: "14px", offset: 0.45 },
          { left: to.left + "px", width: to.width + "px", borderRadius: "2px" },
        ], { duration: 420, easing: "cubic-bezier(.5,0,.2,1)" });
      }
      ink.style.left = to.left + "px"; ink.style.width = to.width + "px";
      on = b;
    }
    el.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { select(+b.dataset.c, true); onChange(+b.dataset.c); } });
    requestAnimationFrame(() => select(value, false));
    return { select: c => select(c, true) };
  };

  // ---- header ----
  const here = location.pathname.split("/").pop() || "index.html";
  const isHome = here === "index.html";
  const q = new URLSearchParams(location.search);
  const cur = ok => (ok ? ' aria-current="page"' : "");
  const gear = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" class="teeth"/><circle cx="12" cy="12" r="5.6" class="ring"/><circle cx="12" cy="12" r="2.2" class="hub"/></svg>`;
  document.body.insertAdjacentHTML("afterbegin", `
  <header class="top${isHome ? " home" : ""}">
    ${isHome ? "" : `<a class="mark" href="index.html" aria-label="James, home"><pre aria-hidden="true"></pre></a>`}
    <button class="burger" type="button" aria-label="Menu" aria-expanded="false"><i></i><i></i><i></i></button>
    <nav class="main">
      <div><a href="photos.html"${cur(here === "photos.html")}>Photos</a>
        <div class="drop">${(window.CATEGORIES || []).map(c => `<a href="photos.html?cat=${c.id}">${c.name}</a>`).join("")}</div></div>
      <div><a href="drawer.html?d=projects"${cur(here === "drawer.html" && q.get("d") === "projects")}>Projects</a>
        <div class="drop">
          <a href="drawer.html?d=projects&s=rocketry">Rocketry</a>
          <a href="drawer.html?d=projects&s=telescope">Telescope</a>
          <a href="drawer.html?d=projects&s=misc">Misc</a>
        </div></div>
      <div><a href="drawer.html?d=writings"${cur(here === "drawer.html" && q.get("d") === "writings")}>Writings</a></div>
      <div><a href="drawer.html?d=videos"${cur(here === "drawer.html" && q.get("d") === "videos")}>Videos</a></div>
      <div><a href="about.html"${cur(here === "about.html")}>About</a></div>
      <div><a href="contact.html"${cur(here === "contact.html")}>Contact</a></div>
    </nav>
    <div class="settings">
      <button class="gear" type="button" aria-label="Site settings" aria-expanded="false">${gear}</button>
      <div class="panel" role="dialog" aria-label="Site settings">
        <div class="ph">site settings</div>
        <div class="row"><span>theme</span><div class="seg" data-k="theme"><button data-v="">auto</button><button data-v="light">light</button><button data-v="dark">dark</button></div></div>
        <div class="row"><span>motion</span><div class="seg" data-k="motion"><button data-v="">full</button><button data-v="reduced">calm</button></div></div>
      </div>
    </div>
  </header>`);

  const top = document.querySelector(".top");
  const burger = top.querySelector(".burger"), nav = top.querySelector("nav.main");
  burger.onclick = () => {
    const open = !top.classList.contains("menu-open");
    top.classList.toggle("menu-open", open); burger.setAttribute("aria-expanded", open);
  };
  // ---- page transitions (plain JS + CSS, so every browser gets them) ----
  // leaving: the clicked nav link gets an ink underline, the page content lifts and fades; then we navigate.
  // arriving: the content settles in (body.enter, see style.css).
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.search === location.search) { if (url.hash) return; e.preventDefault(); return; }
    e.preventDefault();
    if (a.closest("nav.main")) a.classList.add("going");
    top.classList.remove("menu-open");
    document.body.classList.add("leave");
    setTimeout(() => location.href = url.href, motionOK() ? 260 : 0);
  });
  addEventListener("pageshow", e => { if (e.persisted) document.body.classList.remove("leave"); });
  document.body.classList.add("enter");

  // ---- subtle text morph for headings that change in place (blur + drift) ----
  window.morphText = function (el, text) {
    if (el.textContent === text) return;
    if (!motionOK() || !el.animate) { el.textContent = text; return; }
    el.getAnimations().forEach(a => a.cancel());
    el.animate([{ opacity: 1, filter: "blur(0)", transform: "none" }, { opacity: 0, filter: "blur(3px)", transform: "translateY(-3px)" }],
      { duration: 140, easing: "ease-in", fill: "forwards" }).onfinish = () => {
      el.textContent = text;
      el.animate([{ opacity: 0, filter: "blur(3px)", transform: "translateY(4px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }],
        { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
      el.getAnimations().forEach(a => { if (a.playState === "finished") a.cancel(); });
    };
  };

  const settings = top.querySelector(".settings"), gearBtn = settings.querySelector(".gear");
  const syncSeg = () => settings.querySelectorAll(".seg").forEach(seg =>
    seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", (store.get(seg.dataset.k) || "") === b.dataset.v)));
  syncSeg();
  const setOpen = open => { settings.classList.toggle("open", open); gearBtn.setAttribute("aria-expanded", open); };
  gearBtn.onclick = e => { e.stopPropagation(); setOpen(!settings.classList.contains("open")); };
  settings.querySelector(".panel").addEventListener("click", e => {
    e.stopPropagation();
    const b = e.target.closest(".seg button"); if (!b) return;
    store.set(b.closest(".seg").dataset.k, b.dataset.v || null); applyPrefs(); syncSeg();
    window.dispatchEvent(new Event("prefschange"));
  });
  document.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape") setOpen(false); });

  // ---- footer + visitor counter ----
  // Placeholder: counts visits in this browser. Once hosted, a tiny server counter replaces this.
  let visits = +store.get("visits") || 0;
  store.set("visits", ++visits);
  document.addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML("beforeend", `
    <footer>
      <span>© ${new Date().getFullYear()} James</span>
      <span class="vc">visitor no. <span class="counter" id="ctr"></span></span>
      <span>last updated ${new Date(document.lastModified).toISOString().slice(0, 10)}</span>
    </footer>`);
    odometer(document.getElementById("ctr"), 1047 + visits, 6, 300);
  });
})();
