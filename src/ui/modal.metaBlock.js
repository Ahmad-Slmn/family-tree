// src/ui/modal.metaBlock.js
// أدوات عامة لقراءة القيم + meta-block (عرض/تحرير) + حساب العمر

import { showInfo, showConfirmModal } from '../utils.js';
import { markGlobalDirty } from './modal.skeleton.js';
import { getLogicalDateValue } from './modal.yearToggle.js';
import { initDirtyIndicators, disposeDirtyIndicators } from './modal.dirtyIndicators.js';

/* ====================== مساعدين عامّين (عرض/Dataset) ====================== */

// قراءة قيمة منطقية من عنصر إدخال (افتراضي)
export const readVal = (el) =>
  (el?.type === 'checkbox' || el?.type === 'radio') ? !!el.checked
    : (el?.value ?? '').toString().trim();

/* تحويل نص مفصول بفواصل/فواصل عربية إلى قائمة HTML لعرض الميتا */
export function formatListForMeta(val){
  const raw = (val || '').toString().trim();
  if (!raw) return '';

  // نجزّئ على الفاصلة العربية أو الإنجليزية
  const parts = raw.split(/[,،]/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return raw; // عنصر واحد فقط ⇒ نتركه كسطر عادي

  return '<ul class="meta-list">' +
    parts.map(p => `<li>${p}</li>`).join('') +
    '</ul>';
}

/* قيمة منطقية عامة لحقل:
   - حقل سنة/تاريخ ⇒ getLogicalDateValue
   - غير ذلك       ⇒ readVal */
function getLogicalFieldValue(el, logicalValueGetter){
  if (!el) return '';
  if (typeof logicalValueGetter === 'function') return logicalValueGetter(el);
  if (el.matches?.('input[data-year-toggle="1"]')) return getLogicalDateValue(el);
  return readVal(el);
}


/* ربط زر حفظ بمدخلاته لإظهار حالة الاتساخ (مع دعم منطق مخصّص للقيمة) */
function bindDirtyButton({ inputs, button, logicalValueGetter }){
  const list = Array.isArray(inputs) ? inputs.filter(Boolean) : [];
  const getVal = (el) => getLogicalFieldValue(el, logicalValueGetter);

  const isDirty = () =>
    list.some((inp) => {
      const base = (inp.__base !== undefined) ? inp.__base : getVal(inp);
      return base !== getVal(inp);
    });

  const setBase = () => {
    list.forEach((inp) => {
      inp.__base = getVal(inp);
    });
  };

  const toggle = () => {
    const d = list.length ? isDirty() : false;
    button.setAttribute('aria-disabled', String(!d));
    button.classList.toggle('is-disabled', !d);
    button.classList.toggle('changed', d);
  };

  list.forEach((inp) => {
    if (inp.__base === undefined) inp.__base = getVal(inp);
    ['input', 'change'].forEach((ev) => inp.addEventListener(ev, toggle));
  });

  toggle();
  return { isDirty, setBase, toggle };
}

/* قراءة/كتابة dataset وفق خريطة مفاتيح → عناصر */
export function makeDatasetIO(row, map){
  return {
    read(){
      const out = {};
      for (const [k, el] of Object.entries(map)){
        out[k] = (row.dataset[k] || readVal(el) || '').trim();
      }
      return out;
    },
    write(){
      for (const [k, el] of Object.entries(map)){
        row.dataset[k] = readVal(el);
      }
    }
  };
}

/* رسم شبكة الميتا مع مفتاح “عرض المزيد” */
export function renderMetaGrid({
  grid,
  toggleBtn,
  labels,
  icons,
  visibleKeys,
  fullKeys,
  values,
  rail = null
}){
  const pick = (keys) =>
    keys
      .map((k) => ({ k, label: labels[k], val: values[k] }))
      .filter((x) => !!x.val);

  const full       = pick(fullKeys);
  const prev       = pick(visibleKeys);
  const needToggle = full.length > prev.length;
  const mode       = grid.dataset.mode === 'full' ? 'full' : 'preview';
  const items      = mode === 'full' ? full : prev;

  grid.innerHTML = items.map((x) => `
    <div class="meta-col">
      <span class="label"><i class="fa-solid ${icons[x.k] || 'fa-circle-info'}"></i> ${x.label}</span>
      <div class="meta-val">${x.val}</div>
    </div>
  `).join('');

  if (rail) grid.appendChild(rail);

  toggleBtn.style.display = needToggle ? '' : 'none';
  toggleBtn.hidden = !needToggle;
  toggleBtn.setAttribute('aria-expanded', mode === 'full');
  toggleBtn.innerHTML =
    mode === 'full' ? '<i class="fa-solid fa-angles-up"></i> إخفاء التفاصيل'
      : '<i class="fa-solid fa-angles-down"></i> عرض المزيد';
}

/* ====================== حساب العمر من تاريخ الميلاد/الوفاة ====================== */

// يدعم:
//  - تاريخ كامل: YYYY-MM-DD
//  - سنة فقط:    YYYY   (عمر تقريبي بالسنوات)
export function computeAgeFromBirthDate(birthIso, deathIso){
  birthIso = (birthIso || '').trim();
  if (!birthIso) return '';

  let y1, m1 = 1, d1 = 1;

  if (/^\d{4}-\d{2}-\d{2}$/.test(birthIso)){
    const parts = birthIso.split('-');
    y1 = parseInt(parts[0], 10);
    m1 = parseInt(parts[1], 10);
    d1 = parseInt(parts[2], 10);
  } else if (/^\d{4}$/.test(birthIso)){
    y1 = parseInt(birthIso, 10);
    m1 = 1;
    d1 = 1;
  } else {
    return '';
  }

  if (!Number.isFinite(y1)) return '';

  let ref = new Date();
  deathIso = (deathIso || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(deathIso)){
    const parts2 = deathIso.split('-');
    const y2 = parseInt(parts2[0], 10);
    const m2 = parseInt(parts2[1], 10);
    const d2 = parseInt(parts2[2], 10);
    const cand = new Date(y2, (m2 || 1) - 1, d2 || 1);
    if (!Number.isNaN(cand.getTime())) ref = cand;
  } else if (/^\d{4}$/.test(deathIso)){
    const y2 = parseInt(deathIso, 10);
    const cand = new Date(y2, 11, 31);
    if (!Number.isNaN(cand.getTime())) ref = cand;
  }

  const born = new Date(y1, (m1 || 1) - 1, d1 || 1);
  if (ref.getTime() < born.getTime()) return '';

  let years = ref.getFullYear() - y1;
  const rm  = ref.getMonth() + 1;
  const rd  = ref.getDate();
  if (rm < (m1 || 1) || (rm === (m1 || 1) && rd < (d1 || 1))) years--;

  if (years >= 1) return years + ' سنة';

  let months = (ref.getFullYear() - y1) * 12 + (rm - (m1 || 1));
  if (rd < (d1 || 1)) months--;
  if (months >= 1) return months + ' شهر';

  const dA = new Date(y1, (m1 || 1) - 1, d1 || 1); dA.setHours(0, 0, 0, 0);
  const dB = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()); dB.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((dB - dA) / (24 * 60 * 60 * 1000)));

  return days === 0 ? 'وُلِد اليوم' : (days + ' يوم');
}

