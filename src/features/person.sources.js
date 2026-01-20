// person.sources.js
// قسم "المصادر والوثائق" لكل شخص (منطق + واجهة)
// مضاف: تاريخ الانتهاء + تنبيه، حقول هوية/ميلاد ديناميكية، سجل تدقيق history، بحث متقدم، اقتراح وسوم، إحصاءات موسعة

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
  getTextLengthInfo,
  openResolvedSlider,
  applyCardEditMode,

  createTypeHelpers,

  isAllowedFile,
  getRefExt,
  inferFileKind,
  openInNewTabSafe,
  groupRefsByKind,
  buildDownloadName,

  findImageIndex,
  makeGroupTitle,
  makeDivider,
  createFiltersCollapseController,
  isEmptyRecordByKeys
} from '../features/bio-sections.utils.js';


/* ============================================================================
   إعدادات الملفات
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

/* ============================================================================
   بيانات المصدر: أنواع + تطبيع + CRUD
============================================================================ */

const SOURCE_TYPE_LABELS = {
  generic: 'عام',
  birth: 'ميلاد',
  marriage: 'زواج',
  death: 'وفاة',
  id: 'هوية / بطاقة',
  inheritance: 'ميراث / قسمة',
  property: 'ملكية / عقار',
  other: 'أخرى'
};

const SOURCE_TYPE_OPTIONS = [
  ['all', 'كل الأنواع'],
  ['generic', 'عام'],
  ['birth', 'ميلاد'],
  ['marriage', 'زواج'],
  ['death', 'وفاة'],
  ['id', 'هوية / بطاقة'],
  ['inheritance', 'ميراث / قسمة'],
  ['property', 'ملكية / عقار'],
  ['other', 'أخرى']
];

const sourceType = createTypeHelpers({
  labels: SOURCE_TYPE_LABELS,
  options: SOURCE_TYPE_OPTIONS,
  allValue: 'all',
  allLabel: 'كل الأنواع'
});

const CONFIDENCE_LEVEL_LABELS = {
  official: 'رسمي',
  family: 'عائلي موثوق',
  oral: 'رواية شفوية',
  copy: 'نسخة غير أصلية'
};

const CONFIDENTIALITY_LABELS = {
  public: 'عام للأقارب',
  private: 'خاص (للمالك فقط)',
  sensitive: 'حساس'
};

function getSourceNoteLengthInfo(len) {
  return getTextLengthInfo(
    len,
    { short: 140, medium: 400 },
    {
      empty: 'بدون وصف',
      short: 'وصف قصير',
      medium: 'وصف متوسط',
      long: 'وصف مطوّل'
    }
  );
}

/* ----------------------------
   منطق الانتهاء والتنبيه
   - إذا validUntil < اليوم => منتهي
   - إذا خلال N يوم => قريب الانتهاء
----------------------------- */

const DEFAULT_EXPIRY_ALERT_DAYS = 30;

function parseIsoDateOnly(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  const dt = new Date(s + 'T00:00:00Z');
  const time = dt.getTime();
  return Number.isFinite(time) ? dt : null;
}

function daysUntil(dateOnlyIso) {
  const dt = parseIsoDateOnly(dateOnlyIso);
  if (!dt) return null;
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = dt.getTime() - todayUTC.getTime();
  return Math.floor(diffMs / (24 * 3600 * 1000));
}

function getExpiryStatus(src, alertDays = DEFAULT_EXPIRY_ALERT_DAYS) {
  const until = (src?.validUntil || '').trim();
  if (!until) return { status: 'none', days: null };
  const d = daysUntil(until);
  if (d == null) return { status: 'none', days: null };
  if (d < 0) return { status: 'expired', days: d };
  if (d <= alertDays) return { status: 'near', days: d };
  return { status: 'ok', days: d };
}

/* ----------------------------
   سجل التدقيق (Audit trail) محلي/ضمن البيانات
----------------------------- */

function normalizeHistory(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map(h => ({
      at: h?.at || null,
      by: safeStr(h?.by),
      action: safeStr(h?.action)
    }))
    .filter(x => x.at && x.action);
}

function appendHistory(oldHistory, entry) {
  const h = normalizeHistory(oldHistory);
  const e = entry && typeof entry === 'object' ? { at: entry.at || nowIso(), by: safeStr(entry.by), action: safeStr(entry.action) }
    : null;
  if (e && e.at && e.action) h.push(e);
  return h;
}

function normalizeSource(raw) {
  const now = nowIso();
  if (!raw || typeof raw !== 'object') raw = {};

  return {
    id: String(raw.id || 'src_' + Math.random().toString(36).slice(2)),
    title: safeStr(raw.title),
    type: safeStr(raw.type),
    forField: safeStr(raw.forField),
    date: raw.date || null,
    place: safeStr(raw.place),
    referenceCode: safeStr(raw.referenceCode),
    issuer: safeStr(raw.issuer),
    pages: safeStr(raw.pages),

    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => safeStr(t)).filter(Boolean) : [],
    note: safeStr(raw.note),
    pinned: !!raw.pinned,

    confidenceLevel: safeStr(raw.confidenceLevel),
    relatedEventId: raw.relatedEventId || null,

    verified: !!raw.verified,
    verifiedBy: safeStr(raw.verifiedBy),
    verifiedAt: raw.verifiedAt || null,

    confidentiality: safeStr(raw.confidentiality),

    // جديد: صلاحية/انتهاء
    validUntil: raw.validUntil || null,          // YYYY-MM-DD
    expiryAlertDays: Number.isFinite(Number(raw.expiryAlertDays)) ? Number(raw.expiryAlertDays)
      : DEFAULT_EXPIRY_ALERT_DAYS,

    // جديد: حقول هوية/ميلاد (تظهر ديناميكياً حسب النوع)
    holderName: safeStr(raw.holderName),         // اسم صاحب الوثيقة
    nationalId: safeStr(raw.nationalId),         // رقم الهوية
    civilRegistryNo: safeStr(raw.civilRegistryNo), // رقم السجل المدني

    // جديد: سجل تدقيق
    history: normalizeHistory(raw.history),

    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

/* ----------------------------
   مفاتيح الفراغ
----------------------------- */

const SOURCE_EMPTY_KEYS = [
  'title', 'type', 'forField', 'date', 'place', 'referenceCode', 'issuer', 'pages',
  'files', 'tags', 'note', 'confidenceLevel', 'relatedEventId',
  'verifiedBy', 'verifiedAt', 'confidentiality',
  'validUntil', 'holderName', 'nationalId', 'civilRegistryNo'
];

const SOURCE_DRAFT_EMPTY_KEYS = [
  'title', 'forField', 'date', 'place', 'referenceCode', 'issuer', 'pages',
  'files', 'tags', 'note', 'confidenceLevel', 'relatedEventId',
  'verifiedBy', 'verifiedAt', 'confidentiality',
  'validUntil', 'holderName', 'nationalId', 'civilRegistryNo'
];

function isEmptySourceRecord(rec) {
  return isEmptyRecordByKeys(rec, SOURCE_EMPTY_KEYS);
}

function isEmptySourceDraft(rec) {
  return isEmptyRecordByKeys(rec, SOURCE_DRAFT_EMPTY_KEYS);
}


export function ensureSources(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.sources)) person.sources = [];
  person.sources = person.sources.map(normalizeSource);
}

export function addSource(person, data = {}, { onChange, by = '' } = {}) {
  ensureSources(person);
  const src = normalizeSource(data);
  const now = nowIso();
  src.createdAt = now;
  src.updatedAt = now;

  // سجل تدقيق: إنشاء
  src.history = appendHistory(src.history, { at: now, by: by || '', action: 'create' });

  person.sources.unshift(src);
  if (typeof onChange === 'function') onChange(person.sources, src);
  return src;
}

export function updateSource(person, sourceId, data = {}, { onChange, by = '' } = {}) {
  ensureSources(person);
  const idx = person.sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return null;

  const old = person.sources[idx];

  const merged = normalizeSource({ ...old, ...data, id: old.id });
  merged.createdAt = old.createdAt || merged.createdAt;
  merged.updatedAt = nowIso();

  // سجل تدقيق: تحديث (لا نضيف إذا ما تغير شيء فعلاً - يعتمد على استدعاء UI)
  merged.history = appendHistory(old.history, {
    at: merged.updatedAt,
    by: by || '',
    action: 'update'
  });

  person.sources[idx] = merged;

  if (typeof onChange === 'function') onChange(person.sources, merged);
  return merged;
}

export function deleteSource(person, sourceId, { onChange } = {}) {
  ensureSources(person);
  const idx = person.sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return false;
  const removed = person.sources.splice(idx, 1)[0];
  if (typeof onChange === 'function') onChange(person.sources, removed);
  return true;
}

export function sortSources(person, mode = 'latest') {
  ensureSources(person);
  person.sources.sort((a, b) => {
    const da = new Date(a.date || a.createdAt || a.updatedAt || 0).getTime();
    const db = new Date(b.date || b.createdAt || b.updatedAt || 0).getTime();
    return mode === 'oldest' ? (da - db) : (db - da);
  });
}

/* ============================================================================
   عارض الملفات + كاش الميتاداتا
============================================================================ */

const sourceImageViewer = createImageViewerOverlay();

const sourceFileMetaCache = new Map(); // ref -> { kind, ext, mime, name? }

const sourceSectionTmp = createSectionTempAndResolver({
  prefix: 'tmp:',
  getIdbUrl: (ref) => DB?.getSourceFileURL?.(ref),
  metaCache: sourceFileMetaCache
});

const sourceTempCache = sourceSectionTmp.tempCache;
const resolveSourceFileUrlLocal = sourceSectionTmp.resolve;

function addTempFile(file) {
  const meta = makeTempMetaFromFile(file);
  return sourceSectionTmp.addTemp(file, meta);
}

function revokeTempRef(tmpRef) {
  sourceSectionTmp.revokeTemp(tmpRef);
}

async function openSourceSlider(refs, startIndex = 0, resolver = resolveSourceFileUrlLocal) {
  return openResolvedSlider({
    viewer: sourceImageViewer,
    refs,
    startIndex,
    resolveUrl: resolver
  });
}

export function createSourcesSection(person, handlers = {}) {
  ensureSources(person);

  const personId = person && person._id ? String(person._id) : null;

  // فلاتر أساسية
  let currentTypeFilter = 'all';
  let currentTagFilter = '';
  let currentSearchTerm = '';
  let pinnedFilterMode = 'all';

  // فلاتر إضافية
  let advIssuer = '';
  let advConfidentiality = '';
  let advVerifiedMode = 'all'; // all | verified | unverified
  let advConfidence = '';

  // جديد: شريط تنبيه الانتهاء
  let expiryFocusMode = 'all'; // all | expired | near

  let viewMode = 'cards';
  let lastEditedId = null;

    // Persist filters state across reload (per person)
  const SOURCES_FILTERS_STATE_KEY = `biosec:sources:filtersState:${personId || 'global'}`;

  function readSourcesFiltersState() {
    try {
      const raw = localStorage.getItem(SOURCES_FILTERS_STATE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch {
      return null;
    }
  }

  function writeSourcesFiltersState(state) {
    try {
      localStorage.setItem(SOURCES_FILTERS_STATE_KEY, JSON.stringify(state || {}));
    } catch { /* ignore */ }
  }

  function persistSourcesFiltersState() {
    writeSourcesFiltersState({
      type: (currentTypeFilter || 'all').trim(),
      pinned: (pinnedFilterMode || 'all').trim(),
      tag: (currentTagFilter || '').trim(),
      search: (currentSearchTerm || '').trim(),
      expiry: (expiryFocusMode || 'all').trim(),

      advIssuer: (advIssuer || '').trim(),
      advConfidentiality: (advConfidentiality || '').trim(),
      advConfidence: (advConfidence || '').trim(),
      advVerifiedMode: (advVerifiedMode || 'all').trim(),

      // Optional UX state
      viewMode: (viewMode || 'cards').trim(),
      sortMode: (sortSelect?.value || '').trim()
    });
  }

  function clearSourcesFiltersState() {
    try { localStorage.removeItem(SOURCES_FILTERS_STATE_KEY); } catch { /* ignore */ }
  }

  // Draft tracker (UI-only)
  const draftNewMap = new Map();

  // اسم المستخدم (اختياري - إذا عندك handler لهذا)
  const getActorName = () => safeStr(handlers?.getActorName?.()) || '';

  function emitSourcesToHost() {
    if (!personId || typeof handlers.onUpdateSources !== 'function') return;

    const sources = Array.isArray(person.sources) ? person.sources.map(s => ({
      id: s.id,
      title: safeStr(s.title),
      type: safeStr(s.type),
      forField: safeStr(s.forField),
      date: s.date || null,
      place: safeStr(s.place),
      referenceCode: safeStr(s.referenceCode),
      issuer: safeStr(s.issuer),
      pages: safeStr(s.pages),

      files: shallowArr(s.files),
      tags: shallowArr(s.tags),
      note: safeStr(s.note),
      pinned: !!s.pinned,

      confidenceLevel: safeStr(s.confidenceLevel),
      relatedEventId: s.relatedEventId || null,

      verified: !!s.verified,
      verifiedBy: safeStr(s.verifiedBy),
      verifiedAt: s.verifiedAt || null,

      confidentiality: safeStr(s.confidentiality),

      validUntil: s.validUntil || null,
      expiryAlertDays: Number.isFinite(Number(s.expiryAlertDays)) ? Number(s.expiryAlertDays) : DEFAULT_EXPIRY_ALERT_DAYS,
      holderName: safeStr(s.holderName),
      nationalId: safeStr(s.nationalId),
      civilRegistryNo: safeStr(s.civilRegistryNo),
      history: Array.isArray(s.history) ? s.history.map(h => ({
        at: h?.at || null,
        by: safeStr(h?.by),
        action: safeStr(h?.action)
      })) : [],

      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    })) : [];

    handlers.onUpdateSources(personId, sources);
  }

  let sortMode = (handlers.getSourcesSortMode && handlers.getSourcesSortMode()) || 'latest';
  sortSources(person, sortMode);

  const root = el('section', 'bio-section bio-section-sources');

  /* ----------------------------
     العنوان
  ----------------------------- */

  const titleEl = el('h3', 'biosec-section-title sources-section-title');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-file-circle-check';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'المصادر والوثائق');
  const countBadge = el('span', 'biosec-count-badge sources-count-badge');

  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'biosec-meta sources-meta');
metaEl.textContent =
  'يُعد هذا القسم المرجع الأساسي لتوثيق السيرة بالمستندات الداعمة (هوية، ميلاد، زواج، ملكيات وغيرها) مع حفظ بياناتها ومرفقاتها بشكل منظم.\n' +
  'استخدم الوسوم والبحث المتقدم والفلاتر لتسهيل الوصول، وفعّل التنبيهات لمتابعة صلاحية الوثائق وتفادي انتهاءها.\n' +
  'ابدأ بإضافة أول وثيقة الآن لتعزيز موثوقية السيرة وربطها بالأحداث والتعليم والوظائف والقصص عند الحاجة.';

  root.appendChild(metaEl);

  function updateSourcesCountBadge() {
    const n = (person.sources || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد وثائق بعد)';
  }

  /* ----------------------------
     أدوات القسم: فلاتر + بحث + عرض
  ----------------------------- */

  const header = el('div', 'biosec-header sources-header');
  const tools = el('div', 'biosec-tools sources-tools');
  const toolsLeft = el('div', 'biosec-tools-left sources-tools-left');
  const toolsRight = el('div', 'biosec-tools-right sources-tools-right');
  
  const FILTERS_COLLAPSE_LS_KEY = `biosec:sources:filtersCollapsed:${personId || 'global'}`;

  // 1) زر إظهار/إخفاء الفلاتر أولاً (قبل أي استخدام)
  const filtersToggleBtn = el('button', 'biosec-btn sources-filters-toggle-btn');
  filtersToggleBtn.type = 'button';
  filtersToggleBtn.setAttribute('aria-pressed', 'false');
filtersToggleBtn.innerHTML = '';

  function wrapToolsLeftItem({ title = '', icon = '', child, extraClass = '' } = {}) {
    const wrap = el('div', 'biosec-tools-field sources-tools-field' + (extraClass ? ` ${extraClass}` : ''));
    const label = el('div', 'biosec-tool-label sources-tool-label');
    label.innerHTML = `<span class="biosec-meta-icon sources-tools-icon">${icon}</span> ${safeStr(title)}`;
    wrap.append(label, child);
    return wrap;
  }

  // 2) أنشئ عناصر الفلاتر قبل تعريف/استخدام hasActiveFilters
  const typeFilterSelect = el('select', 'biosec-type-filter sources-type-filter');
  typeFilterSelect.name = 'sources_type_filter';
  sourceType.fillSelect(typeFilterSelect);
  typeFilterSelect.value = 'all';

  const sortSelect = el('select', 'biosec-sort sources-sort');
  sortSelect.name = 'sources_sort';
  const optLatest = el('option'); optLatest.value = 'latest'; optLatest.textContent = 'الأحدث أولاً';
  const optOldest = el('option'); optOldest.value = 'oldest'; optOldest.textContent = 'الأقدم أولاً';
  sortSelect.append(optLatest, optOldest);
  sortSelect.value = sortMode;

  const searchWrap = el('div', 'biosec-search-wrap sources-search-wrap');
  const searchInput = el('input', 'biosec-search-input sources-search-input');
  searchInput.type = 'search';
  searchInput.name = 'sources_search';
  searchInput.placeholder = 'بحث سريع (عنوان/جهة/رقم/وصف)...';
  // زر مسح البحث (يظهر فقط عند وجود نص)
const clearSearchBtn = el('button', 'biosec-search-clear sources-search-clear');
clearSearchBtn.type = 'button';
clearSearchBtn.title = 'مسح البحث';
clearSearchBtn.setAttribute('aria-label', 'مسح البحث');
clearSearchBtn.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
clearSearchBtn.style.display = 'none';

clearSearchBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  searchInput.value = '';
  currentSearchTerm = '';
  clearSearchBtn.style.display = 'none';
persistSourcesFiltersState();
  renderList();
  searchInput.focus();
});

