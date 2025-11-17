// واجهة رفيعة: تبني الهيكل وتربط الأحداث ثم تفتح المودال
import { ModalManager } from './modalManager.js';
import { buildFamilyModalSkeleton } from './modal.view.js';
import { wireFamilyModal } from './modal.controller.js';

export function createFamilyCreatorModal(
  editKey,
  { initialData = null, onSave = null, onCancel = null } = {}
){
  const modal = buildFamilyModalSkeleton();           // DOM كامل
  (document.querySelector('.container') || document.body).appendChild(modal);

  wireFamilyModal({ modal, initialData, editKey, onSave, onCancel }); // ربط كل شيء
  ModalManager.open(modal);
  return modal;
}
