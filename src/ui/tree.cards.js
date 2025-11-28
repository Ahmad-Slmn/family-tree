// tree.cards.js — البطاقات والصور والكاش والعدادات

import { el, textEl, getArabicOrdinalF } from '../utils.js';
import { DB } from '../storage/db.js';
import * as Lineage from '../features/lineage.js';

// ===== حالة رسم البطاقات/الصور =====
const RENDERED_IDS = new Set();          // الأشخاص المرسومون
const _cardById = new Map();             // personId -> DOM node

// ===== كاش صور خفيف (غير Blob) بنمط LRU =====
const PHOTO_CACHE = new Map();           // id -> { url, isBlob:false }
let PHOTO_MAX = parseInt(localStorage.getItem('photoMax') || '150', 10);
if (!Number.isFinite(PHOTO_MAX) || PHOTO_MAX < 1) PHOTO_MAX = 150;

function _cacheGet(id){ return PHOTO_CACHE.get(id) || null; }
function _cachePut(id, url, isBlob){
  if (isBlob) return;
  if (PHOTO_CACHE.has(id)) PHOTO_CACHE.delete(id);
  PHOTO_CACHE.set(id, { url, isBlob: false });
  if (PHOTO_CACHE.size > PHOTO_MAX){
    const [oldId] = PHOTO_CACHE.entries().next().value;
    PHOTO_CACHE.delete(oldId);
  }
}

export function clearPersonPhotoCache(id){ if (id) PHOTO_CACHE.delete(id); }

export function clearPhotoCache(){
  PHOTO_CACHE.clear();
}

// ===== إرجاع مصدر صورة الشخص مع دعم idb:/data:/URL =====
async function getPersonPhotoURL(person){
  const id  = person?._id || '';
  const raw = (person?.bio?.photoUrl || person?.photoUrl || '').trim();

  if (id){
    const hit = _cacheGet(id);
    if (hit && hit.url){
      if (raw) return hit.url;
      PHOTO_CACHE.delete(id);
    }
  }

  try {
    if (id){
      const blob = await DB.getPhoto(id);
      if (blob instanceof Blob) return URL.createObjectURL(blob);
    }
  } catch {}

  if (raw && raw.startsWith('idb:')){
    const pid = raw.slice(4);
    try {
      const blob2 = await DB.getPhoto(pid);
      if (blob2 instanceof Blob) return URL.createObjectURL(blob2);
    } catch {}
    return '';
  }

  if (!raw) return '';
  if (raw.startsWith('data:')){
    if (id) _cachePut(id, raw, false);
    return raw;
  }
  const v = person?.photoVer || 0;
  const url = `${raw}${raw.includes('?') ? '&' : '?'}v=${v}`;
  if (id) _cachePut(id, url, false);
  return url;
}

// ===== تحديث الصورة داخل البطاقة مع تنظيف blob القديم =====
async function refreshAvatar(card, person){
  const avatar = card.querySelector('.avatar') || card;
  const alt = String(person?.name || '');
  let img = avatar.querySelector('img');

  if (!img){ avatar.innerHTML = ''; avatar.textContent = getRoleAvatar(person.role); }
  const src = await getPersonPhotoURL(person);

  if (!src){
    if (img){
      const oldSrc = img.currentSrc || img.src || '';
      if (oldSrc.startsWith('blob:')){ try { URL.revokeObjectURL(oldSrc); } catch {} }
      img.remove(); img = null;
    }
    avatar.innerHTML = ''; avatar.textContent = getRoleAvatar(person.role);
    return;
  }

  if (!img){
    img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
    avatar.innerHTML = ''; avatar.appendChild(img);
  }

  const oldSrc = img.currentSrc || img.src || '';
  if (oldSrc && oldSrc.startsWith('blob:') && oldSrc !== src){
    try { URL.revokeObjectURL(oldSrc); } catch {}
  }

  try { img.src = src; } catch {}
  img.alt = alt;
  if (src.startsWith('blob:')) img.dataset.blobUrl = src; else img.removeAttribute('data-blob-url');
}