searchWrap.append(searchInput, clearSearchBtn);

  const pinnedFilterSelect = el('select', 'biosec-select sources-pinned-filter-select');
  pinnedFilterSelect.name = 'sources_pinned_filter_mode';
  {
    const optAll = el('option'); optAll.value = 'all'; optAll.textContent = 'كل الوثائق';
    const optPinned = el('option'); optPinned.value = 'pinned'; optPinned.textContent = 'الوثائق المهمة فقط';
    pinnedFilterSelect.append(optAll, optPinned);
    pinnedFilterSelect.value = pinnedFilterMode;
  }

  // فلاتر إضافية (كانت ضمن البحث المتقدم سابقاً)
  const advIssuerInput = el('input', 'biosec-input sources-adv-issuer');
  advIssuerInput.name = 'sources_adv_issuer';
  advIssuerInput.type = 'text';
  advIssuerInput.placeholder = 'الجهة المصدرة (مطابقة جزئية)';

  const advConfSelect = el('select', 'biosec-select sources-adv-conf');
  advConfSelect.name = 'sources_adv_confidentiality';
  [
    ['', 'كل مستويات السرية'],
    ['public', CONFIDENTIALITY_LABELS.public],
    ['private', CONFIDENTIALITY_LABELS.private],
    ['sensitive', CONFIDENTIALITY_LABELS.sensitive]
  ].forEach(([v, t]) => {
    const o = el('option'); o.value = v; o.textContent = t; advConfSelect.appendChild(o);
  });

  const advConfidenceSelect = el('select', 'biosec-select sources-adv-confidence');
  advConfidenceSelect.name = 'sources_adv_confidence';
  [
    ['', 'كل درجات الاعتماد'],
    ['official', CONFIDENCE_LEVEL_LABELS.official],
    ['family', CONFIDENCE_LEVEL_LABELS.family],
    ['oral', CONFIDENCE_LEVEL_LABELS.oral],
    ['copy', CONFIDENCE_LEVEL_LABELS.copy]
  ].forEach(([v, t]) => {
    const o = el('option'); o.value = v; o.textContent = t; advConfidenceSelect.appendChild(o);
  });

  // select بثلاث خيارات (يبقى نفس الاسم/الكلاس المطلوب)
  const advVerifiedSelect = el('select', 'biosec-select sources-adv-verified');
  advVerifiedSelect.name = 'sources_adv_verified_mode';
  [
    ['all', 'كل الوثائق (الموثقة وغير الموثقة)'],
    ['verified', 'الموثقة'],
    ['unverified', 'غير الموثقة']
  ].forEach(([v, t]) => {
    const o = el('option'); o.value = v; o.textContent = t; advVerifiedSelect.appendChild(o);
  });
  advVerifiedSelect.value = advVerifiedMode;
const advClearBtn = el('button', 'biosec-btn sources-adv-clear');
advClearBtn.type = 'button';
advClearBtn.innerHTML =
  '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ' +
  '<span>إعادة ضبط الفلاتر</span>';
advClearBtn.removeAttribute('title');
advClearBtn.setAttribute('aria-label', 'إعدة ضبط الفلاتر إلى الوضع الإفتراضي');

    // Restore filters state on load
  {
    const st = readSourcesFiltersState();
    if (st) {
      // type
      if (typeof st.type === 'string') {
        currentTypeFilter = st.type || 'all';
        typeFilterSelect.value = currentTypeFilter || 'all';
      }

      // pinned
      if (typeof st.pinned === 'string') {
        pinnedFilterMode = st.pinned || 'all';
        pinnedFilterSelect.value = pinnedFilterMode || 'all';
      }

      // tag
      if (typeof st.tag === 'string') {
        currentTagFilter = st.tag;
      }

      // expiry
      if (typeof st.expiry === 'string') {
        expiryFocusMode = st.expiry || 'all';
      }

      // search
      if (typeof st.search === 'string') {
        searchInput.value = st.search;
        currentSearchTerm = st.search || '';
        clearSearchBtn.style.display = (st.search || '').trim() ? '' : 'none';
      }

      // advanced
      if (typeof st.advIssuer === 'string') {
        advIssuer = st.advIssuer;
        advIssuerInput.value = advIssuer;
      }
      if (typeof st.advConfidentiality === 'string') {
        advConfidentiality = st.advConfidentiality;
        advConfSelect.value = advConfidentiality;
      }
      if (typeof st.advConfidence === 'string') {
        advConfidence = st.advConfidence;
        advConfidenceSelect.value = advConfidence;
      }
      if (typeof st.advVerifiedMode === 'string') {
        advVerifiedMode = st.advVerifiedMode || 'all';
        advVerifiedSelect.value = advVerifiedMode;
      }

      // Optional UX: view + sort
      if (typeof st.viewMode === 'string') {
        viewMode = (st.viewMode === 'table') ? 'table' : 'cards';
      }
      if (typeof st.sortMode === 'string' && st.sortMode) {
        const v = (st.sortMode === 'oldest') ? 'oldest' : 'latest';
        sortMode = v;          // حدّث المتغير
        sortSelect.value = v;  // حدّث الـ UI
        sortSources(person, v); // طبّق الفرز فعلياً
      }

    }
  }

  // 3) الآن hasActiveFilters آمن لأنه يعتمد على عناصر معرفة مسبقاً
function hasActiveFilters() {
  const typeActive = (typeFilterSelect.value || 'all') !== 'all';
  const pinnedActive = (pinnedFilterSelect.value || 'all') !== 'all';

  const tagActive = (currentTagFilter || '').trim() !== '';
  const expiryActive = (expiryFocusMode || 'all') !== 'all';

  const advIssuerActive = (advIssuerInput.value || '').trim() !== '';
  const advConfActive = (advConfSelect.value || '').trim() !== '';
  const advConfidenceActive = (advConfidenceSelect.value || '').trim() !== '';
  const advVerifiedActive = (advVerifiedSelect.value || 'all') !== 'all';

  return (
    typeActive ||
    pinnedActive ||
    tagActive ||
    expiryActive ||
    advIssuerActive ||
    advConfActive ||
    advConfidenceActive ||
    advVerifiedActive
  );

}

