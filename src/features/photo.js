// features/photo.js — الصور (تدوير/قص + إدارة ذاكرة/إبطال + قنوات Canvas آمنة)
import { byId, showInfo, showError, showSuccess, showWarning, showConfirmModal } from '../utils.js';
import * as Model from '../model/families.js';
const { findPathByIdInFamily } = Model;
import * as TreeUI from '../ui/tree.js';
import { openPhotoGallery, PRESET_PHOTOS } from './photoGallery.js';


const JPEG_Q = 0.72;
// تفسير رسائل putPhoto القادمة من DB
function explainPutPhotoError(err){
  const m = String(err?.message || '');
  if (/blob too large/i.test(m))     return 'حجم الصورة كبير. الحد الأقصى 8MB.';
  if (/unsupported mime/i.test(m))   return 'صيغة الصورة غير مدعومة. الصيغ المسموحة: JPEG / PNG / WebP / GIF / BMP.';
  if (/quota|storage/i.test(m))      return 'مساحة التخزين ممتلئة أو مرفوضة من المتصفح.';
  return null;
}

/* ==== فحص وجود صورة محفوظة للشخص ==== */
function hasSavedPhoto(p){
  const a = (p?.bio?.photoUrl || '').trim();
  const b = (p?.photoUrl || '').trim();
  return !!(a || b);
}

/* ==== إبطال fetch جارٍ ==== */
let _fetchCtrl = null;
function abortOngoingFetch(){
  try { _fetchCtrl?.abort(); } catch {}
  _fetchCtrl = null;
}

/* ==== قنوات آمنة للـ Canvas لتفادي التلوّث ==== */
async function ensureCanvasSafeBlobURL(src){
  if (!src) return { url: src, created: false };
  if (src.startsWith('blob:') || src.startsWith('data:')) return { url: src, created: false };

  // idb:PID → Blob URL
  if (src.startsWith('idb:')){
    try{
      const pid = src.slice(4);
      const blob = await (window.__photoCtx?.DB?.getPhoto?.(pid));
      if (blob instanceof Blob){
        const u = URL.createObjectURL(blob);
        return { url: u, created: true };
      }
    }catch{}
    return { url: '', created: false };
  }

  // http/https/file
  abortOngoingFetch();
  _fetchCtrl = new AbortController();
  const res = await fetch(src, { signal: _fetchCtrl.signal });
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), created: true };
}

/* ==== aHash + Hamming (كشف التطابق تقريبياً) ==== */
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
    const ctx = c.getContext('2d', {alpha:false});
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

    const {data} = ctx.getImageData(0,0,size,size);
    const block = size / blocks;
    const acc = Array.from({length:blocks*blocks}, ()=>0);

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
    if (safe.created && safe.url?.startsWith('blob:')){ try{ URL.revokeObjectURL(safe.url); }catch{} }
  }
}

function hamming(a, b){
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i=0;i<a.length;i++) if (a[i] !== b[i]) d++;
  return d;
}

/* ==== استرجاع مصدر صورة الشخص (مع هجرة PID قديم→جديد) ==== */
async function resolvePersonPhotoSrc(person, DB){
  const pid = person?._id;

  // وجود صورة تحت الـ PID الحالي
  if (pid){
    try{
      const blob = await DB.getPhoto(pid);
      if (blob instanceof Blob) return URL.createObjectURL(blob);
    }catch{}
  }

  // إشارة idb:PID_قديم في الموديل → انسخها للـ PID الحالي ثم عدّل الموديل
  const purl = (person?.bio?.photoUrl || person?.photoUrl || '').trim();
  if (purl && purl.startsWith('idb:')){
    const oldPid = purl.slice(4);
    try{
      const oldBlob = await DB.getPhoto(oldPid);
      if (oldBlob instanceof Blob){
        if (pid && oldPid !== pid){
          await DB.putPhoto(pid, oldBlob);

          const famKey = Model.getSelectedKey();
          const fam    = Model.getFamilies()[famKey];
          const touch  = (p)=>{
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
        return URL.createObjectURL(oldBlob);
      }
    }catch{}
    return '';
  }

  // مسار خارجي عادي
  return purl || '';
}

/* ==== عرض صورة الشخص في الصندوق ==== */
async function renderPersonPhoto(box, person, srcMaybe, DB){
  const old = box.querySelector('img');
  if (old){
    const oldSrc = old.currentSrc || old.src || '';
    if (oldSrc && oldSrc.startsWith('blob:')){ try { URL.revokeObjectURL(oldSrc); } catch {} }
    old.remove();
  }
  while (box.firstChild) box.removeChild(box.firstChild);

  const src = srcMaybe ?? await resolvePersonPhotoSrc(person, DB);
  if (src){
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = String(person?.name || '');

    const final = (src && !src.startsWith('data:') && !src.startsWith('blob:')) ? `${src}${src.includes('?') ? '&' : '?'}v=${Date.now()}`
      : src;

    img.crossOrigin = 'anonymous';
    img.src = final || '';
    if (final && final.startsWith('blob:')) img.dataset.blobUrl = final;
    else img.removeAttribute('data-blob-url');

    box.appendChild(img);
    try{
      if (typeof img.decode === 'function') img.decode().catch(()=>{});
      else if (!img.complete) { img.onload = img.onerror = null; }
    }catch{}
  } else {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = TreeUI.getRoleAvatar(person?.role);
    box.appendChild(av);
  }
}

/* ==== تدوير/قص بالرسم اليدوي (حل احتياطي) ==== */
async function rotateAndCenterCrop(dataUrlOrSrc, deg = 0, square = true){
  const safe = await ensureCanvasSafeBlobURL(dataUrlOrSrc);
  const src  = safe.url || dataUrlOrSrc;
  try{
    return await new Promise((resolve, reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const rad = (deg % 360) * Math.PI / 180;
        const s   = square ? Math.min(img.width, img.height) : Math.max(img.width, img.height);
        const sx  = (img.width - s) / 2, sy = (img.height - s) / 2;

        const c = document.createElement('canvas'); c.width = s; c.height = s;
        const ctx = c.getContext('2d', { alpha:false });

        const t = document.createElement('canvas'); t.width = s; t.height = s;
        const tx = t.getContext('2d', { alpha:false });
        tx.translate(s/2, s/2); tx.rotate(rad); tx.translate(-s/2, -s/2);
        tx.drawImage(img, sx, sy, s, s, 0, 0, s, s);
        ctx.drawImage(t, 0, 0);

        try { resolve(c.toDataURL('image/jpeg', JPEG_Q)); } catch(e){ reject(e); }
      };
      img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
      img.src = src;
    });
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')){ try { URL.revokeObjectURL(safe.url); } catch {} }
  }
}

/* ==== تصغير/قراءة ملف صورة إلى DataURL ==== */
async function compressImageToDataURL(file, maxDim = 512, quality = 0.72){
  const img = new Image();
  const url = URL.createObjectURL(file);
  try{
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('تعذر قراءة الملف.'));
      img.src = url;
    });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h) || 1);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d', { alpha:false }).drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

