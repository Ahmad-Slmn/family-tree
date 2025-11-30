// tree.js — ملف الدخول الرئيسي (orchestrator)
// يجمع: عرض الشجرة + البحث + البطاقات + أقسام السيرة + أزرار العائلات

import { el, textEl, byId, getArabicOrdinal } from '../utils.js';
import * as Lineage from '../features/lineage.js';

import {
  AR_DIAC,
  AR_TATWEEL,
  normalizeAr,
  makeMatcher,
  roleGroup,
  scoreForSearch,
  describeActiveFiltersAr,
  collectPersonsForSearch,
  buildHierarchyIndex,
  getHierarchyRank,
  makePassFilters
} from './tree.search.js';

import {
  getRoleAvatar,
  createCard,
  upsertCard,
  pruneRemoved,
  resetCardsState,
  clearPhotoCache,
  clearPersonPhotoCache,
  refreshAvatarById,
  createConnector,
  createCounterBox,
  createCounterBoxForPerson,
  createWifeSection,
  toggleConnectors
} from './tree.cards.js';

import {
  renderBioInfo,
  renderListSection,
  renderBioSections,
  getAvailableBioModes
} from './tree.bioSections.js';


import {
  renderFamilyButtons,
  updatePrintButtonLabel
} from './tree.familyButtons.js';

// ===== حالة الاستعلام/العائلة الأخيرة =====
let _lastKey = null, _lastQuery = '';

// ===== جدولة رسم متدرّج عند خمول المتصفح =====
const _ric = window.requestIdleCallback || (cb => setTimeout(
  () => cb({ timeRemaining: () => 0, didTimeout: true }), 1
));

function runChunked(list, chunkSize, fn, done){
  let i = 0;
  function step(){
    _ric((idle) => {
      const budget = idle && typeof idle.timeRemaining === 'function' ? idle.timeRemaining() : 0;
      const dyn = budget > 8 ? Math.max(chunkSize, Math.ceil(chunkSize * 2)) : chunkSize;
      const end = Math.min(i + dyn, list.length);
      for (; i < end; i++) fn(list[i], i);
      if (i < list.length) step(); else if (done) done();
    });
  }
  if (list.length) step(); else if (done) done();
}

