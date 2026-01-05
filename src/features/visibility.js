// features/visibility.js — إدارة الرؤية + الراية العامة + واجهات مساعدة
// - يمنع إخفاء آخر عائلة مرئية إلا بخيار force
// - يحدّث راية "وجود عائلات أساسية مخفية"
// - يبثّ حدث families:visibility:changed لكل تغيّر رؤية
// - يقدّم واجهات: إخفاء/إظهار/تبديل/إظهار كل الأساسيات + عدّ المرئيات + إيجاد أول مرئي

import * as Model from '../model/families.js';
import { setHasHiddenCoreFamilies, setOnResetHiddenCore, showConfirmModal, highlight } from '../utils.js';


/* =========================
   1) الراية العامة: عائلات أساسية مخفية؟
========================= */
function updateCoreHiddenFlag(){
  const fams = Model.getFamilies();
  setHasHiddenCoreFamilies(
    Object.values(fams).some(f => f && f.__core && f.hidden === true)
  );
}

/* =========================
   2) أدوات مساعدة للرؤية
========================= */

// أول مفتاح لعائلة مرئية
function getNextVisibleFamilyKey() {
  const fams = Model.getFamilies();
  return Object.keys(fams).find(k => fams[k] && !fams[k].hidden) || null;
}

// عدد العائلات المرئية
function countVisibleFamilies(){
  const fams = Model.getFamilies();
  return Object.keys(fams).reduce((n,k)=> n + (fams[k] && !fams[k].hidden ? 1 : 0), 0);
}

/* =========================
   3) عمليات على الرؤية
========================= */

// إظهار عائلة واحدة
async function showFamily(
  key,
  { Model, redrawUI, showSuccess, highlight, bus }
){
  const fam = Model.getFamily(key);
  if (!fam) return;
  if (fam.hidden !== true) return;

  fam.hidden = false;
  Model.commitFamily(key);

  updateCoreHiddenFlag();
  redrawUI();

  const label = fam.familyName || fam.title || fam.rootPerson?.name || key;
  showSuccess(`تم إظهار العائلة ${highlight(label)}.`);
  try { bus?.emit?.('families:visibility:changed'); } catch {}
}

// إخفاء عائلة واحدة مع حماية "آخر مرئي"
async function onHideFamily(
  key,
  { Model, redrawUI, showInfo, showSuccess, highlight, bus },
  opts = { force:false }
){
  const fam = Model.getFamily(key);
  if (!fam) return;

const fams = Model.getFamilies();
const visibleKeys = Object.keys(fams).filter(k => !fams[k]?.hidden);
const isLastVisible = visibleKeys.length === 1 && visibleKeys[0] === key;

const famLabel = fam.familyName || fam.title || fam.rootPerson?.name || key;

// (1) حالة آخر عائلة مرئية: تأكيد أقوى (إلزامي)
if (isLastVisible && !opts.force){
  const res = await showConfirmModal({
    title: 'إخفاء العائلة',
    message: `هذه آخر عائلة مرئية. هل تريد إخفاء "${famLabel}"؟ يمكن إظهارها لاحقًا من الإعدادات.`,
    confirmText: 'إخفاء',
    cancelText: 'إلغاء',
    variant: 'danger',
    _ariaRole: 'alertdialog'
  });

  if (res !== 'confirm') return;

  // أعد الاستدعاء مع force:true بعد الموافقة
  return onHideFamily(
    key,
    { Model, redrawUI, showInfo, showSuccess, highlight, bus },
    { force: true }
  );
}

// (2) إخفاء عادي (خصوصًا للعائلات الأساسية core): تأكيد موحّد داخل المنطق
// ملاحظة: نخلي التأكيد افتراضيًا للعائلات الأساسية، وإذا احتجت لاحقًا توسّعها على غيرها بسهولة.
if (fam.__core && !opts.force){
  const res = await showConfirmModal({
    title: 'إخفاء العائلة',
    message: `هل تريد إخفاء "${famLabel}" من القائمة؟ يمكن إظهارها لاحقًا من الإعدادات.`,
    confirmText: 'إخفاء',
    cancelText: 'إلغاء',
    variant: 'warning',
    defaultFocus: 'cancel'
  });

  if (res !== 'confirm') return;
}


  // إخفاء + التزام
  fam.hidden = true;
  Model.commitFamily(key);

  const wasSelected = Model.getSelectedKey() === key;
  const next = getNextVisibleFamilyKey(); // قد تكون null

  // لا توجد عائلات مرئية بعد الإخفاء
  if (!next){
    try { Model.setSelectedKey(''); } catch {}
    redrawUI();
    updateCoreHiddenFlag();
showInfo('لا توجد عائلات مرئية حالياً. يمكنك إضافة عائلة جديدة أو إظهار العائلات الأساسية من إعدادات ' + highlight('إعادة تفضيلات الواجهة') + '.');
    try { bus?.emit?.('families:visibility:changed'); } catch {}
    return;
  }

  // إن كانت المخفية مختارة فانتقل لأول مرئي
  if (wasSelected){
    Model.setSelectedKey(next);
    redrawUI();
    updateCoreHiddenFlag();
    const labelNext = (fams[next]?.familyName || fams[next]?.title || fams[next]?.rootPerson?.name || next);
    const oldLabel  = fam.familyName || fam.title || fam.rootPerson?.name || key;
    showSuccess(`تم إخفاء العائلة ${highlight(oldLabel)}. وتم الانتقال إلى: ${highlight(labelNext)}.`);
    try { bus?.emit?.('families:visibility:changed'); } catch {}
    return;
  }

  // إخفاء عادي
  redrawUI();
  updateCoreHiddenFlag();
  const oldLabel = fam.familyName || fam.title || fam.rootPerson?.name || key;
  showSuccess(`تم إخفاء العائلة ${highlight(oldLabel)}.`);
  try { bus?.emit?.('families:visibility:changed'); } catch {}
}

