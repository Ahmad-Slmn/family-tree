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
import {
  createSectionTempAndResolver,
  safeStr,
  createTypeHelpers,
  nowIso,
  shallowArr,
  openResolvedSlider,
  isEmptyRecordByKeys,
  createFiltersCollapseController,
  formatCreatedAtLabel,
  getTextLengthInfo,
  isTmpRef,
  isIdbRef,
  upgradeTmpRefs,
  applyCardEditMode,
  splitCommaTags,
  withFieldHead
} from '../features/bio-sections.utils.js';

import {
  attachYearModeToggle,
  getLogicalDateValue,
  setYearToggleValue
} from '../ui/modal.yearToggle.js';

// ===================================================================
// tmp cache + resolver للأحداث (بديل الكاش اليدوي)
// ضع بعد imports مباشرة
// ===================================================================

const eventSectionTmp = createSectionTempAndResolver({
  prefix: 'tmp:',
  getIdbUrl: (ref) => DB?.getEventImageURL?.(ref) || DB?.getStoryImageURL?.(ref)
});

const addTempEventImage = (file, meta = null) => eventSectionTmp.addTemp(file, meta);
const revokeTempEventRef = (ref) => eventSectionTmp.revokeTemp(ref);
const resolveEventImageUrl = eventSectionTmp.resolve;

// لو تبغى cleanup مثل السابق:
const cleanupTmpRefs = (refs) => eventSectionTmp.cleanupTmp(refs);

// ===================================================================
// 1) ثوابت + أدوات مساعدة عامة
// ===================================================================

const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_ONLY_RE = /^\d{4}$/;

function isIsoDate(v) {
  return !!(v && ISO_DATE_RE.test(String(v)));
}

function isYearOnly(v) {
  return !!(v && YEAR_ONLY_RE.test(String(v)));
}

// يعتبر التاريخ “مؤرّخ” إذا كان YYYY-MM-DD أو YYYY
function isDatedValue(v) {
  return isIsoDate(v) || isYearOnly(v);
}

// مفتاح فرز زمني: YYYY => 01-01 من نفس السنة (مناسب للعرض/الفرز)
function toTimeForEventDate(v) {
  const s = String(v || '').trim();
  if (!s) return NaN;

  if (isIsoDate(s)) {
    const t = new Date(s + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  if (isYearOnly(s)) {
    const y = Number(s);
    if (!Number.isFinite(y)) return NaN;
    return new Date(y, 0, 1, 0, 0, 0, 0).getTime();
  }

  return NaN;
}


// ===================================================================
// 3) تعريف أنواع الأحداث + ميتاداتا العرض
// ===================================================================
// ===================================================================
// ✅ Generic Link Engine (Events <-> Any Section)
// ===================================================================

export function normalizeEventLink({
  sectionId,
  itemId,
  edge = '',
  key = ''
} = {}) {
const relatedSectionId = safeStr(sectionId || '');
const relatedItemId = safeStr(itemId || '');
const relatedEdge = safeStr(edge || '');
const relatedKey = safeStr(key || '');

  if (!relatedSectionId || !relatedItemId) {
    return { relatedSectionId: '', relatedItemId: '', relatedEdge: '', relatedKey: '' };
  }

  return { relatedSectionId, relatedItemId, relatedEdge, relatedKey };
}

/**
 * يرجع حالة الربط (enabled) + edges الموجودة لعنصر داخل قسم.
 * fallbackMatcher: يلتقط الربط القديم (مثل relatedCareerId/Edge) أو أي شكل قديم.
 */
export function getLinkedEventEdges(personOrEvents, sectionId, itemId, fallbackMatcher = null) {
  const events = Array.isArray(personOrEvents?.events) ? personOrEvents.events
    : Array.isArray(personOrEvents) ? personOrEvents : [];

const sid = safeStr(sectionId || '');
const iid = safeStr(itemId || '');
  const edges = new Set();

  for (const rawEv of events) {
    if (!rawEv) continue;

    const ev = normalizeEvent(rawEv);

const rs = safeStr(ev.relatedSectionId || '');
const ri = safeStr(ev.relatedItemId || '');
const re = safeStr(ev.relatedEdge || '');
    
    const isMatch =
      (rs && ri && rs === sid && ri === iid) ||
      (typeof fallbackMatcher === 'function' ? !!fallbackMatcher(ev, sid, iid) : false);

    if (!isMatch) continue;

    if (re) edges.add(re);
    else edges.add('linked');
  }

  return { enabled: edges.size > 0, edges };
}

/**
 * upsertSectionEvents:
 * - يحذف القديم (حسب الربط العام + fallback)
 * - يضيف الجديد إذا enabled
 * - يحدث person.events
 * - ينادي handlers.onEventsChange
 */
export function upsertSectionEvents(
  person,
  handlers,
  {
    sectionId,
    item,
    enabled,
    prevDates = null,
    makeEvents,
    fallbackMatcher = null
  } = {}
) {
  if (!person || typeof person !== 'object') return;

const sid = safeStr(sectionId || '');
  const iid = safeStr(item?.id || item?.itemId || '');
  if (!sid || !iid) return;

  if (!Array.isArray(person.events)) person.events = [];
  person.events = person.events.map(normalizeEvent);

  const prev = Array.isArray(person.events) ? person.events.slice() : [];

  // 1) remove old linked events (generic + fallback)
  const kept = [];

  // ✅ حارس: لا تحذف “يدوي” بالخطأ عند fallback
  function isLikelyLegacyAuto(ev2) {
    // شرط أمان: legacy غالبًا بدون تخصيصات (بدون pin/tags/source/certainty/media)
    const tags = Array.isArray(ev2?.tags) ? ev2.tags : [];
    const media = Array.isArray(ev2?.media) ? ev2.media : [];
const source = safeStr(ev2?.source || '');
const certainty = safeStr(ev2?.certainty || '');

    const pinned = !!ev2?.pinned;

    // ✅ لو كان المستخدم عدّل/ثبّت/أضاف وسوم/مصدر/وسائط => اعتبره يدوي ولا تحذفه
    if (pinned) return false;
    if (tags.length) return false;
    if (media.length) return false;
    if (source) return false;
    if (certainty) return false;

    return true;
  }

  for (const ev of prev) {
    const rs = safeStr(ev.relatedSectionId || '');
    const ri = safeStr(ev.relatedItemId || '');
    const rk = safeStr(ev.relatedKey || '');

    const legacyCareerId = safeStr(ev.relatedCareerId || '');
    const legacyCareerEdge = safeStr(ev.relatedCareerEdge || '');

    const isGenericMatch = (rs === sid && ri === iid);

    // fallbackMatcher يُستخدم فقط للـ legacy/القديم (إن وجد)
    const isFallbackMatch =
      typeof fallbackMatcher === 'function' ? !!fallbackMatcher(ev, sid, iid, prevDates)
        : false;

    // ✅ لا نحذف إلا الأحداث المولّدة (المعلّمة)
    const isAutoGenerated = (rk === 'auto');

    // ✅ حذف آمن:
    // 1) احذف auto المرتبط مباشرةً بالـ section/item
    // 2) احذف legacy فقط إذا كان “يبدو مولّد/قديم” (غير مخصص يدويًا)
    //    وهذا يشمل: legacyCareerId/Edge أو “شكل قديم جدًا” يلتقطه fallback
    const shouldRemove =
      (isGenericMatch && isAutoGenerated) ||
      (isFallbackMatch && isLikelyLegacyAuto(ev) && (!rk || rk === 'auto' || legacyCareerId || legacyCareerEdge));

    if (shouldRemove) continue;

    kept.push(ev);
  }



  // 2) add new if enabled
  let next = kept;

  if (enabled) {
    const made = (typeof makeEvents === 'function') ? (makeEvents(item) || []) : [];
    const normalizedNew = made.map(normalizeEvent);
    next = next.concat(normalizedNew);
  }

  // 3) sort + commit
  person.events = sortEvents(next);

  // 4) notify
  if (handlers && typeof handlers.onEventsChange === 'function') {
    handlers.onEventsChange(person);
  } else if (handlers && typeof handlers.onPersonChange === 'function') {
    handlers.onPersonChange(person);
  }
}

const EVENT_TYPES = [
  { value: 'birth',    label: 'ميلاد',        emoji: '👶' },
  { value: 'marriage', label: 'زواج',         emoji: '💍' },
  { value: 'child',    label: 'إنجاب',        emoji: '🧒' },
  { value: 'move',     label: 'انتقال/هجرة',  emoji: '🚚' },
  { value: 'job',      label: 'عمل/وظيفة',    emoji: '💼' },
  { value: 'education', label: 'تعليم', emoji: '🎓' },
  { value: 'hajj',     label: 'حج/عمرة',      emoji: '🕋' },
  { value: 'death',    label: 'وفاة',         emoji: '🕊️' },
  { value: 'custom',   label: 'حدث مخصّص',    emoji: '⭐' }
];

const EVENT_TYPE_LABELS = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.label]));
const EVENT_TYPE_OPTIONS = [
 ['all', '🗂️ كل الأنواع'],
  ...EVENT_TYPES.map(t => [t.value, `${t.emoji} ${t.label}`])
];

