/* =========================================================================
   api.js — talks to free Pokémon TCG data sources + offline catalog.

   Primary: TCGdex (https://tcgdex.dev / https://api.tcgdex.net/v2/en)
            - 100% free, no API key needed
            - High-res card images (WebP/PNG)
            - Live TCGplayer (USD) & Cardmarket (EUR) prices
            - English AND Japanese cards (https://api.tcgdex.net/v2/ja)
   Offline: Built-in local catalogs
            - card-index.js    → 23,000+ English cards & sets
            - card-index-ja.js → 13,000+ Japanese cards & sets + JP→EN Pokémon names
   ========================================================================= */

const API = (() => {
  const BASE = 'https://api.tcgdex.net/v2/';
  const FX = 'https://api.frankfurter.app/latest?from=USD&to=GBP,EUR,CAD,AUD';
  const CACHE_KEY = 'pokebinder.card_cache.v2'; // v2 = includes attacks / abilities / evolves-from
  try { localStorage.removeItem('pokebinder.card_cache'); } catch { /* ignore */ }

  // Common English set code abbreviations mapped to TCGdex set IDs
  const SET_ABBR = {
    'MEW': 'sv03.5', 'SVI': 'sv01', 'PAL': 'sv02', 'OBF': 'sv03', 'PAR': 'sv04', 'PAF': 'sv04.5',
    'TEF': 'sv05', 'TWM': 'sv06', 'SFA': 'sv06.5', 'SCR': 'sv07', 'SSP': 'sv08', 'PRE': 'sv08.5',
    'JTG': 'sv09', 'DRI': 'sv10', 'WFL': 'sv10.5w', 'BBL': 'sv10.5b',
    'CRZ': 'swsh12.5', 'SIT': 'swsh12', 'LOR': 'swsh11', 'PGO': 'swsh10.5', 'ASR': 'swsh10',
    'BRS': 'swsh9', 'FST': 'swsh8', 'EVS': 'swsh7', 'CRE': 'swsh6', 'BST': 'swsh5', 'SHF': 'swsh4.5',
    'VIV': 'swsh4', 'CPA': 'swsh3.5', 'DAA': 'swsh3', 'RCL': 'swsh2', 'SSH': 'swsh1',
    'SWSH': 'swshp', 'SVP': 'svp', 'SMP': 'smp', 'XYP': 'xyp', 'BWP': 'bwp',
    'BS': 'base1', 'JU': 'base2', 'FO': 'base3', 'B2': 'base4', 'TR': 'base5',
    'G1': 'gym1', 'G2': 'gym2', 'N1': 'neo1', 'N2': 'neo2', 'N3': 'neo3', 'N4': 'neo4', 'LC': 'lc'
  };

  // English names for popular Japanese sets (so a 9-year-old can read them!)
  const JA_SET_EN = {
    SV1S: 'Scarlet ex', SV1V: 'Violet ex', SV1a: 'Triplet Beat', SV2P: 'Snow Hazard', SV2D: 'Clay Burst',
    SV2a: 'Pokémon Card 151', SV3: 'Ruler of the Black Flame', SV3a: 'Raging Surf', SV4K: 'Ancient Roar',
    SV4M: 'Future Flash', SV4a: 'Shiny Treasure ex', SV5K: 'Wild Force', SV5M: 'Cyber Judge', SV5a: 'Crimson Haze',
    SV6: 'Mask of Change', SV6a: 'Night Wanderer', SV7: 'Stellar Miracle', SV7a: 'Paradise Dragona',
    SV8: 'Super Electric Breaker', SV8a: 'Terastal Festival ex', SV9: 'Battle Partners', SV9a: 'Heat Wave Arena',
    SV10: 'Glory of Team Rocket', SV11B: 'Black Bolt', SV11W: 'White Flare', 'SV-P': 'Scarlet & Violet Promos',
    M1L: 'Mega Brave', M1S: 'Mega Symphonia', M2: 'Inferno X', M2a: 'MEGA Dream ex',
    S1W: 'Sword', S1H: 'Shield', S1a: 'VMAX Rising', S2: 'Rebellion Crash', S2a: 'Explosive Walker',
    S3: 'Infinity Zone', S3a: 'Legendary Heartbeat', S4: 'Amazing Volt Tackle', S4a: 'Shiny Star V',
    S5I: 'Single Strike Master', S5R: 'Rapid Strike Master', S5a: 'Matchless Fighters', S6H: 'Silver Lance',
    S6K: 'Jet-Black Spirit', S6a: 'Eevee Heroes', S7D: 'Skyscraping Perfection', S7R: 'Blue Sky Stream',
    S8: 'Fusion Arts', S8a: '25th Anniversary Collection', S8b: 'VMAX Climax', S9: 'Star Birth', S9a: 'Battle Region',
    S10D: 'Time Gazer', S10P: 'Space Juggler', S10a: 'Dark Phantasma', S10b: 'Pokémon GO', S11: 'Lost Abyss',
    S11a: 'Incandescent Arcana', S12: 'Paradigm Trigger', S12a: 'VSTAR Universe',
    PMCG1: 'Base Set (Japanese)', PMCG2: 'Jungle (Japanese)', PMCG3: 'Fossil (Japanese)', PMCG4: 'Team Rocket (Japanese)',
  };

  let apiKey = '';
  const setKey = (k) => { apiKey = (k || '').trim(); };

  /* ---------------------------- local card cache ---------------------------- */
  function getCachedCard(id) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return cache[id] || null;
    } catch { return null; }
  }

  function setCachedCard(id, card) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      cache[id] = card;
      // keep cache tidy if it exceeds 600 items
      const keys = Object.keys(cache);
      if (keys.length > 600) delete cache[keys[0]];
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* ignore quota */ }
  }

  async function fetchJSON(url, opts = {}, timeout = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  const dex = (path, lang = 'en') => fetchJSON(BASE + lang + path);

  /* ------------------------ Japanese helpers ------------------------ */
  const HAS_JA = /[\u3040-\u30ff\u3400-\u9fff]/;

  function jaSet(id) {
    const low = String(id || '').toLowerCase();
    return (window.JA_SETS || []).find((s) => s.id.toLowerCase() === low) || null;
  }

  const jaCardCache = {};
  function jaCardsOf(setId) {
    if (jaCardCache[setId]) return jaCardCache[setId];
    const raw = (window.JA_CARDS || {})[setId] || '';
    const map = {};
    raw.split(';').forEach((pair) => {
      const i = pair.indexOf('|');
      if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1);
    });
    return (jaCardCache[setId] = map);
  }

  const jaSetName = (s) => (s ? (JA_SET_EN[s.id] || s.name) : '');

  let speciesList = null;
  function species() {
    if (!speciesList) {
      speciesList = (window.JA_NAMES || [])
        .map(([ja, en], i) => ({ ja, en, dex: i + 1 }))
        .filter((s) => s.ja && s.ja.length >= 2)
        .sort((a, b) => b.ja.length - a.ja.length);
    }
    return speciesList;
  }

  const JA_PREFIX = [
    ['ロケット団の', "Team Rocket's "], ['アローラ', 'Alolan '], ['ガラル', 'Galarian '], ['ヒスイ', 'Hisuian '],
    ['パルデア', 'Paldean '], ['メガ', 'Mega '], ['ダーク', 'Dark '], ['ライト', 'Light '], ['ひかる', 'Shining '],
    ['かがやく', 'Radiant '], ['テラスタル', 'Tera '], ['リーリエの', "Lillie's "], ['マリィの', "Marnie's "],
    ['ホップの', "Hop's "], ['Nの', "N's "], ['シロナの', "Cynthia's "], ['エリカの', "Erika's "], ['カスミの', "Misty's "],
    ['タケシの', "Brock's "], ['サカキの', "Giovanni's "], ['ナツメの', "Sabrina's "], ['イーサンの', "Ethan's "],
    ['スグリの', "Kieran's "], ['ペパーの', "Arven's "], ['ネモの', "Nemona's "], ['ボタンの', "Penny's "],
    ['ダイゴの', "Steven's "], ['アイリスの', "Iris's "], ['レッドの', "Red's "], ['ブルーの', "Blue's "],
  ];
  const JA_SUFFIX = [
    [/[（(]デルタ種[)）]/, ' δ'], [/プリズムスター/, ' ◇'], [/[（(]?色違い[)）]?/, ' (Shiny)'], [/^([XY])(ex|EX|GX)$/, '$1 $2'],
  ];

  /** Translate a Japanese card name to English, e.g. ニンフィアex → Sylveon ex. */
  function translateJa(name) {
    let n = String(name || '').normalize('NFKC').trim();
    if (!HAS_JA.test(n)) return { en: n, dex: null };
    let hit = null, idx = -1;
    for (const s of species()) {
      idx = n.indexOf(s.ja);
      if (idx >= 0) { hit = s; break; }
    }
    if (!hit) return { en: n, dex: null };
    let before = n.slice(0, idx);
    let after = n.slice(idx + hit.ja.length);
    JA_PREFIX.forEach(([ja, en]) => { before = before.replace(ja, en); });
    JA_SUFFIX.forEach(([re, en]) => { after = after.replace(re, en); });
    after = after.trim();
    if (after && /^[A-Za-z0-9]/.test(after)) after = ' ' + after;
    const en = (before + hit.en + after).replace(/\s+/g, ' ').trim();
    return { en, dex: hit.dex };
  }

  /** English Pokémon name → Japanese name (for searching Japanese cards by English name). */
  function jaNameFor(en) {
    const t = String(en || '').toLowerCase().trim();
    if (!t) return null;
    const list = window.JA_NAMES || [];
    const exact = list.find(([, e]) => e.toLowerCase() === t);
    if (exact) return exact[0];
    const starts = list.find(([, e]) => e.toLowerCase().startsWith(t));
    return starts ? starts[0] : null;
  }

  /* ---------------------------- normalisers ---------------------------- */

  function dexPricing(p = {}) {
    const tcg = {};
    const tp = p.tcgplayer || {};
    const mapT = {
      normal: 'normal', holo: 'holofoil', holofoil: 'holofoil', reverse: 'reverseHolofoil',
      'reverse-holofoil': 'reverseHolofoil', '1st-edition': '1stEditionNormal',
      '1st-edition-holofoil': '1stEditionHolofoil', unlimited: 'normal', 'unlimited-holofoil': 'holofoil'
    };
    Object.entries(tp).forEach(([k, v]) => {
      if (v && typeof v === 'object' && mapT[k]) {
        tcg[mapT[k]] = { low: v.lowPrice, mid: v.midPrice, high: v.highPrice, market: v.marketPrice ?? v.midPrice };
      }
    });
    const c = p.cardmarket || {};
    const cm = {
      averageSellPrice: c.avg, lowPrice: c.low, trendPrice: c.trend,
      avg1: c.avg1, avg7: c.avg7, avg30: c.avg30,
      reverseHoloTrend: c['trend-holo'] || null, reverseHoloSell: c['avg-holo'],
      reverseHoloAvg1: c['avg1-holo'], reverseHoloAvg7: c['avg7-holo'], reverseHoloAvg30: c['avg30-holo'],
    };
    return { tcg, tcgUrl: '', tcgUpdated: tp.updated || '', cm, cmUrl: '', cmUpdated: c.updated || '' };
  }

  const cleanAttacks = (list) => (list || []).map((a) => ({
    name: a.name || '', cost: a.cost || [], damage: a.damage != null ? String(a.damage) : '', effect: a.effect || '',
  }));
  const cleanAbilities = (list) => (list || []).map((a) => ({ name: a.name || '', type: a.type || 'Ability', effect: a.effect || '' }));

  function fromDex(c, lang = 'en') {
    const s = c.set || {};
    const img = c.image ? c.image : '';
    const isJa = lang === 'ja';
    const jset = isJa ? jaSet(s.id) : null;
    const card = {
      id: isJa ? `ja:${c.id}` : c.id,
      lang,
      source: 'dex',
      name: c.name,
      nameJa: '',
      number: c.localId,
      setId: s.id || '',
      setName: isJa ? (JA_SET_EN[s.id] || s.name || '') : (s.name || ''),
      setNameJa: isJa ? (s.name || '') : '',
      setCode: isJa ? (s.id || '') : (s.abbreviation?.official || s.id || '').toUpperCase(),
      series: s.serie?.name || '',
      releaseDate: s.releaseDate || '',
      printedTotal: s.cardCount?.official || s.cardCount?.total || jset?.official || '',
      setSymbol: s.symbol ? s.symbol + '.png' : '',
      imgSmall: img ? img + '/low.webp' : '',
      imgLarge: img ? img + '/high.webp' : '',
      types: c.types || [],
      supertype: c.category === 'Pokemon' ? 'Pokémon' : (c.category || ''),
      subtypes: [c.stage, c.trainerType, c.energyType, c.suffix].filter(Boolean),
      stage: c.stage || '',
      rarity: c.rarity || 'Common',
      dex: c.dexId || [],
      hp: c.hp ? String(c.hp) : '',
      artist: c.illustrator || '',
      evolveFrom: c.evolveFrom || '',
      description: c.description || '',
      effect: c.effect || '',
      attacks: cleanAttacks(c.attacks),
      abilities: cleanAbilities(c.abilities),
      weaknesses: c.weaknesses || [],
      resistances: c.resistances || [],
      retreat: c.retreat ?? null,
      regulationMark: c.regulationMark || '',
      variants: c.variants || null,
      prices: dexPricing(c.pricing),
      isOffline: false,
    };
    if (isJa) {
      const t = translateJa(c.name);
      card.nameJa = c.name;
      card.name = t.en;
      if (t.dex && !card.dex.length) card.dex = [t.dex];
      if (card.evolveFrom) card.evolveFrom = translateJa(card.evolveFrom).en;
    }
    return card;
  }

  /** For a Japanese card, find the matching English printing to borrow English attack text. */
  async function enrichJa(card) {
    if (card.lang !== 'ja' || card.supertype !== 'Pokémon' || HAS_JA.test(card.name)) return card;
    try {
      const q = `/cards?name=eq:${encodeURIComponent(card.name)}${card.hp ? `&hp=eq:${card.hp}` : ''}`;
      const list = await dex(q);
      if (!Array.isArray(list) || !list.length) return card;
      const fulls = (await Promise.all(list.slice(0, 5).map((b) => dex(`/cards/${encodeURIComponent(b.id)}`).catch(() => null)))).filter(Boolean);
      const dmg = (arr) => (arr || []).map((a) => String(a.damage ?? '')).join(',');
      const score = (e) => (e.illustrator === card.artist ? 3 : 0)
        + (dmg(e.attacks) === dmg(card.attacks) ? 3 : 0)
        + ((e.attacks || []).length === card.attacks.length ? 1 : 0)
        + ((e.abilities || []).length === card.abilities.length ? 1 : 0)
        + (e.retreat === card.retreat ? 1 : 0)
        + (e.rarity === card.rarity ? 1 : 0);
      fulls.sort((a, b) => score(b) - score(a));
      const e = fulls[0];
      if (!e) return card;
      card.english = {
        id: e.id, setName: e.set?.name || '', number: e.localId,
        attacks: cleanAttacks(e.attacks), abilities: cleanAbilities(e.abilities), description: e.description || '',
      };
      if (e.evolveFrom) card.evolveFrom = e.evolveFrom;
      if (!card.dex.length && e.dexId) card.dex = e.dexId;
    } catch { /* English text is a bonus — ignore failures */ }
    return card;
  }

  function briefDex(c, setName = '', lang = 'en') {
    const img = c.image ? c.image + '/low.webp' : '';
    const isJa = lang === 'ja';
    return {
      id: isJa ? `ja:${c.id}` : c.id,
      lang,
      source: 'dex',
      name: isJa ? translateJa(c.name).en : c.name,
      nameJa: isJa ? c.name : '',
      number: c.localId,
      setName: setName || c.set?.name || '',
      imgSmall: img,
      imgLarge: c.image ? c.image + '/high.webp' : '',
      full: null,
    };
  }

  function emptyOffline() {
    return {
      series: '', releaseDate: '', types: [], supertype: 'Pokémon', subtypes: [], rarity: 'Common', hp: '', artist: '',
      attacks: [], abilities: [], weaknesses: [], resistances: [], retreat: null, evolveFrom: '', description: '', effect: '',
      prices: { tcg: {}, tcgUrl: '', tcgUpdated: '', cm: {}, cmUrl: '', cmUpdated: '' }, isOffline: true, full: null,
    };
  }

  function cardFromOffline(id, name, setId, num) {
    const set = (window.OFFLINE_SETS || []).find((s) => s.id === setId) || { name: setId, official: '' };
    return {
      ...emptyOffline(),
      id,
      lang: 'en',
      source: 'dex',
      name,
      number: num,
      setId: set.id || setId,
      setName: set.name || setId,
      setCode: (setId || '').toUpperCase(),
      printedTotal: set.official || '',
      setSymbol: set.symbol ? set.symbol + '.png' : '',
      imgSmall: `https://assets.tcgdex.net/en/${setId.replace(/\d.*$/, '')}/${setId}/${num}/low.webp`,
      imgLarge: `https://assets.tcgdex.net/en/${setId.replace(/\d.*$/, '')}/${setId}/${num}/high.webp`,
      dex: [],
    };
  }

  function jaCardFromOffline(setId, num) {
    const s = jaSet(setId);
    if (!s) return null;
    const jaName = jaCardsOf(s.id)[num];
    if (jaName == null) return null;
    const t = translateJa(jaName);
    const base = s.img && s.serie ? `https://assets.tcgdex.net/ja/${s.serie}/${s.id}/${num}` : '';
    return {
      ...emptyOffline(),
      id: `ja:${s.id}-${num}`,
      lang: 'ja',
      source: 'dex',
      name: t.en,
      nameJa: jaName,
      number: num,
      setId: s.id,
      setName: jaSetName(s),
      setNameJa: s.name,
      setCode: s.id,
      printedTotal: s.official || '',
      setSymbol: s.symbol ? s.symbol + '.png' : '',
      imgSmall: base ? base + '/low.webp' : '',
      imgLarge: base ? base + '/high.webp' : '',
      dex: t.dex ? [t.dex] : [],
    };
  }

  function offlineById(id) {
    if (id.startsWith('ja:')) {
      const rest = id.slice(3);
      const i = rest.lastIndexOf('-');
      return jaCardFromOffline(rest.slice(0, i), rest.slice(i + 1));
    }
    const cards = window.OFFLINE_CARDS || {};
    if (cards[id]) {
      const i = id.lastIndexOf('-');
      return cardFromOffline(id, cards[id], id.slice(0, i), id.slice(i + 1));
    }
    return null;
  }

  /* --------------------------- query parsing --------------------------- */

  const RARITY_MARKS = 'C|U|R|RR|RRR|SR|SSR|SAR|AR|UR|HR|ACE|K|TR|PR|CHR|CSR|MUR|MA|BWR|IR|SIR|DR|SHR|S|A';
  function normaliseQuery(q) {
    let s = String(q || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
    s = s.replace(new RegExp(`\\s+(${RARITY_MARKS})$`), '');       // "069/187 RR" → "069/187"
    s = s.replace(/^[A-J]\s+(?=[A-Z0-9.\-]{2,}\s)/, '');            // "H SV8a 069/187" → "SV8a 069/187"
    return s;
  }

  const numCands = (num) => {
    const clean = num.replace(/^0+(?=\d)/, '');
    return [...new Set([num, num.padStart(3, '0'), clean])];
  };

  /** Use the offline indexes to work out which cards a typed code could be. */
  function findRefs(q) {
    const up = normaliseQuery(q);
    const refs = [];
    const add = (r) => { if (!refs.some((x) => x.id === r.id)) refs.push(r); };
    const cards = window.OFFLINE_CARDS || {};
    let m;

    // Direct id: sv03.5-025, base1-4, ja:SV8a-069, SV8a-069
    if ((m = String(q).trim().match(/^(ja:)?([a-z0-9.\-]+)-([a-z0-9]+)$/i)) && (/\d/.test(m[2]) || SET_ABBR[m[2].toUpperCase()])) {
      const [, ja, setPart, num] = m;
      const enSet = SET_ABBR[setPart.toUpperCase()] || setPart.toLowerCase();
      if (!ja) for (const n of numCands(num)) if (cards[`${enSet}-${n}`]) { add({ id: `${enSet}-${n}`, lang: 'en' }); break; }
      const js = jaSet(setPart);
      if (js) numCands(num).forEach((n) => { if (jaCardsOf(js.id)[n] != null) add({ id: `ja:${js.id}-${n}`, lang: 'ja' }); });
    }

    // SET CODE + NUMBER e.g. MEW 025/165, PAF 232, SV8a 069/187
    if ((m = up.match(/^([A-Z0-9.\-]{2,8})[\s#]+([A-Z]{0,3}\d+[A-Z]?)(?:\s*\/\s*(\d+))?$/))) {
      const [, code, num] = m;
      const setId = SET_ABBR[code] || code.toLowerCase();
      const cands = numCands(num);
      if (code === 'SWSH') cands.unshift('SWSH' + num.padStart(3, '0'));
      for (const n of cands) if (cards[`${setId}-${n}`]) { add({ id: `${setId}-${n}`, lang: 'en' }); break; }
      const js = jaSet(code);
      if (js) for (const n of cands) if (jaCardsOf(js.id)[n] != null) { add({ id: `ja:${js.id}-${n}`, lang: 'ja' }); break; }
    }

    // NUMBER / TOTAL e.g. 4/102, 025/165, 069/187
    if ((m = up.match(/^(\d+)\s*\/\s*(\d+)$/))) {
      const [, num, total] = m;
      const t = parseInt(total, 10);
      const cands = numCands(num);
      (window.OFFLINE_SETS || []).filter((s) => s.official === t).forEach((s) => {
        for (const n of cands) if (cards[`${s.id}-${n}`]) { add({ id: `${s.id}-${n}`, lang: 'en' }); break; }
      });
      (window.JA_SETS || []).filter((s) => s.official === t).forEach((s) => {
        for (const n of cands) if (jaCardsOf(s.id)[n] != null) { add({ id: `ja:${s.id}-${n}`, lang: 'ja' }); break; }
      });
    }
    return refs;
  }

  /* ---------------------------- offline resolver ---------------------------- */

  function resolveOffline(query) {
    const refs = findRefs(query);
    return refs.length ? offlineById(refs[0].id) : null;
  }

  /* --------------------------- public methods -------------------------- */

  async function searchByCode(input) {
    const q = input.trim();
    if (!q) return [];
    const up = normaliseQuery(q);
    let m;

    // 1. Use the local indexes (English + Japanese) to find every card this code could be
    const refs = findRefs(q).slice(0, 8);
    if (refs.length) {
      const cards = await Promise.all(refs.map(async (r) => {
        try { return await getCard(r.id, { preferCache: true }); } catch { return offlineById(r.id); }
      }));
      return cards.filter(Boolean).map((c) => ({ ...c, full: c }));
    }

    // 2. Not in the local index (maybe a brand-new set) → ask TCGdex directly
    if ((m = up.match(/^([A-Z0-9.\-]{2,8})[\s#]+([A-Z]{0,3}\d+[A-Z]?)(?:\s*\/\s*(\d+))?$/))) {
      const [, code, num] = m;
      const tries = [];
      const setId = SET_ABBR[code] || code.toLowerCase();
      numCands(num).forEach((n) => tries.push({ lang: 'en', setId, n }));
      // Japanese set ids are mixed case (e.g. SV8a) — try the typed form and a common "digits + lower" form
      const jaGuess = code.replace(/^([A-Z]+\d+)([A-Z])$/, (_, a, b) => a + b.toLowerCase());
      [...new Set([code, jaGuess])].forEach((sid) => numCands(num).forEach((n) => tries.push({ lang: 'ja', setId: sid, n })));
      for (const t of tries) {
        try {
          const raw = await dex(`/sets/${encodeURIComponent(t.setId)}/${encodeURIComponent(t.n)}`, t.lang);
          if (raw && raw.id) {
            const card = fromDex(raw, t.lang);
            if (t.lang === 'ja') await enrichJa(card);
            setCachedCard(card.id, card);
            return [{ ...card, full: card }];
          }
        } catch { /* try next */ }
      }
    }

    // 3. Otherwise search by name (English + Japanese)
    return searchByName(q, { includeJa: true });
  }

  function offlineJaByName(term, limit = 60) {
    const isJa = HAS_JA.test(term);
    const jaTerm = isJa ? term.normalize('NFKC') : jaNameFor(term);
    if (!jaTerm) return [];
    const out = [];
    for (const s of (window.JA_SETS || []).slice().reverse()) {
      const map = jaCardsOf(s.id);
      for (const [num, name] of Object.entries(map)) {
        if (name.normalize('NFKC').includes(jaTerm)) {
          const c = jaCardFromOffline(s.id, num);
          if (c) out.push(c);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  async function searchByName(name, { includeJa = false } = {}) {
    let clean = name.trim().replace(/[^\p{L}\p{N}\s'\-.&/]/gu, '').trim();
    if (!clean) return [];

    // Support "Name Number" e.g. "Zapdos 029", "Zapdos 29", "Zapdos #029", "Pikachu 25"
    let targetNum = null;
    const nameNumMatch = clean.match(/^(.+?)\s+#?(\d{1,4})(?:\s*\/\s*\d+)?$/i);
    if (nameNumMatch && nameNumMatch[1].trim().length >= 2) {
      clean = nameNumMatch[1].trim();
      targetNum = nameNumMatch[2].trim();
    }

    const jaRes = (includeJa || HAS_JA.test(clean)) ? offlineJaByName(clean) : [];
    let allResults = [];

    // Online search via TCGdex
    if (!HAS_JA.test(clean)) {
      try {
        const list = await dex(`/cards?name=${encodeURIComponent(clean)}`);
        if (Array.isArray(list) && list.length) {
          allResults = [...list.slice(0, 150).reverse().map((c) => briefDex(c)), ...jaRes];
        }
      } catch { /* fall back to offline name search */ }
    }

    // Offline search from local index if needed
    if (!allResults.length && !HAS_JA.test(clean)) {
      const cards = window.OFFLINE_CARDS || {};
      const term = clean.toLowerCase();
      const matches = [];
      for (const [id, cName] of Object.entries(cards)) {
        if (cName.toLowerCase().includes(term)) {
          const i = id.lastIndexOf('-');
          matches.push(cardFromOffline(id, cName, id.slice(0, i), id.slice(i + 1)));
          if (matches.length >= 80) break;
        }
      }
      allResults = [...matches, ...jaRes];
    }

    // If a number was specified (e.g. "Zapdos 029" or "Zapdos 29"), filter cards by that number!
    if (targetNum && allResults.length) {
      const normTarget = targetNum.replace(/^0+/, '') || '0';
      const filtered = allResults.filter((c) => {
        const cNum = String(c.number || '').trim();
        const cNorm = cNum.replace(/^0+/, '') || '0';
        if (cNum === targetNum || cNorm === normTarget) return true;
        if (cNum.startsWith(targetNum) || cNorm.startsWith(normTarget)) return true;
        if (cNum.padStart(3, '0').startsWith(targetNum)) return true;
        if (c.id && (c.id.endsWith('-' + targetNum) || c.id.endsWith('-' + normTarget))) return true;
        return false;
      });
      if (filtered.length) {
        return filtered;
      }
    }

    return allResults;
  }

  /**
   * Get full card details. Goes to the network first (fresh prices) unless preferCache is set,
   * then falls back to the saved copy, then to the offline index.
   */
  async function getCard(id, opts = {}) {
    const preferCache = typeof opts === 'object' && opts.preferCache;
    const cached = getCachedCard(id);
    if (preferCache && cached) return cached;

    try {
      const isJa = id.startsWith('ja:');
      const realId = isJa ? id.slice(3) : id;
      const c = await dex(`/cards/${encodeURIComponent(realId)}`, isJa ? 'ja' : 'en');
      if (c && c.id) {
        const card = fromDex(c, isJa ? 'ja' : 'en');
        if (isJa) {
          // keep the English text we found last time if we have it, otherwise look it up
          if (cached?.english) { card.english = cached.english; card.evolveFrom = cached.evolveFrom || card.evolveFrom; }
          else await enrichJa(card);
        }
        setCachedCard(card.id, card);
        return card;
      }
    } catch { /* offline */ }

    if (cached) return cached;
    const off = offlineById(id);
    if (off) return off;
    throw new Error('Card not found');
  }

  async function getCardsBulk(ids) {
    const out = new Map();
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const c = await getCard(id);
          if (c && !c.isOffline) out.set(id, c);
        } catch { /* ignore */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  function jaSetsList() {
    return (window.JA_SETS || []).slice().reverse().map((s) => ({
      id: s.id, lang: 'ja', source: 'dex',
      name: jaSetName(s), nameJa: s.name, series: '',
      code: s.id, total: s.official || s.total, releaseDate: '',
      logo: s.logo ? s.logo + '.png' : '', symbol: s.symbol ? s.symbol + '.png' : '',
    }));
  }

  async function getSets(lang = 'en') {
    if (lang === 'ja') return jaSetsList();
    try {
      const list = await dex('/sets');
      if (Array.isArray(list) && list.length) {
        return list.reverse().map((s) => ({
          id: s.id,
          lang: 'en',
          source: 'dex',
          name: s.name,
          series: '',
          code: (s.abbreviation?.official || s.id || '').toUpperCase(),
          total: s.cardCount?.official || s.cardCount?.total,
          releaseDate: '',
          logo: s.logo ? s.logo + '.png' : '',
          symbol: s.symbol ? s.symbol + '.png' : '',
        }));
      }
    } catch { /* use offline sets */ }

    return (window.OFFLINE_SETS || []).map((s) => ({
      id: s.id,
      lang: 'en',
      source: 'dex',
      name: s.name,
      series: '',
      code: (s.id || '').toUpperCase(),
      total: s.official || s.total,
      releaseDate: '',
      logo: s.logo || '',
      symbol: s.symbol || '',
    }));
  }

  async function getSetCards(set) {
    const lang = set.lang === 'ja' ? 'ja' : 'en';
    try {
      const s = await dex(`/sets/${encodeURIComponent(set.id)}`, lang);
      if (s && s.cards) {
        return (s.cards || []).map((c) => briefDex(c, lang === 'ja' ? (JA_SET_EN[s.id] || s.name) : s.name, lang));
      }
    } catch { /* offline fallback */ }

    if (lang === 'ja') {
      return Object.keys(jaCardsOf(set.id)).map((num) => jaCardFromOffline(set.id, num)).filter(Boolean);
    }
    // Offline cards for this set
    const cards = window.OFFLINE_CARDS || {};
    const prefix = `${set.id}-`;
    const list = [];
    for (const [id, name] of Object.entries(cards)) {
      if (id.startsWith(prefix)) {
        const num = id.slice(prefix.length);
        list.push(cardFromOffline(id, name, set.id, num));
      }
    }
    return list;
  }

  async function getRates() {
    try {
      const r = await fetchJSON(FX, {}, 6000);
      return { USD: 1, ...r.rates };
    } catch {
      return { USD: 1, GBP: 0.78, EUR: 0.92, CAD: 1.38, AUD: 1.52 };
    }
  }

  return {
    setKey, searchByCode, searchByName, getCard, getCardsBulk, getSets, getSetCards, getRates,
    resolveOffline, translateJa,
  };
})();
