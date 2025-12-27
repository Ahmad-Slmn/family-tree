// features/print.js — نظام طباعة محسَّن مع عدّة أوضاع
import { byId, showInfo, showError, showConfirmModal } from '../utils.js';
import { getRoleAvatar } from '../model/roles.js';

import * as Model from '../model/families.js';
import { validateFamily } from './validate.js';

import { setValidationResults, getValidationSummary, openValidationModal, vcToastSummaryText} from '../ui/validationCenter.js';

/* الخيارات المتاحة للطباعة */
const PRINT_OPTIONS = [
  { id: 'printCompact',      label: 'طباعة مبسّطة',            className: 'print-compact',       storageKey: 'printCompact' },
  { id: 'printHideCounters', label: 'إخفاء العدّادات',         className: 'print-hide-counters', storageKey: 'printHideCounters' },
  { id: 'printHidePhotos',   label: 'إخفاء الصور',             className: 'print-hide-photos',   storageKey: 'printHidePhotos' },
  { id: 'printNoColors',     label: 'إزالة الألوان (أبيض وأسود)', className: 'print-no-colors', storageKey: 'printNoColors' },
  { id:'printHideRoles', label:'إخفاء مسمّيات القرابة', className:'print-hide-roles', storageKey:'printHideRoles' }
];

/* تطبيق/إزالة كلاس خيار معيّن */
function applyPrintClass(opt, enabled){
  document.body.classList.toggle(opt.className, !!enabled);
}

/* هل يوجد أي خيار طباعة مفعَّل؟ */
function hasAnyActivePrintOption(){
  return PRINT_OPTIONS.some(opt => localStorage.getItem(opt.storageKey) === '1');
}

/* مزامنة الكلاسات وخانات الاختيار من التخزين */
function syncFromStorage(){
  PRINT_OPTIONS.forEach(opt => {
    const on = localStorage.getItem(opt.storageKey) === '1';
    applyPrintClass(opt, on);
    const cb = byId(opt.id);
    if (cb) cb.checked = on;
  });
}

/* إنشاء خانة اختيار لخيار معيّن */
function createOptionCheckbox(opt){
  const label = document.createElement('label');
  label.style.cssText =
    'display:inline-flex;gap:.35rem;align-items:center;font-size:.85rem;';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = opt.id;
  cb.name = opt.id;
  cb.checked = localStorage.getItem(opt.storageKey) === '1';

  applyPrintClass(opt, cb.checked);

  cb.addEventListener('change', () => {
    const on = cb.checked;
    localStorage.setItem(opt.storageKey, on ? '1' : '0');
    applyPrintClass(opt, on);
  });

  label.append(cb, document.createTextNode(opt.label));
  return label;
}

/* تجهيز الأيقونات البديلة للأفتار عند إخفاء الصور */
function preparePrintAvatars(){
  document.querySelectorAll('.member-card').forEach(card => {
    const avatarBox = card.querySelector('.avatar');
    const img       = avatarBox ? avatarBox.querySelector('img') : null;

    if (!avatarBox || !img){
      avatarBox?.removeAttribute('data-print-avatar');
      return;
    }

    const roleEl = card.querySelector('.role');
    const role   = roleEl ? roleEl.textContent.trim() : '';
    const icon   = getRoleAvatar(role) || '👤';

    avatarBox.setAttribute('data-print-avatar', icon);
  });
}

/* إنشاء واجهة خيارات الطباعة حول زر الطباعة */
function addPrintOptionsUI(){
  const printBtn = byId('printBtn');
  if (!printBtn || byId('printOptionsBar')) return;

  const parent = printBtn.parentNode;
  if (!parent) return;

  const row = document.createElement('div');
  row.className = 'print-main-row';
  parent.insertBefore(row, printBtn);
  row.appendChild(printBtn);

  const toggle = document.createElement('button');
  toggle.id = 'printOptionsToggle';
  toggle.type = 'button';
  toggle.className = 'icon-btn';
  toggle.title = 'خيارات الطباعة';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<i class="fa-solid fa-gear"></i>';
  row.appendChild(toggle);

  const bar = document.createElement('div');
  bar.id = 'printOptionsBar';
  PRINT_OPTIONS.forEach(opt => bar.appendChild(createOptionCheckbox(opt)));
  parent.insertBefore(bar, row.nextSibling);

  bar.style.maxHeight = '0px';

  if (hasAnyActivePrintOption()){
    bar.classList.add('open');
    bar.style.maxHeight = bar.scrollHeight + 'px';
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => {
    const isOpen    = bar.classList.contains('open');
    const hasActive = hasAnyActivePrintOption();

    if (isOpen && hasActive){
      if (typeof showInfo === 'function'){
        showInfo('يوجد إعداد طباعة مفعَّل حاليًا، لا يمكن إخفاء الخيارات قبل إلغاء تفعيل جميع الإعدادات.');
      }
      return;
    }

    const nextOpen = !isOpen;
    bar.classList.toggle('open', nextOpen);
    bar.style.maxHeight = nextOpen ? bar.scrollHeight + 'px' : '0px';
    toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  });
}

