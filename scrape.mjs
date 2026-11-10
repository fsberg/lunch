// Hämtar veckans lunchmenyer för några restauranger i Trollhättan och skriver menu.json.
// Körs av GitHub Actions varje vardagsmorgon (se .github/workflows/menu.yml). Kör själv med: node scrape.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; Lunchkollen/1.0; privat lunchsida)';

const DAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag'];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', Auml: 'Ä', aring: 'å', Aring: 'Å', ouml: 'ö', Ouml: 'Ö', eacute: 'é', Eacute: 'É', egrave: 'è', uuml: 'ü', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', amp_: '&' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e] ?? m;
  });
}

// html → rader med text
export function lines(html) {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|ul)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(s).split('\n').map(l => l.replace(/[\s​ ]+/g, ' ').trim()).filter(Boolean);
}

const clean = t => t.replace(/^[\s*＊•\-–]+/, '').replace(/\.{2,}\s*$/, '.').replace(/\s+/g, ' ').trim();
const dayOf = l => { const m = /^(måndag|tisdag|onsdag|torsdag|fredag)\b/i.exec(l); return m ? DAYS.indexOf(m[1].toLowerCase()) : -1; };
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
const weekIn = t => { const m = /vecka\s*(\d{1,2})/i.exec(t); return m ? +m[1] : null; };

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} från ${new URL(url).host}`);
  return await r.text();
}

// Oden Bistro: textmeny på hemsidan, "Dagens Kött/Fisk/Pasta" per dag och en vegansk rätt för hela veckan
export function parseOden(html) {
  const L = lines(html);
  const start = L.findIndex(l => /dagens lunchmeny/i.test(l));
  if (start < 0) throw new Error('hittade ingen lunchmeny');
  const days = [[], [], [], [], []], info = [], vegan = [];
  let d = -1, label = '', inVegan = false;
  for (const l of L.slice(start + 1)) {
    if (/uppdateras|lördagslunch/i.test(l)) break;
    const nd = dayOf(l);
    if (nd >= 0 && l.length < 20) { d = nd; label = ''; inVegan = false; continue; }
    if (/^vegan\b/i.test(l)) { inVegan = true; label = 'Vegan'; continue; }
    const lab = /^dagens\s+(\S+)/i.exec(l);
    if (lab && d >= 0 && !inVegan) { label = lab[1][0].toUpperCase() + lab[1].slice(1).toLowerCase(); continue; }
    if (/pensionär|salladsbuff|ingår alla dagar/i.test(l) && d >= 0) continue;
    const t = clean(l);
    if (!t || /^[\d\s:;\-–.,]*$/.test(t)) continue;
    if (d < 0) continue;
    if (inVegan) { if (/^[\d\s:;\-–]+$/.test(t)) continue; vegan.push(t); continue; }
    // en rad som fortsätter en rätt (radbrytning mitt i)
    const prev = days[d][days[d].length - 1];
    if (prev && !/^[*＊]/.test(l) && /^[a-zåäö]/.test(t) && !lab) { prev.text += ' ' + t; continue; }
    days[d].push({ label, text: t });
  }
  // fortsättningsrader i veganrätterna
  const vg = [];
  for (const v of vegan) { if (vg.length && /^[a-zåäö]/.test(v)) vg[vg.length - 1] += ' ' + v; else vg.push(v); }
  for (const day of days) for (const v of vg) day.push({ label: 'Vegan', text: v });
  info.push('Vardagar 11–14.30. Kött och fisk 139 kr, pasta 135 kr, vegan 129 kr, pensionär 130 kr', 'Salladsbuffé, bröd, kaffe, kaka och måltidsdryck ingår');
  return { week: weekIn(L[start]), days, info };
}

// Bacchus (Folkets Hus Kulturhuset): "måndag 9 november" och sedan rätter som börjar med "- "
export function parseBacchus(html) {
  const L = lines(html);
  const start = L.findIndex(l => /^veckans meny/i.test(l));
  if (start < 0) throw new Error('hittade ingen veckomeny');
  const days = [[], [], [], [], []], info = [];
  let d = -1, week = weekIn(L[start]), seen = 0;
  for (const l of L.slice(start + 1)) {
    if (/^veckans meny/i.test(l) || /^kontaktuppgifter/i.test(l)) break;
    if (week === null && /^\d{1,2}$/.test(l)) { week = +l; continue; }
    const nd = dayOf(l);
    if (nd >= 0 && /\d/.test(l) && l.length < 30) { d = nd; seen++; continue; }
    if (d < 0) continue;
    if (/^-\s*/.test(l)) { const t = clean(l); if (t) days[d].push({ label: '', text: t }); continue; }
    if (seen === 1 && !info.includes(l)) info.push(l);
  }
  return { week, days, info };
}

// lunchsidan.se: <li data-day="Måndag"><strong>Måndag</strong> rätt<br/> rätt</li>
export function parseLunchsidan(html) {
  const days = [[], [], [], [], []], info = [];
  const ul = /<ul class="menuitems">([\s\S]*?)<\/ul>/i.exec(html);
  if (!ul) throw new Error('hittade ingen meny');
  for (const m of ul[1].matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const dd = /data-day="([^"]+)"/i.exec(m[1]);
    const body = m[2].replace(/<strong>[\s\S]*?<\/strong>/i, '');
    const parts = lines(body.replace(/<br\s*\/?>/gi, '\n')).map(clean).filter(Boolean);
    if (dd) { const d = DAYS.indexOf(dd[1].toLowerCase()); if (d >= 0) days[d].push(...parts.map(text => ({ label: '', text }))); }
    else info.push(...parts);
  }
  const w = /\(vecka\s*(\d{1,2})\)/i.exec(html);
  return { week: w ? +w[1] : null, days, info };
}

// Sour Café: veckans lunch är en bild under fliken LUNCH
export function parseSour(html) {
  const i = html.indexOf('id="tab-lunch"');
  if (i < 0) throw new Error('hittade ingen lunchflik');
  const j = html.indexOf('id="tab-', i + 10);
  const part = html.slice(i, j > 0 ? j : i + 20000);
  const img = /<img[^>]*\ssrc="([^"]+)"/i.exec(part);
  if (!img) throw new Error('hittade ingen lunchbild');
  const date = /(\d{4})-(\d{2})-(\d{2})/.exec(img[1]);
  const info = ["Today's Sour 125 kr och veckans oklassiska husman 135 kr, 11–15", 'Sallad, bröd och kaffe ingår'];
  return { week: date ? isoWeek(new Date(date[0] + 'T12:00:00Z')) : null, image: decode(img[1]), days: null, info };
}

// Västans egen sida har bara en bild (Vastan_meny_v46.png), används om lunchsidan inte svarar
export function vastanImage(html) {
  const m = /onewebmedia\/(Vastan_meny_v(\d+)\.(?:png|jpe?g))/i.exec(html);
  return m ? { image: 'https://restaurangvastan.se/onewebmedia/' + m[1], week: +m[2] } : null;
}

const SOURCES = [
  { id: 'sour', name: 'Sour Café', where: 'Drottningtorget 1', url: 'https://www.sourcafe.se/', fetch: 'https://www.sourcafe.se/', parse: parseSour },
  { id: 'vastan', name: 'Restaurang Västan', where: 'Högskolan Väst, Gustava Melins gata 2', url: 'https://restaurangvastan.se/', fetch: 'https://www.lunchsidan.se/restaurang/restaurang-vastan/11203318201', parse: parseLunchsidan, note: 'Dagens gröna och dagens pasta läggs ut på Västans Facebook/Instagram varje morgon.' },
  { id: 'bacchus', name: 'Restaurang Bacchus', where: 'Folkets Hus Kulturhuset', url: 'https://www.trollhattan.fh.se/sv/restaurang/dagens-lunch', fetch: 'https://www.trollhattan.fh.se/sv/restaurang/dagens-lunch', parse: parseBacchus, backup: 'https://www.lunchsidan.se/restaurang/restaurang-bacchus/3367858804' },
  { id: 'oden', name: 'Oden Bistro', where: 'Kungsgatan 30', url: 'https://www.odenbistro.com/menyer', fetch: 'https://www.odenbistro.com/menyer', parse: parseOden },
  { id: 'maeprai', name: 'Mae Prai', where: 'Storgatan 39', url: 'https://www.facebook.com/maeprairestaurang', fb: 'https://www.facebook.com/maeprairestaurang', static: { week: null, days: null, info: ['Dagens lunch från 139 kr, tisdag–fredag 11–14.30', '3 varmrätter, salladsbuffé, misosoppa, kaffe och kaka ingår'] }, note: 'Mae Prai lägger bara ut lunchmenyn på Facebook och Instagram.' },
];

async function one(src) {
  const base = { id: src.id, name: src.name, where: src.where, url: src.url, fb: src.fb || null, note: src.note || null };
  if (src.static) return { ...base, ...src.static };
  try {
    return { ...base, ...src.parse(await get(src.fetch)) };
  } catch (e) {
    if (src.backup) { try { return { ...base, ...parseLunchsidan(await get(src.backup)), via: 'lunchsidan.se' }; } catch { /* nedan */ } }
    if (src.id === 'vastan') { try { const v = vastanImage(await get(src.url)); if (v) return { ...base, ...v, days: null, info: [] }; } catch { /* nedan */ } }
    return { ...base, days: null, info: [], error: String(e?.message || e).slice(0, 200) };
  }
}

export async function build() {
  const list = await Promise.all(SOURCES.map(one));
  return { fetched: new Date().toISOString(), restaurants: list };
}

// Kör som skript: behåll förra menyn för en restaurang vars sida inte svarade
if (/scrape\.mjs$/.test(process.argv[1] || '')) {
  let old = null; try { old = JSON.parse(readFileSync('menu.json', 'utf8')); } catch { /* första gången */ }
  const data = await build();
  data.restaurants = data.restaurants.map(r => {
    if (!r.error || !old) return r;
    const prev = old.restaurants.find(o => o.id === r.id && !o.error);
    return prev ? { ...prev, oldCopy: true } : r;
  });
  const same = old && JSON.stringify(old.restaurants) === JSON.stringify(data.restaurants);
  if (!same) writeFileSync('menu.json', JSON.stringify(data, null, 1) + '\n');
  for (const r of data.restaurants) console.log(r.id, 'v' + r.week, r.error ? 'FEL ' + r.error : r.oldCopy ? 'gammal kopia' : 'ok');
  console.log(same ? 'oförändrat' : 'menu.json uppdaterad');
}
