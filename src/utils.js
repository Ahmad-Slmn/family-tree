// utils.js

/* =======================
   🧩 أدوات DOM عامة
======================= */
export const byId = (id) => document.getElementById(id);
export const nodes = { toastContainer: null }; // يُملأ عند DOMContentLoaded
export const createDivLine = (className) =>
  Object.assign(document.createElement('div'), { className });

/* =======================
   🔢 أعداد ترتيبية عربية خالصة
======================= */
export const ARABIC_ORDINALS_M = [
  'الأول','الثاني','الثالث','الرابع','الخامس','السادس','السابع',
  'الثامن','التاسع','العاشر','الحادي عشر','الثاني عشر','الثالث عشر',
  'الرابع عشر','الخمس عشر','السادس عشر','السابع عشر','الثامن عشر',
  'التاسع عشر','العشرون'
];

export const ARABIC_ORDINALS_F = [
  'الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة',
  'الثامنة','التاسعة','العاشرة','الحادية عشرة','الثانية عشرة','الثالثة عشرة',
  'الرابعة عشرة','الخامسة عشرة','السادسة عشرة','السابعة عشرة','الثامنة عشرة',
  'التاسعة عشرة','العشرون'
];

export const getArabicOrdinalM = (n) => ARABIC_ORDINALS_M[n - 1] || String(n);
export const getArabicOrdinalF = (n) => ARABIC_ORDINALS_F[n - 1] || String(n);
// توافق قديم: المذكر كافتراضي
export function getArabicOrdinal(n){ return getArabicOrdinalM(n); }

/* =======================
   ⚑ حالة «إخفاء العائلات الأساسية»
======================= */
let _hasHiddenCoreFamilies = false;
let _onResetHiddenCore = null;

export function setHasHiddenCoreFamilies(v) { _hasHiddenCoreFamilies = !!v; }
export function getHasHiddenCoreFamilies() { return _hasHiddenCoreFamilies; }
export function setOnResetHiddenCore(fn) { _onResetHiddenCore = (typeof fn === 'function') ? fn : null; }
export function triggerResetHiddenCore() { return (typeof _onResetHiddenCore === 'function') ? _onResetHiddenCore() : Promise.resolve(); }

/* =======================
   🧭 إيجاد أول زر عائلة ظاهر (افتراض)
======================= */
function firstVisibleFamilyBtn() {
  return [...document.querySelectorAll('.family-button')].find((b) => {
    const s = getComputedStyle(b);
    return (
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      b.offsetParent !== null &&
      !b.hasAttribute('hidden') &&
      !b.classList.contains('hidden') &&
      !b.classList.contains('is-hidden')
    );
  }) || null;
}
function getDefaultFamilyKey() { return firstVisibleFamilyBtn()?.dataset.family || null; }
function getDefaultFamilyLabel() { return firstVisibleFamilyBtn()?.textContent?.trim() || 'أول عائلة ظاهرة'; }

/* =======================
   🔔 Toast
   يعتمد على nodes.toastContainer
======================= */
const toastIcons = {
  success: '<i class="fa-solid fa-circle-check"></i>',
  error:   '<i class="fa-solid fa-circle-xmark"></i>',
  info:    '<i class="fa-solid fa-circle-info"></i>',
  warning: '<i class="fa-solid fa-triangle-exclamation"></i>'
};

