// Good Cup fonts. The font files are licensed, so they are never on this website: each person loads them
// once from the NAS (or uses the copy installed on their computer). They are kept in this browser only.
import { unzip } from "./zip.js";
const GS = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, bold: 700, heavy: 800, black: 900 };
// Values follow the file names (Heavy 800, Black 900, as in the Slow Bar editor). Listed thinnest to thickest:
// the Heavy file is actually drawn thicker than Black (its own weight class is 900, Black's 800).
export const GS_WEIGHTS = [[100, "Thin"], [200, "Extra Light"], [300, "Light"], [400, "Regular"], [500, "Medium"], [700, "Bold"], [900, "Black"], [800, "Heavy"]];
export const IO_WEIGHTS = [[400, "Regular"], [700, "Bold"]];
const loaded = new Map(); // "gs|700|normal" -> true

// "GoodSans-BoldItalic.otf" -> {fam:"gs", weight:700, style:"italic"}; Iowan Old Style -> {fam:"io", ...}
export function faceOf(fileName) {
  const base = fileName.split("/").pop().replace(/\.(otf|ttf|woff2?)$/i, "");
  if (/^\._/.test(base)) return null;
  let m = base.match(/^Good ?Sans[-_ ]?(Thin|ExtraLight|Light|Regular|Medium|Bold|Heavy|Black)?(Italic)?$/i);
  if (m) return { fam: "gs", weight: GS[(m[1] || "regular").toLowerCase()], style: m[2] ? "italic" : "normal" };
  m = base.match(/^Iowan ?Old ?Style[-_ ]?(Roman|Bold|Italic|BoldItalic|Bold ?Italic)?$/i);
  if (m) { const k = (m[1] || "roman").toLowerCase().replace(/\s/g, ""); return { fam: "io", weight: /bold/.test(k) ? 700 : 400, style: /italic/.test(k) ? "italic" : "normal" }; }
  return null;
}
const FAMILY = { gs: "GC Good Sans", io: "GC Iowan" };

async function register(face, buf) {
  const ff = new FontFace(FAMILY[face.fam], buf, { weight: String(face.weight), style: face.style });
  await ff.load(); document.fonts.add(ff); loaded.set(`${face.fam}|${face.weight}|${face.style}`, true);
}

// ---- IndexedDB: the font files stay in this browser so the next visit needs no upload ----
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open("gc-post-maker", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("fonts"); r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function idb(store, mode, fn) {
  const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), s = tx.objectStore(store);
    let out; Promise.resolve(fn(s)).then(v => { out = v; }); tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("storage full")); });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Files from a file picker or a drop: font files and/or a zip of the NAS font folder.
export async function addFontFiles(fileList) {
  const items = [];
  for (const f of fileList) {
    const u8 = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) { for (const z of await unzip(u8)) items.push({ name: z.name, data: z.data }); }
    else items.push({ name: f.name, data: u8 });
  }
  let n = 0, bad = [];
  for (const it of items) {
    if (/(^|\/)(__MACOSX|\._)/.test(it.name)) continue; // Mac zip leftovers, not fonts
    const face = faceOf(it.name); if (!face) { if (/\.(otf|ttf|woff2?)$/i.test(it.name)) bad.push(it.name); continue; }
    try { await register(face, it.data.buffer.slice(it.data.byteOffset, it.data.byteOffset + it.data.byteLength)); n++;
      try { await idb("fonts", "readwrite", s => s.put(it.data, `${face.fam}|${face.weight}|${face.style}`)); } catch (e) { /* private window: works for this visit only */ }
    } catch (e) { bad.push(it.name); }
  }
  return { added: n, skipped: bad };
}

// On page open: fonts saved in this browser, then fonts installed on this computer.
export async function restoreFonts() {
  try {
    const keys = await idb("fonts", "readonly", s => req(s.getAllKeys()));
    for (const k of keys || []) { const data = await idb("fonts", "readonly", s => req(s.get(k)));
      const [fam, w, style] = k.split("|"); try { await register({ fam, weight: +w, style }, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); } catch (e) {} }
  } catch (e) {}
  const local = [];
  for (const [w, n] of GS_WEIGHTS) for (const it of [false, true]) {
    const key = `gs|${w}|${it ? "italic" : "normal"}`; if (loaded.has(key)) continue;
    const ps = "GoodSans-" + n.replace(" ", "") + (it ? "Italic" : ""), full = "Good Sans " + n + (it ? " Italic" : "");
    local.push(tryLocal({ fam: "gs", weight: w, style: it ? "italic" : "normal" }, [ps, full]));
  }
  for (const [w, it, names] of [[400, false, ["IowanOldStyle-Roman", "Iowan Old Style Roman"]], [700, false, ["IowanOldStyle-Bold", "Iowan Old Style Bold"]], [400, true, ["IowanOldStyle-Italic", "Iowan Old Style Italic"]], [700, true, ["IowanOldStyle-BoldItalic", "Iowan Old Style Bold Italic"]]]) {
    if (!loaded.has(`io|${w}|${it ? "italic" : "normal"}`)) local.push(tryLocal({ fam: "io", weight: w, style: it ? "italic" : "normal" }, names));
  }
  await Promise.all(local);
  return status();
}
async function tryLocal(face, names) {
  try { const ff = new FontFace(FAMILY[face.fam], names.map(n => `local("${n}")`).join(","), { weight: String(face.weight), style: face.style });
    await ff.load(); document.fonts.add(ff); loaded.set(`${face.fam}|${face.weight}|${face.style}`, true); } catch (e) {}
}
export function has(fam, weight, italic) { return loaded.has(`${fam}|${weight}|${italic ? "italic" : "normal"}`); }
export function status() {
  let gs = 0, io = 0; for (const k of loaded.keys()) { if (k.startsWith("gs|")) gs++; else io++; }
  return { gs, gsAll: 16, io, ready: gs >= 16 };
}
export async function forgetFonts() { try { await idb("fonts", "readwrite", s => s.clear()); } catch (e) {} }
