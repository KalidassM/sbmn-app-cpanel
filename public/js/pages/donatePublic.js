(() => {
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
    const res = await fetch(`/api/public/donations${path}`, {
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

  const card = document.getElementById('card');
  const alertBox = document.getElementById('alertBox');

  function showAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  function renderPaymentStep(donation) {
    card.innerHTML = `
      <h1>Almost there, ${escapeHtml(donation.donor_name)}!</h1>
      <p class="sub">Please complete your donation of <strong>${money(donation.amount)}</strong></p>
      <div id="alertBox"></div>
      <div id="gatewayContent"></div>
      <div id="qrContent"></div>
      <div id="doneContent"></div>
    `;

    request('/razorpay-config')
      .then((config) => {
        const gatewayBox = document.getElementById('gatewayContent');
        if (config.configured) {
          gatewayBox.innerHTML = `<button id="payOnlineBtn" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
          document.getElementById('payOnlineBtn').addEventListener('click', () => payWithRazorpay(donation));
        } else {
          loadQr(donation);
        }
      })
      .catch((err) => {
        document.getElementById('gatewayContent').innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
      });
  }

  async function loadQr(donation) {
    const qrBox = document.getElementById('qrContent');
    qrBox.innerHTML = '<p class="text-muted">Loading QR code…</p>';
    try {
      const note = `Donation - ${donation.donor_name}`;
      const data = await request(`/qr?amount=${donation.amount}&note=${encodeURIComponent(note)}`);
      qrBox.innerHTML = `
        <img src="${data.qrDataUrl}" alt="UPI QR code" width="220" height="220" />
        <p class="text-muted mt-16">Scan with any UPI app (GPay, PhonePe, Paytm...), or on your phone <a href="${escapeHtml(data.upiUri)}">tap here to pay</a>.</p>
        <p class="text-muted" style="font-size:0.78rem;">After paying, please let a core member know so they can confirm your donation.</p>
      `;
    } catch (err) {
      qrBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function payWithRazorpay(donation) {
    const gatewayBox = document.getElementById('gatewayContent');
    try {
      const order = await request(`/${donation.id}/order`, { method: 'POST' });
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.payeeName,
        description: `Donation - ${donation.donor_name}`,
        order_id: order.orderId,
        handler: async (response) => {
          gatewayBox.innerHTML = '<p class="text-muted">Verifying payment…</p>';
          try {
            await request(`/${donation.id}/verify`, {
              method: 'POST',
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            card.innerHTML = `
              <h1>Thank you, ${escapeHtml(donation.donor_name)}! 🙏</h1>
              <p class="sub">Your donation of ${money(donation.amount)} has been received. We truly appreciate your support.</p>
              <a href="/" class="btn" style="display:block; text-align:center; text-decoration:none; margin-top:16px;">Back to Home</a>
            `;
          } catch (err) {
            gatewayBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
          }
        },
        modal: {
          ondismiss: () => {
            gatewayBox.innerHTML = `<button id="payOnlineBtn" style="width:100%;">Pay Online Now (Card / UPI / NetBanking)</button>`;
            document.getElementById('payOnlineBtn').addEventListener('click', () => payWithRazorpay(donation));
          },
        },
        theme: { color: '#2f6f4e' },
      });
      rzp.open();
    } catch (err) {
      gatewayBox.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('donateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      donor_name: document.getElementById('d_name').value.trim(),
      donor_email: document.getElementById('d_email').value.trim(),
      donor_phone: document.getElementById('d_phone').value.trim(),
      amount: Number(document.getElementById('d_amount').value),
      purpose: document.getElementById('d_purpose').value.trim(),
    };
    try {
      const donation = await request('/', { method: 'POST', body: payload });
      renderPaymentStep(donation);
    } catch (err) {
      showAlert(err.message);
    }
  });
})();
