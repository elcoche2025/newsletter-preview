// --- Password Gate ---
const PASSWORD_HASH = '94eaf28af84472141155e36562ac0de59d5ae8a37c334dc8ad402a99b8c9bf6b';
const AUTH_KEY = 'bancroft_auth';
const AUTH_DAYS = 30;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAuthenticated() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return false;
  try {
    const { hash, expires } = JSON.parse(stored);
    if (Date.now() > expires) { localStorage.removeItem(AUTH_KEY); return false; }
    return hash === PASSWORD_HASH;
  } catch { localStorage.removeItem(AUTH_KEY); return false; }
}

function setupPasswordGate() {
  if (isAuthenticated()) {
    unlockSite();
    return;
  }

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('password-input');
    const hash = await sha256(input.value);
    if (hash === PASSWORD_HASH) {
      localStorage.setItem(AUTH_KEY, JSON.stringify({
        hash: PASSWORD_HASH,
        expires: Date.now() + AUTH_DAYS * 24 * 60 * 60 * 1000
      }));
      unlockSite();
    } else {
      document.getElementById('password-error').hidden = false;
      input.value = '';
      input.focus();
    }
  });
}

function unlockSite() {
  document.getElementById('password-gate').hidden = true;
  document.body.classList.add('authenticated');
  init();
}

// --- State ---
let currentLang = 'es';
let currentWeekData = null;
let configData = null;
let calendarData = null;
let weeksList = [];
let selectedClass = localStorage.getItem('selectedClass') || '';

// --- Init ---
async function init() {
  try {
    const [config, index, calendar] = await Promise.all([
      fetchJSON('data/config.json'),
      fetchJSON('data/weeks/weeks-index.json'),
      fetchJSON('data/calendar.json')
    ]);
    configData = config;
    weeksList = index;
    calendarData = calendar;

    buildClassSelector();
    buildQuickLinks();
    setupDarkMode();
    setupPrintButton();
    setupShareButton();

    const hash = window.location.hash.replace('#', '');
    const targetWeek = weeksList.includes(hash) ? hash : weeksList[0];

    await loadWeek(targetWeek, false);
    renderArchiveList();

    // Set up scroll animations after initial render
    requestAnimationFrame(() => setupScrollAnimations());
  } catch (err) {
    showError('Could not load the newsletter. Please check back later.');
    console.error(err);
  }
}

async function fetchJSON(path) {
  const res = await fetch(path + '?v=' + Date.now());
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

// --- Class Selector ---
function buildClassSelector() {
  const container = document.getElementById('class-selector-buttons');
  const allBtn = container.querySelector('[data-class=""]');

  const flags = configData.classroomFlags || {};
  configData.classrooms.forEach(classroom => {
    const btn = document.createElement('button');
    btn.className = 'class-btn';
    btn.dataset.class = classroom;
    const flag = flags[classroom] || '';
    if (flag.startsWith('img:')) {
      btn.innerHTML = flagHTML(flag, 'small') + ' ' + classroom;
    } else {
      btn.textContent = flag ? `${flag} ${classroom}` : classroom;
    }
    container.appendChild(btn);
  });

  container.querySelectorAll('.class-btn').forEach(btn => {
    if (btn.dataset.class === selectedClass) btn.classList.add('active');
  });
  if (!selectedClass) allBtn.classList.add('active');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.class-btn');
    if (!btn) return;
    selectedClass = btn.dataset.class;
    localStorage.setItem('selectedClass', selectedClass);
    container.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMySpecials();
    renderClassroomGrids(currentWeekData.specials, configData.labels[currentLang]);
  });
}

// --- Load a week ---
async function loadWeek(date, updateHash) {
  try {
    currentWeekData = await fetchJSON(`data/weeks/${date}.json`);
    if (updateHash !== false) {
      window.location.hash = date;
    }
    render();
    updateActiveArchiveLink(date);
  } catch (err) {
    showError(`Could not load newsletter for ${date}. The data file may be missing.`);
    console.error(err);
  }
}

