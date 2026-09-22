document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- nav toggle ---------- */
const navToggle = document.getElementById('navToggle');
const navRight = document.getElementById('navRight');
const navBackdrop = document.getElementById('navBackdrop');

function closeNav() {
  navRight.classList.remove('open');
  navToggle.classList.remove('open');
  navBackdrop.classList.remove('show');
  navToggle.setAttribute('aria-expanded', 'false');
}
function toggleNav() {
  const isOpen = navRight.classList.toggle('open');
  navToggle.classList.toggle('open', isOpen);
  navBackdrop.classList.toggle('show', isOpen);
  navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}
navToggle.addEventListener('click', toggleNav);
navBackdrop.addEventListener('click', closeNav);
navRight.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeNav));

/* ---------- header scroll shadow ---------- */
const siteHeader = document.getElementById('siteHeader');
function onScrollHeader() {
  siteHeader.classList.toggle('scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', onScrollHeader, { passive: true });
onScrollHeader();

/* ---------- keep --header-h in sync so the mobile nav drawer starts below the header, not under it ---------- */
function syncHeaderHeight() {
  document.documentElement.style.setProperty('--header-h', siteHeader.offsetHeight + 'px');
}
syncHeaderHeight();
window.addEventListener('resize', syncHeaderHeight);

/* ---------- scroll reveal ---------- */
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('in');
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

/* ---------- toran leaves (signature element, generated once) ---------- */
(function drawToran() {
  const g = document.getElementById('toranLeaves');
  const count = 22;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = 20 + t * 1160;
    const y = 6 + Math.sin(Math.PI * t) * 44;
    const leaf = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const rot = -20 + t * 40;
    leaf.setAttribute('d', 'M0,-9 C6,-6 6,6 0,10 C-6,6 -6,-6 0,-9 Z');
    leaf.setAttribute('transform', `translate(${x},${y}) rotate(${rot})`);
    leaf.setAttribute('fill', i % 2 === 0 ? '#2F5233' : '#D9A404');
    g.appendChild(leaf);
  }
})();

/* ---------- auth (reuses the same admin login as the member portal) ---------- */
function isAdmin() {
  const user = Api.getUser();
  return !!(user && Api.getToken() && (user.role === 'admin' || user.role === 'super_admin'));
}

const authNavBtn = document.getElementById('authNavBtn');
const loginModalBackdrop = document.getElementById('loginModalBackdrop');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

function updateAuthUI() {
  const admin = isAdmin();
  document.getElementById('showNoticeForm').style.display = admin ? '' : 'none';
  document.getElementById('showEventForm').style.display = admin ? '' : 'none';
  document.getElementById('showMemberForm').style.display = admin ? '' : 'none';
  if (authNavBtn) {
    authNavBtn.textContent = admin ? 'Logout' : 'Committee Login';
    authNavBtn.classList.toggle('logged-in', admin);
  }
  renderNotices();
  renderEvents();
  renderCommittee();
}

function openLoginModal() {
  loginError.textContent = '';
  loginForm.reset();
  loginModalBackdrop.classList.add('show');
  document.getElementById('loginUsername').focus();
}
function closeLoginModal() {
  loginModalBackdrop.classList.remove('show');
}

if (authNavBtn) {
  authNavBtn.addEventListener('click', () => {
    if (isAdmin()) {
      Api.clearSession();
      updateAuthUI();
    } else {
      openLoginModal();
    }
  });
}
document.getElementById('loginModalClose').addEventListener('click', closeLoginModal);
loginModalBackdrop.addEventListener('click', (e) => {
  if (e.target === loginModalBackdrop) closeLoginModal();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const data = await Api.post('/auth/login', { username, password });
    if (data.user.role !== 'admin' && data.user.role !== 'super_admin') {
      loginError.textContent = 'Only committee (admin) accounts can manage this page.';
      return;
    }
    Api.setSession(data.token, data.user);
    updateAuthUI();
    closeLoginModal();
  } catch (err) {
    loginError.textContent = err.message || 'Invalid username or password.';
  }
});

