(() => {
  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    const num = Number(n) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api/public/maintenance${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  const alertBox = document.getElementById('alertBox');
  const resultsBox = document.getElementById('results');

  function showAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  function renderResults(members) {
    if (!members.length) {
      resultsBox.innerHTML = '';
      showAlert("No member found with that Site No or Name. Please check and try again, or contact the association.");
      return;
    }
    alertBox.innerHTML = '';
    resultsBox.innerHTML = members
      .map((m) => {
        if (m.inactive) {
          return `
            <div class="panel" style="margin-top:16px;">
              <div class="panel-header"><h3>${escapeHtml(m.name)} <span class="text-muted" style="font-size:0.8rem;">(Site No ${escapeHtml(m.site_no || '-')})</span></h3></div>
              <p class="text-muted">You're not an active member, so there's nothing to pay online here. Please contact the association if you believe this is a mistake.</p>
            </div>`;
        }
        if (!m.dues.length) {
          return `
            <div class="panel" style="margin-top:16px;">
              <div class="panel-header"><h3>${escapeHtml(m.name)} <span class="text-muted" style="font-size:0.8rem;">(Site No ${escapeHtml(m.site_no || '-')})</span></h3></div>
              <p class="text-muted">No outstanding dues — you're all caught up. Thank you!</p>
              <a href="/" class="btn" style="display:block; text-align:center; text-decoration:none; margin-top:16px;">Back to Home</a>
            </div>`;
        }
        const total = m.dues.reduce((sum, d) => sum + (Number(d.amount_due) - Number(d.amount_paid)), 0);
        return `
          <div class="panel" style="margin-top:16px;">
            <div class="panel-header"><h3>${escapeHtml(m.name)} <span class="text-muted" style="font-size:0.8rem;">(Site No ${escapeHtml(m.site_no || '-')})</span></h3></div>
            ${m.dues.map((d) => duesRowHtml(d)).join('')}
            <div class="toolbar" id="member-total-${m.member_id}" style="justify-content:space-between; border-top:1px solid var(--border); padding-top:12px; margin-top:12px; margin-bottom: 24px;">
              <div>
                <strong>Total due (${m.dues.length} month${m.dues.length > 1 ? 's' : ''})</strong>
                <div class="text-muted" style="font-size:0.85rem;">${money(total)}</div>
              </div>
              <button id="pay-btn-member-${m.member_id}">Pay Now</button>
            </div>
            <div id="member-pay-${m.member_id}"></div>
          </div>`;
      })
      .join('');

    members.forEach((m) => {
      if (!m.dues.length) return;
      const btn = document.getElementById(`pay-btn-member-${m.member_id}`);
      if (btn) btn.addEventListener('click', () => showPaymentStep(m));
    });
  }

  function duesRowHtml(d) {
    const remaining = Number(d.amount_due) - Number(d.amount_paid);
    return `
      <div class="toolbar" style="justify-content:space-between; border-top:1px solid var(--border); padding-top:12px; margin-top:12px;" id="due-row-${d.id}">
        <div>
          <strong>${MONTH_NAMES[d.month]} ${d.year}</strong>
          <div class="text-muted" style="font-size:0.85rem;">${money(remaining)} due${d.status === 'partial' ? ' (partially paid)' : ''}</div>
        </div>
      </div>
    `;
  }

  function showPaymentStep(m) {
    const remaining = m.dues.reduce((sum, d) => sum + (Number(d.amount_due) - Number(d.amount_paid)), 0);
    const box = document.getElementById(`member-pay-${m.member_id}`);
    document.getElementById(`pay-btn-member-${m.member_id}`).style.display = 'none';
    box.innerHTML = `
      <div id="gatewayContent-member-${m.member_id}"></div>
      <div id="qrContent-member-${m.member_id}"></div>
    `;

    request('/razorpay-config')
      .then((config) => {
        const gatewayBox = document.getElementById(`gatewayContent-member-${m.member_id}`);
        if (config.configured) {
          gatewayBox.innerHTML = `<button id="payOnlineBtn-member-${m.member_id}" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
          document.getElementById(`payOnlineBtn-member-${m.member_id}`).addEventListener('click', () => payWithRazorpay(m, remaining));
        } else {
          loadQr(m, remaining);
        }
      })
      .catch((err) => {
        document.getElementById(`gatewayContent-member-${m.member_id}`).innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
      });
  }

  async function loadQr(m, remaining) {
    const qrBox = document.getElementById(`qrContent-member-${m.member_id}`);
    qrBox.innerHTML = '<p class="text-muted">Loading QR code…</p>';
    try {
      const months = m.dues.map((d) => `${MONTH_NAMES[d.month]} ${d.year}`).join(', ');
      const note = `Maintenance ${months}`;
      const data = await request(`/qr?amount=${remaining}&note=${encodeURIComponent(note)}`);
      qrBox.innerHTML = `
        <img src="${data.qrDataUrl}" alt="UPI QR code" width="220" height="220" />
        <p class="text-muted mt-16">Scan with any UPI app (GPay, PhonePe, Paytm...), or on your phone <a href="${escapeHtml(data.upiUri)}">tap here to pay</a>.</p>
        <p class="text-muted" style="font-size:0.78rem;">After paying, please let a core member know so they can confirm your payment.</p>
      `;
    } catch (err) {
      qrBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function payWithRazorpay(m, remaining) {
    const gatewayBox = document.getElementById(`gatewayContent-member-${m.member_id}`);
    const dueIds = m.dues.map((d) => d.id);
    try {
      const order = await request('/pay-multiple/order', { method: 'POST', body: { dueIds } });
      const months = m.dues.map((d) => `${MONTH_NAMES[d.month]} ${d.year}`).join(', ');
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.payeeName,
        description: `Maintenance ${months}`,
        order_id: order.orderId,
        handler: async (response) => {
          gatewayBox.innerHTML = '<p class="text-muted">Verifying payment…</p>';
          try {
            await request('/pay-multiple/verify', {
              method: 'POST',
              body: {
                dueIds,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            m.dues.forEach((d) => {
              const row = document.getElementById(`due-row-${d.id}`);
              if (row) row.innerHTML = `<div><strong>${MONTH_NAMES[d.month]} ${d.year}</strong><div class="text-muted">Paid — thank you! 🙏</div></div>`;
            });
            document.getElementById(`member-total-${m.member_id}`).innerHTML = '<div class="text-muted">All dues settled — thank you! 🙏</div>';
            document.getElementById(`member-pay-${m.member_id}`).innerHTML = '';
            document.getElementById(`member-pay-${m.member_id}`).innerHTML += '<a href="/" class="btn" style="display:block; text-align:center; text-decoration:none; margin-top:16px;">Back to Home</a>';
          } catch (err) {
            gatewayBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
          }
        },
        modal: {
          ondismiss: () => {
            gatewayBox.innerHTML = `<button id="payOnlineBtn-member-${m.member_id}" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
            document.getElementById(`payOnlineBtn-member-${m.member_id}`).addEventListener('click', () => payWithRazorpay(m, remaining));
          },
        },
        theme: { color: '#2f6f4e' },
      });
      rzp.open();
    } catch (err) {
      gatewayBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function runSearch(q) {
    if (!q) return;
    try {
      const members = await request(`/dues?q=${encodeURIComponent(q)}`);
      renderResults(members);
    } catch (err) {
      showAlert(err.message);
    }
  }

  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch(document.getElementById('q').value.trim());
  });

  // Reminder links (?q=SITE_NO) pre-fill and auto-run the search so members don't have to type
  const prefill = new URLSearchParams(window.location.search).get('q');
  if (prefill) {
    document.getElementById('q').value = prefill;
    runSearch(prefill);
  }
})();
