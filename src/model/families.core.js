// model/families.core.js
// منطق المجال: التطبيع + النَّسَب + الفهرسة + الـ bio (بدون IndexedDB أو بذور)

// استيرادات عامة من الأدوات
import { getArabicOrdinal, getArabicOrdinalF } from '../utils.js';

// نسخة الـ Schema الحالية
export const SCHEMA_VERSION = 5;

// ================================
// 1) تطبيع نصوص وأسماء (عربي عام)
// ================================
export const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
export const AR_TATWEEL = /\u0640/gu;

export function norm(s = '', { keepPunct = false } = {}) {
  let out = String(s)
    .normalize('NFKD')
    .replace(AR_DIAC, '')
    .replace(AR_TATWEEL, '')
    .replace(/[\u0622\u0623\u0625]/gu, 'ا')
    .replace(/\u0649/gu, 'ي')
    .replace(/\u0629/gu, 'ه');

  if (!keepPunct) {
    out = out
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    out = out.replace(/\s+/g, ' ').trim();
  }
  return out;
}

// مفتاح تطابق بالاسم فقط (لا يُستخدم كمعرّف)
export function normKey(p){
  return norm((p?.name || '').toString().trim(), { keepPunct: true });
}

// ================================
// 2) ترحيل هيكل العائلة بين نسخ الـ Schema
// ================================
export function migrate(f, fromVer = 0, toVer = SCHEMA_VERSION) {
  if (!f || !Number.isFinite(fromVer)) return f;
  let v = +fromVer;

  // → v2: إزالة wives القديمة تحت rootPerson + grandson→rootPerson
  if (v < 2) {
    if (f.rootPerson && Array.isArray(f.rootPerson.wives)) delete f.rootPerson.wives;
    if (f.grandson && !f.rootPerson) { f.rootPerson = f.grandson; delete f.grandson; }
    if (f.fullGrandsonName && !f.fullRootPersonName) { f.fullRootPersonName = f.fullGrandsonName; delete f.fullGrandsonName; }
    v = 2;
  }

  // → v4: ancestors[] غير محدود + تنظيف الحقول التاريخية
  if (v < 4) {
    if (!Array.isArray(f.ancestors)) f.ancestors = [];
    if ('grandfather_1' in f) delete f.grandfather_1;
    if ('grandfather_2' in f) delete f.grandfather_2;

    f.ancestors = f.ancestors
      .filter(Boolean)
      .map((a, idx) => ({
        ...a,
        generation: Number.isFinite(+a.generation) ? +a.generation : (idx + 1) || 1
      }));

    v = 4;
  }

  f.__v = toVer;
  return f;
}

// ================================
// 3) قيم افتراضية للـ bio + التسميات
// ================================
export const DEFAULT_BIO = {
  fullName: '',
  name: '',
  fatherName: '',
  motherName: '',
  motherTribe: '',
  motherClan: '',
  tribe: '',
  clan: '',
  paternalGrandmotherTribe: '',
  maternalGrandmotherTribe: '',
  birthDate: '',
  birthYear: '',
  deathDate: '',
  deathYear: '',
  birthPlace: '',
  occupation: '',
  remark: '',
  siblingsBrothers: [],
  siblingsSisters: [],
  achievements: [],
  hobbies: [],
  photoUrl: ''
};

export const LABELS = {
  fullName: 'الإسم',
  cognomen: 'اللقب',
  fatherName: 'اسم الأب',
  tribe: 'القبيلة',
  clan: 'العشيرة',
  motherName: 'اسم الأم',
  motherTribe: 'قبيلة الأم',
  motherClan: 'عشيرة الأم',
  maternalGrandfather: 'اسم الجد من جهة الأم',
  maternalGrandmother: 'الجدة من جهة الأم',
   maternalGrandmotherTribe: 'قبيلة الجدة من جهة الأم',
  maternalGrandmotherClan: 'عشيرة الجدة من جهة الأم',
  paternalGrandmother: 'الجدة من جهة الأب',
  paternalGrandmotherTribe: 'قبيلة الجدة من جهة الأب',
  paternalGrandmotherClan: 'عشيرة الجدة من جهة الأب',
  paternalGrandfather: 'الجد من جهة الأب',

  birthDate: 'تاريخ الميلاد',
  birthYear: 'سنة الميلاد',
  deathDate: 'تاريخ الوفاة',
  deathYear: 'سنة الوفاة',

  birthPlace: 'مكان الميلاد',
  occupation: 'المهنة',
  remark: 'ملاحظة'
};

// مزامنة تاريخ الميلاد/الوفاة مع سنة الميلاد/الوفاة
export function normalizeLifeDatesOnBio(bio) {
  if (!bio || typeof bio !== 'object') return;

  const bd = String(bio.birthDate || '').trim();
  const by = String(bio.birthYear || '').trim();

  if (bd && (!by || by === '-') && /^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    bio.birthYear = bd.slice(0, 4);
  }

  const dd = String(bio.deathDate || '').trim();
  const dy = String(bio.deathYear || '').trim();

  if (dd && (!dy || dy === '-') && /^\d{4}-\d{2}-\d{2}$/.test(dd)) {
    bio.deathYear = dd.slice(0, 4);
  }
}

function _cloneDefaultBio(){
  const base = typeof structuredClone === 'function' ? structuredClone(DEFAULT_BIO)
    : JSON.parse(JSON.stringify(DEFAULT_BIO));
  normalizeLifeDatesOnBio(base);
  return base;
}

function _withBio(srcBio){
  const bio = Object.assign(_cloneDefaultBio(), srcBio || {});
  normalizeLifeDatesOnBio(bio);
  return bio;
}

export const cloneBio = (src = {}) => Object.assign(_cloneDefaultBio(), src || {});

// ================================
// 4) تطبيع الأبناء والزوجات
// ================================
export function normalizeChild(c){
  if (typeof c === 'string') {
    return {
      name: c,
      role: 'ابن',
      bio: _cloneDefaultBio(),
      stories: [],
      events: [],
      sources: [],
      education: [],
      career: [],

    };
  }
  const bio = _withBio(c?.bio);
  return {
    name: c?.name || '',
    role: c?.role || 'ابن',
    bio,
    _id: c?._id,
    stories: Array.isArray(c?.stories) ? c.stories : [],
    events: Array.isArray(c?.events) ? c.events : [],
    sources: Array.isArray(c?.sources) ? c.sources : [],
    education: Array.isArray(c?.education) ? c.education : [],
    career: Array.isArray(c?.career) ? c.career : [],

  };
}

export function normalizeWifeRole(role, idx){
  let r = String(role || '').trim() || 'زوجة';
  const m = r.match(/^ال?زوجة\s+(\d+)$/u);
  if (m) {
    const n = parseInt(m[1], 10) || (idx + 1) || 1;
    return `الزوجة ${getArabicOrdinalF(n)}`;
  }
  if (r === 'زوجة') return `الزوجة ${getArabicOrdinalF((idx + 1) || 1)}`;
  return r;
}