// تبديل حالة الرؤية لعائلة
async function toggleFamilyVisibility(key, deps, opts){
  const fam = Model.getFamily(key);
  if (!fam) return;
  if (fam.hidden) return showFamily(key, deps);
  return onHideFamily(key, deps, opts);
}

// إظهار جميع العائلات الأساسية المخفية
async function showAllCore({ Model, redrawUI, showSuccess, bus }){
  const fams = Model.getFamilies();
  let touched = 0;

  Object.keys(fams).forEach(k => {
    const f = fams[k];
    if (f && f.__core && f.hidden){ f.hidden = false; touched++; }
  });

  if (touched){
    await Model.savePersistedFamilies?.();
    updateCoreHiddenFlag();
    redrawUI();
    showSuccess(`تم إظهار ${touched} من العائلات الأساسية.`);
    try { bus?.emit?.('families:visibility:changed'); } catch {}
  }
}

/* =========================
   4) ربط إجراء إعادة الضبط من utils
========================= */
setOnResetHiddenCore(async () => {
  const fams = Model.getFamilies();
  let touched = 0;
  const labels = [];

  Object.keys(fams).forEach(k => {
    const f = fams[k];
    if (f && f.__core && f.hidden) {
      f.hidden = false;
      touched++;

      const label =
        f.familyName ||
        f.title ||
        (f.rootPerson && f.rootPerson.name) ||
        k;

      labels.push(label);
    }
  });

  if (touched) {
    await Model.savePersistedFamilies?.();
    updateCoreHiddenFlag();
    // يُترك إعادة الرسم للطبقة العليا عبر bus/النداء الأصلي
  }

  // NEW: إرجاع عدد العائلات + أسمائها
  return { count: touched, labels };
});

/* =========================
   5) التهيئة
========================= */
export function init(ctx){
  // تحدّث الراية عند أحداث تؤثر على الرؤية
  ctx.bus.on('families:coreFlag:refresh', updateCoreHiddenFlag);
  ctx.bus.on('families:changed',           updateCoreHiddenFlag);
  ctx.bus.on('families:imported',          updateCoreHiddenFlag);

  updateCoreHiddenFlag();

  // واجهة خفيفة مفيدة للمستدعي
  return {
    getNextVisibleFamilyKey,
    countVisibleFamilies,
    onHideFamily,
    showFamily,
    toggleFamilyVisibility,
    showAllCore
  };
}

/* =========================
   6) صادرات إضافية
========================= */
export {
  onHideFamily,
  getNextVisibleFamilyKey,
  countVisibleFamilies,
  showFamily,
  toggleFamilyVisibility,
  showAllCore
};
