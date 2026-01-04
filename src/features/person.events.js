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

// ===================================================================
// 1) ثوابت + أدوات مساعدة عامة
// ===================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(v) {
  return !!(v && ISO_DATE_RE.test(String(v)));
}

function nowIso() {
  return new Date().toISOString();
}

function safeStr(v) {
  return String(v ?? '').trim();
}

function splitCommaTags(v) {
  return safeStr(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function shallowArr(v) {
  return Array.isArray(v) ? v.slice() : [];
}

// ===================================================================
// 2) كاش مؤقت لصور الأحداث قبل الحفظ (tmp:...)
//    ملاحظة: على مستوى الملف لأن resolveEventImageUrl خارج createEventsSection
// ===================================================================

const tempEventImagesCache = new Map(); // tmpRef -> { file, url }

function genTmpEventRef() {
  if (window.crypto?.randomUUID) return 'tmp:' + window.crypto.randomUUID();
  return 'tmp:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function addTempEventImage(file) {
  const tmpRef = genTmpEventRef();
  const url = URL.createObjectURL(file);
  tempEventImagesCache.set(tmpRef, { file, url });
  return tmpRef;
}

function revokeTempEventRef(tmpRef) {
  const rec = tempEventImagesCache.get(tmpRef);
  if (rec?.url) {
    try { URL.revokeObjectURL(rec.url); } catch {}
  }
  tempEventImagesCache.delete(tmpRef);
}

function cleanupTmpRefs(refs) {
  for (const r of refs || []) {
    if (String(r || '').startsWith('tmp:')) revokeTempEventRef(String(r));
  }
}

// ===================================================================
// 3) تعريف أنواع الأحداث + ميتاداتا العرض
// ===================================================================

const EVENT_TYPES = [
  { value: 'birth',    label: 'ميلاد',        emoji: '👶' },
  { value: 'marriage', label: 'زواج',         emoji: '💍' },
  { value: 'child',    label: 'إنجاب',        emoji: '🧒' },
  { value: 'move',     label: 'انتقال/هجرة',  emoji: '🚚' },
  { value: 'job',      label: 'عمل/وظيفة',    emoji: '💼' },
  { value: 'hajj',     label: 'حج/عمرة',      emoji: '🕋' },
  { value: 'death',    label: 'وفاة',         emoji: '🕊️' },
  { value: 'custom',   label: 'حدث مخصّص',    emoji: '⭐' }
];

function _getTypeMeta(type) {
  const t = EVENT_TYPES.find(e => e.value === type);
  return t || { value: type || 'custom', label: 'حدث', emoji: '⭐' };
}

function _newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return 'ev_' + Math.random().toString(36).slice(2, 10);
}

/**
 * تطبيع كائن الحدث: ضمان الحقول الأساسية والإضافية (tags/source/certainty)
 * بدون تغيير في المنطق: نفس القيم الافتراضية + نفس قواعد التنظيف.
 */
function normalizeEvent(raw) {
  const r = raw || {};
  const iso = nowIso();

  const id = String(r.id || _newId());
  const type = safeStr(r.type || 'custom') || 'custom';

  const media = Array.isArray(r.media) ? r.media.map(String).map(s => s.trim()).filter(Boolean)
    : [];

  // tags قد تأتي مصفوفة أو نص مفصول بفواصل
  let tagsArr = [];
  if (Array.isArray(r.tags)) tagsArr = r.tags;
  else if (typeof r.tags === 'string') tagsArr = r.tags.split(',');

  const tags = tagsArr
    .map(String)
    .map(t => t.trim())
    .filter(Boolean);

  // درجة اليقين
  let certainty = safeStr(r.certainty || '');
  const allowedCert = ['certain', 'probable', 'approx'];
  if (!allowedCert.includes(certainty)) certainty = '';

  return {
    id,
    type,
    title: safeStr(r.title || ''),
    date: safeStr(r.date || ''),
    place: safeStr(r.place || ''),
    description: safeStr(r.description || ''),
    media,
    pinned: !!r.pinned,
    tags,
    source: safeStr(r.source || ''),
    certainty,
    createdAt: r.createdAt || iso,
    updatedAt: r.updatedAt || iso
  };
}

// ===================================================================
// 4) مساعدات عرض (نصوص/ملصقات/حسابات) — بدون تغيير السلوك
// ===================================================================

function getEventLengthInfo(len) {
  if (!len) return { label: 'بدون تفاصيل', level: 0 };
  if (len <= 280) return { label: 'تفاصيل قصيرة', level: 1 };
  if (len <= 800) return { label: 'تفاصيل متوسطة', level: 2 };
  return { label: 'تفاصيل طويلة', level: 3 };
}

function formatEventCreatedDate(iso) {
  const body = formatFullDateTime(iso);
  if (!body) return '';
  return `أضيف هذا الحدث في ${body}`;
}

function computeApproxAgeAtEvent(birthDate, eventDate) {
  if (!isIsoDate(birthDate) || !isIsoDate(eventDate)) return null;

  const [by, bm, bd] = birthDate.split('-').map(v => parseInt(v, 10));
  const [ey, em, ed] = eventDate.split('-').map(v => parseInt(v, 10));
  if (!by || !ey) return null;

  let age = ey - by;
  if (em < bm || (em === bm && ed < bd)) age -= 1;

  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

function getCertaintyLabel(code) {
  switch (code) {
    case 'certain':  return 'مؤكد';
    case 'probable': return 'مرجَّح';
    case 'approx':   return 'تقريبي';
    default:         return '';
  }
}

/**
 * ترتيب الأحداث زمنيًا:
 * - المؤرَّخ (YYYY-MM-DD) قبل غير المؤرَّخ
 * - داخل ذلك: حسب التاريخ
 * - ثم createdAt كـ fallback
 */
function sortEvents(events) {
  return (events || []).slice().sort((a, b) => {
    const da = isIsoDate(a?.date) ? a.date : null;
    const db = isIsoDate(b?.date) ? b.date : null;

    if (da && db) {
      if (da < db) return -1;
      if (da > db) return 1;
    } else if (da && !db) {
      return -1;
    } else if (!da && db) {
      return 1;
    }

    const ca = a?.createdAt || '';
    const cb = b?.createdAt || '';
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });
}

// ===================================================================
// 5) صور الأحداث عبر IndexedDB (ref داخل event.media => URL صالح للعرض)
// ===================================================================

/**
 * ref المخزّن داخل event.media (مثل: 'idb:event_123' أو 'tmp:...' أو URL مباشر)
 * تُرجع URL صالح للعرض (blob: / data: / http / أو URL من IndexedDB)
 */
async function resolveEventImageUrl(ref) {
  if (!ref) return null;
  const s = String(ref);

  // روابط جاهزة
  if (/^(data:|blob:|https?:)/.test(s)) return s;

  // tmp:... (قبل الحفظ)
  if (s.startsWith('tmp:')) {
    const rec = tempEventImagesCache.get(s);
    return rec?.url || null;
  }

  try {
    // تفضيل دوال الأحداث إن وُجدت
    if (typeof DB?.getEventImageURL === 'function') {
      const url = await DB.getEventImageURL(s);
      if (url) return url;
    }

    // توافق خلفي مع قصص (لو تشارك نفس التخزين)
    if (typeof DB?.getStoryImageURL === 'function') {
      const url = await DB.getStoryImageURL(s);
      if (url) return url;
    }
  } catch (e) {
    console.error('resolveEventImageUrl failed', e);
    return null;
  }

  return s;
}

// عارض الصور المشترك للأحداث
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

/**
 * ترقية صور tmp:... إلى idb:... قبل الحفظ (مع fallback لستور القصص)
 * نفس منطقك تمامًا لكن معزول بدالة لتقليل التكرار.
 */
async function upgradeTmpMediaToIdb({
  mediaRefs,
  personId,
  eventId
}) {
  const current = Array.isArray(mediaRefs) ? mediaRefs : [];
  const hasTmp = current.some(r => String(r || '').startsWith('tmp:'));

  if (!hasTmp) return current.slice();

  // نفس شرطك: إن لم تتوفر دوال التخزين لا نكمل
  if (typeof DB?.putEventImage !== 'function' && typeof DB?.putStoryImage !== 'function') {
    showError?.('ميزة حفظ الصور غير متاحة حالياً (DB.putEventImage غير موجود).');
    return null; // يدل على فشل يمنع الحفظ
  }

  const upgraded = [];

  for (const r of current) {
    const ref = String(r || '');

    if (!ref.startsWith('tmp:')) {
      upgraded.push(ref);
      continue;
    }

    const rec = tempEventImagesCache.get(ref);
    if (!rec?.file) {
      showError?.('تعذّر الوصول لملف إحدى الصور المؤقتة. لم يتم حفظ التعديلات.');
      return null;
    }

    try {
      let idbRef = null;

      // تفضيل مسار الأحداث
      if (typeof DB?.putEventImage === 'function') {
        idbRef = await DB.putEventImage({ file: rec.file, personId, eventId });
      } else if (typeof DB?.putStoryImage === 'function') {
        // fallback لو تشارك نفس ستور القصص
        idbRef = await DB.putStoryImage({ file: rec.file, personId, storyId: eventId });
      }

      if (idbRef) upgraded.push(String(idbRef));
    } catch (e) {
      console.error('Failed to store temp event image', ref, e);
      showError?.('تعذّر حفظ إحدى الصور. لم يتم حفظ التعديلات.');
      return null;
    } finally {
      revokeTempEventRef(ref);
    }
  }

  return upgraded;
}

/**
 * حذف وسائط تمّت إزالتها أثناء التعديل (مؤجل حتى الحفظ)
 * (نفس fallback الموجود عندك في save)
 */
async function deletePendingMediaFromDb(pendingRefs) {
  for (const ref of pendingRefs || []) {
    try {
      if (typeof DB?.deleteEventImage === 'function') {
        await DB.deleteEventImage(ref);
      } else if (typeof DB?.deleteStoryImage === 'function') {
        await DB.deleteStoryImage(ref);
      }
    } catch (e) {
      console.error('Failed to delete event media from DB', ref, e);
    }
  }
}

// ===================================================================
// 6) واجهة القسم: createEventsSection
// ===================================================================

export function createEventsSection(person, handlers = {}) {
  if (!person || typeof person !== 'object') return null;

  // تأمين مصفوفة الأحداث على الشخص
  if (!Array.isArray(person.events)) person.events = [];
  person.events = person.events.map(normalizeEvent);

  // حالة العرض
  let currentTypeFilter = 'all';
  let currentSortMode   = 'oldest'; // افتراضي
  let lastEditedEventId = null;
  let currentSearchQuery = ''; // بحث بعنوان الحدث فقط

  // ----------------------------
  // بناء الهيكل العام للواجهة
  // ----------------------------

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

  const tools = el('div', 'timeline-tools');
  const toolsLeft  = el('div', 'timeline-tools-left');
  const toolsRight = el('div', 'timeline-tools-right');

  // فلتر نوع الحدث
  const typeFilterSelect = el('select', 'timeline-type-filter');
  typeFilterSelect.name = 'events_type_filter';

  // ترتيب الأحداث
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

  // بحث بعنوان الحدث فقط
  const searchWrap = el('div', 'timeline-search-wrap');
  const searchInput = el('input', 'timeline-search-input');
  searchInput.type = 'search';
  searchInput.name = 'timeline-search-input';
  searchInput.placeholder = 'ابحث في عناوين الأحداث…';
  searchInput.addEventListener('input', () => {
    currentSearchQuery = searchInput.value.trim().toLowerCase();
    renderAll();
  });
  searchWrap.append(searchInput);

  // زر إضافة
  const addBtn = el('button', 'timeline-add-btn');
  addBtn.type = 'button';
  addBtn.innerHTML =
    '<i class="fa-solid fa-plus" aria-hidden="true"></i>' +
    '<span>إضافة حدث جديد</span>';

  // تبديل نمط العرض: قائمة / خط زمني
  const viewToggle = el('div', 'timeline-view-toggle');

  const listBtn = el('button', 'timeline-view-btn is-active');
  listBtn.type = 'button';
  listBtn.innerHTML =
    '<i class="fa-solid fa-list" aria-hidden="true"></i>' +
    '<span>عرض قائمة</span>';

  const visBtn = el('button', 'timeline-view-btn');
  visBtn.type = 'button';
  visBtn.innerHTML =
    '<i class="fa-solid fa-timeline" aria-hidden="true"></i>' +
    '<span>عرض خط زمني</span>';

  viewToggle.append(listBtn, visBtn);

  toolsLeft.append(typeFilterSelect, sortSelect, searchWrap);
  toolsRight.append(viewToggle, addBtn);
  tools.append(toolsLeft, toolsRight);

  header.append(titleBlock, tools);

  const listWrap     = el('div', 'events-list');
  const timelineWrap = el('div', 'events-timeline');

  root.append(header, listWrap, timelineWrap);
  root.dataset.view = 'list';

  // ----------------------------
  // إشعار تغيّر البيانات (نفس منطقك)
  // ----------------------------

  function fireUpdateMessage(msg) {
    if (msg && typeof showSuccess === 'function') showSuccess(msg);

    if (handlers && typeof handlers.onEventsChange === 'function') {
      handlers.onEventsChange(person);
    } else if (handlers && typeof handlers.onPersonChange === 'function') {
      handlers.onPersonChange(person);
    }
  }

  function updateEvent(ev, patch) {
    Object.assign(ev, patch, { updatedAt: nowIso() });
  }

  // =================================================================
  // 6.1) بطاقة الحدث (Preview + Edit) — نفس السلوك، أقل تكرار
  // =================================================================

  function createEventCard(ev, index) {
    const personId = person && person._id ? String(person._id) : null;

    // Snapshot أصلي للمقارنة (isDirty) — نفس حقولك
    const original = {
      type: ev.type || 'custom',
      date: ev.date || '',
      title: ev.title || '',
      place: ev.place || '',
      description: ev.description || '',
      media: shallowArr(ev.media),
      pinned: !!ev.pinned,
      tags: shallowArr(ev.tags),
      source: ev.source || '',
      certainty: ev.certainty || ''
    };

    let currentMedia = shallowArr(ev.media);
    let pendingDeletedMedia = [];
    let isEditing =
      ev.id === lastEditedEventId ||
      (!ev.title && !ev.description && !ev.date && !ev.place && (!Array.isArray(ev.media) || ev.media.length === 0));

    let isDirty = false;

    const meta  = _getTypeMeta(ev.type);
    const card  = el('article', 'event-card');
    card.dataset.eventId = ev.id;

    const serial = (index || 0) + 1;

    // ----------------------------
    // شريط علوي: رقم + مميز + زر قفز للخط الزمني
    // ----------------------------

    const topRow = el('div', 'event-card-top timeline-card-top');

    const indexBadge = el('div', 'event-card-index timeline-card-index');
    indexBadge.textContent = `الحدث ${serial}`;
    topRow.appendChild(indexBadge);

    if (ev.pinned) {
      const pinnedBadge = el('div', 'event-pinned-badge timeline-pinned-badge');
      pinnedBadge.textContent = 'حدث مميّز';
      topRow.appendChild(pinnedBadge);
    }

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
      if (item) {
        try { item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        catch (e2) { item.scrollIntoView(true); }
      }
    });

    topRow.appendChild(jumpBtn);
    card.appendChild(topRow);

    // ----------------------------
    // وضع المعاينة (Preview)
    // ----------------------------

    const previewBox  = el('div', 'event-preview');

    const previewMeta = el('div', 'event-preview-meta timeline-preview-meta');
    const createdLabel = el('span', 'event-preview-created timeline-preview-created');
    createdLabel.textContent = ev.createdAt ? formatEventCreatedDate(ev.createdAt) : '';

    const lengthLabel = el('span', 'event-preview-length timeline-length-chip');
    const lenInfo = getEventLengthInfo((ev.description || '').length);
    if (lenInfo.level === 0) {
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

    // بادجات المكان/تاريخ الحدث/نوع الحدث + معلومات إضافية (tags/source/certainty)
    const badgesWrap = el('div', 'event-preview-badges timeline-preview-badges');
    const dateBadgeText = ev.date ? formatShortDateBadge(ev.date) : '';

    let eventDateLine = null;
    if (isIsoDate(ev.date) && dateBadgeText) {
      eventDateLine = textEl('div', `تاريخ الحدث: ${dateBadgeText}`, 'event-preview-eventdate');
    }

    let ageLine = null;
    const birthDate = person?.bio?.birthDate || null;
    const approxAge = computeApproxAgeAtEvent(birthDate, ev.date);
    if (approxAge != null) {
      ageLine = textEl('div', `العمر التقريبي عند الحدث: ${approxAge} سنة`, 'event-preview-age');
    }

    if (ev.place) {
      const placeBadge = el('span', 'timeline-badge timeline-badge--place');
      placeBadge.textContent = ev.place;
      badgesWrap.appendChild(placeBadge);
    }

    if (dateBadgeText) {
      const yearBadge = el('span', 'timeline-badge timeline-badge--year');
      yearBadge.textContent = dateBadgeText;
      badgesWrap.appendChild(yearBadge);
    }

    let typeBadge = null;
    if (meta.label) {
      typeBadge = el('span', 'timeline-badge timeline-badge--type');
      typeBadge.dataset.eventId = ev.id;
      typeBadge.dataset.type = ev.type || 'custom';
      typeBadge.textContent = meta.label;
      badgesWrap.appendChild(typeBadge);
    }

    const extraMetaPreview = el('div', 'event-extra-meta');

    if (Array.isArray(ev.tags) && ev.tags.length) {
      ev.tags.forEach(tag => {
        const tagBadge = el('span', 'timeline-badge timeline-badge--tag');
        tagBadge.textContent = tag;
        extraMetaPreview.appendChild(tagBadge);
      });
    }

    const certLabel = getCertaintyLabel(ev.certainty);
    if (certLabel) {
      const cChip = el('span', 'timeline-certainty-chip');
      cChip.textContent = `درجة اليقين: ${certLabel}`;
      extraMetaPreview.appendChild(cChip);
    }

    if (ev.source) {
      const sChip = el('span', 'timeline-source-chip');
      sChip.textContent = `المصدر: ${ev.source}`;
      extraMetaPreview.appendChild(sChip);
    }

    const previewTitle = textEl('div', ev.title || meta.label, 'event-preview-title timeline-preview-title');

    const previewDesc = textEl(
      'p',
      ev.description || 'لم تتم إضافة تفاصيل لهذا الحدث بعد. يمكنك فتح وضع التعديل لكتابتها.',
      'event-preview-description timeline-preview-text'
    );

    const previewImagesWrap = el('div', 'event-preview-images timeline-preview-images');

    const sliderBtn = el('button', 'event-images-slider-btn timeline-images-slider-btn');
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

        resolveEventImageUrl(ref).then(url => { if (url) imgEl.src = url; });

        const viewBtn = textEl('button', 'معاينة', 'event-media-thumb-view timeline-image-thumb-view');
        viewBtn.type = 'button';
        viewBtn.title = 'معاينة الصورة بحجم أكبر';

        viewBtn.addEventListener('click', e => {
          e.stopPropagation();
          openEventImageSlider(list, idx);
        });

        imgEl.addEventListener('click', () => openEventImageSlider(list, idx));

        thumb.append(imgEl, viewBtn);
        previewImagesWrap.appendChild(thumb);
      });
    }

    renderPreviewImages();

    // ترتيب عناصر المعاينة (نفس ترتيبك)
    const previewChildren = [];
    previewChildren.push(previewTitle);
    if (eventDateLine) previewChildren.push(eventDateLine);
    if (ageLine) previewChildren.push(ageLine);
    previewChildren.push(badgesWrap);
    previewChildren.push(previewDesc);
    previewChildren.push(previewImagesWrap, sliderBtn);
    previewChildren.push(previewMeta);
    if (extraMetaPreview.childNodes.length) previewChildren.push(extraMetaPreview);

    previewBox.append(...previewChildren);
    card.appendChild(previewBox);

    // ----------------------------
    // وضع التعديل (Edit)
    // ----------------------------

    const editBox = el('div', 'event-edit');

    // رأس: عنوان + تاريخ إضافة
    const head = el('div', 'event-head timeline-head');

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

    // صف الميتا: نوع + تاريخ + مكان
    const metaRow = el('div', 'event-meta-row timeline-meta-row');

    const select = document.createElement('select');
    select.className = 'event-type-select';
    select.name = `event_type_${ev.id}`;
    EVENT_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label; // بدون إيموجي
      if (t.value === ev.type) opt.selected = true;
      select.appendChild(opt);
    });

    const typeField = el('div', 'event-meta-field timeline-meta-field');
    const typeLabelBox = el('div', 'event-meta-label timeline-meta-label');
    typeLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الحدث';
    typeField.append(typeLabelBox, select);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'event-date-input';
    dateInput.name = `event_date_${ev.id}`;
    if (isIsoDate(ev.date)) dateInput.value = ev.date;

    const dateField = el('div', 'event-meta-field timeline-meta-field');
    const dateLabelBox = el('div', 'event-meta-label timeline-meta-label');
    dateLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span> تاريخ الحدث';
    dateField.append(dateLabelBox, dateInput);

    const placeInput = document.createElement('input');
    placeInput.type = 'text';
    placeInput.className = 'event-place-input';
    placeInput.name = `event_place_${ev.id}`;
    placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
    placeInput.value = ev.place || '';

    const placeField = el('div', 'event-meta-field timeline-meta-field');
    const placeLabelBox = el('div', 'event-meta-label timeline-meta-label');
    placeLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> المكان';
    placeField.append(placeLabelBox, placeInput);

    metaRow.append(typeField, dateField, placeField);

    const desc = document.createElement('textarea');
    desc.className = 'event-description-input';
    desc.name = `event_description_${ev.id}`;
    desc.rows = 3;
    desc.placeholder = 'تفاصيل الحدث (مثلاً: متى حصل، من حضر، ملاحظات خاصة...)';
    desc.value = ev.description || '';

    // -------- صور الحدث --------
    const mediaWrap = el('div', 'event-media-wrap');
    const emptyHint = el('div', 'event-media-empty-hint');
    const mediaRow2 = el('div', 'event-media-row');
    const thumbs = el('div', 'event-media-thumbs');

    const addLabel = el('label', 'event-media-add-btn timeline-image-add-btn');
    const addIcon  = el('span', 'event-media-add-icon timeline-image-add-icon');
    addIcon.innerHTML = '<i class="fa-solid fa-camera" aria-hidden="true"></i>';
    const addText  = textEl('span', 'إضافة صور للحدث', 'event-media-add-text timeline-image-add-text');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.name = `event_media_${ev.id}`;
    fileInput.style.display = 'none';

    addLabel.append(addIcon, addText, fileInput);
    mediaRow2.appendChild(thumbs);
    mediaWrap.append(emptyHint, mediaRow2, addLabel);

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
        const thumb = el('div', 'timeline-image-thumb event-media-thumb');
        thumb.dataset.ref = ref;

        const imgEl = el('img');
        imgEl.alt = 'صورة مرفقة بالحدث';
        resolveEventImageUrl(ref).then(url => { if (url) imgEl.src = url; });

        const removeBtn = textEl('button', '×', 'event-media-thumb-remove timeline-image-thumb-remove');
        removeBtn.type = 'button';
        removeBtn.title = 'إزالة هذه الصورة';

        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          const ref2 = currentMedia[idx];

          // إذا كانت tmp احذفها فوراً من الكاش
          if (ref2 && String(ref2).startsWith('tmp:')) revokeTempEventRef(String(ref2));

          // إذا كانت idb سجّلها للحذف لاحقًا بعد الحفظ
          if (ref2 && String(ref2).startsWith('idb:')) pendingDeletedMedia.push(ref2);

          currentMedia.splice(idx, 1);
          renderThumbs();
          recomputeDirty();
        });

        const viewBtn = textEl('button', 'معاينة', 'event-media-thumb-view timeline-image-thumb-view');
        viewBtn.type = 'button';
        viewBtn.title = 'معاينة الصورة بحجم أكبر';
        viewBtn.addEventListener('click', e => {
          e.stopPropagation();
          openEventImageSlider(currentMedia, idx);
        });

        imgEl.addEventListener('click', () => openEventImageSlider(currentMedia, idx));

        thumb.append(imgEl, removeBtn, viewBtn);
        thumbs.appendChild(thumb);
      });

      updateAddLabel();
      setupMediaSortable();
    }

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;

      for (const file of files) {
        try {
          const tmpRef = addTempEventImage(file);
          currentMedia.push(tmpRef);
        } catch (e) {
          console.error('failed to add temp event image', e);
          showError?.('تعذّر تجهيز إحدى الصور للمعاينة. حاول مرة أخرى.');
        }
      }

      renderThumbs();
      recomputeDirty();
      fileInput.value = '';
    });

    // -------- تثبيت الحدث --------
    const pinWrap = el('label', 'event-pin-toggle timeline-pin-toggle');
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.name = `event_pinned_${ev.id}`;
    pinCheckbox.checked = original.pinned;
    const pinText = textEl('span', 'تعيين هذا الحدث كمميّز');
    pinWrap.append(pinCheckbox, pinText);

    // -------- صف إضافي: tags + source + certainty --------
    const extraRow = el('div', 'event-extra-row timeline-extra-row');

    const tagsField = el('div', 'event-meta-field timeline-meta-field');
    const tagsLabelBox = el('div', 'event-meta-label timeline-meta-label');
    tagsLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tags" aria-hidden="true"></i></span> وسوم الحدث';
    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.className = 'event-tags-input';
    tagsInput.name = `event_tags_${ev.id}`;
    tagsInput.placeholder = 'مثال: الهجرة، السفر، العمل (مفصولة بفواصل)';
    tagsInput.value = Array.isArray(ev.tags) ? ev.tags.join(', ') : '';
    tagsField.append(tagsLabelBox, tagsInput);

    const sourceField = el('div', 'event-meta-field timeline-meta-field');
    const sourceLabelBox = el('div', 'event-meta-label timeline-meta-label');
    sourceLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-book" aria-hidden="true"></i></span> المرجع / المصدر';
    const sourceInput = document.createElement('input');
    sourceInput.type = 'text';
    sourceInput.className = 'event-source-input';
    sourceInput.name = `event_source_${ev.id}`;
    sourceInput.placeholder = 'مثال: رُوي عن فلان، أو موثّق من بطاقة هوية...';
    sourceInput.value = ev.source || '';
    sourceField.append(sourceLabelBox, sourceInput);

    const certaintyField = el('div', 'event-meta-field timeline-meta-field');
    const certaintyLabelBox = el('div', 'event-meta-label timeline-meta-label');
    certaintyLabelBox.innerHTML =
      '<span class="event-meta-icon timeline-meta-icon"><i class="fa-solid fa-circle-question" aria-hidden="true"></i></span> درجة اليقين';
    const certaintySelect = document.createElement('select');
    certaintySelect.className = 'event-certainty-select';
    certaintySelect.name = `event_certainty_${ev.id}`;
    [
      { value: '',         label: 'غير محددة' },
      { value: 'certain',  label: 'مؤكد' },
      { value: 'probable', label: 'مرجَّح' },
      { value: 'approx',   label: 'تقريبي' }
    ].forEach(optDef => {
      const opt = document.createElement('option');
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      if (optDef.value === (ev.certainty || '')) opt.selected = true;
      certaintySelect.appendChild(opt);
    });
    certaintyField.append(certaintyLabelBox, certaintySelect);

    extraRow.append(tagsField, sourceField, certaintyField);

    body.append(metaRow, desc, extraRow, mediaWrap, pinWrap);
    editBox.appendChild(body);
    card.appendChild(editBox);

    // ----------------------------
    // أزرار القدم (Edit/Save/Close + Cancel + Delete)
    // ----------------------------

    const footer = el('div', 'event-footer');

    const saveBtn = el('button', 'event-save-btn');
    const cancelBtn = el('button', 'event-cancel-btn');
    const delBtn = el('button', 'event-delete-btn');

    saveBtn.type = cancelBtn.type = delBtn.type = 'button';

    cancelBtn.innerHTML =
      '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>' +
      '<span>إلغاء التعديل</span>';
    cancelBtn.style.display = 'none';

    delBtn.innerHTML =
      '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>' +
      '<span>حذف الحدث</span>';

    footer.append(saveBtn, cancelBtn, delBtn);
    card.appendChild(footer);

    // ----------------------------
    // مساعدين داخليين للبطاقة
    // ----------------------------

    function fillEditFromEvent() {
      select.value = ev.type || 'custom';
      if (!Array.from(select.options).some(o => o.value === select.value)) {
        select.value = 'custom';
      }

      dateInput.value = isIsoDate(ev.date) ? ev.date : '';

      titleInput.value = ev.title || '';
      placeInput.value = ev.place || '';
      desc.value = ev.description || '';

      tagsInput.value = Array.isArray(ev.tags) ? ev.tags.join(', ') : '';
      sourceInput.value = ev.source || '';
      certaintySelect.value = ev.certainty || '';

      pinCheckbox.checked = !!ev.pinned;

      currentMedia = shallowArr(ev.media);
      renderThumbs();
      recomputeDirty();
      pendingDeletedMedia = [];
    }

    function updateSaveBtnLabel() {
      if (!isEditing) {
        saveBtn.innerHTML =
          '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>' +
          '<span>تعديل</span>';
      } else if (!isDirty) {
        saveBtn.innerHTML =
          '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
          '<span>إغلاق</span>';
      } else {
        saveBtn.innerHTML =
          '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>' +
          '<span>حفظ</span>';
      }
    }

    function applyMode() {
      card.classList.toggle('event-card--edit', isEditing);
      card.classList.toggle('event-card--preview', !isEditing);
      previewBox.style.display = isEditing ? 'none' : '';
      editBox.style.display = isEditing ? '' : '';
      editBox.style.display = isEditing ? '' : 'none';

      updateSaveBtnLabel();
      cancelBtn.style.display = isEditing && isDirty ? '' : 'none';
    }

    function recomputeDirty() {
      const curType   = safeStr(select.value || 'custom') || 'custom';
      const curDate   = safeStr(dateInput.value || '');
      const curTitle  = titleInput.value.trim();
      const curPlace  = placeInput.value.trim();
      const curDesc   = desc.value.trim();
      const curPinned = !!pinCheckbox.checked;

      const curTags = splitCommaTags(tagsInput.value || '');
      const curSource = sourceInput.value.trim();
      const curCertainty = safeStr(certaintySelect.value || '');

      isDirty =
        curType !== original.type ||
        curDate !== (original.date || '') ||
        curTitle !== original.title ||
        curPlace !== original.place ||
        curDesc !== original.description ||
        curPinned !== original.pinned ||
        !arraysShallowEqual(currentMedia, original.media) ||
        !arraysShallowEqual(curTags, original.tags || []) ||
        curSource !== (original.source || '') ||
        curCertainty !== (original.certainty || '');

      applyMode();
    }

    // أول تهيئة
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

    // ----------------------------
    // زر "تعديل/إغلاق/حفظ" — نفس السيناريوهات
    // ----------------------------

    saveBtn.addEventListener('click', async () => {
      if (!isEditing) {
        fillEditFromEvent();
        isEditing = true;
        applyMode();
        showInfo?.('يمكنك الآن تعديل بيانات الحدث ثم الضغط على "حفظ" لتثبيت التعديلات.');
        return;
      }

      if (isEditing && !isDirty) {
        // إغلاق بدون حفظ: نظّف tmp + ارجع للحالة الأصلية
        cleanupTmpRefs(currentMedia);
        currentMedia = original.media.slice();
        pendingDeletedMedia = [];

        isEditing = false;
        applyMode();
        showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر الحدث.');
        return;
      }

      // ترقية صور tmp -> idb قبل الحفظ (إن وجدت)
      const upgraded = await upgradeTmpMediaToIdb({
        mediaRefs: currentMedia,
        personId,
        eventId: ev.id
      });

      if (upgraded === null) return; // فشل يمنع الحفظ

      currentMedia = upgraded;

      const patch = {
        type: safeStr(select.value || 'custom') || 'custom',
        date: safeStr(dateInput.value || ''),
        title: titleInput.value.trim(),
        place: placeInput.value.trim(),
        description: desc.value.trim(),
        media: currentMedia.slice(),
        pinned: !!pinCheckbox.checked,
        tags: splitCommaTags(tagsInput.value || ''),
        source: sourceInput.value.trim(),
        certainty: safeStr(certaintySelect.value || '')
      };

      // 1) تحديث الحدث
      updateEvent(ev, patch);

      // تحديث معاينة الصور فورًا + تحديث snapshot الأصلي
      renderPreviewImages();

      original.type = ev.type || 'custom';
      original.date = ev.date || '';
      original.title = ev.title || '';
      original.place = ev.place || '';
      original.description = ev.description || '';
      original.media = shallowArr(ev.media);
      original.pinned = !!ev.pinned;
      original.tags = shallowArr(ev.tags);
      original.source = ev.source || '';
      original.certainty = ev.certainty || '';
      isDirty = false;

      // حذف وسائط تمّت إزالتها أثناء التعديل (مؤجّل حتى الحفظ)
      await deletePendingMediaFromDb(pendingDeletedMedia);
      pendingDeletedMedia = [];

      // 2) تحديث بادجات النوع (القائمة + الخط الزمني)
      const newMeta = _getTypeMeta(patch.type);

      if (typeBadge) {
        typeBadge.textContent = newMeta.label;
        typeBadge.dataset.type = patch.type || 'custom';
      }

      document
        .querySelectorAll(`.timeline-badge--type[data-event-id="${ev.id}"]`)
        .forEach(node => {
          node.textContent = newMeta.label;
          node.dataset.type = patch.type || 'custom';
        });

      // إنهاء وضع التعديل
      lastEditedEventId = null;
      isEditing = false;
      applyMode();

      // 3) إعادة ترتيب وإعادة رسم
      person.events = sortEvents(person.events || []);
      renderAll();
      fireUpdateMessage('تم حفظ تعديلات الحدث بنجاح.');
    });

    // ----------------------------
    // إلغاء التعديل — نفس السلوك + تنظيف tmp
    // ----------------------------

    cancelBtn.addEventListener('click', () => {
      if (!isEditing) return;

      select.value = original.type || 'custom';
      if (!Array.from(select.options).some(o => o.value === select.value)) {
        select.value = 'custom';
      }

      dateInput.value = original.date || '';
      titleInput.value = original.title;
      placeInput.value = original.place;
      desc.value = original.description;
      pinCheckbox.checked = original.pinned;

      tagsInput.value = (original.tags || []).join(', ');
      sourceInput.value = original.source || '';
      certaintySelect.value = original.certainty || '';

      cleanupTmpRefs(currentMedia);

      currentMedia = original.media.slice();
      renderThumbs();
      pendingDeletedMedia = [];

      isEditing = false;
      isDirty = false;
      applyMode();

      showInfo?.('تم تجاهل التعديلات والرجوع لآخر نسخة محفوظة من الحدث.');
    });

    // ----------------------------
    // حذف الحدث — نفس السلوك
    // ----------------------------

