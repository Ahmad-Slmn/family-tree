// src/features/lineage.js
// =======================================
// توريث معلومات النسب (قبيلة/عشيرة/أسماء أسلاف) بشكل ديناميكي
// بدون التأثير على القيم المخزّنة في الـ bio
// =======================================
import { inferGender } from '../model/roles.js';

// قراءة إعدادات النسب من __meta.lineage (اختياري لاحقًا)
function getLineageMeta(family){
  const meta = (family && family.__meta && family.__meta.lineage) || {};
  return {
    tribeRule: meta.tribeRule || 'father',      // father | mother | firstAncestor | none
    clanRule:  meta.clanRule  || 'father',      // father | mother | firstAncestor | none

    // NEW: سلوكيات حساسة "غير واقعية" لا تُفعّل إلا صراحة
    allowNameParentInference: meta.allowNameParentInference === true,   // default false
    allowLegacyGrandpaAdoptsRootKids: meta.allowLegacyGrandpaAdoptsRootKids === true // default false
  };
}


// مساعد: مرن لاستخراج parentId
function getParentIdAny(p, which, ctx){
  const w = which === 'father' ? 'father' : 'mother';
  const id = p?._id || p?.id;
  return (
    p?.[`${w}Id`] || p?.[`${w}_id`] ||
    p?.bio?.[`${w}Id`] || p?.bio?.[`${w}_id`] ||
    (ctx?.parentByChild?.get?.(id)?.[w]) ||
    null
  );
}


