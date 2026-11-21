// Good Cup Post Maker: page logic. Drawing lives in render.js (one routine for preview and export).
import { FMT, INK, defaultStyle, drawSlide, layoutText, photoRect, parseRich, facesNeeded } from "./render.js";
import { zip, unzip } from "./zip.js";
import { addFontFiles, restoreFonts, status as fontStatus, has as hasFont, GS_WEIGHTS, IO_WEIGHTS, idb } from "./fonts.js";

const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
const COLORS = [["#FAF8F3", "Cream"], ["#FFFFFF", "White"], ["#1B1B1B", "Good Cup dark"], ["#000000", "Black"], ["#EDE9E4", "Crema"], ["#D1C8C1", "Cashew"]];
const STORY_SHIFT = 320; // Story words sit 320 px lower than on the carousel (clear of the reply bar)
const MAX_SIDE = 3240;   // working copy of each photo (3x the slide width, enough for zoom)

let P = newProject(), fmt = "c", cur = 0;
const IMG = new Map(); // key -> {bmp, blob, url}
let mark = null, hist = [], hi = -1, commitT = null, saveT = null, drag = null, raf = 0, exporting = false;

function newProject() { return { v: 1, name: "", caption: "", slides: [] }; }
function newSlide(from) {
  const b = from ? JSON.parse(JSON.stringify(from)) : null;
  return {
    id: Math.random().toString(36).slice(2, 9), photo: null, html: "",
    style: b ? b.style : defaultStyle(),
    pos: b ? b.pos : { c: { x: 540, y: 1125 }, s: { x: 540, y: 1125 + STORY_SHIFT } },
    crop: { c: { zoom: 1, ox: 0, oy: 0 }, s: { zoom: 1, ox: 0, oy: 0 } },
    shade: b ? b.shade : 0.62, mark: b ? b.mark : true,
  };
}
const S = () => P.slides[cur];

