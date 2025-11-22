
// tree.js
// ===============================
// عرض الشجرة وبطاقات الأشخاص + البحث والفلاتر + صور IndexedDB
// تنظيم مختصر بدون تغيير السلوك
// ===============================

import { el, textEl, byId, showConfirmModal, showWarning, getArabicOrdinal, getArabicOrdinalF  } from '../utils.js';
import { LABELS } from '../model/families.js';
import { DB } from '../storage/db.js';
import * as Lineage from '../features/lineage.js';

// ===== حالة رسم البطاقات/الصور =====
const RENDERED_IDS = new Set();          // الأشخاص المرسومون
const _cardById = new Map();             // personId -> DOM node
let _lastKey = null, _lastQuery = '';

// ===== كاش صور خفيف (غير Blob) بنمط LRU =====
const PHOTO_CACHE = new Map();           // id -> { url, isBlob:false }
let PHOTO_MAX = parseInt(localStorage.getItem('photoMax') || '150', 10);
if (!Number.isFinite(PHOTO_MAX) || PHOTO_MAX < 1) PHOTO_MAX = 150;

function _cacheGet(id){ return PHOTO_CACHE.get(id) || null; }
function _cachePut(id, url, isBlob){
  if (isBlob) return;                    // عدم تخزين blob: في الكاش
  if (PHOTO_CACHE.has(id)) PHOTO_CACHE.delete(id);
  PHOTO_CACHE.set(id, { url, isBlob: false });
  if (PHOTO_CACHE.size > PHOTO_MAX){
    const [oldId] = PHOTO_CACHE.entries().next().value;
    PHOTO_CACHE.delete(oldId);
  }
}
export function clearPersonPhotoCache(id){ if (id) PHOTO_CACHE.delete(id); }

function toggleConnectors(root, on){
  root.querySelectorAll('.connector-wrapper')
      .forEach(e => { e.style.display = on ? '' : 'none'; });
}


export function clearPhotoCache(){
  PHOTO_CACHE.clear();
}

// ===== إرجاع مصدر صورة الشخص مع دعم idb:/data:/URL =====
async function getPersonPhotoURL(person){
  const id  = person?._id || '';
  const raw = (person?.bio?.photoUrl || person?.photoUrl || '').trim();

  // احترام الحذف: لا تُرجع من الكاش إن كان raw فارغًا
  if (id){
    const hit = _cacheGet(id);
    if (hit && hit.url){
      if (raw) return hit.url;
      PHOTO_CACHE.delete(id);
    }
  }

  // 1) Blob من IndexedDB عبر _id
  try {
    if (id){
      const blob = await DB.getPhoto(id);
      if (blob instanceof Blob) return URL.createObjectURL(blob);
    }
  } catch {}

  // 2) idb:pid → Blob
  if (raw && raw.startsWith('idb:')){
    const pid = raw.slice(4);
    try {
      const blob2 = await DB.getPhoto(pid);
      if (blob2 instanceof Blob) return URL.createObjectURL(blob2);
    } catch {}
    return '';
  }

  // 3) data:/URL عام مع photoVer
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

  // لا مصدر ⇒ ارجع للإيموجي ونظّف القديم
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

  // تنظيف blob القديم قبل التبديل
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

// ===== جدولة رسم متدرّج عند خمول المتصفح =====
const _ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 1));
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

