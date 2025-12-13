// storage/families.store.js
// طبقة التخزين (IndexedDB + اختيار العائلة) + واجهة التعامل مع العائلات

import { DB } from './db.js';
import {
    SCHEMA_VERSION,
    normalizeFamilyPipeline,
    ensureFamilyBios,
    ensureIds,
    linkRootPersonWives,
    buildRealLinks,
    walkPersonsWithPath,
    walkPersons,
    getByPath,
    personFingerprint,
    sortedAncestors,
    ancestorsNames,
    LABELS,
    DEFAULT_BIO,
    getLineageConfig,
    findDuplicatesInFamily
} from '../model/families.core.js';

import { familiesData as seedFamiliesData } from '../model/families.seed.js';

// ثوابت التخزين
export const PERSIST_FAMILIES_KEY = 'families';

// خريطة العائلات الحيّة في الذاكرة (تبدأ من البذور)
export const families = seedFamiliesData;

// ================================
// 1) حفظ العائلات المخصّصة + ميتاداتا البذور
// ================================
export async function savePersistedFamilies() {
  try {
    const out = {};

    // العائلات المضافة/المعدّلة فقط
    Object.entries(families || {}).forEach(([k, f]) => {
      if (f && f.__custom) {
        const copy = { ...f, __v: SCHEMA_VERSION };
        if (copy.rootPerson) delete copy.rootPerson.wives; // منع المرآة
        out[k] = copy;
      }
    });

    // ميتاداتا للبذور (الإخفاء + الصور)
    const coreHidden = {};
    const corePhotos = {};

    Object.entries(families || {}).forEach(([k, f]) => {
      if (!f || !f.__core) return;
      if (f.hidden === true) coreHidden[k] = 1;

      const patch = {};
      walkPersonsWithPath(f, (p, path) => {
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
      if (Object.keys(patch).length) corePhotos[k] = patch;
    });

    out.__meta = { coreHidden, corePhotos };
    await DB.put(PERSIST_FAMILIES_KEY, out);
  } catch (e) {
    console.warn('savePersistedFamilies(idb)', e);
  }
}

// ================================
// 2) تحميل العائلات من IndexedDB ودمجها
// ================================
export async function loadPersistedFamilies() {
  try {
    const obj = await DB.get(PERSIST_FAMILIES_KEY);
    if (!obj) return;

    Object.keys(obj).forEach(k => {
      if (k === '__meta') return;
      const f = obj[k];
      if (!f) return;

      f.__custom = true;

      const ver = Number.isFinite(+f.__v) ? +f.__v : 0;
      normalizeFamilyPipeline(f, { fromVer: ver, markCore: !!f.__core });

      if (f.hidden == null) f.hidden = false;

      if (f.fullGrandsonName && !f.fullRootPersonName) {
        f.fullRootPersonName = f.fullGrandsonName;
        delete f.fullGrandsonName;
      }

      // اشتقاق familyName إن كانت فارغة
      if (!f.familyName){
        f.familyName = f.title ? String(f.title).replace(/^.*?:\s*/u,'').trim()
          : (f.rootPerson?.name?.split(/\s+/u)[0] || '');
      }

      // اشتقاق fullRootPersonName إن لزم (بدون لمس bio.fullName)
      if (f.rootPerson && !f.fullRootPersonName){
        const ancSorted = sortedAncestors(f);
        const ancNames  = ancestorsNames(ancSorted);
        const rootName   = String(f.rootPerson.name || '').trim();
        const fatherName = String(f.father?.name || '').trim();
        const rootFull = [rootName, fatherName, ...ancNames].filter(Boolean).join(' ').trim();
        if (rootFull) f.fullRootPersonName = rootFull;
      }

      families[k] = f;
    });

    // تطبيق إخفاء البذور
    const coreHidden = (obj.__meta && obj.__meta.coreHidden) || {};
    Object.keys(coreHidden).forEach(k => {
      if (families[k] && families[k].__core) families[k].hidden = true;
    });

    // ترقيع صور البذور
    const corePhotos = (obj.__meta && obj.__meta.corePhotos) || {};
    Object.entries(corePhotos).forEach(([famKey, patchMap]) => {
      const fam = families[famKey];
      if (!fam || !fam.__core || !patchMap) return;

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
        targetPerson.photoUrl = hit.photoUrl;
        targetPerson.photoVer = hit.photoVer || Date.now();
        if (hit.hasOrig) targetPerson.bio.photoHasOrig = 1; else delete targetPerson.bio.photoHasOrig;
        if (hit.rot) targetPerson.bio.photoRotated = 1; else delete targetPerson.bio.photoRotated;
        if (hit.crp) targetPerson.bio.photoCropped = 1; else delete targetPerson.bio.photoCropped;
      });
    });

  } catch (e) {
    console.warn('loadPersistedFamilies(idb)', e);
  }
}

