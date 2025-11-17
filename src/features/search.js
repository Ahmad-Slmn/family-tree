// features/search.js — الفلاتر + الاقتراحات + أدوات مساعدة للبحث
import { byId, el, textEl, showWarning } from '../utils.js';
import * as Model from '../model/families.js';
import * as TreeUI from '../ui/tree.js';
import * as Lineage from '../features/lineage.js';
import { setState, getState } from '../stateManager.js';

/* ========================
   ثوابت + أدوات التطبيع
   (محايدة سلوكيًا)
======================== */
const coll     = new Intl.Collator('ar', { usage:'search', sensitivity:'base', ignorePunctuation:true });
const AR_DIAC  = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g; // الحركات
const AR_TATWL = /\u0640/g;                                           // التطويل
const ALIF_ALL = /[اأإآ]/g;                                           // أشكال الألف

// تطبيع قوي للفحص/المطابقة
function normArSearch(s=''){
  return String(s).normalize('NFKC')
    .replace(AR_DIAC,'').replace(AR_TATWL,'')
    .replace(ALIF_ALL,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').trim();
}

// تطبيع للفهرسة (اسم + دور)
function normArIndex(s=''){
  return String(s).normalize('NFKC')
    .replace(AR_DIAC,'').replace(AR_TATWL,'')
    .replace(ALIF_ALL,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').trim();
}

// تطبيع لا يستبدل «ة/ى» (يحترم كتابة المستخدم)
function normArQuery(s=''){
  return String(s).normalize('NFKC')
    .replace(AR_DIAC,'').replace(AR_TATWL,'')
    .replace(ALIF_ALL,'ا').trim();
}

/* ========================
   إبراز مطابقات الاسم كما كتبها المستخدم
======================== */
const AR_MARKS_OPT = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]*';

function highlightInto(el, name, tokensRaw){
  el.textContent = '';
  const text = String(name||'');
  const toks = (tokensRaw||[]).filter(Boolean);
  if (!toks.length){ el.textContent = text; return; }

const tokenToAgnosticPattern = (tok)=>{
  let p = tok.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');   // هروب محارف الريجيكس فقط
  p = Array.from(p).join(AR_MARKS_OPT);               // السماح بالحركات/التطويل بين الحروف
  return AR_MARKS_OPT + p + AR_MARKS_OPT;             // حركات قبل/بعد التوكن
};



  const rx = new RegExp('(' + toks.map(tokenToAgnosticPattern).join('|') + ')', 'gu');
  let last = 0;
  for (const m of text.matchAll(rx)){
    if (m.index > last) el.append(text.slice(last, m.index));
    const mark = document.createElement('mark'); mark.textContent = m[0];
    el.append(mark); last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

/* ========================
   أدوات مساعدة داخلية
======================== */

// تطابق كبادئة كلمة بعد التطبيع (احتياطي لـ collator)
function startsWithWord(haystackWord, query){
  const a = normArSearch(haystackWord);
  const b = normArSearch(query);
  if (!b) return true;
  if (a.startsWith(b)) return true;
  return coll.compare(a.slice(0, b.length), b) === 0;
}

/* كاش تطبيع على الشخص (يحافظ على العقدة) */
export function cacheNorm(p){
  if (!p) return;
  p._normName = TreeUI.normalizeAr(p?.name||'');
  p._normRole = TreeUI.normalizeAr(p?.role||'');
}

/* تحديث شخص بالـ mutation في كل المواضع (نفس التغطية الحالية) */
export function updatePersonEverywhere(fam, personId, mutateFn){
  if (!fam || !personId || !mutateFn) return;

  const touch = (p)=>{ if (p && p._id === personId) mutateFn(p); };

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  tops.forEach(p=>{
    touch(p);
    (p?.children||[]).forEach(touch);
    (p?.wives||[]).forEach(touch);
  });

  // مرآة زوجات الجذر (مطابق للمنطق السابق)
  const mirror = (fam.rootPerson && Array.isArray(fam.rootPerson.wives)) ? fam.rootPerson.wives : [];
  mirror.forEach(w=>{
    touch(w);
    (w?.children||[]).forEach(touch);
  });
}

/* جمع أشخاص العائلة بدون تكرار (يحافظ على سلوكك تمامًا) */
function listPersonsOfFamily(fam){
  if (!fam) return [];
  const seenStrict = new Set(); // id:PID أو nr:name|role
  const seenLoose  = new Set(); // nr:name|role فقط
  const acc = [];

  const add = (p)=>{
    if (!p) return;
    const mother = (p?.bio?.motherName || '').trim();

    // العشيرة الموروثة (إن أمكن) لضمان اتساق الفلاتر والاقتراحات
    const resolvedClan = Lineage.resolveClan(p, fam);
    const clan   = (resolvedClan || p?.bio?.clan || '').trim();

    const loose  = `nr:${(p.name||'').trim()}|${(p.role||'').trim()}|${mother}|${clan}`;

    const strict = p._id ? `id:${p._id}` : loose;
    if (seenStrict.has(strict) || seenLoose.has(loose)) return;
    seenStrict.add(strict); seenLoose.add(loose);
    acc.push({ name: p.name||'', role: p.role||'', ref: p });
  };

  const tops = [
    ...(Array.isArray(fam.ancestors) ? fam.ancestors : []),
    fam.father, fam.rootPerson, ...(fam.wives||[])
  ].filter(Boolean);

  tops.forEach(p=>{
    add(p);
    (p.children||[]).forEach(add);
    if (p !== fam.rootPerson){
      (p.wives||[]).forEach(w=>{ add(w); (w.children||[]).forEach(add); });
    }
  });

  return acc;
}

/* ========================
   بناء قائمة الاقتراحات
======================== */
function buildSuggestions(q){
  const fam = Model.getFamilies()[getState().selectedFamily];
  const lineageCtx = Lineage.buildLineageContext(fam);
  const all = listPersonsOfFamily(fam);
  const rawQ = String((q||'').trim());
  if (!rawQ) return [];

  const filters = (getState().filters || {});
  const tokensRaw = rawQ.split(/\s+/).filter(Boolean);          // لأغراض الإبراز
  const t        = normArQuery(rawQ);                           // للمطابقة
  const tokens   = t.split(/\s+/).filter(Boolean);
  const needsLiteral = /[ةى]/.test(rawQ);                       // تشديد المطابقة إذا كتب المستخدم «ة/ى»

  // تمرير الفلاتر
  const pass = (p)=>{
    const ref = p.ref || p;

    if (filters.role && TreeUI.roleGroup(ref) !== filters.role) return false;

    if (filters.clan){
      // نص العشيرة كما أدخله المستخدم (بعد التطبيع)
      const fc = TreeUI.normalizeAr(String(filters.clan || '')).trim();
      if (fc){
        // استخدام العشيرة الموروثة من نظام النسب
        const resolvedClan = Lineage.resolveClan(ref, fam, lineageCtx);

        // مصادر أخرى محتملة للعشيرة من الـ bio مباشرة
        const directClan  = (ref?.bio?.clan || '').trim();
        const motherClan  = (ref?.bio?.motherClan || '').trim();
        const gmClan1     = (ref?.bio?.maternalGrandmotherClan || '').trim();
        const gmClan2     = (ref?.bio?.paternalGrandmotherClan || '').trim();

        // طبّع كل المرشّحين بنفس التطبيع المستخدم في الفلتر
        const candidates = [resolvedClan, directClan, motherClan, gmClan1, gmClan2]
          .map(v => TreeUI.normalizeAr(String(v || '')).trim())
          .filter(Boolean);

        // يكفي أن يظهر نص الفلتر داخل أي من المرشّحين
        const hit = candidates.some(pc => pc.includes(fc));
        if (!hit) return false;
      }
    }


    if (filters.birthFrom || filters.birthTo){
      const by = (ref?.bio?.birthYear != null && String(ref.bio.birthYear).trim())   ? String(ref.bio.birthYear).padStart(4,'0') : '';
      const bd = String(ref?.bio?.birthDate||'').trim();
      const bNorm = bd ? bd : (by ? `${by}-01-01` : '');
      if (!bNorm) return false;
      if (filters.birthFrom && bNorm < String(filters.birthFrom)) return false;
      if (filters.birthTo   && bNorm > String(filters.birthTo))   return false;
    }
    return true;
  };

  return all
    .filter(pass)
    .filter(p => {
      const nameRaw = String(p.name || '');
      const roleRaw = String(p.role || '');

      // كلمات مطبّعة للاسم + الدور
      const hayWordsNorm = normArIndex(`${nameRaw} ${roleRaw}`).split(/\s+/).filter(Boolean);

      // كل توكن يجب أن يطابق كبادئة لأي كلمة
      const normOk = tokens.every(tok =>
        hayWordsNorm.some(w => w.startsWith(tok) || coll.compare(w.slice(0, tok.length), tok) === 0)
      );
      if (!normOk) return false;

      // عند وجود «ة/ى» في استعلام المستخدم نفرض تطابقًا حرفيًا داخل الاسم فقط
      if (!needsLiteral) return true;

      const hayWordsRawName = nameRaw.split(/\s+/).filter(Boolean);
      return tokensRaw.every(rt => hayWordsRawName.some(w => w.includes(rt)));
    })
    .sort((a,b)=>{
      const pa = a.ref || a, pb = b.ref || b;
      const sa = TreeUI.scoreForSearch ? TreeUI.scoreForSearch(pa, tokens) : 0;
      const sb = TreeUI.scoreForSearch ? TreeUI.scoreForSearch(pb, tokens) : 0;
      if (sb !== sa) return sb - sa;
      return coll.compare(String(pa.name||''), String(pb.name||''));
    })
    .slice(0, 12);
}

/* ========================
   رسم الاقتراحات (مع نزع الازدواج)
======================== */
function renderSuggestions(items, dom){
  if (!dom.suggestBox) return;

  if (!items.length){
    dom.suggestBox.classList.remove('show');
    dom.suggestBox.textContent = '';
    return;
  }

  const seenStrict = new Set(); // id:PID أو nr:name:role
  const seenLoose  = new Set(); // nr:name:role فقط
  const unique = [];

  for (const it of items){
    const ref   = it.ref || it;
 const nName = normArIndex(String(ref?.name || ''));
const nRole = normArIndex(String(ref?.role || ''));
const nMom  = normArIndex(String(ref?.bio?.motherName || ''));
const nClan = normArIndex(String(ref?.bio?.clan || ''));
const loose  = `nr:${nName}:${nRole}:${nMom}:${nClan}`;

    const strict = ref?._id ? `id:${ref._id}` : loose;
    if (seenStrict.has(strict) || seenLoose.has(loose)) continue;
    seenStrict.add(strict); seenLoose.add(loose);
    unique.push(it);
  }

  dom.suggestBox.textContent = '';
  const tokensRaw = String(byId('quickSearch')?.value || '').split(/\s+/).filter(Boolean);

  unique.forEach((it,i)=>{
    const d = el('div','item');
    d.setAttribute('role','option');
    d.dataset.index = String(i);
    d.dataset.name  = String(it.name);
    d.dataset.role  = String(it.role);
    d.dataset.id    = String(it.ref?._id || '');

    const nameSpan = document.createElement('span');
    highlightInto(nameSpan, String(it.name||''), tokensRaw);
    d.append(nameSpan, textEl('small', ` (${it.role})`));
    dom.suggestBox.appendChild(d);
  });

  dom.suggestBox.classList.add('show');
}

/* ========================
   صندوق الفلاتر العلوية (إنشاء مرة واحدة)
======================== */
function mountAdvancedFilters(){
  const topBar = document.querySelector('.top-bar') || document.body;
  if (byId('advFilters')) return;

  const box = document.createElement('div');
  box.id = 'advFilters';
  box.className = 'filters collapsible';
  box.innerHTML = `
    <div class="filters-card" role="group" aria-label="فلاتر البحث">
      <h3 class="filters-title">فلاتر البحث المتقدمة</h3>

      <div class="filters-grid">

        <div class="form-field">
          <label for="fltRole">الدور</label>
          <select id="fltRole">
            <option value="">الكل</option>
            <option value="ابن">ابن</option>
            <option value="بنت">بنت</option>
            <option value="الأب">الأب</option>
            <option value="جد">جد</option>
            <option value="زوجة">زوجة</option>
          </select>
        </div>

        <div class="form-field clan-field">
          <label for="fltClan">العشيرة</label>
          <div class="input-wrap">
            <input id="fltClan" type="search" placeholder="اكتب اسم العشيرة" />
            <button id="clearClan" type="button" class="clear-btn" aria-label="مسح" title="مسح">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div class="form-field">
          <label for="fltFrom">من تاريخ الميلاد</label>
          <input id="fltFrom" type="date" />
        </div>

        <div class="form-field">
          <label for="fltTo">إلى تاريخ الميلاد</label>
          <input id="fltTo" type="date" />
        </div>

      </div>
    </div>
  `;
  topBar.after(box);

  // تحميل حالة الفلاتر من state (يحافظ على نفس المصدر)
  const s = getState().filters || {};
  byId('fltRole').value = s.role || '';
  byId('fltClan').value = s.clan || '';
  byId('fltFrom').value = s.birthFrom || '';
  byId('fltTo').value   = s.birthTo || '';

  // دفع الحالة إلى state + localStorage (نفس السلوك)
  function push(){
    const patch = {
      filters:{
        role: byId('fltRole').value || '',
        clan: (byId('fltClan').value||'').trim(),
        birthFrom: byId('fltFrom').value || '',
        birthTo: byId('fltTo').value || ''
      }
    };
    setState(patch);
    localStorage.setItem('flt_role', patch.filters.role);
    localStorage.setItem('flt_clan', patch.filters.clan);
    localStorage.setItem('flt_from', patch.filters.birthFrom);
    localStorage.setItem('flt_to', patch.filters.birthTo);
  }

  // زر مسح العشيرة + إظهار/إخفاء الزر
  const clanInput = byId('fltClan');
  const clanClear = byId('clearClan');

  function syncClanClear(){
    if (!clanInput || !clanClear) return;
    const has = !!(clanInput.value && clanInput.value.trim());
    if (has) clanClear.removeAttribute('hidden'); else clanClear.setAttribute('hidden','');
  }

  clanClear?.addEventListener('click', ()=>{
    if (!clanInput) return;
    clanInput.value = '';
    push(); syncClanClear(); clanInput.focus();
  });

  ['input','change'].forEach(ev=> clanInput?.addEventListener(ev, syncClanClear));
  syncClanClear();

  // تطبيق الفلاتر عند التغيير
  ['change','input'].forEach(ev=>{
    byId('fltRole').addEventListener(ev,push);
    byId('fltClan').addEventListener(ev,push);
    byId('fltFrom').addEventListener(ev,push);
    byId('fltTo').addEventListener(ev,push);
  });
}

/* ========================
   تفعيل/طيّ صندوق الفلاتر
======================== */
function wireFiltersToggle(){
  const panel = byId('advFilters');
  const btn   = byId('filtersToggle');
  if (!panel || !btn) return;

  // حالة الفلاتر الحالية
  const s = getState().filters || {};
  const hasActive =
    (s.role && s.role.trim()) ||
    (s.clan && s.clan.trim()) ||
    (s.birthFrom && s.birthFrom.trim()) ||
    (s.birthTo && s.birthTo.trim());

  // تفضيل المستخدم السابق (إن وُجد) عندما لا تكون هناك فلاتر مفعّلة
  const storedOpen = localStorage.getItem('advFiltersOpen') === '1';

  // إن وُجدت فلاتر فعّالة ⇒ اللوحة مفتوحة إلزاميًا
  // وإلا نرجع لتفضيل المستخدم
  const startOpen = hasActive ? true : storedOpen;

  const setOpen = (nextOpen)=>{
    const target = nextOpen ? panel.scrollHeight + 'px' : '0px';
    panel.style.maxHeight = target;
    panel.classList.toggle('open', nextOpen);
    btn.setAttribute('aria-expanded', String(nextOpen));

    const txt = btn.querySelector('.btn-text');
    if (txt) txt.textContent = nextOpen ? 'إخفاء الفلاتر' : 'إظهار الفلاتر';
  };

  // تطبيق الحالة الابتدائية
  setOpen(startOpen);

  btn.addEventListener('click', () => {
    const s = getState().filters || {};
    const hasActive =
      (s.role && s.role.trim()) ||
      (s.clan && s.clan.trim()) ||
      (s.birthFrom && s.birthFrom.trim()) ||
      (s.birthTo && s.birthTo.trim());

    // لا تسمح بإخفاء الفلاتر إذا كانت فعّالة
    if (hasActive){
      showWarning('يتعذّر إخفاء لوحة الفلاتر لوجود فلاتر مفعّلة. يُرجى مسح الفلاتر، وجعل (الدور) على وضع (الكل) أولًا قبل الإخفاء.');
      return;
    }

    const nextOpen = !panel.classList.contains('open');
    setOpen(nextOpen);

    // لا توجد فلاتر فعّالة هنا ⇒ خزّن تفضيل المستخدم
    localStorage.setItem('advFiltersOpen', nextOpen ? '1' : '0');
  });


  panel.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'max-height') return;
    if (panel.classList.contains('open')) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
    }
  });

  window.addEventListener('resize', () => {
    if (panel.classList.contains('open')) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
    }
  });
}

