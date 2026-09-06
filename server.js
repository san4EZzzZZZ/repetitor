const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TUTOR_INVITE_CODE = process.env.TUTOR_INVITE_CODE || 'teacher-demo-code';
const BOOKING_LOCK_HOURS = 12;
const BOOKING_LOCK_MS = BOOKING_LOCK_HOURS * 60 * 60 * 1000;

const db = new Low(new JSONFile(path.join(__dirname, 'data', 'db.json')), {
  users: [],
  courses: [],
  assignments: [],
  slots: [],
  bookings: [],
});

async function init() {
  await require('fs').promises.mkdir(path.join(__dirname, 'data'), { recursive: true });
  await db.read();
  db.data ||= { users: [], courses: [], assignments: [], slots: [], bookings: [] };
  await db.write();
}

const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const cleanUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Требуется авторизация' });
  }
}

function tutor(req, res, next) {
  if (req.user.role !== 'tutor') {
    return res.status(403).json({ error: 'Доступ только для репетитора' });
  }
  next();
}

function save(res, data) {
  db.write()
    .then(() => res.json(data))
    .catch(() => res.status(500).json({ error: 'Ошибка сохранения' }));
}

function validDateTime(value) {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function minutesFromTime(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function slotRange(slot) {
  const start = new Date(slot.start).getTime();
  const end = slot.end
    ? new Date(slot.end).getTime()
    : start + 60 * 60 * 1000;
  return { start, end };
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isBookingLocked(slot) {
  return new Date(slot.start).getTime() - Date.now() < BOOKING_LOCK_MS;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth ──────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, tutorCode } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Заполните имя, email и пароль от 6 символов' });
  }
  await db.read();
  if (db.data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  }
  const role = tutorCode === TUTOR_INVITE_CODE ? 'tutor' : 'student';
  const user = {
    id: id(),
    name,
    email: email.toLowerCase(),
    password: await bcrypt.hash(password, 10),
    role,
  };
  db.data.users.push(user);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: '30d',
  });
  save(res, { token, user: cleanUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  await db.read();
  const user = db.data.users.find(
    (u) => u.email === String(req.body.email || '').toLowerCase()
  );
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  res.json({
    token: jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, {
      expiresIn: '30d',
    }),
    user: cleanUser(user),
  });
});

app.get('/api/me', auth, async (req, res) => {
  await db.read();
  res.json({ user: cleanUser(db.data.users.find((u) => u.id === req.user.id)) });
});

// ─── Student data ──────────────────────────────────────

app.get('/api/student', auth, async (req, res) => {
  await db.read();
  const courses = db.data.courses.filter((c) =>
    db.data.assignments.some((a) => a.courseId === c.id && a.studentId === req.user.id)
  );
  const bookings = db.data.bookings
    .filter((b) => b.studentId === req.user.id)
    .map((b) => ({
      ...b,
      slot: db.data.slots.find((s) => s.id === b.slotId),
      course: db.data.courses.find((c) => c.id === b.courseId),
    }));
  res.json({
    courses,
    bookings,
    slots: db.data.slots.sort((a, b) => a.start.localeCompare(b.start)),
  });
});

// ─── Tutor data ────────────────────────────────────────

app.get('/api/tutor', auth, tutor, async (req, res) => {
  await db.read();
  const slots = db.data.slots.map((s) => {
    const booking = db.data.bookings.find((b) => b.slotId === s.id);
    const student = booking && db.data.users.find((u) => u.id === booking.studentId);
    const course = booking && db.data.courses.find((c) => c.id === booking.courseId);
    return {
      ...s,
      bookedStudent: student?.name || null,
      bookedCourse: course?.title || null,
    };
  });
  res.json({
    students: db.data.users.filter((u) => u.role === 'student').map(cleanUser),
    courses: db.data.courses,
    assignments: db.data.assignments,
    slots: slots.sort((a, b) => a.start.localeCompare(b.start)),
    bookings: db.data.bookings,
  });
});

// ─── Tutor stats ───────────────────────────────────────