// ===== إنشاء/تحديث بطاقة شخص مع الحفاظ على المراجع =====
function upsertCard(container, person, handlers, className = '', opts = {}){
  const id = person._id || null;
  const exist = id ? _cardById.get(id) : null;

  if (exist && !exist.isConnected) _cardById.delete(id);       // مرجع قديم منفصل
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
function pruneRemoved(currentIds){
  for (const [id, el] of _cardById){
    if (!currentIds.has(id)){
      const oldImg = el?.querySelector?.('img[data-blob-url]') || null;
      if (oldImg?.dataset?.blobUrl){ try { URL.revokeObjectURL(oldImg.dataset.blobUrl); } catch {} }
      RENDERED_IDS.delete(el?.dataset?.personId || id);
      el.remove(); _cardById.delete(id);
    }
  }
}

// ===== تطبيع عربي للبحث =====
export const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
export const AR_TATWEEL = /\u0640/gu;
export function normalizeAr(s = '', opts = {}){
  // الافتراضي الآن: استبدال التاء المربوطة «ة» إلى «ه» لضمان اتساق المطابقة مع البحث السريع
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
    // أعد التطبيع دائمًا وحدّث الكاش
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

// ===== إبراز مطابقات جزئية مثل الاقتراحات =====
const AR_MARKS_OPT = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]*';

function highlightPartial(el, text, tokensRaw){
  el.textContent = '';
  const src = String(text || '');
  const toks = (tokensRaw || []).map(t => String(t||'').trim()).filter(Boolean);
  if (!toks.length){ el.textContent = src; return; }

const tokenToAgnosticPattern = (tok)=>{
  const escapeChar = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  const equivChar = (ch)=>{
    if (/[اأإآ]/u.test(ch)) return '[اأإآ]';   // كل أشكال الألف
    if (/[يى]/u.test(ch))   return '[يى]';     // (اختياري) ي/ى
    if (/[هة]/u.test(ch))   return '[هة]';     // (اختياري) ه/ة
    return escapeChar(ch);
  };

  // حروف التوكن مع السماح بالحركات/التطويل بينها
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

// استبقاء نفس أسماء الدوال القديمة حتى لا نكسر الاستدعاءات
function highlightTextTokens(el, text, tokensRaw){
  highlightPartial(el, text, tokensRaw);
}

function highlightNameTokens(el, name, tokensRaw){
  highlightPartial(el, name, tokensRaw);
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

function _parseYMD(str){
  const parts = String(str || '').trim().split(/[-/]/);
  let y = null, m = 0, d = 1;
  if (parts[0]) y = parseInt(parts[0], 10);
  if (parts[1]) m = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
  if (parts[2]) d = Math.max(1, Math.min(31, parseInt(parts[2], 10)));
  return Number.isFinite(y) ? { y, m, d } : null;
}

function _getBirthDate(bio){
  if (!bio) return null;
  if (bio.birthDate && bio.birthDate !== '-') {
    const b = _parseYMD(bio.birthDate);
    if (!b) return null;
    return new Date(b.y, b.m, b.d);
  }
  if (bio.birthYear && bio.birthYear !== '-') {
    const y = parseInt(String(bio.birthYear).trim().slice(0,4), 10);
    if (!Number.isFinite(y)) return null;
    return new Date(y, 0, 1);
  }
  return null;
}

function _getDeathDateOrNull(bio, birth){
  if (!bio || !birth) return { ref: new Date(), died: false };

  if (bio.deathDate && bio.deathDate !== '-') {
    const d = _parseYMD(bio.deathDate);
    if (d){
      const death = new Date(d.y, d.m, d.d);
      if (!Number.isNaN(death.getTime()) && death.getTime() >= birth.getTime()){
        return { ref: death, died: true };
      }
    }
  } else if (bio.deathYear && bio.deathYear !== '-') {
    const dy = parseInt(String(bio.deathYear).trim().slice(0,4), 10);
    if (Number.isFinite(dy)){
      const death = new Date(dy, 0, 1);
      if (!Number.isNaN(death.getTime()) && death.getTime() >= birth.getTime()){
        return { ref: death, died: true };
      }
    }
  }

  return { ref: new Date(), died: false };
}

function _fmtUnit(n, one, two, few, many){
  if (n <= 0) n = 1;
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

function _fmtDays(n){  return _fmtUnit(n,'يوم واحد','يومان','أيام','يومًا'); }
function _fmtWeeks(n){ return _fmtUnit(n,'أسبوع واحد','أسبوعان','أسابيع','أسبوعًا'); }
function _fmtMonths(n){return _fmtUnit(n,'شهر واحد','شهران','أشهر','شهرًا'); }
function _fmtYears(n){
  if (n <= 0) return null;
  if (n === 1) return 'سنة واحدة';
  if (n === 2) return 'سنتان';
  if (n >= 3 && n <= 10) return `${n} سنوات`;
  return `${n} سنة`;
}

// حساب العمر الخام (بالسنوات) حتى تاريخ معيّن (اليوم أو تاريخ الوفاة)
function computeAgeFromBio(bio, refDate){
  const birth = _getBirthDate(bio);
  if (!birth || Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  const ref = (refDate instanceof Date && !Number.isNaN(refDate.getTime())) ? refDate : today;

  if (ref.getTime() <= birth.getTime()) return null;

  let age = ref.getFullYear() - birth.getFullYear();
  const mDiff = ref.getMonth() - birth.getMonth();
  const dDiff = ref.getDate() - birth.getDate();
  if (mDiff < 0 || (mDiff === 0 && dDiff < 0)) age--;

  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}


function formatAgeFromBio(bio){
  const birth = _getBirthDate(bio);
  if (!birth || Number.isNaN(birth.getTime())) return null;

  const { ref, died } = _getDeathDateOrNull(bio, birth);

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  let diffDays = Math.floor((ref.getTime() - birth.getTime()) / MS_PER_DAY);
  if (diffDays < 0) return null;

  if (died && diffDays === 0) diffDays = 1;

  const prefix = died ? 'توفّي عن عمر ' : '';

  if (diffDays < 7)  return prefix + _fmtDays(diffDays);
  if (diffDays < 30) return prefix + _fmtWeeks(Math.floor(diffDays/7) || 1);
  if (diffDays < 365)return prefix + _fmtMonths(Math.floor(diffDays/30) || 1);

  const years = computeAgeFromBio(bio, ref);
  const yLabel = _fmtYears(years);
  return yLabel ? prefix + yLabel : null;
}



// ===== عرض حقول bio العامة =====
export function renderBioInfo(container, bio){
  const wrap = el('div','bio-info');

  Object.keys(LABELS).forEach(k => {
    // ميلاد: لا تُظهر سنة الميلاد إذا وُجد تاريخ كامل
    if (k === 'birthYear' && bio.birthDate) return;
    if (k === 'birthDate' && !bio.birthDate) return;

    // وفاة: لا تُظهر سنة الوفاة إذا وُجد تاريخ كامل
    if (k === 'deathYear' && bio.deathDate) return;
    if (k === 'deathDate' && !bio.deathDate && !bio.deathYear) return;

    const val = bio[k];
    if (val && val !== '-'){
      const row = el('div','bio-field');
      row.append(
        textEl('strong', LABELS[k]+':'),
        textEl('span', String(val))
      );
      wrap.appendChild(row);
    }
  });

  // احتياط قديم: لو لم يكن LABELS.birthDate معرّفًا
  if (!LABELS.birthDate && bio.birthDate){
    const row = el('div','bio-field');
    row.append(textEl('strong','تاريخ الميلاد:'), textEl('span', String(bio.birthDate)));
    wrap.appendChild(row);
  }

  const ageLabel = formatAgeFromBio(bio);
  if (ageLabel){
    const row = el('div','bio-field');
    row.append(textEl('strong','العمر:'), textEl('span', ageLabel));
    wrap.appendChild(row);
  }

  if (wrap.querySelectorAll('.bio-field').length > 0) container.appendChild(wrap);
}

export function renderListSection(container, title, arr, itemRenderer){
  if (!Array.isArray(arr) || !arr.length) return;
  const d = el('div'); d.append(textEl('h3', title));
  const ul = el('ul');
  arr.forEach(a => {
    const li = el('li'); const label = itemRenderer ? itemRenderer(a) : (a?.name || a);
    li.textContent = String(label || '').trim(); ul.appendChild(li);
  });
  d.appendChild(ul); container.appendChild(d);
}

// ===== صناديق العدّادات =====
function normalizeLabel(l){ if (!l && l!==0) return ''; return String(l).replace(/[:\s]+$/u,'').trim(); }
function createCounterBox(items = []){
  const box = el('div','counter-box'), left = el('div','counter-left'), right = el('div','counter-right');
  items.forEach(it => {
    if (it.value == null || Number(it.value) === 0) return;
    const raw = normalizeLabel(it.label);
    const p = el('p','count-item');
    p.append(textEl('span', raw+':','count-label'), textEl('span', String(it.value),'count-value'));
    (['الإخوة','الأخوات','الزوجات'].includes(raw) ? left : right).appendChild(p);
  });
  if (!left.children.length && !right.children.length) return null;
  box.append(right,left); return box;
}
function createCounterBoxForPerson(person){
  const items = [];
  if (Array.isArray(person.wives) && person.wives.length) items.push({label:'الزوجات',value:person.wives.length});
  if (Array.isArray(person.children) && person.children.length){
    const sons = person.children.filter(c => (c?.role||'').trim()==='ابن').length;
    const daughters = person.children.filter(c => (c?.role||'').trim()==='بنت').length;
    if (sons) items.push({label:'الأبناء',value:sons});
    if (daughters) items.push({label:'البنات',value:daughters});
    if (sons||daughters) items.push({label:'الإجمالي',value:sons+daughters});
  }
  const bio = person.bio||{};
  if (Array.isArray(bio.siblingsBrothers) && bio.siblingsBrothers.length) items.push({label:'الإخوة',value:bio.siblingsBrothers.length});
  if (Array.isArray(bio.siblingsSisters) && bio.siblingsSisters.length) items.push({label:'الأخوات',value:bio.siblingsSisters.length});
  return items.length ? createCounterBox(items) : null;
}
export function getRoleAvatar(role){
  const map = {"الجد الأول":"👴","الجد الثاني":"👴","جدة":"👵","الأب":"👨","الأم":"👩","ابن":"👦","بنت":"👧","زوج":"👨‍🦱","زوجة":"👩‍🦰","الزوجة الأولى":"👩‍🦰","صاحب الشجرة":"🧑‍🌾"};
  return map[role] || "👤";
}

// ===== محرر اسم بسيط في الـ contenteditable =====
function insertPlainTextAtCursor(t){
  const sel = window.getSelection && window.getSelection(); if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
}

// ===== إنشاء بطاقة عضو (بدون تعديل بيانات) =====
export function createCard(person, className = '', handlers = {}, opts = {}){
  const card = el('div', `member-card ${className||''}`.trim());
  const bio = person.bio || {};

  if (person._id){ RENDERED_IDS.add(person._id); card.dataset.personId = person._id; } else { card.removeAttribute('data-person-id'); }

  const dob = (bio.birthDate && bio.birthDate !== '-') ? String(bio.birthDate).trim()
             : ((bio.birthYear && bio.birthYear !== '-') ? String(bio.birthYear).trim() : '');
  const motherName = (bio.motherName || '').trim();
  const hasMother = !!motherName && motherName !== '-';
  
  // الصورة/الإيموجي
  const avatar = el('div','avatar');
  avatar.textContent = getRoleAvatar(person.role);
  card.appendChild(avatar);
  refreshAvatar(card, person);

  // الاسم (قابل للتحرير فقط في العائلات غير الأساسية)
  const canEditName = !(opts && opts.readonlyName);
  const nameClasses = canEditName ? 'name editable-inline editable-name' : 'name';
  const nameEl = textEl('div', String(person.name||''), nameClasses);
// منع فقاعات الأحداث على الاسم دائمًا (حتى في readonlyName) للحفاظ على السلوك السابق
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
     // اسم للعرض فقط في العائلات الأساسية: يرجع لمؤشر البطاقة (pointer)
    nameEl.style.cursor = 'pointer';
    // اسم للعرض فقط في العائلات الأساسية
    nameEl.removeAttribute('contenteditable');
    nameEl.removeAttribute('data-placeholder');
    nameEl.removeAttribute('title');
  }

  // إبراز الاسم أثناء وضع البحث إن وُجدت رموز
  if (opts && Array.isArray(opts.highlightTokens) && opts.highlightTokens.length){
    try { highlightNameTokens(nameEl, String(person.name||''), opts.highlightTokens); } catch {}
  }


  // تنميط "الزوجة 1/2/3" أو "زوجة 1/2/3" إلى "الزوجة الأولى/الثانية/..."
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
  // سطر اللقب في وضع البحث فقط
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

  // فتح التفاصيل إلا داخل مناطق التحرير/التحديد
  card.style.cursor = 'pointer';
  const isInsideEditable = ev => (ev.composedPath ? ev.composedPath() : []).some(n => n?.nodeType === 1 && n.getAttribute && n.getAttribute('contenteditable') === 'true');
  card.addEventListener('click', ev => {
    if (isInsideEditable(ev)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) return;
    if (document.activeElement?.getAttribute?.('contenteditable') === 'true') return;
    ev.stopPropagation(); if (typeof handlers.onShowDetails === 'function') handlers.onShowDetails(person);
  });

  // إضافة موصل الزوجة داخل البطاقة (مرة واحدة)
  if (card.classList.contains('wife') && !card.querySelector('.wife-connector')) {
    card.appendChild(el('div','wife-connector'));
  }

  return card;

}

// ===== موصلات بصرية بسيطة =====
function createConnector(){ return el('div','connector'); }

// ===== مقطع زوجة + أبنائها مع احترام الفلاتر/البحث =====
function createWifeSection(wife, handlers, match, passFiltersFn, opts = {}){
  const sec = el('div','wife-section');
// لا تُظهر بطاقة الزوجة إلا إذا طابقت الفلاتر نفسها.
// عند وجود نصّ بحث، يجب أيضًا أن تطابق البحث مثل غيرها.
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

if (showWifeCard){
  sec.append(grid);
}

 else {
    if (drawn > 0) sec.append(grid); else return null;
  }
  return sec;
}

// ===== بحث شخص داخل عائلة بمسح شامل (يدعم ancestors[]) =====
function findByIdInFamily(pid, family){
  if (!pid || !family) return null;
  const tops = [
    ...(Array.isArray(family.ancestors) ? family.ancestors : []),
    family.father, family.rootPerson, ...(family.wives || [])
  ].filter(Boolean);

  const visit = (p) => {
    if (!p) return null;
    if (p._id === pid) return p;
    if (Array.isArray(p.children)) for (const c of p.children){ if (c?._id === pid) return c; }
    if (Array.isArray(p.wives)) for (const w of p.wives){ const hit = visit(w); if (hit) return hit; }
    return null;
  };
  for (const top of tops){ const hit = visit(top); if (hit) return hit; }
  return null;
}

// ===== أقسام السيرة داخل المودال/التفاصيل =====

// مفاتيح الأقسام المسموحة + الترتيب الافتراضي
// أضفنا achievements + hobbies حتى تدخل في نفس نظام الطي/الفتح
const BIO_SECTION_KEYS = [
  'basic',
  'grands',
  'family',
  'wives',
  'children',
  'achievements',
  'hobbies'
];

// الترتيب الافتراضي (يمكن تخصيصه لاحقًا عبر handlers.bioSectionsOrder)
const DEFAULT_BIO_SECTIONS_ORDER = [...BIO_SECTION_KEYS];

// حالة طي/فتح الأقسام في جلسة الصفحة (لكل شخص حسب _id)
const BIO_SECTIONS_STATE = new Map(); // personKey -> { [sectionId]: boolean }
let CURRENT_BIO_PERSON_KEY = null;    // يتم ضبطه عند renderBioSections

function getSectionOpenState(personKey, sectionId, fallbackOpen){
  if (!personKey) return !!fallbackOpen;
  const rec = BIO_SECTIONS_STATE.get(personKey);
  if (!rec || typeof rec[sectionId] !== 'boolean') return !!fallbackOpen;
  return rec[sectionId];
}

function setSectionOpenState(personKey, sectionId, isOpen){
  if (!personKey) return;
  const rec = BIO_SECTIONS_STATE.get(personKey) || {};
  rec[sectionId] = !!isOpen;
  BIO_SECTIONS_STATE.set(personKey, rec);
}

// ترتيب ديناميكي للأقسام (يمكن تمرير handlers.bioSectionsOrder = ['basic','wives',...])
function getBioSectionsOrder(handlers){
  const custom = handlers && Array.isArray(handlers.bioSectionsOrder) ? handlers.bioSectionsOrder : null;
  const src = custom && custom.length ? custom : DEFAULT_BIO_SECTIONS_ORDER;
  const seen = new Set();
  const out  = [];

  src.forEach(k => {
    if (BIO_SECTION_KEYS.includes(k) && !seen.has(k)){
      seen.add(k);
      out.push(k);
    }
  });

  // أي قسم مفقود من الترتيب المخصّص نضيفه في النهاية
  BIO_SECTION_KEYS.forEach(k => {
    if (!seen.has(k)) out.push(k);
  });

  return out;
}

// إنشاء قسم موحّد (ثابت أو قابل للطي/الفتح مع state)
function createBioSection(id, title, { defaultOpen = true, collapsible = true } = {}){
  const sec  = el('section','bio-section');
  const body = el('div','bio-section-body');
  sec.dataset.sectionId = id;

  // قسم ثابت (مثل: البيانات الأساسية) — بدون سهم ولا زر طي
  if (!collapsible){
    const header = el('div','bio-section-header');
    header.append(textEl('span', title, 'bio-section-title'));
    sec.append(header, body);
    return { section: sec, body };
  }

  // الأقسام القابلة للطي تعتمد على حالة مخزنة إن وجدت
  const personKey = CURRENT_BIO_PERSON_KEY;
  const isOpenInit = getSectionOpenState(personKey, id, defaultOpen);

  const headerBtn = document.createElement('button');
  headerBtn.type = 'button';
  headerBtn.className = 'bio-section-header';
  headerBtn.setAttribute('aria-expanded', isOpenInit ? 'true' : 'false');

  const titleSpan  = textEl('span', title, 'bio-section-title');
  const toggleSpan = textEl('span', isOpenInit ? '▼' : '▶', 'bio-section-toggle');

  headerBtn.append(titleSpan, toggleSpan);

  if (!isOpenInit){
    body.hidden = true;
    sec.classList.add('collapsed');
  }

  headerBtn.addEventListener('click', () => {
    const isOpen = headerBtn.getAttribute('aria-expanded') === 'true';
    const next   = !isOpen;

    headerBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
    body.hidden = !next;
    sec.classList.toggle('collapsed', !next);
    toggleSpan.textContent = next ? '▼' : '▶';

    // تحديث حالة القسم لهذا الشخص في نفس الجلسة
    setSectionOpenState(personKey, id, next);
  });

  sec.append(headerBtn, body);
  return { section: sec, body };
}

// صف حقل نصّي داخل قسم
function addBioRow(parent, label, value){
  if (value == null) return;
  const v = String(value).trim();
  if (!v || v === '-') return;
  const row = el('div','bio-field');
  row.append(textEl('strong', label + ':'), textEl('span', v));
  parent.appendChild(row);
}

function renderClickableNames(parent, title, arr, handlers){
  if (!Array.isArray(arr) || !arr.length) return;

  const sec = el('div','bio-sublist');
  if (title) sec.append(textEl('h3', title));

  const ul = el('ul');

  arr.forEach(x => {
    const nm = (x && x.name) ? String(x.name).trim() : String(x || '').trim();
    if (!nm) return;

    const li = el('li');
    li.textContent = nm;

    const id = x && x._id;
    if (id && handlers?.onShowDetails){
      li.classList.add('clickable');
      li.style.cursor = 'pointer';
      li.addEventListener('click', ev => {
        ev.stopPropagation();
        handlers.onShowDetails(id);
      });
    }

    ul.appendChild(li);
  });

  if (ul.children.length){
    sec.appendChild(ul);
    parent.appendChild(sec);
  }
}


/* ===== 1) قسم البيانات الأساسية ===== */
function buildBasicSection(bio, person, family){
  // قسم ثابت: معروض دائمًا، بدون سهم/طي
  const { section, body } = createBioSection('basic','البيانات الأساسية',{
    defaultOpen: true,
    collapsible: false
  });

  // هوية الشخص
  addBioRow(body, LABELS.fullName   || 'الإسم',     bio.fullName || bio.fullname || '');
  addBioRow(body, LABELS.cognomen   || 'اللقب',     bio.cognomen);
  addBioRow(body, LABELS.occupation || 'المهنة',    bio.occupation);

  // الوالدان
  addBioRow(body, LABELS.fatherName || 'اسم الأب', bio.fatherName);
  addBioRow(body, LABELS.motherName || 'اسم الأم', bio.motherName);

  // مكان الميلاد
  addBioRow(body, LABELS.birthPlace || 'مكان الميلاد', bio.birthPlace);

  // الميلاد
  if (bio.birthDate && bio.birthDate !== '-') {
    addBioRow(body, LABELS.birthDate || 'تاريخ الميلاد', bio.birthDate);
  } else if (bio.birthYear && bio.birthYear !== '-') {
    addBioRow(body, LABELS.birthYear || 'سنة الميلاد', bio.birthYear);
  }

  // الوفاة
  if (bio.deathDate && bio.deathDate !== '-') {
    addBioRow(body, LABELS.deathDate || 'تاريخ الوفاة', bio.deathDate);
  } else if (bio.deathYear && bio.deathYear !== '-') {
    addBioRow(body, LABELS.deathYear || 'سنة الوفاة', bio.deathYear);
  }

  // العمر
  const ageLabel = formatAgeFromBio(bio);
  if (ageLabel){
    const diedNow = !!(
      (bio.deathDate && bio.deathDate !== '-') ||
      (bio.deathYear && bio.deathYear !== '-')
    );
    const row = el('div','bio-field');
    row.append(textEl('strong','العمر:'));
    const ageSpan = textEl('span', ageLabel, diedNow ? 'age-dead' : 'age-alive');
    row.append(ageSpan);
    body.appendChild(row);
  }

  // الانتماء القبلي/العشائري
  const resolvedTribe = person && family ? Lineage.resolveTribe(person, family) : (bio.tribe || '');
  const resolvedClan  = person && family ? Lineage.resolveClan(person, family)  : (bio.clan  || '');
  addBioRow(body, LABELS.tribe      || 'القبيلة',    resolvedTribe);
  addBioRow(body, LABELS.clan       || 'العشيرة',    resolvedClan);
  addBioRow(body, LABELS.motherClan || 'عشيرة الأم', bio.motherClan);

  // ملاحظة ختامية
  addBioRow(body, LABELS.remark || 'ملاحظة', bio.remark);

  if (!body.querySelector('.bio-field')) return null;
  return section;
}

/* ===== 2) قسم الأسلاف والجدات ===== */
function buildGrandsSection(bio){
  // مطوي افتراضيًا، ويُفتح حسب state إن وُجد
  const { section, body } = createBioSection('grands','الأسلاف والجدات',{ defaultOpen: true  });

  const fatherSide = el('div','bio-subsection');
  fatherSide.append(textEl('h3','جهة الأب'));
  addBioRow(fatherSide, 'اسم الجد',    bio.paternalGrandfather);
  addBioRow(fatherSide, 'اسم الجدة',   bio.paternalGrandmother);
  addBioRow(fatherSide, 'عشيرة الجدة', bio.paternalGrandmotherClan);

  const motherSide = el('div','bio-subsection');
  motherSide.append(textEl('h3','جهة الأم'));
  addBioRow(motherSide, 'اسم الجد',  bio.maternalGrandfather);
  addBioRow(motherSide, 'اسم الجدة', bio.maternalGrandmother);
  const derivedMaternalClan = bio.maternalGrandfatherClan || bio.motherClan || '';
  addBioRow(motherSide, 'عشيرة الجد',  derivedMaternalClan);
  addBioRow(motherSide, 'عشيرة الجدة', bio.maternalGrandmotherClan);

  const hasFatherSide = !!fatherSide.querySelector('.bio-field');
  const hasMotherSide = !!motherSide.querySelector('.bio-field');

  if (hasFatherSide) body.appendChild(fatherSide);
  if (hasMotherSide) body.appendChild(motherSide);

  if (!body.children.length) return null;
  return section;
}

/* ===== 3) قسم العائلة (الإخوة/الأخوات + الأعمام/العمّات/الأخوال/الخالات) ===== */
function buildFamilySection(bio, person, family, handlers){
  // مطوي افتراضيًا، ويُفتح حسب state إن وُجد
  const { section, body } = createBioSection('family','العائلة',{ defaultOpen: true  });

  // الإخوة والأخوات (من Lineage)
  const sib  = Lineage.resolveSiblings(person, family);
  const bros = sib.brothers || [];
  const sis  = sib.sisters  || [];

  renderClickableNames(body, `الإخوة (${bros.length})`, bros, handlers);
  renderClickableNames(body, `الأخوات (${sis.length})`, sis, handlers);

  // الأعمام/العمّات/الأخوال/الخالات
  const ua = Lineage.resolveUnclesAunts(person, family);
  const patUncles = ua.paternalUncles || [];
  const patAunts  = ua.paternalAunts  || [];
  const matUncles = ua.maternalUncles || [];
  const matAunts  = ua.maternalAunts  || [];

  if (patUncles.length){
    renderClickableNames(body, `الأعمام (${patUncles.length})`, patUncles, handlers);
  }
  if (patAunts.length){
    renderClickableNames(body, `العمّات (${patAunts.length})`, patAunts, handlers);
  }
  if (matUncles.length){
    renderClickableNames(body, `الأخوال (${matUncles.length})`, matUncles, handlers);
  }
  if (matAunts.length){
    renderClickableNames(body, `الخالات (${matAunts.length})`, matAunts, handlers);
  }

  if (!body.children.length) return null;
  return section;
}

/* ===== 4) قسم الزوجات ===== */
function buildWivesSection(person, family, handlers){
  let wives = [];
  if (family && (person === family.rootPerson || (person?.role || '').trim() === 'صاحب الشجرة')){
    wives = Array.isArray(family?.wives) ? family.wives : [];
  } else if (Array.isArray(person?.wives) && person.wives.length){
    wives = person.wives;
  }

  if (!wives.length) return null;

  // مطوي افتراضيًا، ويُفتح حسب state إن وُجد
  const { section, body } = createBioSection('wives', `الزوجات (${wives.length})`, { defaultOpen: true });

renderClickableNames(body, '', wives, handlers);
if (!body.children.length) return null;
return section;

}

/* ===== 5) قسم الأبناء (الأبناء + البنات في قسم واحد) ===== */
function buildChildrenSection(person, family, handlers){
  let kids = [];
  // نفس منطق تجميع الأبناء الحالي
  if (person && Array.isArray(person.children) && person.children.length){
    kids = person.children;
  } else if (family && (person === family.rootPerson || (person?.role || '').trim() === 'صاحب الشجرة')){
    kids = (family.wives || []).flatMap(w => Array.isArray(w.children) ? w.children : []);
  }

  if (!kids.length) return null;

  const sons      = kids.filter(c => (c?.role || '').trim() === 'ابن');
  const daughters = kids.filter(c => (c?.role || '').trim() === 'بنت');

  // لو لا يوجد لا أبناء ولا بنات بعد الفلترة ⇒ لا قسم
  if (!sons.length && !daughters.length) return null;

  // قسم رئيسي واحد في مستوى بقية الأقسام
  const { section, body } = createBioSection(
    'children',
    'الأبناء والبنات',
    { defaultOpen: true }  // افتراضيًا مفتوح، مع احترام حالة الجلسة
  );

  // قسم فرعي للأبناء
if (sons.length){
  renderClickableNames(body, `الأبناء (${sons.length})`, sons, handlers);
}
  // قسم فرعي للبنات
if (daughters.length){
  renderClickableNames(body, `البنات (${daughters.length})`, daughters, handlers);
}

  // لو لسبب ما لم يُضَف أي محتوى فرعي ⇒ لا ترسم القسم
  if (!body.children.length) return null;
  return section;
}


/* ===== 6) قسم الإنجازات ===== */
function buildAchievementsSection(bio){
  const list = Array.isArray(bio.achievements)  ? bio.achievements.map(x => String(x || '').trim()).filter(Boolean)
    : [];

  if (!list.length) return null;

  // قسم قابل للطي مثل بقية الأقسام
  const { section, body } = createBioSection('achievements','الإنجازات',{ defaultOpen: true });

  const ul = el('ul');
  list.forEach(item => {
    const li = el('li');
    li.textContent = item;
    ul.appendChild(li);
  });

  body.appendChild(ul);
  return section;
}

/* ===== 7) قسم الهوايات ===== */
function buildHobbiesSection(bio){
  const hobbies = Array.isArray(bio.hobbies)  ? bio.hobbies.map(x => String(x || '').trim()).filter(Boolean)
    : [];

  if (!hobbies.length) return null;

  // قسم قابل للطي مثل بقية الأقسام
  const { section, body } = createBioSection('hobbies','الهوايات',{ defaultOpen: true });

  const wrap = el('div','hobbies');
  hobbies.forEach(h => {
    if (!h) return;
    wrap.append(textEl('span', h, 'hobby'));
  });

  body.appendChild(wrap);
  return section;
}


// الدالة الرئيسية: تستدعي البناة بحسب ترتيب ديناميكي
export function renderBioSections(container, bio, person = null, family = null, handlers = {}){
  const wrap = el('div','bio-sections');

  // مفتاح الشخص الحالي لتخزين حالة الطي/الفتح في نفس الجلسة
  CURRENT_BIO_PERSON_KEY = person && person._id ? String(person._id) : null;

const builders = {
  basic:        () => buildBasicSection(bio, person, family),
  grands:       () => buildGrandsSection(bio),
  family:       () => buildFamilySection(bio, person, family, handlers),
  wives:        () => buildWivesSection(person, family, handlers),
  children:     () => buildChildrenSection(person, family, handlers),
  achievements: () => buildAchievementsSection(bio),
  hobbies:      () => buildHobbiesSection(bio)
};

  const order = getBioSectionsOrder(handlers);

  order.forEach(key => {
    const fn = builders[key];
    if (!fn) return;
    const sec = fn();
    if (!sec) return;
    wrap.appendChild(sec);
  });

  if (wrap.children.length) container.appendChild(wrap);
}

function makePassFilters(flt, fam, lineageCtx){
  return function passFilters(p){
    if (flt.role && roleGroup(p) !== flt.role) return false;

    if (flt.clan){
      const fc = normalizeAr(String(flt.clan||''));
      const resolvedClan = Lineage.resolveClan(p, fam, lineageCtx);
      const pc = normalizeAr(String(resolvedClan||''));
      if (!pc || !pc.includes(fc)) return false;
    }

    if (flt.birthFrom || flt.birthTo){
      const by = (p?.bio?.birthYear != null && String(p.bio.birthYear).trim())  ? String(p.bio.birthYear).padStart(4,'0') : '';
      const bd = String(p?.bio?.birthDate||'').trim();
      const bNorm = bd ? bd : (by ? `${by}-01-01` : '');
      if (!bNorm) return false;
      if (flt.birthFrom && bNorm < String(flt.birthFrom)) return false;
      if (flt.birthTo   && bNorm > String(flt.birthTo))   return false;
    }
    return true;
  };
}



// ===== أزرار العائلات مع احترام البحث والفلاتر =====
export function renderFamilyButtons(families = {}, selectedKey = null, handlers = {}, domRefs = {}){
  const container = (domRefs && domRefs.familyButtons) || byId('familyButtons'); if (!container) return;
  container.innerHTML = '';

  const formatLabel = (f, key) => {
    const raw = (f && f.familyName) || (f && f.title) || (f && f.rootPerson?.name) || key;
    return `عائلة: ${String(raw).trim()}`;
  };

  // نفس مطابقة drawFamilyTree
  const q   = (handlers && handlers.getSearch && handlers.getSearch()) || '';
  const flt = (handlers && handlers.getFilters && handlers.getFilters()) || { role:'', clan:'', birthFrom:'', birthTo:'' };
const match = makeMatcher(q, { fields: ['name','role','cognomen'] });

// سنبني passFilters لكل عائلة داخل familyMatches
function familyMatches(f){
  if (!f) return false;
  const ctx = Lineage.buildLineageContext(f);
  const passFilters = makePassFilters(flt, f, ctx);

  const pool = [
    ...(Array.isArray(f.ancestors) ? f.ancestors : []),
    f.father, f.rootPerson, ...(f.wives || [])
  ].filter(Boolean);
  (f.wives || []).forEach(w => (w.children || []).forEach(c => pool.push(c)));
  return pool.some(p => match(p) && passFilters(p));
}



  Object.entries(families || {}).forEach(([k,f]) => {
    if (!f || f.hidden) return;
    if ((q || flt.role || flt.clan || flt.birthFrom || flt.birthTo) && !familyMatches(f)) return;

    const wrap = document.createElement('div'); wrap.className = 'family-item';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'family-button'; btn.dataset.family = k;
    btn.setAttribute('aria-pressed', k === selectedKey ? 'true' : 'false');
    btn.textContent = formatLabel(f,k);
    if (k === selectedKey) btn.classList.add('active-family');
    btn.addEventListener('click', () => { if (typeof handlers.onSelectFamily === 'function') handlers.onSelectFamily(k); });
    wrap.appendChild(btn);

    if (f.__custom && !f.__core){
      const edit = document.createElement('button');
      edit.className='btn tiny edit-family'; edit.title='تعديل العائلة';
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
      edit.addEventListener('click', ev => { ev.stopPropagation(); handlers?.onEditFamily?.(k); });
      edit.setAttribute('tabindex','0'); edit.addEventListener('keydown', e => { if (e.key==='Enter') edit.click(); });

      const del = document.createElement('button');
      del.className='btn tiny del-family'; del.title='حذف العائلة';
      del.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; del.setAttribute('tabindex','0');
      del.addEventListener('keydown', e => { if (e.key==='Enter') del.click(); });
      del.addEventListener('click', async ev => {
        ev.stopPropagation();
        const ok = await showConfirmModal({
          title: 'حذف العائلة',
          message: `هل أنت متأكد من حذف "${(f.familyName||f.title||k)}" ؟ لا يمكن التراجع.`,
          confirmText: 'حذف', cancelText: 'إلغاء', variant: 'danger'
        });
        if (ok) await handlers?.onDeleteFamily?.(k);
      });

      wrap.append(edit, del);
    } else if (f.__core){
      const hideBtn = document.createElement('button');
      hideBtn.className = 'btn tiny hide-family'; hideBtn.title = 'إخفاء العائلة الأساسية من العرض';
      hideBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      hideBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        const ok = await showConfirmModal({
          title: 'إخفاء العائلة',
          message: `هل تريد إخفاء "${(f.familyName||f.title||k)}" من القائمة؟ يمكن إظهارها لاحقًا من الإعدادات.`,
          confirmText: 'إخفاء', cancelText: 'إلغاء', variant: 'warning'
        });
        if (ok) handlers?.onHideFamily?.(k);
      });
      wrap.appendChild(hideBtn);
    }

    container.appendChild(wrap);
  });
}

// وصف عربي دقيق للفلاتر النشطة
function describeActiveFiltersAr(flt = {}){
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

  // إن لم يوجد أي جزء، أعِد عبارة عامة
  return parts.length ? parts.join('، ') : 'الفلاتر الحالية';
}

function collectPersonsForSearch(fam){
  const out = [];
  if (!fam) return out;

  const roots = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father,
    fam.rootPerson
  ].filter(Boolean);
  roots.forEach(p => out.push(p));

  (fam.wives || []).forEach(w => out.push(w));
  (fam.wives || []).forEach(w => (w.children||[]).forEach(c => out.push(c)));

  return out;
}

/* ===== ترتيب هرمي ثابت مطابق للشجرة (لبطاقات نتائج البحث) ===== */
function buildHierarchyIndex(fam){
  const order = new Map();
  let i = 0;

  const put = (p)=>{
    if(!p) return;
    const id = p._id || p.id || p.__tempId;
    if(id && !order.has(id)) order.set(id, i++);
  };

  const walk = (p)=>{
    if(!p) return;
    put(p);

    const wives = Array.isArray(p.wives) ? p.wives : [];
    wives.forEach(w=>{
      put(w);
      (w?.children||[]).forEach(walk);
    });

    (p.children||[]).forEach(walk);
  };

  (Array.isArray(fam?.ancestors) ? fam.ancestors : []).forEach(walk);
  if(fam?.father) walk(fam.father);
  if(fam?.rootPerson) walk(fam.rootPerson);
  (fam?.wives||[]).forEach(walk);

  return order;
}

function getHierarchyRank(orderMap, p){
  const id = p?._id || p?.id || p?.__tempId;
  if(id && orderMap.has(id)) return orderMap.get(id);
  return Number.MAX_SAFE_INTEGER;
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

  // إعادة بناء الحالة عند تغيير العائلة أو الاستعلام
  if (!sameKey || q !== _lastQuery){
    for (const [id, node] of Array.from(_cardById.entries())){ try { node?.remove(); } catch{} _cardById.delete(id); RENDERED_IDS.delete(id); }
    try { clearPhotoCache(); } catch {}
  }
  _lastKey = selectedKey; _lastQuery = q;

  const __currentIds = new Set();
  const fam = families[selectedKey];
  const lineageCtx = Lineage.buildLineageContext(fam);

  // لا عائلة مرئية ⇒ رسالة إرشادية
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
  // ترتيب الأسلاف: نحافظ على ترتيب المصفوفة كما هو،
  // مع تثبيت generation وتطبيع تسمية "الجد الأول / الثاني / ..."
  const orderAncestors = (f) => {
    if (!f) return [];
    const ord = getArabicOrdinal;

    let anc = Array.isArray(f.ancestors) ? f.ancestors.slice() : [];

    anc = anc.map((a, idx) => {
      // إن لم تُحدَّد generation نأخذها من ترتيبها في المصفوفة (1 = الأقرب)
      const g = Number.isFinite(+a.generation) ? +a.generation : (idx + 1) || 1;
      let role = String(a.role || '').trim();

      const m = role.match(/^الجد\s*(\d+)$/u);
      if (m) {
        const n = parseInt(m[1], 10) || g;
        role = `الجد ${ord(n)}`;
      } else if (!role || role === 'جد' || /^الجد\s*\d+$/u.test(role)) {
        role = `الجد ${ord(g)}`;
      }

      return { ...a, generation: g, role };
    });

  const father = f.father ? [{ ...f.father, role: f.father.role || 'الأب' }] : [];
  const root   = f.rootPerson ? [{ ...f.rootPerson }] : [];

  // نرسم الأجداد من الأبعد في الأعلى إلى الأقرب في الأسفل
  // مصفوفة ancestors نفسها تبقى كما هي (الجد الأول = الأقرب)
  const ancForRender = anc.slice().reverse();

  return [...ancForRender, ...father, ...root].filter(Boolean);

  };

const match = makeMatcher(q, { fields: ['name','role','cognomen'] });
const passFilters = makePassFilters(flt, fam, lineageCtx);


  // أدوات نتائج البحث: مفتاح "إظهار اسم الأم" + عدّاد
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

  // عنوان الشجرة
const titleEl = (domRefs && domRefs.treeTitle) || byId('treeTitle');
if (titleEl) {
  const full  = (fam.fullRootPersonName || '').trim();
  const short = (fam.familyName || fam.title || fam.rootPerson?.name || '').trim();

  // العنوان المرئي
  titleEl.textContent = short ? `عائلة: ${short}` : 'عائلة';

  // تفاصيل كاملة عند المرور بالماوس + دعم الوصول
  if (full) {
    titleEl.title = full;
    titleEl.setAttribute('aria-label', `عائلة: ${full}`);
  } else {
    titleEl.removeAttribute('title');
    titleEl.removeAttribute('aria-label');
  }
}


  const ancestors = orderAncestors(fam);
  const filteredAncestors = ancestors.filter(p => match(p) && passFilters(p));

  // عدّاد الأبناء الإجمالي للعائلة
  const countChildrenAll = (family) => {
    const acc = { sons: 0, daughters: 0, total: 0 };
    (family.wives || []).forEach(w => (w.children || []).forEach(c => {
      const r = (c?.role || '').trim();
      if (r === 'ابن') acc.sons++; else if (r === 'بنت') acc.daughters++;
    }));
    acc.total = acc.sons + acc.daughters; return acc;
  };

  // رسم الأسلاف في الوضع العادي فقط
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
        const sib = {
          brothers: person.bio?.siblingsBrothers?.length || 0,
          sisters: person.bio?.siblingsSisters?.length || 0,
          wives: (fam.wives || []).length
        };
        const allC = countChildrenAll(fam);
        const merged = [];
        if (sib.brothers) merged.push({label:'الإخوة', value:sib.brothers});
        if (sib.sisters)  merged.push({label:'الأخوات', value:sib.sisters});
        if (sib.wives)    merged.push({label:'الزوجات', value:sib.wives});
        if (allC.sons)      merged.push({label:'الأبناء', value:allC.sons});
        if (allC.daughters) merged.push({label:'البنات', value:allC.daughters});
        if (allC.total)     merged.push({label:'الإجمالي', value:allC.total});
        const cb = createCounterBox(merged); if (cb) card.appendChild(cb);
      } else {
        const auto = createCounterBoxForPerson(person); if (auto) card.appendChild(auto);
      }

      if (person && person._id) __currentIds.add(person._id);

      if (idx < filteredAncestors.length - 1) generation.appendChild(createConnector());
      tree.appendChild(generation);
    });
  }