// ضغط Blob عام لإعادة استخدامه عند الاستعادة/المعرض
async function compressBlobForPid(blob, maxDim = 512, quality = JPEG_Q){
  // نغلف الـ Blob في File لنستفيد من compressImageToDataURL
  const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
  const dataUrl = await compressImageToDataURL(file, maxDim, quality);

  // تحويل DataURL المضغوطة إلى Blob جديد
  const res = await fetch(dataUrl);
  const compressedBlob = await res.blob();
  return compressedBlob;
}

/* ==== قراءة URL إلى DataURL (يشمل idb:) ==== */
async function urlToDataURL(u){
  if (u && u.startsWith('idb:')){
    const pid  = u.slice(4);
    const blob = await window.__photoCtx?.DB?.getPhoto?.(pid);
    if (!(blob instanceof Blob)) throw new Error('لم يتم العثور على الصورة في IndexedDB.');
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('تعذر قراءة البيانات.'));
      fr.readAsDataURL(blob);
    });
  }
  abortOngoingFetch();
  _fetchCtrl = new AbortController();
  const res   = await fetch(u, { signal: _fetchCtrl.signal });
  const blob  = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('تعذر قراءة البيانات.'));
    fr.readAsDataURL(blob);
  });
}

/* ==== تحكم أزرار الصورة (إظهار/إخفاء) ==== */
function updatePhotoControls(dom){
  const removeBtn = byId('removePhotoBtn');
  const changeBtn = byId('changePhotoBtn');
  const saveBtn   = byId('savePhotoBtn');
  const photoBox  = byId('bioPhoto');

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

    if (hasPending) {
      // لو في تدوير أو قص معلّق ⇒ إلغاء التعديل
      if (rotatedNow || croppedNow){
        changeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> إلغاء التعديل`;
      } else {
        // تحميل صورة جديدة بدون تعديل ⇒ إلغاء التحميل
        changeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> إلغاء التحميل`;
      }
    } else if (hasSaved) {
      changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> تغيير الصورة`;
    } else {
      changeBtn.innerHTML = `<i class="fa-solid fa-image"></i> إختيار صورة`;
    }
  }

  // زر الحفظ: "حفظ الصورة" أو "حفظ التعديل" + كلاس changed
  if (saveBtn){
    // حفظ النص الأصلي مرة واحدة فقط لاستخدامه لاحقًا
    if (!saveBtn.dataset.labelOriginal){
      saveBtn.dataset.labelOriginal = saveBtn.textContent.trim() || 'حفظ الصورة';
    }
    const baseLabel = saveBtn.dataset.labelOriginal;

    if (hasPending){
      const rotatedNow = photoBox?.dataset.rotated === '1';
      const croppedNow = photoBox?.dataset.cropped === '1';

      saveBtn.removeAttribute('hidden');

      if (rotatedNow || croppedNow){
        saveBtn.textContent = 'حفظ التعديل';
        saveBtn.classList.add('changed');
      } else {
        saveBtn.textContent = baseLabel; // مثال: "حفظ الصورة"
        saveBtn.classList.add('changed'); // ما دام هناك تعديل غير محفوظ نضع changed
      }
    } else {
      saveBtn.setAttribute('hidden','');
      saveBtn.classList.remove('changed');
      saveBtn.textContent = baseLabel;
    }
  }
}


/* ==== حفظ الصورة الحالية في IndexedDB وتحديث الموديل ==== */
async function persistPhotoForCurrent(dom, DB){
  if (!dom.currentPerson || !dom.pendingPhoto) return;
  if (!dom.currentPerson._id) return;
  const pid = dom.currentPerson._id;

  abortOngoingFetch();
  const res  = await fetch(dom.pendingPhoto);
  const blob = await res.blob();

  // حفظ الصورة مع تفسير أخطاء النوع/الحجم
  try {
    await DB.putPhoto(pid, blob);
  } catch (e){
    const msg = explainPutPhotoError(e);
    if (msg){ showError(msg); }
    else    { showError('تعذّر حفظ الصورة.'); }
    throw e; // أوقف بقية التحديثات
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
  const tops  = [
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


/* ==== حذف الصورة مع تأكيد ==== */
async function handleRemovePhotoClick(e, ctx){
  e.preventDefault();
  const target   = ctx.dom.currentPerson;
  if (!target) return;
  const photoBox = byId('bioPhoto');

  // إلغاء التحميل المؤقت
  if (ctx.dom.pendingPhoto){
    ctx.dom.pendingPhoto = null;
    if (photoBox) await renderPersonPhoto(photoBox, target, undefined, ctx.DB);
    ctx.syncPhotoUI?.();
    showInfo('تم إلغاء الصورة المحمّلة قبل الحفظ.');
    return;
  }

  // تأكيد الحذف
  const ok = await showConfirmModal({
    title: 'تأكيد حذف الصورة',
    message: 'سيتم حذف الصورة والرجوع للصورة الافتراضية. هل أنت متأكد؟',
    confirmText: 'حذف',
    cancelText: 'إلغاء',
    variant: 'danger',
    _ariaRole: 'alertdialog'
  });
  if (!ok) return;

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

/* ==== لقطـة أصلية لمرة واحدة ==== */
/* ==== لقطـة أصلية لمرة واحدة ==== */
async function ensureOriginalSnapshotOnce(ctx){
  const pid = ctx?.dom?.currentPerson?._id; 
  if (!pid) return;

  const famKey = Model.getSelectedKey();
  const fam    = Model.getFamilies()[famKey];
  const path   = findPathByIdInFamily(fam, pid);

  // 1) لو عندنا علم + Blob حقيقي في DB، لا نكرّر الحفظ
  let hasFlag   = !!ctx.dom?.currentPerson?.bio?.photoHasOrig;
  let existing  = null;
  try {
    existing = await ctx.DB.getPhoto(pid + '_orig');
  } catch {}
  if (hasFlag && existing instanceof Blob) return;

  // 2) لو لا يوجد <img> حاليًا لا شيء لنحفظه
  const imgEl = byId('bioPhoto')?.querySelector('img'); 
  if (!imgEl) return;

  const safe = await ensureCanvasSafeBlobURL(imgEl.src);
  try {
    const origBlob = await (await fetch(safe.url || imgEl.src)).blob();

    // حفظ نسخة الأصل في مسارين
    try {
      await ctx.DB.putPhoto(pid + '_orig', origBlob);
      if (path) await ctx.DB.putPhoto(`orig:${famKey}:${path}`, origBlob);
    } catch (e){
      const msg = explainPutPhotoError(e);
      showWarning(msg || 'تعذّر حفظ نسخة الأصل بسبب قيود المتصفح أو مساحة التخزين.');
      return; // لا نضع العلم ولا نُكمل
    }

    // وضع العلم في كل نسخ الشخص في الموديل
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

    tops.forEach(p=>{ 
      touch(p); 
      (p?.children||[]).forEach(touch); 
      (p?.wives||[]).forEach(touch); 
    });
    (fam.rootPerson?.wives||[]).forEach(w=>{ 
      touch(w); 
      (w?.children||[]).forEach(touch); 
    });

    // مزامنة نسخة ctx.dom.currentPerson أيضاً
    if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid){
      ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
      ctx.dom.currentPerson.bio.photoHasOrig = 1;
    }

    Model.commitFamily(famKey);
    Model.savePersistedFamilies?.();
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')) {
      try{ URL.revokeObjectURL(safe.url); }catch{}
    }
  }
}


/* ==== استعادة أساس القص ==== */
async function saveCropBaseline(ctx, pid, imgEl){
  const safe = await ensureCanvasSafeBlobURL(imgEl.src);
  try{
    const blob = await (await fetch(safe.url || imgEl.src)).blob();
    try{
      await ctx.DB.putPhoto(pid + '_cropBase', blob);
    } catch(e){
      const msg = explainPutPhotoError(e);
      showWarning(msg || 'تعذّر حفظ أساس القص. سيُنفَّذ القص بدون نقطة رجوع محلية.');
    }
  } finally {
    if (safe.created && safe.url?.startsWith('blob:')) { try{ URL.revokeObjectURL(safe.url); }catch{} }
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
  const touch   = (p) => {
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

/* ==== استعادة الأصل إن وُجد ==== */
async function getOriginalBlob(ctx){
  const pid = ctx?.dom?.currentPerson?._id;
  if (!pid) return null;

  // الجديد: لا نعتبر أن هناك "أصلًا" إلا لو العلم موجود
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
  const famKey = Model.getSelectedKey(), fam = Model.getFamilies()[famKey];
  const path   = findPathByIdInFamily(fam, pid);

  let origBlob = await ctx.DB.getPhoto(pid + '_orig');
  if (!(origBlob instanceof Blob) && path){
    const b2 = await ctx.DB.getPhoto(`orig:${famKey}:${path}`);
    if (b2 instanceof Blob) origBlob = b2;
  }

  // 1) اكتب نسخة مضغوطة من الأصل في idb:pid وأعد عرض المعاينة
  if (origBlob instanceof Blob){
    const small = await compressBlobForPid(origBlob);
    await ctx.DB.putPhoto(pid, small);
  }

  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);

  // 2) ثبّت المرجع + زد photoVer على كل النسخ
  {
    const famKeyF = Model.getSelectedKey();
    const famF    = Model.getFamilies()[famKeyF];
    const now     = Date.now();
    const touch   = (p)=>{
      if (p && p._id === pid){
        p.bio = p.bio || {};
        p.bio.photoUrl = `idb:${pid}`;
        p.photoUrl     = `idb:${pid}`;
        p.photoVer     = now;          // مهم لإبطال كاش البطاقة
      }
    };
    const tops = [
      ...(Array.isArray(famF.ancestors)?famF.ancestors:[]),
      famF.father, famF.rootPerson, ...(famF.wives||[])
    ].filter(Boolean);
    tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
    (famF.rootPerson?.wives||[]).forEach(w=>{ touch(w); (w?.children||[]).forEach(touch); });

    // امسح أعلام القص/التدوير/الأصل
    const clearFlags = (p)=>{ if (p && p._id === pid && p.bio){ delete p.bio.photoHasOrig; delete p.bio.photoCropped; delete p.bio.photoRotated; } };
    tops.forEach(p=>{ clearFlags(p); (p?.children||[]).forEach(clearFlags); (p?.wives||[]).forEach(clearFlags); });
    (fam.rootPerson?.wives||[]).forEach(w=>{ clearFlags(w); (w?.children||[]).forEach(clearFlags); });

    Model.commitFamily(famKeyF);
    Model.savePersistedFamilies?.();
  }

  // 3) نظّف حالة الـDOM الموضعية
  delete photoBox.dataset.cropped;
  delete photoBox.dataset.rotated;
  ctx.dom.pendingPhoto = null;

  // 4) إجبار تحديث البطاقة فورًا
  try { TreeUI.clearPersonPhotoCache?.(pid); } catch {}
  try { TreeUI.refreshAvatarById?.({ _id: pid, ...ctx.dom.currentPerson }); } catch {}

  // 5) لو تعتمد البطاقة على عنصر <img> ثابت، أعد حقن src مع كسر كاش عبر photoVer
  try{
    const ver = ctx.dom.currentPerson?.photoVer || Date.now();
    document.querySelectorAll(`[data-person-id="${pid}"] img.person-avatar`).forEach(img=>{
      const base = `idb:${pid}`; // أو مسارك الخاص إن كان مختلفًا
      const url  = `${base}${base.includes('?') ? '&' : '?'}v=${ver}`;
      // إن كان راسم البطاقة لا يفهم "idb:" استدعِ راسمك:
      // TreeUI.setCardAvatarSrc?.(pid, url);
      img.src = url;
    });
  }catch{}

  // 6) مزامنة الواجهة وإطلاق حدث اختياري
  ctx.syncPhotoUI?.();
  try { ctx.bus.emit?.('person:photo-changed', { pid }); } catch {}

  showSuccess('تمت استعادة الصورة الأصلية.');
}


/* ==== أداة القص عبر Cropper.js ==== */
async function openCropperFor(photoBox){
  byId('cropperLayer')?.remove();
  const img = photoBox.querySelector('img'); if (!img) return;

  const layer = document.createElement('div');
  layer.id = 'cropperLayer';
  layer.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;
  `;
  layer.innerHTML = `
    <div style="background:#fff;padding:12px;border-radius:10px;max-width:90vw;max-height:90vh">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <button id="crpCancel" class="btn tiny">إلغاء</button>
        <button id="crpDone"   class="btn tiny primary">اعتماد القص</button>
      </div>
      <div style="max-width:80vw;max-height:75vh;overflow:hidden">
        <img id="crpImg" alt="" style="max-width:100%;display:block">
      </div>
    </div>
  `;
  document.body.appendChild(layer);

  const editorImg = layer.querySelector('#crpImg');

  const safe = await ensureCanvasSafeBlobURL(img.src);
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
    if (safe.created && safe.url?.startsWith('blob:')){ try{ URL.revokeObjectURL(safe.url); }catch{} }
    layer.remove();
  };

  layer.querySelector('#crpCancel').onclick = cleanup;

  layer.querySelector('#crpDone').onclick = async () => {
    try{
      const ctx  = window.__photoCtx;
      const pid  = ctx?.dom?.currentPerson?._id;

      await ensureOriginalSnapshotOnce(ctx);

      // إنتاج → تصغير → ضغط
      const c = cropper.getCroppedCanvas({ imageSmoothingEnabled: true });
      const maxDim = 512;
      const scale  = Math.min(1, maxDim / Math.max(c.width, c.height));
      const dst    = document.createElement('canvas');
      dst.width    = Math.max(1, Math.round(c.width * scale));
      dst.height   = Math.max(1, Math.round(c.height * scale));
      await window.pica().resize(c, dst);

      const preBlob    = await new Promise(res => dst.toBlob(res, 'image/jpeg', 0.92));
      const compressed = await new Promise((resolve, reject) =>
        new window.Compressor(preBlob, { quality: JPEG_Q, success: resolve, error: reject })
      );
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader(); fr.onload = ()=>resolve(fr.result); fr.onerror = ()=>reject(new Error('فشل التحويل'));
        fr.readAsDataURL(compressed);
      });

      const photoBox2 = byId('bioPhoto');
 if (await acceptOrRejectSame(ctx, dataUrl, photoBox2)){
  // لا حفظ الآن — مجرد معاينة معلّقة
  photoBox2.dataset.cropped = '1';
  // لا تعدّل الموديل هنا
  ctx.syncPhotoUI?.();
  showInfo('تم تجهيز القص — لم يُحفظ بعد.');
}

    } catch {
      showError('تعذّر إتمام القص/الضغط.');
    } finally {
      cleanup();
    }
  };
}

