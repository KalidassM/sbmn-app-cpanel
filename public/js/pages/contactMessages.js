window.ContactMessagesPage = {
  async render(container) {
    container.innerHTML = `
      <h1>Contact Messages</h1>
      <p class="page-sub">Messages submitted through the public website's contact form</p>
      <div id="alertBox"></div>
      <div class="panel">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>House/Plot</th><th>Phone</th><th>Email</th><th>Message</th><th></th></tr></thead>
          <tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody>
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
    const messages = await Api.get('/contact-messages');
    const tbody = document.getElementById('rows');
    if (!messages.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No messages yet</td></tr>`;
      return;
    }
    tbody.innerHTML = messages
      .map(
        (m) => `
      <tr>
        <td>${Util.formatDate(m.created_at)}</td>
        <td>${Util.escapeHtml(m.name)}</td>
        <td>${Util.escapeHtml(m.house_no || '-')}</td>
        <td>${Util.escapeHtml(m.phone)}</td>
        <td>${Util.escapeHtml(m.email || '-')}</td>
        <td>${Util.escapeHtml(m.message)}</td>
        <td><button class="small danger" data-del="${m.id}">Delete</button></td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this message?')) return;
        try {
          await Api.del(`/contact-messages/${btn.dataset.del}`);
          await this.loadRows();
        } catch (err) {
          this.showAlert(err.message);
        }
      })
    );
  },
};
