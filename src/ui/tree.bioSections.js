// tree.bioSections.js — أقسام السيرة داخل تفاصيل الشخص

import { el, textEl, highlight, getArabicOrdinal, getArabicOrdinalF } from '../utils.js';
import { LABELS } from '../model/families.js';
import { resolveAncestorsForPerson } from '../model/families.core.js';
import * as Lineage from '../features/lineage.js';
import { inferGender } from '../model/roles.js';
import { createStoriesSection } from '../features/person.stories.js';
import { createEventsSection } from '../features/person.events.js';
import { createSourcesSection } from '../features/person.sources.js';
// NEW: للتحقق من أن الشخص له بطاقة مرسومة في الشجرة
import { isPersonRendered } from './tree.cards.js';
/* =========================
   توابع العمر والتواريخ
   ========================= */
function _parseYMD(str){
  const parts = String(str || '').trim().split(/[-/]/);
  let y = null, m = 0, d = 1;
  if (parts[0]) y = parseInt(parts[0], 10);
  if (parts[1]) m = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
  if (parts[2]) d = Math.max(1, Math.min(31, parseInt(parts[2], 10)));
  return Number.isFinite(y) ? { y, m, d } : null;
}

function _getBirthDate(bio){
  if (!bio) return null;
  if (bio.birthDate && bio.birthDate !== '-'){
    const b = _parseYMD(bio.birthDate);
    return b ? new Date(b.y, b.m, b.d) : null;
  }
  if (bio.birthYear && bio.birthYear !== '-'){
    const y = parseInt(String(bio.birthYear).trim().slice(0, 4), 10);
    return Number.isFinite(y) ? new Date(y, 0, 1) : null;
  }
  return null;
}

function _getDeathDateOrNull(bio, birth){
  if (!bio || !birth) return { ref: new Date(), died: false };

  if (bio.deathDate && bio.deathDate !== '-'){
    const d = _parseYMD(bio.deathDate);
    if (d){
      const death = new Date(d.y, d.m, d.d);
      if (!Number.isNaN(death.getTime()) && death.getTime() >= birth.getTime()){
        return { ref: death, died: true };
      }
    }
  } else if (bio.deathYear && bio.deathYear !== '-'){
    const dy = parseInt(String(bio.deathYear).trim().slice(0, 4), 10);
    if (Number.isFinite(dy)){
      const death = new Date(dy, 0, 1);
      if (!Number.isNaN(death.getTime()) && death.getTime() >= birth.getTime()){
        return { ref: death, died: true };
      }
    }
  }
  return { ref: new Date(), died: false };
}

