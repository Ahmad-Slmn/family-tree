// features/io.js — الاستيراد/التصدير/السحب/التفريغ/النسخ الاحتياطي

import {
  byId, showSuccess, showInfo, showError, showWarning,
  downloadJson, readJsonFile, showConfirmModal
} from '../utils.js';

import * as Model from '../model/families.js';
import { normalizeFamilyPipeline } from '../model/families.core.js';

import { ensureIdsForAllFamilies } from './ids.js';
import { validateFamily } from './validate.js';

import {
  setValidationResults, getValidationSummary, openValidationModal,
  refreshValidationBadge, vcToastSummaryText
} from '../ui/validationCenter.js';

import { PinStore } from '../storage/pinStore.js';

let bus;

// قناة عامة للتواصل بين تبويبات التطبيق أثناء التفريغ
const appBC = ('BroadcastChannel' in window) ? new BroadcastChannel('app_channel') : null;

// ==============================
// 1) ثوابت / حالة عامة
// ==============================
const MAX_JSON_MB    = 64;
const MAX_JSON_BYTES = MAX_JSON_MB * 1024 * 1024;

// توقيت النسخ الاحتياطي الآلي
let _backupTimer = null;

// ==============================
// 2) أدوات مساعدة عامة (بدون تغيير سلوك)
// ==============================

/** ميتاداتا واضحة داخل ملف التصدير */
function buildExportMeta() {
  return {
    app: 'FamilyTree',
    schema: Model.SCHEMA_VERSION || 4,
    exportedAt: new Date().toISOString(),
    selectedFamily: Model.getSelectedKey?.() || null
  };
}

/** فحص سريع لبنية ملف العائلات */
function isValidFamiliesPayload(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).filter(k => k !== '__meta');
  if (!keys.length) return false;
  return keys.every(k => obj[k] && typeof obj[k] === 'object');
}