/* مزامنة شاملة */
function syncAll(){
  syncFromStorage();
}

/* تهيئة نظام الطباعة */
export function init(){
  addPrintOptionsUI();

  document.documentElement.setAttribute(
    'data-print-title',
    document.title || 'Family Tree'
  );
  document.documentElement.setAttribute(
    'data-print-at',
    new Date().toLocaleString()
  );

  const originalTitle = document.title || '';

  window.addEventListener('beforeprint', () => {
    syncAll();
    preparePrintAvatars();
    const treeTitle = byId('treeTitle');
    if (treeTitle && treeTitle.textContent){
      document.title = treeTitle.textContent.trim();
    }
  });

  window.addEventListener('afterprint', () => {
    document.title = originalTitle;
  });

  const mql = window.matchMedia && window.matchMedia('print');
  if (mql && mql.addListener){
    mql.addListener(q => {
      if (q.matches){
        syncAll();
        preparePrintAvatars();
      }
    });
  }

byId('printBtn')?.addEventListener('click', () => {
  // حاول جلب العائلة الحالية
  const all = Model.exportFamilies?.() || {};
  const key = Model.getSelectedKey?.() || 'family1';
  const fam = all[key];

  // لو ما في عائلة واضحة، اطبع مباشرة (احتياط)
  if (!fam) {
    syncAll();
    window.print();
    return;
  }

  // اسم للعرض في العنوان (متوافق مع منطق io.js)
  const treeTitle = byId('treeTitle');
  const rawFamilyName = (treeTitle?.textContent || '').trim() || String(
    fam.title || fam.familyName || fam.fullRootPersonName || fam.rootPerson?.name || key
  ).trim();

  // =========================
  // VALIDATION قبل الطباعة — نفس فكرة التصدير
  // =========================
  const { errors, warnings } = validateFamily(fam);

  setValidationResults(`print:${key}`, {
    title: `تنبيهات التحقق — قبل الطباعة (${rawFamilyName || key})`,
    errors,
    warnings,
    meta: { familyKey: key, ts: Date.now() }
  });

  const sum = getValidationSummary(`print:${key}`);

  // لو فيه أي تنبيهات (حتى info) => امنع الطباعة + رسالة + نافذة تأكيد
  if (sum.counts.total > 0) {
    const msg = vcToastSummaryText(sum);

    // (2) الرسالة
    showError(`تم منع الطباعة مؤقتًا: ${msg}`);

    // (3) نافذة التأكيد
    (async () => {
      const res = await showConfirmModal({
        title: 'تنبيهات قبل الطباعة',
        message:
          `يوجد تنبيهات في العائلة الحالية.\n\n` +
          `${msg}\n\n` +
          `اختر أحد الخيارين:`,
        confirmText: 'عرض التنبيهات',
        cancelText: 'طباعة',
        variant: 'danger',
        closeOnBackdrop: true,
        closeOnEsc: true,
        defaultFocus: 'confirm'
      });

      if (res === 'confirm') {
        openValidationModal(`print:${key}`);
        return;
      }

      if (res === 'cancel') {
        // طباعة رغم التنبيهات
        syncAll();
        window.print();
        return;
      }

      // res === 'dismiss' => لا شيء
    })();

    // (1) منع الطباعة الآن
    return;
  }

  // لا توجد تنبيهات => طباعة مباشرة بدون رسالة ولا نافذة
  syncAll();
  window.print();
});

  return {};
}