export function normalizeWife(w, idx){
  const wifeBio = _withBio(w?.bio);

  const ww = {
    _id: w?._id, // مهم جدًا: لا تسقط الـ id حتى لا تتكرر الإضافة لاحقًا
    name: w?.name || '',
    role: normalizeWifeRole(w?.role, idx),
    bio: wifeBio,

    //  حافظ على روابط الوالدين إن كانت موجودة (اختياري لكنه مفيد)
    fatherId: (w?.fatherId != null) ? w.fatherId : (w?.bio?.fatherId ?? null),
    motherId: (w?.motherId != null) ? w.motherId : (w?.bio?.motherId ?? null),

    stories: Array.isArray(w?.stories) ? w.stories : [],
    events: Array.isArray(w?.events) ? w.events : [],
    sources: Array.isArray(w?.sources) ? w.sources : [],
    education: Array.isArray(w?.education) ? w.education : [],
    career: Array.isArray(w?.career) ? w.career : [],

  };

  ww.children = (w?.children || []).map(normalizeChild);
  return ww;
}


// نسخة أعمق للاستيراد/التحميل
export function normalizeChildForLoad(c) {
  if (!c) return null;
  if (typeof c === 'string') {
    return {
      name: c,
      role: 'ابن',
      bio: {},
      fatherId: null,
      motherId: null,
      stories: [],
      events: [],
      sources: [],
      education: [],
      career: [],
      children: [],
      wives: []
    };
  }
  return {
    name: c.name || '',
    role: c.role || 'ابن',
    bio: c.bio || {},
    _id: c._id,
    fatherId: (c.fatherId != null) ? c.fatherId : (c.bio && c.bio.fatherId) || null,
    motherId: (c.motherId != null) ? c.motherId : (c.bio && c.bio.motherId) || null,
    stories: Array.isArray(c.stories) ? c.stories : [],
    events: Array.isArray(c.events) ? c.events : [],
    sources: Array.isArray(c.sources) ? c.sources : [],
    education: Array.isArray(c.education) ? c.education : [],
    career: Array.isArray(c.career) ? c.career : [],
    children: Array.isArray(c.children) ? c.children.map(normalizeChildForLoad).filter(Boolean) : [],
    wives: Array.isArray(c.wives) ? c.wives.map(normalizeWifeForLoad).filter(Boolean) : []
  };
}

export function normalizeWifeForLoad(w, i){
  const idxLabel = ['الأولى','الثانية','الثالثة','الرابعة','الخامسة'][i] || `رقم ${i+1}`;
  const roleLabel = w?.role || `الزوجة ${idxLabel}`;

  return {
    name: w?.name || '',
    role: roleLabel,
    bio: w?.bio || {},
    _id: w?._id,
    fatherId: w?.fatherId ?? w?.bio?.fatherId ?? null,
    motherId: w?.motherId ?? w?.bio?.motherId ?? null,
    stories: Array.isArray(w?.stories) ? w.stories : [],
    events: Array.isArray(w?.events) ? w.events : [],
    sources: Array.isArray(w?.sources) ? w.sources : [],
    education: Array.isArray(w?.education) ? w.education : [],
    career: Array.isArray(w?.career) ? w.career : [],
    children: Array.isArray(w?.children) ? w.children.map(normalizeChildForLoad).filter(Boolean) : []
  };
}

// ================================
// 5) تهيئة الأشخاص (Bio + Arrays)
// ================================
export function ensureStoriesArray(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.stories)) person.stories = [];
}

export function ensureEventsArray(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.events)) person.events = [];
}

export function ensureSourcesArray(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.sources)) person.sources = [];
}

export function ensureEducationArray(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.education)) person.education = [];
}

export function ensureCareerArray(person) {
  if (!person || typeof person !== 'object') return;
  if (!Array.isArray(person.career)) person.career = [];
}

export function ensureBio(person) {
  if (!person) return;

  person.bio = _withBio(person.bio);
  ensureStoriesArray(person);
  ensureEventsArray(person);
  ensureSourcesArray(person);
  ensureEducationArray(person);
  ensureCareerArray(person);

  if (Array.isArray(person.children)) {
    person.children = person.children.map(normalizeChild);
  }
  if (Array.isArray(person.wives)) {
    person.wives = person.wives.map(normalizeWife);
  }
}

// ضبط اسم كامل صاعد لشخص (إن لم يكن مكتوبًا يدويًا)
export function setAscFullName(person, chainNames){
  if (!person || !person.bio) return;

  const cur = String(person.bio.fullName || '').trim();
  if (cur) return;

  const selfName = String(person.name || '').trim();
  const rest = (chainNames || []).map(n => String(n || '').trim()).filter(Boolean);

  const parts = [selfName, ...rest].filter(Boolean);
  if (!parts.length) return;

  person.bio.fullName = parts.join(' ');
}

// تهيئة Bio للعائلة كاملة + الأجداد
export function ensureFamilyBios(f) {
  if (!f) return;

  ['father', 'rootPerson'].forEach(k => { if (f[k]) ensureBio(f[k]); });

  (f.wives || []).forEach(w => ensureBio(w));

  if (Array.isArray(f.wives)) {
    f.wives = f.wives.map((w, idx) => ({ ...w, role: normalizeWifeRole(w?.role, idx) }));
  }

  if (Array.isArray(f.ancestors)) {
    f.ancestors = f.ancestors.map(a => {
      ensureBio(a);
      const g0 = Number.isFinite(+a.generation) ? +a.generation : 1;
      let r = String(a.role || '').trim();

      const m = r.match(/^الجد\s*(\d+)$/u);
      if (m) {
        const n = parseInt(m[1], 10) || g0;
        r = `الجد ${getArabicOrdinal(n)}`;
      } else if (!r || r === 'جد' || /^الجد\s*\d+$/u.test(r)) {
        r = `الجد ${getArabicOrdinal(g0)}`;
      }
      return { ...a, generation: g0, role: r };
    });
  }

  const ancSorted = (Array.isArray(f.ancestors) ? f.ancestors.slice() : [])
    .map(a => ({ a, gen: Number.isFinite(+a.generation) ? +a.generation : 1 }))
    .sort((x, y) => (x.gen ?? 1) - (y.gen ?? 1))
    .map(x => x.a);

  const ancNames = ancSorted
    .map(a => String(a?.name || '').trim())
    .filter(Boolean);

  // الأب: اسمه + سلسلة الأجداد
  if (f.father) {
    setAscFullName(f.father, ancNames);
  }

  // الأجداد: كل واحد يأخذ من بعده
  ancSorted.forEach((a, idx) => {
    const rest = ancNames.slice(idx + 1);
    setAscFullName(a, rest);
  });

  // صاحب الشجرة: اسمه + سلسلة الأجداد (إن لم يُكتب fullName يدويًا)
  if (f.rootPerson) {
    setAscFullName(f.rootPerson, ancNames);
  }

  // الزوجات: نبني سلسلة بسيطة من جهة أبيها وجدّها من جهة الأب
  (f.wives || []).forEach(w => {
    if (!w || !w.bio) return;

    const chain = [];

    const fatherName = String(w.bio.fatherName || '').trim();
    if (fatherName) chain.push(fatherName);

    const gfName = String(w.bio.paternalGrandfather || '').trim();
    if (gfName) chain.push(gfName);

    setAscFullName(w, chain);
  });
}

