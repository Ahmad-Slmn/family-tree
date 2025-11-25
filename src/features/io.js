// features/io.js — الاستيراد/التصدير/السحب/التفريغ/النسخ الاحتياطي

import {
  byId, showSuccess, showInfo, showError,
  downloadJson, readJsonFile, showConfirmModal
} from '../utils.js';

import * as Model from '../model/families.js';
import { normalizeNewFamilyForLineage } from '../model/families.js';
import { ensureIdsForAllFamilies } from './ids.js';

let bus;

// =======================================
// 0) أدوات مساعدة عامّة
// =======================================

// ميتاداتا واضحة داخل ملف التصدير
function buildExportMeta(){
  return {
    app: 'FamilyTree',
    schema: Model.SCHEMA_VERSION || 4,
    exportedAt: new Date().toISOString(),
    selectedFamily: Model.getSelectedKey?.() || null
  };
}

// فحص سريع لبنية ملف العائلات
function isValidFamiliesPayload(obj){
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).filter(k => k !== '__meta');
  if (!keys.length) return false;
  return keys.every(k => obj[k] && typeof obj[k] === 'object');
}

// تنظيف اسم يصلح كاسم ملف
function safeFileName(name){
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'families';
}

// إعادة تسمية مفاتيح العائلات المستوردة إذا كان هناك تصادم
function rekeyImportedFamilies(obj){
  const out = {};
  const map = {}; // oldKey -> newKey
  const existing = Model.getFamilies?.() || {};

  Object.keys(obj || {}).forEach(k=>{
    if (k === '__meta') return;
    let nk = k;
    if (existing[k]) {
      nk = Model.generateFamilyKey?.() || (k + '_copy');
    }
    out[nk] = obj[k];
    map[k] = nk;
  });

  if (obj.__meta) out.__meta = obj.__meta;
  return { out, map };
}

// حدّ الحجم: 10MB
const MAX_JSON_BYTES = 10 * 1024 * 1024;

// مؤقّت النسخ الاحتياطي للجلسة
let _backupTimer = null;

// إبطال blob آمن (مرة لكل عنوان)
function revokeAllBlobImagesOnce(){
  const seen = new Set();
  document.querySelectorAll('img').forEach(img=>{
    const s = img.currentSrc || img.src || '';
    if (s && s.startsWith('blob:') && !seen.has(s)) {
      seen.add(s);
      try { URL.revokeObjectURL(s); } catch {}
    }
  });
}

// نصّ التأكيد مقبول؟
function confirmTextOk(v){
  let t = String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ');
  t = t.replace(/أ|إ|آ/g, 'ا');
  return (t === 'اوافق' || t === 'نعم' || t === 'اوافق على الحذف');
}

