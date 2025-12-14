// person.events.js
// إدارة "الخط الزمني للأحداث" لكل شخص (منطق + واجهة القسم داخل نافذة السيرة)

import {
    el,
    textEl,
    showSuccess,
    showError,
    showInfo,
    showConfirmModal,
    arraysShallowEqual,
    formatShortDateBadge,
    formatFullDateTime,
    attachHorizontalSortable,
    createImageViewerOverlay
} from '../utils.js';

import { DB } from '../storage/db.js';

// ====================== بيانات الحدث ======================

const EVENT_TYPES = [
  { value:'birth',    label:'ميلاد',          emoji:'👶' },
  { value:'marriage', label:'زواج',           emoji:'💍' },
  { value:'child',    label:'إنجاب',          emoji:'🧒' },
  { value:'move',     label:'انتقال/هجرة',   emoji:'🚚' },
  { value:'job',      label:'عمل/وظيفة',     emoji:'💼' },
  { value:'hajj',     label:'حج/عمرة',       emoji:'🕋' },
  { value:'death',    label:'وفاة',           emoji:'🕊️' },
  { value:'custom',   label:'حدث مخصّص',     emoji:'⭐' }
];

function _getTypeMeta(type){
  const t = EVENT_TYPES.find(e => e.value === type);
  return t || {
    value: type || 'custom',
    label: 'حدث',
    emoji: '⭐'
  };
}



function _newId(){
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch(e){}
  return 'ev_' + Math.random().toString(36).slice(2, 10);
}

function normalizeEvent(raw){
  const nowIso = new Date().toISOString();
  const r = raw || {};
  const id = String(r.id || _newId());
  const type = String(r.type || 'custom').trim() || 'custom';
  const date = String(r.date || '').trim();
  const place = String(r.place || '').trim();
  const title = String(r.title || '').trim();
  const description = String(r.description || '').trim();
  const media = Array.isArray(r.media) ? r.media.map(String).map(s => s.trim()).filter(Boolean)
    : [];
  const pinned = !!r.pinned;

  // NEW: الوسوم (tags) كسلسلة أو مصفوفة
  let tagsArr = [];
  if (Array.isArray(r.tags)){
    tagsArr = r.tags;
  } else if (typeof r.tags === 'string'){
    tagsArr = r.tags.split(',');
  }
  const tags = tagsArr
    .map(String)
    .map(t => t.trim())
    .filter(Boolean);

  // NEW: المرجع/المصدر
  const source = String(r.source || '').trim();

  // NEW: درجة اليقين
  let certainty = String(r.certainty || '').trim();
  const allowedCert = ['certain','probable','approx'];
  if (!allowedCert.includes(certainty)) certainty = '';

  return {
    id,
    type,
    title,
    date,
    place,
    description,
    media,
    pinned,
    tags,
    source,
    certainty,
    createdAt: r.createdAt || nowIso,
    updatedAt: r.updatedAt || nowIso
  };
}


// طول وصف الحدث (نفس فكرة القصص لكن بنصوص "تفاصيل")
function getEventLengthInfo(len){
  if (!len) return { label: 'بدون تفاصيل', level: 0 };
  if (len <= 280) return { label: 'تفاصيل قصيرة', level: 1 };
  if (len <= 800) return { label: 'تفاصيل متوسطة', level: 2 };
  return { label: 'تفاصيل طويلة', level: 3 };
}

// تنسيق تاريخ إنشاء/إضافة الحدث (للمعاينة)
function formatEventCreatedDate(iso){
  const body = formatFullDateTime(iso);
  if (!body) return '';
  return `أضيف هذا الحدث في ${body}`;
}
// ====================== صور الأحداث عبر IndexedDB ======================

// ref هو ما سيُخزَّن داخل event.media (مثل: 'idb:event_123')
// هذه الدالة تعطي URL صالح للعرض (blob: أو http أو data:)
async function resolveEventImageUrl(ref) {
  if (!ref) return null;
  const s = String(ref);

  // بيانات جاهزة أصلاً (قديمة أو مستوردة)
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  try {
    // تفضيل دوال الأحداث إن وُجدت
    if (typeof DB?.getEventImageURL === 'function') {
      const url = await DB.getEventImageURL(s);
      if (url) return url;
    }

    // توافق خلفي مع قصص (لو أحببت مشاركة نفس التخزين)
    if (typeof DB?.getStoryImageURL === 'function') {
      const url = await DB.getStoryImageURL(s);
      if (url) return url;
    }
  } catch (e) {
    console.error('resolveEventImageUrl failed', e);
    return null;
  }

  // في حال لم تُنفَّذ في DB بعد
  return s;
}

// تخزين ملف صورة في IndexedDB وإرجاع المرجع الذي سيُحفَظ في event.media
async function storeEventImageFile(file, personId, eventId) {
  if (!file) return null;

  // مطلوب منك في db.js: دالة DB.putEventImage تتولى الضغط + الحفظ
  if (typeof DB?.putEventImage === 'function') {
    try {
      const ref = await DB.putEventImage({ file, personId, eventId });
      // يُفضَّل أن ترجع الدالة مرجعًا من نوع 'idb:event_...'
      return ref || null;
    } catch (e) {
      console.error('storeEventImageFile failed (putEventImage)', e);
    }
  }

  // توافق خلفي مع قصص (لو أحببت إعادة استخدام نفس المسار التخزيني)
  if (typeof DB?.putStoryImage === 'function') {
    try {
      const ref = await DB.putStoryImage({ file, personId, storyId: eventId });
      return ref || null;
    } catch (e) {
      console.error('storeEventImageFile failed (putStoryImage)', e);
    }
  }

  // Fallback اختياري (مؤقت): لو DB.putEventImage غير جاهزة، نستعمل DataURL كما في القصص
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = err => reject(err);
    reader.onload = ev => resolve(String(ev.target?.result || ''));
    reader.readAsDataURL(file);
  });
}

// عارض الصور المشترك للأحداث (باستخدام الدالة العامة من utils)
const eventImageViewer = createImageViewerOverlay({
  overlayClass:  'timeline-image-viewer-overlay',
  backdropClass: 'timeline-image-viewer-backdrop',
  dialogClass:   'timeline-image-viewer-dialog',
  imgClass:      'timeline-image-viewer-img',
  closeBtnClass: 'timeline-image-viewer-close',
  navClass:      'timeline-image-viewer-nav',
  arrowPrevClass:'timeline-image-viewer-arrow timeline-image-viewer-arrow-prev',
  arrowNextClass:'timeline-image-viewer-arrow timeline-image-viewer-arrow-next',
  counterClass:  'timeline-image-viewer-counter'
});

