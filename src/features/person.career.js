// person.career.js
// إدارة "المسار الوظيفي" لكل شخص (منطق + واجهة القسم داخل نافذة السيرة)

import {
  el,
  textEl,
  showConfirmModal,
  showWarning,
  showSuccess,
  showInfo,
  showError,
  formatFullDateTime
} from '../utils.js';

import {
  nowIso,
  safeStr,
  shallowArr,
  splitCommaTags,
  autoResizeTextareas,
  applyCardEditMode,
  formatCreatedAtLabel,
    wrapField,
  wrapPreviewBlock,
  isEmptyRecordByKeys,
 withFieldHead,
  createFiltersCollapseController

} from '../features/bio-sections.utils.js';

import {
  attachYearModeToggle,
  getLogicalDateValue,
  setYearToggleValue
} from '../ui/modal.yearToggle.js';
import { getLinkedEventEdges, upsertSectionEvents, normalizeEventLink } from './person.events.js';

/* =========================
   أدوات التواريخ + التحقق
   ========================= */

function detectPrecision(v) {
  const s = safeStr(v);
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return 'year';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  return 'approx';
}

function toTimeForCompare(value, { isEnd = false } = {}) {
  const s = safeStr(value);
  if (!s) return Date.now();

  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (!Number.isFinite(y)) return NaN;
    return isEnd ? new Date(y, 11, 31, 23, 59, 59, 999).getTime()
      : new Date(y, 0, 1, 0, 0, 0, 0).getTime();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(s + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function normalizeCareerDates({ start, end, startPrecision } = {}) {
  const s = safeStr(start);
  const e = (end == null ? '' : safeStr(end));
  const sp = safeStr(startPrecision) || detectPrecision(s);
  return { start: s, end: e, startPrecision: sp };
}

function computeDurationLabel(start, end) {
  const s = safeStr(start);
  const e = safeStr(end);
  if (!s) return '';

  const t1 = toTimeForCompare(s, { isEnd: false });
  const t2 = toTimeForCompare(e || '', { isEnd: true });
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return '';

  const ms = Math.max(0, t2 - t1);
  const totalDays = Math.floor(ms / (1000 * 60 * 60 * 24));
  const months = Math.floor(totalDays / 30.4375);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  if (years <= 0 && remMonths <= 0) return 'أقل من شهر';
  if (years > 0 && remMonths > 0) return `${years} سنة و${remMonths} شهر`;
  if (years > 0) return `${years} سنة`;
  return `${remMonths} شهر`;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const a1 = toTimeForCompare(aStart, { isEnd: false });
  const a2 = toTimeForCompare(aEnd || '', { isEnd: true });
  const b1 = toTimeForCompare(bStart, { isEnd: false });
  const b2 = toTimeForCompare(bEnd || '', { isEnd: true });
  if (![a1, a2, b1, b2].every(Number.isFinite)) return false;
  return (a1 <= b2) && (b1 <= a2);
}

/* =========================
   أدوات مساعدة: ملخص/فلاتر/تحذيرات
   ========================= */

function uniqNonEmpty(arr) {
  return Array.from(new Set((arr || []).map(safeStr).map(s => s.trim()).filter(Boolean)));
}

function buildFreqMap(arr) {
  const m = new Map();
  (arr || []).forEach(v => {
    const s = safeStr(v).trim();
    if (!s) return;
    m.set(s, (m.get(s) || 0) + 1);
  });
  return m;
}

function topFromMap(map, limit = 1) {
  const items = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  return items.slice(0, limit).map(([k, v]) => ({ key: k, count: v }));
}

function computeUnionMonths(items = []) {
  const ranges = (items || [])
    .map(x => {
      const s = safeStr(x?.start);
      const e = safeStr(x?.end);
      if (!s) return null;
      const t1 = toTimeForCompare(s, { isEnd: false });
      const t2 = toTimeForCompare(e || '', { isEnd: true });
      if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
      return { a: Math.min(t1, t2), b: Math.max(t1, t2) };
    })
    .filter(Boolean)
    .sort((r1, r2) => r1.a - r2.a);

  if (!ranges.length) return 0;

  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.a > last.b) merged.push({ ...r });
    else last.b = Math.max(last.b, r.b);
  }

  let ms = 0;
  for (const r of merged) ms += Math.max(0, r.b - r.a);

  const totalDays = Math.floor(ms / (1000 * 60 * 60 * 24));
  const months = Math.floor(totalDays / 30.4375);
  return Math.max(0, months);
}

function monthsToLabel(months) {
  const m = Math.max(0, Number(months) || 0);
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (years <= 0 && rem <= 0) return 'أقل من شهر';
  if (years > 0 && rem > 0) return `${years} سنة و${rem} شهر`;
  if (years > 0) return `${years} سنة`;
  return `${rem} شهر`;
}

function computeTransitions(items = []) {
  const list = (items || [])
    .filter(x => safeStr(x?.start))
    .slice()
    .sort((a, b) => toTimeForCompare(a.start, { isEnd: false }) - toTimeForCompare(b.start, { isEnd: false }));

  let transitions = 0;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    const orgChanged = safeStr(prev.org) && safeStr(cur.org) && safeStr(prev.org) !== safeStr(cur.org);
    const titleChanged = safeStr(prev.title) && safeStr(cur.title) && safeStr(prev.title) !== safeStr(cur.title);
    if (orgChanged || titleChanged) transitions++;
  }
  return transitions;
}

function computeCareerWarnings(item, allItems = []) {
  const warnings = [];
  const org = safeStr(item?.org);
  const start = safeStr(item?.start);
  const end = safeStr(item?.end);
  const sp = safeStr(item?.startPrecision);

  if (!org) warnings.push('بدون جهة');

  const prec = sp || detectPrecision(start);
  const startOk = (/^\d{4}$/.test(start) || /^\d{4}-\d{2}-\d{2}$/.test(start) || prec === 'approx');
  if (start && (!startOk || prec === 'approx')) warnings.push('تاريخ غير دقيق');

  if (start) {
    const overlaps = (allItems || [])
      .filter(x => x && x.id !== item.id)
      .some(x => rangesOverlap(start, end, x.start, x.end));
    if (overlaps) warnings.push('تداخل زمني');
  }

  return warnings;
}

/* =========================
   منطق البيانات (Normalize + CRUD + Sort)
   ========================= */

function normalizeCareer(raw) {
  const now = nowIso();
  if (!raw || typeof raw !== 'object') raw = {};

  const nd = normalizeCareerDates({
    start: raw.start,
    end: raw.end,
    startPrecision: raw.startPrecision
  });

  return {
    id: String(raw.id || ('car_' + Math.random().toString(36).slice(2))),

    title: safeStr(raw.title),
    org: safeStr(raw.org),
    orgType: safeStr(raw.orgType),
    start: nd.start,
    end: nd.end,
    place: safeStr(raw.place),
    note: safeStr(raw.note),

    // حقول إضافية (وظيفة)
    sector: safeStr(raw.sector),
    employmentType: safeStr(raw.employmentType),
    rank: safeStr(raw.rank),
    endReason: safeStr(raw.endReason),
    highlights: Array.isArray(raw.highlights) ? raw.highlights.map(safeStr).filter(Boolean) : [],
    skills: Array.isArray(raw.skills) ? raw.skills.map(t => String(t).trim()).filter(Boolean) : [],

    startPrecision: nd.startPrecision,

    sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],

    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

export function ensureCareer(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.career)) person.career = [];
  person.career = person.career.map(normalizeCareer);
}

export function addCareer(person, data = {}, { onChange } = {}) {
  ensureCareer(person);
  const rec = normalizeCareer(data);
  rec.createdAt = nowIso();
  rec.updatedAt = rec.createdAt;
  person.career.unshift(rec);
  if (typeof onChange === 'function') onChange(person.career, rec);
  return rec;
}

export function updateCareer(person, careerId, data = {}, { onChange } = {}) {
  ensureCareer(person);
  const idx = person.career.findIndex(x => x.id === careerId);
  if (idx === -1) return null;

  const old = person.career[idx];
  const merged = normalizeCareer({ ...old, ...data, id: old.id });
  merged.createdAt = old.createdAt || merged.createdAt;
  merged.updatedAt = nowIso();

  person.career[idx] = merged;
  if (typeof onChange === 'function') onChange(person.career, merged);
  return merged;
}

export function deleteCareer(person, careerId, { onChange } = {}) {
  ensureCareer(person);
  const idx = person.career.findIndex(x => x.id === careerId);
  if (idx === -1) return false;

  const removed = person.career.splice(idx, 1)[0];
  if (typeof onChange === 'function') onChange(person.career, removed);
  return true;
}

export function sortCareer(person, mode = 'latest') {
  ensureCareer(person);

  const key = (x) => {
    const s = safeStr(x?.start);
    const ts = toTimeForCompare(s, { isEnd: false });
    const tu = new Date(x?.updatedAt || x?.createdAt || 0).getTime();
    return Number.isFinite(ts) ? ts : tu;
  };

  person.career.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return mode === 'oldest' ? (ka - kb) : (kb - ka);
  });
}

/* =========================
   واجهة القسم
   ========================= */

