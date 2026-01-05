// utils.js

/* =========================================================
   1) أدوات DOM عامة + عناصر مشتركة
========================================================= */
export const byId = (id) => document.getElementById(id);

export const nodes = {
  toastContainer: null // يُملأ عند DOMContentLoaded
};

export const createDivLine = (className) =>
  Object.assign(document.createElement('div'), { className });

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

/* =========================================================
   2) أدوات نص آمنة + إبراز
========================================================= */
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const highlight = (text) =>
  `<span style="color:#ffeb3b;font-weight:bold;">${escapeHtml(text)}</span>`;

/* =========================================================
   3) أعداد ترتيبية عربية (مذكر/مؤنث)
========================================================= */
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

// المذكر كافتراضي
export function getArabicOrdinal(n) { return getArabicOrdinalM(n); }

/* =========================================================
   4) Helpers للتخزين + قراءة PIN
========================================================= */
function lsGet(key, def = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v;
  } catch {
    return def;
  }
}

/**
 * قراءة قيمة PIN من PinStore إن كانت ضمن المفاتيح المُدارة،
 * وإلا من localStorage.
 */
function pinGet(k, def = null) {
  const PS = window.__PinStore;
  if (PS?.PERSISTED_KEYS?.has?.(k)) return PS.getSync(k, def);
  return lsGet(k, def);
}

const PIN_DEFAULTS = { idle: 60, vis: '0', sessionMin: 15 };

function readPinState() {
  const pinIdleRaw  = pinGet('pin_idle_minutes', String(PIN_DEFAULTS.idle));
  const pinVisRaw   = pinGet('pin_lock_on_visibility', PIN_DEFAULTS.vis);
  const pinSessRaw  = pinGet('pin_session_minutes', String(PIN_DEFAULTS.sessionMin));
  const pinUntilRaw = pinGet('pin_session_until', null);

  const pinIdle = parseInt(pinIdleRaw, 10) || PIN_DEFAULTS.idle;
  const pinVis  = String(pinVisRaw ?? PIN_DEFAULTS.vis);
  const pinSess = parseInt(pinSessRaw, 10) || PIN_DEFAULTS.sessionMin;

  const isDefault =
    (pinIdle === PIN_DEFAULTS.idle) &&
    (pinVis === PIN_DEFAULTS.vis) &&
    (pinSess === PIN_DEFAULTS.sessionMin) &&
    (pinUntilRaw == null);

  return { isDefault, pinIdle, pinVis, pinSess, pinUntilRaw };
}

/* =========================================================
   5) حالة «إخفاء العائلات الأساسية» + Hook لإرجاعها
========================================================= */
let _hasHiddenCoreFamilies = false;
let _onResetHiddenCore = null;

export function setHasHiddenCoreFamilies(v) { _hasHiddenCoreFamilies = !!v; }
export function getHasHiddenCoreFamilies() { return _hasHiddenCoreFamilies; }
export function setOnResetHiddenCore(fn) { _onResetHiddenCore = (typeof fn === 'function') ? fn : null; }
export function triggerResetHiddenCore() {
  return (typeof _onResetHiddenCore === 'function') ? _onResetHiddenCore() : Promise.resolve();
}

/* =========================================================
   6) إيجاد أول زر "عائلة" ظاهر (لاستنتاج الافتراضي)
========================================================= */
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
function getDefaultFamilyKey() {
  return firstVisibleFamilyBtn()?.dataset.family || null;
}
function getDefaultFamilyLabel() {
  return firstVisibleFamilyBtn()?.textContent?.trim() || 'أول عائلة ظاهرة';
}

/* =========================================================
   7) Toast (يعتمد على nodes.toastContainer)
========================================================= */
const toastIcons = {
  success: '<i class="fa-solid fa-circle-check"></i>',
  error:   '<i class="fa-solid fa-circle-xmark"></i>',
  info:    '<i class="fa-solid fa-circle-info"></i>',
  warning: '<i class="fa-solid fa-triangle-exclamation"></i>'
};

