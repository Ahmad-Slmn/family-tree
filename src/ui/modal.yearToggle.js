// src/ui/modal.yearToggle.js
// أدوات الليبل + منطق التاريخ (سنة فقط / تاريخ كامل)

//
// 1) الحصول على عنصر الليبل المرتبط بحقل
//
export function getFieldLabelEl(inputEl){
  if (!inputEl) return null;

  const wrap = inputEl.closest?.('.field-inline');
  if (wrap){
    const direct = wrap.querySelector('.label');
    if (direct) return direct;

    const labInWrap = wrap.tagName === 'LABEL' ? wrap : wrap.querySelector('label');
    if (labInWrap) return labInWrap.querySelector('.label') || labInWrap;
  }

  const id = inputEl.id && String(inputEl.id).trim();
  if (id){
    const safe = (s) =>
      (window.CSS && CSS.escape) ? CSS.escape(s)
        : String(s).replace(/([ #.;?+*~'"^$:[\]\\(){}|/])/g, '\\$1');

    const byFor =
      inputEl.ownerDocument.querySelector(`label[for="${safe(id)}"] .label`) ||
      inputEl.ownerDocument.querySelector(`label[for="${safe(id)}"]`);

    if (byFor){
      return byFor.classList?.contains('label')  ? byFor
        : (byFor.querySelector('.label') || byFor);
    }
  }

  const labelledby = inputEl.getAttribute?.('aria-labelledby');
  if (labelledby){
    for (const tid of labelledby.split(/\s+/).filter(Boolean)){
      const el = inputEl.ownerDocument.getElementById(tid);
      if (el) return el;
    }
  }

  const prev = inputEl.previousElementSibling;
  if (prev && (prev.matches('.label') || prev.tagName === 'LABEL')){
    return prev.matches('.label') ? prev : (prev.querySelector('.label') || prev);
  }

  return null;
}

//
// 2) قيمة منطقية لحقل سنة/تاريخ (موحدة للسنة الكاملة أو التاريخ الكامل)
//    تُستخدم في حساب الاتساخ وغيره
//
export function getLogicalDateValue(inputEl){
  if (!inputEl) return '';
  if (!inputEl.matches?.('input[data-year-toggle="1"]')) return (inputEl.value || '').trim();

  const raw = (inputEl.value || '').trim();
  const y   = (inputEl.dataset.yearOnly  || '').trim();
  const d   = (inputEl.dataset.fullDate || '').trim();

  // وضع السنة فقط (type="text")
  if (inputEl.type === 'text'){
    if (/^\d{4}$/.test(raw))           return raw;
    if (/^\d{4}$/.test(y))             return y;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(0, 4);
    return raw || y || d;
  }

  // وضع التاريخ الكامل (type="date")
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d))   return d;
  if (/^\d{4}$/.test(y))               return y;
  return raw || d || y;
}

//
// 3) تبديل حقل التاريخ (تاريخ كامل / سنة فقط)
//
export function attachYearModeToggle(inputEl){
  if (!inputEl || inputEl.__yearToggleBound) return;
  inputEl.__yearToggleBound = true;

  const labelEl = getFieldLabelEl(inputEl);
  if (!labelEl) return;

  let textNode = null;
  for (const n of labelEl.childNodes){
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()){
      textNode = n;
      break;
    }
  }
  if (!textNode){
    textNode = document.createTextNode('');
    labelEl.appendChild(textNode);
  }

  function getFieldKind(){
    const nm = inputEl.name || inputEl.id || '';
    if (nm.includes('Birth') || nm.includes('birth')) return 'birth';
    if (nm.includes('Death') || nm.includes('death')) return 'death';
    return 'generic';
  }

  function getToggleText(mode){
    const kind   = getFieldKind();
    const isYear = (mode === 'year');

    if (kind === 'birth'){
      return isYear ? 'إدخال تاريخ الميلاد' : 'إدخال سنة الميلاد';
    }
    if (kind === 'death'){
      return isYear ? 'إدخال تاريخ الوفاة' : 'إدخال سنة الوفاة';
    }
    return isYear ? 'إدخال التاريخ فقط' : 'إدخال السنة فقط';
  }

  function setLabelText(isYear){
    const kind = getFieldKind();
    let t = '';

    if (kind === 'birth'){
      t = isYear ? 'سنة الميلاد' : 'تاريخ الميلاد';
    } else if (kind === 'death'){
      t = isYear ? 'سنة الوفاة' : 'تاريخ الوفاة';
    } else {
      t = isYear ? 'السنة' : 'التاريخ';
    }

    textNode.textContent = ' ' + t;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'year-toggle-link';
  labelEl.appendChild(btn);

  const DATE_PLACEHOLDER = 'YYYY-MM-DD';
  const YEAR_PLACEHOLDER = 'YYYY';

  function cacheFromCurrent(mode){
    const v        = (inputEl.value || '').trim();
    const prevFull = inputEl.dataset.fullDate || '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(v)){
      inputEl.dataset.fullDate = v;
      if (!inputEl.dataset.yearOnly){
        inputEl.dataset.yearOnly = v.slice(0, 4);
      }
    } else if (/^\d{4}$/.test(v)){
      const prevYearFromFull = prevFull ? prevFull.slice(0, 4) : '';

      if (mode === 'year' && prevFull && v && v !== prevYearFromFull){
        delete inputEl.dataset.fullDate;
      }
      inputEl.dataset.yearOnly = v;
    }
  }

  function toYearMode(){
    cacheFromCurrent('date');

    const y =
      inputEl.dataset.yearOnly ||
      (inputEl.dataset.fullDate &&
       /^\d{4}-\d{2}-\d{2}$/.test(inputEl.dataset.fullDate) ? inputEl.dataset.fullDate.slice(0, 4)
        : '');

    inputEl.type = 'text';
    inputEl.placeholder = YEAR_PLACEHOLDER;
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('pattern', '\\d{4}');
    inputEl.value = y;

    btn.textContent = getToggleText('year');
    btn.dataset.mode = 'year';

    setLabelText(true);
    inputEl.__dirtyToggle?.();
  }

  function toDateMode(){
    cacheFromCurrent('year');

    const full = inputEl.dataset.fullDate;
    const d    = (full && /^\d{4}-\d{2}-\d{2}$/.test(full)) ? full : '';

    inputEl.type = 'date';
    inputEl.placeholder = DATE_PLACEHOLDER;
    inputEl.removeAttribute('inputmode');
    inputEl.removeAttribute('pattern');
    inputEl.value = d;

    btn.textContent = getToggleText('date');
    btn.dataset.mode = 'date';

    setLabelText(false);
    inputEl.__dirtyToggle?.();
  }

  const storedYear = (inputEl.dataset.yearOnly || '').trim();
  const storedFull = (inputEl.dataset.fullDate || '').trim();
  const initialVal = (inputEl.value || '').trim();

  if (/^\d{4}$/.test(storedYear) && !storedFull){
    toYearMode();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(storedFull)){
    inputEl.dataset.fullDate = storedFull;
    inputEl.dataset.yearOnly = storedYear || storedFull.slice(0, 4);
    toDateMode();
  } else if (/^\d{4}$/.test(initialVal)){
    inputEl.dataset.yearOnly = initialVal;
    toYearMode();
  } else {
    if (/^\d{4}-\d{2}-\d{2}$/.test(initialVal)){
      inputEl.dataset.fullDate = initialVal;
      inputEl.dataset.yearOnly = initialVal.slice(0, 4);
    }
    toDateMode();
  }

  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode || 'date';
    if (mode === 'date') toYearMode();
    else                 toDateMode();
  });
}

//
// 4) تهيئة جميع الحقول التي تحمل data-year-toggle="1" داخل جذر معيّن
//
export function initYearOnlyToggles(root){
  if (!root) return;
  const scope = root instanceof HTMLElement ? root : document;
  scope
    .querySelectorAll('input[data-year-toggle="1"]')
    .forEach(attachYearModeToggle);
}