// بناء سياق للعائلة لتجميع أهم المراجع
export function buildLineageContext(family){
  const fam = family || null;

  const ctx = {
    family: fam,
    rootPerson: fam?.rootPerson || null,
    father: fam?.father || null,
    wives: Array.isArray(fam?.wives) ? fam.wives : [],
    ancestors: Array.isArray(fam?.ancestors) ? fam.ancestors : [],
    persons: fam?.persons || {},
    byId: new Map(),
    allById: new Map(),
    connectedIds: new Set(),
    parentByChild: new Map(),
    meta: getLineageMeta(fam)
  };

    /* ============================================================
     (B0) normalize ancestors order (nearest first: generation=1)
     ============================================================ */
  ctx.ancestors = (Array.isArray(fam?.ancestors) ? fam.ancestors.slice() : [])
    .map(a => ({ a, gen: Number.isFinite(+a?.generation) ? +a.generation : 1 }))
    .sort((x, y) => (x.gen ?? 1) - (y.gen ?? 1))
    .map(x => x.a);

  // IMPORTANT:
  // في core: sortedAncestors يجعل gen=1 (الأقرب) أولاً.
  // لذلك لا تعمل reverse هنا.

  /* ============================================================
     (A) helpers
     ============================================================ */

  // نسخة واحدة فقط: لا نُظلّلها مرة ثانية
  function getParentIdAnyLocal(p, which){
    const w = which === 'father' ? 'father' : 'mother';
    const id = p?._id || p?.id;

    return (
      p?.[`${w}Id`] || p?.[`${w}_id`] ||
      p?.bio?.[`${w}Id`] || p?.bio?.[`${w}_id`] ||
      (ctx.parentByChild.get(String(id||''))?.[w]) ||
      null
    );
  }

  function addSiblingsOfParent(parentId){
    if (!parentId) return false;
    const pid = String(parentId);
    let changed = false;

    for (const p of ctx.allById.values()){
      if (!p?._id) continue;

      const pf = getParentIdAnyLocal(p, 'father');
      const pm = getParentIdAnyLocal(p, 'mother');

      const sameF = pf && String(pf) === pid;
      const sameM = pm && String(pm) === pid;
      if (!sameF && !sameM) continue;

      const sid = String(p._id);

      // NEW: ثبّت علاقة الأب/الأم ضمنيًا لهذا الشخص
      const stored = ctx.parentByChild.get(sid) || {};
      if (sameF && !stored.father) stored.father = pid;
      if (sameM && !stored.mother) stored.mother = pid;
      ctx.parentByChild.set(sid, stored);

      // NEW: مادّية IDs على الكائن للجلسة حتى تعمل المطابقات
      if (sameF && !p.fatherId && !p.bio?.fatherId) p.fatherId = pid;
      if (sameM && !p.motherId && !p.bio?.motherId) p.motherId = pid;

      // سلوكك القديم: فقط إدخالهم للاتصال
      if (!ctx.byId.has(sid)){
        ctx.byId.set(sid, p);
        ctx.connectedIds.add(sid);
        changed = true;
      } else if (!ctx.connectedIds.has(sid)){
        ctx.connectedIds.add(sid);
        changed = true;
      }
    }
    return changed;
  }

  // تطبيع عربي بسيط للمطابقة بالاسم (بدون imports)
  const _norm = (s)=> String(s||'')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,'') // حركات
    .replace(/\u0640/g,'')                                         // تطويل
    .replace(/[اأإآ]/g,'ا')
    .replace(/[يى]/g,'ي')
    .replace(/[هة]/g,'ه')
    .replace(/\s+/g,' ')
    .trim();

    function findExistingByNameAndFatherId(nm, fatherId){
    const key = _norm(nm);
    if (!key || !fatherId) return null;

    const fid = String(fatherId);
    for (const p of ctx.allById.values()){
      if (!p?._id) continue;

      const pn = _norm(p.name || p.bio?.fullName || p.bio?.fullname || '');
      if (pn !== key) continue;

      const pf = getParentIdAnyLocal(p, 'father');
      if (pf && String(pf) === fid) return p;
    }
    return null;
  }

  function connectExistingAsChildOfFather(existingPerson, fatherId){
    if (!existingPerson?._id || !fatherId) return;
    const exId = String(existingPerson._id);
    const fid  = String(fatherId);

    if (!ctx.byId.has(exId)) ctx.byId.set(exId, existingPerson);
    ctx.connectedIds.add(exId);

    const stored = ctx.parentByChild.get(exId) || {};
    if (!stored.father) stored.father = fid;
    if (!('mother' in stored)) stored.mother = null;
    ctx.parentByChild.set(exId, stored);

    if (!existingPerson.fatherId && !existingPerson.bio?.fatherId) existingPerson.fatherId = fid;
  }

  function ensureSyntheticSibling(sid, nm, role, fatherId){
    if (!sid || !nm || !fatherId) return;
    if (ctx.allById.has(sid)) return;

    const fid = String(fatherId);

    const sib = {
      _id: sid,
      name: nm,
      role,
      bio: {},
      fatherId: fid,
      motherId: null,
      spousesIds: [],
      childrenIds: []
    };

    ctx.allById.set(sid, sib);
    ctx.byId.set(sid, sib);
    ctx.connectedIds.add(sid);

    const stored = ctx.parentByChild.get(sid) || {};
    if (!stored.father) stored.father = fid;
    if (!('mother' in stored)) stored.mother = null;
    ctx.parentByChild.set(sid, stored);
  }

  function findByName(name){
    const key = _norm(name);
    if (!key) return null;
    for (const p of ctx.allById.values()){
      if (!p) continue;
      const nm = _norm(p.name || p.bio?.fullName || p.bio?.fullname || '');
      if (nm && nm === key) return p;
    }
    return null;
  }
  
  function findUniqueParentByName(name){
  const key = _norm(name);
  if (!key) return null;

  const matches = [];
  for (const p of ctx.allById.values()){
    if (!p) continue;

    const nm = _norm(p.name || p.bio?.fullName || p.bio?.fullname || '');
    if (!nm || nm !== key) continue;

    // فلترة بسيطة لمنع ربط الاسم بشخص "ابن/بنت/زوجة" غالبًا
    const r = String(p.role || '').trim();
    const bad =
      (r === 'ابن' || r === 'بنت' || r === 'زوجة' || r.startsWith('الزوجة'));
    if (bad) continue;

    matches.push(p);
    if (matches.length > 1) break; // نريد "وحيد" فقط
  }

  return (matches.length === 1) ? matches[0] : null;
}


  /* ============================================================
     (B) register all persons into allById
     ============================================================ */
  const regAll = (p)=>{
    if (!p) return;
    const id = p._id ? String(p._id) : null;
    if (id && !ctx.allById.has(id)) ctx.allById.set(id, p);

    (p.wives || []).forEach(regAll);
    (p.children || []).forEach(regAll);
  };

  Object.values(ctx.persons).forEach(regAll);
  ctx.ancestors.forEach(regAll);
  if (ctx.father) regAll(ctx.father);
  if (ctx.rootPerson) regAll(ctx.rootPerson);
  ctx.wives.forEach(regAll);

  /* ============================================================
     (C) add connected recursively + build parentByChild for kids
     ============================================================ */
  function addConnectedRec(p, implied=null){
    if (!p) return;
    const id = p._id ? String(p._id) : null;

    if (id){
      if (!ctx.byId.has(id)) ctx.byId.set(id, p);
      ctx.connectedIds.add(id);

      if (implied){
        const stored = ctx.parentByChild.get(id) || {};
        if (implied.father && !stored.father) stored.father = implied.father;
        if (implied.mother && !stored.mother) stored.mother = implied.mother;
        ctx.parentByChild.set(id, stored);
      }
    }

    const wives = Array.isArray(p.wives) ? p.wives : [];
    wives.forEach(w=>{
      addConnectedRec(w);
      (w.children||[]).forEach(ch=>{
        addConnectedRec(ch, {
          father: p?._id ? String(p._id):null,
          mother: w?._id ? String(w._id):null
        });
      });
    });

    const kids = Array.isArray(p.children) ? p.children : [];
    kids.forEach(ch=>{
      addConnectedRec(ch, {
        father: p?._id ? String(p._id):null,
        mother: null
      });
    });
  }

 function connectChildWithParents(child, fatherId, motherId){
  addConnectedRec(child, {
    father: fatherId,
    mother: motherId
  });
}

ctx.ancestors.forEach(addConnectedRec);
if (ctx.father) addConnectedRec(ctx.father);
if (ctx.rootPerson) addConnectedRec(ctx.rootPerson);

// NEW: ربط الزوجات كزوجات لصاحب الشجرة، وأبناؤهن بأبيهم الحقيقي
const husbandId =
  (ctx.rootPerson?._id ? String(ctx.rootPerson._id)
   : (ctx.father?._id ? String(ctx.father._id) : null));

