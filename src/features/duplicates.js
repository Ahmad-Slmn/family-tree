// features/duplicates.js — تحذير التكرارات (نسخة محسّنة ومتوافقة)

// الاعتمادات
import * as Model from '../model/families.js';
import { showWarning } from '../utils.js';

// ===== الحالة العامة + الإعدادات =====

const _dupWarnedCount    = new Map(); // famKey -> last count
const _dupSignature      = new Map(); // famKey -> last signature string
const _lastShownAt       = new Map(); // famKey -> ts (جلسة فقط)
const _ignoredSignatures = new Map(); // famKey -> Set(signatures)

const DUP_LS_KEY_CNT   = 'dup_warned_counts';
const DUP_LS_KEY_SIG   = 'dup_signatures';
const DUP_LS_KEY_IGN   = 'dup_ignored_signatures';

let _settings = {
  minIntervalMs: 15000,        // اختناق التحذير الافتراضي 15 ثانية
  autoCheckEnabled: false,     // فحص دوري ذكي (اختياري)
  autoCheckIntervalMs: 60000   // فترة الفحص الدوري إن فُعِّل
};


let _ctx = null;             // مرجع اختياري لسياق التطبيق
let _autoCheckTimer = null;  // مؤقّت للفحص الدوري

const defaultMessageBuilder = count =>
  `عُثر على ${count} مجموعة يُحتمل تكرارها. افتح لوحة المراجعة للتدقيق والدمج.`;

// ===== تحميل / حفظ الحالة في localStorage =====

(function loadPersisted(){
  try{
    const cnt = JSON.parse(localStorage.getItem(DUP_LS_KEY_CNT) || '{}');
    Object.entries(cnt).forEach(([k,v]) => _dupWarnedCount.set(k, v|0));
  }catch(err){
    _devLog('duplicates: loadPersisted(cnt) failed', err);
  }
  try{
    const sig = JSON.parse(localStorage.getItem(DUP_LS_KEY_SIG) || '{}');
    Object.entries(sig).forEach(([k,v]) => _dupSignature.set(k, String(v||'')));
  }catch(err){
    _devLog('duplicates: loadPersisted(sig) failed', err);
  }
  try{
    const ign = JSON.parse(localStorage.getItem(DUP_LS_KEY_IGN) || '{}');
    Object.entries(ign).forEach(([k,arr])=>{
      const set = new Set(Array.isArray(arr) ? arr.map(String) : []);
      if (set.size) _ignoredSignatures.set(k, set);
    });
  }catch(err){
    _devLog('duplicates: loadPersisted(ign) failed', err);
  }
})();

function _savePersisted(){
  try{
    const cnt = {}; for (const [k,v] of _dupWarnedCount) cnt[k] = v|0;
    localStorage.setItem(DUP_LS_KEY_CNT, JSON.stringify(cnt));
  }catch(err){
    _devLog('duplicates: savePersisted(cnt) failed', err);
  }
  try{
    const sig = {}; for (const [k,v] of _dupSignature) sig[k] = String(v||'');
    localStorage.setItem(DUP_LS_KEY_SIG, JSON.stringify(sig));
  }catch(err){
    _devLog('duplicates: savePersisted(sig) failed', err);
  }
  try{
    const ign = {};
    for (const [k,set] of _ignoredSignatures){
      ign[k] = Array.from(set || []);
    }
    localStorage.setItem(DUP_LS_KEY_IGN, JSON.stringify(ign));
  }catch(err){
    _devLog('duplicates: savePersisted(ign) failed', err);
  }
}

// ===== أدوات داخلية =====

function _devLog(msg, err){
  try{
    if (typeof process !== 'undefined' &&
        process.env &&
        process.env.NODE_ENV === 'development'){
      // eslint-disable-next-line no-console
      console.warn(msg, err);
    }
  }catch{
    // في المتصفّح بدون process: نتجاهل
  }
}

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

function _updateState(famKey, { count, signature, ts = null }){
  _dupWarnedCount.set(famKey, count|0);
  _dupSignature.set(famKey, String(signature || ''));
  if (ts != null) _lastShownAt.set(famKey, ts);
  _savePersisted();
}

function _isSignatureIgnored(famKey, signature){
  const set = _ignoredSignatures.get(famKey);
  return !!(set && set.has(String(signature || '')));
}