// بحث: عرض جميع المطابقين وترتيبهم + إبراز الاسم
if (q){
  const tokens = normalizeAr(q).split(/\s+/).filter(Boolean);
const tokensRaw = String(q || '').trim().split(/\s+/).filter(Boolean);

  const pool = collectPersonsForSearch(fam);
  const results = pool.filter(p => match(p) && passFilters(p));

  if (!results.length){
    const empty = el('div','empty-state'); empty.style.cssText='padding:2rem;text-align:center;opacity:.8';
    empty.append(textEl('span','لا توجد نتائج مطابقة لـ "'), textEl('strong', String(q)), textEl('span','"'));
    tree.appendChild(empty);
    setMotherVisibility(false); pruneRemoved(new Set()); toggleConnectors(tree, false);
    return;
  }

  const coll = new Intl.Collator('ar', { usage:'search', sensitivity:'base', ignorePunctuation:true });
  const hierarchyOrder = buildHierarchyIndex(fam);

  results.sort((a,b)=>{
    const ra = getHierarchyRank(hierarchyOrder, a);
    const rb = getHierarchyRank(hierarchyOrder, b);
    if (ra !== rb) return ra - rb;

    // داخل نفس الرتبة حافظ على "الأفضل مطابقة" (اختياري)
    const sa = scoreForSearch(a, tokens);
    const sb = scoreForSearch(b, tokens);
    if (sb !== sa) return sb - sa;

    const coll = new Intl.Collator('ar', { usage:'search', sensitivity:'base', ignorePunctuation:true });
    return coll.compare(String(a.name||''), String(b.name||''));
  });


  const wrap = el('div','generation search-results');
  const grid = el('div','children-grid');

  results.forEach(p => {
    const wrapCard = el('div','relative');
    const cls = (p.role === 'ابن') ? 'son' : (p.role === 'بنت' ? 'daughter' : '');

    // تحديد هل كانت المطابقة باللقب فقط
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
    highlightTokens: tokensRaw,   // إبراز جزئي مثل الاقتراحات
    showCognomenHint: hitCogOnly,
    readonlyName: !!fam.__core
  }
);


    const box = createCounterBoxForPerson(p);
    if (box && !card.querySelector('.counter-box')) card.appendChild(box);
    grid.appendChild(wrapCard);
    if (p && p._id) __currentIds.add(p._id);
  });

  wrap.appendChild(grid); tree.appendChild(wrap);
  const numEl = tree.querySelector('#resultsNum'); if (numEl) numEl.textContent = String(results.length);

  setMotherVisibility(showMotherHint);
  pruneRemoved(__currentIds);
  toggleConnectors(tree, false);
  return;
}


// عرض الزوجات + الأبناء في الوضع العادي
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
    // بعد اكتمال كل الدُفعات المؤجّلة
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
// أضف هذا الشرط قبل toggleConnectors:
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