// src/ui/modal.yearToggle.js
// • إضافة زر تبديل (سنة ↔ تاريخ) لحقول الإدخال التي تحمل data-year-toggle="1"
// • توحيد قراءة قيمة التاريخ بشكل “منطقي” (YYYY أو YYYY-MM-DD) للاستخدام في dirty/validation
// • توفير دالة لضبط القيمة وإعادة مزامنة وضع الحقل (مهم في cancel/reset/تحميل بيانات)

const RE_YEAR = /^\d{4}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function escapeCssId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return s.replace(/([ #.;?+*~'"^$:[\]\\(){}|/])/g, '\\$1');
}

function findLabelByFor(inputEl) {
  const id = inputEl?.id && String(inputEl.id).trim();
  if (!id) return null;

  const safeId = escapeCssId(id);
  const doc = inputEl.ownerDocument || document;

  return (
    doc.querySelector(`label[for="${safeId}"] .label`) ||
    doc.querySelector(`label[for="${safeId}"]`)
  );
}

function findLabelByAria(inputEl) {
  const labelledby = inputEl?.getAttribute?.('aria-labelledby');
  if (!labelledby) return null;

  const doc = inputEl.ownerDocument || document;
  for (const tid of labelledby.split(/\s+/).filter(Boolean)) {
    const el = doc.getElementById(tid);
    if (el) return el;
  }
  return null;
}

export function getFieldLabelEl(inputEl) {
  if (!inputEl) return null;

  // 1) داخل نفس wrapper
  const wrap = inputEl.closest?.('.field-inline');
  if (wrap) {
    const direct = wrap.querySelector('.label');
    if (direct) return direct;

    const labInWrap = wrap.tagName === 'LABEL' ? wrap : wrap.querySelector('label');
    if (labInWrap) return labInWrap.querySelector('.label') || labInWrap;
  }

  // 2) label[for="..."]
  const byFor = findLabelByFor(inputEl);
  if (byFor) {
    return byFor.classList?.contains('label') ? byFor : (byFor.querySelector('.label') || byFor);
  }

  // 3) aria-labelledby
  const byAria = findLabelByAria(inputEl);
  if (byAria) return byAria;

  // 4) أخيرًا: العنصر السابق
  const prev = inputEl.previousElementSibling;
  if (prev && (prev.matches('.label') || prev.tagName === 'LABEL')) {
    return prev.matches('.label') ? prev : (prev.querySelector('.label') || prev);
  }
  // دعم biosec-field
  const bioWrap = inputEl.closest?.('.biosec-field');
  if (bioWrap) {
    const bioLabel = bioWrap.querySelector('.biosec-field-head .biosec-field-label');
    if (bioLabel) return bioLabel;
    const bioHead = bioWrap.querySelector('.biosec-field-head');
    if (bioHead) return bioHead;
  }

  return null;
}

export function getLogicalDateValue(inputEl) {
  if (!inputEl) return '';

  const raw = (inputEl.value || '').trim();

  // إذا ليس حقل year-toggle نرجع القيمة كما هي
  if (!inputEl.matches?.('input[data-year-toggle="1"]')) return raw;

  const y = (inputEl.dataset.yearOnly || '').trim();
  const d = (inputEl.dataset.fullDate || '').trim();

  // وضع السنة (type="text"): المستخدم هو مصدر الحقيقة حتى لو كتب قيمة غير قياسية
  if (inputEl.type === 'text') return raw;

  // وضع التاريخ (type="date"): نرجّح التاريخ الكامل إن كان صالحًا
  if (!raw) return '';
  if (RE_DATE.test(raw)) return raw;
  if (RE_DATE.test(d)) return d;
  if (RE_YEAR.test(y)) return y;
  return raw || d || y;
}

export function attachYearModeToggle(inputEl) {
  if (!inputEl || inputEl.__yearToggleBound) return;
  inputEl.__yearToggleBound = true;

  const labelEl = getFieldLabelEl(inputEl);
  if (!labelEl) return;

  // نحتاج عقدة نص داخل الليبل لتحديث “السنة/التاريخ” بدون كسر باقي عناصر الليبل
  let textNode = null;
  for (const n of labelEl.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
      textNode = n;
      break;
    }
  }
  if (!textNode) {
    textNode = document.createTextNode('');
    labelEl.appendChild(textNode);
  }

function getFieldKind() {
  const nm = (inputEl.name || inputEl.id || '').toLowerCase();

  if (nm.includes('birth')) return 'birth';
  if (nm.includes('death')) return 'death';

  if (nm.includes('start')) return 'start';
  if (nm.includes('end')) return 'end';

  return 'generic';
}


function setLabelText(isYear) {
  const kind = getFieldKind();
  let t = '';

  if (kind === 'birth') t = isYear ? 'سنة الميلاد' : 'تاريخ الميلاد';
  else if (kind === 'death') t = isYear ? 'سنة الوفاة' : 'تاريخ الوفاة';
  else if (kind === 'start') t = isYear ? 'سنة البداية' : 'تاريخ البداية';
  else if (kind === 'end') t = isYear ? 'سنة النهاية' : 'تاريخ النهاية';
  else t = isYear ? 'السنة' : 'التاريخ';

  textNode.textContent = ' ' + t;
}


function getToggleText(mode) {
  const kind = getFieldKind();
  const isYear = mode === 'year';

  if (kind === 'birth') return isYear ? 'إدخال تاريخ الميلاد' : 'إدخال سنة الميلاد';
  if (kind === 'death') return isYear ? 'إدخال تاريخ الوفاة' : 'إدخال سنة الوفاة';

  if (kind === 'start') return isYear ? 'إدخال تاريخ البداية' : 'إدخال سنة البداية';
  if (kind === 'end') return isYear ? 'إدخال تاريخ النهاية' : 'إدخال سنة النهاية';

  return isYear ? 'إدخال التاريخ' : 'إدخال السنة';
}

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'year-toggle-link';
  labelEl.appendChild(btn);

  const DATE_PLACEHOLDER = 'YYYY-MM-DD';
  const YEAR_PLACEHOLDER = 'YYYY';

  function cacheFromCurrent(prevMode) {
    const v = (inputEl.value || '').trim();
    const prevFull = inputEl.dataset.fullDate || '';

    if (RE_DATE.test(v)) {
      inputEl.dataset.fullDate = v;
      if (!inputEl.dataset.yearOnly) inputEl.dataset.yearOnly = v.slice(0, 4);
      return;
    }

    if (RE_YEAR.test(v)) {
      const prevYearFromFull = prevFull ? prevFull.slice(0, 4) : '';
      if (prevMode === 'year' && prevFull && v && v !== prevYearFromFull) {
        delete inputEl.dataset.fullDate;
      }
      inputEl.dataset.yearOnly = v;
    }
  }

  function emitProgrammaticChange() {
    // مهم: نُطلق أحداثًا حتى تتحدث أنظمة الاتساخ/التحقق عند تغيير المود برمجيًا
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function toYearMode() {
    cacheFromCurrent('date');

    const y =
      inputEl.dataset.yearOnly ||
      (inputEl.dataset.fullDate && RE_DATE.test(inputEl.dataset.fullDate) ? inputEl.dataset.fullDate.slice(0, 4)
        : '');

    inputEl.type = 'text';
    inputEl.placeholder = YEAR_PLACEHOLDER;
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('pattern', '\\d{4}');
    inputEl.value = y;

    emitProgrammaticChange();

    btn.textContent = getToggleText('year');
    btn.dataset.mode = 'year';

    setLabelText(true);
    inputEl.__dirtyToggle?.();
  }

  function toDateMode() {
    cacheFromCurrent('year');

    const full = inputEl.dataset.fullDate;
    const d = full && RE_DATE.test(full) ? full : '';

    inputEl.type = 'date';
    inputEl.placeholder = DATE_PLACEHOLDER;
    inputEl.removeAttribute('inputmode');
    inputEl.removeAttribute('pattern');
    inputEl.value = d;

    emitProgrammaticChange();

    btn.textContent = getToggleText('date');
    btn.dataset.mode = 'date';

    setLabelText(false);
    inputEl.__dirtyToggle?.();
  }

  // اختيار المود الابتدائي
  const storedYear = (inputEl.dataset.yearOnly || '').trim();
  const storedFull = (inputEl.dataset.fullDate || '').trim();
  const initialVal = (inputEl.value || '').trim();

  if (RE_YEAR.test(storedYear) && !storedFull) {
    toYearMode();
  } else if (RE_DATE.test(storedFull)) {
    inputEl.dataset.fullDate = storedFull;
    inputEl.dataset.yearOnly = storedYear || storedFull.slice(0, 4);
    toDateMode();
  } else if (RE_YEAR.test(initialVal)) {
    inputEl.dataset.yearOnly = initialVal;
    toYearMode();
  } else {
    if (RE_DATE.test(initialVal)) {
      inputEl.dataset.fullDate = initialVal;
      inputEl.dataset.yearOnly = initialVal.slice(0, 4);
    }
    toDateMode();
  }

  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode || 'date';
    if (mode === 'date') toYearMode();
    else toDateMode();
  });
}