// ===== رسم الشجرة الرئيسية (بحث/فلاتر/زوجات/أبناء) =====
export function drawFamilyTree(families = {}, selectedKey = null, domRefs = {}, handlers = {}){
  const tree = (domRefs && domRefs.familyTree) || byId('familyTree'); if (!tree) return;

  const sameKey = _lastKey === selectedKey;
  const q   = (handlers && handlers.getSearch && handlers.getSearch()) || (domRefs && domRefs.searchText) || '';
  const flt = (handlers && handlers.getFilters && handlers.getFilters()) || { role:'', clan:'', birthFrom:'', birthTo:'' };
  const hasNonRoleFilters = !!(flt.clan || flt.birthFrom || flt.birthTo);
  const hideParents = (flt.role === 'ابن' || flt.role === 'بنت' || hasNonRoleFilters);
  const filtersActive = !!(flt.role || flt.clan || flt.birthFrom || flt.birthTo);

  let _drawnTotal = 0;
  tree.innerHTML = '';

  if (!sameKey || q !== _lastQuery){
    resetCardsState();
  }
  _lastKey = selectedKey; _lastQuery = q;

  const __currentIds = new Set();
  const fam = families[selectedKey];
  window.__CURRENT_FAMILY__ = fam;

  const lineageCtx = Lineage.buildLineageContext(fam);
  window.__LINEAGE_CTX__ = lineageCtx;

  if (!fam || fam.hidden){
    const titleEl = (domRefs && domRefs.treeTitle) || byId('treeTitle');
    if (titleEl) titleEl.textContent = 'عائلة';
    pruneRemoved(new Set());
    const treeArea = byId('familyTree');
    if (treeArea){
      treeArea.innerHTML = `
  <style>
    #familyTree .no-family-message{background:var(--card-bg);color:var(--text-main);border:1px dashed var(--ancestor-border);
      border-radius:var(--radius);box-shadow:var(--shadow);padding:1rem 1.25rem;margin:1rem auto;max-width:720px;text-align:center;line-height:1.6}
    #familyTree .no-family-message .title{color:var(--title-color);font-weight:700;margin-bottom:.25rem}
    #familyTree .no-family-message b{color:var(--title-color);font-weight:600}
  </style>
  <div class="no-family-message" role="status" aria-live="polite">
    <div class="title">لا توجد عائلات مرئية حالياً</div>
    <div>يمكنك <b>إضافة عائلة جديدة</b> أو <b>إظهار العائلات الأساسية المخفية</b> من إعدادات إعادة الضبط.</div>
  </div>`;
    }
    return;
  }

  const orderAncestors = (f) => {
    if (!f) return [];
    const ord = getArabicOrdinal;

    let anc = Array.isArray(f.ancestors) ? f.ancestors.slice() : [];

    anc = anc.map((a, idx) => {
      const g = Number.isFinite(+a.generation) ? +a.generation : (idx + 1) || 1;
      let role = String(a.role || '').trim();

      const m = role.match(/^الجد\s*(\d+)$/u);
      if (m) {
        const n = parseInt(m[1], 10) || g;
        role = `الجد ${ord(n)}`;
      } else if (!role || role === 'جد' || /^الجد\s*\d+$/u.test(role)) {
        role = `الجد ${ord(g)}`;
      }

      const ref = (a && a._id && lineageCtx?.byId?.get(String(a._id))) || a;

      return {
        ...a,
        generation: g,
        role,
        childrenIds: Array.isArray(ref.childrenIds) ? ref.childrenIds : a.childrenIds,
        fatherId: ref.fatherId || a.fatherId,
        motherId: ref.motherId || a.motherId
      };
    });

    const fatherRef = (f.father && f.father._id && lineageCtx.byId.get(String(f.father._id))) || f.father;

    const father = fatherRef ? [{
      ...fatherRef,
      role: fatherRef.role || 'الأب',
      childrenIds: Array.isArray(fatherRef.childrenIds) ? fatherRef.childrenIds : []
    }] : [];

    const rootRef = (f.rootPerson && f.rootPerson._id && lineageCtx.byId.get(String(f.rootPerson._id))) || f.rootPerson;

    const root = rootRef ? [{
      ...rootRef,
      role: rootRef.role || 'صاحب الشجرة',
      childrenIds: Array.isArray(rootRef.childrenIds) ? rootRef.childrenIds : []
    }] : [];

    const ancForRender = anc.slice().reverse();

    return [...ancForRender, ...father, ...root].filter(Boolean);
  };

  const match = makeMatcher(q, { fields: ['name','role','cognomen'] });
  const passFilters = makePassFilters(flt, fam, lineageCtx);

  let tools = null, toggle = null;
  const setMotherVisibility = (on) => {
    tree.querySelectorAll('.mini-strip.mother-strip').forEach(e => { e.style.display = on ? '' : 'none'; });
  };
  if(q){
    tools=el('div','generation tree-tools');
    const wrap=el('div','tree-tools-wrap');
    const motherWrap=el('div','mother-toggle'); motherWrap.id='motherToggleWrap';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.id='toggleMotherName'; chk.checked=true;
    const lbl=textEl('span','إظهار اسم الأم');
    motherWrap.append(chk,lbl);
    const res=el('div','results-count');
    const strongQ=textEl('strong',String(q));
    const strongNum=textEl('strong','0','resultsNum'); strongNum.id='resultsNum'; strongNum.setAttribute('aria-live','polite');
    res.append(textEl('span','نتائج البحث عن "'),strongQ,textEl('span','": '),strongNum);
    wrap.append(motherWrap,res); tools.appendChild(wrap); tree.appendChild(tools);
    toggle=chk; toggle.addEventListener('change',()=>setMotherVisibility(!!toggle.checked));
  }

  const showMotherHint = !!q;

  const titleEl = (domRefs && domRefs.treeTitle) || byId('treeTitle');
  if (titleEl) {
    const full  = (fam.fullRootPersonName || '').trim();
    const short = (fam.familyName || fam.title || fam.rootPerson?.name || '').trim();

    const label = short || full || '';

    titleEl.textContent = label ? `عائلة: ${label}` : 'عائلة';

    if (label) {
      titleEl.title = `عائلة: ${label}`;
      titleEl.setAttribute('aria-label', `عائلة: ${label}`);
    } else {
      titleEl.removeAttribute('title');
      titleEl.removeAttribute('aria-label');
    }
  }

  updatePrintButtonLabel(families, selectedKey);

  const ancestors = orderAncestors(fam);
  const filteredAncestors = ancestors.filter(p => match(p) && passFilters(p));

  const countChildrenAll = (family) => {
    const acc = { sons: 0, daughters: 0, total: 0 };
    (family.wives || []).forEach(w => (w.children || []).forEach(c => {
      const r = (c?.role || '').trim();
      if (r === 'ابن') acc.sons++; else if (r === 'بنت') acc.daughters++;
    }));
    acc.total = acc.sons + acc.daughters; return acc;
  };

  if (!q){
    filteredAncestors.forEach((person, idx) => {
     const generation = el('div','generation ancestor-generation');
      const isRoot = person === fam.rootPerson || person.role === 'صاحب الشجرة';
      const cls = `ancestor${isRoot ? ' rootPerson' : ''}`;
      const card = upsertCard(
        generation,
        person,
        handlers,
        cls,
        { showMotherHint, readonlyName: !!fam.__core }
      );

      _drawnTotal++;
      if (isRoot){
        const sibResolved = Lineage.resolveSiblings(person, fam, lineageCtx);
        const sib = {
          brothers: (sibResolved?.brothers || []).length || 0,
          sisters:  (sibResolved?.sisters  || []).length || 0,
          wives:    (fam.wives || []).length
        };

        const allC = countChildrenAll(fam);
        const merged = [];

        if (sib.brothers) merged.push({label:'الإخوة', value:sib.brothers});
        if (sib.sisters)  merged.push({label:'الأخوات', value:sib.sisters});
        if (sib.wives)    merged.push({label:'الزوجات', value:sib.wives});

        if (allC.sons)      merged.push({label:'الأبناء', value:allC.sons});
        if (allC.daughters) merged.push({label:'البنات', value:allC.daughters});
        if (allC.total)     merged.push({label:'الإجمالي', value:allC.total});

        const uaRoot = Lineage.resolveUnclesAunts(person, fam, lineageCtx);

        if (uaRoot.paternalUncles?.length)
          merged.push({label:'الأعمام', value:uaRoot.paternalUncles.length});
        if (uaRoot.paternalAunts?.length)
          merged.push({label:'العمّات', value:uaRoot.paternalAunts.length});
        if (uaRoot.maternalUncles?.length)
          merged.push({label:'الأخوال', value:uaRoot.maternalUncles.length});
        if (uaRoot.maternalAunts?.length)
          merged.push({label:'الخالات', value:uaRoot.maternalAunts.length});

        const cb = createCounterBox(merged);
        if (cb) card.appendChild(cb);

      } else {
        const auto = createCounterBoxForPerson(person);
        if (auto) card.appendChild(auto);
      }

      if (person && person._id) __currentIds.add(person._id);

      if (idx < filteredAncestors.length - 1) generation.appendChild(createConnector());
      tree.appendChild(generation);
    });
  }

if (q){
  const tokens = normalizeAr(q).split(/\s+/).filter(Boolean);
  const tokensRaw = String(q || '').trim().split(/\s+/).filter(Boolean);

  const pool = collectPersonsForSearch(fam);
  const results = pool.filter(p => match(p) && passFilters(p));

  // NEW: إزالة التكرارات حتى لا يكون العدّ أكبر من عدد البطاقات/الاقتراحات
  const seen = new Set();
  const uniqResults = [];
  for (const p of results){
    const id = p?._id || p?.id || p?.__tempId || null;
    const key = id  ? `id:${id}`
      : `nr:${(p.name||'').trim()}|${(p.role||'').trim()}|${(p?.bio?.motherName||'').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqResults.push(p);
  }

  if (!uniqResults.length){
    const empty = el('div','empty-state');
    empty.style.cssText='padding:2rem;text-align:center;opacity:.8';
    empty.append(textEl('span','لا توجد نتائج مطابقة لـ "'),
                 textEl('strong', String(q)),
                 textEl('span','"'));
    tree.appendChild(empty);
    setMotherVisibility(false);
    pruneRemoved(new Set());
    toggleConnectors(tree, false);
    return;
  }

  const coll = new Intl.Collator('ar', { usage:'search', sensitivity:'base', ignorePunctuation:true });
  const hierarchyOrder = buildHierarchyIndex(fam);

  uniqResults.sort((a,b)=>{
    const ra = getHierarchyRank(hierarchyOrder, a);
    const rb = getHierarchyRank(hierarchyOrder, b);
    if (ra !== rb) return ra - rb;

    const sa = scoreForSearch(a, tokens);
    const sb = scoreForSearch(b, tokens);
    if (sb !== sa) return sb - sa;

    const coll2 = new Intl.Collator('ar', { usage:'search', sensitivity:'base', ignorePunctuation:true });
    return coll2.compare(String(a.name||''), String(b.name||''));
  });

  const wrap = el('div','generation search-results');
  const grid = el('div','children-grid');

  uniqResults.forEach(p => {
    const wrapCard = el('div','relative');
    const cls = (p.role === 'ابن') ? 'son' : (p.role === 'بنت' ? 'daughter' : '');

    const cgNorm = normalizeAr(p?.bio?.cognomen || '');
    const nameRoleNorm = normalizeAr(`${p?.name||''} ${p?.role||''}`);
    const hitCogOnly =
      tokens.some(t => cgNorm.includes(t)) &&
      !tokens.some(t => nameRoleNorm.includes(t));

    const card = upsertCard(
      wrapCard,
      p,
      handlers,
      cls,
      {
        showMotherHint,
        highlightTokens: tokensRaw,
        showCognomenHint: hitCogOnly,
        readonlyName: !!fam.__core
      }
    );

    const box = createCounterBoxForPerson(p);
    if (box && !card.querySelector('.counter-box')) card.appendChild(box);
    grid.appendChild(wrapCard);
    if (p && p._id) __currentIds.add(p._id);
  });

  wrap.appendChild(grid);
  tree.appendChild(wrap);

  const numEl = tree.querySelector('#resultsNum');
  if (numEl) numEl.textContent = String(uniqResults.length);

  setMotherVisibility(showMotherHint);
  pruneRemoved(__currentIds);
  toggleConnectors(tree, false);
  return;
}


  if (flt.role && !['زوجة','ابن','بنت'].includes(flt.role)){
    if (filtersActive && _drawnTotal === 0){
      const empty = el('div','empty-state'); 
      empty.style.cssText='padding:2rem;text-align:center;opacity:.8';

      const desc = describeActiveFiltersAr(flt);
      empty.append(
        textEl('span','لا توجد نتائج مطابقة لـ '),
        textEl('strong', String(desc)),
        textEl('span','.')
      );

      tree.appendChild(empty);
      toggleConnectors(tree, false);
    }

    pruneRemoved(__currentIds);
    return;
  }

  const wivesSection = el('div','generation wives-section');
  const wantRole = (flt && flt.role) || '';
  const filteredWives = (fam.wives || []).filter(w => {
    if (wantRole === 'ابن' || wantRole === 'بنت') return (w.children || []).some(c => match(c) && passFilters(c));
    if (!wantRole && hasNonRoleFilters) return passFilters(w) || (w.children || []).some(c => (!match || match(c)) && passFilters(c));
    if (!wantRole) return match(w) || (w.children || []).some(c => match(c) && passFilters(c));
    return passFilters(w);
  });

  tree.appendChild(wivesSection);
  runChunked(
    filteredWives,
    1,
    (w) => {
      const sec = createWifeSection(
        w,
        handlers,
        match,
        passFilters,
        {
          showMotherHint,
          hideNonMatchingParents: hideParents,
          hasQuery: !!q,
          readonlyName: !!fam.__core
        }
      );

      if (sec){
        wivesSection.appendChild(sec);
        _drawnTotal += sec.querySelectorAll('.member-card').length;

        if (w && w._id) __currentIds.add(w._id);
        (w.children||[]).forEach(c => {
          if ((!match || match(c)) && passFilters(c) && c?._id) __currentIds.add(c._id);
        });
      }
    },
    () => {
      if (q){
        const anyMother = !!tree.querySelector('.mini-strip.mother-strip');
        const toggleWrap = tools ? tools.querySelector('#motherToggleWrap') : null;

        if (!anyMother){
          if (toggle){ toggle.checked = false; toggle.disabled = true; }
          if (toggleWrap) toggleWrap.style.display = 'none';
          setMotherVisibility(false);
        } else {
          if (toggle){ toggle.disabled = false; toggle.checked = true; }
          if (toggleWrap) toggleWrap.style.display = '';
          setMotherVisibility(true);
        }

        const numEl = tree.querySelector('#resultsNum');
        if (numEl) numEl.textContent = String(tree.querySelectorAll('.member-card').length);
      } else {
        if (tools) tools.remove();
        setMotherVisibility(false);
      }

      if (!q && filtersActive && _drawnTotal === 0){
        const empty = el('div','empty-state'); 
        empty.style.cssText='padding:2rem;text-align:center;opacity:.8';

        const desc = describeActiveFiltersAr(flt);
        empty.append(
          textEl('span','لا توجد نتائج مطابقة لـ '),
          textEl('strong', String(desc)),
          textEl('span','.')
        );

        tree.appendChild(empty);
        toggleConnectors(tree, false);
      }

      toggleConnectors(tree, !q);
      pruneRemoved(__currentIds);
    }
  );
}

// إعادة تصدير الدوال/الثوابت كما كانت من قبل
export {
  AR_DIAC,
  AR_TATWEEL,
  normalizeAr,
  makeMatcher,
  roleGroup,
  scoreForSearch,
  renderBioInfo,
  renderListSection,
  renderBioSections,
  getAvailableBioModes,
  getRoleAvatar,
  createCard,
  renderFamilyButtons,
  updatePrintButtonLabel,
  refreshAvatarById,
  clearPhotoCache,
  clearPersonPhotoCache
};