// ================================
// 6) ضمان المعرفات + التطبيع المحفوظ
// ================================
export function ensureIds(f) {
  if (!f) return;
  const giveId = (obj, prefix = 'p') => {
    if (!obj) return;
    if (!obj._id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        obj._id = crypto.randomUUID();
      } else {
        obj._id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
      }
    }
  };
  const indexPerson = (p) => {
    giveId(p, 'p');
    if (p) {
      p._normName = norm(p.name || '');
      p._normRole = norm(p.role || '');
    }
    (p?.children || []).forEach(c => {
      giveId(c, 'c');
      if (c) {
        c._normName = norm(c.name || '');
        c._normRole = norm(c.role || '');
      }
    });
    (p?.wives || []).forEach(indexPerson);
  };

  [f.father, f.rootPerson, ...(f.wives || []), ...(Array.isArray(f.ancestors) ? f.ancestors : [])].forEach(indexPerson);
}

// ================================
// 7) أدوات نصية للنسب
// ================================
const SPLIT_RE = /[,\u060C]/u;

export function splitTextList(text) {
  return String(text || '')
    .split(SPLIT_RE)
    .map(s => s.trim())
    .filter(Boolean);
}

export function splitTextToNameObjects(text) {
  return splitTextList(text).map(name => ({ name }));
}

// ================================
// 8) تطبيع عائلة جديدة لتتوافق مع lineage
// ================================
export function normalizeNewFamilyForLineage(f){
  if (!f || typeof f !== 'object') return;

  const newId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2);
  };

  if (!f.rootPerson){
    f.rootPerson = { name:'', role:'صاحب الشجرة', bio:{}, children:[], wives:[] };
  }
  if (!Array.isArray(f.wives)){
    f.wives = Array.isArray(f.rootPerson.wives) ? f.rootPerson.wives : [];
  }
  f.rootPerson.wives = f.wives;

  function visit(p){
    if (!p) return;
    if (!p._id) p._id = newId();
    if (!p.bio) p.bio = {};
    if (!Array.isArray(p.children)) p.children = [];
    if (!Array.isArray(p.wives)) p.wives = [];
    if (!Array.isArray(p.stories)) p.stories = [];
    if (!Array.isArray(p.events)) p.events = [];
    if (!Array.isArray(p.sources)) p.sources = [];
    if (!Array.isArray(p.education)) p.education = [];
    if (!Array.isArray(p.career)) p.career = [];

    p.children.forEach(visit);
    p.wives.forEach(visit);
  }

  visit(f.rootPerson);
  f.wives.forEach(visit);
  if (f.father) visit(f.father);

  const rootId = f.rootPerson?._id || null;

  f.wives.forEach(w=>{
    const mid = w?._id || null;
    (w.children || []).forEach(c=>{
      if (!c) return;
      if (!c.fatherId) c.fatherId = rootId;
      if (!c.motherId) c.motherId = mid;

      c.father = c.fatherId;
      c.mother = c.motherId;

      if (!c.bio) c.bio = {};
      c.bio.fatherId = c.fatherId;
      c.bio.motherId = c.motherId;
    });
  });

  if (f.rootPerson && Array.isArray(f.rootPerson.children)) {
    f.rootPerson.children.forEach(c=>{
      if (!c) return;
      if (!c.fatherId) c.fatherId = rootId;
      if (c.motherId == null) c.motherId = null;

      c.father = c.fatherId;
      c.mother = c.motherId;

      if (!c.bio) c.bio = {};
      c.bio.fatherId = c.fatherId;
      c.bio.motherId = c.motherId;
    });
  }

  function backfillChildParentIds(p){
    if (!p) return;

    const r = String(p.role || '').trim();
    if (r === 'ابن' || r === 'بنت') {
      const bf = p.bio && p.bio.fatherId;
      const bm = p.bio && p.bio.motherId;

      if (!p.fatherId && bf) p.fatherId = bf;
      if (!p.motherId && bm) p.motherId = bm;

      if (!p.father && p.fatherId) p.father = p.fatherId;
      if (!p.mother && p.motherId) p.mother = p.motherId;
    }

    (p.children || []).forEach(backfillChildParentIds);
    (p.wives || []).forEach(backfillChildParentIds);
  }

  backfillChildParentIds(f.rootPerson);
  (f.wives || []).forEach(backfillChildParentIds);
  if (f.father) backfillChildParentIds(f.father);
  (f.ancestors || []).forEach(backfillChildParentIds);

  function fixSiblings(bio){
    if (!bio || typeof bio !== 'object') return;

    const bTxt = String(bio.brothersTxt || bio.siblingsBrothersTxt || '').trim();
    const sTxt = String(bio.sistersTxt  || bio.siblingsSistersTxt  || '').trim();

    if (bTxt) {
      bio.siblingsBrothers = splitTextToNameObjects(bTxt);
    } else if (!Array.isArray(bio.siblingsBrothers)) {
      bio.siblingsBrothers = [];
    }

    if (sTxt) {
      bio.siblingsSisters = splitTextToNameObjects(sTxt);
    } else if (!Array.isArray(bio.siblingsSisters)) {
      bio.siblingsSisters = [];
    }
  }

  if (f.father && f.father.bio) fixSiblings(f.father.bio);
  // NEW: الأسلاف أيضًا (الجد/الأجداد) — حتى تتحول النصوص إلى siblingsBrothers/siblingsSisters
  if (Array.isArray(f.ancestors)) {
    f.ancestors.forEach(a => {
      if (a && a.bio) fixSiblings(a.bio);
    });
  }

  if (f.rootPerson && f.rootPerson.bio) {
    fixSiblings(f.rootPerson.bio);

    if (f.father) {
      if (!Array.isArray(f.father.children)) f.father.children = [];

      const bros = Array.isArray(f.rootPerson.bio.siblingsBrothers) ? f.rootPerson.bio.siblingsBrothers : [];
      const sis  = Array.isArray(f.rootPerson.bio.siblingsSisters) ? f.rootPerson.bio.siblingsSisters  : [];

      if (bros.length || sis.length) {
        const rootNameNorm = norm(f.rootPerson.name || '');
        const existing = new Set(
          f.father.children
            .map(ch => ch && ch.name ? norm(ch.name) : '')
            .filter(Boolean)
        );

        const addSiblingChild = (entry, role) => {
          if (!entry) return;
          const nm = String(entry.name || '').trim();
          if (!nm) return;
          const key = norm(nm);
          if (!key || key === rootNameNorm || existing.has(key)) return;

          const child = normalizeChild({ name: nm, role, bio: {} });
          f.father.children.push(child);
          existing.add(key);
        };

        bros.forEach(b => addSiblingChild(b, 'ابن'));
        sis.forEach(s => addSiblingChild(s, 'بنت'));
      }
    }
  }

  (f.wives || []).forEach(w => { if (w && w.bio) fixSiblings(w.bio); });

  return f;
}

// ================================
// 9) فهرسة الأشخاص + الروابط الواقعية
// ================================
export function uuid(prefix){
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch(e){}
  return (prefix || 'p') + '_' + Math.random().toString(36).slice(2,10);
}

export function buildPersonsIndex(fam){
  if (!fam) return;

  const oldPersons = fam.persons || {};
  const next = {};

  const put = (p) => {
    if (!p) return;
    if (!p._id) p._id = uuid('p');
    next[p._id] = p;
  };

  const visit = (p) => {
    if (!p) return;
    put(p);
    (p.children || []).forEach(visit);
    (p.wives || []).forEach(visit);
  };

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach(visit);
  if (fam.father) visit(fam.father);
  if (fam.rootPerson) visit(fam.rootPerson);
  (fam.wives || []).forEach(visit);

  Object.keys(oldPersons).forEach(id => {
    if (next[id]) return;
    const op = oldPersons[id];
    if (!op) return;

    const r = String(op.role || '').trim();
    const isVirtualRole = (r === 'الأم' || r === 'أب الزوجة' || r === 'أم الزوجة');

    const isReferenced =
      (fam.rootPerson && fam.rootPerson.motherId === id) ||
      (fam.wives || []).some(w => w && (w.fatherId === id || w.motherId === id));

    if (isVirtualRole || isReferenced){
      next[id] = op;
    }
  });

  fam.persons = next;
}

