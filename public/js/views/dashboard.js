import { sb } from '../sb.js';
import { getUser } from '../auth.js';
import { h, clear, fmtDay, priorityChip, statusChip } from '../ui.js';

export async function renderDashboard(root) {
  const user = getUser();
  clear(root);

  root.appendChild(h('div', { class: 'card' }, [
    h('h2', {}, 'Hello, ' + user.full_name.split(' ')[0]),
    h('div', { class: 'muted' },
      user.role === 'client_owner'
        ? 'Need an executive on your side? Ask your Zentax account manager to create one for your team — they\'ll be added to your company by the Super Admin.'
        : 'Your tasks and companies, all in one place.'),
  ]));

  const counters = h('div', { class: 'card' }, [h('h2', {}, 'Your queue'), h('div', { class: 'grid', id: 'cts' })]);
  root.appendChild(counters);
  const recent = h('div', { class: 'card' }, [
    h('h2', {}, 'Recent tasks'),
    h('div', { id: 'recent' }, 'Loading…')
  ]);
  root.appendChild(recent);

  root.appendChild(h('div', { class: 'card' }, [
    h('h2', {}, 'Quick links'),
    h('div', { class: 'actions' }, [
      h('a', { class: 'btn', href: '#/tasks?mine=1' }, 'My tasks'),
      ['client_owner','client_executive'].includes(user.role)
        ? null
        : h('a', { class: 'btn secondary', href: '#/companies' }, 'Companies'),
      (user.role === 'super_admin' || user.role === 'admin')
        ? h('a', { class: 'btn secondary', href: '#/users' }, 'Users') : null,
      h('a', { class: 'btn secondary', href: '#/account' }, 'Account'),
    ])
  ]));

  try {
    // Tasks assigned to me OR created by me
    const { data: tasks, error } = await sb.from('tasks')
      .select('id, title, priority, due_date, status, company_id, created_by, assigned_to, companies(name)')
      .or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const counts = {
      open: tasks.filter(t => t.status === 'open').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      close_requested: tasks.filter(t => t.status === 'close_requested').length,
      closed: tasks.filter(t => t.status === 'closed').length,
    };
    const cts = root.querySelector('#cts');
    [['Open', counts.open, 'open'], ['In Progress', counts.in_progress, 'in_progress'],
     ['Awaiting Close', counts.close_requested, 'close_requested'], ['Closed', counts.closed, 'closed']
    ].forEach(([label, val, cls]) => {
      cts.appendChild(h('a', { class: 'card', style: 'padding:14px;margin:0;display:block;text-decoration:none;color:inherit;',
        href: '#/tasks?mine=1&status=' + cls }, [
        h('div', { class: 'muted', style: 'font-size:12px;' }, label),
        h('div', { style: 'font-size:24px;font-weight:700;' }, String(val)),
        statusChip(cls),
      ]));
    });

    const recentMount = root.querySelector('#recent');
    recentMount.innerHTML = '';
    const list = tasks.slice(0, 8);
    if (!list.length) { recentMount.appendChild(h('div', { class: 'muted' }, 'No tasks yet.')); return; }
    const table = h('table', { class: 'table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', {}, 'Title'), h('th', {}, 'Company'), h('th', {}, 'Priority'),
        h('th', {}, 'Due'), h('th', {}, 'Status'),
      ])),
      h('tbody', {}, list.map(t => h('tr', { style: 'cursor:pointer;',
        onClick: () => location.hash = '#/tasks/' + t.id }, [
          h('td', {}, t.title),
          h('td', {}, t.companies?.name || ''),
          h('td', {}, priorityChip(t.priority)),
          h('td', {}, fmtDay(t.due_date)),
          h('td', {}, statusChip(t.status)),
      ])))
    ]);
    recentMount.appendChild(table);
  } catch (e) {
    root.querySelector('#recent').textContent = 'Failed to load: ' + e.message;
  }
}