export function createCareerSection(person, handlers = {}) {
  ensureCareer(person);
  const personId = person && person._id ? String(person._id) : null;

  let currentTagFilter = '';
  let lastEditedId = null;
  let currentSearchQuery = '';

  // فلاتر إضافية
  let filterCurrentOnly = false;
  let filterOrg = '';
  let filterPlace = '';
  
// Persist career filters state across reload
const CAREER_FILTERS_STATE_KEY = 'biosec:career:filtersState';

function readCareerFiltersState() {
  try {
    const raw = localStorage.getItem(CAREER_FILTERS_STATE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch {
    return null;
  }
}

function writeCareerFiltersState(state) {
  try {
    localStorage.setItem(CAREER_FILTERS_STATE_KEY, JSON.stringify(state || {}));
  } catch { /* ignore */ }
}

function persistCareerFiltersState() {
  writeCareerFiltersState({
    status: (filterStatus || 'all').trim(),
    org: (filterOrg || '').trim(),
    place: (filterPlace || '').trim(),
    tag: (currentTagFilter || '').trim(),
    search: (currentSearchQuery || '').trim(),
    sort: (sortSelect?.value || '').trim() // حفظ الترتيب
  });
}

function clearCareerFiltersState() {
  try { localStorage.removeItem(CAREER_FILTERS_STATE_KEY); } catch { /* ignore */ }
}

// =============================================
// career legacy matcher (fallback cleanup)
// - يلتقط الشكل الأقدم جدًا: job + (بدأ/انتهى) بدون relatedCareerId
// - يعمل حتى لو تم حذف العنصر (يعتمد على prevDates)
// =============================================
function careerLegacyFallbackMatcher(ev, sid, iid, prevDates = null) {
  if (String(sid || '') !== 'career') return false;

  // ev هنا غالبًا normalizedEvent (من person.events.js)
  const type = String(ev?.type || '').trim();
  const title = String(ev?.title || '').trim();
  const date = String(ev?.date || '').trim();
  const desc = String(ev?.description || '').trim();

  if (type !== 'job') return false;
  if (title !== 'بدأ العمل' && title !== 'انتهى العمل') return false;

  // prevDates (مهم جدًا للتنظيف عند تغيير start/end أو عند الحذف)
  const extra = Array.isArray(prevDates) ? prevDates.map(s => String(s || '').trim()).filter(Boolean)
    : [];

  // حاول نجيب العنصر لو موجود (للوضع الطبيعي أثناء التعديل/الحفظ)
  const item = (person?.career || []).find(x => String(x?.id || '') === String(iid || ''));

  // لو العنصر غير موجود (مثلاً بعد الحذف): نعتمد فقط على prevDates
  if (!item) {
    if (!extra.length) return false;
    return extra.includes(date);
  }

  const start = String(item?.start || '').trim();
  const end   = String(item?.end || '').trim();

  const baseNeedle =
    `${safeStr(item?.title)}${safeStr(item?.org) ? ' - ' + safeStr(item?.org) : ''}`.trim();

  const dateSet = new Set([start, end, ...extra].filter(Boolean));
  const dateMatch = dateSet.size ? dateSet.has(date) : false;
  const descMatch = baseNeedle ? desc.startsWith(baseNeedle) : false;

  return dateMatch || descMatch;
}


  // ===============================
  // Draft + Empty record helpers
  // ===============================

  const CAREER_EMPTY_KEYS = [
    'title','org','orgType','start','end','place','note',
    'sector','employmentType','rank','endReason',
    'tags','skills','highlights','sourceIds'
  ];

  function isEmptyCareerRecord(rec) {
    return isEmptyRecordByKeys(rec, CAREER_EMPTY_KEYS);
  }

  // UI-only: tracks "new draft" records without touching the data model
  const draftNewMap = new Map(); // careerId -> true

// ====== التقاط نية التنقّل (Nav intent) + scroll بعد الرسم ======
let pendingScrollCareerId = null;

function consumePendingNav() {
  const nav =
    (handlers && typeof handlers.__consumeBioNav === 'function') ? handlers.__consumeBioNav()
      : (handlers && handlers.__bioNav);

  // 1) itemId/careerId: قفز مباشر
  if (nav && (nav.itemId || nav.careerId)) {
    pendingScrollCareerId = String(nav.itemId || nav.careerId);
  }

  // 2) sourceId: اختر أول وظيفة مرتبطة بهذا المصدر داخل القائمة الحالية
  if (nav && nav.sourceId) {
    const sid = String(nav.sourceId);
    const listAll = Array.isArray(person.career) ? person.career : [];
    const first = listAll.find(x => Array.isArray(x?.sourceIds) && x.sourceIds.map(String).includes(sid));
    if (first) pendingScrollCareerId = String(first.id);
  }

  // fallback قديم
  if (handlers && handlers.__bioNav) handlers.__bioNav = null;
}

function findScrollParent(node) {
  let el = node?.parentElement;
  while (el) {
    const st = window.getComputedStyle(el);
    const oy = st.overflowY;
    const canScroll = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight;
    if (canScroll) return el;
    el = el.parentElement;
  }
  return null;
}

function scrollToCard(targetEl) {
  if (!targetEl) return;

  const scroller = findScrollParent(targetEl);

  // لو ما لقينا scroll parent واضح، رجّعنا للـ scrollIntoView
  if (!scroller) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const offset = 12; // لو عندك header sticky زودها
  const top =
    targetEl.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    offset;

  scroller.scrollTo({ top, behavior: 'smooth' });
}

  function emitCareerToHost() {
    if (!personId || typeof handlers.onUpdateCareer !== 'function') return;

    const items = Array.isArray(person.career) ? person.career.map(x => ({
      id: x.id,
      title: safeStr(x.title),
      org: safeStr(x.org),
      orgType: safeStr(x.orgType),
      start: safeStr(x.start),
      end: (x.end == null ? '' : safeStr(x.end)),
      place: safeStr(x.place),
      note: safeStr(x.note),

      sector: safeStr(x.sector),
      employmentType: safeStr(x.employmentType),
      rank: safeStr(x.rank),
      endReason: safeStr(x.endReason),
      highlights: shallowArr(x.highlights),
      skills: shallowArr(x.skills),

      startPrecision: safeStr(x.startPrecision),
      sourceIds: shallowArr(x.sourceIds),
      tags: shallowArr(x.tags),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt
    })) : [];

    handlers.onUpdateCareer(personId, items);
  }


  let sortMode = (handlers.getSortMode && handlers.getSortMode()) || 'latest';
  sortCareer(person, sortMode);

  const root = el('section', 'bio-section bio-section-career');
  root.dataset.sectionId = 'career';

  const titleEl = el('h3', 'biosec-section-title career-section-title');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-briefcase';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'المسار الوظيفي');
  const countBadge = el('span', 'biosec-count-badge career-count-badge');
  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'biosec-meta career-meta');
metaEl.textContent =
  'يساعدك قسم "المسار الوظيفي" على توثيق الوظائف والمناصب بدقة لدعم السيرة بصورة موثوقة وقابلة للرجوع.' +
  '\nأضف المسمّى والجهة والتواريخ والمكان، وسجّل المهارات والإنجازات واربطها بالمصادر عند توفرها.' +
  '\nيمكنك أيضًا إدراج الوظيفة في الخط الزمني لعرض بداياتها ونهاياتها بشكل واضح.';

  root.appendChild(metaEl);

  // ملخص ذكي أعلى القسم
  const summaryBar = el('div', 'career-summary');
  root.appendChild(summaryBar);

  function renderSummary() {
    ensureCareer(person);
    const items = person.career || [];

    const months = computeUnionMonths(items);
    const orgMap = buildFreqMap(items.map(x => safeStr(x.org)).filter(Boolean));
    const placeMap = buildFreqMap(items.map(x => safeStr(x.place)).filter(Boolean));

    const topOrg = topFromMap(orgMap, 1)[0];
    const topPlace = topFromMap(placeMap, 1)[0];
    const transitions = computeTransitions(items);

    const parts = [];
    if (items.length) parts.push(`خبرة تقريبية: ${monthsToLabel(months)}`);
    if (topOrg) parts.push(`أكثر جهة: ${topOrg.key} (${topOrg.count})`);
    if (topPlace) parts.push(`أكثر مكان: ${topPlace.key} (${topPlace.count})`);
    if (items.length > 1) parts.push(`انتقالات/تغييرات: ${transitions}`);

    summaryBar.textContent = parts.length ? parts.join(' • ') : 'لا توجد بيانات كافية لحساب ملخص الخبرة.';
  }

  function updateCountBadge() {
    const n = (person.career || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد بيانات وظيفية بعد)';
  }

  const header = el('div', 'biosec-header career-header');

  const tools = el('div', 'biosec-tools career-tools');
  const toolsLeft = el('div', 'biosec-tools-left career-tools-left');
  const toolsRight = el('div', 'biosec-tools-right career-tools-right');
// زر إظهار/إخفاء الفلاتر
const filtersToggleBtn = el('button', 'biosec-filters-toggle biosec-add-btn career-filters-toggle');
filtersToggleBtn.type = 'button';
filtersToggleBtn.setAttribute('aria-label', 'إظهار/إخفاء الفلاتر');
// زر تصفير الفلاتر (داخل toolsLeft)
const resetFiltersBtn = el('button', 'biosec-btn biosec-filters-reset career-filters-reset');
resetFiltersBtn.type = 'button';
resetFiltersBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>إعادة ضبط الفلاتر</span>';
resetFiltersBtn.title = 'إرجاع الفلاتر للوضع الافتراضي';
resetFiltersBtn.setAttribute('aria-label', 'إعادة ضبط الفلاتر');

resetFiltersBtn.style.display = 'none';

  const sortSelect = el('select', 'biosec-sort career-sort');
  sortSelect.id = 'career_sort';

  sortSelect.name = 'career_sort';
  {
    const optLatest = el('option'); optLatest.value = 'latest'; optLatest.textContent = 'الأحدث أولاً';
    const optOldest = el('option'); optOldest.value = 'oldest'; optOldest.textContent = 'الأقدم أولاً';
    sortSelect.append(optLatest, optOldest);
  }
  sortSelect.value = sortMode;

  const searchWrap = el('div', 'biosec-search-wrap career-search-wrap');
  const searchInput = el('input', 'biosec-search-input career-search-input');
  searchInput.type = 'search';
  searchInput.id = 'career_search';
  searchInput.name = 'career_search';
  searchInput.placeholder = 'ابحث في الوظائف (مسمى/جهة/مكان/مهارات)…';
  searchInput.value = '';
  
  // زر مسح البحث (يظهر فقط عند وجود نص)
const clearSearchBtn = el('button', 'biosec-search-clear career-search-clear');
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
persistCareerFiltersState();
  renderList();
  searchInput.focus();
});

