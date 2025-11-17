// src/ui/modal.blocks.child.js
// كتلة "الطفل" داخل الزوجة + عدّاد الأبناء في الزوجة

import { el, showConfirmModal, showInfo, highlight } from '../utils.js';
import { makeMetaBlock, computeAgeFromBirthDate, formatListForMeta } from './modal.metaBlock.js';

import { attachYearModeToggle } from './modal.yearToggle.js';
import { ensureDirtyDot, snapshotFieldValue } from './modal.dirtyIndicators.js';
import { markGlobalDirty } from './modal.skeleton.js';

/* =================== ثوابت معاينة الطفل (labels/icons/keys) =================== */

const CHILD_VIEW_LABELS = {
  name:         'الاسم',
  role:         'الجنس',
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

const CHILD_VIEW_ICONS = {
  name:         'fa-user',
  role:         'fa-venus-mars',
  birthDate:    'fa-cake-candles',
  deathDate:    'fa-book-skull',
  age:          'fa-hourglass-half',
  birthPlace:   'fa-location-dot',
  occupation:   'fa-briefcase',
  cognomen:     'fa-signature',
  remark:       'fa-note-sticky',
  achievements: 'fa-trophy',
  hobbies:      'fa-gamepad',
};

const CHILD_VIEW_VISIBLE_KEYS = ['name', 'role', 'age'];
const CHILD_VIEW_FULL_KEYS    = [
  'name',
  'role',
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

/* =================== عدّاد الأبناء لكل زوجة =================== */

export function updateChildrenCount(wrap) {
  if (!wrap) return;

  const list = wrap.querySelector('.children-list-editor');
  const n    = list?.children.length || 0;

  // تحديث الرقم في بلوك العدّاد العام
  const numElBlock = wrap.querySelector('.children-count .num');
  if (numElBlock) numElBlock.textContent = String(n);

  // إعادة ترقيم كل طفل في الرأس والبادج
  const items = Array.from(list?.children || []);
  items.forEach((li, i) => {
    const numHead = li.querySelector('.child-view .child-count .num');
    if (numHead) numHead.textContent = String(i + 1);

    const badge = li.querySelector('.child-index-badge');
    if (badge) badge.setAttribute('data-idx', String(i + 1));
  });
}

/* =================== إنشاء عنصر طفل جديد داخل الزوجة =================== */

export function createChildEditItem(name, role, givenId) {
  // ID فريد للطفل (مع إمكان تمرير ID من الخارج)
  const cid = givenId || (crypto?.randomUUID ? crypto.randomUUID()
    : ('c' + Date.now() + Math.random().toString(36).slice(2, 6)));

  const li = el('div', 'child-item');
  li.dataset.childId = cid;

  /* ---------- جزء العرض (meta-view) ---------- */

  const view = el('div', 'meta-view child-view');

  const head = el('div', 'child-head');
  head.innerHTML = `
  <div class="child-index-badge dnd-handle" tabindex="0" role="button"
       title="اسحب لإعادة الترتيب أو استخدم ↑ ↓" data-idx="0">
    <i class="fa-solid fa-grip-lines" aria-hidden="true"></i>
  </div>
  <div class="child-head-main">
    <h5 class="child-title label"><span class="dirty-dot"></span>الطفل</h5>
    <div class="child-count"><span class="num child-index-badge">0</span></div>
  </div>
`;
  const childTitle = head.querySelector('.child-title');

  // التعامل مع ↑ ↓ و Enter على بادج الترتيب
  const badge = head.querySelector('.child-index-badge');
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      li.dispatchEvent(new CustomEvent('child:moveUp', { bubbles: true }));
    }
    if (e.key === 'ArrowDown') {
      li.dispatchEvent(new CustomEvent('child:moveDown', { bubbles: true }));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      li.querySelector('.edit-child-btn')?.click();
    }
  });

  const info = el('div', 'child-info');
  const grid = el('div', 'child-grid');
  grid.dataset.mode = 'preview';

  const rail = el('div', 'meta-rail');
  rail.innerHTML = `
  <div class="move-rail">
    <button type="button" class="move-up" title="نقل لأعلى"><i class="fa-solid fa-arrow-up"></i></button>
    <button type="button" class="move-down" title="نقل لأسفل"><i class="fa-solid fa-arrow-down"></i></button>
  </div>`;

  const toolbar = el('div', 'child-toolbar');
  const toggle  = el('button', 'btn tiny meta-toggle-btn');
  toggle.type   = 'button';

  const editBtn = el('button', 'btn tiny edit-child-btn');
  editBtn.type  = 'button';
  editBtn.textContent = 'تعديل';

  const rmBtn = el('button', 'btn tiny remove-child remove-child-btn danger');
  rmBtn.type  = 'button';
  rmBtn.textContent = 'حذف';

  const actions = el('div', 'child-actions');
  actions.append(editBtn, rmBtn);
  toolbar.append(toggle, actions);

  info.append(head, grid);
  view.append(info, toolbar);

  /* ---------- جزء التحرير (meta-edit) ---------- */

  const edit = el('div', 'child-edit meta-edit');
  edit.style.display = 'none';
  edit.innerHTML = `
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-user"></i> الاسم<span class="req">*</span></span>
  <input type="text" class="child-edit-name" name="childEditName" placeholder="مثال: أحمد" required>
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-venus-mars"></i> الجنس</span>
  <select class="child-edit-role" name="childEditRole">
    <option value="ابن">ابن</option><option value="بنت">بنت</option>
  </select>
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-cake-candles"></i> تاريخ الميلاد</span>
  <input type="date" class="child-edit-birthDate" name="childEditBirthDate"
         placeholder="YYYY-MM-DD" data-year-toggle="1">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-book-skull"></i> تاريخ الوفاة</span>
  <input type="date" class="child-edit-deathDate" name="childEditDeathDate"
         placeholder="YYYY-MM-DD" data-year-toggle="1">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-location-dot"></i> مكان الميلاد</span>
  <input type="text" class="child-edit-birthPlace" name="childEditBirthPlace" placeholder="مثال: جدة">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-briefcase"></i> المهنة</span>
  <input type="text" class="child-edit-occupation" name="childEditOccupation" placeholder="مثال: طالب">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-signature"></i> اللقب</span>
  <input type="text" class="child-edit-cognomen" name="childEditCognomen" placeholder="مثال: أبو خالد">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-note-sticky"></i> ملاحظة</span>
  <input type="text" class="child-edit-remark" name="childEditRemark" placeholder="معلومة مختصرة">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-trophy"></i> الإنجازات</span>
  <input type="text" class="child-edit-achievements" name="childEditAchievements" placeholder="مثال: حفظ القرآن، التفوق الدراسي">
</label>
<label class="field-inline">
  <span class="label"><i class="fa-solid fa-gamepad"></i> الهوايات</span>
  <input type="text" class="child-edit-hobbies" name="childEditHobbies" placeholder="مثال: القراءة، كرة القدم">
</label>
<div class="child-edit-actions meta-edit-actions">
  <button type="button" class="save-child-btn"><i class="fa-solid fa-check"></i> حفظ</button>
  <button type="button" class="cancel-child-btn"><i class="fa-solid fa-xmark"></i> إلغاء</button>
</div>
`;
  li.append(view, edit);

  /* ---------- مراجع الحقول + تهيئة القيم الأولية ---------- */

  const nameEl = edit.querySelector('.child-edit-name');
  const roleEl = edit.querySelector('.child-edit-role');
  nameEl.value = name || '';
  roleEl.value = role || 'ابن';

  const birthDateEl = edit.querySelector('.child-edit-birthDate');
  const deathDateEl = edit.querySelector('.child-edit-deathDate');
  const birthPlaceEl = edit.querySelector('.child-edit-birthPlace');
  const occEl        = edit.querySelector('.child-edit-occupation');
  const cogEl        = edit.querySelector('.child-edit-cognomen');
  const remarkEl     = edit.querySelector('.child-edit-remark');
  const achEl        = edit.querySelector('.child-edit-achievements');
  const hobEl        = edit.querySelector('.child-edit-hobbies');

  const saveChildBtn   = edit.querySelector('.save-child-btn');
  const cancelChildBtn = edit.querySelector('.cancel-child-btn');

  const childMap = {
    childName:         nameEl,
    childRole:         roleEl,
    childBirthDate:    birthDateEl,
    childDeathDate:    deathDateEl,
    childBirthPlace:   birthPlaceEl,
    childOccupation:   occEl,
    childCognomen:     cogEl,
    childRemark:       remarkEl,
    childAchievements: achEl,
    childHobbies:      hobEl,
  };

  // الحقول الأخرى (غير الاسم) المستخدمة في التحقق والمنطق الحي
  const otherFields = [
    birthDateEl,
    deathDateEl,
    birthPlaceEl,
    occEl,
    cogEl,
    remarkEl,
    achEl,
    hobEl,
    roleEl,
  ];

  // تفعيل وضع السنة/التاريخ لحقول التاريخ
  attachYearModeToggle(birthDateEl);
  attachYearModeToggle(deathDateEl);

  /* ---------- ربط makeMetaBlock (عرض + تحرير + dataset) ---------- */

  const childBlock = makeMetaBlock({
    row:       li,
    viewEl:    view,
    editEl:    edit,
    gridEl:    grid,
    toggleBtn: toggle,
    railEl:    rail,

    labels:       CHILD_VIEW_LABELS,
    icons:        CHILD_VIEW_ICONS,
    visibleKeys:  CHILD_VIEW_VISIBLE_KEYS,
    fullKeys:     CHILD_VIEW_FULL_KEYS,
    datasetMap:   childMap,
    inputs:       Object.values(childMap),
    saveBtn:      saveChildBtn,
    cancelBtn:    cancelChildBtn,
    editBtn:      editBtn,

    valueTransform(v) {
      const age = computeAgeFromBirthDate(v.childBirthDate, v.childDeathDate);
      return {
        name:         v.childName,
        role:         v.childRole || 'ابن',
        age,
        birthDate:    v.childBirthDate,
        deathDate:    v.childDeathDate,
        birthPlace:   v.childBirthPlace,
        occupation:   v.childOccupation,
        cognomen:     v.childCognomen,
        remark:       v.childRemark,

        // تحويل النص المفصول بفواصل إلى قائمة نقطية في المعاينة
        achievements: formatListForMeta(v.childAchievements),
        hobbies:      formatListForMeta(v.childHobbies),
      };
    },


    onSaved() {
      const w = li.closest('.wife-block');
      if (w) updateChildrenCount?.(w);
    },

    validate() {
      const nameReq = (nameEl.value || '').trim();
      const anyFilled = otherFields.some((el) => el && (el.value || '').trim());
      if (anyFilled && !nameReq) {
        return {
          ok: false,
          firstInvalid: nameEl,
          msg: 'أدخل اسم الطفل عند تعبئة أي بيانات أخرى.',
        };
      }
      return { ok: true };
    },
  });

  /* ---------- منطق "الاسم مطلوب إن وُجدت بيانات أخرى" + الاتساخ ---------- */

  (function enforceChildLive() {
    function run() {
      const nameReq   = (nameEl.value || '').trim();
      const anyFilled = otherFields.some((el) => el && (el.value || '').trim());
      const need      = anyFilled && !nameReq;

      nameEl.dataset.logicRequired = need ? '1' : '0';

      if (need) {
        nameEl.classList.add('is-invalid');
        nameEl.setAttribute('aria-invalid', 'true');
        childTitle?.classList.add('dot-invalid');
      } else {
        nameEl.classList.remove('is-invalid');
        nameEl.removeAttribute('aria-invalid');
        childTitle?.classList.remove('dot-invalid');
      }

      try { nameEl.__dirtyToggle?.(); } catch {}
      try { childBlock?.dirtyCtl?.toggle(); } catch {}
      try { markGlobalDirty(); } catch {}
    }

    [nameEl, roleEl, ...otherFields].forEach((el) => {
      el.addEventListener('input', run, true);
      el.addEventListener('change', run, true);
    });

    run();
  })();

  // مستمع إضافي على الاسم لتصفية حالة الخطأ فوراً عند الكتابة
  nameEl.addEventListener('input', () => {
    const hasVal = (nameEl.value || '').trim().length > 0;

    if (hasVal) {
      nameEl.dataset.logicRequired = '0';
      nameEl.classList.remove('is-invalid');
      nameEl.removeAttribute('aria-invalid');
      childTitle?.classList.remove('dot-invalid');
    }

    try { nameEl.__dirtyToggle?.(); } catch {}
    try { childBlock?.dirtyCtl?.toggle(); } catch {}
    try { markGlobalDirty(); } catch {}
  });

  /* ---------- ربط عنوان الطفل بنظام الاتساخ (نقطة ملونة) ---------- */

  (function bindChildDirtyTitle() {
    if (!childTitle) return;

    const inputs = Object.values(childMap);
    const base   = inputs.map(snapshotFieldValue);
    const dotEl  = ensureDirtyDot(childTitle); // قد يُضاف span داخلي عند الحاجة

    function update() {
      const changed    = inputs.some((inp, i) => snapshotFieldValue(inp) !== base[i]);
      const hasInvalid = inputs.some((inp) => inp.classList.contains('is-invalid'));

      childTitle.classList.toggle('dirty-on', changed || hasInvalid);
      childTitle.classList.remove('dot-pending');

      if (hasInvalid) {
        childTitle.classList.add('dot-invalid');
        childTitle.classList.remove('dot-ok');
      } else if (changed) {
        childTitle.classList.add('dot-ok');
        childTitle.classList.remove('dot-invalid');
      } else {
        childTitle.classList.remove('dot-ok', 'dot-invalid', 'dirty-on');
      }
    }

    inputs.forEach((inp) => {
      const ev = (inp.tagName === 'SELECT') ? 'change' : 'input';
      inp.addEventListener(ev, update);
    });

    update();
  })();

  /* ---------- placeholders حسب الجنس ---------- */

  function setChildPlaceholders(g) {
    const isF = (g === 'بنت');
    nameEl.placeholder       = isF ? 'مثال: فاطمة' : 'مثال: أحمد';
    birthPlaceEl.placeholder = 'مثال: جدة';
    occEl.placeholder        = isF ? 'مثال: طالبة' : 'مثال: طالب';
    cogEl.placeholder        = isF ? 'مثال: أم ياسر' : 'مثال: أبو ياسر';
    remarkEl.placeholder     = 'معلومة مختصرة';
  }

  setChildPlaceholders(roleEl.value);

  roleEl.addEventListener('change', () => {
    setChildPlaceholders(roleEl.value);
    childBlock.render();
    childBlock.dirtyCtl.toggle();
  });

  roleEl.addEventListener('input', () => {
    setChildPlaceholders(roleEl.value);
    childBlock.render();
    childBlock.dirtyCtl.toggle();
  });