// ---------- history + autosave ----------
// History holds slides only; the post name and caption are typed outside the preview and are never undone.
function snap() {
  const j = JSON.stringify(P.slides); if (hist[hi] === j) return;
  if (hi >= 0) unconfirm(); // any change after the proofread tick clears it
  hist = hist.slice(0, hi + 1); hist.push(j); if (hist.length > 120) hist.shift(); hi = hist.length - 1; ubtn();
}
function ubtn() { $("undo").disabled = hi <= 0; $("redo").disabled = hi >= hist.length - 1; }
function commit() { clearTimeout(commitT); commitT = setTimeout(() => { commitT = null; snap(); save(); }, 300); }
function flush() { if (commitT) { clearTimeout(commitT); commitT = null; snap(); } }
function restore(j) { P.slides = JSON.parse(j); cur = Math.min(cur, Math.max(0, P.slides.length - 1)); unconfirm(); ui(); save(); }
$("undo").onclick = () => { flush(); if (hi > 0) { hi--; restore(hist[hi]); ubtn(); } };
$("redo").onclick = () => { flush(); if (hi < hist.length - 1) { hi++; restore(hist[hi]); ubtn(); } };
function unconfirm() { const ok = $("ok"); if (ok && ok.checked) { ok.checked = false; gate(); } }
let opened = false; // nothing is written until the saved post has been read back, so an early save can never blank it
async function writeNow() { if (!opened) return; try { await idb("kv", "readwrite", s => s.put(JSON.stringify(P), "project")); } catch (e) {} }
function save() { clearTimeout(saveT); saveT = setTimeout(writeNow, 400); }
// Closing or hiding the tab writes the latest edit at once.
addEventListener("pagehide", () => { flush(); clearTimeout(saveT); writeNow(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { flush(); clearTimeout(saveT); writeNow(); } });

// ---------- photos ----------
async function toBitmap(blob) {
  let bmp = await createImageBitmap(blob);
  const m = Math.max(bmp.width, bmp.height);
  if (m > MAX_SIDE) {
    const k = MAX_SIDE / m, w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    let b2 = null;
    try { b2 = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); } catch (e) {}
    if (b2 && b2.width <= w + 1 && b2.height <= h + 1) { bmp.close && bmp.close(); bmp = b2; }
    else { // some browsers ignore the resize options without an error
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close(); bmp = await createImageBitmap(c); c.width = c.height = 0;
    }
  }
  return bmp;
}
async function loadImageBlob(blob) {
  try { return await toBitmap(blob); }
  catch (e) {
    // Some browsers cannot decode HEIC through createImageBitmap but can through <img> (Safari)
    const url = URL.createObjectURL(blob);
    try { const im = new Image(); im.src = url; await im.decode(); const k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.95)); c.width = c.height = 0; if (!b) throw new Error("decode failed"); return await toBitmap(b); }
    finally { URL.revokeObjectURL(url); }
  }
}
async function putImage(key, blob, stored) {
  const bmp = await loadImageBlob(blob);
  IMG.set(key, { bmp, blob, url: URL.createObjectURL(blob) });
  if (!stored) try { await idb("kv", "readwrite", s => s.put(blob, "img:" + key)); } catch (e) {}
}
async function addPhotos(files) {
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  let failed = [];
  for (const f of list) {
    const key = Math.random().toString(36).slice(2, 11);
    try { await putImage(key, f); } catch (e) { failed.push(f.name); continue; }
    const sl = newSlide(P.slides.length ? P.slides[P.slides.length - 1] : null); sl.photo = key; P.slides.push(sl);
  }
  if (list.length && P.slides.length) cur = P.slides.length - list.length + failed.length;
  cur = Math.max(0, Math.min(cur, P.slides.length - 1));
  ui(); snap(); save();
  if (failed.length) status(`Could not open ${failed.join(", ")}. Open this page in Safari, or save the photo as a JPG first.`, "bad", "photonote");
  else if (!list.length && files.length) status("Those are not photos. Choose JPG, PNG or HEIC files.", "bad", "photonote");
}
$("photos").onchange = e => { addPhotos(e.target.files); e.target.value = ""; };
dropzone($("photodrop"), addPhotos);
$("swapfile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !S()) return;
  const key = Math.random().toString(36).slice(2, 11);
  try { await putImage(key, f); S().photo = key; S().crop = { c: { zoom: 1, ox: 0, oy: 0 }, s: { zoom: 1, ox: 0, oy: 0 } }; ui(); snap(); save(); }
  catch (er) { status("Could not open that photo. Try a JPG.", "bad", "photonote"); }
};
$("swap").onclick = () => $("swapfile").click();
$("del").onclick = () => { if (!S()) return; if (!confirm("Remove this slide?")) return; P.slides.splice(cur, 1); cur = Math.max(0, cur - 1); ui(); snap(); save(); };
// Photos of slides that are gone (and not in the undo history) are removed from browser storage.
async function tidyImages() {
  try {
    const used = new Set(); for (const j of [JSON.stringify(P.slides), ...hist]) for (const m of j.matchAll(/"photo":"([a-z0-9]+)"/g)) used.add(m[1]);
    const keys = await idb("kv", "readonly", s => new Promise(r => { const q = s.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); }));
    const old = keys.filter(k => String(k).startsWith("img:") && !used.has(String(k).slice(4)));
    if (old.length) await idb("kv", "readwrite", s => { for (const k of old) s.delete(k); });
    for (const k of [...IMG.keys()]) if (!used.has(k)) { const im = IMG.get(k); im.bmp.close && im.bmp.close(); URL.revokeObjectURL(im.url); IMG.delete(k); }
  } catch (e) {}
}
$("mvl").onclick = () => { if (cur > 0) { const a = P.slides; [a[cur - 1], a[cur]] = [a[cur], a[cur - 1]]; cur--; ui(); snap(); save(); } };
$("mvr").onclick = () => { const a = P.slides; if (cur < a.length - 1) { [a[cur + 1], a[cur]] = [a[cur], a[cur + 1]]; cur++; ui(); snap(); save(); } };
$("newpost").onclick = () => {
  if (P.slides.length && !confirm("Start a new post? This clears the slides here (save a project file first if you need them).")) return;
  P = newProject(); cur = 0; hist = []; hi = -1; $("pname").value = ""; $("caption").value = ""; $("ok").checked = false;
  ui(); snap(); save(); tidyImages();
};