delBtn.addEventListener('click', async () => {
  const res = await showConfirmModal?.({
    title: 'حذف الحدث',
    message: 'هل تريد بالتأكيد حذف هذا الحدث؟ لا يمكن التراجع عن هذا الإجراء.',
    variant: 'danger',
    confirmText: 'حذف',
    cancelText: 'إلغاء'
  });

  if (res !== 'confirm') {
    showInfo?.('تم إلغاء حذف الحدث.');
    return;
  }

  // تنظيف tmp قبل الحذف
  cleanupTmpRefs(currentMedia);

  // احذف كل وسائط الحدث (إن كانت idb) ثم احذف الحدث من البيانات
  const refs = Array.isArray(ev.media) ? ev.media : [];
  for (const ref of refs) {
    if (!String(ref).startsWith('idb:')) continue;
    try {
      await DB?.deleteEventImage?.(ref);
    } catch (e) {
      console.error('deleteEventImage failed', ref, e);
    }
  }

  person.events = (person.events || []).filter(e => e.id !== ev.id);
  renderAll();
  fireUpdateMessage('تم حذف الحدث من الخط الزمني.');
});

    return card;
  }

  // =================================================================
  // 6.2) الفلاتر/الفرز/البحث + الرسم (List/Timeline)
  // =================================================================

  function rebuildTypeFilterOptions() {
    const events = person.events || [];
    const usedTypesSet = new Set();

    for (const ev of events) {
      const t = safeStr(ev?.type || 'custom') || 'custom';
      usedTypesSet.add(t);
    }

    const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';

    typeFilterSelect.innerHTML = '';

    const optAll = el('option');
    optAll.value = 'all';
    optAll.textContent = 'كل الأنواع';
    typeFilterSelect.appendChild(optAll);

    // ترتيب الأنواع بحسب EVENT_TYPES ثم أبجديًا للباقي
    const order = Object.fromEntries(EVENT_TYPES.map((t, i) => [t.value, i]));

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
      opt.value = meta.value;
      opt.textContent = meta.label;
      typeFilterSelect.appendChild(opt);
    });

    const canKeepPrev =
      prevValue && prevValue !== 'all' && usedTypes.includes(prevValue);

    const nextValue = canKeepPrev ? prevValue : 'all';
    typeFilterSelect.value = nextValue;
    currentTypeFilter = nextValue;
  }

  function getFilteredSortedEvents() {
    let events = sortEvents(person.events || []);

    if (currentSortMode === 'latest') events = events.slice().reverse();

    if (currentTypeFilter && currentTypeFilter !== 'all') {
      events = events.filter(ev => (ev.type || 'custom') === currentTypeFilter);
    }

    if (currentSearchQuery) {
      events = events.filter(ev =>
        String(ev.title || '').toLowerCase().includes(currentSearchQuery)
      );
    }

    return events;
  }

  function renderList() {
    listWrap.innerHTML = '';

    const allEvents = person.events || [];
    const events = getFilteredSortedEvents();

    if (!events.length) {
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

  function renderTimelineView() {
    timelineWrap.innerHTML = '';

    const events = getFilteredSortedEvents();
    if (!events.length) {
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

      const hasIso = isIsoDate(ev.date);
      const year = hasIso ? ev.date.slice(0, 4) : 'غير مؤرَّخ';
      const dateBadgeText = ev.date ? formatShortDateBadge(ev.date) : '';

      if (year !== lastYear) {
        const yearItem = el('li', 'timeline-year-separator');
        yearItem.textContent =
          (year === 'غير مؤرَّخ') ? 'أحداث بدون سنة محددة' : `سنة ${year}`;
        list.appendChild(yearItem);
        lastYear = year;
      }

      const item = el('li', 'timeline-item');
      item.dataset.eventId = ev.id;
      item.dataset.type = ev.type || 'custom';
      if (ev.pinned) item.classList.add('is-pinned');

      const marker = el('div', 'timeline-marker');
      const markerIcon = el('span', 'timeline-marker-emoji');
      markerIcon.textContent = meta.emoji || '⭐';
      marker.appendChild(markerIcon);

      const content = el('div', 'timeline-content');

      const dateLabel = textEl('div', dateBadgeText || 'بدون تاريخ محدّد', 'timeline-date');

      const titleText = ev.title || meta.label;
      const titleRow  = el('div', 'timeline-title-row');

      const iconSpan = el('span', 'timeline-title-icon');
      const iconEmoji = el('span', 'timeline-title-emoji');
      iconEmoji.textContent = meta.emoji || '⭐';
      iconSpan.appendChild(iconEmoji);

      const titleSpan = textEl('span', titleText, 'timeline-title');

      titleRow.append(iconSpan, titleSpan);

      // بادج نوع الحدث داخل عنصر الخط الزمني (فقط إذا كان هناك عنوان مخصّص)
      if (ev.title) {
        const typeBadge = el('span', 'timeline-badge timeline-badge--type');
        typeBadge.dataset.eventId = ev.id;
        typeBadge.dataset.type = ev.type || 'custom';
        typeBadge.textContent = meta.label;
        titleRow.appendChild(typeBadge);
      }

      content.append(dateLabel, titleRow);

      const approxAge = computeApproxAgeAtEvent(birthDate, ev.date);
      if (approxAge != null) {
        const ageEl = textEl('div', `العمر التقريبي عند الحدث: ${approxAge} سنة`, 'timeline-age');
        content.appendChild(ageEl);
      }

      if (ev.place) {
        const place = textEl('div', `المكان: ${ev.place}`, 'timeline-place');
        content.appendChild(place);
      }

      if (ev.description) {
        const maxLen = 200;
        let text = ev.description;
        let hint = '';
        if (text.length > maxLen) {
          text = text.slice(0, maxLen).trim();
          hint = '… (التفاصيل الكاملة من عرض القائمة).';
        }
        const desc = textEl('p', text + hint, 'timeline-description');
        content.appendChild(desc);
      }

      if (ev.media && ev.media.length) {
        const mWrap = el('div', 'timeline-media');

        ev.media.forEach((ref, idx) => {
          const thumb = el('div', 'timeline-image-thumb');
          const imgEl = el('img');
          imgEl.alt = 'صورة الحدث';

          resolveEventImageUrl(ref).then(url => { if (url) imgEl.src = url; });

          thumb.addEventListener('click', e => {
            e.stopPropagation();
            openEventImageSlider(ev.media, idx);
          });

          thumb.appendChild(imgEl);
          mWrap.appendChild(thumb);
        });

        content.appendChild(mWrap);
      }

      // وسوم الحدث
      if (Array.isArray(ev.tags) && ev.tags.length) {
        const tagsLine = el('div', 'timeline-tags-line');
        ev.tags.forEach(tag => {
          const tagBadge = el('span', 'timeline-badge timeline-badge--tag');
          tagBadge.textContent = tag;
          tagsLine.appendChild(tagBadge);
        });
        content.appendChild(tagsLine);
      }

      // مصدر + درجة يقين
      const certLabel2 = getCertaintyLabel(ev.certainty);
      if (certLabel2 || ev.source) {
        const metaExtra = el('div', 'timeline-meta-extra');

        if (certLabel2) {
          const cChip = el('span', 'timeline-certainty-chip');
          cChip.textContent = `درجة اليقين: ${certLabel2}`;
          metaExtra.appendChild(cChip);
        }

        if (ev.source) {
          const sChip = el('span', 'timeline-source-chip');
          sChip.textContent = `المصدر: ${ev.source}`;
          metaExtra.appendChild(sChip);
        }

        content.appendChild(metaExtra);
      }

      item.append(marker, content);

      // ضغط عنصر الخط الزمني => انتقال للقائمة وتمرير للبطاقة
      item.addEventListener('click', () => {
        root.dataset.view = 'list';
        listBtn.classList.add('is-active');
        visBtn.classList.remove('is-active');

        const card = listWrap.querySelector(`.event-card[data-event-id="${ev.id}"]`);
        if (card) {
          try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
          catch (e2) { card.scrollIntoView(true); }
        }
      });

      list.appendChild(item);
    });

    timelineWrap.appendChild(list);
  }

  function renderAll() {
    rebuildTypeFilterOptions();
    renderList();
    renderTimelineView();
  }

  // =================================================================
  // 6.3) إضافة حدث جديد (نفس السلوك)
  // =================================================================

  function addNewEvent() {
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

    lastEditedEventId = ev.id;
    renderAll();

    const card = listWrap.querySelector(`.event-card[data-event-id="${ev.id}"]`);
    if (card) {
      try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      catch (e) { card.scrollIntoView(true); }

      const focusTarget =
        card.querySelector('.event-title-input') ||
        card.querySelector('.event-description-input');

      if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    }

    showSuccess?.('تمت إضافة حدث جديد. اكتب تفاصيله ثم اضغط "حفظ" لتثبيته.');
  }

  // =================================================================
  // 6.4) ربط أحداث الواجهة (View/Filter/Sort/Add) — نفس السلوك
  // =================================================================

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
    currentTypeFilter = typeFilterSelect.value || 'all';
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