function _markSignatureIgnored(famKey, signature){
  if (!famKey || !signature) return;
  let set = _ignoredSignatures.get(famKey);
  if (!set){
    set = new Set();
    _ignoredSignatures.set(famKey, set);
  }
  set.add(String(signature));
  _savePersisted();
}

function _scheduleAutoCheck(){
  if (!_settings.autoCheckEnabled) return;
  if (_autoCheckTimer) clearTimeout(_autoCheckTimer);
  _autoCheckTimer = setTimeout(()=>{
    _autoCheckTimer = null;
    try{
      const fams = Model.getFamilies?.() || {};
      const sel  = (typeof Model.getSelectedKey === 'function')  ? Model.getSelectedKey()
        : Object.keys(fams)[0];
      if (sel) warnDuplicatesIfAny(sel, { reason: 'autoCheck' });
    }catch(err){
      _devLog('duplicates: autoCheck failed', err);
    }
  }, _settings.autoCheckIntervalMs|0 || 60000);
}

// مصدر التكرارات: افتراضيًا Model.findDuplicatesInFamily
// دعم اختياري لمصدر أقوى عبر _ctx.idsApi?.findPotentialMerges(fam)
function _collectDuplicateGroups(fam){
  try{
    if (_ctx && _ctx.idsApi && typeof _ctx.idsApi.findPotentialMerges === 'function'){
      // شكل الإخراج المتوقع: Arrays لأشخاص مشتبه بتكرارهم
      return _ctx.idsApi.findPotentialMerges(fam) || [];
    }
  }catch(err){
    _devLog('duplicates: idsApi.findPotentialMerges failed', err);
  }
  try{
    return Model.findDuplicatesInFamily(fam) || [];
  }catch(err){
    _devLog('duplicates: Model.findDuplicatesInFamily failed', err);
    return [];
  }
}
function _dupScoreLabel(score){
  if (score == null) return '';
  const n = Number(score) || 0;
  if (n >= 3) return 'قوي';
  if (n === 2) return 'متوسط';
  if (n === 1) return 'ضعيف';
  return '';
}

