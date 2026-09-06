/* ══════════════════════════════════════════════
   Кабинет репетитора — App Logic
   ══════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let authMode = 'login';   // 'login' | 'register'
let tutorTab = 'schedule'; // 'schedule' | 'courses' | 'students'
let calWeek = new Date();
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

const slotRangeText = (slot) => `${timeOnly(slot.start)}-${timeOnly(slot.end)}`;

const isSlotLocked = (slot) => new Date(slot.start).getTime() - Date.now() < BOOKING_LOCK_MS;

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

// ─── API Layer ──────────────────────────────────
async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + url, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
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
  $('#app').innerHTML = `
    <div class="auth-wrapper">
      <div class="card auth-card">
        <div class="auth-logo">📚</div>
        <h1>Кабинет репетитора</h1>
        <p class="auth-subtitle">Запись на занятия в удобное время</p>

        <div class="auth-tabs">
          <button class="auth-tab ${authMode === 'login' ? 'active' : ''}"
                  onclick="switchAuth('login')">Войти</button>
          <button class="auth-tab ${authMode === 'register' ? 'active' : ''}"
                  onclick="switchAuth('register')">Регистрация</button>
        </div>

        <form class="auth-form ${authMode === 'register' ? 'mode-register' : ''}" id="authForm">
          <input name="name" placeholder="Ваше имя" class="register-only">
          <input name="email" type="email" placeholder="Email" required>
          <input name="password" type="password" placeholder="Пароль (минимум 6 символов)" required>
          <input name="tutorCode" placeholder="Код репетитора (если есть)" class="register-only">
          <button type="submit" class="btn-primary">
            ${authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          <p class="auth-error" id="authError"></p>
        </form>
      </div>
    </div>
  `;

  $('#authForm').addEventListener('submit', handleAuth);
}

function switchAuth(mode) {
  authMode = mode;
  renderAuth();
}

async function handleAuth(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  const errEl = $('#authError');
  const btn = e.target.querySelector('.btn-primary');

  btn.innerHTML = '<span class="spinner"></span>';
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
  localStorage.clear();
  token = '';
  user = null;
  toast('Вы вышли из системы', 'info');
  renderAuth();
}

async function render() {
  try {
    user = (await api('/me')).user;
    localStorage.setItem('user', JSON.stringify(user));
    if (user.role === 'tutor') {
      renderTutor();
    } else {
      renderStudent();
    }
  } catch {
    logout();
  }
}

// ─── Topbar ─────────────────────────────────────
function topbarHTML(title) {
  return `
    <div class="topbar">
      <div class="topbar-left">
        <span class="topbar-logo">📚</span>
        <div>
          <h1>${title}</h1>
        </div>
      </div>
      <div class="topbar-user">
        <div class="user-badge">
          <div class="user-avatar">${initials(user.name)}</div>
          <span>${esc(user.name)}</span>
          <span class="badge badge-accent">${user.role === 'tutor' ? 'Репетитор' : 'Ученик'}</span>
        </div>
        <button class="btn-ghost" onclick="logout()">Выйти</button>
      </div>
    </div>
  `;
}

// ─── Calendar Component ─────────────────────────
function renderCalendar(slots, role, bookings = []) {
  const start = monday(calWeek);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  const byStart = {};
  slots.forEach((s) => (byStart[new Date(s.start).toISOString()] = s));

  const myBookingSlots = new Set(bookings.map((b) => b.slotId));

  const head = dates
    .map((d) => {
      const isToday = dayKey(d) === dayKey(new Date());
      return `<div class="cal-day-head ${isToday ? 'today' : ''}">
        ${d.toLocaleDateString('ru-RU', { weekday: 'short' })}
        <b>${d.getDate()}</b>
      </div>`;
    })
    .join('');

  let rows = '';
  for (let mins = 8 * 60; mins < 20 * 60; mins += 30) {
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const time = `${hh}:${mm}`;

    rows += `<div class="cal-time">${time}</div>`;

    rows += dates
      .map((d) => {
        const x = new Date(d);
        x.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        const iso = x.toISOString();
        const s = byStart[iso];

        let action = '';
        let slotHTML = '';

        if (s) {
          const isMine = myBookingSlots.has(s.id);
          const duration = Math.max(30, Math.round((new Date(s.end) - new Date(s.start)) / 60000) || 60);
          const slotStyle = `style="--slot-rows:${duration / 30}"`;
          const range = `<span class="slot-time">${slotRangeText(s)}</span>`;
          const locked = isSlotLocked(s);

          if (role === 'tutor') {
            // Tutor: click to toggle slot
            action = `onclick="toggleSlot('${iso}','${s.id}','${s.bookedBy || ''}')"`;
            if (s.bookedBy) {
              slotHTML = `<span class="cal-slot booked" ${slotStyle}>${range}${esc(s.bookedStudent || 'Занято')}${
                s.bookedCourse ? `<span class="text-small">${esc(s.bookedCourse)}</span>` : ''
              }</span>`;
            } else {
              slotHTML = `<span class="cal-slot free" ${slotStyle}>${range}Свободно</span>`;
            }
          } else {
            // Student
            if (isMine) {
              slotHTML = `<span class="cal-slot my-booking" ${slotStyle}>${range}Моё</span>`;
            } else if (s.bookedBy) {
              slotHTML = `<span class="cal-slot booked" ${slotStyle}>${range}Занято</span>`;
            } else if (locked) {
              slotHTML = `<span class="cal-slot locked" ${slotStyle}>${range}Менее ${BOOKING_LOCK_HOURS} ч</span>`;
            } else {
              action = `onclick="bookFromCalendar('${s.id}')"`;
              slotHTML = `<span class="cal-slot free" ${slotStyle}>${range}Записаться</span>`;
            }
          }
        } else if (role === 'tutor') {
          // Tutor: click empty cell to create slot
          action = `onclick="toggleSlot('${iso}','','')"`;
        }

        return `<button class="cal-cell" ${action}>${slotHTML}</button>`;
      })
      .join('');
  }

  const titleStart = dates[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const titleEnd = dates[6].toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
    <div class="calendar-header">
      <div class="calendar-nav">
        <button class="btn-icon" onclick="changeWeek(-1)">←</button>
        <button class="btn-icon" onclick="changeWeek(0)" title="Сегодня">⏺</button>
      </div>
      <span class="calendar-title">${titleStart} — ${titleEnd}</span>
      <div class="calendar-nav">
        <button class="btn-icon" onclick="changeWeek(1)">→</button>
      </div>
    </div>
    <div class="week-grid">
      <div class="cal-corner"></div>
      ${head}
      ${rows}
    </div>
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

  if (!isRefresh) {
    $('#app').innerHTML = `
      <div class="dashboard">
        ${topbarHTML('Панель репетитора')}
        <div class="stats-grid stagger">
          ${Array(4).fill('<div class="stat-card skeleton skeleton-card"></div>').join('')}
        </div>
        <div class="skeleton skeleton-card" style="height:200px"></div>
      </div>
    `;
  }

  const [data, stats] = await Promise.all([api('/tutor'), api('/tutor/stats')]);

  const assigned = new Set(data.assignments.map((a) => `${a.courseId}:${a.studentId}`));

  $('#app').innerHTML = `
    <div class="dashboard">
      ${topbarHTML('Панель репетитора')}

      <!-- Stats -->
      <div class="stats-grid stagger">
        <div class="stat-card fade-in-up">
          <div class="stat-icon">👨‍🎓</div>
          <div class="stat-value">${stats.totalStudents}</div>
          <div class="stat-label">Учеников</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">📅</div>
          <div class="stat-value">${stats.totalSlots}</div>
          <div class="stat-label">Всего слотов</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">✅</div>
          <div class="stat-value">${stats.weekBooked}/${stats.weekSlots}</div>
          <div class="stat-label">Занятий на неделе</div>
        </div>
        <div class="stat-card fade-in-up">
          <div class="stat-icon">📊</div>
          <div class="stat-value">${stats.occupancy}%</div>
          <div class="stat-label">Заполняемость</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tab-nav">
        <button class="tab-btn ${tutorTab === 'schedule' ? 'active' : ''}" onclick="switchTutorTab('schedule')">📅 Расписание</button>
        <button class="tab-btn ${tutorTab === 'courses' ? 'active' : ''}" onclick="switchTutorTab('courses')">📖 Курсы</button>
        <button class="tab-btn ${tutorTab === 'students' ? 'active' : ''}" onclick="switchTutorTab('students')">👥 Ученики</button>
      </div>

      <!-- Schedule Tab -->
      <div class="tab-panel ${tutorTab === 'schedule' ? 'active' : ''}" id="tabSchedule">
        <div class="grid">
          <div class="card">
            <h2>➕ Открыть слот</h2>
            <p class="text-muted" style="margin:8px 0 16px">Кликните на ячейку календаря или используйте форму:</p>
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
                      const locked = s && isSlotLocked(s);
                      return `
                      <div class="item">
                        <div class="item-info">
                          <div class="item-title">${esc(st?.name || '—')}</div>
                          <div class="item-sub">${dt(s?.start)} · ${esc(c?.title || '—')}</div>
                        </div>
                        <button class="btn-danger" ${locked ? 'disabled title="До занятия меньше 12 часов"' : `onclick="cancelBookingTutor('${b.id}')"`}>Отменить</button>
                      </div>`;
                    })
                    .join('')
                : '<div class="empty"><div class="empty-icon">📭</div>Записей пока нет</div>'
            }
          </div>
        </div>

        <div class="card" style="margin-top:20px">
          <h2>📅 Расписание</h2>
          <div class="legend">
            <span><span class="legend-dot free"></span>Свободный слот</span>
            <span><span class="legend-dot booked"></span>Занят</span>
          </div>
          ${renderCalendar(data.slots, 'tutor')}
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
                          <button class="btn-danger" onclick="deleteCourse('${c.id}','${esc(c.title)}')">Удалить</button>
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
          <form id="removeAssignmentForm" style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
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
        <div class="card">
          <h2>👥 Все ученики</h2>
          <div class="search-box">
            <input type="text" id="studentSearch" placeholder="Поиск по имени или email..." oninput="filterStudents()">
          </div>
          <div id="studentList">
            ${
              data.students.length
                ? data.students
                    .map((s) => {
                      const courses = data.courses.filter((c) =>
                        assigned.has(`${c.id}:${s.id}`)
                      );
                      const bookingCount = data.bookings.filter(
                        (b) => b.studentId === s.id
                      ).length;
                      return `
                      <div class="item student-item" data-search="${esc(s.name.toLowerCase())} ${esc(s.email.toLowerCase())}">
                        <div style="display:flex;align-items:center;gap:12px">
                          <div class="user-avatar">${initials(s.name)}</div>
                          <div class="item-info">
                            <div class="item-title">${esc(s.name)}</div>
                            <div class="item-sub">${esc(s.email)}</div>
                          </div>
                        </div>
                        <div style="text-align:right">
                          <span class="badge badge-accent">${courses.length} курс(ов)</span>
                          <span class="badge badge-success" style="margin-left:4px">${bookingCount} занятий</span>
                        </div>
                      </div>`;
                    })
                    .join('')
                : '<div class="empty"><div class="empty-icon">👥</div>Ученики пока не зарегистрировались</div>'
            }
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind forms
  bindTutorForms();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function switchTutorTab(tab) {
  tutorTab = tab;
  // Fast switch without refetch
  $$('.tab-btn').forEach((btn) =>
    btn.classList.toggle('active', btn.textContent.includes(
      tab === 'schedule' ? 'Расписание' : tab === 'courses' ? 'Курсы' : 'Ученики'
    ))
  );
  $$('.tab-panel').forEach((p) => p.classList.remove('active'));
  const panels = { schedule: '#tabSchedule', courses: '#tabCourses', students: '#tabStudents' };
  $(panels[tab])?.classList.add('active');
}

function filterStudents() {
  const q = ($('#studentSearch')?.value || '').toLowerCase();
  $$('.student-item').forEach((el) => {
    el.style.display = el.dataset.search.includes(q) ? '' : 'none';
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

    let count = 0;
    for (const courseId of courses) {
      for (const studentId of students) {
        try {
          await api('/assignments', {
            method: 'POST',
            body: JSON.stringify({ courseId, studentId }),
          });
          count++;
        } catch { /* skip duplicates */ }
      }
    }
    toast(`Назначено связей: ${count}`, 'success');
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
  }
}

