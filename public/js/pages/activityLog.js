window.ActivityLogPage = {
  async render(container) {
    container.innerHTML = `
      <h1>Activity Log</h1>
      <p class="page-sub">Recent create/update/delete actions across the portal</p>
      <div id="alertBox"></div>
      <div class="panel">
        <div class="panel-header"><h3>Recent Activity</h3></div>
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Description</th></tr></thead>
          <tbody id="rows"><tr><td colspan="5">Loading…</td></tr></tbody>
        </table>
      </div>
    `;
    await this.loadRows();
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  async loadRows() {
    const rows = document.getElementById('rows');
    try {
      const entries = await Api.get('/activity-log');
      if (!entries.length) {
        rows.innerHTML = `<tr class="empty-row"><td colspan="5">No activity recorded yet</td></tr>`;
        return;
      }
      rows.innerHTML = entries
        .map(
          (e) => `
        <tr>
          <td>${Util.formatDateTime(e.created_at)}</td>
          <td>${Util.escapeHtml(e.actor || '-')}</td>
          <td><span class="badge">${Util.escapeHtml(e.action)}</span></td>
          <td>${Util.escapeHtml(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}</td>
          <td>${Util.escapeHtml(e.description)}</td>
        </tr>`
        )
        .join('');
    } catch (err) {
      this.showAlert(err.message);
    }
  },
};
