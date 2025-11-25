// features/search.js — الفلاتر + الاقتراحات + أدوات مساعدة للبحث
import { byId, el, textEl, showWarning } from '../utils.js';
import * as Model from '../model/families.js';
import * as TreeUI from '../ui/tree.js';
import { roleGroup, ROLE_FILTER_VALUES } from '../model/roles.js';
import * as Lineage from '../features/lineage.js';
import { setState, getState } from '../stateManager.js';

/* ===== ثوابت وتطبيع عربي (محايد سلوكيًا) ===== */
const coll = new Intl.Collator('ar',{usage:'search',sensitivity:'base',ignorePunctuation:true});
const AR_DIAC=/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,AR_TATWL=/\u0640/g,ALIF_ALL=/[اأإآ]/g;
const baseNorm = (s='')=>String(s).normalize('NFKC').replace(AR_DIAC,'').replace(AR_TATWL,'').replace(ALIF_ALL,'ا').trim();
const normArSearch = (s='')=>baseNorm(s).replace(/ة/g,'ه').replace(/ى/g,'ي'); // تطبيع قوي للمطابقة
const normArIndex  = (s='')=>baseNorm(s).replace(/ة/g,'ه').replace(/ى/g,'ي'); // تطبيع للفهرسة
const normArQuery  = (s='')=>baseNorm(s);                                   // يحترم «ة/ى» كما كتبها المستخدم

/* ===== إبراز مطابقات الاسم كما كتبه المستخدم ===== */
const AR_MARKS_OPT='[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]*';
function highlightInto(targetEl,name,tokensRaw){
  targetEl.textContent='';
  const text=String(name||'');
  const toks=(tokensRaw||[]).map(t=>String(t||'').trim()).filter(Boolean);
  if(!toks.length){targetEl.textContent=text;return;}
  const esc=(ch)=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const tokPat=(tok)=>{
    const core=[...tok].map(ch=>(/[اأإآ]/u.test(ch)?'[اأإآ]':esc(ch))).join(AR_MARKS_OPT);
    return AR_MARKS_OPT+core+AR_MARKS_OPT;
  };
  const rx=new RegExp('('+toks.map(tokPat).join('|')+')','gu');
  let last=0;
  for(const m of text.matchAll(rx)){
    if(m.index>last) targetEl.append(text.slice(last,m.index));
    const mark=document.createElement('mark'); mark.textContent=m[0]; targetEl.append(mark);
    last=m.index+m[0].length;
  }
  if(last<text.length) targetEl.append(text.slice(last));
}

/* ===== أدوات داخلية ===== */
function startsWithWord(word,q){
  const a=normArSearch(word),b=normArSearch(q);
  return !b || a.startsWith(b) || coll.compare(a.slice(0,b.length),b)===0;
}

/* تخزين التطبيع على الشخص لتسريع البحث */
export function cacheNorm(p){
  if(!p) return;
  p._normName=TreeUI.normalizeAr(p?.name||'');
  p._normRole=TreeUI.normalizeAr(p?.role||'');
}

/* تحديث شخص بالـ mutation في كل المواضع */
export function updatePersonEverywhere(fam,personId,mutateFn){
  if(!fam||!personId||!mutateFn) return;
  const touch=(p)=>{if(p&&p._id===personId) mutateFn(p);};
  const tops=[...(Array.isArray(fam.ancestors)?fam.ancestors:[]),fam.father,fam.rootPerson,...(fam.wives||[])].filter(Boolean);
  tops.forEach(p=>{touch(p);(p?.children||[]).forEach(touch);(p?.wives||[]).forEach(touch);});
  const mirror=(fam.rootPerson&&Array.isArray(fam.rootPerson.wives))?fam.rootPerson.wives:[];
  mirror.forEach(w=>{touch(w);(w?.children||[]).forEach(touch);});
}

