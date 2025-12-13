// features/stats.js — إحصاءات + مخططات + فلاتر + CSV
// يعتمد على: utils.byId ، model/families.getFamilies ، model/roles.roleGroup

import { byId } from '../utils.js';
import * as Model from '../model/families.js';
import { roleGroup, inferGender } from '../model/roles.js';
import * as Lineage from './lineage.js';
import { getDuplicatesStatusForAllFamilies, getDuplicateSummary } from './duplicates.js';

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
    uniqueAcrossFamilies = false,   // toggle: إجمالي فريد عبر جميع العائلات
    diagnostics = true              // يسجل missingIdsCount + تحذيرات الاتساق
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
  rootSons: 0, rootDaughters: 0,                               // ✅ جديد: أبناء/بنات صاحب الشجرة فقط
  avgChildren: 0, avgChildrenPerRoot: 0,
  perFamily: [],
  perClan: new Map(),
  missing: { birthInfo:0, clan:0, photoAny:0, missingIdsCount:0 },
  diagnostics: diagnostics ? { invariantsFailed:0, invariantNotes:[] } : null
};


  // مجموعات منع التكرار على مستوى "الكل" (فقط عند uniqueAcrossFamilies = true)
  const gSeenIds  = uniqueAcrossFamilies ? new Set()     : null;
  const gSeenObjs = uniqueAcrossFamilies ? new WeakSet() : null;

