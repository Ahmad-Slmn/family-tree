// src/features/lineage.js
// =======================================
// توريث معلومات النسب (قبيلة/عشيرة/أسماء أسلاف) بشكل ديناميكي
// بدون التأثير على القيم المخزّنة في الـ bio
// =======================================

// قراءة إعدادات النسب من __meta.lineage (اختياري لاحقًا)
function getLineageMeta(family){
  const meta = (family && family.__meta && family.__meta.lineage) || {};
  return {
    tribeRule: meta.tribeRule || 'father',      // father | mother | firstAncestor | none
    clanRule:  meta.clanRule  || 'father',      // father | mother | firstAncestor | none
  };
}

// بناء سياق للعائلة لتجميع أهم المراجع
export function buildLineageContext(family){
  const ctx = {
    family: family || null,
    rootPerson: family?.rootPerson || null,
    father: family?.father || null,
    wives: Array.isArray(family?.wives) ? family.wives : [],
    ancestors: Array.isArray(family?.ancestors) ? family.ancestors : [],
    byId: new Map(),
    meta: getLineageMeta(family)
  };

  // تسجيل الأشخاص الرئيسيين في خريطة byId
  ctx.ancestors.forEach(p => { if (p && p._id) ctx.byId.set(p._id, p); });
  if (ctx.father && ctx.father._id) ctx.byId.set(ctx.father._id, ctx.father);
  if (ctx.rootPerson && ctx.rootPerson._id) ctx.byId.set(ctx.rootPerson._id, ctx.rootPerson);

  ctx.wives.forEach(w => {
    if (w && w._id) ctx.byId.set(w._id, w);
    (w?.children || []).forEach(c => { if (c && c._id) ctx.byId.set(c._id, c); });
  });

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
  if (!person || !fam) return { father: null, mother: null };

  const role = String(person.role || '').trim();
  const bio  = person.bio || {};

  // 1) صاحب الشجرة
  if (person === fam.rootPerson || role === 'صاحب الشجرة'){
    const father = fam.father || null;

    // الأم ليست شخصًا في الموديل، نبني كائنًا خفيفًا عند الحاجة
    const motherBrothers = parseList(bio.motherBrothersTxt);
    const motherSisters  = parseList(bio.motherSistersTxt);

    const hasMother =
      (bio.motherName || bio.motherClan ||
       bio.motherBrothersTxt || bio.motherSistersTxt);

    const mother = hasMother ? {
      _virtual: true,
      role: 'الأم',
      name: bio.motherName || '',
      bio: {
        clan:  bio.motherClan || '',
        tribe: '',
        // إخوة/أخوات الأم → تُستخدم في resolveUnclesAunts كأخوال/خالات
        siblingsBrothers: motherBrothers,
        siblingsSisters:  motherSisters
      }
    } : null;

    return { father, mother };
  }


  // 2) ابن/بنت ضمن أطفال زوجة
  if (role === 'ابن' || role === 'بنت'){
    let mother = null;
    const wives = c?.wives || fam.wives || [];
    let found = false;

    for (const w of wives){
      if (!w || !Array.isArray(w.children)) continue;
      for (const ch of w.children){
        if (ch && ch._id === person._id){
          mother = w;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const father = fam.rootPerson || fam.father || null;
    return { father, mother };
  }


  // 3) الزوجة: أب/أم الزوجة من bio فقط (أشخاص افتراضيون)
  if (role === 'زوجة' || role.startsWith('الزوجة')){
    // إخوة/أخوات أب الزوجة
    const fatherBrothers = parseList(bio.fatherBrothersTxt);
    const fatherSisters  = parseList(bio.fatherSistersTxt);

    // إخوة/أخوات أم الزوجة
    const motherBrothers = parseList(bio.motherBrothersTxt);
    const motherSisters  = parseList(bio.motherSistersTxt);

    const father = (bio.fatherName || bio.fatherClan) ? {
      _virtual: true,
      role: 'أب الزوجة',
      name: bio.fatherName || '',
      bio: {
        clan:  bio.fatherClan || '',
        tribe: bio.tribe     || '',
        siblingsBrothers: fatherBrothers,
        siblingsSisters:  fatherSisters
      }
    } : null;

    const mother = (bio.motherName || bio.motherClan) ? {
      _virtual: true,
      role: 'أم الزوجة',
      name: bio.motherName || '',
      bio: {
        clan:  bio.motherClan || '',
        tribe: '', // يمكن توسيعها لاحقًا
        siblingsBrothers: motherBrothers,
        siblingsSisters:  motherSisters
      }
    } : null;


    return { father, mother };
  }

  // 4) الأب نفسه: نحاول ربطه بأقرب جدّ (إن وُجد)
  if (role === 'الأب'){
    const anc = Array.isArray(fam.ancestors) ? fam.ancestors : [];
    const nearest = anc.length ? anc[0] : null;
    return { father: nearest || null, mother: null };
  }

  // 5) أسلاف/آخرون: لا نحاول الذهاب أبعد من ذلك الآن
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

  // 1) قيمة مباشرة في الشخص
  if (bio.tribe && bio.tribe !== '-') return String(bio.tribe).trim();

  // 2) من الوالدين حسب القاعدة
  const parents = getParents(person, family, c);
  const fTribe  = parents.father?.bio?.tribe;
  const mTribe  = parents.mother?.bio?.tribe;

  if (rule === 'father' && fTribe) return String(fTribe).trim();
  if (rule === 'mother' && mTribe) return String(mTribe).trim();

  // 3) من الأسلاف (أول جدّ مذكور)
  if (rule === 'firstAncestor'){
    const ancTribe = findAncestorField(family, 'tribe');
    if (ancTribe) return ancTribe;
  }

  // 4) fallback عام إن لم تنجح القاعدة المحددة
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

  // 1) قيمة مباشرة في الشخص
  if (bio.clan && bio.clan !== '-') return String(bio.clan).trim();

  const parents = getParents(person, family, c);

  const fClan = parents.father?.bio?.clan;
  const mClan = parents.mother?.bio?.clan || parents.mother?.bio?.motherClan || bio.motherClan; // دعم بسيط لسلوكك الحالي


  if (rule === 'father' && fClan) return String(fClan).trim();
  if (rule === 'mother' && mClan) return String(mClan).trim();

  if (rule === 'firstAncestor'){
    const ancClan = findAncestorField(family, 'clan');
    if (ancClan) return ancClan;
  }

  // fallback عام
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
//    (يُستخدم عند الحاجة فقط، لا يغيّر name/bio.fullName)
// ---------------------------------------
export function resolveFullName(person, family, ctx){
  if (!person) return '';
  const bio = person.bio || {};

  // 1) إن كان لديك fullName مخزَّنًا صراحة
  if (bio.fullName && bio.fullName !== '-') return String(bio.fullName).trim();
  if (bio.fullname && bio.fullname !== '-') return String(bio.fullname).trim();

  // 2) تركيب بسيط: الاسم + اسم الأب + اسم الجد (إن وُجدت)
  const name    = (person.name || '').trim();
  const father  = (bio.fatherName || '').trim();
  const grand   = (bio.paternalGrandfather || '').trim();

  const parts = [name];
  if (father) parts.push(father);
  if (grand)  parts.push(grand);

  const full = parts.filter(Boolean).join(' بن ');
  return full || name;
}

// ---------------------------------------
// 5) resolveGrandparents: تجميع بيانات الأجداد
//    (حاليًا مجرد تجميع للحقول المخزَّنة مع إمكانية توسعة لاحقة)
// ---------------------------------------
export function resolveGrandparents(person, family, ctx){
  if (!person) return {};
  const bio = person.bio || {};

  return {
    paternalGrandfather:      bio.paternalGrandfather      || '',
    paternalGrandmother:      bio.paternalGrandmother      || '',
    paternalGrandmotherClan:  bio.paternalGrandmotherClan  || '',
    maternalGrandfather:      bio.maternalGrandfather      || '',
    maternalGrandmother:      bio.maternalGrandmother      || '',
    maternalGrandmotherClan:  bio.maternalGrandmotherClan  || '',
    // يمكن لاحقًا استكمال/توريث هذه القيم من ancestors حسب الحاجة
  };
}

// ---------------------------------------
// 6) resolveSiblings: استنتاج الإخوة والأخوات ديناميكيًا
// ---------------------------------------
export function resolveSiblings(person, family, ctx){
  if (!person || !family) return { brothers: [], sisters: [] };
  const fam = family;
  const c   = ensureCtx(fam, ctx);
  const bio = person.bio || {};
  const role = String(person.role || '').trim();

  // 0) لو المستخدم أدخل الإخوة/الأخوات يدويًا في الـ bio نحترمها كما هي
  const manualBro = Array.isArray(bio.siblingsBrothers) ? bio.siblingsBrothers : [];
  const manualSis = Array.isArray(bio.siblingsSisters)  ? bio.siblingsSisters  : [];
  if (manualBro.length || manualSis.length){
    return { brothers: manualBro, sisters: manualSis };
  }

  const addCandidate = (accById, list, p) => {
    if (!p) return;
    const nm = (p.name || '').trim();
    if (!nm) return;
    const id = p._id || `nr:${nm}|${(p.role||'').trim()}`;
    if (accById.has(id)) return;
    const item = { name: nm };
    if (p._id) item._id = p._id;
    accById.set(id, { item, role: (p.role || '').trim() });
  };

  const parents = getParents(person, fam, c);
  const allById = new Map();

  // 1) حالة الابن/البنت: نعتبر كل أبناء "الأب" (الجذر) إخوة/أخوات (حتى لو من أمهات مختلفات)
  if (role === 'ابن' || role === 'بنت'){
    const wives = c?.wives || fam.wives || [];
    for (const w of wives){
      if (!w || !Array.isArray(w.children)) continue;
      for (const ch of w.children){
        if (!ch || ch === person || ch._id === person._id) continue;
        addCandidate(allById, allById, ch);
      }
    }
  }

  // 2) لو الأب شخص آخر وله children (في نموذج آخر لاحقًا) يمكن توسيعها هنا
  // (حاليًا لا يوجد هيكل أبناء للأب خارج الزوجات، لذلك نكتفي بأبناء الجذر)

  // 3) fallback: لو الشخص هو صاحب الشجرة أو زوجة، نستخدم ما في bio فقط (وقد عالجناه في البداية)

  const brothers = [];
  const sisters  = [];

  for (const { item, role: r } of allById.values()){
    const rr = String(r || '').trim();
    if (rr === 'ابن'){
      brothers.push(item);
    } else if (rr === 'بنت'){
      sisters.push(item);
    } else {
      // دور غير محدّد: نضعه في الإخوة احتياطًا
      brothers.push(item);
    }
  }

  return { brothers, sisters };
}

// ---------------------------------------
// 7) resolveUnclesAunts: استنتاج الأعمام/العمّات/الأخوال/الخالات
// ---------------------------------------
export function resolveUnclesAunts(person, family, ctx){
  if (!person || !family) return {
    paternalUncles: [], paternalAunts: [],
    maternalUncles: [], maternalAunts: []
  };

  const fam = family;
  const c   = ensureCtx(fam, ctx);
  const parents = getParents(person, fam, c);

  const mapList = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(x => {
        if (!x) return null;
        if (typeof x === 'string') return { name: x };
        const nm = (x.name || '').trim();
        if (!nm) return null;
        const obj = { name: nm };
        if (x._id) obj._id = x._id;
        return obj;
      })
      .filter(Boolean);
  };

  let paternalUncles = [];
  let paternalAunts  = [];
  let maternalUncles = [];
  let maternalAunts  = [];

  // أعمام/عمّات من جهة الأب
  if (parents.father && parents.father.bio){
    const fbio = parents.father.bio;
    // نفترض أن siblingsBrothers للأب = أعمام، siblingsSisters = عمّات للولد
    paternalUncles = mapList(fbio.siblingsBrothers);
    paternalAunts  = mapList(fbio.siblingsSisters);
  }

  // أخوال/خالات من جهة الأم
  if (parents.mother && parents.mother.bio){
    const mbio = parents.mother.bio;
    // نفترض أن siblingsBrothers للأم = أخوال، siblingsSisters = خالات
    maternalUncles = mapList(mbio.siblingsBrothers);
    maternalAunts  = mapList(mbio.siblingsSisters);
  }

  return { paternalUncles, paternalAunts, maternalUncles, maternalAunts };
}