/* ==== مقارنة دقيقة اختيارية عبر pixelmatch ==== */
async function isVisuallySame(dataUrlA, dataUrlB, threshold=0.1){
  if (!window.pixelmatch) return false;
  const [a, b] = await Promise.all([loadToCanvas(dataUrlA), loadToCanvas(dataUrlB)]);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const ca = document.createElement('canvas'); ca.width=w; ca.height=h; ca.getContext('2d').drawImage(a,0,0,w,h);
  const cb = document.createElement('canvas'); cb.width=w; cb.height=h; cb.getContext('2d').drawImage(b,0,0,w,h);
  const da = ca.getContext('2d').getImageData(0,0,w,h);
  const db = cb.getContext('2d').getImageData(0,0,w,h);
  const diff = document.createElement('canvas'); diff.width=w; diff.height=h;
  const dd = diff.getContext('2d').createImageData(w,h);
  const num = window.pixelmatch(da.data, db.data, dd.data, w, h, {threshold});
  return num === 0;
}
function loadToCanvas(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin='anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d',{alpha:false}).drawImage(img,0,0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('load fail'));
    img.src = src;
  });
}

/* ==== هاش الصورة الحالية/الأصلية + تصنيف المرشح ==== */
async function currentPhotoHash(ctx){
  const person = ctx.dom.currentPerson;
  if (!person) return '';
  const imgEl = byId('bioPhoto')?.querySelector('img');
  if (imgEl?.src){ try { return await aHashFromSrc(imgEl.src); } catch {} }

  const savedRaw = (person.bio?.photoUrl || person.photoUrl || '').trim();
  try{
    if (savedRaw.startsWith('idb:')){
      const pid2 = savedRaw.slice(4);
      const blob = await ctx.DB.getPhoto(pid2);
      if (blob instanceof Blob){
        const u = URL.createObjectURL(blob);
        try { return await aHashFromSrc(u); }
        finally { try{ URL.revokeObjectURL(u); }catch{} }
      }
      return '';
    }
    if (savedRaw) return await aHashFromSrc(savedRaw);
  }catch{}
  return '';
}

