import { changePassword, getUser, ROLE_LABELS } from '../auth.js';
import { h, clear, showOk, showError } from '../ui.js';
import {
  onInstallStateChange, triggerInstall,
  platform, instructionsFor, state as installState,
} from '../install.js';

export function renderAccount(root) {
  const user = getUser();
  clear(root);

  // ---- Profile card ----
  root.appendChild(h('div', { class: 'card' }, [
    h('h2', {}, 'Your account'),
    h('div', { class: 'kv' }, [
      h('div', { class: 'k' }, 'Name'),  h('div', {}, user.full_name),
      h('div', { class: 'k' }, 'Email'), h('div', {}, user.email),
      h('div', { class: 'k' }, 'Role'),  h('div', {}, ROLE_LABELS[user.role] || user.role),
    ]),
    h('div', { class: 'muted', style: 'font-size:13px;margin-top:10px;' },
      'You will stay signed in on this device until you press Sign Out. ' +
      'Closing the browser or restarting the phone does not log you out.'),
  ]));

  // ---- Install as App card (always visible if not yet installed) ----
  root.appendChild(installCard());

  // ---- Change password card ----
  const np  = h('input', { class: 'input', type: 'password', placeholder: 'New password (min 8 chars)' });
  const np2 = h('input', { class: 'input', type: 'password', placeholder: 'Confirm new password' });
  const btn = h('button', { class: 'btn',
    onClick: async () => {
      if (np.value.length < 8) { showError('Minimum 8 characters'); return; }
      if (np.value !== np2.value) { showError('Passwords do not match'); return; }
      btn.disabled = true;
      try {
        await changePassword(np.value);
        showOk('Password updated');
        np.value = np2.value = '';
      } catch (e) { showError(e.message); }
      finally { btn.disabled = false; }
    }
  }, 'Update password');

  root.appendChild(h('div', { class: 'card' }, [
    h('h2', {}, 'Change password'),
    h('div', { class: 'field' }, [h('label', {}, 'New password'), np]),
    h('div', { class: 'field' }, [h('label', {}, 'Confirm new password'), np2]),
    btn,
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px;' },
      'Passwords are stored only as hashes by Supabase Auth — never in plain text, never in our code.'),
  ]));

  if (user.role === 'client_owner') {
    root.appendChild(h('div', { class: 'alert info' },
      'Need an Executive on your side? Email or call your Zentax account manager. ' +
      'Executives are created by our Super Admin and added to your company.'));
  }
}

// ---- Install card ----
// On Android Chrome: a big "Install on Android" button.
// On Desktop Chrome/Edge: a "Install as App" button.
// On iOS Safari: step-by-step instructions to Add to Home Screen.
// Always shown until the app is detected as running standalone.

function installCard() {
  const card = h('div', { class: 'card', id: 'install-card' });
  const refresh = () => renderInstallCard(card);
  onInstallStateChange(refresh);
  return card;
}

function renderInstallCard(card) {
  const s = installState();
  card.innerHTML = '';

  if (s.isInstalled) {
    card.appendChild(h('h2', {}, 'Installed ✓'));
    card.appendChild(h('div', { class: 'muted' },
      'You are using Zentax as an installed app. Tap the Zentax icon on your ' +
      'home screen or app drawer any time to open it instantly.'));
    return;
  }

  // Headline depends on platform
  const title = s.platform === 'android'
    ? 'Install on your Android phone'
    : s.platform === 'ios'
      ? 'Add to iPhone home screen'
      : 'Install as a desktop app';
  card.appendChild(h('h2', {}, title));

  if (s.platform === 'android') {
    card.appendChild(h('p', { class: 'muted', style: 'margin:0 0 12px;' },
      'Add Zentax to your home screen for one-tap access. It opens like a regular app — ' +
      'no browser tabs, stays logged in, works offline for what you\'ve already loaded.'));
  } else if (s.platform === 'ios') {
    card.appendChild(h('p', { class: 'muted', style: 'margin:0 0 12px;' },
      'Add Zentax to your home screen so it opens like a regular app, with no browser bar.'));
  } else {
    card.appendChild(h('p', { class: 'muted', style: 'margin:0 0 12px;' },
      'Install Zentax to open it from your dock/taskbar like any other app.'));
  }

  // Button: only meaningful if we have a native prompt
  if (s.canPrompt) {
    const installBtn = h('button', { class: 'btn',
      onClick: async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Installing…';
        const r = await triggerInstall();
        if (r === 'accepted') {
          showOk('Installing… look for the Zentax icon on your home screen.');
        } else if (r === 'dismissed') {
          installBtn.disabled = false;
          installBtn.textContent = s.platform === 'android' ? 'Install on Android' : 'Install Zentax';
        }
      }
    }, s.platform === 'android' ? 'Install on Android' : 'Install Zentax');
    card.appendChild(installBtn);
  }

  // Instructions: always show as a fallback (and always for iOS).
  card.appendChild(h('hr', { class: 'sep' }));
  card.appendChild(h('h3', { style: 'margin:0 0 8px;font-size:14px;' },
    s.canPrompt ? "Or, do it manually:" : "How to install:"));
  const ol = h('ol', { style: 'margin:0;padding-left:20px;font-size:14px;line-height:1.6;' });
  instructionsFor(s.platform).forEach(step => ol.appendChild(h('li', {}, step)));
  card.appendChild(ol);

  if (s.platform === 'ios') {
    card.appendChild(h('div', { class: 'alert info', style: 'margin-top:12px;font-size:13px;' },
      'iOS does not allow apps to add a one-tap install button — you have to use ' +
      'Safari\'s Share menu. We\'re showing the exact steps above.'));
  }
}
