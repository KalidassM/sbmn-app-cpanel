const EXPENSE_CATEGORIES = [
  'Waterman Monthly Tips',
  'Garbage man Tips',
  'CCTV Sim Recharge',
  'Plumbing Meterial',
  'Plumber Expenses',
  'Electrician Expenses',
  'Street Light Fix - EB',
  'Meeting Chair Expenses',
  'Meeting Snakes Expenses',
  'Public Place Cleaning Expenses',
  'Celebration Expenses',
  'Stationary Expenses',
  'Miscellaneous Expenses',
];

window.ExpensesPage = {
  currentExpenses: [],
  currentTransactions: [],
  pettyCashSummary: { balance: 0, totalTopups: 0, totalExpenses: 0 },
  filters: { year: '', from: '', to: '' },

  async render(container) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    this.filters = { year: '', from: '', to: '' };

    container.innerHTML = `
      <h1>Expenses & Petty Cash</h1>
      <p class="page-sub">Track association expenses and the day-to-day petty cash box in one place</p>
      <div id="alertBox"></div>
      <datalist id="expenseCategoryOptions">${EXPENSE_CATEGORIES.map((c) => `<option value="${Util.escapeHtml(c)}"></option>`).join('')}</datalist>

      <div class="panel">
        <div class="panel-header"><h3>Filters</h3></div>
        <div class="form-grid">
          <div class="field"><label>Year</label>
            <select id="filterYear"><option value="">All Years</option></select>
          </div>
          <div class="field"><label>From Date</label><input type="date" id="filterFrom" /></div>
          <div class="field"><label>To Date</label><input type="date" id="filterTo" /></div>
        </div>
        <div class="toolbar mt-16">
          <button type="button" class="secondary" id="clearFiltersBtn">Clear Filters</button>
        </div>
      </div>

      <div class="stat-grid" id="expenseSummary"></div>

      <div class="panel">
        <div class="panel-header">
          <h3>All Entries</h3>
          ${
            isAdmin
              ? `<div class="toolbar">
                  <button type="button" class="secondary" id="exportEntriesBtn">Export CSV</button>
                  <button type="button" class="secondary" id="exportEntriesPdfBtn">Export PDF</button>
                </div>`
              : ''
          }
        </div>
        ${isAdmin ? '<div id="entryForm"></div>' : ''}
        <table>
          <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Source</th><th>Amount</th><th>Notes</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody id="entryRows"><tr><td colspan="7">Loading…</td></tr></tbody>
        </table>
      </div>
    `;

    document.getElementById('filterYear').addEventListener('change', (e) => {
      this.filters.year = e.target.value;
      this.renderSummary();
      this.renderEntries();
    });
    document.getElementById('filterFrom').addEventListener('change', (e) => {
      this.filters.from = e.target.value;
      this.renderSummary();
      this.renderEntries();
    });
    document.getElementById('filterTo').addEventListener('change', (e) => {
      this.filters.to = e.target.value;
      this.renderSummary();
      this.renderEntries();
    });
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      this.filters = { year: '', from: '', to: '' };
      document.getElementById('filterYear').value = '';
      document.getElementById('filterFrom').value = '';
      document.getElementById('filterTo').value = '';
      this.renderSummary();
      this.renderEntries();
    });

    if (isAdmin) {
      document.getElementById('exportEntriesBtn').addEventListener('click', () => this.exportEntriesCsv());
      document.getElementById('exportEntriesPdfBtn').addEventListener('click', () => this.exportEntriesPdf());
      this.renderEntryForm();
    }

    await this.refresh();
  },

  async refresh() {
    await Promise.all([this.loadExpenses(), this.loadPettyCash()]);
    this.populateYearOptions();
    this.renderSummary();
    this.renderEntries();
  },

  populateYearOptions() {
    const select = document.getElementById('filterYear');
    if (!select) return;
    const years = new Set(this.getUnifiedEntries().map((e) => e.date && e.date.slice(0, 4)).filter(Boolean));
    years.add(String(new Date().getFullYear()));
    const sorted = [...years].sort((a, b) => b - a);
    const current = this.filters.year;
    select.innerHTML = `<option value="">All Years</option>${sorted
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('')}`;
  },

  matchesFilters(entry) {
    const { year, from, to } = this.filters;
    if (year && !entry.date?.startsWith(year)) return false;
    if (from && entry.date < from) return false;
    if (to && entry.date > to) return false;
    return true;
  },

  getFilteredEntries() {
    return this.getUnifiedEntries().filter((e) => this.matchesFilters(e));
  },

  async loadExpenses() {
    this.currentExpenses = await Api.get('/expenses');
  },

  async loadPettyCash() {
    const { transactions, summary } = await Api.get('/petty-cash');
    this.currentTransactions = transactions;
    this.pettyCashSummary = summary;
  },

  getUnifiedEntries() {
    const bankRows = this.currentExpenses
      .filter((ex) => ex.source !== 'petty_cash')
      .map((ex) => ({
        kind: 'bank',
        id: ex.id,
        date: ex.expense_date,
        title: ex.title,
        category: ex.category,
        amount: ex.amount,
        notes: ex.notes,
        sourceLabel: 'Bank',
      }));
    const pettyCashRows = this.currentTransactions.map((t) => ({
      kind: t.type === 'topup' ? 'pc_topup' : 'pc_expense',
      id: t.id,
      date: t.txn_date,
      title: t.description,
      category: t.category,
      amount: t.amount,
      notes: null,
      sourceLabel: t.type === 'topup' ? 'Petty Cash Top-up' : 'Petty Cash',
    }));
    return [...bankRows, ...pettyCashRows].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    });
  },

  getFilterSuffix() {
    const { year, from, to } = this.filters;
    if (year) return `-${year}`;
    if (from || to) return `-${from || 'start'}_to_${to || 'end'}`;
    return '';
  },

  exportEntriesCsv() {
    const rows = [
      ['Date', 'Title', 'Category', 'Source', 'Amount', 'Notes'],
      ...this.getFilteredEntries().map((e) => [e.date, e.title, e.category || '', e.sourceLabel, e.amount, e.notes || '']),
    ];
    Util.downloadCsv(`expenses-petty-cash${this.getFilterSuffix()}-${Util.todayISO()}.csv`, rows);
  },

  exportEntriesPdf() {
    const columns = ['Date', 'Title', 'Category', 'Source', 'Amount', 'Notes'];
    const rows = this.getFilteredEntries().map((e) => [
      Util.formatDate(e.date),
      e.title,
      e.category || '-',
      e.sourceLabel,
      Util.moneyPlain(e.amount),
      e.notes || '-',
    ]);
    const stats = this.computeSummaryStats();
    const summary = [
      ['Bank Expenses', Util.moneyPlain(stats.bankTotal)],
      ['Petty Cash Expenses', Util.moneyPlain(stats.pettyCashExpenseTotal)],
      ['Total Expenses', Util.moneyPlain(stats.bankTotal + stats.pettyCashExpenseTotal)],
      [`Petty Cash Topped Up${stats.hasFilter ? ' (Filtered)' : ''}`, Util.moneyPlain(stats.topupTotal)],
      ['Petty Cash In Hand (Current)', Util.moneyPlain(stats.balance)],
    ];
    Util.downloadPdf(`expenses-petty-cash${this.getFilterSuffix()}-${Util.todayISO()}.pdf`, 'Expenses & Petty Cash Report', columns, rows, { summary });
  },

  showAlert(message, type = 'error') {
    const box = document.getElementById('alertBox');
    if (box) box.innerHTML = `<div class="alert ${type}">${Util.escapeHtml(message)}</div>`;
  },

  computeSummaryStats() {
    const filtered = this.getFilteredEntries();
    const bankTotal = filtered.filter((e) => e.kind === 'bank').reduce((sum, e) => sum + Number(e.amount), 0);
    const pettyCashExpenseTotal = filtered.filter((e) => e.kind === 'pc_expense').reduce((sum, e) => sum + Number(e.amount), 0);
    const topupTotal = filtered.filter((e) => e.kind === 'pc_topup').reduce((sum, e) => sum + Number(e.amount), 0);
    const hasFilter = Boolean(this.filters.year || this.filters.from || this.filters.to);
    return { bankTotal, pettyCashExpenseTotal, topupTotal, balance: this.pettyCashSummary.balance, hasFilter };
  },

  renderSummary() {
    const box = document.getElementById('expenseSummary');
    if (!box) return;
    const { bankTotal, pettyCashExpenseTotal, topupTotal, balance, hasFilter } = this.computeSummaryStats();
    box.innerHTML = `
      <div class="stat-card"><div class="label">Bank Expenses</div><div class="value">${Util.money(bankTotal)}</div></div>
      <div class="stat-card"><div class="label">Petty Cash Expenses</div><div class="value">${Util.money(pettyCashExpenseTotal)}</div></div>
      <div class="stat-card"><div class="label">Total Expenses</div><div class="value">${Util.money(bankTotal + pettyCashExpenseTotal)}</div></div>
      <div class="stat-card"><div class="label">Petty Cash Topped Up${hasFilter ? ' (Filtered)' : ''}</div><div class="value">${Util.money(topupTotal)}</div></div>
      <div class="stat-card ${balance < 0 ? 'negative' : ''}"><div class="label">Petty Cash In Hand (Current)</div><div class="value">${Util.money(balance)}</div></div>
    `;
  },

  renderEntries() {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    const entries = this.getFilteredEntries();
    const rows = document.getElementById('entryRows');
    if (!rows) return;
    if (!entries.length) {
      rows.innerHTML = `<tr class="empty-row"><td colspan="7">No entries match the selected filters</td></tr>`;
      return;
    }

    const badgeClass = { bank: 'active', pc_expense: 'partial', pc_topup: 'paid' };

    rows.innerHTML = entries
      .map((entry) => {
        const amountPrefix = entry.kind === 'pc_topup' ? '+' : '';
        const actions = isAdmin
          ? `<td class="toolbar"><button class="small secondary" data-entry-edit="${entry.kind}:${entry.id}">Edit</button><button class="small danger" data-entry-del="${entry.kind}:${entry.id}">Delete</button></td>`
          : '';
        return `
      <tr>
        <td>${Util.formatDate(entry.date)}</td>
        <td>${Util.escapeHtml(entry.title)}</td>
        <td>${Util.escapeHtml(entry.category || '-')}</td>
        <td><span class="badge ${badgeClass[entry.kind]}">${entry.sourceLabel}</span></td>
        <td>${amountPrefix}${Util.money(entry.amount)}</td>
        <td>${Util.escapeHtml(entry.notes || '-')}</td>
        ${actions}
      </tr>`;
      })
      .join('');

    if (isAdmin) {
      rows.querySelectorAll('[data-entry-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const [kind, id] = btn.dataset.entryEdit.split(':');
          this.editEntry(kind, id);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
      rows.querySelectorAll('[data-entry-del]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const [kind, id] = btn.dataset.entryDel.split(':');
          this.deleteEntry(kind, id);
        })
      );
    }
  },

  editEntry(kind, id) {
    if (kind === 'bank') {
      const record = this.currentExpenses.find((x) => String(x.id) === String(id));
      this.renderEntryForm({ source: 'bank', record });
    } else {
      const record = this.currentTransactions.find((x) => String(x.id) === String(id));
      this.renderEntryForm({ source: 'petty_cash', record });
    }
  },

  async deleteEntry(kind, id) {
    if (kind === 'bank') {
      if (!confirm('Delete this expense?')) return;
      try {
        await Api.del(`/expenses/${id}`);
        await this.refresh();
      } catch (err) {
        this.showAlert(err.message);
      }
      return;
    }
    const confirmMsg =
      kind === 'pc_topup'
        ? 'Delete this petty cash top-up?'
        : 'Delete this petty cash transaction? The linked expense entry will be removed too.';
    if (!confirm(confirmMsg)) return;
    try {
      await Api.del(`/petty-cash/${id}`);
      await this.refresh();
    } catch (err) {
      this.showAlert(err.message);
    }
  },

  renderEntryForm(opts) {
    const isEdit = !!(opts && opts.record);
    const source = opts?.source || 'bank';
    const record = opts?.record;
    const isPettyCash = source === 'petty_cash';
    const pcType = isPettyCash ? record?.type || 'expense' : 'expense';
    const showCategory = !isPettyCash || pcType === 'expense';
    const showNotes = !isPettyCash;
    const dateValue = record ? (isPettyCash ? record.txn_date : record.expense_date) : Util.todayISO();
    const titleValue = isPettyCash ? record?.description || '' : record?.title || '';

    const el = document.getElementById('entryForm');
    el.innerHTML = `
      <div class="panel-header"><h3>${isEdit ? 'Edit Entry' : 'Add Entry'}</h3></div>
      <form id="entryFormEl">
        <div class="form-grid">
          <div class="field"><label>Source</label>
            <select id="en_source" ${isEdit ? 'disabled' : ''}>
              <option value="bank" ${!isPettyCash ? 'selected' : ''}>Bank</option>
              <option value="petty_cash" ${isPettyCash ? 'selected' : ''}>Petty Cash</option>
            </select>
          </div>
          <div class="field" id="en_type_field" style="${isPettyCash ? '' : 'display:none;'}"><label>Type</label>
            <select id="en_type" ${isEdit ? 'disabled' : ''}>
              <option value="expense" ${pcType === 'expense' ? 'selected' : ''}>Expense (spend from petty cash)</option>
              <option value="topup" ${pcType === 'topup' ? 'selected' : ''}>Top-up (add cash from bank)</option>
            </select>
          </div>
          <div class="field"><label id="en_title_label">${isPettyCash ? 'Description' : 'Title'}</label>
            <input id="en_title" required value="${Util.escapeHtml(titleValue)}" />
          </div>
          <div class="field" id="en_category_field" style="${showCategory ? '' : 'display:none;'}"><label>Category</label>
            <input id="en_category" list="expenseCategoryOptions" placeholder="Cleaning, Security, Repairs..." value="${Util.escapeHtml(record?.category || '')}" />
          </div>
          <div class="field"><label>Amount</label><input id="en_amount" type="number" step="0.01" required value="${record?.amount ?? ''}" /></div>
          <div class="field"><label>Date</label><input id="en_date" type="date" value="${dateValue}" /></div>
        </div>
        <div class="field" id="en_notes_field" style="${showNotes ? '' : 'display:none;'}"><label>Notes</label><input id="en_notes" value="${Util.escapeHtml(record?.notes || '')}" /></div>
        <div class="toolbar mt-16">
          <button type="submit">${isEdit ? 'Save Changes' : 'Add Entry'}</button>
          ${isEdit ? '<button type="button" class="secondary" id="cancelEntryEdit">Cancel</button>' : ''}
        </div>
      </form>
    `;

    const sourceSelect = document.getElementById('en_source');
    const typeSelect = document.getElementById('en_type');
    const typeField = document.getElementById('en_type_field');
    const categoryField = document.getElementById('en_category_field');
    const notesField = document.getElementById('en_notes_field');
    const titleLabel = document.getElementById('en_title_label');

    const syncFieldVisibility = () => {
      const isPC = sourceSelect.value === 'petty_cash';
      typeField.style.display = isPC ? '' : 'none';
      notesField.style.display = isPC ? 'none' : '';
      titleLabel.textContent = isPC ? 'Description' : 'Title';
      const currentType = isPC ? typeSelect.value : 'expense';
      categoryField.style.display = !isPC || currentType === 'expense' ? '' : 'none';
    };

    if (!isEdit) {
      sourceSelect.addEventListener('change', syncFieldVisibility);
      typeSelect.addEventListener('change', syncFieldVisibility);
    }

    document.getElementById('entryFormEl').addEventListener('submit', async (e) => {
      e.preventDefault();
      const src = sourceSelect.value;
      const title = document.getElementById('en_title').value.trim();
      const amount = Number(document.getElementById('en_amount').value);
      const date = document.getElementById('en_date').value;
      const category = document.getElementById('en_category').value.trim();

      try {
        if (src === 'bank') {
          const payload = {
            title,
            category,
            amount,
            expense_date: date,
            notes: document.getElementById('en_notes').value.trim(),
          };
          if (isEdit) {
            await Api.put(`/expenses/${record.id}`, payload);
          } else {
            await Api.post('/expenses', payload);
          }
        } else {
          const payload = {
            type: typeSelect.value,
            amount,
            txn_date: date,
            description: title,
            category,
          };
          if (isEdit) {
            await Api.put(`/petty-cash/${record.id}`, payload);
          } else {
            await Api.post('/petty-cash', payload);
          }
        }
        this.renderEntryForm();
        await this.refresh();
        this.showAlert(isEdit ? 'Entry updated.' : 'Entry added.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    if (isEdit) {
      document.getElementById('cancelEntryEdit').addEventListener('click', () => this.renderEntryForm());
    }
  },
};
