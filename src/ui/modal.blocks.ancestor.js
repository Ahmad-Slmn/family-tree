// src/ui/modal.blocks.ancestor.js
// كتلة "الجد" داخل مودال العائلة: معاينة + تحرير + ترتيب

import { getArabicOrdinal } from '../utils.js';
import { makeMetaBlock, computeAgeFromBirthDate, formatListForMeta } from './modal.metaBlock.js';

import { attachYearModeToggle } from './modal.yearToggle.js';

/* =================== ثوابت معاينة الجد (labels/icons/keys) =================== */

const ANCESTOR_VIEW_LABELS = {
  name:         'الاسم',
  age:          'العمر',
  birthDate:    'تاريخ الميلاد',
  deathDate:    'تاريخ الوفاة',
  birthPlace:   'مكان الميلاد',
  occupation:   'المهنة',
  cognomen:     'اللقب',
  remark:       'ملاحظة',
  achievements: 'الإنجازات',
  hobbies:      'الهوايات',
};

const ANCESTOR_VIEW_ICONS = {
  name:         'fa-user',
  age:          'fa-hourglass-half',
  birthDate:    'fa-cake-candles',
  deathDate:    'fa-book-skull',
  birthPlace:   'fa-location-dot',
  occupation:   'fa-briefcase',
  cognomen:     'fa-signature',
  remark:       'fa-note-sticky',
  achievements: 'fa-trophy',
  hobbies:      'fa-heart',
};

const ANCESTOR_VIEW_VISIBLE_KEYS = ['name', 'age', 'birthPlace'];
const ANCESTOR_VIEW_FULL_KEYS    = [
  'name',
  'age',
  'birthDate',
  'deathDate',
  'birthPlace',
  'occupation',
  'cognomen',
  'remark',
  'achievements',
  'hobbies',
];

/* =================== إنشاء عنصر جد جديد =================== */