export function sortedAncestors(fam){
  const ancArr = Array.isArray(fam?.ancestors) ? fam.ancestors : [];
  return ancArr
    .map(a => ({ a, gen: Number.isFinite(+a.generation) ? +a.generation : 1 }))
    .sort((x,y)=>(x.gen??1)-(y.gen??1));
}

export function ancestorsNames(sorted){
  return sorted.map(x=>String(x.a?.name||'').trim()).filter(Boolean);
}

export function linkAncestorsChain(fam){
  if (!fam) return;

  const anc = sortedAncestors(fam).map(x => x.a).filter(Boolean);

  for (let i = 0; i < anc.length; i++){
    anc[i].fatherId = (i+1<anc.length) ? anc[i+1]._id : null;

    if (anc[i].motherId == null) anc[i].motherId = null;
    if (!Array.isArray(anc[i].spousesIds)) anc[i].spousesIds = [];
    if (!Array.isArray(anc[i].childrenIds)) anc[i].childrenIds = [];
  }

  if (fam.father){
    fam.father.fatherId = anc[0] ? anc[0]._id : null;

    if (fam.father.motherId == null) fam.father.motherId = null;
    if (!Array.isArray(fam.father.spousesIds)) fam.father.spousesIds = [];
    if (!Array.isArray(fam.father.childrenIds)) fam.father.childrenIds = [];
  }

  if (fam.rootPerson){
    fam.rootPerson.fatherId = fam.father ? fam.father._id : null;

    if (fam.rootPerson.motherId == null) fam.rootPerson.motherId = null;
    if (!Array.isArray(fam.rootPerson.spousesIds)) fam.rootPerson.spousesIds = [];
    if (!Array.isArray(fam.rootPerson.childrenIds)) fam.rootPerson.childrenIds = [];
  }
}

export function resolveAncestorsForPerson(person, fam, ctx, { maxDepth = 4 } = {}){
  if (!person || !fam || !ctx || !ctx.byId) return [];

  const out = [];
  let cur   = person;
  let depth = 0;

  while (cur && depth < maxDepth){
    const fatherId =
      cur.fatherId ||
      (cur.bio && cur.bio.fatherId) ||
      null;

    if (!fatherId) break;

    const father = ctx.byId.get(String(fatherId));
    if (!father) break;

    out.push(father);
    cur = father;
    depth++;
  }

  return out;
}

export function ensureRealMotherForRoot(fam){
  if (!fam || !fam.rootPerson) return;

  const rp = fam.rootPerson;
  const b  = rp.bio || {};
const hasRealMotherName =
  (b.motherName && b.motherName !== '-' && String(b.motherName).trim());

const hasMotherMetaOnly =
  (!hasRealMotherName) && (
    (b.motherClan  && b.motherClan  !== '-' && String(b.motherClan).trim()) ||
    (b.motherTribe && b.motherTribe !== '-' && String(b.motherTribe).trim())
  );

// لا ننشئ "أم افتراضية" بناءً على (قبيلة/عشيرة) فقط
if (hasMotherMetaOnly){
  if (rp.motherId) rp.motherId = null;
  return;
}


if (!hasRealMotherName) return;

  // إن وُجد الأب: نضمن أن دوره على الأقل "الأب" إن كان فارغًا
  if (fam.father){
    const fr = String(fam.father.role || '').trim();
    if (!fr){
      fam.father.role = 'الأب';
    }
  }
  // helper: اربط الأم كزوجة للأب (فقط إذا كان اسمها موجود وحقيقي)
  const linkMomAsWifeToFather = (momObj) => {
    if (!fam.father || !momObj?._id) return;

    const nm = String(momObj.name || '').trim();

    // الشرط: لازم اسم حقيقي
    if (!nm || nm === '-' || nm === 'أم صاحب الشجرة') return;

    if (!Array.isArray(fam.father.wives)) fam.father.wives = [];

    const mid = String(momObj._id);
    const exists = fam.father.wives.some(w => w && String(w._id || w.id || '') === mid);
    if (!exists) fam.father.wives.push(momObj);
  };

  // لو كان للأم سجلّ موجود مسبقًا في fam.persons استخدمه واضبط له دورًا عامًا فقط إن كان فارغًا
  if (rp.motherId && fam.persons && fam.persons[rp.motherId]){
    const momExisting = fam.persons[rp.motherId];
    const mr = String(momExisting.role || '').trim();
    if (!mr){
      momExisting.role = 'الأم';
    }

    // المهم: اربطها كزوجة للأب أيضًا
    linkMomAsWifeToFather(momExisting);

    // تأكيد spousesIds عند الطرفين (احتياط)
    if (fam.father){
      if (!Array.isArray(fam.father.spousesIds)) fam.father.spousesIds = [];
      if (fam.father.spousesIds.indexOf(momExisting._id) === -1) fam.father.spousesIds.push(momExisting._id);

      if (!Array.isArray(momExisting.spousesIds)) momExisting.spousesIds = [];
      if (momExisting.spousesIds.indexOf(fam.father._id) === -1) momExisting.spousesIds.push(fam.father._id);
    }

    return;
  }

  // إنشاء سجلّ جديد لأم صاحب الشجرة بدور عام (يُفهم من السياق لكنها أم لصاحب الشجرة)
  const momBro = splitTextToNameObjects(b.motherBrothersTxt || '');
  const momSis = splitTextToNameObjects(b.motherSistersTxt  || '');

  const mom = {
    _id: uuid('m'),
    name: b.motherName || 'أم صاحب الشجرة',
    // هنا نضع الدور عامًا حتى لا يظهر النص الطويل في بطاقة الشجرة
    role: 'الأم',
    bio: {
      clan: b.motherClan || '',
      tribe: b.motherTribe || '',
      siblingsBrothers: momBro,
      siblingsSisters:  momSis
    },
    spousesIds: rp.fatherId ? [rp.fatherId] : [],
    childrenIds: [rp._id],
    fatherId: null,
    motherId: null
  };

  if (!fam.persons) fam.persons = {};
  fam.persons[mom._id] = mom;

  rp.motherId = mom._id;

  if (fam.father){
    if (!Array.isArray(fam.father.spousesIds)) fam.father.spousesIds = [];
    if (fam.father.spousesIds.indexOf(mom._id) === -1) fam.father.spousesIds.push(mom._id);
  }

  // المهم: اربطها كزوجة للأب في father.wives
  linkMomAsWifeToFather(mom);
}