function dropzone(el, fn) {
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("on"); });
  el.addEventListener("dragleave", () => el.classList.remove("on"));
  el.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); el.classList.remove("on"); fn(e.dataTransfer.files); });
}
// A file dropped anywhere else on the page goes to the right place instead of replacing the page.
addEventListener("dragover", e => e.preventDefault());
addEventListener("drop", e => {
  e.preventDefault(); const files = [...e.dataTransfer.files]; if (!files.length) return;
  if (files.some(f => /\.(otf|ttf|woff2?|zip)$/i.test(f.name))) takeFonts(files);
  else if (files.some(f => /\.gcpost$/i.test(f.name))) openProject(files.find(f => /\.gcpost$/i.test(f.name)));
  else addPhotos(files);
});

// ---------- fonts ----------
async function fontsUI() {
  const st = fontStatus(), n = $("fontstate");
  if (st.ready) { n.className = "note ok"; n.textContent = `Good Cup fonts ready: Good Sans${st.io ? " and Iowan" : ""}.`; $("fontload").hidden = true; $("s1").classList.add("done"); }
  else { n.className = "note warn"; n.textContent = st.gs ? `Good Sans is only partly loaded (${st.gs} of 16 files). Choose all 16.` : "The Good Cup fonts are not in this browser yet."; $("fontload").hidden = false; $("s1").classList.remove("done"); }
  if (!st.io && st.ready) n.textContent += " Iowan only comes with Mac and iPhone, so use Good Sans on this device.";
  for (const b of [$("t_io"), $("i_font").querySelector('[data-v="io"]')]) { b.disabled = !st.io; b.title = st.io ? b.title : "Iowan only comes with Mac and iPhone"; }
  draw(); gate();
}
async function takeFonts(files) {
  let r;
  try { r = await addFontFiles(files); }
  catch (e) {
    const zipped = [...files].some(f => /\.zip$/i.test(f.name));
    return status(zipped && typeof DecompressionStream === "undefined" ? "This browser cannot open zip files. Unzip the font folder and choose the 16 .otf files inside it." : "That looks like a folder. Open the folder and choose the 16 font files inside it.", "bad", "fontnote");
  }
  await fontsUI();
  if (!r.added) status("No Good Cup font files in that. Choose the 16 files named GoodSans-....otf.", "bad", "fontnote");
  else if (r.skipped.length) status(`Loaded ${r.added} fonts. These could not be read: ${r.skipped.join(", ")}`, "warn", "fontnote");
  else status(`Loaded ${r.added} fonts.`, "ok", "fontnote");
}
$("fontfiles").onchange = e => { takeFonts(e.target.files); e.target.value = ""; };
dropzone($("fontdrop"), takeFonts);

