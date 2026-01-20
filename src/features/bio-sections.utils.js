// bio-sections.utils.js
// أدوات مشتركة لأقسام السيرة:
// 1) أساسيات (نص/مصفوفات/وقت)
// 2) DOM helpers (تغليف حقول ومعاينات + autoResize)
// 3) إدارة مراجع الملفات (ready/tmp/idb) + كاش tmp + ترقية tmp->idb
// 4) أدوات UI عامة (تاريخ/طول نص/سلايدر/أنواع)
// 5) أدوات ملفات (امتداد/MIME/تصنيف/فتح/تحقق/ترتيب/اسم تحميل)
// 6) Controller: إظهار/إخفاء الفلاتر مع حفظ الحالة

/* ------------------------------------------------------------------ */
/* 1) أساسيات صغيرة: توحيد التحويلات لتقليل التكرار                    */
/* ------------------------------------------------------------------ */
export const nowIso = () => new Date().toISOString();
export const safeStr = (v) => String(v ?? '').trim();
export const shallowArr = (v) => (Array.isArray(v) ? v.slice() : []);

const asArr = (v) => (Array.isArray(v) ? v : []);
const asStr = (v) => safeStr(v);
const uniq = (arr) => Array.from(new Set(asArr(arr)));

export function splitCommaTags(s) {
  return String(s ?? '')
    .split(',')
    .map((t) => asStr(t))
    .filter(Boolean);
}