/* ================== محرّر الميتا (حياة التحرير) ================== */

function createMetaEditor({
  row,
  viewEl,
  editEl,
  gridEl,
  inputs,
  saveBtn,
  cancelBtn,
  editBtn,
  datasetMap,
  validate,
  onSaved,
  onCanceled,
  io,
  render
}){
  const dirtyCtl = bindDirtyButton({
    inputs,
    button: saveBtn,
    logicalValueGetter: (el) => getLogicalFieldValue(el)
  });

  initDirtyIndicators(editEl, {
    onChange(){
      // إبقاء زر الحفظ متزامنًا مع أي تغيّر في الحقول أو حالة invalid
      dirtyCtl.toggle();
    }
  });

  let readonly = false;

  function showView(){
    editEl.classList.remove('meta-edit--active');
    viewEl.classList.remove('meta-view--hidden');
    editEl.style.display = 'none';
    viewEl.style.display = '';
    gridEl.dataset.mode = 'preview';
  }

  function showEdit(){
    if (readonly) return;
    viewEl.classList.add('meta-view--hidden');
    editEl.classList.add('meta-edit--active');
    viewEl.style.display = 'none';
    editEl.style.display = 'grid';

    dirtyCtl.setBase();
    dirtyCtl.toggle();

    const first = inputs[0];
    if (first && typeof first.focus === 'function'){
      first.focus();
    }
  }

  function validateRequiredFields(){
    const reqs = Array.from(
      editEl.querySelectorAll('input[required],select[required],textarea[required]')
    );

    const firstEmpty = reqs.find((el) => {
      const hasVal = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked
        : !!(el.value || '').trim();
      return !hasVal;
    });

    if (!firstEmpty) return true;

    firstEmpty.classList.add('is-invalid');
    firstEmpty.setAttribute('aria-invalid', 'true');
    firstEmpty.focus({ preventScroll: false });
    showInfo('أكمل الحقول المطلوبة في هذا القسم أولًا.');
    return false;
  }

  async function handleCancel(){
    if (dirtyCtl.isDirty()){
 const res = await showConfirmModal({
  title: 'إلغاء التعديلات؟',
  message: 'سيتم تجاهل التعديلات غير المحفوظة.',
  variant: 'danger',
  defaultFocus: 'cancel'
});
if (res !== 'confirm') return;

    }

    for (const [k, el] of Object.entries(datasetMap)){
      if (!el) continue;
      const val = (row.dataset[k] ?? '').toString();

      if (el.tagName === 'SELECT') el.value = val || el.value;
      else el.value = val;

      if (el.matches('input[data-year-toggle="1"]')){
        const v = (val || '').trim();
        if (/^\d{4}$/.test(v)){
          el.dataset.yearOnly = v;
          delete el.dataset.fullDate;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)){
          el.dataset.fullDate = v;
          el.dataset.yearOnly = v.slice(0, 4);
        } else {
          delete el.dataset.yearOnly;
          delete el.dataset.fullDate;
        }
      }

      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
      if (el.dataset.logicRequired === '1') el.dataset.logicRequired = '0';

      try { el.__dirtyToggle?.(); } catch {}
    }

    showView();
    render();
    dirtyCtl.setBase();
    dirtyCtl.toggle();

  onCanceled();

  }

  function handleSave(){
    if (!validateRequiredFields()) return;

    if (typeof validate === 'function'){
      const v = validate();
      if (!v?.ok){
        const bad = v?.firstInvalid;
        if (bad){
          bad.classList.add('is-invalid');
          bad.setAttribute('aria-invalid', 'true');
          bad.focus({ preventScroll: false });
        }
        if (v?.msg) showInfo(v.msg);
        return;
      }
    }

    if (!dirtyCtl.isDirty()){
      showInfo('لم يتم إجراء أي تعديل.');
      return;
    }

    io.write();
    showView();
    dirtyCtl.setBase();
    render();

    try { markGlobalDirty(); } catch {}

    onSaved();
  }

  function onFieldChange(){
    // أثناء التحرير، لا حاجة لإعادة بناء المعاينة ما دامت مخفية
    if (viewEl.style.display !== 'none'){
      render();
    }
    dirtyCtl.toggle();
  }

  inputs.forEach((inp) => {
    const ev = (inp.tagName === 'SELECT') ? 'change' : 'input';
    inp.addEventListener(ev, onFieldChange);
  });

  editBtn?.addEventListener('click', showEdit);
  saveBtn.addEventListener('click', handleSave);
  cancelBtn.addEventListener('click', () => { handleCancel(); });

  function setReadonly(flag){
    readonly = !!flag;
    if (readonly){
      showView();
    }
    [editBtn, saveBtn, cancelBtn].forEach((btn) => {
      if (!btn) return;
      btn.toggleAttribute('disabled', readonly);
    });
  }

  function destroy(){
    disposeDirtyIndicators(editEl);
    inputs.forEach((inp) => {
      const ev = (inp.tagName === 'SELECT') ? 'change' : 'input';
      inp.removeEventListener(ev, onFieldChange);
    });
    editBtn?.removeEventListener('click', showEdit);
    saveBtn.removeEventListener('click', handleSave);
    // cancelBtn يستخدم callback مغلّف؛ الإزالة ليست حرجة هنا
  }

  return {
    dirtyCtl,
    openEdit: showEdit,
    closeEdit: showView,
    setReadonly,
    destroy
  };
}

