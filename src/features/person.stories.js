// person.stories.js
// إدارة "القصص والمذكّرات" (منطق + واجهة) — نسخة جديدة تعتمد files بدل images

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
  isEmptyRecordByKeys,

  // UI helpers
  formatCreatedAtLabel,
  getTextLengthInfo,
  openResolvedSlider,
  applyCardEditMode,

  // type helpers
  createTypeHelpers,

  // shared temp+resolver + upgrader
  createSectionTempAndResolver,
  upgradeTmpRefs,

  // files helpers (مثل قسم المصادر)
  makeTempMetaFromFile,
  inferFileKind,
  groupRefsByKind,
  openInNewTabSafe,

  getRefExt,
  buildDownloadName,
  findImageIndex,
  makeGroupTitle,
  makeDivider,
  wrapField,
  withFieldHead,
  createFiltersCollapseController
} from '../features/bio-sections.utils.js';

import {
  attachYearModeToggle,
  getLogicalDateValue,
  setYearToggleValue
} from '../ui/modal.yearToggle.js';
import { getLinkedEventEdges, upsertSectionEvents, normalizeEventLink } from './person.events.js';

const storyFileMetaCache = new Map(); // ref -> { kind, ext, mime, name? }

// ----------------------------------------------------------------------------
// 1) temp refs للملفات قبل الحفظ + resolver موحّد
// ----------------------------------------------------------------------------
const storySectionTmp = createSectionTempAndResolver({
  prefix: 'tmp:',
  getIdbUrl: (ref) => DB?.getStoryFileURL?.(ref),
  metaCache: storyFileMetaCache
});

const addTempStoryFile = (file) => storySectionTmp.addTemp(file, makeTempMetaFromFile(file));
const revokeTempStoryRef = (ref) => storySectionTmp.revokeTemp(ref);
const resolveStoryFileUrl = storySectionTmp.resolve;
const storyTempCache = storySectionTmp.tempCache;

function collectAllStoryRefs(person) {
  const out = [];
  const items = Array.isArray(person?.stories) ? person.stories : [];
  for (const it of items) out.push(...(Array.isArray(it?.files) ? it.files : []));
  return out;
}

async function warmStoryMetaCache(refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  const need = list.map(r => String(r)).filter(r => isIdbRef(r) && !storyFileMetaCache.has(r));
  if (!need.length) return false;

  const getMeta = (typeof DB?.getStoryFileMeta === 'function') ? DB.getStoryFileMeta.bind(DB) : null;
  if (!getMeta) return false;

  const results = await Promise.allSettled(need.map(r => getMeta(r).then(meta => ({ r, meta }))));
  let changed = false;

  for (const x of results) {
    if (x.status === 'fulfilled' && x.value?.meta) {
      storyFileMetaCache.set(x.value.r, x.value.meta);
      changed = true;
    }
  }
  return changed;
}

async function ensureStoryMetaForRef(ref) {
  const raw = String(ref || '');

  if (isTmpRef(raw)) return storyFileMetaCache.get(raw) || storyTempCache.get(raw)?.meta || null;
  if (!isIdbRef(raw)) return null;

  const cached = storyFileMetaCache.get(raw);
  if (cached) return cached;

  const getMeta = (typeof DB?.getStoryFileMeta === 'function') ? DB.getStoryFileMeta.bind(DB) : null;
  if (!getMeta) return null;

  try {
    const meta = await getMeta(raw);
    if (meta) {
      storyFileMetaCache.set(raw, meta);
      return meta;
    }
  } catch (e) {
    console.error('getStoryFileMeta failed', raw, e);
  }
  return null;
}

function getStoryFileKind(ref) {
  const raw = String(ref || '');

  if (isTmpRef(raw)) {
    const meta = storyFileMetaCache.get(raw) || storyTempCache.get(raw)?.meta || {};
    return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
  }

  if (isIdbRef(raw)) {
    const meta = storyFileMetaCache.get(raw) || {};
    return meta.kind || inferFileKind({ ext: meta.ext || '', mime: meta.mime || '', ref: raw }) || 'other';
  }

  return inferFileKind({ ref: raw, ext: getRefExt(raw) }) || 'other';
}

// ----------------------------------------------------------------------------
// 2) ثوابت الأنواع + الحقول الجديدة
// ----------------------------------------------------------------------------
const STORY_TYPE_LABELS = {
  general: 'عام',
  childhood: 'الطفولة',
  study: 'الدراسة',
  marriage: 'الزواج',
  work: 'العمل',
  character: 'الصفات والسلوك',
  anecdote: 'مواقف طريفة'
};
const STORY_TYPE_OPTIONS = [
  ['all', 'كل الأنواع'],
  ['general', 'عام'],
  ['childhood', 'الطفولة'],
  ['study', 'الدراسة'],
  ['marriage', 'الزواج'],
  ['work', 'العمل'],
  ['character', 'الصفات والسلوك'],
  ['anecdote', 'مواقف طريفة']
];
const storyType = createTypeHelpers({
  labels: STORY_TYPE_LABELS,
  options: STORY_TYPE_OPTIONS,
  allValue: 'all',
  allLabel: 'كل الأنواع'
});

const STORY_MOOD_OPTIONS = [
  ['all', 'كل المشاعر'],
  ['happy', 'سعيد'],
  ['sad', 'حزين'],
  ['inspiring', 'ملهم'],
  ['funny', 'طريف'],
  ['challenge', 'تحدّي'],
  ['neutral', 'محايد']
];
const STORY_VISIBILITY_OPTIONS = [
  ['all', 'كل المستويات'],
  ['public', 'عام'],
  ['family', 'للعائلة'],
  ['private', 'خاص']
];

// ----------------------------------------------------------------------------
// 3) منطق البيانات (Normalize + CRUD) — files بدل images + حقول جديدة
// ----------------------------------------------------------------------------
function normalizeStory(raw) {
  const now = nowIso();
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    id: String(raw.id || 's_' + Math.random().toString(36).slice(2)),
    title: safeStr(raw.title),
    text: safeStr(raw.text),

    // ✅ جديد: files بدل images
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    // ✅ ربط القصة بالمصادر
    sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String).filter(Boolean) : [],

    type: safeStr(raw.type),
    eventDate: raw.eventDate || null,
    place: safeStr(raw.place),
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],


    mood: safeStr(raw.mood),
    visibility: safeStr(raw.visibility),
    narrator: safeStr(raw.narrator),

    pinned: !!raw.pinned,

    // ✅ ربط القصة بالتايملاين
    toTimeline: !!raw.toTimeline,

    note: safeStr(raw.note),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

export function ensureStories(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.stories)) person.stories = [];
  person.stories = person.stories.map(normalizeStory);
}

export function addStory(person, data = {}, { onChange } = {}) {
  ensureStories(person);
  const story = normalizeStory(data);
  story.createdAt = nowIso();
  story.updatedAt = story.createdAt;
  person.stories.unshift(story);
  if (typeof onChange === 'function') onChange(person.stories, story);
  return story;
}

export function updateStory(person, storyId, data = {}, { onChange } = {}) {
  ensureStories(person);
  const idx = person.stories.findIndex(s => s.id === storyId);
  if (idx === -1) return null;

  const old = person.stories[idx];
  const merged = normalizeStory({ ...old, ...data, id: old.id });
  merged.createdAt = old.createdAt || merged.createdAt;
  merged.updatedAt = nowIso();

  person.stories[idx] = merged;
  if (typeof onChange === 'function') onChange(person.stories, merged);
  return merged;
}

export function deleteStory(person, storyId, { onChange } = {}) {
  ensureStories(person);
  const idx = person.stories.findIndex(s => s.id === storyId);
  if (idx === -1) return false;

  const removed = person.stories.splice(idx, 1)[0];
  if (typeof onChange === 'function') onChange(person.stories, removed);
  return true;
}

// ✅ إضافة فرز حسب تاريخ الحدث (مع fallback)
export function sortStories(person, mode = 'latest') {
  ensureStories(person);

  const getCreated = (s) => new Date(s?.createdAt || s?.updatedAt || 0).getTime() || 0;
const getEvent = (s) => {
  const v = (s?.eventDate == null ? '' : String(s.eventDate)).trim();
  if (!v) return 0;

  // سنة فقط: YYYY
  if (/^\d{4}$/.test(v)) {
    const y = Number(v);
    if (!y) return 0;
    return new Date(Date.UTC(y, 0, 1)).getTime();
  }

  const t = new Date(v).getTime();
  return t || 0;
};

  person.stories.sort((a, b) => {
    if (mode === 'event_latest' || mode === 'event_oldest') {
      const ea = getEvent(a);
      const eb = getEvent(b);

      // eventDate موجود لكليهما
      if (ea && eb) return mode === 'event_oldest' ? (ea - eb) : (eb - ea);

      // fallback لمن لا يملك eventDate: استخدم createdAt
      if (!ea && !eb) {
        const ca = getCreated(a);
        const cb = getCreated(b);
        return mode === 'event_oldest' ? (ca - cb) : (cb - ca);
      }

      // ضع ما يملك eventDate قبل من لا يملك
      return ea ? -1 : 1;
    }

    const da = getCreated(a);
    const db = getCreated(b);
    return mode === 'oldest' ? da - db : db - da;
  });
}

// ----------------------------------------------------------------------------
// 4) سجل فارغ + Draft Empty — files بدل images
// ----------------------------------------------------------------------------
const STORY_EMPTY_KEYS = [
  'title',
  'text',
  'files',
  'type',
  'eventDate',
  'place',
  'tags',
  'mood',
  'visibility',
  'narrator',
  'toTimeline',
  'note'
];

const STORY_DRAFT_EMPTY_KEYS = [
  'title',
  'text',
  'files',
  'eventDate',
  'place',
  'tags',
  'mood',
  'narrator',
  'note'
];


function isEmptyStoryDraft(rec) {
  return isEmptyRecordByKeys(rec, STORY_DRAFT_EMPTY_KEYS);
}

// ----------------------------------------------------------------------------
// 5) عارض الصور (للصور فقط ضمن files)
/// ----------------------------------------------------------------------------
const storyImageViewer = createImageViewerOverlay();
async function openImageSlider(refs, startIndex = 0) {
  return openResolvedSlider({
    viewer: storyImageViewer,
    refs,
    startIndex,
    resolveUrl: resolveStoryFileUrl
  });
}

