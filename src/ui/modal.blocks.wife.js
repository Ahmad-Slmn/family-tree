// src/ui/modal.blocks.wife.js
// كتلة "الزوجة" + أب/أم الزوجة + الإضافة السريعة للأطفال

import { el, getArabicOrdinalF } from '../utils.js';
import { makeMetaBlock, computeAgeFromBirthDate, formatListForMeta } from './modal.metaBlock.js';

import { attachYearModeToggle } from './modal.yearToggle.js';
import { markGlobalDirty } from './modal.skeleton.js';
import { updateChildrenCount } from './modal.blocks.child.js';
import { initDirtyIndicators } from './modal.dirtyIndicators.js';

/* ======================= ثوابت عامة لحقول الزوجة ======================= */

const WIFE_PLACEHOLDERS = {
  'wife-name':         'مثال: فاطمة بنت محمد',
  'wife-tribe':        'مثال: قحطان',
  'wife-clan':         'مثال: آل سعيد',
  'wife-birthDate':    'YYYY أو YYYY-MM-DD',
  'wife-deathDate':    'YYYY أو YYYY-MM-DD',
  'wife-birthPlace':   'مثال: مكة',
  'wife-cognomen':     'مثال: أم أحمد',
  'wife-occupation':   'مثال: معلمة',
  'wife-remark':       'معلومة مختصرة',
  'wife-brothers':     'مثال: علي، خالد',
  'wife-sisters':      'مثال: فاطمة، نورة',
  'wife-achievements': 'مثال: الحصول على الدكتوراه، جائزة المعلم المتميز',
  'wife-hobbies':      'مثال: القراءة، السفر'
};

const WIFE_ICONS = {
  'wife-name':         'fa-person-dress',
  'wife-tribe':        'fa-people-group',
  'wife-clan':         'fa-users-rectangle',
  'wife-birthDate':    'fa-cake-candles',
  'wife-deathDate':    'fa-book-skull',
  'wife-birthPlace':   'fa-location-dot',
  'wife-cognomen':     'fa-signature',
  'wife-occupation':   'fa-briefcase',
  'wife-remark':       'fa-note-sticky',
  'wife-brothers':     'fa-user-group',
  'wife-sisters':      'fa-user-group',
  'wife-achievements': 'fa-trophy',
  'wife-hobbies':      'fa-heart'
};

const WIFE_FIELDS = [
  ['wife-name',         'اسم الزوجة',  true,  'text'],
  ['wife-tribe',        'القبيلة',     false, 'text'],
  ['wife-clan',         'العشيرة',     false, 'text'],
  ['wife-birthDate',    'تاريخ الميلاد', false, 'date'],
  ['wife-deathDate',    'تاريخ الوفاة',  false, 'date'],
  ['wife-birthPlace',   'مكان الميلاد', false, 'text'],
  ['wife-cognomen',     'اللقب',        false, 'text'],
  ['wife-occupation',   'المهنة',       false, 'text'],
  ['wife-remark',       'ملاحظة',       false, 'text'],
  ['wife-brothers',     'الإخوة',       false, 'text'],
  ['wife-sisters',      'الأخوات',      false, 'text'],
  ['wife-achievements', 'الإنجازات',    false, 'text'],
  ['wife-hobbies',      'الهوايات',     false, 'text']
];

/* ======================= ثوابت ميتا الأب ======================= */

const WIFE_FATHER_VIEW_LABELS = {
  name:         'الاسم',
  age:          'العمر',
  birthDate:    'تاريخ الميلاد',
  deathDate:    'تاريخ الوفاة',
  birthPlace:   'مكان الميلاد',
  occupation:   'المهنة',
  cognomen:     'اللقب',
  remark:       'ملاحظة',
  clan:         'العشيرة',
  brothers:     'الإخوة',
  sisters:      'الأخوات',
  achievements: 'الإنجازات',
  hobbies:      'الهوايات'
};