export function refreshAvatarById(person){
  const id = typeof person === 'string' ? person : person?._id;
  if (!id) return;
  const card = _cardById.get(id);
  const p = (typeof person === 'object' && person) || null;
  if (card && p) refreshAvatar(card, p);
}

// ===== إبراز مطابقات جزئية مثل الاقتراحات في البطاقات =====
const AR_MARKS_OPT = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]*';

function highlightPartial(el, text, tokensRaw){
  el.textContent = '';
  const src = String(text || '');
  const toks = (tokensRaw || []).map(t => String(t||'').trim()).filter(Boolean);
  if (!toks.length){ el.textContent = src; return; }

  const tokenToAgnosticPattern = (tok)=>{
    const escapeChar = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

    const equivChar = (ch)=>{
      if (/[اأإآ]/u.test(ch)) return '[اأإآ]';
      if (/[يى]/u.test(ch))   return '[يى]';
      if (/[هة]/u.test(ch))   return '[هة]';
      return escapeChar(ch);
    };

    let p = Array.from(tok).map(equivChar).join(AR_MARKS_OPT);
    return AR_MARKS_OPT + p + AR_MARKS_OPT;
  };

  const rx = new RegExp('(' + toks.map(tokenToAgnosticPattern).join('|') + ')', 'gu');

  let last = 0;
  for (const m of src.matchAll(rx)){
    if (m.index > last) el.append(src.slice(last, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    el.append(mark);
    last = m.index + m[0].length;
  }
  if (last < src.length) el.append(src.slice(last));
}

function highlightTextTokens(el, text, tokensRaw){
  highlightPartial(el, text, tokensRaw);
}

function highlightNameTokens(el, name, tokensRaw){
  highlightPartial(el, name, tokensRaw);
}

// ===== محرر اسم بسيط في الـ contenteditable =====
function insertPlainTextAtCursor(t){
  const sel = window.getSelection && window.getSelection(); if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
}

export function getRoleAvatar(role){
  const map = {
    "الجد الأول":"👴","الجد الثاني":"👴","جدة":"👵",
    "الأب":"👨","الأم":"👩",
    "ابن":"👦","بنت":"👧",
    "زوج":"👨‍🦱","زوجة":"👩‍🦰","الزوجة الأولى":"👩‍🦰",
    "صاحب الشجرة":"🧑‍🌾"
  };
  return map[role] || "👤";
}

// ===== إنشاء بطاقة عضو =====
export function createCard(person, className = '', handlers = {}, opts = {}){
  const card = el('div', `member-card ${className||''}`.trim());
  const bio = person.bio || {};

  if (person._id){ RENDERED_IDS.add(person._id); card.dataset.personId = person._id; } 
  else { card.removeAttribute('data-person-id'); }

  const dob = (bio.birthDate && bio.birthDate !== '-') ? String(bio.birthDate).trim()
             : ((bio.birthYear && bio.birthYear !== '-') ? String(bio.birthYear).trim() : '');
  const motherName = (bio.motherName || '').trim();
  const hasMother = !!motherName && motherName !== '-';

  const avatar = el('div','avatar');
  avatar.textContent = getRoleAvatar(person.role);
  card.appendChild(avatar);
  refreshAvatar(card, person);

  const canEditName = !(opts && opts.readonlyName);
  const nameClasses = canEditName ? 'name editable-inline editable-name' : 'name';
  const nameEl = textEl('div', String(person.name||''), nameClasses);

  ['mousedown','click','dblclick','touchstart'].forEach(evt => {
    nameEl.addEventListener(evt, e => e.stopPropagation(), true);
  });

  if (canEditName){
    nameEl.contentEditable = 'true';
    nameEl.spellcheck = false;
    nameEl.setAttribute('role','textbox');
    nameEl.setAttribute('aria-label','اسم الشخص');
    nameEl.dataset.placeholder = 'اكتب الاسم';
    nameEl.title = 'انقر للتعديل ثم Enter للحفظ';

    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter'){
        e.preventDefault();
        nameEl.blur();
      }
    });
    nameEl.addEventListener('paste', e => {
      e.preventDefault();
      const t = (e.clipboardData||window.clipboardData).getData('text') || '';
      insertPlainTextAtCursor(t);
    });
    nameEl.addEventListener('blur', () => {
      const v   = String(nameEl.textContent||'').trim();
      const old = person.name || '';
      if (!v){
        nameEl.textContent = '';
        handlers?.showWarning?.('لا يمكن ترك الاسم فارغًا.');
        return;
      }
      if (v !== old && typeof handlers.onInlineRename === 'function'){
        handlers.onInlineRename(person._id, { name: v });
      }
    });

  } else {
    nameEl.style.cursor = 'pointer';
    nameEl.removeAttribute('contenteditable');
    nameEl.removeAttribute('data-placeholder');
    nameEl.removeAttribute('title');
  }

  if (opts && Array.isArray(opts.highlightTokens) && opts.highlightTokens.length){
    try { highlightNameTokens(nameEl, String(person.name||''), opts.highlightTokens); } catch {}
  }

  let role = String(person.role || '').trim();
  if (role.startsWith('زوجة') || role.startsWith('الزوجة')) {
    const m = role.match(/^ال?زوجة\s+(\d+)$/u);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (!Number.isNaN(idx)) role = `الزوجة ${getArabicOrdinalF(idx)}`;
    }
  }
  const roleEl = textEl('div', role, 'role');

  const editableFields = el('div','identity-fields');
  editableFields.append(nameEl, roleEl);
  if (dob) editableFields.appendChild(textEl('div', String(dob), 'dob'));
  card.appendChild(editableFields);

  if (opts && opts.showCognomenHint && bio.cognomen && opts.highlightTokens?.length){
    const cgLine = el('div', 'cognomen-line');
    cgLine.style.cssText = 'font-size:.85rem;opacity:.9;margin-top:.15rem;';
    const label = textEl('span', 'اللقب: ');
    const val = document.createElement('span');
    highlightTextTokens(val, String(bio.cognomen||''), opts.highlightTokens);
    cgLine.append(label, val);
    editableFields.appendChild(cgLine);
  }

  if (opts.showMotherHint && hasMother){
    const strip = el('div','mini-strip mother-strip');
    strip.style.cssText = 'font-size:.8rem;opacity:.9';
    strip.append(textEl('span','اسم الأم: '), textEl('strong', motherName));
    card.appendChild(strip);
  }

  card.style.cursor = 'pointer';
  const isInsideEditable = ev => (ev.composedPath ? ev.composedPath() : [])
    .some(n => n?.nodeType === 1 && n.getAttribute && n.getAttribute('contenteditable') === 'true');
  card.addEventListener('click', ev => {
    if (isInsideEditable(ev)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) return;
    if (document.activeElement?.getAttribute?.('contenteditable') === 'true') return;
    ev.stopPropagation();
    if (typeof handlers.onShowDetails === 'function') handlers.onShowDetails(person);
  });

  if (card.classList.contains('wife')){
    const hasKids = Array.isArray(person?.children) && person.children.length > 0;
    const conn = card.querySelector('.wife-connector');
    if (hasKids && !conn) card.appendChild(el('div','wife-connector'));
    else if (!hasKids && conn) conn.remove();
  }

  return card;
}

