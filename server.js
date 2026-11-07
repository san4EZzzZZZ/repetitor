const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TUTOR_INVITE_CODE = process.env.TUTOR_INVITE_CODE || 'teacher-demo-code';
const BOOKING_LOCK_HOURS = 12;
const BOOKING_LOCK_MS = BOOKING_LOCK_HOURS * 60 * 60 * 1000;

let db;

async function init() {
  const { Low } = await import('lowdb');
  const { JSONFile } = await import('lowdb/node');

  db = new Low(new JSONFile(path.join(__dirname, 'data', 'db.json')), {
    users: [],
    courses: [],
    assignments: [],
    slots: [],
    bookings: [],
  });

  await require('fs').promises.mkdir(path.join(__dirname, 'data'), { recursive: true });
  await db.read();
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

// Work on a separate snapshot so reads see only successfully saved data.
let writeQueue = Promise.resolve();

function writeRoute(handler) {
  return (req, res) => {
    const run = writeQueue.then(async () => {
      const data = structuredClone(db.data);
      const save = async (payload, status = 200) => {
        await db.adapter.write(data);
        db.data = data;
        res.status(status).json(payload);
      };
      await handler(req, res, data, save);
    });
    writeQueue = run.catch((error) => {
      console.error('Database write failed:', error.code || error.name);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка сохранения' });
    });
  };
}

function readCredentials(body, res) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const { password } = body;
  if (!name || name.length > 100) {
    res.status(400).json({ error: 'Укажите имя до 100 символов' });
  } else if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Укажите действующий email' });
  } else if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72) {
    res.status(400).json({ error: 'Пароль должен содержать от 6 символов и занимать до 72 байт' });
  } else {
    return { name, email, password };
  }
  return null;
}

function validateCourseIds(courseIds, data, res) {
  if (!Array.isArray(courseIds) || courseIds.some((courseId) => typeof courseId !== 'string')) {
    res.status(400).json({ error: 'Укажите список курсов' });
    return null;
  }
  const ids = [...new Set(courseIds)];
  const existing = new Set(data.courses.map((course) => course.id));
  if (ids.some((courseId) => !existing.has(courseId))) {
    res.status(404).json({ error: 'Курс не найден. Обновите страницу и выберите курсы снова' });
    return null;
  }
  return ids;
}

function addAssignments(data, studentId, courseIds) {
  const assigned = new Set(data.assignments.filter((a) => a.studentId === studentId).map((a) => a.courseId));
  const added = courseIds.filter((courseId) => !assigned.has(courseId));
  data.assignments.push(...added.map((courseId) => ({ id: id(), courseId, studentId })));
  return added.length;
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

function getBookedRanges(slots) {
  return slots
    .filter((slot) => slot.bookedBy)
    .map((slot) => ({ bookedBy: slot.bookedBy, range: slotRange(slot) }));
}

function findOverlappingBooking(slot, bookedRanges) {
  const range = slotRange(slot);
  return bookedRanges.find((booking) => rangesOverlap(range, booking.range));
}

function hasSlotStarted(slot, now = Date.now()) {
  return new Date(slot.start).getTime() <= now;
}

function isCancellationLocked(slot) {
  return new Date(slot.start).getTime() - Date.now() < BOOKING_LOCK_MS;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth ──────────────────────────────────────────────

app.post('/api/auth/register', writeRoute(async (req, res, data, save) => {
  const credentials = readCredentials(req.body, res);
  if (!credentials) return;
  const { name, email, password } = credentials;
  if (data.users.some((u) => u.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  }
  const role = req.body.tutorCode === TUTOR_INVITE_CODE ? 'tutor' : 'student';
  const user = { id: id(), name, email, password: await bcrypt.hash(password, 10), role };
  data.users.push(user);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: '30d',
  });
  return save({ token, user: cleanUser(user) });
}));

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.data.users.find((u) => u.email.toLowerCase() === email);
  const { password } = req.body;
  if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.password))) {
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
  const user = db.data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  res.json({ user: cleanUser(user) });
});

// ─── Student data ──────────────────────────────────────

