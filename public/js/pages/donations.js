window.DonationsPage = {
  async render(container) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    container.innerHTML = `
      <h1>Donations</h1>
      <p class="page-sub">Track donations from members and well-wishers</p>
      <div id="alertBox"></div>
      ${isAdmin ? '<div class="panel" id="formPanel"></div>' : ''}
      <div class="panel">
        <div class="panel-header"><h3>All Donations</h3><div class="text-muted" id="totalLabel"></div></div>
        <table>
          <thead><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Purpose</th><th>Event</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody>
        </table>
      </div>
    `;

    this.members = await Api.get('/members');
    this.events = await Api.get('/events');
    if (isAdmin) this.renderForm(document.getElementById('formPanel'), null);
    await this.loadRows();
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  async loadRows() {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    const donations = await Api.get('/donations');
    const tbody = document.getElementById('rows');
    const total = donations.reduce((sum, d) => sum + Number(d.amount), 0);
    document.getElementById('totalLabel').textContent = `Total: ${Util.money(total)}`;

    if (!donations.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No donations recorded yet</td></tr>`;
      return;
    }
    tbody.innerHTML = donations
      .map(
        (d) => `
      <tr>
        <td>${Util.formatDate(d.donation_date)}${d.created_at ? `<br><span class="text-muted" style="font-size:0.78rem;">${Util.formatTime(d.created_at)}</span>` : ''}</td>
        <td>${Util.escapeHtml(d.member_name || d.donor_name || '-')}${d.donor_email || d.donor_phone ? `<br><span class="text-muted" style="font-size:0.78rem;">${Util.escapeHtml(d.donor_email || d.donor_phone)}</span>` : ''}</td>
        <td>${Util.money(d.amount)}</td>
        <td>${Util.escapeHtml(d.purpose || '-')}</td>
        <td>${Util.escapeHtml(d.event_title || '-')}</td>
        <td><span class="badge ${d.status === 'pending' ? 'partial' : 'paid'}">${d.status}</span></td>
        ${
          isAdmin
            ? `<td class="toolbar">
                ${d.status === 'pending' ? `<button class="small" data-confirm="${d.id}">Confirm</button>` : ''}
                <button class="small secondary" data-edit="${d.id}">Edit</button>
                <button class="small danger" data-del="${d.id}">Delete</button>
              </td>`
            : ''
        }
      </tr>`
      )
      .join('');

    if (isAdmin) {
      tbody.querySelectorAll('[data-confirm]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Confirm that this donation has been received (e.g. via UPI QR)?')) return;
          try {
            await Api.put(`/donations/${btn.dataset.confirm}/confirm`);
            await this.loadRows();
          } catch (err) {
            this.showAlert(err.message);
          }
        })
      );
      tbody.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const d = donations.find((x) => String(x.id) === btn.dataset.edit);
          this.renderForm(document.getElementById('formPanel'), d);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
      tbody.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this donation record?')) return;
          try {
            await Api.del(`/donations/${btn.dataset.del}`);
            await this.loadRows();
          } catch (err) {
            this.showAlert(err.message);
          }
        })
      );
    }
  },

  renderForm(panel, d) {
    if (!panel) return;
    const isEdit = !!d;
    const memberOptions =
      '<option value="">-- External donor --</option>' +
      this.members.map((m) => `<option value="${m.id}" ${d?.member_id === m.id ? 'selected' : ''}>${Util.escapeHtml(m.name)}</option>`).join('');
    const eventOptions =
      '<option value="">-- Not linked to an event --</option>' +
      this.events.map((ev) => `<option value="${ev.id}" ${d?.event_id === ev.id ? 'selected' : ''}>${Util.escapeHtml(ev.title)}</option>`).join('');

    panel.innerHTML = `
      <div class="panel-header"><h3>${isEdit ? 'Edit Donation' : 'Record Donation'}</h3></div>
      <form id="donForm">
        <div class="form-grid">
          <div class="field"><label>Member (if applicable)</label><select id="f_member">${memberOptions}</select></div>
          <div class="field"><label>External Donor Name (if not a member)</label><input id="f_donor" value="${Util.escapeHtml(d?.donor_name || '')}" /></div>
          <div class="field"><label>Amount</label><input id="f_amount" type="number" step="0.01" required value="${d?.amount ?? ''}" /></div>
          <div class="field"><label>Date</label><input id="f_date" type="date" value="${d?.donation_date || Util.todayISO()}" /></div>
          <div class="field"><label>Purpose</label><input id="f_purpose" value="${Util.escapeHtml(d?.purpose || '')}" /></div>
          <div class="field"><label>Linked Event</label><select id="f_event">${eventOptions}</select></div>
        </div>
        <div class="toolbar mt-16">
          <button type="submit">${isEdit ? 'Save Changes' : 'Record Donation'}</button>
          ${isEdit ? '<button type="button" class="secondary" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form>
    `;

    document.getElementById('donForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberId = document.getElementById('f_member').value;
      const eventId = document.getElementById('f_event').value;
      const payload = {
        member_id: memberId ? Number(memberId) : null,
        donor_name: document.getElementById('f_donor').value.trim() || null,
        amount: Number(document.getElementById('f_amount').value),
        donation_date: document.getElementById('f_date').value,
        purpose: document.getElementById('f_purpose').value.trim(),
        event_id: eventId ? Number(eventId) : null,
      };
      try {
        if (isEdit) {
          await Api.put(`/donations/${d.id}`, payload);
        } else {
          await Api.post('/donations', payload);
        }
        this.renderForm(panel, null);
        await this.loadRows();
        this.showAlert(isEdit ? 'Donation updated.' : 'Donation recorded.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    if (isEdit) {
      document.getElementById('cancelEdit').addEventListener('click', () => this.renderForm(panel, null));
    }
  },
};
