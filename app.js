/* Harinamadwar Guru — web app (for iPhone / iPad and any browser).
 * Reads the same content files as the Android app: songs.txt, songs_<lang>.txt,
 * meanings_<lang>.txt, audio.txt and the Audio/ folder, from the same place it is served. */
'use strict';

const WEB_VERSION = '2.0';
// The two books. Each book's files sit in its own folder (Divyanama at the top, Ashtapathy in ashtapathy/).
const BOOKS = {
  dns: { id: 'dns', base: '', hash: '#song/', title: 'Divya Nama Sankeertanam', search: 'Search: section no. or song title', unit: 'songs' },
  ashta: { id: 'ashta', base: 'ashtapathy/', hash: '#ashta/', title: 'Śrī Gīta Govindam', search: 'Search: aṣṭapadi no. or title', unit: 'aṣṭapadis' },
};
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
  get lang() { return store.get('lang', 'en'); }, set lang(v) { store.set('lang', v); },
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
    files[name] = fetch(name, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.text(); })
      .catch(e => { delete files[name]; throw e; });
  }
  return files[name];
}

let songs = [];      // {number,title,raga,page,lyrics,chapter,displayTitle,displayRaga,pos}
let indexItems = []; // {type:'chap', heading} | {type:'song', song}
const texts = {};    // lang -> Map(number -> {title,raga,body})
const audioMaps = {};

const part = (h, i) => (h.length > i ? h[i].trim() : '');