// --- Render everything ---
function render() {
  const data = currentWeekData;
  const lang = currentLang;
  const labels = configData.labels[lang];

  // Header
  document.getElementById('title').textContent = labels.title;
  document.getElementById('subtitle').textContent = labels.subtitle;
  document.getElementById('date-display').textContent = formatDate(data.date, lang);

  // Logo
  const logoSrc = configData.seasonLogos[data.season] || configData.seasonLogos['default'];
  document.getElementById('school-logo').src = logoSrc;

  // Language toggle buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Class selector label
  document.getElementById('class-selector-label').textContent =
    lang === 'es' ? 'Mi Salón:' : 'My Classroom:';

  // Content sections
  document.getElementById('welcome-heading').textContent = labels.welcomeHeading;
  document.getElementById('welcome-body').innerHTML = textToHTML(data.welcome[lang]) + renderImages(data.welcomeImages)
    + shareableImageHTML('weekly-summary', labels.title + ' - ' + labels.subtitle);

  document.getElementById('math-heading').textContent = labels.mathHeading;
  document.getElementById('math-body').innerHTML = textToHTML(data.math[lang]) + renderImages(data.mathImages)
    + shareableImageHTML('math-focus', labels.mathHeading);

  document.getElementById('literacy-heading').textContent = labels.literacyHeading;
  document.getElementById('literacy-body').innerHTML = textToHTML(data.literacy[lang]) + renderImages(data.literacyImages);

  // Specials schedule
  document.getElementById('specials-heading').textContent = labels.specialsHeading;
  renderSpecials(data.specials, labels);

  // My Specials (personalized)
  renderMySpecials();

  // Classroom grids
  renderClassroomGrids(data.specials, labels);

  // ROARS
  document.getElementById('roars-heading').textContent = labels.roarsHeading;
  renderROARS(data.roars);

  // Archive headings
  document.getElementById('archive-heading').textContent = labels.archiveHeading;
  const mobileHeading = document.getElementById('archive-heading-mobile');
  if (mobileHeading) mobileHeading.textContent = labels.archiveHeading;

  // Re-render archive links with translated dates
  renderArchiveList();

  // --- NEW FEATURES ---
  renderDashboard();
  renderReminders();
  renderMathDetails();
  renderAskYourChild();
  renderVocabulary();
  renderBooks();
  renderQuickLinks();

  // Update header action tooltips
  document.getElementById('print-btn').title = labels.printBtn;
  document.getElementById('share-btn').title = labels.shareBtn;
}