const WIFE_FATHER_VIEW_ICONS = {
  name:         'fa-user-tie',
  age:          'fa-hourglass-half',
  birthDate:    'fa-cake-candles',
  deathDate:    'fa-book-skull',
  birthPlace:   'fa-location-dot',
  occupation:   'fa-briefcase',
  cognomen:     'fa-signature',
  remark:       'fa-note-sticky',
  clan:         'fa-users',
  brothers:     'fa-user-group',
  sisters:      'fa-user-group',
  achievements: 'fa-trophy',
  hobbies:      'fa-heart'
};

const WIFE_FATHER_PREV_KEYS = ['name', 'age', 'birthPlace'];
const WIFE_FATHER_FULL_KEYS = [
  'name',
  'age',
  'birthDate',
  'deathDate',
  'birthPlace',
  'occupation',
  'cognomen',
  'remark',
  'clan',
  'brothers',
  'sisters',
  'achievements',
  'hobbies'
];

const WIFE_FATHER_VIEW_KEYMAP = {
  name:         'wifeFatherName',
  birthDate:    'wifeFatherBirthDate',
  deathDate:    'wifeFatherDeathDate',
  birthPlace:   'wifeFatherBirthPlace',
  occupation:   'wifeFatherOccupation',
  cognomen:     'wifeFatherCognomen',
  remark:       'wifeFatherRemark',
  clan:         'wifeFatherClan',
  brothers:     'wifeFatherBrothers',
  sisters:      'wifeFatherSisters',
  achievements: 'wifeFatherAchievements',
  hobbies:      'wifeFatherHobbies'
};

/* ======================= ثوابت ميتا الأم ======================= */

const WIFE_MOTHER_VIEW_LABELS = {
  name:         'الاسم',
  age:          'العمر',
  birthDate:    'تاريخ الميلاد',
  deathDate:    'تاريخ الوفاة',
  birthPlace:   'مكان الميلاد',
  occupation:   'المهنة',
  cognomen:     'اللقب',
  remark:       'ملاحظة',
  clan:         'العشيرة',
  brothers:     'الإخوة',
  sisters:      'الأخوات',
  achievements: 'الإنجازات',
  hobbies:      'الهوايات'
};

const WIFE_MOTHER_VIEW_ICONS = {
  name:         'fa-person-dress',
  age:          'fa-hourglass-half',
  birthDate:    'fa-cake-candles',
  deathDate:    'fa-book-skull',
  birthPlace:   'fa-location-dot',
  occupation:   'fa-briefcase',
  cognomen:     'fa-signature',
  remark:       'fa-note-sticky',
  clan:         'fa-users',
  brothers:     'fa-user-group',
  sisters:      'fa-user-group',
  achievements: 'fa-trophy',
  hobbies:      'fa-heart'
};

const WIFE_MOTHER_PREV_KEYS = ['name', 'age', 'birthPlace'];
const WIFE_MOTHER_FULL_KEYS = [
  'name',
  'age',
  'birthDate',
  'deathDate',
  'birthPlace',
  'occupation',
  'cognomen',
  'remark',
  'clan',
  'brothers',
  'sisters',
  'achievements',
  'hobbies'
];

const WIFE_MOTHER_VIEW_KEYMAP = {
  name:         'wifeMotherName',
  birthDate:    'wifeMotherBirthDate',
  deathDate:    'wifeMotherDeathDate',
  birthPlace:   'wifeMotherBirthPlace',
  occupation:   'wifeMotherOccupation',
  cognomen:     'wifeMotherCognomen',
  remark:       'wifeMotherRemark',
  clan:         'wifeMotherClan',
  brothers:     'wifeMotherBrothers',
  sisters:      'wifeMotherSisters',
  achievements: 'wifeMotherAchievements',
  hobbies:      'wifeMotherHobbies'
};

/* ======================= بناء أجزاء الـ HTML ======================= */