async function openEventImageSlider(refs, startIndex = 0) {
  const list = Array.isArray(refs) ? refs : [];
  const urls = [];
  for (const r of list) {
    const u = await resolveEventImageUrl(r);
    if (u) urls.push(u);
  }
  if (!urls.length) return;
  eventImageViewer.open(urls, startIndex);
}


function sortEvents(events){
  return (events || []).slice().sort((a,b) => {
    const da = (a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) ? a.date : null;
    const db = (b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) ? b.date : null;

    if (da && db){
      if (da < db) return -1;
      if (da > db) return 1;
    } else if (da && !db){
      return -1; // المؤرَّخ قبل غير المؤرَّخ
    } else if (!da && db){
      return 1;
    }

    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });
}
// حساب العمر التقريبي عند وقوع الحدث (إن وُجد تاريخ ميلاد وتاريخ حدث بصيغة YYYY-MM-DD)
function computeApproxAgeAtEvent(birthDate, eventDate){
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!birthDate || !eventDate) return null;
  if (!re.test(birthDate) || !re.test(eventDate)) return null;

  const [by,bm,bd] = birthDate.split('-').map(v => parseInt(v,10));
  const [ey,em,ed] = eventDate.split('-').map(v => parseInt(v,10));
  if (!by || !ey) return null;

  let age = ey - by;
  if (em < bm || (em === bm && ed < bd)) age -= 1;

  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

function getCertaintyLabel(code){
  switch (code){
    case 'certain':  return 'مؤكد';
    case 'probable': return 'مرجَّح';
    case 'approx':   return 'تقريبي';
    default:         return '';
  }
}


