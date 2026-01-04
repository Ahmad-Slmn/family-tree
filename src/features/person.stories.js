// person.stories.js
// إدارة "القصص والمذكّرات" لكل شخص (منطق + واجهة القسم داخل نافذة السيرة)

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

// ============================================================================
// 1) أدوات مساعدة عامة
// ============================================================================

function nowIso() {
  return new Date().toISOString();
}

function safeStr(v) {
  return String(v || '').trim();
}

function shallowArr(v) {
  return Array.isArray(v) ? v.slice() : [];
}

function splitCommaTags(s) {
  return String(s || '')
    .split(',')
    .map(t => String(t).trim())
    .filter(Boolean);
}

function isReadyUrl(ref) {
  return /^(data:|blob:|https?:)/.test(String(ref || ''));
}

function isTmpRef(ref) {
  return String(ref || '').startsWith('tmp:');
}

function isIdbRef(ref) {
  return String(ref || '').startsWith('idb:');
}

// تنظيف صور tmp: من الكاش (يُستخدم فقط حيث كان موجودًا بالفعل)
function cleanupTmpRefs(refs, revokeFn) {
  (refs || []).forEach(r => {
    if (isTmpRef(r)) revokeFn(String(r));
  });
}

// ============================================================================
// 2) كاش مؤقت لصور القصص قبل الحفظ (tmp:...)
// لازم يكون على مستوى الملف لأن resolveStoryImageUrl خارج createStoriesSection
// ============================================================================

const tempStoryImagesCache = new Map(); // tmpRef -> { file, url }

function genTmpRef() {
  if (window.crypto?.randomUUID) return 'tmp:' + window.crypto.randomUUID();
  return 'tmp:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function addTempStoryImage(file) {
  const tmpRef = genTmpRef();
  const url = URL.createObjectURL(file);
  tempStoryImagesCache.set(tmpRef, { file, url });
  return tmpRef;
}

function revokeTempStoryRef(tmpRef) {
  const rec = tempStoryImagesCache.get(tmpRef);
  if (rec?.url) {
    try { URL.revokeObjectURL(rec.url); } catch {}
  }
  tempStoryImagesCache.delete(tmpRef);
}

// ============================================================================
// 3) صور القصص عبر IndexedDB
// ref هو ما سيُخزَّن داخل story.images (مثل: 'idb:story_123')
// هذه الدالة تعطي URL صالح للعرض (blob: أو http أو data:)
// ============================================================================

async function resolveStoryImageUrl(ref) {
  if (!ref) return null;
  const s = String(ref);

  // روابط جاهزة
  if (isReadyUrl(s)) return s;

  // tmp:... (قبل الحفظ)
  if (isTmpRef(s)) {
    const rec = tempStoryImagesCache.get(s);
    return rec?.url || null;
  }

  // idb:...
  if (typeof DB?.getStoryImageURL === 'function') {
    try {
      const url = await DB.getStoryImageURL(s);
      return url || null;
    } catch (e) {
      console.error('resolveStoryImageUrl failed', e);
      return null;
    }
  }

  return s;
}

// ============================================================================
// 4) منطق البيانات (Normalize + CRUD) — بدون تغيير سلوك
// ============================================================================