// ---------- drawing ----------
function fitCanvas() {
  const F = FMT[fmt], wrap = cv.parentElement, availW = wrap.clientWidth - 24;
  const top = cv.getBoundingClientRect().top + window.scrollY;
  const availH = window.innerWidth > 900 ? window.innerHeight - 190 : window.innerHeight * 0.7;
  cv.style.width = Math.max(200, Math.min(availW, availH * F.w / F.h)) + "px";
  void top;
}
function draw() { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawNow); }
function drawNow() {
  const F = FMT[fmt];
  if (cv.height !== F.h) { cv.height = F.h; fitCanvas(); }
  const sl = S();
  if (!sl) { ctx.fillStyle = "#EDE9E4"; ctx.fillRect(0, 0, F.w, F.h); ctx.fillStyle = "#5f5852"; ctx.font = "500 40px DM Sans, system-ui"; ctx.textAlign = "center"; ctx.fillText("Add photos in step 2", F.w / 2, F.h / 2); ctx.textAlign = "left"; return; }
  const img = IMG.get(sl.photo);
  const box = drawSlide(ctx, sl, fmt, { photo: img && img.bmp, mark });
  if (!exporting) {
    ctx.save(); ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.75)";
    if (box.w > 0) ctx.strokeRect(box.x - 12, box.y - 8, box.w + 24, box.h + 16);
    if (drag && drag.kind === "text" && Math.abs(sl.pos[fmt].x - 540) < 0.5) { ctx.strokeStyle = "rgba(255,80,80,.9)"; ctx.beginPath(); ctx.moveTo(540, 0); ctx.lineTo(540, F.h); ctx.stroke(); }
    ctx.restore();
  }
  const p = sl.pos[fmt], off = Math.round(p.x - 540), miss = missingFonts(sl);
  $("vstat").textContent = `${FMT[fmt].name} ${F.w}x${F.h} | ${off === 0 ? "words centred" : "words off centre"} | ${miss.length ? "missing font: " + miss[0] : "fonts ok"}`;
  $("vstat").style.color = miss.length ? "var(--bad)" : "";
}
const WNAME = Object.fromEntries(GS_WEIGHTS.map(([w, n]) => [w, n]));
function missingFonts(sl) { return facesNeeded(sl).filter(x => !hasFont(x.f, x.w, x.it)).map(x => `${x.f === "io" ? "Iowan" : "Good Sans"} ${WNAME[x.w] || x.w}${x.it ? " Italic" : ""}`); }

// ---------- pointer: drag the words or the photo ----------
function toCanvas(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * FMT[fmt].w / r.width, y: (e.clientY - r.top) * FMT[fmt].h / r.height }; }
cv.addEventListener("pointerdown", e => {
  const sl = S(); if (!sl) return;
  const q = toCanvas(e), L = layoutText(ctx, sl, fmt).box, pad = 24;
  const onText = L.w > 0 && q.x > L.x - pad && q.x < L.x + L.w + pad && q.y > L.y - pad && q.y < L.y + L.h + pad;
  cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
  const c = sl.crop[fmt];
  drag = onText ? { kind: "text", q, x: sl.pos[fmt].x, y: sl.pos[fmt].y } : { kind: "photo", q, ox: c.ox, oy: c.oy };
  draw();
});
cv.addEventListener("pointermove", e => {
  if (!drag) return; const sl = S(), q = toCanvas(e), dx = q.x - drag.q.x, dy = q.y - drag.q.y;
  if (drag.kind === "text") { const snapPx = 10 * FMT[fmt].w / cv.getBoundingClientRect().width; let x = Math.round(drag.x + dx); if (Math.abs(x - 540) < snapPx) x = 540; sl.pos[fmt].x = x; sl.pos[fmt].y = Math.round(drag.y + dy); }
  else { const img = IMG.get(sl.photo); if (!img) return; const c = sl.crop[fmt]; c.ox = drag.ox + dx; c.oy = drag.oy + dy; const r = photoRect(img.bmp, fmt, c); c.ox = Math.round(r.ox); c.oy = Math.round(r.oy); }
  draw();
});
const endDrag = () => { if (drag) { drag = null; cv.style.cursor = "grab"; draw(); commit(); } };
cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
document.addEventListener("keydown", e => {
  const t = e.target, typing = t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); (e.shiftKey ? $("redo") : $("undo")).click(); return; }
  if (typing || !S()) return;
  const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!m) return;
  e.preventDefault(); const n = e.shiftKey ? 10 : 1, p = S().pos[fmt]; p.x += m[0] * n; p.y += m[1] * n; draw(); commit();
});