// إظهار/إخفاء زر "إعادة ضبط الفلاتر" حسب وجود فلاتر مفعّلة
function syncClearFiltersBtnVisibility() {
  advClearBtn.style.display = hasActiveFilters() ? '' : 'none';
}

  // 4) أنشئ الكنترولر بعد تعريف كل شيء
  const filtersCtrl = createFiltersCollapseController({
    storageKey: FILTERS_COLLAPSE_LS_KEY,
    panelEl: toolsLeft,
    toggleBtnEl: filtersToggleBtn,
    hasActiveFilters,
    labels: { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
    iconHtml: '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
    onBlockedHide: () => {
      showWarning?.('لا يمكن إخفاء الفلاتر لأن هناك فلاتر مفعّلة حالياً. قم بإرجاعها للوضع الافتراضي أو اضغط "مسح الفلاتر" أولاً.');
    }
  });
  
filtersCtrl.applyInitialState({ autoOpenIfActive: true });
// طبّق الحالة الأولية لزر إعادة ضبط الفلاتر
syncClearFiltersBtnVisibility();

  // 5) Listener واحد فقط
  filtersToggleBtn.addEventListener('click', () => {
    filtersCtrl.toggle();
  });
  
// عرض (Cards / Table)

const viewToggleWrap = el(
  'div',
  'biosec-tools-field sources-tools-field sources-tools-field--view'
);

// (اختياري للوصولية) بدل عنوان/أيقونة:
viewToggleWrap.setAttribute('aria-label', 'تبديل طريقة العرض');

const viewToggle = el('div', 'sources-view-toggle');

const viewBtnCards = el('button', 'sources-view-btn is-active');
viewBtnCards.type = 'button';
viewBtnCards.dataset.mode = 'cards';
viewBtnCards.innerHTML =
  '<i class="fa-solid fa-table-cells-large" aria-hidden="true"></i><span>بطاقات</span>';

const viewBtnTable = el('button', 'sources-view-btn');
viewBtnTable.type = 'button';
viewBtnTable.dataset.mode = 'table';
viewBtnTable.innerHTML =
  '<i class="fa-solid fa-list-ul" aria-hidden="true"></i><span>جدول</span>';

viewToggle.append(viewBtnCards, viewBtnTable);

viewToggleWrap.append(viewToggle);

  const addBtn = el('button', 'biosec-add-btn sources-add-btn');
  addBtn.type = 'button';

toolsLeft.append(
  // 1) نوع الوثيقة
  wrapToolsLeftItem({
    title: 'نوع الوثيقة',
    icon: '<i class="fa-solid fa-filter" aria-hidden="true"></i>',
    child: typeFilterSelect,
    extraClass: 'sources-tools-field--type'
  }),
  
   // 2) الترتي
  wrapToolsLeftItem({
    title: 'الترتيب',
    icon: '<i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>',
    child: sortSelect,
    extraClass: 'sources-tools-field--sort'
  }),


  // 3) الأهمية
  wrapToolsLeftItem({
    title: 'الأهمية',
    icon: '<i class="fa-solid fa-thumbtack" aria-hidden="true"></i>',
    child: pinnedFilterSelect,
    extraClass: 'sources-tools-field--pinned'
  }),

  // 4) فلاتر متقدمة (من العام للأكثر تخصيصاً)
  wrapToolsLeftItem({
    title: 'الجهة',
    icon: '<i class="fa-solid fa-landmark" aria-hidden="true"></i>',
    child: advIssuerInput
  }),
  wrapToolsLeftItem({
    title: 'السرية',
    icon: '<i class="fa-solid fa-lock" aria-hidden="true"></i>',
    child: advConfSelect
  }),
  wrapToolsLeftItem({
    title: 'الاعتماد',
    icon: '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>',
    child: advConfidenceSelect
  }),
  wrapToolsLeftItem({
    title: 'توثيق',
    icon: '<i class="fa-solid fa-file-circle-check" aria-hidden="true"></i>',
    child: advVerifiedSelect
  }),

  // 5) إعادة ضبط الفلاتر
  wrapToolsLeftItem({
    title: '',
    icon: '',
    child: advClearBtn,
    extraClass: 'sources-tools-field--clear'
  })
);
toolsRight.append(filtersToggleBtn, searchWrap, viewToggleWrap, addBtn);

  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

// طبّق viewMode المسترجع (لو كان table مثلاً)
viewBtnCards.classList.toggle('is-active', viewMode === 'cards');
viewBtnTable.classList.toggle('is-active', viewMode === 'table');

  /* ----------------------------
     شريط الإحصاءات + شريط تنبيه الانتهاء
  ----------------------------- */

  const expiryBar = el('div', 'sources-expiry-bar');
  expiryBar.style.display = 'none';
  root.appendChild(expiryBar);

  const statsBar = el('div', 'sources-stats-bar');
  root.appendChild(statsBar);

  const list = el('div', 'biosec-list sources-list');
  root.appendChild(list);

  function updateAddButtonLabel() {
    ensureSources(person);
    const count = person.sources.length || 0;
    if (!count) {
      addBtn.innerHTML =
        '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة أول وثيقة</span>';
      addBtn.title = 'ابدأ بتوثيق أول شهادة/صك/وثيقة لهذا الشخص';
    } else {
      addBtn.innerHTML =
        '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة وثيقة جديدة</span>';
      addBtn.title = `هناك ${count} وثائق محفوظة حتى الآن`;
    }
  }

  function updateExpiryBar(allSources) {
    const sources = Array.isArray(allSources) ? allSources : [];
    let expired = 0;
    let near = 0;

    for (const s of sources) {
      const st = getExpiryStatus(s, Number(s?.expiryAlertDays) || DEFAULT_EXPIRY_ALERT_DAYS);
      if (st.status === 'expired') expired++;
      else if (st.status === 'near') near++;
    }

    if (!expired && !near) {
      expiryBar.textContent = '';
      expiryBar.style.display = 'none';
      expiryFocusMode = 'all';
      return;
    }

    expiryBar.style.display = '';

    expiryBar.innerHTML = '';
    const msg = el('div', 'sources-expiry-msg');
    msg.innerHTML =
      `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
       <span>تنبيه الصلاحية:</span>
       <strong>${expired}</strong> منتهية • <strong>${near}</strong> قريبة الانتهاء`;

    const actions = el('div', 'sources-expiry-actions');

    const btnAll = el('button', 'sources-expiry-btn' + (expiryFocusMode === 'all' ? ' is-active' : ''));
    btnAll.type = 'button';
    btnAll.textContent = 'عرض الكل';

    const btnExpired = el('button', 'sources-expiry-btn' + (expiryFocusMode === 'expired' ? ' is-active' : ''));
    btnExpired.type = 'button';
    btnExpired.textContent = 'المنتهية';

    const btnNear = el('button', 'sources-expiry-btn' + (expiryFocusMode === 'near' ? ' is-active' : ''));
    btnNear.type = 'button';
    btnNear.textContent = 'القريبة';

btnAll.onclick = () => {
  expiryFocusMode = 'all';
  syncClearFiltersBtnVisibility();
  persistSourcesFiltersState();
  renderList();
};
btnExpired.onclick = () => {
  expiryFocusMode = 'expired';
  syncClearFiltersBtnVisibility();
  persistSourcesFiltersState();
  renderList();
};
btnNear.onclick = () => {
  expiryFocusMode = 'near';
  syncClearFiltersBtnVisibility();
  persistSourcesFiltersState();
  renderList();
};

    actions.append(btnAll, btnExpired, btnNear);
    expiryBar.append(msg, actions);
  }

  function updateStatsBar(allSources) {
    if (!statsBar) return;
    const sources = Array.isArray(allSources) ? allSources : [];
    if (!sources.length) {
      statsBar.textContent = '';
      statsBar.style.display = 'none';
      return;
    }

    // إحصاءات موسعة
    let verifiedYes = 0;
    let verifiedNo = 0;
    let pinnedYes = 0;
    let noFiles = 0;

    const confCounts = { public: 0, private: 0, sensitive: 0, none: 0 };

    const typeCounts = {};
    for (const s of sources) {
      const t = (s.type || 'generic').trim() || 'generic';
      typeCounts[t] = (typeCounts[t] || 0) + 1;

      if (s.verified) verifiedYes++; else verifiedNo++;
      if (s.pinned) pinnedYes++;
      if (!Array.isArray(s.files) || s.files.length === 0) noFiles++;

      const c = (s.confidentiality || '').trim();
      if (!c) confCounts.none++;
      else if (c === 'public' || c === 'private' || c === 'sensitive') confCounts[c]++;
      else confCounts.none++;
    }

    const typePart = Object.entries(typeCounts)
      .map(([code, count]) => `${sourceType.getLabel(code) || code}: ${count}`)
      .join(' | ');

    const confPart =
      `سرية: عام ${confCounts.public} • خاص ${confCounts.private} • حساس ${confCounts.sensitive}`;

    const parts = [
      typePart,
      `موثّق ${verifiedYes} • غير موثّق ${verifiedNo}`,
      `مهم ${pinnedYes}`,
      confPart,
      `بدون ملفات ${noFiles}`
    ].filter(Boolean);

    statsBar.textContent = parts.join(' | ');
    statsBar.style.display = '';
  }

  /* ----------------------------
     تنبيه نقص وثائق (مثال ميلاد/وفاة)
  ----------------------------- */

  const missingWarningEl = el('div', 'sources-missing-warning');
  missingWarningEl.style.display = 'none';
  root.appendChild(missingWarningEl);

  function updateMissingSourcesWarning() {
    ensureSources(person);
    const sources = person.sources || [];

    const hasBirthDoc = sources.some(s => (s.type || '').trim() === 'birth');
    const hasDeathDoc = sources.some(s => (s.type || '').trim() === 'death');

    const hasBirthData = person.birthDate || person.birthYear || person.birthPlace || person.birth;
    const hasDeathData = person.deathDate || person.deathYear || person.deathPlace || person.death;

    const msgs = [];
    if (hasBirthData && !hasBirthDoc) {
      msgs.push('لا توجد وثيقة ميلاد موثقة لهذا الشخص. يمكنك إضافة شهادة الميلاد هنا.');
    }
    if (hasDeathData && !hasDeathDoc) {
      msgs.push('لا توجد وثيقة وفاة موثقة لهذا الشخص. يمكنك إضافة شهادة الوفاة هنا.');
    }

    if (!msgs.length) {
      missingWarningEl.textContent = '';
      missingWarningEl.style.display = 'none';
      return;
    }

    missingWarningEl.textContent = msgs.join(' ');
    missingWarningEl.style.display = '';
  }

  /* ----------------------------
     ميتاداتا ملفات idb:...
  ----------------------------- */

  function collectAllSourceRefs() {
    const out = [];
    const sources = Array.isArray(person?.sources) ? person.sources : [];
    for (const s of sources) out.push(...(Array.isArray(s?.files) ? s.files : []));
    return out;
  }

  async function warmSourceFileMetaCache(refs = []) {
    const list = Array.isArray(refs) ? refs : [];
    const need = list
      .map(r => String(r))
      .filter(r => isIdbRef(r) && !sourceFileMetaCache.has(r));

    if (!need.length) return false;
    if (typeof DB?.getSourceFileMeta !== 'function') return false;

    const results = await Promise.allSettled(
      need.map(r => DB.getSourceFileMeta(r).then(meta => ({ r, meta })))
    );

    let changed = false;
    for (const x of results) {
      if (x.status === 'fulfilled' && x.value?.meta) {
        sourceFileMetaCache.set(x.value.r, x.value.meta);
        changed = true;
      }
    }
    return changed;
  }

  async function ensureMetaForRef(ref) {
    const raw = String(ref || '');
    if (isTmpRef(raw)) {
      return sourceFileMetaCache.get(raw) || sourceTempCache.get(raw)?.meta || null;
    }
    if (!isIdbRef(raw)) return null;

    const cached = sourceFileMetaCache.get(raw);
    if (cached) return cached;

    if (typeof DB?.getSourceFileMeta !== 'function') return null;

    try {
      const meta = await DB.getSourceFileMeta(raw);
      if (meta) {
        sourceFileMetaCache.set(raw, meta);
        return meta;
      }
    } catch (e) {
      console.error('getSourceFileMeta failed', raw, e);
    }
    return null;
  }

  function getSourceFileKind(ref) {
    const raw = String(ref || '');

    if (isTmpRef(raw)) {
      const meta = sourceFileMetaCache.get(raw) || sourceTempCache.get(raw)?.meta || {};
      return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
    }

    if (isIdbRef(raw)) {
      const cached = sourceFileMetaCache.get(raw) || {};
      const kind = cached.kind || inferFileKind({ ext: cached.ext || '', mime: cached.mime || '', ref: raw });
      return kind || 'other';
    }

    return inferFileKind({ ref: raw, ext: getRefExt(raw) });
  }

  function classifyFileThumb(thumb, ref) {
    const raw = String(ref || '');

    thumb.classList.remove(
      'source-file-thumb--image', 'source-file-thumb--pdf', 'source-file-thumb--word', 'source-file-thumb--excel', 'source-file-thumb--other',
      'biosec-file-thumb--image', 'biosec-file-thumb--pdf', 'biosec-file-thumb--word', 'biosec-file-thumb--excel', 'biosec-file-thumb--other'
    );

    const applyCls = (kind, ext) => {
      const cls =
        kind === 'image' ? 'source-file-thumb--image' :
          kind === 'pdf' ? 'source-file-thumb--pdf' :
            kind === 'word' ? 'source-file-thumb--word' :
              kind === 'excel' ? 'source-file-thumb--excel' :
                'source-file-thumb--other';

      thumb.classList.add(cls);

      const sharedCls =
        cls === 'source-file-thumb--image' ? 'biosec-file-thumb--image' :
          cls === 'source-file-thumb--pdf' ? 'biosec-file-thumb--pdf' :
            cls === 'source-file-thumb--word' ? 'biosec-file-thumb--word' :
              cls === 'source-file-thumb--excel' ? 'biosec-file-thumb--excel' :
                'biosec-file-thumb--other';

      thumb.classList.add(sharedCls);

      if (ext) {
        const badge = el('span', 'biosec-file-ext source-file-ext');
        badge.textContent = String(ext).toUpperCase();
        thumb.appendChild(badge);
      }
    };

    if (isTmpRef(raw)) {
      const meta = sourceFileMetaCache.get(raw) || sourceTempCache.get(raw)?.meta || {};
      const kind = meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw });
      applyCls(kind, (meta.ext || '').toLowerCase());
      return;
    }

    if (isIdbRef(raw)) {
      const cached = sourceFileMetaCache.get(raw);

      if (!cached && typeof DB?.getSourceFileMeta === 'function') {
        DB.getSourceFileMeta(raw)
          .then(meta => {
            if (!meta) return;
            sourceFileMetaCache.set(raw, meta);
            thumb.innerHTML = '';
            classifyFileThumb(thumb, raw);
          })
          .catch(err => console.error('getSourceFileMeta failed', raw, err));
      }

      const meta = cached || {};
      const kind = meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw });
      applyCls(kind, (meta.ext || '').toLowerCase());
      return;
    }

    const ext = getRefExt(raw);
    const kind = inferFileKind({ ext, ref: raw });
    applyCls(kind, ext);
  }

  async function openOrDownloadRef(ref, { preferDownload = false, baseTitle = '', index = 0, total = 1 } = {}) {
    const preOpened = (!preferDownload) ? window.open('about:blank', '_blank') : null;
    if (preOpened) preOpened.opener = null;

    const url = await resolveSourceFileUrlLocal(ref);
    if (!url) {
      try { preOpened?.close(); } catch { }
      return;
    }

    const meta = await ensureMetaForRef(ref);
    const mime = meta?.mime || (sourceFileMetaCache.get(String(ref))?.mime || '');
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
     القلب: renderList
  ============================================================================ */

    // (A) تطبيق التنقل بعد إعادة الرسم (Bio Nav)
  function applyNavAfterRender() {
    const nav = handlers.__consumeBioNav?.();
    if (!nav) return;

    const sourceId = safeStr(nav.sourceId || nav.itemId || '');
    if (!sourceId) return;

    const card = list.querySelector(`.source-card[data-source-id="${sourceId}"]`);
    if (!card) return;

    try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    catch (e) { card.scrollIntoView(true); }

    card.classList.add('biosec-card--jump-highlight');
    setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);
  }

  async function renderList() {
    await warmSourceFileMetaCache(collectAllSourceRefs());

    list.innerHTML = '';
    ensureSources(person);

    updateSourcesCountBadge();
    updateAddButtonLabel();

    // إعادة بناء خيارات فلتر النوع حسب الأنواع المستخدمة
    {
      const usedTypesSet = new Set(
        (person.sources || [])
          .map(s => String(s.type || '').trim())
          .filter(Boolean)
      );
      const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';
      const nextValue = sourceType.rebuildSelectFromUsed(typeFilterSelect, usedTypesSet, prevValue, 'ar');
      currentTypeFilter = nextValue;
    }

    updateExpiryBar(person.sources);
    updateStatsBar(person.sources);
    updateMissingSourcesWarning();
    pinnedFilterSelect.value = pinnedFilterMode;

    // تطبيق البحث والتصفية
    const search = (currentSearchTerm || '').toLowerCase();

    const filtered = person.sources.filter(src => {
      const typeOk = currentTypeFilter === 'all' || !currentTypeFilter || (src.type || '') === currentTypeFilter;
      const tagOk = !currentTagFilter || (Array.isArray(src.tags) && src.tags.includes(currentTagFilter));
      const pinnedOk = (pinnedFilterMode !== 'pinned') || !!src.pinned;

      // فلتر انتهاء
      let expiryOk = true;
      if (expiryFocusMode !== 'all') {
        const st = getExpiryStatus(src, Number(src?.expiryAlertDays) || DEFAULT_EXPIRY_ALERT_DAYS);
        expiryOk = (expiryFocusMode === st.status);
      }

      // بحث سريع
      let textOk = true;
      if (search) {
        const hay = [
          src.title || '',
          src.issuer || '',
          src.referenceCode || '',
          src.note || '',
          src.holderName || '',
          src.nationalId || '',
          src.civilRegistryNo || ''
        ].join(' ').toLowerCase();
        textOk = hay.includes(search);
      }
let advOk = true;
      // بحث متقدم
      if (advIssuer) {
        const iss = (src.issuer || '').toLowerCase();
        advOk = advOk && iss.includes(advIssuer.toLowerCase());
      }
      if (advConfidentiality) {
        advOk = advOk && ((src.confidentiality || '').trim() === advConfidentiality);
      }
       if (advVerifiedMode === 'verified') {
        advOk = advOk && !!src.verified;
      } else if (advVerifiedMode === 'unverified') {
        advOk = advOk && !src.verified;
      }

      if (advConfidence) {
        advOk = advOk && ((src.confidenceLevel || '').trim() === advConfidence);
      }

      return typeOk && tagOk && pinnedOk && expiryOk && textOk && advOk;
    });

    if (!filtered.length) {
      const empty = el('div', 'biosec-empty sources-empty');
      empty.textContent = person.sources.length ? 'لا توجد وثائق مطابقة لخيارات التصفية الحالية.'
        : 'ابدأ بتسجيل الوثائق الرسمية: شهادة ميلاد، عقد زواج، صك ملكية أو وثائق هوية.';
      list.appendChild(empty);
      return;
    }

    /* ----------------------------
       وضع الجدول المختصر
    ----------------------------- */
if (viewMode === 'table') {
  const table = el('div', 'sources-table-view');

  const headerRow = el('div', 'sources-table-header');
  const h1 = el('div', 'sources-table-cell sources-table-cell--title'); h1.textContent = 'العنوان / النوع';
  const h2 = el('div', 'sources-table-cell sources-table-cell--meta');  h2.textContent = 'الجهة / المكان';
  const h3 = el('div', 'sources-table-cell sources-table-cell--meta');  h3.textContent = 'التاريخ / المرجع';

const h4 = el('div', 'sources-table-cell sources-table-cell--meta');
h4.textContent = 'الإجراء';

headerRow.append(h1, h2, h3, h4);
  table.appendChild(headerRow);

filtered.forEach((src) => {
  const row = el('div', 'sources-table-row');
  row.tabIndex = 0;
  row.dataset.sourceId = src.id;

  const typeLabel = sourceType.getLabel((src.type || '').trim());

  /* ===== العمود 1: العنوان + النوع + chips ===== */

  const filesCount = Array.isArray(src.files) ? src.files.length : 0;
  const st = getExpiryStatus(src, Number(src?.expiryAlertDays) || DEFAULT_EXPIRY_ALERT_DAYS);

  const chips = [];
  if (src.pinned) chips.push(`<span class="sources-chip" data-kind="pinned">مهم</span>`);
  if (src.verified) chips.push(`<span class="sources-chip" data-kind="verified">موثّق</span>`);
  if (src.confidentiality && src.confidentiality !== 'public') {
    chips.push(`<span class="sources-chip" data-kind="conf">${safeStr(CONFIDENTIALITY_LABELS[src.confidentiality] || 'خاص')}</span>`);
  }
  if (st.status === 'expired' || st.status === 'near') {
    chips.push(
      `<span class="sources-chip" data-kind="expiry" data-level="${st.status}">
        ${st.status === 'expired' ? 'منتهية'
          : (st.days === 0 ? 'تنتهي اليوم' : `قريبة (${st.days}ي)`)}
      </span>`
    );
  }
  if (filesCount) chips.push(`<span class="sources-chip" data-kind="files">📎 ${filesCount}</span>`);

  const rowTitle = el('div', 'sources-table-cell sources-table-cell--title');
rowTitle.setAttribute('data-label', 'العنوان / النوع');

  rowTitle.innerHTML = `
    <div class="sources-table-title">
      <div class="sources-table-title-line">
        <span class="sources-table-title-text">${safeStr(src.title || 'وثيقة بدون عنوان')}</span>
        ${typeLabel ? `<span class="sources-table-type">— ${safeStr(typeLabel)}</span>` : ''}
      </div>
      ${chips.length ? `<div class="sources-table-chips">${chips.join('')}</div>` : ''}
    </div>
  `;

  /* ===== العمود 2 ===== */
  const rowMeta1 = el('div', 'sources-table-cell sources-table-cell--meta');
  rowMeta1.setAttribute('data-label', 'الجهة / المكان');

  rowMeta1.textContent =
    [(src.issuer || '').trim(), (src.place || '').trim()]
      .filter(Boolean)
      .join(' • ');

  /* ===== العمود 3 ===== */
  const rowMeta2 = el('div', 'sources-table-cell sources-table-cell--meta');
  rowMeta2.setAttribute('data-label', 'التاريخ / المرجع');
  const dText = formatShortDateBadge(src.date || src.createdAt || src.updatedAt || null) || '';
  const ref = (src.referenceCode || '').trim();
  rowMeta2.textContent = [dText, ref].filter(Boolean).join(' • ');

/* ===== فتح البطاقة عند الضغط (FIX: await + scroll/highlight بدون nav) ===== */
const openRow = async () => {
  lastEditedId = null;

  await setViewMode('cards');

  const card = list.querySelector(`.source-card[data-source-id="${src.id}"]`);
  if (!card) return;

  try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  catch { card.scrollIntoView(true); }

  card.classList.add('biosec-card--jump-highlight');
  setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);
};



row.tabIndex = -1;      
row.style.cursor = 'default';

  /* ===== العمود 4: الإجراءات ===== */
const rowActions = el('div', 'sources-table-cell sources-table-cell--actions');
rowActions.setAttribute('data-label', 'الإجراء');

const btnOpen = el('button', 'sources-row-action');
btnOpen.type = 'button';
btnOpen.textContent = 'فتح';
btnOpen.onclick = (e) => {
  e.stopPropagation();
  openRow();
};

const btnDl = el('button', 'sources-row-action');
btnDl.type = 'button';
btnDl.textContent = 'تحميل';
btnDl.disabled = !(Array.isArray(src.files) && src.files.length);
btnDl.onclick = async (e) => {
  e.stopPropagation();

  const files = Array.isArray(src.files) ? src.files : [];
  if (!files.length) {
    showWarning?.('لا توجد أي ملفات مرفقة لهذه الوثيقة بعد.');
    return;
  }

  const baseTitle = (src.title || 'الوثيقة').trim() || 'الوثيقة';

  for (let i = 0; i < files.length; i++) {
    await openOrDownloadRef(files[i], {
      preferDownload: true,
      baseTitle,
      index: i,
      total: files.length
    });
  }
};

rowActions.append(btnOpen, btnDl);
rowActions.addEventListener('click', (e) => e.stopPropagation());

row.append(rowTitle, rowMeta1, rowMeta2, rowActions);
  table.appendChild(row);
});


  list.appendChild(table);
  return;
}

    /* ----------------------------
       وضع البطاقات
    ----------------------------- */
