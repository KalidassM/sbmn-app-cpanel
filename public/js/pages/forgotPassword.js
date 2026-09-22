window.ForgotPasswordPage = {
  render(container) {
    this.username = '';
    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h1>Reset Your Password</h1>
          <p class="sub">We'll send a one-time code to your WhatsApp number on file</p>
          <div id="fpAlert"></div>

          <form id="fpRequestForm">
            <div class="field">
              <label>Username</label>
              <input type="text" id="fp_username" required autofocus />
            </div>
            <button type="submit" style="width:100%">Send Reset Code</button>
          </form>

          <form id="fpResetForm" style="display:none;">
            <div class="field">
              <label>Reset Code</label>
              <input type="text" id="fp_code" inputmode="numeric" maxlength="6" required autofocus />
            </div>
            <div class="field">
              <label>New Password</label>
              <input type="password" id="fp_new" required minlength="6" />
            </div>
            <div class="field">
              <label>Confirm New Password</label>
              <input type="password" id="fp_confirm" required minlength="6" />
            </div>
            <button type="submit" style="width:100%">Reset Password</button>
            <p class="text-muted" style="text-align:center;margin-top:12px;font-size:0.85rem;">
              <a href="#" id="fpResendLink">Didn't get a code? Send again</a>
            </p>
          </form>

          <p class="text-muted" style="text-align:center;margin-top:16px;font-size:0.85rem;">
            <a href="#/login">Back to login</a>
          </p>
        </div>
      </div>
    `;

    const alertBox = document.getElementById('fpAlert');
    const requestForm = document.getElementById('fpRequestForm');
    const resetForm = document.getElementById('fpResetForm');

    requestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('fp_username').value.trim();
      alertBox.innerHTML = '';
      const btn = requestForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await Api.post('/auth/forgot-password', { username });
        this.username = username;
        alertBox.innerHTML = `<div class="alert success">A reset code has been sent to your WhatsApp number.</div>`;
        requestForm.style.display = 'none';
        resetForm.style.display = '';
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('fp_code').value.trim();
      const newPassword = document.getElementById('fp_new').value;
      const confirmPassword = document.getElementById('fp_confirm').value;
      alertBox.innerHTML = '';
      if (newPassword !== confirmPassword) {
        alertBox.innerHTML = `<div class="alert error">New passwords do not match.</div>`;
        return;
      }
      const btn = resetForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const result = await Api.post('/auth/reset-password', { username: this.username, code, newPassword });
        Api.setSession(result.token, result.user);
        window.location.hash = '#/dashboard';
        window.router();
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('fpResendLink').addEventListener('click', async (e) => {
      e.preventDefault();
      alertBox.innerHTML = '';
      try {
        await Api.post('/auth/forgot-password', { username: this.username });
        alertBox.innerHTML = `<div class="alert success">A new reset code has been sent.</div>`;
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      }
    });
  },
};