/* جمع أشخاص العائلة بدون تكرار */
function listPersonsOfFamily(fam){
  if(!fam) return [];
  const seenStrict=new Set(),seenLoose=new Set(),acc=[];
  const add=(p)=>{
    if(!p) return;
    const mother=(p?.bio?.motherName||'').trim();
    const resolvedClan=Lineage.resolveClan(p,fam);
    const clan=(resolvedClan||p?.bio?.clan||'').trim();
    const loose=`nr:${(p.name||'').trim()}|${(p.role||'').trim()}|${mother}|${clan}`;
    const strict=p._id?`id:${p._id}`:loose;
    if(seenStrict.has(strict)||seenLoose.has(loose)) return;
    seenStrict.add(strict); seenLoose.add(loose);
    acc.push({name:p.name||'',role:p.role||'',cognomen:p?.bio?.cognomen||'',ref:p});
  };
  const tops=[...(Array.isArray(fam.ancestors)?fam.ancestors:[]),fam.father,fam.rootPerson,...(fam.wives||[])].filter(Boolean);
  tops.forEach(p=>{
    add(p); (p.children||[]).forEach(add);
    if(p!==fam.rootPerson) (p.wives||[]).forEach(w=>{add(w);(w.children||[]).forEach(add);});
  });
  return acc;
}

/* ===== ترتيب هرمي ثابت مطابق للشجرة (للترتيب في البحث/الاقتراحات) ===== */
function buildHierarchyIndex(fam){
  const order = new Map();
  let i = 0;

  const put = (p)=>{
    if(!p) return;
    const id = p._id || p.id || p.__tempId;
    if(id && !order.has(id)) order.set(id, i++);
  };

  // preorder traversal مشابه لترتيب الرسم
  const walk = (p)=>{
    if(!p) return;
    put(p);

    // زوجات الشخص (إن لم يكن rootPerson سيتم إدراجهن هنا)
    const wives = Array.isArray(p.wives) ? p.wives : [];
    wives.forEach(w=>{
      put(w);
      (w?.children||[]).forEach(walk);
    });

    // الأبناء
    (p.children||[]).forEach(walk);
  };

  // 1) الأجداد بالترتيب التسلسلي
  (Array.isArray(fam?.ancestors) ? fam.ancestors : []).forEach(walk);

  // 2) الأب
  if(fam?.father) walk(fam.father);

  // 3) صاحب الشجرة
  if(fam?.rootPerson) walk(fam.rootPerson);

  // 4) الزوجات الأعلى (إن كانت مخزنة بمستوى العائلة)
  (fam?.wives||[]).forEach(walk);

  return order;
}

function getHierarchyRank(orderMap, p){
  const ref = p?.ref || p;
  const id = ref?._id || ref?.id || ref?.__tempId;
  if(id && orderMap.has(id)) return orderMap.get(id);
  return Number.MAX_SAFE_INTEGER; // أي شيء غير معروف يأتي آخرًا
}