// helper: عدّاد الأحداث المرتبطة بهذه الوثيقة
function countLinkedEventsForSource(sourceId) {
  const sid = String(sourceId || '').trim();
  const evs = Array.isArray(person?.events) ? person.events : [];
  if (!sid || !evs.length) return 0;
  return evs.filter(ev =>
    Array.isArray(ev?.sourceIds) && ev.sourceIds.includes(sid)
  ).length;
}

    // helper: عدّاد التعليم المرتبط بهذه الوثيقة
function countLinkedEducationForSource(sourceId) {
  const sid = String(sourceId || '').trim();
  const items = Array.isArray(person?.education) ? person.education : [];
  if (!sid || !items.length) return 0;

  return items.filter(it =>
    Array.isArray(it?.sourceIds) && it.sourceIds.includes(sid)
  ).length;
}
    
// helper: عدّاد الوظائف المرتبطة بهذه الوثيقة
function countLinkedCareerForSource(sourceId) {
  const sid = String(sourceId || '').trim();
  const items = Array.isArray(person?.career) ? person.career : [];
  if (!sid || !items.length) return 0;

  return items.filter(it =>
    Array.isArray(it?.sourceIds) && it.sourceIds.includes(sid)
  ).length;
}

// helper: عدّاد القصص المرتبطة بهذه الوثيقة
function countLinkedStoriesForSource(sourceId) {
  const sid = String(sourceId || '').trim();
  const items = Array.isArray(person?.stories) ? person.stories : [];
  if (!sid || !items.length) return 0;

  return items.filter(it =>
    Array.isArray(it?.sourceIds) && it.sourceIds.includes(sid)
  ).length;
}

    filtered.forEach((src, index) => {
      const serial = index + 1;

      const card = el('article', 'biosec-card source-card');
      card.dataset.sourceId = src.id;

      const indexBadge = el('div', 'biosec-card-index source-card-index');
      indexBadge.textContent = `الوثيقة ${serial}`;

      let pinnedBadge = null;
      if (src.pinned) {
        pinnedBadge = el('div', 'biosec-pinned-badge source-pinned-badge');
        pinnedBadge.textContent = 'وثيقة مهمة';
        card.classList.add('biosec-card--pinned');
      }

      const topRow = el('div', 'biosec-card-top source-card-top');
      topRow.appendChild(indexBadge);
      if (pinnedBadge) topRow.appendChild(pinnedBadge);
      card.appendChild(topRow);

      // Snapshot للمقارنة
      const original = {
        title: src.title || '',
        type: (src.type || '').trim(),
        forField: (src.forField || '').trim(),
        date: src.date || null,
        place: (src.place || '').trim(),
        referenceCode: (src.referenceCode || '').trim(),
        issuer: (src.issuer || '').trim(),
        pages: (src.pages || '').trim(),
        files: Array.isArray(src.files) ? [...src.files] : [],
        tags: Array.isArray(src.tags) ? [...src.tags] : [],
        note: (src.note || '').trim(),
        pinned: !!src.pinned,

        confidenceLevel: (src.confidenceLevel || '').trim(),
        relatedEventId: src.relatedEventId || null,
        verified: !!src.verified,
        verifiedBy: (src.verifiedBy || '').trim(),
        verifiedAt: src.verifiedAt || null,
        confidentiality: (src.confidentiality || '').trim(),

        // جديد
        validUntil: src.validUntil || null,
        expiryAlertDays: Number.isFinite(Number(src.expiryAlertDays)) ? Number(src.expiryAlertDays) : DEFAULT_EXPIRY_ALERT_DAYS,
        holderName: (src.holderName || '').trim(),
        nationalId: (src.nationalId || '').trim(),
        civilRegistryNo: (src.civilRegistryNo || '').trim(),

        history: Array.isArray(src.history) ? src.history.map(h => ({ ...h })) : []
      };

let currentFiles = Array.isArray(original.files) ? [...original.files] : [];

      let isEditing =
        (lastEditedId === src.id) ||
        (draftNewMap.has(src.id) && isEmptySourceDraft(src));

      let isDirty = false;
      let pendingDeletedFiles = [];

/* ----------------------------
   المعاينة
----------------------------- */

const previewBox = el('div', 'biosec-preview source-preview');

/** 1) العنوان + أيقونات الحالة بجانبه */
const previewHead = el('div', 'source-preview-head');

const previewTitle = el('div', 'biosec-preview-title source-preview-title');
previewTitle.textContent = original.title || 'وثيقة بدون عنوان';

// القفل (سرّية) ممتاز مكانه عند العنوان
if (original.confidentiality && original.confidentiality !== 'public') {
  const lockIcon = el('span', 'source-lock-icon');
  lockIcon.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
  previewTitle.appendChild(lockIcon);
}

// إذا “منتهية/قريبة” تظهر جنب العنوان كبادج واضح
const titleBadges = el('div', 'source-title-badges');

{
  const st = getExpiryStatus(original, original.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS);
  if (st.status === 'expired' || st.status === 'near') {
    const b = el('span', 'biosec-badge source-badge source-badge--expiry');
    b.dataset.level = st.status;
    b.textContent =
      st.status === 'expired' ? 'منتهية'
        : (st.days === 0 ? 'تنتهي اليوم' : `قريبة (${st.days} يوم)`);
    titleBadges.appendChild(b);
  }
}

previewHead.append(previewTitle, titleBadges);

/** 2) سطر ميتا واحد فقط (بدون تكرار): نوع • تاريخ • جهة • رقم (+ اختياري مكان) */
const previewMetaLine = el('div', 'source-preview-meta-line');

const typeLabel = sourceType.getLabel((original.type || '').trim());
const dateBadge = formatShortDateBadge(original.date) || 'بدون تاريخ';
const metaParts = [
  typeLabel || null,
  dateBadge || null,
  (original.issuer || '').trim() || null,
  (original.referenceCode || '').trim() || null,
  // (اختياري) المكان يكون آخر شيء ثانوي أو ضمن نفس السطر:
  (original.place || '').trim() || null
].filter(Boolean);

previewMetaLine.textContent = metaParts.join(' • ');

let idInfoEl = null;

const t = (original.type || '').trim();
const isIdType = (t === 'id' || t === 'birth');

if (isIdType) {
  const rows = [
    ['اسم صاحب الوثيقة', (original.holderName || '').trim()],
    ['رقم الهوية', (original.nationalId || '').trim()],
    ['رقم السجل المدني', (original.civilRegistryNo || '').trim()]
  ].filter(([, val]) => String(val || '').trim());

  if (rows.length) {
    idInfoEl = el('div', 'source-preview-idinfo');

    rows.forEach(([k, v]) => {
      const r = el('div', 'source-preview-idrow');
      const kk = el('span', 'source-preview-idkey');
      kk.textContent = k + ':';
      const vv = el('span', 'source-preview-idval');
      vv.textContent = v;
      r.append(kk, vv);
      idInfoEl.appendChild(r);
    });
  }
}


/** 3) بادجات الحالة فقط (Status chips) بالترتيب: expiry → verified → confidentiality → confidence */
const statusChips = el('div', 'source-status-chips');

{
  const st = getExpiryStatus(original, original.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS);
  if (st.status === 'expired' || st.status === 'near') {
    const b = el('span', 'biosec-badge source-badge source-badge--expiry');
    b.dataset.level = st.status;
    b.textContent =
      st.status === 'expired' ? 'منتهية الصلاحية'
        : (st.days === 0 ? 'تنتهي اليوم' : `قريبة الانتهاء (${st.days} يوم)`);
    statusChips.appendChild(b);
  }
}

// verified
if (original.verified) {
  const b = el('span', 'biosec-badge source-badge source-badge--verified');
  b.textContent = 'موثّق';
  statusChips.appendChild(b);
}

// confidentiality
if (original.confidentiality) {
  const confCode = original.confidentiality;
  const b = el('span', 'biosec-badge source-badge source-badge--confidentiality');
  b.dataset.level = confCode;
  b.textContent = CONFIDENTIALITY_LABELS[confCode] || 'خصوصية غير محددة';
  statusChips.appendChild(b);
}

// confidence
if (original.confidenceLevel) {
  const lvl = original.confidenceLevel;
  const b = el('span', 'biosec-badge source-badge source-badge--confidence');
  b.dataset.level = lvl;
  b.textContent = CONFIDENCE_LEVEL_LABELS[lvl] || 'اعتماد غير محدد';
  statusChips.appendChild(b);
}

/** 4) ملخص/الوصف (previewNote) */
const previewNote = el('div', 'biosec-preview-text source-preview-note');
previewNote.textContent =
  original.note ||
  'لم تُكتب ملاحظات عن هذه الوثيقة بعد. يمكنك فتح وضع التحرير لإضافة وصف مختصر.';

/** 5) الوسوم */
const tagsWrap = el('div', 'biosec-tags-list source-tags-list');
if (original.tags && original.tags.length) {
  original.tags.forEach(tag => {
    const chip = el(
      'button',
      'biosec-tag-chip source-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
    );
    chip.type = 'button';
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      currentTagFilter = currentTagFilter === tag ? '' : tag;
      syncClearFiltersBtnVisibility();
      persistSourcesFiltersState();
      renderList();
    });
    tagsWrap.appendChild(chip);
  });
}

