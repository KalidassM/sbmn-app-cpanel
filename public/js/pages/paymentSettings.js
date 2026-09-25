window.PaymentSettingsPage = {
  async render(container) {
    container.innerHTML = `
      <h1>Payment Settings</h1>
      <p class="page-sub">Configure the UPI ID and bank account members pay maintenance dues and donations into</p>
      <div id="alertBox"></div>
      <div class="panel">
        <div class="panel-header"><h3>SBI Account Details</h3></div>
        <form id="settingsForm">
          <div class="form-grid">
            <div class="field"><label>UPI ID (VPA)</label><input id="s_upi" placeholder="yourassociation@sbi" /></div>
            <div class="field"><label>Payee Name (shown to payer)</label><input id="s_payee" placeholder="Sri Balamurugan Nagar Welfare Association" /></div>
            <div class="field"><label>Bank Name</label><input id="s_bank" value="State Bank of India" /></div>
            <div class="field"><label>Account Number</label><input id="s_acct" /></div>
            <div class="field"><label>IFSC Code</label><input id="s_ifsc" placeholder="SBIN0001234" /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save Settings</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Which gateway do payers see?</h3></div>
        <p class="text-muted" style="font-size:0.85rem;">Controls the public pay/donate pages independently of which gateways are configured below — e.g. keep SBIePay hidden from payers until it's actually working, even after saving its keys.</p>
        <form id="gatewayDisplayForm">
          <div class="toolbar" style="justify-content:flex-start;">
            <label style="display:flex;align-items:center;gap:4px;font-weight:normal;">
              <input type="radio" name="gatewayDisplay" id="gd_both" value="both" /> Both (when configured)
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-weight:normal;">
              <input type="radio" name="gatewayDisplay" id="gd_razorpay" value="razorpay" /> Razorpay only
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-weight:normal;">
              <input type="radio" name="gatewayDisplay" id="gd_sbiepay" value="sbiepay" /> SBIePay only
            </label>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Online Payment Gateway (Razorpay)</h3><span id="gatewayStatus"></span></div>
        <form id="gatewayForm">
          <div class="form-grid">
            <div class="field"><label>Key ID</label><input id="s_rp_key_id" placeholder="rzp_live_xxxxxxxxxxxx" /></div>
            <div class="field"><label>Key Secret</label><input id="s_rp_key_secret" type="password" placeholder="Leave blank to keep existing" /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save Gateway Keys</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Online Payment Gateway (SBIePay)</h3><span id="sbiepayStatus"></span></div>
        <p class="text-muted" style="font-size:0.85rem;">Offered alongside Razorpay - members/donors see both options when configured. Get the Merchant ID and Secret Key from SBI once your SBIePay merchant onboarding is complete.</p>
        <p class="text-muted" style="font-size:0.85rem;"><strong>Not usable yet:</strong> saving these enables the option in the UI, but actual payments will fail with a clear error until the request/response encryption from SBI's Merchant Integration Document is implemented in <code>php/utils/sbiepay.php</code>.</p>
        <form id="sbiepayForm">
          <div class="form-grid">
            <div class="field"><label>Merchant ID</label><input id="s_sb_merchant_id" placeholder="e.g. 000000000000000" /></div>
            <div class="field"><label>Secret Key</label><input id="s_sb_secret_key" type="password" placeholder="Leave blank to keep existing" /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save SBIePay Keys</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Preview</h3></div>
        <div class="form-grid" style="align-items:start;">
          <div class="field"><label>Test Amount (₹)</label><input id="previewAmount" type="number" value="500" /></div>
          <div class="field"><button type="button" id="previewBtn" class="secondary" style="margin-top: 22px;">Show Sample QR</button></div>
        </div>
        <div id="previewBox"></div>
      </div>
    `;

    const settings = await Api.get('/payment-settings');
    document.getElementById('s_upi').value = settings.upi_id || '';
    document.getElementById('s_payee').value = settings.payee_name || '';
    document.getElementById('s_bank').value = settings.bank_name || 'State Bank of India';
    document.getElementById('s_acct').value = settings.account_no || '';
    document.getElementById('s_ifsc').value = settings.ifsc_code || '';
    document.getElementById('s_rp_key_id').value = settings.razorpay_key_id || '';
    this.renderGatewayStatus(settings.razorpay_configured);
    document.getElementById('s_sb_merchant_id').value = settings.sbiepay_merchant_id || '';
    this.renderSbiepayStatus(settings.sbiepay_configured);
    document.getElementById(`gd_${settings.gateway_display || 'both'}`).checked = true;

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        upi_id: document.getElementById('s_upi').value.trim(),
        payee_name: document.getElementById('s_payee').value.trim(),
        bank_name: document.getElementById('s_bank').value.trim(),
        account_no: document.getElementById('s_acct').value.trim(),
        ifsc_code: document.getElementById('s_ifsc').value.trim(),
      };
      try {
        await Api.put('/payment-settings', payload);
        this.showAlert('Payment settings saved.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    document.getElementById('gatewayForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        razorpay_key_id: document.getElementById('s_rp_key_id').value.trim(),
        razorpay_key_secret: document.getElementById('s_rp_key_secret').value.trim(),
      };
      try {
        const updated = await Api.put('/payment-settings', payload);
        document.getElementById('s_rp_key_secret').value = '';
        this.renderGatewayStatus(updated.razorpay_configured);
        this.showAlert('Gateway keys saved.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    document.getElementById('gatewayDisplayForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        gateway_display: document.querySelector('input[name="gatewayDisplay"]:checked').value,
      };
      try {
        await Api.put('/payment-settings', payload);
        this.showAlert('Saved.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    document.getElementById('sbiepayForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        sbiepay_merchant_id: document.getElementById('s_sb_merchant_id').value.trim(),
        sbiepay_secret_key: document.getElementById('s_sb_secret_key').value.trim(),
      };
      try {
        const updated = await Api.put('/payment-settings', payload);
        document.getElementById('s_sb_secret_key').value = '';
        this.renderSbiepayStatus(updated.sbiepay_configured);
        this.showAlert('SBIePay keys saved.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    document.getElementById('previewBtn').addEventListener('click', async () => {
      const amount = Number(document.getElementById('previewAmount').value) || 0;
      const box = document.getElementById('previewBox');
      box.innerHTML = '<p class="text-muted">Loading QR…</p>';
      try {
        const data = await Api.get(`/payment-settings/qr?amount=${amount}&note=${encodeURIComponent('Sample payment')}`);
        box.innerHTML = `
          <img src="${data.qrDataUrl}" alt="UPI QR code" width="220" height="220" />
          <p class="text-muted mt-16">Scan with any UPI app, or on a phone <a href="${Util.escapeHtml(data.upiUri)}">tap here to pay</a>.</p>
        `;
      } catch (err) {
        box.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      }
    });
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  renderGatewayStatus(configured) {
    const el = document.getElementById('gatewayStatus');
    if (!el) return;
    el.innerHTML = configured
      ? '<span class="badge active">Configured</span>'
      : '<span class="badge inactive">Not configured</span>';
  },

  renderSbiepayStatus(configured) {
    const el = document.getElementById('sbiepayStatus');
    if (!el) return;
    el.innerHTML = configured
      ? '<span class="badge active">Configured</span>'
      : '<span class="badge inactive">Not configured</span>';
  },
};