app.get('/api/student', auth, async (req, res) => {
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
  const bookedRanges = getBookedRanges(db.data.slots);
  const now = Date.now();
  const slots = db.data.slots
    .filter((slot) => slot.bookedBy || (!hasSlotStarted(slot, now) && !findOverlappingBooking(slot, bookedRanges)))
    .sort((a, b) => a.start.localeCompare(b.start));
  res.json({ courses, bookings, slots });
});

// ─── Tutor data ────────────────────────────────────────

app.get('/api/tutor', auth, tutor, async (req, res) => {
  const bookedRanges = getBookedRanges(db.data.slots);
  const slots = db.data.slots.map((s) => {
    const booking = db.data.bookings.find((b) => b.slotId === s.id);
    const student = booking && db.data.users.find((u) => u.id === booking.studentId);
    const course = booking && db.data.courses.find((c) => c.id === booking.courseId);
    return {
      ...s,
      blockedByBooking: !s.bookedBy && Boolean(findOverlappingBooking(s, bookedRanges)),
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
  const totalSlots = db.data.slots.length;
  const bookedSlots = db.data.slots.filter((s) => s.bookedBy).length;
  const totalStudents = db.data.users.filter((u) => u.role === 'student').length;
  const totalCourses = db.data.courses.length;
  const totalBookings = db.data.bookings.length;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
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

app.post('/api/tutor/students', auth, tutor, writeRoute(async (req, res, data, save) => {
  const credentials = readCredentials(req.body, res);
  if (!credentials) return;
  const { name, email, password } = credentials;
  if (data.users.some((u) => u.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'Этот email уже зарегистрирован. Найдите ученика в списке по email' });
  }
  const courseIds = validateCourseIds(req.body.courseIds ?? [], data, res);
  if (!courseIds) return;
  const student = { id: id(), name, email, password: await bcrypt.hash(password, 10), role: 'student' };
  data.users.push(student);
  addAssignments(data, student.id, courseIds);
  return save({ student: cleanUser(student), courseIds }, 201);
}));

app.post('/api/tutor/students/:studentId/courses', auth, tutor, writeRoute(async (req, res, data, save) => {
  const { studentId } = req.params;
  if (!data.users.some((user) => user.id === studentId && user.role === 'student')) {
    return res.status(404).json({ error: 'Ученик не найден' });
  }
  const courseIds = validateCourseIds(req.body.courseIds, data, res);
  if (!courseIds) return;
  if (!courseIds.length) return res.status(400).json({ error: 'Выберите хотя бы один курс' });
  return save({ added: addAssignments(data, studentId, courseIds) });
}));

// ─── Courses ───────────────────────────────────────────

app.post('/api/courses', auth, tutor, writeRoute(async (req, res, data, save) => {
  const c = {
    id: id(),
    title: req.body.title?.trim(),
    description: req.body.description?.trim() || '',
  };
  if (!c.title) return res.status(400).json({ error: 'Укажите название курса' });
  data.courses.push(c);
  return save(c);
}));

app.delete('/api/courses/:id', auth, tutor, writeRoute(async (req, res, data, save) => {
  if (!data.courses.some((c) => c.id === req.params.id)) {
    return res.status(404).json({ error: 'Курс не найден' });
  }
  const courseBookings = data.bookings.filter((b) => b.courseId === req.params.id);
  courseBookings.forEach((b) => {
    const slot = data.slots.find((s) => s.id === b.slotId);
    if (slot) slot.bookedBy = null;
  });
  data.bookings = data.bookings.filter((b) => b.courseId !== req.params.id);
  data.courses = data.courses.filter((c) => c.id !== req.params.id);
  data.assignments = data.assignments.filter((a) => a.courseId !== req.params.id);
  return save({ ok: true });
}));

// ─── Assignments ───────────────────────────────────────

app.post('/api/assignments', auth, tutor, writeRoute(async (req, res, data, save) => {
  const { courseId, studentId } = req.body;
  if (!data.users.some((user) => user.id === studentId && user.role === 'student')) {
    return res.status(404).json({ error: 'Ученик не найден' });
  }
  const courseIds = validateCourseIds([courseId], data, res);
  if (!courseIds) return;
  return save({ ok: true, added: addAssignments(data, studentId, courseIds) });
}));

app.delete('/api/assignments/:courseId/:studentId', auth, tutor, writeRoute(async (req, res, data, save) => {
  data.assignments = data.assignments.filter(
    (a) => !(a.courseId === req.params.courseId && a.studentId === req.params.studentId)
  );
  return save({ ok: true });
}));

// ─── Slots ─────────────────────────────────────────────

app.post('/api/slots', auth, tutor, writeRoute(async (req, res, data, save) => {
  const start = new Date(req.body.start);
  if (!validDateTime(req.body.start) || start.getMinutes() % 30) {
    return res.status(400).json({ error: 'Время должно быть с шагом 30 минут' });
  }
  const finish = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  if (data.slots.some((s) => s.start === start.toISOString())) {
    return res.status(409).json({ error: 'Такой слот уже существует' });
  }
  const slot = { id: id(), start: start.toISOString(), end: finish, bookedBy: null };
  data.slots.push(slot);
  return save(slot);
}));

app.post('/api/slots/bulk', auth, tutor, writeRoute(async (req, res, data, save) => {
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

      if (data.slots.some((s) => s.start === iso)) {
        skipped.push(iso);
        continue;
      }

      const slot = { id: id(), start: iso, end: finish, bookedBy: null };
      data.slots.push(slot);
      created.push(slot);
    }
  }

  return save({ created: created.length, skipped: skipped.length });
}));

app.delete('/api/slots/:id', auth, tutor, writeRoute(async (req, res, data, save) => {
  const s = data.slots.find((x) => x.id === req.params.id);
  if (!s || s.bookedBy) {
    return res.status(400).json({ error: 'Нельзя удалить занятый слот' });
  }
  data.slots = data.slots.filter((x) => x.id !== req.params.id);
  return save({ ok: true });
}));

// ─── Bookings ──────────────────────────────────────────

app.post('/api/bookings', auth, writeRoute(async (req, res, data, save) => {
  const { slotId, courseId } = req.body;
  const slot = data.slots.find((s) => s.id === slotId);
  const allowed = data.assignments.some(
    (a) => a.courseId === courseId && a.studentId === req.user.id
  );

  if (!slot || slot.bookedBy) {
    return res.status(409).json({ error: 'Слот уже занят или не найден' });
  }
  if (!allowed) {
    return res.status(403).json({ error: 'Курс не назначен вам' });
  }
  if (hasSlotStarted(slot)) {
    return res.status(409).json({ error: 'Занятие уже началось' });
  }

  const conflict = findOverlappingBooking(slot, getBookedRanges(data.slots));
  if (conflict) {
    const error = conflict.bookedBy === req.user.id
      ? 'У вас уже есть занятие в это время'
      : 'Это время уже занято. Выберите другой слот';
    return res.status(409).json({ error });
  }

  slot.bookedBy = req.user.id;
  data.bookings.push({ id: id(), slotId, courseId, studentId: req.user.id });
  return save({ ok: true });
}));

app.delete('/api/bookings/:id', auth, writeRoute(async (req, res, data, save) => {
  const b = data.bookings.find((x) => x.id === req.params.id);
  if (!b || (b.studentId !== req.user.id && req.user.role !== 'tutor')) {
    return res.status(404).json({ error: 'Запись не найдена' });
  }
  const s = data.slots.find((x) => x.id === b.slotId);
  if (!s) {
    return res.status(404).json({ error: 'Слот не найден' });
  }
  if (isCancellationLocked(s)) {
    return res.status(409).json({
      error: `Отменить запись можно не позднее чем за ${BOOKING_LOCK_HOURS} часов до занятия`,
    });
  }
  if (s) s.bookedBy = null;
  data.bookings = data.bookings.filter((x) => x.id !== b.id);
  return save({ ok: true });
}));

// ─── SPA fallback ──────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init().then(() =>
  app.listen(PORT, () => console.log(`Tutor app: http://localhost:${PORT}`))
);