function ensureWifeSideChain(fam, parentPerson, wb, cfg){
  if (!fam || !parentPerson || !wb || !cfg) return;
  if (!fam.persons) fam.persons = {};

  let gf = null;
  let gm = null;

  const gfName = String(wb[cfg.grandFatherField] || '').trim();
  if (gfName){
    gf = {
      _id: uuid(cfg.gfPrefix || 'wgf'),
      name: gfName,
      role: cfg.grandFatherRole,
      bio: {},
      fatherId: null,
      motherId: null,
      spousesIds: [],
      childrenIds: [parentPerson._id]
    };
    fam.persons[gf._id] = gf;
    if (!parentPerson.fatherId) parentPerson.fatherId = gf._id;
  }

  const gmName = String(wb[cfg.grandMotherField] || '').trim();
  if (gmName){
    gm = {
      _id: uuid(cfg.gmPrefix || 'wgm'),
      name: gmName,
      role: cfg.grandMotherRole,
      bio: {},
      fatherId: null,
      motherId: null,
      spousesIds: [],
      childrenIds: [parentPerson._id]
    };
    fam.persons[gm._id] = gm;
    if (!parentPerson.motherId) parentPerson.motherId = gm._id;
  }

  if (gf && gm){
    if (!Array.isArray(gf.spousesIds)) gf.spousesIds = [];
    if (!Array.isArray(gm.spousesIds)) gm.spousesIds = [];
    if (gf.spousesIds.indexOf(gm._id) === -1) gf.spousesIds.push(gm._id);
    if (gm.spousesIds.indexOf(gf._id) === -1) gm.spousesIds.push(gf._id);
  }

  if (gf && !Array.isArray(gf.childrenIds)) gf.childrenIds = [parentPerson._id];
  if (gm && !Array.isArray(gm.childrenIds)) gm.childrenIds = [parentPerson._id];

  const bros = Array.isArray(cfg.brothers) ? cfg.brothers : [];
  const sis  = Array.isArray(cfg.sisters)  ? cfg.sisters  : [];

  function addSibling(entry, role){
    if (!entry) return;
    const nm = String(entry.name || '').trim();
    if (!nm) return;

    const s = {
      _id: uuid(cfg.sibPrefix || 'ws'),
      name: nm,
      role,
      bio: {},
      fatherId: gf ? gf._id : null,
      motherId: gm ? gm._id : null,
      spousesIds: [],
      childrenIds: []
    };
    fam.persons[s._id] = s;

    if (gf){
      if (!Array.isArray(gf.childrenIds)) gf.childrenIds = [];
      if (gf.childrenIds.indexOf(s._id) === -1) gf.childrenIds.push(s._id);
    }
    if (gm){
      if (!Array.isArray(gm.childrenIds)) gm.childrenIds = [];
      if (gm.childrenIds.indexOf(s._id) === -1) gm.childrenIds.push(s._id);
    }
  }

  bros.forEach(b => addSibling(b, cfg.uncleMaleRole));
  sis.forEach(s => addSibling(s, cfg.uncleFemaleRole));
}

export function ensureRealParentsForWives(fam){
  if (!fam || !fam.wives || !fam.wives.length) return;
  if (!fam.persons) fam.persons = {};

  // عدد الزوجات لتحديد هل نذكر الترتيب أم لا
  const wifeCount = fam.wives.length;

  for (let i = 0; i < fam.wives.length; i++){
    const w = fam.wives[i];
    if (!w || !w._id) continue;

    // ترتيب الزوجة: الأولى / الثانية / ...
    const ord = getArabicOrdinalF(i + 1); // الأولى، الثانية، ...

    // إن كانت زوجة واحدة فقط → "الزوجة" بلا ترتيب
    // إن كان هناك أكثر من زوجة → "الزوجة الأولى/الثانية/..."
    const wifeTitle = (wifeCount > 1) ? `الزوجة ${ord}` : 'الزوجة';

    const fatherRoleLabel       = `أب ${wifeTitle}`;                 // أب الزوجة أو أب الزوجة الأولى
    const motherRoleLabel       = `أم ${wifeTitle}`;                 // أم الزوجة أو أم الزوجة الأولى
    const gfFatherSideRole      = `جد ${wifeTitle} من جهة الأب`;    // جد الزوجة (الأولى) من جهة الأب
    const gmFatherSideRole      = `جدة ${wifeTitle} من جهة الأب`;   // جدة الزوجة (الأولى) من جهة الأب
    const uncleMaleFatherSide   = `عم ${wifeTitle}`;                 // عم الزوجة (الأولى)
    const uncleFemaleFatherSide = `عمة ${wifeTitle}`;                // عمة الزوجة (الأولى)

    const gfMotherSideRole      = `جد ${wifeTitle} من جهة الأم`;    // جد الزوجة (الأولى) من جهة الأم
    const gmMotherSideRole      = `جدة ${wifeTitle} من جهة الأم`;   // جدة الزوجة (الأولى) من جهة الأم
    const uncleMaleMotherSide   = `خال ${wifeTitle}`;               // خال الزوجة (الأولى)
    const uncleFemaleMotherSide = `خالة ${wifeTitle}`;              // خالة الزوجة (الأولى)

    if (w.fatherId == null) w.fatherId = null;
    if (w.motherId == null) w.motherId = null;

    const wb = w.bio || {};

    const fBro = splitTextToNameObjects(wb.fatherBrothersTxt || '');
    const fSis = splitTextToNameObjects(wb.fatherSistersTxt  || '');

    const mBro = splitTextToNameObjects(wb.motherBrothersTxt || '');
    const mSis = splitTextToNameObjects(wb.motherSistersTxt  || '');

    let wf = null;
    let wm = null;
    // --- أب الزوجة ---
    const hasFatherRecord =
      w.fatherId && fam.persons && fam.persons[w.fatherId];

    if (!hasFatherRecord && wb.fatherName && wb.fatherName !== '-') {
      // حالة جديدة أو رابط مفقود بعد التصدير/الاستيراد: نبني الأب من الـ bio
      const fid = w.fatherId || uuid('wf');
      wf = {
        _id: fid,
        name: wb.fatherName,
        role: fatherRoleLabel,
        bio: {
          clan: wb.fatherClan || '',
          tribe: wb.tribe || '',
          siblingsBrothers: fBro,
          siblingsSisters:  fSis
        },
        childrenIds: [w._id],
        spousesIds: [],
        fatherId: null,
        motherId: null
      };
      fam.persons[fid] = wf;
      w.fatherId = fid;
    } else if (hasFatherRecord) {
      wf = fam.persons[w.fatherId];
      // تصحيح السجلات القديمة: "أب الزوجة" → "أب الزوجة الأولى/الثانية..."
      if (wf) {
        const r = String(wf.role || '').trim();
        if (!r || r === 'أب الزوجة' || r === 'أب') {
          wf.role = fatherRoleLabel;
        }
      }
    }

    // --- أم الزوجة ---
    const hasMotherRecord =
      w.motherId && fam.persons && fam.persons[w.motherId];

    if (!hasMotherRecord && wb.motherName && wb.motherName !== '-') {
      const mid = w.motherId || uuid('wm');
      wm = {
        _id: mid,
        name: wb.motherName,
        role: motherRoleLabel,
        bio: {
          clan: wb.motherClan || '',
          siblingsBrothers: mBro,
          siblingsSisters:  mSis
        },
        childrenIds: [w._id],
        spousesIds: [],
        fatherId: null,
        motherId: null
      };
      fam.persons[mid] = wm;
      w.motherId = mid;
    } else if (hasMotherRecord) {
      wm = fam.persons[w.motherId];
      // تصحيح السجلات القديمة: "أم الزوجة" → "أم الزوجة الأولى/الثانية..."
      if (wm) {
        const r = String(wm.role || '').trim();
        if (!r || r === 'أم الزوجة' || r === 'الأم' || r === 'أم') {
          wm.role = motherRoleLabel;
        }
      }
    }

    // ربط الزوجين (أب/أم الزوجة) ببعضهما إن وُجدا
    if (wf && wm){
      if (!Array.isArray(wf.spousesIds)) wf.spousesIds = [];
      if (!Array.isArray(wm.spousesIds)) wm.spousesIds = [];
      if (wf.spousesIds.indexOf(wm._id) === -1) wf.spousesIds.push(wm._id);
      if (wm.spousesIds.indexOf(wf._id) === -1) wm.spousesIds.push(wf._id);
    }

    if (wf){
      if (!Array.isArray(wf.childrenIds)) wf.childrenIds = [];
      if (wf.childrenIds.indexOf(w._id) === -1) wf.childrenIds.push(w._id);
    }
    if (wm){
      if (!Array.isArray(wm.childrenIds)) wm.childrenIds = [];
      if (wm.childrenIds.indexOf(w._id) === -1) wm.childrenIds.push(w._id);
    }

    // بناء سلسلة الأجداد + الأعمام/العمات من جهة الأب
    if (wf){
      ensureWifeSideChain(fam, wf, wb, {
        grandFatherField:  'paternalGrandfather',
        grandMotherField:  'paternalGrandmother',
        grandFatherRole:   gfFatherSideRole,
        grandMotherRole:   gmFatherSideRole,
        brothers:          fBro,
        sisters:           fSis,
        uncleMaleRole:     uncleMaleFatherSide,
        uncleFemaleRole:   uncleFemaleFatherSide,
        gfPrefix:          'wpgf',
        gmPrefix:          'wpgm',
        sibPrefix:         'wpunc'
      });
    }


    // بناء سلسلة الأجداد + الأخوال/الخالات من جهة الأم
    if (wm){
      ensureWifeSideChain(fam, wm, wb, {
        grandFatherField:  'maternalGrandfather',
        grandMotherField:  'maternalGrandmother',
        grandFatherRole:   gfMotherSideRole,
        grandMotherRole:   gmMotherSideRole,
        brothers:          mBro,
        sisters:           mSis,
        uncleMaleRole:     uncleMaleMotherSide,
        uncleFemaleRole:   uncleFemaleMotherSide,
        gfPrefix:          'wmgf',
        gmPrefix:          'wmgm',
        sibPrefix:         'wmunc'
      });
    }

  }
}