const A_HASH_THRESHOLD = 4;

async function originalPhotoHash(ctx){
  if (!ctx?.dom?.currentPerson?.bio?.photoHasOrig) return '';
  try{
    const blob = await getOriginalBlob(ctx);
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    try { return await aHashFromSrc(u); }
    finally { try{ URL.revokeObjectURL(u); }catch{} }
  }catch{ return ''; }
}

/** يصنّف المرشح: 'same-current' | 'same-original' | 'different' */
async function classifyCandidate(ctx, candidateSrc){
  const hasOrig = !!ctx?.dom?.currentPerson?.bio?.photoHasOrig;
  const [nh, ch, ohRaw] = await Promise.all([
    aHashFromSrc(candidateSrc).catch(()=>''), 
    currentPhotoHash(ctx).catch(()=>''), 
    (hasOrig ? originalPhotoHash(ctx) : Promise.resolve('')).catch(()=> '')
  ]);
  const oh   = hasOrig ? ohRaw : '';
  const near = (a,b)=> (a && b && hamming(a,b) <= A_HASH_THRESHOLD);
  if (near(nh,ch)) return 'same-current';
  if (near(nh,oh)) return 'same-original';
  return 'different';
}

/* ==== قبول/رفض مرشح متماثل بصرياً ==== */
async function acceptOrRejectSame(ctx, candidateSrc, photoBox){
  const newHash = await aHashFromSrc(candidateSrc);
  const curHash = await currentPhotoHash(ctx);
  if (newHash && curHash && hamming(newHash, curHash) <= A_HASH_THRESHOLD){
    ctx.dom.pendingPhoto = null;
    ctx.syncPhotoUI?.();
    showWarning('هذه نفس الصورة الحالية. لم يتم إجراء أي تغيير.');
    return false;
  }
  ctx.dom.pendingPhoto = candidateSrc;
  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, candidateSrc, ctx.DB);
  ctx.syncPhotoUI?.();
  return true;
}