// شبكة حقول الزوجة نفسها
function buildWifeMainHTML() {
  return `
  <div class="wife-grid">
${WIFE_FIELDS.map(([cls, label, req, type]) => {
  const isDate = (cls === 'wife-birthDate' || cls === 'wife-deathDate');
  const yearToggleAttr = isDate ? ' data-year-toggle="1"' : '';
  return `
    <label class="field-inline">
      <span class="label"><i class="fa-solid ${WIFE_ICONS[cls] || 'fa-circle-info'}"></i> ${label}${req ? '<span class="req">*</span>' : ''}</span>
      <input class="${cls}" name="${cls}[]" type="${type || 'text'}"
             placeholder="${WIFE_PLACEHOLDERS[cls] || ''}"${yearToggleAttr} ${req ? 'required' : ''}/>
    </label>`;
}).join('')}
  </div>`;
}

// ميتا أب الزوجة (نفس الـ HTML السابق مفصول في دالة)
function buildWifeFatherHTML(index) {
  return `
  <!-- ميتا أب الزوجة -->
  <div class="wife-father-row">
    <label class="label wife-father-label" for="wifeFatherName_${index}">
      <i class="fa-solid fa-user-tie"></i> الأب
    </label>

    <div class="meta-view wife-father-view">
      <div class="meta-info">
        <div class="wife-father-grid" data-mode="preview"></div>
      </div>
      <div class="wife-father-toolbar">
        <button type="button" class="btn tiny meta-toggle-btn" hidden aria-expanded="false"></button>
        <div class="wife-father-actions">
          <button type="button" class="btn tiny edit-father-btn edit-wife-father-btn">تعديل</button>
        </div>
      </div>
    </div>

    <div class="wife-father-edit meta-edit" style="display:none;">
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-user-tie"></i> الاسم<span class="req">*</span></span>
        <input id="wifeFatherName_${index}" type="text" class="wife-father" name="wife-father" placeholder="مثال: محمد">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
        <input type="text" class="wife-father-cognomen" name="wifeFatherCognomen" placeholder="مثال: أبو أحمد">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
        <input type="date" class="wife-father-birthDate" name="wifeFatherBirthDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
        <input type="date" class="wife-father-deathDate" name="wifeFatherDeathDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
        <input type="text" class="wife-father-birthPlace" name="wifeFatherBirthPlace" placeholder="مثال: الرياض">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
        <input type="text" class="wife-father-occupation" name="wifeFatherOccupation" placeholder="مثال: موظف">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
        <input type="text" class="wife-father-remark" name="wifeFatherRemark" placeholder="معلومة مختصرة">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-users"></i> العشيرة</span>
        <input type="text" class="wife-father-clan" name="wifeFatherClan" placeholder="مثال: آل سالم">
      </label>

      <!-- الإخوة لأب الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-user-group"></i> الإخوة</span>
        <input type="text" class="wife-father-brothers" name="wifeFatherBrothers" placeholder="مثال: علي، خالد">
      </label>

      <!-- الأخوات لأب الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-user-group"></i> الأخوات</span>
        <input type="text" class="wife-father-sisters" name="wifeFatherSisters" placeholder="مثال: فاطمة، نورة">
      </label>

      <!-- الإنجازات لأب الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
        <input type="text" class="wife-father-achievements" name="wifeFatherAchievements" placeholder="مثال: خدم في القضاء ٣٠ سنة">
      </label>

      <!-- الهوايات لأب الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-heart"></i> الهوايات</span>
        <input type="text" class="wife-father-hobbies" name="wifeFatherHobbies" placeholder="مثال: القراءة، السفر">
      </label>

      <div class="meta-edit-actions">
        <button type="button" class="save-wife-father-btn save-father-btn">
          <i class="fa-solid fa-check"></i> حفظ
        </button>
        <button type="button" class="cancel-wife-father-btn cancel-father-btn">
          <i class="fa-solid fa-xmark"></i> إلغاء
        </button>
      </div>
    </div>
  </div>`;
}

