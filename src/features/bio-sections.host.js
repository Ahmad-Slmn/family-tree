// src/features/bio-sections.host.js
// Host بين UI و Model: يطبّع بيانات الأقسام ثم يحفظها داخل العائلة النشطة (commit)

export function makeBioSectionHost({ Model, findPersonByIdInFamily } = {}) {
  if (!Model) throw new Error('makeBioSectionHost: Model is required');
  if (typeof findPersonByIdInFamily !== 'function') {
    throw new Error('makeBioSectionHost: findPersonByIdInFamily is required');
  }

  /* أدوات تطبيع صغيرة لتقليل التكرار بدون تغيير السلوك */
  const nowIso = () => new Date().toISOString();
  const str = (v) => String(v ?? '').trim();

  const asArray = (v) => (Array.isArray(v) ? v : []);
  const cloneArray = (v) => asArray(v).slice();

  const toStrList = (v) => asArray(v).map(str).filter(Boolean);
  const toIdList = (v) => asArray(v).map(String).filter(Boolean);

  // توليد id: نفس منطقك (UUID إن توفر وإلا fallback)
  const makeId = (prefix, id) =>
    id || (crypto?.randomUUID?.() || `${prefix}_${Math.random().toString(36).slice(2)}`);

  // ضمان timestamps مع الحفاظ على الموجود إن كان موجودًا
  const withTimestamps = (obj, src) => {
    const now = nowIso();
    const createdAt = src?.createdAt || now;
    const updatedAt = src?.updatedAt || createdAt;
    return { ...obj, createdAt, updatedAt };
  };

  const getActiveFamily = () => {
    const famKey = Model.getSelectedKey();
    const fam = Model.getFamilies()?.[famKey];
    return { famKey, fam };
  };

  const getPerson = (fam, personId) =>
    (!fam || personId == null) ? null : findPersonByIdInFamily(fam, personId);

  const commit = (famKey) => {
    if (famKey) Model.commitFamily(famKey);
  };

  // غلاف موحد: يقلل تكرار (getActiveFamily/getPerson/commit)
  const updatePersonSection = (personId, updater) => {
    const { famKey, fam } = getActiveFamily();
    if (!fam || !personId) return;

    const person = getPerson(fam, personId);
    if (!person) return;

    updater(person, famKey);
    commit(famKey);
  };

  /* إزالة sourceId من جميع الأقسام (يُستخدم عند حذف مصدر) */
  function removeSourceIdEverywhere(person, sourceId) {
    const sid = String(sourceId || '').trim();
    if (!sid || !person) return false;

    let changed = false;

    const stripFromList = (arr, key) => {
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        if (!it || !Array.isArray(it[key])) continue;

        const before = it[key].length;
        it[key] = it[key].map(String).filter((x) => x && x !== sid);
        if (it[key].length !== before) changed = true;
      }
    };

    stripFromList(person.education, 'sourceIds');
    stripFromList(person.career, 'sourceIds');
    stripFromList(person.events, 'sourceIds');
    stripFromList(person.stories, 'sourceIds');

    return changed;
  }

  /* -----------------------------------------------------------------------
     1) Stories: تطبيع كامل + sourceIds/tags + timestamps
  ----------------------------------------------------------------------- */
  function onUpdateStories(personId, stories) {
    updatePersonSection(personId, (person) => {
      const list = asArray(stories);

      person.stories = list.map((s) => withTimestamps({
        id: makeId('s', s?.id),
        title: str(s?.title),
        text: str(s?.text),

        files: cloneArray(s?.files),
        type: str(s?.type),
        eventDate: s?.eventDate || null,
        place: str(s?.place),
        tags: toStrList(s?.tags),

        mood: str(s?.mood),
        visibility: str(s?.visibility),
        narrator: str(s?.narrator),
        toTimeline: !!s?.toTimeline,

        note: str(s?.note),
        pinned: !!s?.pinned,
        sourceIds: toIdList(s?.sourceIds)
      }, s));
    });
  }

  /* -----------------------------------------------------------------------
     2) Sources: الحفاظ على بقية خصائص المصدر + ضمان حقول الهوية/الصلاحية + history
     - بعد التحديث: أي مصدر حذفناه، نشيل id تبعه من كل الأقسام الأخرى
  ----------------------------------------------------------------------- */
  function onUpdateSources(personId, sources) {
    updatePersonSection(personId, (person) => {
      const list = asArray(sources);

      const oldIds = new Set(asArray(person.sources).map((s) => String(s.id)));
      const newIds = new Set(list.map((s) => String(s?.id || '')).filter(Boolean));

      const normalizeHistory = (raw) => asArray(raw)
        .map((h) => ({ at: h?.at || null, by: str(h?.by), action: str(h?.action) }))
        .filter((x) => x.at && x.action);

      person.sources = list.map((src) => withTimestamps({
        ...src,
        id: makeId('src', src?.id),

        validUntil: src?.validUntil || null,
        expiryAlertDays: Number.isFinite(Number(src?.expiryAlertDays)) ? Number(src.expiryAlertDays)
          : 30,

        holderName: str(src?.holderName),
        nationalId: str(src?.nationalId),
        civilRegistryNo: str(src?.civilRegistryNo),

        history: normalizeHistory(src?.history)
      }, src));

      for (const id of oldIds) {
        if (!newIds.has(id)) removeSourceIdEverywhere(person, id);
      }
    });
  }

  /* -----------------------------------------------------------------------
     3) Education: تطبيع كامل + ongoing يحكم endDate + arrays + timestamps
  ----------------------------------------------------------------------- */
  function onUpdateEducation(personId, education) {
    updatePersonSection(personId, (person) => {
      const list = asArray(education);

      person.education = list.map((e) => {
        const ongoing = !!e?.ongoing;

        return withTimestamps({
          id: makeId('e', e?.id),

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
          highlights: toStrList(e?.highlights),

          startDate: e?.startDate || null,
          endDate: ongoing ? null : (e?.endDate || null),
          ongoing,

          place: str(e?.place),
          grade: str(e?.grade),
          description: str(e?.description),

          files: cloneArray(e?.files),
          tags: toStrList(e?.tags),

          pinned: !!e?.pinned,
          note: str(e?.note),
          sourceIds: toIdList(e?.sourceIds)
        }, e);
      });
    });
  }

  /* -----------------------------------------------------------------------
     4) Career: تطبيع كامل + arrays + timestamps
  ----------------------------------------------------------------------- */
  function onUpdateCareer(personId, career) {
    updatePersonSection(personId, (person) => {
      const list = asArray(career);

      person.career = list.map((c) => withTimestamps({
        id: makeId('car', c?.id),

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

        highlights: toStrList(c?.highlights),
        skills: toStrList(c?.skills),
        startPrecision: str(c?.startPrecision),

        sourceIds: toIdList(c?.sourceIds),
        tags: toStrList(c?.tags)
      }, c));
    });
  }

  /* -----------------------------------------------------------------------
     5) Events: نفس منطقك (نسخ كما هو) + فقط ضمان sourceIds
  ----------------------------------------------------------------------- */
  function onUpdateEvents(personWithEvents) {
    if (!personWithEvents || !personWithEvents._id) return;

    const { famKey, fam } = getActiveFamily();
    if (!fam) return;

    const person = getPerson(fam, personWithEvents._id);
    if (!person) return;

    person.events = asArray(personWithEvents.events).map((ev) => ({
      ...ev,
      sourceIds: toIdList(ev?.sourceIds)
    }));

    commit(famKey);
  }

  return {
    onUpdateStories,
    onUpdateSources,
    onUpdateEducation,
    onUpdateCareer,
    onUpdateEvents,

    // اسم متوافق مع handlers الحالية
    onEventsChange: onUpdateEvents
  };
}