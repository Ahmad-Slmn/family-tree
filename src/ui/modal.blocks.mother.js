// src/ui/modal.blocks.mother.js
// كتلة "الأم": عرض + تحرير + منطق الاسم الإلزامي

import { makeMetaBlock, computeAgeFromBirthDate, formatListForMeta } from './modal.metaBlock.js';

import { attachYearModeToggle } from './modal.yearToggle.js';

/* ======================= ثوابت عرض الأم (labels/icons/keys) ======================= */

const MOTHER_VIEW_LABELS = {
  motherName:         'الاسم',
  motherAge:          'العمر',
  motherCognomen:     'اللقب',
  motherBirthDate:    'تاريخ الميلاد',
  motherDeathDate:    'تاريخ الوفاة',
  motherBirthPlace:   'مكان الميلاد',
  motherOccupation:   'المهنة',
  motherRemark:       'ملاحظة',
  motherTribe:        'القبيلة',
  motherClan:         'العشيرة',
  motherBrothers:     'الإخوة',
  motherSisters:      'الأخوات',
  motherAchievements: 'الإنجازات',
  motherHobbies:      'الهوايات',
};

const MOTHER_VIEW_ICONS = {
  motherName:         'fa-person-dress',
  motherAge:          'fa-hourglass-half',
  motherCognomen:     'fa-signature',
  motherBirthDate:    'fa-cake-candles',
  motherDeathDate:    'fa-book-skull',
  motherBirthPlace:   'fa-location-dot',
  motherOccupation:   'fa-briefcase',
  motherRemark:       'fa-note-sticky',
  motherTribe:        'fa-people-group',
  motherClan:         'fa-users',
  motherBrothers:     'fa-user-group',
  motherSisters:      'fa-user-group',
  motherAchievements: 'fa-trophy',
  motherHobbies:      'fa-heart',
};

const MOTHER_PREVIEW_KEYS = ['motherName', 'motherAge', 'motherBirthPlace', 'motherTribe', 'motherClan'];
const MOTHER_FULL_KEYS = [
  'motherName',
  'motherAge',
  'motherBirthDate',
  'motherDeathDate',
  'motherBirthPlace',
  'motherOccupation',
  'motherCognomen',
  'motherRemark',
  'motherTribe',
  'motherClan',
  'motherBrothers',
  'motherSisters',
  'motherAchievements',
  'motherHobbies',
];


/* ======================= إنشاء كتلة الأم ======================= */

