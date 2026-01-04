// person.sources.js
// إدارة "المصادر والوثائق" لكل شخص (منطق + واجهة القسم داخل نافذة السيرة)

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

/* ============================================================================
   1) إعدادات التحقق من الملفات المرفقة
   ============================================================================ */

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
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

function isAllowedSourceFile(file) {
  if (!file) return { ok: false, reason: 'ملف غير صالح.' };
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, reason: `حجم الملف كبير (أقصى حد ${MAX_FILE_SIZE_MB}MB).` };
  }

  const type = (file.type || '').toLowerCase();

  // الصور العادية
  if (type.startsWith('image/')) return { ok: true };

  // PDF/Word/Excel/HEIC...
  if (ALLOWED_MIME.has(type)) return { ok: true };

  // fallback بالامتداد لو file.type غير موجود/غير دقيق
  const name = (file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const allowedExt = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
    'heic', 'heif'
  ]);

  if (ext && allowedExt.has(ext)) return { ok: true };

  return { ok: false, reason: 'نوع الملف غير مدعوم. ارفع صورة أو PDF أو Word/Excel.' };
}

/* ============================================================================
   2) Helpers: امتداد / MIME / تصنيف نوع الملف (Image/PDF/Word/Excel/Other)
   ============================================================================ */

function getRefExt(ref) {
  const s = String(ref || '');
  const m = s.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : '';
}