/** تنظيف اسم يصلح كاسم ملف */
function safeFileName(name) {
  return (
    String(name || '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'families'
  );
}

/** إزالة بادئة "عائلة" من الاسم إن كانت موجودة (متوافق مع JSHint) */
function stripFamilyPrefix(label) {
  var s = String(label || '').trim();
  s = s.replace(/^عائلة\s*:\s*/, '');
  s = s.replace(/^عائلة\s*-\s*/, '');
  s = s.replace(/^عائلة\s+/, '');
  return s.trim();
}

/** إعادة تسمية مفاتيح العائلات المستوردة إذا كان هناك تصادم */
function rekeyImportedFamilies(obj) {
  const out = {};
  const map = {};
  const existing = Model.getFamilies?.() || {};

  Object.keys(obj || {}).forEach(k => {
    if (k === '__meta') return;
    let nk = k;
    if (existing[k]) {
      nk = Model.generateFamilyKey?.() || (k + '_copy');
    }
    out[nk] = obj[k];
    map[k] = nk;
  });

  if (obj.__meta) out.__meta = obj.__meta;
  return { out, map };
}

/** إبطال blob آمن (مرة لكل عنوان) */
function revokeAllBlobImagesOnce() {
  const seen = new Set();
  document.querySelectorAll('img').forEach(img => {
    const s = img.currentSrc || img.src || '';
    if (s && s.startsWith('blob:') && !seen.has(s)) {
      seen.add(s);
      try { URL.revokeObjectURL(s); } catch {}
    }
  });
}

/** حذف قاعدة IndexedDB باسمها (مفصول عن اللوب لتجنب JSHint W083) */
function deleteIndexedDbByName(dbName) {
  return new Promise((resolve) => {
    let r;
    try { r = indexedDB.deleteDatabase(dbName); }
    catch { resolve(); return; }

    r.onsuccess = resolve;
    r.onerror   = resolve;
    r.onblocked = resolve;
  });
}

/**
 * تفريغ شامل لكل ما يمكن تفريغه من جانب المتصفح:
 * - IndexedDB (قاعدة التطبيق + أي قواعد لنفس الدومين إن أمكن)
 * - CacheStorage
 * - Service Workers
 * - localStorage / sessionStorage
 * - Cookies (غير HttpOnly فقط)
 *
 * ملاحظة: هذا لا يغيّر سلوك التفريغ الحالي، فقط يجمعه في دالة واحدة.
 */
async function wipeEverythingHard(ctx) {
  // 1) أوقف أي شيء قد يعيد الكتابة قبل التفريغ
  try { Model.pauseAutoSave?.(); } catch {}
  try { window.dispatchEvent(new CustomEvent('FT_WIPE_BEGIN')); } catch {}

  // 2) امسح قاعدة التطبيق الرئيسية
  try { await ctx?.DB?.nuke?.(); } catch {}

  // 2.1) إن دعم المتصفح indexedDB.databases: امسح أي قواعد أخرى تحت نفس الموقع
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (let i = 0; i < (dbs || []).length; i++) {
        const d = dbs[i];
        const dbName = (d && d.name) ? String(d.name) : '';
        if (!dbName) continue;
        await deleteIndexedDbByName(dbName);
      }
    }
  } catch {}

  // 3) CacheStorage
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch {}

  // 4) Service Workers
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch {}

  // 5) Storages
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}

  // 6) Cookies (غير HttpOnly فقط)
  try {
    const cookies = document.cookie ? document.cookie.split(';') : [];
    for (let i = 0; i < cookies.length; i++) {
      const c = cookies[i];
      const eqPos = c.indexOf('=');
      const name = (eqPos > -1 ? c.substr(0, eqPos) : c).trim();
      if (!name) continue;

      document.cookie = `${name}=; Max-Age=0; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  } catch {}

  // 7) نظّف blob URLs
  try { revokeAllBlobImagesOnce(); } catch {}
}

/** نصّ التأكيد مقبول؟ */
function confirmTextOk(v) {
  let t = String(v || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
  t = t.replace(/أ|إ|آ/g, 'ا');
  return (t === 'اوافق' || t === 'نعم' || t === 'اوافق على الحذف');
}

/** تنزيل نسخة احتياطية فورية */
async function autoDownloadBackup() {
  try {
    // قبل التصدير: حمّل من IDB لضمان أحدث نسخة
    await Model.loadPersistedFamiliesExport?.();
  } catch {}

  const blob = new Blob(
    [JSON.stringify(Model.exportFamilies(), null, 2)],
    { type: 'application/json' }
  );

  const a = document.createElement('a');
  a.download = `families-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Helpers صغيرة للـ DOM داخل مودال التفريغ (لتقليل التكرار) */
function liRow(label, valueText) {
  const li = document.createElement('li');
  li.appendChild(document.createTextNode(label + ': '));
  const b = document.createElement('b');
b.textContent = `(${valueText})`;
  li.appendChild(b);
  return li;
}

function addRowIf(ol, shouldShow, label, valueText) {
  if (!shouldShow) return;
  ol.appendChild(liRow(label, valueText));
}

// ==============================
// 3) ملخص التفريغ + تحقق وجود بيانات
// ==============================

/**
 * يبني ملخص “ما سيتم حذفه” بأرقام فعلية (بدون تغيير المنطق)
 * الهدف: عرض ملخص صادق للمستخدم قبل التفريغ.
 */
async function buildWipeSummary(ctx) {
  const out = {
    families: 0,
    photos: 0,
    storyPhotos: 0,
    eventPhotos: 0,
    sourcePhotos: 0,

    hasPin: false,

    uiThemeReset: false,
    uiFontReset: false,
    uiPrivacyPrefsReset: false
  };

  // 1) عدد العائلات المضافة (المخصصة فقط)
  try {
    await Model.loadPersistedFamiliesExport?.();

    const fams = Model.getFamilies?.() || {};
    out.families = Object.keys(fams)
      .filter(k => k !== '__meta')
      .map(k => fams[k])
      .filter(f => f && f.__custom === true && f.__core !== true)
      .length;
  } catch {}

  // 2) صور الأشخاص: فقط المرتبطة بأشخاص موجودين حاليًا (بدون بقايا)
  try {
    const famsAll = Model.getFamilies?.() || {};
    const liveIds = new Set();

    Object.keys(famsAll).forEach(k => {
      if (k === '__meta') return;
      const fam = famsAll[k];
      if (!fam) return;

      try {
        const stack = [];
        if (Array.isArray(fam.ancestors)) stack.push(...fam.ancestors);
        if (fam.father) stack.push(fam.father);
        if (fam.rootPerson) stack.push(fam.rootPerson);
        if (Array.isArray(fam.wives)) stack.push(...fam.wives);

        while (stack.length) {
          const p = stack.pop();
          if (!p || typeof p !== 'object') continue;

          if (p._id != null) liveIds.add(String(p._id));

          const ch = Array.isArray(p.children) ? p.children : [];
          const ws = Array.isArray(p.wives) ? p.wives : [];
          for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
          for (let i = 0; i < ws.length; i++) stack.push(ws[i]);
        }

        if (fam.persons && typeof fam.persons === 'object') {
          Object.values(fam.persons).forEach(pp => {
            if (pp && pp._id != null) liveIds.add(String(pp._id));
          });
        }
      } catch {}
    });

    const photoKeys = (await ctx.DB?._keysPhotos?.()) || [];
    let n = 0;
    for (let i = 0; i < photoKeys.length; i++) {
      if (liveIds.has(String(photoKeys[i]))) n++;
    }
    out.photos = n | 0;
  } catch {}

  // 3) صور/ملفات القصص/الأحداث/المصادر (إذا كانت counters موجودة)
  try { out.storyPhotos  = (await ctx.DB?._countStoryPhotos?.())  | 0; } catch {}
  try { out.eventPhotos  = (await ctx.DB?._countEventPhotos?.())  | 0; } catch {}
  try { out.sourcePhotos = (await ctx.DB?._countSourceFiles?.())  | 0; } catch {}

  // 4) PIN: فحص سريع
  try {
    await PinStore.init?.();

    const enabled = PinStore.getSync?.('pin_enabled', '0');
    const salt    = PinStore.getSync?.('pin_salt', '');
    const hash    = PinStore.getSync?.('pin_hash', '');
    const hint    = PinStore.getSync?.('pin_hint', '');
    const sess    = parseInt(PinStore.getSync?.('pin_session_until', '0'), 10) || 0;

    out.hasPin = (enabled === '1' || !!salt || !!hash || !!hint || sess > 0);
  } catch {}

  // 5) تفضيلات الواجهة من localStorage
  try {
    const theme =
      localStorage.getItem('familyTreeTheme') ||
      localStorage.getItem('theme') ||
      localStorage.getItem('appTheme');

     const font = localStorage.getItem('siteFontSize');

    out.uiThemeReset  = (theme != null && theme !== 'default');
    out.uiFontReset   = (font != null && String(font) !== '16');

  } catch {}

  // 6) تفضيلات الخصوصية (من PinStore) بدقة
  try {
    await PinStore.init?.();

    const PIN_DEFAULTS = { idle: 60, vis: '0', sessionMin: 15 };
    const MISSING = '__MISSING__';

    const idleRaw  = PinStore.getSync?.('pin_idle_minutes', MISSING);
    const visRaw   = PinStore.getSync?.('pin_lock_on_visibility', MISSING);
    const sessRaw  = PinStore.getSync?.('pin_session_minutes', MISSING);
    const untilRaw = PinStore.getSync?.('pin_session_until', MISSING);

    const idle = (idleRaw === MISSING) ? PIN_DEFAULTS.idle : (parseInt(idleRaw, 10) || PIN_DEFAULTS.idle);
    const vis  = (visRaw  === MISSING) ? PIN_DEFAULTS.vis  : String(visRaw ?? PIN_DEFAULTS.vis);
    const sess = (sessRaw === MISSING) ? PIN_DEFAULTS.sessionMin : (parseInt(sessRaw, 10) || PIN_DEFAULTS.sessionMin);

    const isDefault =
      (idle === PIN_DEFAULTS.idle) &&
      (vis  === PIN_DEFAULTS.vis) &&
      (sess === PIN_DEFAULTS.sessionMin) &&
      (untilRaw === MISSING);

    out.uiPrivacyPrefsReset = !isDefault;
  } catch {}

  return out;
}

/**
 * تحقق وجود بيانات “حقيقية” قبل فتح مودال التفريغ
 * (منطقك كما هو، لكن مرتب ومركّز)
 */
async function hasAnyPersistedData(ctx) {
  // 0) ذاكرة: أي عائلة مخصصة؟
  try {
    const fams = Model.getFamilies?.() || {};
    if (Object.values(fams).some(f => f && f.__custom)) return true;
  } catch {}

  // 1) IndexedDB: صور/ملفات أو families_custom/meta فيها شيء فعلي
  try {
    const np   = (await ctx.DB?._countPhotos?.()) | 0;
    const ns   = (await ctx.DB?._countStoryPhotos?.()) | 0;
    const ne   = (await ctx.DB?._countEventPhotos?.()) | 0;
    const nsrc = (await ctx.DB?._countSourceFiles?.()) | 0;
    if (np > 0 || ns > 0 || ne > 0 || nsrc > 0) return true;

    const custom = await ctx.DB?.get?.('families_custom');
    if (custom && typeof custom === 'object' && Object.keys(custom).length > 0) return true;

    const meta = await ctx.DB?.get?.('families_meta');
    const hasHidden = !!(meta && meta.coreHidden && Object.keys(meta.coreHidden).length);
    const hasCorePhotos = !!(meta && meta.corePhotos && Object.keys(meta.corePhotos).length);
    if (hasHidden || hasCorePhotos) return true;
  } catch {}

  // 1.5) PinStore: هل توجد أي بيانات PIN محفوظة؟
  try {
    await PinStore.init?.();

    const enabled = PinStore.getSync?.('pin_enabled', '0');
    const salt    = PinStore.getSync?.('pin_salt', '');
    const hash    = PinStore.getSync?.('pin_hash', '');
    const hint    = PinStore.getSync?.('pin_hint', '');
    const sess    = PinStore.getSync?.('pin_session_until', '0');

    const sessUntil = parseInt(sess, 10) || 0;

    if (enabled === '1' || !!salt || !!hash || !!hint || sessUntil > 0) return true;

    if (PinStore.PERSISTED_KEYS && PinStore.getSync) {
      for (const k of PinStore.PERSISTED_KEYS) {
        const v = PinStore.getSync(k, null);
        if (v != null && String(v) !== '') return true;
      }
    }
  } catch {}

  // 2) تفضيلات غير افتراضية (لا نحتسب autoBackup)
  const theme =
    localStorage.getItem('theme') ||
    localStorage.getItem('appTheme') ||
    localStorage.getItem('familyTreeTheme');

  const font = localStorage.getItem('siteFontSize');

  return !!(
    (theme != null && theme !== 'default') ||
    (font  != null && String(font) !== '16')
  );

}

// ==============================
// 4) الاستيراد (JSON) + أخطاء الاستيراد
// ==============================

async function importJsonFileObject(ctx, file) {
  if (!file) throw new Error('no-file');

  // النوع
  if (file.type && file.type !== 'application/json') throw new Error('bad-type');

  // الحجم
  if (file.size > MAX_JSON_BYTES) throw new Error('too-large');

  // قراءة النص
  let text;
  try { text = await file.text(); } catch { throw new Error('read-failed'); }

  // JSON
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('bad-json'); }

  if (!isValidFamiliesPayload(obj)) throw new Error('bad-payload');

  // معلومات عن الملف
  const keys = Object.keys(obj || {}).filter(k => k !== '__meta');
  if (keys.length) {
    const meta = obj.__meta || {};
    const when = meta.exportedAt ? ` — تاريخ التصدير: ${meta.exportedAt.slice(0, 19).replace('T', ' ')}`
      : '';
    showInfo(`تم تحميل ملف: ${file.name} — عدد العائلات: ${keys.length}${when}`);
  }

  await doImport(ctx, obj);
}

function handleImportError(err) {
  const msg = err?.message || '';

  if (msg === 'no-file') {
    showInfo('لم يتم اختيار أي ملف.');
  } else if (msg === 'too-large') {
    showError(`الملف كبير جدًا. الحد ${MAX_JSON_MB}MB.
إذا كان الملف يحتوي بيانات ضخمة جدًا أو صورًا مضمنة، جرّب تقسيمه أو تقليل محتواه.`);
  } else if (msg === 'bad-type') {
    showError('نوع الملف غير مدعوم. استخدم ملف JSON فقط.');
  } else if (msg === 'bad-json') {
    showError('تعذّر قراءة محتوى JSON. تأكد من أن الملف غير تالف.');
  } else if (msg === 'bad-payload') {
    showError('هيكل الملف غير مطابق لتصدير التطبيق. تأكد أنك تستخدم ملفًا تم تصديره من هذه المنصّة.');
  } else if (msg === 'read-failed') {
    showError('حدث خطأ أثناء قراءة الملف من جهازك.');
  } else if (msg === 'import-validation-failed') {
    showError('فشل الاستيراد لأن بعض العائلات تحتوي دورات نسب/تعارضات أو تحذيرات عمر شديدة.');
  } else {
    console.error('Import error:', err);
    showError('فشل الاستيراد. تأكد من صحة الملف أو أعد المحاولة.');
  }
}

/** استيراد موحّد (ذكي ومحصّن) */
async function doImport(ctx, obj) {
  if (!isValidFamiliesPayload(obj)) throw new Error('bad-payload');

  const metaVer =
    +obj.__meta?.schema ||
    +obj.__meta?.version ||
    null;

  // 1) حل تعارض المفاتيح
  const { out: rekeyed, map } = rekeyImportedFamilies(obj);
  obj = rekeyed;

  // 2) دمج في الموديل
  const importedKeys = Object.keys(obj).filter(k => k !== '__meta');
  Model.importFamilies(obj);

  // 3) IDs أولاً
  await ensureIdsForAllFamilies();

  // 4) pipeline نهائي على المستورد
  try {
    const fams = Model.getFamilies?.() || {};
    importedKeys.forEach(k => {
      const fam = fams[k];
      if (!fam || typeof fam !== 'object') return;

      fam.__custom = true;
      fam.__core = false;

      const fromVer =
        Number.isFinite(metaVer)           ? metaVer :
        Number.isFinite(fam.__v)           ? fam.__v :
        Number.isFinite(fam.schemaVersion) ? fam.schemaVersion :
        0;

      normalizeFamilyPipeline(fam, { fromVer, markCore: false });
      fam.__pipelineReady = true;
    });
  } catch {}

  // 5) Validation Center بعد الاستيراد (كما هو)
  {
    const fams = Model.getFamilies?.() || {};
    const items = [];
    const badKeys = [];

    for (const k of importedKeys) {
      const fam = fams[k];
      if (!fam) continue;

      const { errors, warnings } = validateFamily(fam);

      const title =
        fam.title ||
        fam.familyName ||
        fam.fullRootPersonName ||
        String(k);

      items.push({ key: String(k), title: `عائلة: ${title}`, errors, warnings });

      setValidationResults(`family:${k}`, {
        title: `تنبيهات التحقق — ${title}`,
        errors,
        warnings,
        meta: { familyKey: String(k), ts: Date.now(), origin: 'import' }
      });

      const hasSevere = (warnings || []).some(w => w && w.level === 'severe');
      if (hasSevere) badKeys.push(k);
    }

    setValidationResults('import:latest', {
      title: 'تنبيهات التحقق — آخر استيراد',
      items,
      meta: { importedKeys: importedKeys.map(String), ts: Date.now() }
    });

    const sum = getValidationSummary('import:latest');
    if (sum.counts.total > 0) {
      const msg = vcToastSummaryText(sum);
      if (sum.hasBlockers) showError(`تم الاستيراد، لكن ${msg} راجع أيقونة التنبيهات.`);
      else showWarning(`تم الاستيراد، لكن ${msg} راجع أيقونة التنبيهات.`);
    }
  }

  // 6) حفظ
  await Model.savePersistedFamilies?.();

  // 7) اختيار العائلة
  const selOld = obj.__meta?.selectedFamily;
  const selNew = selOld ? (map[selOld] || selOld) : null;

  const finalSel =
    (selNew && (Model.getFamilies?.()[selNew])) ? selNew
      : (importedKeys[0] || Model.getSelectedKey?.() || null);

  if (finalSel && Model.setSelectedKey) Model.setSelectedKey(finalSel);

  if (finalSel && ctx?.state?.setState) {
    ctx.state.setState({ selectedFamily: finalSel });
  } else {
    ctx?.state?.setState?.({});
  }

  ctx?.bus?.emit('io:import:done');
  try { refreshValidationBadge(); } catch {}
  ctx?.bus?.emit('families:coreFlag:refresh');
}

// ==============================
// 5) واجهة التصدير
// ==============================

function getCurrentFamilyDisplayName() {
  // 1) treeTitle إن وجد
  const treeTitle = byId('treeTitle');
  const t = treeTitle?.textContent?.trim();
  if (t) return t;

  // 2) fallback من الموديل
  try {
    const all = Model.exportFamilies?.() || {};
    const key = Model.getSelectedKey?.() || 'family1';
    const fam = all[key];
    if (fam) {
      return String(
        fam.familyName ||
        fam.fullRootPersonName ||
        fam.rootPerson?.name ||
        key
      ).trim();
    }
  } catch {}

  return '';
}

function bindExportButton() {
  const exportBtn = byId('exportBtn');
  if (!exportBtn) return;

  const icon = exportBtn.querySelector('i');

  const updateLabel = () => {
    const nm = getCurrentFamilyDisplayName();
    exportBtn.innerHTML = '';
    if (icon) exportBtn.appendChild(icon);
    exportBtn.appendChild(document.createTextNode(nm ? ` تصدير ${nm}` : ' تصدير'));
  };

  updateLabel();

  exportBtn.addEventListener('click', () => {
    const all = Model.exportFamilies();
    const key = Model.getSelectedKey?.() || 'family1';
    const fam = all[key];

    // إن لم توجد عائلة حالية واضحة، صدّر الكل
    if (!fam) {
      downloadJson(all, 'all-families.json');
      return;
    }

    const rawFamilyName = stripFamilyPrefix(getCurrentFamilyDisplayName() || key);
    const safeName = safeFileName(`عائلة - ${rawFamilyName}`);

    const payload = { [key]: fam, __meta: buildExportMeta() };
    const doExport = () => downloadJson(payload, `${safeName}.json`);

    // VALIDATION قبل التصدير — نفس منطق الطباعة
    {
      const { errors, warnings } = validateFamily(fam);

      setValidationResults(`export:${key}`, {
        title: `تنبيهات التحقق — قبل التصدير (${rawFamilyName || key})`,
        errors,
        warnings,
        meta: { familyKey: key, ts: Date.now() }
      });

      const sum = getValidationSummary(`export:${key}`);

      // لا توجد تنبيهات => صدّر مباشرة
      if (sum.counts.total === 0) {
        doExport();
        return;
      }

      const msg = vcToastSummaryText(sum);
      if (sum.hasBlockers) showError(`يوجد تنبيهات تمنع التصدير: ${msg}`);
      else showWarning(`يوجد تنبيهات قبل التصدير: ${msg}`);

      (async () => {
        const res = await showConfirmModal({
          title: sum.hasBlockers ? 'تنبيهات تمنع التصدير' : 'تنبيهات قبل التصدير',
          message:
            `يوجد تنبيهات مرتبطة بهذه العائلة.\n\n` +
            `${msg}\n\n` +
            `اختر أحد الخيارين:`,
          confirmText: 'عرض التنبيهات',
          cancelText: 'تصدير',
          variant: sum.hasBlockers ? 'danger' : 'warning',
          closeOnBackdrop: true,
          closeOnEsc: true,
          defaultFocus: 'confirm'
        });

        if (res === 'confirm') {
          openValidationModal(`export:${key}`);
          return;
        }
        if (res === 'cancel') {
          doExport();
          showSuccess('تم التصدير رغم وجود التنبيهات.');
          return;
        }
      })();

      return; // امنع أي تنفيذ لاحق
    }

    doExport();
  });

  // راقب تغيّر العنوان وحدّث الزر
  const treeTitle = byId('treeTitle');
  if (treeTitle && window.MutationObserver) {
    const mo = new MutationObserver(() => updateLabel());
    mo.observe(treeTitle, { childList: true, subtree: true, characterData: true });
  }
}

// ==============================
// 6) ربط الاستيراد (input + DnD)
// ==============================

function bindImportInput(ctx) {
  const importInput = byId('importInput');
  if (!importInput) return;

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    try {
      await importJsonFileObject(ctx, file);
      ctx?.redrawUI?.();
      showSuccess('تم الاستيراد بنجاح.');
    } catch (err) {
      handleImportError(err);
    } finally {
      importInput.value = '';
    }
  });
}