/* ========================
   التهيئة العامة للبحث
======================== */
export function init(ctx){
  mountAdvancedFilters();
  wireFiltersToggle();

  // مراجع DOM
  ctx.dom.searchInput = byId('quickSearch');
  ctx.dom.suggestBox  = byId('searchSuggestions');

  // زر مسح البحث السريع
  const clearQuickBtn = byId('clearQuick');
  function syncQuickClear(){
    if (!ctx.dom.searchInput || !clearQuickBtn) return;
    const has = !!(ctx.dom.searchInput.value && ctx.dom.searchInput.value.trim());
    if (has) clearQuickBtn.removeAttribute('hidden'); else clearQuickBtn.setAttribute('hidden','');
  }
  clearQuickBtn?.addEventListener('click', ()=>{
    if (!ctx.dom.searchInput) return;
    ctx.dom.searchInput.value = '';
    setState({ search: '' });
    localStorage.removeItem('searchText'); 
    renderSuggestions([], ctx.dom);
    ctx.dom.searchInput.setAttribute('aria-expanded','false');
    syncQuickClear();
    ctx.dom.searchInput.focus();
  });
  ctx.dom.searchInput?.addEventListener('input', syncQuickClear);
  syncQuickClear();
// استعادة آخر بحث محفوظ بعد إعادة التحميل
const savedSearch = (localStorage.getItem('searchText') || '').trim();
if (savedSearch && ctx.dom.searchInput){
  ctx.dom.searchInput.value = savedSearch;
  setState({ search: savedSearch });
  syncQuickClear();
}

  // Debounce للمدخل
  let _qTimer = null;
  const debounceRun = (fn, ms=150)=>{ if (_qTimer) clearTimeout(_qTimer); _qTimer = setTimeout(fn, ms); };

  // تحديث الاقتراحات مع مزامنة الحالة
  ctx.dom.searchInput?.addEventListener('input', (e) => {
    const q = e.target.value || '';
    setState({ search: q });
    localStorage.setItem('searchText', q);
    debounceRun(() => {
      renderSuggestions(buildSuggestions(q), ctx.dom);
      if (ctx.dom.suggestBox){
        ctx.dom.searchInput.setAttribute('aria-expanded',
          ctx.dom.suggestBox.classList.contains('show') ? 'true' : 'false');
      }
    }, 150);
  });

  // إغلاق القائمة بالمفاتيح الشائعة
  ctx.dom.searchInput?.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' || e.key === 'Enter'){
      ctx.dom.suggestBox?.classList.remove('show');
      ctx.dom.searchInput?.setAttribute('aria-expanded','false');
    }
  });

  // نقر على الاقتراح: يملأ الحقل ويفتح البطاقة إن وُجد id
  ctx.dom.suggestBox?.addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (!it) return;

    const id   = it.dataset.id   || '';
    const name = it.dataset.name || '';
    const role = it.dataset.role || '';
    const displayName = role ? `${name} (${role})` : name;

    if (ctx.dom.searchInput){
      ctx.dom.searchInput.value = displayName;
      setState({ search: displayName });
      localStorage.setItem('searchText', displayName);
    }
    ctx.dom.suggestBox.classList.remove('show');
    ctx.dom.searchInput?.setAttribute('aria-expanded', 'false');

    if (!id){ ctx.dom.searchInput?.focus(); return; }

    // تفريغ الفلاتر مؤقتًا لفتح البطاقة ثم إرجاعها (حفاظًا على سلوكك)
    const prevFilters = getState().filters || {};
    const cleared = { role: '', clan: '', birthFrom: '', birthTo: '' };
    setState({ filters: cleared });

    ctx.redrawUI?.();
    requestAnimationFrame(() => {
      ctx.bus.emit('ui:openPersonById', { id, force: true });
      setState({ filters: prevFilters });
      ctx.dom.searchInput?.focus();
    });
  });

  // تطبيع مسبق للأشخاص (مرة أولى)
  const fams = Model.getFamilies();
  const walk = (p)=>{ if (!p) return; cacheNorm(p); (p.children||[]).forEach(walk); (p.wives||[]).forEach(walk); };
  for (const k of Object.keys(fams)){
    const f = fams[k];
    const tops = [
      ...(Array.isArray(f?.ancestors) ? f.ancestors : []),
      f?.father, f?.rootPerson, ...(f?.wives || [])
    ].filter(Boolean);
    tops.forEach(walk);
  }

  // تطبيع كسول عند الخمول (نفس النتيجة، حمل أقل)
