window.CoreMembersPage = {
  async render(container) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    container.innerHTML = `
      <h1>Core Members</h1>
      <p class="page-sub">Committee positions and office bearers</p>
      <div id="alertBox"></div>
      ${isAdmin ? '<div class="panel" id="formPanel"></div>' : ''}
      <div class="panel">
        <div class="panel-header"><h3>Committee</h3></div>
        <table>
          <thead><tr><th>Photo</th><th>Name</th><th>Designation</th><th>From</th><th>To</th><th>Notes</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody>
        </table>
      </div>
    `;

    this.members = await Api.get('/members');
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
    const rows = await Api.get('/core-members');
    const tbody = document.getElementById('rows');
    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No core members assigned yet</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${
          r.photo
            ? `<img class="table-avatar" src="${r.photo}" alt="">`
            : `<div class="table-avatar-fallback">${Util.escapeHtml(Util.initials(r.member_name))}</div>`
        }</td>
        <td>${Util.escapeHtml(r.member_name)}</td>
        <td>${Util.escapeHtml(r.designation)}</td>
        <td>${Util.formatDate(r.start_date)}</td>
        <td>${r.end_date ? Util.formatDate(r.end_date) : '<span class="badge active">current</span>'}</td>
        <td>${Util.escapeHtml(r.notes || '-')}</td>
        ${
          isAdmin
            ? `<td class="toolbar">
                <button class="small secondary" data-edit="${r.id}">Edit</button>
                <button class="small danger" data-del="${r.id}">Delete</button>
              </td>`
            : ''
        }
      </tr>`
      )
      .join('');

    if (isAdmin) {
      tbody.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const row = rows.find((r) => String(r.id) === btn.dataset.edit);
          this.renderForm(document.getElementById('formPanel'), row);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
      tbody.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this core member record?')) return;
          try {
            await Api.del(`/core-members/${btn.dataset.del}`);
            await this.loadRows();
          } catch (err) {
            this.showAlert(err.message);
          }
        })
      );
    }
  },

  renderForm(panel, row) {
    if (!panel) return;
    const isEdit = !!row;
    // Only offer active members for a new assignment - but if editing an existing assignment
    // whose member has since gone inactive, still include them so the (disabled) select can
    // correctly show who's assigned rather than rendering blank.
    const memberOptions = this.members
      .filter((m) => m.status === 'active' || (isEdit && m.id === row?.member_id))
      .map((m) => `<option value="${m.id}" ${row?.member_id === m.id ? 'selected' : ''}>${Util.escapeHtml(m.name)}</option>`)
      .join('');
    panel.innerHTML = `
      <div class="panel-header"><h3>${isEdit ? 'Edit Core Member' : 'Assign Core Member'}</h3></div>
      <form id="cmForm">
        <div class="form-grid">
          <div class="field">
            <label>Member</label>
            <select id="f_member" ${isEdit ? 'disabled' : ''}>${memberOptions}</select>
          </div>
          <div class="field"><label>Designation</label><input id="f_designation" required placeholder="President, Secretary, Treasurer..." value="${Util.escapeHtml(row?.designation || '')}" /></div>
          <div class="field"><label>Start Date</label><input id="f_start" type="date" value="${row?.start_date || Util.todayISO()}" /></div>
          <div class="field"><label>End Date (optional)</label><input id="f_end" type="date" value="${row?.end_date || ''}" /></div>
          <div class="field"><label>Notes</label><input id="f_notes" value="${Util.escapeHtml(row?.notes || '')}" /></div>
          <div class="field">
            <label>Profile Photo</label>
            <input id="f_photo" type="file" accept="image/*" />
            <p class="text-muted" style="font-size:0.8rem;margin-top:4px;${row?.photo ? '' : 'display:none;'}" id="f_photo_hint">
              ${row?.photo ? `<img src="${row.photo}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />Leave blank to keep current photo` : ''}
            </p>
          </div>
        </div>
        <div class="toolbar mt-16">
          <button type="submit">${isEdit ? 'Save Changes' : 'Assign'}</button>
          ${isEdit ? '<button type="button" class="secondary" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form>
    `;

    document.getElementById('cmForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const photoFile = document.getElementById('f_photo').files[0];
        const photo = photoFile ? await Util.fileToResizedDataUrl(photoFile) : undefined;
        const payload = {
          member_id: Number(document.getElementById('f_member').value),
          designation: document.getElementById('f_designation').value.trim(),
          start_date: document.getElementById('f_start').value,
          end_date: document.getElementById('f_end').value || null,
          notes: document.getElementById('f_notes').value.trim(),
          ...(isEdit ? (photo ? { photo } : {}) : { photo: photo || null }),
        };
        let accountNote = '';
        if (isEdit) {
          await Api.put(`/core-members/${row.id}`, payload);
        } else {
          const result = await Api.post('/core-members', payload);
          if (result.account?.action === 'created') {
            accountNote = ` An admin login account (username ${result.account.username}) was created for them.`;
          } else if (result.account?.action === 'upgraded') {
            accountNote = ` Their existing login account (${result.account.username}) was upgraded to admin.`;
          }
        }
        this.renderForm(panel, null);
        await this.loadRows();
        this.showAlert((isEdit ? 'Updated.' : 'Assigned.') + accountNote, 'success');
      } catch (err) {
        this.showAlert(err.message);
      } finally {
        submitBtn.disabled = false;
      }
    });

    if (isEdit) {
      document.getElementById('cancelEdit').addEventListener('click', () => this.renderForm(panel, null));
    }
  },
};