// إغلاق مودال التأكيد مع الحفاظ على التركيز
function closeConfirmModalSafely(modal) {
  try {
    if (modal && modal.contains(document.activeElement)) {
      const fallback =
        byId('hardResetBtn') ||
        document.querySelector('[data-main-focus]') ||
        document.body;
      if (fallback === document.body) {
        document.body.setAttribute('tabindex','-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      } else {
        fallback.focus();
      }
    }
  } catch {}
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
  document.documentElement.style.overflow = '';
}

// تنزيل نسخة احتياطية فورية
function autoDownloadBackup(){
  const blob = new Blob([JSON.stringify(Model.exportFamilies(), null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.download = `families-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

// التحقق من وجود بيانات محفوظة فعليًا
async function hasAnyPersistedData(ctx){
  // 0) في الذاكرة: أي عائلة مخصّصة؟
  try{
    const fams = Model.getFamilies?.() || {};
    if (Object.values(fams).some(f => f && f.__custom)) return true;
  }catch{}

  // 1) IndexedDB: عائلات أو صور؟
  try{
    const nf = (await ctx.DB?._countFamilies?.()) | 0;
    const np = (await ctx.DB?._countPhotos?.())   | 0;
    if (nf > 0 || np > 0) return true;
  }catch{}

  // 2) تفضيلات غير افتراضية (لا نحتسب autoBackup)
  const theme =
    localStorage.getItem('theme') ||
    localStorage.getItem('appTheme') ||
    localStorage.getItem('familyTreeTheme');

  const fam   = localStorage.getItem('selectedFamily');
  const font  = localStorage.getItem('siteFontSize');

  const hasNonDefaultPrefs =
    (theme != null && theme !== 'default') ||
    (fam   != null && fam   !== 'family1') ||
    (font  != null && String(font) !== '16');

  return !!hasNonDefaultPrefs;
}

// =======================================
// استيراد موحّد (ذكي ومحصّن)
// =======================================
async function doImport(ctx, obj){
  if (!isValidFamiliesPayload(obj)) throw new Error('bad-payload');

  // نسخة الـ schema القادمة من الملف (إن وجدت)
  const metaVer =
    +obj.__meta?.schema ||
    +obj.__meta?.version ||
    null;

  // (1) إعادة تسمية المفاتيح المتصادمة
  const { out: rekeyed, map } = rekeyImportedFamilies(obj);
  obj = rekeyed;

  // (2) تطبيع/ترحيل كل عائلة مستوردة
  const importedKeys = Object.keys(obj).filter(k => k !== '__meta');

  importedKeys.forEach(k=>{
    const fam = obj[k];
    try {
      // لو نسخة قديمة، رحّلها إلى آخر Schema
      if (metaVer != null && metaVer < (Model.SCHEMA_VERSION || 4)) {
        Model.migrate?.(fam, metaVer, Model.SCHEMA_VERSION || 4);
      }
      normalizeNewFamilyForLineage(fam);
    } catch {}
  });

  // (3) استيرادها للذاكرة
  Model.importFamilies(obj);

  // (4) ربط الزوجات + IDs + حفظ
  Model.linkRootPersonWives();
  await ensureIdsForAllFamilies();
  await Model.savePersistedFamilies?.();

  // (5) اختيار العائلة المستوردة تلقائيًا (إن وُجدت)
  const selOld = obj.__meta?.selectedFamily;
  const selNew = selOld ? (map[selOld] || selOld) : null;

  // المفتاح النهائي الذي نريد اختياره بعد الاستيراد
  const finalSel =
    (selNew && (Model.getFamilies?.()[selNew])) ? selNew
    : (importedKeys[0] || Model.getSelectedKey?.() || null);

  if (finalSel && Model.setSelectedKey) Model.setSelectedKey(finalSel);

  // مهم: اجعل state يغيّر selectedFamily ليُعاد رسم أزرار الشريط + الشجرة
  if (finalSel && ctx?.state?.setState) {
    ctx.state.setState({ selectedFamily: finalSel });
  } else {
    ctx?.state?.setState?.({});
  }

  ctx?.bus?.emit('io:import:done');
  ctx?.bus?.emit('families:coreFlag:refresh');

}

// =======================================
// 1) نقطة الدخول
// =======================================
export function init(ctx){
  bus = ctx.bus;

  const exportBtn   = byId('exportBtn');
  const importInput = byId('importInput');

  // ——— تصدير JSON (عائلة واحدة مع ميتاداتا) ———
  exportBtn?.addEventListener('click', ()=>{
    const all = Model.exportFamilies();

    const key = Model.getSelectedKey?.() || 'family1';
    const fam = all[key];

    if (!fam){
      downloadJson(all, 'all-families.json');
      return;
    }

    const rawFamilyName =
      String(
        fam.familyName ||
        fam.fullRootPersonName ||
        fam.rootPerson?.name ||
        key
      ).trim();

    const rawName = `عائلة - ${rawFamilyName}`;
    const safeName = safeFileName(rawName);

    const payload = {
      [key]: fam,
      __meta: buildExportMeta()
    };

    downloadJson(payload, `${safeName}.json`);
  });

  // ——— استيراد من input (مع رسائل ذكية) ———
  importInput?.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try{
      if (file.type && file.type !== 'application/json') throw new Error('bad-type');
      if (file.size > MAX_JSON_BYTES) throw new Error('too-large');

      const data = await readJsonFile(file);

      // عرض معلومات الملف قبل تثبيته
      const keys = Object.keys(data || {}).filter(k => k !== '__meta');
      if (keys.length){
        const meta = data.__meta || {};
        const when = meta.exportedAt ? ` — تاريخ التصدير: ${meta.exportedAt.slice(0,19).replace('T',' ')}` : '';
        showInfo(`تم تحميل ملف: ${file.name} — عدد العائلات: ${keys.length}${when}`);
      }

      await doImport(ctx, data);
      showSuccess('تم الاستيراد بنجاح.');
    }catch(err){
      if (err?.message === 'too-large') showError('الملف كبير جدًا. الحد 10MB.');
      else if (err?.message === 'bad-type') showError('نوع الملف غير مدعوم. استخدم JSON.');
      else if (err?.message === 'bad-payload') showError('هيكل الملف غير مطابق لتصدير التطبيق.');
      else showError('فشل الاستيراد. تأكد من صحة الملف.');
    }finally{
      importInput.value = '';
    }
  });

  // ——— تفريغ شامل (Wipe) ———
  byId('hardResetBtn')?.addEventListener('click', async () => {
    if (!(await hasAnyPersistedData(ctx))) {
      showInfo('لا توجد بيانات محفوظة للتفريغ.');
      return;
    }

    showConfirmModal({
      title: 'تفريغ جميع البيانات',
      message: `سيتم تنفيذ تفريغ كامل للبيانات:
1) حذف الصور الشخصية المحمّلة
2) حذف جميع العائلات المضافة
3) إعادة تفضيلات الواجهة إلى الوضع الافتراضي
4) إعادة تشغيل التطبيق`,
      confirmText: 'تفريغ الآن',
      cancelText: 'إلغاء',
      variant: 'danger',
      closeOnBackdrop: false,
      defaultFocus: 'cancel'
    });

    const modal  = byId('confirmModal');
    const textEl = byId('confirmText');
    const yesEl  = byId('confirmYes');
    const noEl   = byId('confirmNo');
    if (!modal || !textEl || !yesEl || !noEl) return;

    textEl.innerHTML = `
  <div class="danger-box">
    <p>سيتم تنفيذ العمليات التالية:</p>
    <ol class="list-nums">
      <li>حذف الصور الشخصية المحمّلة</li>
      <li>حذف جميع العائلات المضافة</li>
      <li>إعادة تفضيلات الواجهة إلى الوضع الافتراضي</li>
      <li>إعادة تشغيل التطبيق</li>
    </ol>

    <label class="confirm-type" for="wipeConfirmInput">
      اكتب <code>أوافق</code> أو <code>نعم</code> (أو <code>أوافق على الحذف</code>) للموافقة:
    </label>
    <input id="wipeConfirmInput" type="text" placeholder="أوافق / نعم" autocomplete="off">

    <div class="confirm-type" style="margin-top:8px;display:flex;gap:8px;align-items:center">
      <input id="wipeDoBackup" type="checkbox">
      <label for="wipeDoBackup" style="margin:0">حفظ بيانات العائلات قبل التفريغ</label>
    </div>
  </div>
`;

    const replace = (btn)=>{ const c = btn.cloneNode(true); btn.parentNode.replaceChild(c, btn); return c; };
    const yes = replace(byId('confirmYes'));
    const no  = replace(byId('confirmNo'));

    yes.textContent = 'تفريغ الآن';
    no.textContent  = 'إلغاء';

    // تلميح ذكي على الإدخال
    let _wipeHintTimer = null;
    const inputEl = byId('wipeConfirmInput');
    inputEl?.addEventListener('input', (e) => {
      const v = (e.target.value || '').trim();
      if (_wipeHintTimer) { clearTimeout(_wipeHintTimer); _wipeHintTimer = null; }
      if (!v || confirmTextOk(v)) return;
      _wipeHintTimer = setTimeout(() => {
        const cur = (byId('wipeConfirmInput')?.value || '').trim();
        if (cur && !confirmTextOk(cur)) showInfo('اكتب "أوافق" أو "نعم" أو "أوافق على الحذف" للمتابعة.');
      }, 600);
    });

    yes.addEventListener('click', async () => {
      yes.setAttribute('disabled',''); yes.classList.add('loading'); no.setAttribute('disabled','');
      const val = (byId('wipeConfirmInput')?.value || '').trim();

      if (!val) {
        showInfo('الرجاء كتابة "أوافق" أو "نعم" قبل المتابعة.');
        yes.removeAttribute('disabled'); yes.classList.remove('loading'); no.removeAttribute('disabled');
        return;
      }
      if (!confirmTextOk(val)) {
        showError('النص المدخل غير صحيح.');
        yes.removeAttribute('disabled'); yes.classList.remove('loading'); no.removeAttribute('disabled');
        return;
      }

      try {
        const doBackup = !!byId('wipeDoBackup')?.checked;
        if (doBackup) { try { autoDownloadBackup(); } catch {} }

        await ctx.DB.nuke();

        // تصفير حالة التطبيق
        try {
          Model.resetInMemory?.();
          ctx.state?.setState?.({});
          ctx.bus?.emit('wipe:after');
        } catch {}

        // تنظيف Cache Storage
        try {
          if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map(n => caches.delete(n)));
          }
        } catch {}

        showSuccess('تم التفريغ بنجاح. سيُعاد تشغيل التطبيق الآن.');
      } catch {
        showError('تعذّر التفريغ الكامل. قد يكون هناك تبويب آخر مفتوح يمنع الحذف. أُكمل المسح الجزئي وإعادة التشغيل.');
      } finally {
        try {
          [
            'theme', 'appTheme',
            'familyTreeTheme',
            'selectedFamily',
            'siteFontSize',
            'autoBackup',
            'treeTaglineState', 'treeTaglineIndex'
          ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
        } catch {}

        try {
          document.documentElement.classList.remove(
            'theme-corporate','theme-elegant','theme-minimal','theme-royal','theme-dark'
          );
        } catch {}

        closeConfirmModalSafely(modal);
        try { revokeAllBlobImagesOnce(); } catch {}
        setTimeout(() => { location.reload(); }, 600);
      }
    });

    no.addEventListener('click', () => {
      closeConfirmModalSafely(modal);
      showInfo('تم إلغاء عملية التفريغ.');
    });
  });

  // ——— سحب/إفلات JSON مع مؤشّر إسقاط ———
  window.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('drop', async e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || [])
      .filter(f => !f.type || f.type === 'application/json');

    if (!files.length) { showInfo('أفلت ملف JSON فقط.'); return; }

    const f = files[0];
    try{
      if (f.size > MAX_JSON_BYTES) throw new Error('too-large');

      const text = await f.text();
      const obj = JSON.parse(text);

      // عرض معلومات الملف قبل التثبيت
      const keys = Object.keys(obj || {}).filter(k => k !== '__meta');
      if (keys.length){
        const meta = obj.__meta || {};
        const when = meta.exportedAt ? ` — تاريخ التصدير: ${meta.exportedAt.slice(0,19).replace('T',' ')}` : '';
        showInfo(`تم تحميل ملف: ${f.name} — عدد العائلات: ${keys.length}${when}`);
      }

      await doImport(ctx, obj);
      ctx?.redrawUI?.();
      showSuccess('تم الاستيراد من الملف المسحوب.');
    }catch(err){
      if (err?.message === 'too-large') showError('الملف كبير جدًا. الحد 10MB.');
      else if (err?.message === 'bad-payload') showError('هيكل الملف غير مطابق لتصدير التطبيق.');
      else showError('فشل الاستيراد. تأكد من صحة الملف.');
    }
  });

  // ——— نسخ احتياطي آلي محمي من التكرار ———
  if (localStorage.getItem('autoBackup') === '1' && !_backupTimer) {
    const jitter = Math.floor(Math.random()*30000); // ≤ 30s
    _backupTimer = setTimeout(()=>{
      _backupTimer = setInterval(autoDownloadBackup, 15*60*1000);
      autoDownloadBackup();
    }, jitter);
  }

  // ——— تنظيف blob قبل الإغلاق ———
  window.addEventListener('beforeunload', ()=>{
    revokeAllBlobImagesOnce();
  });

  return {};
}
