// modalManager.js
// إدارة فتح/إغلاق المودال مع حبس التركيز وقفل التمرير + تحسينات A11y
export const ModalManager = {
  _prevFocus: null,
  _onKey: null,
  _onBackdrop: null,
  _isOpen: false,

  _scrollLock: 0,
  _origOverflow: '',
  _origPadRight: null,

  _bgSiblings: null,

  /* ===================== فتح/إغلاق ===================== */
  open(el, opts = {}) {
    if (!el || this._isOpen) return;
    this._isOpen = true;
    this._prevFocus = document.activeElement;

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
    // فخ تركيز
    this._trapFocus(el);

    // إغلاق بالضغط على الخلفية عند الطلب
    if (opts.backdropClose) {
      this._onBackdrop = (e) => { if (e.target === el) this.close(el); };
      el.addEventListener('mousedown', this._onBackdrop);
      // لمس للهاتف
      el.addEventListener('touchstart', this._onBackdrop, { passive: true });
    }
  },

  close(el) {
    if (!el || !this._isOpen) return;

    el.classList.remove('active');
    el.removeAttribute('aria-modal');
    el.removeAttribute('role');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('aria-describedby');

    if (this._onBackdrop) {
      el.removeEventListener('mousedown', this._onBackdrop);
      el.removeEventListener('touchstart', this._onBackdrop);
      this._onBackdrop = null;
    }

    this._release(el);
    this._removeInert();
    this._unlockScroll();
    this._isOpen = false;
  },

  /* ===================== فخ التركيز ===================== */
  _trapFocus(root) {
    const focusables = Array.from(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(n => !n.hasAttribute('disabled') && n.tabIndex !== -1);

    const first = focusables[0] || root;
    const last  = focusables[focusables.length - 1] || root;

    this._onKey = (e) => {
      if (e.key === 'Escape') {
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
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    root.addEventListener('keydown', this._onKey, { passive: false });
    setTimeout(() => first.focus(), 0);
  },

  _release(root) {
    if (this._onKey && root) root.removeEventListener('keydown', this._onKey);
    this._onKey = null;
    try { this._prevFocus?.focus(); } catch {}
    this._prevFocus = null;
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