// ===== إنشاء/تحديث بطاقة شخص مع الحفاظ على المراجع =====
export function upsertCard(container, person, handlers, className = '', opts = {}){
  const id = person._id || null;
  const exist = id ? _cardById.get(id) : null;

  if (exist && !exist.isConnected) _cardById.delete(id);
  if (exist){
    const nameEl = exist.querySelector('.name');
    const roleEl = exist.querySelector('.role');
    const needName = nameEl && nameEl.textContent !== (person.name || '');
    const needRole = roleEl && roleEl.textContent !== (person.role || '');
    const needMove = exist.parentNode !== container;
    if (needName) nameEl.textContent = person.name || '';
    if (needRole) roleEl.textContent = person.role || '';
    if (!needName && !needRole && !needMove && !className) return exist;

    refreshAvatar(exist, person);

    if (exist.classList.contains('wife')){
      const hasKids = Array.isArray(person?.children) && person.children.length > 0;
      const conn = exist.querySelector('.wife-connector');
      if (hasKids && !conn) exist.appendChild(el('div','wife-connector'));
      else if (!hasKids && conn) conn.remove();
    }

    if (className) className.split(' ').filter(Boolean).forEach(cls => exist.classList.add(cls));
    if (needMove) container.appendChild(exist);
    return exist;
  }

  const node = createCard(person, className, handlers, opts);
  if (id) _cardById.set(id, node);
  container.appendChild(node);
  return node;
}

