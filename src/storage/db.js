// db.js — إدارة IndexedDB: عائلات + صور + كلمة المرور

/* =========================
   1) ثوابت / حارس بيئة
========================= */
const DB_NAME = 'familyTreeDB';
const DB_VERSION = 7;

// Stores
const STORE = 'families';
const PHOTO_STORE = 'photos';
const STORY_PHOTO_STORE = 'storyPhotos';
const EVENT_PHOTO_STORE = 'eventPhotos';
const SOURCE_PHOTO_STORE = 'sourcePhotos';
const PIN_STORE = 'pin';

// قيود أحجام (كما كانت ضمنيًا موزعة)
const MAX_PERSON_PHOTO_BYTES = 8 * 1024 * 1024;   // صور الأشخاص
const MAX_STORY_EVENT_BYTES  = 8 * 1024 * 1024;   // بعد ضغط صور القصص/الأحداث
const MAX_SOURCE_FILE_BYTES  = 20 * 1024 * 1024;  // مرفقات المصادر

// قائمة موحّدة للتعامل مع التفريغ/المعاملات
const ALL_STORES = [
  STORE,
  PHOTO_STORE,
  STORY_PHOTO_STORE,
  EVENT_PHOTO_STORE,
  SOURCE_PHOTO_STORE,
  PIN_STORE
];

if (!('indexedDB' in window)) {
  console.warn('IndexedDB not supported');
}

let dbp = null; // وعد اتصال واحد فقط

// =========================
// ObjectURL cache (لمنع تسريب blob:)
// =========================

// key = `${store}|${idbKey}`  -> url = blob:...
const _blobUrlCache = new Map();

// حد أقصى اختياري (LRU بسيطة) لتفادي تضخم الكاش لو فتحوا آلاف الصور
const _BLOB_URL_CACHE_MAX = 300;

function _blobUrlCacheKey(store, ref) {
  return `${store}|${_idbKey(ref)}`;
}

function _cacheSet(key, url) {
  // LRU بسيطة: إذا تجاوز الحد احذف الأقدم
  if (_blobUrlCache.size >= _BLOB_URL_CACHE_MAX) {
    const firstKey = _blobUrlCache.keys().next().value;
    if (firstKey) {
      const oldUrl = _blobUrlCache.get(firstKey);
      try { if (oldUrl) URL.revokeObjectURL(oldUrl); } catch {}
      _blobUrlCache.delete(firstKey);
    }
  }
  _blobUrlCache.set(key, url);
}

function _cacheTouch(key) {
  // LRU: إعادة إدخال المفتاح آخر القائمة
  const v = _blobUrlCache.get(key);
  if (v) {
    _blobUrlCache.delete(key);
    _blobUrlCache.set(key, v);
  }
}

/* =========================
   2) فتح/تهيئة قاعدة البيانات
   - نفس السلوك، مع ensure stores دائمًا
========================= */
function open() {
  if (dbp) return dbp;

  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const ensure = (name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      };
      ALL_STORES.forEach(ensure);
    };

    req.onsuccess = () => {
      const db = req.result;

      // إغلاق آمن عند تغيير النسخة (مع الإبقاء على نفس السلوك السابق)
      db.onversionchange = () => { try { db.close(); } catch {} };
      try {
        db.addEventListener('versionchange', () => { try { db.close(); } catch {} });
      } catch {}

      res(db);
    };

    req.onerror = () => rej(req.error);
    req.onblocked = () => console.warn('IndexedDB open blocked: close other tabs using the DB');
  });

  return dbp;
}

/** طلب تخزين دائم لتقليل فقدان البيانات */
export async function ensurePersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      return !!granted;
    }
  } catch {}
  return false;
}

/* =========================
   3) معاملات/طلبات عامة (تقليل التكرار)
========================= */

/**
 * تشغيل transaction موحّد:
 * - يحافظ على سلوكك: resolve عند oncomplete + abort عند الخطأ داخل fn
 */