for (const w of ctx.wives){
  if (!w) continue;

  // 1) سجّل الزوجة نفسها
  addConnectedRec(w);

  // 2) أبناء الزوجة
  const mid = w._id ? String(w._id) : null;
  const kids = w.children || [];
  for (const ch of kids){
    connectChildWithParents(ch, husbandId, mid);
  }
}

  /* ============================================================
     (J) wives' parents:
         1) by id if exists
         2) else infer by fatherName/motherName
     ============================================================ */
  for (const w of ctx.wives){
    if (!w?._id) continue;
    const wid = String(w._id);

    let wf = getParentIdAnyLocal(w, 'father');
    let wm = getParentIdAnyLocal(w, 'mother');

// SAFE: infer by name ONLY if explicitly enabled + unique match
if (ctx.meta?.allowNameParentInference === true){
  if (!wf){
    const fn = w.bio?.fatherName || w.fatherName || '';
    const fp = findUniqueParentByName(fn);
    if (fp?._id) wf = String(fp._id);
  }
  if (!wm){
    const mn = w.bio?.motherName || w.motherName || '';
    const mp = findUniqueParentByName(mn);
    if (mp?._id) wm = String(mp._id);
  }
}


    // سجّلهم كـ implied parents للزوجة (ديناميكي)
    if (wf || wm){
      const stored = ctx.parentByChild.get(wid) || {};
      if (wf && !stored.father) stored.father = wf;
      if (wm && !stored.mother) stored.mother = wm;
      ctx.parentByChild.set(wid, stored);

      // ضع ids على كائن الزوجة للجلسة (غير محفوظ في bio)
      if (wf && !w.fatherId && !w.bio?.fatherId) w.fatherId = wf;
      if (wm && !w.motherId && !w.bio?.motherId) w.motherId = wm;
    }

    // أدخل الأب/الأم في الاتصال
    const addParentDirect = (pid)=>{
      if (!pid) return;
      const id = String(pid);
      const p = ctx.allById.get(id);
      if (p){
        ctx.byId.set(id, p);
        ctx.connectedIds.add(id);
      }
    };

    addParentDirect(wf);
    addParentDirect(wm);

    // وأدخل إخوتهم (أعمام/عمات/أخوال/خالات)
    if (wf) addSiblingsOfParent(wf);
    if (wm) addSiblingsOfParent(wm);
  }

  /* ============================================================
     (D) link ancestors chain fatherId
     ============================================================ */
  if (ctx.ancestors.length){
    const a = ctx.ancestors;
    for (let i = 0; i < a.length; i++){
      const child = a[i];
      const parent = a[i+1] || null;
      if (child && parent && parent._id){
        if (!child.fatherId && !child.bio?.fatherId){
          child.fatherId = parent._id;
        }
      }
    }
  }

  /* ============================================================
     (D3) NEW: إدخال إخوة/أخوات كل "جد" كأبناء لنفس أبيه (الجد الأعلى)
     حتى يظهرون كأعمام/عمّات للجيل الأدنى بشكل صحيح
     ============================================================ */
  if (Array.isArray(ctx.ancestors) && ctx.ancestors.length > 1) {
    const anc = ctx.ancestors; // الأقرب أولاً

    for (let i = 0; i < anc.length - 1; i++) {
      const curAnc    = anc[i];
      const parentAnc = anc[i + 1];
      if (!curAnc?._id || !parentAnc?._id) continue;

      const curId     = String(curAnc._id);
      const grandpaId = String(parentAnc._id);

      const bros = Array.isArray(curAnc?.bio?.siblingsBrothers) ? curAnc.bio.siblingsBrothers : [];
      const sis  = Array.isArray(curAnc?.bio?.siblingsSisters)  ? curAnc.bio.siblingsSisters  : [];
      if (!bros.length && !sis.length) continue;

      // إخوة الجد
      for (let bi = 0; bi < bros.length; bi++){
        const entry = bros[bi];
        const nm = String(entry?.name || '').trim();
        if (!nm) continue;

        const existing = findExistingByNameAndFatherId(nm, grandpaId);
        if (existing?._id){
          connectExistingAsChildOfFather(existing, grandpaId);
          continue;
        }

        const sid = `ancSib:${curId}:bro:${bi}`;
        ensureSyntheticSibling(sid, nm, 'ابن', grandpaId);
      }

      // أخوات الجد
      for (let si = 0; si < sis.length; si++){
        const entry = sis[si];
        const nm = String(entry?.name || '').trim();
        if (!nm) continue;

        const existing = findExistingByNameAndFatherId(nm, grandpaId);
        if (existing?._id){
          connectExistingAsChildOfFather(existing, grandpaId);
          continue;
        }

        const sid = `ancSib:${curId}:sis:${si}`;
        ensureSyntheticSibling(sid, nm, 'بنت', grandpaId);
      }
    }
  }


    /* ============================================================
     (D2) NEW: ensure paternal chain links (rootPerson -> father -> nearest ancestor)
     ============================================================ */

  // NEW 1) rootPerson يعتبر ابنًا للأب (ديناميكيًا داخل الجلسة)
  if (ctx.rootPerson?._id && ctx.father?._id){
    const rid = String(ctx.rootPerson._id);
    const fid = String(ctx.father._id);

    // ضع fatherId على صاحب الشجرة إن كان مفقودًا (غير محفوظ في bio)
    if (!ctx.rootPerson.fatherId && !ctx.rootPerson.bio?.fatherId){
      ctx.rootPerson.fatherId = fid;
    }

    // سجّلها أيضًا كـ implied parent
    const storedR = ctx.parentByChild.get(rid) || {};
    if (!storedR.father) storedR.father = fid;
    ctx.parentByChild.set(rid, storedR);
  }

  // NEW 2) الأب يعتبر ابنًا لأقرب جدّ في ancestors[] (ancestor[0])
  if (ctx.father?._id && Array.isArray(ctx.ancestors) && ctx.ancestors.length){
    const fid = String(ctx.father._id);
    const nearest = ctx.ancestors[0]; // الأقرب للأب

    if (nearest?._id){
      const afid = String(nearest._id);

      if (!ctx.father.fatherId && !ctx.father.bio?.fatherId){
        ctx.father.fatherId = afid;
      }

      const storedF = ctx.parentByChild.get(fid) || {};
      if (!storedF.father) storedF.father = afid;
      ctx.parentByChild.set(fid, storedF);
    }
  }
  
    // NEW 3) إدخال إخوة/أخوات الأب كأبناء حقيقيين لنفس الجد (أبي الأب)
  // حتى يتم توريثهم داخل childrenIds للجد ويظهرون كأعمام/عمّات بشكل صحيح
  if (ctx.father?._id && Array.isArray(ctx.ancestors) && ctx.ancestors.length) {
    const fatherId   = String(ctx.father._id);
    const grandpa    = ctx.ancestors[0]; // أقرب جد للأب
    const grandpaId  = grandpa?._id ? String(grandpa._id) : null;

    const fb = Array.isArray(ctx.father?.bio?.siblingsBrothers) ? ctx.father.bio.siblingsBrothers : [];
    const fs = Array.isArray(ctx.father?.bio?.siblingsSisters)  ? ctx.father.bio.siblingsSisters  : [];

    // مُعرّف ثابت للجلسة لمنع التكرار
    const makeId = (kind, idx) => `fatherSib:${fatherId}:${kind}:${idx}`;

    const addFatherSibling = (entry, role, idx) => {
      if (!grandpaId) return;
      const nm = String(entry?.name || '').trim();
      if (!nm) return;

      const sid = makeId(role === 'ابن' ? 'bro' : 'sis', idx);

      // 0) إن كان موجود مسبقًا بنفس (الاسم + نفس fatherId=grandpaId) استخدمه
      const existing = findExistingByNameAndFatherId(nm, grandpaId);
      if (existing?._id){
        connectExistingAsChildOfFather(existing, grandpaId);
        return;
      }

      // 1) وإلا: أنشئ synthetic موحّد عبر helper
      ensureSyntheticSibling(sid, nm, role, grandpaId);
    };

    // إخوة الأب => أبناء للجد
    fb.forEach((b, i) => addFatherSibling(b, 'ابن', i));
    // أخوات الأب => بنات للجد
    fs.forEach((s, i) => addFatherSibling(s, 'بنت', i));
  }



  /* ============================================================
     (E) add parents of connected
     ============================================================ */
  function addParentToCtx(pid){
    if (!pid) return false;
    const id = String(pid);

    if (ctx.byId.has(id)){
      if (!ctx.connectedIds.has(id)){
        ctx.connectedIds.add(id);
        return true;
      }
      return false;
    }

    const p = ctx.allById.get(id);
    if (p){
      ctx.byId.set(id, p);
      ctx.connectedIds.add(id);
      return true;
    }
    return false;
  }

  /* ============================================================
     (F) expand (parents + siblings)
     ============================================================ */
  let expandChanged = true;
  for (let loop = 0; loop < 3 && expandChanged; loop++){
    expandChanged = false;

    const snapshot = Array.from(ctx.connectedIds);
    for (const cid of snapshot){
      const child = ctx.byId.get(cid);
      if (!child) continue;

      const implied = ctx.parentByChild.get(cid) || {};
      const fId = getParentIdAnyLocal(child,'father') || implied.father || null;
      const mId = getParentIdAnyLocal(child,'mother') || implied.mother || null;

      if (fId && addParentToCtx(fId)) expandChanged = true;
      if (mId && addParentToCtx(mId)) expandChanged = true;

      if (fId && addSiblingsOfParent(fId)) expandChanged = true;
      if (mId && addSiblingsOfParent(mId)) expandChanged = true;
    }
  }
  
    /* ============================================================
     (F2) NEW: expand descendants (children + grandchildren ...)
     ============================================================ */
  let descChanged = true;
  for (let loop = 0; loop < 4 && descChanged; loop++){
    descChanged = false;

    const snapshot = Array.from(ctx.connectedIds); // الآباء المتصلون حاليًا
    for (const pid of snapshot){
      // ابحث في كل أشخاص العائلة (حتى غير المتصلين) عن من أبوه/أمه = pid
      for (const p of ctx.allById.values()){
        if (!p?._id) continue;
        const cid = String(p._id);

        // لا تعالج من هو متصل أصلًا
        if (ctx.connectedIds.has(cid)) continue;

        const implied = ctx.parentByChild.get(cid) || {};
        const fId = getParentIdAnyLocal(p,'father') || implied.father || null;
        const mId = getParentIdAnyLocal(p,'mother') || implied.mother || null;

        const isChild =
          (fId && String(fId) === String(pid)) ||
          (mId && String(mId) === String(pid));

        if (!isChild) continue;

        // أدخل الابن في الاتصال
        ctx.byId.set(cid, p);
        ctx.connectedIds.add(cid);

        // وثّق parentIds ديناميكيًا على الابن (مثل منطق G)
        if (fId && !p.fatherId && !p.bio?.fatherId) p.fatherId = fId;
        if (mId && !p.motherId && !p.bio?.motherId) p.motherId = mId;

        descChanged = true;
      }
    }
  }


  /* ============================================================
     (G) rebuild childrenIds from scratch
     ============================================================ */

  function pushChild(parentId, childId){
    if (!parentId || !childId) return;
    const pid = String(parentId), cid = String(childId);
    const parent = ctx.byId.get(pid);
    if (!parent) return;

    if (!Array.isArray(parent.childrenIds)) parent.childrenIds = [];
    if (!parent.childrenIds.includes(cid)) parent.childrenIds.push(cid);
  }

  for (const p of ctx.byId.values()){
    if (!p?._id) continue;
    const cid = String(p._id);

    const implied = ctx.parentByChild.get(cid) || {};
    const fId = getParentIdAnyLocal(p,'father') || implied.father || null;
    const mId = getParentIdAnyLocal(p,'mother') || implied.mother || null;

    // NEW: materialize implied IDs on the object for this session
    // حتى تعمل getParents/resolveSiblings/resolveUnclesAunts بدقة
    if (fId && !p.fatherId && !p.bio?.fatherId) p.fatherId = fId;
    if (mId && !p.motherId && !p.bio?.motherId) p.motherId = mId;

    if (fId) pushChild(fId,cid);
    if (mId) pushChild(mId,cid);
  }


  /* ============================================================
     (H) link ancestors via childrenIds
     ============================================================ */
  const chain = ctx.ancestors;
  for (let i = 0; i < chain.length; i++){
    const ch = chain[i], pr = chain[i+1];
    if (!ch?._id || !pr?._id) continue;
    pushChild(pr._id, ch._id);

    ctx.connectedIds.add(String(ch._id));
    ctx.connectedIds.add(String(pr._id));
  }

