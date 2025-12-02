// features/stats.js — إحصاءات + مخططات + فلاتر + CSV
// يعتمد على: utils.byId ، model/families.getFamilies ، model/roles.roleGroup

import { byId } from '../utils.js';
import * as Model from '../model/families.js';
import { roleGroup } from '../model/roles.js';
import * as Lineage from './lineage.js';

function hexToRgba(hex, a = 0.18){
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}


/* =========================
   1) حساب الإحصاءات (عدّ آمن)
   - يمنع التكرار عبر _id أو بصمة مرنة
   - يبني perFamily و perClan ومؤشرات النواقص
========================= */
function computeStats(onlyFamilyKey = null){
  const fams    = Model.getFamilies();
  const visible = Object.keys(fams).filter(k => fams[k] && fams[k].hidden !== true);

  // دعم:
  // - null / undefined  → كل العائلات المرئية
  // - string            → عائلة واحدة
  // - Array<string>     → مجموعة عائلات مخصّصة (نستخدمها مع الفلتر)
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
    persons: 0, sons: 0, daughters: 0, wives: 0, unknown: 0,
    avgChildren: 0, avgChildrenPerRoot: 0,
    perFamily: [],
    perClan: new Map(),
    missing: { birthInfo:0, clan:0, photoAny:0 }
  };

  // مجموعات منع التكرار
  const seenIds  = new Set();
  const seenObjs = new WeakSet();
  const softSeen = new Set();

  // بصمة مرنة لمن لا يملك _id (تقلل العدّ المزدوج) — الآن تستخدم العشيرة المحسوبة
  const softFingerprint = (p, famKey, ctx)=>{
    const b = p?.bio || {};
    const resolvedClan =
      (ctx && typeof Lineage.resolveClan === 'function') ? (Lineage.resolveClan(p, ctx) || '')
        : String(b.clan || '');
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

  const alreadyCounted = (p, famKey, ctx)=>{
    if (!p || typeof p !== 'object') return true;
    if (p._id){
      if (seenIds.has(p._id)) return true;
      seenIds.add(p._id);
      return false;
    }
    if (seenObjs.has(p)) return true;
    seenObjs.add(p);
    const fp = softFingerprint(p, famKey, ctx);
    if (softSeen.has(fp)) return true;
    softSeen.add(fp);
    return false;
  };

  const bumpClan = (p, field, ctx)=>{
    const b = p?.bio || {};
    const clan = (() => {
      if (ctx && typeof Lineage.resolveClan === 'function'){
        const c = Lineage.resolveClan(p, ctx);
        if (c && String(c).trim()) return String(c).trim();
      }
      return String(b.clan || '').trim();
    })();

    if (!clan) return;
    const cur = s.perClan.get(clan) || { persons:0, sons:0, daughters:0 };
    cur.persons += 1;
    if (field === 'sons')          cur.sons      += 1;
    else if (field === 'daughters') cur.daughters += 1;
    s.perClan.set(clan, cur);
  };

  const bumpMissing = (p, ctx)=>{
    const b = p?.bio || {};
    const hasBirthInfo = !!(String(b.birthDate||'').trim() || String(b.birthYear||'').trim());
    if (!hasBirthInfo) s.missing.birthInfo += 1;

    const resolvedClan =
      (ctx && typeof Lineage.resolveClan === 'function')  ? (Lineage.resolveClan(p, ctx) || '')
        : String(b.clan || '');
    if (!String(resolvedClan).trim()) s.missing.clan += 1;

    const raw = String(b.photoUrl || p?.photoUrl || '').trim();
    if (!raw) s.missing.photoAny += 1;
  };

  const makeFamilyAcc = (famKey, fam)=>{
    const label = (fam?.familyName || fam?.title || fam?.rootPerson?.name || famKey || '').trim();
    return { familyKey:famKey, label, persons:0, sons:0, daughters:0, wives:0, unknown:0 };
  };

  const tally = (p, famKey, famAcc, ctx)=>{
    if (!p || alreadyCounted(p, famKey, ctx)) return;

    s.persons += 1;
    famAcc.persons += 1;
    bumpMissing(p, ctx);
const rg = roleGroup(p);

    if (rg === 'زوجة'){
      // زوجة → تُحتسب في الزوجات + تُنسب للعشيرة (بدون تمييز أبناء/بنات)
      s.wives += 1;
      famAcc.wives += 1;
      bumpClan(p, undefined, ctx);
    } else if (rg === 'ابن'){
      // ابن → أبناء + عشيرة (أبناء)
      s.sons += 1;
      famAcc.sons += 1;
      bumpClan(p, 'sons', ctx);
    } else if (rg === 'بنت'){
      // بنت → بنات + عشيرة (بنات)
      s.daughters += 1;
      famAcc.daughters += 1;
      bumpClan(p, 'daughters', ctx);
    } else {
      // أي دور آخر (جد، رب الأسرة، غير محدد...) → يُحتسب في unknown + تُنسب عشيرته إن وُجدت
      s.unknown += 1;
      famAcc.unknown += 1;
      bumpClan(p, undefined, ctx);
    }


    const wives = Array.isArray(p.wives) ? p.wives : [];
    const kids  = Array.isArray(p.children) ? p.children : [];

    // حذف ازدواج الأطفال بين children وعلى مستوى الزوجات مع استخدام البصمة الجديدة
    let wifeChildKeySet = null;
    if (wives.length){
      wifeChildKeySet = new Set();
      for (const w of wives){
        const wkids = Array.isArray(w?.children) ? w.children : [];
        for (const c of wkids){
          const key = c?._id ? `id:${c._id}` : `sf:${softFingerprint(c, famKey, ctx)}`;
          wifeChildKeySet.add(key);
        }
      }
    }

    for (const c of kids){
      if (wifeChildKeySet){
        const key = c?._id ? `id:${c._id}` : `sf:${softFingerprint(c, famKey, ctx)}`;
        if (wifeChildKeySet.has(key)) continue;
      }
      tally(c, famKey, famAcc, ctx);
    }

    for (const w of wives){
      tally(w, famKey, famAcc, ctx);
      const wkids = Array.isArray(w?.children) ? w.children : [];
      for (const c of wkids) tally(c, famKey, famAcc, ctx);
    }
  };

  // جمع على مستوى كل عائلة
  const perFamilyRoots = [];
  for (const famKey of keys){
    const f = fams[famKey]; if (!f) continue;
    const famAcc = makeFamilyAcc(famKey, f);

    // سياق النَّسَب لهذه العائلة (يُستخدم في resolveClan)
    const ctx =
      (Lineage && typeof Lineage.buildLineageContext === 'function') ? Lineage.buildLineageContext(f)
        : null;

    const roots = [
      ...(Array.isArray(f?.ancestors) ? f.ancestors : []),
      f.father, f.rootPerson
    ].filter(Boolean);

    for (const r of roots) tally(r, famKey, famAcc, ctx);

    // دعم بنية قديمة wives على مستوى العائلة
    if (!Array.isArray(f?.rootPerson?.wives) && Array.isArray(f?.wives)) {
      for (const w of f.wives) tally(w, famKey, famAcc, ctx);
    }

    s.perFamily.push(famAcc);

    const rp     = f?.rootPerson;
    const rpKids = (rp && Array.isArray(rp.children)) ? rp.children.length : 0;
    perFamilyRoots.push({ famKey, rpKids });
  }

  // متوسطات
  s.avgChildren = Number(((s.sons + s.daughters) / Math.max(1, s.familiesCount)).toFixed(2));
  const activeRoots = perFamilyRoots.filter(x => x.rpKids > 0).length || 1;
  s.avgChildrenPerRoot = Number(((s.sons + s.daughters) / activeRoots).toFixed(2));

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
    sons: Number(r.sons)||0,
    daughters: Number(r.daughters)||0,
    total: (Number(r.sons)||0) + (Number(r.daughters)||0)
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
  const head = ['العائلة','الأشخاص','الأبناء','البنات','الزوجات','غير محدد'];
  const rows = perFamily.map(f=>[
    safeCSV(f.label), f.persons, f.sons, f.daughters, f.wives, f.unknown
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
            <th>العائلة</th><th>الأشخاص</th><th>أبناء</th><th>بنات</th><th>زوجات</th><th>غير محدد</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="table-wrap">
      <h4>تفاصيل العشائر</h4>
      <div class="table-scroll">
        <table class="stats-table" id="stClans">
          <thead><tr><th>العشيرة</th><th>الأشخاص</th><th>أبناء</th><th>بنات</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `;

  const sAll    = computeStats();             // إجمالي مرة واحدة
  const selScope = byId('fScope');
  const fams     = Model.getFamilies();

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
  const inpSearch = byId('fSearch');
  const inpMin    = byId('fMin');
  const selSort   = byId('fSort');
  const selTopN   = byId('fTopN');
  const cvStack   = byId('statsStacked');

  const getScopedStats = ()=>{
    const scopeVal = selScope?.value || 'all';
    return (scopeVal !== 'all') ? computeStats(scopeVal) : sAll;
  };

  // بطاقات الملخص + شريط أبناء/بنات
  const renderSummary = (stats)=>{
    const grid = byId('stGrid');

    // عنوان → أيقونة مناسبة من Font Awesome 7 (fa-solid)
    const items = [
      ['عدد العائلات',          stats.familiesCount,       'fa-people-roof'],          // عائلات
      ['جميع الأشخاص',          stats.persons,             'fa-users'],                // أشخاص
      ['الزوجات',               stats.wives,               'fa-person-dress'],         // زوجات
      ['الأبناء',               stats.sons,                'fa-person'],               // أبناء
      ['البنات',                stats.daughters,           'fa-person-dress'],         // بنات
      ['غير محدد',              stats.unknown,             'fa-user-large-slash'],     // غير محدد
      ['متوسط الأبناء/عائلة',   stats.avgChildren,         'fa-chart-column'],         // متوسط/إحصاء
      ['متوسط الأبناء/جذر فعّال', stats.avgChildrenPerRoot,'fa-chart-line'],          // متوسط/منحنى
      ['توفر الميلاد',          `${pct(stats.persons - stats.missing.birthInfo, stats.persons)}%`, 'fa-cake-candles'],  // ميلاد
      ['توفر العشيرة',          `${pct(stats.persons - stats.missing.clan, stats.persons)}%`,       'fa-people-group'],  // عشيرة
      ['توفر الصورة',           `${pct(stats.persons - stats.missing.photoAny, stats.persons)}%`,   'fa-image']          // صورة
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
      { label:'أبناء',  value:stats.sons },
      { label:'بنات',   value:stats.daughters }
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
      total:     (a,b)=> (b.sons + b.daughters) - (a.sons + a.daughters),
      sons:      (a,b)=> b.sons - a.sons,
      daughters: (a,b)=> b.daughters - a.daughters
    };
    rows.sort(sorters[sort] || sorters.total);

    tbFam.innerHTML = rows.length ? rows.map(f =>
      `<tr><td>${f.label}</td><td>${f.persons}</td><td>${f.sons}</td><td>${f.daughters}</td><td>${f.wives}</td><td>${f.unknown}</td></tr>`
    ).join('') : `<tr><td colspan="6" class="empty">لا بيانات</td></tr>`;

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
      clanStats = computeStats(filteredKeys);
    } else {
      // لا توجد عائلات بعد الفلتر
      clanStats = { perClan: new Map() };
    }

    selClan.innerHTML = `<option value="">الكل</option>`;
    const clansArr = Array.from((clanStats.perClan || new Map()).entries())
      .map(([clan, v]) => ({ clan, persons: v.persons }))
      .sort((a,b)=> b.persons - a.persons);

    for (const c of clansArr){
      const opt = document.createElement('option');
      opt.value = c.clan;
      opt.textContent = `${c.clan} (${c.persons})`;
      selClan.appendChild(opt);
    }

    const top = clansArr.slice(0, 12);
    tbClan.innerHTML = top.length ? top.map(c=>{
      const v = clanStats.perClan.get(c.clan) || { persons:0, sons:0, daughters:0 };
      return `<tr><td>${c.clan}</td><td>${v.persons}</td><td>${v.sons}</td><td>${v.daughters}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="empty">لا بيانات</td></tr>`;
  };
  
    // دالة موحدة لإعادة رسم المخططات حسب النطاق الحالي + الفلاتر الحالية
  const redrawCharts = () => {
    if (!cvBar.isConnected || !cvStack.isConnected) return;
    const statsNow = getScopedStats();

    // ملخص الأبناء/البنات في الشريط العلوي (لا يعتمد على البحث النصي)
    drawBars(cvBar, [
      { label: 'أبناء', value: statsNow.sons },
      { label: 'بنات',  value: statsNow.daughters }
    ]);

    // المكدّس + جدول العائلات + جدول العشائر وفق الفلاتر الحالية
    applyFilters();
  };

  // الرسم الأولي
  renderSummary(getScopedStats());  // البطاقات + الشريط (مرّة واحدة للنطاق الحالي)
  applyFilters();                   // أول تطبيق للفلاتر

  // ربط الفلاتر بدالة التحديث
  inpSearch?.addEventListener('input', applyFilters);
  inpMin?.addEventListener('input', applyFilters);
  selSort?.addEventListener('change', applyFilters);
  selTopN?.addEventListener('change', applyFilters);
  // (اختياري لاحقًا عند تنفيذ فلتر العشيرة):
  // selClan?.addEventListener('change', applyFilters);

  // تبديل النطاق
  selScope?.addEventListener('change', ()=>{
    renderSummary(getScopedStats());
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
  const statsModal = byId('statsModal');
  const detach = () => { try { mo.disconnect(); mql?.removeEventListener?.('change', redrawAll); } catch {} };
  statsModal?.addEventListener('close', detach, { once: true });

  
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
  byId('statsBtn')?.addEventListener('click', ()=>{
    renderStats();
    byId('statsModal')?.classList.add('show');
  });
  byId('closeStats')?.addEventListener('click', closeStatsModal);
  byId('statsModal')?.addEventListener('click', e => { if (e.target.id === 'statsModal') closeStatsModal(); });

  // === [إضافة جديدة تبدأ هنا] تحديث قائمة "النطاق" عند تغيّر رؤية العائلات ===
const refreshScopeOptions = () => {
  const modalShown = byId('statsModal')?.classList.contains('show');
  if (!modalShown) return;
  // أبسط وأضمن: أعد بناء كامل نافذة الإحصاءات لتتزامن القوائم والمخططات والجداول مع الرؤية الحالية
  renderStats();
};


  // استمع لتغيّر الرؤية من نظام visibility أو أي بثّ عام
  ctx.bus.on('families:visibility:changed', refreshScopeOptions);
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