/** يتحقق إن كان السجل "فارغ" بناءً على مفاتيح محددة (مفيد لمنع حفظ عناصر بلا محتوى) */
export function isEmptyRecordByKeys(rec, keys = []) {
  if (!rec) return true;

  for (const k of asArr(keys)) {
    const v = rec?.[k];

    if (Array.isArray(v)) {
      if (v.length) return false;
      continue;
    }

    if (typeof v === 'string') {
      if (asStr(v)) return false;
      continue;
    }

    if (v != null) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* 2) قواعد refs (ready/tmp/idb)                                       */
/* ------------------------------------------------------------------ */
export const isReadyUrl = (ref) => /^(data:|blob:|https?:)/.test(String(ref ?? ''));
export const isTmpRef = (ref) => String(ref ?? '').startsWith('tmp:');
export const isIdbRef = (ref) => String(ref ?? '').toLowerCase().startsWith('idb:');

/* ------------------------------------------------------------------ */
/* 3) DOM helpers: تغليف حقول + تغليف Preview + Auto resize textarea   */
/* ------------------------------------------------------------------ */

/** تغليف أي حقل بـ label + icon (للاستخدام العام في meta fields) */
export function wrapField(
  fieldEl,
  {
    title = '',
    icon = '',
    className = 'biosec-meta-field',
    labelClass = 'biosec-meta-label',
    iconClass = 'biosec-meta-icon',
  } = {}
) {
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

/** غلاف موحد لعنوان الحقل: (Label + Icon) داخل biosec-field */
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

/** تغليف بلوك معاينة: عنوان + أيقونة فوق المحتوى (لـ Preview) */
export function wrapPreviewBlock(
  contentEl,
  {
    title = '',
    icon = '',
    className = 'biosec-preview-block',
    headerClass = 'biosec-preview-block-header',
    titleClass = 'biosec-preview-block-title',
    iconClass = 'biosec-preview-block-icon',
  } = {}
) {
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

/** توسعة textarea حسب المحتوى؛ مع حد أدنى (dataset/css/fallback) لمنع القفز */
export function autoResizeTextareas(root, selector) {
  if (!root) return;

  root.querySelectorAll(selector).forEach((ta) => {
    const resize = () => {
      const dsMin = Number(ta.dataset.minHeight || 0);
      const cssMin = parseFloat(window.getComputedStyle(ta).minHeight || '0') || 0;
      const fallback = ta.classList.contains('biosec-textarea') ? 94 : 0;
      const min = Math.max(dsMin, cssMin, fallback);

      ta.style.height = 'auto';
      ta.style.height = Math.max(ta.scrollHeight, min) + 'px';
    };

    resize();

    // مهم: إزالة listener القديم لتجنب التكرار عند إعادة بناء DOM
    ta.removeEventListener('input', ta._autoResizeHandler || (() => {}));
    ta._autoResizeHandler = resize;
    ta.addEventListener('input', resize);
  });
}

/* ------------------------------------------------------------------ */
/* 4) كاش tmp: ObjectURL (مع إدارة revoke)                             */
/* ------------------------------------------------------------------ */

const genId = (prefix) =>
  (window.crypto?.randomUUID ? `${prefix}${window.crypto.randomUUID()}` :
    `${prefix}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

/** كاش لملفات tmp مع ObjectURL للمعاينة (يجب revoke عند الإزالة لتفادي تسريب الذاكرة) */
export function createTempObjectURLCache({ prefix = 'tmp:' } = {}) {
  const map = new Map(); // tmpRef -> { file, url, meta }

  const add = (file, meta = null) => {
    const tmpRef = genId(prefix);
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
    for (const r of asArr(refs)) {
      const s = String(r ?? '');
      if (isTmpRef(s)) revoke(s);
    }
  };

  const get = (tmpRef) => map.get(String(tmpRef ?? '')) || null;

  return { add, revoke, cleanup, get, _map: map };
}

/* ------------------------------------------------------------------ */
/* 5) أدوات صغيرة للمصادر: index + عناصر DOM للفواصل/العناوين          */
/* ------------------------------------------------------------------ */

export function findImageIndex(imagesOnly, ref) {
  const list = asArr(imagesOnly);
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

/* ------------------------------------------------------------------ */
/* 6) Factory موحّد: tempCache + resolver (+ metaCache اختياري)         */
/* ------------------------------------------------------------------ */

export function createSectionTempAndResolver({ prefix = 'tmp:', getIdbUrl, metaCache = null } = {}) {
  const tempCache = createTempObjectURLCache({ prefix });
  const resolve = createRefResolver({ tempCache, getIdbUrl });

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
    for (const r of asArr(refs)) {
      const s = String(r ?? '');
      if (isTmpRef(s)) revokeTemp(s);
    }
  };

  return { tempCache, addTemp, revokeTemp, cleanupTmp, resolve };
}

/* ------------------------------------------------------------------ */
/* 7) ترقية tmp -> idb: يحافظ على ترتيب refs ويوقف عند أول فشل          */
/* ------------------------------------------------------------------ */

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

    const rec = tempCache && tempCache.get ? tempCache.get(ref) : null;
    if (!rec || !rec.file) {
      const err = new Error('Missing tmp file record');
      if (typeof onFail === 'function') onFail(ref, err);
      return { ok: false, refs: out, error: err };
    }

    try {
      const idbRef = (typeof putFn === 'function') ? await putFn(rec, ref) : null;

      if (idbRef) {
        const s = String(idbRef);
        out.push(s);

        if (typeof onAfterPut === 'function') {
          await onAfterPut(s, rec, ref);
        }
      }
    } catch (e) {
      if (typeof onFail === 'function') onFail(ref, e);
      return { ok: false, refs: out, error: e };
    } finally {
      try {
        if (typeof revokeFn === 'function') {
          revokeFn(ref);
        } else if (tempCache && typeof tempCache.revoke === 'function') {
          tempCache.revoke(ref);
        }
      } catch {}
    }
  }

  return { ok: true, refs: out, error: null };
}


/* ------------------------------------------------------------------ */
/* 8) توحيد وضع البطاقة (Preview/Edit) + نصوص الأزرار                   */
/* ------------------------------------------------------------------ */

/** ينسّق وضع البطاقة ويحدد زر الحفظ/الإغلاق بناءً على (editing + dirty) */
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

  // بعض الأقسام تعرض dates في preview فقط
  if (datesEl) datesEl.style.display = toEdit ? 'none' : '';

  const L = { edit: 'تعديل', close: 'إغلاق', save: 'حفظ', ...labels };
  const I = { edit: 'fa-pen-to-square', close: 'fa-xmark', save: 'fa-floppy-disk', ...icons };

  if (saveBtn) {
    const mode = !toEdit ? 'edit' : (!isDirty ? 'close' : 'save');
    const icon = mode === 'edit' ? I.edit : mode === 'close' ? I.close : I.save;
    const text = mode === 'edit' ? L.edit : mode === 'close' ? L.close : L.save;
    saveBtn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${text}</span>`;
  }

  if (cancelBtn) cancelBtn.style.display = (toEdit && isDirty) ? '' : 'none';
}

/* ------------------------------------------------------------------ */
/* 9) Resolver موحّد للمراجع: ready/tmp/idb                             */
/* ------------------------------------------------------------------ */

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

  // fallback: قد يكون مسار/نص/معرّف آخر
  return s;
}

export const createRefResolver =
  ({ tempCache, getIdbUrl } = {}) =>
  (ref) =>
    resolveRefUrl(ref, { tempCache, getIdbUrl });

/* ------------------------------------------------------------------ */
/* 10) UI عامة: تاريخ + طول النص + فتح سلايدر بعد الحل                  */
/* ------------------------------------------------------------------ */

export function formatCreatedAtLabel(iso, { prefix = 'أضيفت', formatter = null } = {}) {
  if (!iso) return '';
  const p = (prefix == null || prefix === '') ? 'أضيفت' : prefix;

  try {
    const body = typeof formatter === 'function'  ? formatter(iso)
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
  const urls = [];
  for (const r of asArr(refs)) {
    const u = await resolveUrl?.(r);
    if (u) urls.push(u);
  }
  if (urls.length) viewer?.open?.(urls, startIndex);
}

/* ------------------------------------------------------------------ */
/* 11) مساعدات الأنواع: labels/options + fill + rebuild حسب المستخدم     */
/* ------------------------------------------------------------------ */

export function createTypeHelpers({
  labels = {},
  options = [],
  allValue = 'all',
  allLabel = 'كل الأنواع'
} = {}) {
  const labelsMap = labels || {};
  const opts = asArr(options).slice();

  // ترتيب ثابت حسب options (حتى لا يتغير ترتيب المشروع)
  const order = Object.fromEntries(
    opts.filter(([val]) => val && val !== allValue).map(([val], i) => [val, i])
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

    const used = uniq(asArr(usedCodes).map(asStr).filter(Boolean));

    used.sort((a, b) => {
      const ia = order[a] ?? 999;
      const ib = order[b] ?? 999;
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

    for (const code of used) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = getLabel(code) || code;
      selectEl.appendChild(opt);
    }

    const prev = asStr(currentValue) || allValue;
    const next = (prev && prev !== allValue && used.includes(prev)) ? prev : allValue;
    selectEl.value = next;
    return next;
  };

  return { getLabel, fillSelect, rebuildSelectFromUsed };
}

/* ------------------------------------------------------------------ */
/* 12) أدوات ملفات: ext/MIME/kind/open/validate/sort/download name      */
/* ------------------------------------------------------------------ */

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

/** يرجع نوع الملف: image | audio | pdf | word | excel | other */
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

  if (m.includes('word') || /(doc|docx|rtf|odt)$/.test(e) || /\.(doc|docx|rtf|odt)(?:\?|#|$)/.test(r)) return 'word';
  if (m.includes('excel') || /(xls|xlsx|csv)$/.test(e) || /\.(xls|xlsx|csv)(?:\?|#|$)/.test(r)) return 'excel';

  return 'other';
}

/** فتح تبويب بدون أن يتأثر بالـ popup blockers (لا تضع await قبل window.open) */
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

/** التحقق قبل الإضافة: الحجم + MIME (و ext كخطة بديلة) */
export function isAllowedFile(
  file,
  { maxSizeMB = 20, allowedMime = [], allowedExt = [], allowImages = true, fallbackExtWhenMimeMissing = true } = {}
) {
  if (!file) return { ok: false, reason: 'ملف غير صالح.' };

  const maxSize = Number(maxSizeMB) * 1024 * 1024;
  if (file.size > maxSize) return { ok: false, reason: `حجم الملف كبير (أقصى حد ${maxSizeMB}MB).` };

  const type = String(file.type ?? '').toLowerCase();
  if (allowImages && type.startsWith('image/')) return { ok: true };

  const allowedMimeSet = new Set(asArr(allowedMime).map((s) => String(s).toLowerCase()));
  if (type && allowedMimeSet.has(type)) return { ok: true };

  if (!fallbackExtWhenMimeMissing) return { ok: false, reason: 'نوع الملف غير مدعوم.' };

  const name = String(file.name ?? '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const allowedExtSet = new Set(asArr(allowedExt).map((s) => String(s).toLowerCase()));

  if (ext && allowedExtSet.has(ext)) return { ok: true };

  return { ok: false, reason: 'نوع الملف غير مدعوم. ارفع صورة أو PDF أو Word/Excel.' };
}

/** ترتيب refs: الصور أولاً ثم باقي الأنواع (مع الحفاظ على ترتيب كل مجموعة) */
export function groupRefsByKind(refs, getKind) {
  const list = Array.isArray(refs) ? refs.slice() : (refs ? [refs] : []);
  const images = [];
  const others = [];

  for (const r of list) {
    const k = getKind ? getKind(r) : inferFileKind({ ref: r, ext: getRefExt(r) });
    (k === 'image' ? images : others).push(r);
  }
  return images.concat(others);
}

/** بناء اسم ملف للتحميل (يدعم meta.name/meta.ext لملفات idb) */
export function buildDownloadName(baseTitle, ref, mime, index, total, meta = {}) {
  const isSingle = Number(total || 0) === 1;

  const baseFromName =
    meta?.name && String(meta.name).trim() ? String(meta.name).replace(/\.[^/.]+$/, '')
      : '';

  const safeBase = baseFromName || safeStr(baseTitle || 'الوثيقة') || 'الوثيقة';

  const ext = String(meta?.ext || getRefExt(ref) || mimeToExt(mime) || '').replace(/^\./, '');
  const suffix = isSingle ? '' : ` (${Number(index || 0) + 1})`;

  return ext ? `${safeBase}${suffix}.${ext}` : `${safeBase}${suffix}`;
}

/** استخراج ميتاداتا tmp للمصادر (اسم/نوع/امتداد/تصنيف) */
export function makeTempMetaFromFile(file) {
  const mime = String(file?.type ?? '').toLowerCase();
  const name = String(file?.name ?? '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : mimeToExt(mime);
  const kind = inferFileKind({ mime, ext });
  return { mime, name, ext, kind };
}

/* ------------------------------------------------------------------ */
/* 13) Controller: طيّ/فتح الفلاتر مع حفظ الحالة في localStorage        */
/* ------------------------------------------------------------------ */

export function createFiltersCollapseController({
  storageKey,
  panelEl,
  toggleBtnEl,
  hasActiveFilters,
  labels = { show: 'إظهار الفلاتر', hide: 'إخفاء الفلاتر' },
  iconHtml = '<i class="fa-solid fa-sliders" aria-hidden="true"></i>',
  defaultCollapsed = false,
  onBlockedHide,
} = {}) {
  if (!panelEl || !toggleBtnEl) {
    throw new Error('createFiltersCollapseController: panelEl & toggleBtnEl are required');
  }

  const readFromStorage = () => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? !!defaultCollapsed : (v === '1');
    } catch {
      return !!defaultCollapsed;
    }
  };

  const writeToStorage = (val) => {
    try { localStorage.setItem(storageKey, val ? '1' : '0'); } catch {}
  };

  let collapsed = readFromStorage();
  let transitionCleanup = null;

  const updateToggleBtnUI = () => {
    toggleBtnEl.classList.toggle('is-collapsed', collapsed);
    toggleBtnEl.setAttribute('aria-pressed', String(collapsed));
    toggleBtnEl.innerHTML = `${iconHtml}<span>${collapsed ? labels.show : labels.hide}</span>`;
  };

  const clearTransitionListener = () => {
    if (typeof transitionCleanup === 'function') transitionCleanup();
    transitionCleanup = null;
  };

  const bindTransitionEnd = (cb) => {
    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      cb?.();
      panelEl.removeEventListener('transitionend', onEnd);
    };
    panelEl.addEventListener('transitionend', onEnd);
    transitionCleanup = () => panelEl.removeEventListener('transitionend', onEnd);
  };

function setCollapsed(next, { immediate = false } = {}) {
  collapsed = !!next;
  writeToStorage(collapsed);

  clearTransitionListener();

  if (immediate) {
    panelEl.style.transition = 'none';
    panelEl.classList.toggle('is-collapsed', collapsed);
    updateToggleBtnUI();
    // إعادة تفعيل transition بعد إطار
    requestAnimationFrame(() => { panelEl.style.transition = ''; });
    return;
  }

  panelEl.classList.toggle('is-collapsed', collapsed);
  updateToggleBtnUI();
}

  function toggle() {
    if (collapsed) return setCollapsed(false);

    // لا نخفي لو فيه فلاتر فعالة (حتى لا يضيع على المستخدم أنها مفعلة)
    const active = typeof hasActiveFilters === 'function' ? !!hasActiveFilters() : false;
    if (active) {
      onBlockedHide?.();
      return;
    }

    setCollapsed(true);
  }

  const getCollapsed = () => collapsed;

  function applyInitialState({ autoOpenIfActive = true } = {}) {
    setCollapsed(collapsed, { immediate: true });

    if (autoOpenIfActive) {
      const active = typeof hasActiveFilters === 'function' ? !!hasActiveFilters() : false;
      if (collapsed && active) setCollapsed(false, { immediate: true });
    }
  }

  function destroy() {
    clearTransitionListener();
  }

  updateToggleBtnUI();
 
 return { setCollapsed, toggle, getCollapsed, applyInitialState, destroy };
}