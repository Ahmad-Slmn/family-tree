// model/families.js
// واجهة توافق خلفيّة لملف العائلات القديم
// تعيد التصدير من core (منطق الدومين) + store (التخزين)
// بحيث تبقى كل الاستيرادات القديمة تعمل كما هي

// 1) منطق الدومين (القواعد العامة + التطبيع + النَّسَب)
export {
  // النسخة
  SCHEMA_VERSION,

  // الـ bio والتسميات
  DEFAULT_BIO,
  LABELS,
  normalizeLifeDatesOnBio,
  cloneBio,
  ensureBio,
  ensureFamilyBios,
  setChildDefaults,

  // تطبيع العائلة والـ lineage
  migrate,
  normalizeChild,
  normalizeChildForLoad,
  normalizeWife,
  normalizeWifeForLoad,
  normalizeNewFamilyForLineage,
  normalizeFamilyPipeline,

  // الفهارس والروابط
  ensureIds,
  buildPersonsIndex,
  sortedAncestors,
  ancestorsNames,
  linkAncestorsChain,
  ensureRealMotherForRoot,
  ensureRealParentsForWives,
  linkParentChildLinksFromOldShape,
  buildRealLinks,
  linkRootPersonWives,

  // نصوص/قوائم + تكرار + أدوات إضافية
  splitTextList,
  splitTextToNameObjects,
  getLineageConfig,
  getDuplicatesConfig,
  findDuplicatesInFamily,
  stripPhotosDeep
} from './families.core.js';

// 2) التخزين + العائلات الحيّة + اختيار العائلة
export {
  // مفاتيح التخزين + خريطة العائلات
  PERSIST_FAMILIES_KEY,
  families,

  // وصول عام للعائلات
  getFamilies,
  getFamily,

  // إنشاء/تعديل/حذف/استيراد/تصدير
  saveFamily,
  deleteFamily,
  commitFamily,
  importFamilies,
  exportFamilies,

  // التحميل والحفظ الكامل (IndexedDB)
  savePersistedFamilies,
  loadPersistedFamilies,
  loadPersistedFamiliesExport,

  // مفاتيح العائلات + تهيئة المخزن
  generateFamilyKey,
  getSelectedKey,
  setSelectedKey,
  initFamiliesStore
} from '../storage/families.store.js';
