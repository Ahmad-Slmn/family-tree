// app.js — تهيئة وربط الواجهة بدون تعديل السلوك

import * as Model from './model/families.js';
import { DB, ensurePersistentStorage } from './storage/db.js';
import * as TreeUI from './ui/tree.js';
import * as ModalUI from './ui/modal.js';
import { ModalManager } from './ui/modalManager.js';

import {
  byId, showSuccess, showInfo, showError, showWarning, highlight,
  applySavedTheme, currentTheme, getToastNodes
} from './utils.js';


import { getState, setState, subscribeTo, subscribe } from './stateManager.js';

// الميزات
import * as FeatureIDs from './features/ids.js';
import * as FeatureVisibility from './features/visibility.js';
import * as FeatureDuplicates from './features/duplicates.js';
import * as FeatureSearch from './features/search.js';
import * as FeaturePhotos from './features/photo.js';
import * as FeatureStats from './features/stats.js';
import * as FeatureIO from './features/io.js';
import * as FeaturePrint from './features/print.js';

// أدوات غطاء التحميل (Logo + Progress + حركة الشجرة)
let currentSplashProgress = 0;
let splashHasError        = false; // هل الغطاء في وضع خطأ حاليًا؟

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

/* عرض الغطاء في وضع الخطأ مع آخر نسبة معروفة */
function showSplashError(message){
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
    const baseMsg = 'حدث خطأ غير متوقع أثناء تحميل شجرة العائلة. يرجى مراجعة الكود ثم إعادة المحاولة.';
    if (message){
      // نختصر الرسالة حتى لا تفسد التصميم
      const msgStr = String(message);
      const shortMsg = msgStr.length > 160 ? msgStr.slice(0,157) + '…' : msgStr;
      subtitle.textContent = baseMsg + ' (تفاصيل: ' + shortMsg + ')';
    } else {
      subtitle.textContent = baseMsg;
    }
  }

  // كلاس اختياري لو أردت تنسيق خاص لحالة الخطأ (يمكنك استخدامه في CSS)
  s.classList.add('has-error');
}

/* إخفاء الغطاء (لا يُخفي إن كان في وضع خطأ إلا لو force=true) */
function hideSplash(force = false){
  const s = document.getElementById('app-splash');
  if (!s || s.dataset.splashHidden === '1') return;

  // في حال وجود خطأ، لا نخفي الغطاء إلا عند نجاح التحميل (force) أو تشغيل طبيعي
  if (!force && splashHasError) return;

  splashHasError = false; // إعادة ضبط حالة الخطأ

  // إزالة دلالات الخطأ
  s.classList.remove('has-error');

  // علامة حتى لا تُستدعى الدالة مرتين
  s.dataset.splashHidden = '1';
  s.setAttribute('aria-busy','false');

  // بدء حركة الخروج التدريجي
  s.classList.add('is-hiding');

  const finishHide = () => {
    s.removeEventListener('animationend', finishHide);
    s.setAttribute('hidden','');
    s.style.display = 'none';
  };

  // عند انتهاء الأنيميشن أَخفِ الغطاء فعليًا
  s.addEventListener('animationend', finishHide);

  // احتياط: في حال لم تعمل الحركة لأي سبب
  setTimeout(() => {
    if (!s.hasAttribute('hidden')) {
      finishHide();
    }
  }, 650);

  // حركة دخول الشجرة بالتزامن مع تلاشي الغطاء
  const tree = document.getElementById('familyTree');
  if (tree){
    tree.classList.add('family-tree-enter');
    tree.addEventListener('animationend', () => {
      tree.classList.remove('family-tree-enter');
    }, { once:true });
  }
}


// Fallback: أخفِ الغطاء عند load فقط إن لم نكن في وضع خطأ
window.addEventListener('load', () => {
  if (!splashHasError){
    hideSplash();
  }
});


/* =========================
   حافلة أحداث بسيطة
   ========================= */