/** 6) المرفقات (مصغرات + زر الشرائح) */
const previewFilesWrap = el('div', 'biosec-images-thumbs source-preview-images');

const sliderBtn = el('button', 'biosec-images-slider-btn source-files-slider-btn');
sliderBtn.type = 'button';
sliderBtn.innerHTML = '<i class="fa-solid fa-images" aria-hidden="true"></i> <span>عرض الصور كشرائح</span>';

/** 7) الإجراءات (تحميل) */
const actionsWrap = el('div', 'source-actions');

const downloadBtn = el('button', 'source-download-btn');
downloadBtn.type = 'button';

const filesCount = Array.isArray(original.files) ? original.files.length : 0;
const downloadLabel = filesCount > 1 ? 'تحميل الوثائق' : 'تحميل الوثيقة';

downloadBtn.innerHTML =
  `<span class="source-download-btn-icon"><i class="fa-solid fa-download" aria-hidden="true"></i></span><span>${downloadLabel}</span>`;

downloadBtn.addEventListener('click', async () => {
  if (!original.files || !original.files.length) {
    showWarning?.('لا توجد أي ملفات مرفقة لهذه الوثيقة بعد.');
    return;
  }
  const files = original.files;
  const baseTitle = (original.title || 'الوثيقة').trim() || 'الوثيقة';

  for (let i = 0; i < files.length; i++) {
    await openOrDownloadRef(files[i], { preferDownload: true, baseTitle, index: i, total: files.length });
  }
});

if (filesCount) actionsWrap.append(downloadBtn);

// زر عرض الأحداث المرتبطة (يظهر فقط إذا يوجد أحداث)
const linkedCount = countLinkedEventsForSource(src.id);

if (linkedCount > 0) {
  const viewLinkedBtn = el('button', 'source-view-linked-btn source-view-linked-events-btn');
  viewLinkedBtn.type = 'button';
  viewLinkedBtn.innerHTML =
    `<span class="source-view-linked-icon"><i class="fa-solid fa-link" aria-hidden="true"></i></span>
     <span>عرض الأحداث المرتبطة (${linkedCount})</span>`;

  viewLinkedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onBioShortcutClick?.('timeline', { sourceId: src.id });
  });

  actionsWrap.append(viewLinkedBtn);
}

// زر عرض التعليم المرتبط (يظهر فقط إذا يوجد عناصر تعليم مرتبطة)
const linkedEduCount = countLinkedEducationForSource(src.id);

if (linkedEduCount > 0) {
  const viewEduBtn = el('button', 'source-view-linked-btn source-view-linked-education-btn');
  viewEduBtn.type = 'button';
  viewEduBtn.innerHTML =
    `<span class="source-view-linked-icon"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i></span>
     <span>عرض التعليم المرتبط (${linkedEduCount})</span>`;

  viewEduBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onBioShortcutClick?.('education', { sourceId: src.id });
  });

  actionsWrap.append(viewEduBtn);
}

// زر عرض الوظائف المرتبطة (يظهر فقط إذا يوجد عناصر وظيفة مرتبطة)
const linkedCareerCount = countLinkedCareerForSource(src.id);

if (linkedCareerCount > 0) {
  const viewCareerBtn = el('button', 'source-view-linked-btn source-view-linked-career-btn');
  viewCareerBtn.type = 'button';
  viewCareerBtn.innerHTML =
    `<span class="source-view-linked-icon"><i class="fa-solid fa-briefcase" aria-hidden="true"></i></span>
     <span>عرض الوظائف المرتبطة (${linkedCareerCount})</span>`;

  viewCareerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onBioShortcutClick?.('career', { sourceId: src.id });
  });

  actionsWrap.append(viewCareerBtn);
}

      // زر عرض القصص المرتبطة (يظهر فقط إذا يوجد قصص مرتبطة)
const linkedStoriesCount = countLinkedStoriesForSource(src.id);

if (linkedStoriesCount > 0) {
  const viewStoriesBtn = el('button', 'source-view-linked-btn source-view-linked-stories-btn');
  viewStoriesBtn.type = 'button';
  viewStoriesBtn.innerHTML =
    `<span class="source-view-linked-icon"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span>
     <span>عرض القصص المرتبطة (${linkedStoriesCount})</span>`;

  viewStoriesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onBioShortcutClick?.('stories', { sourceId: src.id });
  });

  actionsWrap.append(viewStoriesBtn);
}

/** (اختياري) تاريخ الإضافة + آخر تعديل + طول الوصف (ثانوي) */
const previewMeta = el('div', 'biosec-preview-meta source-preview-meta source-preview-meta--secondary');

const createdLabel = el('span', 'biosec-preview-date source-preview-date');
createdLabel.textContent = src.createdAt ? formatCreatedAtLabel(src.createdAt, 'أضيفت', formatFullDateTime)
  : '';

// آخر تعديل
const updatedLabel = el('span', 'biosec-preview-date source-preview-date source-preview-date--updated');
updatedLabel.textContent = src.updatedAt ? `آخر تعديل: ${formatFullDateTime(src.updatedAt)}`
  : '';


const lengthLabel = el('span', 'biosec-length-chip source-length-chip');
const lenInfo = getSourceNoteLengthInfo(original.note.length);

if (lenInfo.level === 0) {
  lengthLabel.textContent = 'بدون وصف';
} else {
  const meter = el('span', 'biosec-length-meter source-length-meter');
  meter.dataset.level = String(lenInfo.level);
  const bar = el('span', 'biosec-length-meter-bar source-length-meter-bar');
  meter.appendChild(bar);
  const txtSpan = el('span');
  txtSpan.textContent = lenInfo.label;
  lengthLabel.innerHTML = '';
  lengthLabel.append(meter, txtSpan);
}

previewMeta.append(createdLabel, lengthLabel, updatedLabel);

/* إعادة استخدام دالة العرض الحالية للمرفقات */
function renderPreviewFiles() {
  previewFilesWrap.innerHTML = '';

  const orderedRefs = groupRefsByKind(original.files || [], getSourceFileKind);
  const images = orderedRefs.filter(r => getSourceFileKind(r) === 'image');
  const others = orderedRefs.filter(r => getSourceFileKind(r) !== 'image');
  const hasTwoGroups = images.length && others.length;

  if (hasTwoGroups && images.length) {
    const gt = makeGroupTitle('الصور');
    gt.classList.add('biosec-files-group-title', 'source-files-group-title');
    previewFilesWrap.appendChild(gt);
  }

  const renderThumb = (ref, idx, totalRefs, imagesOnly) => {
    const thumb = el('div', 'biosec-image-thumb biosec-file-thumb source-file-thumb source-file-thumb--preview');
    classifyFileThumb(thumb, ref);

    const kind = getSourceFileKind(ref);
    const isDoc = (kind === 'word' || kind === 'excel');

    const footerRow = el('div', 'biosec-file-thumb-footer source-file-thumb-footer');
    const label = el('span', 'biosec-file-label source-file-label');
    label.textContent =
      kind === 'image' ? 'صورة' :
      kind === 'pdf' ? 'PDF' :
      kind === 'word' ? 'Word' :
      kind === 'excel' ? 'Excel' : 'ملف';

    const actionBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view source-file-thumb-view');
    actionBtn.type = 'button';
    actionBtn.textContent = kind === 'image' ? 'معاينة' : (isDoc ? 'تحميل' : 'فتح');

    footerRow.append(label, actionBtn);

    if (kind === 'image') {
      const imgEl = el('img');
      imgEl.alt = 'صورة مرفقة';
      resolveSourceFileUrlLocal(ref).then(url => { if (url) imgEl.src = url; });

      const imageIndex = findImageIndex(imagesOnly, ref);

      actionBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
      });
      imgEl.addEventListener('click', () => {
        if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
      });

      thumb.append(imgEl, footerRow);
    } else {
      const icon = el('div', 'biosec-file-icon source-file-icon');
      icon.innerHTML = {
        pdf: '<i class="fa-solid fa-file-pdf"></i>',
        word: '<i class="fa-solid fa-file-word"></i>',
        excel: '<i class="fa-solid fa-file-excel"></i>',
        other: '<i class="fa-solid fa-file"></i>'
      }[kind] || '<i class="fa-solid fa-file"></i>';

      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDoc) {
          openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'الوثيقة', index: idx, total: totalRefs });
          return;
        }
        openInNewTabSafe(resolveSourceFileUrlLocal(ref));
      });

      thumb.style.cursor = 'pointer';
      thumb.addEventListener('click', (e) => {
        if (e.target === actionBtn) return;
        if (isDoc) {
          openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'الوثيقة', index: idx, total: totalRefs });
        } else {
          openInNewTabSafe(resolveSourceFileUrlLocal(ref));
        }
      });

      thumb.append(icon, footerRow);
    }

    previewFilesWrap.appendChild(thumb);
  };

  images.forEach((ref, idx) => renderThumb(ref, idx, images.length, images));

  sliderBtn.style.display = images.length < 2 ? 'none' : '';
  sliderBtn.onclick = () => {
    if (images.length < 2) return;
    openSourceSlider(images, 0, resolveSourceFileUrlLocal);
  };

  if (images.length) {
    const sliderRow = el('div', 'biosec-files-slider-row source-files-slider-row');
    sliderRow.appendChild(sliderBtn);
    previewFilesWrap.appendChild(sliderRow);
  } else {
    sliderBtn.style.display = 'none';
  }

  if (hasTwoGroups) {
    const div = makeDivider();
    div.classList.add('biosec-files-group-divider', 'source-files-group-divider');
    previewFilesWrap.appendChild(div);

    const gt2 = makeGroupTitle('الملفات');
    gt2.classList.add('biosec-files-group-title', 'source-files-group-title');
    previewFilesWrap.appendChild(gt2);
  }

  others.forEach((ref, idx) => renderThumb(ref, idx, others.length, images));
}

renderPreviewFiles();

/** التجميع النهائي حسب الترتيب المطلوب */
previewBox.append(previewHead, previewMetaLine);

if (idInfoEl) previewBox.appendChild(idInfoEl);

previewBox.append(
  statusChips,
  previewNote,
  tagsWrap,
  actionsWrap,
  previewMeta
);
previewBox.appendChild(previewFilesWrap);

card.appendChild(previewBox);

      /* ----------------------------
         التحرير
      ----------------------------- */

      const editBox = el('div', 'biosec-edit source-edit');
      const head = el('div', 'biosec-head source-head');

      const titleInput = el('input', 'biosec-title-input source-title-input');
      titleInput.type = 'text';
      titleInput.name = `source_title_${src.id}`;
      titleInput.placeholder = 'اسم الوثيقة (مثلاً: شهادة ميلاد، صك ملكية...)';
      titleInput.value = original.title;

      // عنوان + أيقونة مثل بقية الحقول (بدلاً من source-edit-icon)
      const titleField = el('div', 'biosec-meta-field source-meta-field source-title-field');
      const titleLabel = el('div', 'biosec-meta-label source-meta-label');
      titleLabel.innerHTML =
        '<span class="biosec-meta-icon source-meta-icon"><i class="fa-solid fa-file-signature" aria-hidden="true"></i></span> عنوان الوثيقة';
      titleField.append(titleLabel, titleInput);

      const dates = el('div', 'biosec-dates source-dates');
      dates.textContent = src.createdAt ? formatCreatedAtLabel(src.createdAt, 'أضيفت', formatFullDateTime) : '';

head.append(dates);

      editBox.appendChild(head);

      const body = el('div', 'biosec-body source-body');
      const metaRow = el('div', 'biosec-meta-row source-meta-row');
const primaryTitle = el('div', 'biosec-subtitle source-edit-subtitle');
primaryTitle.innerHTML =
  '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' +
  '<span>بينات أساسية</span>';

metaRow.classList.add('source-meta-row--primary');

const detailsTitle = el('div', 'biosec-subtitle source-edit-subtitle');
detailsTitle.innerHTML =
  '<i class="fa-solid fa-list-check" aria-hidden="true"></i> ' +
  '<span>تفاصيل إضافية</span>';

