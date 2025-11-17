// stateManager.js
// إدارة حالة واجهة التطبيق + نشر/اشتراك مع حفظ محلي وتزامن عبر التبويبات

/* ======================= الإعدادات العامة ======================= */
const DEFAULTS = {
  selectedFamily: null,
  theme: 'default',
  fontSize: 16,
  search: '',
  filters: {
    role:      localStorage.getItem('flt_role') || '',
    clan:      localStorage.getItem('flt_clan') || '',
    birthFrom: localStorage.getItem('flt_from') || '',
    birthTo:   localStorage.getItem('flt_to')   || '',
  },
};

// مفاتيح تُحفَظ في localStorage (انتقائيًا)
const PERSIST_MAP = {
  theme:       'familyTreeTheme',
  fontSize:    'siteFontSize',
  selectedFamily: 'selectedFamily',
  search:      'searchText',          // اختياري للفلاتر/البحث
  'filters.role':      'flt_role',
  'filters.clan':      'flt_clan',
  'filters.birthFrom': 'flt_from',
  'filters.birthTo':   'flt_to',
};

// اختناق الحفظ
const SAVE_DEBOUNCE_MS = 150;

/* ======================= أدوات مساعدة ======================= */
// مقارنة سطحية بسيطة
function shallowEqual(a, b){
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka){ if (a[k] !== b[k]) return false; }
  return true;
}

// التحقق/التطبيع لقيم الحالة
function normalizeState(s){
  const out = { ...DEFAULTS, ...s, filters: { ...DEFAULTS.filters, ...(s?.filters||{}) } };
  // ضبط حدود الحجم
  let fs = parseInt(out.fontSize, 10);
  if (!Number.isFinite(fs)) fs = 16;
  out.fontSize = Math.min(24, Math.max(12, fs));
  // تواريخ بصيغة YYYY-MM-DD أو فارغة
  const dt = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (v ? String(v).trim() : ''));
  out.filters.birthFrom = dt(out.filters.birthFrom);
  out.filters.birthTo   = dt(out.filters.birthTo);
  // نص البحث
  out.search = String(out.search||'').trim();
  // الدور أحد القيم المعروفة أو فارغ
  const role = String(out.filters.role||'').trim();
  out.filters.role = ['ابن','بنت','زوجة','الأب','جد',''].includes(role) ? role : '';
  return out;
}

// قراءة قيمة من المسار "a.b.c"
function getByPath(obj, path){
  return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

// تعيين قيمة لمسار "a.b.c" دون كسر كائنات أخرى
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
    birthFrom: localStorage.getItem('flt_from') || DEFAULTS.filters.birthFrom,
    birthTo:   localStorage.getItem('flt_to')   || DEFAULTS.filters.birthTo,
  }
});

const listeners = new Set();
let _batchDepth = 0;
let _pendingChanged = false;
let _saveTimer = null;

/* ======================= الحفظ المحلي ======================= */
function persistChanged(prev, next){
  // لا تحفظ أثناء كل ضغطة؛ استخدم اختناق
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
// إرجاع نسخة غير قابلة للتعديل
export function getState(){ return { ...state, filters: { ...state.filters } }; }

// تحديث مع دمج + تحقّق من التغيّر الحقيقي
export function setState(patch){
  if (!patch) patch = {};
  const prev = state;
  const next = normalizeState({
    ...prev,
    ...patch,
    filters: { ...prev.filters, ...(patch.filters||{}) }
  });

  const equal =
    prev.selectedFamily === next.selectedFamily &&
    prev.theme === next.theme &&
    prev.fontSize === next.fontSize &&
    prev.search === next.search &&
    shallowEqual(prev.filters, next.filters);

  if (equal) return; // لا إشعار ولا حفظ

  state = next;
  persistChanged(prev, next);

  if (_batchDepth > 0){ _pendingChanged = true; return; }

  for (const fn of listeners){ try{ fn(getState()); }catch{} }
}

// اشتراك بسيط
export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// اشتراك على مقطع محدد مع مقارنة مخصّصة
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
  try{ fn(); } finally{
    _batchDepth = Math.max(0, _batchDepth - 1);
    if (_batchDepth === 0 && _pendingChanged){
      _pendingChanged = false;
      for (const fn of listeners){ try{ fn(getState()); }catch{} }
    }
  }
}

// إدارة الفلاتر
export function setFilter(name, value){
  const filters = { ...state.filters, [name]: value };
  setState({ filters });
}
export function clearFilters(){
  setState({ filters: { role:'', clan:'', birthFrom:'', birthTo:'' } });
}

// إعادة ضبط جزئي/كامل
export function resetState(part = 'all'){
  if (part === 'filters') return clearFilters();
  if (part === 'view')    return setState({ search:'', selectedFamily: state.selectedFamily });
  // كامل
  setState({ ...DEFAULTS });
}

// مزامنة عبر تبويبات المتصفح
window.addEventListener('storage', (e) => {
  if (!e || !e.key) return;
  const map = Object.entries(PERSIST_MAP);
  for (const [path, lsKey] of map){
    if (e.key !== lsKey) continue;
    const prev = getState();
    const next = getState();
    const newVal = e.newValue == null ? '' : e.newValue;
    setByPath(next, path, newVal);
    // استدعاء setState لنيل التحقق/الحفظ/الإشعار إن تغيّر شيء
    setState(next);
    return;
  }
});