function isDragAndDropUseful() {
  const hasDnD =
    'draggable' in document.createElement('div') &&
    'DataTransfer' in window;

  if (!hasDnD) return false;

  if (window.matchMedia) {
    const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touchOnly) return false;
  }

  return true;
}

function bindDragDropImport(ctx) {
  const importDropZone = document.getElementById('importDropZone');
  if (!importDropZone) return;

  const mq = window.matchMedia ? window.matchMedia('(hover: none) and (pointer: coarse)')
    : null;

  const updateVisibility = () => {
    if (!mq) return;
    importDropZone.style.display = mq.matches ? 'none' : '';
  };

  if (mq) {
    updateVisibility();
    if (mq.addEventListener) mq.addEventListener('change', updateVisibility);
    else if (mq.addListener) mq.addListener(updateVisibility);
  }

  if (!isDragAndDropUseful()) return;

  // منع فتح الملف مباشرة
  window.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', () => {
    importDropZone.classList.remove('is-drag-over');
  });

  ['dragenter', 'dragover'].forEach(evName => {
    importDropZone.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      importDropZone.classList.add('is-drag-over');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(evName => {
    importDropZone.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      importDropZone.classList.remove('is-drag-over');
    });
  });

  importDropZone.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer?.files || [])
      .filter(f => !f.type || f.type === 'application/json');

    if (!files.length) {
      showInfo('أفلت ملف JSON فقط داخل هذه المنطقة.');
      return;
    }

    const file = files[0];
    if (files.length > 1) showInfo('تم اكتشاف أكثر من ملف. سيتم استخدام أول ملف فقط.');

    try {
      await importJsonFileObject(ctx, file);
      ctx?.redrawUI?.();
      showSuccess('تم الاستيراد من الملف المسحوب.');
    } catch (err) {
      handleImportError(err);
    }
  });

  // منع إسقاط الملفات خارج منطقة الاستيراد من فتحها في المتصفح
  window.addEventListener('drop', e => {
    e.preventDefault();
    const hasFiles = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length;
    if (hasFiles && !e.target.closest?.('#importDropZone')) {
      showInfo('لاستيراد العائلات، اسحب ملف JSON وأسقطه داخل مربع الاستيراد في لوحة الإعدادات.');
    }
  });
}

