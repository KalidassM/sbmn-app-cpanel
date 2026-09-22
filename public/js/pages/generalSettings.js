window.GeneralSettingsPage = {
  async render(container) {
    container.innerHTML = `
      <h1>General Settings</h1>
      <p class="page-sub">Association-wide configuration</p>
      <div id="alertBox"></div>

      <form id="profileForm">
        <div class="panel">
          <div class="panel-header"><h3>Association Profile</h3></div>
          <div class="form-grid">
            <div class="field"><label>App Name</label><input id="appName" placeholder="Sri Balamurugan Nagar Welfare Association" /></div>
            <div class="field"><label>Contact Email</label><input id="contactEmail" type="email" placeholder="e.g. association@example.com" /></div>
            <div class="field"><label>Phone Number</label><input id="phoneNumber" placeholder="e.g. +91 98765 43210" /></div>
            <div class="field"><label>Office Hours</label><input id="officeHours" placeholder="e.g. Every Sunday, 5 PM - 6 PM" /></div>
          </div>
          <div class="field"><label>Office Address</label><input id="officeAddress" placeholder="Street, area, city, PIN" /></div>
          <div class="toolbar mt-16"><button type="submit">Save</button></div>
        </div>
      </form>

      <form id="maintenanceForm">
        <div class="panel">
          <div class="panel-header"><h3>Monthly Maintenance</h3></div>
          <div class="form-grid">
            <div class="field"><label>Maintenance Dues Amount (₹ per member/month)</label><input id="maintenanceAmount" type="number" step="0.01" min="0" required /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save</button></div>
        </div>
      </form>

      <form id="reminderForm">
        <div class="panel">
          <div class="panel-header"><h3>Reminder Schedule</h3></div>
          <div class="field"><label>Days of the month to send WhatsApp reminders on</label>
            <div id="reminderDaysGrid" style="display:grid;grid-template-columns:repeat(7, 1fr);gap:6px;max-width:420px;">
              ${Array.from({ length: 31 }, (_, i) => i + 1)
                .map(
                  (d) => `
                <label style="display:flex;align-items:center;gap:4px;font-weight:normal;font-size:0.85rem;">
                  <input type="checkbox" class="reminderDay" value="${d}" /> ${d}
                </label>`
                )
                .join('')}
            </div>
          </div>
          <div class="form-grid">
            <div class="field"><label>Time to send (IST)</label><input id="reminderTime" type="time" required /></div>
          </div>
          <div class="toolbar mt-16"><button type="submit">Save</button></div>
        </div>
      </form>

      <form id="emailForm">
        <div class="panel">
          <div class="panel-header"><h3>Email Settings (Resend) <span id="emailBadge"></span></h3></div>
          <div class="form-grid">
            <div class="field"><label>Resend API Key</label><input id="resendApiKey" type="password" placeholder="leave blank to keep current" /></div>
            <div class="field"><label>From Email</label><input id="resendFromEmail" type="email" placeholder="onboarding@resend.dev" /></div>
          </div>
          <p class="text-muted" style="font-size:0.85rem;">Used to send the payment-received notification above, via <a href="https://resend.com" target="_blank">Resend</a>'s free tier. Get an API key from resend.com/api-keys. Leave From Email blank to use Resend's shared sandbox sender (<code>onboarding@resend.dev</code>) &mdash; no domain setup needed to get started; verify your own domain in Resend later if you want to send from your association's own address.</p>
          <div class="toolbar mt-16">
            <button type="submit">Save</button>
            <button type="button" class="secondary" id="testEmailBtn">Send Test Email</button>
          </div>
        </div>
      </form>

      <div class="panel">
        <div class="panel-header"><h3>WhatsApp Reminders <span id="waBadge"></span></h3></div>
        <div id="waContent"></div>
      </div>
    `;

    const settings = await Api.get('/general-settings');
    document.getElementById('appName').value = settings.app_name || '';
    document.getElementById('contactEmail').value = settings.contact_email || '';
    document.getElementById('phoneNumber').value = settings.phone_number || '';
    document.getElementById('officeHours').value = settings.office_hours || '';
    document.getElementById('officeAddress').value = settings.office_address || '';
    document.getElementById('maintenanceAmount').value = settings.maintenance_amount || '';
    document.getElementById('resendFromEmail').value = settings.resend_from_email || '';
    document.getElementById('emailBadge').innerHTML = settings.email_configured
      ? '<span class="badge active">configured</span>'
      : '<span class="badge unpaid">not configured</span>';
    document.getElementById('reminderTime').value = settings.reminder_time || '10:00';
    const selectedDays = new Set((settings.reminder_days || '1,2,3,4,5,7,10').split(',').map((d) => d.trim()));
    document.querySelectorAll('.reminderDay').forEach((cb) => {
      cb.checked = selectedDays.has(cb.value);
    });

    const saveSection = async (payload) => {
      try {
        await Api.put('/general-settings', payload);
        this.showAlert('Saved.', 'success');
        this.render(container);
      } catch (err) {
        this.showAlert(err.message);
      }
    };

    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveSection({
        app_name: document.getElementById('appName').value.trim(),
        contact_email: document.getElementById('contactEmail').value.trim(),
        phone_number: document.getElementById('phoneNumber').value.trim(),
        office_hours: document.getElementById('officeHours').value.trim(),
        office_address: document.getElementById('officeAddress').value.trim(),
      });
    });

    document.getElementById('maintenanceForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveSection({ maintenance_amount: Number(document.getElementById('maintenanceAmount').value) });
    });

    document.getElementById('reminderForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const reminderDays = Array.from(document.querySelectorAll('.reminderDay:checked')).map((cb) => cb.value);
      if (!reminderDays.length) {
        this.showAlert('Pick at least one reminder day');
        return;
      }
      saveSection({
        reminder_days: reminderDays.join(','),
        reminder_time: document.getElementById('reminderTime').value,
      });
    });

    document.getElementById('emailForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveSection({
        resend_api_key: document.getElementById('resendApiKey').value,
        resend_from_email: document.getElementById('resendFromEmail').value.trim(),
      });
    });

    document.getElementById('testEmailBtn').addEventListener('click', async () => {
      const btn = document.getElementById('testEmailBtn');
      btn.disabled = true;
      try {
        const result = await Api.post('/general-settings/test-email');
        this.showAlert(`Test email sent to ${result.to}. Check the inbox.`, 'success');
      } catch (err) {
        this.showAlert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    this.loadWhatsAppStatus();
  },

  // No QR/session to poll with the Business Cloud API - status is just whether
  // WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are set on the server, so a single check on
  // load is enough.
  async loadWhatsAppStatus() {
    const badge = document.getElementById('waBadge');
    const content = document.getElementById('waContent');
    if (!badge || !content) return; // navigated away

    let result;
    try {
      result = await Api.get('/whatsapp/status');
    } catch (err) {
      content.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
      return;
    }

    if (result.status === 'connected') {
      badge.innerHTML = '<span class="badge active">configured</span>';
      content.innerHTML = `
        <p class="text-muted" style="font-size:0.85rem;">Sending via the WhatsApp Business Cloud API. Note: a freeform test message only delivers if this number has messaged your WhatsApp Business number within the last 24 hours - proactive reminders/notifications need an approved Message Template in Meta Business Manager.</p>
        <div class="toolbar">
          <input type="tel" id="waTestPhone" placeholder="e.g. 9876543210" style="max-width:240px;" />
          <button type="button" class="secondary" id="waTestBtn">Send Test Message</button>
        </div>
      `;
      document.getElementById('waTestBtn').addEventListener('click', async () => {
        const phone = document.getElementById('waTestPhone').value.trim();
        if (!phone) return;
        const btn = document.getElementById('waTestBtn');
        btn.disabled = true;
        try {
          await Api.post('/whatsapp/test', { phone });
          this.showAlert(`Test message sent to ${phone}.`, 'success');
        } catch (err) {
          this.showAlert(err.message);
        } finally {
          btn.disabled = false;
        }
      });
      return;
    }

    badge.innerHTML = '<span class="badge unpaid">not configured</span>';
    content.innerHTML = `<p class="text-muted" style="font-size:0.85rem;">Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server (from your Meta Business app) to enable WhatsApp reminders and notifications.</p>`;
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },
};
