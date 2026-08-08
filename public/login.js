'use strict';
(function () {
  const form = document.getElementById('login-form');
  const userEl = document.getElementById('username');
  const passEl = document.getElementById('password');
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-submit');
  if (!form) return;

  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '登录失败';
    errEl.classList.remove('hidden');
  }
  function clearError() {
    if (!errEl) return;
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  // 已有会话时直接进首页（避免登录页闪一下）
  fetch('/api/meta', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => {
      if (r.ok) location.replace('/');
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const username = (userEl && userEl.value) || '';
    const password = (passEl && passEl.value) || '';
    if (!username || !password) {
      showError('请输入用户名和密码');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '登录中…';
    }
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.message || data.error || '用户名或密码错误');
        if (passEl) {
          passEl.focus();
          passEl.select();
        }
        return;
      }
      // 成功：Cookie 已由 Set-Cookie 写入，跳转首页
      const next = new URLSearchParams(location.search).get('next');
      const safeNext =
        next &&
        next.charAt(0) === '/' &&
        next.charAt(1) !== '/' &&
        next.indexOf('://') === -1
          ? next
          : '/';
      location.replace(safeNext);
    } catch (err) {
      showError((err && err.message) || '网络错误');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '登录';
      }
    }
  });

  try {
    if (userEl && !userEl.value) userEl.focus();
    else if (passEl) passEl.focus();
  } catch {
    /* ignore */
  }
})();
