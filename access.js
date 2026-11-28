/* Harinamadwar – student sign-in for the iPhone/iPad app (SCRUM-38, 40, 41).
 *
 * Switched OFF while ACCESS.url is empty: the app then works exactly as before.
 * Once the Supabase project exists, fill in ACCESS.url and ACCESS.key (the public "anon" key).
 *
 * How it works
 *   • First time on a device: phone number + invite code → the server gives this device its own secret token.
 *   • Every start with internet: the token is checked. Paused → songs locked. Removed → back to sign-in.
 *   • Without internet the app keeps working for `offline_days` (30) after the last check, then asks to go online once.
 *   • About, Thought for the Day and the Satsang diary are open to everyone (decided 18 Nov 2026).
 *     Songs, meanings, recordings, Learn and favourites need a signed-in, active device.
 */
'use strict';
const ACCESS = {
  url: 'https://rjjpgxiyncgjrwmvnbhg.supabase.co',
  key: 'sb_publishable_v_qO0MNpMCGvuaEo3oWGEQ_NyiOylEM',   // the public "publishable" key (safe to publish)
  privateContent: true,    // songs and meanings come from the private store, only to signed-in phones (27 Nov 2026)
};
const accessOn = () => !!(ACCESS.url && ACCESS.key);

const acc = {
  get(k, d) { try { const v = localStorage.getItem('hg.acc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v === null) localStorage.removeItem('hg.acc.' + k); else localStorage.setItem('hg.acc.' + k, JSON.stringify(v)); } catch (e) { } },
};

function deviceKey() {
  let k = acc.get('device', '');
  if (!k) {
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    k = 'w-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    acc.set('device', k);
  }
  return k;
}
function deviceLabel() {
  const u = navigator.userAgent;
  if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(u)) return 'iPhone';
  if (/Android/.test(u)) return /Mobile/.test(u) ? 'Android phone (browser)' : 'Android tablet (browser)';
  return 'Computer';
}

async function rpc(fn, args) {
  const r = await fetch(ACCESS.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST', cache: 'no-store',
    // the older "anon" key is a JWT and also goes in Authorization; the newer "publishable" key (sb_publishable_…) goes in apikey only
    headers: Object.assign({ apikey: ACCESS.key, 'Content-Type': 'application/json' }, ACCESS.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + ACCESS.key } : {}),
    body: JSON.stringify(args || {}),
  });
  if (!r.ok) throw new Error(fn + ' ' + r.status);
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return t; }
}

// 'open' | 'login' | 'paused' | 'ended' | 'expired'
// Weekend sign-in (27 Nov 2026): name + phone, no code. 'ended' = the admin switched weekend access off.
let accessState = 'open';
function computeState() {
  if (!accessOn()) return 'open';
  if (!acc.get('token', '')) return 'login';
  if (acc.get('status', 'active') === 'paused') return 'paused';
  if (acc.get('status', 'active') === 'ended') return 'ended';
  const days = acc.get('offlineDays', 30), last = acc.get('lastOk', 0);
  if (Date.now() - last > days * 864e5) return 'expired';
  return 'open';
}

/** Ask the server whether this device may still use the app (only when online). */
async function accessCheck() {
  if (!accessOn() || !acc.get('token', '') || !navigator.onLine) return;
  try {
    const r = await rpc('app_check', { p_device_key: deviceKey(), p_token: acc.get('token', '') });
    if (!r || !r.ok) return;
    if (r.content != null) acc.set('contentStamp', String(r.content));
    if (r.status === 'removed' || r.status === 'ended') clearPrivate();
    if (r.status === 'removed') {
      acc.set('token', null); acc.set('status', null);
      acc.set('message', 'This device was removed by the satsang admin. Please ask them for a new code.');
    } else {
      acc.set('status', r.status); acc.set('name', r.name || acc.get('name', ''));
      acc.set('offlineDays', r.offline_days || 30); acc.set('lastOk', Date.now());
    }
  } catch (e) { /* offline or server busy: keep the last answer */ }
}

async function accessStart() {
  if (!accessOn()) return;
  document.body.classList.add('secure');
  await Promise.race([accessCheck(), new Promise(r => setTimeout(r, 4000))]);   // never keep the app waiting long
  accessState = computeState();
  applyWatermark();
  // check again whenever the app comes back to the front
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const before = accessState;
    await accessCheck(); accessState = computeState();
    if (accessState !== before) { if (accessState === 'open') afterUnlock(); else route(); }
  });
  window.addEventListener('online', async () => { await accessCheck(); const s = computeState(); if (s !== accessState) { accessState = s; if (s === 'open') afterUnlock(); else route(); } });
}

/** Called first in route(): returns true when it showed the sign-in or a lock screen instead. */
// before sign-in only these two are open (Shiv, 28 Nov): Thought for the Day needs sign-in too
const OPEN_TO_ALL = h => h === '#about' || h === '#diary';
function accessGate(hash) {
  if (accessState === 'ended') { showLocked('ended'); return true; }   // nothing stays open after the weekend
  if (accessState === 'open' || OPEN_TO_ALL(hash)) return false;
  if (accessState === 'login') showLogin(); else showLocked(accessState);
  return true;
}

