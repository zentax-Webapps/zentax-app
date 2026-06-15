import { sb } from '../sb.js';
import { getUser } from '../auth.js';
import { h, clear, modal, roleBadge, showOk, showError } from '../ui.js';
import { taskTable } from './tasks.js';

export async function renderCompany(root, id) {
  const user = getUser();
  clear(root);
  root.appendChild(h('div', { class: 'card', id: 'co' }, 'Loading…'));
  root.appendChild(h('div', { class: 'card', id: 'baskets' }, 'Loading baskets…'));
  root.appendChild(h('div', { class: 'card', id: 'tasks' }, 'Loading tasks…'));

  let company, members;
  try {
    const { data: c, error: e1 } = await sb.from('companies')
      .select('id, name, notes').eq('id', id).single();
    if (e1) throw e1;
    company = c;
    const { data: m, error: e2 } = await sb.from('company_members')
      .select('user_id, profiles:profiles!company_members_user_id_fkey(id, email, full_name, role, is_active)')
      .eq('company_id', id);
    if (e2) throw e2;
    members = (m || []).map(row => row.profiles).filter(Boolean);
    // sort: admin, team_member, client_owner, client_executive
    const order = { admin: 1, team_member: 2, client_owner: 3, client_executive: 4 };
    members.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9)
                       || a.full_name.localeCompare(b.full_name));
  } catch (e) {
    root.querySelector('#co').innerHTML = '';
    root.querySelector('#co').appendChild(h('div', { class: 'alert error' }, 'Failed: ' + e.message));
    return;
  }

  const co = root.querySelector('#co');
  co.innerHTML = '';
  co.appendChild(h('div', { class: 'flex between' }, [
    h('h2', { style: 'margin:0;' }, company.name),
    h('div', { class: 'actions' }, [
      h('a', { class: 'btn', href: '#/tasks?company_id=' + company.id }, 'View Tasks'),
      ['super_admin','admin'].includes(user.role)
        ? h('button', { class: 'btn secondary', onClick: () => openAddMember(root, company.id, members) }, '+ Add Member')
        : null,
      h('a', { class: 'btn secondary', href: '#/tasks?company_id=' + company.id + '&new=1' }, '+ New Task'),
    ]),
  ]));
  if (company.notes) co.appendChild(h('p', { class: 'muted', style: 'margin-top:6px;' }, company.notes));

  co.appendChild(h('h2', { style: 'margin-top:16px;' }, 'Members'));
  if (!members.length) co.appendChild(h('div', { class: 'muted' }, 'No members yet.'));
  else {
    const tbl = h('table', { class: 'table' }, [
      h('thead', {}, h('tr', {}, [h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, '')])),
      h('tbody', {}, members.map(m => h('tr', {}, [
        h('td', {}, m.full_name),
        h('td', {}, m.email),
        h('td', {}, roleBadge(m.role)),
        h('td', {}, user.role === 'super_admin'
          ? h('button', { class: 'btn secondary', onClick: async () => {
              if (!confirm('Remove ' + m.full_name + ' from ' + company.name + '?')) return;
              try {
                const { error } = await sb.from('company_members').delete()
                  .eq('company_id', company.id).eq('user_id', m.id);
                if (error) throw error;
                showOk('Removed'); renderCompany(root, company.id);
              } catch (e) { showError(e.message); }
            } }, 'Remove') : null)
      ])))
    ]);
    co.appendChild(tbl);
  }

  await renderBaskets(root, company, user);

  try {
    const { data: tasks, error } = await sb.from('tasks')
      .select('id, title, priority, due_date, status, company_id, basket_id, companies(name), baskets(name), assigned_profile:profiles!tasks_assigned_to_fkey(full_name)')
      .eq('company_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const tc = root.querySelector('#tasks');
    tc.innerHTML = '';
    tc.appendChild(h('h2', {}, 'Tasks in ' + company.name));
    if (!tasks.length) { tc.appendChild(h('div', { class: 'muted' }, 'No tasks.')); return; }
    tc.appendChild(taskTable(tasks.map(t => ({
      ...t,
      company_name: t.companies?.name,
      basket_name: t.baskets?.name,
      assigned_to_name: t.assigned_profile?.full_name,
    }))));
  } catch (e) {
    root.querySelector('#tasks').textContent = 'Failed: ' + e.message;
  }
}

