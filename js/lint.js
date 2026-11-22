// Good Cup Post Maker: caption lint (copy voice rule 63). Finds things that went live by mistake in November:
// hashtags, "Comment X / Reply X" automation lines, "link in bio", @tags, internal ids like "No. 21", em dashes
// and smart quotes. Returns soft hits; the page shows them and the writer ticks "I checked".
export const RULES = [
  ["hashtag", /#[\p{L}\p{N}_]+/u],
  ["comment or reply line", /^\s*(comment|reply|dm)\b|\b(?:[Cc]omment|[Rr]eply|COMMENT|REPLY)\s+["'`\u2018\u201c]?[A-Z0-9]{3,}["'`\u2019\u201d]?(?![a-z])|\b(?:[Cc]omment|[Rr]eply)\b[^.\n]{0,40}\b(?:below|to get|and we|and I)\b/],
  ["link in bio", /link\s+in\s+(my\s+|our\s+|the\s+)?(bio|profile)|\bbio\s+link\b/i],
  ["@tag", /(^|[^\w.@])@[A-Za-z0-9_.]{2,}/],
  ["internal id", /\bNo\.\s?\d+|\bNo\s\d+\b/],
  ["em dash", /\u2014/],
  ["smart quote or non-breaking space", /[\u2018\u2019\u201c\u201d\u00a0]/],
];
export function lintCaption(text) {
  const hits = [];
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    for (const [label, re] of RULES) {
      const m = line.match(re); if (!m) continue;
      const w = (m[0] || "").trim().replace(/\u00a0/g, "[nbsp]");
      hits.push({ line: i + 1, label, text: `"${(label.startsWith("comment") ? line.trim() : w).slice(0, 60)}"` });
    }
  });
  return hits;
}