/* ==== إدخال صورة جديدة وفق المنطق ==== */
async function handleNewCandidate(ctx, dataUrl, photoBox){
  const kind = await classifyCandidate(ctx, dataUrl);

  // 1) نفس الصورة الحالية
  if (kind === 'same-current'){
    showInfo('هذه نفس الصورة — لا يوجد تغيير');
    ctx.dom.pendingPhoto = null;
    ctx.syncPhotoUI?.();
    return false;
  }

  // 2) نفس الصورة الأصلية ⇒ اعرض مربع حوار لاستعادة الأصل
  if (kind === 'same-original'){
    document.activeElement?.blur();
    const ok = await showConfirmModal({
      title: 'استعادة الأصل',
      message: 'هذه هي الصورة الأصلية. هل تريد استعادتها؟',
      confirmText: 'استعادة',
      cancelText: 'إلغاء'
    });
    if (ok){
      const pid = ctx?.dom?.currentPerson?._id;
      if (!pid) return false;
      await restoreOriginalIfAny(ctx, byId('bioPhoto'), pid);
    }
    return false;
  }

  // 3) صورة مختلفة تمامًا ⇒ نعتبرها "صورة جديدة" ونصفّر أعلام القص/التدوير + الأصل القديم
  if (photoBox){
    // لا نرث حالة التدوير/القص من الصورة السابقة
    delete photoBox.dataset.rotated;
    delete photoBox.dataset.cropped;
  }

  // عند اختيار صورة جديدة مختلفة، نعتبر أن "الأصل" القديم لم يعد صالحًا
  const pid = ctx?.dom?.currentPerson?._id;
  if (pid){
    const famKey = Model.getSelectedKey();
    const fam    = Model.getFamilies()[famKey];
    const path   = findPathByIdInFamily(fam, pid);

    const clearFlags = (p)=>{
      if (p && p._id === pid){
        if (p.bio){
          delete p.bio.photoHasOrig;
          delete p.bio.photoCropped;
          delete p.bio.photoRotated;
        }
      }
    };

    const tops = [
      ...(Array.isArray(fam.ancestors)?fam.ancestors:[]),
      fam.father, fam.rootPerson, ...(fam.wives||[])
    ].filter(Boolean);

    tops.forEach(p=>{ 
      clearFlags(p); 
      (p?.children||[]).forEach(clearFlags); 
      (p?.wives||[]).forEach(clearFlags); 
    });
    (fam.rootPerson?.wives||[]).forEach(w=>{ 
      clearFlags(w); 
      (w?.children||[]).forEach(clearFlags); 
    });

    // مزامنة نسخة ctx.dom.currentPerson أيضاً
    if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pid){
      if (ctx.dom.currentPerson.bio){
        delete ctx.dom.currentPerson.bio.photoHasOrig;
        delete ctx.dom.currentPerson.bio.photoCropped;
        delete ctx.dom.currentPerson.bio.photoRotated;
      }
    }

    Model.commitFamily(famKey);

    // حذف نسخ الأصل من الـ DB (لا حاجة للانتظار على الواجهة)
    (async () => {
      try{
        await ctx.DB.clearPhoto(pid + '_orig');
        if (path) await ctx.DB.clearPhoto(`orig:${famKey}:${path}`);
        await ctx.DB.clearPhoto(pid + '_cropBase');
      }catch{}
    })();
  }

  // الآن نعتبر هذه الصورة هي المرشّح الجديد (بدون أصل/تدوير/قص سابق)
  ctx.dom.pendingPhoto = dataUrl;
  await renderPersonPhoto(photoBox, ctx.dom.currentPerson, dataUrl, ctx.DB);

  // بعد الصورة الجديدة: مزامنة واجهة الأدوات (سيختفي زر استعادة الأصل الآن)
  ctx.syncPhotoUI?.();
  showInfo('لم يتم الحفظ بعد. اضغط "حفظ" لتثبيت الصورة.');
  return true;

}



