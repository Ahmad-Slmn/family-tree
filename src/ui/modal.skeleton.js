// src/ui/modal.skeleton.js
// هيكل المودال + markGlobalDirty + ensureBtnLabelSpan

// أيقونة FontAwesome سريعة
const ico = (cls) => `<i class="fa-solid ${cls}" aria-hidden="true"></i>`;

/* ====================== ثوابت حقول صاحب الشجرة ====================== */

const ROOT_PLACEHOLDERS = {
  newFamilyTitle:             'مثال: آل القحطاني',
  newRootPerson:              'مثال: محمد بن عبد الله',
  newRootPersonBirthDate:     'YYYY أو YYYY-MM-DD',
  newRootPersonDeathDate:     'YYYY أو YYYY-MM-DD',
  newRootPersonBirthPlace:    'مثال: الرياض',
  newRootPersonOccupation:    'مثال: معلم',
  newRootPersonCognomen:      'مثال: أبو عمر',
  newRootPersonRemark:        'معلومة مختصرة',
  newRootPersonAchievements:  'مثال: حفظ القرآن، جوائز دراسية',
  newRootPersonHobbies:       'مثال: القراءة، السفر',
  newRootPersonTribe:         'مثال: قحطان',
  newRootPersonClan:          'مثال: آل سعيد',
  newMother:                  'مثال: عائشة',
  newMotherClan:              'مثال: آل سالم',
  newRootPersonBrothers:      'مثال: علي، خالد',
  newRootPersonSisters:       'مثال: فاطمة، نورة'
};

const ROOT_ICONS = {
  newFamilyTitle:             'fa-house',
  newRootPerson:              'fa-user',
  newRootPersonBirthDate:     'fa-cake-candles',
  newRootPersonDeathDate:     'fa-book-skull',
  newRootPersonBirthPlace:    'fa-location-dot',
  newRootPersonOccupation:    'fa-briefcase',
  newRootPersonCognomen:      'fa-signature',
  newRootPersonRemark:        'fa-note-sticky',
  newRootPersonAchievements:  'fa-trophy',
  newRootPersonHobbies:       'fa-heart-pulse',
  newRootPersonTribe:         'fa-people-group',
  newRootPersonClan:          'fa-users-rectangle',
  newMother:                  'fa-person-dress',
  newMotherClan:              'fa-users',
  newRootPersonBrothers:      'fa-user-group',
  newRootPersonSisters:       'fa-user-group'
};

// [id, type, label, required?]
const ROOT_FIELDS = [
  ['newFamilyTitle',          'text', 'عنوان العائلة',        true],
  ['newRootPerson',          'text', 'اسم صاحب الشجرة',      true],
  ['newRootPersonBirthDate', 'date', 'تاريخ الميلاد',        false],
  ['newRootPersonDeathDate', 'date', 'تاريخ الوفاة',         false],
  ['newRootPersonBirthPlace','text', 'مكان الميلاد',         false],
  ['newRootPersonOccupation','text', 'المهنة',               false],
  ['newRootPersonCognomen',  'text', 'اللقب',                false],
  ['newRootPersonRemark',    'text', 'ملاحظة',               false],
  ['newRootPersonAchievements','text','الإنجازات',           false],
  ['newRootPersonHobbies',   'text', 'الهوايات',             false],
  ['newRootPersonTribe',     'text', 'القبيلة',              false],
  ['newRootPersonClan',      'text', 'العشيرة',              false],
  ['newRootPersonBrothers',  'text', 'الإخوة',               false],
  ['newRootPersonSisters',   'text', 'الأخوات',              false]
];

/* ====================== Mark global dirty ====================== */

let familyFormRef = null;
export const GLOBAL_DIRTY_EVENT = 'family:globalDirty';

export function setFamilyFormRef(form) {
  familyFormRef = form || null;
}

// تمييز زر الحفظ العام مباشرة بعد أي حفظ/تعديل فرعي
export function markGlobalDirty(reason = 'subsave') {
  const form = familyFormRef;
  if (!form) return;

  form.dispatchEvent(new CustomEvent(GLOBAL_DIRTY_EVENT, {
    bubbles: true,
    detail: { reason },
  }));
}

/* ====================== أجزاء هيكل المودال ====================== */