// ---------- words box ----------
const rich = $("rich");
document.execCommand && document.execCommand("styleWithCSS", false, false);
function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
// Rebuild the words box HTML from parsed runs, so only safe tags are kept.
function cleanHTML(html) {
  return parseRich(html).map(l => l.map(r => {
    let s = esc(r.t);
    if (r.color) s = `<span style="color:${r.color}">${s}</span>`;
    if (r.f) s = `<span class="f-${r.f}">${s}</span>`;
    if (r.i) s = `<i>${s}</i>`; if (r.b) s = `<b>${s}</b>`;
    return s;
  }).join("")).join("<br>");
}
rich.addEventListener("input", () => { if (!S()) return; S().html = cleanHTML(rich.innerHTML); draw(); commit(); });
rich.addEventListener("paste", e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
const cmd = (c, v) => { rich.focus(); document.execCommand(c, false, v); rich.dispatchEvent(new Event("input")); };
$("t_b").onclick = () => cmd("bold"); $("t_i").onclick = () => cmd("italic");
$("t_gs").onclick = () => cmd("fontName", "GC Good Sans"); $("t_io").onclick = () => cmd("fontName", "GC Iowan");
$("t_clear").onclick = () => cmd("removeFormat");
for (const b of ["t_b", "t_i", "t_gs", "t_io", "t_clear"]) $(b).addEventListener("mousedown", e => e.preventDefault()); // keep the selection

// ---------- slide controls ----------
function change(fn) { const sl = S(); if (!sl) return; fn(sl); draw(); commit(); }
function seg(id, cb) { $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (b) cb(b.dataset.v); }); }
function setSeg(id, v) { $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === String(v)))); }
function pair(name, get, set) {
  const r = $("r_" + name), n = $("n_" + name);
  const apply = v => { if (n.value === "" || isNaN(v)) return; change(sl => set(sl, v)); };
  r.addEventListener("input", () => { n.value = r.value; apply(+r.value); });
  n.addEventListener("input", () => { if (n.value === "") return; r.value = n.value; apply(+n.value); });
}
pair("size", sl => sl.style.size, (sl, v) => sl.style.size = Math.max(8, v));
pair("lh", sl => sl.style.lh, (sl, v) => sl.style.lh = Math.max(0.5, v));
pair("ls", sl => sl.style.ls, (sl, v) => sl.style.ls = v);
pair("shade", sl => sl.shade, (sl, v) => sl.shade = Math.max(0, Math.min(0.95, v)));
pair("zoom", sl => sl.crop[fmt].zoom, (sl, v) => { const c = sl.crop[fmt]; c.zoom = Math.max(1, Math.min(3, v)); const img = IMG.get(sl.photo); if (img) { const r = photoRect(img.bmp, fmt, c); c.ox = Math.round(r.ox); c.oy = Math.round(r.oy); } });
seg("i_font", v => change(sl => { sl.style.font = v; if (v === "io") { sl.style.weight = sl.style.weight >= 600 ? 700 : 400; sl.style.bw = 700; } panel(); }));
seg("i_it", v => change(sl => sl.style.italic = v === "1"));
seg("i_align", v => change(sl => sl.style.align = v));
$("i_weight").onchange = e => change(sl => sl.style.weight = +e.target.value);
$("i_bw").onchange = e => change(sl => sl.style.bw = +e.target.value);
$("i_mark").onchange = e => change(sl => sl.mark = e.target.checked);
$("centre").onclick = () => change(sl => sl.pos[fmt].x = 540);
$("copyall").onclick = () => { const s0 = S(); if (!s0) return; for (const sl of P.slides) if (sl !== s0) { sl.style = { ...s0.style }; sl.pos = JSON.parse(JSON.stringify(s0.pos)); sl.shade = s0.shade; sl.mark = s0.mark; } status("Every slide now has this slide's font, size, colour and position.", "ok"); draw(); commit(); };
$("tostory").onclick = () => { for (const sl of P.slides) { sl.pos.s = { x: sl.pos.c.x, y: sl.pos.c.y + STORY_SHIFT }; sl.crop.s.zoom = sl.crop.c.zoom; } setFmt("s"); status("Story slides now follow the carousel layout. Check each one, a taller frame shows more photo.", "ok"); commit(); };
function swatches(el, onPick, title) {
  el.innerHTML = COLORS.map(([c, n]) => `<button class="sw" data-c="${c}" title="${title} ${n}" aria-label="${title} ${n}" style="background:${c}"></button>`).join("") +
    `<input type="color" title="${title} other colour" aria-label="${title} other colour" style="width:36px;height:32px;border:0;background:none;padding:0">`;
  el.addEventListener("mousedown", e => { if (e.target.closest(".sw")) e.preventDefault(); });
  el.addEventListener("click", e => { const b = e.target.closest(".sw"); if (b) onPick(b.dataset.c); });
  el.querySelector("input").addEventListener("change", e => onPick(e.target.value));
}
swatches($("colors"), c => change(sl => { sl.style.color = c; panel(); }), "All words:");
swatches($("selcolors"), c => cmd("foreColor", c), "Selected words:");

