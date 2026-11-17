// AIRCHECK'S EMAIL LAYOUT. Every email the hosted account sends renders here: the grid (hairline
// rails, crosshair marks, ruled rows), the mark and name in the header, a thin banner cut from the
// landing art, the pill button in the accent colour with the inline arrow, and a footer with the
// product block on the left and a quiet "Built by Compound Labs" credit on the right (hidden on a
// phone, where it would stack under the product block).
//
// Pure TypeScript with no runtime APIs. Images load from the site that sends the mail (public/mail),
// so a self-hosted copy points them at its own host with AIRCHECK_SITE_URL.

export type ProductSlug = "aircheck";

export type Block =
  | { p: string }
  | { h2: string }
  | { button: { label: string; url: string } }
  | { details: [string, string][] }
  | { table: { head: string[]; rows: string[][] } }
  | { list: string[] }
  | { steps: [string, string][] }
  | { note: string }
  | { pre: string }
  | { link: { label: string; url: string } }
  | { divider: true };

export interface Message {
  subject: string;
  preheader?: string;
  /** Short label for the header's right side and the footer's small line. */
  context: string;
  heading: string;
  blocks: Block[];
  /** Raw link under the button for auth mail. */
  pasteLink?: string;
  /** Extra plain footer lines (an unsubscribe line). Never a postal address. */
  footerLines?: string[];
}

interface Brand {
  name: string; site: string; domain: string; mark: string; accent: string;
  ground: string; rule: string; cross: string; ink: string; body: string; muted: string;
  band: string; support?: string;
}

const F = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const SITE = (typeof process !== "undefined" && process.env?.AIRCHECK_SITE_URL) || "https://aircheck.dev";
const LAB_CUBE = `${SITE}/mail/compound-labs-cube.png`;
const img = (src: string) => `<img src="${src}" width="570" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:0">`;

const BASE = { ground: "#fbfbfc", rule: "#e3e5e9", cross: "#a9adb5", ink: "#15171a", body: "#4d525b", muted: "#6b7079" };

export const BRANDS: Record<ProductSlug, Brand> = {
  aircheck: { ...BASE, name: "Aircheck", site: SITE, domain: SITE.replace(/^https?:\/\//, ""), mark: `${SITE}/aircheck-mark.png`, accent: "#e11d2a", ground: "#f6f6f8", rule: "#ececf0", ink: "#18181b", body: "#3f3f46", muted: "#71717a", band: img(`${SITE}/mail/band.jpg`) },
};

const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const hex = (h: string) => h.slice(1).match(/../g)!.map((x) => parseInt(x, 16));
const shade = (h: string, f: number) => "#" + hex(h).map((n) => Math.max(0, Math.min(255, Math.round(n * f))).toString(16).padStart(2, "0")).join("");
const rgba = (h: string, a: number) => `rgba(${hex(h).join(",")},${a})`;
// Inline markdown inside copy: `code` and **bold**. Escaped first, so nothing else passes through.
const md = (b: Brand, t: string) => esc(t)
  .replace(/`([^`]+)`/g, `<code style="font:500 0.88em/1 ${MONO};background:${rgba(b.accent, 0.07)};border:1px solid ${rgba(b.accent, 0.14)};border-radius:5px;padding:1px 5px;color:${b.ink}">$1</code>`)
  .replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:600;color:${b.ink}">$1</strong>`)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" style="color:${shade(b.accent, 0.85)};text-decoration:underline">$1</a>`);
const plain = (t: string) => t.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");

// The pill in the product's colour: light-to-base gradient, inset highlight, ring, drop, arrow.
function pill(b: Brand, label: string, url: string): string {
  const c = b.accent;
  return `<table ${T} style="border-collapse:separate"><tr><td bgcolor="${c}" align="center" style="background:${c};background-image:linear-gradient(${shade(c, 1.18)},${c});border-radius:999px;border:1px solid ${shade(c, 0.9)};box-shadow:inset 0 1px 0 rgba(255,255,255,.31),0 0 0 1px ${rgba(c, 0.9)},0 1px 2px ${rgba(c, 0.3)},0 4px 10px -2px ${rgba(c, 0.35)}"><a href="${esc(url)}" style="display:block;padding:12px 22px;font:600 15px/20px ${F};color:#ffffff;text-decoration:none">${esc(label)}&nbsp;&nbsp;<img src="${SITE}/mail/arrow-white.png" width="14" height="14" alt="" style="display:inline-block;vertical-align:-2px;border:0"></a></td></tr></table>`;
}

