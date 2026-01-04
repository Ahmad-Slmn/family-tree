// features/engage.js — مشاركة/تقييم/ملاحظات/مساعدة
import { showSuccess, showWarning, showInfo, showError, byId } from '../utils.js';

function openInlineNoteModal({ onSend }){
  let overlay = document.getElementById('noteInlineOverlay');
  if (!overlay){
    overlay = document.createElement('div');
    overlay.id = 'noteInlineOverlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; z-index:9999;
    `;
    overlay.innerHTML = `
      <div class="modal-box" style="
        width:min(520px,92vw); background:#151518; border:1px solid #2a2a2f;
        border-radius:16px; padding:16px; color:#fff; position:relative;">

        <style>
          #noteInlineSend,#noteInlineCancel{
            position:relative;overflow:hidden;border-radius:12px;padding:10px;cursor:pointer;font-size:1rem;
            transition:transform .18s ease,box-shadow .18s ease,background .18s ease,border-color .18s ease,filter .18s ease;
            will-change:transform;
          }
          #noteInlineSend{background:#e6b800;color:#111;border:0;box-shadow:0 4px 10px rgba(0,0,0,.35);}
          #noteInlineSend:hover{background:#ffd24d;color:#000;transform:translateY(-2px);box-shadow:0 8px 16px rgba(0,0,0,.45);filter:brightness(1.03);}
          #noteInlineSend:active{transform:translateY(0);box-shadow:0 3px 8px rgba(0,0,0,.35);}

          #noteInlineCancel{background:transparent;color:#fff;border:1px solid #2a2a2f;}
          #noteInlineCancel:hover{background:#ffffff12;border-color:#ffffff55;transform:translateY(-2px);box-shadow:0 8px 16px rgba(0,0,0,.35);}
          #noteInlineCancel:active{transform:translateY(0);box-shadow:0 3px 8px rgba(0,0,0,.3);}

          .ripple{
            position:absolute;border-radius:50%;transform:scale(0);
            animation:ripple .55s ease-out;pointer-events:none;opacity:.5;background:currentColor;
          }
          @keyframes ripple{to{transform:scale(3.2);opacity:0;}}

          #noteInlineHistoryBtn:hover{background:#ffffff12;border-color:#ffffff55;transform:translateY(-2px);box-shadow:0 8px 16px rgba(0,0,0,.35);}
          #noteInlineHistoryBtn:active{transform:translateY(0);box-shadow:0 3px 8px rgba(0,0,0,.3);}
          #noteInlineClearHistory:hover{background:#ffffff10;transform:translateY(-1px);}
          @media (max-width:23.9rem){#noteInlineOverlay .modal-box{width:96vw;padding:12px;border-radius:14px}#noteInlineOverlay h2{font-size:1.05rem}#noteInlineOverlay p{font-size:.9rem}#noteInlineText{min-height:90px;font-size:.95rem}#noteInlineHistory{max-height:180px}#noteInlineOverlay .buttons{flex-direction:column}#noteInlineSend,#noteInlineCancel,#noteInlineHistoryBtn{font-size:.95rem;padding:9px}}
          @media (min-width:24rem) and (max-width:29.9rem){#noteInlineOverlay .modal-box{width:94vw;padding:14px}#noteInlineOverlay h2{font-size:1.1rem}#noteInlineText{min-height:100px;font-size:.97rem}#noteInlineHistory{max-height:200px}#noteInlineOverlay .buttons{flex-direction:column}}
          @media (min-width:30rem) and (max-width:39.9rem){#noteInlineOverlay .modal-box{width:min(520px,92vw);padding:16px}#noteInlineOverlay h2{font-size:1.15rem}#noteInlineText{min-height:110px}}
          @media (min-width:40rem) and (max-width:47.9rem){#noteInlineOverlay .modal-box{width:min(540px,90vw);padding:18px}#noteInlineOverlay h2{font-size:1.2rem}#noteInlineText{min-height:120px}}
          @media (min-width:48rem) and (max-width:63.9rem){#noteInlineOverlay .modal-box{width:min(560px,88vw);padding:18px 20px}#noteInlineOverlay h2{font-size:1.25rem}#noteInlineText{min-height:130px}}
          @media (min-width:64rem){#noteInlineOverlay .modal-box{width:min(580px,80vw);padding:20px}#noteInlineOverlay h2{font-size:1.3rem}#noteInlineText{min-height:140px}}


        </style>

        <h2 style="margin:0 0 8px;">إرسال ملاحظة</h2>
        <p style="margin:0 0 10px; opacity:.8;">اكتب ملاحظتك أو اقتراحك:</p>

        <textarea id="noteInlineText" style="
          width:100%; min-height:120px; background:#0f0f12; color:#fff;
          border:1px solid #2a2a2f; border-radius:12px; padding:10px; font-size:1rem;"></textarea>

        <div id="noteInlineStatus" style="margin-top:8px;font-size:.9rem;opacity:.9;"></div>

        <div id="noteInlineHistory" hidden style="
          margin-top:10px;text-align:right;background:#0f0f12;border:1px solid #2a2a2f;
          border-radius:12px;padding:10px;max-height:220px;overflow:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="color:#ffd86a;">سجل الملاحظات</strong>
            <button id="noteInlineClearHistory" type="button" style="
              background:transparent;color:#f44336;border:1px solid #3a2a2f;
              padding:6px 8px;border-radius:8px;cursor:pointer;">مسح السجل</button>
          </div>
          <div id="noteInlineHistoryList" style="font-size:.95rem; line-height:1.6;"></div>
        </div>

        <div class="buttons" style="display:flex; gap:8px; margin-top:12px;">
          <button id="noteInlineSend" type="button" class="yes-btn" style="flex:1;">إرسال</button>
          <button id="noteInlineHistoryBtn" type="button" class="no-btn" style="
            flex:1;background:transparent;color:#fff;border:1px solid #2a2a2f;">سجل الملاحظات</button>
          <button id="noteInlineCancel" type="button" class="no-btn" style="flex:1;">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e=>{ if (e.target === overlay) overlay.hidden = true; });
    overlay.querySelector('#noteInlineCancel').addEventListener('click', ()=> overlay.hidden = true);
  }

  overlay.hidden = false;
  const ta = overlay.querySelector('#noteInlineText'),
        statusBox = overlay.querySelector('#noteInlineStatus'),
        historyWrap = overlay.querySelector('#noteInlineHistory'),
        historyList = overlay.querySelector('#noteInlineHistoryList'),
        historyBtn  = overlay.querySelector('#noteInlineHistoryBtn'),
        clearBtn    = overlay.querySelector('#noteInlineClearHistory');

  ta.value=''; statusBox.textContent=''; statusBox.style.color=''; ta.focus();

  const setStatus = (text, ok)=>{
    statusBox.textContent = text || '';
    statusBox.style.color = ok ? '#4caf50' : '#f44336';
  };

  const loadHistory = ()=>{
    try{ return JSON.parse(localStorage.getItem("notesHistory") || "[]"); }
    catch{ return []; }
  };

  const refreshHistoryButton = ()=>{
    const history = loadHistory(), hasHistory = history.length>0;
    // إخفاء زر السجل إذا لا يوجد بيانات
    historyBtn.hidden = !hasHistory;
    if (!hasHistory){ historyWrap.hidden = true; historyBtn.textContent = "سجل الملاحظات"; }
    return history;
  };

  const renderHistory = ()=>{
    const history = refreshHistoryButton();
    if (!history.length) return;
    historyList.innerHTML = history.slice().reverse().map(h=>{
      const d = new Date(h.at), dateTxt = isNaN(d)? h.at : d.toLocaleString('ar');
      const safeMsg = String(h.msg||'').replace(/[<>]/g,'');
      return `
        <div style="padding:6px 0; border-bottom:1px dashed #2a2a2f;">
          <div style="opacity:.75; font-size:.85rem;">${dateTxt}</div>
          <div>${safeMsg}</div>
        </div>`;
    }).join('');
  };

  historyBtn.onclick = ()=>{
    const willShow = historyWrap.hidden;
    historyWrap.hidden = !willShow;
    if (willShow){ renderHistory(); historyBtn.textContent="إغلاق سجل الملاحظات"; }
    else historyBtn.textContent="سجل الملاحظات";
  };

  clearBtn.onclick = ()=>{
    if (document.getElementById('noteInlineConfirm')) return;

    const box = document.createElement('div');
    box.id="noteInlineConfirm";
    box.style.cssText=`
      position:fixed; inset:0; background:rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; z-index:10000;`;
    box.innerHTML=`
      <div class="modal-box" style="
        width:min(360px,90vw); background:#151518;border:1px solid #2a2a2f;border-radius:14px;
        padding:16px;color:#fff;text-align:center;box-shadow:0 8px 20px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 10px; font-size:1.1rem;">تأكيد مسح السجل</h3>
        <p style="opacity:.8; margin:0 0 14px;">هل تريد مسح جميع الملاحظات المحفوظة؟</p>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="confirmClearYes" style="
            flex:1;background:#e6b800;color:#111;border:0;padding:10px;border-radius:10px;
            position:relative;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,.35);transition:.2s;cursor:pointer;">نعم</button>
          <button id="confirmClearNo" style="
            flex:1;background:transparent;color:#fff;border:1px solid #2a2a2f;padding:10px;border-radius:10px;
            position:relative;overflow:hidden;transition:.2s;cursor:pointer;">إلغاء</button>
        </div>
      </div>`;
    document.body.appendChild(box);

    const yes=box.querySelector('#confirmClearYes'), no=box.querySelector('#confirmClearNo');
    yes.onmouseenter=()=>{yes.style.transform="translateY(-2px)";};
    yes.onmouseleave=()=>{yes.style.transform="translateY(0)";};
    no.onmouseenter =()=>{no.style.transform ="translateY(-2px)";};
    no.onmouseleave =()=>{no.style.transform ="translateY(0)";};

    // تأثير Ripple داخل نافذة التأكيد
    [yes,no].forEach(btn=>{
      btn.addEventListener('click', e=>{
        const old=btn.querySelector('.ripple'); if(old) old.remove();
        const r=btn.getBoundingClientRect(), size=Math.max(r.width,r.height);
        const x=e.clientX-r.left-size/2, y=e.clientY-r.top-size/2;
        const ripple=document.createElement('span');
        ripple.className='ripple';
        ripple.style.cssText=`
          position:absolute;border-radius:50%;transform:scale(0);
          width:${size}px;height:${size}px;left:${x}px;top:${y}px;
          background:currentColor;opacity:.5;animation:ripple .55s ease-out;`;
        btn.appendChild(ripple);
        ripple.addEventListener('animationend',()=>ripple.remove());
      });
    });

    yes.onclick=()=>{
      localStorage.removeItem("notesHistory");
      localStorage.removeItem("lastNote");
      refreshHistoryButton(); historyList.innerHTML="";
      setStatus('تم مسح سجل الملاحظات.', true);
      box.remove();
    };
    no.onclick=()=>box.remove();
    box.addEventListener('click', e=>{ if(e.target===box) box.remove(); });
  };

  refreshHistoryButton();

  overlay.querySelector('#noteInlineSend').onclick = async ()=>{
    const msg=(ta.value||'').trim();
    if(!msg){ setStatus('اكتب الملاحظة أولاً.', false); ta.focus(); return; }
    setStatus('جارٍ الإرسال...', true);
    try{ await onSend(msg, setStatus); refreshHistoryButton(); }
    catch{ setStatus('حدث خطأ أثناء الإرسال.', false); }
  };

  // Ripple للأزرار داخل مودال الملاحظات
  overlay.querySelectorAll('#noteInlineSend,#noteInlineCancel,#noteInlineHistoryBtn,#noteInlineClearHistory')
    .forEach(btn=>{
      btn.addEventListener('click', function(e){
        const old=this.querySelector('.ripple'); if(old) old.remove();
        const r=this.getBoundingClientRect(), size=Math.max(r.width,r.height);
        const x=e.clientX-r.left-size/2, y=e.clientY-r.top-size/2;
        const ripple=document.createElement('span');
        ripple.className='ripple';
        ripple.style.width=ripple.style.height=size+'px';
        ripple.style.left=x+'px'; ripple.style.top=y+'px';
        this.appendChild(ripple);
        ripple.addEventListener('animationend',()=>ripple.remove(),{once:true});
      });
    });
}

const HELP_SECTIONS = [

{ title:"ما الذي يجعل هذا الموقع مميزًا؟", keywords:"أهمية فائدة سبب عائلة أنساب جذور", open:true, items:[
  "لوحة واحدة تجمع الأجداد والآباء والأبناء والأحفاد في شجرة واضحة.",
  "توثيق تاريخ العائلة: أسماء/صور/تواريخ قبل أن تنساها الأيام.",
  "إظهار الروابط الأسرية بدقة: آباء، أبناء، أزواج، إخوة…",
  "شجرة تفاعلية تنمو مع العائلة وتُحدَّث باستمرار.",
  "بحث سريع لأي فرد مع بطاقة مرتبة لبياناته وصوره.",
  "كل فرد غصن ظاهر يبقى أثره للأجيال.",
  "منصة تحفظ الماضي وتسهّل مشاركة الحاضر."
]},

{ title:"شارك رأيك… وكن جزءًا من تطوير الشجرة", keywords:"مشاركة تقييم ملاحظة اقتراح تطوير", items:[
  "تفاعلك يحسّن الموقع ويطوّر الميزات للجميع.",
  "مشاركة الموقع: زر (مشاركة الموقع) يفتح مشاركة النظام أو ينسخ الرابط.",
  "تقييم الموقع: زر (قيّم الموقع) → اختر النجوم وأرسل ملاحظة إن رغبت.",
  "إرسال ملاحظة: زر (إرسال ملاحظة) → اكتب اقتراحك/بلاغك؛ تُحفظ في السجل وتُرسل بالبريد إن كان مضبوطًا.",
  "كل مشاركة/تقييم/ملاحظة تسهم في الإصلاح والتطوير."
]},

{ title:"إدارة العائلات (تعديل / حذف / إنشاء)", keywords:"عائلة تعديل حذف إنشاء إضافة إعدادات sidePanel addFamilyBtn", items:[
  "افتح الشريط الجانبي من زر الإعدادات أعلى الصفحة (#sideToggle).",
  "ستجد قائمة العائلات مع أزرار التعديل ✏️ والحذف 🗑️ للعائلات المخصّصة.",
  "تعديل: اضغط ✏️ → عدّل البيانات → «حفظ العائلة».",
  "حذف: اضغط 🗑️ → أكّد → تُحذف نهائيًا.",
  "العائلات الأساسية لا تُعدّل/تُحذف؛ يمكن إخفاؤها ثم إظهارها من «إعادة تفضيلات الواجهة».",
  "إنشاء: زر «إنشاء عائلة جديدة» (#addFamilyBtn) → اكتب العنوان → «حفظ العائلة»."
]},
  
{ title:"قفل الواجهة والخصوصية", keywords:"قفل كلمة مرور خصوصية حماية جلسة خمول تبويب عداد", items:[
  "فعّل (حماية الخصوصية) لضبط كلمة مرور جديدة (4 محارف على الأقل) مع تأكيدها وتلميح اختياري.",
  "بعد التفعيل تتوفر: (قفل الآن)، (تغيير كلمة المرور)، مدة الخمول، القفل عند ترك التبويب، والجلسة المفتوحة.",
  "زر (قفل الآن) يقفل الواجهة فورًا وينهي أي جلسة مفتوحة.",
  "فتح الواجهة يتطلب إدخال كلمة المرور الصحيحة، مع إمكانية إظهار/إخفاء الإدخال.",
  "كلمة المرور تقبل أحرفًا وأرقامًا فقط وبحد أقصى 12 محرفًا.",
  "المحاولات الخاطئة تُجمَّد تدريجيًا بعد عدد معين مع عدّاد انتظار، وتُصفَّر بعد فترة طويلة بدون محاولات.",
  "الخمول يقفل الواجهة تلقائيًا بعد 15/30 ثانية أو 1/2/3/5/10 دقائق حسب الإعداد.",
  "القفل عند ترك التبويب (إن فُعّل) يقفل الواجهة فور المغادرة ولا يفتح تلقائيًا عند الرجوع.",
  "الجلسة المفتوحة (5/15/30/60 دقيقة) تعطل القفل المؤقتًا ويظهر لها عدّاد، وعند انتهائها تُقفل الواجهة تلقائيًا.",
  "يمكن إلغاء الجلسة المفتوحة يدويًا دون قفل فوري.",
  "تعطيل الحماية يتطلب إدخال كلمة المرور الحالية، وعند التعطيل تُمسح بيانات القفل من الجهاز.",
]},


{ title:"البحث والتنقّل", keywords:"بحث اسم دور لقب اقتراحات فلاتر", items:[
  "ابحث بالاسم/الدور/اللقب حسب النص داخل حقل البحث.",
  "الاقتراحات تتحدّث أثناء الكتابة وتظهر أسفل الحقل.",
  "أيقونة العدسة تفتح/تغلق الاقتراحات عند وجود نص.",
  "اختيار اقتراح ينقلك لبطاقة الشخص مباشرة.",
  "عند الانتقال لشخص تُزال الفلاتر مؤقتًا ثم تعود تلقائيًا.",
  "اقتراحات البحث تتأثر بفلاتر: الدور، العشيرة، الحالة (الأحياء/المتوفين)، الجيل، ومن/إلى تاريخ الميلاد.",
  "زر (✕) يمسح البحث ويخفي الاقتراحات.",
  "Esc أو Enter يغلقان الاقتراحات.",
  "Ctrl+K / Cmd+K يركّز على البحث.",
]},

{
  title: "تنبيهات التحقق (مركز التنبيهات)",
  keywords: "تنبيهات التحقق جرس أخطاء ملاحظات تحقق الأعمار الوفيات الزوجين",
  items: [
    "أيقونة الجرس 🔔 في الشريط العلوي تعرض عدد التنبيهات للعائلة الحالية. 0 يعني لا توجد تنبيهات، وقد يظهر 99+ عند كثرتها.",
    "اضغط على أيقونة الجرس لفتح نافذة التنبيهات: يظهر ملخص (الإجمالي/الأخطاء/الملاحظات) ثم قائمة التفاصيل.",
    "تظهر التنبيهات بمستويات مختلفة؛ «أخطاء» (شديدة وتحتاج مراجعة) و«ملاحظات» (تنبيه للتدقيق).",
    "زر «عرض سيرة» داخل التنبيه يفتح بطاقة الشخص المرتبط به مباشرة.",
    "الميزة تفحص: منطق أعمار الوالد والطفل، الميلاد في المستقبل، منطق الوفيات (قبل الميلاد/في المستقبل/قبل ميلاد الطفل)، وفروق العمر بين الزوجين.",
    "التنبيهات لا تعدّل أي بيانات؛ هي فقط تشخيص لمساعدتك على تصحيح المعلومات.",
    "يتم حفظ النتائج مؤقتًا على جهازك (حتى 7 أيام وبحد أقصى 20 نتيجة) لتظهر بسرعة عند العودة."
  ]
},


{ title:"الصور الشخصية", keywords:"صورة شخصية اختيار تغيير حذف تدوير قص ملاءمة معرض جهاز سحب إفلات استعادة الأصل", items:[
  "من بطاقة الشخص اختر «اختيار صورة» (من الجهاز/المعرض).",
  "تظهر معاينة؛ «حفظ الصورة» لتثبيتها.",
  "يمكن السحب-والإفلات على الإطار كمعاينة.",
  "قبل الحفظ: تدوير/إلغاء، ملاءمة/إلغاء.",
  "«استعادة الأصل» تعود للصورة الأولى إن وُجدت.",
  "اختيار صورة أثناء تعديل غير محفوظ يلغي التعديل الحالي.",
  "«حذف الصورة» ثم تأكيد للحذف النهائي."
]},

{
  title: "القصص والمذكّرات",
  keywords: "قصة قصص مذكّرات كتابة تعديل حفظ حذف نوع وسوم مكان تاريخ صور معاينة شرائح تمييز ترتيب فلترة",
  items: [
    "من نافذة السيرة اختر تبويب «القصص والمذكّرات»، ثم اضغط «إضافة قصة جديدة».",
    "اكتب عنوانًا اختياريًا ونص القصة، وحدّد نوعها (مثل: الطفولة، الدراسة، الزواج) مع تاريخ الحدث ومكانه إن وُجد.",
    "أضف وسومًا مفصولة بفواصل لتيسير البحث والتصفية، واختر خيار «قصة مميّزة» عند الرغبة في إبرازها.",
    "يمكن إرفاق عدة صور بالقصة؛ تظهر كمصغّرات مع إمكانية إعادة ترتيبها بالسحب، وكذلك معاينتها بالحجم الكامل أو عرضها كشرائح.",
    "من شريط الأدوات يمكن ترتيب القصص من الأحدث أو الأقدم، وتصفية العرض حسب نوع القصة أو الوسوم.",
    "استخدم «حفظ» لتثبيت التعديلات، و«إلغاء التعديل» للرجوع لآخر نسخة محفوظة، و«حذف» (مع تأكيد) لمسح القصة نهائيًا."
  ]
},
  
{
  title: "المصادر والوثائق",
  keywords: "مصدر وثيقة وثائق صك شهادة ميلاد زواج وفاة هوية ميراث ملكية إضافة تعديل حفظ حذف نوع جهة رقم صك تاريخ مكان صفحات وسوم ملاحظات صور مرفقات سحب إفلات ترتيب معاينة شرائح أساسي موثّق سرية خصوصية بحث فلترة قائمة جدول",
  items: [
    "من نافذة السيرة اختر تبويب «المصادر والوثائق» للاطلاع على جميع الوثائق المرتبطة بالشخص وإدارتها.",
    "اضغط «إضافة وثيقة جديدة»، ثم أدخل اسم الوثيقة، نوعها، تاريخها، مكان إصدارها، الجهة المصدرة، رقم الصك/الوثيقة، وعدد الصفحات (اختياري).",
    "أضف ملخصًا لمحتوى الوثيقة ووسومًا مفصولة بفواصل، وحدّد درجة الاعتماد على المصدر، مستوى السرية/الخصوصية، وحالة التوثيق إن لزم.",
    "يمكن إرفاق عدة صور أو مسوحات ضوئية لكل وثيقة، إعادة ترتيبها بالسحب والإفلات، ومعاينتها بحجم أكبر أو في عارض شرائح، إضافة إلى تحميل الملفات المرفقة.",
    "استخدم خيار «وثيقة أساسية» لتمييز أهم الوثائق، مع إمكانية الفرز (الأحدث/الأقدم)، الفلترة حسب النوع أو الأساسيات فقط، والبحث النصي، والتبديل بين عرض «البطاقات» و«الجدول المختصر».",
    "يظهر شريط إحصائي بعدد الوثائق حسب النوع، وتنبيه عند وجود بيانات ميلاد/وفاة بلا وثيقة داعمة، ويمكن حفظ التعديلات أو إلغاؤها أو حذف الوثيقة نهائيًا بعد التأكيد."
  ]
},

  
{
  title: "الخطّ الزمني للأحداث",
  keywords: "خط زمني أحداث حدث ميلاد زواج وفاة انتقال عمل حج عمرة إضافة تعديل حفظ حذف نوع تاريخ مكان تفاصيل صور معاينة شرائح ترتيب فلترة قائمة عمر تقريبي تثبيت مميّز",
  items: [
    "من نافذة السيرة اختر تبويب «الخطّ الزمني للأحداث»، ثم اضغط «إضافة حدث جديد».",
    "اختر نوع الحدث وتاريخه ومكانه، مع عنوان اختياري ووصف موجز للتفاصيل.",
    "يمكن إرفاق عدة صور لكل حدث، وإعادة ترتيبها بالسحب، ومعاينتها بالحجم الكامل أو في شريط شرائح.",
    "بدّل بين عرض «القائمة» وعرض «الخط الزمني» لرؤية الأحداث كبطاقات مفصّلة أو كخطّ زمني مرتب بحسب السنوات والأحداث غير المؤرَّخة.",
    "استخدم فلتر النوع وترتيب «الأقدم/الأحدث»، مع إظهار العمر التقريبي عند الحدث إن وُجد تاريخ الميلاد، وخيار «حدث مميّز» لإبراز الأحداث المهمة مع إمكانيات الحفظ، إلغاء التعديل، أو الحذف بعد التأكيد."
  ]
},


{ title:"لوحة الإحصاءات", keywords:"احصاءات تحليلات مخططات CSV عشائر نطاق بحث ترتيب اعمدة تكرار مراجعة", items:[
  "زر (لوحة الإحصاءات) يفتح نافذة الإحصاءات.",
  "بطاقات الملخص تعرض: عدد العائلات (المرئية فقط)، إجمالي الأشخاص، الزوجات، أبناء/بنات (أبناء صاحب الشجرة فقط)، غير محدد، متوسط الأبناء/عائلة، متوسط الأبناء/جذر فعّال، نسب توفر (الميلاد/العشيرة/الصورة)، ونسبة (أشخاص بلا معرّف).",
  "مخطط سريع (أبناء/بنات) يتبع (النطاق) فقط.",
  "النطاق: كل العائلات أو عائلة واحدة (يتحدّث تلقائيًا عند تغيّر رؤية العائلات).",
  "فلترة: (بحث العائلة) بتطبيع عربي + (حد أدنى للأشخاص).",
  "المخطط المكدّس + جدول العائلات يتأثران بالفلاتر، مع (الترتيب) و(عدد الأعمدة).",
  "تفاصيل العشائر تُعرض من نتائج الفلترة (الأكبر فقط) مع (إجمالي/ذكور/إناث/غير محدد).",
  "زر تصدير Excel: يصدّر العائلات الظاهرة بعد تطبيق (النطاق + البحث + الحد الأدنى) وبنفس (الترتيب). ويضيف ميتا التصدير + جدول العائلات + جدول العشائر المحسوب من نفس العائلات.",
  "التكرار: بطاقات ملخص للتكرار + عمود (التكرار) بالجدول؛ النقر عليه يفتح (مراجعة التكرارات) ويعرض المجموعات/الخطورة/النسبة وتفاصيل قوي-متوسط-ضعيف."
]},

{
  title: "طباعة العائلة / PDF",
  keywords: "طباعة العائلة PDF print",
  items: [
    "زر (طباعة العائلة) يفتح نافذة طباعة المتصفّح.",
    "اختر الطابعة أو (Save as PDF) لحفظ الشجرة كملف PDF.",
    "خصّص المظهر عبر خيارات الطباعة: طباعة مبسّطة، إخفاء العدّادات، إخفاء الصور، أو طباعة أبيض وأسود.",
    "تُخفى الوصلات بين البطاقات تلقائيًا في الطباعة لزيادة وضوح الصفحات، وتُحفَظ آخر الإعدادات لتطبيقها تلقائيًا لاحقًا."
  ]
},

  
{
  title: "التصدير والاستيراد",
  keywords: "تصدير استيراد JSON نسخ احتياطي سحب إفلات",
  items: [
    "تصدير: زر «تصدير عائلة» ينزّل ملف JSON للعائلة الحالية مع بياناتها (أو لجميع العائلات إذا لم تكن هناك عائلة محددة).",
    "استيراد: زر «استيراد عائلة» لاختيار ملف JSON صادر من التطبيق (حتى 64MB كحد أقصى).",
    "يمكن استيراد نفس الملف بالسحب والإفلات داخل مربع «منطقة الاستيراد» المخصّص في لوحة الإعدادات.",
    "يتم فحص نوع الملف والحجم وتركيب البيانات، وتظهر رسائل خطأ واضحة إذا كان الملف ليس JSON، أو تالفًا، أو يتجاوز الحد، أو ليس بتنسيق التصدير الخاص بالتطبيق."
  ]
},


{
  title: "الحذف النهائي والنسخ الاحتياطي",
  keywords: "حذف نهائي تفريغ نسخ احتياطي إعادة ضبط",
  items: [
    "استخدم زر «حذف جميع البيانات وإعادة الضبط» لبدء التفريغ الشامل (إذا لم توجد بيانات ستظهر رسالة «لا توجد بيانات محفوظة للتفريغ.»).",
    "ستظهر نافذة «تفريغ جميع البيانات» وتعرض ملخصًا لما سيتم حذفه.",
    "لمنع الحذف بالخطأ: زر «تفريغ الآن» يكون غير متاح حتى تكتب نص التأكيد الصحيح: «أوافق» أو «نعم» أو «أوافق على الحذف».",
    "اختياريًا: فعّل خيار «حفظ بيانات العائلات قبل التفريغ» لتنزيل نسخة احتياطية (JSON) قبل الحذف.",
    "عند الضغط على «تفريغ الآن» سيحاول التطبيق حذف كل البيانات المحفوظة وإعادة ضبط الإعدادات تلقائيًا ثم يعيد التشغيل.",
    "إذا كان التطبيق مفتوحًا في أكثر من تبويب، قد يظهر تحذير بأن بعض البيانات ما زالت موجودة مع أرقام توضح المتبقي."
  ]
},


{
  title: "إعادة تفضيلات الواجهة",
  keywords: "اعادة تفضيلات واجهة نمط خط عائلات افتراضي خصوصية pin",
  items: [
    "زر (إعادة تفضيلات الواجهة) يعيد إعدادات الواجهة للوضع الافتراضي.",
    "يفحص: النمط، حجم الخط، العائلة الحالية (مقارنةً بأول عائلة ظاهرة)، إخفاء العائلات الأساسية، وتفضيلات الخصوصية (كلمة المرور).",
    "إذا كانت كل التفضيلات افتراضية يظهر تنبيه بذلك ولا يفتح أي خيارات.",
    "إذا وُجدت تغييرات، يظهر مربع خيارات: التغييرات تكون محددة وجاهزة، والافتراضي يكون معطّل.",
    "اضغط (نعم) لتطبيق ما اخترته أو (لا) للإلغاء."
  ]
}


];


function renderHelpSections(sections){
  return sections.map(sec=>{
    const items = (sec.items || [])
      .map(t => `<li>${t}</li>`)
      .join("");

    return `
      <details ${sec.open?"open":""} data-keywords="${sec.keywords||""}">
        <summary>${sec.title}<span style="opacity:.6">▼</span></summary>
        <div class="help-item">
          <ul class="help-list">${items}</ul>
        </div>
      </details>`;
  }).join("");
}


function openInlineHelpModal(){
  let overlay=document.getElementById('helpInlineOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='helpInlineOverlay';
    overlay.style.cssText=`
      position:fixed; inset:0; background:rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; z-index:9999;`;
    overlay.innerHTML=`
      <div class="modal-box" style="
        width:min(720px,94vw); max-height:88vh; overflow:auto;
        background:#151518; border:1px solid #2a2a2f;
        border-radius:16px; padding:16px; color:#fff; position:relative;
        box-shadow:0 10px 30px rgba(0,0,0,.55);">
        <style>
          #helpInlineOverlay .help-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}
          #helpInlineOverlay .help-title{font-size:1.2rem;margin:0;display:flex;align-items:center;gap:8px;}
          #helpInlineOverlay .help-title i{color:#ffd86a;}
          #helpInlineOverlay .help-close{
            background:transparent;color:#fff;border:1px solid #2a2a2f;padding:8px 10px;border-radius:10px;cursor:pointer;
            transition:transform .18s ease,box-shadow .18s ease,background .18s ease,border-color .18s ease;
          }
          #helpInlineOverlay .help-close:hover{background:#ffffff12;border-color:#ffffff55;transform:translateY(-2px);box-shadow:0 8px 16px rgba(0,0,0,.35);}
          #helpInlineOverlay .help-search{
            width:100%;padding:10px 12px;border-radius:12px;background:#0f0f12;color:#fff;font-size:1rem;
            border:1px solid #2a2a2f;outline:none;margin:6px 0 12px;
          }
          #helpInlineOverlay details{background:#0f0f12;border:1px solid #2a2a2f;border-radius:12px;padding:10px 12px;margin-bottom:8px;}
          #helpInlineOverlay summary{color:#ffd86a;cursor:pointer;font-weight:800;list-style:none;display:flex;align-items:center;justify-content:space-between;}
          #helpInlineOverlay summary::-webkit-details-marker{display:none;}
          #helpInlineOverlay .help-item{margin-top:8px;line-height:1.7;opacity:.95;font-size:1rem;}
          #helpInlineOverlay .kbd{background:#ffffff10;border:1px solid #ffffff22;padding:1px 6px;border-radius:6px;font-family:ui-monospace,monospace;font-size:.9rem;}
          #helpInlineOverlay .help-footer{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;}
          #helpInlineOverlay .help-footer button{
            background:transparent;color:#fff;border:1px solid #2a2a2f;padding:8px 10px;border-radius:10px;cursor:pointer;transition:.18s ease;
          }
          #helpInlineOverlay .help-footer button:hover{background:#ffffff12;border-color:#ffffff55;transform:translateY(-1px);}
          #helpInlineOverlay mark{background:#ffd86a22;color:#ffd86a;padding:0 3px;border-radius:4px;}
          #helpInlineOverlay .help-item{margin-top:8px;line-height:1.8;font-size:1rem;opacity:.96;text-align:right;}
          #helpInlineOverlay .help-list{margin:0;padding:0 0 0 0;list-style:none;display:flex;flex-direction:column;gap:6px;}
          #helpInlineOverlay .help-list li{position:relative;padding:6px 24px 6px 8px;background:#ffffff07;border:1px solid #ffffff12;border-radius:10px;}
          #helpInlineOverlay .help-list li::before{content:"•";position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#ffd86a;font-size:1.15em;opacity:.9;}
          #helpInlineOverlay .help-list li mark{background:#ffd86a22;color:#ffd86a;padding:0 3px;border-radius:4px;}
          #helpInlineOverlay .help-item,
          #helpInlineOverlay .help-list li{color:#e7e7ea; font-weight:500;}
          #helpInlineOverlay .help-item p, #helpInlineOverlay .help-item small{color:#c9c9cf;}
          @media (max-width:23.9rem){#helpInlineOverlay .modal-box{width:96vw;max-height:88vh;padding:12px;border-radius:14px}#helpInlineOverlay .help-title{font-size:1.05rem}#helpInlineOverlay .help-search{font-size:.95rem;padding:8px 10px}#helpInlineOverlay .help-footer{flex-direction:column;align-items:flex-start}#helpInlineOverlay .help-footer button{width:100%;text-align:center}#helpInlineOverlay .help-list li{font-size:.95rem;padding:6px 22px 6px 6px}}
          @media (min-width:24rem) and (max-width:29.9rem){#helpInlineOverlay .modal-box{width:94vw;max-height:88vh;padding:14px}#helpInlineOverlay .help-title{font-size:1.12rem}#helpInlineOverlay .help-search{font-size:.97rem}#helpInlineOverlay .help-list li{font-size:.97rem}}
          @media (min-width:30rem) and (max-width:39.9rem){#helpInlineOverlay .modal-box{width:min(640px,94vw);padding:16px}#helpInlineOverlay .help-title{font-size:1.18rem}}
          @media (min-width:40rem) and (max-width:47.9rem){#helpInlineOverlay .modal-box{width:min(680px,94vw);padding:18px}#helpInlineOverlay .help-title{font-size:1.22rem}}
          @media (min-width:48rem) and (max-width:63.9rem){#helpInlineOverlay .modal-box{width:min(720px,92vw);padding:18px 20px}#helpInlineOverlay .help-title{font-size:1.26rem}}
          @media (min-width:64rem){#helpInlineOverlay .modal-box{width:min(760px,80vw);padding:20px 22px}#helpInlineOverlay .help-title{font-size:1.3rem}}

        </style>

        <div class="help-head">
          <h2 class="help-title"><i class="fa-solid fa-circle-info"></i>دليل الاستخدام</h2>
          <button id="helpInlineClose" class="help-close" type="button">إغلاق</button>
        </div>

        <div class="help-search-wrap" style="position:relative;">
          <input id="helpInlineSearch" class="help-search" type="search"
                 placeholder="ابحث داخل الدليل..." style="padding-left:38px;">
          <button id="helpInlineClearSearch" type="button" title="إلغاء البحث" style="
            position:absolute; left:10px; top:50%; transform:translateY(-50%);
            background:#ffffff10; border:1px solid #ffffff22; color:#fff;
            width:26px; height:26px; border-radius:50%; cursor:pointer;
            display:none; align-items:center; justify-content:center;
            font-size:14px; line-height:1;">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        <div id="helpInlineContent"></div>

        <div class="help-footer" style="display:flex; align-items:center; justify-content:space-between;">
          <div id="helpInlineCounter" style="font-size:.95rem; opacity:.85;"></div>
          <button id="helpInlineToggleAll" type="button">تبديل الكل</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const contentBox=overlay.querySelector('#helpInlineContent');
    contentBox.innerHTML=renderHelpSections(HELP_SECTIONS);

    const emptyBox=document.createElement('div');
    emptyBox.id='helpInlineEmpty';
    emptyBox.style.cssText=`
      display:none;padding:14px;text-align:center;opacity:.85;
      background:#0f0f12;border:1px dashed #2a2a2f;border-radius:12px;margin-top:8px;`;
    emptyBox.innerHTML=`
      <i class="fa-solid fa-magnifying-glass" style="opacity:.7;margin-left:6px;"></i>
      لا توجد نتائج مطابقة للبحث.`;
    contentBox.appendChild(emptyBox);

    overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.hidden=true; });
    overlay.querySelector('#helpInlineClose').addEventListener('click', ()=> overlay.hidden=true);

    const searchInput=overlay.querySelector('#helpInlineSearch'),
          clearSearchBtn=overlay.querySelector('#helpInlineClearSearch'),
          detailsEls=[...overlay.querySelectorAll('details')],
          toggleAllBtn=overlay.querySelector('#helpInlineToggleAll'),
          counterBox=overlay.querySelector('#helpInlineCounter');
// === NEW: حفظ ترتيب الأقسام الأصلي + أدوات إعادة الترتيب ===
const _origDetailsOrder = detailsEls.slice(); // نسخ الترتيب الأصلي

const reorderDetails = (list)=>{
  const frag=document.createDocumentFragment();
  list.forEach(d=>frag.appendChild(d));
  contentBox.insertBefore(frag, emptyBox); // إبقاء emptyBox في النهاية
};

const restoreOriginalOrder = ()=>reorderDetails(_origDetailsOrder);

    // حفظ حالة الأقسام قبل البحث لإعادتها لاحقًا
    let _preSearchOpenState=null;

    const getVisibleDetails=()=>detailsEls.filter(d=>!d.hidden);

    const computeState=()=>{
      const details=getVisibleDetails(), total=details.length;
      const openCount=details.filter(d=>d.open).length, closedCount=total-openCount;
      const searching=!!(searchInput.value||'').trim();
      return {
        details,total,openCount,closedCount,searching,
        allOpen: total>0 && openCount===total,
        allClosed: total>0 && closedCount===total
      };
    };

    const updateFooterState=()=>{
      const s=computeState(), scopeTxt=s.searching?'المعروض':'الكل';
      if(!s.total){
        counterBox.textContent='لا توجد أقسام ظاهرة.';
        toggleAllBtn.textContent=s.searching?'تبديل المعروض':'تبديل الكل';
        toggleAllBtn.disabled=true; return;
      }
      counterBox.textContent=`مفتوح: ${s.openCount} — مغلق: ${s.closedCount} (الإجمالي: ${s.total})`;
      toggleAllBtn.disabled=false;
      toggleAllBtn.textContent=s.allOpen?`إغلاق ${scopeTxt}`:s.allClosed?`فتح ${scopeTxt}`:`تبديل ${scopeTxt}`;
    };
detailsEls.forEach(d => d.addEventListener('toggle', updateFooterState));
 toggleAllBtn.onclick = () => {
  const s = computeState();
  if (!s.total) {
    (showWarning || showInfo)('لا توجد أقسام ظاهرة للتبديل.');
    return;
  }
  const scopeTxt = s.searching ? 'المعروضة' : 'الكل';
  const shouldOpenAll = s.closedCount > 0;
  s.details.forEach(d => { d.open = shouldOpenAll; });

  (showSuccess || showInfo)(
    shouldOpenAll ? `تم فتح ${scopeTxt}.` : `تم إغلاق ${scopeTxt}.`
  );

  updateFooterState();
};

const clearMarks=root=>{
  root.querySelectorAll('mark').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));
  root.querySelectorAll('span[data-hl="1"]').forEach(s=>s.replaceWith(document.createTextNode(s.textContent)));
  root.normalize();
};

const highlightText=(root,q)=>{
  if(!q) return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null), texts=[];
  while(walker.nextNode()) texts.push(walker.currentNode);

  texts.forEach(node=>{
    const val=node.nodeValue||'';
    const low=val.toLowerCase();
    let i=low.indexOf(q);
    if(i===-1) return;

    const frag=document.createDocumentFragment();
    let last=0;
    while(i!==-1){
      if(i>last) frag.appendChild(document.createTextNode(val.slice(last,i)));
      const mark=document.createElement('mark');
      mark.textContent=val.slice(i,i+q.length);
      frag.appendChild(mark);
      last=i+q.length;
      i=low.indexOf(q,last);
    }
    if(last<val.length) frag.appendChild(document.createTextNode(val.slice(last)));

    const span=document.createElement('span');
    span.dataset.hl="1";
    span.appendChild(frag);
    node.replaceWith(span);
  });
};


searchInput.addEventListener('input', ()=>{
  const raw=searchInput.value||'', q=raw.trim().toLowerCase(), isSearching=!!q;
  clearSearchBtn.style.display=isSearching?'flex':'none';

  if(isSearching && !_preSearchOpenState){
    _preSearchOpenState=new Map();
    detailsEls.forEach(d=>_preSearchOpenState.set(d,!!d.open));
  }

  // فلترة + حساب score لكل قسم
  const visibleScored=[];
  detailsEls.forEach(d=>{
    clearMarks(d);
    const text=d.textContent.toLowerCase();
    const kw=(d.getAttribute('data-keywords')||'').toLowerCase();
    const title=(d.querySelector('summary')?.textContent||'').toLowerCase();

    const hit=!q || text.includes(q) || kw.includes(q) || title.includes(q);
    d.hidden=!hit;

    if(hit && isSearching){
      d.open=true;
      highlightText(d,q);

      let score=0;
      if(title.includes(q)) score+=3;
      if(kw.includes(q))    score+=2;
      if(text.includes(q))  score+=1;

      const firstPos=Math.min(
        title.indexOf(q)!==-1?title.indexOf(q):1e9,
        kw.indexOf(q)!==-1?kw.indexOf(q):1e9,
        text.indexOf(q)!==-1?text.indexOf(q):1e9
      );

      visibleScored.push({d,score,firstPos});
    }
  });

  // إعادة ترتيب المطابقات للأعلى
  if(isSearching){
    visibleScored.sort((a,b)=>b.score-a.score || a.firstPos-b.firstPos);
    reorderDetails(visibleScored.map(x=>x.d));
  }else{
    restoreOriginalOrder();
  }

  const visibleCount=detailsEls.filter(d=>!d.hidden).length;
  emptyBox.style.display=(isSearching && visibleCount===0)?"block":"none";

  if(!isSearching && _preSearchOpenState){
    detailsEls.forEach(d=>{
      if(_preSearchOpenState.has(d)) d.open=_preSearchOpenState.get(d);
      d.hidden=false; clearMarks(d);
    });
    _preSearchOpenState=null; emptyBox.style.display="none";
    restoreOriginalOrder();
  }

  updateFooterState();
});


 clearSearchBtn.onclick=()=>{
  searchInput.value=""; clearSearchBtn.style.display="none"; emptyBox.style.display="none";
  if(_preSearchOpenState){
    detailsEls.forEach(d=>{
      d.hidden=false;
      if(_preSearchOpenState.has(d)) d.open=_preSearchOpenState.get(d);
      clearMarks(d);
    });
    _preSearchOpenState=null;
  }
  restoreOriginalOrder();
  updateFooterState(); searchInput.focus();
};

    updateFooterState();
  }

  overlay.hidden=false;
  const input=overlay.querySelector('#helpInlineSearch');
  input.value=''; input.focus();
  overlay.querySelectorAll('details').forEach(d=>{ d.hidden=false; });
}