function weights(font) { return font === "io" ? IO_WEIGHTS : GS_WEIGHTS; }
function panel() {
  const sl = S(); $("slidectl").hidden = !sl;
  rich.contentEditable = sl ? "true" : "false"; rich.classList.toggle("off", !sl);
  if (!sl) { rich.innerHTML = ""; return; }
  if (document.activeElement !== rich) rich.innerHTML = cleanHTML(sl.html); // never raw: an opened project file could carry markup
  const st = sl.style;
  setSeg("i_font", st.font); setSeg("i_it", st.italic ? "1" : "0"); setSeg("i_align", st.align);
  $("i_weight").innerHTML = weights(st.font).map(([w, n]) => `<option value="${w}"${w == st.weight ? " selected" : ""}>${n}</option>`).join("");
  $("i_bw").innerHTML = weights(st.font).map(([w, n]) => `<option value="${w}"${w == st.bw ? " selected" : ""}>${n}</option>`).join("");
  for (const [k, v] of [["size", st.size], ["lh", st.lh], ["ls", st.ls], ["shade", sl.shade], ["zoom", sl.crop[fmt].zoom]]) { $("r_" + k).value = v; $("n_" + k).value = v; }
  $("i_mark").checked = sl.mark !== false;
  document.querySelectorAll("#colors .sw").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c.toLowerCase() === st.color.toLowerCase())));
}
function strip() {
  $("strip").innerHTML = P.slides.map((sl, i) => { const im = IMG.get(sl.photo); return `<button data-i="${i}" aria-pressed="${i === cur}" aria-label="Slide ${i + 1}">${im ? `<img src="${im.url}" alt="">` : ""}<span>${i + 1}</span></button>`; }).join("");
  $("slno").textContent = P.slides.length ? `${cur + 1} of ${P.slides.length}` : "-";
  $("prev").disabled = cur <= 0; $("next").disabled = cur >= P.slides.length - 1;
}
$("strip").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { cur = +b.dataset.i; ui(); } });
$("prev").onclick = () => { if (cur > 0) { cur--; ui(); } }; $("next").onclick = () => { if (cur < P.slides.length - 1) { cur++; ui(); } };
function setFmt(f) { fmt = f; setSeg("fmt", f); fitCanvas(); ui(); }
seg("fmt", setFmt);
function ui() { strip(); panel(); draw(); gate(); msg(); $("s2").classList.toggle("done", P.slides.length > 0); $("s3").classList.toggle("done", P.slides.some(s => s.html)); }
window.addEventListener("resize", () => { fitCanvas(); draw(); });

