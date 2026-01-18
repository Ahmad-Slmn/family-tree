// bio-sections.utils.js
// أدوات مشتركة لأقسام السيرة:
// - إدارة مراجع الملفات (tmp:/idb:/ready-url)
// - كاش معاينة ObjectURL لملفات tmp قبل الحفظ
// - ترقية tmp -> idb بشكل موحّد
// - أدوات واجهة عامة (تاريخ/طول نص/سلايدر)
// - أدوات الملفات (تصنيف/تحقق/فتح/تحميل)

//
// 1) أساسيات صغيرة
//
export const nowIso = () => new Date().toISOString();
export const safeStr = (v) => String(v ?? '').trim();
export const shallowArr = (v) => (Array.isArray(v) ? v.slice() : []);

export function splitCommaTags(s) {
  return String(s ?? '')
    .split(',')
    .map((t) => String(t).trim())
    .filter(Boolean);
}


export function isEmptyRecordByKeys(rec, keys = []) {
  if (!rec) return true;

  for (const k of keys) {
    const v = rec?.[k];

    if (Array.isArray(v)) {
      if (v.length) return false;
      continue;
    }

    if (typeof v === 'string') {
      if (safeStr(v)) return false;
      continue;
    }

    if (v != null) return false;
  }

  return true;
}

export const isReadyUrl = (ref) => /^(data:|blob:|https?:)/.test(String(ref ?? ''));
export const isTmpRef = (ref) => String(ref ?? '').startsWith('tmp:');
export const isIdbRef = (ref) => String(ref ?? '').toLowerCase().startsWith('idb:');

