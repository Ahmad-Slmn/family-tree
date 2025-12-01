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

// ====================== صور/ملفات المصادر عبر IndexedDB ======================
// ref: مثل 'idb:source_123' يُخزن داخل source.files
// هذه الدالة تعطي URL صالح للعرض (blob: أو http أو data:)
async function resolveSourceFileUrl(ref){
  if (!ref) return null;
  const s = String(ref);

  // روابط جاهزة
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  // صيغة idb:...
  if (typeof DB?.getSourceFileURL === 'function'){
    try{
      const url = await DB.getSourceFileURL(s);
      return url || null;
    }catch(e){
      console.error('resolveSourceFileUrl failed', e);
      return null;
    }
  }

  // Fallback (لو لم تُنفّذ بعد في DB)
  return s;
}

// تخزين ملف (صورة/وثيقة ممسوحة) في IndexedDB وإرجاع المرجع
async function storeSourceFile(file, personId, sourceId){
  if (!file) return null;

  if (typeof DB?.putSourceFile === 'function'){
    try{
      const ref = await DB.putSourceFile({ file, personId, sourceId });
      return ref || null;
    }catch(e){
      console.error('storeSourceFile failed', e);
      return null;
    }
  }

  // Fallback مؤقت: تخزين DataURL (غير مفضل ملفياً)
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = err => reject(err);
    reader.onload = ev => resolve(String(ev.target?.result || ''));
    reader.readAsDataURL(file);
  });
}

// ====================== منطق البيانات ======================

const SOURCE_TYPE_LABELS = {
  generic:     'عام',
  birth:       'ميلاد',
  marriage:    'زواج',
  death:       'وفاة',
  id:          'هوية / بطاقة',
  inheritance: 'ميراث / قسمة',
  property:    'ملكية / عقار',
  other:       'أخرى'
};

const SOURCE_TYPE_OPTIONS = [
  ['all',       'كل الأنواع'],
  ['generic',   'عام'],
  ['birth',     'ميلاد'],
  ['marriage',  'زواج'],
  ['death',     'وفاة'],
  ['id',        'هوية / بطاقة'],
  ['inheritance','ميراث / قسمة'],
  ['property',  'ملكية / عقار'],
  ['other',     'أخرى']
];

function getSourceTypeLabel(code){
  return SOURCE_TYPE_LABELS[code] || '';
}

function getNoteLengthInfo(len){
  if (!len) return { label:'بدون وصف', level:0 };
  if (len <= 140) return { label:'وصف قصير', level:1 };
  if (len <= 400) return { label:'وصف متوسط', level:2 };
  return { label:'وصف مطوّل', level:3 };
}

const CONFIDENCE_LEVEL_LABELS = {
  official: 'رسمي',
  family:   'عائلي موثوق',
  oral:     'رواية شفوية',
  copy:     'نسخة غير أصلية'
};

const CONFIDENTIALITY_LABELS = {
  public:    'عام للأقارب',
  private:   'خاص (للمالك فقط)',
  sensitive: 'حساس'
};


function normalizeSource(raw){
  const now = new Date().toISOString();
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    id: String(raw.id || 'src_' + Math.random().toString(36).slice(2)),
    title: String(raw.title || '').trim(),              // اسم الوثيقة
    type: (raw.type || '').trim(),                     // birth / marriage / ...
    forField: (raw.forField || '').trim(),             // الميلاد / الزواج / النسب / غيرها (نصي)
    date: raw.date || null,                            // تاريخ إصدار الوثيقة
    place: (raw.place || '').trim(),                   // مكان الإصدار
    referenceCode: (raw.referenceCode || '').trim(),   // رقم الصك / المرجع
    issuer: (raw.issuer || '').trim(),                 // الجهة المصدرة
    pages: (raw.pages || '').trim(),                   // عدد الصفحات (نصي اختياري)
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
    note: (raw.note || '').trim(),                     // وصف مختصر/ملاحظات
    pinned: !!raw.pinned,

    // درجة الاعتماد
    confidenceLevel: (raw.confidenceLevel || '').trim(),   // official / family / oral / copy / ...
    // ربط الحدث (يمكن استغلاله لاحقًا مع timeline)
    relatedEventId: raw.relatedEventId || null,

    // التوثيق اليدوي
    verified: !!raw.verified,
    verifiedBy: (raw.verifiedBy || '').trim(),
    verifiedAt: raw.verifiedAt || null,

    // مستوى السرية
    confidentiality: (raw.confidentiality || '').trim(),   // public / private / sensitive / ...

    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}


export function ensureSources(person){
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.sources)) person.sources = [];
  person.sources = person.sources.map(normalizeSource);
}

export function addSource(person, data={}, { onChange }={}){
  ensureSources(person);
  const src = normalizeSource(data);
  const now = new Date().toISOString();
  src.createdAt = now;
  src.updatedAt = now;
  person.sources.unshift(src);
  if (typeof onChange === 'function') onChange(person.sources, src);
  return src;
}

