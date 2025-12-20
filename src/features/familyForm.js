// منطق صرف بلا DOM: تطبيع/تحقق/بصمة/تركيب كائن الحفظ/لقطة النموذج
import { cloneBio } from '../model/families.js';
// مولّد _id موحّد لكل عناصر العائلة
const newId = () =>
  (crypto?.randomUUID?.() || ('id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));

/* ======================= أدوات عامة للنصوص ======================= */

// فاصل عام للفواصل العربية/الإنجليزية
const SPLIT_RE = /[,\u060C]/u;

// تقسيم نص إلى مصفوفة نصوص (بعد التشذيب وإزالة الفارغ)
function splitTextList(text) {
  return String(text || '')
    .split(SPLIT_RE)
    .map(s => s.trim())
    .filter(Boolean);
}

// تقسيم نص إلى مصفوفة كائنات { name }
function splitTextToNameObjects(text) {
  return splitTextList(text).map(name => ({ name }));
}

// اختيار بين مصفوفة جاهزة أو نص مفصول بفواصل
function ensureStringArray(arr, text) {
  if (Array.isArray(arr) && arr.length) return arr;
  return splitTextList(text);
}

/* ======================= تواريخ: سنة أو تاريخ كامل ======================= */

// حقل واحد في الواجهة (سنة أو تاريخ كامل) → تاريخ + سنة منفصلان
function normalizeDateOrYear(raw = '') {
  const v = String(raw || '').trim();
  if (!v) return { date: '', year: '' };

// سنة فقط (4 أرقام)
if (/^\d{4}$/.test(v)) {
  return { date: '', year: v };
}

// تاريخ مثل YYYY-MM-DD أو YYYY/MM/DD ⇒ نأخذ أول 4 أرقام كسنة
const m = v.match(/^(\d{4})[-/]/);
const year = m ? m[1] : (/^\d{4}/.test(v) ? v.slice(0,4) : '');
return { date: v, year };


}

/* ======================= أجداد ======================= */

export function normalizeAncestors(list = []) {
  // يقبل إما [{name,bio}, ...] أو مجرد أسماء
const raw = (list || [])
  .map((a, i) => ({
    _id: a?._id || '',
    name: String(a?.name ?? a ?? '').trim(),
    bio: {
      birthDate:  a?.bio?.birthDate  || '',
      deathDate:  a?.bio?.deathDate  || '',
      birthPlace: a?.bio?.birthPlace || '',
      occupation: a?.bio?.occupation || '',
      cognomen:   a?.bio?.cognomen   || '',
      remark:     a?.bio?.remark     || '',
      tribe:      a?.bio?.tribe      || '',
      clan:       a?.bio?.clan       || '',
      birthYear:  a?.bio?.birthYear  || '',
      deathYear:  a?.bio?.deathYear  || '',
      achievements:    Array.isArray(a?.bio?.achievements) ? a.bio.achievements : [],
      hobbies:         Array.isArray(a?.bio?.hobbies)      ? a.bio.hobbies      : [],
      achievementsTxt: a?.bio?.achievementsTxt || '',
      hobbiesTxt:      a?.bio?.hobbiesTxt      || ''
    },
    i
  }))
  .filter(x => x.name);


  return raw.map((x, idx) => {
    const b     = x.bio || {};
    const birth = normalizeDateOrYear(b.birthDate || b.birthYear || '');
    const death = normalizeDateOrYear(b.deathDate || b.deathYear || '');

    const achievementsArr = ensureStringArray(b.achievements, b.achievementsTxt);
    const hobbiesArr      = ensureStringArray(b.hobbies,      b.hobbiesTxt);

    const bio = {
      ...cloneBio(),
      ...b,
      birthDate: birth.date,
      birthYear: birth.year || b.birthYear || '',
      deathDate: death.date,
      deathYear: death.year || b.deathYear || '',
      achievements: achievementsArr,
      hobbies:      hobbiesArr
    };

    // لم نعد نحتاج النصوص الداخلية
    delete bio.achievementsTxt;
    delete bio.hobbiesTxt;

    return {
      _id: x._id || newId(),
      name: x.name,
      generation: idx + 1,
      role: `الجد ${idx + 1}`,
      bio
    };

  });
}

export function validateAncestorsInputs(names) {
  const rows = Array.isArray(names) ? names : [];
  if (!rows.length) return { ok: true, msg: '' };

  const isEmpty = v =>
    !String(v || '').trim() ||
    /^[\s\-–—ـ]+$/.test(String(v));

  const firstEmptyIdx = rows.findIndex(isEmpty);
  if (firstEmptyIdx !== -1) {
    return { ok: false, msg: 'أكمل اسم الجد أو احذف الصف الفارغ.' };
  }
  return { ok: true, msg: '' };
}

export function makeAncestorsRawKey(listOfNames) {
  const vals = (listOfNames || []).map(v => (String(v || '').trim() || '__EMPTY__'));
  return `${vals.length}::${vals.join('||')}`;
}

/* ======================= لقطة نموذج (Snapshot) ======================= */

export function computeFormSnapshot({ formFields, wives, ancestors, ancKey, father }) {
  const snap = {
    ancKey: ancKey ?? makeAncestorsRawKey((ancestors || []).map(a => a.name || '')),
    title: formFields.title || '',
    rootName: formFields.rootName || '',

    // إعدادات توريث النسب
    lineageTribeRule: formFields.lineageTribeRule || '',
    lineageClanRule:  formFields.lineageClanRule  || '',

    // الأب (بما في ذلك الميتا)
    father:             father?.name                || '',
    fatherBirthDate:    father?.bio?.birthDate      || '',
    fatherDeathDate:    father?.bio?.deathDate      || '',
    fatherBirthPlace:   father?.bio?.birthPlace     || '',
    fatherCognomen:     father?.bio?.cognomen       || '',
    fatherOccupation:   father?.bio?.occupation     || '',
    fatherRemark:       father?.bio?.remark         || '',
    fatherBrothersTxt:  father?.bio?.brothersTxt    || '',
    fatherSistersTxt:   father?.bio?.sistersTxt     || '',
    fatherAchievementsTxt: father?.bio?.achievementsTxt || '',
    fatherHobbiesTxt:      father?.bio?.hobbiesTxt      || '',

    // الأم (من formFields بعد قراءتها من بلوك الأم في الـ controller)
    motherName: formFields.motherName || '',
    motherClan: formFields.motherClan || '',

    // ميتا أم صاحب الشجرة
    rootMotherBirthDate:   formFields.rootMotherBirthDate   || '',
    rootMotherDeathDate:   formFields.rootMotherDeathDate   || '',
    rootMotherBirthPlace:  formFields.rootMotherBirthPlace  || '',
    rootMotherOccupation:  formFields.rootMotherOccupation  || '',
    rootMotherCognomen:    formFields.rootMotherCognomen    || '',
    rootMotherRemark:      formFields.rootMotherRemark      || '',
    rootMotherBrothersTxt: formFields.rootMotherBrothersTxt || '',
    rootMotherSistersTxt:  formFields.rootMotherSistersTxt  || '',
    rootMotherAchievementsTxt: formFields.rootMotherAchievementsTxt || '',
    rootMotherHobbiesTxt:      formFields.rootMotherHobbiesTxt      || '',

    // صاحب الشجرة + الميتا
    rootBirthDate: formFields.rootBirthDate || '',
    rootDeathDate: formFields.rootDeathDate || '',

    rootBirthPlace: formFields.rootBirthPlace || '',
    rootCognomen:   formFields.rootCognomen   || '',
    rootOccupation: formFields.rootOccupation || '',
    rootRemark:     formFields.rootRemark     || '',

    rootAchievementsTxt: formFields.rootAchievementsTxt || '',
    rootHobbiesTxt:      formFields.rootHobbiesTxt      || '',

    rootTribe: formFields.rootTribe || '',
    rootClan:  formFields.rootClan  || '',

    brothersTxt: formFields.brothersTxt || '',
    sistersTxt:  formFields.sistersTxt  || '',

    // الزوجات + الأبناء + ميتا الإخوة/الأخوات + ميتا أب/أم الزوجة
    wives: (wives || []).map(w => ({
      name: w.name || '',
      bio: {
        fullName:   w.bio?.fullName   || '',

        // أب الزوجة
        fatherName:       w.bio?.fatherName       || '',
        fatherCognomen:   w.bio?.fatherCognomen   || '',
        fatherBirthDate:  w.bio?.fatherBirthDate  || '',
        fatherDeathDate:  w.bio?.fatherDeathDate  || '',
        fatherBirthPlace: w.bio?.fatherBirthPlace || '',
        fatherOccupation: w.bio?.fatherOccupation || '',
        fatherRemark:     w.bio?.fatherRemark     || '',
        fatherClan:       w.bio?.fatherClan       || '',

        fatherBrothersTxt:     w.bio?.fatherBrothersTxt     || '',
        fatherSistersTxt:      w.bio?.fatherSistersTxt      || '',
        fatherAchievementsTxt: w.bio?.fatherAchievementsTxt || '',
        fatherHobbiesTxt:      w.bio?.fatherHobbiesTxt      || '',

        // أم الزوجة
        motherName:       w.bio?.motherName       || '',
        motherCognomen:   w.bio?.motherCognomen   || '',
        motherBirthDate:  w.bio?.motherBirthDate  || '',
        motherDeathDate:  w.bio?.motherDeathDate  || '',
        motherBirthPlace: w.bio?.motherBirthPlace || '',
        motherOccupation: w.bio?.motherOccupation || '',
        motherRemark:     w.bio?.motherRemark     || '',
        motherClan:       w.bio?.motherClan       || '',

        motherBrothersTxt:     w.bio?.motherBrothersTxt     || '',
        motherSistersTxt:      w.bio?.motherSistersTxt      || '',
        motherAchievementsTxt: w.bio?.motherAchievementsTxt || '',
        motherHobbiesTxt:      w.bio?.motherHobbiesTxt      || '',

        tribe:      w.bio?.tribe      || '',
        clan:       w.bio?.clan       || '',
        birthDate:  w.bio?.birthDate  || '',
        deathDate:  w.bio?.deathDate  || '',
        birthPlace: w.bio?.birthPlace || '',
        cognomen:   w.bio?.cognomen   || '',
        occupation: w.bio?.occupation || '',
        remark:     w.bio?.remark     || '',

        brothersTxt:     w.bio?.brothersTxt     || '',
        sistersTxt:      w.bio?.sistersTxt      || '',
        achievementsTxt: w.bio?.achievementsTxt || '',
        hobbiesTxt:      w.bio?.hobbiesTxt      || ''
      },

      children: (w.children || []).map(c => ({
        _id:        c._id        || '',
        name:       c.name       || '',
        role:       c.role       || '',
        birthDate:  c.birthDate  || '',
        deathDate:  c.deathDate  || '',
        birthPlace: c.birthPlace || '',
        occupation: c.occupation || '',
        cognomen:   c.cognomen   || '',
        remark:     c.remark     || '',
        achievementsTxt: c.achievementsTxt || '',
        hobbiesTxt:      c.hobbiesTxt      || '',
      }))
    })),

    // الأجداد
    ancestors: (ancestors || []).map(a => ({
      name: a.name,
      bio: {
        birthDate:  a.bio?.birthDate  || '',
        deathDate:  a.bio?.deathDate  || '',
        birthPlace: a.bio?.birthPlace || '',
        occupation: a.bio?.occupation || '',
        cognomen:   a.bio?.cognomen   || '',
        remark:     a.bio?.remark     || '',
        tribe:      a.bio?.tribe      || '',
        clan:       a.bio?.clan       || '',
        achievementsTxt: a.bio?.achievementsTxt || '',
        hobbiesTxt:      a.bio?.hobbiesTxt      || ''
      }
    }))
  };

  return snap;
}

/* ======================= أدوات تركيب كائن الحفظ (Helpers) ======================= */

// بناء كائن الأب كاملًا من fatherIn
function buildFather(fatherIn) {
  if (!fatherIn || !fatherIn.name) return null;

  const fb     = fatherIn.bio || {};
  const fBirth = normalizeDateOrYear(fb.birthDate || fb.birthYear || '');
  const fDeath = normalizeDateOrYear(fb.deathDate || fb.deathYear || '');

 // new — تحويل الإخوة/الأخوات إلى كائنات {name}
const fBrothers = splitTextToNameObjects(fb.brothersTxt || '');
const fSisters  = splitTextToNameObjects(fb.sistersTxt  || '');

  const fAchievements = splitTextList(fb.achievementsTxt || '');
  const fHobbies      = splitTextList(fb.hobbiesTxt      || '');

const bio = {
  ...cloneBio(),
  ...fb,
  birthDate:  fBirth.date,
  birthYear:  fBirth.year || fb.birthYear || '',
  deathDate:  fDeath.date,
  deathYear:  fDeath.year || fb.deathYear || '',
  birthPlace: fb.birthPlace || '',
  occupation: fb.occupation || '',
  cognomen:   fb.cognomen   || '',
  remark:     fb.remark     || '',
  siblingsBrothers: fBrothers,
  siblingsSisters:  fSisters,
  achievements:     fAchievements,
  hobbies:          fHobbies
};

//  لا نخزن txt داخل bio النهائي
delete bio.brothersTxt;
delete bio.sistersTxt;
delete bio.achievementsTxt;
delete bio.hobbiesTxt;

return {
  _id: fatherIn._id || newId(),
  name: fatherIn.name,
  role: 'الأب',
  fatherId: null,
  motherId: null,
  bio
};

}

// بناء rootPerson مع ميتا الأم (من formFields) + الإخوة + الإنجازات والهوايات
function buildRootPerson({
  formFields,
  rootName,
  rootBirthNorm,
  rootDeathNorm,
  rootBirthPlace,
  rootCognomen,
  rootOccupation,
  rootRemark,
  rootTribe,
  rootClan,
  composedFull,
  fatherName,
  gBrothers,
  gSisters,
  rootAchievements,
  rootHobbies,
  rootAchievementsTxt,
  rootHobbiesTxt,
  motherName,
  motherClan,
  motherAchievements,
  motherHobbies,
  motherAchievementsTxt,
  motherHobbiesTxt
}) {
  return {
    name: rootName,
    role: 'صاحب الشجرة',
    bio: {
      tribe: rootTribe,
      clan:  rootClan,

      birthDate: rootBirthNorm.date,
      birthYear: rootBirthNorm.year,
      deathDate: rootDeathNorm.date,
      deathYear: rootDeathNorm.year,

      birthPlace:  rootBirthPlace,
      cognomen:    rootCognomen,
      occupation:  rootOccupation,
      remark:      rootRemark,

      fullName:   composedFull || rootName || '',
      fatherName: fatherName || '',

      siblingsBrothers: gBrothers,
      siblingsSisters:  gSisters,

   achievements: rootAchievements,
hobbies:      rootHobbies,

      motherName,
      motherClan,
      motherBirthDate:  formFields.rootMotherBirthDate  || '',
      motherDeathDate:  formFields.rootMotherDeathDate  || '',
      motherBirthPlace: formFields.rootMotherBirthPlace || '',
      motherOccupation: formFields.rootMotherOccupation || '',
      motherCognomen:   formFields.rootMotherCognomen   || '',
      motherRemark:     formFields.rootMotherRemark     || '',

      motherBrothersTxt: formFields.rootMotherBrothersTxt || '',
      motherSistersTxt:  formFields.rootMotherSistersTxt  || '',

motherAchievements,
motherHobbies

    }
  };
}

// بناء الزوجات + الأبناء + ميتا أب/أم الزوجة
function buildWives({ wives, rootName, familyObj }) {
  if (!Array.isArray(wives) || !wives.length) return undefined;

  return wives.map((w, i) => {
    const role = w.role && w.role.startsWith('الزوجة') ? w.role : `الزوجة ${i + 1}`;
    const wifeId = w._id || newId();
    const fatherIdForKids =
      familyObj.father?._id || familyObj.rootPerson?._id || '';

    const wb        = w.bio || {};
    const wifeBirth = normalizeDateOrYear(wb.birthDate || wb.birthYear || '');
    const wifeDeath = normalizeDateOrYear(wb.deathDate || wb.deathYear || '');

    // إخوة/أخوات الزوجة
    const wifeBrothers = splitTextToNameObjects(wb.brothersTxt || '');
    const wifeSisters  = splitTextToNameObjects(wb.sistersTxt  || '');

    // إنجازات/هوايات الزوجة
    const wifeAchievementsTxt = wb.achievementsTxt || '';
    const wifeHobbiesTxt      = wb.hobbiesTxt      || '';

    const wifeAchievements = splitTextList(wifeAchievementsTxt);
    const wifeHobbies      = splitTextList(wifeHobbiesTxt);

    // إنجازات/هوايات أب الزوجة
    const wifeFatherAchievements = splitTextList(wb.fatherAchievementsTxt || '');
    const wifeFatherHobbies      = splitTextList(wb.fatherHobbiesTxt      || '');

    // إنجازات/هوايات أم الزوجة
    const wifeMotherAchievements = splitTextList(wb.motherAchievementsTxt || '');
    const wifeMotherHobbies      = splitTextList(wb.motherHobbiesTxt      || '');

    // الأطفال تحت هذه الزوجة
    const mappedChildren = (w.children || []).map(c => {
      const cb     = c || {};
      const cBirth = normalizeDateOrYear(cb.birthDate || cb.birthYear || '');
      const cDeath = normalizeDateOrYear(cb.deathDate || cb.deathYear || '');

      const childAchievementsTxt = cb.achievementsTxt || '';
      const childHobbiesTxt      = cb.hobbiesTxt      || '';

      const childAchievements = ensureStringArray(cb.achievements, childAchievementsTxt);
      const childHobbies      = ensureStringArray(cb.hobbies,      childHobbiesTxt);

      const childId = cb._id || newId();
      const motherId = wifeId;
      const fatherId = fatherIdForKids;

      const childBio = {
        ...cloneBio(),
        birthDate:  cBirth.date,
        birthYear:  cBirth.year || cb.birthYear || '',
        deathDate:  cDeath.date,
        deathYear:  cDeath.year || cb.deathYear || '',
        birthPlace: cb.birthPlace || '',
        cognomen:   cb.cognomen   || '',
        occupation: cb.occupation || '',
        remark:     cb.remark     || '',
        fatherName: rootName || familyObj.rootPerson?.name || '',
        motherName: w.name || '',

        achievements: childAchievements,
        hobbies:      childHobbies,

      };

      // أجداد أم/أب
      childBio.paternalGrandmother     = familyObj.rootPerson?.bio?.motherName || '';
      childBio.paternalGrandmotherClan = familyObj.rootPerson?.bio?.motherClan || '';
      childBio.maternalGrandmother     = wb.motherName || '';
      childBio.maternalGrandmotherClan = wb.motherClan || '';

      const fatherFullForChild =
        familyObj.fullRootPersonName ||
        familyObj.rootPerson?.bio?.fullName ||
        familyObj.rootPerson?.name ||
        familyObj.father?.name ||
        '';

      childBio.fullName = [cb.name || '', fatherFullForChild].filter(Boolean).join(' ').trim();
      childBio.motherTribe          = wb.tribe || '';
      childBio.motherClan           = wb.clan  || '';
      childBio.maternalGrandfather  = wb.fatherName || wb.fullName || '';

return {
  _id: childId,
  name: cb.name || '',
  role: cb.role || 'ابن',
  fatherId,
  motherId,

  // new — مراجع مباشرة كما يتوقعها Lineage
  father: fatherId,
  mother: motherId,

  bio: childBio
};

    });

    const wifeBio = {
      ...cloneBio(),
      ...wb,
      birthDate: wifeBirth.date,
      birthYear: wifeBirth.year || wb.birthYear || '',
      deathDate: wifeDeath.date,
      deathYear: wifeDeath.year || wb.deathYear || '',

      siblingsBrothers: wifeBrothers,
      siblingsSisters:  wifeSisters,

achievements: wifeAchievements,
hobbies:      wifeHobbies,

      fatherAchievements: wifeFatherAchievements,
      fatherHobbies:      wifeFatherHobbies,

      motherAchievements: wifeMotherAchievements,
      motherHobbies:      wifeMotherHobbies
    };
// لا نخزن txt داخل bio النهائي للزوجة
delete wifeBio.achievementsTxt;
delete wifeBio.hobbiesTxt;

// (اختياري لكن غالبًا مطلوب إذا عندك arrays بديلة لها)
delete wifeBio.fatherAchievementsTxt;
delete wifeBio.fatherHobbiesTxt;
delete wifeBio.motherAchievementsTxt;
delete wifeBio.motherHobbiesTxt;

        return { _id: wifeId, name: w.name || '', role, bio: wifeBio, children: mappedChildren };

  });
}

// حمل الصور والمفاتيح من العائلة السابقة إن وجدت
function carryPrevImages(prevFamily, familyObj) {
  if (!prevFamily) return;

  const imgKeys  = ['image', 'imageUrl', 'photo', 'photoUrl', 'avatar', 'avatarUrl', 'cover', 'coverUrl'];
  const cropKeys = ['imageCrop', 'photoCrop', 'avatarCrop', 'coverCrop', 'crop', 'cropData', 'cropRect'];

  const copyKeys = (src, dst, keys) => {
    if (!src || !dst) return;
    keys.forEach(k => {
      if (src[k] != null && dst[k] == null) dst[k] = src[k];
    });
  };

  const keepImages = (prevObj, nextObj) => {
    copyKeys(prevObj, nextObj, imgKeys);
    copyKeys(prevObj, nextObj, cropKeys);

    if (prevObj.rootPerson) {
      nextObj.rootPerson = nextObj.rootPerson || {};
      copyKeys(prevObj.rootPerson, nextObj.rootPerson, ['photo', 'photoUrl']);

      nextObj.rootPerson.bio = nextObj.rootPerson.bio || {};
      const pb = prevObj.rootPerson.bio || {};
      copyKeys(pb, nextObj.rootPerson.bio, imgKeys);
      copyKeys(pb, nextObj.rootPerson.bio, cropKeys);
    }
  };

  const carryImagesForList = (prevList = [], nextList = []) => {
    const byId = new Map(prevList.map(p => [p._id || p.name, p]));
    nextList.forEach(n => {
      const p = byId.get(n._id || n.name);
      if (!p) return;
      n.bio = n.bio || {};
      const pb = p.bio || {};
      copyKeys(pb, n.bio, imgKeys);
      copyKeys(pb, n.bio, cropKeys);
      if (Array.isArray(p.children) && Array.isArray(n.children)) {
        carryImagesForList(p.children, n.children);
      }
    });
  };

  keepImages(prevFamily, familyObj);
  if (Array.isArray(prevFamily.wives) && Array.isArray(familyObj.wives)) {
    carryImagesForList(prevFamily.wives, familyObj.wives);
  }
}

// إعدادات النسب في __meta.lineage
function buildLineageMeta(prevFamily, formFields) {
  const prevMeta    = (prevFamily && prevFamily.__meta) ? { ...prevFamily.__meta } : {};
  const prevLineage = prevMeta.lineage || {};

  const lineageTribeRule =
    formFields.lineageTribeRule ||
    prevLineage.tribeRule ||
    'father';

  const lineageClanRule =
    formFields.lineageClanRule ||
    prevLineage.clanRule ||
    'father';

  return {
    ...prevMeta,
    lineage: {
      ...prevLineage,
      tribeRule: lineageTribeRule,
      clanRule:  lineageClanRule
    }
  };
}

/* ======================= تركيب كائن العائلة للحفظ ======================= */

export function composeFamilyObject({ formFields, wives, ancestors, prevFamily, father }) {
  const titleInput = formFields.title    || '';
  const rootName   = formFields.rootName || '';
  const fatherIn   = father && father.name ? father : null;

  // ميلاد/وفاة صاحب الشجرة
  const rootBirthNorm = normalizeDateOrYear(formFields.rootBirthDate || '');
  const rootDeathNorm = normalizeDateOrYear(formFields.rootDeathDate || '');

  const rootBirthPlace = formFields.rootBirthPlace || '';
  const rootCognomen   = formFields.rootCognomen   || '';
  const rootOccupation = formFields.rootOccupation || '';
  const rootRemark     = formFields.rootRemark     || '';
  const rootTribe      = formFields.rootTribe      || '';
  const rootClan       = formFields.rootClan       || '';

  // نص إنجازات/هوايات صاحب الشجرة
  const rootAchievementsTxt = formFields.rootAchievementsTxt || '';
  const rootHobbiesTxt      = formFields.rootHobbiesTxt      || '';
  const rootAchievements    = splitTextList(rootAchievementsTxt);
  const rootHobbies         = splitTextList(rootHobbiesTxt);

  // الأم من formFields
  const motherName = formFields.motherName || '';
  const motherClan = formFields.motherClan || '';

  const motherAchievementsTxt = formFields.rootMotherAchievementsTxt || '';
  const motherHobbiesTxt      = formFields.rootMotherHobbiesTxt      || '';
  const motherAchievements    = splitTextList(motherAchievementsTxt);
  const motherHobbies         = splitTextList(motherHobbiesTxt);

  // إخوة/أخوات صاحب الشجرة
  const gBrothers = splitTextToNameObjects(formFields.brothersTxt || '');
  const gSisters  = splitTextToNameObjects(formFields.sistersTxt  || '');

  // الأجداد (منظمين)
  const anc = normalizeAncestors(ancestors || []);

  const composedFull = [rootName, (fatherIn?.name || '')]
    .concat(anc.slice(0, 2).map(a => a.name || ''))
    .filter(Boolean)
    .join(' ')
    .trim();

  const familyShort = titleInput ? titleInput.replace(/^.*?:\s*/u, '').trim()
    : ((rootName.split(/\s+/u)[0]) ||
       (composedFull.split(/\s+/u)[0]) ||
       'عائلة');

  const familyObj = {
    familyName:         familyShort,
    fullRootPersonName: composedFull || rootName,
    title:              familyShort,
    ancestors:          anc
  };

  // الأب بموديل bio كامل
  if (fatherIn) {
    familyObj.father = buildFather(fatherIn);
  }

  // صاحب الشجرة + الأم + الإخوة + الإنجازات/الهوايات
  familyObj.rootPerson = buildRootPerson({
    formFields,
    rootName,
    rootBirthNorm,
    rootDeathNorm,
    rootBirthPlace,
    rootCognomen,
    rootOccupation,
    rootRemark,
    rootTribe,
    rootClan,
    composedFull,
    fatherName: familyObj.father?.name || '',
    gBrothers,
    gSisters,
    rootAchievements,
    rootHobbies,
    rootAchievementsTxt,
    rootHobbiesTxt,
    motherName,
    motherClan,
    motherAchievements,
    motherHobbies,
    motherAchievementsTxt,
    motherHobbiesTxt
  });

  // تثبيت _id لصاحب الشجرة (مع الحفاظ على القديم عند التعديل)
  familyObj.rootPerson._id =
    prevFamily?.rootPerson?._id || familyObj.rootPerson._id || newId();

  const wivesArr = buildWives({ wives, rootName, familyObj });
  if (wivesArr) {
    familyObj.wives = wivesArr;
  } else {
    familyObj.wives = [];
  }

  // مرجع متوافق
  familyObj.rootPerson.wives = familyObj.wives;
  // حمل الصور من العائلة السابقة إن وجدت
  if (prevFamily) {
    carryPrevImages(prevFamily, familyObj);
  }

  // إعدادات النسب في __meta
  familyObj.__meta = buildLineageMeta(prevFamily, formFields);

  return familyObj;
}