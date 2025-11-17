// src/ui/modal.blocks.father.js
// كتلة "الأب": عرض + تحرير + منطق الاسم الإلزامي

import { makeMetaBlock, computeAgeFromBirthDate, formatListForMeta } from './modal.metaBlock.js';
import { attachYearModeToggle } from './modal.yearToggle.js';

/* ======================= ثوابت عرض الأب (labels/icons/keys) ======================= */

const FATHER_VIEW_LABELS = {
  name:         'الاسم',
  age:          'العمر',
  cognomen:     'اللقب',
  birthDate:    'تاريخ الميلاد',
  deathDate:    'تاريخ الوفاة',
  birthPlace:   'مكان الميلاد',
  occupation:   'المهنة',
  remark:       'ملاحظة',
  achievements: 'الإنجازات',
  hobbies:      'الهوايات',
  brothers:     'الإخوة',
  sisters:      'الأخوات',
};

const FATHER_VIEW_ICONS = {
  name:         'fa-user',
  age:          'fa-hourglass-half',
  cognomen:     'fa-signature',
  birthDate:    'fa-cake-candles',
  deathDate:    'fa-book-skull',
  birthPlace:   'fa-location-dot',
  occupation:   'fa-briefcase',
  remark:       'fa-note-sticky',
  achievements: 'fa-trophy',
  hobbies:      'fa-heart',
  brothers:     'fa-user-group',
  sisters:      'fa-user-group',
};

const FATHER_PREVIEW_KEYS = ['name', 'age', 'birthPlace', 'occupation'];
const FATHER_FULL_KEYS    = [
  'name',
  'age',
  'birthPlace',
  'occupation',
  'birthDate',
  'deathDate',
  'cognomen',
  'remark',
  'achievements',
  'hobbies',
  'brothers',
  'sisters',
];

/* ======================= منطق الاسم الإلزامي للأب ======================= */
/* لا يُسمح بتعبئة أي حقل من حقول الأب إذا كان الاسم فارغًا */

function enforceFatherLive(nameEl, others) {
  function run() {
    const anyFilled = others.some((el) => el && (el.value || '').trim());
    const need      = anyFilled && !(nameEl.value || '').trim();

    nameEl.dataset.logicRequired = need ? '1' : '0';
    nameEl.classList.toggle('is-invalid', need);

    if (need) {
      nameEl.setAttribute('aria-invalid', 'true');
    } else {
      nameEl.removeAttribute('aria-invalid');
    }

    // ربط مع نظام الاتساخ إن وُجد
    nameEl.__dirtyToggle?.();
  }

  const all = [nameEl, ...others];
  all.forEach((el) => {
    el.addEventListener('input',  run, true);
    el.addEventListener('change', run, true);
  });

  run();
}

/* ======================= إنشاء كتلة الأب ======================= */