// اشتقاق دور أوضح بناءً على المسار داخل الشجرة أو شبكة الروابط في العائلة
function _deriveRoleForDuplicates(origRole, path, fam, personId){
  const r   = String(origRole || '').trim();
  const p   = String(path || '');
  const pid = personId ? String(personId) : '';

  if (!r) return '';

  // =====================================
  // A) حالات الأب/الأم لصاحب الشجرة (تظهر فقط في نظام التكرار)
  // =====================================
  if (fam && fam.rootPerson && pid){
    const root       = fam.rootPerson;
    const rootId     = String(root._id || '');
    const rootFather = root.fatherId ? String(root.fatherId) : null;
    const rootMother = root.motherId ? String(root.motherId) : null;

    // أب صاحب الشجرة
    if (rootFather && pid === rootFather && (r === 'الأب' || r === 'أب')){
      return 'أب صاحب الشجرة';
    }

    // أم صاحب الشجرة
    if (rootMother && pid === rootMother && (r === 'الأم' || r === 'أم')){
      return 'أم صاحب الشجرة';
    }
  }

  // نهتم فقط بحالات "ابن" / "بنت" لباقي الاشتقاقات
  const isSon  = (r === 'ابن');
  const isDaug = (r === 'بنت');
  if (!isSon && !isDaug) return '';

  // =====================================
  // 1) إخوة / أخوات صاحب الشجرة (بالمسار)
  // =====================================
  // أشخاص تحت father.children[...] (غير rootPerson)
  if (p && p.startsWith('father.children[')) {
    return isSon ? 'أخ صاحب الشجرة' : 'أخت صاحب الشجرة';
  }

  // =====================================
  // 2) أحفاد صاحب الشجرة من خلال rootPerson
  // =====================================
  if (p && p.startsWith('rootPerson.children[')) {
    // كم مرّة تظهر children[...] في المسار؟
    const childrenMatches = p.match(/children\[\d+\]/g) || [];
    const depth = childrenMatches.length; // 1: ابن مباشر، 2: حفيد، 3+: نسل أبعد

    if (depth === 1) {
      // ابن/بنت مباشر لصاحب الشجرة -> نتركه كما هو
      return '';
    }

    if (depth === 2) {
      // حفيد/حفيدة (ابن/بنت ابن أو بنت)
      return isSon ? 'حفيد صاحب الشجرة' : 'حفيدة صاحب الشجرة';
    }

    if (depth >= 3) {
      // نسل أبعد (ابن حفيد... إلخ)
      return isSon ? 'من نسل صاحب الشجرة (ذكر)' : 'من نسل صاحب الشجرة (أنثى)';
    }
  }

  // ==================================================
  // 3) ابن/بنت من زوجة معيّنة لصاحب الشجرة (بالمسار)
  // ==================================================
  // مثال المسار: "rootPerson.wives[0].children[2]" أو "wives[1].children[0]"
  if (fam && Array.isArray(fam.wives) && fam.wives.length > 1 && p) {
    const m = p.match(/(?:^|\.)(?:rootPerson\.)?wives\[(\d+)\]\.children\[\d+\]/);
    if (m) {
      const idx  = parseInt(m[1], 10);
      const wife = fam.wives[idx];
      if (wife) {
        const wifeRole = String(wife.role || '').trim() || `الزوجة ${idx + 1}`;
        return isSon ? `ابن من ${wifeRole}` : `بنت من ${wifeRole}`;
      }
    }
  }

  // ======================================================
  // 4) fallback سابق: ابن/بنت من زوجة معيّنة بالاعتماد على motherId
  // ======================================================
  if (fam && Array.isArray(fam.wives) && fam.wives.length > 1 && pid) {
    for (let i = 0; i < fam.wives.length; i++) {
      const wife = fam.wives[i];
      if (!wife || !Array.isArray(wife.children)) continue;

      const found = wife.children.some(ch => ch && String(ch._id || '') === pid);
      if (found) {
        const wifeRole = String(wife.role || '').trim() || `الزوجة ${i + 1}`;
        return isSon ? `ابن من ${wifeRole}` : `بنت من ${wifeRole}`;
      }
    }
  }

  // =====================================================
  // 5) اشتقاقات إضافية من شبكة الروابط داخل fam.persons
  //    (حتى لو لم يكن للشخص مسار tree واضح)
  // =====================================================
  if (fam && fam.persons && pid && fam.persons[pid]) {
    const self      = fam.persons[pid];
    const fatherId  = self.fatherId ? String(self.fatherId) : null;
    const motherId  = self.motherId ? String(self.motherId) : null;
    const root      = fam.rootPerson || null;

    // 5.1 أخ/أخت صاحب الشجرة بالاعتماد على الأب/الأم (بدون مسار father.children[..])
    if (root) {
      const rootId        = String(root._id || '');
      const rootFatherId  = root.fatherId ? String(root.fatherId) : null;
      const rootMotherId  = root.motherId ? String(root.motherId) : null;

      const isSiblingOfRoot =
        pid !== rootId &&
        (
          (fatherId && rootFatherId && fatherId === rootFatherId) ||
          (motherId && rootMotherId && motherId === rootMotherId)
        );

      if (isSiblingOfRoot) {
        return isSon ? 'أخ صاحب الشجرة' : 'أخت صاحب الشجرة';
      }
    }

    // 5.2 أقارب الزوجات: أخ/أخت الزوجة، وابن/بنت الزوجة
    if (Array.isArray(fam.wives) && fam.wives.length) {
      for (let i = 0; i < fam.wives.length; i++) {
        const w = fam.wives[i];
        if (!w) continue;

        const wifeId        = String(w._id || '');
        const wifeFatherId  = w.fatherId ? String(w.fatherId) : null;
        const wifeMotherId  = w.motherId ? String(w.motherId) : null;
        const wifeRoleLabel = String(w.role || '').trim() || `الزوجة ${i + 1}`;

        // أخ/أخت الزوجة: يشتركون مع الزوجة في الأب أو الأم
        const isSiblingOfWife =
          pid !== wifeId &&
          (
            (fatherId && wifeFatherId && fatherId === wifeFatherId) ||
            (motherId && wifeMotherId && motherId === wifeMotherId)
          );

        if (isSiblingOfWife) {
          return isSon ? `أخ ${wifeRoleLabel}` : `أخت ${wifeRoleLabel}`;
        }

        // ابن/بنت الزوجة (من زواج سابق مثلًا)
        const isChildOfWife =
          (fatherId && fatherId === wifeId) ||
          (motherId && motherId === wifeId);

        if (isChildOfWife) {
          return isSon ? `ابن ${wifeRoleLabel}` : `بنت ${wifeRoleLabel}`;
        }
      }
    }
  }

  // أي حالة أخرى نترك الدور كما هو (ابن/بنت)
  return '';
}


