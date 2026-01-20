// person.education.js
// إدارة "التعليم" لكل شخص (منطق + واجهة القسم داخل نافذة السيرة)

import {
  el,
  textEl,
  showConfirmModal,
  showWarning,
  showSuccess,
  showInfo,
  showError,
  arraysShallowEqual,
  formatShortDateBadge,
  formatFullDateTime,
  attachHorizontalSortable,
  createImageViewerOverlay
} from '../utils.js';
import { DB } from '../storage/db.js';

import {
  nowIso,
  safeStr,
  shallowArr,
  splitCommaTags,
  isTmpRef,
  isIdbRef,
  autoResizeTextareas,

  createSectionTempAndResolver,
  upgradeTmpRefs,
  makeTempMetaFromFile,

  formatCreatedAtLabel,
  openResolvedSlider,
  applyCardEditMode,

  isAllowedFile,
  getRefExt,
  inferFileKind,
  openInNewTabSafe,
  groupRefsByKind,
  buildDownloadName,

  findImageIndex,
  makeGroupTitle,
  makeDivider,
  isEmptyRecordByKeys,
  createFiltersCollapseController,
  withFieldHead
} from '../features/bio-sections.utils.js';

import {attachYearModeToggle, getLogicalDateValue, setYearToggleValue} from '../ui/modal.yearToggle.js';

import { getLinkedEventEdges, upsertSectionEvents, normalizeEventLink } from './person.events.js';

/* ============================================================================
   1) إعدادات التحقق من الملفات المرفقة
   ============================================================================ */

const MAX_FILE_SIZE_MB = 20;
const MAX_FILES_PER_PICK = 10;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/heic',
  'image/heif'
]);

const DEGREE_TYPES = [
  'ابتدائي',
  'متوسط',
  'ثانوي',
  'دبلوم',
  'بكالوريوس',
  'ماجستير',
  'دكتوراه',
  'دورة',
  'شهادة مهنية'
];

const STUDY_MODES = ['حضوري', 'عن بُعد', 'هجين'];

/* ============================================================================
   2) Helpers
   ============================================================================ */

function ymdToUTCDate(ymd) {
  if (!ymd) return null;
  const s = String(ymd).trim();
  if (!s) return null;

  // سنة فقط: YYYY  -> نعتبرها 01-01 لنقدر نقارن/نفرز/نحسب مدة
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (!y) return null;
    return new Date(Date.UTC(y, 0, 1));
  }

  // تاريخ كامل: YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}


function monthsDiff(aYmd, bYmd) {
  const a = ymdToUTCDate(aYmd);
  const b = ymdToUTCDate(bYmd);
  if (!a || !b) return null;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function formatDurationLabel(startDate, endDate, ongoing) {
  const end = ongoing ? nowIso().slice(0, 10) : endDate;
  const m = monthsDiff(startDate, end);
  if (m == null) return '';
  const years = Math.floor(m / 12);
  const months = m % 12;
  if (!years && !months) return 'أقل من شهر';
  const parts = [];
  if (years) parts.push(`${years}س`);
  if (months) parts.push(`${months}ش`);
  return parts.join(' ');
}

function normalizeHighlights(raw) {
  if (Array.isArray(raw)) return raw.map(s => safeStr(s)).filter(Boolean);
  const t = safeStr(raw);
  if (!t) return [];
  return t.split('\n').map(s => s.trim()).filter(Boolean);
}

function degreeGroupLabel(degreeType) {
  const d = safeStr(degreeType);
  if (!d) return '';
  if (d === 'دورة') return 'دورة';
  if (d === 'شهادة مهنية') return 'شهادة مهنية';
  if (d === 'ابتدائي' || d === 'متوسط' || d === 'ثانوي') return 'مدرسة';
  return 'جامعة';
}

function formatEduDateBadge(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return s; // سنة فقط
  return formatShortDateBadge(s);  // تاريخ كامل
}


/* ============================================================================
   3) منطق البيانات (Normalize + CRUD + Sort)
   ============================================================================ */

function normalizeEducation(raw) {
  const now = nowIso();
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    id: String(raw.id || 'e_' + Math.random().toString(36).slice(2)),

    title: safeStr(raw.title),
    institution: safeStr(raw.institution),
    field: safeStr(raw.field),

    degreeType: safeStr(raw.degreeType),
    credentialId: safeStr(raw.credentialId),
    issuer: safeStr(raw.issuer),
    accreditation: safeStr(raw.accreditation),
    verificationUrl: safeStr(raw.verificationUrl),
    language: safeStr(raw.language),
    mode: safeStr(raw.mode),
    highlights: normalizeHighlights(raw.highlights),

 startDate: raw.startDate || null, // YYYY أو YYYY-MM-DD أو null
endDate: raw.endDate || null,     // YYYY أو YYYY-MM-DD أو null

    ongoing: !!raw.ongoing,           // حتى الآن

    place: safeStr(raw.place),
    grade: safeStr(raw.grade),
    description: safeStr(raw.description),

    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String).filter(Boolean) : [],

    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
    pinned: !!raw.pinned,
    note: safeStr(raw.note),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

export function ensureEducation(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.education)) person.education = [];
  person.education = person.education.map(normalizeEducation);
}

export function addEducation(person, data = {}, { onChange } = {}) {
  ensureEducation(person);
  const rec = normalizeEducation(data);
  rec.createdAt = nowIso();
  rec.updatedAt = rec.createdAt;
  person.education.unshift(rec);
  if (typeof onChange === 'function') onChange(person.education, rec);
  return rec;
}

export function updateEducation(person, eduId, data = {}, { onChange } = {}) {
  ensureEducation(person);
  const idx = person.education.findIndex(x => x.id === eduId);
  if (idx === -1) return null;

  const old = person.education[idx];
  const merged = normalizeEducation({ ...old, ...data, id: old.id });
  merged.createdAt = old.createdAt || merged.createdAt;
  merged.updatedAt = nowIso();

  person.education[idx] = merged;
  if (typeof onChange === 'function') onChange(person.education, merged);
  return merged;
}

export function deleteEducation(person, eduId, { onChange } = {}) {
  ensureEducation(person);
  const idx = person.education.findIndex(x => x.id === eduId);
  if (idx === -1) return false;

  const removed = person.education.splice(idx, 1)[0];
  if (typeof onChange === 'function') onChange(person.education, removed);
  return true;
}

export function sortEducation(person, mode = 'latest') {
  ensureEducation(person);

  const pickStudyDate = (x) => {
    const end = x.ongoing ? nowIso().slice(0, 10) : (x.endDate || null);
    return end || x.startDate || null;
  };

  person.education.sort((a, b) => {
    if (mode === 'study_latest' || mode === 'study_oldest') {
      const da = pickStudyDate(a);
      const db = pickStudyDate(b);
      const ta = da ? ymdToUTCDate(da)?.getTime() : 0;
      const tb = db ? ymdToUTCDate(db)?.getTime() : 0;
      return mode === 'study_oldest' ? (ta - tb) : (tb - ta);
    }

    const da = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const db = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return mode === 'oldest' ? da - db : db - da;
  });
}

/* ============================================================================
   4) عارض الشرائح + كاش الميتا + tmp/resolver
   ============================================================================ */

const educationViewer = createImageViewerOverlay();
const eduFileMetaCache = new Map(); // ref -> { kind, ext, mime, name? }

const eduSectionTmp = createSectionTempAndResolver({
  prefix: 'tmp:',
  getIdbUrl: (ref) => (typeof DB?.getEducationFileURL === 'function' ? DB.getEducationFileURL(ref) : null),
  metaCache: eduFileMetaCache
});

const eduTempCache = eduSectionTmp.tempCache;
const resolveEduFileUrl = eduSectionTmp.resolve;

function addTempFile(file) {
  const meta = makeTempMetaFromFile(file);
  return eduSectionTmp.addTemp(file, meta);
}
function revokeTempRef(tmpRef) { eduSectionTmp.revokeTemp(tmpRef); }

async function openEduSlider(refs, startIndex = 0) {
  return openResolvedSlider({ viewer: educationViewer, refs, startIndex, resolveUrl: resolveEduFileUrl });
}

/* ============================================================================
   5) Meta helpers
   ============================================================================ */

function collectAllEduRefs(person) {
  const out = [];
  const items = Array.isArray(person?.education) ? person.education : [];
  for (const it of items) out.push(...(Array.isArray(it?.files) ? it.files : []));
  return out;
}

async function warmEduMetaCache(refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  const need = list.map(r => String(r)).filter(r => isIdbRef(r) && !eduFileMetaCache.has(r));
  if (!need.length) return false;

  const getMeta = (typeof DB?.getEducationFileMeta === 'function') ? DB.getEducationFileMeta.bind(DB) : null;
  if (!getMeta) return false;

  const results = await Promise.allSettled(need.map(r => getMeta(r).then(meta => ({ r, meta }))));
  let changed = false;
  for (const x of results) {
    if (x.status === 'fulfilled' && x.value?.meta) {
      eduFileMetaCache.set(x.value.r, x.value.meta);
      changed = true;
    }
  }
  return changed;
}

async function ensureMetaForRef(ref) {
  const raw = String(ref || '');

  if (isTmpRef(raw)) return eduFileMetaCache.get(raw) || eduTempCache.get(raw)?.meta || null;
  if (!isIdbRef(raw)) return null;

  const cached = eduFileMetaCache.get(raw);
  if (cached) return cached;

  const getMeta = (typeof DB?.getEducationFileMeta === 'function') ? DB.getEducationFileMeta.bind(DB) : null;
  if (!getMeta) return null;

  try {
    const meta = await getMeta(raw);
    if (meta) {
      eduFileMetaCache.set(raw, meta);
      return meta;
    }
  } catch (e) {
    console.error('getEducation meta failed', raw, e);
  }
  return null;
}

function getEduFileKind(ref) {
  const raw = String(ref || '');

  if (isTmpRef(raw)) {
    const meta = eduFileMetaCache.get(raw) || eduTempCache.get(raw)?.meta || {};
    return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
  }

  if (isIdbRef(raw)) {
    const meta = eduFileMetaCache.get(raw) || {};
    return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
  }

  return inferFileKind({ ref: raw, ext: getRefExt(raw) }) || 'other';
}

/* ============================================================================
   6) Thumb classifier + open/download helper
   ============================================================================ */

function classifyEduThumb(thumb, ref) {
  const raw = String(ref || '');

  const meta =
    isTmpRef(raw) ? (eduFileMetaCache.get(raw) || eduTempCache.get(raw)?.meta || {})
      : isIdbRef(raw) ? (eduFileMetaCache.get(raw) || {})
        : null;

  const ext = meta ? String(meta.ext || '').toLowerCase() : getRefExt(raw);
  const kind = meta ? (meta.kind || inferFileKind({ ext, mime: meta.mime || '', ref: raw }))
    : inferFileKind({ ext, ref: raw });

  const key = `${kind || 'other'}|${ext || ''}`;
  if (thumb.dataset.eduThumbKey === key) return; // منع إعادة بناء DOM لنفس التصنيف
  thumb.dataset.eduThumbKey = key;

  thumb.classList.remove(
    'education-file-thumb--image', 'education-file-thumb--pdf', 'education-file-thumb--word', 'education-file-thumb--excel', 'education-file-thumb--other',
    'biosec-file-thumb--image', 'biosec-file-thumb--pdf', 'biosec-file-thumb--word', 'biosec-file-thumb--excel', 'biosec-file-thumb--other'
  );
  thumb.querySelectorAll('.education-file-ext, .biosec-file-ext').forEach(x => x.remove());

  const cls =
    kind === 'image' ? 'education-file-thumb--image' :
      kind === 'pdf' ? 'education-file-thumb--pdf' :
        kind === 'word' ? 'education-file-thumb--word' :
          kind === 'excel' ? 'education-file-thumb--excel' :
            'education-file-thumb--other';

  thumb.classList.add(cls);

  const sharedCls =
    cls === 'education-file-thumb--image' ? 'biosec-file-thumb--image' :
      cls === 'education-file-thumb--pdf' ? 'biosec-file-thumb--pdf' :
        cls === 'education-file-thumb--word' ? 'biosec-file-thumb--word' :
          cls === 'education-file-thumb--excel' ? 'biosec-file-thumb--excel' :
            'biosec-file-thumb--other';

  thumb.classList.add(sharedCls);

  if (ext) {
    const badge = el('span', 'biosec-file-ext education-file-ext');
    badge.textContent = ext.toUpperCase();
    thumb.appendChild(badge);
  }
}

