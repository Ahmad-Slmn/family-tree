// features/photo.js — الصور (تدوير/قص + إدارة ذاكرة/إبطال + قنوات Canvas آمنة)
import { byId, showInfo, showError, showSuccess, showWarning, showConfirmModal, createImageViewerOverlay } from '../utils.js';
import * as Model from '../model/families.js';
import * as TreeUI from '../ui/tree.js';
import { openPhotoGallery, PRESET_PHOTOS } from './photoGallery.js';

const { findPathByIdInFamily } = Model;

const JPEG_Q = 0.72;
const A_HASH_THRESHOLD = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB

// إدارة Blob URLs بشكل مركزي لمنع التسريب
const _trackedObjectURLs = new Set();
function trackObjectURL(u){
  if (u && typeof u === 'string' && u.startsWith('blob:')) _trackedObjectURLs.add(u);
  return u;
}
function revokeTrackedObjectURL(u){
  if (!u) return;
  if (_trackedObjectURLs.has(u)) _trackedObjectURLs.delete(u);
  try{ URL.revokeObjectURL(u); }catch{}
}
function revokeAllTrackedObjectURLs(){
  for (const u of Array.from(_trackedObjectURLs)) revokeTrackedObjectURL(u);
}


// Busy state + Busy Indicator (auto-create) + Dynamic Message
function ensurePhotoBusyIndicator(photoBox){
  if (!photoBox) return null;

  // لازم يكون container قابل للـ overlay
  const st = getComputedStyle(photoBox);
if (st.position === 'static') photoBox.classList.add('photo-box--relative');

  let el = photoBox.querySelector('#photoBusyOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'photoBusyOverlay';
  el.className = 'photo-busy-overlay';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('hidden','');

  el.innerHTML = `
    <div class="photo-busy-card" role="status" aria-live="polite">
      <span class="photo-busy-spinner" aria-hidden="true"></span>
      <div class="photo-busy-text">
        <div class="photo-busy-title" id="photoBusyTitle">جارٍ المعالجة…</div>
        <div class="photo-busy-sub" id="photoBusySub">يرجى الانتظار لحظات</div>
      </div>
    </div>
  `;

  photoBox.appendChild(el);
  return el;
}

/**
 * setPhotoBusy(ctx, true, { title, sub })
 * أو setPhotoBusy(ctx, true, 'جارٍ ضغط الصورة…')
 */
function setPhotoBusy(ctx, v, msg){
  if (!ctx?.dom) return;

  const busy = !!v;
  ctx.dom.photoBusy = busy;

  const photoBox = byId('bioPhoto');
  if (photoBox){
    const overlay = ensurePhotoBusyIndicator(photoBox);

    // CSS state + aria
    photoBox.classList.toggle('is-photo-busy', busy);
    photoBox.setAttribute('aria-busy', busy ? 'true' : 'false');

    // تحديث النص (اختياري)
    if (overlay){
      const titleEl = overlay.querySelector('#photoBusyTitle');
      const subEl   = overlay.querySelector('#photoBusySub');

      let title = 'جارٍ المعالجة…';
      let sub   = 'يرجى الانتظار لحظات';

      // يدعم msg كنص أو كائن
      if (typeof msg === 'string' && msg.trim()){
        title = msg.trim();
      } else if (msg && typeof msg === 'object'){
        if (typeof msg.title === 'string' && msg.title.trim()) title = msg.title.trim();
        if (typeof msg.sub === 'string' && msg.sub.trim()) sub = msg.sub.trim();
      }

      if (titleEl) titleEl.textContent = title;
      if (subEl)   subEl.textContent   = sub;

      // إظهار/إخفاء
      if (busy) overlay.removeAttribute('hidden');
      else overlay.setAttribute('hidden','');
    }
  }

  ctx.syncPhotoUI?.();
}

/* =========================================================
 * أدوات مساعدة عامة
 * ========================================================= */

// تفسير رسائل putPhoto القادمة من DB
function explainPutPhotoError(err){
  const m = String(err?.message || '');
  if (/blob too large/i.test(m))     return 'حجم الصورة كبير. الحد الأقصى 8MB.';
  if (/unsupported mime/i.test(m))   return 'صيغة الصورة غير مدعومة. الصيغ المسموحة: JPEG / PNG / WebP / GIF / BMP.';
  if (/quota|storage/i.test(m))      return 'مساحة التخزين ممتلئة أو مرفوضة من المتصفح.';
  return null;
}

// فحص وجود صورة “مشار إليها” داخل الموديل (ليس بالضرورة وجود Blob فعلي في DB)
function hasSavedPhoto(p){
  const a = (p?.bio?.photoUrl || '').trim();
  const b = (p?.photoUrl || '').trim();
  return !!(a || b);
}

/* =========================================================
 * إدارة fetch الجاري + قنوات Canvas آمنة (تجنّب تلوّث/مشاكل CORS)
 * ========================================================= */

// Abort مخصص لمسارات UI فقط (عند إغلاق الشخص/اختيار جديد...)
// لا يُستخدم داخل utilities العامة لتجنب race بين عدة عمليات hash/compare.
let _uiFetchCtrl = null;
function abortOngoingFetch(){
  try { _uiFetchCtrl?.abort(); } catch {}
  _uiFetchCtrl = null;
}


/**
 * يحوّل src إلى URL آمن للرسم في Canvas:
 * - blob:/data: يعود كما هو
 * - idb:PID يتم تحويله إلى Blob URL
 * - http/https/file يتم fetch ثم تحويله إلى Blob URL
 */
async function ensureCanvasSafeBlobURL(src, opts = {}){
  const { signal } = opts;

  if (!src) return { url: src, created: false };
  if (src.startsWith('blob:') || src.startsWith('data:')) return { url: src, created: false };

  if (src.startsWith('idb:')){
    try{
      const pid = src.slice(4);
      const blob = await (window.__photoCtx?.DB?.getPhoto?.(pid));
      if (blob instanceof Blob){
        const u = trackObjectURL(URL.createObjectURL(blob));
        return { url: u, created: true };
      }
    }catch{}
    return { url: '', created: false };
  }

  const res = await fetch(src, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

  const blob = await res.blob();
  return { url: trackObjectURL(URL.createObjectURL(blob)), created: true };
}


/* =========================================================
 * aHash + Hamming (كشف التطابق تقريبياً)
 * ========================================================= */

function hamming(a, b){
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i=0;i<a.length;i++) if (a[i] !== b[i]) d++;
  return d;
}
function nextFrame(){
  return new Promise(r => requestAnimationFrame(() => r()));
}

// Helper: تحديث نص الـ Busy ثم انتظار فريم حتى يرسم
async function setBusyMsg(ctx, title, sub){
  setPhotoBusy(ctx, true, { title, sub });
  await nextFrame();
}


async function withPhotoBusy(ctx, fn, msg){
  setPhotoBusy(ctx, true, msg);

  // مهم جدًا: دع الـ UI يرسم (spinner + disabled) قبل بدء العمل الثقيل
  await nextFrame();

  try{
    return await fn();
  } finally {
    setPhotoBusy(ctx, false);
  }
}

async function aHashFromSrc(src, size = 32, blocks = 8){
  const safe = await ensureCanvasSafeBlobURL(src);
  const url  = safe.url || src;

  try{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;

    if (typeof img.decode === 'function') await img.decode();
    else await new Promise((r, j)=>{ img.onload=r; img.onerror=()=>j(new Error('load fail')); });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const s = Math.max(1, Math.min(w, h));
    const sx = (w - s)/2, sy = (h - s)/2;

    const c = document.createElement('canvas');
    c.width = size; c.height = size;

    const ctx = c.getContext('2d', { alpha:false });
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

    const { data } = ctx.getImageData(0,0,size,size);
    const block = size / blocks;
    const acc = Array.from({ length: blocks*blocks }, () => 0);

    let idx = 0;
    for (let y=0; y<size; y++){
      for (let x=0; x<size; x++){
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const gray = (r*0.299 + g*0.587 + b*0.114) | 0;
        const bx = Math.floor(x / block), by = Math.floor(y / block);
        acc[by*blocks + bx] += gray;
        idx += 4;
      }
    }

    for (let i=0;i<acc.length;i++) acc[i] = acc[i] / (block*block);
    const mean = acc.reduce((a,b)=>a+b,0) / acc.length;

    let bits = '';
    for (let i=0;i<acc.length;i++) bits += (acc[i] >= mean ? '1' : '0');
    return bits; // 64-bit string
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')){
      revokeTrackedObjectURL(safe.url);
    }
  }

}

/* =========================================================
 * قراءة/ضغط الصور (File/Blob/URL → DataURL/Blob)
 * ========================================================= */
// قراءة Orientation من EXIF للـ JPEG (بدون مكتبات) — hardened + accurate APP1 scan
function readJpegExifOrientation(arrayBuffer){
  try{
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 4) return 1;

    if (view.getUint16(0, false) !== 0xFFD8) return 1; // SOI

    let offset = 2;
    const len = view.byteLength;

    // (1) قبل أي getUint16(offset,false) لازم نتأكد فيه بايتين
    while (offset + 2 <= len){
      const marker = view.getUint16(offset, false);
      offset += 2;

      // Markers بدون length (Stand-alone): SOI, TEM, RSTn
      if (marker === 0xFFD8 || marker === 0xFF01 || (marker >= 0xFFD0 && marker <= 0xFFD7)) {
        continue;
      }

      // التوقف عند SOS/EOI: بعد SOS تبدأ بيانات مضغوطة وليست segments بنفس النمط
      if (marker === 0xFFDA || marker === 0xFFD9) break;

      // لازم نقدر نقرأ length
      if (offset + 2 > len) break;

      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;

      // نهاية هذا الـ segment (length شامل 2 بايت نفسها)
      const segStart = offset;          // عند حقل length
      const segEnd   = segStart + segLen;

      // (2) guard عام: لا تتجاوز طول الملف (مهم لملفات مقصوصة)
      if (segEnd > len) break;

      // APP1
      if (marker === 0xFFE1){
        // داخل APP1: بعد length مباشرة يبدأ payload
        const payload = segStart + 2;

        // نحتاج على الأقل 6 بايت لتفحص Exif\0\0
        if (payload + 6 <= segEnd){
          const isExif =
            (view.getUint32(payload, false) === 0x45786966) && // "Exif"
            (view.getUint16(payload + 4, false) === 0x0000);    // "\0\0"

          // (4) APP1 قد يكون XMP قبل EXIF → لا ترجع 1، كمل للـ APP1 التالي
          if (!isExif){
            offset = segEnd;
            continue;
          }

          // Exif\0\0
          let exifOffset = payload + 6;

          // TIFF header needs 8 bytes
          if (exifOffset + 8 > segEnd) {
            offset = segEnd;
            continue;
          }

          const tiffOffset = exifOffset;
          const endianness = view.getUint16(tiffOffset, false);

          const little = endianness === 0x4949; // "II"
          if (!little && endianness !== 0x4D4D) {
            offset = segEnd;
            continue;
          }

          const get16 = (o)=> view.getUint16(o, little);
          const get32 = (o)=> view.getUint32(o, little);

          // 0x002A ثابت
          if (get16(tiffOffset + 2) !== 0x002A) {
            offset = segEnd;
            continue;
          }

          const ifd0Off = get32(tiffOffset + 4);
          let ifd0 = tiffOffset + ifd0Off;

          // IFD0 لازم يكون داخل APP1
          if (ifd0 < tiffOffset || ifd0 + 2 > segEnd) {
            offset = segEnd;
            continue;
          }

          const entries = get16(ifd0);
          ifd0 += 2;

          for (let i=0; i<entries; i++){
            const ent = ifd0 + i*12;
            if (ent + 12 > segEnd) break;

            const tag = get16(ent);

            if (tag === 0x0112){
              // (3) تحقق type/count بدقة
              const type  = get16(ent + 2);
              const count = get32(ent + 4);

              if (type !== 3 || count !== 1) return 1;

              const value = get16(ent + 8);
              return value || 1;
            }
          }
        }

        // ما لقينا orientation داخل هذا الـ APP1 → كمّل للي بعده
        offset = segEnd;
        continue;
      }

      // أي segment آخر: تخطَّه بشكل آمن
      offset = segEnd;
    }
  } catch {}
  return 1;
}


