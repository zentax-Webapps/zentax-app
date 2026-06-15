import { sb } from '../sb.js';
import { getUser, isOfficeSide } from '../auth.js';
import { h, clear, fmtDate, fmtDay, priorityChip, statusChip, roleBadge, modal, showOk, showError } from '../ui.js';

export async function renderTask(root, id) {
  clear(root);
  root.appendChild(h('div', { class: 'card', id: 'taskTop' }, 'Loading…'));
  root.appendChild(h('div', { class: 'card' }, [
    h('h2', {}, 'Conversation'),
    h('div', { id: 'chat', class: 'chat' }, 'Loading…'),
    h('div', { id: 'composer', style: 'margin-top:10px;' }),
  ]));

  let realtimeChan = null;
  await refresh();

  // Subscribe to realtime: chat + task changes
  realtimeChan = sb.channel('task-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_messages',
        filter: 'task_id=eq.' + id }, () => refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks',
        filter: 'id=eq.' + id }, () => refresh())
    .subscribe();

  // Cleanup when navigating away (mounted element will be removed)
  const cleanup = () => { if (realtimeChan) sb.removeChannel(realtimeChan); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup, { once: true });

  async function refresh() {
    try {
      const [taskRes, msgRes] = await Promise.all([
        sb.from('tasks').select(`
          id, company_id, title, details, priority, due_date, status,
          close_requested_by, close_requested_at, closed_at, created_at, updated_at,
          created_by, assigned_to,
          companies(id, name),
          creator:profiles!tasks_created_by_fkey(id, full_name, role, email),
          assignee:profiles!tasks_assigned_to_fkey(id, full_name, role, email)
        `).eq('id', id).single(),
        sb.from('task_messages').select(`
          id, body, created_at, user_id, profiles:profiles!task_messages_user_id_fkey(full_name, role)
        `).eq('task_id', id).order('id', { ascending: true }),
      ]);
      if (taskRes.error) throw taskRes.error;
      if (msgRes.error)  throw msgRes.error;
      render({
        task: taskRes.data,
        creator: taskRes.data.creator,
        assignee: taskRes.data.assignee,
        company: taskRes.data.companies,
        messages: msgRes.data || [],
      });
    } catch (e) {
      root.querySelector('#taskTop').innerHTML = '';
      root.querySelector('#taskTop').appendChild(h('div', { class: 'alert error' }, 'Failed: ' + e.message));
    }
  }

  function render({ task, creator, assignee, company, messages }) {
    const user = getUser();
    const top = root.querySelector('#taskTop');
    top.innerHTML = '';

    top.appendChild(h('div', { class: 'flex between' }, [
      h('h2', { style: 'margin:0;' }, task.title),
      h('div', {}, statusChip(task.status)),
    ]));
    top.appendChild(h('div', { class: 'flex', style: 'margin-top:6px;' }, [
      priorityChip(task.priority),
      h('span', { class: 'muted' }, '· Company: '),
      h('a', { href: '#/companies/' + company.id }, company.name),
      task.due_date ? h('span', { class: 'muted' }, ' · Due: ' + fmtDay(task.due_date)) : null,
    ]));
    if (task.details) top.appendChild(h('p', { style: 'white-space:pre-wrap;margin:12px 0 0;' }, task.details));

    top.appendChild(h('hr', { class: 'sep' }));
    top.appendChild(h('div', { class: 'kv' }, [
      h('div', { class: 'k' }, 'Created by'),
      h('div', {}, [creator.full_name + ' ', roleBadge(creator.role)]),
      h('div', { class: 'k' }, 'Assigned to'),
      h('div', {}, [assignee.full_name + ' ', roleBadge(assignee.role)]),
      h('div', { class: 'k' }, 'Created'),
      h('div', {}, fmtDate(task.created_at)),
      h('div', { class: 'k' }, 'Updated'),
      h('div', {}, fmtDate(task.updated_at)),
      task.closed_at ? h('div', { class: 'k' }, 'Closed') : null,
      task.closed_at ? h('div', {}, fmtDate(task.closed_at)) : null,
    ]));

    const actions = h('div', { class: 'actions', style: 'margin-top:12px;' });
    if (task.status !== 'closed') {
      if (task.status !== 'close_requested') {
        actions.appendChild(h('button', { class: 'btn', onClick: () => setStatus('close_requested') }, 'Request Close'));
      } else {
        const requesterRole =
          task.close_requested_by === creator.id ? creator.role :
          task.close_requested_by === assignee.id ? assignee.role : null;
        const reqOffice = ['super_admin','admin','team_member'].includes(requesterRole);
        const userOffice = isOfficeSide(user.role);
        const canRespond = (reqOffice !== userOffice) && task.close_requested_by !== user.id;
        actions.appendChild(h('div', { class: 'alert warn' },
          'Close requested. Waiting for the ' + (reqOffice ? 'client' : 'office') + ' side to accept.'));
        if (canRespond) {
          actions.appendChild(h('button', { class: 'btn success', onClick: () => setStatus('closed') }, 'Accept Close'));
          actions.appendChild(h('button', { class: 'btn secondary', onClick: () => setStatus('open') }, 'Reject (Reopen)'));
        }
      }

      if (['super_admin','admin','team_member'].includes(user.role) ||
          user.id === task.created_by || user.id === task.assigned_to) {
        actions.appendChild(h('button', { class: 'btn secondary',
          onClick: () => openEdit(task, company.id) }, 'Edit'));
      }
      if (task.status === 'open') {
        actions.appendChild(h('button', { class: 'btn secondary',
          onClick: () => setStatus('in_progress') }, 'Mark In Progress'));
      } else if (task.status === 'in_progress') {
        actions.appendChild(h('button', { class: 'btn secondary',
          onClick: () => setStatus('open') }, 'Move back to Open'));
      }
    }
    top.appendChild(actions);

    const chat = root.querySelector('#chat');
    chat.innerHTML = '';
    if (!messages.length) chat.appendChild(h('div', { class: 'muted', style: 'padding:10px;' }, 'No messages yet. Start the conversation.'));
    messages.forEach(m => {
      chat.appendChild(h('div', { class: 'msg' + (m.user_id === user.id ? ' mine' : '') }, [
        h('div', { class: 'meta' }, (m.profiles?.full_name || '') + ' · ' + fmtDate(m.created_at)),
        h('div', { class: 'body' }, m.body),
      ]));
    });
    chat.scrollTop = chat.scrollHeight;

    const composer = root.querySelector('#composer');
    composer.innerHTML = '';
    if (task.status !== 'closed') {
      const input = h('textarea', { class: 'input', placeholder: 'Type a message…', rows: 2 });
      const send = h('button', { class: 'btn', onClick: async () => {
        if (!input.value.trim()) return;
        send.disabled = true;
        try {
          const { error } = await sb.from('task_messages').insert({
            task_id: id, body: input.value.trim(), user_id: user.id,
          });
          if (error) throw error;
          input.value = '';
          // Realtime will refresh; do one immediate refresh as fallback.
          await refresh();
        } catch (e) { showError(e.message); }
        finally { send.disabled = false; }
      } }, 'Send');
      composer.appendChild(h('div', { class: 'flex' }, [
        h('div', { style: 'flex:1;' }, input),
        send,
      ]));
    } else {
      composer.appendChild(h('div', { class: 'muted' }, 'Task is closed.'));
    }

    async function setStatus(newStatus) {
      try {
        const { error } = await sb.from('tasks').update({ status: newStatus }).eq('id', task.id);
        if (error) throw error;
        showOk('Done'); refresh();
      } catch (e) { showError(e.message); }
    }
  }

  async function openEdit(task, companyId) {
    const { data: rows } = await sb.from('company_members')
      .select('user_id, profiles:profiles!company_members_user_id_fkey(id, full_name, role)')
      .eq('company_id', companyId);
    const members = (rows || []).map(r => r.profiles).filter(Boolean);

    const title = h('input', { class: 'input', value: task.title });
    const details = h('textarea', { class: 'input' }, task.details || '');
    const priority = h('select', {}, ['red','orange','yellow','green'].map(p =>
      h('option', { value: p, selected: p === task.priority }, p.charAt(0).toUpperCase() + p.slice(1))));
    const due = h('input', { class: 'input', type: 'date',
      value: task.due_date ? task.due_date.slice(0,10) : '' });
    const assigneeSel = h('select', {},
      members.map(m => h('option', { value: m.id, selected: m.id === task.assigned_to },
        m.full_name + ' (' + m.role.replace('_',' ') + ')')));

    modal('Edit Task', h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Title'), title]),
      h('div', { class: 'field' }, [h('label', {}, 'Details'), details]),
      h('div', { class: 'row' }, [
        h('div', { class: 'field' }, [h('label', {}, 'Priority'), priority]),
        h('div', { class: 'field' }, [h('label', {}, 'Due date'), due]),
      ]),
      h('div', { class: 'field' }, [h('label', {}, 'Assigned to'), assigneeSel]),
    ]), {
      onOk: async () => {
        try {
          const { error } = await sb.from('tasks').update({
            title: title.value.trim(),
            details: details.value || null,
            priority: priority.value,
            due_date: due.value || null,
            assigned_to: assigneeSel.value,
          }).eq('id', task.id);
          if (error) throw error;
          showOk('Updated');
          await refresh();
        } catch (e) { showError(e.message); return false; }
      }
    });
  }
}