// يبني عنصر label + icon + title فوق أي حقل
export function wrapField(fieldEl, {
  title = '',
  icon = '',              // مثال: 'fa-briefcase'
  className = 'biosec-meta-field',
  labelClass = 'biosec-meta-label',
  iconClass = 'biosec-meta-icon',
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = className;

  if (title) {
    const lab = document.createElement('label');
    lab.className = labelClass;

    if (fieldEl?.id) lab.setAttribute('for', fieldEl.id);

    if (icon) {
      const i = document.createElement('i');
      i.className = `fa-solid ${icon} ${iconClass}`;
      i.setAttribute('aria-hidden', 'true');
      lab.appendChild(i);
    }

    const t = document.createElement('span');
    t.textContent = title;
    lab.appendChild(t);

    wrap.appendChild(lab);
  }

  wrap.appendChild(fieldEl);
  return wrap;
}

// ✅ Field wrapper (Head: Label + Icon) - موحّد لكل الأقسام
export function withFieldHead(node, { label = '', icon = 'fa-circle-info' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'biosec-field';

  const head = document.createElement('div');
  head.className = 'biosec-field-head';

  const ic = document.createElement('i');
  ic.className = `fa-solid ${icon || 'fa-circle-info'} biosec-field-icon`;
  ic.setAttribute('aria-hidden', 'true');

  const lb = document.createElement('div');
  lb.className = 'biosec-field-label';
  lb.textContent = label || '';

  head.append(ic, lb);
  wrap.append(head, node);

  return wrap;
}

// يبني بلوك معاينة: عنوان + أيقونة فوق أي عنصر (لـ Preview)
export function wrapPreviewBlock(contentEl, {
  title = '',
  icon = '',                 // مثال: 'fa-calendar-days'
  className = 'biosec-preview-block',
  headerClass = 'biosec-preview-block-header',
  titleClass = 'biosec-preview-block-title',
  iconClass = 'biosec-preview-block-icon',
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = className;

  if (title) {
    const header = document.createElement('div');
    header.className = headerClass;

    if (icon) {
      const i = document.createElement('i');
      i.className = `fa-solid ${icon} ${iconClass}`;
      i.setAttribute('aria-hidden', 'true');
      header.appendChild(i);
    }

    const t = document.createElement('span');
    t.className = titleClass;
    t.textContent = title;
    header.appendChild(t);

    wrap.appendChild(header);
  }

  if (contentEl) wrap.appendChild(contentEl);
  return wrap;
}

//
// 2) كاش مؤقت لملفات tmp: (مع ObjectURL للمعاينة)
// - add(file): يرجع tmpRef
// - get(tmpRef): يرجع { file, url, meta }
// - revoke(tmpRef): يلغي ObjectURL ويحذف السجل
// - cleanup(refs): ينظف أي tmp refs ضمن قائمة
//
export function createTempObjectURLCache({ prefix = 'tmp:' } = {}) {
  const map = new Map(); // tmpRef -> { file, url, meta }

  const genTmpRef = () => {
    if (window.crypto?.randomUUID) return prefix + window.crypto.randomUUID();
    return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  const add = (file, meta = null) => {
    const tmpRef = genTmpRef();
    const url = URL.createObjectURL(file);
    map.set(tmpRef, { file, url, meta });
    return tmpRef;
  };

  const revoke = (tmpRef) => {
    const key = String(tmpRef ?? '');
    const rec = map.get(key);
    if (rec?.url) {
      try { URL.revokeObjectURL(rec.url); } catch {}
    }
    map.delete(key);
  };

  const cleanup = (refs = []) => {
    const list = Array.isArray(refs) ? refs : [];
    for (const r of list) {
      const s = String(r ?? '');
      if (isTmpRef(s)) revoke(s);
    }
  };

  const get = (tmpRef) => map.get(String(tmpRef ?? '')) || null;

  return { add, revoke, cleanup, get, _map: map };
}

//
// 3) أدوات واجهة صغيرة للمصادر (تجميع/فواصل)
//
export function findImageIndex(imagesOnly, ref) {
  const list = Array.isArray(imagesOnly) ? imagesOnly : [];
  const r = String(ref ?? '');
  for (let i = 0; i < list.length; i++) {
    if (String(list[i]) === r) return i;
  }
  return -1;
}

export function makeGroupTitle(text, className = 'source-files-group-title') {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = String(text ?? '');
  return el;
}

export function makeDivider(className = 'source-files-group-divider') {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

//
// 4) Factory موحّد لكل قسم: tempCache + resolver + (اختياري) metaCache
// - metaCache مفيد للمصادر لتخزين ميتاداتا tmp/idb داخل Map خارجي
//
export function createSectionTempAndResolver({ prefix = 'tmp:', getIdbUrl, metaCache = null } = {}) {
  const tempCache = createTempObjectURLCache({ prefix });

  const addTemp = (file, meta = null) => {
    const tmpRef = tempCache.add(file, meta);
    if (metaCache && meta) metaCache.set(tmpRef, meta);
    return tmpRef;
  };

  const revokeTemp = (ref) => {
    const r = String(ref ?? '');
    tempCache.revoke(r);
    if (metaCache) metaCache.delete(r);
  };

  const cleanupTmp = (refs = []) => {
    const list = Array.isArray(refs) ? refs : [];
    for (const r of list) {
      const s = String(r ?? '');
      if (isTmpRef(s)) revokeTemp(s);
    }
  };

  const resolve = createRefResolver({ tempCache, getIdbUrl });

  return { tempCache, addTemp, revokeTemp, cleanupTmp, resolve };
}

//
// 5) ترقية مراجع tmp -> idb (قبل تثبيت البيانات)
// - يحافظ على ترتيب القائمة
// - إذا فشل أي عنصر: يوقف ويرجع ok:false (سلوك موحد)
//
export async function upgradeTmpRefs(
  refs,
  { tempCache, isTmpRefFn = isTmpRef, putFn, onAfterPut, onFail, revokeFn } = {}
) {
  const list = Array.isArray(refs) ? refs : [];
  const out = [];

  for (const r of list) {
    const ref = String(r ?? '');

    if (!isTmpRefFn(ref)) {
      out.push(ref);
      continue;
    }

    const rec = tempCache?.get?.(ref);
    if (!rec?.file) {
      const err = new Error('Missing tmp file record');
      if (typeof onFail === 'function') onFail(ref, err);
      return { ok: false, refs: out, error: err };
    }

    try {
      const idbRef = await putFn?.(rec, ref);
      if (idbRef) {
        const s = String(idbRef);
        out.push(s);
        if (typeof onAfterPut === 'function') await onAfterPut(s, rec, ref);
      }
    } catch (e) {
      if (typeof onFail === 'function') onFail(ref, e);
      return { ok: false, refs: out, error: e };
    } finally {
      try {
        if (typeof revokeFn === 'function') revokeFn(ref);
        else tempCache?.revoke?.(ref);
      } catch {}
    }
  }

  return { ok: true, refs: out, error: null };
}

//
// 6) توحيد عرض بطاقة (Preview/Edit) + نص زر الحفظ + زر الإلغاء
// - مفيد لأقسام البطاقات (قصص/مصادر)
//
export function applyCardEditMode({
  card,
  isEditing,
  isDirty,
  previewBox,
  editBox,
  datesEl,
  saveBtn,
  cancelBtn,
  labels = {},
  icons = {},
  classes = {}
} = {}) {
  const toEdit = !!isEditing;

  card?.classList?.toggle('biosec-card--edit', toEdit);
  card?.classList?.toggle('biosec-card--preview', !toEdit);

  if (classes.edit) card?.classList?.toggle(classes.edit, toEdit);
  if (classes.preview) card?.classList?.toggle(classes.preview, !toEdit);

  if (previewBox) previewBox.style.display = toEdit ? 'none' : '';
  if (editBox) editBox.style.display = toEdit ? '' : '';

  // ملاحظة: بعض الأقسام تستخدم datesEl داخل edit header (إخفائه عند التحرير)
  if (datesEl) datesEl.style.display = toEdit ? 'none' : '';

  const L = { edit: 'تعديل', close: 'إغلاق', save: 'حفظ', ...labels };
  const I = { edit: 'fa-pen-to-square', close: 'fa-xmark', save: 'fa-floppy-disk', ...icons };

  if (saveBtn) {
    const mode = !toEdit ? 'edit' : (!isDirty ? 'close' : 'save');
    const icon = mode === 'edit' ? I.edit : mode === 'close' ? I.close : I.save;
    const text = mode === 'edit' ? L.edit : mode === 'close' ? L.close : L.save;
    saveBtn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${text}</span>`;
  }

  if (cancelBtn) cancelBtn.style.display = toEdit && isDirty ? '' : 'none';
}


//
// 7) ميتاداتا ملفات tmp للمصادر (اسم/نوع/امتداد/تصنيف)
//
export function makeTempMetaFromFile(file) {
  const mime = String(file?.type ?? '').toLowerCase();
  const name = String(file?.name ?? '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : mimeToExt(mime);
  const kind = inferFileKind({ mime, ext });
  return { mime, name, ext, kind };
}

//
// 8) DOM: توسيع textarea تلقائياً حسب المحتوى
//
export function autoResizeTextareas(root, selector) {
  if (!root) return;
  const areas = root.querySelectorAll(selector);

  areas.forEach((ta) => {
    const resize = () => {
      const dsMin = Number(ta.dataset.minHeight || 0);

      const cssMinStr = window.getComputedStyle(ta).minHeight || '0px';
      const cssMin = parseFloat(cssMinStr) || 0;

      // الافتراضي العام لو العنصر biosec-textarea
      const fallback = ta.classList.contains('biosec-textarea') ? 94 : 0;

      // خذ الأكبر
      const min = Math.max(dsMin, cssMin, fallback);

      ta.style.height = 'auto';
      const next = Math.max(ta.scrollHeight, min);
      ta.style.height = next + 'px';
    };

    resize();

    ta.removeEventListener('input', ta._autoResizeHandler || (() => {}));
    ta._autoResizeHandler = resize;
    ta.addEventListener('input', resize);
  });
}


//
// 9) Resolver موحّد للمراجع: ready/tmp/idb
//
export async function resolveRefUrl(ref, { tempCache, getIdbUrl } = {}) {
  if (!ref) return null;
  const s = String(ref);

  if (isReadyUrl(s)) return s;
  if (isTmpRef(s)) return tempCache?.get?.(s)?.url || null;

  if (isIdbRef(s) && typeof getIdbUrl === 'function') {
    try {
      return (await getIdbUrl(s)) || null;
    } catch (e) {
      console.error('resolveRefUrl failed', e);
      return null;
    }
  }

  // fallback: قد يكون نص/مسار/معرّف آخر
  return s;
}

export const createRefResolver =
  ({ tempCache, getIdbUrl } = {}) =>
  (ref) =>
    resolveRefUrl(ref, { tempCache, getIdbUrl });

//
// 10) UI عامة: تاريخ الإنشاء + مؤشر طول النص + فتح سلايدر بعد الحل
//
export function formatCreatedAtLabel(iso, { prefix = 'أضيفت', formatter = null } = {}) {
  if (!iso) return '';
  const p = (prefix == null || prefix === '') ? 'أضيفت' : prefix;

  try {
    const body = (typeof formatter === 'function') ? formatter(iso)
      : new Date(iso).toLocaleString('ar');

    return body ? `${p} في ${body}` : '';
  } catch {
    return '';
  }
}


export function getTextLengthInfo(len, thresholds = {}, labels = {}) {
  const n = Number(len || 0);
  if (!n) return { label: labels.empty || 'بدون نص', level: 0 };

  const shortMax = Number(thresholds.short ?? 280);
  const medMax = Number(thresholds.medium ?? 800);

  if (n <= shortMax) return { label: labels.short || 'قصير', level: 1 };
  if (n <= medMax) return { label: labels.medium || 'متوسط', level: 2 };
  return { label: labels.long || 'طويل', level: 3 };
}

export async function openResolvedSlider({ viewer, refs, startIndex = 0, resolveUrl } = {}) {
  const list = Array.isArray(refs) ? refs : [];
  const urls = [];

  for (const r of list) {
    const u = await resolveUrl?.(r);
    if (u) urls.push(u);
  }

  if (urls.length) viewer?.open?.(urls, startIndex);
}

//
// 11) مساعدات الأنواع: labels/options + بناء select + إعادة بناء حسب المستخدم فعلياً
//
export function createTypeHelpers({ labels = {}, options = [], allValue = 'all', allLabel = 'كل الأنواع' } = {}) {
  const labelsMap = labels || {};
  const opts = Array.isArray(options) ? options.slice() : [];

  // ترتيب الأكواد حسب ترتيبها في options (للحفاظ على نفس ترتيب المشروع)
  const order = Object.fromEntries(
    opts
      .filter(([val]) => val && val !== allValue)
      .map(([val], i) => [val, i])
  );

  const getLabel = (code) => labelsMap[code] || '';

  const fillSelect = (selectEl) => {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    for (const [value, label] of opts) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      selectEl.appendChild(opt);
    }
  };

  const rebuildSelectFromUsed = (selectEl, usedCodes, currentValue, locale = 'ar') => {
    if (!selectEl) return allValue;

    const used = Array.from(
      new Set(Array.from(usedCodes || []).map(safeStr).filter(Boolean))
    );

    used.sort((a, b) => {
      const ia = order[a] !== undefined ? order[a] : 999;
      const ib = order[b] !== undefined ? order[b] : 999;
      if (ia !== ib) return ia - ib;
      return String(a).localeCompare(String(b), locale);
    });

    selectEl.innerHTML = '';

    // خيار "الكل"
    {
      const optAll = document.createElement('option');
      optAll.value = allValue;
      optAll.textContent = allLabel;
      selectEl.appendChild(optAll);
    }

    // الأنواع المستخدمة فقط
    for (const code of used) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = getLabel(code) || code;
      selectEl.appendChild(opt);
    }

    const prev = safeStr(currentValue) || allValue;
    const next = prev && prev !== allValue && used.includes(prev) ? prev : allValue;
    selectEl.value = next;
    return next;
  };

  return { getLabel, fillSelect, rebuildSelectFromUsed };
}

//
// 12) أدوات ملفات (امتداد/تحويل MIME/تصنيف/فتح/تحقق/ترتيب/اسم تحميل)
//
export function getRefExt(ref) {
  const s = String(ref ?? '');
  const m = s.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : '';
}

export function mimeToExt(mime = '') {
  const m = String(mime ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/msword') return 'doc';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/vnd.ms-excel') return 'xls';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (m === 'text/csv') return 'csv';
  if (m.startsWith('image/')) {
    const ext = m.split('/')[1] || '';
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return '';
}

// يرجع نوع الملف: image | audio | pdf | word | excel | other
export function inferFileKind({ mime = '', ext = '', ref = '' } = {}) {
  const m = String(mime ?? '').toLowerCase();
  const e = String(ext ?? '').toLowerCase();
  const r = String(ref ?? '').toLowerCase();

  const imgRe = /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)(?:\?|#|$)/;

  if (
    m.startsWith('image/') ||
    r.startsWith('data:image/') ||
    imgRe.test(r) ||
    /(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/.test(e)
  ) return 'image';

  const audioRe = /\.(mp3|wav|m4a|aac|ogg|flac|opus|weba|webm)(?:\?|#|$)/;
  if (
    m.startsWith('audio/') ||
    r.startsWith('data:audio/') ||
    audioRe.test(r) ||
    /(mp3|wav|m4a|aac|ogg|flac|opus|weba|webm)$/.test(e)
  ) return 'audio';

  if (
    m === 'application/pdf' ||
    r.startsWith('data:application/pdf') ||
    /\.pdf(?:\?|#|$)/.test(r) ||
    e === 'pdf'
  ) return 'pdf';

  if (m.includes('word') || /(doc|docx|rtf|odt)$/.test(e) || /\.(doc|docx|rtf|odt)(?:\?|#|$)/.test(r)) {
    return 'word';
  }

  if (m.includes('excel') || /(xls|xlsx|csv)$/.test(e) || /\.(xls|xlsx|csv)(?:\?|#|$)/.test(r)) {
    return 'excel';
  }

  return 'other';
}

// فتح تبويب بدون أن يتأثر بالـ popup blockers (لا تستخدم await قبل window.open)
export function openInNewTabSafe(urlPromise) {
  const w = window.open('about:blank', '_blank');
  if (w) w.opener = null;

  Promise.resolve(urlPromise)
    .then((url) => {
      if (!url) {
        try { w?.close(); } catch {}
        return;
      }
      try { w.location.href = url; } catch {}
    })
    .catch(() => {
      try { w?.close(); } catch {}
    });
}

// التحقق من الملف قبل الإضافة (حجم + MIME + امتداد كخطة بديلة)
export function isAllowedFile(
  file,
  { maxSizeMB = 20, allowedMime = [], allowedExt = [], allowImages = true, fallbackExtWhenMimeMissing = true } = {}
) {
  if (!file) return { ok: false, reason: 'ملف غير صالح.' };

  const maxSize = Number(maxSizeMB) * 1024 * 1024;
  if (file.size > maxSize) return { ok: false, reason: `حجم الملف كبير (أقصى حد ${maxSizeMB}MB).` };

  const type = String(file.type ?? '').toLowerCase();
  if (allowImages && type.startsWith('image/')) return { ok: true };

  const allowedMimeSet = new Set((allowedMime || []).map((s) => String(s).toLowerCase()));
  if (type && allowedMimeSet.has(type)) return { ok: true };

  if (!fallbackExtWhenMimeMissing) return { ok: false, reason: 'نوع الملف غير مدعوم.' };

  const name = String(file.name ?? '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const allowedExtSet = new Set((allowedExt || []).map((s) => String(s).toLowerCase()));

  if (ext && allowedExtSet.has(ext)) return { ok: true };

  return { ok: false, reason: 'نوع الملف غير مدعوم. ارفع صورة أو PDF أو Word/Excel.' };
}

// ترتيب refs: صور أولاً ثم باقي الأنواع (مع الحفاظ على ترتيب كل مجموعة)
export function groupRefsByKind(refs, getKind) {
  const list = Array.isArray(refs) ? refs.slice() : refs ? [refs] : [];
  const images = [];
  const others = [];

  for (const r of list) {
    const k = getKind ? getKind(r) : inferFileKind({ ref: r, ext: getRefExt(r) });
    (k === 'image' ? images : others).push(r);
  }
  return images.concat(others);
}

// بناء اسم ملف للتحميل (يدعم meta.name و meta.ext عند ملفات idb)
export function buildDownloadName(baseTitle, ref, mime, index, total, meta = {}) {
  const isSingle = Number(total || 0) === 1;

  const baseFromName =
    meta?.name && String(meta.name).trim() ? String(meta.name).replace(/\.[^/.]+$/, '') : '';

  const safeBase = baseFromName || safeStr(baseTitle || 'الوثيقة') || 'الوثيقة';

  const extFromCache = meta?.ext || '';
  const extFromRef = getRefExt(ref);
  const extFromMime = mimeToExt(mime);

  const ext = String(extFromCache || extFromRef || extFromMime || '').replace(/^\./, '');
  const suffix = isSingle ? '' : ` (${Number(index || 0) + 1})`;

  return ext ? `${safeBase}${suffix}.${ext}` : `${safeBase}${suffix}`;
}

// bio-sections.utils.js

export function createFiltersCollapseController({
  storageKey,
  panelEl,          // العنصر الذي يحتوي الفلاتر (مثل toolsLeft)
  toggleBtnEl,      // زر الإظهار/الإخفاء
  hasActiveFilters, // دالة ترجع true إذا فيه فلاتر مفعلة
  labels = {
    show: 'إظهار الفلاتر',
    hide: 'إخفاء الفلاتر'
  },
  iconHtml = '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
defaultCollapsed = false, // الافتراضي: ظاهر
  onBlockedHide,          // (اختياري) لما يمنع الإخفاء بسبب فلاتر فعالة
} = {}) {
  if (!panelEl || !toggleBtnEl) {
    throw new Error('createFiltersCollapseController: panelEl & toggleBtnEl are required');
  }

  const readFromStorage = () => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === null) return !!defaultCollapsed;
      return v === '1';
    } catch {
      return !!defaultCollapsed;
    }
  };

  const writeToStorage = (val) => {
    try {
      localStorage.setItem(storageKey, val ? '1' : '0');
    } catch { /* ignore */ }
  };

  let collapsed = readFromStorage();

  // ✅ علاج سباق transition: نخزن cleanup للـ listener الحالي
  let transitionCleanup = null;

  function updateToggleBtnUI() {
    toggleBtnEl.classList.toggle('is-collapsed', collapsed);
    toggleBtnEl.setAttribute('aria-pressed', String(collapsed));
    toggleBtnEl.innerHTML = `${iconHtml}<span>${collapsed ? labels.show : labels.hide}</span>`;
  }

  function setCollapsed(next, opts = {}) {
    const immediate = !!opts.immediate;

    collapsed = !!next;
    writeToStorage(collapsed);

    panelEl.classList.toggle('is-collapsed', collapsed);
    updateToggleBtnUI();

    // ✅ ألغي أي listener قديم قبل ما أبدأ حركة جديدة
    if (typeof transitionCleanup === 'function') {
      transitionCleanup();
      transitionCleanup = null;
    }

    // ✅ تطبيق فوري لمنع الوميض عند التحميل
    if (immediate) {
      panelEl.style.transition = 'none';
      panelEl.style.maxHeight = '';
      panelEl.style.opacity = '';
      panelEl.style.transform = '';

      panelEl.style.display = collapsed ? 'none' : '';

      requestAnimationFrame(() => {
        panelEl.style.transition = '';
      });
      return;
    }

    // مهم: خليها ظاهرة أثناء الحساب
    panelEl.style.display = '';

    if (!collapsed) {
      // فتح
      const h = panelEl.scrollHeight;

      panelEl.style.maxHeight = '0px';
      panelEl.style.opacity = '0';
      panelEl.style.transform = 'translateY(-6px)';

      requestAnimationFrame(() => {
        if (collapsed) return;
        panelEl.style.maxHeight = h + 'px';
        panelEl.style.opacity = '1';
        panelEl.style.transform = 'translateY(0)';
      });

      const onEnd = (e) => {
        if (e.propertyName !== 'max-height') return;
        if (collapsed) return;
        panelEl.style.maxHeight = 'none';
        panelEl.removeEventListener('transitionend', onEnd);
      };

      panelEl.addEventListener('transitionend', onEnd);
      transitionCleanup = () => panelEl.removeEventListener('transitionend', onEnd);

    } else {
      // إغلاق
      const h = panelEl.scrollHeight;

      panelEl.style.maxHeight = h + 'px';
      panelEl.style.opacity = '1';
      panelEl.style.transform = 'translateY(0)';

      requestAnimationFrame(() => {
        if (!collapsed) return;
        panelEl.style.maxHeight = '0px';
        panelEl.style.opacity = '0';
        panelEl.style.transform = 'translateY(-6px)';
      });

      const onEnd = (e) => {
        if (e.propertyName !== 'max-height') return;
        if (!collapsed) return;
        panelEl.style.display = 'none';
        panelEl.removeEventListener('transitionend', onEnd);
      };

      panelEl.addEventListener('transitionend', onEnd);
      transitionCleanup = () => panelEl.removeEventListener('transitionend', onEnd);
    }
  }

  function toggle() {
    // لو مخفي: افتح دائمًا
    if (collapsed) {
      setCollapsed(false);
      return;
    }

    // لو ظاهر: لا تخفي إذا فيه فلاتر مفعلة
    const active = typeof hasActiveFilters === 'function' ? !!hasActiveFilters() : false;
    if (active) {
      if (typeof onBlockedHide === 'function') onBlockedHide();
      return;
    }

    setCollapsed(true);
  }

  function getCollapsed() {
    return collapsed;
  }

  function applyInitialState({ autoOpenIfActive = true } = {}) {
    setCollapsed(collapsed, { immediate: true });

    if (autoOpenIfActive) {
      const active = typeof hasActiveFilters === 'function' ? !!hasActiveFilters() : false;
      if (collapsed && active) setCollapsed(false, { immediate: true });
    }
  }

  function destroy() {
    if (typeof transitionCleanup === 'function') transitionCleanup();
    transitionCleanup = null;
  }

  // تهيئة UI للزر مباشرة
  updateToggleBtnUI();

  return { setCollapsed, toggle, getCollapsed, applyInitialState, destroy };
}