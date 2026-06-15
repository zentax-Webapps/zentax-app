import { sb } from '../sb.js';
import { getUser } from '../auth.js';
import { h, clear, modal, showOk, showError } from '../ui.js';

export async function renderCompanies(root) {
  const user = getUser();
  clear(root);
  const card = h('div', { class: 'card' }, [
    h('div', { class: 'flex between' }, [
      h('h2', { style: 'margin:0;' }, 'Companies'),
      user.role === 'super_admin'
        ? h('button', { class: 'btn', onClick: () => openCreate(root) }, '+ New Company')
        : null,
    ]),
    h('div', { id: 'list', style: 'margin-top:14px;' }, 'Loading…'),
  ]);
  root.appendChild(card);

  try {
    const { data, error } = await sb.from('companies')
      .select('id, name, notes')
      .order('name', { ascending: true });
    if (error) throw error;
    const list = root.querySelector('#list');
    list.innerHTML = '';
    if (!data.length) { list.appendChild(h('div', { class: 'empty' }, 'No companies yet.')); return; }
    const grid = h('div', { class: 'grid' });
    data.forEach(c => {
      grid.appendChild(h('a', { class: 'card',
        style: 'margin:0;display:block;color:inherit;text-decoration:none;',
        href: '#/companies/' + c.id }, [
        h('h2', { style: 'margin:0 0 6px;' }, c.name),
        h('div', { class: 'muted', style: 'font-size:13px;' },
          c.notes || 'Open to view team, clients and tasks.')
      ]));
    });
    list.appendChild(grid);
  } catch (e) {
    root.querySelector('#list').textContent = 'Failed to load: ' + e.message;
  }
}

async function openCreate(root) {
  // Need admin + client_owner users to pick from
  const { data: users } = await sb.from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['admin', 'client_owner'])
    .eq('is_active', true);
  const admins = (users || []).filter(u => u.role === 'admin');
  const owners = (users || []).filter(u => u.role === 'client_owner');

  const name = h('input', { class: 'input', placeholder: 'e.g. Acme Pvt. Ltd.' });
  const notes = h('textarea', { class: 'input', placeholder: 'Notes (optional)' });
  const adminSel = h('select', {}, [
    h('option', { value: '' }, '— Select Admin —'),
    ...admins.map(u => h('option', { value: u.id }, u.full_name + ' (' + u.email + ')'))
  ]);
  const ownerSel = h('select', {}, [
    h('option', { value: '' }, '— Select Client Owner (optional) —'),
    ...owners.map(u => h('option', { value: u.id }, u.full_name + ' (' + u.email + ')'))
  ]);

  modal('New Company', h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Name'), name]),
    h('div', { class: 'field' }, [h('label', {}, 'Notes'), notes]),
    h('div', { class: 'field' }, [h('label', {}, 'Assign Admin'), adminSel]),
    h('div', { class: 'field' }, [h('label', {}, 'Assign Client Owner'), ownerSel]),
    h('div', { class: 'alert info' },
      'Create the Admin and Client Owner users first under Users → New, then assign them here.'),
  ]), {
    okLabel: 'Create',
    onOk: async () => {
      if (!name.value.trim()) { showError('Name is required'); return false; }
      try {
        const { data: created, error } = await sb.from('companies')
          .insert({ name: name.value.trim(), notes: notes.value || null })
          .select('id').single();
        if (error) throw error;
        const cid = created.id;
        const members = [];
        if (adminSel.value) members.push({ company_id: cid, user_id: adminSel.value });
        if (ownerSel.value) members.push({ company_id: cid, user_id: ownerSel.value });
        if (members.length) {
          const { error: e2 } = await sb.from('company_members').insert(members);
          if (e2) throw e2;
        }
        showOk('Company created');
        renderCompanies(root);
      } catch (e) { showError(e.message); return false; }
    }
  });
}
