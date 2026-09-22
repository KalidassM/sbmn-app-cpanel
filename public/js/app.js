const Util = {
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  money(n) {
    const num = Number(n) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },
  // Same as money(), but for jsPDF exports - jsPDF's built-in fonts (Helvetica/Times/Courier)
  // only cover the Latin-1 range, so the ₹ glyph (U+20B9) renders as a mangled fallback
  // character. No currency symbol/prefix at all, just the plain formatted number.
  moneyPlain(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },
  monthName(m) {
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[Number(m)] || m;
  },
  todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  },
  // Reformats a YYYY-MM-DD (or YYYY-MM-DD HH:MM:SS) string from the DB into DD/MM/YYYY for
  // display in list views - any trailing time portion is kept as-is, just the date part reorders.
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    if (!match) return dateStr;
    const [, y, m, d, rest] = match;
    return `${d}/${m}/${y}${rest}`;
  },
  // Reformats a "YYYY-MM-DD HH:MM:SS" timestamp from the DB (SQLite's datetime('now') stores UTC,
  // with no timezone suffix) into DD/MM/YYYY hh:mm AM/PM in India time - showing the raw UTC value
  // as-is would look ~5:30 hours off from what actually happened locally.
  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(String(dateStr).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  },
  // Just the time-of-day portion of a "YYYY-MM-DD HH:MM:SS" UTC timestamp, in IST - for showing
  // alongside a separately-displayed date (e.g. donation_date) without repeating the date part.
  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(String(dateStr).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  },
  isAdmin(user) {
    return !!user && (user.role === 'admin' || user.role === 'super_admin');
  },
  // Downloads `rows` (array of arrays, first row = header) as a CSV file. Handles quoting/escaping
  // for values containing commas, quotes, or newlines - unlike a hand-built CSV string.
  downloadCsv(filename, rows) {
    const escapeCell = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  // Builds a simple titled table PDF via jsPDF + autoTable (loaded from CDN in portal.html) and
  // triggers a download. `columns` is an array of header labels, `rows` an array of arrays.
  // `options.summary`, if given, is an array of [label, value] pairs rendered as a borderless
  // key/value block above the main table (e.g. the same stat-card totals shown on screen).
  downloadPdf(filename, title, columns, rows, options = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(title, 14, 15);
    let startY = 20;
    if (options.summary && options.summary.length) {
      doc.autoTable({
        body: options.summary,
        startY,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: { top: 1.5, bottom: 1.5, left: 0, right: 4 } },
        columnStyles: { 0: { fontStyle: 'normal', textColor: [90, 90, 90] }, 1: { fontStyle: 'bold', textColor: [47, 111, 78] } },
      });
      startY = doc.lastAutoTable.finalY + 6;
    }
    doc.autoTable({
      head: [columns],
      body: rows,
      startY,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [47, 111, 78] },
    });
    doc.save(filename);
  },
  initials(name) {
    return (name || '')
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  },
  // Downscales an uploaded image client-side before storing it as a base64 data URL
  fileToResizedDataUrl(file, maxDim = 360, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read the selected image'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },
  openModal(innerHtml) {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modalOverlay';
      overlay.className = 'modal-overlay';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) Util.closeModal();
      });
    }
    overlay.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
    overlay.classList.add('open');
  },
  closeModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('open');
  },
};

const NAV_ITEMS = [
  { path: '#/dashboard', label: 'Dashboard', icon: 'bi-speedometer2' },
  { path: '#/profile', label: 'My Profile', icon: 'bi-person-circle' },
  { path: '#/members', label: 'Members', icon: 'bi-people' },
  { path: '#/core-members', label: 'Core Members', icon: 'bi-person-badge' },
  { path: '#/maintenance', label: 'Maintenance', icon: 'bi-house-gear' },
  { path: '#/reminders', label: 'Reminders', icon: 'bi-bell', adminOnly: true },
  { path: '#/expenses', label: 'Expenses & Petty Cash', icon: 'bi-cash-coin' },
  { path: '#/events', label: 'Events', icon: 'bi-calendar-event' },
  { path: '#/notices', label: 'Notices', icon: 'bi-megaphone' },
  { path: '#/donations', label: 'Donations', icon: 'bi-heart' },
  { path: '#/contact-messages', label: 'Contact Messages', icon: 'bi-envelope', adminOnly: true },
  { path: '#/users', label: 'Login Accounts', icon: 'bi-shield-lock', adminOnly: true },
  { path: '#/payment-settings', label: 'Payment Settings', icon: 'bi-credit-card', superAdminOnly: true },
  { path: '#/general-settings', label: 'General Settings', icon: 'bi-gear', superAdminOnly: true },
  { path: '#/reports', label: 'ITR Report', icon: 'bi-file-earmark-text', adminOnly: true },
  { path: '#/activity-log', label: 'Activity Log', icon: 'bi-clock-history', adminOnly: true },
];

