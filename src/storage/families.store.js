// storage/families.store.js
// طبقة التخزين (IndexedDB + اختيار العائلة) + واجهة التعامل مع العائلات

import { DB } from './db.js';
import {
  SCHEMA_VERSION,
  normalizeFamilyPipeline,
  walkPersonsWithPath,
  walkPersons,
  getByPath,
  personFingerprint,
  sortedAncestors,
  ancestorsNames
} from '../model/families.core.js';

import { familiesData as seedFamiliesData } from '../model/families.seed.js';

/* =========================
   1) ثوابت التخزين + حالة الذاكرة
========================= */

// مفاتيح التخزين (فصل custom عن meta)
export const PERSIST_FAMILIES_CUSTOM_KEY = 'families_custom';
export const PERSIST_FAMILIES_META_KEY   = 'families_meta';

// نسخة تنسيق التخزين (حماية مستقبلية لشكل meta)
export const STORAGE_VERSION = 1;

// خريطة العائلات الحيّة في الذاكرة (تبدأ من البذور)
export const families = seedFamiliesData;

/* =========================
   2) حفظ مؤجل (Queue) لتفادي تداخل عمليات IndexedDB
   - نفس السلوك: جدولة + تسلسل + عدم كسر السلسلة عند الخطأ
   - إيقاف كامل أثناء التفريغ FT_WIPE_BEGIN
========================= */
let _saveTimer = null;
let _saveInFlight = Promise.resolve();
let _wipeMode = false;

try {
  window.addEventListener('FT_WIPE_BEGIN', () => {
    _wipeMode = true;
    try {
      if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    } catch {}
  });
} catch {}

function scheduleSavePersistedFamilies(delayMs = 400) {
  if (_wipeMode) return Promise.resolve(); // لا تحفظ أي شيء أثناء/بعد التفريغ
  if (_saveTimer) clearTimeout(_saveTimer);

  return new Promise((resolve) => {
    _saveTimer = setTimeout(() => {
      _saveInFlight = _saveInFlight
        .then(() => savePersistedFamilies())
        .then(resolve, resolve); // لا تكسر السلسلة حتى لو حصل خطأ
    }, delayMs);
  });
}

/* =========================
   3) أدوات مساعدة مشتركة لتقليل التكرار
========================= */

/** تنظيف نسخة عائلة للتخزين (تقليل حجم + إزالة مشتقات) */
function sanitizeFamilyForPersist(fam) {
  const copy = { ...fam, __v: SCHEMA_VERSION };

  // منع المرآة + تقليل الحجم (persons مشتق ويمكن إعادة بنائه)
  if (copy.rootPerson) delete copy.rootPerson.wives;
  if (copy.persons) delete copy.persons;

  // حذف حقول مشتقة من الأشخاص لتقليل الحجم
  try {
    walkPersons(copy, (p) => {
      if (!p) return;
      delete p._normName;
      delete p._normRole;
      delete p.childrenIds;
      delete p.spousesIds;
    });
  } catch {}

  return copy;
}

/** حساب أسماء مشتقة مفيدة للعرض/البحث (بدون تغيير السلوك) */
function ensureFamilyComputedNames(fam) {
  if (!fam) return;

  const ancSorted = sortedAncestors(fam);
  const ancNames  = ancestorsNames(ancSorted);

  if (!fam.familyName) {
    fam.familyName = fam.title ? String(fam.title).replace(/^.*?:\s*/u, '').trim()
      : (fam.rootPerson?.name?.split(/\s+/u)[0] || '');
  }

  if (fam.rootPerson && !fam.fullRootPersonName) {
    const rootName   = String(fam.rootPerson.name || '').trim();
    const fatherName = String(fam.father?.name || '').trim();
    const rootFull = [rootName, fatherName, ...ancNames].filter(Boolean).join(' ').trim();
    if (rootFull) fam.fullRootPersonName = rootFull;
  }
}

/**
 * تشغيل pipeline بطريقة موحّدة مع الحفاظ على منطقك:
 * - fromVer من __v إن وجد
 * - markCore حسب __core
 */
function normalizeFamilyInPlace(fam) {
  const fromVer = Number.isFinite(+fam?.__v) ? +fam.__v : 0;
  normalizeFamilyPipeline(fam, { fromVer, markCore: !!fam?.__core });
}

/** ميتاداتا البذور: إخفاء + صور، بنفس شكل التخزين السابق */
function buildCoreMetaForFamily(fam) {
  const patch = {};

  try {
    walkPersonsWithPath(fam, (p, path) => {
      const u = String(p?.bio?.photoUrl || p?.photoUrl || '').trim();
      if (!u) return;

      patch[path] = {
        photoUrl: u,
        photoVer: p.photoVer || Date.now(),
        hasOrig: p?.bio?.photoHasOrig ? 1 : 0,
        rot: p?.bio?.photoRotated ? 1 : 0,
        crp: p?.bio?.photoCropped ? 1 : 0
      };
    });
  } catch {}

  return patch;
}

