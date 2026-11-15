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

  /* ---------------------------- energy fallback ---------------------------- */
  const ENERGY_SCANS = {"mee":{"001":["https://static.tcgcollector.com/content/images/7c/05/01/7c05017127134ededb8fbc4132bcab6bc11d34b97fbabcccf92293244c7adaf3.webp","https://static.tcgcollector.com/content/images/92/d4/43/92d443706f0fb935aaca668b76b54bfd48358a4c19e9764e7a6e4ed6fc3d0fd5.webp"],"002":["https://static.tcgcollector.com/content/images/9a/66/c2/9a66c2f3a14e1a791c6377b33c82a2f07f924f71e4fd31c1cdf5e374e211d5b3.webp","https://static.tcgcollector.com/content/images/06/8a/f1/068af1f1a5d451c8739654f87be50ab3aca8a7ed19aa70d3e7b4fbaa313e7fd5.webp"],"003":["https://static.tcgcollector.com/content/images/cd/71/4b/cd714beb09c34094807e400b1e27d86965c750189d6e1c88d085633841c3b184.webp","https://static.tcgcollector.com/content/images/59/42/da/5942da9431f6cfe2677b6e5808516bc29f1457667579be090d05331f8f0437f3.webp"],"004":["https://static.tcgcollector.com/content/images/c7/64/d3/c764d3561f43b5127e035c195594876e1a3185f2bb356e2cfbdd5f696fe1948b.webp","https://static.tcgcollector.com/content/images/e7/d1/a3/e7d1a348ad4838e401676a67aef2e1c1b22ecb745e73ee431327ca684bc2034a.webp"],"005":["https://static.tcgcollector.com/content/images/e8/70/f6/e870f629e2d76ed8e6ba5d1a2a8fd967adb0903287b0b4dc5711d016de376fef.webp","https://static.tcgcollector.com/content/images/3f/d8/04/3fd8046338d81b06402746680ca825bfe11076139d5fc2b061b8c6c44569eddf.webp"],"006":["https://static.tcgcollector.com/content/images/41/88/6e/41886eb712cd6440c65e75d36c257f943551d8c4fefbc9bf5491d9d5f1830406.webp","https://static.tcgcollector.com/content/images/4f/31/26/4f312611f148f5fb2048760557d9b7a36448c44097d36bd7d5c6d96a1b1598e6.webp"],"007":["https://static.tcgcollector.com/content/images/24/9b/2f/249b2ff359e21259b5f81f28af591a128a677f5ac4985e807419af539d0ade02.webp","https://static.tcgcollector.com/content/images/21/de/ca/21deca2afe19a71a31c708a5d0093a3f2f2d9fd4a5c549f8f3198d4478ef8777.webp"],"008":["https://static.tcgcollector.com/content/images/d9/be/68/d9be6863a69a9100532c21eb03eeb8b81633f6e6f0e57f93fecd45b7db57f14f.webp","https://static.tcgcollector.com/content/images/b1/5c/73/b15c73fcceedaa5def237568acdc311d03cb1ea362a4c6c3e920ae9eba37b0ae.webp"],"009":["https://static.tcgcollector.com/content/images/aa/15/52/aa1552fb9906e2f626d2fc7f616c0f9c4939c7d629ee72966386657925b561e6.webp","https://static.tcgcollector.com/content/images/ed/54/f3/ed54f3d62c658657fc1f333f54313a714bdae70f9c85152546e77b3459284476.webp"],"010":["https://static.tcgcollector.com/content/images/67/0b/50/670b5023c887166e5bd6ff1dfa956fa147309e16841d5f99a8fd3d892b93bba8.webp","https://static.tcgcollector.com/content/images/73/56/91/73569163c9a790a0fb9d921dceae235645ffc0d9559fe2eae386598acad1dc89.webp"],"011":["https://static.tcgcollector.com/content/images/5c/d7/ef/5cd7ef0360d6b5799f18e73d037ac62f1a6b6b8a1ff9568080a42e95dcddb2ce.webp","https://static.tcgcollector.com/content/images/6c/b4/f5/6cb4f56e88be29a163dd43525f83029563b7bb2ed9ee88f237e27fda3dbd5b1f.webp"],"012":["https://static.tcgcollector.com/content/images/f8/f4/b9/f8f4b94e001ba506c86b1957d3d9e04e7626d45314548af2eabf5b78806d10e5.webp","https://static.tcgcollector.com/content/images/fd/bf/0a/fdbf0a2e182f46ec4eea5dff02543882cc1b9b85930c2a23b9fb33bbb6262d18.webp"],"013":["https://static.tcgcollector.com/content/images/bf/da/bf/bfdabf62462e399d2bb94ae6710bd42481c4f1c7f37ae17eea08d08a2be70e36.webp","https://static.tcgcollector.com/content/images/df/67/33/df67334c0ffd6f560d76da00ff2aca5a90b7c62b687773c24efa7c50e3e9e5cc.webp"],"014":["https://static.tcgcollector.com/content/images/c5/eb/02/c5eb022fcd388a835897d9dad3c968756b64df7fbe1d8c391ad43b461053b976.webp","https://static.tcgcollector.com/content/images/66/8a/ad/668aadec7e9678e6e7a037377df33032c1066c1bde4fbf982524d358f3dabc2f.webp"],"015":["https://static.tcgcollector.com/content/images/14/b0/e5/14b0e5a55a398a54469e7cef66e5d3d6ff226c94424bac7d235e32f0b4986ee6.webp","https://static.tcgcollector.com/content/images/04/37/a0/0437a01012ed3ab8847ac20b4a27ae70ac73dfa10f711cd8170f137f4bcc4736.webp"],"016":["https://static.tcgcollector.com/content/images/44/5a/74/445a74f2fa7de814c2d6b7d9d282f1dbe016c9fd7772774976d1baf0667ffe0f.webp","https://static.tcgcollector.com/content/images/9c/f3/63/9cf36363d629829422ebeadd254035765560139dd67323d35f5628dd6a648ef0.webp"]},"sve":{"001":["https://static.tcgcollector.com/content/images/f5/5f/53/f55f53b19fe597a3043b2f5167739de3d450681793a1dbb93b39716124aae96c.jpg","https://static.tcgcollector.com/content/images/68/24/17/6824173d7bd59fff940ce9089cddac7a18b6c7a2015fd079cb86ac6e83978aab.jpg"],"002":["https://static.tcgcollector.com/content/images/b5/20/fb/b520fb71a54523418da65e18345fc0baebc23dae7230ee9575c2bffdeea6f930.jpg","https://static.tcgcollector.com/content/images/f7/79/40/f77940cf674f882178b3469550f71565fb6f9cc785fd9f087cfb514f7c1f97d2.jpg"],"003":["https://static.tcgcollector.com/content/images/a6/ac/f0/a6acf0adfdbd6a87982ba79e4143e826c5bbef47c235c6c9654ac1054f23c42e.jpg","https://static.tcgcollector.com/content/images/b9/f6/10/b9f610ec57bb72eac2ef6f427440fe9273fe2ac1ce322f8013d66110e3c9d52a.jpg"],"004":["https://static.tcgcollector.com/content/images/7d/9e/24/7d9e2459e8958cc2a8982d1c5e9cdf91512275040a625e2210c4d40cbb3889dd.jpg","https://static.tcgcollector.com/content/images/8a/6b/cf/8a6bcf3b18fcacfaa377261368856a26a7f8520d8230aa109e0ab725d76bcba2.jpg"],"005":["https://static.tcgcollector.com/content/images/12/ee/1b/12ee1b76e375e641b4a05645d40144da670c53b2ea5a19bc60b96368ea14fa32.jpg","https://static.tcgcollector.com/content/images/4e/c7/27/4ec72798ef8f2420312fcc4777f904763b7bde4e6deebc1ad467c454c79f29f7.jpg"],"006":["https://static.tcgcollector.com/content/images/0c/8b/5d/0c8b5df803e2db73bd83d13725251b3e868ee87e04a527b6265274bca7dbdb3c.jpg","https://static.tcgcollector.com/content/images/9e/37/1b/9e371bb954a8217065d52a272d062204b26687425bef956e2e4e604fbd233b46.jpg"],"007":["https://static.tcgcollector.com/content/images/e4/79/22/e47922d4083dc5431d14e13afb1b92b42bc28abf205e99b356efa6adb857b33a.jpg","https://static.tcgcollector.com/content/images/c1/48/72/c14872b28deb3ca7e41f8d969509bb7461e160fd1856aa24d4b9a3594523620f.jpg"],"008":["https://static.tcgcollector.com/content/images/5a/8a/ce/5a8acef5e77b8b0213524eb8f5aa4c7ee2bacb11b728beaf869fa35ca6e3ce98.jpg","https://static.tcgcollector.com/content/images/a0/eb/b7/a0ebb7ce70022af7f86f8b30acc7fc39957a4e10bd4899d804f366ffe540ae0b.jpg"],"009":["https://static.tcgcollector.com/content/images/aa/2d/ea/aa2dea500fb87050798eea37165ee225f49c1b673f3c8f5bd6f79b07a50a6bbe.jpg","https://static.tcgcollector.com/content/images/41/dd/7d/41dd7d4482239d36ce86df545f385c6047926a4311c4c6a2739cf4d89f77d740.jpg"],"010":["https://static.tcgcollector.com/content/images/ec/b8/ed/ecb8ed96c928c314d77c653d34c892d334c1eb2f0c055b84fcc5a949b679840b.jpg","https://static.tcgcollector.com/content/images/e2/44/aa/e244aa067a78d7e092d0d86d010932843589bdf3318022923bc3e29f2811984e.jpg"],"011":["https://static.tcgcollector.com/content/images/b0/83/16/b08316a9f2d51589b4a814b8299d4f4822cca725896eb8869f88731516a99af3.jpg","https://static.tcgcollector.com/content/images/b9/67/f9/b967f9a9e2e6dc882465cfbbd17ad9dfca320c395b3c8f673869c0ba5d1a67cf.jpg"],"012":["https://static.tcgcollector.com/content/images/c2/1d/37/c21d370dd588da834c3708954ad38e4da149ebae78338a0f104de5db6a190a5e.jpg","https://static.tcgcollector.com/content/images/27/df/e4/27dfe4eceb044b53fb6131327b51cbe2d82fe013d9f93014cbeafad96fddc3bb.jpg"],"013":["https://static.tcgcollector.com/content/images/1d/10/2b/1d102ba9c75b54b32cd75ff82d5ee320b9986d50c5566381afdb63d048fb42cf.jpg","https://static.tcgcollector.com/content/images/71/a5/51/71a551a82c411f8cd4a87dfbc7423071dd7f41ad51edc0090e736b36ce334c68.jpg"],"014":["https://static.tcgcollector.com/content/images/0e/eb/12/0eeb1258972d400ff71231883b1453af6df618e4df98e51d499232178301d08d.jpg","https://static.tcgcollector.com/content/images/d3/41/e2/d341e2bf8a5236a209346c8ab0c5608f2156ddc6d40c0eaccbe88668954adf76.jpg"],"015":["https://static.tcgcollector.com/content/images/57/bf/86/57bf86873793074af963f6b3034c74b9101a654ac1fd57a9aa6f4be5601fb44d.jpg","https://static.tcgcollector.com/content/images/ec/7b/c0/ec7bc0303b0dcdf906af86332ba6bbf6dd4366fa798d626cff06132177f76002.jpg"],"016":["https://static.tcgcollector.com/content/images/73/ba/b6/73bab62080ec1b44ad0776fa29d46a66d5b78c7b48e06f63bce8e65b9769ade9.jpg","https://static.tcgcollector.com/content/images/fc/97/03/fc97030221e9fe1cf10227a35433f7962e1327d13b4e8be2f10faac2fac9ce43.jpg"],"017":["https://static.tcgcollector.com/content/images/e8/95/aa/e895aa9ce34e8848cbe872de6131a938ea6cb82518944ec4f4eafb7b0eb64d0c.webp","https://static.tcgcollector.com/content/images/c3/31/3e/c3313e9bb12156caff47599b7d6790c33f031ea2c614645ba38d2a7d8fd76506.webp"],"018":["https://static.tcgcollector.com/content/images/4a/e1/35/4ae1352221b923fa98dbedc14b0dd82cc0c7336e256efc7be112d637d4d025c7.webp","https://static.tcgcollector.com/content/images/7b/4c/7d/7b4c7d49ac8cc2a4e6b7c9a171614831c77133bc5394c73d45136511d4aa6429.webp"],"019":["https://static.tcgcollector.com/content/images/35/94/3e/35943e5a7f9118dd9532af32f5c52fb218dc3e72fc89e661651f472941125178.webp","https://static.tcgcollector.com/content/images/91/77/fe/9177fe7cf3a99d91dfa7ad528dd4e61575e051280a64847167b4f4830c33e713.webp"],"020":["https://static.tcgcollector.com/content/images/4d/db/9d/4ddb9defc273b96c9e1281fff84272ad3d2b01c8f4d4915d3f4dc078b048e3b5.webp","https://static.tcgcollector.com/content/images/cd/32/e5/cd32e5df09429ae85cd28a237d0200a675cc4e14aceaf27bf67b34fcfb95785b.webp"],"021":["https://static.tcgcollector.com/content/images/f2/fd/87/f2fd87dd02c2f848846c50f84ddcab30d355836991cbc8ffcf9ae7acd17689a5.webp","https://static.tcgcollector.com/content/images/79/37/8b/79378b682852a285ba70ebec891649b50ef47fed2e3345e4783be246ead067a5.webp"],"022":["https://static.tcgcollector.com/content/images/dc/1c/e6/dc1ce60396e376ff70ee8dee477d150ce1cf368ee56626e341cd74068670f498.webp","https://static.tcgcollector.com/content/images/5b/03/98/5b039807b7f8ea37d461d7af1be7a13fdcab7c24d8f3f2301c1a86c2a062a7ae.webp"],"023":["https://static.tcgcollector.com/content/images/cd/c3/32/cdc332b283e54fe64ca463b5e22c46e709b9effb80c7e1c83b62e5e82ac8b58b.webp","https://static.tcgcollector.com/content/images/b7/ec/8d/b7ec8df123a801192d570c0a5f8f26437e156badadd88e0eb00b49713e3a3a67.webp"],"024":["https://static.tcgcollector.com/content/images/00/5c/86/005c864ac97adc69b1fe635c0405fdeed0160b987a42854e1c10e537fcc64860.webp","https://static.tcgcollector.com/content/images/38/b7/38/38b738a5efec5442c0f7f38bad286048ba6f2b404f3749d02493366087ae62c2.webp"]}};

  function getEnergyScan(setId, num) {
    const s = String(setId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const n = String(num || "").replace(/D+/g, "").padStart(3, "0");
    const setTable = ENERGY_SCANS[s];
    if (setTable && setTable[n]) {
      return { low: setTable[n][0], high: setTable[n][1] };
    }
    return null;
  }

  window.getEnergyScan = getEnergyScan;

  const ENERGY_CONFIG = {
    Grass:     { name: 'Grass Energy',     c1: '#0a3315', c2: '#1e6b2c', c3: '#48b056', icon: '🌿', symbol: 'GRASS' },
    Fire:      { name: 'Fire Energy',      c1: '#420f07', c2: '#ad2610', c3: '#f76828', icon: '🔥', symbol: 'FIRE' },
    Water:     { name: 'Water Energy',     c1: '#08274a', c2: '#1664a6', c3: '#3ca6f5', icon: '💧', symbol: 'WATER' },
    Lightning: { name: 'Lightning Energy', c1: '#473800', c2: '#a88400', c3: '#ffd700', icon: '⚡', symbol: 'LIGHTNING' },
    Psychic:   { name: 'Psychic Energy',   c1: '#2c0b3b', c2: '#6a1b9a', c3: '#ba68c8', icon: '🔮', symbol: 'PSYCHIC' },
    Fighting:  { name: 'Fighting Energy',  c1: '#3d1b09', c2: '#8c3b12', c3: '#d97036', icon: '👊', symbol: 'FIGHTING' },
    Darkness:  { name: 'Darkness Energy',  c1: '#0f141c', c2: '#222c3c', c3: '#475569', icon: '🌙', symbol: 'DARKNESS' },
    Metal:     { name: 'Metal Energy',     c1: '#1e242b', c2: '#4a5763', c3: '#94a3b8', icon: '⚙️', symbol: 'METAL' },
    Fairy:     { name: 'Fairy Energy',     c1: '#3b0a26', c2: '#991b58', c3: '#f06292', icon: '🧚', symbol: 'FAIRY' },
    Dragon:    { name: 'Dragon Energy',    c1: '#3b3009', c2: '#7d6514', c3: '#c49c29', icon: '🐉', symbol: 'DRAGON' },
    Colorless: { name: 'Colorless Energy', c1: '#23272e', c2: '#4b5563', c3: '#9ca3af', icon: '⭐', symbol: 'COLORLESS' },
  };

  const escapeXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function isEnergyCard(c) {
    if (!c) return false;
    const name = String(c.name || '').toLowerCase();
    const st = String(c.supertype || c.category || '').toLowerCase();
    const set = String(c.setCode || c.setId || c.set?.id || '').toLowerCase();
    if (st === 'energy') return true;
    if (/\benergy\b/i.test(name)) return true;
    if (set === 'sve' || set === 'mee') return true;
    if (Array.isArray(c.subtypes) && c.subtypes.some((s) => /energy/i.test(s))) return true;
    return false;
  }

  function detectEnergyType(name = '', num = '', setCode = '') {
    const n = String(name || '').toLowerCase();
    if (n.includes('grass') || n.includes('leaf')) return 'Grass';
    if (n.includes('fire')) return 'Fire';
    if (n.includes('water')) return 'Water';
    if (n.includes('lightning') || n.includes('electric')) return 'Lightning';
    if (n.includes('psychic')) return 'Psychic';
    if (n.includes('fighting')) return 'Fighting';
    if (n.includes('darkness') || n.includes('dark')) return 'Darkness';
    if (n.includes('metal') || n.includes('steel')) return 'Metal';
    if (n.includes('fairy')) return 'Fairy';
    if (n.includes('dragon')) return 'Dragon';
    if (n.includes('colorless')) return 'Colorless';
    const parsed = parseInt(String(num).replace(/\D+/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      const cycle = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
      return cycle[(parsed - 1) % cycle.length];
    }
    return 'Colorless';
  }

  function makeEnergyCardSvg(name, num, setCode, total) {
    const type = detectEnergyType(name, num, setCode);
    const cfg = ENERGY_CONFIG[type] || ENERGY_CONFIG.Colorless;
    const dispName = (name && /energy/i.test(name)) ? name : cfg.name;
    const numStr = String(num || '').padStart(3, '0');
    const setStr = String(setCode || 'ENG').toUpperCase();
    const badgeStr = total ? `${setStr} · #${numStr}/${total}` : `${setStr} · #${numStr}`;
    const gradId = `eg_${type.toLowerCase()}`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 245 342" width="245" height="342">
  <defs>
    <radialGradient id="${gradId}" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="${cfg.c3}"/>
      <stop offset="55%" stop-color="${cfg.c2}"/>
      <stop offset="100%" stop-color="${cfg.c1}"/>
    </radialGradient>
    <linearGradient id="egBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffd875"/>
      <stop offset="50%" stop-color="#bfa054"/>
      <stop offset="100%" stop-color="#635124"/>
    </linearGradient>
    <filter id="egGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="245" height="342" rx="14" fill="#18181b"/>
  <rect x="7" y="7" width="231" height="328" rx="10" fill="url(#${gradId})" stroke="url(#egBorder)" stroke-width="2.5"/>
  <rect x="14" y="14" width="217" height="314" rx="8" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
  <circle cx="122.5" cy="162" r="78" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="16"/>
  <circle cx="122.5" cy="162" r="56" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <circle cx="122.5" cy="162" r="40" fill="rgba(0,0,0,0.18)"/>
  <rect x="18" y="22" width="209" height="34" rx="6" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <text x="28" y="44" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="800" fill="#ffffff" letter-spacing="0.5">${escapeXml(dispName.toUpperCase())}</text>
  <text x="217" y="44" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffd54f">ENERGY</text>
  <text x="122.5" y="72" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="9" font-weight="600" fill="rgba(255,255,255,0.75)" letter-spacing="1.5">BASIC ENERGY CARD</text>
  <circle cx="122.5" cy="162" r="32" fill="${cfg.c2}" stroke="#ffffff" stroke-width="3" filter="url(#egGlow)"/>
  <text x="122.5" y="173" text-anchor="middle" font-size="30" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${cfg.icon}</text>
  <text x="122.5" y="230" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="800" fill="#ffffff" letter-spacing="1.5">${cfg.symbol}</text>
  <rect x="18" y="292" width="209" height="24" rx="4" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <text x="28" y="308" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="10" font-weight="700" fill="#e2e8f0" letter-spacing="0.5">${escapeXml(badgeStr)}</text>
  <text x="217" y="308" text-anchor="end" font-size="12" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${cfg.icon}</text>
</svg>`;

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  window.isEnergyCard = isEnergyCard;
  window.makeEnergyCardSvg = makeEnergyCardSvg;

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
    const isEnergy = isEnergyCard({ name: c.name, category: c.category, set: s, setCode: s.abbreviation?.official || s.id, setId: s.id });
    let imgSmall = img ? img + '/low.webp' : '';
    let imgLarge = img ? img + '/high.webp' : '';
    if (!img && isEnergy) {
      const scan = getEnergyScan(s.id, c.localId);
      if (scan) {
        imgSmall = scan.low;
        imgLarge = scan.high;
      } else {
        const fallbackSvg = makeEnergyCardSvg(c.name, c.localId, isJa ? s.id : (s.abbreviation?.official || s.id), s.cardCount?.official || s.cardCount?.total || jset?.official);
        imgSmall = fallbackSvg;
        imgLarge = fallbackSvg;
      }
    }
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
    const isJa = lang === 'ja';
    const sId = c.set?.id || '';
    const isEnergy = isEnergyCard({ name: c.name, category: c.category, setCode: sId, setId: sId });
    let imgSmall = c.image ? c.image + '/low.webp' : '';
    let imgLarge = c.image ? c.image + '/high.webp' : '';
    if (!c.image && isEnergy) {
      const scan = getEnergyScan(sId, c.localId);
      if (scan) {
        imgSmall = scan.low;
        imgLarge = scan.high;
      } else {
        const fallbackSvg = makeEnergyCardSvg(c.name, c.localId, sId, c.set?.cardCount?.official || c.set?.cardCount?.total);
        imgSmall = fallbackSvg;
        imgLarge = fallbackSvg;
      }
    }
    return {
      id: isJa ? `ja:${c.id}` : c.id,
      lang,
      source: 'dex',
      name: isJa ? translateJa(c.name).en : c.name,
      nameJa: isJa ? c.name : '',
      number: c.localId,
      setName: setName || c.set?.name || '',
      imgSmall,
      imgLarge,
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
    const isEnergy = isEnergyCard({ name, setId, setCode: setId, supertype: 'Energy' });
    let imgSmall = `https://assets.tcgdex.net/en/${setId.replace(/\d.*$/, '')}/${setId}/${num}/low.webp`;
    let imgLarge = `https://assets.tcgdex.net/en/${setId.replace(/\d.*$/, '')}/${setId}/${num}/high.webp`;
    if (isEnergy && /^(sve|mee)$/i.test(setId)) {
      const scan = getEnergyScan(setId, num);
      if (scan) {
        imgSmall = scan.low;
        imgLarge = scan.high;
      } else {
        const svg = makeEnergyCardSvg(name, num, setId, set.official);
        imgSmall = svg;
        imgLarge = svg;
      }
    }
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
      imgSmall,
      imgLarge,
      dex: [],
      supertype: isEnergy ? 'Energy' : 'Pokémon',
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
    resolveOffline, translateJa, isEnergyCard, makeEnergyCardSvg, getEnergyScan,
  };
})();

window.API = API;