function mimeToExt(mime = '') {
  const m = String(mime || '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/msword') return 'doc';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/vnd.ms-excel') return 'xls';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (m === 'text/csv') return 'csv';
  if (m.startsWith('image/')) {
    const ext = m.split('/')[1] || '';
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return '';
}

/**
 * تصنيف نوع الملف (kind) اعتماداً على mime/ext/ref/meta
 * - الهدف: تقليل تكرار منطق التصنيف في أكثر من مكان
 */
function inferFileKind({ mime = '', ext = '', ref = '' } = {}) {
  const m = String(mime || '').toLowerCase();
  const e = String(ext || '').toLowerCase();
  const r = String(ref || '').toLowerCase();

  if (m.startsWith('image/') || r.startsWith('data:image/') || /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)(?:\?|#|$)/.test(r) || /(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/.test(e)) {
    return 'image';
  }
  if (m === 'application/pdf' || r.startsWith('data:application/pdf') || /\.pdf(?:\?|#|$)/.test(r) || e === 'pdf') {
    return 'pdf';
  }
  if (m.includes('word') || /(doc|docx|rtf|odt)$/.test(e) || /\.(doc|docx|rtf|odt)(?:\?|#|$)/.test(r)) {
    return 'word';
  }
  if (m.includes('excel') || /(xls|xlsx|csv)$/.test(e) || /\.(xls|xlsx|csv)(?:\?|#|$)/.test(r)) {
    return 'excel';
  }
  return 'other';
}

/* ============================================================================
   3) ملفات المصادر عبر IndexedDB: resolve/store/open
   ============================================================================ */

async function resolveSourceFileUrl(ref) {
  if (!ref) return null;
  const s = String(ref);

  // روابط جاهزة
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  // صيغة idb:...
  if (typeof DB?.getSourceFileURL === 'function') {
    try {
      const url = await DB.getSourceFileURL(s);
      return url || null;
    } catch (e) {
      console.error('resolveSourceFileUrl failed', e);
      return null;
    }
  }

  // fallback
  return s;
}

// فتح تبويب "بشكل آمن" بدون ما يتبلك (لا تستخدم await قبل window.open)
function openInNewTabSafe(urlPromise) {
  const w = window.open('about:blank', '_blank'); // بدون noopener هنا
  if (w) w.opener = null; // أمان noopener

  Promise.resolve(urlPromise)
    .then((url) => {
      if (!url) {
        try { w?.close(); } catch {}
        return;
      }
      try { w.location.href = url; } catch {}
    })
    .catch(() => {
      try { w?.close(); } catch {}
    });
}

async function storeSourceFile(file, personId, sourceId) {
  if (!file) return null;

  if (typeof DB?.putSourceFile === 'function') {
    try {
      const mime = (file.type || '').toLowerCase();
      const name = (file.name || '');
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : mimeToExt(mime);
      const kind = inferFileKind({ mime, ext });

      const ref = await DB.putSourceFile({
        file,
        personId,
        sourceId,
        meta: { mime, name, ext, kind }
      });
      return ref || null;
    } catch (e) {
      console.error('storeSourceFile failed', e);
      return null;
    }
  }

  // fallback مؤقت: تخزين DataURL (غير مفضل للملفات الكبيرة)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (err) => reject(err);
    reader.onload = (ev) => resolve(String(ev.target?.result || ''));
    reader.readAsDataURL(file);
  });
}

/* ============================================================================
   4) منطق البيانات (Normalize / CRUD / Sort)
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

function getSourceTypeLabel(code) {
  return SOURCE_TYPE_LABELS[code] || '';
}

function getNoteLengthInfo(len) {
  if (!len) return { label: 'بدون وصف', level: 0 };
  if (len <= 140) return { label: 'وصف قصير', level: 1 };
  if (len <= 400) return { label: 'وصف متوسط', level: 2 };
  return { label: 'وصف مطوّل', level: 3 };
}

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

function normalizeSource(raw) {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== 'object') raw = {};

  return {
    id: String(raw.id || 'src_' + Math.random().toString(36).slice(2)),
    title: String(raw.title || '').trim(),
    type: (raw.type || '').trim(),
    forField: (raw.forField || '').trim(),
    date: raw.date || null,
    place: (raw.place || '').trim(),
    referenceCode: (raw.referenceCode || '').trim(),
    issuer: (raw.issuer || '').trim(),
    pages: (raw.pages || '').trim(),
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
    note: (raw.note || '').trim(),
    pinned: !!raw.pinned,

    confidenceLevel: (raw.confidenceLevel || '').trim(),
    relatedEventId: raw.relatedEventId || null,

    verified: !!raw.verified,
    verifiedBy: (raw.verifiedBy || '').trim(),
    verifiedAt: raw.verifiedAt || null,

    confidentiality: (raw.confidentiality || '').trim(),

    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

export function ensureSources(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.sources)) person.sources = [];
  person.sources = person.sources.map(normalizeSource);
}

export function addSource(person, data = {}, { onChange } = {}) {
  ensureSources(person);
  const src = normalizeSource(data);
  const now = new Date().toISOString();
  src.createdAt = now;
  src.updatedAt = now;
  person.sources.unshift(src);
  if (typeof onChange === 'function') onChange(person.sources, src);
  return src;
}

export function updateSource(person, sourceId, data = {}, { onChange } = {}) {
  ensureSources(person);
  const idx = person.sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return null;

  const old = person.sources[idx];
  const merged = normalizeSource({ ...old, ...data, id: old.id });
  merged.createdAt = old.createdAt || merged.createdAt;
  merged.updatedAt = new Date().toISOString();
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

// الفرز: نفضّل تاريخ الوثيقة، ثم تاريخ الإنشاء
export function sortSources(person, mode = 'latest') {
  ensureSources(person);
  person.sources.sort((a, b) => {
    const da = new Date(a.date || a.createdAt || a.updatedAt || 0).getTime();
    const db = new Date(b.date || b.createdAt || b.updatedAt || 0).getTime();
    return mode === 'oldest' ? (da - db) : (db - da);
  });
}

/* ============================================================================
   5) عارض صور/ملفات المصادر + UI helpers
   ============================================================================ */

const sourceImageViewer = createImageViewerOverlay({
  overlayClass: 'source-image-viewer-overlay',
  backdropClass: 'source-image-viewer-backdrop',
  dialogClass: 'source-image-viewer-dialog',
  imgClass: 'source-image-viewer-img',
  closeBtnClass: 'source-image-viewer-close',
  navClass: 'source-image-viewer-nav',
  arrowPrevClass: 'source-image-viewer-arrow source-image-viewer-arrow-prev',
  arrowNextClass: 'source-image-viewer-arrow source-image-viewer-arrow-next',
  counterClass: 'source-image-viewer-counter'
});

async function openSourceSlider(refs, startIndex = 0, resolver = resolveSourceFileUrl) {
  const list = Array.isArray(refs) ? refs : [];
  const urls = [];
  for (const r of list) {
    const u = await resolver(r);
    if (u) urls.push(u);
  }
  if (!urls.length) return;
  sourceImageViewer.open(urls, startIndex);
}


function autoResizeSourceTextareas(root) {
  const areas = root.querySelectorAll('.source-note-input');
  areas.forEach((ta) => {
    const resize = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    resize();
    ta.removeEventListener('input', ta._autoResizeHandler || (() => {}));
    ta._autoResizeHandler = resize;
    ta.addEventListener('input', resize);
  });
}

/* ============================================================================
   6) واجهة القسم داخل نافذة السيرة
   ============================================================================ */

export function createSourcesSection(person, handlers = {}) {
  ensureSources(person);

  const personId = person && person._id ? String(person._id) : null;
  let currentTypeFilter = 'all';
  let currentTagFilter = '';
  let currentSearchTerm = '';
  let onlyPinned = false;
  let viewMode = 'cards'; // 'cards' | 'table'
  let lastEditedId = null;

  // كاش ميتاداتا لملفات idb (لأنها غالباً بلا امتداد ظاهر)
const sourceFileMetaCache = new Map(); // ref -> { kind, ext, mime }
  
// كاش مؤقت للملفات قبل الحفظ (tmp:...)
const tempSourceFilesCache = new Map(); // tmpRef -> { file, url, meta }

  function emitSourcesToHost() {
    if (!personId || typeof handlers.onUpdateSources !== 'function') return;

    const sources = Array.isArray(person.sources) ? person.sources.map(s => ({
          id: s.id,
          title: String(s.title || '').trim(),
          type: (s.type || '').trim(),
          forField: (s.forField || '').trim(),
          date: s.date || null,
          place: (s.place || '').trim(),
          referenceCode: (s.referenceCode || '').trim(),
          issuer: (s.issuer || '').trim(),
          pages: (s.pages || '').trim(),
          files: Array.isArray(s.files) ? s.files.slice() : [],
          tags: Array.isArray(s.tags) ? s.tags.slice() : [],
          note: (s.note || '').trim(),
          pinned: !!s.pinned,

          confidenceLevel: (s.confidenceLevel || '').trim(),
          relatedEventId: s.relatedEventId || null,
          verified: !!s.verified,
          verifiedBy: (s.verifiedBy || '').trim(),
          verifiedAt: s.verifiedAt || null,
          confidentiality: (s.confidentiality || '').trim(),

          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
      : [];

    handlers.onUpdateSources(personId, sources);
  }

  const sortMode = (handlers.getSourcesSortMode && handlers.getSourcesSortMode()) || 'latest';
  sortSources(person, sortMode);

  const root = el('section', 'bio-section bio-section-sources');

  /* ---------- Title + Description ---------- */
  const titleEl = el('h3');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-file-circle-check';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'المصادر والوثائق');
  const countBadge = el('span', 'sources-count-badge');

  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'sources-meta');
  metaEl.textContent =
    'امنح السيرة العائلية قيمة أوثق بجمع كل وثيقة تدعم أي معلومة أو تاريخ أو حدث، من شهادات الميلاد والزواج والهوية إلى صكوك الميراث والملكية، وصولًا إلى الصور والوثائق القديمة التي تحفظ الإرث العائلي عبر الزمن.';
  root.appendChild(metaEl);

  function updateSourcesCountBadge() {
    const n = (person.sources || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد وثائق بعد)';
  }

  /* ---------- Header tools ---------- */
  const header = el('div', 'sources-header');
  const tools = el('div', 'sources-tools');
  const toolsLeft = el('div', 'sources-tools-left');
  const toolsRight = el('div', 'sources-tools-right');

  const typeFilterSelect = el('select', 'sources-type-filter');
  typeFilterSelect.name = 'sources_type_filter';
  SOURCE_TYPE_OPTIONS.forEach(([value, label]) => {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    typeFilterSelect.appendChild(opt);
  });
  typeFilterSelect.value = 'all';

  const sortSelect = el('select', 'sources-sort');
  sortSelect.name = 'sources_sort';
  const optLatest = el('option');
  optLatest.value = 'latest';
  optLatest.textContent = 'الأحدث أولاً';
  const optOldest = el('option');
  optOldest.value = 'oldest';
  optOldest.textContent = 'الأقدم أولاً';
  sortSelect.append(optLatest, optOldest);
  sortSelect.value = sortMode;

  const searchInput = el('input', 'sources-search-input');
  searchInput.type = 'search';
  searchInput.name = 'sources_search';
  searchInput.placeholder = 'بحث في العنوان / الجهة / رقم الصك / الوصف...';

  const pinnedFilterLabel = el('label', 'sources-pinned-filter');
  const pinnedFilterCheckbox = el('input');
  pinnedFilterCheckbox.type = 'checkbox';
  pinnedFilterCheckbox.name = 'sources_pinned_only';
  const pinnedFilterText = textEl('span', 'عرض الوثائق الأساسية فقط');
  pinnedFilterLabel.append(pinnedFilterCheckbox, pinnedFilterText);

  const viewToggle = el('div', 'sources-view-toggle');

  const viewBtnCards = el('button', 'sources-view-btn is-active');
  viewBtnCards.type = 'button';
  viewBtnCards.dataset.mode = 'cards';
  viewBtnCards.innerHTML =
    '<i class="fa-solid fa-table-cells-large" aria-hidden="true"></i><span>عرض كبطاقات</span>';

  const viewBtnTable = el('button', 'sources-view-btn');
  viewBtnTable.type = 'button';
  viewBtnTable.dataset.mode = 'table';
  viewBtnTable.innerHTML =
    '<i class="fa-solid fa-list-ul" aria-hidden="true"></i><span>عرض كجدول مختصر</span>';

  viewToggle.append(viewBtnCards, viewBtnTable);

  const addBtn = el('button', 'sources-add-btn');
  addBtn.type = 'button';

  toolsLeft.append(typeFilterSelect, sortSelect, searchInput);
  toolsRight.append(pinnedFilterLabel, viewToggle, addBtn);
  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

  const statsBar = el('div', 'sources-stats-bar');
  root.appendChild(statsBar);

  const list = el('div', 'sources-list');
  root.appendChild(list);

  function updateAddButtonLabel() {
    ensureSources(person);
    const count = person.sources.length || 0;
    if (!count) {
      addBtn.innerHTML =
        '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة أول وثيقة</span>';
      addBtn.title = 'ابدأ بتوثيق أول شهادة أو صك أو وثيقة لهذا الشخص';
    } else {
      addBtn.innerHTML =
        '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة وثيقة جديدة</span>';
      addBtn.title = `هناك ${count} وثائق محفوظة حتى الآن`;
    }
  }

  function rebuildSourceTypeFilterOptions() {
    ensureSources(person);
    const sources = person.sources || [];

    const usedTypesSet = new Set();
    for (const s of sources) {
      const t = (s.type || '').trim();
      if (t) usedTypesSet.add(t);
    }

    const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';
    typeFilterSelect.innerHTML = '';

    const optAll = el('option');
    optAll.value = 'all';
    optAll.textContent = 'كل الأنواع';
    typeFilterSelect.appendChild(optAll);

    const order = Object.fromEntries(
      SOURCE_TYPE_OPTIONS
        .filter(([val]) => val && val !== 'all')
        .map(([val], i) => [val, i])
    );

    const usedTypes = Array.from(usedTypesSet);
    usedTypes.sort((a, b) => {
      const ia = (order[a] !== undefined ? order[a] : 999);
      const ib = (order[b] !== undefined ? order[b] : 999);
      if (ia !== ib) return ia - ib;
      return String(a).localeCompare(String(b), 'ar');
    });

    usedTypes.forEach(code => {
      const opt = el('option');
      opt.value = code;
      opt.textContent = getSourceTypeLabel(code) || code;
      typeFilterSelect.appendChild(opt);
    });

    const canKeepPrev = prevValue && prevValue !== 'all' && usedTypes.includes(prevValue);
    const nextValue = canKeepPrev ? prevValue : 'all';
    typeFilterSelect.value = nextValue;
    currentTypeFilter = nextValue;
  }

  function updateStatsBar(allSources) {
    if (!statsBar) return;
    const sources = Array.isArray(allSources) ? allSources : [];
    if (!sources.length) {
      statsBar.textContent = '';
      statsBar.style.display = 'none';
      return;
    }
    const counts = {};
    for (const s of sources) {
      const t = (s.type || 'generic').trim() || 'generic';
      counts[t] = (counts[t] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([code, count]) => {
      const label = getSourceTypeLabel(code) || code;
      return `${label}: ${count}`;
    });
    statsBar.textContent = parts.join(' | ');
    statsBar.style.display = '';
  }

  /* ---------- تنبيه: بيانات موجودة بدون وثائق (مثال ميلاد/وفاة) ---------- */
  const missingWarningEl = el('div', 'sources-missing-warning');
  missingWarningEl.style.display = 'none';
  root.appendChild(missingWarningEl);

  function updateMissingSourcesWarning() {
    ensureSources(person);
    const sources = person.sources || [];

    const hasBirthDoc = sources.some(s => (s.type || '').trim() === 'birth');
    const hasDeathDoc = sources.some(s => (s.type || '').trim() === 'death');

    const hasBirthData =
      person.birthDate || person.birthYear || person.birthPlace || person.birth;
    const hasDeathData =
      person.deathDate || person.deathYear || person.deathPlace || person.death;

    const msgs = [];
    if (hasBirthData && !hasBirthDoc) {
      msgs.push('لا توجد وثيقة ميلاد موثقة لهذا الشخص. يمكنك إضافة شهادة الميلاد أو ما يقوم مقامها هنا.');
    }
    if (hasDeathData && !hasDeathDoc) {
      msgs.push('لا توجد وثيقة وفاة موثقة لهذا الشخص. يمكنك إضافة شهادة الوفاة أو ما يقوم مقامها هنا.');
    }

    if (!msgs.length) {
      missingWarningEl.textContent = '';
      missingWarningEl.style.display = 'none';
      return;
    }

    missingWarningEl.textContent = msgs.join(' ');
    missingWarningEl.style.display = '';
  }

  /* ==========================================================================
     6.1) كاش الميتا لـ idb:... (تسخين + قراءة kind)
     ========================================================================== */

  function collectAllSourceRefs() {
    const out = [];
    const sources = Array.isArray(person?.sources) ? person.sources : [];
    for (const s of sources) {
      const files = Array.isArray(s?.files) ? s.files : [];
      out.push(...files);
    }
    return out;
  }

  async function warmSourceFileMetaCache(refs = []) {
    const list = Array.isArray(refs) ? refs : [];
    const need = list
      .map(r => String(r))
      .filter(r => r.startsWith('idb:') && !sourceFileMetaCache.has(r));

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

  function genTmpRef() {
  if (window.crypto?.randomUUID) return 'tmp:' + window.crypto.randomUUID();
  return 'tmp:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeTempMetaFromFile(file) {
  const mime = (file?.type || '').toLowerCase();
  const name = (file?.name || '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : mimeToExt(mime);
  const kind = inferFileKind({ mime, ext });
  return { mime, name, ext, kind };
}

function addTempFile(file) {
  const tmpRef = genTmpRef();
  const url = URL.createObjectURL(file);
  const meta = makeTempMetaFromFile(file);

  tempSourceFilesCache.set(tmpRef, { file, url, meta });

  // مهم: حتى thumb classification يشتغل فوراً
  sourceFileMetaCache.set(tmpRef, meta);

  return tmpRef;
}

function revokeTempRef(tmpRef) {
  const rec = tempSourceFilesCache.get(tmpRef);
  if (rec?.url) {
    try { URL.revokeObjectURL(rec.url); } catch {}
  }
  tempSourceFilesCache.delete(tmpRef);
  sourceFileMetaCache.delete(tmpRef);
}

async function resolveSourceFileUrlLocal(ref) {
  if (!ref) return null;
  const s = String(ref);

  // روابط جاهزة
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  // tmp:... (قبل الحفظ)
  if (s.startsWith('tmp:')) {
    const rec = tempSourceFilesCache.get(s);
    return rec?.url || null;
  }

  // idb:...
  if (typeof DB?.getSourceFileURL === 'function') {
    try {
      const url = await DB.getSourceFileURL(s);
      return url || null;
    } catch (e) {
      console.error('resolveSourceFileUrl failed', e);
      return null;
    }
  }

  return s;
}

  async function ensureMetaForRef(ref) {
    const raw = String(ref || '');
    if (raw.startsWith('tmp:')) {
  return sourceFileMetaCache.get(raw) || tempSourceFilesCache.get(raw)?.meta || null;
}

    if (!raw.startsWith('idb:')) return null;

    let cached = sourceFileMetaCache.get(raw);
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
    const lower = raw.toLowerCase();
if (lower.startsWith('tmp:')) {
  const meta = sourceFileMetaCache.get(raw) || tempSourceFilesCache.get(raw)?.meta || {};
  return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
}

    // idb:... نعتمد على الكاش/الميتا
    if (lower.startsWith('idb:')) {
      const cached = sourceFileMetaCache.get(raw) || {};
      const kind = cached.kind || inferFileKind({ ext: cached.ext || '', mime: cached.mime || '', ref: raw });
      return kind || 'other';
    }

    // روابط عادية: استنتج من ref
    return inferFileKind({ ref: raw, ext: getRefExt(raw) });
  }

  // ترتيب: صور أولاً ثم باقي الأنواع (مع الحفاظ على ترتيب كل مجموعة)
  function groupRefsByKind(refs = []) {
    const list = Array.isArray(refs) ? refs.slice() : [];
    const images = [];
    const others = [];
    for (const r of list) {
      (getSourceFileKind(r) === 'image' ? images : others).push(r);
    }
    return images.concat(others);
  }

  function findImageIndex(imagesOnly, ref) {
    const r = String(ref);
    for (let i = 0; i < imagesOnly.length; i++) {
      if (String(imagesOnly[i]) === r) return i;
    }
    return -1;
  }

  /* ==========================================================================
     6.2) رسم الثمبنيل + فتح/تحميل
     ========================================================================== */

  function classifyFileThumb(thumb, ref) {
    const raw = String(ref || '');
    const lower = raw.toLowerCase();

    thumb.classList.remove(
      'source-file-thumb--image',
      'source-file-thumb--pdf',
      'source-file-thumb--word',
      'source-file-thumb--excel',
      'source-file-thumb--other'
    );
// tmp:... (قبل الحفظ)
if (lower.startsWith('tmp:')) {
  const meta = sourceFileMetaCache.get(raw) || tempSourceFilesCache.get(raw)?.meta || {};
  const kind = meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw });
  const ext = (meta.ext || '').toLowerCase();

  const cls =
    kind === 'image' ? 'source-file-thumb--image' :
    kind === 'pdf' ? 'source-file-thumb--pdf' :
    kind === 'word' ? 'source-file-thumb--word' :
    kind === 'excel' ? 'source-file-thumb--excel' :
    'source-file-thumb--other';

  thumb.classList.add(cls);

  if (ext) {
    const badge = el('span', 'source-file-ext');
    badge.textContent = ext.toUpperCase();
    thumb.appendChild(badge);
  }
  return;
}

    // idb: بدون امتداد ظاهر -> نحتاج meta
    if (lower.startsWith('idb:')) {
      const cached = sourceFileMetaCache.get(raw);

      if (!cached && typeof DB?.getSourceFileMeta === 'function') {
        DB.getSourceFileMeta(raw)
          .then(meta => {
            if (!meta) return;
            sourceFileMetaCache.set(raw, meta);

            // إعادة رسم بسيطة لنفس thumb بعد وصول الميتا
            thumb.innerHTML = '';
            classifyFileThumb(thumb, raw);
          })
          .catch(err => console.error('getSourceFileMeta failed', raw, err));
      }

      const meta = cached || {};
      const kind = meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw });
      const ext = (meta.ext || '').toLowerCase();

      const cls =
        kind === 'image' ? 'source-file-thumb--image' :
        kind === 'pdf' ? 'source-file-thumb--pdf' :
        kind === 'word' ? 'source-file-thumb--word' :
        kind === 'excel' ? 'source-file-thumb--excel' :
        'source-file-thumb--other';

      thumb.classList.add(cls);

      if (ext) {
        const badge = el('span', 'source-file-ext');
        badge.textContent = ext.toUpperCase();
        thumb.appendChild(badge);
      }
      return;
    }

    // روابط عادية: استخرج ext
    const ext = getRefExt(raw);
    const kind = inferFileKind({ ext, ref: raw });

    const cls =
      kind === 'image' ? 'source-file-thumb--image' :
      kind === 'pdf' ? 'source-file-thumb--pdf' :
      kind === 'word' ? 'source-file-thumb--word' :
      kind === 'excel' ? 'source-file-thumb--excel' :
      'source-file-thumb--other';

    thumb.classList.add(cls);

    if (ext) {
      const badge = el('span', 'source-file-ext');
      badge.textContent = ext.toUpperCase();
      thumb.appendChild(badge);
    }
  }

function buildDownloadName(baseTitle, ref, mime, index, total) {
  const isSingle = (total || 0) === 1;

  const cached = sourceFileMetaCache.get(String(ref)) || {};

  // لازم قبل safeBase
  const baseFromName =
    (cached.name && cached.name.trim()) ? cached.name.replace(/\.[^/.]+$/, '')
      : '';

  const safeBase = (baseFromName || String(baseTitle || 'الوثيقة').trim() || 'الوثيقة');

  const extFromCache = cached.ext || '';
  const extFromRef = getRefExt(ref);
  const extFromMime = mimeToExt(mime);

  const ext = (extFromCache || extFromRef || extFromMime || '').replace(/^\./, '');
  const suffix = isSingle ? '' : ` (${(index || 0) + 1})`;

  return ext ? `${safeBase}${suffix}.${ext}` : `${safeBase}${suffix}`;
}

  async function openOrDownloadRef(ref, { preferDownload = false, baseTitle = '', index = 0, total = 1 } = {}) {
    const preOpened = (!preferDownload) ? window.open('about:blank', '_blank') : null;
    if (preOpened) preOpened.opener = null;

const url = await resolveSourceFileUrlLocal(ref);
    if (!url) {
      try { preOpened?.close(); } catch {}
      return;
    }

    // تأكد من meta عند idb (خصوصاً بعد refresh)
    const meta = await ensureMetaForRef(ref);
    const mime = meta?.mime || (sourceFileMetaCache.get(String(ref))?.mime || '');

    const name = buildDownloadName(baseTitle, ref, mime, index, total);

    if (preferDownload) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    try { preOpened.location.href = url; } catch {}
  }

  /* ==========================================================================
     6.3) renderList (قلب الواجهة)
     ========================================================================== */

  async function renderList() {
    // تسخين الميتا لملفات idb قبل الرسم (لتحسين تصنيف الثمبنيلات)
    await warmSourceFileMetaCache(collectAllSourceRefs());

    list.innerHTML = '';
    ensureSources(person);

    updateSourcesCountBadge();
    updateAddButtonLabel();
    rebuildSourceTypeFilterOptions();
    updateStatsBar(person.sources);
    updateMissingSourcesWarning();

    const search = (currentSearchTerm || '').toLowerCase();

    const filtered = person.sources.filter(src => {
      const typeOk =
        currentTypeFilter === 'all' ||
        !currentTypeFilter ||
        (src.type || '') === currentTypeFilter;

      const tagOk =
        !currentTagFilter ||
        (Array.isArray(src.tags) && src.tags.includes(currentTagFilter));

      const pinnedOk = !onlyPinned || !!src.pinned;

      let textOk = true;
      if (search) {
        const hay = [
          src.title || '',
          src.issuer || '',
          src.referenceCode || '',
          src.note || ''
        ].join(' ').toLowerCase();
        textOk = hay.includes(search);
      }

      return typeOk && tagOk && pinnedOk && textOk;
    });

    if (!filtered.length) {
      const empty = el('div', 'sources-empty');
      empty.textContent = person.sources.length ? 'لا توجد وثائق مطابقة لخيارات التصفية الحالية.'
        : 'ابدأ بتسجيل الوثائق الرسمية: مثل شهادة الميلاد، عقد الزواج، صكوك الملكية أو وثائق الهوية.';
      list.appendChild(empty);
      return;
    }

    /* ---------- وضع الجدول المختصر ---------- */
    if (viewMode === 'table') {
      const table = el('div', 'sources-table-view');

      const headerRow = el('div', 'sources-table-header');
      const h1 = el('div', 'sources-table-cell sources-table-cell--title');
      h1.textContent = 'العنوان / النوع';
      const h2 = el('div', 'sources-table-cell sources-table-cell--meta');
      h2.textContent = 'الجهة / المكان';
      const h3 = el('div', 'sources-table-cell sources-table-cell--meta');
      h3.textContent = 'التاريخ / رقم المرجع';
      headerRow.append(h1, h2, h3);
      table.appendChild(headerRow);

      filtered.forEach((src) => {
        const typeLabel = getSourceTypeLabel((src.type || '').trim());

        const rowTitle = el('div', 'sources-table-cell sources-table-cell--title');
        rowTitle.textContent = (src.title || 'وثيقة بدون عنوان') + (typeLabel ? ` – ${typeLabel}` : '');

        const rowMeta1 = el('div', 'sources-table-cell sources-table-cell--meta');
        const issuer = (src.issuer || '').trim();
        const place = (src.place || '').trim();
        rowMeta1.textContent = [issuer, place].filter(Boolean).join(' • ');

        const rowMeta2 = el('div', 'sources-table-cell sources-table-cell--meta');
        const dText = formatShortDateBadge(src.date || src.createdAt || src.updatedAt || null) || '';
        const ref = (src.referenceCode || '').trim();
        rowMeta2.textContent = [dText, ref].filter(Boolean).join(' • ');

        table.append(rowTitle, rowMeta1, rowMeta2);
      });

      list.appendChild(table);
      return;
    }

    /* ---------- وضع البطاقات ---------- */
    filtered.forEach((src, index) => {
      const serial = index + 1;
      const card = el('article', 'source-card');
      card.dataset.sourceId = src.id;

      const indexBadge = el('div', 'source-card-index');
      indexBadge.textContent = `الوثيقة ${serial}`;

      let pinnedBadge = null;
      if (src.pinned) {
        pinnedBadge = el('div', 'source-pinned-badge');
        pinnedBadge.textContent = 'وثيقة أساسية';
        card.classList.add('source-card--pinned');
      }

      const topRow = el('div', 'source-card-top');
      topRow.appendChild(indexBadge);
      if (pinnedBadge) topRow.appendChild(pinnedBadge);
      card.appendChild(topRow);

      // نسخة أصلية للمقارنة (Dirty check)
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
        confidentiality: (src.confidentiality || '').trim()
      };

      const dateBadge = formatShortDateBadge(original.date);
      let currentFiles = Array.isArray(original.files) ? [...original.files] : [];
      let isEditing = lastEditedId === src.id;
      let isDirty = false;
      let pendingDeletedFiles = []; // refs تُحذف من IndexedDB عند الحفظ فقط

      /* =======================
         A) المعاينة (Preview)
         ======================= */

      const previewBox = el('div', 'source-preview');
      const previewMeta = el('div', 'source-preview-meta');

      const createdLabel = el('span', 'source-preview-date');
      createdLabel.textContent = src.createdAt ? `أضيفت في ${formatFullDateTime(src.createdAt) || ''}` : '';

      const lengthLabel = el('span', 'source-length-chip');
      const lenInfo = getNoteLengthInfo(original.note.length);
      if (lenInfo.level === 0) {
        lengthLabel.textContent = 'لم تُكتب ملاحظات بعد';
      } else {
        const meter = el('span', 'source-length-meter');
        meter.dataset.level = String(lenInfo.level);
        const bar = el('span', 'source-length-meter-bar');
        meter.appendChild(bar);
        const txtSpan = el('span');
        txtSpan.textContent = lenInfo.label;
        lengthLabel.innerHTML = '';
        lengthLabel.append(meter, txtSpan);
      }

      previewMeta.append(createdLabel, lengthLabel);

      const badgesWrap = el('div', 'source-preview-badges');

      if (original.place) {
        const placeBadge = el('span', 'source-badge source-badge--place badge--place');
        placeBadge.textContent = original.place;
        badgesWrap.appendChild(placeBadge);
      }

      if (dateBadge) {
        const yearBadge = el('span', 'source-badge source-badge--year badge--year');
        yearBadge.textContent = dateBadge;
        badgesWrap.appendChild(yearBadge);
      } else {
        const undatedBadge = el('span', 'source-badge source-badge--undated');
        undatedBadge.textContent = 'بدون تاريخ محدّد';
        badgesWrap.appendChild(undatedBadge);
      }

      const typeLabel = getSourceTypeLabel(original.type);
      if (typeLabel) {
        const typeBadge = el('span', 'source-badge source-badge--type badge--type');
        typeBadge.dataset.sourceId = src.id;
        typeBadge.dataset.type = original.type || 'generic';
        typeBadge.textContent = typeLabel;
        badgesWrap.appendChild(typeBadge);
      }

      if (original.issuer) {
        const issuerBadge = el('span', 'source-badge source-badge--issuer');
        issuerBadge.textContent = original.issuer;
        badgesWrap.appendChild(issuerBadge);
      }

      if (original.referenceCode) {
        const refBadge = el('span', 'source-badge source-badge--reference');
        refBadge.textContent = original.referenceCode;
        badgesWrap.appendChild(refBadge);
      }

      if (original.files && original.files.length) {
        const filesBadge = el('span', 'source-badge source-badge--files');
        filesBadge.textContent = `${original.files.length} ملف مرفق`;
        badgesWrap.appendChild(filesBadge);
      }

      if (original.confidenceLevel) {
        const confCode = original.confidenceLevel;
        const confBadge = el('span', 'source-badge source-badge--confidence');
        confBadge.dataset.level = confCode;
        const confLabel = CONFIDENCE_LEVEL_LABELS[confCode] || 'درجة اعتماد غير محددة';
        confBadge.textContent = confLabel;
        badgesWrap.appendChild(confBadge);
      }

      if (original.confidentiality) {
        const confCode = original.confidentiality;
        const confBadge = el('span', 'source-badge source-badge--confidentiality');
        confBadge.dataset.level = confCode;
        const confLabel = CONFIDENTIALITY_LABELS[confCode] || 'مستوى خصوصية غير محدد';
        confBadge.textContent = confLabel;
        badgesWrap.appendChild(confBadge);
      }

      if (original.verified) {
        const verBadge = el('span', 'source-badge source-badge--verified');
        verBadge.textContent = 'موثَّق';
        badgesWrap.appendChild(verBadge);
      }

      const previewTitle = el('div', 'source-preview-title');
      previewTitle.textContent = original.title || 'وثيقة بدون عنوان';

      if (original.confidentiality && original.confidentiality !== 'public') {
        const lockIcon = el('span', 'source-lock-icon');
        lockIcon.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
        previewTitle.appendChild(lockIcon);
      }

      const previewMetaLine = el('div', 'source-preview-meta-line');
      const metaParts = [];
      if (typeLabel) metaParts.push(typeLabel);
      if (original.issuer) metaParts.push(original.issuer);
      if (original.referenceCode) metaParts.push(original.referenceCode);
      if (metaParts.length) previewMetaLine.textContent = metaParts.join(' • ');

      const previewNote = el('div', 'source-preview-note');
      previewNote.textContent =
        original.note ||
        'لم تُكتب ملاحظات عن هذه الوثيقة بعد. يمكنك فتح وضع التحرير لإضافة وصف مختصر.';

      const tagsWrap = el('div', 'source-tags-list');
      if (original.tags && original.tags.length) {
        original.tags.forEach(tag => {
          const chip = el(
            'button',
            'source-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
          );
          chip.type = 'button';
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            currentTagFilter = currentTagFilter === tag ? '' : tag;
            renderList();
          });
          tagsWrap.appendChild(chip);
        });
      }

      const previewFilesWrap = el('div', 'source-preview-images');

      const sliderBtn = el('button', 'source-files-slider-btn');
      sliderBtn.type = 'button';
      sliderBtn.innerHTML =
        '<i class="fa-solid fa-images" aria-hidden="true"></i> ' +
        '<span>عرض الصور كشرائح</span>';

      function makeGroupTitle(txt) {
        const t = el('div', 'source-files-group-title');
        t.textContent = txt;
        return t;
      }
      function makeDivider() {
        return el('div', 'source-files-group-divider');
      }

      function renderPreviewFiles() {
        previewFilesWrap.innerHTML = '';

        const orderedRefs = groupRefsByKind(original.files || []);
        const images = orderedRefs.filter(r => getSourceFileKind(r) === 'image');
        const others = orderedRefs.filter(r => getSourceFileKind(r) !== 'image');
        const hasTwoGroups = images.length && others.length;

        if (hasTwoGroups && images.length) previewFilesWrap.appendChild(makeGroupTitle('الصور'));

        const renderThumb = (ref, idx, totalRefs, imagesOnly) => {
          const thumb = el('div', 'source-file-thumb source-file-thumb--preview');
          classifyFileThumb(thumb, ref);

          const kind = getSourceFileKind(ref);
          const isDoc = (kind === 'word' || kind === 'excel');

          const footerRow = el('div', 'source-file-thumb-footer');
          const label = el('span', 'source-file-label');
          label.textContent =
            kind === 'image' ? 'صورة' :
            kind === 'pdf' ? 'PDF' :
            kind === 'word' ? 'Word' :
            kind === 'excel' ? 'Excel' : 'ملف';

          const actionBtn = el('button', 'source-file-thumb-view');
          actionBtn.type = 'button';
          actionBtn.textContent = kind === 'image' ? 'معاينة' : (isDoc ? 'تحميل' : 'فتح');

          footerRow.append(label, actionBtn);

          if (kind === 'image') {
            const imgEl = el('img');
            imgEl.alt = 'صورة مرفقة';
            resolveSourceFileUrlLocal(ref).then(url => { if (url) imgEl.src = url; });

            const imageIndex = findImageIndex(imagesOnly, ref);

            actionBtn.title = 'معاينة الصورة بحجم أكبر';
        actionBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
});
imgEl.addEventListener('click', () => {
  if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
});


            thumb.append(imgEl, footerRow);
          } else {
            const icon = el('div', 'source-file-icon');
            icon.innerHTML = {
              pdf: '<i class="fa-solid fa-file-pdf"></i>',
              word: '<i class="fa-solid fa-file-word"></i>',
              excel: '<i class="fa-solid fa-file-excel"></i>',
              other: '<i class="fa-solid fa-file"></i>'
            }[kind] || '<i class="fa-solid fa-file"></i>';

            actionBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (isDoc) {
                openOrDownloadRef(ref, {
                  preferDownload: true,
                  baseTitle: original.title || 'الوثيقة',
                  index: idx,
                  total: totalRefs
                });
                return;
              }
              openInNewTabSafe(resolveSourceFileUrlLocal(ref));
            });

            thumb.style.cursor = 'pointer';
            thumb.addEventListener('click', (e) => {
              if (e.target === actionBtn) return;
              if (isDoc) {
                openOrDownloadRef(ref, {
                  preferDownload: true,
                  baseTitle: original.title || 'الوثيقة',
                  index: idx,
                  total: totalRefs
                });
              } else {
                openInNewTabSafe(resolveSourceFileUrlLocal(ref));
              }
            });

            thumb.append(icon, footerRow);
          }

          previewFilesWrap.appendChild(thumb);
        };

        // صور
        images.forEach((ref, idx) => renderThumb(ref, idx, images.length, images));

        // زر الشرائح: يظهر فقط إذا عندنا صورتين أو أكثر
        sliderBtn.style.display = images.length < 2 ? 'none' : '';
        sliderBtn.onclick = () => {
          if (images.length < 2) return;
          openSourceSlider(images, 0, resolveSourceFileUrlLocal);
        };

        if (images.length) {
          const sliderRow = el('div', 'source-files-slider-row');
          sliderRow.appendChild(sliderBtn);
          previewFilesWrap.appendChild(sliderRow);
        } else {
          sliderBtn.style.display = 'none';
        }

        // ملفات أخرى
        if (hasTwoGroups) {
          previewFilesWrap.appendChild(makeDivider());
          previewFilesWrap.appendChild(makeGroupTitle('الملفات'));
        }
        others.forEach((ref, idx) => renderThumb(ref, idx, others.length, images));
      }

      renderPreviewFiles();

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
          await openOrDownloadRef(files[i], {
            preferDownload: true,
            baseTitle,
            index: i,
            total: files.length
          });
        }
      });

      if (original.files && original.files.length) actionsWrap.append(downloadBtn);

      previewBox.append(
        previewTitle,
        previewMetaLine,
        badgesWrap,
        previewMeta,
        previewNote,
        tagsWrap,
        previewFilesWrap,
        actionsWrap
      );
      card.appendChild(previewBox);

      /* =======================
         B) التحرير (Edit)
         ======================= */

      const editBox = el('div', 'source-edit');
      const head = el('div', 'source-head');

      const titleInput = el('input', 'source-title-input');
      titleInput.type = 'text';
      titleInput.name = `source_title_${src.id}`;
      titleInput.placeholder = 'اسم الوثيقة (مثلاً: شهادة ميلاد، صك ملكية...)';
      titleInput.value = original.title;

      const editIcon = el('span', 'source-edit-icon');
      editIcon.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>';

      const dates = el('div', 'source-dates');
      dates.textContent = src.createdAt ? `أضيفت في ${formatFullDateTime(src.createdAt) || ''}` : '';

      head.append(titleInput, editIcon, dates);
      editBox.appendChild(head);

      const body = el('div', 'source-body');
      const metaRow = el('div', 'source-meta-row');

      const typeSelect = el('select', 'source-type-select');
      typeSelect.name = `source_type_${src.id}`;
      SOURCE_TYPE_OPTIONS.filter(([val]) => val && val !== 'all').forEach(([val, label]) => {
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        typeSelect.appendChild(opt);
      });
      typeSelect.value = original.type || 'generic';

      const typeField = el('div', 'source-meta-field');
      const typeLabelBox = el('div', 'source-meta-label');
      typeLabelBox.innerHTML =
        '<span class="source-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الوثيقة';
      typeField.append(typeLabelBox, typeSelect);

      const dateInput = el('input');
      dateInput.type = 'date';
      dateInput.name = `source_date_${src.id}`;
      dateInput.value = original.date || '';

      const dateField = el('div', 'source-meta-field');
      const dateLabel = el('div', 'source-meta-label');
      dateLabel.innerHTML =
        '<span class="source-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الوثيقة';
      dateField.append(dateLabel, dateInput);

      const placeInput = el('input');
      placeInput.type = 'text';
      placeInput.name = `source_place_${src.id}`;
      placeInput.placeholder = 'مكان الإصدار (مدينة / دولة)...';
      placeInput.value = original.place;

      const placeField = el('div', 'source-meta-field');
      const placeLabel = el('div', 'source-meta-label');
      placeLabel.innerHTML =
        '<span class="source-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> مكان الإصدار';
      placeField.append(placeLabel, placeInput);

      const forFieldInput = el('input');
      forFieldInput.type = 'text';
      forFieldInput.name = `source_for_${src.id}`;
      forFieldInput.placeholder = 'هذه الوثيقة متعلقة بماذا؟ (مثلاً: الميلاد، الزواج، النسب...)';
      forFieldInput.value = original.forField;

      const referenceInput = el('input');
      referenceInput.type = 'text';
      referenceInput.name = `source_ref_${src.id}`;
      referenceInput.placeholder = 'رقم الصك / رقم الوثيقة / رقم المعاملة...';
      referenceInput.value = original.referenceCode;

      const issuerInput = el('input');
      issuerInput.type = 'text';
      issuerInput.name = `source_issuer_${src.id}`;
      issuerInput.placeholder = 'الجهة المصدرة (مثلاً: وزارة العدل، الأحوال المدنية...)';
      issuerInput.value = original.issuer;

      const pagesInput = el('input');
      pagesInput.type = 'text';
      pagesInput.name = `source_pages_${src.id}`;
      pagesInput.placeholder = 'عدد الصفحات أو نطاقها (اختياري)';
      pagesInput.value = original.pages;

      const confidenceSelect = el('select');
      confidenceSelect.name = `source_confidence_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['official', 'رسمي'],
        ['family', 'عائلي موثوق'],
        ['oral', 'رواية شفوية'],
        ['copy', 'نسخة غير أصلية']
      ].forEach(([val, label]) => {
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        confidenceSelect.appendChild(opt);
      });
      confidenceSelect.value = original.confidenceLevel || '';

      const confidentialitySelect = el('select');
      confidentialitySelect.name = `source_confidentiality_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['public', 'عام للأقارب'],
        ['private', 'خاص (للمالك فقط)'],
        ['sensitive', 'حساس']
      ].forEach(([val, label]) => {
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        confidentialitySelect.appendChild(opt);
      });
      confidentialitySelect.value = original.confidentiality || '';

      const verifiedCheckbox = el('input');
      verifiedCheckbox.type = 'checkbox';
      verifiedCheckbox.name = `source_verified_${src.id}`;
      verifiedCheckbox.checked = original.verified;

      const verifiedByInput = el('input');
      verifiedByInput.type = 'text';
      verifiedByInput.name = `source_verified_by_${src.id}`;
      verifiedByInput.placeholder = 'تم التوثيق بواسطة من؟ (مثلاً: كبير الأسرة، جهة رسمية)';
      verifiedByInput.value = original.verifiedBy;

      const verifiedAtInput = el('input');
      verifiedAtInput.type = 'date';
      verifiedAtInput.name = `source_verified_at_${src.id}`;
      verifiedAtInput.value = original.verifiedAt || '';

      const verifiedWrap = el('div', 'source-details-field source-details-field--full');
      const verifiedLabel = el('div', 'source-details-label');
      verifiedLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-file-circle-check" aria-hidden="true"></i></span> حالة التحقق من الوثيقة';

      const verifiedInlineTop = el('div', 'source-verified-inline');
      const verifiedChkLabel = el('label', 'source-verified-check-label');
      verifiedChkLabel.append(
        verifiedCheckbox,
        textEl('span', 'تم التحقق من صحة هذا المصدر')
      );
      verifiedInlineTop.append(verifiedChkLabel);

      const verifiedByWrap = el('div', 'source-details-field');
      const verifiedByLabel = el('div', 'source-details-label');
      verifiedByLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-user-check" aria-hidden="true"></i></span> تم التوثيق بواسطة';
      verifiedByWrap.append(verifiedByLabel, verifiedByInput);

      const verifiedAtWrap = el('div', 'source-details-field');
      const verifiedAtLabel = el('div', 'source-details-label');
      verifiedAtLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i></span> تاريخ التوثيق';
      verifiedAtWrap.append(verifiedAtLabel, verifiedAtInput);

      verifiedWrap.append(
        verifiedLabel,
        verifiedInlineTop,
        verifiedByWrap,
        verifiedAtWrap
      );

      const noteInput = el('textarea', 'source-note-input');
      noteInput.name = `source_note_${src.id}`;
      noteInput.placeholder = 'ملخص محتوى الوثيقة، أو ما يثبته هذا المستند من معلومات.';
      noteInput.value = original.note;

      const tagsInput = el('input');
      tagsInput.type = 'text';
      tagsInput.name = `source_tags_${src.id}`;
      tagsInput.placeholder = 'وسوم الوثيقة (افصل بينها بفواصل مثل: ميلاد, رسمية, محكمة)';
      tagsInput.value = original.tags.join(', ');

      /* ---------- ملفات الوثيقة (إرفاق + عرض + ترتيب) ---------- */
      const filesBlock = el('div', 'source-files-block');
      const emptyFilesHint = el('div', 'source-files-empty-hint');
      const filesRow = el('div', 'source-files-row');
      const filesThumbs = el('div', 'source-files-thumbs');

      const addFileLabel = el('label', 'source-file-add-btn');
      const addFileIcon = el('span', 'source-file-add-icon');
      addFileIcon.innerHTML = '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>';

      const addFileText = el('span', 'source-file-add-text');
      addFileText.textContent = 'إرفاق صور للوثيقة';

      const fileInput = el('input');
      fileInput.type = 'file';
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
      filesBlock.append(emptyFilesHint, filesRow, addFileLabel);

      const pinWrap = el('label', 'source-pin-toggle');
      const pinCheckbox = el('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.name = `source_pinned_${src.id}`;
      pinCheckbox.checked = original.pinned;
      const pinText = textEl('span', 'تعيين هذه الوثيقة كمرجع أساسي لهذا الشخص');
      pinWrap.append(pinCheckbox, pinText);

      function updateAddFileLabel() {
        const count = currentFiles.length || 0;
        if (!count) {
          addFileText.textContent = 'إرفاق صور للوثيقة';
          addFileLabel.title = 'أرفق أول صورة أو مسح ضوئي لهذه الوثيقة';
        } else if (count === 1) {
          addFileText.textContent = 'إضافة وثيقة أخرى';
          addFileLabel.title = 'أضف صورة أخرى لنفس الوثيقة (صفحة ثانية مثلاً)';
        } else {
          addFileText.textContent = 'إضافة مزيد من الوثائق';
          addFileLabel.title = `هناك ${count} صور مرفقة حاليًا`;
        }
      }

      let sortableInited = false;
      function setupFilesSortable() {
        if (sortableInited) return;
        sortableInited = true;

        attachHorizontalSortable({
          container: filesThumbs,
          itemSelector: '.source-file-thumb',
          ghostClass: 'source-file-thumb--ghost',
          dragClass: 'source-file-thumb--drag',
          onSorted(orderedRefs) {
            // حافظ على التجميع: صور ثم غير صور (مع السماح بالترتيب داخل كل مجموعة)
            currentFiles = groupRefsByKind(orderedRefs);
            renderThumbs();
            recomputeDirty();
          }
        });
      }

      function renderThumbs() {
        filesThumbs.innerHTML = '';

        const ordered = groupRefsByKind(currentFiles);
        currentFiles = ordered;

        const images = ordered.filter(r => getSourceFileKind(r) === 'image');
        const others = ordered.filter(r => getSourceFileKind(r) !== 'image');
        const hasTwoGroups = images.length && others.length;

        if (!currentFiles.length) {
          emptyFilesHint.textContent = 'لم تُرفق صور بعد لهذه الوثيقة.';
          emptyFilesHint.style.display = '';
          updateAddFileLabel();
          return;
        }

        emptyFilesHint.style.display = 'none';

        if (hasTwoGroups && images.length) filesThumbs.appendChild(makeGroupTitle('الصور'));

        const renderOneThumb = (ref, idx, totalRefs, imagesOnly) => {
          const thumb = el('div', 'source-file-thumb');
          thumb.dataset.ref = ref;
          classifyFileThumb(thumb, ref);

          const kind = getSourceFileKind(ref);
          const isDoc = (kind === 'word' || kind === 'excel');

          // المحتوى: صورة أو أيقونة
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
            const icon = el('div', 'source-file-icon');
            icon.innerHTML = {
              pdf: '<i class="fa-solid fa-file-pdf"></i>',
              word: '<i class="fa-solid fa-file-word"></i>',
              excel: '<i class="fa-solid fa-file-excel"></i>',
              other: '<i class="fa-solid fa-file"></i>'
            }[kind] || '<i class="fa-solid fa-file"></i>';

            const openIt = () => {
              if (isDoc) {
                openOrDownloadRef(ref, {
                  preferDownload: true,
                  baseTitle: original.title || 'الوثيقة',
                  index: idx,
                  total: totalRefs
                });
              } else {
                openInNewTabSafe(resolveSourceFileUrlLocal(ref));
              }
            };

            icon.style.cursor = 'pointer';
            icon.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
            thumb.addEventListener('click', openIt);

            thumbContent = icon;
          }

          // زر الحذف
          const removeBtn = el('button', 'source-file-thumb-remove');
          removeBtn.type = 'button';
          removeBtn.title = 'إزالة هذا الملف';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const removeRef = ref;

            if (removeRef && String(removeRef).startsWith('idb:')) {
              pendingDeletedFiles.push(removeRef);
            }
if (removeRef && String(removeRef).startsWith('tmp:')) {
  revokeTempRef(removeRef);
}

            currentFiles = currentFiles.filter(r => r !== removeRef);
            renderThumbs();
            recomputeDirty();
          });

          // زر "معاينة/فتح/تحميل"
          const viewBtn = el('button', 'source-file-thumb-view');
          viewBtn.type = 'button';
          viewBtn.textContent =
            kind === 'image' ? 'معاينة' :
            isDoc ? 'تحميل' :
            'فتح';

          viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();

           if (kind === 'image') {
  const imageIndex = findImageIndex(imagesOnly, ref);
  if (imageIndex >= 0) openSourceSlider(imagesOnly, imageIndex, resolveSourceFileUrlLocal);
  return;
}


            if (isDoc) {
              openOrDownloadRef(ref, {
                preferDownload: true,
                baseTitle: original.title || 'الوثيقة',
                index: idx,
                total: totalRefs
              });
              return;
            }

            openInNewTabSafe(resolveSourceFileUrlLocal(ref));
          });

          thumb.append(thumbContent, removeBtn, viewBtn);
          filesThumbs.appendChild(thumb);
        };

        // صور
        images.forEach((ref, idx) => renderOneThumb(ref, idx, images.length, images));

        // ملفات أخرى
        if (hasTwoGroups) {
          filesThumbs.appendChild(makeDivider());
          filesThumbs.appendChild(makeGroupTitle('الملفات'));
        }
        others.forEach((ref, idx) => renderOneThumb(ref, idx, others.length, images));

        updateAddFileLabel();
        setupFilesSortable();
      }

      renderThumbs();

      // إضافة ملفات جديدة
      fileInput.addEventListener('change', async () => {
        let files = Array.from(fileInput.files || []);
        if (!files.length) return;

        if (files.length > MAX_FILES_PER_PICK) {
          showWarning?.(`تم اختيار ${files.length} ملف. سيتم رفع أول ${MAX_FILES_PER_PICK} فقط.`);
          files = files.slice(0, MAX_FILES_PER_PICK);
        }

 for (const file of files) {
  const check = isAllowedSourceFile(file);
  if (!check.ok) {
    showWarning?.(`${file.name || 'ملف'}: ${check.reason}`);
    continue;
  }

  try {
    const tmpRef = addTempFile(file);

    // لا تكرر push
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

      /* ---------- تفاصيل إضافية ---------- */
      const detailsGrid = el('div', 'source-details-grid');

      const forFieldWrap = el('div', 'source-details-field');
      const forFieldLabel = el('div', 'source-details-label');
      forFieldLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-bullseye" aria-hidden="true"></i></span> هذه الوثيقة متعلقة بـ';
      forFieldWrap.append(forFieldLabel, forFieldInput);

      const issuerWrap = el('div', 'source-meta-field');
      const issuerLabel = el('div', 'source-details-label');
      issuerLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-landmark" aria-hidden="true"></i></span> الجهة المصدرة';
      issuerWrap.append(issuerLabel, issuerInput);

      const refWrap = el('div', 'source-meta-field');
      const refLabel = el('div', 'source-details-label');
      refLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-hashtag" aria-hidden="true"></i></span> رقم الصك / رقم الوثيقة';
      refWrap.append(refLabel, referenceInput);

      const pagesWrap = el('div', 'source-details-field');
      const pagesLabel = el('div', 'source-details-label');
      pagesLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span> عدد الصفحات (اختياري)';
      pagesWrap.append(pagesLabel, pagesInput);

      const noteWrap = el('div', 'source-details-field source-details-field--full');
      const noteLabel = el('div', 'source-details-label');
      noteLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></span> ملخص محتوى الوثيقة';
      noteWrap.append(noteLabel, noteInput);

      const tagsWrapField = el('div', 'source-details-field source-details-field--full');
      const tagsLabel = el('div', 'source-details-label');
      tagsLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> وسوم الوثيقة';
      tagsWrapField.append(tagsLabel, tagsInput);

      typeField.classList.add('source-meta-field--primary');
      issuerWrap.classList.add('source-meta-field--primary');
      refWrap.classList.add('source-meta-field--primary');

      metaRow.append(typeField, issuerWrap, refWrap, dateField, placeField);

      const confWrap = el('div', 'source-details-field');
      const confLabel = el('div', 'source-details-label');
      confLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span> درجة الاعتماد على المصدر';
      confWrap.append(confLabel, confidenceSelect);

      const confPrivWrap = el('div', 'source-details-field');
      const confPrivLabel = el('div', 'source-details-label');
      confPrivLabel.innerHTML =
        '<span class="source-details-icon"><i class="fa-solid fa-lock" aria-hidden="true"></i></span> مستوى السرية / الخصوصية';
      confPrivWrap.append(confPrivLabel, confidentialitySelect);

      detailsGrid.append(
        forFieldWrap,
        pagesWrap,
        confWrap,
        confPrivWrap,
        verifiedWrap,
        noteWrap,
        tagsWrapField
      );

      body.append(metaRow, detailsGrid, filesBlock, pinWrap);
      editBox.appendChild(body);
      card.appendChild(editBox);

      /* =======================
         C) Footer (Actions)
         ======================= */

      const footer = el('div', 'source-footer');

      const saveBtn = el('button', 'source-save-btn');
      saveBtn.type = 'button';
      saveBtn.innerHTML =
        '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>تعديل</span>';

      const cancelBtn = el('button', 'source-cancel-btn');
      cancelBtn.type = 'button';
      cancelBtn.innerHTML =
        '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>إلغاء التعديل</span>';

      const delBtn = el('button', 'source-delete-btn');
      delBtn.type = 'button';
      delBtn.innerHTML =
        '<i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>حذف الوثيقة</span>';

      footer.append(saveBtn, cancelBtn, delBtn);
      card.appendChild(footer);

      function applyMode() {
        const toEdit = !!isEditing;

        card.classList.toggle('source-card--edit', toEdit);
        card.classList.toggle('source-card--preview', !toEdit);

        if (previewBox) previewBox.style.display = toEdit ? 'none' : '';
        if (editBox) editBox.style.display = toEdit ? '' : 'none';

        if (dates) dates.style.display = toEdit ? 'none' : '';

        if (!toEdit) {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>تعديل</span>';
        } else if (!isDirty) {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-xmark" aria-hidden="true"></i><span>إغلاق</span>';
        } else {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>حفظ</span>';
        }

        cancelBtn.style.display = toEdit && isDirty ? '' : 'none';
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
        const curTags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
        const curPinned = !!pinCheckbox.checked;

        const curConfidence = confidenceSelect.value.trim();
        const curConfidentiality = confidentialitySelect.value.trim();
        const curVerified = !!verifiedCheckbox.checked;
        const curVerifiedBy = verifiedByInput.value.trim();
        const curVerifiedAt = verifiedAtInput.value || null;

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
          curVerifiedAt !== (original.verifiedAt || null);

        applyMode();
      }

      applyMode();

      // مراقبة تغييرات الحقول (Dirty)
      titleInput.addEventListener('input', recomputeDirty);
      typeSelect.addEventListener('change', recomputeDirty);
      dateInput.addEventListener('change', recomputeDirty);
      placeInput.addEventListener('input', recomputeDirty);
      forFieldInput.addEventListener('input', recomputeDirty);
      referenceInput.addEventListener('input', recomputeDirty);
      issuerInput.addEventListener('input', recomputeDirty);
      pagesInput.addEventListener('input', recomputeDirty);
      noteInput.addEventListener('input', recomputeDirty);
      tagsInput.addEventListener('input', recomputeDirty);
      pinCheckbox.addEventListener('change', recomputeDirty);
      confidenceSelect.addEventListener('change', recomputeDirty);
      confidentialitySelect.addEventListener('change', recomputeDirty);
      verifiedCheckbox.addEventListener('change', recomputeDirty);
      verifiedByInput.addEventListener('input', recomputeDirty);
      verifiedAtInput.addEventListener('change', recomputeDirty);

      /* ---------- حفظ/إغلاق ---------- */
      saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = src.id;
          applyMode();
          showInfo?.('يمكنك الآن تعديل بيانات الوثيقة ثم الضغط على "حفظ" لتثبيت التعديلات.');
          return;
        }

        if (isEditing && !isDirty) {
          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر الوثيقة.');
          return;
        }
        const hasTmp = currentFiles.some(r => String(r || '').startsWith('tmp:'));
if (hasTmp && typeof DB?.putSourceFile !== 'function') {
  showError?.('ميزة حفظ الملفات غير متاحة حالياً (DB.putSourceFile غير موجود).');
  return;
}

// 1) حوّل tmp:... إلى idb:... قبل تثبيت البيانات
const upgradedFiles = [];
for (const r of currentFiles) {
  const ref = String(r || '');

  if (!ref.startsWith('tmp:')) {
    upgradedFiles.push(ref);
    continue;
  }

  const rec = tempSourceFilesCache.get(ref);
  if (!rec?.file) continue;

  try {
    const idbRef = await DB.putSourceFile({
      file: rec.file,
      personId,
      sourceId: src.id,
      meta: rec.meta
    });

    if (idbRef) {
      // سخّن كاش الميتا ليتعرف عليه UI فوراً
      sourceFileMetaCache.set(String(idbRef), rec.meta);
      upgradedFiles.push(String(idbRef));
    }
  } catch (e) {
    console.error('Failed to store temp file', ref, e);
    showError?.('تعذّر حفظ أحد الملفات. لم يتم حفظ التعديلات.');
    return; // مهم: أوقف الحفظ إذا فشل أي ملف
  } finally {
    // نظّف tmp
    revokeTempRef(ref);
  }
}

currentFiles = upgradedFiles;

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
            tags: tagsInput.value.split(',').map(t => t.trim()).filter(Boolean),
            files: currentFiles,
            pinned: !!pinCheckbox.checked,

            confidenceLevel: confidenceSelect.value.trim(),
            confidentiality: confidentialitySelect.value.trim(),
            verified: !!verifiedCheckbox.checked,
            verifiedBy: verifiedByInput.value.trim(),
            verifiedAt: verifiedAtInput.value || null
          },
          {
            onChange: (sources, changed) => {
              if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, changed);
              emitSourcesToHost();
            }
          }
        );

        const effective = updated || src;

        // تحديث الأصل بعد الحفظ
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

        currentFiles = [...original.files];

        // حذف الملفات المؤجلة من IndexedDB
        for (const ref of pendingDeletedFiles) {
          try {
            if (typeof DB?.deleteSourceFile === 'function') {
              await DB.deleteSourceFile(ref);
            }
          } catch (e) {
            console.error('Failed to delete source file from DB', ref, e);
          }
        }
        pendingDeletedFiles = [];

        // تحديث واجهة المعاينة
        previewTitle.textContent = original.title || 'وثيقة بدون عنوان';

        const info2 = getNoteLengthInfo(original.note.length);
        if (info2.level === 0) {
          lengthLabel.textContent = 'لم تُكتب ملاحظات بعد';
        } else {
          const meter2 = el('span', 'source-length-meter');
          meter2.dataset.level = String(info2.level);
          const bar2 = el('span', 'source-length-meter-bar');
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
          const lbl = `أضيفت في ${formatFullDateTime(effective.createdAt) || ''}`;
          dates.textContent = lbl;
          createdLabel.textContent = lbl;
        }

        renderPreviewFiles();

        isEditing = false;
        lastEditedId = null;
        isDirty = false;

        sortSources(person, sortMode);
        renderList();
        showSuccess?.('تم حفظ بيانات الوثيقة بنجاح.');
      });

      /* ---------- إلغاء ---------- */
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
// امسح أي tmp refs كانت مضافة خلال جلسة التحرير
for (const r of currentFiles) {
  if (String(r).startsWith('tmp:')) revokeTempRef(String(r));
}

        currentFiles = [...original.files];
        pendingDeletedFiles = [];
        renderThumbs();
        renderPreviewFiles();

        if (src.createdAt) {
          const lbl = `أضيفت في ${formatFullDateTime(src.createdAt) || ''}`;
          dates.textContent = lbl;
          createdLabel.textContent = lbl;
        }

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        applyMode();

        showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من الوثيقة.');
      });

      /* ---------- حذف وثيقة ---------- */
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

  // احذف ملفات الوثيقة من IndexedDB قبل حذف الوثيقة نفسها
  const refs = Array.isArray(src.files) ? src.files : [];
  for (const ref of refs) {
    if (!String(ref).startsWith('idb:')) continue;
    try {
      await DB?.deleteSourceFile?.(ref);
    } catch (e) {
      console.error('deleteSourceFile failed', ref, e);
    }
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
  renderList();
  showSuccess?.('تم حذف الوثيقة بنجاح.');
});


      list.appendChild(card);
    });

    autoResizeSourceTextareas(list);
  }

  /* ==========================================================================
     6.4) أحداث القسم العامة (إضافة/فرز/تصفية/عرض)
     ========================================================================== */

  addBtn.addEventListener('click', () => {
    ensureSources(person);

    const draft = person.sources.find(s => {
      const t = String(s.title || '').trim();
      const ref = String(s.referenceCode || '').trim();
      const files = Array.isArray(s.files) ? s.files : [];
      return !t && !ref && files.length === 0;
    });

    if (draft) {
      lastEditedId = draft.id;
      renderList();
      const card = list.querySelector(`.source-card[data-source-id="${draft.id}"]`);
      const input = card?.querySelector('.source-title-input');
      if (input) input.focus();
      showWarning?.('لديك مسودة وثيقة مفتوحة بالفعل. أكمل تعبئتها أولاً قبل إضافة وثيقة جديدة.');
      return;
    }

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
        files: []
      },
      {
        onChange: (sources, changed) => {
          if (typeof handlers.onDirty === 'function') handlers.onDirty(sources, changed);
          emitSourcesToHost();
        }
      }
    );

    if (!src) {
      showError?.('تعذر إنشاء وثيقة جديدة. حاول مرة أخرى.');
      return;
    }

    lastEditedId = src.id;
    renderList();
    showSuccess?.('تمت إضافة وثيقة جديدة. أدخل بياناتها ثم اضغط "حفظ" لتثبيتها.');
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'oldest' ? 'oldest' : 'latest';
    sortSources(person, mode);
    if (typeof handlers.onDirty === 'function') handlers.onDirty(person.sources);
    emitSourcesToHost();
    renderList();
    showInfo?.(
      mode === 'latest' ? 'تم ترتيب الوثائق من الأحدث إلى الأقدم.'
        : 'تم ترتيب الوثائق من الأقدم إلى الأحدث.'
    );
  });

  typeFilterSelect.addEventListener('change', () => {
    const val = typeFilterSelect.value;
    currentTypeFilter = val || 'all';
    renderList();
  });

  searchInput.addEventListener('input', () => {
    currentSearchTerm = searchInput.value || '';
    renderList();
  });

  pinnedFilterCheckbox.addEventListener('change', () => {
    onlyPinned = !!pinnedFilterCheckbox.checked;
    renderList();
  });

  function setViewMode(mode) {
    viewMode = mode === 'table' ? 'table' : 'cards';
    viewBtnCards.classList.toggle('is-active', viewMode === 'cards');
    viewBtnTable.classList.toggle('is-active', viewMode === 'table');
    renderList();
  }

  viewBtnCards.addEventListener('click', () => setViewMode('cards'));
  viewBtnTable.addEventListener('click', () => setViewMode('table'));

  // تشغيل أولي
  renderList();
  emitSourcesToHost();

  return root;
}