searchInput.addEventListener('input', () => {
  const raw = searchInput.value || '';
  currentSearchQuery = raw.trim().toLowerCase();

  // أظهر/أخف زر المسح حسب وجود نص
  clearSearchBtn.style.display = raw.trim() ? '' : 'none';
persistCareerFiltersState();
  renderList();
});

searchWrap.append(searchInput, clearSearchBtn);

// فلاتر: الحالة + الجهة + المكان
let filterStatus = 'all'; // all | current | ended

const statusFilter = el('select', 'biosec-sort career-status-filter');
statusFilter.id = 'career_status_filter';
statusFilter.name = 'career_status_filter';

{
  const o0 = el('option'); o0.value = 'all';     o0.textContent = 'كل الحالات';
  const o1 = el('option'); o1.value = 'current'; o1.textContent = 'حاليًا فقط';
  const o2 = el('option'); o2.value = 'ended';   o2.textContent = 'المنتهية فقط';
  statusFilter.append(o0, o1, o2);
}
statusFilter.value = filterStatus;

statusFilter.addEventListener('change', () => {
  filterStatus = statusFilter.value || 'all';
  syncResetFiltersBtnVisibility();
  persistCareerFiltersState();
  renderList();
});

// Restore career filters state on load
{
  const st = readCareerFiltersState();
  if (st) {
    // status
    if (typeof st.status === 'string') {
      filterStatus = st.status || 'all';
      statusFilter.value = filterStatus;
    }

    // org
    if (typeof st.org === 'string') {
      filterOrg = st.org || '';
      // orgFilter options تُبنى لاحقاً في rebuildOrgPlaceFilters()
      // فإحنا بس نخزّن القيمة هنا، و renderList() سيطبّقها بعد إعادة البناء
    }

    // place
    if (typeof st.place === 'string') {
      filterPlace = st.place || '';
    }

    // tag
    if (typeof st.tag === 'string') {
      currentTagFilter = st.tag || '';
    }

    // search
    if (typeof st.search === 'string') {
      const raw = st.search || '';
      searchInput.value = raw;
      currentSearchQuery = raw.trim().toLowerCase();
      clearSearchBtn.style.display = raw.trim() ? '' : 'none';
    }

     // sort
    if (typeof st.sort === 'string' && st.sort) {
      const v = (st.sort === 'oldest') ? 'oldest' : 'latest';
      sortMode = v;          // يؤثر على sortCareer/person + القيمة الابتدائية
      sortSelect.value = v;  // UI
    }

  }
}

  const orgFilter = el('select', 'biosec-sort career-org-filter');
  orgFilter.id = 'career_org_filter';

  orgFilter.name = 'career_org_filter';

  const placeFilter = el('select', 'biosec-sort career-place-filter');
  placeFilter.id = 'career_place_filter';

  placeFilter.name = 'career_place_filter';


function wrapToolControl(controlEl, { title = '', icon = 'fa-circle-info', wide = false } = {}) {
  const wrap = el('div', 'biosec-tool-field career-tool-field' + (wide ? ' is-wide' : ''));
  const label = el('div', 'biosec-tool-label career-tool-label');

  label.innerHTML =
    `<span class="biosec-tool-icon career-tool-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>` +
    `<span class="biosec-tool-title career-tool-title">${safeStr(title)}</span>`;

  wrap.append(label, controlEl);
  return wrap;
}

  function rebuildOrgPlaceFilters() {
    ensureCareer(person);
    const items = person.career || [];
    const orgs = uniqNonEmpty(items.map(x => x.org));
    const places = uniqNonEmpty(items.map(x => x.place));

    orgFilter.innerHTML = '';
    placeFilter.innerHTML = '';

    const o0 = el('option'); o0.value = ''; o0.textContent = 'كل الجهات';
    orgFilter.appendChild(o0);
    orgs.forEach(v => { const o = el('option'); o.value = v; o.textContent = v; orgFilter.appendChild(o); });

    const p0 = el('option'); p0.value = ''; p0.textContent = 'كل الأماكن';
    placeFilter.appendChild(p0);
    places.forEach(v => { const o = el('option'); o.value = v; o.textContent = v; placeFilter.appendChild(o); });

    orgFilter.value = filterOrg || '';
    placeFilter.value = filterPlace || '';
  }

  orgFilter.addEventListener('change', () => {
    filterOrg = orgFilter.value || '';
      syncResetFiltersBtnVisibility();
persistCareerFiltersState();
    renderList();
  });

  placeFilter.addEventListener('change', () => {
    filterPlace = placeFilter.value || '';
  syncResetFiltersBtnVisibility();
   persistCareerFiltersState();
    renderList();
  });

  // Controller لإظهار/إخفاء toolsLeft (الفلاتر)
// دالة موحّدة: هل هناك فلاتر فعّالة؟ (نستخدمها للمنع + لإظهار زر التصفير)
function hasActiveFilters() {
  const hasTag = !!(currentTagFilter && currentTagFilter.trim());
  const hasStatus = (filterStatus && filterStatus !== 'all');
  const hasOrg = !!(filterOrg && filterOrg.trim());
  const hasPlace = !!(filterPlace && filterPlace.trim());
  return hasTag || hasStatus || hasOrg || hasPlace;
}

// إظهار/إخفاء زر التصفير حسب وجود فلاتر فعّالة
function syncResetFiltersBtnVisibility() {
  resetFiltersBtn.style.display = hasActiveFilters() ? '' : 'none';
}

// تصفير الفلاتر (وما يدخل في منع الإخفاء)
function resetFiltersToDefault() {
  // فلاتر المنع
  currentTagFilter = '';
  filterStatus = 'all';
  filterOrg = '';
  filterPlace = '';

  // صفّر عناصر الـ UI
  statusFilter.value = 'all';
  orgFilter.value = '';
  placeFilter.value = '';

  // صفّر البحث أيضًا (لأن رسالة التحذير تقول فلاتر/بحث)
  searchInput.value = '';
  currentSearchQuery = '';
  clearSearchBtn.style.display = 'none';
    // صفّر الترتيب إلى الافتراضي (latest)
  sortMode = 'latest';
  sortSelect.value = 'latest';
  sortCareer(person, 'latest');

clearCareerFiltersState();
  syncResetFiltersBtnVisibility();
  renderList();
}

resetFiltersBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetFiltersToDefault();
});