const detailsRow = el('div', 'biosec-meta-row source-meta-row source-meta-row--details');

      const typeSelect = el('select', 'biosec-select source-type-select');
      typeSelect.name = `source_type_${src.id}`;
      SOURCE_TYPE_OPTIONS.filter(([val]) => val && val !== 'all').forEach(([val, label]) => {
        const opt = el('option'); opt.value = val; opt.textContent = label; typeSelect.appendChild(opt);
      });
      typeSelect.value = original.type || 'generic';

      const typeField = el('div', 'biosec-meta-field source-meta-field');
      const typeLabelBox = el('div', 'biosec-meta-label source-meta-label');
      typeLabelBox.innerHTML =
        '<span class="biosec-meta-icon source-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الوثيقة';
      typeField.append(typeLabelBox, typeSelect);

      const dateInput = el('input', 'biosec-input biosec-date-input source-date-input');
      dateInput.type = 'date';
      dateInput.name = `source_date_${src.id}`;
      dateInput.value = original.date || '';

      const dateField = el('div', 'biosec-meta-field source-meta-field');
      const dateLabel = el('div', 'biosec-meta-label source-meta-label');
      dateLabel.innerHTML =
        '<span class="biosec-meta-icon source-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الوثيقة';
      dateField.append(dateLabel, dateInput);

      const placeInput = el('input', 'biosec-input biosec-place-input source-place-input');
      placeInput.type = 'text';
      placeInput.name = `source_place_${src.id}`;
      placeInput.placeholder = 'مكان الإصدار (مدينة / دولة)...';
      placeInput.value = original.place;

      const placeField = el('div', 'biosec-meta-field source-meta-field');
      const placeLabel = el('div', 'biosec-meta-label source-meta-label');
      placeLabel.innerHTML =
        '<span class="biosec-meta-icon source-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> مكان الإصدار';
      placeField.append(placeLabel, placeInput);

      const forFieldInput = el('input', 'biosec-input source-for-field-input');
      forFieldInput.type = 'text';
      forFieldInput.name = `source_for_${src.id}`;
      forFieldInput.placeholder = 'هذه الوثيقة متعلقة بماذا؟ (مثلاً: الميلاد، الزواج، النسب...)';
      forFieldInput.value = original.forField;

      const referenceInput = el('input', 'biosec-input source-reference-input');
      referenceInput.type = 'text';
      referenceInput.name = `source_ref_${src.id}`;
      referenceInput.placeholder = 'رقم الصك / رقم الوثيقة / رقم المعاملة...';
      referenceInput.value = original.referenceCode;

      const issuerInput = el('input', 'biosec-input source-issuer-input');
      issuerInput.type = 'text';
      issuerInput.name = `source_issuer_${src.id}`;
      issuerInput.placeholder = 'الجهة المصدرة (مثلاً: وزارة العدل، الأحوال المدنية...)';
      issuerInput.value = original.issuer;

      const pagesInput = el('input', 'biosec-input source-pages-input');
      pagesInput.type = 'text';
      pagesInput.name = `source_pages_${src.id}`;
      pagesInput.placeholder = 'عدد الصفحات أو نطاقها (اختياري)';
      pagesInput.value = original.pages;

      const confidenceSelect = el('select', 'biosec-select source-confidence-select');
      confidenceSelect.name = `source_confidence_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['official', CONFIDENCE_LEVEL_LABELS.official],
        ['family', CONFIDENCE_LEVEL_LABELS.family],
        ['oral', CONFIDENCE_LEVEL_LABELS.oral],
        ['copy', CONFIDENCE_LEVEL_LABELS.copy]
      ].forEach(([val, label]) => {
        const opt = el('option'); opt.value = val; opt.textContent = label; confidenceSelect.appendChild(opt);
      });
      confidenceSelect.value = original.confidenceLevel || '';

      const confidentialitySelect = el('select', 'biosec-select source-confidentiality-select');
      confidentialitySelect.name = `source_confidentiality_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['public', CONFIDENTIALITY_LABELS.public],
        ['private', CONFIDENTIALITY_LABELS.private],
        ['sensitive', CONFIDENTIALITY_LABELS.sensitive]
      ].forEach(([val, label]) => {
        const opt = el('option'); opt.value = val; opt.textContent = label; confidentialitySelect.appendChild(opt);
      });
      confidentialitySelect.value = original.confidentiality || '';

      const verifiedCheckbox = el('input');
      verifiedCheckbox.type = 'checkbox';
      verifiedCheckbox.name = `source_verified_${src.id}`;
      verifiedCheckbox.checked = original.verified;

      const verifiedByInput = el('input', 'biosec-input source-verified-by-input');
      verifiedByInput.type = 'text';
      verifiedByInput.name = `source_verified_by_${src.id}`;
      verifiedByInput.placeholder = 'تم التوثيق بواسطة من؟ (مثلاً: كبير الأسرة، جهة رسمية)';
      verifiedByInput.value = original.verifiedBy;

      const verifiedAtInput = el('input', 'biosec-input biosec-date-input source-verified-at-input');
      verifiedAtInput.type = 'date';
      verifiedAtInput.name = `source_verified_at_${src.id}`;
      verifiedAtInput.value = original.verifiedAt || '';

// حالة التحقق (Checkbox فقط)
const verifiedWrap = el('div', 'biosec-meta-field source-details-field');

const verifiedLabel = el('div', 'source-details-label');
verifiedLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-file-circle-check" aria-hidden="true"></i></span> حالة التحقق من الوثيقة';

const verifiedInlineTop = el('div', 'source-verified-inline');
const verifiedChkLabel = el('label', 'source-verified-check-label');
verifiedChkLabel.append(verifiedCheckbox, textEl('span', 'تم التحقق من صحة هذا المصدر'));
verifiedInlineTop.append(verifiedChkLabel);

verifiedWrap.append(verifiedLabel, verifiedInlineTop);

// حقول منفصلة (ليتم ترتيبها بعد السرية)
const verifiedByWrap = el('div', 'biosec-meta-field source-details-field');
const verifiedByLabel = el('div', 'biosec-meta-label source-details-label');
verifiedByLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-user-check" aria-hidden="true"></i></span> تم التوثيق بواسطة';
verifiedByWrap.append(verifiedByLabel, verifiedByInput);

const verifiedAtWrap = el('div', 'biosec-meta-field source-details-field');
const verifiedAtLabel = el('div', 'biosec-meta-label source-details-label');
verifiedAtLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i></span> تاريخ التوثيق';
verifiedAtWrap.append(verifiedAtLabel, verifiedAtInput);

      // جديد: صلاحية/انتهاء + عدد أيام التنبيه
      const validUntilInput = el('input', 'biosec-input biosec-date-input source-valid-until-input');
      validUntilInput.type = 'date';
      validUntilInput.name = `source_valid_until_${src.id}`;
      validUntilInput.value = original.validUntil || '';

      const alertDaysInput = el('input', 'biosec-input source-expiry-alert-days');
      alertDaysInput.name = 'source-expiry-alert-days';

      alertDaysInput.type = 'number';
      alertDaysInput.min = '1';
      alertDaysInput.max = '3650';
      alertDaysInput.placeholder = String(DEFAULT_EXPIRY_ALERT_DAYS);
      alertDaysInput.value = String(original.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS);

// تاريخ الانتهاء
const validUntilWrap = el('div', 'biosec-meta-field source-details-field');
const validUntilLabel = el('div', 'biosec-meta-label source-details-label');
validUntilLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i></span> تاريخ الانتهاء';
validUntilWrap.append(validUntilLabel, validUntilInput);

// تنبيه قبل أيام
const alertDaysWrap = el('div', 'biosec-meta-field source-details-field');
const alertDaysLabel = el('div', 'biosec-meta-label source-details-label');
alertDaysLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-bell" aria-hidden="true"></i></span> تنبيه قبل (أيام)';
alertDaysWrap.append(alertDaysLabel, alertDaysInput);

      // حقول الهوية/الميلاد (ديناميكي حسب النوع)
      const holderNameInput = el('input', 'biosec-input source-holder-name-input');
      holderNameInput.name = 'source-holder-name-input';
      holderNameInput.type = 'text';
      holderNameInput.placeholder = 'اسم صاحب الوثيقة';
      holderNameInput.value = original.holderName;

      const nationalIdInput = el('input', 'biosec-input source-national-id-input');
      nationalIdInput.name = 'source-national-id-input';
      nationalIdInput.type = 'text';
      nationalIdInput.placeholder = 'رقم الهوية';
      nationalIdInput.value = original.nationalId;

      const civilRegistryInput = el('input', 'biosec-input source-civil-registry-input');
      civilRegistryInput.name = 'source-civil-registry-input';
      civilRegistryInput.type = 'text';
      civilRegistryInput.placeholder = 'رقم السجل المدني';
      civilRegistryInput.value = original.civilRegistryNo;

const holderNameWrap = el('div', 'biosec-meta-field source-details-field');
const holderNameLabel = el('div', 'biosec-meta-label source-details-label');
holderNameLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-user" aria-hidden="true"></i></span> اسم صاحب الوثيقة';
holderNameWrap.append(holderNameLabel, holderNameInput);

const nationalIdWrap = el('div', 'biosec-meta-field source-details-field');
const nationalIdLabel = el('div', 'biosec-meta-label source-details-label');
nationalIdLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-id-card" aria-hidden="true"></i></span> رقم الهوية';
nationalIdWrap.append(nationalIdLabel, nationalIdInput);

const civilRegistryWrap = el('div', 'biosec-meta-field source-details-field');
const civilRegistryLabel = el('div', 'biosec-meta-label source-details-label');
civilRegistryLabel.innerHTML =
  '<span class="source-details-icon"><i class="fa-solid fa-hashtag" aria-hidden="true"></i></span> رقم السجل المدني';
civilRegistryWrap.append(civilRegistryLabel, civilRegistryInput);

function toggleIdFields() {
  const t = (typeSelect.value || '').trim();
  const show = (t === 'id' || t === 'birth');

  holderNameWrap.style.display = show ? '' : 'none';
  nationalIdWrap.style.display = show ? '' : 'none';
  civilRegistryWrap.style.display = show ? '' : 'none';
}
toggleIdFields();

      const noteInput = el('textarea', 'biosec-textarea source-note-input');
      noteInput.name = `source_note_${src.id}`;
      noteInput.placeholder = 'ملخص محتوى الوثيقة، أو ما يثبته هذا المستند من معلومات.';
      noteInput.value = original.note;

      const tagsInput = el('input', 'biosec-tags-input source-tags-input');
      tagsInput.type = 'text';
      tagsInput.name = `source_tags_${src.id}`;
      tagsInput.placeholder = 'وسوم الوثيقة (مثال: ميلاد, رسمي, محكمة)';
      tagsInput.value = original.tags.join(', ');

      // جديد: اقتراح وسوم ذكية
      const tagSuggestWrap = el('div', 'sources-tag-suggest');
      const tagSuggestLabel = el('div', 'sources-tag-suggest-label');
      tagSuggestLabel.innerHTML =
        '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> اقتراح وسوم';

      const tagSuggestChips = el('div', 'sources-tag-suggest-chips');
      tagSuggestWrap.append(tagSuggestLabel, tagSuggestChips);

      function computeTagSuggestions() {
        const t = (typeSelect.value || '').trim();
        const iss = (issuerInput.value || '').trim();

        const sugg = new Set();

        // حسب النوع
        if (t === 'birth') {
          ['ميلاد', 'أحوال', 'رسمي'].forEach(x => sugg.add(x));
        }
        if (t === 'id') {
          ['هوية', 'رسمي'].forEach(x => sugg.add(x));
        }
        if (t === 'marriage') {
          ['زواج', 'عقد', 'رسمي'].forEach(x => sugg.add(x));
        }
        if (t === 'death') {
          ['وفاة', 'رسمي'].forEach(x => sugg.add(x));
        }

        // حسب الجهة
        if (iss.includes('وزارة العدل')) {
          ['عدلي', 'محكمة'].forEach(x => sugg.add(x));
        }
        if (iss.includes('الأحوال') || iss.includes('الأحوال المدنية')) {
          ['أحوال', 'مدني'].forEach(x => sugg.add(x));
        }

        // استبعاد الموجود
        const existing = new Set(splitCommaTags(tagsInput.value).map(x => x.trim()));
        const out = [...sugg].filter(x => x && !existing.has(x));

        return out.slice(0, 8);
      }

      function renderTagSuggestions() {
        tagSuggestChips.innerHTML = '';
        const sugg = computeTagSuggestions();
        if (!sugg.length) {
          tagSuggestWrap.style.display = 'none';
          return;
        }
        tagSuggestWrap.style.display = '';

        sugg.forEach(tag => {
          const chip = el('button', 'sources-tag-suggest-chip');
          chip.type = 'button';
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            const cur = splitCommaTags(tagsInput.value);
            if (!cur.includes(tag)) cur.push(tag);
            tagsInput.value = cur.join(', ');
            renderTagSuggestions();
            recomputeDirty();
          });
          tagSuggestChips.appendChild(chip);
        });
      }

      renderTagSuggestions();

      /* ----------------------------
         ملفات الوثيقة
      ----------------------------- */

      const filesBlock = el('div', 'biosec-images-block source-files-block');
      const emptyFilesHint = el('div', 'biosec-images-empty-hint source-files-empty-hint');
      const filesRow = el('div', 'biosec-images-row source-files-row');
      const filesThumbs = el('div', 'biosec-images-thumbs source-files-thumbs');

      const addFileLabel = el('label', 'biosec-add-btn source-file-add-btn');
      const addFileIcon = el('span', 'source-file-add-icon');
      addFileIcon.innerHTML = '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>';

      const addFileText = el('span', 'source-file-add-text');
      addFileText.textContent = 'إرفاق مرفقات للوثيقة';

    const fileInput = el('input');
fileInput.type = 'file';
fileInput.name = `source_files_${src.id}`;
fileInput.id = `source_files_${src.id}`;

      fileInput.accept = [
        'image/*',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/heic', 'image/heif'
      ].join(',');
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      addFileLabel.append(addFileIcon, addFileText, fileInput);
      filesRow.appendChild(filesThumbs);
