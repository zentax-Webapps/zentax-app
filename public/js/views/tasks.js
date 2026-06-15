import { sb } from '../sb.js';
import { getUser } from '../auth.js';
import { h, clear, fmtDay, priorityChip, statusChip, modal, showOk, showError } from '../ui.js';

export async function renderTasks(root, query = {}) {
  const user = getUser();
  clear(root);

  // Clients are hard-scoped to the companies they're assigned to. We fetch
  // their own memberships (filtered by user_id) so cross-company tasks never
  // show in the UI - this holds even if a server policy were misconfigured.
  const isClient = ['client_owner', 'client_executive'].includes(user.role);
  let companies = [];
  if (isClient) {
    const { data: cm = [] } = await sb.from('company_members')
      .select('companies(id, name)').eq('user_id', user.id);
    companies = (cm || []).map(r => r.companies).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const { data = [] } = await sb.from('companies').select('id, name').order('name');
    companies = data || [];
  }
  const myCompanyIds = companies.map(c => c.id);

  // Baskets only make sense within a single company, so the basket filter
  // appears once a company is chosen.
  let baskets = [];
  if (query.company_id) {
    const { data: bk = [] } = await sb.from('baskets')
      .select('id, name').eq('company_id', Number(query.company_id)).order('name');
    baskets = bk || [];
  }

  const filterCompany = h('select', {}, [
    h('option', { value: '' }, isClient ? 'All my companies' : 'All companies'),
    ...companies.map(c => h('option', { value: c.id, selected: String(c.id) === String(query.company_id) }, c.name))
  ]);
  const STATUS_LABELS = { proposed: 'awaiting acceptance', open: 'open',
    in_progress: 'in progress', close_requested: 'awaiting close', closed: 'closed' };
  const filterStatus = h('select', {}, [
    h('option', { value: '' }, 'All statuses'),
    ['proposed','open','in_progress','close_requested','closed'].map(s =>
      h('option', { value: s, selected: s === query.status }, STATUS_LABELS[s])),
  ].flat());
  const filterBasket = query.company_id ? h('select', {}, [
    h('option', { value: '' }, 'All baskets'),
    h('option', { value: 'none', selected: query.basket_id === 'none' }, '— No basket —'),
    ...baskets.map(b => h('option', { value: b.id, selected: String(b.id) === String(query.basket_id) }, b.name))
  ]) : null;
  const mine = h('label', { class: 'flex', style: 'gap:6px;' }, [
    h('input', { type: 'checkbox', checked: query.mine === '1',
      onChange: (e) => updateQuery({ mine: e.target.checked ? '1' : '' }) }),
    'Mine only'
  ]);
  // Changing the company resets the basket filter (baskets are company-scoped).
  filterCompany.addEventListener('change', () => updateQuery({ company_id: filterCompany.value, basket_id: '' }));
  filterStatus.addEventListener('change', () => updateQuery({ status: filterStatus.value }));
  filterBasket?.addEventListener('change', () => updateQuery({ basket_id: filterBasket.value }));

  const newBtn = h('button', { class: 'btn',
    onClick: () => isClient
      ? openProposeTask(root, companies)
      : openCreateTask(root, companies, query.company_id ? Number(query.company_id) : null)
  }, isClient ? '+ Request Task' : '+ New Task');

  if (isClient) {
    // Clean, minimal client view: just the task list, ordered by due date.
    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'flex between' }, [
        h('h2', { style: 'margin:0;' }, 'My Tasks'),
        newBtn,
      ]),
      h('div', { class: 'muted', style: 'font-size:13px;margin-top:4px;' },
        'Tap a task to open the conversation. New requests are reviewed by the office team before going live.'),
    ]));
  } else {
    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'flex between' }, [
        h('h2', { style: 'margin:0;' }, 'Tasks'),
        newBtn,
      ]),
      h('div', { class: 'flex', style: 'margin-top:10px;' }, [filterCompany, filterStatus, filterBasket, mine])
    ]));
  }

  const list = h('div', { class: 'card', id: 'list' }, 'Loading…');
  root.appendChild(list);

  if (query.new === '1') openCreateTask(root, companies, query.company_id ? Number(query.company_id) : null);

  try {
    let q = sb.from('tasks')
      .select('id, title, priority, due_date, status, company_id, created_by, assigned_to, basket_id, companies(name), baskets(name), assigned_profile:profiles!tasks_assigned_to_fkey(full_name)')
      .order('created_at', { ascending: false });
    // Clients: never query beyond their assigned companies.
    if (isClient) q = q.in('company_id', myCompanyIds.length ? myCompanyIds : [-1]);
    if (query.company_id) q = q.eq('company_id', Number(query.company_id));
    if (query.status)    q = q.eq('status', query.status);
    if (query.basket_id === 'none')      q = q.is('basket_id', null);
    else if (query.basket_id)            q = q.eq('basket_id', Number(query.basket_id));
    if (query.mine === '1') q = q.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
    const { data, error } = await q;
    if (error) throw error;
    list.innerHTML = '';
    if (!data.length) {
      list.appendChild(h('div', { class: 'empty' }, isClient
        ? 'You have no tasks yet. Tap "Request Task" to ask the office team for something.'
        : 'No tasks match.'));
      return;
    }
    // Active work first (by due date), Closed sinks to the bottom.
    const rows = sortTasks(data.map(t => ({
      ...t,
      company_name: t.companies?.name,
      basket_name: t.baskets?.name,
      assigned_to_name: t.assigned_profile?.full_name,
    })));
    list.appendChild(isClient ? clientTaskList(rows) : taskTable(rows));
  } catch (e) {
    list.textContent = 'Failed: ' + e.message;
  }
}