// ===== إزالة بطاقات لم تعد مطلوبة مع تنظيف blob =====
export function pruneRemoved(currentIds){
  for (const [id, el] of _cardById){
    if (!currentIds.has(id)){
      const oldImg = el?.querySelector?.('img[data-blob-url]') || null;
      if (oldImg?.dataset?.blobUrl){ try { URL.revokeObjectURL(oldImg.dataset.blobUrl); } catch {} }
      RENDERED_IDS.delete(el?.dataset?.personId || id);
      el.remove(); _cardById.delete(id);
    }
  }
}

// استدعاءها عند تغيير العائلة/الاستعلام
export function resetCardsState(){
  for (const [, node] of Array.from(_cardById.entries())){
    try { node?.remove(); } catch {}
  }
  _cardById.clear();
  RENDERED_IDS.clear();
  clearPhotoCache();
}

// ===== صناديق العدّادات =====
function normalizeLabel(l){ if (!l && l!==0) return ''; return String(l).replace(/[:\s]+$/u,'').trim(); }

export function createCounterBox(items = []){
  const box = el('div','counter-box'), left = el('div','counter-left'), right = el('div','counter-right');
  items.forEach(it => {
    if (it.value == null || Number(it.value) === 0) return;
    const raw = normalizeLabel(it.label);
    const p = el('p','count-item');
    p.append(textEl('span', raw+':','count-label'), textEl('span', String(it.value),'count-value'));
    (['الإخوة','الأخوات','الزوجات','الأعمام','العمّات','الأخوال','الخالات'].includes(raw) ? left : right)
      .appendChild(p);
  });
  if (!left.children.length && !right.children.length) return null;
  box.append(right,left); return box;
}

