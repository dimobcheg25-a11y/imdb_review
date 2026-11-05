// Спільне для index.html і year.html: хелпери, тема, ECharts, картки й модальні вікна.
"use strict";
const D = window.DATA;
const IMG = "https://image.tmdb.org/t/p/";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt1 = (x) => x == null || isNaN(x) ? "—" : x.toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtN = (x) => x.toLocaleString("uk-UA");
const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + fmt1(Math.abs(x));
function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const pl = (n, forms) => `${fmtN(n)} ${plural(n, forms)}`;
const W_TITLE = ["тайтл", "тайтли", "тайтлів"];
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rClass = (r) => r >= 7 ? "r-hi" : r >= 5 ? "r-mid" : "r-lo";
const badge = (r, dec) => `<span class="badge ${rClass(r)}">${dec ? fmt1(r) : r}</span>`;
const regionName = new Intl.DisplayNames(["uk"], { type: "region" });
const langName = new Intl.DisplayNames(["uk"], { type: "language" });
const LANG_FIX = { cn: "yue", xx: null, sh: "sr" };
const OLD_COUNTRIES = { SU: "СРСР", YU: "Югославія", CS: "Чехословаччина", DD: "НДР", XC: "Чехословаччина", XG: "НДР", XK: "Косово" };
function country(code) { if (OLD_COUNTRIES[code]) return OLD_COUNTRIES[code]; try { return regionName.of(code); } catch { return code; } }
function language(code) {
  const c = code in LANG_FIX ? LANG_FIX[code] : code;
  if (!c) return "Без мови";
  try { const n = langName.of(c); return n.charAt(0).toUpperCase() + n.slice(1); } catch { return code; }
}
const flag = (code) => /^[A-Z]{2}$/.test(code) && !OLD_COUNTRIES[code] ? `<img class="flag" src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="" loading="lazy" onerror="this.remove()">` : "";
const poster = (p, size = "w342") => p ? `<img src="${IMG}${size}${p}" alt="" loading="lazy">` : "";
const person = (i) => D.people[i];
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");

// Ролі людей. Режисерів, сценаристів і операторів серіалів TMDB віддає по всіх епізодах — їх не рахуємо.
const SERIES = new Set(["series", "anim_series"]);
const ROLES = [
  { k: "cast", label: "Актори", forms: ["роль", "ролі", "ролей"] },
  { k: "directors", label: "Режисери", noSeries: true },
  { k: "creators", label: "Автори серіалів" },
  { k: "writers", label: "Сценаристи", noSeries: true },
  { k: "composers", label: "Композитори" },
  { k: "cinematographers", label: "Оператори", noSeries: true },
];
const CATS = [
  { k: "all", label: "Усе" },
  { k: "movie", label: "Фільми" },
  { k: "series", label: "Серіали" },
  { k: "cartoon", label: "Мультфільми" },
  { k: "anim_series", label: "Анімаційні серіали" },
  { k: "other", label: "Інше" },
];
const CAT_NAMES = { movie: "Фільм", series: "Серіал", cartoon: "Мультфільм", anim_series: "Анімаційний серіал" };

D.titles.forEach((t) => { t.diff = t.ir != null ? t.r - t.ir : null; t.cats = CAT_NAMES[t.cat] || t.type; });
const byId = new Map(D.titles.map((t) => [t.id, t]));


// ---------- Тема і кольори ----------
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
let C = {};
function readColors() {
  C = { text: css("--text"), text2: css("--text-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"), surface: css("--surface"), surface2: css("--surface-2"),
    s1: css("--s1"), s2: css("--s2"), s3: css("--s3"), border: css("--border"), seq: css("--seq").split(",").map((s) => s.trim()), lo: css("--div-lo"), mid: css("--div-mid"), hi: css("--div-hi"),
    good: css("--good"), midR: css("--mid"), bad: css("--bad") };
}
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem("theme", t) : localStorage.removeItem("theme"); } catch {}
}
try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
$("#themeBtn").onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(dark ? "light" : "dark");
  renderAll();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderAll());

