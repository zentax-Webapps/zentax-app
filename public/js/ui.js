// Tiny DOM helpers + modal/toast.
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  const list = Array.isArray(children) ? children : [children];
  list.forEach(c => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c)) : c);
  });
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtDay(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function alertBox(kind, msg) {
  return h('div', { class: 'alert ' + kind }, msg);
}

export function modal(title, contentEl, { onOk, okLabel = 'Save', cancelLabel = 'Cancel' } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const cancelBtn = h('button', { class: 'btn secondary', onClick: () => close() }, cancelLabel);
  const okBtn = h('button', { class: 'btn', onClick: async () => {
    okBtn.disabled = true;
    try { const r = await onOk?.(); if (r !== false) close(); }
    catch (e) { showError(e.message); }
    finally { okBtn.disabled = false; }
  } }, okLabel);
  const m = h('div', { class: 'modal' }, [
    h('h3', {}, title),
    contentEl,
    h('div', { class: 'actions' }, [cancelBtn, okBtn])
  ]);
  backdrop.appendChild(m);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  function close() { backdrop.remove(); }
  return { close, okBtn };
}

let toastTimer = null;
export function toast(msg, kind = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div', { id: 'toast', style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:80px;background:#0f172a;color:#fff;padding:10px 14px;border-radius:8px;z-index:300;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:14px;' });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = kind === 'error' ? '#991b1b' : kind === 'success' ? '#166534' : '#0f172a';
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}
export function showError(msg) { toast(msg, 'error'); }
export function showOk(msg) { toast(msg, 'success'); }

export function priorityChip(p) {
  return h('span', {}, [h('span', { class: 'priority-dot ' + p }), p.charAt(0).toUpperCase() + p.slice(1)]);
}
export function roleBadge(role) {
  const labels = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    team_member: 'Team Member',
    client_owner: 'Client - Owner',
    client_executive: 'Client - Executive',
  };
  return h('span', { class: 'badge role-' + role }, labels[role] || role);
}
export function statusChip(s) {
  const labels = { proposed: 'Awaiting Acceptance', open: 'Open', in_progress: 'In Progress', close_requested: 'Awaiting Close', closed: 'Closed' };
  return h('span', { class: 'status-chip ' + s }, labels[s] || s);
}
