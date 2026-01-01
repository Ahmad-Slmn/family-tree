// app.js — تهيئة وربط الواجهة بدون تعديل السلوك

import * as Model from './model/families.js';
import { DB, ensurePersistentStorage } from './storage/db.js';
import * as TreeUI from './ui/tree.js';
import * as ModalUI from './ui/modal.js';
import { ModalManager } from './ui/modalManager.js';
import { validateFamily } from './features/validate.js';
import { walkPersons, walkPersonsWithPath } from './model/families.core.js';
import {initValidationUI, setValidationResults, getValidationSummary, refreshValidationBadge, vcToastSummaryText, clearValidation} from './ui/validationCenter.js';
import {byId, showSuccess, showInfo, showError, showWarning, highlight, applySavedTheme, currentTheme, getToastNodes} from './utils.js';
import { getState, setState, subscribeTo, subscribe, batch } from './stateManager.js';
import { PinStore } from './storage/pinStore.js';

// الميزات
import * as FeatureIDs from './features/ids.js';
import * as FeatureVisibility from './features/visibility.js';
import * as FeatureDuplicates from './features/duplicates.js';
import * as FeatureSearch from './features/search.js';
import * as FeaturePhotos from './features/photo.js';
import * as FeatureStats from './features/stats.js';
import * as FeatureIO from './features/io.js';
import * as FeaturePrint from './features/print.js';
import * as FeatureEngage from './features/engage.js';
import * as FeatureSecurity from './features/security.js';

