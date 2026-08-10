const form = document.querySelector('#analysisForm');
const fileInput = document.querySelector('#resumeFile');
const resumeInput = document.querySelector('#resume');
const uploadZone = document.querySelector('#uploadZone');
const uploadTitle = document.querySelector('#uploadTitle');
const uploadHint = document.querySelector('#uploadHint');
const jobFile = document.querySelector('#jobFile');
const jobFileTitle = document.querySelector('#jobFileTitle');
const emptyState = document.querySelector('#emptyState');
const loadingState = document.querySelector('#loadingState');
const results = document.querySelector('#results');
let resumePdf = '';
const apiBase = window.INTERVIEW_API_URL || '';

function setView(view) {
  emptyState.classList.toggle('hidden', view !== 'empty');
  loadingState.classList.toggle('hidden', view !== 'loading');
  results.classList.toggle('hidden', view !== 'results');
}

function renderResults(data) {
  const strengths = (data.strengths || []).map(item => `<li>${item}</li>`).join('');
  const gaps = (data.gaps || []).map(item => `<li>${item}</li>`).join('');
  const focus = (data.focus || []).map(item => `<li>${item}</li>`).join('');
  const questions = (data.questions || []).map(item => `<article class="question-block"><div class="question-meta">${item.label || 'שאלה'} / הכנה</div><h3>${item.question}</h3><p><b>מה בודקים:</b> ${item.why}</p><p><b>כיוון לתשובה:</b> ${item.answer}</p></article>`).join('');
  const tips = (data.tips || []).join(' · ');
  results.innerHTML = `<div class="score-row"><div class="score-caption">ROLE FIT / בדיקת התאמה<strong>${data.headline || 'ניתוח מוכן'}</strong></div><div class="score-ring" style="--score:${data.matchScore || 0}%"><b>${data.matchScore || 0}%</b></div></div><p class="result-summary">${data.summary || ''}</p><div class="result-columns"><div class="mini-panel"><h3>חוזקות / STRENGTHS</h3><ul>${strengths}</ul></div><div class="mini-panel warning"><h3>חולשות / GAPS</h3><ul>${gaps}</ul></div></div><div class="focus-block"><h3>על מה להתמקד בראיון / FOCUS</h3><ul>${focus}</ul></div><div>${questions}</div><div class="tips-block"><h3>3 מיקרו-טיפים לרגע האמת</h3><p>${tips}</p></div><div class="chat-panel"><div class="chat-title"><span>שאל/י את המאמן</span><span>LIVE COACH</span></div><div class="chat-messages" id="chatMessages"><div class="chat-welcome">אפשר לבקש ניסוח לתשובה, לשאול על שאלה מסוימת או להתחיל סימולציה.</div></div><form class="chat-form" id="chatForm"><input id="chatInput" placeholder="למשל: נסח לי תשובה לשאלה הראשונה..." required /><button type="submit" aria-label="שלח">←</button></form></div>`;
  setView('results');
  document.querySelector('#chatForm').addEventListener('submit', sendChat);
}

async function sendChat(event) {
  event.preventDefault();
  const input = document.querySelector('#chatInput');
  const messages = document.querySelector('#chatMessages');
  const message = input.value.trim();
  if (!message) return;
  messages.insertAdjacentHTML('beforeend', `<div class="chat-user">${message}</div><div class="chat-ai">חושב/ת...</div>`);
  input.value = '';
  try {
    const response = await fetch(`${apiBase}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: document.querySelector('#role').value, resume: resumeInput.value, resumePdf, message }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    messages.lastElementChild.textContent = data.reply;
  } catch (error) { messages.lastElementChild.textContent = error.message; }
}

async function readFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('הקובץ גדול מדי. אפשר להעלות PDF עד 5MB.');
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    resumePdf = btoa(binary);
    resumeInput.value = 'קובץ PDF מצורף לניתוח Gemini. אין צורך להעתיק ממנו טקסט.';
    return;
  }
  resumePdf = '';
  resumeInput.value = await file.text();
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  uploadZone.classList.add('has-file');
  uploadTitle.textContent = file.name;
  uploadHint.textContent = `${Math.round(file.size / 1024)} KB · נטען בהצלחה`;
  try {
    await readFile(file);
  } catch (error) {
    uploadZone.classList.remove('has-file');
    uploadTitle.textContent = 'העלאת קורות חיים';
    uploadHint.textContent = error.message;
    fileInput.value = '';
  }
});

jobFile.addEventListener('change', async () => {
  const file = jobFile.files[0];
  if (!file) return;
  document.querySelector('#jobDescription').value = await file.text();
  jobFileTitle.textContent = `${file.name} · נטען בהצלחה`;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!resumeInput.value.trim()) { resumeInput.focus(); return; }
  setView('loading');
  try {
    const response = await fetch(`${apiBase}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: document.querySelector('#role').value.trim(), jobDescription: document.querySelector('#jobDescription').value.trim(), resume: resumePdf ? '' : resumeInput.value.trim(), resumePdf }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'לא הצלחנו להשלים את הניתוח');
    renderResults(data);
  } catch (error) {
    results.innerHTML = `<div class="board-empty"><p class="empty-kicker">GEMINI CONNECTION REQUIRED</p><h2>צריך לחבר<br><em>את המאמן.</em></h2><p class="empty-copy">${error.message}<br>אחרי הוספת המפתח, הפעל/י מחדש את השרת.</p></div>`;
    setView('results');
  }
});

document.querySelector('#resetButton').addEventListener('click', () => { form.reset(); resumePdf = ''; uploadZone.classList.remove('has-file'); uploadTitle.textContent = 'העלאת קורות חיים'; uploadHint.textContent = 'PDF, TXT או MD · עד 5MB'; jobFileTitle.textContent = 'או העלה/י הגדרת משרה כקובץ TXT / MD'; setView('empty'); });
