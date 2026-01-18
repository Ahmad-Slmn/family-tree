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

const PIN_DEFAULTS = { idleSec: 60, vis: '0', sessionMin: 15 };

function readPinState() {
  const pinIdleRaw  = pinGet('pin_idle_seconds', String(PIN_DEFAULTS.idleSec));
  const pinVisRaw   = pinGet('pin_lock_on_visibility', PIN_DEFAULTS.vis);
  const pinSessRaw  = pinGet('pin_session_minutes', String(PIN_DEFAULTS.sessionMin));
  const pinUntilRaw = pinGet('pin_session_until', null);

  // idle: يسمح بـ 0 (مطلقًا)
  let pinIdle = parseInt(pinIdleRaw, 10);
  if (!Number.isFinite(pinIdle) || pinIdle < 0) pinIdle = PIN_DEFAULTS.idleSec;

  const pinVis  = String(pinVisRaw ?? PIN_DEFAULTS.vis);
  let pinSess = parseInt(pinSessRaw, 10);
  if (!Number.isFinite(pinSess) || pinSess <= 0) pinSess = PIN_DEFAULTS.sessionMin;

  const isDefault =
    (pinIdle === PIN_DEFAULTS.idleSec) &&
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
  const minusBtn = byId('fontSizeMinus');
  const plusBtn  = byId('fontSizePlus');
  if (!r) return;

  const min  = parseInt(r.min || '12', 10);
  const max  = parseInt(r.max || '24', 10);
  const step = parseInt(r.step || '1', 10);
  const clamp = (v) => Math.max(min, Math.min(max, v));

  const paint = (v) => {
    r.value = String(v);
    r.setAttribute('aria-valuenow', String(v));
    applyFontSize(v); // يكتب النص + يحفظ في localStorage
  };

  const setSize = (v, showToast = false, force = false) => {
    v = clamp(v);
    const old = currentFontSize;

    if (!force && v === old) return;

    currentFontSize = v;
    paint(v);

    if (showToast) {
      showSuccess(`تم تغيير حجم الخط من ${highlight(old + 'px')} إلى ${highlight(v + 'px')}`);
    }
  };

  // تهيئة من التخزين (إجبار تحديث الواجهة)
  setSize(currentFontSize, false, true);

  r.addEventListener('input', () => {
    const v = parseInt(r.value, 10);
    if (!Number.isFinite(v)) return;
    setSize(v, true);
  });

  minusBtn?.addEventListener('click', (e) => { e.preventDefault(); setSize(currentFontSize - step, true); });
  plusBtn?.addEventListener('click',  (e) => { e.preventDefault(); setSize(currentFontSize + step, true); });
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
// utils.js
export function attachHorizontalSortable({
  container,
  itemSelector,
  ghostClass,
  dragClass,
  onSorted
}) {
  if (!window.Sortable || !container) return;
  if (container._sortableInstance) return;

  // حوّل (string أو array) إلى مصفوفة كلاسات مفصولة بدون فراغات
  const toClassList = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) {
      return v.flatMap(x => String(x || '').trim().split(/\s+/)).filter(Boolean);
    }
    return String(v).trim().split(/\s+/).filter(Boolean);
  };

  const ghostExtra = toClassList(ghostClass);
  const dragExtra  = toClassList(dragClass);

  // لازم نمرّر لSortable token واحد فقط لتجنب InvalidCharacterError
  const GHOST_TOKEN = 'biosec-sortable-ghost';
  const DRAG_TOKEN  = 'biosec-sortable-drag';

  container._sortableInstance = new window.Sortable(container, {
    animation: 150,
    direction: 'horizontal',
    ghostClass: GHOST_TOKEN,
    dragClass: DRAG_TOKEN,
    fallbackOnBody: true,
    swapThreshold: 0.5,

    onStart(evt) {
      const el = evt?.item;
      if (el && dragExtra.length) el.classList.add(...dragExtra);
    },

    onEnd(evt) {
      const el = evt?.item;
      if (el && dragExtra.length) el.classList.remove(...dragExtra);

      const orderedRefs = Array.from(container.querySelectorAll(itemSelector))
        .map((node) => node.dataset.ref)
        .filter(Boolean);

      if (!orderedRefs.length) return;
      if (typeof onSorted === 'function') onSorted(orderedRefs);
    },

    onMove(evt) {
      const ghost = evt?.related;
      if (ghost && ghost.classList && ghost.classList.contains(GHOST_TOKEN)) {
        if (ghostExtra.length) ghost.classList.add(...ghostExtra);
      }
      return true;
    },

    onChange() {
      const ghostEl = container.querySelector(`.${GHOST_TOKEN}`);
      if (ghostEl && ghostExtra.length) ghostEl.classList.add(...ghostExtra);
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
  saveBtnClass = 'image-viewer-save',
  minimalNav = false
} = {}) {
  const modeKey = minimalNav ? '1' : '0';

  // كاش حسب الوضع
  const cached = document.querySelector(`.${overlayClass}[data-minimal="${modeKey}"]`);
  if (cached && cached._sliderApi) return cached._sliderApi;

  // عناصر الـ DOM (Lazy)
  let overlay = null, backdrop = null, dialog = null, closeBtn = null, img = null, nav = null, saveBtn = null;
  let prevBtn = null, nextBtn = null, counter = null;
  let mounted = false;

  // الحالة
  let urls = [], index = 0, lastActiveEl = null, lastIndex = -1;

  // خيارات التشغيل
  let options = { revokeOnClose: false, onClose: null, enableZoom: true };

  const prevTokens = arrowPrevClass.split(/\s+/).filter(c => /prev$/i.test(c));
  const nextTokens = arrowNextClass.split(/\s+/).filter(c => /next$/i.test(c));

  const isOpen = () => !!overlay && overlay.classList.contains('is-open');

  // تكبير/سحب
  let scale = 1, tx = 0, ty = 0, isPanning = false, panStartX = 0, panStartY = 0, panBaseTx = 0, panBaseTy = 0;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function setLoading(v) { if (overlay) overlay.classList.toggle('is-loading', !!v); }

  function applyTransform(skip = false) {
    if (!img) return;
    img.style.transition = skip ? 'none' : 'transform .15s ease';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  function resetTransform() { scale = 1; tx = 0; ty = 0; applyTransform(true); }

  function setScale(nextScale, ax = null, ay = null) {
    if (!img) return;
    const prev = scale;
    nextScale = clamp(nextScale, 1, 4);
    if (nextScale === prev) return;

    if (ax != null && ay != null) {
      const r = img.getBoundingClientRect();
      const dx = ax - (r.left + r.width / 2);
      const dy = ay - (r.top + r.height / 2);
      const ratio = nextScale / prev;
      tx = tx - dx * (ratio - 1);
      ty = ty - dy * (ratio - 1);
    }

    scale = nextScale;
    if (scale === 1) { tx = 0; ty = 0; }
    applyTransform();
  }

  function preload(i) {
    const u = urls[i];
    if (!u) return;
    const pre = new Image();
    pre.decoding = 'async';
    pre.loading = 'eager';
    pre.src = u;
  }

  function runOpenAnimation() {
    if (!dialog) return;
    dialog.style.transition = 'none';
    dialog.style.opacity = '0';
    dialog.style.transform = 'scale(.92) translateY(8px)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      dialog.style.transition = 'opacity .32s ease, transform .32s ease';
      dialog.style.opacity = '1';
      dialog.style.transform = 'scale(1) translateY(0)';
    }));
  }

  function animateImageChange(direction) {
    if (!img) return;
    img.style.transition = 'none';
    img.style.opacity = 0;
    if (scale <= 1) img.style.transform = `translateX(${direction * 40}px) scale(.97)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition = 'opacity .32s ease, transform .32s ease';
      img.style.opacity = 1;
      if (scale <= 1) img.style.transform = 'translateX(0) scale(1)';
      else applyTransform(true);
    }));
  }

  function updateUI() {
    if (!overlay || !img || !urls.length) return;

    setLoading(true);
    img.src = urls[index];

    if (!minimalNav) { preload(index + 1); preload(index - 1); }
    if (minimalNav) return;

    if (counter) counter.textContent = `${index + 1} / ${urls.length}`;

    const single = urls.length <= 1, atFirst = index <= 0, atLast = index >= urls.length - 1;
    if (prevBtn) { prevBtn.disabled = single || atFirst; prevBtn.style.visibility = prevBtn.disabled ? 'hidden' : 'visible'; }
    if (nextBtn) { nextBtn.disabled = single || atLast; nextBtn.style.visibility = nextBtn.disabled ? 'hidden' : 'visible'; }
  }

  function bounceEffect(direction) {
    if (!img) return;
    if (options.enableZoom && scale > 1) return;
    img.style.transition = 'transform .25s ease';
    img.style.transform = `translateX(${direction * 22}px)`;
    setTimeout(() => { if (img) img.style.transform = 'translateX(0)'; }, 150);
  }

  function goPrev() {
    if (index <= 0) { bounceEffect(1); return; }
    const old = index;
    index--;
    resetTransform();
    updateUI();
    if (!minimalNav && old !== -1) animateImageChange(1);
    lastIndex = index;
  }

  function goNext() {
    if (index >= urls.length - 1) { bounceEffect(-1); return; }
    const old = index;
    index++;
    resetTransform();
    updateUI();
    if (!minimalNav && old !== -1) animateImageChange(-1);
    lastIndex = index;
  }

  // =========================
  // Listeners (مراجع ثابتة)
  // =========================
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

  function onSaveClick(e) { e.stopPropagation(); downloadCurrentImage(); }
  function onOverlayClick(e) { if (overlay && e.target === overlay) close(); }

  function getFocusableElements() {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }

  function trapFocus(e) {
    if (!isOpen() || e.key !== 'Tab') return;
    const f = getFocusableElements();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onKeyDown(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (!minimalNav && e.key === 'ArrowLeft') { e.preventDefault(); prevBtn?.click(); }
    else if (!minimalNav && e.key === 'ArrowRight') { e.preventDefault(); nextBtn?.click(); }
  }

  function onNavClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;

    const isPrev =
      prevTokens.some(cls => btn.classList.contains(cls)) ||
      btn.classList.contains('image-viewer-arrow-prev') ||
      btn.classList.contains('story-image-viewer-arrow-prev') ||
      btn.classList.contains('timeline-image-viewer-arrow-prev') ||
      btn.classList.contains('bio-image-viewer-arrow-prev') ||
      btn.classList.contains('sources-image-viewer-arrow-prev');

    const isNext =
      nextTokens.some(cls => btn.classList.contains(cls)) ||
      btn.classList.contains('image-viewer-arrow-next') ||
      btn.classList.contains('story-image-viewer-arrow-next') ||
      btn.classList.contains('timeline-image-viewer-arrow-next') ||
      btn.classList.contains('bio-image-viewer-arrow-next') ||
      btn.classList.contains('sources-image-viewer-arrow-next');

    if (isPrev) goPrev();
    else if (isNext) goNext();
  }

  function onDblClick(e) {
    if (!options.enableZoom) return;
    e.preventDefault();
    if (scale > 1) resetTransform();
    else setScale(2, e.clientX, e.clientY);
  }

  function onWheel(e) {
    if (!options.enableZoom || !isOpen()) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY), step = 0.2;
    setScale(scale + (delta > 0 ? -step : step), e.clientX, e.clientY);
  }

  function onMouseDown(e) {
    if (!options.enableZoom || scale <= 1 || !overlay || !img) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panBaseTx = tx; panBaseTy = ty;
    overlay.classList.add('is-panning');
    img.style.transition = 'none';
  }

  function onMouseMove(e) {
    if (!isPanning) return;
    tx = panBaseTx + (e.clientX - panStartX);
    ty = panBaseTy + (e.clientY - panStartY);
    applyTransform(true);
  }

  function onMouseUp() {
    if (!isPanning || !overlay) return;
    isPanning = false;
    overlay.classList.remove('is-panning');
    applyTransform();
  }

  // سحب للتنقل (الوضع الكامل فقط)
  let dragX = 0, dragging = false;

  function onTouchStart(e) {
    if (!isOpen()) return;
    if (options.enableZoom && scale > 1) return;
    const t = e.touches[0];
    dragging = true;
    dragX = t.clientX;
    if (img) img.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (!dragging || !img) return;
    const t = e.touches[0];
    const dx = t.clientX - dragX;
    img.style.transform = `translateX(${dx}px) scale(.97)`;
    e.preventDefault();
  }

  function onTouchEnd() {
    if (!dragging || !img) return;
    dragging = false;

    const dx = parseFloat(img.style.transform.replace(/[^\-0-9.]/g, '')) || 0;
    img.style.transition = 'transform .25s ease';
    img.style.transform = 'translateX(0)';

    if (dx < -60) goNext();
    else if (dx > 60) goPrev();
  }

  // مراجع ثابتة لليسنرز (عشان removeEventListener يشتغل)
  const onImgLoad = () => setLoading(false);
  const onImgError = () => setLoading(false);

  // =========================
  // Lazy mount / unmount
  // =========================
  function mount() {
    if (mounted && overlay && document.body.contains(overlay)) return;

    overlay = document.createElement('div');
    overlay.className = overlayClass;
    overlay.dataset.minimal = modeKey;
    overlay.classList.add(minimalNav ? 'is-minimal' : 'is-full');

    // اربط الـ api على الـ overlay فور إنشائه (بدون إعادة إسناد mount)
    overlay._sliderApi = api;

    backdrop = document.createElement('div');
    backdrop.className = backdropClass;

    dialog = document.createElement('div');
    dialog.className = dialogClass;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = closeBtnClass;
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'إغلاق المعاينة');

    img = document.createElement('img');
    img.className = imgClass;
    img.alt = 'معاينة الصورة';
    img.decoding = 'async';
    img.loading = 'eager';

    const spinner = document.createElement('div');
    spinner.className = 'image-viewer-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const stage = document.createElement('div');
    stage.className = 'image-viewer-stage';
    stage.append(img, spinner);

    nav = document.createElement('div');
    nav.className = navClass;
    nav.classList.add(minimalNav ? 'is-minimal' : 'is-full');

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = saveBtnClass;
    saveBtn.innerHTML = '<i class="fa-solid fa-download"></i><span>حفظ الصورة</span>';
    saveBtn.setAttribute('aria-label', 'حفظ الصورة');

    prevBtn = nextBtn = counter = null;

    if (minimalNav) {
      nav.append(saveBtn);
    } else {
      prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = arrowPrevClass;
      prevBtn.textContent = '›';
      prevBtn.setAttribute('aria-label', 'الصورة السابقة');

      counter = document.createElement('div');
      counter.className = counterClass;

      nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = arrowNextClass;
      nextBtn.textContent = '‹';
      nextBtn.setAttribute('aria-label', 'الصورة التالية');

      const centerWrap = document.createElement('div');
      centerWrap.className = 'image-viewer-center';
      centerWrap.append(counter, saveBtn);

      nav.append(nextBtn, centerWrap, prevBtn);
    }

    dialog.append(closeBtn, stage, nav);
    overlay.append(backdrop, dialog);
    document.body.appendChild(overlay);

    // إطفاء التحميل عند نجاح/فشل تحميل الصورة
    img.addEventListener('load', onImgLoad);
    img.addEventListener('error', onImgError);

    // ربط الأحداث
    if (!minimalNav) nav.addEventListener('click', onNavClick);
    saveBtn.addEventListener('click', onSaveClick);

    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', onOverlayClick);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', trapFocus);

    img.addEventListener('dblclick', onDblClick);
    overlay.addEventListener('wheel', onWheel, { passive: false });

    img.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    if (!minimalNav) {
      img.addEventListener('touchstart', onTouchStart, { passive: false });
      img.addEventListener('touchmove', onTouchMove, { passive: false });
      img.addEventListener('touchend', onTouchEnd);

      dialog.addEventListener('touchstart', onTouchStart, { passive: false });
      dialog.addEventListener('touchmove', onTouchMove, { passive: false });
      dialog.addEventListener('touchend', onTouchEnd);
    }

    mounted = true;
  }

  function unmount() {
    if (!overlay) return;

    try {
      if (!minimalNav) nav?.removeEventListener('click', onNavClick);
      saveBtn?.removeEventListener('click', onSaveClick);

      backdrop?.removeEventListener('click', close);
      closeBtn?.removeEventListener('click', close);
      overlay?.removeEventListener('click', onOverlayClick);

      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', trapFocus);

      img?.removeEventListener('dblclick', onDblClick);
      overlay?.removeEventListener('wheel', onWheel);

      img?.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      img?.removeEventListener('load', onImgLoad);
      img?.removeEventListener('error', onImgError);

      if (!minimalNav) {
        img?.removeEventListener('touchstart', onTouchStart);
        img?.removeEventListener('touchmove', onTouchMove);
        img?.removeEventListener('touchend', onTouchEnd);

        dialog?.removeEventListener('touchstart', onTouchStart);
        dialog?.removeEventListener('touchmove', onTouchMove);
        dialog?.removeEventListener('touchend', onTouchEnd);
      }
    } catch {}

    try { overlay.remove(); } catch {}

    overlay = backdrop = dialog = closeBtn = img = nav = saveBtn = null;
    prevBtn = nextBtn = counter = null;
    mounted = false;
  }

  // =========================
  // API
  // =========================
  function setMode(nextMinimal) {
    const nextKey = nextMinimal ? '1' : '0';
    if (overlay && overlay.dataset.minimal === nextKey) return;
    return false;
  }

  function setList(list, startIndex = 0, opts = {}) {
    urls = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!urls.length) return;
    options = { ...options, ...opts };
    index = Math.min(Math.max(startIndex, 0), urls.length - 1);
    lastIndex = -1;
    resetTransform();
    updateUI();
  }

  function open(list, startIndex = 0, opts = {}) {
    lastActiveEl = document.activeElement;
    mount(); // يبني الـ overlay عند الطلب
    setList(list, startIndex, opts);

    overlay.classList.add('is-open');
    runOpenAnimation();
    setTimeout(() => { (closeBtn || dialog)?.focus?.(); }, 0);
  }

  function close() {
    if (!overlay || !isOpen()) return;

    dialog.style.transition = 'opacity .28s ease, transform .28s ease';
    dialog.style.opacity = '0';
    dialog.style.transform = 'scale(.92) translateY(8px)';

    setTimeout(() => {
      overlay.classList.remove('is-open');
      setLoading(false);
      resetTransform();

      try { options.onClose?.({ urls: [...urls], index }); } catch {}
      if (options.revokeOnClose) {
        urls.forEach(u => { try { if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u); } catch {} });
      }

      try { lastActiveEl?.focus?.(); } catch {}
      lastActiveEl = null;

      // إزالة الـ overlay بالكامل
      unmount();
    }, 180);
  }

  function destroy() { unmount(); }

  const api = { open, close, setList, setMode, destroy, isOpen };
  return api;
}
