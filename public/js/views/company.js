import { sb } from '../sb.js';
import { getUser } from '../auth.js';
import { h, clear, modal, roleBadge, showOk, showError } from '../ui.js';
import { taskTable } from './tasks.js';

export async function renderCompany(root, id) {
  const user = getUser();
  clear(root);
  root.appendChild(h('div', { class: 'card', id: 'co' }, 'Loading…'));
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

  try {
    const { data: tasks, error } = await sb.from('tasks')
      .select('id, title, priority, due_date, status, company_id, companies(name), assigned_profile:profiles!tasks_assigned_to_fkey(full_name)')
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
      assigned_to_name: t.assigned_profile?.full_name,
    }))));
  } catch (e) {
    root.querySelector('#tasks').textContent = 'Failed: ' + e.message;
  }
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
