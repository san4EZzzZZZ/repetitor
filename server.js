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
const db = new Low(new JSONFile(path.join(__dirname, 'data', 'db.json')), {
  users: [], courses: [], assignments: [], slots: [], bookings: []
});

async function init() {
  await require('fs').promises.mkdir(path.join(__dirname, 'data'), { recursive: true });
  await db.read();
  db.data ||= { users: [], courses: [], assignments: [], slots: [], bookings: [] };
  await db.write();
}
const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const cleanUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Требуется авторизация' }); }
}
function tutor(req, res, next) { if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Доступ только для репетитора' }); next(); }
function save(res, data) { db.write().then(() => res.json(data)).catch(() => res.status(500).json({ error: 'Ошибка сохранения' })); }
function validDateTime(value) { const d = new Date(value); return !Number.isNaN(d.getTime()); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, tutorCode } = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Заполните имя, email и пароль от 6 символов' });
  await db.read();
  if (db.data.users.some(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  const role = tutorCode === TUTOR_INVITE_CODE ? 'tutor' : 'student';
  const user = { id: id(), name, email: email.toLowerCase(), password: await bcrypt.hash(password, 10), role };
  db.data.users.push(user);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  save(res, { token, user: cleanUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  await db.read(); const user = db.data.users.find(u => u.email === String(req.body.email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ error: 'Неверный email или пароль' });
  res.json({ token: jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' }), user: cleanUser(user) });
});
app.get('/api/me', auth, async (req, res) => { await db.read(); res.json({ user: cleanUser(db.data.users.find(u => u.id === req.user.id)) }); });

app.get('/api/student', auth, async (req, res) => {
  await db.read(); const courses = db.data.courses.filter(c => db.data.assignments.some(a => a.courseId === c.id && a.studentId === req.user.id));
  const bookings = db.data.bookings.filter(b => b.studentId === req.user.id).map(b => ({ ...b, slot: db.data.slots.find(s => s.id === b.slotId), course: db.data.courses.find(c => c.id === b.courseId) }));
  // Показываем ученику все слоты: занятые остаются в календаре и отображаются как «Занято».
  res.json({ courses, bookings, slots: db.data.slots.sort((a,b) => a.start.localeCompare(b.start)) });
});
app.get('/api/tutor', auth, tutor, async (req, res) => {
  await db.read(); const slots = db.data.slots.map(s => { const booking = db.data.bookings.find(b => b.slotId === s.id); const student = booking && db.data.users.find(u => u.id === booking.studentId); const course = booking && db.data.courses.find(c => c.id === booking.courseId); return { ...s, bookedStudent: student?.name || null, bookedCourse: course?.title || null }; }); res.json({ students: db.data.users.filter(u => u.role === 'student').map(cleanUser), courses: db.data.courses, assignments: db.data.assignments, slots: slots.sort((a,b) => a.start.localeCompare(b.start)), bookings: db.data.bookings });
});
app.post('/api/courses', auth, tutor, async (req, res) => { await db.read(); const c = { id:id(), title:req.body.title?.trim(), description:req.body.description?.trim() || '' }; if (!c.title) return res.status(400).json({error:'Укажите название курса'}); db.data.courses.push(c); save(res,c); });
app.post('/api/assignments', auth, tutor, async (req, res) => { await db.read(); const {courseId, studentId} = req.body; if (!db.data.assignments.some(a=>a.courseId===courseId&&a.studentId===studentId)) db.data.assignments.push({id:id(), courseId, studentId}); save(res,{ok:true}); });
app.delete('/api/assignments/:courseId/:studentId', auth, tutor, async (req, res) => { await db.read(); db.data.assignments = db.data.assignments.filter(a => !(a.courseId === req.params.courseId && a.studentId === req.params.studentId)); save(res, {ok:true}); });
app.delete('/api/courses/:id', auth, tutor, async (req, res) => { await db.read(); if (!db.data.courses.some(c => c.id === req.params.id)) return res.status(404).json({error:'Курс не найден'}); const courseBookings = db.data.bookings.filter(b => b.courseId === req.params.id); courseBookings.forEach(b => { const slot = db.data.slots.find(s => s.id === b.slotId); if (slot) slot.bookedBy = null; }); db.data.bookings = db.data.bookings.filter(b => b.courseId !== req.params.id); db.data.courses = db.data.courses.filter(c => c.id !== req.params.id); db.data.assignments = db.data.assignments.filter(a => a.courseId !== req.params.id); save(res, {ok:true}); });
app.post('/api/slots', auth, tutor, async (req, res) => {
  await db.read(); const start = new Date(req.body.start); if (!validDateTime(req.body.start) || start.getMinutes() % 30) return res.status(400).json({error:'Время должно быть с шагом 30 минут'});
  const finish = new Date(start.getTime()+60*60*1000).toISOString();
  if (db.data.slots.some(s => s.start === start.toISOString())) return res.status(409).json({error:'Такой слот уже существует'});
  const slot = {id:id(), start:start.toISOString(), end:finish, bookedBy:null}; db.data.slots.push(slot); save(res,slot);
});
app.delete('/api/slots/:id', auth, tutor, async (req,res) => { await db.read(); const s=db.data.slots.find(x=>x.id===req.params.id); if (!s || s.bookedBy) return res.status(400).json({error:'Нельзя удалить занятый слот'}); db.data.slots=db.data.slots.filter(x=>x.id!==req.params.id); save(res,{ok:true}); });
app.post('/api/bookings', auth, async (req,res) => {
  await db.read(); const {slotId, courseId}=req.body; const slot=db.data.slots.find(s=>s.id===slotId); const allowed=db.data.assignments.some(a=>a.courseId===courseId&&a.studentId===req.user.id);
  if (!slot || slot.bookedBy) return res.status(409).json({error:'Слот уже занят или не найден'}); if (!allowed) return res.status(403).json({error:'Курс не назначен вам'});
  const start=new Date(slot.start).getTime(); if (db.data.bookings.some(b=>b.studentId===req.user.id && Math.abs(new Date(db.data.slots.find(s=>s.id===b.slotId).start).getTime()-start)<60*60*1000)) return res.status(409).json({error:'У вас уже есть занятие в это время'});
  slot.bookedBy=req.user.id; db.data.bookings.push({id:id(),slotId,courseId,studentId:req.user.id}); save(res,{ok:true});
});
app.delete('/api/bookings/:id', auth, async (req,res) => { await db.read(); const b=db.data.bookings.find(x=>x.id===req.params.id); if(!b || (b.studentId!==req.user.id && req.user.role!=='tutor')) return res.status(404).json({error:'Запись не найдена'}); const s=db.data.slots.find(x=>x.id===b.slotId); if(s)s.bookedBy=null; db.data.bookings=db.data.bookings.filter(x=>x.id!==b.id); save(res,{ok:true}); });
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
init().then(() => app.listen(PORT, () => console.log(`Tutor app: http://localhost:${PORT}`)));