// Controller لإظهار/إخفاء toolsLeft (الفلاتر)
const filtersCtl = createFiltersCollapseController({
  storageKey: 'biosec:career:filtersCollapsed',
  panelEl: toolsLeft,
  toggleBtnEl: filtersToggleBtn,

  hasActiveFilters,

  labels: { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
  iconHtml: '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
  onBlockedHide: () => {
    showWarning?.('لا يمكن إخفاء الفلاتر لأن لديك فلاتر/بحث مُفعّل. قم بتصفيرها أولاً.');
  }
});

// طبّق الحالة الابتدائية (مع auto-open إذا فيه فلاتر فعالة)
filtersCtl.applyInitialState({ autoOpenIfActive: true });

// طبق الحالة الأولية لظهور زر التصفير
syncResetFiltersBtnVisibility();


// طبّق الحالة الابتدائية (مع auto-open إذا فيه فلاتر فعالة)
filtersCtl.applyInitialState({ autoOpenIfActive: true });

// اربط النقر
filtersToggleBtn.addEventListener('click', () => filtersCtl.toggle());
syncResetFiltersBtnVisibility();

  const addBtn = el('button', 'biosec-add-btn career-add-btn');
  addBtn.type = 'button';

toolsLeft.append(
  wrapToolControl(statusFilter, { title: 'الحالة', icon: 'fa-filter' }),
  wrapToolControl(orgFilter,    { title: 'الجهة',  icon: 'fa-building' }),
  wrapToolControl(placeFilter,  { title: 'المكان', icon: 'fa-location-dot' }),
  wrapToolControl(sortSelect,   { title: 'الترتيب', icon: 'fa-arrow-down-wide-short' }),
      resetFiltersBtn,
);


toolsRight.append(
  searchWrap,     
  addBtn,           
  filtersToggleBtn 
);

  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

  const list = el('div', 'biosec-list career-list');
  root.appendChild(list);

  // اقتراحات الوسوم (Tags/Skills)
  const tagsDatalist = el('datalist');
  tagsDatalist.id = 'career_tags_suggestions';

  const skillsDatalist = el('datalist');
  skillsDatalist.id = 'career_skills_suggestions';

  root.append(tagsDatalist, skillsDatalist);

  function rebuildTagSuggestions() {
    ensureCareer(person);
    const items = person.career || [];
    const allTags = items.flatMap(x => (Array.isArray(x.tags) ? x.tags : [])).map(String);
    const allSkills = items.flatMap(x => (Array.isArray(x.skills) ? x.skills : [])).map(String);

    const tagMap = buildFreqMap(allTags);
    const skillMap = buildFreqMap(allSkills);

    const topTags = topFromMap(tagMap, 25);
    const topSkills = topFromMap(skillMap, 25);

    tagsDatalist.innerHTML = '';
    topTags.forEach(t => {
      const o = el('option');
      o.value = t.key;
      tagsDatalist.appendChild(o);
    });

    skillsDatalist.innerHTML = '';
    topSkills.forEach(t => {
      const o = el('option');
      o.value = t.key;
      skillsDatalist.appendChild(o);
    });
  }

  function updateAddButtonLabel() {
    ensureCareer(person);
    const count = person.career.length || 0;

    if (count === 0) {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> <span>إضافة أول وظيفة</span>';
      addBtn.title = 'ابدأ بإضافة أول سجل وظيفي';
    } else {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> <span>إضافة وظيفة جديدة</span>';
      addBtn.title = `هناك ${count} سجلات وظيفية محفوظة`;
    }
  }

  function renderList() {
    list.innerHTML = '';
    ensureCareer(person);

    updateCountBadge();
    updateAddButtonLabel();

    // تحديث ملخص + فلاتر org/place + اقتراحات الوسوم
    renderSummary();
    rebuildOrgPlaceFilters();
    rebuildTagSuggestions();

    const filtered = person.career.filter(item => {
      const q = currentSearchQuery;

      const text = [
        item.title,
        item.org,
        item.place,
        item.orgType,
        item.start,
        item.end,
        item.sector,
        item.employmentType,
        item.rank,
        item.endReason,
        (item.tags || []).join(' '),
        (item.skills || []).join(' '),
        (item.highlights || []).join(' ')
      ].join(' ').toLowerCase();

      const searchOk = !q || text.includes(q);

      const tagOk =
        !currentTagFilter ||
        (Array.isArray(item.tags) && item.tags.includes(currentTagFilter)) ||
        (Array.isArray(item.skills) && item.skills.includes(currentTagFilter));

const currentOk =
  (filterStatus === 'all') ||
  (filterStatus === 'current' && !safeStr(item.end)) ||
  (filterStatus === 'ended' && !!safeStr(item.end));
      const orgOk = !filterOrg || safeStr(item.org) === filterOrg;
      const placeOk = !filterPlace || safeStr(item.place) === filterPlace;

      return searchOk && tagOk && currentOk && orgOk && placeOk;
    });

    if (!filtered.length) {
      const empty = el('div', 'biosec-empty career-empty');
      empty.textContent = person.career.length ? 'لا توجد نتائج مطابقة لخيارات البحث الحالية.'
        : 'ابدأ بإضافة أول سجل وظيفي (مثلاً: موظف، مدير، ضابط...).';
      list.appendChild(empty);
      return;
    }

    filtered.forEach((item, index) => {
      const serial = index + 1;
      const card = el('article', 'biosec-card career-card');
      card.dataset.careerId = item.id;

      const original = {
        title: item.title || '',
        org: safeStr(item.org),
        orgType: safeStr(item.orgType),
        start: safeStr(item.start),
        end: (item.end == null ? '' : safeStr(item.end)),
        place: safeStr(item.place),
        note: safeStr(item.note),

        sector: safeStr(item.sector),
        employmentType: safeStr(item.employmentType),
        rank: safeStr(item.rank),
        endReason: safeStr(item.endReason),
        highlights: shallowArr(item.highlights),
        skills: shallowArr(item.skills),

        startPrecision: safeStr(item.startPrecision),
        sourceIds: shallowArr(item.sourceIds),
        tags: shallowArr(item.tags)
      };
      
// ===============================
// Sources state
// ===============================
const sources = Array.isArray(person.sources) ? person.sources : [];
const sourceMap = new Map(sources.map(s => [String(s.id), s]));

let currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

function getSourceLabelById(sid) {
  const src = sourceMap.get(String(sid));
  if (!src) {
    const fn = handlers && typeof handlers.getSourceLabel === 'function' ? handlers.getSourceLabel : null;
    return fn ? (safeStr(fn(sid)) || String(sid)) : String(sid);
  }
  return safeStr(src.title || src.name || src.label || src.type || src.id) || String(sid);
}

const fp = `car_${item.id}`;

      let isEditing = lastEditedId === item.id;
      let isDirty = false;
const sectionId = 'career';

const state = getLinkedEventEdges(
  person.events || [],
  sectionId,
  item.id,
  careerLegacyFallbackMatcher
);

let timelineEnabled = !!state.enabled;
let timelineInitialEnabled = timelineEnabled;

const topRow = el('div', 'biosec-card-top career-card-top');
const indexBadge = el('div', 'biosec-card-index career-card-index');
indexBadge.textContent = `وظيفة ${serial}`;
topRow.appendChild(indexBadge);

// ====== Badges: الخط الزمني ثم حالة الوظيفة ======
const isCurrent = !original.end;

// 1) Badge الخط الزمني أولاً
if (timelineEnabled) {
  const tlBadge = el('div', 'biosec-pinned-badge career-timeline-badge');
  tlBadge.textContent = 'على الخط الزمني';
  topRow.appendChild(tlBadge);
}

// 2) Badge حالة الوظيفة بعده
if (isCurrent && original.start) {
  const curBadge = el('div', 'biosec-pinned-badge career-current-badge');
  curBadge.textContent = 'حاليًا';
  topRow.appendChild(curBadge);
} else if (!isCurrent && original.end) {
  const endedBadge = el('div', 'biosec-pinned-badge career-ended-badge');
  endedBadge.textContent = 'منتهية';
  topRow.appendChild(endedBadge);
}


card.appendChild(topRow);

      /* ====== A) Preview ====== */
      const previewBox = el('div', 'biosec-preview career-preview');

      const previewTitle = el('div', 'biosec-preview-title career-preview-title');
      previewTitle.textContent = original.title || original.org || 'سجل وظيفي بدون مسمى';

      const previewMeta = el('div', 'biosec-preview-meta career-preview-meta');

      const createdLabel = el('span', 'biosec-preview-date career-preview-date');
      createdLabel.textContent = item.createdAt  ? formatCreatedAtLabel(item.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime })
        : '';

      const updatedLabel = el('span', 'biosec-preview-date career-preview-updated');
updatedLabel.textContent = item.updatedAt ? formatCreatedAtLabel(item.updatedAt, { prefix: 'آخر تعديل', formatter: formatFullDateTime })
  : '';

      const period = el('span', 'career-preview-period');
      const startLabel = original.start || '—';
      const endLabel = original.end ? original.end : (original.start ? 'حتى الآن' : '—');
      period.textContent = (original.start || original.end) ? `${startLabel} → ${endLabel}` : 'بدون فترة محددة';

      const dur = el('span', 'career-preview-duration');
      const durLabel = computeDurationLabel(original.start, original.end);
      dur.textContent = durLabel ? `المدة: ${durLabel}` : '';

previewMeta.append(createdLabel, period);
if (durLabel) previewMeta.append(' ', dur);
if (updatedLabel.textContent) previewMeta.append(' ', updatedLabel);

      const badgesWrap = el('div', 'biosec-preview-badges career-preview-badges');

      if (original.org) {
        const b = el('span', 'biosec-badge career-badge career-badge--org');
        b.textContent = original.org;
        badgesWrap.appendChild(b);
      }
      if (original.place) {
        const b = el('span', 'biosec-badge career-badge career-badge--place');
        b.textContent = original.place;
        badgesWrap.appendChild(b);
      }
      if (original.orgType) {
        const b = el('span', 'biosec-badge career-badge career-badge--orgtype');
        b.textContent = original.orgType;
        badgesWrap.appendChild(b);
      }

      // بادجات إضافية (sector / employmentType / rank)
      if (original.sector) {
        const b = el('span', 'biosec-badge career-badge career-badge--sector');
        b.textContent = original.sector;
        badgesWrap.appendChild(b);
      }
      if (original.employmentType) {
        const b = el('span', 'biosec-badge career-badge career-badge--emptype');
        b.textContent = original.employmentType;
        badgesWrap.appendChild(b);
      }
      if (original.rank) {
        const b = el('span', 'biosec-badge career-badge career-badge--rank');
        b.textContent = original.rank;
        badgesWrap.appendChild(b);
      }

      const previewText = el('p', 'biosec-preview-text career-preview-text');
      previewText.textContent = original.note || 'لا توجد ملاحظات بعد.';

      // ====== Tags (نجهزها قبل الإضافة للـ DOM) ======
      const tagsWrap = el('div', 'biosec-tags-list career-tags-list');
      if (original.tags && original.tags.length) {
        original.tags.forEach(tag => {
          const chip = el(
            'button',
            'biosec-tag-chip career-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
          );
          chip.type = 'button';
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            currentTagFilter = (currentTagFilter === tag) ? '' : tag;
  syncResetFiltersBtnVisibility();
            persistCareerFiltersState();
            renderList();
          });
          tagsWrap.appendChild(chip);
        });
      }

      // ====== Sources Preview (نجهزها قبل الإضافة للـ DOM) ======
function renderPreviewLinkedSources() {
  const ids = shallowArr(original.sourceIds).map(String).filter(Boolean);
  if (!ids.length) return null;

  // container (مثل التعليم)
  const box = el('div', 'biosec-preview-block biosec-linked-sources career-linked-sources');

  // head
  const head = el('div', 'biosec-preview-block-header biosec-linked-sources-head career-linked-sources-head');
head.innerHTML =
  `<i class="fa-solid fa-link" aria-hidden="true"></i>` +
  `<span class="biosec-linked-sources-title career-linked-sources-title">` +
  `المصادر المرتبطة بـ (${safeStr(original.title || 'الوظيفة')})` +
  `</span>`;

  box.appendChild(head);

  // chips
ids.forEach((sid) => {
  const s = sourceMap.get(String(sid));
  if (!s) return; // تجاهل المصادر المحذوفة

  const chip = el('button', 'biosec-chip biosec-chip--source career-linked-source-chip');
  chip.type = 'button';
  chip.textContent = getSourceLabelById(sid);
  chip.title = 'فتح هذا المصدر';
  chip.addEventListener('click', () => {
    handlers.onBioShortcutClick?.('sources', { sourceId: String(sid) });
  });
  box.appendChild(chip);
});

// لو كل IDs محذوفة: لا ترجع بلوك فاضي
if (!box.querySelector('.biosec-chip--source')) return null;

return box;

}

let sourcesPreview = renderPreviewLinkedSources();

// ====== 1) الأساسيات أولاً (بعناوين + أيقونات) ======
previewBox.append(
  previewTitle,
  wrapPreviewBlock(previewMeta, { title: 'الفترة', icon: 'fa-calendar-days' }),
  wrapPreviewBlock(previewText, { title: 'ملاحظة', icon: 'fa-pen' })
);

// التفاصيل: نضيفها فقط إذا فيها محتوى
if (badgesWrap.childElementCount) {
  previewBox.appendChild(
    wrapPreviewBlock(badgesWrap, { title: 'تفاصيل الوظيفة', icon: 'fa-circle-info' })
  );
}

// ====== Preview: سبب ترك العمل ======
if (original.end && original.endReason) {
  const endReasonPreview = el('div', 'career-end-reason-preview');
  endReasonPreview.textContent = original.endReason;

  previewBox.appendChild(
    wrapPreviewBlock(endReasonPreview, { title: 'سبب ترك العمل', icon: 'fa-right-from-bracket' })
  );
}

      // ====== Preview: مهارات/أدوات ======
if (original.skills && original.skills.length) {
  const skillsWrap = el('div', 'career-skills-preview');
  original.skills.forEach(s => {
    const chip = el('span', 'biosec-badge career-badge career-badge--skill');
    chip.textContent = s;
    skillsWrap.appendChild(chip);
  });

  previewBox.appendChild(
    wrapPreviewBlock(skillsWrap, { title: 'مهارات/أدوات', icon: 'fa-screwdriver-wrench' })
  );
}

      // ====== 2) ثم الإنجازات ======
      if (original.highlights && original.highlights.length) {
        const ul = el('ul', 'career-highlights');
        original.highlights.slice(0, 6).forEach(h => {
          const li = el('li');
          li.textContent = h;
          ul.appendChild(li);
        });
previewBox.appendChild(
  wrapPreviewBlock(ul, { title: 'إنجازات', icon: 'fa-list-check' })
);
      }

      // ====== 3) ثم التحذيرات ======
      const warnings = computeCareerWarnings(item, person.career || []);
      if (warnings.length) {
        const wWrap = el('div', 'career-warnings');
        warnings.forEach(w => {
          const b = el('span', 'biosec-badge career-badge career-badge--warn');
          b.textContent = w;
          wWrap.appendChild(b);
        });
previewBox.appendChild(
  wrapPreviewBlock(wWrap, { title: 'تنبيهات', icon: 'fa-triangle-exclamation' })
);
      }

      // ====== 4) ثم الوسوم ثم المصادر ======
if (tagsWrap.childElementCount) {
  previewBox.appendChild(
    wrapPreviewBlock(tagsWrap, { title: 'وسوم', icon: 'fa-tags' })
  );
}
if (sourcesPreview) {
  previewBox.appendChild(sourcesPreview);
}


      card.appendChild(previewBox);

      /* ====== B) Edit ====== */
      const editBox = el('div', 'biosec-edit career-edit');

      // =========================
      // عناوين بصرية للمجموعات
      // =========================
const basicTitle = el('div', 'biosec-subtitle career-edit-subtitle');
basicTitle.innerHTML =
  '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' +
  '<span>بينات أساسية</span>';

const extraTitle = el('div', 'biosec-subtitle career-edit-subtitle');
extraTitle.innerHTML =
  '<i class="fa-solid fa-list-check" aria-hidden="true"></i> ' +
  '<span>تفاصيل إضافية</span>';

      // =========================
      // Body
      // =========================
      const body = el('div', 'biosec-body career-body');

      // =========================
      // (1) البيانات الأساسية: صف واحد
      // (title → org → place → start → end)
      // =========================
      const basicRow = el('div', 'biosec-meta-row career-meta-row');

      // --- title ---
      const titleInput = el('input', 'biosec-input career-title-input');
      titleInput.type = 'text';
      titleInput.placeholder = 'المسمى الوظيفي (إجباري) مثل: مدير، ضابط، موظف...';
      titleInput.value = original.title;
      titleInput.id = `${fp}_title`;
      titleInput.name = `${fp}_title`;

// --- org ---
const orgInput = el('input', 'biosec-input career-org-input');
orgInput.type = 'text';
orgInput.placeholder = 'الجهة/مكان العمل (اختياري)';
orgInput.value = original.org;
orgInput.id = `${fp}_org`;
orgInput.name = `${fp}_org`;

// --- orgType ---
const orgTypeSelect = el('select', 'biosec-input career-orgtype-select');
{
  const o0 = el('option'); o0.value = ''; o0.textContent = 'نوع الجهة (اختياري)';
  const o1 = el('option'); o1.value = 'حكومي'; o1.textContent = 'حكومي';
  const o2 = el('option'); o2.value = 'خاص'; o2.textContent = 'خاص';
  const o3 = el('option'); o3.value = 'عسكري'; o3.textContent = 'عسكري';
  const o4 = el('option'); o4.value = 'غير ربحي'; o4.textContent = 'غير ربحي';
  const o5 = el('option'); o5.value = 'عمل حر'; o5.textContent = 'عمل حر';
  const o6 = el('option'); o6.value = 'أخرى'; o6.textContent = 'أخرى';
  orgTypeSelect.append(o0, o1, o2, o3, o4, o5, o6);
}
orgTypeSelect.value = original.orgType || '';
orgTypeSelect.id = `${fp}_orgType`;
orgTypeSelect.name = `${fp}_orgType`;


// --- place ---
const placeInput = el('input', 'biosec-input career-place-input');
placeInput.type = 'text';
placeInput.placeholder = 'المكان (مدينة/منطقة) (اختياري)';
placeInput.value = original.place;
placeInput.id = `${fp}_place`;
placeInput.name = `${fp}_place`;

      // --- start / end (مع year toggle) ---
      const startInput = el('input', 'biosec-input career-start-input');
      startInput.type = 'text';
      startInput.placeholder = 'تاريخ البدء (YYYY أو YYYY-MM-DD)';
      startInput.value = original.start;
      startInput.id = `${fp}_start`;
      startInput.name = `${fp}_start`;
      startInput.dataset.yearToggle = '1';

      const endInput = el('input', 'biosec-input career-end-input');
      endInput.type = 'text';
      endInput.placeholder = 'تاريخ الانتهاء (YYYY أو YYYY-MM-DD) أو اتركه فارغًا (حتى الآن)';
      endInput.value = original.end;
      endInput.id = `${fp}_end`;
      endInput.name = `${fp}_end`;
      endInput.dataset.yearToggle = '1';

      // لفّ start/end باستخدام withFieldHead (زي ما كنت تسوي)
      const startWrap = withFieldHead(startInput, { label: 'تاريخ البداية', icon: 'fa-calendar-plus' });
      const endWrap   = withFieldHead(endInput,   { label: 'تاريخ النهاية', icon: 'fa-calendar-check' });

      // ربط toggle بعد وجود اللف/الهيدر
      attachYearModeToggle(startInput);
      attachYearModeToggle(endInput);

      // بناء صف الأساسي (بالترتيب المطلوب)
      basicRow.append(
        wrapField(titleInput, { title: 'المسمى الوظيفي', icon: 'fa-id-badge' }),
        wrapField(orgInput,   { title: 'الجهة',          icon: 'fa-building' }),
        wrapField(orgTypeSelect, { title: 'نوع الجهة',   icon: 'fa-landmark' }),
        wrapField(placeInput, { title: 'المكان',         icon: 'fa-location-dot' }),
        startWrap,
        endWrap
      );

      // =========================
      // (2) تفاصيل إضافية: 4 صفوف
      // =========================
const extraRow1 = el('div', 'biosec-meta-row career-meta-row');

// sector
const sectorSelect = el('select', 'biosec-input career-sector-select');
{
  const o0 = el('option'); o0.value = ''; o0.textContent = 'القطاع (اختياري)';
  const o1 = el('option'); o1.value = 'أمني'; o1.textContent = 'أمني';
  const o2 = el('option'); o2.value = 'عسكري'; o2.textContent = 'عسكري';
  const o3 = el('option'); o3.value = 'حكومي'; o3.textContent = 'حكومي';
  const o4 = el('option'); o4.value = 'خاص'; o4.textContent = 'خاص';
  const o5 = el('option'); o5.value = 'غير ربحي'; o5.textContent = 'غير ربحي';
  const o6 = el('option'); o6.value = 'تعليمي'; o6.textContent = 'تعليمي';
  const o7 = el('option'); o7.value = 'صحي'; o7.textContent = 'صحي';
  const o8 = el('option'); o8.value = 'تقني'; o8.textContent = 'تقني';
  const o9 = el('option'); o9.value = 'أخرى'; o9.textContent = 'أخرى';
  sectorSelect.append(o0,o1,o2,o3,o4,o5,o6,o7,o8,o9);
}
sectorSelect.value = original.sector || '';
sectorSelect.id = `${fp}_sector`;
sectorSelect.name = `${fp}_sector`;

      // employmentType
      const empTypeSelect = el('select', 'biosec-input career-emptype-select');
      {
        const o0 = el('option'); o0.value = ''; o0.textContent = 'نوع الدوام (اختياري)';
        const o1 = el('option'); o1.value = 'دوام كامل'; o1.textContent = 'دوام كامل';
        const o2 = el('option'); o2.value = 'دوام جزئي'; o2.textContent = 'دوام جزئي';
        const o3 = el('option'); o3.value = 'تطوع'; o3.textContent = 'تطوع';
        const o4 = el('option'); o4.value = 'عمل حر'; o4.textContent = 'عمل حر';
        const o5 = el('option'); o5.value = 'تدريب'; o5.textContent = 'تدريب';
        empTypeSelect.append(o0, o1, o2, o3, o4, o5);
      }
      empTypeSelect.value = original.employmentType || '';
      empTypeSelect.id = `${fp}_employmentType`;
      empTypeSelect.name = `${fp}_employmentType`;

      // rank
      const rankInput = el('input', 'biosec-input career-rank-input');
      rankInput.type = 'text';
      rankInput.placeholder = 'الرتبة/الدرجة (اختياري)';
      rankInput.value = original.rank || '';
      rankInput.id = `${fp}_rank`;
      rankInput.name = `${fp}_rank`;

      // endReason (مشروط بوجود end)
      const endReasonInput = el('input', 'biosec-input career-endreason-input');
      endReasonInput.type = 'text';
      endReasonInput.placeholder = 'سبب ترك الوظيفة (يظهر عند وجود تاريخ انتهاء)';
      endReasonInput.value = original.endReason || '';
      endReasonInput.id = `${fp}_endReason`;
      endReasonInput.name = `${fp}_endReason`;

      const endReasonWrap = wrapField(endReasonInput, { title: 'سبب ترك الوظيفة', icon: 'fa-right-from-bracket' });

      // tags / skills
      const tagsInput = el('input', 'biosec-input career-tags-input');
      tagsInput.type = 'text';
      tagsInput.placeholder = 'وسوم (افصل بفواصل مثل: حكومي, إداري, مبيعات)';
      tagsInput.value = (original.tags || []).join(', ');
      tagsInput.setAttribute('list', 'career_tags_suggestions');
      tagsInput.id = `${fp}_tags`;
      tagsInput.name = `${fp}_tags`;

      const skillsInput = el('input', 'biosec-input career-skills-input');
      skillsInput.type = 'text';
      skillsInput.placeholder = 'مهارات/أدوات (افصل بفواصل مثل: Excel, قيادة فريق, JavaScript)';
      skillsInput.value = (original.skills || []).join(', ');
      skillsInput.setAttribute('list', 'career_skills_suggestions');
      skillsInput.id = `${fp}_skills`;
      skillsInput.name = `${fp}_skills`;

// ===============================
// Sources picker (UI مطابق للتعليم + biosec-linked-sources-*)
// ===============================

// outer meta-field (مثل education)
const sourcesField = el('div', 'biosec-meta-field career-meta-field career-meta-field--sources');
// block title
const sourcesBlockTitle = el('div', 'biosec-edit-block-title career-edit-block-title');
sourcesBlockTitle.innerHTML =
  '<i class="fa-solid fa-link" aria-hidden="true"></i> <span>المصادر</span>';
sourcesField.appendChild(sourcesBlockTitle);

// header
const srcHeader = el('div', 'career-linked-sources-header biosec-linked-sources-header');

const srcTitle = el('div', 'career-linked-sources-title biosec-linked-sources-title');
srcTitle.innerHTML =
  `<i class="fa-solid fa-circle-nodes" aria-hidden="true"></i>` +
  `<span>اختر مصادر توثيق (${safeStr(original.title || 'هذه الوظيفة')})</span>`;

const srcHint = el('div', 'career-linked-sources-hint biosec-linked-sources-hint');
srcHint.textContent = 'حدّد المصادر التي تدعم هذا العنصر الوظيفي (يمكن اختيار أكثر من مصدر).';

srcHeader.append(srcTitle, srcHint);

// tools
const srcTools = el('div', 'career-linked-sources-tools biosec-linked-sources-tools');

// count (data-active مثل التعليم)
const srcCount = el('div', 'career-linked-sources-count biosec-linked-sources-count');
srcCount.dataset.active = '0';
srcCount.textContent = 'لا يوجد تحديد';

// search wrap + clear
const srcSearchWrap = el('div',
  'biosec-search-wrap biosec-linked-sources-search-wrap career-linked-sources-search-wrap'
);

const srcSearch = el('input', 'career-linked-sources-search biosec-linked-sources-search');
srcSearch.type = 'search';
srcSearch.name = `${fp}_linked_sources_search`;
srcSearch.placeholder = 'ابحث داخل المصادر…';
srcSearch.value = '';

const srcSearchClear = el('button',
  'biosec-search-clear biosec-linked-sources-search-clear career-linked-sources-search-clear'
);
srcSearchClear.type = 'button';
srcSearchClear.title = 'مسح البحث';
srcSearchClear.setAttribute('aria-label', 'مسح البحث');
srcSearchClear.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
srcSearchClear.style.display = 'none';

srcSearchWrap.append(srcSearch, srcSearchClear);

// buttons (بنفس نمط التعليم)
const btnAll = el('button', 'career-linked-sources-btn biosec-linked-sources-btn');
btnAll.type = 'button';
btnAll.textContent = 'تحديد الكل';

const btnNone = el('button', 'career-linked-sources-btn biosec-linked-sources-btn');
btnNone.type = 'button';
btnNone.textContent = 'إلغاء الكل';

const btnInvert = el('button', 'career-linked-sources-btn biosec-linked-sources-btn');
btnInvert.type = 'button';
btnInvert.textContent = 'عكس';

srcTools.append(srcCount, srcSearchWrap, btnAll, btnNone, btnInvert);

// list + empty mini
const linkedSourcesList = el('div', 'career-linked-sources-list biosec-linked-sources-list');

const emptyMini = el('div',
  'biosec-empty-mini biosec-linked-sources-empty career-linked-sources-empty'
);
emptyMini.style.display = 'none';
emptyMini.textContent = '';
linkedSourcesList.appendChild(emptyMini);

// compose field
sourcesField.append(srcHeader, srcTools, linkedSourcesList);

// ---- render helpers (مثل التعليم) ----
function setCountLabel() {
  const n = (currentSourceIds || []).length;
  if (!n) {
    srcCount.dataset.active = '0';
    srcCount.textContent = 'لا يوجد تحديد';
  } else {
    srcCount.dataset.active = '1';
    srcCount.textContent = `تم تحديد ${n}`;
  }
}

function renderLinkedSourcesCareer() {
  // امسح كل الصفوف وأبقِ emptyMini
  linkedSourcesList.querySelectorAll('.career-linked-sources-row').forEach(n => n.remove());

  const q = (srcSearch.value || '').trim().toLowerCase();
  const all = Array.isArray(person.sources) ? person.sources : [];

  if (!all.length) {
    sourcesField.style.display = 'none';
    return;
  } else {
    sourcesField.style.display = '';
  }

  const filteredSources = !q ? all : all.filter(s => {
    const text = [
      s?.title, s?.name, s?.label, s?.type, s?.id,
      s?.holderName, s?.nationalId, s?.civilRegistryNo
    ].map(x => safeStr(x)).join(' ').toLowerCase();
    return text.includes(q);
  });

  emptyMini.textContent = 'لا توجد مصادر مطابقة لبحثك.';
  emptyMini.style.display = (q && filteredSources.length === 0) ? '' : 'none';

  filteredSources.forEach((src) => {
    const sid = String(src.id);

    const row = el('label', 'career-linked-sources-row biosec-linked-sources-row');
    row.dataset.searchText = getSourceLabelById(sid);

    const cb = el('input');
    cb.type = 'checkbox';
    cb.name = 'career-linked-source-row';
    cb.dataset.sid = sid;
    cb.checked = currentSourceIds.includes(sid);

    const label = el('span', 'career-linked-sources-label biosec-linked-sources-label');
    label.textContent = getSourceLabelById(sid);

    row.append(cb, label);
    linkedSourcesList.appendChild(row);
  });

  setCountLabel();
  // clear btn visibility
  srcSearchClear.style.display = (srcSearch.value || '').trim() ? '' : 'none';
}

// delegation change (مثل التعليم: data-sid)
linkedSourcesList.addEventListener('change', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'INPUT' || t.type !== 'checkbox') return;

  const sid = String(t.dataset.sid || '');
  if (!sid) return;

  if (t.checked) {
    if (!currentSourceIds.includes(sid)) currentSourceIds.push(sid);
  } else {
    currentSourceIds = currentSourceIds.filter(x => x !== sid);
  }

  // لا نعيد بناء القائمة كاملة هنا لو ما تبي flicker،
  // لكن التعليم يعيد/يحسب count + يعكس الحالة، فخلّينا مثله عبر render.
  renderLinkedSourcesCareer();
  recomputeDirty();
});