// ---------- download ----------
const safe = s => (s || "").replace(/[\u0000-\u001f\\/:*?"<>|#%]/g, "").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
function title(sl) { const l = parseRich(sl.html).map(l => l.map(r => r.t).join("")).join(" "); const t = safe(l).slice(0, 48).trim().replace(/[.\s]+$/, ""); return t || "Slide"; }
function postName() { return safe(P.name) || "Good Cup Post"; }
function problems() {
  const out = [];
  if (!P.slides.length) out.push("add at least one photo");
  if (!safe(P.name)) out.push("give the post a name");
  if (P.slides.some(s => !IMG.get(s.photo))) out.push("every slide needs a photo");
  const miss = new Set(); for (const s of P.slides) for (const m of missingFonts(s)) miss.add(m);
  if (miss.size) out.push("load the fonts in step 1 (" + [...miss].slice(0, 3).join(", ") + ")");
  if (P.slides.length && !P.slides.some(s => parseRich(s.html).some(l => l.some(r => r.t.trim())))) out.push("write the words in step 3");
  if (!$("ok").checked) out.push("tick the box after reading every word");
  return out;
}
function gate() { const p = problems(); $("dl").disabled = p.length > 0; $("dlstate").textContent = p.length ? "Before you can download: " + p.join("; ") + "." : "Ready."; }
$("ok").onchange = gate;
$("pname").oninput = e => { P.name = e.target.value; msg(); gate(); save(); };
$("caption").oninput = e => { P.caption = e.target.value; msg(); save(); };

async function renderPNG(sl, f) {
  const F = FMT[f], c = document.createElement("canvas"); c.width = F.w; c.height = F.h;
  const x = c.getContext("2d"); const im = IMG.get(sl.photo);
  drawSlide(x, sl, f, { photo: im && im.bmp, mark });
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  c.width = c.height = 0; // phones keep only a few big canvases alive
  if (!blob) throw new Error("the browser ran out of memory; close other tabs and try again");
  return new Uint8Array(await blob.arrayBuffer());
}
async function projectFiles(snap = P) {
  const files = [], meta = JSON.parse(JSON.stringify(snap)), done = new Set();
  for (const sl of snap.slides) { const im = IMG.get(sl.photo); if (!im || done.has(sl.photo)) continue; done.add(sl.photo);
    files.push({ name: `photos/${sl.photo}.jpg`, data: await jpegOf(im.bmp) }); }
  files.unshift({ name: "project.json", data: new TextEncoder().encode(JSON.stringify(meta, null, 1)) });
  return files;
}
async function jpegOf(bmp) {
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d").drawImage(bmp, 0, 0);
  const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92)); c.width = c.height = 0;
  if (!b) throw new Error("the browser ran out of memory; close other tabs and try again");
  return new Uint8Array(await b.arrayBuffer());
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
$("dl").onclick = async () => {
  flush(); if (problems().length) return gate();
  const b = $("dl"); b.disabled = true; $("dlstate").textContent = "Making the slides...";
  const Q = JSON.parse(JSON.stringify(P)); let said = ""; // edits made while it works do not mix into this download
  try {
    await document.fonts.ready; exporting = true;
    const root = safe(Q.name) || "Good Cup Post", files = [], n = Q.slides.length;
    for (const f of ["c", "s"]) for (let i = 0; i < n; i++) {
      $("dlstate").textContent = `Making ${FMT[f].name} slide ${i + 1} of ${n}...`;
      files.push({ name: `${root}/${FMT[f].folder}/${String(i + 1).padStart(2, "0")} ${title(Q.slides[i])}.png`, data: await renderPNG(Q.slides[i], f) });
    }
    const cap = (Q.caption || "").trim();
    if (cap) files.push({ name: `${root}/00 Caption.txt`, data: new TextEncoder().encode(cap + "\n") });
    const proj = zip(await projectFiles(Q));
    files.push({ name: `${root}/90 Project file (open in Post Maker).gcpost`, data: new Uint8Array(await proj.arrayBuffer()) });
    download(zip(files), root + ".zip");
    said = `Downloaded ${root}.zip: ${n * 2} slides (carousel and Story)${cap ? ", the caption" : ""} and the project file. Now step 5.`;
    $("s4").classList.add("done");
  } catch (e) { said = "The slides could not be made: " + e.message + "."; }
  finally { exporting = false; draw(); gate(); if (said) $("dlstate").textContent = said; }
};
$("saveproj").onclick = async () => { flush(); if (!P.slides.length) return status("Add a photo first: there is nothing to save yet.", "warn"); download(zip(await projectFiles()), postName() + ".gcpost"); };
// Opens a .gcpost, the downloaded post zip (it holds a .gcpost inside), or a project.json.
async function openProject(f) {
  if (!f) return;
  if (P.slides.length && !confirm("Open this project? It replaces the post you have here now.")) return;
  try {
    let u8 = new Uint8Array(await f.arrayBuffer()), items = null, pj = null;
    if (/\.json$/i.test(f.name)) pj = { data: u8 };
    else {
      if (typeof DecompressionStream === "undefined" && /\.zip$/i.test(f.name)) throw new Error("this browser cannot open zip files; open the .gcpost file inside the post folder instead");
      items = await unzip(u8); pj = items.find(x => x.name === "project.json");
      if (!pj) { const inner = items.find(x => /\.gcpost$/i.test(x.name)); if (inner) { items = await unzip(inner.data); pj = items.find(x => x.name === "project.json"); } }
    }
    if (!pj) throw new Error("this is not a Post Maker file. Choose the .gcpost file in the post folder");
    const q = JSON.parse(new TextDecoder().decode(pj.data));
    if (!q || !Array.isArray(q.slides)) throw new Error("the project file is damaged");
    const d = newProject();
    for (const sl of q.slides) {
      if (typeof sl.html !== "string" || !sl.pos || !sl.crop || !sl.style) throw new Error("the project file is damaged");
      sl.photo = String(sl.photo || "").replace(/[^a-z0-9]/gi, ""); sl.html = cleanHTML(sl.html);
    }
    if (items) for (const it of items) { const m = it.name.match(/^photos\/([a-z0-9]+)\.jpg$/i); if (m) await putImage(m[1], new Blob([it.data], { type: "image/jpeg" })); }
    P = { ...d, ...q, name: String(q.name || ""), caption: String(q.caption || "") };
    cur = 0; hist = []; hi = -1; $("pname").value = P.name; $("caption").value = P.caption; $("ok").checked = false;
    ui(); snap(); save(); tidyImages(); status(`Opened ${P.slides.length} slide${P.slides.length === 1 ? "" : "s"}.`, "ok");
  } catch (er) { status("Could not open that file: " + er.message + ".", "bad"); }
}
$("openproj").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; openProject(f); };