// ============================================================
// FEATURE 1: Dashboard / At a Glance
// ============================================================
function renderDashboard() {
  const lang = currentLang;
  const labels = configData.labels[lang];
  const cal = calendarData;

  document.getElementById('dashboard-heading').textContent = labels.dashboardHeading;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDay = parseDate(cal.firstDay);
  const lastDay = parseDate(cal.lastDay);

  // Build set of all no-school dates
  const noSchoolDates = new Set();
  cal.dates.forEach(d => noSchoolDates.add(d.date));
  // Fill break ranges
  if (cal.breaks) {
    cal.breaks.forEach(br => {
      const d = parseDate(br.start);
      const end = parseDate(br.end);
      while (d <= end) {
        noSchoolDates.add(formatDateISO(d));
        d.setDate(d.getDate() + 1);
      }
    });
  }

  // Count school days
  const totalSchoolDays = countWeekdays(firstDay, lastDay, noSchoolDates);
  const effectiveToday = today > lastDay ? lastDay : today < firstDay ? firstDay : today;
  const elapsedSchoolDays = countWeekdays(firstDay, effectiveToday, noSchoolDates);
  const remainingDays = Math.max(0, totalSchoolDays - elapsedSchoolDays);

  // Week number (based on actual school calendar, not published newsletters)
  const currentWeekDate = parseDate(currentWeekData.date);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.max(1, Math.ceil((currentWeekDate - firstDay + msPerWeek) / msPerWeek));
  const totalWeeks = Math.ceil((lastDay - firstDay + msPerWeek) / msPerWeek);

  // Upcoming dates (next 3 future dates from calendar)
  const upcomingDates = cal.dates
    .filter(d => parseDate(d.date) > today)
    .slice(0, 3);

  const progressPct = Math.min(100, Math.round((elapsedSchoolDays / totalSchoolDays) * 100));

  const body = document.getElementById('dashboard-body');
  body.innerHTML = `
    <div class="dashboard-stats">
      <div class="dashboard-stat">
        <div class="dashboard-stat-value">${labels.weekXofY.replace('{x}', weekNum).replace('{y}', totalWeeks)}</div>
        <div class="dashboard-progress-bar">
          <div class="dashboard-progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="dashboard-stat" style="text-align:center;">
        <div class="dashboard-stat-big">${remainingDays}</div>
        <div class="dashboard-stat-label">${labels.schoolDaysLeft}</div>
      </div>
    </div>
    ${upcomingDates.length > 0 ? `
    <div class="dashboard-upcoming">
      <h4>${labels.upcomingDates}</h4>
      ${upcomingDates.map(d => `
        <div class="dashboard-upcoming-item">
          <span class="dashboard-upcoming-type">${cal.typeLabels[lang][d.type] || d.type}</span>
          <span class="dashboard-upcoming-date">${formatDate(d.date, lang)}</span>
          <span class="dashboard-upcoming-name">${d[lang]}</span>
          <button class="ics-btn" onclick="event.stopPropagation(); downloadICS('${d.date}', '${escapeAttr(d.en)}')" title="${labels.addToCalendar}">📅</button>
        </div>
      `).join('')}
    </div>` : ''}
  `;
}