function parseSongs(txt) {
  const s = [], idx = [];
  let chapter = '', header = null, body = [];
  const flush = () => {
    if (!header) return;
    const page = parseInt(part(header, 3), 10) || 0;
    const song = {
      number: part(header, 0), title: part(header, 1), raga: part(header, 2), page,
      lyrics: body.join('\n').trim(), chapter,
      displayTitle: part(header, 4) || part(header, 1), displayRaga: part(header, 5) || part(header, 2),
      pos: s.length,
    };
    s.push(song); idx.push({ type: 'song', song });
  };
  for (const line of txt.replace(/\r/g, '').split('\n')) {
    const isChap = line.startsWith('## '), isSub = line.startsWith('### '), isSong = line.startsWith('@@');
    if (isChap || isSub || isSong) { flush(); header = null; body = []; }
    if (isSub) {
      const h = line.slice(4).split('|');
      idx.push({ type: 'chap', heading: h[0].trim() + '   ' + part(h, 1) });
    } else if (isChap) {
      const h = line.slice(3).split('|');
      const num = h[0].trim();
      chapter = part(h, 1);
      idx.push({ type: 'chap', heading: num === '0' ? chapter : num + '.  ' + chapter });
    } else if (isSong) {
      header = line.slice(2).split('|');
    } else if (header) {
      body.push(line);
    }
  }
  flush();
  songs = s; indexItems = idx;
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

function loadAudio() {
  // one shared promise per book, so a second caller never sees a half-filled list
  if (!audioMaps[book.id]) {
    audioMaps[book.id] = fetchText(bf('audio.txt')).then(txt => {
      const m = new Map();
      for (const line of txt.split('\n')) {
        const bar = line.indexOf('|');
        if (bar > 0) m.set(line.slice(0, bar).trim(), line.slice(bar + 1).trim());
      }
      return m;
    }).catch(() => new Map());
  }
  return audioMaps[book.id];
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
function showView(id) {
  for (const v of ['v-home', 'v-about', 'v-index', 'v-song', 'v-settings']) $(v).classList.toggle('hidden', v !== id);
}

// ---------- index ----------
let indexScroll = 0, pushedSong = false;
async function renderIndex(filter) {
  const lang = prefs.lang;
  const t = lang === 'en' ? null : await loadText(lyricsFile(lang));
  const q = norm(filter || '');
  const ul = $('song-list');
  const out = [];
  let pendingChap = null, shown = 0;
  for (const it of indexItems) {
    if (it.type === 'chap') { pendingChap = it; if (!q) out.push(`<li class="chap">${esc(it.heading)}</li>`); continue; }
    const s = it.song;
    const tr = t && t.get(s.number);
    const title = tr && tr.title ? tr.title : s.displayTitle;
    if (q) {
      const hay = norm([s.number, s.title, s.displayTitle, tr ? tr.title : '', s.chapter].join(' '));
      if (!(s.number.startsWith(q) || hay.includes(q))) continue;
      if (pendingChap) { out.push(`<li class="chap">${esc(pendingChap.heading)}</li>`); pendingChap = null; }
    }
    const sub = [tr && tr.title ? s.displayTitle : '', s.displayRaga].filter(Boolean).join('  ·  ');
    out.push(`<li class="row" data-pos="${s.pos}"><span class="badge">${esc(s.number)}</span>` +
      `<div class="row-text"><div class="row-title">${esc(title)}</div>${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}</div></li>`);
    shown++;
  }
  ul.innerHTML = out.join('');
  $('empty').classList.toggle('hidden', shown > 0);
}

function openSearch() {
  $('title-row').classList.add('hidden'); $('search-row').classList.remove('hidden');
  $('search-input').focus();
}
function closeSearch() {
  $('search-input').value = '';
  $('search-row').classList.add('hidden'); $('title-row').classList.remove('hidden');
  renderIndex('');
}

// ---------- song ----------
let cur = 0, tab = 0;

function splitSummary(text) {
  for (const m of ['\nMeaning Summary\n', '\nSummary\n']) {
    const i = text.indexOf(m);
    if (i >= 0) return [text.slice(0, i).trim(), text.slice(i + m.length).trim()];
  }
  return [text, ''];
}

const HEADS = /^(Word meanings?|Word by word meaning|Detailed meaning|Simple \(and complete\) meaning|Summary meaning|Spiritual meaning|Spiritual significance|Overall essence|Key spiritual highlight|A beautiful closing.*|A closing line.*|Takeaways for the upanyasam|Meaning, verse by verse|The shloka|The abhang|Pallavi|Anupallavi|Charanam ?\d*|ಪದಾರ್ಥ|ಪದಶಃ ಅರ್ಥ|ವಿಸ್ತೃತ ಅರ್ಥ|ಸರಳ ಮತ್ತು ಸಂಪೂರ್ಣ ಅರ್ಥ|ಒಟ್ಟು ಅರ್ಥ|ಆಧ್ಯಾತ್ಮಿಕ (ಅರ್ಥ|ಮಹತ್ವ)|ಸಂಪೂರ್ಣ .*ಸಾರ|ಮುಖ್ಯ ಆಧ್ಯಾತ್ಮಿಕ ವಿಶೇಷತೆ|ಉಪನ್ಯಾಸ.*|ಮುಕ್ತಾಯದ ಸಾಲು|ಪದ್ಯವಾರು ಅರ್ಥ|ಪಲ್ಲವಿ|ಅನುಪಲ್ಲವಿ|.*ಚರಣ|ಶ್ಲೋಕ|ಅಭಂಗ|சொல் வாரியாக.*|மொத்த அர்த்தம்.*|ஆன்மீக முக்கியத்துவம்.*|உபந்யாச.*|முடிவு வரி|பதவுரை|சாராம்சம்|முக்கியத்துவம்|பொருள்|பல்லவி|அனுபல்லவி|சரணம்.*)$/;

// Ashtapathy meanings: section headings, the first line of each verse, and the labels inside a verse
const A_HEADS = /^(Summary|Upanyasam take-away|Detailed meaning.*|ஸங்க்ஷேபமான அர்த்தம்|உபந்யாஸ ஸாரம்.*|விஸ்தாரமான அர்த்தம்.*|ಸಾರಾಂಶ|ಉಪನ್ಯಾಸ ಸಾರ.*|ವಿಸ್ತೃತ ಅರ್ಥ.*)$/;
const A_LABEL = /^(Meaning:|Key message:|அர்த்தம்:|கருத்து:|ಅರ್ಥ:|ಮುಖ್ಯ ಸಂದೇಶ:)/;
function meaningHtml(text) {
  return text.split('\n').map(l => {
    const t = l.trim();
    if (book.id === 'ashta') {
      if (A_HEADS.test(t)) return `<b class="mh">${esc(t)}</b>`;
      if (/^\d+\. /.test(t)) return `<span class="vl">${esc(t)}</span>`;
      const m = t.match(A_LABEL);
      if (m) return `<span class="lb">${esc(m[1])}</span>${esc(t.slice(m[1].length))}`;
      return esc(l);
    }
    return t && t.length < 70 && HEADS.test(t) ? `<b>${esc(l)}</b>` : esc(l);
  }).join('\n');
}

async function showSong(pos, keepTab) {
  cur = Math.max(0, Math.min(songs.length - 1, pos));
  const s = songs[cur];
  const lang = prefs.lang;
  const t = lang === 'en' ? null : (await loadText(lyricsFile(lang))).get(s.number);
  const title = t ? t.title : s.displayTitle;
  const raga = t ? t.raga : s.displayRaga;
  const parts = splitSummary(t ? t.body : s.lyrics);
  let lyrics = esc(parts[0]);
  const summary = parts[1] || splitSummary(s.lyrics)[1];
  if (!t && lang !== 'en') {
    const name = LANGS.find(l => l.code === lang).name;
    lyrics = `<span class="note">(${name} text is not given in the book for this song – showing English.)</span>\n\n` + lyrics;
  }
  $('song-title').textContent = title;
  let meta = s.number;
  if (raga) meta += '  ·  ' + raga;
  if (s.page > 0) meta += '  ·  Page ' + s.page;
  if (t) meta += '\n' + s.displayTitle;
  $('song-meta').textContent = meta;
  $('position').textContent = (cur + 1) + ' / ' + songs.length;
  $('lyrics').innerHTML = lyrics;
  $('audio-lyrics').innerHTML = lyrics;
  $('btn-lang').textContent = LANGS.find(l => l.code === lang).label + ' ▾';
  $('btn-prev').disabled = cur === 0;
  $('btn-next').disabled = cur === songs.length - 1;

  // meaning: reader's language, falling back to the Tamil original
  let m = (await loadText(meaningFile(lang))).get(s.number);
  if (!m && meaningFile(lang) !== 'meanings_ta.txt') m = (await loadText('meanings_ta.txt')).get(s.number);
  let mh = m && m.body ? meaningHtml(m.body) : '';
  if (summary) mh += (mh ? '\n\n— — —\n\n' : '') + esc(summary);
  $('meaning').innerHTML = mh || 'The meaning of this song will be added soon.';

  // audio
  stopAudio();
  const url = audioUrl((await loadAudio()).get(s.number));
  const a = $('audio');
  a.dataset.src = url || '';
  a.removeAttribute('src');
  $('audio-title').textContent = title;
  $('tab-audio').textContent = url ? 'Audio  ♪' : 'Audio';
  $('btn-play').disabled = !url;
  $('seek').disabled = true; $('seek').value = 0;
  $('pos').textContent = '0:00'; $('len').textContent = '0:00';
  $('audio-status').textContent = url ? 'Tap ▶ to listen' : 'A recording of this song will be added soon.';

  selectTab(keepTab ? tab : 0);
  $('song-scroll').scrollTop = 0;
  const h = book.hash + s.number;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function selectTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('sel', +b.dataset.tab === t));
  $('p-lyrics').classList.toggle('hidden', t !== 0);
  $('p-meaning').classList.toggle('hidden', t !== 1);
  $('p-audio').classList.toggle('hidden', t !== 2);
  $('song-scroll').scrollTop = 0;
}

function openSong(pos) {
  indexScroll = $('index-scroll').scrollTop;
  history.pushState(null, '', book.hash + songs[pos].number);
  pushedSong = true;
  showView('v-song');
  showSong(pos);
  keepAwake(true);
}
function closeSong() {
  stopAudio();
  keepAwake(false);
  pushedSong = false;
  if (location.hash.startsWith(book.hash)) history.replaceState(null, '', location.pathname + location.search);
  showView('v-index');
  // highlight where we were: scroll the current song into view
  const row = document.querySelector(`.row[data-pos="${cur}"]`);
  if (row) row.scrollIntoView({ block: 'center' }); else $('index-scroll').scrollTop = indexScroll;
}

function setScale(v) {
  prefs.scale = v;
  applyLook();
}

// swipe left / right between songs
(function swipe() {
  let x0 = 0, y0 = 0, t0 = 0, multi = false;
  const el = $('song-scroll');
  el.addEventListener('touchstart', e => { multi = e.touches.length > 1; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', e => {
    if (multi) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Date.now() - t0 < 600 && Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(dy)) {
      if (dx < 0 && cur < songs.length - 1) showSong(cur + 1, true);
      else if (dx > 0 && cur > 0) showSong(cur - 1, true);
    }
  }, { passive: true });
})();

