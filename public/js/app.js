(() => {
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $toast = document.getElementById('toast');
  let user = null;
  let unreadCount = 0;
  let prefillRequest = null;

  const CATEGORIES = [
    'Microcontrollers',
    'Sensors',
    'Single-Board Computers',
    'Power & Motors',
    'Communication & RF',
    'Tools & Prototyping',
    'Displays & Audio',
    'Other',
  ];

  const IITR_HOSTELS = [
    'Cautley Bhawan',
    'Govind Bhawan',
    'Rajendra Bhawan',
    'Radhakrishnan Bhawan',
    'Ranjit Singh Bhawan',
    'Ravindra Bhawan',
    'Jawahar Bhawan',
    'Azad Bhawan',
    'Kasturba Bhawan',
    'Sarojini Bhawan',
    'Himalaya Bhawan',
    'Vigyan Kunj',
    'Day Scholar / Off-Campus',
  ];

  /* ---------- helpers ---------- */
  const getToken = () => localStorage.getItem('ccs_token');

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (getToken()) headers.Authorization = 'Bearer ' + getToken();
    const res = await fetch('/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && getToken() && !path.startsWith('/auth/login')) logout(true);
      const err = new Error(data.error || 'Something went wrong');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d.length <= 10 ? d + 'T00:00:00' : d);
    if (Number.isNaN(dt.getTime())) return esc(d);
    return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const today = () => new Date().toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const STATUS_LABEL = {
    open: 'Open',
    claimed: 'Claimed',
    checked_out: 'Checked out',
    returned: 'Returned',
    cancelled: 'Cancelled',
    active: 'Active',
    overdue: 'Overdue',
    available: 'Available',
    unavailable: 'Paused',
  };
  const badge = (s, customLabel) => `<span class="badge ${s}">${esc(customLabel || STATUS_LABEL[s] || s)}</span>`;

  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), 2800);
  }

  function showError(form, msg) {
    const el = form.querySelector('.error');
    if (!el) { toast(msg); return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function setUser(u, token) {
    user = u;
    if (token) localStorage.setItem('ccs_token', token);
  }

  function logout(expired = false) {
    localStorage.removeItem('ccs_token');
    user = null;
    unreadCount = 0;
    renderNav();
    location.hash = '#/login';
    if (expired) toast('Session expired - please sign in again');
  }

  async function refreshNotificationsCount() {
    if (!user) return;
    try {
      const { unread } = await api('/notifications');
      unreadCount = unread || 0;
      renderNav();
    } catch { /* ignore */ }
  }

  /* ---------- nav ---------- */
  function renderNav() {
    const page = (location.hash.slice(2) || '').split('/')[0];
    const link = (hash, label, key) =>
      `<a href="#/${hash}" class="${page === key ? 'active' : ''}">${label}</a>`;
    if (!user) {
      $nav.innerHTML = link('login', 'Sign in', 'login') + link('register', 'Join (IITR)', 'register');
      return;
    }
    const notifBadge = unreadCount > 0 ? `<span class="notif-pill">${unreadCount}</span>` : '';
    $nav.innerHTML =
      link('', 'Feed', '') +
      link('catalog', 'Parts Catalog', 'catalog') +
      (user.role === 'junior' ? link('new', 'Request a part', 'new') : '') +
      link('mine', 'My activity', 'mine') +
      link('checkouts', 'Checkouts', 'checkouts') +
      link('notifications', `Alerts ${notifBadge}`, 'notifications') +
      link('profile', `${esc(user.name.split(' ')[0])} (${user.role === 'senior' ? 'Sr' : 'Jr'})`, 'profile') +
      `<button class="link" id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn').onclick = () => logout();
  }

  /* ---------- shared view pieces ---------- */
  function requestCard(r) {
    const who = r.junior.year
      ? `${esc(r.junior.name)} (${esc(r.junior.branch || '')} Y${r.junior.year})`
      : esc(r.junior.name);
    return `
      <a class="card clickable" href="#/request/${r.id}">
        <div class="card-head">
          <div>
            <h3>${esc(r.title)}</h3>
            <div>
              <strong>${esc(r.component)}</strong> &times; ${r.quantity}
              <span class="badge cat">${esc(r.category || 'Microcontrollers')}</span>
            </div>
          </div>
          ${badge(r.overdue ? 'overdue' : r.status)}
        </div>
        <p class="scope">${esc(r.project_scope.length > 160 ? r.project_scope.slice(0, 160) + '...' : r.project_scope)}</p>
        <div class="meta">
          <span>Needed ${fmtDate(r.needed_from)} &rarr; ${fmtDate(r.needed_until)}</span>
          <span>Requested by ${who}${r.junior.hostel ? ' &middot; ' + esc(r.junior.hostel.split(',')[0]) : ''}</span>
          ${r.senior ? `<span>Lender: ${esc(r.senior.name)}</span>` : ''}
          ${r.comment_count ? `<span>&#128172; ${r.comment_count}</span>` : ''}
        </div>
      </a>`;
  }

  const contactBox = (c, label) =>
    !c
      ? ''
      : `
    <div class="contact">
      <h4>${label}</h4>
      <p><strong>${esc(c.name)}</strong>${c.enrollment_no ? ` <small>(#${esc(c.enrollment_no)})</small>` : ''}</p>
      <p>Campus Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>
      ${c.phone ? `<p>Phone / WhatsApp: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>` : ''}
      ${c.hostel ? `<p>Bhawan / Room: ${esc(c.hostel)}</p>` : ''}
    </div>`;

  /* ---------- views ---------- */
  async function viewLanding() {
    const s = await api('/stats').catch(() => null);
    $app.innerHTML = `
      <section class="hero">
        <span class="hero-tag">IIT Roorkee Peer-to-Peer Hardware Network</span>
        <h1>Don't buy it for one project. Borrow it from a senior.</h1>
        <p>Post what you need for Shrishti, Tinkering Lab, or course projects. Seniors across Bhawans with idle Arduinos, STM32s, sensors, and Raspberry Pis claim your request, lend or rent them out, and help you debug.</p>
        <div class="actions">
          <a class="btn" href="#/register">Join with your @iitr.ac.in email</a>
          <a class="btn secondary" href="#/login">Sign in / Demo Login</a>
        </div>
      </section>
      ${s ? `<div class="stats">
        <div class="stat"><b>${s.open_requests}</b><span>open requests</span></div>
        <div class="stat"><b>${s.available_inventory ?? 0}</b><span>parts in senior catalog</span></div>
        <div class="stat"><b>${s.active_checkouts}</b><span>out on loan now</span></div>
        <div class="stat"><b>${s.items_recirculated}</b><span>items recirculated</span></div>
        <div class="stat"><b>${s.members}</b><span>campus members</span></div>
      </div>` : ''}
      <div class="steps">
        <div class="card"><h3>1. Ask or Browse</h3><p class="scope">Juniors post the component, project scope, and timeline—or pick directly from the Seniors' Available Parts Catalog.</p></div>
        <div class="card"><h3>2. Claim &amp; Connect</h3><p class="scope">Seniors claim requests to lend for free or rent at pocket-friendly rates. Bhawan &amp; phone details unlock on match.</p></div>
        <div class="card"><h3>3. Handover &amp; Return</h3><p class="scope">Both sides log handover, condition notes, and return dates so no component gets lost before end-sems.</p></div>
      </div>
      ${s && s.top_lenders && s.top_lenders.length ? `
        <div class="card">
          <h2>Top Senior Contributors at IIT Roorkee</h2>
          <div class="meta">
            ${s.top_lenders.map((l) => `<span>&#11088; <strong>${esc(l.name)}</strong> (${esc(l.branch || 'IITR')} Y${l.year || '-'}) &middot; ${l.reputation} karma</span>`).join('')}
          </div>
        </div>` : ''}`;
  }

  async function viewFeed() {
    refreshNotificationsCount();
    const s = await api('/stats').catch(() => null);
    $app.innerHTML = `
      <div class="card-head" style="margin-bottom:8px">
        <div>
          <h1>Component Request Feed</h1>
          <p class="sub">${user.role === 'senior'
            ? 'Open requests from IITR juniors. Claim one if you have idle hardware in your Bhawan.'
            : 'Browse what others have asked for, check the <a href="#/catalog">Parts Catalog</a>, or <a href="#/new">post your own request</a>.'}</p>
        </div>
        ${user.role === 'junior' ? `<a class="btn" href="#/new">+ Request a Part</a>` : `<a class="btn secondary" href="#/catalog">Manage My Parts</a>`}
      </div>
      ${s ? `<div class="stats">
        <div class="stat"><b>${s.open_requests}</b><span>open requests</span></div>
        <div class="stat"><b>${s.available_inventory ?? 0}</b><span>available in catalog</span></div>
        <div class="stat"><b>${s.active_checkouts}</b><span>out on loan</span></div>
        <div class="stat"><b>${s.items_recirculated}</b><span>recirculated</span></div>
      </div>` : ''}
      <div class="toolbar">
        <input id="q" type="search" placeholder="Search components, e.g. Arduino, STM32, ESP32, sensor...">
        <select id="catFilter">
          <option value="all">All Categories</option>
          ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
        <select id="statusFilter">
          <option value="open">Open</option>
          <option value="claimed">Claimed</option>
          <option value="checked_out">Checked out</option>
          <option value="returned">Returned</option>
          <option value="all">All statuses</option>
        </select>
      </div>
      <div id="list"></div>`;

    const $list = document.getElementById('list');
    async function load() {
      const q = document.getElementById('q').value.trim();
      const category = document.getElementById('catFilter').value;
      const status = document.getElementById('statusFilter').value;
      const params = new URLSearchParams({ status, category });
      if (q) params.set('q', q);
      try {
        const { requests } = await api('/requests?' + params);
        $list.innerHTML = requests.length
          ? requests.map(requestCard).join('')
          : `<div class="empty">No requests match your filter. ${user.role === 'junior' ? '<a href="#/new">Post a new request</a>.' : ''}</div>`;
      } catch (e) {
        $list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      }
    }
    let t;
    document.getElementById('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 220); });
    document.getElementById('catFilter').addEventListener('change', load);
    document.getElementById('statusFilter').addEventListener('change', load);
    load();
  }

  async function viewCatalog() {
    const isSenior = user.role === 'senior';
    $app.innerHTML = `
      <div class="card-head" style="margin-bottom:8px">
        <div>
          <h1>Available Parts Catalog</h1>
          <p class="sub">${isSenior
            ? 'List your idle hardware so juniors know what is available on campus.'
            : 'Idle hardware listed by IIT Roorkee seniors. Click "Request this part" to pre-fill a borrow request.'}</p>
        </div>
        ${isSenior ? `<button class="btn" id="toggleAddInv">+ List Idle Component</button>` : ''}
      </div>

      ${isSenior ? `
        <form class="card hidden" id="invForm">
          <h2>Add a component to the campus catalog</h2>
          <div class="row">
            <div><label>Component name</label><input name="component" required minlength="2" maxlength="100" placeholder="STM32F401RE Nucleo-64"></div>
            <div>
              <label>Category</label>
              <select name="category">${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row">
            <div><label>Quantity</label><input name="quantity" type="number" min="1" max="50" value="1" required></div>
            <div>
              <label>Condition</label>
              <select name="condition"><option value="Good">Good</option><option value="New">New</option><option value="Fair">Fair</option></select>
            </div>
            <div>
              <label>Terms</label>
              <select name="share_type" id="invShareType">
                <option value="lend">Free Lend</option>
                <option value="rent">Rent</option>
                <option value="both">Lend or Rent</option>
              </select>
            </div>
            <div id="invRentWrap" class="hidden">
              <label>Rent (INR)</label>
              <input name="rent_amount" type="number" min="1" max="100000" placeholder="100">
            </div>
          </div>
          <label>Specs / Notes (optional)</label>
          <textarea name="description" maxlength="500" placeholder="Includes USB cable, pin headers soldered, etc."></textarea>
          <div class="error"></div>
          <div class="actions">
            <button class="btn" type="submit">Save to catalog</button>
          </div>
        </form>` : ''}

      <div class="toolbar">
        <input id="invQ" type="search" placeholder="Search catalog (STM32, Logic Analyzer, IMU, Pi)...">
        <select id="invCat">
          <option value="all">All Categories</option>
          ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="invList"></div>`;

    const toggleBtn = document.getElementById('toggleAddInv');
    const invForm = document.getElementById('invForm');
    if (toggleBtn && invForm) {
      toggleBtn.onclick = () => invForm.classList.toggle('hidden');
      const shareSel = document.getElementById('invShareType');
      shareSel.onchange = () =>
        document.getElementById('invRentWrap').classList.toggle('hidden', shareSel.value === 'lend');
      invForm.onsubmit = async (e) => {
        e.preventDefault();
        const d = formData(invForm);
        if (d.share_type === 'lend') delete d.rent_amount;
        try {
          await api('/inventory', { method: 'POST', body: d });
          toast('Component added to catalog (+5 karma)');
          invForm.reset();
          invForm.classList.add('hidden');
          loadInv();
        } catch (err) {
          showError(invForm, err.message);
        }
      };
    }

    async function loadInv() {
      const q = document.getElementById('invQ').value.trim();
      const category = document.getElementById('invCat').value;
      const params = new URLSearchParams({ category, all: isSenior ? '1' : '0' });
      if (q) params.set('q', q);
      const { items } = await api('/inventory?' + params);
      const $invList = document.getElementById('invList');
      if (!items.length) {
        $invList.innerHTML = `<div class="empty">No catalog items match.</div>`;
        return;
      }
      $invList.innerHTML = items
        .map(
          (item) => `
        <div class="card">
          <div class="card-head">
            <div>
              <h3>${esc(item.component)} &times; ${item.quantity}</h3>
              <div>
                <span class="badge cat">${esc(item.category)}</span>
                <span class="badge cat">Condition: ${esc(item.condition)}</span>
                <span class="badge ${item.share_type === 'lend' ? 'open' : 'claimed'}">
                  ${item.share_type === 'lend' ? 'Free Lend' : `Rent: INR ${item.rent_amount}`}
                </span>
              </div>
            </div>
            ${badge(item.available ? 'available' : 'unavailable')}
          </div>
          ${item.description ? `<p class="scope">${esc(item.description)}</p>` : ''}
          <div class="meta">
            <span>Listed by <strong>${esc(item.senior.name)}</strong> (${esc(item.senior.branch || 'IITR')} Y${item.senior.year || '-'})</span>
            ${item.senior.hostel ? `<span>Bhawan: ${esc(item.senior.hostel.split(',')[0])}</span>` : ''}
          </div>
          <div class="actions">
            ${user.role === 'junior' && item.available
              ? `<button class="btn sm" data-req-inv='${esc(JSON.stringify({ id: item.id, component: item.component, category: item.category, seniorName: item.senior.name }))}'>Request this part</button>`
              : ''}
            ${item.is_mine
              ? `<button class="btn secondary sm" data-toggle-inv="${item.id}">${item.available ? 'Pause listing' : 'Mark available'}</button>
                 <button class="btn danger sm" data-del-inv="${item.id}">Remove</button>`
              : ''}
          </div>
        </div>`
        )
        .join('');

      $invList.querySelectorAll('[data-req-inv]').forEach((btn) => {
        btn.onclick = () => {
          prefillRequest = JSON.parse(btn.getAttribute('data-req-inv'));
          location.hash = '#/new';
        };
      });
      $invList.querySelectorAll('[data-toggle-inv]').forEach((btn) => {
        btn.onclick = async () => {
          await api(`/inventory/${btn.dataset.toggleInv}/toggle`, { method: 'PATCH' });
          toast('Listing updated');
          loadInv();
        };
      });
      $invList.querySelectorAll('[data-del-inv]').forEach((btn) => {
        btn.onclick = async () => {
          await api(`/inventory/${btn.dataset.delInv}`, { method: 'DELETE' });
          toast('Listing removed');
          loadInv();
        };
      });
    }

    let t;
    document.getElementById('invQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadInv, 220); });
    document.getElementById('invCat').addEventListener('change', loadInv);
    loadInv();
  }

  function viewNew() {
    if (user.role !== 'junior') {
      $app.innerHTML = `<div class="empty">Only juniors post requests. Seniors can <a href="#/">browse the feed</a> or <a href="#/catalog">list parts in the catalog</a>.</div>`;
      return;
    }
    const pf = prefillRequest || {};
    prefillRequest = null;

    $app.innerHTML = `
      <h1>Request a hardware component</h1>
      <p class="sub">Be specific about your circuit/project—seniors see this in the feed and can also offer setup advice.</p>
      <form class="card" id="newForm">
        ${pf.id ? `<input type="hidden" name="inventory_id" value="${esc(pf.id)}">` : ''}
        <label>Request Title</label>
        <input name="title" required minlength="4" maxlength="120" value="${pf.component ? esc(`Need ${pf.component} for project`) : ''}" placeholder="Arduino Uno R3 for line-follower robot">
        <div class="row">
          <div><label>Component</label><input name="component" required maxlength="100" value="${esc(pf.component || '')}" placeholder="Arduino Uno R3"></div>
          <div>
            <label>Category</label>
            <select name="category">
              ${CATEGORIES.map((c) => `<option value="${esc(c)}" ${pf.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div><label>Quantity</label><input name="quantity" type="number" min="1" max="50" value="1" required></div>
        </div>
        <label>Project scope &amp; usage</label>
        <textarea name="project_scope" required minlength="10" maxlength="1000" placeholder="What are you building (e.g. Shrishti bot, course lab, Tinkering Lab prototype), and what help or accessories would you like?">${pf.seniorName ? esc(`Requesting ${pf.component} listed by ${pf.seniorName} in the Parts Catalog. `) : ''}</textarea>
        <div class="row">
          <div><label>Needed from</label><input name="needed_from" type="date" min="${today()}" value="${plus(1)}" required></div>
          <div><label>Needed until</label><input name="needed_until" type="date" min="${today()}" value="${plus(21)}" required></div>
        </div>
        <div class="error"></div>
        <div class="actions"><button class="btn" type="submit">Post request</button></div>
      </form>`;
    document.getElementById('newForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      try {
        const { request } = await api('/requests', { method: 'POST', body: formData(form) });
        toast('Request posted to campus feed');
        location.hash = '#/request/' + request.id;
      } catch (err) {
        showError(form, err.message);
      }
    });
  }

  async function viewMine() {
    $app.innerHTML = `<h1>My activity</h1>
      <p class="sub">${user.role === 'junior' ? 'Requests you have posted.' : 'Requests you have claimed or lent out.'}</p>
      <div id="list"></div>`;
    const { requests } = await api('/requests?status=all&mine=1');
    document.getElementById('list').innerHTML = requests.length
      ? requests.map(requestCard).join('')
      : `<div class="empty">Nothing here yet. ${user.role === 'junior' ? '<a href="#/new">Post your first request</a>.' : '<a href="#/">Browse the feed</a> to claim one.'}</div>`;
  }

  async function viewCheckouts() {
    $app.innerHTML = `<h1>Checkouts</h1>
      <p class="sub">Hardware you have lent out or borrowed across campus, with return dates and Bhawan contact details.</p>
      <div class="tabs"><button data-f="active" class="active">Active &amp; Overdue</button><button data-f="returned">Returned History</button></div>
      <div id="list"></div>`;
    const { checkouts } = await api('/checkouts');
    const draw = (f) => {
      const rows = checkouts.filter((c) => (f === 'active' ? c.status !== 'returned' : c.status === 'returned'));
      document.getElementById('list').innerHTML = rows.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>Role</th><th>Campus Counterpart</th><th>Handed over</th><th>${f === 'active' ? 'Due back' : 'Returned'}</th><th>Status</th></tr></thead>
          <tbody>${rows
            .map(
              (c) => `
            <tr>
              <td>
                <a href="#/request/${c.request_id}"><strong>${esc(c.component)}</strong> &times; ${c.quantity}</a>
                ${c.condition_note ? `<br><small class="sub">Note: ${esc(c.condition_note)}</small>` : ''}
              </td>
              <td>${c.role === 'lender' ? 'Lender (Senior)' : 'Borrower (Junior)'}</td>
              <td>
                <strong>${esc(c.other.name)}</strong><br>
                <small>${esc(c.other.email)}${c.other.phone ? ' &middot; ' + esc(c.other.phone) : ''}${c.other.hostel ? '<br>' + esc(c.other.hostel) : ''}</small>
              </td>
              <td>${fmtDate(c.handed_over_at)}</td>
              <td>${fmtDate(f === 'active' ? c.expected_return : c.returned_at)}</td>
              <td>
                ${badge(c.status)}
                ${c.borrower_confirmed ? `<br><small style="color:var(--ok)">&#10003; Receipt confirmed</small>` : ''}
              </td>
            </tr>`
            )
            .join('')}</tbody>
        </table></div>`
        : `<div class="empty">No ${f} checkouts.</div>`;
    };
    draw('active');
    $app.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        $app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
        draw(b.dataset.f);
      })
    );
  }

  async function viewNotifications() {
    const { notifications } = await api('/notifications');
    await api('/notifications/read-all', { method: 'POST' });
    unreadCount = 0;
    renderNav();

    $app.innerHTML = `
      <h1>Activity Alerts</h1>
      <p class="sub">Updates on your requests, claims, handovers, and comments.</p>
      ${notifications.length
        ? notifications
            .map(
              (n) => `
            <a class="card clickable" href="${esc(n.link || '#/')}">
              <div class="card-head">
                <span>${esc(n.message)}</span>
                <small class="sub" style="margin:0;white-space:nowrap">${fmtDate(n.created_at)}</small>
              </div>
            </a>`
            )
            .join('')
        : `<div class="empty">No alerts yet.</div>`}`;
  }

  async function viewRequest(id) {
    const { request: r, comments = [] } = await api('/requests/' + id);
    const isSenior = user.role === 'senior';
    let actions = '';

    if (r.status === 'open' && isSenior && !r.is_mine) {
      actions = `
        <form class="card" id="claimForm">
          <h2>Claim this request</h2>
          <div class="row">
            <div>
              <label>How will you share it?</label>
              <select name="claim_type" id="claimType"><option value="lend">Lend (free)</option><option value="rent">Rent</option></select>
            </div>
            <div id="rentWrap" class="hidden">
              <label>Rent (INR total)</label>
              <input name="rent_amount" type="number" min="1" max="100000" placeholder="50">
            </div>
          </div>
          <label>Pickup note to the junior (optional)</label>
          <textarea name="claim_note" maxlength="500" placeholder="E.g. Meet at Rajendra Bhawan canteen at 6 PM, I can also share sample code."></textarea>
          <div class="error"></div>
          <div class="actions"><button class="btn" type="submit">Claim request</button></div>
        </form>`;
    } else if (r.status === 'claimed' && r.is_lender) {
      actions = `
        <form class="card" id="handoverForm">
          <h2>Record physical handover</h2>
          <p class="sub">Once you've handed the component to ${esc(r.junior.name)}, log the expected return date and condition.</p>
          <div class="row">
            <div>
              <label>Expected return date</label>
              <input name="expected_return" type="date" min="${today()}" value="${r.needed_until >= today() ? r.needed_until : plus(7)}" required>
            </div>
            <div>
              <label>Condition / accessories note (optional)</label>
              <input name="condition_note" maxlength="300" placeholder="Tested working, includes USB cable">
            </div>
          </div>
          <div class="error"></div>
          <div class="actions">
            <button class="btn" type="submit">Mark as handed over</button>
            <button class="btn secondary" type="button" data-act="unclaim">Release claim</button>
          </div>
        </form>`;
    } else if (r.status === 'checked_out' && r.is_lender) {
      actions = `
        <form class="card" id="returnForm">
          <h2>Confirm hardware return</h2>
          <label>Return condition note (optional)</label>
          <input name="condition_note" maxlength="300" placeholder="Returned in good working order">
          <div class="actions"><button class="btn" type="submit">Mark as returned (+15 karma)</button></div>
        </form>`;
    }

    if (r.status === 'checked_out' && r.is_mine && !r.borrower_confirmed) {
      actions += `
        <div class="card">
          <h2>Confirm you received the component</h2>
          <p class="sub">Let ${esc(r.senior ? r.senior.name : 'your senior')} know the hardware is safely with you.</p>
          <button class="btn" data-act="confirm-receipt">&#10003; Confirm hardware received</button>
        </div>`;
    }

    if (r.is_mine && ['open', 'claimed'].includes(r.status)) {
      actions += `<div class="actions"><button class="btn danger" data-act="cancel">Cancel request</button></div>`;
    }

    $app.innerHTML = `
      <p><a href="#/">&larr; Back to feed</a></p>
      <div class="card">
        <div class="card-head">
          <div>
            <h1>${esc(r.title)}</h1>
            <div>
              <strong>${esc(r.component)}</strong> &times; ${r.quantity}
              <span class="badge cat">${esc(r.category || 'Microcontrollers')}</span>
            </div>
          </div>
          ${badge(r.overdue ? 'overdue' : r.status)}
        </div>
        <p class="scope">${esc(r.project_scope)}</p>
        <div class="meta">
          <span>Needed ${fmtDate(r.needed_from)} &rarr; ${fmtDate(r.needed_until)}</span>
          <span>Requested by <strong>${esc(r.junior.name)}</strong>${r.junior.branch ? ' (' + esc(r.junior.branch) + (r.junior.year ? ' Y' + r.junior.year : '') + ')' : ''}</span>
          <span>Posted ${fmtDate(r.created_at)}</span>
        </div>
        ${r.senior ? `
          <div class="contact" style="background:var(--info-soft)">
            <h4>Claimed by ${esc(r.senior.name)}${r.senior.branch ? ' (' + esc(r.senior.branch) + (r.senior.year ? ' Y' + r.senior.year : '') + ')' : ''}</h4>
            <p>${r.claim_type === 'rent' ? 'Rent: INR ' + r.rent_amount : 'Lending for free'}</p>
            ${r.claim_note ? `<p>"${esc(r.claim_note)}"</p>` : ''}
          </div>` : ''}
        ${r.expected_return ? `
          <div class="meta">
            <span>Handed over ${fmtDate(r.handed_over_at)}</span>
            <span>Due back ${fmtDate(r.expected_return)}</span>
            ${r.borrower_confirmed ? `<span style="color:var(--ok)">&#10003; Borrower confirmed receipt</span>` : ''}
            ${r.returned_at ? `<span>Returned ${fmtDate(r.returned_at)}</span>` : ''}
            ${r.condition_note ? `<span>Condition: ${esc(r.condition_note)}</span>` : ''}
          </div>` : ''}
        ${contactBox(r.contact, r.is_mine ? 'Contact your senior lender' : 'Contact the borrowing junior')}
      </div>
      ${actions}

      <div class="card" style="margin-top:18px">
        <h2>Discussion &amp; Technical Q&amp;A (${comments.length})</h2>
        <div class="comment-list" id="commentList">
          ${comments.length
            ? comments
                .map(
                  (c) => `
              <div class="comment-item">
                <div class="comment-head">
                  <span><strong>${esc(c.author.name)}</strong> (${c.author.role === 'senior' ? 'Senior' : 'Junior'}${c.author.branch ? ' &middot; ' + esc(c.author.branch) : ''})</span>
                  <span>${fmtDate(c.created_at)}</span>
                </div>
                <div>${esc(c.body)}</div>
              </div>`
                )
                .join('')
            : `<p class="sub" style="margin:0">No messages yet. Ask about pinouts, voltage specs, or Bhawan pickup times.</p>`}
        </div>
        <form id="commentForm">
          <div class="toolbar" style="margin:0">
            <input name="body" required maxlength="500" placeholder="Write a comment or question...">
            <button class="btn" type="submit">Post</button>
          </div>
        </form>
      </div>`;

    const claimType = document.getElementById('claimType');
    if (claimType) {
      claimType.addEventListener('change', () =>
        document.getElementById('rentWrap').classList.toggle('hidden', claimType.value !== 'rent')
      );
    }

    const post = async (path, body, msg) => {
      await api(`/requests/${r.id}/${path}`, { method: 'POST', body });
      toast(msg);
      viewRequest(r.id);
    };

    const claimForm = document.getElementById('claimForm');
    if (claimForm) {
      claimForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(claimForm);
        if (d.claim_type !== 'rent') delete d.rent_amount;
        try { await post('claim', d, 'Claimed! Contact details are now unlocked.'); } catch (err) { showError(claimForm, err.message); }
      });
    }

    const handoverForm = document.getElementById('handoverForm');
    if (handoverForm) {
      handoverForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await post('handover', formData(handoverForm), 'Handover logged (+10 karma)'); } catch (err) { showError(handoverForm, err.message); }
      });
    }

    const returnForm = document.getElementById('returnForm');
    if (returnForm) {
      returnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await post('return', formData(returnForm), 'Hardware marked as returned (+15 karma)'); } catch (err) { showError(returnForm, err.message); }
      });
    }

    const commentForm = document.getElementById('commentForm');
    if (commentForm) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(commentForm);
        try {
          await api(`/requests/${r.id}/comments`, { method: 'POST', body: d });
          toast('Comment posted');
          viewRequest(r.id);
        } catch (err) {
          toast(err.message);
        }
      });
    }

    $app.querySelectorAll('[data-act]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const msgs = {
          unclaim: 'Claim released',
          cancel: 'Request cancelled',
          return: 'Marked as returned',
          'confirm-receipt': 'Receipt confirmed!',
        };
        if (act === 'cancel' && !confirm('Cancel this request?')) return;
        try { await post(act, undefined, msgs[act]); } catch (err) { toast(err.message); }
      })
    );
  }

  function viewProfile() {
    $app.innerHTML = `
      <h1>Your IIT Roorkee Profile</h1>
      <p class="sub">${esc(user.email)} &middot; ${user.role === 'senior' ? 'Senior (Lender / Mentor)' : 'Junior (Borrower)'} &middot; &#11088; ${user.reputation || 0} Karma</p>
      <div class="grid-2">
        <form class="card" id="profileForm">
          <h2>Campus &amp; Bhawan Details</h2>
          <p class="sub">Shared only with the member you are matched with on a claimed request.</p>
          <label>Full Name</label><input name="name" required value="${esc(user.name)}">
          <div class="row">
            <div><label>Enrollment No.</label><input name="enrollment_no" value="${esc(user.enrollment_no || '')}" placeholder="22114001"></div>
            <div><label>Branch</label><input name="branch" value="${esc(user.branch || '')}" placeholder="ECE / CSE / EE"></div>
            <div><label>Year</label><input name="year" type="number" min="1" max="6" value="${user.year || ''}"></div>
          </div>
          <div class="row">
            <div><label>Phone / WhatsApp</label><input name="phone" value="${esc(user.phone || '')}" placeholder="9876543210"></div>
            <div>
              <label>Hostel (Bhawan) &amp; Room</label>
              <input name="hostel" list="bhawanList" value="${esc(user.hostel || '')}" placeholder="Rajendra Bhawan, F-305">
              <datalist id="bhawanList">
                ${IITR_HOSTELS.map((h) => `<option value="${esc(h)}"></option>`).join('')}
              </datalist>
            </div>
          </div>
          <label>Bio / Hardware Interests</label>
          <textarea name="bio" maxlength="300" placeholder="E.g. Embedded systems, STM32, ROS2...">${esc(user.bio || '')}</textarea>
          <div class="error"></div>
          <div class="actions"><button class="btn" type="submit">Save profile</button></div>
        </form>

        <form class="card" id="pwdForm">
          <h2>Change Password</h2>
          <p class="sub">Update your account password.</p>
          <label>Current Password</label>
          <input name="current_password" type="password" required>
          <label>New Password (min 8 chars)</label>
          <input name="new_password" type="password" required minlength="8">
          <div class="error"></div>
          <div class="actions"><button class="btn secondary" type="submit">Update password</button></div>
        </form>
      </div>`;

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const d = formData(e.target);
        const res = await api('/auth/me', { method: 'PUT', body: d });
        user = res.user;
        renderNav();
        toast('Profile saved');
      } catch (err) {
        showError(e.target, err.message);
      }
    });

    document.getElementById('pwdForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const d = formData(e.target);
        await api('/auth/change-password', { method: 'POST', body: d });
        e.target.reset();
        toast('Password updated');
      } catch (err) {
        showError(e.target, err.message);
      }
    });
  }

  function viewAuth(mode) {
    const reg = mode === 'register';
    $app.innerHTML = `
      <div style="max-width:480px;margin:0 auto">
        <h1>${reg ? 'Join IITR Component Share' : 'Welcome back'}</h1>
        <p class="sub">${reg
          ? 'Sign up with your official IIT Roorkee email (@iitr.ac.in or @branch.iitr.ac.in).'
          : 'Sign in with your IIT Roorkee account to browse the feed.'}</p>

        

        <form class="card" id="authForm">
          ${reg ? `
            <label>Full Name</label><input name="name" required minlength="2" autocomplete="name" placeholder="Udit Bhatt">
            <label>I am a</label>
            <select name="role">
              <option value="junior">Junior &mdash; I need components for projects</option>
              <option value="senior">Senior &mdash; I have components to lend / rent</option>
            </select>` : ''}
          <label>IIT Roorkee Email</label>
          <input name="email" type="email" required autocomplete="email" placeholder="name@iitr.ac.in or name@ece.iitr.ac.in">
          ${reg ? `<div class="hint">Restricted to IIT Roorkee domains (<code>@iitr.ac.in</code> or <code>@*.iitr.ac.in</code>).</div>` : ''}
          <label>Password</label>
          <input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">
          ${reg ? `<div class="hint">At least 8 characters.</div>
            <div class="row">
              <div><label>Enrollment No.</label><input name="enrollment_no" placeholder="24114018"></div>
              <div><label>Branch</label><input name="branch" placeholder="ECE / CSE / EE"></div>
              <div><label>Year</label><input name="year" type="number" min="1" max="6" placeholder="1"></div>
            </div>
            <div class="row">
              <div><label>Phone</label><input name="phone" placeholder="9876543210"></div>
              <div>
                <label>Bhawan / Room</label>
                <input name="hostel" list="regBhawanList" placeholder="Cautley Bhawan, G-118">
                <datalist id="regBhawanList">
                  ${IITR_HOSTELS.map((h) => `<option value="${esc(h)}"></option>`).join('')}
                </datalist>
              </div>
            </div>` : ''}
          <div class="error"></div>
          <div class="actions"><button class="btn" type="submit">${reg ? 'Create IITR Account' : 'Sign in'}</button></div>
        </form>
        <p class="sub">${reg ? 'Already a member? <a href="#/login">Sign in</a>' : 'New here? <a href="#/register">Join with your IITR email</a>'}</p>
      </div>`;

    document.querySelectorAll('[data-demo]').forEach((btn) => {
      btn.onclick = async () => {
        const email = btn.getAttribute('data-demo');
        try {
          const res = await api('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } });
          setUser(res.user, res.token);
          await refreshNotificationsCount();
          location.hash = '#/';
          toast(`Signed in as ${res.user.name}`);
        } catch (err) {
          showError(document.getElementById('authForm'), err.message);
        }
      };
    });

    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const d = formData(form);
      Object.keys(d).forEach((k) => d[k] === '' && delete d[k]);
      try {
        const res = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: d });
        setUser(res.user, res.token);
        await refreshNotificationsCount();
        location.hash = '#/';
        toast(`Welcome, ${res.user.name.split(' ')[0]}!`);
      } catch (err) {
        showError(form, err.message);
      }
    });
  }

  /* ---------- router ---------- */
  async function route() {
    const [page, arg] = (location.hash.slice(2) || '').split('/');
    renderNav();
    window.scrollTo(0, 0);

    try {
      if (!user) {
        if (page === 'login' || page === 'register') return viewAuth(page);
        return await viewLanding();
      }
      if (page === 'login' || page === 'register') { location.hash = '#/'; return; }
      if (page === 'catalog') return await viewCatalog();
      if (page === 'new') return viewNew();
      if (page === 'mine') return await viewMine();
      if (page === 'checkouts') return await viewCheckouts();
      if (page === 'notifications') return await viewNotifications();
      if (page === 'profile') return viewProfile();
      if (page === 'request' && arg) return await viewRequest(arg);
      return await viewFeed();
    } catch (err) {
      $app.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function init() {
    if (getToken()) {
      try {
        user = (await api('/auth/me')).user;
        await refreshNotificationsCount();
      } catch {
        localStorage.removeItem('ccs_token');
      }
    }
    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