export function createMotherBlock() {
  const row = document.createElement('div');
  row.className = 'mother-row';

  // نفس الـ DOM السابق بدون تغيير
row.innerHTML = `
<label class="label mother-label" for="motherName">
  <i class="fa-solid fa-person-dress"></i> الأم
</label>

<div class="meta-view mother-view">
  <div class="meta-info">
    <div class="mother-grid" data-mode="preview"></div>
  </div>
  <div class="mother-toolbar">
    <button type="button" class="btn tiny meta-toggle-btn" hidden aria-expanded="false"></button>
    <div class="mother-actions">
      <button type="button" class="btn tiny edit-mother-btn">تعديل</button>
    </div>
  </div>
</div>

<div class="mother-edit meta-edit" style="display:none;">
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-person-dress"></i> الاسم<span class="req">*</span></span>
    <input id="motherName" type="text" class="mother-name" name="motherName" placeholder="مثال: عائشة" required>
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
    <input type="text" class="mother-cognomen" name="motherCognomen" placeholder="مثال: أم محمد">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
    <input type="date" class="mother-birthDate" name="motherBirthDate"
           placeholder="YYYY-MM-DD" data-year-toggle="1">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
    <input type="date" class="mother-deathDate" name="motherDeathDate"
           placeholder="YYYY-MM-DD" data-year-toggle="1">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
    <input type="text" class="mother-birthPlace" name="motherBirthPlace" placeholder="مثال: مكة">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
    <input type="text" class="mother-occupation" name="motherOccupation" placeholder="مثال: معلمة">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
    <input type="text" class="mother-remark" name="motherRemark" placeholder="معلومة مختصرة">
  </label>
  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-people-group"></i> القبيلة</span>
    <input type="text" class="mother-tribe" name="motherTribe" placeholder="مثال: قحطان">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-users"></i> العشيرة</span>
    <input type="text" class="mother-clan" name="motherClan" placeholder="مثال: آل سالم">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user-group"></i> الإخوة</span>
    <input type="text" class="mother-brothers" name="motherBrothers" placeholder="مثال: علي، خالد">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-user-group"></i> الأخوات</span>
    <input type="text" class="mother-sisters" name="motherSisters" placeholder="مثال: فاطمة، نورة">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
    <input type="text" class="mother-achievements" name="motherAchievements" placeholder="مثال: حفظ القرآن، العمل الخيري">
  </label>

  <label class="field-inline">
    <span class="label"><i class="fa-solid fa-heart"></i> الهوايات</span>
    <input type="text" class="mother-hobbies" name="motherHobbies" placeholder="مثال: القراءة، التطريز">
  </label>

  <div class="meta-edit-actions">
    <button type="button" class="save-mother-btn"><i class="fa-solid fa-check"></i> حفظ</button>
    <button type="button" class="cancel-mother-btn"><i class="fa-solid fa-xmark"></i> إلغاء</button>
  </div>
</div>
`;
  const grid   = row.querySelector('.mother-grid');
  const toggle = row.querySelector('.meta-toggle-btn');
  const view   = row.querySelector('.mother-view');
  const edit   = row.querySelector('.mother-edit');

  const rail = document.createElement('div');
  rail.className = 'meta-rail';

  const nameEl = edit.querySelector('.mother-name');
  const cgEl   = edit.querySelector('.mother-cognomen');
  const bdEl   = edit.querySelector('.mother-birthDate');
  const ddEl   = edit.querySelector('.mother-deathDate');
  const bpEl   = edit.querySelector('.mother-birthPlace');
  const ocEl   = edit.querySelector('.mother-occupation');
  const rmEl   = edit.querySelector('.mother-remark');
  const tribeEl = edit.querySelector('.mother-tribe');
  const clanEl = edit.querySelector('.mother-clan');
  const brosEl = edit.querySelector('.mother-brothers');
  const sisEl  = edit.querySelector('.mother-sisters');
  const achEl  = edit.querySelector('.mother-achievements');
  const hobEl  = edit.querySelector('.mother-hobbies');

  // الحقول الأخرى (غير الاسم) التي يعتمد عليها شرط الاسم الإلزامي
  const otherInputs = [cgEl, bdEl, ddEl, bpEl, ocEl, rmEl, tribeEl, clanEl, brosEl, sisEl, achEl, hobEl];

  // تفعيل وضع السنة/التاريخ
  attachYearModeToggle(bdEl);
  attachYearModeToggle(ddEl);

  const saveMotherBtn   = row.querySelector('.save-mother-btn');
  const cancelMotherBtn = row.querySelector('.cancel-mother-btn');

  const motherMap = {
    motherName:         nameEl,
    motherCognomen:     cgEl,
    motherBirthDate:    bdEl,
    motherDeathDate:    ddEl,
    motherBirthPlace:   bpEl,
    motherOccupation:   ocEl,
    motherRemark:       rmEl,
    motherTribe:        tribeEl,
    motherClan:         clanEl,
    motherBrothers:     brosEl,
    motherSisters:      sisEl,
    motherAchievements: achEl,
    motherHobbies:      hobEl,
  };

  // شرط: لا يُسمح بتعبئة بيانات الأم بدون اسمها
  (function enforceMotherLive() {
    function run() {
      const nameReq   = (nameEl.value || '').trim();
      const anyFilled = otherInputs.some((el) => el && (el.value || '').trim());
      const need      = anyFilled && !nameReq;

      nameEl.dataset.logicRequired = need ? '1' : '0';

      if (need) {
        nameEl.classList.add('is-invalid');
        nameEl.setAttribute('aria-invalid', 'true');
      } else {
        nameEl.classList.remove('is-invalid');
        nameEl.removeAttribute('aria-invalid');
      }

      try { nameEl.__dirtyToggle?.(); } catch {}
    }

    [nameEl, ...otherInputs].forEach((el) => {
      el.addEventListener('input', run, true);
      el.addEventListener('change', run, true);
    });

    run();
  })();

  const motherBlock = makeMetaBlock({
    row,
    viewEl:    view,
    editEl:    edit,
    gridEl:    grid,
    toggleBtn: toggle,
    railEl:    rail,

    labels:      MOTHER_VIEW_LABELS,
    icons:       MOTHER_VIEW_ICONS,
    visibleKeys: MOTHER_PREVIEW_KEYS,
    fullKeys:    MOTHER_FULL_KEYS,
    datasetMap:  motherMap,
    inputs:      [nameEl, ...otherInputs],

    saveBtn:   saveMotherBtn,
    cancelBtn: cancelMotherBtn,
    editBtn:   row.querySelector('.edit-mother-btn'),

valueTransform(v) {
  const age = computeAgeFromBirthDate(v.motherBirthDate, v.motherDeathDate);
  return {
    motherName:       (v.motherName       || '').trim(),
    motherAge:        age,
    motherCognomen:   (v.motherCognomen   || '').trim(),
    motherBirthDate:  (v.motherBirthDate  || '').trim(),
    motherDeathDate:  (v.motherDeathDate  || '').trim(),
    motherBirthPlace: (v.motherBirthPlace || '').trim(),
    motherOccupation: (v.motherOccupation || '').trim(),
    motherRemark:     (v.motherRemark     || '').trim(),
    motherTribe:      (v.motherTribe      || '').trim(),
    motherClan:       (v.motherClan       || '').trim(),

    // تحويل النصوص المتعددة إلى قوائم نقطية في المعاينة
    motherBrothers:     formatListForMeta(v.motherBrothers),
    motherSisters:      formatListForMeta(v.motherSisters),
    motherAchievements: formatListForMeta(v.motherAchievements),
    motherHobbies:      formatListForMeta(v.motherHobbies),
  };
},

    validate() {
      const nameReq   = (nameEl.value || '').trim();
      const anyFilled = otherInputs.some((el) => el && (el.value || '').trim());

      if (anyFilled && !nameReq) {
        return {
          ok: false,
          firstInvalid: nameEl,
          msg: 'أدخل اسم الأم عند تعبئة أي بيانات أخرى.',
        };
      }
      return { ok: true };
    },
  });

  // حفظ من الحقول ثم إغلاق التحرير وتثبيت الاتساخ
  row.commitFromInputs = function () {
    motherBlock.io.write();
    motherBlock.closeEdit();
    motherBlock.dirtyCtl.setBase();
    motherBlock.render();
  };

  return row;
}