// ميتا أم الزوجة
function buildWifeMotherHTML(index) {
  return `
  <!-- ميتا أم الزوجة -->
  <div class="wife-mother-row">
    <label class="label wife-mother-label" for="wifeMotherName_${index}">
      <i class="fa-solid fa-person-dress"></i> الأم
    </label>

    <div class="meta-view wife-mother-view">
      <div class="meta-info">
        <div class="wife-mother-grid" data-mode="preview"></div>
      </div>
      <div class="wife-mother-toolbar">
        <button type="button" class="btn tiny meta-toggle-btn" hidden aria-expanded="false"></button>
        <div class="wife-mother-actions">
          <button type="button" class="btn tiny edit-father-btn edit-wife-mother-btn">تعديل</button>
        </div>
      </div>
    </div>

    <div class="wife-mother-edit meta-edit" style="display:none;">
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-person-dress"></i> الاسم<span class="req">*</span></span>
        <input id="wifeMotherName_${index}" type="text" class="wife-mother" name="wife-mother" placeholder="مثال: عائشة">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
        <input type="text" class="wife-mother-cognomen" name="wifeMotherCognomen" placeholder="مثال: أم أحمد">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
        <input type="date" class="wife-mother-birthDate" name="wifeMotherBirthDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
        <input type="date" class="wife-mother-deathDate" name="wifeMotherDeathDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
        <input type="text" class="wife-mother-birthPlace" name="wifeMotherBirthPlace" placeholder="مثال: مكة">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
        <input type="text" class="wife-mother-occupation" name="wifeMotherOccupation" placeholder="مثال: معلمة">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
        <input type="text" class="wife-mother-remark" name="wifeMotherRemark" placeholder="معلومة مختصرة">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-users"></i> العشيرة</span>
        <input type="text" class="wife-mother-clan" name="wifeMotherClan" placeholder="مثال: آل سالم">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-user-group"></i> الإخوة</span>
        <input type="text" class="wife-mother-brothers" name="wifeMotherBrothers" placeholder="مثال: علي، خالد">
      </label>

      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-user-group"></i> الأخوات</span>
        <input type="text" class="wife-mother-sisters" name="wifeMotherSisters" placeholder="مثال: فاطمة، نورة">
      </label>

      <!-- الإنجازات لأم الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
        <input type="text" class="wife-mother-achievements" name="wifeMotherAchievements" placeholder="مثال: حفظ القرآن الكريم">
      </label>

      <!-- الهوايات لأم الزوجة -->
      <label class="field-inline">
        <span class="label"><i class="fa-solid fa-heart"></i> الهوايات</span>
        <input type="text" class="wife-mother-hobbies" name="wifeMotherHobbies" placeholder="مثال: التعليم، التطوع">
      </label>

      <div class="meta-edit-actions">
        <button type="button" class="btn btn-sm meta-save save-wife-mother-btn">
          <i class="fa-solid fa-check"></i> حفظ
        </button>
        <button type="button" class="cancel-btn btn-sm meta-cancel cancel-wife-mother-btn">
          <i class="fa-solid fa-xmark"></i> إلغاء
        </button>
      </div>
    </div>
  </div>`;
}

