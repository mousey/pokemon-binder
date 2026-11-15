/* =========================================================================
   app.js — My Pokémon Binder
   Everything is stored in the browser (localStorage). Use Settings → Export
   to make a backup file.
   ========================================================================= */
'use strict';

/* ------------------------------ helpers ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const numOf = (n) => { const m = String(n ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; };

const CARD_BACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 245 342"><rect width="245" height="342" rx="14" fill="#1d4fa8"/><rect x="10" y="10" width="225" height="322" rx="10" fill="#2a6fd6" stroke="#f5c518" stroke-width="4"/><circle cx="122" cy="171" r="58" fill="#fff" stroke="#222" stroke-width="8"/><path d="M64 171a58 58 0 0 1 116 0z" fill="#e3350d" stroke="#222" stroke-width="8"/><circle cx="122" cy="171" r="16" fill="#fff" stroke="#222" stroke-width="8"/></svg>`);

/* ----------------------------- constants ----------------------------- */
const TYPES = {
  Grass: { c: '#5fbd58', e: '🌿' }, Fire: { c: '#f2683a', e: '🔥' }, Water: { c: '#3d9cf0', e: '💧' },
  Lightning: { c: '#f2c21b', e: '⚡' }, Psychic: { c: '#b768d6', e: '🔮' }, Fighting: { c: '#c9663e', e: '👊' },
  Darkness: { c: '#4b4d63', e: '🌙' }, Metal: { c: '#8d9aa8', e: '⚙️' }, Fairy: { c: '#f08fc9', e: '🧚' },
  Dragon: { c: '#c6a13b', e: '🐉' }, Colorless: { c: '#b5ae9c', e: '⭐' },
  Trainer: { c: '#6c7a89', e: '🎒' }, Energy: { c: '#2ec4b6', e: '🔋' },
};

const GENS = [
  { n: 1, name: 'Kanto', max: 151 }, { n: 2, name: 'Johto', max: 251 }, { n: 3, name: 'Hoenn', max: 386 },
  { n: 4, name: 'Sinnoh', max: 493 }, { n: 5, name: 'Unova', max: 649 }, { n: 6, name: 'Kalos', max: 721 },
  { n: 7, name: 'Alola', max: 809 }, { n: 8, name: 'Galar', max: 905 }, { n: 9, name: 'Paldea', max: 1025 },
];
const GEN_COLORS = ['#e3350d', '#d4a017', '#2e9e5b', '#3b6fd8', '#444', '#1aa6b7', '#f07c2a', '#a43ac9', '#c2185b'];

const VARIANTS = [
  { key: 'normal', label: 'Normal', icon: '⚪', tcg: ['normal', 'unlimited', 'unlimitedNormal'], fx: '' },
  { key: 'holofoil', label: 'Holo', icon: '✨', tcg: ['holofoil', 'unlimitedHolofoil'], fx: 'fx-holo' },
  { key: 'reverseHolofoil', label: 'Reverse Holo', icon: '🔄', tcg: ['reverseHolofoil'], fx: 'fx-reverse' },
  { key: '1stEditionNormal', label: '1st Edition', icon: '🥇', tcg: ['1stEditionNormal', '1stEdition'], fx: '' },
  { key: '1stEditionHolofoil', label: '1st Ed. Holo', icon: '🌟', tcg: ['1stEditionHolofoil'], fx: 'fx-holo' },
];
const variantOf = (key) => VARIANTS.find((v) => v.key === key) || VARIANTS[0];

const CURRENCIES = { GBP: '£ Pound', USD: '$ US Dollar', EUR: '€ Euro', CAD: '$ Canadian Dollar', AUD: '$ Australian Dollar' };
const DEFAULT_RATES = { USD: 1, GBP: 0.78, EUR: 0.92, CAD: 1.38, AUD: 1.52 };

const PERIODS = [['1W', 7], ['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365], ['All', 0]];

/* ------------------------------- state ------------------------------- */
const STORE = 'pokebinder.v1';

function guessCurrency() {
  const l = (navigator.language || 'en-GB').toLowerCase();
  if (l.endsWith('-us')) return 'USD';
  if (l.endsWith('-ca')) return 'CAD';
  if (l.endsWith('-au')) return 'AUD';
  if (l.startsWith('en')) return 'GBP';
  return 'EUR';
}

function defaults() {
  return {
    trainer: 'My Pokémon Binder', currency: guessCurrency(), rates: { ...DEFAULT_RATES }, ratesDate: '',
    apiKey: '', items: [], valueHistory: [], lastRefresh: 0,
    prefs: { view: 'binder', sort: 'set', explicitView: false },
    sync: { enabled: false, code: '', url: '', lastSync: 0 },
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.items)) return {
      ...defaults(),
      ...s,
      prefs: { ...defaults().prefs, ...(s.prefs || {}) },
      sync: { ...defaults().sync, ...(s.sync || {}) },
    };
  } catch (e) { console.warn(e); }
  return defaults();
}

let state = load();
let saveDebounceTimer = null;
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch (e) { toast('⚠️ Could not save – storage full? Try exporting a backup.'); }
  if (state.sync && state.sync.enabled && state.sync.code && state.sync.url) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => pushToCloud({ silent: true }), 400);
  }
};

const isMobileScreen = () => window.innerWidth <= 768;

const ui = {
  view: (!state.prefs.explicitView && isMobileScreen()) ? 'pokedex' : (state.prefs.view || 'binder'),
  pokedexIndex: 0,
  sort: state.prefs.sort, search: '',
  types: new Set(), gens: new Set(), variants: new Set(),
  page: 0, flashUid: null, refreshing: false,
};

API.setKey(state.apiKey);

/* ------------------------------ money -------------------------------- */
const rate = () => state.rates[state.currency] || 1;
function fmt(usd, { compact = false } = {}) {
  const v = (usd || 0) * rate();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: state.currency,
      maximumFractionDigits: compact && v >= 100 ? 0 : 2, minimumFractionDigits: compact && v >= 100 ? 0 : 2,
    }).format(v);
  } catch { return v.toFixed(2); }
}
const fmtDisplay = (v) => fmt(v / rate());
const eurToUsd = (eur) => eur / (state.rates.EUR || 0.92);

/** Best price estimate (in USD) for one copy of a card in a given finish. */
function priceInfo(card, variantKey) {
  const v = variantOf(variantKey);
  const t = card?.prices?.tcg || {};
  for (const k of v.tcg) {
    const p = t[k];
    const val = p && (p.market ?? p.mid);
    if (val) return { usd: val, src: 'TCGplayer market price', exact: true };
  }
  const cm = card?.prices?.cm || {};
  const isRev = variantKey === 'reverseHolofoil';
  const cmv = isRev ? (cm.reverseHoloTrend ?? cm.reverseHoloSell) : (cm.trendPrice ?? cm.averageSellPrice);
  if (cmv) return { usd: eurToUsd(cmv), src: 'Cardmarket trend price', exact: true };
  for (const p of Object.values(t)) {
    const val = p && (p.market ?? p.mid);
    if (val) return { usd: val, src: 'Estimate (from another finish)', exact: false };
  }
  if (cm.trendPrice) return { usd: eurToUsd(cm.trendPrice), src: 'Estimate (Cardmarket)', exact: false };
  return { usd: 0, src: 'No price data yet', exact: false };
}
const unitUSD = (item) => priceInfo(item.card, item.variant).usd;
const totalUSD = (item) => unitUSD(item) * item.qty;
const collectionUSD = () => state.items.reduce((s, i) => s + totalUSD(i), 0);

function availableVariants(card) {
  const keys = Object.keys(card?.prices?.tcg || {});
  const fromPrices = VARIANTS.filter((v) => v.tcg.some((k) => keys.includes(k))).map((v) => v.key);
  if (fromPrices.length || !card?.variants) return fromPrices;
  // No TCGplayer data (e.g. Japanese cards) → use the finishes TCGdex says exist
  const f = card.variants;
  return [
    f.normal && 'normal', f.holo && 'holofoil', f.reverse && 'reverseHolofoil',
    f.firstEdition && (f.holo ? '1stEditionHolofoil' : '1stEditionNormal'),
  ].filter(Boolean);
}

/* ---------------------------- card facts ----------------------------- */
function primaryType(card) {
  if (/trainer/i.test(card.supertype)) return 'Trainer';
  if (/energy/i.test(card.supertype)) return 'Energy';
  const t = card.types?.[0];
  return TYPES[t] ? t : 'Colorless';
}
function genOf(card) {
  const d = card.dex?.[0];
  if (!d) return null;
  return GENS.find((g) => d <= g.max) || null;
}
const isShinyRarity = (card) => /shiny/i.test(card.rarity || '');

/* ---------------------------- history -------------------------------- */
function pushHistory(item) {
  const p = priceInfo(item.card, item.variant);
  if (!p.usd) return;
  item.history = item.history || [];
  const d = todayStr();
  const last = item.history.at(-1);
  if (last && last.d === d) last.usd = p.usd; else item.history.push({ d, usd: p.usd });
  if (item.history.length > 500) item.history.splice(0, item.history.length - 500);
}

function recordValue() {
  if (!state.items.length && !state.valueHistory.length) return;
  const d = todayStr();
  const v = collectionUSD();
  const last = state.valueHistory.at(-1);
  if (last && last.d === d) last.usd = v; else state.valueHistory.push({ d, usd: v });
}

