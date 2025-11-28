// tree.familyButtons.js — شريط/قائمة العائلات الجانبية

import { byId, showConfirmModal } from '../utils.js';
import * as Lineage from '../features/lineage.js';
import { makeMatcher, makePassFilters } from './tree.search.js';

export function updatePrintButtonLabel(families = {}, selectedKey = null){
  const printBtn = byId('printBtn');
  if (!printBtn) return;

  const fam = families && families[selectedKey];
  const keys = Object.keys(families || {});
  const count = keys.length;

  if (!fam || count <= 1){
    printBtn.innerHTML = '<i class="fa-solid fa-print"></i> طباعة العائلة';
    printBtn.title = 'طباعة العائلة';
    return;
  }

  const name =
    (fam.familyName || fam.title || fam.rootPerson?.name || '').trim();

  const label = name ? `طباعة عائلة: ${name}` : 'طباعة العائلة';

  printBtn.innerHTML = `<i class="fa-solid fa-print"></i> ${label}`;
  printBtn.title = label;
}

// ===== أزرار العائلات مع احترام البحث والفلاتر =====
export function renderFamilyButtons(families = {}, selectedKey = null, handlers = {}, domRefs = {}){
  const container = (domRefs && domRefs.familyButtons) || byId('familyButtons'); if (!container) return;
  container.innerHTML = '';

  const formatLabel = (f, key) => {
    const raw = (f && f.familyName) || (f && f.title) || (f && f.rootPerson?.name) || key;
    return `عائلة: ${String(raw).trim()}`;
  };

  const q   = (handlers && handlers.getSearch && handlers.getSearch()) || '';
  const flt = (handlers && handlers.getFilters && handlers.getFilters()) || { role:'', clan:'', birthFrom:'', birthTo:'' };
  const match = makeMatcher(q, { fields: ['name','role','cognomen'] });

  function familyMatches(f){
    if (!f) return false;
    const ctx = Lineage.buildLineageContext(f);
    const passFilters = makePassFilters(flt, f, ctx);

    const pool = [
      ...(Array.isArray(f.ancestors) ? f.ancestors : []),
      f.father, f.rootPerson, ...(f.wives || [])
    ].filter(Boolean);
    (f.wives || []).forEach(w => (w.children || []).forEach(c => pool.push(c)));
    return pool.some(p => match(p) && passFilters(p));
  }

  Object.entries(families || {}).forEach(([k,f]) => {
    if (!f || f.hidden) return;
    if ((q || flt.role || flt.clan || flt.birthFrom || flt.birthTo) && !familyMatches(f)) return;

    const wrap = document.createElement('div'); wrap.className = 'family-item';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'family-button'; btn.dataset.family = k;
    btn.setAttribute('aria-pressed', k === selectedKey ? 'true' : 'false');
    btn.textContent = formatLabel(f,k);
    if (k === selectedKey) btn.classList.add('active-family');
    btn.addEventListener('click', () => { if (typeof handlers.onSelectFamily === 'function') handlers.onSelectFamily(k); });
    wrap.appendChild(btn);

    if (f.__custom && !f.__core){
      const edit = document.createElement('button');
      edit.className='btn tiny edit-family'; edit.title='تعديل العائلة';
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
      edit.addEventListener('click', ev => { ev.stopPropagation(); handlers?.onEditFamily?.(k); });
      edit.setAttribute('tabindex','0'); edit.addEventListener('keydown', e => { if (e.key==='Enter') edit.click(); });

      const del = document.createElement('button');
      del.className='btn tiny del-family'; del.title='حذف العائلة';
      del.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; del.setAttribute('tabindex','0');
      del.addEventListener('keydown', e => { if (e.key==='Enter') del.click(); });
      del.addEventListener('click', async ev => {
        ev.stopPropagation();
        const ok = await showConfirmModal({
          title: 'حذف العائلة',
          message: `هل أنت متأكد من حذف "${(f.familyName||f.title||k)}" ؟ لا يمكن التراجع.`,
          confirmText: 'حذف', cancelText: 'إلغاء', variant: 'danger'
        });
        if (ok) await handlers?.onDeleteFamily?.(k);
      });

      wrap.append(edit, del);
    } else if (f.__core){
      const hideBtn = document.createElement('button');
      hideBtn.className = 'btn tiny hide-family'; hideBtn.title = 'إخفاء العائلة الأساسية من العرض';
      hideBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      hideBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        const ok = await showConfirmModal({
          title: 'إخفاء العائلة',
          message: `هل تريد إخفاء "${(f.familyName||f.title||k)}" من القائمة؟ يمكن إظهارها لاحقًا من الإعدادات.`,
          confirmText: 'إخفاء', cancelText: 'إلغاء', variant: 'warning'
        });
        if (ok) handlers?.onHideFamily?.(k);
      });
      wrap.appendChild(hideBtn);
    }

    container.appendChild(wrap);
  });
}