function countWeekdays(start, end, noSchoolDates) {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    const iso = formatDateISO(d);
    if (dow >= 1 && dow <= 5 && !noSchoolDates.has(iso)) {
      count++;
    }
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ============================================================
// FEATURE 3: Ask Your Child About...
// ============================================================
function renderAskYourChild() {
  const data = currentWeekData;
  const section = document.getElementById('ask-your-child');
  const body = document.getElementById('ask-body');
  const heading = document.getElementById('ask-heading');
  const labels = configData.labels[currentLang];

  if (!data.askYourChild || data.askYourChild.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  heading.textContent = labels.askHeading;

  body.innerHTML = data.askYourChild.map(item => `
    <div class="ask-bubble">
      <span class="ask-bubble-icon">💬</span>
      <p>${escapeHTML(item[currentLang])}</p>
    </div>
  `).join('') + shareableImageHTML('ask-your-child', labels.askHeading);
}

// ============================================================
// FEATURE 4: Quick Links Bar
// ============================================================
function buildQuickLinks() {
  renderQuickLinks();
}

function renderQuickLinks() {
  const container = document.getElementById('quick-links');
  const links = configData.quickLinks;
  if (!links || links.length === 0) {
    container.style.display = 'none';
    return;
  }
  const lang = currentLang;
  container.innerHTML = links.map(link => `
    <a href="${link.url}" target="_blank" rel="noopener" class="quick-link">
      <span class="quick-link-icon">${link.icon}</span>
      <span class="quick-link-label">${link[lang]}</span>
    </a>
  `).join('');
}

// ============================================================
// FEATURE 5: Important Reminders
// ============================================================
function renderReminders() {
  const data = currentWeekData;
  const section = document.getElementById('reminders');
  const body = document.getElementById('reminders-body');
  const heading = document.getElementById('reminders-heading');
  const labels = configData.labels[currentLang];

  if (!data.reminders || data.reminders.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  heading.textContent = labels.remindersHeading;

  body.innerHTML = data.reminders.map(r => `
    <div class="reminder-item">
      <span class="reminder-icon">📌</span>
      <div class="reminder-content">
        <span class="reminder-date">${formatDate(r.date, currentLang)}</span>
        <p>${escapeHTML(r[currentLang])}</p>
      </div>
    </div>
  `).join('');
}

// ============================================================
// FEATURE 6: Vocabulary / Words of the Week
// ============================================================
function renderVocabulary() {
  const data = currentWeekData;
  const section = document.getElementById('vocabulary');
  const body = document.getElementById('vocab-body');
  const heading = document.getElementById('vocab-heading');
  const labels = configData.labels[currentLang];

  if (!data.vocabulary || !data.vocabulary[currentLang] || data.vocabulary[currentLang].length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  heading.textContent = labels.vocabHeading;

  body.innerHTML = `<div class="vocab-pills">
    ${data.vocabulary[currentLang].map(word => `<span class="vocab-pill">${escapeHTML(word)}</span>`).join('')}
  </div>` + shareableImageHTML('vocabulary', labels.vocabHeading);
}

// ============================================================
// FEATURE 7: Books & Read-Alouds
// ============================================================
function renderBooks() {
  const data = currentWeekData;
  const section = document.getElementById('books');
  const body = document.getElementById('books-body');
  const heading = document.getElementById('books-heading');
  const labels = configData.labels[currentLang];
  const lang = currentLang;

  if (!data.books || data.books.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  heading.textContent = labels.booksHeading;

  body.innerHTML = data.books.map(book => {
    const title = book.title[lang] || book.title.en;
    const ytLink = book.youtubeUrl
      ? `<a href="${book.youtubeUrl}" target="_blank" rel="noopener" class="book-yt-link">▶️ ${lang === 'es' ? 'Ver Lectura en Voz Alta' : 'Watch Read-Aloud'}</a>`
      : '';
    const questions = (book.questions && book.questions.length > 0)
      ? `<details class="book-questions">
           <summary>${labels.discussionQuestions}</summary>
           <ul>${book.questions.map(q => `<li>${escapeHTML(q[lang])}</li>`).join('')}</ul>
         </details>`
      : '';

    return `<div class="book-card">
      <div class="book-card-icon">📖</div>
      <div class="book-card-content">
        <div class="book-title">${escapeHTML(title)}</div>
        <div class="book-author">${escapeHTML(book.author)}</div>
        ${ytLink}
        ${questions}
      </div>
    </div>`;
  }).join('')
    + data.books.map((book, i) =>
        shareableImageHTML(`book-${i + 1}`, book.title[lang] || book.title.en)
      ).join('');
}

// ============================================================
// FEATURE 8: Math Curriculum Details
// ============================================================
function renderMathDetails() {
  // Remove any existing math-details
  const existing = document.querySelector('.math-details');
  if (existing) existing.remove();

  const data = currentWeekData;
  if (!data.mathDetails) return;

  const labels = configData.labels[currentLang];
  const lang = currentLang;
  const md = data.mathDetails;

  const detailsHTML = `<div class="math-details">
    <div class="math-detail-item"><strong>${labels.mathDetailsModule}:</strong> ${escapeHTML(md.module[lang])}</div>
    <div class="math-detail-item"><strong>${labels.mathDetailsTopic}:</strong> ${escapeHTML(md.topic[lang])}</div>
    <div class="math-detail-item"><strong>${labels.mathDetailsLesson}:</strong> ${escapeHTML(md.lesson[lang])}</div>
  </div>`;

  document.getElementById('math-body').insertAdjacentHTML('beforeend', detailsHTML);
}

// ============================================================
// FEATURE 9: Entrance Animations
// ============================================================
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.section, .classroom-card, .newsletter-header, .quick-links-bar, .class-selector-bar').forEach(el => {
    el.classList.add('animate-ready');
    observer.observe(el);
  });
}

// ============================================================
// FEATURE 10: Print Button
// ============================================================
function setupPrintButton() {
  document.getElementById('print-btn').addEventListener('click', () => {
    window.print();
  });
}

// ============================================================
// FEATURE 11: Share Button
// ============================================================
function setupShareButton() {
  document.getElementById('share-btn').addEventListener('click', async () => {
    const url = window.location.href;
    const title = `Bancroft ES - ${configData.labels[currentLang].title}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch (e) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('share-btn');
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch (e) {
        prompt(currentLang === 'es' ? 'Copiar enlace:' : 'Copy link:', url);
      }
    }
  });
}

// ============================================================
// FEATURE 12: Add to Calendar (.ics download)
// ============================================================
function downloadICS(dateStr, title) {
  const [y, m, d] = dateStr.split('-');
  const dtStart = `${y}${m}${d}`;

  // All-day event: DTEND is the next day
  const endDate = new Date(Number(y), Number(m) - 1, Number(d) + 1);
  const dtEnd = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bancroft ES//Newsletter//EN',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${title} (DCPS)`,
    'DESCRIPTION:From the DCPS 2025-26 School Calendar',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bancroft-${dateStr}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// FEATURE 13: Dark Mode
// ============================================================
function setupDarkMode() {
  const btn = document.getElementById('dark-mode-btn');
  const stored = localStorage.getItem('darkMode');

  if (stored === 'true' || (stored === null && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-mode');
    btn.textContent = '☀️';
  }

  btn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);
    btn.textContent = isDark ? '☀️' : '🌙';
  });
}

// ============================================================
// EXISTING FEATURES (from original script.js)
// ============================================================

// --- My Specials This Week (personalized) ---
async function renderMySpecials() {
  const section = document.getElementById('my-specials');
  const body = document.getElementById('my-specials-body');
  const heading = document.getElementById('my-specials-heading');

  if (!selectedClass || !currentWeekData) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  const lang = currentLang;
  const labels = configData.labels[lang];
  const specials = currentWeekData.specials;
  const rotations = configData.rotations[selectedClass];
  const icons = configData.subjectIcons;
  const translations = configData.subjectTranslations;

  heading.textContent = lang === 'es'
    ? `Especialidades de ${selectedClass} Esta Semana`
    : `${selectedClass}'s Specials This Week`;

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayKey = dayNames[new Date().getDay()];

  const [ny, nm, nd] = currentWeekData.date.split('-').map(Number);
  const weekStart = new Date(ny, nm - 1, nd);

  const daily = await fetchWeatherData();

  body.innerHTML = dayKeys.map((day, i) => {
    const letter = (specials[day] || '').trim().toUpperCase();
    const isNoSchool = letter.includes('NO SCHOOL') || letter.includes('NO HAY') || letter.includes('CONFERENCES');
    const isToday = day === todayKey;

    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    const shortDate = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;
    const dayLabel = `${labels.days[i]} (${shortDate})`;

    const weatherHTML = weatherSnippetHTML(daily, i, lang);

    if (isNoSchool) {
      return `<div class="my-specials-day no-school${isToday ? ' today' : ''}">
        <div class="my-specials-day-name">${dayLabel}</div>
        <div class="my-specials-day-icon">🚫</div>
        <div class="my-specials-day-subject">${labels.noSchool}</div>
        ${weatherHTML}
      </div>`;
    }

    const subject = (letter.length === 1 && rotations[letter]) ? rotations[letter] : '—';
    const subjectName = lang === 'es' ? (translations[subject] || subject) : subject;
    const icon = icons[subject] || '📅';

    return `<div class="my-specials-day${isToday ? ' today' : ''}">
      <div class="my-specials-day-name">${dayLabel}</div>
      <div class="my-specials-day-icon">${icon}</div>
      <div class="my-specials-day-subject">${subjectName}</div>
      <div class="my-specials-day-letter">${letter}</div>
      ${weatherHTML}
    </div>`;
  }).join('');
}

// --- Specials Schedule Table ---
async function renderSpecials(specials, labels) {
  const tbody = document.querySelector('#specials-table tbody');
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  const [ny, nm, nd] = currentWeekData.date.split('-').map(Number);
  const weekStart = new Date(ny, nm - 1, nd);

  const daily = await fetchWeatherData();

  tbody.innerHTML = days.map((day, i) => {
    const val = specials[day] || '';
    const isNoSchool = val.toUpperCase().includes('NO SCHOOL') || val.toUpperCase().includes('NO HAY');
    const displayVal = isNoSchool ? labels.noSchool : val;
    const cellClass = isNoSchool ? ' class="no-school-cell"' : '';

    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    const shortDate = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;

    const weatherHTML = weatherSnippetHTML(daily, i, currentLang);

    return `<tr>
      <td>${labels.days[i]} <span class="specials-date">(${shortDate})</span></td>
      <td${cellClass}>${displayVal}${weatherHTML ? '<div class="specials-weather-row">' + weatherHTML + '</div>' : ''}</td>
    </tr>`;
  }).join('');
}

// --- Classroom Rotation Grids ---
function renderClassroomGrids(specials, labels) {
  const container = document.getElementById('classroom-grids');
  const rotations = configData.rotations;
  const icons = configData.subjectIcons;
  const translations = configData.subjectTranslations;
  const lang = currentLang;

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = dayNames[new Date().getDay()];
  const todayVal = (specials[today] || '').trim().toUpperCase();
  const activeLetters = new Set();
  if (todayVal.length === 1 && todayVal >= 'A' && todayVal <= 'F') {
    activeLetters.add(todayVal);
  }

  const classroomsToShow = selectedClass
    ? [selectedClass]
    : configData.classrooms;

  container.innerHTML = classroomsToShow.map(classroom => {
    const classRotations = rotations[classroom];
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => {
      const subject = classRotations[letter];
      const subjectName = lang === 'es' ? (translations[subject] || subject) : subject;
      const icon = icons[subject] || '';
      const highlight = activeLetters.has(letter) ? ' class="rotation-highlight"' : '';
      return `<tr${highlight}>
        <td>${letter}</td>
        <td>${icon}</td>
        <td>${subjectName}</td>
      </tr>`;
    }).join('');

    const flag = (configData.classroomFlags || {})[classroom] || '';
    return `<div class="classroom-card">
      <div class="classroom-card-header">${classroom}<br><span class="classroom-flag">${flagHTML(flag, 'large')}</span></div>
      <table>${rows}</table>
    </div>`;
  }).join('');
}

// --- ROARS ---
function renderROARS(roars) {
  const container = document.getElementById('roars-cards');
  container.innerHTML = configData.classrooms.map(classroom => {
    const name = roars[classroom] || '';
    const flag = (configData.classroomFlags || {})[classroom] || '';
    return `<div class="roars-card">
      <div class="roars-card-classroom">${classroom}</div>
      <div class="roars-card-flag">${flagHTML(flag, 'large')}</div>
      <div class="roars-card-name">${name}</div>
    </div>`;
  }).join('');
}

// --- Archive List ---
function renderArchiveList() {
  const labels = configData.labels[currentLang];
  const html = weeksList.map(date => {
    const formatted = `${labels.weekOf} ${formatDate(date, currentLang)}`;
    const activeClass = currentWeekData && currentWeekData.date === date ? ' class="active"' : '';
    return `<li><a href="#${date}"${activeClass} onclick="loadWeek('${date}'); return false;">${formatted}</a></li>`;
  }).join('');

  document.getElementById('archive-list').innerHTML = html;
  const mobileList = document.getElementById('archive-list-mobile');
  if (mobileList) mobileList.innerHTML = html;
}

function updateActiveArchiveLink(date) {
  document.querySelectorAll('.archive-sidebar a, .archive-mobile a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + date);
  });
}

// --- Language Toggle (with smooth transition) ---
document.getElementById('lang-toggle-wrap').addEventListener('click', (e) => {
  const btn = e.target.closest('.lang-btn');
  if (!btn || btn.dataset.lang === currentLang) return;
  currentLang = btn.dataset.lang;
  document.documentElement.lang = currentLang;

  const main = document.getElementById('newsletter');
  main.classList.add('fade-out');
  setTimeout(() => {
    render();
    main.classList.remove('fade-out');
    main.classList.add('fade-in');
    setTimeout(() => main.classList.remove('fade-in'), 300);
  }, 150);
});

// --- Hash change listener ---
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (weeksList.includes(hash) && (!currentWeekData || currentWeekData.date !== hash)) {
    loadWeek(hash, false);
  }
});