/** Cardmarket rolling averages → approximate points on a timeline (USD). */
function cardmarketPoints(card, variantKey) {
  const cm = card?.prices?.cm || {};
  const rev = variantKey === 'reverseHolofoil';
  const keys = rev ? ['reverseHoloAvg30', 'reverseHoloAvg7', 'reverseHoloAvg1', 'reverseHoloTrend']
                   : ['avg30', 'avg7', 'avg1', 'trendPrice'];
  const ago = [15, 3.5, 0.5, 0]; // centre of each rolling window
  const upd = Date.parse(String(card?.prices?.cmUpdated || '').replace(/\//g, '-')) || Date.now();
  return keys.map((k, i) => (cm[k] ? { t: upd - ago[i] * DAY, usd: eurToUsd(cm[k]) } : null)).filter(Boolean);
}

/* ------------------------- collection actions ------------------------ */
function addItem(card, variant, qty, shiny) {
  let item = state.items.find((i) => i.cardId === card.id && i.variant === variant);
  if (item) {
    item.qty += qty;
    item.card = card;
  } else {
    item = { uid: uid(), cardId: card.id, source: card.source, variant, qty, shiny: !!shiny, addedAt: Date.now(), card, history: [] };
    state.items.push(item);
  }
  pushHistory(item);
  recordValue();
  save();
  ui.flashUid = item.uid;
  render();
  return item;
}

function removeItem(uidv) {
  state.items = state.items.filter((i) => i.uid !== uidv);
  recordValue();
  save();
  render();
}

async function refreshPrices({ silent = false } = {}) {
  if (ui.refreshing || !state.items.length) return;
  ui.refreshing = true;
  $('#refreshBtn').classList.add('spinning');
  if (!silent) toast('Updating prices…');
  let updated = 0;
  try {
    // keep exchange rates fresh too
    try { state.rates = { ...DEFAULT_RATES, ...(await API.getRates()) }; state.ratesDate = todayStr(); } catch { /* keep old */ }
    const ids = [...new Set(state.items.map((i) => i.cardId))];
    if (ids.length) {
      try {
        const map = await API.getCardsBulk(ids);
        state.items.forEach((it) => {
          const c = map.get(it.cardId);
          if (c) { it.card = c; pushHistory(it); updated++; }
        });
      } catch (e) { console.warn('refresh failed', e); }
    }
    state.lastRefresh = Date.now();
    recordValue();
    save();
    render();
    if (!silent) toast(updated ? `✅ Prices updated for ${updated} card${updated === 1 ? '' : 's'}` : '😕 Could not reach the price server. Try again later.');
  } finally {
    ui.refreshing = false;
    $('#refreshBtn').classList.remove('spinning');
  }
}

/* ------------------------ filtering & sorting ------------------------ */
function searchText(i) {
  const c = i.card;
  return [c.name, c.setName, c.setCode, c.number, `${c.setCode} ${c.number}`, `${c.setCode} ${String(c.number).padStart(3, '0')}`,
    c.rarity, (c.types || []).join(' '), c.supertype, variantOf(i.variant).label, c.artist, i.shiny ? 'shiny' : '',
    c.lang === 'ja' ? 'japanese jp 日本語' : '', c.nameJa || '', c.setNameJa || '']
    .join(' ').toLowerCase();
}

function visibleItems() {
  const tokens = ui.search.toLowerCase().split(/\s+/).filter(Boolean);
  let list = state.items.filter((i) => {
    if (ui.types.size && !ui.types.has(primaryType(i.card))) return false;
    if (ui.gens.size) {
      const g = genOf(i.card);
      if (!ui.gens.has(g ? g.n : 0)) return false;
    }
    if (ui.variants.size) {
      const ok = [...ui.variants].some((v) => (v === 'shiny' ? i.shiny : i.variant === v));
      if (!ok) return false;
    }
    if (tokens.length) {
      const hay = searchText(i);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const dexN = (i) => i.card.dex?.[0] || 99999;
  const byName = (a, b) => a.card.name.localeCompare(b.card.name);
  const bySet = (a, b) => (a.card.releaseDate || '').localeCompare(b.card.releaseDate || '')
    || (a.card.setName || '').localeCompare(b.card.setName || '')
    || numOf(a.card.number) - numOf(b.card.number)
    || String(a.card.number).localeCompare(String(b.card.number))
    || VARIANTS.indexOf(variantOf(a.variant)) - VARIANTS.indexOf(variantOf(b.variant));
  const typeOrder = Object.keys(TYPES);

  let groupFn = () => ({ key: '', label: '', color: '' });
  switch (ui.sort) {
    case 'dex': list.sort((a, b) => dexN(a) - dexN(b) || bySet(a, b)); break;
    case 'name': list.sort((a, b) => byName(a, b) || bySet(a, b));
      groupFn = (i) => { const l = (i.card.name[0] || '#').toUpperCase(); return { key: l, label: l, color: '#e3350d' }; };
      break;
    case 'value': list.sort((a, b) => unitUSD(b) - unitUSD(a)); break;
    case 'added': list.sort((a, b) => b.addedAt - a.addedAt); break;
    case 'type':
      list.sort((a, b) => typeOrder.indexOf(primaryType(a.card)) - typeOrder.indexOf(primaryType(b.card)) || dexN(a) - dexN(b) || byName(a, b));
      groupFn = (i) => { const t = primaryType(i.card); return { key: t, label: `${TYPES[t].e} ${t}`, color: TYPES[t].c }; };
      break;
    case 'gen':
      list.sort((a, b) => (genOf(a.card)?.n || 99) - (genOf(b.card)?.n || 99) || dexN(a) - dexN(b) || byName(a, b));
      groupFn = (i) => {
        const g = genOf(i.card);
        return g ? { key: 'g' + g.n, label: `Gen ${g.n} · ${g.name}`, color: GEN_COLORS[g.n - 1] }
                 : { key: 'other', label: '🎒 Trainers & Energy', color: '#6c7a89' };
      };
      break;
    default:
      list.sort(bySet);
      groupFn = (i) => ({ key: i.card.setId, label: `${i.card.setName}${i.card.setCode ? ' · ' + i.card.setCode : ''}`, color: '#3b4cca', symbol: i.card.setSymbol });
  }
  return list.map((item) => ({ item, group: groupFn(item) }));
}

/* ----------------------------- rendering ----------------------------- */
function tileHTML(item, { meta = false } = {}) {
  const v = variantOf(item.variant);
  const c = item.card;
  return `
  <button class="card-tile ${v.fx} ${item.uid === ui.flashUid ? 'flash' : ''}" data-uid="${item.uid}" title="${esc(c.name)} – ${esc(c.setName)} #${esc(c.number)}">
    <div class="card-img-wrap">
      <img loading="lazy" src="${esc(c.imgSmall || CARD_BACK)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=CARD_BACK" />
      <span class="glare"></span>
    </div>
    ${item.qty > 1 ? `<span class="qty-badge">×${item.qty}</span>` : ''}
    <span class="badges">${c.lang === 'ja' ? '<span class="vbadge" title="Japanese card">🇯🇵</span>' : ''}${v.key !== 'normal' ? `<span class="vbadge" title="${v.label}">${v.icon}</span>` : ''}${item.shiny ? '<span class="vbadge" title="Shiny">⭐</span>' : ''}</span>
    ${meta ? `
    <div class="tile-meta">
      <div class="tile-name">${esc(c.name)}</div>
      <div class="tile-sub">${esc(c.setCode || '')} ${esc(c.number)} · ${v.label}</div>
      <div class="tile-price">${unitUSD(item) ? fmt(unitUSD(item)) : '—'}</div>
    </div>` : `<span class="pocket-price">${unitUSD(item) ? fmt(unitUSD(item), { compact: true }) : ''}</span>`}
  </button>`;
}

function renderStats() {
  const total = state.items.reduce((s, i) => s + i.qty, 0);
  $('#statCards').textContent = total;
  $('#statUnique').textContent = new Set(state.items.map((i) => i.cardId)).size;
  $('#statValue').textContent = fmt(collectionUSD());

  // trend vs ~7 days ago, using Cardmarket averages for the cards owned now
  const trend = marketTrendSeries();
  const el = $('#statTrend');
  el.textContent = '';
  el.className = '';
  if (trend.length >= 2) {
    const first = trend.find((p) => p.t >= Date.now() - 8 * DAY) || trend[0];
    const last = trend.at(-1);
    if (first.v > 0 && first !== last) {
      const pct = ((last.v - first.v) / first.v) * 100;
      if (Math.abs(pct) >= 0.1) {
        el.textContent = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`;
        el.className = pct > 0 ? 'up' : 'down';
      }
    }
  }
}

function renderChips() {
  const counts = { types: {}, gens: {}, variants: {} };
  state.items.forEach((i) => {
    const t = primaryType(i.card); counts.types[t] = (counts.types[t] || 0) + i.qty;
    const g = genOf(i.card); const gk = g ? g.n : 0; counts.gens[gk] = (counts.gens[gk] || 0) + i.qty;
    counts.variants[i.variant] = (counts.variants[i.variant] || 0) + i.qty;
    if (i.shiny) counts.variants.shiny = (counts.variants.shiny || 0) + i.qty;
  });

  const chip = (group, key, label, color, n) => `
    <button class="chip ${ui[group].has(key) ? 'on' : ''} ${n ? '' : 'zero'}" data-group="${group}" data-key="${key}" style="--chip:${color}">
      ${label}${n ? `<b>${n}</b>` : ''}
    </button>`;

  $('#typeChips').innerHTML = `<span class="chip-title">Type</span>` +
    Object.entries(TYPES).map(([t, o]) => chip('types', t, `${o.e} ${t}`, o.c, counts.types[t])).join('');
  $('#genChips').innerHTML = `<span class="chip-title">Generation</span>` +
    GENS.map((g) => chip('gens', g.n, `Gen ${g.n} ${g.name}`, GEN_COLORS[g.n - 1], counts.gens[g.n])).join('') +
    chip('gens', 0, '🎒 Trainer/Energy', '#6c7a89', counts.gens[0]);
  $('#variantChips').innerHTML = `<span class="chip-title">Finish</span>` +
    VARIANTS.map((v) => chip('variants', v.key, `${v.icon} ${v.label}`, '#8a5cf6', counts.variants[v.key])).join('') +
    chip('variants', 'shiny', '⭐ Shiny', '#f5b301', counts.variants.shiny);
}

const isWide = () => window.innerWidth >= 980;

function buildPages(list) {
  const grouped = ['type', 'gen', 'set'].includes(ui.sort);
  const pages = [];
  let cur = null;
  const newPage = (group) => { cur = { groups: [group], items: [] }; pages.push(cur); };

  if (!grouped) {
    list.forEach(({ item, group }) => { if (!cur || cur.items.length === 9) newPage(group); cur.items.push(item); });
  } else {
    // split into groups first, then lay each group out starting on a fresh row
    const groups = [];
    list.forEach(({ item, group }) => {
      const g = groups.at(-1);
      if (g && g.group.key === group.key) g.items.push(item); else groups.push({ group, items: [item] });
    });
    groups.forEach(({ group, items }) => {
      if (cur) {
        const used = Math.ceil(cur.items.length / 3) * 3; // pad to next row
        if (used + items.length <= 9 && used < 9) {
          while (cur.items.length < used) cur.items.push(null);
          cur.groups.push(group);
        } else newPage(group);
      } else newPage(group);
      items.forEach((it) => {
        if (cur.items.length === 9) newPage(group);
        cur.items.push(it);
      });
    });
  }
  if (!pages.length) pages.push({ groups: [], items: [] });
  return pages;
}

function pageHTML(p, n) {
  const pockets = Array.from({ length: 9 }, (_, i) => {
    const it = p.items[i];
    return `<div class="pocket">${it ? tileHTML(it) : ''}</div>`;
  }).join('');
  const tabs = p.groups.filter((g) => g && g.label).map((g) =>
    `<div class="page-tab" style="--tab:${g.color || '#3b4cca'}">${g.symbol ? `<img src="${esc(g.symbol)}" alt="" onerror="this.remove()"/>` : ''}${esc(g.label)}</div>`).join('');
  return `<div class="page">${tabs ? `<div class="page-tabs">${tabs}</div>` : ''}<div class="pockets">${pockets}</div><div class="page-num">${n}</div></div>`;
}

let lastPages = [];
function renderBinder(list, anim = '') {
  const pages = buildPages(list);
  lastPages = pages;
  const per = isWide() ? 2 : 1;
  const spreads = Math.ceil(pages.length / per);

  if (ui.flashUid) {
    const idx = pages.findIndex((p) => p.items.some((i) => i && i.uid === ui.flashUid));
    if (idx >= 0) ui.page = Math.floor(idx / per);
  }
  ui.page = clamp(ui.page, 0, spreads - 1);

  const start = ui.page * per;
  const shown = pages.slice(start, start + per);
  let html = shown.map((p, i) => pageHTML(p, start + i + 1)).join('');
  if (per === 2 && shown.length === 1) html += `<div class="page page-blank"><div class="page-blank-ball"></div></div>`;

  const spread = $('#binderSpread');
  spread.innerHTML = html;
  spread.classList.remove('turn-next', 'turn-prev');
  if (anim) { void spread.offsetWidth; spread.classList.add(anim); }

  $('#pagePrev').disabled = ui.page === 0;
  $('#pageNext').disabled = ui.page >= spreads - 1;
  const a = start + 1, b = Math.min(start + per, pages.length);
  $('#pageIndicator').textContent = `${a === b ? `Page ${a}` : `Pages ${a}–${b}`} of ${pages.length}`;
  const slider = $('#pageSlider');
  slider.max = spreads - 1; slider.value = ui.page;
  slider.style.visibility = spreads > 1 ? 'visible' : 'hidden';
}

function renderGrid(list) {
  const sections = [];
  list.forEach(({ item, group }) => {
    let s = sections.at(-1);
    if (!s || s.group.key !== group.key) { s = { group, items: [] }; sections.push(s); }
    s.items.push(item);
  });
  $('#gridView').innerHTML = sections.map((s) => `
    <section class="grid-section">
      ${s.group.label ? `<h3 class="grid-heading" style="--tab:${s.group.color}">${s.group.symbol ? `<img src="${esc(s.group.symbol)}" alt="" onerror="this.remove()"/>` : ''}${esc(s.group.label)} <small>${s.items.reduce((n, i) => n + i.qty, 0)}</small></h3>` : ''}
      <div class="grid">${s.items.map((i) => tileHTML(i, { meta: true })).join('')}</div>
    </section>`).join('');
  if (ui.flashUid) {
    const el = $(`#gridView [data-uid="${ui.flashUid}"]`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }
}

function render(anim) {
  $('#trainerTitle').textContent = state.trainer;
  document.title = state.trainer;
  renderStats();
  renderChips();

  const list = visibleItems();
  const empty = !state.items.length;
  const noRes = !empty && !list.length;
  $('#emptyState').classList.toggle('hidden', !empty);
  $('#noResults').classList.toggle('hidden', !noRes);
  $('.filters').classList.toggle('hidden', empty);
  $('.toolbar').classList.toggle('hidden', empty);

  $$('.vt-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  $('#binderView').classList.toggle('hidden', ui.view !== 'binder' || empty || noRes);
  $('#gridView').classList.toggle('hidden', ui.view !== 'grid' || empty || noRes);
  $('#pokedexView').classList.toggle('hidden', ui.view !== 'pokedex' || empty || noRes);

  if (!empty && !noRes) {
    if (ui.view === 'binder') renderBinder(list, anim);
    else if (ui.view === 'grid') renderGrid(list);
    else if (ui.view === 'pokedex') renderPokedex(list, anim);
  }
  ui.flashUid = null;
}

function renderPokedex(list, anim = '') {
  const pView = $('#pokedexView');
  if (!pView) return;
  if (!list.length) {
    pView.innerHTML = '';
    return;
  }

  if (ui.flashUid) {
    const idx = list.findIndex(({ item }) => item.uid === ui.flashUid);
    if (idx >= 0) ui.pokedexIndex = idx;
  }
  ui.pokedexIndex = clamp(ui.pokedexIndex || 0, 0, list.length - 1);

  const entry = list[ui.pokedexIndex];
  const item = entry.item;
  const c = item.card;
  const v = variantOf(item.variant);
  const t = primaryType(c);
  const g = genOf(c);

  pView.innerHTML = `
    <div class="pokedex-shell">
      <!-- Top sensor bar with glowing lens & LEDs -->
      <div class="pokedex-top">
        <div class="pokedex-top-left">
          <div class="pokedex-lens-wrap">
            <div class="pokedex-lens"></div>
          </div>
          <div class="pokedex-leds">
            <div class="pokedex-led red"></div>
            <div class="pokedex-led yellow"></div>
            <div class="pokedex-led green"></div>
          </div>
        </div>
        <div class="pokedex-brand-tag">🔴 POKÉDEX KANTO</div>
      </div>

      <!-- Main screen housing with iconic cut corner -->
      <div class="pokedex-screen-housing">
        <div class="pokedex-housing-top">
          <div class="pokedex-housing-dot"></div>
          <div class="pokedex-housing-dot"></div>
        </div>

        <!-- Inset LCD Screen -->
        <div class="pokedex-screen" id="pokedexLcd">
          <div class="pokedex-header-strip">
            <span class="pokedex-dex-tag">NO. ${c.dex?.[0] ? '#' + String(c.dex[0]).padStart(4, '0') : esc(c.setCode || '')} · ${esc(c.number || '')}</span>
            <span class="pokedex-dex-tag" style="color:#6ee7b7">CARD ${ui.pokedexIndex + 1} OF ${list.length}</span>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:baseline; z-index:5; flex-wrap:wrap; gap:6px;">
            <h3 class="pokedex-card-name">
              ${esc(c.name)} ${c.hp ? `<span class="pokedex-hp-badge">HP ${esc(c.hp)}</span>` : ''}
              ${c.lang === 'ja' ? '<span style="font-size:0.9rem">🇯🇵</span>' : ''}
            </h3>
            ${c.nameJa && c.nameJa !== c.name ? `<span style="font-size:0.85rem; color:#a7f3d0; font-weight:600;">${esc(c.nameJa)}</span>` : ''}
          </div>

          <!-- Card Stage with 3D Tilt -->
          <div class="pokedex-card-stage">
            <div class="pokedex-card-wrap ${v.fx}" id="pokedexCardHero" title="Click to view full battle stats and details">
              <div class="pokedex-card-badges">
                ${c.lang === 'ja' ? '<span class="vbadge">🇯🇵</span>' : ''}
                ${v.key !== 'normal' ? `<span class="vbadge">${v.icon}</span>` : ''}
                ${item.shiny ? '<span class="vbadge">⭐</span>' : ''}
              </div>
              <img src="${esc(c.imgLarge || c.imgSmall || CARD_BACK)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=CARD_BACK" />
            </div>
          </div>

          <!-- Data Ticker -->
          <div class="pokedex-data-grid">
            <div class="pokedex-data-item">
              <span>Set &amp; Series</span>
              <b>${esc(c.setName)}</b>
            </div>
            <div class="pokedex-data-item">
              <span>Type &amp; Stage</span>
              <b>${(TYPES[t] || TYPES.Colorless).e} ${t} · ${esc(c.stage || 'Basic')}</b>
            </div>
            <div class="pokedex-data-item">
              <span>Finish &amp; Rarity</span>
              <b>${v.icon} ${v.label} · ${esc(c.rarity || 'Common')}</b>
            </div>
            <div class="pokedex-data-item">
              <span>Moves / Attacks</span>
              <b>${c.attacks?.length ? c.attacks.map((a) => esc(a.name)).slice(0, 2).join(', ') : 'None'}</b>
            </div>
          </div>

          <div class="pokedex-value-ticker">
            <span>TCG Market Value</span>
            <b>${unitUSD(item) ? fmt(unitUSD(item)) : '—'}</b>
          </div>
        </div>

        <div class="pokedex-housing-bottom">
          <div class="pokedex-housing-speaker">
            <span></span><span></span><span></span>
          </div>
          <div class="pokedex-housing-led-sm"></div>
        </div>
      </div>

      <!-- Physical Controls Deck -->
      <div class="pokedex-controls-deck">
        <!-- Directional Cross D-Pad -->
        <div class="pokedex-dpad">
          <button class="dpad-btn dpad-up" id="dpadUp" title="Jump 5 cards back">▲</button>
          <button class="dpad-btn dpad-down" id="dpadDown" title="Jump 5 cards forward">▼</button>
          <button class="dpad-btn dpad-left" id="dpadLeft" title="Previous card">◀</button>
          <button class="dpad-btn dpad-right" id="dpadRight" title="Next card">▶</button>
          <div class="dpad-center"></div>
        </div>

        <!-- Right Actions Cluster -->
        <div class="pokedex-actions-cluster">
          <div class="pokedex-cluster-row">
            <button class="pokedex-pill-btn" id="pokedexDetailBtn" title="Inspect full stats, moves & history">
              <span>📖</span> Full Card Stats
            </button>
            <button class="pokedex-round-btn" id="pokedexTradeBtn" title="Trade this card!">
              🤝
            </button>
          </div>

          <div class="pokedex-cluster-row">
            <button class="pokedex-pill-btn pokedex-scan-action" id="pokedexScanBtn" title="Scan card with camera">
              <span>📸</span> Camera Scanner
            </button>
            <div class="pokedex-qty-cluster" title="Quantity in your collection">
              <button class="pokedex-step-btn" id="pokedexMinusBtn">-</button>
              <div class="pokedex-qty-display">QTY ×${item.qty}</div>
              <button class="pokedex-step-btn" id="pokedexPlusBtn">+</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Speaker slits -->
      <div class="pokedex-bottom-grill">
        <span></span><span></span><span></span><span></span>
      </div>
    </div>
  `;

  const hero = $('#pokedexCardHero', pView);
  if (hero) attachTilt(hero);

  const stepCard = (delta) => {
    const nextIdx = clamp(ui.pokedexIndex + delta, 0, list.length - 1);
    if (nextIdx !== ui.pokedexIndex) {
      ui.pokedexIndex = nextIdx;
      renderPokedex(list);
    }
  };

  $('#dpadLeft', pView).onclick = () => stepCard(-1);
  $('#dpadRight', pView).onclick = () => stepCard(1);
  $('#dpadUp', pView).onclick = () => stepCard(-5);
  $('#dpadDown', pView).onclick = () => stepCard(5);

  $('#pokedexCardHero', pView).onclick = () => openDetail(item.uid);
  $('#pokedexDetailBtn', pView).onclick = () => openDetail(item.uid);
  $('#pokedexTradeBtn', pView).onclick = () => openTrade(item);
  $('#pokedexScanBtn', pView).onclick = () => openScanner();

  $('#pokedexMinusBtn', pView).onclick = () => {
    if (item.qty <= 1) {
      if (confirm(`Remove ${c.name} from your collection?`)) {
        removeItem(item.uid);
      }
    } else {
      item.qty -= 1;
      recordValue(); save(); render();
    }
  };

  $('#pokedexPlusBtn', pView).onclick = () => {
    item.qty += 1;
    recordValue(); save(); render();
  };

  const lcd = $('#pokedexLcd', pView);
  let startX = null;
  lcd.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  lcd.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const diffX = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(diffX) > 40) {
      stepCard(diffX < 0 ? 1 : -1);
    }
  });
}

function turnPage(dir) {
  const per = isWide() ? 2 : 1;
  const spreads = Math.ceil(lastPages.length / per);
  const np = clamp(ui.page + dir, 0, spreads - 1);
  if (np === ui.page) return;
  ui.page = np;
  renderBinder(visibleItems(), dir > 0 ? 'turn-next' : 'turn-prev');
}

/* ------------------------------- modal ------------------------------- */
function openModal(html, cls = '') {
  const m = $('#modal');
  m.className = 'modal ' + cls;
  m.innerHTML = `<button class="modal-close" data-close aria-label="Close">✕</button>` + html;
  $('#modalRoot').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  return m;
}

let activeStream = null;
function stopActiveStream() {
  if (activeStream) {
    try { activeStream.getTracks().forEach((track) => track.stop()); } catch (e) { console.warn(e); }
    activeStream = null;
  }
}

function closeModal() {
  stopActiveStream();
  $('#modalRoot').classList.add('hidden');
  $('#modal').innerHTML = '';
  document.body.classList.remove('no-scroll');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2800);
}

function confetti() {
  const root = $('#confetti');
  const colors = ['#e3350d', '#f5c518', '#3b4cca', '#5fbd58', '#3d9cf0', '#f08fc9'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + 'vw';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
    s.style.setProperty('--r', (Math.random() * 720) + 'deg');
    s.style.animationDelay = Math.random() * 0.3 + 's';
    s.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
    root.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }
}

/* --------------------------- tilt / holo FX -------------------------- */
/**
 * TCGdex-style 3D card: the card leans towards the pointer, lifts up, and a light
 * glare + rainbow foil slide across it. Springs smoothly back when you let go.
 * Works with mouse, finger-drag, and (on tablets/phones) tilting the device.
 */
function attachTilt(el, { max = 16, lift = 1.06 } = {}) {
  if (!el) return;
  const cur = { x: 0.5, y: 0.5, s: 1, o: 0 };
  const tgt = { x: 0.5, y: 0.5, s: 1, o: 0 };
  let raf = 0;
  const apply = () => {
    const rx = (0.5 - cur.y) * max * 2, ry = (cur.x - 0.5) * max * 2;
    el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(cur.x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(cur.y * 100).toFixed(1)}%`);
    el.style.setProperty('--s', cur.s.toFixed(3));
    el.style.setProperty('--o', cur.o.toFixed(3));
    el.style.setProperty('--sx', `${(-ry * 0.9).toFixed(1)}px`);
    el.style.setProperty('--sy', `${(18 + rx * 0.9).toFixed(1)}px`);
    el.style.setProperty('--hyp', Math.min(1, Math.hypot(cur.x - 0.5, cur.y - 0.5) * 2).toFixed(3));
  };
  const tick = () => {
    let moving = false;
    for (const k of ['x', 'y', 's', 'o']) {
      const d = tgt[k] - cur[k];
      cur[k] += d * 0.14;
      if (Math.abs(d) > 0.001) moving = true;
    }
    apply();
    raf = moving && el.isConnected ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const point = (x, y) => {
    const r = el.getBoundingClientRect();
    tgt.x = clamp((x - r.left) / r.width, 0, 1);
    tgt.y = clamp((y - r.top) / r.height, 0, 1);
    tgt.s = lift; tgt.o = 1;
    el.classList.add('tilting');
    kick();
  };
  const reset = () => {
    tgt.x = 0.5; tgt.y = 0.5; tgt.s = 1; tgt.o = 0;
    el.classList.remove('tilting');
    kick();
  };
  el.addEventListener('pointermove', (e) => point(e.clientX, e.clientY));
  el.addEventListener('pointerdown', (e) => point(e.clientX, e.clientY));
  el.addEventListener('pointerleave', reset);
  el.addEventListener('pointercancel', reset);
  el.style.touchAction = 'none'; // finger-drag tilts the card instead of scrolling

  // Tablets & phones: tilt the device to make the foil move
  if (window.DeviceOrientationEvent && matchMedia('(hover: none)').matches) {
    let base = null;
    const onTilt = (e) => {
      if (!el.isConnected) { window.removeEventListener('deviceorientation', onTilt); return; }
      if (e.beta == null) return;
      base = base || { b: e.beta, g: e.gamma };
      tgt.x = clamp(0.5 + (e.gamma - base.g) / 40, 0, 1);
      tgt.y = clamp(0.5 + (e.beta - base.b) / 40, 0, 1);
      tgt.s = 1; tgt.o = 0.8;
      kick();
    };
    window.addEventListener('deviceorientation', onTilt);
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && !attachTilt.asked) {
      el.addEventListener('click', () => {
        if (attachTilt.asked) return;
        attachTilt.asked = true;
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }, { once: true });
    }
  }
  apply();
}

/** Lighter version of the tilt for every card in the binder pockets & grid (one listener for all). */
function bindPocketTilt(root) {
  let active = null;
  const clear = (t) => {
    if (!t) return;
    ['--rx', '--ry', '--mx', '--my'].forEach((p) => t.style.removeProperty(p));
    t.classList.remove('tilting');
  };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest('.card-tile');
    if (t !== active) { clear(active); active = t; }
    if (!t) return;
    const r = t.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
    t.style.setProperty('--rx', `${((0.5 - py) * 22).toFixed(1)}deg`);
    t.style.setProperty('--ry', `${((px - 0.5) * 22).toFixed(1)}deg`);
    t.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    t.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    t.classList.add('tilting');
  });
  root.addEventListener('pointerleave', () => { clear(active); active = null; });
}

/* --------------------------- card facts panel ------------------------ */
const STAGES = { Basic: 'Basic', Stage1: 'Stage 1', Stage2: 'Stage 2', VMAX: 'VMAX', VSTAR: 'VSTAR', 'V-UNION': 'V-UNION', BREAK: 'BREAK', MEGA: 'Mega', LEVEL_UP: 'Level-Up', RESTORED: 'Restored' };
const energyIcon = (t) => {
  const ty = TYPES[t] || TYPES.Colorless;
  return `<i class="energy" style="--e:${ty.c}" title="${esc(t)}">${ty.e}</i>`;
};
const typeChip = (t, extra = '') => `<span class="type-chip" style="--e:${(TYPES[t] || TYPES.Colorless).c}">${(TYPES[t] || TYPES.Colorless).e} ${esc(t)}${extra ? ` <b>${esc(extra)}</b>` : ''}</span>`;

function cardFactsHTML(c) {
  if (c.attacks === undefined) {
    return `<div class="facts facts-loading" id="factsBox"><div class="spinner small"></div> Loading attacks &amp; Pokédex info…</div>`;
  }
  const isJa = c.lang === 'ja';
  const useEn = isJa && c.english && ui.jaText !== 'ja';
  const attacks = useEn ? c.english.attacks : (c.attacks || []);
  const abilities = useEn ? c.english.abilities : (c.abilities || []);
  const desc = useEn ? c.english.description : c.description;
  const isPoke = /pok/i.test(c.supertype || '');
  const nothing = !attacks.length && !abilities.length && !c.effect && !c.hp && !desc;
  if (nothing && c.isOffline) {
    return `<div class="facts"><p class="small center">📶 Connect to the internet to see this card's attacks, HP &amp; evolution.</p></div>`;
  }
  const stage = STAGES[c.stage] || c.stage || '';
  return `
    <div class="facts" id="factsBox">
      ${isJa ? `
        <div class="lang-row">
          <span class="small">${c.english ? `Text language:` : `Japanese text (no English match found)`}</span>
          ${c.english ? `
            <button class="lang-btn ${useEn ? 'on' : ''}" data-lang="en">🇬🇧 English</button>
            <button class="lang-btn ${!useEn ? 'on' : ''}" data-lang="ja">🇯🇵 日本語</button>` : ''}
        </div>` : ''}
      ${isPoke ? `
        <div class="fact-strip">
          ${stage ? `<div><span>Stage</span><b>${esc(stage)}</b></div>` : ''}
          ${c.hp ? `<div><span>HP</span><b class="hp-big">${esc(c.hp)}</b></div>` : ''}
          ${(c.types || []).length ? `<div><span>Type</span>${c.types.map((t) => typeChip(t)).join(' ')}</div>` : ''}
          ${c.evolveFrom ? `<div><span>Evolves from</span><b>${esc(c.evolveFrom)}</b></div>` : (stage === 'Basic' ? `<div><span>Evolves from</span><b>— (Basic)</b></div>` : '')}
        </div>` : ''}

      ${abilities.map((a) => `
        <div class="ability">
          <div class="ab-head"><span class="ab-tag">${esc(a.type || 'Ability')}</span><b>${esc(a.name)}</b></div>
          ${a.effect ? `<p>${esc(a.effect)}</p>` : ''}
        </div>`).join('')}

      ${attacks.map((a) => `
        <div class="attack">
          <div class="atk-head">
            <span class="atk-cost">${(a.cost || []).map(energyIcon).join('') || '<i class="energy free" title="Free">0</i>'}</span>
            <b class="atk-name">${esc(a.name)}</b>
            ${a.damage ? `<span class="atk-dmg">${esc(a.damage)}</span>` : ''}
          </div>
          ${a.effect ? `<p>${esc(a.effect)}</p>` : ''}
        </div>`).join('')}

      ${!isPoke && c.effect ? `<div class="attack"><p>${esc(c.effect)}</p></div>` : ''}

      ${isPoke && (c.weaknesses?.length || c.resistances?.length || c.retreat != null) ? `
        <div class="wrr">
          <div><span>Weakness</span>${(c.weaknesses || []).map((w) => typeChip(w.type, w.value)).join(' ') || '—'}</div>
          <div><span>Resistance</span>${(c.resistances || []).map((w) => typeChip(w.type, w.value)).join(' ') || '—'}</div>
          <div><span>Retreat</span>${c.retreat ? Array.from({ length: c.retreat }, () => energyIcon('Colorless')).join('') : '0'}</div>
        </div>` : ''}

      ${desc ? `<p class="flavor">“${esc(desc)}”</p>` : ''}
      ${useEn ? `<p class="small muted-note">English text from the matching English card: ${esc(c.english.setName)} #${esc(c.english.number)}</p>` : ''}
    </div>`;
}

/* ---------------------------- detail modal --------------------------- */
function seriesForItem(item, days) {
  const r = rate();
  const since = days ? Date.now() - days * DAY : 0;
  const snaps = (item.history || []).map((h) => ({ t: Date.parse(h.d + 'T12:00:00'), v: h.usd * r })).filter((p) => p.t >= since);
  const cm = cardmarketPoints(item.card, item.variant).map((p) => ({ t: p.t, v: p.usd * r })).filter((p) => p.t >= since);
  return [
    { name: 'Your saved prices (TCGplayer)', color: '#3b4cca', points: snaps },
    { name: 'Cardmarket rolling average', color: '#f2683a', points: cm },
  ];
}

function openDetail(uidv, period = 30) {
  const item = state.items.find((i) => i.uid === uidv);
  if (!item) return;
  const c = item.card;
  const v = variantOf(item.variant);
  const p = priceInfo(c, item.variant);
  const avail = availableVariants(c);
  const t = primaryType(c);
  const g = genOf(c);

  const m = openModal(`
    <div class="card-screen">
      <!-- Top header bar -->
      <div class="card-screen-header">
        <div class="csh-title">
          <h2 class="detail-name">${esc(c.name)} ${c.hp ? `<span class="hp">HP ${esc(c.hp)}</span>` : ''}</h2>
          ${c.nameJa && c.nameJa !== c.name ? `<span class="ja-name-inline">${esc(c.nameJa)}</span>` : ''}
        </div>
        <div class="pills csh-pills">
          ${c.lang === 'ja' ? `<span class="pill" style="--pill:#bc002d">🇯🇵 Japanese</span>` : ''}
          <span class="pill" style="--pill:${TYPES[t].c}">${TYPES[t].e} ${t}</span>
          ${g ? `<span class="pill" style="--pill:${GEN_COLORS[g.n - 1]}">Gen ${g.n} · ${g.name}</span>` : ''}
          ${c.dex?.[0] ? `<span class="pill" style="--pill:#555">#${String(c.dex[0]).padStart(4, '0')}</span>` : ''}
          ${c.rarity ? `<span class="pill" style="--pill:#8a5cf6">${esc(c.rarity)}</span>` : ''}
        </div>
      </div>

      <!-- 3 Columns -->
      <div class="card-screen-cols">
        <!-- LEFT COLUMN: Set, Artist, Moves & Abilities -->
        <div class="cs-col cs-col-left">
          <div class="meta-strip">
            <div class="meta-item">
              <span>Set</span>
              <b>${c.setSymbol ? `<img class="set-sym" src="${esc(c.setSymbol)}" alt="" onerror="this.remove()"/>` : ''}${esc(c.setName)}</b>
              ${c.setNameJa && c.setNameJa !== c.setName ? `<small class="muted">${esc(c.setNameJa)}</small>` : ''}
            </div>
            <div class="meta-item">
              <span>Card Code</span>
              <b>${esc(c.setCode)} ${esc(c.number)}${c.printedTotal ? '/' + esc(c.printedTotal) : ''}</b>
            </div>
            ${c.artist ? `
            <div class="meta-item">
              <span>Artist</span>
              <b>🎨 ${esc(c.artist)}</b>
            </div>` : ''}
            ${c.releaseDate ? `
            <div class="meta-item">
              <span>Released</span>
              <b>${esc(new Date(c.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }))}</b>
            </div>` : ''}
          </div>

          <div class="cs-moves-wrap">
            <h3 class="cs-heading">⚡ Moves &amp; Abilities</h3>
            ${cardFactsHTML(c)}
          </div>
        </div>

        <!-- CENTER COLUMN: Card in the Middle -->
        <div class="cs-col cs-col-center">
          <div class="tilt-stage">
            <div class="tilt ${v.fx}" id="tiltCard">
              <img src="${esc(c.imgLarge || c.imgSmall || CARD_BACK)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=CARD_BACK" />
            </div>
          </div>
          <div class="hint">👆 Move over card to shine &amp; tilt!</div>
        </div>

        <!-- RIGHT COLUMN: What Kind, Quantity, Price, Trend & Actions -->
        <div class="cs-col cs-col-right">
          <div class="cs-section">
            <h3 class="cs-heading">Which kind is it?</h3>
            <div class="variant-row compact">
              ${VARIANTS.map((vv) => `
                <button class="variant-btn ${vv.key === item.variant ? 'on' : ''} ${avail.length && !avail.includes(vv.key) ? 'rare' : ''}" data-variant="${vv.key}">
                  <span>${vv.icon}</span>${vv.label}
                </button>`).join('')}
              <button class="variant-btn shiny-btn ${item.shiny ? 'on' : ''}" id="shinyToggle"><span>⭐</span>Shiny</button>
            </div>
          </div>

          <div class="cs-section">
            <div class="qty-value compact">
              <div>
                <h3 class="cs-heading">How many?</h3>
                <div class="stepper compact">
                  <button id="qtyMinus" aria-label="One less">−</button>
                  <span id="qtyNum">${item.qty}</span>
                  <button id="qtyPlus" aria-label="One more">＋</button>
                </div>
              </div>
              <div class="value-box compact">
                <div class="vb-row"><span>Each</span><b>${p.usd ? fmt(p.usd) : '—'}</b></div>
                <div class="vb-row big"><span>All ${item.qty}</span><b>${p.usd ? fmt(p.usd * item.qty) : '—'}</b></div>
                <div class="vb-src">${esc(p.src)}</div>
              </div>
            </div>
          </div>

          <div class="cs-section cs-trend-section">
            <div class="cs-trend-header">
              <h3 class="cs-heading">Price trend</h3>
              <div class="period-row compact">
                ${PERIODS.map(([l, d]) => `<button class="period-btn ${d === period ? 'on' : ''}" data-period="${d}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="chart compact" id="detailChart"></div>
            <p class="chart-note">Blue dots: your updates. Orange: Cardmarket average.</p>
          </div>

          <div class="detail-actions compact">
            <button class="btn btn-trade" id="detailTradeBtn"><span>🤝</span> Compare in Trade</button>
            ${c.prices?.tcgUrl ? `<a class="btn btn-ghost" href="${esc(c.prices.tcgUrl)}" target="_blank" rel="noopener">TCGplayer ↗</a>` : ''}
            ${c.prices?.cmUrl ? `<a class="btn btn-ghost" href="${esc(c.prices.cmUrl)}" target="_blank" rel="noopener">Cardmarket ↗</a>` : ''}
            <button class="btn btn-danger" id="removeBtn">🗑️ Remove</button>
          </div>
        </div>
      </div>
    </div>`, 'modal-fit');

  attachTilt($('#tiltCard', m));
  LineChart.render($('#detailChart', m), seriesForItem(item, period), { format: fmtDisplay, legend: true });

  $$('.lang-btn', m).forEach((b) => b.onclick = () => { ui.jaText = b.dataset.lang; openDetail(uidv, period); });
  if (c.attacks === undefined) {
    // Card was saved before attacks/HP were stored — fetch the full details once.
    API.getCard(item.cardId).then((full) => {
      if (full && !full.isOffline) {
        state.items.filter((i) => i.cardId === item.cardId).forEach((i) => { i.card = full; });
        save();
        if ($('#factsBox') && state.items.includes(item)) openDetail(uidv, period);
      } else {
        const box = $('#factsBox'); if (box) box.outerHTML = cardFactsHTML({ ...c, attacks: [], isOffline: true });
      }
    }).catch(() => { const box = $('#factsBox'); if (box) box.outerHTML = cardFactsHTML({ ...c, attacks: [], isOffline: true }); });
  }

  $('#detailTradeBtn', m).onclick = () => openTrade(item);
  $$('.period-btn', m).forEach((b) => b.onclick = () => openDetail(uidv, Number(b.dataset.period)));

  $$('.variant-btn[data-variant]', m).forEach((b) => b.onclick = () => {
    const nv = b.dataset.variant;
    if (nv === item.variant) return;
    const other = state.items.find((i) => i.cardId === item.cardId && i.variant === nv && i.uid !== item.uid);
    if (other) { // merge into the existing pile
      other.qty += item.qty;
      state.items = state.items.filter((i) => i.uid !== item.uid);
      pushHistory(other); recordValue(); save(); render(); openDetail(other.uid, period);
      toast(`Merged into your ${variantOf(nv).label} pile`);
      return;
    }
    item.variant = nv;
    item.history = [];
    pushHistory(item); recordValue(); save(); render(); openDetail(uidv, period);
  });

  $('#shinyToggle', m).onclick = () => { item.shiny = !item.shiny; save(); render(); openDetail(uidv, period); };

  const setQty = (q) => {
    if (q < 1) {
      if (confirm(`Remove ${c.name} from your binder?`)) { removeItem(uidv); closeModal(); }
      return;
    }
    item.qty = q; recordValue(); save(); render(); openDetail(uidv, period);
  };
  $('#qtyMinus', m).onclick = () => setQty(item.qty - 1);
  $('#qtyPlus', m).onclick = () => setQty(item.qty + 1);

  $('#removeBtn', m).onclick = () => {
    if (confirm(`Remove all ${item.qty} × ${c.name} (${v.label}) from your binder?`)) {
      removeItem(uidv); closeModal(); toast(`Removed ${c.name}`);
    }
  };
}

/* --------------------------- value modal ----------------------------- */
function marketTrendSeries() {
  // What the cards you own *now* were worth recently, from Cardmarket averages,
  // scaled so "today" matches the price used for each card.
  if (!state.items.length) return [];
  const r = rate();
  const ago = [15, 3.5, 0.5, 0];
  const buckets = ago.map((a) => ({ t: Date.now() - a * DAY, v: 0 }));
  state.items.forEach((i) => {
    const cm = i.card?.prices?.cm || {};
    const rev = i.variant === 'reverseHolofoil';
    const vals = (rev ? ['reverseHoloAvg30', 'reverseHoloAvg7', 'reverseHoloAvg1', 'reverseHoloTrend']
                      : ['avg30', 'avg7', 'avg1', 'trendPrice']).map((k) => cm[k] || null);
    const last = vals[3] ?? vals[2] ?? vals[1] ?? vals[0];
    const now = unitUSD(i);
    buckets.forEach((b, bi) => {
      if (!last) { b.v += now * i.qty * r; return; }
      const scale = now ? now / last : eurToUsd(1);
      b.v += (vals[bi] ?? last) * scale * i.qty * r;
    });
  });
  return buckets;
}

function openValue(period = 30) {
  const since = period ? Date.now() - period * DAY : 0;
  const r = rate();
  const snaps = state.valueHistory.map((h) => ({ t: Date.parse(h.d + 'T12:00:00'), v: h.usd * r })).filter((p) => p.t >= since);
  const market = marketTrendSeries().filter((p) => p.t >= since);
  const top = [...state.items].sort((a, b) => totalUSD(b) - totalUSD(a)).slice(0, 8);
  const total = state.items.reduce((s, i) => s + i.qty, 0);

  const m = openModal(`
    <div class="value-modal">
      <h2>💰 Collection value</h2>
      <div class="big-value">${fmt(collectionUSD())}</div>
      <div class="value-sub">${total} cards · ${state.items.length} entries ·
        ${state.lastRefresh ? 'prices updated ' + new Date(state.lastRefresh).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'prices not updated yet'}</div>
      <div class="period-row">
        ${PERIODS.map(([l, d]) => `<button class="period-btn ${d === period ? 'on' : ''}" data-period="${d}">${l}</button>`).join('')}
      </div>
      <div class="chart" id="valueChart"></div>
      <p class="chart-note">Blue: your collection's total, saved each day you use the app (it jumps when you add cards).
        Orange: what the cards you own <i>right now</i> have been worth recently, using Cardmarket averages.</p>
      <h3>🏆 Most valuable cards</h3>
      <div class="top-list">
        ${top.map((i, n) => `
          <button class="top-row" data-uid="${i.uid}">
            <span class="top-rank">${n + 1}</span>
            <img src="${esc(i.card.imgSmall || CARD_BACK)}" alt="" onerror="this.onerror=null;this.src=CARD_BACK" />
            <span class="top-name">${esc(i.card.name)}<small>${esc(i.card.setName)} · ${variantOf(i.variant).label}${i.qty > 1 ? ' · ×' + i.qty : ''}</small></span>
            <b>${fmt(totalUSD(i))}</b>
          </button>`).join('') || '<p>No cards yet!</p>'}
      </div>
    </div>`, 'modal-mid');

  LineChart.render($('#valueChart', m), [
    { name: 'Collection total (saved daily)', color: '#3b4cca', points: snaps },
    { name: 'Market trend of cards you own', color: '#f2683a', points: market },
  ], { format: fmtDisplay, legend: true });

  $$('.period-btn', m).forEach((b) => b.onclick = () => openValue(Number(b.dataset.period)));
  $$('.top-row', m).forEach((b) => b.onclick = () => openDetail(b.dataset.uid));
}

/* --------------------------- trade evaluator ------------------------- */
const tradeState = {
  myItem: null,
  theirCard: null,
  theirVariant: 'normal',
  theirShiny: false,
  theirSearching: false,
  theirCandidates: [],
  searchQuery: '',
};

function rarityTier(rarity = '') {
  const r = (rarity || '').toLowerCase();
  if (/secret|hyper|special illustration|gold/i.test(r)) return { tier: 5, label: 'Super Ultra Rare', color: '#f59e0b' };
  if (/illustration|shiny rare|radiant/i.test(r)) return { tier: 4, label: 'Illustration / Shiny Rare', color: '#a855f7' };
  if (/ultra rare|double rare|vmax|vstar|v|gx|ex/i.test(r)) return { tier: 3, label: 'Ultra Rare / ex', color: '#3b82f6' };
  if (/rare holo|rare/i.test(r)) return { tier: 2, label: 'Rare', color: '#10b981' };
  if (/uncommon/i.test(r)) return { tier: 1, label: 'Uncommon', color: '#64748b' };
  return { tier: 0, label: 'Common', color: '#94a3b8' };
}

function openTrade(initialItem = null) {
  if (initialItem) {
    tradeState.myItem = initialItem;
  } else if (!tradeState.myItem && state.items.length) {
    tradeState.myItem = state.items[0];
  }

  const m = openModal('', 'modal-wide');

  const renderTradeModal = () => {
    const myItem = tradeState.myItem;
    const myCard = myItem?.card;
    const myVar = myItem ? variantOf(myItem.variant) : null;
    const myPrice = myItem ? priceInfo(myCard, myItem.variant) : { usd: 0 };
    const myTier = myCard ? rarityTier(myCard.rarity) : null;

    const theirCard = tradeState.theirCard;
    const theirVar = variantOf(tradeState.theirVariant);
    const theirPrice = theirCard ? priceInfo(theirCard, tradeState.theirVariant) : { usd: 0 };
    const theirTier = theirCard ? rarityTier(theirCard.rarity) : null;

    let verdictHtml = '';
    let acceptDisabled = true;

    if (myItem && theirCard) {
      acceptDisabled = false;
      const myVal = myPrice.usd || 0;
      const theirVal = theirPrice.usd || 0;
      const diffUsd = theirVal - myVal;
      const tolerance = Math.max(0.50 / rate(), myVal * 0.12);

      let vClass = 'verdict-fair';
      let vTitle = '⚖️ Fair & Balanced Trade!';
      let vDesc = `Both cards are very close in value (${fmt(myVal)} vs ${fmt(theirVal)}). This is a great, balanced trade for both of you!`;

      if (myVal > 0 && theirVal > 0) {
        if (diffUsd > tolerance) {
          vClass = 'verdict-win';
          vTitle = '🎉 Great Deal For You!';
          vDesc = `Their card (${fmt(theirVal)}) is worth <b>+${fmt(diffUsd)} more</b> than yours (${fmt(myVal)}). You gain extra value!`;
        } else if (diffUsd < -tolerance) {
          vClass = 'verdict-warn';
          vTitle = "⚠️ You're Giving Away More!";
          vDesc = `Your card (${fmt(myVal)}) is worth <b>${fmt(Math.abs(diffUsd))} more</b> than theirs (${fmt(theirVal)}). Consider asking them to throw in an extra card to make it fair!`;
        }
      } else if (!myVal || !theirVal) {
        vClass = 'verdict-fair';
        vTitle = '✨ Compare by Rarity & Artwork!';
        vDesc = `Live price data was only available for one or neither card. Base your decision on card rarity, condition, and which Pokémon you love more!`;
      }

      const total = (myVal || 1) + (theirVal || 1);
      const myPct = Math.min(85, Math.max(15, (myVal / total) * 100));
      const theirPct = 100 - myPct;

      verdictHtml = `
        <div class="trade-verdict-box ${vClass}">
          <div class="verdict-title">${vTitle}</div>
          <div class="verdict-desc">${vDesc}</div>
          <div class="verdict-meter" title="Value balance: Blue = You (${myPct.toFixed(0)}%), Orange = Them (${theirPct.toFixed(0)}%)">
            <div class="meter-mine" style="width: ${myPct}%"></div>
            <div class="meter-mid"></div>
            <div class="meter-theirs" style="width: ${theirPct}%"></div>
          </div>
          <div class="trade-rarity-row">
            <div><span>Your Rarity</span><b>${esc(myCard.rarity || 'Normal')} (${myTier.label})</b></div>
            <div><span>Difference</span><b>${diffUsd >= 0 ? '+' : ''}${fmt(diffUsd)}</b></div>
            <div><span>Their Rarity</span><b>${esc(theirCard.rarity || 'Normal')} (${theirTier.label})</b></div>
          </div>
        </div>
      `;
    } else {
      verdictHtml = `
        <div class="trade-verdict-box" style="background:#f8fafc; border-color:#e2e8f0; color:var(--muted)">
          <div class="verdict-title">🤝 Ready to Compare</div>
          <div class="verdict-desc">Pick your card from your binder on the left and enter your friend's card identifier on the right to compare value and rarity!</div>
        </div>
      `;
    }

    m.innerHTML = `
      <button class="modal-close" data-close aria-label="Close">✕</button>
      <div class="trade-modal">
        <h2>🤝 Pokémon Trade Machine</h2>
        <p class="trade-subtitle">Check the market value and rarity before trading so you and your friends can make fair deals!</p>

        <div class="trade-grid">
          <!-- MY SIDE -->
          <div class="trade-side mine">
            <div class="trade-side-title">
              <span>👦 Your Offer</span>
              <span class="trade-tag">From Binder</span>
            </div>

            ${state.items.length ? `
              <select class="trade-picker-select" id="tradeMySelect">
                ${state.items.map((it) => `
                  <option value="${it.uid}" ${myItem && myItem.uid === it.uid ? 'selected' : ''}>
                    ${esc(it.card.name)} (${esc(it.card.setCode || '')} #${esc(it.card.number)}) · ${variantOf(it.variant).label} · ${unitUSD(it) ? fmt(unitUSD(it)) : '—'}
                  </option>
                `).join('')}
              </select>
            ` : `<p class="small">Your binder is currently empty! Add some cards first.</p>`}

            <div class="trade-card-body">
              <div class="trade-card-thumb ${myVar ? myVar.fx : ''}">
                <img src="${esc(myCard?.imgLarge || myCard?.imgSmall || CARD_BACK)}" alt="" onerror="this.onerror=null;this.src=CARD_BACK" />
              </div>
              <div class="trade-card-info">
                ${myCard ? `
                  <div class="trade-card-name">${esc(myCard.name)} ${myCard.lang === 'ja' ? '🇯🇵' : ''}</div>
                  ${myCard.nameJa && myCard.nameJa !== myCard.name ? `<div class="ja-name" style="font-size:0.92rem; margin:0;">${esc(myCard.nameJa)}</div>` : ''}
                  <div class="trade-card-meta">${esc(myCard.setName)} · <b>${esc(myCard.setCode || '')} #${esc(myCard.number)}</b></div>
                  <div class="pills" style="margin-top:4px;">
                    <span class="pill" style="--pill:${myTier.color}">${esc(myCard.rarity || 'Normal')}</span>
                    <span class="pill" style="--pill:#3b4cca">${myVar.icon} ${myVar.label}</span>
                    ${myItem.shiny ? `<span class="pill" style="--pill:#f59e0b">⭐ Shiny</span>` : ''}
                  </div>
                  <div class="small" style="margin-top:6px;">You own: <b>${myItem.qty}</b> ${myItem.qty === 1 ? '(Your only copy!)' : `(You will have ${myItem.qty - 1} left)`}</div>
                ` : `<p class="small">No card selected</p>`}

                <div class="trade-value-banner ${myPrice.usd ? '' : 'empty'}">
                  <span>Your Card's Value:</span>
                  <b>${myPrice.usd ? fmt(myPrice.usd) : '—'}</b>
                </div>
              </div>
            </div>
          </div>

          <!-- VS DIVIDER -->
          <div class="trade-vs-wrap">
            <div class="trade-vs">VS</div>
          </div>

          <!-- THEIR SIDE -->
          <div class="trade-side theirs">
            <div class="trade-side-title">
              <span>🤝 Their Offer</span>
              <span class="trade-tag">Friend's Card</span>
            </div>

            <form class="trade-search-row" id="tradeTheirForm">
              <input id="tradeTheirInput" placeholder="Enter code (e.g. MEW 025/165, 4/102, 069/187) or name..." value="${esc(tradeState.searchQuery)}" />
              <button class="btn btn-add" type="submit">Search</button>
            </form>

            ${tradeState.theirSearching ? `<div class="loading" style="padding:15px;"><div class="spinner"></div>Searching for card...</div>` : ''}

            ${tradeState.theirCandidates.length > 1 ? `
              <div class="small">Multiple cards found! Tap the exact artwork:</div>
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(75px, 1fr)); gap:6px; max-height:120px; overflow-y:auto; padding:4px;">
                ${tradeState.theirCandidates.slice(0, 12).map((c, idx) => `
                  <button type="button" class="btn btn-ghost" data-cand="${idx}" style="padding:4px; flex-direction:column; border-radius:8px;">
                    <img src="${esc(c.imgSmall || CARD_BACK)}" style="width:100%; aspect-ratio:63/88; border-radius:4px; object-fit:cover;" />
                    <span style="font-size:0.7rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:65px;">${esc(c.name)}</span>
                  </button>
                `).join('')}
              </div>
            ` : ''}

            <div class="trade-card-body">
              <div class="trade-card-thumb ${theirVar ? theirVar.fx : ''}">
                <img src="${esc(theirCard?.imgLarge || theirCard?.imgSmall || CARD_BACK)}" alt="" onerror="this.onerror=null;this.src=CARD_BACK" />
              </div>
              <div class="trade-card-info">
                ${theirCard ? `
                  <div class="trade-card-name">${esc(theirCard.name)} ${theirCard.lang === 'ja' ? '🇯🇵' : ''}</div>
                  ${theirCard.nameJa && theirCard.nameJa !== theirCard.name ? `<div class="ja-name" style="font-size:0.92rem; margin:0;">${esc(theirCard.nameJa)}</div>` : ''}
                  <div class="trade-card-meta">${esc(theirCard.setName)} · <b>${esc(theirCard.setCode || '')} #${esc(theirCard.number)}</b></div>
                  <div class="pills" style="margin-top:4px;">
                    <span class="pill" style="--pill:${theirTier.color}">${esc(theirCard.rarity || 'Normal')}</span>
                  </div>

                  <div class="small" style="margin-top:4px;">Is their card shiny or foil?</div>
                  <div class="trade-variants">
                    ${VARIANTS.map((v) => `
                      <button type="button" class="variant-btn ${tradeState.theirVariant === v.key ? 'on' : ''}" data-tvar="${v.key}">
                        <span>${v.icon}</span>${v.label}
                      </button>
                    `).join('')}
                    <button type="button" class="variant-btn shiny-btn ${tradeState.theirShiny ? 'on' : ''}" id="tradeTheirShiny">
                      <span>⭐</span>Shiny
                    </button>
                  </div>
                ` : `<p class="small" style="margin-top:20px;">Ask your friend for the code in the bottom corner of their card (e.g. <code>MEW 025/165</code> or <code>4/102</code>) or their card's name, then search above!</p>`}

                <div class="trade-value-banner ${theirPrice.usd ? '' : 'empty'}">
                  <span>Their Card's Value:</span>
                  <b>${theirPrice.usd ? fmt(theirPrice.usd) : '—'}</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${verdictHtml}

        <div class="trade-bottom-actions">
          <button class="btn btn-big btn-trade" id="tradeAcceptBtn" ${acceptDisabled ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            <span>🤝</span> Complete Trade &amp; Swap Cards
          </button>
          <button class="btn btn-ghost" id="tradeResetBtn">🔄 Reset Trade</button>
        </div>
      </div>
    `;

    $('#tradeMySelect')?.addEventListener('change', (e) => {
      tradeState.myItem = state.items.find((it) => it.uid === e.target.value) || null;
      renderTradeModal();
    });

    $('#tradeTheirForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#tradeTheirInput').value.trim();
      if (!q) return;
      tradeState.searchQuery = q;
      tradeState.theirSearching = true;
      tradeState.theirCandidates = [];
      renderTradeModal();

      try {
        const results = await API.searchByCode(q);
        tradeState.theirSearching = false;
        if (!results.length) {
          toast('No cards found for "' + q + '". Try card name or numbers!');
        } else if (results.length === 1) {
          const full = results[0].full || await API.getCard(results[0].id, results[0].source);
          tradeState.theirCard = full;
          tradeState.theirCandidates = [];
        } else {
          tradeState.theirCandidates = results;
          const full = results[0].full || await API.getCard(results[0].id, results[0].source);
          tradeState.theirCard = full;
        }
      } catch (err) {
        tradeState.theirSearching = false;
        toast('Search error. Try again!');
      }
      renderTradeModal();
    });

    $$('[data-cand]', m).forEach((b) => {
      b.onclick = async () => {
        const cand = tradeState.theirCandidates[Number(b.dataset.cand)];
        if (cand) {
          tradeState.theirCard = cand.full || await API.getCard(cand.id, cand.source);
          renderTradeModal();
        }
      };
    });

    $$('[data-tvar]', m).forEach((b) => {
      b.onclick = () => {
        tradeState.theirVariant = b.dataset.tvar;
        renderTradeModal();
      };
    });

    $('#tradeTheirShiny')?.addEventListener('click', () => {
      tradeState.theirShiny = !tradeState.theirShiny;
      renderTradeModal();
    });

    $('#tradeResetBtn')?.addEventListener('click', () => {
      tradeState.theirCard = null;
      tradeState.theirCandidates = [];
      tradeState.searchQuery = '';
      renderTradeModal();
    });

    $('#tradeAcceptBtn')?.addEventListener('click', () => {
      if (!tradeState.myItem || !tradeState.theirCard) return;
      const myName = tradeState.myItem.card.name;
      const theirName = tradeState.theirCard.name;

      if (!confirm(`Are you sure you want to trade your ${myName} for their ${theirName}?`)) return;

      if (tradeState.myItem.qty > 1) {
        tradeState.myItem.qty -= 1;
      } else {
        removeItem(tradeState.myItem.uid);
      }

      addItem(tradeState.theirCard, tradeState.theirVariant, 1, tradeState.theirShiny);
      confetti();
      closeModal();
      toast(`🎉 Trade Complete! ${theirName} added to your binder!`);
    });
  };

  renderTradeModal();
}

/* ---------------------------- add modal ------------------------------ */
const SETS_CACHE = 'pokebinder.sets';
async function loadSets() {
  try {
    const c = JSON.parse(localStorage.getItem(SETS_CACHE));
    if (c && Date.now() - c.at < 3 * DAY && c.list?.length) return c.list;
  } catch { /* ignore */ }
  const list = await API.getSets();
  try { localStorage.setItem(SETS_CACHE, JSON.stringify({ at: Date.now(), list })); } catch { /* ignore */ }
  return list;
}

const addState = { tab: 'code', results: [], resultsTitle: '', set: null, setFilter: '' };

function openAdd(tab = addState.tab) {
  addState.tab = tab;
  const m = openModal(`
    <div class="add-modal">
      <h2>Add a card to your binder</h2>
      <div class="tabs">
        <button class="tab ${tab === 'code' ? 'on' : ''}" data-tab="code">🔢 Card code</button>
        <button class="tab ${tab === 'set' ? 'on' : ''}" data-tab="set">📚 Pick a set</button>
        <button class="tab ${tab === 'name' ? 'on' : ''}" data-tab="name">🔍 Pokémon name</button>
        <button class="tab ${tab === 'camera' ? 'on' : ''}" data-tab="camera">📸 Camera scan</button>
      </div>
      <div id="tabBody"></div>
      <div id="results"></div>
    </div>`, 'modal-wide');
  $$('.tab', m).forEach((b) => b.onclick = () => {
    if (b.dataset.tab === 'camera') {
      openScanner();
    } else {
      addState.results = []; addState.set = null; openAdd(b.dataset.tab);
    }
  });
  const body = $('#tabBody', m);

  if (tab === 'code') {
    body.innerHTML = `
      <div class="code-help">
        <div class="mini-card">
          <div class="mini-art"></div>
          <div class="mini-text"></div><div class="mini-text short"></div>
          <div class="mini-bottom"><span class="mini-code">MEW 025/165</span></div>
        </div>
        <div>
          <p><b>Look at the bottom corner of your card.</b><br/>You'll see letters and numbers like <code>MEW 025/165</code>. Type them in!</p>
          <p class="small">Older cards don't have letters? Just type the numbers like <code>4/102</code>, or use <b>Pick a set</b>.</p>
          <div class="examples">Try: ${['MEW 025', 'SVI 198/198', 'PAF 232', '4/102', 'SWSH 020'].map((e) => `<button class="ex" data-ex="${e}">${e}</button>`).join('')}</div>
        </div>
      </div>
      <form class="search-form" id="codeForm">
        <input id="codeInput" autocomplete="off" placeholder="e.g. MEW 025/165" />
        <button class="btn btn-big btn-add" type="submit">Find it!</button>
      </form>`;
    const input = $('#codeInput', body);
    $$('.ex', body).forEach((b) => b.onclick = () => { input.value = b.dataset.ex; runSearch(() => API.searchByCode(b.dataset.ex), `Results for “${b.dataset.ex}”`); });
    $('#codeForm', body).onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim(); if (!q) return;
      runSearch(() => API.searchByCode(q), `Results for “${q}”`);
    };
    setTimeout(() => input.focus(), 50);
  }

  if (tab === 'name') {
    body.innerHTML = `
      <form class="search-form" id="nameForm">
        <input id="nameInput" autocomplete="off" placeholder="e.g. Pikachu, Charizard, Eevee…" />
        <button class="btn btn-big btn-add" type="submit">Search</button>
      </form>
      <p class="small center">Then pick the picture that looks exactly like your card.</p>`;
    const input = $('#nameInput', body);
    $('#nameForm', body).onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim(); if (!q) return;
      runSearch(() => API.searchByName(q), `Cards called “${q}”`);
    };
    setTimeout(() => input.focus(), 50);
  }

  if (tab === 'set') {
    if (addState.set) { showSetCards(addState.set, true); return; }
    body.innerHTML = `
      <form class="search-form" onsubmit="return false">
        <input id="setFilter" autocomplete="off" placeholder="Filter sets… (name or code)" value="${esc(addState.setFilter)}" />
      </form>
      <div class="set-grid" id="setGrid"><div class="loading"><div class="spinner"></div>Loading sets…</div></div>`;
    loadSets().then((sets) => {
      const grid = $('#setGrid');
      if (!grid) return;
      const draw = () => {
        const f = addState.setFilter.toLowerCase();
        const list = sets.filter((s) => !f || `${s.name} ${s.code} ${s.series}`.toLowerCase().includes(f));
        grid.innerHTML = list.map((s) => `
          <button class="set-tile" data-id="${esc(s.id)}">
            <div class="set-logo">${s.logo ? `<img loading="lazy" src="${esc(s.logo)}" alt="" onerror="this.remove()"/>` : ''}</div>
            <div class="set-name">${s.symbol ? `<img loading="lazy" src="${esc(s.symbol)}" alt="" onerror="this.remove()"/>` : ''}${esc(s.name)}</div>
            <div class="set-sub">${esc(s.code || '')} ${s.releaseDate ? '· ' + s.releaseDate.slice(0, 4) : ''} ${s.total ? '· ' + s.total + ' cards' : ''}</div>
          </button>`).join('') || '<p class="center">No sets match.</p>';
        $$('.set-tile', grid).forEach((b) => b.onclick = () => showSetCards(sets.find((s) => s.id === b.dataset.id)));
      };
      draw();
      $('#setFilter').oninput = (e) => { addState.setFilter = e.target.value; draw(); };
    }).catch(() => { const g = $('#setGrid'); if (g) g.innerHTML = '<p class="center">😕 Couldn’t load sets. Check your internet connection.</p>'; });
  }

  if (addState.results.length && tab !== 'set') drawResults();
}

async function showSetCards(set, reuse = false) {
  const sameSet = addState.set && addState.set.id === set.id;
  addState.set = set;
  if (!reuse || !sameSet) addState.setFilter2 = '';
  const body = $('#tabBody');
  body.innerHTML = `
    <div class="set-header">
      <button class="btn btn-ghost" id="backSets">‹ All sets</button>
      ${set.logo ? `<img src="${esc(set.logo)}" alt="" onerror="this.remove()"/>` : ''}
      <div><b>${esc(set.name)}</b><div class="small">${esc(set.code || '')} ${set.total ? '· ' + set.total + ' cards' : ''}</div></div>
      <input id="numFilter" placeholder="Card number or name…" autocomplete="off" value="${esc(addState.setFilter2 || '')}" />
    </div>`;
  $('#backSets').onclick = () => { addState.set = null; addState.results = []; openAdd('set'); };
  $('#numFilter').oninput = (e) => { addState.setFilter2 = e.target.value; drawResults(); };
  setTimeout(() => $('#numFilter')?.focus(), 50);
  if (reuse && sameSet && addState.results.length) { drawResults(); return; }
  await runSearch(() => API.getSetCards(set), '');
}

async function runSearch(fn, title) {
  addState.resultsTitle = title;
  const res = $('#results');
  res.innerHTML = `<div class="loading"><div class="spinner"></div>Searching the Pokédex…</div>`;
  try {
    addState.results = await fn();
    drawResults();
  } catch (e) {
    console.error(e);
    addState.results = [];
    res.innerHTML = `<div class="center"><p>😕 The card server didn't answer.</p>
      <p class="small">It can be slow sometimes – try again, or use <b>Pokémon name</b> / <b>Pick a set</b>.</p></div>`;
  }
}

function drawResults() {
  const res = $('#results');
  if (!res) return;
  let list = addState.results;
  if (addState.set && addState.setFilter2) {
    const f = addState.setFilter2.trim().toLowerCase().replace(/^0+/, '');
    list = list.filter((c) => String(c.number).toLowerCase().replace(/^([a-z]*)0+/, '$1').startsWith(f) || c.name.toLowerCase().includes(f));
  }
  if (!list.length) {
    res.innerHTML = `<div class="center"><p>🤔 No cards found.</p><p class="small">Check the code on your card, or try searching by name.</p></div>`;
    return;
  }
  res.innerHTML = `
    ${addState.resultsTitle ? `<h3 class="results-title">${esc(addState.resultsTitle)} <small>${list.length} found – tap yours!</small></h3>` : `<h3 class="results-title"><small>${list.length} cards – tap yours!</small></h3>`}
    <div class="result-grid">
      ${list.slice(0, 300).map((c, i) => `
        <button class="result" data-i="${addState.results.indexOf(c)}">
          <img loading="lazy" src="${esc(c.imgSmall || CARD_BACK)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src=CARD_BACK" />
          <div class="r-name">${esc(c.name)}</div>
          <div class="r-sub">${esc(c.setName || '')} · #${esc(c.number)}</div>
          ${state.items.some((it) => it.cardId === c.id) ? '<span class="owned">✔ Got it</span>' : ''}
        </button>`).join('')}
    </div>`;
  $$('.result', res).forEach((b) => b.onclick = () => openConfirm(addState.results[Number(b.dataset.i)]));
}

async function openConfirm(cand) {
  const m = openModal(`<div class="loading tall"><div class="spinner"></div>Getting card details…</div>`, 'modal-wide');
  let card = cand.full;
  if (!card) {
    try { card = await API.getCard(cand.id, cand.source); }
    catch { m.innerHTML = '<div class="center"><p>😕 Could not load that card.</p><button class="btn" id="back">‹ Back</button></div>'; $('#back').onclick = () => openAdd(); return; }
  }
  const avail = availableVariants(card);
  let variant = avail.length === 1 ? avail[0]
    : avail.includes('normal') ? 'normal'
    : avail.includes('holofoil') ? 'holofoil'
    : avail[0] || (/rare|holo|ex|gx|vmax|vstar|illustration/i.test(card.rarity + ' ' + card.subtypes.join(' ')) && !/^rare$/i.test(card.rarity) ? 'holofoil' : 'normal');
  let qty = 1;
  let shiny = isShinyRarity(card);

  const draw = () => {
    const v = variantOf(variant);
    const p = priceInfo(card, variant);
    const existing = state.items.find((i) => i.cardId === card.id && i.variant === variant);
    const t = primaryType(card);
    m.innerHTML = `
      <button class="modal-close" data-close aria-label="Close">✕</button>
      <div class="detail">
        <div class="detail-left">
          <div class="tilt-stage">
            <div class="tilt ${v.fx}" id="tiltCard"><img src="${esc(card.imgLarge || card.imgSmall || CARD_BACK)}" alt="${esc(card.name)}" onerror="this.onerror=null;this.src=CARD_BACK" /></div>
          </div>
          <div class="hint">Is this your card? 👀</div>
          ${cardFactsHTML(card)}
        </div>
        <div class="detail-right">
          <button class="btn btn-ghost back-btn" id="backBtn">‹ Back to results</button>
          <h2 class="detail-name">${esc(card.name)} ${card.hp ? `<span class="hp">HP ${esc(card.hp)}</span>` : ''} ${card.isOffline ? '<span class="pill" style="--pill:#64748b; font-size:0.75rem;">📶 Identified Offline</span>' : ''}</h2>
          ${card.nameJa && card.nameJa !== card.name ? `<div class="ja-name">${esc(card.nameJa)}</div>` : ''}
          <div class="pills">
            ${card.lang === 'ja' ? `<span class="pill" style="--pill:#bc002d">🇯🇵 Japanese</span>` : ''}
            <span class="pill" style="--pill:${(TYPES[t] || TYPES.Colorless).c}">${(TYPES[t] || TYPES.Colorless).e} ${t}</span>
            ${card.rarity ? `<span class="pill" style="--pill:#8a5cf6">${esc(card.rarity)}</span>` : ''}
          </div>
          <div class="small">${esc(card.setName)} · ${esc(card.setCode)} ${esc(card.number)}${card.printedTotal ? '/' + esc(card.printedTotal) : ''}</div>

          <h3>Which kind is it?</h3>
          <p class="small">Holo = the picture is shiny. Reverse Holo = everything <i>except</i> the picture is shiny.</p>
          <div class="variant-row">
            ${VARIANTS.map((vv) => {
              const pp = priceInfo(card, vv.key);
              const exists = !avail.length || avail.includes(vv.key);
              return `<button class="variant-btn ${vv.key === variant ? 'on' : ''} ${exists ? '' : 'rare'}" data-variant="${vv.key}" title="${exists ? '' : 'This finish may not exist for this card'}">
                <span>${vv.icon}</span>${vv.label}${exists && pp.exact && avail.includes(vv.key) ? `<small>${fmt(pp.usd)}</small>` : ''}
              </button>`;
            }).join('')}
            <button class="variant-btn shiny-btn ${shiny ? 'on' : ''}" id="shinyToggle"><span>⭐</span>Shiny</button>
          </div>

          <div class="qty-value">
            <div>
              <h3>How many do you have?</h3>
              <div class="stepper">
                <button id="qtyMinus">−</button><span>${qty}</span><button id="qtyPlus">＋</button>
              </div>
            </div>
            <div class="value-box">
              <div class="vb-row"><span>Worth about</span><b>${p.usd ? fmt(p.usd) : '—'}</b></div>
              <div class="vb-src">${card.isOffline ? 'Offline mode — live prices & art load once connected' : esc(p.src)}</div>
            </div>
          </div>
          ${existing ? `<p class="small">You already have ${existing.qty} of these – we'll add to that pile.</p>` : ''}
          <button class="btn btn-big btn-add full" id="confirmAdd">🎉 Put it in my binder!</button>
        </div>
      </div>`;
    attachTilt($('#tiltCard', m));
    $$('.lang-btn', m).forEach((b) => b.onclick = () => { ui.jaText = b.dataset.lang; draw(); });
    $('#backBtn', m).onclick = () => openAdd();
    $$('.variant-btn[data-variant]', m).forEach((b) => b.onclick = () => { variant = b.dataset.variant; draw(); });
    $('#shinyToggle', m).onclick = () => { shiny = !shiny; draw(); };
    $('#qtyMinus', m).onclick = () => { qty = Math.max(1, qty - 1); draw(); };
    $('#qtyPlus', m).onclick = () => { qty++; draw(); };
    $('#confirmAdd', m).onclick = () => {
      const item = addItem(card, variant, qty, shiny);
      confetti();
      showAdded(item, qty);
    };
  };
  draw();
}

function showAdded(item, qty) {
  const m = openModal(`
    <div class="added">
      <div class="added-card ${variantOf(item.variant).fx}"><img src="${esc(item.card.imgSmall || CARD_BACK)}" alt="" onerror="this.onerror=null;this.src=CARD_BACK"/></div>
      <h2>Gotcha! ${esc(item.card.name)} was added!</h2>
      <p>${qty > 1 ? `${qty} cards` : '1 card'} · ${variantOf(item.variant).label} · you now have ${item.qty}</p>
      <div class="added-actions">
        <button class="btn btn-big btn-add" id="addAnother">＋ Add another card</button>
        <button class="btn btn-big" id="doneAdding">📖 See my binder</button>
      </div>
    </div>`, 'modal-small');
  $('#addAnother', m).onclick = () => { addState.results = addState.set ? addState.results : []; openAdd(); };
  $('#doneAdding', m).onclick = () => { ui.flashUid = item.uid; closeModal(); render(); };
}

/* ---------------------------- camera scanner ------------------------- */
function openScanner() {
  stopActiveStream();
  const m = openModal(`
    <div class="scanner-modal">
      <div class="scanner-title-bar">
        <h3 class="scanner-title"><span>📸</span> Pokédex Card Scanner</h3>
      </div>

      <div class="scanner-viewfinder" id="scannerViewport">
        <video class="scanner-video" id="scannerVideo" autoplay playsinline muted></video>
        <img class="scanner-snapshot-preview hidden" id="scannerSnapshot" alt="" />
        <canvas class="scanner-canvas-hidden" id="scannerCanvas"></canvas>

        <div class="scanner-reticle">
          <div class="scanner-corner tl"></div>
          <div class="scanner-corner tr"></div>
          <div class="scanner-corner bl"></div>
          <div class="scanner-corner br"></div>
          <div class="scanner-number-target">🎯 Align bottom number (e.g. 069/187)</div>
          <div class="scanner-laser"></div>
        </div>
      </div>

      <div class="scanner-status" id="scannerStatus">
        Starting camera… 🎯 Align the Pokémon card in the frame!
      </div>

      <div class="scanner-actions">
        <button class="btn btn-big btn-scan" id="scannerSnapBtn"><span>⚡</span> Scan / Snap Picture</button>
        <button class="btn btn-big btn-ghost" id="scannerNativeBtn"><span>📁</span> Take Photo / Upload</button>
      </div>

      <!-- Quick manual fallback helper -->
      <div class="scanner-manual-box">
        <label for="scannerManualInput" class="scanner-manual-label">Or enter card code:</label>
        <div class="scanner-manual-row">
          <input id="scannerManualInput" placeholder="e.g. 069/187 or MEW 025" />
          <button class="btn btn-add" id="scannerManualBtn">Find</button>
        </div>
      </div>

      <div class="scanner-matches" id="scannerMatches"></div>
    </div>
  `, 'modal-wide');

  const video = $('#scannerVideo', m);
  const snap = $('#scannerSnapshot', m);
  const canvas = $('#scannerCanvas', m);
  const status = $('#scannerStatus', m);
  const matchesEl = $('#scannerMatches', m);
  const manualInput = $('#scannerManualInput', m);

  // Try live camera stream
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    }).then((stream) => {
      activeStream = stream;
      if (video) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
      status.innerHTML = 'Camera ready! 🎯 <b>Align the card in the frame</b>, especially the bottom number.';
    }).catch((err) => {
      console.warn('Live camera stream not permitted or unavailable:', err);
      status.innerHTML = 'Live camera stream not available. Tap <b>📁 Take Photo / Upload</b> below to snap a picture!';
      video?.classList.add('hidden');
    });
  } else {
    status.innerHTML = 'Tap <b>📁 Take Photo / Upload</b> to take a picture of your card!';
    video?.classList.add('hidden');
  }

  const showMatches = (results, detectedText = '') => {
    if (!results || !results.length) {
      status.innerHTML = detectedText
        ? `No card match found for “<b>${esc(detectedText)}</b>”. Try aiming closer or type the number below!`
        : `Couldn't detect card text. Try aiming directly at the bottom-left / bottom-right numbers.`;
      matchesEl.innerHTML = '';
      return;
    }
    status.innerHTML = `Found <b>${results.length}</b> card match${results.length === 1 ? '' : 'es'}! Tap <b>＋ Add</b> to put it in your binder:`;
    matchesEl.innerHTML = results.slice(0, 10).map((r, i) => `
      <div class="scanner-hit" data-idx="${i}">
        <div class="scanner-hit-thumb">
          <img src="${esc(r.imgSmall || CARD_BACK)}" alt="" onerror="this.onerror=null;this.src=CARD_BACK" />
        </div>
        <div class="scanner-hit-info">
          <div class="scanner-hit-name">${esc(r.name)} ${r.lang === 'ja' ? '🇯🇵' : ''}</div>
          <div class="scanner-hit-sub">${esc(r.setName || '')} · <b>${esc(r.setCode || '')} #${esc(r.number)}</b> · ${esc(r.rarity || '')}</div>
        </div>
        <button class="scanner-hit-btn" data-add="${i}">＋ Add</button>
      </div>
    `).join('');

    $$('.scanner-hit', matchesEl).forEach((hit) => {
      const idx = Number(hit.dataset.idx);
      const cand = results[idx];
      hit.onclick = () => {
        openConfirm(cand);
      };
    });
  };

  const searchDetected = async (query) => {
    status.innerHTML = `Searching card catalogue for “<b>${esc(query)}</b>”… 🔍`;
    try {
      const results = await API.searchByCode(query);
      showMatches(results, query);
    } catch (e) {
      console.warn(e);
      status.innerHTML = 'Error searching catalogue. Please try again.';
    }
  };

  const processCanvas = async () => {
    status.innerHTML = 'Analyzing card and reading text… 🔍';
    let detectedQueries = [];

    // 1. Try window.TextDetector (Shape Detection API supported in modern browsers / Android Chrome)
    if ('TextDetector' in window) {
      try {
        const detector = new window.TextDetector();
        const texts = await detector.detect(canvas);
        for (const t of texts) {
          const val = (t.rawValue || '').trim();
          const numMatch = val.match(/([a-zA-Z0-9]{2,5}\s+)?(\d{1,3})\s*[\/|I1]\s*(\d{2,3})/);
          if (numMatch) detectedQueries.push(numMatch[0]);
          if (/^[a-zA-Z0-9]{2,5}\s+\d{1,3}$/.test(val)) detectedQueries.push(val);
        }
      } catch (err) {
        console.warn('TextDetector failed:', err);
      }
    }

    if (detectedQueries.length) {
      await searchDetected(detectedQueries[0]);
      return;
    }

    // Fallback: If OCR API didn't report text, allow instant manual confirm
    status.innerHTML = `Card photo captured! 📷 Check the numbers on the bottom corner and confirm below:`;
    if (manualInput.value.trim()) {
      await searchDetected(manualInput.value.trim());
    } else {
      manualInput.focus();
    }
  };

  $('#scannerSnapBtn', m).onclick = () => {
    if (activeStream && video && !video.classList.contains('hidden') && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      snap.src = canvas.toDataURL('image/jpeg', 0.9);
      snap.classList.remove('hidden');
      video.classList.add('hidden');
      processCanvas();
    } else {
      $('#cameraInput').click();
    }
  };

  $('#scannerNativeBtn', m).onclick = () => {
    $('#cameraInput').click();
  };

  $('#cameraInput').onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      snap.src = img.src;
      snap.classList.remove('hidden');
      video?.classList.add('hidden');
      processCanvas();
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  };

  const doManual = () => {
    const q = manualInput.value.trim();
    if (q) searchDetected(q);
  };
  $('#scannerManualBtn', m).onclick = doManual;
  manualInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doManual(); } };
}

/* ---------------------------- cloud sync ------------------------------ */
let syncEventSource = null;
let isPushingSync = false;
let isPullingSync = false;

const POKE_SYNC_WORDS = ['PIKACHU', 'CHARIZARD', 'EEVEE', 'MEWTWO', 'SNORLAX', 'GENGAR', 'LUCARIO', 'SYLVEON', 'BULBASAUR', 'SQUIRTLE', 'DRAGONITE', 'RAYQUAZA', 'MIMIKYU', 'GARCHOMP'];

function generateSyncCode() {
  const word = POKE_SYNC_WORDS[Math.floor(Math.random() * POKE_SYNC_WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

function cleanFirebaseUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  if (u.endsWith('.json')) u = u.slice(0, -5);
  return u;
}

function getSyncEndpoint() {
  if (!state.sync || !state.sync.enabled || !state.sync.code || !state.sync.url) return null;
  const base = cleanFirebaseUrl(state.sync.url);
  const code = encodeURIComponent(state.sync.code.trim().toUpperCase());
  return `${base}/binders/${code}.json`;
}

async function pushToCloud({ silent = false } = {}) {
  const endpoint = getSyncEndpoint();
  if (!endpoint || isPushingSync || isPullingSync) return;
  isPushingSync = true;
  updateSyncUI('syncing');

  try {
    const payload = {
      app: 'pokebinder',
      version: 1,
      trainer: state.trainer,
      items: state.items,
      valueHistory: state.valueHistory,
      updatedAt: Date.now(),
    };

    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.sync.lastSync = Date.now();
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
    updateSyncUI('connected');
    if (!silent) toast('☁️ Synced to cloud successfully!');
  } catch (err) {
    console.warn('Push sync error:', err);
    updateSyncUI('error');
    if (!silent) toast('⚠️ Could not sync to cloud. Check your Database URL.');
  } finally {
    isPushingSync = false;
  }
}

async function pullFromCloud({ silent = false } = {}) {
  const endpoint = getSyncEndpoint();
  if (!endpoint || isPullingSync) return;
  isPullingSync = true;
  updateSyncUI('syncing');

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data) {
      await pushToCloud({ silent: true });
      return;
    }

    if (Array.isArray(data.items)) {
      state.items = data.items;
      if (data.trainer) state.trainer = data.trainer;
      if (Array.isArray(data.valueHistory)) state.valueHistory = data.valueHistory;
      state.sync.lastSync = data.updatedAt || Date.now();
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
      render();
      updateSyncUI('connected');
      if (!silent) toast(`☁️ Synced: ${data.items.length} cards loaded!`);
    }
  } catch (err) {
    console.warn('Pull sync error:', err);
    updateSyncUI('error');
    if (!silent) toast('⚠️ Could not pull from cloud. Check your Database URL.');
  } finally {
    isPullingSync = false;
  }
}

function initRealtimeSync() {
  if (syncEventSource) {
    try { syncEventSource.close(); } catch {}
    syncEventSource = null;
  }

  const endpoint = getSyncEndpoint();
  if (!endpoint || typeof EventSource === 'undefined') {
    updateSyncUI('disabled');
    return;
  }

  try {
    syncEventSource = new EventSource(endpoint);
    updateSyncUI('connected');

    syncEventSource.addEventListener('put', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload && payload.path === '/' && payload.data && Array.isArray(payload.data.items)) {
          const remote = payload.data;
          if (remote.updatedAt && remote.updatedAt > (state.sync.lastSync || 0)) {
            state.items = remote.items;
            if (remote.trainer) state.trainer = remote.trainer;
            state.sync.lastSync = remote.updatedAt;
            try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
            render();
            toast(`☁️ Real-time sync: collection updated!`);
          }
        }
      } catch (err) {
        console.warn('EventSource parse error', err);
      }
    });

    syncEventSource.onerror = () => {
      updateSyncUI('error');
    };
  } catch (err) {
    console.warn('Failed to start EventSource', err);
    updateSyncUI('error');
  }
}