// search handlers
srcSearch.addEventListener('input', () => renderLinkedSourcesCareer());
srcSearchClear.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  srcSearch.value = '';
  renderLinkedSourcesCareer();
  srcSearch.focus();
});

// tools actions
btnAll.addEventListener('click', () => {
  const allIds = (Array.isArray(person.sources) ? person.sources : []).map(s => String(s.id));
  currentSourceIds = shallowArr(allIds);
  renderLinkedSourcesCareer();
  recomputeDirty();
});

btnNone.addEventListener('click', () => {
  currentSourceIds = [];
  renderLinkedSourcesCareer();
  recomputeDirty();
});

btnInvert.addEventListener('click', () => {
  const allIds = (Array.isArray(person.sources) ? person.sources : []).map(s => String(s.id));
  const set = new Set(currentSourceIds);
  currentSourceIds = allIds.filter(id => !set.has(id));
  renderLinkedSourcesCareer();
  recomputeDirty();
});

// init
renderLinkedSourcesCareer();

// wrapField مثل باقي الحقول (مهم: لا تستخدم wrapField على sourcesBlock القديم)
const sourcesWrap = sourcesField;


      // extraRow1 composition
extraRow1.append(
  wrapField(sectorSelect, { title: 'القطاع', icon: 'fa-industry' }),
  wrapField(empTypeSelect, { title: 'نوع الدوام', icon: 'fa-clock' }),
  wrapField(rankInput, { title: 'الرتبة/الدرجة', icon: 'fa-ranking-star' }),
  endReasonWrap,
  wrapField(tagsInput, { title: 'وسوم', icon: 'fa-tags' }),
  wrapField(skillsInput, { title: 'مهارات/أدوات', icon: 'fa-screwdriver-wrench' })
);


      // (2-2) صف الإنجازات
      const extraRow2 = el('div', 'biosec-meta-row career-meta-row');
      const highlightsArea = el('textarea', 'biosec-textarea career-highlights-input');
      highlightsArea.rows = 3;
      highlightsArea.placeholder = 'إنجازات قصيرة (سطر لكل نقطة)';
      highlightsArea.value = (original.highlights || []).join('\n');
      highlightsArea.id = `${fp}_highlights`;
      highlightsArea.name = `${fp}_highlights`;

      extraRow2.append(
        wrapField(highlightsArea, { title: 'إنجازات', icon: 'fa-list-check' })
      );

      // (2-3) صف الملاحظة
      const extraRow3 = el('div', 'biosec-meta-row career-meta-row');
      const noteArea = el('textarea', 'biosec-textarea career-note-input');
      noteArea.rows = 3;
      noteArea.placeholder = 'ملاحظة مختصرة/تفاصيل (اختياري)';
      noteArea.value = original.note;
      noteArea.id = `${fp}_note`;
      noteArea.name = `${fp}_note`;

      extraRow3.append(
        wrapField(noteArea, { title: 'ملاحظة', icon: 'fa-pen' })
      );

      // (2-4) صف toggles (biosec-toggles-row)
      const timelineWrap = el('label', 'biosec-pin-toggle biosec-toggle--timeline');
      const timelineCheckbox = el('input');
      timelineCheckbox.type = 'checkbox';
      timelineCheckbox.checked = timelineEnabled;
      timelineCheckbox.id = `${fp}_toTimeline`;
      timelineCheckbox.name = `${fp}_toTimeline`;

      timelineWrap.append(
        timelineCheckbox,
        textEl('span', 'إضافة إلى الخط الزمني (بدء/انتهاء)')
      );

      const togglesRow = el('div', 'biosec-toggles-row');
      togglesRow.appendChild(timelineWrap);

      // =========================
      // تواريخ + تاريخ الإضافة (اختياري عرض داخل body بدون head)
      // =========================
      const datesEl = el('div', 'biosec-dates career-dates');
      datesEl.textContent = item.createdAt ? formatCreatedAtLabel(item.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime })
        : '';

      // =========================
      // إظهار/إخفاء سبب ترك العمل
      // =========================
      function syncEndReasonVisibility() {
        const hasEnd = !!getLogicalDateValue(endInput);
        // نخفي/نظهر wrapper بدل row مستقل
        endReasonWrap.style.display = hasEnd ? '' : 'none';

        if (!hasEnd) {
          endReasonInput.value = '';
        }
      }
      syncEndReasonVisibility();

      // =========================
      // بناء body بالترتيب النهائي المطلوب
      // =========================