export function updateSource(person, sourceId, data={}, { onChange }={}){
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

export function deleteSource(person, sourceId, { onChange }={}){
  ensureSources(person);
  const idx = person.sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return false;
  const removed = person.sources.splice(idx,1)[0];
  if (typeof onChange === 'function') onChange(person.sources, removed);
  return true;
}

// الفرز: نفضّل تاريخ الوثيقة، ثم تاريخ الإنشاء
export function sortSources(person, mode='latest'){
  ensureSources(person);
  person.sources.sort((a,b)=>{
    const da = new Date(a.date || a.createdAt || a.updatedAt || 0).getTime();
    const db = new Date(b.date || b.createdAt || b.updatedAt || 0).getTime();
    return mode === 'oldest' ? (da - db) : (db - da);
  });
}

// ====================== عارض صور/ملفات المصادر ======================

const sourceImageViewer = createImageViewerOverlay({
  overlayClass: 'source-image-viewer-overlay',
  backdropClass: 'source-image-viewer-backdrop',
  dialogClass:   'source-image-viewer-dialog',
  imgClass:      'source-image-viewer-img',
  closeBtnClass: 'source-image-viewer-close',
  navClass:      'source-image-viewer-nav',
  arrowPrevClass:'source-image-viewer-arrow source-image-viewer-arrow-prev',
  arrowNextClass:'source-image-viewer-arrow source-image-viewer-arrow-next',
  counterClass:  'source-image-viewer-counter'
});

async function openSourceSlider(refs, startIndex=0){
  const list = Array.isArray(refs) ? refs : [];
  const urls = [];
  for (const r of list){
    const u = await resolveSourceFileUrl(r);
    if (u) urls.push(u);
  }
  if (!urls.length) return;
  sourceImageViewer.open(urls, startIndex);
}

function autoResizeSourceTextareas(root){
  const areas = root.querySelectorAll('.source-note-input');
  areas.forEach(ta=>{
    const resize = ()=>{
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    resize();
    ta.removeEventListener('input', ta._autoResizeHandler || (()=>{}));
    ta._autoResizeHandler = resize;
    ta.addEventListener('input', resize);
  });
}

// ====================== واجهة القسم داخل نافذة السيرة ======================

export function createSourcesSection(person, handlers={}){
  ensureSources(person);

  const personId = person && person._id ? String(person._id) : null;
  let currentTypeFilter = 'all';
  let currentTagFilter  = '';
  let currentSearchTerm = '';
  let onlyPinned        = false;
  let viewMode          = 'cards'; // 'cards' | 'table'
  let lastEditedId      = null;

  function emitSourcesToHost(){
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
  const titleEl = textEl('h3', 'المصادر والوثائق');
  const countBadge = el('span', 'sources-count-badge');
  titleEl.append(' ', countBadge);
  root.appendChild(titleEl);

  function updateSourcesCountBadge(){
    const n = (person.sources || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد وثائق بعد)';
  }

  const header = el('div', 'sources-header');
  const tools  = el('div', 'sources-tools');
  const toolsLeft  = el('div', 'sources-tools-left');
  const toolsRight = el('div', 'sources-tools-right');

  const typeFilterSelect = el('select', 'sources-type-filter');
  typeFilterSelect.name = 'sources_type_filter';
  SOURCE_TYPE_OPTIONS.forEach(([value,label])=>{
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

// حقل البحث النصي
const searchInput = el('input', 'sources-search-input');
searchInput.type = 'search';
searchInput.name = 'sources_search';
searchInput.placeholder = 'بحث في العنوان / الجهة / رقم الصك / الوصف...';

  // فلتر "الوثائق الأساسية فقط"
  const pinnedFilterLabel = el('label', 'sources-pinned-filter');
  const pinnedFilterCheckbox = el('input');
  pinnedFilterCheckbox.type = 'checkbox';
  pinnedFilterCheckbox.name = 'sources_pinned_only';
  const pinnedFilterText = textEl('span', 'عرض الوثائق الأساسية فقط');
  pinnedFilterLabel.append(pinnedFilterCheckbox, pinnedFilterText);

// تبديل وضع العرض (بطاقات / جدول مختصر) مع أيقونات
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

  const metaEl = el('div', 'sources-meta');
  metaEl.textContent =
    'اربط كل معلومة في السيرة بمصدر موثّق: صكوك، شهادات ميلاد وزواج، صكوك ميراث، بطاقات الهوية، أو صور للوثائق القديمة.';
  root.appendChild(metaEl);

  const statsBar = el('div', 'sources-stats-bar');
  root.appendChild(statsBar);

  const list = el('div', 'sources-list');
  root.appendChild(list);

function updateAddButtonLabel(){
  ensureSources(person);
  const count = person.sources.length || 0;
  if (!count){
    addBtn.innerHTML =
      '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة أول وثيقة</span>';
    addBtn.title = 'ابدأ بتوثيق أول شهادة أو صك أو وثيقة لهذا الشخص';
  }else{
    addBtn.innerHTML =
      '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i><span> إضافة وثيقة جديدة</span>';
    addBtn.title = `هناك ${count} وثائق محفوظة حتى الآن`;
  }
}


  function rebuildSourceTypeFilterOptions(){
    ensureSources(person);
    const sources = person.sources || [];

    const usedTypesSet = new Set();
    for (const s of sources){
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
        .map(([val],i)=>[val, i])
    );

    const usedTypes = Array.from(usedTypesSet);
    usedTypes.sort((a,b)=>{
      const ia = (order[a] !== undefined ? order[a] : 999);
      const ib = (order[b] !== undefined ? order[b] : 999);
      if (ia !== ib) return ia - ib;
      return String(a).localeCompare(String(b), 'ar');
    });

    usedTypes.forEach(code=>{
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
    
  function updateStatsBar(allSources){
    if (!statsBar) return;
    const sources = Array.isArray(allSources) ? allSources : [];
    if (!sources.length){
      statsBar.textContent = '';
      statsBar.style.display = 'none';
      return;
    }
    const counts = {};
    for (const s of sources){
      const t = (s.type || 'generic').trim() || 'generic';
      counts[t] = (counts[t] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([code,count])=>{
      const label = getSourceTypeLabel(code) || code;
      return `${label}: ${count}`;
    });
    statsBar.textContent = parts.join(' | ');
    statsBar.style.display = '';
  }
    
const missingWarningEl = el('div', 'sources-missing-warning');
missingWarningEl.style.display = 'none';
root.appendChild(missingWarningEl);

function updateMissingSourcesWarning(){
  ensureSources(person);
  const sources = person.sources || [];

  const hasBirthDoc = sources.some(s => (s.type || '').trim() === 'birth');
  const hasDeathDoc = sources.some(s => (s.type || '').trim() === 'death');

  const hasBirthData =
    person.birthDate || person.birthYear || person.birthPlace || person.birth; // حسب نموذجك
  const hasDeathData =
    person.deathDate || person.deathYear || person.deathPlace || person.death; // حسب نموذجك

  const msgs = [];
  if (hasBirthData && !hasBirthDoc){
    msgs.push('لا توجد وثيقة ميلاد موثقة لهذا الشخص. يمكنك إضافة شهادة الميلاد أو ما يقوم مقامها هنا.');
  }
  if (hasDeathData && !hasDeathDoc){
    msgs.push('لا توجد وثيقة وفاة موثقة لهذا الشخص. يمكنك إضافة شهادة الوفاة أو ما يقوم مقامها هنا.');
  }

  if (!msgs.length){
    missingWarningEl.textContent = '';
    missingWarningEl.style.display = 'none';
    return;
  }

  missingWarningEl.textContent = msgs.join(' ');
  missingWarningEl.style.display = '';
}



  function renderList(){
      function classifyFileThumb(thumb, ref){
  const s = String(ref || '');
  let ext = '';
  const m = s.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  if (m) ext = m[1].toLowerCase();

  let cls = 'source-file-thumb--other';
  if (/(jpe?g|png|gif|webp|bmp|svg)$/i.test(ext)) cls = 'source-file-thumb--image';
  else if (/pdf$/i.test(ext)) cls = 'source-file-thumb--pdf';
  else if (/(doc|docx|rtf|odt)$/i.test(ext)) cls = 'source-file-thumb--word';

  thumb.classList.add(cls);

  if (ext){
    const badge = el('span', 'source-file-ext');
    badge.textContent = ext.toUpperCase();
    thumb.appendChild(badge);
  }
}

    list.innerHTML = '';
    ensureSources(person);
    updateSourcesCountBadge();
    updateAddButtonLabel();
    rebuildSourceTypeFilterOptions();
    updateStatsBar(person.sources);
updateMissingSourcesWarning();

    const search = (currentSearchTerm || '').toLowerCase();

    const filtered = person.sources.filter(src=>{
      const typeOk =
        currentTypeFilter === 'all' ||
        !currentTypeFilter ||
        (src.type || '') === currentTypeFilter;

      const tagOk =
        !currentTagFilter ||
        (Array.isArray(src.tags) && src.tags.includes(currentTagFilter));

      const pinnedOk = !onlyPinned || !!src.pinned;

      let textOk = true;
      if (search){
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

    if (!filtered.length){
      const empty = el('div', 'sources-empty');
      empty.textContent = person.sources.length ? 'لا توجد وثائق مطابقة لخيارات التصفية الحالية.'
        : 'ابدأ بتسجيل الوثائق الرسمية: مثل شهادة الميلاد، عقد الزواج، صكوك الملكية أو وثائق الهوية.';
      list.appendChild(empty);
      return;
    }

    // ===== عرض جدولي مختصر =====
    if (viewMode === 'table'){
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

      filtered.forEach((src)=>{
        const typeLabel = getSourceTypeLabel((src.type || '').trim());
        const rowTitle = el('div', 'sources-table-cell sources-table-cell--title');
        rowTitle.textContent =
          (src.title || 'وثيقة بدون عنوان') +
          (typeLabel ? ` – ${typeLabel}` : '');

        const rowMeta1 = el('div', 'sources-table-cell sources-table-cell--meta');
        const issuer = (src.issuer || '').trim();
        const place  = (src.place || '').trim();
        rowMeta1.textContent = [issuer, place].filter(Boolean).join(' • ');

        const rowMeta2 = el('div', 'sources-table-cell sources-table-cell--meta');
        const dText = formatShortDateBadge(
          src.date || src.createdAt || src.updatedAt || null
        ) || '';
        const ref   = (src.referenceCode || '').trim();
        rowMeta2.textContent = [dText, ref].filter(Boolean).join(' • ');

        table.append(rowTitle, rowMeta1, rowMeta2);
      });

      list.appendChild(table);
      return;
    }

    // ===== عرض كبطاقات =====
    filtered.forEach((src, index)=>{
      const serial = index + 1;
      const card = el('article', 'source-card');
      card.dataset.sourceId = src.id;

      const indexBadge = el('div', 'source-card-index');
      indexBadge.textContent = `الوثيقة ${serial}`;

      let pinnedBadge = null;
      if (src.pinned){
        pinnedBadge = el('div', 'source-pinned-badge');
        pinnedBadge.textContent = 'وثيقة أساسية';
        card.classList.add('source-card--pinned');
      }

      const topRow = el('div', 'source-card-top');
      topRow.appendChild(indexBadge);
      if (pinnedBadge) topRow.appendChild(pinnedBadge);
      card.appendChild(topRow);

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
      let isDirty   = false;

      // ========== المعاينة ==========
      const previewBox  = el('div', 'source-preview');
      const previewMeta = el('div', 'source-preview-meta');

      const createdLabel = el('span', 'source-preview-date');
      createdLabel.textContent = src.createdAt ? `أضيفت في ${formatFullDateTime(src.createdAt) || ''}`
        : '';

      const lengthLabel = el('span', 'source-length-chip');
      const lenInfo = getNoteLengthInfo(original.note.length);
      if (lenInfo.level === 0){
        lengthLabel.textContent = 'لم تُكتب ملاحظات بعد';
      }else{
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
      if (original.place){
        const placeBadge = el('span', 'source-badge source-badge--place badge--place');
        placeBadge.textContent = original.place;
        badgesWrap.appendChild(placeBadge);
      }
      const isDated = !!dateBadge;
      if (dateBadge){
        const yearBadge = el('span', 'source-badge source-badge--year badge--year');
        yearBadge.textContent = dateBadge;
        badgesWrap.appendChild(yearBadge);
      }
      if (!isDated){
        const undatedBadge = el('span', 'source-badge source-badge--undated');
        undatedBadge.textContent = 'بدون تاريخ محدّد';
        badgesWrap.appendChild(undatedBadge);
      }

      const typeLabel = getSourceTypeLabel(original.type);
      if (typeLabel){
        const typeBadge = el('span', 'source-badge source-badge--type badge--type');
        typeBadge.dataset.sourceId = src.id;
        typeBadge.dataset.type = original.type || 'generic';
        typeBadge.textContent = typeLabel;
        badgesWrap.appendChild(typeBadge);
      }

      // الجهة المصدرة كـ badge
      if (original.issuer){
        const issuerBadge = el('span', 'source-badge source-badge--issuer');
        issuerBadge.textContent = original.issuer;
        badgesWrap.appendChild(issuerBadge);
      }

      // رقم المرجع كـ badge
      if (original.referenceCode){
        const refBadge = el('span', 'source-badge source-badge--reference');
        refBadge.textContent = original.referenceCode;
        badgesWrap.appendChild(refBadge);
      }

      // عدد الملفات المرفقة
      if (original.files && original.files.length){
        const filesBadge = el('span', 'source-badge source-badge--files');
        filesBadge.textContent = `${original.files.length} ملف مرفق`;
        badgesWrap.appendChild(filesBadge);
      }
// درجة الاعتماد على المصدر
if (original.confidenceLevel){
  const confCode = original.confidenceLevel;
  const confBadge = el('span', 'source-badge source-badge--confidence');
  confBadge.dataset.level = confCode;
  const confLabel = CONFIDENCE_LEVEL_LABELS[confCode] || 'درجة اعتماد غير محددة';
  confBadge.textContent = confLabel;
  badgesWrap.appendChild(confBadge);
}

// مستوى السرية / الخصوصية
if (original.confidentiality){
  const confCode = original.confidentiality;
  const confBadge = el('span', 'source-badge source-badge--confidentiality');
  confBadge.dataset.level = confCode;
  const confLabel = CONFIDENTIALITY_LABELS[confCode] || 'مستوى خصوصية غير محدد';
  confBadge.textContent = confLabel;
  badgesWrap.appendChild(confBadge);
}

// حالة "موثَّق"
if (original.verified){
  const verBadge = el('span', 'source-badge source-badge--verified');
  verBadge.textContent = 'موثَّق';
  badgesWrap.appendChild(verBadge);
}

      const previewTitle = el('div', 'source-preview-title');
      previewTitle.textContent = original.title || 'وثيقة بدون عنوان';
// قفل صغير للوثائق غير العامة
if (original.confidentiality && original.confidentiality !== 'public'){
  const lockIcon = el('span', 'source-lock-icon');
  lockIcon.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
  previewTitle.appendChild(lockIcon);
}
        
      // سطر ميتا مختصر: [نوع الوثيقة] • [الجهة] • [رقم الصك]
      const previewMetaLine = el('div', 'source-preview-meta-line');
      const metaParts = [];
      if (typeLabel) metaParts.push(typeLabel);
      if (original.issuer) metaParts.push(original.issuer);
      if (original.referenceCode) metaParts.push(original.referenceCode);
      if (metaParts.length){
        previewMetaLine.textContent = metaParts.join(' • ');
      }

      const previewNote = el('div', 'source-preview-note');
      previewNote.textContent =
        original.note ||
        'لم تُكتب ملاحظات عن هذه الوثيقة بعد. يمكنك فتح وضع التحرير لإضافة وصف مختصر.';

      const tagsWrap = el('div', 'source-tags-list');
      if (original.tags && original.tags.length){
        original.tags.forEach(tag=>{
          const chip = el(
            'button',
            'source-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
          );
          chip.type = 'button';
          chip.textContent = tag;
          chip.addEventListener('click', ()=>{
            currentTagFilter = currentTagFilter === tag ? '' : tag;
            renderList();
          });
          tagsWrap.appendChild(chip);
        });
      }

      const previewFilesWrap = el('div', 'source-preview-images');
      const sliderBtn = el('button', 'source-files-slider-btn');
      sliderBtn.type = 'button';
      sliderBtn.textContent = 'عرض الوثائق كشرائح';
      sliderBtn.addEventListener('click', ()=>{
        if (!original.files || original.files.length < 2) return;
        openSourceSlider(original.files, 0);
      });

      function renderPreviewFiles(){
        previewFilesWrap.innerHTML = '';
        sliderBtn.style.display =
          !original.files.length || original.files.length < 2 ? 'none' : '';

        original.files.forEach((ref, idx)=>{
          const thumb = el('div', 'source-file-thumb source-file-thumb--preview');
          const imgEl = el('img');
            classifyFileThumb(thumb, ref);

          imgEl.alt = 'صورة/وثيقة مرفقة';

          resolveSourceFileUrl(ref).then(url=>{
            if (url) imgEl.src = url;
          });

          const viewBtn = el('button', 'source-file-thumb-view');
          viewBtn.type = 'button';
          viewBtn.title = 'معاينة الوثيقة بحجم أكبر';
          viewBtn.textContent = 'معاينة';

          viewBtn.addEventListener('click', e=>{
            e.stopPropagation();
            openSourceSlider(original.files, idx);
          });

          imgEl.addEventListener('click', ()=>openSourceSlider(original.files, idx));
          thumb.append(imgEl, viewBtn);
          previewFilesWrap.appendChild(thumb);
        });
      }

      renderPreviewFiles();

      // أكشن تحميل كل الملفات المرفقة لهذه الوثيقة
      const actionsWrap = el('div', 'source-actions');

      const downloadBtn = el('button', 'source-download-btn');
      downloadBtn.type = 'button';
      const filesCount = Array.isArray(original.files) ? original.files.length : 0;
      const downloadLabel =
        filesCount > 1 ? 'تحميل الوثائق' : 'تحميل الوثيقة';
      downloadBtn.innerHTML =
         `<span class="source-download-btn-icon"><i class="fa-solid fa-download" aria-hidden="true"></i></span><span>${downloadLabel}</span>`;


      downloadBtn.addEventListener('click', async ()=>{
        if (!original.files || !original.files.length){
          showWarning?.('لا توجد أي ملفات مرفقة لهذه الوثيقة بعد.');
          return;
        }

        const files = original.files;
        const baseTitle = (original.title || 'الوثيقة').trim() || 'الوثيقة';

        for (let i = 0; i < files.length; i++){
          const ref = files[i];
          const url = await resolveSourceFileUrl(ref);
          if (!url) continue;

          const a = document.createElement('a');
          a.href = url;

          // اسم الملف: "الوثيقة" إذا واحد فقط، أو "الوثيقة (1)"، "الوثيقة (2)" ...
          const isSingle = files.length === 1;
          const filename = isSingle ? baseTitle : `${baseTitle} (${i+1})`;

          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });

      if (original.files && original.files.length){
        actionsWrap.append(downloadBtn);
      }

      previewBox.append(
        previewMeta,
        badgesWrap,
        previewTitle,
        previewMetaLine,
        previewNote,
        tagsWrap,
        previewFilesWrap,
        sliderBtn,
        actionsWrap
      );


      card.appendChild(previewBox);

      // ========== التحرير (كما هو عندك) ==========
      const editBox = el('div', 'source-edit');
      const head    = el('div', 'source-head');

      const titleInput = el('input', 'source-title-input');
      titleInput.type = 'text';
      titleInput.name = `source_title_${src.id}`;
      titleInput.placeholder = 'اسم الوثيقة (مثلاً: شهادة ميلاد، صك ملكية...)';
      titleInput.value = original.title;

   const editIcon = el('span', 'source-edit-icon');
editIcon.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>';

      const dates = el('div', 'source-dates');
      dates.textContent = src.createdAt ? `أضيفت في ${formatFullDateTime(src.createdAt) || ''}`
        : '';

      head.append(titleInput, editIcon, dates);
      editBox.appendChild(head);

      const body = el('div', 'source-body');

      // صف الميتا (نوع / تاريخ الوثيقة / مكان الإصدار)
      const metaRow = el('div', 'source-meta-row');

      const typeSelect = el('select', 'source-type-select');
      typeSelect.name = `source_type_${src.id}`;
      SOURCE_TYPE_OPTIONS
        .filter(([val])=>val && val !== 'all')
        .forEach(([val,label])=>{
          const opt = el('option');
          opt.value = val;
          opt.textContent = label;
          typeSelect.appendChild(opt);
        });
      typeSelect.value = original.type || 'generic';

      const typeField = el('div', 'source-meta-field');
      const typeLabelBox = el('div', 'source-meta-label');
      typeLabelBox.innerHTML =   '<span class="source-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الوثيقة';

      typeField.append(typeLabelBox, typeSelect);

      const dateInput = el('input');
      dateInput.type = 'date';
      dateInput.name = `source_date_${src.id}`;
      dateInput.value = original.date || '';

      const dateField = el('div', 'source-meta-field');
      const dateLabel = el('div', 'source-meta-label');
      dateLabel.innerHTML =   '<span class="source-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الوثيقة';

      dateField.append(dateLabel, dateInput);

      const placeInput = el('input');
      placeInput.type = 'text';
      placeInput.name = `source_place_${src.id}`;
      placeInput.placeholder = 'مكان الإصدار (مدينة / دولة)...';
      placeInput.value = original.place;

      const placeField = el('div', 'source-meta-field');
      const placeLabel = el('div', 'source-meta-label');
      placeLabel.innerHTML =   '<span class="source-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> مكان الإصدار';

      placeField.append(placeLabel, placeInput);

      // حقل "تتعلق بـ"
      const forFieldInput = el('input');
      forFieldInput.type = 'text';
      forFieldInput.name = `source_for_${src.id}`;
      forFieldInput.placeholder = 'هذه الوثيقة متعلقة بماذا؟ (مثلاً: الميلاد، الزواج، النسب...)';
      forFieldInput.value = original.forField;

      // رقم المرجع
      const referenceInput = el('input');
      referenceInput.type = 'text';
      referenceInput.name = `source_ref_${src.id}`;
      referenceInput.placeholder = 'رقم الصك / رقم الوثيقة / رقم المعاملة...';
      referenceInput.value = original.referenceCode;

      // الجهة المصدرة
      const issuerInput = el('input');
      issuerInput.type = 'text';
      issuerInput.name = `source_issuer_${src.id}`;
      issuerInput.placeholder = 'الجهة المصدرة (مثلاً: وزارة العدل، الأحوال المدنية...)';
      issuerInput.value = original.issuer;

        // عدد الصفحات (اختياري)
      const pagesInput = el('input');
      pagesInput.type = 'text';
      pagesInput.name = `source_pages_${src.id}`;
      pagesInput.placeholder = 'عدد الصفحات أو نطاقها (اختياري)';
      pagesInput.value = original.pages;

      // درجة الاعتماد على المصدر
      const confidenceSelect = el('select');
      confidenceSelect.name = `source_confidence_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['official', 'رسمي'],
        ['family', 'عائلي موثوق'],
        ['oral', 'رواية شفوية'],
        ['copy', 'نسخة غير أصلية']
      ].forEach(([val,label])=>{
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        confidenceSelect.appendChild(opt);
      });
      confidenceSelect.value = original.confidenceLevel || '';

      // مستوى السرية / الخصوصية
      const confidentialitySelect = el('select');
      confidentialitySelect.name = `source_confidentiality_${src.id}`;
      [
        ['', 'بدون تحديد'],
        ['public', 'عام للأقارب'],
        ['private', 'خاص (للمالك فقط)'],
        ['sensitive', 'حساس']
      ].forEach(([val,label])=>{
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        confidentialitySelect.appendChild(opt);
      });
      confidentialitySelect.value = original.confidentiality || '';

      // حالة "موثَّق"
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

      // ملاحظات / وصف
      const noteInput = el('textarea', 'source-note-input');

      noteInput.name = `source_note_${src.id}`;
      noteInput.placeholder = 'ملخص محتوى الوثيقة، أو ما يثبته هذا المستند من معلومات.';
      noteInput.value = original.note;

      // وسوم الوثيقة
      const tagsInput = el('input');
      tagsInput.type = 'text';
      tagsInput.name = `source_tags_${src.id}`;
      tagsInput.placeholder = 'وسوم الوثيقة (افصل بينها بفواصل مثل: ميلاد, رسمية, محكمة)';
      tagsInput.value = original.tags.join(', ');

      // كتلة الملفات (صور/مسح ضوئي)
      const filesBlock = el('div', 'source-files-block');
      const emptyFilesHint = el('div', 'source-files-empty-hint');

      const filesRow   = el('div', 'source-files-row');
      const filesThumbs = el('div', 'source-files-thumbs');

      const addFileLabel = el('label', 'source-file-add-btn');
     const addFileIcon  = el('span', 'source-file-add-icon');
addFileIcon.innerHTML = '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>';

      const addFileText  = el('span', 'source-file-add-text');
      addFileText.textContent = 'إرفاق صور للوثيقة';

      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      addFileLabel.append(addFileIcon, addFileText, fileInput);
      filesRow.appendChild(filesThumbs);
      filesBlock.append(
        emptyFilesHint,
        filesRow,
        addFileLabel
      );

      const pinWrap = el('label', 'source-pin-toggle');
      const pinCheckbox = el('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.name = `source_pinned_${src.id}`;
      pinCheckbox.checked = original.pinned;
      const pinText = textEl('span', 'تعيين هذه الوثيقة كمرجع أساسي لهذا الشخص');
      pinWrap.append(pinCheckbox, pinText);

      function updateAddFileLabel(){
        const count = currentFiles.length || 0;
        if (!count){
          addFileText.textContent = 'إرفاق صور للوثيقة';
          addFileLabel.title = 'أرفق أول صورة أو مسح ضوئي لهذه الوثيقة';
        }else if (count === 1){
          addFileText.textContent = 'إضافة صورة أخرى';
          addFileLabel.title = 'أضف صورة أخرى لنفس الوثيقة (صفحة ثانية مثلاً)';
        }else{
          addFileText.textContent = 'إضافة مزيد من الصور';
          addFileLabel.title = `هناك ${count} صور مرفقة حاليًا`;
        }
      }

      function setupFilesSortable(){
        attachHorizontalSortable({
          container: filesThumbs,
          itemSelector: '.source-file-thumb',
          ghostClass: 'source-file-thumb--ghost',
          dragClass: 'source-file-thumb--drag',
          onSorted(orderedRefs){
            currentFiles = orderedRefs.slice();
            recomputeDirty();
          }
        });
      }

      function renderThumbs(){
        filesThumbs.innerHTML = '';

        if (!currentFiles.length){
          emptyFilesHint.textContent = 'لم تُرفق صور بعد لهذه الوثيقة.';
          emptyFilesHint.style.display = '';
          updateAddFileLabel();
          return;
        }

        emptyFilesHint.style.display = 'none';

        currentFiles.forEach((ref, idx)=>{
          const thumb = el('div', 'source-file-thumb');
          thumb.dataset.ref = ref;
classifyFileThumb(thumb, ref);

          const imgEl = el('img');
          imgEl.alt = 'صورة/وثيقة مرفقة';

          resolveSourceFileUrl(ref).then(url=>{
            if (url) imgEl.src = url;
          });

          const removeBtn = el('button', 'source-file-thumb-remove');
          removeBtn.type = 'button';
          removeBtn.title = 'إزالة هذه الصورة';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', e=>{
            e.stopPropagation();
            currentFiles.splice(idx,1);
            renderThumbs();
            recomputeDirty();
          });

          const viewBtn = el('button', 'source-file-thumb-view');
          viewBtn.type = 'button';
          viewBtn.title = 'معاينة الوثيقة بحجم أكبر';
          viewBtn.textContent = 'معاينة';
          viewBtn.addEventListener('click', e=>{
            e.stopPropagation();
            openSourceSlider(currentFiles, idx);
          });

          imgEl.addEventListener('click', ()=>openSourceSlider(currentFiles, idx));

          thumb.append(imgEl, removeBtn, viewBtn);
          filesThumbs.appendChild(thumb);
        });

        updateAddFileLabel();
        setupFilesSortable();
      }

      renderThumbs();

      fileInput.addEventListener('change', async ()=>{
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;

        for (const file of files){
          try{
            const ref = await storeSourceFile(file, personId, src.id);
            if (ref) currentFiles.push(ref);
          }catch(e){
            console.error('failed to add source file', e);
            showError?.('تعذّر حفظ إحدى صور الوثيقة. حاول مرة أخرى.');
          }
        }

        renderThumbs();
        recomputeDirty();
        fileInput.value = '';
      });

      const detailsGrid = el('div', 'source-details-grid');

      const forFieldWrap = el('div', 'source-details-field');
      const forFieldLabel = el('div', 'source-details-label');
      forFieldLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-bullseye" aria-hidden="true"></i></span> هذه الوثيقة متعلقة بـ';

      forFieldWrap.append(forFieldLabel, forFieldInput);

      const issuerWrap = el('div', 'source-meta-field');

      const issuerLabel = el('div', 'source-details-label');
      issuerLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-landmark" aria-hidden="true"></i></span> الجهة المصدرة';

      issuerWrap.append(issuerLabel, issuerInput);

      const refWrap = el('div', 'source-meta-field');
      const refLabel = el('div', 'source-details-label');
      refLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-hashtag" aria-hidden="true"></i></span> رقم الصك / رقم الوثيقة';

      refWrap.append(refLabel, referenceInput);

      const pagesWrap = el('div', 'source-details-field');
      const pagesLabel = el('div', 'source-details-label');
      pagesLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span> عدد الصفحات (اختياري)';

      pagesWrap.append(pagesLabel, pagesInput);

      const noteWrap = el('div', 'source-details-field source-details-field--full');
      const noteLabel = el('div', 'source-details-label');
      noteLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></span> ملخص محتوى الوثيقة';

      noteWrap.append(noteLabel, noteInput);

      const tagsWrapField = el('div', 'source-details-field source-details-field--full');
      const tagsLabel = el('div', 'source-details-label');
      tagsLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> وسوم الوثيقة';

      tagsWrapField.append(tagsLabel, tagsInput);

      // إبراز الحقول الأساسية
      typeField.classList.add('source-meta-field--primary');
      issuerWrap.classList.add('source-meta-field--primary');
      refWrap.classList.add('source-meta-field--primary');

      // صف الميتا العلوي: نوع + جهة + رقم + تاريخ + مكان
      metaRow.append(
        typeField,   // نوع الوثيقة
        issuerWrap,  // الجهة المصدرة
        refWrap,     // رقم الصك / المرجع
        dateField,   // تاريخ الوثيقة
        placeField   // مكان الإصدار
      );

      // درجة الاعتماد
      const confWrap = el('div', 'source-details-field');
      const confLabel = el('div', 'source-details-label');
      confLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span> درجة الاعتماد على المصدر';
      confWrap.append(confLabel, confidenceSelect);

      // مستوى السرية
      const confPrivWrap = el('div', 'source-details-field');
      const confPrivLabel = el('div', 'source-details-label');
      confPrivLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-lock" aria-hidden="true"></i></span> مستوى السرية / الخصوصية';

      confPrivWrap.append(confPrivLabel, confidentialitySelect);

      // التوثيق
      const verifiedWrap = el('div', 'source-details-field source-details-field--full');
      const verifiedLabel = el('div', 'source-details-label');
      verifiedLabel.innerHTML =   '<span class="source-details-icon"><i class="fa-solid fa-file-circle-check" aria-hidden="true"></i></span> حالة التحقق من الوثيقة';
    const verifiedInline = el('div', 'source-verified-inline');
const verifiedChkLabel = el('label', 'source-verified-check-label');

      verifiedChkLabel.append(verifiedCheckbox, textEl('span', 'تم التحقق من صحة هذا المصدر'));
      verifiedInline.append(
        verifiedChkLabel,
        verifiedByInput,
        verifiedAtInput
      );
      verifiedWrap.append(verifiedLabel, verifiedInline);

      // تفاصيل إضافية أسفل صف الميتا
      detailsGrid.append(
        forFieldWrap,
        pagesWrap,
        confWrap,
        confPrivWrap,
        verifiedWrap,
        noteWrap,
        tagsWrapField
      );


      body.append(
        metaRow,
        detailsGrid,
        filesBlock,
        pinWrap
      );
      editBox.appendChild(body);
      card.appendChild(editBox);

const footer = el('div', 'source-footer');

const saveBtn = el('button', 'source-save-btn');
saveBtn.type = 'button';
// الحالة الابتدائية: عرض كبطاقة (زر "تعديل")
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


 function applyMode(){
  const toEdit = !!isEditing;

  card.classList.toggle('source-card--edit', toEdit);
  card.classList.toggle('source-card--preview', !toEdit);

  if (previewBox) previewBox.style.display = toEdit ? 'none' : '';
  if (editBox)    editBox.style.display    = toEdit ? '' : 'none';

  if (dates) dates.style.display = toEdit ? 'none' : '';

  // تحديث تسمية زر الحفظ حسب الحالة
  if (!toEdit){
    // وضع المعاينة: "تعديل"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>تعديل</span>';
  }else if (!isDirty){
    // في وضع التحرير بدون تغييرات: "إغلاق"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-xmark" aria-hidden="true"></i><span>إغلاق</span>';
  }else{
    // في وضع التحرير مع تغييرات: "حفظ"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>حفظ</span>';
  }

  // زر الإلغاء يظهر فقط عند وجود تعديلات
  cancelBtn.style.display = toEdit && isDirty ? '' : 'none';
}

      function recomputeDirty(){
        const curTitle  = titleInput.value.trim();
        const curType   = typeSelect.value.trim();
        const curDate   = dateInput.value || null;
        const curPlace  = placeInput.value.trim();
        const curFor    = forFieldInput.value.trim();
        const curRef    = referenceInput.value.trim();
        const curIssuer = issuerInput.value.trim();
        const curPages  = pagesInput.value.trim();
        const curNote   = noteInput.value.trim();
        const curTags   = tagsInput.value
          .split(',')
          .map(t=>t.trim())
          .filter(Boolean);
        const curPinned = !!pinCheckbox.checked;

        const curConfidence      = confidenceSelect.value.trim();
        const curConfidentiality = confidentialitySelect.value.trim();
        const curVerified        = !!verifiedCheckbox.checked;
        const curVerifiedBy      = verifiedByInput.value.trim();
        const curVerifiedAt      = verifiedAtInput.value || null;

        isDirty =
          curTitle !== original.title ||
          curType  !== original.type ||
          curDate  !== (original.date || null) ||
          curPlace !== original.place ||
          curFor   !== original.forField ||
          curRef   !== original.referenceCode ||
          curIssuer!== original.issuer ||
          curPages !== original.pages ||
          curNote  !== original.note ||
          curPinned!== original.pinned ||
          curTags.join('|') !== original.tags.join('|') ||
          !arraysShallowEqual(currentFiles, original.files) ||
          curConfidence      !== (original.confidenceLevel || '') ||
          curConfidentiality !== (original.confidentiality || '') ||
          curVerified        !== original.verified ||
          curVerifiedBy      !== original.verifiedBy ||
          curVerifiedAt      !== (original.verifiedAt || null);

        applyMode();
      }

      applyMode();

      titleInput.addEventListener('input',  recomputeDirty);
      typeSelect.addEventListener('change', recomputeDirty);
      dateInput.addEventListener('change',  recomputeDirty);
      placeInput.addEventListener('input',  recomputeDirty);
      forFieldInput.addEventListener('input', recomputeDirty);
      referenceInput.addEventListener('input', recomputeDirty);
      issuerInput.addEventListener('input', recomputeDirty);
      pagesInput.addEventListener('input',  recomputeDirty);
      noteInput.addEventListener('input',   recomputeDirty);
      tagsInput.addEventListener('input',   recomputeDirty);
      pinCheckbox.addEventListener('change',recomputeDirty);
      confidenceSelect.addEventListener('change',      recomputeDirty);
      confidentialitySelect.addEventListener('change', recomputeDirty);
      verifiedCheckbox.addEventListener('change',      recomputeDirty);
      verifiedByInput.addEventListener('input',        recomputeDirty);
      verifiedAtInput.addEventListener('change',       recomputeDirty);

      saveBtn.addEventListener('click', ()=>{
        if (!isEditing){
          isEditing = true;
          lastEditedId = src.id;
          applyMode();
          showInfo?.('يمكنك الآن تعديل بيانات الوثيقة ثم الضغط على "حفظ" لتثبيت التعديلات.');
          return;
        }

        if (isEditing && !isDirty){
          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر الوثيقة.');
          return;
        }

        const newTitle  = titleInput.value.trim();
        const newType   = typeSelect.value.trim();
        const newDate   = dateInput.value || null;
        const newPlace  = placeInput.value.trim();
        const newFor    = forFieldInput.value.trim();
        const newRef    = referenceInput.value.trim();
        const newIssuer = issuerInput.value.trim();
        const newPages  = pagesInput.value.trim();
        const newNote   = noteInput.value.trim();
        const newTags   = tagsInput.value
          .split(',')
          .map(t=>t.trim())
          .filter(Boolean);
        const newPinned = !!pinCheckbox.checked;

        const newConfidence      = confidenceSelect.value.trim();
        const newConfidentiality = confidentialitySelect.value.trim();
        const newVerified        = !!verifiedCheckbox.checked;
        const newVerifiedBy      = verifiedByInput.value.trim();
        const newVerifiedAt      = verifiedAtInput.value || null;

        const updated = updateSource(
          person,
          src.id,
          {
            title: newTitle,
            type: newType,
            date: newDate,
            place: newPlace,
            forField: newFor,
            referenceCode: newRef,
            issuer: newIssuer,
            pages: newPages,
            note: newNote,
            tags: newTags,
            files: currentFiles,
            pinned: newPinned,
            confidenceLevel: newConfidence,
            confidentiality: newConfidentiality,
            verified: newVerified,
            verifiedBy: newVerifiedBy,
            verifiedAt: newVerifiedAt
          },
          {
            onChange: (sources, changed)=>{
              if (typeof handlers.onDirty === 'function'){
                handlers.onDirty(sources, changed);
              }
              emitSourcesToHost();
            }
          }
        );

        const effective = updated || src;

        original.title           = effective.title || '';
        original.type            = (effective.type || '').trim();
        original.date            = effective.date || null;
        original.place           = (effective.place || '').trim();
        original.forField        = (effective.forField || '').trim();
        original.referenceCode   = (effective.referenceCode || '').trim();
        original.issuer          = (effective.issuer || '').trim();
        original.pages           = (effective.pages || '').trim();
        original.note            = (effective.note || '').trim();
        original.tags            = Array.isArray(effective.tags) ? [...effective.tags] : [];
        original.files           = Array.isArray(effective.files) ? [...effective.files] : [];
        original.pinned          = !!effective.pinned;
        original.confidenceLevel = (effective.confidenceLevel || '').trim();
        original.relatedEventId  = effective.relatedEventId || null;
        original.verified        = !!effective.verified;
        original.verifiedBy      = (effective.verifiedBy || '').trim();
        original.verifiedAt      = effective.verifiedAt || null;
        original.confidentiality = (effective.confidentiality || '').trim();

        currentFiles = [...original.files];

        previewTitle.textContent =
          original.title || 'وثيقة بدون عنوان';

        const info2 = getNoteLengthInfo(original.note.length);
        if (info2.level === 0){
          lengthLabel.textContent = 'لم تُكتب ملاحظات بعد';
        }else{
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

        if (effective.createdAt){
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


      cancelBtn.addEventListener('click', ()=>{
        if (!isEditing) return;

        titleInput.value      = original.title;
        typeSelect.value      = original.type || 'generic';
        dateInput.value       = original.date || '';
        placeInput.value      = original.place;
        forFieldInput.value   = original.forField;
        referenceInput.value  = original.referenceCode;
        issuerInput.value     = original.issuer;
        pagesInput.value      = original.pages;
        noteInput.value       = original.note;
        tagsInput.value       = original.tags.join(', ');
        pinCheckbox.checked   = original.pinned;

        confidenceSelect.value      = original.confidenceLevel || '';
        confidentialitySelect.value = original.confidentiality || '';
        verifiedCheckbox.checked    = original.verified;
        verifiedByInput.value       = original.verifiedBy;
        verifiedAtInput.value       = original.verifiedAt || '';

        currentFiles = [...original.files];
        renderThumbs();
        renderPreviewFiles();

        if (src.createdAt){
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

      delBtn.addEventListener('click', async ()=>{
        const ok = await showConfirmModal?.(
          'حذف الوثيقة',
          'هل تريد بالتأكيد حذف هذه الوثيقة؟ لا يمكن التراجع عن هذا الإجراء.'
        );
        if (!ok){
          showInfo?.('تم إلغاء حذف الوثيقة.');
          return;
        }

        const success = deleteSource(person, src.id, {
          onChange: (sources, removed)=>{
            if (typeof handlers.onDirty === 'function'){
              handlers.onDirty(sources, removed);
            }
            emitSourcesToHost();
          }
        });

        if (!success){
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


  addBtn.addEventListener('click', ()=>{
    ensureSources(person);
    const draft = person.sources.find(s=>{
      const t   = String(s.title || '').trim();
      const ref = String(s.referenceCode || '').trim();
      const files = Array.isArray(s.files) ? s.files : [];
      return !t && !ref && files.length === 0;
    });

    if (draft){
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
        title:'',
        type:'generic',
        forField:'',
        date:null,
        place:'',
        referenceCode:'',
        issuer:'',
        pages:'',
        note:'',
        tags:[],
        files:[]
      },
      {
        onChange:(sources, changed)=>{
          if (typeof handlers.onDirty === 'function'){
            handlers.onDirty(sources, changed);
          }
          emitSourcesToHost();
        }
      }
    );

    if (!src){
      showError?.('تعذر إنشاء وثيقة جديدة. حاول مرة أخرى.');
      return;
    }

    lastEditedId = src.id;
    renderList();
    showSuccess?.('تمت إضافة وثيقة جديدة. أدخل بياناتها ثم اضغط "حفظ" لتثبيتها.');
  });

  sortSelect.addEventListener('change', ()=>{
    const mode = sortSelect.value === 'oldest' ? 'oldest' : 'latest';
    sortSources(person, mode);
    if (typeof handlers.onDirty === 'function'){
      handlers.onDirty(person.sources);
    }
    emitSourcesToHost();
    renderList();
    showInfo?.(
      mode === 'latest' ? 'تم ترتيب الوثائق من الأحدث إلى الأقدم.'
        : 'تم ترتيب الوثائق من الأقدم إلى الأحدث.'
    );
  });

  typeFilterSelect.addEventListener('change', ()=>{
    const val = typeFilterSelect.value;
    currentTypeFilter = val || 'all';
    renderList();
  });
  searchInput.addEventListener('input', ()=>{
    currentSearchTerm = searchInput.value || '';
    renderList();
  });

  pinnedFilterCheckbox.addEventListener('change', ()=>{
    onlyPinned = !!pinnedFilterCheckbox.checked;
    renderList();
  });

  function setViewMode(mode){
    viewMode = mode === 'table' ? 'table' : 'cards';
    viewBtnCards.classList.toggle('is-active', viewMode === 'cards');
    viewBtnTable.classList.toggle('is-active', viewMode === 'table');
    renderList();
  }

  viewBtnCards.addEventListener('click', ()=> setViewMode('cards'));
  viewBtnTable.addEventListener('click', ()=> setViewMode('table'));

  renderList();
  emitSourcesToHost();
  return root;
}