// الإضافة السريعة للأطفال + العدّاد + المحرر
function buildChildrenQuickAddHTML() {
  return `
  <div class="wife-actions">
    <button type="button" class="btn small add-children-btn">
      <i class="fa-solid fa-square-plus"></i><span class="btn-label">إضافة طفل</span>
    </button>
    <button type="button" class="btn small danger remove-wife-btn">
      <i class="fa-solid fa-trash"></i> حذف الزوجة
    </button>
    <button type="button" class="btn small danger remove-all-children-btn" title="حذف جميع الأبناء">
      <i class="fa-solid fa-broom"></i> حذف جميع الأبناء
    </button>
  </div>
  <div class="children-count"><i class="fa-solid fa-children"></i> عدد الأبناء: <span class="num">0</span></div>
  <div class="children-add" style="display:none;margin-top:.6rem;">
    <div class="children-controls">

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-child"></i> اسم الطفل
        </span>
        <input type="text" class="child-name-input" name="childQuickName" placeholder="مثال: عبد الرحمن">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-venus-mars"></i> الجنس
        </span>
        <select class="child-role-input" name="childQuickRole">
          <option>ابن</option><option>بنت</option>
        </select>
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد
        </span>
        <input type="date" class="child-birthDate-input" name="childQuickBirthDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-book-skull"></i> تاريخ الوفاة
        </span>
        <input type="date" class="child-deathDate-input" name="childQuickDeathDate"
               placeholder="YYYY-MM-DD" data-year-toggle="1">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-location-dot"></i> مكان الميلاد
        </span>
        <input type="text" class="child-birthPlace-input" name="childQuickBirthPlace" placeholder="مثال: المدينة">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-briefcase"></i> المهنة
        </span>
        <input type="text" class="child-occupation-input" name="childQuickOccupation" placeholder="مثال: طالب">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-signature"></i> اللقب
        </span>
        <input type="text" class="child-cognomen-input" name="childQuickCognomen" placeholder="مثال: أبو ياسر">
      </label>

      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-note-sticky"></i> ملاحظة
        </span>
        <input type="text" class="child-remark-input" name="childQuickRemark" placeholder="معلومة مختصرة">
      </label>

      <!-- الإنجازات للطفل -->
      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-trophy"></i> الإنجازات
        </span>
        <input type="text" class="child-achievements-input" name="childQuickAchievements"
               placeholder="مثال: حفظ القرآن، التفوق الدراسي">
      </label>

      <!-- الهوايات للطفل -->
      <label class="field-inline">
        <span class="label">
          <i class="fa-solid fa-heart"></i> الهوايات
        </span>
        <input type="text" class="child-hobbies-input" name="childQuickHobbies"
               placeholder="مثال: القراءة، كرة القدم">
      </label>

      <button type="button" class="btn small add-child-inline-btn">إضافة</button>
    </div>
  </div>

  <div class="children-editor"><div class="children-list-editor"></div></div>`;
}

/* ======================= مصنع موحّد لميتا أحد الأبوين ======================= */

function setupParentMetaBlock({
  row,
  viewEl,
  editEl,
  gridEl,
  toggleBtn,
  editBtn,
  saveBtn,
  cancelBtn,
  railEl,
  labels,
  icons,
  previewKeys,
  fullKeys,
  datasetMap,
  viewKeyMap,
  nameEl,
  otherEls,
  requiredMsg
}) {
  // منطق "الحقول الأخرى تلزم الاسم"
  (function enforceLive() {
    function run() {
      const nameVal   = (nameEl.value || '').trim();
      const anyFilled = otherEls.some((el) => el && (el.value || '').trim());
      const need      = anyFilled && !nameVal;

      nameEl.dataset.logicRequired = need ? '1' : '0';

      if (need) {
        nameEl.classList.add('is-invalid');
        nameEl.setAttribute('aria-invalid', 'true');
      } else {
        nameEl.classList.remove('is-invalid');
        nameEl.removeAttribute('aria-invalid');
      }

      try { nameEl.__dirtyToggle?.(); } catch {}
      try { markGlobalDirty(); } catch {}
    }

    [nameEl, ...otherEls].forEach((el) => {
      el.addEventListener('input', run, true);
      el.addEventListener('change', run, true);
    });
    run();
  })();

  const inputs = [nameEl, ...otherEls];

  const block = makeMetaBlock({
    row,
    viewEl,
    editEl,
    gridEl,
    toggleBtn,
    railEl,
    labels,
    icons,
    visibleKeys: previewKeys,
    fullKeys,
    datasetMap,
    inputs,
    saveBtn,
    cancelBtn,
    editBtn,
    // تحويل القيم إلى نموذج العرض (مع قوائم نقطية للقيم المتعددة)
    valueTransform(v) {
      const birthKey        = Object.keys(viewKeyMap).find((k) => k === 'birthDate');
      const deathKey        = Object.keys(viewKeyMap).find((k) => k === 'deathDate');
      const birthDatasetKey = birthKey ? viewKeyMap[birthKey] : null;
      const deathDatasetKey = deathKey ? viewKeyMap[deathKey] : null;

      const birthIso = birthDatasetKey ? v[birthDatasetKey] : '';
      const deathIso = deathDatasetKey ? v[deathDatasetKey] : '';
      const age      = computeAgeFromBirthDate(birthIso, deathIso);

      // مفاتيح العرض التي نريد عرضها كقوائم نقطية
      const LIST_VIEW_KEYS = new Set(['achievements', 'hobbies', 'brothers', 'sisters']);

      const out = {};
      for (const [viewKey, datasetKey] of Object.entries(viewKeyMap)) {
        const raw = (v[datasetKey] || '').trim();

        // إنجازات/هوايات/إخوة/أخوات ⇒ قائمة نقطية في المعاينة
        if (LIST_VIEW_KEYS.has(viewKey)) {
          out[viewKey] = formatListForMeta(raw);
        } else {
          out[viewKey] = raw;
        }
      }

      out.age = age;
      return out;
    },

    validate() {
      const nameVal   = (nameEl.value || '').trim();
      const anyFilled = otherEls.some((el) => el && (el.value || '').trim());
      if (anyFilled && !nameVal) {
        return {
          ok: false,
          firstInvalid: nameEl,
          msg: requiredMsg
        };
      }
      return { ok: true };
    }
  });

  // لو هناك بيانات في الـ dataset نغلق التحرير مباشرة
  queueMicrotask(() => {
    try {
      const vals = block.io.read();
      const hasAny = Object.values(vals || {}).some(
        (v) => (v ?? '').toString().trim()
      );
      if (hasAny) block.closeEdit();
    } catch {}
  });

  return block;
}

