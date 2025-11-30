// db.js — إدارة IndexedDB: عائلات + صور (محسّن ومنظّم)

/* =========================
   ثوابت/حارس بيئة
========================= */
const DB_NAME = 'familyTreeDB';
const STORE = 'families';
const PHOTO_STORE = 'photos';
const STORY_PHOTO_STORE = 'storyPhotos';
const EVENT_PHOTO_STORE = 'eventPhotos';

if (!('indexedDB' in window)) {
  console.warn('IndexedDB not supported');
}

let dbp = null; // وعد اتصال واحد فقط

/* =========================
   مرافق معاملات مختصرة
========================= */
function _ro(db, store){ return db.transaction(store, 'readonly').objectStore(store); }
function _rw(db, store){ return db.transaction(store, 'readwrite').objectStore(store); }

/* =========================
   فتح/تهيئة قاعدة البيانات + مهاجرات مُنظّمة
========================= */
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 4);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      const v  = e.oldVersion | 0;

      // v=0 → إنشاء جديد
      if (v < 1) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      }

      // v=1 → إضافة مخزن صور الأشخاص
      if (v < 2) {
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE);
        }
      }

      // v=2 → إضافة مخزن صور القصص
      if (v < 3) {
        if (!db.objectStoreNames.contains(STORY_PHOTO_STORE)) {
          db.createObjectStore(STORY_PHOTO_STORE);
        }
      }

      // v=3 → إضافة مخزن صور الأحداث
      if (v < 4) {
        if (!db.objectStoreNames.contains(EVENT_PHOTO_STORE)) {
          db.createObjectStore(EVENT_PHOTO_STORE);
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // إغلاق آمن عند ترقية من تبويب آخر
      db.onversionchange = () => { try { db.close(); } catch {} };
      try {
        db.addEventListener('versionchange', () => {
          try { db.close(); } catch {}
        });
      } catch {}
      res(db);
    };

    req.onerror = () => rej(req.error);
  });
  return dbp;
}


// طلب تخزين دائم لتقليل فقدان البيانات
export async function ensurePersistentStorage(){
  try{
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      return !!granted;
    }
  }catch{}
  return false;
}

/* =========================
   أدوات مساعدة للأخطاء
========================= */
function _friendlyIdbError(err){
  const msg = String((err && err.message) || err || '');
  if (/Quota/i.test(msg))   return 'quota-exceeded';
  if (/Version/i.test(msg)) return 'version-conflict';
  if (/blocked/i.test(msg)) return 'blocked';
  return 'idb-error';
}

/* =========================
   أدوات مساعدة داخلية
========================= */

// توليد معرّف فريد بسيط
function _genId(prefix = 'id_') {
  if (window.crypto?.randomUUID) {
    return prefix + window.crypto.randomUUID();
  }
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ضغط ملف صورة إلى Blob أصغر (للاستخدام في صور القصص)
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
            if (!width || !height) {
              return reject(new Error('invalid image dimensions'));
            }

            // حساب عامل التصغير
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

/* =========================
   إغلاق/تفريغ داخلي
========================= */
async function _closeConn() {
  if (!dbp) return;
  try { const db = await dbp; db.close(); } catch {}
  dbp = null;
}

async function _clearStores() {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(
      [STORE, PHOTO_STORE, STORY_PHOTO_STORE, EVENT_PHOTO_STORE],
      'readwrite'
    );
    tx.objectStore(STORE).clear();
    tx.objectStore(PHOTO_STORE).clear();
    tx.objectStore(STORY_PHOTO_STORE).clear(); // مسح صور القصص
    tx.objectStore(EVENT_PHOTO_STORE).clear(); // مسح صور الأحداث
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}



/* =========================
   صور الأشخاص (photos)
========================= */
// حفظ Blob مع فحص نوع/حجم
async function putPhoto(personId, blob) {
  if (!(blob instanceof Blob)) throw new TypeError('putPhoto: expected Blob');
  if (blob.size > 8 * 1024 * 1024) throw new Error('putPhoto: blob too large');
  const mt = blob.type || '';
  if (mt && !/^image\/(jpeg|png|webp|gif|bmp)$/i.test(mt)) throw new Error('putPhoto: unsupported mime');

  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).put(blob, personId);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}

async function getPhoto(personId) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const r = tx.objectStore(PHOTO_STORE).get(personId);
    let out = null;
    r.onsuccess = () => { out = r.result || null; };
    tx.oncomplete = () => res(out);
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}

async function clearPhoto(personId) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).delete(personId);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}

// صور: دوال إضافية
async function listPhotoIds(){ return keys(PHOTO_STORE); }

async function delPhotosBulk(ids = []){
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const st = tx.objectStore(PHOTO_STORE);
    ids.forEach(id => st.delete(id));
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}
/* =========================
   صور القصص (storyPhotos)
========================= */

// حفظ صورة قصة مضغوطة في مخزن خاص وإرجاع مرجع idb:story_...
async function putStoryImage({ file, personId = null, storyId = null }) {
  if (!(file instanceof Blob)) {
    throw new TypeError('putStoryImage: expected File/Blob');
  }

  // ضغط الصورة
  const compressed = await _compressImageFileToBlob(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8,
    mimeType: 'image/jpeg'
  });

  if (compressed.size > 8 * 1024 * 1024) {
    throw new Error('putStoryImage: blob too large after compression');
  }

  const db = await open();
  const key = _genId('story_'); // مثل: story_r4x...etc
  const value = {
    blob: compressed,
    meta: {
      personId: personId || null,
      storyId: storyId || null,
      createdAt: new Date().toISOString()
    }
  };

  await new Promise((res, rej) => {
    const tx = db.transaction(STORY_PHOTO_STORE, 'readwrite');
    tx.objectStore(STORY_PHOTO_STORE).put(value, key);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });

  // هذا هو الذي يُخزَّن في story.images
  return `idb:${key}`;
}