function block(b: Brand, x: Block): string {
  const P = `font:400 15px/24px ${F};color:${b.body}`;
  if ("p" in x) return `<p style="margin:0 0 12px;${P};overflow-wrap:anywhere">${md(b, x.p)}</p>`;
  if ("h2" in x) return `<p style="margin:18px 0 8px;font:600 15px/22px ${F};letter-spacing:-0.01em;color:${b.ink}">${md(b, x.h2)}</p>`;
  // Equal air above and below: the paragraph above ends with a 12px margin, so 12 + 12 above, 24 below.
  if ("button" in x) return `<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>${pill(b, x.button.label, x.button.url)}<div class="after-btn" style="height:24px;line-height:24px;font-size:0">&nbsp;</div>`;
  if ("details" in x) return `<table ${T} width="100%" style="margin:4px 0 16px;border-collapse:separate;border:1px solid ${b.rule};border-radius:10px;background:#ffffff">${x.details.map(([k, v], i) => `<tr><td valign="top" style="padding:10px 14px;${i ? `border-top:1px solid ${b.rule};` : ""}font:500 13px/20px ${F};color:${b.muted};white-space:nowrap;width:1%">${esc(k)}</td><td valign="top" style="padding:10px 14px;${i ? `border-top:1px solid ${b.rule};` : ""}font:500 14px/20px ${F};color:${b.ink};overflow-wrap:anywhere">${md(b, v)}</td></tr>`).join("")}</table>`;
  if ("table" in x) {
    const cell = (t: string, i: number, th: boolean) => `<td valign="top" style="padding:9px 14px;${i ? `border-left:1px solid ${b.rule};` : ""}font:${th ? 600 : 400} ${th ? 12.5 : 14}px/20px ${F};color:${th ? b.muted : b.ink};${th ? `background:${rgba(b.accent, 0.04)};` : ""}${t.length <= 14 ? "white-space:nowrap;" : "overflow-wrap:anywhere;"}">${md(b, t)}</td>`;
    return `<table ${T} width="100%" style="margin:4px 0 16px;border-collapse:separate;border:1px solid ${b.rule};border-radius:10px;background:#ffffff;overflow:hidden">${x.table.head.length ? `<tr>${x.table.head.map((h, i) => cell(h, i, true)).join("")}</tr>` : ""}${x.table.rows.map((r, ri) => `<tr>${r.map((c, i) => (x.table.head.length || ri ? cell(c, i, false).replace('style="', `style="border-top:1px solid ${b.rule};`) : cell(c, i, false))).join("")}</tr>`).join("")}</table>`;
  }
  if ("list" in x) return `<table ${T} width="100%" style="margin:0 0 12px">${x.list.map((t) => `<tr><td valign="top" width="18" style="width:18px;font:400 15px/24px ${F};color:${b.accent}">&#8226;</td><td style="padding-bottom:4px;${P}">${md(b, t)}</td></tr>`).join("")}</table>`;
  if ("steps" in x) return `<table ${T} width="100%" style="margin:4px 0 12px">${x.steps.map(([t, d], i) => `<tr><td valign="top" width="36" style="width:36px;padding-bottom:14px"><div style="width:24px;height:24px;border-radius:12px;background:${i ? "#ffffff" : b.accent};border:1px solid ${i ? b.rule : b.accent};color:${i ? b.body : "#ffffff"};font:600 12px/24px ${F};text-align:center">${i + 1}</div></td><td valign="top" style="padding-bottom:14px"><div style="font:600 14.5px/22px ${F};color:${b.ink}">${esc(t)}</div><div style="font:400 14px/21px ${F};color:${b.muted}">${esc(d)}</div></td></tr>`).join("")}</table>`;
  if ("note" in x) return `<div style="margin:4px 0 14px;padding:12px 14px;border-radius:10px;background:${rgba(b.accent, 0.06)};border:1px solid ${rgba(b.accent, 0.16)};font:400 13.5px/21px ${F};color:${b.body};white-space:pre-line">${md(b, x.note)}</div>`;
  if ("pre" in x) return `<div style="margin:4px 0 14px;padding:12px 14px;border-radius:10px;background:#ffffff;border:1px solid ${b.rule};font:400 12.5px/19px ${MONO};color:${b.ink};white-space:pre-wrap;word-break:break-word">${esc(x.pre)}</div>`;
  if ("link" in x) return `<p style="margin:0 0 12px;${P}"><a href="${esc(x.link.url)}" style="color:${shade(b.accent, 0.85)};text-decoration:underline;overflow-wrap:anywhere">${esc(x.link.label)}</a></p>`;
  return `<div style="height:1px;background:${b.rule};margin:14px 0;font-size:0;line-height:0">&nbsp;</div>`;
}