// ====================== واجهة القسم ======================
export function createEventsSection(person, handlers = {}){
  if (!person || typeof person !== 'object') return null;

  // تأمين مصفوفة الأحداث على الشخص
  if (!Array.isArray(person.events)) person.events = [];
  person.events = person.events.map(normalizeEvent);
  let currentTypeFilter = 'all';    // نوع الحدث
  let currentSortMode   = 'oldest'; // الأقدم أولاً (زمنيًا) افتراضياً
  let lastEditedEventId = null;     // آخر حدث في وضع التعديل (مسودة)
let currentSearchQuery = '';     // بحث بعنوان الحدث فقط

const root   = el('section', 'bio-section bio-section-timeline');
const header = el('div', 'timeline-header');

const titleBlock = el('div', 'timeline-title-block');
const title = el('h3', 'timeline-title');
title.innerHTML =
  '<i class="fa-solid fa-timeline" aria-hidden="true"></i>' +
  '<span>الخطّ الزمني للأحداث</span>';

const helper = textEl(
  'p',
  'حوِّل محطات الحياة إلى قصة واضحة: وثِّق الميلاد والدراسة والزواج والعمل والانتقالات وغيرها، ثم اعرضها كقائمة أو خط زمني أنيق يكشف تطوّر السنين ويلهم على إضافة مزيد من اللحظات المميّزة.',
  'timeline-helper-text'
);

titleBlock.append(title, helper);

const tools     = el('div', 'timeline-tools');

  const toolsLeft = el('div', 'timeline-tools-left');
  const toolsRight= el('div', 'timeline-tools-right');

  // فلتر نوع الحدث (مستقل عن القصص)
  const typeFilterSelect = el('select', 'timeline-type-filter');
  typeFilterSelect.name = 'events_type_filter';

  // ترتيب الأحداث: الأحدث / الأقدم (مستقل عن القصص)
  const sortSelect = el('select', 'timeline-sort');
  sortSelect.name = 'events_sort';

  {
    const optLatest = el('option');
    optLatest.value = 'latest';
    optLatest.textContent = 'الأحدث أولاً';
    const optOldest = el('option');
    optOldest.value = 'oldest';
    optOldest.textContent = 'الأقدم أولاً';
    sortSelect.append(optLatest, optOldest);
    sortSelect.value = 'oldest';
  }

const addBtn = el('button', 'timeline-add-btn');
addBtn.type  = 'button';
addBtn.innerHTML =
  '<i class="fa-solid fa-plus" aria-hidden="true"></i>' +
  '<span>إضافة حدث جديد</span>';

const viewToggle = el('div', 'timeline-view-toggle');

const listBtn = el('button', 'timeline-view-btn is-active');
listBtn.innerHTML =
  '<i class="fa-solid fa-list" aria-hidden="true"></i>' +
  '<span>عرض قائمة</span>';

const visBtn  = el('button', 'timeline-view-btn');
visBtn.innerHTML =
  '<i class="fa-solid fa-timeline" aria-hidden="true"></i>' +
  '<span>عرض خط زمني</span>';

listBtn.type = visBtn.type = 'button';

viewToggle.append(listBtn, visBtn);
// ===== بحث بعنوان الحدث فقط =====
const searchWrap = el('div', 'timeline-search-wrap');

const searchInput = el('input', 'timeline-search-input');
searchInput.type = 'search';
searchInput.name = 'timeline-search-input';
searchInput.placeholder = 'ابحث في عناوين الأحداث…';

searchInput.addEventListener('input', () => {
  currentSearchQuery = searchInput.value.trim().toLowerCase();
  renderAll();   // مهم: إعادة الرسم الكامل
});

searchWrap.append(searchInput);

toolsLeft.append(typeFilterSelect, sortSelect, searchWrap);
  toolsRight.append(viewToggle, addBtn);
  tools.append(toolsLeft, toolsRight);

  header.append(titleBlock, tools);



  const listWrap     = el('div', 'events-list');
  const timelineWrap = el('div', 'events-timeline');

  root.append(header, listWrap, timelineWrap);
  root.dataset.view = 'list'; // الوضع الافتراضي

  function fireUpdateMessage(msg){
    if (msg && typeof showSuccess === 'function'){
      showSuccess(msg);
    }
    if (handlers && typeof handlers.onEventsChange === 'function'){
      handlers.onEventsChange(person);
    } else if (handlers && typeof handlers.onPersonChange === 'function'){
      handlers.onPersonChange(person);
    }
  }

  function updateEvent(ev, patch){
    Object.assign(ev, patch, { updatedAt: new Date().toISOString() });
  }


  function createEventCard(ev, index){
    const personId = person && person._id ? String(person._id) : null;

const original = {
  type: ev.type || 'custom',
  date: ev.date || '',
  title: ev.title || '',
  place: ev.place || '',
  description: ev.description || '',
  media: Array.isArray(ev.media) ? ev.media.slice() : [],
  pinned: !!ev.pinned,
  tags: Array.isArray(ev.tags) ? ev.tags.slice() : [],
  source: ev.source || '',
  certainty: ev.certainty || ''
};


    let currentMedia = Array.isArray(ev.media) ? ev.media.slice() : [];
    let isEditing =
      ev.id === lastEditedEventId ||
      (
        !ev.title &&
        !ev.description &&
        !ev.date &&
        !ev.place &&
        (!Array.isArray(ev.media) || ev.media.length === 0)
      );
    let isDirty = false;

    const meta  = _getTypeMeta(ev.type);
    const card  = el('article', 'event-card');
    card.dataset.eventId = ev.id;

    const serial = (index || 0) + 1;

    // ===== شريط علوي: رقم الحدث + مميَّز =====
    const topRow = el('div', 'event-card-top timeline-card-top');
    const indexBadge = el('div', 'event-card-index timeline-card-index');
    indexBadge.textContent = `الحدث ${serial}`;
    topRow.appendChild(indexBadge);

    let pinnedBadge = null;
    if (ev.pinned){
      pinnedBadge = el('div', 'event-pinned-badge timeline-pinned-badge');
      pinnedBadge.textContent = 'حدث مميّز';
      topRow.appendChild(pinnedBadge);
    }
    
    // NEW: زر للانتقال لعرض الخط الزمني لهذا الحدث
const jumpBtn = textEl('button', 'عرض على الخط الزمني', 'timeline-jump-btn');
jumpBtn.type = 'button';
jumpBtn.title = 'الانتقال إلى هذا الحدث في عرض الخط الزمني';

jumpBtn.addEventListener('click', e => {
  e.stopPropagation();
  root.dataset.view = 'timeline';
  visBtn.classList.add('is-active');
  listBtn.classList.remove('is-active');
  renderTimelineView();

  const item = timelineWrap.querySelector(`.timeline-item[data-event-id="${ev.id}"]`);
  if (item){
    try {
      item.scrollIntoView({ block:'nearest', behavior:'smooth' });
    } catch(e){
      item.scrollIntoView(true);
    }
  }
});

topRow.appendChild(jumpBtn);


    card.appendChild(topRow);

    // ===== وضع المعاينة =====
    const previewBox  = el('div', 'event-preview');
    const previewMeta = el('div', 'event-preview-meta timeline-preview-meta');

    // تاريخ الإضافة (createdAt)
    const createdLabel = el('span', 'event-preview-created timeline-preview-created');
    createdLabel.textContent = ev.createdAt ? formatEventCreatedDate(ev.createdAt)
      : '';

    // طول الوصف
    const lengthLabel = el('span', 'event-preview-length timeline-length-chip');
    const lenInfo = getEventLengthInfo((ev.description || '').length);
    if (lenInfo.level === 0){
      lengthLabel.textContent = 'لم تُكتب تفاصيل هذا الحدث بعد';
    } else {
      const meter = el('span', 'event-length-meter timeline-length-meter');
      meter.dataset.level = String(lenInfo.level);
      const bar = el('span', 'event-length-meter-bar timeline-length-meter-bar');
      meter.appendChild(bar);
      const txtSpan = el('span');
      txtSpan.textContent = lenInfo.label;
      lengthLabel.innerHTML = '';
      lengthLabel.append(meter, txtSpan);
    }

    previewMeta.append(createdLabel, lengthLabel);

    // بادجات المكان/تاريخ الحدث/نوع الحدث
    const badgesWrap = el('div', 'event-preview-badges timeline-preview-badges');
    const dateBadgeText = ev.date ? formatShortDateBadge(ev.date) : '';

    // سطر نصي لتاريخ الحدث (إن وُجد)
    let eventDateLine = null;
    if (ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) && dateBadgeText){
      eventDateLine = textEl(
        'div',
        `تاريخ الحدث: ${dateBadgeText}`,
        'event-preview-eventdate'
      );
    }

    // العمر التقريبي عند الحدث (إن وُجد تاريخ الميلاد للشخص)
    let ageLine = null;
    const birthDate = person?.bio?.birthDate || null;
    const approxAge = computeApproxAgeAtEvent(birthDate, ev.date);
    if (approxAge != null){
      ageLine = textEl(
        'div',
        `العمر التقريبي عند الحدث: ${approxAge} سنة`,
        'event-preview-age'
      );
    }

    if (ev.place){
      const placeBadge = el('span', 'timeline-badge timeline-badge--place');
      placeBadge.textContent = ev.place;
      badgesWrap.appendChild(placeBadge);
    }
    if (dateBadgeText){
      const yearBadge = el('span', 'timeline-badge timeline-badge--year');
      yearBadge.textContent = dateBadgeText;
      badgesWrap.appendChild(yearBadge);
    }
let typeBadge = null;
if (meta.label){
  typeBadge = el('span', 'timeline-badge timeline-badge--type');
  typeBadge.dataset.eventId = ev.id;
  typeBadge.dataset.type = ev.type || 'custom';   // مهم للأيقونة
  typeBadge.textContent = meta.label;
  badgesWrap.appendChild(typeBadge);
}

// NEW: وسوم + مصدر + درجة يقين (معاينة)
const extraMetaPreview = el('div', 'event-extra-meta');

if (Array.isArray(ev.tags) && ev.tags.length){
  ev.tags.forEach(tag => {
    const tagBadge = el('span', 'timeline-badge timeline-badge--tag');
    tagBadge.textContent = tag;
    extraMetaPreview.appendChild(tagBadge);
  });
}

const certLabel = getCertaintyLabel(ev.certainty);
if (certLabel){
  const cChip = el('span', 'timeline-certainty-chip');
  cChip.textContent = `درجة اليقين: ${certLabel}`;
  extraMetaPreview.appendChild(cChip);
}

if (ev.source){
  const sChip = el('span', 'timeline-source-chip');
  sChip.textContent = `المصدر: ${ev.source}`;
  extraMetaPreview.appendChild(sChip);
}


    const previewTitle = textEl(
      'div',
      ev.title || meta.label,
      'event-preview-title timeline-preview-title'
    );

    const previewDesc = textEl(
      'p',
      ev.description ||
        'لم تتم إضافة تفاصيل لهذا الحدث بعد. يمكنك فتح وضع التعديل لكتابتها.',
      'event-preview-description timeline-preview-text'
    );

    const previewImagesWrap = el('div', 'event-preview-images timeline-preview-images');
const sliderBtn = el(
  'button',
  'event-images-slider-btn timeline-images-slider-btn'
);
sliderBtn.type = 'button';
sliderBtn.innerHTML =
  '<i class="fa-solid fa-images" aria-hidden="true"></i>' +
  '<span>عرض الصور كشرائح</span>';

    sliderBtn.addEventListener('click', () => {
      if (!ev.media || ev.media.length < 2) return;
      openEventImageSlider(ev.media, 0);
    });

    function renderPreviewImages() {
      previewImagesWrap.innerHTML = '';
      const list = Array.isArray(ev.media) ? ev.media : [];
      sliderBtn.style.display = list.length > 1 ? '' : 'none';

      list.forEach((ref, idx) => {
        const thumb = el(
          'div',
          'timeline-image-thumb timeline-image-thumb--preview event-media-thumb event-media-thumb--preview'
        );
        const imgEl = el('img');
        imgEl.alt = 'صورة مرفقة بالحدث';

        resolveEventImageUrl(ref).then(url => {
          if (url) imgEl.src = url;
        });

        const viewBtn = textEl(
          'button',
          'معاينة',
          'event-media-thumb-view timeline-image-thumb-view'
        );
        viewBtn.type = 'button';
        viewBtn.title = 'معاينة الصورة بحجم أكبر';

        viewBtn.addEventListener('click', e => {
          e.stopPropagation();
          openEventImageSlider(list, idx);
        });

        imgEl.addEventListener('click', () => {
          openEventImageSlider(list, idx);
        });

        thumb.append(imgEl, viewBtn);
        previewImagesWrap.appendChild(thumb);
      });
    }

    renderPreviewImages();

    // تجميع عناصر المعاينة بالترتيب الجديد:
    // 1) العنوان + 2) تاريخ الحدث/العمر/البادجات + 3) الوصف والصور + 4) الميتا الإدارية
    const previewChildren = [];

    // 1) العنوان أولاً
    previewChildren.push(previewTitle);

    // 2) تاريخ الحدث + العمر التقريبي + بادجات المكان/السنة/النوع
    if (eventDateLine) previewChildren.push(eventDateLine);
    if (ageLine) previewChildren.push(ageLine);
    previewChildren.push(badgesWrap);

    // 3) نص الوصف
    previewChildren.push(previewDesc);

    // 4) الصور + زر السلايدر
    previewChildren.push(previewImagesWrap, sliderBtn);

    // 5) ميتا الإضافة (تاريخ الإضافة + طول الوصف)
    previewChildren.push(previewMeta);

    // 6) وسوم + مصدر + درجة يقين (إن وُجدت)
    if (extraMetaPreview.childNodes.length) {
      previewChildren.push(extraMetaPreview);
    }

    previewBox.append(...previewChildren);

    card.appendChild(previewBox);


    // ===== وضع التعديل =====
    const editBox = el('div', 'event-edit');

    // رأس: عنوان + تاريخ إضافة
    const head  = el('div', 'event-head timeline-head');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'event-title-input timeline-title-input';
    titleInput.name = `event_title_${ev.id}`;
    titleInput.placeholder = 'عنوان الحدث (اختياري)';
    titleInput.value = ev.title || '';

    const dates = el('div', 'event-dates timeline-dates');
    dates.textContent = ev.createdAt ? formatEventCreatedDate(ev.createdAt) : '';

    head.append(titleInput, dates);
    editBox.appendChild(head);

    const body = el('div', 'event-body');

    // صف الميتا: نوع الحدث + تاريخ الحدث + المكان
    const metaRow = el('div', 'event-meta-row timeline-meta-row');

    const select = document.createElement('select');
    select.className = 'event-type-select';
    select.name = `event_type_${ev.id}`;

EVENT_TYPES.forEach(t => {
  const opt = document.createElement('option');
  opt.value = t.value;
  opt.textContent = t.label; // بدون إيموجي، الأيقونة ستظهر في باقي الواجهة
  if (t.value === ev.type) opt.selected = true;
  select.appendChild(opt);
});

    const typeField = el('div', 'event-meta-field timeline-meta-field');
    const typeLabelBox = el('div', 'event-meta-label timeline-meta-label');
    typeLabelBox.innerHTML = '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الحدث';
    typeField.append(typeLabelBox, select);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'event-date-input';
    dateInput.name = `event_date_${ev.id}`;
    if (ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)) dateInput.value = ev.date;

    const dateField = el('div', 'event-meta-field timeline-meta-field');
    const dateLabelBox = el('div', 'event-meta-label timeline-meta-label');
    dateLabelBox.innerHTML =   '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الحدث';
    dateField.append(dateLabelBox, dateInput);

    const placeInput = document.createElement('input');
    placeInput.type = 'text';
    placeInput.className = 'event-place-input';
    placeInput.name = `event_place_${ev.id}`;
    placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
    placeInput.value = ev.place || '';


    const placeField = el('div', 'event-meta-field timeline-meta-field');
    const placeLabelBox = el('div', 'event-meta-label timeline-meta-label');
    placeLabelBox.innerHTML =   '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> المكان';
    placeField.append(placeLabelBox, placeInput);

    metaRow.append(typeField, dateField, placeField);

    const desc = document.createElement('textarea');
    desc.className = 'event-description-input';
    desc.name = `event_description_${ev.id}`;
    desc.rows = 3;
    desc.placeholder =
      'تفاصيل الحدث (مثلاً: متى حصل، من حضر، ملاحظات خاصة...)';
    desc.value = ev.description || '';

    // ===== قسم الصور =====
    const mediaWrap = el('div', 'event-media-wrap');

    const emptyHint = el('div', 'event-media-empty-hint');
    const mediaRow  = el('div', 'event-media-row');
    const thumbs    = el('div', 'event-media-thumbs');