// ----------------------------------------------------------------------------
// 6) أدوات نص: طول + كلمات + زمن قراءة + عنوان تلقائي للمعاينة
// ----------------------------------------------------------------------------
function countWords(text) {
  const s = safeStr(text);
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

function getReadingMinutes(words) {
  const w = Number(words || 0);
  if (!w) return 0;
  return Math.max(1, Math.round(w / 200)); // ~200 كلمة/دقيقة
}

function getStoryLengthInfo(len) {
  return getTextLengthInfo(
    len,
    { short: 280, medium: 800 },
    { empty: 'بدون نص', short: 'قصة قصيرة', medium: 'قصة متوسطة', long: 'قصة طويلة' }
  );
}

function inferTitleFromText(text) {
  const s = safeStr(text);
  if (!s) return '';
  const firstLine = s.split('\n').map(t => safeStr(t)).find(Boolean) || '';
  const firstSentence = firstLine.split(/[.؟!]/).map(t => safeStr(t)).find(Boolean) || firstLine;
  return safeStr(firstSentence).slice(0, 70);
}

// ----------------------------------------------------------------------------
// 7) Timeline event generator (حدث واحد للقصة)
/// ----------------------------------------------------------------------------
function makeStoryTimelineEvent(story, storyTypeLabel = '') {
  if (!story?.eventDate) return null;

  const titleBase = safeStr(story.title) || safeStr(storyTypeLabel) || 'قصة';
  const title = `قصة: ${titleBase}`;

  const note = safeStr(story.note);
  const text = safeStr(story.text);
  const desc = note || (text ? (text.length > 200 ? (text.slice(0, 200) + '…') : text) : '');

  return {
    id: `st_ev_${String(story.id || '')}`, // ثابت للقصة

    type: 'custom',
    title,
    date: String(story.eventDate),
    place: safeStr(story.place),
    description: desc,

    pinned: false,
    tags: [],
    source: '',
    certainty: '',
    media: [],

    // ✅ الربط الموحّد مثل التعليم
    ...normalizeEventLink({ sectionId: 'stories', itemId: String(story.id || ''), edge: 'timeline', key: 'auto' })
  };
}


// ----------------------------------------------------------------------------
// 8) createStoriesSection — واجهة القصص
// ----------------------------------------------------------------------------
export function createStoriesSection(person, handlers = {}) {
  ensureStories(person);
  // ===============================
  // ✅ Sources helpers 
  // ===============================
  const sources = Array.isArray(person?.sources) ? person.sources : [];
  const sourceMap = new Map(sources.map(s => [String(s.id), s]));

  function getSourceLabelById(sid) {
    const src = sourceMap.get(String(sid));
    if (!src) return String(sid);
    return safeStr(src.title || src.name || src.label || src.type || src.id) || String(sid);
  }

  const personId = person && person._id ? String(person._id) : null;

  // حالة الفلاتر/البحث/المحرر
  let currentTypeFilter = 'all';
  let currentMoodFilter = 'all';
  let currentVisibilityFilter = 'all';
  let currentTagFilter = '';
  let currentSearchQuery = '';
  let filesFilter = 'all';       // all | has | none
  let pinnedFilter = 'all';
let lastEditedId = null;
let lastFocusId = null;

// ✅ Persist stories filters state across reload
const STORIES_FILTERS_STATE_KEY = 'biosec:stories:filtersState';

function readStoriesFiltersState() {
  try {
    const raw = localStorage.getItem(STORIES_FILTERS_STATE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch {
    return null;
  }
}

function writeStoriesFiltersState(state) {
  try {
    localStorage.setItem(STORIES_FILTERS_STATE_KEY, JSON.stringify(state || {}));
  } catch { /* ignore */ }
}

function persistStoriesFiltersState() {
  writeStoriesFiltersState({
    type: (currentTypeFilter || '').trim(),
    mood: (currentMoodFilter || '').trim(),
    visibility: (currentVisibilityFilter || '').trim(),
    files: (filesFilter || '').trim(),
    pinned: (pinnedFilter || '').trim(),
    tag: (currentTagFilter || '').trim(),
    search: (currentSearchQuery || '').trim(),
    // ✅ اختياري (مفيد): حفظ ترتيب العرض الحالي
    sort: (sortSelect?.value || '').trim()
  });
}

function clearStoriesFiltersState() {
  try { localStorage.removeItem(STORIES_FILTERS_STATE_KEY); } catch { /* ignore */ }
}

  // Draft tracker
  const draftNewMap = new Map();

    // Render sequence guard (لمنع سباق async)
  let renderSeq = 0;

  // إرسال القصص للـ Host
  function emitStoriesToHost() {
    if (!personId || typeof handlers.onUpdateStories !== 'function') return;

    const stories = Array.isArray(person.stories)  ? person.stories.map(s => ({
          id: s.id,
          title: safeStr(s.title),
          text: safeStr(s.text),
          files: shallowArr(s.files),
          type: safeStr(s.type),
          eventDate: s.eventDate || null,
          place: safeStr(s.place),
          tags: shallowArr(s.tags),
          mood: safeStr(s.mood),
          visibility: safeStr(s.visibility),
          narrator: safeStr(s.narrator),
          pinned: !!s.pinned,
          toTimeline: !!s.toTimeline,
          note: safeStr(s.note),
          sourceIds: shallowArr(s.sourceIds).map(String).filter(Boolean),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
      : [];

    handlers.onUpdateStories(personId, stories);
  }

  const sortMode = (handlers.getSortMode && handlers.getSortMode()) || 'latest';
  sortStories(person, sortMode);

  // ----------------------------------------------------------------------------
  // UI: الهيكل العام
  // ----------------------------------------------------------------------------
  const root = el('section', 'bio-section bio-section-stories');
  root.dataset.sectionId = 'stories';

  const titleEl = el('h3', 'biosec-section-title stories-section-title');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-book-open-reader';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'القصص والمذكّرات');
  const countBadge = el('span', 'biosec-count-badge stories-count-badge');
  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'biosec-meta stories-meta');
  metaEl.textContent =
    'حوِّل الذكريات إلى قصص حيّة تحفظ أثره للأبناء والأحفاد؛ دوّن المواقف المؤثّرة والطرائف والنجاحات والتحوّلات، ثم أرفق الملفات المناسبة.';
  root.appendChild(metaEl);

  function updateStoriesCountBadge() {
    const n = (person.stories || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد قصص بعد)';
  }

  // ----------------------------------------------------------------------------
  // UI: أدوات القسم (بحث/فلتر/ترتيب/إضافة)
  // ----------------------------------------------------------------------------
  const header = el('div', 'biosec-header stories-header');

  const tools = el('div', 'biosec-tools stories-tools');
  const toolsLeft = el('div', 'biosec-tools-left stories-tools-left');
  const toolsRight = el('div', 'biosec-tools-right stories-tools-right');
  // زر إظهار/إخفاء الفلاتر
  const filtersToggleBtn = el('button', 'biosec-filters-toggle biosec-add-btn stories-filters-toggle');
  filtersToggleBtn.type = 'button';
  filtersToggleBtn.setAttribute('aria-label', 'إظهار/إخفاء الفلاتر');
// ✅ زر إعادة ضبط الفلاتر (يظهر فقط عند وجود فلاتر مفعّلة)
// مكانه: toolsLeft (لوحة الفلاتر نفسها)
const resetFiltersBtn = el('button', 'biosec-btn biosec-filters-reset stories-filters-reset');
resetFiltersBtn.type = 'button';
resetFiltersBtn.innerHTML =
  '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>إعادة ضبط الفلاتر</span>';
resetFiltersBtn.title = 'إرجاع فلاتر القصص للوضع الافتراضي';
resetFiltersBtn.style.display = 'none';

  const typeFilterSelect = el('select', 'biosec-type-filter stories-type-filter');
  typeFilterSelect.name = 'stories_type_filter';
  storyType.fillSelect(typeFilterSelect);
  typeFilterSelect.value = 'all';

  const moodFilterSelect = el('select', 'biosec-type-filter stories-mood-filter');
  moodFilterSelect.name = 'stories_mood_filter';
  STORY_MOOD_OPTIONS.forEach(([v, t]) => {
    const opt = el('option');
    opt.value = v;
    opt.textContent = t;
    moodFilterSelect.appendChild(opt);
  });
  moodFilterSelect.value = 'all';

  const visibilityFilterSelect = el('select', 'biosec-type-filter stories-visibility-filter');
  visibilityFilterSelect.name = 'stories_visibility_filter';
  STORY_VISIBILITY_OPTIONS.forEach(([v, t]) => {
    const opt = el('option');
    opt.value = v;
    opt.textContent = t;
    visibilityFilterSelect.appendChild(opt);
  });
  visibilityFilterSelect.value = 'all';

  // ✅ sort: إضافة event_latest/event_oldest
  const sortSelect = el('select', 'biosec-sort stories-sort');
  sortSelect.name = 'stories_sort';
  [
 ['latest',       'الأحدث (حسب تاريخ الإضافة)'],
['oldest',       'الأقدم (حسب تاريخ الإضافة)'],
['event_latest', 'الأحدث (حسب تاريخ الحدث)'],
['event_oldest', 'الأقدم (حسب تاريخ الحدث)'],

  ].forEach(([v, t]) => {
    const opt = el('option');
    opt.value = v;
    opt.textContent = t;
    sortSelect.appendChild(opt);
  });
  sortSelect.value = sortMode;

// ✅ pinned filter (select بدل زر)
const pinnedFilterSelect = el('select', 'biosec-type-filter stories-pin-filter');
pinnedFilterSelect.name = 'stories_pinned_filter';

[
  ['all', 'كل القصص'],
  ['pinned', 'المميّزة'],
  ['not_pinned', 'غير المميّزة']
].forEach(([v, t]) => {
  const opt = el('option');
  opt.value = v;
  opt.textContent = t;
  pinnedFilterSelect.appendChild(opt);
});

pinnedFilterSelect.value = 'all';
pinnedFilterSelect.title = 'تصفية القصص حسب التمييز (Pinned)';

  // ✅ files filter
  const filesFilterSelect = el('select', 'biosec-type-filter stories-files-filter');
  filesFilterSelect.name = 'stories_files_filter';
  [
    ['all', 'كل القصص'],
    ['has', 'مع ملفات'],
    ['none', 'بدون ملفات']
  ].forEach(([v, t]) => {
    const opt = el('option');
    opt.value = v;
    opt.textContent = t;
    filesFilterSelect.appendChild(opt);
  });
  filesFilterSelect.value = 'all';

  // ✅ search (عنوان + نص + مكان + وسوم)
  const searchWrap = el('div', 'biosec-search-wrap stories-search-wrap');
  const searchInput = el('input', 'biosec-search-input stories-search-input');
  searchInput.type = 'search';
  searchInput.name = 'stories_search';
  searchInput.placeholder = 'ابحث في العنوان أو النص أو المكان أو الوسوم…';
  searchInput.value = '';
searchInput.addEventListener('input', () => {
  const raw = searchInput.value || '';
  currentSearchQuery = raw.trim().toLowerCase();

  // ✅ أظهر/أخف زر المسح حسب وجود نص
  clearSearchBtn.style.display = raw.trim() ? '' : 'none';
persistStoriesFiltersState(); 
  renderList();
});

  // ✅ زر مسح البحث (يظهر فقط عند وجود نص)
const clearSearchBtn = el('button', 'biosec-search-clear stories-search-clear');
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
persistStoriesFiltersState();
  renderList();
  searchInput.focus();
});

searchWrap.append(searchInput, clearSearchBtn);
// ✅ Restore stories filters state on load
{
  const st = readStoriesFiltersState();
  if (st) {
    // type
    if (typeof st.type === 'string' && st.type) {
      currentTypeFilter = st.type;
      typeFilterSelect.value = st.type;
    }

    // mood
    if (typeof st.mood === 'string' && st.mood) {
      currentMoodFilter = st.mood;
      moodFilterSelect.value = st.mood;
    }

    // visibility
    if (typeof st.visibility === 'string' && st.visibility) {
      currentVisibilityFilter = st.visibility;
      visibilityFilterSelect.value = st.visibility;
    }

    // files
    if (typeof st.files === 'string' && st.files) {
      filesFilter = st.files;
      filesFilterSelect.value = st.files;
    }

    // pinned
    if (typeof st.pinned === 'string' && st.pinned) {
      pinnedFilter = st.pinned;
      pinnedFilterSelect.value = st.pinned;
    }

    // tag
    if (typeof st.tag === 'string') {
      currentTagFilter = st.tag;
    }

    // search
    if (typeof st.search === 'string') {
      searchInput.value = st.search;
      currentSearchQuery = (st.search || '').trim().toLowerCase();
      clearSearchBtn.style.display = (st.search || '').trim() ? '' : 'none';
    }

    // ✅ sort (اختياري)
    if (typeof st.sort === 'string' && st.sort) {
      sortSelect.value = st.sort;
      // مهم: طبّق الفرز على البيانات فورًا
      sortStories(person, st.sort);
    }
  }
}

function withToolHead(node, { label, icon }) {
  const wrap = el('div', 'biosec-tool-item story-tool-item');
  const head = el('div', 'biosec-field-head biosec-tool-head story-tool-head');

  const ic = el('i', `fa-solid ${icon || 'fa-circle-info'} biosec-field-icon biosec-tool-icon`);
  ic.setAttribute('aria-hidden', 'true');

  const lb = el('div', 'biosec-field-label biosec-tool-label');
  lb.textContent = label || '';

  head.append(ic, lb);
  wrap.append(head, node);
  return wrap;
}

  const addBtn = el('button', 'biosec-add-btn stories-add-btn');
  addBtn.type = 'button';

toolsLeft.append(
  // ✅ ترتيب UX: فلاتر المحتوى أولاً
  withToolHead(typeFilterSelect,       { label: 'نوع القصة',     icon: 'fa-tag' }),
  withToolHead(moodFilterSelect,       { label: 'مشاعر القصة',   icon: 'fa-face-smile' }),
  withToolHead(visibilityFilterSelect, { label: 'الخصوصية',      icon: 'fa-user-shield' }),
  withToolHead(filesFilterSelect,      { label: 'الملفات',       icon: 'fa-paperclip' }),

  // ✅ ثم التحكمات العامة
  withToolHead(pinnedFilterSelect,     { label: 'الحالة',       icon: 'fa-solid fa-thumbtack' }),
  withToolHead(sortSelect,             { label: 'الترتيب',       icon: 'fa-arrow-up-wide-short' }),
  resetFiltersBtn,
);


toolsRight.append(searchWrap, addBtn, filtersToggleBtn);
  
// ✅ دالة موحّدة لمعرفة هل الفلاتر مفعّلة (نستخدمها للمنع + لإظهار زر إعادة الضبط)
function hasActiveFilters() {
  // ✅ ممنوع إدخال البحث هنا — البحث صار خارج لوحة الفلاتر
  const hasTag = !!(currentTagFilter && currentTagFilter.trim());
  const hasType = (currentTypeFilter && currentTypeFilter !== 'all');
  const hasMood = (currentMoodFilter && currentMoodFilter !== 'all');
  const hasVis  = (currentVisibilityFilter && currentVisibilityFilter !== 'all');
  const hasFiles = (filesFilter && filesFilter !== 'all');
  const hasPinned = (pinnedFilter && pinnedFilter !== 'all');

  return hasTag || hasType || hasMood || hasVis || hasFiles || hasPinned;
}

const filtersCtl = createFiltersCollapseController({
  storageKey: 'biosec:stories:filtersCollapsed',
  panelEl: toolsLeft,
  toggleBtnEl: filtersToggleBtn,

  hasActiveFilters,

  labels: { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
  iconHtml: '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
  onBlockedHide: () => {
    showWarning?.('لا يمكن إخفاء الفلاتر لأن لديك فلاتر مفعّلة. قم بتصفيرها أولاً.');
  }
});


// طبّق الحالة الابتدائية (مع auto-open إذا فيه فلاتر فعالة)
filtersCtl.applyInitialState({ autoOpenIfActive: true });
syncResetFiltersBtnVisibility();

  function syncResetFiltersBtnVisibility() {
  resetFiltersBtn.style.display = hasActiveFilters() ? '' : 'none';
}

function resetFiltersToDefault() {
  // ✅ فلاتر toolsLeft (لوحة الفلاتر)
  typeFilterSelect.value = 'all';
  moodFilterSelect.value = 'all';
  visibilityFilterSelect.value = 'all';
  filesFilterSelect.value = 'all';
  pinnedFilterSelect.value = 'all';
  sortSelect.value = sortMode || 'latest';

  // ✅ القيم المنطقية المرتبطة
  currentTypeFilter = 'all';
  currentMoodFilter = 'all';
  currentVisibilityFilter = 'all';
  filesFilter = 'all';
  pinnedFilter = 'all';

  // ✅ فلتر الوسوم
  currentTagFilter = '';

  // ✅ (مهم) تصفير البحث أيضًا
  searchInput.value = '';
  currentSearchQuery = '';
  clearSearchBtn.style.display = 'none';

  clearStoriesFiltersState(); // ✅
  syncResetFiltersBtnVisibility();
  renderList();
}

resetFiltersBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetFiltersToDefault();
});

// ✅ طبّق الحالة الأولية لظهور الزر
syncResetFiltersBtnVisibility();

// اربط النقر
filtersToggleBtn.addEventListener('click', () => filtersCtl.toggle());

  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

  const list = el('div', 'biosec-list stories-list');
  root.appendChild(list);

function updatePinnedFilterUI() {
  pinnedFilterSelect.value = pinnedFilter || 'all';
}

  function updateAddButtonLabel() {
    ensureStories(person);
    const count = person.stories.length || 0;
    addBtn.innerHTML =
      '<i class="fa-solid fa-plus" aria-hidden="true"></i> ' +
      `<span>${count ? 'إضافة قصة جديدة' : 'إضافة أول قصة'}</span>`;
    addBtn.title = count ? `هناك ${count} قصص محفوظة`
      : 'ابدأ بتوثيق أول موقف أو ذكرى لهذا الشخص';
  }

  // helper صغير: يبني label + icon فوق الحقل (بدون تكرار JSX)
function wrapFieldWithLabel(fieldEl, title, icon) {
  const wrap = el('div', 'biosec-meta-field story-meta-field');
  const lab = el('div', 'biosec-meta-label story-meta-label');
  lab.innerHTML = `<span class="biosec-meta-icon story-meta-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span> ${title}`;
  wrap.append(lab, fieldEl);
  return wrap;
}

  // ----------------------------------------------------------------------------
  // رسم القائمة
  // ----------------------------------------------------------------------------
function renderList() {
  const seq = ++renderSeq;

  // ✅ التقط nav مرة واحدة فورًا (قبل أي await) حتى لا يضيع
  let nav = null;
  try {
    nav = (typeof handlers?.__consumeBioNav === 'function') ? handlers.__consumeBioNav() : null;
  } catch (e) {
    console.warn('consume stories nav failed', e);
  }
  const navItemId = nav?.itemId || nav?.storyId || null;
  const navSourceId = nav?.sourceId ? String(nav.sourceId) : null;

  (async () => {
    // ✅ سخّن meta cache لكل refs في القصص قبل بناء القائمة
    await warmStoryMetaCache(collectAllStoryRefs(person));
    if (seq !== renderSeq) return;

    list.innerHTML = '';
    ensureStories(person);

    // ✅ (ضع هنا نفس كود renderList الحالي بدون تغيير)
    updateStoriesCountBadge();
    updateAddButtonLabel();
updatePinnedFilterUI();
syncResetFiltersBtnVisibility();

    // إعادة بناء فلتر النوع حسب الأنواع المستخدمة فعليًا
    {
      const usedTypesSet = new Set((person.stories || []).map(s => safeStr(s.type)).filter(Boolean));
      const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';
      const nextValue = storyType.rebuildSelectFromUsed(typeFilterSelect, usedTypesSet, prevValue, 'ar');
      currentTypeFilter = nextValue;
    }

    const filteredStories = (person.stories || []).filter(story => {
      const typeOk =
        currentTypeFilter === 'all' ||
        !currentTypeFilter ||
        (story.type || '') === currentTypeFilter;

      const moodOk = (currentMoodFilter === 'all') || safeStr(story.mood) === currentMoodFilter;
      const visOk = (currentVisibilityFilter === 'all') || safeStr(story.visibility) === currentVisibilityFilter;

      const tagOk =
        !currentTagFilter ||
        (Array.isArray(story.tags) && story.tags.includes(currentTagFilter));

const pinOk =
  (pinnedFilter === 'all') ||
  (pinnedFilter === 'pinned' && !!story.pinned) ||
  (pinnedFilter === 'not_pinned' && !story.pinned);

      const filesCount = Array.isArray(story.files) ? story.files.length : 0;
      const filesOk =
        filesFilter === 'all' ||
        (filesFilter === 'has' && filesCount > 0) ||
        (filesFilter === 'none' && filesCount === 0);

      const haystack = [
        story.title,
        story.text,
        story.place,
        Array.isArray(story.tags) ? story.tags.join(' ') : ''
      ].map(v => String(v || '').toLowerCase()).join(' | ');

      const searchOk = !currentSearchQuery || haystack.includes(currentSearchQuery);

      return typeOk && moodOk && visOk && tagOk && pinOk && filesOk && searchOk;
    });

    if (!filteredStories.length) {
      const empty = el('div', 'biosec-empty stories-empty');
      empty.textContent = person.stories.length ? 'لا توجد قصص مطابقة لخيارات التصفية أو البحث الحالي.'
        : 'ابدأ بإضافة أول قصة (موقف جميل، أو وصف مختصر لصفة بارزة).';
      list.appendChild(empty);
      return;
    }

    filteredStories.forEach((story, index) => {
      const serial = index + 1;

      const card = el('article', 'biosec-card story-card');
      card.dataset.storyId = story.id;

      // شريط علوي
      const topRow = el('div', 'biosec-card-top story-card-top');
      const indexBadge = el('div', 'biosec-card-index story-card-index');
      indexBadge.textContent = `القصة ${serial}`;

      let pinnedBadge = null;
      if (story.pinned) {
        pinnedBadge = el('div', 'biosec-pinned-badge story-pinned-badge');
        pinnedBadge.textContent = 'قصة مميّزة';
        card.classList.add('biosec-card--pinned');
      }

      topRow.appendChild(indexBadge);
      if (pinnedBadge) topRow.appendChild(pinnedBadge);
      card.appendChild(topRow);

      // Snapshot الأصل
      const original = {
        title: story.title || '',
        text: safeStr(story.text),
        files: shallowArr(story.files),
        sourceIds: shallowArr(story.sourceIds).map(String).filter(Boolean),
        type: safeStr(story.type),
        eventDate: story.eventDate || null,
        place: safeStr(story.place),
        tags: shallowArr(story.tags),
        mood: safeStr(story.mood),
        visibility: safeStr(story.visibility),
        narrator: safeStr(story.narrator),
        pinned: !!story.pinned,
        toTimeline: !!story.toTimeline,
        note: safeStr(story.note)
      };
const fallbackMatcher = (ev, sid, iid) => {
  // ✅ تنظيف/التقاط legacy القديم الخاص بالقصص
  const legacyKind = safeStr(ev?.kind || '');
  const legacyStoryId = safeStr(ev?.storyId || '');
  const rs = safeStr(ev?.relatedSectionId || '');
  const rid = safeStr(ev?.relatedItemId || '');

  // القديم: kind='story' أو storyId
  if (legacyKind === 'story' && iid && legacyStoryId === iid) return true;
  if (iid && legacyStoryId === iid) return true;

  // الجديد (لو كان في بيانات قديمة كتبتها يدويًا)
  if (rs === 'stories' && rid === iid) return true;

  return false;
};

const timelineState = getLinkedEventEdges(person.events || [], 'stories', story.id, fallbackMatcher);
let timelineEnabled = !!timelineState.enabled;
let timelineInitialEnabled = timelineEnabled;
let currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));
      let currentFiles = shallowArr(original.files);
      let isEditing =
        (story.id === lastEditedId) ||
        (draftNewMap.has(story.id) && isEmptyStoryDraft(story));

      let isDirty = false;
      let pendingDeletedFiles = [];
      let previewSeq = 0;

      // ----------------------------------------------------------------------------
      // Preview
      // ----------------------------------------------------------------------------
      const previewBox = el('div', 'biosec-preview story-preview');
      const previewMeta = el('div', 'biosec-preview-meta story-preview-meta');

      const dateLabel = el('span', 'biosec-preview-date story-preview-date');
      dateLabel.textContent = story.createdAt ? formatCreatedAtLabel(story.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime })
        : '';

      // ✅ آخر تعديل (يظهر فقط إذا اختلف عن تاريخ الإنشاء)
const updatedLabel = el('span', 'biosec-preview-updated story-preview-updated');

if (story.updatedAt && story.updatedAt !== story.createdAt) {
  updatedLabel.textContent =
    formatCreatedAtLabel(story.updatedAt, {
      prefix: 'آخر تعديل',
      formatter: formatFullDateTime
    });
} else {
  updatedLabel.style.display = 'none';
}

      const lengthLabel = el('span', 'biosec-length-chip story-length-chip');
      const lenInfo = getStoryLengthInfo(original.text.length);

      const words = countWords(original.text);
      const mins = getReadingMinutes(words);

      if (lenInfo.level === 0) {
        lengthLabel.textContent = 'لم تتم كتابة مضمون القصة بعد';
      } else {
        const meter = el('span', 'biosec-length-meter story-length-meter');
        meter.dataset.level = String(lenInfo.level);
        const bar = el('span', 'biosec-length-meter-bar story-length-meter-bar');
        meter.appendChild(bar);

        const txtSpan = el('span');
        txtSpan.textContent = `${lenInfo.label} • ${words} كلمة • ${mins} د قراءة`;
        lengthLabel.innerHTML = '';
        lengthLabel.append(meter, txtSpan);
      }

      previewMeta.append(dateLabel, lengthLabel, updatedLabel);

      const badgesWrap = el('div', 'biosec-preview-badges story-preview-badges');

      // المكان + تاريخ الحدث
      if (original.place) {
        const placeBadge = el('span', 'biosec-badge story-badge');
        placeBadge.textContent = original.place;
        badgesWrap.appendChild(placeBadge);
      }

function formatStoryEventDateBadge(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return s;      // سنة فقط
  return formatShortDateBadge(s);       // تاريخ كامل
}

const eventDateLabel = formatStoryEventDateBadge(original.eventDate);
{
  const dBadge = el('span', 'biosec-badge story-badge');
  dBadge.textContent = eventDateLabel || 'بدون تاريخ محدّد';
  badgesWrap.appendChild(dBadge);
}


      // النوع
      let typeBadge = null;
      const typeLabel = storyType.getLabel(original.type);
      if (typeLabel) {
        typeBadge = el('span', 'biosec-badge story-badge story-badge--type');
        typeBadge.dataset.storyId = story.id;
        typeBadge.dataset.type = original.type || 'general';
        typeBadge.textContent = typeLabel;
        badgesWrap.appendChild(typeBadge);
      }

      // mood
      if (original.mood) {
        const moodBadge = el('span', 'biosec-badge story-badge story-badge--mood');
        moodBadge.textContent =
          (STORY_MOOD_OPTIONS.find(([v]) => v === original.mood)?.[1]) || original.mood;
        badgesWrap.appendChild(moodBadge);
      }

      // visibility
      if (original.visibility) {
        const visBadge = el('span', 'biosec-badge story-badge story-badge--vis');
        visBadge.textContent =
          (STORY_VISIBILITY_OPTIONS.find(([v]) => v === original.visibility)?.[1]) || original.visibility;
        badgesWrap.appendChild(visBadge);
      }

      // toTimeline
if (timelineEnabled) {
        const tlBadge = el('span', 'biosec-badge story-badge story-badge--timeline');
        tlBadge.textContent = 'ضمن الخط الزمني';
        badgesWrap.appendChild(tlBadge);
      }

      const previewTitle = el('div', 'biosec-preview-title story-preview-title');
      const derivedTitle = original.title || inferTitleFromText(original.text) || 'قصة بدون عنوان';
      previewTitle.textContent = derivedTitle;

      const previewText = el('p', 'biosec-preview-text story-preview-text');
      previewText.textContent =
        original.text || 'لم تتم إضافة نص لهذه القصة حتى الآن. يمكنك فتح وضع التحرير لكتابته.';

      // tags chips
      const tagsWrap = el('div', 'biosec-tags-list story-tags-list');
      if (original.tags && original.tags.length) {
        original.tags.forEach(tag => {
          const chip = el(
            'button',
            'biosec-tag-chip story-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
          );
          chip.type = 'button';
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            currentTagFilter = currentTagFilter === tag ? '' : tag;
            syncResetFiltersBtnVisibility();
            persistStoriesFiltersState();
            renderList();
          });
          tagsWrap.appendChild(chip);
        });
      }
      // ===============================
      // ✅ Preview linked sources (مثل التعليم)
      // ===============================
      function renderPreviewLinkedSourcesStory() {
        const ids = shallowArr(original.sourceIds).map(String).filter(Boolean);
        if (!ids.length) return null;

        const box = el('div', 'biosec-linked-sources stories-linked-sources');

        const head = el('div', 'biosec-linked-sources-head stories-linked-sources-head');
        head.innerHTML =
          `<i class="fa-solid fa-link" aria-hidden="true"></i>` +
          `<span class="biosec-linked-sources-title stories-linked-sources-title">` +
          `المصادر المرتبطة بـ (${safeStr(original.title || 'القصة')})` +
          `</span>`;

        box.appendChild(head);

ids.forEach((sid) => {
  const src = sourceMap.get(String(sid));
  if (!src) return; // ✅ تجاهل المصدر المحذوف

  const chip = el('button', 'biosec-chip biosec-chip--source stories-linked-source-chip');
  chip.type = 'button';
  chip.textContent = getSourceLabelById(sid);
  chip.title = 'فتح هذا المصدر';
  chip.addEventListener('click', () => {
    handlers.onBioShortcutClick?.('sources', { sourceId: String(sid) });
  });
  box.appendChild(chip);
});
if (!box.querySelector('.biosec-chip--source')) return null;

        return box;
      }

      // الخلاصة
      const notePreview =
        original.note ? (() => {
          const div = el('div', 'biosec-note-preview story-note-preview');
          const strong = el('strong');
          strong.textContent = 'الخلاصة: ';
          const span = el('span');
          span.textContent = original.note;
          div.append(strong, span);
          return div;
        })() : null;

      // narrator
      const narratorPreview =
        original.narrator ? (() => {
          const div = el('div', 'biosec-note-preview story-narrator-preview');
          const strong = el('strong');
          strong.textContent = 'الراوي/المصدر: ';
          const span = el('span');
          span.textContent = original.narrator;
          div.append(strong, span);
          return div;
        })() : null;

      // ملفات: صور (thumbnails + slider) + باقي الأنواع (فتح)
      const previewFilesWrap = el('div', 'biosec-images-thumbs story-preview-files');
      const sliderBtn = el('button', 'biosec-images-slider-btn story-files-slider-btn');
      sliderBtn.type = 'button';
      sliderBtn.innerHTML =
        '<i class="fa-solid fa-images" aria-hidden="true"></i> <span>عرض الصور كشرائح</span>';

      function getKindForRef(ref) {
return getStoryFileKind(ref);
      }

      function classifyStoryThumb(thumb, ref) {
const raw = String(ref || '');

const meta =
  isTmpRef(raw) ? (storyFileMetaCache.get(raw) || storyTempCache.get(raw)?.meta || {})
  : isIdbRef(raw) ? (storyFileMetaCache.get(raw) || {})
  : null;

const ext = meta ? String(meta.ext || '').toLowerCase() : getRefExt(raw);
const kind = meta ? (meta.kind || inferFileKind({ ext, mime: meta.mime || '', ref: raw }))
  : inferFileKind({ ref: raw, ext });

  const key = `${kind || 'other'}|${ext || ''}`;
  if (thumb.dataset.storyThumbKey === key) return;
  thumb.dataset.storyThumbKey = key;

thumb.classList.remove(
  'biosec-file-thumb--image',
  'biosec-file-thumb--audio',
  'biosec-file-thumb--pdf',
  'biosec-file-thumb--word',
  'biosec-file-thumb--excel',
  'biosec-file-thumb--other'
);
  thumb.querySelectorAll('.biosec-file-ext').forEach(x => x.remove());

const cls =
  kind === 'image' ? 'biosec-file-thumb--image' :
  kind === 'audio' ? 'biosec-file-thumb--audio' :
  kind === 'pdf' ? 'biosec-file-thumb--pdf' :
  kind === 'word' ? 'biosec-file-thumb--word' :
  kind === 'excel' ? 'biosec-file-thumb--excel' :
  'biosec-file-thumb--other';
  thumb.classList.add(cls);

  if (ext) {
    const badge = el('span', 'biosec-file-ext');
    badge.textContent = String(ext).toUpperCase();
    thumb.appendChild(badge);
  }
}

async function openOrDownloadStoryRef(ref, { preferDownload = false, baseTitle = '', index = 0, total = 1 } = {}) {
  // نفس فكرة التعليم: افتح نافذة قبل await لتفادي الـ popup blocker
  const preOpened = (!preferDownload) ? window.open('about:blank', '_blank') : null;
  if (preOpened) preOpened.opener = null;

  const url = await resolveStoryFileUrl(ref);
  if (!url) { try { preOpened?.close(); } catch {} return; }

  if (preferDownload) {
    const name = buildDownloadName(baseTitle, ref, '', index, total, {});
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

function renderPreviewFiles() {
  const seq = ++previewSeq;

  (async () => {
    // ✅ سخّن meta لملفات هذه القصة قبل التصنيف
    await warmStoryMetaCache(original.files || []);
    if (seq !== previewSeq) return;

    // --- نفس جسم renderPreviewFiles الحالي بدون تغيير ---
    previewFilesWrap.innerHTML = '';

    const orderedRefs = groupRefsByKind(original.files || [], (r) => getKindForRef(r));
    const images = orderedRefs.filter(r => getKindForRef(r) === 'image');
    const others = orderedRefs.filter(r => getKindForRef(r) !== 'image');
    const hasTwoGroups = images.length && others.length;

    sliderBtn.style.display = images.length < 2 ? 'none' : '';
    sliderBtn.onclick = () => { if (images.length >= 2) openImageSlider(images, 0); };

    if (hasTwoGroups && images.length) {
      const gt = makeGroupTitle('الصور');
      gt.classList.add('biosec-files-group-title', 'story-files-group-title');
      previewFilesWrap.appendChild(gt);
    }

    const renderThumb = (ref, idx, totalRefs, imagesOnly) => {
      const thumb = el('div', 'biosec-image-thumb biosec-file-thumb story-file-thumb story-file-thumb--preview');
      thumb.dataset.ref = ref;

      classifyStoryThumb(thumb, ref);

      // ✅ هذا السطر كما هو عندك — الآن بعد warm سيصير صحيح
      const kind = getKindForRef(ref);

      const isDoc = (kind === 'word' || kind === 'excel');

      const footerRow = el('div', 'biosec-file-thumb-footer story-file-thumb-footer');

      const label = el('span', 'biosec-file-label story-file-label');
  label.textContent =
  kind === 'image' ? 'صورة' :
  kind === 'audio' ? 'صوت' :
  kind === 'pdf' ? 'PDF' :
  kind === 'word' ? 'Word' :
  kind === 'excel' ? 'Excel' : 'ملف';

      const actionBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view story-file-thumb-view');
      actionBtn.type = 'button';
actionBtn.textContent =
  kind === 'image' ? 'معاينة' :
  kind === 'audio' ? 'تشغيل' :
  (isDoc ? 'تحميل' : 'فتح');

      footerRow.append(label, actionBtn);

      if (kind === 'image') {
        const imgEl = el('img');
        imgEl.alt = 'صورة مرفقة بالقصة';
        resolveStoryFileUrl(ref).then(url => { if (url) imgEl.src = url; });

        const imageIndex = findImageIndex(imagesOnly, ref);
        const openImg = () => { if (imageIndex >= 0) openImageSlider(imagesOnly, imageIndex); };

        actionBtn.addEventListener('click', (e) => { e.stopPropagation(); openImg(); });
        imgEl.addEventListener('click', openImg);

        thumb.append(imgEl, footerRow);
      } else {
        const icon = el('div', 'biosec-file-icon story-file-icon');
 icon.innerHTML = {
  pdf: '<i class="fa-solid fa-file-pdf"></i>',
  word: '<i class="fa-solid fa-file-word"></i>',
  excel: '<i class="fa-solid fa-file-excel"></i>',
  audio: '<i class="fa-solid fa-file-audio"></i>',
  other: '<i class="fa-solid fa-file"></i>'
}[kind] || '<i class="fa-solid fa-file"></i>';

    const openIt = () => {
  if (isDoc) {
    openOrDownloadStoryRef(ref, { preferDownload: true, baseTitle: derivedTitle || 'قصة', index: idx, total: totalRefs });
    return;
  }

  // ✅ افتح/اعرض الملف عبر resolver بشكل آمن (بدون تمرير Promise)
  openOrDownloadStoryRef(ref, { preferDownload: false, baseTitle: derivedTitle || 'قصة', index: idx, total: totalRefs });
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
      const sliderRow = el('div', 'biosec-files-slider-row story-files-slider-row');
      sliderRow.appendChild(sliderBtn);
      previewFilesWrap.appendChild(sliderRow);
    }

    if (hasTwoGroups) {
      const div = makeDivider();
      div.classList.add('biosec-files-group-divider', 'story-files-group-divider');
      previewFilesWrap.appendChild(div);

      const gt2 = makeGroupTitle('الملفات');
      gt2.classList.add('biosec-files-group-title', 'story-files-group-title');
      previewFilesWrap.appendChild(gt2);
    }

    others.forEach((ref, idx) => renderThumb(ref, idx, others.length, images));
  })().catch((e) => console.error('renderPreviewFiles failed', e));
}

      renderPreviewFiles();

      previewBox.append(previewTitle, previewMeta, badgesWrap, previewText, tagsWrap);

      const linkedSourcesPreview = renderPreviewLinkedSourcesStory();
      if (linkedSourcesPreview) previewBox.appendChild(linkedSourcesPreview);

      if (notePreview) previewBox.appendChild(notePreview);
      if (narratorPreview) previewBox.appendChild(narratorPreview);

      previewBox.append(previewFilesWrap);
      card.appendChild(previewBox);

      // ======================================================================
      // (B) وضع التحرير Edit
      // ======================================================================

      const editBox = el('div', 'biosec-edit story-edit');

      const body = el('div', 'biosec-body story-body');
      
      // =====================
// أقسام وضع التعديل
// =====================
const basicSection = el('div', 'story-edit-section story-edit-section--basic');
const basicTitle = el('div', 'story-edit-section-title');
basicTitle.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> <span>بيانات أساسية</span>';

const extraSection = el('div', 'story-edit-section story-edit-section--extra');
const extraTitle = el('div', 'story-edit-section-title');
extraTitle.innerHTML = '<i class="fa-solid fa-list-check" aria-hidden="true"></i> <span>تفاصيل إضافية</span>';

const metaRow = el('div', 'biosec-meta-row story-meta-row');
// عنوان القصة
const titleInput = el('input', 'biosec-input story-title-input');
titleInput.type = 'text';
titleInput.name = `story_title_${story.id}`;
titleInput.placeholder = 'عنوان القصة (اختياري)';
titleInput.value = original.title;

// النوع
const typeSelect = el('select', 'biosec-select story-type-select');
typeSelect.name = `story_type_${story.id}`;
STORY_TYPE_OPTIONS.filter(([val]) => val && val !== 'all').forEach(([val, label]) => {
  const opt = el('option');
  opt.value = val;
  opt.textContent = label;
  typeSelect.appendChild(opt);
});
typeSelect.value = original.type || 'general';

// المكان
const placeInput = el('input', 'biosec-input biosec-place-input story-place-input');
placeInput.type = 'text';
placeInput.name = `story_place_${story.id}`;
placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
placeInput.value = original.place;

// تاريخ الحدث
const eventInput = el('input', 'biosec-input biosec-date-input story-event-date-input');
eventInput.type = 'date';
eventInput.id = `story_${story.id}_eventDate`;
eventInput.name = `story_event_${story.id}`;
eventInput.dataset.yearToggle = '1';
const eventWrap = withFieldHead(eventInput, { label: 'تاريخ الحدث', icon: 'fa-calendar-day' });

// المشاعر
const moodSelect = el('select', 'biosec-select story-mood-select');
moodSelect.name = `story_mood_${story.id}`;
STORY_MOOD_OPTIONS.filter(([v]) => v !== 'all').forEach(([v, t]) => {
  const opt = el('option');
  opt.value = v;
  opt.textContent = t;
  moodSelect.appendChild(opt);
});
moodSelect.value = original.mood || '';

// الخصوصية
const visibilitySelect = el('select', 'biosec-select story-visibility-select');
visibilitySelect.name = `story_visibility_${story.id}`;
STORY_VISIBILITY_OPTIONS.filter(([v]) => v !== 'all').forEach(([v, t]) => {
  const opt = el('option');
  opt.value = v;
  opt.textContent = t;
  visibilitySelect.appendChild(opt);
});
visibilitySelect.value = original.visibility || 'family';

// ✅ صف واحد فقط
metaRow.append(
  wrapFieldWithLabel(titleInput, 'عنوان القصة', 'fa-pen-nib'),
  wrapFieldWithLabel(typeSelect, 'نوع القصة', 'fa-tag'),
  wrapFieldWithLabel(placeInput, 'المكان', 'fa-location-dot'),
  eventWrap,
  wrapFieldWithLabel(visibilitySelect, 'الخصوصية', 'fa-user-shield'),
  wrapFieldWithLabel(moodSelect, 'مشاعر القصة', 'fa-face-smile')
);

// year toggle (مرة واحدة فقط)
try {
  attachYearModeToggle(eventInput, { root: eventWrap });
} catch (e) {
  console.warn('attachYearModeToggle failed', e);
}

// اضبط القيمة (YYYY أو YYYY-MM-DD) حسب وضع السنة
setYearToggleValue(eventInput, original.eventDate || '', { silent: true });

basicSection.append(basicTitle, metaRow);

      // mood + visibility

      const textArea = el('textarea', 'biosec-textarea story-textarea');
      textArea.rows = 5;
      textArea.name = `story_text_${story.id}`;
      textArea.placeholder = 'اكتب هنا الموقف أو القصة بالتفصيل...';
      textArea.value = original.text;
      const noteInput = el('textarea', 'biosec-textarea story-note-input');
      noteInput.name = `story_note_${story.id}`;
      noteInput.placeholder = 'ما الدرس أو الفائدة من هذه القصة؟ (اختياري)';
      noteInput.value = original.note;

const tagsInput = el('input', 'biosec-input biosec-tags-input story-tags-input');
      tagsInput.type = 'text';
      tagsInput.name = `story_tags_${story.id}`;
      tagsInput.placeholder = 'وسوم القصة (افصل بينها بفواصل مثل: عام, الطفولة, الدراسة, طرائف)';
      tagsInput.value = original.tags.join(', ');

      // ✅ الراوي/المصدر
      const narratorInput = el('input', 'biosec-input story-narrator-input');
      narratorInput.type = 'text';
      narratorInput.name = `story_narrator_${story.id}`;
      narratorInput.placeholder = 'الراوي/المصدر (مثال: قالها فلان / من مذكراته / مقابلة...)';
      narratorInput.value = original.narrator;

      // ✅ قسم التفاصيل الإضافية (من نص القصة إلى الراوي)
const storyTextField = (() => {
  const fieldWrap = withFieldHead(textArea, { label: 'نص القصة', icon: 'fa-align-right' });

  const head = fieldWrap.querySelector('.biosec-field-head');
  if (head) {
    const promptBtn = el('button', 'story-prompt-btn');
    promptBtn.type = 'button';
    promptBtn.title = 'إدراج قالب كتابة سريع';
    promptBtn.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ' +
      '<span>قالب سريع</span>';

    promptBtn.addEventListener('click', () => {
      const tpl =
        'ماذا حدث؟\n' +
        'متى حدث ذلك؟\n' +
        'أين حدث؟\n' +
        'كيف كان شعورك/شعوره؟\n' +
        'ما الدرس أو الفائدة؟\n';

      if (!safeStr(textArea.value)) textArea.value = tpl;
      else textArea.value = safeStr(textArea.value) + '\n\n' + tpl;

      recomputeDirty();
      textArea.focus();
    });

    head.appendChild(promptBtn);
  }

  return fieldWrap;
})();

extraSection.append(
  extraTitle,
  storyTextField,
  withFieldHead(noteInput, { label: 'الخلاصة / الدرس', icon: 'fa-note-sticky' }),
  withFieldHead(narratorInput, { label: 'الراوي / المصدر', icon: 'fa-user-pen' }),
  withFieldHead(tagsInput, { label: 'الوسوم', icon: 'fa-tags' })
);

// ===============================
// ✅ Stories linked sources picker
// ===============================
const sourcesField = el('div', 'biosec-meta-field story-meta-field story-meta-field--sources');
const sourcesLabel = el('div', 'biosec-field-label story-field-label story-field-label--sources');
sourcesLabel.innerHTML =
  '<i class="fa-solid fa-link" aria-hidden="true"></i> ' +
  '<span>المصادر</span>';

sourcesField.appendChild(sourcesLabel);

const srcHead = el('div', 'biosec-linked-sources-head stories-linked-sources-head');

const srcTitle = el('div', 'biosec-linked-sources-title stories-linked-sources-title');
srcTitle.innerHTML =
  '<i class="fa-solid fa-circle-nodes" aria-hidden="true"></i>' +
  `<span>اختر مصادر توثيق بـ (${safeStr(original.title || 'القصة')})</span>`;

srcHead.appendChild(srcTitle);

const srcTools = el('div', 'biosec-linked-sources-tools stories-linked-sources-tools');

const srcCount = el('div', 'biosec-linked-sources-count stories-linked-sources-count');
srcCount.dataset.active = '0';
srcCount.textContent = 'لا يوجد تحديد';

const srcSearchWrap = el('div', 'biosec-search-wrap biosec-linked-sources-search-wrap stories-linked-sources-search-wrap');
const srcSearch = el('input', 'biosec-linked-sources-search stories-linked-sources-search');
srcSearch.type = 'search';
srcSearch.name = 'stories-linked-sources-search';
srcSearch.placeholder = 'ابحث داخل المصادر…';
srcSearch.value = '';

const srcSearchClear = el('button', 'biosec-search-clear biosec-linked-sources-search-clear stories-linked-sources-search-clear');
srcSearchClear.type = 'button';
srcSearchClear.title = 'مسح البحث';
srcSearchClear.setAttribute('aria-label', 'مسح البحث');
srcSearchClear.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>';
srcSearchClear.style.display = 'none';

srcSearchWrap.append(srcSearch, srcSearchClear);

const btnAll = el('button', 'biosec-linked-sources-btn stories-linked-sources-btn');
btnAll.type = 'button';
btnAll.textContent = 'تحديد الكل';

const btnNone = el('button', 'biosec-linked-sources-btn stories-linked-sources-btn');
btnNone.type = 'button';
btnNone.textContent = 'إلغاء الكل';

const btnInvert = el('button', 'biosec-linked-sources-btn stories-linked-sources-btn');
btnInvert.type = 'button';
btnInvert.textContent = 'عكس';

srcTools.append(srcCount, srcSearchWrap, btnAll, btnNone, btnInvert);

const linkedSourcesList = el('div', 'biosec-linked-sources-list stories-linked-sources-list');
const emptyMini = el('div', 'biosec-empty-mini biosec-linked-sources-empty stories-linked-sources-empty');
emptyMini.style.display = 'none';
emptyMini.textContent = 'لا توجد مصادر مطابقة لبحثك.';
linkedSourcesList.appendChild(emptyMini);

sourcesField.append(srcHead, srcTools, linkedSourcesList);

function setSourcesCountLabel() {
  const n = Array.isArray(currentSourceIds) ? currentSourceIds.length : 0;
  if (!n) {
    srcCount.dataset.active = '0';
    srcCount.textContent = 'لا يوجد تحديد';
  } else {
    srcCount.dataset.active = '1';
    srcCount.textContent = `تم تحديد ${n}`;
  }
}

function renderLinkedSourcesStory() {
  linkedSourcesList.querySelectorAll('.stories-linked-sources-row').forEach(n => n.remove());

  const q = (srcSearch.value || '').trim().toLowerCase();
  const all = Array.isArray(person?.sources) ? person.sources : [];

  const filtered = !q ? all : all.filter(s => {
    const text = [
      s?.title, s?.name, s?.label, s?.type, s?.id,
      s?.holderName, s?.nationalId, s?.civilRegistryNo
    ].map(x => safeStr(x)).join(' ').toLowerCase();
    return text.includes(q);
  });

  emptyMini.style.display = filtered.length ? 'none' : '';

  filtered.forEach((src) => {
    const sid = String(src.id);

    const row = el('label', 'stories-linked-sources-row biosec-linked-sources-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.name = 'stories-linked-source-row';
    cb.dataset.sid = sid;
    cb.checked = currentSourceIds.includes(sid);

    const label = el('span', 'biosec-linked-sources-label stories-linked-sources-label');
    label.textContent = getSourceLabelById(sid);

    row.append(cb, label);
    linkedSourcesList.appendChild(row);
  });

  srcSearchClear.style.display = (srcSearch.value || '').trim() ? '' : 'none';
  setSourcesCountLabel();
}

// delegation
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

  renderLinkedSourcesStory();
  recomputeDirty();
});

srcSearch.addEventListener('input', () => renderLinkedSourcesStory());
srcSearchClear.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  srcSearch.value = '';
  renderLinkedSourcesStory();
  srcSearch.focus();
});

btnAll.addEventListener('click', () => {
  const allIds = (Array.isArray(person?.sources) ? person.sources : []).map(s => String(s.id));
  currentSourceIds = shallowArr(allIds);
  renderLinkedSourcesStory();
  recomputeDirty();
});

btnNone.addEventListener('click', () => {
  currentSourceIds = [];
  renderLinkedSourcesStory();
  recomputeDirty();
});

btnInvert.addEventListener('click', () => {
  const allIds = (Array.isArray(person?.sources) ? person.sources : []).map(s => String(s.id));
  const set = new Set(currentSourceIds);
  currentSourceIds = allIds.filter(id => !set.has(id));
  renderLinkedSourcesStory();
  recomputeDirty();
});

renderLinkedSourcesStory();

// ✅ ربط بالخط الزمني (كلاسات عامة قابلة لإعادة الاستخدام)
const timelineWrap = el('label', 'biosec-pin-toggle biosec-toggle--timeline');
const timelineCheckbox = el('input');
timelineCheckbox.type = 'checkbox';
timelineCheckbox.name = `story_timeline_${story.id}`;
timelineCheckbox.checked = timelineEnabled;
const timelineText = textEl('span', 'إضافة إلى الخط الزمني');
timelineWrap.append(timelineCheckbox, timelineText);

// ✅ مميّزة (كلاسات عامة قابلة لإعادة الاستخدام)
const pinWrap = el('label', 'biosec-pin-toggle biosec-toggle--pinned');
const pinCheckbox = el('input');
pinCheckbox.type = 'checkbox';
pinCheckbox.name = `story_pinned_${story.id}`;
pinCheckbox.checked = original.pinned;
const pinText = textEl('span', 'تعيين هذه القصة كمميّزة');
pinWrap.append(pinCheckbox, pinText);

// ✅ اجمع زر الخط الزمني + زر المميّزة داخل صف واحد (نحافظ على الهيكل)
const togglesRow = el('div', 'biosec-toggles-row story-toggles-row');
togglesRow.append(pinWrap, timelineWrap);

      // ----------------------------------------------------------------------------
      // files block (بدل images)
      // ----------------------------------------------------------------------------
      const filesBlock = el('div', 'biosec-images-block story-files-block');
      const emptyFilesHint = el('div', 'biosec-images-empty-hint story-files-empty-hint');
      const filesRow = el('div', 'biosec-images-row story-files-row');
      const filesThumbs = el('div', 'biosec-images-thumbs story-files-thumbs');

      const addFileLabel = el('label', 'biosec-add-btn story-file-add-btn');
      const addFileIcon = el('span', 'story-file-add-icon');
      addFileIcon.innerHTML = '<i class="fa-solid fa-paperclip" aria-hidden="true"></i>';
      const addFileText = el('span', 'story-file-add-text');

      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      addFileLabel.append(addFileIcon, addFileText, fileInput);
      filesRow.appendChild(filesThumbs);
filesBlock.append(filesRow, addFileLabel, emptyFilesHint);
emptyFilesHint.style.marginTop = '.35rem';

      function updateAddFileLabel() {
        const count = currentFiles.length || 0;
        addFileText.textContent = count ? 'إضافة ملفات أخرى' : 'إضافة ملفات للقصة';
        addFileLabel.title = count ? `هناك ${count} ملفات مرفقة حاليًا` : 'أرفق ملفات/صور توثّق القصة';
      }

      function setupFilesSortable() {
        attachHorizontalSortable({
          container: filesThumbs,
          itemSelector: '.story-file-thumb',
          ghostClass: 'biosec-image-thumb--ghost story-file-thumb--ghost',
          dragClass: 'biosec-image-thumb--drag story-file-thumb--drag',
          onSorted(orderedRefs) {
            currentFiles = orderedRefs.slice();
            renderFilesThumbs();
            recomputeDirty();
          }
        });
      }

function renderFilesThumbs() {
  filesThumbs.innerHTML = '';

const ordered = groupRefsByKind(currentFiles, (r) => getStoryFileKind(r));
currentFiles = ordered;

const images = ordered.filter(r => getStoryFileKind(r) === 'image');
const others = ordered.filter(r => getStoryFileKind(r) !== 'image');

  const hasTwoGroups = images.length && others.length;

  if (!currentFiles.length) {
    emptyFilesHint.textContent = 'لم تُرفق ملفات بعد لهذه القصة.';
    emptyFilesHint.style.display = '';
    updateAddFileLabel();
    return;
  }

  emptyFilesHint.style.display = 'none';

  if (hasTwoGroups && images.length) {
    const gt = makeGroupTitle('الصور');
    gt.classList.add('biosec-files-group-title', 'story-files-group-title');
    filesThumbs.appendChild(gt);
  }

  const renderOne = (ref, idx, totalRefs, imagesOnly) => {
    const thumb = el('div', 'biosec-image-thumb biosec-file-thumb story-file-thumb');
    thumb.dataset.ref = ref;

    classifyStoryThumb(thumb, ref);

const kind = getStoryFileKind(ref);
    const isDoc = (kind === 'word' || kind === 'excel');

    let thumbContent = null;

    if (kind === 'image') {
      const imgEl = el('img');
      imgEl.alt = 'صورة مرفقة بالقصة';
      resolveStoryFileUrl(ref).then(url => { if (url) imgEl.src = url; });

      const imageIndex = findImageIndex(imagesOnly, ref);
      imgEl.addEventListener('click', () => { if (imageIndex >= 0) openImageSlider(imagesOnly, imageIndex); });

      thumbContent = imgEl;
    } else {
      const icon = el('div', 'biosec-file-icon story-file-icon');
icon.innerHTML = {
  pdf: '<i class="fa-solid fa-file-pdf"></i>',
  word: '<i class="fa-solid fa-file-word"></i>',
  excel: '<i class="fa-solid fa-file-excel"></i>',
  audio: '<i class="fa-solid fa-file-audio"></i>',
  other: '<i class="fa-solid fa-file"></i>'
}[kind] || '<i class="fa-solid fa-file"></i>';

const openIt = () => {
  const base = (titleInput.value.trim() || derivedTitle || 'قصة');

  if (isDoc) {
    openOrDownloadStoryRef(ref, { preferDownload: true, baseTitle: base, index: idx, total: totalRefs });
    return;
  }

  // ✅ فتح آمن بدون Promise
  openOrDownloadStoryRef(ref, { preferDownload: false, baseTitle: base, index: idx, total: totalRefs });
};

      icon.style.cursor = 'pointer';
      icon.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
      thumb.addEventListener('click', openIt);

      thumbContent = icon;
    }

    const removeBtn = el('button', 'biosec-image-thumb-remove story-file-thumb-remove');
    removeBtn.type = 'button';
    removeBtn.title = 'إزالة هذا الملف';
    removeBtn.textContent = '×';

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const removeRef = ref;

      // tmp: احذف فوراً
      if (removeRef && isTmpRef(removeRef)) revokeTempStoryRef(removeRef);

      // idb: سجّل للحذف بعد الحفظ
      if (removeRef && isIdbRef(removeRef)) pendingDeletedFiles.push(removeRef);

      currentFiles = currentFiles.filter(r => String(r) !== String(removeRef));
      renderFilesThumbs();
      recomputeDirty();
    });

    const viewBtn = el('button', 'biosec-image-thumb-view biosec-file-thumb-view story-file-thumb-view');
    viewBtn.type = 'button';
viewBtn.textContent =
  kind === 'image' ? 'معاينة' :
  kind === 'audio' ? 'تشغيل' :
  (isDoc ? 'تحميل' : 'فتح');

    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (kind === 'image') {
        const imageIndex = findImageIndex(imagesOnly, ref);
        if (imageIndex >= 0) openImageSlider(imagesOnly, imageIndex);
        return;
      }

      if (isDoc) {
        openOrDownloadStoryRef(ref, { preferDownload: true, baseTitle: (titleInput.value.trim() || derivedTitle || 'قصة'), index: idx, total: totalRefs });
        return;
      }

openOrDownloadStoryRef(ref, { preferDownload: false, baseTitle: (titleInput.value.trim() || derivedTitle || 'قصة'), index: idx, total: totalRefs });
    });

    thumb.append(thumbContent, removeBtn, viewBtn);
    filesThumbs.appendChild(thumb);
  };

  images.forEach((ref, idx) => renderOne(ref, idx, images.length, images));

  if (hasTwoGroups) {
    const div = makeDivider();
    div.classList.add('biosec-files-group-divider', 'story-files-group-divider');
    filesThumbs.appendChild(div);

    const gt2 = makeGroupTitle('الملفات');
    gt2.classList.add('biosec-files-group-title', 'story-files-group-title');
    filesThumbs.appendChild(gt2);
  }

  others.forEach((ref, idx) => renderOne(ref, idx, others.length, images));

  updateAddFileLabel();
  setupFilesSortable();
}

      renderFilesThumbs();

      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;

        for (const f of files) {
          try {
            const tmpRef = addTempStoryFile(f);
            currentFiles.push(tmpRef);
          } catch (e) {
            console.error('failed to add temp story file', e);
            showError?.('تعذّر تجهيز أحد الملفات للمعاينة. حاول مرة أخرى.');
          }
        }

        renderFilesThumbs();
        recomputeDirty();
        fileInput.value = '';
      });

