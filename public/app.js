const apiBase = window.INTERVIEW_API_URL || '';
let accessToken = '';
let candidateJob = null;
let candidatePdf = '';
let recruiterPdf = '';
let selectedJob = null;

const $ = selector => document.querySelector(selector);
const views = ['landingView', 'loginView', 'candidateView', 'recruiterView', 'adminView'];
function showView(name) { views.forEach(view => $(`#${view}`).classList.toggle('hidden', view !== name)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'הפעולה נכשלה.');
  return data;
}
function setUpload(file, target, onRead) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) throw new Error('הקובץ גדול מדי. אפשר להעלות PDF עד 5MB.');
  target.title.textContent = file.name; target.hint.textContent = `${Math.round(file.size / 1024)} KB · נטען בהצלחה`;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    file.arrayBuffer().then(buffer => { let binary = ''; const bytes = new Uint8Array(buffer); for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); onRead('', btoa(binary)); });
  } else file.text().then(text => onRead(text, ''));
}
function renderAnalysis(data, board, mode) {
  const list = items => (items || []).map(item => `<li>${item}</li>`).join('');
  const questions = (data.questions || []).map(item => `<article class="question-block"><div class="question-meta">${item.label || 'שאלה'} / הכנה</div><h3>${item.question}</h3><p><b>מה בודקים:</b> ${item.why}</p><p><b>כיוון לתשובה:</b> ${item.answer}</p></article>`).join('');
  board.innerHTML = `<div class="score-row"><div class="score-caption">${mode === 'recruiter' ? 'RECRUITER REVIEW / הערכת מועמד' : 'SIMULATION READY'}<strong>${data.headline || 'ניתוח מוכן'}</strong></div><div class="score-ring" style="--score:${data.matchScore || 0}%"><b>${data.matchScore || 0}%</b></div></div><p class="result-summary">${data.summary || ''}</p><div class="result-columns"><div class="mini-panel"><h3>חוזקות</h3><ul>${list(data.strengths)}</ul></div><div class="mini-panel warning"><h3>פערים וסיכונים</h3><ul>${list(data.gaps)}</ul></div></div><div class="focus-block"><h3>נקודות לבדיקה</h3><ul>${list(data.focus)}</ul></div><div>${questions}</div><div class="tips-block"><h3>המלצות</h3><p>${(data.tips || []).join(' · ')}</p></div>${chatMarkup(mode)}`;
  board.querySelector('.chat-form').addEventListener('submit', event => sendChat(event, mode));
  setupSpeechToText(mode, board);
}
function chatMarkup(mode) {
  const micMarkup = `<button type="button" id="${mode}MicButton" class="mic-button" title="דיבור בעברית (Speech to Text)">🎙️</button>`;
  return `<div class="chat-panel"><div class="chat-title"><span>${mode === 'recruiter' ? 'שאל/י את מאמן הגיוס' : 'סימולציית מראיין'}</span><span>LIVE COACH</span></div><div class="chat-messages" id="${mode}Messages"><div class="chat-welcome">${mode === 'candidate' ? 'המראיין ישאל שאלה ראשונה לאחר התחלת הסימולציה.' : 'אפשר לשאול על המועמד, פערים או שאלות המשך.'}</div></div><form class="chat-form">${micMarkup}<input id="${mode}Input" placeholder="כתוב/י או דבר/י הודעה..." required /><button type="submit" aria-label="שלח">←</button></form><div id="${mode}MicStatus" class="mic-status hidden"><span class="mic-pulse"></span>מקשיב... דבר/י עכשיו בעברית</div></div>`;
}
function setupSpeechToText(mode, board) {
  const micBtn = board.querySelector(`#${mode}MicButton`);
  const micStatus = board.querySelector(`#${mode}MicStatus`);
  const input = board.querySelector(`#${mode}Input`);
  if (!micBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title = 'זיהוי דיבור אינו נתמך בדפדפן זה (מומלץ ב-Chrome / Edge)';
    micBtn.style.opacity = '0.4';
    micBtn.addEventListener('click', () => alert('זיהוי דיבור אינו נתמך בדפדפן זה. מומלץ להשתמש בדפדפן Chrome או Edge.'));
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'he-IL';
  recognition.continuous = true;
  recognition.interimResults = true;

  let isListening = false;
  let baseText = '';

  micBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      baseText = input.value ? input.value.trim() + ' ' : '';
      try {
        recognition.start();
      } catch (err) {
        console.error('Speech recognition start error:', err);
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('recording');
    micBtn.textContent = '🛑';
    if (micStatus) micStatus.classList.remove('hidden');
  };

  recognition.onresult = (event) => {
    let currentFinal = '';
    let currentInterim = '';
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        currentFinal += event.results[i][0].transcript + ' ';
      } else {
        currentInterim += event.results[i][0].transcript;
      }
    }
    if (input) input.value = baseText + currentFinal + currentInterim;
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (micStatus) micStatus.innerHTML = '<span class="mic-pulse error"></span>⚠️ שגיאה בזיהוי דיבור';
    setTimeout(() => {
      if (micStatus) micStatus.classList.add('hidden');
    }, 2500);
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('recording');
    micBtn.textContent = '🎙️';
    if (micStatus) micStatus.classList.add('hidden');
  };
}
async function sendChat(event, mode) {
  event.preventDefault(); const input = $(`#${mode}Input`); const messages = $(`#${mode}Messages`); const message = input.value.trim(); if (!message) return;
  messages.insertAdjacentHTML('beforeend', `<div class="chat-user">${message}</div><div class="chat-ai">חושב/ת...</div>`); input.value = '';
  try { const data = await request('/api/chat', { method: 'POST', body: JSON.stringify({ mode, role: mode === 'candidate' ? candidateJob.title : $('#recruiterRole').value, jobDescription: mode === 'candidate' ? candidateJob.description : $('#recruiterDescription').value, resume: mode === 'candidate' ? $('#candidateResume').value : $('#recruiterResume').value, resumePdf: mode === 'candidate' ? candidatePdf : recruiterPdf, message }) }); messages.lastElementChild.textContent = data.reply; } catch (error) { messages.lastElementChild.textContent = error.message; }
}
async function loadJobs(target) {
  try { const data = await request('/api/jobs'); target.innerHTML = data.jobs.map(job => `<button class="saved-job" data-id="${job.id}"><strong>${job.title}</strong><small>${job.description.slice(0, 90)}...</small><span>קישור מועמד ←</span></button>`).join('') || '<p class="muted-copy">אין עדיין משרות שמורות.</p>'; target.querySelectorAll('.saved-job').forEach(button => button.addEventListener('click', () => selectJob(button.dataset.id, data.jobs))); } catch (error) { target.innerHTML = `<p class="form-error">${error.message}</p>`; }
}
function selectJob(id, jobs) { const job = jobs.find(item => item.id === id); if (!job) return; selectedJob = job; $('#recruiterRole').value = job.title; $('#recruiterDescription').value = job.description; $('#createInviteButton').disabled = false; $('#inviteMessage').textContent = 'המשרה נבחרה. עכשיו אפשר ליצור לינק אישי למועמד.'; document.querySelectorAll('.saved-job').forEach(button => button.classList.toggle('selected', button.dataset.id === id)); }
async function loadInvite(inviteToken) { document.body.classList.add('candidate-only'); try { const data = await request(`/api/invites?token=${encodeURIComponent(inviteToken)}`); candidateJob = data.job; $('#candidateJobBanner').innerHTML = `<span>INTERVIEW INVITATION</span><strong>${candidateJob.title}</strong><p>${candidateJob.description}</p>`; showView('candidateView'); } catch (error) { $('#candidateJobBanner').innerHTML = `<span>INVITATION ERROR</span><strong>הלינק אינו זמין</strong><p>${error.message}</p>`; showView('candidateView'); } }
async function createInvite() { if (!selectedJob) return; const button = $('#createInviteButton'); button.disabled = true; $('#inviteMessage').textContent = 'יוצר/ת לינק אישי...'; try { const data = await request(`/api/jobs/${selectedJob.id}/invite`, { method: 'POST' }); selectedJob = data.job; const subject = encodeURIComponent(`הזמנה לראיון: ${data.job.title}`); const message = encodeURIComponent(`שלום,\n\nנשמח להזמין אותך לסימולציית ראיון עבור המשרה "${data.job.title}".\n\nכניסה לראיון:\n${data.job.inviteUrl}\n\nבהצלחה!`); await navigator.clipboard?.writeText(data.job.inviteUrl); $('#inviteMessage').innerHTML = `הלינק נוצר והועתק. <a href="${data.job.inviteUrl}" target="_blank" rel="noopener">פתיחת הלינק</a>`; window.location.href = `mailto:?subject=${subject}&body=${message}`; } catch (error) { $('#inviteMessage').textContent = error.message; } finally { button.disabled = false; } }

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', async () => { const view = button.dataset.view; if (view === 'candidate') { const invite = new URLSearchParams(location.search).get('invite'); if (invite) return loadInvite(invite); candidateJob = { title: 'ראיון כללי', description: 'סימולציית ראיון כללית לתפקיד שיבחר המועמד.' }; $('#candidateJobBanner').innerHTML = '<span>OPEN SIMULATION</span><strong>סימולציה עצמאית</strong><p>התחל/י עם קורות החיים שלך.</p>'; return showView('candidateView'); } $('#loginRole').value = view; $('#loginRoleLabel').textContent = view === 'admin' ? 'ADMIN' : 'RECRUITER'; showView('loginView'); }));
$('#loginForm').addEventListener('submit', async event => { event.preventDefault(); try { const role = $('#loginRole').value; const data = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ role, password: $('#password').value }) }); accessToken = data.accessToken; $('#logoutButton').classList.remove('hidden'); $('#sessionLabel').textContent = role.toUpperCase(); $('#loginError').textContent = ''; showView(role === 'admin' ? 'adminView' : 'recruiterView'); await loadJobs(role === 'admin' ? $('#adminJobs') : $('#jobsList')); } catch (error) { $('#loginError').textContent = error.message; } });
$('#logoutButton').addEventListener('click', () => { accessToken = ''; $('#logoutButton').classList.add('hidden'); showView('landingView'); });
$('#newJobButton').addEventListener('click', () => showView('adminView'));
$('#jobForm').addEventListener('submit', async event => { event.preventDefault(); try { const data = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ title: $('#jobTitle').value, description: $('#jobDescription').value }) }); $('#jobMessage').textContent = `המשרה נשמרה. לינק מועמד: ${data.job.inviteUrl}`; event.target.reset(); await loadJobs($('#adminJobs')); } catch (error) { $('#jobMessage').textContent = error.message; } });
$('#candidateForm').addEventListener('submit', event => { event.preventDefault(); const resumeInput = $('#candidateResume'); if (!candidatePdf && !resumeInput.value.trim()) { resumeInput.setCustomValidity('יש להעלות קובץ או להדביק קורות חיים.'); resumeInput.reportValidity(); return; } resumeInput.setCustomValidity(''); const board = $('#candidateBoard'); board.innerHTML = '<div class="loading-state"><div class="loading-pulse"></div><p>מכין את הסימולציה...</p><span>INTERVIEWER IS THINKING</span></div>'; renderAnalysis({ headline: 'הסימולציה מוכנה', summary: 'המראיין יתחיל בשאלה הראשונה. ענה/י בכנות ובקצב שלך.', matchScore: 0, strengths: [], gaps: [], focus: [], questions: [], tips: [] }, board, 'candidate'); $('#candidateMessages').innerHTML = '<div class="chat-welcome">ספר/י לי בקצרה על עצמך ולמה התפקיד מעניין אותך.</div>'; });
$('#recruiterForm').addEventListener('submit', async event => { event.preventDefault(); const board = $('#recruiterBoard'); board.innerHTML = '<div class="loading-state"><div class="loading-pulse"></div><p>מכין הערכת מועמד...</p><span>GEMINI IS THINKING</span></div>'; try { const data = await request('/api/analyze', { method: 'POST', body: JSON.stringify({ role: $('#recruiterRole').value, jobDescription: $('#recruiterDescription').value, resume: recruiterPdf ? '' : $('#recruiterResume').value, resumePdf: recruiterPdf }) }); renderAnalysis(data, board, 'recruiter'); } catch (error) { board.innerHTML = `<div class="board-empty"><p class="form-error">${error.message}</p></div>`; } });
function setupFieldDictation(btnSelector, targetInputSelector) {
  const btn = $(btnSelector);
  const target = $(targetInputSelector);
  if (!btn || !target) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btn.title = 'זיהוי דיבור אינו נתמך בדפדפן זה (מומלץ ב-Chrome / Edge)';
    btn.style.opacity = '0.5';
    btn.addEventListener('click', () => alert('זיהוי דיבור אינו נתמך בדפדפן זה. מומלץ להשתמש בדפדפן Chrome או Edge.'));
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'he-IL';
  recognition.continuous = true;
  recognition.interimResults = true;

  let isListening = false;
  let baseText = '';

  btn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      baseText = target.value ? target.value + ' ' : '';
      try {
        recognition.start();
      } catch (err) {
        console.error('Dictation start error:', err);
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    btn.classList.add('recording');
    btn.textContent = '🛑 מקשיב... לחץ לסיום';
  };

  recognition.onresult = (event) => {
    let currentFinal = '';
    let currentInterim = '';
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        currentFinal += event.results[i][0].transcript + ' ';
      } else {
        currentInterim += event.results[i][0].transcript;
      }
    }
    target.value = baseText + currentFinal + currentInterim;
  };

  recognition.onerror = (event) => {
    console.warn('Dictation error:', event.error);
    btn.textContent = '⚠️ שגיאה בהכתבה';
    setTimeout(() => {
      btn.textContent = '🎙️ הכתבה בקול';
      btn.classList.remove('recording');
    }, 2000);
  };

  recognition.onend = () => {
    isListening = false;
    btn.classList.remove('recording');
    btn.textContent = '🎙️ הכתבה בקול';
  };
}