function withTx(stores, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(stores, mode);
    let out;

    Promise.resolve()
      .then(() => fn(tx))
      .then((v) => { out = v; })
      .catch((e) => {
        try { tx.abort(); } catch {}
        rej(e);
      });

    tx.oncomplete = () => res(out);
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  }));
}

/** تنفيذ عملية put/delete/clear بدون تكرار boilerplate */
function txWrite(store, op) {
  return withTx(store, 'readwrite', (tx) => op(tx.objectStore(store)));
}

/** تنفيذ get/getKey/getAll/getAllKeys/count… مع Promise موحد */
function txRead(store, op) {
  return withTx(store, 'readonly', (tx) => new Promise((resolve, reject) => {
    const st = tx.objectStore(store);
    const req = op(st);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

/* =========================
   4) أدوات مساعدة داخلية
========================= */

/** تصنيف خطأ IndexedDB (موجود عندك، أبقيناه للتوافق/الاستعمال المستقبلي) */
function _friendlyIdbError(err) {
  const msg = String((err && err.message) || err || '');
  if (/Quota/i.test(msg))   return 'quota-exceeded';
  if (/Version/i.test(msg)) return 'version-conflict';
  if (/blocked/i.test(msg)) return 'blocked';
  return 'idb-error';
}

/** توليد معرّف فريد بسيط */
function _genId(prefix = 'id_') {
  if (window.crypto?.randomUUID) return prefix + window.crypto.randomUUID();
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** استخراج مفتاح idb:xxx */
function _idbKey(ref) {
  return String(ref || '').replace(/^idb:/, '');
}

/** فحص MIME للصور (صور الأشخاص) */
function _assertPersonPhotoBlob(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('putPhoto: expected Blob');
  if (blob.size > MAX_PERSON_PHOTO_BYTES) throw new Error('putPhoto: blob too large');

  const mt = blob.type || '';
  if (mt && !/^image\/(jpeg|png|webp|gif|bmp)$/i.test(mt)) {
    throw new Error('putPhoto: unsupported mime');
  }
}

/** ضغط ملف صورة إلى Blob أصغر (يستخدم لصور القصص/الأحداث/ضغط صور المصادر) */
function _compressImageFileToBlob(file, {
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.8,
  mimeType = 'image/jpeg'
} = {}) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = err => reject(err);
      reader.onload = ev => {
        const url = String(ev.target?.result || '');
        if (!url) return reject(new Error('empty data url'));

        const img = new Image();
        img.onload = () => {
          try {
            let { width, height } = img;
            if (!width || !height) return reject(new Error('invalid image dimensions'));

            let scale = 1;
            if (width > maxWidth || height > maxHeight) {
              scale = Math.min(maxWidth / width, maxHeight / height);
            }

            const w = Math.max(1, Math.round(width * scale));
            const h = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            canvas.toBlob(
              blob => {
                if (!blob) return reject(new Error('toBlob failed'));
                resolve(blob);
              },
              mimeType,
              quality
            );
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = err => reject(err);
        img.src = url;
      };

      reader.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * حفظ صورة “مضغوطة” في store معين وإرجاع ref بصيغة idb:KEY
 * (يوحّد putStoryImage و putEventImage بنفس السلوك)
 */
async function _putCompressedMedia(store, prefix, { file, personId = null, entityId = null, entityField = 'id' }) {
  if (!(file instanceof Blob)) throw new TypeError(`put${prefix}: expected File/Blob`);

  const compressed = await _compressImageFileToBlob(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8,
    mimeType: 'image/jpeg'
  });

  if (compressed.size > MAX_STORY_EVENT_BYTES) {
    throw new Error(`put${prefix}: blob too large after compression`);
  }

  const key = _genId(prefix);
  const value = {
    blob: compressed,
    meta: {
      personId: personId || null,
      [entityField]: entityId || null,
      createdAt: new Date().toISOString()
    }
  };

  await txWrite(store, (st) => st.put(value, key));
  return `idb:${key}`;
}

/**
 * جلب record من store وإرجاع blob:URL (يوحّد getStoryImageURL / getEventImageURL / getSourceFileURL)
 */
async function _getBlobUrlFromStore(store, ref) {
  if (!ref) return null;

  const cacheKey = _blobUrlCacheKey(store, ref);
  const cached = _blobUrlCache.get(cacheKey);
  if (cached) {
    _cacheTouch(cacheKey);
    return cached;
  }

  const key = _idbKey(ref);
  const record = await txRead(store, (st) => st.get(key)).catch(() => null);
  if (!record) return null;

  const blob =
    record.blob instanceof Blob ? record.blob :
    (record instanceof Blob ? record : null);

  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  _cacheSet(cacheKey, url);
  return url;
}

/**
 * حذف record بناءً على ref بصيغة idb:xxx من store معيّن
 * (يوحّد deleteStoryImage/deleteEventImage/deleteSourceFile)
 */
async function _deleteByRef(store, ref) {
  if (!ref) return;

  // revoke cached url (إن وجد)
  const cacheKey = _blobUrlCacheKey(store, ref);
  const cached = _blobUrlCache.get(cacheKey);
  if (cached) {
    try { URL.revokeObjectURL(cached); } catch {}
    _blobUrlCache.delete(cacheKey);
  }

  const key = _idbKey(ref);
  await txWrite(store, (st) => st.delete(key));
}


/* =========================
   5) إغلاق/تفريغ داخلي
========================= */
async function _closeConn() {
  if (!dbp) return;
  try { const db = await dbp; db.close(); } catch {}
  dbp = null;
}

async function _clearStores() {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(ALL_STORES, 'readwrite');
    ALL_STORES.forEach((name) => tx.objectStore(name).clear());
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });

  // revoke كل blob URLs المخبأة
  for (const url of _blobUrlCache.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  _blobUrlCache.clear();
}

/* =========================
   6) صور الأشخاص (photos)
========================= */

/** حفظ صورة شخص (Blob) مع فحص النوع/الحجم */
async function putPhoto(personId, blob) {
  _assertPersonPhotoBlob(blob);
  await txWrite(PHOTO_STORE, (st) => st.put(blob, personId));
}

async function getPhoto(personId) {
  // نفس السلوك السابق: return null عند عدم وجود
  const out = await txRead(PHOTO_STORE, (st) => st.get(personId)).catch(() => null);
  return out || null;
}

async function clearPhoto(personId) {
  await txWrite(PHOTO_STORE, (st) => st.delete(personId));
}

/** صور: دوال إضافية */
async function listPhotoIds() { return keys(PHOTO_STORE); }

async function delPhotosBulk(ids = []) {
  if (!Array.isArray(ids) || !ids.length) return;
  await withTx(PHOTO_STORE, 'readwrite', (tx) => {
    const st = tx.objectStore(PHOTO_STORE);
    ids.forEach(id => st.delete(id));
  });
}

/* =========================
   7) صور القصص (storyPhotos)
========================= */

/** حفظ صورة قصة مضغوطة وإرجاع ref idb:story_... */
async function putStoryImage({ file, personId = null, storyId = null }) {
  return _putCompressedMedia(
    STORY_PHOTO_STORE,
    'story_',
    { file, personId, entityId: storyId, entityField: 'storyId' }
  );
}

/** تحويل مرجع idb: إلى blob:URL للعرض */
async function getStoryImageURL(ref) {
  return _getBlobUrlFromStore(STORY_PHOTO_STORE, ref);
}

async function deleteStoryImage(ref) {
  return _deleteByRef(STORY_PHOTO_STORE, ref);
}

/* =========================
   8) صور الأحداث (eventPhotos)
========================= */

/** حفظ صورة حدث مضغوطة وإرجاع ref idb:event_... */
async function putEventImage({ file, personId = null, eventId = null }) {
  return _putCompressedMedia(
    EVENT_PHOTO_STORE,
    'event_',
    { file, personId, entityId: eventId, entityField: 'eventId' }
  );
}

/** تحويل مرجع idb: للحدث إلى blob:URL للعرض */
async function getEventImageURL(ref) {
  return _getBlobUrlFromStore(EVENT_PHOTO_STORE, ref);
}

async function deleteEventImage(ref) {
  return _deleteByRef(EVENT_PHOTO_STORE, ref);
}

/* =========================
   9) صور/مرفقات المصادر (sourcePhotos)
========================= */

/**
 * Wrapper للتوافق: putSourceImage => putSourceFile مع meta (كما كان)
 * الآن يجمع mime/name/ext/kind بنفس منطقك.
 */
async function putSourceImage({ file, personId = null, sourceId = null }) {
  const mime = (file?.type || '').toLowerCase();
  const name = (file?.name || '');
  const ext  = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

  const kind =
    mime.startsWith('image/') ? 'image' :
    mime === 'application/pdf' ? 'pdf' :
    (mime.includes('word') || ['doc', 'docx', 'rtf', 'odt'].includes(ext)) ? 'word' :
    (mime.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) ? 'excel' :
    'other';

  return putSourceFile({
    file,
    personId,
    sourceId,
    meta: { mime, name, ext, kind }
  });
}

/**
 * يحفظ ملف المصدر ويرجع ref من نوع idb:src_...
 * - ضغط الصور فقط (كما منطقك)
 * - حد الحجم 20MB (كما كان)
 */
async function putSourceFile({ file, personId = null, sourceId = null, meta = {} }) {
  if (!(file instanceof Blob)) throw new TypeError('putSourceFile: expected File/Blob');

  const mt = (file.type || meta?.mime || meta?.mimeType || '').toLowerCase();
  let blobToStore = file;

  // اضغط فقط الصور
  if (/^image\//i.test(mt)) {
    blobToStore = await _compressImageFileToBlob(file, {
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.8,
      mimeType: 'image/jpeg'
    });
  }

  if (blobToStore.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error('putSourceFile: blob too large');
  }

  const key = _genId('src_');

  const value = {
    blob: blobToStore,
    meta: {
      mime: (meta?.mime || mt || blobToStore.type || ''),
      name: (meta?.name || file?.name || ''),
      ext:  (meta?.ext || ''),
      kind: (meta?.kind || ''),
      personId: personId || null,
      sourceId: sourceId || null,
      createdAt: new Date().toISOString(),
      ...meta
    }
  };

  await txWrite(SOURCE_PHOTO_STORE, (st) => st.put(value, key));
  return `idb:${key}`;
}

async function getSourceFileURL(ref) {
  return _getBlobUrlFromStore(SOURCE_PHOTO_STORE, ref);
}

async function getSourceFileMeta(ref) {
  if (!ref) return null;
  const key = _idbKey(ref);

  const record = await txRead(SOURCE_PHOTO_STORE, (st) => st.get(key)).catch(() => null);
  const meta = record?.meta || null;
  if (!meta) return null;

  // رجّع نفس الشكل المطلوب
  return {
    mime: meta.mime || meta.mimeType || '',
    name: meta.name || '',
    ext:  meta.ext || '',
    kind: meta.kind || ''
  };
}

// Wrapper للتوافق
async function getSourceImageURL(ref) {
  return getSourceFileURL(ref);
}

async function deleteSourceFile(ref) {
  return _deleteByRef(SOURCE_PHOTO_STORE, ref);
}

/* =========================
   10) مخزن العائلات (KV) + PIN store (KV)
========================= */

// KV (families)
async function put(key, val) {
  await txWrite(STORE, (st) => st.put(val, key));
}

async function get(key) {
  return txRead(STORE, (st) => st.get(key));
}

async function del(key) {
  await txWrite(STORE, (st) => st.delete(key));
}

async function has(key) {
  const k = await txRead(STORE, (st) => st.getKey(key));
  return k != null;
}

// PIN store (KV)
async function pinPut(key, val) {
  await txWrite(PIN_STORE, (st) => st.put(val, key));
}

async function pinGet(key) {
  return txRead(PIN_STORE, (st) => st.get(key));
}

async function pinDel(key) {
  await txWrite(PIN_STORE, (st) => st.delete(key));
}

/**
 * getAllFamilies + pinGetAll:
 * نفس منطقك (getAllKeys + getAll) لكن بدالة مشتركة لتقليل التكرار.
 */
async function _getAllAsObject(store) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const st = tx.objectStore(store);

    const reqKeys = st.getAllKeys();
    const reqVals = st.getAll();

    let keys = null, vals = null;

    const finish = () => {
      const out = {};
      for (let i = 0; i < keys.length; i++) out[keys[i]] = vals[i];
      res(out);
    };

    reqKeys.onsuccess = () => { keys = reqKeys.result || []; if (vals) finish(); };
    reqVals.onsuccess = () => { vals = reqVals.result || []; if (keys) finish(); };

    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

async function pinGetAll() {
  return _getAllAsObject(PIN_STORE);
}

async function getAllFamilies() {
  return _getAllAsObject(STORE);
}

/* =========================
   11) تشخيصات (count/keys)
========================= */

async function count(store) {
  const n = await txRead(store, (st) => st.count());
  return (n | 0);
}

async function keys(store) {
  const ks = await txRead(store, (st) => st.getAllKeys());
  return ks || [];
}

/* =========================
   12) حذف كامل لقاعدة البيانات (nuke)
   - نفس سلوكك: محاولات + fallback لمسح الـ stores
========================= */
async function nuke() {
  await _closeConn();

  return new Promise((resolve, reject) => {
    let settled = false;
    let tries = 0;

    const attempt = () => {
      tries++;
      const req = indexedDB.deleteDatabase(DB_NAME);

      req.onsuccess = () => {
        if (!settled) { settled = true; resolve(); }
      };

      req.onerror = () => {
        if (settled) return;
        if (tries < 3) setTimeout(attempt, 150);
        else { settled = true; reject(req.error); }
      };

      req.onblocked = async () => {
        await _closeConn();
        setTimeout(() => { if (!settled) attempt(); }, 150);
      };
    };

    attempt();

    // fallback سريع إذا استمر الحظر
    setTimeout(async () => {
      if (settled) return;
      try { await _clearStores(); settled = true; resolve(); }
      catch (e) { settled = true; reject(e); }
    }, 1200);
  });
}

/* =========================
   13) تصدير الواجهة (DB)
========================= */
export const DB = {
  // PIN store
  pinPut, pinGet, pinDel, pinGetAll,

  // KV (families)
  put, get, del, has, getAllFamilies,

  // Photos الأشخاص
  putPhoto, getPhoto, clearPhoto, listPhotoIds, delPhotosBulk,

  // Photos القصص
  putStoryImage, getStoryImageURL, deleteStoryImage,

  // Photos الأحداث
  putEventImage, getEventImageURL, deleteEventImage,

  // Photos المصادر/الوثائق
  putSourceFile, getSourceFileURL, getSourceFileMeta, deleteSourceFile,

  // (توافق قديم)
  putSourceImage, getSourceImageURL,

  // إدارة
  nuke,

  // تشخيص
  _countFamilies:     () => count(STORE),
  _countPhotos:       () => count(PHOTO_STORE),
  _keysFamilies:      () => keys(STORE),
  _keysPhotos:        () => keys(PHOTO_STORE),

  _countSourceFiles:  () => count(SOURCE_PHOTO_STORE),
  _keysSourceFiles:   () => keys(SOURCE_PHOTO_STORE),

  _countStoryPhotos:  () => count(STORY_PHOTO_STORE),
  _countEventPhotos:  () => count(EVENT_PHOTO_STORE)
};