/* ============================================================
   (I) legacy (DISABLED by default):
   ============================================================ */
if (ctx.meta?.allowLegacyGrandpaAdoptsRootKids && ctx.father && ctx.rootPerson?._id){
  const rootId = String(ctx.rootPerson._id);
  const fatherId = String(ctx.father._id);

  for (const [cid, pr] of ctx.parentByChild.entries()){
    if (pr?.father && String(pr.father) === rootId){
      pushChild(fatherId, cid);
    }
  }
}


  return ctx;
}


// مساعد داخلي: احصل على الـ ctx إن لم يُمرَّر
function ensureCtx(family, ctx){
  if (ctx && ctx.family === family) return ctx;
  if (!family) return null;
  return buildLineageContext(family);
}

// تحويل نص أسماء مفصولة بفواصل إلى مصفوفة كائنات { name }
function parseList(txt){
  return String(txt || '')
    .split(/[,\u060C]/u) // فاصلة عربية أو إنجليزية
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({ name }));
}

// البحث عن قيمة حقل معيّن في الأسلاف (ancestors[]) من الأقرب إلى الأبعد
function findAncestorField(family, field){
  if (!family) return '';
  const anc = Array.isArray(family.ancestors) ? family.ancestors : [];
  for (let i = 0; i < anc.length; i++){
    const bio = anc[i]?.bio || {};
    const v = bio[field];
    if (v && v !== '-') return String(v).trim();
  }
  return '';
}