const eventType = createTypeHelpers({

  labels: EVENT_TYPE_LABELS,
  options: EVENT_TYPE_OPTIONS,
  allValue: 'all',
  allLabel: 'كل الأنواع'
});

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
  // ✅ Generic link fields
const relatedSectionId = safeStr(r.relatedSectionId || '');
  const relatedItemId    = safeStr(r.relatedItemId || '');
  const relatedEdge      = safeStr(r.relatedEdge || '');
  const relatedKey       = safeStr(r.relatedKey || '');

  // ✅ Backward compatibility (career القديم)
  const legacyCareerId   = safeStr(r.relatedCareerId || '');
  const legacyCareerEdge = safeStr(r.relatedCareerEdge || '');

  const finalSectionId = relatedSectionId || (legacyCareerId ? 'career' : '');
  const finalItemId    = relatedItemId    || legacyCareerId;
  const finalEdge      = relatedEdge      || legacyCareerEdge;

  const description = safeStr(r.description || '') || safeStr(r.note || '');
const sourceIds = Array.isArray(r.sourceIds) ? r.sourceIds.map(String).map(s => s.trim()).filter(Boolean) : [];

  return {
    id,
    type,
title: safeStr(r.title || ''),
date: safeStr(r.date || ''),
place: safeStr(r.place || ''),
    description,
    // ✅ Generic link
    relatedSectionId: finalSectionId || '',
    relatedItemId:    finalItemId || '',
    relatedEdge:      finalEdge || '',
    relatedKey:       relatedKey || '',

    // ✅ Keep legacy fields (optional but مفيد لحين تنظيف البيانات القديمة)
    relatedCareerId: legacyCareerId || '',
    relatedCareerEdge: legacyCareerEdge || '',

    media,
    pinned: !!r.pinned,
 tags,
sourceIds,
source: safeStr(r.source || ''),
certainty,

    createdAt: r.createdAt || iso,
    updatedAt: r.updatedAt || iso
  };
}

// ===================================================================
// 4) مساعدات عرض (نصوص/ملصقات/حسابات) — بدون تغيير السلوك
// ===================================================================

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

function formatEventDateBadge(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (isYearOnly(s)) return s;                 // سنة فقط
  if (isIsoDate(s)) return formatShortDateBadge(s);
  return s;                                    // fallback لأي قيمة غير قياسية
}

/**
 * ترتيب الأحداث زمنيًا:
 * - المؤرَّخ (YYYY-MM-DD) قبل غير المؤرَّخ
 * - داخل ذلك: حسب التاريخ
 * - ثم createdAt كـ fallback
 */
function sortEvents(events) {
  return (events || []).slice().sort((a, b) => {
    const aDated = isDatedValue(a?.date);
    const bDated = isDatedValue(b?.date);

    // المؤرّخ قبل غير المؤرّخ
    if (aDated && !bDated) return -1;
    if (!aDated && bDated) return 1;

    // الاثنين مؤرّخين => فرز بالوقت
    if (aDated && bDated) {
      const ta = toTimeForEventDate(a?.date);
      const tb = toTimeForEventDate(b?.date);
      if (Number.isFinite(ta) && Number.isFinite(tb)) {
        if (ta < tb) return -1;
        if (ta > tb) return 1;

        // نفس السنة/اليوم: اعرض YYYY-MM-DD قبل YYYY داخل نفس السنة (اختياري لكنه منطقي)
        const aIso = isIsoDate(a?.date);
        const bIso = isIsoDate(b?.date);
        if (aIso && !bIso) return -1;
        if (!aIso && bIso) return 1;
      }
    }

    // fallback: createdAt
    const ca = a?.createdAt || '';
    const cb = b?.createdAt || '';
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });
}


// ===================================================================
// 5) صور الأحداث (عارض + سلايدر) — عبر resolver المشترك
// ===================================================================

// عارض الصور المشترك للأحداث
const eventImageViewer = createImageViewerOverlay();

