// Good Cup Post Maker: where may words sit on this photo? A port of placement_check.py (gc-post-editor).
// score = tone spread (sd) + 3 x edge density over a 140 px band, x 200-880. A band PASSES when it is in the
// quietest 35% of the photo's own bands AND its score is at most half the photo's median (rule 66).
// Pure functions: no page state, so the test page can run them on the fixture plates.
export const BAND = 70, X0 = 200, X1 = 880, MARGIN = 110, STEP = 5;
export const MAX_RANK = 0.35, MAX_OF_MEDIAN = 0.5;

// RGBA pixels -> prefix sums per row of tone, tone squared and edge strength (PIL "L" tone, FIND_EDGES kernel).
export function rowsOf(data, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < g.length; p++, i += 4) g[p] = (data[i] * 19595 + data[i + 1] * 38470 + data[i + 2] * 7471 + 0x8000) >> 16;
  const S = new Float64Array(h + 1), Q = new Float64Array(h + 1), E = new Float64Array(h + 1);
  for (let y = 0; y < h; y++) {
    let s = 0, q = 0, e = 0;
    for (let x = X0; x < Math.min(X1, w); x++) {
      const p = y * w + x, v = g[p];
      s += v; q += v * v;
      if (y > 0 && y < h - 1 && x > 0 && x < w - 1) {
        let k = 8 * v - g[p - 1] - g[p + 1] - g[p - w - 1] - g[p - w] - g[p - w + 1] - g[p + w - 1] - g[p + w] - g[p + w + 1];
        e += k < 0 ? 0 : k > 255 ? 255 : k;
      } else e += v;
    }
    S[y + 1] = S[y] + s; Q[y + 1] = Q[y] + q; E[y + 1] = E[y] + e;
  }
  return { w, h, S, Q, E };
}

export function score(r, y) {
  y = Math.round(y); // the words box centre is rarely a whole pixel
  const y0 = Math.max(0, y - BAND), y1 = Math.min(r.h, y + BAND), n = (y1 - y0) * (Math.min(X1, r.w) - X0);
  if (n <= 0) return 0;
  const m = (r.S[y1] - r.S[y0]) / n, v = (r.Q[y1] - r.Q[y0]) / n - m * m;
  return Math.sqrt(Math.max(0, v)) + 3 * (r.E[y1] - r.E[y0]) / n;
}

export function bands(r) {
  const ys = [], sc = [];
  for (let y = MARGIN; y < r.h - MARGIN; y += STEP) { ys.push(y); sc.push(score(r, y)); }
  return { ys, sc };
}
const median = a => { const b = [...a].sort((p, q) => p - q), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const rank = (sc, s) => sc.filter(v => v < s).length / sc.length;

// Check one spot (y is the centre of the words block). ok, score, quiet-rank, median.
export function check(r, y, cache) {
  const b = cache || bands(r), s = score(r, y), pct = rank(b.sc, s), med = median(b.sc);
  return { ok: pct <= MAX_RANK && s <= MAX_OF_MEDIAN * med, s, pct, med };
}

// Quiet bands nearest the subject (the busiest row band), at least 120 px apart. fits(y) can rule spots out
// (outside the safe frame, over the Story link sticker).
export function suggest(r, n = 6, fits = () => true) {
  const b = bands(r), med = median(b.sc);
  let subj = b.ys[0], best = -1;
  b.ys.forEach(y => { const y0 = Math.max(0, y - BAND), y1 = Math.min(r.h, y + BAND), k = (r.E[y1] - r.E[y0]) / ((y1 - y0) * (Math.min(X1, r.w) - X0)); if (k > best) { best = k; subj = y; } });
  const good = [];
  b.ys.forEach((y, i) => { const s = b.sc[i]; if (s <= MAX_OF_MEDIAN * med && rank(b.sc, s) <= MAX_RANK && fits(y)) good.push([Math.abs(y - subj), y, s]); });
  good.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out = [];
  for (const [, y, s] of good) { if (out.every(o => Math.abs(y - o.y) >= 120)) out.push({ y, s }); if (out.length >= n) break; }
  return { subj, out, med };
}
