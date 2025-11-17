// features/duplicates.js — تحذير التكرارات (نسخة محسّنة ومتوافقة)

// الاعتمادات
import * as Model from '../model/families.js';
import { showWarning } from '../utils.js';

// ===== تخزين حالات التحذير =====
const _dupWarnedCount = new Map();                // famKey -> last count
const _dupSignature   = new Map();                // famKey -> last signature string
const _lastShownAt    = new Map();                // famKey -> ts (جلسة فقط)

const DUP_LS_KEY_CNT  = 'dup_warned_counts';
const DUP_LS_KEY_SIG  = 'dup_signatures';
const MIN_INTERVAL_MS = 15000;                    // اختناق التحذير 15 ثانية

let _ctx = null;                                  // مرجع اختياري لسياق التطبيق

// تحميل الحالة المخزنة
(function loadPersisted(){
  try{
    const cnt = JSON.parse(localStorage.getItem(DUP_LS_KEY_CNT) || '{}');
    Object.entries(cnt).forEach(([k,v]) => _dupWarnedCount.set(k, v|0));
  }catch{}
  try{
    const sig = JSON.parse(localStorage.getItem(DUP_LS_KEY_SIG) || '{}');
    Object.entries(sig).forEach(([k,v]) => _dupSignature.set(k, String(v||'')));
  }catch{}
})();

// حفظ الحالة
function _savePersisted(){
  try{
    const cnt = {}; for (const [k,v] of _dupWarnedCount) cnt[k] = v|0;
    localStorage.setItem(DUP_LS_KEY_CNT, JSON.stringify(cnt));
  }catch{}
  try{
    const sig = {}; for (const [k,v] of _dupSignature) sig[k] = String(v||'');
    localStorage.setItem(DUP_LS_KEY_SIG, JSON.stringify(sig));
  }catch{}
}

// ===== أدوات داخلية =====

// FNV-1a بسيط لتوقيع نصّي ثابت
function _hash(str){
  let h = 2166136261 >>> 0;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

// تكوين توقيع مستقر لمجموعات التكرار الحالية
function _signatureForGroups(groups){
  // كل مجموعة: رُتِّبَت حسب (_id || name|role) ثم انضمّت
  const parts = groups.map(grp=>{
    const norm = grp.map(p=>{
      const id   = p && p._id ? String(p._id) : '';
      const name = p && p.name ? String(p.name) : '';
      const role = p && p.role ? String(p.role) : '';
      return id ? `#${id}` : `${name}|${role}`;
    }).sort(); // ترتيب داخل المجموعة
    return norm.join(',');
  }).sort();   // ترتيب بين المجموعات
  return _hash(parts.join('||'));
}

// مصدر التكرارات: افتراضيًا Model.findDuplicatesInFamily
// دعم اختياري لمصدر أقوى عبر _ctx.idsApi?.findPotentialMerges(fam)
function _collectDuplicateGroups(fam){
  try{
    if (_ctx && _ctx.idsApi && typeof _ctx.idsApi.findPotentialMerges === 'function'){
      // شكل الإخراج المتوقع: Arrays لأشخاص مشتبه بتكرارهم
      return _ctx.idsApi.findPotentialMerges(fam) || [];
    }
  }catch{}
  try{
    return Model.findDuplicatesInFamily(fam) || [];
  }catch{
    return [];
  }
}

// ===== واجهة عامّة =====

// يعيد ملخصًا هيكليًا للتكرارات في عائلة محددة
export function getDuplicateSummary(famKey){
  const fam = Model.getFamilies()[famKey];
  if (!fam) return { count: 0, signature: '', groups: [] };

  const groups = _collectDuplicateGroups(fam);
  const sig    = _signatureForGroups(groups);

  // هيكلة مناسبة للعرض: id، name، role، path
  const shaped = groups.map(arr => arr.map(p => ({
    _id:   p?._id || '',
    name:  String(p?.name || ''),
    role:  String(p?.role || ''),
    path:  p?._id ? (Model.findPathByIdInFamily?.(fam, p._id) || '') : ''
  })));

  return { count: groups.length|0, signature: sig, groups: shaped };
}

// إعادة ضبط حالة التحذير لعائلة أو الكل
export function resetDupWarning(famKey = null){
  if (famKey){
    _dupWarnedCount.delete(famKey);
    _dupSignature.delete(famKey);
    _lastShownAt.delete(famKey);
  }else{
    _dupWarnedCount.clear();
    _dupSignature.clear();
    _lastShownAt.clear();
  }
  _savePersisted();
}

// تحذير إذا تغيّر التوقيع أو العدد، مع اختناق زمني
export function warnDuplicatesIfAny(famKey, opts = {}){
  const fam = Model.getFamilies()[famKey];
  if (!fam) return;

  const { count, signature } = getDuplicateSummary(famKey);

  const prevCount = _dupWarnedCount.get(famKey);
  const prevSig   = _dupSignature.get(famKey);
  const now       = Date.now();
  const lastTs    = _lastShownAt.get(famKey) || 0;

  // لا تحذير إن لم تتغيّر الحالة فعليًا
  const changed = (count !== (prevCount|0)) || (signature !== (prevSig||''));

  // اختناق زمني
  const throttled = (now - lastTs) < (opts.minIntervalMs || MIN_INTERVAL_MS);

  if (count > 0 && changed && !throttled){
    showWarning(`عُثر على ${count} مجموعة يُحتمل تكرارها. افتح لوحة المراجعة للتدقيق والدمج.`);
    _dupWarnedCount.set(famKey, count);
    _dupSignature.set(famKey, signature);
    _lastShownAt.set(famKey, now);
    _savePersisted();
  } else if (count === 0 && (prevCount|0) !== 0){
    _dupWarnedCount.set(famKey, 0);
    _dupSignature.set(famKey, '');
    _savePersisted();
  }
}

// تهيئة اختيارية: نحتفظ بـ ctx ونُسجّل مستمعًا بعد الاستيراد لإطلاق فحص واحد
export function init(ctx){
  _ctx = ctx || null;

  // بعد الاستيراد أو مزامنة جماعية: نفحص مرة واحدة بعد هدوء قصير
  try{
    _ctx?.bus?.on?.('io:import:done', ()=>{
      setTimeout(()=>{
        const fams = Model.getFamilies?.() || {};
        const sel  = (typeof Model.getSelectedKey === 'function') ? Model.getSelectedKey() : Object.keys(fams)[0];
        if (sel) warnDuplicatesIfAny(sel);
      }, 250);
    });
  }catch{}

  return { warnDuplicatesIfAny, getDuplicateSummary, resetDupWarning };
}