// ---------- ECharts ----------
const charts = {};
function chart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "svg" });
  return charts[id];
}
window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
function tooltip(extra = {}) {
  return { backgroundColor: C.surface, borderColor: C.axis, borderWidth: 1, textStyle: { color: C.text, fontSize: 13 }, extraCssText: "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);", confine: true, ...extra };
}
const axisCommon = () => ({ axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 12 }, splitLine: { lineStyle: { color: C.grid } } });
function colorScale(v, lo, hi) {
  // Розбіжна шкала: червоний — нижче середнього, сірий — середнє, синій — вище.
  const t = Math.max(-1, Math.min(1, (v - (lo + hi) / 2) / ((hi - lo) / 2)));
  return t < 0 ? mix(C.mid, C.lo, -t) : mix(C.mid, C.hi, t);
}
function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  return "#" + pa.map((x, i) => Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, "0")).join("");
}
function hex(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }

// ---------- Агрегації ----------
function groupBy(list, keysOf) {
  const m = new Map();
  for (const t of list) for (const k of keysOf(t)) {
    if (k == null) continue;
    let g = m.get(k); if (!g) m.set(k, (g = { k, items: [], sum: 0 }));
    g.items.push(t); g.sum += t.r;
  }
  for (const g of m.values()) { g.n = g.items.length; g.avg = g.sum / g.n; }
  return [...m.values()];
}

const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
function fmtDate(d) { const [y, m, dd] = d.split("-"); return `${+dd} ${MONTHS[+m - 1]} ${y}`; }

const colName = (i) => D.collections[i].replace(/\s*[|(:–-]?\s*(колекція|збірка)\)?\s*$/i, "").replace(/^(колекція|збірка)\s*/i, "");

// ---------- Постери ----------
function pcard(t, extra) {
  return `<div class="pcard" data-id="${t.id}"><div class="img">${t.p ? poster(t.p) : `<div class="noimg">${esc(t.t)}</div>`}${badge(t.r)}${extra ? `<span class="extra">${extra}</span>` : ""}</div><div class="t">${esc(t.t)}</div><div class="y">${t.y || ""} · ${esc(t.cats)}</div></div>`;
}