/* ======================= الدالة الرئيسية ======================= */

export function createWifeBlock(index) {
  const wrapper = el('div', 'wife-block');
  wrapper.dataset.index = index;
  const ord = getArabicOrdinalF(index);

  wrapper.innerHTML = `
<div class="wife-header">
  <h4 class="wife-title">الزوجة ${ord} <span class="req">*</span></h4>
</div>
<div class="wife-main">
  ${buildWifeMainHTML()}
  ${buildWifeFatherHTML(index)}
  ${buildWifeMotherHTML(index)}
  ${buildChildrenQuickAddHTML()}
</div>`;

  // تفعيل مبدّل السنة/التاريخ لكل الحقول التي تحمل data-year-toggle="1"
  wrapper.querySelectorAll('input[data-year-toggle="1"]').forEach(attachYearModeToggle);

  // حقول الإضافة السريعة للأطفال
  const quickNameEl       = wrapper.querySelector('.child-name-input');
  const quickRoleEl       = wrapper.querySelector('.child-role-input');
  const quickBirthPlaceEl = wrapper.querySelector('.child-birthPlace-input');
  const quickOccEl        = wrapper.querySelector('.child-occupation-input');
  const quickCogEl        = wrapper.querySelector('.child-cognomen-input');
  const quickRemarkEl     = wrapper.querySelector('.child-remark-input');
  const quickAchEl        = wrapper.querySelector('.child-achievements-input');
  const quickHobEl        = wrapper.querySelector('.child-hobbies-input');

  function setQuickPlaceholders(g) {
    const isF = (g === 'بنت');
    if (quickNameEl)       quickNameEl.placeholder       = isF ? 'مثال: فاطمة'          : 'مثال: عبد الرحمن';
    if (quickBirthPlaceEl) quickBirthPlaceEl.placeholder = 'مثال: المدينة';
    if (quickOccEl)        quickOccEl.placeholder        = isF ? 'مثال: طالبة'          : 'مثال: طالب';
    if (quickCogEl)        quickCogEl.placeholder        = isF ? 'مثال: أم ياسر'        : 'مثال: أبو ياسر';
    if (quickRemarkEl)     quickRemarkEl.placeholder     = 'معلومة مختصرة';
    if (quickAchEl)        quickAchEl.placeholder        = 'مثال: حفظ القرآن، التفوق الدراسي';
    if (quickHobEl)        quickHobEl.placeholder        = isF ? 'مثال: القراءة، الرسم' : 'مثال: القراءة، كرة القدم';
  }

  const onQuickRoleUpdate = () => setQuickPlaceholders(quickRoleEl.value);
  setQuickPlaceholders(quickRoleEl.value);
  quickRoleEl.addEventListener('change', onQuickRoleUpdate);

  /* ========= ميتا أب الزوجة ========= */

  const fatherRow      = wrapper.querySelector('.wife-father-row');
  const fatherGrid     = fatherRow.querySelector('.wife-father-grid');
  const fatherView     = fatherRow.querySelector('.wife-father-view');
  const fatherEdit     = fatherRow.querySelector('.wife-father-edit');
  const fatherToggle   = fatherRow.querySelector('.meta-toggle-btn');
  const fatherEditBtn  = fatherRow.querySelector('.edit-wife-father-btn');
  const fatherSaveBtn  = fatherRow.querySelector('.save-wife-father-btn');
  const fatherCancelBtn= fatherRow.querySelector('.cancel-wife-father-btn');

  const fnEl    = fatherEdit.querySelector('.wife-father');
  const fCgEl   = fatherEdit.querySelector('.wife-father-cognomen');
  const fBdEl   = fatherEdit.querySelector('.wife-father-birthDate');
  const fDdEl   = fatherEdit.querySelector('.wife-father-deathDate');
  const fBpEl   = fatherEdit.querySelector('.wife-father-birthPlace');
  const fOcEl   = fatherEdit.querySelector('.wife-father-occupation');
  const fRmEl   = fatherEdit.querySelector('.wife-father-remark');
  const fClanEl = fatherEdit.querySelector('.wife-father-clan');
  const fBroEl  = fatherEdit.querySelector('.wife-father-brothers');
  const fSisEl  = fatherEdit.querySelector('.wife-father-sisters');
  const fAchEl  = fatherEdit.querySelector('.wife-father-achievements');
  const fHobEl  = fatherEdit.querySelector('.wife-father-hobbies');

  const fRail = document.createElement('div');
  fRail.className = 'meta-rail';

  const wifeFatherMap = {
    wifeFatherName:         fnEl,
    wifeFatherCognomen:     fCgEl,
    wifeFatherBirthDate:    fBdEl,
    wifeFatherDeathDate:    fDdEl,
    wifeFatherBirthPlace:   fBpEl,
    wifeFatherOccupation:   fOcEl,
    wifeFatherRemark:       fRmEl,
    wifeFatherClan:         fClanEl,
    wifeFatherBrothers:     fBroEl,
    wifeFatherSisters:      fSisEl,
    wifeFatherAchievements: fAchEl,
    wifeFatherHobbies:      fHobEl
  };

  const wifeFatherBlock = setupParentMetaBlock({
    row:        fatherRow,
    viewEl:     fatherView,
    editEl:     fatherEdit,
    gridEl:     fatherGrid,
    toggleBtn:  fatherToggle,
    editBtn:    fatherEditBtn,
    saveBtn:    fatherSaveBtn,
    cancelBtn:  fatherCancelBtn,
    railEl:     fRail,
    labels:     WIFE_FATHER_VIEW_LABELS,
    icons:      WIFE_FATHER_VIEW_ICONS,
    previewKeys:WIFE_FATHER_PREV_KEYS,
    fullKeys:   WIFE_FATHER_FULL_KEYS,
    datasetMap: wifeFatherMap,
    viewKeyMap: WIFE_FATHER_VIEW_KEYMAP,
    nameEl:     fnEl,
    otherEls:   [fCgEl, fBdEl, fDdEl, fBpEl, fOcEl, fRmEl, fClanEl, fBroEl, fSisEl, fAchEl, fHobEl],
    requiredMsg:'أدخل اسم أب الزوجة عند تعبئة أي بيانات أخرى.'
  });

  /* ========= ميتا أم الزوجة ========= */

  const motherRow       = wrapper.querySelector('.wife-mother-row');
  const motherGrid      = motherRow.querySelector('.wife-mother-grid');
  const motherView      = motherRow.querySelector('.wife-mother-view');
  const motherEdit      = motherRow.querySelector('.wife-mother-edit');
  const motherToggle    = motherRow.querySelector('.meta-toggle-btn');
  const motherEditBtn   = motherRow.querySelector('.edit-wife-mother-btn');
  const motherSaveBtn   = motherRow.querySelector('.save-wife-mother-btn');
  const motherCancelBtn = motherRow.querySelector('.cancel-wife-mother-btn');

  const mnEl    = motherEdit.querySelector('.wife-mother');
  const mCgEl   = motherEdit.querySelector('.wife-mother-cognomen');
  const mBdEl   = motherEdit.querySelector('.wife-mother-birthDate');
  const mDdEl   = motherEdit.querySelector('.wife-mother-deathDate');
  const mBpEl   = motherEdit.querySelector('.wife-mother-birthPlace');
  const mOcEl   = motherEdit.querySelector('.wife-mother-occupation');
  const mRmEl   = motherEdit.querySelector('.wife-mother-remark');
  const mClanEl = motherEdit.querySelector('.wife-mother-clan');
  const mBroEl  = motherEdit.querySelector('.wife-mother-brothers');
  const mSisEl  = motherEdit.querySelector('.wife-mother-sisters');
  const mAchEl  = motherEdit.querySelector('.wife-mother-achievements');
  const mHobEl  = motherEdit.querySelector('.wife-mother-hobbies');

  const mRail = document.createElement('div');
  mRail.className = 'meta-rail';

  const wifeMotherMap = {
    wifeMotherName:         mnEl,
    wifeMotherCognomen:     mCgEl,
    wifeMotherBirthDate:    mBdEl,
    wifeMotherDeathDate:    mDdEl,
    wifeMotherBirthPlace:   mBpEl,
    wifeMotherOccupation:   mOcEl,
    wifeMotherRemark:       mRmEl,
    wifeMotherClan:         mClanEl,
    wifeMotherBrothers:     mBroEl,
    wifeMotherSisters:      mSisEl,
    wifeMotherAchievements: mAchEl,
    wifeMotherHobbies:      mHobEl
  };

  const wifeMotherBlock = setupParentMetaBlock({
    row:        motherRow,
    viewEl:     motherView,
    editEl:     motherEdit,
    gridEl:     motherGrid,
    toggleBtn:  motherToggle,
    editBtn:    motherEditBtn,
    saveBtn:    motherSaveBtn,
    cancelBtn:  motherCancelBtn,
    railEl:     mRail,
    labels:     WIFE_MOTHER_VIEW_LABELS,
    icons:      WIFE_MOTHER_VIEW_ICONS,
    previewKeys:WIFE_MOTHER_PREV_KEYS,
    fullKeys:   WIFE_MOTHER_FULL_KEYS,
    datasetMap: wifeMotherMap,
    viewKeyMap: WIFE_MOTHER_VIEW_KEYMAP,
    nameEl:     mnEl,
    otherEls:   [mCgEl, mBdEl, mDdEl, mBpEl, mOcEl, mRmEl, mClanEl, mBroEl, mSisEl, mAchEl, mHobEl],
    requiredMsg:'أدخل اسم أم الزوجة عند تعبئة أي بيانات أخرى.'
  });

  // دمج الأعمال المؤجلة في microtask واحد
  queueMicrotask(() => {
    try { updateChildrenCount?.(wrapper); } catch {}
  });

  // ربط نظام مؤشرات الاتساخ داخل كتلة الزوجة
  try { initDirtyIndicators(wrapper); } catch {}

  return wrapper;
}