/* ---------- shared helpers ---------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T'));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function wireShowButton(btnId, resetFn, formEl) {
  document.getElementById(btnId).addEventListener('click', () => {
    resetFn();
    formEl.classList.add('open');
  });
}
// Downscales an uploaded image client-side before storing it as a base64 data URL in SQLite
function fileToResizedDataUrl(file, maxDim = 360, quality = 0.82) {
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
}

/* ---------- HERO STATS ---------- */
Api.get('/public/site/summary')
  .then((s) => {
    document.getElementById('statHouseholds').textContent = `${s.householdCount}+`;
    document.getElementById('statNotices').textContent = s.activeNotices;
    document.getElementById('statEvents').textContent = s.upcomingEvents;
  })
  .catch((e) => console.error('Failed to load site summary', e));

/* ---------- ASSOCIATION PROFILE (falls back to the static text already in the markup) ---------- */
Api.get('/public/site/profile')
  .then((p) => {
    if (p.office_address) document.getElementById('officeAddress').textContent = p.office_address;
    if (p.phone_number) {
      document.getElementById('officePhone').textContent = p.phone_number;
      document.getElementById('footerPhone').textContent = p.phone_number;
    }
    if (p.contact_email) {
      document.getElementById('officeEmail').textContent = p.contact_email;
      document.getElementById('footerEmail').textContent = p.contact_email;
    }
    if (p.office_hours) document.getElementById('officeHours').textContent = p.office_hours;
  })
  .catch((e) => console.error('Failed to load association profile', e));

/* ---------- NOTICES ---------- */
async function renderNotices() {
  let notices = [];
  try {
    notices = await Api.get('/public/site/notices');
  } catch (e) {
    console.error('Failed to load notices', e);
  }
  const list = document.getElementById('noticeList');
  list.innerHTML = '';
  if (notices.length === 0) {
    list.innerHTML = '<div class="empty-state">No notices yet. Be the first to post one.</div>';
    return;
  }
  notices.forEach((n) => {
    const tilt = (Math.random() * 2 - 1).toFixed(2);
    const card = document.createElement('div');
    card.className = 'notice-card' + (n.pinned ? ' pinned' : '');
    card.style.setProperty('--tilt', tilt + 'deg');
    card.innerHTML = `
      <div class="pin"></div>
      <div class="notice-meta">
        <span class="notice-date">${formatDate(n.created_at)}</span>
        ${n.pinned ? '<span class="notice-date" style="color:var(--gold);">PINNED</span>' : ''}
      </div>
      <h4>${escapeHtml(n.title)}</h4>
      <p>${escapeHtml(n.body)}</p>
      ${
        isAdmin()
          ? `<div class="notice-actions">
        <button class="link-btn edit-btn" data-id="${n.id}">Edit</button>
        <button class="link-btn remove-btn" data-id="${n.id}">Remove</button>
      </div>`
          : ''
      }
    `;
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => startEditNotice(n));
    const removeBtn = card.querySelector('.remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Remove this notice?')) return;
        try {
          await Api.del(`/notices/${n.id}`);
        } catch (err) {
          console.error('Delete notice failed', err);
        } finally {
          renderNotices();
        }
      });
    }
    list.appendChild(card);
  });
}

let editingNoticeId = null;
const noticeForm = document.getElementById('noticeForm');
const noticeFormHeading = noticeForm.querySelector('h4');
const noticeSubmitBtn = noticeForm.querySelector('button[type=submit]');

