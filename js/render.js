// Good Cup Post Maker: the one drawing routine. The preview on screen and the PNG you download
// both come from drawSlide(), so what you see is what you get.
export const FMT = {
  c: { w: 1080, h: 1350, name: "Carousel", folder: "01 Carousel 1080x1350" },
  s: { w: 1080, h: 1920, name: "Story", folder: "02 Story 1080x1920" },
};
export const FAM = { gs: '"GC Good Sans"', io: '"GC Iowan"' };
const FALLBACK = { gs: 'system-ui, sans-serif', io: 'Georgia, serif' };
export const INK = "#FAF8F3";
export const SHADE_RGB = "10,9,8";
export const SHADE_FEATHER = 260;   // px of soft edge above the dark band
export const SHADE_LEAD = 40;       // the band starts this far above the words
export const MARK_FROM_BOTTOM = 50; // centre of the cup mark, px from the bottom

export function defaultStyle() {
  return { font: "gs", weight: 700, italic: false, size: 44, lh: 1.32, ls: 0, align: "center", color: INK, bw: 900 };
}

// Rich text (from the words box) -> lines of runs. Allowed: <b>, <i>, <br>, font and colour spans.
export function parseRich(html) {
  const root = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html").body.firstChild;
  const lines = [[]];
  const okColor = c => /^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c);
  const walk = (n, st) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const parts = c.nodeValue.replace(/\r/g, "").split("\n");
        parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push({ t: p, ...st }); });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase(), css = c.style || {};
      if (tag === "br") { lines.push([]); continue; }
      const block = tag === "div" || tag === "p";
      if (block && lines[lines.length - 1].length) lines.push([]);
      const s2 = { ...st };
      const fw = css.fontWeight;
      if (tag === "b" || tag === "strong" || fw === "bold" || +fw >= 600) s2.b = true;
      if (fw === "normal" || (fw && +fw < 600)) s2.b = false;
      if (tag === "i" || tag === "em" || css.fontStyle === "italic") s2.i = true;
      const ff = ((tag === "font" && c.getAttribute("face")) || css.fontFamily || "") + " " + (c.className || "");
      if (/iowan|f-io|GC Iowan/i.test(ff)) s2.f = "io"; else if (/good sans|f-gs|GC Good Sans/i.test(ff)) s2.f = "gs";
      const col = (tag === "font" && c.getAttribute("color")) || css.color;
      if (col && okColor(col)) s2.color = col;
      walk(c, s2);
      if (block && lines[lines.length - 1].length) lines.push([]);
    }
  };
  walk(root, {});
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

// Which real font file a run uses. Iowan only has Regular and Bold, so other weights snap to the nearer one.
export function face(st, run) {
  const f = (run && run.f) || st.font;
  let w = run && run.b ? st.bw : st.weight;
  if (f === "io") w = w >= 600 ? 700 : 400;
  return { f, w, it: !!((run && run.i) || st.italic) };
}
export function fontString(st, run) {
  const { f, w, it } = face(st, run);
  return `${it ? "italic " : ""}${w} ${st.size}px ${FAM[f]}, ${FALLBACK[f]}`;
}

function runWidth(ctx, t, ls) {
  if (!ls) return ctx.measureText(t).width;
  let w = 0; for (const ch of t) w += ctx.measureText(ch).width + ls; return w;
}
function drawRun(ctx, t, x, y, ls) {
  if (!ls) { ctx.fillText(t, x, y); return; }
  for (const ch of t) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + ls; }
}