function blockText(x: Block): string {
  if ("p" in x) return plain(x.p);
  if ("h2" in x) return plain(x.h2);
  if ("button" in x) return `${x.button.label}: ${x.button.url}`;
  if ("details" in x) return x.details.map(([k, v]) => `${k}: ${v}`).join("\n");
  if ("table" in x) return [...(x.table.head.length ? [x.table.head] : []), ...x.table.rows].map((r) => r.map(plain).join(" | ")).join("\n");
  if ("list" in x) return x.list.map((t) => `- ${plain(t)}`).join("\n");
  if ("steps" in x) return x.steps.map(([t, d], i) => `${i + 1}. ${t}. ${d}`).join("\n");
  if ("note" in x) return plain(x.note);
  if ("pre" in x) return x.pre;
  if ("link" in x) return `${x.link.label}: ${x.link.url}`;
  return "---";
}

export function renderEmail(slug: ProductSlug, m: Message): { html: string; text: string; fromName: string } {
  return renderWith(BRANDS[slug], m);
}

function renderWith(b: Brand, m: Message): { html: string; text: string; fromName: string } {
  const vr = `background-image:linear-gradient(${b.rule},${b.rule});background-size:1px 100%;background-position:center top;background-repeat:no-repeat`;
  const hr = `background-image:linear-gradient(${b.rule},${b.rule});background-size:100% 1px;background-position:left center;background-repeat:no-repeat`;
  const x = `background-image:linear-gradient(${b.cross},${b.cross}),linear-gradient(${b.cross},${b.cross});background-size:1px 13px,13px 1px;background-position:center center,center center;background-repeat:no-repeat`;
  const row = (inner: string, pad: string) => `<tr><td class="hide-m" width="16" style="width:16px"></td><td class="hide-m" width="13" style="width:13px;${vr}"></td><td class="pad-m" style="padding:${pad}">${inner}</td><td class="hide-m" width="13" style="width:13px;${vr}"></td><td class="hide-m" width="16" style="width:16px"></td></tr>`;
  const sep = `<tr><td class="hide-m" height="13" style="height:13px;${hr}"></td><td class="hide-m" style="${x}"></td><td style="height:13px;font-size:0;line-height:0;${hr}">&nbsp;</td><td class="hide-m" style="${x}"></td><td class="hide-m" style="${hr}"></td></tr>`;
  const ends = `<tr><td class="hide-m" width="16" style="width:16px;height:24px"></td><td class="hide-m" width="13" style="width:13px;${vr}"></td><td width="542" style="width:542px"></td><td class="hide-m" width="13" style="width:13px;${vr}"></td><td class="hide-m" width="16" style="width:16px"></td></tr>`;
  // Inline-block chips wrap onto a second line on a narrow phone; table cells cannot.
  const wchip = (href: string, label: string, bg: string, fg: string) => `<a href="${href}" style="display:inline-block;margin:0 6px 6px 0;background:${bg};border-radius:999px;padding:2px 10px;font:600 11.5px/17px ${F};color:${fg};text-decoration:none;white-space:nowrap">${esc(label)}</a>`;
  const chip = (href: string, label: string, bg: string, fg: string) => `<td bgcolor="${bg}" style="background:${bg};border-radius:999px;padding:2px 10px"><a href="${href}" style="font:600 11.5px/17px ${F};color:${fg};text-decoration:none;white-space:nowrap">${esc(label)}</a></td>`;
  const markImg = (size: number, r: number) => b.mark ? `<td style="padding:0 ${size > 20 ? 8 : 6}px 0 0;line-height:0"><img src="${b.mark}" width="${size}" height="${size}" alt="" style="display:block;border-radius:${r}px;border:0"></td>` : "";

  const head = row(`<table ${T} width="100%"><tr><td valign="middle"><table ${T}><tr>${markImg(24, 6)}<td style="font:600 19px/24px ${F};letter-spacing:-0.02em;color:${b.ink};white-space:nowrap">${esc(b.name)}</td></tr></table></td><td align="right" valign="middle" style="font:400 12.5px/1 ${F};color:${b.muted}">${esc(m.context)}</td></tr></table>`, "22px 28px");
  // The raw link sits in its own grid row under the footer, out of the message.
  const paste = m.pasteLink ? `<p style="margin:0;font:400 12.5px/19px ${F};color:${b.muted}">Or paste this link into your browser:<br><a href="${esc(m.pasteLink)}" style="color:${shade(b.accent, 0.85)};text-decoration:underline;word-break:break-all">${esc(m.pasteLink)}</a></p>` : "";
  const content = row(`<h1 class="h1-m" style="margin:0 0 12px;font:500 28px/32px ${F};letter-spacing:-0.03em;color:${b.ink};overflow-wrap:anywhere">${esc(m.heading)}</h1>${m.blocks.map((k) => block(b, k)).join("").replace(/<div class="after-btn"[^>]*>&nbsp;<\/div>$/, "")}`, "34px 28px 30px");
  const left = `<table ${T}><tr>${markImg(14, 3)}<td style="font:600 13px/20px ${F};letter-spacing:-0.02em;color:${b.ink}">${esc(b.name)}</td></tr></table>`
    + (b.site ? `<div style="margin-top:8px;line-height:17px">${wchip(b.site, b.domain, rgba(b.accent, 0.1), shade(b.accent, 0.82))}${b.support ? wchip(b.support, "Contact support", "#f0f1f3", "#4d525b") : ""}</div>` : "")
    + `<p style="margin:${b.site ? 2 : 8}px 0 0;font:400 12px/18px ${F};color:${b.muted}">${esc(m.context)}</p>`
    + (m.footerLines ?? []).map((l) => `<p style="margin:6px 0 0;font:400 12px/18px ${F};color:${b.muted}">${esc(l)}</p>`).join("");
  const right = `<table ${T} align="right"><tr><td style="font:400 12px/20px ${F};color:${b.muted};white-space:nowrap;padding-right:5px">Built by</td><td style="line-height:0;padding-right:4px"><img src="${LAB_CUBE}" width="11" height="12" alt="" style="display:block;border:0"></td><td style="font:600 13px/20px ${F};letter-spacing:-0.02em;color:${b.ink};white-space:nowrap">Compound Labs</td></tr></table>`
    + `<table ${T} align="right" style="clear:both;margin-top:8px;border-collapse:separate"><tr>${chip("https://thecompound.tech", "thecompound.tech", "#eef3ff", "#1f55e0")}</tr></table>`;
  const foot = row(`<table ${T} width="100%"><tr><td valign="top" class="col-m">${left}</td><td valign="top" align="right" class="hide-m" style="padding-top:1px">${right}</td></tr></table>`, "22px 28px 18px");

  const rows = [ends, head, sep];
  if (b.band) rows.push(row(b.band, "0"), sep);
  rows.push(content, sep, foot);
  if (paste) rows.push(sep, row(paste, "20px 28px 18px"));
  rows.push(ends);
  const html = `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(m.subject)}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>body{margin:0;padding:0;-webkit-text-size-adjust:100%}table{border-collapse:collapse}@media (max-width:599px){.w600{width:100%!important;max-width:100%!important}.hide-m{display:none!important}.pad-m{padding-left:20px!important;padding-right:20px!important}.h1-m{font-size:26px!important;line-height:32px!important}.col-m{display:block!important;width:100%!important;text-align:left!important}.col-m table[align=right]{float:none!important;margin-top:12px!important}}</style></head>`
    + `<body style="margin:0;padding:0;background:${b.ground}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${b.ground}">${esc(m.preheader ?? m.subject)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>`
    + `<table ${T} width="100%" style="background:${b.ground}"><tr><td align="center" style="padding:24px 0"><!--[if mso]><table ${T} width="600"><tr><td><![endif]--><table ${T} class="w600" width="600" style="width:600px;max-width:600px;background:${b.ground}">${rows.join("")}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  const text = [m.heading, "", ...m.blocks.flatMap((k) => [blockText(k), ""]), ...(m.pasteLink ? [m.pasteLink, ""] : []), "--", `${b.name}${b.domain ? ` · ${b.domain}` : ""}${b.support ? ` · ${b.support}` : ""}`, ...(m.footerLines ?? []), "Built by Compound Labs · thecompound.tech"].join("\n");
  return { html, text, fromName: b.name };
}

/** A host outside the roster (localhost): the grid under that host's name, no mark or banner. */
export function renderPlainEmail(name: string, m: Message): { html: string; text: string; fromName: string } {
  return renderWith({ ...BASE, name, site: "", domain: name, mark: "", accent: "#15171a", band: "" }, m);
}

export function isProductSlug(s: string): s is ProductSlug {
  return Object.prototype.hasOwnProperty.call(BRANDS, s);
}

/** Resolve a product from a repo slug, host label or display name. */
export function productSlug(key: string | null | undefined): ProductSlug | null {
  const k = String(key ?? "").toLowerCase();
  if (isProductSlug(k)) return k;
  for (const [s, b] of Object.entries(BRANDS)) if (b.name.toLowerCase() === k) return s as ProductSlug;
  return null;
}