// ---------- audio ----------
const fmt = s => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function setPlayIcon(playing) {
  document.querySelector('.i-play').classList.toggle('hidden', playing);
  document.querySelector('.i-pause').classList.toggle('hidden', !playing);
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
  a.addEventListener('play', () => setPlayIcon(true));
  a.addEventListener('pause', () => setPlayIcon(false));
  a.addEventListener('playing', () => { $('audio-status').textContent = ''; });
  a.addEventListener('loadedmetadata', () => { $('len').textContent = fmt(a.duration); seek.disabled = false; });
  a.addEventListener('timeupdate', () => {
    if (seeking || !a.duration) return;
    seek.value = Math.round(1000 * a.currentTime / a.duration);
    $('pos').textContent = fmt(a.currentTime);
  });
  a.addEventListener('ended', () => { setPlayIcon(false); seek.value = 0; });
  a.addEventListener('error', () => { if (a.getAttribute('src')) { setPlayIcon(false); $('audio-status').textContent = 'Could not play. Please check the internet connection and try again.'; } });
  seek.addEventListener('input', () => { seeking = true; if (a.duration) $('pos').textContent = fmt(a.duration * seek.value / 1000); });
  seek.addEventListener('change', () => { if (a.duration) a.currentTime = a.duration * seek.value / 1000; seeking = false; });
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

// ---------- language chooser ----------
function langButtons(container, onPick) {
  container.innerHTML = LANGS.map(l =>
    `<button class="lang-opt${l.code === prefs.lang ? ' sel' : ''}" data-lang="${l.code}">${l.label}</button>`).join('');
  container.onclick = e => {
    const b = e.target.closest('[data-lang]');
    if (b) onPick(b.dataset.lang);
  };
}
function chooseLanguage() {
  langButtons($('sheet-langs'), code => {
    prefs.lang = code;
    $('sheet').classList.add('hidden');
    showSong(cur, true);
    renderIndex($('search-input').value);
  });
  $('sheet').classList.remove('hidden');
}
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').classList.add('hidden'); });

// ---------- settings ----------
let settingsFrom = 'v-index';
function openSettings() {
  settingsFrom = ['v-home', 'v-index', 'v-song'].find(v => !$(v).classList.contains('hidden')) || 'v-home';
  const grid = $('lang-grid');
  const pick = code => { prefs.lang = code; langButtons(grid, pick); };
  langButtons(grid, pick);
  $('size-range').value = Math.round(prefs.scale * 100);
  $('sw-screen').checked = prefs.screenOn;
  $('sw-night').checked = prefs.night;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('install-h').classList.toggle('hidden', standalone);
  $('install-text').classList.toggle('hidden', standalone);
  const ver = f => fetchText(f).then(t => (t.match(/version=(\d+)/) || [])[1] || '?').catch(() => '?');
  Promise.all([ver('manifest.txt'), ver('ashtapathy/manifest.txt')]).then(([a, b]) => {
    $('version-info').textContent = 'Web app ' + WEB_VERSION + '  ·  Divyanama content ' + a + '  ·  Ashtapathy content ' + b;
  });
  showView('v-settings');
}
function closeSettings() {
  prefs.setupDone = true;
  showView(settingsFrom);
  if (settingsFrom !== 'v-home') renderIndex($('search-input').value);
  if (settingsFrom === 'v-song') showSong(cur, true);
}
$('size-range').addEventListener('input', e => setScale(e.target.value / 100));
$('sw-screen').addEventListener('change', e => { prefs.screenOn = e.target.checked; });
$('sw-night').addEventListener('change', e => { prefs.night = e.target.checked; applyLook(); });

// ---------- wiring ----------
$('btn-search').onclick = openSearch;
$('btn-close-search').onclick = closeSearch;
$('search-input').addEventListener('input', e => renderIndex(e.target.value));
$('btn-settings').onclick = openSettings;
$('btn-home-settings').onclick = openSettings;
$('btn-books').onclick = goHome;
document.querySelectorAll('.book-card').forEach(b => { b.onclick = () => openBook(b.dataset.book); });
$('btn-settings-back').onclick = closeSettings;
$('btn-done').onclick = closeSettings;
$('song-list').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (r) openSong(+r.dataset.pos);
});
$('btn-back').onclick = () => { if (pushedSong) history.back(); else closeSong(); };
$('btn-prev').onclick = () => showSong(cur - 1, true);
$('btn-next').onclick = () => showSong(cur + 1, true);
$('btn-smaller').onclick = () => setScale(prefs.scale / STEP);
$('btn-bigger').onclick = () => setScale(prefs.scale * STEP);
$('btn-lang').onclick = chooseLanguage;
$('btn-play').onclick = togglePlay;
document.querySelectorAll('.tab').forEach(b => { b.onclick = () => selectTab(+b.dataset.tab); });