setupFieldDictation('#adminDictateBtn', '#jobDescription');
setupFieldDictation('#recruiterDictateBtn', '#recruiterDescription');

function setupAccessibility() {
  const toggleBtn = $('#a11yToggle');
  const menu = $('#a11yMenu');
  const closeBtn = $('#a11yClose');
  const statementBtn = $('#a11yStatementBtn');
  const statementModal = $('#a11yStatementModal');
  const statementClose = $('#a11yStatementClose');
  const resetBtn = $('#a11yReset');

  if (!toggleBtn || !menu) return;

  const toggleMenu = () => menu.classList.toggle('hidden');
  toggleBtn.addEventListener('click', toggleMenu);
  if (closeBtn) closeBtn.addEventListener('click', () => menu.classList.add('hidden'));

  if (statementBtn && statementModal) {
    statementBtn.addEventListener('click', () => {
      menu.classList.add('hidden');
      statementModal.classList.remove('hidden');
    });
  }
  if (statementClose && statementModal) {
    statementClose.addEventListener('click', () => statementModal.classList.add('hidden'));
  }

  // Israeli Accessibility standard shortcut Alt + 9
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === '9' || e.keyCode === 57 || e.code === 'Digit9')) {
      e.preventDefault();
      toggleMenu();
    }
  });

  const a11yClasses = [
    'a11y-font-lg', 'a11y-font-xl', 'a11y-font-sm',
    'a11y-high-contrast', 'a11y-grayscale', 'a11y-invert',
    'a11y-links', 'a11y-readable-font', 'a11y-focus-outline'
  ];

  function saveA11yState() {
    const active = a11yClasses.filter(cls => document.body.classList.contains(cls));
    localStorage.setItem('interview_orbit_a11y', JSON.stringify(active));
  }

  function loadA11yState() {
    try {
      const active = JSON.parse(localStorage.getItem('interview_orbit_a11y') || '[]');
      active.forEach(cls => document.body.classList.add(cls));
      updateActiveButtons();
    } catch (err) { console.error(err); }
  }

  function updateActiveButtons() {
    $('#a11yContrastHigh')?.classList.toggle('active', document.body.classList.contains('a11y-high-contrast'));
    $('#a11yContrastInvert')?.classList.toggle('active', document.body.classList.contains('a11y-invert'));
    $('#a11yGrayscale')?.classList.toggle('active', document.body.classList.contains('a11y-grayscale'));
    $('#a11yLinks')?.classList.toggle('active', document.body.classList.contains('a11y-links'));
    $('#a11yReadableFont')?.classList.toggle('active', document.body.classList.contains('a11y-readable-font'));
    $('#a11yFocusOutline')?.classList.toggle('active', document.body.classList.contains('a11y-focus-outline'));
  }

  function toggleClass(cls) {
    document.body.classList.toggle(cls);
    saveA11yState();
    updateActiveButtons();
  }

  $('#a11yTextInc')?.addEventListener('click', () => {
    if (document.body.classList.contains('a11y-font-lg')) {
      document.body.classList.remove('a11y-font-lg');
      document.body.classList.add('a11y-font-xl');
    } else {
      document.body.classList.remove('a11y-font-sm', 'a11y-font-xl');
      document.body.classList.add('a11y-font-lg');
    }
    saveA11yState();
  });

  $('#a11yTextDec')?.addEventListener('click', () => {
    if (document.body.classList.contains('a11y-font-lg') || document.body.classList.contains('a11y-font-xl')) {
      document.body.classList.remove('a11y-font-lg', 'a11y-font-xl');
    } else {
      document.body.classList.add('a11y-font-sm');
    }
    saveA11yState();
  });

  $('#a11yContrastHigh')?.addEventListener('click', () => toggleClass('a11y-high-contrast'));
  $('#a11yContrastInvert')?.addEventListener('click', () => toggleClass('a11y-invert'));
  $('#a11yGrayscale')?.addEventListener('click', () => toggleClass('a11y-grayscale'));
  $('#a11yLinks')?.addEventListener('click', () => toggleClass('a11y-links'));
  $('#a11yReadableFont')?.addEventListener('click', () => toggleClass('a11y-readable-font'));
  $('#a11yFocusOutline')?.addEventListener('click', () => toggleClass('a11y-focus-outline'));

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      a11yClasses.forEach(cls => document.body.classList.remove(cls));
      localStorage.removeItem('interview_orbit_a11y');
      updateActiveButtons();
    });
  }

  loadA11yState();
}

setupAccessibility();

function bindFile(input, target, onRead) { $(input).addEventListener('change', () => { try { setUpload($(input).files[0], target, onRead); } catch (error) { target.hint.textContent = error.message; } }); }
bindFile('#candidateFile', { title: $('#candidateUploadTitle'), hint: $('#candidateUploadHint') }, (text, pdf) => { $('#candidateResume').value = text; candidatePdf = pdf; });
bindFile('#recruiterFile', { title: $('#recruiterUploadTitle'), hint: $('#recruiterUploadHint') }, (text, pdf) => { $('#recruiterResume').value = text; recruiterPdf = pdf; });
$('#createInviteButton').addEventListener('click', createInvite);
const invite = new URLSearchParams(location.search).get('invite'); if (invite) loadInvite(invite); else showView('landingView');
