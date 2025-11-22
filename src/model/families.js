// families.js
// =======================================
// تخزين العائلات + ترحيل النسخ + أدوات التطبيع
// (منظّم ومختصر مع تعليقات عربية موجزة)
// =======================================
import { getArabicOrdinal, getArabicOrdinalF } from '../utils.js';


import { DB } from '../storage/db.js';

// -------- مفاتيح/نسخ عامّة --------
export const PERSIST_FAMILIES_KEY = 'families';
export const SCHEMA_VERSION = 4;

// =======================================
// 1) تطبيع نصوص وأسماء
// =======================================

// تطبيع عربي عام
const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const AR_TATWEEL = /\u0640/gu;

// تطبيع عربي عام
function _norm(s = '', { keepPunct = false } = {}) {
  let out = String(s)
    .normalize('NFKD')
    .replace(AR_DIAC, '')
    .replace(AR_TATWEEL, '')
    .replace(/[\u0622\u0623\u0625]/gu, 'ا')
    .replace(/\u0649/gu, 'ي')
    .replace(/\u0629/gu, 'ه');

  if (!keepPunct) {
    out = out
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    out = out.replace(/\s+/g, ' ').trim();
  }
  return out;
}

// مفتاح تطابق بالاسم فقط (لا يُستخدم كمعرّف)
function _normKey(p){
  return _norm((p?.name || '').toString().trim(), { keepPunct: true });
}

// =======================================
// 2) ترحيل هيكل العائلة بين نسخ الـ Schema
// =======================================
export function migrate(f, fromVer = 0, toVer = SCHEMA_VERSION) {
  if (!f || !Number.isFinite(fromVer)) return f;
  let v = +fromVer;

  // → v2: إزالة wives القديمة تحت rootPerson + grandson→rootPerson
  if (v < 2) {
    if (f.rootPerson && Array.isArray(f.rootPerson.wives)) delete f.rootPerson.wives;
    if (f.grandson && !f.rootPerson) { f.rootPerson = f.grandson; delete f.grandson; }
    if (f.fullGrandsonName && !f.fullRootPersonName) { f.fullRootPersonName = f.fullGrandsonName; delete f.fullGrandsonName; }
    v = 2;
  }

  // → v4: اعتماد ancestors[] غير محدود + تنظيف الحقول التاريخية
  if (v < 4) {
    if (!Array.isArray(f.ancestors)) f.ancestors = [];
    if ('grandfather_1' in f) delete f.grandfather_1;
    if ('grandfather_2' in f) delete f.grandfather_2;

    // نحافظ على ترتيب المصفوفة كما هو، ونضبط generation فقط
    f.ancestors = f.ancestors
      .filter(Boolean)
      .map((a, idx) => ({
        ...a,
        // إن لم توجد generation نشتقها من موضعه (1 = الأقرب لصاحب الشجرة)
        generation: Number.isFinite(+a.generation) ? +a.generation : (idx + 1) || 1
      }));

    v = 4;
  }

  f.__v = toVer;
  return f;
}

// =======================================
// 3) قيم افتراضية للـ bio + التسميات
// =======================================
const DEFAULT_BIO = {
  fullName: '',
  name: '',
  fatherName: '',
  motherName: '',
  motherClan: '',
  tribe: '',
  clan: '',
  birthDate: '',
  birthYear: '',
  deathDate: '',
  deathYear: '',
  birthPlace: '',
  occupation: '',
  remark: '',
  siblingsBrothers: [], siblingsSisters: [],
   achievements: [],
  hobbies: [],
  photoUrl: ''
};

const LABELS = {
    fullName: 'الإسم',
    cognomen: 'اللقب',
    fatherName: 'اسم الأب',
    tribe: 'القبيلة',
    clan: 'العشيرة',
    motherName: 'اسم الأم',
    motherClan: 'عشيرة الأم',
    maternalGrandfather: 'اسم الجد من جهة الأم',
    maternalGrandmother: 'الجدة من جهة الأم',
    maternalGrandmotherClan: 'عشيرة الجدة من جهة الأم',
    paternalGrandmother: 'الجدة من جهة الأب',
    paternalGrandmotherClan: 'عشيرة الجدة من جهة الأب',
    paternalGrandfather: 'الجد من جهة الأب',

    // الميلاد/الوفاة
    birthDate: 'تاريخ الميلاد',
    birthYear: 'سنة الميلاد',
    deathDate: 'تاريخ الوفاة',
    deathYear: 'سنة الوفاة',

    birthPlace: 'مكان الميلاد',
    occupation: 'المهنة',
    remark: 'ملاحظة'
};

// مزامنة تاريخ الميلاد/الوفاة مع سنة الميلاد/الوفاة
function normalizeLifeDatesOnBio(bio) {
  if (!bio || typeof bio !== 'object') return;

  const bd = String(bio.birthDate || '').trim();
  const by = String(bio.birthYear || '').trim();

  // إن وُجد تاريخ ميلاد كامل ولا توجد سنة (أو كانت علامة '-') ⇒ استخرج السنة من التاريخ
  if (bd && (!by || by === '-') && /^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    bio.birthYear = bd.slice(0, 4);
  }

  const dd = String(bio.deathDate || '').trim();
  const dy = String(bio.deathYear || '').trim();

  // إن وُجد تاريخ وفاة كامل ولا توجد سنة (أو كانت علامة '-') ⇒ استخرج السنة من التاريخ
  if (dd && (!dy || dy === '-') && /^\d{4}-\d{2}-\d{2}$/.test(dd)) {
    bio.deathYear = dd.slice(0, 4);
  }

  // ملاحظة: إن كانت السنة موجودة دون تاريخ، نتركها كما هي (لا نخترع يوم/شهر)
}

function _cloneDefaultBio(){
  const base = structuredClone  ? structuredClone(DEFAULT_BIO)
    : JSON.parse(JSON.stringify(DEFAULT_BIO));
  normalizeLifeDatesOnBio(base);
  return base;
}

function _withBio(srcBio){
  const bio = Object.assign(_cloneDefaultBio(), srcBio || {});
  normalizeLifeDatesOnBio(bio);
  return bio;
}

// استنساخ Bio مع القيم الافتراضية
export const cloneBio = (src = {}) => Object.assign(_cloneDefaultBio(), src || {});

function _normalizeChild(c){
  if (typeof c === 'string') {
    return { name: c, role: 'ابن', bio: _cloneDefaultBio() };
  }
  const bio = _withBio(c?.bio);
  return {
    name: c?.name || '',
    role: c?.role || 'ابن',
    bio,
    _id: c?._id
  };
}

function _normalizeWifeRole(role, idx){
  let r = String(role || '').trim() || 'زوجة';
  const m = r.match(/^ال?زوجة\s+(\d+)$/u);
  if (m) {
    const n = parseInt(m[1], 10) || (idx + 1) || 1;
    return `الزوجة ${getArabicOrdinalF(n)}`;
  }
  if (r === 'زوجة') return `الزوجة ${getArabicOrdinalF((idx + 1) || 1)}`;
  return r;
}

function _normalizeWife(w, idx){
  const wifeBio = _withBio(w?.bio);
  const ww = {
    name: w?.name || '',
    role: _normalizeWifeRole(w?.role, idx),
    bio: wifeBio
  };
  ww.children = (w?.children || []).map(_normalizeChild);
  return ww;
}

// =======================================
// 4) تهيئة الأشخاص (Bio + IDs + تطبيع محفوظ)
// =======================================

// تهيئة كائن شخص واحد
function ensureBio(person) {
  if (!person) return;

  person.bio = _withBio(person.bio);

  if (Array.isArray(person.children)) {
    person.children = person.children.map(_normalizeChild);
  }

  if (Array.isArray(person.wives)) {
    person.wives = person.wives.map(_normalizeWife);
  }
}