export function init(ctx){
  const GITHUB_PAGES_URL="https://ahmad-slmn.github.io/family-tree/";
  const shareBtn=byId('shareSiteBtn'),
        rateBtn =byId('rateSiteBtn'),
        noteBtn =byId('sendNoteBtn'),
        helpBtn =byId('helpBtn');

  if(shareBtn){
    shareBtn.addEventListener('click', async ()=>{
      const url=(location.hostname==="localhost"||location.hostname.startsWith("127."))?GITHUB_PAGES_URL:location.href;
      const title=document.title||'Family Tree App';
      try{ if(navigator.share){ await navigator.share({title,url}); return; } }catch{}
      try{ await navigator.clipboard.writeText(url); (showSuccess||showWarning||alert)('تم نسخ رابط الموقع.'); }
      catch{ prompt('انسخ الرابط يدويًا:', url); }
    });
  }

  if(rateBtn){
    rateBtn.addEventListener('click', ()=>{
      const rateUrl=(location.hostname==="localhost"||location.hostname.startsWith("127.")||location.protocol==="file:")?"./rate.html":(GITHUB_PAGES_URL+"rate.html");
      location.href=rateUrl;
    });
  }

  if(noteBtn){
    noteBtn.addEventListener('click', ()=>{
      if(window.ModalManager?.open){ window.ModalManager.open('noteModal'); return; }
      openInlineNoteModal({
        onSend: async (msg,setStatus)=>{
          const url=location.href, payload={msg,url,at:new Date().toISOString()};

          // حفظ الملاحظات محليًا (آخر 50)
          try{
            const history=JSON.parse(localStorage.getItem("notesHistory")||"[]");
            history.push(payload); while(history.length>50) history.shift();
            localStorage.setItem("notesHistory", JSON.stringify(history));
            localStorage.setItem("lastNote", JSON.stringify(payload));
          }catch{}

          const to=(localStorage.getItem('feedbackEmail')||'').trim();
          const subject=encodeURIComponent('ملاحظة حول موقع شجرة العائلة');
          const body=encodeURIComponent(msg+'\n\nرابط الصفحة:\n'+url);

          if(to){
            setStatus('سيتم فتح البريد لإرسال الملاحظة...', true);
            setTimeout(()=>{ location.href=`mailto:${to}?subject=${subject}&body=${body}`; },600);
            setTimeout(()=>{ document.getElementById('noteInlineOverlay').hidden=true; },1200);
            return;
          }

          try{
            await navigator.clipboard.writeText(msg+'\n\n'+url);
            setStatus('تم حفظ الملاحظة ونسخها. شكرًا لك.', true);
            setTimeout(()=>{ document.getElementById('noteInlineOverlay').hidden=true; },1200);
          }catch{
            setStatus('تم حفظ الملاحظة لكن تعذر النسخ. حاول مرة أخرى.', false);
          }
        }
      });
    });
  }

  if(helpBtn){
    helpBtn.addEventListener('click', ()=>{
      if(window.ModalManager?.open){ window.ModalManager.open('helpModal'); return; }
      openInlineHelpModal();
    });
  }

  return {};
}