app.get('/api/tutor/stats', auth, tutor, async (req, res) => {
  await db.read();
  const totalSlots = db.data.slots.length;
  const bookedSlots = db.data.slots.filter((s) => s.bookedBy).length;
  const totalStudents = db.data.users.filter((u) => u.role === 'student').length;
  const totalCourses = db.data.courses.length;
  const totalBookings = db.data.bookings.length;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekSlots = db.data.slots.filter((s) => {
    const d = new Date(s.start);
    return d >= weekStart && d < weekEnd;
  });
  const weekBooked = weekSlots.filter((s) => s.bookedBy).length;

  res.json({
    totalSlots,
    bookedSlots,
    freeSlots: totalSlots - bookedSlots,
    totalStudents,
    totalCourses,
    totalBookings,
    weekSlots: weekSlots.length,
    weekBooked,
    occupancy: totalSlots ? Math.round((bookedSlots / totalSlots) * 100) : 0,
  });
});

// ─── Courses ───────────────────────────────────────────

app.post('/api/courses', auth, tutor, async (req, res) => {
  await db.read();
  const c = {
    id: id(),
    title: req.body.title?.trim(),
    description: req.body.description?.trim() || '',
  };
  if (!c.title) return res.status(400).json({ error: 'Укажите название курса' });
  db.data.courses.push(c);
  save(res, c);
});

app.delete('/api/courses/:id', auth, tutor, async (req, res) => {
  await db.read();
  if (!db.data.courses.some((c) => c.id === req.params.id)) {
    return res.status(404).json({ error: 'Курс не найден' });
  }
  const courseBookings = db.data.bookings.filter((b) => b.courseId === req.params.id);
  courseBookings.forEach((b) => {
    const slot = db.data.slots.find((s) => s.id === b.slotId);
    if (slot) slot.bookedBy = null;
  });
  db.data.bookings = db.data.bookings.filter((b) => b.courseId !== req.params.id);
  db.data.courses = db.data.courses.filter((c) => c.id !== req.params.id);
  db.data.assignments = db.data.assignments.filter((a) => a.courseId !== req.params.id);
  save(res, { ok: true });
});

// ─── Assignments ───────────────────────────────────────

app.post('/api/assignments', auth, tutor, async (req, res) => {
  await db.read();
  const { courseId, studentId } = req.body;
  if (!db.data.assignments.some((a) => a.courseId === courseId && a.studentId === studentId)) {
    db.data.assignments.push({ id: id(), courseId, studentId });
  }
  save(res, { ok: true });
});

app.delete('/api/assignments/:courseId/:studentId', auth, tutor, async (req, res) => {
  await db.read();
  db.data.assignments = db.data.assignments.filter(
    (a) => !(a.courseId === req.params.courseId && a.studentId === req.params.studentId)
  );
  save(res, { ok: true });
});

// ─── Slots ─────────────────────────────────────────────

app.post('/api/slots', auth, tutor, async (req, res) => {
  await db.read();
  const start = new Date(req.body.start);
  if (!validDateTime(req.body.start) || start.getMinutes() % 30) {
    return res.status(400).json({ error: 'Время должно быть с шагом 30 минут' });
  }
  const finish = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  if (db.data.slots.some((s) => s.start === start.toISOString())) {
    return res.status(409).json({ error: 'Такой слот уже существует' });
  }
  const slot = { id: id(), start: start.toISOString(), end: finish, bookedBy: null };
  db.data.slots.push(slot);
  save(res, slot);
});