const IS_PROD =
  (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') ||
  (typeof location !== 'undefined' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1');

// تدوير عبارات رأس الشجرة (كتابة/مسح حرفيًا)
const rotatingItems=[
 {text:"تتبَّع جذور عائلتك، وتعرَّف على الأجداد والأحفاد في شجرة واحدة واضحة وسهلة التصفّح.",icon:"🌿"},
 {text:"منصة تفاعلية لاستعراض أفراد العائلة، الأجداد والأحفاد، مع تفاصيلهم وصورهم في شجرة واحدة.",icon:"🖼️"},
 {text:"هنا تلتقي أجيال العائلة في مخطط واحد؛ من الجذور إلى أحدث فرع في الشجرة.",icon:"🌳"},
 {text:"اكتشف تاريخ عائلتك، واحفظ معلومات الآباء والأجداد للأبناء والأحفاد بطريقة أنيقة ومنظّمة.",icon:"📖"},
 {text:"شجرتك العائلية… قصة تمتد عبر الزمن، تتشكل من أسماء ووجوه وذكريات.",icon:"🕰️"},
 {text:"كل فرد في العائلة هو غصن جديد يضيف جمالًا وامتدادًا لهذه الشجرة المباركة.",icon:"🌱"},
 {text:"هنا تحفظ أسماء من رحلوا، وتُكتب حكايات من سيأتون… في شجرة تجمع الماضي والحاضر.",icon:"✨"},
 {text:"تعرف على علاقاتك الأسرية بسهولة: الآباء، الأبناء، الأزواج، الإخوة… كلهم في لوحة واحدة.",icon:"🧩"},
 {text:"الأسرة جذور ثابتة وفروع نامية… وهذه الشجرة تحفظ تلك الروابط بوضوح تام.",icon:"🌼"},
 {text:"كل اسم داخل الشجرة له قصة… وكل قصة تستحق أن تروى.",icon:"📜"},
 {text:"من هنا تبدأ رحلتك لتوثيق تاريخ عائلتك، جيلاً بعد جيل.",icon:"🧭"},
 {text:"أضف أفراد عائلتك، نظّم الأنساب، واحفظ التفاصيل قبل أن تنساها الأيام.",icon:"💾"}
];

// سرعات الكتابة/المسح والوقوف
let taglineTimer=null;
const TAG_WRITE_DELAY=55,TAG_ERASE_DELAY=45,TAG_HOLD_FULL=5000,TAG_HOLD_EMPTY=700;
const TAG_STATE_KEY='treeTaglineState'; // حفظ موضع و اتجاه التايللاين

function startRotatingTagline(){
  const el=document.getElementById("treeTagline");
  const iconEl=document.getElementById("treeTagIcon");
  if(!el) return;

  // اقرأ آخر حالة محفوظة (index + i + dir)
  let state=null;
  try{ state=JSON.parse(localStorage.getItem(TAG_STATE_KEY)||'null'); }catch{}
  let index=Number(state?.index);
  let i=Number(state?.i);
  let dir=Number(state?.dir);

  if(!Number.isFinite(index)) index=(+localStorage.getItem('treeTaglineIndex')||0);
  index=((index%rotatingItems.length)+rotatingItems.length)%rotatingItems.length;
  if(!Number.isFinite(i)||i<0) i=0;
  if(dir!==1&&dir!==-1) dir=1;

  // طبّق الحالة فورًا قبل أول tick
  {
    const {text,icon}=rotatingItems[index];
    if(iconEl) iconEl.textContent=icon;
    i=Math.min(i,text.length);
    el.textContent=text.slice(0,i);
  }

  const save=()=>{ // حفظ الحالة الحالية
    localStorage.setItem(TAG_STATE_KEY,JSON.stringify({index,i,dir,ts:Date.now()}));
  };

  const tick=()=>{
    const {text,icon}=rotatingItems[index];
    if(iconEl) iconEl.textContent=icon;

    if(dir===1){
      if(++i>=text.length){
        i=text.length; el.textContent=text; dir=-1; save();
        taglineTimer=setTimeout(tick,TAG_HOLD_FULL); return;
      }
      el.textContent=text.slice(0,i); save();
      taglineTimer=setTimeout(tick,TAG_WRITE_DELAY);
    }else{
      if(--i<=0){
        i=0; el.textContent=""; dir=1;
        index=(index+1)%rotatingItems.length;
        localStorage.setItem('treeTaglineIndex',index); // بقاء التوافق القديم
        save();
        taglineTimer=setTimeout(tick,TAG_HOLD_EMPTY); return;
      }
      el.textContent=text.slice(0,i); save();
      taglineTimer=setTimeout(tick,TAG_ERASE_DELAY);
    }
  };

  clearTimeout(taglineTimer); tick();
}

window.addEventListener("DOMContentLoaded",startRotatingTagline);

// أدوات غطاء التحميل (Logo + Progress + حركة الشجرة)
let currentSplashProgress = 0;
let splashHasError        = false; // هل الغطاء في وضع خطأ حاليًا؟
// ===== تحسينات Splash: حد أدنى للمدة + مهلة + قياس الأداء =====
const SPLASH_MIN_MS   = 450;     // حد أدنى لعرض الغطاء (منع “فلاش”)
const SPLASH_MAX_MS   = 15000;   // مهلة قصوى قبل عرض Retry (لو علّق شيء)
const PERF_DEBUG = (localStorage.getItem('perfDebug') === '1');

let splashShownAt     = 0;
let splashTimeoutId   = null;

window.__bootStarted  = false;
window.__bootDone     = false;

// أدوات قياس الأداء (تظهر فقط إذا PERF_DEBUG=true)
const perf = (() => {
  const marks = new Map();
  const now = () => (performance?.now?.() || Date.now());

  return {
    start(label){
      if (!PERF_DEBUG) return;
      marks.set(label, now());
      console.log(`[perf] ▶ ${label}`);
    },
    end(label){
      if (!PERF_DEBUG) return;
      const t0 = marks.get(label);
      const dt = t0 ? (now() - t0) : 0;
      console.log(`[perf] ■ ${label}: ${dt.toFixed(1)}ms`);
    }
  };
})();

function setSplashProgress(value, label){
  value = (typeof value === 'number') ? value : 0;

  const splash = document.getElementById('app-splash');
  if (!splash) return;

  const bar    = document.getElementById('app-splash-bar');
  const text   = document.getElementById('app-splash-text');
  const progEl = document.getElementById('app-splash-progress');

  const prev = Number(splash.dataset.progress || '0');
  const v    = Math.max(prev, Math.min(100, Math.round(value)));

  splash.dataset.progress   = String(v);
  currentSplashProgress     = v;

  if (bar){
    bar.style.inlineSize = v + '%';
  }
  if (text){
    text.textContent = v + '%';
  }
  if (progEl){
    progEl.setAttribute('aria-valuenow', String(v));
  }

  // تحديث النص الوصفي فقط في حالة التحميل الطبيعي (ليس وضع خطأ)
  if (label && !splashHasError){
    const subtitle = splash.querySelector('.app-splash-subtitle');
    if (subtitle) subtitle.textContent = label;
  }
}

// رسالة ذكية حسب نوع الخطأ (بدون تغيير السلوك)
function smartSplashMsg(raw){
  const msg = String(raw || '');
  const m = msg.toLowerCase();

  // (1) مهلة/بطء
  if (
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('مهلة') ||
    m.includes('انتهت مهلة')
  ){
    return 'استغرق التحميل وقتًا أطول من المتوقع. قد تكون البيانات كبيرة أو الجهاز بطيئًا أو التخزين بطيئًا. اضغط "إعادة المحاولة".';
  }

  // (2) تخزين / IndexedDB / Quota / Security
  if (
    m.includes('indexeddb') ||
    m.includes('quota') ||
    m.includes('quotaexceeded') ||
    m.includes('quota exceeded') ||
    m.includes('storage') ||
    m.includes('securityerror') ||
    (m.includes('transaction') && m.includes('failed'))
  ){
    return 'تعذر حفظ/قراءة البيانات من التخزين في هذا المتصفح. جرّب فتح التطبيق في نافذة خاصة، أو استخدم متصفحًا آخر، ثم اضغط "إعادة المحاولة".';
  }

  // (3) فشل تحميل ملفات / شبكة / 404
  if (
    m.includes('404') ||
    m.includes('not found') ||
    m.includes('failed to fetch') ||
    m.includes('net::err') ||
    m.includes('load') && m.includes('resource')
  ){
    return 'تعذر تحميل بعض ملفات التطبيق. تأكد من تشغيل السيرفر الصحيح وأن مسارات الملفات صحيحة، ثم اضغط "إعادة المحاولة".';
  }

  // (4) عام
  return 'تعذر تحميل شجرة العائلة الآن. اضغط "إعادة المحاولة".';
}

/* عرض الغطاء في وضع الخطأ مع آخر نسبة معروفة */
function showSplashError(message){
  if (document.documentElement.classList.contains('is-locked')) {
    // اختياري: اعرض الرسالة داخل pinLock بدل splash
    return;
  }

  const s = document.getElementById('app-splash');
  if (!s) return;

  splashHasError = true;

  // إظهار الغطاء فورًا حتى لو كان قد اختفى
  s.removeAttribute('hidden');
  s.style.display = 'flex';
  s.classList.remove('is-hiding');
  s.dataset.splashHidden = '0';
  s.setAttribute('aria-busy','true');

  // ضمان أن شريط التقدم يعرض آخر نسبة محفوظة
  const bar    = document.getElementById('app-splash-bar');
  const text   = document.getElementById('app-splash-text');
  const progEl = document.getElementById('app-splash-progress');
  const v = Number(s.dataset.progress || currentSplashProgress || 0);

  if (bar){
    bar.style.inlineSize = v + '%';
  }
  if (text){
    text.textContent = v + '%';
  }
  if (progEl){
    progEl.setAttribute('aria-valuenow', String(v));
  }

  // نص الخطأ
  const subtitle = s.querySelector('.app-splash-subtitle');
  if (subtitle){
const baseMsg = smartSplashMsg(message);
    if (message){
      // نختصر الرسالة حتى لا تفسد التصميم
      const msgStr = String(message);
      const shortMsg = msgStr.length > 160 ? msgStr.slice(0,157) + '…' : msgStr;
      subtitle.textContent = baseMsg + ' (تفاصيل: ' + shortMsg + ')';
    } else {
      subtitle.textContent = baseMsg;
    }
  }
  // إظهار زر إعادة المحاولة
  const actions = s.querySelector('.app-splash-actions');
  if (actions) actions.hidden = false;

  const retryBtn = document.getElementById('app-splash-retry');
  if (retryBtn && !retryBtn.dataset.bound){
    retryBtn.dataset.bound = '1';
    retryBtn.addEventListener('click', () => {
      // إعادة تحميل الصفحة (حل آمن وبسيط)
      location.reload();
    });
  }

  // كلاس اختياري لو أردت تنسيق خاص لحالة الخطأ (يمكنك استخدامه في CSS)
  s.classList.add('has-error');
}

/* إخفاء الغطاء (لا يُخفي إن كان في وضع خطأ إلا لو force=true) */
function hideSplash(force = false){
  const s = document.getElementById('app-splash');
  if (!s || s.dataset.splashHidden === '1') return;

  // في حال وجود خطأ، لا نخفي الغطاء إلا عند نجاح التحميل (force)
  if (!force && splashHasError) return;

  const doHide = () => {
    splashHasError = false;
    s.classList.remove('has-error');

    // أخفِ actions إن وُجدت
    const actions = s.querySelector('.app-splash-actions');
    if (actions) actions.hidden = true;

    s.dataset.splashHidden = '1';
    s.setAttribute('aria-busy','false');
    s.classList.add('is-hiding');

    const finishHide = () => {
      s.removeEventListener('animationend', finishHide);
      s.setAttribute('hidden','');
      s.style.display = 'none';
    };

    s.addEventListener('animationend', finishHide);

    setTimeout(() => {
      if (!s.hasAttribute('hidden')) finishHide();
    }, 650);

    // دخول الشجرة
    const tree = document.getElementById('familyTree');
    if (tree){
      tree.classList.add('family-tree-enter');
      tree.addEventListener('animationend', () => {
        tree.classList.remove('family-tree-enter');
      }, { once:true });
    }
  };

  // حد أدنى للمدة (منع فلاش)
  const elapsed = (performance?.now?.() || Date.now()) - (splashShownAt || 0);
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);

  if (wait > 0 && !force){
    setTimeout(doHide, wait);
  } else {
    doHide();
  }
}

function armSplashTimeout(){
  clearTimeout(splashTimeoutId);
  splashTimeoutId = setTimeout(() => {
    if (!window.__bootDone && !splashHasError){
      showSplashError('انتهت مهلة التحميل. قد تكون البيانات كبيرة أو التخزين بطيء. اضغط "إعادة المحاولة".');
    }
  }, SPLASH_MAX_MS);
}

function disarmSplashTimeout(){
  clearTimeout(splashTimeoutId);
  splashTimeoutId = null;
}

// Fallback: لا نخفي عند load إلا إذا boot لم يكتمل خلال مدة معقولة
window.addEventListener('load', () => {
  // إذا اكتمل bootstrap بالفعل -> لا تفعل شيء (مصدر واحد للإخفاء)
  if (window.__bootDone) return;

  // إذا لم يبدأ bootstrap لأي سبب (نادر) -> شغّله أو على الأقل لا تعلق
  if (!window.__bootStarted && !splashHasError){
    // لا نخفي هنا، لأننا لا نعرف حالة التحميل
    // نترك مهلة الـ Splash تتكفل بإظهار retry
    armSplashTimeout();
  }
});


/* =========================
   حافلة أحداث بسيطة
   ========================= */
const bus = (() => {
  const m = new Map();

  const on = (t, f) => {
    const arr = m.get(t) || [];
    arr.push(f);
    m.set(t, arr);
    return () => off(t, f); // مفيد كـ unsubscribe
  };

  const off = (t, f) => {
    const arr = m.get(t);
    if (!arr || !arr.length) return;
    const next = arr.filter(fn => fn !== f);
    if (next.length) m.set(t, next);
    else m.delete(t);
  };

  const once = (t, f) => {
    const w = (p) => { off(t, w); f(p); };
    on(t, w);
    return () => off(t, w);
  };

  const emit = (t, p) => {
    const arr = m.get(t) || [];
    // نسخة snapshot عشان لو listener شال نفسه ما يخرب اللوب
    arr.slice().forEach(fn => fn(p));
  };

  return { on, off, once, emit };
})();


/* =========================
   DOM مشترك
   ========================= */
const dom = {
  pendingPhoto: null,
  familyButtons: null, themeButtons: null, closeModalBtn: null, toastContainer: null,
  familyTree: null, treeTitle: null, bioModal: null, modalName: null, modalRole: null, modalContent: null,
  searchInput: null, suggestBox: null, activeFamily: null,
   bioModeSelect: null,
  bioSectionsContainer: null
};

/*
نموذج ذهني لقفل واجهة الـ PIN (بالأولوية):

1) القفل اليدوي دائمًا له الأولوية.
2) الجلسة المفتوحة تعطل قفل الخمول وقفل ترك التبويب.
3) القفل بسبب ترك التبويب لا يُفتح تلقائيًا أبدًا.
4) فتح القفل يتطلب إدخال كلمة المرور دائمًا (باستثناء "الجلسة المفتوحة").
5) قد تصل أحداث التخزين بين التبويبات بترتيب غير مضمون → لذلك نؤجل بعض القرارات Tick صغير.
*/

/* =========================
   🔒 PIN Lock (UI-only)
   ========================= */

const PIN_KEYS = {
  enabled: 'pin_enabled',              // "1"|"0"
  salt: 'pin_salt',
  hash: 'pin_hash',
  hint: 'pin_hint',
  idleMin: 'pin_idle_minutes',         // default 3
  tries: 'pin_tries',
  lockUntil: 'pin_lock_until',
  lastActivity: 'pin_last_activity',
  sessionUntil: 'pin_session_until',
  lockOnVis: 'pin_lock_on_visibility',  // default "0"
  lastTryAt: 'pin_last_try_at'
};


// ✅ Session-only lock state (يبقى بعد refresh، يختفي عند إغلاق التبويب)
const PIN_SESSION_KEYS = {
  locked: 'pin_ui_locked'
};

function _ssGet(k, def=null){
  try{ const v = sessionStorage.getItem(k); return v == null ? def : v; }catch{ return def; }
}
function _ssSet(k, v){
  try{ sessionStorage.setItem(k, String(v)); }catch{}
}


let _pin = {
  el: null,
  input: null,
  unlockBtn: null,
  msg: null,
  hint: null,

  eyeBtn: null,

  locked: false,
  intervalId: null,
  trapHandler: null,

  // للعد التنازلي
  cooldownTimer: null,

  // لإرجاع التركيز بعد الفتح
  prevFocus: null
};


function _lsGet(k, def = null){
  // مفاتيح PIN الأساسية من IDB (sync من cache)
  if (PinStore.PERSISTED_KEYS?.has?.(k)) {
    return PinStore.getSync(k, def);
  }
  try{
    const v = localStorage.getItem(k);
    return (v == null) ? def : v;
  }catch{ return def; }
}

function _lsSet(k, v){
  if (PinStore.PERSISTED_KEYS?.has?.(k)) {
    PinStore.set(k, v);
    return;
  }
  try{ localStorage.setItem(k, String(v)); }catch{}
}

function _now(){ return Date.now(); }

function _hasPinConfigured(){
  const salt = _lsGet(PIN_KEYS.salt, '');
  const hash = _lsGet(PIN_KEYS.hash, '');
  return !!(salt && hash);
}
function _isPinEnabled(){
  return _lsGet(PIN_KEYS.enabled, '0') === '1' && _hasPinConfigured();
}

function _idleMinutes(){
  const v = parseInt(_lsGet(PIN_KEYS.idleMin, '3'), 10);
  if (isNaN(v) || v <= 0) return 3;
  return v;
}
function _lockOnVisibility(){
  // افتراضيًا غير مفعّل
return _lsGet(PIN_KEYS.lockOnVis, '0') === '1'; // ✅ default OFF
}

function hardHideSplashForLock(){
  const s = document.getElementById('app-splash');
  if (!s) return;

  // تذكّر أنه كان ظاهرًا (اختياري)
  s.dataset.hiddenByPin = '1';

  s.classList.remove('is-hiding');
  s.setAttribute('hidden', '');
  s.style.display = 'none';
  s.setAttribute('aria-busy','false');
}

function hardShowSplashAfterUnlock(){
  const s = document.getElementById('app-splash');
  if (!s) return;

  // لا نعيده إذا التطبيق خلص إقلاعه أساسًا
  if (window.__bootDone) return;

  // نعيده فقط لو كان تم إخفاؤه بسبب القفل
  if (s.dataset.hiddenByPin !== '1') return;
  s.dataset.hiddenByPin = '0';

  s.removeAttribute('hidden');
  s.style.display = 'flex';
  s.setAttribute('aria-busy','true');
  s.dataset.splashHidden = '0';
}


function initPinLockUI(){
  _pin.el = document.getElementById('pinLock');
  _pin.input = document.getElementById('pinInput');
  _pin.unlockBtn = document.getElementById('pinUnlockBtn');
  _pin.msg = document.getElementById('pinLockMsg');
  _pin.hint = document.getElementById('pinLockHint');
_pin.eyeBtn = document.getElementById('pinToggleVisBtn');

  if (!_pin.el || !_pin.input || !_pin.unlockBtn || !_pin.msg) return;
function _syncEyeIcon(btn, input){
  if (!btn || !input) return;
  const icon = btn.querySelector('i');
  const isShown = (input.type === 'text');
  btn.setAttribute('aria-pressed', isShown ? 'true' : 'false');
  btn.setAttribute('aria-label', isShown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
  if (icon){
    icon.classList.toggle('fa-eye', !isShown);
    icon.classList.toggle('fa-eye-slash', isShown);
  }
}

_pin.eyeBtn?.addEventListener('click', () => {
  const isHidden = (_pin.input.type === 'password');
  _pin.input.type = isHidden ? 'text' : 'password';
  _syncEyeIcon(_pin.eyeBtn, _pin.input);
  _pin.input.focus();
});

// تهيئة أولية للأيقونة
_syncEyeIcon(_pin.eyeBtn, _pin.input);


  _pin.unlockBtn.addEventListener('click', () => {
    verifyAndUnlockFromUI();
  });

  _pin.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      verifyAndUnlockFromUI();
    }
  });

// سياسة موحّدة: حروف/أرقام فقط (Alnum) + طول أقصى 12
_pin.input?.addEventListener('input', () => {
  const v = String(_pin.input.value || '');
const cleaned = v.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 12);
  if (cleaned !== v) _pin.input.value = cleaned;
});

