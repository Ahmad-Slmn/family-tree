// features/ids.js — معرّفات الأشخاص: توليد/توحيد/فحص (محسّن وآمن)

// ===== استيرادات =====
import * as Model from '../model/families.js';
import * as TreeUI from '../ui/tree.js';

// =======================================
// 1) أدوات مساعدة (تطبيع + سياق + بصمة)
// =======================================

// تطبيع عربي خفيف مطابق لما في tree.js
const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const AR_TATWEEL = /\u0640/gu;
function _normAr(s=''){
  return String(s).normalize('NFKD').replace(AR_DIAC,'').replace(AR_TATWEEL,'')
    .replace(/[\u0622\u0623\u0625]/gu,'ا').replace(/\u0649/gu,'ي')
    .replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}

// إيجاد سياق المرجع داخل العائلة: يحدّد هل هو طفل وتحت أي زوجة
function _findContext(fam, ref){
  let ctx = { type:'unknown', wife:null, path:null };

  function visit(p, path, parentWife=null){
    if (!p) return false;
    if (p === ref){ ctx = { type: parentWife ? 'child':'person', wife: parentWife, path }; return true; }

    // الزوجات
    if (Array.isArray(p.wives)){
      for (let i=0;i<p.wives.length;i++){
        const w = p.wives[i];
        const wPath = `${path}.wives[${i}]`;
        if (w === ref){ ctx = { type:'wife', wife:null, path: wPath }; return true; }
        if (visit(w, wPath, null)) return true;
      }
    }

    // الأطفال (تُمرَّر الزوجة الأم إن عُرفت)
    if (Array.isArray(p.children)){
      for (let i=0;i<p.children.length;i++){
        const c = p.children[i];
        const cPath = `${path}.children[${i}]`;
        if (c === ref){ ctx = { type:'child', wife: parentWife||p, path: cPath }; return true; }
        // لا نزور أحفاد الأطفال هنا
      }
    }
    return false;
  }

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  for (let t of tops){
    const rootPath =
      (Array.isArray(fam.ancestors) && fam.ancestors.includes(t)) ? `ancestors[${fam.ancestors.indexOf(t)}]` :
      (t === fam.father) ? 'father' :
      (t === fam.rootPerson) ? 'rootPerson' :
      `wives[${(fam.wives||[]).indexOf(t)}]`;

    // إذا كان t زوجة على مستوى العائلة فالأطفال تحتها
    const isTopWife = Array.isArray(t?.children);
    if (visit(t, rootPath, isTopWife ? t : null)) break;
  }
  return ctx;
}

// بصمة مرنة للمطابقة
function _fingerprint(p){
  const name  = _normAr(p?.name||'');
  const group = TreeUI.roleGroup(p)||'';
  const birth = String(p?.bio?.birthDate || p?.bio?.birthYear || '').trim();
  const mother= _normAr(p?.bio?.motherName||'');
  const clan  = _normAr(p?.bio?.clan||'');
  return { name, group, birth, mother, clan };
}

// =======================================
// 2) نشر مُعرّف موحّد عبر كل المراجع المطابقة
// =======================================

// ينشر newId لكل المراجع المتطابقة لنفس الشخص، مع ضبط نطاق الأطفال إلى فرع الزوجة الأم فقط.
export function assignIdEverywhere(fam, targetRef, newId){
  if (!fam || !targetRef || !newId) return;

  const tfp  = _fingerprint(targetRef);
  const tctx = _findContext(fam, targetRef);

  // مطابقة أقوى:
  // - نفس المرجع، أو
  // - بلا _id + (name && group متساويان) + واحد على الأقل من birth/mother/clan
  function strongMatch(p){
    if (!p || p._id) return false;
    if (p === targetRef) return true;
    const fp = _fingerprint(p);
    if (!fp.name || !tfp.name) return false;
    if (fp.name !== tfp.name) return false;
    if ((TreeUI.roleGroup(p)||'') !== (tfp.group||'')) return false;
    const extra =
      (fp.birth  && fp.birth  === tfp.birth) ||
      (fp.mother && fp.mother === tfp.mother) ||
      (fp.clan   && fp.clan   === tfp.clan);
    return !!extra;
  }

  // لمس آمن: الأطفال لا ينتشر إليهم المُعرّف إلا داخل نفس الزوجة الأم
  function touch(p, parentWife=null){
    if (!p) return;
    const g = TreeUI.roleGroup(p);
    const isChild = (g==='ابن' || g==='بنت');

    if (isChild){
      if (tctx.type !== 'child') return;          // الهدف ليس طفلًا
      if (!parentWife || parentWife !== tctx.wife) return; // ليس نفس فرع الزوجة
      if (strongMatch(p)) p._id = newId;
      return;
    }
    if (strongMatch(p)) p._id = newId;
  }

  // مسح انتقائي (تمرير مرجع الزوجة الأم للأطفال)
  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  const visit = (p, parentWife=null)=>{
    if (!p) return;
    touch(p, parentWife);
    if (Array.isArray(p.wives)) p.wives.forEach(w => visit(w, null));
    if (Array.isArray(p.children)) p.children.forEach(c => visit(c, parentWife||p));
  };

  tops.forEach(tp => {
    const isTopWife = Array.isArray(tp?.children);
    visit(tp, isTopWife ? tp : null);
  });

  // توافق قديم: مرآة rootPerson.wives
  if (fam.rootPerson && Array.isArray(fam.rootPerson.wives)){
    fam.rootPerson.wives.forEach(w => {
      touch(w, null);
      (w?.children||[]).forEach(c => touch(c, w));
    });
  }
}

