window.NoticesPage = {
  async render(container) {
    const user = Api.getUser();
    const isAdmin = Util.isAdmin(user);
    container.innerHTML = `
      <h1>Notices</h1>
      <p class="page-sub">Notice board shown on the public site</p>
      <div id="alertBox"></div>
      ${isAdmin ? '<div class="panel" id="formPanel"></div>' : ''}
      <div class="panel">
        <div class="panel-header"><h3>All Notices</h3></div>
        <table>
          <thead><tr><th>Title</th><th>Details</th><th>Pinned</th><th>Posted</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody id="rows"><tr><td colspan="5">Loading…</td></tr></tbody>
        </table>
      </div>
    `;
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
    const notices = await Api.get('/notices');
    const tbody = document.getElementById('rows');
    if (!notices.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No notices yet</td></tr>`;
      return;
    }
    tbody.innerHTML = notices
      .map(
        (n) => `
      <tr>
        <td>${Util.escapeHtml(n.title)}</td>
        <td>${Util.escapeHtml(n.body)}</td>
        <td>${n.pinned ? '<span class="badge active">Pinned</span>' : '-'}</td>
        <td>${Util.formatDate(n.created_at)}</td>
        ${
          isAdmin
            ? `<td class="toolbar">
                <button class="small secondary" data-edit="${n.id}">Edit</button>
                <button class="small danger" data-del="${n.id}">Delete</button>
              </td>`
            : ''
        }
      </tr>`
      )
      .join('');

    if (isAdmin) {
      tbody.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const n = notices.find((x) => String(x.id) === btn.dataset.edit);
          this.renderForm(document.getElementById('formPanel'), n);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
      tbody.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this notice?')) return;
          try {
            await Api.del(`/notices/${btn.dataset.del}`);
            await this.loadRows();
          } catch (err) {
            this.showAlert(err.message);
          }
        })
      );
    }
  },

  renderForm(panel, n) {
    if (!panel) return;
    const isEdit = !!n;
    panel.innerHTML = `
      <div class="panel-header"><h3>${isEdit ? 'Edit Notice' : 'Post a Notice'}</h3></div>
      <form id="noticeForm">
        <div class="field"><label>Title</label><input id="f_title" required maxlength="80" value="${Util.escapeHtml(n?.title || '')}" /></div>
        <div class="field"><label>Details</label><textarea id="f_body" rows="3" required maxlength="400">${Util.escapeHtml(n?.body || '')}</textarea></div>
        <div class="field" style="max-width:220px;"><label><input type="checkbox" id="f_pinned" ${n?.pinned ? 'checked' : ''} /> Pin to top (important)</label></div>
        <div class="toolbar mt-16">
          <button type="submit">${isEdit ? 'Save Changes' : 'Publish Notice'}</button>
          ${isEdit ? '<button type="button" class="secondary" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form>
    `;

    document.getElementById('noticeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: document.getElementById('f_title').value.trim(),
        body: document.getElementById('f_body').value.trim(),
        pinned: document.getElementById('f_pinned').checked,
      };
      try {
        if (isEdit) {
          await Api.put(`/notices/${n.id}`, payload);
        } else {
          await Api.post('/notices', payload);
        }
        this.renderForm(panel, null);
        await this.loadRows();
        this.showAlert(isEdit ? 'Notice updated.' : 'Notice published.', 'success');
      } catch (err) {
        this.showAlert(err.message);
      }
    });

    if (isEdit) {
      document.getElementById('cancelEdit').addEventListener('click', () => this.renderForm(panel, null));
    }
  },
};
