// features/print.js — طباعة مبسّطة + مزامنة قبل/بعد الطباعة
import { byId } from '../utils.js';

function addPrintCompactToggle(){
  const printBtn = byId('printBtn');
  if (!printBtn || byId('printCompactToggle')) return;

  const wrap = document.createElement('label');
  wrap.id = 'printCompactToggle';
  wrap.htmlFor = 'printCompactCb';
  wrap.style.cssText = 'display:inline-flex;gap:.4rem;align-items:center;margin-inline-start:.6rem;font-size:.9rem;';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'printCompactCb';
  cb.name = 'printCompact';
  cb.checked = localStorage.getItem('printCompact') === '1';

  // تطبيق الحالة الحالية
  document.body.classList.toggle('print-compact', cb.checked);

  cb.addEventListener('change', ()=>{
    localStorage.setItem('printCompact', cb.checked ? '1' : '0');
    document.body.classList.toggle('print-compact', cb.checked);
  });

  wrap.append(cb, document.createTextNode('طباعة مبسّطة'));
  printBtn.parentNode?.insertBefore(wrap, printBtn.nextSibling);
}

export function init(){
  addPrintCompactToggle();

  // سمات بيانات مفيدة لهوامش الطباعة أو الميتاداتا
  document.documentElement.setAttribute('data-print-title', document.title || 'Family Tree');
  document.documentElement.setAttribute('data-print-at', new Date().toLocaleString());

  // مزامنة حالة "مبسّطة" من التخزين قبل/بعد الطباعة
  const syncCompact = () => {
    const stored = localStorage.getItem('printCompact') === '1';
    document.body.classList.toggle('print-compact', stored);
    const cb = byId('printCompactToggle')?.querySelector('input');
    if (cb) cb.checked = stored;
  };

  // مدعوم في كروم/فايرفوكس/إيدج
  window.addEventListener('beforeprint', syncCompact);
  window.addEventListener('afterprint',  () => { /* مساحة لتراجعات مؤقتة إن لزم مستقبلاً */ });

  // دعم قديم عبر matchMedia('print')
  const mql = window.matchMedia && window.matchMedia('print');
  if (mql && mql.addListener){
    mql.addListener(q => { if (q.matches) syncCompact(); });
  }

  // زر الطباعة
  byId('printBtn')?.addEventListener('click', () => {
    syncCompact();
    window.print();
  });

  return {};
}