/* ---------- حذف الطفل (مع تأكيد + رسالة بعد الحذف) ---------- */

li.querySelector('.remove-child').addEventListener('click', async () => {
  const childNameRaw = (nameEl.value || '').trim() || 'هذا الطفل';
  const childNameQuoted = `«${childNameRaw}»`;

  try {
    const ok = await showConfirmModal({
      title: 'تأكيد حذف الطفل',
      // هنا بدون HTML حتى لا يظهر الوسم في الرسالة
      message: `هل تريد بالتأكيد حذف ${childNameQuoted} من قائمة الأبناء؟ لا يمكن التراجع عن هذه الخطوة.`,
      confirmText: 'نعم، حذف',
      cancelText: 'إلغاء',
      type: 'danger',
    });

    if (!ok) return;

    // إشعار الأب ليقوم فعليًا بحذف العنصر من الشجرة/المصفوفة
    li.dispatchEvent(
      new CustomEvent('child:remove', {
        bubbles: true,
        detail: { childId: cid },
      }),
    );

    // رسالة بعد إتمام الحذف بنجاح مع تمييز اسم الطفل (يُعرض كـ HTML داخل التوست)
    if (typeof showInfo === 'function') {
      showInfo(`تم حذف ${highlight(childNameRaw)} بنجاح من قائمة الأبناء.`);
    } else {
      console.warn('showInfo غير متاح أو لم يُستورد من utils.js');
    }
  } catch (err) {
    console.error('خطأ أثناء تأكيد حذف الطفل:', err);
  }
});


  /* ---------- مزامنة الحقول من dataset عند الحاجة ---------- */

  li.updateFromDataset = function () {
    const v = childBlock.io.read();
    for (const [k, el] of Object.entries(childMap)) {
      if (!el) continue;
      const val = (v[k] || '').toString();
      if (el.tagName === 'SELECT') {
        if (val) el.value = val;
      } else {
        el.value = val;
      }
    }
    childBlock.render();
    childBlock.dirtyCtl.setBase();
    childBlock.dirtyCtl.toggle();
  };

  /* ---------- تحديث عدّاد الأبناء بعد الإضافة ---------- */

  queueMicrotask(() => {
    const w = li.closest('.wife-block');
    try { updateChildrenCount?.(w); } catch {}
  });

  return li;
}
