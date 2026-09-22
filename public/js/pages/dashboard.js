window.DashboardPage = {
  async render(container) {
    container.innerHTML = `<h1>Dashboard</h1><p class="page-sub">Overview of the association's finances and activity</p><div id="alertBox"></div><div id="content">Loading…</div>`;
    const content = document.getElementById('content');
    const user = Api.getUser();

    const [summary, events, donations, notices] = await Promise.all([
      Api.get('/dashboard/summary'),
      Api.get('/events'),
      Api.get('/donations'),
      Api.get('/notices'),
    ]);

    const upcoming = events
      .filter((e) => e.event_date >= Util.todayISO())
      .slice(0, 5);
    const myDonations = user.member_id ? donations.filter((d) => d.member_id === user.member_id).slice(0, 5) : [];
    const recentNotices = notices.slice(0, 5);

    content.innerHTML = `
      <h3 class="stat-group-title">Community</h3>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Active Members</div><div class="value">${summary.memberCount}</div></div>
        <div class="stat-card"><div class="label">Inactive Members</div><div class="value">${summary.inactiveMemberCount}</div></div>
        <div class="stat-card"><div class="label">Core Members</div><div class="value">${summary.coreMemberCount}</div></div>
        <div class="stat-card"><div class="label">Upcoming Events</div><div class="value">${summary.upcomingEvents}</div></div>
        <div class="stat-card"><div class="label">Notices</div><div class="value">${summary.noticeCount}</div></div>
      </div>

      <h3 class="stat-group-title">Finances</h3>
      <div class="stat-grid">
        <div class="stat-card ${summary.balance < 0 ? 'negative' : ''}"><div class="label">Total Balance (Bank + Petty Cash + Donations)</div><div class="value">${Util.money(summary.balance)}</div></div>
        <div class="stat-card"><div class="label">Maintenance Collected (this month)</div><div class="value">${Util.money(summary.maintenanceCollectedThisMonth)}</div></div>
        <div class="stat-card ${summary.totalMaintenanceDue > 0 ? 'negative' : ''}"><div class="label">Maintenance Pending Due (this month)</div><div class="value">${Util.money(summary.totalMaintenanceDue)}</div></div>
        <div class="stat-card"><div class="label">Total Donations</div><div class="value">${Util.money(summary.totalDonations)}</div></div>
        <div class="stat-card"><div class="label">Total Expenses</div><div class="value">${Util.money(summary.totalExpenses)}</div></div>
      </div>

      ${
        user.member_id
          ? `
      <div class="panel">
        <div class="panel-header"><h3>Make a Donation</h3></div>
        <p class="page-sub" style="margin-top:-8px;">Support the association directly — pay online or via UPI QR code.</p>
        <div id="donateForm"></div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>My Recent Donations</h3><a href="#/donations" class="btn secondary">View all</a></div>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Purpose</th><th>Status</th></tr></thead>
          <tbody id="myDonationRows">
            ${
              myDonations.length
                ? myDonations
                    .map(
                      (d) => `<tr><td>${Util.formatDate(d.donation_date)}</td><td>${Util.money(d.amount)}</td><td>${Util.escapeHtml(d.purpose || '-')}</td><td><span class="badge ${d.status === 'pending' ? 'partial' : 'paid'}">${d.status}</span></td></tr>`
                    )
                    .join('')
                : '<tr class="empty-row"><td colspan="4">You haven\'t made a donation yet</td></tr>'
            }
          </tbody>
        </table>
      </div>`
          : ''
      }

      <div class="panel">
        <div class="panel-header"><h3>Upcoming Events</h3><a href="#/events" class="btn secondary">View all</a></div>
        <table>
          <thead><tr><th>Title</th><th>Date</th><th>Venue</th></tr></thead>
          <tbody>
            ${
              upcoming.length
                ? upcoming
                    .map(
                      (e) => `<tr><td>${Util.escapeHtml(e.title)}</td><td>${Util.formatDate(e.event_date)}</td><td>${Util.escapeHtml(e.venue || '-')}</td></tr>`
                    )
                    .join('')
                : '<tr class="empty-row"><td colspan="3">No upcoming events</td></tr>'
            }
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Notices</h3><a href="#/notices" class="btn secondary">View all</a></div>
        <table>
          <thead><tr><th>Title</th><th>Details</th><th>Posted</th></tr></thead>
          <tbody>
            ${
              recentNotices.length
                ? recentNotices
                    .map(
                      (n) => `<tr><td>${Util.escapeHtml(n.title)}${n.pinned ? ' <span class="badge active">Pinned</span>' : ''}</td><td>${Util.escapeHtml(n.body)}</td><td>${Util.formatDate(n.created_at)}</td></tr>`
                    )
                    .join('')
                : '<tr class="empty-row"><td colspan="3">No notices yet</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;

    if (user.member_id) this.renderDonateForm();
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  renderDonateForm() {
    const el = document.getElementById('donateForm');
    el.innerHTML = `
      <form id="donateSelfForm">
        <div class="form-grid">
          <div class="field"><label>Amount (₹)</label><input id="ds_amount" type="number" min="1" step="0.01" required /></div>
          <div class="field"><label>Purpose (optional)</label><input id="ds_purpose" placeholder="e.g. General fund, Annual function..." /></div>
        </div>
        <div class="toolbar mt-16"><button type="submit">Continue to Pay</button></div>
      </form>
    `;
    document.getElementById('donateSelfForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        amount: Number(document.getElementById('ds_amount').value),
        purpose: document.getElementById('ds_purpose').value.trim(),
      };
      try {
        const donation = await Api.post('/donations/self', payload);
        this.showPayModal(donation);
      } catch (err) {
        this.showAlert(err.message);
      }
    });
  },

  async showPayModal(donation) {
    Util.openModal(`
      <h3>Complete Your Donation</h3>
      <p style="font-size:1.4rem;font-weight:700;color:var(--primary-dark);">${Util.money(donation.amount)}</p>
      <div id="gatewayContent"></div>
      <div id="qrToggleWrap" class="mt-16"><button type="button" class="secondary small" id="toggleQrBtn">Or pay by scanning a UPI QR code</button></div>
      <div id="qrContent"></div>
      <div class="toolbar close-modal mt-16" style="justify-content:center;">
        <button class="secondary" id="closeModalBtn">Close</button>
      </div>
    `);
    document.getElementById('closeModalBtn').addEventListener('click', async () => {
      Util.closeModal();
      await this.render(document.getElementById('main'));
    });
    document.getElementById('toggleQrBtn').addEventListener('click', () => this.loadQr(donation));

    const gatewayBox = document.getElementById('gatewayContent');
    try {
      const config = await Api.get('/payments/razorpay/config');
      if (config.configured) {
        gatewayBox.innerHTML = `<button id="payOnlineBtn" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
        document.getElementById('payOnlineBtn').addEventListener('click', () => this.payWithRazorpay(donation));
        document.getElementById('qrToggleWrap').querySelector('button').textContent = 'Or scan a UPI QR code instead';
      } else {
        document.getElementById('qrToggleWrap').style.display = 'none';
        await this.loadQr(donation);
      }
    } catch (err) {
      gatewayBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
    }
  },

  async loadQr(donation) {
    document.getElementById('toggleQrBtn').style.display = 'none';
    const qrBox = document.getElementById('qrContent');
    qrBox.innerHTML = '<p class="text-muted">Loading QR code…</p>';
    try {
      const note = `Donation - ${Api.getUser().username}`;
      const data = await Api.get(`/payment-settings/qr?amount=${donation.amount}&note=${encodeURIComponent(note)}`);
      qrBox.innerHTML = `
        <img src="${data.qrDataUrl}" alt="UPI QR code" width="220" height="220" />
        <p class="text-muted mt-16">Scan with any UPI app (GPay, PhonePe, Paytm...), or on your phone <a href="${Util.escapeHtml(data.upiUri)}">tap here to pay</a>.</p>
        <p class="text-muted" style="font-size:0.78rem;">After paying, let a core member know so they can confirm your donation.</p>
      `;
    } catch (err) {
      qrBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
    }
  },

  async payWithRazorpay(donation) {
    const gatewayBox = document.getElementById('gatewayContent');
    try {
      const order = await Api.post(`/donations/self/${donation.id}/order`);
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.payeeName,
        description: `Donation - ${Api.getUser().username}`,
        order_id: order.orderId,
        handler: async (response) => {
          gatewayBox.innerHTML = '<p class="text-muted">Verifying payment…</p>';
          try {
            await Api.post(`/donations/self/${donation.id}/verify`, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            Util.closeModal();
            await this.render(document.getElementById('main'));
            this.showAlert('Thank you! Your donation has been received.', 'success');
          } catch (err) {
            gatewayBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
          }
        },
        modal: {
          ondismiss: () => {
            gatewayBox.innerHTML = `<button id="payOnlineBtn" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
            document.getElementById('payOnlineBtn').addEventListener('click', () => this.payWithRazorpay(donation));
          },
        },
        theme: { color: '#2f6f4e' },
      });
      rzp.open();
    } catch (err) {
      gatewayBox.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
    }
  },
};
