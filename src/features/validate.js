// src/features/validate.js
// =======================================
// التحقق من منطق بيانات العائلة (أعمار/وفيات/روابط والد-طفل/فرق عمر الزوجين) وإرجاع تنبيهات منظمة
// بدون تعديل بيانات العائلة الأصلية أو التأثير على القيم المخزّنة في الـ bio
// =======================================

import * as Model from '../model/families.js';
import { buildLineageContext } from './lineage.js';
import { inferGender } from '../model/roles.js';

/* =========================
   أدوات منطقية مساعدة
   ========================= */

function vcNameOnly(label){
  const s = String(label || '').trim();
  if (!s) return '';
  const parts = s.split('—').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 1) return parts[0] || s;
  return s;
}

function genderPack(p){
  const g = inferGender(p);
  return {
    seems:    (g === 'F') ? 'تبدو' : 'يبدو',
    equalAdj: (g === 'F') ? 'مساوية' : 'مساويًا',
    agePron:  (g === 'F') ? 'عمرها' : 'عمره',
  };
}

function vcParentChildNoun(parent, child){
  const pg = inferGender(parent);
  const cg = inferGender(child);

  const poss =
    (pg === 'F') ? 'ها' :
    (pg === 'M') ? 'ه'  :
    null;

  if (cg === 'M'){
    if (poss === 'ه')  return 'ابنه';
    if (poss === 'ها') return 'ابنها';
    return 'ابنه/ابنها';
  }

  if (cg === 'F'){
    if (poss === 'ه')  return 'ابنته';
    if (poss === 'ها') return 'ابنتها';
    return 'ابنته/ابنتها';
  }

  if (poss === 'ه')  return 'ابنه/ابنته';
  if (poss === 'ها') return 'ابنها/ابنتها';
  return 'ابنه/ابنته';
}

function toId(x){
  if (x == null) return null;
  const v = (typeof x === 'object') ? (x._id ?? x.id) : x;
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function makeResult(level, message, code, peopleIds, extra){
  const normalizedLevel = (level === 'error' || level === 'severe') ? 'severe' : 'info';

  const out = {
    level: normalizedLevel,
    message: String(message || ''),
    code: String(code || ''),
    peopleIds: Array.isArray(peopleIds) ? peopleIds.map(String) : undefined
  };

  if (extra && typeof extra === 'object'){
    if (extra.source) out.source = String(extra.source);
    if (extra.path)   out.path   = String(extra.path);
    if (extra.edge)   out.edge   = extra.edge;
    if (extra.hint)   out.hint   = extra.hint;
    if (extra.originLabel) out.originLabel = String(extra.originLabel);
    if (extra.peopleLabels && typeof extra.peopleLabels === 'object')
      out.peopleLabels = extra.peopleLabels;
  }

  return out;
}

function getBirthYear(p){
  if (!p) return null;

  const by =
    p.birthYear ?? p.bio?.birthYear ?? p.bio?.birth_year ??
    p.birth_year ?? null;

  if (by != null && String(by).trim() !== ''){
    const y = Number(by);
    if (Number.isFinite(y) && y > 0) return Math.trunc(y);
  }

  const bd =
    p.birthDate ?? p.bio?.birthDate ?? p.bio?.birth_date ??
    p.birth_date ?? null;

  if (bd){
    const s = String(bd).trim();
    const m = s.match(/^(\d{4})/);
    if (m){
      const y = Number(m[1]);
      if (Number.isFinite(y) && y > 0) return y;
    }
  }

  return null;
}

function getDeathYear(p){
  if (!p) return null;

  const dy =
    p.deathYear ?? p.bio?.deathYear ?? p.bio?.death_year ??
    p.death_year ?? null;

  if (dy != null && String(dy).trim() !== ''){
    const y = Number(dy);
    if (Number.isFinite(y) && y > 0) return Math.trunc(y);
  }

  const dd =
    p.deathDate ?? p.bio?.deathDate ?? p.bio?.death_date ??
    p.death_date ?? null;

  if (dd){
    const s = String(dd).trim();
    const m = s.match(/^(\d{4})/);
    if (m){
      const y = Number(m[1]);
      if (Number.isFinite(y) && y > 0) return y;
    }
  }

  return null;
}

function parseLifeDate(value){
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})$/);
  if (m){
    const y = Number(m[1]);
    if (Number.isFinite(y) && y > 0) return { y, m: null, d: null, precision:'year' };
    return null;
  }

  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m){
    const y = Number(m[1]);
    const mm = Number(m[2]);
    if (Number.isFinite(y) && y > 0 && mm >= 1 && mm <= 12){
      return { y, m: mm, d: null, precision:'month' };
    }
    return null;
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m){
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (Number.isFinite(y) && y > 0 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31){
      return { y, m: mm, d: dd, precision:'day' };
    }
    return null;
  }

  m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (m){
    const y = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : null;
    const dd = m[3] ? Number(m[3]) : null;
    if (!Number.isFinite(y) || y <= 0) return null;

    if (mm != null && (mm < 1 || mm > 12)) return { y, m:null, d:null, precision:'year' };
    if (dd != null && (dd < 1 || dd > 31)) return { y, m:mm, d:null, precision:'month' };

    return {
      y,
      m: mm ?? null,
      d: dd ?? null,
      precision: (dd != null) ? 'day' : (mm != null ? 'month' : 'year')
    };
  }

  return null;
}

