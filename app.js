/* Harinamadwar — web app (for iPhone / iPad and any browser).
 * Reads the same content files as the Android app: songs.txt, songs_<lang>.txt,
 * meanings_<lang>.txt, audio.txt and the Audio/ folder, from the same place it is served. */
'use strict';

const WEB_VERSION = '4.20';
// The three books. Each book's files sit in its own folder (Divyanama at the top, Ashtapathy in ashtapathy/, Prabandham in prabandham/).
const BOOKS = {
  dns: { id: 'dns', base: '', hash: '#song/', title: 'Divya Nama Sankeertanam', search: 'Search: section no. or song title', unit: 'songs' },
  ashta: { id: 'ashta', base: 'ashtapathy/', hash: '#ashta/', title: 'Śrī Gīta Govindam', search: 'Search: aṣṭapadi no. or title', unit: 'aṣṭapadis' },
  ndp: { id: 'ndp', base: 'prabandham/', hash: '#ndp/', title: 'Naalaayira Divya Prabandham', search: 'Search: pāsuram no. or words', unit: 'pāsurams' },
};
// the Prabandham's name follows the chosen language
const bookTitle = id => (id === 'ndp' ? NDP_BOOK[ndpLang()][0] : T(id)[0]);
let book = BOOKS.dns;
const loaded = {}; // book id -> {songs, indexItems}
const LANGS = [
  { code: 'en', label: 'English', name: 'English' },
  { code: 'ta', label: 'தமிழ்', name: 'Tamil' },
  { code: 'kn', label: 'ಕನ್ನಡ', name: 'Kannada' },
  { code: 'sa', label: 'संस्कृतम्', name: 'Sanskrit' },
];
const MIN_SCALE = 0.8, MAX_SCALE = 2.4, STEP = 1.15;

// ---------- settings (remembered on this phone) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('hg.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hg.' + k, JSON.stringify(v)); } catch (e) {} },
};
const prefs = {
  get lang() { return store.get('lang', 'en'); }, set lang(v) { store.set('lang', v); if (typeof syncTfdLang === 'function') syncTfdLang(v); if (typeof applyLang === 'function') applyLang(); },
  get scale() { return store.get('scale', 1); }, set scale(v) { store.set('scale', Math.max(MIN_SCALE, Math.min(MAX_SCALE, v))); },
  get night() { return store.get('night', false); }, set night(v) { store.set('night', v); },
  get screenOn() { return store.get('screenOn', true); }, set screenOn(v) { store.set('screenOn', v); },
  get setupDone() { return store.get('setupDone', false); }, set setupDone(v) { store.set('setupDone', v); },
};

const $ = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- content ----------
const files = {};
const bf = name => book.base + name; // file of the open book
function fetchText(name) {
  if (!files[name]) {
    // Tamil / Kannada thoughts are plain files here in the app's folder (not on the admin page)
    if (/^community\/tfd_(ta|kn)\.txt$/.test(name)) return (files[name] = fetch(name, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.text(); }).catch(e => { delete files[name]; throw e; }));
    // signed-in mode: satsangs/learn/thoughts come from the admin page; songs from the private store (phase 2)
    if (accessOn() && name.startsWith('community/')) return (files[name] = communityFile(name.slice(10)).catch(e => { delete files[name]; throw e; }));
    // without sign-in: satsangs, Learn and thoughts also come from the admin page (the online file is the fallback, e.g. offline)
    if (!accessOn() && name.startsWith('community/')) return (files[name] = openCommunity(name.slice(10)).catch(e => { delete files[name]; throw e; }));
    if (accessOn() && ACCESS.privateContent && name.endsWith('.txt')) return (files[name] = privateFile(name).catch(e => { delete files[name]; throw e; }));
    files[name] = fetch(name, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.text(); })
      .catch(e => { delete files[name]; throw e; });
  }
  return files[name];
}