body.append(
  basicTitle,
  basicRow,
  datesEl,

  extraTitle,
  extraRow1,
  extraRow2,
  extraRow3,
  sourcesWrap,
  togglesRow
);


      editBox.appendChild(body);
      card.appendChild(editBox);

      /* ====== C) Footer ====== */
      const footer = el('div', 'biosec-footer career-footer');

      const saveBtn = el('button', 'biosec-save-btn career-save-btn');
      saveBtn.type = 'button';

      const cancelBtn = el('button', 'biosec-cancel-btn career-cancel-btn');
      cancelBtn.type = 'button';
      cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> <span>إلغاء التعديل</span>';

      const delBtn = el('button', 'biosec-delete-btn career-delete-btn');
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
          datesEl,
          saveBtn,
          cancelBtn,
          classes: { edit: 'career-card--edit', preview: 'career-card--preview' },
          labels: { edit: 'تعديل', close: 'إغلاق', save: 'حفظ' },
          icons: { edit: 'fa-pen-to-square', close: 'fa-circle-xmark', save: 'fa-floppy-disk' }
        });
      }
applyMode();

function recomputeDirty() {
  const curTitle = titleInput.value.trim();
  const curOrg = orgInput.value.trim();
  const curPlace = placeInput.value.trim();
    const curOrgType = orgTypeSelect.value || '';

  const curStart = getLogicalDateValue(startInput);
  const curEnd   = getLogicalDateValue(endInput);

  const curTags = splitCommaTags(tagsInput.value);
const curSourceIdsSorted = shallowArr(currentSourceIds).slice().sort();
const origSourceIdsSorted = shallowArr(original.sourceIds).slice().sort();
const sourcesChanged = curSourceIdsSorted.join('|') !== origSourceIdsSorted.join('|');
  const curNote = noteArea.value.trim();

  const curSector = sectorSelect.value || '';
  const curEmp = empTypeSelect.value || '';
  const curRank = rankInput.value.trim();
  const curSkills = splitCommaTags(skillsInput.value);
  const curEndReason = endReasonInput.value.trim();

  const hasEndNow = !!curEnd;
  const hasEndOriginal = !!original.end;

  const curEndReasonEffective = hasEndNow ? curEndReason : '';
  const originalEndReasonEffective = hasEndOriginal ? (original.endReason || '') : '';

  const curHighlights = (highlightsArea.value || '')
    .split('\n').map(s => s.trim()).filter(Boolean);

  const curTimeline = (timelineCheckbox.checked === true);

  isDirty =
    curTitle !== original.title ||
    curOrg !== original.org ||
    curPlace !== original.place ||
    curOrgType !== (original.orgType || '') ||
    curStart !== original.start ||
    curEnd !== original.end ||
    curNote !== original.note ||
    curTags.join('|') !== (original.tags || []).join('|') ||
sourcesChanged ||

    curSector !== (original.sector || '') ||
    curEmp !== (original.employmentType || '') ||
    curRank !== (original.rank || '') ||
    curEndReasonEffective !== originalEndReasonEffective ||
    curSkills.join('|') !== (original.skills || []).join('|') ||
    curHighlights.join('|') !== (original.highlights || []).join('|');

  // Dirty للـ Timeline داخل الدالة (مع كل تغيّر)
  isDirty = isDirty || (curTimeline !== (timelineInitialEnabled === true));

  applyMode();
}

      // مراقبة التغييرات
      titleInput.addEventListener('input', recomputeDirty);
      orgInput.addEventListener('input', recomputeDirty);
      placeInput.addEventListener('input', recomputeDirty);

      sectorSelect.addEventListener('change', recomputeDirty);
      empTypeSelect.addEventListener('change', recomputeDirty);
      rankInput.addEventListener('input', recomputeDirty);
      orgTypeSelect.addEventListener('change', recomputeDirty);

      startInput.addEventListener('input', recomputeDirty);
      endInput.addEventListener('input', () => { syncEndReasonVisibility(); recomputeDirty(); });

      tagsInput.addEventListener('input', recomputeDirty);
      skillsInput.addEventListener('input', recomputeDirty);

      endReasonInput.addEventListener('input', recomputeDirty);
      highlightsArea.addEventListener('input', recomputeDirty);
      noteArea.addEventListener('input', recomputeDirty);