export function createAncestorItem(name = '', index = 1) {
  // معرّف فريد لحقل الاسم مربوط بالـ label
  const aid = `anc_${index}_${Date.now()}`;

  const row = document.createElement('div');
  row.className = 'ancestor-row';
  row.dataset.initialIndex = String(index);
row.dataset.generation   = String(index); 

  /* ---------- قالب HTML الأساسي (نفس البنية السابقة) ---------- */

  row.innerHTML = `
<label class="ancestor-label label dnd-handle" for="${aid}">
  <i class="fa-solid fa-grip-lines"></i> الجد ${getArabicOrdinal(index)}
</label>

<div class="meta-view ancestor-view">
  <div class="meta-info">
    <div class="ancestor-grid" data-mode="preview"></div>
  </div>
  <div class="ancestor-toolbar">
    <button type="button" class="btn tiny meta-toggle-btn" hidden aria-expanded="false"></button>
    <div class="ancestor-actions">
      <button type="button" class="btn tiny edit-ancestor-btn">تعديل</button>
      <button type="button" class="btn tiny danger remove-ancestor">حذف</button>
    </div>
  </div>
</div>

<div class="ancestor-edit meta-edit" style="display:none;">

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user"></i> الاسم <span class="req">*</span></span>
    <input id="${aid}" type="text" class="ancestor-name" name="ancestorName" placeholder="مثال: أحمد بن صالح" required>
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
    <input type="date" class="ancestor-birthDate" name="ancestorBirthDate"
           placeholder="YYYY-MM-DD" title="سنة أو تاريخ ميلاد الجد" data-year-toggle="1">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
    <input type="date" class="ancestor-deathDate" name="ancestorDeathDate"
           placeholder="YYYY-MM-DD" title="سنة أو تاريخ وفاة الجد" data-year-toggle="1">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
    <input type="text" class="ancestor-birthPlace" name="ancestorBirthPlace" placeholder="مثال: مكة">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
    <input type="text" class="ancestor-occupation" name="ancestorOccupation" placeholder="مثال: تاجر">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
    <input type="text" class="ancestor-cognomen" name="ancestorCognomen" placeholder="مثال: أبو خالد">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
    <input type="text" class="ancestor-achievements" name="ancestorAchievements" placeholder="مثال: تأسيس المجلس القبلي، بناء المسجد">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-heart"></i> الهوايات</span>
    <input type="text" class="ancestor-hobbies" name="ancestorHobbies" placeholder="مثال: الشعر، الفروسية">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
    <input type="text" class="ancestor-remark" name="ancestorRemark" placeholder="معلومة مختصرة">
  </label>

  <div class="ancestor-edit-actions meta-edit-actions">
    <button type="button" class="save-ancestor-btn"><i class="fa-solid fa-check"></i> حفظ</button>
    <button type="button" class="cancel-ancestor-btn"><i class="fa-solid fa-xmark"></i> إلغاء</button>
  </div>

</div>
`;

  /* ---------- مراجع عناصر المعاينة والتحرير ---------- */

  const labelEl = row.querySelector('.ancestor-label');
  const view    = row.querySelector('.ancestor-view');
  const edit    = row.querySelector('.ancestor-edit');
  const grid    = row.querySelector('.ancestor-grid');
  const toggle  = row.querySelector('.meta-toggle-btn');

  const nameEl = edit.querySelector('.ancestor-name');
  const bdEl   = edit.querySelector('.ancestor-birthDate');
  const ddEl   = edit.querySelector('.ancestor-deathDate');
  const bpEl   = edit.querySelector('.ancestor-birthPlace');
  const ocEl   = edit.querySelector('.ancestor-occupation');
  const cgEl   = edit.querySelector('.ancestor-cognomen');
  const achEl  = edit.querySelector('.ancestor-achievements');
  const hobEl  = edit.querySelector('.ancestor-hobbies');
  const rmEl   = edit.querySelector('.ancestor-remark');

  const saveAncBtn   = row.querySelector('.save-ancestor-btn');
  const cancelAncBtn = row.querySelector('.cancel-ancestor-btn');
  const editAncBtn   = row.querySelector('.edit-ancestor-btn');

  // مجموعة الحقول المستخدمة في makeMetaBlock
  const ancInputs = [nameEl, bdEl, ddEl, bpEl, ocEl, cgEl, achEl, hobEl, rmEl];

  /* ---------- تحسين إمكانية الوصول لمقبض السحب / العنوان ---------- */

  if (labelEl) {
    labelEl.tabIndex = 0;
    labelEl.setAttribute('role', 'button');
    labelEl.title = 'اسحب لإعادة الترتيب أو اضغط Enter للتعديل';
  }

  /* ---------- شريط التحريك لأعلى/أسفل (rail) ---------- */

  const rail = document.createElement('div');
  rail.className = 'meta-rail';
  rail.innerHTML = `
  <div class="anc-move-controls">
    <button type="button" class="move-up"   title="نقل لأعلى"><i class="fa-solid fa-arrow-up"></i></button>
    <button type="button" class="move-down" title="نقل لأسفل"><i class="fa-solid fa-arrow-down"></i></button>
  </div>`;

  /* ---------- year-toggle لحقول التاريخ ---------- */

  [bdEl, ddEl].forEach((el) => attachYearModeToggle(el));

  /* ---------- الاسم الابتدائي لو مرَّر من الخارج ---------- */

  nameEl.value = name || '';

  /* ---------- خريطة الحقول datasetMap ---------- */

  const ancMap = {
    ancestorName:         nameEl,
    ancestorBirthDate:    bdEl,
    ancestorDeathDate:    ddEl,
    ancestorBirthPlace:   bpEl,
    ancestorOccupation:   ocEl,
    ancestorCognomen:     cgEl,
    ancestorAchievements: achEl,
    ancestorHobbies:      hobEl,
    ancestorRemark:       rmEl,
  };

  /* ---------- ربط makeMetaBlock بالجد ---------- */

  const ancBlock = makeMetaBlock({
    row,
    viewEl:    view,
    editEl:    edit,
    gridEl:    grid,
    toggleBtn: toggle,
    railEl:    rail,

    labels:       ANCESTOR_VIEW_LABELS,
    icons:        ANCESTOR_VIEW_ICONS,
    visibleKeys:  ANCESTOR_VIEW_VISIBLE_KEYS,
    fullKeys:     ANCESTOR_VIEW_FULL_KEYS,
    datasetMap:   ancMap,
    inputs:       ancInputs,

    saveBtn:      saveAncBtn,
    cancelBtn:    cancelAncBtn,
    editBtn:      editAncBtn,

    // تحويل قيم الحقول إلى نموذج عرض للمعاينة (مع قوائم نقطية للقيم المتعددة)
    valueTransform(v) {
      const age = computeAgeFromBirthDate(v.ancestorBirthDate, v.ancestorDeathDate);
      return {
        name:         (v.ancestorName        || '').trim(),
        age,
        birthDate:    (v.ancestorBirthDate   || '').trim(),
        deathDate:    (v.ancestorDeathDate   || '').trim(),
        birthPlace:   (v.ancestorBirthPlace  || '').trim(),
        occupation:   (v.ancestorOccupation  || '').trim(),
        cognomen:     (v.ancestorCognomen    || '').trim(),
        remark:       (v.ancestorRemark      || '').trim(),

        achievements: formatListForMeta(v.ancestorAchievements),
        hobbies:      formatListForMeta(v.ancestorHobbies),
      };
    },

  });

  /* ---------- فتح التحرير عند الضغط Enter على الليبل ---------- */

  labelEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ancBlock.openEdit();
    }
  });

  return row;
}