const addLabel = el('label', 'event-media-add-btn timeline-image-add-btn');
const addIcon  = el('span', 'event-media-add-icon timeline-image-add-icon');
addIcon.innerHTML =
  '<i class="fa-solid fa-camera" aria-hidden="true"></i>';
const addText  = textEl('span', 'إضافة صور للحدث', 'event-media-add-text timeline-image-add-text');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.name = `event_media_${ev.id}`;
    fileInput.style.display = 'none';

    addLabel.append(addIcon, addText, fileInput);
    mediaRow.appendChild(thumbs);
    mediaWrap.append(emptyHint, mediaRow, addLabel);

    function updateAddLabel() {
      const count = currentMedia.length || 0;
      if (count === 0) {
        addText.textContent = 'إضافة صور للحدث';
        addLabel.title = 'أرفق أول صورة لتوثيق هذا الحدث';
      } else if (count === 1) {
        addText.textContent = 'إضافة صورة أخرى';
        addLabel.title = 'أضف صورة ثانية لتغطية جوانب أخرى من الحدث';
      } else {
        addText.textContent = 'إضافة مزيد من الصور';
        addLabel.title = `هناك ${count} صور مرفقة حاليًا`;
      }
    }

function setupMediaSortable() {
  attachHorizontalSortable({
    container: thumbs,
    itemSelector: '.event-media-thumb',
    ghostClass: 'timeline-image-thumb--ghost',
    dragClass: 'timeline-image-thumb--drag',
    onSorted(orderedRefs) {
      currentMedia = orderedRefs.slice();
      recomputeDirty();
    }
  });
}


    function renderThumbs() {
      thumbs.innerHTML = '';
      const list = currentMedia;

      if (!list.length) {
        emptyHint.textContent = 'لم تُرفق صور بعد لهذا الحدث.';
        emptyHint.style.display = '';
        updateAddLabel();
        return;
      }

      emptyHint.style.display = 'none';

      list.forEach((ref, idx) => {
        const thumb = el(
          'div',
          'timeline-image-thumb event-media-thumb'
        );
        thumb.dataset.ref = ref;

        const imgEl = el('img');
        imgEl.alt = 'صورة مرفقة بالحدث';

        resolveEventImageUrl(ref).then(url => {
          if (url) imgEl.src = url;
        });

        const removeBtn = textEl(
          'button',
          '×',
          'event-media-thumb-remove timeline-image-thumb-remove'
        );
        removeBtn.type = 'button';
        removeBtn.title = 'إزالة هذه الصورة';

        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          currentMedia.splice(idx, 1);
          renderThumbs();
          recomputeDirty();
        });

        const viewBtn = textEl(
          'button',
          'معاينة',
          'event-media-thumb-view timeline-image-thumb-view'
        );
        viewBtn.type = 'button';
        viewBtn.title = 'معاينة الصورة بحجم أكبر';

        viewBtn.addEventListener('click', e => {
          e.stopPropagation();
          openEventImageSlider(currentMedia, idx);
        });

        imgEl.addEventListener('click', () => {
          openEventImageSlider(currentMedia, idx);
        });

        thumb.append(imgEl, removeBtn, viewBtn);
        thumbs.appendChild(thumb);
      });

      updateAddLabel();
      setupMediaSortable();
    }

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;

      for (const file of files) {
        try {
          const ref = await storeEventImageFile(file, personId, ev.id);
          if (ref) currentMedia.push(ref);
        } catch (e) {
          console.error('failed to add event image', e);
          showError?.('تعذّر حفظ إحدى الصور المرفقة. حاول مرة أخرى.');
        }
      }

      renderThumbs();
      recomputeDirty();
      fileInput.value = '';
    });

    // مفتاح تثبيت الحدث
    const pinWrap = el('label', 'event-pin-toggle timeline-pin-toggle');
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.name = `event_pinned_${ev.id}`;
    pinCheckbox.checked = original.pinned;
    const pinText = textEl('span', 'تعيين هذا الحدث كمميّز');
    pinWrap.append(pinCheckbox, pinText);

    // NEW: صف إضافي للوسوم + المصدر + درجة اليقين