const makeFamilyAcc = (famKey, fam)=>{
  const label = (fam?.familyName || fam?.title || fam?.rootPerson?.name || famKey || '').trim();
  return {
    familyKey:famKey, label,
    persons:0, sons:0, daughters:0, wives:0, unknown:0,        // (كما هي) تصنيف جميع الأشخاص
    rootSons:0, rootDaughters:0                                // ✅ جديد
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
  if ((!f.__pipelineReady) && typeof Model.normalizeFamilyPipeline === 'function') {
    const fromVer =
      Number.isFinite(f.__v) ? f.__v :
      Number.isFinite(f.schemaVersion) ? f.schemaVersion :
      0;

    Model.normalizeFamilyPipeline(f, { fromVer, markCore: f.__core === true });
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
      const c = Lineage.resolveClan(p, f, ctx);   // ✅ (person, family, ctx)
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

  const alreadyCounted = (p)=>{
    if (!p || typeof p !== 'object') return true;

    const pid = p?._id ? String(p._id) : '';
    if (pid){
      if (seenIds.has(pid)) return true;
      seenIds.add(pid);
      return false;
    }

    if (diagnostics) s.missing.missingIdsCount += 1;

    if (seenObjs.has(p)) return true;
    seenObjs.add(p);

    const fp = softFingerprint(p);
    if (softSeen.has(fp)) return true;
    softSeen.add(fp);
    return false;
  };
  
  const countRootKids = (fam)=>{
  const rp = fam?.rootPerson;
  if (!rp) return { sons:0, daughters:0, total:0 };

  const ids = new Set();
  const kids = [];

  // 1) أبناء الجذر المباشرين
  for (const c of (Array.isArray(rp.children) ? rp.children : [])){
    const id = c?._id ? String(c._id) : null;
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    kids.push(c);
  }

  // 2) (اختياري لكن مهم) أبناء الزوجات إذا لم تكن متزامنة في rp.children
  const wives = Array.isArray(rp.wives) ? rp.wives : (Array.isArray(fam?.wives) ? fam.wives : []);
  for (const w of wives){
    for (const c of (Array.isArray(w?.children) ? w.children : [])){
      const id = c?._id ? String(c._id) : null;
      if (id && ids.has(id)) continue;
      if (id) ids.add(id);
      kids.push(c);
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


  const tally = (p)=>{
    if (!p || alreadyCounted(p)) return;

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

    const wives = Array.isArray(p.wives) ? p.wives : [];
    const kids  = Array.isArray(p.children) ? p.children : [];

let wifeChildKeySet = null;
if (wives.length){
  wifeChildKeySet = new Set();

  // تطبيع اسم خفيف (محلي داخل stats.js)
  const normName = (x)=> String(x||'')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
    .replace(/\u0640/g,'')
    .replace(/[اأإآ]/g,'ا')
    .replace(/[يى]/g,'ي')
    .replace(/[هة]/g,'ه')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();

  const childKey = (c)=>{
    const cid = c?._id ? String(c._id) : '';
    if (cid) return `id:${cid}`;
    // إن لم يوجد id: استخدم البصمة المرنة (أدق من الاسم غالبًا)
    const fp = softFingerprint(c);
    if (fp) return `fp:${fp}`;
    const nm = normName(c?.name || c?.bio?.fullName || c?.bio?.fullname || '');
    return nm ? `nm:${nm}` : '';
  };

  for (const w of wives){
    const wkids = Array.isArray(w?.children) ? w.children : [];
    for (const c of wkids){
      const k = childKey(c);
      if (k) wifeChildKeySet.add(k);
      else if (diagnostics) s.missing.missingIdsCount += 1;
    }
  }

  // خزّن الدالة للاستخدام أدناه (ضمن نفس استدعاء tally)
  tally.__childKey = childKey;
}

for (const c of kids){
  if (wifeChildKeySet){
    const childKey = tally.__childKey;
    const k = childKey ? childKey(c) : '';
    if (k && wifeChildKeySet.has(k)) continue;
  }
  tally(c);
}

    for (const w of wives){
      tally(w);
      const wkids = Array.isArray(w?.children) ? w.children : [];
      for (const c of wkids) tally(c);
    }
  };

  const roots = [
    ...(Array.isArray(f?.ancestors) ? f.ancestors : []),
    f.father, f.rootPerson
  ].filter(Boolean);

  for (const r of roots) tally(r);
// ✅ أبناء/بنات صاحب الشجرة فقط
const rk = countRootKids(f);
famAcc.rootSons      = rk.sons;
famAcc.rootDaughters = rk.daughters;
s.rootSons          += rk.sons;
s.rootDaughters     += rk.daughters;

// استخدم هذا للـ averages بدل (s.sons+s.daughters)
perFamilyRoots.push({ famKey, rpKids: rk.total });

  if (!Array.isArray(f?.rootPerson?.wives) && Array.isArray(f?.wives)) {
    for (const w of f.wives) tally(w);
  }

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
   5) CSV: توليد وتنزيل
========================= */
function toCSV(perFamily){
  const head = ['العائلة','الأشخاص','أبناء (صاحب الشجرة)','بنات (صاحب الشجرة)','الزوجات','غير محدد'];
  const rows = perFamily.map(f=>[
    safeCSV(f.label), f.persons, f.rootSons, f.rootDaughters, f.wives, f.unknown
  ].join(','));
  return head.join(',') + '\n' + rows.join('\n');
}

function safeCSV(s){
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
}
function downloadCSV(filename, text){
  const blob = new Blob([text], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'stats.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0);
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

        <button id="btnExportCsv" class="btn primary" type="button" title="تصدير CSV">
          <i class="fa-solid fa-file-export" aria-hidden="true"></i>
          <span>تصدير CSV</span>
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

const getScopedStats = ()=>{
  const scopeVal = selScope?.value || 'all';
  return (scopeVal !== 'all') ? computeStats(scopeVal, { uniqueAcrossFamilies:false, diagnostics:true })
    : sAll;
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
clanStats = computeStats(filteredKeys, { uniqueAcrossFamilies:false, diagnostics:true });
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
    if (!cvBar.isConnected || !cvStack.isConnected) return;
    const statsNow = getScopedStats();

    // ملخص الأبناء/البنات في الشريط العلوي (لا يعتمد على البحث النصي)
    drawBars(cvBar, [
      { label: 'أبناء', value: statsNow.rootSons },
      { label: 'بنات',  value: statsNow.rootDaughters }
    ]);


    // المكدّس + جدول العائلات + جدول العشائر وفق الفلاتر الحالية
    applyFilters();
  };

  // الرسم الأولي
  renderSummary(getScopedStats(), dupAgg);
  applyFilters();

  // ربط الفلاتر بدالة التحديث
  inpSearch?.addEventListener('input', applyFilters);
  inpMin?.addEventListener('input', applyFilters);
  selSort?.addEventListener('change', applyFilters);
  selTopN?.addEventListener('change', applyFilters);
  // (اختياري لاحقًا عند تنفيذ فلتر العشيرة):
  // selClan?.addEventListener('change', applyFilters);

  // تبديل النطاق
  selScope?.addEventListener('change', ()=>{
    renderSummary(getScopedStats(), dupAgg);
    applyFilters();
  });


  // تصدير CSV
  byId('btnExportCsv')?.addEventListener('click', ()=>{
    const csv = toCSV(getScopedStats().perFamily);
    downloadCSV('families-stats.csv', csv);
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
const detach = () => {
  try { offRecompute?.(); } catch {}
  try { mo.disconnect(); mql?.removeEventListener?.('change', redrawAll); } catch {}
};
statsModal?.addEventListener('close', detach, { once:true });

  
  ro.observe(cvBar); ro.observe(cvStack);
}

/* =========================
   7) إغلاق نافذة الإحصاءات
========================= */
function closeStatsModal() {
  const modal = byId('statsModal'); if (!modal) return;
  modal.classList.add('hide');
  const removeClasses = () => {
    modal.classList.remove('show','hide');
    modal.removeEventListener('animationend', removeClasses);
    modal.removeEventListener('transitionend', removeClasses);
  };
  modal.addEventListener('animationend', removeClasses);
  modal.addEventListener('transitionend', removeClasses);
  setTimeout(removeClasses, 400);
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
    byId('statsModal')?.classList.add('show');
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
// === [إضافة جديدة تنتهي هنا] ===


  // استمع لتغيّر الرؤية من نظام visibility أو أي بثّ عام
ctx?.bus?.on?.('families:visibility:changed', refreshScopeOptions);
  window.addEventListener('FT_VISIBILITY_REFRESH', refreshScopeOptions);
  // === [إضافة جديدة تنتهي هنا] ===

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