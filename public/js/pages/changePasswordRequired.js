window.ChangePasswordRequiredPage = {
  render(container) {
    container.innerHTML = `
      <div class="panel" style="max-width:380px; margin:60px auto;">
        <div class="panel-header"><h3>Change Your Password</h3></div>
        <p class="page-sub" style="margin-top:-8px;">For security, you must set a new password before continuing.</p>
        <div id="cprAlert"></div>
        <form id="cprForm">
          <div class="field">
            <label>Current Password</label>
            <input type="password" id="cpr_current" required autofocus />
          </div>
          <div class="field">
            <label>New Password</label>
            <input type="password" id="cpr_new" required minlength="6" />
          </div>
          <div class="field">
            <label>Confirm New Password</label>
            <input type="password" id="cpr_confirm" required minlength="6" />
          </div>
          <button type="submit" style="width:100%">Set New Password</button>
        </form>
        <p class="text-muted" style="text-align:center;margin-top:16px;font-size:0.85rem;">
          <a href="#" id="cprLogoutLink">Log out instead</a>
        </p>
      </div>
    `;

    document.getElementById('cprForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('cpr_current').value;
      const newPassword = document.getElementById('cpr_new').value;
      const confirmPassword = document.getElementById('cpr_confirm').value;
      const alertBox = document.getElementById('cprAlert');
      alertBox.innerHTML = '';
      if (newPassword !== confirmPassword) {
        alertBox.innerHTML = `<div class="alert error">New passwords do not match.</div>`;
        return;
      }
      try {
        const result = await Api.post('/auth/change-password', { currentPassword, newPassword });
        Api.setSession(result.token, result.user);
        window.location.hash = '#/dashboard';
        window.router();
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      }
    });

    document.getElementById('cprLogoutLink').addEventListener('click', (e) => {
      e.preventDefault();
      Api.clearSession();
      window.location.hash = '#/login';
      window.router();
    });
  },
};