async function openOrDownloadRef(ref, { preferDownload = false, baseTitle = '', index = 0, total = 1 } = {}) {
  const preOpened = (!preferDownload) ? window.open('about:blank', '_blank') : null;
  if (preOpened) preOpened.opener = null;

  const url = await resolveEduFileUrl(ref);
  if (!url) { try { preOpened?.close(); } catch { } return; }

  const meta = await ensureMetaForRef(ref);
  const mime = meta?.mime || (eduFileMetaCache.get(String(ref))?.mime || '');
  const name = buildDownloadName(baseTitle, ref, mime, index, total, meta || {});

  if (preferDownload) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  try { preOpened.location.href = url; } catch { }
}

/* ============================================================================
   7) Empty / Draft logic (Education)
   ============================================================================ */

const EDUCATION_EMPTY_KEYS = [
  'title', 'institution', 'field',
  'degreeType', 'credentialId', 'issuer', 'accreditation', 'verificationUrl', 'language', 'mode',
  'highlights',
  'startDate', 'endDate', 'ongoing',
  'place', 'grade', 'description',
  'files', 'tags', 'note'
];

const EDUCATION_DRAFT_EMPTY_KEYS = [
  'title', 'institution', 'field',
  'degreeType', 'credentialId', 'issuer', 'accreditation', 'verificationUrl', 'language', 'mode',
  'highlights',
  'place', 'grade', 'description',
  'files', 'tags', 'note'
];

function isEmptyEducationDraft(rec) { return isEmptyRecordByKeys(rec, EDUCATION_DRAFT_EMPTY_KEYS); }

/* ============================================================================
   8) createEducationSection — Cards + أدوات
   ============================================================================ */

export function createEducationSection(person, handlers = {}) {
  ensureEducation(person);
  const personId = person && person._id ? String(person._id) : null;

  let currentTagFilter = '';
  let lastEditedId = null;
  let currentSearchQuery = '';

  let currentDegreeGroupFilter = '';
  let currentFilesFilter = '';       
const EDUCATION_FILTERS_STATE_KEY = 'biosec:education:filtersState';

function readEducationFiltersState() {
  try {
    const raw = localStorage.getItem(EDUCATION_FILTERS_STATE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch {
    return null;
  }
}

function writeEducationFiltersState(state) {
  try {
    localStorage.setItem(EDUCATION_FILTERS_STATE_KEY, JSON.stringify(state || {}));
  } catch { /* ignore */ }
}

function persistEducationFiltersState() {
  writeEducationFiltersState({
    degreeGroup: (currentDegreeGroupFilter || '').trim(),
    files: (currentFilesFilter || '').trim(),
    tag: (currentTagFilter || '').trim(),
    search: (currentSearchQuery || '').trim(),

    // حفظ الترتيب
    sort: (currentSortMode || '').trim()
  });
}


function clearEducationFiltersState() {
  try { localStorage.removeItem(EDUCATION_FILTERS_STATE_KEY); } catch { /* ignore */ }
}

  const draftNewMap = new Map(); // eduId -> true (UI-only)

  // منع Race conditions
  let renderSeq = 0;

  function emitEducationToHost() {
    if (!personId || typeof handlers.onUpdateEducation !== 'function') return;
    const items = Array.isArray(person.education) ? person.education.map(x => ({
      id: x.id,
      title: safeStr(x.title),
      institution: safeStr(x.institution),
      field: safeStr(x.field),

      degreeType: safeStr(x.degreeType),
      credentialId: safeStr(x.credentialId),
      issuer: safeStr(x.issuer),
      accreditation: safeStr(x.accreditation),
      verificationUrl: safeStr(x.verificationUrl),
      language: safeStr(x.language),
      mode: safeStr(x.mode),
      highlights: shallowArr(x.highlights),

      startDate: x.startDate || null,
      endDate: x.endDate || null,
      ongoing: !!x.ongoing,

      place: safeStr(x.place),
      grade: safeStr(x.grade),
      description: safeStr(x.description),

      files: shallowArr(x.files),
sourceIds: shallowArr(x.sourceIds),

      tags: shallowArr(x.tags),
      pinned: !!x.pinned,
      note: safeStr(x.note),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt
    })) : [];
    handlers.onUpdateEducation(personId, items);
  }

const sortMode = (handlers.getSortMode && handlers.getSortMode()) || 'latest';

// نخزن قيمة الترتيب الحالية (قابلة للاسترجاع من localStorage)
let currentSortMode = sortMode;

sortEducation(person, currentSortMode);

  const root = el('section', 'bio-section bio-section-education');

  const titleEl = el('h3', 'biosec-section-title education-section-title');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-graduation-cap';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'التعليم');
  const countBadge = el('span', 'biosec-count-badge education-count-badge');
  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'biosec-meta education-meta');
metaEl.textContent =
  'يساعدك هذا القسم على توثيق المراحل التعليمية والشهادات والدورات بشكل منظم لدعم السيرة بدقة وموثوقية.\n' +
  'أضف بيانات المرحلة وارفق وثائقك (شهادات/ملفات) واربطها بمصادر التوثيق لتبقى معلوماتك مكتملة وقابلة للرجوع.\n' +
  'يمكنك أيضًا تضمين المرحلة في الخط الزمني عند الحاجة لعرض مسارك التعليمي بوضوح.';

  root.appendChild(metaEl);

  function updateCountBadge() {
    const n = (person.education || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد بيانات تعليم بعد)';
  }

  /* ---------- أدوات القسم ---------- */

  const header = el('div', 'biosec-header education-header');

  const tools = el('div', 'biosec-tools education-tools');
  const toolsLeft = el('div', 'biosec-tools-left education-tools-left');
  const toolsRight = el('div', 'biosec-tools-right education-tools-right');
  // زر إظهار/إخفاء الفلاتر
  const filtersToggleBtn = el('button', 'biosec-filters-toggle biosec-btn education-filters-toggle');
  filtersToggleBtn.type = 'button';
// زر تصفير الفلاتر (يظهر فقط عند وجود فلاتر مفعّلة)
const resetFiltersBtn = el('button', 'biosec-btn biosec-filters-reset education-filters-reset');
resetFiltersBtn.type = 'button';
resetFiltersBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>إعادة ضبط الفلاتر</span>';
resetFiltersBtn.title = 'إعادة ضبط جميع الفلاتر إلى الإعدادات الافتراضية';
resetFiltersBtn.setAttribute('aria-label', 'إعادة ضبط الفلاتر');

resetFiltersBtn.style.display = 'none';

function wrapToolControl(node, { title, icon } = {}) {
  const wrap = el('div', 'biosec-tool-field education-tool-field');

  const head = el('div', 'biosec-meta-label education-tool-label');
  head.innerHTML =
    `<span class="biosec-meta-icon education-tool-icon"><i class="fa-solid ${icon || 'fa-circle-info'}" aria-hidden="true"></i></span> ${title || ''}`;

  wrap.append(head, node);
  return wrap;
}

  const sortSelect = el('select', 'biosec-sort education-sort');
  sortSelect.id = 'education_sort';

  sortSelect.name = 'education_sort';
  {
    const o1 = el('option'); o1.value = 'latest'; o1.textContent = 'الأحدث إضافةً';
    const o2 = el('option'); o2.value = 'oldest'; o2.textContent = 'الأقدم إضافةً';
    const o3 = el('option'); o3.value = 'study_latest'; o3.textContent = 'الأحدث في الدراسة';
    const o4 = el('option'); o4.value = 'study_oldest'; o4.textContent = 'الأقدم في الدراسة';
    sortSelect.append(o1, o2, o3, o4);
  }
  sortSelect.value = sortMode;

  const degreeGroupSelect = el('select', 'biosec-sort education-degreegroup-filter');
  degreeGroupSelect.id = 'education_degreegroup';

  degreeGroupSelect.name = 'education_degreegroup';
  {
    const o0 = el('option'); o0.value = ''; o0.textContent = 'كل الأنواع';
    const o1 = el('option'); o1.value = 'جامعة'; o1.textContent = 'جامعة';
    const o2 = el('option'); o2.value = 'مدرسة'; o2.textContent = 'مدرسة';
    const o3 = el('option'); o3.value = 'دورة'; o3.textContent = 'دورة';
    const o4 = el('option'); o4.value = 'شهادة مهنية'; o4.textContent = 'شهادة مهنية';
    degreeGroupSelect.append(o0, o1, o2, o3, o4);
  }

  const filesFilterSelect = el('select', 'biosec-sort education-files-filter');
  filesFilterSelect.id = 'education_filesfilter';

  filesFilterSelect.name = 'education_filesfilter';
  {
    const o0 = el('option'); o0.value = ''; o0.textContent = 'الكل (مرفقات/بدون)';
    const o1 = el('option'); o1.value = 'with'; o1.textContent = 'مرفق موجود';
    const o2 = el('option'); o2.value = 'without'; o2.textContent = 'بدون مرفق';
    filesFilterSelect.append(o0, o1, o2);
  }

  const searchWrap = el('div', 'biosec-search-wrap education-search-wrap');
  const searchInput = el('input', 'biosec-search-input education-search-input');
  searchInput.id = 'education_search';
  searchInput.type = 'search';
  searchInput.name = 'education_search';
  searchInput.placeholder = 'ابحث في التعليم (عنوان/جهة/تخصص/وسم)…';
  searchInput.value = '';
searchInput.addEventListener('input', () => {
  const raw = searchInput.value || '';
  currentSearchQuery = raw.trim().toLowerCase();

  // أظهر/أخف زر المسح حسب وجود نص
  clearSearchBtn.style.display = raw.trim() ? '' : 'none';
persistEducationFiltersState(); 
  renderList();
});

// زر مسح البحث (يظهر فقط عند وجود نص)
const clearSearchBtn = el('button', 'biosec-search-clear education-search-clear');
clearSearchBtn.type = 'button';
clearSearchBtn.title = 'مسح البحث';
clearSearchBtn.setAttribute('aria-label', 'مسح البحث');
clearSearchBtn.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
clearSearchBtn.style.display = 'none';

clearSearchBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  searchInput.value = '';
  currentSearchQuery = '';
  clearSearchBtn.style.display = 'none';
persistEducationFiltersState();
  renderList();
  searchInput.focus();
});

searchWrap.append(searchInput, clearSearchBtn);
// Restore filters state on load (degreeGroup/files/tag/search/sort)
{
  const st = readEducationFiltersState();
  if (st) {
    // degree group
    if (typeof st.degreeGroup === 'string') {
      degreeGroupSelect.value = st.degreeGroup;
      currentDegreeGroupFilter = degreeGroupSelect.value || '';
    }

    // files filter
    if (typeof st.files === 'string') {
      filesFilterSelect.value = st.files;
      currentFilesFilter = filesFilterSelect.value || '';
    }

    // tag filter
    if (typeof st.tag === 'string') {
      currentTagFilter = st.tag;
    }

    // search
    if (typeof st.search === 'string') {
      searchInput.value = st.search;
      currentSearchQuery = (st.search || '').trim().toLowerCase();
      clearSearchBtn.style.display = (st.search || '').trim() ? '' : 'none';
    }

    // sort
    if (typeof st.sort === 'string') {
      const v = st.sort || 'latest';
      // تأكد أنه ضمن الخيارات المتاحة
      const ok = ['latest', 'oldest', 'study_latest', 'study_oldest'].includes(v);
      currentSortMode = ok ? v : 'latest';
      sortSelect.value = currentSortMode;

      // طبّق الفرز فورًا قبل أول render
      sortEducation(person, currentSortMode);
    }
  }
}

degreeGroupSelect.addEventListener('change', () => {
  currentDegreeGroupFilter = degreeGroupSelect.value || '';
  syncResetFiltersBtnVisibility();
  persistEducationFiltersState();
  if (filtersCollapse?.getCollapsed?.()) filtersCollapse.setCollapsed(false);
  renderList();
});

filesFilterSelect.addEventListener('change', () => {
  currentFilesFilter = filesFilterSelect.value || '';
  syncResetFiltersBtnVisibility();
  persistEducationFiltersState();
  if (filtersCollapse?.getCollapsed?.()) filtersCollapse.setCollapsed(false);
  renderList();
});

