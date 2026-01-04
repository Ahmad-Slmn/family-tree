// src/storage/pinStore.js
import { DB } from './db.js';

const PERSISTED_KEYS = new Set([
  // A) settings
  'pin_enabled',
  'pin_idle_minutes',
  'pin_lock_on_visibility',
  'pin_session_minutes',

  // B) secrets-ish
  'pin_salt',
  'pin_hash',
  'pin_hint',

  // also persisted
  'pin_session_until',
  
  // C) force lock (persisted)
  'pin_force_locked',
  'pin_lock_reason'
]);

const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('pin_channel') : null;

let cache = new Map();
let _ready = false;

function _norm(v){
  return (v === undefined) ? null : v;
}

async function init(){
  if (_ready) return;
  const all = await DB.pinGetAll().catch(() => ({}));
  cache = new Map(Object.entries(all || {}));
  _ready = true;
}

function getSync(key, def=null){
  if (!PERSISTED_KEYS.has(key)) return def;
  const v = cache.has(key) ? cache.get(key) : null;
  return (v == null) ? def : String(v);
}

async function set(key, val){
  if (!PERSISTED_KEYS.has(key)) return;
  await init();
  const v = (val == null) ? null : String(val);
  cache.set(key, v);
  await DB.pinPut(key, v);

  bc?.postMessage({ type:'set', key, val: v, at: Date.now() });
}

async function del(key){
  if (!PERSISTED_KEYS.has(key)) return;
  await init();
  cache.delete(key);
  await DB.pinDel(key);

  bc?.postMessage({ type:'del', key, at: Date.now() });
}

function onMessage(fn){
  if (!bc) return () => {};
  const h = (e) => fn?.(e?.data || null);
  bc.addEventListener('message', h);
  return () => bc.removeEventListener('message', h);
}

// تحديث الكاش عند رسائل التبويبات
onMessage((msg) => {
  if (!msg || !msg.key) return;
  if (!PERSISTED_KEYS.has(msg.key)) return;

  if (msg.type === 'set') cache.set(msg.key, _norm(msg.val));
  if (msg.type === 'del') cache.delete(msg.key);
});

export const PinStore = {
  init,
  getSync,
  set,
  del,
  PERSISTED_KEYS
};