async function openEventImageSlider(refs, startIndex = 0) {
return openResolvedSlider({
    viewer: eventImageViewer,
    refs,
    startIndex,
    resolveUrl: resolveEventImageUrl
  });
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

function getSectionJumpMeta(sectionId) {
const sid = safeStr(sectionId || '');

  if (sid === 'career') {
    return {
      label: 'فتح الوظيفة',
      title: 'الانتقال إلى الوظيفة المرتبطة داخل قسم المسار الوظيفي'
    };
  }

  if (sid === 'education') {
    return {
      label: 'فتح التعليم',
      title: 'الانتقال إلى عنصر التعليم المرتبط داخل قسم التعليم'
    };
  }

    if (sid === 'stories') {
    return {
      label: 'فتح القصة',
      title: 'الانتقال إلى القصة المرتبطة داخل قسم القصص'
    };
  }

  return {
    label: 'فتح القسم',
    title: 'الانتقال إلى العنصر المرتبط داخل القسم'
  };
}

function patchEventTypeSelectEmojis(selectEl) {
  if (!selectEl) return;

  const map = new Map(EVENT_TYPES.map(t => [t.value, `${t.emoji} ${t.label}`]));

  Array.from(selectEl.options).forEach(opt => {
    const v = String(opt.value || '');
    if (v === 'all') {
      // لا تغيّرها إذا عندك نص خاص
      opt.textContent = opt.textContent.includes('🗂️') ? opt.textContent : `🗂️ ${opt.textContent}`.trim();
      return;
    }

    const full = map.get(v);
    if (!full) return;

    // ✅ اكتب النص بالرمز (حتى لو rebuild مسحه)
    opt.textContent = full;
  });
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
let currentSortMode   = 'latest'; // افتراضي
  let lastEditedEventId = null;
  let currentSearchQuery = ''; // بحث بعنوان الحدث فقط
  let __navSourceFilter = '';
// ✅ فلاتر إضافية: الحالة + درجة اليقين
let currentStatusFilter = 'all';    // all | pinned | unpinned
let currentCertaintyFilter = 'all'; // all | '' | certain | probable | approx
// ✅ Persist filters state (type/status/certainty/sort/search/navSource) across reload
const EVENTS_FILTERS_STATE_KEY = 'biosec:events:filtersState';

function readEventsFiltersState() {
  try {
    const raw = localStorage.getItem(EVENTS_FILTERS_STATE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch {
    return null;
  }
}

function writeEventsFiltersState(state) {
  try {
    localStorage.setItem(EVENTS_FILTERS_STATE_KEY, JSON.stringify(state || {}));
  } catch { /* ignore */ }
}

function persistEventsFiltersState() {
  writeEventsFiltersState({
    type: (currentTypeFilter || 'all'),
    status: (currentStatusFilter || 'all'),
    certainty: (currentCertaintyFilter ?? 'all'), // قد تكون '' مسموحة
sort: (currentSortMode || 'latest'),
    search: (currentSearchQuery || '').trim(),
    navSource: (__navSourceFilter || '').trim()
  });
}

function clearEventsFiltersState() {
  try { localStorage.removeItem(EVENTS_FILTERS_STATE_KEY); } catch { /* ignore */ }
}

    // ===============================
  // ✅ Draft + Empty record helpers (Events)
  // ===============================

  const EVENT_EMPTY_KEYS = [
    'title',
    'date',
    'place',
    'description',
    'media',
    'tags',
    'source',
    'certainty',
    'sourceIds'
  ];

  function isEmptyEventRecord(rec) {
return isEmptyRecordByKeys(rec, EVENT_EMPTY_KEYS);
  }

  // UI-only: tracks "new draft" records without touching the data model
  const draftNewMap = new Map(); // eventId -> true

  // ----------------------------
  // بناء الهيكل العام للواجهة
  // ----------------------------

  const root = el('section', 'bio-section bio-section-timeline');
  const header = el('div', 'biosec-header timeline-header');

  const titleBlock = el('div', 'timeline-title-block');
  const title = el('h3', 'biosec-section-title timeline-title');
  title.innerHTML =
    '<i class="fa-solid fa-timeline" aria-hidden="true"></i>' +
    '<span>الخطّ الزمني للأحداث</span>';

  const helper = textEl(
    'p',
    'حوِّل محطات الحياة إلى قصة واضحة: وثِّق الميلاد والدراسة والزواج والعمل والانتقالات وغيرها، ثم اعرضها كقائمة أو خط زمني أنيق يكشف تطوّر السنين ويلهم على إضافة مزيد من اللحظات المميّزة.',
    'biosec-meta timeline-helper-text'
  );

  titleBlock.append(title, helper);

  const tools = el('div', 'biosec-tools timeline-tools');
  const toolsLeft  = el('div', 'biosec-tools-left timeline-tools-left');
  const toolsRight = el('div', 'biosec-tools-right timeline-tools-right');
// زر إظهار/إخفاء الفلاتر (يتحكم في toolsLeft)
const filtersToggleBtn = el('button', 'biosec-tools-btn biosec-add-btn timeline-filters-toggle');
filtersToggleBtn.type = 'button';
filtersToggleBtn.title = 'إظهار/إخفاء الفلاتر';
filtersToggleBtn.setAttribute('aria-pressed', 'false');
// ✅ زر إعادة ضبط الفلاتر (داخل toolsLeft) — يظهر فقط عند وجود فلاتر مفعّلة
const resetFiltersBtn = el('button', 'biosec-tools-btn biosec-btn biosec-filters-reset timeline-filters-reset');
resetFiltersBtn.type = 'button';
resetFiltersBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>إعادة ضبط الفلاتر</span>';
resetFiltersBtn.title = 'إعادة ضبط الفلاتر للوضع الافتراضي';
resetFiltersBtn.style.display = 'none';

    function wrapToolsLeftItem({ title = '', icon = '', child, extraClass = '' } = {}) {
    const wrap = el('div', 'biosec-tools-field timeline-tools-field' + (extraClass ? ` ${extraClass}` : ''));
    const label = el('div', 'biosec-tool-label timeline-tool-label');

    label.innerHTML =
      `<span class="biosec-meta-icon timeline-tools-icon">${icon}</span> ${safeStr(title)}`;

    wrap.append(label, child);
    return wrap;
  }

  // فلتر نوع الحدث
  const typeFilterSelect = el('select', 'biosec-type-filter timeline-type-filter');
  typeFilterSelect.name = 'events_type_filter';
  eventType.fillSelect(typeFilterSelect);
  typeFilterSelect.value = 'all';

  // ترتيب الأحداث
  const sortSelect = el('select', 'biosec-sort timeline-sort');
  sortSelect.name = 'events_sort';
  {
    const optLatest = el('option');
    optLatest.value = 'latest';
    optLatest.textContent = 'الأحدث أولاً';

    const optOldest = el('option');
    optOldest.value = 'oldest';
    optOldest.textContent = 'الأقدم أولاً';

sortSelect.append(optLatest, optOldest);
sortSelect.value = 'latest';

  }

  // ✅ فلتر: الحالة (الكل / مميز / غير مميز)
const statusFilterSelect = el('select', 'biosec-select timeline-status-filter');
statusFilterSelect.name = 'events_status_filter';
[
  { value: 'all',      label: 'الكل' },
  { value: 'pinned',   label: 'مميز' },
  { value: 'unpinned', label: 'غير مميز' }
].forEach(optDef => {
  const opt = el('option');
  opt.value = optDef.value;
  opt.textContent = optDef.label;
  statusFilterSelect.appendChild(opt);
});
statusFilterSelect.value = 'all';

// ✅ فلتر: درجة اليقين (نفس وضع التعديل)
const certaintyFilterSelect = el('select', 'biosec-select timeline-certainty-filter');
certaintyFilterSelect.name = 'events_certainty_filter';
[
  { value: 'all',      label: 'كل الدرجات' },
  { value: '',         label: 'غير محددة' },
  { value: 'certain',  label: 'مؤكد' },
  { value: 'probable', label: 'مرجَّح' },
  { value: 'approx',   label: 'تقريبي' }
].forEach(optDef => {
  const opt = el('option');
  opt.value = optDef.value;
  opt.textContent = optDef.label;
  if (optDef.value === ('')) {
    // لا شيء هنا—نتركه عادي (value='') مسموح
  }
  certaintyFilterSelect.appendChild(opt);
});
certaintyFilterSelect.value = 'all';

  // بحث بعنوان الحدث فقط
  const searchWrap = el('div', 'biosec-search-wrap timeline-search-wrap');
  const searchInput = el('input', 'biosec-search-input timeline-search-input');

  searchInput.type = 'search';
  searchInput.name = 'events_search';
  searchInput.placeholder = 'ابحث في عناوين الأحداث…';
searchInput.addEventListener('input', () => {
  const raw = searchInput.value || '';
  currentSearchQuery = raw.trim().toLowerCase();

  // ✅ أظهر/أخف زر المسح حسب وجود نص
  clearSearchBtn.style.display = raw.trim() ? '' : 'none';
persistEventsFiltersState();
  renderAll();
});

  // ✅ زر مسح البحث (يظهر فقط عند وجود نص)
const clearSearchBtn = el('button', 'biosec-search-clear timeline-search-clear');
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
persistEventsFiltersState();
  renderAll();
  searchInput.focus();
});

searchWrap.append(searchInput, clearSearchBtn);
// ✅ Restore filters state on load
{
  const st = readEventsFiltersState();
  if (st) {
    // type
    if (typeof st.type === 'string') {
      const v = st.type || 'all';
      typeFilterSelect.value = v;
      currentTypeFilter = typeFilterSelect.value || 'all';
    }

    // status
    if (typeof st.status === 'string') {
      const v = st.status || 'all';
      statusFilterSelect.value = v;
      currentStatusFilter = statusFilterSelect.value || 'all';
    }

    // certainty (قد تكون '' أو 'all')
    if (typeof st.certainty === 'string') {
      const v = st.certainty;
      certaintyFilterSelect.value = v;
      currentCertaintyFilter = (certaintyFilterSelect.value ?? 'all');
    }

    // sort
    if (typeof st.sort === 'string') {
      const v = (st.sort === 'latest') ? 'latest' : 'oldest';
      sortSelect.value = v;
      currentSortMode = v;
    }

    // search (نحفظه كنص lower-case مثل الموجود عندك)
    if (typeof st.search === 'string') {
      const raw = st.search || '';
      // لو مخزن lowercase جاهز ممتاز، ولو لا نطبع نفس سلوك input
      searchInput.value = raw;
      currentSearchQuery = raw.trim().toLowerCase();
      clearSearchBtn.style.display = raw.trim() ? '' : 'none';
    }

    // nav source filter
    if (typeof st.navSource === 'string') {
      __navSourceFilter = (st.navSource || '').trim();
    }
  }
}

  // زر إضافة
  const addBtn = el('button', 'biosec-add-btn timeline-add-btn');
  addBtn.type = 'button';
  addBtn.innerHTML =
    '<i class="fa-solid fa-plus" aria-hidden="true"></i>' +
    '<span>إضافة حدث جديد</span>';
searchWrap.classList.add('timeline-search-wrap--bare');

  // تبديل نمط العرض: قائمة / خط زمني
  const viewToggleWrap = el('div', 'biosec-tools-field timeline-tools-field timeline-tools-field--view');

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

  viewToggleWrap.append(viewToggle);

toolsLeft.append(
  // 1) نوع الحدث
  wrapToolsLeftItem({
    title: 'نوع الحدث',
    icon: '<i class="fa-solid fa-filter" aria-hidden="true"></i>',
    child: typeFilterSelect,
    extraClass: 'timeline-tools-field--type'
  }),

  // 2) الترتيب
  wrapToolsLeftItem({
    title: 'الترتيب',
    icon: '<i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>',
    child: sortSelect,
    extraClass: 'timeline-tools-field--sort'
  }),

  // 3) الحالة
  wrapToolsLeftItem({
    title: 'الحالة',
    icon: '<i class="fa-solid fa-thumbtack" aria-hidden="true"></i>',
    child: statusFilterSelect,
    extraClass: 'timeline-tools-field--status'
  }),

  // 4) درجة اليقين
  wrapToolsLeftItem({
    title: 'درجة اليقين',
    icon: '<i class="fa-solid fa-circle-question" aria-hidden="true"></i>',
    child: certaintyFilterSelect,
    extraClass: 'timeline-tools-field--certainty'
  }),
  
    // ✅ 5) زر التصفير داخل toolsLeft
  resetFiltersBtn
);


// ✅ دالة موحّدة لمعرفة هل الفلاتر مفعّلة (للمنع + لإظهار زر التصفير)
function hasActiveFilters() {
  const typeVal   = (typeFilterSelect?.value || 'all');
  const statusVal = (statusFilterSelect?.value || 'all');
  const certVal   = (certaintyFilterSelect?.value ?? 'all');

  return (
    (typeVal !== 'all') ||
    (statusVal !== 'all') ||
    (certVal !== 'all') ||
    !!__navSourceFilter
  );
}

// ✅ كنترول إظهار/إخفاء الفلاتر (toolsLeft)
const filtersCtl = createFiltersCollapseController({
  storageKey: 'biosec:events:filtersCollapsed',
  panelEl: toolsLeft,
  toggleBtnEl: filtersToggleBtn,

  hasActiveFilters,

  labels: { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
  iconHtml: '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
  onBlockedHide: () => showInfo?.('لا يمكن إخفاء الفلاتر لأن هناك فلاتر مفعّلة.')
});


// تطبيق الحالة الابتدائية (مع فتح تلقائي إذا كانت الفلاتر مفعلة)
filtersCtl.applyInitialState({ autoOpenIfActive: true });
  syncResetFiltersBtnVisibility();

  function syncResetFiltersBtnVisibility() {
  resetFiltersBtn.style.display = hasActiveFilters() ? '' : 'none';
}

function resetFiltersToDefault() {
  // ✅ صفّر فلاتر toolsLeft (اللي يعتمد عليها منع الإخفاء)
  typeFilterSelect.value = 'all';
  statusFilterSelect.value = 'all';
  certaintyFilterSelect.value = 'all';

  currentTypeFilter = 'all';
  currentStatusFilter = 'all';
  currentCertaintyFilter = 'all';

  // ✅ صفّر فلتر التنقل (يؤثر على hasActiveFilters)
  __navSourceFilter = '';
clearEventsFiltersState();
  // ✅ أعِد الرسم (بدون مسح البحث — لأن البحث ليس جزءًا من hasActiveFilters هنا)
  syncResetFiltersBtnVisibility();
  renderAll();
}

resetFiltersBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetFiltersToDefault();
});

// ✅ طبّق الحالة الابتدائية لظهور الزر
syncResetFiltersBtnVisibility();

// ✅ ربط زر الفلاتر بالتبديل
filtersToggleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  filtersCtl.toggle();
});