function buildRootFieldsHTML() {
  return ROOT_FIELDS.map(([id, type, label, req]) => {
    const isDate = (id === 'newRootPersonBirthDate' || id === 'newRootPersonDeathDate');
    const yearToggleAttr = isDate ? ' data-year-toggle="1"' : '';
    const iconClass = ROOT_ICONS[id] || 'fa-pen-to-square';
    const placeholder = ROOT_PLACEHOLDERS[id] || '';
    const reqMark = req ? '<span class="req">*</span>' : '';
    const reqAttr = req ? ' required' : '';

    return `
          <label class="field-inline">
            <span class="label">${ico(iconClass)} ${label}${reqMark}</span>
            <input id="${id}" name="${id}" type="${type}" placeholder="${placeholder}"${yearToggleAttr}${reqAttr} />
          </label>`;
  }).join('');
}

function buildLeftSectionHTML() {
  return `
      <div class="left-section">
        <h3 class="section-title">${ico('fa-user')} بيانات صاحب الشجرة</h3>
        <div class="left-col">
${buildRootFieldsHTML()}

          <!-- كتلة الأب -->
          <div id="fatherBlockMount" class="father-area"></div>
          <!-- كتلة الأم -->
          <div id="motherBlockMount" class="mother-area"></div>

          <div class="ancestors-area">
            <div class="ancestors-header">
              <h3 class="ancestors-title">${ico('fa-users-rectangle')} الأجداد</h3>
              <button type="button" id="addAncestorBtn" class="btn small">
                ${ico('fa-user-plus')}<span class="btn-label">إضافة جد</span>
              </button>
            </div>
            <div class="ancestors-list"></div>
            <div class="text-muted ancestors-hint">يمكن ترتيب الأجداد بالسحب أو بالأزرار ↑ ↓.</div>
          </div>
        </div>
      </div>`;
}

function buildRightSectionHTML() {
  return `
      <div class="right-section">
        <h3 class="section-title">${ico('fa-people-roof')} الزوجات والأبناء</h3>
        <div class="right-col">
          <div class="wives-area">
            <div class="wives-header">
              <h3 class="wives-title">${ico('fa-people-roof')} الزوجات</h3>
              <button type="button" id="addWifeBtn" class="btn small">
                ${ico('fa-person-circle-plus')}<span class="btn-label">إضافة الزوجة</span>
              </button>
            </div>
            <div class="wives-list"></div>
            <div class="wives-note">أضف الزوجة ثم الأبناء. الحقول الفارغة لا تُحفظ.</div>
          </div>
        </div>
      </div>`;
}

function buildActionsHTML() {
  return `
      <div class="form-actions">
        <button type="submit" class="btn primary">
          ${ico('fa-check')}<span class="btn-label">حفظ العائلة</span>
        </button>
        <button type="button" id="cancelAddFamily" class="btn cancel">
          ${ico('fa-circle-xmark')}<span class="btn-label">إلغاء</span>
        </button>
      </div>`;
}

/* ====================== هيكل المودال + Live region ====================== */

export function buildFamilyModalSkeleton() {
  const existing = document.getElementById('familyCreatorModal');
  if (existing) existing.remove();

  const html = `
<div class="form-modal" id="familyCreatorModal" role="dialog" aria-modal="true" aria-labelledby="familyCreatorTitle">
  <div class="modal-inner">
    <button id="closeAddFamily" class="close-btn close-button" type="button" tabindex="-1" aria-label="إغلاق">
      <i class="fa fa-xmark" aria-hidden="true"></i>
    </button>

    <div class="form-modal-header">
      <h2 id="familyCreatorTitle">إنشاء عائلة جديدة</h2>
    </div>

    <form id="addFamilyForm" class="add-family-form" autocomplete="off" novalidate>
${buildLeftSectionHTML()}
${buildRightSectionHTML()}
${buildActionsHTML()}
    </form>
  </div>
</div>`;

  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  const modal = wrap.firstElementChild;

setFamilyFormRef(modal.querySelector('#addFamilyForm'));

  let ancLive = modal.querySelector('#ancLive');
  if (!ancLive) {
    ancLive = document.createElement('div');
    ancLive.id = 'ancLive';
    ancLive.setAttribute('aria-live', 'polite');
    ancLive.setAttribute('aria-atomic', 'true');
    ancLive.setAttribute('role', 'status');
    ancLive.className = 'sr-only-live';
    modal.appendChild(ancLive);
  }

  return modal;
}

/* ====================== أزرار ذات span داخلي ====================== */

export function ensureBtnLabelSpan(btn) {
  if (!btn) return null;
  let span = btn.querySelector('.btn-label');
  if (!span) {
    span = document.createElement('span');
    span.className = 'btn-label';
    btn.appendChild(span);
  }
  return span;
}