// دالة موحّدة لمعرفة هل الفلاتر مفعّلة (نستخدمها للمنع + لإظهار زر التصفير)
function hasActiveFilters() {
  const hasDegreeGroup = !!(degreeGroupSelect.value || '').trim();
  const hasFiles = !!(filesFilterSelect.value || '').trim();
  const hasTag = !!(currentTagFilter || '').trim();
  return hasDegreeGroup || hasFiles || hasTag;
}

const filtersCollapse = createFiltersCollapseController({
  storageKey: 'biosec:education:filtersCollapsed',
  panelEl: toolsLeft,
  toggleBtnEl: filtersToggleBtn,

  hasActiveFilters,

  labels: { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
  iconHtml: '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
  onBlockedHide: () => {
    showInfo?.('لا يمكن إخفاء الفلاتر أثناء وجود فلاتر مفعّلة. قم بتصفير البحث/الفلاتر أولاً.');
  }
});

  // طبق الحالة الابتدائية (مع منع الوميض)
  filtersCollapse.applyInitialState({ autoOpenIfActive: true });
  syncResetFiltersBtnVisibility();
function syncResetFiltersBtnVisibility() {
  resetFiltersBtn.style.display = hasActiveFilters() ? '' : 'none';
}

function resetFiltersToDefault() {
  // فلاتر toolsLeft
  degreeGroupSelect.value = '';
  filesFilterSelect.value = '';
  currentDegreeGroupFilter = '';
  currentFilesFilter = '';

  // فلتر الوسوم (هو جزء من hasActiveFilters)
  currentTagFilter = '';

  // (اختياري لكنه مفيد للمستخدم): تصفير البحث أيضًا
  searchInput.value = '';
  currentSearchQuery = '';
  clearSearchBtn.style.display = 'none';
  sortSelect.value = 'latest';
currentSortMode = 'latest';
sortEducation(person, 'latest');

clearEducationFiltersState();
  syncResetFiltersBtnVisibility();
  renderList();
}

resetFiltersBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetFiltersToDefault();
});

// طبق الحالة الأولية لظهور الزر
syncResetFiltersBtnVisibility();

  // فعل زر الإظهار/الإخفاء
filtersToggleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  filtersCollapse.toggle();
});

  const addBtn = el('button', 'biosec-add-btn education-add-btn');
  addBtn.type = 'button';

toolsLeft.append(
  wrapToolControl(degreeGroupSelect, { title: 'تصنيف التعليم', icon: 'fa-layer-group' }),
  wrapToolControl(filesFilterSelect, { title: 'المرفقات', icon: 'fa-paperclip' }),
  wrapToolControl(sortSelect, { title: 'الترتيب', icon: 'fa-arrow-down-wide-short' }),
  resetFiltersBtn
);