// ✅ ضع الزر داخل toolsRight
toolsRight.append(searchWrap, addBtn, filtersToggleBtn, viewToggleWrap);
  tools.append(toolsLeft, toolsRight);

  header.append(titleBlock, tools);

  const listWrap = el('div', 'biosec-list events-list');
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
sourceIds: shallowArr(ev.sourceIds),
      source: ev.source || '',
      certainty: ev.certainty || ''
    };
let currentMedia = shallowArr(ev.media);

// ✅ Sources map (مرة واحدة لكل بطاقة)
const __allSources = Array.isArray(person.sources) ? person.sources : [];
const __sourceMap = new Map(__allSources.map(s => [String(s?.id || '').trim(), s]));

// ✅ نظّف curSourceIds من البداية (حتى ما يظهر عدّاد على IDs محذوفة)
let curSourceIds = shallowArr(ev.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => __sourceMap.has(String(sid)));

    let pendingDeletedMedia = [];
let isEditing =
  ev.id === lastEditedEventId ||
  isEmptyEventRecord(ev);

    let isDirty = false;

    const meta  = _getTypeMeta(ev.type);
const isGenerated =
!!(safeStr(ev.relatedSectionId) && safeStr(ev.relatedItemId));

const card  = el('article', 'biosec-card event-card');
card.dataset.eventId = ev.id;

if (ev.pinned) card.classList.add('biosec-card--pinned');
    const serial = (index || 0) + 1;

    // ----------------------------
    // شريط علوي: رقم + مميز + زر قفز للخط الزمني
    // ----------------------------

    const topRow = el('div', 'biosec-card-top event-card-top timeline-card-top');
    const indexBadge = el('div', 'biosec-card-index event-card-index timeline-card-index');

    indexBadge.textContent = `الحدث ${serial}`;
    topRow.appendChild(indexBadge);

    if (ev.pinned) {
      const pinnedBadge = el('div', 'biosec-pinned-badge event-pinned-badge timeline-pinned-badge');
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

    const previewBox  = el('div', 'biosec-preview event-preview');

    const previewMeta = el('div', 'biosec-preview-meta event-preview-meta timeline-preview-meta');
    const createdLabel = el('span', 'biosec-preview-date event-preview-created timeline-preview-created');
    createdLabel.textContent = ev.createdAt ? formatCreatedAtLabel(ev.createdAt, { prefix: 'أضيف هذا الحدث', formatter: formatFullDateTime })
      : '';

    const updatedLabel = el('span', 'biosec-preview-date event-preview-updated timeline-preview-updated');
updatedLabel.textContent =
  (ev.updatedAt && ev.updatedAt !== ev.createdAt) ? formatCreatedAtLabel(ev.updatedAt, { prefix: 'آخر تعديل', formatter: formatFullDateTime })
    : '';

    const lengthLabel = el('span', 'biosec-length-chip event-preview-length timeline-length-chip');

    const lenInfo = getTextLengthInfo((ev.description || '').length, { short: 280, medium: 800 }, {
      empty: 'بدون تفاصيل',
      short: 'تفاصيل قصيرة',
      medium: 'تفاصيل متوسطة',
      long: 'تفاصيل طويلة'
    });

    if (lenInfo.level === 0) {
      lengthLabel.textContent = 'لم تُكتب تفاصيل هذا الحدث بعد';
    } else {
      const meter = el('span', 'biosec-length-meter event-length-meter timeline-length-meter');
      meter.dataset.level = String(lenInfo.level);
      const bar = el('span', 'biosec-length-meter-bar event-length-meter-bar timeline-length-meter-bar');
      meter.appendChild(bar);

      const txtSpan = el('span');
      txtSpan.textContent = lenInfo.label;

      lengthLabel.innerHTML = '';
      lengthLabel.append(meter, txtSpan);
    }

previewMeta.append(createdLabel, updatedLabel, lengthLabel);

    // بادجات المكان/تاريخ الحدث/نوع الحدث + معلومات إضافية (tags/source/certainty)
    const badgesWrap = el('div', 'biosec-preview-badges event-preview-badges timeline-preview-badges');
const dateBadgeText = ev.date ? formatEventDateBadge(ev.date) : '';

let eventDateLine = null;
if (isDatedValue(ev.date) && dateBadgeText) {
  const label = isYearOnly(ev.date) ? 'سنة الحدث' : 'تاريخ الحدث';
  eventDateLine = textEl('div', `${label}: ${dateBadgeText}`, 'event-preview-eventdate');
}


    let ageLine = null;
    const birthDate = person?.bio?.birthDate || null;
    const approxAge = computeApproxAgeAtEvent(birthDate, ev.date);
    if (approxAge != null) {
      ageLine = textEl('div', `العمر التقريبي عند الحدث: ${approxAge} سنة`, 'event-preview-age');
    }

    if (ev.place) {
      const placeBadge = el('span', 'biosec-badge timeline-badge timeline-badge--place');
      placeBadge.textContent = ev.place;
      badgesWrap.appendChild(placeBadge);
    }

    if (dateBadgeText) {
      const yearBadge = el('span', 'biosec-badge timeline-badge timeline-badge--date');
      yearBadge.textContent = dateBadgeText;
      badgesWrap.appendChild(yearBadge);
    }

    let typeBadge = null;
    if (meta.label) {
      typeBadge = el('span', 'biosec-badge timeline-badge timeline-badge--type');
      typeBadge.dataset.eventId = ev.id;
      typeBadge.dataset.type = ev.type || 'custom';
      typeBadge.textContent = meta.label;
      badgesWrap.appendChild(typeBadge);
    }

const extraMetaPreview = el('div', 'event-extra-meta');

// -------- Preview: مصادر مرتبطة (خارج extra meta) --------
let linkedSourcesPreviewEl = null;

{
  // ✅ اعتمد على __sourceMap اللي جهزناه فوق
  const linked = Array.isArray(ev.sourceIds) ? ev.sourceIds.map(String).filter(Boolean) : [];

  if (linked.length) {
    const wrap = el('div', 'biosec-linked-sources event-linked-sources');

    const head = el('div', 'biosec-linked-sources-head event-linked-sources-head');

    const icon = el('i');
    icon.className = 'fa-solid fa-link';
    icon.setAttribute('aria-hidden', 'true');

    const evType = safeStr(_getTypeMeta(ev.type)?.label) || 'الحدث';
    const titleText = `المصادر المرتبطة بـ (${safeStr(evType)})`;

    const title = textEl(
      'span',
      titleText,
      'biosec-linked-sources-title event-linked-sources-title'
    );

    head.append(icon, title);
    wrap.appendChild(head);

    // ✅ chips (تجاهل المحذوف)
    linked.forEach((sid) => {
      const src = __sourceMap.get(String(sid));
      if (!src) return; // ✅ تجاهل المصدر المحذوف

      const chip = el('button', 'biosec-chip biosec-chip--source');
      chip.type = 'button';
      chip.textContent = src?.title || src?.holderName || src?.type || String(sid);

      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onBioShortcutClick?.('sources', { sourceId: String(sid) });
      });

      wrap.appendChild(chip);
    });

    // ✅ لو كلهم محذوفين لا ترجع بلوك فارغ
    if (wrap.querySelector('.biosec-chip--source')) {
      linkedSourcesPreviewEl = wrap;
    }
  }
}


    if (Array.isArray(ev.tags) && ev.tags.length) {
      const tagsWrap = el('div', 'biosec-tags-list timeline-tags-list');

      ev.tags.forEach(tag => {
        const chip = el('button', 'biosec-tag-chip timeline-tag-chip');
        chip.type = 'button';
        chip.textContent = tag;
        tagsWrap.appendChild(chip);
      });

      extraMetaPreview.appendChild(tagsWrap);
    }

    const certLabel = getCertaintyLabel(ev.certainty);
    if (certLabel) {
      const cChip = el('span', 'biosec-badge timeline-certainty-chip');
      cChip.textContent = `درجة اليقين: ${certLabel}`;
      extraMetaPreview.appendChild(cChip);
    }

    if (ev.source) {
      const sChip = el('span', 'biosec-badge timeline-source-chip');
      sChip.textContent = `المصدر: ${ev.source}`;
      extraMetaPreview.appendChild(sChip);
    }

    const previewTitle = textEl(
      'div',
      ev.title || meta.label,
      'biosec-preview-title event-preview-title timeline-preview-title'
    );

    const previewDesc = textEl(
      'p',
      ev.description || 'لم تتم إضافة تفاصيل لهذا الحدث بعد. يمكنك فتح وضع التعديل لكتابتها.',
      'biosec-preview-text event-preview-description timeline-preview-text'
    );

    const previewImagesWrap = el('div', 'biosec-images-thumbs event-preview-images timeline-preview-images');

    const sliderBtn = el('button', 'biosec-images-slider-btn event-images-slider-btn timeline-images-slider-btn');
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
          'biosec-image-thumb timeline-image-thumb timeline-image-thumb--preview event-media-thumb event-media-thumb--preview'
        );

        const imgEl = el('img');
        imgEl.alt = 'صورة مرفقة بالحدث';

        resolveEventImageUrl(ref).then(url => { if (url) imgEl.src = url; });

        const viewBtn = textEl('button', 'معاينة', 'biosec-image-thumb-view event-media-thumb-view');
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