export function createCounterBoxForPerson(person){
  const family = window.__CURRENT_FAMILY__;
  const ctx = window.__LINEAGE_CTX__ || (family ? Lineage.buildLineageContext(family) : null);
  if (!family || !ctx || !person || !person._id) return null;

  const items = [];
  const ref = ctx.byId.get(String(person._id)) || person;
  const isRoot = (ref === family.rootPerson) || (String(ref.role||'').trim() === 'صاحب الشجرة');

  let wives = [];
  if (isRoot){
    wives = Array.isArray(family.wives) ? family.wives : [];
  } else if (Array.isArray(ref.wives)){
    wives = ref.wives;
  }
  wives = wives.filter(w => {
    const id = w?._id; 
    return id && ctx.connectedIds.has(String(id));
  });
  if (wives.length) items.push({ label:'الزوجات', value:wives.length });

  let kids = [];

  if (Array.isArray(ref.children) && ref.children.length){
    kids = ref.children.slice();
  } else if (Array.isArray(ref.childrenIds) && ref.childrenIds.length){
    kids = ref.childrenIds
      .map(id => ctx.byId.get(String(id)))
      .filter(Boolean);
  } else if (isRoot){
    kids = (Array.isArray(family.wives) ? family.wives : [])
      .flatMap(w => Array.isArray(w?.children) ? w.children : []);
  }

  kids = kids.filter(k => k?._id && ctx.connectedIds.has(String(k._id)));

  const sons = kids.filter(c => String(c?.role||'').trim() === 'ابن');
  const dau  = kids.filter(c => String(c?.role||'').trim() === 'بنت');

  if (sons.length) items.push({ label:'الأبناء', value:sons.length });
  if (dau.length)  items.push({ label:'البنات',  value:dau.length });
  if (kids.length) items.push({ label:'الإجمالي', value:kids.length });

  const sib = Lineage.resolveSiblings(ref, family, ctx) || {};
  const types = sib.types || {};

  const sibAllRaw = [
    ...(Array.isArray(types.full) ? types.full : []),
    ...(Array.isArray(types.paternal) ? types.paternal : []),
    ...(Array.isArray(types.maternal) ? types.maternal : [])
  ];

  let sibAll = sibAllRaw
    .filter(x => x && x._id && ctx.connectedIds.has(String(x._id)));

  const seenSib = new Set();
  sibAll = sibAll.filter(s => {
    const id = String(s._id);
    if (seenSib.has(id)) return false;
    seenSib.add(id);
    return true;
  });

  if (!sibAll.length){
    const brosFallback = (sib.brothers||[]).filter(s => s?._id && ctx.connectedIds.has(String(s._id)));
    const sisFallback  = (sib.sisters ||[]).filter(s => s?._id && ctx.connectedIds.has(String(s._id)));
    if (brosFallback.length) items.push({ label:'الإخوة', value:brosFallback.length });
    if (sisFallback.length)  items.push({ label:'الأخوات', value:sisFallback.length });
  } else {
    const bros = sibAll.filter(s => String(s.role||'').trim() === 'ابن');
    const sis  = sibAll.filter(s => String(s.role||'').trim() === 'بنت');
    if (bros.length) items.push({ label:'الإخوة', value:bros.length });
    if (sis.length)  items.push({ label:'الأخوات', value:sis.length });
  }

  const ua = Lineage.resolveUnclesAunts(ref, family, ctx) || {};

  const patUncles = Array.isArray(ua.paternalUncles) ? ua.paternalUncles : [];
  const patAunts  = Array.isArray(ua.paternalAunts)  ? ua.paternalAunts  : [];
  const matUncles = Array.isArray(ua.maternalUncles) ? ua.maternalUncles : [];
  const matAunts  = Array.isArray(ua.maternalAunts)  ? ua.maternalAunts  : [];

  if (patUncles.length) items.push({ label:'الأعمام', value:patUncles.length });
  if (patAunts.length)  items.push({ label:'العمّات', value:patAunts.length });
  if (matUncles.length) items.push({ label:'الأخوال', value:matUncles.length });
  if (matAunts.length)  items.push({ label:'الخالات', value:matAunts.length });

  return items.length ? createCounterBox(items) : null;
}

// ===== موصلات بصرية بسيطة =====
export function createConnector(){ return el('div','connector'); }

export function toggleConnectors(root, on){
  root.querySelectorAll('.connector-wrapper')
      .forEach(e => { e.style.display = on ? '' : 'none'; });
}

// ===== مقطع زوجة + أبنائها مع احترام الفلاتر/البحث =====
export function createWifeSection(wife, handlers, match, passFiltersFn, opts = {}){
  const sec = el('div','wife-section');

  const showWifeCard = !opts?.hideNonMatchingParents ? true
    : (passFiltersFn ? passFiltersFn(wife) : true) && (!opts?.hasQuery || (typeof match === 'function' && match(wife)));
  let wifeCard = null;

  if (showWifeCard){
    wifeCard = upsertCard(sec, wife, handlers, 'wife', opts);
    const box = createCounterBoxForPerson(wife);
    if (box && !wifeCard.querySelector('.counter-box')) wifeCard.appendChild(box);
  }

  const grid = el('div','children-grid'); let drawn = 0;
  (wife.children||[]).forEach(child => {
    if (!match(child) || (passFiltersFn && !passFiltersFn(child))) return;
    const wrap = el('div','relative');
    const cls = ((child?.role || '').trim() === 'ابن') ? 'son' : 'daughter';
    const cnode = upsertCard(wrap, child, handlers, cls, opts);
    const box = createCounterBoxForPerson(child);
    if (box && !cnode.querySelector('.counter-box')) cnode.appendChild(box);
    grid.appendChild(wrap); drawn++;
  });

  if (drawn > 0){
    grid.style.marginTop = '2rem';
    sec.append(grid);
  } else {
    if (!showWifeCard) return null;
  }
  return sec;
}