export function createFatherBlock() {
  const row = document.createElement('div');
  row.className = 'father-row';

  // نفس الـ DOM السابق بدون تغيير
  row.innerHTML = `
<label class="label father-label dnd-handle" for="fatherName">
  <i class="fa-solid fa-user-tie"></i> الأب
</label>

<div class="meta-view father-view">
  <div class="meta-info">
    <div class="father-grid" data-mode="preview"></div>
  </div>
  <div class="father-toolbar">
    <button type="button" class="btn tiny meta-toggle-btn" hidden aria-expanded="false"></button>
    <div class="father-actions">
      <button type="button" class="btn tiny edit-father-btn">تعديل</button>
    </div>
  </div>
</div>

<div class="father-edit meta-edit" style="display:none;">
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user"></i> الاسم<span class="req">*</span></span>
    <input id="fatherName" type="text" class="father-name" name="fatherName" placeholder="مثال: عبد الله" required>
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
    <input type="text" class="father-cognomen" name="fatherCognomen" placeholder="مثال: أبو محمد">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
    <input type="date" class="father-birthDate" name="fatherBirthDate"
           placeholder="YYYY-MM-DD" data-year-toggle="1">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
    <input type="date" class="father-deathDate" name="fatherDeathDate"
           placeholder="YYYY-MM-DD" data-year-toggle="1">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
    <input type="text" class="father-birthPlace" name="fatherBirthPlace" placeholder="مثال: الرياض">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
    <input type="text" class="father-occupation" name="fatherOccupation" placeholder="مثال: موظف">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
    <input type="text" class="father-remark" name="fatherRemark" placeholder="معلومة مختصرة">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
    <input type="text" class="father-achievements" name="fatherAchievements" placeholder="مثال: حفظ القرآن، إمام مسجد">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-heart"></i> الهوايات</span>
    <input type="text" class="father-hobbies" name="fatherHobbies" placeholder="مثال: القراءة، السفر">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user-group"></i> الإخوة</span>
    <input type="text" class="father-brothers" name="fatherBrothers" placeholder="مثال: علي، خالد">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user-group"></i> الأخوات</span>
    <input type="text" class="father-sisters" name="fatherSisters" placeholder="مثال: فاطمة، نورة">
  </label>

  <div class="meta-edit-actions">
    <button type="button" class="save-father-btn"><i class="fa-solid fa-check"></i> حفظ</button>
    <button type="button" class="cancel-father-btn"><i class="fa-solid fa-xmark"></i> إلغاء</button>
  </div>
</div>
`;

  const grid   = row.querySelector('.father-grid');
  const toggle = row.querySelector('.meta-toggle-btn');
  const view   = row.querySelector('.father-view');
  const edit   = row.querySelector('.father-edit');

  const rail = document.createElement('div');
  rail.className = 'meta-rail';

  const q = (sel) => edit.querySelector(sel);

  const nameEl = q('.father-name');
  const cgEl   = q('.father-cognomen');
  const bdEl   = q('.father-birthDate');
  const ddEl   = q('.father-deathDate');
  const bpEl   = q('.father-birthPlace');
  const ocEl   = q('.father-occupation');
  const rmEl   = q('.father-remark');
  const achEl  = q('.father-achievements');
  const hobEl  = q('.father-hobbies');
  const brosEl = q('.father-brothers');
  const sisEl  = q('.father-sisters');

  const otherInputs = [cgEl, bdEl, ddEl, bpEl, ocEl, rmEl, achEl, hobEl, brosEl, sisEl];
  const allInputs   = [nameEl, ...otherInputs];

  // تفعيل وضع السنة/التاريخ
  attachYearModeToggle(bdEl);
  attachYearModeToggle(ddEl);

  // شرط الاسم الإلزامي
  enforceFatherLive(nameEl, otherInputs);

  const saveFatherBtn   = row.querySelector('.save-father-btn');
  const cancelFatherBtn = row.querySelector('.cancel-father-btn');

  const fatherMap = {
    fatherName:         nameEl,
    fatherCognomen:     cgEl,
    fatherBirthDate:    bdEl,
    fatherDeathDate:    ddEl,
    fatherBirthPlace:   bpEl,
    fatherOccupation:   ocEl,
    fatherRemark:       rmEl,
    fatherAchievements: achEl,
    fatherHobbies:      hobEl,
    fatherBrothers:     brosEl,
    fatherSisters:      sisEl,
  };

  const fatherBlock = makeMetaBlock({
    row,
    viewEl:    view,
    editEl:    edit,
    gridEl:    grid,
    toggleBtn: toggle,
    railEl:    rail,

    labels:      FATHER_VIEW_LABELS,
    icons:       FATHER_VIEW_ICONS,
    visibleKeys: FATHER_PREVIEW_KEYS,
    fullKeys:    FATHER_FULL_KEYS,
    datasetMap:  fatherMap,
    inputs:      allInputs,

    saveBtn:     saveFatherBtn,
    cancelBtn:   cancelFatherBtn,
    editBtn:     row.querySelector('.edit-father-btn'),

    // تحويل قيم الحقول إلى نموذج العرض (مع قوائم نقطية للقيم المتعددة)
    valueTransform(v) {
      const age = computeAgeFromBirthDate(v.fatherBirthDate, v.fatherDeathDate);
      return {
        name:         (v.fatherName         || '').trim(),
        age,
        cognomen:     (v.fatherCognomen     || '').trim(),
        birthDate:    (v.fatherBirthDate    || '').trim(),
        deathDate:    (v.fatherDeathDate    || '').trim(),
        birthPlace:   (v.fatherBirthPlace   || '').trim(),
        occupation:   (v.fatherOccupation   || '').trim(),
        remark:       (v.fatherRemark       || '').trim(),

        achievements: formatListForMeta(v.fatherAchievements),
        hobbies:      formatListForMeta(v.fatherHobbies),
        brothers:     formatListForMeta(v.fatherBrothers),
        sisters:      formatListForMeta(v.fatherSisters),
      };
    },


    // التحقق النهائي عند الحفظ
    validate() {
      const nameReq   = (nameEl.value || '').trim();
      const anyFilled = otherInputs.some((el) => el && (el.value || '').trim());

      if (anyFilled && !nameReq) {
        return {
          ok: false,
          firstInvalid: nameEl,
          msg: 'أدخل اسم الأب عند تعبئة أي بيانات أخرى.',
        };
      }
      return { ok: true };
    },
  });

  // حفظ من الحقول ثم إغلاق التحرير وتثبيت الاتساخ
  row.commitFromInputs = function () {
    fatherBlock.io.write();
    fatherBlock.closeEdit();
    fatherBlock.dirtyCtl.setBase();
    fatherBlock.render();
  };

  return row;
}
