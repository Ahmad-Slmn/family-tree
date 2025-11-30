// tree.search.js — منطق البحث والفلاتر وترتيب النتائج

import * as Lineage from '../features/lineage.js';

// ===== تطبيع عربي للبحث =====
export const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
export const AR_TATWEEL = /\u0640/gu;

export function normalizeAr(s = '', opts = {}){
  const mapTaaMarbuta =
    (opts && Object.prototype.hasOwnProperty.call(opts,'mapTaaMarbuta')) ? !!opts.mapTaaMarbuta
      : true;

  let out = String(s)
    .normalize('NFKD')
    .replace(AR_DIAC,'')
    .replace(AR_TATWEEL,'')
    .replace(/[\u0622\u0623\u0625]/gu,'ا')
    .replace(/\u0649/gu,'ي');

  if (mapTaaMarbuta) out = out.replace(/\u0629/gu,'ه');

  return out
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function makeMatcher(q, opts = {}){
  const fields = opts.fields || ['name','role','cognomen'];
  const nq = normalizeAr(q);
  if (!nq) return () => true;
  const tokens = nq.split(' ').filter(Boolean);

  return (p) => {
    const nm = normalizeAr(p?.name || '');
    const rl = normalizeAr(p?.role || '');
    if (p) { p._normName = nm; p._normRole = rl; }

    const cg = normalizeAr(p?.bio?.cognomen || '');
    const target = [
      fields.includes('name') ? nm : '',
      fields.includes('role') ? rl : '',
      fields.includes('cognomen') ? cg : ''
    ].filter(Boolean).join(' ').trim();

    if (!target) return false;
    const words = target.split(' ').filter(Boolean);

    if (tokens.length > 1){
      let idx = 0;
      for (const t of tokens){
        let j = -1;
        for (let k = idx; k < words.length; k++){
          if (words[k].startsWith(t)) { j = k; break; }
        }
        if (j === -1) return false;
        idx = j + 1;
      }
      return true;
    }
    return tokens.every(t => words.some(w => w.startsWith(t)));
  };
}

export function roleGroup(p){
  const r = String(p?.role||'').trim();
  if (r === 'ابن' || r === 'بنت') return r;
  if (r === 'الأب') return 'الأب';
  if (r.startsWith('الجد')) return 'جد';
  if (r === 'زوجة' || r.startsWith('الزوجة')) return 'زوجة';
  return r || '';
}

// ===== درجة الترتيب لنتائج البحث =====
export function scoreForSearch(p, tokens){
  if (!p) return -1e9;
  const nm = normalizeAr(p.name||'');
  const rl = roleGroup(p) || '';
  let s = 0;

  for (const t of tokens){
    if (t && nm.startsWith(t)) s += 6;
    else if (t && nm.includes(t)) s += 3;
  }
  if (rl === 'الأب') s += 5;
  if ((p.role||'').trim() === 'صاحب الشجرة') s += 8;
  if (rl === 'جد') s += 3;
  if (rl === 'زوجة') s += 2;

  s += Math.max(0, 10 - Math.min(nm.length, 10));
  return s;
}

// وصف عربي دقيق للفلاتر النشطة
export function describeActiveFiltersAr(flt = {}){
  const parts = [];
  const role = (flt.role||'').trim();
  const clan = (flt.clan||'').trim();
  const from = (flt.birthFrom||'').trim();
  const to   = (flt.birthTo||'').trim();

  if (role) parts.push(`الدور = "${role}"`);
  if (clan) parts.push(`العشيرة تحتوي "${clan}"`);

  if (from && to) parts.push(`الميلاد بين ${from} و ${to}`);
  else if (from) parts.push(`الميلاد من ${from} فأحدث`);
  else if (to)   parts.push(`الميلاد حتى ${to}`);

  return parts.length ? parts.join('، ') : 'الفلاتر الحالية';
}

export function collectPersonsForSearch(fam){
  const out = [];
  if (!fam) return out;

  const seenStrict = new Set();
  const seenLoose  = new Set();

  const makeLooseKey = (p) => {
    const b = p.bio || {};
    const name   = String(p.name || '').trim();
    const role   = String(p.role || '').trim();
    const mother = String(b.motherName || '').trim();
    const clan   = String(b.clan || '').trim();
    return `nr:${name}|${role}|${mother}|${clan}`;
  };

  const add = (p) => {
    if (!p) return;

    const id        = p._id || p.id || p.__tempId || null;
    const looseKey  = makeLooseKey(p);
    const strictKey = id ? `id:${id}` : looseKey;

    // إذا سبق أن أضفناه، نتجاهله
    if (seenStrict.has(strictKey) || seenLoose.has(looseKey)) return;

    seenStrict.add(strictKey);
    seenLoose.add(looseKey);
    out.push(p);
  };

  const walkDeep = (p) => {
    if (!p) return;
    add(p);

    (p.wives || []).forEach(walkDeep);
    (p.children || []).forEach(walkDeep);
  };

  // نفس ترتيب المرور القديم تقريبًا
  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach(walkDeep);
  if (fam.father)      walkDeep(fam.father);
  if (fam.rootPerson)  walkDeep(fam.rootPerson);
  (fam.wives || []).forEach(walkDeep);

  return out;
}

/* ===== ترتيب هرمي ثابت مطابق للشجرة (لبطاقات نتائج البحث) ===== */
export function buildHierarchyIndex(fam){
  const order = new Map();
  let i = 0;

  const put = (p)=>{
    if(!p) return;
    const id = p._id || p.id || p.__tempId;
    if(id && !order.has(id)) order.set(id, i++);
  };

  const walkDeep = (p)=>{
    if(!p) return;
    put(p);

    (p.wives || []).forEach(walkDeep);
    (p.children || []).forEach(walkDeep);
  };

  (Array.isArray(fam?.ancestors) ? fam.ancestors : []).forEach(walkDeep);
  if(fam?.father) walkDeep(fam.father);
  if(fam?.rootPerson) walkDeep(fam.rootPerson);
  (fam?.wives||[]).forEach(walkDeep);

  return order;
}

export function getHierarchyRank(orderMap, p){
  const id = p?._id || p?.id || p?.__tempId;
  if(id && orderMap.has(id)) return orderMap.get(id);
  return Number.MAX_SAFE_INTEGER;
}

// فلاتر الأدوار/العشيرة/الميلاد (تُستخدم في الشجرة والأزرار)
export function makePassFilters(flt, fam, lineageCtx){
  return function passFilters(p){
    if (flt.role && roleGroup(p) !== flt.role) return false;

    if (flt.clan){
      const fc = normalizeAr(String(flt.clan||''));
      const resolvedClan = Lineage.resolveClan(p, fam, lineageCtx);
      const pc = normalizeAr(String(resolvedClan||''));
      if (!pc || !pc.includes(fc)) return false;
    }

    if (flt.birthFrom || flt.birthTo){
      const by = (p?.bio?.birthYear != null && String(p.bio.birthYear).trim()) ? String(p.bio.birthYear).padStart(4,'0') : '';
      const bd = String(p?.bio?.birthDate||'').trim();
      const bNorm = bd ? bd : (by ? `${by}-01-01` : '');
      if (!bNorm) return false;
      if (flt.birthFrom && bNorm < String(flt.birthFrom)) return false;
      if (flt.birthTo   && bNorm > String(flt.birthTo))   return false;
    }
    return true;
  };
}