function _fmtUnit(n, one, two, few, many){
  if (n <= 0) n = 1;
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
const _fmtDays   = n => _fmtUnit(n, 'يوم واحد', 'يومان', 'أيام', 'يومًا');
const _fmtWeeks  = n => _fmtUnit(n, 'أسبوع واحد', 'أسبوعان', 'أسابيع', 'أسبوعًا');
const _fmtMonths = n => _fmtUnit(n, 'شهر واحد', 'شهران', 'أشهر', 'شهرًا');
function _fmtYears(n){
  if (n <= 0) return null;
  if (n === 1) return 'سنة واحدة';
  if (n === 2) return 'سنتان';
  if (n >= 3 && n <= 10) return `${n} سنوات`;
  return `${n} سنة`;
}

export function computeAgeFromBio(bio, refDate){
  const birth = _getBirthDate(bio);
  if (!birth || Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  const ref = (refDate instanceof Date && !Number.isNaN(refDate.getTime())) ? refDate : today;
  if (ref.getTime() <= birth.getTime()) return null;

  let age = ref.getFullYear() - birth.getFullYear();
  const mDiff = ref.getMonth() - birth.getMonth();
  const dDiff = ref.getDate() - birth.getDate();
  if (mDiff < 0 || (mDiff === 0 && dDiff < 0)) age--;

  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

export function formatAgeFromBio(bio){
  const birth = _getBirthDate(bio);
  if (!birth || Number.isNaN(birth.getTime())) return null;

  const { ref, died } = _getDeathDateOrNull(bio, birth);
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  let diffDays = Math.floor((ref.getTime() - birth.getTime()) / MS_PER_DAY);
  if (diffDays < 0) return null;
  if (died && diffDays === 0) diffDays = 1;

  const prefix = died ? 'توفّي عن عمر ' : '';

  if (diffDays < 7)   return prefix + _fmtDays(diffDays);
  if (diffDays < 30)  return prefix + _fmtWeeks(Math.floor(diffDays / 7) || 1);
  if (diffDays < 365) return prefix + _fmtMonths(Math.floor(diffDays / 30) || 1);

  const years  = computeAgeFromBio(bio, ref);
  const yLabel = _fmtYears(years);
  return yLabel ? prefix + yLabel : null;
}

// نعتبر بعض الأسماء العامة (الأب/الأم/أب الزوجة/أم الزوجة...) كأنها بلا اسم
function isVirtualAncestorLike(entry){
  const nm = (entry && entry.name != null) ? String(entry.name).trim() : '';
  if (!nm || nm === '-' ) return true;
  const generic = ['الأب','الأم','أب الزوجة','أم الزوجة'];
  if (generic.includes(nm)) return true;
  if (/^جد الزوجة/u.test(nm) || /^جدة الزوجة/u.test(nm)) return true;
  return false;
}


/* =========================
   عرض حقول bio العامة
   ========================= */
const _hasValue = v => v != null && String(v).trim() && v !== '-';

export function renderBioInfo(container, bio){
  const wrap = el('div', 'bio-info');

  Object.keys(LABELS).forEach(k => {
    if (k === 'birthYear' && bio.birthDate) return;
    if (k === 'birthDate' && !bio.birthDate) return;
    if (k === 'deathYear' && bio.deathDate) return;
    if (k === 'deathDate' && !bio.deathDate && !bio.deathYear) return;

    const val = bio[k];
    if (_hasValue(val)){
      const row = el('div', 'bio-field');
      row.append(
        textEl('strong', LABELS[k] + ':'),
        textEl('span', String(val))
      );
      wrap.appendChild(row);
    }
  });

  if (!LABELS.birthDate && bio.birthDate){
    const row = el('div', 'bio-field');
    row.append(textEl('strong', 'تاريخ الميلاد:'), textEl('span', String(bio.birthDate)));
    wrap.appendChild(row);
  }

  const ageLabel = formatAgeFromBio(bio);
  if (ageLabel){
    const row = el('div', 'bio-field');
    row.append(textEl('strong', 'العمر:'), textEl('span', ageLabel));
    wrap.appendChild(row);
  }

  if (wrap.querySelectorAll('.bio-field').length > 0) container.appendChild(wrap);
}

export function renderListSection(container, title, arr, itemRenderer){
  if (!Array.isArray(arr) || !arr.length) return;
  const d = el('div'); d.append(textEl('h3', title));
  const ul = el('ul');
  arr.forEach(a => {
    const li = el('li');
    const label = itemRenderer ? itemRenderer(a) : (a?.name || a);
    li.textContent = String(label || '').trim();
    ul.appendChild(li);
  });
  d.appendChild(ul);
  container.appendChild(d);
}

/* =========================
   إدارة حالة أقسام السيرة
   ========================= */
const BIO_SECTION_KEYS = [
  'basic',      // البيانات الأساسية
  'family',     // العائلة (إخوة/أعمام/أخوال)
  'grands',     // الأسلاف والأجداد + الأحفاد
  'children',   // الأبناء والبنات
  'wives',      // الزوجات
  'timeline',   // الخط الزمني للأحداث
  'stories',    // القصص والمذكّرات
  'sources',    // المصادر والوثائق (NEW)
  'achievements',
  'hobbies'
];


const ALWAYS_ON_SECTIONS = ['basic'];

const BIO_SECTION_GROUPS = {
  family:   ['family'],
  grands:   ['grands'],
  children: ['children'],
  wives:    ['wives'],
  stories:  ['stories'],
  sources:  ['sources'],
  timeline: ['timeline'] 
};


const SUMMARY_ALLOWED_SECTIONS = new Set(['basic', 'achievements', 'hobbies']);

const DEFAULT_BIO_SECTIONS_ORDER = [...BIO_SECTION_KEYS];
const BIO_SECTIONS_STATE = new Map(); // personKey -> { [sectionId]: boolean }
let CURRENT_BIO_PERSON_KEY = null;

function getSectionOpenState(personKey, sectionId, fallbackOpen){
  if (!personKey) return !!fallbackOpen;
  const rec = BIO_SECTIONS_STATE.get(personKey);
  if (!rec || typeof rec[sectionId] !== 'boolean') return !!fallbackOpen;
  return rec[sectionId];
}

function setSectionOpenState(personKey, sectionId, isOpen){
  if (!personKey) return;
  const rec = BIO_SECTIONS_STATE.get(personKey) || {};
  rec[sectionId] = !!isOpen;
  BIO_SECTIONS_STATE.set(personKey, rec);
}

function getBioSectionsOrder(handlers){
  const mode   = handlers && handlers.bioMode;
  const custom = (handlers && Array.isArray(handlers.bioSectionsOrder)) ? handlers.bioSectionsOrder : null;

  // summary / الافتراضي
  if (!mode || mode === 'summary'){
    const src  = (custom && custom.length ? custom : DEFAULT_BIO_SECTIONS_ORDER);
    const seen = new Set();
    const out  = [];

    src.forEach(k => {
      if (!SUMMARY_ALLOWED_SECTIONS.has(k)) return;
      if (BIO_SECTION_KEYS.includes(k) && !seen.has(k)){
        seen.add(k);
        out.push(k);
      }
    });

    SUMMARY_ALLOWED_SECTIONS.forEach(k => {
      if (BIO_SECTION_KEYS.includes(k) && !seen.has(k)){
        seen.add(k);
        out.push(k);
      }
    });

    return out;
  }

  // الأوضاع المتخصصة
  if (BIO_SECTION_GROUPS[mode]){
    const active = new Set([...ALWAYS_ON_SECTIONS, ...BIO_SECTION_GROUPS[mode]]);
    const out = [];
    BIO_SECTION_KEYS.forEach(k => { if (active.has(k)) out.push(k); });
    return out;
  }

  // fallback
  const src  = (custom && custom.length ? custom : DEFAULT_BIO_SECTIONS_ORDER);
  const seen = new Set();
  const out  = [];

  src.forEach(k => {
    if (BIO_SECTION_KEYS.includes(k) && !seen.has(k)){
      seen.add(k);
      out.push(k);
    }
  });

  BIO_SECTION_KEYS.forEach(k => {
    if (!seen.has(k)){
      seen.add(k);
      out.push(k);
    }
  });

  return out;
}

// نفس منطق tree.js لقراءة الأعمام/العمّات/الأخوال/الخالات مع fallback من حقول الـ bio
function _splitTextList(text){
  return String(text || '')
    .split(/[,\u060C]/u)
    .map(s => s.trim())
    .filter(Boolean);
}

function getUnclesAuntsForPerson(person, family, ctx){
  if (!person || !family || !ctx) {
    return {
      paternalUncles: [],
      paternalAunts:  [],
      maternalUncles: [],
      maternalAunts:  []
    };
  }

  // 1) من سياق النَّسَب (الرسم البياني)
  const ua = Lineage.resolveUnclesAunts(person, family, ctx) || {};

  // نأخذ نسخًا قابلة للتعديل
  let pu = Array.isArray(ua.paternalUncles) ? ua.paternalUncles.slice() : [];
  let pa = Array.isArray(ua.paternalAunts)  ? ua.paternalAunts.slice()  : [];
  let mu = Array.isArray(ua.maternalUncles) ? ua.maternalUncles.slice() : [];
  let ma = Array.isArray(ua.maternalAunts)  ? ua.maternalAunts.slice()  : [];

  // 2) مكملات من الـ bio النصية (تُستخدم فقط إذا الجهة فارغة)
  const b = person.bio || {};

  const fBro = _splitTextList(b.fatherBrothersTxt);
  const fSis = _splitTextList(b.fatherSistersTxt);
  const mBro = _splitTextList(b.motherBrothersTxt);
  const mSis = _splitTextList(b.motherSistersTxt);

  // إن لم يوجد أعمام/عمّات من الرسم البياني نكمّل من النص
  if (!pu.length && fBro.length) pu = fBro;
  if (!pa.length && fSis.length) pa = fSis;
  if (!mu.length && mBro.length) mu = mBro;
  if (!ma.length && mSis.length) ma = mSis;

  return {
    paternalUncles: pu,
    paternalAunts:  pa,
    maternalUncles: mu,
    maternalAunts:  ma
  };
}



/* =========================
   كاشف الأقسام المتاحة
   ========================= */
function detectSectionPresence(bio, person, family){
  const out = {
    hasFamily:   false,
    hasGrands:   false,
    hasChildren: false,
    hasWives:    false,
    hasStories:  false,
    hasTimeline: false,
    hasSources:  false
  };


  bio = bio || {};
  if (!person || !family) return out;

  const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
  const hasNonEmptyName = p => {
    if (!p) return false;
    // يدعم الكائنات {name:...} وكذلك النصوص العادية "فلان"
    const nm = (typeof p === 'object') ? p.name : p;
    return !!String(nm || '').trim();
  };


  if (ctx){
    // العائلة: إخوة/أخوات/أعمام/عمات/أخوال/خالات
    const sib = Lineage.resolveSiblings(person, family, ctx) || {};
        const ua  = getUnclesAuntsForPerson(person, family, ctx);


    const brosAll = Array.isArray(sib.brothers) ? sib.brothers : [];
    const sisAll  = Array.isArray(sib.sisters)  ? sib.sisters  : [];
    const hasSiblingsNamed = [...brosAll, ...sisAll].some(hasNonEmptyName);

    const patUncles = Array.isArray(ua.paternalUncles) ? ua.paternalUncles : [];
    const patAunts  = Array.isArray(ua.paternalAunts)  ? ua.paternalAunts  : [];
    const matUncles = Array.isArray(ua.maternalUncles) ? ua.maternalUncles : [];
    const matAunts  = Array.isArray(ua.maternalAunts)  ? ua.maternalAunts  : [];

    const hasUnclesAuntsNamed = [
      ...patUncles,
      ...patAunts,
      ...matUncles,
      ...matAunts
    ].some(hasNonEmptyName);

    out.hasFamily = !!(hasSiblingsNamed || hasUnclesAuntsNamed);

    // الأسلاف والأجداد + الأحفاد
    const hasGrandBio = [
      'paternalGrandfather','paternalGrandmother','paternalGrandmotherClan',
      'maternalGrandfather','maternalGrandmother','maternalGrandmotherClan',
      'maternalGrandfatherClan','motherClan'
    ].some(k => _hasValue(bio[k]));

    // سلسلة الأسلاف الفعلية من شجرة النسب (مهمّة خصوصًا للزوجة)
    const ancRaw            = resolveAncestorsForPerson(person, family, ctx, { maxDepth: 5 }) || [];
    const ancNamed          = ancRaw.filter(a => !isVirtualAncestorLike(a));
    const hasAncestorsChain = ancNamed.length > 0;

    const gkidsAll          = Lineage.resolveGrandchildren(person, family, ctx) || [];
    const hasNamedGrandkids = gkidsAll.some(hasNonEmptyName);

    // نعتبر وجود القسم عند أي من:
    // - بيانات أجداد في الـ bio
    // - أو سلسلة أسلاف حقيقية من الشجرة
    // - أو وجود أحفاد
    out.hasGrands = !!(hasGrandBio || hasAncestorsChain || hasNamedGrandkids);


    // الأبناء والبنات (نفس منطق buildChildrenSection لكن بالجنس)
    let kids = [];
    if (Array.isArray(person.children) && person.children.length){
      kids = person.children;
    } else if (Array.isArray(person.childrenIds) && person.childrenIds.length){
      kids = person.childrenIds.map(id => ctx.byId.get(String(id))).filter(Boolean);
    } else {
      const isRoot =
        (person === family.rootPerson) ||
        (String(person.role || '').trim() === 'صاحب الشجرة');
      if (isRoot){
        kids = (Array.isArray(family.wives) ? family.wives : [])
          .flatMap(w => Array.isArray(w.children) ? w.children : []);
      }
    }

    const sons = kids.filter(c =>
      c && hasNonEmptyName(c) && inferGender(c) === 'M'
    );
    const daughters = kids.filter(c =>
      c && hasNonEmptyName(c) && inferGender(c) === 'F'
    );

    out.hasChildren = !!(sons.length || daughters.length);

    // الزوجات
    let wives = [];
    const isRootPerson =
      (person === family.rootPerson) ||
      (String(person.role || '').trim() === 'صاحب الشجرة');

    if (isRootPerson){
      wives = Array.isArray(family.wives) ? family.wives : [];
    } else if (Array.isArray(person.wives)){
      wives = person.wives;
    }

    out.hasWives = wives.some(hasNonEmptyName);
  }

  // القصص والمذكّرات
  const stories = Array.isArray(person.stories) ? person.stories
    : (Array.isArray(person.bio?.stories) ? person.bio.stories : []);
  out.hasStories = stories.length > 0;

  // الأحداث (الخط الزمني)
  const events = Array.isArray(person.events) ? person.events : [];
  out.hasTimeline = events.length > 0;

  // المصادر والوثائق
  const sources = Array.isArray(person.sources) ? person.sources : [];
  out.hasSources = sources.length > 0;

  return out;
}



/* =========================
   بناء أقسام السيرة
   ========================= */
function createBioSection(id, title, { defaultOpen = true, collapsible = true } = {}){
  const sec  = el('section', 'bio-section');
  const body = el('div', 'bio-section-body');
  sec.dataset.sectionId = id;

  if (!collapsible){
    const header = el('div', 'bio-section-header');
    header.append(textEl('span', title, 'bio-section-title'));
    sec.append(header, body);
    return { section: sec, body };
  }

  const personKey  = CURRENT_BIO_PERSON_KEY;
  const isOpenInit = getSectionOpenState(personKey, id, defaultOpen);

  const headerBtn = document.createElement('button');
  headerBtn.type  = 'button';
  headerBtn.className = 'bio-section-header';
  headerBtn.setAttribute('aria-expanded', isOpenInit ? 'true' : 'false');

  const titleSpan  = textEl('span', title, 'bio-section-title');
  const toggleSpan = textEl('span', isOpenInit ? '▼' : '▶', 'bio-section-toggle');

  headerBtn.append(titleSpan, toggleSpan);

  if (!isOpenInit){
    body.hidden = true;
    sec.classList.add('collapsed');
  }

  headerBtn.addEventListener('click', () => {
    const isOpen = headerBtn.getAttribute('aria-expanded') === 'true';
    const next   = !isOpen;

    headerBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
    body.hidden = !next;
    sec.classList.toggle('collapsed', !next);
    toggleSpan.textContent = next ? '▼' : '▶';
    setSectionOpenState(personKey, id, next);
  });

  sec.append(headerBtn, body);
  return { section: sec, body };
}

function addBioRow(parent, label, value, fieldKey = ''){
  if (value == null) return;
  const v = String(value).trim();
  if (!v || v === '-') return;

  const rowClass = fieldKey ? `bio-field bio-field--${fieldKey}` : 'bio-field';
  const row = el('div', rowClass);

  row.append(
    textEl('strong', label + ':'),
    textEl('span', v)
  );
  parent.appendChild(row);
}


function renderClickableNames(parent, title, arr, handlers, itemRenderer){
  if (!Array.isArray(arr) || !arr.length) return;

  const sec = el('div', 'bio-sublist');
  if (title) sec.append(textEl('h3', title));

  const ul = el('ul');

  arr.forEach(x => {
    const nm = (x && x.name) ? String(x.name).trim() : String(x || '').trim();
    if (!nm) return;

    const li       = el('li', 'bio-li');
    const rendered = itemRenderer ? itemRenderer(x, nm) : nm;

    if (rendered && rendered.nodeType){
      li.appendChild(rendered);
    } else {
      li.textContent = String(rendered || '').trim();
    }

    const id = x && x._id;

    // NEW: نجعل الاسم قابلاً للنقر فقط إذا كان لهذا الشخص بطاقة مرسومة في الشجرة
    const canClick = id && isPersonRendered(id) && handlers?.onShowDetails;

    if (canClick){
      li.classList.add('clickable');
      li.style.cursor = 'pointer';
      li.addEventListener('click', ev => {
        ev.stopPropagation();
        handlers.onShowDetails(id);
      });
    }


    ul.appendChild(li);
  });

  if (ul.children.length){
    sec.appendChild(ul);
    parent.appendChild(sec);
  }
}

/* ===== 1) البيانات الأساسية ===== */
function buildBasicSection(bio, person, family){
  const { section, body } = createBioSection('basic', 'البيانات الأساسية', {
    defaultOpen: true,
    collapsible: false
  });

  // الاسم / اللقب / المهنة
  addBioRow(body, LABELS.fullName   || 'الإسم',        bio.fullName || bio.fullname || '', 'fullName');
  addBioRow(body, LABELS.cognomen   || 'اللقب',        bio.cognomen,   'cognomen');
  addBioRow(body, LABELS.occupation || 'المهنة',       bio.occupation, 'occupation');

  // الأب / الأم / مكان الميلاد
  addBioRow(body, LABELS.fatherName || 'اسم الأب',     bio.fatherName, 'fatherName');
  addBioRow(body, LABELS.motherName || 'اسم الأم',     bio.motherName, 'motherName');
  addBioRow(body, LABELS.birthPlace || 'مكان الميلاد', bio.birthPlace, 'birthPlace');

  // الميلاد
  if (bio.birthDate && bio.birthDate !== '-'){
    addBioRow(body, LABELS.birthDate || 'تاريخ الميلاد', bio.birthDate, 'birthDate');
  } else if (bio.birthYear && bio.birthYear !== '-'){
    addBioRow(body, LABELS.birthYear || 'سنة الميلاد',   bio.birthYear, 'birthYear');
  }

  // الوفاة
  if (bio.deathDate && bio.deathDate !== '-'){
    addBioRow(body, LABELS.deathDate || 'تاريخ الوفاة', bio.deathDate, 'deathDate');
  } else if (bio.deathYear && bio.deathYear !== '-'){
    addBioRow(body, LABELS.deathYear || 'سنة الوفاة',   bio.deathYear, 'deathYear');
  }

  // العمر
  const ageLabel = formatAgeFromBio(bio);
  if (ageLabel){
    const diedNow = !!(
      (bio.deathDate && bio.deathDate !== '-') ||
      (bio.deathYear && bio.deathYear !== '-')
    );

    const row = el('div', 'bio-field bio-field--age');
    row.append(textEl('strong', 'العمر:'));

    const ageSpan = textEl('span', ageLabel, diedNow ? 'age-dead' : 'age-alive');
    row.append(ageSpan);
    body.appendChild(row);
  }

  // القبيلة / العشيرة / عشيرة الأم
  const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
  const resolvedTribe = person && family ? Lineage.resolveTribe(person, family, ctx) : (bio.tribe || '');
  const resolvedClan  = person && family ? Lineage.resolveClan(person, family, ctx)  : (bio.clan  || '');

  addBioRow(body, LABELS.tribe      || 'القبيلة',    resolvedTribe,  'tribe');
  addBioRow(body, LABELS.clan       || 'العشيرة',    resolvedClan,   'clan');
  addBioRow(body, LABELS.motherClan || 'عشيرة الأم', bio.motherClan, 'motherClan');

  // ملاحظة
  addBioRow(body, LABELS.remark || 'ملاحظة', bio.remark, 'remark');

  // ملخّص سريع للأسلاف والأحفاد
  if (person && family && ctx){
    const gkids = Lineage.resolveGrandchildren(person, family, ctx) || [];
    const gSons = gkids.filter(x => inferGender(x) === 'M');
    const gDau  = gkids.filter(x => inferGender(x) === 'F');

    const ancRaw   = resolveAncestorsForPerson(person, family, ctx, { maxDepth: 5 }) || [];
    const ancChain = ancRaw.filter(a => !isVirtualAncestorLike(a));

    if (gkids.length || ancChain.length){
      const row = el('div', 'bio-field bio-field--relSummary');
      row.append(textEl('strong', 'ملخّص نسبي:'));

      const parts = [];

      const gender      = inferGender(person);
      const basePronoun = (gender === 'F') ? 'لها'  : 'له';
      const andPronoun  = (gender === 'F') ? 'ولها' : 'وله';

      if (gkids.length){
        parts.push(
          `${basePronoun} ${gkids.length} من الأحفاد ` +
          `(أحفاد: ${gSons.length}، حفيدات: ${gDau.length})`
        );
      }

      if (ancChain.length){
        const prefix = parts.length ? andPronoun : basePronoun;
        parts.push(`${prefix} سلسلة أسلاف من ${ancChain.length} جيل`);
      }

      row.append(textEl('span', ' ' + parts.join('، ')));
      body.appendChild(row);
    }
  }

  if (!body.querySelector('.bio-field')){
    const r = String(person?.role || '').trim();
    const isAncestorLike = r.startsWith('الجد') || r === 'الأب' || person === family?.father;
    if (isAncestorLike){
      addBioRow(body, 'ملاحظة', 'لا توجد بيانات سيرة مسجّلة لهذا الشخص حالياً.', 'remark');
      return section;
    }
    return null;
  }
  return section;
}

/* ===== 2) الأسلاف والأجداد + الأحفاد ===== */
function buildGrandsSection(bio, person, family, handlers){
  const { section, body } = createBioSection('grands', 'الأسلاف والأجداد', { defaultOpen: true });

  const fatherSide = el('div', 'bio-subsection');
  fatherSide.append(textEl('h3', 'جهة الأب'));
  addBioRow(fatherSide, 'اسم الجد',    bio.paternalGrandfather);
  addBioRow(fatherSide, 'اسم الجدة',   bio.paternalGrandmother);
  addBioRow(fatherSide, 'عشيرة الجدة', bio.paternalGrandmotherClan);

  const motherSide = el('div', 'bio-subsection');
  motherSide.append(textEl('h3', 'جهة الأم'));
  addBioRow(motherSide, 'اسم الجد',  bio.maternalGrandfather);
  addBioRow(motherSide, 'اسم الجدة', bio.maternalGrandmother);
  const derivedMaternalClan = bio.maternalGrandfatherClan || bio.motherClan || '';
  addBioRow(motherSide, 'عشيرة الجد',  derivedMaternalClan);
  addBioRow(motherSide, 'عشيرة الجدة', bio.maternalGrandmotherClan);

  const hasFatherSide = !!fatherSide.querySelector('.bio-field');
  const hasMotherSide = !!motherSide.querySelector('.bio-field');

  if (hasFatherSide) body.appendChild(fatherSide);
  if (hasMotherSide) body.appendChild(motherSide);

  const ctx = (person && family) ? (window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family)) : null;
  if (ctx){
    // 1) سلسلة الأسلاف (من سياق النسب)
    const chainRaw   = resolveAncestorsForPerson(person, family, ctx, { maxDepth: 5 }) || [];
    const chainNamed = chainRaw.filter(a => !isVirtualAncestorLike(a));

    if (chainNamed.length){
      // نضيف رتبة لكل سلف (1 = الأقرب لهذا الشخص)
      const chainWithRank = chainNamed.map((a, idx) => ({
        ...a,
        __ancRank: idx + 1
      }));


      // هل الشخص الحالي زوجة؟ (حتى نخفي الأدوار مثل "أب الزوجة" في عرض سيرتها)
      const personRole   = String(person?.role || '').trim();
      const isWifePerson = (personRole === 'زوجة' || personRole.startsWith('الزوجة'));

      renderClickableNames(
        body,
        `سلسلة الأسلاف (${chainWithRank.length})`,
        chainWithRank,
        handlers,
        (a, nm) => {
          const frag  = document.createDocumentFragment();
          const main  = el('div', 'grand-ancestor-name');
          const meta  = el('div', 'grand-ancestor-meta');

          const name = nm || String(a?.name || '').trim();
          const rank = Number.isFinite(+a.__ancRank) ? +a.__ancRank : 1;
          const role = String(a?.role || '').trim();

          main.textContent = name;

          // التسمية النسبيّة لهذا الشخص
          let label;
          if (rank === 1){
            // الأقرب مباشرة = الأب
            label = 'الأب';
          } else {
            // من بعده: الجد الأول، الجد الثاني، ...
            label = `الجد ${getArabicOrdinal(rank - 1)}`;
          }

          // هل نعرض الدور بين قوسين؟
          // - لا نعرضه إذا:
          //   * كنا في سيرة الزوجة نفسها، وكان الدور مرتبطًا بها (مثل "أب الزوجة" أو "جد الزوجة...")
          //   * أو كان الدور نفسه "الأب" أو يبدأ بـ "الجد" (لا فائدة من تكراره)
          const isWifeRole = /زوجة/u.test(role); // يحتوي على "زوجة" (أب الزوجة، جد الزوجة من جهة ...)
          const shouldShowRole =
            !!role &&
            role !== 'الأب' &&
            !role.startsWith('الجد') &&
            !(isWifePerson && isWifeRole);

          if (shouldShowRole){
            meta.textContent = `${label} (${role})`;
          } else {
            meta.textContent = label;
          }

          frag.append(main, meta);
          return frag;
        }
      );
    }

    // 2) الأحفاد (ملخّص عددي + قائمة قابلة للنقر)
    const gkids = Lineage.resolveGrandchildren(person, family, ctx) || [];
    if (gkids.length){
      const gSons = gkids.filter(x => inferGender(x) === 'M');
      const gDau  = gkids.filter(x => inferGender(x) === 'F');

          // ملخص عددي أعلى القسم
      const summary = el('div', 'bio-grandkids-summary');
      summary.textContent =
        `أحفاد: ${gkids.length} (أحفاد: ${gSons.length}، حفيدات: ${gDau.length})`;
      body.appendChild(summary);


      const showedSplit = (gSons.length || gDau.length);

      if (gSons.length)
        renderClickableNames(body, `أحفاد (${gSons.length})`, gSons, handlers);

      if (gDau.length)
        renderClickableNames(body, `حفيدات (${gDau.length})`, gDau, handlers);

      if (!showedSplit){
        renderClickableNames(body, `الأحفاد (${gkids.length})`, gkids, handlers);
      }
    }
  }


  if (!body.children.length) return null;
  return section;
}


/* ===== 3) العائلة: الإخوة/الأعمام/الأخوال ===== */
function buildFamilySection(bio, person, family, handlers){
  const { section, body } = createBioSection('family', 'العائلة', { defaultOpen: true });

  const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
  const sib = Lineage.resolveSiblings(person, family, ctx) || {};
  const brosAll = Array.isArray(sib.brothers) ? sib.brothers : [];
  const sisAll  = Array.isArray(sib.sisters)  ? sib.sisters  : [];

  const parentIdsOf = p => {
    if (!p) return { fatherId: null, motherId: null };
    const pr = Lineage.getParents(p, family, ctx);
    return {
      fatherId: pr.father?._id ? String(pr.father._id) : (p.fatherId || p.bio?.fatherId || null),
      motherId: pr.mother?._id ? String(pr.mother._id) : (p.motherId || p.bio?.motherId || null)
    };
  };

  const selfP        = parentIdsOf(person);
  const selfFatherId = selfP.fatherId;
  const selfMotherId = selfP.motherId;

  const formatPaternalNode = (s, baseName) => {
    const frag = document.createDocumentFragment();
    frag.appendChild(textEl('div', baseName, 'sib-name'));
    if (!s) return frag;

    const mId = parentIdsOf(s).motherId;
    if (!mId) return frag;

    const wives = Array.isArray(family?.wives) ? family.wives : [];
    const idx   = wives.findIndex(w => w && String(w._id) === String(mId));
    const wife  = idx >= 0 ? wives[idx] : null;

    const meta = el('div', 'sib-meta');

    if (wife){
      const ord   = getArabicOrdinalF(idx + 1);
      const wName = String(wife.name || '').trim();

      if (wName){
        meta.innerHTML = `من زوجة الأب: ${ord} «${highlight(wName)}»`;
      } else {
        meta.textContent = `من زوجة الأب: ${ord}`;
      }
    } else {
      const mName = String(s?.bio?.motherName || s?.motherName || '').trim();
      meta.textContent = mName ? `من زوجة الأب: «${mName}»` : 'من زوجة الأب';
    }

    frag.appendChild(meta);
    return frag;
  };

  const splitDetailed = list => {
    const out = { full: [], paternal: [], maternal: [], unknown: [] };

    list.forEach(s => {
      if (!s) return;
      const sp = parentIdsOf(s);
      const fId = sp.fatherId;
      const mId = sp.motherId;

      const sameFather = selfFatherId && fId && selfFatherId === fId;
      const sameMother = selfMotherId && mId && selfMotherId === mId;

      if (sameFather && sameMother) out.full.push(s);
      else if (sameFather)          out.paternal.push(s);
      else if (sameMother)          out.maternal.push(s);
      else                          out.unknown.push(s);
    });

    return out;
  };

  const bros = splitDetailed(brosAll);
  const sis  = splitDetailed(sisAll);

  const anyDetailed =
    bros.full.length || bros.paternal.length || bros.maternal.length ||
    sis.full.length  || sis.paternal.length  || sis.maternal.length;

  if (anyDetailed){
    if (bros.full.length)
      renderClickableNames(body, `الإخوة الأشقاء (${bros.full.length})`, bros.full, handlers);

    if (bros.paternal.length)
      renderClickableNames(
        body,
        `الإخوة لأب (${bros.paternal.length})`,
        bros.paternal,
        handlers,
        (s, nm) => formatPaternalNode(s, nm)
      );

    if (bros.maternal.length)
      renderClickableNames(body, `الإخوة لأم (${bros.maternal.length})`, bros.maternal, handlers);

    if (sis.full.length)
      renderClickableNames(body, `الأخوات الشقيقات (${sis.full.length})`, sis.full, handlers);

    if (sis.paternal.length)
      renderClickableNames(
        body,
        `الأخوات لأب (${sis.paternal.length})`,
        sis.paternal,
        handlers,
        (s, nm) => formatPaternalNode(s, nm)
      );

    if (sis.maternal.length)
      renderClickableNames(body, `الأخوات لأم (${sis.maternal.length})`, sis.maternal, handlers);

    if (bros.unknown.length)
      renderClickableNames(body, `إخوة آخرون (${bros.unknown.length})`, bros.unknown, handlers);

    if (sis.unknown.length)
      renderClickableNames(body, `أخوات أخريات (${sis.unknown.length})`, sis.unknown, handlers);
  } else {
    renderClickableNames(body, `الإخوة (${brosAll.length})`, brosAll, handlers);
    renderClickableNames(body, `الأخوات (${sisAll.length})`, sisAll, handlers);
  }

  const ua        = getUnclesAuntsForPerson(person, family, ctx);
  const patUncles = ua.paternalUncles || [];
  const patAunts  = ua.paternalAunts  || [];
  const matUncles = ua.maternalUncles || [];
  const matAunts  = ua.maternalAunts  || [];

  if (patUncles.length)
    renderClickableNames(body, `الأعمام (${patUncles.length})`, patUncles, handlers);
  if (patAunts.length)
    renderClickableNames(body, `العمّات (${patAunts.length})`, patAunts, handlers);
  if (matUncles.length)
    renderClickableNames(body, `الأخوال (${matUncles.length})`, matUncles, handlers);
  if (matAunts.length)
    renderClickableNames(body, `الخالات (${matAunts.length})`, matAunts, handlers);

  if (!body.children.length) return null;
  return section;
}

/* ===== 4) الزوجات ===== */
function buildWivesSection(person, family, handlers){
  let wives = [];
  if (family && (person === family.rootPerson || (person?.role || '').trim() === 'صاحب الشجرة')){
    wives = Array.isArray(family?.wives) ? family.wives : [];
  } else if (Array.isArray(person?.wives) && person.wives.length){
    wives = person.wives;
  }

  if (!wives.length) return null;

  const { section, body } = createBioSection('wives', `الزوجات (${wives.length})`, { defaultOpen: true });
  renderClickableNames(body, '', wives, handlers);
  if (!body.children.length) return null;
  return section;
}

/* ===== 5) الأبناء والبنات ===== */
function buildChildrenSection(person, family, handlers){
  let kids = [];

  if (person && Array.isArray(person.children) && person.children.length){
    kids = person.children;
  } else if (person && Array.isArray(person.childrenIds) && person.childrenIds.length && family){
    const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
    kids = person.childrenIds.map(id => ctx.byId.get(String(id))).filter(Boolean);
  } else if (family && (person === family.rootPerson || (person?.role || '').trim() === 'صاحب الشجرة')){
    kids = (family.wives || []).flatMap(w => Array.isArray(w.children) ? w.children : []);
  }

  if (!kids.length) return null;

  const sons      = kids.filter(c => inferGender(c) === 'M');
  const daughters = kids.filter(c => inferGender(c) === 'F');

  if (!sons.length && !daughters.length) return null;

  const { section, body } = createBioSection('children', 'أبناء وبنات', { defaultOpen: true });

  if (sons.length)
    renderClickableNames(body, `أبناء (${sons.length})`, sons, handlers);
  if (daughters.length)
    renderClickableNames(body, `بنات (${daughters.length})`, daughters, handlers);

  if (!body.children.length) return null;
  return section;
}

/* ===== 6) القصص والمذكّرات ===== */
function buildStoriesSection(person, handlers){
  if (!person) return null;

  // كل المحتوى سيتم بناؤه داخل createStoriesSection
  const root = createStoriesSection(person, handlers);

  if (!root) return null;

  // نضمن وجود كلاس bio-section + معرّف القسم ليستفيد منه السكрол
  root.classList.add('bio-section', 'bio-section-stories');
  root.dataset.sectionId = 'stories';

  return root;
}

/* ===== 6b) المصادر والوثائق ===== */
function buildSourcesSection(person, handlers){
  if (!person) return null;

  // كل المحتوى سيتم بناؤه داخل createSourcesSection
  const root = createSourcesSection(person, handlers);
  if (!root) return null;

  // نضمن وجود كلاس bio-section + معرّف القسم ليستفيد منه السكول/الوضع
  root.classList.add('bio-section', 'bio-section-sources');
  root.dataset.sectionId = 'sources';

  return root;
}


/* ===== X) الخط الزمني للأحداث ===== */
function buildTimelineSection(person, handlers){
  if (!person) return null;

  // كل المحتوى سيتم بناؤه داخل createEventsSection
  const root = createEventsSection(person, handlers);
  if (!root) return null;

  // نضمن وجود كلاس bio-section + معرّف القسم ليستفيد منه السكول/الوضع
  root.classList.add('bio-section', 'bio-section-timeline');
  root.dataset.sectionId = 'timeline';

  return root;
}


/* ===== 7) الإنجازات ===== */
function buildAchievementsSection(bio){
  const list = Array.isArray(bio.achievements) ? bio.achievements.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  if (!list.length) return null;

  const { section, body } = createBioSection('achievements', 'الإنجازات', { defaultOpen: true });
  const ul = el('ul');

  list.forEach(item => {
    const li = el('li');
    li.textContent = item;
    ul.appendChild(li);
  });

  body.appendChild(ul);
  return section;
}

/* ===== 8) الهوايات ===== */
function buildHobbiesSection(bio){
  const hobbies = Array.isArray(bio.hobbies) ? bio.hobbies.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  if (!hobbies.length) return null;

  const { section, body } = createBioSection('hobbies', 'الهوايات', { defaultOpen: true });
  const wrap = el('div', 'hobbies');

  hobbies.forEach(h => {
    if (!h) return;
    wrap.append(textEl('span', h, 'hobby'));
  });

  body.appendChild(wrap);
  return section;
}

/* =========================
   الدالة الرئيسية
   ========================= */
export function renderBioSections(container, bio, person = null, family = null, handlers = {}){
  const wrap = el('div', 'bio-sections');
  CURRENT_BIO_PERSON_KEY = person && person._id ? String(person._id) : null;

  const builders = {
    basic:        () => buildBasicSection(bio, person, family),
    grands:       () => buildGrandsSection(bio, person, family, handlers),
    family:       () => buildFamilySection(bio, person, family, handlers),
    wives:        () => buildWivesSection(person, family, handlers),
    children:     () => buildChildrenSection(person, family, handlers),
    timeline:     () => buildTimelineSection(person, handlers),
    stories:      () => buildStoriesSection(person, handlers),
    sources:      () => buildSourcesSection(person, handlers),
    achievements: () => buildAchievementsSection(bio),
    hobbies:      () => buildHobbiesSection(bio)
  };


  const order = getBioSectionsOrder(handlers);
  order.forEach(key => {
    const fn = builders[key];
    if (!fn) return;
    const sec = fn();
    if (sec) wrap.appendChild(sec);
  });

  if (wrap.children.length) container.appendChild(wrap);
}

/* =========================
   أوضاع السيرة المتاحة
   ========================= */
export function getAvailableBioModes(bio, person, family){
  const p = detectSectionPresence(bio || {}, person || null, family || null);
  const modes = [{ value:'summary', label:'السيرة المختصرة' }]; // دائمًا متاح
  if (p.hasFamily)   modes.push({ value:'family',   label:'العائلة' });
  if (p.hasGrands)   modes.push({ value:'grands',   label:'الأسلاف والأجداد' });
  if (p.hasChildren) modes.push({ value:'children', label:'الأبناء والبنات' });
  if (p.hasWives)    modes.push({ value:'wives',    label:'الزوجات' });

  // نُظهر القصص/الخط الزمني/المصادر دائمًا لإتاحة الإضافة حتى لو لا توجد بيانات بعد
  modes.push({ value:'stories',  label:'القصص والمذكّرات' });
  modes.push({ value:'sources',  label:'المصادر والوثائق' });
  modes.push({ value:'timeline', label:'الخطّ الزمني للأحداث' });

  return modes;
}