function _estimateTotalPersons(fam){
  if (!fam) return 0;

  // إن كان لدينا index جاهزًا
  if (fam.persons && typeof fam.persons === 'object') {
    try {
      return Object.keys(fam.persons).length;
    } catch {
      // نتجاهل الخطأ ونكمل
    }
  }

  // احتياط: مسح سريع عبر الشجرة
  const ids = new Set();

  const scan = (p) => {
    if (!p) return;
    if (p._id) ids.add(String(p._id));
    (p.children || []).forEach(scan);
    (p.wives || []).forEach(scan);
  };

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach(scan);
  if (fam.father) scan(fam.father);
  if (fam.rootPerson) scan(fam.rootPerson);
  (fam.wives || []).forEach(scan);

  return ids.size;
}

function _deriveSeverity(maxGroupSize, maxDupScore){
  const size  = Number(maxGroupSize) || 0;
  const score = Number(maxDupScore) || 0;

  if (size <= 1 || score <= 0) return 'none';

  // تطابق قوي (اسم + صفة + ميلاد) مع أكثر من شخص
  if (score >= 3 && size >= 2) return 'high';

  // تطابق متوسط (اسم + صفة) مع أكثر من شخص
  if (score === 2 && size >= 2) return 'medium';

  // تطابق ضعيف (اسم فقط)
  if (score === 1) {
    if (size >= 3) return 'medium';
    if (size === 2) return 'low';
    return 'low';
  }

  // حالة احتياطية
  return 'low';
}

function _getDupConfigForFam(fam){
  const defaults = {
    fingerprintFields: ['name','role','birth','father','mother','tribe','clan','place'],
    minScoreToWarn: 2,
    excludeWeakFromStats: false
  };

  try{
    if (fam && typeof Model.getDuplicatesConfig === 'function'){
      return Model.getDuplicatesConfig(fam) || { ...defaults };
    }
  }catch(err){
    _devLog('duplicates: getDuplicatesConfig failed', err);
  }

  return { ...defaults };
}

function _buildGroupReason(dupType, dupScore, size){
  const dupScoreLabel = _dupScoreLabel(dupScore);
  const parts = [];

  if (dupType) parts.push(dupType);
  if (dupScoreLabel) parts.push(`تطابق ${dupScoreLabel}`);
  if (size > 1) parts.push(`في ${size} سجلات`);

  const text = parts.join(' — ') || '';

  return {
    dupType: dupType || '',
    dupScoreLabel: dupScoreLabel || '',
    text
  };
}

function _buildMergeHint(members, fam, groupDupScore){
  const score = Number(groupDupScore) || 0;
  if (score < 2 || !Array.isArray(members) || !members.length) return null;

  const ids = members.map(m => m && m._id).filter(Boolean);
  if (!ids.length) return null;

  let primaryId = ids[0];

  if (fam && fam.persons && typeof fam.persons === 'object'){
    let bestScore = -1;
    ids.forEach(id => {
      const p = fam.persons[id];
      if (!p) return;
      const children = Array.isArray(p.childrenIds) ? p.childrenIds.length : 0;
      const spouses  = Array.isArray(p.spousesIds) ? p.spousesIds.length : 0;
      const links    = children + spouses;
      if (links > bestScore){
        bestScore = links;
        primaryId = id;
      }
    });
  }

  const duplicateIds = ids.filter(id => id !== primaryId);
  if (!duplicateIds.length) return null;

  return {
    primaryId,
    duplicateIds
  };
}


// ===== واجهة الإعدادات =====

/**
 * تهيئة إعدادات وحدة التكرارات (اختناق زمني، فحص دوري، ...).
 * @param {Object} settings
 * @param {number} [settings.minIntervalMs]
 * @param {boolean} [settings.autoCheckEnabled]
 * @param {number} [settings.autoCheckIntervalMs]
 * @param {Function} [settings.messageBuilder] (count, famKey) => string
 */
export function configureDuplicates(settings = {}){
  if (!settings || typeof settings !== 'object') return;
  _settings = { ..._settings, ...settings };
  if (typeof settings.messageBuilder === 'function'){
    // يمكن استخدامه داخل warnDuplicatesIfAny بجانب ctx.dupMessageBuilder
    _settings.messageBuilder = settings.messageBuilder;
  }
}

// ===== واجهة عامّة =====