body.append(
  basicSection,
  extraSection,
 sourcesField,
  withFieldHead(filesBlock, { label: 'الملفات المرفقة (صور / وثائق)', icon: 'fa-paperclip' }),
  togglesRow
);


      editBox.appendChild(body);
      card.appendChild(editBox);

      // ----------------------------------------------------------------------------
      // Footer buttons
      // ----------------------------------------------------------------------------
      const footer = el('div', 'biosec-footer story-footer');

      const saveBtn = el('button', 'biosec-save-btn story-save-btn');
      saveBtn.type = 'button';

      const cancelBtn = el('button', 'biosec-cancel-btn story-cancel-btn');
      cancelBtn.type = 'button';
      cancelBtn.innerHTML =
        '<i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> <span>إلغاء التعديل</span>';

      const delBtn = el('button', 'biosec-delete-btn story-delete-btn');
      delBtn.type = 'button';
      delBtn.innerHTML =
        '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> <span>حذف القصة</span>';

      footer.append(saveBtn, cancelBtn, delBtn);
      card.appendChild(footer);

      function applyMode() {
applyCardEditMode({
  card,
  isEditing,
  isDirty,
  previewBox,
  editBox,
  saveBtn,
  cancelBtn,
  classes: { edit: 'story-card--edit', preview: 'story-card--preview' },
  labels: { edit: 'تعديل', close: 'إغلاق', save: 'حفظ' },
  icons: { edit: 'fa-pen-to-square', close: 'fa-circle-xmark', save: 'fa-floppy-disk' }
});

      }

      function recomputeDirty() {
        const curTitle = titleInput.value.trim();
        const curText = textArea.value.trim();
        const curType = typeSelect.value.trim();
const curEvent = getLogicalDateValue(eventInput) || null;
        const curPlace = placeInput.value.trim();
        const curTags = splitCommaTags(tagsInput.value);
        const curNote = noteInput.value.trim();
        const curPinned = !!pinCheckbox.checked;
        const curTimeline = !!timelineCheckbox.checked;
        const curMood = moodSelect.value.trim();
        const curVis = visibilitySelect.value.trim();
        const curNarrator = narratorInput.value.trim();
        const curSourceSorted = shallowArr(currentSourceIds).slice().sort();
        const origSourceSorted = shallowArr(original.sourceIds).slice().sort();
        const sourcesChanged = curSourceSorted.join('|') !== origSourceSorted.join('|');

        isDirty =
          curTitle !== original.title ||
          curText !== original.text ||
          curType !== original.type ||
curEvent !== (original.eventDate || null) ||
          curPlace !== original.place ||
          curPinned !== original.pinned ||
curTimeline !== (timelineInitialEnabled === true) ||
          curNote !== original.note ||
          curMood !== original.mood ||
          curVis !== original.visibility ||
          curNarrator !== original.narrator ||
          curTags.join('|') !== (original.tags || []).join('|') ||
          sourcesChanged ||
          !arraysShallowEqual(currentFiles, original.files);

        applyMode();
      }

      applyMode();

      // مراقبة التغييرات
      titleInput.addEventListener('input', recomputeDirty);
      textArea.addEventListener('input', recomputeDirty);
      typeSelect.addEventListener('change', recomputeDirty);
