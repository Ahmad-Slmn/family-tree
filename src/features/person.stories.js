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

// ====================== صور القصص عبر IndexedDB ======================

// ref هو ما سيُخزَّن داخل story.images (مثل: 'idb:story_123')
// هذه الدالة تعطي URL صالح للعرض (blob: أو http أو data:)
async function resolveStoryImageUrl(ref) {
  if (!ref) return null;
  const s = String(ref);

  // بيانات جاهزة أصلاً (قديمة أو مستوردة)
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  // صيغة idb:... نمررها لـ DB
  if (typeof DB?.getStoryImageURL === 'function') {
    try {
      const url = await DB.getStoryImageURL(s);
      return url || null;
    } catch (e) {
      console.error('resolveStoryImageUrl failed', e);
      return null;
    }
  }

  // في حال لم تُنفَّذ في DB بعد
  return s;
}

// تخزين ملف صورة في IndexedDB وإرجاع المرجع الذي سيُحفَظ في story.images
async function storeStoryImageFile(file, personId, storyId) {
  if (!file) return null;

  // مطلوب منك في db.js: دالة DB.putStoryImage تتولى الضغط + الحفظ
  if (typeof DB?.putStoryImage === 'function') {
    try {
      const ref = await DB.putStoryImage({ file, personId, storyId });
      // يُفضَّل أن ترجع الدالة مرجعًا من نوع 'idb:story_...'
      return ref || null;
    } catch (e) {
      console.error('storeStoryImageFile failed', e);
      return null;
    }
  }

  //Fallback اختياري (مؤقت): لو DB.putStoryImage غير جاهزة، نستعمل DataURL كما كان
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = err => reject(err);
    reader.onload = ev => resolve(String(ev.target?.result || ''));
    reader.readAsDataURL(file);
  });
}

// ====================== منطق البيانات ======================
function normalizeStory(raw) {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    id: String(raw.id || 's_' + Math.random().toString(36).slice(2)),
    title: String(raw.title || '').trim(),
    text: String(raw.text || '').trim(),
    images: Array.isArray(raw.images) ? raw.images.map(String) : [],
    type: (raw.type || '').trim(),
    eventDate: raw.eventDate || null,
    place: (raw.place || '').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean)
      : [],
    relatedPersonIds: Array.isArray(raw.relatedPersonIds) ? raw.relatedPersonIds.map(String)
      : [],
    pinned: !!raw.pinned,
    note: (raw.note || '').trim(),
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
  story.createdAt = new Date().toISOString();
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
  merged.updatedAt = new Date().toISOString();

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

// ====================== واجهة القسم داخل نافذة السيرة ======================

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
 
// عارض الصور المشترك لكل القصص (باستخدام الدالة العامة من utils)
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

function autoResizeStoryTextareas(root){
  const areas = root.querySelectorAll('.story-textarea, .story-note-input');
  areas.forEach(ta => {
    const resize = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    resize();
    ta.removeEventListener('input', ta._autoResizeHandler || (()=>{}));
    ta._autoResizeHandler = resize;
    ta.addEventListener('input', resize);
  });
}


// ====================== بناء القسم ======================