// --- Helpers ---
function formatDate(dateStr, lang) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const locale = lang === 'es' ? 'es-US' : 'en-US';
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function textToHTML(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped.split(/\n\n+/);
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function escapeHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderImages(images) {
  if (!images || images.length === 0) return '';
  const imgs = images.map(img => {
    const alt = img.alt || '';
    const caption = img.caption || '';
    const captionHTML = caption ? `<figcaption>${caption}</figcaption>` : '';
    return `<figure class="section-image"><img src="${img.src}" alt="${alt}" loading="lazy">${captionHTML}</figure>`;
  }).join('');
  return `<div class="section-images">${imgs}</div>`;
}

// --- Weather ---
const BANCROFT_LAT = 38.9296;
const BANCROFT_LON = -77.0325;
let weatherCache = {};

async function fetchWeatherData() {
  if (!currentWeekData || currentWeekData.date !== weeksList[0]) return null;

  const [ny, nm, nd] = currentWeekData.date.split('-').map(Number);
  const weekStart = new Date(ny, nm - 1, nd);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);

  const now = new Date();
  const daysUntilEnd = Math.ceil((weekEnd - now) / (1000 * 60 * 60 * 24));
  if (daysUntilEnd > 16) return null;

  const startStr = formatDateISO(weekStart);
  const endStr = formatDateISO(weekEnd);
  const cacheKey = `${startStr}_${endStr}`;

  if (!weatherCache[cacheKey]) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${BANCROFT_LAT}&longitude=${BANCROFT_LON}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&timezone=America/New_York&start_date=${startStr}&end_date=${endStr}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Weather fetch failed');
      weatherCache[cacheKey] = await res.json();
    } catch (err) {
      console.error('Weather error:', err);
      return null;
    }
  }

  const weather = weatherCache[cacheKey];
  if (!weather.daily || !weather.daily.time || weather.daily.time.length === 0) return null;
  return weather.daily;
}