/** تطبيق ترقيع صور البذور على العائلة (يدعم path الحديث + fingerprint القديم) */
function applyCorePhotosPatch(fam, patchMap) {
  if (!fam || !patchMap) return;

  Object.entries(patchMap).forEach(([key, hit]) => {
    if (!hit) return;

    const isLegacyKey = key.includes('|');
    let targetPerson = null;

    if (!isLegacyKey) targetPerson = getByPath(fam, key);

    if (!targetPerson && isLegacyKey) {
      walkPersonsWithPath(fam, (cand) => {
        if (personFingerprint(cand) === key) targetPerson = cand;
      });
    }

    if (!targetPerson) return;

    if (!targetPerson.bio) targetPerson.bio = {};
    targetPerson.bio.photoUrl = hit.photoUrl;

    // الإبقاء على نفس التزامن الموجود عندك
    targetPerson.photoUrl = hit.photoUrl;
    targetPerson.photoVer = hit.photoVer || Date.now();

    if (hit.hasOrig) targetPerson.bio.photoHasOrig = 1;
    else delete targetPerson.bio.photoHasOrig;

    if (hit.rot) targetPerson.bio.photoRotated = 1;
    else delete targetPerson.bio.photoRotated;

    if (hit.crp) targetPerson.bio.photoCropped = 1;
    else delete targetPerson.bio.photoCropped;
  });
}

/* =========================
   4) حفظ العائلات في IndexedDB
   - families_custom: العائلات المخصصة فقط
   - families_meta: ميتاداتا للبذور (إخفاء + صور) + __storageVer
========================= */
export async function savePersistedFamilies() {
  const outCustom = {};
  const meta = {
    __storageVer: STORAGE_VERSION,
    coreHidden: {},
    corePhotos: {}
  };

  const entries = Object.entries(families || {});

  for (let i = 0; i < entries.length; i++) {
    const [k, f] = entries[i];

    // (1) حفظ العائلات المخصصة فقط (مع حماية ذرّية لكل عائلة)
    if (f && f.__custom) {
      try {
        outCustom[k] = sanitizeFamilyForPersist(f);
      } catch (e) {
        console.warn('savePersistedFamilies: skip bad custom family', k, e);
      }
    }

    // (2) ميتاداتا للبذور: الإخفاء + صور
    if (f && f.__core) {
      try {
        if (f.hidden === true) meta.coreHidden[k] = 1;

        const patch = buildCoreMetaForFamily(f);
        if (Object.keys(patch).length) meta.corePhotos[k] = patch;
      } catch (e) {
        console.warn('savePersistedFamilies: skip bad core meta', k, e);
      }
    }
  }

  // كتابة فعلية إلى IndexedDB—إذا فشل أحدهما لا يمنع الآخر
  try { await DB.put(PERSIST_FAMILIES_CUSTOM_KEY, outCustom); }
  catch (e) { console.warn('savePersistedFamilies(custom/idb)', e); }

  try { await DB.put(PERSIST_FAMILIES_META_KEY, meta); }
  catch (e) { console.warn('savePersistedFamilies(meta/idb)', e); }
}

/* =========================
   5) تحميل العائلات من IndexedDB ودمجها
   - دمج custom داخل families
   - تطبيق meta للبذور (إخفاء + صور) إذا كانت نسخة التخزين متوافقة
========================= */
export async function loadPersistedFamilies() {
  try {
    const obj = (await DB.get(PERSIST_FAMILIES_CUSTOM_KEY)) || {};
    let meta  = (await DB.get(PERSIST_FAMILIES_META_KEY)) || null;

    // تحقق من نسخة تنسيق التخزين للـ meta (حماية مستقبلية)
    const metaVer = meta && Number.isFinite(+meta.__storageVer) ? +meta.__storageVer : 0;
    if (meta && metaVer !== STORAGE_VERSION) {
      console.warn(
        '[families.store] meta storage version mismatch:',
        { found: metaVer, expected: STORAGE_VERSION },
        '=> ignore meta to avoid applying incompatible shape'
      );
      meta = null;
    }

    // (1) دمج العائلات المخصصة
    Object.keys(obj).forEach((k) => {
      const f = obj[k];
      if (!f) return;

      f.__custom = true;

      normalizeFamilyInPlace(f);

      if (f.hidden == null) f.hidden = false;

      // تصحيح توافق قديم (كما كان)
      if (f.fullGrandsonName && !f.fullRootPersonName) {
        f.fullRootPersonName = f.fullGrandsonName;
        delete f.fullGrandsonName;
      }

      ensureFamilyComputedNames(f);
      families[k] = f;
    });

    // (2) تطبيق إخفاء البذور
    const coreHidden = (meta && meta.coreHidden) || {};
    Object.keys(coreHidden).forEach((k) => {
      if (families[k] && families[k].__core) families[k].hidden = true;
    });

    // (3) ترقيع صور البذور
    const corePhotos = (meta && meta.corePhotos) || {};
    Object.entries(corePhotos).forEach(([famKey, patchMap]) => {
      const fam = families[famKey];
      if (!fam || !fam.__core) return;
      applyCorePhotosPatch(fam, patchMap);
    });

  } catch (e) {
    console.warn('loadPersistedFamilies(idb)', e);
  }
}