const extraRow = el('div', 'event-extra-row timeline-extra-row');

// حقول الوسوم
const tagsField = el('div', 'event-meta-field timeline-meta-field');
const tagsLabelBox = el('div', 'event-meta-label timeline-meta-label');
tagsLabelBox.innerHTML =   '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tags" aria-hidden="true"></i></span> وسوم الحدث';
const tagsInput = document.createElement('input');
tagsInput.type = 'text';
tagsInput.className = 'event-tags-input';
tagsInput.name = `event_tags_${ev.id}`;
tagsInput.placeholder = 'مثال: الهجرة، السفر، العمل (مفصولة بفواصل)';
tagsInput.value = (Array.isArray(ev.tags) ? ev.tags.join(', ') : '');
tagsField.append(tagsLabelBox, tagsInput);

// حقل المرجع/المصدر
const sourceField = el('div', 'event-meta-field timeline-meta-field');
const sourceLabelBox = el('div', 'event-meta-label timeline-meta-label');
sourceLabelBox.innerHTML =   '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-book" aria-hidden="true"></i></span> المرجع / المصدر';
const sourceInput = document.createElement('input');
sourceInput.type = 'text';
sourceInput.className = 'event-source-input';
sourceInput.name = `event_source_${ev.id}`;
sourceInput.placeholder = 'مثال: رُوي عن فلان، أو موثّق من بطاقة هوية...';
sourceInput.value = ev.source || '';
sourceField.append(sourceLabelBox, sourceInput);

// حقل درجة اليقين
const certaintyField = el('div', 'event-meta-field timeline-meta-field');
const certaintyLabelBox = el('div', 'event-meta-label timeline-meta-label');
certaintyLabelBox.innerHTML =   '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-circle-question" aria-hidden="true"></i></span> درجة اليقين';
const certaintySelect = document.createElement('select');
certaintySelect.className = 'event-certainty-select';
certaintySelect.name = `event_certainty_${ev.id}`;

[
  { value:'',          label:'غير محددة' },
  { value:'certain',   label:'مؤكد' },
  { value:'probable',  label:'مرجَّح' },
  { value:'approx',    label:'تقريبي' }
].forEach(optDef => {
  const opt = document.createElement('option');
  opt.value = optDef.value;
  opt.textContent = optDef.label;
  if (optDef.value === (ev.certainty || '')) opt.selected = true;
  certaintySelect.appendChild(opt);
});

certaintyField.append(certaintyLabelBox, certaintySelect);

// تجميع الصف الإضافي
extraRow.append(tagsField, sourceField, certaintyField);