function applyOrientationTransform(ctx2d, orientation, w, h){
  // transforms قياسية
  switch (orientation){
    case 2: ctx2d.translate(w, 0); ctx2d.scale(-1, 1); break;              // flip X
    case 3: ctx2d.translate(w, h); ctx2d.rotate(Math.PI); break;           // 180
    case 4: ctx2d.translate(0, h); ctx2d.scale(1, -1); break;              // flip Y
    case 5: ctx2d.rotate(0.5*Math.PI); ctx2d.scale(1, -1); break;          // transpose
    case 6: ctx2d.rotate(0.5*Math.PI); ctx2d.translate(0, -h); break;      // 90 CW
    case 7: ctx2d.rotate(0.5*Math.PI); ctx2d.translate(w, -h); ctx2d.scale(-1, 1); break;
    case 8: ctx2d.rotate(-0.5*Math.PI); ctx2d.translate(-w, 0); break;     // 90 CCW
    default: break; // 1
  }
}

async function compressImageToDataURL(file, maxDim = 512, quality = JPEG_Q){
  if (!file) throw new Error('لا يوجد ملف.');
  if (file.size > MAX_PHOTO_BYTES) throw new Error('حجم الصورة كبير. الحد الأقصى 8MB.');

  const img = new Image();
  const url = trackObjectURL(URL.createObjectURL(file));

  // Orientation (JPEG فقط)
  let orientation = 1;
  try{
    if (/jpe?g/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '')){
      const buf = await file.arrayBuffer();
      orientation = readJpegExifOrientation(buf) || 1;
    }
  }catch{ orientation = 1; }

  try{
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('تعذر قراءة الملف.'));
      img.src = url;
    });

    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;

    // إذا orientation يبدّل الأبعاد (5/6/7/8)
    const swapWH = (orientation >= 5 && orientation <= 8);
    const wOr = swapWH ? h0 : w0;
    const hOr = swapWH ? w0 : h0;

    const scale = Math.min(1, maxDim / Math.max(wOr, hOr) || 1);
    const cw = Math.max(1, Math.round(wOr * scale));
    const ch = Math.max(1, Math.round(hOr * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;

    const ctx2d = canvas.getContext('2d', { alpha:false });

    // نرسم الصورة بعد تصحيح EXIF: نطبّق transform على canvas
    ctx2d.save();

    // نحتاج أبعاد الرسم الأصلية قبل التصغير
    // سنستخدم pattern: نرسم على canvas الحالي (cw,ch) لكن بمقياس scale
    // الأفضل: نطبّق transform على مساحة "مقاسة" كأنها w0,h0 ثم نرسم مع scale
    // أسهل: نرسم على canvas بأبعاد wOr,hOr ثم نصغّر؟ لكن هذا مكلف.
    // هنا نطبق transform على cw/ch بشكل مباشر باستخدام w0/h0 مع scale.
    const sx = scale, sy = scale;

    // نبني transform صحيح: نرسم img على "w0,h0" لكن إلى canvas "cw,ch".
    // نبدأ بتحويل إلى نظام مصغّر
    ctx2d.scale(sx, sy);

    // ثم نطبق orientation بالنسبة لأبعاد الأصل (w0,h0)
    applyOrientationTransform(ctx2d, orientation, w0, h0);

    // الرسم
    ctx2d.drawImage(img, 0, 0);

    ctx2d.restore();

    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    revokeTrackedObjectURL(url);
  }
}


// ضغط Blob عام لإعادة استخدامه عند الاستعادة/المعرض
async function compressBlobForPid(blob, maxDim = 512, quality = JPEG_Q){
  const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
  const dataUrl = await compressImageToDataURL(file, maxDim, quality);

  const res = await fetch(dataUrl);
  return await res.blob();
}

// قراءة URL إلى DataURL (يشمل idb:)
async function urlToDataURL(u, opts = {}){
  const { signal } = opts;
  if (u && u.startsWith('idb:')){
    const pid  = u.slice(4);
    const blob = await window.__photoCtx?.DB?.getPhoto?.(pid);
    if (!(blob instanceof Blob)) throw new Error('لم يتم العثور على الصورة في IndexedDB.');
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('تعذر قراءة البيانات.'));
      fr.readAsDataURL(blob);
    });
  }

  const res = await fetch(u, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();

  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('تعذر قراءة البيانات.'));
    fr.readAsDataURL(blob);
  });
}

/* =========================================================
 * عرض الصورة في bioPhoto + استرجاع المصدر (مع هجرة PID قديم→جديد)
 * ========================================================= */

async function resolvePersonPhotoSrc(person, DB){
  const pid = person?._id;

  // 1) وجود Blob تحت PID الحالي
  if (pid){
    try{
      const blob = await DB.getPhoto(pid);
      if (blob instanceof Blob) return trackObjectURL(URL.createObjectURL(blob));
    }catch{}
  }

  // 2) idb:PID_قديم → انسخها للـ PID الحالي ثم عدّل الموديل
  const purl = (person?.bio?.photoUrl || person?.photoUrl || '').trim();
  if (purl && purl.startsWith('idb:')){
    const oldPid = purl.slice(4);

    try{
      const oldBlob = await DB.getPhoto(oldPid);
      if (!(oldBlob instanceof Blob)) return '';

      if (pid && oldPid !== pid){
        await DB.putPhoto(pid, oldBlob);

        const famKey = Model.getSelectedKey();
        const fam    = Model.getFamilies()[famKey];

        const touch = (p)=>{
          if (p && p._id === pid){
            p.bio = p.bio || {};
            p.bio.photoUrl = `idb:${pid}`;
            p.photoUrl     = `idb:${pid}`;
            p.photoVer     = Date.now();
          }
        };

        const tops = [
          ...(Array.isArray(fam.ancestors)?fam.ancestors:[]),
          fam.father, fam.rootPerson, ...(fam.wives||[])
        ].filter(Boolean);

        tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
        (fam.rootPerson?.wives||[]).forEach(w=>{ touch(w); (w?.children||[]).forEach(touch); });

        Model.commitFamily(famKey);
        Model.savePersistedFamilies?.();
      }

      return trackObjectURL(URL.createObjectURL(oldBlob));
    }catch{
      return '';
    }
  }

  // 3) مسار خارجي عادي
  return purl || '';
}

async function renderPersonPhoto(box, person, srcMaybe, DB){
  // تنظيف img السابق وإبطال blob URL
  const old = box.querySelector('img');
  if (old){
    const oldSrc = old.currentSrc || old.src || '';
    if (oldSrc && oldSrc.startsWith('blob:')) revokeTrackedObjectURL(oldSrc);
    old.remove();
  }
  while (box.firstChild) box.removeChild(box.firstChild);

  const src = srcMaybe ?? await resolvePersonPhotoSrc(person, DB);

  if (!src){
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = TreeUI.getRoleAvatar(person?.role);
    box.appendChild(av);
    return;
  }

  const img = document.createElement('img');
  img.loading  = 'lazy';
  img.decoding = 'async';
  img.alt      = String(person?.name || '');
  img.crossOrigin = 'anonymous';

  // كسر كاش للمسارات غير data/blob
  const final = (src && !src.startsWith('data:') && !src.startsWith('blob:')) ? `${src}${src.includes('?') ? '&' : '?'}v=${Date.now()}`
    : src;

  img.src = final || '';
  if (final && final.startsWith('blob:')) img.dataset.blobUrl = final;
  else img.removeAttribute('data-blob-url');

  box.appendChild(img);
  try{ if (typeof img.decode === 'function') img.decode().catch(()=>{}); }catch{}
}

/* =========================================================
 * تدوير/قص بالرسم اليدوي (حل احتياطي)
 * ========================================================= */

async function rotateAndCenterCrop(dataUrlOrSrc, deg = 0, square = true){
const safe = await ensureCanvasSafeBlobURL(dataUrlOrSrc, { signal: _uiFetchCtrl?.signal });
  const src  = safe.url || dataUrlOrSrc;

  try{
    return await new Promise((resolve, reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const rad = (deg % 360) * Math.PI / 180;
        const s   = square ? Math.min(img.width, img.height) : Math.max(img.width, img.height);
        const sx  = (img.width  - s) / 2;
        const sy  = (img.height - s) / 2;

        const out = document.createElement('canvas');
        out.width = s; out.height = s;

        const t = document.createElement('canvas');
        t.width = s; t.height = s;

        const tx = t.getContext('2d', { alpha:false });
        tx.translate(s/2, s/2);
        tx.rotate(rad);
        tx.translate(-s/2, -s/2);
        tx.drawImage(img, sx, sy, s, s, 0, 0, s, s);

        out.getContext('2d', { alpha:false }).drawImage(t, 0, 0);

        try { resolve(out.toDataURL('image/jpeg', JPEG_Q)); }
        catch(e){ reject(e); }
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
      img.src = src;
    });
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')){
      revokeTrackedObjectURL(safe.url);
    }
  }

}

/* =========================================================
 * UI: أزرار أعلى (اختيار/حفظ/حذف) — كما هي وظيفيًا
 * ========================================================= */

