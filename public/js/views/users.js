import { sb, invokeFn } from '../sb.js';
import { getUser, ROLE_LABELS } from '../auth.js';
import { h, clear, modal, roleBadge, showOk, showError } from '../ui.js';

export async function renderUsers(root) {
  const user = getUser();
  clear(root);

  root.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'flex between' }, [
      h('h2', { style: 'margin:0;' }, 'Users'),
      user.role === 'super_admin'
        ? h('button', { class: 'btn', onClick: () => openCreate(root) }, '+ New User')
        : null,
    ]),
    h('div', { id: 'list', style: 'margin-top:14px;' }, 'Loading…'),
  ]));

  try {
    const { data, error } = await sb.from('profiles')
      .select('id, email, full_name, role, is_active')
      .order('role').order('full_name');
    if (error) throw error;
    const list = root.querySelector('#list');
    list.innerHTML = '';
    if (!data.length) { list.appendChild(h('div', { class: 'empty' }, 'No users yet.')); return; }
    const tbl = h('table', { class: 'table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'),
        h('th', {}, 'Status'), h('th', {}, '')
      ])),
      h('tbody', {}, data.map(u => h('tr', {}, [
        h('td', {}, u.full_name),
        h('td', {}, u.email),
        h('td', {}, roleBadge(u.role)),
        h('td', {}, u.is_active ? 'Active' : 'Inactive'),
        h('td', {}, user.role === 'super_admin' ? h('div', { class: 'actions' }, [
          h('button', { class: 'btn secondary', onClick: () => openReset(u) }, 'Reset Password'),
          h('button', { class: 'btn secondary', onClick: async () => {
            try {
              await invokeFn('admin-set-active', { user_id: u.id, active: !u.is_active });
              showOk('Updated'); renderUsers(root);
            } catch (e) { showError(e.message); }
          } }, u.is_active ? 'Deactivate' : 'Activate'),
        ]) : null)
      ])))
    ]);
    list.appendChild(tbl);
  } catch (e) {
    root.querySelector('#list').textContent = 'Failed: ' + e.message;
  }
}

function openCreate(root) {
  const name = h('input', { class: 'input', placeholder: 'Full name' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'user@example.com' });
  const phone = h('input', { class: 'input', placeholder: 'Phone (optional)' });
  const password = h('input', { class: 'input', type: 'text', placeholder: 'Initial password (min 8 chars)' });
  const role = h('select', {}, Object.entries(ROLE_LABELS).map(([k,v]) =>
    h('option', { value: k, selected: k === 'team_member' }, v)));

  modal('New User', h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Full name'), name]),
    h('div', { class: 'field' }, [h('label', {}, 'Email'), email]),
    h('div', { class: 'field' }, [h('label', {}, 'Phone'), phone]),
    h('div', { class: 'field' }, [h('label', {}, 'Role'), role]),
    h('div', { class: 'field' }, [
      h('label', {}, 'Initial password'), password,
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' },
        'The password is sent to Supabase Auth and hashed there — never stored in plaintext. Share it with the user securely; they can change it after first login.')
    ]),
  ]), {
    okLabel: 'Create',
    onOk: async () => {
      try {
        await invokeFn('admin-create-user', {
          full_name: name.value.trim(),
          email: email.value.trim(),
          phone: phone.value.trim(),
          password: password.value,
          role: role.value,
        });
        showOk('User created');
        renderUsers(root);
      } catch (e) { showError(e.message); return false; }
    }
  });
}

function openReset(u) {
  const pwd = h('input', { class: 'input', type: 'text', placeholder: 'New password (min 8 chars)' });
  modal('Reset password for ' + u.full_name, h('div', { class: 'field' }, [
    h('label', {}, 'New password'), pwd,
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px;' },
      'Share with the user via a secure channel.'),
  ]), {
    okLabel: 'Reset',
    onOk: async () => {
      try {
        await invokeFn('admin-reset-password', {
          user_id: u.id, new_password: pwd.value,
        });
        showOk('Password reset');
      } catch (e) { showError(e.message); return false; }
    }
  });
}