// ---------- sign-in screen ----------
function showLogin() {
  showView('v-login');
  const msg = acc.get('message', '');
  $('lg-msg').textContent = msg; $('lg-msg').classList.toggle('hidden', !msg);
  $('lg-err').textContent = '';
  $('lg-havecode').onclick = () => { $('lg-codebox').classList.toggle('hidden'); $('lg-err').textContent = ''; };
}
const LOGIN_ERR = {
  wrong: 'The phone number or code does not match. Please check both and try again.',
  used: 'This code has already been used on another device. Each phone or iPad needs its own code — please ask your satsang admin.',
  expired: 'This code is more than 7 days old. Please ask your satsang admin for a new one.',
  full: 'All your device places are used. Please ask your satsang admin to remove an old phone or iPad first.',
  locked: 'Too many tries. Please wait 15 minutes and try again.',
  missing: 'Please enter your phone number and the code.',
  // weekend sign-in (name + phone)
  name: 'Please type your name.',
  phone: 'Please type your 10-digit mobile number (for another country, start with + and the country code).',
  mismatch: 'This number belongs to a satsang student under another name. Please type your name as the satsang has it, or use your invite code.',
  closed: 'Thank you for joining us! The Harinamadwar preview has ended. We will let you know when the app opens again. 🙏',
};
async function doLogin() {
  const withCode = !$('lg-codebox').classList.contains('hidden');
  const name = $('lg-name').value.trim().replace(/\s+/g, ' '), phone = $('lg-phone').value.trim(), code = $('lg-code').value.trim();
  const digits = phone.replace(/\D/g, '');
  if (withCode) {
    if (digits.length < 10 || code.replace(/[^A-Za-z0-9]/g, '').length < 4) { $('lg-err').textContent = LOGIN_ERR.missing; return; }
  } else {
    if (name.length < 2 || !/\p{L}/u.test(name)) { $('lg-err').textContent = LOGIN_ERR.name; $('lg-name').focus(); return; }
    const local = digits.replace(/^(91|0)(?=\d{10}$)/, '');
    if (!(/^[6-9]\d{9}$/.test(local) || (phone.startsWith('+') && digits.length >= 8 && digits.length <= 15))) { $('lg-err').textContent = LOGIN_ERR.phone; $('lg-phone').focus(); return; }
  }
  if (!navigator.onLine) { $('lg-err').textContent = 'Please connect to the internet for this first step.'; return; }
  const btn = $('lg-go'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = withCode
      ? await rpc('app_redeem', { p_phone: phone, p_code: code, p_device_key: deviceKey(), p_label: deviceLabel(), p_platform: 'ios' })
      : await rpc('app_event_join', { p_name: name, p_phone: phone, p_device_key: deviceKey(), p_label: deviceLabel(), p_platform: 'web' });
    if (!r.ok) { $('lg-err').textContent = LOGIN_ERR[r.error] || 'Could not sign in. Please try again.'; return; }
    acc.set('token', r.token); acc.set('name', r.name); acc.set('status', r.status); acc.set('phone4', '••' + digits.slice(-4));
    acc.set('offlineDays', r.offline_days || 30); acc.set('lastOk', Date.now()); acc.set('message', null);
    if (!store.get('name', '')) store.set('name', (r.name || '').split(' ')[0]);
    accessState = computeState(); applyWatermark();
    $('lg-code').value = '';
    showNotice(() => { replaceHash(''); afterUnlock(); });
  } catch (e) {
    $('lg-err').textContent = 'Could not reach Harinamadwar. Please check the internet and try again.';
  } finally { btn.disabled = false; btn.textContent = 'Continue'; }
}

/** Back into the app: home, then the one-time welcome if this person has not seen it yet. */
function afterUnlock() {
  route();
  if (!store.get('interestsDone', false)) go('#welcome');
  else if (!prefs.setupDone) go('#settings');
}

// ---------- paused / needs internet ----------
function showLocked(kind) {
  showView('v-locked');
  const paused = kind === 'paused', ended = kind === 'ended';
  $('lk-open').classList.toggle('hidden', ended);
  $('lk-h').textContent = ended ? 'Thank you for joining us 🙏' : paused ? 'Your access is paused' : 'Please connect to the internet';
  $('lk-p').textContent = ended
    ? 'The Harinamadwar preview has ended. We are gathering your feedback to make the app even better, and will let you know when it opens again. Hari Om!'
    : paused
    ? 'Your satsang admin has paused the songs on this device for now. Please contact them to resume.'
    : 'It has been a while since the app last checked in. Connect to Wi-Fi or mobile data once, then tap Try again.';
}
async function retryLocked() {
  $('lk-go').disabled = true;
  await accessCheck(); accessState = computeState();
  $('lk-go').disabled = false;
  if (accessState === 'open') { replaceHash(''); afterUnlock(); } else { route(); toast(navigator.onLine ? 'Still locked. Please contact your satsang admin.' : 'No internet yet.'); }
}

