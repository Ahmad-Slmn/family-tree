// src/features/photoGallery.js
import { byId, showError } from '../utils.js';

/* =========================
   1) قائمة الصور الجاهزة
   ========================= */
export const PRESET_PHOTOS = [
  /* الأجداد (أعلى الجيل) */
  { id: 'grandfather',   src: 'src/assets/images/Grandfather-avatar.png',   label: 'جد',             category: 'family' },
  { id: 'grandmother',   src: 'src/assets/images/Grandmother-avatar.png',   label: 'جدة',            category: 'family' },

  /* الوالدان */
  { id: 'father',        src: 'src/assets/images/father-avatar.png',        label: 'أب',             category: 'family' },
  { id: 'mother',        src: 'src/assets/images/mother-avatar.png',        label: 'أم',             category: 'family' },

  /* الأعمام والعمّات + الأخوال والخالات */
  { id: 'uncle',         src: 'src/assets/images/Uncl-avatar.png',          label: 'عم',             category: 'family' },
  { id: 'aunt',          src: 'src/assets/images/Aunt-avatar.png',          label: 'عمة',            category: 'family' },
  { id: 'maternal-uncle',src: 'src/assets/images/Maternal-Uncle-avatar.png',label: 'خال',           category: 'family' },
  { id: 'maternal-aunt', src: 'src/assets/images/maternal-aunt-avatar.png', label: 'خالة',          category: 'family' },

  /* الزوج/الزوجة */
  { id: 'husband',       src: 'src/assets/images/husband-avatar.png',       label: 'زوج',            category: 'family' },
  { id: 'wife',          src: 'src/assets/images/wife-avatar.png',          label: 'زوجة',           category: 'family' },

  /* الإخوة والأخوات */
  { id: 'brother',       src: 'src/assets/images/brother-avatar.png',       label: 'أخ',             category: 'family' },
  { id: 'sister',        src: 'src/assets/images/sister-avatar.png',        label: 'أخت',            category: 'family' },

  /* أبناء العم/الخال */
  { id: 'cousin-boy',    src: 'src/assets/images/cousin-boy-avatar.png',    label: 'ابن عم/خال',     category: 'family' },
  { id: 'cousin-girl',   src: 'src/assets/images/cousin-girl-avatar.png',   label: 'ابنة عم/خال',    category: 'family' },

  /* الأبناء */
  { id: 'son',           src: 'src/assets/images/son-avatar.png',           label: 'ابن',            category: 'family' },
  { id: 'daughter',      src: 'src/assets/images/Daughter-avatar.png',      label: 'بنت',            category: 'family' },

  /* الأحفاد */
  { id: 'grandson',      src: 'src/assets/images/grandson-avatar.png',      label: 'حفيد',           category: 'family' },
  { id: 'granddaughter', src: 'src/assets/images/granddaughter-avatar.png', label: 'حفيدة',          category: 'family' },

  /* الفئات العمرية العامة – age */
  { id: 'age-young-boy',     src: 'src/assets/images/young-boy-avatar.png',        label: 'ولد صغير',            category: 'age' },
  { id: 'age-young-girl',    src: 'src/assets/images/young-girl-avatar.png',       label: 'بنت صغيرة',           category: 'age' },
  { id: 'age-young-man',     src: 'src/assets/images/young-man-avatar.png',        label: 'شاب',                 category: 'age' },
  { id: 'age-young-woman',   src: 'src/assets/images/young-woman-avatar.png',      label: 'شابة',                category: 'age' },
  { id: 'age-elderly-man',   src: 'src/assets/images/elderly-man-avatar.png',      label: 'رجل كبير',            category: 'age' },
  { id: 'age-elderly-woman', src: 'src/assets/images/elderly-woman-avatar.png',    label: 'امرأة كبيرة',         category: 'age' },
  { id: 'age-newborn',       src: 'src/assets/images/newborn-baby-avatar.png',     label: 'مولود',               category: 'age' },
  { id: 'age-swaddled',      src: 'src/assets/images/swaddled-newborn-avatar.png', label: 'مولود ملفوف ببطانية', category: 'age' },

  /* الصور المحايدة – neutral */
  { id: 'neutral-person',   src: 'src/assets/images/neutral-person-avatar.png',   label: 'صورة محايدة',           category: 'neutral' },
  { id: 'neutral-man',      src: 'src/assets/images/neutral-man-avatar.png',      label: 'صورة محايدة (ذكر)',     category: 'neutral' },
  { id: 'neutral-woman',    src: 'src/assets/images/neutral-woman-avatar.png',    label: 'صورة محايدة (أنثى)',    category: 'neutral' },
  { id: 'neutral-default',  src: 'src/assets/images/neutral-default-avatar.png',  label: 'صورة افتراضية',         category: 'neutral' }
];

