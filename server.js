const http = require('http');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(payload));
}

function errorMessage(error, fallback) {
  if (error?.cause?.code) return `${fallback} (${error.cause.code})`;
  return error?.message || fallback;
}

function responseText(result) {
  const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (text) return text;
  const reason = result.candidates?.[0]?.finishReason;
  throw new Error(reason ? `Gemini סיים ללא טקסט (${reason})` : 'Gemini לא החזיר טקסט. נסה/י PDF קטן יותר או קובץ PDF עם טקסט חי.');
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Gemini החזיר תשובה שאינה בפורמט JSON. נסה/י שוב.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function ensureFocus(result) {
  if (!Array.isArray(result.focus) || result.focus.length === 0) {
    result.focus = [...(result.gaps || []), ...(result.tips || [])].slice(0, 5);
  }
  return result;
}

function promptFor(data) {
  return `אתה מאמן ראיונות עבודה חד, אמפתי ומעשי. נתח את קורות החיים המצורפים מול התפקיד והחזר JSON בלבד בעברית.\nמבנה JSON מדויק: {"matchScore":number,"headline":string,"summary":string,"strengths":string[],"gaps":string[],"focus":[string],"questions":[{"label":string,"question":string,"why":string,"answer":string}],"tips":string[]}\nחשוב: matchScore הוא אחוז התאמה אמיתי ומנומק בין 0 ל-100. focus חייב לכלול 3-5 נושאים קונקרטיים שעליהם המועמד צריך להתמקד בראיון. צור 4-5 שאלות מותאמות, עם תשובת הכנה קצרה לכל שאלה. אל תמציא עובדות שלא מופיעות בקורות החיים. אם מצורף PDF, קרא אותו ישירות ושמור על עברית תקינה.\nתפקיד: ${data.role}\nהגדרת משרה: ${data.jobDescription || 'לא סופקה'}\nקורות חיים שהודבקו: ${data.resume || 'קורות החיים נמצאים בקובץ PDF מצורף.'}`;
}

function resumeParts(data) {
  const parts = [{ text: promptFor(data) }];
  if (data.resumePdf) parts.push({ inlineData: { mimeType: 'application/pdf', data: data.resumePdf } });
  return parts;
}

async function analyze(data) {
  if (!process.env.GEMINI_API_KEY) throw new Error('חסר GEMINI_API_KEY. הוסף/י אותו בקובץ .env והפעל/י מחדש את השרת.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: resumeParts(data) }], generationConfig: { responseMimeType: 'application/json', temperature: 0.55 } })
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const result = await response.json();
  return ensureFocus(parseJson(responseText(result)));
}

async function chat(data) {
  if (!process.env.GEMINI_API_KEY) throw new Error('חסר GEMINI_API_KEY. הוסף/י אותו בקובץ .env והפעל/י מחדש את השרת.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [...resumeParts({ ...data, resume: `תפקיד: ${data.role}\n${data.resume || 'קורות החיים נמצאים בקובץ המצורף.'}` }), { text: `הודעת המשתמש: ${data.message}\nענה בעברית, קצר, מעשי ומותאם לתפקיד ולניסיון.` }] }] })
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const result = await response.json();
  return { reply: responseText(result) };
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'text/plain'}; charset=utf-8` });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    return res.end();
  }
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10_000_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (!data.role || (!data.resume && !data.resumePdf)) return sendJson(res, 400, { error: 'Role and resume are required' });
        sendJson(res, 200, await analyze(data));
      } catch (error) { sendJson(res, 500, { error: errorMessage(error, 'Analysis failed') }); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try { sendJson(res, 200, await chat(JSON.parse(body))); }
      catch (error) { sendJson(res, 500, { error: errorMessage(error, 'Chat failed') }); }
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(port, '127.0.0.1', () => console.log(`Interview Orbit is running at http://localhost:${port}`));