// ---------- Модальні вікна ----------
const dlg = $("#dlg");
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
function plist(ids, limit) {
  return (ids || []).slice(0, limit).map((i) => `<span class="pl" data-pid="${i}">${esc(person(i)[0])}</span>`).join(", ");
}
function openTitle(id) {
  const t = byId.get(id); if (!t) return;
  const kv = (k, v) => v ? `<div class="kv"><b>${k}:</b> ${v}</div>` : "";
  $("#dlgBody").innerHTML = `<div class="dlg-title"><div class="pimg">${t.p ? `<img src="${IMG}w342${t.p}" alt="">` : ""}</div><div>
    <h2>${esc(t.t)}</h2>${t.ot && t.ot !== t.t ? `<div class="orig">${esc(t.ot)}</div>` : ""}
    <div class="facts"><span>Моя оцінка ${badge(t.r)}</span>${t.ir ? `<span class="imdb">${fmt1(t.ir)} · ${fmtN(t.v)} гол.</span>` : ""}<span style="color:var(--muted)">оцінено ${fmtDate(t.d)}</span></div>
    ${kv("Рік", t.y)}${kv("Тип", esc(t.cats))}${kv("Жанри", esc(t.g.join(", ")))}
    ${kv("Країни", t.c.map((c) => flag(c) + esc(country(c))).join(", "))}${kv("Мова", t.l ? esc(language(t.l)) : "")}
    ${kv("Тривалість", t.rt ? `${t.rt} хв${SERIES.has(t.cat) ? " (серія)" : ""}` : "")}
    ${kv("Сезонів / серій", t.seasons ? `${t.seasons} / ${t.episodes || "?"}` : "")}
    ${kv("Сезони", (t.sl || []).map((x) => `${x[0]}-й — ${x[1].slice(0, 4)}`).join(", "))}
    ${kv("Режисер", plist(t.directors, 4))}${kv("Автори", plist(t.creators, 4))}${kv("Сценарій", plist(t.writers, 4))}${kv("Композитор", plist(t.composers, 3))}
    ${kv("У ролях", plist(t.cast, 12))}
    ${kv("Франшиза", t.col != null ? esc(colName(t.col)) : "")}
    ${t.ov ? `<p class="ov">${esc(t.ov)}</p>` : ""}
    <div class="links"><a href="https://www.imdb.com/title/${t.id}/" target="_blank" rel="noopener">Відкрити на IMDb ↗</a></div>
  </div></div>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
let personChart = null;
function openPerson(pid) {
  const [name, img] = person(pid);
  const roles = ROLES.map((r) => ({ r, items: D.titles.filter((t) => (t[r.k] || []).includes(pid) && !(r.noSeries && SERIES.has(t.cat))) })).filter((x) => x.items.length);
  const all = [...new Set(roles.flatMap((x) => x.items))];
  const avg = mean(all.map((t) => t.r));
  $("#dlgBody").innerHTML = `<div class="person-head"><div class="ph">${img ? `<img src="${IMG}w185${img}" alt="">` : `<div class="initials" style="font-size:26px">${esc(initials(name))}</div>`}</div>
    <div><h2>${esc(name)}</h2><div class="facts" style="margin:4px 0">${pl(all.length, W_TITLE)} · середня оцінка ${badge(avg, true)}${all.some((t) => t.ir != null) ? ` · IMDb ${fmt1(mean(all.filter((t) => t.ir != null).map((t) => t.ir)))}` : ""}</div></div></div>
    ${all.length > 1 ? `<div class="hint" style="margin:0">Синя лінія — ваші оцінки за роком виходу, помаранчеві точки — IMDb. Клік відкриває тайтл.</div><div class="mini-chart" id="personChart"></div>` : ""}
    ${roles.map(({ r, items }) => `<h3 style="margin:18px 0 10px">${r.label} · ${items.length}</h3><div class="posters-grid">${items.sort((a, b) => b.r - a.r || (b.y || 0) - (a.y || 0)).map((t) => pcard(t)).join("")}</div>`).join("")}`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  if (personChart) { personChart.dispose(); personChart = null; }
  const el = document.getElementById("personChart");
  if (el) {
    personChart = echarts.init(el, null, { renderer: "svg" });
    const pts = all.filter((t) => t.y).sort((a, b) => a.y - b.y);
    personChart.setOption({
      grid: { left: 30, right: 10, top: 10, bottom: 24 },
      tooltip: tooltip({ formatter: (p) => { const t = byId.get(p.data[2]); return `<b>${esc(t.t)}</b> ${t.y}<br>Ви: <b>${t.r}</b>${t.ir ? ` · IMDb ${fmt1(t.ir)}` : ""}`; } }),
      xAxis: { type: "value", min: (v) => v.min - 1, max: (v) => v.max + 1, minInterval: 1, ...axisCommon(), axisLabel: { color: C.muted, formatter: (v) => v } },
      yAxis: { type: "value", min: 0, max: 10, interval: 2, ...axisCommon() },
      series: [
        { type: "line", data: pts.map((t) => [t.y, t.r, t.id]), lineStyle: { width: 2, color: C.s1 }, symbolSize: 10, itemStyle: { color: C.s1, borderColor: C.surface, borderWidth: 2 } },
        { type: "scatter", data: pts.filter((t) => t.ir).map((t) => [t.y, t.ir, t.id]), symbolSize: 7, itemStyle: { color: C.s2, opacity: .8 } },
      ],
    });
    personChart.on("click", (p) => openTitle(p.data[2]));
  }
}
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pid]"); if (p) { openPerson(+p.dataset.pid); return; }
  const t = e.target.closest("[data-id]"); if (t) openTitle(t.dataset.id);
});