export function getToastNodes() {
  if (nodes.toastContainer) return nodes;
  nodes.toastContainer = byId('toastContainer') || null;
  return nodes;
}

export function toast(msg, type = 'info', duration = 3000) {
  const box = nodes.toastContainer;
  if (!box) return;

  // منع التكرار لنفس النص المعروض
  const tmp = document.createElement('div');
  tmp.innerHTML = String(msg ?? '');
  const incomingText = tmp.textContent || '';

  [...box.children]
    .filter((c) =>
      c.classList.contains('toast') &&
      (c.querySelector('.message')?.textContent || '') === incomingText
    )
    .forEach((e) => e.remove());

  const t = createDivLine(`toast ${type}`);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'icon';
  iconSpan.innerHTML = toastIcons[type] || '';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'message';
  msgSpan.innerHTML = String(msg ?? '');

  t.append(iconSpan, msgSpan);
  box.appendChild(t);

  const start = performance.now();

  function tick(now) {
    if (now - start >= duration) {
      t.style.animation = 'slideOut 0.4s forwards';
      const endAt = performance.now();
      const removeTick = (ts) => {
        if (ts - endAt >= 400) { t.remove(); return; }
        requestAnimationFrame(removeTick);
      };
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

/* =========================================================
   8) نافذة تأكيد عامة
========================================================= */
export function showConfirmModal({
  title = 'تأكيد',
  message = 'هل أنت متأكد؟',
  bodyNode = null,
  preConfirm = null,
  confirmDisabledUntilValid = false,
  onInputValidChange = null,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  variant = 'default',

  // القاعدة: الافتراضي لا يغلق بالخلفية
  closeOnBackdrop = false,

  defaultFocus = 'confirm',

  // القاعدة: Esc مسموح لكن يعتبر Cancel
  closeOnEsc = true,

  // لا نسمح بتغيير closeOnBackdrop إلا بوعي (اختياري)
  _allowUnsafeClose = false
} = {}) {
  const modal = byId('confirmModal');
  const titleEl = byId('confirmTitle');
  const confirmBodyEl = byId('confirmText');
  const yesBtn = byId('confirmYes');
  const noBtn = byId('confirmNo');

  if (!modal || !titleEl || !confirmBodyEl || !yesBtn || !noBtn) {
    console.warn('[showConfirmModal] missing modal elements');
    const ok = window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(ok ? 'confirm' : 'cancel');
  }

  titleEl.textContent = title;

  confirmBodyEl.innerHTML = '';
  if (bodyNode && bodyNode.nodeType === 1) confirmBodyEl.appendChild(bodyNode);
  else confirmBodyEl.textContent = message;

  yesBtn.textContent = confirmText;
  noBtn.textContent = cancelText;

  modal.classList.toggle('danger', variant === 'danger');
  modal.classList.toggle('warning', variant === 'warning');

  // ARIA
  const ariaRole = (arguments[0] && arguments[0]._ariaRole) || 'dialog';
  modal.setAttribute('role', ariaRole);
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'confirmTitle');
  modal.setAttribute('aria-describedby', 'confirmText');

  // alertdialog: ممنوع backdrop دائمًا
  if (ariaRole === 'alertdialog') closeOnBackdrop = false;

  // قفل تخصيص backdropClose افتراضيًا
  if (closeOnBackdrop && !_allowUnsafeClose) closeOnBackdrop = false;

  // إظهار + قفل تمرير الخلفية
  modal.removeAttribute('aria-hidden');
  modal.inert = false;
  document.documentElement.style.overflow = 'hidden';
  modal.classList.add('show');

  const replace = (btn) => {
    const c = btn.cloneNode(true);
    btn.parentNode.replaceChild(c, btn);
    return c;
  };
  const newYes = replace(yesBtn);
  const newNo  = replace(noBtn);

  const prevFocus = document.activeElement;

  const getFocusables = () =>
    Array.from(modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);

  let _resolved = false;
  let _resolve = null;

  function resolveOnce(val) {
    if (_resolved) return;
    _resolved = true;
    _resolve?.(val);
  }

  function cleanup() {
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);

    const active = document.activeElement;
    if (active && modal.contains(active)) active.blur();

    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    modal.inert = true;
    document.documentElement.style.overflow = '';

    try { prevFocus?.focus(); } catch {}
  }

  function onBackdrop(e) {
    if (closeOnBackdrop && e.target === modal) {
      cleanup();
      // القاعدة: backdrop في confirm (إن سُمح) = Cancel
      resolveOnce('cancel');
    }
  }

  function onKey(e) {
    if (e.key === 'Escape' && closeOnEsc) {
      e.preventDefault();
      cleanup();
      // القاعدة: Esc = Cancel
      resolveOnce('cancel');
      return;
    }

    if (e.key === 'Tab') {
      const els = getFocusables();
      if (!els.length) return;

      const first = els[0];
      const last = els[els.length - 1];

      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  modal.addEventListener('click', onBackdrop);
  modal.addEventListener('keydown', onKey);

  const setValid = (ok) => {
    if (!confirmDisabledUntilValid) return;
    if (ok) newYes.removeAttribute('disabled');
    else newYes.setAttribute('disabled', '');
  };
  if (confirmDisabledUntilValid) setValid(false);

  try {
    if (typeof onInputValidChange === 'function') onInputValidChange(setValid);
  } catch {}

  setTimeout(() => (defaultFocus === 'confirm' ? newYes : newNo)?.focus(), 0);

  return new Promise((resolve) => {
    _resolve = resolve;

    newNo.addEventListener('click', () => {
      cleanup();
      resolveOnce('cancel');
    });

    newYes.addEventListener('click', async () => {
      if (confirmDisabledUntilValid && newYes.hasAttribute('disabled')) return;

      if (typeof preConfirm === 'function') {
        try {
          newYes.setAttribute('disabled', '');
          newNo.setAttribute('disabled', '');
          newYes.classList.add('loading');

          const ok = await preConfirm();

          newYes.classList.remove('loading');
          newNo.removeAttribute('disabled');

          if (!ok) {
            if (!confirmDisabledUntilValid) newYes.removeAttribute('disabled');
            return;
          }

          cleanup();
          resolveOnce('confirm');
          return;

        } catch (err) {
          newYes.classList.remove('loading');
          newNo.removeAttribute('disabled');
          if (!confirmDisabledUntilValid) newYes.removeAttribute('disabled');

          console.error('preConfirm error:', err);
          showError('حدث خطأ أثناء تنفيذ العملية. حاول مرة أخرى.');
          return;
        }
      }

      cleanup();
      resolveOnce('confirm');
    });
  });
}

/* =========================================================
   9) إدارة التفضيلات (الثيم/العائلة/الخط)
========================================================= */
export let currentTheme = localStorage.getItem('familyTreeTheme') || 'default';
export function applySavedTheme(theme) {
  document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
  if (theme && theme !== 'default') document.body.classList.add(`theme-${theme}`);

  document.querySelectorAll('.theme-button')
    .forEach((b) => b.classList.toggle('active-theme', b.dataset.theme === theme));

  currentTheme = theme || currentTheme;
  localStorage.setItem('familyTreeTheme', currentTheme);
}

export let currentFamilyKey = localStorage.getItem('selectedFamily') || 'family1';
export function updateFamilyButtons() {
  const sel = localStorage.getItem('selectedFamily') || currentFamilyKey;
  document.querySelectorAll('.family-button')
    .forEach((b) => b.classList.toggle('active-family', b.dataset.family === sel));
}

let currentFontSize = parseInt(localStorage.getItem('siteFontSize')) || 16;
export function applyFontSize(size) {
  document.documentElement.style.fontSize = `${size}px`;
  const el = byId('fontSizeValue');
  if (el) el.textContent = `${size}px`;
  localStorage.setItem('siteFontSize', size);
}

/**
 * حفظ تفضيلات المستخدم مع رسائل Toast
 */
export function persistUserPreferences({ theme, family } = {}, options = {}) {
  const silent = !!(options && options.silent);

  const getName = (type, val) => {
    const sel = type === 'theme'  ? `.theme-button[data-theme="${val}"]`
      : `.family-button[data-family="${val}"]`;

    const b = document.querySelector(sel);
    let txt = b ? (b.textContent || b.title || val).trim() : String(val);
    return txt.replace(/^عائلة:\s*/u, '').trim();
  };

  const applyChange = (type, newVal, oldVal, fn) => {
    if (newVal === oldVal) {
      if (!silent) {
        showInfo(`${type === 'theme' ? 'النمط' : 'العائلة'} ${highlight(getName(type, oldVal))} هي ${type === 'theme' ? 'المفعل' : 'الحالية'} بالفعل`);
      }
      return;
    }

    const oldName = getName(type, oldVal);
    const newName = getName(type, newVal);

    fn(newVal);

    if (!silent) {
      showSuccess(`تم تغيير ${type === 'theme' ? 'النمط' : 'العائلة'} من ${highlight(oldName)} إلى ${highlight(newName)}`);
    }
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

/* =========================================================
   10) إعادة التفضيلات إلى الافتراضي + مودال الاختيارات
========================================================= */
function resetPreferences({ theme = true, family = true, font = true, privacy = false } = {}) {
  const items = [];

  if (theme) {
    localStorage.removeItem('familyTreeTheme');
    localStorage.removeItem('theme');
    localStorage.removeItem('appTheme');

    currentTheme = 'default';

    document.documentElement.classList.remove(
      'theme-corporate',
      'theme-elegant',
      'theme-minimal',
      'theme-royal',
      'theme-dark'
    );

    applySavedTheme(currentTheme);

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

    const r = byId('fontSizeRange');
    if (r) r.value = currentFontSize;

    items.push('حجم الخط');
  }

  if (privacy) {
    // مصدر الحقيقة الوحيد: security.js (PinStore/lsSet)
    window.dispatchEvent(new CustomEvent('FT_RESET_PRIVACY_PREFS'));
    items.push('الخصوصية');
  }

  if (!items.length) { showInfo('لم يتم اختيار أي إعداد لإعادة التعيين.'); return; }
  showSuccess(`تمت إعادة ${items.map(highlight).join(' و ')} إلى الوضع الافتراضي.`);
}

/**
 * بناء خيارات إعادة الضبط DOM آمن (بدون innerHTML للنصوص)
 */
function buildResetOptionsNode(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'reset-options';

  const p = document.createElement('p');
  p.className = 'reset-note';
  p.textContent = 'اختر القيم التي تريد إعادة ضبطها:';
  wrap.appendChild(p);

  opts.forEach((o) => {
    const row = document.createElement('label');
    row.className = 'reset-opt';
    row.dataset.id = o.id;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = o.id;
    input.disabled = !o.changed;
    input.checked = !!o.changed;

    const text = document.createElement('span');
    text.className = 'reset-opt-text';
    text.textContent = o.label;

    const hint = document.createElement('div');
    hint.className = 'reset-opt-hint';
    hint.textContent = o.changed ? '' : (o.info || '');

    row.append(input, text, hint);
    wrap.appendChild(row);
  });

  return wrap;
}

/**
 * مودال اختيار ما الذي سيتم إعادة ضبطه (يعتمد على showConfirmModal)
 * - زر التأكيد يتفعل فقط عند اختيار عنصر واحد على الأقل
 */
async function showResetOptionsModal({ title = 'تأكيد إعادة القيم' } = {}) {
  const themeDefaultLabel =
    document.querySelector('.theme-button[data-theme="default"]')?.textContent?.trim() || 'النمط الرئيسي';

  const familyDefaultLabel = getDefaultFamilyLabel();
  const fontDefaultLabel = '16px';

  const defaultFamilyKey = getDefaultFamilyKey();
  const hasVisibleFamily = !!defaultFamilyKey;

  const pinIsDefault = readPinState().isDefault;

  const opts = [
    {
      id: 'reset_opt_theme',
      changed: currentTheme !== 'default',
      label: `إعادة النمط إلى (${themeDefaultLabel})`,
      info: 'النمط بالفعل على الوضع الافتراضي'
    },
    {
      id: 'reset_opt_font',
      changed: parseInt(currentFontSize) !== 16,
      label: `إعادة حجم الخط إلى (${fontDefaultLabel})`,
      info: 'حجم الخط بالفعل على الوضع الافتراضي'
    },
    {
      id: 'reset_opt_core',
      changed: !!getHasHiddenCoreFamilies(),
      label: 'إظهار العائلات الأساسية المخفية',
      info: 'لا توجد عائلات أساسية مخفية'
    },
    {
      id: 'reset_opt_privacy',
      changed: !pinIsDefault,
      label: 'إعادة تفضيلات الخصوصية',
      info: 'تفضيلات الخصوصية بالفعل على الوضع الافتراضي'
    }
  ];

  if (hasVisibleFamily) {
    opts.push({
      id: 'reset_opt_family',
      changed: currentFamilyKey !== defaultFamilyKey,
      label: `إعادة العائلة الحالية إلى (${familyDefaultLabel})`,
      info: 'العائلة بالفعل على الوضع الافتراضي'
    });
  }

  // عرض المتغيرات أولاً (كما في الأصل)
  opts.sort((a, b) => (b.changed === a.changed ? 0 : (b.changed ? 1 : -1)));

  // تم ترشيح الخيارات لتظهر المتغيرة فقط
  const body = buildResetOptionsNode(opts.filter((o) => o.changed));

  const getSelections = () => ({
    theme:   !!body.querySelector('#reset_opt_theme')?.checked,
    family:  !!body.querySelector('#reset_opt_family')?.checked,
    font:    !!body.querySelector('#reset_opt_font')?.checked,
    core:    !!body.querySelector('#reset_opt_core')?.checked,
    privacy: !!body.querySelector('#reset_opt_privacy')?.checked
  });

  const isAnySelected = () => {
    const s = getSelections();
    return !!(s.theme || s.family || s.font || s.core || s.privacy);
  };

  const res = await showConfirmModal({
    title,
    bodyNode: body,
    confirmText: 'إعادة الضبط',
    cancelText: 'إلغاء',
    variant: 'default',
    confirmDisabledUntilValid: true,
    onInputValidChange: (setValid) => {
      const sync = () => setValid(isAnySelected());
      body.addEventListener('change', sync);
      sync();
    },
    preConfirm: async () => {
      const s = getSelections();
      if (!(s.theme || s.family || s.font || s.core || s.privacy)) {
        showInfo('يرجى اختيار إعداد واحد على الأقل.');
        return false;
      }

      // resetPreferences لا يعالج core، يتم التعامل معه لاحقًا
      resetPreferences({ theme: s.theme, family: s.family, font: s.font, privacy: s.privacy });

      if (s.core) {
        try {
          const restored = await triggerResetHiddenCore();
          window.dispatchEvent(new CustomEvent('FT_VISIBILITY_REFRESH'));

          const info = (restored && typeof restored === 'object') ? restored
            : { count: Number(restored) || 0, labels: [] };

          const n = Number(info.count) || 0;

          if (n === 1) {
            const label = (info.labels && info.labels[0]) || 'العائلة الأساسية';
            showSuccess(`تم إظهار عائلة ${highlight(label)} المخفية.`);
          } else if (n > 1) {
            showSuccess(`تم إظهار ${highlight(String(n))} من العائلات الأساسية المخفية.`);
          } else {
            showSuccess('تم تحديث عرض العائلات الأساسية (لا توجد عائلات مخفية حاليًا).');
          }
        } catch {
          showError('تعذّر إظهار العائلات الأساسية المخفية، حاول مرة أخرى.');
        }
      }

      return true;
    }
  });

return res; // confirm / cancel
}

/* =========================================================
   11) تهيئة عناصر الواجهة (الخط + زر إعادة الضبط)
========================================================= */
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

  btn.addEventListener('click', async () => {
    // 1) مزامنة القيم من التخزين قبل الفحص
    const storedTheme = localStorage.getItem('familyTreeTheme') || 'default';
    const storedFont  = parseInt(localStorage.getItem('siteFontSize') || '16', 10);
    const storedFam   = localStorage.getItem('selectedFamily');

    currentTheme = storedTheme;
    currentFontSize = storedFont;
    if (storedFam != null) currentFamilyKey = storedFam;

    // 2) احسب “الأول الظاهر” آنيًا
    const defKey = getDefaultFamilyKey();
    const familyIsDefault = defKey ? (currentFamilyKey === defKey) : true;

    // 3) فحوصات الافتراضي
    const themeIsDefault = currentTheme === 'default';
    const fontIsDefault  = Number(currentFontSize) === 16;
    const coreIsDefault  = !getHasHiddenCoreFamilies();
    const privacyIsDefault = readPinState().isDefault;

    const isDefault = themeIsDefault && fontIsDefault && familyIsDefault && coreIsDefault && privacyIsDefault;

    if (isDefault) {
      showInfo('تفضيلات الواجهة حالياً على الوضع الافتراضي بالفعل.');
      return;
    }

    const r = await showResetOptionsModal({
      title: 'تأكيد إعادة تفضيلات الواجهة إلى الوضع الافتراضي'
    });

    if (r !== 'confirm') {
      showInfo('تم إلغاء إعادة تفضيلات الواجهة إلى الوضع الافتراضي.');
    }
  });
}

/* =========================================================
   12) DOMContentLoaded: ربط العناصر + اختصارات + مستمعات عامة
========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  nodes.toastContainer = byId('toastContainer');

  initFontSize();
  initResetSettings();

  // اختصار البحث السريع
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const isTyping = /^(INPUT|TEXTAREA|SELECT)$/i.test(tag);
    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      byId('quickSearch')?.focus();
    }
  });

  // وصول مودال السيرة: مصيدة تركيز + ESC
  (function () {
    const modal = byId('bioModal');
    if (!modal) return;

    let lastFocus = null;

    function trapKeys(e) {
      if (e.key === 'Escape') {
        modal.classList.remove('active');
        try { lastFocus?.focus(); } catch {}
      }

      if (e.key === 'Tab') {
        const focusables = modal.querySelectorAll(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

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
            const firstFocusable = modal.querySelector(
              'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
            );
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

/* =========================================================
   13) أدوات ملفات JSON + أدوات مساعدة عامة
========================================================= */
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

export function arraysShallowEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* =========================================================
   14) تنسيقات تاريخ عربية
========================================================= */
export function formatShortDateBadge(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';

  const fmt = new Intl.DateTimeFormat('ar-EG-u-ca-gregory', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return fmt.format(d);
}

const AR_FULL_DATETIME_FMT = new Intl.DateTimeFormat('ar-EG-u-ca-gregory', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

export function formatFullDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return AR_FULL_DATETIME_FMT.format(d);
}

/* =========================================================
   15) Sortable أفقي (مع حفظ instance)
========================================================= */
export function attachHorizontalSortable({
  container,
  itemSelector,
  ghostClass,
  dragClass,
  onSorted
}) {
  if (!window.Sortable || !container) return;
  if (container._sortableInstance) return;

  container._sortableInstance = new window.Sortable(container, {
    animation: 150,
    direction: 'horizontal',
    ghostClass,
    dragClass,
    fallbackOnBody: true,
    swapThreshold: 0.5,
    onEnd() {
      const orderedRefs = Array.from(container.querySelectorAll(itemSelector))
        .map((node) => node.dataset.ref)
        .filter(Boolean);

      if (!orderedRefs.length) return;
      if (typeof onSorted === 'function') onSorted(orderedRefs);
    }
  });
}

/* =========================================================
   16) PIN Hashing (SHA-256 + Salt)
========================================================= */
export function genSalt(bytesLen = 16) {
  const a = new Uint8Array(bytesLen);
  crypto.getRandomValues(a);

  // base64
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}

function _toBase64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export async function sha256Base64(text) {
  const enc = new TextEncoder();
  const data = enc.encode(String(text || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return _toBase64FromBytes(new Uint8Array(hash));
}

export async function hashPin(pin, saltBase64) {
  const salt = String(saltBase64 || '');
  const normalized = String(pin || '').trim();
  return sha256Base64(`pin:${salt}:${normalized}`);
}

/* =========================================================
   17) عارض صور منبثق (Overlay)
========================================================= */
export function createImageViewerOverlay({
  overlayClass = 'image-viewer-overlay',
  backdropClass = 'image-viewer-backdrop',
  dialogClass = 'image-viewer-dialog',
  imgClass = 'image-viewer-img',
  closeBtnClass = 'image-viewer-close',
  navClass = 'image-viewer-nav',
  arrowPrevClass = 'image-viewer-arrow image-viewer-arrow-prev',
  arrowNextClass = 'image-viewer-arrow image-viewer-arrow-next',
  counterClass = 'image-viewer-counter',
  saveBtnClass = 'image-viewer-save'
} = {}) {
  let overlay = document.querySelector(`.${overlayClass}`);
  if (overlay && overlay._sliderApi) return overlay._sliderApi;

  overlay = document.createElement('div');
  overlay.className = overlayClass;

  const backdrop = document.createElement('div');
  backdrop.className = backdropClass;

  const dialog = document.createElement('div');
  dialog.className = dialogClass;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = closeBtnClass;
  closeBtn.textContent = '×';

  const img = document.createElement('img');
  img.className = imgClass;
  img.alt = 'معاينة الصورة';

  const nav = document.createElement('div');
  nav.className = navClass;

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = arrowPrevClass;
  prevBtn.textContent = '›';

  const counter = document.createElement('div');
  counter.className = counterClass;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = saveBtnClass;
  saveBtn.innerHTML = '<i class="fa-solid fa-download"></i><span>حفظ الصورة</span>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = arrowNextClass;
  nextBtn.textContent = '‹';

  const centerWrap = document.createElement('div');
  centerWrap.className = 'image-viewer-center';
  centerWrap.append(counter, saveBtn);

  nav.append(nextBtn, centerWrap, prevBtn);
  dialog.append(closeBtn, img, nav);
  overlay.append(backdrop, dialog);
  document.body.appendChild(overlay);

  let urls = [];
  let index = 0;

  const prevTokens = arrowPrevClass.split(/\s+/).filter((c) => /prev$/i.test(c));
  const nextTokens = arrowNextClass.split(/\s+/).filter((c) => /next$/i.test(c));

  const dialogEl = dialog;

  function runOpenAnimation() {
    dialogEl.style.transition = 'none';
    dialogEl.style.opacity = '0';
    dialogEl.style.transform = 'scale(.92) translateY(8px)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dialogEl.style.transition = 'opacity .32s ease, transform .32s ease';
        dialogEl.style.opacity = '1';
        dialogEl.style.transform = 'scale(1) translateY(0)';
      });
    });
  }

  // updateUI الأساسي
  let updateUI = function () {
    if (!urls.length) return;

    img.src = urls[index];
    counter.textContent = `${index + 1} / ${urls.length}`;

    const single = urls.length <= 1;
    const atFirst = index <= 0;
    const atLast = index >= urls.length - 1;

    prevBtn.disabled = single || atFirst;
    nextBtn.disabled = single || atLast;

    prevBtn.style.visibility = prevBtn.disabled ? 'hidden' : 'visible';
    nextBtn.style.visibility = nextBtn.disabled ? 'hidden' : 'visible';
  };

  // تأثير انتقال الصور + حركة الاتجاه
  let lastIndex = -1;

  function animateImageChange(_newIndex, direction) {
    img.style.transition = 'none';
    img.style.opacity = 0;
    img.style.transform = `translateX(${direction * 40}px) scale(.97)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        img.style.transition = 'opacity .32s ease, transform .32s ease';
        img.style.opacity = 1;
        img.style.transform = 'translateX(0) scale(1)';
      });
    });
  }

  const _updateUI_original = updateUI;
  updateUI = function () {
    const old = lastIndex;
    _updateUI_original();
    if (old !== -1 && old !== index) {
      const dir = index > old ? -1 : 1;
      animateImageChange(index, dir);
    }
    lastIndex = index;
  };

  // Bounce عند حدود الصور
  function bounceEffect(direction) {
    img.style.transition = 'transform .25s ease';
    img.style.transform = `translateX(${direction * 22}px)`;
    setTimeout(() => { img.style.transform = 'translateX(0)'; }, 150);
  }

  function goPrev_original() { index--; updateUI(); }
  function goNext_original() { index++; updateUI(); }

  let goPrev = function () {
    if (index <= 0) { bounceEffect(1); return; }
    goPrev_original();
  };

  let goNext = function () {
    if (index >= urls.length - 1) { bounceEffect(-1); return; }
    goNext_original();
  };

  function open(list, startIndex = 0) {
    urls = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!urls.length) return;

    index = Math.min(Math.max(startIndex, 0), urls.length - 1);
    updateUI();

    overlay.classList.add('is-open');
    runOpenAnimation();
  }

  function closeViewer() {
    dialogEl.style.transition = 'opacity .28s ease, transform .28s ease';
    dialogEl.style.opacity = '0';
    dialogEl.style.transform = 'scale(.92) translateY(8px)';
    setTimeout(() => { overlay.classList.remove('is-open'); }, 180);
  }

  function downloadCurrentImage() {
    if (!urls.length) return;
    const url = urls[index];
    if (!url) return;

    const a = document.createElement('a');
    a.href = url;
    a.download = `image-${index + 1}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // أحداث التنقل
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;

    const isPrev =
      prevTokens.some((cls) => btn.classList.contains(cls)) ||
      btn.classList.contains('image-viewer-arrow-prev') ||
      btn.classList.contains('story-image-viewer-arrow-prev') ||
      btn.classList.contains('timeline-image-viewer-arrow-prev') ||
      btn.classList.contains('bio-image-viewer-arrow-prev') ||
      btn.classList.contains('sources-image-viewer-arrow-prev');

    const isNext =
      nextTokens.some((cls) => btn.classList.contains(cls)) ||
      btn.classList.contains('image-viewer-arrow-next') ||
      btn.classList.contains('story-image-viewer-arrow-next') ||
      btn.classList.contains('timeline-image-viewer-arrow-next') ||
      btn.classList.contains('bio-image-viewer-arrow-next') ||
      btn.classList.contains('sources-image-viewer-arrow-next');

    if (isPrev) goPrev();
    else if (isNext) goNext();
  });

  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadCurrentImage(); });

  backdrop.addEventListener('click', closeViewer);
  closeBtn.addEventListener('click', closeViewer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeViewer(); });

  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('is-open')) return;

    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nextBtn.click(); }
  });

  // السحب الحيّ drag-follow
  let dragX = 0;
  let dragging = false;

  function onTouchStart(e) {
    if (!overlay.classList.contains('is-open')) return;
    const t = e.touches[0];
    dragging = true;
    dragX = t.clientX;
    img.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - dragX;
    img.style.transform = `translateX(${dx}px) scale(.97)`;
    e.preventDefault();
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;

    const dx = parseFloat(img.style.transform.replace(/[^\-0-9.]/g, '')) || 0;
    img.style.transition = 'transform .25s ease';
    img.style.transform = 'translateX(0)';

    if (dx < -60) goNext();
    else if (dx > 60) goPrev();
  }

  img.addEventListener('touchstart', onTouchStart, { passive: false });
  img.addEventListener('touchmove', onTouchMove, { passive: false });
  img.addEventListener('touchend', onTouchEnd);

  dialog.addEventListener('touchstart', onTouchStart, { passive: false });
  dialog.addEventListener('touchmove', onTouchMove, { passive: false });
  dialog.addEventListener('touchend', onTouchEnd);

  const api = { open };
  overlay._sliderApi = api;
  return api;
}