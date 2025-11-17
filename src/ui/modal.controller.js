// src/ui/modal.controller.js — تحكم وربط: مصيدة التركيز، Sortable، تفويض الأحداث، فحص الاتساخ، إغلاق مؤكد، Submit

import { showInfo, showSuccess, showConfirmModal, byId, highlight, getArabicOrdinal, getArabicOrdinalF } from '../utils.js';
import { ModalManager } from './modalManager.js';
import { generateFamilyKey, getFamily } from '../model/families.js';

import * as Form from '../features/familyForm.js';
import {
  ensureBtnLabelSpan,
  createWifeBlock,
  createChildEditItem,
  createAncestorItem,
  createFatherBlock,
  createMotherBlock,
  initDirtyIndicators,
  ensureDirtyDot,
  updateChildrenCount as updateChildrenCountView,
  disposeDirtyIndicators,
  initYearOnlyToggles
} from './modal.view.js';

// ===== Helpers مشتركة لنصوص القوائم (نفس السلوك الحالي بالضبط) =====

// مصفوفة نصوص → "س، ص، ع" مع fallback إلى نص خام
function joinTextList(arr, fallback = '') {
  if (Array.isArray(arr) && arr.length) {
    return arr
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .join('، ');
  }
  return (fallback || '').trim();
}

// مصفوفة كائنات { name } → "س، ص، ع" مع fallback إلى نص خام
function joinNamesList(arr, fallback = '') {
  if (Array.isArray(arr) && arr.length) {
    return arr
      .map(x => (x?.name || '').trim())
      .filter(Boolean)
      .join('، ');
  }
  return (fallback || '').trim();
}

// قراءة year/date من كائن bio لكلمة أساس مثل "birth" أو "death"
function getYearAndDate(bio, base){
  const yearKey = base + 'Year';
  const dateKey = base + 'Date';
  const year    = bio?.[yearKey] ? String(bio[yearKey]).trim() : '';
  const dateVal = (bio?.[dateKey] && bio[dateKey] !== '-') ? bio[dateKey] : '';
  return { year, dateVal };
}

// تطبيق year/date على input مع دعم dataset.yearOnly/fullDate
function applyYearDateToInput(input, year, dateVal){
  if (!input) return;
  const y = (year || '').trim();
  const d = (dateVal || '').trim();

  if (y && !d){
    // سنة فقط
    input.dataset.yearOnly = y;
    input.dataset.fullDate = '';
    input.value = y;
    input.type  = 'text';
  } else {
    const v = d || '';
    input.dataset.fullDate = v;
    input.dataset.yearOnly = v ? v.slice(0, 4) : (y || '');
    input.value = v;
    if (v) input.type = 'date';
  }
}

// قراءة تاريخ/سنة من input + dataset (لـ snapshot) مع تفضيل dataset
function readDateFromInputWithDataset(root, sel, datasetKey){
  const ds = (root.dataset?.[datasetKey] || '').trim();
  if (ds) return ds;

  const inp = root.querySelector(sel);
  if (!inp) return '';

  const y = (inp.dataset.yearOnly || '').trim();
  const d = (inp.dataset.fullDate || '').trim();
  if (y && !d) return y;
  if (d) return d;
  return (inp.value || '').trim();
}

// ضبط dataset من كائن source حسب خريطة
function fillDatasetFromSource(dataset, source, map){
  Object.entries(map).forEach(([dsKey, getter])=>{
    dataset[dsKey] = (getter(source) || '').trim();
  });
}

// نقل dataset → حقول داخل root حسب خريطة
function fillInputsFromDataset(root, dataset, map){
  Object.entries(map).forEach(([sel, dsKey])=>{
    const el = root.querySelector(sel);
    if (el) el.value = (dataset[dsKey] || '').trim();
  });
}

// نقل الحقول → dataset داخل root حسب خريطة
function fillDatasetFromInputs(root, dataset, map){
  Object.entries(map).forEach(([sel, dsKey])=>{
    const el = root.querySelector(sel);
    dataset[dsKey] = (el && el.value ? el.value : '').trim();
  });
}