function weatherSnippetHTML(daily, dayIndex, lang) {
  if (!daily || dayIndex >= daily.time.length) return '';
  const high = Math.round(daily.temperature_2m_max[dayIndex]);
  const low = Math.round(daily.temperature_2m_min[dayIndex]);
  const rainChance = daily.precipitation_probability_max[dayIndex];
  const code = daily.weathercode[dayIndex];
  const icon = weatherIcon(code);
  const desc = weatherDescription(code, lang);
  const tips = weatherTips(high, low, rainChance, code, lang);

  return `<div class="weather-inline" onclick="event.stopPropagation(); this.classList.toggle('expanded')">
    <span class="weather-inline-icon">${icon}</span>
    <span class="weather-inline-temp">${high}°/${low}°</span>
    <span class="weather-inline-desc">${desc}</span>
    ${rainChance > 0 ? `<span class="weather-inline-rain">💧${rainChance}%</span>` : ''}
    <div class="weather-inline-tips">
      ${tips.map(t => `<div class="weather-tip">${t}</div>`).join('')}
    </div>
  </div>`;
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '☁️';
  if (code <= 57) return '🌧️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '❄️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

function weatherDescription(code, lang) {
  const descriptions = {
    en: {
      0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle',
      55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
      61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
      66: 'Freezing rain', 67: 'Freezing rain',
      71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
      77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
      85: 'Snow showers', 86: 'Heavy snow showers',
      95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail'
    },
    es: {
      0: 'Cielo despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
      45: 'Niebla', 48: 'Niebla helada', 51: 'Llovizna ligera', 53: 'Llovizna',
      55: 'Llovizna fuerte', 56: 'Llovizna helada', 57: 'Llovizna helada',
      61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia fuerte',
      66: 'Lluvia helada', 67: 'Lluvia helada',
      71: 'Nieve ligera', 73: 'Nieve', 75: 'Nieve fuerte',
      77: 'Granizo', 80: 'Chubascos ligeros', 81: 'Chubascos', 82: 'Chubascos fuertes',
      85: 'Chubascos de nieve', 86: 'Chubascos fuertes de nieve',
      95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo'
    }
  };
  const map = descriptions[lang] || descriptions.en;
  return map[code] || map[Math.floor(code / 10) * 10] || (lang === 'es' ? 'Variable' : 'Mixed');
}

function weatherTips(high, low, rainChance, code, lang) {
  const tips = [];
  const isEn = lang === 'en';

  if (low <= 32) {
    tips.push(isEn ? '🧤 Heavy coat, hat & gloves' : '🧤 Abrigo grueso, gorro y guantes');
  } else if (low <= 45) {
    tips.push(isEn ? '🧥 Warm jacket & layers' : '🧥 Chaqueta abrigada y capas');
  } else if (high <= 55) {
    tips.push(isEn ? '🧥 Light jacket' : '🧥 Chaqueta ligera');
  }

  if (high >= 85) {
    tips.push(isEn ? '💧 Extra water bottle' : '💧 Botella de agua extra');
    tips.push(isEn ? '🧴 Sunscreen' : '🧴 Protector solar');
  }

  if (rainChance >= 50 || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    tips.push(isEn ? '☂️ Umbrella & rain boots' : '☂️ Paraguas y botas de lluvia');
  } else if (rainChance >= 30) {
    tips.push(isEn ? '☂️ Umbrella just in case' : '☂️ Paraguas por si acaso');
  }

  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) {
    tips.push(isEn ? '🥾 Snow boots & warm socks' : '🥾 Botas de nieve y calcetines abrigados');
  }

  if (code >= 95) {
    tips.push(isEn ? '⚡ Stay safe indoors if possible' : '⚡ Manténganse seguros adentro si es posible');
  }

  if (tips.length === 0) {
    tips.push(isEn ? '👍 Great weather for school!' : '👍 ¡Buen clima para la escuela!');
  }

  return tips;
}