/* ===== بناء قائمة الاقتراحات ===== */
function buildSuggestions(q){
const fam=Model.getFamilies()[getState().selectedFamily];
const lineageCtx=Lineage.buildLineageContext(fam);
const all=listPersonsOfFamily(fam);

// خريطة ترتيب هرمي ثابت
const hierarchyOrder = buildHierarchyIndex(fam);

  const rawQ=String((q||'').trim()); if(!rawQ) return [];

  const filters=getState().filters||{};
  const tokensRaw=rawQ.split(/\s+/).filter(Boolean);
  const t=normArQuery(rawQ);
  const tokens=t.split(/\s+/).filter(Boolean);
  const needsLiteral=/[ةى]/.test(rawQ);

  const pass=(p)=>{
    const ref=p.ref||p;
    if(filters.role && roleGroup(ref)!==filters.role) return false;

    if(filters.clan){
      const fc=TreeUI.normalizeAr(String(filters.clan||'')).trim();
      if(fc){
        const resolvedClan=Lineage.resolveClan(ref,fam,lineageCtx);
        const candidates=[resolvedClan,ref?.bio?.clan,ref?.bio?.motherClan,ref?.bio?.maternalGrandmotherClan,ref?.bio?.paternalGrandmotherClan]
          .map(v=>TreeUI.normalizeAr(String(v||'')).trim()).filter(Boolean);
        if(!candidates.some(pc=>pc.includes(fc))) return false;
      }
    }

    if(filters.birthFrom||filters.birthTo){
      const by=(ref?.bio?.birthYear!=null && String(ref.bio.birthYear).trim())?String(ref.bio.birthYear).padStart(4,'0'):'';
      const bd=String(ref?.bio?.birthDate||'').trim();
      const bNorm=bd?bd:(by?`${by}-01-01`:'');
      if(!bNorm) return false;
      if(filters.birthFrom && bNorm<String(filters.birthFrom)) return false;
      if(filters.birthTo && bNorm>String(filters.birthTo)) return false;
    }
    return true;
  };

  return all
    .filter(pass)
    .filter(p=>{
      const nameRaw=String(p.name||''),roleRaw=String(p.role||''),cogRaw=String(p.cognomen||p.ref?.bio?.cognomen||'');
      const hayWordsNorm=normArIndex(`${nameRaw} ${roleRaw} ${cogRaw}`).split(/\s+/).filter(Boolean);
      const normOk=tokens.every(tok=>hayWordsNorm.some(w=>w.startsWith(tok)||coll.compare(w.slice(0,tok.length),tok)===0));
      if(!normOk) return false;
      if(!needsLiteral) return true;
      const hayWordsRaw=`${nameRaw} ${cogRaw}`.split(/\s+/).filter(Boolean);
      return tokensRaw.every(rt=>hayWordsRaw.some(w=>w.includes(rt)));
    })
    .map(p=>{
      const ref=p.ref||p;
      const nameNorm=normArIndex(String(ref?.name||'')),roleNorm=normArIndex(String(ref?.role||'')),cogNorm=normArIndex(String(ref?.bio?.cognomen||''));
      const hitInNameRole=tokens.some(tk=>(nameNorm+' '+roleNorm).includes(tk));
      const hitInCog=tokens.some(tk=>cogNorm.includes(tk));
      return {...p,_matchField:(!hitInNameRole&&hitInCog)?'cognomen':'nameRole'};
    })
.sort((a,b)=>{
  const pa=a.ref||a, pb=b.ref||b;

  // 1) الترتيب الهرمي أولًا
  const ra = getHierarchyRank(hierarchyOrder, pa);
  const rb = getHierarchyRank(hierarchyOrder, pb);
  if(ra !== rb) return ra - rb;

  // 2) داخل نفس المستوى: الأفضل مطابقة (اختياريًا)
  const sa=TreeUI.scoreForSearch?TreeUI.scoreForSearch(pa,tokens):0;
  const sb=TreeUI.scoreForSearch?TreeUI.scoreForSearch(pb,tokens):0;
  const sa2=sa-(a._matchField==='cognomen'?2:0);
  const sb2=sb-(b._matchField==='cognomen'?2:0);
  if(sb2 !== sa2) return sb2 - sa2;

  // 3) ثم الاسم
  return coll.compare(String(pa.name||''), String(pb.name||''));
})

    .slice(0,12);
}