export const CATEGORY_LABELS = {
  all:     'كل الصور',
  family:  'أفراد الأسرة',
  age:     'الفئات العمرية العامة',
  neutral: 'صور محايدة'
};

// ترتيب عرض الأقسام في وضع "كل الصور"
export const CATEGORY_ORDER = ['family', 'age', 'neutral'];

// نصوص العنوان وحقل البحث حسب التصنيف
const CATEGORY_TEXT = {
  all: {
    subtitle:    'اختر صورة تقريبية من جميع التصنيفات (أفراد الأسرة، الفئات العمرية، صور محايدة) لتحسين شكل الشجرة.',
    placeholder: 'ابحث بالاسم أو الوصف (جد، أب، شاب، مولود، صورة محايدة...)'
  },
  family: {
    subtitle:    'اختر صورة تمثل دور الشخص في العائلة (جد، أب، أم، ابن، ابنة، عم، خالة...).',
    placeholder: 'ابحث حسب الدور العائلي (أب، أم، جد، حفيدة، عم، خالة...)'
  },
  age: {
    subtitle:    'اختر صورة تمثل الفئة العمرية (مولود، طفل، شاب، رجل كبير، امرأة كبيرة...).',
    placeholder: 'ابحث حسب الفئة العمرية (طفل، شابة، مولود، كبير في السن...)'
  },
  neutral: {
    subtitle:    'اختر صورة رمزية عامة ومحايدة للأشخاص غير المحددين بدور أو عمر واضح.',
    placeholder: 'ابحث عن صور محايدة (صورة عامة، ذكر محايد، أنثى محايدة، افتراضية...)'
  }
};

/* =========================
   2) أدوات مساعدة عامة
   ========================= */

// تطبيع نص قصير للبحث بالعربية
function normAr(s = '') {
  return String(s).toLocaleLowerCase('ar');
}

// تحديث عنوان المعرض وPlaceholder البحث حسب التصنيف
function applyCategoryText(cat = 'all') {
  const cfg         = CATEGORY_TEXT[cat] || CATEGORY_TEXT.all;
  const subtitleEl  = document.querySelector('.gallery-subtitle');
  const searchInput = byId('photoGallerySearch');

  if (subtitleEl && cfg.subtitle) {
    subtitleEl.textContent = cfg.subtitle;
  }
  if (searchInput && cfg.placeholder) {
    searchInput.placeholder = cfg.placeholder;
  }
}

// تهيئة قائمة التصنيفات من البيانات الفعلية
function initCategorySelect(selectEl) {
  if (!selectEl) return;

  const usedCats = new Set(PRESET_PHOTOS.map(p => p.category).filter(Boolean));
  const options  = ['all', ...Array.from(usedCats)];

  selectEl.innerHTML = '';
  options.forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = CATEGORY_LABELS[value] || value;
    selectEl.appendChild(opt);
  });

  selectEl.value = 'all';
}

// إنشاء زر صورة في الشبكة
function createPhotoButton(preset) {
  const label = preset.label || '';
  const btn   = document.createElement('button');

  btn.type = 'button';
  btn.className = 'photo-gallery-item';
  btn.dataset.src = preset.src;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-selected', 'false');

  btn.innerHTML = `
    <span class="photo-gallery-thumb-wrap">
      <img src="${preset.src}" alt="${label}" class="photo-gallery-thumb">
      <span class="photo-gallery-preview-ico"
            data-preview-src="${preset.src}"
            title="معاينة الصورة">
        <i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
      </span>
    </span>
    <span class="photo-gallery-label" title="${label}">${label}</span>
  `;

  return btn;
}