function getBirthParts(p){
  const bd =
    p?.birthDate ?? p?.bio?.birthDate ?? p?.bio?.birth_date ??
    p?.birth_date ?? null;

  const a = parseLifeDate(bd);
  if (a) return a;

  const y = getBirthYear(p);
  return y ? { y, m:null, d:null, precision:'year' } : null;
}

function getDeathParts(p){
  const dd =
    p?.deathDate ?? p?.bio?.deathDate ?? p?.bio?.death_date ??
    p?.death_date ?? null;

  const a = parseLifeDate(dd);
  if (a) return a;

  const y = getDeathYear(p);
  return y ? { y, m:null, d:null, precision:'year' } : null;
}

function partsToDate(parts){
  if (!parts || !parts.y) return null;
  if (parts.m == null) return null;
  const d = (parts.d != null) ? parts.d : 1;
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, d, 0, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function compareLifeParts(a, b){
  const da = partsToDate(a);
  const db = partsToDate(b);
  if (da && db){
    const ta = da.getTime();
    const tb = db.getTime();
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  }

  if (a?.y != null && b?.y != null){
    if (a.y < b.y) return -1;
    if (a.y > b.y) return 1;
    return 0;
  }

  return null;
}

function displayName(p){
  if (!p) return '';
  const nm = (p.name || p.bio?.fullName || p.bio?.fullname || '').toString().trim();
  return nm || (p.role ? String(p.role) : '');
}

/* =========================
   تجميع/روابط
   ========================= */

function collectPeople(family){
  const byId = new Map();

  const reg = (p)=>{
    if (!p || typeof p !== 'object') return;
    const id = toId(p);
    if (id && !byId.has(id)) byId.set(id, p);

    const wives = Array.isArray(p.wives) ? p.wives : [];
    for (const w of wives) reg(w);

    const kids = Array.isArray(p.children) ? p.children : [];
    for (const c of kids) reg(c);
  };

  if (family?.persons && typeof family.persons === 'object'){
    Object.values(family.persons).forEach(reg);
  }

  (Array.isArray(family?.ancestors) ? family.ancestors : []).forEach(reg);
  reg(family?.father);
  reg(family?.rootPerson);

  (Array.isArray(family?.wives) ? family.wives : []).forEach(reg);

  return byId;
}

function buildParentChildEdges(family, byId){
  const edges = new Map();

  const addEdge = (pid, cid, rel = 'unknown')=>{
    pid = toId(pid); cid = toId(cid);
    if (!pid || !cid) return;
    if (pid === cid) return;

    let m = edges.get(pid);
    if (!m){ m = new Map(); edges.set(pid, m); }

    const prev = m.get(cid);
    if (prev === 'father' || prev === 'mother') return;

    m.set(cid, rel || 'unknown');
  };

  const scanParentChildren = (parent, motherId = null)=>{
    const pid = toId(parent);
    if (!pid) return;

    const kids = Array.isArray(parent?.children) ? parent.children : [];
    for (let i=0;i<kids.length;i++){
      const ch = kids[i];
      const cid = toId(ch);
      if (!cid) continue;

      addEdge(pid, cid, 'father');
      if (motherId) addEdge(motherId, cid, 'mother');
    }

    const wives = Array.isArray(parent?.wives) ? parent.wives : [];
    for (let wi=0; wi<wives.length; wi++){
      const w = wives[wi];
      const wid = toId(w);
      const wKids = Array.isArray(w?.children) ? w.children : [];
      for (let ci=0; ci<wKids.length; ci++){
        const ch = wKids[ci];
        const cid = toId(ch);
        if (!cid) continue;

        addEdge(pid, cid, 'father');
        if (wid) addEdge(wid, cid, 'mother');
      }
    }
  };

  for (const p of byId.values()){
    scanParentChildren(p);
  }

  for (const [cid, child] of byId.entries()){
    const fId = toId(child?.fatherId ?? child?.bio?.fatherId ?? child?.father_id ?? child?.bio?.father_id);
    const mId = toId(child?.motherId ?? child?.bio?.motherId ?? child?.mother_id ?? child?.bio?.mother_id);

    if (fId) addEdge(fId, cid, 'father');
    if (mId) addEdge(mId, cid, 'mother');
  }

  for (const [pid, parent] of byId.entries()){
    const ids = Array.isArray(parent?.childrenIds) ? parent.childrenIds : [];
    for (const cid of ids){
      if (!cid) continue;
      addEdge(pid, cid, 'unknown');
    }
  }

  return edges;
}

function buildValidationGraphFromCoreAndLineage(family){
  const fam = family && typeof family === 'object' ? (typeof structuredClone === 'function' ? structuredClone(family) : JSON.parse(JSON.stringify(family)))
    : null;

  if (!fam) return { byId: new Map(), edges: new Map(), ctx: null };

  const fromVer = Number.isFinite(+fam.__v) ? +fam.__v : 0;
  Model.normalizeFamilyPipeline(fam, { fromVer, markCore:false });

  const ctx = buildLineageContext(fam);

  const byId = new Map();
  for (const [id, p] of (ctx?.allById || new Map()).entries()){
    if (!id || !p) continue;
    byId.set(String(id), p);
  }

  const edges = new Map();

  const addEdge = (pid, cid, rel='unknown')=>{
    pid = toId(pid); cid = toId(cid);
    if (!pid || !cid) return;
    if (pid === cid) return;

    let m = edges.get(pid);
    if (!m){ m = new Map(); edges.set(pid, m); }

    const prev = m.get(cid);
    if (prev === 'father' || prev === 'mother'){
      if (rel === 'unknown' || rel === prev) return;
    }

    if (rel === 'father' || rel === 'mother') m.set(cid, rel);
    else if (!prev) m.set(cid, 'unknown');
  };

  if (ctx?.parentByChild && typeof ctx.parentByChild.entries === 'function'){
    for (const [cid, pr] of ctx.parentByChild.entries()){
      const childId = toId(cid);
      if (!childId || !pr) continue;

      if (pr.father) addEdge(pr.father, childId, 'father');
      if ('mother' in pr && pr.mother) addEdge(pr.mother, childId, 'mother');
    }
  }

  for (const [cid, p] of byId.entries()){
    const fId = toId(p?.fatherId ?? p?.bio?.fatherId);
    const mId = toId(p?.motherId ?? p?.bio?.motherId);

    if (fId) addEdge(fId, cid, 'father');
    if (mId) addEdge(mId, cid, 'mother');
  }

  for (const [pid, p] of byId.entries()){
    const ids = Array.isArray(p?.childrenIds) ? p.childrenIds : [];
    for (const cid of ids){
      addEdge(pid, cid, 'unknown');
    }
  }

  return { byId, edges, ctx, fam };
}

/* =========================
   Labels للمنطق
   ========================= */

function _deriveRoleForValidation(origRole, path, fam, personId){
  const r   = String(origRole || '').trim();
  const p   = String(path || '');
  const pid = personId ? String(personId) : '';

  if (!r) return '';

  if (fam && fam.rootPerson && pid){
    const root       = fam.rootPerson;
    const rootFather = root.fatherId ? String(root.fatherId) : null;
    const rootMother = root.motherId ? String(root.motherId) : null;

    if (rootFather && pid === rootFather && (r === 'الأب' || r === 'أب')) return 'أب صاحب الشجرة';
    if (rootMother && pid === rootMother && (r === 'الأم' || r === 'أم')) return 'أم صاحب الشجرة';
  }

  const isSon  = (r === 'ابن');
  const isDaug = (r === 'بنت');
  if (!isSon && !isDaug) return '';

  if (p && p.startsWith('father.children[')) {
    return isSon ? 'أخ صاحب الشجرة' : 'أخت صاحب الشجرة';
  }

  if (p && p.startsWith('rootPerson.children[')) {
    const childrenMatches = p.match(/children\[\d+\]/g) || [];
    const depth = childrenMatches.length;

    if (depth === 1) return '';
    if (depth === 2) return isSon ? 'حفيد صاحب الشجرة' : 'حفيدة صاحب الشجرة';
    if (depth >= 3) return isSon ? 'من نسل صاحب الشجرة (ذكر)' : 'من نسل صاحب الشجرة (أنثى)';
  }

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

  return '';
}

function _personLabelForValidation(p, fam){
  if (!p) return { name:'', role:'', label:'هذا الشخص', path:'' };

  const id   = toId(p);
  const name = displayName(p) || '';
  const roleRaw = String(p.role || '').trim();

  const path =
    (fam && id && typeof Model.findPathByIdInFamily === 'function') ? (Model.findPathByIdInFamily(fam, String(id)) || '')
      : '';

  const derivedRole = _deriveRoleForValidation(roleRaw, path, fam, String(id || ''));
  const role = derivedRole || roleRaw;

  const label =
    name && role ? `${name} — ${role}` :
    name ? name :
    role ? role :
    'هذا الشخص';

  return { name, role, label, path };
}

function vcJustName(p, fam){
  const info = _personLabelForValidation(p, fam);
  return (info?.name || '').trim() || vcNameOnly(info?.label || '');
}

/* =========================
   Checks
   ========================= */

function checkAges(byId, edges, out, fam){
  const push = (level, msg, code, ids, extra)=>{
    out.push(makeResult(level, msg, code || 'AGE_SANITY', ids, extra));
  };

  for (const [pid, childMap] of edges.entries()){
    for (const [cid, rel] of childMap.entries()){
      const P = byId.get(String(pid));
      const C = byId.get(String(cid));
      if (!P || !C) continue;

      const py = getBirthYear(P);
      const cy = getBirthYear(C);
      if (!py || !cy) continue;

      const diff = cy - py;

      const pInfo = _personLabelForValidation(P, fam);
      const cInfo = _personLabelForValidation(C, fam);
      const gp = genderPack(P);
      const childName = vcJustName(C, fam);
      const childRelWord = vcParentChildNoun(P, C);
      const childPhrase = childName ? `${childRelWord} ${childName}` : childRelWord;

      const relLabel =
        rel === 'mother' ? 'الأم' :
        rel === 'father' ? 'الأب' :
        'الوالد';

      const extra = {
        source: 'edges',
        path: null,
        hint: null,
        peopleLabels: {
          [String(pid)]: pInfo.label,
          [String(cid)]: cInfo.label
        },
        edge: { from: String(pid), to: String(cid) },
        originLabel: relLabel
      };

      if (diff <= 0){
        const cmp = (diff === 0) ? 'بنفس عمر' : 'أصغر من';
        out.push(makeResult(
          'severe',
          `عمر غير منطقي: ${pInfo.label} ${cmp} ${childPhrase} (فرق السنوات ${diff}).`,
          'AGE_PARENT_YOUNGER',
          [pid, cid],
          extra
        ));
        continue;
      }

      if (diff < 12){
        out.push(makeResult(
          'severe',
          `عمر إنجاب غير منطقي: ${pInfo.label} ${gp.agePron} تقريبًا ${diff} عند ولادة ${childPhrase} (أقل من 12).`,
          'AGE_TOO_YOUNG',
          [pid, cid],
          extra
        ));
        continue;
      }

      if (diff > 70){
        out.push(makeResult(
          'severe',
          `عمر إنجاب غير منطقي: ${pInfo.label} ${gp.agePron} تقريبًا ${diff} عند ولادة ${childPhrase} (أكثر من 70).`,
          'AGE_TOO_OLD',
          [pid, cid],
          extra
        ));
        continue;
      }

      if (diff < 16){
        out.push(makeResult(
          'info',
          `ملاحظة: ${pInfo.label} ${gp.agePron} تقريبًا ${diff} عند ولادة ${childPhrase} (صغير جدًا).`,
          'AGE_SMALL_GAP',
          [pid, cid],
          extra
        ));
      } else if (diff < 18){
        out.push(makeResult(
          'info',
          `ملاحظة: فرق العمر بين ${pInfo.label} و ${childPhrase} حوالي ${diff} سنة.`,
          'AGE_INFO',
          [pid, cid],
          extra
        ));
      } else if (diff > 55){
        out.push(makeResult(
          'info',
          `تحذير: فرق عمر كبير بين ${pInfo.label} و ${childPhrase} حوالي ${diff} سنة.`,
          'AGE_LARGE_GAP',
          [pid, cid],
          extra
        ));
      }

      const nowYear = (new Date()).getFullYear();

      if (py > nowYear){
        out.push(makeResult(
          'severe',
          `تاريخ ميلاد غير منطقي: ${pInfo.label} سنة الميلاد ${py} أكبر من السنة الحالية ${nowYear}.`,
          'BIRTH_IN_FUTURE',
          [pid],
          { ...extra, hint:{ action:'review', field:'birthYear' } }
        ));
      }

      if (cy > nowYear){
        out.push(makeResult(
          'severe',
          `تاريخ ميلاد غير منطقي: ${cInfo.label} سنة الميلاد ${cy} أكبر من السنة الحالية ${nowYear}.`,
          'BIRTH_IN_FUTURE',
          [cid],
          { ...extra, hint:{ action:'review', field:'birthYear' } }
        ));
      }
    }
  }
}

function buildSpousePairs(byId){
  const pairs = [];
  const seen = new Set();

  const addPair = (a, b)=>{
    const x = toId(a), y = toId(b);
    if (!x || !y) return;
    if (x === y) return;
    const A = String(x), B = String(y);
    const key = (A < B) ? `${A}|${B}` : `${B}|${A}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([A, B]);
  };

  for (const p of (byId?.values?.() || [])){
    const pid = toId(p);
    if (!pid) continue;
    const wives = Array.isArray(p?.wives) ? p.wives : [];
    for (const w of wives){
      addPair(pid, w);
    }
  }

  for (const [id, p] of (byId?.entries?.() || [])){
    const pid = String(id);
    const sids = Array.isArray(p?.spousesIds) ? p.spousesIds : [];
    for (const sid of sids){
      addPair(pid, sid);
    }
  }

  return pairs;
}

function checkSpouseAgeGap(byId, out, fam){
  const push = (level, msg, code, ids, extra)=>{
    out.push(makeResult(level, msg, code || 'SPOUSE_AGE_SANITY', ids, extra));
  };

  const pairs = buildSpousePairs(byId);

  for (const [a, b] of pairs){
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B) continue;

    const ay = getBirthYear(A);
    const by = getBirthYear(B);
    if (!ay || !by) continue;

    const diff = Math.abs(by - ay);

    const aInfo = _personLabelForValidation(A, fam);
    const bInfo = _personLabelForValidation(B, fam);

    const extra = {
      source: 'spouses',
      path: null,
      hint: null,
      peopleLabels: { [a]: aInfo.label, [b]: bInfo.label },
      edge: { from: a, to: b },
      originLabel: 'الزوجان'
    };

    if (diff >= 60){
      push('severe',
        `فرق عمر غير منطقي بين الزوجين: ${aInfo.label} و ${bInfo.label} (فرق السنوات ${diff}).`,
        'SPOUSE_AGE_IMPOSSIBLE',
        [a, b],
        extra
      );
      continue;
    }

    if (diff >= 35){
      push('info',
        `تحذير: فرق عمر كبير بين الزوجين: ${aInfo.label} و ${bInfo.label} حوالي ${diff} سنة.`,
        'SPOUSE_AGE_LARGE_GAP',
        [a, b],
        extra
      );
      continue;
    }

    if (diff >= 20){
      push('info',
        `ملاحظة: فرق عمر ملحوظ بين الزوجين: ${aInfo.label} و ${bInfo.label} حوالي ${diff} سنة.`,
        'SPOUSE_AGE_NOTE',
        [a, b],
        extra
      );
    }
  }
}

function checkDeaths(byId, edges, out, fam){
  const push = (level, msg, code, ids, extra)=>{
    out.push(makeResult(level, msg, code || 'DEATH_SANITY', ids, extra));
  };

  const nowYear = (new Date()).getFullYear();

  for (const [id, p] of (byId?.entries?.() || [])){
    if (!p) continue;

    const pid = String(id);
    const by  = getBirthYear(p);
    const dy  = getDeathYear(p);
    if (!dy) continue;

    const pInfo = _personLabelForValidation(p, fam);

    const extra = {
      source: 'death',
      path: null,
      hint: null,
      peopleLabels: { [pid]: pInfo.label }
    };

    if (by && dy < by){
      push(
        'severe',
        `وفاة غير منطقية: ${pInfo.label} سنة الوفاة ${dy} قبل سنة الميلاد ${by}.`,
        'DEATH_BEFORE_BIRTH',
        [pid],
        extra
      );
    }

    if (by && dy >= by){
      const ageAtDeath = dy - by;

      if (ageAtDeath > 120){
        push(
          'severe',
          `عمر غير منطقي عند الوفاة: ${pInfo.label} عمره تقريبًا ${ageAtDeath} سنة (أكثر من 120).`,
          'AGE_AT_DEATH_IMPOSSIBLE',
          [pid],
          { ...extra, hint:{ action:'review', field:'birthYear' } }
        );
      } else if (ageAtDeath > 100){
        push(
          'info',
          `تحذير: عمر كبير عند الوفاة: ${pInfo.label} عمره تقريبًا ${ageAtDeath} سنة (أكثر من 100).`,
          'AGE_AT_DEATH_VERY_OLD',
          [pid],
          extra
        );
      } else if (ageAtDeath === 0){
        const bp = getBirthParts(p);
        const dp = getDeathParts(p);
        if (bp?.precision !== 'year' || dp?.precision !== 'year'){
          push(
            'info',
            `ملاحظة: ${pInfo.label} سنة الميلاد والوفاة تبدو في نفس السنة، راجع التواريخ التفصيلية إن وُجدت.`,
            'AGE_AT_DEATH_ZERO_REVIEW',
            [pid],
            extra
          );
        }
      }
    }

    if (dy > nowYear){
      push(
        'severe',
        `تاريخ وفاة غير منطقي: ${pInfo.label} سنة الوفاة ${dy} أكبر من السنة الحالية ${nowYear}.`,
        'DEATH_IN_FUTURE',
        [pid],
        { ...extra, hint:{ action:'review', field:'deathYear' } }
      );
    }
  }

  for (const [pid, childMap] of edges.entries()){
    for (const [cid, rel] of childMap.entries()){
      const P = byId.get(String(pid));
      const C = byId.get(String(cid));
      if (!P || !C) continue;

      const pDeathParts = getDeathParts(P);
      const cBirthParts = getBirthParts(C);
      if (!pDeathParts?.y || !cBirthParts?.y) continue;

      const childAfterDeathYears = cBirthParts.y - pDeathParts.y;
      const cmp = compareLifeParts(pDeathParts, cBirthParts);

      const deathBeforeBirth = (cmp === -1);
      const deathBeforeBirthByYearOnly = (cmp == null) ? (pDeathParts.y < cBirthParts.y) : false;
      const isDeathBeforeBirth = deathBeforeBirth || deathBeforeBirthByYearOnly;

      if (isDeathBeforeBirth){
        const pInfo = _personLabelForValidation(P, fam);
        const cLabel = _personLabelForValidation(C, fam).label;

        const relLabel =
          rel === 'mother' ? 'الأم' :
          rel === 'father' ? 'الأب' :
          'الوالد';

        const extra = {
          source: 'death',
          path: null,
          hint: null,
          peopleLabels: {
            [String(pid)]: pInfo.label,
            [String(cid)]: cLabel
          },
          edge: { from: String(pid), to: String(cid) },
          originLabel: relLabel
        };

        const childName = vcJustName(C, fam);
        const childRelWord = vcParentChildNoun(P, C);
        const childPhrase = childName ? `${childRelWord} ${childName}` : childRelWord;

        if (rel === 'father' && childAfterDeathYears >= 0 && childAfterDeathYears <= 1){
          const deltaText = (childAfterDeathYears === 0) ? 'بنفس السنة' : 'بعدها بسنة تقريبًا';
          push(
            'info',
            `ملاحظة (احتمال ولادة بعد وفاة الأب): ${pInfo.label} توفّي سنة ${pDeathParts.y}، وميلاد ${childPhrase} سنة ${cBirthParts.y} (${deltaText}).`,
            'POSTHUMOUS_BIRTH_POSSIBLE',
            [pid, cid],
            extra
          );
        } else {
          push(
            'severe',
            `وفاة غير منطقية: ${pInfo.label} توفّي سنة ${pDeathParts.y} قبل ميلاد ${childPhrase} سنة ${cBirthParts.y}.`,
            'DEATH_PARENT_BEFORE_CHILD_BIRTH',
            [pid, cid],
            extra
          );
        }

        continue;
      }

      if (pDeathParts.y === cBirthParts.y){
        const hasDetails = (pDeathParts.precision !== 'year' || cBirthParts.precision !== 'year');
        if (hasDetails){
          const pInfo = _personLabelForValidation(P, fam);
          const cInfo = _personLabelForValidation(C, fam);

          const relLabel =
            rel === 'mother' ? 'الأم' :
            rel === 'father' ? 'الأب' :
            'الوالد';

          const extra = {
            source: 'death',
            path: null,
            hint: null,
            peopleLabels: {
              [String(pid)]: pInfo.label,
              [String(cid)]: cInfo.label
            },
            edge: { from: String(pid), to: String(cid) },
            originLabel: relLabel
          };

          push(
            'info',
            `ملاحظة: تواريخ تفصيلية موجودة لكن السنة متساوية (${pDeathParts.y}) بين وفاة ${pInfo.label} وميلاد ${cInfo.label}. راجع الشهر/اليوم لتفادي حكم خاطئ.`,
            'YEAR_ONLY_AMBIGUITY_REVIEW',
            [pid, cid],
            extra
          );
        }
      }

      const diff = pDeathParts.y - cBirthParts.y;
      if (diff >= 0 && diff <= 1){
        const pInfo = _personLabelForValidation(P, fam);
        const cInfo = _personLabelForValidation(C, fam);

        const relLabel =
          rel === 'mother' ? 'الأم' :
          rel === 'father' ? 'الأب' :
          'الوالد';

        const extra = {
          source: 'death',
          path: null,
          hint: null,
          peopleLabels: {
            [String(pid)]: pInfo.label,
            [String(cid)]: cInfo.label
          },
          edge: { from: String(pid), to: String(cid) },
          originLabel: relLabel
        };

        const childName = vcJustName(C, fam);
        const childRelWord = vcParentChildNoun(P, C);
        const childPhrase = childName ? `${childRelWord} ${childName}` : childRelWord;

        const ageText = (diff === 0) ? 'أقل من سنة' : 'حوالي سنة';

        push(
          'info',
          `ملاحظة: ${pInfo.label} توفّي سنة ${pDeathParts.y} وكان عمر ${childPhrase} ${ageText} (أقل من سنتين).`,
          'DEATH_PARENT_WHEN_CHILD_INFANT',
          [pid, cid],
          extra
        );
      }
    }
  }

  const pairs = buildSpousePairs(byId);

  for (const [a, b] of pairs){
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B) continue;

    const aDeath = getDeathYear(A);
    const bDeath = getDeathYear(B);
    const aBirth = getBirthYear(A);
    const bBirth = getBirthYear(B);

    const aInfo = _personLabelForValidation(A, fam);
    const bInfo = _personLabelForValidation(B, fam);

    const extra = {
      source: 'death',
      path: null,
      hint: null,
      peopleLabels: { [a]: aInfo.label, [b]: bInfo.label },
      edge: { from: a, to: b },
      originLabel: 'الزوجان'
    };

    if (aDeath && bBirth && aDeath < bBirth){
      push(
        'severe',
        `وفاة غير منطقية بين الزوجين: ${aInfo.label} توفّي سنة ${aDeath} قبل ميلاد ${bInfo.label} سنة ${bBirth}.`,
        'DEATH_SPOUSE_BEFORE_OTHER_BIRTH',
        [a, b],
        extra
      );
    }

    if (bDeath && aBirth && bDeath < aBirth){
      push(
        'severe',
        `وفاة غير منطقية بين الزوجين: ${bInfo.label} توفّي سنة ${bDeath} قبل ميلاد ${aInfo.label} سنة ${aBirth}.`,
        'DEATH_SPOUSE_BEFORE_OTHER_BIRTH',
        [a, b],
        extra
      );
    }
  }
}

/* =========================
   API الرئيسي
   ========================= */

export function validateFamily(family){
  const warnings = [];

  if (!family || typeof family !== 'object'){
    return {
      errors: [],
      warnings: [
        makeResult('severe','بيانات العائلة غير صالحة (ليست كائنًا).','BAD_FAMILY', null, { source:'validateFamily' })
      ]
    };
  }

  let graph = buildValidationGraphFromCoreAndLineage(family);
  let byId  = graph.byId;
  let edges = graph.edges;

  if (!byId || byId.size === 0){
    byId  = collectPeople(family);
    edges = buildParentChildEdges(family, byId);
  }

  const famForLabels = (byId && byId.size > 0) ? (graph?.fam || family) : family;
  checkAges(byId, edges, warnings, famForLabels);
  checkSpouseAgeGap(byId, warnings, famForLabels);
  checkDeaths(byId, edges, warnings, famForLabels);

  const uniqObj = (arr)=>{
    const out = [];
    const seen = new Set();
    for (const r of (arr || [])){
      if (!r) continue;
      const key =
        `${r.level}|${r.code}|${r.message}|${Array.isArray(r.peopleIds)?r.peopleIds.join(','):''}|${r.source||''}|${r.path||''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  };

  return { errors: [], warnings: uniqObj(warnings) };
}