/* ===== رسم الاقتراحات مع نزع الازدواج ===== */
function renderSuggestions(items,dom){
  const box=dom.suggestBox; if(!box) return;
  if(!items.length){box.classList.remove('show');box.textContent='';return;}

  const seenStrict=new Set(),seenLoose=new Set(),unique=[];
  for(const it of items){
    const ref=it.ref||it;
    const nName=normArIndex(String(ref?.name||'')),nRole=normArIndex(String(ref?.role||'')),
          nMom=normArIndex(String(ref?.bio?.motherName||'')),nClan=normArIndex(String(ref?.bio?.clan||''));
    const loose=`nr:${nName}:${nRole}:${nMom}:${nClan}`;
    const strict=ref?._id?`id:${ref._id}`:loose;
    if(seenStrict.has(strict)||seenLoose.has(loose)) continue;
    seenStrict.add(strict); seenLoose.add(loose); unique.push(it);
  }

  box.textContent='';
  const tokensRaw=String(byId('quickSearch')?.value||'').split(/\s+/).filter(Boolean);

  unique.forEach((it,i)=>{
    const d=el('div','item');
    d.setAttribute('role','option');
    d.dataset.index=String(i);
    d.dataset.name=String(it.name);
    d.dataset.role=String(it.role);
    d.dataset.id=String(it.ref?._id||'');

    const nameSpan=document.createElement('span'); highlightInto(nameSpan,String(it.name||''),tokensRaw);
    const small=document.createElement('small'); small.textContent=it.role?` (${it.role})`:'';
    d.append(nameSpan,small);

    // اعرض اللقب فقط إذا كانت المطابقة باللقب
    if(it._matchField==='cognomen'){
      const tag=textEl('span','باللقب','suggest-tag');
      tag.style.cssText='margin-inline-start:.5rem;font-size:.75em;opacity:.8';
      d.appendChild(tag);

      const ref=it.ref||it;
      const cg=String(ref?.bio?.cognomen||it.cognomen||'').trim();
      if(cg){
        const cgDiv=el('div','suggest-cognomen');
        cgDiv.style.cssText='font-size:.8em;opacity:.85;margin-top:.15rem';
        const cgSpan=document.createElement('span'); 
        highlightInto(cgSpan,cg,tokensRaw);
        cgDiv.append(textEl('span','اللقب: '),cgSpan);
        d.appendChild(cgDiv);
      }
    }

    box.appendChild(d);
  });

  box.classList.add('show');
}

/* ===== إنشاء صندوق الفلاتر العلوية مرة واحدة ===== */
function mountAdvancedFilters(){
  const topBar=document.querySelector('.top-bar')||document.body;
  if(byId('advFilters')) return;

  const box=document.createElement('div');
  box.id='advFilters';
  box.className='filters collapsible';
  box.innerHTML=`
    <div class="filters-card" role="group" aria-label="فلاتر البحث">
      <h3 class="filters-title">فلاتر البحث المتقدمة</h3>
      <div class="filters-grid">
        <div class="form-field">
          <label for="fltRole">الدور</label>
          <select id="fltRole"><option value="">الكل</option></select>
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
    </div>`;
  topBar.after(box);

  const roleSelect=byId('fltRole');
  if(roleSelect){
    const existing=new Set([...roleSelect.options].map(o=>o.value));
    ROLE_FILTER_VALUES.forEach(v=>{
      if(!v||existing.has(v)) return;
      const opt=document.createElement('option'); opt.value=v; opt.textContent=v; roleSelect.appendChild(opt);
    });
  }

  const s=getState().filters||{};
  byId('fltRole').value=s.role||'';
  byId('fltClan').value=s.clan||'';
  byId('fltFrom').value=s.birthFrom||'';
  byId('fltTo').value=s.birthTo||'';

  const push=()=>{
    const patch={filters:{
      role:byId('fltRole').value||'',
      clan:(byId('fltClan').value||'').trim(),
      birthFrom:byId('fltFrom').value||'',
      birthTo:byId('fltTo').value||''
    }};
    setState(patch);
    localStorage.setItem('flt_role',patch.filters.role);
    localStorage.setItem('flt_clan',patch.filters.clan);
    localStorage.setItem('flt_from',patch.filters.birthFrom);
    localStorage.setItem('flt_to',patch.filters.birthTo);
  };

  const clanInput=byId('fltClan'),clanClear=byId('clearClan');
const syncClanClear=()=>{
  if(!clanInput||!clanClear) return;
  const has=!!(clanInput.value&&clanInput.value.trim());
  if(has) clanClear.removeAttribute('hidden');
  else clanClear.setAttribute('hidden','');
};


  clanClear?.addEventListener('click',()=>{
    if(!clanInput) return;
    clanInput.value=''; push(); syncClanClear(); clanInput.focus();
  });
  ['input','change'].forEach(ev=>clanInput?.addEventListener(ev,syncClanClear));
  syncClanClear();

  ['change','input'].forEach(ev=>{
    byId('fltRole').addEventListener(ev,push);
    byId('fltClan').addEventListener(ev,push);
    byId('fltFrom').addEventListener(ev,push);
    byId('fltTo').addEventListener(ev,push);
  });
}