// ─── Student Dashboard ─────────────────────────
async function renderStudent() {
  const scrollY = window.scrollY;
  const isRefresh = $('#app').querySelector('.calendar-header') !== null;

  if (!isRefresh) {
    $('#app').innerHTML = `
      <div class="dashboard">
        ${topbarHTML('Моё расписание')}
        <div class="skeleton skeleton-card" style="height:200px"></div>
      </div>
    `;
  }

  const data = await api('/student');

  const myBookingSlotIds = new Set(data.bookings.map((b) => b.slotId));

  // Sort bookings: upcoming first, past last
  const now = new Date();
  const upcoming = data.bookings
    .filter((b) => new Date(b.slot?.start) >= now)
    .sort((a, b) => new Date(a.slot.start) - new Date(b.slot.start));
  const past = data.bookings
    .filter((b) => new Date(b.slot?.start) < now)
    .sort((a, b) => new Date(b.slot.start) - new Date(a.slot.start));

  $('#app').innerHTML = `
    <div class="dashboard">
      ${topbarHTML('Моё расписание')}

      <div class="card" style="margin-bottom:20px">
        <h2>📅 Запись на занятие</h2>
        <p class="text-muted" style="margin:6px 0 14px">Выберите курс, затем нажмите на свободный слот в календаре.</p>
        ${
          data.courses.length
            ? `<div class="form-group" style="max-width:400px;margin-bottom:14px">
                <label class="form-label">Курс</label>
                <select id="course">
                  ${data.courses.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
                </select>
              </div>`
            : '<p class="text-muted text-small">Вам пока не назначены курсы. Попросите репетитора назначить вам курс.</p>'
        }
        <div class="legend">
          <span><span class="legend-dot free"></span>Свободный слот</span>
          <span><span class="legend-dot mine"></span>Моё занятие</span>
          <span><span class="legend-dot locked"></span>Запись закрыта</span>
          <span><span class="legend-dot booked"></span>Занято</span>
        </div>
        ${renderCalendar(data.slots, 'student', data.bookings)}
      </div>

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
                      <button class="btn-danger" ${isSlotLocked(b.slot) ? 'disabled title="До занятия меньше 12 часов"' : `onclick="cancelBooking('${b.id}')"`}>Отменить</button>
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
    </div>
  `;
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

// ─── Student actions ────────────────────────────
async function bookFromCalendar(slotId) {
  const courseSelect = $('#course');
  if (!courseSelect?.value) {
    toast('Сначала выберите курс', 'error');
    return;
  }
  try {
    await api('/bookings', {
      method: 'POST',
      body: JSON.stringify({ slotId, courseId: courseSelect.value }),
    });
    toast('Вы записаны на занятие!', 'success');
    renderStudent();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cancelBooking(id) {
  const ok = await confirmModal('Отменить занятие?', 'Вы уверены, что хотите отменить запись?');
  if (!ok) return;
  try {
    await api('/bookings/' + id, { method: 'DELETE' });
    toast('Занятие отменено', 'success');
    renderStudent();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── Init ───────────────────────────────────────
if (token) {
  render();
} else {
  renderAuth();
}