/* ==== init ==== */
export function init(ctx){
  // مرجع دوال الأدوات
  let ensurePhotoToolsRef = () => {};

  function syncPhotoUI(){
    updatePhotoControls(ctx.dom);
    ensurePhotoToolsRef();
  }
  ctx.syncPhotoUI = syncPhotoUI;

  // سياق عام لأداة القص
  window.__photoCtx = ctx;

  /* عند فتح تفاصيل الشخص */
  ctx.bus.on('person:open', async ({ person }) => {
    ctx.dom.pendingPhoto = null;
    ctx.dom.currentPerson = person;
    const photoBox = byId('bioPhoto');
    if (!photoBox) return;

    // DnD
    if (!photoBox.__dnd){
      photoBox.__dnd = true;
const onOver  = (e)=>{ 
  e.preventDefault(); 
  e.stopPropagation(); 
  photoBox.classList.add('drag'); 
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
};
const onEnter = (e)=>{ 
  e.preventDefault(); 
  e.stopPropagation(); 
  photoBox.classList.add('drag'); 
};
const onLeave = (e)=>{ 
  e.preventDefault(); 
  e.stopPropagation(); 
  photoBox.classList.remove('drag'); 
};
const onDrop  = async (e) => {
  e.preventDefault();
  e.stopPropagation();                // مهم كي لا يصل للـ drop العام
  photoBox.classList.remove('drag');

  const f = e.dataTransfer?.files?.[0];
  if (!f) return;

  if (!/^image\//i.test(f.type)) {
    showError('الملف المُسقَط ليس صورة.');
    return;
  }

  try{
    const dataUrl = await compressImageToDataURL(f, 512, JPEG_Q);
    await handleNewCandidate(ctx, dataUrl, photoBox);
  }catch{
    showError('تعذّر معالجة الصورة.');
  }
};


      photoBox.__dndHandlers = { onOver, onEnter, onLeave, onDrop };
      photoBox.addEventListener('dragover',  onOver);
      photoBox.addEventListener('dragenter', onEnter);
      photoBox.addEventListener('dragleave', onLeave);
      photoBox.addEventListener('drop',      onDrop);
    }

    await renderPersonPhoto(photoBox, person, undefined, ctx.DB);

    // رفع حالتي القص/التدوير من الموديل إلى DOM
    if (person?.bio?.photoRotated) photoBox.dataset.rotated = '1'; else delete photoBox.dataset.rotated;
    if (person?.bio?.photoCropped) photoBox.dataset.cropped = '1'; else delete photoBox.dataset.cropped;

    const ensurePhotoTools = () => {
      const hasImg = !!photoBox.querySelector('img');
      let tools = byId('photoTools');

      // تعريف كتعبير لتجنب W082
      let markRotateFlag = async function noop(){};

      // لا صورة ⇒ إزالة الأدوات
      if (!hasImg){
        tools?.remove();
        delete photoBox.dataset.cropped;
        return;
      }

      // إنشاء الأدوات مرة واحدة
      if (!tools){
        tools = document.createElement('div');
        tools.id = 'photoTools';
        tools.style.cssText = 'display:flex;gap:.4rem;margin-top:.5rem;';
        tools.innerHTML = `
          <button type="button" id="rotateLeft"  class="btn tiny">تدوير 90°</button>
          <button type="button" id="undoRotate"  class="btn tiny" hidden>إلغاء التدوير</button>

          <button type="button" id="cropSquare"  class="btn tiny">ملاءمة الصورة للإطار</button>
          <button type="button" id="undoCrop"    class="btn tiny" hidden>إلغاء الملاءمة</button>

          <button type="button" id="restoreOrig" class="btn tiny danger" hidden>استعادة الأصل</button>
        `;
(byId('bioTools') || photoBox.parentNode)?.appendChild(tools);

        // تدوير
byId('rotateLeft').onclick = async () => {
  const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
  const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;

  await ensureOriginalSnapshotOnce(ctx);
  try{
    const d = await rotateAndCenterCrop(imgEl.src, 90, false);
    const changed = await acceptOrRejectSame(ctx, d, photoBox);
    if (changed){
      // لا حفظ الآن — مجرد معاينة معلّقة
      photoBox.dataset.rotated = '1';
      // لا تعدّل الموديل هنا
      ctx.syncPhotoUI?.();
      showInfo('تم تدوير الصورة — لم تُحفظ بعد.');
    }
  }catch{ showError('تعذّر تنفيذ التدوير.'); }
};


        byId('undoRotate').onclick = async () => {
          const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
          const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;

          // هل هذا التدوير محفوظ فعليًا في الموديل؟
          const wasSavedRot = !!ctx.dom?.currentPerson?.bio?.photoRotated;

          // 1) حالة تدوير غير محفوظ: إرجاع الصورة كما في التخزين وإخفاء أزرار الحفظ
          if (!wasSavedRot) {
            try {
              // لا يوجد تعديل يجب حفظه، فقط نرجع للصورة المخزّنة
              ctx.dom.pendingPhoto = null;
              delete photoBox.dataset.rotated;
              await renderPersonPhoto(photoBox, ctx.dom.currentPerson, undefined, ctx.DB);
              ctx.syncPhotoUI?.();
              showInfo('تم إلغاء التدوير.');
            } catch {
              showError('تعذّر إلغاء التدوير.');
            }
            return;
          }

          // 2) حالة تدوير محفوظ من قبل: إلغاءه يعتبر "تعديل جديد" يحتاج إلى حفظ
          try {
            const d = await rotateAndCenterCrop(imgEl.src, -90, false);
            const changed = await acceptOrRejectSame(ctx, d, photoBox);
            if (changed){
              // لا حفظ الآن — مجرد معاينة معلّقة
              delete photoBox.dataset.rotated;
              ctx.syncPhotoUI?.();
              showInfo('تم إلغاء التدوير — لم يُحفظ بعد.');
            }
          } catch {
            showError('تعذّر إلغاء التدوير.');
          }
        };


        // قص
        byId('cropSquare').onclick = async () => {
          const imgEl = photoBox.querySelector('img'); if (!imgEl) return;
          const pid   = ctx.dom?.currentPerson?._id;   if (!pid) return;
          await saveCropBaseline(ctx, pid, imgEl);
          openCropperFor(photoBox);
        };

        byId('undoCrop').onclick = async () => {
          const pid = ctx.dom?.currentPerson?._id; if (!pid) return;
          try{
            await restoreCropBaselineIfAny(ctx, photoBox, pid);
            delete photoBox.dataset.cropped;
            ctx.syncPhotoUI?.();
            showSuccess('تم إلغاء الملاءمة.');
          }catch{ showError('تعذّر الاستعادة.'); }
        };

        // استعادة الأصل
        byId('restoreOrig').onclick = async () => {
          const pid = ctx.dom?.currentPerson?._id; if (!pid) return;
          await restoreOriginalIfAny(ctx, photoBox, pid);
          showSuccess('تمت استعادة الصورة الأصلية.');
        };

        // تنفيذ الدالة المساعدة كتعبير
        markRotateFlag = async function(on){
          const famKey = Model.getSelectedKey();
          const fam    = Model.getFamilies()[famKey];
          const pid    = ctx?.dom?.currentPerson?._id;
          const touch  = (p)=>{
            if (p && p._id === pid){
              p.bio = p.bio || {};
              if (on) p.bio.photoRotated = 1; else delete p.bio.photoRotated;
              p.photoVer = Date.now();
            }
          };
          const tops = [...(Array.isArray(fam.ancestors)?fam.ancestors:[]), fam.father, fam.rootPerson, ...(fam.wives||[])].filter(Boolean);
          tops.forEach(p=>{ touch(p); (p?.children||[]).forEach(touch); (p?.wives||[]).forEach(touch); });
          (fam.rootPerson?.wives||[]).forEach(w=>{ touch(w); (w?.children||[]).forEach(touch); });
          Model.commitFamily(famKey);
        };
      }

      // تحديث إظهار/إخفاء أزرار الفعل/الإلغاء
      const rotBtn  = byId('rotateLeft');
      const uRotBtn = byId('undoRotate');
      const crpBtn  = byId('cropSquare');
      const uCrpBtn = byId('undoCrop');

      const rotatedNow = photoBox.dataset.rotated === '1';
      const croppedNow = photoBox.dataset.cropped === '1';

      if (rotatedNow){ rotBtn?.setAttribute('hidden',''); uRotBtn?.removeAttribute('hidden'); }
      else            { uRotBtn?.setAttribute('hidden',''); rotBtn?.removeAttribute('hidden'); }

      if (croppedNow){ crpBtn?.setAttribute('hidden',''); uCrpBtn?.removeAttribute('hidden'); }
      else           { uCrpBtn?.setAttribute('hidden',''); crpBtn?.removeAttribute('hidden'); }

      // زر "استعادة الأصل" يظهر فقط إذا كانت الصورة الحالية مختلفة عن الأصل
      const restoreBtn = byId('restoreOrig');
      if (restoreBtn){
        (async () => {
          try{
            const origBlob = await getOriginalBlob(ctx);
            if (!(origBlob instanceof Blob)){
              // لا توجد نسخة أصلية محفوظة
              restoreBtn.setAttribute('hidden','');
              return;
            }

            // احسب هاش الأصل
            let origHash = '';
            const u = URL.createObjectURL(origBlob);
            try {
              origHash = await aHashFromSrc(u);
            } finally {
              try{ URL.revokeObjectURL(u); }catch{}
            }

            // احسب هاش الصورة الحالية (المعاينة)
            const curHash = await currentPhotoHash(ctx).catch(()=>'');

            const sameAsOrig =
              curHash && origHash && hamming(curHash, origHash) <= A_HASH_THRESHOLD;

            // لو متطابقتان تقريباً ⇒ أخفِ الزر، غير ذلك ⇒ أظهِره
            if (sameAsOrig) restoreBtn.setAttribute('hidden','');
            else            restoreBtn.removeAttribute('hidden');
          }catch{
            restoreBtn.setAttribute('hidden','');
          }
        })();

        // أثناء وجود pendingPhoto (قبل الحفظ) نمنع الاستعادة فقط، لكن لا نخفي الزر لو كان ظاهرًا
        if (ctx.dom?.pendingPhoto) restoreBtn.setAttribute('disabled','');
        else                       restoreBtn.removeAttribute('disabled');
      }


    };

    // حقن المرجع وتشغيل التزامن الأولي
    ensurePhotoToolsRef = ensurePhotoTools;
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
    if (img?.dataset.blobUrl){ try { URL.revokeObjectURL(img.dataset.blobUrl); } catch {} img.removeAttribute('data-blob-url'); }

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
  });

  /* اختيار/حفظ (زر واحد + قائمة خيارات) */
  const changePhotoBtn   = byId('changePhotoBtn');
  const changePhotoInput = byId('changePhotoInput');
  changePhotoInput?.setAttribute('accept','image/*');
  const savePhotoBtn     = byId('savePhotoBtn');

  // عناصر القائمة الجديدة
  const photoMenu      = byId('photoMenu');
  const menuUploadBtn  = byId('photoMenuUpload');
  const menuGalleryBtn = byId('photoMenuGallery');

  const hidePhotoMenu = () => {
    if (photoMenu) photoMenu.setAttribute('hidden','');
  };
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

// خيار "من المعرض" بدون محاولة مطابقة الصورة الحالية (أخف)
menuGalleryBtn?.addEventListener('click', async () => {
  hidePhotoMenu();
  const photoBox = byId('bioPhoto');
  if (!photoBox) return;

  openPhotoGallery({
    currentSrc: '',
    async onSelect(src){
      try{
        // 1) جلب الصورة من المعرض كـ DataURL
        const dataUrl = await urlToDataURL(src);

        // 2) تحويل الـ DataURL إلى Blob
        const tmpRes  = await fetch(dataUrl);
        const tmpBlob = await tmpRes.blob();

        // 3) ضغط الـ Blob بالمعيار نفسه (حجم 512 وجودة JPEG_Q)
        const smallBlob = await compressBlobForPid(tmpBlob);

        // 4) تحويل الـ Blob المضغوط إلى DataURL وإرساله لمسار الترشيح/المعاينة
        const finalDataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload  = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('فشل التحويل بعد الضغط.'));
          fr.readAsDataURL(smallBlob);
        });

        await handleNewCandidate(ctx, finalDataUrl, photoBox);
      }catch{
        showError('تعذّر تحميل الصورة الجاهزة.');
      }
    }
  });
});




  // زر الصورة الرئيسي:
  // - لو هناك pendingPhoto ⇒ يلغيها (نفس السلوك السابق)
  // - لو لا يوجد ⇒ يفتح/يغلق القائمة
  changePhotoBtn?.addEventListener('click', async (e) => {
    e.preventDefault();

    if (ctx.dom.pendingPhoto){
      const target   = ctx.dom.currentPerson;
      const photoBox = byId('bioPhoto');

      const hadRotate = photoBox?.dataset.rotated === '1';
      const hadCrop   = photoBox?.dataset.cropped === '1';

      ctx.dom.pendingPhoto = null;

      if (photoBox){
        delete photoBox.dataset.rotated;
        delete photoBox.dataset.cropped;
        await renderPersonPhoto(photoBox, target, undefined, ctx.DB);
      }

      syncPhotoUI();
      hidePhotoMenu();

      if (hadRotate || hadCrop){
        showInfo('تم إلغاء التعديل.');
      } else {
        showInfo('تم إلغاء الصورة المحمّلة قبل الحفظ.');
      }
      return;
    }

    // لا يوجد تعديل معلّق ⇒ عرض القائمة
    togglePhotoMenu();
  });

  // عند اختيار ملف من الجهاز
  changePhotoInput?.addEventListener('change', async (e) => {
    hidePhotoMenu();

    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!/^image\//i.test(file.type)) {
      showError('الملف المختار ليس صورة.');
      e.target.value = '';
      return;
    }

    try{
      const dataUrl = await compressImageToDataURL(file, 512, JPEG_Q);
      const photoBox = byId('bioPhoto');
      if (photoBox) await handleNewCandidate(ctx, dataUrl, photoBox);
    }catch{
      showError('تعذّر معالجة الصورة.');
    }finally{
      e.target.value = '';
    }
  });

  // حفظ + عرض خيار "تراجع" عبر نافذة تأكيد سريعة (نفس كودك السابق)
  savePhotoBtn?.addEventListener('click', async () => {
    if (!ctx.dom.currentPerson || !ctx.dom.pendingPhoto) return;
    try{
      const pid = ctx.dom.currentPerson._id;

      let prevBlob = null;
      try { const b = await ctx.DB.getPhoto(pid); if (b instanceof Blob) prevBlob = b; } catch {}

      await ensureOriginalSnapshotOnce(ctx);
      await persistPhotoForCurrent(ctx.dom, ctx.DB);

      const photoBox$   = byId('bioPhoto');
      const rotatedNow  = photoBox$?.dataset.rotated === '1';
      const croppedNow  = photoBox$?.dataset.cropped === '1';

      const famKeyC = Model.getSelectedKey();
      const famC    = Model.getFamilies()[famKeyC];
      const pidC    = pid;

      const touchFlagsOnSave = (p)=>{
        if (p && p._id === pidC){
          p.bio = p.bio || {};
          if (rotatedNow) p.bio.photoRotated = 1; else delete p.bio.photoRotated;
          if (croppedNow) p.bio.photoCropped = 1; else delete p.bio.photoCropped;
          p.photoVer = Date.now();
        }
      };

      const topsC = [
        ...(Array.isArray(famC.ancestors)?famC.ancestors:[]),
        famC.father, famC.rootPerson, ...(famC.wives||[])
      ].filter(Boolean);

      topsC.forEach(p=>{ 
        touchFlagsOnSave(p); 
        (p?.children||[]).forEach(touchFlagsOnSave); 
        (p?.wives||[]).forEach(touchFlagsOnSave); 
      });
      (famC.rootPerson?.wives||[]).forEach(w=>{ 
        touchFlagsOnSave(w); 
        (w?.children||[]).forEach(touchFlagsOnSave); 
      });

      Model.commitFamily(famKeyC);
      Model.savePersistedFamilies?.();

      if (ctx.dom.currentPerson && ctx.dom.currentPerson._id === pidC){
        ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
        if (rotatedNow) ctx.dom.currentPerson.bio.photoRotated = 1; else delete ctx.dom.currentPerson.bio.photoRotated;
        if (croppedNow) ctx.dom.currentPerson.bio.photoCropped = 1; else delete ctx.dom.currentPerson.bio.photoCropped;
        ctx.dom.currentPerson.photoVer = Date.now();
      }

      if (ctx.dom.currentPerson){
        ctx.dom.currentPerson.bio = ctx.dom.currentPerson.bio || {};
        ctx.dom.currentPerson.bio.photoUrl = `idb:${pid}`;
        ctx.dom.currentPerson.photoUrl     = `idb:${pid}`;
        ctx.dom.currentPerson.photoVer     = Date.now();
      }

      ctx.dom.pendingPhoto = null;

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

        const undo = await showConfirmModal({
          title: 'تراجع عن الحفظ',
          message: 'هل تريد التراجع واستعادة الحالة السابقة؟',
          confirmText: 'تراجع',
          cancelText: 'إغلاق'
        });

        if (undo){
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