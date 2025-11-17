// src/ui/modal.dirtyIndicators.js
// مؤشرات الاتساخ (dirty-dot) + مراقبة تغيّر القيم + دعم contenteditable + تخصيص

import { getFieldLabelEl } from './modal.yearToggle.js';

/* نقطة الاتساخ داخل الليبل (توضع في آخر المحتوى بصريًا) */
export function ensureDirtyDot(labelEl){
  if (!labelEl) return null;
  let dot = labelEl.querySelector('.dirty-dot');
  if (!dot){
    dot = document.createElement('span');
    dot.className = 'dirty-dot';
    // إضافة النقطة في آخر الليبل (بعد الأيقونة/النص)
    labelEl.appendChild(dot);
  }
  return dot;
}

/* أخذ لقطة لقيمة الحقل (value/checked/textContent) */
export function snapshotFieldValue(el){
  if (!el) return '';

  if (el.type === 'checkbox' || el.type === 'radio'){
    return !!el.checked;
  }

  if (el.isContentEditable){
    return (el.textContent ?? '').toString().trim();
  }

  return (el.value ?? '').toString().trim();
}

/* تهيئة نظام الاتساخ داخل جذر معيّن */
export function initDirtyIndicators(
  root,
  { selector = 'input,select,textarea,[contenteditable="true"]', onChange } = {}
){
  if (!root) return;

  function makeToggle(el, lbl){
    let rafId = null;

    const update = () => {
      rafId = null;
      if (!lbl) return;

      const current = snapshotFieldValue(el);
      const changed = (current !== el.__initialCaptured);

      const row = lbl.closest('.ancestor-row');
      ensureDirtyDot(lbl);

      const invalid =
        el.classList.contains('is-invalid') ||
        el.getAttribute('aria-invalid') === 'true';

      if (row && row.dataset.orderDirty === '1'){
        lbl.classList.add('dirty-on', 'dot-pending');
        lbl.classList.remove('dot-ok', 'dot-invalid');

        if (typeof onChange === 'function'){
          onChange(el, {
            changed: true,
            invalid,
            pending: true,
            label: lbl,
            dirtyOn: true
          });
        }
        return;
      }

      const dirtyOn = changed || invalid;

      lbl.classList.toggle('dirty-on', dirtyOn);
      lbl.classList.remove('dot-ok', 'dot-invalid', 'dot-pending');

      if (invalid){
        lbl.classList.add('dot-invalid');
      } else if (changed){
        lbl.classList.add('dot-ok');
      }

      if (typeof onChange === 'function'){
        onChange(el, {
          changed,
          invalid,
          pending: false,
          label: lbl,
          dirtyOn
        });
      }
    };

    return function(){
      if (rafId != null) return;
      rafId = requestAnimationFrame(update);
    };
  }

  function wire(el){
    if (!el.matches || !el.matches(selector)) return;

    const lbl = getFieldLabelEl(el);
    if (!lbl) return;

    ensureDirtyDot(lbl);

    if (el.__initialCaptured === undefined){
      el.__initialCaptured = snapshotFieldValue(el);
    }

    if (!el.__dirtyToggle){
      el.__dirtyToggle = makeToggle(el, lbl);
    }

    el.addEventListener('input', el.__dirtyToggle);
    el.addEventListener('change', el.__dirtyToggle);
    el.__dirtyToggle();
  }

  root.__dirtySelector = selector;

  root.querySelectorAll(selector).forEach(wire);

  const moAttr = new MutationObserver((muts) => {
    muts.forEach((m) => {
      const t = m.target;
      if (t && t.matches && t.matches(selector) && t.__dirtyToggle){
        t.__dirtyToggle();
      }
    });
  });
  moAttr.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-invalid']
  });
  root.__dirtyClassMO = moAttr;

  const mo = new MutationObserver((muts) => {
    muts.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.matches && n.matches(selector)) wire(n);
        const inside = n.querySelectorAll ? n.querySelectorAll(selector) : [];
        inside.forEach(wire);
      });
    });
  });
  mo.observe(root, { childList: true, subtree: true });
  root.__dirtyIndicatorsMO = mo;

  root.resetDirtyIndicators = function(){
    const sel = root.__dirtySelector || selector;
    root.querySelectorAll(sel).forEach((el) => {
      el.__initialCaptured = snapshotFieldValue(el);
      const lbl = getFieldLabelEl(el);
      if (lbl){
        lbl.classList.remove('dirty-on', 'dot-ok', 'dot-pending', 'dot-invalid');
      }
    });
  };
}

/* إزالة الربط بحقل واحد */
function unwire(el){
  if (!el) return;
  if (el.__dirtyToggle){
    el.removeEventListener('input', el.__dirtyToggle);
    el.removeEventListener('change', el.__dirtyToggle);
    delete el.__dirtyToggle;
  }
}

/* التخلص من النظام داخل جذر معيّن */
export function disposeDirtyIndicators(root){
  if (!root) return;

  try { root.__dirtyClassMO?.disconnect(); } catch {}
  try { root.__dirtyIndicatorsMO?.disconnect(); } catch {}

  delete root.__dirtyClassMO;
  delete root.__dirtyIndicatorsMO;

  const sel = root.__dirtySelector || 'input,select,textarea,[contenteditable="true"]';
  root.querySelectorAll(sel).forEach(unwire);

  root.resetDirtyIndicators = undefined;
  delete root.__dirtySelector;
}