// which book and song a link like …/#song/2.6.4 or …/#ashta/1.2 points to
function fromHash() {
  for (const b of Object.values(BOOKS)) if (location.hash.startsWith(b.hash)) return [b, decodeURIComponent(location.hash.slice(b.hash.length))];
  return [null, null];
}

window.addEventListener('popstate', () => {
  const [b, n] = fromHash();
  if (b && b === book) {
    const s = songs.find(x => x.number === n);
    if (s) { showView('v-song'); showSong(s.pos); return; }
  }
  if (!$('v-about').classList.contains('hidden')) { showView('v-home'); return; }
  if (location.hash === '#about') { openAbout(true); return; }
  if (!$('v-song').classList.contains('hidden')) closeSong();
  else if (!$('v-settings').classList.contains('hidden')) closeSettings();
});

// ---------- books ----------
function goHome() {
  if ($('search-row').classList.contains('hidden') === false) closeSearch();
  showView('v-home');
}

async function openBook(id, songNumber) {
  book = BOOKS[id];
  store.set('book', id);
  $('book-title').textContent = book.title;
  $('search-input').placeholder = book.search;
  $('empty').textContent = 'No ' + book.unit + ' found';
  $('search-input').value = '';
  $('search-row').classList.add('hidden'); $('title-row').classList.remove('hidden');
  showView('v-index');
  if (!loaded[id]) {
    $('song-list').innerHTML = '';
    $('loading').classList.remove('hidden');
    try {
      parseSongs(await fetchText(bf('songs.txt')));
      loaded[id] = { songs, indexItems };
    } catch (e) {
      $('loading').textContent = 'Could not load. Please connect to the internet once and open the app again.';
      return;
    }
  }
  ({ songs, indexItems } = loaded[id]);
  $('loading').classList.add('hidden');
  await renderIndex('');
  $('index-scroll').scrollTop = 0;
  if (songNumber) {
    const s = songs.find(x => x.number === songNumber);
    if (s) { history.replaceState(null, '', location.pathname + location.search); openSong(s.pos); }
  }
  // warm up the files this reader needs, so they work offline later
  const lang = prefs.lang;
  if (lang !== 'en') loadText(lyricsFile(lang));
  loadText(meaningFile(lang));
  loadAudio();
}

// ---------- about ----------
function openAbout(fromLink) {
  if (!fromLink) history.pushState(null, '', '#about');
  showView('v-about'); $('about-scroll').scrollTop = 0;
}
$('btn-about').onclick = () => openAbout();
$('btn-about-back').onclick = () => { if (location.hash === '#about') history.back(); else showView('v-home'); };

// ---------- start ----------
async function start() {
  applyLook();
  const [b, n] = fromHash();
  if (b) await openBook(b.id, n);
  else if (location.hash === '#about') openAbout(true);
  else showView('v-home');
  if (!prefs.setupDone) openSettings();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data === 'content-updated') toast('Songs and meanings updated');
  });
}
start();