// ---------------------------------------
// 1) getParents: استنتاج الأب/الأم قدر الإمكان
// ---------------------------------------
export function getParents(person, family, ctx){
  const fam = family || (ctx && ctx.family) || null;
  const c = ensureCtx(fam, ctx);
  if (!person || !fam || !c) return { father: null, mother: null };

  const P = (pid)=> pid ? (c.byId.get(String(pid)) || null) : null;

  // 1) روابط مباشرة (النموذج الواقعي)
  if (person.fatherId || person.motherId){
    return { father: P(person.fatherId), mother: P(person.motherId) };
  }

  // 2) fallback للسلوك القديم إن لم توجد روابط
  const role = String(person.role||'').trim();

  if (role === 'ابن' || role === 'بنت'){
    let mother = null;
    const pid = person._id;

    for (let i = 0; i < c.wives.length; i++){
      const w = c.wives[i];
      const kids = w && Array.isArray(w.children) ? w.children : null;
      if (!kids) continue;
      for (let j = 0; j < kids.length; j++){
        const ch = kids[j];
        if (ch && ch._id === pid){
          mother = w;
          i = c.wives.length;
          break;
        }
      }
    }

    const father = fam.rootPerson || fam.father || null;
    return { father, mother };
  }

  if (person === fam.rootPerson || role === 'صاحب الشجرة'){
    return {
      father: fam.father || null,
      mother: person.motherId ? P(person.motherId) : null
    };
  }

  if (role === 'زوجة' || role.startsWith('الزوجة')){
    return { father: P(person.fatherId), mother: P(person.motherId) };
  }

  if (role === 'الأب' || person === fam.father){
    const anc = Array.isArray(fam.ancestors) ? fam.ancestors : [];
    const nearest = anc[0] || null;
    return { father: nearest || null, mother: null };
  }

  // صاحب الشجرة يُعتبر ابنًا للأب إن وجد
  if (person === fam.rootPerson && fam.father){
    return { father: fam.father, mother: null };
  }

  // إذا كان الشخص من ancestors[] ولم يكن لديه fatherId صريح
  if (Array.isArray(fam.ancestors) && person?._id){
    const anc = fam.ancestors;
    const idx = anc.findIndex(a => a && String(a._id) === String(person._id));
    if (idx >= 0){
      const upperFather = anc[idx + 1] || null;
      return { father: upperFather, mother: null };
    }
  }

  return { father: null, mother: null };
}

