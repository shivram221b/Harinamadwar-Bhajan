/* Harinamadwar — web app (for iPhone / iPad and any browser).
 * Reads the same content files as the Android app: songs.txt, songs_<lang>.txt,
 * meanings_<lang>.txt, audio.txt and the Audio/ folder, from the same place it is served. */
'use strict';

const WEB_VERSION = '4.1';
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

function loadAudio(b) {
  b = b || book;
  // one shared promise per book, so a second caller never sees a half-filled list
  if (!audioMaps[b.id]) {
    audioMaps[b.id] = fetchText(b.base + 'audio.txt').then(txt => {
      const m = new Map();
      for (const line of txt.split('\n')) {
        const bar = line.indexOf('|');
        if (bar > 0) m.set(line.slice(0, bar).trim(), line.slice(bar + 1).trim());
      }
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
const VIEWS = ['v-home', 'v-about', 'v-index', 'v-song', 'v-settings', 'v-welcome', 'v-diary', 'v-learn', 'v-favs', 'v-tfd', 'v-share'];
let homeScroll = 0;
function showView(id) {
  if (!$('v-home').classList.contains('hidden') && id !== 'v-home') homeScroll = $('home-scroll').scrollTop;  // SCRUM-51
  if (!$('v-index').classList.contains('hidden') && id !== 'v-index') indexScroll = $('index-scroll').scrollTop;
  if (!$('v-song').classList.contains('hidden') && id !== 'v-song') { stopAudio(); keepAwake(false); }
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
}

// ---------- index ----------
let indexScroll = 0;
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
  $('lang-chips').classList.toggle('hidden', t === 1);
  $('song-meta').textContent = t === 1 ? 'Meaning in ' + (LANGS.find(l => l.code === (prefs.lang === 'sa' ? 'en' : prefs.lang)).name)
    : ($('song-meta').dataset.raga || '');
}

function openSong(pos) { go(book.hash + songs[pos].number); }
function closeSong() { back('#book/' + book.id); }

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
function openSettings() {
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
  back('');
}
$('size-range').addEventListener('input', e => setScale(e.target.value / 100));
$('sw-screen').addEventListener('change', e => { prefs.screenOn = e.target.checked; });
$('sw-night').addEventListener('change', e => { prefs.night = e.target.checked; applyLook(); });

// ---------- wiring ----------
$('btn-search').onclick = openSearch;
$('btn-close-search').onclick = closeSearch;
$('search-input').addEventListener('input', e => renderIndex(e.target.value));
$('btn-home-settings').onclick = () => go('#settings');
$('btn-books').onclick = () => back('');   // home button (SCRUM-53)
$('btn-settings-back').onclick = closeSettings;
$('btn-done').onclick = closeSettings;
$('song-list').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (r) openSong(+r.dataset.pos);
});
$('btn-back').onclick = closeSong;
$('btn-prev').onclick = () => showSong(cur - 1, true);
$('btn-next').onclick = () => showSong(cur + 1, true);
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

async function showIndex(id, fromSong) {
  const fresh = indexBook !== id;
  $('book-title').textContent = BOOKS[id].title;
  $('search-input').placeholder = BOOKS[id].search;
  $('empty').textContent = 'No ' + BOOKS[id].unit + ' found';
  if (fresh) {
    $('search-input').value = '';
    $('search-row').classList.add('hidden'); $('title-row').classList.remove('hidden');
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
  if (fresh) { indexBook = id; await renderIndex(''); $('index-scroll').scrollTop = 0; }
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
  if (!h || h === '#' || h === '#home') return showHome();
  if (h === '#about') return openAbout();
  if (h === '#settings') return openSettings();
  if (h === '#welcome') return showWelcome();
  if (h === '#diary') return showDiary();
  if (h === '#learn') return showLearn();
  if (h === '#favs') return showFavs();
  if (h === '#tfd') return showTfdList();
  if (h.startsWith('#tfd/')) return showTfd(h.slice(5));
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

// feedback & suggestions: goes only to Janakiraman Ji, by WhatsApp or email (nothing is stored anywhere)
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
async function start() {
  applyLook();
  document.querySelectorAll('[data-back]').forEach(b => { b.onclick = () => back(); });
  if (!location.hash) splash();
  route();
  if (!store.get('interestsDone', false)) go('#welcome');
  else if (!prefs.setupDone) go('#settings');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data === 'content-updated') toast('Songs and meanings updated');
  });
}
const ICONS = {"book": "<path d=\"M4,19.5A2.5,2.5 0,0 1,6.5 17H20V3H6.5A2.5,2.5 0,0 0,4 5.5v14zM8,7h8M8,11h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "lotus": "<path d=\"M12,3c2,3 2,6 0,9 -2,-3 -2,-6 0,-9z M12,12c3,-2 6,-2 8,0 -2,3 -5,3 -8,0z M12,12c-3,-2 -6,-2 -8,0 2,3 5,3 8,0z M5,17h14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "music": "<path d=\"M9,18V5l12,-2v13 M3,18a3,3 0,1 0,6 0a3,3 0,1 0,-6 0 M15,16a3,3 0,1 0,6 0a3,3 0,1 0,-6 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "phone": "<path d=\"M22,16.9v3a2,2 0,0 1,-2.2 2 19.8,19.8 0,0 1,-8.6 -3.1 19.5,19.5 0,0 1,-6 -6A19.8,19.8 0,0 1,2.1 4.2 2,2 0,0 1,4.1 2h3a2,2 0,0 1,2 1.7c0.1,0.9 0.4,1.8 0.7,2.7a2,2 0,0 1,-0.5 2.1L8,9.8a16,16 0,0 0,6 6l1.3,-1.3a2,2 0,0 1,2.1 -0.4c0.9,0.3 1.8,0.6 2.7,0.7a2,2 0,0 1,1.7 2z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "mail": "<path d=\"M5,4h14a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H5a3,3 0,0 1,-3 -3V7a3,3 0,0 1,3 -3z M3,6l9,7 9,-7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "chat": "<path d=\"M21,15a2,2 0,0 1,-2 2H7l-4,4V5a2,2 0,0 1,2 -2h14a2,2 0,0 1,2 2z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "chevron": "<path d=\"M9,6l6,6 -6,6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "calendar": "<path d=\"M6,5h12a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H6a3,3 0,0 1,-3 -3V8a3,3 0,0 1,3 -3z M3,10h18 M8,3v4 M16,3v4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "check": "<path d=\"M5,12.5l4.5,4.5L19,7.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "class": "<path d=\"M2,9l10,-5 10,5 -10,5z M6,11v5c3,3 9,3 12,0v-5 M22,9v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "event": "<path d=\"M6,5h12a3,3 0,0 1,3 3v10a3,3 0,0 1,-3 3H6a3,3 0,0 1,-3 -3V8a3,3 0,0 1,3 -3z M3,10h18 M8,3v4 M16,3v4 M12,12.5l1.2,2.4 2.6,0.4 -1.9,1.8 0.5,2.6 -2.4,-1.3 -2.4,1.3 0.5,-2.6 -1.9,-1.8 2.6,-0.4z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "feather": "<path d=\"M20,4c-6,0 -12,4 -14,12l-2,4 M20,4c0,6 -4,12 -12,14 M20,4L8,16 M14,7l1,4 M11,10l1,3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "heart": "<path d=\"M20.8,4.6a5.5,5.5 0,0 0,-7.8 0L12,5.7l-1,-1.1a5.5,5.5 0,0 0,-7.8 7.8l1,1.1L12,21l7.8,-7.6 1,-1.1a5.5,5.5 0,0 0,0 -7.8z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "heart_on": "<path d=\"M20.8,4.6a5.5,5.5 0,0 0,-7.8 0L12,5.7l-1,-1.1a5.5,5.5 0,0 0,-7.8 7.8l1,1.1L12,21l7.8,-7.6 1,-1.1a5.5,5.5 0,0 0,0 -7.8z\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "history": "<path d=\"M3,12a9,9 0,1 0,3 -6.7 M3,4v5h5 M12,8v4l3,2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "home": "<path d=\"M3,10.5L12,3l9,7.5 M5,9v11a1,1 0,0 0,1 1h4v-6h4v6h4a1,1 0,0 0,1 -1V9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "photo": "<path d=\"M5,4h14a2,2 0,0 1,2 2v12a2,2 0,0 1,-2 2H5a2,2 0,0 1,-2 -2V6a2,2 0,0 1,2 -2z M8.5,10a1.5,1.5 0,1 0,0 -3a1.5,1.5 0,1 0,0 3z M21,15l-5,-5L5,20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "pin": "<path d=\"M12,22s7,-6.5 7,-12a7,7 0,0 0,-14 0c0,5.5 7,12 7,12z M12,12.5a2.5,2.5 0,1 0,0 -5a2.5,2.5 0,1 0,0 5z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "play": "<path d=\"M8,5l11,7 -11,7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "share": "<path d=\"M18,8a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M6,15a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M18,22a3,3 0,1 0,0 -6a3,3 0,1 0,0 6z M8.6,13.5l6.8,4 M15.4,6.5l-6.8,4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "user": "<path d=\"M20,21v-2a4,4 0,0 0,-4 -4H8a4,4 0,0 0,-4 4v2 M12,11a4,4 0,1 0,0 -8a4,4 0,1 0,0 8z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "video": "<path d=\"M4,6h11a2,2 0,0 1,2 2v8a2,2 0,0 1,-2 2H4a2,2 0,0 1,-2 -2V8a2,2 0,0 1,2 -2z M17,10.5l5,-3v9l-5,-3z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "settings": "<path d=\"M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z\" fill=\"currentColor\"/>", "back": "<path d=\"M15.4,5.4L14,4l-8,8 8,8 1.4,-1.4L8.8,12z\" fill=\"currentColor\"/>", "close": "<path d=\"M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z\" fill=\"currentColor\"/>"};
// =====================================================================
// v4.0 – same home and screens as the Android app v13.1
// =====================================================================
const svgI = (name, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
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
    out.push({ when: f[1], month: f[2], days: f[3], name: f[4], place: f[5] });
  }
  return out;
}
async function learnValue(key) {
  for (const l of await communityLines('learn.txt')) if (l.startsWith(key + '=')) return l.slice(key.length + 1).trim();
  return '';
}
async function practice() { const v = await learnValue('songs'); return v ? v.split(',').map(x => x.trim()).filter(Boolean) : []; }

