window.RemindersPage = {
  state: { month: new Date().getMonth() + 1, year: new Date().getFullYear() },

  async render(container) {
    const { month, year } = this.state;

    container.innerHTML = `
      <h1>Reminders</h1>
      <p class="page-sub">Members who still owe maintenance, and whether the automated WhatsApp reminder reached them</p>
      <div id="alertBox"></div>

      <div class="panel">
        <div class="panel-header">
          <h3>Not Paid</h3>
          <div class="toolbar">
            <select id="monthSelect"></select>
            <select id="yearSelect"></select>
            <button type="button" class="secondary" id="resendTodayBtn">Resend Today</button>
          </div>
        </div>
        <table>
          <thead><tr><th>Site No</th><th>Member</th><th>Phone</th><th>Amount Due</th><th>Status</th><th>Reminder</th></tr></thead>
          <tbody id="reminderRows"><tr><td colspan="6">Loading…</td></tr></tbody>
        </table>
      </div>
    `;

    this.populateMonthYearSelects();
    document.getElementById('monthSelect').addEventListener('change', (e) => {
      this.state.month = Number(e.target.value);
      this.load();
    });
    document.getElementById('yearSelect').addEventListener('change', (e) => {
      this.state.year = Number(e.target.value);
      this.load();
    });
    document.getElementById('resendTodayBtn').addEventListener('click', () => this.resendToday());

    await this.load();
  },

  async resendToday() {
    if (!confirm('Send WhatsApp reminders right now to everyone still unpaid this month? This ignores the scheduled day/time and sends immediately.')) return;
    const btn = document.getElementById('resendTodayBtn');
    btn.disabled = true;
    try {
      const result = await Api.post('/maintenance/reminders/resend-today');
      if (result.skipped) {
        this.showAlert(result.reason);
      } else {
        const msg = `Sent ${result.sent.length} of ${result.totalDue}. ${result.failed.length} failed, ${result.skippedNoPhone.length} skipped (no phone).`;
        this.showAlert(msg, result.failed.length ? 'error' : 'success');
      }
      await this.load();
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

  populateMonthYearSelects() {
    const monthSelect = document.getElementById('monthSelect');
    const yearSelect = document.getElementById('yearSelect');
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}" ${m === this.state.month ? 'selected' : ''}>${Util.monthName(m)}</option>`)
      .join('');
    const thisYear = new Date().getFullYear();
    const years = [thisYear - 1, thisYear, thisYear + 1];
    yearSelect.innerHTML = years
      .map((y) => `<option value="${y}" ${y === this.state.year ? 'selected' : ''}>${y}</option>`)
      .join('');
  },

  async load() {
    const { month, year } = this.state;
    const rows = document.getElementById('reminderRows');
    let members;
    try {
      members = await Api.get(`/maintenance/reminders?month=${month}&year=${year}`);
    } catch (err) {
      this.showAlert(err.message);
      return;
    }

    if (!members.length) {
      rows.innerHTML = `<tr class="empty-row"><td colspan="6">Everyone has paid for ${Util.monthName(month)} ${year}.</td></tr>`;
      return;
    }

    rows.innerHTML = members
      .map((m) => {
        const remaining = Number(m.amount_due) - Number(m.amount_paid);
        let reminderCell;
        if (m.last_reminder_error) {
          reminderCell = `<span class="badge unpaid" title="${Util.escapeHtml(m.last_reminder_error)}">Failed</span>`;
        } else if (m.last_reminder_sent_at) {
          reminderCell = `<span class="badge active">Sent ${Util.formatDate(m.last_reminder_sent_at)}</span>`;
        } else {
          reminderCell = `<span class="badge unpaid">Not sent yet</span>`;
        }
        return `<tr>
          <td>${Util.escapeHtml(m.site_no || '-')}</td>
          <td>${Util.escapeHtml(m.member_name)}</td>
          <td>${Util.escapeHtml(m.phone || '-')}</td>
          <td>${Util.money(remaining)}</td>
          <td><span class="badge ${m.status}">${m.status}</span></td>
          <td>${reminderCell}</td>
        </tr>`;
      })
      .join('');
  },
};