function updatePhotoControls(dom){
  const removeBtn = byId('removePhotoBtn');
  const changeBtn = byId('changePhotoBtn');
  const saveBtn   = byId('savePhotoBtn');
  const photoBox  = byId('bioPhoto');
  const busy = !!dom?.photoBusy;

  if (!dom || !dom.currentPerson){
    if (saveBtn){
      saveBtn.setAttribute('hidden','');
      saveBtn.classList.remove('changed');
      if (!saveBtn.dataset.labelOriginal){
        saveBtn.dataset.labelOriginal = saveBtn.textContent.trim() || 'حفظ الصورة';
      }
      saveBtn.textContent = saveBtn.dataset.labelOriginal;
    } 
    if (removeBtn) removeBtn.setAttribute('hidden','');
    if (changeBtn) changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> إختيار صورة`;

    // هنا أيضًا (اختياري) إذا تحب: تعطيل أثناء busy حتى بدون currentPerson
    [removeBtn, changeBtn, saveBtn].forEach(btn=>{
      if (!btn) return;
      if (busy) btn.setAttribute('disabled','');
      else btn.removeAttribute('disabled');
    });

    return;
  }

  const hasPending = !!dom.pendingPhoto;
  const hasSaved   = hasSavedPhoto(dom.currentPerson);
  const hasImgEl   = !!photoBox?.querySelector('img');

  // زر الحذف
  if (removeBtn){
    if (hasSaved && hasImgEl) removeBtn.removeAttribute('hidden');
    else removeBtn.setAttribute('hidden','');
  }

  // زر اختيار/تغيير الصورة
  if (changeBtn){
    const rotatedNow = photoBox?.dataset.rotated === '1';
    const croppedNow = photoBox?.dataset.cropped === '1';

    if (hasPending){
      changeBtn.innerHTML = (rotatedNow || croppedNow) ? `<i class="fa-solid fa-xmark"></i> إلغاء التعديل`
        : `<i class="fa-solid fa-xmark"></i> إلغاء التحميل`;
    } else if (hasSaved){
      changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> تغيير الصورة`;
    } else {
      changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> إختيار صورة`;
    }
  }

  // زر الحفظ
  if (saveBtn){
    if (!saveBtn.dataset.labelOriginal){
      saveBtn.dataset.labelOriginal = saveBtn.textContent.trim() || 'حفظ الصورة';
    }
    const baseLabel = saveBtn.dataset.labelOriginal;

    if (hasPending){
      const rotatedNow = photoBox?.dataset.rotated === '1';
      const croppedNow = photoBox?.dataset.cropped === '1';

      saveBtn.removeAttribute('hidden');
      saveBtn.textContent = (rotatedNow || croppedNow) ? 'حفظ التعديل' : baseLabel;
      saveBtn.classList.add('changed');
    } else {
      saveBtn.setAttribute('hidden','');
      saveBtn.classList.remove('changed');
      saveBtn.textContent = baseLabel;
    }
  }

  // تعطيل أثناء المعالجة
  [removeBtn, changeBtn, saveBtn].forEach(btn=>{
    if (!btn) return;
    if (busy) btn.setAttribute('disabled','');
    else btn.removeAttribute('disabled');
  });
}


/* =========================================================
 * حفظ الصورة الحالية في IndexedDB وتحديث الموديل
 * ========================================================= */

async function persistPhotoForCurrent(dom, DB){
  if (!dom.currentPerson || !dom.pendingPhoto) return;
  if (!dom.currentPerson._id) return;

  const pid = dom.currentPerson._id;

  // UI-only abort: مهم عند close/اختيار جديد أثناء تحميل pendingPhoto
  abortOngoingFetch();
  _uiFetchCtrl = new AbortController();

  let res;
  try{
    res = await fetch(dom.pendingPhoto, { signal: _uiFetchCtrl.signal });
  }catch(e){
    if (e?.name === 'AbortError') return; // إلغاء طبيعي
    throw e;
  } finally {
    _uiFetchCtrl = null; // تنظيف حتى بعد النجاح/الفشل
  }

  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

  const blob = await res.blob();

  try {
    await DB.putPhoto(pid, blob); // نسخة العرض السريع (المصغّرة)
  } catch (e){
    const msg = explainPutPhotoError(e);
    showError(msg || 'تعذّر حفظ الصورة.');
    throw e;
  }

  // نسخة كاملة اختيارية: لو عندنا pendingFullBlob نستخدمها، وإلا نخزن نفس blob
  try{
    const fullBlob = (dom.pendingFullBlob instanceof Blob) ? dom.pendingFullBlob : blob;
    await DB.putPhoto(pid + '_full', fullBlob);
  } catch {
    // لا نكسر العملية لو فشل full (مساحة/Quota)
  }

  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];

  const updateEverywhere = (p)=>{
    if (!p.bio) p.bio = {};
    p.bio.photoUrl = `idb:${pid}`;
    p.photoUrl     = `idb:${pid}`;
    p.photoVer     = Date.now();
  };

  const touch = (p)=>{ if (p && p._id === pid) updateEverywhere(p); };

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
  ((fam.rootPerson && Array.isArray(fam.rootPerson.wives)) ? fam.rootPerson.wives : []).forEach(w=>{
    touch(w); (w?.children||[]).forEach(touch);
  });

  Model.linkRootPersonWives?.();
  await Model.savePersistedFamilies?.();

  if (TreeUI.refreshAvatarById) TreeUI.refreshAvatarById({ _id: pid, ...dom.currentPerson });
}


/* =========================================================
 * حذف الصورة مع تأكيد
 * ========================================================= */

async function handleRemovePhotoClick(e, ctx){
  e.preventDefault();
  const target = ctx.dom.currentPerson;
  if (!target) return;

  const photoBox = byId('bioPhoto');

// إلغاء التحميل/التعديل المؤقت
if (ctx.dom.pendingPhoto){
  ctx.dom.pendingPhoto = null;
  ctx.dom.pendingFullBlob = null;

  if (photoBox){
    restoreSavedFlagsToPhotoBox(photoBox, target);
    await renderPersonPhoto(photoBox, target, undefined, ctx.DB);

    // (اختياري) snapshot
    pushHistorySnapshot(ctx, { pending: null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });
  }

  ctx.syncPhotoUI?.();
  showInfo('تم إلغاء التعديل/التحميل المؤقت.');
  return;
}

  const res = await showConfirmModal({
    title: 'تأكيد حذف الصورة',
    message: 'سيتم حذف الصورة والرجوع للصورة الافتراضية. هل أنت متأكد؟',
    confirmText: 'حذف',
    cancelText: 'إلغاء',
    variant: 'danger',
    _ariaRole: 'alertdialog'
  });
  if (res !== 'confirm') return;

  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];
  const pid    = target._id;

  const updateEverywhere = (p) => {
    p.bio = Object.assign({}, p.bio || {}, { photoUrl: '' });
    p.photoUrl = '';
    p.photoVer = Date.now();
    if (p.bio){
      delete p.bio.photoCropped;
      delete p.bio.photoRotated;
      delete p.bio.photoHasOrig;
    }
  };

  const touch = (p)=>{ if (p && p._id === pid) updateEverywhere(p); };

  const tops  = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
  ((fam.rootPerson && Array.isArray(fam.rootPerson.wives)) ? fam.rootPerson.wives : []).forEach(w=>{
    touch(w); (w?.children||[]).forEach(touch);
  });

  Model.commitFamily(famKey);

  try{
    const famKey2 = Model.getSelectedKey();
    const fam2    = Model.getFamilies()[famKey2];
    const path2   = findPathByIdInFamily(fam2, pid);

    await ctx.DB.clearPhoto(pid + '_orig');
    if (path2) await ctx.DB.clearPhoto(`orig:${famKey2}:${path2}`);
    await ctx.DB.clearPhoto(pid + '_cropBase');
  }catch{}

  await ctx.DB.clearPhoto(pid);

  if (photoBox) await renderPersonPhoto(photoBox, target, '', ctx.DB);
  ctx.syncPhotoUI?.();

  const updated = ctx.findPersonByIdInFamily?.(fam, pid) || ctx.dom.currentPerson;
  if (TreeUI.clearPersonPhotoCache) TreeUI.clearPersonPhotoCache(pid);
  if (TreeUI.refreshAvatarById) TreeUI.refreshAvatarById(updated);
  ctx.handlers?.onShowDetails?.(pid, { silent: true });

  if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid){
    ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
    ctx.dom.currentPerson.bio.photoUrl = '';
    ctx.dom.currentPerson.photoUrl = '';
    ctx.dom.currentPerson.photoVer = Date.now();
  }

  ctx.syncPhotoUI?.();
  showSuccess('تم حذف الصورة والرجوع إلى الافتراضي.');
}

/* =========================================================
 * الأصل/القص: حفظ snapshot مرة واحدة + baseline للقص + استعادة
 * ========================================================= */

// حفظ نسخة “الأصل” مرة واحدة فقط (وضع flag عند نجاح الحفظ فعليًا)
async function ensureOriginalSnapshotOnce(ctx){
  const pid = ctx?.dom?.currentPerson?._id;
  if (!pid) return;

  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];
  const path   = findPathByIdInFamily(fam, pid);

  const hasFlag = !!ctx.dom?.currentPerson?.bio?.photoHasOrig;
  let existing  = null;

  try { existing = await ctx.DB.getPhoto(pid + '_orig'); } catch {}
  if (hasFlag && existing instanceof Blob) return;

  const imgEl = byId('bioPhoto')?.querySelector('img');
  if (!imgEl) return;

  const safe = await ensureCanvasSafeBlobURL(imgEl.src, { signal: _uiFetchCtrl?.signal });
  try{
    const origRes  = await fetch(safe.url || imgEl.src, _uiFetchCtrl?.signal ? { signal: _uiFetchCtrl.signal } : undefined);
    if (!origRes.ok) throw new Error(`fetch failed: ${origRes.status}`);
    const origBlob = await origRes.blob();

    try{
      await ctx.DB.putPhoto(pid + '_orig', origBlob);
      if (path) await ctx.DB.putPhoto(`orig:${famKey}:${path}`, origBlob);
    } catch (e){
      const msg = explainPutPhotoError(e);
      showWarning(msg || 'تعذّر حفظ نسخة الأصل بسبب قيود المتصفح أو مساحة التخزين.');
      return;
    }

    const touch = (p)=>{
      if (p && p._id === pid){
        p.bio = p.bio || {};
        p.bio.photoHasOrig = 1;
      }
    };

    const tops = [
      ...(Array.isArray(fam.ancestors)?fam.ancestors:[]),
      fam.father, fam.rootPerson, ...(fam.wives||[])
    ].filter(Boolean);

    tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
    (fam.rootPerson?.wives||[]).forEach(w=>{ touch(w); (w?.children||[]).forEach(touch); });

    if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid){
      ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
      ctx.dom.currentPerson.bio.photoHasOrig = 1;
    }

    Model.commitFamily(famKey);
    Model.savePersistedFamilies?.();
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')){
      revokeTrackedObjectURL(safe.url);
    }
  }

}

// حفظ أساس القص (baseline) لكي نستطيع التراجع محليًا
async function saveCropBaseline(ctx, pid, imgEl){
  const safe = await ensureCanvasSafeBlobURL(imgEl.src, { signal: _uiFetchCtrl?.signal });
  try{
    const baseRes = await fetch(safe.url || imgEl.src, _uiFetchCtrl?.signal ? { signal: _uiFetchCtrl.signal } : undefined);
    if (!baseRes.ok) throw new Error(`fetch failed: ${baseRes.status}`);
    const blob = await baseRes.blob();

    try{
      await ctx.DB.putPhoto(pid + '_cropBase', blob);
    } catch(e){
      const msg = explainPutPhotoError(e);
      showWarning(msg || 'تعذّر حفظ أساس القص. سيُنفَّذ القص بدون نقطة رجوع محلية.');
    }
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')){
      revokeTrackedObjectURL(safe.url);
    }
  }
}

async function restoreCropBaselineIfAny(ctx, photoBox, pid){
  const base = await ctx.DB.getPhoto(pid + '_cropBase');

  if (base instanceof Blob){
    const small = await compressBlobForPid(base);
    await ctx.DB.putPhoto(pid, small);
  }

  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);

  // تثبيت المرجع وإزالة علم القص في الموديل
  const famKey$ = Model.getSelectedKey();
  const fam$    = Model.getFamilies()[famKey$];

  const touch = (p) => {
    if (p && p._id === pid){
      p.bio = p.bio || {};
      p.bio.photoUrl = `idb:${pid}`;
      p.photoUrl     = `idb:${pid}`;
      p.photoVer     = Date.now();
      delete p.bio.photoCropped;
    }
  };

  const tops = [
    ...(Array.isArray(fam$.ancestors) ? fam$.ancestors : []),
    fam$.father, fam$.rootPerson, ...(fam$.wives || [])
  ].filter(Boolean);

  tops.forEach(p => { touch(p); (p?.children || []).forEach(touch); (p?.wives || []).forEach(touch); });
  (fam$.rootPerson?.wives || []).forEach(w => { touch(w); (w?.children || []).forEach(touch); });

  Model.commitFamily(famKey$);

  delete photoBox.dataset.cropped;
  ctx.dom.pendingPhoto = null;
  ctx.syncPhotoUI?.();

  if (TreeUI.clearPersonPhotoCache) TreeUI.clearPersonPhotoCache(pid);
  if (TreeUI.refreshAvatarById) TreeUI.refreshAvatarById({ _id: pid, ...ctx.dom.currentPerson });
}

// استعادة الأصل إن وُجد (من مسارين pid_orig أو orig:fam:path) — مع شرط flag
async function getOriginalBlob(ctx){
  const pid = ctx?.dom?.currentPerson?._id;
  if (!pid) return null;

  const hasFlag = !!ctx.dom?.currentPerson?.bio?.photoHasOrig;
  if (!hasFlag) return null;

  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];
  const path   = findPathByIdInFamily(fam, pid);

  let blob = await ctx.DB.getPhoto(pid + '_orig');
  if (!(blob instanceof Blob) && path){
    const b2 = await ctx.DB.getPhoto(`orig:${famKey}:${path}`);
    if (b2 instanceof Blob) blob = b2;
  }
  return (blob instanceof Blob) ? blob : null;
}

async function restoreOriginalIfAny(ctx, photoBox, pid){
  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];
  const path   = findPathByIdInFamily(fam, pid);

  let origBlob = await ctx.DB.getPhoto(pid + '_orig');
  if (!(origBlob instanceof Blob) && path){
    const b2 = await ctx.DB.getPhoto(`orig:${famKey}:${path}`);
    if (b2 instanceof Blob) origBlob = b2;
  }

  if (origBlob instanceof Blob){
    const small = await compressBlobForPid(origBlob);
    await ctx.DB.putPhoto(pid, small);
      try { await ctx.DB.putPhoto(pid + '_full', origBlob); } catch {}

  }

  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);

  // ثبّت المرجع + زد photoVer على كل النسخ
  {
    const famKeyF = Model.getSelectedKey();
    const famF    = Model.getFamilies()[famKeyF];
    const now     = Date.now();

    const touch = (p)=>{
      if (p && p._id === pid){
        p.bio = p.bio || {};
        p.bio.photoUrl = `idb:${pid}`;
        p.photoUrl     = `idb:${pid}`;
        p.photoVer     = now;
      }
    };

    const tops = [
      ...(Array.isArray(famF.ancestors) ? famF.ancestors : []),
      famF.father,
      famF.rootPerson,
      ...(famF.wives || [])
    ].filter(Boolean);

    tops.forEach(p => { touch(p); (p?.children || []).forEach(touch); (p?.wives || []).forEach(touch); });
    (famF.rootPerson?.wives || []).forEach(w => { touch(w); (w?.children || []).forEach(touch); });

    // امسح أعلام القص/التدوير/الأصل + أعلام التحويل الإضافية
    const clearFlags = (p)=>{
      if (p && p._id === pid && p.bio){
        delete p.bio.photoHasOrig;
        delete p.bio.photoCropped;
        delete p.bio.photoRotated;

        delete p.bio.photoRotateDeg;
        delete p.bio.photoFlipX;
        delete p.bio.photoFlipY;
        delete p.bio.photoFitted;
      }
    };

    tops.forEach(p => { clearFlags(p); (p?.children || []).forEach(clearFlags); (p?.wives || []).forEach(clearFlags); });

    // تصحيح: famF بدل fam
    (famF.rootPerson?.wives || []).forEach(w => { clearFlags(w); (w?.children || []).forEach(clearFlags); });

    Model.commitFamily(famKeyF);
    Model.savePersistedFamilies?.();
  }

  // الأفضل: صفّر pending قبل أي مزامنة UI
  ctx.dom.pendingPhoto = null;

  // امسح flags من الـ dataset بعد الاستعادة
  delete photoBox.dataset.cropped;
  delete photoBox.dataset.rotated;
  delete photoBox.dataset.rotateDeg;
  delete photoBox.dataset.flipX;
  delete photoBox.dataset.flipY;
  delete photoBox.dataset.fitted;

  // صفّر السلايدر
  const range = byId('freeRotate');
  const out   = byId('freeRotateVal');
  if (range) range.value = '0';
  if (out) out.textContent = '0°';

  try { TreeUI.clearPersonPhotoCache?.(pid); } catch {}
  try { TreeUI.refreshAvatarById?.({ _id: pid, ...ctx.dom.currentPerson }); } catch {}

  // إعادة حقن src لكسر كاش (كما كان)
  try{
    const ver = ctx.dom.currentPerson?.photoVer || Date.now();
    document.querySelectorAll(`[data-person-id="${pid}"] img.person-avatar`).forEach(img=>{
      const base = `idb:${pid}`;
      img.src = `${base}${base.includes('?') ? '&' : '?'}v=${ver}`;
    });
  }catch{}

  ctx.syncPhotoUI?.();
  try { ctx.bus.emit?.('person:photo-changed', { pid }); } catch {}

  showSuccess('تمت استعادة الصورة الأصلية.');
}

/* =========================================================
 * Cropper.js — واجهة القص
 * ========================================================= */

async function openCropperFor(photoBox){
  byId('cropperLayer')?.remove();
  const img = photoBox.querySelector('img');
  if (!img) return;

  const layer = document.createElement('div');
  layer.id = 'cropperLayer';
  layer.className = 'photo-modal-layer';

  layer.innerHTML = `
    <div class="photo-modal-card">
      <div class="photo-modal-actions">
        <button id="crpCancel" class="btn tiny">إلغاء</button>
        <button id="crpDone"   class="btn tiny primary">اعتماد القص</button>
      </div>
      <div class="photo-modal-body">
        <img id="crpImg" alt="" class="photo-modal-img">
      </div>
    </div>
  `;
  document.body.appendChild(layer);

  const editorImg = layer.querySelector('#crpImg');
  const safe = await ensureCanvasSafeBlobURL(img.src, { signal: _uiFetchCtrl?.signal });
  editorImg.crossOrigin = 'anonymous';
  editorImg.src = safe.url || img.src;

  const cropper = new window.Cropper(editorImg, {
    viewMode: 1,
    aspectRatio: 1,
    autoCropArea: 1,
    dragMode: 'move',
    movable: true,
    zoomable: true,
    rotatable: true,
    scalable: false,
    background: false
  });

  const cleanup = () => {
    try{ cropper?.destroy?.(); }catch{}
    if (safe.created && safe.url?.startsWith('blob:')) revokeTrackedObjectURL(safe.url);
    layer.remove();
  };

  layer.querySelector('#crpCancel').onclick = cleanup;

  layer.querySelector('#crpDone').onclick = async () => {
    const ctx = window.__photoCtx;
    setPhotoBusy(ctx, true);

    try{
      await ensureOriginalSnapshotOnce(ctx);

      const c = cropper.getCroppedCanvas({ imageSmoothingEnabled: true });

      const maxDim = 512;
      const scale  = Math.min(1, maxDim / Math.max(c.width, c.height));
      const dst    = document.createElement('canvas');
      dst.width    = Math.max(1, Math.round(c.width  * scale));
      dst.height   = Math.max(1, Math.round(c.height * scale));

      await window.pica().resize(c, dst);

      const preBlob = await new Promise(res => dst.toBlob(res, 'image/jpeg', 0.92));
      const compressed = await new Promise((resolve, reject) =>
        new window.Compressor(preBlob, { quality: JPEG_Q, success: resolve, error: reject })
      );

      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('فشل التحويل'));
        fr.readAsDataURL(compressed);
      });

      const photoBox2 = byId('bioPhoto');
      if (await acceptOrRejectSame(ctx, dataUrl, photoBox2)){
        photoBox2.dataset.cropped = '1';
        ctx.syncPhotoUI?.();
        showInfo('تم تجهيز القص — لم يُحفظ بعد.');
      }
    } catch {
      showError('تعذّر إتمام القص/الضغط.');
    } finally {
      setPhotoBusy(ctx, false);
      cleanup();
    }
  };
}


/* =========================================================
 * هاش الصورة الحالية/الأصلية + تصنيف المرشح
 * ========================================================= */

async function currentPhotoHash(ctx){
  const person = ctx.dom.currentPerson;
  if (!person) return '';

  const imgEl = byId('bioPhoto')?.querySelector('img');
  if (imgEl?.src){
    try { return await aHashFromSrc(imgEl.src); } catch {}
  }

  const savedRaw = (person.bio?.photoUrl || person.photoUrl || '').trim();
  try{
    if (savedRaw.startsWith('idb:')){
      const pid2 = savedRaw.slice(4);
      const blob = await ctx.DB.getPhoto(pid2);
      if (blob instanceof Blob){
       const u = trackObjectURL(URL.createObjectURL(blob));
try { return await aHashFromSrc(u); }
finally { revokeTrackedObjectURL(u); }

      }
      return '';
    }
    if (savedRaw) return await aHashFromSrc(savedRaw);
  }catch{}

  return '';
}

async function originalPhotoHash(ctx){
  if (!ctx?.dom?.currentPerson?.bio?.photoHasOrig) return '';
  try{
    const blob = await getOriginalBlob(ctx);
    if (!blob) return '';
 const u = trackObjectURL(URL.createObjectURL(blob));
try { return await aHashFromSrc(u); }
finally { revokeTrackedObjectURL(u); }

  }catch{
    return '';
  }
}

/** يصنّف المرشح: 'same-current' | 'same-original' | 'different' */
async function classifyCandidate(ctx, candidateSrc){
  const hasOrig = !!ctx?.dom?.currentPerson?.bio?.photoHasOrig;

  const [nh, ch, ohRaw] = await Promise.all([
    aHashFromSrc(candidateSrc).catch(()=> ''),
    currentPhotoHash(ctx).catch(()=> ''),
    (hasOrig ? originalPhotoHash(ctx) : Promise.resolve('')).catch(()=> '')
  ]);

  const oh = hasOrig ? ohRaw : '';
  const near = (a,b)=> (a && b && hamming(a,b) <= A_HASH_THRESHOLD);

  if (near(nh, ch)) return 'same-current';
  if (near(nh, oh)) return 'same-original';
  return 'different';
}

/* =========================================================
 * قبول/رفض المرشح + إدخال صورة جديدة وفق المنطق
 * ========================================================= */

function ensureHistory(ctx){
  if (!ctx?.dom) return;
  if (!Array.isArray(ctx.dom.photoHistory)) ctx.dom.photoHistory = [];
  if (typeof ctx.dom.photoHistoryIndex !== 'number') ctx.dom.photoHistoryIndex = -1;
}

function readFlagsFromPhotoBox(photoBox){
  const ds = photoBox?.dataset || {};
  return {
    rotated: ds.rotated === '1',
    cropped: ds.cropped === '1',
    fitted:  ds.fitted === '1',
    flipX:   ds.flipX === '1',
    flipY:   ds.flipY === '1',
    rotateDeg: Number(ds.rotateDeg || 0) || 0
  };
}

function applyFlagsToPhotoBox(photoBox, flags){
  if (!photoBox) return;
  const ds = photoBox.dataset;

  if (flags?.rotated) ds.rotated = '1'; else delete ds.rotated;
  if (flags?.cropped) ds.cropped = '1'; else delete ds.cropped;

  if (flags?.fitted)  ds.fitted  = '1'; else delete ds.fitted;

  if (flags?.flipX)   ds.flipX   = '1'; else delete ds.flipX;
  if (flags?.flipY)   ds.flipY   = '1'; else delete ds.flipY;

  const deg = Number(flags?.rotateDeg || 0) || 0;
  if (deg) ds.rotateDeg = String(deg);
  else delete ds.rotateDeg;
}

// يرجّع Flags من الموديل (الحالة المحفوظة) إلى photoBox + يزامن الـ slider
function restoreSavedFlagsToPhotoBox(photoBox, person){
  if (!photoBox) return;

  // امسح كل flags أولًا (حتى لو كانت موجودة من pending سابق)
  delete photoBox.dataset.rotated;
  delete photoBox.dataset.cropped;
  delete photoBox.dataset.fitted;
  delete photoBox.dataset.flipX;
  delete photoBox.dataset.flipY;
  delete photoBox.dataset.rotateDeg;

  const bio = person?.bio || {};

  if (bio.photoRotated) photoBox.dataset.rotated = '1';
  if (bio.photoCropped) photoBox.dataset.cropped = '1';
  if (bio.photoFitted)  photoBox.dataset.fitted  = '1';
  if (bio.photoFlipX)   photoBox.dataset.flipX   = '1';
  if (bio.photoFlipY)   photoBox.dataset.flipY   = '1';

  const deg = Number(bio.photoRotateDeg || 0) || 0;
  if (deg) photoBox.dataset.rotateDeg = String(deg);

  // مزامنة السلايدر
  const range = byId('freeRotate');
  const out   = byId('freeRotateVal');
  if (range) range.value = String(deg || 0);
  if (out)   out.textContent = `${deg || 0}°`;
}


function pushHistorySnapshot(ctx, snap){
  ensureHistory(ctx);

  // قص أي redo محتمل
  const idx = ctx.dom.photoHistoryIndex;
  ctx.dom.photoHistory = ctx.dom.photoHistory.slice(0, idx + 1);

  ctx.dom.photoHistory.push(snap);
  ctx.dom.photoHistoryIndex = ctx.dom.photoHistory.length - 1;
}

async function applyHistoryIndex(ctx, photoBox, newIndex){
  ensureHistory(ctx);
  const h = ctx.dom.photoHistory;
  if (!h.length) return;

  const idx = Math.max(0, Math.min(newIndex, h.length - 1));
  const snap = h[idx];
  if (!snap) return;

  setPhotoBusy(ctx, true);
  try{
    ctx.dom.photoHistoryIndex = idx;

    ctx.dom.pendingPhoto = snap.pending || null;
    applyFlagsToPhotoBox(photoBox, snap.flags || {});

    if (snap.pending){
      await renderPersonPhoto(photoBox, ctx.dom.currentPerson, snap.pending, ctx.DB);
    } else {
      await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);
    }

    ctx.syncPhotoUI?.();
  } finally {
    setPhotoBusy(ctx, false);
  }
}

async function acceptOrRejectSame(ctx, candidateSrc, photoBox){
  const newHash = await aHashFromSrc(candidateSrc);
  const curHash = await currentPhotoHash(ctx);

  if (newHash && curHash && hamming(newHash, curHash) <= A_HASH_THRESHOLD){
    ctx.dom.pendingPhoto = null;
    ctx.syncPhotoUI?.();
    showWarning('هذه نفس الصورة الحالية. لم يتم إجراء أي تغيير.');
    return false;
  }

  // pending
  ctx.dom.pendingPhoto = candidateSrc;
  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, candidateSrc, ctx.DB);

  // history snapshot (pending + flags الحالية)
  const flags = readFlagsFromPhotoBox(photoBox);
  pushHistorySnapshot(ctx, { pending: candidateSrc, flags, at: Date.now() });

  ctx.syncPhotoUI?.();
  return true;
}

async function handleNewCandidate(ctx, dataUrl, photoBox){
  const kind = await classifyCandidate(ctx, dataUrl);

  if (kind === 'same-current'){
    showInfo('هذه نفس الصورة — لا يوجد تغيير');
    ctx.dom.pendingPhoto = null;
    ctx.syncPhotoUI?.();
    return false;
  }

  if (kind === 'same-original'){
    document.activeElement?.blur();

 const res = await showConfirmModal({
  title: 'استعادة الأصل',
  message: 'هذه هي الصورة الأصلية. هل تريد استعادتها؟',
  confirmText: 'استعادة',
  cancelText: 'إلغاء',
  _ariaRole: 'alertdialog'
});


    if (res === 'confirm'){
      const pid = ctx?.dom?.currentPerson?._id;
      if (!pid) return false;
      await restoreOriginalIfAny(ctx, byId('bioPhoto'), pid);
    }
    return false;
  }

// صورة مختلفة تمامًا ⇒ نعتبرها "صورة جديدة" ونصفّر أعلام التعديلات + الأصل القديم
if (photoBox){
  delete photoBox.dataset.rotated;
  delete photoBox.dataset.cropped;

  // NEW: clear extra transform flags
  delete photoBox.dataset.fitted;
  delete photoBox.dataset.flipX;
  delete photoBox.dataset.flipY;
  delete photoBox.dataset.rotateDeg;
}


  const pid = ctx?.dom?.currentPerson?._id;
  if (pid){
    const famKey = Model.getSelectedKey();
    const fam    = Model.getFamilies()[famKey];
    const path   = findPathByIdInFamily(fam, pid);

const clearFlags = (p)=>{
  if (p && p._id === pid && p.bio){
    delete p.bio.photoHasOrig;
    delete p.bio.photoCropped;
    delete p.bio.photoRotated;

    // NEW: clear extra transform flags
    delete p.bio.photoFitted;
    delete p.bio.photoFlipX;
    delete p.bio.photoFlipY;
    delete p.bio.photoRotateDeg;
  }
};


    const tops = [
      ...(Array.isArray(fam.ancestors)?fam.ancestors:[]),
      fam.father, fam.rootPerson, ...(fam.wives||[])
    ].filter(Boolean);

    tops.forEach(p=>{ clearFlags(p); (p?.children||[]).forEach(clearFlags); (p?.wives||[]).forEach(clearFlags); });
    (fam.rootPerson?.wives||[]).forEach(w=>{ clearFlags(w); (w?.children||[]).forEach(clearFlags); });

 if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid && ctx.dom.currentPerson.bio){
  delete ctx.dom.currentPerson.bio.photoHasOrig;
  delete ctx.dom.currentPerson.bio.photoCropped;
  delete ctx.dom.currentPerson.bio.photoRotated;

  // NEW: clear extra transform flags
  delete ctx.dom.currentPerson.bio.photoFitted;
  delete ctx.dom.currentPerson.bio.photoFlipX;
  delete ctx.dom.currentPerson.bio.photoFlipY;
  delete ctx.dom.currentPerson.bio.photoRotateDeg;
}


    Model.commitFamily(famKey);

    // حذف نسخ الأصل من الـ DB (غير متزامن لتخفيف التأخير)
    (async () => {
      try{
        await ctx.DB.clearPhoto(pid + '_orig');
        if (path) await ctx.DB.clearPhoto(`orig:${famKey}:${path}`);
        await ctx.DB.clearPhoto(pid + '_cropBase');
      }catch{}
    })();
  }

  ctx.dom.pendingPhoto = dataUrl;
  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, dataUrl, ctx.DB);
pushHistorySnapshot(ctx, { pending: dataUrl, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });

  ctx.syncPhotoUI?.();
  showInfo('لم يتم الحفظ بعد. اضغط "حفظ" لتثبيت الصورة.');
  return true;
}

/* =========================================================
 * photoTools: State Machine موحّد (حل مشكلة الظهور/الإخفاء)
 * ========================================================= */

let _uiTick = 0;

/** يحسب حالة أدوات الصورة (موحّد) */
async function getPhotoUIState(ctx, photoBox){
  const person    = ctx?.dom?.currentPerson;
  const hasPerson = !!person;
  const hasImg    = !!photoBox?.querySelector('img');

  const hasPending = !!ctx?.dom?.pendingPhoto;

  const rotatedNow = photoBox?.dataset?.rotated === '1';
  const croppedNow = photoBox?.dataset?.cropped === '1';
  const fittedNow  = photoBox?.dataset?.fitted  === '1';

  const flipXNow   = photoBox?.dataset?.flipX   === '1';
  const flipYNow   = photoBox?.dataset?.flipY   === '1';

  const rotateDeg  = Number(photoBox?.dataset?.rotateDeg || 0) || 0;

  const busy       = !!ctx?.dom?.photoBusy;

  // Undo/Redo
  ensureHistory(ctx);
  const histLen = ctx.dom.photoHistory.length;
  const histIdx = ctx.dom.photoHistoryIndex;

  const canUndo = histLen > 0 && histIdx > 0;
  const canRedo = histLen > 0 && histIdx < histLen - 1;

  // زر "استعادة الأصل" يعتمد على وجود Blob فعلي + اختلاف عن الأصل
  let hasOrigBlob = false;
  let sameAsOrig  = true;

  try{
    const origBlob = await getOriginalBlob(ctx);
    hasOrigBlob = origBlob instanceof Blob;

    if (hasOrigBlob){
      const u = trackObjectURL(URL.createObjectURL(origBlob));
      try{
        const origHash = await aHashFromSrc(u).catch(()=> '');
        const curHash  = await currentPhotoHash(ctx).catch(()=> '');
        sameAsOrig = !!(curHash && origHash && hamming(curHash, origHash) <= A_HASH_THRESHOLD);
      } finally {
        revokeTrackedObjectURL(u);
      }
    }
  } catch {
    hasOrigBlob = false;
    sameAsOrig  = true;
  }

  return {
    hasPerson,
    hasImg,

    busy,
    hasPending,

    rotatedNow,
    croppedNow,
    fittedNow,

    flipXNow,
    flipYNow,
    rotateDeg,

    // أدوات تظهر منطقيًا
    showTools: hasPerson && hasImg,

    showUndo: hasPerson && hasImg && canUndo,
    showRedo: hasPerson && hasImg && canRedo,

    showCompare: hasPerson && hasImg && hasPending,

    showUndoRotate: hasPerson && hasImg && rotatedNow,
    showRotate:     hasPerson && hasImg && !rotatedNow,

    showUndoCrop:   hasPerson && hasImg && croppedNow,
    showCrop:       hasPerson && hasImg && !croppedNow,

    showRestoreOrig: hasPerson && hasImg && hasOrigBlob && !sameAsOrig,
    disableRestoreOrig: hasPending || busy,

    // flip toggles تظهر دائمًا عند وجود صورة
    showFlipX: hasPerson && hasImg,
    showFlipY: hasPerson && hasImg,

    // slider يظهر دائمًا عند وجود صورة
    showRotateSlider: hasPerson && hasImg,

    // تحريك/تكبير
    showFitEditor: hasPerson && hasImg,

    // تعطيل عام أثناء busy
    disableAll: busy
  };
}


async function transformToDataURL(dataUrlOrSrc, opts = {}){
  const { deg = 0, flipX = false, flipY = false, square = true } = opts;

const safe = await ensureCanvasSafeBlobURL(dataUrlOrSrc, { signal: _uiFetchCtrl?.signal });
  const src  = safe.url || dataUrlOrSrc;

  try{
    return await new Promise((resolve, reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        const s = square ? Math.min(w, h) : Math.max(w, h);
        const sx = (w - s)/2, sy = (h - s)/2;

        const out = document.createElement('canvas');
        out.width = s; out.height = s;

        const ctx2d = out.getContext('2d', { alpha:false });

        ctx2d.translate(s/2, s/2);

        // rotate
        const rad = ((deg % 360) * Math.PI) / 180;
        ctx2d.rotate(rad);

        // flip
        ctx2d.scale(flipX ? -1 : 1, flipY ? -1 : 1);

        ctx2d.translate(-s/2, -s/2);
        ctx2d.drawImage(img, sx, sy, s, s, 0, 0, s, s);

        try{ resolve(out.toDataURL('image/jpeg', JPEG_Q)); }
        catch(e){ reject(e); }
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
      img.src = src;
    });
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')) revokeTrackedObjectURL(safe.url);
  }
}

async function openFitEditorFor(photoBox){
  byId('cropperLayer')?.remove();
  const img = photoBox.querySelector('img');
  if (!img) return;

  const layer = document.createElement('div');
  layer.id = 'cropperLayer';
  layer.className = 'photo-modal-layer';

  layer.innerHTML = `
    <div class="photo-modal-card">
      <div class="photo-modal-actions">
        <button id="fitCancel" class="btn tiny">إلغاء</button>
        <button id="fitReset"  class="btn tiny">إعادة الضبط</button>
        <button id="fitDone"   class="btn tiny primary">اعتماد التمركز</button>
      </div>
      <div class="photo-modal-body">
        <img id="fitImg" alt="" class="photo-modal-img">
      </div>
    </div>
  `;
  document.body.appendChild(layer);

  const editorImg = layer.querySelector('#fitImg');
  const safe = await ensureCanvasSafeBlobURL(img.src, { signal: _uiFetchCtrl?.signal });
  editorImg.crossOrigin = 'anonymous';
  editorImg.src = safe.url || img.src;

  const cropper = new window.Cropper(editorImg, {
    viewMode: 1,
    aspectRatio: 1,
    autoCropArea: 1,
    dragMode: 'move',
    movable: true,
    zoomable: true,
    rotatable: false,
    scalable: false,
    background: false
  });

  const cleanup = () => {
    try{ cropper?.destroy?.(); }catch{}
    if (safe.created && safe.url?.startsWith('blob:')) revokeTrackedObjectURL(safe.url);
    layer.remove();
  };

  layer.querySelector('#fitCancel').onclick = cleanup;

  layer.querySelector('#fitReset').onclick = () => {
    try{
      cropper.reset();
      cropper.setCropBoxData(cropper.getCropBoxData());
    }catch{}
  };

  layer.querySelector('#fitDone').onclick = async () => {
    const ctx = window.__photoCtx;
    const photoBox2 = byId('bioPhoto');

    setPhotoBusy(ctx, true);
    try{
      await ensureOriginalSnapshotOnce(ctx);

      const c = cropper.getCroppedCanvas({ imageSmoothingEnabled: true });

      const maxDim = 512;
      const scale  = Math.min(1, maxDim / Math.max(c.width, c.height));
      const dst    = document.createElement('canvas');
      dst.width    = Math.max(1, Math.round(c.width  * scale));
      dst.height   = Math.max(1, Math.round(c.height * scale));

      await window.pica().resize(c, dst);

      const preBlob = await new Promise(res => dst.toBlob(res, 'image/jpeg', 0.92));
      const compressed = await new Promise((resolve, reject) =>
        new window.Compressor(preBlob, { quality: JPEG_Q, success: resolve, error: reject })
      );

      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('فشل التحويل'));
        fr.readAsDataURL(compressed);
      });

      if (await acceptOrRejectSame(ctx, dataUrl, photoBox2)){
        photoBox2.dataset.fitted = '1';
        ctx.syncPhotoUI?.();
        showInfo('تم ضبط التمركز/التكبير — لم يُحفظ بعد.');
      }
    } catch {
      showError('تعذّر تنفيذ التحريك/التكبير.');
    } finally {
      setPhotoBusy(ctx, false);
      cleanup();
    }
  };
}

/** ينشئ الأدوات مرة واحدة ويربط الأحداث (بدون منطق show/hide هنا) */
function ensurePhotoToolsDOM(ctx, photoBox){
  let tools = byId('photoTools');
  if (tools) return tools;

  tools = document.createElement('div');
  tools.id = 'photoTools';
tools.className = 'photo-tools';
tools.innerHTML = `
  <!-- History -->
  <button type="button" id="undoPhoto"   class="btn tiny" hidden>تراجع</button>
  <button type="button" id="redoPhoto"   class="btn tiny" hidden>إعادة</button>

  <!-- Reset -->
  <button type="button" id="resetTransforms" class="btn tiny" title="إعادة ضبط التعديلات">إعادة الضبط</button>

  <!-- Compare (only when pending) -->
  <button type="button" id="compareHold" class="btn tiny" hidden>قبل/بعد</button>

  <!-- Layout / Crop / Fit -->
  <button type="button" id="fitEditor"   class="btn tiny">تحريك/تكبير</button>

  <button type="button" id="cropSquare"  class="btn tiny">ملاءمة الصورة للإطار</button>
  <button type="button" id="undoCrop"    class="btn tiny" hidden>إلغاء الملاءمة</button>

  <!-- Rotate -->
  <button type="button" id="rotateLeft"  class="btn tiny">تدوير 90°</button>
  <button type="button" id="undoRotate"  class="btn tiny" hidden>إلغاء التدوير</button>

  <div id="freeRotateWrap" class="btn tiny free-rotate-wrap">
    <span class="free-rotate-label">تدوير:</span>
    <button type="button" id="freeRotateMinus" class="btn tiny" title="نقص درجة" aria-label="نقص درجة">−</button>
    <input id="freeRotate" type="range" min="0" max="360" step="1" value="0" class="free-rotate-range">
    <span id="freeRotateVal" class="free-rotate-val">0°</span>
    <button type="button" id="freeRotatePlus" class="btn tiny" title="زد درجة" aria-label="زد درجة">+</button>
  </div>

  <!-- Flip -->
  <button type="button" id="flipX" class="btn tiny">قلب أفقي</button>
  <button type="button" id="flipY" class="btn tiny">قلب عمودي</button>

  <!-- Restore original (last + danger) -->
  <button type="button" id="restoreOrig" class="btn tiny danger" hidden>استعادة الأصل</button>
`;


  (byId('bioTools') || photoBox.parentNode)?.appendChild(tools);

  // Undo/Redo (history)
  byId('undoPhoto').onclick = async () => {
    const pb = byId('bioPhoto'); if (!pb) return;
    await applyHistoryIndex(ctx, pb, (ctx.dom.photoHistoryIndex || 0) - 1);
  };
  byId('redoPhoto').onclick = async () => {
    const pb = byId('bioPhoto'); if (!pb) return;
    await applyHistoryIndex(ctx, pb, (ctx.dom.photoHistoryIndex || 0) + 1);
  };

// قبل/بعد: ضغط مستمر (بدون window listeners لتفادي التراكم)
{
  const btn = byId('compareHold');
  let savedSrc = '';
  let pendingSrc = '';
  let swapped = false;

  const swapToSaved = async () => {
    if (swapped) return;
    if (!ctx.dom.pendingPhoto) return;

    const imgEl = photoBox.querySelector('img');
    if (!imgEl) return;

    pendingSrc = imgEl.src || ctx.dom.pendingPhoto;

    // لا تعيد توليد blob URL لو سبق وولدته في نفس الضغطة
    if (!savedSrc){
      savedSrc = await resolvePersonPhotoSrc(ctx.dom.currentPerson, ctx.DB);
    }
    if (!savedSrc) return;

    imgEl.src = savedSrc;
    swapped = true;
  };

  const swapBack = async () => {
    if (!swapped) return;

    const imgEl = photoBox.querySelector('img');
    if (!imgEl) return;

    imgEl.src = ctx.dom.pendingPhoto || pendingSrc;
    swapped = false;

    // NEW: revoke blob URL الناتج من resolvePersonPhotoSrc حتى لا يتراكم
    if (savedSrc?.startsWith('blob:')) revokeTrackedObjectURL(savedSrc);
    savedSrc = '';
  };


  btn?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch {}
    swapToSaved();
  });

  btn?.addEventListener('pointerup', (e) => {
    e.preventDefault();
    swapBack();
  });

  btn?.addEventListener('pointercancel', (e) => {
    e.preventDefault();
    swapBack();
  });

  btn?.addEventListener('pointerleave', () => {
    // احتياط: لو خرج المؤشر من الزر
    swapBack();
  });
}

  // تحريك/تكبير (Editor خفيف)
  byId('fitEditor').onclick = async () => {
    if (ctx.dom.photoBusy) return;
    await openFitEditorFor(photoBox);
  };

  // Flip X/Y (toggle)
  byId('flipX').onclick = async () => {
    const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    try{
      await ensureOriginalSnapshotOnce(ctx);

      const flipXNow = photoBox.dataset.flipX === '1';
      const flipYNow = photoBox.dataset.flipY === '1';
      const deg = Number(photoBox.dataset.rotateDeg || 0) || 0;

      const d = await transformToDataURL(imgEl.src, { deg, flipX: !flipXNow, flipY: flipYNow, square:true });
      const changed = await acceptOrRejectSame(ctx, d, photoBox);
      if (changed){
        if (!flipXNow) photoBox.dataset.flipX = '1'; else delete photoBox.dataset.flipX;
        showInfo('تم القلب الأفقي — لم يُحفظ بعد.');
        ctx.syncPhotoUI?.();
      }
    } catch {
      showError('تعذّر تنفيذ القلب.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  byId('flipY').onclick = async () => {
    const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    try{
      await ensureOriginalSnapshotOnce(ctx);

      const flipXNow = photoBox.dataset.flipX === '1';
      const flipYNow = photoBox.dataset.flipY === '1';
      const deg = Number(photoBox.dataset.rotateDeg || 0) || 0;

      const d = await transformToDataURL(imgEl.src, { deg, flipX: flipXNow, flipY: !flipYNow, square:true });
      const changed = await acceptOrRejectSame(ctx, d, photoBox);
      if (changed){
        if (!flipYNow) photoBox.dataset.flipY = '1'; else delete photoBox.dataset.flipY;
        showInfo('تم القلب العمودي — لم يُحفظ بعد.');
        ctx.syncPhotoUI?.();
      }
    } catch {
      showError('تعذّر تنفيذ القلب.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  // تدوير حر Slider (debounce بسيط)
  {
    const range = byId('freeRotate');
    const out   = byId('freeRotateVal');
    let t = null;

    const applyDeg = async (deg) => {
      const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
      if (ctx.dom.photoBusy) return;

      setPhotoBusy(ctx, true);
      try{
        await ensureOriginalSnapshotOnce(ctx);

        const flipXNow = photoBox.dataset.flipX === '1';
        const flipYNow = photoBox.dataset.flipY === '1';

     const d = await transformToDataURL(imgEl.src, { deg, flipX: flipXNow, flipY: flipYNow, square:true });

// لا تعتمد على aHash في التدوير الحر — اعتبره دائمًا تعديل
ctx.dom.pendingPhoto = d;
await renderPersonPhoto(photoBox, ctx.dom.currentPerson, d, ctx.DB);

if (deg) photoBox.dataset.rotateDeg = String(deg);
else delete photoBox.dataset.rotateDeg;

// history snapshot (pending + flags الحالية)
pushHistorySnapshot(ctx, { pending: d, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });

showInfo('تم تدوير الصورة — لم تُحفظ بعد.');
ctx.syncPhotoUI?.();

      } catch {
        showError('تعذّر تنفيذ التدوير.');
      } finally {
        setPhotoBusy(ctx, false);
      }
    };

    range?.addEventListener('input', (e)=>{
      const v = Number(e.target.value || 0) || 0;
      if (out) out.textContent = `${v}°`;

      clearTimeout(t);
      t = setTimeout(()=> applyDeg(v), 220);
    });
    
      const minusBtn = byId('freeRotateMinus');
  const plusBtn  = byId('freeRotatePlus');

  const nudge = (delta) => {
    if (!range) return;

    const min = Number(range.min || 0) || 0;
    const max = Number(range.max || 360) || 360;
    const step = Number(range.step || 1) || 1;

    const cur = Number(range.value || 0) || 0;
    let next = cur + (delta * step);

    if (next < min) next = min;
    if (next > max) next = max;

    range.value = String(next);

    // نخلي نفس منطق input يشتغل (يعرض القيمة + debounce + applyDeg)
    range.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // مهم: لا نخلي الضغط على الزر يفعّل label/يسحب الـ range
  minusBtn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); nudge(-1); });
  plusBtn?.addEventListener('click',  (e) => { e.preventDefault(); e.stopPropagation(); nudge( 1); });

  }

  // إعادة ضبط التعديلات (flags + رجوع للصورة المخزّنة)
  byId('resetTransforms').onclick = async () => {
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    try{
      ctx.dom.pendingPhoto = null;
      delete photoBox.dataset.rotated;
      delete photoBox.dataset.cropped;
      delete photoBox.dataset.fitted;
      delete photoBox.dataset.flipX;
      delete photoBox.dataset.flipY;
      delete photoBox.dataset.rotateDeg;

      // إعادة slider
      const range = byId('freeRotate');
      const out   = byId('freeRotateVal');
      if (range){ range.value = '0'; }
      if (out){ out.textContent = '0°'; }

      await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);

      // history snapshot (عودة للحالة المخزّنة)
      pushHistorySnapshot(ctx, { pending: null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });

      ctx.syncPhotoUI?.();
      showInfo('تمت إعادة الضبط.');
    } catch {
      showError('تعذّر إعادة الضبط.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  // تدوير 90° (كما كان)
  byId('rotateLeft').onclick = async () => {
    const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
    const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    await ensureOriginalSnapshotOnce(ctx);
    try{
      const d = await rotateAndCenterCrop(imgEl.src, 90, false);
      const changed = await acceptOrRejectSame(ctx, d, photoBox);
      if (changed){
        photoBox.dataset.rotated = '1';
        ctx.syncPhotoUI?.();
        showInfo('تم تدوير الصورة — لم تُحفظ بعد.');
      }
    }catch{
      showError('تعذّر تنفيذ التدوير.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  byId('undoRotate').onclick = async () => {
    const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
    const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;
    if (ctx.dom.photoBusy) return;

    const wasSavedRot = !!ctx.dom?.currentPerson?.bio?.photoRotated;

    setPhotoBusy(ctx, true);
    try{
      if (!wasSavedRot){
        ctx.dom.pendingPhoto = null;
        delete photoBox.dataset.rotated;
        await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);
        pushHistorySnapshot(ctx, { pending:null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });
        ctx.syncPhotoUI?.();
        showInfo('تم إلغاء التدوير.');
        return;
      }

      const d = await rotateAndCenterCrop(imgEl.src, -90, false);
      const changed = await acceptOrRejectSame(ctx, d, photoBox);
      if (changed){
        delete photoBox.dataset.rotated;
        ctx.syncPhotoUI?.();
        showInfo('تم إلغاء التدوير — لم يُحفظ بعد.');
      }
    } catch {
      showError('تعذّر إلغاء التدوير.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  // قص
byId('cropSquare').onclick = async () => {
  const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
  const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;
  if (ctx.dom.photoBusy) return;

  setPhotoBusy(ctx, true);
  try{
    await saveCropBaseline(ctx, pid, imgEl);
    await openCropperFor(photoBox);
  } finally {
    setPhotoBusy(ctx, false);
  }
};


  byId('undoCrop').onclick = async () => {
    const pid = ctx.dom?.currentPerson?._id; if (!pid) return;
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    try{
      await restoreCropBaselineIfAny(ctx, photoBox, pid);
      delete photoBox.dataset.cropped;
      pushHistorySnapshot(ctx, { pending:null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });
      ctx.syncPhotoUI?.();
      showSuccess('تم إلغاء الملاءمة.');
    }catch{
      showError('تعذّر الاستعادة.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  // استعادة الأصل
  byId('restoreOrig').onclick = async () => {
    const pid = ctx.dom?.currentPerson?._id; if (!pid) return;
    if (ctx.dom.photoBusy) return;

    setPhotoBusy(ctx, true);
    try{
      await restoreOriginalIfAny(ctx, photoBox, pid);
      pushHistorySnapshot(ctx, { pending:null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });
      showSuccess('تمت استعادة الصورة الأصلية.');
    } finally {
      setPhotoBusy(ctx, false);
    }
  };

  return tools;
}


/** يطبّق حالة الأدوات على DOM */
function applyPhotoUIState(state, photoBox){
  let tools = byId('photoTools');

  if (!state.showTools){
    tools?.remove();
    return;
  }

  tools = ensurePhotoToolsDOM(window.__photoCtx, photoBox);
// مزامنة السلايدر بعد ضمان وجوده في DOM
{
  const range = byId('freeRotate');
  const out   = byId('freeRotateVal');

  const deg = Number(photoBox?.dataset?.rotateDeg || 0) || 0;

  if (range) range.value = String(deg);
  if (out)   out.textContent = `${deg}°`;
}

  const undoBtn     = byId('undoPhoto');
  const redoBtn     = byId('redoPhoto');
  const compareBtn  = byId('compareHold');

  const fitBtn      = byId('fitEditor');

  const flipXBtn    = byId('flipX');
  const flipYBtn    = byId('flipY');
  const rotWrap     = byId('freeRotateWrap');

  const rotBtn      = byId('rotateLeft');
  const uRotBtn     = byId('undoRotate');
  const crpBtn      = byId('cropSquare');
  const uCrpBtn     = byId('undoCrop');
  const restoreBtn  = byId('restoreOrig');

  // Undo/Redo
  if (undoBtn){
    if (state.showUndo) undoBtn.removeAttribute('hidden'); else undoBtn.setAttribute('hidden','');
  }
  if (redoBtn){
    if (state.showRedo) redoBtn.removeAttribute('hidden'); else redoBtn.setAttribute('hidden','');
  }

  // قبل/بعد
  if (compareBtn){
    if (state.showCompare) compareBtn.removeAttribute('hidden'); else compareBtn.setAttribute('hidden','');
  }

  // fit editor
  if (fitBtn){
    if (state.showFitEditor) fitBtn.removeAttribute('hidden'); else fitBtn.setAttribute('hidden','');
  }

  // flip buttons
  if (flipXBtn){
    if (state.showFlipX) flipXBtn.removeAttribute('hidden'); else flipXBtn.setAttribute('hidden','');
    // تمييز بصري بسيط (اختياري)
    if (state.flipXNow) flipXBtn.classList.add('changed'); else flipXBtn.classList.remove('changed');
  }
  if (flipYBtn){
    if (state.showFlipY) flipYBtn.removeAttribute('hidden'); else flipYBtn.setAttribute('hidden','');
    if (state.flipYNow) flipYBtn.classList.add('changed'); else flipYBtn.classList.remove('changed');
  }

  // rotate slider wrap
if (rotWrap){
  if (state.showRotateSlider) rotWrap.removeAttribute('hidden');
  else rotWrap.setAttribute('hidden','');
}

  // rotate toggles 90
  if (state.showUndoRotate){
    rotBtn?.setAttribute('hidden','');
    uRotBtn?.removeAttribute('hidden');
  } else {
    uRotBtn?.setAttribute('hidden','');
    rotBtn?.removeAttribute('hidden');
  }

  // crop toggles
  if (state.showUndoCrop){
    crpBtn?.setAttribute('hidden','');
    uCrpBtn?.removeAttribute('hidden');
  } else {
    uCrpBtn?.setAttribute('hidden','');
    crpBtn?.removeAttribute('hidden');
  }

  // restore orig
  if (restoreBtn){
    if (state.showRestoreOrig) restoreBtn.removeAttribute('hidden');
    else restoreBtn.setAttribute('hidden','');

    if (state.disableRestoreOrig) restoreBtn.setAttribute('disabled','');
    else restoreBtn.removeAttribute('disabled');
  }

  // Disable all during busy
  const allIds = ['undoPhoto', 'redoPhoto', 'compareHold', 'fitEditor', 'flipX', 'flipY', 'freeRotate', 'resetTransforms', 'rotateLeft', 'undoRotate', 'cropSquare', 'undoCrop', 'restoreOrig', 'freeRotateMinus', 'freeRotatePlus'];
  allIds.forEach(id => {
              const el = byId(id);
    if (!el) return;
    if (state.disableAll) el.setAttribute('disabled','');
    else el.removeAttribute('disabled');
  });
}

/** مزامنة واحدة تستدعيها من كل مكان */
async function syncPhotoTools(ctx){
  const photoBox = byId('bioPhoto');
  if (!photoBox) return;

  const myTick = ++_uiTick;
  const state  = await getPhotoUIState(ctx, photoBox);

  // منع نتيجة متأخرة من قلب UI بعد تحديث أحدث
  if (myTick !== _uiTick) return;

  applyPhotoUIState(state, photoBox);
}

/* =========================================================
 * init — ربط كل شيء
 * ========================================================= */

export function init(ctx){
  // سياق عام لأداة القص + photoTools
  window.__photoCtx = ctx;

  function syncPhotoUI(){
    updatePhotoControls(ctx.dom);
    syncPhotoTools(ctx);
  }
  ctx.syncPhotoUI = syncPhotoUI;

  /* عند فتح تفاصيل الشخص */
  ctx.bus.on('person:open', async ({ person }) => {
    ctx.dom.pendingPhoto = null;
    ctx.dom.currentPerson = person;
ctx.dom.pendingFullBlob = null;
abortOngoingFetch();
_uiFetchCtrl = new AbortController(); // signal لمسارات UI أثناء بقاء الشخص مفتوح

ensureHistory(ctx);
ctx.dom.photoHistory = [];
ctx.dom.photoHistoryIndex = -1;
ctx.dom.photoBusy = false;

    const photoBox = byId('bioPhoto');
    if (!photoBox) return;

    // سحب وإفلات صورة
    if (!photoBox.__dnd){
      photoBox.__dnd = true;

      const onOver  = (e)=>{ e.preventDefault(); e.stopPropagation(); photoBox.classList.add('drag'); if (e.dataTransfer) e.dataTransfer.dropEffect='copy'; };
      const onEnter = (e)=>{ e.preventDefault(); e.stopPropagation(); photoBox.classList.add('drag'); };
      const onLeave = (e)=>{ e.preventDefault(); e.stopPropagation(); photoBox.classList.remove('drag'); };
const onDrop  = async (e)=>{
  e.preventDefault();
  e.stopPropagation();
  photoBox.classList.remove('drag');

  const f = e.dataTransfer?.files?.[0];
  if (!f) return;

  // 1) حد الحجم
  if (f.size > MAX_PHOTO_BYTES){
    showError('حجم الصورة كبير. الحد الأقصى 8MB.');
    return;
  }

  // 2) نوع الملف
  if (!/^image\//i.test(f.type)){
    showError('الملف المُسقَط ليس صورة.');
    return;
  }

  // 3) قبل الضغط
  ctx.dom.pendingFullBlob = f;

setPhotoBusy(ctx, true);
try{
  // 4) ضغط للعرض فقط (512px)
  const dataUrl = await compressImageToDataURL(f, 512, JPEG_Q);

  // 5) إدخالها كنص pending
  await handleNewCandidate(ctx, dataUrl, photoBox);
}catch{
  showError('تعذّر معالجة الصورة.');
}finally{
  setPhotoBusy(ctx, false);
}

};


      photoBox.__dndHandlers = { onOver, onEnter, onLeave, onDrop };
      photoBox.addEventListener('dragover',  onOver);
      photoBox.addEventListener('dragenter', onEnter);
      photoBox.addEventListener('dragleave', onLeave);
      photoBox.addEventListener('drop',      onDrop);
    }

    await renderPersonPhoto(photoBox, person, undefined, ctx.DB);
// ===== معاينة الصورة عند النقر (bioPhoto) =====
if (!photoBox.__viewerBound){
  photoBox.__viewerBound = true;

// Viewer API singleton (يتشارك overlay نفسه)
const viewer = createImageViewerOverlay({
  overlayClass: 'bio-image-viewer-overlay',
  backdropClass: 'bio-image-viewer-backdrop',
  dialogClass: 'bio-image-viewer-dialog',
  imgClass: 'bio-image-viewer-img',
  closeBtnClass: 'bio-image-viewer-close',
  navClass: 'bio-image-viewer-nav',
  saveBtnClass: 'bio-image-viewer-save image-viewer-save',
  minimalNav: true
});


  photoBox.addEventListener('click', async (e) => {
    const imgEl = e.target && e.target.closest && e.target.closest('#bioPhoto img');
    if (!imgEl) return;
 //  منع المعاينة أثناء المعالجة
  if (ctx?.dom?.photoBusy) return;
    // لا تفتح المعاينة إذا لا توجد صورة فعلية
    const srcNow = imgEl.currentSrc || imgEl.src || '';
    if (!srcNow) return;

    // لو عندنا نسخة كاملة محفوظة pid_full نفضّل عرضها
    const pid = ctx?.dom?.currentPerson?._id;
    if (pid){
      try{
        const fullBlob = await ctx.DB.getPhoto(pid + '_full');
        if (fullBlob instanceof Blob){
          const fullUrl = trackObjectURL(URL.createObjectURL(fullBlob));
          viewer.open([fullUrl], 0);

          // مهم: لما يقفل المستخدم المعاينة ما عندنا hook مباشر للإغلاق هنا،
          // لكننا على الأقل نتركه ضمن tracked urls ويتنظف في person:close عبر revokeAllTrackedObjectURLs().
          return;
        }
      }catch{}
    }

    // fallback: اعرض المصدر الحالي (data/blob/http)
    viewer.open([srcNow], 0);
  }, true);
}

    // رفع حالتي القص/التدوير من الموديل إلى DOM
    if (person?.bio?.photoRotated) photoBox.dataset.rotated = '1'; else delete photoBox.dataset.rotated;
    if (person?.bio?.photoCropped) photoBox.dataset.cropped = '1'; else delete photoBox.dataset.cropped;
if (person?.bio?.photoFlipX) photoBox.dataset.flipX = '1'; else delete photoBox.dataset.flipX;
if (person?.bio?.photoFlipY) photoBox.dataset.flipY = '1'; else delete photoBox.dataset.flipY;

const deg = Number(person?.bio?.photoRotateDeg || 0) || 0;
if (deg) photoBox.dataset.rotateDeg = String(deg); else delete photoBox.dataset.rotateDeg;

if (person?.bio?.photoFitted) photoBox.dataset.fitted = '1'; else delete photoBox.dataset.fitted;

// مزامنة slider
const range = byId('freeRotate');
const out   = byId('freeRotateVal');
if (range) range.value = String(deg || 0);
if (out) out.textContent = `${deg || 0}°`;

// snapshot أولي للحالة المخزنة
pushHistorySnapshot(ctx, { pending: null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });

    // تزامن واحد فقط
    syncPhotoUI();
  });

  /* تنظيف عند الإغلاق */
  ctx.bus.on('person:close', () => {
    ctx.dom.pendingPhoto = null;

    const pid = ctx.dom.currentPerson?._id;
    if (pid){ try { ctx.DB.clearPhoto(pid + '_cropBase'); } catch {} }

    const saveBtn   = byId('savePhotoBtn');
    const removeBtn = byId('removePhotoBtn');
    const changeBtn = byId('changePhotoBtn');
    saveBtn?.setAttribute('hidden','');
    removeBtn?.setAttribute('hidden','');
    if (changeBtn) changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> إختيار صورة`;

    abortOngoingFetch();

    const photoBox = byId('bioPhoto');
    if (!photoBox) return;

const img = photoBox.querySelector('img[data-blob-url]');
if (img?.dataset.blobUrl){
  revokeTrackedObjectURL(img.dataset.blobUrl);
  delete img.dataset.blobUrl; // أو img.removeAttribute('data-blob-url') إذا تفضل
}

    if (photoBox.__dndHandlers){
      const { onOver, onEnter, onLeave, onDrop } = photoBox.__dndHandlers;
      photoBox.removeEventListener('dragover',  onOver);
      photoBox.removeEventListener('dragenter', onEnter);
      photoBox.removeEventListener('dragleave', onLeave);
      photoBox.removeEventListener('drop',      onDrop);
      delete photoBox.__dndHandlers;
      delete photoBox.__dnd;
    }

    byId('photoTools')?.remove();
    byId('cropperLayer')?.remove();
    revokeAllTrackedObjectURLs();
ctx.dom.pendingFullBlob = null;
ctx.dom.photoHistory = [];
ctx.dom.photoHistoryIndex = -1;
ctx.dom.photoBusy = false;

  });

  /* اختيار/حفظ (زر واحد + قائمة خيارات) */
  const changePhotoBtn   = byId('changePhotoBtn');
  const changePhotoInput = byId('changePhotoInput');
  const savePhotoBtn     = byId('savePhotoBtn');

  changePhotoInput?.setAttribute('accept','image/*');

  // عناصر القائمة
  const photoMenu      = byId('photoMenu');
  const menuUploadBtn  = byId('photoMenuUpload');
  const menuGalleryBtn = byId('photoMenuGallery');

  const hidePhotoMenu = () => { if (photoMenu) photoMenu.setAttribute('hidden',''); };
  const togglePhotoMenu = () => {
    if (!photoMenu) return;
    if (photoMenu.hasAttribute('hidden')) photoMenu.removeAttribute('hidden');
    else photoMenu.setAttribute('hidden','');
  };

  // إغلاق القائمة عند الضغط خارجها
  document.addEventListener('click', (e) => {
    if (!photoMenu || photoMenu.hasAttribute('hidden')) return;
    const insideMenu = photoMenu.contains(e.target);
    const insideBtn  = changePhotoBtn?.contains(e.target);
    if (!insideMenu && !insideBtn) hidePhotoMenu();
  });

  // خيار "من الجهاز"
  menuUploadBtn?.addEventListener('click', () => {
    hidePhotoMenu();
    changePhotoInput?.click();
  });

  async function classifyCandidateFromRawSrc(ctx, src){
  const hasOrig = !!ctx?.dom?.currentPerson?.bio?.photoHasOrig;

  const [nh, ch, ohRaw] = await Promise.all([
    aHashFromSrc(src).catch(()=> ''),
    currentPhotoHash(ctx).catch(()=> ''),
    (hasOrig ? originalPhotoHash(ctx) : Promise.resolve('')).catch(()=> '')
  ]);

  const oh = hasOrig ? ohRaw : '';
  const near = (a,b)=> (a && b && hamming(a,b) <= A_HASH_THRESHOLD);

  if (near(nh, ch)) return 'same-current';
  if (near(nh, oh)) return 'same-original';
  return 'different';
}

  // خيار "من المعرض" (مع ضغط بنفس معيار النظام)
  menuGalleryBtn?.addEventListener('click', async () => {
    hidePhotoMenu();
    const photoBox = byId('bioPhoto');
    if (!photoBox) return;

    openPhotoGallery({
      currentSrc: '',
async onSelect(src){
  setPhotoBusy(ctx, true);
  try{
    // (14) كشف التكرار قبل التحميل
    const kind = await classifyCandidateFromRawSrc(ctx, src);
    if (kind === 'same-current'){
      showInfo('هذه نفس الصورة الحالية — لا يوجد تغيير.');
      return;
    }
    if (kind === 'same-original'){
  const res = await showConfirmModal({
  title: 'استعادة الأصل',
  message: 'هذه هي الصورة الأصلية. هل تريد استعادتها؟',
  confirmText: 'استعادة',
  cancelText: 'إلغاء',
  _ariaRole: 'alertdialog'
});

      if (res === 'confirm'){
        const pid = ctx?.dom?.currentPerson?._id;
        if (pid) await restoreOriginalIfAny(ctx, byId('bioPhoto'), pid);
      }
      return;
    }

    const dataUrl = await urlToDataURL(src, { signal: _uiFetchCtrl?.signal });
    const tmpBlob = await (await fetch(dataUrl)).blob();

    // خزّن النسخة الكاملة قبل الضغط (Feature 8)
    ctx.dom.pendingFullBlob = tmpBlob;

    const smallBlob = await compressBlobForPid(tmpBlob);
    const finalDataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('فشل التحويل بعد الضغط.'));
      fr.readAsDataURL(smallBlob);
    });

    await handleNewCandidate(ctx, finalDataUrl, photoBox);
  }catch{
    showError('تعذّر تحميل الصورة الجاهزة.');
  }finally{
    setPhotoBusy(ctx, false);
  }
}

    });
  });

  // زر الصورة الرئيسي:
  // - لو هناك pendingPhoto ⇒ يلغيها
  // - لو لا يوجد ⇒ يفتح/يغلق القائمة
  changePhotoBtn?.addEventListener('click', async (e) => {
    e.preventDefault();

if (ctx.dom.pendingPhoto){
  const target   = ctx.dom.currentPerson;
  const photoBox = byId('bioPhoto');

  // امسح pending
  ctx.dom.pendingPhoto = null;
  ctx.dom.pendingFullBlob = null;

  // ارجع flags من الموديل (بدل ما تترك fitted/flip/rotateDeg معلّقة)
  if (photoBox){
    restoreSavedFlagsToPhotoBox(photoBox, target);
    await renderPersonPhoto(photoBox, target, undefined, ctx.DB);

    // (اختياري) سجّل Snapshot للرجوع
    pushHistorySnapshot(ctx, { pending: null, flags: readFlagsFromPhotoBox(photoBox), at: Date.now() });
  }

  syncPhotoUI();
  hidePhotoMenu();

  showInfo('تم إلغاء التعديل/التحميل والرجوع للحالة المحفوظة.');
  return;
}


    togglePhotoMenu();
  });

  // عند اختيار ملف من الجهاز