// Thought for the Day: @@ number | series | title | book:song, then paragraphs separated by blank lines
async function tfds() {
  let t = '';
  try { t = await fetchText('community/tfd.txt'); } catch (e) { }
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

function eventRows(list, big) {
  return list.map(e => `<div class="ev-row${big ? ' big' : ''}"><div class="ev-date"><span>${esc(e.month)}</span><b class="${e.days.length > 2 ? 'long' : ''}">${esc(e.days)}</b></div>` +
    `<div class="ev-t"><span class="ev-when">${big ? 'Coming up on ' : ''}${esc(e.when)}</span><b>${esc(e.name)}</b><span class="ev-where">${svgI('pin')}at ${esc(e.place)}</span></div></div>`).join('');
}

// ---------- home ----------
let homeBusy = 0;
async function showHome() {
  showView('v-home');
  const my = ++homeBusy;
  const who = store.get('name', '').trim();
  $('home-hello').innerHTML = who ? `<span>Hari Om,</span><b>${esc(who)}</b>` : `<b>Hari Om</b><span>A doorway to the Lord’s Name</span>`;
  const [ev, sod, tf, prac, meet] = await Promise.all([events(), interest('listen') ? songOfTheDay() : null, tfds(), practice(), learnValue('meet')]);
  if (my !== homeBusy) return;
  const out = [];
  // home order: books · continue · upcoming satsangs/learn/favourites · thought for the day · song of the day · about (Coming Up removed; it lives in Upcoming Satsangs)
  out.push(`<span class="lbl sect">CHOOSE A BOOK</span><div class="books">` +
    `<button class="arch-card" data-go="#book/dns">${badge('book', 'big')}<b>Divya Nama Sankeertanam</b><span>Bhajans · lyrics,<br>meanings, audio</span></button>` +
    `<button class="arch-card" data-go="#book/ashta">${badge('feather', 'big')}<b>Śrī Gīta Govindam</b><span>24 Aṣṭapadis of<br>Śrī Jayadeva</span></button></div>`);
  const l = store.get('last', null);   // after the books, above the tiles
  if (l && BOOKS[l.book]) {
    out.push(`<button class="h-cont" data-go="${BOOKS[l.book].hash}${esc(l.number)}">${badge('history', 'plain')}<span class="hc-t"><span class="mut">Continue where you left off</span>` +
      `<b>${esc((l.book === 'ashta' ? 'Aṣṭapadi ' : '') + l.number)}&nbsp; ${esc(l.title)}</b></span>${svgI('chevron', 'chev2')}</button>`);
  }
  const tiles = [`<button class="tile" data-go="#diary">${badge('calendar')}<b>Upcoming<br>Satsangs</b></button>`];
  if (interest('learn') && (prac.length || meet)) tiles.push(`<button class="tile" data-go="#learn">${badge('class')}<b>Learn<br>&nbsp;</b></button>`);
  tiles.push(`<button class="tile" data-go="#favs">${badge('heart')}<b>My<br>favourites</b></button>`);
  out.push(`<div class="tiles">${tiles.join('')}</div>`);
  if (tf.length) {
    const t = tf[0];
    out.push(`<button class="h-tfd" data-go="#tfd/${esc(t.number)}"><span class="h-tfd-top">${svgI('lotus')}<span class="lbl">THOUGHT FOR THE DAY · TFD ${esc(t.number)}</span></span>` +
      `<b>${esc(t.title)}</b><span class="teaser">${esc(t.paras[0] || '')}</span><span class="more">Read ›</span></button>`);
  }
  if (sod) {
    out.push(`<div class="card h-sod"><div class="sod-tile">${svgI('music')}</div><div class="sod-t"><span class="lbl">SONG OF THE DAY</span>` +
      `<b>${esc(sod.displayTitle)}</b><span class="mut">${esc(sod.displayRaga || sod.chapter)}</span>` +
      `<div class="sod-btns"><button class="btn-acc" data-go="#song/${esc(sod.number)}">▶&nbsp; Listen</button><button class="btn-line" data-go="#share/${esc(sod.number)}">${svgI('share')}Share</button></div></div></div>`);
  }
  out.push(`<button class="h-about" data-go="#about">${badge('lotus', 'white')}<span class="hc-t"><b>About Harinamadwar</b><span class="mut">Our satsangs, our guide, and how to invite us</span></span>${svgI('chevron', 'chev2')}</button>`);
  out.push(`<button class="h-change" data-go="#welcome">Change what I see on this page ›</button>`);
  $('home-box').innerHTML = out.join('');
  $('home-scroll').scrollTop = homeScroll;   // come back to the same place, not the top (SCRUM-51)
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
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
}

// ---------- learn ----------
async function showLearn() {
  showView('v-learn');
  const [meet, prac] = await Promise.all([learnValue('meet'), practice()]);
  const list = (await Promise.all(prac.map(dnsSong))).filter(Boolean);
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
  out.push(`<span class="lbl sect">THIS WEEK’S SONGS FROM JANAKIRAMAN JI</span><div class="card list">` + list.map(s => {
    const on = learnt(s.number);
    return `<div class="l-row"><button class="tickbox${on ? ' on' : ''}" data-n="${esc(s.number)}" aria-label="${on ? 'I can sing this' : 'Mark as a song I can sing'}">${on ? svgI('check') : ''}</button>` +
      `<span class="hc-t"><b>${esc(s.displayTitle)}</b><span class="mut">${esc(s.number + ' · ' + (s.displayRaga || s.chapter))}</span></span>` +
      `<button class="ibadge" data-go="#song/${esc(s.number)}" aria-label="Open ${esc(s.displayTitle)}">${svgI('play')}</button></div>`;
  }).join('') + `</div>`);
  out.push(`<div class="l-msg"><img src="icons/about-jk.jpg" alt=""><span class="hc-t"><span class="l-msg-l">Message from Janakiraman Ji</span><b>About this week’s songs</b><span class="soon">Audio message · coming soon</span></span></div>`);
  $('learn-box').innerHTML = out.join('');
  $('l-toggle').onclick = () => { store.set('showProgress', !showP); keepScroll('learn', showLearn); };
  $('learn-box').querySelectorAll('.tickbox').forEach(b => { b.onclick = () => { setLearnt(b.dataset.n, !learnt(b.dataset.n)); keepScroll('learn', showLearn); }; });
}
async function keepScroll(id, fn) { const y = $(id + '-scroll').scrollTop; await fn(); $(id + '-scroll').scrollTop = y; }

// ---------- my favourites ----------
function showFavs() {
  showView('v-favs');
  const l = favList();
  $('favs-box').innerHTML = !l.length
    ? `<div class="f-empty">${badge('heart', 'big')}<b>No favourites yet</b><p class="mut">Open any song and tap the ♡ at the top. It will appear here, so you can come back to listen and learn.</p></div>`
    : `<span class="lbl">${l.length === 1 ? '1 SONG' : l.length + ' SONGS'}</span><div class="card list">` + l.map(f =>
      `<div class="l-row" data-go="${BOOKS[f.book] ? BOOKS[f.book].hash : '#song/'}${esc(f.number)}"><span class="badge">${esc(f.number)}</span>` +
      `<span class="hc-t"><b>${esc(f.title)}</b><span class="mut">${esc((f.book === 'ashta' ? 'Aṣṭapadi ' + f.number + (f.raga ? ' · ' : '') : '') + (f.raga || ''))}</span></span>` +
      `<button class="f-heart" data-b="${esc(f.book)}" data-n="${esc(f.number)}" aria-label="Remove from my favourites">${svgI('heart_on')}</button></div>`).join('') +
      `</div><p class="mut f-hint">Tap a song to open it. Tap the heart to remove it.</p>`;
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
async function showTfdList() {
  showView('v-tfd');
  $('tfd-title').textContent = 'Thoughts for the Day';
  $('tfd-smaller').classList.add('hidden'); $('tfd-bigger').classList.add('hidden');
  const all = await tfds();
  $('tfd-box').innerHTML = `<p class="mut">Shri Janakiraman’s reflections on everyday life, newest first.</p>` + all.map(t =>
    `<button class="card t-item" data-go="#tfd/${esc(t.number)}"><span class="lbl">TFD ${esc(t.number)}${t.series ? ' · ' + esc(t.series.toUpperCase()) : ''}</span><b>${esc(t.title)}</b><span class="teaser mut">${esc(t.paras[0] || '')}</span></button>`).join('') +
    `<p class="mut center small">New thoughts will appear here as they are shared.</p>`;
  $('tfd-scroll').scrollTop = 0;
}
let tfdNow = null;
async function showTfd(number) {
  showView('v-tfd');
  const all = await tfds(), t = all.find(x => x.number === number);
  if (!t) { replaceHash('#tfd'); return showTfdList(); }
  const fresh = tfdNow !== number; tfdNow = number;
  $('tfd-title').textContent = 'Thought for the Day';
  $('tfd-smaller').classList.remove('hidden'); $('tfd-bigger').classList.remove('hidden');
  const out = [`<span class="lbl">THOUGHT FOR THE DAY · TFD ${esc(t.number)}</span>`];
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
  out.push('<div class="t-sep"></div>');
  if (t.songNumber && t.songBook === 'dns') {
    const s = await dnsSong(t.songNumber);
    if (s) out.push(`<button class="card t-link" data-go="#song/${esc(s.number)}">${badge('music')}<span class="hc-t"><span class="lbl">SING WITH TODAY’S THOUGHT</span><b>${esc(s.displayTitle)}</b><span class="mut">${esc(s.displayRaga ? s.number + ' · ' + s.displayRaga : s.number)}</span></span>${svgI('chevron', 'chev2')}</button>`);
  }
  const ev = await events();
  if (ev.length) out.push(`<button class="card t-link" data-go="#diary">${badge('event')}<span class="hc-t"><span class="lbl">NEXT SATSANG</span><b>${esc(ev[0].name)}</b><span class="mut">${esc(ev[0].when + ' · at ' + ev[0].place)}</span></span>${svgI('chevron', 'chev2')}</button>`);
  out.push(`<div class="t-acts"><button class="btn-acc" id="t-share">${svgI('share')}Share</button><button class="btn-line" data-go="#tfd">Past thoughts</button></div>`);
  $('tfd-box').innerHTML = `<div class="tfd-read">${out.join('')}</div>`;
  if (fresh) $('tfd-scroll').scrollTop = 0;
  $('t-share').onclick = () => {
    const text = 'Thought for the Day (TFD ' + t.number + '): ' + t.title + '\n\n' + t.paras.join('\n\n') + '\n\nRead the full thought and listen to the bhajans in the Harinamadwar app 🙏\n' + location.origin + location.pathname;
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
    const text = 'Today I sang ' + title + ' with Harinamadwar 🙏 youtube.com/@HariNamadwar';
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
  setTimeout(() => s.classList.add('go'), 700);
  setTimeout(() => s.classList.add('hidden'), 2000);
}

start();