// ---------- for class use only (shown once after the first sign-in) ----------
function showNotice(then) {
  if (acc.get('noticeOk', false)) return then();
  $('notice').classList.remove('hidden');
  $('nt-ok').onclick = () => { acc.set('noticeOk', true); $('notice').classList.add('hidden'); then(); };
}

// ---------- the person's name, faintly behind lyrics and meanings ----------
function applyWatermark() {
  const name = accessOn() ? acc.get('name', '') : '';
  if (!name) { document.documentElement.style.removeProperty('--wm'); return; }
  const ph = String(acc.get('phone4', '') || '');
  const t = (name + (ph ? ' · ' + ph : '') + ' · Harinamadwar').replace(/[<&>"]/g, '');
  // 28 Nov: darker and tiled more closely so it's harder to crop out of a screenshot.
  // The line is drawn at the neighbouring tile positions too, so it runs on seamlessly across tile edges.
  const fs = Math.max(10, Math.min(15, Math.floor(270 / (t.length * 0.52)))), W = 270, H = 96;
  let lines = '';
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const x = W / 2 + dx * W, y = H / 2 + dy * H;
    lines += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-22 ${x} ${y})">${t}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g font-family="Mukta, sans-serif" font-size="${fs}" font-weight="600" fill="#6f7f9c" fill-opacity="0.24">${lines}</g></svg>`;
  document.documentElement.style.setProperty('--wm', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

// ---------- satsangs, Learn and thoughts from the admin page instead of GitHub ----------
let communityP = null;
function communityFile(name) {
  if (!communityP) {
    communityP = rpc('app_community').then(r => { acc.set('community', r); if (r && r.version != null && window.seenContent) window.seenContent('comm', r.version); return r; })   // SCRUM-103
      .catch(() => acc.get('community', null));
  }
  return communityP.then(r => { if (!r || r[name] === undefined) throw new Error('no ' + name); return r[name]; });
}

// ---------- songs and meanings from the private store (phase 2) ----------
// Songs and meanings: fetched from the private store and kept on this phone for offline use.
// The stored copy is refreshed when the server says the content changed, and wiped when access ends.
const PRIV = 'hg-private';
function clearPrivate() { try { caches.delete(PRIV); } catch (e) { } }
async function privateFile(path) {
  const key = location.origin + '/__private__/' + path, stamp = String(acc.get('contentStamp', ''));
  let c = null; try { c = await caches.open(PRIV); } catch (e) { }
  if (c && stamp) { const hit = await c.match(key); if (hit && hit.headers.get('x-stamp') === stamp) return hit.text(); }
  try {
    const t = await rpc('app_content', { p_device_key: deviceKey(), p_token: acc.get('token', ''), p_path: path });
    if (typeof t !== 'string') throw new Error('no ' + path);
    if (c) c.put(key, new Response(t, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-stamp': stamp } })).catch(() => { });
    return t;
  } catch (e) {
    if (c && accessState !== 'ended') { const hit = await c.match(key); if (hit) return hit.text(); }   // offline: last stored copy
    throw e;
  }
}

// no copying out of lyrics, meanings and thoughts
// no copying anywhere in the app (only the sign-in boxes and admin forms can be typed in and copied)
const inLocked = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && !el.closest('input, textarea, [contenteditable]')); };
document.addEventListener('copy', e => { const s = document.getSelection(); if (accessOn() && s && inLocked(s.anchorNode)) e.preventDefault(); });
const PROTECTED = '.view, .sheet';
const typing = el => !!(el && el.closest && el.closest('input, textarea, [contenteditable]'));
document.addEventListener('contextmenu', e => { if (accessOn() && !typing(e.target)) e.preventDefault(); });
['cut', 'dragstart', 'selectstart'].forEach(ev => document.addEventListener(ev, e => { if (accessOn() && e.target.closest && !typing(e.target)) e.preventDefault(); }));
// computers: no Copy / Select all / Print / Save on song pages
document.addEventListener('keydown', e => {
  if (!accessOn() || !(e.ctrlKey || e.metaKey)) return;
  if (['c', 'a', 'p', 's', 'u', 'x'].includes((e.key || '').toLowerCase()) && !typing(e.target)) e.preventDefault();
});
// hide the words while the app is in the background (app switcher pictures) or being printed
document.addEventListener('visibilitychange', () => document.body.classList.toggle('shield', accessOn() && document.hidden));
['pointerdown', 'touchstart', 'focus'].forEach(ev => window.addEventListener(ev, () => document.body.classList.remove('shield'), { passive: true }));
window.addEventListener('beforeprint', () => { if (accessOn()) document.body.classList.add('shield'); });
window.addEventListener('afterprint', () => document.body.classList.remove('shield'));