// تحديث عدّاد النتائج أعلى الشبكة
function updateMeta(count, category = 'all') {
  const meta = byId('photoGalleryMeta');
  if (!meta) return;

  const labelCat = (category === 'all')  ? 'جميع التصنيفات'
    : (CATEGORY_LABELS[category] || category);

  meta.textContent = count ? `${count} صورة – ${labelCat}`
    : `لا توجد صور في "${labelCat}"`;
}

/* =========================
   3) إغلاق مودال المعرض
   ========================= */
function closeGalleryModal() {
  const modal       = byId('photoGalleryModal');
  const grid        = byId('photoGalleryGrid');
  const searchInput = byId('photoGallerySearch');
  const clearBtn    = byId('photoGalleryClear');

  if (!modal) return;

  // لو كان التركيز داخل المودال بلّره قبل الإخفاء
  const active = document.activeElement;
  if (active && modal.contains(active)) {
    active.blur();
  }

  // إعادة البحث للوضع الافتراضي
  if (searchInput) searchInput.value = '';
  if (clearBtn)    clearBtn.hidden  = true;

  const categorySelect = byId('photoGalleryCategory');
  if (categorySelect) {
    categorySelect.value = 'all';
    modal.__galleryCategory = 'all';
  }

  // إعادة النصوص الافتراضية لتصنيف "الكل"
  applyCategoryText('all');

  // إعادة بناء الشبكة لحالة بلا بحث
  if (grid) {
    buildGalleryGrid('', '', 'all');
  }

  // إخفاء المودال + ARIA
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  modal.inert = true;

  // إعادة التركيز للعنصر السابق إن وجد
  const prev = modal.__prevFocus;
  if (prev && typeof prev.focus === 'function') {
    try { prev.focus(); } catch {}
  }

  modal.__prevFocus       = null;
  modal.__galleryOnSelect = null;
  modal.__galleryIndex    = 0;
}

/* =========================
   4) طبقة معاينة الصورة
   ========================= */
function openGalleryPreview(src) {
  const modal = byId('photoGalleryModal');
  if (!modal || !src) return;

  // إزالة أي طبقة معاينة سابقة
  const old = byId('photoGalleryPreviewLayer');
  if (old) old.remove();

  const layer = document.createElement('div');
  layer.id = 'photoGalleryPreviewLayer';
  layer.className = 'photo-gallery-preview-layer';

  layer.innerHTML = `
    <div class="photo-gallery-preview-box">
      <button type="button"
              id="pgPrevClose"
              class="close-button photo-gallery-preview-close">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
      <div class="photo-gallery-preview-inner">
        <img src="${src}" alt="معاينة الصورة" class="photo-gallery-preview-img">
      </div>
    </div>
  `;

  document.body.appendChild(layer);

  const close = () => layer.remove();

  // إغلاق عند الضغط على الخلفية
  layer.addEventListener('click', (e) => {
    if (e.target === layer) close();
  });

  // زر الإغلاق
  const closeBtn = byId('pgPrevClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      close();
    });
  }

  // دعم زر Esc
  layer.tabIndex = -1;
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  layer.focus();
}

/* =========================
   5) Skeleton للشبكة
   ========================= */
function showGallerySkeleton(grid, count = 8) {
  if (!grid) return;
  grid.innerHTML = '';
  delete grid.dataset.selectedIndex;

  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'photo-gallery-item skeleton';
    item.setAttribute('aria-hidden', 'true');

    item.innerHTML = `
      <span class="photo-gallery-thumb-wrap">
        <span class="photo-gallery-thumb photo-gallery-thumb-skeleton"></span>
      </span>
      <span class="photo-gallery-label photo-gallery-label-skeleton"></span>
    `;

    grid.appendChild(item);
  }
}

/* =========================
   6) بناء شبكة المعرض + البحث
   ========================= */