eventInput.addEventListener('input', () => { recomputeDirty(); });
eventInput.addEventListener('change', () => { recomputeDirty(); });
      placeInput.addEventListener('input', recomputeDirty);
      tagsInput.addEventListener('input', recomputeDirty);
      noteInput.addEventListener('input', recomputeDirty);
      narratorInput.addEventListener('input', recomputeDirty);
      pinCheckbox.addEventListener('change', recomputeDirty);
      timelineCheckbox.addEventListener('change', recomputeDirty);
      moodSelect.addEventListener('change', recomputeDirty);
      visibilitySelect.addEventListener('change', recomputeDirty);

      // ----------------------------------------------------------------------------
      // حفظ/إغلاق/فتح تحرير
      // ----------------------------------------------------------------------------
      saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = story.id;
          applyMode();
          showInfo?.('يمكنك الآن تعديل القصة ثم الضغط على "حفظ" لتثبيت التعديلات.');
          return;
        }

        if (isEditing && !isDirty) {
          const isDraft = draftNewMap.has(story.id);
          const isEmptyDraft = isEmptyStoryDraft(story); // ✅ قياس مباشر

          if (isDraft && isEmptyDraft) {
            pendingDeletedFiles = [];
            storySectionTmp.cleanupTmp(currentFiles);

            const success = deleteStory(person, story.id, {
              onChange: (stories, removed) => {
                handlers.onDirty?.(stories, removed);
                emitStoriesToHost();
              }
            });

            draftNewMap.delete(story.id);
            if (lastEditedId === story.id) lastEditedId = null;

            if (!success) {
              showError?.('تعذر إلغاء مسودة القصة. حاول مرة أخرى.');
              return;
            }

            renderList();
            showInfo?.('تم إلغاء إنشاء مسودة القصة الفارغة.');
            return;
          }

          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر القصة.');
          return;
        }

        const newTitle = titleInput.value.trim();
        const newText = textArea.value.trim();
        const newType = typeSelect.value.trim();