/* =========================
   6) تهيئة المخزن
   - pipeline للبذور ثم تحميل persisted
========================= */
export async function initFamiliesStore() {
  Object.keys(families || {}).forEach((k) => {
    const f = families[k];
    if (!f) return;
    normalizeFamilyInPlace(f); // للبذور markCore=true بسبب __core عليها
  });

  await loadPersistedFamilies();
}

/* =========================
   7) واجهة القراءة العامة
========================= */
export function getFamilies() { return families; }
export function getFamily(key) { return families[key]; }

/** مولّد مفاتيح لعائلة جديدة: familyN */
export function generateFamilyKey() {
  const keys = Object.keys(families || {});
  let max = 0;

  keys.forEach((k) => {
    const m = k.match(/^family(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });

  return `family${max + 1}`;
}

/* =========================
   8) عمليات الكتابة الأساسية: commit/save/import/delete/export
========================= */

/**
 * commitFamily:
 * - يجعل العائلة custom (لو لم تكن)
 * - يعيد pipeline
 * - يحسب الأسماء المشتقة
 * - يحفظ مؤجلًا
 */
export function commitFamily(key) {
  const fam = families[key];
  if (!fam) return Promise.resolve();

  if (!fam.__custom) fam.__custom = true;

  normalizeFamilyInPlace(fam);
  ensureFamilyComputedNames(fam);

  return scheduleSavePersistedFamilies();
}

/**
 * saveFamily:
 * - يحافظ على __core إن كانت العائلة الحالية Core
 * - يمنع rootPerson.wives (كما كان) ويطبع تحذيرًا
 * - يحدّث الخريطة ثم حفظ مؤجل
 */
export function saveFamily(key, familyObj) {
  const wasCore = !!(families[key] && families[key].__core);

  familyObj.__custom = true;
  if (wasCore) familyObj.__core = true;

  normalizeFamilyInPlace(familyObj);

  if (familyObj?.rootPerson?.wives && familyObj.rootPerson.wives.length) {
    console.warn('[families.store.saveFamily] تم تمرير rootPerson.wives وسيتم تجاهلها لصالح fam.wives');
  }
  if (familyObj?.rootPerson) delete familyObj.rootPerson.wives;

  families[key] = familyObj;

  return scheduleSavePersistedFamilies();
}

export async function deleteFamily(key) {
  if (!key || !families[key]) return false;

  delete families[key];
  await savePersistedFamilies();

  // نفس السلوك: إذا المحذوف هو المختار، اختر أول عائلة أو احذف المفتاح
  const sel = localStorage.getItem('selectedFamily');
  if (sel === key) {
    const next = Object.keys(families)[0] || '';
    if (next) localStorage.setItem('selectedFamily', next);
    else localStorage.removeItem('selectedFamily');
  }

  return true;
}

/**
 * importFamilies:
 * - دمج كائن عائلات داخل الذاكرة
 * - تشغيل pipeline لكل عائلة
 * - ثم حفظ مؤجل
 */
export function importFamilies(obj = {}) {
  if (!obj || typeof obj !== 'object') return;

  Object.keys(obj).forEach((k) => {
    if (k === '__meta') return;
    const f = obj[k];
    if (!f) return;

    normalizeFamilyInPlace(f);
    families[k] = f;
  });

  return scheduleSavePersistedFamilies();
}

/**
 * exportFamilies:
 * - نسخ عميق ثم حذف المشتقات لتخفيف الحجم
 * - نفس منطقك (حذف wives من rootPerson + حذف persons + حذف مشتقات الأشخاص)
 */
export function exportFamilies() {
  const out = JSON.parse(JSON.stringify(families));

  Object.keys(out).forEach((k) => {
    if (k === '__meta') return;
    const f = out[k];
    if (!f) return;

    if (f.rootPerson?.wives) delete f.rootPerson.wives;
    if (f.persons) delete f.persons;

    walkPersons(f, (p) => {
      if (!p) return;

      delete p.childrenIds;
      delete p.spousesIds;
      delete p._normName;
      delete p._normRole;

      // نفس شرطك: لو photoUrl مكرر داخل bio احذفه من root
      if (p.photoUrl && p.bio?.photoUrl === p.photoUrl) delete p.photoUrl;
      delete p.photoVer;
    });
  });

  return out;
}

/* =========================
   9) تحميل كامل قبل التصدير من الواجهة
   - يضمن دمج persisted ثم إعادة pipeline لكل العائلات
========================= */
export async function loadPersistedFamiliesExport() {
  await loadPersistedFamilies();

  Object.keys(families || {}).forEach((k) => {
    const fam = families[k];
    if (!fam) return;
    normalizeFamilyInPlace(fam);
  });
}

/* =========================
   10) اختيار العائلة (localStorage)
========================= */
export function getSelectedKey() {
  return localStorage.getItem('selectedFamily') || 'family1';
}

export function setSelectedKey(k) {
  if (k == null) return;
  localStorage.setItem('selectedFamily', String(k));
}