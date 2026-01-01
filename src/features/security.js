// features/security.js - ملف إدارة إعدادات قفل الخصوصية (كلمة المرور): تفعيل/تعطيل/تغيير كلمة المرور + الجلسة المفتوحة + ربط واجهة الإعدادات

import { byId, showInfo, showSuccess, showError, highlight, genSalt, hashPin } from '../utils.js';
import { PinStore } from '../storage/pinStore.js';

/* =========================
   مفاتيح تخزين إعدادات القفل
========================= */
const PIN_KEYS = {
  enabled: 'pin_enabled',
  salt: 'pin_salt',
  hash: 'pin_hash',
  hint: 'pin_hint',
  idleMin: 'pin_idle_minutes',
  lockOnVis: 'pin_lock_on_visibility',
  sessionUntil: 'pin_session_until',
  sessionMin: 'pin_session_minutes',
  tries: 'pin_tries',
  lockUntil: 'pin_lock_until',
  lastActivity: 'pin_last_activity',
  lastTryAt: 'pin_last_try_at'
};

/* =========================
   طبقة وصول موحّدة للتخزين (IDB عبر PinStore + localStorage fallback)
========================= */
function lsGet(k, def = null) {
  if (PinStore.PERSISTED_KEYS?.has?.(k)) return PinStore.getSync(k, def);
  try {
    const v = localStorage.getItem(k);
    return (v == null) ? def : v;
  } catch { return def; }
}

function lsSet(k, v) {
  if (PinStore.PERSISTED_KEYS?.has?.(k)) return PinStore.set(k, v); // Promise
  try { localStorage.setItem(k, String(v)); } catch {}
  return Promise.resolve();
}

function lsDel(k) {
  if (PinStore.PERSISTED_KEYS?.has?.(k)) { PinStore.del(k); return; }
  try { localStorage.removeItem(k); } catch {}
}

/* =========================
   تحقق حالة القفل
========================= */
function isEnabled() { return lsGet(PIN_KEYS.enabled, '0') === '1'; }

function hasPinConfigured() {
  const salt = lsGet(PIN_KEYS.salt, '');
  const hash = lsGet(PIN_KEYS.hash, '');
  return !!(salt && hash);
}

function canUsePinFeatures() {
  return isEnabled() && hasPinConfigured(); // Enabled + Configured
}