function buildGalleryGrid(searchTerm = '', _currentSrc = '', category = 'all') {
  const grid = byId('photoGalleryGrid');
  if (!grid) return;

  const term = normAr(searchTerm);
  grid.innerHTML = '';
  delete grid.dataset.selectedIndex;

  // 1) فلترة وفق التصنيف + البحث
  const filtered = PRESET_PHOTOS.filter((preset) => {
    const label = preset.label || '';
    const cat   = preset.category || 'family';

    if (category !== 'all' && cat !== category) return false;
    if (term && !normAr(label).includes(term)) return false;

    return true;
  });

  // تحديث عدّاد النتائج
  updateMeta(filtered.length, category);

  // لا توجد نتائج بعد الفلترة
  if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'photo-gallery-empty';
    p.textContent = 'لا توجد صور مطابقة لبحثك.';
    grid.appendChild(p);
    return;
  }

  // 2) حالة تصنيف واحد (≠ all) — شبكة مسطّحة بدون عناوين أقسام
  if (category !== 'all') {
    filtered.forEach((preset) => {
      grid.appendChild(createPhotoButton(preset));
    });
    return;
  }

  // 3) حالة "كل الصور" — تقسيم حسب التصنيف مع عناوين أقسام
  const usedCats = Array.from(
    new Set(filtered.map(p => p.category || 'family'))
  );

  const orderedCats = [
    ...CATEGORY_ORDER.filter(cat => usedCats.includes(cat)),
    ...usedCats.filter(cat => !CATEGORY_ORDER.includes(cat))
  ];

  let totalButtons = 0;

  orderedCats.forEach((cat) => {
    const catItems = filtered.filter(p => (p.category || 'family') === cat);
    if (!catItems.length) return;

    const h = document.createElement('h3');
    h.className = 'photo-gallery-section-title';
    h.textContent = CATEGORY_LABELS[cat] || cat;
    grid.appendChild(h);

    catItems.forEach((preset) => {
      grid.appendChild(createPhotoButton(preset));
      totalButtons += 1;
    });
  });

  if (totalButtons === 0) {
    const p = document.createElement('p');
    p.className = 'photo-gallery-empty';
    p.textContent = 'لا توجد صور مطابقة لبحثك.';
    grid.appendChild(p);
  }
}

/* =========================
   7) واجهة فتح المعرض
   ========================= */