body.append(metaRow, desc, extraRow, mediaWrap, pinWrap);

    editBox.appendChild(body);
    card.appendChild(editBox);

    // ===== أزرار القدم =====
const footer   = el('div', 'event-footer');

const saveBtn  = el('button', 'event-save-btn');
const cancelBtn = el('button', 'event-cancel-btn');
const delBtn   = el('button', 'event-delete-btn');

saveBtn.type = cancelBtn.type = delBtn.type = 'button';

// إلغاء التعديل
cancelBtn.innerHTML =
  '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>' +
  '<span>إلغاء التعديل</span>';
cancelBtn.style.display = 'none';

// حذف الحدث
delBtn.innerHTML =
  '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>' +
  '<span>حذف الحدث</span>';

footer.append(saveBtn, cancelBtn, delBtn);
card.appendChild(footer);


function fillEditFromEvent() {
  select.value = ev.type || 'custom';
  if (!Array.from(select.options).some(o => o.value === select.value)) {
    select.value = 'custom';
  }

  dateInput.value =
    ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : '';

  titleInput.value = ev.title || '';
  placeInput.value = ev.place || '';
  desc.value = ev.description || '';

  // NEW: الحقول الإضافية
  tagsInput.value = Array.isArray(ev.tags) ? ev.tags.join(', ') : '';
  sourceInput.value = ev.source || '';
  certaintySelect.value = ev.certainty || '';

  pinCheckbox.checked = !!ev.pinned;

  currentMedia = Array.isArray(ev.media) ? ev.media.slice() : [];
  renderThumbs();
  recomputeDirty();
}

function updateSaveBtnLabel(){
  if (!isEditing){
    // وضع المعاينة: زر "تعديل"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>' +
      '<span>تعديل</span>';
  } else if (!isDirty){
    // وضع التعديل بدون تغييرات: زر "إغلاق"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
      '<span>إغلاق</span>';
  } else {
    // وضع التعديل مع تغييرات: زر "حفظ"
    saveBtn.innerHTML =
      '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>' +
      '<span>حفظ</span>';
  }
}

function applyMode() {
  card.classList.toggle('event-card--edit', isEditing);
  card.classList.toggle('event-card--preview', !isEditing);
  previewBox.style.display = isEditing ? 'none' : '';
  editBox.style.display = isEditing ? '' : 'none';

  // تحديث أيقونة/نص زر الحفظ/التعديل/الإغلاق
  updateSaveBtnLabel();

  cancelBtn.style.display = isEditing && isDirty ? '' : 'none';
}

function recomputeDirty() {
  const curType   = (select.value || 'custom').trim();
  const curDate   = String(dateInput.value || '').trim();
  const curTitle  = titleInput.value.trim();
  const curPlace  = placeInput.value.trim();
  const curDesc   = desc.value.trim();
  const curPinned = !!pinCheckbox.checked;

  const curTags = (tagsInput.value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const curSource = sourceInput.value.trim();
  const curCertainty = (certaintySelect.value || '').trim();

  isDirty =
    curType   !== original.type ||
    curDate   !== (original.date || '') ||
    curTitle  !== original.title ||
    curPlace  !== original.place ||
    curDesc   !== original.description ||
    curPinned !== original.pinned ||
    !arraysShallowEqual(currentMedia, original.media) ||
    !arraysShallowEqual(curTags, original.tags || []) ||
    curSource !== (original.source || '') ||
    curCertainty !== (original.certainty || '');

  applyMode();
}


    applyMode();
    renderThumbs();

    // مراقبة المدخلات
    select.addEventListener('change', recomputeDirty);
    dateInput.addEventListener('change', recomputeDirty);
    titleInput.addEventListener('input', recomputeDirty);
    placeInput.addEventListener('input', recomputeDirty);
    desc.addEventListener('input', recomputeDirty);
    pinCheckbox.addEventListener('change', recomputeDirty);
tagsInput.addEventListener('input', recomputeDirty);
sourceInput.addEventListener('input', recomputeDirty);
certaintySelect.addEventListener('change', recomputeDirty);

    // أحداث الأزرار
    saveBtn.addEventListener('click', async () => {
      if (!isEditing) {
        fillEditFromEvent();
        isEditing = true;
        applyMode();
        showInfo?.('يمكنك الآن تعديل بيانات الحدث ثم الضغط على "حفظ" لتثبيت التعديلات.');
        return;
      }

      if (isEditing && !isDirty) {
        isEditing = false;
        applyMode();
        showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر الحدث.');
        return;
      }

      const curTags = (tagsInput.value || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const patch = {
        type: (select.value || 'custom').trim(),
        date: String(dateInput.value || '').trim(),
        title: titleInput.value.trim(),
        place: placeInput.value.trim(),
        description: desc.value.trim(),
        media: currentMedia.slice(),
        pinned: !!pinCheckbox.checked,
        tags: curTags,
        source: sourceInput.value.trim(),
        certainty: (certaintySelect.value || '').trim()
      };


      // 1) تحديث كائن الحدث في البيانات
      updateEvent(ev, patch);

      // 2) حساب بيانات النوع الجديدة
      const newMeta = _getTypeMeta(patch.type);

      // 2-أ) تحديث بادج النوع في هذه البطاقة الحالية (قائمة الأحداث)
      if (typeBadge) {
        typeBadge.textContent = newMeta.label;
        typeBadge.dataset.type = patch.type || 'custom';
      }

      // 2-ب) تحديث جميع بادجات النوع في الخط الزمني لهذا الحدث نفسه
      document
        .querySelectorAll(`.timeline-badge--type[data-event-id="${ev.id}"]`)
        .forEach(node => {
          node.textContent = newMeta.label;
          node.dataset.type = patch.type || 'custom';
        });

      // إنهاء وضع التعديل لهذا الحدث (لا يعود مسودة)
      lastEditedEventId = null;

      // 3) إعادة ترتيب الأحداث وإعادة الرسم الكامل
      person.events = sortEvents(person.events || []);
      renderAll();
      fireUpdateMessage('تم حفظ تعديلات الحدث بنجاح.');


    });

    cancelBtn.addEventListener('click', () => {
      if (!isEditing) return;

      // الحقول الأساسية
      select.value = original.type || 'custom';
      if (!Array.from(select.options).some(o => o.value === select.value)) {
        select.value = 'custom';
      }
      dateInput.value = original.date || '';
      titleInput.value = original.title;
      placeInput.value = original.place;
      desc.value = original.description;
      pinCheckbox.checked = original.pinned;

      // NEW: إعادة حقول الوسوم + المصدر + درجة اليقين لحالتها المحفوظة
      tagsInput.value = (original.tags || []).join(', ');
      sourceInput.value = original.source || '';
      certaintySelect.value = original.certainty || '';

      // الصور
      currentMedia = original.media.slice();
      renderThumbs();

      isEditing = false;
      isDirty = false;
      applyMode();

      showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من الحدث.');
    });


    delBtn.addEventListener('click', async () => {
      const ok = await showConfirmModal?.(
        'حذف الحدث',
        'هل تريد بالتأكيد حذف هذا الحدث؟ لا يمكن التراجع عن هذا الإجراء.'
      );
      if (!ok) {
        showInfo?.('تم إلغاء حذف الحدث.');
        return;
      }

      person.events = (person.events || []).filter(e => e.id !== ev.id);
      renderAll();
      fireUpdateMessage('تم حذف الحدث من الخط الزمني.');
    });

    return card;
  }

  function rebuildTypeFilterOptions(){
    const events = person.events || [];

    // الأنواع المستخدمة فعليًا في الأحداث
    const usedTypesSet = new Set();
    for (const ev of events){
      const t = (ev.type || 'custom').trim() || 'custom';
      usedTypesSet.add(t);
    }

    // حفظ الاختيار السابق (إن وُجد)
    const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';

    // تنظيف القائمة
    typeFilterSelect.innerHTML = '';

    // خيار "كل الأنواع"
    const optAll = el('option');
    optAll.value = 'all';
    optAll.textContent = 'كل الأنواع';
    typeFilterSelect.appendChild(optAll);

    // ترتيب الأنواع بحسب مصفوفة EVENT_TYPES ثم أبجديًا للباقي
    const order = Object.fromEntries(
      EVENT_TYPES.map((t, i) => [t.value, i])
    );

    const usedTypes = Array.from(usedTypesSet);
    usedTypes.sort((a, b) => {
      const ia = (order[a] !== undefined ? order[a] : 999);
      const ib = (order[b] !== undefined ? order[b] : 999);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, 'ar');
    });

    usedTypes.forEach(typeVal => {
      const meta = _getTypeMeta(typeVal);
      const opt = el('option');
      opt.value = meta.value;     // مثل "birth" أو "job" أو "custom"
      opt.textContent = meta.label; // "ميلاد" ... الخ
      typeFilterSelect.appendChild(opt);
    });

    // إعادة تطبيق الاختيار السابق إن كان ما زال موجودًا، وإلا نرجع لـ all
    const canKeepPrev =
      prevValue &&
      prevValue !== 'all' &&
      usedTypes.includes(prevValue);

    const nextValue = canKeepPrev ? prevValue : 'all';
    typeFilterSelect.value = nextValue;
    currentTypeFilter = nextValue;
  }