const newEventDate = getLogicalDateValue(eventInput) || null;
        const newPlace = placeInput.value.trim();
        const newTags = splitCommaTags(tagsInput.value);
        const newNote = noteInput.value.trim();
        const newPinned = !!pinCheckbox.checked;
        const newTimeline = !!timelineCheckbox.checked;
        const newMood = moodSelect.value.trim();
        const newVis = visibilitySelect.value.trim();
        const newNarrator = narratorInput.value.trim();

        // ترقية tmp -> idb للملفات
        const hasTmp = currentFiles.some(r => isTmpRef(r));
        if (hasTmp && typeof DB?.putStoryFile !== 'function') {
          showError?.('ميزة حفظ الملفات غير متاحة حالياً (DB.putStoryFile غير موجود).');
          return;
        }

        const up = await upgradeTmpRefs(currentFiles, {
          tempCache: storySectionTmp.tempCache,
          putFn: async (rec) => {
            // rec.file (Blob) + rec.meta (mime/name/ext/kind)
            return DB.putStoryFile({
              file: rec.file,
              personId,
              storyId: story.id,
              meta: rec.meta || null
            });
          },
          onFail: (ref, e) => console.error('Failed to store temp story file', ref, e),
          revokeFn: (ref) => storySectionTmp.revokeTemp(ref)
        });

        if (!up.ok) {
          showError?.('تعذّر حفظ أحد الملفات. لم يتم حفظ التعديلات.');
          return;
        }

        currentFiles = up.refs;

        const updated = updateStory(
          person,
          story.id,
          {
            title: newTitle,
            text: newText,
            files: currentFiles,
sourceIds: shallowArr(currentSourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid))),

            type: newType,
            eventDate: newEventDate,
            place: newPlace,
            tags: newTags,
            note: newNote,
            pinned: newPinned,
            toTimeline: newTimeline,
            mood: newMood,
            visibility: newVis,
            narrator: newNarrator,
          },
          {
            onChange: (stories, changed) => {
              handlers.onDirty?.(stories, changed);
              emitStoriesToHost();
            }
          }
        );

        const effective = updated || story;