// ---------- team message ----------
function msg() {
  const n = postName(), k = P.slides.length, cap = (P.caption || "").trim();
  $("msg").value = `📣 ${n} is ready\nhttps://goodcup.aar6.ug.link\n${k} slide${k === 1 ? "" : "s"}, carousel and Story${cap ? ", caption inside" : ""}.\n\n01_Final_Outputs / Photos / 00 Post Maker - Inbox / ${n}`;
}
$("copymsg").onclick = async () => { try { await navigator.clipboard.writeText($("msg").value); $("copymsg").textContent = "Copied"; setTimeout(() => $("copymsg").textContent = "Copy message", 1500); } catch (e) { $("msg").select(); } };

// Notices stay on screen long enough to read; a note next to the step that caused it when one is given.
let noticeT;
function status(t, kind, where) {
  if (!t) return;
  const n = $(where || "notice"); n.textContent = t; n.hidden = false;
  if (n.classList.contains("note")) n.className = "note " + (kind || "");
  else n.style.color = kind === "bad" ? "var(--bad)" : kind === "warn" ? "var(--warn)" : "var(--ok)";
  if (!where) { clearTimeout(noticeT); noticeT = setTimeout(() => { n.hidden = true; }, kind === "bad" ? 12000 : 6000); }
}

// ---------- start ----------
(async () => {
  try { const im = new Image(); im.src = "assets/mark-52.png"; await im.decode(); mark = im; } catch (e) {}
  await restoreFonts(); await fontsUI();
  try {
    const j = await idb("kv", "readonly", s => new Promise(r => { const q = s.get("project"); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }));
    if (j) { P = JSON.parse(j); $("vstat").textContent = "Opening your last post...";
      await Promise.all(P.slides.filter(sl => sl.photo && !IMG.has(sl.photo)).map(async sl => {
        const b = await idb("kv", "readonly", s => new Promise(r => { const q = s.get("img:" + sl.photo); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }));
        if (b) try { await putImage(sl.photo, b, true); } catch (e) {} })); }
  } catch (e) {}
  $("pname").value = P.name || ""; $("caption").value = P.caption || "";
  opened = true; fitCanvas(); ui(); snap();
  if (!P.slides.length) $("vstat").textContent = "Add photos in step 2 to start.";
  window.GCPM_READY = performance.now();
})();

// For the test page and for checks from the console.
window.GCPM = { get P() { return P; }, IMG, FMT, renderPNG, setProject(p) { P = p; cur = 0; ui(); }, addPhotos, takeFonts, problems, setFmt, get fmt() { return fmt; } };