function getFilteredSortedEvents(){
  let events = sortEvents(person.events || []);

  // ترتيب العرض
  if (currentSortMode === 'latest'){
    events = events.slice().reverse();
  }

  // فلتر النوع
  if (currentTypeFilter && currentTypeFilter !== 'all'){
    events = events.filter(ev => (ev.type || 'custom') === currentTypeFilter);
  }

  // ===== بحث بعنوان الحدث فقط =====
  if (currentSearchQuery){
    events = events.filter(ev =>
      String(ev.title || '')
        .toLowerCase()
        .includes(currentSearchQuery)
    );
  }

  return events;
}


  function renderList(){
    listWrap.innerHTML = '';
    const allEvents = person.events || [];
    const events = getFilteredSortedEvents();

if (!events.length){
  const empty = el('div', 'events-empty');
  empty.textContent = allEvents.length ? 'لا توجد أحداث مطابقة للبحث أو التصفية الحالية.'
    : 'لا توجد أحداث مسجّلة بعد. ابدأ بإضافة أول حدث (مثل: تاريخ الميلاد) ثم أضف بقية المحطات المهمة.';

  listWrap.appendChild(empty);
  return;
}

    events.forEach((ev, index) => {
      const card = createEventCard(ev, index);
      listWrap.appendChild(card);
    });
  }

  function renderTimelineView(){
    timelineWrap.innerHTML = '';
    const events = getFilteredSortedEvents();
    if (!events.length){
      const empty = el('div', 'timeline-empty');
      empty.textContent = 'لا توجد أحداث لعرضها على الخط الزمني بعد. ابدأ من تبويب القائمة بإضافة أول حدث.';

      timelineWrap.appendChild(empty);
      return;
    }

    const list = el('ol', 'timeline-list timeline-vertical');
    let lastYear = null;
    const birthDate = person?.bio?.birthDate || null;

    events.forEach(ev => {
      const meta = _getTypeMeta(ev.type);

      // سنة الحدث (أو "غير مؤرَّخ")
      const hasIsoDate = ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date);
      const year = hasIsoDate ? ev.date.slice(0,4) : 'غير مؤرَّخ';
      const dateBadgeText = ev.date ? formatShortDateBadge(ev.date) : '';

      // فاصل السنة إذا تغيّرت
      if (year !== lastYear){
        const yearItem = el('li', 'timeline-year-separator');
        yearItem.textContent =
          (year === 'غير مؤرَّخ') ? 'أحداث بدون سنة محددة' : `سنة ${year}`;
        list.appendChild(yearItem);
        lastYear = year;
      }

const item = el('li', 'timeline-item');
item.dataset.eventId = ev.id;
item.dataset.type = ev.type || 'custom';

if (ev.pinned){
  item.classList.add('is-pinned');
}

const marker = el('div', 'timeline-marker');
const markerIcon = el('span', 'timeline-marker-emoji');
markerIcon.textContent = meta.emoji || '⭐';
marker.appendChild(markerIcon);

const content = el('div', 'timeline-content');
      // تاريخ الحدث في أعلى الكتلة
      const dateLabel = textEl(
        'div',
        dateBadgeText || 'بدون تاريخ محدّد',
        'timeline-date'
      );

const titleText = ev.title || meta.label;
const titleRow  = el('div', 'timeline-title-row');
const iconSpan  = el('span', 'timeline-title-icon');
const iconEmoji = el('span', 'timeline-title-emoji');
iconEmoji.textContent = meta.emoji || '⭐';
iconSpan.appendChild(iconEmoji);
const titleSpan = textEl('span', titleText, 'timeline-title');

titleRow.append(iconSpan, titleSpan);

      // بادج نوع الحدث داخل عنصر الخط الزمني:
      // نضيفه فقط إذا كان هناك عنوان مخصّص حتى لا يتكرّر نفس النص
      if (ev.title){
        const typeBadge = el('span', 'timeline-badge timeline-badge--type');
        typeBadge.dataset.eventId = ev.id;
        typeBadge.dataset.type = ev.type || 'custom';   // مهم للأيقونة
        typeBadge.textContent = meta.label;
        titleRow.appendChild(typeBadge);
      }

      content.append(dateLabel, titleRow);

      // العمر التقريبي عند الحدث
      const approxAge = computeApproxAgeAtEvent(birthDate, ev.date);
      if (approxAge != null){
        const ageEl = textEl(
          'div',
          `العمر التقريبي عند الحدث: ${approxAge} سنة`,
          'timeline-age'
        );
        content.appendChild(ageEl);
      }

      if (ev.place){
        const place = textEl('div', `المكان: ${ev.place}`, 'timeline-place');
        content.appendChild(place);
      }
  if (ev.description){
  const maxLen = 200;
  let text = ev.description;
  let hint = '';
  if (text.length > maxLen){
    text = text.slice(0, maxLen).trim();
    hint = '… (التفاصيل الكاملة من عرض القائمة).';
  }
  const desc = textEl('p', text + hint, 'timeline-description');
  content.appendChild(desc);
}

      // ثَمبنيل صور مصغّرة بدل الروابط النصية
      if (ev.media && ev.media.length){
        const mWrap = el('div', 'timeline-media');

        ev.media.forEach((ref, idx) => {
          const thumb = el('div', 'timeline-image-thumb');
          const imgEl = el('img');
          imgEl.alt = 'صورة الحدث';

          resolveEventImageUrl(ref).then(url => {
            if (url) imgEl.src = url;
          });

          thumb.addEventListener('click', e => {
            e.stopPropagation();
            openEventImageSlider(ev.media, idx);
          });

          thumb.appendChild(imgEl);
          mWrap.appendChild(thumb);
        });

        content.appendChild(mWrap);
      }
      
            // NEW: وسوم الحدث
      if (Array.isArray(ev.tags) && ev.tags.length){
        const tagsLine = el('div', 'timeline-tags-line');
        ev.tags.forEach(tag => {
          const tagBadge = el('span', 'timeline-badge timeline-badge--tag');
          tagBadge.textContent = tag;
          tagsLine.appendChild(tagBadge);
        });
        content.appendChild(tagsLine);
      }

      // NEW: مصدر + درجة يقين
      const certLabel2 = getCertaintyLabel(ev.certainty);
      if (certLabel2 || ev.source){
        const metaExtra = el('div', 'timeline-meta-extra');
        if (certLabel2){
          const cChip = el('span', 'timeline-certainty-chip');
          cChip.textContent = `درجة اليقين: ${certLabel2}`;
          metaExtra.appendChild(cChip);
        }
        if (ev.source){
          const sChip = el('span', 'timeline-source-chip');
          sChip.textContent = `المصدر: ${ev.source}`;
          metaExtra.appendChild(sChip);
        }
        content.appendChild(metaExtra);
      }


        item.append(marker, content);

      // NEW: عند الضغط على عنصر الخط الزمني → افتح نفس الحدث في وضع القائمة مع تمرير
      item.addEventListener('click', () => {
        // الانتقال إلى وضع القائمة مع الحفاظ على وضع المعاينة
        root.dataset.view = 'list';
        listBtn.classList.add('is-active');
        visBtn.classList.remove('is-active');

        // تمرير القائمة إلى بطاقة الحدث المقابلة بدون فتح وضع التعديل
        const card = listWrap.querySelector(`.event-card[data-event-id="${ev.id}"]`);
        if (card){
          try {
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch(e){
            card.scrollIntoView(true);
          }
        }
      });


      list.appendChild(item);

    });

    timelineWrap.appendChild(list);
  }


  function renderAll(){
    // أولاً: إعادة بناء خيارات الفلتر بناءً على الأحداث الحالية
    rebuildTypeFilterOptions();

    // ثم الرسم حسب الفلتر والترتيب الحاليين
    renderList();
    renderTimelineView();
  }

  function addNewEvent(){
    const guessBirth = (person.bio && person.bio.birthDate) ? person.bio.birthDate : '';
    const ev = normalizeEvent({
      type: 'custom',
      date: guessBirth,
      title: '',
      place: '',
      description: ''
    });

    person.events = person.events || [];
    person.events.push(ev);
    person.events = sortEvents(person.events);

    // فتح الحدث الجديد مباشرة في وضع التعديل (مثل القصص)
    lastEditedEventId = ev.id;
    renderAll();

    // تمرير السّكرول إلى الكرت الجديد وتركيز المؤشر في حقل العنوان أو الوصف
    const card = listWrap.querySelector(`.event-card[data-event-id="${ev.id}"]`);
    if (card){
      try {
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch(e){
        // بعض المتصفحات لا تدعم behavior
        card.scrollIntoView(true);
      }
      const focusTarget =
        card.querySelector('.event-title-input') ||
        card.querySelector('.event-description-input');
      if (focusTarget && typeof focusTarget.focus === 'function'){
        focusTarget.focus();
      }
    }

    showSuccess?.('تمت إضافة حدث جديد. اكتب تفاصيله ثم اضغط "حفظ" لتثبيته.');
  }


  // تبديل أنماط العرض
  listBtn.addEventListener('click', () => {
    root.dataset.view = 'list';
    listBtn.classList.add('is-active');
    visBtn.classList.remove('is-active');
  });

  visBtn.addEventListener('click', () => {
    root.dataset.view = 'timeline';
    visBtn.classList.add('is-active');
    listBtn.classList.remove('is-active');
  });
  typeFilterSelect.addEventListener('change', () => {
    const val = typeFilterSelect.value || 'all';
    currentTypeFilter = val;
    renderAll();
  });

  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'latest' ? 'latest' : 'oldest';
    currentSortMode = mode;
    renderAll();
    showInfo?.(
      mode === 'latest' ? 'تم ترتيب الأحداث من الأحدث إلى الأقدم.'
        : 'تم ترتيب الأحداث من الأقدم إلى الأحدث.'
    );
  });

  addBtn.addEventListener('click', addNewEvent);

  // أول رسم
  renderAll();

  return root;
}