const bus = (() => {
  const m = new Map();
  return {
    on: (t, f) => { m.set(t, (m.get(t) || []).concat(f)); },
    emit: (t, p) => { (m.get(t) || []).forEach(f => f(p)); }
  };
})();

/* =========================
   DOM مشترك
   ========================= */
const dom = {
  pendingPhoto: null,
  familyButtons: null, themeButtons: null, closeModalBtn: null, toastContainer: null,
  familyTree: null, treeTitle: null, bioModal: null, modalName: null, modalRole: null, modalContent: null,
  searchInput: null, suggestBox: null, activeFamily: null
};

/* =========================
   تبديل شعار الغطاء حسب الثيم
   ========================= */
function updateSplashLogo(theme){
  const img = document.getElementById('appSplashLogo');
  if (!img) return;

  // خريطة بسيطة: يمكن تعديلها لاحقًا بسهولة
  const LOGO_BY_THEME = {
    default:   'default-logo-gold.png',     // النمط الرئيسي (teal)
    elegant:   'elegant-logo-ocean-blue.png',     // المحيط – يبقى teal
    corporate: 'corporate-logo-forest-green.png',     // الغابة – ذهبي
    minimal:   'minimal-logo-rose-crimson.png',     // الغروب – ذهبي
    dark:      'dark-logo-amber-gold-glow.png'  // الداكن – رمادي غامق
  };

  const file = LOGO_BY_THEME[theme] || LOGO_BY_THEME.default;
  img.src = `src/assets/images/${file}`;
}

/* =========================
   Handlers مشتركة تُمرَّر للـ UI
   ========================= */
const handlers = {
  showSuccess, showInfo, showWarning, showError, highlight,
  getSearch: () => (getState().search || ''),
  getFilters: () => (getState().filters || {})
};

/* =========================
   رسم الواجهة
   ========================= */
function redrawUI(selectedKey = Model.getSelectedKey()) {
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

/* ملء قائمة التبديل: الحالية أولاً ثم أبجديًا (نفس السلوك) */
function fillFamilySelect(familiesMap, activeKey){
  const sel = byId('activeFamily');
  if (!sel) return;

  const coll = new Intl.Collator('ar', { sensitivity:'base', numeric:true });

  const items = entriesOfFamilies(familiesMap)
    // استبعد العائلات المخفية
    .filter(([id, f]) => f && f.hidden !== true)
    .map(([id, f]) => ({ id, title: (f?.title || f?.familyName || id) }))
    .sort((a,b)=>{
      if (a.id === activeKey) return -1;
      if (b.id === activeKey) return 1;
      return coll.compare(a.title, b.title);
    });

sel.innerHTML = items.map(f =>
  `<option value="${f.id}" ${f.id===activeKey?'selected':''}>عائلة: ${f.title}</option>`
).join('');

// تأكيد اختيار الخيار فعليًا على العنصر DOM
sel.value = activeKey || '';

}


function syncActiveFamilyUI(){
  const active = getState().selectedFamily || Model.getSelectedKey();
  fillFamilySelect(Model.getFamilies(), active);
}


/* ربط الحالة بالرسم */
/* ربط الحالة بالرسم (انتقائي) */
subscribeTo(
  s => ({ sel: s.selectedFamily, q: s.search, f: s.filters }),
  ({ sel }) => {
    redrawUI(sel);
    dom.suggestBox?.classList.remove('show');
    dom.searchInput?.setAttribute('aria-expanded', 'false');
    syncActiveFamilyUI();
  }
);


/* =========================
   أدوات مساعدة للبحث داخل العائلة
   ========================= */
function findPersonByIdInFamily(fam, pid) {
  if (!fam || !pid) return null;
  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives || [])
  ].filter(Boolean);

  for (const p of tops) {
    if (p?._id === pid) return p;

    const ch = Array.isArray(p?.children) ? p.children : [];
    for (const c of ch) { if (c?._id === pid) return c; }

    const ws = Array.isArray(p?.wives) ? p.wives : [];
    for (const w of ws) {
      if (w?._id === pid) return w;
      const wc = Array.isArray(w?.children) ? w.children : [];
      for (const c of wc) { if (c?._id === pid) return c; }
    }
  }
  const mirror = (fam.rootPerson && Array.isArray(fam.rootPerson.wives)) ? fam.rootPerson.wives : [];
  for (const w of mirror) {
    if (w?._id === pid) return w;
    const wc = Array.isArray(w?.children) ? w.children : [];
    for (const c of wc) { if (c?._id === pid) return c; }
  }
  return null;
}