// ✅ انقل (event-extra-meta) قبل linked sources
if (extraMetaPreview.childNodes.length) {
  previewChildren.push(extraMetaPreview);
}

// ✅ انقل (previewMeta) قبل linked sources
previewChildren.push(previewMeta);

// ✅ بعدهم: المصادر المرتبطة
if (linkedSourcesPreviewEl) {
  previewChildren.push(linkedSourcesPreviewEl);
}

// ✅ ثم الصور
previewChildren.push(previewImagesWrap, sliderBtn);

    previewBox.append(...previewChildren);
    card.appendChild(previewBox);

// ----------------------------
// وضع التعديل (Edit)
// ----------------------------

const editBox = el('div', 'biosec-edit event-edit');
const body = el('div', 'biosec-body event-body');

// =====================================================
// ✅ Helper: عنوان قسم داخل وضع التعديل
// =====================================================
function makeEditSectionTitle(text, iconClass = 'fa-layer-group', rightEl = null) {
  const row = el('div', 'biosec-edit-section-title event-edit-section-title');

  const left = el('div', 'biosec-edit-section-title-left');
  left.innerHTML =
    `<span class="biosec-meta-icon"><i class="fa-solid ${iconClass}" aria-hidden="true"></i></span> ` +
`<span>${safeStr(text)}</span>`;

  row.appendChild(left);

  if (rightEl) {
    const right = el('div', 'biosec-edit-section-title-right');
    right.appendChild(rightEl);
    row.appendChild(right);
  }

  return row;
}

// ✅ عنصر dates لازم يبقى موجود لأن applyMode يستخدمه
const dates = el('div', 'biosec-dates event-dates timeline-dates');
dates.textContent = ev.createdAt ? formatCreatedAtLabel(ev.createdAt, { prefix: 'أضيف هذا الحدث', formatter: formatFullDateTime })
  : '';


// =====================================================
// ✅ (1) القسم الأول: البيانات الأساسية (صف واحد meta-row)
// ✅ يشمل: title + type + date + place فقط
// =====================================================
const basicSection = el('div', 'event-edit-section event-edit-section--basic');
basicSection.appendChild(makeEditSectionTitle('بينات أساسية', 'fa-circle-info', dates));

const basicRow = el('div', 'biosec-meta-row event-meta-row timeline-meta-row event-meta-row--basic-all');

// --- عنوان الحدث ---
const titleField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const titleLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
titleLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-heading" aria-hidden="true"></i></span> عنوان الحدث';

const titleInput = document.createElement('input');
titleInput.type = 'text';
titleInput.className = 'biosec-input biosec-title-input event-title-input timeline-title-input';
titleInput.name = `event_title_${ev.id}`;
titleInput.placeholder = 'مثال: بداية العمل في الشركة، الزواج...';
titleInput.value = ev.title || '';

titleField.append(titleLabelBox, titleInput);

// --- نوع الحدث ---
const typeField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const typeLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
typeLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tag" aria-hidden="true"></i></span> نوع الحدث';

const select = document.createElement('select');
select.className = 'biosec-select event-type-select';
select.name = `event_type_${ev.id}`;
EVENT_TYPES.forEach(t => {
  const opt = document.createElement('option');
  opt.value = t.value;
opt.textContent = `${t.emoji} ${t.label}`;
  if (t.value === ev.type) opt.selected = true;
  select.appendChild(opt);
});

typeField.append(typeLabelBox, select);

// --- تاريخ الحدث (مع year toggle) ---
const dateInput = document.createElement('input');
dateInput.type = 'text';
dateInput.className = 'biosec-input biosec-date-input event-date-input';
dateInput.name = `event_date_${ev.id}`;
dateInput.id = `event_date_${ev.id}`;
dateInput.placeholder = 'YYYY أو YYYY-MM-DD';
dateInput.value = ev.date || '';
dateInput.dataset.yearToggle = '1';

// ✅ نفس هيكلة بقية الحقول (Head + Body) عشان زر التبديل يظهر
const dateField = withFieldHead(dateInput, {
  label: 'تاريخ الحدث',
  icon: 'fa-calendar-day'
});

// ✅ حافظ على كلاس الـ grid الحالي
dateField.classList.add('biosec-meta-field', 'event-meta-field', 'timeline-meta-field');

// ✅ الآن الزر يقدر يتركّب في المكان الصحيح
attachYearModeToggle(dateInput);

// --- مكان الحدث ---
const placeField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const placeLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
placeLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span> المكان';

const placeInput = document.createElement('input');
placeInput.type = 'text';
placeInput.className = 'biosec-input biosec-place-input event-place-input';
placeInput.name = `event_place_${ev.id}`;
placeInput.placeholder = 'المكان (مدينة / دولة / حيّ)...';
placeInput.value = ev.place || '';

placeField.append(placeLabelBox, placeInput);

// ✅ ضم الحقول الأساسية في صف واحد
basicRow.append(titleField, typeField, dateField, placeField);
basicSection.appendChild(basicRow);


// =====================================================
// ✅ (2) القسم الثاني: التفاصيل (desc فقط)
// =====================================================
const detailsSection = el('div', 'event-edit-section event-edit-section--details');
detailsSection.appendChild(makeEditSectionTitle('تفاصيل إضافية', 'fa-solid fa-list-check'));

// desc فقط داخل meta-row
const detailsRow = el('div', 'biosec-meta-row event-meta-row timeline-meta-row event-meta-row--details');

const descField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const descLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
descLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i></span> نص تفاصيل الحدث';

const desc = document.createElement('textarea');
desc.className = 'biosec-textarea event-description-input';
desc.name = `event_description_${ev.id}`;
desc.rows = 4;
desc.placeholder = 'تفاصيل الحدث (مثلاً: متى حصل، من حضر، ملاحظات خاصة...)';
desc.value = ev.description || '';

descField.append(descLabelBox, desc);
detailsRow.append(descField);
detailsSection.appendChild(detailsRow);


// =====================================================
// ✅ (3) القسم الثالث: التوثيق والربط (صفّين meta-row)
//   - الصف 1: tags + source + certainty
//   - الصف 2: linkedSources فقط
// =====================================================
const extraSection = el('div', 'event-edit-section event-edit-section--extra');

// --- الصف الأول: tags + source + certainty ---
const extraRow = el('div', 'biosec-meta-row event-meta-row timeline-meta-row event-meta-row--extra-main');

// tags
const tagsField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const tagsLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
tagsLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-tags" aria-hidden="true"></i></span> وسوم الحدث';

const tagsInput = document.createElement('input');
tagsInput.type = 'text';
tagsInput.className = 'biosec-tags-input event-tags-input';
tagsInput.name = `event_tags_${ev.id}`;
tagsInput.placeholder = 'مثال: الهجرة، السفر، العمل (مفصولة بفواصل)';
tagsInput.value = Array.isArray(ev.tags) ? ev.tags.join(', ') : '';
tagsField.append(tagsLabelBox, tagsInput);

// source
const sourceField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const sourceLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
sourceLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-book" aria-hidden="true"></i></span> المرجع / المصدر';

const sourceInput = document.createElement('input');
sourceInput.type = 'text';
sourceInput.className = 'biosec-input event-source-input';
sourceInput.name = `event_source_${ev.id}`;
sourceInput.placeholder = 'مثال: رُوي عن فلان، أو موثّق من بطاقة هوية...';
sourceInput.value = ev.source || '';
sourceField.append(sourceLabelBox, sourceInput);

// certainty
const certaintyField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
const certaintyLabelBox = el('div', 'biosec-meta-label event-meta-label timeline-meta-label');
certaintyLabelBox.innerHTML =
  '<span class="biosec-meta-icon event-meta-icon timeline-meta-icon"><i class="fa-solid fa-circle-question" aria-hidden="true"></i></span> درجة اليقين';

const certaintySelect = document.createElement('select');
certaintySelect.className = 'biosec-select event-certainty-select';
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

// --- الصف الثاني: linkedSources فقط ---
const linkedSourcesRow = el('div', 'biosec-meta-row event-meta-row timeline-meta-row event-meta-row--linked-sources');

const linkedSourcesField = el('div', 'biosec-meta-field event-meta-field timeline-meta-field');
    // ✅ عنوان داخلي لقسم المصادر (مثل عناوين بينات أساسية / تفاصيل إضافية)
const sourcesInnerTitle = makeEditSectionTitle('المصادر', 'fa-solid fa-link');
sourcesInnerTitle.classList.add('event-edit-inner-title', 'event-edit-inner-title--sources');