function updateSyncUI(status) {
  const badge = $('#syncStatusBadge');
  if (!badge) return;
  if (!state.sync || !state.sync.enabled) {
    badge.className = 'sync-badge sync-off';
    badge.textContent = '☁️ Cloud Sync Off';
    badge.title = 'Click to configure Cloud Sync in Settings';
  } else if (status === 'syncing') {
    badge.className = 'sync-badge sync-syncing';
    badge.textContent = `☁️ Syncing (${state.sync.code})…`;
  } else if (status === 'error') {
    badge.className = 'sync-badge sync-err';
    badge.textContent = `☁️ Sync Error (${state.sync.code})`;
  } else {
    badge.className = 'sync-badge sync-on';
    badge.textContent = `☁️ Live Sync: ${state.sync.code}`;
  }
}

/* ---------------------------- QR code sync ---------------------------- */
function openQrSyncModal() {
  const m = openModal(`
    <div class="qr-sync-modal">
      <h3 style="margin-top:0; text-align:center;">📱 Sync via QR Code</h3>
      <p class="small" style="text-align:center; margin-bottom:12px;">
        Scan this QR code with another device's camera to instantly transfer your cards or link devices!
      </p>

      <div class="tabs" style="margin-bottom:12px;">
        <button class="tab on" id="qrTabCards">📦 Transfer Cards (${state.items.length})</button>
        <button class="tab" id="qrTabCloud">☁️ Pair Cloud Sync</button>
      </div>

      <div class="qr-code-box" id="qrContainer"></div>

      <div id="qrInfoText" class="small" style="text-align:center; margin-top:10px; color:#475569;">
        Transferring all ${state.items.reduce((a, b) => a + b.qty, 0)} cards directly to another device.
      </div>

      <div style="margin-top:14px; display:flex; justify-content:center; gap:8px;">
        <button class="btn btn-ghost" data-close>Done</button>
      </div>
    </div>
  `, 'modal-small');

  const renderQr = (tab) => {
    $('#qrTabCards', m).classList.toggle('on', tab === 'cards');
    $('#qrTabCloud', m).classList.toggle('on', tab === 'cloud');
    const container = $('#qrContainer', m);
    container.innerHTML = '';

    // Portable base URL (works on GitHub Pages, Netlify, custom domain, or local)
    const baseOrigin = window.location.protocol === 'file:'
      ? window.location.href.split('#')[0]
      : (window.location.origin + window.location.pathname);

    let targetUrl = '';
    if (tab === 'cards') {
      const compactItems = state.items.map((i) => [i.cardId, i.variant, i.qty, i.shiny ? 1 : 0]);
      const payload = {
        t: state.trainer,
        c: state.currency,
        i: compactItems,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      targetUrl = `${baseOrigin}#sync=${encoded}`;
      $('#qrInfoText', m).innerHTML = `📦 <b>Card Transfer QR</b>: Scans your ${state.items.length} cards directly into another device's binder without any accounts or setup!`;
    } else {
      if (!state.sync?.enabled || !state.sync?.url || !state.sync?.code) {
        container.innerHTML = `<div style="text-align:center; color:var(--muted); padding:20px;">Enable <b>Live Cloud Sync</b> below first to pair devices via QR!</div>`;
        $('#qrInfoText', m).textContent = '';
        return;
      }
      const payload = {
        s: { url: state.sync.url, code: state.sync.code },
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      targetUrl = `${baseOrigin}#sync=${encoded}`;
      $('#qrInfoText', m).innerHTML = `☁️ <b>Cloud Pairing QR</b>: Connects your other device to room <b>${esc(state.sync.code)}</b> automatically!`;
    }

    try {
      if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
          text: targetUrl,
          width: 220,
          height: 220,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
      } else {
        container.innerHTML = `<p class="small">QR library loading…</p>`;
      }
    } catch (e) {
      console.warn('QR generation error', e);
      container.innerHTML = `<p style="color:var(--red-dark); font-size:0.9rem;">Collection is very large for a single QR code. Use Cloud Sync or Export Backup instead!</p>`;
    }
  };

  $('#qrTabCards', m).onclick = () => renderQr('cards');
  $('#qrTabCloud', m).onclick = () => renderQr('cloud');

  renderQr('cards');
}

async function importCompactCards(compactItems, { replace = false } = {}) {
  if (replace) state.items = [];
  const cardIds = [...new Set(compactItems.map((row) => row[0]))];
  let cardMap = new Map();
  try {
    cardMap = await API.getCardsBulk(cardIds);
  } catch (e) {
    console.warn('bulk fetch failed', e);
  }

  for (const row of compactItems) {
    const [cardId, variant = 'normal', qty = 1, shiny = 0] = row;
    let card = cardMap.get(cardId);
    if (!card) {
      try { card = await API.getCard(cardId); } catch {}
    }
    if (card) {
      const existing = state.items.find((i) => i.cardId === cardId && i.variant === variant);
      if (existing) {
        existing.qty += qty;
        if (shiny) existing.shiny = true;
      } else {
        addItem(card, variant, qty, Boolean(shiny));
      }
    }
  }
  recordValue();
  save();
  render();
}

async function checkUrlSyncPayload() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('sync=')) return;
  try {
    const raw = hash.split('sync=')[1];
    if (!raw) return;
    const jsonStr = decodeURIComponent(escape(atob(raw)));
    const payload = JSON.parse(jsonStr);
    if (!payload) return;

    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {}

    if (payload.s && !payload.i) {
      state.sync = { enabled: true, url: payload.s.url, code: payload.s.code, lastSync: 0 };
      save();
      initRealtimeSync();
      pullFromCloud({ silent: false });
      toast(`☁️ Paired to Cloud Sync room: ${payload.s.code}!`);
      return;
    }

    if (Array.isArray(payload.i)) {
      const cardCount = payload.i.reduce((acc, row) => acc + (row[2] || 1), 0);
      const m = openModal(`
        <div class="sync-receive-modal">
          <div style="font-size:3rem; text-align:center;">📱⚡</div>
          <h2 style="text-align:center; margin-top:0;">QR Code Sync Received!</h2>
          <p style="text-align:center; font-size:1.05rem; margin:0;">
            Received <b>${cardCount} card${cardCount === 1 ? '' : 's'}</b> from <i>${esc(payload.t || 'another device')}</i>.
          </p>
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px;">
            <button class="btn btn-big btn-add" id="syncMergeBtn">✨ Merge into my binder</button>
            <button class="btn btn-big btn-ghost" id="syncReplaceBtn">🔄 Replace my binder entirely</button>
            <button class="btn btn-ghost" data-close>Cancel</button>
          </div>
        </div>
      `, 'modal-small');

      $('#syncMergeBtn', m).onclick = async () => {
        closeModal();
        toast('Importing cards…');
        await importCompactCards(payload.i, { replace: false });
        if (payload.s && payload.s.url && payload.s.code) {
          state.sync = { enabled: true, url: payload.s.url, code: payload.s.code, lastSync: Date.now() };
          initRealtimeSync();
        }
        confetti();
        toast(`🎉 Synced! Added ${cardCount} cards to your binder.`);
      };

      $('#syncReplaceBtn', m).onclick = async () => {
        closeModal();
        toast('Replacing binder…');
        await importCompactCards(payload.i, { replace: true });
        if (payload.t) state.trainer = payload.t;
        if (payload.c) state.currency = payload.c;
        if (payload.s && payload.s.url && payload.s.code) {
          state.sync = { enabled: true, url: payload.s.url, code: payload.s.code, lastSync: Date.now() };
          initRealtimeSync();
        }
        confetti();
        toast(`🎉 Synced! Binder replaced with ${cardCount} cards.`);
      };
    }
  } catch (err) {
    console.warn('Failed to parse sync payload from URL hash', err);
  }
}