function startEditNotice(n) {
  editingNoticeId = n.id;
  document.getElementById('noticeTitle').value = n.title;
  document.getElementById('noticeBody').value = n.body;
  document.getElementById('noticePin').checked = !!n.pinned;
  noticeFormHeading.textContent = 'Edit notice';
  noticeSubmitBtn.textContent = 'Update Notice';
  noticeForm.classList.add('open');
  noticeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetNoticeForm() {
  editingNoticeId = null;
  noticeForm.reset();
  noticeForm.classList.remove('open');
  noticeFormHeading.textContent = 'New notice';
  noticeSubmitBtn.textContent = 'Publish Notice';
}
document.getElementById('cancelNotice').addEventListener('click', resetNoticeForm);
wireShowButton('showNoticeForm', resetNoticeForm, noticeForm);

noticeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('noticeTitle').value.trim();
  const body = document.getElementById('noticeBody').value.trim();
  const pinned = document.getElementById('noticePin').checked;
  if (!title || !body) return;
  try {
    if (editingNoticeId) {
      await Api.put(`/notices/${editingNoticeId}`, { title, body, pinned });
    } else {
      await Api.post('/notices', { title, body, pinned });
    }
    resetNoticeForm();
    renderNotices();
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- EVENTS ---------- */
async function renderEvents() {
  let events = [];
  try {
    events = await Api.get('/public/site/events');
  } catch (e) {
    console.error('Failed to load events', e);
  }
  const list = document.getElementById('eventList');
  list.innerHTML = '';
  if (events.length === 0) {
    list.innerHTML = '<div class="empty-state">No upcoming events. Add one above.</div>';
    return;
  }
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  events.forEach((ev) => {
    const d = new Date(ev.event_date + 'T00:00:00');
    const card = document.createElement('div');
    card.className = 'event-card';
    card.innerHTML = `
      <div class="event-date-badge"><span class="day">${d.getDate()}</span><span class="month">${months[d.getMonth()]}</span></div>
      <div class="event-body">
        <h4>${escapeHtml(ev.title)}</h4>
        ${ev.venue ? `<span class="event-venue">${escapeHtml(ev.venue)}</span>` : ''}
        <p>${escapeHtml(ev.description || '')}</p>
        ${
          isAdmin()
            ? `<div class="event-actions">
          <button class="link-btn edit-btn" data-id="${ev.id}">Edit</button>
          <button class="link-btn remove-btn" data-id="${ev.id}">Remove</button>
        </div>`
            : ''
        }
      </div>
    `;
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => startEditEvent(ev));
    const removeBtn = card.querySelector('.remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Remove this event?')) return;
        try {
          await Api.del(`/events/${ev.id}`);
        } catch (err) {
          console.error('Delete event failed', err);
        } finally {
          renderEvents();
        }
      });
    }
    list.appendChild(card);
  });
}

let editingEventId = null;
const eventForm = document.getElementById('eventForm');
const eventFormHeading = eventForm.querySelector('h4');
const eventSubmitBtn = eventForm.querySelector('button[type=submit]');