// =======================================
// 3) ضمان IDs لعائلة واحدة + كشف التصادم
// =======================================

// مُعرّف مستقر اختياريًا: famKey + fingerprint → hash قصير
function _stableId(famKey, p){
  try{
    const fp = _fingerprint(p);
    const raw = `${famKey}|${fp.name}|${fp.group}|${fp.birth}|${fp.mother}|${fp.clan}`;
    // FNV-1a مبسّط (غير آمن تشفيرياً لكن ثابت)
    let h = 2166136261 >>> 0;
    for (let i=0;i<raw.length;i++){ h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return `p_${h.toString(36)}`;
  }catch{ return null; }
}

function ensureIdsForFamily(famKey, fam){
  if (!fam) return false;
  let changed = false;

  // إعطاء مُعرّف لكل من لا يملك _id
  const ensureOne = (p)=>{
    if (!p || p._id) return;
    const sid = _stableId(famKey, p);
    const nid = sid || (crypto?.randomUUID?.() || ('p_' + Math.random().toString(36).slice(2)));
    assignIdEverywhere(fam, p, nid);
    changed = true;
  };

  const walk = (p)=>{
    if (!p) return;
    ensureOne(p);
    (p.children||[]).forEach(c => walk(c));
    (p.wives||[]).forEach(w => walk(w));
  };

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  tops.forEach(walk);
  if (fam.rootPerson && Array.isArray(fam.rootPerson.wives)) fam.rootPerson.wives.forEach(walk);

  // كشف تصادمات _id داخل العائلة ومعالجتها
  const seen = new Map(); // id -> ref
  const fixDup = (p)=>{
    if (!p) return;
    if (p._id){
      if (!seen.has(p._id)) seen.set(p._id, p);
      else{
        const nid = crypto?.randomUUID?.() || ('p_' + Math.random().toString(36).slice(2));
        assignIdEverywhere(fam, p, nid);
        changed = true;
      }
    }
    (p.children||[]).forEach(c => fixDup(c));
    (p.wives||[]).forEach(w => fixDup(w));
  };
  tops.forEach(fixDup);
  if (fam.rootPerson && Array.isArray(fam.rootPerson.wives)) fam.rootPerson.wives.forEach(fixDup);

  return changed;
}

// =======================================
// 4) ضمان IDs لكل العائلات + حفظ عند التغيير
// =======================================
async function ensureIdsForAllFamilies(){
  const fams = Model.getFamilies();
  let anyChanged = false;
  for (const k of Object.keys(fams)){
    const fam = fams[k];
    if (ensureIdsForFamily(k, fam)) anyChanged = true;
  }
  if (anyChanged){
    Model.linkRootPersonWives?.();
    await Model.savePersistedFamilies?.();
  }
}

// =======================================
// 5) تشخيص اختياري: مجموعات يُحتمل دمجها لو غابَت الحقول
// =======================================
// تشخيص: يُرجع مجموعات مراجع يُحتمل دمجها لو غابت الحقول المميِّزة
function findPotentialMerges(fam){
  const buckets = new Map(); // key -> persons[]
  const pool = [];

  // جامع آمن بدون callbacks داخل حلقات لاحقًا
  function collect(p){
    if (!p) return;
    pool.push(p);
    const ch = p.children || [];
    for (let i = 0; i < ch.length; i++) collect(ch[i]);
    const ws = p.wives || [];
    for (let i = 0; i < ws.length; i++) collect(ws[i]);
  }

  // تجميع القمم
  const anc = Array.isArray(fam.ancestors) ? fam.ancestors : [];
  for (let i = 0; i < anc.length; i++) collect(anc[i]);
  if (fam.father) collect(fam.father);
  if (fam.rootPerson) collect(fam.rootPerson);
  const wivesTop = fam.wives || [];
  for (let i = 0; i < wivesTop.length; i++) collect(wivesTop[i]);

  // إسناد إلى السِلال
  for (let i = 0; i < pool.length; i++){
    const p = pool[i];
    const fp = _fingerprint(p);
    if (!fp.name) continue;
    const key = fp.name + '|' + fp.group + '|' + (fp.birth || '') + '|' + (fp.mother || '') + '|' + (fp.clan || '');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  // استخراج الحالات الضعيفة فقط (لا birth/mother/clan)
  const out = [];
  for (const entry of buckets.entries()){
    const arr = entry[1];
    if (arr.length < 2) continue;

    const weak = [];
    for (let i = 0; i < arr.length; i++){
      const f = _fingerprint(arr[i]);
      if (!f.birth && !f.mother && !f.clan) weak.push(arr[i]);
    }
    if (weak.length >= 2) out.push(weak);
  }
  return out;
}


// =======================================
// 6) تهيئة الوحدة
// =======================================
export function init(ctx){
  // إرجاع الواجهات للاستخدام من الوحدات الأخرى
  return {
    ensureIdsForAllFamilies,
    ensureIdsForFamily,
    assignIdEverywhere,
    findPotentialMerges
  };
}

// كشف الدوال للاستخدام المباشر
export { ensureIdsForAllFamilies, ensureIdsForFamily, findPotentialMerges };