export function createStoriesSection(person, handlers = {}) {
  ensureStories(person);

  const personId = person && person._id ? String(person._id) : null;
  let currentTypeFilter = 'all';
  let currentTagFilter = '';
  let lastEditedId = null;

  function emitStoriesToHost() {
    if (!personId || typeof handlers.onUpdateStories !== 'function') return;
    const stories = Array.isArray(person.stories) ? person.stories.map(s => ({
          id: s.id,
          title: String(s.title || '').trim(),
          text: String(s.text || '').trim(),
          images: Array.isArray(s.images) ? s.images.slice() : [],
          type: (s.type || '').trim(),
          eventDate: s.eventDate || null,
          place: (s.place || '').trim(),
          tags: Array.isArray(s.tags) ? s.tags.slice() : [],
          relatedPersonIds: Array.isArray(s.relatedPersonIds)  ? s.relatedPersonIds.slice()
            : [],
          pinned: !!s.pinned,
          note: (s.note || '').trim(),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
      : [];
    handlers.onUpdateStories(personId, stories);
  }

  const sortMode =
    (handlers.getSortMode && handlers.getSortMode()) || 'latest';
  sortStories(person, sortMode);

  const root = el('section', 'bio-section bio-section-stories');

  const titleEl = el('h3');
  const iconEl = el('i');
  iconEl.className = 'fa-solid fa-book-open-reader';
  iconEl.setAttribute('aria-hidden', 'true');

  const titleText = textEl('span', 'القصص والمذكّرات');
  const countBadge = el('span', 'stories-count-badge');

  titleEl.append(iconEl, ' ', titleText, ' ', countBadge);
  root.appendChild(titleEl);

  // الوصف مباشرة بعد العنوان
  const metaEl = el('div', 'stories-meta');
metaEl.textContent =
  'حوِّل الذكريات إلى قصص حيّة تحفظ أثره للأبناء والأحفاد؛ دوّن المواقف المؤثّرة والطرائف والنجاحات والتحوّلات المهمّة، ثم أرفق الصور المناسبة ليبقى تاريخاً واضحًا وملهمًا لكل من يطالع هذه السيرة.';

  root.appendChild(metaEl);

  function updateStoriesCountBadge() {
    const n = (person.stories || []).length;
    countBadge.textContent = n ? `(${n})` : '(لا توجد قصص بعد)';
  }

  const header = el('div', 'stories-header');
  const tools = el('div', 'stories-tools');
  const toolsLeft = el('div', 'stories-tools-left');
  const toolsRight = el('div', 'stories-tools-right');

  const typeFilterSelect = el('select', 'stories-type-filter');
  typeFilterSelect.name = 'stories_type_filter';
  STORY_TYPE_OPTIONS.forEach(([value, label]) => {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    typeFilterSelect.appendChild(opt);
  });
  typeFilterSelect.value = 'all';

  const sortSelect = el('select', 'stories-sort');
  sortSelect.name = 'stories_sort';
  const optLatest = el('option');
  optLatest.value = 'latest';
  optLatest.textContent = 'الأحدث أولاً';
  const optOldest = el('option');
  optOldest.value = 'oldest';
  optOldest.textContent = 'الأقدم أولاً';
  sortSelect.append(optLatest, optOldest);
  sortSelect.value = sortMode;

  const addBtn = el('button', 'stories-add-btn');
  addBtn.type = 'button';

  toolsLeft.append(typeFilterSelect, sortSelect);
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

  function rebuildStoryTypeFilterOptions(){
    ensureStories(person);
    const stories = person.stories || [];

    // الأنواع المستخدمة فعليًا في القصص
    const usedTypesSet = new Set();
    for (const s of stories){
      const t = (s.type || '').trim();
      if (t) usedTypesSet.add(t);
    }

    // حفظ الاختيار السابق
    const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';

    // تنظيف القائمة
    typeFilterSelect.innerHTML = '';

    // خيار "كل الأنواع"
    const optAll = el('option');
    optAll.value = 'all';
    optAll.textContent = 'كل الأنواع';
    typeFilterSelect.appendChild(optAll);

    // ترتيب الأنواع وفق STORY_TYPE_OPTIONS ثم أبجديًا للباقي (لو وُجِد كود غير معروف)
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

    const canKeepPrev =
      prevValue &&
      prevValue !== 'all' &&
      usedTypes.includes(prevValue);

    const nextValue = canKeepPrev ? prevValue : 'all';
    typeFilterSelect.value = nextValue;
    currentTypeFilter = nextValue;
  }

  function renderList() {
 list.innerHTML = '';
ensureStories(person);
updateStoriesCountBadge();
updateAddButtonLabel();
rebuildStoryTypeFilterOptions(); // إعادة بناء خيارات الفلتر حسب الأنواع الحالية

    const filteredStories = person.stories.filter(story => {
      const typeOk =
        currentTypeFilter === 'all' ||
        !currentTypeFilter ||
        (story.type || '') === currentTypeFilter;
      const tagOk =
        !currentTagFilter ||
        (Array.isArray(story.tags) && story.tags.includes(currentTagFilter));
      return typeOk && tagOk;
    });

    if (!filteredStories.length) {
      const empty = el('div', 'stories-empty');
   empty.textContent = person.stories.length ? 'لا توجد قصص مطابقة لخيارات التصفية الحالية.'
  : 'ابدأ بإضافة أول قصة (مثلاً: موقف جميل، أو وصف مختصر لصفات هذا الشخص)، ثم أضف بقية المواقف المهمة.';

      list.appendChild(empty);
      return;
    }

    filteredStories.forEach((story, index) => {
    const serial = index + 1;
    const card = el('article', 'story-card');
    card.dataset.storyId = story.id;

    const indexBadge = el('div', 'story-card-index');
    indexBadge.textContent = `القصة ${serial}`;

    let pinnedBadge = null;
    if (story.pinned) {
      pinnedBadge = el('div', 'story-pinned-badge');
      pinnedBadge.textContent = 'قصة مميّزة';
    }
if (story.pinned) {
  card.classList.add('story-card--pinned');
}

    const topRow = el('div', 'story-card-top');
    topRow.appendChild(indexBadge);
    if (pinnedBadge) topRow.appendChild(pinnedBadge);
    card.appendChild(topRow);

      const original = {
        title: story.title || '',
        text: (story.text || '').trim(),
        images: Array.isArray(story.images) ? [...story.images] : [],
        type: (story.type || '').trim(),
        eventDate: story.eventDate || null,
        place: (story.place || '').trim(),
        tags: Array.isArray(story.tags) ? [...story.tags] : [],
        pinned: !!story.pinned,
        note: (story.note || '').trim()
      };
      const eventDateLabel = formatShortDateBadge(original.eventDate);


      let currentImages = Array.isArray(original.images) ? [...original.images]
        : [];
      let isEditing =
        lastEditedId === story.id ||
        (!story.title && !story.text && lastEditedId === story.id);
      let isDirty = false;

      // ===== المعاينة =====
      const previewBox = el('div', 'story-preview');
      const previewMeta = el('div', 'story-preview-meta');

      const dateLabel = el('span', 'story-preview-date');
      dateLabel.textContent = story.createdAt ? formatStoryDate(story.createdAt)
        : '';

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
   const isDated = !!eventDateLabel;
if (eventDateLabel) {
  const yearBadge = el('span', 'story-badge story-badge--year');
  yearBadge.textContent = eventDateLabel;
  badgesWrap.appendChild(yearBadge);
}
if (!isDated){
  const undatedBadge = el('span', 'story-badge story-badge--undated');
  undatedBadge.textContent = 'بدون تاريخ محدّد';
  badgesWrap.appendChild(undatedBadge);
}


      let typeBadge = null;
      const typeLabel = getTypeLabel(original.type);
      if (typeLabel) {
        typeBadge = el('span', 'story-badge story-badge--type');
        typeBadge.dataset.storyId = story.id;                     // ربط البادج بالقصة
        typeBadge.dataset.type = original.type || 'general';      // مهم للأيقونة
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
    const thumb = el(
      'div',
      'story-image-thumb story-image-thumb--preview'
    );
    const imgEl = el('img');
    imgEl.alt = 'صورة مرفقة بالقصة';

    // نحل المرجع إلى URL حقيقي
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

      // ===== التحرير =====
      const editBox = el('div', 'story-edit');
      const head = el('div', 'story-head');

      const titleInput = el('input', 'story-title-input');
      titleInput.type = 'text';
      titleInput.name = `story_title_${story.id}`;
      titleInput.placeholder = 'عنوان القصة (اختياري)';
      titleInput.value = original.title;

      const dates = el('div', 'story-dates');
      dates.textContent = story.createdAt ? formatStoryDate(story.createdAt)
        : '';

      head.append(titleInput, dates);
      editBox.appendChild(head);

         const body = el('div', 'story-body');
      const metaRow = el('div', 'story-meta-row');

      // حقل نوع القصة
      const typeSelect = el('select', 'story-type-select');
      typeSelect.name = `story_type_${story.id}`;

      // نضيف كل الأنواع ما عدا "كل الأنواع"
      STORY_TYPE_OPTIONS
        .filter(([val]) => val && val !== 'all')
        .forEach(([val, label]) => {
          const opt = el('option');
          opt.value = val;
          opt.textContent = label;
          typeSelect.appendChild(opt);
        });

      // إذا لا يوجد نوع مخزَّن نعتبره "عام"
      typeSelect.value = original.type || 'general';


          const typeField = el('div', 'story-meta-field');
      const typeLabelBox = el('div', 'story-meta-label');
      typeLabelBox.innerHTML =   '<span class="story-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع القصة';
      typeField.append(typeLabelBox, typeSelect);

      // حقل تاريخ الحدث
      const eventInput = el('input');
      eventInput.type = 'date';
      eventInput.name = `story_event_${story.id}`;
      eventInput.value = original.eventDate || '';

      const eventField = el('div', 'story-meta-field');
      const eventLabel = el('div', 'story-meta-label');
      eventLabel.innerHTML =   '<span class="story-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الحدث';
      eventField.append(eventLabel, eventInput);

      // حقل المكان
      const placeInput = el('input');
      placeInput.type = 'text';
      placeInput.name = `story_place_${story.id}`;
      placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
      placeInput.value = original.place;

      const placeField = el('div', 'story-meta-field');
      const placeLabel = el('div', 'story-meta-label');
      placeLabel.innerHTML =   '<span class="story-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> المكان';
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
            tagsInput.placeholder =
        'وسوم القصة (افصل بينها بفواصل مثل: عام, الطفولة, الدراسة, طرائف)';

      tagsInput.value = original.tags.join(', ');

        // كتلة الصور العامة
      const imagesBlock = el('div', 'story-images-block');

      // نص التلميح (يظهر عند عدم وجود صور)
      const emptyImagesHint = el('div', 'story-images-empty-hint');

      // صف خارجي يدفع المصغّرات لليمين
      const imagesRow = el('div', 'story-images-row');

      // الحاوية الداخلية التي يشتغل عليها Sortable
      const imagesThumbs = el('div', 'story-images-thumbs');

      // زر إضافة الصور + حقل الملف
const addImageLabel = el('label', 'story-image-add-btn');
const addImageIcon = el('span', 'story-image-add-icon');
addImageIcon.innerHTML =
  '<i class="fa-solid fa-camera" aria-hidden="true"></i>';
const addImageText = el('span', 'story-image-add-text');

      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      addImageLabel.append(addImageIcon, addImageText, fileInput);

      // تركيب الهيكل:
      // emptyImagesHint
      // ثم صف يمين يحتوي على thumbs
      // ثم زر الإضافة
      imagesRow.appendChild(imagesThumbs);
      imagesBlock.append(
        emptyImagesHint,
        imagesRow,
        addImageLabel
      );

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
          addImageLabel.title =
            'أضف صورة ثانية لتغطية جوانب أخرى من القصة';
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
          // مهم: نربط الـ ref بالعنصر حتى نسترجع الترتيب بعد السحب
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
        setupImagesSortable(); // تفعيل Sortable بعد بناء المصغّرات
      }


      renderThumbs();

 fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;

  for (const file of files) {
    try {
      const ref = await storeStoryImageFile(file, personId, story.id);
      if (ref) {
        currentImages.push(ref);
      }
    } catch (e) {
      console.error('failed to add story image', e);
      showError?.('تعذّر حفظ إحدى الصور المرفقة. حاول مرة أخرى.');
    }
  }

  renderThumbs();
  recomputeDirty();
  fileInput.value = '';
});

      body.append(
        metaRow,
        textArea,
        noteInput,
        tagsInput,
        imagesBlock,
        pinWrap
      );
      editBox.appendChild(body);
      card.appendChild(editBox);

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

// دالة مساعدة لتغيير نص/أيقونة زر الحفظ حسب الحالة
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

  if (!isEditing) {
    setSaveBtnLabel('edit');
  } else if (!isDirty) {
    setSaveBtnLabel('close');
  } else {
    setSaveBtnLabel('save');
  }

  cancelBtn.style.display = isEditing && isDirty ? '' : 'none';
}

      function recomputeDirty() {
        const curTitle = titleInput.value.trim();
        const curText = textArea.value.trim();
        const curType = typeSelect.value.trim();
        const curEvent = eventInput.value || null;
        const curPlace = placeInput.value.trim();
        const curTags = tagsInput.value
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
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
          curTags.join('|') !== original.tags.join('|') ||
          !arraysShallowEqual(currentImages, original.images);

        applyMode();
      }

      applyMode();

      titleInput.addEventListener('input', recomputeDirty);
      textArea.addEventListener('input', recomputeDirty);
      typeSelect.addEventListener('change', recomputeDirty);
      eventInput.addEventListener('change', recomputeDirty);
      placeInput.addEventListener('input', recomputeDirty);
      tagsInput.addEventListener('input', recomputeDirty);
      noteInput.addEventListener('input', recomputeDirty);
      pinCheckbox.addEventListener('change', recomputeDirty);

      saveBtn.addEventListener('click', () => {
        if (!isEditing) {
          isEditing = true;
          lastEditedId = story.id;
          applyMode();
          showInfo?.(
            'يمكنك الآن تعديل القصة ثم الضغط على "حفظ" لتثبيت التعديلات.'
          );
          return;
        }

        if (isEditing && !isDirty) {
          isEditing = false;
          lastEditedId = null;
          applyMode();
          showInfo?.(
            'لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر القصة.'
          );
          return;
        }

        const newTitle = titleInput.value.trim();
        const newText = textArea.value.trim();
        const newType = typeSelect.value.trim();
        const newEventDate = eventInput.value || null;
        const newPlace = placeInput.value.trim();
        const newTags = tagsInput.value
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
        const newNote = noteInput.value.trim();
        const newPinned = !!pinCheckbox.checked;

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

        original.title = effective.title || '';
        original.text = (effective.text || '').trim();
        original.images = Array.isArray(effective.images)  ? [...effective.images]
          : [];
        original.type = (effective.type || '').trim();
        original.eventDate = effective.eventDate || null;
        original.place = (effective.place || '').trim();
        original.tags = Array.isArray(effective.tags) ? [...effective.tags]
          : [];
        original.note = (effective.note || '').trim();
        original.pinned = !!effective.pinned;

        currentImages = [...original.images];

        // تحديث العنوان
        previewTitle.textContent =
          original.title || 'قصة بدون عنوان';

        // تحديث شريحة طول النص
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

// تحديث نص المعاينة
previewText.textContent =
  trimmedText ||
  'لم تتم إضافة نص لهذه القصة حتى الآن. يمكنك فتح وضع التحرير لكتابته.';

        // تحديث تاريخ الإضافة في الرأس والمعاينة
        if (effective.createdAt) {
          const labelText = formatStoryDate(effective.createdAt);
          dates.textContent = labelText;
          dateLabel.textContent = labelText;
        }

        // NEW: تحديث بادج نوع القصة في هذه البطاقة + أي بادجات أخرى لنفس القصة
        const effectiveType = (effective.type || '').trim() || 'general';
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

        // NEW: إعادة بناء القائمة كلها (ستُحدّث الفلتر + البادجات من البيانات المحدثة)
        renderList();
        showSuccess?.('تم حفظ تعديلات القصة بنجاح');

      });

      cancelBtn.addEventListener('click', () => {
        if (!isEditing) return;

        titleInput.value = original.title;
        textArea.value = original.text;
        currentImages = [...original.images];
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
        tagsInput.value = original.tags.join(', ');
        noteInput.value = original.note;
        pinCheckbox.checked = original.pinned;

        isEditing = false;
        lastEditedId = null;
        isDirty = false;
        applyMode();

        showInfo?.(
          'تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من القصة.'
        );
      });

      delBtn.addEventListener('click', async () => {
        const ok = await showConfirmModal?.(
          'حذف القصة',
          'هل تريد بالتأكيد حذف هذه القصة؟ لا يمكن التراجع عن هذا الإجراء.'
        );
        if (!ok) {
          showInfo?.('تم إلغاء حذف القصة.');
          return;
        }

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

  addBtn.addEventListener('click', () => {
    ensureStories(person);
    const draft = person.stories.find(s => {
      const t = String(s.title || '').trim();
      const txt = String(s.text || '').trim();
      const imgs = Array.isArray(s.images) ? s.images : [];
      return !t && !txt && imgs.length === 0;
    });

    if (draft) {
      lastEditedId = draft.id;
      renderList();
      const card = list.querySelector(
        `.story-card[data-story-id="${draft.id}"]`
      );
      const textarea = card?.querySelector('.story-textarea');
      if (textarea) textarea.focus();
      showWarning?.(
        'لديك مسودة قصة مفتوحة بالفعل. أكمل كتابتها أولاً قبل إضافة قصة جديدة.'
      );
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
    showSuccess?.(
      'تمت إضافة قصة جديدة. اكتب تفاصيلها ثم اضغط "حفظ" لتثبيتها.'
    );
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
      mode === 'latest' ? 'تم ترتيب القصص من الأحدث إلى الأقدم.'
        : 'تم ترتيب القصص من الأقدم إلى الأحدث.'
    );
  });

  typeFilterSelect.addEventListener('change', () => {
    const val = typeFilterSelect.value;
    currentTypeFilter = val || 'all';
    renderList();
  });

  renderList();
  emitStoriesToHost();
  return root;
}
