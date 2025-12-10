// features/duplicates.js — تحذير التكرارات (نسخة محسّنة ومتوافقة)

// الاعتمادات
import * as Model from '../model/families.js';
import { showWarning, getArabicOrdinalF } from '../utils.js';

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
  autoCheckIntervalMs: 60000,  // فترة الفحص الدوري إن فُعِّل
  // هل تُحتسَب المجموعات الضعيفة (اسم فقط / dupScore=1) داخل الإحصاءات العامة؟
  includeWeakNameOnlyInStats: true
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

// إضافة رقم الزوجة داخل النص: "خال الزوجة" -> "خال الزوجة الأولى" مثلاً
function _appendWifeIndexLabel(base, wifeIndex){
  const ord = getArabicOrdinalF((wifeIndex || 0) + 1); // الأولى، الثانية...
  if (base.includes('الزوجة')) {
    return base.replace('الزوجة', `الزوجة ${ord}`);
  }
  return `${base} (${ord})`;
}

// إيجاد الزوجات المرتبطات بشخص معيّن (أب/أم/جد/خال/عم... للزوجة)
function _findWivesForRelative(person, fam){
  const res = [];
  if (!person || !fam) return res;

  const pid = person._id ? String(person._id) : null;
  if (!pid) return res;

  const wives   = Array.isArray(fam.wives) ? fam.wives : [];
  const persons = fam.persons && typeof fam.persons === 'object' ? fam.persons : {};

  // خريطة: childId -> parents[]
  const parentsOf = new Map();
  try{
    Object.values(persons).forEach(p2 => {
      if (!p2 || !p2._id) return;
      const cidList = Array.isArray(p2.childrenIds) ? p2.childrenIds : [];
      cidList.forEach(cid => {
        const key = String(cid);
        if (!parentsOf.has(key)) parentsOf.set(key, []);
        parentsOf.get(key).push(p2);
      });
    });
  }catch{
    // نتجاهل أي خطأ هنا
  }

  for (let i = 0; i < wives.length; i++){
    const w = wives[i];
    if (!w || !w._id) continue;

    const wid = String(w._id);

    // 1) أب/أم الزوجة مباشرة
    if ((w.fatherId && String(w.fatherId) === pid) ||
        (w.motherId && String(w.motherId) === pid)) {
      res.push({ wife: w, index: i });
      continue;
    }

    // 2) بحث عام في محيط الأب/الأم/الأجداد/الأعمام/الأخوال…
    const queue   = [];
    const visited = new Set();

    // نقاط البداية: أب وأم الزوجة (إن وُجدا في persons)
    const seedIds = [];
    if (w.fatherId && persons[w.fatherId]) seedIds.push(String(w.fatherId));
    if (w.motherId && persons[w.motherId]) seedIds.push(String(w.motherId));

    seedIds.forEach(id => {
      visited.add(id);
      queue.push(persons[id]);
    });

    let found = false;
    let depth = 0;

    // نسمح بعمق أكبر قليلًا ليغطي:
    // أب/أم → جد/جدة → أخ/أخت (عم/خال) وهكذا
    const MAX_DEPTH = 4;

    while (queue.length && depth < MAX_DEPTH && !found){
      const levelSize = queue.length;

      for (let k = 0; k < levelSize; k++){
        const cur = queue.shift();
        if (!cur || !cur._id) continue;

        const cid = String(cur._id);

        // لو وصلنا للشخص الهدف: نربطه بهذه الزوجة
        if (cid === pid){
          res.push({ wife: w, index: i });
          found = true;
          break;
        }

        // نجمّع الجيران المحتملين (آباء + أبناء + آباء الأبناء)
        const neighborIds = new Set();

        // (أ) الآباء المباشرون
        if (cur.fatherId && persons[cur.fatherId]){
          neighborIds.add(String(cur.fatherId));
        }
        if (cur.motherId && persons[cur.motherId]){
          neighborIds.add(String(cur.motherId));
        }

        // (ب) الأبناء المباشرون
        const childrenIds = Array.isArray(cur.childrenIds) ? cur.childrenIds : [];
        childrenIds.forEach(chid => {
          if (chid && persons[chid]) neighborIds.add(String(chid));
        });

        // (ج) الآباء الذين يعدّون هذا الشخص واحدًا من childrenIds (مسار عكسي)
        const parents = parentsOf.get(cid);
        if (parents && parents.length){
          parents.forEach(par => {
            if (par && par._id) neighborIds.add(String(par._id));
          });
        }

        // دفع الجيران الجدد في الطابور
        neighborIds.forEach(nid => {
          if (visited.has(nid)) return;
          visited.add(nid);
          const np = persons[nid];
          if (np) queue.push(np);
        });
      }

      depth++;
    }
  }

  return res;
}