// منع لصق افتراضيًا (يمكنك تغييره)
_pin.input?.addEventListener('paste', (e) => {
  // ✅ السماح باللصق (مع فلترة digits الموجودة أصلًا في input listener)
  const ALLOW_PASTE = true;
  if (!ALLOW_PASTE) { e.preventDefault(); return; }
});

  // تلميح PIN (اختياري)
  const hint = _lsGet(PIN_KEYS.hint, '');
  if (_pin.hint){
    if (hint) {
      _pin.hint.hidden = false;
      _pin.hint.textContent = `تلميح: ${hint}`;
    } else {
      _pin.hint.hidden = true;
      _pin.hint.textContent = '';
    }
  }

}

function _setMsg(text, type){
  if (!_pin.msg) return;
  _pin.msg.textContent = String(text || '');
  _pin.msg.dataset.type = type || 'info';
}

function _secondsLeft(ms){
  const s = Math.ceil(ms / 1000);
  return s < 0 ? 0 : s;
}

// 🔒 Visibility-lock flags (module scope)
let __pinEverVisible = (document.visibilityState === 'visible');
let __pinLockedByVisibility = false;

function lockUI(reason = '', opts = {}){
    console.log('[PIN LOCK]', { reason, opts, t: Date.now(), vis: document.visibilityState });

  const { persist = true } = (opts || {});

  if (!_pin.el) initPinLockUI();
  if (!_pin.el) return;
_pin.prevFocus = document.activeElement;
  _pin.locked = true;
  // احفظ حالة القفل للجلسة الحالية
if (persist) _ssSet(PIN_SESSION_KEYS.locked, '1');

  document.documentElement.classList.add('is-locked');
  document.body.classList.add('is-locked');

  // تعطيل الخلفية
  const main = document.querySelector('.container');
  if (main) main.inert = true;
  if (main){
    main.setAttribute('aria-hidden', 'true');
    main.style.visibility = 'hidden';   // ✅ يمنع رؤية الشجرة خلف القفل
  }

  _pin.el.hidden = false;
hardHideSplashForLock();
disarmSplashTimeout();

  // reset input
  if (_pin.input){
    _pin.input.value = '';
    setTimeout(() => _pin.input.focus(), 0);
  }

  // رسالة
  if (reason) _setMsg(reason, 'info');
else _setMsg('أدخل كلمة المرور لفتح الواجهة.', 'info');

  // فخ تركيز بسيط داخل overlay
  if (!_pin.trapHandler){
    _pin.trapHandler = (e) => {
      if (!_pin.locked) return;
      if (e.key !== 'Tab') return;

      const focusables = Array.from(_pin.el.querySelectorAll('button,input,[tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.disabled && el.offsetParent !== null);

      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', _pin.trapHandler, true);
  }
}

function unlockUI(){
  if (!_pin.el) return;

  _pin.locked = false;
  __pinLockedByVisibility = false;

  // الغِ حالة القفل للجلسة الحالية
  _ssSet(PIN_SESSION_KEYS.locked, '0');
  
  _pin.el.hidden = true;
hardShowSplashAfterUnlock();
if (!window.__bootDone && !splashHasError) armSplashTimeout();

  document.documentElement.classList.remove('is-locked');
  document.body.classList.remove('is-locked');

  const main = document.querySelector('.container');
  if (main) main.inert = false;
if (main){
  main.removeAttribute('aria-hidden');
  main.style.visibility = '';
}

try{ _pin.prevFocus?.focus?.(); }catch{}
_pin.prevFocus = null;


  _setMsg('', 'info');
  
  // إزالة focus trap الخاص بالقفل لأنه مربوط بـ document
if (_pin.trapHandler) {
  document.removeEventListener('keydown', _pin.trapHandler, true);
  _pin.trapHandler = null;
}

  // حدث: تم فتح القفل
  bus.emit('pin:unlocked');
   //  بعد فك القفل: أعد الرسم
  setState({ uiTick: Date.now() });
}

async function verifyAndUnlockFromUI(){
  if (!_isPinEnabled()){
    // لو غير مفعّل، لا تقفل أصلاً
    unlockUI();
    return;
  }

  const until = parseInt(_lsGet(PIN_KEYS.lockUntil, '0'), 10) || 0;
  const now = _now();
if (until > now){
  // ✅ عدّاد تنازلي يتحدث كل ثانية
  if (_pin.cooldownTimer) clearInterval(_pin.cooldownTimer);

  const tick = () => {
    const left = Math.max(0, until - _now());
    _setMsg(`⏳ انتظر ${_secondsLeft(left)} ثانية ثم حاول مرة أخرى.`, 'warning');
    if (left <= 0){
      clearInterval(_pin.cooldownTimer);
      _pin.cooldownTimer = null;
      _setMsg('يمكنك المحاولة الآن.', 'info');
    }
  };

  tick();
  _pin.cooldownTimer = setInterval(tick, 1000);
  return;
}

  const salt = _lsGet(PIN_KEYS.salt, '');
  const storedHash = _lsGet(PIN_KEYS.hash, '');

  if (!salt || !storedHash){
    _setMsg('⚠️ لا يوجد كلمة مرور مضبوط. فعّل القفل واضبط كلمة المرور من الإعدادات.', 'error');
    return;
  }

  const pin = (_pin.input?.value || '').trim();
  if (!pin){
_setMsg('أدخل كلمة المرور أولاً.', 'warning');
    _pin.input?.focus?.();
    return;
  }

    // (ز) UX helper: النقطة القادمة للتجميد حسب tries
  const nextFreezePoint = (t) => {
    if (t < 3) return 3;
    if (t < 6) return 6;
    if (t < 10) return 10;
    if (t < 15) return 15;
    return 15;
  };

  try{
    const { hashPin } = await import('./utils.js');
    const h = await hashPin(pin, salt);

    if (h === storedHash){
      // success: reset tries/lock
      _lsSet(PIN_KEYS.tries, '0');
      _lsSet(PIN_KEYS.lockUntil, '0');
      _lsSet(PIN_KEYS.lastTryAt, '0');
      _lsSet(PIN_KEYS.lastActivity, String(_now()));
      if (_pin.cooldownTimer) { clearInterval(_pin.cooldownTimer); _pin.cooldownTimer = null; }
      unlockUI();
      return;
    }

    // reset tries لو مر وقت طويل (مثلاً 30 دقيقة) حتى ما يتراكم للأبد
const lastTryAt = parseInt(_lsGet(PIN_KEYS.lastTryAt, '0'), 10) || 0;
if (lastTryAt && (_now() - lastTryAt) > (30 * 60 * 1000)) {
  _lsSet(PIN_KEYS.tries, '0');
  _lsSet(PIN_KEYS.lockUntil, '0');
}

    // fail
    let tries = parseInt(_lsGet(PIN_KEYS.tries, '0'), 10) || 0;
    tries += 1;
    _lsSet(PIN_KEYS.tries, String(tries));
_lsSet(PIN_KEYS.lastTryAt, String(_now()));

// ✅ cooldown progressive (أقوى)
let cooldownMs = 0;
if (tries >= 15) cooldownMs = 5 * 60 * 1000;      // 5 دقائق
else if (tries >= 10) cooldownMs = 2 * 60 * 1000; // دقيقتان
else if (tries >= 6) cooldownMs = 30 * 1000;      // 30 ثانية
else if (tries >= 3) cooldownMs = 10 * 1000;      // 10 ثواني

const freezeAt = nextFreezePoint(tries);
const remaining = Math.max(0, freezeAt - tries);

if (cooldownMs > 0){
  const lockUntil = _now() + cooldownMs;
  _lsSet(PIN_KEYS.lockUntil, String(lockUntil));

  const secs = _secondsLeft(cooldownMs);
  _setMsg(`❌ محاولة خاطئة (${tries}/${freezeAt}). انتظر ${secs} ثانية ثم حاول مرة أخرى.`, 'error');

  // (ح) مسح الحقل عند التجميد
  if (_pin.input) _pin.input.value = '';
} else {
  _setMsg(`❌ محاولة خاطئة (${tries}/${freezeAt}) قبل الانتظار.`, 'error');

  _pin.input?.focus?.();
  _pin.input?.select?.();
}

  }catch{
    _setMsg('⚠️ تعذر التحقق من كلمة المرور (WebCrypto).', 'error');
  }
}

function _isSessionOpen(){
  const until = parseInt(_lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;
  return until > _now();
}

let __pinSessionCountdownTimer = null;

function _fmtMMSS(ms){
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function _syncTopBarSessionCountdown(){
  var el = document.getElementById('pinSessionCountdown');
  if (!el) return;

  var until = parseInt(_lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;
  var left = until - _now();

  if (left > 0){
    el.hidden = false;

    // ✅ أقل من دقيقة = تأثير تحذيري
    el.classList.toggle('is-urgent', left <= 60000);

    el.textContent = 'جلسة مفتوحة — متبقّي ' + _fmtMMSS(left);
  } else {
    el.hidden = true;
    el.classList.remove('is-urgent');
    el.textContent = '';
  }

  // ✅ مزامنة زر القفل في الشريط العلوي
  _syncTopBarLockNowBtn();
}

function _syncTopBarLockNowBtn(){
  var btn = document.getElementById('pinTopLockNowBtn');
  if (!btn) return;

  // يظهر فقط إذا PIN جاهز والواجهة ليست مقفولة
  var show = _isPinEnabled() && !_pin.locked;

  btn.hidden = !show;
  btn.disabled = !show;
}


function _syncPinSessionLabelCountdown(){
  var live = document.querySelector('.pin-session-label .pin-session-live');
  var time = document.querySelector('.pin-session-label .pin-session-time');
  var title = document.querySelector('.pin-session-label .pin-session-title');
  if (!live || !time) return;

  var until = parseInt(_lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;
  var left = until - _now();

  var open = left > 0;

  // النص عندما تكون الجلسة مفعّلة
  if (title){
    title.textContent = open ? 'الجلسة المفتوحة مفعّلة' : 'مدة الجلسة المفتوحة';
  }

  if (open){
    live.hidden = false;
    time.textContent = _fmtMMSS(left);

    // أقل من دقيقة
    live.classList.toggle('is-urgent', left <= 60000);
  } else {
    live.hidden = true;
    live.classList.remove('is-urgent');
    time.textContent = '0:00';
  }
}

function _endOpenSessionAndLock(reason){
  // 1) امسح الجلسة فورًا
  try{ _lsDel(PIN_KEYS.sessionUntil); }catch{}

  // 2) حدّث واجهة العدادات فورًا
  _syncTopBarSessionCountdown();
  _syncPinSessionLabelCountdown();

  // 3) اقفل فورًا في نفس التبويب إن كان PIN مفعّل
  if (_isPinEnabled() && !_pin.locked) {
    lockUI(reason || '🔒 انتهت الجلسة المفتوحة. أدخل كلمة المرور لفتح الواجهة.');
  }
}


function _startTopBarSessionCountdown(){
  if (__pinSessionCountdownTimer) clearInterval(__pinSessionCountdownTimer);
  __pinSessionCountdownTimer = null;

  _syncTopBarSessionCountdown();
  _syncPinSessionLabelCountdown();

  // ✅ إذا لا توجد جلسة فعلًا، لا تشغّل مؤقت ولا تعتبرها "انتهت"
  var until = parseInt(_lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;
  if (!until || until <= _now()) {
    return;
  }

  __pinSessionCountdownTimer = setInterval(() => {
    _syncTopBarSessionCountdown();
    _syncPinSessionLabelCountdown();

    var until = parseInt(_lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;

    // ✅ فقط إذا كانت الجلسة كانت موجودة ثم انتهت
    if (until && until <= _now()){
      clearInterval(__pinSessionCountdownTimer);
      __pinSessionCountdownTimer = null;
      _endOpenSessionAndLock('🔒 انتهت الجلسة المفتوحة. أدخل كلمة المرور لفتح الواجهة.');
    }
  }, 1000);
}


function _shouldAutoLockByIdle(){
  if (!_isPinEnabled()) return false;
  if (_isSessionOpen()) return false;

  const last = parseInt(_lsGet(PIN_KEYS.lastActivity, '0'), 10) || 0;
  const idleMs = _idleMinutes() * 60 * 1000;
  return (_now() - last) >= idleMs;
}

function _markActivity(){
  if (!_isPinEnabled()) return;
  if (_pin.locked) return;
  _lsSet(PIN_KEYS.lastActivity, String(_now()));
}

function startPinAutoLockMonitors(){
  // نشاط المستخدم
  const events = ['click','keydown','mousemove','touchstart','scroll'];
  events.forEach(ev => document.addEventListener(ev, _markActivity, { passive: true }));

  // فحص دوري ذكي
  if (_pin.intervalId) clearInterval(_pin.intervalId);
  _pin.intervalId = setInterval(() => {
    if (_pin.locked) return;
    if (_shouldAutoLockByIdle()){
lockUI('🔒 تم قفل الواجهة بسبب الخمول.', { persist: false });
    }
  }, 15000);
__pinEverVisible = (document.visibilityState === 'visible');
__pinLockedByVisibility = false;

document.addEventListener('visibilitychange', () => {
  if (!_isPinEnabled()) return;

  // ✅ عند الرجوع للتبويب
if (document.visibilityState === 'visible') {
  __pinEverVisible = true;

  if (!_lockOnVisibility() && _shouldAutoLockByIdle()) {
    lockUI('🔒 تم قفل الواجهة بسبب الخمول أثناء غياب التبويب.');
    return;
  }

  if (_lockOnVisibility() && __pinLockedByVisibility) {
    if (_pin.locked) _setMsg('أدخل كلمة المرور لفتح الواجهة.', 'info');
    return;
  }

  return;
}

  // ✅ hidden
  if (!__pinEverVisible) {
    // تجاهل hidden الذي يحدث أثناء بدء التحميل/الريلود
    return;
  }

  if (_lockOnVisibility() && !_isSessionOpen()) {
    __pinLockedByVisibility = true; // ✅ سجّل السبب
    lockUI('🔒 تم قفل الواجهة عند ترك التبويب.', { persist: false });
  }
});


if ('BroadcastChannel' in window) {
  const bc = new BroadcastChannel('pin_channel');
  bc.addEventListener('message', (e) => {
    const msg = e?.data || null;
    const key = msg?.key;
    if (!key) return;

    // 1) enabled
if (key === PIN_KEYS.enabled) {
  const v = _lsGet(PIN_KEYS.enabled, '0');

  if (v === '0') {
    // تعطيل الحماية: افتح فورًا
    unlockUI();
    _syncTopBarLockNowBtn();
    return;
  }

  if (v === '1') {
    // ✅ تفعيل/إرجاع التفعيل: لا تقفل تلقائيًا
    // فقط حدّث زر القفل والعدادات
    _syncTopBarLockNowBtn();
    _startTopBarSessionCountdown();

    // لو في جلسة مفتوحة وكان مقفول افتحه
    if (_isSessionOpen() && _pin.locked) unlockUI();
    return;
  }
}


    // 2) hash/salt
    if (key === PIN_KEYS.hash || key === PIN_KEYS.salt) {
      if (_isPinEnabled()) {
        lockUI('🔒 تغيّر كلمة المرور في تبويب آخر. أدخل كلمة المرور الجديدة لفتح الواجهة.');
      } else {
        unlockUI();
      }
      return;
    }

// 3) sessionUntil
if (key === PIN_KEYS.sessionUntil) {
  // حدّث العدادات فقط
  _startTopBarSessionCountdown();

  // لو PIN غير مفعّل، افتح احتياط
  if (!_isPinEnabled()) { unlockUI(); return; }

  // ✅ لا تقفل هنا إطلاقًا (إلغاء الجلسة اليدوي لا يقفل)
  // القفل عند انتهاء الجلسة يتم حصريًا عبر المؤقت: _endOpenSessionAndLock()
  if (_isSessionOpen()) {
    if (_pin.locked) unlockUI();
  }

  return;
}

  });
}

}

async function ensureUnlockedBeforeRender(){
  initPinLockUI();
  startPinAutoLockMonitors();

  // helper: انتظر حدث الفتح
const waitUnlocked = () => new Promise((resolve) => {
  bus.once('pin:unlocked', () => resolve());
});

  // لو كان مقفول قبل refresh، لازم يبقى مقفول
  if (_ssGet(PIN_SESSION_KEYS.locked, '0') === '1'){
    lockUI('أدخل كلمة المرور لفتح الواجهة.');
    await waitUnlocked();
    return;
  }

  if (!_isPinEnabled()){
    unlockUI();
    return;
  }

  // لو جلسة مفتوحة: افتح حتى بعد refresh
  if (_isSessionOpen()){
    unlockUI();
    return;
  }

  // لو آخر نشاط حديث (ضمن idleMinutes) افتح بعد refresh
  const last = parseInt(_lsGet(PIN_KEYS.lastActivity, '0'), 10) || 0;
  const idleMs = _idleMinutes() * 60 * 1000;

  if (last && (_now() - last) < idleMs){
    unlockUI();
    return;
  }

  // غير ذلك: اقفل وانتظر فعليًا
  lockUI('أدخل كلمة المرور لفتح الواجهة.');
  await waitUnlocked();
}


bus.on('pin:lockNow', () => {
  // ✅ B) الأكثر أمانًا: أنهِ أي جلسة مفتوحة ثم اقفل فورًا
  if (_isPinEnabled()) _endOpenSessionAndLock('🔒 تم قفل الواجهة الآن.');
});



bus.on('pin:disabled', () => {
  // لو PIN انطفأ من الإعدادات، افتح فورًا حتى لا تعلق شاشة القفل
  unlockUI();
});

bus.on('pin:openSession', ({ minutes }) => {
  const min = parseInt(minutes, 10);
  const safe = [5, 15, 30, 60].includes(min) ? min : 15;

  const until = _now() + (safe * 60 * 1000);
  _lsSet(PIN_KEYS.sessionUntil, String(until));
  _lsSet(PIN_KEYS.lastActivity, String(_now()));

  showSuccess(`تم تفعيل جلسة مفتوحة لمدة ${safe} دقيقة.`);
  _startTopBarSessionCountdown();

});

bus.on('pin:settingsChanged', () => {
  _syncTopBarLockNowBtn();
  _startTopBarSessionCountdown();
});


/* =========================
   تبديل شعار الغطاء حسب الثيم
   ========================= */
function updateSplashLogo(theme){
  const img = document.getElementById('appSplashLogo');
  if (!img) return;

// خريطة شعارات الأنماط
const LOGO_BY_THEME = {
  default:   'default-logo-gold.png',            // ذهبي • رئيسي
  elegant:   'elegant-logo-ocean-blue.png',      // أزرق • محيط
  corporate: 'corporate-logo-forest-green.png',  // أخضر • غابة
  minimal:   'minimal-logo-rose-crimson.png',    // وردي • غروب
  royal:     'royal-logo-purple-gold.png',       // بنفسجي • ملكي
  dark:      'dark-logo-amber-gold-glow.png'     // فحمي • داكن
};

  const file = LOGO_BY_THEME[theme] || LOGO_BY_THEME.default;
  img.src = `src/assets/images/${file}`;
}

// استقبال تغيّر الثيم من أي مكان (مثل نافذة إعادة التفضيلات)
window.addEventListener('FT_THEME_CHANGED', (e) => {
  const theme = (e.detail && e.detail.theme) || 'default';

  // تحديث حالة التطبيق
  setState({ theme });

  // مزامنة meta theme-color مع الثيم الحالي
  syncThemeColor();

  // تحديث شعار غطاء التحميل ليتوافق مع الثيم
  updateSplashLogo(theme);
});


/* =========================
   مزامنة لون شريط المتصفح مع الثيم الحالي
   ========================= */
function syncThemeColor(){
  const meta=document.querySelector('meta[name="theme-color"]');
  if(!meta) return;

  const cs=getComputedStyle(document.documentElement);
  const color=
    cs.getPropertyValue('--arrow-color').trim()||
    cs.getPropertyValue('--title-color').trim()||
    '#3f5a3c';

  meta.setAttribute('content',color);
}

/* =========================
   أزرار التمرير (صعود/نزول)
   ========================= */

function initScrollButtons(){
  const scrollUpBtn = document.getElementById("scrollUpBtn");
  const scrollDownBtn = document.getElementById("scrollDownBtn");
  if (!scrollUpBtn || !scrollDownBtn) return; // احتياط لو لم توجد الأزرار

  function updateScrollButtons() {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;

    if (y > 200) scrollUpBtn.classList.add("show");
    else scrollUpBtn.classList.remove("show");

    if (y < max - 200) scrollDownBtn.classList.add("show");
    else scrollDownBtn.classList.remove("show");
  }

  window.addEventListener("scroll", updateScrollButtons, { passive: true });
  updateScrollButtons();

  scrollUpBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  scrollDownBtn.addEventListener("click", () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  });
}

/* =========================
   Handlers مشتركة تُمرَّر للـ UI
   ========================= */
const handlers = {
  showSuccess,
  showInfo,
  showWarning,
  showError,
  highlight,
  getSearch: () => (getState().search || ''),
  getFilters: () => (getState().filters || {}),

  onUpdateStories,           // القصص
  onUpdateSources,           // NEW: المصادر والوثائق
  onEventsChange: onUpdateEvents // الخط الزمني للأحداث
};


/* =========================
   رسم الواجهة
   ========================= */
function redrawUI(selectedKey = Model.getSelectedKey()) {
    if (_pin?.locked) return; // لا ترسم الشجرة طالما مقفول
  const fams = Model.getFamilies();
  let key = selectedKey;

  // إن كان المفتاح فارغًا أو يشير لعائلة مخفية فانتقل لأولى المرئيات
  if (!key || !fams[key] || fams[key].hidden === true) {
    key = Object.keys(fams).find(k => fams[k] && fams[k].hidden !== true) || null;
    if (key) {
      Model.setSelectedKey(key);
      setState({ selectedFamily: key });
    }
  }

  TreeUI.renderFamilyButtons(fams, key, handlers, dom);
  TreeUI.drawFamilyTree(fams, key, dom, handlers);
}

/* تحويل هيكل العائلات إلى entries موحّد */
function entriesOfFamilies(fams){
  if (!fams) return [];
  if (fams instanceof Map) return Array.from(fams.entries());
  return Object.keys(fams).map(k => [k, fams[k]]);
}

/* ملء واجهة التبديل المخصّصة كقائمة منسدلة */
function fillFamilySwitcher(familiesMap, activeKey){
  const box = byId('activeFamily');
  if (!box) return;

  const coll = new Intl.Collator('ar', { sensitivity:'base', numeric:true });

  const items = entriesOfFamilies(familiesMap)
    .filter(([id, f]) => f && f.hidden !== true)
    .map(([id, f]) => ({
      id,
      title: (f?.title || f?.familyName || id)
    }))
    .sort((a, b) => {
      if (a.id === activeKey) return -1;
      if (b.id === activeKey) return 1;
      return coll.compare(a.title, b.title);
    });

  const activeItem = items.find(i => i.id === activeKey) || items[0] || null;

  // زر العرض + قائمة العناصر
  box.innerHTML = `
    <button type="button"
            class="family-button family-switcher-toggle"
            aria-haspopup="listbox"
            aria-expanded="false">
      <span class="family-switcher-label">
        ${activeItem ? `عائلة: ${activeItem.title}` : 'اختر عائلة'}
      </span>
            <span class="family-switcher-arrow" aria-hidden="true"></span>

    </button>
    <div class="family-switcher-menu" role="listbox">
      ${items.map(i => `
        <button type="button"
                class="family-button family-switcher-btn ${i.id === activeKey ? 'is-active' : ''}"
                data-family="${i.id}"
                role="option"
                aria-selected="${i.id === activeKey ? 'true' : 'false'}">
          عائلة: ${i.title}
        </button>
      `).join('')}
    </div>
  `;

  // حالة الفتح/الإغلاق على مستوى الـ container
  box.classList.remove('is-open');
}

function syncActiveFamilyUI(){
  const active = getState().selectedFamily || Model.getSelectedKey();
  fillFamilySwitcher(Model.getFamilies(), active);
}

/* ربط الحالة بالرسم (انتقائي) */
subscribeTo(
  s => ({ sel: s.selectedFamily, q: s.search, f: s.filters, uiTick: s.uiTick }),
  ({ sel }) => {
    redrawUI(sel);
    dom.suggestBox?.classList.remove('show');
    dom.searchInput?.setAttribute('aria-expanded', 'false');
    syncActiveFamilyUI();
    refreshValidationBadge();
  }
);

/* =========================
   أدوات مساعدة للبحث داخل العائلة
   ========================= */
function findPersonByIdInFamily(fam, pid) {
  if (!fam || pid == null) return null;

  const target = String(pid);

  const eqId = (obj) => (obj && obj._id != null) ? String(obj._id) === target : false;

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives || [])
  ].filter(Boolean);

  for (const p of tops) {
    if (eqId(p)) return p;

    const ch = Array.isArray(p?.children) ? p.children : [];
    for (const c of ch) { if (eqId(c)) return c; }

    const ws = Array.isArray(p?.wives) ? p.wives : [];
    for (const w of ws) {
      if (eqId(w)) return w;
      const wc = Array.isArray(w?.children) ? w.children : [];
      for (const c of wc) { if (eqId(c)) return c; }
    }
  }

  const mirror = (fam.rootPerson && Array.isArray(fam.rootPerson.wives)) ? fam.rootPerson.wives : [];
  for (const w of mirror) {
    if (eqId(w)) return w;
    const wc = Array.isArray(w?.children) ? w.children : [];
    for (const c of wc) { if (eqId(c)) return c; }
  }

  return null;
}

// =========================
// DEV GUARD: منع تكرار _id داخل العائلة
// =========================

function devAssertNoDuplicateIdsInFamily(fam, famKey) {
  if (IS_PROD) return;
  if (!fam) return;

  // نخزن: id -> أول مسار ظهر فيه
  const firstPathById = new Map();
  const dups = [];

  // 1) فحص الشجرة الأساسية مع المسارات
  walkPersonsWithPath(fam, (p, path) => {
    if (!p || typeof p !== 'object') return;
    if (p._id == null) return;

    const id = String(p._id);
    const curPath = path || '(unknown path)';

    if (firstPathById.has(id)) {
      dups.push({
        id,
        first: firstPathById.get(id),
        second: curPath
      });
    } else {
      firstPathById.set(id, curPath);
    }
  });

  // 2) لا تعتبر fam.persons duplicate (فهرس)، بس لو فيه id جديد أضفه
  if (fam.persons && typeof fam.persons === 'object') {
    Object.values(fam.persons).forEach(p => {
      if (!p || typeof p !== 'object') return;
      if (p._id == null) return;

      const id = String(p._id);
      if (!firstPathById.has(id)) firstPathById.set(id, 'fam.persons');
    });
  }

  // 3) النتيجة
  if (dups.length) {
    console.error('[DEV] Duplicate _id detected', {
      familyKey: famKey,
      duplicates: dups
    });

    try {
      showWarning?.(
        `تحذير تطوير: يوجد تكرار في _id داخل ${highlight(famKey)}`
      );
    } catch {}
  }
}

/* =========================
   عمليات المستوى الأعلى
   ========================= */
function onSelectFamily(key){
  if(!key) return;

  const currentKey = Model.getSelectedKey();
  const fams = Model.getFamilies?.() || {};

  if(key === currentKey){
    const fam = fams[key] || Model.getFamily?.(key);
    const label = fam?.title || fam?.familyName || fam?.fullRootPersonName || key;
    showInfo(`عائلة: ${highlight(String(label))} هي المختارة حاليًا بالفعل.`);
    return;
  }

  // state/source-of-truth
  Model.setSelectedKey(key);
  setState({ selectedFamily: key });

  // منطق غير UI
  FeatureSearch.refreshFilterOptionsForCurrentFamily?.();

  // رسائل OK (مو UI-render)
  const prevFam = fams[currentKey] || Model.getFamily?.(currentKey);
  const nextFam = fams[key] || Model.getFamily?.(key);
  if(prevFam && nextFam){
    const prevLabel = prevFam.title || prevFam.familyName || prevFam.fullRootPersonName || currentKey;
    const nextLabel = nextFam.title || nextFam.familyName || nextFam.fullRootPersonName || key;
    showSuccess(`تم تبديل العائلة من ${highlight(String(prevLabel))} إلى ${highlight(String(nextLabel))}.`);
  }
}

/* فتح محرّر العائلة */
function onEditFamily(key) {
  const familyData = Model.getFamily(key);
  const modal = ModalUI.createFamilyCreatorModal(key, { initialData: familyData, onSave: onModalSave });
  ModalManager.open(modal);
}

// ===== اختيار "التالي" بعد الحذف حسب نفس ترتيب أزرار tree.familyButtons.js =====
function pickNextFamilyKeyByButtonsOrder(families = {}, deletedKey = null) {
  const coll = new Intl.Collator('ar', { sensitivity: 'base', numeric: true });

  // 1) ابنِ نفس قائمة الأزرار المرئية (غير مخفية) وبنفس مفاتيح الفرز
  const entries = Object.entries(families || {})
    .filter(([k, f]) => {
      if (!f || f.hidden) return false;     // نفس شرط renderFamilyButtons
      return true;
    })
    .map(([k, f]) => {
      const rawName = (f.familyName || f.title || f.rootPerson?.name || k || '').trim();
      const nameKey = rawName || String(k);
      const isCore = !!f.__core;
      const isCustom = !!(f.__custom && !f.__core);
      return { k, nameKey, isCore, isCustom };
    })
    .sort((a, b) => {
      // ملاحظة: نحذف منطق "المختارة أولاً" لأننا نريد ترتيب ثابت للاختيار بعد الحذف

      // 1) custom قبل core
      if (a.isCustom && !b.isCustom) return -1;
      if (!a.isCustom && b.isCustom) return 1;

      if (a.isCore && !b.isCore) return 1;
      if (!a.isCore && b.isCore) return -1;

      // 2) ترتيب أبجدي عربي (مع أرقام)
      const c = coll.compare(a.nameKey, b.nameKey);
      if (c !== 0) return c;

      // 3) كسر تعادل أخير بالمفتاح
      return coll.compare(String(a.k), String(b.k));
    });

  const keys = entries.map(e => e.k);

  // 2) إن لم يوجد شيء
  if (!keys.length) return null;

  // 3) إن لم نجد المحذوف في القائمة (احتياط)
  const idx = deletedKey != null ? keys.indexOf(deletedKey) : -1;
  if (idx < 0) return keys[0] || null;

  // 4) التالي: إن كان موجودًا، وإلا السابقة، وإلا null
  return keys[idx + 1] || keys[idx - 1] || null;
}

/* حذف العائلة مع إعادة اختيار مناسبة + رسالة توضيحية */
async function onDeleteFamily(key) {
  const famBefore = Model.getFamily?.(key) || (Model.getFamilies()[key] || null);
  const familyLabel =
    (famBefore?.title || famBefore?.familyName || famBefore?.fullRootPersonName || key);

  const wasSelected = (Model.getSelectedKey() === key);

  await Model.deleteFamily(key);
  await Model.savePersistedFamilies?.();

  clearValidation(`family:${key}`);

  const remaining = Model.getFamilies();

  // اجمع تغييرات الحالة في إشعار واحد لتقليل redraw
  batch(() => {
    if (wasSelected) {
      const next = pickNextFamilyKeyByButtonsOrder(remaining, key);

      if (next) {
        Model.setSelectedKey(next);
        setState({ selectedFamily: next, uiTick: Date.now() });
      } else {
        setState({ selectedFamily: null, uiTick: Date.now() });
      }
    } else {
      setState({ uiTick: Date.now() });
    }
  });

  // بعد تثبيت الحالة (أفضل)
  bus.emit('families:coreFlag:refresh');
  bus.emit('side:requestClose');

  if (familyLabel) showSuccess(`تم حذف العائلة ${highlight(familyLabel)} بنجاح.`);
  else showSuccess('تم حذف العائلة بنجاح.');
}

/* حفظ من المودال */
function onModalSave(key, familyObj) {
  const prevSelected = Model.getSelectedKey();
  const existedBefore = !!Model.getFamily(key); // تعديل أم إنشاء؟

  let vcToastAfterSave = null;

  // الحفاظ على أعلام core/custom كما هي
  const wasCore = !!Model.getFamily(key)?.__core;
  familyObj.__custom = true;
  if (wasCore) familyObj.__core = true;

  // =========================
  // VALIDATION قبل الحفظ (مركز تنبيهات)
  // =========================
  {
    const { errors, warnings } = validateFamily(familyObj);

    setValidationResults(`family:${key}`, {
      title: `تنبيهات التحقق — ${familyObj.title || familyObj.familyName || key}`,
      errors,
      warnings,
      meta: { familyKey: key, ts: Date.now() }
    });

    const sum = getValidationSummary(`family:${key}`);
    const shouldToast = (!existedBefore) || (prevSelected === key);

    // جهّز التوست فقط ولا تعرضه الآن
    if (shouldToast && sum.counts.total > 0) {
      const msg = vcToastSummaryText(sum);
      vcToastAfterSave = sum.hasBlockers ? () => showError(`تم الحفظ، لكن ${msg} راجع أيقونة التنبيهات.`)
        : () => showWarning(`تم الحفظ، لكن ${msg} راجع أيقونة التنبيهات.`);
    }
  }

  devAssertNoDuplicateIdsInFamily(familyObj, key);

  Model.getFamilies()[key] = familyObj;
  Model.commitFamily(key);

if (!existedBefore) {
  Model.setSelectedKey(key);
  setState({ selectedFamily: key });
} else {
  // لا redrawUI هنا نهائيًا — خلّ التحديث يمر عبر subscribeTo
  setState({ uiTick: Date.now() });
}

  // أولاً: رسالة الحفظ
  showSuccess(`تمت إضافة/تحديث العائلة ${highlight(familyObj.title || familyObj.familyName || key)}.`);

  // ثانيًا: رسالة التنبيهات (إن وجدت)
  if (typeof vcToastAfterSave === 'function') vcToastAfterSave();

  FeatureDuplicates.warnDuplicatesIfAny(key);
}

/* حفظ القصص والمذكّرات لشخص معيّن */
function onUpdateStories(personId, stories) {
  const famKey = Model.getSelectedKey();
  const fam = Model.getFamilies()[famKey];
  if (!fam || !personId) return;

  // ابحث عن الشخص داخل العائلة الحالية
  const person = findPersonByIdInFamily(fam, personId);
  if (!person) return;

  // ضمان أن القصص مصفوفة
  if (!Array.isArray(stories)) stories = [];

  // احفظ القصص على الشخص نفسه مع كل الحقول الجديدة
  person.stories = stories.map(s => {
    const now       = new Date().toISOString();
    const createdAt = s.createdAt || now;
    const updatedAt = s.updatedAt || createdAt;

    return {
      id: s.id || (crypto?.randomUUID?.() || ('s_' + Math.random().toString(36).slice(2))),

      // الحقول الأساسية
      title: String(s.title || '').trim(),
      text:  String(s.text  || '').trim(),
      images: Array.isArray(s.images) ? s.images.slice() : [],

      // الحقول الإضافية (الجديدة)
      type: (s.type || '').trim(),                 // childhood / study / ...
      eventDate: s.eventDate || null,
      place: (s.place || '').trim(),
      tags: Array.isArray(s.tags) ? s.tags.map(t => String(t).trim()).filter(Boolean)
        : [],
      relatedPersonIds: Array.isArray(s.relatedPersonIds) ? s.relatedPersonIds.map(String)
        : [],
      note: (s.note || '').trim(),
      pinned: !!s.pinned,

      // التواريخ
      createdAt,
      updatedAt
    };
  });

  // التزام العائلة وحفظها في IndexedDB
  Model.commitFamily(famKey);
}

/* حفظ المصادر/الوثائق لشخص معيّن */
function onUpdateSources(personId, sources) {
  const famKey = Model.getSelectedKey();
  const fam = Model.getFamilies()[famKey];
  if (!fam || !personId) return;

  // ابحث عن الشخص داخل العائلة الحالية
  const person = findPersonByIdInFamily(fam, personId);
  if (!person) return;

  // ضمان أن المصادر مصفوفة
  if (!Array.isArray(sources)) sources = [];

  // نحافظ على كل الحقول القادمة من person.sources.js مع تأكيد id والتواريخ
  person.sources = sources.map(src => {
    const now       = new Date().toISOString();
    const createdAt = src.createdAt || now;
    const updatedAt = src.updatedAt || createdAt;

    return {
      id: src.id || (crypto?.randomUUID?.() || ('src_' + Math.random().toString(36).slice(2))),
      ...src,
      createdAt,
      updatedAt
    };
  });

  // التزام العائلة وحفظها في IndexedDB
  Model.commitFamily(famKey);
}

/* حفظ الخط الزمني للأحداث لشخص معيّن */
function onUpdateEvents(personWithEvents) {
  if (!personWithEvents || !personWithEvents._id) return;

  const famKey = Model.getSelectedKey();
  const fam = Model.getFamilies()[famKey];
  if (!fam) return;

  // ابحث عن الشخص داخل العائلة الحالية
  const person = findPersonByIdInFamily(fam, personWithEvents._id);
  if (!person) return;

  // ضمان أن الأحداث مصفوفة
  const events = Array.isArray(personWithEvents.events) ? personWithEvents.events
    : [];

  // احفظ الأحداث على الشخص نفسه (نسخة مرتّبة كما هي)
  person.events = events.map(ev => ({ ...ev }));

  // التزام العائلة وحفظها في IndexedDB
  Model.commitFamily(famKey);
}

/* إعادة تسمية سريعة داخل البطاقة */
async function onInlineRename(personId, patch) {
  const famKey = Model.getSelectedKey();
  const fam = Model.getFamilies()[famKey];
  if (!fam) return;

  const targetId = personId != null ? String(personId) : '';

  const applyPatch = (p) => {
    if (!p || typeof p !== 'object') return; // يمنع الخطأ نهائيًا
    if (patch.name != null) p.name = String(patch.name).trim();
    if (patch.cognomen != null) {
      p.bio = p.bio || {};
      p.bio.cognomen = String(patch.cognomen).trim();
    }
    if (patch.role != null) p.role = String(patch.role).trim();
    FeatureSearch.cacheNorm(p);
  };

  // جرّب بنفس الـ id كما هو + كـ string + كـ number (لو كان رقميًا)
  FeatureSearch.updatePersonEverywhere(fam, personId, applyPatch);
  FeatureSearch.updatePersonEverywhere(fam, targetId, applyPatch);

  if (/^\d+$/.test(targetId)) {
    const n = Number(targetId);
    FeatureSearch.updatePersonEverywhere(fam, n, applyPatch);
  }

  Model.commitFamily(famKey);

  // إعادة حساب التحقق وتحديث مركز التنبيهات مباشرة بعد commit
  try {
    const { errors, warnings } = validateFamily(fam);

    setValidationResults(`family:${famKey}`, {
      title: `تنبيهات التحقق — ${fam.title || fam.familyName || famKey}`,
      errors,
      warnings,
      meta: { familyKey: famKey, ts: Date.now(), origin: 'inlineRename' }
    });

  } catch {}

  // مزامنة المودال فقط لو الشخص المفتوح هو نفسه
  if (dom.currentPerson && String(dom.currentPerson._id) === targetId) {
    if (patch.name != null) {
      dom.currentPerson.name = String(patch.name).trim();
      if (dom.modalName) dom.modalName.textContent = dom.currentPerson.name;
    }

    if (patch.cognomen != null) {
      dom.currentPerson.bio = dom.currentPerson.bio || {};
      dom.currentPerson.bio.cognomen = String(patch.cognomen).trim();
    }

    if (patch.role != null) {
      dom.currentPerson.role = String(patch.role).trim();
      if (dom.modalRole) dom.modalRole.textContent = dom.currentPerson.role;
    }
  }

  const p = findPersonByIdInFamily(fam, personId) || findPersonByIdInFamily(fam, targetId);
  if (TreeUI.refreshAvatarById && p) TreeUI.refreshAvatarById(p);

showSuccess('تم تحديث الاسم بنجاح.');

  FeatureDuplicates.warnDuplicatesIfAny(famKey);
}

/* عرض السيرة وتهيئة أدوات الصورة */
async function onShowDetails(person, opts = {}) {
  if (!dom.bioModal || !dom.modalContent) {
    dom.bioModal       = byId('bioModal');
    dom.modalName      = byId('modalName');
    dom.modalRole      = byId('modalRole');
    dom.modalContent   = byId('modalContent');
    dom.bioModeSelect  = byId('bioModeSelect');        // NEW
    dom.bioSectionsContainer = byId('bioSectionsContainer'); // NEW
  }
  if (!dom.bioModal || !dom.modalContent) return;

  const fam = Model.getFamilies()[Model.getSelectedKey()];
  if (!fam) return;

  let personObj = null;
  if (typeof person === 'object' && person?._id) {
    personObj = findPersonByIdInFamily(fam, person._id) || person;
  } else if (typeof person === 'string') {
    personObj = findPersonByIdInFamily(fam, person) || null;
    if (!personObj) {
      const tops = [
        ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
        fam.father, fam.rootPerson, ...(fam.wives || [])
      ].filter(Boolean);
      personObj = tops.find(p => p?.role === person) || null;
    }
  }
  if (!personObj) return;

  // ضمان _id
  if (!personObj._id) {
    const newId = (crypto?.randomUUID?.() || ('p_' + Math.random().toString(36).slice(2)));
    const famKey = Model.getSelectedKey();
    const F = Model.getFamilies()[famKey];
    FeatureIDs.assignIdEverywhere(F, personObj, newId);
    Model.linkRootPersonWives?.();
    await Model.savePersistedFamilies?.();
    personObj._id = newId;
  }

  dom.currentPerson = personObj;

  const bio = Object.assign({}, personObj.bio || {});
  bio.fullName = (bio.fullName || bio.fullname || personObj.name || '').toString();

  dom.modalName.textContent =
    (personObj.name ? String(personObj.name).trim() : '') || (bio.fullName || '');

  dom.pendingPhoto = null;

  // أدوات الصور عبر bus
  bus.emit('person:open', { person: personObj });

  dom.modalRole.textContent = personObj.role || '';

  // لا نمسح modalContent كله حتى لا نحذف شريط الـ <select>
  const modeSelect = dom.bioModeSelect || byId('bioModeSelect');
  const sectionsContainer = dom.bioSectionsContainer || byId('bioSectionsContainer');
  if (sectionsContainer) sectionsContainer.innerHTML = '';

  // 1) قراءة الأوضاع المتاحة من TreeUI وملء القائمة تلقائيًا (ديناميكيًا حسب الشخص)
  let modes = [];
  if (typeof TreeUI.getAvailableBioModes === 'function') {
    try {
      modes = TreeUI.getAvailableBioModes(bio, personObj, fam) || [];
    } catch {
      modes = [];
    }
  }

  if (modeSelect) {
    modeSelect.innerHTML = '';
    modes.forEach(m => {
      if (!m || !m.value) return;
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label || m.value;
      modeSelect.appendChild(opt);
    });
  }

  // 2) تحديد الوضع الافتراضي للسيرة
  let mode = 'summary';
  if (Array.isArray(modes) && modes.length) {
    const preferred = modes.find(m => m.value === 'summary') || modes[0];
    if (preferred && preferred.value) mode = preferred.value;
  }

  if (modeSelect) {
    modeSelect.value = mode;
  }

  // 3) دالة إعادة الرسم حسب الوضع الحالي
  // خريطة تربط mode بأهم section نريد التمرير إليه
  const MODE_MAIN_SECTION = {
    summary:  'basic',
    family:   'family',
    grands:   'grands',
    children: 'children',
    wives:    'wives',
    stories:  'stories',
    timeline: 'timeline',  // قسم الخط الزمني للأحداث
    sources:  'sources'    // NEW: قسم المصادر والوثائق
  };

  // خريطة عكسية: من sectionId إلى وضع السيرة المناسب
  const SECTION_TO_MODE = {
    basic:    'summary',
    family:   'family',
    grands:   'grands',
    children: 'children',
    wives:    'wives',
    stories:  'stories',
    timeline: 'timeline',
    sources:  'sources'
  };

  // دالة تساعد على تمرير المودال إلى بداية القسم المطلوب
  const scrollToCurrentSection = () => {
    const sectionId = MODE_MAIN_SECTION[mode] || null;
    if (!sectionId) return;

    // حاوية الأقسام داخل المودال
    const container =
      dom.bioSectionsContainer ||
      document.getElementById('bioSectionsContainer') ||
      dom.modalContent ||
      document.getElementById('modalContent');

    if (!container) return;

    // نحاول إيجاد القسم بحسب data-section-id أولاً، ثم بالكلاس الاحتياطي
    const sec =
      container.querySelector(`.bio-section[data-section-id="${sectionId}"]`) ||
      container.querySelector(`.bio-section-${sectionId}`);

    if (!sec) return;

    // تمرير ناعم إلى بداية القسم داخل أقرب عنصر قابل للتمرير (المودال)
    sec.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    });
  };


  // 3) دالة إعادة الرسم حسب الوضع الحالي
  const rerenderBio = (options = {}) => {
    const { skipScroll = false } = options;

    const target = dom.bioSectionsContainer || byId('bioSectionsContainer') || dom.modalContent;
    if (!target) return;

    target.innerHTML = '';
    TreeUI.renderBioSections(target, bio, personObj, fam, {
      ...handlers,
      onShowDetails,
      onInlineRename,
      onEditFamily,
      onDeleteFamily,
      onModalSave,
      // تمرير وضع السيرة الحالي
      bioMode: mode,
      // NEW: رد فعل عند الضغط على أي زر من شريط الروابط السريعة
      onBioShortcutClick: (sectionId) => {
        const targetMode = SECTION_TO_MODE[sectionId] || 'summary';

        // 1) إن كان الوضع المطلوب مختلفًا، غيّره وأعد الرسم
        const needRerender = (mode !== targetMode);
        if (needRerender){
          mode = targetMode;
          if (modeSelect) modeSelect.value = targetMode;
          rerenderBio({ skipScroll:true });
        }

        // 2) بعد اكتمال الرسم، مرِّر إلى القسم المطلوب داخل المودال
        requestAnimationFrame(() => {
          const container =
            dom.bioSectionsContainer ||
            document.getElementById('bioSectionsContainer') ||
            dom.modalContent ||
            document.getElementById('modalContent');

          if (!container) return;

          const sec =
            container.querySelector(`.bio-section[data-section-id="${sectionId}"]`) ||
            container.querySelector(`.bio-section-${sectionId}`);

          if (sec){
            sec.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
              inline: 'nearest'
            });
          }
        });
      }
    });

    // نؤجل التمرير لآخر فريم بعد اكتمال الرسم
    if (!skipScroll) {
      requestAnimationFrame(scrollToCurrentSection);
    }
  };

  // 4) ربط تغيير select بإعادة الرسم + التمرير
  if (modeSelect) {
    modeSelect.onchange = () => {
      mode = modeSelect.value || 'summary';
      rerenderBio();
    };
  }

  // 5) أول رسم
  rerenderBio({ skipScroll: true });

  if (personObj?._id) {
    location.hash = `#person=${encodeURIComponent(personObj._id)}`;
  }

  FeaturePhotos.updatePhotoControls(dom);

  ModalManager.open(dom.bioModal);
  if (!opts.silent) {
    showSuccess(`تم عرض تفاصيل ${highlight(personObj.name || 'هذا الشخص')}`);
  }
}

/* تمرير الأحداث كواجهات للميزات */
handlers.onHideFamily   = (key) => FeatureVisibility.onHideFamily(key, {
  Model, redrawUI, showInfo, showSuccess, highlight, bus
});
handlers.onSelectFamily = onSelectFamily;
handlers.onEditFamily   = onEditFamily;
handlers.onDeleteFamily = onDeleteFamily;
handlers.onModalSave    = onModalSave;
handlers.onShowDetails  = onShowDetails;
handlers.onInlineRename = onInlineRename;

// تقدير عدد الأشخاص داخل Family (بدون الاعتماد على شكل واحد فقط)
function estimatePersonsInFamily(fam){
  if (!fam) return 0;

  let count = 0;
  const seen = new Set();

  const visit = (p) => {
    if (!p || typeof p !== 'object') return;
    const id = (p._id != null) ? String(p._id) : null;
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    count++;

    const children = Array.isArray(p.children) ? p.children : [];
    for (const c of children) visit(c);

    const wives = Array.isArray(p.wives) ? p.wives : [];
    for (const w of wives){
      visit(w);
      const wc = Array.isArray(w.children) ? w.children : [];
      for (const c of wc) visit(c);
    }
  };

  // أعلى مستويات شائعة عندك
  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father,
    fam.rootPerson,
    ...(Array.isArray(fam.wives) ? fam.wives : [])
  ].filter(Boolean);

  for (const t of tops) visit(t);

  return count;
}

// معالجة تدريجية: تحريك التقدم بناءً على حجم البيانات (30% → 60%)
// تحسين: لا نعيد حساب estimatePersonsInFamily مرتين لكل عائلة (كاش)
async function progressLoadFamiliesBySize(fams){
  const keys = Object.keys(fams || {});
  const totalFamilies = keys.length || 1;

  // كاش: احسب عدد الأشخاص لكل عائلة مرة واحدة
  const personsByKey = new Map();
  let totalPersons = 0;

  for (const k of keys){
    const n = estimatePersonsInFamily(fams[k]);
    const safeN = Math.max(1, n); // لا نسمح بالصفر
    personsByKey.set(k, safeN);
    totalPersons += safeN;
  }

  // احتياط: لا يصبح صفر (لو لم توجد عائلات أصلًا)
  totalPersons = Math.max(totalPersons, totalFamilies);

  let donePersons = 0;

  // تحديثات متقطعة مع yield للواجهة
  const yieldFrame = () => new Promise(r => requestAnimationFrame(r));

  for (let i = 0; i < keys.length; i++){
    const k = keys[i];
    const famPersons = personsByKey.get(k) || 1;

    donePersons += famPersons;

    const ratio = Math.min(1, donePersons / totalPersons);
    const p = 30 + Math.round(ratio * 30); // 30..60
    setSplashProgress(p, `تحميل البيانات: ${(ratio*100).toFixed(0)}%`);

    // yield كل 2 عائلات تقريبًا لتبقى الواجهة سلسة
    if (i % 2 === 0) await yieldFrame();
  }

  // ضمان وصولها لـ 60
  setSplashProgress(60,'اكتمل تجهيز بيانات العائلات.');
}

/* =========================
   Bootstrap
   ========================= */
async function bootstrap(){
  window.__bootStarted=true; window.__bootDone=false;

  const splashEl=document.getElementById('app-splash');
  if(splashEl){ splashEl.removeAttribute('hidden'); splashEl.style.display='flex'; splashEl.dataset.splashHidden='0'; }
  splashShownAt=(performance?.now?.()||Date.now()); armSplashTimeout();
  setSplashProgress(5,'بدء تهيئة التطبيق…');

  try{
    perf.start('bootstrap:total');

    // ===== 1) First Paint سريع: DOM + Theme + Placeholder =====
    perf.start('bootstrap:firstPaint');

    // مراجع DOM أساسية (مبكّرًا)
    dom.familyButtons        = byId('familyButtons');
    dom.themeButtons         = byId('themeButtons');
    dom.closeModalBtn        = byId('closeModal');
    dom.toastContainer       = byId('toastContainer');
    dom.familyTree           = byId('familyTree');
    dom.treeTitle            = byId('treeTitle');
    dom.bioModal             = byId('bioModal');
    dom.modalName            = byId('modalName');
    dom.modalRole            = byId('modalRole');
    dom.modalContent         = byId('modalContent');
    dom.bioModeSelect        = byId('bioModeSelect');
    dom.bioSectionsContainer = byId('bioSectionsContainer');
    dom.searchInput          = byId('quickSearch');
    dom.suggestBox           = byId('searchSuggestions');
    dom.activeFamily         = byId('activeFamily');

    // 🔒 زر قفل الآن في الشريط العلوي
const topLockBtn = byId('pinTopLockNowBtn');
topLockBtn?.addEventListener('click', () => {
  bus.emit('pin:lockNow');
});

    // ثيم + شعار بسرعة
    const bootTheme=
      window.__bootTheme||
      [...document.documentElement.classList].find(c=>c.startsWith('theme-'))?.slice(6)||
      (localStorage.getItem('theme')||localStorage.getItem('appTheme')||'default').trim();

    applySavedTheme(bootTheme);
    setState({theme:bootTheme});
    syncThemeColor();
    updateSplashLogo(bootTheme);

    // Placeholder بسيط للشجرة (بدون الاعتماد على البيانات)
    if(dom.familyTree){ dom.familyTree.setAttribute('aria-busy','true'); dom.familyTree.dataset.placeholder='1'; }

    setSplashProgress(12,'تهيئة الواجهة الأساسية…');
    perf.end('bootstrap:firstPaint');

    // ===== 2) التخزين (غير حاجز لعرض الواجهة) =====
    perf.start('bootstrap:storage');
    try{ await ensurePersistentStorage(); setSplashProgress(20,'التحقق من حفظ البيانات…'); }
    catch{ setSplashProgress(18,'متابعة التهيئة بدون تخزين دائم…'); }
    perf.end('bootstrap:storage');

    setSplashProgress(55,'تحضير الواجهة…');

    // أزرار الصعود/النزول
    initScrollButtons();

    // مزامنة العائلات + الفلاتر
const refreshFamiliesAndFilters=()=>{
  // منطق غير UI
  if(typeof FeatureSearch.refreshFilterOptionsForCurrentFamily==='function'){
    FeatureSearch.refreshFilterOptionsForCurrentFamily();
  }
  // UI عبر subscribeTo فقط
  setState({ uiTick: Date.now() });
};

    bus.on('io:import:done',refreshFamiliesAndFilters);
    bus.on('families:coreFlag:refresh',refreshFamiliesAndFilters);
    bus.on('families:visibility:changed',refreshFamiliesAndFilters);

window.addEventListener('FT_VISIBILITY_REFRESH', () => {
  setState({ uiTick: Date.now() });
});

    /* ===== مبدّل العائلة (القائمة المنسدلة أعلى الشجرة) ===== */
    dom.activeFamily?.addEventListener('click',e=>{
      const box=dom.activeFamily; if(!box) return;

      const toggleBtn=e.target.closest('.family-switcher-toggle');
      const optionBtn=e.target.closest('.family-switcher-btn[data-family]');
      if(toggleBtn||optionBtn) e.stopPropagation();

      if(toggleBtn){
        const isOpen=box.classList.toggle('is-open');
        toggleBtn.setAttribute('aria-expanded',isOpen?'true':'false');
        return;
      }

      if(optionBtn){
        const id=optionBtn.dataset.family; if(!id) return;
        onSelectFamily(id);
        box.classList.remove('is-open');
        const headToggle=box.querySelector('.family-switcher-toggle');
        if(headToggle) headToggle.setAttribute('aria-expanded','false');
      }
    });

    // إغلاق المبدّل عند النقر خارجَه (bubble)
    document.addEventListener('click',e=>{
      const box=dom.activeFamily;
      if(!box||!box.classList.contains('is-open')) return;
      if(box.contains(e.target)) return;
      box.classList.remove('is-open');
      const toggle=box.querySelector('.family-switcher-toggle');
      if(toggle) toggle.setAttribute('aria-expanded','false');
    });

    // إغلاق المبدّل عند النقر خارجَه (capture + إعادة السهم النصي القديم)
    document.addEventListener('click',e=>{
      const box=dom.activeFamily;
      if(!box) return;
      if(!box.contains(e.target)&&box.classList.contains('is-open')){
        box.classList.remove('is-open');
        const toggle=box.querySelector('.family-switcher-toggle');
        const arrow=box.querySelector('.family-switcher-arrow');
        if(toggle) toggle.setAttribute('aria-expanded','false');
      }
    },true);

    /* ===== الشريط الجانبي: فتح/إغلاق + فخ تركيز ===== */
    const panel=byId('sidePanel');
    const overlay=byId('sideOverlay');
    const toggle=byId('sideToggle');
    let prevFocus=null;

    // موقع زر التبديل الأصلي
    const toggleHomeParent=toggle?toggle.parentNode:null;
    const toggleHomeNext=toggle?toggle.nextSibling:null;

    const openPanel=()=>{
      if(!panel) return;
      prevFocus=document.activeElement;
      panel.inert=false;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden','false');
      if(overlay) overlay.hidden=false;

      if(toggle){
        const header=panel.querySelector('.side-header');
        if(header&&!header.contains(toggle)) header.insertBefore(toggle,header.firstChild);
        toggle.setAttribute('aria-expanded','true');
        toggle.setAttribute('aria-label','إغلاق لوحة الإعدادات');
        toggle.classList.add('close-button');
      }

      const target=panel.querySelector('.side-header h3')||panel;
      setTimeout(()=>target?.focus?.(),0);
      document.documentElement.style.overflow='hidden';
    };

    const closePanel=()=>{
      if(!panel) return;

      (toggle||document.body).focus?.();

      panel.classList.remove('open');
      panel.setAttribute('aria-hidden','true');
      panel.inert=true;

      if(overlay) overlay.hidden=false;
      if(overlay) overlay.hidden=true;

      if(toggle){
        toggle.setAttribute('aria-expanded','false');
        toggle.setAttribute('aria-label','فتح لوحة الإعدادات');
        toggle.classList.remove('close-button');

        if(toggleHomeParent){
          if(toggleHomeNext&&toggleHomeNext.parentNode===toggleHomeParent) toggleHomeParent.insertBefore(toggle,toggleHomeNext);
          else toggleHomeParent.appendChild(toggle);
        }
      }

      try{ prevFocus?.focus?.(); }catch{}
      prevFocus=null;
      document.documentElement.style.overflow='';
    };

    const togglePanel=()=>{ if(panel?.classList.contains('open')) closePanel(); else openPanel(); };

    bus.on('side:requestClose',closePanel);
    toggle?.addEventListener('click',togglePanel);
    overlay?.addEventListener('click',closePanel);

    // إغلاق بـ ESC
    panel?.addEventListener('keydown',e=>{ if(e.key==='Escape') closePanel(); });

    // إغلاق الشريط الجانبي عند الضغط على زر "تعديل العائلة" (id=edit-family)
    document.addEventListener('click',(e)=>{
      const btn=e.target?.closest?.('#edit-family');
      if(!btn) return;
      bus.emit('side:requestClose');
    },true);

    // فخ التركيز داخل اللوحة
    panel?.addEventListener('keydown',e=>{
      if(e.key!=='Tab') return;
      const focusables=Array.from(panel.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      ));
      if(!focusables.length) return;
      const first=focusables[0];
      const last=focusables[focusables.length-1];
      if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
    });

    // عناصر تُغلق اللوحة مباشرة
    const shouldCloseOnClick=t=>{
      if(!t) return false;
      if(t.closest('input[type="range"], .font-size-selector')) return false;
      if(t.closest('label[for="importInput"], #importInput')) return false;
      if(t.closest('input, select, textarea')) return false;
      if(t.closest('.theme-button')) return true;
      if(t.closest('#printBtn, #exportBtn, #statsBtn')) return true;
      if(t.closest('#shareSiteBtn, #rateSiteBtn, #sendNoteBtn, #helpBtn')) return true;
      return false;
    };

    panel?.addEventListener('click',e=>{ const t=e.target; if(shouldCloseOnClick(t)) closePanel(); });

    // اختيار/إدارة العائلات من الشريط الجانبي
    byId('familyButtons')?.addEventListener('click',e=>{
      const item=e.target.closest('.family-item');
      if(!item) return;

      const pickBtn=e.target.closest('.family-item > .family-button[data-family]');
      if(pickBtn){
        const key=pickBtn.dataset.family; if(!key) return;
        const current=Model.getSelectedKey();
        if(key!==current) onSelectFamily(key);
        closePanel();
        return;
      }

      if(e.target.closest('.hide-family')) return; // منطق الإخفاء موجود في FeatureVisibility

      if(e.target.closest('.edit-family')){
        const key=item.querySelector('.family-button[data-family]')?.dataset.family;
        if(!key) return;
        closePanel();
        onEditFamily(key);
        return;
      }

      if(e.target.closest('.del-family')){
        const key=item.querySelector('.family-button[data-family]')?.dataset.family;
        if(!key) return;
        onDeleteFamily(key);
        return;
      }
    });

    // إنشاء عائلة جديدة من الشريط
    byId('addFamilyBtn')?.addEventListener('click',()=>{
      closePanel();
      const modal=ModalUI.createFamilyCreatorModal(null,{onSave:onModalSave});
      ModalManager.open(modal);
      setTimeout(()=>modal.querySelector('#newFamilyTitle')?.focus(),50);
    });

bus.on('io:import:done',()=>{ setState({ uiTick: Date.now() }); closePanel(); });

    /* ===== إغلاق المودال ===== */
    const revokeModalBlob=()=>{
      try{
        const img=document.querySelector('#bioPhoto img[data-blob-url]');
        const u=img?.dataset?.blobUrl||'';
        if(u.startsWith('blob:')) URL.revokeObjectURL(u);
      }catch{}
    };

    dom.closeModalBtn?.addEventListener('click',()=>{
      revokeModalBlob();
      ModalManager.close(dom.bioModal);
      if(location.hash.startsWith('#person=')){
        history.replaceState(null,'',location.pathname+location.search);
      }
    });

    setSplashProgress(70,'ربط المزايا ومكوّنات الواجهة…');

    /* ===== تمرير سياق موحّد للميزات ===== */
    const ctx={ Model,DB,TreeUI,ModalUI,ModalManager, state:{getState,setState,subscribe}, dom,bus, redrawUI, findPersonByIdInFamily };

    FeatureIDs.init(ctx);
    FeatureVisibility.init(ctx);
    FeatureDuplicates.init(ctx);
    FeatureSearch.init(ctx);
    FeaturePhotos.init(ctx);
    FeatureStats.init(ctx);
    FeatureIO.init(ctx);
    FeaturePrint.init(ctx);
    FeatureEngage.init(ctx);
FeatureSecurity.init(ctx);

    setSplashProgress(85,'تهيئة البحث والإحصاءات والطباعة…');

    // فتح تفاصيل الشخص من البحث
    bus.on('ui:openPersonById',({id})=>onShowDetails(id,{silent:true}));

// ثيم + شعار + (بدون رسم يدوي)
applySavedTheme(bootTheme);
setState({ theme: bootTheme });
syncThemeColor();
updateSplashLogo(bootTheme);
// 🔒 تحميل إعدادات PIN من IndexedDB (لازم قبل أي _isPinEnabled/_idleMinutes)
try { await PinStore.init(); } catch {}
   
// 🔒 تأكد من فتح القفل قبل تحميل البيانات (قفل حقيقي)
await ensureUnlockedBeforeRender();
_startTopBarSessionCountdown();
_syncTopBarLockNowBtn();

// ===== 3) تحميل البيانات (IndexedDB) AFTER UNLOCK =====
perf.start('bootstrap:loadFamilies');
setSplashProgress(25,'تحميل بيانات العائلات…');
await Model.loadPersistedFamilies();

// DEV: افحص تكرار _id بعد التحميل مباشرة
if (!IS_PROD) {
  const fams = Model.getFamilies?.() || {};
  Object.keys(fams).forEach(k => devAssertNoDuplicateIdsInFamily(fams[k], k));
}
perf.end('bootstrap:loadFamilies');

// ===== 4) تقدم أقرب للحقيقة حسب حجم البيانات (30..60) =====
perf.start('bootstrap:progressBySize');
await progressLoadFamiliesBySize(Model.getFamilies());
perf.end('bootstrap:progressBySize');

// (مهم) ضمان وجود عائلة مرئية مختارة بعد التحميل
{
  const fams = Model.getFamilies();
  const cur  = Model.getSelectedKey();
  const ok   = cur && fams[cur] && fams[cur].hidden !== true;
  if (!ok) {
    const firstVisible =
      Object.keys(fams).find(k => fams[k] && fams[k].hidden !== true) || null;
    if (firstVisible) {
      Model.setSelectedKey(firstVisible);
      setState({ selectedFamily: firstVisible });
    }
  }
}

// إشعال الرسم عبر subscribeTo (مصدر واحد)
setState({ uiTick: Date.now() });

    // أزل placeholder
    if(dom.familyTree&&dom.familyTree.dataset.placeholder==='1'){
      dom.familyTree.removeAttribute('aria-busy');
      delete dom.familyTree.dataset.placeholder;
    }

    // توست
    getToastNodes().toastContainer=dom.toastContainer;

    // تهيئة مركز التنبيهات (أيقونة + مودال) — الآن مرتبط بالعائلة الحالية فقط
    initValidationUI({ byId,showInfo,showError,showWarning, ModalManager,bus, getState, Model });

    // منع التداخل مع تحرير الاسم inline
    const stopIfEditableName=e=>{
      const el=e.target?.closest?.('[contenteditable="true"]');
      if(el) e.stopPropagation();
    };
    ['mousedown','click','dblclick','touchstart'].forEach(ev=>document.addEventListener(ev,stopIfEditableName,true));

    // أزرار الثيم + تحديث الشعار + الرسائل
    dom.themeButtons?.addEventListener('click',e=>{
      const btn=e.target.closest('.theme-button');
      if(!btn) return;
      const theme=btn.dataset.theme;
      const prevTheme=getState().theme||bootTheme;

      if(theme===prevTheme){
        const curLabel=btn.dataset.label||theme;
        showInfo(`النمط ${highlight(curLabel)} مُفعَّل حاليًا بالفعل.`);
        return;
      }

      const prevBtn=dom.themeButtons.querySelector(`.theme-button[data-theme="${prevTheme}"]`);
      const prevLabel=prevBtn?.dataset.label||prevTheme||'السابق';
      const newLabel=btn.dataset.label||theme;

      if(theme==='default'){
        document.documentElement.classList.remove('theme-corporate','theme-elegant','theme-minimal','theme-royal','theme-dark');
      }

      setState({theme});
      applySavedTheme(theme);
      localStorage.setItem('theme',theme);
      localStorage.setItem('appTheme',theme);
      syncThemeColor();
      updateSplashLogo(theme);

      showSuccess(`تم تغيير النمط من ${highlight(prevLabel)} إلى ${highlight(newLabel)}.`);
    });

bus.emit('app:ready');

// إنهاء الغطاء
setSplashProgress(95,'عرض مخطط شجرة العائلة…');
setSplashProgress(100,'اكتمل تحميل شجرة العائلة.');

// أخفِ splash أولاً (القفل سيكون فوقه)
window.__bootDone = true;
disarmSplashTimeout();
hideSplash(true);

perf.end('bootstrap:total');

  }catch(err){
    console.error(err);
    window.__bootDone=false; disarmSplashTimeout();
    showSplashError(err?.message||'تعذر إكمال تهيئة التطبيق.');
  }
}

/* التقاط الأخطاء العامة */
window.addEventListener('error', event => {
  showSplashError(event?.message || 'خطأ في جافاسكربت.');
});

window.addEventListener('unhandledrejection', event => {
  const reason = event?.reason;
  const msg =
    (reason && typeof reason === 'object' && reason.message) ? reason.message :
    (typeof reason === 'string' ? reason : 'حدث خطأ في أحد الوعود (Promise).');
  showSplashError(msg);
});

// بدء التشغيل
document.addEventListener('DOMContentLoaded', bootstrap);