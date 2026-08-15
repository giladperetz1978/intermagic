const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const jobsFile = path.join(dataDir, 'jobs.json');
const recruitersFile = path.join(dataDir, 'recruiters.json');
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const sessions = new Map();
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(jobsFile)) fs.writeFileSync(jobsFile, '[]', { mode: 0o600 });
if (!fs.existsSync(recruitersFile)) fs.writeFileSync(recruitersFile, '[]', { mode: 0o600 });

function readJobs() { try { return JSON.parse(fs.readFileSync(jobsFile, 'utf8')); } catch { return []; } }
function writeJobs(jobs) { fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), { mode: 0o600 }); }
function readRecruiters() { try { return JSON.parse(fs.readFileSync(recruitersFile, 'utf8')); } catch { return []; } }
function writeRecruiters(recruiters) { fs.writeFileSync(recruitersFile, JSON.stringify(recruiters, null, 2), { mode: 0o600 }); }
function sendJson(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(JSON.stringify(payload)); }
function responseText(result) { const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim(); if (text) return text; throw new Error('Gemini לא החזיר טקסט.'); }
function parseJson(text) { const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim(); const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start < 0 || end < start) throw new Error('Gemini החזיר תשובה שאינה בפורמט JSON.'); return JSON.parse(cleaned.slice(start, end + 1)); }
function token() { return crypto.randomBytes(24).toString('hex'); }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function passwordMatches(password, record) { return crypto.timingSafeEqual(Buffer.from(passwordHash(password, record.salt).hash, 'hex'), Buffer.from(record.hash, 'hex')); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 12_000_000) reject(new Error('הבקשה גדולה מדי.')); }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('בקשה לא תקינה.')); } }); req.on('error', reject); }); }
function auth(req, roles = ['recruiter', 'admin']) { const value = req.headers.authorization || ''; const session = sessions.get(value.replace(/^Bearer\s+/i, '')); if (!session || !roles.includes(session.role)) throw new Error('נדרשת כניסה מורשית.'); return session; }
function jobView(job) { return { id: job.id, title: job.title, description: job.description, createdAt: job.createdAt, inviteToken: job.inviteToken, inviteUrl: `${process.env.PUBLIC_URL || ''}/?invite=${job.inviteToken}` }; }
async function gemini(parts, generationConfig = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('חסר GEMINI_API_KEY.');
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const requestBody = JSON.stringify({ contents: [{ parts }], generationConfig });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: requestBody });
    if (response.ok) return response.json();
    if (!retryableStatuses.has(response.status) || attempt === 2) throw new Error(`Gemini returned ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new Error('Gemini request failed.');
}
function recruiterPrompt(data) { return `אתה יועץ גיוס. נתח את קורות החיים מול המשרה עבור מנהל מגייס, לא עבור המועמד. החזר JSON בלבד בעברית: {"matchScore":number,"headline":string,"summary":string,"strengths":string[],"gaps":string[],"focus":[string],"questions":[{"label":string,"question":string,"why":string,"answer":string}],"tips":string[]}. היה ענייני, ציין סיכונים ופערים, ואל תמציא עובדות.\nמשרה: ${data.role}\nהגדרת משרה: ${data.jobDescription || 'לא סופקה'}\nקורות חיים: ${data.resume || 'מצורף PDF'}`; }
async function analyze(data) { const parts = [{ text: recruiterPrompt(data) }]; if (data.resumePdf) parts.push({ inlineData: { mimeType: 'application/pdf', data: data.resumePdf } }); return parseJson(responseText(await gemini(parts, { responseMimeType: 'application/json', temperature: 0.45 }))); }
async function chat(data) { if (!data?.role || !data?.message) throw new Error('נדרש תפקיד והודעה.'); const prompt = data.mode === 'candidate' ? `אתה מראיין מקצועי בסימולציית ראיון לתפקיד ${data.role}. שאל שאלה אחת בכל פעם, המתן לתשובת המרואיין, ותן משוב קצר ומעשי בעברית. התבסס על המשרה ועל קורות החיים, אך אל תמציא עובדות.\nמשרה: ${data.jobDescription || ''}\nקורות חיים: ${data.resume || 'מצורף PDF'}\nהודעת המרואיין: ${data.message}` : `אתה מאמן גיוס. ענה בעברית בקצרה ובאופן מעשי למגייס לגבי המועמד לתפקיד ${data.role}.\nקורות חיים: ${data.resume || 'מצורף PDF'}\nשאלת המגייס: ${data.message}`; const parts = [{ text: prompt }]; if (data.resumePdf) parts.push({ inlineData: { mimeType: 'application/pdf', data: data.resumePdf } }); return { reply: responseText(await gemini(parts, { temperature: 0.55 })) }; }
function serveStatic(req, res) { const requested = new URL(req.url, `http://${req.headers.host}`).pathname || '/'; const filePath = path.normalize(path.join(publicDir, requested === '/' ? '/index.html' : requested)); if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' }); fs.readFile(filePath, (error, content) => { if (error) return sendJson(res, 404, { error: 'Not found' }); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }; res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'text/plain'}; charset=utf-8` }); res.end(content); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/api/auth/login') { const data = await body(req); let valid = false; let username = ''; if (data.role === 'admin') valid = data.password === process.env.ADMIN_PASSWORD; if (data.role === 'recruiter') { const recruiter = readRecruiters().find(item => item.username.toLowerCase() === String(data.username || '').trim().toLowerCase()); valid = Boolean(recruiter && data.password && passwordMatches(data.password, recruiter)); username = recruiter?.username || ''; } if (!valid || !['admin', 'recruiter'].includes(data.role)) return sendJson(res, 401, { error: 'פרטי הכניסה שגויים.' }); const accessToken = token(); sessions.set(accessToken, { role: data.role, username, createdAt: Date.now() }); return sendJson(res, 200, { accessToken, role: data.role, username }); }
    if (req.method === 'POST' && url.pathname === '/api/recruiters') { auth(req, ['admin']); const data = await body(req); const username = String(data.username || '').trim(); const password = String(data.password || ''); if (username.length < 2 || password.length < 6) return sendJson(res, 400, { error: 'נדרשים שם משתמש ולפחות 6 תווים לסיסמה.' }); const recruiters = readRecruiters(); if (recruiters.some(item => item.username.toLowerCase() === username.toLowerCase())) return sendJson(res, 409, { error: 'שם המשתמש כבר קיים.' }); const credentials = passwordHash(password); recruiters.unshift({ username, ...credentials, createdAt: new Date().toISOString() }); writeRecruiters(recruiters); return sendJson(res, 201, { recruiter: { username, createdAt: recruiters[0].createdAt } }); }
    if (req.method === 'GET' && url.pathname === '/api/recruiters') { auth(req, ['admin']); return sendJson(res, 200, { recruiters: readRecruiters().map(({ username, createdAt }) => ({ username, createdAt })) }); }
    if (req.method === 'GET' && url.pathname === '/api/invites') { const job = readJobs().find(item => item.inviteToken === url.searchParams.get('token')); return job ? sendJson(res, 200, { job: jobView(job) }) : sendJson(res, 404, { error: 'לינק המשרה לא נמצא.' }); }
    if (req.method === 'GET' && url.pathname === '/api/jobs') { auth(req, ['recruiter']); return sendJson(res, 200, { jobs: readJobs().map(jobView) }); }
    if (req.method === 'POST' && url.pathname === '/api/jobs') { auth(req, ['recruiter']); const data = await body(req); if (!data.title || !data.description) return sendJson(res, 400, { error: 'נדרשים שם משרה והגדרת משרה.' }); const jobs = readJobs(); const job = { id: token().slice(0, 12), title: data.title.trim(), description: data.description.trim(), inviteToken: token(), createdAt: new Date().toISOString() }; jobs.unshift(job); writeJobs(jobs); return sendJson(res, 201, { job: jobView(job) }); }
    if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/invite')) { auth(req, ['recruiter']); const jobId = url.pathname.split('/')[3]; const jobs = readJobs(); const job = jobs.find(item => item.id === jobId); if (!job) return sendJson(res, 404, { error: 'המשרה לא נמצאה.' }); job.inviteToken = token(); writeJobs(jobs); return sendJson(res, 200, { job: jobView(job) }); }
    if (req.method === 'POST' && url.pathname === '/api/analyze') { const data = await body(req); if (!data.role || (!data.resume && !data.resumePdf)) return sendJson(res, 400, { error: 'נדרשים תפקיד וקורות חיים.' }); return sendJson(res, 200, await analyze(data)); }
    if (req.method === 'POST' && url.pathname === '/api/chat') return sendJson(res, 200, await chat(await body(req)));
    serveStatic(req, res);
  } catch (error) { sendJson(res, error.message.includes('מורשית') ? 401 : 500, { error: error.message || 'הפעולה נכשלה.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Interview Orbit is running at http://localhost:${port}`));
