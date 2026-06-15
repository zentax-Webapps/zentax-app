// App entry - boots auth, wires router, renders shell.
import { bootstrap, getUser, onAuthChange, logout, ROLE_LABELS } from './auth.js';
import { onRoute, parse } from './router.js';
import { sb } from './sb.js';
import { h, clear, showOk } from './ui.js';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';
import {
  onInstallStateChange, triggerInstall, dismissForSession, markInstallHandled,
  platform, instructionsFor,
} from './install.js';

import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderCompanies } from './views/companies.js';
import { renderCompany } from './views/company.js';
import { renderTasks } from './views/tasks.js';
import { renderTask } from './views/task.js';
import { renderUsers } from './views/users.js';
import { renderAccount } from './views/account.js';

const root = document.getElementById('app');

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---- Install banner ----
// Shown as a floating bar at the bottom whenever the app is installable
// and the user hasn't dismissed it THIS SESSION. We never permanently
// hide it - the user can always trigger install from Account too.
const banner = document.getElementById('install-banner');
const installBtn = document.getElementById('install-btn');
const dismissBtn = document.getElementById('install-dismiss');
const bannerLabel = banner?.querySelector('span');

onInstallStateChange((s) => {
  if (!banner) return;
  if (s.isInstalled) { banner.hidden = true; return; }
  if (s.installHandled) { banner.hidden = true; return; }   // already chose / installed
  if (s.dismissedThisSession) { banner.hidden = true; return; }

  if (s.canPrompt) {
    // Chrome / Android - we have a real native prompt to fire
    bannerLabel.textContent = s.platform === 'android'
      ? 'Install Zentax as an app on your phone'
      : 'Install Zentax Work Flow as an app';
    installBtn.textContent = 'Install';
    installBtn.hidden = false;
    banner.hidden = false;
  } else if (s.platform === 'ios') {
    // iOS - no programmatic prompt; show "How?" that opens instructions
    bannerLabel.textContent = 'Add Zentax to your home screen';
    installBtn.textContent = 'How?';
    installBtn.hidden = false;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
});

installBtn?.addEventListener('click', async () => {
  const result = await triggerInstall();
  if (result === 'accepted') {
    showOk('Installing… look for the Zentax icon on your home screen.');
  } else if (result === 'no-prompt') {
    // iOS / unsupported - open Account view which has step-by-step instructions
    location.hash = '#/account';
  }
  // The user has now engaged with the install flow - don't show the banner
  // again on this device (accepted, dismissed in the native dialog, or sent to
  // the iOS instructions all count). They can still install from Account.
  markInstallHandled();
});
dismissBtn?.addEventListener('click', () => dismissForSession());

// ---- Config-not-set guard ----
if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON.includes('PASTE_')) {
  root.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:24px;
    background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.08);
    font-family:system-ui;">
    <h2 style="margin-top:0;">Almost there 👋</h2>
    <p>Edit <code>public/js/config.js</code> and paste your Supabase
    <strong>Project URL</strong> and <strong>anon public key</strong>
    (Supabase Dashboard → Project Settings → API).</p>
    <p style="color:#64748b;font-size:13px;">Both values are public — RLS in the
    database enforces all permissions.</p>
  </div>`;
} else {
  (async () => {
    await bootstrap();
    onAuthChange(() => { clientCompanyName = null; render(); });
    onRoute(() => render());
    render();
  })();
}

let sidebarOpen = false;
let clientCompanyName = null;   // cached company label for client users

// Fetch the client's company name once and drop it into the header tag.
async function loadClientCompany(userId) {
  if (clientCompanyName !== null) {
    const tag = document.getElementById('company-tag');
    if (tag) tag.textContent = clientCompanyName;
    return;
  }
  try {
    const { data } = await sb.from('company_members')
      .select('companies(name)')
      .eq('user_id', userId)
      .limit(1);
    clientCompanyName = data?.[0]?.companies?.name || '';
  } catch { clientCompanyName = ''; }
  const tag = document.getElementById('company-tag');
  if (tag) tag.textContent = clientCompanyName;
}

function render() {
  const user = getUser();
  const route = parse();
  if (!user) { renderLogin(root); return; }
  renderShell(route);
}

function renderShell(route) {
  const user = getUser();
  const navItems = buildNav(user.role);
  clear(root);

  const sidebar = h('aside', { class: 'sidebar' + (sidebarOpen ? ' open' : '') }, [
    h('div', { class: 'brand' }, [h('span', { class: 'dot' }), 'Zentax Work Flow']),
    h('nav', {},
      navItems.map(n => h('a', {
        href: '#' + n.path,
        class: matchActive(route.path, n.match ?? n.path.slice(1)) ? 'active' : '',
        onClick: () => { sidebarOpen = false; }
      }, n.label))
    ),
    h('div', { class: 'me' }, [
      h('div', { class: 'name' }, user.full_name),
      h('div', { class: 'role' }, ROLE_LABELS[user.role] || user.role),
      h('button', { onClick: async () => { await logout(); } }, 'Sign out'),
    ])
  ]);

  const topbar = h('header', { class: 'topbar' }, [
    h('button', { class: 'menu-btn', onClick: () => { sidebarOpen = !sidebarOpen; render(); } }, '☰'),
    h('h1', {}, pageTitleFor(route)),
  ]);
  // Clients see their company name in the header (they have no Companies nav).
  if (CLIENT_ROLES.includes(user.role)) {
    const tag = h('span', { class: 'company-tag', id: 'company-tag' },
      clientCompanyName || '');
    topbar.appendChild(tag);
    loadClientCompany(user.id);
  }

  const content = h('main', { class: 'content', id: 'view' });
  root.appendChild(h('div', { class: 'app-shell' }, [
    sidebar,
    h('div', { class: 'main' }, [topbar, content]),
  ]));

  routeTo(route, content);
}

function matchActive(path, match) {
  if (match === '') return path === '';
  return path.startsWith(match);
}

const CLIENT_ROLES = ['client_owner', 'client_executive'];

function buildNav(role) {
  const items = [{ label: 'Dashboard', path: '/', match: '' }];
  // Clients belong to a single company, so they don't browse a Companies list -
  // their company is shown in the header instead.
  if (!CLIENT_ROLES.includes(role)) {
    items.push({ label: 'Companies', path: '/companies', match: 'companies' });
  }
  items.push({ label: 'Tasks',     path: '/tasks',     match: 'tasks' });
  if (role === 'super_admin' || role === 'admin') {
    items.push({ label: 'Users', path: '/users', match: 'users' });
  }
  items.push({ label: 'Account', path: '/account', match: 'account' });
  return items;
}

function pageTitleFor(route) {
  const m = { '': 'Dashboard', companies: 'Companies', tasks: 'Tasks',
              users: 'Users', account: 'Account' };
  return m[route.parts[0] || ''] || 'Zentax Work Flow';
}

function routeTo(route, mount) {
  const [a, b] = route.parts;
  try {
    if (!a)                          return renderDashboard(mount);
    if (a === 'companies' && !b)     return renderCompanies(mount);
    if (a === 'companies' && b)      return renderCompany(mount, Number(b));
    if (a === 'tasks' && !b)         return renderTasks(mount, route.query);
    if (a === 'tasks' && b)          return renderTask(mount, Number(b));
    if (a === 'users')               return renderUsers(mount);
    if (a === 'account')             return renderAccount(mount);
    mount.appendChild(h('div', { class: 'empty' }, 'Page not found.'));
  } catch (e) {
    console.error(e);
    mount.appendChild(h('div', { class: 'alert error' }, 'Page error: ' + e.message));
  }
}