filesBlock.append(filesRow, addFileLabel, emptyFilesHint);

      const pinWrap = el('label', 'biosec-pin-toggle biosec-toggle--pinned');
      const pinCheckbox = el('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.name = `source_pinned_${src.id}`;
      pinCheckbox.checked = original.pinned;
      const pinText = textEl('span', 'وثيقة مهمة');
      pinWrap.append(pinCheckbox, pinText);

      const pinRow = el('div', 'biosec-toggles-row');
      pinRow.append(pinWrap);

      function updateAddFileLabel() {
        const count = currentFiles.length || 0;
        if (!count) {
          addFileText.textContent = 'إرفاق أول مرفق للوثيقة';
          addFileLabel.title = 'أرفق أول مرفق لهذه الوثيقة';
        } else if (count === 1) {
          addFileText.textContent = 'إضافة وثيقة أخرى';
          addFileLabel.title = 'أضف صفحة ثانية مثلاً';
        } else {
          addFileText.textContent = 'إضافة مزيد من الوثائق';
          addFileLabel.title = `هناك ${count} ملفات مرفقة حاليًا`;
        }
      }

      let sortableInited = false;
      function setupFilesSortable() {
        if (sortableInited) return;
        sortableInited = true;

        attachHorizontalSortable({
          container: filesThumbs,
          itemSelector: '.source-file-thumb',
          ghostClass: 'biosec-image-thumb--ghost source-file-thumb--ghost',
          dragClass: 'biosec-image-thumb--drag source-file-thumb--drag',
          onSorted(orderedRefs) {
            currentFiles = groupRefsByKind(orderedRefs, getSourceFileKind);
            renderThumbs();
            recomputeDirty();
          }
        });
      }

      function renderThumbs() {
        filesThumbs.innerHTML = '';

        const ordered = groupRefsByKind(currentFiles, getSourceFileKind);
        currentFiles = ordered;

        const images = ordered.filter(r => getSourceFileKind(r) === 'image');
        const others = ordered.filter(r => getSourceFileKind(r) !== 'image');
        const hasTwoGroups = images.length && others.length;

        if (!currentFiles.length) {
          emptyFilesHint.textContent = 'لم تُرفق ملفات بعد لهذه الوثيقة.';
          emptyFilesHint.style.display = '';
          updateAddFileLabel();
          return;
        }

        emptyFilesHint.style.display = 'none';

        if (hasTwoGroups && images.length) {
          const gt = makeGroupTitle('الصور');
          gt.classList.add('biosec-files-group-title', 'source-files-group-title');
          filesThumbs.appendChild(gt);
        }

        const renderOneThumb = (ref, idx, totalRefs, imagesOnly) => {
          const thumb = el('div', 'biosec-image-thumb biosec-file-thumb source-file-thumb');
          thumb.dataset.ref = ref;
          classifyFileThumb(thumb, ref);

          const kind = getSourceFileKind(ref);
          const isDoc = (kind === 'word' || kind === 'excel');

          let thumbContent = null;

          if (kind === 'image') {
            const imgEl = el('img');
            imgEl.alt = 'صورة مرفقة';
            resolveSourceFileUrlLocal(ref).then(url => { if (url) imgEl.src = url; });

            const imageIndex = findImageIndex(imagesOnly, ref);
            imgEl.addEventListener('click', () => {
              if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
            });

            thumbContent = imgEl;
          } else {
            const icon = el('div', 'biosec-file-icon source-file-icon');
            icon.innerHTML = {
              pdf: '<i class="fa-solid fa-file-pdf"></i>',
              word: '<i class="fa-solid fa-file-word"></i>',
              excel: '<i class="fa-solid fa-file-excel"></i>',
              other: '<i class="fa-solid fa-file"></i>'
            }[kind] || '<i class="fa-solid fa-file"></i>';

            const openIt = () => {
              if (isDoc) {
                openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'الوثيقة', index: idx, total: totalRefs });
              } else {
                openInNewTabSafe(resolveSourceFileUrlLocal(ref));
              }
            };

            icon.style.cursor = 'pointer';
            icon.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
            thumb.addEventListener('click', openIt);

            thumbContent = icon;
          }

          const removeBtn = el('button', 'biosec-image-thumb-remove source-file-thumb-remove');
          removeBtn.type = 'button';
          removeBtn.title = 'إزالة هذا الملف';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const removeRef = ref;

            if (removeRef && isIdbRef(removeRef)) pendingDeletedFiles.push(removeRef);
            if (removeRef && isTmpRef(removeRef)) revokeTempRef(removeRef);

            currentFiles = currentFiles.filter(r => r !== removeRef);
            renderThumbs();
            recomputeDirty();
          });

          const viewBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view source-file-thumb-view');
          viewBtn.type = 'button';
          viewBtn.textContent = kind === 'image' ? 'معاينة' : (isDoc ? 'تحميل' : 'فتح');

          viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            if (kind === 'image') {
              const imageIndex = findImageIndex(imagesOnly, ref);
              if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
              return;
            }

            if (isDoc) {
              openOrDownloadRef(ref, { preferDownload: true, baseTitle: original.title || 'الوثيقة', index: idx, total: totalRefs });
              return;
            }

            openInNewTabSafe(resolveSourceFileUrlLocal(ref));
          });

          thumb.append(thumbContent, removeBtn, viewBtn);
          filesThumbs.appendChild(thumb);
        };

        images.forEach((ref, idx) => renderOneThumb(ref, idx, images.length, images));

        if (hasTwoGroups) {
          const div = makeDivider();
          div.classList.add('biosec-files-group-divider', 'source-files-group-divider');
          filesThumbs.appendChild(div);

          const gt2 = makeGroupTitle('الملفات');
          gt2.classList.add('biosec-files-group-title', 'source-files-group-title');
          filesThumbs.appendChild(gt2);
        }

        others.forEach((ref, idx) => renderOneThumb(ref, idx, others.length, images));

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

          if (!check.ok) {
            showWarning?.(`${file.name || 'ملف'}: ${check.reason}`);
            continue;
          }

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

      /* ----------------------------
         تفاصيل إضافية
      ----------------------------- */
      const forFieldWrap = el('div', 'biosec-meta-field source-details-field');
      const forFieldLabel = el('div', 'biosec-meta-label source-details-label');
      forFieldLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-bullseye" aria-hidden="true"></i></span> هذه الوثيقة متعلقة بـ';
      forFieldWrap.append(forFieldLabel, forFieldInput);

      const issuerWrap = el('div', 'biosec-meta-field source-meta-field');
      const issuerLabel = el('div', 'biosec-meta-label source-details-label');
      issuerLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-landmark" aria-hidden="true"></i></span> الجهة المصدرة';
      issuerWrap.append(issuerLabel, issuerInput);

      const refWrap = el('div', 'biosec-meta-field source-meta-field');
      const refLabel = el('div', 'biosec-meta-label source-details-label');
      refLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-hashtag" aria-hidden="true"></i></span> رقم الصك / رقم الوثيقة';
      refWrap.append(refLabel, referenceInput);

      const pagesWrap = el('div', 'biosec-meta-field source-details-field');
      const pagesLabel = el('div', 'biosec-meta-label source-details-label');
      pagesLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span> عدد الصفحات (اختياري)';
      pagesWrap.append(pagesLabel, pagesInput);

      const noteWrap = el('div', 'biosec-meta-field source-details-field');
      const noteLabel = el('div', 'biosec-meta-label source-details-label');
      noteLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></span> ملخص محتوى الوثيقة';
      noteWrap.append(noteLabel, noteInput);

      const tagsWrapField = el('div', 'biosec-meta-field source-details-field');
      const tagsLabel = el('div', 'biosec-meta-label source-details-label');
      tagsLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> وسوم الوثيقة';
      tagsWrapField.append(tagsLabel, tagsInput, tagSuggestWrap);

const noteRow = el('div', 'biosec-meta-row source-meta-row source-meta-row--note');
noteRow.append(noteWrap);

const tagsRow = el('div', 'biosec-meta-row source-meta-row source-meta-row--tags');
tagsRow.append(tagsWrapField);

      typeField.classList.add('source-meta-field--primary');
      issuerWrap.classList.add('source-meta-field--primary');
      refWrap.classList.add('source-meta-field--primary');
      forFieldWrap.classList.add('source-meta-field--primary');
dateField.classList.add('source-meta-field--primary');
placeField.classList.add('source-meta-field--primary');

validUntilWrap.classList.add('source-meta-field--primary');
alertDaysWrap.classList.add('source-meta-field--primary');

holderNameWrap.classList.add('source-meta-field--primary');
nationalIdWrap.classList.add('source-meta-field--primary');
civilRegistryWrap.classList.add('source-meta-field--primary');

metaRow.append(
  // 1) تعريف الوثيقة (Identity)
  titleField,
  typeField,
  forFieldWrap,
  dateField,

  // 2) بيانات المرجع/الإصدار (Reference & Issuance)
  issuerWrap,
  refWrap,
  placeField,

  // 3) الصلاحية (Validity)
  validUntilWrap,
  alertDaysWrap,

  // 4) بيانات صاحب الوثيقة (ديناميكية)
  holderNameWrap,
  nationalIdWrap,
  civilRegistryWrap
);

      const confWrap = el('div', 'biosec-meta-field source-details-field');
      const confLabel = el('div', 'biosec-meta-label source-details-label');
      confLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span> درجة الاعتماد';
      confWrap.append(confLabel, confidenceSelect);

      const confPrivWrap = el('div', 'biosec-meta-field source-details-field');
      const confPrivLabel = el('div', 'biosec-meta-label source-details-label');
      confPrivLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-lock" aria-hidden="true"></i></span> مستوى السرية';
      confPrivWrap.append(confPrivLabel, confidentialitySelect);

detailsRow.append(
  // تفاصيل إضافية
  pagesWrap,
  confWrap,
  confPrivWrap,

  // مجموعة التحقق/التوثيق (منطقي)
  verifiedWrap,     // 1) حالة التحقق (checkbox)
  verifiedByWrap,   // 2) تم التوثيق بواسطة
  verifiedAtWrap    // 3) تاريخ التوثيق
);

body.append(
  primaryTitle,
  metaRow,
  detailsTitle,
  detailsRow,
  noteRow,
  tagsRow,
  filesBlock,
  pinRow
);

      editBox.appendChild(body);
      card.appendChild(editBox);

      
      /* ----------------------------
         تذييل البطاقة (Actions)
      ----------------------------- */

      const footer = el('div', 'biosec-footer source-footer');

      const saveBtn = el('button', 'biosec-save-btn source-save-btn');
      saveBtn.type = 'button';
      saveBtn.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>تعديل</span>';

      const cancelBtn = el('button', 'biosec-cancel-btn source-cancel-btn');
      cancelBtn.type = 'button';
      cancelBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>إلغاء التعديل</span>';

      const delBtn = el('button', 'biosec-delete-btn source-delete-btn');
      delBtn.type = 'button';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>حذف الوثيقة</span>';

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
          classes: { edit: 'source-card--edit', preview: 'source-card--preview' },
          labels: { edit: 'تعديل', close: 'إغلاق', save: 'حفظ' }
        });
      }

      function recomputeDirty() {
        const curTitle = titleInput.value.trim();
        const curType = typeSelect.value.trim();
        const curDate = dateInput.value || null;
        const curPlace = placeInput.value.trim();
        const curFor = forFieldInput.value.trim();
        const curRef = referenceInput.value.trim();
        const curIssuer = issuerInput.value.trim();
        const curPages = pagesInput.value.trim();
        const curNote = noteInput.value.trim();
        const curTags = splitCommaTags(tagsInput.value);
        const curPinned = !!pinCheckbox.checked;

        const curConfidence = confidenceSelect.value.trim();
        const curConfidentiality = confidentialitySelect.value.trim();
        const curVerified = !!verifiedCheckbox.checked;
        const curVerifiedBy = verifiedByInput.value.trim();
        const curVerifiedAt = verifiedAtInput.value || null;

        const curValidUntil = validUntilInput.value || null;
        const curAlertDays = Number(alertDaysInput.value || DEFAULT_EXPIRY_ALERT_DAYS) || DEFAULT_EXPIRY_ALERT_DAYS;

        const curHolderName = holderNameInput.value.trim();
        const curNationalId = nationalIdInput.value.trim();
        const curCivilReg = civilRegistryInput.value.trim();

        isDirty =
          curTitle !== original.title ||
          curType !== original.type ||
          curDate !== (original.date || null) ||
          curPlace !== original.place ||
          curFor !== original.forField ||
          curRef !== original.referenceCode ||
          curIssuer !== original.issuer ||
          curPages !== original.pages ||
          curNote !== original.note ||
          curPinned !== original.pinned ||
          curTags.join('|') !== original.tags.join('|') ||
          !arraysShallowEqual(currentFiles, original.files) ||
          curConfidence !== (original.confidenceLevel || '') ||
          curConfidentiality !== (original.confidentiality || '') ||
          curVerified !== original.verified ||
          curVerifiedBy !== original.verifiedBy ||
          curVerifiedAt !== (original.verifiedAt || null) ||
          curValidUntil !== (original.validUntil || null) ||
          curAlertDays !== (original.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS) ||
          curHolderName !== original.holderName ||
          curNationalId !== original.nationalId ||
          curCivilReg !== original.civilRegistryNo;

        applyMode();
      }

      applyMode();

      // مراقبة تغييرات
      titleInput.addEventListener('input', recomputeDirty);
      typeSelect.addEventListener('change', () => {
        toggleIdFields();
        renderTagSuggestions();
        recomputeDirty();
      });
      dateInput.addEventListener('change', recomputeDirty);
      placeInput.addEventListener('input', recomputeDirty);
      forFieldInput.addEventListener('input', recomputeDirty);
      referenceInput.addEventListener('input', recomputeDirty);
      issuerInput.addEventListener('input', () => {
        renderTagSuggestions();
        recomputeDirty();
      });
      pagesInput.addEventListener('input', recomputeDirty);
      noteInput.addEventListener('input', recomputeDirty);
      tagsInput.addEventListener('input', () => { renderTagSuggestions(); recomputeDirty(); });
      pinCheckbox.addEventListener('change', recomputeDirty);

      confidenceSelect.addEventListener('change', recomputeDirty);
      confidentialitySelect.addEventListener('change', recomputeDirty);

      verifiedCheckbox.addEventListener('change', recomputeDirty);
      verifiedByInput.addEventListener('input', recomputeDirty);
      verifiedAtInput.addEventListener('change', recomputeDirty);

      validUntilInput.addEventListener('change', recomputeDirty);
      alertDaysInput.addEventListener('input', recomputeDirty);

      holderNameInput.addEventListener('input', recomputeDirty);
      nationalIdInput.addEventListener('input', recomputeDirty);
      civilRegistryInput.addEventListener('input', recomputeDirty);

      /* ----------------------------
         حفظ/إغلاق
      ----------------------------- */

      saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = src.id;
          applyMode();
          showInfo?.('يمكنك تعديل بيانات الوثيقة ثم الضغط على "حفظ".');
          return;
        }

        if (isEditing && !isDirty) {
          const isDraft = draftNewMap.has(src.id);

          const currentSnapshot = {
            title: titleInput.value.trim(),
            forField: forFieldInput.value.trim(),
            date: dateInput.value || null,
            place: placeInput.value.trim(),
            referenceCode: referenceInput.value.trim(),
            issuer: issuerInput.value.trim(),
            pages: pagesInput.value.trim(),
            files: Array.isArray(currentFiles) ? currentFiles : [],
            tags: splitCommaTags(tagsInput.value),
            note: noteInput.value.trim(),
            pinned: !!pinCheckbox.checked,
            confidenceLevel: confidenceSelect.value.trim(),
            relatedEventId: src.relatedEventId || null,
            verified: !!verifiedCheckbox.checked,
            verifiedBy: verifiedByInput.value.trim(),
            verifiedAt: verifiedAtInput.value || null,
            confidentiality: confidentialitySelect.value.trim(),

            validUntil: validUntilInput.value || null,
            holderName: holderNameInput.value.trim(),
            nationalId: nationalIdInput.value.trim(),
            civilRegistryNo: civilRegistryInput.value.trim()
          };

          if (isDraft && isEmptySourceDraft(currentSnapshot)) {
            sourceSectionTmp.cleanupTmp(currentFiles);
            pendingDeletedFiles = [];
            deleteSource(person, src.id, {
              onChange: (sources, removed) => {
                if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, removed);
                emitSourcesToHost();
              }
            });
            draftNewMap.delete(src.id);
            if (lastEditedId === src.id) lastEditedId = null;

            renderList();
            showInfo?.('تم إلغاء إنشاء الوثيقة لأنها كانت مسودة فارغة.');
            return;
          }

          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق المحرّر.');
          return;
        }

        const hasTmp = currentFiles.some(r => String(r || '').startsWith('tmp:'));
        if (hasTmp && typeof DB?.putSourceFile !== 'function') {
          showError?.('ميزة حفظ الملفات غير متاحة حالياً (DB.putSourceFile غير موجود).');
          return;
        }

        const up = await upgradeTmpRefs(currentFiles, {
          tempCache: sourceSectionTmp.tempCache,
          putFn: async (rec) => {
            return DB.putSourceFile({
              file: rec.file,
              personId,
              sourceId: src.id,
              meta: rec.meta
            });
          },
          onAfterPut: async (idbRef, rec) => {
            sourceFileMetaCache.set(String(idbRef), rec.meta);
          },
          onFail: (ref, e) => {
            console.error('Failed to store temp file', ref, e);
          },
          revokeFn: (ref) => sourceSectionTmp.revokeTemp(ref)
        });

        if (!up.ok) {
          showError?.('تعذّر حفظ أحد الملفات. لم يتم حفظ التعديلات.');
          return;
        }

        currentFiles = up.refs;

        const actor = getActorName();

        const updated = updateSource(
          person,
          src.id,
          {
            title: titleInput.value.trim(),
            type: typeSelect.value.trim(),
            date: dateInput.value || null,
            place: placeInput.value.trim(),
            forField: forFieldInput.value.trim(),
            referenceCode: referenceInput.value.trim(),
            issuer: issuerInput.value.trim(),
            pages: pagesInput.value.trim(),
            note: noteInput.value.trim(),
            tags: splitCommaTags(tagsInput.value),
            files: currentFiles,
            pinned: !!pinCheckbox.checked,

            confidenceLevel: confidenceSelect.value.trim(),
            confidentiality: confidentialitySelect.value.trim(),
            verified: !!verifiedCheckbox.checked,
            verifiedBy: verifiedByInput.value.trim(),
            verifiedAt: verifiedAtInput.value || null,

            validUntil: validUntilInput.value || null,
            expiryAlertDays: Number(alertDaysInput.value || DEFAULT_EXPIRY_ALERT_DAYS) || DEFAULT_EXPIRY_ALERT_DAYS,
            holderName: holderNameInput.value.trim(),
            nationalId: nationalIdInput.value.trim(),
            civilRegistryNo: civilRegistryInput.value.trim()
          },
  {
    onChange: (sources, changed) => {
      if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, changed);
      emitSourcesToHost();
    },
    by: actor
  }
);

        const effective = updated || src;

        // تحديث snapshot
        original.title = effective.title || '';
        original.type = (effective.type || '').trim();
        original.date = effective.date || null;
        original.place = (effective.place || '').trim();
        original.forField = (effective.forField || '').trim();
        original.referenceCode = (effective.referenceCode || '').trim();
        original.issuer = (effective.issuer || '').trim();
        original.pages = (effective.pages || '').trim();
        original.note = (effective.note || '').trim();
        original.tags = Array.isArray(effective.tags) ? [...effective.tags] : [];
        original.files = Array.isArray(effective.files) ? [...effective.files] : [];
        original.pinned = !!effective.pinned;
        original.confidenceLevel = (effective.confidenceLevel || '').trim();
        original.relatedEventId = effective.relatedEventId || null;
        original.verified = !!effective.verified;
        original.verifiedBy = (effective.verifiedBy || '').trim();
        original.verifiedAt = effective.verifiedAt || null;
        original.confidentiality = (effective.confidentiality || '').trim();

        original.validUntil = effective.validUntil || null;
        original.expiryAlertDays = Number(effective.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS) || DEFAULT_EXPIRY_ALERT_DAYS;
        original.holderName = (effective.holderName || '').trim();
        original.nationalId = (effective.nationalId || '').trim();
        original.civilRegistryNo = (effective.civilRegistryNo || '').trim();

        original.history = Array.isArray(effective.history) ? effective.history.map(h => ({ ...h })) : [];

        currentFiles = [...original.files];

        // حذف ملفات مؤجلة
        for (const ref of pendingDeletedFiles) {
          try {
            if (typeof DB?.deleteSourceFile === 'function') await DB.deleteSourceFile(ref);
          } catch (e) {
            console.error('Failed to delete source file from DB', ref, e);
          }
        }
        pendingDeletedFiles = [];

        // تحديث معاينة
        previewTitle.textContent = original.title || 'وثيقة بدون عنوان';

        const info2 = getSourceNoteLengthInfo(original.note.length);
        if (info2.level === 0) {
          lengthLabel.textContent = 'لم تُكتب ملاحظات بعد';
        } else {
          const meter2 = el('span', 'biosec-length-meter source-length-meter');
          meter2.dataset.level = String(info2.level);
          const bar2 = el('span', 'biosec-length-meter-bar source-length-meter-bar');
          meter2.appendChild(bar2);
          const txtSpan2 = el('span');
          txtSpan2.textContent = info2.label;
          lengthLabel.innerHTML = '';
          lengthLabel.append(meter2, txtSpan2);
        }

        previewNote.textContent =
          original.note ||
          'لم تُكتب ملاحظات عن هذه الوثيقة بعد. يمكنك فتح وضع التحرير لإضافة وصف مختصر.';

  if (effective.createdAt) {
  const lbl = formatCreatedAtLabel(effective.createdAt, 'أضيفت', formatFullDateTime);
  dates.textContent = lbl;
  createdLabel.textContent = lbl;
}