export function taskTable(tasks) {
  return h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, 'Title'), h('th', {}, 'Company'), h('th', {}, 'Basket'), h('th', {}, 'Assigned to'),
      h('th', {}, 'Priority'), h('th', {}, 'Due'), h('th', {}, 'Status'),
    ])),
    h('tbody', {}, tasks.map(t => h('tr', { style: 'cursor:pointer;',
      onClick: () => location.hash = '#/tasks/' + t.id }, [
        h('td', {}, t.title),
        h('td', {}, t.company_name || ''),
        h('td', {}, t.basket_name ? h('span', { class: 'basket-chip' }, t.basket_name) : ''),
        h('td', {}, t.assigned_to_name || ''),
        h('td', {}, priorityChip(t.priority)),
        h('td', {}, fmtDay(t.due_date)),
        h('td', {}, statusChip(t.status)),
    ])))
  ]);
}

// Display order: active work first (requests on top, then open/in-progress/
// awaiting-close), Closed last. Within a group, soonest due date first.
const STATUS_RANK = { proposed: 0, open: 1, in_progress: 2, close_requested: 3, closed: 9 };
export function sortTasks(list) {
  return list.slice().sort((a, b) => {
    const r = (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5);
    if (r) return r;
    const ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.id || 0) - (a.id || 0);
  });
}

// Purpose-built, uncluttered list for clients: what it is, who's handling it,
// when it's due, and where it stands. No internal company/basket columns.
export function clientTaskList(tasks) {
  return h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, 'Task'), h('th', {}, 'Handled by'), h('th', {}, 'Due'), h('th', {}, 'Status'),
    ])),
    h('tbody', {}, tasks.map(t => h('tr', { style: 'cursor:pointer;',
      onClick: () => location.hash = '#/tasks/' + t.id }, [
        h('td', {}, [
          priorityChip(t.priority),
          h('div', { style: 'margin-top:2px;' }, t.title),
        ]),
        h('td', {}, t.assigned_to_name || '—'),
        h('td', {}, fmtDay(t.due_date)),
        h('td', {}, statusChip(t.status)),
    ])))
  ]);
}