/**
 * يعيد ملخصًا هيكليًا للتكرارات في عائلة محددة.
 * يحسب العدد والتوقيع والمجموعات، بالإضافة إلى أقصى حجم مجموعة ومستوى الخطورة.
 */
export function getDuplicateSummary(famKey){
  const fams = Model.getFamilies?.();
  const fam  = fams && fams[famKey];

  if (!fam) {
    return {
      count: 0,
      signature: '',
      groups: [],
      maxGroupSize: 0,
      severity: 'none',
      totalPersons: 0,
      totalDuplicatePersons: 0,
      duplicateRatio: 0,
      strongGroupsCount: 0,
      mediumGroupsCount: 0,
      weakGroupsCount: 0,
      maxDupScore: 0,
      isReviewed: false,
      lastCheckedAt: Date.now(),
      minScoreToWarn: 0
    };
  }

  // تهيئة إعدادات التكرار من العائلة
  const dupCfg = _getDupConfigForFam(fam);
  const includeWeakInStats = !dupCfg.excludeWeakFromStats;
  const minScoreToWarn     = Number(dupCfg.minScoreToWarn) || 0;

  // === NEW: تأكد من تهيئة الـ pipeline لهذه العائلة قبل حساب التكرارات ===
  if (!fam.__pipelineReady && typeof Model.normalizeFamilyPipeline === 'function') {
    const fromVer =
      Number.isFinite(fam.__v) ? fam.__v :
      Number.isFinite(fam.schemaVersion) ? fam.schemaVersion :
      0;

    Model.normalizeFamilyPipeline(fam, {
      fromVer,
      markCore: fam.__core === true
    });

    fam.__pipelineReady = true;
  }
  // === END NEW ===

  const groupsRaw = _collectDuplicateGroups(fam);
  const sig       = _signatureForGroups(groupsRaw);

  // كاش على مستوى العائلة لتفادي إعادة الحساب عند ثبات التوقيع
  fam.__dupCache = fam.__dupCache || {};
  const cached = fam.__dupCache;
  if (cached.signature === sig && cached.summary){
    return { ...cached.summary, signature: sig };
  }

  const totalPersons = _estimateTotalPersons(fam);

  let maxGroupSize           = 0;
  let totalDuplicatePersons  = 0;
  let strongGroupsCount      = 0;
  let mediumGroupsCount      = 0;
  let weakGroupsCount        = 0;
  let maxDupScore            = 0;
  const groupScores          = [];

  const shaped = groupsRaw.map(arr => {
    const size = arr.length;
    if (size > maxGroupSize) maxGroupSize = size;
    totalDuplicatePersons += size;

    let groupDupScore = 0;
    for (let i = 0; i < arr.length; i++) {
      const orig = arr[i];
      const s = orig?._dupScore ?? orig?.dupScore ?? 0;
      if (s > groupDupScore) groupDupScore = s;
    }
    groupScores.push(groupDupScore);
    if (groupDupScore > maxDupScore) maxDupScore = groupDupScore;

    if (groupDupScore >= 3) strongGroupsCount++;
    else if (groupDupScore === 2) mediumGroupsCount++;
    else if (groupDupScore === 1) weakGroupsCount++;

    const first       = arr[0] || {};
    const groupDupType = String(first._dupType || first.dupType || '');

    const members = arr.map(orig => {
      const _id     = orig?._id ? String(orig._id) : '';
      const name    = String(orig?.name || '');
      const roleRaw = String(orig?.role || '');

      const computedPath =
        _id && typeof Model.findPathByIdInFamily === 'function' ? (Model.findPathByIdInFamily(fam, _id) || '')
          : '';

      const derivedRole = _deriveRoleForDuplicates(roleRaw, computedPath, fam, _id);
      const role        = derivedRole || roleRaw;

      const dupType  = String(orig?._dupType || orig?.dupType || '');
      const dupScore = orig?._dupScore ?? orig?.dupScore ?? null;
      const dupScoreLabel = _dupScoreLabel(dupScore);

      let reasonLabel = '';
      if (dupType && dupScoreLabel) {
        reasonLabel = `${dupType} (تطابق ${dupScoreLabel})`;
      } else if (dupType) {
        reasonLabel = dupType;
      }

      return { _id, name, role, dupType, dupScore, dupScoreLabel, reasonLabel };
    });

    const groupReason = _buildGroupReason(groupDupType, groupDupScore, size);
    const groupSeverity = _deriveSeverity(size, groupDupScore);
    const mergeHint = _buildMergeHint(members, fam, groupDupScore);

    return {
      members,
      dupType: groupDupType,
      dupScore: groupDupScore,
      dupScoreLabel: _dupScoreLabel(groupDupScore),
      groupReason,
      severity: groupSeverity,
      mergeHint
    };
  });

  // فلترة اختيارية للمجموعات الضعيفة في الإحصاءات العامة فقط
  let effectiveCount              = groupsRaw.length | 0;
  let effectiveMaxGroupSize       = maxGroupSize;
  let effectiveTotalDupPersons    = totalDuplicatePersons;

  if (!includeWeakInStats) {
    effectiveCount            = 0;
    effectiveMaxGroupSize     = 0;
    effectiveTotalDupPersons  = 0;

    for (let i = 0; i < groupsRaw.length; i++) {
      const score = groupScores[i] || 0;
      if (score <= 1) continue;

      const size = groupsRaw[i]?.length || 0;
      effectiveCount++;
      effectiveTotalDupPersons += size;
      if (size > effectiveMaxGroupSize) effectiveMaxGroupSize = size;
    }
  }

  const duplicateRatio =
    totalPersons > 0 ? (effectiveTotalDupPersons / totalPersons) : 0;

  const severity      = _deriveSeverity(effectiveMaxGroupSize, maxDupScore);
  const isReviewed    = _isSignatureIgnored(famKey, sig);
  const lastCheckedAt = Date.now();

  const summary = {
    count: effectiveCount,
    groups: shaped,
    maxGroupSize: effectiveMaxGroupSize,
    severity,
    totalPersons,
    totalDuplicatePersons: effectiveTotalDupPersons,
    duplicateRatio,
    strongGroupsCount,
    mediumGroupsCount,
    weakGroupsCount,
    maxDupScore,
    isReviewed,
    lastCheckedAt,
    minScoreToWarn
  };

  fam.__dupCache.signature = sig;
  fam.__dupCache.summary   = summary;

  return {
    ...summary,
    signature: sig
  };
}