const PAGES = {
  '#/dashboard': window.DashboardPage,
  '#/profile': window.ProfilePage,
  '#/members': window.MembersPage,
  '#/core-members': window.CoreMembersPage,
  '#/events': window.EventsPage,
  '#/notices': window.NoticesPage,
  '#/maintenance': window.MaintenancePage,
  '#/reminders': window.RemindersPage,
  '#/expenses': window.ExpensesPage,
  '#/donations': window.DonationsPage,
  '#/contact-messages': window.ContactMessagesPage,
  '#/users': window.UsersPage,
  '#/reports': window.ReportsPage,
  '#/activity-log': window.ActivityLogPage,
  '#/payment-settings': window.PaymentSettingsPage,
  '#/general-settings': window.GeneralSettingsPage,
  '#/change-password-required': window.ChangePasswordRequiredPage,
};

function renderShell() {
  const user = Api.getUser();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-wrapper">
      <nav class="app-header navbar navbar-expand bg-body">
        <div class="container-fluid">
          <ul class="navbar-nav">
            <li class="nav-item">
              <a class="nav-link" data-lte-toggle="sidebar" href="#" role="button" aria-label="Toggle sidebar">
                <i class="bi bi-list"></i>
              </a>
            </li>
          </ul>
          <ul class="navbar-nav ms-auto">
            <li class="nav-item d-none d-sm-flex align-items-center">
              <span class="nav-link disabled">
                Signed in as <strong>${Util.escapeHtml(user.username)}</strong>
                <span class="role-tag">${user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Core Member / Admin' : 'Member'}</span>
              </span>
            </li>
            <li class="nav-item">
              <a href="/" class="nav-link" title="Public Site" aria-label="Public Site"><i class="bi bi-house"></i></a>
            </li>
            <li class="nav-item">
              <a href="#" id="logoutBtn" class="nav-link" title="Log out" aria-label="Log out"><i class="bi bi-box-arrow-right"></i></a>
            </li>
          </ul>
        </div>
      </nav>

      <aside class="app-sidebar bg-body-secondary shadow" data-bs-theme="dark">
        <div class="sidebar-brand">
          <a href="#/dashboard" class="brand-link">
            <span class="brand-text fw-light" id="sidebarBrandText">SBMN APP</span>
          </a>
        </div>
        <div class="sidebar-wrapper">
          <nav class="mt-2" aria-label="Main navigation">
            <ul class="nav sidebar-menu flex-column" id="nav"></ul>
          </nav>
        </div>
      </aside>

      <main class="app-main">
        <div class="app-content">
          <div class="container-fluid main" id="main"></div>
        </div>
      </main>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault();
    Api.clearSession();
    window.location.hash = '#/login';
  });

  Api.get('/general-settings')
    .then((s) => {
      if (s.app_name) {
        // document.getElementById('sidebarBrandText').textContent = s.app_name;
        document.title = s.app_name;
      }
    })
    .catch(() => {});
}

function renderNav(activePath) {
  const user = Api.getUser();
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || user.role === 'admin' || user.role === 'super_admin') &&
      (!item.superAdminOnly || user.role === 'super_admin')
  )
    .map(
      (item) => `
      <li class="nav-item">
        <a href="${item.path}" class="nav-link ${item.path === activePath ? 'active' : ''}">
          <i class="nav-icon bi ${item.icon}"></i>
          <p>${item.label}</p>
        </a>
      </li>`
    )
    .join('');

  // On mobile the sidebar opens as an overlay (body.sidebar-open); close it after picking a page
  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) {
        const sidebar = document.querySelector('.app-sidebar');
        if (sidebar && window.adminlte) {
          window.adminlte.PushMenu.getOrCreateInstance(sidebar).collapse();
        }
      }
    })
  );
}

async function router() {
  let hash = window.location.hash || '#/dashboard';
  const user = Api.getUser();
  const token = Api.getToken();

  if (!token || !user) {
    if (hash !== '#/login' && hash !== '#/forgot-password') {
      window.location.hash = '#/login';
      return;
    }
    const app = document.getElementById('app');
    app.innerHTML = '';
    if (hash === '#/forgot-password') {
      window.ForgotPasswordPage.render(app);
    } else {
      window.LoginPage.render(app);
    }
    return;
  }

  if (hash === '#/login' || hash === '#/forgot-password') {
    window.location.hash = '#/dashboard';
    return;
  }

  // Bulk-created (and any explicitly flagged) accounts must set a real password before doing
  // anything else - every navigation attempt bounces back here until that's done.
  if (user.must_change_password && hash !== '#/change-password-required') {
    window.location.hash = '#/change-password-required';
    return;
  }
  if (!user.must_change_password && hash === '#/change-password-required') {
    window.location.hash = '#/dashboard';
    return;
  }

  const navItem = NAV_ITEMS.find((item) => item.path === hash);
  if (navItem && navItem.superAdminOnly && user.role !== 'super_admin') {
    window.location.hash = '#/dashboard';
    return;
  }
  if (navItem && navItem.adminOnly && user.role !== 'admin' && user.role !== 'super_admin') {
    window.location.hash = '#/dashboard';
    return;
  }

  if (!document.querySelector('.shell')) {
    renderShell();
  }
  renderNav(hash);

  const page = PAGES[hash];
  const main = document.getElementById('main');
  if (!page) {
    main.innerHTML = '<h1>Not found</h1>';
    return;
  }
  try {
    await page.render(main);
  } catch (err) {
    main.innerHTML = `<div class="alert error">${Util.escapeHtml(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