const prevDates = { eventDate: original.eventDate || null };

// ✅ Upsert linked timeline event for story
upsertSectionEvents(person, handlers, {
  sectionId: 'stories',
  item: effective,
  enabled: !!timelineCheckbox.checked && !!effective?.eventDate,
  prevDates,
  fallbackMatcher,
  makeEvents: (st) => {
    const ev = makeStoryTimelineEvent(st, storyType.getLabel(st?.type));
    return ev ? [ev] : [];
  }
});

// ✅ حدّث baseline بعد الحفظ
timelineInitialEnabled = !!timelineCheckbox.checked && !!effective?.eventDate;
timelineEnabled = timelineInitialEnabled;

        // حذف ملفات idb المؤجلة بعد الحفظ
        for (const ref of pendingDeletedFiles) {
          try { await DB?.deleteStoryFile?.(ref); } catch (e) { console.error('deleteStoryFile failed', ref, e); }
        }
        pendingDeletedFiles = [];

        // تحديث snapshot
        original.title = safeStr(effective.title);
        original.text = safeStr(effective.text);
        original.files = shallowArr(effective.files);
        original.type = safeStr(effective.type);
        original.eventDate = effective.eventDate || null;
        original.place = safeStr(effective.place);
        original.tags = shallowArr(effective.tags);
        original.note = safeStr(effective.note);
        original.pinned = !!effective.pinned;
        original.toTimeline = !!effective.toTimeline;
        original.mood = safeStr(effective.mood);
        original.visibility = safeStr(effective.visibility);
        original.narrator = safeStr(effective.narrator);
        currentFiles = shallowArr(original.files);
    original.sourceIds = shallowArr(effective.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

currentSourceIds = shallowArr(original.sourceIds);
renderLinkedSourcesStory();

        // تحديث preview
        previewTitle.textContent = original.title || inferTitleFromText(original.text) || 'قصة بدون عنوان';
        previewText.textContent = original.text || 'لم تتم إضافة نص لهذه القصة حتى الآن. يمكنك فتح وضع التحرير لكتابته.';
        renderPreviewFiles();
// ✅ تحديث بلوك المصادر في المعاينة بعد الحفظ
previewBox.querySelectorAll('.stories-linked-sources').forEach(x => x.remove());
const chips = renderPreviewLinkedSourcesStory();
if (chips) tagsWrap.insertAdjacentElement('afterend', chips);

        const info2 = getStoryLengthInfo(original.text.length);
        if (info2.level === 0) {
          lengthLabel.textContent = 'لم تتم كتابة مضمون القصة بعد';
        } else {
          const w2 = countWords(original.text);
          const m2 = getReadingMinutes(w2);
          const meter2 = el('span', 'biosec-length-meter story-length-meter');
          meter2.dataset.level = String(info2.level);
          const bar2 = el('span', 'biosec-length-meter-bar story-length-meter-bar');
          meter2.appendChild(bar2);

          const txtSpan2 = el('span');
          txtSpan2.textContent = `${info2.label} • ${w2} كلمة • ${m2} د قراءة`;
          lengthLabel.innerHTML = '';
          lengthLabel.append(meter2, txtSpan2);
        }

  if (effective.createdAt) {
  const labelText = formatCreatedAtLabel(effective.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime });
  dateLabel.textContent = labelText;
}

        // ✅ تحديث تاريخ آخر تعديل في المعاينة