export function linkParentChildLinksFromOldShape(fam){
  if (!fam) return;

  walkPersons(fam, (p) => {
    if (!p) return;
    if (p.fatherId == null) p.fatherId = null;
    if (p.motherId == null) p.motherId = null;
    if (!Array.isArray(p.spousesIds)) p.spousesIds = [];
    if (!Array.isArray(p.childrenIds)) p.childrenIds = [];
  });

  const father = fam.father || null;
  const root   = fam.rootPerson || null;

  if (father && root){
    root.fatherId = father._id;

    if (!Array.isArray(father.childrenIds)) father.childrenIds = [];
    if (father.childrenIds.indexOf(root._id) === -1) father.childrenIds.push(root._id);

    if (!Array.isArray(father.spousesIds)) father.spousesIds = [];
    if (!Array.isArray(root.spousesIds)) root.spousesIds = [];
  }

  if (father && Array.isArray(father.children)) {
    father.children.forEach(ch => {
      if (!ch) return;
      ch.fatherId = father._id;
      if (ch.motherId == null) ch.motherId = null;

      if (!Array.isArray(father.childrenIds)) father.childrenIds = [];
      if (father.childrenIds.indexOf(ch._id) === -1) father.childrenIds.push(ch._id);
    });
  }

  (fam.wives || []).forEach(w => {
    if (!w || !root) return;

    if (!Array.isArray(root.spousesIds)) root.spousesIds = [];
    if (root.spousesIds.indexOf(w._id) === -1) root.spousesIds.push(w._id);

    if (!Array.isArray(w.spousesIds)) w.spousesIds = [];
    if (w.spousesIds.indexOf(root._id) === -1) w.spousesIds.push(root._id);

    (w.children || []).forEach(ch => {
      if (!ch) return;

      ch.fatherId = root ? root._id : null;
      ch.motherId = w._id;

      if (!Array.isArray(root.childrenIds)) root.childrenIds = [];
      if (root.childrenIds.indexOf(ch._id) === -1) root.childrenIds.push(ch._id);

      if (!Array.isArray(w.childrenIds)) w.childrenIds = [];
      if (w.childrenIds.indexOf(ch._id) === -1) w.childrenIds.push(ch._id);
    });
  });
}

export function buildRealLinks(fam){
  if (!fam) return;
  buildPersonsIndex(fam);
  linkAncestorsChain(fam);
  linkParentChildLinksFromOldShape(fam);
  ensureRealMotherForRoot(fam);
  ensureRealParentsForWives(fam);
}

// ================================
// 10) Walkers + مسارات
// ================================
function roleGroupLocal(p) {
  const r = String(p?.role || '').trim();
  if (r === 'ابن' || r === 'بنت') return r;
  if (r === 'الأب') return 'الأب';
  if (r.startsWith('الجد')) return 'جد';
  if (r === 'زوجة' || r.startsWith('الزوجة')) return 'زوجة';
  return r || '';
}

export function personFingerprint(p){
  if (!p) return '';

  const name = norm(String(p.name || '').trim(), { keepPunct: true });
  const rg   = roleGroupLocal(p);

  const bio  = p.bio || {};
  const birth = String(bio.birthDate || bio.birthYear || '').trim();
  const place = norm(String(bio.birthPlace || '').trim(), { keepPunct: true });

  const father = norm(String(bio.fatherName || '').trim(), { keepPunct: true });
  const mother = norm(String(bio.motherName || '').trim(), { keepPunct: true });

  const tribe = norm(String(bio.tribe || '').trim(), { keepPunct: true });
  const clan  = norm(String(bio.clan  || '').trim(), { keepPunct: true });

  return [
    name,
    rg,
    birth || '-',
    place || '-',
    father || '-',
    mother || '-',
    tribe || '-',
    clan  || '-'
  ].join('|');
}

export function walk(fam, cb, { withPath = false } = {}){
  if (!fam || typeof cb !== 'function') return;

  const visit = (p, path) => {
    if (!p) return;
    cb(p, path);

    // نزور wives للجميع ما عدا rootPerson لتجنب التكرار مع fam.wives
    if (path !== 'rootPerson') {
      (p.wives || []).forEach((w, i) =>
        visit(w, withPath ? `${path}.wives[${i}]` : null)
      );
    }

    (p.children || []).forEach((c, i) =>
      visit(c, withPath ? `${path}.children[${i}]` : null)
    );
  };

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach((a,i)=>
    visit(a, withPath ? `ancestors[${i}]` : null)
  );

  if (fam.father) visit(fam.father, withPath ? 'father' : null);

  // rootPerson: نزوره كشخص، لكن لن نزور wives تحته (بالشرط أعلاه)
  if (fam.rootPerson) visit(fam.rootPerson, withPath ? 'rootPerson' : null);

  //  المصدر الوحيد لزوجات صاحب الشجرة
  (fam.wives || []).forEach((w,i)=>
    visit(w, withPath ? `wives[${i}]` : null)
  );
}



