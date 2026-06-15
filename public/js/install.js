// PWA install helper.
//
// Three jobs:
//   1. Capture Chrome's beforeinstallprompt event so we can trigger it later
//      from any UI (the event only fires once; you can't re-fire it).
//   2. Detect platform (android / ios / desktop) so we can show the right UI.
//   3. Detect whether the app is already installed (running standalone).
//
// Subscribe with onInstallStateChange(cb) - the callback gets a state object
// any time something relevant changes (event captured, dismissed, installed).

let deferredPrompt = null;
let dismissedThisSession = false;          // resets on tab reload
const subs = new Set();

// Permanent flag (survives reloads / sessions). Set once the user has engaged
// with the install flow (tapped Install / How) or the app is detected as
// installed - so we never nag them again on this device.
const HANDLED_KEY = 'zentax_install_handled';
function readHandled() {
  try { return localStorage.getItem(HANDLED_KEY) === '1'; } catch { return false; }
}
export function markInstallHandled() {
  try { localStorage.setItem(HANDLED_KEY, '1'); } catch {}
  emit();
}

function emit() {
  const s = state();
  subs.forEach(cb => { try { cb(s); } catch {} });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  emit();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  markInstallHandled();            // remember permanently; also emits
});

export function onInstallStateChange(cb) {
  subs.add(cb);
  cb(state());                              // fire once immediately
  return () => subs.delete(cb);
}

export function platform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

export function isStandalone() {
  // Chrome/Android PWA detection
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari standalone detection
  if (window.navigator.standalone === true) return true;
  return false;
}

export function canPrompt() { return !!deferredPrompt; }

export function dismissForSession() {
  dismissedThisSession = true;
  emit();
}

export function state() {
  return {
    platform: platform(),
    isInstalled: isStandalone(),
    canPrompt: canPrompt(),
    dismissedThisSession,
    installHandled: readHandled(),
  };
}

// Trigger the install. Returns:
//   'accepted' / 'dismissed' on Chrome (we got the native prompt)
//   'no-prompt' on Safari/iOS or browsers where we don't have a prompt;
//   the caller should show platform-specific instructions in that case.
export async function triggerInstall() {
  if (!deferredPrompt) return 'no-prompt';
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  // The prompt is single-use even on dismiss.
  deferredPrompt = null;
  emit();
  return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
}

// Step-by-step instructions for platforms that don't expose a programmatic prompt.
export function instructionsFor(p = platform()) {
  if (p === 'ios') {
    return [
      'Open this page in Safari (not in another app\'s browser).',
      'Tap the Share button (the square with an up-arrow) at the bottom of the screen.',
      'Scroll down and tap "Add to Home Screen".',
      'Tap "Add" in the top-right. The Zentax icon will appear on your home screen.',
    ];
  }
  if (p === 'android') {
    return [
      'Open this page in Chrome on your Android phone.',
      'Tap the three-dot menu in the top-right of Chrome.',
      'Tap "Install app" (or "Add to Home screen" on older Chrome versions).',
      'Tap "Install". The Zentax icon will appear on your home screen.',
    ];
  }
  return [
    'In Chrome or Edge on desktop, click the install icon at the right of the address bar.',
    'Click "Install". The app will open in its own window and pin to your taskbar/dock.',
  ];
}