function walkCache(p){
  if (!p) return;
  cacheNorm(p);
  (p.children || []).forEach(walkCache);
  (p.wives    || []).forEach(walkCache);
}

if ('requestIdleCallback' in window){
  requestIdleCallback(() => {
    const fams = Model.getFamilies();
    for (const key of Object.keys(fams)){
      const f = fams[key];
      const tops = [
        ...(Array.isArray(f?.ancestors) ? f.ancestors : []),
        f?.father,
        f?.rootPerson,
        ...(f?.wives || [])
      ].filter(Boolean);

      for (const p of tops) walkCache(p);
    }
  }, { timeout: 1500 });
}
  // فتح بطاقة شخص بالمعرّف القادم من الاقتراحات أو من أي وحدة أخرى
  ctx.bus.on('ui:openPersonById', ({ id }) => {
    if (!id) return;
    ctx.redrawUI?.();                       // تأكد أن البطاقة في DOM
    ctx.TreeUI?.refreshAvatarById?.(id);    // تزامن الصورة إن لزم

    // استخدم المعالج العام إن تم تمريره في السياق، وإلا مرّر الحدث المعهود
    if (typeof ctx?.onShowDetails === 'function') {
      ctx.onShowDetails(id);
    } else {
      ctx.bus.emit('person:open', { person: { _id: id } });
    }
  });


  return { cacheNorm, updatePersonEverywhere };
}