export function toast(msg, type = 'info', duration = 3000) {
  const box = nodes.toastContainer;
  if (!box) return;

  // منع التكرار لنفس النص المعروض
  const tmp = document.createElement('div');
  tmp.innerHTML = String(msg ?? '');
  const incomingText = tmp.textContent || '';
  [...box.children]
    .filter((c) => c.classList.contains('toast') && (c.querySelector('.message')?.textContent || '') === incomingText)
    .forEach((e) => e.remove());

  const t = createDivLine(`toast ${type}`);
  const iconSpan = document.createElement('span'); iconSpan.className = 'icon'; iconSpan.innerHTML = toastIcons[type] || '';
  const msgSpan  = document.createElement('span'); msgSpan.className  = 'message'; msgSpan.innerHTML = String(msg ?? '');
  t.append(iconSpan, msgSpan);
  box.appendChild(t);

  const start = performance.now();
  function tick(now) {
    if (now - start >= duration) {
      t.style.animation = 'slideOut 0.4s forwards';
      const endAt = performance.now();
      const removeTick = (ts) => { if (ts - endAt >= 400) { t.remove(); return; } requestAnimationFrame(removeTick); };
      requestAnimationFrame(removeTick);
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
export const showError   = (m, d) => toast(m, 'error', d);
export const showSuccess = (m, d) => toast(m, 'success', d);
export const showInfo    = (m, d) => toast(m, 'info', d);
export const showWarning = (m, d) => toast(m, 'warning', d);

/* =======================
   🧼 تنسيق نص آمن + إبراز
======================= */
const escapeHtml = (s) =>
  String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
           .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
           .replace(/'/g,'&#39;');

export const highlight = (text) =>
  `<span style="color:#ffeb3b;font-weight:bold;">${escapeHtml(text)}</span>`;

export function getToastNodes() {
  if (nodes.toastContainer) return nodes;
  nodes.toastContainer = byId('toastContainer') || null;
  return nodes;
}

export function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
}
export function textEl(tag, txt, cls) {
  const e = el(tag, cls);
  e.textContent = txt;
  return e;
}

/* =======================
   ✅ نافذة تأكيد عامة
======================= */
export function showConfirmModal({
  title = 'تأكيد',
  message = 'هل أنت متأكد؟',
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  variant = 'default',
  closeOnBackdrop = true,
  defaultFocus = 'confirm',
  closeOnEsc = true
} = {}) {
  const modal = byId('confirmModal'),
        titleEl = byId('confirmTitle'),
        confirmTextEl = byId('confirmText'),
        yesBtn = byId('confirmYes'),
        noBtn = byId('confirmNo');

  if (!modal || !titleEl || !confirmTextEl || !yesBtn || !noBtn) return Promise.resolve(false);

  // نصوص + حالة مظهر
  titleEl.textContent = title;
  confirmTextEl.textContent = message;
  yesBtn.textContent = confirmText;
  noBtn.textContent  = cancelText;
  modal.classList.toggle('danger', variant === 'danger');

  // ARIA
  const ariaRole = (arguments[0] && arguments[0]._ariaRole) || 'dialog';
  modal.setAttribute('role', ariaRole);
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'confirmTitle');
  modal.setAttribute('aria-describedby', 'confirmText');
  if (ariaRole === 'alertdialog') closeOnBackdrop = false;

  // إظهار + قفل تمرير الخلفية
  modal.removeAttribute('aria-hidden'); // لا نترك aria-hidden="false"
  modal.inert = false;                  // السماح بالتركيز داخل المودال
  document.documentElement.style.overflow = 'hidden';
  modal.classList.add('show');

  // استبدال الأزرار لفصل المستمعات القديمة
  const replace = (btn) => { const c = btn.cloneNode(true); btn.parentNode.replaceChild(c, btn); return c; };
  const newYes = replace(yesBtn), newNo = replace(noBtn);
  const prevFocus = document.activeElement;

  const getFocusables = () =>
    Array.from(modal.querySelectorAll('button,[tabindex]:not([tabindex="-1"])')).filter((el) => el.tabIndex !== -1);

  function onBackdrop(e) { if (closeOnBackdrop && e.target === modal) newNo.click(); }
  function onKey(e) {
    if (e.key === 'Escape' && closeOnEsc) newNo.click();
    if (e.key === 'Tab') {
      const els = getFocusables(); if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  modal.addEventListener('click', onBackdrop);
  modal.addEventListener('keydown', onKey);

  // تركيز مبدئي
  setTimeout(() => (defaultFocus === 'confirm' ? newYes : newNo)?.focus(), 0);

  function cleanup() {
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);

    // مهم: لو كان الفوكس داخل المودال، بلِّره قبل وضع aria-hidden
    const active = document.activeElement;
    if (active && modal.contains(active)) {
      active.blur();
    }

    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true'); // إخفاء عن قارئات الشاشة
    modal.inert = true;                        // منع التركيز والتفاعل
    document.documentElement.style.overflow = '';

    try { prevFocus?.focus(); } catch {}
  }


  return new Promise((resolve) => {
    newYes.addEventListener('click', () => { cleanup(); resolve(true); });
    newNo .addEventListener('click', () => { cleanup(); resolve(false); });
  });
}

/* =======================
   🎨 إدارة الثيم
======================= */
export let currentTheme = localStorage.getItem('familyTreeTheme') || 'default';
export function applySavedTheme(theme) {
  document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
  if (theme && theme !== 'default') document.body.classList.add(`theme-${theme}`);
  document.querySelectorAll('.theme-button')
    .forEach((b) => b.classList.toggle('active-theme', b.dataset.theme === theme));
  currentTheme = theme || currentTheme;
  localStorage.setItem('familyTreeTheme', currentTheme);
}

/* =======================
   👪 تفضيل العائلة
======================= */
export let currentFamilyKey = localStorage.getItem('selectedFamily') || 'family1';
export function updateFamilyButtons() {
  const sel = localStorage.getItem('selectedFamily') || currentFamilyKey;
  document.querySelectorAll('.family-button')
    .forEach((b) => b.classList.toggle('active-family', b.dataset.family === sel));
}

/* =======================
   🅰️ حجم الخط
======================= */
let currentFontSize = parseInt(localStorage.getItem('siteFontSize')) || 16;
export function applyFontSize(size) {
  document.documentElement.style.fontSize = `${size}px`;
  const el = byId('fontSizeValue');
  if (el) el.textContent = `${size}px`;
  localStorage.setItem('siteFontSize', size);
}

/* =======================
   💾 حفظ التفضيلات (ثيم/عائلة)
======================= */
export function persistUserPreferences({ theme, family } = {}, options = {}) {
  const silent = !!(options && options.silent);

  const getName = (type, val) => {
    const sel = type === 'theme' ? `.theme-button[data-theme="${val}"]` : `.family-button[data-family="${val}"]`;
    const b = document.querySelector(sel);
    let txt = b ? (b.textContent || b.title || val).trim() : String(val);
    return txt.replace(/^عائلة:\s*/u, '').trim();
  };

  const applyChange = (type, newVal, oldVal, fn) => {
    if (newVal === oldVal) {
      if (!silent) showInfo(`${type === 'theme' ? 'النمط' : 'العائلة'} ${highlight(getName(type, oldVal))} هي ${type === 'theme' ? 'المفعل' : 'الحالية'} بالفعل`);
      return;
    }
    const oldName = getName(type, oldVal), newName = getName(type, newVal);
    fn(newVal);
    if (!silent) showSuccess(`تم تغيير ${type === 'theme' ? 'النمط' : 'العائلة'} من ${highlight(oldName)} إلى ${highlight(newName)}`);
  };

  if (theme !== undefined) {
    applyChange('theme', theme, currentTheme, (v) => {
      currentTheme = v;
      localStorage.setItem('familyTreeTheme', v);
      applySavedTheme(v);
    });
  }
  if (family !== undefined) {
    applyChange('family', family, currentFamilyKey, (v) => {
      currentFamilyKey = v;
      localStorage.setItem('selectedFamily', v);
      updateFamilyButtons();
    });
  }
}

/* =======================
   ♻️ إعادة التفضيلات إلى الافتراضي
======================= */
function resetPreferences({ theme = true, family = true, font = true } = {}) {
  const items = [];

  if (theme) {
    // امسح جميع مفاتيح الثيم من التخزين
    localStorage.removeItem('familyTreeTheme');
    localStorage.removeItem('theme');
    localStorage.removeItem('appTheme');

    // ثيم افتراضي داخليًا
    currentTheme = 'default';

    // إزالة أي كلاس ثيم من <html> (يتطابق مع سكربت الـ head)
    document.documentElement.classList.remove(
      'theme-corporate',
      'theme-elegant',
      'theme-minimal',
      'theme-royal',
      'theme-dark'
    );

    // تحديث الـ <body> وأزرار الثيم
    applySavedTheme(currentTheme);

    // إعلام بقية التطبيق بأن الثيم عاد للافتراضي
    window.dispatchEvent(new CustomEvent('FT_THEME_CHANGED', {
      detail: { theme: 'default' }
    }));

    items.push('النمط');
  }


  if (family) {
    localStorage.removeItem('selectedFamily');
    const defKey = getDefaultFamilyKey();
    if (defKey) {
      currentFamilyKey = defKey;
      localStorage.setItem('selectedFamily', defKey);
    } else {
      currentFamilyKey = '';
    }
    updateFamilyButtons();
    items.push('العائلة');
  }

  if (font) {
    localStorage.removeItem('siteFontSize');
    currentFontSize = 16;
    applyFontSize(currentFontSize);
    const r = byId('fontSizeRange'); if (r) r.value = currentFontSize;
    items.push('حجم الخط');
  }

  if (!items.length) { showInfo('لم يتم اختيار أي إعداد لإعادة التعيين.'); return; }
  const colored = items.map(highlight);
  showSuccess(`✅ تمت إعادة ${colored.join(' و ')} إلى الوضع الافتراضي.`);
}

/* =======================
   🪟 مودال خيارات إعادة التفضيلات
======================= */
function showResetOptionsModal({ title = 'تأكيد إعادة القيم', onConfirm, onCancel } = {}) {
  const modal = byId('confirmModal'),
        titleEl = byId('confirmTitle'),
        confirmTextEl = byId('confirmText'),
        yesBtn = byId('confirmYes'),
        noBtn = byId('confirmNo');

  if (!modal || !titleEl || !confirmTextEl || !yesBtn || !noBtn) return;

  const themeDefaultLabel  = document.querySelector('.theme-button[data-theme="default"]')?.textContent?.trim() || 'النمط الرئيسي';
  const familyDefaultLabel = getDefaultFamilyLabel();
  const fontDefaultLabel   = '16px';
  const defaultFamilyKey   = getDefaultFamilyKey();
  const hasVisibleFamily   = !!defaultFamilyKey;

  const opts = [
    { id: 'reset_opt_theme',  changed: currentTheme !== 'default',             label: `إعادة النمط إلى (${themeDefaultLabel})`,    info: 'النمط بالفعل على الوضع الإفتراضي' },
    { id: 'reset_opt_font',   changed: parseInt(currentFontSize) !== 16,       label: `إعادة حجم الخط إلى (${fontDefaultLabel})`,   info: 'حجم الخط بالفعل على الوضع الإفتراضي' },
    { id: 'reset_opt_core',   changed: !!getHasHiddenCoreFamilies(),           label: 'إظهار العائلات الأساسية المخفية',            info: 'لا توجد عائلات أساسية مخفية' }
  ];
  if (hasVisibleFamily) {
    opts.push({ id: 'reset_opt_family', changed: currentFamilyKey !== defaultFamilyKey, label: `إعادة العائلة الحالية إلى (${familyDefaultLabel})`, info: 'العائلة بالفعل على الوضع الإفتراضي' });
  }

  opts.sort((a, b) => (b.changed === a.changed ? 0 : (b.changed ? 1 : -1)));

  confirmTextEl.innerHTML = `
    <div class="reset-options">
      <p class="reset-note">اختر القيم التي تريد إعادة ضبطها:</p>
      ${opts.map(o => {
        const checked  = o.changed ? 'checked' : '';
        const disabled = o.changed ? '' : 'disabled';
        return `<label data-info="${o.info}"><input type="checkbox" id="${o.id}" ${checked} ${disabled}> ${o.label}</label>`;
      }).join('')}
    </div>
  `;
  titleEl.textContent = title;
  modal.classList.add('show');

  const replace = (btn) => { const c = btn.cloneNode(true); btn.parentNode.replaceChild(c, btn); return c; };
  const newYes = replace(yesBtn), newNo = replace(noBtn);

  const inputs = ['reset_opt_theme','reset_opt_family','reset_opt_font','reset_opt_core'].map((id) => byId(id)).filter(Boolean);
  const checkAny = () => inputs.some((i) => i.checked);
  const alertMsg = 'يرجى اختيار إعداد واحد على الأقل.';

  // رسالة توضيح عند النقر على خيار معطل
  document.querySelectorAll('.reset-options label').forEach((label) => {
    const input = label.querySelector('input');
    if (input.disabled) {
      label.addEventListener('click', (e) => { e.preventDefault(); showInfo(label.dataset.info); });
    }
  });

  inputs.forEach((i) => i.addEventListener('change', () => {
    if (!nodes.toastContainer) return;
    if (checkAny()) {
      Array.from(nodes.toastContainer.children)
        .filter((c) => c.classList.contains('toast') && c.innerText === alertMsg)
        .forEach((e) => e.remove());
    }
  }));

  newYes.addEventListener('click', async () => {
    const theme = !!byId('reset_opt_theme')?.checked;
    const family = !!byId('reset_opt_family')?.checked;
    const font   = !!byId('reset_opt_font')?.checked;
    const core   = !!byId('reset_opt_core')?.checked;

    if (!theme && !family && !font && !core) { showInfo(alertMsg); return; }
    modal.classList.remove('show');

    if ((theme || family || font) && onConfirm) onConfirm({ theme, family, font });

    // رسائل مناسبة عند إظهار العائلات الأساسية المخفية
    if (core) {
      try {
        const restored = await triggerResetHiddenCore();
        // إعادة رسم الواجهة بعد تحديث الرؤية
        window.dispatchEvent(new CustomEvent('FT_VISIBILITY_REFRESH'));

        // يدعم الشكلين: رقم مباشر أو كائن { count, labels }
        const info = (restored && typeof restored === 'object') ? restored
          : { count: Number(restored) || 0, labels: [] };

        const n = Number(info.count) || 0;

        if (n === 1) {
          const label = (info.labels && info.labels[0]) || 'العائلة الأساسية';
          // 2) تم إظهار العائلة المخفية + اسم العائلة مميز بـ highlight
          showSuccess(`تم إظهار عائلة ${highlight(label)} المخفية.`);

        } else if (n > 1) {
          // 3) تمييز العدد بـ highlight
          showSuccess(`تم إظهار ${highlight(String(n))} من العائلات الأساسية المخفية.`);
        }
        // لا حاجة لفرع n === 0 لأن الخيار لا يكون متاحاً أصلاً بدون عائلات مخفية
      } catch {
        showError('تعذّر إظهار العائلات الأساسية المخفية، حاول مرة أخرى.');
      }
    }


  });

  newNo.addEventListener('click', () => {
    modal.classList.remove('show');
    if (onCancel) onCancel();
  });
}

/* =======================
   🕹️ تهيئة عناصر الواجهة
======================= */
function initFontSize() {
  const r = byId('fontSizeRange');
  applyFontSize(currentFontSize);
  if (!r) return;
  r.value = currentFontSize;
  r.addEventListener('input', () => {
    const v = parseInt(r.value);
    if (v === currentFontSize) return;
    const old = currentFontSize;
    currentFontSize = v;
    applyFontSize(v);
    showSuccess(`تم تغيير حجم الخط من ${highlight(old + 'px')} إلى ${highlight(v + 'px')}`);
  });
}

function initResetSettings() {
  const btn = byId('resetSettingsBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // 1) مزامنة القيم من التخزين قبل الفحص
    const storedTheme = localStorage.getItem('familyTreeTheme') || 'default';
    const storedFont  = parseInt(localStorage.getItem('siteFontSize') || '16', 10);
    const storedFam   = localStorage.getItem('selectedFamily');

    // حافظ على المتغيرات العالمية متسقة
    currentTheme     = storedTheme;
    currentFontSize  = storedFont;
    if (storedFam != null) currentFamilyKey = storedFam;

    // 2) احسب “الأول الظاهر” آنيًا
    const defKey = getDefaultFamilyKey();           // قد تكون null إذا لا يوجد زر ظاهر
    const familyIsDefault = defKey ? (currentFamilyKey === defKey) : true; // إن لم توجد عائلة ظاهرة فاعتبرها افتراضيًا

    // 3) فحوصات الافتراضي القابلة للاعتماد
    const themeIsDefault  = currentTheme === 'default';
    const fontIsDefault   = Number(currentFontSize) === 16;
    const coreIsDefault   = !getHasHiddenCoreFamilies();

    const isDefault = themeIsDefault && fontIsDefault && familyIsDefault && coreIsDefault;

    if (isDefault) {
      showInfo('تفضيلات الواجهة حالياً على الوضع الافتراضي بالفعل.');
      return;
    }

    showResetOptionsModal({
      title: 'تأكيد إعادة تفضيلات الواجهة إلى الوضع الافتراضي',
      onConfirm: (opts) => resetPreferences(opts),
      onCancel: () => showInfo('تم إلغاء إعادة تفضيلات الواجهة إلى الوضع الافتراضي.')
    });
  });
}


/* =======================
   ⏰ التاريخ والوقت
======================= */
function updateDateTime() {
  const now = new Date();
  const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const day = weekdays[now.getDay()];
  const pad = (n) => String(n).padStart(2, '0');
  let h = now.getHours();
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;

  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const time = `${pad(h)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${period}`;

  const el = byId('dateTimeText');
  if (el) el.innerHTML = `<span class="day-name">${day}</span> - <span class="date">${date}</span> - <span class="time">${time}</span>`;
}
function initDateTime() {
  updateDateTime();
  setInterval(updateDateTime, 1000);
}

/* =======================
   🚀 DOMContentLoaded
======================= */
document.addEventListener('DOMContentLoaded', () => {
  nodes.toastContainer = byId('toastContainer');
  initFontSize();
  initResetSettings();
  initDateTime();

  // طباعة
  const printBtn = byId('printBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // اختصار البحث السريع
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const isTyping = /^(INPUT|TEXTAREA|SELECT)$/i.test(tag);
    if (e.key === '/' && !isTyping) { e.preventDefault(); byId('quickSearch')?.focus(); }
  });

  // وصول مودال السيرة: مصيدة تركيز + ESC
  (function () {
    const modal = byId('bioModal');
    if (!modal) return;
    let lastFocus = null;

    function trapKeys(e) {
      if (e.key === 'Escape') { modal.classList.remove('active'); try { lastFocus?.focus(); } catch {} }
      if (e.key === 'Tab') {
        const focusables = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName !== 'class') continue;
        const isOpen = modal.classList.contains('active');
        if (isOpen) {
          lastFocus = document.activeElement;
          setTimeout(() => {
            const firstFocusable = modal.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
            (firstFocusable || modal).focus();
          }, 0);
          modal.addEventListener('keydown', trapKeys);
        } else {
          modal.removeEventListener('keydown', trapKeys);
          try { lastFocus?.focus(); } catch {}
        }
      }
    });
    mo.observe(modal, { attributes: true });
  })();

  // حدث عام عند تجريد الصور بسبب المساحة
  window.addEventListener('FT_PHOTOS_STRIPPED', () => {
    showWarning('تم حفظ البيانات دون الصور بسبب امتلاء التخزين. استخدم صوراً أصغر.');
  });
});

/* =======================
   📦 أدوات ملفات JSON
======================= */
export function downloadJson(obj, filename = 'families-export.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
export function readJsonFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { try { res(JSON.parse(fr.result)); } catch (e) { rej(e); } };
    fr.onerror = rej;
    fr.readAsText(file, 'utf-8');
  });
}