function updateQuery(patch) {
  const cur = parseHashQuery();
  const next = { ...cur, ...patch };
  Object.keys(next).forEach(k => { if (!next[k]) delete next[k]; });
  const qs = Object.entries(next).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  location.hash = '#/tasks' + (qs ? '?' + qs : '');
}
function parseHashQuery() {
  const raw = (location.hash || '').split('?')[1] || '';
  const out = {};
  raw.split('&').forEach(kv => { if (!kv) return; const [k,v] = kv.split('='); out[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return out;
}

// Client-side task request. Creates a 'proposed' task that the office must
// accept before it goes live. Assigned to an office member of the company.
async function openProposeTask(root, companies) {
  const user = getUser();
  if (!companies.length) { showError('You are not assigned to a company yet.'); return; }

  const title = h('input', { class: 'input', placeholder: 'What do you need done?' });
  const details = h('textarea', { class: 'input', placeholder: 'Add any details, context or references…' });
  const priority = h('select', {}, ['red','orange','yellow','green'].map(p =>
    h('option', { value: p, selected: p === 'yellow' }, p.charAt(0).toUpperCase() + p.slice(1))));
  const due = h('input', { class: 'input', type: 'date' });
  const companySel = h('select', {},
    companies.map(c => h('option', { value: c.id }, c.name)));
  const officeSel = h('select', {}, [h('option', { value: '' }, '— Loading team… —')]);

  async function refreshOffice() {
    const cid = Number(companySel.value);
    officeSel.innerHTML = '';
    const { data } = await sb.from('company_members')
      .select('profiles:profiles!company_members_user_id_fkey(id, full_name, role)')
      .eq('company_id', cid);
    const office = (data || []).map(r => r.profiles).filter(Boolean)
      .filter(m => ['super_admin','admin','team_member'].includes(m.role));
    if (!office.length) {
      officeSel.appendChild(h('option', { value: '' }, '— No office team yet —'));
      return;
    }
    office.forEach((m, i) => officeSel.appendChild(
      h('option', { value: m.id, selected: i === 0 },
        m.full_name + ' (' + m.role.replace('_',' ') + ')')));
  }
  companySel.addEventListener('change', refreshOffice);
  await refreshOffice();

  modal('Request a Task', h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Title'), title]),
    h('div', { class: 'field' }, [h('label', {}, 'Details'), details]),
    h('div', { class: 'row' }, [
      h('div', { class: 'field' }, [h('label', {}, 'Priority'), priority]),
      h('div', { class: 'field' }, [h('label', {}, 'Needed by'), due]),
    ]),
    companies.length > 1
      ? h('div', { class: 'field' }, [h('label', {}, 'Company'), companySel]) : null,
    h('div', { class: 'field' }, [h('label', {}, 'Send to'), officeSel]),
    h('div', { class: 'alert info' },
      'This is sent as a request. The office team will review and accept it before it becomes an active task.'),
  ]), {
    okLabel: 'Send Request',
    onOk: async () => {
      if (!title.value.trim()) { showError('Title is required'); return false; }
      if (!officeSel.value)    { showError('No office team member to send this to'); return false; }
      try {
        const { data, error } = await sb.from('tasks').insert({
          company_id: Number(companySel.value),
          title: title.value.trim(),
          details: details.value || null,
          priority: priority.value,
          due_date: due.value || null,
          assigned_to: officeSel.value,
          created_by: user.id,
          status: 'proposed',
        }).select('id').single();
        if (error) throw error;
        showOk('Request sent to the office team');
        location.hash = '#/tasks/' + data.id;
      } catch (e) { showError(e.message); return false; }
    }
  });
}

async function openCreateTask(root, companies, defaultCompanyId) {
  const user = getUser();
  const title = h('input', { class: 'input', placeholder: 'Short task title' });
  const details = h('textarea', { class: 'input', placeholder: 'Details, links, references…' });
  const priority = h('select', {}, ['red','orange','yellow','green'].map(p =>
    h('option', { value: p, selected: p === 'yellow' }, p.charAt(0).toUpperCase() + p.slice(1))));
  const due = h('input', { class: 'input', type: 'date' });
  const companySel = h('select', {}, [
    h('option', { value: '' }, '— Pick a company —'),
    ...companies.map(c => h('option', { value: c.id, selected: c.id === defaultCompanyId }, c.name))
  ]);
  const assigneeSel = h('select', {}, [h('option', { value: '' }, '— Pick a company first —')]);
  const basketSel = h('select', {}, [h('option', { value: '' }, '— No basket —')]);

  async function refreshAssignees() {
    const cid = Number(companySel.value);
    assigneeSel.innerHTML = '';
    if (!cid) {
      assigneeSel.appendChild(h('option', { value: '' }, '— Pick a company first —'));
      return;
    }
    const { data, error } = await sb.from('company_members')
      .select('user_id, profiles:profiles!company_members_user_id_fkey(id, full_name, role)')
      .eq('company_id', cid);
    if (error) { showError(error.message); return; }
    const members = (data || []).map(r => r.profiles).filter(Boolean);
    assigneeSel.appendChild(h('option', { value: '' }, '— Pick assignee —'));
    members.forEach(m => assigneeSel.appendChild(
      h('option', { value: m.id, selected: m.id === user.id },
        m.full_name + ' (' + (m.role || '').replace('_',' ') + ')')));
  }
  async function refreshBaskets() {
    const cid = Number(companySel.value);
    basketSel.innerHTML = '';
    basketSel.appendChild(h('option', { value: '' }, '— No basket —'));
    if (!cid) return;
    const { data } = await sb.from('baskets')
      .select('id, name').eq('company_id', cid).order('name');
    (data || []).forEach(b => basketSel.appendChild(h('option', { value: b.id }, b.name)));
  }
  companySel.addEventListener('change', () => { refreshAssignees(); refreshBaskets(); });
  if (defaultCompanyId) { refreshAssignees(); refreshBaskets(); }

  modal('New Task', h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Title'), title]),
    h('div', { class: 'field' }, [h('label', {}, 'Details'), details]),
    h('div', { class: 'row' }, [
      h('div', { class: 'field' }, [h('label', {}, 'Priority'), priority]),
      h('div', { class: 'field' }, [h('label', {}, 'Due date'), due]),
    ]),
    h('div', { class: 'field' }, [h('label', {}, 'Company'), companySel]),
    h('div', { class: 'field' }, [h('label', {}, 'Assigned to'), assigneeSel]),
    h('div', { class: 'field' }, [h('label', {}, 'Basket (optional)'), basketSel]),
  ]), {
    okLabel: 'Create',
    onOk: async () => {
      if (!title.value.trim()) { showError('Title is required'); return false; }
      if (!companySel.value)   { showError('Pick a company'); return false; }
      if (!assigneeSel.value)  { showError('Pick an assignee'); return false; }
      try {
        const { data, error } = await sb.from('tasks').insert({
          company_id: Number(companySel.value),
          title: title.value.trim(),
          details: details.value || null,
          priority: priority.value,
          due_date: due.value || null,
          assigned_to: assigneeSel.value,
          basket_id: basketSel.value ? Number(basketSel.value) : null,
          created_by: user.id,
        }).select('id').single();
        if (error) throw error;
        showOk('Task created');
        location.hash = '#/tasks/' + data.id;
      } catch (e) { showError(e.message); return false; }
    }
  });
}