export function walkPersonsWithPath(fam, cb){ walk(fam, cb, { withPath:true }); }
export function walkPersons(fam, cb){ walk(fam, cb, { withPath:false }); }
// ================================
// FIX: إزالة تكرار _id داخل العائلة + تحديث الروابط
// ================================
function _newSafeId(prefix='p'){
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  // أكثر أمانًا من Math.random لوحده
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
}

function _replaceIdEverywhere(fam, oldId, newId){
  if (!fam) return;
  const oldS = String(oldId);
  const newS = String(newId);

  walkPersons(fam, (p) => {
    if (!p || typeof p !== 'object') return;

    // روابط مباشرة
    if (p.fatherId != null && String(p.fatherId) === oldS) p.fatherId = newS;
    if (p.motherId != null && String(p.motherId) === oldS) p.motherId = newS;

    // bio links
    if (p.bio && typeof p.bio === 'object'){
      if (p.bio.fatherId != null && String(p.bio.fatherId) === oldS) p.bio.fatherId = newS;
      if (p.bio.motherId != null && String(p.bio.motherId) === oldS) p.bio.motherId = newS;
    }

    // arrays
    if (Array.isArray(p.spousesIds)){
      p.spousesIds = p.spousesIds.map(x => (x != null && String(x) === oldS) ? newS : x);
    }
    if (Array.isArray(p.childrenIds)){
      p.childrenIds = p.childrenIds.map(x => (x != null && String(x) === oldS) ? newS : x);
    }

    // الشكل القديم اللي عندك: father/mother أحيانًا يساوي id
    if (p.father != null && String(p.father) === oldS) p.father = newS;
    if (p.mother != null && String(p.mother) === oldS) p.mother = newS;
  });

  // fam.persons
  if (fam.persons && typeof fam.persons === 'object'){
    if (fam.persons[oldS]){
      fam.persons[newS] = fam.persons[oldS];
      delete fam.persons[oldS];
    }
  }

  // rootPerson motherId
  if (fam.rootPerson?.motherId != null && String(fam.rootPerson.motherId) === oldS){
    fam.rootPerson.motherId = newS;
  }
}

export function dedupeIdsInFamily(fam){
  if (!fam) return fam;

  const firstPathById = new Map();
  const duplicates = [];

  // لاحظ: نستخدم walkPersonsWithPath لأن مشكلتك تظهر هنا
  walkPersonsWithPath(fam, (p, path) => {
    if (!p || p._id == null) return;

    const id = String(p._id);
    const curPath = path || '(unknown)';

    if (firstPathById.has(id)){
      duplicates.push({ id, path: curPath, first: firstPathById.get(id), obj: p });
    } else {
      firstPathById.set(id, curPath);
    }
  });

  // إن لم توجد تكرارات: خلاص
  if (!duplicates.length) return fam;

  // نعيد تسمية كل ظهور مكرر (عدا الأول)
  for (const d of duplicates){
    const newId = _newSafeId('dup');
    const oldId = d.id;

    // حدّث هذا الشخص نفسه
    if (d.obj) d.obj._id = newId;

    // حدّث كل الروابط في العائلة من oldId -> newId
    _replaceIdEverywhere(fam, oldId, newId);
  }

  return fam;
}

export function findPathByIdInFamily(fam, pid) {
  let out = null;
  walkPersonsWithPath(fam, (p, path) => { if (p && p._id === pid) out = path; });
  return out;
}

export function getByPath(fam, path) {
  if (!fam || !path) return null;
  const segs = path.split('.').filter(Boolean);
  let cur = fam;
  for (const s of segs) {
    const m = s.match(/^(\w+)\[(\d+)\]$/);
    if (m) {
      const arr = cur[m[1]];
      const idx = parseInt(m[2], 10);
      if (!Array.isArray(arr) || !arr[idx]) return null;
      cur = arr[idx];
    } else {
      cur = cur?.[s];
      if (!cur) return null;
    }
  }
  return cur || null;
}

// ================================
// 11) إعدادات النَّسَب + التكرارات
// ================================
export function getLineageConfig(fam) {
  const defaults = {
    tribeRule: 'father',
    clanRule: 'father',
    missingFatherFallback: 'mother'
  };

  if (!fam) return { ...defaults };

  if (!fam.__meta) fam.__meta = {};
  if (!fam.__meta.lineage) {
    fam.__meta.lineage = { ...defaults };
  } else {
    fam.__meta.lineage = { ...defaults, ...fam.__meta.lineage };
  }

  if (fam.__meta.lineage.tribeRule === 'firstKnown') {
    fam.__meta.lineage.tribeRule = 'firstAncestor';
  }
  if (fam.__meta.lineage.clanRule === 'firstKnown') {
    fam.__meta.lineage.clanRule = 'firstAncestor';
  }

  return fam.__meta.lineage;
}

export function getDuplicatesConfig(fam){
  const defaults = {
    fingerprintFields: ['name','role','birth','father','mother','tribe','clan','place'],
    minScoreToWarn: 2,          // لا نعرض تحذير إلا لو وُجدت مجموعة dupScore >= 2
    excludeWeakFromStats: false // إن كانت true سيتم استبعاد المجموعات الضعيفة (اسم فقط) من الإحصاءات
  };

  if (!fam) return { ...defaults };

  if (!fam.__meta) fam.__meta = {};
  if (!fam.__meta.duplicates){
    fam.__meta.duplicates = { ...defaults };
  } else {
    fam.__meta.duplicates = { ...defaults, ...fam.__meta.duplicates };
  }

  return fam.__meta.duplicates;
}


export function findDuplicatesInFamily(f) {
  if (!f) return [];

  // خريطة: الشخص → المسار داخل العائلة (ancestors[0]... إلخ)
  const pathByPerson = new WeakMap();
  try {
    // نمرّ على جميع الأشخاص مع المسار
    walkPersonsWithPath(f, (p, path) => {
      if (p && path) pathByPerson.set(p, path);
    });
  } catch {
    // لو حدث خطأ نتجاهله ولا نكسر التكرارات
  }

  // نجمع جميع الأشخاص مع إزالة التكرار المنطقي
  const all = [];
  const seenById   = new Set();
  const seenByFp   = new Set();

  const push = (p) => {
    if (!p) return;

    // مفتاح الهوية: أولاً _id، وإن لم يوجد نستخدم بصمة الشخص
    const id = p._id ? String(p._id) : null;
    const fp = !id ? personFingerprint(p) : '';

    if (id) {
      if (seenById.has(id)) return;
      seenById.add(id);
    } else if (fp) {
      if (seenByFp.has(fp)) return;
      seenByFp.add(fp);
    }

    all.push(p);
    (p.children || []).forEach(push);
    (p.wives || []).forEach(push);
  };

  // 1) شجرة الأسلاف + الأب + صاحب الشجرة + الزوجات
  (Array.isArray(f.ancestors) ? f.ancestors : []).forEach(push);
  [f.father, f.rootPerson, ...(f.wives || [])].forEach(push);

  // 2) الأشخاص الموجودون في fam.persons (مثل: الأم الواقعية، أب/أم الزوجة، الأعمام/الأخوال...)
  if (f.persons && typeof f.persons === 'object') {
    Object.values(f.persons).forEach(push);
  }

  const map = new Map();
  for (const p of all) {
    const k = normKey(p);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }

  const dups = [];
  for (const [, arr] of map) {
    if (arr.length > 1) {
      // نحسب نوع التكرار ودرجته لهذه المجموعة كاملة
      const first      = arr[0] || {};
      const firstRole  = roleGroupLocal(first);
      const firstBirth = String(first?.bio?.birthDate || first?.bio?.birthYear || '').trim();

      let allSameRole = true;
      for (let i = 0; i < arr.length; i++) {
        if (roleGroupLocal(arr[i]) !== firstRole) {
          allSameRole = false;
          break;
        }
      }

      let allSameBirth = true;
      for (let i = 0; i < arr.length; i++) {
        const b = String(arr[i]?.bio?.birthDate || arr[i]?.bio?.birthYear || '').trim();
        if (b !== firstBirth) {
          allSameBirth = false;
          break;
        }
      }

      let dupType;
      let dupScore;

      if (allSameRole && firstBirth && allSameBirth) {
        // اسم + صفة + ميلاد متطابقة
        dupType  = 'اسم + صفة + تاريخ/سنة الميلاد';
        dupScore = 3;
      } else if (allSameRole) {
        // اسم + صفة فقط
        dupType  = 'اسم + صفة';
        dupScore = 2;
      } else {
        // تجميع بالاسم فقط
        dupType  = 'اسم فقط';
        dupScore = 1;
      }

        const group = [];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        group.push({
          _id: p._id,
          name: p.name || '',
          role: p.role || '',
          // نوع التكرار ودرجة التطابق
          dupType,
          dupScore
        });
      }
      dups.push(group);
    }
  }

  return dups;
}