// ==============================
// 7) التفريغ الشامل (Hard Reset)
// ==============================

function bindHardReset(ctx) {
  const btn = byId('hardResetBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    // لا تفتح مودال التفريغ إلا إذا كان هناك شيء مخزّن فعلي
    if (!(await hasAnyPersistedData(ctx))) {
      showInfo('لا توجد بيانات محفوظة للتفريغ.');
      return;
    }

    const sum = await buildWipeSummary(ctx);

    const hasAnythingReal =
      (sum.families > 0) ||
      (sum.photos > 0) ||
      (sum.storyPhotos > 0) ||
      (sum.eventPhotos > 0) ||
      (sum.sourcePhotos > 0) ||
      !!sum.hasPin ||
       !!sum.uiThemeReset ||
      !!sum.uiFontReset ||
      !!sum.uiPrivacyPrefsReset;

    if (!hasAnythingReal) {
      showInfo('لا توجد بيانات محفوظة للتفريغ.');
      return; // ضمان 100% عدم فتح المودال لو لا يوجد شيء
    }

    // بناء DOM المودال بدون innerHTML
    const body = document.createElement('div');
    body.className = 'danger-box';

    const p = document.createElement('p');
    p.textContent = 'سيتم تنفيذ التفريغ التالي (قبل الحذف):';

    const ol = document.createElement('ol');
    ol.className = 'list-nums';

    // العدادات (لا تعرض إن كانت 0)
    addRowIf(ol, sum.families > 0,     'العائلات المضافة',   String(sum.families));
    addRowIf(ol, sum.photos > 0,       'صور الأشخاص',        String(sum.photos));
    addRowIf(ol, sum.storyPhotos > 0,  'صور القصص',          String(sum.storyPhotos));
    addRowIf(ol, sum.eventPhotos > 0,  'صور الأحداث',        String(sum.eventPhotos));
    addRowIf(ol, sum.sourcePhotos > 0, 'ملفات/صور المصادر',  String(sum.sourcePhotos));

    // حالات/تفضيلات (لا تعرض إن كانت false)
    addRowIf(ol, !!sum.hasPin,              'بيانات كلمة المرور محفوظة', 'نعم');
    addRowIf(ol, !!sum.uiThemeReset,        'إعادة النمط للوضع الافتراضي', 'نعم');
    addRowIf(ol, !!sum.uiFontReset,         'إعادة حجم الخط (16px)', 'نعم');
    addRowIf(ol, !!sum.uiPrivacyPrefsReset, 'إعادة تفضيلات الخصوصية', 'نعم');

    if (!ol.children.length) {
      ol.appendChild(liRow('لا توجد عناصر مهمة للعرض', '—'));
    }

    const label = document.createElement('label');
    label.className = 'confirm-type';
    label.setAttribute('for', 'wipeConfirmInput');
    label.appendChild(document.createTextNode('اكتب '));

    const code1 = document.createElement('code'); code1.textContent = 'أوافق';
    const code2 = document.createElement('code'); code2.textContent = 'نعم';
    const code3 = document.createElement('code'); code3.textContent = 'أوافق على الحذف';

    label.appendChild(code1);
    label.appendChild(document.createTextNode(' أو '));
    label.appendChild(code2);
    label.appendChild(document.createTextNode(' (أو '));
    label.appendChild(code3);
    label.appendChild(document.createTextNode(') للموافقة:'));

    const inputEl = document.createElement('input');
    inputEl.id = 'wipeConfirmInput';
    inputEl.type = 'text';
    inputEl.placeholder = 'أوافق / نعم';
    inputEl.autocomplete = 'off';

    const backupWrap = document.createElement('div');
    backupWrap.className = 'confirm-type';
    backupWrap.style.marginTop = '8px';
    backupWrap.style.display = 'flex';
    backupWrap.style.gap = '8px';
    backupWrap.style.alignItems = 'center';

    const backupChk = document.createElement('input');
    backupChk.id = 'wipeDoBackup';
    backupChk.type = 'checkbox';

    const backupLbl = document.createElement('label');
    backupLbl.setAttribute('for', 'wipeDoBackup');
    backupLbl.style.margin = '0';
    backupLbl.textContent = 'حفظ بيانات العائلات قبل التفريغ';

    backupWrap.append(backupChk, backupLbl);
    body.append(p, ol, label, inputEl, backupWrap);

    // تلميح ذكي على الإدخال (بدون توست مزعج فورًا)
    let _wipeHintTimer = null;
    inputEl.addEventListener('input', () => {
      const v = (inputEl.value || '').trim();
      if (_wipeHintTimer) { clearTimeout(_wipeHintTimer); _wipeHintTimer = null; }
      if (!v || confirmTextOk(v)) return;

      _wipeHintTimer = setTimeout(() => {
        const cur = (inputEl.value || '').trim();
        if (cur && !confirmTextOk(cur)) {
          showInfo('اكتب "أوافق" أو "نعم" أو "أوافق على الحذف" للمتابعة.');
        }
      }, 600);
    });

    const res = await showConfirmModal({
      title: 'تفريغ جميع البيانات',
      bodyNode: body,
      confirmText: 'تفريغ الآن',
      cancelText: 'إلغاء',
      variant: 'danger',
      closeOnBackdrop: false,
      closeOnEsc: false,
      defaultFocus: 'cancel',

      confirmDisabledUntilValid: true,
      onInputValidChange: (setValid) => {
        const sync = () => setValid(confirmTextOk((inputEl.value || '').trim()));
        inputEl.addEventListener('input', sync);
        sync();
      },

      preConfirm: async () => {
        const val = (inputEl.value || '').trim();
        if (!val) { showInfo('الرجاء كتابة "أوافق" أو "نعم" قبل المتابعة.'); return false; }
        if (!confirmTextOk(val)) { showError('النص المدخل غير صحيح.'); return false; }

        try {
          // أخبر بقية التبويبات أن التفريغ بدأ
          try { appBC?.postMessage({ type: 'wipe:begin', at: Date.now() }); } catch {}

          const doBackup = !!backupChk.checked;
          if (doBackup) { try { await autoDownloadBackup(); } catch {} }

          await wipeEverythingHard(ctx);

          try {
            Model.resetInMemory?.();
            ctx.state?.setState?.({});
            ctx.bus?.emit('wipe:after');
          } catch {}

          showSuccess('تم التفريغ بنجاح. سيُعاد تشغيل التطبيق الآن.');
        } catch {
          showError('تعذّر التفريغ الكامل. قد يكون هناك تبويب آخر مفتوح يمنع الحذف. أُكمل المسح الجزئي وإعادة التشغيل.');
        } finally {
          // تنظيف CSS theme classes
          try {
            document.documentElement.classList.remove(
              'theme-corporate', 'theme-elegant',
              'theme-minimal', 'theme-royal',
              'theme-dark'
            );
          } catch {}

          // أوقف timers الخاصة بالنسخ الاحتياطي
          try {
            if (_backupTimer) {
              clearTimeout(_backupTimer);
              clearInterval(_backupTimer);
              _backupTimer = null;
            }
          } catch {}

          // تحقق سريع بعد التفريغ (كما كان)
          try {
            const nf = (await ctx.DB?._countFamilies?.()) | 0;
            const np =
              ((await ctx.DB?._countPhotos?.()) | 0) +
              ((await ctx.DB?._countStoryPhotos?.()) | 0) +
              ((await ctx.DB?._countEventPhotos?.()) | 0) +
              ((await ctx.DB?._countSourceFiles?.()) | 0);

            let pinLeft = false;
            try {
              await PinStore.init?.();
              const enabled = PinStore.getSync?.('pin_enabled', '0');
              const hash = PinStore.getSync?.('pin_hash', '');
              pinLeft = (enabled === '1' || !!hash);
            } catch {}

            if (nf || np || pinLeft) {
              showWarning(
                `تم التفريغ، لكن ما زالت بعض البيانات موجودة ` +
                `(عائلات:${nf} صور/ملفات:${np} PIN:${pinLeft ? 'نعم' : 'لا'}). ` +
                `قد يكون السبب تبويب آخر مفتوح.`
              );
            }
          } catch {}

          setTimeout(() => { location.reload(); }, 300);
        }

        return true;
      }
    });

    if (res !== 'confirm') {
      showInfo('تم إلغاء عملية التفريغ.');
      return;
    }
  });
}

