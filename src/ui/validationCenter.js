// src/ui/validationCenter.js
// =======================================
// واجهة مركز تنبيهات التحقق: تخزين/تلخيص/عرض نتائج validateFamily لكل عائلة مع شارة وعدّاد ونافذة منبثقة (مع حفظ محلي)
// =======================================

import { validateFamily } from '../features/validate.js';

/* =========================
   Store + LocalStorage
   ========================= */

const store = new Map();
const VC_STORE_KEY = 'validationCenterStore:v1';

const VC_MAX_ENTRIES = 20;
const VC_TTL_DAYS    = 7;
const VC_TTL_MS      = VC_TTL_DAYS * 24 * 60 * 60 * 1000;

let _lsOk = true;

function payloadTs(payload){
  const t = payload?.meta?.ts;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function pruneStore(){
  const now = Date.now();

  for (const [k, payload] of store.entries()){
    const ts = payloadTs(payload);
    if (ts && (now - ts) > VC_TTL_MS){
      store.delete(k);
    }
  }

  if (store.size <= VC_MAX_ENTRIES) return;

  const entries = Array.from(store.entries()).map(([k, payload]) => ({
    k, payload, ts: payloadTs(payload)
  }));

  const protectedKeys = new Set();
  if (store.has('import:latest')) protectedKeys.add('import:latest');

  const activeScope = getActiveFamilyScopeKey?.();
  if (activeScope && store.has(activeScope)) protectedKeys.add(activeScope);

  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const keep = new Set();
  for (const pk of protectedKeys) keep.add(pk);

  for (const it of entries){
    if (keep.size >= VC_MAX_ENTRIES) break;
    keep.add(it.k);
  }

  for (const [k] of store.entries()){
    if (!keep.has(k)) store.delete(k);
  }
}

function saveStoreToLS(){
  pruneStore();
  if (!_lsOk) return;

  try{
    const arr = Array.from(store.entries());
    localStorage.setItem(VC_STORE_KEY, JSON.stringify(arr));
  }catch{
    _lsOk = false;
  }
}

function normalizePayload(payload){
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = {
    title: String(p.title || 'تنبيهات التحقق'),
    errors: Array.isArray(p.errors) ? p.errors.slice() : [],
    warnings: Array.isArray(p.warnings) ? p.warnings.slice() : [],
    items: Array.isArray(p.items) ? p.items.map(it => ({
      key: it?.key != null ? String(it.key) : '',
      title: String(it?.title || it?.key || ''),
      errors: Array.isArray(it?.errors) ? it.errors.slice() : [],
      warnings: Array.isArray(it?.warnings) ? it.warnings.slice() : []
    })) : null,
    meta: p.meta && typeof p.meta === 'object' ? { ...p.meta } : { ts: Date.now() }
  };

  if (!out.meta.ts) out.meta.ts = Date.now();
  return out;
}

function loadStoreFromLS(){
  try{
    const raw = localStorage.getItem(VC_STORE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;

    store.clear();
    for (const it of arr){
      if (!Array.isArray(it) || it.length < 2) continue;
      const [k, payload] = it;
      const key = String(k || '').trim();
      if (!key) continue;
      store.set(key, normalizePayload(payload));
    }

    pruneStore();
    saveStoreToLS();
  }catch{
    // تجاهل
  }
}

/* =========================
   UI State
   ========================= */

let _ui = {
  inited: false,
  ctx: null,
  slotEl: null,
  btnEl: null,
  badgeEl: null,
  tooltipEl: null,
  modalEl: null,
  modalBodyEl: null,
  modalTitleEl: null,
  currentScopeKey: null,
  lastScopeKey: null
};

/* =========================
   Helpers: Scope العائلة الحالية
   ========================= */

function getActiveFamilyKey(){
  try{
    const st = _ui.ctx?.getState?.();
    const k1 = st && st.selectedFamily ? String(st.selectedFamily).trim() : '';

    const k2 = _ui.ctx?.Model?.getSelectedKey?.() ? String(_ui.ctx.Model.getSelectedKey()).trim()
      : '';

    const k = k1 || k2;
    return k || null;
  }catch{
    return null;
  }
}

function getActiveFamilyScopeKey(){
  const k = getActiveFamilyKey();
  return k ? `family:${k}` : null;
}

/* =========================
   Summary
   ========================= */

function splitWarnings(warnings){
  const severe = [];
  const info = [];
  for (const w of (warnings || [])){
    if (!w) continue;
    if (w.level === 'severe') severe.push(w);
    else info.push(w);
  }
  return { severe, info };
}

export function vcToastSummaryText(sum){
  const t = String(sum?.text || 'لا توجد تنبيهات.').trim();
  return t.replace(/\.\s*$/, '') + '.';
}

function summarizeResults(payload){
  const summary = {
    title: payload?.title || 'تنبيهات التحقق',
    counts: { severe:0, info:0, total:0 },
    hasBlockers: false,
    text: ''
  };

  const errWord  = (n)=> (n === 1 ? 'خطأ' : 'أخطاء');
  const noteWord = (n)=> (n === 1 ? 'ملاحظة' : 'ملاحظات');

  const countWarning = (w)=>{
    if (!w) return;
    if (w.level === 'severe') summary.counts.severe++;
    else summary.counts.info++;
  };

  if (Array.isArray(payload?.items)){
    for (const it of payload.items){
      const ws = it?.warnings || [];
      for (const w of ws) countWarning(w);
    }
  } else {
    const ws = payload?.warnings || [];
    for (const w of ws) countWarning(w);
  }

  summary.counts.total = summary.counts.severe + summary.counts.info;
  summary.hasBlockers = (summary.counts.severe > 0);

  const s = summary.counts.severe;
  const i = summary.counts.info;

  if (summary.counts.total === 0){
    summary.text = 'لا توجد تنبيهات.';
  } else if (s > 0 && i > 0){
    summary.text = `يوجد ${errWord(s)} (${s}) و${noteWord(i)} (${i}).`;
  } else if (s > 0){
    summary.text = `يوجد ${errWord(s)} (${s}).`;
  } else {
    summary.text = `يوجد ${noteWord(i)} (${i}).`;
  }

  return summary;
}

/* =========================
   DOM
   ========================= */

function defaultById(id){
  return document.getElementById(id);
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function vcSplitMessage(raw){
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { head:'', body:s };
  return { head: s.slice(0, i + 1).trim(), body: s.slice(i + 1).trim() };
}

function vcTagLabelFromMessage(r){
  const raw = String((r && r.message) || '').trim();
  if (!raw) return '';

  const split = vcSplitMessage(raw);
  const s = String(split.body || raw).trim();

  return s
    .replace(/\s*\(فرق السنوات\s*[-0-9]+\)\s*\.?\s*$/, '')
    .trim();
}

function vcHighlightNamesInText(rawText, names){
  const text = String(rawText || '');
  const list = Array.from(new Set(
    (names || []).map(n => String(n || '').trim()).filter(Boolean)
  ));

  let out = escapeHtml(text);
  list.sort((a,b) => b.length - a.length);

  for (const name of list){
    const nameEsc = escapeHtml(name);
    out = out.split(nameEsc).join(
      `<span class="vc-person" title="شخص مذكور">${nameEsc}</span>`
    );
  }

  return out;
}

/* =========================
   Tags (UI-only)
   ========================= */

const VC_TAG_I18N = {
  AGE_PARENT_YOUNGER: 'الأب/الأم أصغر من الابن',
  AGE_TOO_YOUNG:      'عمر إنجاب صغير جدًا',
  AGE_TOO_OLD:        'عمر إنجاب كبير جدًا',
  AGE_SMALL_GAP:      'فرق عمر صغير',
  AGE_INFO:           'فرق عمر ملحوظ',
  AGE_LARGE_GAP:      'فرق عمر كبير',
  BIRTH_IN_FUTURE:    'تاريخ ميلاد في المستقبل',
  BAD_FAMILY:         'بيانات عائلة غير صالحة',
  YEAR_ONLY_AMBIGUITY_REVIEW: 'التواريخ التفصيلية تحتاج مراجعة',

  SPOUSE_AGE_IMPOSSIBLE: 'فرق عمر غير منطقي بين الزوجين',
  SPOUSE_AGE_LARGE_GAP:  'فرق عمر كبير بين الزوجين',
  SPOUSE_AGE_NOTE:       'فرق عمر ملحوظ بين الزوجين',

  spouses: 'الزوجان',
  DEATH_BEFORE_BIRTH:              'وفاة قبل الميلاد',
  DEATH_IN_FUTURE:                 'تاريخ وفاة في المستقبل',
  DEATH_PARENT_BEFORE_CHILD_BIRTH: 'وفاة الوالد قبل ميلاد الطفل',
  DEATH_SPOUSE_BEFORE_OTHER_BIRTH: 'وفاة أحد الزوجين قبل ميلاد الآخر',
  DEATH_PARENT_WHEN_CHILD_INFANT:  'وفاة الوالد والطفل صغير جدًا',
  POSTHUMOUS_BIRTH_POSSIBLE:       'احتمال ولادة بعد وفاة الأب',
  AGE_AT_DEATH_IMPOSSIBLE:         'عمر غير منطقي عند الوفاة',
  AGE_AT_DEATH_VERY_OLD:           'عمر كبير عند الوفاة',
  AGE_AT_DEATH_ZERO_REVIEW:        'ميلاد ووفاة بنفس السنة (مراجعة)',

  edges:          'روابط النسب',
  validateFamily: 'التحقق من العائلة',
  death:          'الوفاة',
};

function vcLabelForTag(raw){
  const k = String(raw || '').trim();
  if (!k) return '';
  return VC_TAG_I18N[k] || k.replaceAll('_',' ').toLowerCase();
}

function vcNameOnly(label){
  const s = String(label || '').trim();
  if (!s) return '';
  const parts = s.split('—').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 1) return parts[0] || s;
  return s;
}

function vcRoleOnly(label){
  const s = String(label || '').trim();
  if (!s) return '';

  const parts = s.split('—').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2){
    return parts.slice(1).join(' — ').trim() || s;
  }
  return s;
}

function vcLabelForCodeWithPeople(code, ids, labels){
  const c = String(code || '').trim();
  if (!c) return '';

  const p0 = ids?.[0] ? String(ids[0]) : '';
  const p1 = ids?.[1] ? String(ids[1]) : '';

  const aFull = p0 ? (labels?.[p0] || 'هذا الشخص') : '';
  const bFull = p1 ? (labels?.[p1] || 'هذا الشخص') : '';

  const a = aFull ? vcRoleOnly(aFull) : '';
  const b = bFull ? vcRoleOnly(bFull) : '';

  const fallback = vcLabelForTag(c);
  const hasTwo = !!(a && b);

  switch (c){
    case 'AGE_PARENT_YOUNGER':
      return hasTwo ? `${a} أصغر/مساوٍ لـ ${b}` : fallback;
    case 'AGE_TOO_YOUNG':
      return hasTwo ? `${a} صغير جدًا عند ولادة ${b}` : fallback;
    case 'AGE_TOO_OLD':
      return hasTwo ? `${a} كبير جدًا عند ولادة ${b}` : fallback;
    case 'AGE_SMALL_GAP':
      return hasTwo ? `فرق عمر صغير: ${a} ↔ ${b}` : fallback;
    case 'AGE_INFO':
      return hasTwo ? `فرق عمر ملحوظ: ${a} ↔ ${b}` : fallback;
    case 'AGE_LARGE_GAP':
      return hasTwo ? `فرق عمر كبير: ${a} ↔ ${b}` : fallback;
    case 'BIRTH_IN_FUTURE':
      return a ? `ميلاد في المستقبل: ${a}` : fallback;
    case 'SPOUSE_AGE_IMPOSSIBLE':
      return hasTwo ? `فرق غير منطقي: ${a} ↔ ${b}` : fallback;
    case 'SPOUSE_AGE_LARGE_GAP':
      return hasTwo ? `فرق كبير: ${a} ↔ ${b}` : fallback;
    case 'SPOUSE_AGE_NOTE':
      return hasTwo ? `فرق ملحوظ: ${a} ↔ ${b}` : fallback;
    default:
      return fallback;
  }
}

/* =========================
   Rendering
   ========================= */

function renderSection(title, items){
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';

  const t = String(title || '').trim();
  const cls =
    (t === 'تحذيرات شديدة' || t === 'أخطاء') ? 'is-severe' :
    (t === 'معلومات' || t === 'ملاحظات') ? 'is-info' : '';

  const liHtml = list.map(r => {
    const rawMsg = String(r.message || '');
    const { head, body } = vcSplitMessage(rawMsg);

    const headHtml = escapeHtml(head || '');

    const ids = Array.isArray(r.peopleIds) ? r.peopleIds.map(String).filter(Boolean) : [];
    const p0 = ids[0] || '';
    const p1 = ids[1] || '';

    const labels = (r && typeof r === 'object' && r.peopleLabels && typeof r.peopleLabels === 'object') ? r.peopleLabels : {};

    const full0 = p0 ? (labels[p0] || 'هذا الشخص') : '';
    const full1 = p1 ? (labels[p1] || 'هذا الشخص') : '';

    const name0 = full0 ? vcNameOnly(full0) : '';
    const name1 = full1 ? vcNameOnly(full1) : '';

    const namesToHighlight = [name0, name1].filter(Boolean);
    const bodyHtml = vcHighlightNamesInText(body || rawMsg, namesToHighlight);

    const short = (s, n=18) => (String(s).length > n ? String(s).slice(0,n-1)+'…' : String(s));

    const btnText0 = `عرض سيرة: ${short(name0)}`;
    const btnText1 = `عرض سيرة: ${short(name1)}`;

    const tip0 = full0 ? `عرض سيرة: ${full0}` : 'عرض سيرة';
    const tip1 = full1 ? `عرض سيرة: ${full1}` : 'عرض سيرة';

    const jumpBtns = (p0 && p1) ? `<button type="button" class="vc-jump" data-pid="${escapeHtml(p0)}" title="${escapeHtml(tip0)}">${escapeHtml(btnText0)}</button>
         <button type="button" class="vc-jump" data-pid="${escapeHtml(p1)}" title="${escapeHtml(tip1)}">${escapeHtml(btnText1)}</button>`
      : (p0 ? `<button type="button" class="vc-jump" data-pid="${escapeHtml(p0)}" title="${escapeHtml(tip0)}">${escapeHtml(btnText0)}</button>`
        : '');

    const tagBits = [];
    if (r.code){
      let label = '';

      if (String(r.level) === 'info'){
        label = vcTagLabelFromMessage(r);
      }

      if (!label){
        label = vcLabelForCodeWithPeople(r.code, ids, labels);
      }

      if (!label){
        label = vcLabelForTag(r.code);
      }

      tagBits.push(
        `<span class="vc-tag" title="${escapeHtml(String(r.code))}">${escapeHtml(label)}</span>`
      );
    }

    if (r.source){
      const label = vcLabelForTag(r.source);
      tagBits.push(`<span class="vc-tag" title="${escapeHtml(String(r.source))}">${escapeHtml(label)}</span>`);
    }
    if (r.path) tagBits.push(`<span class="vc-mini">${escapeHtml(r.path)}</span>`);

    const actionsHtml = jumpBtns ? `<div class="vc-actions">${jumpBtns}</div>` : '';
    const tagsHtml = tagBits.length ? `<div class="vc-tags">${tagBits.join(' ')}</div>` : '';
    const metaHtml = (actionsHtml || tagsHtml) ? `<div class="vc-meta">${tagsHtml}${actionsHtml}</div>` : '';

    return `<li>
      <div class="vc-row">
        <span class="vc-msg">
          ${headHtml ? `<span class="vc-msg-head">${headHtml}</span>` : ''}
          <span class="vc-msg-body">${bodyHtml}</span>
        </span>
      </div>
      ${metaHtml}
    </li>`;
  }).join('');

  return `
    <div class="vc-section ${cls}">
      <h3>${escapeHtml(title)}</h3>
      <ul class="vc-list">${liHtml}</ul>
    </div>
  `;
}

function renderPayload(payload){
  const sum = summarizeResults(payload);

  const header = `
<div class="vc-section vc-summary">
  <div class="vc-mini"><strong>${escapeHtml(sum.text)}</strong></div>
  <div class="vc-summary-chips">
    <span class="vc-chip">إجمالي <b>${sum.counts.total}</b></span>
    <span class="vc-chip is-severe">أخطاء <b>${sum.counts.severe}</b></span>
    <span class="vc-chip is-info">ملاحظات <b>${sum.counts.info}</b></span>
  </div>
</div>`;

  if (Array.isArray(payload.items) && payload.items.length){
    const blocks = payload.items.map(it => {
      const { severe, info } = splitWarnings(it.warnings || []);
      const mini = summarizeResults(it);
      return `
        <div class="vc-scope-block">
          <div class="vc-scope-title">
            <div>${escapeHtml(it.title || it.key || 'عنصر')}</div>
            <div class="vc-mini">${escapeHtml(mini.text)}</div>
          </div>
          ${renderSection('أخطاء', severe)}
          ${renderSection('ملاحظات', info)}
        </div>`;
    }).join('');
    return header + blocks;
  }

  const { severe, info } = splitWarnings(payload.warnings || []);
  return header + `
${renderSection('أخطاء', severe)}
${renderSection('ملاحظات', info)}`;
}

/* =========================
   Icon + Modal
   ========================= */

function buildIcon(slot){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'validation-center-btn';
  btn.id = 'validationBell';
  btn.title = 'تنبيهات التحقق';
  btn.setAttribute('aria-label','تنبيهات التحقق');
  btn.innerHTML = `<i class="fa-solid fa-bell" aria-hidden="true"></i>`;

  const badge = document.createElement('span');
  badge.className = 'validation-center-badge is-ok';
  badge.textContent = '0';

  const tip = document.createElement('span');
  tip.className = 'validation-center-tip';
  tip.textContent = '';

  btn.appendChild(badge);

  const wrap = document.createElement('div');
  wrap.className = 'validation-center-wrap';
  wrap.appendChild(btn);
  wrap.appendChild(tip);

  slot.appendChild(wrap);

  _ui.btnEl = btn;
  _ui.badgeEl = badge;
  _ui.tooltipEl = tip;

  btn.addEventListener('click', () => {
    const key = getActiveFamilyScopeKey() || _ui.currentScopeKey || _ui.lastScopeKey;
    openValidationModal(key);
  });
}

function buildModal(){
  const modal = document.createElement('div');
  modal.className = 'validation-center-modal';
  modal.id = 'validationCenterModal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');

  modal.innerHTML = `
    <div class="validation-center-card" role="document">
      <div class="validation-center-head">
        <div class="validation-center-title" id="validationCenterTitle">تنبيهات التحقق</div>
        <button class="validation-center-close close-button" type="button" aria-label="إغلاق">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="validation-center-body" id="validationCenterBody"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('.validation-center-close');
  const card = modal.querySelector('.validation-center-card');

  closeBtn.addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')){
      modal.classList.remove('show');
    }
  });

  _ui.modalEl = modal;
  _ui.modalBodyEl = modal.querySelector('#validationCenterBody');
  _ui.modalTitleEl = modal.querySelector('#validationCenterTitle');

  card.addEventListener('click', (e) => e.stopPropagation());

  card.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button.vc-jump[data-pid]');
    if (!btn) return;

    const pid = String(btn.dataset.pid || '').trim();
    if (!pid) return;

    modal.classList.remove('show');
    _ui.ctx?.bus?.emit?.('ui:openPersonById', { id: pid });
  });
}

/* =========================
   Badge
   ========================= */

function updateIconBadge(){
  if (!_ui.badgeEl) return;

  const scopeKey = getActiveFamilyScopeKey();
  const payload = scopeKey ? store.get(scopeKey) : null;
  const sum = payload ? summarizeResults(payload) : summarizeResults({ title:'تنبيهات التحقق', errors:[], warnings:[] });

  const total = sum.counts.total;

  if (total <= 0){
    _ui.badgeEl.textContent = '0';
    _ui.badgeEl.classList.add('is-ok');
    if (_ui.tooltipEl) _ui.tooltipEl.textContent = '';
    return;
  }

  _ui.badgeEl.textContent = String(total > 99 ? '99+' : total);
  _ui.badgeEl.classList.remove('is-ok');

  if (_ui.tooltipEl){
    _ui.tooltipEl.textContent = sum.text || 'يوجد تنبيهات..';
  }
}

/* =========================
   API (UI)
   ========================= */

export function initValidationUI(ctx){
  if (_ui.inited) return;

  _ui.ctx = ctx || {};
  const byIdFn = _ui.ctx.byId || defaultById;

  let slot = byIdFn('validationCenterSlot');
  if (!slot){
    const topBar = document.querySelector('.top-bar');
    if (topBar){
      slot = document.createElement('div');
      slot.id = 'validationCenterSlot';
      slot.className = 'validation-center-slot';
      topBar.appendChild(slot);
    }
  } else {
    if (!slot.classList.contains('validation-center-slot')){
      slot.classList.add('validation-center-slot');
    }
  }

  _ui.slotEl = slot;

  if (slot){
    buildIcon(slot);
    buildModal();

    loadStoreFromLS();

    // إن لم توجد نتائج للعائلة الحالية أنشئها الآن (silent)
    try {
      const activeKey = getActiveFamilyKey();
      const scopeKey  = activeKey ? `family:${activeKey}` : null;

      if (activeKey && scopeKey && !store.has(scopeKey)) {
        const fam =
          _ui.ctx?.Model?.getFamily?.(activeKey) ||
          _ui.ctx?.Model?.getFamilies?.()?.[activeKey];

        if (fam) {
          const { errors, warnings } = validateFamily(fam);
          setValidationResults(scopeKey, {
            title: `تنبيهات التحقق — ${fam.title || fam.familyName || activeKey}`,
            errors,
            warnings,
            meta: { familyKey: activeKey, ts: Date.now(), origin: 'boot' }
          });
        }
      }
    } catch {}

    const activeScope = getActiveFamilyScopeKey();
    if (activeScope && store.has(activeScope)){
      _ui.lastScopeKey = activeScope;
      _ui.currentScopeKey = activeScope;
    } else {
      const lastKey = Array.from(store.keys()).pop() || null;
      if (lastKey){
        _ui.lastScopeKey = lastKey;
        _ui.currentScopeKey = lastKey;
      }
    }

    updateIconBadge();
  }

  _ui.inited = true;
}

export function refreshValidationBadge(){
  try {
    const activeKey = getActiveFamilyKey();
    const scopeKey  = activeKey ? `family:${activeKey}` : null;

    if (activeKey && scopeKey) {
      const fam =
        _ui.ctx?.Model?.getFamily?.(activeKey) ||
        _ui.ctx?.Model?.getFamilies?.()?.[activeKey];

      if (fam) {
        const { errors, warnings } = validateFamily(fam);
        setValidationResults(scopeKey, {
          title: `تنبيهات التحقق — ${fam.title || fam.familyName || activeKey}`,
          errors,
          warnings,
          meta: { familyKey: activeKey, ts: Date.now(), origin: 'refresh' }
        });
      }
    }
  } catch {}

  updateIconBadge();
}


export function setValidationResults(scopeKey, payload){
  const key = String(scopeKey || '').trim();
  if (!key) return;

  const normalized = normalizePayload(payload);
  if (!normalized.meta) normalized.meta = {};
  if (!normalized.meta.ts) normalized.meta.ts = Date.now();

  store.set(key, normalized);

  const activeScope = getActiveFamilyScopeKey();
  if (!activeScope || key === activeScope){
    _ui.lastScopeKey = key;
    _ui.currentScopeKey = key;
  }

  pruneStore();
  updateIconBadge();
  saveStoreToLS();
}

export function clearValidation(scopeKey){
  const key = String(scopeKey || '').trim();
  if (!key) store.clear();
  else store.delete(key);

  updateIconBadge();
  saveStoreToLS();
}

export function getValidationSummary(scopeKey){
  const key = String(scopeKey || '').trim();
  const payload = key ? store.get(key) : null;
  return payload ? summarizeResults(payload) : summarizeResults({ title:'تنبيهات التحقق', errors:[], warnings:[] });
}

export function openValidationModal(scopeKey){
  if (!_ui.modalEl) return;

  const key = String(scopeKey || getActiveFamilyScopeKey() || _ui.lastScopeKey || '').trim();
  const payload = key ? store.get(key) : null;

  const title = payload?.title || 'تنبيهات التحقق';
  _ui.modalTitleEl.textContent = title;

  _ui.modalBodyEl.innerHTML = payload ? renderPayload(payload)
    : `<div class="vc-section"><h3>لا توجد بيانات لعرضها</h3><div class="vc-mini">لا يوجد scopeKey محفوظ.</div></div>`;

  _ui.modalEl.classList.add('show');
}