toolsRight.append(searchWrap, addBtn, filtersToggleBtn);

  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

  const list = el('div', 'biosec-list education-list');
  root.appendChild(list);

  function updateAddButtonLabel() {
    ensureEducation(person);
    const count = person.education.length || 0;

    if (count === 0) {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> <span>إضافة أول مرحلة تعليم</span>';
      addBtn.title = 'ابدأ بإضافة أول شهادة/مرحلة تعليمية';
    } else {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> <span>إضافة مرحلة تعليمية</span>';
      addBtn.title = `هناك ${count} عناصر تعليم محفوظة`;
    }
  }
  
  function renderList() {
    const seq = ++renderSeq;

    (async () => {
      await warmEduMetaCache(collectAllEduRefs(person));
      if (seq !== renderSeq) return;

      list.innerHTML = '';
      ensureEducation(person);

      updateCountBadge();
      updateAddButtonLabel();

      const filtered = person.education.filter(item => {
        const q = currentSearchQuery;

        const text = [
          item.title, item.institution, item.field, item.place, item.grade,
          item.degreeType, item.issuer, item.accreditation,
          ...(Array.isArray(item.tags) ? item.tags : []),
          ...(Array.isArray(item.highlights) ? item.highlights : [])
        ].join(' ').toLowerCase();

        const searchOk = !q || text.includes(q);
        const tagOk = !currentTagFilter || (Array.isArray(item.tags) && item.tags.includes(currentTagFilter));

        const dg = degreeGroupLabel(item.degreeType);
        const degreeGroupOk = !currentDegreeGroupFilter || dg === currentDegreeGroupFilter;

        const filesCount = Array.isArray(item.files) ? item.files.length : 0;
        const filesOk =
          !currentFilesFilter ||
          (currentFilesFilter === 'with' ? filesCount > 0 : filesCount === 0);

        return searchOk && tagOk && degreeGroupOk && filesOk;
      });

      if (!filtered.length) {
        const empty = el('div', 'biosec-empty education-empty');
        empty.textContent = person.education.length ? 'لا توجد نتائج مطابقة لخيارات البحث/الفلترة الحالية.'
          : 'ابدأ بإضافة أول مرحلة تعليمية (مثلاً: مدرسة/جامعة/دورات/شهادات).';
        list.appendChild(empty);
        return;
      }

      filtered.forEach((item, index) => {
        const serial = index + 1;
        const card = el('article', 'biosec-card education-card');
        card.dataset.eduId = item.id;

        const original = {
          title: item.title || '',
          institution: safeStr(item.institution),
          field: safeStr(item.field),

          degreeType: safeStr(item.degreeType),
          credentialId: safeStr(item.credentialId),
          issuer: safeStr(item.issuer),
          accreditation: safeStr(item.accreditation),
          verificationUrl: safeStr(item.verificationUrl),
          language: safeStr(item.language),
          mode: safeStr(item.mode),
          highlights: shallowArr(item.highlights),

          startDate: item.startDate || null,
          endDate: item.endDate || null,
          ongoing: !!item.ongoing,

          place: safeStr(item.place),
          grade: safeStr(item.grade),
          description: safeStr(item.description),

          files: shallowArr(item.files),
sourceIds: shallowArr(item.sourceIds),
          tags: shallowArr(item.tags),
          pinned: !!item.pinned,
          note: safeStr(item.note)
        };
        const fallbackMatcher = (ev, sid, iid) => {
  // لا يوجد legacy للتعليم حالياً، لكن نتركه للمستقبل أو لو عندك شكل قديم
  return false;
};

const timelineState = getLinkedEventEdges(person.events || [], 'education', item.id, fallbackMatcher);
let timelineEnabled = !!timelineState.enabled;

const fp = `edu_${item.id}`;
// timeline toggle (linked events) — shared classes
const timelineWrap = el('label', 'biosec-pin-toggle biosec-toggle--timeline');

const timelineCheckbox = el('input');
timelineCheckbox.type = 'checkbox';
timelineCheckbox.checked = timelineEnabled;
timelineCheckbox.id = `${fp}_toTimeline`;
timelineCheckbox.name = `${fp}_toTimeline`;

timelineWrap.append(timelineCheckbox, textEl('span', 'إضافة إلى الخط الزمني'));
let timelineInitialEnabled = timelineEnabled;

        let currentFiles = shallowArr(original.files);
        const isDraft = draftNewMap.has(item.id);
        let isEditing = (lastEditedId === item.id) || (isDraft && isEmptyEducationDraft(item));
        let isDirty = false;
        let pendingDeletedRefs = [];

const sources = Array.isArray(person.sources) ? person.sources : [];
const sourceMap = new Map(sources.map(s => [String(s.id), s]));

let currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

        /* ---------- أعلى الكارد ---------- */
        const topRow = el('div', 'biosec-card-top education-card-top');
        const indexBadge = el('div', 'biosec-card-index education-card-index');
        indexBadge.textContent = `تعليم ${serial}`;
        topRow.appendChild(indexBadge);

        if (original.pinned) {
          const pinnedBadge = el('div', 'biosec-pinned-badge education-pinned-badge');
          pinnedBadge.textContent = 'مميّز';
          topRow.appendChild(pinnedBadge);
          card.classList.add('biosec-card--pinned');
        }
        card.appendChild(topRow);

        /* =======================
           A) Preview
           ======================= */
        const previewBox = el('div', 'biosec-preview education-preview');

        // 1) العنوان
        const previewTitle = el('div', 'biosec-preview-title education-preview-title');
        previewTitle.textContent = original.title || original.institution || 'عنصر تعليم بدون عنوان';

        // (اختياري) تاريخ الإضافة — يبقى كما هو لكن سنضعه داخل meta
        const previewMeta = el('div', 'biosec-preview-meta education-preview-meta');
        const dateLabel = el('span', 'biosec-preview-date education-preview-date');
        dateLabel.textContent = item.createdAt ? formatCreatedAtLabel(item.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime })
          : '';
//آخر تعديل
const updatedLabel = el('span', 'biosec-preview-date education-preview-updated');
updatedLabel.textContent = item.updatedAt ? formatCreatedAtLabel(item.updatedAt, { prefix: 'آخر تعديل', formatter: formatFullDateTime })
  : '';

        // 3) الفترة + المدة
        const period = el('span', 'education-preview-period');
        const startBadge = formatEduDateBadge(original.startDate);
        const endBadge = original.ongoing ? 'حتى الآن' : formatEduDateBadge(original.endDate);

        period.textContent = (startBadge || endBadge) ? `${startBadge || '—'} → ${endBadge || '—'}`
          : 'بدون فترة محددة';

        const dur = el('span', 'education-preview-duration');
        const durTxt = formatDurationLabel(original.startDate, original.endDate, original.ongoing);
        dur.textContent = durTxt ? `· المدة: ${durTxt}` : '';

previewMeta.append(dateLabel, period, dur, updatedLabel);

        // 2) الجهة + نوع الدرجة + التخصص (badges الأساسية)
        const badgesPrimary = el('div', 'biosec-preview-badges education-preview-badges education-preview-badges--primary');

        const dg = degreeGroupLabel(original.degreeType);
        if (dg) {
          const b = el('span', 'biosec-badge education-badge education-badge--degreegroup');
          b.textContent = dg;
          badgesPrimary.appendChild(b);
        }
        if (original.institution) {
          const b = el('span', 'biosec-badge education-badge education-badge--institution');
          b.textContent = original.institution;
          badgesPrimary.appendChild(b);
        }
        if (original.degreeType) {
          const b = el('span', 'biosec-badge education-badge education-badge--degreetype');
          b.textContent = original.degreeType;
          badgesPrimary.appendChild(b);
        }
        if (original.field) {
          const b = el('span', 'biosec-badge education-badge education-badge--field');
          b.textContent = original.field;
          badgesPrimary.appendChild(b);
        }

        // 4) المكان + نمط الدراسة + المعدل (badges ثانوية)
        const badgesSecondary = el('div', 'biosec-preview-badges education-preview-badges education-preview-badges--secondary');

        if (original.place) {
          const b = el('span', 'biosec-badge education-badge education-badge--place');
          b.textContent = original.place;
          badgesSecondary.appendChild(b);
        }
        if (original.mode) {
          const b = el('span', 'biosec-badge education-badge education-badge--mode');
          b.textContent = original.mode;
          badgesSecondary.appendChild(b);
        }
        if (original.grade) {
          const b = el('span', 'biosec-badge education-badge education-badge--grade');
          b.textContent = original.grade;
          badgesSecondary.appendChild(b);
        }

        // 5) معلومات الاعتماد والتحقق (صندوق واحد)
        const credVerifyPreview = (() => {
          const parts = [];

          if (original.credentialId) parts.push({ label: 'رقم الشهادة', value: original.credentialId });
          if (original.issuer) parts.push({ label: 'الجهة المُصدِّرة', value: original.issuer });
          if (original.accreditation) parts.push({ label: 'جهة الاعتماد', value: original.accreditation });

          const hasUrl = !!original.verificationUrl;

          if (!parts.length && !hasUrl) return null;

          const div = el('div', 'biosec-note-preview education-credverify-preview');

          // عناصر نصية مختصرة في سطر واحد/سطرين حسب CSS
          if (parts.length) {
            const row = el('div', 'education-credverify-row');
            parts.forEach((p, idx) => {
              const item = el('span', 'education-credverify-item');
              const strong = el('strong');
              strong.textContent = `${p.label}: `;
              const span = el('span');
              span.textContent = p.value;
              item.append(strong, span);
              row.appendChild(item);

              // فاصل بسيط
              if (idx < parts.length - 1) {
                const sep = el('span', 'education-credverify-sep');
                sep.textContent = ' · ';
                row.appendChild(sep);
              }
            });
            div.appendChild(row);
          }

          if (hasUrl) {
            const row2 = el('div', 'education-credverify-row education-credverify-row--url');
            const strong = el('strong');
            strong.textContent = 'رابط التحقق: ';
            const a = document.createElement('a');
            a.href = original.verificationUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = original.verificationUrl;
            row2.append(strong, a);
            div.appendChild(row2);
          }

          return div;
        })();

        // 6) الوصف
        const previewText = el('p', 'biosec-preview-text education-preview-text');
        previewText.textContent = original.description || 'لا توجد تفاصيل مضافة بعد.';

        // 7) الإنجازات
        const highlightsPreview = (() => {
          const hs = Array.isArray(original.highlights) ? original.highlights : [];
          if (!hs.length) return null;
          const wrap = el('ul', 'biosec-highlights education-highlights');
          hs.slice(0, 5).forEach(h => {
            const li = el('li', 'education-highlight-item');
            li.textContent = h;
            wrap.appendChild(li);
          });
          if (hs.length > 5) {
            const li = el('li', 'education-highlight-item education-highlight-more');
            li.textContent = `+ ${hs.length - 5} المزيد`;
            wrap.appendChild(li);
          }
          return wrap;
        })();

        // 8) الوسوم
        const tagsWrap = el('div', 'biosec-tags-list education-tags-list');
        if (original.tags && original.tags.length) {
          original.tags.forEach(tag => {
            const chip = el(
              'button',
              'biosec-tag-chip education-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
            );
            chip.type = 'button';
            chip.textContent = tag;
 chip.addEventListener('click', () => {
  currentTagFilter = currentTagFilter === tag ? '' : tag;
  syncResetFiltersBtnVisibility();
  persistEducationFiltersState();
   if (filtersCollapse?.getCollapsed?.()) filtersCollapse.setCollapsed(false);
  renderList();
});

            tagsWrap.appendChild(chip);
          });
        }
function renderPreviewSourceChips() {
  const ids = shallowArr(original.sourceIds);
  if (!ids.length) return null;

  // wrapper الرئيسي
  const wrap = el('div', 'biosec-linked-sources education-linked-sources');

  // header قبل الأزرار (عنوان + أيقونة)
  const head = el('div', 'biosec-linked-sources-head education-linked-sources-head');

  const icon = el('i');
  icon.className = 'fa-solid fa-link';
  icon.setAttribute('aria-hidden', 'true');

const eduType =
  safeStr(original.degreeType) ||
  safeStr(degreeGroupLabel(original.degreeType)) ||
  safeStr(original.title) ||
  'التعليم';

const titleText = `المصادر المرتبطة بـ (${safeStr(eduType)})`;

const title = textEl(
  'span',
  titleText,
  'biosec-linked-sources-title education-linked-sources-title'
);


  head.append(icon, title);
  wrap.appendChild(head);

  // الأزرار (chips)
ids.forEach((sid) => {
  const src = sourceMap.get(String(sid));
  if (!src) return; // تجاهل المصادر المحذوفة

  const chip = el('button', 'biosec-chip biosec-chip--source');
  chip.type = 'button';
  chip.textContent = src?.title || src?.type || String(sid);

  chip.addEventListener('click', () => {
    handlers.onBioShortcutClick?.('sources', { sourceId: String(sid) });
  });

  wrap.appendChild(chip);
});
if (!wrap.querySelector('.biosec-chip--source')) return null;

  return wrap;
}

        // 9) الملاحظة
        const notePreview = original.note ? (() => {
          const div = el('div', 'biosec-note-preview education-note-preview');
          const strong = el('strong');
          strong.textContent = 'ملاحظة: ';
          const span = el('span');
          span.textContent = original.note;
          div.append(strong, span);
          return div;
        })() : null;

        // 10) المرفقات (كما هو)
        const previewFilesWrap = el('div', 'biosec-images-thumbs education-preview-files');
        const sliderBtn = el('button', 'biosec-images-slider-btn education-files-slider-btn');
        sliderBtn.type = 'button';
        sliderBtn.innerHTML = '<i class="fa-solid fa-images" aria-hidden="true"></i> <span>عرض الصور كشرائح</span>';

        function renderPreviewFiles() {
          previewFilesWrap.innerHTML = '';

          const orderedRefs = groupRefsByKind(original.files || [], getEduFileKind);
          const images = orderedRefs.filter(r => getEduFileKind(r) === 'image');
          const others = orderedRefs.filter(r => getEduFileKind(r) !== 'image');
          const hasTwoGroups = images.length && others.length;

          sliderBtn.style.display = images.length < 2 ? 'none' : '';
          sliderBtn.onclick = () => { if (images.length >= 2) openEduSlider(images, 0); };

          if (hasTwoGroups && images.length) {
            const gt = makeGroupTitle('الصور');
            gt.classList.add('biosec-files-group-title', 'education-files-group-title');
            previewFilesWrap.appendChild(gt);
          }

          const renderThumb = (ref, idx, totalRefs, imagesOnly) => {
            const thumb = el('div', 'biosec-image-thumb biosec-file-thumb education-file-thumb education-file-thumb--preview');
            classifyEduThumb(thumb, ref);

            const kind = getEduFileKind(ref);
            const isDoc = (kind === 'word' || kind === 'excel');

            const footerRow = el('div', 'biosec-file-thumb-footer education-file-thumb-footer');
            const label = el('span', 'biosec-file-label education-file-label');
            label.textContent =
              kind === 'image' ? 'صورة' :
                kind === 'pdf' ? 'PDF' :
                  kind === 'word' ? 'Word' :
                    kind === 'excel' ? 'Excel' : 'ملف';

            const actionBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view education-file-thumb-view');
            actionBtn.type = 'button';
            actionBtn.textContent = kind === 'image' ? 'معاينة' : (isDoc ? 'تحميل' : 'فتح');

            footerRow.append(label, actionBtn);

            if (kind === 'image') {
              const imgEl = el('img');
              imgEl.alt = 'صورة مرفقة بالتعليم';
              resolveEduFileUrl(ref).then(url => { if (url) imgEl.src = url; });

              const imageIndex = findImageIndex(imagesOnly, ref);
              const openImg = () => { if (imageIndex >= 0) openEduSlider(imagesOnly, imageIndex); };

              actionBtn.addEventListener('click', (e) => { e.stopPropagation(); openImg(); });
              imgEl.addEventListener('click', openImg);

              thumb.append(imgEl, footerRow);
            } else {
              const icon = el('div', 'biosec-file-icon education-file-icon');
              icon.innerHTML = {
                pdf: '<i class="fa-solid fa-file-pdf"></i>',
                word: '<i class="fa-solid fa-file-word"></i>',
                excel: '<i class="fa-solid fa-file-excel"></i>',
                other: '<i class="fa-solid fa-file"></i>'
              }[kind] || '<i class="fa-solid fa-file"></i>';

              const openIt = () => {
                if (isDoc) {
                  openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'التعليم', index: idx, total: totalRefs });
                  return;
                }
                openInNewTabSafe(resolveEduFileUrl(ref));
              };

              actionBtn.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
              thumb.style.cursor = 'pointer';
              thumb.addEventListener('click', (e) => { if (e.target === actionBtn) return; openIt(); });

              thumb.append(icon, footerRow);
            }

            previewFilesWrap.appendChild(thumb);
          };

          images.forEach((ref, idx) => renderThumb(ref, idx, images.length, images));

          if (images.length) {
            const sliderRow = el('div', 'biosec-files-slider-row education-files-slider-row');
            sliderRow.appendChild(sliderBtn);
            previewFilesWrap.appendChild(sliderRow);
          }

          if (hasTwoGroups) {
            const div = makeDivider();
            div.classList.add('biosec-files-group-divider', 'education-files-group-divider');
            previewFilesWrap.appendChild(div);

            const gt2 = makeGroupTitle('الملفات');
            gt2.classList.add('biosec-files-group-title', 'education-files-group-title');
            previewFilesWrap.appendChild(gt2);
          }

          others.forEach((ref, idx) => renderThumb(ref, idx, others.length, images));
        }

        renderPreviewFiles();

        // ترتيب المعاينة الجديد حسب الهيكل المطلوب
        previewBox.append(
          previewTitle,          // 1) العنوان
          badgesPrimary,         // 2) الأساسية
          previewMeta,           // 3) الفترة + المدة (مع تاريخ الإضافة)
          badgesSecondary        // 4) الثانوية
        );

        if (credVerifyPreview) previewBox.appendChild(credVerifyPreview); // 5) الاعتماد/التحقق
        previewBox.appendChild(previewText);                               // 6) الوصف
        if (highlightsPreview) previewBox.appendChild(highlightsPreview);  // 7) الإنجازات
        previewBox.appendChild(tagsWrap);                                  // 8) الوسوم
        const sourcesChips = renderPreviewSourceChips();
if (sourcesChips) previewBox.appendChild(sourcesChips);            // 8.5) المصادر
        if (notePreview) previewBox.appendChild(notePreview);              // 9) الملاحظة
        previewBox.appendChild(previewFilesWrap);                          // 10) المرفقات

        card.appendChild(previewBox);

        /* =======================
           B) Edit
           ======================= */

        const editBox = el('div', 'biosec-edit education-edit');
        const head = el('div', 'biosec-head education-head');

        const titleInput = el('input', 'biosec-title-input education-title-input');
        titleInput.type = 'text';
        titleInput.placeholder = 'عنوان المرحلة (مثال: بكالوريوس / ثانوي / دورة...)';
        titleInput.value = original.title;

        const dates = el('div', 'biosec-dates education-dates');
        dates.textContent = item.createdAt ? formatCreatedAtLabel(item.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime })
          : '';

head.append(dates);
editBox.appendChild(head);

function makeEditBlock(title, extraClass = '', icon = '') {
  const block = el('div', `biosec-edit-block education-edit-block ${extraClass}`.trim());
  const h = el('div', 'biosec-edit-block-title education-edit-block-title');

  if (icon) {
    h.innerHTML =
      `<i class="fa-solid ${icon}" aria-hidden="true"></i> ` +
      `<span>${safeStr(title || '')}</span>`;
  } else {
    h.textContent = title || '';
  }

  const inner = el('div', 'biosec-edit-block-body education-edit-block-body');
  block.append(h, inner);
  return { block, inner };
}

        const body = el('div', 'biosec-body education-body');

// صف واحد فقط للبيانات الأساسية (بدل basicRow)
const basicRow = el('div', 'biosec-meta-row education-meta-row');

/* ---- degreeType + mode ---- */
const degreeTypeSelect = el('select', 'biosec-input education-degreeType-input');
{
  const o0 = el('option'); o0.value = ''; o0.textContent = 'نوع الدرجة (اختياري)';
  degreeTypeSelect.appendChild(o0);
  DEGREE_TYPES.forEach(t => {
    const o = el('option'); o.value = t; o.textContent = t;
    degreeTypeSelect.appendChild(o);
  });
}
degreeTypeSelect.value = original.degreeType || '';

const modeSelect = el('select', 'biosec-input education-mode-input');
{
  const o0 = el('option'); o0.value = ''; o0.textContent = 'نمط الدراسة (اختياري)';
  modeSelect.appendChild(o0);
  STUDY_MODES.forEach(t => {
    const o = el('option'); o.value = t; o.textContent = t;
    modeSelect.appendChild(o);
  });
}
modeSelect.value = original.mode || '';

/* ---- institution + field ---- */
const institutionInput = el('input', 'biosec-input education-institution-input');
institutionInput.type = 'text';
institutionInput.placeholder = 'الجهة التعليمية (جامعة/مدرسة/معهد...)';
institutionInput.value = original.institution;

const fieldInput = el('input', 'biosec-input education-field-input');
fieldInput.type = 'text';
fieldInput.placeholder = 'التخصص (اختياري)';
fieldInput.value = original.field;

/* ---- dates + ongoing + place ---- */
const startInput = el('input', 'biosec-input biosec-date-input education-start-input');
startInput.type = 'date';

const endInput = el('input', 'biosec-input biosec-date-input education-end-input');
endInput.type = 'date';

const ongoingWrap = el('label', 'biosec-pin-toggle education-ongoing-toggle');
const ongoingCheckbox = el('input');
ongoingCheckbox.type = 'checkbox';
ongoingCheckbox.checked = !!original.ongoing;
ongoingWrap.append(ongoingCheckbox, textEl('span', 'مستمر (حتى الآن)'));

const placeInput = el('input', 'biosec-input education-place-input');
placeInput.type = 'text';
placeInput.placeholder = 'المكان (مدينة/دولة) (اختياري)';
placeInput.value = original.place;

// IDs قبل اللف (مهم للـ label[for] داخل wrapField)
startInput.id = `${fp}_startDate`;
startInput.name = `${fp}_startDate`;

endInput.id = `${fp}_endDate`;
endInput.name = `${fp}_endDate`;

// فعل year-toggle (يبقى كما هو)
startInput.dataset.yearToggle = '1';
endInput.dataset.yearToggle = '1';

// لفّ التواريخ بنفس أسلوب بقية الحقول
const startWrap = withFieldHead(startInput, { label: 'تاريخ البداية', icon: 'fa-calendar-plus' });
const endWrap   = withFieldHead(endInput,   { label: 'تاريخ النهاية', icon: 'fa-calendar-check' });

// كل الحقول الأساسية في صف واحد (حسب الترتيب المطلوب)
basicRow.append(
  // 1) title
  withFieldHead(titleInput, { label: 'عنوان المرحلة', icon: 'fa-solid fa-file-signature' }),

  // 2) institution
  withFieldHead(institutionInput, { label: 'الجهة التعليمية', icon: 'fa-building-columns' }),

  // 3) degreeType
  withFieldHead(degreeTypeSelect, { label: 'نوع الدرجة', icon: 'fa-graduation-cap' }),

  // 4) field
  withFieldHead(fieldInput, { label: 'التخصص', icon: 'fa-book-open' }),

  // 5) startDate
  startWrap,

  // 6) ongoing
  withFieldHead(ongoingWrap, { label: 'الحالة', icon: 'fa-clock' }),

  // 7) endDate
  endWrap,

  // 8) place
  withFieldHead(placeInput,  { label: 'المكان', icon: 'fa-location-dot' }),

  // 9) mode
  withFieldHead(modeSelect, { label: 'نمط الدراسة', icon: 'fa-laptop-house' })
);


// الآن اضبط القيم
setYearToggleValue(startInput, original.startDate || '', { silent: true });
setYearToggleValue(endInput,   original.endDate   || '', { silent: true });

let lastEndBeforeOngoing = getLogicalDateValue(endInput) || original.endDate || null;

function syncOngoingUI() {
  const on = !!ongoingCheckbox.checked;

  if (endWrap?.style) {
    endWrap.style.display = on ? 'none' : '';
  }

  if (on) {
    const cur = getLogicalDateValue(endInput) || null;
    if (cur) lastEndBeforeOngoing = cur;

    endInput.disabled = true;
    setYearToggleValue(endInput, '', { silent: true });
  } else {
    endInput.disabled = false;
    const restore = lastEndBeforeOngoing || original.endDate || '';
    setYearToggleValue(endInput, restore, { silent: true });
  }
}


syncOngoingUI();
        
// حقول تفاصيل إضافية (لازم تكون مُعرفة قبل ما نستخدمها في extraRow1 و recomputeDirty)
const credentialIdInput = el('input', 'biosec-input education-credentialId-input');
credentialIdInput.type = 'text';
credentialIdInput.placeholder = 'رقم/معرّف الشهادة (اختياري)';
credentialIdInput.value = original.credentialId;

const issuerInput = el('input', 'biosec-input education-issuer-input');
issuerInput.type = 'text';
issuerInput.placeholder = 'الجهة المُصدِّرة/الاعتماد (اختياري)';
issuerInput.value = original.issuer;

const accreditationInput = el('input', 'biosec-input education-accreditation-input');
accreditationInput.type = 'text';
accreditationInput.placeholder = 'جهة الاعتماد/الاعتمادية (اختياري)';
accreditationInput.value = original.accreditation;

const languageInput = el('input', 'biosec-input education-language-input');
languageInput.type = 'text';
languageInput.placeholder = 'لغة الدراسة (اختياري)';
languageInput.value = original.language;

        const verificationUrlInput = el('input', 'biosec-input education-verificationUrl-input');
        verificationUrlInput.type = 'url';
        verificationUrlInput.placeholder = 'رابط التحقق (اختياري)';
        verificationUrlInput.value = original.verificationUrl;

        const gradeInput = el('input', 'biosec-input education-grade-input');
        gradeInput.type = 'text';
        gradeInput.placeholder = 'المعدل/التقدير (اختياري)';
        gradeInput.value = original.grade;

        const descArea = el('textarea', 'biosec-textarea education-textarea');
        descArea.rows = 4;
        descArea.placeholder = 'تفاصيل المرحلة: منجزات، نشاطات، ملاحظات...';
        descArea.value = original.description;

        const highlightsArea = el('textarea', 'biosec-textarea education-highlights-input');
        highlightsArea.rows = 4;
        highlightsArea.placeholder = 'إنجازات (كل سطر إنجاز مستقل)\nمثال:\n- مشروع تخرج ممتاز\n- نادي طلابي...';
        highlightsArea.value = (original.highlights || []).join('\n');

        const noteInput = el('textarea', 'biosec-textarea education-note-input');
        noteInput.placeholder = 'ملاحظة مختصرة (اختياري)';
        noteInput.value = original.note;

        const tagsInput = el('input', 'biosec-tags-input education-tags-input');
        tagsInput.type = 'text';
        tagsInput.placeholder = 'وسوم (افصل بفواصل مثل: جامعة, دورة, شهادة)';
        tagsInput.value = (original.tags || []).join(', ');

        /* ---------- ملفات ---------- */

        const filesBlock = el('div', 'biosec-images-block education-files-block');
        const filesLimitHint = el('div', 'biosec-meta education-files-limit-hint');
        filesLimitHint.textContent = `حد أقصى ${MAX_FILE_SIZE_MB}MB للملف / ${MAX_FILES_PER_PICK} ملفات لكل مرة`;
        filesLimitHint.style.fontSize = '.82rem';
        filesLimitHint.style.marginTop = '.25rem';

        const emptyFilesHint = el('div', 'biosec-images-empty-hint education-files-empty-hint');
        const filesRow = el('div', 'biosec-images-row education-files-row');
        const filesThumbs = el('div', 'biosec-images-thumbs education-files-thumbs');

        const addFileLabel = el('label', 'biosec-add-btn education-file-add-btn');
        addFileLabel.title = filesLimitHint.textContent;

        const addFileIcon = el('span', 'education-file-add-icon');
        addFileIcon.innerHTML = '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>';

        const addFileText = el('span', 'education-file-add-text');

        const fileInput = el('input');
        fileInput.type = 'file';
        fileInput.accept = [
          'image/*',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/heic',
          'image/heif'
        ].join(',');
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        addFileLabel.append(addFileIcon, addFileText, fileInput);
        filesRow.appendChild(filesThumbs);
// صف تحت زر الإرفاق: (الحد الأقصى + لم تُرفق ملفات بعد) في سطر واحد
const filesHintsRow = el('div', 'education-files-hints-row');
filesHintsRow.style.display = 'flex';
filesHintsRow.style.alignItems = 'center';
filesHintsRow.style.justifyContent = 'space-between';
filesHintsRow.style.gap = '.6rem';
filesHintsRow.style.flexWrap = 'wrap';
filesHintsRow.style.marginTop = '.25rem';

// إلغاء هوامش كانت مناسبة لما كانت فوق
filesLimitHint.style.marginTop = '0';
emptyFilesHint.style.marginTop = '0';

filesHintsRow.append(filesLimitHint, emptyFilesHint);

// 1) thumbs row
// 2) زر الإرفاق
// 3) السطر الذي تحته (limit + empty) في صف واحد
filesBlock.append(filesRow, addFileLabel, filesHintsRow);

const pinWrap = el('label', 'biosec-pin-toggle biosec-toggle--pinned');
const pinCheckbox = el('input');
pinCheckbox.type = 'checkbox';
pinCheckbox.checked = original.pinned;
pinWrap.append(pinCheckbox, textEl('span', 'تعيين كمميّز'));
const togglesRow = el('div', 'biosec-toggles-row');
togglesRow.append(pinWrap, timelineWrap);

titleInput.name = `${fp}_title`; titleInput.id = `${fp}_title`;

institutionInput.name = `${fp}_institution`; institutionInput.id = `${fp}_institution`;
fieldInput.name = `${fp}_field`; fieldInput.id = `${fp}_field`;

degreeTypeSelect.name = `${fp}_degreeType`; degreeTypeSelect.id = `${fp}_degreeType`;
modeSelect.name = `${fp}_mode`; modeSelect.id = `${fp}_mode`;

ongoingCheckbox.name = `${fp}_ongoing`; ongoingCheckbox.id = `${fp}_ongoing`;
placeInput.name = `${fp}_place`; placeInput.id = `${fp}_place`;

credentialIdInput.name = `${fp}_credentialId`; credentialIdInput.id = `${fp}_credentialId`;
issuerInput.name = `${fp}_issuer`; issuerInput.id = `${fp}_issuer`;
accreditationInput.name = `${fp}_accreditation`; accreditationInput.id = `${fp}_accreditation`;
verificationUrlInput.name = `${fp}_verificationUrl`; verificationUrlInput.id = `${fp}_verificationUrl`;
languageInput.name = `${fp}_language`; languageInput.id = `${fp}_language`;

gradeInput.name = `${fp}_grade`; gradeInput.id = `${fp}_grade`;

descArea.name = `${fp}_description`; descArea.id = `${fp}_description`;
highlightsArea.name = `${fp}_highlights`; highlightsArea.id = `${fp}_highlights`;
noteInput.name = `${fp}_note`; noteInput.id = `${fp}_note`;
tagsInput.name = `${fp}_tags`; tagsInput.id = `${fp}_tags`;

pinCheckbox.name = `${fp}_pinned`; pinCheckbox.id = `${fp}_pinned`;
fileInput.name = `${fp}_files`; fileInput.id = `${fp}_files`;

        function updateAddFileLabel() {
          const count = currentFiles.length || 0;
          if (!count) addFileText.textContent = 'إرفاق ملفات (صور/شهادات/وثائق)';
          else if (count === 1) addFileText.textContent = 'إضافة ملف آخر';
          else addFileText.textContent = 'إضافة مزيد من الملفات';
        }

        let sortableInited = false;
        function setupFilesSortable() {
          if (sortableInited) return;
          sortableInited = true;

          attachHorizontalSortable({
            container: filesThumbs,
            itemSelector: '.education-file-thumb',
            ghostClass: 'biosec-image-thumb--ghost education-file-thumb--ghost',
            dragClass: 'biosec-image-thumb--drag education-file-thumb--drag',
            onSorted(orderedRefs) {
              currentFiles = groupRefsByKind(orderedRefs, getEduFileKind);
              renderThumbs();
              recomputeDirty();
            }
          });
        }

        function renderThumbs() {
          filesThumbs.innerHTML = '';

          const ordered = groupRefsByKind(currentFiles, getEduFileKind);
          currentFiles = ordered;

          const images = ordered.filter(r => getEduFileKind(r) === 'image');
          const others = ordered.filter(r => getEduFileKind(r) !== 'image');
          const hasTwoGroups = images.length && others.length;

          if (!currentFiles.length) {
            emptyFilesHint.textContent = 'لم تُرفق ملفات بعد.';
            emptyFilesHint.style.display = '';
            updateAddFileLabel();
            return;
          }

          emptyFilesHint.style.display = 'none';

          if (hasTwoGroups && images.length) {
            const gt = makeGroupTitle('الصور');
            gt.classList.add('biosec-files-group-title', 'education-files-group-title');
            filesThumbs.appendChild(gt);
          }

          const renderOne = (ref, idx, totalRefs, imagesOnly) => {
            const thumb = el('div', 'biosec-image-thumb biosec-file-thumb education-file-thumb');
            thumb.dataset.ref = ref;
            classifyEduThumb(thumb, ref);

            const kind = getEduFileKind(ref);
            const isDoc = (kind === 'word' || kind === 'excel');

            let thumbContent = null;

            if (kind === 'image') {
              const imgEl = el('img');
              imgEl.alt = 'صورة مرفقة بالتعليم';
              resolveEduFileUrl(ref).then(url => { if (url) imgEl.src = url; });

              const imageIndex = findImageIndex(imagesOnly, ref);
              imgEl.addEventListener('click', () => { if (imageIndex >= 0) openEduSlider(imagesOnly, imageIndex); });

              thumbContent = imgEl;
            } else {
              const icon = el('div', 'biosec-file-icon education-file-icon');
              icon.innerHTML = {
                pdf: '<i class="fa-solid fa-file-pdf"></i>',
                word: '<i class="fa-solid fa-file-word"></i>',
                excel: '<i class="fa-solid fa-file-excel"></i>',
                other: '<i class="fa-solid fa-file"></i>'
              }[kind] || '<i class="fa-solid fa-file"></i>';

              const openIt = () => {
                if (isDoc) {
                  openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'التعليم', index: idx, total: totalRefs });
                } else {
                  openInNewTabSafe(resolveEduFileUrl(ref));
                }
              };

              icon.style.cursor = 'pointer';
              icon.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
              thumb.addEventListener('click', openIt);

              thumbContent = icon;
            }

            const removeBtn = el('button', 'biosec-image-thumb-remove education-file-thumb-remove');
            removeBtn.type = 'button';
            removeBtn.title = 'إزالة هذا الملف';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();

              const removeRef = ref;
              if (removeRef && isIdbRef(removeRef)) pendingDeletedRefs.push(removeRef);
              if (removeRef && isTmpRef(removeRef)) revokeTempRef(removeRef);

              currentFiles = currentFiles.filter(r => r !== removeRef);
              renderThumbs();
              recomputeDirty();
            });

            const viewBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view education-file-thumb-view');
            viewBtn.type = 'button';
            viewBtn.textContent = kind === 'image' ? 'معاينة' : (isDoc ? 'تحميل' : 'فتح');
            viewBtn.addEventListener('click', (e) => {
              e.stopPropagation();

              if (kind === 'image') {
                const imageIndex = findImageIndex(imagesOnly, ref);
                if (imageIndex >= 0) openEduSlider(imagesOnly, imageIndex);
                return;
              }

              if (isDoc) {
                openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'التعليم', index: idx, total: totalRefs });
                return;
              }

              openInNewTabSafe(resolveEduFileUrl(ref));
            });

            thumb.append(thumbContent, removeBtn, viewBtn);
            filesThumbs.appendChild(thumb);
          };

          images.forEach((ref, idx) => renderOne(ref, idx, images.length, images));

          if (hasTwoGroups) {
            const div = makeDivider();
            div.classList.add('biosec-files-group-divider', 'education-files-group-divider');
            filesThumbs.appendChild(div);

            const gt2 = makeGroupTitle('الملفات');
            gt2.classList.add('biosec-files-group-title', 'education-files-group-title');
            filesThumbs.appendChild(gt2);
          }

          others.forEach((ref, idx) => renderOne(ref, idx, others.length, images));

          updateAddFileLabel();
          setupFilesSortable();
        }

        renderThumbs();

        fileInput.addEventListener('change', async () => {
          let files = Array.from(fileInput.files || []);
          if (!files.length) return;

          if (files.length > MAX_FILES_PER_PICK) {
            showWarning?.(`تم اختيار ${files.length} ملف. سيتم رفع أول ${MAX_FILES_PER_PICK} فقط.`);
            files = files.slice(0, MAX_FILES_PER_PICK);
          }

          for (const file of files) {
            const check = isAllowedFile(file, {
              maxSizeMB: MAX_FILE_SIZE_MB,
              allowedMime: Array.from(ALLOWED_MIME),
              allowedExt: [
                'pdf', 'doc', 'docx', 'xls', 'xlsx',
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
                'heic', 'heif'
              ],
              allowImages: true
            });

            if (!check.ok) { showWarning?.(`${file.name || 'ملف'}: ${check.reason}`); continue; }

            try {
              const tmpRef = addTempFile(file);
              currentFiles.push(tmpRef);
            } catch (e) {
              console.error('failed to add temp file', e);
              showError?.(`تعذّر تجهيز الملف للمعاينة: ${file.name || 'غير معروف'}`);
            }
          }

          renderThumbs();
          recomputeDirty();
          fileInput.value = '';
        });

