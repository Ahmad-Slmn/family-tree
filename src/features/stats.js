// features/stats.js — إحصاءات + مخططات + فلاتر + تصدير Excel
// يعتمد على: utils.byId ، model/families.getFamilies ، model/roles.roleGroup

import { byId } from '../utils.js';
import * as Model from '../model/families.js';
import { roleGroup, inferGender } from '../model/roles.js';
import * as Lineage from './lineage.js';
import { getDuplicatesStatusForAllFamilies, getDuplicateSummary } from './duplicates.js';
import {normalizeFamilyPipeline, walkPersons, personFingerprint} from '../model/families.core.js';

let _ctx = null;

function hexToRgba(hex, a = 0.18){
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}


/* =========================
   1) حساب الإحصاءات (عدّ آمن)
   - يمنع التكرار عبر _id أو بصمة مرنة
   - يبني perFamily و perClan ومؤشرات النواقص
========================= */
function computeStats(onlyFamilyKey = null, opts = {}){
  const {
    uniqueAcrossFamilies = false,
    diagnostics = true,

    // (3) استبعاد الأدوار الافتراضية (أب الزوجة/أم الزوجة/عم الزوجة...)
    excludeVirtualRoles = false,

    // (3) عدّ الأدوار الأساسية فقط
    coreRolesOnly = false
  } = (opts && typeof opts === 'object') ? opts : {};

  const fams    = Model.getFamilies();
  const visible = Object.keys(fams).filter(k => fams[k] && fams[k].hidden !== true);

  let keys;
  if (Array.isArray(onlyFamilyKey) && onlyFamilyKey.length){
    const set = new Set(onlyFamilyKey);
    keys = visible.filter(k => set.has(k));
  } else if (typeof onlyFamilyKey === 'string' && onlyFamilyKey){
    keys = visible.filter(k => k === onlyFamilyKey);
  } else {
    keys = visible;
  }

const s = {
  familiesCount: keys.length,
  persons: 0, sons: 0, daughters: 0, wives: 0, unknown: 0,   // (كما هي) تصنيف كل الأشخاص أثناء traversal
  rootSons: 0, rootDaughters: 0,                               // جديد: أبناء/بنات صاحب الشجرة فقط
  avgChildren: 0, avgChildrenPerRoot: 0,
  perFamily: [],
  perClan: new Map(),
  missing: { birthInfo:0, clan:0, photoAny:0, missingIdsCount:0 },
  diagnostics: diagnostics ? {
    invariantsFailed:0,
    invariantNotes:[],
    fingerprintSkipped:0
  } : null
};


  // مجموعات منع التكرار على مستوى "الكل" (فقط عند uniqueAcrossFamilies = true)
  const gSeenIds  = uniqueAcrossFamilies ? new Set()     : null;
  const gSeenObjs = uniqueAcrossFamilies ? new WeakSet() : null;

const makeFamilyAcc = (famKey, fam)=>{
  const label = (fam?.familyName || fam?.title || fam?.rootPerson?.name || famKey || '').trim();
  return {
    familyKey:famKey, label,
    persons:0, sons:0, daughters:0, wives:0, unknown:0,        // (كما هي) تصنيف جميع الأشخاص
    rootSons:0, rootDaughters:0                         
  };
};
  // اتساق سريع (Invariants)
  const diagFail = (msg)=>{
    if (!s.diagnostics) return;
    s.diagnostics.invariantsFailed += 1;
    if (s.diagnostics.invariantNotes.length < 60) s.diagnostics.invariantNotes.push(msg);
  };

  const checkInvariantsForFamily = (famKey, famAcc, famDiag)=>{
    // 1) famAcc.persons == sum(categories)
    const sumCats = (famAcc.sons + famAcc.daughters + famAcc.wives + famAcc.unknown);
    if (famAcc.persons !== sumCats){
      diagFail(`[${famKey}] famAcc.persons(${famAcc.persons}) != sumCats(${sumCats})`);
    }

    // 2) sons+daughters == count(roleGroup ابن/بنت) (نسجلها أثناء tally)
    if (famDiag && (famDiag.kidsRolesCount != null)){
      const sd = famAcc.sons + famAcc.daughters;
      if (sd !== famDiag.kidsRolesCount){
        diagFail(`[${famKey}] (sons+daughters=${sd}) != kidsRolesCount(${famDiag.kidsRolesCount})`);
      }
    }
  };

  // تحقق تبادلية روابط الزوجات (اختياري/لين)
  const checkSpouseReciprocity = (famKey, fam)=>{
    const rp = fam?.rootPerson;
    if (!rp) return;
    const a = Array.isArray(rp.spousesIds) ? rp.spousesIds.map(String) : null;
    if (!a || !a.length) return;

    // ابحث عن الزوجات (في البنية الحالية غالبًا rp.wives)
    const wives = Array.isArray(rp.wives) ? rp.wives : (Array.isArray(fam?.wives) ? fam.wives : []);
    if (!wives.length) return;

    for (const w of wives){
      const wid = w?._id ? String(w._id) : null;
      if (!wid) continue;
      if (!a.includes(wid)){
        diagFail(`[${famKey}] rootPerson.spousesIds missing wifeId=${wid}`);
      }
      const b = Array.isArray(w?.spousesIds) ? w.spousesIds.map(String) : null;
      if (b && rp?._id){
        const rpid = String(rp._id);
        if (!b.includes(rpid)){
          diagFail(`[${famKey}] wife.spousesIds missing rootId=${rpid} (wifeId=${wid})`);
        }
      }
    }
  };

// === جمع على مستوى كل عائلة ===
const perFamilyRoots = [];

const processFamily = (famKey)=>{
  const f = fams[famKey]; if (!f) return;

  // NEW: تهيئة pipeline + ensureIds بقوة (الهدف: غياب _id حالة نادرة)
if (!f.__pipelineReady && typeof normalizeFamilyPipeline === 'function') {
  const fromVer =
    Number.isFinite(f.__v) ? f.__v :
    Number.isFinite(f.schemaVersion) ? f.schemaVersion :
    0;

  normalizeFamilyPipeline(f, { fromVer, markCore: f.__core === true });
  f.__pipelineReady = true;
}

  if (typeof Model.ensureIds === 'function'){
    try { Model.ensureIds(f); } catch {}
  }

  // Sets تُصفَّر لكل عائلة (إحصاء مستقل)
  const seenIds  = uniqueAcrossFamilies ? gSeenIds  : new Set();
  const seenObjs = uniqueAcrossFamilies ? gSeenObjs : new WeakSet();
  const softSeen = new Set(); // يبقى محليًا للعائلة فقط (احتياطي)

  const famAcc = makeFamilyAcc(famKey, f);

  const ctx =
    (Lineage && typeof Lineage.buildLineageContext === 'function') ? Lineage.buildLineageContext(f)
      : null;
  const resolveClanSafe = (p)=>{
    const b = p?.bio || {};
    if (Lineage && typeof Lineage.resolveClan === 'function'){
      const c = Lineage.resolveClan(p, f, ctx);   // (person, family, ctx)
      if (c && String(c).trim()) return String(c).trim();
    }
    return String(b.clan || '').trim();
  };
  
    // (احتياطي نادر) بصمة مرنة — محلية لهذه العائلة (ترى resolveClanSafe)
  const softFingerprint = (p)=>{
    const b = p?.bio || {};
    const resolvedClan = resolveClanSafe(p);
    return [
      'fp', String(famKey||'').trim(),
      String(p?.name||'').trim(),
      roleGroup(p),
      String(b.birthDate||b.birthYear||'').trim(),
      String(b.fatherName||'').trim(),
      String(resolvedClan).trim(),
      String(b.motherFullName||b.motherName||'').trim(),
      String(b.birthPlace||'').trim()
    ].join('|');
  };

const clanKeyNorm = (s)=> normArStats(String(s||'')).replace(/\s+/g,' ').trim();

const bumpClan = (p)=>{
  const clanRaw = resolveClanSafe(p);          // اسم العشيرة كما هو (موروث عبر resolveClanSafe -> Lineage.resolveClan)
  if (!clanRaw) return;

  const key = clanKeyNorm(clanRaw);
  if (!key) return;

  const cur = s.perClan.get(key) || {
    label: clanRaw.trim(),
    persons: 0,
    males: 0,
    females: 0,
    unknownGender: 0
  };

  cur.persons += 1;

  const g = (typeof inferGender === 'function') ? inferGender(p) : null;
  if (g === 'M') cur.males += 1;
  else if (g === 'F') cur.females += 1;
  else cur.unknownGender += 1;

  if (!cur.label) cur.label = clanRaw.trim();
  s.perClan.set(key, cur);
};


  const bumpMissing = (p)=>{
    const b = p?.bio || {};
    const hasBirthInfo = !!(String(b.birthDate||'').trim() || String(b.birthYear||'').trim());
    if (!hasBirthInfo) s.missing.birthInfo += 1;

    if (!resolveClanSafe(p)) s.missing.clan += 1;

    const raw = String(b.photoUrl || p?.photoUrl || '').trim();
    if (!raw) s.missing.photoAny += 1;
  };


  const famDiag = diagnostics ? { kidsRolesCount:0 } : null;

  const countRootKids = (fam)=>{
    const rp = fam?.rootPerson;
    if (!rp) return { sons:0, daughters:0, total:0 };

    const ids = new Set();
    const fps = new Set();
    const kids = [];

    const kidKey = (c)=>{
      const id = c?._id ? String(c._id) : '';
      if (id) return { kind:'id', key:id };

      const fpCore = (typeof personFingerprint === 'function') ? personFingerprint(c) : '';
      const fp = fpCore || softFingerprint(c);
      return fp ? { kind:'fp', key:fp } : { kind:'none', key:'' };
    };

    const addKid = (c)=>{
      if (!c) return;

      const k = kidKey(c);
      if (k.kind === 'id'){
        if (ids.has(k.key)) return;
        ids.add(k.key);
        kids.push(c);
        return;
      }

      if (k.kind === 'fp'){
        if (fps.has(k.key)) return;
        fps.add(k.key);
        kids.push(c);
        return;
      }

      // احتياط: لو لا id ولا fp، خليه ينضاف مرة واحدة على الأقل حسب المرجع
      // (اختياري) يمكن تعمل WeakSet هنا لو حبيت
      kids.push(c);
    };

    // 1) أبناء الجذر المباشرين
    for (const c of (Array.isArray(rp.children) ? rp.children : [])){
      addKid(c);
    }

    // 2) أبناء الزوجات
    const wives = Array.isArray(rp.wives) ? rp.wives : (Array.isArray(fam?.wives) ? fam.wives : []);
    for (const w of wives){
      for (const c of (Array.isArray(w?.children) ? w.children : [])){
        addKid(c);
      }
    }

    let sons = 0, daughters = 0;
    for (const c of kids){
      const rg = roleGroup(c);
      if (rg === 'ابن') sons++;
      else if (rg === 'بنت') daughters++;
    }
    return { sons, daughters, total: kids.length };
  };

  // ===== خيارات العد =====
  const CORE_ROLE_SET = new Set(['صاحب الشجرة','الأب','الأم','ابن','بنت','زوجة','جد','جدة']);

  const isVirtualGeneratedRole = (p)=>{
    const raw = String(p?.role || '').trim();
    if (!raw) return false;

    // الزوجات الحقيقيات تُحسب (زوجة/الزوجة الأولى...)
    if (raw === 'زوجة' || raw.startsWith('الزوجة')) return false;

    // أي دور “مُولّد” من جهة الزوجة عادة يحتوي "الزوجة" لكن ليس زوجة نفسها
    // مثل: أب الزوجة، أم الزوجة، عم الزوجة، خال الزوجة، جد الزوجة من جهة الأب...
    if (raw.includes('الزوجة')) return true;

    // (احتياط) أدوار أقارب الزوجة بدون ذكر كلمة الزوجة أحيانًا
    // إذا عندكم تسميات مختلفة أضفها هنا لاحقًا
    return false;
  };

  const shouldCount = (p)=>{
    if (!p) return false;

    // (3) خيار استبعاد الأدوار الافتراضية
if (excludeVirtualRoles === true && isVirtualGeneratedRole(p)) return false;

    // (3) خيار العدّ بالأدوار الأساسية فقط
if (coreRolesOnly === true){
      const rg = roleGroup(p);
      const raw = String(p?.role || '').trim();
      if (CORE_ROLE_SET.has(rg)) return true;
      if (CORE_ROLE_SET.has(raw)) return true; // مثل "صاحب الشجرة"
      return false;
    }

    return true;
  };

  // ===== سد فجوة IDs-only (4) =====
  const visitChildrenIdsIfNeeded = (p)=>{
    // لو ما عنده children objects لكن عنده childrenIds
    const hasObjs = Array.isArray(p?.children) && p.children.length;
    const ids = Array.isArray(p?.childrenIds) ? p.childrenIds : null;
    if (hasObjs || !ids || !ids.length) return;

    // ctx.byId متاح من Lineage.buildLineageContext غالبًا (Map)
    const map = ctx?.byId;
    if (!map || typeof map.get !== 'function') return;

    for (const id of ids){
      const ch = map.get(String(id));
      if (ch) tally(ch);
    }
  };

  // ===== منع التكرار (5) تحسين البصمة =====
  const alreadyCounted = (p)=>{
    if (!p || typeof p !== 'object') return true;

    const pid = p?._id ? String(p._id) : '';
    if (pid){
      if (seenIds.has(pid)) return true;
      seenIds.add(pid);
      return false;
    }

    // بلا _id — لا ترفع العداد هنا

    // نفس المرجع
    if (seenObjs.has(p)) return true;
    seenObjs.add(p);

    // بصمة معيارية أولاً
    const fpCore = (typeof personFingerprint === 'function') ? personFingerprint(p) : '';
    const fp = fpCore || softFingerprint(p);

    if (fp){
      if (softSeen.has(fp)) {
        if (s.diagnostics) s.diagnostics.fingerprintSkipped = (s.diagnostics.fingerprintSkipped || 0) + 1;
        return true;
      }
      softSeen.add(fp);
    }

    // الآن فقط: هذا الشخص “سيُعد فعليًا”
    s.missing.missingIdsCount += 1;

    return false;
  };

  const tally = (p)=>{
    if (!p) return;
    // (4) إذا أطفال IDs-only، دخّلهم قبل العد (والـ alreadyCounted يمنع التكرار)
    visitChildrenIdsIfNeeded(p);

    // لا نعد هذا الشخص إن كان مستبعدًا (لكن نتركه يمرّ على walker لتجنب قطع السلسلة)
    if (!shouldCount(p)) return;

    if (alreadyCounted(p)) return;

    s.persons += 1;
    famAcc.persons += 1;
    bumpMissing(p);

    const rg = roleGroup(p);
    if (rg === 'زوجة'){
      s.wives += 1; famAcc.wives += 1;
      bumpClan(p);
    } else if (rg === 'ابن'){
      s.sons += 1; famAcc.sons += 1;
      if (famDiag) famDiag.kidsRolesCount += 1;
      bumpClan(p);
    } else if (rg === 'بنت'){
      s.daughters += 1; famAcc.daughters += 1;
      if (famDiag) famDiag.kidsRolesCount += 1;
      bumpClan(p);
    } else {
      s.unknown += 1; famAcc.unknown += 1;
      bumpClan(p);
    }
  };

  // (2) Traversal موحّد عبر Walker
  if (typeof walkPersons === 'function'){
    walkPersons(f, (p)=> tally(p));
  } else {
    // fallback احتياطي لو تعطل الاستيراد لأي سبب
    const roots = [
      ...(Array.isArray(f?.ancestors) ? f.ancestors : []),
      f.father, f.rootPerson
    ].filter(Boolean);
    for (const r of roots) tally(r);

    // fallback إضافي قديم فقط عند عدم توفر walker
    if (!Array.isArray(f?.rootPerson?.wives) && Array.isArray(f?.wives)) {
      for (const w of f.wives) tally(w);
    }
  }

// أبناء/بنات صاحب الشجرة فقط
const rk = countRootKids(f);
famAcc.rootSons      = rk.sons;
famAcc.rootDaughters = rk.daughters;
s.rootSons          += rk.sons;
s.rootDaughters     += rk.daughters;

// استخدم هذا للـ averages بدل (s.sons+s.daughters)
perFamilyRoots.push({ famKey, rpKids: rk.total });

  if (diagnostics){
    checkInvariantsForFamily(famKey, famAcc, famDiag);
    checkSpouseReciprocity(famKey, f);
  }

 s.perFamily.push(famAcc);


};

for (const famKey of keys) processFamily(famKey);

const rootKidsAll = (s.rootSons + s.rootDaughters);
s.avgChildren = Number((rootKidsAll / Math.max(1, s.familiesCount)).toFixed(2));
const activeRoots = perFamilyRoots.filter(x => x.rpKids > 0).length || 1;
s.avgChildrenPerRoot = Number((rootKidsAll / activeRoots).toFixed(2));

  return s;
}


