/* ══════════════════════════════════════════════
   Кабинет репетитора — App Logic
   ══════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let authMode = 'login';   // 'login' | 'register'
let tutorTab = 'schedule'; // 'schedule' | 'courses' | 'students'
let calWeek = new Date();
let studentScheduleTimer;
let selectedDay = null;
const BOOKING_LOCK_HOURS = 12;
const BOOKING_LOCK_MS = BOOKING_LOCK_HOURS * 60 * 60 * 1000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ─── Utilities ──────────────────────────────────
const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const dt = (s) =>
  new Date(s).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

const timeOnly = (s) =>
  new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const slotEnd = (slot) => new Date(slot.end || new Date(slot.start).getTime() + 60 * 60 * 1000);
const slotRangeText = (slot) => `${timeOnly(slot.start)}–${timeOnly(slotEnd(slot))}`;

const hasSlotStarted = (slot, now = Date.now()) => new Date(slot.start).getTime() <= now;
const isCancellationLocked = (slot) => new Date(slot.start).getTime() - Date.now() < BOOKING_LOCK_MS;

const dayKey = (s) => {
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monday = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const n = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - n);
  return x;
};

const initials = (name) => {
  const parts = String(name || '?').trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
};


const iconPaths = {
  book: '<path d="M12 7c-2.5-2.4-5.2-2.7-9-2v13c3.8-.7 6.5-.4 9 2 2.5-2.4 5.2-2.7 9-2V5c-3.8-.7-6.5-.4-9 2Zm0 0v13"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4m-7 8h6"/>',
  users: '<circle cx="10" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m0-15a3 3 0 0 1 0 6m2 3a4 4 0 0 1 2 4v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chart: '<path d="M4 4v16h16M8 15v-3m4 3V9m4 6V6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function icon(name) {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths[name] + '</svg>';
}

// ─── API Layer ──────────────────────────────────
async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + url, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || 'Не удалось выполнить запрос');
    error.status = res.status;
    throw error;
  }
  return data;
}

// ─── Toast System ───────────────────────────────
function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── Modal System ───────────────────────────────
function showModal({ icon = '⚠️', title, message, buttons = [] }) {
  return new Promise((resolve) => {
    const overlay = $('#modalOverlay');
    const iconEl = $('#modalIcon');
    const titleEl = $('#modalTitle');
    const msgEl = $('#modalMessage');
    const actionsEl = $('#modalActions');

    iconEl.textContent = icon;
    titleEl.textContent = title;
    msgEl.textContent = message;
    actionsEl.innerHTML = '';

    buttons.forEach(({ label, type = 'btn-secondary', value }) => {
      const btn = document.createElement('button');
      btn.className = type;
      btn.textContent = label;
      btn.onclick = () => {
        overlay.classList.remove('visible');
        overlay.setAttribute('hidden', '');
        resolve(value);
      };
      actionsEl.appendChild(btn);
    });

    overlay.removeAttribute('hidden');
    // Force reflow for animation
    void overlay.offsetWidth;
    overlay.classList.add('visible');
  });
}

async function confirmModal(title, message) {
  return showModal({
    icon: '🗑️',
    title,
    message,
    buttons: [
      { label: 'Отмена', type: 'btn-secondary', value: false },
      { label: 'Подтвердить', type: 'btn-danger', value: true },
    ],
  });
}

// ─── Auth ───────────────────────────────────────
function renderAuth() {
  const registering = authMode === 'register';
  $('#app').innerHTML = `
    <main class="auth-wrapper">
      <div class="auth-layout">
        <section class="auth-intro" aria-label="О кабинете">
          <div class="brand"><span class="brand-mark">${icon('book')}</span> Кабинет репетитора</div>
          <div class="auth-intro-copy">
            <p class="eyebrow">Личное пространство для занятий</p>
            <h2>Занятия по вашему расписанию</h2>
            <p>Выбирайте удобное время, смотрите свои курсы и следите за ближайшими занятиями.</p>
          </div>
          <div class="auth-features" aria-hidden="true">
            <span>${icon('calendar')} Расписание</span>
            <span>${icon('book')} Курсы</span>
          </div>
        </section>
        <section class="card auth-card">
          <p class="eyebrow">Личный кабинет</p>
          <h1>${registering ? 'Создать аккаунт' : 'Войти в кабинет'}</h1>
          <p class="auth-subtitle">${registering ? 'Заполните данные для входа.' : 'Введите email и пароль, чтобы продолжить.'}</p>
          <div class="auth-tabs" aria-label="Вход и регистрация">
            <button type="button" class="auth-tab ${registering ? '' : 'active'}" aria-pressed="${!registering}" onclick="switchAuth('login')">Вход</button>
            <button type="button" class="auth-tab ${registering ? 'active' : ''}" aria-pressed="${registering}" onclick="switchAuth('register')">Регистрация</button>
          </div>
          <form class="auth-form" id="authForm">
            ${registering ? '<label class="field">Имя<input name="name" autocomplete="name" maxlength="100" required></label>' : ''}
            <label class="field">Email<input name="email" type="email" placeholder="name@example.com" autocomplete="username" required></label>
            <label class="field">Пароль<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" ${registering ? 'minlength="6"' : ''} required></label>
            ${registering ? '<details class="tutor-code"><summary>У меня есть код репетитора</summary><label class="field">Код репетитора<input name="tutorCode"></label></details>' : ''}
            <p class="form-error" id="authError" role="alert"></p>
            <button type="submit" class="btn-primary">${registering ? 'Зарегистрироваться' : 'Войти'}</button>
          </form>
          ${registering ? '' : '<p class="auth-footnote">Уже получили данные для входа от репетитора? Используйте их здесь.</p>'}
        </section>
      </div>
    </main>
  `;
  $('#authForm').addEventListener('submit', handleAuth);
}

function switchAuth(mode) {
  const email = $('#authForm input[name="email"]').value;
  authMode = mode;
  renderAuth();
  $('#authForm input[name="email"]').value = email;
  $('.auth-tab.active').focus();
}

async function handleAuth(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  const errEl = $('#authError');
  const btn = e.target.querySelector('.btn-primary');

  errEl.textContent = '';
  btn.textContent = 'Подождите…';
  btn.disabled = true;

  try {
    const data = await api('/auth/' + authMode, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    token = data.token;
    user = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    toast('Добро пожаловать, ' + user.name + '!', 'success');
    render();
  } catch (err) {
    errEl.textContent = err.message;
    btn.innerHTML = authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
    btn.disabled = false;
  }
}

function logout() {
  clearTimeout(studentScheduleTimer);
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  tutorTab = 'schedule';
  authMode = 'login';
  calWeek = new Date();
  token = '';
  user = null;
  toast('Вы вышли из системы', 'info');
  renderAuth();
}

async function render() {
  const session = token;
  try {
    const current = await api('/me');
    if (session !== token) return;
    user = current.user;
    localStorage.setItem('user', JSON.stringify(user));
    if (user.role === 'tutor') await renderTutor();
    else await renderStudent();
  } catch (err) {
    if (session !== token) return;
    if (err.status === 401) {
      logout();
      return;
    }
    $('#app').innerHTML = '<main class="dashboard"><div class="card"><h1>Кабинет не загрузился</h1><p class="section-help">Проверьте соединение и попробуйте снова.</p><div class="dialog-actions"><button class="btn-ghost" onclick="logout()">Выйти</button><button class="btn-primary" onclick="render()">Повторить</button></div></div></main>';
  }
}

// ─── Topbar ─────────────────────────────────────
function topbarHTML(title) {
  return `
    <div class="topbar">
      <div class="topbar-left">
        <span class="brand-mark">${icon('book')}</span>
        <div>
          <p class="eyebrow">Личный кабинет</p>
          <h1>${title}</h1>
        </div>
      </div>
      <div class="topbar-user">
        <div class="user-badge">
          <div class="user-avatar">${esc(initials(user.name))}</div>
          <span>${esc(user.name)}</span>
          <span class="badge badge-accent">${user.role === 'tutor' ? 'Репетитор' : 'Ученик'}</span>
        </div>
        <button class="btn-ghost" onclick="logout()">Выйти</button>
      </div>
    </div>
  `;
}

// ─── Calendar Component ─────────────────────────
function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function renderCalendar(slots, role, bookings = [], canBook = true) {
  const weekStart = monday(calWeek);
  const myBookings = new Map(bookings.map((booking) => [booking.slotId, booking]));
  const days = Array.from({ length: 7 }, (_, column) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + column);
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    const daySlots = new Map();
    const booked = [];

    slots.forEach((slot) => {
      const start = new Date(slot.start);
      const end = slotEnd(slot);
      if (start >= date && start < nextDay) daySlots.set(minuteOfDay(start), slot);
      if (slot.bookedBy && start < nextDay && end > date) {
        const from = start < date ? 0 : minuteOfDay(start);
        const to = end >= nextDay ? 24 * 60 : minuteOfDay(end);
        if (to > from) booked.push({ slot, from, to });
      }
    });
    return { date, daySlots, booked, column: column + 2 };
  });

  const slotDetails = (slot) => {
    if (slot.bookedBy) {
      if (role === 'tutor') {
        return { state: 'booked', label: slot.bookedStudent || 'Занято', course: slot.bookedCourse };
      }
      const booking = myBookings.get(slot.id);
      return booking
        ? { state: 'my-booking', label: user.name, course: booking.course?.title }
        : { state: 'booked', label: 'Занято' };
    }
    if (role === 'tutor') {
      const action = `onclick="toggleSlot('${new Date(slot.start).toISOString()}','${slot.id}','')"`;
      return slot.blockedByBooking
        ? { state: 'overlap', label: 'Пересекается с занятием', action }
        : { state: 'free', label: 'Свободно', action };
    }
    return canBook
      ? { state: 'free', label: 'Записаться', action: `data-book-slot="${esc(slot.id)}"` }
      : { state: 'free', label: 'Свободно' };
  };
  const slotContent = (slot, details) => `<span class="cal-slot ${details.state}">
    <span class="slot-time">${slotRangeText(slot)}</span>
    <span class="slot-label" title="${esc(details.label)}">${esc(details.label)}</span>
    ${details.course ? `<span class="slot-course" title="${esc(details.course)}">${esc(details.course)}</span>` : ''}
  </span>`;

  const today = dayKey(new Date());
  const head = days.map(({ date, column }) => `<div class="cal-day-head ${dayKey(date) === today ? 'today' : ''}" style="grid-area:1 / ${column}">
    ${date.toLocaleDateString('ru-RU', { weekday: 'short' })}
    <b>${date.getDate()}</b>
  </div>`).join('');

  // Keep a half-hour scale, adding a boundary for starts and ends between grid lines.
  const boundaries = new Set([8 * 60, 21 * 60 + 30]);
  days.forEach(({ daySlots, booked }) => {
    daySlots.forEach((slot, minutes) => {
      boundaries.add(minutes);
      boundaries.add(Math.floor(minutes / 30) * 30 + 30);
    });
    booked.forEach(({ from, to }) => {
      boundaries.add(from);
      boundaries.add(to);
    });
  });
  const earliest = Math.floor(Math.min(...boundaries) / 30) * 30;
  const latest = Math.ceil(Math.max(...boundaries) / 30) * 30;
  for (let minutes = earliest; minutes <= latest; minutes += 30) boundaries.add(minutes);
  const times = [...boundaries].sort((a, b) => a - b);
  const rowAt = new Map(times.map((minutes, index) => [minutes, index + 2]));
  const rowHeights = times.slice(0, -1).map((minutes, index) => {
    const duration = times[index + 1] - minutes;
    return Math.max(14, 48 * duration / 30);
  });

  const rows = times.slice(0, -1).map((minutes, index) => {
    const row = index + 2;
    const hours = Math.floor(minutes / 60);
    const time = `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const cells = days.map(({ date, column, daySlots, booked }) => {
      const position = `style="grid-area:${row} / ${column}"`;
      const covered = booked.some(({ from, to }) => minutes >= from && minutes < to);
      if (covered) return `<div class="cal-cell static" ${position}></div>`;
      const slot = daySlots.get(minutes);
      if (slot && !slot.bookedBy) {
        const details = slotDetails(slot);
        const content = slotContent(slot, details);
        const compact = rowHeights[index] < 40 ? ' compact' : '';
        const label = esc(`${slotRangeText(slot)} ${details.label}`);
        return details.action
          ? `<button type="button" class="cal-cell${compact}" ${position} aria-label="${label}" ${details.action}>${content}</button>`
          : `<div class="cal-cell static${compact}" ${position}>${content}</div>`;
      }
      if (role === 'tutor' && minutes % 30 === 0) {
        const start = new Date(date);
        start.setHours(hours, minutes % 60, 0, 0);
        const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        return `<button type="button" class="cal-cell" ${position} aria-label="Открыть слот на ${day}, ${time}" onclick="toggleSlot('${start.toISOString()}','','')"></button>`;
      }
      return `<div class="cal-cell static" ${position}></div>`;
    }).join('');
    return `<div class="cal-time" style="grid-area:${row} / 1">${time}</div>${cells}`;
  }).join('');

  const bookedTiles = days.map(({ column, booked }) => booked.map(({ slot, from, to }) =>
    `<div class="cal-booking" style="grid-area:${rowAt.get(from)} / ${column} / ${rowAt.get(to)}">
      ${slotContent(slot, slotDetails(slot))}
    </div>`
  ).join('')).join('');

  const agenda = days.map(({ date, daySlots, booked }) => {
    const entries = booked.map(({ from, slot }) => [from, slot]);
    daySlots.forEach((slot, minutes) => {
      if (!slot.bookedBy) entries.push([minutes, slot]);
    });
    if (!entries.length) return '';
    return `<div class="agenda-day">
      <h3>${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      ${entries.sort(([a], [b]) => a - b).map(([, slot]) => {
        const details = slotDetails(slot);
        const content = slotContent(slot, details);
        return details.action
          ? `<button type="button" ${details.action}>${content}</button>`
          : content;
      }).join('')}
    </div>`;
  }).join('');

  const titleStart = days[0].date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const titleEnd = days[6].date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
    <div class="calendar-header">
      <div class="calendar-nav">
        <button class="btn-icon" onclick="changeWeek(-1)" aria-label="Предыдущая неделя">←</button>
        <button class="btn-secondary today-button" onclick="changeWeek(0)">Сегодня</button>
      </div>
      <span class="calendar-title">${titleStart} — ${titleEnd}</span>
      <div class="calendar-nav">
        <button class="btn-icon" onclick="changeWeek(1)" aria-label="Следующая неделя">→</button>
      </div>
    </div>
    <div class="week-grid" style="grid-template-rows:54px ${rowHeights.map((height) => height + 'px').join(' ')}">
      <div class="cal-corner"></div>
      ${head}
      ${rows}
      ${bookedTiles}
    </div>
    <div class="calendar-agenda">${agenda || '<p class="empty">На этой неделе пока нет слотов.</p>'}</div>
  `;
}

function changeWeek(n) {
  if (n === 0) {
    calWeek = new Date();
  } else {
    const d = new Date(calWeek);
    d.setDate(d.getDate() + n * 7);
    calWeek = d;
  }
  selectedDay = null;
  render();
}

// ─── Tutor Dashboard ────────────────────────────
async function renderTutor() {
  const scrollY = window.scrollY;
  const isRefresh = $('#app').querySelector('.tab-nav') !== null;
  const search = $('#studentSearch')?.value || '';

  if (!isRefresh) {
    $('#app').innerHTML = `
      <main class="dashboard">
        ${topbarHTML('Панель репетитора')}
        <div class="stats-grid stagger">
          ${Array(4).fill('<div class="stat-card skeleton skeleton-card"></div>').join('')}
        </div>
        <div class="skeleton skeleton-card" style="height:200px"></div>
      </main>
    `;
  }

  const session = token;
  const [data, stats] = await Promise.all([api('/tutor'), api('/tutor/stats')]);
  if (session !== token) return;

  const assigned = new Set(data.assignments.map((a) => `${a.courseId}:${a.studentId}`));

  $('#app').innerHTML = `
    <main class="dashboard">
      ${topbarHTML('Панель репетитора')}

      <section class="dashboard-intro">
        <div>
          <p class="eyebrow">Рабочее пространство</p>
          <h2>Занятия и ученики</h2>
          <p>Управляйте расписанием, курсами и доступом учеников.</p>
        </div>
        <button type="button" class="btn-primary" id="addStudent">${icon('plus')} Добавить ученика</button>
      </section>

      <!-- Stats -->
      <div class="stats-grid stagger">
        <div class="stat-card fade-in-up">
          <div class="stat-icon">${icon('users')}</div>
          <div class="stat-value">${stats.totalStudents}</div>
          <div class="stat-label">Учеников</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">${icon('calendar')}</div>
          <div class="stat-value">${stats.totalSlots}</div>
          <div class="stat-label">Всего слотов</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">${icon('check')}</div>
          <div class="stat-value">${stats.weekBooked}/${stats.weekSlots}</div>
          <div class="stat-label">Занято слотов на неделе</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">${icon('chart')}</div>
          <div class="stat-value">${stats.occupancy}%</div>
          <div class="stat-label">Заполняемость</div>
        </div>
      </div>

      <nav class="tab-nav" aria-label="Разделы кабинета">
        ${[['schedule', 'calendar', 'Расписание'], ['courses', 'book', 'Курсы'], ['students', 'users', 'Ученики']]
          .map(([tab, symbol, label]) => `<button type="button" class="tab-btn ${tutorTab === tab ? 'active' : ''}" data-tab="${tab}" aria-pressed="${tutorTab === tab}" onclick="switchTutorTab('${tab}')">${icon(symbol)}${label}</button>`)
          .join('')}
      </nav>

      <!-- Schedule Tab -->
      <div class="tab-panel ${tutorTab === 'schedule' ? 'active' : ''}" id="tabSchedule">
        <div class="card schedule-card">
          <h2>Расписание на неделю</h2>
          <p class="section-help">Нажмите на свободную ячейку или добавьте время через форму под календарём.</p>
          <div class="legend">
            <span><span class="legend-dot free"></span>Свободный слот</span>
            <span><span class="legend-dot booked"></span>Занят</span>
            <span><span class="legend-dot overlap"></span>Пересекается с занятием</span>
          </div>
          ${renderCalendar(data.slots, 'tutor')}
        </div>

        <div class="grid">
          <div class="card">
            <h2>➕ Открыть слот</h2>
            <p class="text-muted" style="margin:8px 0 16px">Выберите дату и время начала.</p>
            <form id="slotForm">
              <div class="form-group">
                <label class="form-label">Дата и время</label>
                <input type="datetime-local" name="start" step="1800" required>
              </div>
              <button type="submit" class="btn-primary">Добавить слот</button>
            </form>

            <hr>

            <h3>📦 Создать слоты пакетом</h3>
            <p class="text-muted text-small" style="margin:6px 0 12px">Например: занятие 60 минут, шаг 30 минут создаст 08:00-09:00, 08:30-09:30 и дальше.</p>
            <form id="bulkForm" class="bulk-form">
              <div class="form-group">
                <label class="form-label">Дата с</label>
                <input type="date" name="dateFrom" required>
              </div>
              <div class="form-group">
                <label class="form-label">Дата по</label>
                <input type="date" name="dateTo" required>
              </div>
              <div class="form-group">
                <label class="form-label">Время с</label>
                <input type="time" name="timeFrom" step="1800" required>
              </div>
              <div class="form-group">
                <label class="form-label">Время по</label>
                <input type="time" name="timeTo" step="1800" required>
              </div>
              <div class="form-group">
                <label class="form-label">Длительность</label>
                <select name="durationMinutes">
                  <option value="60">60 минут</option>
                  <option value="45">45 минут</option>
                  <option value="90">90 минут</option>
                  <option value="30">30 минут</option>
                  <option value="120">120 минут</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Шаг старта</label>
                <select name="stepMinutes">
                  <option value="30">Каждые 30 минут</option>
                  <option value="15">Каждые 15 минут</option>
                  <option value="45">Каждые 45 минут</option>
                  <option value="60">Каждый час</option>
                </select>
              </div>
              <div class="form-group full-width">
                <label class="form-label">Дни недели</label>
                <div class="weekday-picker">
                  ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
                    .map((day, i) => `<label><input type="checkbox" name="weekday" value="${i + 1}" checked><span>${day}</span></label>`)
                    .join('')}
                </div>
              </div>
              <div class="bulk-preview full-width" id="bulkPreview">Заполните диапазон, и здесь появится предпросмотр.</div>
              <button type="submit" class="btn-primary full-width">Создать пакет слотов</button>
            </form>
          </div>

          <div class="card">
            <h2>📋 Записи учеников</h2>
            ${
              data.bookings.length
                ? data.bookings
                    .map((b) => {
                      const s = data.slots.find((x) => x.id === b.slotId);
                      const st = data.students.find((x) => x.id === b.studentId);
                      const c = data.courses.find((x) => x.id === b.courseId);
                      const locked = s && isCancellationLocked(s);
                      return `
                      <div class="item">
                        <div class="item-info">
                          <div class="item-title">${esc(st?.name || '—')}</div>
                          <div class="item-sub">${dt(s?.start)} · ${esc(c?.title || '—')}</div>
                        </div>
                        ${cancellationControl(b.id, locked, 'cancelBookingTutor')}
                      </div>`;
                    })
                    .join('')
                : '<div class="empty"><div class="empty-icon">📭</div>Записей пока нет</div>'
            }
          </div>
        </div>

      </div>

      <!-- Courses Tab -->
      <div class="tab-panel ${tutorTab === 'courses' ? 'active' : ''}" id="tabCourses">
        <div class="grid">
          <div class="card">
            <h2>📖 Создать курс</h2>
            <form id="courseForm">
              <input name="title" placeholder="Название курса" required>
              <textarea name="description" placeholder="Описание (необязательно)"></textarea>
              <button type="submit" class="btn-primary">Создать курс</button>
            </form>
          </div>

          <div class="card">
            <h2>📚 Мои курсы</h2>
            ${
              data.courses.length
                ? data.courses
                    .map((c) => {
                      const people = data.students.filter((s) =>
                        assigned.has(`${c.id}:${s.id}`)
                      );
                      return `
                      <div class="item" style="flex-direction:column;align-items:stretch">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                          <div class="item-info">
                            <div class="item-title">${esc(c.title)}</div>
                            ${c.description ? `<div class="item-sub">${esc(c.description)}</div>` : ''}
                          </div>
                          <button type="button" class="btn-danger" data-delete-course="${esc(c.id)}">Удалить</button>
                        </div>
                        <div class="text-small" style="margin-top:8px">
                          ${people.length ? '👥 ' + people.map((s) => esc(s.name)).join(', ') : 'Ученики не назначены'}
                        </div>
                      </div>`;
                    })
                    .join('')
                : '<div class="empty"><div class="empty-icon">📖</div>Создайте первый курс</div>'
            }
          </div>
        </div>

        <div class="card" style="margin-top:20px">
          <h3 class="section-title">🔗 Массовое назначение</h3>
          <p class="text-muted text-small" style="margin-bottom:14px">Отметьте курсы и учеников — выбранные курсы будут назначены каждому отмеченному ученику.</p>
          <form id="bulkAssignForm">
            <div class="bulk-columns">
              <div>
                <h4>Курсы</h4>
                ${
                  data.courses.length
                    ? data.courses
                        .map(
                          (c) =>
                            `<label class="check-row"><input type="checkbox" name="course" value="${c.id}"><span>${esc(c.title)}</span></label>`
                        )
                        .join('')
                    : '<p class="empty">Курсов пока нет</p>'
                }
              </div>
              <div>
                <h4>Ученики</h4>
                ${
                  data.students.length
                    ? data.students
                        .map(
                          (s) =>
                            `<label class="check-row"><input type="checkbox" name="student" value="${s.id}"><span>${esc(s.name)}<span class="text-small" style="display:block">${esc(s.email)}</span></span></label>`
                        )
                        .join('')
                    : '<p class="empty">Учеников пока нет</p>'
                }
              </div>
            </div>
            <button type="submit" class="btn-primary">Назначить выбранные</button>
          </form>

          <hr>

          <h3 class="section-title">❌ Удаление назначений</h3>
          <form id="removeAssignmentForm" class="remove-assignment-form">
            <div class="form-group">
              <label class="form-label">Курс</label>
              <select name="courseId" required>
                <option value="">Выберите курс</option>
                ${data.courses.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Ученик</label>
              <select name="studentId" required>
                <option value="">Выберите ученика</option>
                ${data.students.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <button type="submit" class="btn-danger">Удалить</button>
          </form>
        </div>
      </div>

      <!-- Students Tab -->
      <div class="tab-panel ${tutorTab === 'students' ? 'active' : ''}" id="tabStudents">
        <section class="card" aria-labelledby="studentsTitle">
          <div class="section-heading">
            <div>
              <h2 id="studentsTitle">Все ученики <span class="badge badge-accent">${data.students.length}</span></h2>
              <p class="section-help">Посмотрите, к каким курсам у ученика есть доступ.</p>
            </div>
            <button type="button" class="btn-secondary" id="addStudentInList">${icon('plus')} Добавить ученика</button>
          </div>
          ${data.students.length ? `
            <div class="search-box">
              <input type="search" id="studentSearch" aria-label="Поиск ученика" placeholder="Поиск по имени или email" value="${esc(search)}" oninput="filterStudents()">
            </div>` : ''}
          <div id="studentList">
            ${data.students.length
              ? data.students.map((student) => {
                  const courses = data.courses.filter((course) => assigned.has(`${course.id}:${student.id}`));
                  return `
                    <article class="item student-item" data-search="${esc(student.name.toLowerCase())} ${esc(student.email.toLowerCase())}">
                      <div class="student-person">
                        <div class="user-avatar">${esc(initials(student.name))}</div>
                        <div class="item-info">
                          <div class="item-title">${esc(student.name)}</div>
                          <div class="item-sub">${esc(student.email)}</div>
                        </div>
                      </div>
                      <div class="student-courses">
                        ${courses.length
                          ? courses.map((course) => `<span class="badge badge-accent">${esc(course.title)}</span>`).join('')
                          : '<span class="text-small">Курсы пока не назначены</span>'}
                      </div>
                      <button type="button" class="btn-secondary" data-student="${esc(student.id)}">${icon('plus')} Назначить курсы</button>
                    </article>`;
                }).join('')
              : '<div class="empty"><p>Учеников пока нет.</p><p>Добавьте ученика, чтобы выдать ему доступ к курсам.</p></div>'}
          </div>
          <p class="empty" id="studentNoResults" role="status" hidden>По этому запросу никого не найдено.</p>
        </section>
      </div>

      <dialog id="studentDialog" class="form-dialog" aria-labelledby="studentDialogTitle"></dialog>
    </main>
  `;

  // Bind forms
  bindTutorForms();
  bindStudentActions(data, assigned);
  filterStudents();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function switchTutorTab(tab) {
  tutorTab = tab;
  $$('.tab-btn').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  $$('.tab-panel').forEach((p) => p.classList.remove('active'));
  const panels = { schedule: '#tabSchedule', courses: '#tabCourses', students: '#tabStudents' };
  $(panels[tab])?.classList.add('active');
}

function filterStudents() {
  const search = $('#studentSearch');
  if (!search) return;
  const query = search.value.trim().toLowerCase();
  let matches = 0;
  $$('.student-item').forEach((row) => {
    row.hidden = !row.dataset.search.includes(query);
    if (!row.hidden) matches++;
  });
  $('#studentNoResults').hidden = matches > 0;
}

function bindStudentActions(data, assigned) {
  const dialog = $('#studentDialog');
  const open = (student) => {
    const courses = data.courses.filter((course) => !student || !assigned.has(`${course.id}:${student.id}`));
    const title = student ? 'Назначить курсы' : 'Добавить ученика';
    const submitLabel = student ? 'Назначить' : 'Создать аккаунт';
    dialog.innerHTML = `
      <div class="section-heading">
        <h2 id="studentDialogTitle">${title}</h2>
        <button type="button" class="btn-icon" id="closeStudentDialog" aria-label="Закрыть">×</button>
      </div>
      <p class="section-help">${student
        ? esc(student.name) + ' · ' + esc(student.email)
        : 'Ученик сможет войти по указанному email и паролю. Передайте ему эти данные лично.'}</p>
      <form id="studentDialogForm">
        ${student ? '' : `
          <label class="field">Имя<input name="name" autocomplete="off" maxlength="100" required autofocus></label>
          <label class="field">Email<input type="email" name="email" placeholder="name@example.com" autocomplete="off" maxlength="254" required></label>
          <label class="field">Пароль для входа<input type="password" name="password" autocomplete="new-password" minlength="6" maxlength="72" placeholder="Минимум 6 символов" required></label>`}
        <fieldset class="course-picker">
          <legend>Курсы ${student ? '' : '<span class="text-small">· необязательно</span>'}</legend>
          ${courses.length
            ? `<div class="course-options">${courses.map((course) => `
                <label class="check-row">
                  <input type="checkbox" name="courseId" value="${esc(course.id)}">
                  <span>${esc(course.title)}</span>
                </label>`).join('')}</div>`
            : `<p class="section-help">${data.courses.length ? 'Все курсы уже назначены этому ученику.' : 'Курсов пока нет. Создайте курс во вкладке «Курсы».'}</p>`}
        </fieldset>
        <p class="form-error" id="studentDialogError" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" id="cancelStudentDialog">Отмена</button>
          <button type="submit" class="btn-primary" ${student && !courses.length ? 'disabled' : ''}>${submitLabel}</button>
        </div>
      </form>`;
    const form = $('#studentDialogForm');
    const error = $('#studentDialogError');
    const submit = form.querySelector('[type="submit"]');
    const close = $('#closeStudentDialog');
    const cancel = $('#cancelStudentDialog');
    close.onclick = cancel.onclick = () => dialog.close();
    dialog.onclose = () => form.reset();
    dialog.oncancel = (event) => {
      if (form.getAttribute('aria-busy') === 'true') event.preventDefault();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      const courseIds = fields.getAll('courseId');
      if (student && !courseIds.length) {
        error.textContent = 'Выберите хотя бы один курс.';
        return;
      }
      const body = student ? { courseIds } : {
        name: fields.get('name'),
        email: fields.get('email'),
        password: fields.get('password'),
        courseIds,
      };
      const url = student ? `/tutor/students/${encodeURIComponent(student.id)}/courses` : '/tutor/students';
      error.textContent = '';
      form.setAttribute('aria-busy', 'true');
      submit.textContent = 'Сохраняем…';
      submit.disabled = close.disabled = cancel.disabled = true;
      try {
        await api(url, { method: 'POST', body: JSON.stringify(body) });
      } catch (err) {
        error.textContent = err.message;
        return;
      } finally {
        form.removeAttribute('aria-busy');
        submit.textContent = submitLabel;
        submit.disabled = close.disabled = cancel.disabled = false;
      }
      dialog.close();
      const search = $('#studentSearch');
      if (!student && search) search.value = '';
      switchTutorTab('students');
      toast(student ? 'Курсы назначены' : 'Аккаунт ученика создан', 'success');
      try {
        await renderTutor();
        const target = student
          ? $$('[data-student]').find((button) => button.dataset.student === student.id)
          : $('#addStudentInList');
        target?.focus();
      } catch {
        toast('Обновите страницу, чтобы увидеть изменения', 'info');
      }
    };
    dialog.showModal();
  };

  $('#addStudent').onclick = $('#addStudentInList').onclick = () => open(null);
  $$('[data-student]').forEach((button) => {
    button.onclick = () => open(data.students.find((student) => student.id === button.dataset.student));
  });
  $$('[data-delete-course]').forEach((button) => {
    const course = data.courses.find((item) => item.id === button.dataset.deleteCourse);
    button.onclick = () => deleteCourse(course.id, course.title);
  });
}

function bindTutorForms() {
  // Single slot form
  $('#slotForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/slots', {
        method: 'POST',
        body: JSON.stringify({ start: new Date(fd.get('start')).toISOString() }),
      });
      toast('Слот добавлен', 'success');
      renderTutor();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Bulk slot form
  const bulkForm = $('#bulkForm');
  bulkForm?.addEventListener('input', updateBulkPreview);
  updateBulkPreview();

  $('#bulkForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('.btn-primary');
    const weekdays = fd.getAll('weekday').map(Number);
    if (!weekdays.length) {
      toast('Выберите хотя бы один день недели', 'error');
      return;
    }
    btn.innerHTML = '<span class="spinner"></span> Создаём...';
    btn.disabled = true;
    try {
      const result = await api('/slots/bulk', {
        method: 'POST',
        body: JSON.stringify({
          dateFrom: fd.get('dateFrom'),
          dateTo: fd.get('dateTo'),
          timeFrom: fd.get('timeFrom'),
          timeTo: fd.get('timeTo'),
          durationMinutes: Number(fd.get('durationMinutes')),
          stepMinutes: Number(fd.get('stepMinutes')),
          weekdays,
        }),
      });
      toast(`Создано ${result.created} слотов${result.skipped ? `, пропущено ${result.skipped}` : ''}`, 'success');
      renderTutor();
    } catch (err) {
      toast(err.message, 'error');
      btn.innerHTML = 'Создать пакет слотов';
      btn.disabled = false;
    }
  });

  // Course form
  $('#courseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/courses', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(fd)),
      });
      toast('Курс создан', 'success');
      renderTutor();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Bulk assign form
  $('#bulkAssignForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const courses = $$('input[name=course]:checked').map((x) => x.value);
    const students = $$('input[name=student]:checked').map((x) => x.value);

    if (!courses.length || !students.length) {
      toast('Выберите хотя бы один курс и одного ученика', 'error');
      return;
    }

    const submit = e.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    let count = 0;
    let failed = 0;
    for (const courseId of courses) {
      for (const studentId of students) {
        try {
          const result = await api('/assignments', {
            method: 'POST',
            body: JSON.stringify({ courseId, studentId }),
          });
          count += result.added;
        } catch {
          failed++;
        }
      }
    }
    submit.disabled = false;
    if (failed) {
      toast(`Новых назначений: ${count}. Ошибок: ${failed}`, 'error');
    } else {
      toast(count ? `Новых назначений: ${count}` : 'Все выбранные курсы уже назначены', count ? 'success' : 'info');
    }
    renderTutor();
  });

  // Remove assignment form
  $('#removeAssignmentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const courseId = fd.get('courseId');
    const studentId = fd.get('studentId');
    if (!courseId || !studentId) {
      toast('Выберите курс и ученика', 'error');
      return;
    }
    const ok = await confirmModal('Удалить назначение?', 'Ученик больше не сможет записываться на этот курс.');
    if (ok) {
      try {
        await api(`/assignments/${courseId}/${studentId}`, { method: 'DELETE' });
        toast('Назначение удалено', 'success');
        renderTutor();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

function updateBulkPreview() {
  const form = $('#bulkForm');
  const preview = $('#bulkPreview');
  if (!form || !preview) return;

  const fd = new FormData(form);
  const timeFrom = fd.get('timeFrom');
  const timeTo = fd.get('timeTo');
  const duration = Number(fd.get('durationMinutes') || 60);
  const step = Number(fd.get('stepMinutes') || 30);
  const weekdays = fd.getAll('weekday');

  if (!timeFrom || !timeTo) {
    preview.textContent = 'Заполните диапазон, и здесь появится предпросмотр.';
    return;
  }

  const [fromH, fromM] = timeFrom.split(':').map(Number);
  const [toH, toM] = timeTo.split(':').map(Number);
  const startMins = fromH * 60 + fromM;
  const endMins = toH * 60 + toM;

  if (!weekdays.length) {
    preview.textContent = 'Выберите дни недели для генерации.';
    return;
  }
  if (startMins + duration > endMins) {
    preview.textContent = 'В этот промежуток не помещается слот с такой длительностью.';
    return;
  }

  const ranges = [];
  for (let mins = startMins; mins + duration <= endMins && ranges.length < 5; mins += step) {
    const a = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const bMins = mins + duration;
    const b = `${String(Math.floor(bMins / 60)).padStart(2, '0')}:${String(bMins % 60).padStart(2, '0')}`;
    ranges.push(`${a}-${b}`);
  }

  preview.innerHTML = `
    <span>Предпросмотр:</span>
    ${ranges.map((range) => `<b>${range}</b>`).join('')}
    <span>${ranges.length === 5 ? '...' : ''}</span>
  `;
}

// ─── Tutor actions ──────────────────────────────
async function toggleSlot(start, slotId, booked) {
  if (booked) {
    toast('Этот слот уже занят учеником', 'info');
    return;
  }
  try {
    if (slotId) {
      const ok = await confirmModal('Закрыть слот?', 'Свободный слот будет удалён из расписания.');
      if (!ok) return;
      await api('/slots/' + slotId, { method: 'DELETE' });
      toast('Слот удалён', 'success');
    } else {
      await api('/slots', { method: 'POST', body: JSON.stringify({ start }) });
      toast('Слот добавлен', 'success');
    }
    renderTutor();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteCourse(id, title) {
  const ok = await confirmModal(
    'Удалить курс?',
    `Курс «${title}» и все его назначения будут удалены.`
  );
  if (!ok) return;
  try {
    await api('/courses/' + id, { method: 'DELETE' });
    toast('Курс удалён', 'success');
    renderTutor();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cancelBookingTutor(id) {
  const ok = await confirmModal('Отменить запись?', 'Слот снова станет свободным.');
  if (!ok) return;
  try {
    await api('/bookings/' + id, { method: 'DELETE' });
    toast('Запись отменена', 'success');
    renderTutor();
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 409) render();
  }
}

// ─── Student Dashboard ─────────────────────────
async function renderStudent() {
  const scrollY = window.scrollY;
  const calendarScroll = $('.week-grid')?.scrollTop ?? 0;
  const isRefresh = $('#app').querySelector('.calendar-header') !== null;

  if (!isRefresh) {
    $('#app').innerHTML = `
      <main class="dashboard">
        ${topbarHTML('Моё расписание')}
        <div class="skeleton skeleton-card" style="height:200px"></div>
      </main>
    `;
  }

  const session = token;
  const data = await api('/student');
  if (session !== token) return;

  // Sort bookings: upcoming first, past last
  const now = new Date();
  const upcoming = data.bookings
    .filter((b) => b.slot && new Date(b.slot.start) >= now)
    .sort((a, b) => new Date(a.slot.start) - new Date(b.slot.start));
  const past = data.bookings
    .filter((b) => b.slot && new Date(b.slot.start) < now)
    .sort((a, b) => new Date(b.slot.start) - new Date(a.slot.start));

  $('#app').innerHTML = `
    <main class="dashboard">
      ${topbarHTML('Моё расписание')}

      <section class="card schedule-card" id="studentCalendar" aria-labelledby="bookingSectionTitle">
        <h2 id="bookingSectionTitle">Запись на занятие</h2>
        <p class="section-help">${data.courses.length
          ? 'Выберите свободное время. Курс можно указать в окне записи.'
          : 'Вам пока не назначены курсы. Попросите репетитора добавить вам курс.'}</p>
        <div class="legend">
          <span><span class="legend-dot free"></span>Свободный слот</span>
          <span><span class="legend-dot mine"></span>Моё занятие</span>
          <span><span class="legend-dot booked"></span>Занято</span>
        </div>
        <div id="studentCalendarGrid"></div>
      </section>
      <dialog id="bookingDialog" class="form-dialog" aria-labelledby="bookingDialogTitle"></dialog>

      <div class="grid">
        <div class="card">
          <h2>📌 Предстоящие занятия</h2>
          ${
            upcoming.length
              ? upcoming
                  .map(
                    (b) => `
                    <div class="item">
                      <div class="item-info">
                        <div class="item-title">${dt(b.slot.start)}</div>
                        <div class="item-sub">${esc(b.course?.title || '—')}</div>
                      </div>
                      <div data-cancellation-lock-at="${new Date(b.slot.start).getTime() - BOOKING_LOCK_MS + 1}">
                        ${cancellationControl(b.id, isCancellationLocked(b.slot), 'cancelBooking')}
                      </div>
                    </div>`
                  )
                  .join('')
              : '<div class="empty"><div class="empty-icon">📭</div>Предстоящих занятий нет</div>'
          }
        </div>

        <div class="card">
          <h2>📜 Прошедшие занятия</h2>
          ${
            past.length
              ? past
                  .map(
                    (b) => `
                    <div class="item" style="opacity:0.6">
                      <div class="item-info">
                        <div class="item-title">${dt(b.slot.start)}</div>
                        <div class="item-sub">${esc(b.course?.title || '—')}</div>
                      </div>
                      <span class="badge badge-accent">Завершено</span>
                    </div>`
                  )
                  .join('')
              : '<div class="empty"><div class="empty-icon">🕐</div>Прошедших занятий нет</div>'
          }
        </div>
      </div>
    </main>
  `;
  const slotsById = new Map(data.slots.map((slot) => [slot.id, slot]));
  $('#studentCalendar').onclick = (event) => {
    const button = event.target.closest('[data-book-slot]');
    if (button) openBookingDialog(slotsById.get(button.dataset.bookSlot), data.courses);
  };
  startStudentScheduleTimer(data, calendarScroll);
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function startStudentScheduleTimer(data, initialScroll) {
  clearTimeout(studentScheduleTimer);
  const grid = $('#studentCalendarGrid');
  const cancellationControls = [...document.querySelectorAll('[data-cancellation-lock-at]')];
  const displayedWeek = calWeek;
  const weekStart = monday(displayedWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  function update() {
    if (!grid.isConnected || calWeek !== displayedWeek) return;
    const now = Date.now();
    let nextUpdate = Infinity;
    const slots = data.slots.filter((slot) => {
      if (slot.bookedBy) return true;
      if (hasSlotStarted(slot, now)) return false;
      const start = new Date(slot.start).getTime();
      if (start >= weekStart && start < weekEnd) nextUpdate = Math.min(nextUpdate, start);
      return true;
    });
    const scroll = grid.querySelector('.week-grid')?.scrollTop ?? initialScroll;
    grid.innerHTML = renderCalendar(slots, 'student', data.bookings, data.courses.length > 0);
    grid.querySelector('.week-grid').scrollTop = scroll;

    for (const control of cancellationControls) {
      const lockAt = Number(control.dataset.cancellationLockAt);
      if (lockAt > now) {
        nextUpdate = Math.min(nextUpdate, lockAt);
      } else if (control.firstElementChild?.tagName === 'BUTTON') {
        control.innerHTML = cancellationLockedBadge;
      }
    }

    if (Number.isFinite(nextUpdate)) {
      const delay = Math.min(2_147_483_647, Math.max(0, nextUpdate - Date.now()));
      studentScheduleTimer = setTimeout(update, delay);
    }
  }

  update();
}

// ─── Student actions ────────────────────────────
const cancellationLockedBadge = '<span class="badge badge-warning">Менее 12 часов</span>';

function cancellationControl(id, locked, action) {
  return locked
    ? cancellationLockedBadge
    : `<button type="button" class="btn-danger" onclick="${action}('${id}')">Отменить</button>`;
}

function openBookingDialog(slot, courses) {
  if (hasSlotStarted(slot)) {
    toast('Занятие уже началось', 'error');
    render();
    return;
  }

  const dialog = $('#bookingDialog');
  const date = new Date(slot.start).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  dialog.innerHTML = `
    <div class="section-heading">
      <h2 id="bookingDialogTitle">Запись на занятие</h2>
      <button type="button" class="btn-icon" id="closeBookingDialog" aria-label="Закрыть">×</button>
    </div>
    <p class="booking-time">${esc(date)} · ${slotRangeText(slot)}</p>
    <form>
      <fieldset class="course-picker">
        <legend>Курс</legend>
        <div class="course-options">
          ${courses.map((course, index) => `<label class="check-row">
            <input type="radio" name="courseId" value="${esc(course.id)}" required
              ${index === 0 ? 'autofocus' : ''} ${courses.length === 1 ? 'checked' : ''}>
            <span>${esc(course.title)}</span>
          </label>`).join('')}
        </div>
      </fieldset>
      <p class="form-error" id="bookingDialogError" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="cancelBookingDialog">Назад</button>
        <button type="submit" class="btn-primary">Подтвердить запись</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form');
  const error = $('#bookingDialogError');
  const submit = form.querySelector('[type="submit"]');
  const close = $('#closeBookingDialog');
  const cancel = $('#cancelBookingDialog');
  close.onclick = cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (submit.disabled) event.preventDefault();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const courseId = new FormData(form).get('courseId');
    error.textContent = '';
    submit.disabled = close.disabled = cancel.disabled = true;
    submit.textContent = 'Записываем…';
    try {
      await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({ slotId: slot.id, courseId }),
      });
      toast('Вы записаны на занятие!', 'success');
    } catch (err) {
      if (err.status !== 409) {
        error.textContent = err.message;
        return;
      }
      toast(err.message, 'error');
    } finally {
      submit.disabled = close.disabled = cancel.disabled = false;
      submit.textContent = 'Подтвердить запись';
    }
    dialog.close();
    try {
      await renderStudent();
    } catch {
      toast('Обновите страницу, чтобы увидеть актуальное расписание', 'info');
    }
  };
  dialog.showModal();
}

async function cancelBooking(id) {
  const ok = await confirmModal('Отменить занятие?', 'Вы уверены, что хотите отменить запись?');
  if (!ok) return;
  try {
    await api('/bookings/' + id, { method: 'DELETE' });
    toast('Занятие отменено', 'success');
    await renderStudent();
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 409) render();
  }
}

// ─── Init ───────────────────────────────────────
if (token) {
  render();
} else {
  renderAuth();
}