/* =========================
   مودال إدارة القفل (تفعيل/تعطيل/تغيير)
========================= */
function buildManageModal({ title, fields, onSubmit, onCancel }) {
  const wrap = document.createElement('div');
  wrap.className = 'pin-manage-modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');

  wrap.innerHTML = `
    <div class="pin-manage-backdrop"></div>
    <div class="pin-manage-card">
      <h3 class="pin-manage-title">${title}</h3>
      <div class="pin-manage-body">
        ${fields.map(f => `
          <div class="pin-manage-field">
            <label for="${f.id}">${f.label}</label>

            <div class="pin-manage-input-wrap">
              <input
                id="${f.id}"
                type="${f.type || 'text'}"
                ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}
                ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}
                autocomplete="off"
              >
              ${(f.type === 'password') ? `
                <button type="button"
                        class="pin-manage-eye"
                        data-eye-for="${f.id}"
                        aria-label="إظهار كلمة المرور"
                        aria-pressed="false">
                  <i class="fa-solid fa-eye" aria-hidden="true"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="pin-manage-actions">
        <button type="button" class="btn small" data-act="cancel">إلغاء</button>
        <button type="button" class="btn small primary" data-act="ok">حفظ</button>
      </div>

      <div class="pin-manage-msg" aria-live="polite"></div>
    </div>
  `;

  const msg = wrap.querySelector('.pin-manage-msg');
  const backdrop = wrap.querySelector('.pin-manage-backdrop');

  // مزامنة زر إظهار/إخفاء كلمة المرور
  function syncEye(btn, input) {
    if (!btn || !input) return;
    const icon = btn.querySelector('i');
    const isShown = (input.type === 'text');
    btn.setAttribute('aria-pressed', isShown ? 'true' : 'false');
    btn.setAttribute('aria-label', isShown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    if (icon) {
      icon.classList.toggle('fa-eye', !isShown);
      icon.classList.toggle('fa-eye-slash', isShown);
    }
  }

  // ربط أزرار العين داخل المودال
  wrap.querySelectorAll('button.pin-manage-eye[data-eye-for]').forEach((btn) => {
    const id = btn.getAttribute('data-eye-for');
    const input = id ? wrap.querySelector('#' + id) : null;
    if (!input) return;

    syncEye(btn, input);
    btn.addEventListener('click', () => {
      input.type = (input.type === 'password') ? 'text' : 'password';
      syncEye(btn, input);
      input.focus();
    });
  });

  // إغلاق المودال (مع معالجة الإلغاء)
  function close(reason = 'close') {
    document.documentElement.style.overflow = '';
    wrap.remove();
    if (reason === 'cancel') {
      try { onCancel?.(); } catch {}
    }
  }

  // رسالة داخل المودال
  function setMsg(t) {
    if (msg) msg.textContent = String(t || '');
  }

  // فلترة موحّدة لحقول PIN (حروف/أرقام فقط + حد أقصى 12)
  wrap.querySelectorAll('input[type="password"]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const v = String(inp.value || '');
      const cleaned = v.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 12);
      if (cleaned !== v) inp.value = cleaned;
    });
  });

  // أحداث النقر (OK/Cancel/Backdrop)
  wrap.addEventListener('click', (e) => {
    const act = e.target && e.target.closest && e.target.closest('button')?.dataset?.act;
    if (act === 'cancel') { close('cancel'); return; }

    if (act === 'ok') {
      const values = {};
      fields.forEach(f => { values[f.id] = (wrap.querySelector('#' + f.id)?.value || '').trim(); });
      onSubmit(values, { close, setMsg });
      return;
    }

    if (e.target === backdrop) close('cancel');
  });

  // ESC للإغلاق
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close('cancel');
  });

  // إظهار + تركيز أول حقل
  document.body.appendChild(wrap);
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => wrap.querySelector('input')?.focus?.(), 0);

  // فخ تركيز بسيط داخل المودال
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(wrap.querySelectorAll('button,input,[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  wrap.addEventListener('keydown', trap);

  return wrap;
}

/* =========================
   إنشاء/تحديث كلمة المرور (PIN)
========================= */
async function setNewPin(pin, hint) {
  const salt = genSalt(16);
  const h = await hashPin(pin, salt);

  await lsSet(PIN_KEYS.salt, salt);
  await lsSet(PIN_KEYS.hash, h);
  await lsSet(PIN_KEYS.hint, hint || '');
  await lsSet(PIN_KEYS.tries, '0');
  await lsSet(PIN_KEYS.lockUntil, '0');
  await lsSet(PIN_KEYS.lastActivity, String(Date.now()));
}

async function verifyPin(pin) {
  const salt = lsGet(PIN_KEYS.salt, '');
  const storedHash = lsGet(PIN_KEYS.hash, '');
  if (!salt || !storedHash) return false;
  const h = await hashPin(pin, salt);
  return h === storedHash;
}

/* =========================
   ربط قسم الخصوصية في الشريط الجانبي + مزامنة UI
========================= */
function injectPrivacySection(bus) {
  const sec = byId('privacySection');
  if (!sec) return;

  // عناصر الواجهة
  const toggle = byId('pinEnabledToggle');
  const enabledLabel = byId('pinEnabledLabel');
  const idle = byId('pinIdleSelect');
  const vis = byId('pinLockOnVisToggle');
  const sessionSel = byId('pinSessionSelect');
  const openSessionBtn = byId('pinOpenSessionBtn');
  const lockNowBtn = byId('pinLockNowBtn');
  const changeBtn = byId('pinChangeBtn');

  // صناديق الواجهة
  const idleBox = sec.querySelector('.pin-idle-box');
  const visBox = sec.querySelector('.pin-vis-box');
  const sessionBox = sec.querySelector('.pin-session-box');

  // حالة الجلسة المفتوحة
  const getSessionUntil = () => {
    const u = parseInt(lsGet(PIN_KEYS.sessionUntil, '0'), 10) || 0;
    return u;
  };
  const isSessionOpen = () => getSessionUntil() > Date.now();

  // مزامنة زر/قائمة الجلسة المفتوحة
  const syncOpenSessionUI = () => {
    if (!sessionSel || !openSessionBtn) return;

    const enabled = isEnabled();
    const open = enabled && isSessionOpen();

    sessionSel.disabled = !canUsePinFeatures() || !!open;
    openSessionBtn.textContent = open ? 'إلغاء الجلسة' : 'تفعيل جلسة مفتوحة';
    openSessionBtn.dataset.state = open ? 'open' : 'closed';
  };

  // تمكين/تعطيل/إخفاء عناصر UI حسب جاهزية PIN
  const syncPinUIAvailability = () => {
    const ready = canUsePinFeatures();
    const enabled = isEnabled();

    // إن كان مفعّلًا لكن البيانات ناقصة (salt/hash) -> أطفئه
    if (enabled && !hasPinConfigured()) {
      lsSet(PIN_KEYS.enabled, '0');
      if (toggle) toggle.checked = false;
    }

    if (idle) idle.disabled = !ready;
    if (vis) vis.disabled = !ready;

    if (sessionSel) sessionSel.disabled = !ready || isSessionOpen();
    if (openSessionBtn) openSessionBtn.disabled = !ready;

    if (lockNowBtn) lockNowBtn.disabled = !ready;
    if (changeBtn) changeBtn.disabled = !ready;

    if (lockNowBtn) lockNowBtn.hidden = !ready;
    if (changeBtn) changeBtn.hidden = !ready;

    if (idleBox) idleBox.hidden = !ready;
    if (visBox) visBox.hidden = !ready;
    if (sessionBox) sessionBox.hidden = !ready;

    if (enabledLabel) {
      const on = isEnabled();
      enabledLabel.innerHTML = `
        <i class="fa-solid fa-key" aria-hidden="true"></i>
        ${on ? 'إيقاف حماية الخصوصية' : 'حماية الخصوصية'}
      `;
    }

    if (toggle) {
      toggle.setAttribute('aria-label', isEnabled() ? 'إيقاف حماية الخصوصية' : 'حماية الخصوصية');
    }
  };

  // قيم ابتدائية
  if (toggle) toggle.checked = isEnabled();

  if (idle) {
    const v = lsGet(PIN_KEYS.idleMin, '3');
    idle.value = (v === '2' || v === '3' || v === '5' || v === '10') ? v : '3';
  }

  if (vis) {
    vis.checked = lsGet(PIN_KEYS.lockOnVis, '0') === '1'; // default OFF
  }

  if (sessionSel) {
    const v = lsGet(PIN_KEYS.sessionMin, '15');
    sessionSel.value = (v === '5' || v === '15' || v === '30' || v === '60') ? v : '15';
  }

  /* ===== أحداث الواجهة ===== */

  lockNowBtn?.addEventListener('click', () => {
    if (!canUsePinFeatures()) {
      showInfo('القفل غير جاهز. فعّل كلمة المرور واضبطها أولاً.');
      return;
    }
    bus.emit('side:requestClose');
    bus.emit('pin:lockNow');
  });

  idle?.addEventListener('change', () => {
    if (idle.disabled) return;
    const v = idle.value;
    lsSet(PIN_KEYS.idleMin, v);
    showSuccess(`تم ضبط مدة الخمول إلى ${highlight(v)} دقائق.`);
  });

  vis?.addEventListener('change', () => {
    if (vis.disabled) return;
    lsSet(PIN_KEYS.lockOnVis, vis.checked ? '1' : '0');
    showSuccess(`تم ${vis.checked ? 'تفعيل' : 'تعطيل'} القفل عند ترك التبويب/الخروج من التطبيق.`);
  });

  sessionSel?.addEventListener('change', () => {
    if (sessionSel.disabled) return;
    const v = sessionSel.value;
    lsSet(PIN_KEYS.sessionMin, v);
    showSuccess(`تم اختيار مدة الجلسة: ${highlight(v)} دقيقة.`);
  });

  openSessionBtn?.addEventListener('click', () => {
    bus.emit('side:requestClose');

    if (!canUsePinFeatures()) { showInfo('فعّل كلمة المرور واضبطها أولاً.'); return; }

    // إلغاء جلسة قائمة
    if (isSessionOpen()) {
      lsDel(PIN_KEYS.sessionUntil);
      showSuccess('تم إلغاء الجلسة المفتوحة.');
      syncPinUIAvailability();
      syncOpenSessionUI();
      return;
    }

    // تفعيل جلسة جديدة
    const min = parseInt(sessionSel?.value || '15', 10) || 15;
    const safe = [5, 15, 30, 60].includes(min) ? min : 15;

    lsSet(PIN_KEYS.sessionMin, String(safe));
    bus.emit('pin:openSession', { minutes: safe });

    syncOpenSessionUI();
  });

  // مزامنة أولية
  syncOpenSessionUI();
  syncPinUIAvailability();

  // مزامنة بين التبويبات عبر BroadcastChannel
  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel('pin_channel');
    bc.addEventListener('message', (e) => {
      const msg = e?.data || null;
      if (!msg || !msg.key) return;

      if (
        msg.key === PIN_KEYS.enabled ||
        msg.key === PIN_KEYS.salt ||
        msg.key === PIN_KEYS.hash ||
        msg.key === PIN_KEYS.sessionUntil ||
        msg.key === PIN_KEYS.idleMin ||
        msg.key === PIN_KEYS.lockOnVis ||
        msg.key === PIN_KEYS.sessionMin
      ) {
        syncPinUIAvailability();
        syncOpenSessionUI();
      }
    });
  }

  // تحديث دوري لحالة الجلسة المفتوحة
  if (!window.__pinOpenSessionUiTimer) {
    window.__pinOpenSessionUiTimer = setInterval(() => {
      syncPinUIAvailability();
      syncOpenSessionUI();
    }, 5000);
  }

  // تفعيل/تعطيل القفل من الـ Toggle
  toggle?.addEventListener('change', async () => {
    if (toggle.checked) {
      buildManageModal({
        title: 'حماية الخصوصية',
        fields: [
          { id: 'pin1', label: 'كلمة مرور جديدة', type: 'password', maxlength: 12, placeholder: 'مثال: 1234' },
          { id: 'pin2', label: 'تأكيد كلمة المرور', type: 'password', maxlength: 12, placeholder: 'أعد الإدخال' },
          { id: 'hint', label: 'تلميح (اختياري)', type: 'text', maxlength: 40, placeholder: 'مثال: رقم خاص...' }
        ],
        onSubmit: async (vals, ui) => {
          const p1 = vals.pin1 || '';
          const p2 = vals.pin2 || '';
          if (!p1 || p1.length < 4) { ui.setMsg('كلمة المرور يجب أن تكون 4 محارف على الأقل.'); return; }
          if (p1 !== p2) { ui.setMsg('كلمة المرور غير متطابقة.'); return; }

          try {
            await setNewPin(p1, vals.hint || '');
            lsSet(PIN_KEYS.enabled, '1');
            if (!lsGet(PIN_KEYS.idleMin, null)) lsSet(PIN_KEYS.idleMin, '3');
            if (!lsGet(PIN_KEYS.lockOnVis, null)) lsSet(PIN_KEYS.lockOnVis, '0'); // default OFF
            showSuccess('تم تفعيل القفل بنجاح.');
            ui.close();
            syncOpenSessionUI();
            syncPinUIAvailability();
            bus.emit('pin:settingsChanged');
          } catch {
            showError('تعذر تفعيل القفل (WebCrypto).');
          }
        },
        onCancel: () => {
          toggle.checked = false;
          lsSet(PIN_KEYS.enabled, '0');
          syncOpenSessionUI();
          syncPinUIAvailability();
        }
      });
    } else {
      if (!canUsePinFeatures()) {
        lsSet(PIN_KEYS.enabled, '0');
        bus.emit('pin:disabled');
        syncOpenSessionUI();
        syncPinUIAvailability();
        return;
      }

      buildManageModal({
        title: 'تعطيل القفل',
        fields: [
          { id: 'curPin', label: 'أدخل كلمة المرور الحالية للتأكيد', type: 'password', maxlength: 12, placeholder: 'كلمة المرور الحالية' }
        ],
        onSubmit: async (vals, ui) => {
          const cur = (vals.curPin || '').trim();
          if (!cur) { ui.setMsg('أدخل كلمة المرور الحالية.'); return; }

          try {
            const ok = await verifyPin(cur);
            if (!ok) { ui.setMsg('كلمة المرور غير صحيحة.'); return; }

            lsSet(PIN_KEYS.enabled, '0');
            lsDel(PIN_KEYS.salt);
            lsDel(PIN_KEYS.hash);
            lsDel(PIN_KEYS.hint);
            lsDel(PIN_KEYS.tries);
            lsDel(PIN_KEYS.lockUntil);
            lsDel(PIN_KEYS.sessionUntil);
            lsDel(PIN_KEYS.sessionMin);
            lsDel(PIN_KEYS.lastTryAt);

            bus.emit('pin:disabled');
            showSuccess('تم تعطيل قفل كلمة المرور ومسح بياناته من الجهاز.');
            ui.close();
            syncOpenSessionUI();
            syncPinUIAvailability();
          } catch {
            ui.setMsg('تعذر التحقق من كلمة المرور.');
          }
        },
        onCancel: () => {
          toggle.checked = true;
          lsSet(PIN_KEYS.enabled, '1');
          syncOpenSessionUI();
          syncPinUIAvailability();
        }
      });
    }
  });

  // تغيير كلمة المرور
  changeBtn?.addEventListener('click', () => {
    if (!canUsePinFeatures()) { showInfo('فعّل كلمة المرور واضبطها أولاً.'); return; }
    bus.emit('side:requestClose');

    buildManageModal({
      title: 'تغيير كلمة المرور',
      fields: [
        { id: 'oldPin', label: 'كلمة المرور الحالية', type: 'password', maxlength: 12 },
        { id: 'newPin1', label: 'كلمة المرور الجديدة', type: 'password', maxlength: 12 },
        { id: 'newPin2', label: 'تأكيد كلمة المرور الجديدة', type: 'password', maxlength: 12 },
        { id: 'hint', label: 'تلميح (اختياري)', type: 'text', maxlength: 40 }
      ],
      onSubmit: async (vals, ui) => {
        const oldPin = vals.oldPin || '';
        const n1 = vals.newPin1 || '';
        const n2 = vals.newPin2 || '';

        if (!oldPin) { ui.setMsg('أدخل كلمة المرور الحالية.'); return; }

        try {
          const ok = await verifyPin(oldPin);
          if (!ok) { ui.setMsg('PIN الحالي غير صحيح.'); return; }

          if (!n1 || n1.length < 4) { ui.setMsg('كلمة المرور الجديد يجب أن يكون 4 على الأقل.'); return; }
          if (n1 !== n2) { ui.setMsg('كلمة المرور الجديد غير متطابق.'); return; }

          await setNewPin(n1, vals.hint || lsGet(PIN_KEYS.hint, ''));
          showSuccess('تم تغيير كلمة المرور بنجاح.');
          ui.close();
        } catch {
          showError('تعذر تغيير كلمة المرور (WebCrypto).');
        }
      }
    });
  });
}

/* =========================
   تهيئة الميزة
========================= */
export function init(ctx) {
  const bus = ctx && ctx.bus;
  if (!bus) return;

  PinStore.init().then(() => {
    injectPrivacySection(bus);
  }).catch(() => {
    injectPrivacySection(bus);
  });
}
