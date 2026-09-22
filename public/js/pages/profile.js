window.ProfilePage = {
  async render(container) {
    const user = Api.getUser();
    container.innerHTML = `
      <h1>My Profile</h1>
      <p class="page-sub">Manage your own account details</p>
      <div id="profileAlert"></div>
      <div class="panel" id="detailsPanel"></div>
      <div class="panel">
        <div class="panel-header"><h3>Change Password</h3></div>
        <form id="pwForm">
          <div class="form-grid">
            <div class="field"><label>Current Password</label><input type="password" id="pw_current" required /></div>
            <div class="field"><label>New Password</label><input type="password" id="pw_new" required minlength="6" /></div>
            <div class="field"><label>Confirm New Password</label><input type="password" id="pw_confirm" required minlength="6" /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Change Password</button></div>
        </form>
      </div>
    `;

    const detailsPanel = document.getElementById('detailsPanel');
    try {
      const member = await Api.get('/members/me');
      this.renderDetails(detailsPanel, member, user);
    } catch (err) {
      this.renderDetails(detailsPanel, null, user);
    }

    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('pw_current').value;
      const newPassword = document.getElementById('pw_new').value;
      const confirmPassword = document.getElementById('pw_confirm').value;
      const alertBox = document.getElementById('profileAlert');
      alertBox.innerHTML = '';
      if (newPassword !== confirmPassword) {
        alertBox.innerHTML = `<div class="alert error">New passwords do not match.</div>`;
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const result = await Api.post('/auth/change-password', { currentPassword, newPassword });
        Api.setSession(result.token, result.user);
        e.target.reset();
        alertBox.innerHTML = `<div class="alert success">Password changed.</div>`;
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  },

  renderDetails(panel, member, user) {
    if (!member) {
      panel.innerHTML = `
        <div class="panel-header"><h3>My Details</h3></div>
        <p class="text-muted">Username: ${Util.escapeHtml(user.username)}</p>
        <p class="text-muted">This login isn't linked to a member record, so there are no contact details to manage here.</p>
      `;
      return;
    }
    panel.innerHTML = `
      <div class="panel-header"><h3>My Details</h3></div>
      <form id="detailsForm">
        <div class="form-grid">
          <div class="field"><label>Name</label><input value="${Util.escapeHtml(member.name)}" disabled /></div>
          <div class="field"><label>Site No</label><input value="${Util.escapeHtml(member.site_no || '-')}" disabled /></div>
          <div class="field"><label>Phone</label><input id="pf_phone" value="${Util.escapeHtml(member.phone || '')}" /></div>
          <div class="field"><label>Email</label><input id="pf_email" type="email" value="${Util.escapeHtml(member.email || '')}" /></div>
          <div class="field"><label>Address</label><input id="pf_address" value="${Util.escapeHtml(member.address || '')}" /></div>
          <div class="field"><label>Status</label><input value="${Util.escapeHtml(member.status)}" disabled /></div>
        </div>
        <p class="text-muted" style="font-size:0.8rem;">Name, Site No, and Status can only be changed by an administrator.</p>
        <div class="toolbar mt-16"><button type="submit">Save Details</button></div>
      </form>
    `;

    document.getElementById('detailsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertBox = document.getElementById('profileAlert');
      alertBox.innerHTML = '';
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await Api.put('/members/me', {
          phone: document.getElementById('pf_phone').value.trim(),
          email: document.getElementById('pf_email').value.trim(),
          address: document.getElementById('pf_address').value.trim(),
        });
        alertBox.innerHTML = `<div class="alert success">Details updated.</div>`;
      } catch (err) {
        alertBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  },
};