export function wireFamilyModal({ modal, initialData, editKey, onSave, onCancel }){
  /* ========= 0) تركيز أولي + تهيئة مؤشرات الاتساخ ========= */
  const openerEl = document.activeElement;

  // تركيز أول حقل مهم (required)، ثم العنوان، ثم أول عنصر قابل للتركيز
  function focusFirst(){
    const emptyReq = modal.querySelector('input[required]:not([value]), input[required][value=""]');
    if (emptyReq) { emptyReq.focus(); return; }

    const title = modal.querySelector('.form-modal-header h2');
    if (title){
      title.tabIndex = -1;
      title.focus({ preventScroll:true });
      return;
    }

    const firstFocusable = modal.querySelector(
      'a[href],button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    );
    (firstFocusable || modal).focus();
  }

  setTimeout(focusFirst, 0);
  if (!modal.__dirtyInited){ initDirtyIndicators(modal); modal.__dirtyInited = true; }

  /* ========= 1) عناصر أساسية ========= */
  const ancList     = modal.querySelector('.ancestors-list');
  const ancAddBtn   = modal.querySelector('#addAncestorBtn');
  const wivesList   = modal.querySelector('.wives-list');
  const addWifeBtn  = modal.querySelector('#addWifeBtn');
  const formEl      = modal.querySelector('#addFamilyForm');
const fatherMount = formEl.querySelector('#fatherBlockMount');
const fatherBlock = createFatherBlock(); fatherMount.appendChild(fatherBlock);

const motherMount = formEl.querySelector('#motherBlockMount');
const motherBlock = createMotherBlock(); motherMount.appendChild(motherBlock);

  const submitBtn = formEl.querySelector('button[type="submit"]');
  const labelSpan = ensureBtnLabelSpan(submitBtn);
  const ancLive   = byId('ancLive');
  // مساعد بسيط لوضع قيمة في حقل داخل النموذج
  const set = sel => v => {
    const el = formEl.querySelector(sel);
    if (el) el.value = v || '';
  };

  // ====== وسم الحقول غير الصالحة وإزالتها عند التعديل ======
  function clearInvalid(el){
    if (!el) return;
    const isReq  = el.hasAttribute('required');
    const hasVal = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : !!(el.value||'').trim();

    // مطلوب منطقيًا وما زال بلا قيمة → أبقِ الوسم
    if (el.dataset.logicRequired === '1' && !hasVal){
      el.classList.add('is-invalid');
      el.setAttribute('aria-invalid','true');
      el.__dirtyToggle?.();
      return;
    }

    // غير ذلك: نظّف الوسم
    if (!isReq || hasVal){
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
      if (hasVal && el.dataset.logicRequired === '1') el.dataset.logicRequired = '0';

      // إن كان داخل طفل → أزل dot-invalid من عنوان الطفل
      const child = el.closest('.child-item');
      if (child) child.querySelector('.child-title')?.classList.remove('dot-invalid');
    }
    el.__dirtyToggle?.();
  }

  function markInvalid(el){
    if (!el) return;
    el.classList.add('is-invalid');
    el.setAttribute('aria-invalid','true');
    el.__dirtyToggle?.();
    el.scrollIntoView({ block:'center', behavior:'smooth' });
    el.focus({ preventScroll:true });
  }

  function validateRequiredLive(t){
    if (!t || !t.matches('input[required],select[required],textarea[required]')) return;
    const hasVal = (t.type === 'checkbox' || t.type === 'radio') ? !!t.checked : !!(t.value||'').trim();
    t.classList.toggle('is-invalid', !hasVal);
    if (!hasVal) t.setAttribute('aria-invalid','true'); else t.removeAttribute('aria-invalid');
    t.__dirtyToggle?.();
  }

  // مراقبة عامة للحقل المطلوب + تنظيف فوري لأي خطأ
  formEl.addEventListener('input',  (e)=>{ validateRequiredLive(e.target); clearInvalid(e.target); }, true);
  formEl.addEventListener('blur',   (e)=> validateRequiredLive(e.target), true);

  /* ========= 2) مساعدات رسائل ========= */
  const roleWord = (scope, role) => (scope === 'child' ? (role === 'بنت' ? 'البنت' : 'الابن') : 'الجد');
  const ancestorLabel = (name, idx) => {
    const ord = getArabicOrdinal(idx), nm = (name||'').trim();
    return nm ? `الجد: ${ord} «${nm}»` : `الجد: ${ord}`;
  };
  function fmtWho(scope, {name='', role='', index, ordIndex}){
    return (scope === 'ancestor') ? ancestorLabel(name, ordIndex ?? index ?? 1)
      : (()=>{ const r = roleWord(scope, role); const n=(name||'').trim(); return n?`${r} «${n}»`:r; })();
  }
  function fmtWhoToast(scope, {name='', role='', index, ordIndex}){
    const base = fmtWho(scope, {name, role, index, ordIndex});
    const nm = (name||'').trim();
    return nm ? base.replace(`«${nm}»`, `«${highlight(nm)}»`) : base;
  }
  function notifyMove({ scope, name='', role='', from, to, ordIndex }){
    const whoPlain = fmtWho(scope, {name, role, ordIndex, index:from});
    const whoToast = fmtWhoToast(scope, {name, role, ordIndex, index:from});
    ancLive.textContent = `تم نقل ${whoPlain} من الموضع ${from} إلى الموضع ${to}`;
    showSuccess(`تم نقل ${whoToast} من الموضع ${highlight(String(from))} إلى الموضع ${highlight(String(to))}`);
  }
  function notifyNoChange({ scope, name='', role='', index }){
    const whoPlain = fmtWho(scope, {name, role, index});
    const whoToast = fmtWhoToast(scope, {name, role, index});
    ancLive.textContent = `لم يتغير موضع ${whoPlain}`;
    showInfo(`لم يتغير موضع ${whoToast}`);
  }
  const fromTo = (evt, container)=>{
    const fromIdx = (evt.oldIndex ?? Array.from(container.children).indexOf(evt.item)) + 1;
    const toIdx   = (evt.newIndex ?? Array.from(container.children).indexOf(evt.item)) + 1;
    return { fromIdx, toIdx };
  };

  /* ========= 3) DnD ========= */
  function wireAncestorsDnD(){
    if (typeof Sortable === 'undefined'){ console.warn('[DnD] Sortable.js غير متاح.'); return; }
    if (ancList.__sortable) return;
    ancList.__sortable = new Sortable(ancList, {
      handle: '.dnd-handle, .ancestor-label',
      animation: 150, ghostClass: 'dnd-ghost', chosenClass: 'dnd-chosen', dragClass: 'dnd-drag',
      direction: 'vertical', forceFallback: false, fallbackTolerance: 6,
      onStart(){ document.body.classList.add('dnd-drag'); },
      onEnd(evt){
        document.body.classList.remove('dnd-drag');
        const { fromIdx, toIdx } = fromTo(evt, ancList);
        const nm = (evt.item.querySelector('.ancestor-name')?.value || '').trim();
        if (fromIdx === toIdx) return notifyNoChange({ scope:'ancestor', name:nm, index:toIdx });
        renumberAncestorLabels(true); updateAddAncestorBtnText(); checkDirty();
        notifyMove({ scope:'ancestor', name:nm, from:fromIdx, to:toIdx, ordIndex:fromIdx });
      }
    });
  }

  function initChildrenOrderBaselines(scope = wivesList){
    scope.querySelectorAll('.children-list-editor').forEach(list=>{
      Array.from(list.children).forEach((li,i)=> li.dataset.initialIndex = String(i+1));
    });
  }

  function refreshChildrenOrderDirty(list){
    Array.from(list.children).forEach((li,i)=>{
      const title = li.querySelector('.child-title'); if (!title) return;
      const changed = String(i+1) !== (li.dataset.initialIndex || String(i+1));
      ensureDirtyDot(title);
      title.classList.toggle('dirty-on', changed);
      title.classList.toggle('dot-pending', changed);
      title.classList.remove('dot-ok','dot-invalid');
      if (!changed) title.classList.remove('dirty-on','dot-pending');
    });
  }

  function wireChildrenDnD(scope = wivesList){
    if (typeof Sortable === 'undefined'){ console.warn('[DnD] Sortable.js غير متاح.'); return; }
    const onStart = ()=> document.body.classList.add('dnd-drag');
    const onEnd = (evt)=>{
      document.body.classList.remove('dnd-drag');
      const list = evt.to;
      const { fromIdx, toIdx } = fromTo(evt, list);
      const li   = evt.item;
      const name = (li.dataset.childName || '').trim();
      const role = (li.dataset.childRole || '').trim();

      if (fromIdx === toIdx) {
        refreshChildrenOrderDirty(list);
        return notifyNoChange({ scope:'child', name, role });
      }

      const wife = list.closest('.wife-block');
      updateChildrenCount(wife);

      const a = Math.min(fromIdx, toIdx) - 1;
      const b = Math.max(fromIdx, toIdx) - 1;
      Array.from(list.children).slice(a, b+1).forEach(it=>{
        const title = it.querySelector('.child-title');
        if (title){ ensureDirtyDot(title); title.classList.add('dirty-on','dot-pending'); title.classList.remove('dot-ok','dot-invalid'); }
      });

      refreshChildrenOrderDirty(list);
      checkDirty();
      notifyMove({ scope:'child', name, role, from:fromIdx, to:toIdx });
    };

    scope.querySelectorAll('.children-list-editor').forEach(el=>{
      if (el.__sortable) return;
      el.__sortable = new Sortable(el, {
        handle: '.dnd-handle, .child-index-badge',
        animation: 150, ghostClass: 'dnd-ghost', chosenClass: 'dnd-chosen', dragClass: 'dnd-drag',
        direction: 'vertical',
        group: { name:'children-local', pull:false, put:false },
        forceFallback: false, fallbackTolerance: 6,
        onStart, onEnd
      });
    });
  }

  /* ========= 4) حالة الاتساخ ========= */
  let committedAncestorsRawKey = '';
  let initialFormSnapshot = null;

  const renumberAncestorLabels = (markOrderDirty = false)=>{
    ancList.querySelectorAll('.ancestor-row').forEach((row,i)=>{
      const lab = row.querySelector('.ancestor-label');
      if (lab) lab.innerHTML = `<i class="fa-solid fa-grip-lines"></i> الجد ${getArabicOrdinal(i+1)}`;

      const changed = String(i+1)!==(row.dataset.initialIndex||String(i+1));
      row.dataset.orderDirty = (markOrderDirty && changed) ? '1' : '';

      if (!lab) return;
      ensureDirtyDot(lab);
      lab.classList.remove('dot-ok','dot-invalid');
      if (markOrderDirty){
        lab.classList.toggle('dirty-on', changed);
        lab.classList.toggle('dot-pending', changed);
        if (!changed) lab.classList.remove('dirty-on','dot-pending');
      } else {
        lab.classList.remove('dirty-on','dot-pending');
      }
    });
  };

  const updateAddAncestorBtnText = ()=>{
    const count = ancList.children.length;
    ensureBtnLabelSpan(ancAddBtn).textContent = `إضافة الجد ${getArabicOrdinal(count+1)}`;
  };
  const updateAddWifeBtnText = ()=>{
    const count = (modal.querySelectorAll('.wife-block')||[]).length;
    ensureBtnLabelSpan(addWifeBtn).textContent = count ? `إضافة الزوجة ${getArabicOrdinalF(count+1)}` : 'إضافة الزوجة';
  };

  /* ========= 5) بناء الواجهة ========= */
  const hasInitial = !!initialData;
  const existingFamily = !hasInitial && editKey ? getFamily(editKey) : null;

  if (!editKey && !initialData){
    wivesList.appendChild(createWifeBlock(1));
    ancList.appendChild(createAncestorItem('', 1));
    renumberAncestorLabels(false);
    updateAddAncestorBtnText();
    committedAncestorsRawKey = Form.makeAncestorsRawKey([]);
  } else {
    const f = initialData || existingFamily;
    if (f){
      modal.dataset.editKey = editKey || '';

      // يسار
         // تهيئة حقل تاريخ/سنة فقط مع دعم data-year-only و data-full-date
      const setDateOrYearInput = (el, dateVal, yearVal) => {
        if (!el) return;
        const y = (yearVal || '').trim();
        const d = (dateVal || '').trim() && dateVal !== '-' ? dateVal.trim() : '';

        if (y && !d){
          // سنة فقط
          el.dataset.yearOnly = y;
          el.dataset.fullDate = '';
          el.value = y; // قد تفرَّغ في type="date" لكن attachYearModeToggle سيعتمد على dataset
        } else {
          // تاريخ كامل (مع حفظ السنة داخليًا)
          el.dataset.fullDate = d;
          el.dataset.yearOnly = d ? d.slice(0,4) : (y || '');
          el.value = d;
        }
      };


         set('#newFamilyTitle')(f.title);
      set('#newRootPerson')(f.rootPerson?.name);

         const rbio = f.rootPerson?.bio || {};

      const rootBirthYear = rbio.birthYear ? String(rbio.birthYear).trim() : '';
      const rootBirthDateVal = (rbio.birthDate && rbio.birthDate !== '-') ? rbio.birthDate : '';

      const rootDeathYear = rbio.deathYear ? String(rbio.deathYear).trim() : '';
      const rootDeathDateVal = (rbio.deathDate && rbio.deathDate !== '-') ? rbio.deathDate : '';

      const rootBirthEl = formEl.querySelector('#newRootPersonBirthDate');
      const rootDeathEl = formEl.querySelector('#newRootPersonDeathDate');

      setDateOrYearInput(rootBirthEl, rootBirthDateVal, rootBirthYear);
      setDateOrYearInput(rootDeathEl, rootDeathDateVal, rootDeathYear);

      set('#newRootPersonBirthPlace')(rbio.birthPlace);

      // نص الإنجازات/الهوايات من المصفوفات أو من النص الخام إن وُجد (موحّد)
      const rootAchievementsText = joinTextList(rbio.achievements, rbio.achievementsTxt);
      const rootHobbiesText      = joinTextList(rbio.hobbies,      rbio.hobbiesTxt);

      set('#newRootPersonCognomen')(rbio.cognomen);
      set('#newRootPersonOccupation')(rbio.occupation);
      set('#newRootPersonRemark')(rbio.remark);
      set('#newRootPersonTribe')(rbio.tribe);
      set('#newRootPersonClan')(rbio.clan);
      set('#newRootPersonAchievements')(rootAchievementsText);
      set('#newRootPersonHobbies')(rootHobbiesText);

// الأم (مِيتا مثل الأب)
{
  const mb  = motherBlock;
  const rb  = f.rootPerson?.bio || {};

  // إنجازات/هوايات الأم (مصفوفة → نص) مع دعم النص الخام القديم
  const motherAchievementsText = joinTextList(rb.motherAchievements, rb.motherAchievementsTxt);
  const motherHobbiesText      = joinTextList(rb.motherHobbies,      rb.motherHobbiesTxt);


  // dataset كمصدر رئيسي
  mb.dataset.motherName         = (rb.motherName         || '').trim();
  mb.dataset.motherClan         = (rb.motherClan         || '').trim();
  mb.dataset.motherCognomen     = (rb.motherCognomen     || '').trim();
  mb.dataset.motherBirthDate    = (rb.motherBirthDate    || '').trim();
  mb.dataset.motherDeathDate    = (rb.motherDeathDate    || '').trim();
  mb.dataset.motherBirthPlace   = (rb.motherBirthPlace   || '').trim();
  mb.dataset.motherOccupation   = (rb.motherOccupation   || '').trim();
  mb.dataset.motherRemark       = (rb.motherRemark       || '').trim();
  mb.dataset.motherBrothers     = (rb.motherBrothersTxt  || '').trim();
  mb.dataset.motherSisters      = (rb.motherSistersTxt   || '').trim();
  mb.dataset.motherAchievements = motherAchievementsText;
  mb.dataset.motherHobbies      = motherHobbiesText;

  const setMb = (sel,val)=>{
    const el = mb.querySelector(sel);
    if (el) el.value = val || '';
  };

  setMb('.mother-name',         mb.dataset.motherName);
  setMb('.mother-clan',         mb.dataset.motherClan);
  setMb('.mother-cognomen',     mb.dataset.motherCognomen);
  setMb('.mother-birthDate',    mb.dataset.motherBirthDate);
  setMb('.mother-deathDate',    mb.dataset.motherDeathDate);
  setMb('.mother-birthPlace',   mb.dataset.motherBirthPlace);
  setMb('.mother-occupation',   mb.dataset.motherOccupation);
  setMb('.mother-remark',       mb.dataset.motherRemark);
  setMb('.mother-brothers',     mb.dataset.motherBrothers);
  setMb('.mother-sisters',      mb.dataset.motherSisters);
  setMb('.mother-achievements', mb.dataset.motherAchievements);
  setMb('.mother-hobbies',      mb.dataset.motherHobbies);

  // تثبيت الحالة في dataset + العرض (meta-grid) كبداية
  mb.commitFromInputs?.();
}

      // ⬅️ تحويل مصفوفات الإخوة/الأخوات إلى نص واحد (مع دعم النص الخام القديم)
      const brosText = joinNamesList(
        f.rootPerson?.bio?.siblingsBrothers,
        f.rootPerson?.bio?.brothersTxt
      );

      const sisText = joinNamesList(
        f.rootPerson?.bio?.siblingsSisters,
        f.rootPerson?.bio?.sistersTxt
      );


      set('#newRootPersonBrothers')(brosText);
      set('#newRootPersonSisters')(sisText);

      // الأب
      {
        const fb = fatherBlock, F = f?.father || {}, B = F?.bio || {};
        fb.dataset.fatherName       = (F.name || '').trim();
        fb.dataset.fatherCognomen   = (B.cognomen || '').trim();

        const fatherBirthYear    = B.birthYear ? String(B.birthYear).trim() : '';
        const fatherBirthDateVal = (B.birthDate && B.birthDate !== '-') ? B.birthDate : '';
        const fatherDeathYear    = B.deathYear ? String(B.deathYear).trim() : '';
        const fatherDeathDateVal = (B.deathDate && B.deathDate !== '-') ? B.deathDate : '';

        // تُخزَّن آخر قيمة معروفة (سنة أو تاريخ) في dataset كمرجع منطقي
        fb.dataset.fatherBirthDate  = fatherBirthDateVal || fatherBirthYear;
        fb.dataset.fatherDeathDate  = fatherDeathDateVal || fatherDeathYear;
        fb.dataset.fatherBirthPlace = (B.birthPlace || '').trim();
        fb.dataset.fatherOccupation = (B.occupation || '').trim();
        fb.dataset.fatherRemark     = (B.remark || '').trim();
         // تحويل إخوة/أخوات الأب من المصفوفات إلى نص واحد
            const fatherBrosText = joinNamesList(B.siblingsBrothers, B.brothersTxt);
        const fatherSisText  = joinNamesList(B.siblingsSisters,  B.sistersTxt);

        // 🔹 إنجازات/هوايات الأب (مصفوفة → نص) مع دعم النص الخام القديم
        const fatherAchievementsText = joinTextList(B.achievements, B.achievementsTxt);
        const fatherHobbiesText      = joinTextList(B.hobbies,      B.hobbiesTxt);


        fb.dataset.fatherBrothers      = fatherBrosText;
        fb.dataset.fatherSisters       = fatherSisText;
        fb.dataset.fatherAchievements  = fatherAchievementsText;
        fb.dataset.fatherHobbies       = fatherHobbiesText;

        const setFb = (sel, val) => { const el = fb.querySelector(sel); if (el) el.value = val; };

        setFb('.father-name'        , fb.dataset.fatherName);
        setFb('.father-cognomen'    , fb.dataset.fatherCognomen);
        setFb('.father-brothers'    , fb.dataset.fatherBrothers);
        setFb('.father-sisters'     , fb.dataset.fatherSisters);
        setFb('.father-achievements', fb.dataset.fatherAchievements);
        setFb('.father-hobbies'     , fb.dataset.fatherHobbies);


        const birthInput = fb.querySelector('.father-birthDate');
        const deathInput = fb.querySelector('.father-deathDate');

        // تهيئة yearOnly/fullDate على مستوى الحقل
        setDateOrYearInput(birthInput, fatherBirthDateVal, fatherBirthYear);
        setDateOrYearInput(deathInput, fatherDeathDateVal, fatherDeathYear);

        // ⬅️ مهم: في حالة "سنة فقط" اجعل الحقل نصّيًا حتى لا يمسح المتصفح القيمة
        if (!fatherBirthDateVal && fatherBirthYear && birthInput) {
          birthInput.type  = 'text';
          birthInput.value = fatherBirthYear;
        }
        if (!fatherDeathDateVal && fatherDeathYear && deathInput) {
          deathInput.type  = 'text';
          deathInput.value = fatherDeathYear;
        }

        setFb('.father-birthPlace', fb.dataset.fatherBirthPlace);
        setFb('.father-occupation', fb.dataset.fatherOccupation);
        setFb('.father-remark'    , fb.dataset.fatherRemark);

        // ⬅️ الآن commitFromInputs يكتب السنة أو التاريخ الصحيح إلى row.dataset
        fatherBlock.commitFromInputs?.();
      }

      // الأجداد
      ancList.innerHTML = '';
      const anc = Array.isArray(f.ancestors) ? Form.normalizeAncestors(f.ancestors) : [];
      anc.forEach((a,i)=>{
        const r  = createAncestorItem(a?.name||'', i+1);
        const ab = a?.bio || {};

        const ancBirthYear    = ab.birthYear ? String(ab.birthYear).trim() : '';
        const ancBirthDateVal = (ab.birthDate && ab.birthDate !== '-') ? ab.birthDate : '';
        const ancDeathYear    = ab.deathYear ? String(ab.deathYear).trim() : '';
        const ancDeathDateVal = (ab.deathDate && ab.deathDate !== '-') ? ab.deathDate : '';

        const ancNameEl  = r.querySelector('.ancestor-name');
        const ancBirthEl = r.querySelector('.ancestor-birthDate');
        const ancDeathEl = r.querySelector('.ancestor-deathDate');

        if (ancNameEl) ancNameEl.value = a?.name || '';

        setDateOrYearInput(ancBirthEl, ancBirthDateVal, ancBirthYear);
        setDateOrYearInput(ancDeathEl, ancDeathDateVal, ancDeathYear);

        // ⬅️ في حالة "سنة فقط" غيِّر نوع الحقل مؤقتًا إلى نص حتى تُحفَظ السنة بشكل صحيح
        if (ancBirthEl && !ancBirthDateVal && ancBirthYear){
          ancBirthEl.type  = 'text';
          ancBirthEl.value = ancBirthYear;
        }
        if (ancDeathEl && !ancDeathDateVal && ancDeathYear){
          ancDeathEl.type  = 'text';
          ancDeathEl.value = ancDeathYear;
        }

        r.querySelector('.ancestor-birthPlace').value = ab.birthPlace || '';
        r.querySelector('.ancestor-occupation').value = ab.occupation || '';
        r.querySelector('.ancestor-cognomen').value   = ab.cognomen   || '';
        r.querySelector('.ancestor-remark').value     = ab.remark     || '';

        // 🔹 إنجازات/هوايات الجد (مصفوفة → نص) مع دعم النص الخام
        const achievementsText = joinTextList(ab.achievements, ab.achievementsTxt);
        const hobbiesText      = joinTextList(ab.hobbies,      ab.hobbiesTxt);


        const achInp = r.querySelector('.ancestor-achievements');
        const hobInp = r.querySelector('.ancestor-hobbies');
        if (achInp) achInp.value = achievementsText;
        if (hobInp) hobInp.value = hobbiesText;

        r.querySelector('.save-ancestor-btn')?.click(); // تثبيت المعاينة (يحدّث الـ dataset + الـ preview)
        ancList.appendChild(r);
      });

      renumberAncestorLabels(false); updateAddAncestorBtnText();
      committedAncestorsRawKey = Form.makeAncestorsRawKey(anc.map(a=>a.name||''));

// الزوجات + الأبناء
wivesList.innerHTML = '';
(f.wives || []).forEach((w,i)=>{
  const block = createWifeBlock(i+1);
  const wb = w.bio || {};
  // هل يوجد بيانات فعلية لأب/أم الزوجة؟
  const hasWifeFatherMeta =
    (wb.fatherName       || '').trim() ||
    (wb.fatherCognomen   || '').trim() ||
    (wb.fatherBirthDate  || '').trim() ||
    (wb.fatherDeathDate  || '').trim() ||
    (wb.fatherBirthPlace || '').trim() ||
    (wb.fatherOccupation || '').trim() ||
    (wb.fatherRemark     || '').trim() ||
    (wb.fatherClan       || '').trim();

  const hasWifeMotherMeta =
    (wb.motherName       || '').trim() ||
    (wb.motherCognomen   || '').trim() ||
    (wb.motherBirthDate  || '').trim() ||
    (wb.motherDeathDate  || '').trim() ||
    (wb.motherBirthPlace || '').trim() ||
    (wb.motherOccupation || '').trim() ||
    (wb.motherRemark     || '').trim() ||
    (wb.motherClan       || '').trim();

  block.querySelector('.wife-name').value = w.name || '';

  // 1) تخزين ميتا أب/أم الزوجة في dataset (الحالة "المثبتة")
  // أب الزوجة
  fillDatasetFromSource(block.dataset, wb, {
    wifeFatherName:         s => s.fatherName,
    wifeFatherCognomen:     s => s.fatherCognomen,
    wifeFatherBirthDate:    s => s.fatherBirthDate,
    wifeFatherDeathDate:    s => s.fatherDeathDate,
    wifeFatherBirthPlace:   s => s.fatherBirthPlace,
    wifeFatherOccupation:   s => s.fatherOccupation,
    wifeFatherRemark:       s => s.fatherRemark,
    wifeFatherClan:         s => s.fatherClan,
    wifeFatherBrothers:     s => s.fatherBrothersTxt,
    wifeFatherSisters:      s => s.fatherSistersTxt,
    wifeFatherAchievements: s => joinTextList(s.fatherAchievements, s.fatherAchievementsTxt),
    wifeFatherHobbies:      s => joinTextList(s.fatherHobbies,      s.fatherHobbiesTxt)
  });

  // أم الزوجة
  fillDatasetFromSource(block.dataset, wb, {
    wifeMotherName:         s => s.motherName,
    wifeMotherCognomen:     s => s.motherCognomen,
    wifeMotherBirthDate:    s => s.motherBirthDate,
    wifeMotherDeathDate:    s => s.motherDeathDate,
    wifeMotherBirthPlace:   s => s.motherBirthPlace,
    wifeMotherOccupation:   s => s.motherOccupation,
    wifeMotherRemark:       s => s.motherRemark,
    wifeMotherClan:         s => s.motherClan,
    wifeMotherBrothers:     s => s.motherBrothersTxt,
    wifeMotherSisters:      s => s.motherSistersTxt,
    wifeMotherAchievements: s => joinTextList(s.motherAchievements, s.motherAchievementsTxt),
    wifeMotherHobbies:      s => joinTextList(s.motherHobbies,      s.motherHobbiesTxt)
  });

  // 2) تعبئة الحقول من dataset (وليس مباشرة من wb)
  // أب الزوجة
  fillInputsFromDataset(block, block.dataset, {
    '.wife-father':              'wifeFatherName',
    '.wife-father-cognomen':     'wifeFatherCognomen',
    '.wife-father-birthDate':    'wifeFatherBirthDate',
    '.wife-father-deathDate':    'wifeFatherDeathDate',
    '.wife-father-birthPlace':   'wifeFatherBirthPlace',
    '.wife-father-occupation':   'wifeFatherOccupation',
    '.wife-father-remark':       'wifeFatherRemark',
    '.wife-father-clan':         'wifeFatherClan',
    '.wife-father-brothers':     'wifeFatherBrothers',
    '.wife-father-sisters':      'wifeFatherSisters',
    '.wife-father-achievements': 'wifeFatherAchievements',
    '.wife-father-hobbies':      'wifeFatherHobbies'
  });

  // أم الزوجة
  fillInputsFromDataset(block, block.dataset, {
    '.wife-mother':              'wifeMotherName',
    '.wife-mother-cognomen':     'wifeMotherCognomen',
    '.wife-mother-birthDate':    'wifeMotherBirthDate',
    '.wife-mother-deathDate':    'wifeMotherDeathDate',
    '.wife-mother-birthPlace':   'wifeMotherBirthPlace',
    '.wife-mother-occupation':   'wifeMotherOccupation',
    '.wife-mother-remark':       'wifeMotherRemark',
    '.wife-mother-clan':         'wifeMotherClan',
    '.wife-mother-brothers':     'wifeMotherBrothers',
    '.wife-mother-sisters':      'wifeMotherSisters',
    '.wife-mother-achievements': 'wifeMotherAchievements',
    '.wife-mother-hobbies':      'wifeMotherHobbies'
  });


  // إذا كانت هناك بيانات لأب/أم الزوجة ⇒ ثبّت وضع المعاينة مثل الأب/الأم/الأجداد
  if (hasWifeFatherMeta) {
    // زر الحفظ داخل بلوك أب الزوجة
    block.querySelector('.save-father-btn')?.click();
  }

  if (hasWifeMotherMeta) {
    // زر الحفظ داخل بلوك أم الزوجة (يدعم أكثر من تسمية محتملة للزر)
    const motherSaveBtn = block.querySelector(
      '.save-wife-mother-btn, .save-mother-btn, .wife-mother-save-btn'
    );
    motherSaveBtn?.click();
  }

  block.querySelector('.wife-tribe').value = wb.tribe || '';
  block.querySelector('.wife-clan').value  = wb.clan  || '';

  // إخوة/أخوات الزوجة (مصفوفة {name} → نص) مع دعم النص الخام القديم
  const wifeBroText = joinNamesList(wb.siblingsBrothers, wb.brothersTxt);
  const wifeSisText = joinNamesList(wb.siblingsSisters,  wb.sistersTxt);

  const brosInput = block.querySelector('.wife-brothers');
  const sisInput  = block.querySelector('.wife-sisters');
  if (brosInput) brosInput.value = wifeBroText;
  if (sisInput)  sisInput.value  = wifeSisText;


        const wifeBirthYear    = wb.birthYear ? String(wb.birthYear).trim() : '';
        const wifeBirthDateVal = (wb.birthDate && wb.birthDate !== '-') ? wb.birthDate : '';
        const wifeDeathYear    = wb.deathYear ? String(wb.deathYear).trim() : '';
        const wifeDeathDateVal = (wb.deathDate && wb.deathDate !== '-') ? wb.deathDate : '';

        setDateOrYearInput(block.querySelector('.wife-birthDate'), wifeBirthDateVal, wifeBirthYear);
        setDateOrYearInput(block.querySelector('.wife-deathDate'), wifeDeathDateVal, wifeDeathYear);


        block.querySelector('.wife-birthPlace').value    = w.bio?.birthPlace || '';
        block.querySelector('.wife-cognomen').value      = w.bio?.cognomen || '';
        block.querySelector('.wife-occupation').value    = w.bio?.occupation || '';
        block.querySelector('.wife-remark').value        = w.bio?.remark || '';
  // إنجازات/هوايات الزوجة (مصفوفة → نص) مع دعم النص الخام القديم
  const wifeAchievementsText = joinTextList(wb.achievements, wb.achievementsTxt);
  const wifeHobbiesText      = joinTextList(wb.hobbies,      wb.hobbiesTxt);


  const wAchInput = block.querySelector('.wife-achievements');
  const wHobInput = block.querySelector('.wife-hobbies');
  if (wAchInput) wAchInput.value = wifeAchievementsText;
  if (wHobInput) wHobInput.value = wifeHobbiesText;

        const list = block.querySelector('.children-list-editor');
          (w.children||[]).forEach(c=>{
          const li = createChildEditItem(c.name||'', c.role||'ابن', c._id || null);
                 if (c.bio){
            const cb = c.bio || {};

            const childBirthYear    = cb.birthYear ? String(cb.birthYear).trim() : '';
            const childBirthDateVal = (cb.birthDate && cb.birthDate !== '-') ? cb.birthDate : '';
            const childDeathYear    = cb.deathYear ? String(cb.deathYear).trim() : '';
            const childDeathDateVal = (cb.deathDate && cb.deathDate !== '-') ? cb.deathDate : '';

            li.dataset.childBirthDate   = childBirthDateVal || childBirthYear;
            li.dataset.childDeathDate   = childDeathDateVal || childDeathYear; 
            li.dataset.childBirthPlace  = cb.birthPlace || '';
            li.dataset.childCognomen    = cb.cognomen || '';
            li.dataset.childOccupation  = cb.occupation || '';
            li.dataset.childRemark      = cb.remark || '';

                 // إنجازات/هوايات الطفل (مصفوفة → نص) مع دعم النص الخام
            const childAchievementsText = joinTextList(cb.achievements, cb.achievementsTxt);
            const childHobbiesText      = joinTextList(cb.hobbies,      cb.hobbiesTxt);


            li.dataset.childAchievements = childAchievementsText;
            li.dataset.childHobbies      = childHobbiesText;
          }

          li.updateFromDataset?.();


          // بعد أن تُنسخ dataset → الحقول، ضبط وضع السنة/التاريخ على المدخلات نفسها
          const bInp = li.querySelector('.child-edit-birthDate');
          const dInp = li.querySelector('.child-edit-deathDate');
          const cb = c.bio || {};
          const childBirthYear    = cb.birthYear ? String(cb.birthYear).trim() : '';
          const childBirthDateVal = (cb.birthDate && cb.birthDate !== '-') ? cb.birthDate : '';
          const childDeathYear    = cb.deathYear ? String(cb.deathYear).trim() : '';
          const childDeathDateVal = (cb.deathDate && cb.deathDate !== '-') ? cb.deathDate : '';

          setDateOrYearInput(bInp, childBirthDateVal, childBirthYear);
          setDateOrYearInput(dInp, childDeathDateVal, childDeathYear);

          list.appendChild(li);
        });

        wivesList.appendChild(block);
        updateChildrenCount(block);
        wireChildrenDnD(block);
        initChildrenOrderBaselines(block);
        refreshChildrenOrderDirty(list);
      });
    }
  }

  updateAddWifeBtnText();
  wireAncestorsDnD();
  wireChildrenDnD();

  // ⬅️ تفعيل نظام (تاريخ كامل / سنة فقط) بعد تعبئة جميع القيم (ميلاد/وفاة الجذر، الأب، الأجداد، الزوجات، الأبناء)
  initYearOnlyToggles(modal);

  // اللقطة الأولى + baseline بعد استقرار وضع الحقول (سنة/تاريخ)
  initialFormSnapshot = computeSnapshot();
  committedAncestorsRawKey = initialFormSnapshot.ancKey;
  modal.resetDirtyIndicators?.();
  checkDirty();


  /* ========= 6) أحداث الأجداد ========= */
ancAddBtn.addEventListener('click', ()=>{
  const row = createAncestorItem('', ancList.children.length + 1);
  ancList.appendChild(row);

  // ⬅️ تفعيل زر "السنة فقط" لحقول الميلاد/الوفاة في هذا الجد الجديد
  initYearOnlyToggles(row);

  renumberAncestorLabels(true);
  updateAddAncestorBtnText();
  checkDirty();

  setTimeout(()=> row.querySelector('.ancestor-name')?.focus(), 0);
});


  ancList.addEventListener('click', (e)=>{
    const row = e.target.closest('.ancestor-row'); if (!row) return;

    if (e.target.closest('.remove-ancestor')){
      const idx = Array.from(ancList.children).indexOf(row)+1;
      const ord = getArabicOrdinal(idx);
      const nm  = (row.querySelector('.ancestor-name')?.value || '').trim() || `الجد ${ord}`;
      showConfirmModal({ title:`حذف الجد: ${ord}`, message:`هل أنت متأكد من حذف "${nm}"؟`, variant:'danger', defaultFocus:'confirm' })
        .then(ok=>{
          if (!ok) return;
          row.remove();
          renumberAncestorLabels(false); updateAddAncestorBtnText();
           showInfo(`تم حذف الجد: ${ord} «${highlight(nm)}»`);


          checkDirty();
        });
      return;
    }

    if (e.target.closest('.move-up')){
      const idxBefore = Array.from(ancList.children).indexOf(row)+1;
      const prev = row.previousElementSibling;
      const nm = (row.querySelector('.ancestor-name')?.value || '').trim();
      if (!prev) return notifyNoChange({ scope:'ancestor', name:nm, index:idxBefore });
      ancList.insertBefore(row, prev);
      const idxAfter = idxBefore - 1;
      renumberAncestorLabels(true); updateAddAncestorBtnText(); checkDirty();
      notifyMove({ scope:'ancestor', name:nm, from:idxBefore, to:idxAfter, ordIndex:idxBefore });
      return;
    }

    if (e.target.closest('.move-down')){
      const idxBefore = Array.from(ancList.children).indexOf(row)+1;
      const next = row.nextElementSibling;
      const nm = (row.querySelector('.ancestor-name')?.value || '').trim();
      if (!next) return notifyNoChange({ scope:'ancestor', name:nm, index:idxBefore });
      ancList.insertBefore(row, next.nextSibling);
      const idxAfter = idxBefore + 1;
      renumberAncestorLabels(true); updateAddAncestorBtnText(); checkDirty();
      notifyMove({ scope:'ancestor', name:nm, from:idxBefore, to:idxAfter, ordIndex:idxBefore });
    }
  });

  /* ========= 7) الزوجات والأبناء ========= */
addWifeBtn.addEventListener('click', ()=>{
  const count = wivesList.querySelectorAll('.wife-block').length;
  const block = createWifeBlock(count + 1);
  wivesList.appendChild(block);

  // ⬅️ تفعيل زر "السنة فقط" لحقول ميلاد/وفاة الزوجة الجديدة
  initYearOnlyToggles(block);

  updateAddWifeBtnText();
  updateChildrenCount(block);
  wireChildrenDnD(block);
  checkDirty();
  block.querySelector('.wife-name')?.focus();
});


  wivesList.addEventListener('click', (e)=>{
    const w = e.target.closest('.wife-block'); if (!w) return;
    const list = w.querySelector('.children-list-editor');
    const editorWrap = w.querySelector('.children-editor');
    const addArea = w.querySelector('.children-add');
    // حفظ ميتا أب الزوجة → dataset (باستخدام Helper عام)
    if (e.target.closest('.save-father-btn')){
      fillDatasetFromInputs(w, w.dataset, {
        '.wife-father':              'wifeFatherName',
        '.wife-father-cognomen':     'wifeFatherCognomen',
        '.wife-father-birthDate':    'wifeFatherBirthDate',
        '.wife-father-deathDate':    'wifeFatherDeathDate',
        '.wife-father-birthPlace':   'wifeFatherBirthPlace',
        '.wife-father-occupation':   'wifeFatherOccupation',
        '.wife-father-remark':       'wifeFatherRemark',
        '.wife-father-clan':         'wifeFatherClan',
        '.wife-father-brothers':     'wifeFatherBrothers',
        '.wife-father-sisters':      'wifeFatherSisters',
        '.wife-father-achievements': 'wifeFatherAchievements',
        '.wife-father-hobbies':      'wifeFatherHobbies'
      });

      checkDirty();
      return;
    }

    // حفظ ميتا أم الزوجة → dataset
    if (e.target.closest('.save-wife-mother-btn, .save-mother-btn, .wife-mother-save-btn')){
      fillDatasetFromInputs(w, w.dataset, {
        '.wife-mother':              'wifeMotherName',
        '.wife-mother-cognomen':     'wifeMotherCognomen',
        '.wife-mother-birthDate':    'wifeMotherBirthDate',
        '.wife-mother-deathDate':    'wifeMotherDeathDate',
        '.wife-mother-birthPlace':   'wifeMotherBirthPlace',
        '.wife-mother-occupation':   'wifeMotherOccupation',
        '.wife-mother-remark':       'wifeMotherRemark',
        '.wife-mother-clan':         'wifeMotherClan',
        '.wife-mother-brothers':     'wifeMotherBrothers',
        '.wife-mother-sisters':      'wifeMotherSisters',
        '.wife-mother-achievements': 'wifeMotherAchievements',
        '.wife-mother-hobbies':      'wifeMotherHobbies'
      });

      checkDirty();
      return;
    }

    // أسهم الترتيب + إزالة ابن
    const childLi = e.target.closest('.child-item');
    if (childLi){
      if (e.target.closest('.child-move-up, .move-up'))   return childLi.dispatchEvent(new Event('child:moveUp', { bubbles:true }));
      if (e.target.closest('.child-move-down, .move-down'))return childLi.dispatchEvent(new Event('child:moveDown',{ bubbles:true }));
      if (e.target.closest('.remove-child-btn, .child-remove, .remove-child'))
        return childLi.dispatchEvent(new Event('child:remove', { bubbles:true }));
    }

    if (e.target.closest('.remove-wife-btn')){
      const nm  = (w.querySelector('.wife-name')?.value || '').trim();
      const idx = Array.from(wivesList.querySelectorAll('.wife-block')).indexOf(w) + 1;
      const ord = getArabicOrdinalF(idx);
      const confirmLabel = `الزوجة ${ord}` + (nm ? ` «${nm}»` : '');

      showConfirmModal({
        title:'حذف الزوجة',
        message:`حذف ${confirmLabel} وكل أبنائها؟`,
        variant:'danger',
        defaultFocus:'confirm'
      }).then(ok=>{
        if (!ok) return;

        w.remove();
        wivesList.querySelectorAll('.wife-block').forEach((b,i)=>{
          const t = b.querySelector('.wife-title');
          if (t) t.innerHTML = `الزوجة ${getArabicOrdinalF(i+1)} <span class="req">*</span>`;
        });

        updateAddWifeBtnText();
        checkDirty();

        const infoLabelHtml = `الزوجة ${ord}` + (nm ? ` «${highlight(nm)}»` : '');
        showInfo(`تم حذف ${infoLabelHtml} مع جميع أبنائها.`);
      });

      return;
    }


    if (e.target.closest('.add-children-btn')){
      addArea.style.display = addArea.style.display === 'none' ? '' : 'none';
      addArea.querySelector('.child-name-input')?.focus();
      return;
    }

    if (e.target.closest('.remove-all-children-btn')){
      if (!list.children.length) return showInfo('لا يوجد أبناء للحذف.');
      showConfirmModal({ title:'حذف جميع الأبناء', message:'لا يمكن التراجع.', variant:'danger', defaultFocus:'confirm' })
        .then(ok=>{
          if (!ok) return;
          list.innerHTML = '';
          editorWrap.style.display = 'none';
          updateChildrenCount(w);
          showSuccess('تم حذف جميع الأبناء.');
          checkDirty();
        });
      return;
    }

     if (e.target.closest('.add-child-inline-btn')){
      const name = (w.querySelector('.child-name-input')?.value || '').trim();
      const role = (w.querySelector('.child-role-input')?.value || 'ابن').trim();
      if (!name){
        showInfo('أدخل اسم الطفل أولاً.');
        w.querySelector('.child-name-input')?.focus();
        return;
      }

      const li = createChildEditItem(name, role, null);

      // ⬅️ القيم الأساسية للطفل الجديد (تُحفظ في dataset)
      li.dataset.childBirthDate   = (w.querySelector('.child-birthDate-input')?.value   || '').trim();
      li.dataset.childDeathDate   = (w.querySelector('.child-deathDate-input')?.value   || '').trim();
      li.dataset.childBirthPlace  = (w.querySelector('.child-birthPlace-input')?.value  || '').trim();
      li.dataset.childOccupation  = (w.querySelector('.child-occupation-input')?.value  || '').trim();
      li.dataset.childCognomen    = (w.querySelector('.child-cognomen-input')?.value    || '').trim();
      li.dataset.childRemark      = (w.querySelector('.child-remark-input')?.value      || '').trim();

      // ⬅️ نص الإنجازات والهوايات للطفل الجديد (خام، مفصول بفواصل)
      li.dataset.childAchievements = (w.querySelector('.child-achievements-input')?.value || '').trim();
      li.dataset.childHobbies      = (w.querySelector('.child-hobbies-input')?.value      || '').trim();

      // نسخ dataset → مدخلات محرر الطفل وتحديث المعاينة
      li.updateFromDataset?.();

      // ⬅️ تفعيل زر "السنة فقط" لحقول ميلاد/وفاة هذا الطفل الجديد
      initYearOnlyToggles(li);

      list.appendChild(li);
      editorWrap.style.display = '';
      updateChildrenCount(w);
      initChildrenOrderBaselines(w);
      refreshChildrenOrderDirty(list);

      // تنظيف حقول الإدخال السريعة بعد الإضافة
      w.querySelector('.child-name-input').value = '';
      [
        '.child-birthDate-input',
        '.child-deathDate-input',
        '.child-birthPlace-input',
        '.child-occupation-input',
        '.child-cognomen-input',
        '.child-remark-input',
        '.child-achievements-input',
        '.child-hobbies-input'
      ].forEach(sel => {
        const x = w.querySelector(sel);
        if (x) x.value = '';
      });

      checkDirty();
    }

  });

  // تفويض أحداث عنصر الطفل
  wivesList.addEventListener('child:remove', (e)=>{
    const li = e.target.closest('.child-item'); const w = e.target.closest('.wife-block');
    const list = w?.querySelector('.children-list-editor');
    li?.remove();
    updateChildrenCount(w);
    initChildrenOrderBaselines(w);
    if (list){ refreshChildrenOrderDirty(list); if (!list.children.length) w.querySelector('.children-editor').style.display='none'; }
    checkDirty();
  });

  wivesList.addEventListener('child:moveUp', (e)=>{
    const li = e.target.closest('.child-item'); if (!li) return;
    const list = li.parentElement;
    const idxBefore = Array.from(list.children).indexOf(li)+1;
    const prev = li.previousElementSibling;
    const name = (li.dataset.childName || '').trim();
    const role = (li.dataset.childRole || '').trim();
    if (!prev) return notifyNoChange({ scope:'child', name, role });
    list.insertBefore(li, prev);
    const idxAfter = idxBefore - 1;

    updateChildrenCount(li.closest('.wife-block'));
    [idxAfter-1, idxBefore-1].forEach(i=>{
      const it = list.children[i]; const t = it?.querySelector('.child-title');
      if (t){ ensureDirtyDot(t); t.classList.add('dirty-on','dot-pending'); t.classList.remove('dot-ok','dot-invalid'); }
    });
    refreshChildrenOrderDirty(list);
    notifyMove({ scope:'child', name, role, from:idxBefore, to:idxAfter });
    checkDirty();
  });

  wivesList.addEventListener('child:moveDown', (e)=>{
    const li = e.target.closest('.child-item'); if (!li) return;
    const list = li.parentElement;
    const idxBefore = Array.from(list.children).indexOf(li) + 1;
    const next = li.nextElementSibling;
    const name = (li.dataset.childName || '').trim();
    const role = (li.dataset.childRole || '').trim();
    if (!next) return notifyNoChange({ scope:'child', name, role, index: idxBefore });
    list.insertBefore(li, next.nextSibling);
    const idxAfter = idxBefore + 1;

    updateChildrenCount(li.closest('.wife-block'));
    [idxBefore-1, idxAfter-1].forEach(i=>{
      const it = list.children[i]; const t = it?.querySelector('.child-title');
      if (t){ ensureDirtyDot(t); t.classList.add('dirty-on','dot-pending'); t.classList.remove('dot-ok','dot-invalid'); }
    });
    refreshChildrenOrderDirty(list);
    notifyMove({ scope:'child', name, role, from:idxBefore, to:idxAfter });
    checkDirty();
  });

  /* ========= 8) عدّاد الأبناء المحلي ========= */
  function updateChildrenCount(wrap){
    if (!wrap) return;
    try { updateChildrenCountView?.(wrap); } catch {}
  }

  /* ========= 9) لقطة النموذج + فحص الاتساخ ========= */
  function computeSnapshot(){
    const { formFields, wives, ancestors, father } = readUI();
    const ancKey = Form.makeAncestorsRawKey(ancestors.map(a=>a.name));
    return Form.computeFormSnapshot({ formFields, wives, ancestors, father, ancKey });
  }
  function checkDirty(){
    const snap = computeSnapshot();
    const dirty = (snap.ancKey !== committedAncestorsRawKey) || (JSON.stringify(snap) !== JSON.stringify(initialFormSnapshot));
    labelSpan.textContent = dirty ? 'حفظ التعديلات' : 'حفظ العائلة';
    submitBtn.classList.toggle('save-dirty', dirty);
  }
  formEl.addEventListener('input', checkDirty);
  formEl.addEventListener('change', checkDirty);
  new MutationObserver(checkDirty).observe(wivesList, { childList:true, subtree:true });
  new MutationObserver(()=>{ renumberAncestorLabels(false); updateAddAncestorBtnText(); checkDirty(); })
    .observe(ancList, { childList:true, subtree:false });

  /* ========= 10) إغلاق مؤكد ========= */
  function isFormDirty(){
    const snap = computeSnapshot();
    return (snap.ancKey !== committedAncestorsRawKey) || (JSON.stringify(snap) !== JSON.stringify(initialFormSnapshot));
  }
  function requestClose(){
    if (!isFormDirty()) {
      disposeDirtyIndicators(modal);
      ModalManager.close(modal);
      openerEl?.focus();
      onCancel?.();
      return;
    }
    showConfirmModal({
      title: 'إغلاق دون حفظ؟',
      message: 'هناك تعديلات غير محفوظة.',
      variant: 'danger',
      defaultFocus: 'cancel',
      _ariaRole: 'alertdialog'
    }).then(ok => {
      if (!ok) return;
      disposeDirtyIndicators(modal);
      ModalManager.close(modal);
      openerEl?.focus();
      onCancel?.();
    });
  }

  // Hook للـ Escape داخل ModalManager: إن وُجد يُستدعى بدل الإغلاق المباشر
  modal.__onEscapeHook = requestClose;

  modal.addEventListener('click', e=>{ if (e.target === modal) requestClose(); });

  const closeBtn = modal.querySelector('#closeAddFamily');
  closeBtn.addEventListener('click', requestClose);
  closeBtn.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
  closeBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); }, { passive:false });
  modal.querySelector('#cancelAddFamily').addEventListener('click', requestClose);

  /* ========= 11) قراءة واجهة → بيانات نقية ========= */
  function readUI(){
  const ff = sel => (formEl.querySelector(sel)?.value || '').trim();

  // قراءة ميتا أم صاحب الشجرة من بلوك الأم (مع fallback على الحقول القديمة إن وُجدت)
  const motherMeta = (() => {
    const mb = motherBlock;
    if (!mb) {
      return {
        name: ff('#newMother'),
        clan: ff('#newMotherClan'),
        birthDate: '',
        deathDate: '',
        birthPlace: '',
        occupation: '',
        cognomen: '',
        remark: '',
        brothersTxt: '',
        sistersTxt: '',
        achievementsTxt: '',
        hobbiesTxt: ''
      };
    }
    return {
      name:        (mb.dataset.motherName         || ff('#newMother')      || '').trim(),
      clan:        (mb.dataset.motherClan         || ff('#newMotherClan')  || '').trim(),
      birthDate:   (mb.dataset.motherBirthDate    || '').trim(),
      deathDate:   (mb.dataset.motherDeathDate    || '').trim(),
      birthPlace:  (mb.dataset.motherBirthPlace   || '').trim(),
      occupation:  (mb.dataset.motherOccupation   || '').trim(),
      cognomen:    (mb.dataset.motherCognomen     || '').trim(),
      remark:      (mb.dataset.motherRemark       || '').trim(),
      brothersTxt: (mb.dataset.motherBrothers     || '').trim(),
      sistersTxt:  (mb.dataset.motherSisters      || '').trim(),
      achievementsTxt: (mb.dataset.motherAchievements || '').trim(),
      hobbiesTxt:      (mb.dataset.motherHobbies      || '').trim()
    };
  })();


  const formFields = {
    title: ff('#newFamilyTitle'),
    rootName: ff('#newRootPerson'),
    rootBirthDate: ff('#newRootPersonBirthDate'),
    rootDeathDate: ff('#newRootPersonDeathDate'),
    rootBirthPlace: ff('#newRootPersonBirthPlace'),
    rootCognomen:   ff('#newRootPersonCognomen'),
    rootOccupation: ff('#newRootPersonOccupation'),
    rootRemark:     ff('#newRootPersonRemark'),

    // نص الإنجازات والهوايات لصاحب الشجرة (مفصول بفواصل)
    rootAchievementsTxt: ff('#newRootPersonAchievements'),
    rootHobbiesTxt:      ff('#newRootPersonHobbies'),

    rootTribe: ff('#newRootPersonTribe'),
    rootClan:  ff('#newRootPersonClan'),

    // أم صاحب الشجرة
    motherName: motherMeta.name,
    motherClan: motherMeta.clan,
    rootMotherBirthDate:  motherMeta.birthDate,
    rootMotherDeathDate:  motherMeta.deathDate,
    rootMotherBirthPlace: motherMeta.birthPlace,
    rootMotherOccupation: motherMeta.occupation,
    rootMotherCognomen:   motherMeta.cognomen,
    rootMotherRemark:     motherMeta.remark,
    rootMotherBrothersTxt: motherMeta.brothersTxt,
    rootMotherSistersTxt:  motherMeta.sistersTxt,
rootMotherAchievementsTxt: motherMeta.achievementsTxt,
    rootMotherHobbiesTxt:      motherMeta.hobbiesTxt,
    brothersTxt: ff('#newRootPersonBrothers'),
    sistersTxt: ff('#newRootPersonSisters'),
    editKey
  };

const ancestors = Array.from(ancList.querySelectorAll('.ancestor-row')).map(r=>({
  name: (r.dataset.ancestorName||'').trim(),
  bio: {
    birthDate:  (r.dataset.ancestorBirthDate||'').trim(),
    deathDate:  (r.dataset.ancestorDeathDate||'').trim(),
    birthPlace: (r.dataset.ancestorBirthPlace||'').trim(),
    occupation: (r.dataset.ancestorOccupation||'').trim(),
    cognomen:   (r.dataset.ancestorCognomen||'').trim(),
    remark:     (r.dataset.ancestorRemark||'').trim(),

    // نصوص الإنجازات والهوايات (تفصل لاحقًا إلى مصفوفات)
    achievementsTxt: (r.dataset.ancestorAchievements||'').trim(),
    hobbiesTxt:      (r.dataset.ancestorHobbies||'').trim()
  }
})).filter(a=>a.name);

  /* أداة قراءة تاريخ/سنة طفل واحد مع دعم yearOnly/fullDate
     مع تفضيل القيمة المحفوظة في dataset (آخر حالة تم حفظها في الموديل) */
  function readChildDate(ci, inputSelector, datasetKey){
    // 1) القيمة المحفوظة في dataset ← هي المرجع الأساسي للـ snapshot
    const ds = (ci.dataset[datasetKey] || '').trim();
    if (ds) return ds;

    // 2) إن لم يكن لدينا dataset، نقرأ من input (مع yearOnly/fullDate)
    const inp = ci.querySelector(inputSelector);
    if (inp){
      const y = (inp.dataset.yearOnly || '').trim();
      const d = (inp.dataset.fullDate || '').trim();

      if (y && !d) return y;          // سنة فقط
      if (d) return d;                // تاريخ كامل
      return (inp.value || '').trim(); // fallback: قيمة الحقل
    }

    return '';
  }


    const wives = Array.from(wivesList.querySelectorAll('.wife-block')).map(w=>{
      const pick = cls => (w.querySelector(`.${cls}`)?.value || '').trim();

      const children = Array.from(w.querySelectorAll('.children-list-editor .child-item')).map(ci=>({
        _id:  ci.dataset.childId || null,
        name: (ci.dataset.childName || '').trim(),
        role: (ci.dataset.childRole || 'ابن').trim(),

        // قراءة تاريخ/سنة الميلاد والوفاة من مدخلات الطفل مع دعم yearOnly/fullDate
        birthDate: readChildDate(ci, '.child-edit-birthDate', 'childBirthDate'),
        deathDate: readChildDate(ci, '.child-edit-deathDate', 'childDeathDate'),

        birthPlace: (ci.dataset.childBirthPlace || '').trim(),
        occupation: (ci.dataset.childOccupation || '').trim(),
        cognomen:   (ci.dataset.childCognomen || '').trim(),
        remark:     (ci.dataset.childRemark || '').trim(),

        // نص الإنجازات والهوايات (نص خام مفصول بفواصل، يُحوَّل لاحقًا إلى مصفوفات)
        achievementsTxt: (ci.dataset.childAchievements || '').trim(),
        hobbiesTxt:      (ci.dataset.childHobbies      || '').trim(),
      }));

         const d = w.dataset;

        return {
        name: pick('wife-name'),
        bio: {
          // أب الزوجة: الحالة المثبتة فقط من dataset
          fatherName:       (d.wifeFatherName       || '').trim(),
          fatherCognomen:   (d.wifeFatherCognomen   || '').trim(),
          fatherBirthDate:  (d.wifeFatherBirthDate  || '').trim(),
          fatherDeathDate:  (d.wifeFatherDeathDate  || '').trim(),
          fatherBirthPlace: (d.wifeFatherBirthPlace || '').trim(),
          fatherOccupation: (d.wifeFatherOccupation || '').trim(),
          fatherRemark:     (d.wifeFatherRemark     || '').trim(),
          fatherClan:       (d.wifeFatherClan       || '').trim(),

          // نصوص الإخوة/الأخوات + الإنجازات/الهوايات لأب الزوجة
          fatherBrothersTxt:     (d.wifeFatherBrothers      || '').trim(),
          fatherSistersTxt:      (d.wifeFatherSisters       || '').trim(),
          fatherAchievementsTxt: (d.wifeFatherAchievements  || '').trim(),
          fatherHobbiesTxt:      (d.wifeFatherHobbies       || '').trim(),

          // أم الزوجة
          motherName:       (d.wifeMotherName       || '').trim(),
          motherCognomen:   (d.wifeMotherCognomen   || '').trim(),
          motherBirthDate:  (d.wifeMotherBirthDate  || '').trim(),
          motherDeathDate:  (d.wifeMotherDeathDate  || '').trim(),
          motherBirthPlace: (d.wifeMotherBirthPlace || '').trim(),
          motherOccupation: (d.wifeMotherOccupation || '').trim(),
          motherRemark:     (d.wifeMotherRemark     || '').trim(),
          motherClan:       (d.wifeMotherClan       || '').trim(),

          // نصوص الإخوة/الأخوات + الإنجازات/الهوايات لأم الزوجة
          motherBrothersTxt:     (d.wifeMotherBrothers      || '').trim(),
          motherSistersTxt:      (d.wifeMotherSisters       || '').trim(),
          motherAchievementsTxt: (d.wifeMotherAchievements  || '').trim(),
          motherHobbiesTxt:      (d.wifeMotherHobbies       || '').trim(),

          // باقي ميتا الزوجة (مباشرة من الحقول كما كان)
          tribe:      pick('wife-tribe'),
          clan:       pick('wife-clan'),
          birthDate:  pick('wife-birthDate'),
          deathDate:  pick('wife-deathDate'),
          birthPlace: pick('wife-birthPlace'),
          cognomen:   pick('wife-cognomen'),
          occupation: pick('wife-occupation'),
          remark:     pick('wife-remark'),

          // نصوص الإخوة/الأخوات + الإنجازات/الهوايات للزوجة
          brothersTxt:     pick('wife-brothers'),
          sistersTxt:      pick('wife-sisters'),
          achievementsTxt: pick('wife-achievements'),
          hobbiesTxt:      pick('wife-hobbies')
        },
        children
      };



    }).filter(w=>w.name);


    const father = (() => {
      const fb = fatherBlock;
      if (!fb) return { name:'', bio:{} };

      // أداة قراءة تاريخ/سنة للأب مع دعم yearOnly/fullDate
      // تُفضِّل القيمة المحفوظة في dataset أولاً
      const readFatherDate = (inputSelector, datasetKey) => {
        const ds = (fb.dataset[datasetKey] || '').trim();
        if (ds) return ds;

        const inp = fb.querySelector(inputSelector);
        if (inp){
          const y = (inp.dataset.yearOnly || '').trim();
          const d = (inp.dataset.fullDate || '').trim();
          if (y && !d) return y;
          if (d) return d;
          return (inp.value || '').trim();
        }
        return '';
      };

       // أداة قراءة نص (الإخوة/الأخوات) للأب:
      // تعتمد فقط على dataset (القيمة المثبّتة بعد الحفظ الفرعي)
      const readFatherText = (inputSelector, datasetKey) => {
        return (fb.dataset[datasetKey] || '').trim();
      };

      return {
        name: (fb.dataset.fatherName || '').trim(),
        bio: {
          birthDate:   readFatherDate('.father-birthDate', 'fatherBirthDate'),
          deathDate:   readFatherDate('.father-deathDate', 'fatherDeathDate'),
          birthPlace:  (fb.dataset.fatherBirthPlace || '').trim(),
          occupation:  (fb.dataset.fatherOccupation || '').trim(),
          cognomen:    (fb.dataset.fatherCognomen || '').trim(),
          remark:      (fb.dataset.fatherRemark || '').trim(),

          // نصوص الإنجازات/الهوايات للأب (ستُحوَّل لاحقًا إلى مصفوفات في composeFamilyObject)
          achievementsTxt: readFatherText('.father-achievements', 'fatherAchievements'),
          hobbiesTxt:      readFatherText('.father-hobbies',      'fatherHobbies'),

          // نصوص الإخوة/الأخوات للأب (ستُحوَّل لاحقًا إلى siblingsBrothers/Sisters في composeFamilyObject)
          brothersTxt: readFatherText('.father-brothers', 'fatherBrothers'),
          sistersTxt:  readFatherText('.father-sisters',  'fatherSisters')
        }
      };

    })();


    return { formFields, wives, ancestors, father };
  }

  /* ========= 12) إرسال النموذج ========= */
  formEl.addEventListener('submit', (e)=>{
    e.preventDefault();

    // 1) اقرأ القيم
    const { formFields, wives, ancestors, father } = readUI();

    // 2) تحقّق عام
    const errs = [];
    let firstInvalidEl = null;

    if (!formFields.title){
      errs.push('حقل "عنوان العائلة" مطلوب.');
      firstInvalidEl = firstInvalidEl || formEl.querySelector('#newFamilyTitle');
    }
    if (!formFields.rootName){
      errs.push('حقل "اسم صاحب الشجرة" مطلوب.');
      firstInvalidEl = firstInvalidEl || formEl.querySelector('#newRootPerson');
    }
    const vAnc = Form.validateAncestorsInputs(ancestors.map(a=>a.name));
    if (!vAnc.ok) errs.push(vAnc.msg);

    const emptyWives = Array.from(wivesList.querySelectorAll('.wife-block'))
      .map(b=>({ el: b.querySelector('.wife-name'), name: (b.querySelector('.wife-name')?.value||'').trim() }))
      .filter(x=>!x.name);
    if (emptyWives.length){
      errs.push('أكمل أسماء الزوجات الفارغة أو احذفها.');
      if (!firstInvalidEl && emptyWives[0]?.el) firstInvalidEl = emptyWives[0].el;
    }

    // تحقق مشروط للأب: إن امتلأ أي حقل فاسم الأب مطلوب
    (function(){
      const fb = fatherBlock;
      if (!fb) return;
      const nameEl = fb.querySelector('.father-name');
            const others = [
        '.father-cognomen',
        '.father-birthDate',
        '.father-deathDate',
        '.father-birthPlace',
        '.father-occupation',
        '.father-remark',
        '.father-brothers',
        '.father-sisters'
      ].map(sel=> fb.querySelector(sel));

      const anyFilled = others.some(el => (el && (el.value||'').trim()));
      if (anyFilled && !(nameEl.value||'').trim()){
        errs.push('حقل "اسم الأب" مطلوب عند تعبئة أي بيانات للأب.');
        if (!firstInvalidEl) firstInvalidEl = nameEl;
      }
    })();

    if (errs.length){
      [formEl.querySelector('#newFamilyTitle'), formEl.querySelector('#newRootPerson')]
        .forEach(el=>{ if (el && !el.value.trim()) markInvalid(el); });
      emptyWives.forEach(x=> x.el && markInvalid(x.el));
      if (firstInvalidEl) markInvalid(firstInvalidEl);
      showInfo(errs.join(' | '));
      return;
    }

    // 3) منع الحفظ إذا محرر فرعي ظاهر ومتسخ
    const openDirtyEditor = Array.from(modal.querySelectorAll('.meta-edit')).find(ed => {
      const visible = ed.offsetParent !== null;
      if (!visible) return false;
      return Array.from(ed.querySelectorAll('input,select,textarea')).some(inp=>{
        return (inp.__base !== undefined) &&
               (String(inp.__base) !== (inp.type==='checkbox'||inp.type==='radio' ? String(!!inp.checked) : String(inp.value||'')));
      });
    });
    if (openDirtyEditor){
      showInfo('أغلق أو احفظ التعديلات الفرعية أولًا.');
      openDirtyEditor.querySelector('input,select,textarea,button')?.focus({ preventScroll:false });
      openDirtyEditor.scrollIntoView({ block:'center', behavior:'smooth' });
      return;
    }

    // 4) تركيب الكائن النهائي
    const prevFamily = (editKey ? getFamily(editKey) : null) || null;
    const familyObj = Form.composeFamilyObject({ formFields, wives, ancestors, prevFamily, father });

    // منع حفظ بلا تغيير في وضع التعديل
    if (editKey){
      const snapNow = computeSnapshot();
      const noAncChange  = snapNow.ancKey === committedAncestorsRawKey;
      const noFormChange = JSON.stringify(snapNow) === JSON.stringify(initialFormSnapshot);
      if (noAncChange && noFormChange){ showInfo('لم يتم إجراء أي تغيير.'); return; }
    }

    // 5) حفظ خارجي
    const key = formFields.editKey || generateFamilyKey();
    try{ onSave?.(key, familyObj); }
    catch(err){ console.error(err); showInfo('حدث خطأ أثناء الحفظ.'); return; }

    // 6) تثبيت اللقطات وتنظيف المؤشرات وإغلاق
    committedAncestorsRawKey = Form.makeAncestorsRawKey(ancestors.map(a=>a.name));
    initialFormSnapshot = computeSnapshot();

    // نظّف مؤشرات “قيد الترتيب”
    modal.querySelectorAll('.ancestor-row').forEach(r=>{ r.dataset.orderDirty=''; });
    modal.querySelectorAll('.ancestor-label,.wife-title').forEach(el=> el.classList.remove('dirty-on','dot-ok','dot-invalid','dot-pending'));

    // DnD + baselines بعد الحفظ
    wireAncestorsDnD(); wireChildrenDnD();
    initChildrenOrderBaselines();
    wivesList.querySelectorAll('.children-list-editor').forEach(refreshChildrenOrderDirty);

    // إعادة ضبط واتساخ النصوص
    initialFormSnapshot = computeSnapshot();
    committedAncestorsRawKey = initialFormSnapshot.ancKey;
    modal.resetDirtyIndicators?.();
    checkDirty();

    disposeDirtyIndicators(modal);
    ModalManager.close(modal);
    openerEl?.focus();
  });
}