/* =========================
   عمليات المستوى الأعلى
   ========================= */
function onSelectFamily(key) {
  Model.setSelectedKey(key);                 // كان مفقودًا
  setState({ selectedFamily: key });
  if (dom.activeFamily) dom.activeFamily.value = key; // تأكيد بصري فوري
}


/* فتح محرّر العائلة */
function onEditFamily(key) {
  const familyData = Model.getFamily(key);
  const modal = ModalUI.createFamilyCreatorModal(key, { initialData: familyData, onSave: onModalSave });
  ModalManager.open(modal);
}

/* حذف العائلة مع إعادة اختيار مناسبة */
async function onDeleteFamily(key) {
  const wasSelected = (Model.getSelectedKey() === key);
  await Model.deleteFamily(key);
  await Model.savePersistedFamilies?.();
  bus.emit('families:coreFlag:refresh');

  const remaining = Model.getFamilies();
  if (wasSelected) {
    const next = Object.keys(remaining)[0] || null;
    setState({ selectedFamily: next });
  }
  redrawUI();
  bus.emit('side:requestClose');
  syncActiveFamilyUI();

}

/* حفظ من المودال */
function onModalSave(key, familyObj) {
  // الحفاظ على أعلام core/custom كما هي
  const wasCore = !!Model.getFamily(key)?.__core;
  familyObj.__custom = true;
  if (wasCore) familyObj.__core = true;
  Model.getFamilies()[key] = familyObj;
  Model.commitFamily(key);

  const prevSelected = Model.getSelectedKey();
  Model.setSelectedKey(key);
  if (prevSelected !== key) {
    setState({ selectedFamily: key });
  } else {
    redrawUI();
  }

  showSuccess(`تمت إضافة/تحديث العائلة ${highlight(familyObj.title || familyObj.familyName || key)}.`);
  FeatureDuplicates.warnDuplicatesIfAny(key);
  syncActiveFamilyUI();
}

/* إعادة تسمية سريعة داخل البطاقة */
async function onInlineRename(personId, patch) {
  const famKey = Model.getSelectedKey();
  const fam = Model.getFamilies()[famKey];
  if (!fam) return;

  FeatureSearch.updatePersonEverywhere(fam, personId, (p) => {
    if (patch.name != null) p.name = String(patch.name).trim();
    if (patch.cognomen != null) {
      p.bio = p.bio || {};
      p.bio.cognomen = String(patch.cognomen).trim();
    }
    if (patch.role != null) p.role = String(patch.role).trim();
    FeatureSearch.cacheNorm(p);
  });

  Model.commitFamily(famKey);

  // مزامنة المودال المفتوح
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

  const p = findPersonByIdInFamily(fam, personId);
  if (TreeUI.refreshAvatarById && p) TreeUI.refreshAvatarById(p);

  showSuccess('تم الحفظ.');
  FeatureDuplicates.warnDuplicatesIfAny(famKey);
}