// Chrome snaps a DOM line's baseline down to a whole pixel; flooring here keeps the words where the
// Slow Bar editor put them (parity test: 90 Working Files/tests/parity.html).
let BASE_ROUND = Math.floor, X_ROUND = v => v;
export function _setBaseRound(fn) { BASE_ROUND = fn; } // test hooks
export function _setXRound(fn) { X_ROUND = fn; }
// Lay the words out. Returns the block box and per-line runs with x positions (output pixels).
export function layoutText(ctx, slide, fmt) {
  const st = slide.style, pos = slide.pos[fmt];
  const lines = parseRich(slide.html);
  ctx.font = fontString(st, null);
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  const lineH = st.size * st.lh;
  const laid = lines.map(runs => {
    let w = 0; const rr = runs.map(r => { ctx.font = fontString(st, r); const rw = runWidth(ctx, r.t, st.ls); const o = { ...r, dx: w, w: rw }; w += rw; return o; });
    return { runs: rr, w };
  });
  const bw = Math.max(0, ...laid.map(l => l.w));
  const left = pos.x - bw / 2;
  laid.forEach((l, i) => {
    l.x = X_ROUND(st.align === "left" ? left : st.align === "right" ? left + bw - l.w : pos.x - l.w / 2);
    l.base = BASE_ROUND(pos.y + i * lineH + (lineH - (asc + desc)) / 2 + asc);
  });
  return { lines: laid, box: { x: left, y: pos.y, w: bw, h: lines.length * lineH } };
}

export function drawText(ctx, slide, fmt) {
  const st = slide.style, L = layoutText(ctx, slide, fmt);
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  for (const l of L.lines) for (const r of l.runs) {
    ctx.font = fontString(st, r); ctx.fillStyle = r.color || st.color; drawRun(ctx, r.t, l.x + r.dx, l.base, st.ls);
  }
  return L.box;
}

// Photo cover-fit with zoom and pan (ox, oy in output pixels, clamped so the photo always fills the frame).
export function photoRect(img, fmt, crop) {
  const F = FMT[fmt], iw = img.width, ih = img.height;
  const z = Math.max(1, (crop && crop.zoom) || 1);
  const s = Math.max(F.w / iw, F.h / ih) * z, w = iw * s, h = ih * s;
  const mx = (w - F.w) / 2, my = (h - F.h) / 2;
  const ox = Math.max(-mx, Math.min(mx, (crop && crop.ox) || 0)), oy = Math.max(-my, Math.min(my, (crop && crop.oy) || 0));
  return { x: (F.w - w) / 2 + ox, y: (F.h - h) / 2 + oy, w, h, ox, oy, mx, my };
}

export function drawShade(ctx, fmt, top, a) {
  if (!(a > 0)) return;
  const F = FMT[fmt], t = Math.round(top - SHADE_LEAD);
  const g = ctx.createLinearGradient(0, t - SHADE_FEATHER, 0, t);
  g.addColorStop(0, `rgba(${SHADE_RGB},0)`); g.addColorStop(1, `rgba(${SHADE_RGB},${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, t - SHADE_FEATHER, F.w, SHADE_FEATHER);
  ctx.fillStyle = `rgba(${SHADE_RGB},${a})`; ctx.fillRect(0, t, F.w, F.h - t);
}

export function drawMark(ctx, fmt, mark) {
  if (!mark || !mark.width) return;
  const F = FMT[fmt];
  ctx.drawImage(mark, Math.floor((F.w - mark.width) / 2), F.h - MARK_FROM_BOTTOM - Math.floor(mark.height / 2));
}

// The whole slide. imgs: {photo, mark}. Draws at full output size on a 1080-wide canvas.
export function drawSlide(ctx, slide, fmt, imgs) {
  const F = FMT[fmt];
  ctx.save();
  ctx.fillStyle = "#1B1B1B"; ctx.fillRect(0, 0, F.w, F.h);
  if (imgs.photo) {
    const r = photoRect(imgs.photo, fmt, slide.crop && slide.crop[fmt]);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgs.photo, r.x, r.y, r.w, r.h);
  }
  const hasWords = parseRich(slide.html).some(l => l.some(r => r.t.trim()));
  if (hasWords) drawShade(ctx, fmt, slide.pos[fmt].y, slide.shade == null ? 0.62 : slide.shade);
  if (slide.mark !== false) drawMark(ctx, fmt, imgs.mark);
  const box = drawText(ctx, slide, fmt);
  ctx.restore();
  return box;
}

// Font files a slide needs, so the page can refuse to export with a stand-in font.
export function facesNeeded(slide) {
  const st = slide.style, out = new Map(), add = x => out.set(`${x.f}|${x.w}|${x.it}`, x);
  add(face(st, null));
  for (const l of parseRich(slide.html)) for (const r of l) if (r.t.trim()) add(face(st, r));
  return [...out.values()];
}