// تحويل مرجع idb: إلى blob: URL للعرض
async function getStoryImageURL(ref) {
  if (!ref) return null;
  const key = String(ref).replace(/^idb:/, '');

  const db = await open();
  const record = await new Promise((res, rej) => {
    const tx = db.transaction(STORY_PHOTO_STORE, 'readonly');
    const r = tx.objectStore(STORY_PHOTO_STORE).get(key);
    let out = null;
    r.onsuccess = () => { out = r.result || null; };
    tx.oncomplete = () => res(out);
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });

  if (!record) return null;

  const blob =
    record.blob instanceof Blob ? record.blob
      : (record instanceof Blob ? record : null);

  if (!blob) return null;

  return URL.createObjectURL(blob);
}

/* =========================
   صور الأحداث (eventPhotos)
========================= */

// حفظ صورة حدث مضغوطة في مخزن خاص وإرجاع مرجع idb:event_...
async function putEventImage({ file, personId = null, eventId = null }) {
  if (!(file instanceof Blob)) {
    throw new TypeError('putEventImage: expected File/Blob');
  }

  // إعادة استخدام نفس منطق الضغط
  const compressed = await _compressImageFileToBlob(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8,
    mimeType: 'image/jpeg'
  });

  if (compressed.size > 8 * 1024 * 1024) {
    throw new Error('putEventImage: blob too large after compression');
  }

  const db = await open();
  const key = _genId('event_'); // مثل: event_r4x...

  const value = {
    blob: compressed,
    meta: {
      personId: personId || null,
      eventId: eventId || null,
      createdAt: new Date().toISOString()
    }
  };

  await new Promise((res, rej) => {
    const tx = db.transaction(EVENT_PHOTO_STORE, 'readwrite');
    tx.objectStore(EVENT_PHOTO_STORE).put(value, key);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });

  // هذا هو الذي يُخزَّن في event.media
  return `idb:${key}`;
}

// تحويل مرجع idb: للحدث إلى blob: URL للعرض
async function getEventImageURL(ref) {
  if (!ref) return null;
  const key = String(ref).replace(/^idb:/, '');

  const db = await open();
  const record = await new Promise((res, rej) => {
    const tx = db.transaction(EVENT_PHOTO_STORE, 'readonly');
    const r  = tx.objectStore(EVENT_PHOTO_STORE).get(key);
    let out = null;
    r.onsuccess = () => { out = r.result || null; };
    tx.oncomplete = () => res(out);
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });

  if (!record) return null;

  const blob =
    record.blob instanceof Blob ? record.blob
      : (record instanceof Blob ? record : null);

  if (!blob) return null;

  return URL.createObjectURL(blob);
}


/* =========================
   مخزن العائلات (KV)
========================= */
async function put(key, val) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}

async function get(key) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    let out;
    r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => res(out);
    tx.onerror    = () => rej(tx.error);
    tx.onabort    = () => rej(tx.error);
  });
}

// عمليات أساسية إضافية
async function del(key){
  const db = await open();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort  = () => rej(tx.error);
  });
}

async function has(key){
  const db = await open();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const r = tx.objectStore(STORE).getKey(key);
    let ok = false;
    r.onsuccess = () => { ok = r.result != null; };
    tx.oncomplete = () => res(ok);
    tx.onerror = () => rej(tx.error);
    tx.onabort  = () => rej(tx.error);
  });
}

async function getAllFamilies(){
  const db = await open();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const st = tx.objectStore(STORE);
    const reqKeys = st.getAllKeys();
    const reqVals = st.getAll();
    let keys=null, vals=null;
    reqKeys.onsuccess = () => { keys = reqKeys.result || []; if (vals) finish(); };
    reqVals.onsuccess = () => { vals = reqVals.result || []; if (keys) finish(); };
    function finish(){
      const out = {};
      for(let i=0;i<keys.length;i++) out[keys[i]] = vals[i];
      res(out);
    }
    tx.onerror = () => rej(tx.error);
    tx.onabort  = () => rej(tx.error);
  });
}

/* =========================
   تشخيصات اختيارية
========================= */
async function count(store) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).count();
    r.onsuccess = () => res(r.result | 0);
    r.onerror   = () => rej(r.error);
  });
}

async function keys(store) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAllKeys();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}

/* =========================
   حذف كامل لقاعدة البيانات
========================= */
async function nuke() {
  await _closeConn();
  return new Promise((resolve, reject) => {
    let settled = false, tries = 0;

    const attempt = () => {
      tries++;
      const req = indexedDB.deleteDatabase(DB_NAME);

      req.onsuccess = () => { if (!settled) { settled = true; resolve(); } };

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

    // بديل سريع إذا استمر الحظر
    setTimeout(async () => {
      if (settled) return;
      try { await _clearStores(); settled = true; resolve(); }
      catch (e) { settled = true; reject(e); }
    }, 1200);
  });
}

/* =========================
   تصدير الواجهة
========================= */
export const DB = {
  // KV
  put, get, del, has, getAllFamilies,

  // Photos الأشخاص
  putPhoto, getPhoto, clearPhoto, listPhotoIds, delPhotosBulk,

  // Photos القصص
  putStoryImage, getStoryImageURL,

  // Photos الأحداث
  putEventImage, getEventImageURL,

  // إدارة
  nuke,

  // تشخيص
  _countFamilies: () => count(STORE),
  _countPhotos:   () => count(PHOTO_STORE),
  _keysFamilies:  () => keys(STORE),
  _keysPhotos:    () => keys(PHOTO_STORE),
};