/* عرض السيرة وتهيئة أدوات الصورة */
async function onShowDetails(person, opts = {}) {
  if (!dom.bioModal || !dom.modalContent) {
    dom.bioModal = byId('bioModal');
    dom.modalName = byId('modalName');
    dom.modalRole = byId('modalRole');
    dom.modalContent = byId('modalContent');
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
  dom.modalName.textContent = (personObj.name ? String(personObj.name).trim() : '') || (bio.fullName || '');

  dom.pendingPhoto = null;

  // أدوات الصور عبر bus
  bus.emit('person:open', { person: personObj });

  dom.modalRole.textContent = personObj.role || '';
  dom.modalContent.textContent = '';

TreeUI.renderBioSections(dom.modalContent, bio, personObj, fam, {
  ...handlers,
  onShowDetails, onInlineRename, onEditFamily, onDeleteFamily, onModalSave
});

  if (personObj?._id) location.hash = `#person=${encodeURIComponent(personObj._id)}`;

  FeaturePhotos.updatePhotoControls(dom);

  ModalManager.open(dom.bioModal);
  if (!opts.silent) showSuccess(`تم عرض تفاصيل ${highlight(personObj.name || 'هذا الشخص')}`);
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


/* =========================
   Bootstrap
   ========================= */
async function bootstrap() {
  // إظهار الغطاء عندما تبدأ التهيئة فعليًا
  const splashEl = document.getElementById('app-splash');
  if (splashEl) splashEl.removeAttribute('hidden');

  // بداية التهيئة
  setSplashProgress(5, 'بدء تهيئة التطبيق…');

  try {
    try {
      await ensurePersistentStorage();
      setSplashProgress(20, 'التحقق من حفظ البيانات…');
    } catch {
      setSplashProgress(15, 'متابعة التهيئة بدون تخزين دائم…');
    }

    await Model.loadPersistedFamilies();
    setSplashProgress(40, 'تحميل بيانات العائلات…');


    // تأمين وجود عائلة مرئية مختارة قبل متابعة الربط والرسم
    {
      const fams = Model.getFamilies();
      const cur  = Model.getSelectedKey();
      const ok   = cur && fams[cur] && fams[cur].hidden !== true;
      if (!ok) {
        const firstVisible = Object.keys(fams).find(k => fams[k] && fams[k].hidden !== true) || null;
        if (firstVisible) {
          Model.setSelectedKey(firstVisible);
          setState({ selectedFamily: firstVisible });
        }
      }
    }
setSplashProgress(55, 'تحضير الواجهة…');
    // مراجع DOM
    dom.familyButtons  = byId('familyButtons');
    dom.themeButtons   = byId('themeButtons');
    dom.closeModalBtn  = byId('closeModal');
    dom.toastContainer = byId('toastContainer');
    dom.familyTree     = byId('familyTree');
    dom.treeTitle      = byId('treeTitle');
    dom.bioModal       = byId('bioModal');
    dom.modalName      = byId('modalName');
    dom.modalRole      = byId('modalRole');
    dom.modalContent   = byId('modalContent');
    dom.searchInput    = byId('quickSearch');
    dom.suggestBox     = byId('searchSuggestions');
    dom.activeFamily   = byId('activeFamily');

    bus.on('io:import:done', syncActiveFamilyUI);
    bus.on('families:coreFlag:refresh', syncActiveFamilyUI);
    // عند تغيّر رؤية العائلات من ميزة visibility
    bus.on('families:visibility:changed', syncActiveFamilyUI);

    // عند “إظهار العائلات الأساسية” من نافذة إعادة التفضيلات
    window.addEventListener('FT_VISIBILITY_REFRESH', () => {
      redrawUI();
      syncActiveFamilyUI();
    });

    // تبديل العائلة عبر select: تجاهل نفس الحالية
    dom.activeFamily?.addEventListener('change', (e) => {
      const id = e.target.value;
      if (id === Model.getSelectedKey()) return;
      onSelectFamily(id);
    });

    /* ===== الشريط الجانبي: فتح/إغلاق + فخ تركيز ===== */
    const panel    = byId('sidePanel');
    const overlay  = byId('sideOverlay');
    const toggle   = byId('sideToggle');
    const closeBtn = byId('sideClose');
    let prevFocus = null;

    const openPanel = () => {
      if (!panel) return;
      prevFocus = document.activeElement;
      panel.inert = false;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden','false');
      if (overlay) overlay.hidden = false;
      if (toggle)  toggle.setAttribute('aria-expanded','true');
      const target = panel.querySelector('.side-header h3') || panel;
      setTimeout(() => target?.focus?.(), 0);
      document.documentElement.style.overflow = 'hidden';
    };

    const closePanel = () => {
      if (!panel) return;
      (toggle || document.body).focus?.();     // سحب التركيز قبل الإخفاء
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden','true');
      panel.inert = true;
      if (overlay) overlay.hidden = true;
      if (toggle)  toggle.setAttribute('aria-expanded','false');
      try { prevFocus?.focus?.(); } catch {}
      prevFocus = null;
      document.documentElement.style.overflow = '';
    };

    const togglePanel = () => {
      if (panel?.classList.contains('open')) closePanel();
      else openPanel();
    };

    // قنوات إغلاق من باقي الوحدات
    bus.on('side:requestClose', closePanel);

    // أحداث فتح/إغلاق
    toggle?.addEventListener('click', togglePanel);
    closeBtn?.addEventListener('click', closePanel);
    overlay?.addEventListener('click', closePanel);

    // إغلاق بـ ESC
    panel?.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closePanel(); });

    // فخ تركيز داخل اللوحة
    panel?.addEventListener('keydown', (e)=>{
      if (e.key !== 'Tab') return;
      const focusables = Array.from(panel.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      ));
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length-1];
      if (e.shiftKey && document.activeElement === first){
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last){
        e.preventDefault(); first.focus();
      }
    });

    // عناصر تُغلق اللوحة مباشرة
    const shouldCloseOnClick = (t) => {
      if (!t) return false;
      if (t.closest('input[type="range"], .font-size-selector')) return false;
      if (t.closest('label[for="importInput"], #importInput')) return false;
      if (t.closest('input, select, textarea')) return false;
      if (t.closest('#sideClose')) return true;
      if (t.closest('.theme-button')) return true;
      if (t.closest('#printBtn, #exportBtn, #statsBtn')) return true;
      return false;
    };

    panel?.addEventListener('click', (e) => {
      const t = e.target;
      if (shouldCloseOnClick(t)) closePanel();
    });

    // اختيار عائلة من لائحة الشريط
    byId('familyButtons')?.addEventListener('click', (e) => {
      const item = e.target.closest('.family-item');
      if (!item) return;

      // a) اختيار عائلة
      const pickBtn = e.target.closest('.family-item > .family-button[data-family]');
      if (pickBtn) {
        const key = pickBtn.dataset.family;
        if (!key) return;
        const current = Model.getSelectedKey();
        if (key !== current) onSelectFamily(key); // لا رسائل عند نفس العائلة
        closePanel();
        return;
      }

      // b) إخفاء
      if (e.target.closest('.hide-family')) {
        return; // منطق الإخفاء في FeatureVisibility
      }

      // c) تعديل
      if (e.target.closest('.edit-family')) {
        const key = item.querySelector('.family-button[data-family]')?.dataset.family;
        if (!key) return;
        closePanel();
        onEditFamily(key);
        return;
      }

      // d) حذف
      if (e.target.closest('.del-family')) {
        const key = item.querySelector('.family-button[data-family]')?.dataset.family;
        if (!key) return;
        onDeleteFamily(key);
        return;
      }
    });

    // إضافة عائلة من داخل الشريط
    byId('addFamilyBtn')?.addEventListener('click', () => {
      closePanel();
      const modal = ModalUI.createFamilyCreatorModal(null, { onSave: onModalSave });
      ModalManager.open(modal);
      setTimeout(() => modal.querySelector('#newFamilyTitle')?.focus(), 50);
    });

    // بعد اكتمال الاستيراد: حدّث القائمة وأغلق
    bus.on('io:import:done', () => { syncActiveFamilyUI(); closePanel(); });

    /* ===== إغلاق المودال ===== */
    const revokeModalBlob = () => {
      try{
        const img = document.querySelector('#bioPhoto img[data-blob-url]');
        const u = img?.dataset?.blobUrl || '';
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      }catch{}
    };

    dom.closeModalBtn?.addEventListener('click', () => {
      revokeModalBlob();
      ModalManager.close(dom.bioModal);
      if (location.hash.startsWith('#person=')) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    });

    dom.bioModal?.addEventListener('click', (e) => {
      if (e.target === dom.bioModal) {
        revokeModalBlob();
        ModalManager.close(dom.bioModal);
        if (location.hash.startsWith('#person=')) {
          history.replaceState(null, '', location.pathname + location.search);
        }
      }
    });