let openCommunityP = null;
function openCommunity(file) {
  if (!openCommunityP) openCommunityP = fetch(REC_URL + '/rest/v1/rpc/app_community', { method: 'POST', headers: { apikey: REC_KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : null).then(r => { if (r && r.version != null) seenContent('comm', r.version); return r; }).catch(() => null);
  const github = () => fetch('community/' + file, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(file + ' ' + r.status); return r.text(); });
  return openCommunityP.then(r => r && typeof r[file] === 'string' ? r[file] : github());
}
let songs = [];      // {number,title,raga,page,lyrics,chapter,displayTitle,displayRaga,pos}
let indexItems = []; // {type:'chap', heading} | {type:'song', song}
const texts = {};    // lang -> Map(number -> {title,raga,body})
const audioMaps = {};

const part = (h, i) => (h.length > i ? h[i].trim() : '');

function parseSongs(txt) {
  const s = [], idx = [];
  let chapter = '', header = null, body = [];
  let ayiram = '', workNo = '', decade = '', decadeName = '';   // Prabandham structure (SCRUM: index drop-down)
  const flush = () => {
    if (!header) return;
    const page = parseInt(part(header, 3), 10) || 0;
    const song = {
      number: part(header, 0), title: part(header, 1), raga: part(header, 2), page,
      lyrics: body.join('\n').trim(), chapter,
      displayTitle: part(header, 4) || part(header, 1), displayRaga: part(header, 5) || part(header, 2),
      pos: s.length, ayiram, workNo, decade, decadeName,
    };
    s.push(song); idx.push({ type: 'song', song });
  };
  for (const line of txt.replace(/\r/g, '').split('\n')) {
    const isChap = line.startsWith('## '), isSub = line.startsWith('### '), isSong = line.startsWith('@@');
    if (isChap || isSub || isSong) { flush(); header = null; body = []; }
    if (isSub) {
      const h = line.slice(4).split('|');
      decade = h[0].trim(); decadeName = part(h, 1);
      idx.push({ type: 'chap', key: '### ' + h[0].trim(), num: h[0].trim(), heading: h[0].trim() + '   ' + part(h, 1) });
    } else if (isChap) {
      const h = line.slice(3).split('|');
      const num = h[0].trim();
      if (num === '0') ayiram = part(h, 1); else { workNo = num; decade = ''; decadeName = ''; }
      chapter = part(h, 1);
      idx.push({ type: 'chap', key: '## ' + num, num, heading: num === '0' ? chapter : num + '.  ' + chapter });
    } else if (isSong) {
      header = line.slice(2).split('|');
    } else if (header) {
      body.push(line);
    }
  }
  flush();
  return { songs: s, indexItems: idx };
}

function parseBlocks(txt) {
  const m = new Map();
  let header = null, body = [];
  const flush = () => { if (header) m.set(part(header, 0), { title: part(header, 1), raga: part(header, 2), body: body.join('\n').trim() }); };
  for (const line of txt.replace(/\r/g, '').split('\n')) {
    const isSong = line.startsWith('@@');
    if (isSong || line.startsWith('## ')) {
      flush();
      header = isSong ? line.slice(2).split('|') : null;
      body = [];
    } else if (header) body.push(line);
  }
  flush();
  return m;
}

async function loadText(file) {
  const key = bf(file);
  if (!texts[key]) {
    try { texts[key] = parseBlocks(await fetchText(key)); } catch (e) { texts[key] = new Map(); }
  }
  return texts[key];
}
const lyricsFile = lang => 'songs_' + lang + '.txt';
const meaningFile = lang => (lang === 'kn' ? 'meanings_kn.txt' : lang === 'ta' ? 'meanings_ta.txt' : 'meanings_en.txt');

// Recordings the admins mark Complete (admin page › App content › Recordings) live in Supabase storage.
const REC_URL = 'https://rjjpgxiyncgjrwmvnbhg.supabase.co', REC_KEY = 'sb_publishable_v_qO0MNpMCGvuaEo3oWGEQ_NyiOylEM';   // public address and public key
let recP = null;
function adminRecordings() {
  if (!recP) recP = fetch(REC_URL + '/rest/v1/rpc/app_recordings', { method: 'POST', headers: { apikey: REC_KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status)).then(l => { store.set('recs', l); seenContent('recs', l.map(x => x.path + '@' + x.at).sort().join(',')); return l; })
    .catch(() => store.get('recs', []));
  return recP;
}
function loadAudio(b) {
  b = b || book;
  // one shared promise per book, so a second caller never sees a half-filled list
  if (!audioMaps[b.id]) {
    audioMaps[b.id] = Promise.all([fetchText(b.base + 'audio.txt').catch(() => ''), adminRecordings()]).then(([txt, recs]) => {
      const m = new Map();
      for (const line of txt.split('\n')) {
        const bar = line.indexOf('|');
        if (bar > 0) m.set(line.slice(0, bar).trim(), line.slice(bar + 1).trim());
      }
      for (const r of recs || []) if (r.book === b.id)   // a newer recording from the admin page wins
        m.set(r.number, REC_URL + '/storage/v1/object/public/recordings/' + r.path.split('/').map(encodeURIComponent).join('/') + '?v=' + Date.parse(r.at));
      return m;
    }).catch(() => new Map());
  }
  return audioMaps[b.id];
}
function audioUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return book.base + path.split('/').map(encodeURIComponent).join('/');
}

// ---------- search ----------
function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} .]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- appearance ----------
function applyLook() {
  document.body.classList.toggle('night', prefs.night);
  document.documentElement.style.setProperty('--scale', prefs.scale);
  const bar = prefs.night ? '#18325E' : '#1D4E9E';
  document.querySelector('meta[name=theme-color]').setAttribute('content', bar);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ---------- views ----------
const VIEWS = ['v-home', 'v-about', 'v-index', 'v-song', 'v-settings', 'v-welcome', 'v-diary', 'v-learn', 'v-playlist', 'v-favs', 'v-tfd', 'v-share', 'v-login', 'v-locked', 'v-other'];
let homeScroll = 0;
const scrollMem = {}; let prevView = '';
function showView(id) {
  // the language bar always shows the language in use (it can also be changed on a song page)
  if (typeof paintLangBars === 'function') { const lb = $(id) && $(id).querySelector('[data-langbar] .lb-b.on'); if (!lb || lb.dataset.uiLang !== prefs.lang) paintLangBars(); }
  const curV = VIEWS.find(v => !$(v).classList.contains('hidden'));
  if (curV && curV !== id) { const sc = $(curV).querySelector('.scroll'); if (sc) scrollMem[curV] = sc.scrollTop; }
  prevView = curV || '';
  if (!$('v-home').classList.contains('hidden') && id !== 'v-home') homeScroll = $('home-scroll').scrollTop;  // SCRUM-51
  if (!$('v-index').classList.contains('hidden') && id !== 'v-index') indexScroll = $('index-scroll').scrollTop;
  if (!$('v-song').classList.contains('hidden') && id !== 'v-song') { stopAudio(); keepAwake(false); }
  if (!$('v-other').classList.contains('hidden') && id !== 'v-other') keepAwake(false);
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
}

// ---------- index ----------
let indexScroll = 0;
const IX_UI = {
  ch: { en: 'chapters', ta: 'அத்தியாயங்கள்', kn: 'ಅಧ್ಯಾಯಗಳು', sa: 'अध्यायाः' },
  songs: { en: 'songs', ta: 'பாடல்கள்', kn: 'ಹಾಡುಗಳು', sa: 'गीतानि' },
  song1: { en: 'song', ta: 'பாடல்', kn: 'ಹಾಡು', sa: 'गीतम्' },
  rec: { en: 'with recordings', ta: 'பதிவுகளுடன்', kn: 'ಧ್ವನಿಮುದ್ರಣಗಳೊಂದಿಗೆ', sa: 'ध्वनिमुद्रणयुक्तानि' },
  recs: { en: 'recordings', ta: 'பதிவுகள்', kn: 'ಧ್ವನಿಮುದ್ರಣಗಳು', sa: 'ध्वनिमुद्रणानि' },
  go: { en: 'GO STRAIGHT TO', ta: 'நேராகச் செல்ல', kn: 'ನೇರವಾಗಿ ಹೋಗಿ', sa: 'साक्षात् गम्यताम्' },
  ashta: { en: 'Aṣṭapadi', ta: 'அஷ்டபதி', kn: 'ಅಷ್ಟಪದಿ', sa: 'अष्टपदी' },
  ashtaOf: { en: 'Aṣṭapadis of Śrī Jayadeva', ta: 'ஸ்ரீ ஜயதேவரின் அஷ்டபதிகள்', kn: 'ಶ್ರೀ ಜಯದೇವರ ಅಷ್ಟಪದಿಗಳು', sa: 'श्रीजयदेवस्य अष्टपद्यः' },
  slokam: { en: 'Ślokam', ta: 'ஶ்லோகம்', kn: 'ಶ್ಲೋಕ', sa: 'श्लोकः' },
  listen: { en: 'Recording', ta: 'பதிவு', kn: 'ಧ್ವನಿ', sa: 'ध्वनिः' },
  ndpOf: { en: 'pāsurams of the Āzhvārs', ta: 'ஆழ்வார்களின் பாசுரங்கள்', kn: 'ಆಳ್ವಾರರ ಪಾಶುರಗಳು', sa: 'आळ्वाराणां पाशुराः' },
};
// SCRUM-94: index labels and counts stay in English; only the book's own lines (ashtaOf, ndpOf) follow the language
const ixT = k => (k === 'ashtaOf' || k === 'ndpOf') ? (IX_UI[k][prefs.lang] || IX_UI[k].en) : IX_UI[k].en;
const isSlokam = s => /^(ślokam|shlōkam|slokam|shlokam|dhyāna ślokam)$/i.test((s.displayTitle || s.title || '').trim()) || /^shl?Okam$/i.test(s.title || '');
const recIcon = () => `<span class="ix-au" aria-label="Has a recording">${svgI('music')}</span>`;
const chev = () => svgI('chevron', 'ix-chev');
async function renderIndex(filter) {
  indexLang = prefs.lang;   // SCRUM-96: remember which language the list is built in
  const lang = prefs.lang;
  const t = lang === 'en' ? null : await loadText(lyricsFile(lang));
  const am = await loadAudio();
  const q = norm(filter || '');
  const ul = $('song-list');
  if (indexBook === 'ndp' && !q) { renderNdpTree(t, am); return; }
  const heads = lang === 'en' ? null : await loadHeads(lyricsFile(lang));
  const titleOf = s => { const x = t && t.get(s.number); return x && x.title ? x.title : s.displayTitle; };
  const subOf = s => { const x = t && t.get(s.number); return lang === 'en' ? s.displayRaga : (x && x.raga && !/^\S+\s+[\d-]+$/.test(x.raga) ? x.raga : ''); };
  const chapName = it => {
    const n = heads && it.num !== undefined ? heads.get(it.key.startsWith('### ') ? it.key : '## ' + it.num) : '';
    if (n) return n;
    return it.key.startsWith('### ') ? it.heading.replace(/^\S+\s+/, '') : it.heading.replace(/^\d+\.\s+/, '');
  };
  // groups: one per chapter, songs in order (sub-chapters become a small heading inside the card)
  const groups = [];
  let g = null;
  for (const it of indexItems) {
    if (it.type === 'chap') {
      if (it.key.startsWith('### ')) { if (g) g.items.push({ sub: it }); continue; }
      g = { it, items: [] }; groups.push(g); continue;
    }
    if (!g) { g = { it: { key: '## 0', num: '0', heading: '' }, items: [] }; groups.push(g); }
    const s = it.song;
    if (q) {
      const tr2 = t && t.get(s.number);
      const hay = norm([s.number, s.title, s.displayTitle, tr2 ? tr2.title : '', s.chapter].join(' '));
      if (!(s.number.startsWith(q) || hay.includes(q))) continue;
    }
    g.items.push({ s });
  }
  const shownGroups = groups.filter(x => x.items.some(i => i.s));
  const nSongs = groups.reduce((n, x) => n + x.items.filter(i => i.s).length, 0);
  const out = [];
  const ashta = indexBook === 'ashta';
  if (!q) {
    const nCh = groups.filter(x => x.it.num !== '0').length;
    const meta = ashta ? `${nCh} ${ixT('ashtaOf')}${am.size ? ` · ${am.size} ${ixT('recs')}` : ''}` : `${nCh} ${ixT('ch')} · ${nSongs} ${ixT('songs')}${am.size ? ` · ${am.size} ${ixT('rec')}` : ''}`;
    out.push(`<li class="ix-meta">${esc(meta)}</li>`);
    const chips = shownGroups.map((x, gi) => {
      const label = ashta ? (x.it.num === '0' ? chapName(x.it) : ixT('ashta') + ' ' + x.it.num) : (x.it.num === '0' ? chapName(x.it) : x.it.num + ' · ' + short(chapName(x.it).split(' by ')[0], 26));
      return `<button class="ix-chip" data-ix-jump="${gi}">${esc(label)}</button>`;
    }).join('');
    out.push(`<li class="ix-go"><span class="ix-go-l">${ixT('go')}</span><div class="ix-chips">${chips}</div></li>`);
  }
  for (const [gi, x] of shownGroups.entries()) {
    const sec = q ? '' : ` data-ixsec="${gi}"`;   // 4.13: the section each Go-straight-to chip stands for
    const songsIn = x.items.filter(i => i.s).map(i => i.s);
    if (ashta && x.it.num !== '0') {
      // one card per Aṣṭapadi: the song, its ślokams as small chips, and a Recording chip
      const main = songsIn.find(s => !isSlokam(s)) || songsIn[0];
      const sl = songsIn.filter(s => s !== main);
      out.push(`<li class="row ix-acard"${sec} data-pos="${main.pos}"><span class="ix-med">${esc(x.it.num)}</span><div class="ix-at">` +
        `<span class="ix-alab">${ixT('ashta')} ${esc(x.it.num)}</span><b>${esc(titleOf(main))}</b>${subOf(main) ? `<span class="ix-asub">${esc(subOf(main))}</span>` : ''}` +
        `<span class="ix-achips">${sl.map(s => `<span class="row ix-schip" data-pos="${s.pos}">${ixT('slokam')} ${esc(s.number)}</span>`).join('')}` +
        (am.has(main.number) ? `<span class="ix-rchip">${svgI('music')}${ixT('listen')}</span>` : '') + `</span></div>${chev()}</li>`);
      continue;
    }
    if (x.it.num !== '0' || !ashta) {
      const nm = chapName(x.it), by = nm.split(' by ');
      out.push(`<li class="ix-chap"${sec}><span class="ix-med">${x.it.num === '0' ? '✦' : esc(x.it.num)}</span>` +
        `<span class="ix-ct"><b>${esc(by[0])}</b>${by[1] ? `<span>by ${esc(by[1])}</span>` : ''}</span><span class="ix-cnt">${songsIn.length} ${songsIn.length === 1 ? ixT('song1') : ixT('songs')}</span></li>`);
    }
    const rows = x.items.map(i => {
      if (i.sub) return `<li class="ix-sub">${esc(chapName(i.sub))}</li>`;
      const s = i.s, sub = subOf(s);
      return `<li class="row ix-row" data-pos="${s.pos}"><span class="ix-no">${esc(s.number)}</span>` +
        `<div class="row-text"><div class="row-title">${esc(titleOf(s))}</div>${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}</div>` +
        (am.has(s.number) ? recIcon() : '<span class="ix-au none"></span>') + chev() + '</li>';
    }).join('');
    out.push(`<li class="ix-card${ashta ? ' ix-dhy' : ''}"${ashta ? sec : ''}><ul>${rows}</ul></li>`);
  }
  ul.innerHTML = out.join('');
  $('empty').classList.toggle('hidden', nSongs > 0);
  ixActive = null;
  ixSpy(true);
}

// ---------- 4.13: Go-straight-to chips stay pinned; the chip of the section on screen is highlighted ----------
let ixActive = null, ixLockUntil = 0, ixTick = false;
/** Slides a row of chips/tabs so `el` is in the middle (smoothly, unless `now`). */
function centerInRow(row, el, now) {
  if (!row || !el) return;
  const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  row.scrollTo({ left: Math.max(0, left), behavior: now ? 'auto' : 'smooth' });
}
function ixSetActive(key, now) {
  if (key === ixActive) return;
  ixActive = key;
  const row = document.querySelector('#song-list .ix-chips');
  if (!row) return;
  let on = null;
  row.querySelectorAll('.ix-chip').forEach(b => { const a = b.dataset.ixJump === key; b.classList.toggle('on', a); if (a) on = b; });
  centerInRow(row, on, now);
}
/** Which section is at the top of the list, just under the pinned chips. */
function ixSpy(now) {
  const sc = $('index-scroll'), go = document.querySelector('#song-list .ix-go');
  if (!sc || !go || $('v-index').classList.contains('hidden')) return;
  if (!now && Date.now() < ixLockUntil) return;   // a chip was tapped: keep its highlight while the list glides there
  const line = go.getBoundingClientRect().bottom + 6;
  let key = null;
  for (const el of document.querySelectorAll('#song-list [data-ixsec]')) {
    if (el.getBoundingClientRect().top <= line) key = el.dataset.ixsec; else break;
  }
  ixSetActive(key || '0', now);
}
document.addEventListener('DOMContentLoaded', () => {});
(function () {
  const sc = document.getElementById('index-scroll');
  if (sc) sc.addEventListener('scroll', () => {
    if (ixTick) return;
    ixTick = true;
    requestAnimationFrame(() => { ixTick = false; ixSpy(false); });
  }, { passive: true });
})();
document.addEventListener('click', e => {
  const c = e.target.closest('[data-ix-jump]');
  if (!c) return;
  const sc = $('index-scroll'), go = document.querySelector('#song-list .ix-go');
  const el = document.querySelector(`#song-list [data-ixsec="${c.dataset.ixJump}"]`);
  ixSetActive(c.dataset.ixJump, false);
  if (el && sc) {
    // straight there (a long glide over many chapters feels slow): the header lands just under the pinned chips
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (go ? go.offsetHeight : 0) - 4;
    ixLockUntil = Date.now() + 120;
    sc.scrollTo({ top: Math.max(0, Math.round(top)), behavior: 'auto' });
  }
});


// ---------- Prabandham index: Āyiram › work › decade › pāsurams, as drop-downs ----------
const AYIRAM_NAMES = {
  'Mudhal Ayiram': { en: 'Mudhal Āyiram', ta: 'முதலாயிரம்', kn: 'ಮುದಲಾಯಿರಂ', sa: 'मुदलायिरम्' },
  'Irandam Ayiram · Periya Thirumozhi': { en: 'Iraṇḍām Āyiram', ta: 'இரண்டாமாயிரம்', kn: 'ಇರಂಡಾಮಾಯಿರಂ', sa: 'इरण्डामायिरम्' },
  'Moonram Ayiram · Iyarpa': { en: 'Mūnṛām Āyiram · Iyaṛpā', ta: 'மூன்றாமாயிரம் · இயற்பா', kn: 'ಮೂನ್ಱಾಮಾಯಿರಂ · ಇಯಱ್ಪಾ', sa: 'मून्ऱामायिरम् · इयऱ्पा' },
  'Nangam Ayiram · Thiruvaymozhi': { en: 'Nāṅgām Āyiram · Thiruvāymozhi', ta: 'நான்காமாயிரம் · திருவாய்மொழி', kn: 'ನಾಂಗಾಮಾಯಿರಂ · ತಿರುವಾಯ್ಮೊಳಿ', sa: 'नान्गामायिरम् · तिरुवाय्मॊळि' },
  'Appendix': { en: 'Appendix', ta: 'பின்னிணைப்பு', kn: 'ಅನುಬಂಧ', sa: 'परिशिष्टम्' },
};
const AZHVAR_NAMES = {
  'Periyazhvar': ['பெரியாழ்வார்', 'ಪೆರಿಯಾಳ್ವಾರ್', 'पॆरियाळ्वार्'], 'Andal': ['ஆண்டாள்', 'ಆಂಡಾಳ್', 'आण्डाळ्'],
  'Kulasekhara Azhvar': ['குலசேகர ஆழ்வார்', 'ಕುಲಶೇಖರ ಆಳ್ವಾರ್', 'कुलशेखर आळ्वार्'], 'Thirumazhisai Azhvar': ['திருமழிசை ஆழ்வார்', 'ತಿರುಮಳಿಸೈ ಆಳ್ವಾರ್', 'तिरुमळिसै आळ्वार्'],
  'Thondaradippodi Azhvar': ['தொண்டரடிப்பொடி ஆழ்வார்', 'ತೊಂಡರಡಿಪ್ಪೊಡಿ ಆಳ್ವಾರ್', 'तॊण्डरडिप्पॊडि आळ्वार्'], 'Thiruppan Azhvar': ['திருப்பாணாழ்வார்', 'ತಿರುಪ್ಪಾಣಾಳ್ವಾರ್', 'तिरुप्पाणाळ्वार्'],
  'Madhurakavi Azhvar': ['மதுரகவி ஆழ்வார்', 'ಮಧುರಕವಿ ಆಳ್ವಾರ್', 'मधुरकवि आळ्वार्'], 'Thirumangai Azhvar': ['திருமங்கை ஆழ்வார்', 'ತಿರುಮಂಗೈ ಆಳ್ವಾರ್', 'तिरुमङ्गै आळ्वार्'],
  'Poigai Azhvar': ['பொய்கை ஆழ்வார்', 'ಪೊಯ್ಗೈ ಆಳ್ವಾರ್', 'पॊय्गै आळ्वार्'], 'Bhoothathazhvar': ['பூதத்தாழ்வார்', 'ಭೂತತ್ತಾಳ್ವಾರ್', 'भूतत्ताळ्वार्'],
  'Peyazhvar': ['பேயாழ்வார்', 'ಪೇಯಾಳ್ವಾರ್', 'पेयाळ्वार्'], 'Nammazhvar': ['நம்மாழ்வார்', 'ನಮ್ಮಾಳ್ವಾರ್', 'नम्माळ्वार्'],
  'Thiruvarangathamudhanar': ['திருவரங்கத்தமுதனார்', 'ತಿರುವರಂಗತ್ತಮುದನಾರ್', 'तिरुवरङ्गत्तमुदनार्'],
};
const NX_UI = {
  pas: { en: 'pāsurams', ta: 'பாசுரங்கள்', kn: 'ಪಾಶುರಗಳು', sa: 'पाशुराः' },
  dec: { en: 'decades', ta: 'பதிகங்கள்', kn: 'ಪದಿಗಗಳು', sa: 'दशकाः' },
};
const nxT = k => NX_UI[k].en;   // SCRUM-94: counts in English
let nxOpen = store.get('nxOpen', { work: '', dec: '' });   // remembered, so Back from a pāsuram returns to the same place
function ndpTree() {
  const tree = [];
  let ay = null, wk = null, dc = null;
  for (const it of indexItems) {
    if (it.type !== 'song') continue;
    const s = it.song;
    if (!ay || ay.name !== s.ayiram) { ay = { name: s.ayiram, works: [] }; tree.push(ay); wk = null; }
    if (!wk || wk.no !== s.workNo) { wk = { no: s.workNo, name: s.chapter, decades: [], songs: [] }; ay.works.push(wk); dc = null; }
    wk.songs.push(s);
    if (s.decade) {
      if (!dc || dc.ref !== s.decade) { dc = { ref: s.decade, name: s.decadeName, songs: [] }; wk.decades.push(dc); }
      dc.songs.push(s);
    }
  }
  return tree;
}
const nxRange = l => l.length === 1 ? l[0].number : l[0].number + '–' + l[l.length - 1].number;
function renderNdpTree(t, am) {
  const lang = prefs.lang, tree = ndpTree();
  const songRow = s => {
    const tr = t && t.get(s.number), title = tr && tr.title ? tr.title : s.displayTitle;
    return `<li class="row nx-song" data-pos="${s.pos}"><span class="badge">${esc(s.number)}</span>` +
      `<div class="row-text"><div class="row-title">${esc(title)}</div></div>` +
      (am.has(s.number) ? '<span class="has-audio" aria-label="Audio available">♪</span>' : '') + '</li>';
  };
  const workName = w => {
    const [title, poet] = w.name.split(' · ');
    const tr = t && t.get(w.songs[0].number);
    const local = tr && tr.raga ? tr.raga.replace(/\s+[\d-]+$/, '') : '';
    const pl = AZHVAR_NAMES[poet] && { ta: 0, kn: 1, sa: 2 }[lang] !== undefined ? AZHVAR_NAMES[poet][{ ta: 0, kn: 1, sa: 2 }[lang]] : poet;
    return { title: local || title, poet: pl || '' };
  };
  const out = [];
  const total = tree.reduce((n, ay) => n + ay.works.reduce((m, w) => m + w.songs.length, 0), 0);
  out.push(`<li class="ix-meta">${total} ${ixT('ndpOf')}${am.size ? ` · ${am.size} ${ixT('recs')}` : ''}</li>`);
  // 4.10: the Āyirams as tabs; one Āyiram's works at a time
  let ai = store.get('nxAy', 0); if (ai >= tree.length) ai = 0;
  out.push(`<li class="nx-tabs" role="tablist">` + tree.map((ay, k) => {
    const an = (AYIRAM_NAMES[ay.name] || {})[lang] || (AYIRAM_NAMES[ay.name] || {}).en || ay.name;
    const [main, sub] = an.split(' · ');
    return `<button role="tab" class="nx-tab${k === ai ? ' on' : ''}" data-nx-ay="${k}" aria-selected="${k === ai}"><b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`;
  }).join('') + `</li>`);
  for (const ay of [tree[ai]]) {
    for (const w of ay.works) {
      const open = nxOpen.work === w.no, wn = workName(w);
      out.push(`<li class="nx-work ${open ? 'open' : ''}"><button class="nx-head" data-nx-work="${esc(w.no)}" aria-expanded="${open}">` +
        `<span class="nx-no">${esc(w.no)}</span><span class="nx-t"><b>${esc(wn.title)}</b>` +
        (wn.poet ? `<span>${esc(wn.poet)}</span>` : '') + `<span class="nx-meta">${w.songs.length} ${nxT('pas')}${w.decades.length ? ' · ' + w.decades.length + ' ' + nxT('dec') : ''}</span></span>` +
        `<span class="nx-rng">${esc(nxRange(w.songs))}</span>` +
        `<svg class="nx-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`);
      if (open) {
        out.push('<ul class="nx-body">');
        if (w.decades.length) {
          for (const d of w.decades) {
            const dOpen = nxOpen.dec === d.ref;
            const tr = t && t.get(d.songs[0].number);
            const dn = lang === 'en' ? d.name : (tr && tr.title ? tr.title.split(/\s+/).slice(0, 3).join(' ') : d.name);
            out.push(`<li class="nx-dec ${dOpen ? 'open' : ''}"><button class="nx-dhead" data-nx-dec="${esc(d.ref)}" aria-expanded="${dOpen}">` +
              `<span class="nx-ref">${esc(d.ref)}</span><span class="nx-t"><b>${esc(dn)}</b><span>${d.songs.length} ${nxT('pas')}</span></span><span class="nx-rng">${esc(nxRange(d.songs))}</span>` +
              `<svg class="nx-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
              (dOpen ? '<ul class="nx-songs">' + d.songs.map(songRow).join('') + '</ul>' : '') + '</li>');
          }
        } else out.push('<li><ul class="nx-songs">' + w.songs.map(songRow).join('') + '</ul></li>');
        out.push('</ul>');
      }
      out.push('</li>');
    }
  }
  $('song-list').innerHTML = out.join('');
  $('empty').classList.add('hidden');
  // 4.13: the Āyiram tabs keep their sideways place and slide the chosen one into view (e.g. Appendix)
  const tabs = document.querySelector('#song-list .nx-tabs');
  if (tabs) {
    tabs.scrollLeft = nxTabsX;
    tabs.addEventListener('scroll', () => { nxTabsX = tabs.scrollLeft; }, { passive: true });
    centerInRow(tabs, tabs.querySelector('.nx-tab.on'), false);
  }
}
let nxTabsX = 0;
document.addEventListener('click', e => {
  const tb = e.target.closest('[data-nx-ay]');
  if (tb) { store.set('nxAy', +tb.dataset.nxAy); renderIndex('').then(() => { $('index-scroll').scrollTop = 0; }); return; }
  const w = e.target.closest('[data-nx-work]'), d = e.target.closest('[data-nx-dec]');
  if (!w && !d) return;
  if (w) nxOpen = { work: nxOpen.work === w.dataset.nxWork ? '' : w.dataset.nxWork, dec: '' };
  else nxOpen = { work: nxOpen.work, dec: nxOpen.dec === d.dataset.nxDec ? '' : d.dataset.nxDec };
  store.set('nxOpen', nxOpen);
  renderIndex('').then(() => {   // keep the tapped heading in view, just under the top bar
    const sel = w ? `[data-nx-work="${w.dataset.nxWork}"]` : `[data-nx-dec="${d.dataset.nxDec}"]`;
    const h = document.querySelector(sel); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
});


// chapter names in the chosen language: the "## n | name" and "### n | name" lines of songs_<lang>.txt
const headCache = {};
function loadHeads(file) {
  const key = bf(file);
  if (!headCache[key]) {
    headCache[key] = fetchText(key).then(t => {
      const m = new Map();
      for (const line of t.replace(/\r/g, '').split('\n')) {
        const sub = line.startsWith('### '), top = !sub && line.startsWith('## ');
        if (!sub && !top) continue;
        const h = line.slice(sub ? 4 : 3).split('|'), k = (sub ? '### ' : '## ') + h[0].trim();
        if (!m.has(k)) m.set(k, part(h, 1));
      }
      return m;
    }).catch(() => new Map());
  }
  return headCache[key];
}
function chapHeading(it, heads) {
  const n = heads && it.num !== undefined ? heads.get(it.key.startsWith('### ') ? it.key : '## ' + it.num) : '';
  if (!n) return it.heading;
  return it.key.startsWith('### ') ? it.num + '   ' + n : it.num === '0' ? n : it.num + '.  ' + n;
}

function openSearch() { $('search-input').focus(); }
function closeSearch() {
  $('search-input').value = '';
  $('btn-close-search').classList.add('hidden');
  renderIndex('');
}

// ---------- song ----------
let cur = 0, tab = 0;
let openTab = null;   // the Listen button opens a song on its Audio tab (SCRUM-62)
const PAGES = ['s-lyrics', 's-meaning', 's-audio', 's-composer'];

function splitSummary(text) {
  for (const m of ['\nMeaning Summary\n', '\nSummary\n']) {
    const i = text.indexOf(m);
    if (i >= 0) return [text.slice(0, i).trim(), text.slice(i + m.length).trim()];
  }
  return [text, ''];
}

const HEADS = /^(Overall Summary|Key Takeaway|Deeper Meaning|Word meanings?|Word by word meaning|Detailed meaning|Simple \(and complete\) meaning|Summary meaning|Spiritual meaning|Spiritual significance|Overall essence|Key spiritual highlight|A beautiful closing.*|A closing line.*|Takeaways for the upanyasam|Meaning, verse by verse|The shloka|The abhang|Pallavi|Anupallavi|Charanam ?\d*|ಪದಾರ್ಥ|ಪದಶಃ ಅರ್ಥ|ವಿಸ್ತೃತ ಅರ್ಥ|ಸರಳ ಮತ್ತು ಸಂಪೂರ್ಣ ಅರ್ಥ|ಒಟ್ಟು ಅರ್ಥ|ಆಧ್ಯಾತ್ಮಿಕ (ಅರ್ಥ|ಮಹತ್ವ)|ಸಂಪೂರ್ಣ .*ಸಾರ|ಮುಖ್ಯ ಆಧ್ಯಾತ್ಮಿಕ ವಿಶೇಷತೆ|ಉಪನ್ಯಾಸ.*|ಮುಕ್ತಾಯದ ಸಾಲು|ಪದ್ಯವಾರು ಅರ್ಥ|ಪಲ್ಲವಿ|ಅನುಪಲ್ಲವಿ|.*ಚರಣ|ಶ್ಲೋಕ|ಅಭಂಗ|சொல் வாரியாக.*|மொத்த அர்த்தம்.*|ஆன்மீக முக்கியத்துவம்.*|உபந்யாச.*|முடிவு வரி|பதவுரை|சாராம்சம்|முக்கியத்துவம்|பொருள்|பல்லவி|அனுபல்லவி|சரணம்.*)$/;

// Ashtapathy meanings: section headings, the first line of each verse, and the labels inside a verse
const A_HEADS = /^(Summary|Upanyasam take-away|Detailed meaning.*|ஸங்க்ஷேபமான அர்த்தம்|உபந்யாஸ ஸாரம்.*|விஸ்தாரமான அர்த்தம்.*|ಸಾರಾಂಶ|ಉಪನ್ಯಾಸ ಸಾರ.*|ವಿಸ್ತೃತ ಅರ್ಥ.*)$/;
const A_LABEL = /^(Meaning:|Key message:|அர்த்தம்:|கருத்து:|ಅರ್ಥ:|ಮುಖ್ಯ ಸಂದೇಶ:)/;
function meaningHtml(text) {
  const newFmt = /(^|\n)Deeper Meaning\n/.test(text);   // 4.20: Overall Summary · Key Takeaway · Deeper Meaning (SCRUM-90)
  return text.split('\n').map(l => {
    const t = l.trim();
    if (book.id === 'ashta') {
      if (A_HEADS.test(t)) return `<b class="mh">${esc(t)}</b>`;
      if (/^\d+\. /.test(t)) return `<span class="vl">${esc(t)}</span>`;
      const m = t.match(A_LABEL);
      if (m) return `<span class="lb">${esc(m[1])}</span>${esc(t.slice(m[1].length))}`;
      return esc(l);
    }
    if (newFmt && t.length < 120 && /^(\d+\.\d+\.\d+ |\d+\. )/.test(t)) return `<span class="vl">${esc(t)}</span>`;   // song parts and numbered points
    return t && t.length < 70 && HEADS.test(t) ? `<b>${esc(l)}</b>` : esc(l);
  }).join('\n');
}

// keep "।", "॥" and ".." on the same line as the word before them
const nb = t => t.replace(/[ \t]+(?=[।॥]|\.\.?(?=\s|$))/g, '\u00A0');
const short = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

function renderLangChips() {
  $('lang-chips').innerHTML = LANGS.map(l =>
    `<button class="chip${l.code === prefs.lang ? ' sel' : ''}" data-lang="${l.code}">${l.label}</button>`).join('');
}
$('lang-chips').onclick = e => {
  const b = e.target.closest('[data-lang]');
  if (!b || b.dataset.lang === prefs.lang) return;
  // remember how far down each page was, as a share of its length, so the reader stays at the same place
  const frac = PAGES.map(id => { const el = $(id); const m = el.scrollHeight - el.clientHeight; return m > 0 ? el.scrollTop / m : 0; });
  prefs.lang = b.dataset.lang;
  showSong(cur, true, frac);
  renderIndex($('search-input').value);
};

function renderMeaningChips() {
  const heads = [...$('meaning').querySelectorAll('b')].filter(h => h.textContent.trim());
  const box = $('mean-chips');
  if (heads.length < 2) { box.innerHTML = ''; box.dataset.n = 0; selectTab(tab); return; }
  heads.forEach((h, i) => { h.id = 'mh' + i; });
  const pick = book.id === 'ashta' ? heads.filter(h => h.classList.contains('mh')) : heads;
  const list = (pick.length >= 2 ? pick : heads).slice(0, 12);
  box.innerHTML = list.map((h, i) => `<button class="chip${i === 0 ? ' sel' : ''}" data-to="${h.id}">${esc(short(h.textContent.trim().replace(/[:：]$/, ''), 22))}</button>`).join('');
  box.dataset.n = list.length;
  selectTab(tab);
}
$('mean-chips').onclick = e => {
  const b = e.target.closest('[data-to]');
  if (!b) return;
  const el = $(b.dataset.to), sc = $('s-meaning');
  sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12, behavior: 'smooth' });
  $('mean-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === b));
  $('mean-chips').scrollTo({ left: b.offsetLeft - ($('mean-chips').clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
};
$('s-meaning').addEventListener('scroll', () => {
  const chips = [...$('mean-chips').querySelectorAll('.chip')];
  if (!chips.length) return;
  const top = $('s-meaning').getBoundingClientRect().top + 40;
  let on = chips[0];
  for (const c of chips) { const el = $(c.dataset.to); if (el && el.getBoundingClientRect().top <= top) on = c; }
  const sc = $('s-meaning'); if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) on = chips[chips.length - 1];   // at the end: the last section
  if (!on.classList.contains('sel')) {
    chips.forEach(c => c.classList.toggle('sel', c === on));
    const box = $('mean-chips');   // keep the section being read in view in the row of headings
    box.scrollTo({ left: on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }
}, { passive: true });

async function showSong(pos, keepTab, keepScroll) {
  const changed = pos !== cur || !keepTab;
  cur = Math.max(0, Math.min(songs.length - 1, pos));
  const s = songs[cur];
  paintPlBar();
  const lang = prefs.lang;
  const t = lang === 'en' ? null : (await loadText(lyricsFile(lang))).get(s.number);
  const title = t ? t.title : s.displayTitle;
  const raga = t ? t.raga : s.displayRaga;
  const parts = splitSummary(t ? t.body : s.lyrics);
  let lyrics = nb(esc(parts[0]));
  const summary = parts[1] || splitSummary(s.lyrics)[1];
  if (!t && lang !== 'en') {
    const name = LANGS.find(l => l.code === lang).name;
    lyrics = `<span class="note">(${name} text is not given in the book for this song – showing English.)</span>\n\n` + lyrics;
  }
  $('song-title').textContent = title;
  $('song-meta').dataset.raga = raga || (t ? s.displayTitle : '');
  $('song-meta').textContent = $('song-meta').dataset.raga;
  $('crumb').textContent = s.number + '  ·  ' + (cur + 1) + ({ en: ' of ', ta: ' / ', kn: ' / ', sa: ' / ' }[prefs.lang] || ' of ') + songs.length;
  $('lyrics').innerHTML = lyrics;
  $('audio-lyrics').innerHTML = lyrics;
  // Record with sruti is on hold: the button stays hidden
  renderLangChips();
  const prev = songs[cur - 1], next = songs[cur + 1];
  $('btn-prev').textContent = prev ? '‹ ' + prev.number + ' ' + short(prev.displayTitle, 14) : '';
  $('btn-next').textContent = next ? next.number + ' ' + short(next.displayTitle, 14) + ' ›' : '';
  $('btn-prev').classList.toggle('hidden', !prev);
  $('btn-next').classList.toggle('hidden', !next);
  plNav();

  // meaning: reader's language, falling back to the Tamil original
  let m = (await loadText(meaningFile(lang))).get(s.number);
  if (!m && meaningFile(lang) !== 'meanings_ta.txt') m = (await loadText('meanings_ta.txt')).get(s.number);
  let mh = m && m.body ? nb(meaningHtml(m.body)) : '';
  if (summary) mh += (mh ? '\n\n— — —\n\n' : '') + nb(esc(summary));
  $('meaning').innerHTML = mh || 'The meaning of this song will be added soon.';
  renderMeaningChips();

  // audio: a new song stops the old one; changing only the language keeps it playing
  const url = audioUrl((await loadAudio()).get(s.number));
  const a = $('audio');
  if (changed || a.dataset.src !== (url || '')) {
    stopAudio();
    a.dataset.src = url || '';
    a.removeAttribute('src');
    $('seek').disabled = true; $('seek').value = 0;
    $('pos').textContent = '0:00'; $('len').textContent = '0:00';
    $('audio-status').textContent = url ? '' : 'A recording of this song will be added soon.';
    setSeekFill(0); cpState(url ? 'Tap to play' : '');
  }
  $('tab-audio').textContent = url ? 'Audio ♪' : 'Audio';
  $('btn-play').disabled = !url;
  ['btn-back10', 'btn-fwd10', 'btn-repeat', 'btn-speed'].forEach(id => { $(id).disabled = !url; });

  selectTab(openTab !== null ? openTab : (keepTab ? tab : 0));
  openTab = null;
  if (keepScroll) {
    PAGES.forEach((id, i) => { const el = $(id); el.scrollTop = keepScroll[i] * (el.scrollHeight - el.clientHeight); });
  } else if (changed) PAGES.forEach(id => { $(id).scrollTop = 0; });
  updateFav();
  const h = book.hash + s.number;
  if (location.hash !== h) replaceHash(h);
  store.set('last', { book: book.id, number: s.number, title: s.displayTitle });
}

function selectTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('sel', +b.dataset.tab === t));
  PAGES.forEach((id, i) => $(id).classList.toggle('hidden', i !== t));   // each page keeps its own place
  const meaningChips = t === 1 && +($('mean-chips').dataset.n || 0) > 0;
  $('mean-chips').classList.toggle('hidden', !meaningChips);
  $('lang-chips').classList.toggle('hidden', t === 1 || t === 3);
  $('song-meta').textContent = t === 1 ? ({ en: 'Meaning in English', ta: 'தமிழில் பொருள்', kn: 'ಕನ್ನಡದಲ್ಲಿ ಅರ್ಥ', sa: 'अर्थः आङ्ग्लभाषायाम्' })[prefs.lang]
    : ($('song-meta').dataset.raga || '');
}

function openSong(pos) { go(book.hash + songs[pos].number); }
// opened from a satsang's list: ‹ › at the bottom move through that list, not the book
const plIndex = () => plNow ? plNow.hashes.indexOf(location.hash) : -1;
const plStep = d => { const i = plIndex(); return i < 0 ? null : plNow.hashes[i + d] || null; };
function plNav() {
  const i = plIndex(); if (i < 0) return;
  const p = plNow.hashes[i - 1], n = plNow.hashes[i + 1];
  $('btn-prev').textContent = p ? '‹ ' + (i) + '. ' + short(plNow.titles[i - 1], 14) : '';
  $('btn-next').textContent = n ? (i + 2) + '. ' + short(plNow.titles[i + 1], 14) + ' ›' : '';
  $('btn-prev').classList.toggle('hidden', !p); $('btn-next').classList.toggle('hidden', !n);
}
function paintPlBar() {
  const bar = $('pl-bar'), h = location.hash, i = plNow ? plNow.hashes.indexOf(h) : -1;
  if (i < 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `${svgI('music')}<span class="pl-mid"><span>${esc(plNow.name)} · song ${i + 1} of ${plNow.hashes.length}</span></span><button class="pl-all" data-go="#satsang/${esc(plNow.last)}">All songs</button>`;
}
function closeSong() { back(navStack.length > 1 ? undefined : '#book/' + book.id); }   // back to where we came from (Learn, Favourites…)

function setScale(v) {
  prefs.scale = v;
  applyLook();
}

// pinch with two fingers changes the text size (instead of zooming the whole page)
(function pinch() {
  let d0 = 0, s0 = 1;
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  for (const el of [$('v-song'), $('v-other')]) {   // 4.18: also the words of an other song
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e); s0 = prefs.scale; } }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    setScale(s0 * dist(e) / d0);
  }, { passive: false });
  el.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }
  // iPhone Safari's own page zoom
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
})();

// ---------- audio ----------
const fmt = s => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function cpState(t) { $('cp-state').textContent = t; }
function setSeekFill(v) { $('seek').style.setProperty('--p', (v / 10) + '%'); }
function setPlayIcon(playing) {
  document.querySelector('.i-play').classList.toggle('hidden', playing);
  document.querySelector('.i-pause').classList.toggle('hidden', !playing);
  $('btn-play').setAttribute('aria-label', tr(playing ? 'Pause' : 'Play'));   // screen readers say what the button will do
}
function stopAudio() {
  const a = $('audio');
  a.pause(); setPlayIcon(false);
}
function togglePlay() {
  const a = $('audio');
  if (!a.dataset.src) return;
  if (!a.getAttribute('src')) { a.src = a.dataset.src; $('audio-status').textContent = 'Loading… (needs internet)'; }
  if (a.paused) a.play().catch(() => { $('audio-status').textContent = 'Could not play. Please check the internet connection and try again.'; });
  else a.pause();
}
(function audioEvents() {
  const a = $('audio'), seek = $('seek');
  let seeking = false;
  a.addEventListener('play', () => { setPlayIcon(true); cpState('Playing'); });
  a.addEventListener('pause', () => { setPlayIcon(false); if (a.getAttribute('src')) cpState('Paused'); });
  a.addEventListener('playing', () => { $('audio-status').textContent = ''; });
  a.addEventListener('loadedmetadata', () => { const ok = isFinite(a.duration); $('len').textContent = ok ? fmt(a.duration) : '–:––'; seek.disabled = !ok; });   // SCRUM-101: a file without its length
  a.addEventListener('timeupdate', () => {
    if (seeking || !a.duration || !isFinite(a.duration)) return;
    seek.value = Math.round(1000 * a.currentTime / a.duration); setSeekFill(seek.value);
    $('pos').textContent = fmt(a.currentTime);
  });
  a.addEventListener('ended', () => { setPlayIcon(false); seek.value = 0; setSeekFill(0); cpState('Tap to play'); });
  a.addEventListener('error', () => { if (a.getAttribute('src')) { setPlayIcon(false); $('audio-status').textContent = 'Could not play. Please check the internet connection and try again.'; } });
  seek.addEventListener('input', () => { seeking = true; setSeekFill(seek.value); if (a.duration) $('pos').textContent = fmt(a.duration * seek.value / 1000); });
  seek.addEventListener('change', () => { if (a.duration) a.currentTime = a.duration * seek.value / 1000; seeking = false; });
  const jump = d => { if (a.getAttribute('src') && a.duration) a.currentTime = Math.max(0, Math.min(a.duration - 0.5, a.currentTime + d)); };
  $('btn-back10').onclick = () => jump(-10);
  $('btn-fwd10').onclick = () => jump(10);
  $('btn-repeat').onclick = () => {
    a.loop = !a.loop;
    $('btn-repeat').classList.toggle('on', a.loop);
    $('btn-repeat').setAttribute('aria-pressed', a.loop);
  };
  const SPEEDS = [1, 1.25, 1.5, 0.75];
  let sp = 0;
  $('btn-speed').onclick = () => {
    sp = (sp + 1) % SPEEDS.length;
    a.playbackRate = a.defaultPlaybackRate = SPEEDS[sp];
    $('btn-speed').textContent = SPEEDS[sp] + '×';
    $('btn-speed').classList.toggle('on', SPEEDS[sp] !== 1);
  };
  a.addEventListener('loadedmetadata', () => { a.playbackRate = SPEEDS[sp]; });
})();

// ---------- keep screen on ----------
let wakeLock = null, wantAwake = false;
async function keepAwake(on) {
  wantAwake = on && prefs.screenOn;
  try {
    if (wantAwake && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wantAwake && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake) keepAwake(true); });

// ---------- language buttons (settings) ----------
function langButtons(container, onPick) {
  container.innerHTML = LANGS.map(l =>
    `<button class="lang-opt${l.code === prefs.lang ? ' sel' : ''}" data-lang="${l.code}">${l.label}</button>`).join('');
  container.onclick = e => {
    const b = e.target.closest('[data-lang]');
    if (b) onPick(b.dataset.lang);
  };
}

// ---------- settings ----------
function openSettings() {
  paintLangBars();
  $('sw-screen').checked = prefs.screenOn;
  $('sw-night').checked = prefs.night;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('install-h').classList.toggle('hidden', standalone);
  $('install-text').classList.toggle('hidden', standalone);
  const ver = f => fetchText(f).then(t => (t.match(/version=(\d+)/) || [])[1] || '?').catch(() => '?');
  Promise.all([ver('manifest.txt'), ver('ashtapathy/manifest.txt'), ver('prabandham/manifest.txt')]).then(([a, b, c]) => {
    $('admin-link').classList.remove('hidden');   // the admin page asks admins to sign in
    $('version-info').textContent = (store.get('contentAt', 0) ? 'Content updated: ' + new Date(store.get('contentAt', 0)).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + '\n' : '') + 'Web app ' + WEB_VERSION + '  ·  Divyanama content ' + a + '  ·  Ashtapathy content ' + b + '  ·  Prabandham content ' + c;
  });
  showView('v-settings');
}
function closeSettings() {
  prefs.setupDone = true;
  back('');
}
$('sw-screen').addEventListener('change', e => { prefs.screenOn = e.target.checked; });
$('sw-night').addEventListener('change', e => { prefs.night = e.target.checked; applyLook(); });

// ---------- wiring ----------
$('btn-search').onclick = openSearch;
$('btn-close-search').onclick = closeSearch;
$('search-input').addEventListener('input', e => { $('btn-close-search').classList.toggle('hidden', !e.target.value); renderIndex(e.target.value); });
$('btn-books').onclick = () => back('');   // home button (SCRUM-53)
$('btn-settings-back').onclick = closeSettings;
$('btn-done').onclick = closeSettings;
$('song-list').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (r) openSong(+r.dataset.pos);
});
$('btn-back').onclick = closeSong;
// 4.18: in a satsang's list, ‹ › take the place of the song (no new history entry), so Back always returns to the list (as on Android)
function plGo(h) { replaceHash(h); route(); }
$('btn-prev').onclick = () => { const p = plStep(-1); if (p) return plGo(p); showSong(cur - 1, true); };
$('btn-next').onclick = () => { const p = plStep(1); if (p) return plGo(p); showSong(cur + 1, true); };
$('btn-smaller').onclick = () => setScale(prefs.scale / STEP);
$('btn-bigger').onclick = () => setScale(prefs.scale * STEP);
$('btn-play').onclick = togglePlay;
document.querySelectorAll('.tab').forEach(b => { b.onclick = () => selectTab(+b.dataset.tab); });

// ---------- books ----------
async function loadBook(id) {
  if (!loaded[id]) {
    const b = BOOKS[id];
    if (!loaded['p_' + id]) loaded['p_' + id] = fetchText(b.base + 'songs.txt').then(parseSongs).catch(e => { delete loaded['p_' + id]; throw e; });
    loaded[id] = await loaded['p_' + id];
  }
  return loaded[id];
}

let indexBook = null;
async function useBook(id) {
  book = BOOKS[id];
  store.set('book', id);
  const d = await loadBook(id);
  songs = d.songs; indexItems = d.indexItems;
}

let indexLang = '';   // SCRUM-96: the language the index list was last built in
async function showIndex(id, fromSong) {
  const fresh = indexBook !== id;
  // SCRUM-96: the list is kept for speed, but it was built in one language – if the language was changed elsewhere
  // (e.g. on Home) since then, build it again in place, keeping the scroll position
  const relang = !fresh && indexLang !== prefs.lang;
  $('book-title').textContent = bookTitle(id);
  $('search-input').placeholder = tr(BOOKS[id].search);
  $('empty').textContent = tr('No ' + BOOKS[id].unit + ' found');
  if (fresh) {
    $('search-input').value = '';
    $('btn-close-search').classList.add('hidden');
    $('song-list').innerHTML = '';
    $('loading').textContent = 'Loading…';
    $('loading').classList.remove('hidden');
  }
  showView('v-index');
  try { await useBook(id); } catch (e) {
    $('loading').textContent = 'Could not load. Please connect to the internet once and open the app again.';
    return;
  }
  $('loading').classList.add('hidden');
  if (fresh) { indexBook = id; indexLang = prefs.lang; await renderIndex(''); $('index-scroll').scrollTop = 0; }
  else if (relang) { indexLang = prefs.lang; await renderIndex($('search-input').value || ''); }
  if (fromSong && songs[cur]) {
    const row = document.querySelector(`.row[data-pos="${cur}"]`);
    if (row) row.scrollIntoView({ block: 'center' }); else $('index-scroll').scrollTop = indexScroll;
  } else if (!fresh) $('index-scroll').scrollTop = indexScroll;
  // warm up the files this reader needs, so they work offline later
  const lang = prefs.lang;
  if (lang !== 'en') loadText(lyricsFile(lang));
  loadText(meaningFile(lang));
  loadAudio();
}

async function showSongRoute(id, number) {
  try { await useBook(id); } catch (e) { toast('Could not load. Please check the internet.'); return; }
  const s = songs.find(x => x.number === number);
  if (!s) { replaceHash('#book/' + id); return route(); }
  if (indexBook !== id) { indexBook = null; }
  const wasSong = !$('v-song').classList.contains('hidden');
  showView('v-song');
  await showSong(s.pos, wasSong && s.pos === cur);
  keepAwake(true);
}

// ---------- navigation: every screen has its own #link, so the iPhone's back swipe and our Back buttons agree ----------
const navStack = [location.hash];
function go(hash) {
  history.pushState(null, '', hash || location.pathname + location.search);
  navStack.push(hash || '');
  route();
}
function replaceHash(hash) {
  history.replaceState(null, '', hash || location.pathname + location.search);
  navStack[navStack.length - 1] = hash || '';
}
/** Back: to the screen we came from, or (when this screen was opened directly) to `target`. */
function back(target) {
  const prev = navStack[navStack.length - 2];
  if (navStack.length > 1 && (target === undefined || prev === target)) { history.back(); return; }
  replaceHash(target || '');
  route();
}
window.addEventListener('popstate', () => {
  if (navStack.length > 1) navStack.pop();
  navStack[navStack.length - 1] = location.hash;
  route();
});

function route() {
  const h = decodeURIComponent(location.hash || '');
  if (accessGate(h)) return;
  if (!h || h === '#' || h === '#home') return showHome();
  if (h === '#about') return openAbout();
  if (h === '#settings') return openSettings();
  if (h === '#welcome') return showWelcome();
  if (h === '#diary') return showDiary();
  if (h.startsWith('#satsang/')) return showPlaylist(decodeURIComponent(h.slice(9)));
  if (h === '#learn') return showLearn();
  if (h === '#favs') return showFavs();
  if (h === '#tfd') return showTfdList();
  if (h.startsWith('#tfd/')) return showTfd(h.slice(5));
  if (h.startsWith('#other/')) return showOther(h.slice(7));
  if (h.startsWith('#share/')) return showShare(h.slice(7));
  if (h.startsWith('#book/') && BOOKS[h.slice(6)]) return showIndex(h.slice(6), !$('v-song').classList.contains('hidden'));
  for (const b of Object.values(BOOKS)) if (h.startsWith(b.hash)) return showSongRoute(b.id, h.slice(b.hash.length));
  replaceHash('');
  return showHome();
}

// ---------- voice search ----------
// Voice search: finds songs whose title or rāgam sounds like what was heard.
const VM_STOP = new Set(['raga','ragam','raagam','raag','rag','song','songs','bhajan','bhajans','play','open','show','find','search','the','a','of','in','ashtapadi','astapadi','ashtapathi','ashtapathy','please','me','namavali','kirtan','kirtanam']);
function vmBase(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function vmKey(w) {   // spelling-independent sound key for one word
  w = w.replace(/x/g, 'ks').replace(/q/g, 'k').replace(/w/g, 'v').replace(/z/g, 's')
    .replace(/([kgcjtdpb])h/g, '$1').replace(/sh/g, 's').replace(/ph/g, 'p')
    .replace(/ee|ii|ie/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/ai/g, 'e').replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
  return w;
}
function vmWords(s) { return vmBase(s).split(' ').filter(w => w && !VM_STOP.has(w)).map(vmKey).filter(Boolean); }
function vmGrams(s, n) { const g = []; const t = ' ' + s + ' '; for (let i = 0; i + n <= t.length; i++) g.push(t.slice(i, i + n)); return g; }
function vmDice(a, b, n) {
  if (!a || !b) return 0; if (a === b) return 1;
  const A = vmGrams(a, n), B = vmGrams(b, n), m = new Map();
  for (const g of A) m.set(g, (m.get(g) || 0) + 1);
  let hit = 0; for (const g of B) { const c = m.get(g); if (c) { hit++; m.set(g, c - 1); } }
  return 2 * hit / (A.length + B.length);
}
function vmScore(q, field) {   // q: array of word keys
  const f = vmWords(field); if (!q.length || !f.length) return 0;
  const whole = vmDice(q.join(''), f.join(''), 3);
  let cover = 0; for (const w of q) { let b = 0; for (const x of f) b = Math.max(b, vmDice(w, x, 2)); cover += b; }
  cover /= q.length;
  return 0.5 * whole + 0.5 * cover;
}
/** heard: the phone's guesses (best first). Returns up to n {song, score, by} best matches. */
function voiceMatch(songs, heard, n) {
  const qs = heard.map(vmWords).filter(q => q.length);
  const nums = heard.map(h => (h.match(/\d+(\.\d+)*/) || [''])[0]).filter(Boolean);
  const res = [];
  for (const s of songs) {
    let best = 0, by = 'title';
    for (const q of qs) {
      const t = Math.max(vmScore(q, s.title), vmScore(q, s.displayTitle));
      let r = 0; for (const g of s.raga.split('·')[0].split(/[\/,]/)) r = Math.max(r, vmScore(q, g) * 0.95);
      if (t > best) { best = t; by = 'title'; }
      if (r > best) { best = r; by = 'raga'; }
    }
    for (const x of nums) if (s.number === x || s.number.startsWith(x + '.')) { const v = s.number === x ? 1.2 : 1.05; if (v > best) { best = v; by = 'number'; } }
    if (best > 0.35) res.push({ song: s, score: best, by });
  }
  res.sort((a, b) => b.score - a.score || a.song.pos - b.song.pos);
  return res.slice(0, n);
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, lastHeard = '';
function voiceUi(state, title, sub) {
  $('voice').classList.remove('hidden');
  $('voice').classList.toggle('on', state === 'listen');
  $('voice-listen').classList.toggle('hidden', state === 'results');
  $('voice-h').textContent = title || ''; $('voice-p').textContent = sub || '';
  $('voice-again').classList.toggle('hidden', state === 'listen' || !SpeechRec);
  $('voice-all').classList.toggle('hidden', state !== 'results');
  if (state !== 'results') { $('voice-list').innerHTML = ''; $('voice-heard').classList.add('hidden'); }
}
function voiceClose() { if (rec) try { rec.abort(); } catch (e) {} $('voice').classList.add('hidden'); }
function voiceShow(heard) {
  lastHeard = heard[0];
  const hits = voiceMatch(songs, heard, 3);
  if (!hits.length) { voiceUi('none', 'No match found', 'You said “' + heard[0] + '”. Please try again, saying the first words of the song or its rāgam.'); return; }
  voiceUi('results');
  $('voice-heard').innerHTML = 'You said: <b>' + esc(heard[0]) + '</b>'; $('voice-heard').classList.remove('hidden');
  $('voice-list').innerHTML = hits.map(h => `<button class="voice-hit" data-pos="${h.song.pos}"><span class="t">${esc(h.song.number + '  ' + h.song.displayTitle)}</span>`
    + (h.song.displayRaga ? `<span class="r">${esc(h.song.displayRaga)}</span>` : '') + '</button>').join('');
  $('voice-list').querySelectorAll('.voice-hit').forEach(b => { b.onclick = () => { voiceClose(); openSong(+b.dataset.pos); }; });
}
function voiceStart() {
  if (!SpeechRec) {
    voiceUi('none', 'Use your keyboard’s microphone', 'Voice search is not available in this browser. Tap Search, then tap the 🎤 on the keyboard and say the song name.');
    $('voice-all').classList.remove('hidden'); $('voice-all').textContent = 'Open Search'; lastHeard = '';
    return;
  }
  $('voice-all').textContent = 'See all matches';
  rec = new SpeechRec();
  rec.lang = 'en-IN'; rec.maxAlternatives = 5; rec.interimResults = false; rec.continuous = false;
  let got = false;
  rec.onresult = e => { got = true; const r = e.results[0]; const heard = []; for (let i = 0; i < r.length; i++) heard.push(r[i].transcript); voiceShow(heard); };
  rec.onerror = e => { got = true;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') voiceUi('none', 'Microphone not allowed', 'Please allow the microphone for this app in your phone’s settings, or tap Search and use the keyboard’s 🎤.');
    else if (e.error === 'aborted') return;
    else voiceUi('none', 'Didn’t catch that', 'Please tap Try again and speak clearly, close to the phone.'); };
  rec.onend = () => { if (!got && !$('voice').classList.contains('hidden')) voiceUi('none', 'Didn’t catch that', 'Please tap Try again and speak clearly, close to the phone.'); };
  voiceUi('listen', 'Listening…', 'Say a song name or a rāgam');
  try { rec.start(); } catch (e) { voiceUi('none', 'Voice search could not start', 'Please try again.'); }
}
$('btn-voice').onclick = voiceStart;
$('voice-again').onclick = voiceStart;
$('voice-close').onclick = voiceClose;
$('voice').onclick = e => { if (e.target === $('voice')) voiceClose(); };
$('voice-all').onclick = () => { const q = lastHeard; voiceClose(); openSearch(); if (q) { $('search-input').value = q; renderIndex(q); } };

// ---------- about ----------
function openAbout() {
  const fresh = $('v-about').classList.contains('hidden');
  showView('v-about');
  if (fresh) $('about-scroll').scrollTop = 0;
  if (!$('fb-name').value) $('fb-name').value = store.get('name', '');
}
$('btn-about-back').onclick = () => back();
$('lg-go').onclick = doLogin;
$('lg-code').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('lk-go').onclick = retryLocked;
document.querySelectorAll('[data-about]').forEach(b => { b.onclick = () => go('#about'); });

// feedback & suggestions: goes only to Shri Janakiraman (Jani), by WhatsApp or email (nothing is stored anywhere)
const FEEDBACK_WHATSAPP = '919845204620', FEEDBACK_EMAIL = 'utah.ram@gmail.com';
let fbKind = 'Suggestion';
document.querySelectorAll('.fb-k').forEach(b => { b.onclick = () => {
  fbKind = b.dataset.k;
  document.querySelectorAll('.fb-k').forEach(x => x.classList.toggle('sel', x === b));
}; });
function sendFeedback(wa) {
  const name = $('fb-name').value.trim(), msg = $('fb-msg').value.trim();
  if (!name || !msg) { toast('Please write your name and your message.'); return; }
  const body = fbKind + ' for Harinamadwar\nFrom: ' + name + '\n\n' + msg;
  if (wa) location.href = 'https://wa.me/' + FEEDBACK_WHATSAPP + '?text=' + encodeURIComponent(body);
  else location.href = 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(fbKind + ' from ' + name + ' (Harinamadwar app)') + '&body=' + encodeURIComponent(body);
}
$('fb-wa').onclick = () => sendFeedback(true);
$('fb-em').onclick = () => sendFeedback(false);

// ---------- start ----------
// ---------- 4.19 · SCRUM-103: "Contents updated" when new songs, satsangs, thoughts or recordings arrive ----------
let updToastAt = 0;
function contentChanged() {
  store.set('contentAt', Date.now());
  const n = Date.now(); if (n - updToastAt < 4000) return; updToastAt = n;   // several kinds often arrive together: one message
  setTimeout(() => toast(tr('Contents updated')), 400);
}
/** Remembers what this phone has; a later change shows the message (never on the first open after installing). */
function seenContent(key, value) {
  value = String(value); const k = 'seen.' + key, old = store.get(k, null);
  if (old === value) return;
  store.set(k, value);
  if (old !== null) contentChanged();
}
window.seenContent = seenContent;
async function checkUpdates() {
  for (const b of ['', 'ashtapathy/', 'prabandham/']) {
    try { const t = await fetch(b + 'manifest.txt', { cache: 'no-store' }).then(r => r.ok ? r.text() : ''); const v = (t.match(/version=(\d+)/) || [])[1]; if (v) seenContent('man.' + (b || 'dns/'), v); } catch (e) { }
  }
  adminRecordings();
  fetchText('community/events.txt').catch(() => {});   // also brings the satsangs/Learn/thoughts version
}
async function start() {
  applyLook();
  document.querySelectorAll('[data-back]').forEach(b => { b.onclick = () => back(); });
  if (!location.hash) splash();
  await accessStart();
  route();
  setTimeout(checkUpdates, 2500);   // SCRUM-103
  if (accessState !== 'open') return;   // sign in first; welcome comes after
  if (!store.get('interestsDone', false)) go('#welcome');
  else if (!prefs.setupDone) go('#settings');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data === 'content-updated') contentChanged();
  });
}
const ICONS = {"scroll": "<path d=\"M7,4h11a2,2 0,0 1,2 2v1h-3 M7,4a2,2 0,0 0,-2 2v12a2,2 0,0 0,2 2h10a2,2 0,0 0,2 -2V7 M7,4a2,2 0,0 1,2 2v12a2,2 0,0 1,-2 2 M11,9h5 M11,12h5 M11,15h3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "book": "<path d=\"M4,19.5A2.5,2.5 0,0 1,6.5 17H20V3H6.5A2.5,2.5 0,0 0,4 5.5v14zM8,7h8M8,11h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "lotus": "<path d=\"M12,3c2,3 2,6 0,9 -2,-3 -2,-6 0,-9z M12,12c3,-2 6,-2 8,0 -2,3 -5,3 -8,0z M12,12c-3,-2 -6,-2 -8,0 2,3 5,3 8,0z M5,17h14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "music": "<path d=\"M9,18V5l12,-2v13 M3,18a3,3 0,1 0,6 0a3,3 0,1 0,-6 0 M15,16a3,3 0,1 0,6 0a3,3 0,1 0,-6 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "phone": "<path d=\"M22,16.9v3a2,2 0,0 1,-2.2 2 19.8,19.8 0,0 1,-8.6 -3.1 19.5,19.5 0,0 1,-6 -6A19.8,19.8 0,0 1,2.1 4.2 2,2 0,0 1,4.1 2h3a2,2 0,0 1,2 1.7c0.1,0.9 0.4,1.8 0.7,2.7a2,2 0,0 1,-0.5 2.1L8,9.8a16,16 0,0 0,6 6l1.3,-1.3a2,2 0,0 1,2.1 -0.4c0.9,0.3 1.8,0.6 2.7,0.7a2,2 0,0 1,1.7 2z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "mail": "<path d=\"M5,4h14a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H5a3,3 0,0 1,-3 -3V7a3,3 0,0 1,3 -3z M3,6l9,7 9,-7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "chat": "<path d=\"M21,15a2,2 0,0 1,-2 2H7l-4,4V5a2,2 0,0 1,2 -2h14a2,2 0,0 1,2 2z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "chevron": "<path d=\"M9,6l6,6 -6,6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "calendar": "<path d=\"M6,5h12a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H6a3,3 0,0 1,-3 -3V8a3,3 0,0 1,3 -3z M3,10h18 M8,3v4 M16,3v4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "check": "<path d=\"M5,12.5l4.5,4.5L19,7.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "class": "<path d=\"M2,9l10,-5 10,5 -10,5z M6,11v5c3,3 9,3 12,0v-5 M22,9v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "event": "<path d=\"M6,5h12a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H6a3,3 0,0 1,-3 -3V8a3,3 0,0 1,3 -3z M3,10h18 M8,3v4 M16,3v4 M12,12.5l1.2,2.4 2.6,0.4 -1.9,1.8 0.5,2.6 -2.4,-1.3 -2.4,1.3 0.5,-2.6 -1.9,-1.8 2.6,-0.4z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "feather": "<path d=\"M20,4c-6,0 -12,4 -14,12l-2,4 M20,4c0,6 -4,12 -12,14 M20,4L8,16 M14,7l1,4 M11,10l1,3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "heart": "<path d=\"M20.8,4.6a5.5,5.5 0,0 0,-7.8 0L12,5.7l-1,-1.1a5.5,5.5 0,0 0,-7.8 7.8l1,1.1L12,21l7.8,-7.6 1,-1.1a5.5,5.5 0,0 0,0 -7.8z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "heart_on": "<path d=\"M20.8,4.6a5.5,5.5 0,0 0,-7.8 0L12,5.7l-1,-1.1a5.5,5.5 0,0 0,-7.8 7.8l1,1.1L12,21l7.8,-7.6 1,-1.1a5.5,5.5 0,0 0,0 -7.8z\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "history": "<path d=\"M3,12a9,9 0,1 0,3 -6.7 M3,4v5h5 M12,8v4l3,2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "home": "<path d=\"M3,10.5L12,3l9,7.5 M5,9v11a1,1 0,0 0,1 1h4v-6h4v6h4a1,1 0,0 0,1 -1V9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "photo": "<path d=\"M5,4h14a2,2 0,0 1,2 2v12a2,2 0,0 1,-2 2H5a2,2 0,0 1,-2 -2V6a2,2 0,0 1,2 -2z M8.5,10a1.5,1.5 0,1 0,0 -3a1.5,1.5 0,1 0,0 3z M21,15l-5,-5L5,20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "pin": "<path d=\"M12,22s7,-6.5 7,-12a7,7 0,0 0,-14 0c0,5.5 7,12 7,12z M12,12.5a2.5,2.5 0,1 0,0 -5a2.5,2.5 0,1 0,0 5z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "play": "<path d=\"M8,5l11,7 -11,7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "share": "<path d=\"M18,8a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M6,15a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M18,22a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M8.6,13.5l6.8,4 M15.4,6.5l-6.8,4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "user": "<path d=\"M20,21v-2a4,4 0,0 0,-4 -4H8a4,4 0,0 0,-4 4v2 M12,11a4,4 0,1 0,0 -8a4,4 0,1 0,0 8z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "video": "<path d=\"M4,6h11a2,2 0,0 1,2 2v8a2,2 0,0 1,-2 2H4a2,2 0,0 1,-2 -2V8a2,2 0,0 1,2 -2z M17,10.5l5,-3v9l-5,-3z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "settings": "<path d=\"M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z\" fill=\"currentColor\"/>", "back": "<path d=\"M15.4,5.4L14,4l-8,8 8,8 1.4,-1.4L8.8,12z\" fill=\"currentColor\"/>", "close": "<path d=\"M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z\" fill=\"currentColor\"/>"};
// =====================================================================
// v4.0 – same home and screens as the Android app v13.1
// =====================================================================
ICONS.mic = '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
ICONS.speaker = '<path d="M4,9h4l5,-4v14l-5,-4H4z M16.5,8.5a5,5 0,0 1,0 7 M19.5,5.5a9,9 0,0 1,0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
ICONS.stop = '<path d="M7,7h10v10H7z" fill="currentColor"/>';
const svgI = (name, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
// 4.10: icons that match each book, and the About lamp
ICONS.cymbals = '<path d="M7.5,7.6 C9,4.6 15,4.6 16.5,7.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7.5" cy="14" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="14" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7.5" cy="14" r="2" fill="currentColor"/><circle cx="16.5" cy="14" r="2" fill="currentColor"/><path d="M7.5,8.4 V12 M16.5,8.4 V12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
ICONS.flute = '<path d="M3,19 L19,11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="8.4" cy="16.3" r="0.8" fill="#F7D47E"/><circle cx="11.2" cy="14.9" r="0.8" fill="#F7D47E"/><circle cx="14" cy="13.5" r="0.8" fill="#F7D47E"/><path d="M14.5,10.5 C15.5,8 17,6.5 19.2,5.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M19.8,1.8 C23,3 23,7.2 20,8.6 C17.4,8 16.8,4 19.8,1.8 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="20.1" cy="5.3" rx="1.3" ry="1.8" fill="currentColor"/>';
ICONS.palmleaf = '<rect x="2.5" y="6" width="19" height="3.4" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2.5" y="10.3" width="19" height="3.4" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2.5" y="14.6" width="19" height="3.4" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12,4.5 V19.5 M12,19.5 C11,21 9.5,21.2 8.8,20.6 M12,19.5 C13,21 14.5,21.2 15.2,20.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
ICONS.lamp = '<path d="M12,3.2 C13.8,5.4 14,7.2 12,8.8 C10,7.2 10.2,5.4 12,3.2 Z" fill="currentColor"/><path d="M4.5,11 C6,15 18,15 19.5,11 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12,14.6 V18 M8,20.5 H16 M9.5,18 H14.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
ICONS.globe = '<path d="M12,3a9,9 0,1 0,0 18a9,9 0,1 0,0 -18z M3,12h18 M12,3c2.5,2.5 3.8,5.6 3.8,9s-1.3,6.5 -3.8,9 M12,3c-2.5,2.5 -3.8,5.6 -3.8,9s1.3,6.5 3.8,9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
ICONS.gear = '<path d="M12,9a3,3 0,1 0,0 6a3,3 0,1 0,0 -6z M19.4,15a1.6,1.6 0,0 0,.3 1.8l.1.1a2,2 0,1 1,-2.8 2.8l-.1-.1a1.6,1.6 0,0 0,-2.7 1.1V21a2,2 0,1 1,-4 0v-.1a1.6,1.6 0,0 0,-2.7 -1.1l-.1.1a2,2 0,1 1,-2.8 -2.8l.1-.1A1.6,1.6 0,0 0,3.6 15H3.5a2,2 0,1 1,0 -4h.1a1.6,1.6 0,0 0,1.1 -2.7l-.1-.1a2,2 0,1 1,2.8 -2.8l.1.1A1.6,1.6 0,0 0,10 4.6V4.5a2,2 0,1 1,4 0v.1a1.6,1.6 0,0 0,2.7 1.1l.1-.1a2,2 0,1 1,2.8 2.8l-.1.1A1.6,1.6 0,0 0,20.4 10h.1a2,2 0,1 1,0 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
const goldBadge = (name, cls) => `<span class="gbadge ${cls || ''}">${svgI(name)}</span>`;

/** The Harinamadwar gold plaque (logo). `id` keeps the gradient names unique on the page. */
function plaqueSVG(id, shadow) {
  const c = (i, r) => `M${6 + i + r},${6 + i} H${794 - i - r} A${r},${r} 0 0 0 ${794 - i},${6 + i + r} V${194 - i - r} A${r},${r} 0 0 0 ${794 - i - r},${194 - i} H${6 + i + r} A${r},${r} 0 0 0 ${6 + i},${194 - i - r} V${6 + i + r} A${r},${r} 0 0 0 ${6 + i + r},${6 + i} Z`;
  return `<svg class="plaque" role="img" aria-label="Harinamadwar" viewBox="0 -4 800 212"><defs>` +
    `<filter id="${id}b" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>` +
    `<linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C08A22"/><stop offset="1" stop-color="#8C5A0C"/></linearGradient>` +
    `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset=".45" stop-color="#F7D47E"/><stop offset="1" stop-color="#E4AE48"/></linearGradient>` +
    `<linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22409C"/><stop offset="1" stop-color="#132A6B"/></linearGradient></defs>` +
    (shadow ? `<path d="${c(0, 36)}" transform="translate(0 5)" fill="#000" opacity=".22" filter="url(#${id}b)"/>` : '') +
    `<path d="${c(0, 36)}" fill="url(#${id}r)"/><path d="${c(6, 32)}" fill="url(#${id}g)"/>` +
    `<path d="${c(14, 26)}" fill="none" stroke="#9A6512" stroke-width="1.6" opacity=".55"/><path d="${c(18, 23)}" fill="none" stroke="#FFF6DA" stroke-width="1" opacity=".7"/>` +
    `<g transform="translate(400 50) scale(1.2)"><path d="M0,-24 C9,-14 9,-2 0,8 C-9,-2 -9,-14 0,-24 Z" fill="url(#${id}i)"/><path d="M0,8 C2,-5 12,-15 24,-16 C22,-3 12,6 0,8 Z" fill="url(#${id}i)"/><path d="M0,8 C-2,-5 -12,-15 -24,-16 C-22,-3 -12,6 0,8 Z" fill="url(#${id}i)"/><path d="M0,8 C9,0 22,-3 33,0 C26,8 13,11 0,8 Z" fill="#2B4AA8"/><path d="M0,8 C-9,0 -22,-3 -33,0 C-26,8 -13,11 0,8 Z" fill="#2B4AA8"/><path d="M-26,13 Q0,19 26,13" fill="none" stroke="#132A6B" stroke-width="2.2" stroke-linecap="round"/></g>` +
    `<text x="400" y="138" text-anchor="middle" font-family="Mukta, 'Segoe UI', sans-serif" font-weight="700" font-size="80" letter-spacing="1" fill="url(#${id}i)" stroke="#FFF4D2" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round">Harinamadwar</text>` +
    `<g fill="none" stroke="#132A6B" stroke-linecap="round"><path d="M248,166 C300,163 340,163 378,166" stroke-width="1.6"/><path d="M552,166 C500,163 460,163 422,166" stroke-width="1.6"/><path d="M300,166 C320,170 350,170 372,167" stroke-width="1" opacity=".6"/><path d="M500,166 C480,170 450,170 428,167" stroke-width="1" opacity=".6"/></g>` +
    `<circle cx="244" cy="166" r="2.4" fill="#132A6B"/><circle cx="556" cy="166" r="2.4" fill="#132A6B"/><path d="M400,157 L408,166 L400,175 L392,166 Z" fill="url(#${id}i)"/><circle cx="385" cy="166" r="2" fill="#132A6B"/><circle cx="415" cy="166" r="2" fill="#132A6B"/></svg>`;
}

// ---------- the language bar under the blue band (home, books, About, Satsangs, Learn, Favourites, Settings) ----------
const UI_LANGS = [['en', 'English'], ['ta', 'Tamil'], ['kn', 'Kannada'], ['sa', 'Sanskrit']];
function langBarHTML() {
  return `<div class="lb-row" data-notr><div class="lb" role="group" aria-label="Language">${svgI('globe', 'lb-globe')}` +
    UI_LANGS.map(([c, n]) => `<button class="lb-b${c === prefs.lang ? ' on' : ''}" data-ui-lang="${c}" aria-pressed="${c === prefs.lang}">${n}</button>`).join('') +
    `</div><button class="lb-gear" data-go="#settings" aria-label="Settings">${svgI('gear')}</button></div>`;
}
function paintLangBars() { document.querySelectorAll('[data-langbar]').forEach(el => { el.innerHTML = langBarHTML(); }); }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ui-lang]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.uiLang === prefs.lang) return;
  prefs.lang = b.dataset.uiLang;
  paintLangBars();
  if (!$('v-index').classList.contains('hidden') && indexBook) {
    const y = $('index-scroll').scrollTop;
    $('book-title').textContent = bookTitle(indexBook);
    $('search-input').placeholder = tr(BOOKS[indexBook].search);
    renderIndex($('search-input').value).then(() => { $('index-scroll').scrollTop = y; });
  } else {
    // every page stays exactly where the user was (never jump to the top on a language change)
    const v = VIEWS.find(x => !$(x).classList.contains('hidden')), sc = v && $(v).querySelector('.scroll'), y = sc ? sc.scrollTop : 0;
    const keep = () => { if (sc) sc.scrollTop = y; };
    Promise.resolve(route()).then(() => { keep(); requestAnimationFrame(keep); });
    keep();
  }
}, true);

/** Inner pages: Back and the small logo on top, the page title on its own line below (4.10). */
function brandBars() {
  const ids = ['v-welcome', 'v-diary', 'v-playlist', 'v-learn', 'v-favs', 'v-tfd', 'v-share', 'v-about', 'v-settings', 'v-other'];
  ids.forEach((id, k) => {
    const head = document.querySelector('#' + id + ' > header.bar');
    const row = head && head.querySelector('.bar-row');
    if (!row || row.classList.contains('b2-top')) return;
    const backBtn = row.querySelector('button');
    const title = row.querySelector('.bar-mid [id]') || row.querySelector('.bar-mid b') || row.querySelector('.bar-mid');
    const right = row.querySelector('.bar-right');
    row.classList.add('b2-top');
    row.innerHTML = '';
    if (backBtn) { backBtn.classList.add('b2-back'); row.appendChild(backBtn); }
    const mid = document.createElement('div'); mid.className = 'b2-logo'; mid.innerHTML = plaqueSVG('pq' + k, false); row.appendChild(mid);
    if (right) { right.classList.add('b2-right'); row.appendChild(right); } else { const sp = document.createElement('span'); sp.className = 'b2-right'; row.appendChild(sp); }
    const tl = document.createElement('div'); tl.className = 'b2-title';
    const h = document.createElement('h1');
    if (title) { h.id = title.id || ''; h.textContent = title.textContent; if (title.id) title.removeAttribute('id'); }
    tl.appendChild(h);
    row.after(tl);
  });
  // the language bar under the blue band
  for (const id of ['v-home', 'v-index', 'v-about', 'v-diary', 'v-learn', 'v-favs', 'v-settings']) {
    const head = document.querySelector('#' + id + ' > header.bar');
    if (!head || head.nextElementSibling && head.nextElementSibling.hasAttribute('data-langbar')) continue;
    const d = document.createElement('div'); d.setAttribute('data-langbar', ''); d.className = 'lb-wrap';
    head.after(d);
  }
  paintLangBars();
}

// The third book: its name and line follow the chosen language
const NDP_BOOK = {
  en: ['Naalaayira Divya Prabandham', '4000 pāsurams of the Āzhvārs'],
  ta: ['நாலாயிர திவ்ய பிரபந்தம்', 'ஆழ்வார்களின் 4000 பாசுரங்கள்'],
  kn: ['ನಾಲಾಯಿರ ದಿವ್ಯ ಪ್ರಬಂಧಂ', 'ಆಳ್ವಾರರ 4000 ಪಾಶುರಗಳು'],
  sa: ['नालायिर दिव्य प्रबन्धम्', 'आळ्वाराणां ४००० पाशुराः'],
};

// ---------- SCRUM-74: the whole screen follows the chosen language ----------
const UI = {
  hello:   { en: 'Hari Om', ta: 'ஹரி ஓம்', kn: 'ಹರಿ ಓಂ', sa: 'हरि ॐ' },
  tagline: { en: 'A doorway to the Lord’s Name', ta: 'இறைவன் திருநாமத்திற்கு ஒரு வாசல்', kn: 'ಭಗವಂತನ ನಾಮಕ್ಕೆ ಒಂದು ಬಾಗಿಲು', sa: 'भगवन्नाम्नः द्वारम्' },
  choose:  { en: 'CHOOSE A BOOK', ta: 'ஒரு நூலைத் தேர்ந்தெடுங்கள்', kn: 'ಒಂದು ಪುಸ್ತಕವನ್ನು ಆರಿಸಿ', sa: 'ग्रन्थं चिनुत' },
  dns:     { en: ['Divya Nama Sankeertanam', 'Bhajans of many saints'], ta: ['திவ்ய நாம ஸங்கீர்த்தனம்', 'பல மகான்களின் பஜனைகள்'], kn: ['ದಿವ್ಯ ನಾಮ ಸಂಕೀರ್ತನಂ', 'ಅನೇಕ ಸಂತರ ಭಜನೆಗಳು'], sa: ['दिव्यनामसङ्कीर्तनम्', 'बहूनां सन्तानां भजनानि'] },
  ashta:   { en: ['Śrī Gīta Govindam', '24 Aṣṭapadis of<br>Śrī Jayadeva'], ta: ['ஸ்ரீ கீத கோவிந்தம்', 'ஸ்ரீ ஜயதேவரின்<br>24 அஷ்டபதிகள்'], kn: ['ಶ್ರೀ ಗೀತ ಗೋವಿಂದಂ', 'ಶ್ರೀ ಜಯದೇವರ<br>24 ಅಷ್ಟಪದಿಗಳು'], sa: ['श्रीगीतगोविन्दम्', 'श्रीजयदेवस्य<br>२४ अष्टपद्यः'] },
  cont:    { en: 'Continue where you left off', ta: 'விட்ட இடத்திலிருந்து தொடருங்கள்', kn: 'ನಿಲ್ಲಿಸಿದಲ್ಲಿಂದ ಮುಂದುವರಿಸಿ', sa: 'यत्र विरतं ततः अनुवर्तताम्' },
  diary:   { en: 'Upcoming<br>Satsangs', ta: 'வரவிருக்கும்<br>சத்சங்கங்கள்', kn: 'ಮುಂಬರುವ<br>ಸತ್ಸಂಗಗಳು', sa: 'आगामिनः<br>सत्सङ्गाः' },
  learn:   { en: 'Learn<br>&nbsp;', ta: 'கற்க<br>&nbsp;', kn: 'ಕಲಿಯಿರಿ<br>&nbsp;', sa: 'अध्ययनम्<br>&nbsp;' },
  favs:    { en: 'My<br>favourites', ta: 'எனக்குப்<br>பிடித்தவை', kn: 'ನನ್ನ<br>ಮೆಚ್ಚಿನವು', sa: 'मम<br>प्रियाणि' },
  tfd:     { en: 'THOUGHT FOR THE DAY', ta: 'இன்றைய சிந்தனை', kn: 'ಇಂದಿನ ಚಿಂತನೆ', sa: 'अद्यतनं चिन्तनम्' },
  read:    { en: 'Read ›', ta: 'படிக்க ›', kn: 'ಓದಿ ›', sa: 'पठत ›' },
  sod:     { en: 'SONG OF THE DAY', ta: 'இன்றைய பாடல்', kn: 'ಇಂದಿನ ಹಾಡು', sa: 'अद्यतनं गीतम्' },
  raga:    { en: 'Rāgam', ta: 'ராகம்', kn: 'ರಾಗ', sa: 'रागः' },
  listen:  { en: 'Listen', ta: 'கேள்', kn: 'ಕೇಳಿ', sa: 'शृणुत' },
  share:   { en: 'Share', ta: 'பகிர்', kn: 'ಹಂಚಿಕೊಳ್ಳಿ', sa: 'प्रेषयत' },
  about:   { en: ['About Harinamadwar', 'Our satsangs, our guide, and how to invite us'], ta: ['ஹரிநாமத்வார் பற்றி', 'எங்கள் சத்சங்கங்கள், வழிகாட்டி, எங்களை அழைப்பது எப்படி'], kn: ['ಹರಿನಾಮದ್ವಾರದ ಬಗ್ಗೆ', 'ನಮ್ಮ ಸತ್ಸಂಗಗಳು, ಮಾರ್ಗದರ್ಶಕರು, ನಮ್ಮನ್ನು ಆಹ್ವಾನಿಸುವುದು ಹೇಗೆ'], sa: ['हरिनामद्वारविषये', 'अस्माकं सत्सङ्गाः, मार्गदर्शकः, आह्वानविधिः च'] },
  change:  { en: 'Change what I see on this page ›', ta: 'இந்தப் பக்கத்தில் தெரிவதை மாற்ற ›', kn: 'ಈ ಪುಟದಲ್ಲಿ ಕಾಣುವುದನ್ನು ಬದಲಿಸಿ ›', sa: 'अस्मिन् पृष्ठे दृश्यं परिवर्तयत ›' },
  pasuram: { en: 'Pāsuram ', ta: 'பாசுரம் ', kn: 'ಪಾಶುರ ', sa: 'पाशुरम् ' },
  ashtapadi: { en: 'Aṣṭapadi ', ta: 'அஷ்டபதி ', kn: 'ಅಷ್ಟಪದಿ ', sa: 'अष्टपदी ' },
};
// SCRUM-94 (Shiv, 21 Nov 2026): buttons, labels and headings stay in English in every language; only the books'
// own names and the tagline follow the chosen language (lyrics, meanings and thoughts come from their own files)
const T_CONTENT = new Set(['dns', 'ashta', 'tagline']);
const T = k => { const v = UI[k]; return v ? (T_CONTENT.has(k) ? (v[prefs.lang] || v.en) : v.en) : k; };
// ---------- SCRUM-74: every screen in the chosen language ----------
// Exact English phrase → [Tamil, Kannada, Sanskrit]. Text on screen that matches is shown in the chosen language;
// lyrics and meanings are never touched (they already come from the language's own file).
const I18N = {
  '‹ Back': ['‹ பின்செல்', '‹ ಹಿಂದೆ', '‹ पृष्ठतः'],
  'Back': ['பின்செல்', 'ಹಿಂದೆ', 'पृष्ठतः'],
  'Welcome': ['வரவேற்பு', 'ಸ್ವಾಗತ', 'स्वागतम्'],
  'Upcoming Satsangs': ['வரவிருக்கும் சத்சங்கங்கள்', 'ಮುಂಬರುವ ಸತ್ಸಂಗಗಳು', 'आगामिनः सत्सङ्गाः'],
  'Learn': ['கற்க', 'ಕಲಿಯಿರಿ', 'अध्ययनम्'],
  'My favourites': ['எனக்குப் பிடித்தவை', 'ನನ್ನ ಮೆಚ್ಚಿನವು', 'मम प्रियाणि'],
  'Thought for the Day': ['இன்றைய சிந்தனை', 'ಇಂದಿನ ಚಿಂತನೆ', 'अद्यतनं चिन्तनम्'],
  'Thoughts for the Day': ['தினசரி சிந்தனைகள்', 'ದಿನದ ಚಿಂತನೆಗಳು', 'दैनिकचिन्तनानि'],
  'Share a song': ['ஒரு பாடலைப் பகிர்', 'ಹಾಡನ್ನು ಹಂಚಿಕೊಳ್ಳಿ', 'गीतं प्रेषयत'],
  'About Harinamadwar': ['ஹரிநாமத்வார் பற்றி', 'ಹರಿನಾಮದ್ವಾರದ ಬಗ್ಗೆ', 'हरिनामद्वारविषये'],
  'A doorway to the Lord’s Name': ['இறைவன் திருநாமத்திற்கு ஒரு வாசல்', 'ಭಗವಂತನ ನಾಮಕ್ಕೆ ಒಂದು ಬಾಗಿಲು', 'भगवन्नाम्नः द्वारम्'],
  'Settings': ['அமைப்புகள்', 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು', 'विन्यासाः'],
  'Language': ['மொழி', 'ಭಾಷೆ', 'भाषा'],
  'Language of lyrics': ['மொழி', 'ಭಾಷೆ', 'भाषा'],
  'Lyrics': ['பாடல் வரிகள்', 'ಸಾಹಿತ್ಯ', 'पाठः'],
  'Meaning': ['பொருள்', 'ಅರ್ಥ', 'अर्थः'],
  'Audio': ['ஒலி', 'ಧ್ವನಿ', 'श्रव्यम्'],
  'Composer': ['இயற்றியவர்', 'ರಚನಕಾರ', 'रचयिता'],
  'Coming soon': ['விரைவில்', 'ಶೀಘ್ರದಲ್ಲೇ', 'शीघ्रम्'],
  'The life and story of the saint who composed this song will be added here.': ['இந்தப் பாடலை இயற்றிய மகானின் வாழ்க்கை வரலாறு இங்கே சேர்க்கப்படும்.', 'ಈ ಹಾಡನ್ನು ರಚಿಸಿದ ಸಂತರ ಜೀವನ ಕಥೆ ಇಲ್ಲಿ ಸೇರಿಸಲಾಗುವುದು.', 'अस्य गीतस्य रचयितुः सन्तस्य जीवनचरितम् अत्र योजयिष्यते।'],
  'No songs found': ['பாடல்கள் எதுவும் இல்லை', 'ಯಾವುದೇ ಹಾಡುಗಳು ಸಿಗಲಿಲ್ಲ', 'गीतानि न लब्धानि'],
  'No pāsurams found': ['பாசுரங்கள் எதுவும் இல்லை', 'ಯಾವುದೇ ಪಾಶುರಗಳು ಸಿಗಲಿಲ್ಲ', 'पाशुराः न लब्धाः'],
  'No aṣṭapadis found': ['அஷ்டபதிகள் எதுவும் இல்லை', 'ಯಾವುದೇ ಅಷ್ಟಪದಿಗಳು ಸಿಗಲಿಲ್ಲ', 'अष्टपद्यः न लब्धाः'],
  'Search: section no. or song title': ['தேடல்: பகுதி எண் அல்லது பாடல் பெயர்', 'ಹುಡುಕಿ: ವಿಭಾಗ ಸಂಖ್ಯೆ ಅಥವಾ ಹಾಡಿನ ಹೆಸರು', 'अन्विष्यत: विभागसङ्ख्या गीतनाम वा'],
  'Search: aṣṭapadi no. or title': ['தேடல்: அஷ்டபதி எண் அல்லது பெயர்', 'ಹುಡುಕಿ: ಅಷ್ಟಪದಿ ಸಂಖ್ಯೆ ಅಥವಾ ಹೆಸರು', 'अन्विष्यत: अष्टपदीसङ्ख्या नाम वा'],
  'Search: pāsuram no. or words': ['தேடல்: பாசுர எண் அல்லது சொற்கள்', 'ಹುಡುಕಿ: ಪಾಶುರ ಸಂಖ್ಯೆ ಅಥವಾ ಪದಗಳು', 'अन्विष्यत: पाशुरसङ्ख्या शब्दाः वा'],
  'Loading…': ['ஏற்றுகிறது…', 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…', 'आनीयते…'],
  'Repeat song': ['பாடலை மீண்டும் இசை', 'ಹಾಡನ್ನು ಪುನರಾವರ್ತಿಸಿ', 'गीतं पुनः'],
  'Play': ['இயக்கு', 'ಪ್ಲೇ', 'वादयतु'],
  'Pause': ['இடைநிறுத்து', 'ವಿರಾಮ', 'विरमतु'],
  'For Harinamadwar admins': ['ஹரிநாமத்வார் நிர்வாகிகளுக்கு', 'ಹರಿನಾಮದ್ವಾರ ನಿರ್ವಾಹಕರಿಗೆ', 'हरिनामद्वार-प्रबन्धकेभ्यः'],
  'Tap to play': ['இசைக்கத் தொடவும்', 'ಕೇಳಲು ಒತ್ತಿ', 'श्रोतुं स्पृशतु'],
  'Playing': ['இசைக்கிறது', 'ಕೇಳಿಸುತ್ತಿದೆ', 'श्राव्यते'],
  'Paused': ['நிறுத்தப்பட்டது', 'ನಿಲ್ಲಿಸಲಾಗಿದೆ', 'विरामः'],
  'Speed': ['வேகம்', 'ವೇಗ', 'वेगः'],
  'About the book': ['நூலைப் பற்றி', 'ಪುಸ್ತಕದ ಬಗ್ಗೆ', 'ग्रन्थविषये'],
  'Text size': ['எழுத்தின் அளவு', 'ಅಕ್ಷರದ ಗಾತ್ರ', 'अक्षरमानम्'],
  'Drag to make the lyrics bigger or smaller. You can also use A− / A+ on any song.': ['பாடல் வரிகளைப் பெரிதாக்க அல்லது சிறிதாக்க இழுக்கவும். எந்தப் பாடலிலும் A− / A+ பயன்படுத்தலாம்.', 'ಸಾಹಿತ್ಯವನ್ನು ದೊಡ್ಡದು ಅಥವಾ ಚಿಕ್ಕದು ಮಾಡಲು ಎಳೆಯಿರಿ. ಯಾವುದೇ ಹಾಡಿನಲ್ಲಿ A− / A+ ಬಳಸಬಹುದು.', 'पाठं बृहत् लघु वा कर्तुं कर्षत। प्रत्येकस्मिन् गीते A− / A+ अपि उपयोक्तुं शक्यते।'],
  'Keep screen on while a song is open': ['பாடல் திறந்திருக்கும்போது திரையை அணையாமல் வை', 'ಹಾಡು ತೆರೆದಿರುವಾಗ ಪರದೆ ಆನ್ ಇರಲಿ', 'गीते उद्घाटिते पटलं प्रकाशितं स्थापयत'],
  'Night mode (light text on dark page)': ['இரவு முறை (இருண்ட பக்கத்தில் வெளிர் எழுத்து)', 'ರಾತ್ರಿ ಮೋಡ್ (ಕಪ್ಪು ಪುಟದಲ್ಲಿ ತಿಳಿ ಅಕ್ಷರ)', 'रात्रिविधिः (कृष्णपृष्ठे शुभ्राक्षराणि)'],
  'Done': ['முடிந்தது', 'ಮುಗಿದಿದೆ', 'सम्पन्नम्'],
  'Listening…': ['கேட்கிறது…', 'ಕೇಳುತ್ತಿದೆ…', 'शृणोति…'],
  'Say a song name or a rāgam': ['பாடலின் பெயர் அல்லது ராகத்தைச் சொல்லுங்கள்', 'ಹಾಡಿನ ಹೆಸರು ಅಥವಾ ರಾಗವನ್ನು ಹೇಳಿ', 'गीतनाम रागं वा वदत'],
  '🎤 Try again': ['🎤 மீண்டும் முயல்க', '🎤 ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', '🎤 पुनः प्रयतध्वम्'],
  'Try again': ['மீண்டும் முயல்க', 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', 'पुनः प्रयतध्वम्'],
  'See all matches': ['எல்லாப் பொருத்தங்களும்', 'ಎಲ್ಲಾ ಹೊಂದಾಣಿಕೆಗಳು', 'सर्वाणि दर्शयत'],
  'Close': ['மூடு', 'ಮುಚ್ಚಿ', 'पिधत्त'],
  'Continue': ['தொடர்க', 'ಮುಂದುವರಿಸಿ', 'अग्रे'],
  'Your phone number': ['உங்கள் தொலைபேசி எண்', 'ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆ', 'भवतः दूरभाषसङ्ख्या'],
  'Invite code': ['அழைப்புக் குறியீடு', 'ಆಹ್ವಾನ ಕೋಡ್', 'आमन्त्रणसङ्केतः'],
  'Welcome to Harinamadwar': ['ஹரிநாமத்வாருக்கு வருக', 'ಹರಿನಾಮದ್ವಾರಕ್ಕೆ ಸ್ವಾಗತ', 'हरिनामद्वारे स्वागतम्'],
  'Enter the code you received on WhatsApp': ['WhatsApp-இல் வந்த குறியீட்டை உள்ளிடவும்', 'WhatsApp ನಲ್ಲಿ ಬಂದ ಕೋಡ್ ನಮೂದಿಸಿ', 'WhatsApp द्वारा प्राप्तं सङ्केतं लिखत'],
  'No code? Ask your satsang admin.': ['குறியீடு இல்லையா? உங்கள் சத்சங்க நிர்வாகியிடம் கேளுங்கள்.', 'ಕೋಡ್ ಇಲ್ಲವೇ? ನಿಮ್ಮ ಸತ್ಸಂಗ ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.', 'सङ्केतः नास्ति? सत्सङ्गव्यवस्थापकं पृच्छत।'],
  'I understand': ['புரிந்துகொண்டேன்', 'ನನಗೆ ಅರ್ಥವಾಯಿತು', 'अवगतम्'],
  'For our class only': ['எங்கள் வகுப்புக்கு மட்டும்', 'ನಮ್ಮ ತರಗತಿಗೆ ಮಾತ್ರ', 'अस्माकं कक्षायै एव'],
  'Share': ['பகிர்', 'ಹಂಚಿಕೊಳ್ಳಿ', 'प्रेषयत'],
  'Listen': ['கேள்', 'ಕೇಳಿ', 'शृणुत'],
  'Sing': ['பாடுங்கள்', 'ಹಾಡಿ', 'गायत'],
  'Understand': ['புரிந்துகொள்ளுங்கள்', 'ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ', 'अवगच्छत'],
  'Suggestion': ['பரிந்துரை', 'ಸಲಹೆ', 'सूचना'],
  'Feedback': ['கருத்து', 'ಪ್ರತಿಕ್ರಿಯೆ', 'प्रतिक्रिया'],
  'Your name': ['உங்கள் பெயர்', 'ನಿಮ್ಮ ಹೆಸರು', 'भवतः नाम'],
  'Your message': ['உங்கள் செய்தி', 'ನಿಮ್ಮ ಸಂದೇಶ', 'भवतः सन्देशः'],
  'Send by': ['அனுப்பும் வழி', 'ಕಳುಹಿಸುವ ವಿಧಾನ', 'प्रेषणमार्गः'],
  'This is a': ['இது ஒரு', 'ಇದು ಒಂದು', 'एषा'],
  'Call to invite': ['அழைக்க போன் செய்யுங்கள்', 'ಆಹ್ವಾನಿಸಲು ಕರೆ ಮಾಡಿ', 'आह्वानाय दूरभाषं कुरुत'],
  'Phone': ['தொலைபேசி', 'ಫೋನ್', 'दूरभाषः'],
  'AT A SATSANG': ['ஒரு சத்சங்கத்தில்', 'ಸತ್ಸಂಗದಲ್ಲಿ', 'सत्सङ्गे'],
  'IN THIS APP': ['இந்தச் செயலியில்', 'ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ', 'अस्मिन् अनुप्रयोगे'],
  'WHY SING THE NAME': ['நாமத்தை ஏன் பாட வேண்டும்', 'ನಾಮವನ್ನು ಏಕೆ ಹಾಡಬೇಕು', 'किमर्थं नामगानम्'],
  'GUIDED BY': ['வழிகாட்டுபவர்', 'ಮಾರ್ಗದರ್ಶಕರು', 'मार्गदर्शकः'],
  'HOST A SATSANG': ['சத்சங்கம் நடத்துங்கள்', 'ಸತ್ಸಂಗ ಆಯೋಜಿಸಿ', 'सत्सङ्गम् आयोजयत'],
  'FEEDBACK & SUGGESTIONS': ['கருத்துகளும் பரிந்துரைகளும்', 'ಪ್ರತಿಕ್ರಿಯೆ ಮತ್ತು ಸಲಹೆಗಳು', 'प्रतिक्रियाः सूचनाः च'],
  'STAY CONNECTED': ['தொடர்பில் இருங்கள்', 'ಸಂಪರ್ಕದಲ್ಲಿರಿ', 'सम्पर्के तिष्ठत'],
  'Invite us to your home': ['எங்களை உங்கள் இல்லத்துக்கு அழையுங்கள்', 'ನಮ್ಮನ್ನು ನಿಮ್ಮ ಮನೆಗೆ ಆಹ್ವಾನಿಸಿ', 'अस्मान् स्वगृहम् आह्वयत'],
  'Share your thoughts': ['உங்கள் கருத்துகளைப் பகிருங்கள்', 'ನಿಮ್ಮ ಅಭಿಪ್ರಾಯ ಹಂಚಿಕೊಳ್ಳಿ', 'स्वविचारान् प्रेषयत'],
  'Your practice companion': ['உங்கள் பயிற்சித் துணை', 'ನಿಮ್ಮ ಅಭ್ಯಾಸದ ಸಂಗಾತಿ', 'भवतः अभ्याससहायः'],
  'What devotees feel': ['பக்தர்கள் உணர்வது', 'ಭಕ್ತರು ಅನುಭವಿಸುವುದು', 'भक्तानाम् अनुभवः'],
  'DAILY SESSION': ['தினசரி வகுப்பு', 'ದೈನಂದಿನ ತರಗತಿ', 'दैनिककक्षा'],
  'Join on Google Meet': ['Google Meet-இல் இணையுங்கள்', 'Google Meet ನಲ್ಲಿ ಸೇರಿ', 'Google Meet द्वारा सम्मिलत'],
  'Join today’s session': ['இன்றைய வகுப்பில் சேருங்கள்', 'ಇಂದಿನ ತರಗತಿಗೆ ಸೇರಿ', 'अद्यतनकक्षायां सम्मिलत'],
  'MY PROGRESS': ['என் முன்னேற்றம்', 'ನನ್ನ ಪ್ರಗತಿ', 'मम प्रगतिः'],
  'Hide my progress': ['என் முன்னேற்றத்தை மறை', 'ನನ್ನ ಪ್ರಗತಿ ಮರೆಮಾಡಿ', 'मम प्रगतिं गोपयत'],
  'Show my progress': ['என் முன்னேற்றத்தைக் காட்டு', 'ನನ್ನ ಪ್ರಗತಿ ತೋರಿಸಿ', 'मम प्रगतिं दर्शयत'],
  'THIS WEEK’S SONGS FROM SHRI JANAKIRAMAN (JANI)': ['ஸ்ரீ ஜானகிராமன் (ஜானி) அவர்களின் இந்த வாரப் பாடல்கள்', 'ಶ್ರೀ ಜಾನಕಿರಾಮನ್ (ಜಾನಿ) ಅವರ ಈ ವಾರದ ಹಾಡುಗಳು', 'श्रीजानकिरामन् (जानि) महोदयस्य अस्य सप्ताहस्य गीतानि'],
  'Tick a song when you can sing it. Only you see this.': ['பாட முடிந்ததும் பாடலைக் குறியிடுங்கள். இது உங்களுக்கு மட்டுமே தெரியும்.', 'ಹಾಡಲು ಬಂದಾಗ ಹಾಡನ್ನು ಗುರುತಿಸಿ. ಇದು ನಿಮಗೆ ಮಾತ್ರ ಕಾಣುತ್ತದೆ.', 'यदा गातुं शक्नुथ तदा गीतं चिह्नयत। एतत् भवद्भिः एव दृश्यते।'],
  'All of this week’s songs. Wonderful!': ['இந்த வாரப் பாடல்கள் அனைத்தும். அருமை!', 'ಈ ವಾರದ ಎಲ್ಲಾ ಹಾಡುಗಳು. ಅದ್ಭುತ!', 'अस्य सप्ताहस्य सर्वाणि गीतानि। अद्भुतम्!'],
  'Contents updated': ['உள்ளடக்கம் புதுப்பிக்கப்பட்டது', 'ವಿಷಯಗಳು ನವೀಕರಿಸಲಾಗಿದೆ', 'विषयाः नवीकृताः'],
  'Message from Shri Janakiraman (Jani)': ['ஸ்ரீ ஜானகிராமன் (ஜானி) அவர்களின் செய்தி', 'ಶ್ರೀ ಜಾನಕಿರಾಮನ್ (ಜಾನಿ) ಅವರ ಸಂದೇಶ', 'श्रीजानकिरामन् (जानि) महोदयस्य सन्देशः'],
  'About this week’s songs': ['இந்த வாரப் பாடல்கள் பற்றி', 'ಈ ವಾರದ ಹಾಡುಗಳ ಬಗ್ಗೆ', 'अस्य सप्ताहस्य गीतविषये'],
  'Audio message · coming soon': ['ஒலிச் செய்தி · விரைவில்', 'ಧ್ವನಿ ಸಂದೇಶ · ಶೀಘ್ರದಲ್ಲೇ', 'श्रव्यसन्देशः · शीघ्रम्'],
  'No favourites yet': ['இன்னும் பிடித்தவை இல்லை', 'ಇನ್ನೂ ಮೆಚ್ಚಿನವು ಇಲ್ಲ', 'अद्यापि प्रियाणि न सन्ति'],
  'Tap a song to open it. Tap the heart to remove it.': ['பாடலைத் திறக்கத் தொடுங்கள். நீக்க இதயத்தைத் தொடுங்கள்.', 'ಹಾಡು ತೆರೆಯಲು ಸ್ಪರ್ಶಿಸಿ. ತೆಗೆದುಹಾಕಲು ಹೃದಯವನ್ನು ಸ್ಪರ್ಶಿಸಿ.', 'गीतम् उद्घाटयितुं स्पृशत। अपनेतुं हृदयं स्पृशत।'],
  'Added to My favourites': ['பிடித்தவையில் சேர்க்கப்பட்டது', 'ಮೆಚ್ಚಿನವುಗಳಿಗೆ ಸೇರಿಸಲಾಗಿದೆ', 'प्रियेषु योजितम्'],
  'Removed from My favourites': ['பிடித்தவையிலிருந்து நீக்கப்பட்டது', 'ಮೆಚ್ಚಿನವುಗಳಿಂದ ತೆಗೆಯಲಾಗಿದೆ', 'प्रियेभ्यः अपनीतम्'],
  'UPCOMING': ['வரவிருப்பவை', 'ಮುಂಬರುವ', 'आगामि'],
  'Upcoming': ['வரவிருப்பவை', 'ಮುಂಬರುವ', 'आगामि'],
  'NEXT SATSANG': ['அடுத்த சத்சங்கம்', 'ಮುಂದಿನ ಸತ್ಸಂಗ', 'अग्रिमः सत्सङ्गः'],
  'PHOTOS': ['புகைப்படங்கள்', 'ಫೋಟೋಗಳು', 'चित्राणि'],
  'FROM PAST SATSANGS · YOUTUBE SHORTS': ['முந்தைய சத்சங்கங்களிலிருந்து · YouTube Shorts', 'ಹಿಂದಿನ ಸತ್ಸಂಗಗಳಿಂದ · YouTube Shorts', 'पूर्वसत्सङ्गेभ्यः · YouTube Shorts'],
  'No satsangs announced yet. Please check again soon.': ['இன்னும் சத்சங்கங்கள் அறிவிக்கப்படவில்லை. விரைவில் மீண்டும் பாருங்கள்.', 'ಇನ್ನೂ ಸತ್ಸಂಗಗಳನ್ನು ಪ್ರಕಟಿಸಿಲ್ಲ. ಶೀಘ್ರದಲ್ಲೇ ಮತ್ತೆ ನೋಡಿ.', 'अद्यापि सत्सङ्गाः न घोषिताः। शीघ्रं पुनः पश्यत।'],
  'Watch clips from past satsangs': ['முந்தைய சத்சங்கக் காணொளிகளைப் பாருங்கள்', 'ಹಿಂದಿನ ಸತ್ಸಂಗಗಳ ಕ್ಲಿಪ್‌ಗಳನ್ನು ನೋಡಿ', 'पूर्वसत्सङ्गानां चलचित्राणि पश्यत'],
  'Satsangs': ['சத்சங்கங்கள்', 'ಸತ್ಸಂಗಗಳು', 'सत्सङ्गाः'],
  'Newer': ['புதியது', 'ಹೊಸದು', 'नूतनम्'],
  'Older': ['முந்தையது', 'ಹಿಂದಿನದು', 'पूर्वतनम्'],
  'All thoughts': ['எல்லா சிந்தனைகளும்', 'ಎಲ್ಲ ಚಿಂತನೆಗಳು', 'सर्वचिन्तनानि'],
  'Past thoughts': ['முந்தைய சிந்தனைகள்', 'ಹಿಂದಿನ ಚಿಂತನೆಗಳು', 'पूर्वचिन्तनानि'],
  'How did this thought touch you?': ['இந்தச் சிந்தனை உங்களை எப்படித் தொட்டது?', 'ಈ ಚಿಂತನೆ ನಿಮ್ಮನ್ನು ಹೇಗೆ ತಟ್ಟಿತು?', 'इदं चिन्तनं भवतः हृदयं कथं स्पृष्टवत्?'],
  'SING WITH TODAY’S THOUGHT': ['இன்றைய சிந்தனையுடன் பாடுங்கள்', 'ಇಂದಿನ ಚಿಂತನೆಯೊಂದಿಗೆ ಹಾಡಿ', 'अद्यतनचिन्तनेन सह गायत'],
  'New thoughts will appear here as they are shared.': ['புதிய சிந்தனைகள் பகிரப்படும்போது இங்கே தோன்றும்.', 'ಹೊಸ ಚಿಂತನೆಗಳು ಹಂಚಿಕೊಂಡಂತೆ ಇಲ್ಲಿ ಕಾಣುತ್ತವೆ.', 'नूतनचिन्तनानि अत्र दृश्यन्ते।'],
  'The meaning of this song will be added soon.': ['இந்தப் பாடலின் பொருள் விரைவில் சேர்க்கப்படும்.', 'ಈ ಹಾಡಿನ ಅರ್ಥ ಶೀಘ್ರದಲ್ಲೇ ಸೇರಿಸಲಾಗುವುದು.', 'अस्य गीतस्य अर्थः शीघ्रं योजयिष्यते।'],
  'A recording of this song will be added soon.': ['இந்தப் பாடலின் ஒலிப்பதிவு விரைவில் சேர்க்கப்படும்.', 'ಈ ಹಾಡಿನ ಧ್ವನಿಮುದ್ರಣ ಶೀಘ್ರದಲ್ಲೇ ಸೇರಿಸಲಾಗುವುದು.', 'अस्य गीतस्य ध्वनिमुद्रणं शीघ्रं योजयिष्यते।'],
  'Could not load. Please check the internet.': ['ஏற்ற முடியவில்லை. இணைய இணைப்பைச் சரிபாருங்கள்.', 'ಲೋಡ್ ಆಗಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ಪರಿಶೀಲಿಸಿ.', 'आनेतुं न शक्यते। अन्तर्जालं परीक्षध्वम्।'],
  'How would you like to use Harinamadwar?': ['ஹரிநாமத்வாரை எப்படிப் பயன்படுத்த விரும்புகிறீர்கள்?', 'ಹರಿನಾಮದ್ವಾರವನ್ನು ಹೇಗೆ ಬಳಸಲು ಬಯಸುತ್ತೀರಿ?', 'हरिनामद्वारं कथम् उपयोक्तुम् इच्छथ?'],
  'Listen and sing along': ['கேட்டுக் கூடவே பாடுங்கள்', 'ಕೇಳಿ ಜೊತೆಗೆ ಹಾಡಿ', 'शृणुत सह गायत'],
  'Bhajans, meanings and recordings': ['பஜனைகள், பொருள், ஒலிப்பதிவுகள்', 'ಭಜನೆಗಳು, ಅರ್ಥ, ಧ್ವನಿಮುದ್ರಣಗಳು', 'भजनानि, अर्थाः, ध्वनिमुद्रणानि'],
  'Join satsangs': ['சத்சங்கங்களில் சேருங்கள்', 'ಸತ್ಸಂಗಗಳಿಗೆ ಸೇರಿ', 'सत्सङ्गेषु सम्मिलत'],
  'Upcoming satsangs, photos and clips': ['வரவிருக்கும் சத்சங்கங்கள், புகைப்படங்கள், காணொளிகள்', 'ಮುಂಬರುವ ಸತ್ಸಂಗಗಳು, ಫೋಟೋಗಳು, ಕ್ಲಿಪ್‌ಗಳು', 'आगामिसत्सङ्गाः, चित्राणि, चलचित्राणि'],
  'Learn in the daily sessions': ['தினசரி வகுப்புகளில் கற்றுக்கொள்ளுங்கள்', 'ದೈನಂದಿನ ತರಗತಿಗಳಲ್ಲಿ ಕಲಿಯಿರಿ', 'दैनिककक्षासु अधीध्वम्'],
  'Daily session, this week’s songs, your own progress': ['தினசரி வகுப்பு, இந்த வாரப் பாடல்கள், உங்கள் முன்னேற்றம்', 'ದೈನಂದಿನ ತರಗತಿ, ಈ ವಾರದ ಹಾಡುಗಳು, ನಿಮ್ಮ ಪ್ರಗತಿ', 'दैनिककक्षा, अस्य सप्ताहस्य गीतानि, भवतः प्रगतिः'],
  'Dates and venues, photos and clips': ['தேதிகள், இடங்கள், புகைப்படங்கள், காணொளிகள்', 'ದಿನಾಂಕಗಳು, ಸ್ಥಳಗಳು, ಫೋಟೋಗಳು, ಕ್ಲಿಪ್‌ಗಳು', 'दिनाङ्काः, स्थानानि, चित्राणि, चलचित्राणि'],
  'Our satsangs, our guide, how to invite us': ['எங்கள் சத்சங்கங்கள், வழிகாட்டி, எங்களை அழைப்பது எப்படி', 'ನಮ್ಮ ಸತ್ಸಂಗಗಳು, ಮಾರ್ಗದರ್ಶಕರು, ನಮ್ಮನ್ನು ಆಹ್ವಾನಿಸುವುದು ಹೇಗೆ', 'अस्माकं सत्सङ्गाः, मार्गदर्शकः, आह्वानविधिः च'],
  'Our satsangs, our guide, and how to invite us': ['எங்கள் சத்சங்கங்கள், வழிகாட்டி, எங்களை அழைப்பது எப்படி', 'ನಮ್ಮ ಸತ್ಸಂಗಗಳು, ಮಾರ್ಗದರ್ಶಕರು, ನಮ್ಮನ್ನು ಆಹ್ವಾನಿಸುವುದು ಹೇಗೆ', 'अस्माकं सत्सङ्गाः, मार्गदर्शकः, आह्वानविधिः च'],
  'OPEN TO EVERYONE': ['அனைவருக்கும் திறந்தது', 'ಎಲ್ಲರಿಗೂ ಮುಕ್ತ', 'सर्वेभ्यः मुक्तम्'],
  'Shri Janakiraman’s reflections': ['ஸ்ரீ ஜானகிராமனின் சிந்தனைகள்', 'ಶ್ರೀ ಜಾನಕಿರಾಮನ್ ಅವರ ಚಿಂತನೆಗಳು', 'श्रीजानकिरामनस्य चिन्तनानि'],
  'Today I sang': ['இன்று நான் பாடியது', 'ಇಂದು ನಾನು ಹಾಡಿದ್ದು', 'अद्य मया गीतम्'],
  'TODAY I SANG': ['இன்று நான் பாடியது', 'ಇಂದು ನಾನು ಹಾಡಿದ್ದು', 'अद्य मया गीतम्'],
  'Record with sruti': ['ஸ்ருதியுடன் பதிவு செய்', 'ಶ್ರುತಿಯೊಂದಿಗೆ ರೆಕಾರ್ಡ್ ಮಾಡಿ', 'श्रुत्या सह ध्वनिमुद्रणम्'],
  'Sing with sruti and record yourself': ['ஸ்ருதியுடன் பாடி உங்கள் குரலைப் பதிவு செய்யுங்கள்', 'ಶ್ರುತಿಯೊಂದಿಗೆ ಹಾಡಿ ನಿಮ್ಮ ಧ್ವನಿಯನ್ನು ರೆಕಾರ್ಡ್ ಮಾಡಿ', 'श्रुत्या सह गायत, स्वस्वरं मुद्रयत'],
};
const LI = { ta: 0, kn: 1, sa: 2 };
const trWrap = orig => orig.match(/^[\s\u00a0]*/)[0] + tr(i18nKey(orig)) + orig.match(/[\s\u00a0]*$/)[0];
const i18nKey = s => s.replace(/[\s ]+/g, ' ').trim();
/** a fixed English phrase in the chosen language */
// SCRUM-94: only book names and the sentences people must understand are translated (same list as Android Tr.java)
const TR_KEEP = new Set(['A doorway to the Lord’s Name', 'Divya Nama Sankeertanam', 'Śrī Gīta Govindam', '24 Aṣṭapadis of Śrī Jayadeva',
  'Bhajans of many saints', '4000 pāsurams of the Āzhvārs', 'The life and story of the saint who composed this song will be added here.',
  'Continue', 'Your phone number', 'Invite code', 'Welcome to Harinamadwar', 'Enter the code you received on WhatsApp',
  'No code? Ask your satsang admin.', 'I understand', 'For our class only', 'Tick a song when you can sing it. Only you see this.',
  'All of this week’s songs. Wonderful!', 'Contents updated', 'Message from Shri Janakiraman (Jani)', 'About this week’s songs',
  'Tap a song to open it. Tap the heart to remove it.', 'No satsangs announced yet. Please check again soon.',
  'How did this thought touch you?', 'New thoughts will appear here as they are shared.', 'The meaning of this song will be added soon.',
  'A recording of this song will be added soon.', 'Could not load. Please check the internet.', 'How would you like to use Harinamadwar?',
  'Listen and sing along', 'Bhajans, meanings and recordings', 'Join satsangs', 'Upcoming satsangs, photos and clips',
  'Learn in the daily sessions', 'Daily session, this week’s songs, your own progress', 'Shri Janakiraman’s reflections',
  'Your name (so we can greet you)', 'Choose any. We’ll keep your home page simple. You can change this any time.',
  'Shri Janakiraman’s reflections on everyday life, newest first.', 'Your access is paused', 'Please connect to the internet']);
function tr(s) { const i = LI[prefs.lang]; if (i === undefined) return s; const k = i18nKey(s), v = I18N[k]; return v && TR_KEEP.has(k) ? v[i] : (v ? k : s); }
const trText = new Map();   // text node → its English original
const trAttr = new Map();   // element → { attribute: English original }
const TR_ATTRS = ['placeholder', 'aria-label', 'title'];
let trBusy = false;
function trNode(n) {
  if (n.nodeType === 3) {
    if (n.parentElement && n.parentElement.closest('[data-notr], script, style')) return;
    let orig = trText.get(n);
    if (orig === undefined || (n.nodeValue !== orig && n.nodeValue !== trWrap(orig))) {
      if (!I18N[i18nKey(n.nodeValue)]) { trText.delete(n); return; }
      orig = n.nodeValue; trText.set(n, orig);
    }
    const out = trWrap(orig);
    if (n.nodeValue !== out) n.nodeValue = out;
  } else if (n.nodeType === 1) {
    if (n.closest('[data-notr]')) return;
    for (const a of TR_ATTRS) {
      if (!n.hasAttribute(a)) continue;
      const rec = trAttr.get(n) || {}, cur = n.getAttribute(a);
      if (rec[a] === undefined || (cur !== rec[a] && cur !== tr(rec[a]))) { if (!I18N[i18nKey(cur)]) continue; rec[a] = cur; trAttr.set(n, rec); }
      const out = tr(rec[a]); if (cur !== out) n.setAttribute(a, out);
    }
  }
}
function trTree(root) {
  if (!root) return;
  trBusy = true;
  try {
    if (root.nodeType === 3) { trNode(root); return; }
    trNode(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) trNode(n);
  } finally { trBusy = false; }
}
function applyLang() {
  document.documentElement.lang = prefs.lang === 'sa' ? 'sa' : prefs.lang;
  document.body.dataset.lang = prefs.lang;
  for (const [n, orig] of trText) { if (!n.isConnected) { trText.delete(n); continue; } n.nodeValue = trWrap(orig); }
  for (const [el, rec] of trAttr) { if (!el.isConnected) { trAttr.delete(el); continue; } for (const a in rec) el.setAttribute(a, tr(rec[a])); }
  trTree(document.body);
}
new MutationObserver(ms => { if (trBusy) return; for (const m of ms) { if (m.type === 'childList') m.addedNodes.forEach(trTree); else trTree(m.target); } })
  .observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TR_ATTRS });

const ndpLang = () => NDP_BOOK[prefs.lang] ? prefs.lang : 'en';
const badge = (name, cls) => `<span class="ibadge ${cls || ''}">${svgI(name)}</span>`;
const CHANNEL = 'https://www.youtube.com/@HariNamadwar';

// ---------- community content: community/*.txt (updated from GitHub, no new app needed) ----------
async function communityLines(file) {
  let t = '';
  try { t = await fetchText('community/' + file); } catch (e) { }
  return t.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** Satsangs whose last day is today or later, soonest first. */
async function events() {
  const today = todayIso(), out = [];
  for (const l of await communityLines('events.txt')) {
    const f = l.split('|').map(x => x.trim());
    if (f.length < 6 || f[0] < today) continue;
    out.push({ when: f[1], month: f[2], days: f[3], name: f[4], place: f[5], songs: (f[6] || '').split(',').map(x => x.trim()).filter(Boolean), live: /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(f[7] || '') ? f[7] : '', last: f[0] });
  }
  return out;
}
async function learnValue(key) {
  for (const l of await communityLines('learn.txt')) if (l.startsWith(key + '=')) return l.slice(key.length + 1).trim();
  return '';
}
async function practice() { const v = await learnValue('songs'); return v ? v.split(',').map(x => x.trim()).filter(Boolean) : []; }
const pracRef = r => { const i = r.indexOf(':'); return i > 0 && BOOKS[r.slice(0, i)] ? { id: r.slice(0, i), number: r.slice(i + 1) } : { id: 'dns', number: r }; };
async function pracSong(r) {
  if (r.startsWith('other:')) {   // 4.18 · SCRUM-97: a song that is not in the app
    const o = (await otherSongs()).get(r.slice(6));
    return o ? { ref: r, id: 'other', number: o.id, title: o.title, sub: o.about, hash: '#other/' + o.id, other: true } : null;
  }
  const { id, number } = pracRef(r);
  try {
    const s = (await loadBook(id)).songs.find(x => x.number === number); if (!s) return null;
    let title = s.displayTitle;
    if (prefs.lang !== 'en') {
      const f = BOOKS[id].base + lyricsFile(prefs.lang);
      const tm = texts[f] || (texts[f] = parseBlocks(await fetchText(f).catch(() => '')));
      const tt = tm.get(number); if (tt && tt.title) title = tt.title;
    }
    return { ref: r, id, number, title, sub: id === 'dns' ? s.number + ' · ' + (s.displayRaga || s.chapter) : (id === 'ashta' ? T('ashtapadi') : T('pasuram')) + s.number + (s.displayRaga ? ' · ' + s.displayRaga : ''), hash: BOOKS[id].hash + number };
  } catch (e) { return null; }
}

// ---------- 4.18 · SCRUM-97: other songs (not in the app) that admins paste for a satsang ----------
// community other.txt: "@@ id | name | about", then the lyrics (blank lines between verses kept) until the next "@@"
async function otherSongs() {
  let t = '';
  try { t = await fetchText('community/other.txt'); } catch (e) { }
  const m = new Map(); let cur = null;
  for (const line of t.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('@@')) { const h = line.slice(2).split('|'); cur = { id: h[0].trim(), title: (h[1] || '').trim(), about: h.slice(2).join('|').trim(), lines: [] }; m.set(cur.id, cur); }
    else if (cur) cur.lines.push(line);
  }
  for (const o of m.values()) { o.lyrics = o.lines.join('\n').trim(); delete o.lines; }
  return m;
}
async function showOther(id) {
  showView('v-other');
  const o = (await otherSongs()).get(id), i = plIndex();
  const bar = $('other-pl');
  bar.classList.toggle('hidden', !(plNow && i >= 0));
  if (plNow && i >= 0) bar.innerHTML = `${svgI('music')}<span class="pl-mid"><span>${esc(plNow.name)} · song ${i + 1} of ${plNow.hashes.length}</span></span><button class="pl-all" data-go="#satsang/${esc(plNow.last)}">All songs</button>`;
  const p = plStep(-1), n = plStep(1);
  $('other-prev').textContent = p ? '‹ ' + i + '. ' + short(plNow.titles[i - 1], 14) : '';
  $('other-next').textContent = n ? (i + 2) + '. ' + short(plNow.titles[i + 1], 14) + ' ›' : '';
  $('other-prev').style.visibility = p ? 'visible' : 'hidden'; $('other-next').style.visibility = n ? 'visible' : 'hidden';
  $('other-prev').onclick = () => { if (p) plGo(p); };   // as on a song page: Back returns to the list
  $('other-next').onclick = () => { if (n) plGo(n); };
  $('other-box').innerHTML = !o ? `<p class="o-soon">This song is no longer in the list. Please go back.</p>`
    : `<h2 class="o-title">${esc(o.title)}</h2><span class="o-tag">Other song · not in the app</span>` +
      (o.about ? `<p class="o-about">${esc(o.about)}</p>` : '') +
      `<div class="o-hint">Pinch to zoom, or use A− A+ above</div>` +
      (o.lyrics ? `<div class="text o-lyrics">${esc(nb(o.lyrics))}</div>` : `<p class="o-soon">The words of this song will be added soon.</p>`);
  $('other-scroll').scrollTop = 0;
  keepAwake(true);
}
$('other-smaller').onclick = () => setScale(prefs.scale / STEP);
$('other-bigger').onclick = () => setScale(prefs.scale * STEP);

// Thought for the Day: @@ number | series | title | book:song, then paragraphs separated by blank lines
// Tamil and Kannada translations: community/tfd_ta.txt, tfd_kn.txt (same numbers); a thought not yet translated shows in English
const TFD_LANGS = [['en', 'English'], ['ta', 'தமிழ்'], ['kn', 'ಕನ್ನಡ']];
let tfdLang = store.get('tfdLang', ['ta', 'kn'].includes(store.get('lang', 'en')) ? store.get('lang', 'en') : 'en');
// 4.17: a new app language also becomes the language of the thoughts (Tamil/Kannada; English otherwise). The TFD page's own picker still works.
function syncTfdLang(v) { tfdLang = ['ta', 'kn'].includes(v) ? v : 'en'; store.set('tfdLang', tfdLang); }
async function tfdsIn(lang) {
  const en = await tfds();
  if (lang === 'en') return en;
  const tr = new Map((await tfds(lang)).map(t => [t.number, t]));
  return en.map(t => tr.get(t.number) ? Object.assign({}, tr.get(t.number), { lang }) : Object.assign({}, t, { untranslated: true }));
}
const tfdSeg = () => `<div class="tfd-seg" role="group" aria-label="Language of the thoughts" data-notr>` + TFD_LANGS.map(([c, n]) =>
  `<button class="${c === tfdLang ? 'on' : ''}" data-tl="${c}" aria-pressed="${c === tfdLang}" lang="${c}">${n}</button>`).join('') + '</div>';
function wireTfdSeg(redraw) {
  document.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => { if (tfdLang === b.dataset.tl) return; tfdLang = b.dataset.tl; store.set('tfdLang', tfdLang); redraw(); });
}
const TFD_SOON = { ta: 'இந்தச் சிந்தனையின் தமிழ் மொழிபெயர்ப்பு விரைவில் வரும். இப்போது ஆங்கிலத்தில்:', kn: 'ಈ ಚಿಂತನೆಯ ಕನ್ನಡ ಅನುವಾದ ಶೀಘ್ರದಲ್ಲೇ ಬರಲಿದೆ. ಈಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ:' };
async function tfds(lang) {
  let t = '';
  try { t = await fetchText(lang && lang !== 'en' ? 'community/tfd_' + lang + '.txt' : 'community/tfd.txt'); } catch (e) { }
  const out = []; let cur = null, para = [];
  const flush = () => { if (cur && para.length) cur.paras.push(para.join('\n')); para = []; };
  for (const line of t.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      const h = line.slice(2).split('|').map(x => x.trim());
      const song = h[3] || '', c = song.indexOf(':');
      cur = { number: h[0] || '', series: h[1] || '', title: h[2] || '', songBook: c > 0 ? song.slice(0, c).trim() : '', songNumber: c > 0 ? song.slice(c + 1).trim() : '', paras: [] };
      out.push(cur);
    } else if (cur) {
      if (!line.trim()) flush(); else para.push(line.trim());
    }
  }
  flush();
  const num = s => parseInt(String(s).replace(/\D/g, ''), 10) || 0;
  return out.sort((x, y) => num(y.number) - num(x.number));
}
/** A short line without closing punctuation is one of his headings; the last short line is the sign-off. */
function tfdKind(paras, i) {
  const p = paras[i].trim();
  if (i === paras.length - 1 && p.length < 40) return 'signoff';
  if (/^\d+\.\s/.test(p)) return 'numbered';
  if (p.length <= 60 && !p.includes('\n') && !/[.?!:,;"”’…]$/.test(p)) return 'heading';
  return 'text';
}

// ---------- kept on this phone only ----------
const interest = k => store.get('interest', {})[k] !== false;
function setInterest(k, v) { const m = store.get('interest', {}); m[k] = v; store.set('interest', m); }
const favKey = (b, n) => b + '|' + n;
const favList = () => store.get('favs', []);
const isFav = (b, n) => favList().some(f => favKey(f.book, f.number) === favKey(b, n));
function toggleFav(b, s) {
  let l = favList();
  if (isFav(b, s.number)) l = l.filter(f => favKey(f.book, f.number) !== favKey(b, s.number));
  else l.unshift({ book: b, number: s.number, title: s.displayTitle, raga: s.displayRaga, at: Date.now() });
  store.set('favs', l);
}
const learnt = n => !!store.get('learnt', {})[n];
function setLearnt(n, v) { const m = store.get('learnt', {}); if (v) m[n] = true; else delete m[n]; store.set('learnt', m); }

async function dnsSong(number) {
  try { return (await loadBook('dns')).songs.find(s => s.number === number) || null; } catch (e) { return null; }
}

/** Same song for everyone on a given day: a Divya Nama song with a recording and a rāgam (same pick as Android). */
async function songOfTheDay() {
  try {
    const d = await loadBook('dns'), am = await loadAudio(BOOKS.dns);
    const pool = d.songs.filter(s => s.raga && am.has(s.number));
    if (!pool.length) return null;
    const now = new Date(), start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 864e5);
    return pool[(now.getFullYear() * 400 + doy) % pool.length];
  } catch (e) { return null; }
}

// Watch live (opens the YouTube app) and Share, in the app's own colours
const liveRow = e => `<div class="ev-live"><a class="ev-yt" href="${esc(e.live)}" target="_blank" rel="noopener"><span class="yt-mark">${svgI('play')}</span>Watch live</a>` +
  `<button class="ev-share" data-live="${esc(e.live)}" data-msg="${esc('🙏 Watch Harinamadwar live – ' + e.name + ', ' + e.when + ', at ' + e.place + '.\nYouTube: ' + e.live)}" aria-label="Share the live link">${svgI('share')}<span>Share</span></button></div>`;
/** SCRUM-95: compact satsang tile – date, name and place, then songs · Watch · Share in one row.
 *  detail = the satsang's own page: the name may take two lines and there is no songs button. */
function eventRows(list, big, detail) {
  if (!big) return list.map(e => `<div class="ev-row"><div class="ev-date"><span>${esc(e.month)}</span><b class="${e.days.length > 2 ? 'long' : ''}">${esc(e.days)}</b></div>` +
    `<div class="ev-t"><b>${esc(e.name)}</b><span class="ev-where">${svgI('pin')}at ${esc(e.place)}</span></div></div>`).join('');
  return list.map(e => {
    const songs = !detail && e.songs && e.songs.length, open = songs ? ` data-go="#satsang/${esc(e.last)}"` : '';
    const msg = e.live ? '🙏 Watch Harinamadwar live – ' + e.name + ', ' + e.when + ', at ' + e.place + '.\nYouTube: ' + e.live
                       : '🙏 Harinamadwar satsang – ' + e.name + ', ' + e.when + ', at ' + e.place + '.';
    return `<div class="evc${detail ? ' detail' : ''}"><div class="evc-top"${open}><div class="evc-date${e.days.length > 2 ? ' long' : ''}"><small>${esc(e.month)}</small><b>${esc(e.days)}</b></div>` +
      `<div class="evc-t"><b>${esc(e.name)}</b><span>at ${esc(e.place)}</span></div></div><div class="evc-act">` +
      (songs ? `<button class="evc-b songs" data-go="#satsang/${esc(e.last)}" aria-label="${e.songs.length} songs to be sung. See the list">${svgI('music')}<span>${e.songs.length} songs</span></button>` : '') +
      (e.live ? `<a class="evc-b watch" href="${esc(e.live)}" target="_blank" rel="noopener" aria-label="Watch live on YouTube">${svgI('play')}<span>Watch</span></a>` : '') +
      `<button class="evc-b share" data-live="1" data-msg="${esc(msg)}" aria-label="Share this satsang">${svgI('share')}<span>Share</span></button></div></div>`;
  }).join('');
}

// ---------- home ----------
let homeBusy = 0;
async function showHome() {
  showView('v-home');
  document.body.dataset.lang = prefs.lang;   // Indian scripts: no letter-spacing in labels
  const my = ++homeBusy;
  const who = store.get('name', '').trim();
  $('home-hello').innerHTML = `<span>${T('hello')}${who ? ',' : ''}</span>${who ? ` <b>${esc(who)}</b>` : ''}`;
  paintLangBars();
  const [tf, prac, meet] = await Promise.all([tfdsIn(tfdLang), practice(), learnValue('meet')]);
  if (my !== homeBusy) return;
  const out = [];
  // 4.10 home: Choose a Book · Thought for the Day · Satsangs / Learn / Favourites · About (everything on one screen)
  const band = (icon, label, right) => `<div class="h3-band">${svgI(icon, 'h3-bi')}<b>${label}</b>${right || ''}</div>`;
  out.push(`<section class="h3-sec">${band('book', T('choose'))}<div class="h3-body"><div class="h3-books">` +
    `<button class="h3-arch" data-go="#book/dns">${goldBadge('cymbals', 'big')}<b>${T('dns')[0]}</b><span>${T('dns')[1].replace('<br>', ' ')}</span></button>` +
    `<button class="h3-arch" data-go="#book/ashta">${goldBadge('flute', 'big')}<b>${T('ashta')[0]}</b><span>${T('ashta')[1].replace('<br>', ' ')}</span></button></div>` +
    `<button class="h3-wide" data-go="#book/ndp">${goldBadge('palmleaf')}<span class="h3-t"><b>${NDP_BOOK[ndpLang()][0]}</b><span>${NDP_BOOK[ndpLang()][1]}</span></span></button></div></section>`);
  if (tf.length) {
    const t = tf[0];
    out.push(`<section class="h3-sec">${band('lotus', T('tfd'), `<span class="h3-num">TFD ${esc(t.number)}</span>`)}<div class="h3-body">` +
      `<button class="h3-card" data-go="#tfd/${esc(t.number)}">${goldBadge('lotus')}<span class="h3-t"><b class="clamp2">${esc(t.title)}</b>` +
      `<span class="one">${esc(t.paras[0] || '')}</span><span class="h3-read">${T('read')}</span></span></button></div></section>`);
  }
  const tiles = [`<button class="tile" data-go="#diary">${badge('calendar')}<b>${T('diary')}</b></button>`];
  if (interest('learn') && (prac.length || meet)) tiles.push(`<button class="tile" data-go="#learn">${badge('class')}<b>${T('learn')}</b></button>`);
  tiles.push(`<button class="tile" data-go="#favs">${badge('heart')}<b>${T('favs')}</b></button>`);
  out.push(`<div class="tiles">${tiles.join('')}</div>`);
  out.push(`<section class="h3-sec">${band('lamp', T('about')[0])}<div class="h3-body"><button class="h3-card" data-go="#about">${goldBadge('lamp')}<span class="h3-t h3-about">${T('about')[1]}</span>${svgI('chevron', 'chev2')}</button></div></section>`);
  out.push(`<button class="h-change" data-go="#welcome">${T('change')}</button>`);
  $('home-box').innerHTML = out.join('');
  $('home-scroll').scrollTop = homeScroll;   // come back to the same place, not the top (SCRUM-51)
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) { openTab = b.dataset.openTab ? +b.dataset.openTab : null; go(b.dataset.go); return; }
  const sh = e.target.closest('[data-live]');   // share a satsang's YouTube live link
  if (sh) {
    const text = sh.dataset.msg;   // "🙏 Watch Harinamadwar live – Radha Kalyanam, Nov 28 and 29, at RP3 Bangalore. YouTube: …"
    if (navigator.share) navigator.share({ title: 'Harinamadwar', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied. You can paste it in WhatsApp.'));
  }
});

// ---------- welcome: name and what to show ----------
const KINDS = [
  ['listen', 'music', 'Listen and sing along', 'Bhajans, meanings and recordings'],
  ['satsang', 'calendar', 'Join satsangs', 'Upcoming satsangs, photos and clips'],
  ['learn', 'class', 'Learn in the daily sessions', 'Daily session, this week’s songs, your own progress'],
];
let welcomeOn = null;
function showWelcome() {
  showView('v-welcome');
  welcomeOn = KINDS.map(k => interest(k[0]));
  const box = $('welcome-box');
  box.innerHTML = `<h2 class="w-h">How would you like to use Harinamadwar?</h2><p class="mut w-s">Choose any. We’ll keep your home page simple. You can change this any time.</p>` +
    `<label class="fb-l" for="w-name">Your name (so we can greet you)</label><input id="w-name" class="fb-in" type="text" placeholder="Optional" autocapitalize="words" autocomplete="given-name">` +
    KINDS.map((k, i) => `<button class="w-opt" data-i="${i}" aria-pressed="false">${badge(k[1])}<span class="hc-t"><b>${k[2]}</b><span class="mut">${k[3]}</span></span><span class="tick"></span></button>`).join('') +
    `<p class="mut w-note">Everyone can read the Thought for the Day and use all the songs.</p><button class="done" id="w-go">Continue</button>`;
  $('w-name').value = store.get('name', '');
  const paint = () => box.querySelectorAll('.w-opt').forEach(b => {
    const on = welcomeOn[+b.dataset.i];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    b.querySelector('.tick').innerHTML = on ? svgI('check') : '';
  });
  box.querySelectorAll('.w-opt').forEach(b => { b.onclick = () => { welcomeOn[+b.dataset.i] = !welcomeOn[+b.dataset.i]; paint(); }; });
  paint();
  $('w-go').onclick = () => {
    store.set('name', $('w-name').value.trim());
    KINDS.forEach((k, i) => setInterest(k[0], welcomeOn[i]));
    store.set('interestsDone', true);
    if (!prefs.setupDone) { replaceHash('#settings'); route(); } else back('');
  };
}

// ---------- satsang diary ----------
async function showDiary() {
  showView('v-diary');
  const ev = await events();
  $('diary-box').innerHTML =
    `<div class="d-count"><b>195+</b><span>gatherings so far, by His grace</span></div>` +
    `<span class="lbl sect">UPCOMING</span>` +
    (ev.length ? eventRows(ev, true) : `<p class="mut">No satsangs announced yet. Please check again soon.</p>`) +
    `<span class="lbl sect">FROM PAST SATSANGS · YOUTUBE SHORTS</span>` +
    `<a class="card d-yt" href="${CHANNEL}/shorts" target="_blank" rel="noopener">${badge('video')}<span class="hc-t"><b>Watch clips from past satsangs</b><span class="mut">Short videos on our YouTube channel, @HariNamadwar</span></span>${svgI('chevron', 'chev2')}</a>` +
    `<span class="lbl sect">PHOTOS</span><img class="d-photo" src="icons/about-group.jpg" alt="Devotees singing at a Harinamadwar satsang">` +
    `<a class="btn-acc wide" href="tel:+919845204620">${svgI('phone')}Invite us to your home</a>`;
  restoreScroll('v-diary');
}

// ---------- songs to be sung at a satsang (the admin sets the list and its order) ----------
let plNow = null;   // { name, last, refs: [...], hashes: [...] } while songs are opened from a satsang's list
async function showPlaylist(last) {
  showView('v-playlist');
  const e = (await events()).find(x => x.last === last);
  if (!e) { replaceHash('#diary'); return showDiary(); }
  const list = (await Promise.all(e.songs.map(pracSong))).filter(Boolean);
  plNow = { name: e.name, last, hashes: list.map(s => s.hash), titles: list.map(s => s.title) };
  const out = [`<span class="lbl sect">UPCOMING SATSANG</span>` + eventRows([e], true, true)];
  out.push(`<div class="pl-sum"><span><b>${list.length} songs</b>, in the order they will be sung</span>` +
    (list.length ? `<button class="btn-acc" data-go="${esc(list[0].hash)}" data-open-tab="0">${svgI('book')}Start from song 1</button>` : '') + `</div>`);
  out.push(`<div class="card list pl-list">` + list.map((s, i) =>
    `<div class="l-row pl-row"><span class="pl-n">${i + 1}</span>` +
    `<button class="hc-t l-open" data-go="${esc(s.hash)}" data-open-tab="0"${s.other ? ' data-notr' : ''}><b>${esc(s.title)}</b><span class="mut">${esc(s.sub)}</span></button>` +
    (s.other ? `<span class="o-tag">Other song</span></div>`   // 4.18: not in the app – words only
      : `<button class="ibadge" data-go="${esc(s.hash)}" data-open-tab="2" aria-label="Listen to ${esc(s.title)}">${svgI('play')}</button></div>`)).join('') + `</div>`);
  out.push(`<p class="mut center small">Tap a song for its words and meaning, or ▶ for its recording. The list may change until the day of the satsang.</p>`);
  $('playlist-box').innerHTML = out.join('');
  restoreScroll('v-playlist');
}

// ---------- learn ----------
async function showLearn() {
  showView('v-learn');
  const [meet, prac] = await Promise.all([learnValue('meet'), practice()]);
  const list = (await Promise.all(prac.map(pracSong))).filter(Boolean);
  const done = prac.filter(learnt).length, showP = store.get('showProgress', true);
  const frac = prac.length ? Math.min(1, done / prac.length) : 0, C = 2 * Math.PI * 34;
  const out = [];
  if (meet) out.push(`<div class="l-meet"><div class="l-mt">${badge('video', 'gold')}<span class="hc-t"><span class="lbl">DAILY SESSION</span><b>Join on Google Meet</b><span>${esc(meet.replace(/^https?:\/\//, ''))}</span></span></div>` +
    `<a class="btn-acc wide" href="${esc(meet)}" target="_blank" rel="noopener">${svgI('video')}Join today’s session</a></div>`);
  if (showP) out.push(`<div class="card l-prog"><div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="34" class="trk"/>` +
    (frac > 0 ? `<circle cx="42" cy="42" r="34" class="arc" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/>` : '') +
    `</svg><b>${done}</b></div><span class="hc-t"><span class="lbl">MY PROGRESS</span><b>${done === 1 ? '1 song I can sing' : done + ' songs I can sing'}</b>` +
    `<span class="mut">${prac.length && done >= prac.length ? 'All of this week’s songs. Wonderful!' : 'Tick a song when you can sing it. Only you see this.'}</span></span></div>`);
  out.push(`<button class="l-toggle" id="l-toggle">${showP ? 'Hide my progress' : 'Show my progress'}</button>`);
  // tap the name: the song's lyrics · tap ▶: the song's recording (Audio tab) · Back returns here
  out.push(`<span class="lbl sect">THIS WEEK’S SONGS FROM SHRI JANAKIRAMAN (JANI)</span><div class="card list">` + list.map(s => {
    const on = learnt(s.ref);
    return `<div class="l-row"><button class="tickbox${on ? ' on' : ''}" data-n="${esc(s.ref)}" aria-label="${on ? 'I can sing this' : 'Mark as a song I can sing'}">${on ? svgI('check') : ''}</button>` +
      `<button class="hc-t l-open" data-go="${esc(s.hash)}" data-open-tab="0"><b>${esc(s.title)}</b><span class="mut">${esc(s.sub)}</span></button>` +
      `<button class="ibadge" data-go="${esc(s.hash)}" data-open-tab="2" aria-label="Listen to ${esc(s.title)}">${svgI('play')}</button></div>`;
  }).join('') + `</div>`);
  // Record with sruti: on hold for now (feature kept in sruti.html)
  out.push(`<div class="l-msg"><img src="icons/about-jk.jpg" alt=""><span class="hc-t"><span class="l-msg-l">Message from Shri Janakiraman (Jani)</span><b>About this week’s songs</b><span class="soon">Audio message · coming soon</span></span></div>`);
  $('learn-box').innerHTML = out.join('');
  restoreScroll('v-learn');
  $('l-toggle').onclick = () => { store.set('showProgress', !showP); keepScroll('learn', showLearn); };
  $('learn-box').querySelectorAll('.tickbox').forEach(b => { b.onclick = () => { setLearnt(b.dataset.n, !learnt(b.dataset.n)); keepScroll('learn', showLearn); }; });
}
// back from a song: the list stays where it was (Learn, Favourites, Satsangs, a satsang's songs)
function restoreScroll(id) { if (prevView === 'v-song' && scrollMem[id] != null) { const sc = $(id).querySelector('.scroll'); if (sc) sc.scrollTop = scrollMem[id]; } }
async function keepScroll(id, fn) { const y = $(id + '-scroll').scrollTop; await fn(); $(id + '-scroll').scrollTop = y; }

// ---------- my favourites ----------
let favsBusy = 0;
async function showFavs() {
  showView('v-favs');
  const my = ++favsBusy;
  // 4.17: titles in the language in use now (the saved title is the English one from when the heart was tapped)
  const l = await Promise.all(favList().map(async f => { const ps = await pracSong(f.book + ':' + f.number); return Object.assign({}, f, ps && ps.title ? { title: ps.title } : {}); }));
  if (my !== favsBusy) return;
  $('favs-box').innerHTML = !l.length
    ? `<div class="f-empty">${badge('heart', 'big')}<b>No favourites yet</b><p class="mut">Open any song and tap the ♡ at the top. It will appear here, so you can come back to listen and learn.</p></div>`
    : `<span class="lbl">${l.length === 1 ? '1 SONG' : l.length + ' SONGS'}</span><div class="card list">` + l.map(f =>
      `<div class="l-row"><span class="badge">${esc(f.number)}</span>` +
      `<button class="hc-t l-open" data-go="${BOOKS[f.book] ? BOOKS[f.book].hash : '#song/'}${esc(f.number)}" data-open-tab="0"><b>${esc(f.title)}</b><span class="mut">${esc((f.book === 'ashta' ? 'Aṣṭapadi ' + f.number + (f.raga ? ' · ' : '') : '') + (f.raga || ''))}</span></button>` +
      `<button class="ibadge" data-go="${BOOKS[f.book] ? BOOKS[f.book].hash : '#song/'}${esc(f.number)}" data-open-tab="2" aria-label="Listen to ${esc(f.title)}">${svgI('play')}</button>` +
      `<button class="f-heart" data-b="${esc(f.book)}" data-n="${esc(f.number)}" aria-label="Remove from my favourites">${svgI('heart_on')}</button></div>`).join('') +
      `</div><p class="mut f-hint">Tap a song for its words, ▶ for its recording. Tap the heart to remove it.</p>`;
  restoreScroll('v-favs');
  $('favs-box').querySelectorAll('.f-heart').forEach(b => { b.onclick = e => {
    e.stopPropagation();
    store.set('favs', favList().filter(f => favKey(f.book, f.number) !== favKey(b.dataset.b, b.dataset.n)));
    keepScroll('favs', showFavs);
  }; });
}
function updateFav() {
  const s = songs[cur]; if (!s) return;
  const on = isFav(book.id, s.number);
  $('btn-fav').innerHTML = svgI(on ? 'heart_on' : 'heart');
  $('btn-fav').classList.toggle('on', on);
  $('btn-fav').setAttribute('aria-label', on ? 'Remove from my favourites' : 'Add to my favourites');
}
$('btn-fav').onclick = () => {
  const s = songs[cur]; if (!s) return;
  toggleFav(book.id, s); updateFav();
  toast(isFav(book.id, s.number) ? 'Added to My favourites' : 'Removed from My favourites');
};

// ---------- thought for the day ----------
let tfdQuery = '';
const tfdNorm = x => String(x || '').toLowerCase().normalize('NFC');
async function showTfdList() {
  showView('v-tfd');
  ttsStop();
  $('tfd-title').textContent = 'Thoughts for the Day';
  $('tfd-smaller').classList.add('hidden'); $('tfd-bigger').classList.add('hidden'); $('tfd-btn-search').classList.remove('hidden');
  $('tfd-search-row').classList.toggle('hidden', !tfdQuery);
  const all = await tfdsIn(tfdLang), q = tfdNorm(tfdQuery.trim());
  // a number finds that TFD; words search the title, series and text (in the language shown, and the English)
  const en = q && tfdLang !== 'en' ? new Map((await tfds()).map(t => [t.number, t])) : null;
  const hay = t => tfdNorm([t.title, t.series, t.paras.join(' ')].join(' ') + (en && en.get(t.number) ? ' ' + [en.get(t.number).title, en.get(t.number).paras.join(' ')].join(' ') : ''));
  const shown = !q ? all : /^\d+$/.test(q) ? all.filter(t => t.number === q || t.number.startsWith(q)) : all.filter(t => q.split(/\s+/).every(w => hay(t).includes(w)));
  $('tfd-box').innerHTML = tfdSeg() + (q ? `<p class="mut">${shown.length ? shown.length + (shown.length === 1 ? ' thought' : ' thoughts') + ' found' : 'No thoughts found'}</p>` : `<p class="mut">Shri Janakiraman’s reflections on everyday life, newest first.</p>`) + shown.map(t =>
    `<button class="card t-item" data-go="#tfd/${esc(t.number)}"><span class="lbl">TFD ${esc(t.number)}${t.series ? ' · ' + esc(t.series.toUpperCase()) : ''}</span><b>${esc(t.title)}</b><span class="teaser mut">${esc(t.paras[0] || '')}</span></button>`).join('') +
    (q ? '' : `<p class="mut center small">New thoughts will appear here as they are shared.</p>`);
  const sc = $('tfd-scroll');
  if (tfdFocus) {   // SCRUM-83: back from "All thoughts" – show the thought just read, briefly outlined
    const el = $('tfd-box').querySelector(`[data-go="#tfd/${CSS.escape(tfdFocus)}"]`);
    sc.scrollTop = el ? Math.max(0, el.offsetTop - 140) : tfdListY;
    if (el) { el.classList.add('was'); setTimeout(() => el.classList.remove('was'), 1600); }
  } else if (!q) sc.scrollTop = tfdBack ? tfdListY : 0;
  tfdFocus = null; tfdBack = false;
  wireTfdSeg(showTfdList);
}
let tfdNow = null, tfdListY = 0, tfdFocus = null, tfdBack = false;
$('tfd-btn-search').onclick = () => { $('tfd-search-row').classList.remove('hidden'); $('tfd-search').focus(); };
$('tfd-close-search').onclick = () => { tfdQuery = ''; $('tfd-search').value = ''; $('tfd-search-row').classList.add('hidden'); showTfdList(); };
let tfdTimer = null;
$('tfd-search').oninput = () => { clearTimeout(tfdTimer); tfdTimer = setTimeout(() => { tfdQuery = $('tfd-search').value; showTfdList(); }, 200); };

// ---------- read today's thought aloud (the phone's own voice; a man's voice where the phone has one) ----------
const TTS_LANG = { en: 'en-IN', ta: 'ta-IN', kn: 'kn-IN' };
const MALE = /male|man\b|rishi|ravi|hemant|prabhat|valluvar|kumar|aaron|daniel|arthur|fred|gordon|rocko|reed|eddy|grandpa/i, FEMALE = /female|woman|veena|lekha|vani|heera|kalpana|samantha|karen|moira|tessa|kate|serena|fiona|zira|swara|pallavi/i;
function ttsVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  const want = TTS_LANG[lang], vs = speechSynthesis.getVoices();
  const same = vs.filter(v => v.lang.replace('_', '-').toLowerCase() === want.toLowerCase());
  const near = same.length ? same : vs.filter(v => v.lang.toLowerCase().startsWith(lang));
  if (!near.length) return null;
  return near.find(v => MALE.test(v.name) && !FEMALE.test(v.name)) || near.find(v => !FEMALE.test(v.name)) || near[0];
}
let tts = { on: false, queue: [], i: 0 };
function ttsStop() { tts.on = false; try { speechSynthesis.cancel(); } catch (e) { } paintListen(); }
function paintListen() {
  const b = $('t-listen'); if (!b) return;
  b.classList.toggle('on', tts.on);
  b.innerHTML = tts.on ? `${svgI('stop')}<span>${{ en: 'Stop', ta: 'நிறுத்து', kn: 'ನಿಲ್ಲಿಸಿ' }[tfdLang]}</span>` : `${svgI('speaker')}<span>${{ en: 'Listen', ta: 'கேளுங்கள்', kn: 'ಕೇಳಿ' }[tfdLang]}</span>`;
}
function ttsSpeak(parts, lang) {
  const v = ttsVoice(lang);
  if (!v) { toast({ en: 'This phone has no voice for English reading.', ta: 'இந்த ஃபோனில் தமிழ் குரல் இல்லை. Settings › Text-to-speech இல் சேர்க்கலாம்.', kn: 'ಈ ಫೋನ್‌ನಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಇಲ್ಲ. Settings › Text-to-speech ನಲ್ಲಿ ಸೇರಿಸಬಹುದು.' }[lang]); return; }
  speechSynthesis.cancel();
  tts = { on: true, queue: parts, i: 0 }; paintListen();
  const next = () => {
    if (!tts.on || tts.i >= tts.queue.length) { tts.on = false; paintListen(); return; }
    const u = new SpeechSynthesisUtterance(tts.queue[tts.i++]);
    u.voice = v; u.lang = v.lang; u.rate = 0.92; u.pitch = 0.95;
    u.onend = next; u.onerror = () => { tts.on = false; paintListen(); };
    speechSynthesis.speak(u);
  };
  next();   // one paragraph at a time: long texts are cut off by some phones
}
if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; }
// ---------- reactions on a Thought for the Day (SCRUM-50): one per phone; tap again to take it back ----------
const REACTIONS = ['🙏', '❤️', '🌸', '😊', '👍'];
let reactNow = { tfd: 0, counts: {}, mine: null };
function paintReactions() {
  const box = $('t-react'); if (!box) return;
  box.innerHTML = `<span class="mut">How did this thought touch you?</span><div class="t-rx">` + REACTIONS.map(e => {
    const n = reactNow.counts[e] || 0;
    return `<button class="rx${reactNow.mine === e ? ' on' : ''}" data-rx="${e}" aria-pressed="${reactNow.mine === e}"><span>${e}</span>${n ? `<b>${n}</b>` : ''}</button>`;
  }).join('') + '</div>';
  box.querySelectorAll('[data-rx]').forEach(b => { b.onclick = () => react(b.dataset.rx); });
}
async function loadReactions(tfd) {
  reactNow = { tfd, counts: {}, mine: null }; paintReactions();
  try { const r = await rpc('app_reactions', { p_tfd: tfd, p_device_key: deviceKey() }); if (reactNow.tfd === tfd) { reactNow.counts = r.counts || {}; reactNow.mine = r.mine || null; paintReactions(); } }
  catch (e) { /* offline: the buttons still show, and work when back online */ }
}
async function react(e) {
  const tfd = reactNow.tfd, before = JSON.stringify(reactNow);
  // show it straight away, then confirm with the server
  if (reactNow.mine) reactNow.counts[reactNow.mine] = Math.max(0, (reactNow.counts[reactNow.mine] || 1) - 1);
  if (reactNow.mine === e) reactNow.mine = null; else { reactNow.mine = e; reactNow.counts[e] = (reactNow.counts[e] || 0) + 1; }
  paintReactions();
  try {
    const r = await rpc('app_react', { p_tfd: tfd, p_device_key: deviceKey(), p_emoji: e });
    if (r && r.ok && reactNow.tfd === tfd) { reactNow.counts = r.counts || {}; reactNow.mine = r.mine || null; paintReactions(); }
  } catch (err) { reactNow = JSON.parse(before); paintReactions(); toast('Could not send. Please check the internet.'); }
}

async function showTfd(number) {
  showView('v-tfd');
  if ($('tfd-box').querySelector('.t-item')) { tfdListY = $('tfd-scroll').scrollTop; tfdBack = true; }   // leaving the list: remember the place
  const all = await tfdsIn(tfdLang), i = all.findIndex(x => x.number === number), t = all[i];
  if (!t) { replaceHash('#tfd'); return showTfdList(); }
  const newer = all[i - 1], older = all[i + 1];   // the list is newest first
  const fresh = tfdNow !== number; tfdNow = number;
  $('tfd-title').textContent = 'Thought for the Day';
  $('tfd-smaller').classList.remove('hidden'); $('tfd-bigger').classList.remove('hidden'); $('tfd-btn-search').classList.add('hidden'); $('tfd-search-row').classList.add('hidden');
  ttsStop();
  const today = all.length && all[0].number === t.number;   // read aloud only for the latest thought
  const out = [tfdSeg(), `<div class="t-head"><span class="lbl">THOUGHT FOR THE DAY · TFD ${esc(t.number)}</span>` + (today && 'speechSynthesis' in window ? `<button class="t-listen" id="t-listen" aria-label="Read aloud"></button>` : '') + '</div>'];
  if (t.untranslated) out.push(`<p class="t-soon" lang="${tfdLang}">${esc(TFD_SOON[tfdLang])}</p>`);
  if (t.series) out.push(`<span class="mut">${esc(t.series)}</span>`);
  out.push(`<h2 class="t-title">${esc(t.title)}</h2><div class="t-by"><img src="icons/about-jk.jpg" alt=""><b>Shri Janakiraman</b></div><div class="t-rule"></div>`);
  let quote = false, open = null;
  const close = () => { if (open) { out.push('</div>'); open = null; } };
  t.paras.forEach((p, i) => {
    const k = tfdKind(t.paras, i);
    if (k !== 'numbered' && open === 'num') close();
    if (k === 'heading') { close(); quote = p.toLowerCase().includes('thought to carry'); out.push(`<h3 class="t-h">${esc(p)}</h3>`); }
    else if (k === 'numbered') {
      if (open !== 'num') { close(); out.push('<div class="t-num">'); open = 'num'; }
      const d = p.indexOf('.');
      out.push(`<div class="t-nr"><b>${esc(p.slice(0, d))}</b><span>${esc(p.slice(d + 1).trim())}</span></div>`);
    } else if (k === 'signoff') { close(); out.push(`<p class="t-sign">${esc(p)}</p>`); }
    else if (quote) { if (open !== 'quote') { close(); out.push('<div class="t-quote">'); open = 'quote'; } out.push(`<p>${esc(p)}</p>`); }
    else { close(); out.push(`<p class="t-p${i === 0 ? ' first' : ''}">${esc(p)}</p>`); }
  });
  close();
  if (ACCESS.url) out.push('<div class="t-react" id="t-react" aria-label="Reactions"></div>');   // SCRUM-50
  out.push('<div class="t-sep"></div>');
  // (4.10: no 'Sing with today’s thought' – the thought stands on its own)
  // (no Next Satsang here: this page is only for the Thought for the Day)
  // SCRUM-83: read on without going back to the list – Newer / Older side by side, the blue All thoughts button below
  const nb = (x, cls, lab) => x ? `<button class="t-nb${cls}" data-tfd="${esc(x.number)}">${lab}<span class="t-nb-t">TFD ${esc(x.number)} · ${esc(x.title)}</span></button>` : '<span class="t-nb ghost"></span>';
  out.push(`<div class="t-acts one"><button class="btn-acc" id="t-share">${svgI('share')}Share</button></div>`);
  out.push(`<div class="t-nav">${nb(newer, '', '<small>‹ <span>Newer</span></small>')}${nb(older, ' r', '<small><span>Older</span> ›</small>')}</div>`);
  out.push(`<button class="btn-blue t-all" id="t-all">All thoughts</button>`);
  $('tfd-box').innerHTML = `<div class="tfd-read" lang="${t.lang || 'en'}">${out.join('')}</div>`;
  wireTfdSeg(() => showTfd(number));
  if ($('t-listen')) {
    paintListen();
    $('t-listen').onclick = () => {
      if (tts.on) return ttsStop();
      const lang = t.untranslated ? 'en' : tfdLang;
      ttsSpeak([t.title].concat(t.paras.filter(p => !/^[\u0900-\u097F\s।॥0-9.,]+$/.test(p))), lang);   // Devanagari verses are skipped
    };
  }
  if (fresh) $('tfd-scroll').scrollTop = 0;
  if (ACCESS.url) loadReactions(+t.number);
  $('tfd-box').querySelectorAll('[data-tfd]').forEach(b => { b.onclick = () => { replaceHash('#tfd/' + b.dataset.tfd); showTfd(b.dataset.tfd); }; });   // Back still goes where you came from
  $('t-all').onclick = () => {
    tfdFocus = t.number;
    if (navStack[navStack.length - 2] === '#tfd') history.back();   // the list is underneath: go back to it, not a new copy
    else { replaceHash('#tfd'); showTfdList(); }
  };
  $('t-share').onclick = () => {
    const text = 'Harinamadwar · Thought for the Day (TFD ' + t.number + ')\n' + t.title + '\n\n' + t.paras.join('\n\n') + '\n\nRead more thoughts and sing the bhajans in the Harinamadwar app 🙏\n' + location.origin + location.pathname;
    if (navigator.share) navigator.share({ title: t.title, text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied. You can paste it in WhatsApp.'));
  };
}
$('tfd-smaller').onclick = () => setScale(prefs.scale / STEP);
$('tfd-bigger').onclick = () => setScale(prefs.scale * STEP);

// ---------- share a song (picture) ----------
let shareBlob = null;
async function showShare(number) {
  showView('v-share');
  const s = await dnsSong(number);
  const title = s ? s.displayTitle : 'Hari Nama', raga = s ? s.displayRaga : '';
  $('share-box').innerHTML = `<img class="sh-img" id="sh-img" alt="Today I sang ${esc(title)}"><p class="mut center">This picture goes out with the Harinamadwar name, so friends know where to find us.</p>` +
    `<button class="btn-acc wide" id="sh-go">${svgI('share')}Share picture</button>`;
  shareBlob = null;
  const c = await drawShare(title, raga);
  $('sh-img').src = c.toDataURL('image/png');
  c.toBlob(b => { shareBlob = b; }, 'image/png');
  $('sh-go').onclick = async () => {
    const text = 'Harinamadwar 🙏 Today I sang ' + title + '\nyoutube.com/@HariNamadwar';
    try {
      const file = shareBlob && new File([shareBlob], 'harinamadwar.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text });
      else { const a = document.createElement('a'); a.href = $('sh-img').src; a.download = 'harinamadwar.png'; a.click(); }
    } catch (e) { }
  };
}
function loadImg(src) { return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; }); }
async function drawShare(title, raga) {
  try { await Promise.all(['400 40px Mukta', '700 40px Mukta'].map(f => document.fonts.load(f, title))); } catch (e) { }
  const W = 1080, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1D4E9E'); g.addColorStop(.5, '#163E7E'); g.addColorStop(1, '#0E1E3E');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.fillStyle = '#F2D597'; x.font = '700 38px Mukta, sans-serif';
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  x.fillText('TODAY I SANG', W / 2, 110);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  // the doorway
  const dw = 660, dh = 720, dx = (W - dw) / 2, dy = 160, r = dw / 2;
  x.strokeStyle = '#D4A853'; x.lineWidth = 8;
  x.beginPath(); x.moveTo(dx, dy + dh); x.lineTo(dx, dy + r); x.arc(W / 2, dy + r, r, Math.PI, 0); x.lineTo(dx + dw, dy + dh); x.closePath(); x.stroke();
  // lotus
  x.save(); x.translate(W / 2 - 60, dy + 190); x.scale(5, 5); x.strokeStyle = '#D4A853'; x.lineWidth = 2; x.lineCap = x.lineJoin = 'round';
  x.stroke(new Path2D('M12,3c2,3 2,6 0,9 -2,-3 -2,-6 0,-9z M12,12c3,-2 6,-2 8,0 -2,3 -5,3 -8,0z M12,12c-3,-2 -6,-2 -8,0 2,3 5,3 8,0z M5,17h14')); x.restore();
  // title, wrapped
  x.fillStyle = '#FFFFFF'; x.font = '700 76px Mukta, sans-serif';
  const words = title.split(' '), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > dw - 90 && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  let y = dy + 430 - (lines.length - 1) * 44;
  for (const l of lines.slice(0, 4)) { x.fillText(l, W / 2, y); y += 88; }
  if (raga) { x.fillStyle = '#DCE8F8'; x.font = '400 44px Mukta, sans-serif'; x.fillText(raga, W / 2, y + 6); }
  // brand
  const logo = await loadImg('icons/logo.jpg');
  const bx = W / 2 - 330, by = 1010;
  x.fillStyle = '#D4A853'; x.beginPath(); x.arc(bx + 55, by + 55, 55, 0, 7); x.fill();
  if (logo) { x.save(); x.beginPath(); x.arc(bx + 55, by + 55, 49, 0, 7); x.clip(); x.drawImage(logo, bx + 6, by + 6, 98, 98); x.restore(); }
  x.textAlign = 'left'; x.fillStyle = '#FFFFFF'; x.font = '700 46px Mukta, sans-serif'; x.fillText('Harinamadwar', bx + 135, by + 48);
  x.fillStyle = '#DCE8F8'; x.font = '400 32px Mukta, sans-serif'; x.fillText('A doorway to the Lord’s Name · @HariNamadwar', bx + 135, by + 96);
  return c;
}

// ---------- opening: walk through the doorway ----------
function splash() {
  const s = $('splash');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  s.classList.remove('hidden');
  // hold the doorway for about 3 seconds before walking through (SCRUM-65); a tap skips ahead
  let t1 = setTimeout(() => s.classList.add('go'), 2700), t2 = setTimeout(() => s.classList.add('hidden'), 4000);
  s.onclick = () => { clearTimeout(t1); clearTimeout(t2); s.classList.add('go'); setTimeout(() => s.classList.add('hidden'), 1300); };
}

$('home-plaque').innerHTML = plaqueSVG('pqh', true);
$('index-plaque').innerHTML = plaqueSVG('pqi', false);
brandBars();
start();

applyLang();   // SCRUM-74: the whole app in the chosen language
