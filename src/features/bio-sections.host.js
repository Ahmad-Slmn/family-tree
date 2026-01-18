// src/features/bio-sections.host.js
// وظيفة الملف:
// - يعمل كجسر (Host) بين أقسام السيرة في الواجهة وطبقة البيانات (Model)
// - يستقبل بيانات الأقسام من الـ UI (قصص، مصادر، تعليم، أحداث)
// - يطبّع البيانات (تنظيف النصوص، ضمان المعرّفات، تواريخ الإنشاء والتحديث)
// - يحدّث بيانات الشخص داخل العائلة النشطة
// - ينفّذ commit على العائلة لحفظ التغييرات
// - لا يحتوي أي منطق واجهة (UI) أو تعامل مع DOM

export function makeBioSectionHost({ Model, findPersonByIdInFamily } = {}) {
  if (!Model) throw new Error('makeBioSectionHost: Model is required');
  if (typeof findPersonByIdInFamily !== 'function') {
    throw new Error('makeBioSectionHost: findPersonByIdInFamily is required');
  }

  /* -----------------------------------------------------------------------
     أدوات مساعدة للتطبيع
  ----------------------------------------------------------------------- */
  const nowIso = () => new Date().toISOString();
  const str = (v) => String(v ?? '').trim();

  /* -----------------------------------------------------------------------
     أدوات مساعدة للوصول الآمن للعائلة والشخص
  ----------------------------------------------------------------------- */
  const getActiveFamily = () => {
    const famKey = Model.getSelectedKey();
    const fam = Model.getFamilies()?.[famKey];
    return { famKey, fam };
  };

  const getPerson = (fam, personId) => {
    if (!fam || personId == null) return null;
    return findPersonByIdInFamily(fam, personId);
  };

  const commit = (famKey) => {
    if (!famKey) return;
    Model.commitFamily(famKey);
  };

  /* -----------------------------------------------------------------------
     1) القصص (Stories)
     - تطبيع كامل للحقول + ضمان id + createdAt/updatedAt
  ----------------------------------------------------------------------- */
  function onUpdateStories(personId, stories) {
    const { famKey, fam } = getActiveFamily();
    if (!fam || !personId) return;

    const person = getPerson(fam, personId);
    if (!person) return;

    const list = Array.isArray(stories) ? stories : [];

    person.stories = list.map((s) => {
      const now = nowIso();
      const createdAt = s?.createdAt || now;
      const updatedAt = s?.updatedAt || createdAt;

return {
  id: s?.id || (crypto?.randomUUID?.() || ('s_' + Math.random().toString(36).slice(2))),
  title: str(s?.title),
  text: str(s?.text),
  files: Array.isArray(s?.files) ? s.files.slice() : [],
  type: str(s?.type),
  eventDate: s?.eventDate || null,
  place: str(s?.place),
  tags: Array.isArray(s?.tags) ? s.tags.map(t => str(t)).filter(Boolean) : [],

  mood: str(s?.mood),
  visibility: str(s?.visibility),
  narrator: str(s?.narrator),
  toTimeline: !!s?.toTimeline,

  note: str(s?.note),
  pinned: !!s?.pinned,
  sourceIds: Array.isArray(s?.sourceIds) ? s.sourceIds.map(String).filter(Boolean) : [],
  createdAt,
  updatedAt
};

    });

    commit(famKey);
  }

  /* -----------------------------------------------------------------------
     2) المصادر (Sources)
     - الحفاظ على باقي خصائص المصدر كما هي + ضمان id + createdAt/updatedAt
  ----------------------------------------------------------------------- */
function onUpdateSources(personId, sources) {
  const { famKey, fam } = getActiveFamily();
  if (!fam || !personId) return;

  const person = getPerson(fam, personId);
  if (!person) return;

  const list = Array.isArray(sources) ? sources : [];
const oldIds = new Set((Array.isArray(person.sources) ? person.sources : []).map(s => String(s.id)));
const newIds = new Set(list.map(s => String(s?.id || '')).filter(Boolean));

  const normalizeHistory = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map(h => ({
        at: h?.at || null,
        by: str(h?.by),
        action: str(h?.action)
      }))
      .filter(x => x.at && x.action);
  };

  person.sources = list.map((src) => {
    const now = nowIso();
    const createdAt = src?.createdAt || now;
    const updatedAt = src?.updatedAt || createdAt;

    return {
      ...src,
      id: src?.id || (crypto?.randomUUID?.() || ('src_' + Math.random().toString(36).slice(2))),

      // ضمان حقول جديدة
      validUntil: src?.validUntil || null,
      expiryAlertDays: Number.isFinite(Number(src?.expiryAlertDays)) ? Number(src.expiryAlertDays) : 30,

      holderName: str(src?.holderName),
      nationalId: str(src?.nationalId),
      civilRegistryNo: str(src?.civilRegistryNo),

      history: normalizeHistory(src?.history),

      createdAt,
      updatedAt
    };
  });
for (const id of oldIds) {
  if (!newIds.has(id)) {
    removeSourceIdEverywhere(person, id);
  }
}
  commit(famKey);
}

  /* -----------------------------------------------------------------------
     3) التعليم (Education)
     - تطبيع كامل للحقول + ضمان id + createdAt/updatedAt
  ----------------------------------------------------------------------- */