// اشتقاق دور أوضح بناءً على المسار داخل الشجرة + سياق العائلة
function _deriveRoleForDuplicates(origRole, path, fam, person){
  const baseRole = String(origRole || '').trim();
  const p = String(path || '');

  if (!baseRole && !p) return '';

  const isSon  = (baseRole === 'ابن');
  const isDaug = (baseRole === 'بنت');

  // 1) أدوار "ابن / بنت" داخل الشجرة (أخوة، أبناء، أحفاد...)
  if (isSon || isDaug){
    // إخوة / أخوات صاحب الشجرة: أبناء الأب غير صاحب الشجرة
    if (p.startsWith('father.children[')) {
      return isSon ? 'أخ صاحب الشجرة' : 'أخت صاحب الشجرة';
    }

    // أبناء وأحفاد صاحب الشجرة
    if (p.startsWith('rootPerson.children[')) {
      const childrenMatches = p.match(/children\[\d+\]/g) || [];
      const depth = childrenMatches.length; // 1: ابن مباشر، 2: حفيد، 3+: نسل أبعد

      if (depth === 1) {
        // ابن/بنت مباشر لصاحب الشجرة
        return isSon ? 'ابن صاحب الشجرة' : 'بنت صاحب الشجرة';
      }

      if (depth === 2) {
        // حفيد/حفيدة (ابن/بنت ابن أو بنت)
        return isSon ? 'حفيد صاحب الشجرة' : 'حفيدة صاحب الشجرة';
      }

      if (depth >= 3) {
        // نسل أبعد
        return isSon ? 'من نسل صاحب الشجرة (ذكر)' : 'من نسل صاحب الشجرة (أنثى)';
      }
    }
  }

  // 2) أدوار "الأب / الأم" و الأقارب المرتبطين بالزوجات أو بصاحب الشجرة
  if (!fam || !person || !person._id) return '';

  const rid  = String(person._id);
  const root = fam.rootPerson || null;

  // "الأب" قد يكون: أب صاحب الشجرة، أو أب إحدى الزوجات
  if (baseRole === 'الأب'){
    if (root && root.fatherId && String(root.fatherId) === rid){
      return 'أب صاحب الشجرة';
    }
    const wivesCtx = _findWivesForRelative(person, fam);
    if (wivesCtx.length){
      const w = wivesCtx[0];
      return _appendWifeIndexLabel('أب الزوجة', w.index);
    }
  }

  // "الأم" قد تكون: أم صاحب الشجرة، أو أم إحدى الزوجات
  if (baseRole === 'الأم'){
    if (root && root.motherId && String(root.motherId) === rid){
      return 'أم صاحب الشجرة';
    }
    const wivesCtx = _findWivesForRelative(person, fam);
    if (wivesCtx.length){
      const w = wivesCtx[0];
      return _appendWifeIndexLabel('أم الزوجة', w.index);
    }
  }

  // أي دور يحتوي على "الزوجة" (أب/أم/جد/جدة/خال/خالة/عم/عمة الزوجة...)
  if (baseRole.includes('الزوجة')){
    // أولوية 1: لو كان الشخص موسومًا مباشرة بزوجة معيّنة (_wifeId)
    if (person && person._wifeId && fam && Array.isArray(fam.wives)){
      const wid = String(person._wifeId);
      const idx = fam.wives.findIndex(w => w && String(w._id) === wid);
      if (idx >= 0){
        return _appendWifeIndexLabel(baseRole, idx);
      }
    }

    // أولوية 2: الاستنتاج عن طريق الرسم البياني للعلاقات كما في السابق
    const wivesCtx = _findWivesForRelative(person, fam);
    if (wivesCtx.length){
      const w = wivesCtx[0];
      return _appendWifeIndexLabel(baseRole, w.index); // "خال الزوجة" -> "خال الزوجة الأولى/الثانية..."
    }
  }


  // إن لم نستطع تحسين الدور نرجعه كما هو (يُستخدم fallback في مكان الاستدعاء)
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
      lastCheckedAt: Date.now()
    };
  }

  const groupsRaw = _collectDuplicateGroups(fam);
  const sig       = _signatureForGroups(groupsRaw);

  const totalPersons = _estimateTotalPersons(fam);

  let maxGroupSize           = 0;
  let totalDuplicatePersons  = 0;
  let strongGroupsCount      = 0;
  let mediumGroupsCount      = 0;
  let weakGroupsCount        = 0;
  let maxDupScore            = 0;
  const groupScores          = [];

  // هيكلة مناسبة للعرض: id، name، role، path (+ نوع التكرار، درجة التطابق، سبب الاشتباه)
  const shaped = groupsRaw.map(arr => {
    const size = arr.length;
    if (size > maxGroupSize) maxGroupSize = size;
    totalDuplicatePersons += size;

    // درجة التطابق لهذه المجموعة (أعلى درجة عبر عناصرها)
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

    return arr.map(orig => {
      const _id  = orig?._id ? String(orig._id) : '';
      const name = String(orig?.name || '');
      const roleRaw = String(orig?.role || '');

      const computedPath =
        _id && typeof Model.findPathByIdInFamily === 'function' ? (Model.findPathByIdInFamily(fam, _id) || '')
          : '';

      // المسار الخام (قد يكون فارغًا للأشخاص المشتقّين خارج الشجرة)
      const rawPath =
        computedPath ||
        orig?.path  ||   // إن كان مولِّد التكرارات يضع path هنا
        orig?._path ||   // أو حقل داخلي _path
        '';

      // نحاول اشتقاق وصف أدق للدور بناءً على المسار + سياق العائلة
      const derivedRole = _deriveRoleForDuplicates(roleRaw, rawPath, fam, orig);
      const role        = derivedRole || roleRaw;

      // مسار العرض في الجدول: نص "خارج الشجرة" إن لم يوجد مسار حقيقي
      const path        = rawPath || 'خارج الشجرة';

      // نوع التكرار: ندعم كلاً من dupType و _dupType
      const dupType  = String(orig?._dupType || orig?.dupType || '');

      // درجة التطابق: ندعم dupScore و _dupScore
      const dupScore = orig?._dupScore ?? orig?.dupScore ?? null;
      const dupScoreLabel = _dupScoreLabel(dupScore);

      // سبب الاشتباه بصياغة جاهزة للواجهة
      let reasonLabel = '';
      if (dupType && dupScoreLabel) {
        reasonLabel = `${dupType} (تطابق ${dupScoreLabel})`;
      } else if (dupType) {
        reasonLabel = dupType;
      }

      return { _id, name, role, path, dupType, dupScore, dupScoreLabel, reasonLabel };
    });

  });

  // فلترة اختيارية للمجموعات الضعيفة في الإحصاءات العامة فقط
  let effectiveCount              = groupsRaw.length | 0;
  let effectiveMaxGroupSize       = maxGroupSize;
  let effectiveTotalDupPersons    = totalDuplicatePersons;

  if (!_settings.includeWeakNameOnlyInStats) {
    effectiveCount            = 0;
    effectiveMaxGroupSize     = 0;
    effectiveTotalDupPersons  = 0;

    for (let i = 0; i < groupsRaw.length; i++) {
      const score = groupScores[i] || 0;
      if (score <= 1) continue; // نتجاوز المجموعات التي هي "اسم فقط"

      const size = groupsRaw[i]?.length || 0;
      effectiveCount++;
      effectiveTotalDupPersons += size;
      if (size > effectiveMaxGroupSize) effectiveMaxGroupSize = size;
    }
  }

  const duplicateRatio =
    totalPersons > 0 ? (effectiveTotalDupPersons / totalPersons) : 0;

  const severity = _deriveSeverity(effectiveMaxGroupSize, maxDupScore);
  const isReviewed = _isSignatureIgnored(famKey, sig);
  const lastCheckedAt = Date.now();

  return {
    count: effectiveCount,
    signature: sig,
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
    lastCheckedAt
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
  const { count, signature } = summary;

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

  if (count > 0 && changed && !throttled){
    const builderFromCtx = _ctx?.dupMessageBuilder;
    const builderFromCfg = _settings.messageBuilder;
    const msg =
      (typeof builderFromCfg === 'function' && builderFromCfg(count, famKey)) ||
      (typeof builderFromCtx === 'function' && builderFromCtx(count, famKey)) ||
      defaultMessageBuilder(count);

    showWarning(msg);

    // ربط اختياري مباشر بلوحة مراجعة التكرارات إن رغب السياق بذلك
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