app.post('/api/slots/bulk', auth, tutor, async (req, res) => {
  await db.read();
  const { dateFrom, dateTo, timeFrom, timeTo } = req.body;
  const durationMinutes = Number(req.body.durationMinutes || 60);
  const stepMinutes = Number(req.body.stepMinutes || 60);
  const weekdays = Array.isArray(req.body.weekdays)
    ? req.body.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
    : [1, 2, 3, 4, 5, 6, 7];

  if (!dateFrom || !dateTo || !timeFrom || !timeTo) {
    return res.status(400).json({ error: 'Укажите диапазон дат и времени' });
  }

  const dFrom = new Date(dateFrom + 'T00:00:00');
  const dTo = new Date(dateTo + 'T00:00:00');
  if (isNaN(dFrom) || isNaN(dTo) || dFrom > dTo) {
    return res.status(400).json({ error: 'Некорректный диапазон дат' });
  }

  const startMins = minutesFromTime(timeFrom);
  const endMins = minutesFromTime(timeTo);

  if (startMins === null || endMins === null || startMins >= endMins) {
    return res.status(400).json({ error: 'Время начала должно быть раньше времени окончания' });
  }
  if (![30, 45, 60, 90, 120].includes(durationMinutes)) {
    return res.status(400).json({ error: 'Выберите корректную длительность занятия' });
  }
  if (![15, 30, 45, 60].includes(stepMinutes)) {
    return res.status(400).json({ error: 'Выберите корректный шаг начала слотов' });
  }
  if (!weekdays.length) {
    return res.status(400).json({ error: 'Выберите хотя бы один день недели' });
  }
  if (startMins + durationMinutes > endMins) {
    return res.status(400).json({ error: 'В выбранный интервал не помещается ни один слот' });
  }

  const created = [];
  const skipped = [];

  for (let d = new Date(dFrom); d <= dTo; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay() === 0 ? 7 : d.getDay();
    if (!weekdays.includes(weekday)) continue;

    for (let mins = startMins; mins + durationMinutes <= endMins; mins += stepMinutes) {
      const start = new Date(d);
      start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      const iso = start.toISOString();
      const finish = new Date(start.getTime() + durationMinutes * 60 * 1000).toISOString();

      if (db.data.slots.some((s) => s.start === iso)) {
        skipped.push(iso);
        continue;
      }

      const slot = { id: id(), start: iso, end: finish, bookedBy: null };
      db.data.slots.push(slot);
      created.push(slot);
    }
  }

  db.write()
    .then(() => res.json({ created: created.length, skipped: skipped.length }))
    .catch(() => res.status(500).json({ error: 'Ошибка сохранения' }));
});

app.delete('/api/slots/:id', auth, tutor, async (req, res) => {
  await db.read();
  const s = db.data.slots.find((x) => x.id === req.params.id);
  if (!s || s.bookedBy) {
    return res.status(400).json({ error: 'Нельзя удалить занятый слот' });
  }
  db.data.slots = db.data.slots.filter((x) => x.id !== req.params.id);
  save(res, { ok: true });
});

// ─── Bookings ──────────────────────────────────────────

app.post('/api/bookings', auth, async (req, res) => {
  await db.read();
  const { slotId, courseId } = req.body;
  const slot = db.data.slots.find((s) => s.id === slotId);
  const allowed = db.data.assignments.some(
    (a) => a.courseId === courseId && a.studentId === req.user.id
  );

  if (!slot || slot.bookedBy) {
    return res.status(409).json({ error: 'Слот уже занят или не найден' });
  }
  if (!allowed) {
    return res.status(403).json({ error: 'Курс не назначен вам' });
  }
  if (isBookingLocked(slot)) {
    return res.status(409).json({
      error: `Записаться можно не позднее чем за ${BOOKING_LOCK_HOURS} часов до занятия`,
    });
  }

  const targetRange = slotRange(slot);
  const hasConflict = db.data.bookings.some((b) => {
    if (b.studentId !== req.user.id) return false;
    const otherSlot = db.data.slots.find((s) => s.id === b.slotId);
    return otherSlot && rangesOverlap(targetRange, slotRange(otherSlot));
  });

  if (hasConflict) {
    return res.status(409).json({ error: 'У вас уже есть занятие в это время' });
  }

  slot.bookedBy = req.user.id;
  db.data.bookings.push({ id: id(), slotId, courseId, studentId: req.user.id });
  save(res, { ok: true });
});

app.delete('/api/bookings/:id', auth, async (req, res) => {
  await db.read();
  const b = db.data.bookings.find((x) => x.id === req.params.id);
  if (!b || (b.studentId !== req.user.id && req.user.role !== 'tutor')) {
    return res.status(404).json({ error: 'Запись не найдена' });
  }
  const s = db.data.slots.find((x) => x.id === b.slotId);
  if (!s) {
    return res.status(404).json({ error: 'Слот не найден' });
  }
  if (isBookingLocked(s)) {
    return res.status(409).json({
      error: `Отменить запись можно не позднее чем за ${BOOKING_LOCK_HOURS} часов до занятия`,
    });
  }
  if (s) s.bookedBy = null;
  db.data.bookings = db.data.bookings.filter((x) => x.id !== b.id);
  save(res, { ok: true });
});

// ─── SPA fallback ──────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init().then(() =>
  app.listen(PORT, () => console.log(`Tutor app: http://localhost:${PORT}`))
);
