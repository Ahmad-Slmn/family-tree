// src/model/roles.js

import { getArabicOrdinal, getArabicOrdinalF } from '../utils.js';

// تصنيف الدور للفلاتر/البحث
export function roleGroup(p){
  const r = String(p?.role||'').trim();
  if (r === 'ابن' || r === 'بنت') return r;
  if (r === 'الأب') return 'الأب';
  if (r.startsWith('الجد')) return 'جد';
  if (r === 'زوجة' || r.startsWith('الزوجة')) return 'زوجة';
  return r || '';
}

// قائمة الأدوار التي نسمح بها في الفلتر (متوافقة مع roleGroup)
export const ROLE_FILTER_VALUES = ['ابن','بنت','الأب','جد','زوجة'];

// تطبيع دور الجد
export function normalizeAncestorRole(role, generation){
  const ord = getArabicOrdinal;
  const g = Number.isFinite(+generation) ? +generation : 1;
  let r = String(role || '').trim();

  const m = r.match(/^الجد\s*(\d+)$/u);
  if (m) {
    const n = parseInt(m[1], 10) || g;
    return `الجد ${ord(n)}`;
  }
  if (!r || r === 'جد' || /^الجد\s*\d+$/u.test(r)) {
    return `الجد ${ord(g)}`;
  }
  return r;
}

// تطبيع دور الزوجة
export function normalizeWifeRole(role, index){
  const ordF = getArabicOrdinalF;
  const idx  = ((index|0) + 1) || 1;
  let r = String(role || '').trim() || 'زوجة';

  const m = r.match(/^ال?زوجة\s+(\d+)$/u);
  if (m) {
    const n = parseInt(m[1], 10) || idx;
    return `الزوجة ${ordF(n)}`;
  }
  if (r === 'زوجة') {
    return `الزوجة ${ordF(idx)}`;
  }
  return r;
}

// الأفاتار حسب الدور
export function getRoleAvatar(role){
  const map = {
    'الجد الأول':'👴',
    'الجد الثاني':'👴',
    'جدة':'👵',
    'الأب':'👨',
    'الأم':'👩',
    'ابن':'👦',
    'بنت':'👧',
    'زوج':'👨‍🦱',
    'زوجة':'👩‍🦰',
    'الزوجة الأولى':'👩‍🦰',
    'صاحب الشجرة':'🧑‍🌾'
  };
  return map[role] || '👤';
}