changePhotoInput?.addEventListener('change', async (e) => {
  hidePhotoMenu();

  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!/^image\//i.test(file.type)){
    showError('الملف المختار ليس صورة.');
    e.target.value = '';
    return;
  }

  if (file.size > MAX_PHOTO_BYTES){
    showError('حجم الصورة كبير. الحد الأقصى 8MB.');
    e.target.value = '';
    return;
  }

  ctx.dom.pendingFullBlob = file; // النسخة الأصلية كاملة الجودة

await withPhotoBusy(ctx, async () => {
  await setBusyMsg(ctx, 'جارٍ قراءة الملف…',  'يتم تحضير البيانات');
  await setBusyMsg(ctx, 'جارٍ ضغط الصورة…',  'يتم تجهيز نسخة مناسبة للعرض');

  const dataUrl = await compressImageToDataURL(file, 512, JPEG_Q);

  await setBusyMsg(ctx, 'جارٍ تطبيق الصورة…', 'يتم إدخالها في المعاينة');

  const photoBox = byId('bioPhoto');
  if (photoBox) await handleNewCandidate(ctx, dataUrl, photoBox);
});

  e.target.value = '';
});



  // حفظ + خيار “تراجع” (كما هو)
  savePhotoBtn?.addEventListener('click', async () => {
    if (!ctx.dom.currentPerson || !ctx.dom.pendingPhoto) return;

    try{
      const pid = ctx.dom.currentPerson._id;

      let prevBlob = null;
      try { const b = await ctx.DB.getPhoto(pid); if (b instanceof Blob) prevBlob = b; } catch {}

      await ensureOriginalSnapshotOnce(ctx);
      await persistPhotoForCurrent(ctx.dom, ctx.DB);

      const photoBox$  = byId('bioPhoto');
      const rotatedNow = photoBox$?.dataset.rotated === '1';
      const croppedNow = photoBox$?.dataset.cropped === '1';
const fittedNow  = photoBox$?.dataset.fitted  === '1';
const flipXNow   = photoBox$?.dataset.flipX   === '1';
const flipYNow   = photoBox$?.dataset.flipY   === '1';
const rotateDeg  = Number(photoBox$?.dataset.rotateDeg || 0) || 0;

      const famKeyC = Model.getSelectedKey();
      const famC    = Model.getFamilies()[famKeyC];

const touchFlagsOnSave = (p)=>{
  if (p && p._id === pid){
    p.bio = p.bio || {};

    if (rotatedNow) p.bio.photoRotated = 1; else delete p.bio.photoRotated;
    if (croppedNow) p.bio.photoCropped = 1; else delete p.bio.photoCropped;

    // NEW FLAGS
    if (fittedNow) p.bio.photoFitted = 1; else delete p.bio.photoFitted;
    if (flipXNow)  p.bio.photoFlipX  = 1; else delete p.bio.photoFlipX;
    if (flipYNow)  p.bio.photoFlipY  = 1; else delete p.bio.photoFlipY;
    if (rotateDeg) p.bio.photoRotateDeg = rotateDeg; else delete p.bio.photoRotateDeg;

    p.photoVer = Date.now();
  }
};


      const topsC = [
        ...(Array.isArray(famC.ancestors)?famC.ancestors:[]),
        famC.father, famC.rootPerson, ...(famC.wives||[])
      ].filter(Boolean);

      topsC.forEach(p=>{ touchFlagsOnSave(p); (p?.children||[]).forEach(touchFlagsOnSave); (p?.wives||[]).forEach(touchFlagsOnSave); });
      (famC.rootPerson?.wives||[]).forEach(w=>{ touchFlagsOnSave(w); (w?.children||[]).forEach(touchFlagsOnSave); });

      Model.commitFamily(famKeyC);
      Model.savePersistedFamilies?.();

      if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid){
        ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
        if (rotatedNow) ctx.dom.currentPerson.bio.photoRotated = 1; else delete ctx.dom.currentPerson.bio.photoRotated;
        if (croppedNow) ctx.dom.currentPerson.bio.photoCropped = 1; else delete ctx.dom.currentPerson.bio.photoCropped;
          if (fittedNow) ctx.dom.currentPerson.bio.photoFitted = 1; else delete ctx.dom.currentPerson.bio.photoFitted;
  if (flipXNow)  ctx.dom.currentPerson.bio.photoFlipX  = 1; else delete ctx.dom.currentPerson.bio.photoFlipX;
  if (flipYNow)  ctx.dom.currentPerson.bio.photoFlipY  = 1; else delete ctx.dom.currentPerson.bio.photoFlipY;
  if (rotateDeg) ctx.dom.currentPerson.bio.photoRotateDeg = rotateDeg; else delete ctx.dom.currentPerson.bio.photoRotateDeg;
        ctx.dom.currentPerson.photoVer = Date.now();
      }

      if (ctx.dom.currentPerson){
        ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
        ctx.dom.currentPerson.bio.photoUrl = `idb:${pid}`;
        ctx.dom.currentPerson.photoUrl     = `idb:${pid}`;
        ctx.dom.currentPerson.photoVer     = Date.now();
      }

      ctx.dom.pendingPhoto = null;
ctx.dom.pendingFullBlob = null;

      const photoBox = byId('bioPhoto');
      if (photoBox) await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);

      ctx.syncPhotoUI?.();

      if (typeof ctx.handlers?.onShowDetails === 'function'){
        await ctx.handlers.onShowDetails(pid, { silent: true });
      }
      if (ctx.TreeUI?.refreshAvatarById){
        ctx.TreeUI.refreshAvatarById({ _id: pid, ...ctx.dom.currentPerson });
      }

      showSuccess('تم حفظ الصورة.');

      if (prevBlob){
        document.activeElement?.blur();

        const res = await showConfirmModal({
          title: 'تراجع عن الحفظ',
          message: 'هل تريد التراجع واستعادة الحالة السابقة؟',
          confirmText: 'تراجع',
          cancelText: 'إغلاق'
        });

        if (res === 'confirm'){
          await ctx.DB.putPhoto(pid, prevBlob);
          await renderPersonPhoto(byId('bioPhoto'), ctx.dom.currentPerson, undefined, ctx.DB);
          ctx.syncPhotoUI?.();
          showInfo('تم التراجع عن آخر حفظ.');
        } else {
          ctx.syncPhotoUI?.();
        }
      }
    } catch {
      showError('تعذّر حفظ الصورة.');
    }
  });

  // تفويض حذف الصورة
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('#removePhotoBtn');
    if (btn) handleRemovePhotoClick(e, ctx);
  });

  return { updatePhotoControls };
}

export { updatePhotoControls };
