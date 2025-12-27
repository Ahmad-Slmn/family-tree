// tree.search.js — منطق البحث والفلاتر وترتيب النتائج

import * as Lineage from '../features/lineage.js';

/* ======================= Helpers عامة ======================= */
function getPid(p) {
  return String(p?._id || p?.id || p?.__tempId || '').trim();
}

/* ======================= تطبيع عربي للبحث ======================= */
export const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
export const AR_TATWEEL = /\u0640/gu;

export function normalizeAr(s = '', opts = {}) {
  const mapTaaMarbuta = Object.prototype.hasOwnProperty.call(opts, 'mapTaaMarbuta') ? !!opts.mapTaaMarbuta
    : true;

  let out = String(s)
    .normalize('NFKD')
    .replace(AR_DIAC, '')
    .replace(AR_TATWEEL, '')
    .replace(/[\u0622\u0623\u0625]/gu, 'ا')
    .replace(/\u0649/gu, 'ي');

  if (mapTaaMarbuta) out = out.replace(/\u0629/gu, 'ه');

  return out
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ======================= مطابقة البحث (Matcher) ======================= */
export function makeMatcher(q, opts = {}) {
  const fields = opts.fields || ['name', 'role', 'cognomen'];
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

    if (tokens.length > 1) {
      let idx = 0;
      for (const t of tokens) {
        let j = -1;
        for (let k = idx; k < words.length; k++) {
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

/* ======================= تجميع الدور + سكور البحث ======================= */
export function roleGroup(p) {
  const r = String(p?.role || '').trim();
  if (r === 'صاحب الشجرة') return 'صاحب الشجرة';
  if (r === 'ابن' || r === 'بنت') return r;
  if (r === 'الأب') return 'الأب';
  if (r.startsWith('الجد')) return 'جد';
  if (r === 'زوجة' || r.startsWith('الزوجة')) return 'زوجة';
  return r || '';
}

export function scoreForSearch(p, tokens) {
  if (!p) return -1e9;

  const nm = normalizeAr(p.name || '');
  const rl = roleGroup(p) || '';
  let s = 0;

  for (const t of tokens) {
    if (t && nm.startsWith(t)) s += 6;
    else if (t && nm.includes(t)) s += 3;
  }

  if (rl === 'الأب') s += 5;
  if ((p.role || '').trim() === 'صاحب الشجرة') s += 8;
  if (rl === 'جد') s += 3;
  if (rl === 'زوجة') s += 2;

  s += Math.max(0, 10 - Math.min(nm.length, 10));
  return s;
}

/* ======================= فلتر الحالة: حي / متوفى (STRICT+) ======================= */
export function isDeceasedPerson(p) {
  if (!p) return false;
  const b = p.bio || {};

  const clean = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (s === '-' || s === '0') return '';
    return s;
  };

  // مهم: تحقق "بسيط" للمدى (شهر 1-12 + يوم 1-31)
  const isValidYMD = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return false;

    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);

    if (!Number.isFinite(mm) || !Number.isFinite(dd)) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;

    return true;
  };

  const dd = clean(b.deathDate);
  const dy = clean(b.deathYear);

  const flag = (p.isDeceased === true) || (b.isDeceased === true);
  const hasValidDeathYear = /^\d{3,4}$/.test(dy);
  const hasValidDeathDate = isValidYMD(dd);

  return !!flag || hasValidDeathDate || hasValidDeathYear;
}

export function lifePass(p, lifeValue) {
  // lifeValue: '' | 'alive' | 'deceased'
  if (!lifeValue) return true;
  const dec = isDeceasedPerson(p);
  if (lifeValue === 'deceased') return dec;
  if (lifeValue === 'alive') return !dec;
  return true;
}

/* ======================= وصف عربي للفلاتر النشطة ======================= */
function getArabicOrdinalLocal(n) {
  const x = Number(n);
  const map = {
    1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس',
    6: 'السادس', 7: 'السابع', 8: 'الثامن', 9: 'التاسع', 10: 'العاشر',
    11: 'الحادي عشر', 12: 'الثاني عشر', 13: 'الثالث عشر', 14: 'الرابع عشر',
    15: 'الخامس عشر', 16: 'السادس عشر', 17: 'السابع عشر', 18: 'الثامن عشر',
    19: 'التاسع عشر', 20: 'العشرون'
  };
  return map[x] || String(x);
}

export function describeActiveFiltersAr(flt = {}) {
  const parts = [];
  const role = (flt.role || '').trim();
  const clan = (flt.clan || '').trim();
  const from = (flt.birthFrom || '').trim();
  const to = (flt.birthTo || '').trim();
  const life = (flt.life || '').trim();
  const gen = (flt.gen != null) ? String(flt.gen).trim() : '';

  if (role) parts.push(`الدور = "${role}"`);
  if (clan) parts.push(`العشيرة تحتوي "${clan}"`);
  if (life === 'alive') parts.push('الحالة = "الأحياء"');
  else if (life === 'deceased') parts.push('الحالة = "المتوفين "');

  if (gen !== '') {
    const shown = Number(gen) + 1;
    parts.push(`الجيل = ${getArabicOrdinalLocal(shown)}`);
  }

  if (from && to) parts.push(`الميلاد بين ${from} و ${to}`);
  else if (from) parts.push(`الميلاد من ${from} فأحدث`);
  else if (to) parts.push(`الميلاد حتى ${to}`);

  return parts.length ? parts.join('، ') : 'الفلاتر الحالية';
}

/* ======================= تجميع الأشخاص للبحث (مع منع التكرار) ======================= */
export function collectPersonsForSearch(fam) {
  const out = [];
  if (!fam) return out;

  const seenStrict = new Set();
  const seenLoose = new Set();

  const makeLooseKey = (p) => {
    const b = p.bio || {};
    const name = String(p.name || '').trim();
    const role = String(p.role || '').trim();
    const mother = String(b.motherName || '').trim();
    const clan = String(b.clan || '').trim();
    return `nr:${name}|${role}|${mother}|${clan}`;
  };

  const add = (p) => {
    if (!p) return;

    const id = p._id || p.id || p.__tempId || null;
    const looseKey = makeLooseKey(p);
    const strictKey = id ? `id:${id}` : looseKey;

    // مهم: منع التكرار حتى لا يتضخم العدّ/النتائج
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

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach(walkDeep);
  if (fam.father) walkDeep(fam.father);
  if (fam.rootPerson) walkDeep(fam.rootPerson);
  (fam.wives || []).forEach(walkDeep);

  return out;
}

/* ======================= ترتيب هرمي ثابت مطابق للشجرة ======================= */
export function buildHierarchyIndex(fam) {
  const order = new Map();
  let i = 0;

  const put = (p) => {
    if (!p) return;
    const id = p._id || p.id || p.__tempId;
    if (id && !order.has(id)) order.set(id, i++);
  };

  const walkDeep = (p) => {
    if (!p) return;
    put(p);
    (p.wives || []).forEach(walkDeep);
    (p.children || []).forEach(walkDeep);
  };

  (Array.isArray(fam?.ancestors) ? fam.ancestors : []).forEach(walkDeep);
  if (fam?.father) walkDeep(fam.father);
  if (fam?.rootPerson) walkDeep(fam.rootPerson);
  (fam?.wives || []).forEach(walkDeep);

  return order;
}

export function getHierarchyRank(orderMap, p) {
  const id = p?._id || p?.id || p?.__tempId;
  if (id && orderMap.has(id)) return orderMap.get(id);
  return Number.MAX_SAFE_INTEGER;
}

/* ======================= خرائط الجيل (Generation) ======================= */
export function buildByIdMap(fam) {
  const byId = new Map();
  if (!fam) return byId;

  if (fam.persons && typeof fam.persons === 'object') {
    Object.entries(fam.persons).forEach(([id, p]) => {
      if (p) byId.set(String(id), p);
      const pid = getPid(p);
      if (pid) byId.set(pid, p);
    });
  }

  const walk = (p) => {
    if (!p) return;

    const pid = getPid(p);
    if (pid) byId.set(pid, p);

    (p.wives || []).forEach(walk);
    (p.children || []).forEach(walk);
  };

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach(walk);
  if (fam.father) walk(fam.father);
  if (fam.rootPerson) walk(fam.rootPerson);
  (fam.wives || []).forEach(walk);

  return byId;
}

// مهم: adjacency للأبناء عبر fatherId (مع دعم childrenIds كتعزيز)
function buildChildrenAdjacency(byIdMap) {
  const childByFather = new Map(); // fatherId -> Set(childIds)

  const push = (fid, cid) => {
    const f = String(fid || '').trim();
    const c = String(cid || '').trim();
    if (!f || !c) return;

    if (!childByFather.has(f)) childByFather.set(f, new Set());
    childByFather.get(f).add(c);
  };

  for (const p of byIdMap.values()) {
    const cid = getPid(p);
    if (!cid) continue;

    const fid = p.fatherId || p.bio?.fatherId || null;
    if (fid) push(fid, cid);
  }

  for (const p of byIdMap.values()) {
    const pid = getPid(p);
    if (!pid) continue;

    const kids = getChildrenIds(p);
    for (const kidId of kids) push(pid, String(kidId || '').trim());
  }

  return childByFather;
}

function getKidsFromAdj(adj, fatherId) {
  const set = adj.get(String(fatherId || '').trim());
  return set ? Array.from(set) : [];
}

export function getChildrenIds(p) {
  if (!p) return [];

  if (Array.isArray(p.childrenIds) && p.childrenIds.length)
    return p.childrenIds.map(x => String(x || '').trim()).filter(Boolean);

  if (Array.isArray(p.children) && p.children.length)
    return p.children.map(ch => getPid(ch)).filter(Boolean);

  return [];
}

export function buildGenerationMap(fam) {
  const genMap = new Map(); // id -> gen number (0 = أعلى جد)
  const byIdMap = buildByIdMap(fam);

  if (!fam || byIdMap.size === 0) return { genMap, byIdMap, maxGen: 0 };

  const adj = buildChildrenAdjacency(byIdMap);
  const hasAnc = Array.isArray(fam.ancestors) && fam.ancestors.length;

  const getFatherIdOf = (p) => (p?.fatherId || p?.bio?.fatherId || null);

  const resolveRef = (p) => {
    const id = getPid(p);
    return (id && byIdMap.get(id)) ? byIdMap.get(id) : p;
  };

  let startId = '';

  // مهم: تحديد "أعلى جد" كنقطة بداية
  if (hasAnc) {
    const ancRefs = fam.ancestors
      .filter(Boolean)
      .map(a => resolveRef(a))
      .filter(a => getPid(a));

    const topNoFather = ancRefs.find(a => !getFatherIdOf(a));
    if (topNoFather) {
      startId = getPid(topNoFather);
    } else {
      let best = ancRefs[0] || null;
      for (const a of ancRefs) {
        const ga = Number.isFinite(+a?.generation) ? +a.generation : 0;
        const gb = Number.isFinite(+best?.generation) ? +best.generation : 0;
        if (ga > gb) best = a;
      }
      const bid = getPid(best);
      if (bid) startId = bid;
    }
  }

  if (!startId && fam.father && getPid(fam.father)) {
    // مهم: اصعد من الأب للأعلى عبر fatherId
    let cur = resolveRef(fam.father);
    const seenUp = new Set();

    while (cur && getPid(cur)) {
      const cid = getPid(cur);
      if (seenUp.has(cid)) break;
      seenUp.add(cid);

      const fid = getFatherIdOf(cur);
      if (!fid) { startId = cid; break; }

      const next = byIdMap.get(String(fid)) || null;
      if (!next) { startId = cid; break; } // انقطع الربط => هذا أعلى ما عندنا
      cur = next;
    }
  }

  if (!startId) {
    const rootId = getPid(fam?.rootPerson);
    if (rootId) startId = rootId;
  }

  if (!startId) return { genMap, byIdMap, maxGen: 0 };

  // مهم: BFS نزولًا من أعلى جد عبر adjacency
  const q = [startId];
  genMap.set(startId, 0);

  while (q.length) {
    const curId = q.shift();
    const g0 = genMap.get(curId) ?? 0;

    const kids = getKidsFromAdj(adj, curId);
    for (const kidId of kids) {
      if (!kidId) continue;
      if (!genMap.has(kidId)) {
        genMap.set(kidId, g0 + 1);
        q.push(kidId);
      }
    }
  }

  // مهم عمليًا: الزوجات نفس جيل الزوج
  for (const p of byIdMap.values()) {
    const pid = getPid(p);
    if (!pid) continue;

    const wives = Array.isArray(p.wives) ? p.wives : [];
    const g = genMap.get(pid);
    if (g == null) continue;

    for (const w of wives) {
      const wid = getPid(w);
      if (!wid) continue;
      if (!genMap.has(wid)) genMap.set(wid, g);
    }
  }

  let maxGen = 0;
  for (const v of genMap.values()) maxGen = Math.max(maxGen, v);

  return { genMap, byIdMap, maxGen };
}

/* ======================= مجموعة الأحفاد (Descendants) ======================= */
export function buildDescendantsSet(startId, byIdMap) {
  const out = new Set();
  const sid = String(startId || '').trim();
  if (!sid || !byIdMap?.has(sid)) return out;

  const adj = buildChildrenAdjacency(byIdMap);
  const stack = [sid];
  out.add(sid);

  while (stack.length) {
    const id = stack.pop();
    const kids = getKidsFromAdj(adj, id);

    for (const kidId of kids) {
      const k = String(kidId || '').trim();
      if (!k) continue;
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }

  return out;
}

/* ======================= مُنشئ فلترة موحّد للشجرة/البحث ======================= */
export function makePassFilters(flt, fam, lineageCtx) {
  const filters = flt || {};

  // مهم: تجهيز خرائط الجيل مرة واحدة
  const { genMap, byIdMap } = buildGenerationMap(fam);

  // مهم: تفعيل فلتر الجيل (انتبه: "0" صحيح)
  const hasGen = (filters.gen != null && String(filters.gen).trim() !== '');
  const wantGen = hasGen ? Number(String(filters.gen).trim()) : null;

  return function passFilters(p) {
    // (1) فلتر الحالة (حي/متوفى) قبل أي شيء
    if (!lifePass(p, filters.life)) return false;

    // (2) فلتر الجيل
    if (hasGen) {
      const id = getPid(p);
      const g = genMap.get(id);
      if (g == null) return false;          // خارج نسل الجذر
      if (Number(g) !== wantGen) return false;
    }

    // (4) فلتر الدور
    if (filters.role && roleGroup(p) !== filters.role) return false;

    // (5) فلتر العشيرة (SAFE + متسق مع features/search.js)
    if (filters.clan) {
      const fc = normalizeAr(String(filters.clan || '')).trim();
      if (fc) {
        const safeResolveClan =
          (Lineage && typeof Lineage.resolveClan === 'function') ? Lineage.resolveClan : null;

        const resolved = safeResolveClan ? (safeResolveClan(p, fam, lineageCtx) || '') : '';

        const candidates = [
          resolved,
          p?.bio?.clan,
          p?.bio?.motherClan,
          p?.bio?.maternalGrandmotherClan,
          p?.bio?.paternalGrandmotherClan
        ].map(v => normalizeAr(String(v || '')).trim()).filter(Boolean);

        if (!candidates.some(pc => pc.includes(fc))) return false;
      }
    }

    // (6) فلتر تاريخ الميلاد
    if (filters.birthFrom || filters.birthTo) {
      const by = (p?.bio?.birthYear != null && String(p.bio.birthYear).trim()) ? String(p.bio.birthYear).padStart(4, '0')
        : '';
      const bd = String(p?.bio?.birthDate || '').trim();
      const bNorm = bd ? bd : (by ? `${by}-01-01` : '');

      if (!bNorm) return false;
      if (filters.birthFrom && bNorm < String(filters.birthFrom)) return false;
      if (filters.birthTo && bNorm > String(filters.birthTo)) return false;
    }

    return true;
  };
}