// ================================
// 12) أدوات إضافية
// ================================
export function stripPhotosDeep(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.bio && typeof obj.bio === 'object') obj.bio.photoUrl = '';
  Object.values(obj).forEach(v => {
    if (Array.isArray(v)) v.forEach(stripPhotosDeep);
    else if (v && typeof v === 'object') stripPhotosDeep(v);
  });
}

// ضبط حقول ابن واحد من سياق العائلة/الزوجة
export function setChildDefaults(child, fam, wife) {
  if (!child || !child.bio) return;

  const fatherFull =
    String(
      fam.rootPerson?.bio?.fullName ||
      fam.rootPerson?.bio?.fullname ||
      fam.rootPerson?.name ||
      fam.father?.bio?.fullName ||
      fam.father?.name ||
      ''
    ).trim();

  if (!child.bio.fatherName || child.bio.fatherName === '-') {
    child.bio.fatherName = fatherFull || '-';
  }

  if (!child.bio.motherName || child.bio.motherName === '-') {
    child.bio.motherName = (wife?.name && wife.name !== '-') ? wife.name : '-';
  }
  
  const gpName  = String(fam?.rootPerson?.bio?.motherName  || '').trim();
  const gpClan  = String(fam?.rootPerson?.bio?.motherClan  || '').trim();
  const gpTribe = String(fam?.rootPerson?.bio?.motherTribe || '').trim();

  // اسم الجدة من جهة الأب
  if ((!child.bio.paternalGrandmother || child.bio.paternalGrandmother === '-') && gpName) {
    child.bio.paternalGrandmother = gpName;
  }

  // عشيرة الجدة من جهة الأب
  if ((!child.bio.paternalGrandmotherClan || child.bio.paternalGrandmotherClan === '-') && gpClan) {
    child.bio.paternalGrandmotherClan = gpClan;
  }

  // قبيلة الجدة من جهة الأب (هذه كانت ناقصة)
  if ((!child.bio.paternalGrandmotherTribe || child.bio.paternalGrandmotherTribe === '-') && gpTribe) {
    child.bio.paternalGrandmotherTribe = gpTribe;
  }
  
  const mgmName  = String(wife?.bio?.motherName  || '').trim();
const mgmClan  = String(wife?.bio?.motherClan  || '').trim();
const mgmTribe = String(wife?.bio?.motherTribe || '').trim();

// اسم الجدة من جهة الأم
if ((!child.bio.maternalGrandmother || child.bio.maternalGrandmother === '-') && mgmName) {
  child.bio.maternalGrandmother = mgmName;
}

// عشيرة الجدة من جهة الأم
if ((!child.bio.maternalGrandmotherClan || child.bio.maternalGrandmotherClan === '-') && mgmClan) {
  child.bio.maternalGrandmotherClan = mgmClan;
}

// قبيلة الجدة من جهة الأم (هذا المطلوب الأساسي)
if ((!child.bio.maternalGrandmotherTribe || child.bio.maternalGrandmotherTribe === '-') && mgmTribe) {
  child.bio.maternalGrandmotherTribe = mgmTribe;
}
}

// ربط wives داخل rootPerson كمرآة مشتقّة من fam.wives
export function linkRootPersonWives(fam) {
  if (!fam) return;
  if (!Array.isArray(fam.wives)) fam.wives = [];

  fam.wives = fam.wives.map(w => {
    const ww = Object.assign({}, w);

    ww.children = (ww.children || []).map(c => {
      const base = typeof structuredClone === 'function' ? structuredClone(DEFAULT_BIO)
        : JSON.parse(JSON.stringify(DEFAULT_BIO));

      let child;
      if (typeof c === 'string') {
        child = {
          name: c,
          role: 'ابن',
          bio: Object.assign(base, {}),
          stories: [],
          events: [],
          sources: [],
          education: [],
          career: [],
          children: [],
          wives: []
        };
      } else {
        child = {
          name: c.name || '',
          role: c.role || 'ابن',
          bio: Object.assign(base, c.bio || {}),
          _id: c._id,
          fatherId: (c.fatherId != null) ? c.fatherId : (c.bio && c.bio.fatherId) || null,
          motherId: (c.motherId != null) ? c.motherId : (c.bio && c.bio.motherId) || null,
          stories: Array.isArray(c.stories) ? c.stories : [],
          events: Array.isArray(c.events) ? c.events : [],
          sources: Array.isArray(c.sources) ? c.sources : [],
          education: Array.isArray(c.education) ? c.education : [],
          career: Array.isArray(c.career) ? c.career : [],
          children: Array.isArray(c.children) ? c.children : [],
          wives: Array.isArray(c.wives) ? c.wives : []
        };
      }

      normalizeLifeDatesOnBio(child.bio);
      setChildDefaults(child, fam, ww);
      return child;
    });

    return ww;
  });

  // أهم تعديل: لا تعمل نسخ جديدة
  if (fam.rootPerson) {
    fam.rootPerson.wives = fam.wives; // pointer لنفس المصفوفة
  }
}


// ================================
// 13) Pipeline موحَّد للعائلة
// ================================
export function normalizeFamilyPipeline(fam, { fromVer = 0, markCore = false } = {}) {
  if (!fam) return fam;

  migrate(fam, fromVer, SCHEMA_VERSION);

  if (!Array.isArray(fam.wives)) fam.wives = [];
  fam.wives = fam.wives.map(normalizeWifeForLoad);
  if (fam.rootPerson && fam.rootPerson.wives) delete fam.rootPerson.wives;

  normalizeNewFamilyForLineage(fam);
  ensureFamilyBios(fam);
  ensureIds(fam);
  linkRootPersonWives(fam);
  dedupeIdsInFamily(fam);
  buildRealLinks(fam);

  // هنا التعديل المهم
  if (markCore && fam.__custom !== true) {
    fam.__core = true;
    if (fam.hidden == null) fam.hidden = false;
  }

  return fam;
}