function flagHTML(flagValue, size) {
  if (!flagValue) return '';
  const h = size === 'small' ? 14 : size === 'large' ? 22 : 16;
  if (flagValue.startsWith('img:')) {
    const src = flagValue.slice(4);
    return `<img src="${src}" alt="flag" class="flag-img flag-${size}" style="height:${h}px;">`;
  }
  return `<span class="flag-emoji" style="font-size:${h}px;line-height:1;">${flagValue}</span>`;
}

// --- Shareable Image Card ---
function shareableImageHTML(imageName, label) {
  const src = `images/weekly/${imageName}-${currentLang}.png`;
  const downloadName = `bancroft-${imageName}-${currentWeekData.date}.png`;
  const shareLabel = currentLang === 'es' ? 'Compartir' : 'Share';
  const saveLabel = currentLang === 'es' ? 'Guardar' : 'Save';
  const cardLabel = currentLang === 'es' ? 'Imagen para compartir' : 'Shareable image';

  return `<div class="shareable-image-wrap">
    <img src="${src}" alt="${label}" loading="lazy" onclick="window.open(this.src, '_blank')">
    <div class="shareable-image-actions">
      <span class="shareable-image-label">${cardLabel}</span>
      <div class="shareable-image-btns">
        <button class="shareable-image-btn" onclick="downloadShareImage('${src}', '${downloadName}')">${saveLabel} 📥</button>
        <button class="shareable-image-btn" onclick="shareImage('${src}', '${escapeAttr(label)}')">${shareLabel} 📤</button>
      </div>
    </div>
  </div>`;
}

function downloadShareImage(src, filename) {
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function shareImage(src, title) {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const file = new File([blob], 'bancroft-newsletter.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
    } else if (navigator.share) {
      await navigator.share({ title, url: window.location.href });
    } else {
      downloadShareImage(src, 'bancroft-newsletter.png');
    }
  } catch (e) { /* user cancelled */ }
}

function showError(msg) {
  document.getElementById('error-message').textContent = msg;
  document.getElementById('error-overlay').hidden = false;
  setTimeout(() => {
    document.getElementById('error-overlay').hidden = true;
  }, 5000);
}

// --- Start ---
setupPasswordGate();
