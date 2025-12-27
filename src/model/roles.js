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
export const ROLE_FILTER_VALUES = ['جد','الأب','صاحب الشجرة','زوجة','ابن','بنت'];

// تخمين جنس الشخص من الحقول المتاحة (bio.gender / person.gender / role)
export function inferGender(p){
  if (!p) return null;
  const bio = p.bio || {};

  // 1) جنس صريح إن وُجد
  const rawG = String(bio.gender || p.gender || '').trim();
  if (rawG === 'ذكر' || /^m(ale)?$/i.test(rawG))  return 'M';
  if (rawG === 'أنثى' || /^f(emale)?$/i.test(rawG)) return 'F';

  // 2) fallback من الدور الحالي في الشجرة
  const r = String(p.role || '').trim();

  // أدوار نعتبرها "ذكَر"
  if (
    r === 'ابن' ||
    r === 'الأب' ||
    r === 'صاحب الشجرة' ||
    r === 'زوج' ||
    r.startsWith('الجد')
  ) return 'M';

  // أدوار نعتبرها "أنثى"
  if (
    r === 'بنت' ||
    r === 'الأم' ||
    r === 'زوجة' ||
    r.startsWith('الزوجة') ||
    r === 'جدة'
  ) return 'F';

  return null;
}

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