// ---------------------------------------
// 2) resolveTribe: القبيلة الموروثة
// ---------------------------------------
export function resolveTribe(person, family, ctx){
  if (!person || !family) return '';
  const c    = ensureCtx(family, ctx);
  const meta = c?.meta || getLineageMeta(family);
  const rule = meta.tribeRule || 'father';
  const bio  = person.bio || {};
  const role = String(person.role || '').trim();

  // 1) قيمة مباشرة
  if (bio.tribe && bio.tribe !== '-') return String(bio.tribe).trim();

  const parents = getParents(person, family, c);
  const fTribe  = parents.father?.bio?.tribe;
  const mTribe  = parents.mother?.bio?.tribe || bio.motherTribe;

  // الزوجة ترث فقط من والديها لا من الزوج/الأبناء
  if (role === 'زوجة' || role.startsWith('الزوجة')){
    if (rule === 'father' && fTribe) return String(fTribe).trim();
    if (rule === 'mother' && mTribe) return String(mTribe).trim();
    if (fTribe) return String(fTribe).trim();
    if (mTribe) return String(mTribe).trim();
    return '';
  }

  if (rule === 'father' && fTribe) return String(fTribe).trim();
  if (rule === 'mother' && mTribe) return String(mTribe).trim();

  if (rule === 'firstAncestor' || rule === 'firstKnown'){
    const ancTribe = findAncestorField(family, 'tribe');
    if (ancTribe) return ancTribe;
  }

  if (fTribe) return String(fTribe).trim();
  if (mTribe) return String(mTribe).trim();

  const anyAnc = findAncestorField(family, 'tribe');
  if (anyAnc) return anyAnc;

  const rootTribe = family.rootPerson?.bio?.tribe;
  if (rootTribe) return String(rootTribe).trim();

  return '';
}

// ---------------------------------------
// 3) resolveClan: العشيرة الموروثة
// ---------------------------------------
export function resolveClan(person, family, ctx){
  if (!person || !family) return '';
  const c    = ensureCtx(family, ctx);
  const meta = c?.meta || getLineageMeta(family);
  const rule = meta.clanRule || 'father';
  const bio  = person.bio || {};
  const role = String(person.role || '').trim();

  // 1) قيمة مباشرة
  if (bio.clan && bio.clan !== '-') return String(bio.clan).trim();

  const parents = getParents(person, family, c);
  const fClan = parents.father?.bio?.clan;
  const mClan = parents.mother?.bio?.clan || parents.mother?.bio?.motherClan || bio.motherClan;

  // الزوجة ترث فقط من والديها
  if (role === 'زوجة' || role.startsWith('الزوجة')){
    if (rule === 'father' && fClan) return String(fClan).trim();
    if (rule === 'mother' && mClan) return String(mClan).trim();
    if (fClan) return String(fClan).trim();
    if (mClan) return String(mClan).trim();
    return '';
  }

  if (rule === 'father' && fClan) return String(fClan).trim();
  if (rule === 'mother' && mClan) return String(mClan).trim();

  if (rule === 'firstAncestor' || rule === 'firstKnown'){
    const ancClan = findAncestorField(family, 'clan');
    if (ancClan) return ancClan;
  }

  if (fClan) return String(fClan).trim();
  if (mClan) return String(mClan).trim();

  const anyAnc = findAncestorField(family, 'clan');
  if (anyAnc) return anyAnc;

  const rootClan = family.rootPerson?.bio?.clan;
  if (rootClan) return String(rootClan).trim();

  return '';
}

// ---------------------------------------
// 4) resolveFullName: اسم مركّب ديناميكي
// ---------------------------------------
export function resolveFullName(person){
  if (!person) return '';
  const bio = person.bio || {};

  if (bio.fullName && bio.fullName !== '-') return String(bio.fullName).trim();
  if (bio.fullname && bio.fullname !== '-') return String(bio.fullname).trim();

  const name   = (person.name || '').trim();
  const father = (bio.fatherName || '').trim();
  const grand  = (bio.paternalGrandfather || '').trim();

  const parts = [name];
  if (father) parts.push(father);
  if (grand)  parts.push(grand);

  const full = parts.filter(Boolean).join(' بن ');
  return full || name;
}