export function openPhotoGallery({ onSelect, currentSrc } = {}) {
  if (typeof onSelect !== 'function') return;

  const modal          = byId('photoGalleryModal');
  const grid           = byId('photoGalleryGrid');
  const closeBtn       = byId('closeGallery');
  const searchInput    = byId('photoGallerySearch');
  const clearBtn       = byId('photoGalleryClear');
  const categorySelect = byId('photoGalleryCategory');

  if (!modal || !grid || !closeBtn) return;

  // تهيئة قائمة الأقسام مرة واحدة
  if (!modal.__catInitDone) {
    initCategorySelect(categorySelect);
    modal.__catInitDone = true;
  }

  // التصنيف الحالي
  modal.__galleryCategory = categorySelect ? (categorySelect.value || 'all') : 'all';

  // حفظ العنصر الذي عليه التركيز قبل فتح المعرض
  modal.__prevFocus = document.activeElement instanceof HTMLElement  ? document.activeElement
    : null;

  // ربط الأحداث مرة واحدة فقط
  if (!modal.__galleryBound) {
    modal.__galleryBound = true;

    // إغلاق عند الضغط على الخلفية
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeGalleryModal();
    });

    // زر الإغلاق
    closeBtn.addEventListener('click', () => {
      closeGalleryModal();
    });

    // اختيار صورة من الشبكة + معاينة
    grid.addEventListener('click', (e) => {
      // 1) الضغط على أيقونة المعاينة
      const previewIco = e.target.closest('.photo-gallery-preview-ico');
      if (previewIco) {
        e.preventDefault();
        e.stopPropagation();
        const host = previewIco.closest('[data-src]');
        const src  = previewIco.dataset.previewSrc || host?.dataset.src;
        if (src) openGalleryPreview(src);
        return;
      }

      // 2) الضغط على العنصر نفسه = اختيار الصورة
      const btn = e.target.closest('[data-src]');
      if (!btn) return;

      const src = btn.dataset.src;
      if (!src) return;

      // إزالة التحديد السابق
      grid.querySelectorAll('.photo-gallery-item.is-selected').forEach((el) => {
        el.classList.remove('is-selected');
        el.setAttribute('aria-selected', 'false');
      });

      // تمييز العنصر الحالي
      btn.classList.add('is-selected');
      btn.setAttribute('aria-selected', 'true');

      const handler = modal.__galleryOnSelect;
      if (typeof handler === 'function') {
        handler(src);
      }
    });

    // البحث داخل المعرض (يحترم التصنيف الحالي)
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value || '';
        const cat  = modal.__galleryCategory || (categorySelect ? (categorySelect.value || 'all') : 'all');

        buildGalleryGrid(term, '', cat);
        modal.__galleryIndex = 0;

        if (clearBtn) {
          clearBtn.hidden = !term;
        }
      });
    }

    // تغيير التصنيف
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        const cat  = e.target.value || 'all';
        const term = searchInput ? (searchInput.value || '') : '';

        modal.__galleryCategory = cat;
        buildGalleryGrid(term, '', cat);
        modal.__galleryIndex = 0;

        // تحديث العنوان وPlaceholder حسب التصنيف
        applyCategoryText(cat);
      });
    }

    // مسح حقل البحث (دون تغيير التصنيف الحالي)
    if (clearBtn && searchInput) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.hidden   = true;

        const cat = modal.__galleryCategory || (categorySelect ? (categorySelect.value || 'all') : 'all');
        buildGalleryGrid('', '', cat);
        modal.__galleryIndex = 0;

        const firstItem = grid.querySelector('.photo-gallery-item');
        if (firstItem && typeof firstItem.focus === 'function') {
          modal.__galleryIndex = 0;
          firstItem.focus();
        }
      });
    }

    // تنقّل لوحة المفاتيح داخل المودال
    modal.addEventListener('keydown', (e) => {
      const handler = modal.__galleryOnSelect;
      const items   = Array.from(grid.querySelectorAll('.photo-gallery-item'));

      if (!items.length) return;

      const key = e.key;
      const max = items.length - 1;
      let idx   = typeof modal.__galleryIndex === 'number' ? modal.__galleryIndex
        : 0;

      if (key === 'Escape') {
        e.preventDefault();
        closeGalleryModal();
        return;
      }

      if (key === 'Enter' || key === ' ') {
        const current = document.activeElement;
        if (current && current.dataset && current.dataset.src && typeof handler === 'function') {
          e.preventDefault();
          handler(current.dataset.src);
        }
        return;
      }

      if (key === 'ArrowRight' || key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1 > max) ? 0 : idx + 1;
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        e.preventDefault();
        idx = (idx - 1 < 0) ? max : idx - 1;
      } else if (key === 'Home') {
        e.preventDefault();
        idx = 0;           // أول عنصر
      } else if (key === 'End') {
        e.preventDefault();
        idx = max;         // آخر عنصر
      } else {
        return;
      }

      modal.__galleryIndex = idx;
      items[idx].focus();
    });
  }

  // دالة الاستقبال في هذه الفتحة
  modal.__galleryOnSelect = async (src) => {
    try {
      await onSelect(src);
      closeGalleryModal();
    } catch {
      showError('تعذّر اختيار الصورة.');
    }
  };

  // بناء الشبكة حسب قيمة البحث الحالية (إن وُجدت)
  const initialTerm = searchInput ? (searchInput.value || '') : '';
  const initialCat  = categorySelect ? (categorySelect.value || 'all') : 'all';
  modal.__galleryCategory = initialCat;

  if (!modal.__galleryFirstLoaded) {
    modal.__galleryFirstLoaded = true;
    showGallerySkeleton(grid);

    setTimeout(() => {
      buildGalleryGrid(initialTerm, '', initialCat);
      const items = Array.from(grid.querySelectorAll('.photo-gallery-item'));
      modal.__galleryIndex = items.length ? 0 : 0;
    }, 80);
  } else {
    buildGalleryGrid(initialTerm, '', initialCat);
    const items = Array.from(grid.querySelectorAll('.photo-gallery-item'));
    modal.__galleryIndex = items.length ? 0 : 0;
  }

  // تطبيق النصوص المناسبة للتصنيف الحالي عند الفتح
  applyCategoryText(initialCat);

  // إظهار المودال + السماح بالتركيز داخله
  modal.classList.add('show');
  modal.inert = false;
  modal.removeAttribute('aria-hidden');

  // تركيز عند فتح المعرض: على خانة البحث إن وُجدت
  if (searchInput && typeof searchInput.focus === 'function') {
    searchInput.focus();
  } else if (typeof modal.focus === 'function') {
    modal.focus();
  }
}
