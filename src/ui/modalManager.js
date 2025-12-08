// modalManager.js
// إدارة فتح/إغلاق المودال مع حبس التركيز وقفل التمرير + تحسينات A11y

import { showWarning, highlight } from '../utils.js';

// عدّاد محاولات فتح مودال جديد أثناء وجود مودال مفتوح
let modalBlockAttempts = 0;
// لتجنّب تكرار نفس الرسالة عدة مرات عن نفس الزوج (current/requested)
let lastBlockedKey  = '';
let lastBlockedTime = 0;

document.addEventListener('modal:blocked', (event) => {
  const now      = Date.now();
  const detail   = event?.detail || {};
  const requested = detail.requested;
  const current   = detail.current;

  // دالة صغيرة لاستخراج عنوان المودال (إن وُجد)
  const getTitle = (el) => {
    if (!el) return '';
    const heading =
      el.querySelector('[data-modal-title]') ||
      el.querySelector('.form-modal-header h2') ||
      el.querySelector('h1, h2, h3');
    return (heading && heading.textContent || '').trim();
  };

  // تطبيع عنوان النافذة المطلوبة (بحيث لا نفرّق بين "تعديل" و "إضافة" لعائلة)
  const normalizeRequestedTitle = (raw) => {
    if (!raw) return '';
    const t = raw.trim();
    // أي عنوان من هذا النوع نعرضه بصيغة موحّدة
    if (
      t.includes('إضافة عائلة') ||
      t.includes('إنشاء عائلة') ||
      t.includes('تعديل العائلة') ||
      t.includes('تعديل بيانات العائلة')
    ) {
      return 'تعديل / إنشاء عائلة';
    }
    return t;
  };

  const currentTitleRaw    = getTitle(current);
  const requestedTitleRaw  = getTitle(requested);
  const currentTitle       = currentTitleRaw;
  const requestedTitle     = normalizeRequestedTitle(requestedTitleRaw);

  // مفتاح يعبّر عن نفس الزوج من النوافذ (الحالية + المطلوبة)
  const key = `${currentTitle || ''}::${requestedTitle || ''}`;

  // هل هي نفس النوافذ؟ وهل الفاصل الزمني قصير جدًا (نفس الحركة تقريبًا)؟
  const isSamePair = key && key === lastBlockedKey;
  const isBurst    = isSamePair && (now - lastBlockedTime < 800); // أقل من 800ms نعتبرها تكرارًا مزعجًا

  if (isBurst) {
    // لا نزيد العداد ولا نعرض رسالة جديدة
    return;
  }

  lastBlockedKey  = key;
  lastBlockedTime = now;
  modalBlockAttempts++;

  // اختصار لاستخدام highlight على النصوص المهمة
  const hl = (txt) => txt ? highlight(txt) : '';

const parts = [];

if (currentTitle && requestedTitle) {
  parts.push(
    `تعذّر فتح نافذة ${hl(requestedTitle)} لوجود نافذة السيرة ل ${hl(currentTitle)} مفتوحة.`
  );
} else if (currentTitle) {
  parts.push(
    `لا يمكن فتح نافذة جديدة ما دامت نافذة ${hl(currentTitle)} مفتوحة.`
  );
} else if (requestedTitle) {
  parts.push(
    `لا يمكن فتح نافذة ${hl(requestedTitle)} حاليًا بسبب وجود نافذة أخرى مفتوحة.`
  );
} else {
  parts.push(
    'يوجد نافذة مفتوحة حاليًا، ولا يمكن فتح نافذة إضافية.'
  );
}

// توضيح رسمي مختصر
parts.push('يرجى إغلاق النافذة الحالية قبل المتابعة.');

// عدّاد المحاولات (نص رسمي موجز)
if (modalBlockAttempts > 1) {
parts.push(
  `محاولة مكررة لفتح نافذة جديدة أثناء وجود نافذة مفتوحة مسبقًا (${hl(modalBlockAttempts)}).`
);

}

showWarning(parts.join(' '));

});