// 1) البيانات الأساسية
const basicBlock = makeEditBlock('بينات أساسية', 'education-edit-block--basic', 'fa-circle-info');
basicBlock.inner.append(basicRow);

// 2) تفاصيل إضافية
const extraBlock = makeEditBlock('تفاصيل إضافية', 'education-edit-block--extra', 'fa-list-check');

// 2.1) sources block (new structure مثل events)
const sourcesBlock = makeEditBlock('المصادر', 'education-edit-block--sources', 'fa-link');

// row container
const linkedSourcesRow = el('div', 'biosec-meta-row education-meta-row education-meta-row--sources');

// field container (مثل events: biosec-meta-field)
const linkedSourcesField = el('div', 'biosec-meta-field education-meta-field education-meta-field--sources');
        
// header
const linkedSourcesHeader = el('div', 'education-linked-sources-header biosec-linked-sources-header');

const linkedSourcesTitle = el('div', 'education-linked-sources-title biosec-linked-sources-title');
function getEduTypeLabelForSources() {
  const d = safeStr(original.degreeType);
  const g = safeStr(degreeGroupLabel(original.degreeType));
  const t = safeStr(original.title);

  // أولوية: degreeType ثم المجموعة ثم عنوان المرحلة
  return d || g || t || 'التعليم';
}


