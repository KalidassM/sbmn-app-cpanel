window.MaintenancePage = {
  state: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), statusFilter: 'all' },
  currentPayments: [],
  selectedIds: new Set(),

  async render(container) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    const { month, year } = this.state;

    container.innerHTML = `
      <h1>Monthly Maintenance</h1>
      <p class="page-sub">Track maintenance dues collection</p>
      ${!isAdmin ? `<p class="page-sub" style="margin-top:-14px;">Want to pay online yourself? Visit <a href="/pay-monthly-maintenance" target="_blank">the maintenance payment page</a>.</p>` : ''}
      <div id="alertBox"></div>

      <div class="stat-grid" id="monthSummary"></div>

      <div class="panel">
        <div class="panel-header">
          <h3>Maintenance Dues</h3>
          <div class="toolbar" style="flex-direction: column; gap: 24px;">
            <div style="display: flex; gap: 16px; justify-content:flex-start; flex-wrap:nowrap;">
              <select id="yearSelect"></select>
              <select id="monthSelect"></select>
              <select id="statusFilter">
                <option value="all">All</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
              <div style="gap: 16px;display: flex;">
                ${isAdmin ? '<button id="recordPaymentBtn">Record Payment</button>' : ''}
                ${isAdmin ? '<button class="secondary" id="bulkMarkPaidBtn">Mark Selected as Paid</button>' : ''}
              </div>
              ${
                isAdmin
                  ? `<div style="gap: 16px;display: flex;">
                      <button type="button" class="secondary" id="exportDuesBtn">Export CSV</button>
                      <button type="button" class="secondary" id="exportDuesPdfBtn">Export PDF</button>
                    </div>`
                  : ''
              }
            </div>
          </div>
        </div>
        <table>
          <thead><tr>${isAdmin ? '<th><input type="checkbox" id="selectAllRows" /></th>' : ''}<th>Site No</th><th>Member</th><th>Amount Due</th><th>Amount Paid</th><th>Paid Date</th><th>Mode</th><th>Reference</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody id="paymentRows"><tr><td colspan="10">Loading…</td></tr></tbody>
        </table>
      </div>
    `;

    this.populateMonthYearSelects();
    document.getElementById('monthSelect').addEventListener('change', (e) => {
      this.state.month = Number(e.target.value);
      this.loadDues();
    });
    document.getElementById('yearSelect').addEventListener('change', (e) => {
      this.state.year = Number(e.target.value);
      this.loadDues();
    });
    document.getElementById('statusFilter').value = this.state.statusFilter;
    document.getElementById('statusFilter').addEventListener('change', (e) => {
      this.state.statusFilter = e.target.value;
      this.renderRows();
    });
    if (isAdmin) {
      document.getElementById('exportDuesBtn').addEventListener('click', () => this.showExportModal('csv'));
      document.getElementById('exportDuesPdfBtn').addEventListener('click', () => this.showExportModal('pdf'));
      document.getElementById('recordPaymentBtn').addEventListener('click', () => this.showRecordPaymentModal());
      document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => this.bulkMarkPaid());
    }

    await this.loadDues();
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

  async loadDues() {
    const { month, year } = this.state;
    let payments = await Api.get(`/maintenance/payments?month=${month}&year=${year}`);
    const user = Api.getUser();
    if (!Util.isAdmin(user) && user.member_id) {
      payments = payments.filter((p) => p.member_id === user.member_id);
    }
    this.currentPayments = payments;
    this.selectedIds.clear();
    this.renderSummary();
    this.renderRows();
  },

  renderSummary() {
    const box = document.getElementById('monthSummary');
    if (!box) return;
    const totalPaid = this.currentPayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const totalPending = this.currentPayments.reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0);
    box.innerHTML = `
      <div class="stat-card"><div class="label">Paid (${Util.monthName(this.state.month)} ${this.state.year})</div><div class="value">${Util.money(totalPaid)}</div></div>
      <div class="stat-card ${totalPending > 0 ? 'negative' : ''}"><div class="label">Not Paid (${Util.monthName(this.state.month)} ${this.state.year})</div><div class="value">${Util.money(totalPending)}</div></div>
    `;
  },

  async bulkMarkPaid() {
    if (!this.selectedIds.size) {
      this.showAlert('Select one or more unpaid/partial dues first');
      return;
    }
    if (!confirm(`Mark ${this.selectedIds.size} due(s) as fully paid?`)) return;
    const btn = document.getElementById('bulkMarkPaidBtn');
    btn.disabled = true;
    try {
      const result = await Api.post('/maintenance/payments/bulk-mark-paid', { ids: Array.from(this.selectedIds) });
      this.showAlert(`${result.updated} due(s) marked as paid.`, 'success');
      await this.loadDues();
    } catch (err) {
      this.showAlert(err.message);
    } finally {
      btn.disabled = false;
    }
  },

  getFilteredSortedPayments() {
    const filter = this.state.statusFilter;
    const statusRank = { paid: 0, partial: 1, unpaid: 1 };
    // Matches the CAST(site_no AS INTEGER), site_no ordering used for Members - a fixed per-item
    // key (not a per-pair numeric/string decision), so the sort stays consistent even when some
    // Site Nos are plain numbers and others are alphanumeric (e.g. "12A").
    const siteNoNumericKey = (siteNo) => {
      const n = parseInt(siteNo, 10);
      return Number.isNaN(n) ? 0 : n;
    };
    return (filter === 'all' ? this.currentPayments : this.currentPayments.filter((p) => p.status === filter))
      .slice()
      .sort(
        (a, b) =>
          statusRank[a.status] - statusRank[b.status] ||
          siteNoNumericKey(a.site_no) - siteNoNumericKey(b.site_no) ||
          String(a.site_no || '').localeCompare(String(b.site_no || ''))
      );
  },

  // Builds the inclusive list of {month, year} pairs between two month/year points, regardless
  // of which end the caller passes first. Capped at 60 months so a mistaken multi-decade range
  // (or swapped year fields) can't trigger hundreds of API calls.
  getMonthYearRange(fromMonth, fromYear, toMonth, toYear) {
    const toIndex = (m, y) => y * 12 + (m - 1);
    let startIdx = toIndex(fromMonth, fromYear);
    let endIdx = toIndex(toMonth, toYear);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
    endIdx = Math.min(endIdx, startIdx + 59);
    const pairs = [];
    for (let idx = startIdx; idx <= endIdx; idx += 1) {
      pairs.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
    }
    return pairs;
  },

  getRangeLabel(startDate, endDate) {
    return startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
  },

  getRangeTitle(startDate, endDate) {
    return startDate === endDate ? Util.formatDate(startDate) : `${Util.formatDate(startDate)} – ${Util.formatDate(endDate)}`;
  },

  async fetchPaymentsForRange(pairs) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    const filter = this.state.statusFilter;
    const statusRank = { paid: 0, partial: 1, unpaid: 1 };
    const siteNoNumericKey = (siteNo) => {
      const n = parseInt(siteNo, 10);
      return Number.isNaN(n) ? 0 : n;
    };
    const results = await Promise.all(pairs.map((p) => Api.get(`/maintenance/payments?month=${p.month}&year=${p.year}`)));

    const rows = [];
    pairs.forEach((p, idx) => {
      let payments = results[idx];
      if (!isAdmin && user.member_id) payments = payments.filter((x) => x.member_id === user.member_id);
      if (filter !== 'all') payments = payments.filter((x) => x.status === filter);
      payments
        .slice()
        .sort(
          (a, b) =>
            statusRank[a.status] - statusRank[b.status] ||
            siteNoNumericKey(a.site_no) - siteNoNumericKey(b.site_no) ||
            String(a.site_no || '').localeCompare(String(b.site_no || ''))
        )
        .forEach((x) => rows.push({ ...x, _month: p.month, _year: p.year }));
    });
    return rows;
  },

  computeRangeTotals(payments) {
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const totalPending = payments.reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0);
    return { totalPaid, totalPending };
  },

  async exportCsvForRange(pairs, startDate, endDate) {
    const payments = await this.fetchPaymentsForRange(pairs);
    const { totalPaid, totalPending } = this.computeRangeTotals(payments);
    const rangeTitle = this.getRangeTitle(startDate, endDate);
    const rows = [
      [`Maintenance Dues - ${rangeTitle}`],
      [`Paid (${rangeTitle})`, totalPaid],
      [`Not Paid (${rangeTitle})`, totalPending],
      [],
      ['Month', 'Year', 'Site No', 'Member', 'Amount Due', 'Amount Paid', 'Paid Date', 'Mode', 'Reference', 'Status'],
      ...payments.map((p) => [
        Util.monthName(p._month),
        p._year,
        p.site_no || '',
        p.member_name,
        p.amount_due,
        p.amount_paid,
        p.paid_date || '',
        p.payment_mode || '',
        p.reference_no || '',
        p.status,
      ]),
    ];
    Util.downloadCsv(`maintenance-dues-${this.getRangeLabel(startDate, endDate)}.csv`, rows);
  },

  async exportPdfForRange(pairs, startDate, endDate) {
    const payments = await this.fetchPaymentsForRange(pairs);
    const { totalPaid, totalPending } = this.computeRangeTotals(payments);
    const rangeTitle = this.getRangeTitle(startDate, endDate);
    const summary = [
      [`Paid (${rangeTitle})`, Util.moneyPlain(totalPaid)],
      [`Not Paid (${rangeTitle})`, Util.moneyPlain(totalPending)],
    ];
    const columns = ['Month', 'Site No', 'Member', 'Amount Due', 'Amount Paid', 'Paid Date', 'Mode', 'Reference', 'Status'];
    const rows = payments.map((p) => [
      `${Util.monthName(p._month)} ${p._year}`,
      p.site_no || '-',
      p.member_name,
      Util.moneyPlain(p.amount_due),
      Util.moneyPlain(p.amount_paid),
      Util.formatDate(p.paid_date),
      p.payment_mode || '-',
      p.reference_no || '-',
      p.status,
    ]);
    Util.downloadPdf(`maintenance-dues-${this.getRangeLabel(startDate, endDate)}.pdf`, `Maintenance Dues - ${rangeTitle}`, columns, rows, { summary });
  },

  showExportModal(format) {
    const thisYear = new Date().getFullYear();
    const years = [thisYear, thisYear - 1, thisYear - 2];
    const yearOptions = years.map((y) => `<option value="${y}" ${y === this.state.year ? 'selected' : ''}>${y}</option>`).join('');
    const label = format === 'csv' ? 'CSV' : 'PDF';
    const defaultFrom = Util.todayISO();
    const defaultTo = Util.todayISO();

    Util.openModal(`
      <h3>Export ${label}</h3>
      <form id="exportRangeForm" style="text-align:left;">
        <div class="field"><label>Option</label>
          <select id="er_option">
            <option value="custom" selected>Custom Range</option>
            <option value="full">Full Year</option>
          </select>
        </div>
        <div class="field"><label>Year</label><select id="er_year">${yearOptions}</select></div>
        <div id="er_customFields" class="form-grid">
          <div class="field"><label>From Date</label><input type="date" id="er_fromDate" value="${defaultFrom}" /></div>
          <div class="field"><label>To Date</label><input type="date" id="er_toDate" value="${defaultTo}" /></div>
        </div>
        <div class="toolbar close-modal mt-16" style="justify-content:center;">
          <button type="submit">Export ${label}</button>
          <button type="button" class="secondary" id="closeExportRangeModalBtn">Cancel</button>
        </div>
      </form>
    `);

    const optionSelect = document.getElementById('er_option');
    const yearSelect = document.getElementById('er_year');
    const customFields = document.getElementById('er_customFields');
    const fromDateInput = document.getElementById('er_fromDate');
    const toDateInput = document.getElementById('er_toDate');

    const syncVisibility = () => {
      customFields.style.display = optionSelect.value === 'custom' ? '' : 'none';
    };
    syncVisibility();

    optionSelect.addEventListener('change', syncVisibility);
    yearSelect.addEventListener('change', (e) => {
      if (optionSelect.value !== 'custom') return;
      fromDateInput.value = `${e.target.value}-01-01`;
      toDateInput.value = `${e.target.value}-12-31`;
    });

    document.getElementById('closeExportRangeModalBtn').addEventListener('click', () => Util.closeModal());

    document.getElementById('exportRangeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const year = Number(yearSelect.value);
      let pairs;
      let startDate;
      let endDate;
      if (optionSelect.value === 'full') {
        pairs = this.getMonthYearRange(1, year, 12, year);
        startDate = `${year}-01-01`;
        endDate = `${year}-12-31`;
      } else {
        const fromDate = fromDateInput.value;
        const toDate = toDateInput.value;
        if (!fromDate || !toDate) {
          this.showAlert('Select both a From date and a To date.');
          return;
        }
        if (fromDate > toDate) {
          this.showAlert('From date must not be after To date.');
          return;
        }
        pairs = this.getMonthYearRange(
          Number(fromDate.slice(5, 7)),
          Number(fromDate.slice(0, 4)),
          Number(toDate.slice(5, 7)),
          Number(toDate.slice(0, 4))
        );
        startDate = fromDate;
        endDate = toDate;
      }
      const submitBtn = e.target.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        if (format === 'csv') await this.exportCsvForRange(pairs, startDate, endDate);
        else await this.exportPdfForRange(pairs, startDate, endDate);
        Util.closeModal();
      } catch (err) {
        this.showAlert(err.message);
      } finally {
        submitBtn.disabled = false;
      }
    });
  },

  renderRows() {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    const payments = this.getFilteredSortedPayments();

    const rows = document.getElementById('paymentRows');
    if (!payments.length) {
      rows.innerHTML = `<tr class="empty-row"><td colspan="10">No dues match this view</td></tr>`;
      return;
    }
    rows.innerHTML = payments
      .map(
        (p) => `
      <tr>
        ${
          isAdmin
            ? `<td>${p.status !== 'paid' ? `<input type="checkbox" class="rowSelect" value="${p.id}" ${this.selectedIds.has(p.id) ? 'checked' : ''} />` : ''}</td>`
            : ''
        }
        <td>${Util.escapeHtml(p.site_no || '-')}</td>
        <td>${Util.escapeHtml(p.member_name)}</td>
        <td>${Util.money(p.amount_due)}</td>
        <td>${Util.money(p.amount_paid)}</td>
        <td>${Util.formatDate(p.paid_date)}${p.paid_at ? `<br><span class="text-muted" style="font-size:0.78rem;">${Util.formatTime(p.paid_at)}</span>` : ''}</td>
        <td>${Util.escapeHtml(p.payment_mode || '-')}</td>
        <td>${Util.escapeHtml(p.reference_no || '-')}</td>
        <td><span class="badge ${p.status}">${p.status}</span></td>
        ${
          isAdmin
            ? `<td class="toolbar">
                <button class="small secondary" data-edit="${p.id}">Edit</button>
                <button class="small danger" data-delete="${p.id}">Delete</button>
              </td>`
            : ''
        }
      </tr>`
      )
      .join('');

    if (isAdmin) {
      rows.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const payment = this.currentPayments.find((x) => String(x.id) === btn.dataset.edit);
          this.showEditModal(payment);
        })
      );
      rows.querySelectorAll('[data-delete]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this due record? This cannot be undone.')) return;
          try {
            await Api.del(`/maintenance/payments/${btn.dataset.delete}`);
            await this.loadDues();
          } catch (err) {
            this.showAlert(err.message);
          }
        })
      );
      rows.querySelectorAll('.rowSelect').forEach((cb) =>
        cb.addEventListener('change', () => {
          const id = Number(cb.value);
          if (cb.checked) this.selectedIds.add(id);
          else this.selectedIds.delete(id);
          const selectAll = document.getElementById('selectAllRows');
          if (selectAll) selectAll.checked = rows.querySelectorAll('.rowSelect').length === rows.querySelectorAll('.rowSelect:checked').length;
        })
      );
      const selectAll = document.getElementById('selectAllRows');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = () => {
          rows.querySelectorAll('.rowSelect').forEach((cb) => {
            cb.checked = selectAll.checked;
            const id = Number(cb.value);
            if (selectAll.checked) this.selectedIds.add(id);
            else this.selectedIds.delete(id);
          });
        };
      }
    }
  },

  showEditModal(payment) {
    Util.openModal(`
      <h3>Edit Due</h3>
      <p class="text-muted">${Util.escapeHtml(payment.site_no || '-')} — ${Util.escapeHtml(payment.member_name)} — ${Util.monthName(payment.month)} ${payment.year}</p>
      <form id="editDueForm" style="text-align:left;">
        <div class="field"><label>Amount Due</label><input id="ed_amount_due" type="number" step="0.01" min="0" required value="${payment.amount_due}" /></div>
        <div class="field"><label>Amount Paid</label><input id="ed_amount_paid" type="number" step="0.01" min="0" required value="${payment.amount_paid}" /></div>
        <div class="field"><label>Status</label>
          <select id="ed_status">
            <option value="unpaid" ${payment.status !== 'paid' ? 'selected' : ''}>Unpaid</option>
            <option value="paid" ${payment.status === 'paid' ? 'selected' : ''}>Paid</option>
          </select>
        </div>
        <div class="field"><label>Paid Date</label><input id="ed_date" type="date" value="${payment.paid_date || ''}" /></div>
        <div class="field"><label>Payment Mode</label>
          <select id="ed_mode">
            <option value="" ${!payment.payment_mode ? 'selected' : ''}>-</option>
            <option value="Cash" ${payment.payment_mode === 'Cash' ? 'selected' : ''}>Cash</option>
            <option value="UPI" ${payment.payment_mode === 'UPI' ? 'selected' : ''}>UPI</option>
            <option value="Card" ${payment.payment_mode === 'Card' ? 'selected' : ''}>Card</option>
            <option value="Bank Transfer" ${payment.payment_mode === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer</option>
            <option value="Cheque" ${payment.payment_mode === 'Cheque' ? 'selected' : ''}>Cheque</option>
            <option value="Razorpay" ${payment.payment_mode === 'Razorpay' ? 'selected' : ''}>Razorpay</option>
            <option value="Other" ${payment.payment_mode === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="field"><label>Transaction / Reference No</label><input id="ed_reference" value="${Util.escapeHtml(payment.reference_no || '')}" /></div>
        <div class="toolbar close-modal mt-16" style="justify-content:center;">
          <button type="submit">Save</button>
          <button type="button" class="secondary" id="closeEditModalBtn">Cancel</button>
        </div>
      </form>
    `);
    document.getElementById('closeEditModalBtn').addEventListener('click', () => Util.closeModal());
    document.getElementById('editDueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountDue = Number(document.getElementById('ed_amount_due').value);
      const amountPaid = Number(document.getElementById('ed_amount_paid').value);
      // "Unpaid" is the dropdown's fallback option (Partial isn't selectable anymore) - only force
      // a status when the admin explicitly picks "Paid", otherwise let the server derive
      // unpaid/partial/paid from the amounts so a partially-paid due isn't silently flipped to unpaid
      const statusChoice = document.getElementById('ed_status').value;
      const paidDate = document.getElementById('ed_date').value || null;
      const paymentMode = document.getElementById('ed_mode').value;
      const referenceNo = document.getElementById('ed_reference').value.trim();
      try {
        await Api.put(`/maintenance/payments/${payment.id}`, {
          amount_due: amountDue,
          amount_paid: amountPaid,
          status: statusChoice === 'paid' ? 'paid' : undefined,
          paid_date: paidDate,
          payment_mode: paymentMode || null,
          reference_no: referenceNo || null,
        });
        Util.closeModal();
        await this.loadDues();
        this.showAlert('Due updated.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });
  },

  showRecordPaymentModal() {
    const unpaid = this.currentPayments.filter((p) => p.status !== 'paid');
    if (!unpaid.length) {
      this.showAlert('Everyone in this view has already paid in full.', 'success');
      return;
    }
    const options = unpaid
      .map((p) => {
        const remaining = Number(p.amount_due) - Number(p.amount_paid);
        return `<option value="${p.id}">${Util.escapeHtml(p.site_no || '-')} — ${Util.escapeHtml(p.member_name)} (${Util.money(remaining)} due)</option>`;
      })
      .join('');

    Util.openModal(`
      <h3>Record Payment</h3>
      <form id="recordPaymentForm" style="text-align:left;">
        <div class="field"><label>Member</label><select id="rp_payment" required>${options}</select></div>
        <div class="field"><label>Amount Paid</label><input id="rp_amount" type="number" step="0.01" min="0" required /></div>
        <div class="field"><label>Payment Date</label><input id="rp_date" type="date" required value="${Util.todayISO()}" /></div>
        <div class="field"><label>Payment Mode</label>
          <select id="rp_mode">
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
            <option value="Card">Card</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Cheque">Cheque</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="field"><label>Transaction / Reference No (optional)</label><input id="rp_reference" placeholder="e.g. UPI ref, cheque no..." /></div>
        <p class="text-muted" style="font-size:0.8rem;">Use this for cash or bank-transfer payments collected outside the app. Enter less than the full amount to record a partial payment.</p>
        <div class="toolbar close-modal mt-16" style="justify-content:center;">
          <button type="submit">Save</button>
          <button type="button" class="secondary" id="closeRecordModalBtn">Cancel</button>
        </div>
      </form>
    `);

    const paymentSelect = document.getElementById('rp_payment');
    const amountInput = document.getElementById('rp_amount');
    const fillAmount = () => {
      const p = unpaid.find((x) => String(x.id) === paymentSelect.value);
      amountInput.value = p ? Number(p.amount_due) - Number(p.amount_paid) : '';
    };
    fillAmount();
    paymentSelect.addEventListener('change', fillAmount);

    document.getElementById('closeRecordModalBtn').addEventListener('click', () => Util.closeModal());
    document.getElementById('recordPaymentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payment = unpaid.find((x) => String(x.id) === paymentSelect.value);
      const amountPaid = Number(amountInput.value);
      const paidDate = document.getElementById('rp_date').value;
      const paymentMode = document.getElementById('rp_mode').value;
      const referenceNo = document.getElementById('rp_reference').value.trim();
      if (!payment || !paidDate || amountPaid < 0) return;
      const status = amountPaid >= Number(payment.amount_due) ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
      try {
        await Api.put(`/maintenance/payments/${payment.id}`, {
          amount_paid: amountPaid,
          status,
          paid_date: paidDate,
          payment_mode: paymentMode,
          reference_no: referenceNo || null,
        });
        Util.closeModal();
        await this.loadDues();
        this.showAlert('Payment recorded.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });
  },
};