if (effective.updatedAt && effective.updatedAt !== effective.createdAt) {
  updatedLabel.textContent =
    formatCreatedAtLabel(effective.updatedAt, {
      prefix: 'آخر تعديل',
      formatter: formatFullDateTime
    });
  updatedLabel.style.display = '';
} else {
  updatedLabel.style.display = 'none';
}


        const effectiveType = safeStr(effective.type) || 'general';
        const newTypeLabel = storyType.getLabel(effectiveType) || '';
        if (typeBadge) {
          typeBadge.textContent = newTypeLabel;
          typeBadge.dataset.type = effectiveType;
        }
        document
          .querySelectorAll(`.story-badge--type[data-story-id="${story.id}"]`)
          .forEach(node => { node.textContent = newTypeLabel; node.dataset.type = effectiveType; });

        draftNewMap.delete(story.id);
        isEditing = false;
        lastEditedId = null;
        isDirty = false;

        renderList();
        showSuccess?.('تم حفظ تعديلات القصة بنجاح');
      });

      // ----------------------------------------------------------------------------
      // إلغاء التعديل
      // ----------------------------------------------------------------------------
      cancelBtn.addEventListener('click', () => {
        if (!isEditing) return;

        pendingDeletedFiles = [];

        titleInput.value = original.title;
        textArea.value = original.text;

        storySectionTmp.cleanupTmp(currentFiles);

        currentFiles = shallowArr(original.files);
        renderFilesThumbs();
        renderPreviewFiles();
currentSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => sourceMap.has(String(sid)));

renderLinkedSourcesStory();

if (story.createdAt) {
  const labelText = formatCreatedAtLabel(story.createdAt, { prefix: 'أضيفت', formatter: formatFullDateTime });
  dateLabel.textContent = labelText;
}


        typeSelect.value = original.type || 'general';
setYearToggleValue(eventInput, original.eventDate || '', { silent: true });
        placeInput.value = original.place;
        tagsInput.value = (original.tags || []).join(', ');
        noteInput.value = original.note;
        pinCheckbox.checked = original.pinned;
timelineCheckbox.checked = (timelineInitialEnabled === true);
        moodSelect.value = original.mood || '';
        visibilitySelect.value = original.visibility || 'family';
        narratorInput.value = original.narrator || '';

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        applyMode();

        showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من القصة.');
      });

      // ----------------------------------------------------------------------------
      // حذف القصة
      // ----------------------------------------------------------------------------
      delBtn.addEventListener('click', async () => {
        const res = await showConfirmModal?.({
          title: 'حذف القصة',
          message: 'هل تريد بالتأكيد حذف هذه القصة؟ لا يمكن التراجع عن هذا الإجراء.',
          variant: 'danger',
          confirmText: 'حذف',
          cancelText: 'إلغاء'
        });

        if (res !== 'confirm') {
          showInfo?.('تم إلغاء حذف القصة.');
          return;
        }

        storySectionTmp.cleanupTmp(currentFiles);

        // حذف كل ملفات القصة من IndexedDB
        const refs = Array.isArray(original.files) ? original.files : [];
        for (const ref of refs) {
          if (!isIdbRef(ref)) continue;
          try { await DB?.deleteStoryFile?.(ref); } catch (e) { console.error('deleteStoryFile failed', ref, e); }
        }

        for (const ref of pendingDeletedFiles) {
          if (!isIdbRef(ref)) continue;
          try { await DB?.deleteStoryFile?.(ref); } catch (e) { console.error('deleteStoryFile (pending) failed', ref, e); }
        }
        pendingDeletedFiles = [];

        const success = deleteStory(person, story.id, {
          onChange: (stories, removed) => {
            handlers.onDirty?.(stories, removed);
            emitStoriesToHost();
          }
        });

        if (!success) {
          showError?.('تعذر حذف القصة. حاول مرة أخرى.');
          return;
        }

        if (lastEditedId === story.id) lastEditedId = null;
        draftNewMap.delete(story.id);

// ✅ remove linked timeline events for this story
upsertSectionEvents(person, handlers, {
  sectionId: 'stories',
  item: { id: story.id },
  enabled: false,
  prevDates: { eventDate: original.eventDate || null },
  fallbackMatcher
});

        renderList();
        showSuccess?.('تم حذف القصة بنجاح.');
      });

      list.appendChild(card);
    });
    autoResizeTextareas(list, '.story-textarea, .story-note-input');

    // ✅ بعد ما تنبني البطاقات: scroll + highlight
    if (navItemId) {
      const card = list.querySelector(`.story-card[data-story-id="${String(navItemId)}"]`);
      if (card) {
        try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        catch { try { card.scrollIntoView(true); } catch {} }

        card.classList.add('biosec-card--jump-highlight');
        setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);
      }
    } else if (navSourceId) {
      const hit = filteredStories.find(st =>
        Array.isArray(st?.sourceIds) && st.sourceIds.map(String).includes(navSourceId)
      );

      if (hit) {
        const card = list.querySelector(`.story-card[data-story-id="${String(hit.id)}"]`);
        if (card) {
          try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
          catch { try { card.scrollIntoView(true); } catch {} }

          card.classList.add('biosec-card--jump-highlight');
          setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);
        }
      }
    }


  })().catch((e) => console.error('renderList failed', e));
}

  // ----------------------------------------------------------------------------
  // أحداث أدوات القسم
  // ----------------------------------------------------------------------------