/**
 * إرجاع حالة التكرارات لجميع العائلات (للاستخدام في لوحات الإحصاءات).
 */
export function getDuplicatesStatusForAllFamilies(){
  const fams = Model.getFamilies?.() || {};
  return Object.keys(fams).map(key => {
    const s = getDuplicateSummary(key);
    return {
      famKey: key,
      count: s.count,
      maxGroupSize: s.maxGroupSize,
      severity: s.severity,
      totalPersons: s.totalPersons,
      totalDuplicatePersons: s.totalDuplicatePersons,
      duplicateRatio: s.duplicateRatio,
      strongGroupsCount: s.strongGroupsCount,
      mediumGroupsCount: s.mediumGroupsCount,
      weakGroupsCount: s.weakGroupsCount,
      maxDupScore: s.maxDupScore,
      isReviewed: s.isReviewed,
      lastCheckedAt: s.lastCheckedAt
    };
  });
}

/**
 * إعادة ضبط حالة التحذير لعائلة معيّنة أو لجميع العائلات.
 */
export function resetDupWarning(famKey = null){
  if (famKey){
    _dupWarnedCount.delete(famKey);
    _dupSignature.delete(famKey);
    _lastShownAt.delete(famKey);
    _ignoredSignatures.delete(famKey);
  }else{
    _dupWarnedCount.clear();
    _dupSignature.clear();
    _lastShownAt.clear();
    _ignoredSignatures.clear();
  }
  _savePersisted();
}

/**
 * وسم توقيع معيّن بأنه "مُراجَع" / مُتجاهَل حتى لا يعاد التحذير عنه.
 * يمكن استدعاؤها من لوحة مراجعة التكرارات بعد إتمام المراجعة.
 */
export function markDuplicatesReviewed(famKey, signature){
  _markSignatureIgnored(famKey, signature);
}

/**
 * مسح الوسوم "المُراجَعة" لعائلة معيّنة أو لجميع العائلات.
 */
export function clearReviewedDuplicates(famKey = null){
  if (famKey){
    _ignoredSignatures.delete(famKey);
  }else{
    _ignoredSignatures.clear();
  }
  _savePersisted();
}