function startEditEvent(ev) {
  editingEventId = ev.id;
  document.getElementById('eventTitle').value = ev.title;
  document.getElementById('eventDate').value = ev.event_date;
  document.getElementById('eventVenue').value = ev.venue || '';
  document.getElementById('eventDesc').value = ev.description || '';
  eventFormHeading.textContent = 'Edit event';
  eventSubmitBtn.textContent = 'Update Event';
  eventForm.classList.add('open');
  eventForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetEventForm() {
  editingEventId = null;
  eventForm.reset();
  eventForm.classList.remove('open');
  eventFormHeading.textContent = 'New event';
  eventSubmitBtn.textContent = 'Add Event';
}
document.getElementById('cancelEvent').addEventListener('click', resetEventForm);
wireShowButton('showEventForm', resetEventForm, eventForm);

eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('eventTitle').value.trim();
  const event_date = document.getElementById('eventDate').value;
  const venue = document.getElementById('eventVenue').value.trim();
  const description = document.getElementById('eventDesc').value.trim();
  if (!title || !event_date) return;
  try {
    if (editingEventId) {
      await Api.put(`/events/${editingEventId}`, { title, event_date, venue, description });
    } else {
      await Api.post('/events', { title, event_date, venue, description });
    }
    resetEventForm();
    renderEvents();
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- COMMITTEE ---------- */
let allMembers = [];

async function renderCommittee() {
  let committee = [];
  try {
    committee = await Api.get('/public/site/committee');
  } catch (e) {
    console.error('Failed to load committee', e);
  }
  const list = document.getElementById('committeeList');
  list.innerHTML = '';
  committee.forEach((m) => {
    const initials = m.member_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const avatar = m.photo
      ? `<img class="avatar-photo" src="${m.photo}" alt="">`
      : `<div class="avatar-inner">${escapeHtml(initials)}</div>`;
    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      ${isAdmin() ? `<button class="remove-x" data-id="${m.id}" aria-label="Remove member">&times;</button>` : ''}
      <div class="avatar-ring">${avatar}</div>
      <h4>${escapeHtml(m.member_name)}</h4>
      <div class="member-role">${escapeHtml(m.designation)}</div>
      ${m.member_phone ? `<a class="member-mobile" href="tel:${escapeHtml(m.member_phone)}">${escapeHtml(m.member_phone)}</a>` : ''}
      ${isAdmin() ? `<div class="member-actions"><button class="link-btn edit-btn" data-id="${m.id}">Edit</button></div>` : ''}
    `;
    const removeBtn = card.querySelector('.remove-x');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Remove this committee member?')) return;
        try {
          await Api.del(`/core-members/${m.id}`);
        } catch (err) {
          console.error('Delete committee member failed', err);
        } finally {
          renderCommittee();
        }
      });
    }
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => startEditMember(m));
    list.appendChild(card);
  });
}

let editingMemberId = null;
const memberForm = document.getElementById('memberForm');
const memberFormHeading = memberForm.querySelector('h4');
const memberSubmitBtn = memberForm.querySelector('button[type=submit]');
const memberPhotoHint = document.getElementById('memberPhotoHint');
const memberSelect = document.getElementById('memberSelect');

async function ensureMembersLoaded() {
  if (allMembers.length || !isAdmin()) return;
  try {
    allMembers = await Api.get('/members');
    memberSelect.innerHTML = allMembers.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  } catch (e) {
    console.error('Failed to load members', e);
  }
}

function startEditMember(m) {
  editingMemberId = m.id;
  memberSelect.value = String(m.member_id || '');
  memberSelect.disabled = true;
  document.getElementById('memberRole').value = m.designation;
  memberPhotoHint.style.display = m.photo ? '' : 'none';
  memberFormHeading.textContent = 'Edit committee member';
  memberSubmitBtn.textContent = 'Update Member';
  memberForm.classList.add('open');
  memberForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetMemberForm() {
  editingMemberId = null;
  memberForm.reset();
  memberSelect.disabled = false;
  memberForm.classList.remove('open');
  memberPhotoHint.style.display = 'none';
  memberFormHeading.textContent = 'New committee member';
  memberSubmitBtn.textContent = 'Add Member';
}
document.getElementById('cancelMember').addEventListener('click', resetMemberForm);
wireShowButton('showMemberForm', async () => {
  await ensureMembersLoaded();
  resetMemberForm();
}, memberForm);

memberForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const designation = document.getElementById('memberRole').value.trim();
  const photoFile = document.getElementById('memberPhoto').files[0];
  if (!designation) return;
  const submitBtn = memberForm.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const photo = photoFile ? await fileToResizedDataUrl(photoFile) : undefined;
    if (editingMemberId) {
      await Api.put(`/core-members/${editingMemberId}`, { designation, ...(photo ? { photo } : {}) });
    } else {
      if (!memberSelect.value) throw new Error('Please choose a member');
      await Api.post('/core-members', { member_id: Number(memberSelect.value), designation, photo: photo || null });
    }
    resetMemberForm();
    renderCommittee();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- CONTACT FORM ---------- */
document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('cName').value.trim();
  const house_no = document.getElementById('cHouse').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  const email = document.getElementById('cEmail').value.trim();
  const message = document.getElementById('cMsg').value.trim();

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    await Api.post('/public/site/contact-messages', { name, house_no, phone, email, message });
    document.getElementById('contactSuccess').classList.add('show');
    e.target.reset();
    setTimeout(() => document.getElementById('contactSuccess').classList.remove('show'), 6000);
  } catch (err) {
    console.error('Failed to save contact message', err);
    alert('Sorry, something went wrong sending your message. Please try again or call us directly.');
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- init ---------- */
updateAuthUI();