export const ModalManager = {
  _prevFocus: null,
  _onKey: null,
  _onBackdrop: null,

  // عدّاد الفتح (تهيئة مستقبلية لدعم stack)
  _openCount: 0,
  _currentModal: null,   // المودال المفتوح حاليًا

  // واجهات استعلام بسيطة تُستخدم خارجًا لمنع فتح مودال جديد
  get isOpen() {
    return this._openCount > 0;
  },
  get currentModal() {
    return this._currentModal;
  },

  _scrollLock: 0,
  _origOverflow: '',
  _origPadRight: null,

  _bgSiblings: null,

   /* ===================== فتح/إغلاق ===================== */
  open(el, opts = {}) {
    if (!el) return;

    // إن كان هناك مودال مختلف مفتوح بالفعل:
    // لا نفتح مودالًا جديدًا، بل نُعيد التركيز على المودال الحالي
    // ونطلق حدثًا عامًا لتعرض الطبقة الأعلى تنبيهًا للمستخدم.
    if (this._openCount > 0 && this._currentModal && this._currentModal !== el) {
      document.dispatchEvent(new CustomEvent('modal:blocked', {
        detail: { requested: el, current: this._currentModal }
      }));
      try { this._currentModal.focus(); } catch {}
      return;
    }

    // إذا كان نفس المودال مطلوبًا مرة أخرى: فقط نُعيد التركيز عليه
    if (this._openCount > 0 && this._currentModal === el) {
      try { this._currentModal.focus(); } catch {}
      return;
    }

    // حاليًا: نسمح بمودال واحد فقط، لكن باستخدام عدّاد لسهولة التطوير لاحقًا
    this._openCount++;
    this._currentModal = el;
    this._prevFocus = document.activeElement;

    // خيارات سلوكية خاصة بالمودال الحالي
    el.__disableEscape   = !!opts.disableEscape;
    el.__disableBackdrop = !!opts.disableBackdrop;

    // سمات ARIA أساسية
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

    // عنوان/وصف أكثر ثباتًا
    const title = el.querySelector('[data-modal-title], h1, h2, h3');
    const desc  = el.querySelector('[data-modal-desc], .modal-body, .modal-content');
    if (title && title.id) el.setAttribute('aria-labelledby', title.id);
    if (desc) {
      if (!desc.id) desc.id = 'modalDesc_' + Math.random().toString(36).slice(2, 8);
      el.setAttribute('aria-describedby', desc.id);
    }

    el.classList.add('active');

    // إعادة موضع التمرير لأعلى في كل مرة يُفتح فيها المودال
    el.scrollTop = 0;
    el.querySelectorAll('.modal-inner, .form-modal-body, .modal-content').forEach(box => {
      if (box && typeof box.scrollTop === 'number') box.scrollTop = 0;
    });

    // تعطيل الخلفية افتراضيًا
    this._applyInert(opts.inertSiblings !== false);

    // قفل التمرير مع تعويض الشريط افتراضيًا
    this._lockScroll(opts.compensateScrollbar !== false);

    // خيار: تحديد عنصر التركيز الأول بسلكتور
    if (typeof opts.initialFocus === 'string') {
      el.__initialFocus = opts.initialFocus;
    } else {
      el.__initialFocus = null;
    }

    // فخ تركيز
    this._trapFocus(el);

    // إغلاق بالضغط على الخلفية عند الطلب (مع حماية من السحب)
    if (opts.backdropClose && !el.__disableBackdrop) {
      let downTarget = null;

      this._onBackdrop = (e) => {
        if (e.type === 'mousedown' || e.type === 'touchstart') {
          downTarget = e.target;
        } else if (e.type === 'mouseup' || e.type === 'touchend') {
          if (downTarget === el && e.target === el) {
            this.close(el);
          }
          downTarget = null;
        }
      };

      el.addEventListener('mousedown', this._onBackdrop);
      el.addEventListener('mouseup', this._onBackdrop);
      el.addEventListener('touchstart', this._onBackdrop, { passive: true });
      el.addEventListener('touchend', this._onBackdrop);
    }
  },

  close(el) {
    if (!el || this._openCount === 0) return;

    el.classList.remove('active');
    el.removeAttribute('aria-modal');
    el.removeAttribute('role');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('aria-describedby');

    if (this._onBackdrop) {
      el.removeEventListener('mousedown', this._onBackdrop);
      el.removeEventListener('mouseup', this._onBackdrop);
      el.removeEventListener('touchstart', this._onBackdrop);
      el.removeEventListener('touchend', this._onBackdrop);
      this._onBackdrop = null;
    }

    this._release(el);
    this._removeInert();
    this._unlockScroll();

    this._openCount = Math.max(0, this._openCount - 1);
    if (this._openCount === 0) {
      this._currentModal = null;
    }
  },

  /* ===================== فخ التركيز ===================== */
  _trapFocus(root) {
    const focusSelector =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(root.querySelectorAll(focusSelector))
      .filter(n => !n.hasAttribute('disabled') && n.tabIndex !== -1);

    const first = focusables[0] || root;
    const last  = focusables[focusables.length - 1] || root;

    this._onKey = (e) => {
      if (e.key === 'Escape') {
        if (root.__disableEscape) return; // لا تفعل شيئًا إذا كان المودال يمنع Escape

        // إن كان للمودال Hook مخصص (مثل requestClose في مودال العائلة) فاستخدمه
        const hook = root.__onEscapeHook;
        if (typeof hook === 'function') {
          e.preventDefault();
          hook();
        } else {
          this.close(root);
        }
        return;
      }

      if (e.key === 'Tab') {
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    root.addEventListener('keydown', this._onKey, { passive: false });

    // تركيز مخصص إن طُلب
    const initial =
      (root.__initialFocus && root.querySelector(root.__initialFocus)) || first;
    setTimeout(() => initial.focus(), 0);
  },

  _release(root) {
    if (this._onKey && root) root.removeEventListener('keydown', this._onKey);
    this._onKey = null;

    const prev = this._prevFocus;
    this._prevFocus = null;

    if (prev && document.contains(prev)) {
      try { prev.focus(); } catch {}
    } else {
      // fallback: ركّز على body أو أول زر رئيسي في الصفحة
      try {
        const mainBtn = document.querySelector('#addFamilyBtn, #searchInput, button, [href]');
        (mainBtn || document.body).focus();
      } catch {}
    }
  },

  /* ===================== تعطيل الخلفية ===================== */
  _applyInert(enable = true) {
    if (!enable) return;
    const body = document.body;
    if (!body || !body.parentElement) return;
    // أشقاء <body>
    this._bgSiblings = Array.from(body.parentElement.children).filter(n => n !== body);
    const canInert = ('inert' in HTMLElement.prototype);
    this._bgSiblings.forEach(n => {
      if (canInert) n.inert = true;
      else n.setAttribute('aria-hidden', 'true');
    });
  },

  _removeInert() {
    if (!this._bgSiblings) return;
    const canInert = ('inert' in HTMLElement.prototype);
    this._bgSiblings.forEach(n => {
      if (canInert) n.inert = false;
      else n.removeAttribute('aria-hidden');
    });
    this._bgSiblings = null;
  },

  /* ===================== قفل التمرير ===================== */
  _lockScroll(compensate = true) {
    if (this._scrollLock++ === 0) {
      this._origOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';

      if (compensate) {
        const hasScrollbar = window.innerWidth > document.documentElement.clientWidth;
        if (hasScrollbar) {
          const pad = parseFloat(getComputedStyle(document.documentElement).paddingRight) || 0;
          const gap = window.innerWidth - document.documentElement.clientWidth;
          this._origPadRight = pad;
          document.documentElement.style.paddingRight = (pad + gap) + 'px';
        }
      }
    }
  },

  _unlockScroll() {
    if (--this._scrollLock <= 0) {
      document.documentElement.style.overflow = this._origOverflow || '';
      if (this._origPadRight != null) {
        document.documentElement.style.paddingRight = this._origPadRight + 'px';
        this._origPadRight = null;
      }
      this._scrollLock = 0;
    }
  },
};