/**
 * تحذير إن وُجدت تكرارات في عائلة معيّنة، مع اختناق زمني،
 * وبناء رسالة قابلة للتخصيص، وإمكانية تمرير ملخّص جاهز لتفادي حساب إضافي.
 *
 * opts.summary:  ملخّص جاهز من getDuplicateSummary (اختياري).
 * opts.minIntervalMs:  اختناق خاص لهذا الاستدعاء (اختياري).
 */
export function warnDuplicatesIfAny(famKey, opts = {}){
  const fams = Model.getFamilies?.();
  const fam  = fams && fams[famKey];
  if (!fam) return;

  const summary   = opts.summary || getDuplicateSummary(famKey);
  const { count, signature, maxDupScore, minScoreToWarn } = summary;

  const prevCount = _dupWarnedCount.get(famKey);
  const prevSig   = _dupSignature.get(famKey);
  const now       = Date.now();
  const lastTs    = _lastShownAt.get(famKey) || 0;

  const changed   = (count !== (prevCount|0)) || (signature !== (prevSig||''));
  const interval  = (opts.minIntervalMs != null ? opts.minIntervalMs : _settings.minIntervalMs)|0 || 0;
  const throttled = interval > 0 && ((now - lastTs) < interval);

  // إن كانت الحالة الحالية مُمَيَّزة كمُراجَعة/مُتجاهَلة: نحدّث الحالة بهدوء بدون تحذير
  if (count > 0 && _isSignatureIgnored(famKey, signature)){
    _updateState(famKey, { count, signature, ts: now });
    return;
  }

  // احترام إعدادات العائلة: عدم التحذير إن كان أقصى dupScore أقل من minScoreToWarn
  const localMinScoreToWarn =
    (typeof minScoreToWarn === 'number' && !Number.isNaN(minScoreToWarn))  ? minScoreToWarn
      : 0;

  if (count > 0 && localMinScoreToWarn > 0 && (maxDupScore || 0) < localMinScoreToWarn){
    _updateState(famKey, { count, signature, ts: now });
    return;
  }

  if (count > 0 && changed && !throttled){
    const builderFromCtx = _ctx?.dupMessageBuilder;
    const builderFromCfg = _settings.messageBuilder;
    const msg =
      (typeof builderFromCfg === 'function' && builderFromCfg(count, famKey)) ||
      (typeof builderFromCtx === 'function' && builderFromCtx(count, famKey)) ||
      defaultMessageBuilder(count);

    showWarning(msg);

    try{
      if (_ctx?.openPanelOnWarn && _ctx?.bus?.emit){
        _ctx.bus.emit('duplicates:openPanel', { famKey, count, signature });
      }
    }catch(err){
      _devLog('duplicates: openPanelOnWarn failed', err);
    }

    _updateState(famKey, { count, signature, ts: now });
  } else if (count === 0 && (prevCount|0) !== 0){
    _updateState(famKey, { count: 0, signature: '' });
  }
}


/**
 * تهيئة اختيارية: نحتفظ بـ ctx ونُسجّل مستمعين للأحداث
 * (بعد الاستيراد، وربما فحص دوري ذكي عند تغيّر العائلات أو إعادة رسم الشجرة).
 */
export function init(ctx){
  _ctx = ctx || null;

  if (_ctx && !_ctx.dupMessageBuilder){
    _ctx.dupMessageBuilder = defaultMessageBuilder;
  }

  try{
    // بعد الاستيراد أو مزامنة جماعية: نفحص مرة واحدة بعد هدوء قصير
    _ctx?.bus?.on?.('io:import:done', ()=>{
      setTimeout(()=>{
        const fams = Model.getFamilies?.() || {};
        const sel  = (typeof Model.getSelectedKey === 'function')  ? Model.getSelectedKey()
          : Object.keys(fams)[0];
        if (sel) warnDuplicatesIfAny(sel, { reason: 'importDone' });
      }, 250);
    });

    // "فحص دوري ذكي" (اختياري) بناءً على تغيّرات البيانات أو إعادة الرسم
    _ctx?.bus?.on?.('families:changed', _scheduleAutoCheck);
    _ctx?.bus?.on?.('tree:rendered',     _scheduleAutoCheck);
  }catch(err){
    _devLog('duplicates: init bus wiring failed', err);
  }

  return {
    warnDuplicatesIfAny,
    getDuplicateSummary,
    resetDupWarning,
    getDuplicatesStatusForAllFamilies,
    markDuplicatesReviewed,
    clearReviewedDuplicates,
    configureDuplicates
  };
}