// ---------------------------------------
// 5) resolveGrandparents: تجميع بيانات الأجداد المخزّنة
// ---------------------------------------
export function resolveGrandparents(person){
  if (!person) return {};
  const bio = person.bio || {};
  return {
    paternalGrandfather:      bio.paternalGrandfather      || '',
    paternalGrandmother:      bio.paternalGrandmother      || '',
    paternalGrandmotherClan:  bio.paternalGrandmotherClan  || '',
    maternalGrandfather:      bio.maternalGrandfather      || '',
    maternalGrandmother:      bio.maternalGrandmother      || '',
    maternalGrandmotherClan:  bio.maternalGrandmotherClan  || '',
  };
}

// ---------------------------------------
// 6) resolveSiblings: استنتاج الإخوة والأخوات ديناميكيًا (مرن)
// ---------------------------------------
export function resolveSiblings(person, family, ctx){
  if (!person || !family) return { brothers:[], sisters:[], types:{} };
  const c = ensureCtx(family, ctx);
  const onlyConnected = p => !c.connectedIds || c.connectedIds.has(String(p?._id));

  // احترم الإدخال اليدوي إن وُجد
  const bio = person.bio || {};
  const manualBro = Array.isArray(bio.siblingsBrothers) ? bio.siblingsBrothers : [];
  const manualSis = Array.isArray(bio.siblingsSisters)  ? bio.siblingsSisters  : [];
  if (manualBro.length || manualSis.length){
    return { brothers: manualBro, sisters: manualSis, types:{} };
  }

  const { father, mother } = getParents(person, family, c);
  if (!father && !mother) return { brothers:[], sisters:[], types:{} };

  const selfId = person._id;
  const fid = x => (x && (x.fatherId || x.bio?.fatherId || null));
  const mid = x => (x && (x.motherId || x.bio?.motherId || null));

  // مرشّحو الإخوة من childrenIds إن وُجدت
  let candidates = father?.childrenIds
    ?.map(id => c.byId.get(String(id)))
    .filter(Boolean) || [];

  if (!candidates.length){
    // fallback: اجمع كل أبناء العائلة المتصلين
    const allKids = [];
    (c.wives || []).forEach(w => (w?.children||[]).forEach(ch => { if (onlyConnected(ch)) allKids.push(ch); }));
    (family.rootPerson?.children||[]).forEach(ch => { if (onlyConnected(ch)) allKids.push(ch); });
    (family.father?.children||[]).forEach(ch => { if (onlyConnected(ch)) allKids.push(ch); });

    if (c.persons && typeof c.persons === 'object'){
      Object.values(c.persons).forEach(p=>{
        if (p && onlyConnected(p) && (p.role === 'ابن' || p.role === 'بنت')) allKids.push(p);
      });
    }

    const seen = new Set();
    candidates = allKids.filter(k=>{
      const id = k?._id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const selfFatherId = fid(person) || father?._id || null;
    const selfMotherId = mid(person) || mother?._id || null;

    if (selfFatherId || selfMotherId){
      candidates = candidates.filter(k=>{
        if (!k || k._id === selfId) return false;
        const kFatherId = fid(k);
        const kMotherId = mid(k);
        const sameFather = selfFatherId && kFatherId && String(selfFatherId) === String(kFatherId);
        const sameMother = selfMotherId && kMotherId && String(selfMotherId) === String(kMotherId);
        return sameFather || sameMother;
      });
    } else {
      candidates = candidates.filter(k => k && k._id !== selfId);
    }
  }

  candidates = candidates.filter(onlyConnected);

  const outBro = [];
  const outSis = [];
  const types  = { full:[], paternal:[], maternal:[] };

  const selfFatherId = fid(person) || father?._id || null;
  const selfMotherId = mid(person) || mother?._id || null;

  for (const s of candidates){
    if (!s || s._id === selfId) continue;

    const sFatherId = fid(s);
    const sMotherId = mid(s);

    const sameFather = selfFatherId && sFatherId && String(selfFatherId) === String(sFatherId);
    const sameMother = selfMotherId && sMotherId && String(selfMotherId) === String(sMotherId);

    if (sameFather && sameMother) types.full.push(s);
    else if (sameFather)         types.paternal.push(s);
    else if (sameMother)         types.maternal.push(s);

     const g = inferGender(s);
    if (g === 'F') outSis.push(s);
    else outBro.push(s);

  }

  return { brothers: outBro, sisters: outSis, types };
}

// ---------------------------------------
// 7) resolveGrandchildren: أحفاد الشخص
// ---------------------------------------
export function resolveGrandchildren(person, family, ctx){
  if (!person || !family) return [];
  const c = ensureCtx(family, ctx);
  const pid = person._id;
  if (!pid) return [];

  const onlyConnected = p => !c.connectedIds || c.connectedIds.has(String(p?._id));

  // 1) أبناءه المباشرون
  const kids = [];
  for (const p of c.byId.values()){
    if (!onlyConnected(p)) continue;
    const fId = p.fatherId || p.bio?.fatherId;
    const mId = p.motherId || p.bio?.motherId;
    if (String(fId) === String(pid) || String(mId) === String(pid)){
      kids.push(p);
    }
  }
  if (!kids.length) return [];

  // 2) أحفاد = أبناء هؤلاء الأبناء
  const gkids = [];
  for (const k of kids){
    for (const p of c.byId.values()){
      if (!onlyConnected(p)) continue;
      const fId = p.fatherId || p.bio?.fatherId;
      const mId = p.motherId || p.bio?.motherId;
      if (String(fId) === String(k._id) || String(mId) === String(k._id)){
        gkids.push(p);
      }
    }
  }

  const seen = new Set();
  return gkids.filter(g=>{
    const id = g?._id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ---------------------------------------
// 8) resolveUnclesAunts: الأعمام/العمّات/الأخوال/الخالات
// ---------------------------------------
export function resolveUnclesAunts(person, family, ctx){
  if (!person || !family) return { paternalUncles:[], paternalAunts:[], maternalUncles:[], maternalAunts:[] };
  const c = ensureCtx(family, ctx);
  const { father, mother } = getParents(person, family, c);

  const getSibsOf = (p)=>{
    if (!p) return [];
    const gp = getParents(p, family, c);

    let kids = gp.father?.childrenIds?.map(id=>c.byId.get(String(id))).filter(Boolean) || [];
    if (!kids.length){
      let all = Array.from(c.byId.values());
      if (c.connectedIds?.size) all = all.filter(x => x && c.connectedIds.has(String(x._id)));

      const pF = p.fatherId || p.bio?.fatherId || gp.father?._id || null;
      const pM = p.motherId || p.bio?.motherId || gp.mother?._id || null;

      kids = all.filter(x=>{
        if (!x || x._id === p._id) return false;
        const xF = x.fatherId || x.bio?.fatherId || null;
        const xM = x.motherId || x.bio?.motherId || null;
        return (pF && xF && String(pF) === String(xF)) || (pM && xM && String(pM) === String(xM));
      });
    }
    return kids.filter(x=>x._id!==p._id);
  };

  const mapPeople = (arr, g)=> (arr||[]).filter(x => inferGender(x) === g).map(x => ({ name:x.name, _id:x._id }));
  const manualSibsOf = (p)=>{
    const b = p?.bio || {};
    return { bro: Array.isArray(b.siblingsBrothers) ? b.siblingsBrothers : [], sis: Array.isArray(b.siblingsSisters) ? b.siblingsSisters : [] };
  };

  const normName = (s)=> String(s||'')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
    .replace(/\u0640/g,'')
    .replace(/[اأإآ]/g,'ا')
    .replace(/[يى]/g,'ي')
    .replace(/[هة]/g,'ه')
    .replace(/\s+/g,' ')
    .trim();

  // ربط manual بـ inferred فقط عند تطابق اسم "وحيد" (لتفادي الازدواجية)
  const attachIdsFromInferredByName = (manualArr, inferredArr)=>{
    const idx = new Map();
    (inferredArr||[]).forEach(p=>{
      if (!p?._id) return;
      const k = normName(p.name);
      if (!k) return;
      (idx.get(k) || idx.set(k, []).get(k)).push(p);
    });
    return (manualArr||[]).map(x=>{
      if (!x || x._id) return x;
      const matches = idx.get(normName(x.name)) || [];
      return (matches.length === 1) ? { ...x, _id: matches[0]._id } : x; // متعدد/صفر => يظل بدون id (يأخذ synthetic لاحقًا)
    });
  };

  const mergePreferInferred = (inferred, manual)=>{
    const out = [], seenIds = new Set(), usedSynthetic = new Set();
    const makeSyntheticId = (key)=>{
      let base = `manual:${key || 'x'}`, i = 1, id = base;
      while (usedSynthetic.has(id) || seenIds.has(id)) id = `${base}#${++i}`;
      usedSynthetic.add(id); return id;
    };

    (inferred||[]).forEach(x=>{
      const nm = String(x?.name||'').trim(); if (!nm) return;
      const id = x?._id ? String(x._id) : null;
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      out.push({ name:nm, _id:x._id });
    });

    (manual||[]).forEach(x=>{
      const nm = String(x?.name||'').trim(); if (!nm) return;
      const id = x?._id ? String(x._id) : null;
      if (id){
        if (seenIds.has(id)) return;
        seenIds.add(id);
        out.push({ name:nm, _id:x._id });
      } else {
        const sid = makeSyntheticId(normName(nm));
        out.push({ name:nm, _id:sid, virtual:true, source:'manual' });
      }
    });

    return out;
  };

  const fatherSibs = getSibsOf(father), motherSibs = getSibsOf(mother);
  const fMan = manualSibsOf(father), mMan = manualSibsOf(mother);

  const inferredPU = mapPeople(fatherSibs,'M'), inferredPA = mapPeople(fatherSibs,'F');
  const inferredMU = mapPeople(motherSibs,'M'), inferredMA = mapPeople(motherSibs,'F');

  const paternalUncles = mergePreferInferred(inferredPU, attachIdsFromInferredByName(fMan.bro, inferredPU));
  const paternalAunts  = mergePreferInferred(inferredPA, attachIdsFromInferredByName(fMan.sis, inferredPA));
  const maternalUncles = mergePreferInferred(inferredMU, attachIdsFromInferredByName(mMan.bro, inferredMU));
  const maternalAunts  = mergePreferInferred(inferredMA, attachIdsFromInferredByName(mMan.sis, inferredMA));

  return { paternalUncles, paternalAunts, maternalUncles, maternalAunts };
}
