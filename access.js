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
  url: '',                 // e.g. https://abcd1234.supabase.co
  key: '',                 // the public key: "anon" (eyJ…) or "publishable" (sb_publishable_…)
  privateContent: false,   // true once songs and meanings are moved off public GitHub (phase 2)
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

// 'open' | 'login' | 'paused' | 'expired'
let accessState = 'open';
function computeState() {
  if (!accessOn()) return 'open';
  if (!acc.get('token', '')) return 'login';
  if (acc.get('status', 'active') === 'paused') return 'paused';
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
const OPEN_TO_ALL = h => h === '#about' || h === '#diary' || h === '#tfd' || h.startsWith('#tfd/');
function accessGate(hash) {
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
}
const LOGIN_ERR = {
  wrong: 'The phone number or code does not match. Please check both and try again.',
  used: 'This code has already been used on another device. Each phone or iPad needs its own code — please ask your satsang admin.',
  expired: 'This code is more than 7 days old. Please ask your satsang admin for a new one.',
  full: 'All your device places are used. Please ask your satsang admin to remove an old phone or iPad first.',
  locked: 'Too many tries. Please wait 15 minutes and try again.',
  missing: 'Please enter your phone number and the code.',
};
async function doLogin() {
  const phone = $('lg-phone').value.trim(), code = $('lg-code').value.trim();
  if (phone.replace(/\D/g, '').length < 10 || code.replace(/[^A-Za-z0-9]/g, '').length < 4) { $('lg-err').textContent = LOGIN_ERR.missing; return; }
  if (!navigator.onLine) { $('lg-err').textContent = 'Please connect to the internet for this first step.'; return; }
  const btn = $('lg-go'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await rpc('app_redeem', { p_phone: phone, p_code: code, p_device_key: deviceKey(), p_label: deviceLabel(), p_platform: 'ios' });
    if (!r.ok) { $('lg-err').textContent = LOGIN_ERR[r.error] || 'Could not sign in. Please try again.'; return; }
    acc.set('token', r.token); acc.set('name', r.name); acc.set('status', r.status);
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
  const paused = kind === 'paused';
  $('lk-h').textContent = paused ? 'Your access is paused' : 'Please connect to the internet';
  $('lk-p').textContent = paused
    ? 'Your satsang admin has paused the songs on this device for now. Please contact them to resume.'
    : 'It has been a while since the app last checked in. Connect to Wi-Fi or mobile data once, then tap Try again. After that it works offline again.';
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
  const t = (name + ' · Harinamadwar').replace(/[<&>"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><text x="20" y="120" transform="rotate(-24 160 100)" font-family="Mukta, sans-serif" font-size="20" fill="#7a8aa6" fill-opacity="0.13">${t}</text></svg>`;
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
function privateFile(path) {
  return rpc('app_content', { p_device_key: deviceKey(), p_token: acc.get('token', ''), p_path: path })
    .then(t => { if (typeof t !== 'string' || !t) throw new Error('no ' + path); return t; });
}

// no copying out of lyrics, meanings and thoughts
const inLocked = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest('#v-song, #v-other')); };
document.addEventListener('copy', e => { const s = document.getSelection(); if (accessOn() && s && inLocked(s.anchorNode)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (accessOn() && e.target.closest && e.target.closest('#v-song')) e.preventDefault(); });