timelineCheckbox.addEventListener('change', recomputeDirty);

      // حفظ / فتح التحرير
      saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = item.id;
          applyMode();
          showInfo?.('يمكنك تعديل بيانات الوظيفة ثم الضغط على "حفظ".');
          return;
        }

if (isEditing && !isDirty) {

  // قاعدة موحّدة: أي سجل فارغ عند الإغلاق => احذفه دائمًا
  if (isEmptyCareerRecord(item)) {
    const ok = deleteCareer(person, item.id, {
      onChange: (items, removed) => {
        if (typeof handlers.onDirty === 'function') handlers.onDirty(items, removed);
        emitCareerToHost();
      }
    });

    // تنظيف احتياطي (حتى لو ما كان موجود)
    draftNewMap?.delete?.(item.id);

// (احتياطي) إزالة أحداث الخط الزمني عبر Generic Link Engine (بدون Legacy)
if (ok) {
  upsertSectionEvents(person, handlers, {
    sectionId: 'career',
    item: { id: item.id },
    enabled: false,
    prevDates: [item.start, item.end].filter(Boolean),
    fallbackMatcher: careerLegacyFallbackMatcher
  });
}

    if (lastEditedId === item.id) lastEditedId = null;
    renderList();
    showInfo?.('تم إلغاء إنشاء الوظيفة (لم يتم إدخال أي بيانات).');
    return;
  }

  // غير ذلك: مجرد إغلاق عادي
  isEditing = false;
  lastEditedId = null;
  applyMode();
  showInfo?.('تم إغلاق المحرر.');
  return;
}


        const newTitle = titleInput.value.trim();
        if (!newTitle) {
          showWarning?.('المسمى الوظيفي (title) إجباري.');
          return;
        }

const logicalStart = getLogicalDateValue(startInput);
const logicalEnd   = getLogicalDateValue(endInput);

const nd = normalizeCareerDates({
  start: logicalStart,
  end: logicalEnd,
  startPrecision: detectPrecision(logicalStart) || ''
});

        if (!nd.start) {
          showWarning?.('تاريخ/سنة البداية (start) مطلوب.');
          return;
        }

        const startOk = (/^\d{4}$/.test(nd.start) || /^\d{4}-\d{2}-\d{2}$/.test(nd.start) || detectPrecision(nd.start) === 'approx');
        const endOk = (!nd.end) || (/^\d{4}$/.test(nd.end) || /^\d{4}-\d{2}-\d{2}$/.test(nd.end) || detectPrecision(nd.end) === 'approx');

        if (!startOk) {
          showWarning?.('صيغة start غير مدعومة. استخدم YYYY أو YYYY-MM-DD.');
          return;
        }
        if (!endOk) {
          showWarning?.('صيغة end غير مدعومة. استخدم YYYY أو YYYY-MM-DD أو اتركه فارغًا.');
          return;
        }

        const tStart = toTimeForCompare(nd.start, { isEnd: false });
        const tEnd = toTimeForCompare(nd.end || '', { isEnd: true });

        if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) {
          showWarning?.('تعذر قراءة التاريخ. تأكد من الصيغة.');
          return;
        }

        if (nd.end && tEnd < tStart) {
          showError?.('لا يمكن أن تكون نهاية العمل (end) أقدم من بدايته (start).');
          return;
        }

        const overlaps = (person.career || [])
          .filter(x => x.id !== item.id)
          .filter(x => rangesOverlap(nd.start, nd.end, x.start, x.end));

        if (overlaps.length) {
          const msg = `يوجد تداخل زمني مع ${overlaps.length} وظيفة أخرى. هل تريد الحفظ رغم ذلك؟`;
          const res = await showConfirmModal?.({
            title: 'تحذير: تداخل زمني',
            message: msg,
            variant: 'warning',
            confirmText: 'حفظ رغم التداخل',
            cancelText: 'إلغاء'
          });
          if (res !== 'confirm') {
            showInfo?.('تم إلغاء الحفظ.');
            return;
          }
        }

        const newData = {
          title: newTitle,
          org: orgInput.value.trim(),
          orgType: orgTypeSelect.value || '',
          start: nd.start,
          end: nd.end,
          place: placeInput.value.trim(),
          note: noteArea.value.trim(),
          startPrecision: nd.startPrecision || '',
          tags: splitCommaTags(tagsInput.value),
sourceIds: shallowArr(currentSourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid))),

          sector: sectorSelect.value || '',
          employmentType: empTypeSelect.value || '',
          rank: rankInput.value.trim(),