function refreshLinkedSourcesHeaderTitle() {
  const eduType = getEduTypeLabelForSources();
linkedSourcesTitle.innerHTML =
  '<i class="fa-solid fa-circle-nodes" aria-hidden="true"></i>' +
  `<span>اختر مصادر توثيق (${safeStr(eduType)})</span>`;

}

refreshLinkedSourcesHeaderTitle();

const linkedSourcesHint = textEl(
  'div',
  'حدّد المصادر التي تدعم هذا العنصر التعليمي (يمكن اختيار أكثر من مصدر).',
  'education-linked-sources-hint biosec-linked-sources-hint'
);

linkedSourcesHeader.append(linkedSourcesTitle, linkedSourcesHint);

// tools
const linkedSourcesTools = el('div', 'education-linked-sources-tools biosec-linked-sources-tools');

const sourcesCount = el('div', 'education-linked-sources-count biosec-linked-sources-count');
sourcesCount.textContent = '0 محدد';
sourcesCount.dataset.active = '0';

// Search wrap + clear button (مثل biosec-tools-right)
const sourcesSearchWrap = el('div', 'biosec-search-wrap biosec-linked-sources-search-wrap education-linked-sources-search-wrap');

const sourcesSearch = document.createElement('input');
sourcesSearch.type = 'search';
sourcesSearch.className = 'education-linked-sources-search biosec-linked-sources-search';
sourcesSearch.name = `${fp}_linked_sources_search`;
sourcesSearch.placeholder = 'ابحث داخل المصادر…';
sourcesSearch.value = '';

const clearSourcesSearchBtn = el('button', 'biosec-search-clear biosec-linked-sources-search-clear education-linked-sources-search-clear');
clearSourcesSearchBtn.type = 'button';
clearSourcesSearchBtn.title = 'مسح البحث';
clearSourcesSearchBtn.setAttribute('aria-label', 'مسح البحث');
clearSourcesSearchBtn.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
clearSourcesSearchBtn.style.display = 'none';

clearSourcesSearchBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  sourcesSearch.value = '';
  clearSourcesSearchBtn.style.display = 'none';

  applySourcesFilterEdu();
  sourcesSearch.focus();
});

sourcesSearchWrap.append(sourcesSearch, clearSourcesSearchBtn);

const btnSelectAll = el('button', 'education-linked-sources-btn biosec-linked-sources-btn');
btnSelectAll.type = 'button';
btnSelectAll.textContent = 'تحديد الكل';

const btnClear = el('button', 'education-linked-sources-btn biosec-linked-sources-btn');
btnClear.type = 'button';
btnClear.textContent = 'إلغاء الكل';

const btnInvert = el('button', 'education-linked-sources-btn biosec-linked-sources-btn');
btnInvert.type = 'button';
btnInvert.textContent = 'عكس';

linkedSourcesTools.append(sourcesCount, sourcesSearchWrap, btnSelectAll, btnClear, btnInvert);

// list wrap
const linkedSourcesList = el('div', 'education-linked-sources-list biosec-linked-sources-list');
// Empty state when search has no matches
const noSourcesMatchEl = textEl(
  'div',
  'لا توجد مصادر مطابقة لبحثك.',
  'biosec-empty-mini biosec-linked-sources-empty education-linked-sources-empty'
);
noSourcesMatchEl.style.display = 'none';
linkedSourcesList.appendChild(noSourcesMatchEl);

// helpers
function updateSelectedCountEdu() {
  const n = (currentSourceIds || []).length;
  sourcesCount.textContent = n ? `${n} محدد` : 'لا يوجد تحديد';
  sourcesCount.dataset.active = n ? '1' : '0';
}

function applySourcesFilterEdu() {
  const qRaw = (sourcesSearch.value || '');
  const q = qRaw.trim().toLowerCase();

  // toggle clear button
  clearSourcesSearchBtn.style.display = q ? '' : 'none';

  let visibleCount = 0;

  // فلترة الصفوف فقط (بدون العبث بعنصر noSourcesMatchEl)
  const rows = linkedSourcesList.querySelectorAll('.education-linked-sources-row');
  rows.forEach(row => {
    const t = (row.dataset.searchText || '').toLowerCase();
    const ok = (!q || t.includes(q));
    row.style.display = ok ? '' : 'none';
    if (ok) visibleCount++;
  });

  // show/hide "no matches" only when searching
  if (q && visibleCount === 0) {
    noSourcesMatchEl.style.display = '';
  } else {
    noSourcesMatchEl.style.display = 'none';
  }
}


sourcesSearch.addEventListener('input', applySourcesFilterEdu);

// buttons
btnSelectAll.addEventListener('click', () => {
  const boxes = linkedSourcesList.querySelectorAll('input[type="checkbox"][name="education-linked-source-row"]');
  const next = [];
  boxes.forEach(cb => {
    cb.checked = true;
    const sid = cb.dataset.sid;
    if (sid) next.push(sid);
  });
  currentSourceIds = Array.from(new Set(next));
  updateSelectedCountEdu();
  recomputeDirty();
});

btnClear.addEventListener('click', () => {
  const boxes = linkedSourcesList.querySelectorAll('input[type="checkbox"][name="education-linked-source-row"]');
  boxes.forEach(cb => (cb.checked = false));
  currentSourceIds = [];
  updateSelectedCountEdu();
  recomputeDirty();
});

btnInvert.addEventListener('click', () => {
  const boxes = linkedSourcesList.querySelectorAll('input[type="checkbox"][name="education-linked-source-row"]');
  const next = [];
  boxes.forEach(cb => {
    cb.checked = !cb.checked;
    if (cb.checked) next.push(cb.dataset.sid);
  });
  currentSourceIds = next.filter(Boolean);
  updateSelectedCountEdu();
  recomputeDirty();
});

// render
// listener واحد فقط (delegation) — لا نعرّف دوال داخل loop
let eduSourcesDelegationBound = false;

function onEducationSourceToggle(sid, checked) {
  sid = String(sid || '').trim();
  if (!sid) return;

  if (checked) {
    if (!currentSourceIds.includes(sid)) currentSourceIds.push(sid);
  } else {
    currentSourceIds = currentSourceIds.filter(x => x !== sid);
  }

  updateSelectedCountEdu();
  recomputeDirty();
}

function bindEducationSourcesDelegationOnce() {
  if (eduSourcesDelegationBound) return;
  eduSourcesDelegationBound = true;

  linkedSourcesList.addEventListener('change', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (t.type !== 'checkbox') return;
    if (t.name !== 'education-linked-source-row') return;

    onEducationSourceToggle(t.dataset.sid, t.checked);
  });
}