/* ===== تفعيل/طي صندوق الفلاتر ===== */
function wireFiltersToggle(){
  const panel=byId('advFilters'),btn=byId('filtersToggle');
  if(!panel||!btn) return;

  const hasActive=()=>{
    const s=getState().filters||{};
    return (s.role&&s.role.trim())||(s.clan&&s.clan.trim())||(s.birthFrom&&s.birthFrom.trim())||(s.birthTo&&s.birthTo.trim());
  };

  const storedOpen=localStorage.getItem('advFiltersOpen')==='1';
  const startOpen=hasActive()?true:storedOpen;

  const setOpen=(next)=>{
    panel.style.maxHeight=next?panel.scrollHeight+'px':'0px';
    panel.classList.toggle('open',next);
    btn.setAttribute('aria-expanded',String(next));
    const txt=btn.querySelector('.btn-text');
    if(txt) txt.textContent=next?'إخفاء الفلاتر':'إظهار الفلاتر';
  };

  setOpen(startOpen);

  btn.addEventListener('click',()=>{
    if(hasActive()){
      showWarning('يتعذّر إخفاء لوحة الفلاتر لوجود فلاتر مفعّلة. يُرجى مسح الفلاتر، وجعل (الدور) على وضع (الكل) أولًا قبل الإخفاء.');
      return;
    }
    const next=!panel.classList.contains('open');
    setOpen(next);
    localStorage.setItem('advFiltersOpen',next?'1':'0');
  });

  panel.addEventListener('transitionend',e=>{
    if(e.propertyName==='max-height' && panel.classList.contains('open'))
      panel.style.maxHeight=panel.scrollHeight+'px';
  });
  window.addEventListener('resize',()=>{
    if(panel.classList.contains('open')) panel.style.maxHeight=panel.scrollHeight+'px';
  });
}