endReason: nd.end ? endReasonInput.value.trim() : '',
          skills: splitCommaTags(skillsInput.value),
          highlights: (highlightsArea.value || '').split('\n').map(s => s.trim()).filter(Boolean)
        };
// مرّر التواريخ القديمة (قبل التحديث)
const prevDates = [original.start, original.end].filter(Boolean);


const updated = updateCareer(person, item.id, newData, {
  onChange: (items, changed) => {
    if (typeof handlers.onDirty === 'function') handlers.onDirty(items, changed);
    emitCareerToHost();
  }
});

const effective = updated || item;

// مزامنة أحداث الوظيفة عبر Generic Link Engine
upsertSectionEvents(person, handlers, {
  sectionId: 'career',
  item: effective,
  enabled: (timelineCheckbox.checked === true),
  prevDates,
  fallbackMatcher: careerLegacyFallbackMatcher,
  makeEvents: (it) => {
    const base =
      `${safeStr(it?.title)}${safeStr(it?.org) ? ' - ' + safeStr(it?.org) : ''}`.trim();
    const note = safeStr(it?.note).trim();
    const description = [base, note].filter(Boolean).join('\n');

    const out = [];

    if (it?.start) {
      out.push({
        type: 'job',
        title: 'بدأ العمل',
        date: String(it.start).trim(),
        place: safeStr(it?.place),
        description,
        pinned: false,
        tags: [],
        source: '',
        certainty: '',
        media: [],
        ...normalizeEventLink({ sectionId: 'career', itemId: it.id, edge: 'start', key: 'auto' })
      });
    }

    if (it?.end) {
      out.push({
        type: 'job',
        title: 'انتهى العمل',
        date: String(it.end).trim(),
        place: safeStr(it?.place),
        description,
        pinned: false,
        tags: [],
        source: '',
        certainty: '',
        media: [],
        ...normalizeEventLink({ sectionId: 'career', itemId: it.id, edge: 'end', key: 'auto' })
      });
    }

    return out;
  }
});

// تحديث baseline بعد الحفظ
timelineInitialEnabled = (timelineCheckbox.checked === true);



        // تحديث snapshot
        original.title = effective.title || '';
        original.org = safeStr(effective.org);
        original.orgType = safeStr(effective.orgType);
        original.start = safeStr(effective.start);
        original.end = (effective.end == null ? '' : safeStr(effective.end));
        original.place = safeStr(effective.place);
        original.note = safeStr(effective.note);

        original.sector = safeStr(effective.sector);
        original.employmentType = safeStr(effective.employmentType);
        original.rank = safeStr(effective.rank);
        original.endReason = safeStr(effective.endReason);
        original.skills = shallowArr(effective.skills);
        original.highlights = shallowArr(effective.highlights);

        original.startPrecision = safeStr(effective.startPrecision);
        original.tags = shallowArr(effective.tags);
        original.sourceIds = shallowArr(effective.sourceIds);
// تحديث Sources UI بعد الحفظ
currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

renderLinkedSourcesCareer();


// أعد بناء Chips في المعاينة
sourcesPreview = renderPreviewLinkedSources();

        // تحديث المعاينة الأساسية (ثم نعيد بناء القائمة لتحديث التحذيرات/البادجات/الهايلايتس)
        previewTitle.textContent = original.title || original.org || 'سجل وظيفي بدون مسمى';
        previewText.textContent = original.note || 'لا توجد ملاحظات بعد.';
        period.textContent = (original.start || original.end) ? `${original.start || '—'} → ${original.end ? original.end : (original.start ? 'حتى الآن' : '—')}`
          : 'بدون فترة محددة';

        const nextDur = computeDurationLabel(original.start, original.end);
        dur.textContent = nextDur ? `المدة: ${nextDur}` : '';

        // إعادة بناء القائمة لتحديث التحذيرات/البادجات/الهايلايتس بشكل نظيف
        // (بدل التلاعب بعناصر كثيرة داخل نفس الكارد)

        card.classList.toggle('career-card--current', !original.end);

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
// هذا السجل لم يعد “draft”
draftNewMap?.delete?.(item.id);

        renderList();
        showSuccess?.('تم حفظ بيانات الوظيفة بنجاح');
      });

cancelBtn.addEventListener('click', () => {
  if (!isEditing) return;

  titleInput.value = original.title;
  orgInput.value = original.org;
  placeInput.value = original.place;
  orgTypeSelect.value = original.orgType || '';

  sectorSelect.value = original.sector || '';
  empTypeSelect.value = original.employmentType || '';
  rankInput.value = original.rank || '';

  setYearToggleValue(startInput, original.start, { silent: true });
  setYearToggleValue(endInput, original.end, { silent: true });

  tagsInput.value = (original.tags || []).join(', ');
  skillsInput.value = (original.skills || []).join(', ');

currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

renderLinkedSourcesCareer();

  endReasonInput.value = original.endReason || '';
  highlightsArea.value = (original.highlights || []).join('\n');

  noteArea.value = original.note;

timelineCheckbox.checked = (timelineInitialEnabled === true);

  syncEndReasonVisibility();
  recomputeDirty();

  isEditing = false;
  lastEditedId = null;
  isDirty = false;
  applyMode();

  showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة.');
});


      delBtn.addEventListener('click', async () => {
        const res = await showConfirmModal?.({
          title: 'حذف سجل وظيفي',
          message: 'هل تريد بالتأكيد حذف هذا السجل الوظيفي؟ لا يمكن التراجع عن هذا الإجراء.',
          variant: 'danger',
          confirmText: 'حذف',
          cancelText: 'إلغاء'
        });

        if (res !== 'confirm') {
          showInfo?.('تم إلغاء الحذف.');
          return;
        }

const success = deleteCareer(person, item.id, {
  onChange: (items, removed) => {
    if (typeof handlers.onDirty === 'function') handlers.onDirty(items, removed);
    emitCareerToHost();
  }
});

if (!success) {
  showError?.('تعذر الحذف. حاول مرة أخرى.');
  return;
}
draftNewMap.delete(item.id);

upsertSectionEvents(person, handlers, {
  sectionId: 'career',
  item: { id: item.id },
  enabled: false,
  prevDates: [original.start, original.end].filter(Boolean),
  fallbackMatcher: careerLegacyFallbackMatcher
});

if (lastEditedId === item.id) lastEditedId = null;
renderList();
showSuccess?.('تم حذف السجل بنجاح.');

      });

      list.appendChild(card);
    });

    // auto-resize للنصوص
    autoResizeTextareas(list, '.career-note-input, .career-highlights-input');

// ====== نفّذ scroll بعد ما تخلص بناء القائمة ======
if (pendingScrollCareerId) {
  const card = list.querySelector(
    `.career-card[data-career-id="${pendingScrollCareerId}"]`
  );

  if (card) {
    // scroll (مرتين عشان أي scroll لاحق ما يغطي عليه)
    requestAnimationFrame(() => {
      scrollToCard(card);
      requestAnimationFrame(() => scrollToCard(card));
    });

    // highlight
    card.classList.add('biosec-card--jump-highlight');
    setTimeout(() => card.classList.remove('biosec-card--jump-highlight'),1500);
  }

  pendingScrollCareerId = null;
}

}

  
  // إضافة عنصر جديد
  addBtn.addEventListener('click', () => {
    ensureCareer(person);

const draft = person.career.find(x => isEmptyCareerRecord(x));


    if (draft) {
      lastEditedId = draft.id;
      renderList();
      showWarning?.('لديك مسودة وظيفة مفتوحة بالفعل. أكملها أولاً قبل إضافة عنصر جديد.');
      return;
    }

    const rec = addCareer(person, {
      title: '',
      org: '',
      orgType: '',
      start: '',
      end: '',
      place: '',
      note: '',
      sector: '',
      employmentType: '',
      rank: '',
      endReason: '',
      highlights: [],
      skills: [],
      sourceIds: [],
      tags: []
    }, {
      onChange: (items, changed) => {
        if (typeof handlers.onDirty === 'function') handlers.onDirty(items, changed);
        emitCareerToHost();
      }
    });

    if (!rec) {
      showError?.('تعذر إنشاء سجل جديد.');
      return;
    }
draftNewMap.set(rec.id, true);

    lastEditedId = rec.id;
    renderList();
    showSuccess?.('تمت إضافة سجل وظيفي جديد. املأ البيانات ثم اضغط "حفظ".');
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'oldest' ? 'oldest' : 'latest';
    sortMode = mode; // تحديث المتغير المحلي

    sortCareer(person, mode);

    persistCareerFiltersState(); // حفظ sort مع بقية الفلاتر

    if (typeof handlers.onDirty === 'function') handlers.onDirty(person.career);
    emitCareerToHost();
    renderList();
  });

  consumePendingNav();
  renderList();
  emitCareerToHost();
  return root;
}