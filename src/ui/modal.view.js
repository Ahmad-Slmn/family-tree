// src/ui/modal.view.js
// نقطة تجميع واجهة المودال فقط (إعادة تصدير الوحدات الفرعية)

// هيكل المودال + الأدوات العامة للأزرار
export {
  buildFamilyModalSkeleton,
  ensureBtnLabelSpan,
  markGlobalDirty,
} from './modal.skeleton.js';

// منطق سنة/تاريخ + التقاط label للحقل
export {
  getFieldLabelEl,
  initYearOnlyToggles,
  attachYearModeToggle,
} from './modal.yearToggle.js';

// نظام الاتساخ العام (dirty-dot + المراقبين)
export {
  ensureDirtyDot,
  snapshotFieldValue,
  initDirtyIndicators,
  disposeDirtyIndicators,
} from './modal.dirtyIndicators.js';

// أدوات meta-block العامة (لو احتجتها من خارج وحدات البلوكات)
export {
  readVal,
  makeDatasetIO,
  renderMetaGrid,
  computeAgeFromBirthDate,
  makeMetaBlock,
} from './modal.metaBlock.js';

// كتل الجد/الأب/الأم/الطفل/الزوجة
export { createAncestorItem } from './modal.blocks.ancestor.js';
export { createFatherBlock }   from './modal.blocks.father.js';
export { createMotherBlock }   from './modal.blocks.mother.js';
export {
  createChildEditItem,
  updateChildrenCount,
} from './modal.blocks.child.js';
export { createWifeBlock }     from './modal.blocks.wife.js';