setSplashProgress(70, 'ربط المزايا ومكوّنات الواجهة…');
    /* ===== تمرير سياق موحّد للميزات ===== */
    const ctx = {
      Model, DB, TreeUI, ModalUI, ModalManager,
      state: { getState, setState, subscribe },
      dom, bus,
      redrawUI,
      findPersonByIdInFamily
    };

    FeatureIDs.init(ctx);
    FeatureVisibility.init(ctx);
    FeatureDuplicates.init(ctx);
    FeatureSearch.init(ctx);
    FeaturePhotos.init(ctx);
    FeatureStats.init(ctx);
    FeatureIO.init(ctx);
    FeaturePrint.init(ctx);
setSplashProgress(85, 'تهيئة البحث والإحصاءات والطباعة…');
    // فتح التفاصيل مباشرة عند استقبال ui:openPersonById من البحث
    bus.on('ui:openPersonById', ({ id }) => onShowDetails(id, { silent: true }));

    // ثيم + شعار + رسم أولي
    applySavedTheme(currentTheme);
    updateSplashLogo(currentTheme);
    redrawUI();
    syncActiveFamilyUI();

    // توست
    getToastNodes().toastContainer = dom.toastContainer;

    // منع التداخل مع تحرير الاسم inline
    const stopIfEditableName = (e) => {
      const el = e.target && e.target.closest && e.target.closest('[contenteditable="true"]');
      if (el) e.stopPropagation();
    };
    ['mousedown','click','dblclick','touchstart'].forEach(ev =>
      document.addEventListener(ev, stopIfEditableName, true)
    );

    // أزرار الثيم + تحديث الشعار
    dom.themeButtons?.addEventListener('click', e => {
      const btn = e.target.closest('.theme-button');
      if (!btn) return;

      const theme = btn.dataset.theme;
      setState({ theme });
      applySavedTheme(theme);
      updateSplashLogo(theme);
    });


    bus.emit('app:ready');

    // المراحل النهائية للتحميل
    setSplashProgress(95, 'عرض مخطط شجرة العائلة…');
    setSplashProgress(100, 'اكتمل تحميل شجرة العائلة.');
    hideSplash(); // نجاح كامل ⇒ إخفاء الغطاء
  } catch (err) {
    console.error(err);
    // في حال فشل bootstrap ⇒ نُظهر الغطاء بوضع الخطأ مع آخر نسبة
    showSplashError(err?.message || 'تعذر إكمال تهيئة التطبيق.');
    // لا نستدعي hideSplash هنا حتى يبقى الغطاء ظاهراً حتى يصلح الخطأ
  } finally {
    // لا شيء هنا، كي لا نخفي الغطاء في حالة الخطأ
  }
}

// التقاط أي أخطاء JS غير معالَجة وإظهار الغطاء فورًا
window.addEventListener('error', (event) => {
  // لو حدث الخطأ بعد أن اختفى الغطاء بالكامل، نعيد إظهاره بوضع الخطأ
  showSplashError(event?.message || 'خطأ في جافاسكربت.');
});

// التقاط الأخطاء غير المعالَجة في الـ Promises
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const msg =
    (reason && typeof reason === 'object' && reason.message) ? reason.message :
    (typeof reason === 'string' ? reason : 'حدث خطأ في أحد الوعود (Promise).');
  showSplashError(msg);
});

// بدء التشغيل
document.addEventListener('DOMContentLoaded', bootstrap);
