// Categories + derived fields. The photo list itself lives in photos.js (written by /admin.html).
window.CATEGORIES = [
  { id: "astro",    name: "Astro",    code: "AST" },
  { id: "rocketry", name: "Rocketry", code: "RKT" },
  { id: "nature",   name: "Nature",   code: "NAT" },
  { id: "urban",    name: "Urban",    code: "URB" },
  { id: "misc",     name: "Misc",     code: "MSC" },
];

window.PHOTOS = (function () {
  const n = {};
  return (window.PHOTOS_RAW || []).map(raw => {
    const p = Object.assign({}, raw);
    p.type = /\.(mp4|webm|mov)$/i.test(p.src) ? "video" : "image";
    const c = window.CATEGORIES.find(c => c.id === p.cat) || window.CATEGORIES[4];
    n[c.id] = (n[c.id] || 0) + 1;
    p.no = c.code + "-" + String(n[c.id]).padStart(4, "0");
    p.name = p.title || p.place || p.no;
    return p;
  });
})();

// Homepage rotation: pinned items first (home: 1, 2, 3…), then the other featured ones.
window.HOME = PHOTOS.filter(p => p.home).sort((a, b) => a.home - b.home)
  .concat(PHOTOS.filter(p => p.featured && !p.home));