pinnedFilterSelect.addEventListener('change', () => {
  pinnedFilter = pinnedFilterSelect.value || 'all';
  syncResetFiltersBtnVisibility();
  persistStoriesFiltersState();
  renderList();
});


  filesFilterSelect.addEventListener('change', () => {
    filesFilter = filesFilterSelect.value || 'all';
    syncResetFiltersBtnVisibility();
    persistStoriesFiltersState();
    renderList();
  });

  moodFilterSelect.addEventListener('change', () => {
    currentMoodFilter = moodFilterSelect.value || 'all';
    syncResetFiltersBtnVisibility();
    persistStoriesFiltersState();
    renderList();
  });

  visibilityFilterSelect.addEventListener('change', () => {
    currentVisibilityFilter = visibilityFilterSelect.value || 'all';
    syncResetFiltersBtnVisibility();
    persistStoriesFiltersState();
    renderList();
  });

  addBtn.addEventListener('click', () => {
    ensureStories(person);

    // منع مسودتين فارغتين
    const existingDraft = (person.stories || []).find(s =>
      draftNewMap.has(s.id) && isEmptyStoryDraft(s)
    );
    if (existingDraft) {
      lastEditedId = existingDraft.id;
      renderList();
      const card = list.querySelector(`.story-card[data-story-id="${existingDraft.id}"]`);
      const textarea = card?.querySelector('.story-textarea');
      if (textarea) textarea.focus();
      showWarning?.('لديك مسودة قصة فارغة بالفعل. أكملها أولاً قبل إضافة قصة جديدة.');
      return;
    }

    const story = addStory(
      person,
      {
        title: '',
        text: '',
        files: [],
        type: '',
        eventDate: null,
        place: '',
        tags: [],
        mood: '',
        visibility: 'family',
        narrator: '',
        pinned: false,
        toTimeline: false,
        note: ''
      },
      {
        onChange: (stories, changed) => {
          handlers.onDirty?.(stories, changed);
          emitStoriesToHost();
        }
      }
    );

    if (!story) {
      showError?.('تعذر إنشاء قصة جديدة. حاول مرة أخرى.');
      return;
    }

    draftNewMap.set(story.id, true);
    lastEditedId = story.id;

    renderList();
    const card = list.querySelector(`.story-card[data-story-id="${story.id}"]`);
    const textarea = card?.querySelector('.story-textarea');
    if (textarea) textarea.focus();

    showSuccess?.('تمت إضافة مسودة قصة جديدة. اكتب تفاصيلها ثم اضغط "حفظ" لتثبيتها.');
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value || 'latest';
    sortStories(person, mode);
    handlers.onDirty?.(person.stories);
    emitStoriesToHost();
    persistStoriesFiltersState();
    renderList();
    showInfo?.('تم تحديث ترتيب القصص.');
  });

  typeFilterSelect.addEventListener('change', () => {
    currentTypeFilter = typeFilterSelect.value || 'all';
      syncResetFiltersBtnVisibility();
    persistStoriesFiltersState();
    renderList();
  });

// أول رسم
renderList();

requestAnimationFrame(() => {
  // ✅ لا تسوي scroll للـ lastEditedId إذا كان فيه nav تم استخدامه داخل renderList
  if (!lastEditedId) return;

  const card = root.querySelector(`.story-card[data-story-id="${lastEditedId}"]`);
  if (card) {
    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  }
});


return root;

}