// ================================
// 3) تهيئة المخزن (pipeline للبذور + تحميل من IndexedDB)
// ================================
export async function initFamiliesStore() {
  Object.keys(families || {}).forEach(k => {
    const f = families[k];
    if (!f) return;
    const ver = Number.isFinite(+f.__v) ? +f.__v : 0;
    normalizeFamilyPipeline(f, { fromVer: ver, markCore: true });
  });

  await loadPersistedFamilies();
}

// ================================
// 4) أدوات عامة للمسارات
// ================================
export function getFamilies() { return families; }
export function getFamily(key) { return families[key]; }

// مولّد مفاتيح لعائلة جديدة
export function generateFamilyKey() {
  const keys = Object.keys(families || {}); let max = 0;
  keys.forEach(k => {
    const m = k.match(/^family(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `family${max + 1}`;
}

// ================================
// 5) commit/save/import/export/delete
// ================================
export function commitFamily(key) {
  const fam = families[key];
  if (!fam) return;

  if (!fam.__custom) fam.__custom = true;

  const fromVer = Number.isFinite(+fam.__v) ? +fam.__v : 0;
  normalizeFamilyPipeline(fam, { fromVer, markCore: !!fam.__core });

  const ancSorted = sortedAncestors(fam);
  const ancNames  = ancestorsNames(ancSorted);

  if (!fam.familyName){
    fam.familyName = fam.title ? String(fam.title).replace(/^.*?:\s*/u,'').trim()
      : (fam.rootPerson?.name?.split(/\s+/u)[0] || '');
  }

  if (fam.rootPerson && !fam.fullRootPersonName){
    const rootName   = String(fam.rootPerson.name || '').trim();
    const fatherName = String(fam.father?.name || '').trim();
    const rootFull = [rootName, fatherName, ...ancNames].filter(Boolean).join(' ').trim();
    if (rootFull) fam.fullRootPersonName = rootFull;
  }

  savePersistedFamilies();
}

export function saveFamily(key, familyObj) {
  const wasCore = !!(families[key] && families[key].__core);
  familyObj.__custom = true;
  if (wasCore) familyObj.__core = true;

  const fromVer = Number.isFinite(+familyObj.__v) ? +familyObj.__v : 0;
  normalizeFamilyPipeline(familyObj, { fromVer, markCore: !!familyObj.__core });

  if (familyObj?.rootPerson?.wives && familyObj.rootPerson.wives.length) {
    console.warn('[families.store.saveFamily] تم تمرير rootPerson.wives وسيتم تجاهلها لصالح fam.wives');
  }
  if (familyObj?.rootPerson) delete familyObj.rootPerson.wives;

  families[key] = familyObj;

  savePersistedFamilies();
}

export async function deleteFamily(key) {
  if (!key || !families[key]) return false;
  delete families[key];
  await savePersistedFamilies();

  const sel = localStorage.getItem('selectedFamily');
  if (sel === key) {
    const next = Object.keys(families)[0] || '';
    if (next) localStorage.setItem('selectedFamily', next);
    else localStorage.removeItem('selectedFamily');
  }
  return true;
}

export function importFamilies(obj = {}) {
  if (!obj || typeof obj !== 'object') return;
  const all = families;

  Object.keys(obj).forEach(k => {
    if (k === '__meta') return;
    const f = obj[k];
    if (!f) return;

    const fromVer = Number.isFinite(+f.__v) ? +f.__v : 0;
    normalizeFamilyPipeline(f, { fromVer, markCore: !!f.__core });
    all[k] = f;
  });

  savePersistedFamilies();
}

export function exportFamilies() {
  const out = JSON.parse(JSON.stringify(families));

  Object.keys(out).forEach(k => {
    if (k === '__meta') return;
    const f = out[k];
    if (!f) return;

    if (f.rootPerson?.wives) delete f.rootPerson.wives;
    if (f.persons) delete f.persons;

    walkPersons(f, (p) => {
      if (!p) return;

      if (p.childrenIds) delete p.childrenIds;
      if (p.spousesIds)  delete p.spousesIds;

      if (p._normName) delete p._normName;
      if (p._normRole) delete p._normRole;

      if (p.photoUrl && p.bio?.photoUrl === p.photoUrl) delete p.photoUrl;
      if (p.photoVer) delete p.photoVer;
    });
  });

  return out;
}

// ================================
// 6) تحميل كامل (للاستخدام قبل الـ export عبر الـ UI)
// ================================
export async function loadPersistedFamiliesExport() {
  await loadPersistedFamilies();

  Object.keys(families || {}).forEach(k => {
    const fam = families[k];
    if (!fam) return;
    const fromVer = Number.isFinite(+fam.__v) ? +fam.__v : 0;
    normalizeFamilyPipeline(fam, { fromVer, markCore: !!fam.__core });
  });
}

// ================================
// 7) مفاتيح اختيار العائلة
// ================================
export function getSelectedKey() {
  return localStorage.getItem('selectedFamily') || 'family1';
}
export function setSelectedKey(k) {
  if (k == null) return;
  localStorage.setItem('selectedFamily', String(k));
}