function normalizeStory(raw) {
  const now = nowIso();
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    id: String(raw.id || 's_' + Math.random().toString(36).slice(2)),
    title: safeStr(raw.title),
    text: safeStr(raw.text),
    images: Array.isArray(raw.images) ? raw.images.map(String) : [],
    type: safeStr(raw.type),
    eventDate: raw.eventDate || null,
    place: safeStr(raw.place),
    tags: Array.isArray(raw.tags)  ? raw.tags.map(t => String(t).trim()).filter(Boolean)
      : [],
    relatedPersonIds: Array.isArray(raw.relatedPersonIds) ? raw.relatedPersonIds.map(String)
      : [],
    pinned: !!raw.pinned,
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

export function sortStories(person, mode = 'latest') {
  ensureStories(person);
  person.stories.sort((a, b) => {
    const da = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const db = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return mode === 'oldest' ? da - db : db - da;
  });
}

// ============================================================================
// 5) ثوابت واجهة القصص + أدوات العرض
// ============================================================================

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

function getTypeLabel(code) {
  return STORY_TYPE_LABELS[code] || '';
}

function getLengthInfo(len) {
  if (!len) return { label: 'بدون نص', level: 0 };
  if (len <= 280) return { label: 'قصة قصيرة', level: 1 };
  if (len <= 800) return { label: 'قصة متوسطة', level: 2 };
  return { label: 'قصة طويلة', level: 3 };
}

// تنسيق تاريخ الإضافة
function formatStoryDate(iso, prefix = 'أضيفت') {
  const body = formatFullDateTime(iso);
  if (!body) return '';
  return `${prefix} في ${body}`;
}

// ============================================================================
// 6) عارض الصور للقصص (Overlay مشترك)
// ============================================================================

const storyImageViewer = createImageViewerOverlay({
  overlayClass: 'story-image-viewer-overlay',
  backdropClass: 'story-image-viewer-backdrop',
  dialogClass: 'story-image-viewer-dialog',
  imgClass: 'story-image-viewer-img',
  closeBtnClass: 'story-image-viewer-close',
  navClass: 'story-image-viewer-nav',
  arrowPrevClass: 'story-image-viewer-arrow story-image-viewer-arrow-prev',
  arrowNextClass: 'story-image-viewer-arrow story-image-viewer-arrow-next',
  counterClass: 'story-image-viewer-counter'
});

async function openImageSlider(refs, startIndex = 0) {
  const list = Array.isArray(refs) ? refs : [];
  const urls = [];
  for (const r of list) {
    const u = await resolveStoryImageUrl(r);
    if (u) urls.push(u);
  }
  if (!urls.length) return;
  storyImageViewer.open(urls, startIndex);
}

// ضبط ارتفاع textarea تلقائيًا (نفس السلوك)
function autoResizeStoryTextareas(root) {
  const areas = root.querySelectorAll('.story-textarea, .story-note-input');
  areas.forEach(ta => {
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

// ============================================================================
// 7) createStoriesSection — بناء واجهة القصص بالكامل
// ============================================================================

export function createStoriesSection(person, handlers = {}) {
  ensureStories(person);

  const personId = person && person._id ? String(person._id) : null;

  // حالة الفلاتر/البحث/المحرر
  let currentTypeFilter = 'all';
  let currentTagFilter = '';
  let lastEditedId = null;
  let currentSearchQuery = '';

  // إرسال القصص للـ Host (نفس البيانات السابقة)
  function emitStoriesToHost() {
    if (!personId || typeof handlers.onUpdateStories !== 'function') return;

    const stories = Array.isArray(person.stories) ? person.stories.map(s => ({
          id: s.id,
          title: safeStr(s.title),
          text: safeStr(s.text),
          images: shallowArr(s.images),
          type: safeStr(s.type),
          eventDate: s.eventDate || null,
          place: safeStr(s.place),
          tags: shallowArr(s.tags),
          relatedPersonIds: Array.isArray(s.relatedPersonIds) ? s.relatedPersonIds.slice() : [],
          pinned: !!s.pinned,
          note: safeStr(s.note),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
      : [];

    handlers.onUpdateStories(personId, stories);
  }

  const sortMode = (handlers.getSortMode && handlers.getSortMode()) || 'latest';
  sortStories(person, sortMode);

  // ----------------------------
  // 7.1) الهيكل العام للقسم
  // ----------------------------

  const root = el('section', 'bio-section bio-section-stories');

  const titleEl = el('h3');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-book-open-reader';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'القصص والمذكّرات');
  const countBadge = el('span', 'stories-count-badge');
  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  const metaEl = el('div', 'stories-meta');
  metaEl.textContent =
    'حوِّل الذكريات إلى قصص حيّة تحفظ أثره للأبناء والأحفاد؛ دوّن المواقف المؤثّرة والطرائف والنجاحات والتحوّلات المهمّة، ثم أرفق الصور المناسبة ليبقى تاريخاً واضحًا وملهمًا لكل من يطالع هذه السيرة.';
  root.appendChild(metaEl);

  function updateStoriesCountBadge() {
    const n = (person.stories || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد قصص بعد)';
  }

  // ----------------------------
  // 7.2) أدوات القسم (فلتر/ترتيب/بحث/إضافة)
  // ----------------------------

  const header = el('div', 'stories-header');
  const tools = el('div', 'stories-tools');
  const toolsLeft = el('div', 'stories-tools-left');
  const toolsRight = el('div', 'stories-tools-right');

  const typeFilterSelect = el('select', 'stories-type-filter');
  typeFilterSelect.name = 'stories_type_filter';

  function fillTypeFilterSelect(options) {
    typeFilterSelect.innerHTML = '';
    options.forEach(([value, label]) => {
      const opt = el('option');
      opt.value = value;
      opt.textContent = label;
      typeFilterSelect.appendChild(opt);
    });
  }
  fillTypeFilterSelect(STORY_TYPE_OPTIONS);
  typeFilterSelect.value = 'all';

  const sortSelect = el('select', 'stories-sort');
  sortSelect.name = 'stories_sort';
  {
    const optLatest = el('option');
    optLatest.value = 'latest';
    optLatest.textContent = 'الأحدث أولاً';
    const optOldest = el('option');
    optOldest.value = 'oldest';
    optOldest.textContent = 'الأقدم أولاً';
    sortSelect.append(optLatest, optOldest);
  }
  sortSelect.value = sortMode;

  const addBtn = el('button', 'stories-add-btn');
  addBtn.type = 'button';

  // بحث العناوين
  const searchWrap = el('div', 'stories-search-wrap');
  const searchInput = el('input', 'stories-search-input');
  searchInput.type = 'search';
  searchInput.name = 'stories-search-input';
  searchInput.placeholder = 'ابحث في عناوين القصص…';
  searchInput.value = '';
  searchInput.addEventListener('input', () => {
    currentSearchQuery = searchInput.value.trim().toLowerCase();
    renderList();
  });
  searchWrap.append(searchInput);

  toolsLeft.append(typeFilterSelect, sortSelect, searchWrap);
  toolsRight.append(addBtn);
  tools.append(toolsLeft, toolsRight);
  header.appendChild(tools);
  root.appendChild(header);

  const list = el('div', 'stories-list');
  root.appendChild(list);

  function updateAddButtonLabel() {
    ensureStories(person);
    const count = person.stories.length || 0;

    if (count === 0) {
      addBtn.innerHTML =
        '<i class="fa-solid fa-plus" aria-hidden="true"></i> ' +
        '<span>إضافة أول قصة</span>';
      addBtn.title = 'ابدأ بتوثيق أول موقف أو ذكرى لهذا الشخص';
    } else if (count === 1) {
      addBtn.innerHTML =
        '<i class="fa-solid fa-plus" aria-hidden="true"></i> ' +
        '<span>إضافة قصة جديدة</span>';
      addBtn.title = 'هناك قصة واحدة محفوظة حتى الآن';
    } else {
      addBtn.innerHTML =
        '<i class="fa-solid fa-plus" aria-hidden="true"></i> ' +
        '<span>إضافة قصة جديدة</span>';
      addBtn.title = `هناك ${count} قصص محفوظة حتى الآن`;
    }
  }

  // إعادة بناء خيارات فلتر النوع بحسب الأنواع المستخدمة فعليًا
  function rebuildStoryTypeFilterOptions() {
    ensureStories(person);
    const stories = person.stories || [];

    const usedTypesSet = new Set();
    for (const s of stories) {
      const t = safeStr(s.type);
      if (t) usedTypesSet.add(t);
    }

    const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';

    typeFilterSelect.innerHTML = '';
    const optAll = el('option');
    optAll.value = 'all';
    optAll.textContent = 'كل الأنواع';
    typeFilterSelect.appendChild(optAll);

    const order = Object.fromEntries(
      STORY_TYPE_OPTIONS
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
      opt.textContent = getTypeLabel(code) || code;
      typeFilterSelect.appendChild(opt);
    });

    const canKeepPrev = prevValue && prevValue !== 'all' && usedTypes.includes(prevValue);
    const nextValue = canKeepPrev ? prevValue : 'all';
    typeFilterSelect.value = nextValue;
    currentTypeFilter = nextValue;
  }

  // ----------------------------
  // 7.3) رسم القائمة بالكامل (Cards)
  // ----------------------------

  function renderList() {
    list.innerHTML = '';
    ensureStories(person);

    updateStoriesCountBadge();
    updateAddButtonLabel();
    rebuildStoryTypeFilterOptions();

    const filteredStories = person.stories.filter(story => {
      const typeOk =
        currentTypeFilter === 'all' ||
        !currentTypeFilter ||
        (story.type || '') === currentTypeFilter;

      const tagOk =
        !currentTagFilter ||
        (Array.isArray(story.tags) && story.tags.includes(currentTagFilter));

      const searchOk =
        !currentSearchQuery ||
        String(story.title || '').toLowerCase().includes(currentSearchQuery);

      return typeOk && tagOk && searchOk;
    });

    if (!filteredStories.length) {
      const empty = el('div', 'stories-empty');
      empty.textContent = person.stories.length ? 'لا توجد قصص مطابقة لخيارات التصفية أو البحث الحالي.'
        : 'ابدأ بإضافة أول قصة (مثلاً: موقف جميل، أو وصف مختصر لصفات هذا الشخص).';
      list.appendChild(empty);
      return;
    }

    filteredStories.forEach((story, index) => {
      const serial = index + 1;

      const card = el('article', 'story-card');
      card.dataset.storyId = story.id;

      // ===== شريط علوي: رقم + مميّزة =====
      const indexBadge = el('div', 'story-card-index');
      indexBadge.textContent = `القصة ${serial}`;

      let pinnedBadge = null;
      if (story.pinned) {
        pinnedBadge = el('div', 'story-pinned-badge');
        pinnedBadge.textContent = 'قصة مميّزة';
      }
      if (story.pinned) card.classList.add('story-card--pinned');

      const topRow = el('div', 'story-card-top');
      topRow.appendChild(indexBadge);
      if (pinnedBadge) topRow.appendChild(pinnedBadge);
      card.appendChild(topRow);

      // Snapshot "الأصل" للمقارنة (كما كان)
      const original = {
        title: story.title || '',
        text: safeStr(story.text),
        images: shallowArr(story.images),
        type: safeStr(story.type),
        eventDate: story.eventDate || null,
        place: safeStr(story.place),
        tags: shallowArr(story.tags),
        pinned: !!story.pinned,
        note: safeStr(story.note)
      };

      const eventDateLabel = formatShortDateBadge(original.eventDate);

      let currentImages = shallowArr(original.images);
      let isEditing =
        lastEditedId === story.id ||
        (!story.title && !story.text && lastEditedId === story.id);
      let isDirty = false;
      let pendingDeletedImages = [];

      // ======================================================================
      // (A) وضع المعاينة Preview
      // ======================================================================

      const previewBox = el('div', 'story-preview');
      const previewMeta = el('div', 'story-preview-meta');

      const dateLabel = el('span', 'story-preview-date');
      dateLabel.textContent = story.createdAt ? formatStoryDate(story.createdAt) : '';

      const lengthLabel = el('span', 'story-preview-length story-length-chip');
      const lenInfo = getLengthInfo(original.text.length);
      if (lenInfo.level === 0) {
        lengthLabel.textContent = 'لم تتم كتابة مضمون القصة بعد';
      } else {
        const meter = el('span', 'story-length-meter');
        meter.dataset.level = String(lenInfo.level);
        const bar = el('span', 'story-length-meter-bar');
        meter.appendChild(bar);
        const txtSpan = el('span');
        txtSpan.textContent = lenInfo.label;
        lengthLabel.innerHTML = '';
        lengthLabel.append(meter, txtSpan);
      }

      previewMeta.append(dateLabel, lengthLabel);

      const badgesWrap = el('div', 'story-preview-badges');

      if (original.place) {
        const placeBadge = el('span', 'story-badge story-badge--place');
        placeBadge.textContent = original.place;
        badgesWrap.appendChild(placeBadge);
      }

      if (eventDateLabel) {
        const yearBadge = el('span', 'story-badge story-badge--year');
        yearBadge.textContent = eventDateLabel;
        badgesWrap.appendChild(yearBadge);
      } else {
        const undatedBadge = el('span', 'story-badge story-badge--undated');
        undatedBadge.textContent = 'بدون تاريخ محدّد';
        badgesWrap.appendChild(undatedBadge);
      }

      let typeBadge = null;
      const typeLabel = getTypeLabel(original.type);
      if (typeLabel) {
        typeBadge = el('span', 'story-badge story-badge--type');
        typeBadge.dataset.storyId = story.id;
        typeBadge.dataset.type = original.type || 'general';
        typeBadge.textContent = typeLabel;
        badgesWrap.appendChild(typeBadge);
      }

      const previewTitle = el('div', 'story-preview-title');
      previewTitle.textContent = original.title || 'قصة بدون عنوان';

      const previewText = el('p', 'story-preview-text');
      previewText.textContent =
        original.text ||
        'لم تتم إضافة نص لهذه القصة حتى الآن. يمكنك فتح وضع التحرير لكتابته.';

      const tagsWrap = el('div', 'story-tags-list');
      if (original.tags && original.tags.length) {
        original.tags.forEach(tag => {
          const chip = el(
            'button',
            'story-tag-chip' + (tag === currentTagFilter ? ' is-active' : '')
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

      const notePreview =
        original.note && original.note.length ? (() => {
              const div = el('div', 'story-note-preview');
              const strong = el('strong');
              strong.textContent = 'الخلاصة: ';
              const span = el('span');
              span.textContent = original.note;
              div.append(strong, span);
              return div;
            })()
          : null;

      const previewImagesWrap = el('div', 'story-preview-images');

      const sliderBtn = el('button', 'story-images-slider-btn');
      sliderBtn.type = 'button';
      sliderBtn.innerHTML =
        '<i class="fa-solid fa-images" aria-hidden="true"></i> ' +
        '<span>عرض الصور كشرائح</span>';

      sliderBtn.addEventListener('click', () => {
        if (!original.images || original.images.length < 2) return;
        openImageSlider(original.images, 0);
      });

      function renderPreviewImages() {
        previewImagesWrap.innerHTML = '';
        sliderBtn.style.display =
          !original.images.length || original.images.length < 2 ? 'none' : '';

        original.images.forEach((ref, imgIndex) => {
          const thumb = el('div', 'story-image-thumb story-image-thumb--preview');
          const imgEl = el('img');
          imgEl.alt = 'صورة مرفقة بالقصة';

          resolveStoryImageUrl(ref).then(url => {
            if (url) imgEl.src = url;
          });

          const viewBtn = el('button', 'story-image-thumb-view');
          viewBtn.type = 'button';
          viewBtn.title = 'معاينة الصورة بحجم أكبر';
          viewBtn.textContent = 'معاينة';

          viewBtn.addEventListener('click', e => {
            e.stopPropagation();
            openImageSlider(original.images, imgIndex);
          });

          imgEl.addEventListener('click', () =>
            openImageSlider(original.images, imgIndex)
          );

          thumb.append(imgEl, viewBtn);
          previewImagesWrap.appendChild(thumb);
        });
      }

      renderPreviewImages();

      previewBox.append(
        previewTitle,
        previewMeta,
        badgesWrap,
        previewText,
        tagsWrap
      );
      if (notePreview) previewBox.appendChild(notePreview);
      previewBox.append(previewImagesWrap, sliderBtn);
      card.appendChild(previewBox);

      // ======================================================================
      // (B) وضع التحرير Edit
      // ======================================================================

      const editBox = el('div', 'story-edit');
      const head = el('div', 'story-head');

      const titleInput = el('input', 'story-title-input');
      titleInput.type = 'text';
      titleInput.name = `story_title_${story.id}`;
      titleInput.placeholder = 'عنوان القصة (اختياري)';
      titleInput.value = original.title;

      const dates = el('div', 'story-dates');
      dates.textContent = story.createdAt ? formatStoryDate(story.createdAt) : '';

      head.append(titleInput, dates);
      editBox.appendChild(head);

      const body = el('div', 'story-body');
      const metaRow = el('div', 'story-meta-row');

      // نوع القصة
      const typeSelect = el('select', 'story-type-select');
      typeSelect.name = `story_type_${story.id}`;

      STORY_TYPE_OPTIONS
        .filter(([val]) => val && val !== 'all')
        .forEach(([val, label]) => {
          const opt = el('option');
          opt.value = val;
          opt.textContent = label;
          typeSelect.appendChild(opt);
        });

      typeSelect.value = original.type || 'general';

      const typeField = el('div', 'story-meta-field');
      const typeLabelBox = el('div', 'story-meta-label');
      typeLabelBox.innerHTML =
        '<span class="story-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع القصة';
      typeField.append(typeLabelBox, typeSelect);

      // تاريخ الحدث
      const eventInput = el('input');
      eventInput.type = 'date';
      eventInput.name = `story_event_${story.id}`;
      eventInput.value = original.eventDate || '';

      const eventField = el('div', 'story-meta-field');
      const eventLabel = el('div', 'story-meta-label');
      eventLabel.innerHTML =
        '<span class="story-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الحدث';
      eventField.append(eventLabel, eventInput);

      // المكان
      const placeInput = el('input');
      placeInput.type = 'text';
      placeInput.name = `story_place_${story.id}`;
      placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
      placeInput.value = original.place;

      const placeField = el('div', 'story-meta-field');
      const placeLabel = el('div', 'story-meta-label');
      placeLabel.innerHTML =
        '<span class="story-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> المكان';
      placeField.append(placeLabel, placeInput);

      metaRow.append(typeField, eventField, placeField);

      const textArea = el('textarea', 'story-textarea');
      textArea.rows = 5;
      textArea.name = `story_text_${story.id}`;
      textArea.placeholder = 'اكتب هنا الموقف أو القصة بالتفصيل...';
      textArea.value = original.text;

      const noteInput = el('textarea', 'story-note-input');
      noteInput.name = `story_note_${story.id}`;
      noteInput.placeholder = 'ما الدرس أو الفائدة من هذه القصة؟ (اختياري)';
      noteInput.value = original.note;

      const tagsInput = el('input');
      tagsInput.type = 'text';
      tagsInput.name = `story_tags_${story.id}`;
      tagsInput.placeholder = 'وسوم القصة (افصل بينها بفواصل مثل: عام, الطفولة, الدراسة, طرائف)';
      tagsInput.value = original.tags.join(', ');

      // ===== كتلة الصور =====
      const imagesBlock = el('div', 'story-images-block');
      const emptyImagesHint = el('div', 'story-images-empty-hint');
      const imagesRow = el('div', 'story-images-row');
      const imagesThumbs = el('div', 'story-images-thumbs');

      const addImageLabel = el('label', 'story-image-add-btn');
      const addImageIcon = el('span', 'story-image-add-icon');
      addImageIcon.innerHTML = '<i class="fa-solid fa-camera" aria-hidden="true"></i>';
      const addImageText = el('span', 'story-image-add-text');

      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      addImageLabel.append(addImageIcon, addImageText, fileInput);

      imagesRow.appendChild(imagesThumbs);
      imagesBlock.append(emptyImagesHint, imagesRow, addImageLabel);

      const pinWrap = el('label', 'story-pin-toggle');
      const pinCheckbox = el('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.name = `story_pinned_${story.id}`;
      pinCheckbox.checked = original.pinned;
      const pinText = textEl('span', 'تعيين هذه القصة كمميّزة');
      pinWrap.append(pinCheckbox, pinText);

      function updateAddImageLabel() {
        const count = currentImages.length || 0;
        if (count === 0) {
          addImageText.textContent = 'إضافة صور للقصة';
          addImageLabel.title = 'أرفق أول صورة لتوثيق هذه القصة';
        } else if (count === 1) {
          addImageText.textContent = 'إضافة صورة أخرى';
          addImageLabel.title = 'أضف صورة ثانية لتغطية جوانب أخرى من القصة';
        } else {
          addImageText.textContent = 'إضافة مزيد من الصور';
          addImageLabel.title = `هناك ${count} صور مرفقة حاليًا`;
        }
      }

      function setupImagesSortable() {
        attachHorizontalSortable({
          container: imagesThumbs,
          itemSelector: '.story-image-thumb',
          ghostClass: 'story-image-thumb--ghost',
          dragClass: 'story-image-thumb--drag',
          onSorted(orderedRefs) {
            currentImages = orderedRefs.slice();
            renderThumbs();
            recomputeDirty();
          }
        });
      }

      function renderThumbs() {
        imagesThumbs.innerHTML = '';

        if (!currentImages.length) {
          emptyImagesHint.textContent = 'لم تُرفق صور بعد لهذه القصة.';
          emptyImagesHint.style.display = '';
          updateAddImageLabel();
          return;
        }

        emptyImagesHint.style.display = 'none';

        currentImages.forEach((ref, idxImg) => {
          const thumb = el('div', 'story-image-thumb');
          thumb.dataset.ref = ref;

          const imgEl = el('img');
          imgEl.alt = 'صورة مرفقة بالقصة';

          resolveStoryImageUrl(ref).then(url => {
            if (url) imgEl.src = url;
          });

          const removeBtn = el('button', 'story-image-thumb-remove');
          removeBtn.type = 'button';
          removeBtn.title = 'إزالة هذه الصورة';
          removeBtn.textContent = '×';

          removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            const ref = currentImages[idxImg];

            // إذا كانت tmp احذفها فورًا من الكاش
            if (ref && isTmpRef(ref)) revokeTempStoryRef(ref);

            // إذا كانت idb سجّلها للحذف لاحقًا بعد الحفظ
            if (ref && isIdbRef(ref)) pendingDeletedImages.push(ref);

            currentImages.splice(idxImg, 1);
            renderThumbs();
            recomputeDirty();
          });

          const viewBtn = el('button', 'story-image-thumb-view');
          viewBtn.type = 'button';
          viewBtn.title = 'معاينة الصورة بحجم أكبر';
          viewBtn.textContent = 'معاينة';

          viewBtn.addEventListener('click', e => {
            e.stopPropagation();
            openImageSlider(currentImages, idxImg);
          });

          imgEl.addEventListener('click', () =>
            openImageSlider(currentImages, idxImg)
          );

          thumb.append(imgEl, removeBtn, viewBtn);
          imagesThumbs.appendChild(thumb);
        });

        updateAddImageLabel();
        setupImagesSortable();
      }

      renderThumbs();

      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;

        for (const file of files) {
          try {
            const tmpRef = addTempStoryImage(file);
            currentImages.push(tmpRef);
          } catch (e) {
            console.error('failed to add temp story image', e);
            showError?.('تعذّر تجهيز إحدى الصور للمعاينة. حاول مرة أخرى.');
          }
        }

        renderThumbs();
        recomputeDirty();
        fileInput.value = '';
      });

      body.append(metaRow, textArea, noteInput, tagsInput, imagesBlock, pinWrap);
      editBox.appendChild(body);
      card.appendChild(editBox);

      // ======================================================================
      // (C) الأزرار Footer (تعديل/حفظ/إلغاء/حذف)
      // ======================================================================

      const footer = el('div', 'story-footer');

      const saveBtn = el('button', 'story-save-btn');
      saveBtn.type = 'button';

      const cancelBtn = el('button', 'story-cancel-btn');
      cancelBtn.type = 'button';
      cancelBtn.innerHTML =
        '<i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> ' +
        '<span>إلغاء التعديل</span>';

      const delBtn = el('button', 'story-delete-btn');
      delBtn.type = 'button';
      delBtn.innerHTML =
        '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> ' +
        '<span>حذف القصة</span>';

      footer.append(saveBtn, cancelBtn, delBtn);
      card.appendChild(footer);

      // تغيير نص زر الحفظ حسب الحالة (نفس السلوك)
      function setSaveBtnLabel(state) {
        if (!state || state === 'edit') {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> ' +
            '<span>تعديل</span>';
        } else if (state === 'close') {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> ' +
            '<span>إغلاق</span>';
        } else if (state === 'save') {
          saveBtn.innerHTML =
            '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ' +
            '<span>حفظ</span>';
        }
      }

      function applyMode() {
        card.classList.toggle('story-card--edit', isEditing);
        card.classList.toggle('story-card--preview', !isEditing);
        if (dates) dates.style.display = isEditing ? 'none' : '';

        if (!isEditing) setSaveBtnLabel('edit');
        else if (!isDirty) setSaveBtnLabel('close');
        else setSaveBtnLabel('save');

        cancelBtn.style.display = isEditing && isDirty ? '' : 'none';
      }

      function recomputeDirty() {
        const curTitle = titleInput.value.trim();
        const curText = textArea.value.trim();
        const curType = typeSelect.value.trim();
        const curEvent = eventInput.value || null;
        const curPlace = placeInput.value.trim();
        const curTags = splitCommaTags(tagsInput.value);
        const curNote = noteInput.value.trim();
        const curPinned = !!pinCheckbox.checked;

        isDirty =
          curTitle !== original.title ||
          curText !== original.text ||
          curType !== original.type ||
          curEvent !== (original.eventDate || null) ||
          curPlace !== original.place ||
          curPinned !== original.pinned ||
          curNote !== original.note ||
          curTags.join('|') !== (original.tags || []).join('|') ||
          !arraysShallowEqual(currentImages, original.images);

        applyMode();
      }

      applyMode();

      // مراقبة التغييرات
      titleInput.addEventListener('input', recomputeDirty);
      textArea.addEventListener('input', recomputeDirty);
      typeSelect.addEventListener('change', recomputeDirty);
      eventInput.addEventListener('change', recomputeDirty);
      placeInput.addEventListener('input', recomputeDirty);
      tagsInput.addEventListener('input', recomputeDirty);
      noteInput.addEventListener('input', recomputeDirty);
      pinCheckbox.addEventListener('change', recomputeDirty);

      // ----------------------------
      // حفظ/إغلاق/فتح تحرير
      // ----------------------------
      saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = story.id;
          applyMode();
          showInfo?.('يمكنك الآن تعديل القصة ثم الضغط على "حفظ" لتثبيت التعديلات.');
          return;
        }

        if (isEditing && !isDirty) {
          // (نفس السلوك السابق) إغلاق بدون حفظ — لا تنظيف إضافي هنا
          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر القصة.');
          return;
        }

        const newTitle = titleInput.value.trim();
        const newText = textArea.value.trim();
        const newType = typeSelect.value.trim();
        const newEventDate = eventInput.value || null;
        const newPlace = placeInput.value.trim();
        const newTags = splitCommaTags(tagsInput.value);
        const newNote = noteInput.value.trim();
        const newPinned = !!pinCheckbox.checked;

        // حفظ الصور: ترقية tmp إلى idb قبل تثبيت البيانات
        const hasTmp = currentImages.some(r => isTmpRef(r));
        if (hasTmp && typeof DB?.putStoryImage !== 'function') {
          showError?.('ميزة حفظ الصور غير متاحة حالياً (DB.putStoryImage غير موجود).');
          return;
        }

        const upgradedImages = [];
        for (const r of currentImages) {
          const ref = String(r || '');

          if (!isTmpRef(ref)) {
            upgradedImages.push(ref);
            continue;
          }

          const rec = tempStoryImagesCache.get(ref);
          if (!rec?.file) {
            showError?.('تعذّر الوصول لملف إحدى الصور المؤقتة. لم يتم حفظ التعديلات.');
            return;
          }

          try {
            const idbRef = await DB.putStoryImage({
              file: rec.file,
              personId,
              storyId: story.id
            });

            if (idbRef) upgradedImages.push(String(idbRef));
          } catch (e) {
            console.error('Failed to store temp story image', ref, e);
            showError?.('تعذّر حفظ إحدى الصور. لم يتم حفظ التعديلات.');
            return;
          } finally {
            revokeTempStoryRef(ref);
          }
        }

        currentImages = upgradedImages;

        const updated = updateStory(
          person,
          story.id,
          {
            title: newTitle,
            text: newText,
            images: currentImages,
            type: newType,
            eventDate: newEventDate,
            place: newPlace,
            tags: newTags,
            note: newNote,
            pinned: newPinned
          },
          {
            onChange: (stories, changed) => {
              if (typeof handlers.onDirty === 'function') {
                handlers.onDirty(stories, changed);
              }
              emitStoriesToHost();
            }
          }
        );

        const effective = updated || story;

        // تحديث snapshot الأصل بعد الحفظ (كما كان)
        original.title = effective.title || '';
        original.text = safeStr(effective.text);
        original.images = shallowArr(effective.images);
        original.type = safeStr(effective.type);
        original.eventDate = effective.eventDate || null;
        original.place = safeStr(effective.place);
        original.tags = shallowArr(effective.tags);
        original.note = safeStr(effective.note);
        original.pinned = !!effective.pinned;

        currentImages = shallowArr(original.images);

        // حذف صور IndexedDB المؤجلة بعد تثبيت التعديلات (كما كان)
        for (const ref of pendingDeletedImages) {
          try {
            if (typeof DB?.deleteStoryImage === 'function') {
              await DB.deleteStoryImage(ref);
            } else if (typeof DB?.deleteEventImage === 'function') {
              await DB.deleteEventImage(ref);
            }
          } catch (e) {
            console.error('Failed to delete story image from DB', ref, e);
          }
        }
        pendingDeletedImages = [];

        // تحديث المعاينة
        previewTitle.textContent = original.title || 'قصة بدون عنوان';

        const trimmedText = original.text;
        const info2 = getLengthInfo(trimmedText.length);
        if (info2.level === 0) {
          lengthLabel.textContent = 'لم تتم كتابة مضمون القصة بعد';
        } else {
          const meter2 = el('span', 'story-length-meter');
          meter2.dataset.level = String(info2.level);
          const bar2 = el('span', 'story-length-meter-bar');
          meter2.appendChild(bar2);
          const txtSpan2 = el('span');
          txtSpan2.textContent = info2.label;
          lengthLabel.innerHTML = '';
          lengthLabel.append(meter2, txtSpan2);
        }

        previewText.textContent =
          trimmedText ||
          'لم تتم إضافة نص لهذه القصة حتى الآن. يمكنك فتح وضع التحرير لكتابته.';

        if (effective.createdAt) {
          const labelText = formatStoryDate(effective.createdAt);
          dates.textContent = labelText;
          dateLabel.textContent = labelText;
        }

        // تحديث بادج النوع
        const effectiveType = safeStr(effective.type) || 'general';
        const newTypeLabel = getTypeLabel(effectiveType) || '';

        if (typeBadge) {
          typeBadge.textContent = newTypeLabel;
          typeBadge.dataset.type = effectiveType;
        }

        document
          .querySelectorAll(`.story-badge--type[data-story-id="${story.id}"]`)
          .forEach(node => {
            node.textContent = newTypeLabel;
            node.dataset.type = effectiveType;
          });

        isEditing = false;
        lastEditedId = null;
        isDirty = false;

        renderList();
        showSuccess?.('تم حفظ تعديلات القصة بنجاح');
      });

      // ----------------------------
      // إلغاء التعديل (الرجوع للأصل)
      // ----------------------------
      cancelBtn.addEventListener('click', () => {
        if (!isEditing) return;

        pendingDeletedImages = [];

        titleInput.value = original.title;
        textArea.value = original.text;

        cleanupTmpRefs(currentImages, revokeTempStoryRef);

        currentImages = shallowArr(original.images);
        renderThumbs();
        renderPreviewImages();

        if (story.createdAt) {
          const labelText = formatStoryDate(story.createdAt);
          dates.textContent = labelText;
          dateLabel.textContent = labelText;
        }

        typeSelect.value = original.type || '';
        eventInput.value = original.eventDate || '';
        placeInput.value = original.place;
        tagsInput.value = (original.tags || []).join(', ');
        noteInput.value = original.note;
        pinCheckbox.checked = original.pinned;

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        applyMode();

        showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من القصة.');
      });

      // ----------------------------
      // حذف القصة
      // ----------------------------
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

  cleanupTmpRefs(currentImages, revokeTempStoryRef);

  // احذف كل صور القصة من IndexedDB (إن كانت idb) قبل حذف القصة
  const refs = Array.isArray(original.images) ? original.images : [];

  for (const ref of refs) {
    if (!isIdbRef(ref)) continue;
    try {
      await DB?.deleteStoryImage?.(ref);
    } catch (e) {
      console.error('deleteStoryImage failed', ref, e);
    }
  }

  // أيضًا: صور مؤجلة للحذف
  for (const ref of pendingDeletedImages) {
    if (!isIdbRef(ref)) continue;
    try {
      await DB?.deleteStoryImage?.(ref);
    } catch (e) {
      console.error('deleteStoryImage (pending) failed', ref, e);
    }
  }
  pendingDeletedImages = [];

  const success = deleteStory(person, story.id, {
    onChange: (stories, removed) => {
      if (typeof handlers.onDirty === 'function') {
        handlers.onDirty(stories, removed);
      }
      emitStoriesToHost();
    }
  });

  if (!success) {
    showError?.('تعذر حذف القصة. حاول مرة أخرى.');
    return;
  }

  if (lastEditedId === story.id) lastEditedId = null;
  renderList();
  showSuccess?.('تم حذف القصة بنجاح.');
});

      list.appendChild(card);
    });

    autoResizeStoryTextareas(list);
  }

  // ========================================================================
  // 7.4) أحداث الأدوات (إضافة/ترتيب/فلتر)
  // ========================================================================

  addBtn.addEventListener('click', () => {
    ensureStories(person);

    const draft = person.stories.find(s => {
      const t = safeStr(s.title);
      const txt = safeStr(s.text);
      const imgs = Array.isArray(s.images) ? s.images : [];
      return !t && !txt && imgs.length === 0;
    });

    if (draft) {
      lastEditedId = draft.id;
      renderList();
      const card = list.querySelector(`.story-card[data-story-id="${draft.id}"]`);
      const textarea = card?.querySelector('.story-textarea');
      if (textarea) textarea.focus();
      showWarning?.('لديك مسودة قصة مفتوحة بالفعل. أكمل كتابتها أولاً قبل إضافة قصة جديدة.');
      return;
    }

    const story = addStory(
      person,
      { title: '', text: '', images: [] },
      {
        onChange: (stories, changed) => {
          if (typeof handlers.onDirty === 'function') {
            handlers.onDirty(stories, changed);
          }
          emitStoriesToHost();
        }
      }
    );

    if (!story) {
      showError?.('تعذر إنشاء قصة جديدة. حاول مرة أخرى.');
      return;
    }

    lastEditedId = story.id;
    renderList();
    showSuccess?.('تمت إضافة قصة جديدة. اكتب تفاصيلها ثم اضغط "حفظ" لتثبيتها.');
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'oldest' ? 'oldest' : 'latest';
    sortStories(person, mode);
    if (typeof handlers.onDirty === 'function') {
      handlers.onDirty(person.stories);
    }
    emitStoriesToHost();
    renderList();
    showInfo?.(
      mode === 'latest'  ? 'تم ترتيب القصص من الأحدث إلى الأقدم.'
        : 'تم ترتيب القصص من الأقدم إلى الأحدث.'
    );
  });

  typeFilterSelect.addEventListener('change', () => {
    const val = typeFilterSelect.value;
    currentTypeFilter = val || 'all';
    renderList();
  });

  // أول رسم
  renderList();
  emitStoriesToHost();

  return root;
}