// ضبط قيمة حقل year-toggle مع مزامنة المود (سنة/تاريخ) واختيار إطلاق الأحداث من عدمه
export function setYearToggleValue(inputEl, value, { silent = false } = {}) {
  if (!inputEl) return;

  const s = (value == null ? '' : String(value)).trim();

  // إذا ليس حقل year-toggle تعامل معه كحقل عادي
  if (!inputEl.matches?.('input[data-year-toggle="1"]')) {
    inputEl.value = s;
    if (!silent) {
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }

  delete inputEl.dataset.yearOnly;
  delete inputEl.dataset.fullDate;

  if (RE_YEAR.test(s)) {
    inputEl.dataset.yearOnly = s;
  } else if (RE_DATE.test(s)) {
    inputEl.dataset.fullDate = s;
    inputEl.dataset.yearOnly = s.slice(0, 4);
  } else if (s) {
    // قيمة غير قياسية: نضعها في yearOnly لتجنب رفض type="date"
    inputEl.dataset.yearOnly = s;
  }

  attachYearModeToggle(inputEl);

  const wantsDate = !!(inputEl.dataset.fullDate && RE_DATE.test(inputEl.dataset.fullDate));
  const labelEl = getFieldLabelEl(inputEl);
  const btn = labelEl?.querySelector?.('.year-toggle-link') || null;

  if (btn) {
    const curMode = btn.dataset.mode || '';
const targetMode = s ? (wantsDate ? 'date' : 'year') : 'date';
    if (curMode !== targetMode) btn.click();
  } else {
    inputEl.type = wantsDate ? 'date' : 'text';
  }

  inputEl.value = wantsDate ? (inputEl.dataset.fullDate || '') : (inputEl.dataset.yearOnly || '');

  if (!silent) {
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function initYearOnlyToggles(root) {
  if (!root) return;

  const scope = root instanceof HTMLElement ? root : document;
  scope.querySelectorAll('input[data-year-toggle="1"]').forEach(attachYearModeToggle);
}
