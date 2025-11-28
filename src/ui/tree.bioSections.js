// tree.bioSections.js — أقسام السيرة داخل تفاصيل الشخص

import { el, textEl, highlight, getArabicOrdinalF } from '../utils.js';
import { LABELS } from '../model/families.js';
import * as Lineage from '../features/lineage.js';
import { createStoriesSection } from '../features/person.stories.js';

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
  'stories',    // القصص والمذكّرات
  'achievements',
  'hobbies'
];

const ALWAYS_ON_SECTIONS = ['basic'];

const BIO_SECTION_GROUPS = {
  family:   ['family'],
  grands:   ['grands'],
  children: ['children'],
  wives:    ['wives'],
  stories:  ['stories']
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

/* =========================
   كاشف الأقسام المتاحة
   ========================= */
function detectSectionPresence(bio, person, family){
  const out = {
    hasFamily:   false,
    hasGrands:   false,
    hasChildren: false,
    hasWives:    false,
    hasStories:  false
  };

  bio = bio || {};
  if (!person || !family) return out;

  const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
  const hasNonEmptyName = p => !!(p && String(p.name || '').trim());

  if (ctx){
    // العائلة: إخوة/أخوات/أعمام/عمات/أخوال/خالات
    const sib = Lineage.resolveSiblings(person, family, ctx) || {};
    const ua  = Lineage.resolveUnclesAunts(person, family, ctx) || {};

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

    const gkidsAll          = Lineage.resolveGrandchildren(person, family, ctx) || [];
    const hasNamedGrandkids = gkidsAll.some(hasNonEmptyName);

    out.hasGrands = !!(hasGrandBio || hasNamedGrandkids);

    // الأبناء والبنات (نفس منطق buildChildrenSection)
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
      c && (c.role || '').trim() === 'ابن' && hasNonEmptyName(c)
    );
    const daughters = kids.filter(c =>
      c && (c.role || '').trim() === 'بنت' && hasNonEmptyName(c)
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

function addBioRow(parent, label, value){
  if (value == null) return;
  const v = String(value).trim();
  if (!v || v === '-') return;
  const row = el('div', 'bio-field');
  row.append(textEl('strong', label + ':'), textEl('span', v));
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
    if (id && handlers?.onShowDetails){
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

  addBioRow(body, LABELS.fullName   || 'الإسم',  bio.fullName || bio.fullname || '');
  addBioRow(body, LABELS.cognomen   || 'اللقب',  bio.cognomen);
  addBioRow(body, LABELS.occupation || 'المهنة', bio.occupation);

  addBioRow(body, LABELS.fatherName || 'اسم الأب', bio.fatherName);
  addBioRow(body, LABELS.motherName || 'اسم الأم', bio.motherName);
  addBioRow(body, LABELS.birthPlace || 'مكان الميلاد', bio.birthPlace);

  if (bio.birthDate && bio.birthDate !== '-'){
    addBioRow(body, LABELS.birthDate || 'تاريخ الميلاد', bio.birthDate);
  } else if (bio.birthYear && bio.birthYear !== '-'){
    addBioRow(body, LABELS.birthYear || 'سنة الميلاد', bio.birthYear);
  }

  if (bio.deathDate && bio.deathDate !== '-'){
    addBioRow(body, LABELS.deathDate || 'تاريخ الوفاة', bio.deathDate);
  } else if (bio.deathYear && bio.deathYear !== '-'){
    addBioRow(body, LABELS.deathYear || 'سنة الوفاة', bio.deathYear);
  }

  const ageLabel = formatAgeFromBio(bio);
  if (ageLabel){
    const diedNow = !!(
      (bio.deathDate && bio.deathDate !== '-') ||
      (bio.deathYear && bio.deathYear !== '-')
    );
    const row = el('div', 'bio-field');
    row.append(textEl('strong', 'العمر:'));
    const ageSpan = textEl('span', ageLabel, diedNow ? 'age-dead' : 'age-alive');
    row.append(ageSpan);
    body.appendChild(row);
  }

  const ctx = window.__LINEAGE_CTX__ || Lineage.buildLineageContext(family);
  const resolvedTribe = person && family ? Lineage.resolveTribe(person, family, ctx) : (bio.tribe || '');
  const resolvedClan  = person && family ? Lineage.resolveClan(person, family, ctx)  : (bio.clan  || '');

  addBioRow(body, LABELS.tribe      || 'القبيلة',    resolvedTribe);
  addBioRow(body, LABELS.clan       || 'العشيرة',    resolvedClan);
  addBioRow(body, LABELS.motherClan || 'عشيرة الأم', bio.motherClan);
  addBioRow(body, LABELS.remark     || 'ملاحظة',     bio.remark);

  if (!body.querySelector('.bio-field')){
    const r = String(person?.role || '').trim();
    const isAncestorLike = r.startsWith('الجد') || r === 'الأب' || person === family?.father;
    if (isAncestorLike){
      addBioRow(body, 'ملاحظة', 'لا توجد بيانات سيرة مسجّلة لهذا الشخص حالياً.');
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
    const gkids = Lineage.resolveGrandchildren(person, family, ctx);
    if (gkids.length){
      const gSons = gkids.filter(x => (x.role || '').trim() === 'ابن');
      const gDau  = gkids.filter(x => (x.role || '').trim() === 'بنت');

      const showedSplit = (gSons.length || gDau.length);

      if (gSons.length)
        renderClickableNames(body, `أحفاد (أبناء) (${gSons.length})`, gSons, handlers);
      if (gDau.length)
        renderClickableNames(body, `أحفاد (بنات) (${gDau.length})`, gDau, handlers);

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

  const ua        = Lineage.resolveUnclesAunts(person, family, ctx);
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

  const sons      = kids.filter(c => (c?.role || '').trim() === 'ابن');
  const daughters = kids.filter(c => (c?.role || '').trim() === 'بنت');

  if (!sons.length && !daughters.length) return null;

  const { section, body } = createBioSection('children', 'الأبناء والبنات', { defaultOpen: true });

  if (sons.length)
    renderClickableNames(body, `الأبناء (${sons.length})`, sons, handlers);
  if (daughters.length)
    renderClickableNames(body, `البنات (${daughters.length})`, daughters, handlers);

  if (!body.children.length) return null;
  return section;
}

/* ===== 6) القصص والمذكّرات ===== */
function buildStoriesSection(person, handlers){
  if (!person) return null;

  // كل المحتوى سيتم بناؤه داخل createStoriesSection
  const root = createStoriesSection(person, handlers);

  // تعويضاً عن createBioSection — نستخدم العنصر كما هو من stories
  if (!root) return null;

  // نضمن أن يحتوي فقط على class "bio-section bio-section-stories"
  root.className = 'bio-section bio-section-stories';
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
    stories:      () => buildStoriesSection(person, handlers),
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
  modes.push({ value:'stories', label:'القصص والمذكّرات' }); // نُظهر خيار "القصص والمذكّرات" دائمًا لتمكين إضافة القصص حتى لو كان القسم فارغًا.
  return modes;
}
