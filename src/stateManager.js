// stateManager.js — إدارة حالة واجهة التطبيق (pub/sub) + حفظ محلي + تزامن عبر التبويبات

/* ======================= الإعدادات العامة ======================= */
const DEFAULTS = {
  selectedFamily: null,
  theme: 'default',
  fontSize: 16,
  search: '',
  uiTick: 0,
  filters: {
    role:      localStorage.getItem('flt_role') || '',
    clan:      localStorage.getItem('flt_clan') || '',
    life:      localStorage.getItem('flt_life') || '',
    gen:       localStorage.getItem('flt_gen')  || '',
    birthFrom: localStorage.getItem('flt_from') || '',
    birthTo:   localStorage.getItem('flt_to')   || '',
  },
};

// مفاتيح الحفظ الانتقائي في localStorage
const PERSIST_MAP = {
  theme: 'familyTreeTheme',
  fontSize: 'siteFontSize',
  selectedFamily: 'selectedFamily',
  search: 'searchText',
  'filters.role': 'flt_role',
  'filters.clan': 'flt_clan',
  'filters.birthFrom': 'flt_from',
  'filters.birthTo': 'flt_to',
  'filters.life': 'flt_life',
  'filters.gen': 'flt_gen',
};

const SAVE_DEBOUNCE_MS = 150;

/* ======================= أدوات مساعدة ======================= */
function shallowEqual(a, b){
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// تطبيع/تحقق قيم الحالة (حدود الخط + التاريخ + قيم الفلاتر)
function normalizeState(s){
  const out = { ...DEFAULTS, ...s, filters: { ...DEFAULTS.filters, ...(s?.filters || {}) } };

  // حدود حجم الخط
  let fs = parseInt(out.fontSize, 10);
  if (!Number.isFinite(fs)) fs = 16;
  out.fontSize = Math.min(24, Math.max(12, fs));

  // تواريخ YYYY-MM-DD أو فارغ
  const dt = (v) =>
    (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : (v ? String(v).trim() : '');
  out.filters.birthFrom = dt(out.filters.birthFrom);
  out.filters.birthTo   = dt(out.filters.birthTo);

  // نص البحث
  out.search = String(out.search || '').trim();

  // الدور: قيمة معروفة أو فارغ
  const role = String(out.filters.role || '').trim();
  out.filters.role = ['جد','الأب','صاحب الشجرة','زوجة','ابن','بنت',''].includes(role) ? role : '';

  // الحالة: alive/deceased أو فارغ
  const life = String(out.filters.life || '').trim();
  out.filters.life = (life === 'alive' || life === 'deceased') ? life : '';

  // الجيل: اترك "0" كما هو
  const genRaw = (out.filters.gen == null) ? '' : String(out.filters.gen).trim();
  if (genRaw === '') {
    out.filters.gen = '';
  } else {
    const n = parseInt(genRaw, 10);
    out.filters.gen = Number.isFinite(n) ? String(n) : '';
  }

  return out;
}

// قراءة قيمة من مسار "a.b.c"
function getByPath(obj, path){
  return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

// تعيين قيمة لمسار "a.b.c" دون كسر الكائنات الأخرى
function setByPath(obj, path, val){
  const parts = path.split('.');
  const last = parts.pop();
  let cur = obj;
  for (const p of parts){
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[last] = val;
}

/* ======================= الحالة والمشتركين ======================= */
let state = normalizeState({
  selectedFamily: localStorage.getItem('selectedFamily') || DEFAULTS.selectedFamily,
  theme: localStorage.getItem('familyTreeTheme') || DEFAULTS.theme,
  fontSize: parseInt(localStorage.getItem('siteFontSize') || DEFAULTS.fontSize, 10),
  search: localStorage.getItem('searchText') || DEFAULTS.search,
  filters: {
    role:      localStorage.getItem('flt_role') || DEFAULTS.filters.role,
    clan:      localStorage.getItem('flt_clan') || DEFAULTS.filters.clan,
    life:      localStorage.getItem('flt_life') || DEFAULTS.filters.life,
    gen:       localStorage.getItem('flt_gen')  || DEFAULTS.filters.gen,
    birthFrom: localStorage.getItem('flt_from') || DEFAULTS.filters.birthFrom,
    birthTo:   localStorage.getItem('flt_to')   || DEFAULTS.filters.birthTo,
  },
});

const listeners = new Set();
let _batchDepth = 0;
let _pendingChanged = false;
let _saveTimer = null;

/* ======================= الحفظ المحلي ======================= */
function persistChanged(prev, next){
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try{
      for (const [path, lsKey] of Object.entries(PERSIST_MAP)){
        const pv = getByPath(prev, path);
        const nv = getByPath(next, path);
        if (pv === nv) continue;
        if (nv == null || nv === '') localStorage.removeItem(lsKey);
        else localStorage.setItem(lsKey, String(nv));
      }
    }catch{}
    _saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

/* ======================= واجهة عامة ======================= */
export function getState(){
  return { ...state, filters: { ...state.filters } };
}

export function setState(patch){
  if (!patch) patch = {};
  const prev = state;

  const next = normalizeState({
    ...prev,
    ...patch,
    filters: { ...prev.filters, ...(patch.filters || {}) },
  });

  const equal =
    prev.selectedFamily === next.selectedFamily &&
    prev.theme === next.theme &&
    prev.fontSize === next.fontSize &&
    prev.search === next.search &&
        prev.uiTick === next.uiTick && 
    shallowEqual(prev.filters, next.filters);

  if (equal) return;

  state = next;
  persistChanged(prev, next);

  if (_batchDepth > 0){ _pendingChanged = true; return; }
  for (const fn of listeners){ try{ fn(getState()); }catch{} }
}

export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeTo(selector, onChange, cmp = shallowEqual){
  let last = selector(getState());
  const unsub = subscribe(st => {
    const cur = selector(st);
    const same = (typeof cmp === 'function') ? cmp(last, cur) : last === cur;
    if (!same){ last = cur; onChange(cur); }
  });
  return unsub;
}

// Batch: تجميع عدة setState في إشعار واحد
export function batch(fn){
  _batchDepth++;
  try{ fn(); }
  finally{
    _batchDepth = Math.max(0, _batchDepth - 1);
    if (_batchDepth === 0 && _pendingChanged){
      _pendingChanged = false;
      for (const fn of listeners){ try{ fn(getState()); }catch{} }
    }
  }
}

/* ======================= الفلاتر ======================= */
export function setFilter(name, value){
  const filters = { ...state.filters, [name]: value };
  setState({ filters });
}

export function clearFilters(){
  setState({ filters: { role:'', clan:'', life:'', gen:'', birthFrom:'', birthTo:'' } });
}

/* ======================= إعادة الضبط ======================= */
export function resetState(part = 'all'){
  if (part === 'filters') return clearFilters();
  if (part === 'view') return setState({ search:'', selectedFamily: state.selectedFamily });
  setState({ ...DEFAULTS });
}

/* ======================= تزامن التبويبات ======================= */
window.addEventListener('storage', (e) => {
  if (!e || !e.key) return;

  for (const [path, lsKey] of Object.entries(PERSIST_MAP)){
    if (e.key !== lsKey) continue;

    const next = getState();
    const newVal = (e.newValue == null) ? '' : e.newValue;
    setByPath(next, path, newVal);

    // يمر عبر normalize + persist + notify فقط عند وجود تغيير فعلي
    setState(next);
    return;
  }
});