function renderLinkedSourcesEdu() {
linkedSourcesList.innerHTML = '';
linkedSourcesList.appendChild(noSourcesMatchEl);

  // اربط listener مرة واحدة فقط
  bindEducationSourcesDelegationOnce();

  if (!sources.length) {
    // لا توجد مصادر: اخفِ بلوك المصادر بالكامل ولا تعرض رسالة داخل القائمة
    sourcesBlock.block.style.display = 'none';

    // تنظيف بسيط لحالة البحث/النتائج 
    linkedSourcesList.innerHTML = '';
    noSourcesMatchEl.style.display = 'none';
    updateSelectedCountEdu();

    return;
  }

  // توجد مصادر: أظهر البلوك
  sourcesBlock.block.style.display = '';


  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const sid = String(src && src.id ? src.id : '').trim();
    if (!sid) continue;

    const labelText = (src && (src.title || src.type)) ? (src.title || src.type) : sid;

    const row = el('label', 'education-linked-sources-row biosec-linked-sources-row');
    row.dataset.searchText = labelText;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'education-linked-source-row';
    cb.dataset.sid = sid;
    cb.checked = currentSourceIds.includes(sid);

    const labelEl = textEl(
      'span',
      labelText,
      'education-linked-sources-label biosec-linked-sources-label'
    );

    row.append(cb, labelEl);
    linkedSourcesList.appendChild(row);
  }

  updateSelectedCountEdu();
  applySourcesFilterEdu();
}

renderLinkedSourcesEdu();

// mount
linkedSourcesField.append(
  linkedSourcesHeader,
  linkedSourcesTools,
  linkedSourcesList
);

linkedSourcesRow.append(linkedSourcesField);
sourcesBlock.inner.append(linkedSourcesRow);

// الصف الأول: 6 حقول
const extraRow1 = el('div', 'biosec-meta-row education-meta-row');
extraRow1.append(
  // 1) credentialId
  withFieldHead(credentialIdInput, { label: 'رقم / معرّف الشهادة', icon: 'fa-id-card' }),

  // 2) verificationUrl
  withFieldHead(verificationUrlInput,{ label: 'رابط التحقق', icon: 'fa-link' }),

  // 3) issuer
  withFieldHead(issuerInput, { label: 'الجهة المُصدِّرة', icon: 'fa-award' }),

  // 4) accreditation
  withFieldHead(accreditationInput,{ label: 'جهة الاعتماد', icon: 'fa-shield-halved' }),

  // 5) grade
  withFieldHead(gradeInput, { label: 'المعدل / التقدير', icon: 'fa-ranking-star' }),

  // 6) language
  withFieldHead(languageInput, { label: 'لغة الدراسة', icon: 'fa-language' })
);


// الصف الثاني: وصف المرحلة
const extraRow2 = el('div', 'biosec-meta-row education-meta-row');
extraRow2.append(
  withFieldHead(descArea, { label: 'وصف المرحلة', icon: 'fa-align-right' })
);

// الصف الثالث: الإنجازات
const extraRow3 = el('div', 'biosec-meta-row education-meta-row');
extraRow3.append(
  withFieldHead(highlightsArea, { label: 'الإنجازات (كل سطر إنجاز)', icon: 'fa-list-check' })
);

// الصف الرابع: الملاحظات
const extraRow4 = el('div', 'biosec-meta-row education-meta-row');
extraRow4.append(
  withFieldHead(noteInput, { label: 'الملاحظات', icon: 'fa-note-sticky' })
);

// الصف الخامس: الوسوم
const extraRow5 = el('div', 'biosec-meta-row education-meta-row');
extraRow5.append(
  withFieldHead(tagsInput, { label: 'الوسوم', icon: 'fa-tags' })
);

extraBlock.inner.append(
  extraRow1,
  extraRow2,
  extraRow3,
  extraRow4,
  extraRow5
);

// 3) المرفقات
const filesSection = makeEditBlock('المرفقات', 'education-edit-block--files');
filesSection.inner.append(
  withFieldHead(filesBlock, { label: 'ملفات مرفقة (صور / شهادات / وثائق)', icon: 'fa-paperclip' })
);

// 4) التبديلات (toggles)
const togglesSection = makeEditBlock('خيارات', 'education-edit-block--toggles');
togglesSection.inner.append(togglesRow);

body.append(
  basicBlock.block,
  extraBlock.block,
  sourcesBlock.block,    
  filesSection.block,
  togglesSection.block
);



        editBox.appendChild(body);
        card.appendChild(editBox);

        /* =======================
           C) Footer
           ======================= */

        const footer = el('div', 'biosec-footer education-footer');

        const saveBtn = el('button', 'biosec-save-btn education-save-btn');
        saveBtn.type = 'button';

        const cancelBtn = el('button', 'biosec-cancel-btn education-cancel-btn');
        cancelBtn.type = 'button';
        cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> <span>إلغاء التعديل</span>';

        const delBtn = el('button', 'biosec-delete-btn education-delete-btn');
        delBtn.type = 'button';
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> <span>حذف</span>';

        footer.append(saveBtn, cancelBtn, delBtn);
        card.appendChild(footer);

        function applyMode() {
          applyCardEditMode({
            card,
            isEditing,
            isDirty,
            previewBox,
            editBox,
            datesEl: dates,
            saveBtn,
            cancelBtn,
            classes: { edit: 'education-card--edit', preview: 'education-card--preview' },
            labels: { edit: 'تعديل', close: 'إغلاق', save: 'حفظ' },
            icons: { edit: 'fa-pen-to-square', close: 'fa-circle-xmark', save: 'fa-floppy-disk' }
          });
        }

        function validateDatesOrWarn() {
const s = getLogicalDateValue(startInput) || null;
const on = !!ongoingCheckbox.checked;
const e = on ? null : (getLogicalDateValue(endInput) || null);

          if (!s || !e) return true;
          const ms = ymdToUTCDate(s)?.getTime() || 0;
          const me = ymdToUTCDate(e)?.getTime() || 0;
          if (me && ms && me < ms) {
            showWarning?.('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية.');
            return false;
          }
          return true;
        }

function recomputeDirty() {
  const curTitle = titleInput.value.trim();
  const curInst = institutionInput.value.trim();
  const curField = fieldInput.value.trim();

  const curDegreeType = degreeTypeSelect.value || '';
  const curMode = modeSelect.value || '';

const curStart = getLogicalDateValue(startInput) || null;

  const curOngoing = ongoingCheckbox.checked === true;
const curEnd = curOngoing ? null : (getLogicalDateValue(endInput) || null);

  const curPlace = placeInput.value.trim();
  const curGrade = gradeInput.value.trim();

  const curCredentialId = credentialIdInput.value.trim();
  const curIssuer = issuerInput.value.trim();
  const curAccreditation = accreditationInput.value.trim();
  const curVerificationUrl = verificationUrlInput.value.trim();
  const curLanguage = languageInput.value.trim();

  const curDesc = descArea.value.trim();
  const curHighlights = normalizeHighlights(highlightsArea.value);

  const curNote = noteInput.value.trim();
  const curTags = splitCommaTags(tagsInput.value);

  const curPinned = pinCheckbox.checked === true;
const curTimelineEnabled = timelineCheckbox.checked === true;

  const filesChanged = !arraysShallowEqual(currentFiles, original.files);
const sourcesChanged =
  !arraysShallowEqual(
    [...currentSourceIds].sort(),
    [...original.sourceIds].sort()
  );
  const highlightsChanged =
    curHighlights.join('|') !== (original.highlights || []).join('|');

  isDirty =
    curTitle !== original.title ||
    curInst !== original.institution ||
    curField !== original.field ||

    curDegreeType !== original.degreeType ||
    curMode !== original.mode ||

    curStart !== (original.startDate || null) ||
    curEnd !== (original.endDate || null) ||
    curOngoing !== (original.ongoing === true) ||

    curPlace !== original.place ||
    curGrade !== original.grade ||

    curCredentialId !== original.credentialId ||
    curIssuer !== original.issuer ||
    curAccreditation !== original.accreditation ||
    curVerificationUrl !== original.verificationUrl ||
    curLanguage !== original.language ||

    curDesc !== original.description ||
    curNote !== original.note ||

    highlightsChanged ||
    curPinned !== (original.pinned === true) ||
    curTags.join('|') !== (original.tags || []).join('|') ||
    curTimelineEnabled !== (timelineInitialEnabled === true) ||
    filesChanged ||
    sourcesChanged;


  applyMode();
}

        applyMode();

        titleInput.addEventListener('input', recomputeDirty);
        institutionInput.addEventListener('input', recomputeDirty);
        fieldInput.addEventListener('input', recomputeDirty);

degreeTypeSelect.addEventListener('change', () => {
  // حدّث snapshot مؤقتًا للاسم (بدون حفظ)
  original.degreeType = safeStr(degreeTypeSelect.value);

  refreshLinkedSourcesHeaderTitle(); // تحديث النص
  recomputeDirty();
});
        modeSelect.addEventListener('change', recomputeDirty);

startInput.addEventListener('input', () => { recomputeDirty(); });
endInput.addEventListener('input', () => { recomputeDirty(); });

startInput.addEventListener('change', () => { recomputeDirty(); validateDatesOrWarn(); });
endInput.addEventListener('change', () => { recomputeDirty(); validateDatesOrWarn(); });

        ongoingCheckbox.addEventListener('change', () => {
          syncOngoingUI();
          recomputeDirty();
          validateDatesOrWarn();
        });

        placeInput.addEventListener('input', recomputeDirty);
        gradeInput.addEventListener('input', recomputeDirty);

        credentialIdInput.addEventListener('input', recomputeDirty);
        issuerInput.addEventListener('input', recomputeDirty);
        accreditationInput.addEventListener('input', recomputeDirty);
        verificationUrlInput.addEventListener('input', recomputeDirty);
        languageInput.addEventListener('input', recomputeDirty);

        descArea.addEventListener('input', recomputeDirty);
        highlightsArea.addEventListener('input', recomputeDirty);

        noteInput.addEventListener('input', recomputeDirty);
        tagsInput.addEventListener('input', recomputeDirty);
        pinCheckbox.addEventListener('change', recomputeDirty);
timelineCheckbox.addEventListener('change', recomputeDirty);

        /* ---------- حفظ/إلغاء/حذف ---------- */

        saveBtn.addEventListener('click', async () => {
          if (!isEditing) {
            isEditing = true;
            lastEditedId = item.id;
            applyMode();
            showInfo?.('يمكنك تعديل بيانات التعليم ثم الضغط على "حفظ".');
            return;
          }

          if (isEditing && !isDirty) {
            if (draftNewMap.has(item.id) && isEmptyEducationDraft(item)) {
              eduSectionTmp.cleanupTmp(currentFiles);
              pendingDeletedRefs = [];

              deleteEducation(person, item.id, {
                onChange: (items, removedRec) => {
                  if (typeof handlers.onDirty === 'function') handlers.onDirty(items, removedRec);
                  emitEducationToHost();
                }
              });

              draftNewMap.delete(item.id);
              if (lastEditedId === item.id) lastEditedId = null;

              renderList();
              showInfo?.('تم إلغاء إنشاء عنصر التعليم الفارغ.');
              return;
            }

            isEditing = false;
            lastEditedId = null;
            applyMode();
            showInfo?.('لا توجد تعديلات جديدة. تم إغلاق المحرر.');
            return;
          }

          if (!validateDatesOrWarn()) return;

          const curOngoing = !!ongoingCheckbox.checked;

          const newData = {
            title: titleInput.value.trim(),
            institution: institutionInput.value.trim(),
            field: fieldInput.value.trim(),

            degreeType: degreeTypeSelect.value || '',
            credentialId: credentialIdInput.value.trim(),
            issuer: issuerInput.value.trim(),
            accreditation: accreditationInput.value.trim(),
            verificationUrl: verificationUrlInput.value.trim(),
            language: languageInput.value.trim(),
            mode: modeSelect.value || '',
            highlights: normalizeHighlights(highlightsArea.value),

startDate: getLogicalDateValue(startInput) || null,
endDate: curOngoing ? null : (getLogicalDateValue(endInput) || null),

            ongoing: curOngoing,

            place: placeInput.value.trim(),
            grade: gradeInput.value.trim(),
            description: descArea.value.trim(),
            note: noteInput.value.trim(),
            tags: splitCommaTags(tagsInput.value),
            pinned: !!pinCheckbox.checked,
sourceIds: currentSourceIds
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid))),
            
          };

          const hasTmp = currentFiles.some(r => isTmpRef(r));
          const canPut = (typeof DB?.putEducationFile === 'function');
          if (hasTmp && !canPut) {
            showError?.('ميزة حفظ المرفقات غير متاحة حالياً (لا توجد putEducationFile).');
            return;
          }

          const up = await upgradeTmpRefs(currentFiles, {
            tempCache: eduSectionTmp.tempCache,
            putFn: async (rec) => {
              const meta = rec?.meta || {};
              return DB.putEducationFile({ file: rec.file, personId, eduId: item.id, meta });
            },
            onAfterPut: async (idbRef, rec) => { if (rec?.meta) eduFileMetaCache.set(String(idbRef), rec.meta); },
            onFail: (ref, e) => console.error('Failed to store temp education file', ref, e),
            revokeFn: (ref) => eduSectionTmp.revokeTemp(ref)
          });

          if (!up.ok) {
            showError?.('تعذّر حفظ أحد الملفات. لم يتم حفظ التعديلات.');
            return;
          }

          currentFiles = up.refs;
          newData.files = currentFiles;
