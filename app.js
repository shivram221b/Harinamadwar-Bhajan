/* Harinamadwar Guru — web app (for iPhone / iPad and any browser).
 * Reads the same content files as the Android app: songs.txt, songs_<lang>.txt,
 * meanings_<lang>.txt, audio.txt and the Audio/ folder, from the same place it is served. */
'use strict';

const WEB_VERSION = '3.1';
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
  const am = await loadAudio();
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
      `<div class="row-text"><div class="row-title">${esc(title)}</div>${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}</div>` +
      (am.has(s.number) ? '<span class="has-audio" aria-label="Audio available">♪</span>' : '') + '</li>');
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
const PAGES = ['s-lyrics', 's-meaning', 's-audio'];

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
  const list = (pick.length >= 2 ? pick : heads).slice(0, 5);
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
};
$('s-meaning').addEventListener('scroll', () => {
  const chips = [...$('mean-chips').querySelectorAll('.chip')];
  if (!chips.length) return;
  const top = $('s-meaning').getBoundingClientRect().top + 40;
  let on = chips[0];
  for (const c of chips) { const el = $(c.dataset.to); if (el && el.getBoundingClientRect().top <= top) on = c; }
  chips.forEach(c => c.classList.toggle('sel', c === on));
}, { passive: true });

async function showSong(pos, keepTab, keepScroll) {
  const changed = pos !== cur || !keepTab;
  cur = Math.max(0, Math.min(songs.length - 1, pos));
  const s = songs[cur];
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
  $('crumb').textContent = s.number + '  ·  ' + (cur + 1) + ' of ' + songs.length;
  $('lyrics').innerHTML = lyrics;
  $('audio-lyrics').innerHTML = lyrics;
  renderLangChips();
  const prev = songs[cur - 1], next = songs[cur + 1];
  $('btn-prev').textContent = prev ? '‹ ' + prev.number + ' ' + short(prev.displayTitle, 14) : '';
  $('btn-next').textContent = next ? next.number + ' ' + short(next.displayTitle, 14) + ' ›' : '';
  $('btn-prev').classList.toggle('hidden', !prev);
  $('btn-next').classList.toggle('hidden', !next);

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
    $('audio-status').textContent = url ? 'Tap ▶ to listen' : 'A recording of this song will be added soon.';
  }
  $('tab-audio').textContent = url ? 'Audio ♪' : 'Audio';
  $('btn-play').disabled = !url;
  ['btn-back10', 'btn-fwd10', 'btn-repeat', 'btn-speed'].forEach(id => { $(id).disabled = !url; });

  selectTab(keepTab ? tab : 0);
  if (keepScroll) {
    PAGES.forEach((id, i) => { const el = $(id); el.scrollTop = keepScroll[i] * (el.scrollHeight - el.clientHeight); });
  } else if (changed) PAGES.forEach(id => { $(id).scrollTop = 0; });
  const h = book.hash + s.number;
  if (location.hash !== h) history.replaceState(null, '', h);
  store.set('last', { book: book.id, number: s.number, title: s.displayTitle });
}

function selectTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('sel', +b.dataset.tab === t));
  PAGES.forEach((id, i) => $(id).classList.toggle('hidden', i !== t));   // each page keeps its own place
  const meaningChips = t === 1 && +($('mean-chips').dataset.n || 0) > 0;
  $('mean-chips').classList.toggle('hidden', !meaningChips);
  $('lang-chips').classList.toggle('hidden', t === 1);
  $('song-meta').textContent = t === 1 ? 'Meaning in ' + (LANGS.find(l => l.code === (prefs.lang === 'sa' ? 'en' : prefs.lang)).name)
    : ($('song-meta').dataset.raga || '');
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
  const row = document.querySelector(`.row[data-pos="${cur}"]`);
  if (row) row.scrollIntoView({ block: 'center' }); else $('index-scroll').scrollTop = indexScroll;
}

function setScale(v) {
  prefs.scale = v;
  applyLook();
}

// pinch with two fingers changes the text size (instead of zooming the whole page)
(function pinch() {
  let d0 = 0, s0 = 1;
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const el = $('v-song');
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e); s0 = prefs.scale; } }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    setScale(s0 * dist(e) / d0);
  }, { passive: false });
  el.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  // iPhone Safari's own page zoom
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
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
    $('btn-speed').textContent = 'Speed ' + SPEEDS[sp] + '×';
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
function renderContinue() {
  const l = store.get('last', null);
  $('btn-continue').classList.toggle('hidden', !l);
  if (l) $('continue-text').innerHTML = 'Continue: <b>' + esc(l.title) + '</b> · ' + esc(BOOKS[l.book] ? (l.book === 'ashta' ? 'Aṣṭapadi ' + l.number : l.number) : l.number);
}
$('btn-continue').onclick = () => { const l = store.get('last', null); if (l && BOOKS[l.book]) openBook(l.book, l.number); };

function goHome() {
  renderContinue();
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
  else { renderContinue(); showView('v-home'); }
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