/* ===== التهيئة العامة للبحث ===== */
export function init(ctx){
  mountAdvancedFilters(); 
  wireFiltersToggle();

  const dom = ctx.dom || (ctx.dom = {});
  const input = dom.searchInput = byId('quickSearch');
  const box   = dom.suggestBox  = byId('searchSuggestions');
  const btn   = byId('searchBtn');
  const clearBtn = byId('clearQuick');

  const setExpanded = v => input?.setAttribute('aria-expanded', v ? 'true' : 'false');
  const closeSug    = () => { box?.classList.remove('show'); setExpanded(false); };
  const showSug     = q => { renderSuggestions(buildSuggestions(q), dom); setExpanded(box?.classList.contains('show')); };

  const syncClear = () => {
    if(!input || !clearBtn) return;
    if(input.value.trim()) clearBtn.removeAttribute('hidden');
    else clearBtn.setAttribute('hidden','');
  };

  btn?.addEventListener('pointerdown', e => e.preventDefault());
  btn?.addEventListener('click', ()=>{
    input?.focus();
    const q = (input?.value || '').trim();
    if(!q) return;

    if(box?.classList.contains('show')) closeSug();
    else showSug(q);
  });

  window.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && (e.key||'').toLowerCase()==='k'){
      e.preventDefault(); input?.focus(); input?.select();
    }
  });

  clearBtn?.addEventListener('click', ()=>{
    if(!input) return;
    input.value='';
    setState({search:''});
    localStorage.removeItem('searchText');
    renderSuggestions([], dom);
    setExpanded(false);
    syncClear();
    input.focus();
  });

  syncClear();
  input?.addEventListener('input', syncClear);

  const saved = (localStorage.getItem('searchText')||'').trim();
  if(saved && input){
    input.value = saved;
    setState({search:saved});
    syncClear();
  }

  input?.addEventListener('focus', ()=>{
    const q=input.value||'';
    if(q.trim()) showSug(q);
  });

  input?.addEventListener('blur', closeSug);

  let tmr=null;
  const debounce = (fn,ms=150)=>{
    if(tmr) clearTimeout(tmr);
    tmr=setTimeout(fn,ms);
  };

  input?.addEventListener('input', e=>{
    const q=e.target.value||'';
    setState({search:q});
    localStorage.setItem('searchText',q);
    debounce(()=>showSug(q),150);
  });

  input?.addEventListener('keydown', e=>{
    if(e.key==='Escape' || e.key==='Enter') closeSug();
  });

  /* ===== اختيار اقتراح (آمن للمس/التمرير) ===== */
  const selectItem = it=>{
    if(!it) return;

    const id   = it.dataset.id   || '';
    const name = it.dataset.name || '';
    const role = it.dataset.role || '';
    const display = role ? `${name} (${role})` : name;

    if(input){
      input.value = display;
      setState({search:display});
      localStorage.setItem('searchText',display);
    }

    closeSug();
    input?.blur();
    if(!id) return;

    const prevFilters = getState().filters || {};
    const panel=byId('advFilters'), fbtn=byId('filtersToggle');
    const wasOpen   = !!panel?.classList.contains('open');
    const storedOpen= localStorage.getItem('advFiltersOpen');

    setState({filters:{role:'',clan:'',birthFrom:'',birthTo:''}});
    ctx.redrawUI?.();

    requestAnimationFrame(()=>{
      ctx.bus.emit('ui:openPersonById',{id,force:true});
      setState({filters:prevFilters});

      if(panel){
        panel.classList.toggle('open', wasOpen);
        panel.style.maxHeight = wasOpen ? panel.scrollHeight+'px' : '0px';
      }

      if(fbtn){
        fbtn.setAttribute('aria-expanded', String(wasOpen));
        const txt=fbtn.querySelector('.btn-text');
        if(txt) txt.textContent = wasOpen ? 'إخفاء الفلاتر' : 'إظهار الفلاتر';
      }

      if(storedOpen!=null) localStorage.setItem('advFiltersOpen', storedOpen);
    });
  };

  /* ===== دعم اللمس بدون نقر خاطئ ===== */
  if(box){
    let pid=null, sx=0, sy=0, moved=false, target=null;
    const TH=8;

    const reset=()=>{ pid=null; moved=false; target=null; };

    box.addEventListener('pointerdown', e=>{
      const it = e.target.closest('.item');
      if(!it) return;

      if(e.pointerType==='touch'){
        pid=e.pointerId;
        sx=e.clientX; sy=e.clientY;
        moved=false;
        target=it;
        return;
      }

      e.preventDefault();
      selectItem(it);
    });

    box.addEventListener('pointermove', e=>{
      if(pid!==e.pointerId) return;
      if(Math.abs(e.clientX-sx)>TH || Math.abs(e.clientY-sy)>TH) moved=true;
    },{passive:true});

    box.addEventListener('pointerup', e=>{
      if(pid!==e.pointerId) return;
      if(!moved){
        const it=e.target.closest('.item') || target;
        if(it) selectItem(it);
      }
      reset();
    });

    box.addEventListener('pointercancel', reset);
  }

  /* ===== تطبيع مسبق + كسول ===== */
  const walk = p=>{
    if(!p) return;
    cacheNorm(p);
    (p.children||[]).forEach(walk);
    (p.wives||[]).forEach(walk);
  };

  const iterate = f=>{
    const tops=[...(Array.isArray(f?.ancestors)?f.ancestors:[]), f?.father, f?.rootPerson, ...(f?.wives||[])].filter(Boolean);
    tops.forEach(walk);
  };

  const fams=Model.getFamilies();
  Object.keys(fams).forEach(k=>iterate(fams[k]));

  if('requestIdleCallback' in window){
    requestIdleCallback(()=>{
      const fams=Model.getFamilies();
      Object.keys(fams).forEach(k=>iterate(fams[k]));
    },{timeout:1500});
  }

  /* ===== فتح بطاقة شخص ===== */
  ctx.bus.on('ui:openPersonById', ({id})=>{
    if(!id) return;
    ctx.redrawUI?.();
    ctx.TreeUI?.refreshAvatarById?.(id);

    if(typeof ctx?.onShowDetails==='function')
      ctx.onShowDetails(id);
    else
      ctx.bus.emit('person:open',{person:{_id:id}});
  });

  return { cacheNorm, updatePersonEverywhere };
}