function onUpdateEducation(personId, education) {
  const { famKey, fam } = getActiveFamily();
  if (!fam || !personId) return;

  const person = getPerson(fam, personId);
  if (!person) return;

  const list = Array.isArray(education) ? education : [];

  person.education = list.map((e) => {
    const now = nowIso();
    const createdAt = e?.createdAt || now;
    const updatedAt = e?.updatedAt || createdAt;

    const highlights =
      Array.isArray(e?.highlights) ? e.highlights.map(str).filter(Boolean) : [];

    const ongoing = !!e?.ongoing;

    return {
      id: e?.id || (crypto?.randomUUID?.() || ('e_' + Math.random().toString(36).slice(2))),

      title: str(e?.title),
      institution: str(e?.institution),
      field: str(e?.field),

      degreeType: str(e?.degreeType),
      credentialId: str(e?.credentialId),
      issuer: str(e?.issuer),
      accreditation: str(e?.accreditation),
      verificationUrl: str(e?.verificationUrl),
      language: str(e?.language),
      mode: str(e?.mode),
      highlights,

      startDate: e?.startDate || null,
      endDate: ongoing ? null : (e?.endDate || null),
      ongoing,

      place: str(e?.place),
      grade: str(e?.grade),
      description: str(e?.description),

      files: Array.isArray(e?.files) ? e.files.slice() : [],

      tags: Array.isArray(e?.tags) ? e.tags.map(t => str(t)).filter(Boolean) : [],
      pinned: !!e?.pinned,
      note: str(e?.note),
  sourceIds: Array.isArray(e?.sourceIds) ? e.sourceIds.map(String).filter(Boolean) : [],

      createdAt,
      updatedAt
    };
  });

  commit(famKey);
}

    /* -----------------------------------------------------------------------
     4) المسار الوظيفي (Career)
     - تطبيع كامل للحقول + ضمان id + createdAt/updatedAt
  ----------------------------------------------------------------------- */
  function onUpdateCareer(personId, career) {
    const { famKey, fam } = getActiveFamily();
    if (!fam || !personId) return;

    const person = getPerson(fam, personId);
    if (!person) return;

    const list = Array.isArray(career) ? career : [];

person.career = list.map((c) => {
  const now = nowIso();
  const createdAt = c?.createdAt || now;
  const updatedAt = c?.updatedAt || createdAt;

  return {
    id: c?.id || (crypto?.randomUUID?.() || ('car_' + Math.random().toString(36).slice(2))),

    title: str(c?.title),
    org: str(c?.org),
    orgType: str(c?.orgType), 
    start: str(c?.start),
    end: (c?.end == null ? '' : str(c?.end)),
    place: str(c?.place),
    note: str(c?.note),

    sector: str(c?.sector),
    employmentType: str(c?.employmentType),
    rank: str(c?.rank),
    endReason: str(c?.endReason),
    highlights: Array.isArray(c?.highlights) ? c.highlights.map(str).filter(Boolean) : [],
    skills: Array.isArray(c?.skills) ? c.skills.map(str).filter(Boolean) : [],

    startPrecision: str(c?.startPrecision),

sourceIds: Array.isArray(c?.sourceIds) ? c.sourceIds.map(String).filter(Boolean) : [],
    tags: Array.isArray(c?.tags) ? c.tags.map(t => str(t)).filter(Boolean) : [],

    createdAt,
    updatedAt
  };
});


    commit(famKey);
  }


  /* -----------------------------------------------------------------------
     5) الأحداث (Events)
     - نسخ بسيط للأحداث كما هي (بدون تطبيع) لأن مصدرها غالبًا UI/Editor جاهز
  ----------------------------------------------------------------------- */
  function onUpdateEvents(personWithEvents) {
    if (!personWithEvents || !personWithEvents._id) return;

    const { famKey, fam } = getActiveFamily();
    if (!fam) return;

    const person = getPerson(fam, personWithEvents._id);
    if (!person) return;

    const list = Array.isArray(personWithEvents.events) ? personWithEvents.events : [];
person.events = list.map(ev => ({
  ...ev,
  sourceIds: Array.isArray(ev?.sourceIds) ? ev.sourceIds.map(String).filter(Boolean) : []
}));

    commit(famKey);
  }

  function removeSourceIdEverywhere(person, sourceId) {
  const sid = String(sourceId || '').trim();
  if (!sid || !person) return false;

  let changed = false;

  const stripFromList = (arr, key) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it || !Array.isArray(it[key])) continue;

      const beforeLen = it[key].length;
      it[key] = it[key].map(String).filter(x => x && x !== sid);

      if (it[key].length !== beforeLen) changed = true;
    }
  };

  stripFromList(person.education, 'sourceIds');
  stripFromList(person.career, 'sourceIds');
  stripFromList(person.events, 'sourceIds');
  stripFromList(person.stories, 'sourceIds');

  return changed;
}

  /* -----------------------------------------------------------------------
     واجهة موحدة ليتم دمجها داخل handlers في app.js
  ----------------------------------------------------------------------- */
  return {
    onUpdateStories,
    onUpdateSources,
    onUpdateEducation,
    onUpdateCareer,
    onUpdateEvents,

    // اسم متوافق مع الاسم الحالي الموجود في handlers
    onEventsChange: onUpdateEvents
  };
}
