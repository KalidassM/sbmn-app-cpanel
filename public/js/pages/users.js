window.UsersPage = {
  async render(container) {
    const isSuperAdmin = Api.getUser().role === 'super_admin';
    container.innerHTML = `
      <h1>Login Accounts</h1>
      <p class="page-sub">Manage who can sign in to this portal and their access level</p>
      <div id="alertBox"></div>
      ${
        isSuperAdmin
          ? `<div class="panel" id="bulkUserPanel">
        <div class="panel-header"><h3>Bulk Create Member Accounts</h3></div>
        <p class="text-muted" style="font-size:0.85rem;">
          Creates a login (role: Member, view-only) for every currently active member who doesn't already have one.
          Username = their phone number, initial password = phone number + "@123". They'll be required to set a
          new password the first time they log in. Safe to re-run - members who already have an account are skipped.
        </p>
        <div class="toolbar mt-16"><button type="button" id="bulkCreateUsersBtn">Create Accounts for Active Members</button></div>
        <div id="bulkCreateResult" class="mt-16"></div>
      </div>
      <div class="panel" id="bulkCoreUserPanel">
        <div class="panel-header"><h3>Create Admin Accounts for Core Members</h3></div>
        <p class="text-muted" style="font-size:0.85rem;">
          Creates an 'admin'-role login for every currently active Core Member who doesn't already have one
          (username = phone number, initial password = phone number + "@core"), or upgrades their existing
          login to admin if they already have one. They'll be required to set a new password the first time
          a newly-created account logs in. Safe to re-run.
        </p>
        <div class="toolbar mt-16"><button type="button" id="bulkCreateCoreUsersBtn">Create Accounts for Core Members</button></div>
        <div id="bulkCreateCoreResult" class="mt-16"></div>
      </div>`
          : ''
      }
      <div class="panel" id="formPanel"></div>
      <div class="panel">
        <div class="panel-header"><h3>Accounts</h3></div>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Linked Member</th><th>Password</th><th>Last Login</th><th></th></tr></thead>
          <tbody id="rows"><tr><td colspan="6">Loading…</td></tr></tbody>
        </table>
      </div>
    `;
    this.members = await Api.get('/members');
    this.renderForm(document.getElementById('formPanel'));
    if (isSuperAdmin) {
      document.getElementById('bulkCreateUsersBtn').addEventListener('click', () => this.bulkCreateAccounts());
      document.getElementById('bulkCreateCoreUsersBtn').addEventListener('click', () => this.bulkCreateCoreAccounts());
    }
    await this.loadRows();
  },

  async bulkCreateAccounts() {
    if (!confirm('Create a login account for every active member who doesn\'t already have one? Usernames/passwords will be based on their phone numbers.')) return;
    const btn = document.getElementById('bulkCreateUsersBtn');
    const resultBox = document.getElementById('bulkCreateResult');
    btn.disabled = true;
    try {
      const result = await Api.post('/users/bulk-create-for-members');
      let html = `<div class="alert success">${result.created} account(s) created${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</div>`;
      if (result.createdAccounts.length) {
        html += `
          <table class="mt-16">
            <thead><tr><th>Member</th><th>Username</th></tr></thead>
            <tbody>${result.createdAccounts.map((a) => `<tr><td>${Util.escapeHtml(a.name)}</td><td>${Util.escapeHtml(a.username)}</td></tr>`).join('')}</tbody>
          </table>`;
      }
      if (result.skipped.length) {
        html += `
          <table class="mt-16">
            <thead><tr><th>Member</th><th>Skipped Reason</th></tr></thead>
            <tbody>${result.skipped.map((s) => `<tr><td>${Util.escapeHtml(s.name)}</td><td class="text-muted">${Util.escapeHtml(s.reason)}</td></tr>`).join('')}</tbody>
          </table>`;
      }
      resultBox.innerHTML = html;
      await this.loadRows();
    } catch (err) {
      this.showAlert(err.message);
    } finally {
      btn.disabled = false;
    }
  },

  async bulkCreateCoreAccounts() {
    if (!confirm('Create or upgrade an admin login account for every active Core Member? Usernames/passwords for new accounts will be based on their phone numbers.')) return;
    const btn = document.getElementById('bulkCreateCoreUsersBtn');
    const resultBox = document.getElementById('bulkCreateCoreResult');
    btn.disabled = true;
    try {
      const result = await Api.post('/users/bulk-create-for-core-members');
      let html = `<div class="alert success">${result.created} created, ${result.upgraded} upgraded to admin${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</div>`;
      if (result.createdAccounts.length) {
        html += `
          <table class="mt-16">
            <thead><tr><th>Core Member</th><th>Username</th></tr></thead>
            <tbody>${result.createdAccounts.map((a) => `<tr><td>${Util.escapeHtml(a.name)}</td><td>${Util.escapeHtml(a.username)}</td></tr>`).join('')}</tbody>
          </table>`;
      }
      if (result.skipped.length) {
        html += `
          <table class="mt-16">
            <thead><tr><th>Core Member</th><th>Skipped Reason</th></tr></thead>
            <tbody>${result.skipped.map((s) => `<tr><td>${Util.escapeHtml(s.name)}</td><td class="text-muted">${Util.escapeHtml(s.reason)}</td></tr>`).join('')}</tbody>
          </table>`;
      }
      resultBox.innerHTML = html;
      await this.loadRows();
    } catch (err) {
      this.showAlert(err.message);
    } finally {
      btn.disabled = false;
    }
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  async loadRows() {
    const isSuperAdmin = Api.getUser().role === 'super_admin';
    const users = await Api.get('/users');
    const rows = document.getElementById('rows');
    rows.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td>${Util.escapeHtml(u.username)}</td>
        <td><span class="badge ${['admin', 'super_admin'].includes(u.role) ? 'active' : 'partial'}">${u.role.replace('_', ' ')}</span></td>
        <td>${Util.escapeHtml(u.member_name || '-')}</td>
        <td>${u.must_change_password ? '<span class="badge unpaid">must change on login</span>' : '-'}</td>
        <td>${u.last_login_at ? Util.formatDateTime(u.last_login_at) : '<span class="text-muted">never</span>'}</td>
        <td class="toolbar">
          ${isSuperAdmin ? `<button class="small secondary" data-reset="${u.id}">Reset Password</button>` : ''}
          ${u.username !== 'admin' ? `<button class="small danger" data-del="${u.id}">Delete</button>` : ''}
        </td>
      </tr>`
      )
      .join('');

    rows.querySelectorAll('[data-reset]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const password = prompt('Enter a new password for this account:');
        if (!password) return;
        try {
          await Api.put(`/users/${btn.dataset.reset}/reset-password`, { password });
          this.showAlert('Password reset.', 'success');
        } catch (err) {
          this.showAlert(err.message);
        }
      })
    );
    rows.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this login account?')) return;
        try {
          await Api.del(`/users/${btn.dataset.del}`);
          await this.loadRows();
        } catch (err) {
          this.showAlert(err.message);
        }
      })
    );
  },

  renderForm(panel) {
    const isSuperAdmin = Api.getUser().role === 'super_admin';
    const memberOptions =
      '<option value="">-- No linked member --</option>' +
      this.members
        .filter((m) => m.status === 'active')
        .map((m) => `<option value="${m.id}">${Util.escapeHtml(m.name)}</option>`)
        .join('');
    panel.innerHTML = `
      <div class="panel-header"><h3>Create Login Account</h3></div>
      <form id="userForm">
        <div class="form-grid">
          <div class="field"><label>Username</label><input id="u_username" required /></div>
          <div class="field"><label>Password</label><input id="u_password" type="password" required /></div>
          <div class="field"><label>Role</label>
            <select id="u_role">
              <option value="member">Member (view-only)</option>
              <option value="admin">Admin / Core Member (No Settings access)</option>
              ${isSuperAdmin ? '<option value="super_admin">Super Admin (full access)</option>' : ''}
            </select>
          </div>
          <div class="field"><label>Linked Member</label><select id="u_member">${memberOptions}</select></div>
        </div>
        <div class="toolbar mt-16"><button type="submit">Create Account</button></div>
      </form>
    `;
    document.getElementById('userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberId = document.getElementById('u_member').value;
      const payload = {
        username: document.getElementById('u_username').value.trim(),
        password: document.getElementById('u_password').value,
        role: document.getElementById('u_role').value,
        member_id: memberId ? Number(memberId) : null,
      };
      try {
        await Api.post('/users', payload);
        e.target.reset();
        await this.loadRows();
        this.showAlert('Account created.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });
  },
};