// تحديث “آخر تعديل” بعد الحفظ
if (effective.updatedAt) {
updatedLabel.textContent = `آخر تعديل: ${formatFullDateTime(effective.updatedAt)}`;
}

        renderPreviewFiles();

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        draftNewMap.delete(src.id);

        sortSources(person, sortMode);
        renderList();
        showSuccess?.('تم حفظ بيانات الوثيقة بنجاح.');
      });

      /* ----------------------------
         إلغاء
      ----------------------------- */

      cancelBtn.addEventListener('click', () => {
        if (!isEditing) return;

        titleInput.value = original.title;
        typeSelect.value = original.type || 'generic';
        dateInput.value = original.date || '';
        placeInput.value = original.place;
        forFieldInput.value = original.forField;
        referenceInput.value = original.referenceCode;
        issuerInput.value = original.issuer;
        pagesInput.value = original.pages;
        noteInput.value = original.note;
        tagsInput.value = original.tags.join(', ');
        pinCheckbox.checked = original.pinned;

        confidenceSelect.value = original.confidenceLevel || '';
        confidentialitySelect.value = original.confidentiality || '';
        verifiedCheckbox.checked = original.verified;
        verifiedByInput.value = original.verifiedBy;
        verifiedAtInput.value = original.verifiedAt || '';

        validUntilInput.value = original.validUntil || '';
        alertDaysInput.value = String(original.expiryAlertDays || DEFAULT_EXPIRY_ALERT_DAYS);
        holderNameInput.value = original.holderName || '';
        nationalIdInput.value = original.nationalId || '';
        civilRegistryInput.value = original.civilRegistryNo || '';

        toggleIdFields();
        renderTagSuggestions();

        sourceSectionTmp.cleanupTmp(currentFiles);

        currentFiles = [...original.files];
        pendingDeletedFiles = [];
        renderThumbs();
        renderPreviewFiles();

        if (src.createdAt) {
          const lbl = formatCreatedAtLabel(src.createdAt, 'أضيفت', formatFullDateTime);
          dates.textContent = lbl;
          createdLabel.textContent = lbl;
        }

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        applyMode();

        showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة.');
      });

      /* ----------------------------
         حذف وثيقة
      ----------------------------- */

      delBtn.addEventListener('click', async () => {
        const res = await showConfirmModal?.({
          title: 'حذف الوثيقة',
          message: 'هل تريد بالتأكيد حذف هذه الوثيقة؟ لا يمكن التراجع عن هذا الإجراء.',
          variant: 'danger',
          confirmText: 'حذف',
          cancelText: 'إلغاء'
        });

        if (res !== 'confirm') {
          showInfo?.('تم إلغاء حذف الوثيقة.');
          return;
        }

        const refs = Array.isArray(src.files) ? src.files : [];
        for (const ref of refs) {
          if (!isIdbRef(ref)) continue;
          try { await DB?.deleteSourceFile?.(ref); } catch (e) { console.error('deleteSourceFile failed', ref, e); }
        }

        const success = deleteSource(person, src.id, {
          onChange: (sources, removed) => {
            if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, removed);
            emitSourcesToHost();
          }
        });

        if (!success) {
          showError?.('تعذر حذف الوثيقة. حاول مرة أخرى.');
          return;
        }

        if (lastEditedId === src.id) lastEditedId = null;
        draftNewMap.delete(src.id);

        renderList();
        showSuccess?.('تم حذف الوثيقة بنجاح.');
      });

      list.appendChild(card);
    });

    autoResizeTextareas(list, '.source-note-input');
        // (C) طبّق nav بعد ما تكتمل القائمة وتترسم
    applyNavAfterRender();

  }

  /* ============================================================================
     أحداث عامة للقسم
  ============================================================================ */

  function syncAdvStateFromUI() {
    advIssuer = advIssuerInput.value || '';
    advConfidentiality = advConfSelect.value || '';
    advConfidence = advConfidenceSelect.value || '';
    advVerifiedMode = advVerifiedSelect.value || 'all';
    syncClearFiltersBtnVisibility();
    persistSourcesFiltersState();
  }


  advIssuerInput.addEventListener('input', () => { syncAdvStateFromUI(); renderList(); });
  advConfSelect.addEventListener('change', () => { syncAdvStateFromUI(); renderList(); });
  advConfidenceSelect.addEventListener('change', () => { syncAdvStateFromUI(); renderList(); });
  advVerifiedSelect.addEventListener('change', () => { syncAdvStateFromUI(); renderList(); });

  advClearBtn.addEventListener('click', () => {
    // الفلاتر الأساسية
    currentTypeFilter = 'all';
    typeFilterSelect.value = 'all';
    pinnedFilterMode = 'all';
    pinnedFilterSelect.value = 'all';

    currentTagFilter = '';

    // فلاتر إضافية
    advIssuerInput.value = '';
    advConfSelect.value = '';
    advConfidenceSelect.value = '';
    advVerifiedSelect.value = 'all';
    advVerifiedMode = 'all';

    // إعادة وضع شريط الانتهاء لو كان مفعلاً
    expiryFocusMode = 'all';
    // صفّر الترتيب إلى الافتراضي (latest)
    sortMode = 'latest';
    sortSelect.value = 'latest';
    sortSources(person, 'latest');

    syncAdvStateFromUI();
    syncClearFiltersBtnVisibility();
    clearSourcesFiltersState();
    renderList();
    showInfo?.('تم إعادة ضبط جميع الفلاتر إلى الوضع الإفتراضي.');
  });

  addBtn.addEventListener('click', () => {
    ensureSources(person);

    const draft = (person.sources || []).find(s => draftNewMap.has(s.id) && isEmptySourceDraft(s));
    if (draft) {
      lastEditedId = draft.id;
      renderList();
      const card = list.querySelector(`.source-card[data-source-id="${draft.id}"]`);
      const input = card?.querySelector('.source-title-input');
      if (input) input.focus();
      showWarning?.('لديك مسودة وثيقة مفتوحة بالفعل. أكملها قبل إضافة وثيقة جديدة.');
      return;
    }

    const actor = getActorName();

    const src = addSource(
      person,
      {
        title: '',
        type: 'generic',
        forField: '',
        date: null,
        place: '',
        referenceCode: '',
        issuer: '',
        pages: '',
        note: '',
        tags: [],
        files: [],
        pinned: false,
        confidenceLevel: '',
        relatedEventId: null,
        verified: false,
        verifiedBy: '',
        verifiedAt: null,
        confidentiality: '',
        validUntil: null,
        expiryAlertDays: DEFAULT_EXPIRY_ALERT_DAYS,
        holderName: '',
        nationalId: '',
        civilRegistryNo: '',
        history: []
      },
 {
  onChange: (sources, changed) => {
    if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, changed);
  },
  by: actor
}

    );

    if (!src) {
      showError?.('تعذر إنشاء وثيقة جديدة. حاول مرة أخرى.');
      return;
    }

    draftNewMap.set(src.id, true);

    lastEditedId = src.id;
    renderList();

    const card = list.querySelector(`.source-card[data-source-id="${src.id}"]`);
    const input = card?.querySelector('.source-title-input');
    if (input) input.focus();

    showSuccess?.('تمت إضافة مسودة وثيقة جديدة. أدخل بياناتها ثم اضغط "حفظ".');
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'oldest' ? 'oldest' : 'latest';
    sortMode = mode;

    sortSources(person, mode);
    if (typeof handlers.onDirty === 'function') handlers.onDirty(person.sources);
    emitSourcesToHost();
    persistSourcesFiltersState();
    renderList();
    showInfo?.(mode === 'latest' ? 'تم ترتيب الوثائق من الأحدث إلى الأقدم.' : 'تم ترتيب الوثائق من الأقدم إلى الأحدث.');
  });

  typeFilterSelect.addEventListener('change', () => {
    currentTypeFilter = typeFilterSelect.value || 'all';
    syncClearFiltersBtnVisibility();
    persistSourcesFiltersState();
    renderList();
  });

searchInput.addEventListener('input', () => {
  const raw = searchInput.value || '';
  currentSearchTerm = raw;

  // أظهر/أخف زر المسح حسب وجود نص
  clearSearchBtn.style.display = raw.trim() ? '' : 'none';
persistSourcesFiltersState();
  renderList();
});

  pinnedFilterSelect.addEventListener('change', () => {
    pinnedFilterMode = pinnedFilterSelect.value === 'pinned' ? 'pinned' : 'all';
    syncClearFiltersBtnVisibility();
    persistSourcesFiltersState();
    renderList();
  });

async function setViewMode(mode) {
  viewMode = mode === 'table' ? 'table' : 'cards';
  viewBtnCards.classList.toggle('is-active', viewMode === 'cards');
  viewBtnTable.classList.toggle('is-active', viewMode === 'table');
  persistSourcesFiltersState(); 
  await renderList();
}


  viewBtnCards.addEventListener('click', () => setViewMode('cards'));
  viewBtnTable.addEventListener('click', () => setViewMode('table'));

  // تشغيل أولي
  renderList();
  return root;
}