// ✅ أدوات خاصة بالمصادر (بحث + أزرار + عداد)
const linkedSourcesTools  = el('div', 'event-linked-sources-tools biosec-linked-sources-tools');
const linkedSourcesHeader = el('div', 'event-linked-sources-header biosec-linked-sources-header');
const linkedSourcesTitle  = el('div', 'event-linked-sources-title biosec-linked-sources-title');
const evTypeLabel = safeStr(_getTypeMeta(select?.value || ev.type)?.label) || 'الحدث';
const chooseSourcesText = `اختر مصادر توثيق (${safeStr(evTypeLabel)})`;

linkedSourcesTitle.innerHTML =
  '<i class="fa-solid fa-circle-nodes" aria-hidden="true"></i>' +
  `<span>${chooseSourcesText}</span>`;

(function () {
  var meta0 = _getTypeMeta(select ? (select.value || ev.type) : ev.type);
  var evTypeLabel0 = safeStr(meta0 && meta0.label) || 'الحدث';
  var span0 = linkedSourcesTitle.querySelector('span');
  if (span0) span0.textContent = 'اختر مصادر توثيق (' + safeStr(evTypeLabel0) + ')';
})();

const linkedSourcesHint = textEl(
  'div',
  'حدّد المصادر التي تدعم هذا الحدث (يمكن اختيار أكثر من مصدر).',
  'event-linked-sources-hint biosec-linked-sources-hint'
);

linkedSourcesHeader.append(linkedSourcesTitle, linkedSourcesHint);
const sourcesCount = el('div', 'event-linked-sources-count biosec-linked-sources-count');
sourcesCount.textContent = '0 محدد';

// ✅ بحث داخل المصادر + زر مسح (مثل biosec-tools-right)
const sourcesSearchWrap = el('div', 'biosec-search-wrap biosec-linked-sources-search-wrap event-linked-sources-search-wrap');

const sourcesSearch = document.createElement('input');
sourcesSearch.type = 'search';
sourcesSearch.className = 'event-linked-sources-search biosec-linked-sources-search';
sourcesSearch.name = 'event-linked-sources-search';
sourcesSearch.placeholder = 'ابحث داخل المصادر…';

const clearSourcesSearchBtn = el('button', 'biosec-search-clear biosec-linked-sources-search-clear event-linked-sources-search-clear');
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

  applySourcesFilter();
  sourcesSearch.focus();
});

sourcesSearch.addEventListener('input', () => {
  const raw = sourcesSearch.value || '';
  clearSourcesSearchBtn.style.display = raw.trim() ? '' : 'none';
  applySourcesFilter();
});

sourcesSearchWrap.append(sourcesSearch, clearSourcesSearchBtn);

const btnSelectAll = el('button', 'event-linked-sources-btn biosec-linked-sources-btn');
btnSelectAll.type = 'button';
btnSelectAll.textContent = 'تحديد الكل';

const btnClear = el('button', 'event-linked-sources-btn biosec-linked-sources-btn');
btnClear.type = 'button';
btnClear.textContent = 'إلغاء الكل';

const btnInvert = el('button', 'event-linked-sources-btn biosec-linked-sources-btn');
btnInvert.type = 'button';
btnInvert.textContent = 'عكس';

linkedSourcesTools.append(sourcesCount, sourcesSearchWrap, btnSelectAll, btnClear, btnInvert);

// ✅ حاوية قائمة المصادر
const linkedSourcesWrap   = el('div', 'event-linked-sources biosec-linked-sources-list');
// ✅ رسالة "لا توجد نتائج" داخل قائمة المصادر
const linkedSourcesNoResults = textEl(
  'div',
  'لا توجد مصادر مطابقة للبحث الحالي.',
  'biosec-empty-mini biosec-linked-sources-empty event-linked-sources-empty'
);
linkedSourcesNoResults.style.display = 'none';

function updateSelectedCount() {
  const n = (curSourceIds || []).length;
  sourcesCount.textContent = n ? `${n} محدد` : 'لا يوجد تحديد';
  sourcesCount.dataset.active = n ? '1' : '0';
}

function applySourcesFilter() {
  const q = (sourcesSearch.value || '').trim().toLowerCase();

  let visibleCount = 0;

  linkedSourcesWrap.querySelectorAll('.event-linked-source-row').forEach(row => {
    const t = (row.dataset.searchText || '').toLowerCase();
    const show = (!q || t.includes(q));
    row.style.display = show ? '' : 'none';
    if (show) visibleCount += 1;
  });

  // ✅ إن ما فيه أي صف ظاهر => أظهر رسالة مناسبة داخل نفس القائمة
  linkedSourcesNoResults.style.display = (q && visibleCount === 0) ? '' : 'none';
}


sourcesSearch.addEventListener('input', () => applySourcesFilter());

// ✅ أزرار تحكم
btnSelectAll.addEventListener('click', () => {
  const boxes = linkedSourcesWrap.querySelectorAll('input[type="checkbox"][name="event-linked-source-row"]');
  const next = [];
  boxes.forEach(cb => {
    cb.checked = true;
    const sid = cb.dataset.sid;
    if (sid) next.push(sid);
  });
  curSourceIds = Array.from(new Set(next));
  updateSelectedCount();
  recomputeDirty();
});

btnClear.addEventListener('click', () => {
  const boxes = linkedSourcesWrap.querySelectorAll('input[type="checkbox"][name="event-linked-source-row"]');
  boxes.forEach(cb => cb.checked = false);
  curSourceIds = [];
  updateSelectedCount();
  recomputeDirty();
});

btnInvert.addEventListener('click', () => {
  const boxes = linkedSourcesWrap.querySelectorAll('input[type="checkbox"][name="event-linked-source-row"]');
  const next = [];
  boxes.forEach(cb => {
    cb.checked = !cb.checked;
    if (cb.checked) next.push(cb.dataset.sid);
  });
  curSourceIds = next.filter(Boolean);
  updateSelectedCount();
  recomputeDirty();
});

function renderLinkedSources() {
  linkedSourcesWrap.innerHTML = '';

  const sources = Array.isArray(person.sources) ? person.sources : [];
  if (!sources.length) {
    linkedSourcesWrap.appendChild(
      textEl('div', 'لا توجد مصادر مضافة بعد في قسم المصادر.', 'biosec-empty-mini')
    );
    updateSelectedCount();
    return;
  }

  sources.forEach((src) => {
    const sid = String(src?.id || '').trim();
    if (!sid) return;

    const labelText = (src?.title || src?.holderName || sid);

const row = el('label', 'event-linked-source-row biosec-linked-sources-row');
    row.dataset.searchText = labelText;

    const cb = document.createElement('input');
    cb.name = 'event-linked-source-row';
    cb.type = 'checkbox';
    cb.dataset.sid = sid;
    cb.checked = curSourceIds.includes(sid);

const labelTxt = textEl('span', labelText, 'event-linked-source-label biosec-linked-sources-label');

    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!curSourceIds.includes(sid)) curSourceIds.push(sid);
      } else {
        curSourceIds = curSourceIds.filter(x => x !== sid);
      }
      updateSelectedCount();
      recomputeDirty();
    });

    row.append(cb, labelTxt);
    linkedSourcesWrap.appendChild(row);
  });
  linkedSourcesWrap.appendChild(linkedSourcesNoResults);

  updateSelectedCount();
  applySourcesFilter();
}

renderLinkedSources();

// ✅ رصّ داخل field
linkedSourcesField.append(
  sourcesInnerTitle, 
  linkedSourcesHeader,
  linkedSourcesTools,
  linkedSourcesWrap
);
linkedSourcesRow.append(linkedSourcesField);

// ✅ ترتيب قسم التوثيق والربط: صف1 ثم صف2
extraSection.append(extraRow, linkedSourcesRow);

// -------- صور الحدث --------
const mediaWrap = el('div', 'biosec-images-block event-media-wrap');
const emptyHint = el('div', 'biosec-images-empty-hint event-media-empty-hint');
const mediaRow2 = el('div', 'biosec-images-row event-media-row');
const thumbs = el('div', 'biosec-images-thumbs event-media-thumbs');

const addLabel = el('label', 'biosec-add-btn event-media-add-btn');
const addIcon  = el('span', 'event-media-add-icon timeline-image-add-icon');
addIcon.innerHTML = '<i class="fa-solid fa-images" aria-hidden="true"></i>';
const addText  = textEl('span', 'إضافة صور للحدث', 'event-media-add-text timeline-image-add-text');

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*';
fileInput.multiple = true;
fileInput.name = `event_media_${ev.id}`;
fileInput.style.display = 'none';

addLabel.append(addIcon, addText, fileInput);
mediaRow2.appendChild(thumbs);
mediaWrap.append(addLabel, emptyHint, mediaRow2);