/* =========================
   2) أدوات Canvas (HiDPI)
========================= */
function scaleCanvasForDPR(cv, ctx){
  const ratio = window.devicePixelRatio || 1;
  const cssW  = Math.max(1, cv.clientWidth  || parseFloat(getComputedStyle(cv).width)  || cv.width);
  const cssH  = Math.max(1, cv.clientHeight || parseFloat(getComputedStyle(cv).height) || cv.height);
  cv.width  = Math.round(cssW * ratio);
  cv.height = Math.round(cssH * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { logicalW: cssW, logicalH: cssH, ratio };
}

function getPalette(el){
  const cs = getComputedStyle(el || document.documentElement);
  const pick = (v, fb) => (cs.getPropertyValue(v).trim() || fb);

  return {
    bg:      pick('--chart-bg', '#fff'),
    grid:    pick('--chart-grid', '#e5e7eb'),
    text:    pick('--chart-text', '#111827'),
    son1:    pick('--chart-son-1', '#93c5fd'),
    son2:    pick('--chart-son-2', '#60a5fa'),
    dau1:    pick('--chart-daughter-1', '#b794f4'),
    dau2:    pick('--chart-daughter-2', '#a78bfa'),
  };
}

// ——— تباين النص: كبسولة خلف الرقم + حساب لُمِعان اللون ———
function hexToRgb(hex){
  const m = hex.replace('#','');
  const n = parseInt(m.length===3 ? m.split('').map(x=>x+x).join('') : m, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function relLuminance(hex){                     // WCAG relative luminance
  const {r,g,b} = hexToRgb(hex);
  const lin = v => {
    v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  };
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}
function drawPillLabel(ctx, x, y, text, pal){
  const darkBg = relLuminance(pal.bg) < 0.5;    // خلفية قاتمة؟
  const padX=6, padY=3, r=6;

  ctx.save();
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  const h = 16;                                 // تقريبي لارتفاع 14px
  const left = Math.round(x - (w/2) - padX);
  const top  = Math.round(y - h - padY);        // أعلى النص بقليل
  const boxW = Math.round(w + padX*2);
  const boxH = Math.round(h + padY*2);

  // الكبسولة
  ctx.beginPath();
  ctx.moveTo(left+r, top);
  ctx.arcTo(left+boxW, top, left+boxW, top+boxH, r);
  ctx.arcTo(left+boxW, top+boxH, left, top+boxH, r);
  ctx.arcTo(left, top+boxH, left, top, r);
  ctx.arcTo(left, top, left+boxW, top, r);
  ctx.closePath();

  // خلفية الكبسولة وحدود خفيفة
  ctx.fillStyle = darkBg ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.90)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = darkBg ? 'rgba(255,255,255,0.18)' : 'rgba(17,24,39,0.15)';
  ctx.stroke();

  // نص عالي التباين
  ctx.fillStyle = darkBg ? '#ffffff' : '#111827';
  ctx.fillText(text, Math.round(x), Math.round(top + boxH - padY - 2));
  ctx.restore();
}



/* =========================
   3) أعمدة المُلخص (جماليات خفيفة + حركة)
========================= */
function drawBars(cv, pairs){
  const ctx = cv.getContext('2d', { alpha: true });
  const { logicalW: W, logicalH: H, ratio } = scaleCanvasForDPR(cv, ctx);
const pal = getPalette(cv);

  // خلفية الرسم
const bg = pal.bg;

  // تنظيف
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);
  ctx.restore();

  // أبعاد أساسية
  const padX = 28, padY = 28;
  const axisY = H - padY;
  const max   = Math.max(1, ...pairs.map(p => p.value));
  const bw    = Math.min(140, (W - padX*2) / (pairs.length*1.7));
  const gap   = Math.min(60, bw*0.7);
  const totalW = pairs.length*bw + (pairs.length-1)*gap;
  const startX = Math.max(padX, (W - totalW)/2);

  // خط الأساس
ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padX, axisY + 0.5); ctx.lineTo(W - padX, axisY + 0.5); ctx.stroke();

  // نص
  ctx.font = '14px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // حركة قصيرة
  const dur = 350;
  const t0  = performance.now();
  const easeOutCubic = x => 1 - Math.pow(1 - x, 3);

  const roundedBar = (x,y,w,h,r)=>{
    const rr = Math.min(r, w/2, h);
    ctx.beginPath();
    ctx.moveTo(x, y+rr);
    ctx.arcTo(x, y, x+rr, y, rr);
    ctx.lineTo(x+w-rr, y);
    ctx.arcTo(x+w, y, x+w, y+rr, rr);
    ctx.lineTo(x+w, y+h);
    ctx.lineTo(x, y+h);
    ctx.closePath();
  };

  function frame(now){
    const p = Math.min(1, (now - t0)/dur);
    const e = easeOutCubic(p);

    // خلفية + خط أساس
    ctx.save();
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;

    ctx.beginPath(); ctx.moveTo(padX, axisY + 0.5); ctx.lineTo(W - padX, axisY + 0.5); ctx.stroke();

    pairs.forEach((d,i)=>{
      const fullH = Math.round((d.value / max) * (H - padY*2));
      const h = Math.max(1, Math.round(fullH * e));
      const x = startX + i*(bw+gap);
      const y = axisY - h;

      // تدرّج + ظل
 const grad = ctx.createLinearGradient(0, y, 0, y+h);
 const isGirls = /بنات/.test(d.label);
 grad.addColorStop(0, isGirls ? pal.dau1 : pal.son1);
 grad.addColorStop(1, isGirls ? pal.dau2 : pal.son2);

      ctx.fillStyle = grad;
      ctx.shadowColor = hexToRgba(isGirls ? pal.dau2 : pal.son2, 0.18);

      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      roundedBar(x, y, bw, h, Math.min(10, bw*0.25));
      ctx.fill();

      // الرقم بقناع أبيض خفيف
 // الرقم داخل كبسولة عالية التباين
const totalLabel = String(d.value);
const labelY = (h > 18) ? (y - 8) : Math.max(18, y - 8);
ctx.save();
ctx.shadowColor = 'transparent';   // لا ظلال للنص
drawPillLabel(ctx, x + bw/2, labelY, totalLabel, pal);
ctx.restore();

      // التسمية
      ctx.fillText(d.label, x + bw/2, H - 6);
    });

    ctx.restore();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* =========================
   4) مخطط مكدّس: أبناء/بنات لكل عائلة
========================= */
// مخطط مكدّس: أبناء/بنات لكل عائلة — نسخة أجمل دون تغيير السلوك
function drawStackedFamilies(cv, rows, { sort='total', topN=20 } = {}){
  const ctx = cv.getContext('2d', { alpha: true });
  const { logicalW: W, logicalH: H, ratio } = scaleCanvasForDPR(cv, ctx);

  // حمّل لوحة الألوان للدالة
  const pal = getPalette(cv);

  // خلفية منسجمة مع البطاقة
  const bg = pal.bg;


  // تنظيف
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);
  ctx.restore();

  // تجهيز البيانات + الترتيب
  const data = rows.map(r => ({
    label: r.label,
sons: Number(r.rootSons)||0,
daughters: Number(r.rootDaughters)||0,

total: (Number(r.rootSons)||0) + (Number(r.rootDaughters)||0)
  }));

  data.sort((a,b)=>{
    if (sort === 'sons')      return (b.sons - a.sons) || (b.total - a.total);
    if (sort === 'daughters') return (b.daughters - a.daughters) || (b.total - a.total);
    return b.total - a.total;
  });

  const list   = data.slice(0, Math.max(1, topN));

  // أبعاد
  const pad    = 28;
  const axisY  = H - pad;
  const maxVal = Math.max(1, ...list.map(d => d.total));
  const bw     = Math.max(16, Math.min(64, (W - pad*2) / Math.max(1, list.length*1.3)));
  const gap    = Math.max(8, Math.floor(bw * 0.32));
  const totalW = list.length*bw + (list.length-1)*gap;
  const startX = Math.max(pad, (W - totalW)/2);

  // شبكة خفيفة + خط أساس محاذى بنصف بكسل
ctx.strokeStyle = pal.grid;

  ctx.lineWidth = 1;

  // خطوط أفقية 25%/50%/75%
  const gyCount = 3;
  for (let i=1;i<=gyCount;i++){
    const y = pad + ((H - pad*2) * i/ (gyCount+1));
    ctx.beginPath(); ctx.moveTo(pad, y + 0.5); ctx.lineTo(W - pad, y + 0.5); ctx.stroke();
  }

  // خط الأساس
  ctx.beginPath(); ctx.moveTo(pad, axisY + 0.5); ctx.lineTo(W - pad, axisY + 0.5); ctx.stroke();

  // نصوص
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '12px system-ui';

  // أدوات مساعدة
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const dur = 420;
  const t0 = performance.now();

  // مستطيل بزوايا علوية دائرية لجزء البنات فقط
function roundTopRect(x, y, w, h, r){
  const rr = Math.max(0, Math.min(r, w/2, h));
  if (h <= 0 || w <= 0 || rr <= 0) { // مسار آمن
    ctx.beginPath();
    ctx.rect(x, y, w, Math.max(0, h));
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}


  function frame(now){
    const p = Math.min(1, (now - t0)/dur);
    const e = easeOutCubic(p);

    // إعادة رسم الخلفية والخط الأساسي في كل إطار
    ctx.save();
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    // شبكة
    for (let i=1;i<=gyCount;i++){
      const y = pad + ((H - pad*2) * i/ (gyCount+1));
      ctx.beginPath(); ctx.moveTo(pad, y + 0.5); ctx.lineTo(W - pad, y + 0.5); ctx.stroke();
    }
    // خط الأساس
    ctx.beginPath(); ctx.moveTo(pad, axisY + 0.5); ctx.lineTo(W - pad, axisY + 0.5); ctx.stroke();

    list.forEach((d,i)=>{
      const x    = startX + i*(bw+gap);
// احسب الارتفاعات ثم ثبّت أنها ≥ 0
const hTot = Math.round((d.total / maxVal) * (H - pad*2) * e);
let hS = Math.round((d.sons / Math.max(1, d.total)) * hTot);
let hD = hTot - hS;

// تصحيح تقريبات قد تولّد قيمًا سالبة
if (hS < 0) hS = 0;
if (hD < 0) hD = 0;

// الأبناء في الأسفل، البنات في الأعلى
const yS = axisY - hS;
const yD = yS - hD;

      // البنات — تدرّج بنفسجي + ظل
// الأبناء — في الأسفل
const gradS = ctx.createLinearGradient(0, yS, 0, yS+hS);
gradS.addColorStop(0, pal.son1);
gradS.addColorStop(1, pal.son2);

ctx.fillStyle = gradS;
ctx.shadowColor = hexToRgba(pal.son2, 0.18);

ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
ctx.fillRect(x, yS, bw, hS);

// البنات — في الأعلى بزوايا دائرية
const gradD = ctx.createLinearGradient(0, yD, 0, yD + hD);
gradD.addColorStop(0, pal.dau1);
gradD.addColorStop(1, pal.dau2);

ctx.fillStyle = gradD;
ctx.shadowColor = hexToRgba(pal.dau2, 0.18);

ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;

// إن كان الارتفاع صغيرًا، ارسم مستطيلاً عاديًا
const rTop = Math.max(0, Math.min(12, bw * 0.33, hD));
if (hD <= 0) {
  // لا شيء للرسم
} else if (rTop < 0.5) {
  ctx.fillRect(x, yD, bw, hD);
} else {
  roundTopRect(x, yD, bw, hD, rTop);
  ctx.fill();
}

// الرقم الكلي داخل كبسولة عالية التباين
const totalLabel = String(d.total);
const yTop = Math.min(yS, yD);
const labelY = (hTot > 18) ? (yTop - 6) : Math.max(12, yTop - 6);
ctx.save();
ctx.shadowColor = 'transparent';
drawPillLabel(ctx, x + bw/2, labelY, totalLabel, pal);
ctx.restore();


      // تسمية العمود (مقطوعة إن طالت)
      const lbl = d.label.length > 10 ? d.label.slice(0,10) + '…' : d.label;
      ctx.fillText(lbl, x + bw/2, H - 6);
    });

    // أسطورة صغيرة داخل الكانفا
    const legendX = W - pad - 120, legendY = pad + 6, box = 10, gapY = 16;
    ctx.textAlign = 'left'; ctx.font = '12px system-ui'; ctx.textBaseline = 'middle';
// بنت
ctx.fillStyle = pal.dau2; ctx.fillRect(legendX, legendY, box, box);
ctx.fillStyle = pal.text; ctx.fillText('بنات', legendX + box + 6, legendY + box/2);
// ابن
ctx.fillStyle = pal.son2; ctx.fillRect(legendX, legendY + gapY, box, box);
ctx.fillStyle = pal.text; ctx.fillText('أبناء', legendX + box + 6, legendY + gapY + box/2);

    ctx.restore();
    if (p < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/* =========================
   5) Excel: توليد وتنزيل
========================= */

function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function toExcelHtml(rows, meta = {}){
  const stamp         = meta.stamp || new Date().toLocaleString('ar');
  const scopeText     = meta.scopeText || 'كل العائلات';
  const filters       = Array.isArray(meta.filters) ? meta.filters : [];
  const clans         = Array.isArray(meta.clans) ? meta.clans : [];
  const familiesCount = Number(meta.familiesCount ?? (rows?.length || 0));

  // ===== جدول العائلات =====
  const head = [
    'العائلة','الأشخاص','أبناء (صاحب الشجرة)','بنات (صاحب الشجرة)',
    'الإجمالي (أبناء+بنات)','الزوجات','غير محدد'
  ];

  const trHead = `<tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;

  const trBody = (rows || []).map(f => `
    <tr>
      <td class="txt">${escapeHtml(f.label)}</td>
      <td class="num">${Number(f.persons||0)}</td>
      <td class="num">${Number(f.rootSons||0)}</td>
      <td class="num">${Number(f.rootDaughters||0)}</td>
      <td class="num">${Number(f.rootSons||0) + Number(f.rootDaughters||0)}</td>
      <td class="num">${Number(f.wives||0)}</td>
      <td class="num">${Number(f.unknown||0)}</td>
    </tr>
  `).join('');

  const totals = (rows || []).reduce((acc, f) => {
    acc.persons       += Number(f.persons||0);
    acc.rootSons      += Number(f.rootSons||0);
    acc.rootDaughters += Number(f.rootDaughters||0);
    acc.totalKids     += (Number(f.rootSons||0) + Number(f.rootDaughters||0));
    acc.wives         += Number(f.wives||0);
    acc.unknown       += Number(f.unknown||0);
    return acc;
  }, { persons:0, rootSons:0, rootDaughters:0, totalKids:0, wives:0, unknown:0 });

  const trTotal = `
    <tr class="total">
      <td class="txt">الإجمالي</td>
      <td class="num">${totals.persons}</td>
      <td class="num">${totals.rootSons}</td>
      <td class="num">${totals.rootDaughters}</td>
      <td class="num">${totals.totalKids}</td>
      <td class="num">${totals.wives}</td>
      <td class="num">${totals.unknown}</td>
    </tr>
  `;

  // ===== جدول العشائر =====
  const clansHead   = ['العشيرة','الأشخاص','الذكور','الإناث','غير محدد'];
  const trClansHead = `<tr>${clansHead.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;

  const trClansBody = (clans || []).map(c => `
    <tr>
      <td class="txt">${escapeHtml(c.clan)}</td>
      <td class="num">${Number(c.persons||0)}</td>
      <td class="num">${Number(c.males||0)}</td>
      <td class="num">${Number(c.females||0)}</td>
      <td class="num">${Number(c.unknownGender||0)}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">لا بيانات</td></tr>`;

  const clansTotals = (clans || []).reduce((a, c) => {
    a.persons       += Number(c.persons||0);
    a.males         += Number(c.males||0);
    a.females       += Number(c.females||0);
    a.unknownGender += Number(c.unknownGender||0);
    return a;
  }, { persons:0, males:0, females:0, unknownGender:0 });

  const trClansTotal = `
    <tr class="total">
      <td class="txt">الإجمالي</td>
      <td class="num">${clansTotals.persons}</td>
      <td class="num">${clansTotals.males}</td>
      <td class="num">${clansTotals.females}</td>
      <td class="num">${clansTotals.unknownGender}</td>
    </tr>
  `;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
body{font-family:'Cairo',system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;margin:16px;font-size:18px;}
table,th,td{font-family:inherit;}
.title{font-size:24px;font-weight:800;margin:0 0 6px 0;padding-right:16px;}
.section{font-size:20px;font-weight:800;margin:14px 0 8px;padding-right:16px;}
.meta{color:#6b7280;font-size:18px;margin:0 0 6px 0;padding-right:16px;}

table.xl-table{border-collapse:collapse;width:90%;direction:rtl;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 0 auto;}
th,td{overflow:hidden;text-overflow:ellipsis;border:1px solid #d0d7de;padding:10px 12px;vertical-align:middle;font-size:16px;}
th{background:#f3f4f6;font-weight:700;white-space:nowrap;text-align:center;font-size:16px;}
td.txt{text-align:right;}
td.num{text-align:center;mso-number-format:"0";}
tbody tr:nth-child(even){background:#fafafa;}
.total td{background:#eef2ff;font-weight:700;}
.empty{color:#6b7280;text-align:center;}

table.xl-spacer{border-collapse:collapse;width:90%;direction:rtl;table-layout:fixed;margin:0 0 0 auto;}
table.xl-spacer td{border:none;height:24pt;}
table.xl-wrap{border-collapse:collapse;width:100%;direction:rtl;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;}
.title,.section,.meta{text-align:right;padding-right:16px;padding-left:0;}
</style>
</head>
<body>

<table class="xl-wrap" width="100%" style="width:100%;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">
  <tr>
    <td align="right" style="width:100%;text-align:right;direction:rtl;">
      <div class="title">تقرير إحصاءات العائلات</div>
      <div class="meta">تاريخ التصدير: ${escapeHtml(stamp)}</div>
      <div class="meta">النطاق: ${escapeHtml(scopeText)}</div>
      <div class="meta">عدد العائلات: ${escapeHtml(familiesCount)}</div>
      ${filters.length ? `<div class="meta">الفلاتر: ${escapeHtml(filters.join(' | '))}</div>` : ''}

      <div class="section">تفصيل حسب العائلة</div>
      <table class="xl-table" width="90%" align="right" style="width:90%;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <colgroup>
          <col style="width:22%"><!-- العائلة -->
          <col style="width:11%"><!-- الأشخاص -->
          <col style="width:12%"><!-- أبناء (صاحب الشجرة) -->
          <col style="width:12%"><!-- بنات (صاحب الشجرة) -->
          <col style="width:15%"><!-- الإجمالي -->
          <col style="width:14%"><!-- الزوجات -->
          <col style="width:14%"><!-- غير محدد -->
        </colgroup>
        <thead>${trHead}</thead>
        <tbody>${trBody}${trTotal}</tbody>
      </table>

      <table class="xl-spacer" width="90%" align="center" style="width:90%;"><tr><td>&nbsp;</td></tr></table>

      <div class="section">تفاصيل العشائر</div>
      <table class="xl-table" width="90%" align="right" style="width:90%;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <colgroup>
          <col style="width:28%"><!-- العشيرة -->
          <col style="width:18%"><!-- الأشخاص -->
          <col style="width:18%"><!-- الذكور -->
          <col style="width:18%"><!-- الإناث -->
          <col style="width:18%"><!-- غير محدد -->
        </colgroup>
        <thead>${trClansHead}</thead>
        <tbody>${trClansBody}${clans.length ? trClansTotal : ''}</tbody>
      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

function downloadExcelHtml(filename, html){
  const bom  = '\ufeff'; // UTF-8 BOM لتحسين العربية في Excel
  const blob = new Blob([bom + html], { type:'application/vnd.ms-excel;charset=utf-8' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'families-stats.xls';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function buildExportRows(rows){
  const sort = byId('fSort')?.value || 'total';
  const sorters = {
    total:     (a,b) => ((b.rootSons + b.rootDaughters) - (a.rootSons + a.rootDaughters)),
    sons:      (a,b) => (b.rootSons - a.rootSons),
    daughters: (a,b) => (b.rootDaughters - a.rootDaughters),
  };
  return (rows || []).slice().sort(sorters[sort] || sorters.total);
}

function buildExportMeta(){
  const stamp = new Date().toLocaleString('ar');

  const scopeSel = byId('fScope');
  const scopeVal = scopeSel?.value || 'all';
  let scopeText  = scopeSel?.selectedOptions?.[0]?.textContent || 'كل العائلات';

  // إذا لم يكن "كل العائلات" → أضف كلمة "عائلة"
  if ((scopeVal || 'all') !== 'all') scopeText = `عائلة ${scopeText}`;

  const q   = String(byId('fSearch')?.value || '').trim();
  const min = Math.max(0, parseInt(byId('fMin')?.value || '0', 10) || 0);

  const filters = [];
  if (q)   filters.push(`بحث: ${q}`);
  if (min) filters.push(`حد أدنى للأشخاص: ${min}`);

  return { stamp, scopeVal, scopeText, filters };
}

function buildExportClansFromRows(rows, computeStatsCachedFn){
  const keys = Array.from(new Set((rows || []).map(r => r.familyKey).filter(Boolean)));
  if (!keys.length) return [];

  // نستخدم cache إن كانت متاحة، وإلا fallback لـ computeStats مباشرة
  const clanStats = (typeof computeStatsCachedFn === 'function')  ? computeStatsCachedFn(keys, { uniqueAcrossFamilies:false, diagnostics:true })
    : computeStats(keys, { uniqueAcrossFamilies:false, diagnostics:true });

  return Array.from((clanStats.perClan || new Map()).values())
    .map(v => ({
      clan: v.label || '',
      persons: Number(v.persons||0),
      males: Number(v.males||0),
      females: Number(v.females||0),
      unknownGender: Number(v.unknownGender||0),
    }))
    .sort((a,b) => b.persons - a.persons);
}


/* =========================
   6) واجهة العرض + الفلاتر
========================= */
const pct = (x, n)=>{ n = Math.max(1, +n||0); x = Math.max(0, +x||0); return (Math.round((x/n)*1000)/10).toFixed(1); };
// تطبيع بسيط للاسم العربي لبحث الإحصاءات
const ST_AR_DIAC  = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g; // الحركات
const ST_AR_TATWL = /\u0640/g;                                          // التطويل
const ST_ALIF_ALL = /[اأإآ]/g;                                          // الألف بأشكالها
const ST_YA_MAQ   = /\u0649/g;                                          // الألف المقصورة

function normArStats(s = ''){
  return String(s)
    .normalize('NFKC')
    .replace(ST_AR_DIAC, '')
    .replace(ST_AR_TATWL, '')
    .replace(ST_ALIF_ALL, 'ا')
    .replace(ST_YA_MAQ, 'ي')
    .trim()
    .toLowerCase();
}

function renderStats(){
  const body = byId('statsBody'); if (!body) return;

  // الهيكل الثابت
  body.innerHTML = `
    <div class="stats-grid" id="stGrid"></div>

    <section class="chart-wrap">
      <header class="chart-header"><h4>ملخص: أبناء/بنات</h4></header>
      <canvas id="statsBar" class="canvas-resp"></canvas>
    </section>

    <section class="filters-wrap">
      <div class="stats-toolbar" id="stFilters">
        <div class="stats-field">
          <label for="fScope">
            <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
            <span>النطاق</span>
          </label>
          <select id="fScope" class="stats-select"></select>
        </div>

        <div class="stats-field">
          <label for="fSearch">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <span>بحث العائلة</span>
          </label>
          <input id="fSearch" class="stats-input" type="search" placeholder="اكتب اسم العائلة">
        </div>

        <div class="stats-field">
          <label for="fClan">
            <i class="fa-solid fa-users" aria-hidden="true"></i>
            <span>العشيرة</span>
          </label>
          <select id="fClan" class="stats-select"><option value="">الكل</option></select>
        </div>

            <div class="stats-field">
          <label for="fMin">
            <i class="fa-solid fa-user-group" aria-hidden="true"></i>
            <span>حد أدنى للأشخاص</span>
          </label>
          <input id="fMin" class="stats-input" type="number" min="0" step="1" value="0">
        </div>


        <div class="stats-field">
          <label for="fSort">
            <i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>
            <span>ترتيب</span>
          </label>
          <select id="fSort" class="stats-select">
            <option value="total">الإجمالي</option>
            <option value="sons">الأبناء</option>
            <option value="daughters">البنات</option>
          </select>
        </div>

        <div class="stats-field">
          <label for="fTopN">
            <i class="fa-solid fa-table-columns" aria-hidden="true"></i>
            <span>عدد الأعمدة</span>
          </label>
          <select id="fTopN" class="stats-select">
            <option>10</option><option selected>20</option><option>30</option><option>50</option>
          </select>
        </div>

   <button id="btnExportExcel" class="btn primary" type="button" title="تصدير Excel">
  <i class="fa-solid fa-file-export" aria-hidden="true"></i>
  <span>تصدير Excel</span>
</button>

      </div>
    </section>


    <section class="chart-wrap">
      <header class="chart-header"><h4>مخطط مكدّس لكل عائلة</h4></header>
      <canvas id="statsStacked" class="canvas-resp tall"></canvas>
    </section>

    <section class="table-wrap">
      <h4>تفصيل حسب العائلة</h4>
      <div class="table-scroll">
  <table class="stats-table" id="stTable">
  <thead><tr>
    <th>العائلة</th><th>الأشخاص</th><th>أبناء</th><th>بنات</th><th>زوجات</th><th>غير محدد</th><th>التكرار</th>
  </tr></thead>
  <tbody></tbody>
</table>

      </div>
    </section>

    <section class="table-wrap">
      <h4>تفاصيل العشائر</h4>
      <div class="table-scroll">
   <table class="stats-table" id="stClans">
  <thead><tr><th>العشيرة</th><th>الأشخاص</th><th>الذكور</th><th>الإناث</th><th>غير محدد</th></tr></thead>
  <tbody></tbody>
</table>

      </div>
    </section>
  `;

let sAll = computeStats(null, { uniqueAcrossFamilies:false, diagnostics:true }); // الافتراضي مستقل لكل عائلة
const selScope = byId('fScope');
const fams     = Model.getFamilies();

// === إحصائيات التكرار لجميع العائلات (من وحدة duplicates) ===
let dupStatusAll = getDuplicatesStatusForAllFamilies();
let dupMap = new Map(dupStatusAll.map(d => [d.famKey, d]));

const severityOrder = ['none','low','medium','high'];
const severityLabel = sev => {
  if (sev === 'low')    return 'منخفض';
  if (sev === 'medium') return 'متوسط';
  if (sev === 'high')   return 'عالٍ';
  return 'لا يوجد';
};

const buildDupAgg = (list)=>{
  const totalDupPersonsAll = list.reduce((sum, d) => sum + (d.totalDuplicatePersons || 0), 0);
  const totalPersonsAll    = list.reduce((sum, d) => sum + (d.totalPersons || 0), 0);
  const dupRatioAll        = totalPersonsAll > 0 ? (totalDupPersonsAll / totalPersonsAll) : 0;

  return {
    familiesWithDup: list.filter(d => d.count > 0).length,
    worstSeverity: list.reduce(
      (max, d) => severityOrder.indexOf(d.severity) > severityOrder.indexOf(max) ? d.severity : max,
      'none'
    ),
    totalPersonsAll,
    totalDupPersonsAll,
    dupRatioAll
  };
};

let dupAgg = buildDupAgg(dupStatusAll);

// إعادة حساب موحدة عند تغيّر البيانات أثناء بقاء نافذة الإحصاءات مفتوحة
const recomputeAll = ()=>{
  _statsCache.clear();
  sAll = computeStats(null, { uniqueAcrossFamilies:false, diagnostics:true });
  dupStatusAll = getDuplicatesStatusForAllFamilies();
  dupMap = new Map(dupStatusAll.map(d => [d.famKey, d]));
  dupAgg = buildDupAgg(dupStatusAll);

  renderSummary(getScopedStats(), dupAgg);
  applyFilters();
};

// نافذة صغيرة لمراجعة تكرارات عائلة معيّنة
const openDuplicatesPanelForFamily = famKey => {
  if (!famKey) return;
  const fam   = fams[famKey];
  const label = (fam?.familyName || fam?.title || fam?.rootPerson?.name || famKey || '').trim();

  let summary;
  try{ summary = getDuplicateSummary(famKey); }catch{ summary = null; }

  let panel = document.getElementById('dupPanel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'dupPanel';
  panel.className = 'dup-panel';

  const count    = summary?.count || 0;
  const groups   = Array.isArray(summary?.groups) ? summary.groups : [];
  const maxGroup = summary?.maxGroupSize || 0;
  const severity = summary?.severity || 'none';
  const sevText  = severityLabel(severity);

  if (!count){
    panel.innerHTML = `
      <div class="dup-panel-header">
        <h3>مراجعة التكرارات</h3>
        <button type="button" class="dup-panel-close close-button" aria-label="إغلاق">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dup-panel-body">
        <p class="dup-empty">لا توجد مجموعات تكرار محتملة في هذه العائلة (${label}).</p>
      </div>
    `;
  } else {
    const totalDupPersons = summary.totalDuplicatePersons || 0;
    const totalPersons    = summary.totalPersons || 0;
    const ratioPct        = totalPersons > 0 ? pct(totalDupPersons, totalPersons)
      : '0.0';

    const strongGroups = summary.strongGroupsCount || 0;
    const mediumGroups = summary.mediumGroupsCount || 0;
    const weakGroups   = summary.weakGroupsCount || 0;

    panel.innerHTML = `
      <div class="dup-panel-header">
        <h3>مراجعة التكرارات في عائلة: ${label}</h3>
        <button type="button" class="dup-panel-close close-button" aria-label="إغلاق">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dup-panel-body">
        <div class="dup-summary">
          <span>عدد مجموعات التكرار: <strong>${count}</strong></span>
          <span>أكبر مجموعة: <strong>${maxGroup}</strong> شخص/أشخاص</span>
          <span>مستوى الخطورة: <strong>${sevText}</strong></span>
          <span>أشخاص متكرّرون (تقريبًا): <strong>${totalDupPersons}</strong> من أصل <strong>${totalPersons}</strong></span>
          <span>نسبة التكرار: <strong>${ratioPct}%</strong></span>
          <span>توزيع المجموعات: 
            <strong>قوي: ${strongGroups}</strong> /
            <strong>متوسط: ${mediumGroups}</strong> /
            <strong>ضعيف: ${weakGroups}</strong>
          </span>
        </div>
           <div class="dup-groups">
          ${
            groups.map((grp, idx) => {
              const members = Array.isArray(grp?.members) ? grp.members : [];
              const size    = members.length;
              const reason  = grp?.groupReason?.text || '';
              const sev     = severityLabel(grp?.severity || 'none');

              return `
                <section class="dup-group">
                  <header class="dup-group-header">
                    <h4>مجموعة ${idx + 1}</h4>
                    <span class="dup-group-size">${size} شخص/أشخاص</span>
                    <span class="dup-group-severity">الخطورة: ${sev}</span>
                    ${reason ? `<span class="dup-group-reason">${reason}</span>` : ''}
                  </header>
                  <table class="dup-group-table">
                    <thead>
                      <tr>
                        <th>الاسم</th>
                        <th>الدور</th>
                        <th>نوع التكرار</th>
                        <th>درجة التطابق</th>
                        <th>سبب الاشتباه</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        members.map(p => `
                          <tr>
                            <td>${p.name || ''}</td>
                            <td>${p.role || ''}</td>
                            <td>${p.dupType || ''}</td>
                            <td>${p.dupScoreLabel || ''}</td>
                            <td>${p.reasonLabel || ''}</td>
                          </tr>
                        `).join('')
                      }
                    </tbody>
                  </table>
                </section>
              `;
            }).join('')
          }
        </div>

      </div>
    `;
  }

  const host =
    document.querySelector('.statsModal .modal-content') || // ← داخل modal-content مباشرة
    byId('statsBody') ||
    byId('statsModal') ||
    document.body;

host.appendChild(panel);

// إغلاق عند النقر على زر الإغلاق أو خارج جسم اللوحة
const closeBtn = panel.querySelector('.dup-panel-close');

const handleClose = () => {
  panel.remove();
  host.removeEventListener('click', handleOutsideClick);
};

const handleOutsideClick = (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // إذا كان النقر داخل اللوحة نفسها → لا تغلق
  if (panel.contains(target)) return;

  // إذا كان النقر على خلية "التكرار" التي تفتح اللوحة → تجاهل هذا الحدث
  if (target.closest('.st-dup-cell')) return;

  handleClose();
};

if (closeBtn) {
  closeBtn.addEventListener('click', handleClose);
}

// النقر في أي مكان داخل host (modal-content أو statsBody...) خارج اللوحة يغلقها
host.addEventListener('click', handleOutsideClick);

};

// تعبئة النطاق: "كل العائلات" + المرئية فقط
if (selScope){
  selScope.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'all'; optAll.textContent = 'كل العائلات';
  selScope.appendChild(optAll);

  for (const key of Object.keys(fams)){
    const f = fams[key];
    if (f?.hidden === true) continue; // ← استبعاد المخفية
    const label = (f?.familyName || f?.title || f?.rootPerson?.name || key || '').trim();
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = label || key;
    selScope.appendChild(opt);
  }
  selScope.value = 'all'; // النطاق الافتراضي = الكل
}


  // مراجع عناصر متكررة
  const cvBar     = byId('statsBar');
  const selClan   = byId('fClan');
  const tbFam     = byId('stTable').querySelector('tbody');
  const tbClan    = byId('stClans').querySelector('tbody');

  // النقر على خلية "التكرار" يختار العائلة ويفتح نافذة مراجعة التكرارات الصغيرة
  if (tbFam){
    tbFam.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const cell = target.closest('td');
      const row  = target.closest('tr[data-fam-key]');
      if (!row || !cell) return;
      if (!cell.classList.contains('st-dup-cell')) return;

      const famKey = row.getAttribute('data-fam-key') || '';
      if (!famKey) return;

      // اختيار هذه العائلة في واجهة العائلات (إن وُجد الباص)
      if (_ctx && _ctx.bus && typeof _ctx.bus.emit === 'function'){
        _ctx.bus.emit('families:select', { famKey });
      }

      // فتح نافذة مراجعة التكرارات داخل لوحة الإحصاءات
      openDuplicatesPanelForFamily(famKey);
    });
  }


  const inpSearch = byId('fSearch');
  const inpMin    = byId('fMin');
  const selSort   = byId('fSort');
  const selTopN   = byId('fTopN');
  const cvStack   = byId('statsStacked');
  let _exportRows = null;

const getScopedStats = ()=>{
  const scopeVal = selScope?.value || 'all';
  return (scopeVal !== 'all') ? computeStats(scopeVal, { uniqueAcrossFamilies:false, diagnostics:true })
    : sAll;
};

// (6) Cache بسيط لحساب computeStats على مجموعة مفاتيح + نفس opts
const _statsCache = new Map();

const cacheKeyFor = (keys, opts)=>{
  const k = Array.isArray(keys) ? keys.slice().sort().join('|') : String(keys || '');
  const o = opts ? JSON.stringify({
    uniqueAcrossFamilies: !!opts.uniqueAcrossFamilies,
    diagnostics: !!opts.diagnostics,
    excludeVirtualRoles: !!opts.excludeVirtualRoles,
    coreRolesOnly: !!opts.coreRolesOnly
  }) : '';
  return `${k}::${o}`;
};

const computeStatsCached = (keys, opts)=>{
  const ck = cacheKeyFor(keys, opts);
  const hit = _statsCache.get(ck);
  if (hit) return hit;
  const out = computeStats(keys, opts);
  _statsCache.set(ck, out);
  return out;
};

// (6) Debounce لمدخلات البحث والحد الأدنى
const debounce = (fn, ms=200)=>{
  let t = null;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=> fn(...args), ms);
  };
};

  // بطاقات الملخص + شريط أبناء/بنات + ملخص التكرارات
  const renderSummary = (stats, dupAgg)=>{
    const grid = byId('stGrid');

    const items = [
      ['عدد العائلات',            stats.familiesCount,       'fa-people-roof'],
      ['جميع الأشخاص',            stats.persons,             'fa-users'],
      ['الزوجات',                 stats.wives,               'fa-person-dress'],
        ['الأبناء',                 stats.rootSons,            'fa-person'],
      ['البنات',                  stats.rootDaughters,       'fa-person-dress'],

      ['غير محدد',                stats.unknown,             'fa-user-large-slash'],
      ['متوسط الأبناء/عائلة',     stats.avgChildren,         'fa-chart-column'],
      ['متوسط الأبناء/جذر فعّال', stats.avgChildrenPerRoot,  'fa-chart-line'],
      ['توفر الميلاد',            `${pct(stats.persons - stats.missing.birthInfo, stats.persons)}%`, 'fa-cake-candles'],
      ['توفر العشيرة',            `${pct(stats.persons - stats.missing.clan, stats.persons)}%`,       'fa-people-group'],
      ['توفر الصورة',             `${pct(stats.persons - stats.missing.photoAny, stats.persons)}%`,   'fa-image'],
      ['أشخاص بلا معرّف', `${pct(stats.missing.missingIdsCount, stats.persons)}%`, 'fa-fingerprint'],


      // === بطاقات التكرارات باستخدام الحقول الجديدة ===
      ['عائلات فيها تكرار',       dupAgg.familiesWithDup,      'fa-clone'],
      [
        'نسبة التكرار الإجمالية',
        `${pct(dupAgg.totalDupPersonsAll, dupAgg.totalPersonsAll)}%`,
        'fa-percent'
      ],
      ['أعلى مستوى تكرار',        severityLabel(dupAgg.worstSeverity), 'fa-triangle-exclamation']
    ];

    grid.innerHTML = items.map(([label, value, icon]) => `
      <div class="stat-card">
        <h4>
          <i class="fa-solid ${icon}" aria-hidden="true"></i>
          <span>${label}</span>
        </h4>
        <div class="stat-value">${value}</div>
      </div>
    `).join('');

    requestAnimationFrame(()=> drawBars(cvBar, [
      { label:'أبناء',  value:stats.rootSons },
      { label:'بنات',   value:stats.rootDaughters }
    ]));

  };

  // تطبيق الفلاتر + رسم المكدّس + جدول العائلات + تفاصيل العشائر
  const applyFilters = ()=>{
    const s      = getScopedStats();              // إحصاءات النطاق (ثابتة للبطاقات)
    const qRaw   = String(inpSearch.value || '');
    const qNorm  = normArStats(qRaw);
    const min    = Math.max(0, parseInt(inpMin.value||'0',10) || 0);
    const sort   = selSort.value;
    const topN   = Math.max(1, parseInt(selTopN.value||'20',10) || 20);

    let rows = s.perFamily.slice();

    // فلتر اسم العائلة بتطبيع عربي (إزالة الحركات والتطويل وتوحيد الألف)
    if (qNorm){
      rows = rows.filter(r => normArStats(r.label).includes(qNorm));
    }

    // حد أدنى لعدد الأشخاص
    if (min){
      rows = rows.filter(r => (r.persons || 0) >= min);
    }
    // ملاحظة: فلتر العشيرة التفصيلي لكل عائلة يمكن إضافته لاحقًا

    // 1) مخطط مكدّس لكل عائلة (يتأثر بالفلتر)
    requestAnimationFrame(()=> drawStackedFamilies(cvStack, rows, { sort, topN }));

    // 2) جدول "تفصيل حسب العائلة" (يتأثر بالفلتر)
const sorters = {
  total:     (a,b)=> ((b.rootSons + b.rootDaughters) - (a.rootSons + a.rootDaughters)),
  sons:      (a,b)=> (b.rootSons - a.rootSons),
  daughters: (a,b)=> (b.rootDaughters - a.rootDaughters)
};
rows.sort(sorters[sort] || sorters.total);
_exportRows = rows.slice();

    tbFam.innerHTML = rows.length ? rows.map(f => {
      const dup = dupMap.get(f.familyKey);
      if (!dup || !dup.count) {
        return `
          <tr data-fam-key="${f.familyKey || ''}">
            <td>${f.label}</td>
            <td>${f.persons}</td>
          <td>${f.rootSons}</td>
<td>${f.rootDaughters}</td>

            <td>${f.wives}</td>
            <td>${f.unknown}</td>
            <td class="st-dup-cell">
              <div class="st-dup-main">لا يوجد</div>
            </td>
          </tr>
        `;
      }

      const sev      = dup.severity || 'none';
      const sevText  = severityLabel(sev);
      const ratioPct = dup.totalPersons ? pct(dup.totalDuplicatePersons || 0, dup.totalPersons)
        : '0.0';

      const strongGroups = dup.strongGroupsCount || 0;
      const mediumGroups = dup.mediumGroupsCount || 0;
      const weakGroups   = dup.weakGroupsCount || 0;
      const reviewedMark = dup.isReviewed ? '✓ مُراجَع' : 'غير مُراجَع';

      return `
        <tr data-fam-key="${f.familyKey || ''}">
          <td>${f.label}</td>
          <td>${f.persons}</td>
         <td>${f.rootSons}</td>
<td>${f.rootDaughters}</td>

          <td>${f.wives}</td>
          <td>${f.unknown}</td>
          <td class="st-dup-cell">
            <div class="st-dup-main">${sevText}</div>
      <div class="st-dup-sub">
  <span class="st-dup-pill st-dup-pill--ratio" title="نسبة الأشخاص الذين يظهرون ضمن مجموعات تكرار محتملة في هذه العائلة.">${ratioPct}% من الأشخاص</span>
  <span class="st-dup-badge st-dup-badge--strong" title="قوي: تشابه مرتفع جدًا (احتمال تكرار كبير).">قوي: ${strongGroups}</span>
  <span class="st-dup-badge st-dup-badge--medium" title="متوسط: تشابه متوسط (يحتاج مراجعة سريعة).">متوسط: ${mediumGroups}</span>
  <span class="st-dup-badge st-dup-badge--weak" title="ضعيف: تشابه ضعيف">ضعيف: ${weakGroups}</span>
  <span class="st-dup-pill st-dup-pill--review" title="هل تم وضع علامة المراجعة للتكرارات في هذه العائلة؟">${reviewedMark}</span>
</div>
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="7" class="empty">لا بيانات</td></tr>`;

    // 3) تفاصيل العشائر (تُعاد من العائلات المفلترة فقط)
    const filteredKeys = Array.from(new Set(
      rows.map(r => r.familyKey).filter(Boolean)
    ));

    let clanStats;
    if (!qNorm && !min){
      // لا يوجد فلتر → استخدم إحصاءات النطاق كما هي
      clanStats = s;
    } else if (filteredKeys.length){
      // فلتر مفعّل → أعِد حساب الإحصاءات لهذه العائلات فقط
clanStats = computeStatsCached(filteredKeys, { uniqueAcrossFamilies:false, diagnostics:true });
    } else {
      // لا توجد عائلات بعد الفلتر
      clanStats = { perClan: new Map() };
    }

    selClan.innerHTML = `<option value="">الكل</option>`;
const clansArr = Array.from((clanStats.perClan || new Map()).entries())
  .map(([key, v]) => ({ clan: v.label || key, persons: v.persons || 0, key }))
  .sort((a,b)=> (b.persons - a.persons));

    for (const c of clansArr){
      const opt = document.createElement('option');
      opt.value = c.clan;
      opt.textContent = `${c.clan} (${c.persons})`;
      selClan.appendChild(opt);
    }

const top = clansArr.slice(0, 12);
tbClan.innerHTML = top.length ? top.map(c=>{
  const v = clanStats.perClan.get(c.key) || { persons:0, males:0, females:0, unknownGender:0 };
  return `<tr><td>${c.clan}</td><td>${v.persons||0}</td><td>${v.males||0}</td><td>${v.females||0}</td><td>${v.unknownGender||0}</td></tr>`;
}).join('') : `<tr><td colspan="5" class="empty">لا بيانات</td></tr>`;

  };
  const applyFiltersDebounced = debounce(applyFilters, 200);

    // ===== (4) إعادة الحساب عند تغيّر البيانات (إذا كان لدينا bus) =====
  const statsModal = byId('statsModal');
  let offRecompute = null;

  if (_ctx?.bus?.on){
    const handler = () => {
      const shown = statsModal?.classList.contains('show');
      if (!shown) return;
      recomputeAll();
    };

    _ctx.bus.on('families:changed', handler);
    _ctx.bus.on('families:committed', handler);
    _ctx.bus.on('families:imported', handler);

    offRecompute = () => {
      try { _ctx.bus.off?.('families:changed', handler); } catch {}
      try { _ctx.bus.off?.('families:committed', handler); } catch {}
      try { _ctx.bus.off?.('families:imported', handler); } catch {}
    };
  }
    // دالة موحدة لإعادة رسم المخططات حسب النطاق الحالي + الفلاتر الحالية
  const redrawCharts = () => {
    if (!cvBar || !cvStack || !cvBar.isConnected || !cvStack.isConnected) return;

    const statsNow = getScopedStats();

    drawBars(cvBar, [
      { label: 'أبناء', value: statsNow.rootSons },
      { label: 'بنات',  value: statsNow.rootDaughters }
    ]);

    applyFilters();
  };


  // الرسم الأولي
  renderSummary(getScopedStats(), dupAgg);
  applyFilters();

  // ربط الفلاتر بدالة التحديث
  inpSearch?.addEventListener('input', applyFiltersDebounced);
  inpMin?.addEventListener('input', applyFiltersDebounced);

  selSort?.addEventListener('change', applyFilters);
  selTopN?.addEventListener('change', applyFilters);
  // (اختياري لاحقًا عند تنفيذ فلتر العشيرة):
  // selClan?.addEventListener('change', applyFilters);

  // تبديل النطاق
  selScope?.addEventListener('change', ()=>{
    renderSummary(getScopedStats(), dupAgg);
    applyFilters();
  });

// تصدير Excel (مطابق للفلاتر الحالية + ترتيب مطابق لاختيار "ترتيب" في UI)
byId('btnExportExcel')?.addEventListener('click', ()=>{
  const baseRows = _exportRows || getScopedStats().perFamily;
  const rows = buildExportRows(baseRows);

  const meta = buildExportMeta();
  meta.clans = buildExportClansFromRows(rows, computeStatsCached);

  const html = toExcelHtml(rows, meta);
  const safeDate = new Date().toISOString().slice(0,10);
  downloadExcelHtml(`families-stats_${safeDate}.xls`, html);
});

  // إعادة الرسم عند تغير الحجم
  const ro = new ResizeObserver(()=> requestAnimationFrame(redrawCharts));

    // ——— إعادة الرسم عند تغيّر النمط/الثيم ———
  const redrawAll = () => {
    redrawCharts();
  };


  // 1) تبدّل نظام الجهاز (فاتح/داكن)
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  mql?.addEventListener?.('change', redrawAll);

  // 2) تبدّل صفات الثيم على <html> (class / data-theme)
  const mo = new MutationObserver(redrawAll);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style']
  });

  // 3) قناة مخصّصة إن كان لديك زر يطلق حدثًا
  window.addEventListener('theme:change', redrawAll);

  
// تنظيف عند إغلاق نافذة الإحصاءات
// تنظيف عند إغلاق نافذة الإحصاءات
const detach = () => {
  try { offRecompute?.(); } catch {}
  try { mo.disconnect(); } catch {}
  try { mql?.removeEventListener?.('change', redrawAll); } catch {}
  try { window.removeEventListener('theme:change', redrawAll); } catch {}
  try { ro.disconnect?.(); } catch {}             
try { if (cvBar) ro.unobserve?.(cvBar); if (cvStack) ro.unobserve?.(cvStack); } catch {} // احتياطي

  try { _statsCache.clear(); } catch {} // اختياري ممتاز: تنظيف ذاكرة + يمنع stale إن لم تُستدع recomputeAll
};
 //  خزّنها ليستدعيها closeStatsModal
 if (statsModal) statsModal.__statsDetach = detach;

if (cvBar) ro.observe(cvBar);
if (cvStack) ro.observe(cvStack);

}

/* =========================
   7) إغلاق نافذة الإحصاءات
========================= */
function closeStatsModal() {
  const modal = byId('statsModal'); if (!modal) return;

  try { modal.__statsDetach?.(); } catch {}
  try { delete modal.__statsDetach; } catch {}

  modal.classList.add('hide');

  const finalizeClose = () => {
    modal.classList.remove('show','hide');

    // رجّع hidden بعد انتهاء الإغلاق
    modal.hidden = true;
    modal.setAttribute('hidden', '');

    modal.removeEventListener('animationend', finalizeClose);
    modal.removeEventListener('transitionend', finalizeClose);
  };

  modal.addEventListener('animationend', finalizeClose);
  modal.addEventListener('transitionend', finalizeClose);
  setTimeout(finalizeClose, 400);
}


/* =========================
   8) تهيئة الأزرار والروابط
========================= */
export function init(ctx){
  _ctx = ctx || null;
// إبطال pipelineReady عند تغيّر البيانات (حتى لا تصبح قديمة)
const invalidatePipeline = (famKey)=>{
  if (!famKey) return;
  const fams = Model.getFamilies();
  const f = fams?.[famKey];
  if (!f) return;
  try { delete f.__pipelineReady; } catch {}
  try { delete f.__pipelineVersion; } catch {}
};

ctx?.bus?.on?.('families:committed', (e)=> invalidatePipeline(e?.famKey));
ctx?.bus?.on?.('families:changed',   (e)=> invalidatePipeline(e?.famKey));
ctx?.bus?.on?.('families:imported',  ()=> {
  const fams = Model.getFamilies();
  for (const k of Object.keys(fams||{})) invalidatePipeline(k);
});

byId('statsBtn')?.addEventListener('click', ()=>{
  renderStats();

  const modal = byId('statsModal');
  if (!modal) return;

  // أهم سطرين
  modal.hidden = false;
  modal.removeAttribute('hidden');

  modal.classList.add('show');

  // اختياري: فوكس لتحسين الوصول
  modal.focus?.();
});


  byId('closeStats')?.addEventListener('click', closeStatsModal);
  byId('statsModal')?.addEventListener('click', e => { if (e.target.id === 'statsModal') closeStatsModal(); });

// === [إضافة جديدة تبدأ هنا] تحديث قائمة "النطاق" عند تغيّر رؤية العائلات ===
const refreshScopeOptions = () => {
  const statsModal = byId('statsModal');
  const modalShown = statsModal?.classList.contains('show');
  if (!modalShown) return;

  const selScope = byId('fScope');
  if (!selScope) return; // نافذة الإحصاءات غير مبنية/غير مفتوحة

  const fams = Model.getFamilies();

  // تذكّر الاختيار الحالي
  const prev = selScope.value || 'all';

  // أعد بناء الخيارات: "كل العائلات" + المرئية فقط
  selScope.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'all';
  optAll.textContent = 'كل العائلات';
  selScope.appendChild(optAll);

  for (const key of Object.keys(fams || {})){
    const f = fams[key];
    if (f?.hidden === true) continue;
    const label = (f?.familyName || f?.title || f?.rootPerson?.name || key || '').trim();
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label || key;
    selScope.appendChild(opt);
  }

  // أعِد الاختيار إن كان ما زال موجودًا، وإلا ارجع للكل
  const stillExists = Array.from(selScope.options).some(o => o.value === prev);
  selScope.value = stillExists ? prev : 'all';

  // أطلق حدث change لتحديث الملخص/الفلاتر باستخدام الكود الحالي في renderStats()
  selScope.dispatchEvent(new Event('change'));
};

  // استمع لتغيّر الرؤية من نظام visibility أو أي بثّ عام
ctx?.bus?.on?.('families:visibility:changed', refreshScopeOptions);
  window.addEventListener('FT_VISIBILITY_REFRESH', refreshScopeOptions);

  // اختصارات عامة
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const active = document.querySelector('.form-modal.active') || ctx.dom.bioModal;
      if (active) ctx.ModalManager.close(active);
    }
    if (e.key === '/') { e.preventDefault(); byId('quickSearch')?.focus(); }
  });

  return { computeStats, renderStats };
  
}