/* ---------------------------- settings ------------------------------- */
function openSettings() {
  const m = openModal(`
    <div class="settings">
      <h2>⚙️ Settings</h2>
      <label class="field"><span>Show money in</span>
        <select id="curSel">${Object.entries(CURRENCIES).map(([k, l]) => `<option value="${k}" ${k === state.currency ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <p class="small">Prices come in US Dollars (TCGplayer) and Euros (Cardmarket) and are converted using today's exchange rate${state.ratesDate ? ` (${state.ratesDate})` : ''}.</p>

      <label class="field"><span>Pokémon TCG API key <i>(optional)</i></span>
        <input id="keyInput" value="${esc(state.apiKey)}" placeholder="Paste key from dev.pokemontcg.io" />
      </label>
      <p class="small">Not needed! But a free key from <a href="https://dev.pokemontcg.io" target="_blank" rel="noopener">dev.pokemontcg.io</a> makes searches faster and allows more of them.</p>

      <!-- 🔄 Device Sync Section -->
      <h3>🔄 Device Sync</h3>

      <!-- QR Code Sync (for smaller binders) -->
      <div class="sync-settings-card" style="border-color:#3b4cca; background:#f0f4ff;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="font-weight:700; font-size:1.05rem; color:#1e293b; display:flex; align-items:center; gap:6px;">
            <span>📱 QR Code Sync (for smaller binders)</span>
          </div>
          <button class="btn btn-trade" id="settingsQrBtn" type="button" style="padding:6px 14px; font-size:0.9rem;">
            <span>📱</span> Show QR Code
          </button>
        </div>
        <p class="small" style="margin:6px 0 0; color:#475569;">
          <b>No setup, no accounts!</b> Scan the QR code with another device's camera to instantly transfer your cards or link devices.
        </p>
      </div>

      <!-- Cloud Sync (for larger binders) -->
      <div class="sync-settings-card ${state.sync.enabled ? 'active' : ''}" id="syncCard">
        <div class="sync-toggle-row">
          <label class="sync-toggle-label" for="syncToggle">
            <span>☁️ Cloud Sync (for larger binders)</span>
          </label>
          <input type="checkbox" id="syncToggle" ${state.sync.enabled ? 'checked' : ''} style="width:22px; height:22px; cursor:pointer;" />
        </div>
        <p class="small" style="margin:0;">Whenever cards are added or updated on any device, all connected devices update automatically in real time!</p>

        <div id="syncSettingsBody" class="${state.sync.enabled ? '' : 'hidden'}" style="display:flex; flex-direction:column; gap:10px; margin-top:6px;">
          <label class="field" style="margin:0;">
            <span>Secret Sync Room Code</span>
            <div class="sync-code-input-group">
              <input id="syncCodeInput" value="${esc(state.sync.code || generateSyncCode())}" placeholder="e.g. PIKACHU-4821" maxlength="24" />
              <button class="btn btn-ghost" id="syncGenBtn" type="button" title="Generate a fun new code">🎲 New Code</button>
            </div>
          </label>
          <p class="small" style="margin:0;">Enter this exact code on your other devices to share the same binder.</p>

          <label class="field" style="margin:0;">
            <span>Firebase Database URL</span>
            <input id="syncUrlInput" value="${esc(state.sync.url)}" placeholder="https://your-project-default-rtdb.firebaseio.com" />
          </label>

          <details class="sync-guide-box">
            <summary style="cursor:pointer; font-weight:700; color:var(--blue);">📖 2-minute free setup instructions (Click to view)</summary>
            <ol>
              <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener"><b>console.firebase.google.com</b></a> (100% free with any Google/Gmail account).</li>
              <li>Click <b>Create a project</b> (name it anything, e.g. <i>"My Pokemon Sync"</i>).</li>
              <li>In the left sidebar, click <b>Build → Realtime Database</b>, then click <b>Create Database</b>.</li>
              <li>Choose <b>"Start in test mode"</b> (allows your devices to read/write).</li>
              <li>Copy the database URL shown at the top (e.g. <code>https://your-project-default-rtdb.firebaseio.com</code>) and paste it here!</li>
            </ol>
          </details>

          <div class="sync-action-btns">
            <button class="btn btn-add" id="syncNowBtn" type="button">🔄 Test &amp; Sync Now</button>
            <button class="btn btn-ghost" id="syncPushBtn" type="button">⬆️ Push to Cloud</button>
            <button class="btn btn-ghost" id="syncPullBtn" type="button">⬇️ Pull from Cloud</button>
          </div>

          <div id="syncStatusMsg" class="small" style="font-weight:600; color:${state.sync.lastSync ? '#15803d' : '#64748b'};">
            ${state.sync.lastSync ? `✅ Last synced: ${new Date(state.sync.lastSync).toLocaleTimeString()}` : 'Ready to connect.'}
          </div>
        </div>
      </div>

      <h3>💾 Manual Backup</h3>
      <p class="small">You can also download a backup file anytime.</p>
      <div class="row">
        <button class="btn" id="exportBtn">⬇️ Download backup</button>
        <button class="btn" id="importBtn">⬆️ Load backup</button>
      </div>

      <h3>Danger zone</h3>
      <button class="btn btn-danger" id="wipeBtn">🗑️ Delete my whole collection</button>

      <p class="small credits">Card data &amp; images: <a href="https://pokemontcg.io" target="_blank" rel="noopener">Pokémon TCG API</a> and
        <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a>. Prices from TCGplayer &amp; Cardmarket. Exchange rates: Frankfurter.
        Pokémon and its trademarks are © Nintendo, Creatures, GAME FREAK and The Pokémon Company. Not affiliated.</p>
    </div>`, 'modal-small');

  $('#curSel', m).onchange = (e) => { state.currency = e.target.value; save(); render(); };
  $('#keyInput', m).onchange = (e) => { state.apiKey = e.target.value.trim(); API.setKey(state.apiKey); save(); toast('API key saved'); };
  $('#exportBtn', m).onclick = exportData;
  $('#importBtn', m).onclick = () => $('#importFile').click();
  $('#settingsQrBtn', m).onclick = openQrSyncModal;
  $('#wipeBtn', m).onclick = () => {
    if (confirm('Delete EVERY card in your binder? This cannot be undone.') && confirm('Are you really sure? Maybe download a backup first!')) {
      state.items = []; state.valueHistory = []; save(); closeModal(); render(); toast('Collection cleared');
    }
  };

  const syncToggle = $('#syncToggle', m);
  const syncCard = $('#syncCard', m);
  const syncBody = $('#syncSettingsBody', m);
  const syncCode = $('#syncCodeInput', m);
  const syncUrl = $('#syncUrlInput', m);
  const syncMsg = $('#syncStatusMsg', m);

  syncToggle.onchange = () => {
    state.sync.enabled = syncToggle.checked;
    if (state.sync.enabled && !state.sync.code) {
      state.sync.code = syncCode.value.trim().toUpperCase() || generateSyncCode();
      syncCode.value = state.sync.code;
    }
    syncCard.classList.toggle('active', state.sync.enabled);
    syncBody.classList.toggle('hidden', !state.sync.enabled);
    save();
    if (state.sync.enabled) {
      initRealtimeSync();
      pullFromCloud({ silent: false });
    } else {
      initRealtimeSync();
    }
  };

  $('#syncGenBtn', m).onclick = () => {
    const nc = generateSyncCode();
    syncCode.value = nc;
    state.sync.code = nc;
    save();
    if (state.sync.enabled) initRealtimeSync();
  };

  syncCode.onchange = () => {
    state.sync.code = syncCode.value.trim().toUpperCase();
    syncCode.value = state.sync.code;
    save();
    if (state.sync.enabled) {
      initRealtimeSync();
      pullFromCloud({ silent: false });
    }
  };

  syncUrl.onchange = () => {
    state.sync.url = cleanFirebaseUrl(syncUrl.value);
    syncUrl.value = state.sync.url;
    save();
    if (state.sync.enabled) {
      initRealtimeSync();
      pullFromCloud({ silent: false });
    }
  };

  $('#syncNowBtn', m).onclick = async () => {
    state.sync.code = syncCode.value.trim().toUpperCase();
    state.sync.url = cleanFirebaseUrl(syncUrl.value);
    save();
    syncMsg.textContent = 'Connecting and syncing…';
    initRealtimeSync();
    await pullFromCloud({ silent: false });
    syncMsg.textContent = state.sync.lastSync ? `✅ Synced at ${new Date(state.sync.lastSync).toLocaleTimeString()}` : 'Synced!';
  };

  $('#syncPushBtn', m).onclick = async () => {
    state.sync.code = syncCode.value.trim().toUpperCase();
    state.sync.url = cleanFirebaseUrl(syncUrl.value);
    save();
    syncMsg.textContent = 'Pushing local collection to cloud…';
    await pushToCloud({ silent: false });
    syncMsg.textContent = `✅ Pushed ${state.items.length} cards to cloud!`;
  };

  $('#syncPullBtn', m).onclick = async () => {
    state.sync.code = syncCode.value.trim().toUpperCase();
    state.sync.url = cleanFirebaseUrl(syncUrl.value);
    save();
    syncMsg.textContent = 'Pulling collection from cloud…';
    await pullFromCloud({ silent: false });
    syncMsg.textContent = `✅ Pulled ${state.items.length} cards from cloud!`;
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'pokebinder', version: 1, exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pokemon-binder-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded 💾');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.items)) throw new Error('bad file');
      if (!confirm(`Load ${data.items.length} entries from this backup? This replaces the collection on this device.`)) return;
      const { app, version, exported, ...rest } = data;
      state = { ...defaults(), ...rest, prefs: { ...defaults().prefs, ...(rest.prefs || {}) } };
      API.setKey(state.apiKey);
      save(); closeModal(); render(); toast('Backup loaded ✅');
    } catch (e) { alert('That file doesn’t look like a binder backup.'); }
  };
  reader.readAsText(file);
}

/* ------------------------------ events ------------------------------- */
function bindEvents() {
  $('#syncStatusBadge')?.addEventListener('click', openSettings);
  $('#scanBtn')?.addEventListener('click', openScanner);
  $('#emptyScanBtn')?.addEventListener('click', openScanner);
  $('#tradeBtn').onclick = () => openTrade();
  $('#addBtn').onclick = () => { addState.results = []; addState.set = null; openAdd('code'); };
  $('#emptyAddBtn').onclick = () => openAdd('code');
  $('#refreshBtn').onclick = () => refreshPrices();
  $('#settingsBtn').onclick = openSettings;
  $('#statValueBtn').onclick = () => openValue();

  const title = $('#trainerTitle');
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => {
    state.trainer = title.textContent.trim().slice(0, 40) || 'My Pokémon Binder';
    save(); render();
  });

  let st;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(st);
    st = setTimeout(() => { ui.search = e.target.value; ui.page = 0; render(); }, 120);
  });
  $('#sortSelect').value = ui.sort;
  $('#sortSelect').onchange = (e) => { ui.sort = e.target.value; ui.page = 0; state.prefs.sort = ui.sort; save(); render(); };
  $$('.vt-btn').forEach((b) => b.onclick = () => { ui.view = b.dataset.view; state.prefs.view = ui.view; state.prefs.explicitView = true; save(); render(); });

  $('.filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const set = ui[c.dataset.group];
    const key = c.dataset.group === 'gens' ? Number(c.dataset.key) : c.dataset.key;
    set.has(key) ? set.delete(key) : set.add(key);
    ui.page = 0; render();
  });
  $('#clearFiltersBtn').onclick = () => {
    ui.types.clear(); ui.gens.clear(); ui.variants.clear(); ui.search = ''; $('#searchInput').value = ''; render();
  };

  bindPocketTilt($('#binderSpread'));
  bindPocketTilt($('#gridView'));

  let downPos = null;
  let downUid = null;
  let lastOpenUid = null;
  let lastOpenTime = 0;

  function safeOpenDetail(uid) {
    if (!uid) return;
    const now = Date.now();
    if (lastOpenUid === uid && now - lastOpenTime < 400) return;
    lastOpenUid = uid;
    lastOpenTime = now;
    openDetail(uid);
  }

  // Pointer down: track start position on card or its pocket sleeve
  $('#main').addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.card-tile') || e.target.closest('.pocket')?.querySelector('.card-tile');
    if (tile && tile.dataset.uid) {
      downPos = { x: e.clientX, y: e.clientY, time: Date.now() };
      downUid = tile.dataset.uid;
    } else {
      downPos = null;
      downUid = null;
    }
  });

  // Pointer up: if movement was small (< 18px), trigger open immediately with 0 delay!
  $('#main').addEventListener('pointerup', (e) => {
    if (!downUid || !downPos) return;
    const dx = Math.abs(e.clientX - downPos.x);
    const dy = Math.abs(e.clientY - downPos.y);
    const dt = Date.now() - downPos.time;
    const uid = downUid;
    downPos = null;
    downUid = null;
    if (dx < 18 && dy < 18 && dt < 650) {
      safeOpenDetail(uid);
    }
  });

  // Standard click as safety net
  $('#main').addEventListener('click', (e) => {
    const tile = e.target.closest('.card-tile') || e.target.closest('.pocket')?.querySelector('.card-tile');
    if (tile && tile.dataset.uid) safeOpenDetail(tile.dataset.uid);
  });

  $('#pagePrev').onclick = () => turnPage(-1);
  $('#pageNext').onclick = () => turnPage(1);
  $('#pageSlider').oninput = (e) => {
    const np = Number(e.target.value);
    const dir = np > ui.page ? 'turn-next' : 'turn-prev';
    ui.page = np; renderBinder(visibleItems(), dir);
  };

  // swipe pages on touch screens
  let sx = null;
  const spread = $('#binderSpread');
  spread.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  spread.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) turnPage(dx < 0 ? 1 : -1);
  });

  document.addEventListener('keydown', (e) => {
    const modalOpen = !$('#modalRoot').classList.contains('hidden');
    if (e.key === 'Escape' && modalOpen) closeModal();
    if (modalOpen || /input|select|textarea/i.test(e.target.tagName) || e.target.isContentEditable) return;
    if (ui.view === 'binder' && e.key === 'ArrowRight') turnPage(1);
    if (ui.view === 'binder' && e.key === 'ArrowLeft') turnPage(-1);
    if (ui.view === 'pokedex') {
      const list = visibleItems();
      if (!list.length) return;
      if (e.key === 'ArrowRight') { ui.pokedexIndex = clamp(ui.pokedexIndex + 1, 0, list.length - 1); renderPokedex(list); }
      if (e.key === 'ArrowLeft') { ui.pokedexIndex = clamp(ui.pokedexIndex - 1, 0, list.length - 1); renderPokedex(list); }
      if (e.key === 'ArrowDown') { ui.pokedexIndex = clamp(ui.pokedexIndex + 5, 0, list.length - 1); renderPokedex(list); }
      if (e.key === 'ArrowUp') { ui.pokedexIndex = clamp(ui.pokedexIndex - 5, 0, list.length - 1); renderPokedex(list); }
    }
  });

  $('#modalRoot').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  $('#importFile').onchange = (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!state.prefs.explicitView) {
        const mob = isMobileScreen();
        const nextV = mob ? 'pokedex' : 'binder';
        if (ui.view !== nextV) {
          ui.view = nextV;
          render();
          return;
        }
      }
      if (ui.view === 'binder') render();
    }, 150);
  });
}

/* ------------------------------- boot -------------------------------- */
bindEvents();
recordValue();
save();
render();
initRealtimeSync();
checkUrlSyncPayload();
if (state.sync && state.sync.enabled && state.sync.code && state.sync.url) {
  pullFromCloud({ silent: true });
}

// Fresh exchange rates once a day, fresh prices twice a day.
(async () => {
  if (state.ratesDate !== todayStr()) {
    try { state.rates = { ...DEFAULT_RATES, ...(await API.getRates()) }; state.ratesDate = todayStr(); save(); render(); } catch { /* offline */ }
  }
  if (state.items.length && Date.now() - state.lastRefresh > 12 * 3600 * 1000) refreshPrices({ silent: true });
})();