// تهيئة Bio للعائلة كاملة
function ensureFamilyBios(f) {
  if (!f) return;

  // الأب + صاحب الشجرة
  ['father', 'rootPerson'].forEach(k => { if (f[k]) ensureBio(f[k]); });

  // تهيئة Bio للزوجات
  (f.wives || []).forEach(w => ensureBio(w));

  // توحيد أدوار الزوجات على مستوى العائلة:
  // "الزوجة 1 / زوجة 1" → "الزوجة الأولى" ... الخ
if (Array.isArray(f.wives)) {
  f.wives = f.wives.map((w, idx) => ({ ...w, role: _normalizeWifeRole(w?.role, idx) }));
}

  // تهيئة Bio للأجداد أيضًا (مع مزامنة تواريخ الميلاد/الوفاة)
if (Array.isArray(f.ancestors)) {
  f.ancestors = f.ancestors.map(a => {
    ensureBio(a);
    const g0 = Number.isFinite(+a.generation) ? +a.generation : 1;
    let r = String(a.role || '').trim();

    const m = r.match(/^الجد\s*(\d+)$/u);
    if (m) {
      const n = parseInt(m[1], 10) || g0;
      r = `الجد ${getArabicOrdinal(n)}`;
    } else if (!r || r === 'جد' || /^الجد\s*\d+$/u.test(r)) {
      r = `الجد ${getArabicOrdinal(g0)}`;
    }
    return { ...a, generation: g0, role: r };
  });
}

}