async function renderBaskets(root, company, user) {
  const mount = root.querySelector('#baskets');
  if (!mount) return;
  const canManage = ['super_admin', 'admin'].includes(user.role);
  mount.innerHTML = '';
  mount.appendChild(h('div', { class: 'flex between' }, [
    h('h2', { style: 'margin:0;' }, 'Baskets'),
    canManage
      ? h('button', { class: 'btn secondary', onClick: () => openCreateBasket(root, company.id) }, '+ New Basket')
      : null,
  ]));
  mount.appendChild(h('div', { class: 'muted', style: 'font-size:13px;margin-top:4px;' },
    'Group related tasks together. Filter the task list by basket from the Tasks page.'));

  let baskets = [];
  try {
    const { data, error } = await sb.from('baskets')
      .select('id, name, color, notes').eq('company_id', company.id).order('name');
    if (error) throw error;
    baskets = data || [];
  } catch (e) {
    mount.appendChild(h('div', { class: 'alert error', style: 'margin-top:10px;' }, 'Failed to load baskets: ' + e.message));
    return;
  }

  if (!baskets.length) {
    mount.appendChild(h('div', { class: 'muted', style: 'margin-top:10px;' }, 'No baskets yet.'));
    return;
  }

  // Task counts per basket (best-effort)
  let counts = {};
  try {
    const { data: rows } = await sb.from('tasks')
      .select('basket_id').eq('company_id', company.id).not('basket_id', 'is', null);
    (rows || []).forEach(r => { counts[r.basket_id] = (counts[r.basket_id] || 0) + 1; });
  } catch {}

  const wrap = h('div', { class: 'basket-list', style: 'margin-top:12px;' },
    baskets.map(b => h('div', { class: 'basket-row' }, [
      h('a', { class: 'basket-chip', style: b.color ? ('border-color:' + b.color + ';color:' + b.color) : '',
        href: '#/tasks?company_id=' + company.id + '&basket_id=' + b.id }, b.name),
      h('span', { class: 'muted', style: 'font-size:12px;' }, (counts[b.id] || 0) + ' task' + ((counts[b.id] || 0) === 1 ? '' : 's')),
      b.notes ? h('span', { class: 'muted', style: 'font-size:12px;' }, '· ' + b.notes) : null,
      canManage
        ? h('button', { class: 'btn secondary small', onClick: async () => {
            if (!confirm('Delete basket "' + b.name + '"? Tasks stay, but lose this grouping.')) return;
            try {
              const { error } = await sb.from('baskets').delete().eq('id', b.id);
              if (error) throw error;
              showOk('Basket deleted'); renderBaskets(root, company, user);
            } catch (e) { showError(e.message); }
          } }, 'Delete')
        : null,
    ])));
  mount.appendChild(wrap);
}

async function openCreateBasket(root, companyId) {
  const name = h('input', { class: 'input', placeholder: 'e.g. Monthly GST, Payroll, Onboarding' });
  const notes = h('input', { class: 'input', placeholder: 'Short description (optional)' });
  const color = h('input', { type: 'color', value: '#0b6cf6', style: 'width:48px;height:38px;padding:2px;' });
  modal('New Basket', h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Name'), name]),
    h('div', { class: 'field' }, [h('label', {}, 'Notes'), notes]),
    h('div', { class: 'field' }, [h('label', {}, 'Color'), color]),
  ]), {
    okLabel: 'Create',
    onOk: async () => {
      if (!name.value.trim()) { showError('Name is required'); return false; }
      try {
        const { error } = await sb.from('baskets').insert({
          company_id: companyId,
          name: name.value.trim(),
          notes: notes.value.trim() || null,
          color: color.value || null,
        });
        if (error) throw error;
        showOk('Basket created');
        renderCompany(root, companyId);
      } catch (e) { showError(e.message); return false; }
    }
  });
}

async function openAddMember(root, companyId, currentMembers) {
  const memberIds = new Set(currentMembers.map(m => m.id));
  const { data: all } = await sb.from('profiles')
    .select('id, full_name, role').eq('is_active', true);
  const candidates = (all || []).filter(u => !memberIds.has(u.id) && u.role !== 'super_admin');
  const select = h('select', {}, [
    h('option', { value: '' }, '— Select user —'),
    ...candidates.map(u => h('option', { value: u.id },
      u.full_name + ' (' + u.role + ')'))
  ]);
  modal('Add Member to Company', h('div', { class: 'field' }, [
    h('label', {}, 'User'), select,
    h('div', { class: 'alert info', style: 'margin-top:10px;' },
      'Admins can add Team Members and Client Executives. Super Admin can add any user.'),
  ]), {
    okLabel: 'Add',
    onOk: async () => {
      if (!select.value) { showError('Pick a user'); return false; }
      try {
        const { error } = await sb.from('company_members')
          .insert({ company_id: companyId, user_id: select.value });
        if (error) throw error;
        showOk('Added');
        renderCompany(root, companyId);
      } catch (e) { showError(e.message); return false; }
    }
  });
}