const prevDates = {
  startDate: original.startDate || null,
  endDate: original.endDate || null,
  ongoing: !!original.ongoing
};

          const updated = updateEducation(person, item.id, newData, {
            onChange: (items, changed) => {
              if (typeof handlers.onDirty === 'function') handlers.onDirty(items, changed);
              emitEducationToHost();
            }
          });

          const effective = updated || item;
// Upsert linked timeline events for education
upsertSectionEvents(person, handlers, {
  sectionId: 'education',
  item: effective,
  enabled: !!timelineCheckbox.checked,
  prevDates,
  fallbackMatcher,
  makeEvents: (edu) => {
    const out = [];
    const sid = 'education';
    const iid = edu?.id;

    const titleBase = (edu?.title || edu?.institution || 'التعليم');
const details = safeStr(edu?.note || edu?.description || '');

if (edu?.startDate) {
  out.push({
    id: 'ev_' + Math.random().toString(36).slice(2, 10),
    type: 'education',
    title: `بدأ: ${titleBase}`,
    date: String(edu.startDate),
    place: safeStr(edu?.place || ''),
description: details,
    pinned: false,
    tags: [],
    source: '',
    certainty: '',
    media: [],
      sourceIds: Array.isArray(edu?.sourceIds) ? edu.sourceIds.slice() : [],
    ...normalizeEventLink({ sectionId: sid, itemId: iid, edge: 'start', key: 'auto' })
  });
}

if (!edu?.ongoing && edu?.endDate) {
  out.push({
    id: 'ev_' + Math.random().toString(36).slice(2, 10),
    type: 'education',
    title: `انتهى/تخرج: ${titleBase}`,
    date: String(edu.endDate),
    place: safeStr(edu?.place || ''),
    description: details,
    pinned: false,
    tags: [],
    source: '',
    certainty: '',
    media: [],
    sourceIds: Array.isArray(edu?.sourceIds) ? edu.sourceIds.slice() : [],
    ...normalizeEventLink({ sectionId: sid, itemId: iid, edge: 'end', key: 'auto' })
  });
}


    return out;
  }
});
timelineInitialEnabled = !!timelineCheckbox.checked;

          // snapshot
          original.title = effective.title || '';
          original.institution = safeStr(effective.institution);
          original.field = safeStr(effective.field);

          original.degreeType = safeStr(effective.degreeType);
          original.credentialId = safeStr(effective.credentialId);
          original.issuer = safeStr(effective.issuer);
          original.accreditation = safeStr(effective.accreditation);
          original.verificationUrl = safeStr(effective.verificationUrl);
          original.language = safeStr(effective.language);
          original.mode = safeStr(effective.mode);
          original.highlights = shallowArr(effective.highlights);

          original.startDate = effective.startDate || null;
          original.endDate = effective.endDate || null;
          lastEndBeforeOngoing = original.endDate || null;
          original.ongoing = !!effective.ongoing;

          original.place = safeStr(effective.place);
          original.grade = safeStr(effective.grade);
          original.description = safeStr(effective.description);
          original.note = safeStr(effective.note);

          original.tags = shallowArr(effective.tags);
          original.files = shallowArr(effective.files);
          original.pinned = !!effective.pinned;
original.sourceIds = shallowArr(effective.sourceIds);
currentSourceIds = shallowArr(original.sourceIds);
renderLinkedSourcesEdu();
// refresh sources chips in preview (بدون انتظار renderList)
try {
  previewBox.querySelectorAll('.education-linked-sources').forEach(x => x.remove());
  const chips = renderPreviewSourceChips();
  if (chips) {
    tagsWrap.insertAdjacentElement('afterend', chips);
  }
} catch {}

          // delete pending idb
          for (const ref of pendingDeletedRefs) {
            try { if (typeof DB?.deleteEducationFile === 'function') await DB.deleteEducationFile(ref); }
            catch (e) { console.error('Failed to delete education ref from DB', ref, e); }
          }
          pendingDeletedRefs = [];

          // refresh preview
          previewTitle.textContent = original.title || original.institution || 'عنصر تعليم بدون عنوان';
          previewText.textContent = original.description || 'لا توجد تفاصيل مضافة بعد.';
const startB = formatEduDateBadge(original.startDate);
const endB = original.ongoing ? 'حتى الآن' : formatEduDateBadge(original.endDate);

          period.textContent = (startB || endB) ? `${startB || '—'} → ${endB || '—'}` : 'بدون فترة محددة';

          const dTxt = formatDurationLabel(original.startDate, original.endDate, original.ongoing);
          dur.textContent = dTxt ? `· المدة: ${dTxt}` : '';

          if (item.createdAt) {
            const lbl = formatCreatedAtLabel(item.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime });
            dates.textContent = lbl;
            dateLabel.textContent = lbl;
          }
// حدّث آخر تعديل في المعاينة
if (effective.updatedAt) {
  updatedLabel.textContent = formatCreatedAtLabel(effective.updatedAt, { prefix: 'آخر تعديل', formatter: formatFullDateTime });
}

          renderPreviewFiles();

          isEditing = false;
          lastEditedId = null;
          isDirty = false;
          draftNewMap.delete(item.id);

          renderList();
          showSuccess?.('تم حفظ بيانات التعليم بنجاح');
        });

        cancelBtn.addEventListener('click', () => {
          if (!isEditing) return;

          titleInput.value = original.title;
          institutionInput.value = original.institution;
          fieldInput.value = original.field;

          degreeTypeSelect.value = original.degreeType || '';
          modeSelect.value = original.mode || '';

setYearToggleValue(startInput, original.startDate || '', { silent: true });

// خزن آخر نهاية قبل ongoing
lastEndBeforeOngoing = original.endDate || null;

// طبق ongoing أولًا ثم sync UI
ongoingCheckbox.checked = !!original.ongoing;
syncOngoingUI();

// لو مو ongoing فقط رجّع endDate (لأن syncOngoingUI قد يصفّرها)
if (!ongoingCheckbox.checked) {
  setYearToggleValue(endInput, original.endDate || '', { silent: true });
}

          placeInput.value = original.place;

          credentialIdInput.value = original.credentialId;
          issuerInput.value = original.issuer;
          accreditationInput.value = original.accreditation;
          verificationUrlInput.value = original.verificationUrl;
          languageInput.value = original.language;

          gradeInput.value = original.grade;

          descArea.value = original.description;
          highlightsArea.value = (original.highlights || []).join('\n');

          noteInput.value = original.note;
          tagsInput.value = (original.tags || []).join(', ');
          pinCheckbox.checked = original.pinned;
currentSourceIds = shallowArr(original.sourceIds);
renderLinkedSourcesEdu();

          eduSectionTmp.cleanupTmp(currentFiles);

          currentFiles = shallowArr(original.files);
          pendingDeletedRefs = [];
          renderThumbs();
          renderPreviewFiles();

timelineCheckbox.checked = (timelineInitialEnabled === true);

isEditing = false;
lastEditedId = null;

recomputeDirty();


          showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة.');
        });

        delBtn.addEventListener('click', async () => {
          const res = await showConfirmModal?.({
            title: 'حذف التعليم',
            message: 'هل تريد بالتأكيد حذف هذا العنصر التعليمي؟ لا يمكن التراجع عن هذا الإجراء.',
            variant: 'danger',
            confirmText: 'حذف',
            cancelText: 'إلغاء'
          });

          if (res !== 'confirm') { showInfo?.('تم إلغاء الحذف.'); return; }

          eduSectionTmp.cleanupTmp(currentFiles);

          const refs = Array.isArray(original.files) ? original.files : [];
          for (const ref of refs) {
            if (!isIdbRef(ref)) continue;
            try { if (typeof DB?.deleteEducationFile === 'function') await DB.deleteEducationFile(ref); }
            catch (e) { console.error('delete education ref failed', ref, e); }
          }

          const success = deleteEducation(person, item.id, {
            onChange: (items, removed) => {
              if (typeof handlers.onDirty === 'function') handlers.onDirty(items, removed);
              emitEducationToHost();
            }
          });

          if (!success) { showError?.('تعذر الحذف. حاول مرة أخرى.'); return; }
// remove linked timeline events for this education item
upsertSectionEvents(person, handlers, {
  sectionId: 'education',
  item: { id: item.id },
  enabled: false,
  prevDates: {
    startDate: original.startDate || null,
    endDate: original.endDate || null,
    ongoing: !!original.ongoing
  },
  fallbackMatcher
});

          if (lastEditedId === item.id) lastEditedId = null;
          draftNewMap.delete(item.id);

          renderList();
          showSuccess?.('تم حذف العنصر بنجاح.');
        });

        list.appendChild(card);
      });

      autoResizeTextareas(list, '.education-textarea, .education-note-input, .education-highlights-input');
// consume pending nav: scroll to specific education card OR first one linked by sourceId
try {
  const nav = (typeof handlers.__consumeBioNav === 'function') ? handlers.__consumeBioNav() : null;
  if (!nav) return;

  const itemId = nav?.itemId || nav?.educationId || null;
  const sourceId = nav?.sourceId ? String(nav.sourceId).trim() : '';

  let targetId = null;

  // 1) أولوية: itemId
  if (itemId) {
    targetId = String(itemId);
  }
  // 2) إذا جاء sourceId: اختر أول عنصر تعليم مرتبط به (من القائمة المُفلترة المعروضة)
  else if (sourceId) {
    // الأفضل اختيار من الـ filtered (المعروض) وليس person.education كامل
    const first = filtered.find(it =>
      Array.isArray(it?.sourceIds) && it.sourceIds.map(String).includes(sourceId)
    );
    if (first) targetId = String(first.id);
  }

  if (!targetId) return;

  const card = list.querySelector(`.education-card[data-edu-id="${targetId}"]`);
  if (!card) return;

  try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  catch { card.scrollIntoView(true); }

  card.classList.add('biosec-card--jump-highlight');
  setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);

} catch (e) {
  console.error('consume education nav failed', e);
}


    })().catch((e) => console.error('renderList failed', e));
  }

  /* ---------- إضافة عنصر جديد ---------- */

  addBtn.addEventListener('click', () => {
    ensureEducation(person);

    const draft = (person.education || []).find(x => draftNewMap.has(x.id) && isEmptyEducationDraft(x));
    if (draft) {
      lastEditedId = draft.id;
      renderList();
      showWarning?.('لديك مسودة تعليم مفتوحة بالفعل. أكملها أولاً قبل إضافة عنصر جديد.');
      return;
    }

    const rec = addEducation(person, {
      title: '',
      institution: '',
      field: '',

      degreeType: '',
      credentialId: '',
      issuer: '',
      accreditation: '',
      verificationUrl: '',
      language: '',
      mode: '',
      highlights: [],

      startDate: null,
      endDate: null,
      ongoing: false,

      place: '',
      grade: '',
      description: '',
      files: [],
       tags: [],
      note: '',
      pinned: false,
      sourceIds: []

    }, {
      onChange: (items, changed) => {
        if (typeof handlers.onDirty === 'function') handlers.onDirty(items, changed);
        emitEducationToHost();
      }
    });

    if (!rec) { showError?.('تعذر إنشاء عنصر جديد.'); return; }

    draftNewMap.set(rec.id, true);
    lastEditedId = rec.id;
    renderList();
    showSuccess?.('تمت إضافة عنصر تعليم جديد. املأ البيانات ثم اضغط "حفظ".');
  });

sortSelect.addEventListener('change', () => {
  const mode = sortSelect.value || 'latest';

  currentSortMode = mode;            // تحديث الحالة الحالية
  persistEducationFiltersState();    // حفظ

  sortEducation(person, mode);
  if (typeof handlers.onDirty === 'function') handlers.onDirty(person.education);
  emitEducationToHost();
  renderList();
});

  renderList();
  emitEducationToHost();
  return root;
}