// ==============================
// 8) النسخ الاحتياطي الآلي + تنظيف قبل الإغلاق
// ==============================

function initAutoBackup() {
  if (localStorage.getItem('autoBackup') === '1' && !_backupTimer) {
    const jitter = Math.floor(Math.random() * 30000); // ≤ 30s
    _backupTimer = setTimeout(() => {
      _backupTimer = setInterval(autoDownloadBackup, 15 * 60 * 1000);
      autoDownloadBackup();
    }, jitter);
  }
}

function bindBeforeUnloadCleanup() {
  window.addEventListener('beforeunload', () => {
    revokeAllBlobImagesOnce();
  });
}

// ==============================
// 9) نقطة الدخول
// ==============================

export function init(ctx) {
  bus = ctx.bus;

  // استقبل إشعار التفريغ من تبويب آخر: أوقف autosave ثم أعد التحميل
  try {
    appBC?.addEventListener('message', (e) => {
      const msg = e?.data;
      if (!msg || msg.type !== 'wipe:begin') return;

      try { Model.pauseAutoSave?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('FT_WIPE_BEGIN')); } catch {}
      try { location.reload(); } catch {}
    });
  } catch {}

  bindExportButton();
  bindImportInput(ctx);
  bindHardReset(ctx);
  bindDragDropImport(ctx);
  initAutoBackup();
  bindBeforeUnloadCleanup();

  return {};
}