/* ================== مصنع عام لكتل الميتا/التحرير ================== */
/*
  valueTransform(values):
    دالة اختيارية لتحويل القيم قبل العرض في الشبكة
    (مثل إضافة العمر من birth/death أو تنسيقات خاصة).
*/
export function makeMetaBlock({
  row,
  viewEl,
  editEl,
  gridEl,
  toggleBtn,
  railEl = null,
  labels,
  icons,
  visibleKeys,
  fullKeys,
  datasetMap,
  inputs,
  saveBtn,
  cancelBtn,
  editBtn,
  valueTransform = (v) => v,
  onSaved = () => {},
  onCanceled = () => {},
  validate = null
}){
  const io = makeDatasetIO(row, datasetMap);

  function render(){
    const v = valueTransform(io.read());
    renderMetaGrid({
      grid:      gridEl,
      toggleBtn,
      labels,
      icons,
      visibleKeys,
      fullKeys,
      values: v,
      rail: railEl
    });
  }

  gridEl.dataset.mode = 'preview';

  const editor = createMetaEditor({
    row,
    viewEl,
    editEl,
    gridEl,
    inputs,
    saveBtn,
    cancelBtn,
    editBtn,
    datasetMap,
    validate,
    onSaved,
    onCanceled,
    io,
    render
  });

  toggleBtn.addEventListener('click', () => {
    gridEl.dataset.mode = gridEl.dataset.mode === 'full' ? 'preview' : 'full';
    render();
  });

  io.write();
  editor.dirtyCtl.setBase();
  render();

  try {
    const vals = valueTransform(io.read());
    const hasAny = (fullKeys || []).some(
      (k) => (vals?.[k] ?? '').toString().trim()
    );
    if (!hasAny){
      editor.openEdit();
    }
  } catch {}

  return {
    io,
    dirtyCtl: editor.dirtyCtl,
    render,
    openEdit: editor.openEdit,
    closeEdit: editor.closeEdit,
    setReadonly: editor.setReadonly,
    destroy: editor.destroy
  };
}