function updateAddLabel() {
  const count = currentMedia.length || 0;
  if (count === 0) {
    addText.textContent = 'إضافة أول صورة للحدث';
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
    ghostClass: 'biosec-image-thumb--ghost timeline-image-thumb--ghost',
    dragClass: 'biosec-image-thumb--drag timeline-image-thumb--drag',
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
    const thumb = el('div', 'biosec-image-thumb timeline-image-thumb event-media-thumb');
    thumb.dataset.ref = ref;

    const imgEl = el('img');
    imgEl.alt = 'صورة مرفقة بالحدث';
    resolveEventImageUrl(ref).then(url => { if (url) imgEl.src = url; });

    const removeBtn = textEl('button', '×', 'biosec-image-thumb-remove event-media-thumb-remove');
    removeBtn.type = 'button';
    removeBtn.title = 'إزالة هذه الصورة';

    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ref2 = currentMedia[idx];

      if (ref2 && isTmpRef(ref2)) revokeTempEventRef(ref2);
      if (ref2 && isIdbRef(ref2)) pendingDeletedMedia.push(ref2);

      currentMedia.splice(idx, 1);
      renderThumbs();
      recomputeDirty();
    });

    const viewBtn = textEl('button', 'معاينة', 'biosec-image-thumb-view event-media-thumb-view');
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

// -------- تثبيت الحدث (ضمن toggles row عام) --------
const pinWrap = el('label', 'biosec-pin-toggle biosec-toggle--pinned');
const pinCheckbox = document.createElement('input');
pinCheckbox.type = 'checkbox';
pinCheckbox.name = `event_pinned_${ev.id}`;
pinCheckbox.checked = original.pinned;
const pinText = textEl('span', 'تعيين هذا الحدث كمميّز');
pinWrap.append(pinCheckbox, pinText);

const togglesRow = el('div', 'biosec-toggles-row');
togglesRow.append(pinWrap);


// =====================================================
// ✅ (3) القسم الثالث: صور الحدث (كما هو)
// =====================================================
const mediaSection = el('div', 'event-edit-section event-edit-section--media');
mediaSection.appendChild(mediaWrap);

// =====================================================
// ✅ (4) القسم الرابع: التبديلات (كما هو)
// =====================================================
const togglesSection = el('div', 'event-edit-section event-edit-section--toggles');
togglesSection.appendChild(togglesRow);

// ✅ أخيراً: رصّ الأقسام داخل body بالترتيب المطلوب
body.append(basicSection, detailsSection, extraSection, mediaSection, togglesSection);

editBox.appendChild(body);
card.appendChild(editBox);

    // ----------------------------
    // أزرار القدم (Edit/Save/Close + Cancel + Delete)
    // ----------------------------

    const footer = el('div', 'biosec-footer event-footer');

    const saveBtn = el('button', 'biosec-save-btn event-save-btn');
    const cancelBtn = el('button', 'biosec-cancel-btn event-cancel-btn');
    const delBtn = el('button', 'biosec-delete-btn event-delete-btn');

    saveBtn.type = cancelBtn.type = delBtn.type = 'button';

    cancelBtn.innerHTML =
      '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>' +
      '<span>إلغاء التعديل</span>';
    cancelBtn.style.display = 'none';

    delBtn.innerHTML =
      '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>' +
      '<span>حذف الحدث</span>';

footer.append(saveBtn, cancelBtn, delBtn);