// ضمان وجود معرفات + حقول تطبيع مخزّنة (_norm*)
function ensureIds(f) {
  if (!f) return;
  const giveId = (obj, prefix = 'p') => {
    if (!obj) return;
    if (!obj._id) obj._id = (crypto?.randomUUID ? crypto.randomUUID() : `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  };
  const indexPerson = (p) => {
    giveId(p, 'p');
    if (p) { p._normName = _norm(p.name || ''); p._normRole = _norm(p.role || ''); }
    (p?.children || []).forEach(c => {
      giveId(c, 'c');
      if (c) { c._normName = _norm(c.name || ''); c._normRole = _norm(c.role || ''); }
    });
    (p?.wives || []).forEach(indexPerson);
  };

  [f.father, f.rootPerson, ...(f.wives || []), ...(Array.isArray(f.ancestors) ? f.ancestors : [])].forEach(indexPerson);
}

// =======================================
// 5) بيانات افتراضية (عائلات أساسية)
// =======================================
const B=(e={})=>({...DEFAULT_BIO,...e});
const P=(name,role,bio={},extra={})=>({name,role,bio:B(bio),...extra});
const C=(name,role='ابن',bio={},extra={})=>P(name,role,bio,extra);
const W=(name,role,bio={},children=[],extra={})=>({name,role,bio:B(bio),children,...extra});

const familiesData = {
family1:{familyName:'سَيْدِنا',fullRootPersonName:'أحمد محمد إدريس بُقَرْ',
  ancestors:[
    P('إدريس','الجد الأول',{fullName:'إدريس بُقَرْ',birthDate:'1860-01-01',deathDate:'1935-01-01',birthPlace:'تشاد',occupation:'إمام وقارئ قرآن',achievements:['حافظ لكتاب الله','غرس القيم الإسلامية في العائلة','حافظ على صلة الرحم بين الفروع'],hobbies:['مجالس القرآن','الجلوس مع الأحفاد وسرد القصص'],description:'حافظ تقاليد العائلة ومرشد الأجيال',education:'حافظ لكتاب الله'},{generation:1}),
    P('بُقَرْ','الجد الثاني',{fullName:'بُقَرْ',birthDate:'1835-01-01',deathDate:'1910-01-01',birthPlace:'تشاد',occupation:'وجيه قبلي وتاجر',achievements:['أسس مكانة العائلة الاجتماعية في القبيلة','سعى في إصلاح ذات البين بين الناس'],hobbies:['الجلوس مع وجهاء القبيلة','متابعة أمور المزارع والأنعام'],description:'مؤسس العائلة وحامل إرثها العريق',education:'-'},{generation:2})
  ],
  father:P('محمد','الأب',{fullName:'محمد إدريس بُقَرْ',birthDate:'1885-01-01',deathDate:'1965-01-01',birthPlace:'تشاد',occupation:'إمام وخطيب ومعلم قرآن',achievements:['حافظ لكتاب الله','ربى أبناءه على طلب العلم الشرعي','عُرف بالحكمة والإصلاح بين الناس'],hobbies:['قراءة القرآن','تعليم الصغار مبادئ الدين','الزراعة في أرض العائلة'],description:'قائد العائلة ومسؤول عن استمراريتها',education:'حافظ لكتاب الله'}),
  rootPerson:P('أحمد','صاحب الشجرة',{fullName:'أحمد محمد إدريس بُقَرْ',cognomen:'سَيْدِنا',tribe:'قٌرْعان',clan:'يِرِي',motherName:'-',motherClan:'يِرِي',paternalGrandfather:'إدريس بُقَرْ',paternalGrandmother:'-',paternalGrandmotherClan:'-',maternalGrandfather:'-',maternalGrandfatherClan:'',maternalGrandmother:'-',maternalGrandmotherClan:'-',birthDate:'1910-01-01',deathDate:'1995-01-01',birthPlace:'تشاد',occupation:'إمام ومعلم قرآن ومرجع للعائلة',achievements:['حافظ لكتاب الله','أسس مجلسًا لتحفيظ القرآن في القرية','قام بجمع شجرة العائلة وتوثيقها','كان مرجعًا في الإصلاح العائلي وحل النزاعات','حافظ على مجلس أسبوعي للذكر والتربية الإيمانية'],hobbies:['القراءة في التفسير والفقه','الزراعة ورعاية النخل والزروع','تعليم الصغار القرآن في البيت والمسجد'],description:'حامل إرث العائلة ومستمر في تقاليدها',education:'حافظ لكتاب الله',remark:'سَيْدِنا ومصطفى أشقاء',siblingsBrothers:[{name:'مصطفى'},{name:'مَلْ لَمين'}],siblingsSisters:[{name:'رُوا'},{name:'زينفة'},{name:'مُرْمَ'},{name:'جُلّي'}]}),
  wives:[
    W('مَرْ موسى رَوْ','الزوجة الأولى',{fullName:'مَرْ موسى رَوْ',fatherName:'مصطفى',motherName:'-',tribe:'قٌرْعان',clan:'كُشى',birthDate:'1915-01-01',deathDate:'2000-01-01',birthPlace:'تشاد',occupation:'ربّة بيت ومربية أجيال',achievements:['رَبَّت أبناءها على حفظ القرآن واحترام الكبير','كانت سندًا لزوجها في حمل مسؤولية العائلة','معروفة بالكرم وإكرام الضيوف'],hobbies:['تلاوة القرآن في البيت','إعداد الطعام للضيوف','غرس حب العائلة في قلوب الأبناء']},[
      C('آدام','ابن',{fullName:'آدام أحمد محمد',birthDate:'1935-01-01',birthPlace:'تشاد',occupation:'إمام مسجد ومحفظ قرآن',achievements:['حافظ لكتاب الله','أدار حلقات تحفيظ لسنوات طويلة','شارك في بناء مسجد الحي'],hobbies:['قراءة الكتب الشرعية','مرافقة طلاب العلم','الزراعة البسيطة في أرض العائلة']}),
      C('أبَكُرِى','ابن',{fullName:'أبَكُرِى أحمد محمد',birthDate:'1938-01-01',birthPlace:'تشاد',occupation:'تاجر وأمين صندوق عائلي',achievements:['ساهم في تنمية دخل العائلة بالتجارة الحلال','شارك في دعم مشاريع تحفيظ القرآن','معروف بالأمانة في المعاملات'],hobbies:['متابعة أحوال السوق','الاجتماع مع كبار العائلة','دعم الأعمال الخيرية']}),
      C('مَلْ علي','ابن',{fullName:'مَلْ علي أحمد محمد',birthDate:'1940-01-01',birthPlace:'تشاد',occupation:'داعية ومُعلِّم',achievements:['ألقى دروسًا في المساجد حول الأخلاق والآداب','ساعد في حل الخلافات بين الأسر المجاورة'],hobbies:['القراءة في السيرة النبوية','زيارة الأقارب وصلة الرحم']}),
      C('مَلْ سِنِّي','ابن',{fullName:'مَلْ سِنِّي أحمد محمد',birthDate:'1943-01-01',birthPlace:'تشاد',occupation:'مزارع وصاحب أرض',achievements:['طور مزارع العائلة وزاد إنتاجها','كان يخصص جزءًا من المحصول للفقراء'],hobbies:['العمل في المزرعة','تربية الماشية','الجلوس في مجالس العائلة']}),
      C('محمد نور','ابن',{fullName:'محمد نور أحمد محمد',birthDate:'1946-01-01',birthPlace:'تشاد',occupation:'مدرس قرآن في الكتّاب',achievements:['خرَّج أعدادًا من حفظة كتاب الله','مهتم بتعليم التجويد للصغار'],hobbies:['تحفيظ القرآن','زيارة الطلاب في بيوتهم تشجيعًا لهم']}),
      C('إدريس','ابن',{fullName:'إدريس أحمد محمد',birthDate:'1949-01-01',birthPlace:'تشاد',occupation:'موظف في التعليم',achievements:['خدم في قطاع التعليم سنوات طويلة','شجع أبناء العائلة على إكمال دراستهم'],hobbies:['قراءة الكتب التربوية','المشاركة في الأنشطة المدرسية']}),
      C('زهرة','بنت',{fullName:'زهرة أحمد محمد',birthDate:'1952-01-01',birthPlace:'تشاد',occupation:'معلمة قرآن للنساء',achievements:['علّمت نساء الحي القرآن وأحكام الطهارة والصلاة','معروفة بحسن الخلق والستر'],hobbies:['تلاوة القرآن','حضور الدروس الشرعية النسائية']}),
      C('لُكِي','بنت',{fullName:'لُكِي أحمد محمد',birthDate:'1955-01-01',birthPlace:'تشاد',occupation:'قابلة تقليدية',achievements:['ساعدت في ولادات كثيرة في القرية','كانت تراعي ضوابط الشريعة في عملها'],hobbies:['خدمة النساء في القرية','حضور المجالس العائلية']}),
      C('فاطمة','بنت',{fullName:'فاطمة أحمد محمد',birthDate:'1958-01-01',birthPlace:'تشاد',occupation:'ربّة بيت وداعمة للأعمال الخيرية',achievements:['شاركت في حملات إغاثية للفقراء','حافظت على جو إيماني داخل بيتها'],hobbies:['الاهتمام بالأبناء وتربيتهم','إعداد الطعام في المناسبات العائلية']})
    ]),
    W('زهرة عَسْبَلَّ بُلْجي','الزوجة الثانية',{fullName:'زهرة عَسْبَلَّ بُلْجي',fatherName:'-',motherName:'زاري فُزَرْياراي',motherClan:'مِدْلِي',tribe:'قٌرْعان',clan:'كُمَّجِلي',birthDate:'1912-01-01',deathDate:'1992-01-01',birthPlace:'تشاد',occupation:'ربّة بيت وحافظة لأنساب العائلة',achievements:['حفظت أخبار الجيل السابق ونقلتها للأحفاد','معروفة بالحكمة والصبر','حريصة على جمع الأحفاد في المناسبات'],hobbies:['سرد قصص الأجداد للأحفاد','الجلوس في مجالس النساء للتذكير بالله'],remark:'هي أم لجدي محمد وجدي أبكر'},[
      C('محمد','ابن',{fullName:'محمد أحمد',birthDate:'1938-01-01',deathDate:'2010-01-01',birthPlace:'تشاد',occupation:'إمام وخطيب',achievements:['خطب في الناس سنوات طويلة','أسهم في نشر العلم الشرعي في القرى المجاورة'],hobbies:['تحضير الدروس والخطب','زيارة المرضى وكبار السن'],remark:'جدي من جهة الأب'}),
      C('موسى','ابن',{fullName:'موسى أحمد',birthDate:'1941-01-01',birthPlace:'تشاد',occupation:'محفظ قرآن ومربي',achievements:['حافظ لكتاب الله','أشرف على كتّاب لتحفيظ القرآن','شارك في دعم طلاب العلم'],hobbies:['تجويد القرآن','الجلوس مع طلابه خارج أوقات الدروس'],education:'حافظ لكتاب الله'}),
      C('أبكر','ابن',{fullName:'أبكر أحمد',birthDate:'1944-01-01',deathDate:'2012-01-01',birthPlace:'تشاد',occupation:'تاجر ووجيه في العائلة',achievements:['ساهم في توسعة بيوت العائلة','كان له دور في الصلح بين العائلات الأخرى'],hobbies:['السفر للتجارة','مجالس الصلح بين الناس'],remark:'جدي من جهة الأم'})
    ]),
    W('فاطمة علي عبد الكريم','الزوجة الثالثة',{fullName:'فاطمة علي عبد الكريم',fatherName:'علي',motherName:'-',tribe:'قٌرْعان',clan:'مِلاَّ',birthDate:'1918-01-01',deathDate:'2003-01-01',birthPlace:'تشاد',occupation:'ربّة بيت ومربية',achievements:['رعت أبناءها على الاستقامة والخلق الحسن','عرفت بحرصها على العفاف والستر'],hobbies:['خدمة زوجها وأبنائها','إكرام الضيوف','حضور المناسبات العائلية'],remark:'تزوجها أخوه مصطفى بعد وفاته'},[
      C('محمد','ابن',{fullName:'محمد أحمد',birthDate:'1948-01-01',birthPlace:'تشاد',occupation:'إمام ومعلّم قرآن',achievements:['حافظ لكتاب الله','درّس القرآن لصغار الحي','شارك في ترميم مسجد القرية'],hobbies:['قراءة الكتب الدينية','الاعتكاف في رمضان'],education:'حافظ لكتاب الله'}),
      C('عبد الرحمن','ابن',{fullName:'عبد الرحمن أحمد',birthDate:'1951-01-01',birthPlace:'تشاد',occupation:'موظف وإمام احتياط',cognomen:'أَدِّ',achievements:['جمع بين العمل الوظيفي وخدمة المسجد','شارك في لجان الخير بالعائلة'],hobbies:['تلاوة القرآن بعد الفجر','المشاركة في الأعمال التطوعية']}),
      C('هرةَ شو','بنت',{fullName:'هرةَ شو أحمد',birthDate:'1954-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['معروفة بحسن التربية لأولادها','حافظت على صلة الرحم مع أهلها وأقاربها'],hobbies:['الاهتمام بالبيت والأبناء','حضور المجالس النسائية']})
    ]),
    W('كُري بَتُرَنْ','الزوجة الرابعة',{fullName:'كُري بَتُرَنْ',fatherName:'بَتُرَنْ',motherName:'-',tribe:'قٌرْعان',clan:'بَرِيَ',birthDate:'1920-01-01',deathDate:'2008-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['عُرفت بالسكينة والوقار داخل البيت','حافظت على جو إيماني في بيتها'],hobbies:['خدمة أهل البيت','الجلوس مع الأحفاد']},[
      C('بشير','ابن',{fullName:'بشير أحمد',birthDate:'1956-01-01',birthPlace:'تشاد',occupation:'موظف ومشارك في أعمال الخير',achievements:['شارك في مشروعات حفر الآبار الخيرية','يساعد في ترتيبات اللقاءات العائلية الكبرى'],hobbies:['زيارة القرابة','المشاركة في الأعمال التطوعية']})
    ])
  ]
},

family2:{familyName:'كُبُرَ زين',fullRootPersonName:'محمد موسى قيلي أُبِي',
  ancestors:[
    P('قيلي','الجد الأول',{fullName:'قيلي',birthDate:'1840-01-01',deathDate:'1910-01-01',birthPlace:'تشاد',occupation:'إمام وقارئ قرآن',achievements:['حافظ لكتاب الله','حافظ على مجلس القرآن في العائلة','غرس القيم الإسلامية في الأبناء'],hobbies:['مجالس الذكر','الجلوس مع الأحفاد وسرد القصص'],description:'حافظ تقاليد العائلة ومرشد الأجيال',education:'حافظ لكتاب الله'},{generation:1}),
    P('أُبي','الجد الثاني',{fullName:'أُبي',birthDate:'1810-01-01',deathDate:'1880-01-01',birthPlace:'تشاد',occupation:'وجيه قبلي وتاجر',achievements:['مؤسس العائلة وحامل إرثها العريق','سعى في إصلاح ذات البين','عُرف بالأمانة والصدق في التجارة'],hobbies:['مجالس الوجهاء','متابعة شؤون المزارع والأنعام'],description:'مؤسس العائلة وحامل إرثها العريق',education:'حافظ لكتاب الله'},{generation:2})
  ],
  father:P('موسى','الأب',{fullName:'موسى قيلي أُبي',birthDate:'1870-01-01',deathDate:'1950-01-01',birthPlace:'تشاد',occupation:'إمام وخطيب ومعلم قرآن',achievements:['حافظ لكتاب الله','ربى أبناءه على طلب العلم الشرعي','كان مرجعًا في حل النزاعات داخل العائلة'],hobbies:['قراءة القرآن','تعليم الصغار مبادئ الدين','الزراعة في أرض العائلة'],description:'قائد العائلة ومسؤول عن استمراريتها',education:'حافظ لكتاب الله'}),
  rootPerson:P('محمد','صاحب الشجرة',{fullName:'محمد موسى قيلي أُبِي',cognomen:'كُبُرَ زين مَلْ مار جيلي',tribe:'قٌرْعان',clan:'ضولو',motherName:'شونُرا عَقِد مِلى',motherClan:'ضولو',paternalGrandfather:'قيلي',paternalGrandmother:'-',paternalGrandmotherClan:'-',maternalGrandfather:'-',maternalGrandfatherClan:'',maternalGrandmother:'-',maternalGrandmotherClan:'-',birthDate:'1900-01-01',deathDate:'1980-01-01',birthPlace:'تشاد',occupation:'إمام ومرجع للعائلة',achievements:['حافظ لكتاب الله','أقام حلقات لتحفيظ القرآن في الحي','حافظ على أنساب العائلة ودوّنها','كان مرجعًا شرعيًا لأفراد العائلة'],hobbies:['القراءة في التفسير والفقه','تعليم الصغار القرآن','الزراعة ورعاية مزارع العائلة'],education:'حافظ لكتاب الله',remark:'هو وأبوه وجده وأبو جده كلهم حُفَّاظ لكتاب الله',siblingsBrothers:[{name:'سليمان'},{name:'عمر شُوِي'}],siblingsSisters:[{name:'كُرِي'},{name:'مَرْمَ فُلْجِى'},{name:'أمِنَة'},{name:'جَنّبَ'}]}),
  wives:[
    W('أمِري علي دُو','الزوجة الأولى',{fullName:'أمِري علي دُو',fatherName:'علي',motherName:'-',tribe:'قٌرْعان',clan:'ضولو',birthDate:'1905-01-01',deathDate:'1985-01-01',birthPlace:'تشاد',occupation:'ربّة بيت ومربية أجيال',achievements:['ربّت أبناءها على حفظ القرآن والخلق الحسن','معروفة بالكرم وإكرام الضيف','كانت سندًا لزوجها في مسؤوليات العائلة'],hobbies:['تلاوة القرآن في البيت','إعداد الطعام في المناسبات العائلية']},[
      C('إيطار','ابن',{fullName:'إيطار محمد موسى',birthDate:'1925-01-01',deathDate:'1995-01-01',birthPlace:'تشاد',occupation:'إمام مسجد ومحفظ قرآن',achievements:['حافظ لكتاب الله','أدار حلقات تحفيظ لسنوات طويلة','شارك في توسعة مسجد الحي'],hobbies:['قراءة الكتب الشرعية','الجلوس مع طلابه خارج أوقات الدروس']}),
      C('مصطفى قوني','ابن',{fullName:'مصطفى قوني محمد',birthDate:'1928-01-01',deathDate:'2000-01-01',birthPlace:'تشاد',occupation:'تاجر وأمين للعائلة',achievements:['ساهم في تنمية دخل العائلة بالتجارة الحلال','دعم مشاريع تحفيظ القرآن','معروف بالأمانة في المعاملات'],hobbies:['متابعة السوق','المشاركة في الأعمال الخيرية']}),
      C('كُبُرى','بنت',{fullName:'كُبُرى محمد موسى',birthDate:'1931-01-01',deathDate:'1998-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['خدمت والديها وبرّتهما في كبرهما','عُرفت بالستر والعبادة'],hobbies:['تلاوة القرآن في البيت','الجلوس مع أخواتها وخالاتها'],remark:'ليس لها أبناء'}),
      C('بِنْتِي','بنت',{fullName:'بِنْتِي محمد موسى',birthDate:'1934-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['حافظت على صلة الرحم بين أخواتها','عرفت بحسن الخلق ولين الجانب'],hobbies:['خدمة والدَيها','حضور المجالس النسائية']}),
      C('ميمونة','بنت',{fullName:'ميمونة محمد موسى',birthDate:'1937-01-01',birthPlace:'تشاد',occupation:'ربّة بيت ومعلمة قرآن للصغار',achievements:['علمت أطفال الحي قصار السور','شجعت البنات على الحجاب والعفاف'],hobbies:['تحفيظ القرآن للبنات','المشاركة في المناسبات العائلية']}),
      C('ديرو','ابن',{fullName:'ديرو محمد موسى',birthDate:'1940-01-01',birthPlace:'تشاد',occupation:'مزارع',achievements:['طوّر مزارع العائلة','خصص جزءًا من المحصول للفقراء'],hobbies:['العمل في المزرعة','رعاية الماشية']}),
      C('شُو','بنت',{fullName:'شُو محمد موسى',birthDate:'1943-01-01',deathDate:'2015-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['كانت عونًا لأخواتها في خدمة الوالدين','عرفت بالحياء والوقار'],hobbies:['الجلوس مع قريباتها','المشاركة في أعمال الخير النسائية'],remark:'ليس لها أبناء'})
    ]),
    W('زينفة مري','الزوجة الثانية',{fullName:'زينفة مري',fatherName:'حسن',motherName:'-',tribe:'قٌرْعان',clan:'كُدِرى',birthDate:'1910-01-01',deathDate:'1990-01-01',birthPlace:'تشاد',occupation:'ربّة بيت وحافظة لأنساب العائلة',achievements:['حفظت كثيرًا من أخبار الجيل السابق','معروفة بالحكمة والصبر','حريصة على جمع الأحفاد في المناسبات'],hobbies:['سرد القصص للأحفاد','الجلوس في مجالس النساء للتذكير بالله']},[
      C('مَلْ لَمِين','ابن',{fullName:'مَلْ لَمِين محمد موسى',birthDate:'1935-01-01',deathDate:'2010-01-01',birthPlace:'تشاد',occupation:'إمام وخادم للمسجد',achievements:['أمّ الناس في الصلوات سنوات طويلة','شارك في ترميم المسجد','علّم الشباب أذكار الصباح والمساء'],hobbies:['تلاوة القرآن','زيارة المرضى وكبار السن']}),
      C('مَلْ حسن','ابن',{fullName:'مَلْ حسن محمد موسى',birthDate:'1938-01-01',birthPlace:'تشاد',occupation:'تاجر ووجيه في العائلة',achievements:['هو أبو ما لا قا','دعم عددًا من طلاب العلم','شارك في إصلاح ذات البين في العائلة'],hobbies:['السفر للتجارة','مجالس الصلح بين الناس'],remark:'هو أبو ما لا قا'}),
      C('تِجَّني','ابن',{fullName:'تِجَّني محمد موسى',birthDate:'1941-01-01',birthPlace:'تشاد',occupation:'مزارع وتاجر صغير',achievements:['جمع بين الزراعة والتجارة البسيطة','ساهم في نفقة بعض الأقارب المحتاجين'],hobbies:['العمل في الأرض','مجالس العائلة']}),
      C('حامد','ابن',{fullName:'حامد محمد موسى',birthDate:'1944-01-01',birthPlace:'تشاد',occupation:'موظف حكومي',achievements:['خدم في وظيفته بنزاهة','كان قدوة في الصلاة في المسجد'],hobbies:['قراءة القرآن بعد الفجر','المشاركة في اللقاءات العائلية']}),
      C('عيسى','ابن',{fullName:'عيسى محمد موسى',birthDate:'1947-01-01',birthPlace:'تشاد',occupation:'مدرّس ابتدائي',achievements:['علّم أجيالًا من أبناء القرية','حرص على غرس القيم الإسلامية في الطلاب'],hobbies:['القراءة التربوية','الأنشطة المدرسية']}),
      C('زهرة إلِّي','بنت',{fullName:'زهرة إلِّي محمد موسى',birthDate:'1950-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['تهتم بخدمة والديها وأخوتها','تحرص على جمع قريباتها في المناسبات'],hobbies:['الطبخ في المناسبات','حضور المجالس النسائية']}),
      C('فاطمة','بنت',{fullName:'فاطمة محمد موسى',birthDate:'1953-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['معروفة بحسن تربية أبنائها','حريصة على حفظ الأذكار والأوراد'],hobbies:['تلاوة القرآن','الاهتمام بالأبناء والبيت']}),
      C('أمِنَة','بنت',{fullName:'أمِنَة محمد موسى',birthDate:'1956-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['هي أم مَلْ علي','حسن تربية أبنائها على الصلاة والحياء'],hobbies:['خدمة أهلها','حضور دروس العلم النسائية'],remark:'أمِنَة هي أم مَلْ علي'})
    ]),
    W('بِنْتِي آدم ميني','الزوجة الثالثة',{fullName:'بِنْتِي آدم ميني',fatherName:'آدم',motherName:'-',tribe:'قٌرْعان',clan:'مُوسَوْرَوْ',birthDate:'1915-01-01',deathDate:'1995-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['رعت أبناءها على الاستقامة','عرفت بالعفة والستر'],hobbies:['خدمة زوجها وأبنائها','إكرام الضيوف']},[
      C('عمر','ابن',{fullName:'عمر محمد موسى',birthDate:'1940-01-01',birthPlace:'تشاد',occupation:'تاجر',achievements:['أسهم في دعم عدد من طلاب العلم','ساعد أقاربه المحتاجين'],hobbies:['السفر للتجارة','مجالس العائلة']}),
      C('آدم مِلي','ابن',{fullName:'آدم مِلي محمد موسى',birthDate:'1943-01-01',birthPlace:'تشاد',occupation:'مزارع',achievements:['طور مزرعته لخدمة العائلة','يحافظ على صلاة الجماعة في المسجد'],hobbies:['العمل في المزرعة','تربية الماشية']}),
      C('زهرة','بنت',{fullName:'زهرة محمد موسى',birthDate:'1946-01-01',deathDate:'2010-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['عرفت بخدمة والديها وأخوتها','محبوبة بين قريباتها'],hobbies:['حضور المجالس النسائية','خدمة أهل البيت'],remark:'ليس لها أبناء'}),
      C('فاطمة','بنت',{fullName:'فاطمة محمد موسى',birthDate:'1949-01-01',deathDate:'2012-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',cognomen:'مشهورة ب لَبو',achievements:['حافظت على جو إيماني في بيتها','مشهود لها بحسن الخلق'],hobbies:['الاهتمام بالأبناء','المشاركة في المناسبات العائلية'],remark:'ليس لها أبناء'}),
      C('رُوا','بنت',{fullName:'رُوا محمد موسى',birthDate:'1952-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['مساهمة في صلة الرحم بين الفروع','حريصة على حضور الأعياد العائلية'],hobbies:['التجهيز للمناسبات','الجلوس مع قريباتها']}),
      C('بَتُل','بنت',{fullName:'بَتُل محمد موسى',birthDate:'1955-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['عرفت بالحياء والالتزام بالحجاب','تعاونت مع أخواتها في خدمة الوالدين'],hobbies:['تلاوة القرآن','المشاركة في المجالس العائلية']}),
      C('حمزةَ','ابن',{fullName:'حمزةَ محمد موسى',birthDate:'1958-01-01',birthPlace:'تشاد',occupation:'موظف ومشارك في أعمال الخير',achievements:['ساهم في مشاريع حفر الآبار','شارك في ترتيبات لقاءات العائلة'],hobbies:['زيارة الأقارب','العمل التطوعي']})
    ]),
    W('كُرِي بُكِنِّ كُبُرِي','الزوجة الرابعة',{fullName:'كُرِي بُكِنِّ كُبُرِي',fatherName:'بُكِنِّ',motherName:'لُكِي رُرُكْ عبد الكريم',tribe:'قٌرْعان',clan:'نوري رَوْ',birthDate:'1920-01-01',deathDate:'2000-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['عُرفت بالسكينة والوقار داخل البيت','حافظت على جو إيماني في بيتها'],hobbies:['خدمة أهل البيت','الجلوس مع الأحفاد'],remark:'سُمي أبي على أخيها سليمان الملقب ب كُري'},[
      C('بشير','ابن',{fullName:'بشير محمد موسى',birthDate:'1950-01-01',birthPlace:'تشاد',occupation:'موظف ومشارك في أعمال الخير',achievements:['شارك في مشروعات حفر الآبار','يساعد في ترتيب اللقاءات العائلية'],hobbies:['زيارة الأقارب','العمل التطوعي']}),
      C('مريم','بنت',{fullName:'مريم محمد موسى',birthDate:'1953-01-01',birthPlace:'تشاد',occupation:'ربّة بيت',achievements:['معروفة بحسن تربية أبنائها','تحرص على صلة الرحم مع أقاربها'],hobbies:['الاهتمام بالبيت والأبناء','حضور المجالس النسائية'],remark:'هي جدتي من جهة الأب'})
    ])
  ]
}
  
};

// تطبيق الترحيل والتهيئة للعائلات الأساسية
Object.keys(familiesData).forEach(k => {
  const f = familiesData[k]; if (!f) return;
  migrate(f, 0, SCHEMA_VERSION);
  f.__core = true;
  if (f.hidden == null) f.hidden = false;
  ensureFamilyBios(f);
  ensureIds(f);
});

// =======================================
// 6) Walkers ومسارات ثابتة داخل العائلة
// =======================================
function _roleGroupLocal(p) {
  const r = String(p?.role || '').trim();
  if (r === 'ابن' || r === 'بنت') return r;
  if (r === 'الأب') return 'الأب';
  if (r.startsWith('الجد')) return 'جد';
  if (r === 'زوجة' || r.startsWith('الزوجة')) return 'زوجة';
  return r || '';
}
function _personFP(p) {
  const name = String(p?.name || '').trim();
  const rg = _roleGroupLocal(p);
  const b = String(p?.bio?.birthDate || p?.bio?.birthYear || '').trim();
  return [name, rg, b].join('|');
}


// استرجاع مسار حسب _id
export function findPathByIdInFamily(fam, pid) {
  let out = null;
  _walkPersonsWithPath(fam, (p, path) => { if (p && p._id === pid) out = path; });
  return out; // مثال: "wives[0].children[2]"
}

// الوصول لكائن عبر مسار نصّي
function _getByPath(fam, path) {
  if (!fam || !path) return null;
  const segs = path.split('.').filter(Boolean);
  let cur = fam;
  for (const s of segs) {
    const m = s.match(/^(\w+)\[(\d+)\]$/);
    if (m) {
      const arr = cur[m[1]];
      const idx = parseInt(m[2], 10);
      if (!Array.isArray(arr) || !arr[idx]) return null;
      cur = arr[idx];
    } else {
      cur = cur?.[s];
      if (!cur) return null;
    }
  }
  return cur || null;
}

function _walk(fam, cb, { withPath = false } = {}){
  if (!fam || typeof cb !== 'function') return;

  const visit = (p, path) => {
    if (!p) return;
    cb(p, path);
    (p.wives || []).forEach((w, i) => visit(w, withPath ? `${path}.wives[${i}]` : null));
    (p.children || []).forEach((c, i) => visit(c, withPath ? `${path}.children[${i}]` : null));
  };

  (Array.isArray(fam.ancestors) ? fam.ancestors : []).forEach((a,i)=> visit(a, withPath?`ancestors[${i}]`:null));
  if (fam.father) visit(fam.father, withPath?'father':null);
  if (fam.rootPerson) visit(fam.rootPerson, withPath?'rootPerson':null);
  (fam.wives || []).forEach((w,i)=> visit(w, withPath?`wives[${i}]`:null));

  // توافق قديم
  if (fam.rootPerson?.wives?.length) fam.rootPerson.wives.forEach(w => visit(w, withPath?'rootPerson.wives[]':null));
}

function _walkPersonsWithPath(fam, cb){ _walk(fam, cb, { withPath:true }); }
function _walkPersons(fam, cb){ _walk(fam, cb, { withPath:false }); }


// =======================================
// 7) حفظ/تحميل من IndexedDB (العائلات + ميتاداتا)
// =======================================

async function savePersistedFamilies() {
  try {
    const out = {};

    // احفظ العائلات المضافة فقط
    Object.entries(familiesData || {}).forEach(([k, f]) => {
      if (f && f.__custom) {
        const copy = { ...f, __v: SCHEMA_VERSION };
        if (copy.rootPerson) delete copy.rootPerson.wives; // منع المرآة
        out[k] = copy;
      }
    });

    // ميتاداتا للعائلات الأساسية
    const coreHidden = {};
    const corePhotos = {};

    Object.entries(familiesData || {}).forEach(([k, f]) => {
      if (!f || !f.__core) return;
      if (f.hidden === true) coreHidden[k] = 1;

      // حفظ روابط الصور بمفاتيح المسارات لتلافي التطابق الزائف بالأسماء
      const patch = {};
      _walkPersonsWithPath(f, (p, path) => {
        const u = String(p?.bio?.photoUrl || p?.photoUrl || '').trim();
        if (!u) return;
        patch[path] = {
          photoUrl: u,
          photoVer: p.photoVer || Date.now(),
          hasOrig: p?.bio?.photoHasOrig ? 1 : 0,
          rot: p?.bio?.photoRotated ? 1 : 0,
          crp: p?.bio?.photoCropped ? 1 : 0
        };
      });
      if (Object.keys(patch).length) corePhotos[k] = patch;
    });

    out.__meta = { coreHidden, corePhotos };
    await DB.put(PERSIST_FAMILIES_KEY, out);
  } catch (e) {
    console.warn('savePersistedFamilies(idb)', e);
  }
}

async function loadPersistedFamilies() {
  try {
    const obj = await DB.get(PERSIST_FAMILIES_KEY);
    if (!obj) return;

    Object.keys(obj).forEach(k => {
      if (k === '__meta') return;
      const f = obj[k]; if (!f) return;
      f.__custom = true;

      const ver = Number.isFinite(+f.__v) ? +f.__v : 0;
      migrate(f, ver, SCHEMA_VERSION);
      if (f.hidden == null) f.hidden = false;

      if (f.fullGrandsonName && !f.fullRootPersonName) { f.fullRootPersonName = f.fullGrandsonName; delete f.fullGrandsonName; }

      // اشتقاق familyName و fullRootPersonName إن لزم
      f.familyName = f.familyName || (f.title ? String(f.title).replace(/^.*?:\s*/u, '').trim() : (f.rootPerson?.name?.split(/\s+/u)[0] || ''));
      const ancNames = Array.isArray(f.ancestors) ? [...f.ancestors]
            .map(a => ({ ...a, generation: Number.isFinite(+a.generation) ? +a.generation : 1 }))
            .sort((a, b) => (a.generation ?? 1) - (b.generation ?? 1))
            .map(a => a.name)
            .filter(Boolean)
        : [];
      f.fullRootPersonName = f.fullRootPersonName || (
        f.rootPerson ? [f.rootPerson?.name, f.father?.name, ...ancNames].filter(Boolean).join(' ') : ''
      );

      // توحيد wives
  if (!Array.isArray(f.wives)) f.wives = [];
f.wives = f.wives.map(_normalizeWifeForLoad);

if (f.rootPerson){
  if (!Array.isArray(f.rootPerson.wives) || !f.rootPerson.wives.length){
    f.rootPerson.wives = f.wives.map(w => ({ ...w }));
  } else {
    f.rootPerson.wives = f.rootPerson.wives.map(w => ({
      name: w?.name || '',
      role: w?.role || 'زوجة',
      bio: w?.bio || {},
      children: (w?.children || []).map(_normalizeChildForLoad)
    }));
  }
}


      ensureFamilyBios(f);
      ensureIds(f);
      familiesData[k] = f;
    });

    // تطبيق إخفاء العائلات الأساسية
    const coreHidden = (obj.__meta && obj.__meta.coreHidden) || {};
    Object.keys(coreHidden).forEach(k => {
      if (familiesData[k] && familiesData[k].__core) familiesData[k].hidden = true;
    });

    // ترقيع الصور للعائلات الأساسية (مفاتيح مسار + دعم رجعي للبصمة القديمة)
    const corePhotos = (obj.__meta && obj.__meta.corePhotos) || {};
    Object.entries(corePhotos).forEach(([famKey, patchMap]) => {
      const fam = familiesData[famKey];
      if (!fam || !fam.__core || !patchMap) return;

      Object.entries(patchMap).forEach(([key, hit]) => {
        if (!hit) return;
        const isLegacyKey = key.includes('|'); // صيغة _personFP القديمة
        let targetPerson = null;

        if (!isLegacyKey) targetPerson = _getByPath(fam, key); // مسار ثابت
        if (!targetPerson && isLegacyKey) {
          _walkPersonsWithPath(fam, (cand) => { if (_personFP && _personFP(cand) === key) targetPerson = cand; });
        }
        if (!targetPerson) return;

        if (!targetPerson.bio) targetPerson.bio = {};
        targetPerson.bio.photoUrl = hit.photoUrl;
        targetPerson.photoUrl = hit.photoUrl;
        targetPerson.photoVer = hit.photoVer || Date.now();
        if (hit.hasOrig) targetPerson.bio.photoHasOrig = 1; else delete targetPerson.bio.photoHasOrig;
        if (hit.rot) targetPerson.bio.photoRotated = 1; else delete targetPerson.bio.photoRotated;
        if (hit.crp) targetPerson.bio.photoCropped = 1; else delete targetPerson.bio.photoCropped;
      });
    });
  } catch (e) {
    console.warn('loadPersistedFamilies(idb)', e);
  }
}

// =======================================
// 8) أدوات مساعدة فرعية متفرقة
// =======================================

// تطبيع ابن عند التحميل
function _normalizeChildForLoad(c) {
  if (!c) return null;
  return (typeof c === 'string') ? { name: c, role: 'ابن', bio: {} }
    : { name: c.name || '', role: c.role || 'ابن', bio: c.bio || {}, _id: c._id };
}
function _normalizeWifeForLoad(w, i){
  const idxLabel = ['الأولى','الثانية','الثالثة','الرابعة','الخامسة'][i] || `رقم ${i+1}`;
  const roleLabel = w?.role || `الزوجة ${idxLabel}`;
  return {
    name: w?.name || '',
    role: roleLabel,
    bio: w?.bio || {},
    children: Array.isArray(w?.children) ? w.children.map(_normalizeChildForLoad).filter(Boolean) : []
  };
}

// إزالة كل روابط الصور (غير مستخدم هنا لكن مفيد للتصدير بدون صور)
function stripPhotosDeep(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.bio && typeof obj.bio === 'object') obj.bio.photoUrl = '';
  Object.values(obj).forEach(v => {
    if (Array.isArray(v)) v.forEach(stripPhotosDeep);
    else if (v && typeof v === 'object') stripPhotosDeep(v);
  });
}

// إعدادات توريث القبيلة/العشيرة لكل عائلة (تُخزَّن في __meta.lineage)
export function getLineageConfig(fam) {
  // قيم افتراضية للقاعدة
  const defaults = {
    // من أين تُورَّث "القبيلة"
    // father  = من الأب (الافتراضي)
    // mother  = من الأم
    // firstKnown = من أول جدّ مذكور في ancestors
    tribeRule: 'father',

    // من أين تُورَّث "العشيرة"
    // father  = من الأب (الافتراضي)
    // mother  = من الأم
    // firstKnown = من أول جدّ مذكور
    clanRule: 'father',

    // كيف نتصرّف عند غياب بيانات الأب
    // mother = نرجع لعشيرة الأم
    // none   = لا نملأ تلقائيًا
    missingFatherFallback: 'mother'
  };

  if (!fam) return { ...defaults };

  if (!fam.__meta) fam.__meta = {};
  if (!fam.__meta.lineage) {
    // أول مرة: أنشئ الإعدادات بالافتراضي
    fam.__meta.lineage = { ...defaults };
  } else {
    // دمج أي إعدادات قديمة مع الافتراضي (لضمان وجود جميع المفاتيح)
    fam.__meta.lineage = { ...defaults, ...fam.__meta.lineage };
  }

  return fam.__meta.lineage;
}

// إيجاد تكرارات داخل العائلة بالاسم المطبع
export function findDuplicatesInFamily(f) {
  if (!f) return [];
  const all = [];
  const push = (p) => { if (p) { all.push(p); (p?.children || []).forEach(push); (p?.wives || []).forEach(push); } };

  (Array.isArray(f.ancestors) ? f.ancestors : []).forEach(push); // الأجداد
  [f.father, f.rootPerson, ...(f.wives || [])].forEach(push);     // باقي القمم

  const map = new Map();
  all.forEach(p => {
    const k = _normKey(p);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  });

  const dups = [];
  for (const [, arr] of map) {
    if (arr.length > 1) dups.push(arr.map(p => ({ _id: p._id, name: p.name || '', role: p.role || '' })));
  }
  return dups;
}

// =======================================
// 9) اشتقاق بيانات الأبناء + ربط زوجات rootPerson
// =======================================

// ضبط حقول ابن واحد من سياق العائلة/الزوجة
function setChildDefaults(child, fam, wife) {
  if (!child || !child.bio) return;

  // اسم الأب المختصر/الكامل
  const fatherShort = String(
    fam.rootPerson?.bio?.fullName ||
    fam.fullRootPersonName ||
    fam.rootPerson?.name ||
    fam.father?.name ||
    ''
  ).trim().split(/\s+/u)[0] || '';

  const fatherFull =
    fam.fullRootPersonName ||
    fam.rootPerson?.bio?.fullName ||
    fam.rootPerson?.name ||
    fam.father?.name ||
    '';

  if (!child.bio.fatherName || child.bio.fatherName === '-') {
    child.bio.fatherName = fatherShort;
  }
  if (!child.bio.motherName || child.bio.motherName === '-') {
    child.bio.motherName = (wife?.name && wife.name !== '-') ? wife.name : '-';
  }

  // جهة الأم: توريث معلومات الأم من الزوجة
  if (wife && wife.bio) {
    child.bio.maternalGrandfather = wife.bio.fatherName || wife.bio.fullName || child.bio.maternalGrandfather || '';
    child.bio.maternalGrandmother = wife.bio.motherName || child.bio.maternalGrandmother || '';
    child.bio.maternalGrandmotherClan = wife.bio.motherClan || child.bio.maternalGrandmotherClan || '';
    if (wife.bio.tribe) child.bio.motherTribe = wife.bio.tribe;
    if (wife.bio.clan)  child.bio.motherClan  = wife.bio.clan;
  }


  // جهة الأب: الجد الأبوي = والد الأب (أولوية للأب ثم fallback للأجداد)
  const fatherNameFromRoot = String(
    fam.rootPerson?.bio?.fatherName || // والد صاحب الشجرة من الـ bio
    fam.father?.name ||                // أو كائن الأب إن وُجد
    ''
  ).trim();

  const paternalFromRoot   = fam.rootPerson?.bio || {};
  const paternalFromFather = fam.father?.bio || {};
  const paternalGrandmother =
    paternalFromRoot?.motherName || paternalFromFather?.motherName || '';
  const paternalGrandmotherClan =
    paternalFromRoot?.motherClan || paternalFromFather?.motherClan || '';

  if (paternalGrandmother)      child.bio.paternalGrandmother      = paternalGrandmother;
  if (paternalGrandmotherClan)  child.bio.paternalGrandmotherClan  = paternalGrandmotherClan;

  // املأ الجد الأبوي أولًا من والد صاحب الشجرة
  let paternalGF = fatherNameFromRoot;

  // ملاذ أخير: أقرب اسم في ancestors إذا لم يتوفر والد الأب
  if (!paternalGF && Array.isArray(fam.ancestors) && fam.ancestors.length) {
    const sorted = fam.ancestors
      .map(a => ({ ...a, generation: Number.isFinite(+a.generation) ? +a.generation : 1 }))
      .sort((a, b) => (a.generation ?? 1) - (b.generation ?? 1));
    paternalGF = sorted[0]?.name || '';
  }

  if (paternalGF && !child.bio.paternalGrandfather) {
    child.bio.paternalGrandfather = paternalGF;
  }

  // قبيلة/عشيرة الطفل من جهة الأب افتراضيًا
  if (!child.bio.tribe || child.bio.tribe === '-') {
    child.bio.tribe = fam.rootPerson?.bio?.tribe || '';
  }
  if (!child.bio.clan || child.bio.clan === '-') {
    child.bio.clan = fam.rootPerson?.bio?.clan || '';
  }

  // الاسم الكامل للطفل: يُعاد بناؤه دائمًا من اسم الطفل + السلسلة الكاملة للأب
  const autoFullName = [child.name, fatherFull].filter(Boolean).join(' ').trim();
  child.bio.fullName = autoFullName;
}



// ربط wives داخل rootPerson كمرآة مشتقّة من fam.wives
function linkRootPersonWives() {
  Object.values(familiesData || {}).forEach(fam => {
    if (!fam) return;
    if (!Array.isArray(fam.wives)) fam.wives = [];

    fam.wives = fam.wives.map(w => {
      const ww = Object.assign({}, w);
      ww.children = (ww.children || []).map(c => {
        const base = structuredClone ? structuredClone(DEFAULT_BIO) : JSON.parse(JSON.stringify(DEFAULT_BIO));

        const child = (typeof c === 'string')  ? { name: c, role: 'ابن', bio: Object.assign(base, {}) }
          : { name: c.name || '', role: c.role || 'ابن', bio: Object.assign(base, c.bio || {}), _id: c._id };

        // مزامنة تاريخ/سنة الميلاد والوفاة للابن
        normalizeLifeDatesOnBio(child.bio);

        setChildDefaults(child, fam, ww);
        return child;

      });
      return ww;
    });

    if (fam.rootPerson) fam.rootPerson.wives = fam.wives.map(w => ({ ...w }));
  });
}

// تنفيذ ربط مبدئي
linkRootPersonWives();

// =======================================
// 10) واجهات الحفظ/التحميل/التعديل العامّة
// =======================================
function _sortedAncestors(fam){
  const ancArr = Array.isArray(fam.ancestors) ? fam.ancestors : [];
  return ancArr
    .map(a => ({ a, gen: Number.isFinite(+a.generation) ? +a.generation : 1 }))
    .sort((x,y)=>(x.gen??1)-(y.gen??1));
}
function _ancNames(sorted){
  return sorted.map(x=>String(x.a?.name||'').trim()).filter(Boolean);
}

// التزام عائلة واحدة بعد تعديلها في الذاكرة
export function commitFamily(key) {
  const fam = families[key];
  if (!fam) return;

  // 1) ترحيل النسخة إلى آخر Schema
  migrate(fam, Number.isFinite(+fam.__v) ? +fam.__v : 0, SCHEMA_VERSION);

  // 2) تهيئة الـ bio والزوجات والأجداد وفق القيم الافتراضية
  ensureFamilyBios(fam);

 const ancSorted = _sortedAncestors(fam);
const ancNames  = _ancNames(ancSorted);

if (!fam.familyName){
  fam.familyName = fam.title ? String(fam.title).replace(/^.*?:\s*/u,'').trim()
    : (fam.rootPerson?.name?.split(/\s+/u)[0] || '');
}

let rootFull = '';
if (fam.rootPerson){
  const rootName   = String(fam.rootPerson.name || '').trim();
  const fatherName = String(fam.father?.name || '').trim();
  rootFull = [rootName, fatherName, ...ancNames].filter(Boolean).join(' ').trim();

  fam.rootPerson.bio = fam.rootPerson.bio || {};
  if (rootFull) fam.rootPerson.bio.fullName = rootFull;
  if (rootFull) fam.fullRootPersonName = rootFull;
}

if (fam.father){
  const fName = String(fam.father.name || '').trim();
  const fatherFull = [fName, ...ancNames].filter(Boolean).join(' ').trim();
  fam.father.bio = fam.father.bio || {};
  if (fatherFull) fam.father.bio.fullName = fatherFull;
}

ancSorted.forEach(({a}, idx) => {
  if (!a) return;
  const self = String(a.name||'').trim();
  if (!self) return;
  const tail = ancSorted.slice(idx+1)
    .map(x=>String(x.a?.name||'').trim())
    .filter(Boolean);

  const chain = [self, ...tail].join(' ').trim();
  a.bio = a.bio || {};
  if (chain) a.bio.fullName = chain;
});


  // 9) ضمان المعرفات والتطبيع المحفوظ للأسماء
  ensureIds(fam);

  // 10) ربط زوجات rootPerson (وتحديث أبناء الزوجات مع setChildDefaults)
  linkRootPersonWives();

  // 11) حفظ في IndexedDB
  savePersistedFamilies();
}



// استيراد عدة عائلات دفعة واحدة
export function importFamilies(obj = {}) {
  if (!obj || typeof obj !== 'object') return;
  const all = getFamilies();
  Object.keys(obj).forEach(k => {
    const f = obj[k]; if (!f) return;
    const fromVer = Number.isFinite(+f.__v) ? +f.__v : 0;
    migrate(f, fromVer, SCHEMA_VERSION);
    ensureFamilyBios(f);
    ensureIds(f);
    all[k] = f;
  });
  linkRootPersonWives();
  savePersistedFamilies();
}

// تصدير نسخة عميقة آمنة
export function exportFamilies() {
  return JSON.parse(JSON.stringify(getFamilies()));
}

// مولّد مفاتيح للعائلات الجديدة
function generateFamilyKey() {
  const keys = Object.keys(familiesData || {}); let max = 0;
  keys.forEach(k => { const m = k.match(/^family(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `family${max + 1}`;
}

// حفظ عائلة واحدة (استبدال + ترحيل + ربط)
export function saveFamily(key, familyObj) {
  const wasCore = !!(families[key] && families[key].__core);
  familyObj.__custom = true;
  if (wasCore) familyObj.__core = true;

  migrate(familyObj, Number.isFinite(+familyObj.__v) ? +familyObj.__v : 0, SCHEMA_VERSION);

  if (familyObj?.rootPerson?.wives && familyObj.rootPerson.wives.length) {
    console.warn('[families.saveFamily] تم تمرير rootPerson.wives وسيتم تجاهلها لصالح families[key].wives');
  }
  if (familyObj?.rootPerson) delete familyObj.rootPerson.wives;

  families[key] = familyObj;

  ensureFamilyBios(familyObj);
  ensureIds(familyObj);
  linkRootPersonWives();
  savePersistedFamilies();
}

// حذف عائلة
export async function deleteFamily(key) {
  if (!key || !families[key]) return false;
  delete families[key];
  await savePersistedFamilies();

  // تصحيح المفتاح المحدّد
  const sel = localStorage.getItem('selectedFamily');
  if (sel === key) {
    const next = Object.keys(families)[0] || '';
    if (next) localStorage.setItem('selectedFamily', next);
    else localStorage.removeItem('selectedFamily');
  }
  return true;
}

// تحميل من IndexedDB ثم ربط/تهيئة
export function loadPersistedFamiliesExport() {
  loadPersistedFamilies();
  if (typeof ensureFamilyBios === 'function') {
    Object.keys(families || {}).forEach(k => ensureFamilyBios(families[k]));
  }
  linkRootPersonWives();
}

// =======================================
// 11) كشف/تجميع عامّ للصادرات
// =======================================
export { DEFAULT_BIO, LABELS };

export const families = familiesData;
export function getFamilies() { return families; }
export function getFamily(key) { return families[key]; }
export function savePersistedFamiliesExport() { return savePersistedFamilies(); }

export {
  loadPersistedFamilies,
  savePersistedFamilies,
  generateFamilyKey,
  setChildDefaults,
  ensureBio,
  ensureFamilyBios,
  linkRootPersonWives,
  
};


// مفتاح العائلة المختارة في الواجهة
export function getSelectedKey() {
  return localStorage.getItem('selectedFamily') || 'family1';
}
export function setSelectedKey(k) {
  if (k == null) return;
  localStorage.setItem('selectedFamily', String(k));
}