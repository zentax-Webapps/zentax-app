import { login } from '../auth.js';
import { h, clear, showError } from '../ui.js';

export function renderLogin(root) {
  clear(root);
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username',
    placeholder: 'you@example.com', required: true });
  const password = h('input', { class: 'input', type: 'password',
    autocomplete: 'current-password', placeholder: 'Your password', required: true });
  const submit = h('button', { class: 'btn full', type: 'submit' }, 'Sign In');

  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await login(email.value.trim(), password.value);
      } catch (err) {
        showError(err.message || 'Login failed');
        submit.disabled = false;
        submit.textContent = 'Sign In';
      }
    }
  }, [
    h('label', { class: 'field' }, [h('label', {}, 'Email'), email]),
    h('label', { class: 'field' }, [h('label', {}, 'Password'), password]),
    submit,
  ]);

  const card = h('div', { class: 'login-card' }, [
    h('div', { class: 'brand' }, [h('span', { class: 'dot' }), h('strong', {}, 'Zentax Work Flow')]),
    h('h1', {}, 'Welcome back'),
    h('p', { class: 'sub' }, 'Sign in to continue. Sessions persist — works installed as an app.'),
    form,
    h('hr', { class: 'sep' }),
    h('p', { class: 'muted', style: 'font-size:12px;margin:0;' },
      'Credentials are issued by your Super Admin. Forgot your password? Ask them to reset it.'),
  ]);

  root.appendChild(h('div', { class: 'login-wrap' }, card));
  setTimeout(() => email.focus(), 50);
}