if (isGenerated) {
  const lockNote = el('div', 'biosec-lock-note event-lock-note');

  const msg = el('span');

  const sectionId = safeStr(ev.relatedSectionId || '');
  const sectionLabel =
    sectionId === 'career' ? 'المسار الوظيفي' :
    sectionId === 'education' ? 'التعليم' :
    sectionId === 'stories' ? 'القصص' :
    sectionId || 'القسم';

  msg.textContent = `هذا الحدث مُولّد من قسم "${sectionLabel}". عدّل البيانات من القسم الأصلي.`;

const goBtn = el('button', 'biosec-jump-btn event-jump-section-btn');
goBtn.type = 'button';

const jm = getSectionJumpMeta(sectionId);
goBtn.title = jm.title;
goBtn.innerHTML =
  '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> ' +
  `<span>${jm.label}</span>`;

  goBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (typeof handlers.onBioShortcutClick === 'function') {
      handlers.onBioShortcutClick(sectionId, {
        sectionId,
        itemId: safeStr(ev.relatedItemId || '')
      });
    } else {
      document.querySelector(`.bio-section[data-section-id="${sectionId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  lockNote.append(
    el('i', 'fa-solid fa-lock'),
    msg,
    goBtn
  );

  footer.prepend(lockNote);

  saveBtn.style.display = 'none';
  cancelBtn.style.display = 'none';
  delBtn.style.display = 'none';

  isEditing = false;
  isDirty = false;
}
    
card.appendChild(footer);

    // ----------------------------
    // مساعدين داخليين للبطاقة
    // ----------------------------

    function fillEditFromEvent() {
      select.value = ev.type || 'custom';
      if (!Array.from(select.options).some(o => o.value === select.value)) {
        select.value = 'custom';
      }

setYearToggleValue(dateInput, ev.date || '', { silent: true });

      titleInput.value = ev.title || '';
      placeInput.value = ev.place || '';
      desc.value = ev.description || '';

      tagsInput.value = Array.isArray(ev.tags) ? ev.tags.join(', ') : '';
      sourceInput.value = ev.source || '';
      certaintySelect.value = ev.certainty || '';

      pinCheckbox.checked = !!ev.pinned;

currentMedia = shallowArr(ev.media);
      renderThumbs();
curSourceIds = shallowArr(ev.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => __sourceMap.has(String(sid)));

renderLinkedSources();
recomputeDirty();

      pendingDeletedMedia = [];
    }

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
        classes: { edit: 'event-card--edit', preview: 'event-card--preview' },
        labels: { edit: 'تعديل', close: 'إغلاق', save: 'حفظ' },
        icons: { edit: 'fa-pen-to-square', close: 'fa-xmark', save: 'fa-floppy-disk' }
      });
    }

    function recomputeDirty() {
      const curType   = safeStr(select.value || 'custom') || 'custom';
const curDate = getLogicalDateValue(dateInput);
      const curTitle  = titleInput.value.trim();
      const curPlace  = placeInput.value.trim();
      const curDesc   = desc.value.trim();
      const curPinned = !!pinCheckbox.checked;

const curTags = splitCommaTags(tagsInput.value || '');
      const curSource = sourceInput.value.trim();
      const curCertainty = safeStr(certaintySelect.value || '');
const curSourcesLinked = curSourceIds.slice();

      isDirty =
        curType !== original.type ||
curDate !== (original.date || '') ||
        curTitle !== original.title ||
        curPlace !== original.place ||
        curDesc !== original.description ||
        curPinned !== original.pinned ||
        !arraysShallowEqual(currentMedia, original.media) ||
!arraysShallowEqual(curTags, original.tags || []) ||
!arraysShallowEqual(curSourcesLinked, original.sourceIds || []) ||
curSource !== (original.source || '') ||
curCertainty !== (original.certainty || '');


      applyMode();
    }

    // أول تهيئة
    applyMode();
    renderThumbs();

    // مراقبة المدخلات
select.addEventListener('change', function () {
  var meta = _getTypeMeta(select.value || ev.type);
  var evTypeLabel = safeStr(meta && meta.label) || 'الحدث';
  var chooseSourcesText = 'اختر مصادر توثيق (' + safeStr(evTypeLabel) + ')';

  var span = linkedSourcesTitle ? linkedSourcesTitle.querySelector('span') : null;
  if (span) span.textContent = chooseSourcesText;

  recomputeDirty();
});


dateInput.addEventListener('input', recomputeDirty);
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
  // ✅ قاعدة ذهبية: إغلاق مسودة فارغة = حذفها (بدون ترك بطاقة فارغة)
  if (isEmptyEventRecord(ev)) {
    // نظّف tmp قبل الحذف
    cleanupTmpRefs(currentMedia);
    pendingDeletedMedia = [];

    // احذف الحدث من البيانات
    person.events = (person.events || []).filter(e => e.id !== ev.id);

    // نظّف فلاغ المسودة
    draftNewMap?.delete?.(ev.id);

    if (lastEditedEventId === ev.id) lastEditedEventId = null;

    renderAll();
    showInfo?.('تم إلغاء إنشاء الحدث (لم يتم إدخال أي بيانات).');
    return;
  }

  // ✅ غير ذلك: إغلاق عادي بدون حفظ
  cleanupTmpRefs(currentMedia);
  currentMedia = original.media.slice();
  pendingDeletedMedia = [];

  isEditing = false;
  applyMode();
  showInfo?.('لا توجد تعديلات جديدة لحفظها. تم إغلاق محرّر الحدث.');
  return;
}

      // ترقية tmp -> idb (بديل upgradeTmpMediaToIdb بالكامل)
const hasTmp = currentMedia.some((r) => isTmpRef(r));

      if (hasTmp && typeof DB?.putEventImage !== 'function' && typeof DB?.putStoryImage !== 'function') {
        showError?.('ميزة حفظ الصور غير متاحة حالياً (DB.putEventImage غير موجود).');
        return;
      }

const up = await upgradeTmpRefs(currentMedia, {
        tempCache: eventSectionTmp.tempCache,
        putFn: async (rec) => {
          // الأفضل: أحداث، ثم fallback للقصص
          if (typeof DB?.putEventImage === 'function') {
            return DB.putEventImage({ file: rec.file, personId, eventId: ev.id });
          }
          return DB.putStoryImage({ file: rec.file, personId, storyId: ev.id });
        },
        onFail: (ref, e) => console.error('Failed to store temp event image', ref, e),
        revokeFn: (ref) => eventSectionTmp.revokeTemp(ref)
      });

      if (!up.ok) {
        showError?.('تعذّر حفظ إحدى الصور. لم يتم حفظ التعديلات.');
        return;
      }

      currentMedia = up.refs;
const logicalDate = getLogicalDateValue(dateInput);

      const patch = {
type: safeStr(select.value || 'custom') || 'custom',
date: safeStr(logicalDate || ''),
        title: titleInput.value.trim(),
        place: placeInput.value.trim(),
        description: desc.value.trim(),
        media: currentMedia.slice(),
        pinned: !!pinCheckbox.checked,
tags: splitCommaTags(tagsInput.value || ''),
sourceIds: curSourceIds
  .map(String)
  .filter(Boolean)
  .filter((sid) => __sourceMap.has(String(sid))),
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
original.sourceIds = shallowArr(ev.sourceIds);
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
      // ✅ لم يعد Draft
      draftNewMap?.delete?.(ev.id);

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

setYearToggleValue(dateInput, original.date || '', { silent: true });
      titleInput.value = original.title;
      placeInput.value = original.place;
      desc.value = original.description;
      pinCheckbox.checked = original.pinned;

      tagsInput.value = (original.tags || []).join(', ');
      sourceInput.value = original.source || '';
      certaintySelect.value = original.certainty || '';
curSourceIds = shallowArr(original.sourceIds)
  .map(String)
  .filter(Boolean)
  .filter((sid) => __sourceMap.has(String(sid)));

renderLinkedSources();

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
if (!isIdbRef(ref)) continue;
        try {
          await DB?.deleteEventImage?.(ref);
        } catch (e) {
          console.error('deleteEventImage failed', ref, e);
        }
      }

      person.events = (person.events || []).filter(e => e.id !== ev.id);
            draftNewMap?.delete?.(ev.id);

      renderAll();
      fireUpdateMessage('تم حذف الحدث من الخط الزمني.');
    });

    return card;
  }

  // =================================================================
  // 6.2) الفلاتر/الفرز/البحث + الرسم (List/Timeline)
  // =================================================================

  function getFilteredSortedEvents() {
    let events = sortEvents(person.events || []);

    if (currentSortMode === 'latest') events = events.slice().reverse();

    if (currentTypeFilter && currentTypeFilter !== 'all') {
      events = events.filter(ev => (ev.type || 'custom') === currentTypeFilter);
    }
    
    if (__navSourceFilter) {
      events = events.filter(ev =>
        Array.isArray(ev.sourceIds) && ev.sourceIds.includes(__navSourceFilter)
      );
    }

    if (currentSearchQuery) {
      events = events.filter(ev =>
        String(ev.title || '').toLowerCase().includes(currentSearchQuery)
      );
    }

    // ✅ فلتر الحالة: مميز / غير مميز
if (currentStatusFilter === 'pinned') {
  events = events.filter(ev => !!ev.pinned);
} else if (currentStatusFilter === 'unpinned') {
  events = events.filter(ev => !ev.pinned);
}

// ✅ فلتر درجة اليقين (نفس خيارات وضع التعديل)
if (currentCertaintyFilter !== 'all') {
  const want = String(currentCertaintyFilter); // قد تكون '' أو 'certain'...
  events = events.filter(ev => safeStr(ev?.certainty || '') === want);
}

    return events;
  }

  function renderList() {
    listWrap.innerHTML = '';

    const allEvents = person.events || [];
    const events = getFilteredSortedEvents();

    if (!events.length) {
      const empty = el('div', 'biosec-empty events-empty');
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
      const empty = el('div', 'biosec-empty timeline-empty');
      empty.textContent = 'لا توجد أحداث لعرضها على الخط الزمني بعد. ابدأ من تبويب القائمة بإضافة أول حدث.';
      timelineWrap.appendChild(empty);
      return;
    }

    const list = el('ol', 'timeline-list timeline-vertical');
    let lastYear = null;

    const birthDate = person?.bio?.birthDate || null;

    events.forEach(ev => {
      const meta = _getTypeMeta(ev.type);
const isGenerated =
!!(safeStr(ev.relatedSectionId) && safeStr(ev.relatedItemId));

const hasDated = isDatedValue(ev.date);
const year = hasDated ? String(ev.date).slice(0, 4) : 'غير مؤرَّخ';

const dateBadgeText = ev.date ? formatEventDateBadge(ev.date) : '';

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

const titleSpan = textEl('span', titleText, 'timeline-title');
titleRow.append(titleSpan);

      // بادج نوع الحدث داخل عنصر الخط الزمني (فقط إذا كان هناك عنوان مخصّص)
      if (ev.title) {
        const typeBadge = el('span', 'biosec-badge timeline-badge timeline-badge--type');
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
          const thumb = el('div', 'biosec-image-thumb timeline-image-thumb');
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
          const tagBadge = el('span', 'biosec-badge timeline-badge timeline-badge--tag');
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
          const cChip = el('span', 'biosec-badge timeline-certainty-chip');
          cChip.textContent = `درجة اليقين: ${certLabel2}`;
          metaExtra.appendChild(cChip);
        }

        if (ev.source) {
          const sChip = el('span', 'biosec-badge timeline-source-chip');
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
  
    function applyNavAfterRender() {
    const nav = handlers.__consumeBioNav?.();
    if (!nav) return;

    // (A) Jump to eventId
    const eventId = safeStr(nav.eventId || nav.itemId || '');
    if (eventId) {
      // تأكد أننا في عرض القائمة عشان البطاقة موجودة
      root.dataset.view = 'list';
      listBtn.classList.add('is-active');
      visBtn.classList.remove('is-active');

      const card = listWrap.querySelector(`.event-card[data-event-id="${eventId}"]`);
      if (card) {
        try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        catch (e) { card.scrollIntoView(true); }
        card.classList.add('biosec-card--jump-highlight');
        setTimeout(() => card.classList.remove('biosec-card--jump-highlight'), 1500);
      }
      return;
    }

    // (B) Filter/jump by sourceId
    const sourceId = safeStr(nav.sourceId || '');
    if (sourceId) {
      __navSourceFilter = sourceId;

      // اختياري: تصفير البحث حتى ما يتعارض
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
syncResetFiltersBtnVisibility();
persistEventsFiltersState();
      // 🔁 نعيد الرسم مرة واحدة ليطبق الفلتر
      renderAll();

      // بعد الرسم: انط لأول بطاقة
      const first = listWrap.querySelector(`.event-card[data-event-id]`);
      if (first) {
        try { first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        catch (e) { first.scrollIntoView(true); }
        first.classList.add('biosec-card--jump-highlight');
        setTimeout(() => first.classList.remove('biosec-card--jump-highlight'), 1500);
      }
    }
  }


  function renderAll() {
    {
      const usedTypesSet = new Set(
        (person.events || [])
          .map(ev => safeStr(ev?.type || 'custom'))
          .filter(Boolean)
      );

      const prevValue = typeFilterSelect.value || currentTypeFilter || 'all';
   const nextValue = eventType.rebuildSelectFromUsed(typeFilterSelect, usedTypesSet, prevValue, 'ar');

// ✅ رجّع الرموز بعد ما rebuild يمسحها
patchEventTypeSelectEmojis(typeFilterSelect);

currentTypeFilter = nextValue;

    }

    renderList();
    renderTimelineView();
        applyNavAfterRender();

  }

  // =================================================================
  // 6.3) إضافة حدث جديد (نفس السلوك)
  // =================================================================

  function addNewEvent() {
    const guessBirth = (person.bio && person.bio.birthDate) ? person.bio.birthDate : '';
    // ✅ امنع وجود أكثر من مسودة فارغة
    const draft = (person.events || []).find(isEmptyEventRecord);
    if (draft) {
      lastEditedEventId = draft.id;
      renderAll();
      showInfo?.('لديك مسودة حدث مفتوحة بالفعل. أكملها أو أغلقها قبل إضافة حدث جديد.');
      return;
    }

const ev = normalizeEvent({
  type: 'custom',
  date: '',
  title: '',
  place: '',
  description: '',
  tags: [],
  source: '',
  certainty: '',
  media: []
});

    person.events = person.events || [];
    person.events.push(ev);
    person.events = sortEvents(person.events);

    lastEditedEventId = ev.id;
        draftNewMap.set(ev.id, true);

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
  syncResetFiltersBtnVisibility();
    persistEventsFiltersState(); 
    renderAll();
  });
  
  statusFilterSelect.addEventListener('change', () => {
  currentStatusFilter = statusFilterSelect.value || 'all';
  syncResetFiltersBtnVisibility();
    persistEventsFiltersState();
    renderAll();
});

certaintyFilterSelect.addEventListener('change', () => {
  // لاحظ: قيمة '' مسموحة وتمثل "غير محددة"
  currentCertaintyFilter = (certaintyFilterSelect.value ?? 'all');
    syncResetFiltersBtnVisibility();
persistEventsFiltersState();
  renderAll();
});


  sortSelect.addEventListener('change', () => {
    const mode = sortSelect.value === 'latest' ? 'latest' : 'oldest';
    currentSortMode = mode;
    persistEventsFiltersState();
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