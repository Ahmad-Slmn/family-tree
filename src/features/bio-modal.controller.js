// src/features/bio-modal.controller.js
// وظيفة الملف:
// - إدارة الوضع الحالي داخل مودال السيرة (Bio Modal) وربطه مع قائمة الأوضاع (mode select)
// - إعادة رسم أقسام السيرة عند تغيير الوضع أو عند الحاجة للتحديث (rerender)
// - التمرير التلقائي للقسم الحالي أو لقسم محدد داخل المودال (scroll)
// - التعامل مع اختصارات/روابط الانتقال بين الأقسام وتحديث الوضع عند الضرورة

export function createBioModalController({
  dom,
  byId,
  TreeUI,
  handlers,
  onShowDetails,
  onInlineRename,
  onEditFamily,
  onDeleteFamily,
  onModalSave
} = {}) {
  if (!TreeUI) throw new Error('createBioModalController: TreeUI is required');

  /* -----------------------------------------------------------------------
     1) خريطة الأوضاع (Modes) ↔ الأقسام (Sections)
     - MODE_MAIN_SECTION: لكل وضع ما هو القسم الرئيسي الذي يجب التمرير إليه
     - SECTION_TO_MODE: عند الضغط على اختصار لقسم معيّن، إلى أي وضع يجب التحويل
  ----------------------------------------------------------------------- */
  const MODE_MAIN_SECTION = {
    summary: 'basic',
    family: 'family',
    grands: 'grands',
    children: 'children',
    wives: 'wives',
    stories: 'stories',
    timeline: 'timeline',
    sources: 'sources',
    education: 'education',
    career: 'career'
  };

  const SECTION_TO_MODE = {
    basic: 'summary',
    family: 'family',
    grands: 'grands',
    children: 'children',
    wives: 'wives',
    stories: 'stories',
    timeline: 'timeline',
    sources: 'sources',
    education: 'education',
    career: 'career'
  };

  /* -----------------------------------------------------------------------
     2) جلب الحاوية التي يتم داخلها رسم الأقسام
     - نفضّل bioSectionsContainer إن وجد، وإلا نعود لـ modalContent
  ----------------------------------------------------------------------- */
  const getContainer = () => (
    dom?.bioSectionsContainer ||
    byId?.('bioSectionsContainer') ||
    dom?.modalContent ||
    byId?.('modalContent') ||
    null
  );

  /* -----------------------------------------------------------------------
     3) حالة داخلية للمتحكم
     - mode: الوضع الحالي
     - modeSelect: عنصر select الخاص بالأوضاع (إن وجد)
     - getBio: getter لإرجاع bio "الحديث" لتجنب استخدام نسخة قديمة (stale)
  ----------------------------------------------------------------------- */
  const state = {
    mode: 'summary',
    modeSelect: null,
    getBio: null,
    __bioNav: null,
    __refreshing: false
  };

  // ✅ استهلاك nav من المصدر الحقيقي (state) وليس من object handlers المؤقت
const consumeBioNav = () => {
  const nav = state.__bioNav || null;
  state.__bioNav = null;
  return nav;
};

  /* -----------------------------------------------------------------------
     4) تحويل bioOrGetter إلى كائن Bio فعلي
     - إذا كان Function نستدعيه ونضمن كائنًا
  ----------------------------------------------------------------------- */
  const resolveBio = (bioOrGetter) => {
    if (typeof bioOrGetter === 'function') return bioOrGetter() || {};
    return bioOrGetter || {};
  };

  /* -----------------------------------------------------------------------
     5) التمرير لقسم معيّن داخل الحاوية
     - يدعم نمطين: data-section-id أو class باسم bio-section-{id}
  ----------------------------------------------------------------------- */
  const scrollToSection = (sectionId, { behavior = 'smooth' } = {}) => {
    const container = getContainer();
    if (!container || !sectionId) return;

    const sectionEl =
      container.querySelector(`.bio-section[data-section-id="${sectionId}"]`) ||
      container.querySelector(`.bio-section-${sectionId}`);

    if (!sectionEl) return;
    sectionEl.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
  };

  /* -----------------------------------------------------------------------
     6) التمرير للقسم الرئيسي المرتبط بالوضع الحالي
  ----------------------------------------------------------------------- */
  const scrollToCurrentSection = () => {
    const sectionId = MODE_MAIN_SECTION[state.mode] || null;
    if (!sectionId) return;
    scrollToSection(sectionId, { behavior: 'smooth' });
  };

  
  /* -----------------------------------------------------------------------
     7) إعادة رسم أقسام السيرة داخل المودال
     - bioOrGetter: قد يكون كائن أو دالة getter
     - skipScroll: لمنع تمرير تلقائي بعد الرسم (مفيد عند الانتقال السريع)
  ----------------------------------------------------------------------- */
  const rerenderBio = (bioOrGetter, personObj, fam, { skipScroll = false } = {}) => {
    const target = getContainer();
    if (!target) return;

    target.innerHTML = '';
    const bio = resolveBio(bioOrGetter);
// ✅ Wrapper ذكي: يعيد الرسم لتحديث الـ shortcuts/Badges بدون ما يغيّر سلوك التمرير أو الـ nav
const withShortcutsRefresh = (fn) => (...args) => {
  let ret;
  try {
    ret = fn?.(...args);
    return ret;
  } finally {
    // ✅ منع rerender متداخل
    if (state.__refreshing) return;
    state.__refreshing = true;

    try {
      const container = getContainer();
      const prevScrollTop = container ? container.scrollTop : 0;

      const src = state.getBio || bioOrGetter;

      // ✅ نعيد الرسم بدون تمرير تلقائي
      rerenderBio(src, personObj, fam, { skipScroll: true });

      // ✅ رجّع نفس مكان السك롤 بعد إعادة الرسم
      requestAnimationFrame(() => {
        const c2 = getContainer();
        if (c2) c2.scrollTop = prevScrollTop;
      });
    } finally {
      // نفك القفل بعد ما جدولت استرجاع السكول
      state.__refreshing = false;
    }
  }
};

TreeUI.renderBioSections(target, bio, personObj, fam, {
  ...handlers,

  // ✅ لفّ التحديثات التي تغيّر البيانات لتحديث shortcuts فورًا
  onEventsChange: withShortcutsRefresh(handlers?.onEventsChange),
  onPersonChange: withShortcutsRefresh(handlers?.onPersonChange),

  __bioNav: state.__bioNav,
  __consumeBioNav: consumeBioNav,

  onShowDetails,
  onInlineRename,
  onEditFamily,
  onDeleteFamily,
  onModalSave,

  bioMode: state.mode,

  onBioShortcutClick: (sectionId, navPayload = null) => {
    const nextMode = SECTION_TO_MODE[sectionId] || 'summary';
    const shouldSwitchMode = (state.mode !== nextMode);

    state.__bioNav = navPayload || null;

    if (shouldSwitchMode) {
      state.mode = nextMode;
      if (state.modeSelect) state.modeSelect.value = nextMode;

      const src = state.getBio || bioOrGetter;
      rerenderBio(src, personObj, fam, { skipScroll: true });
    }

  const hasSpecificItem =
  !!(navPayload && (
    navPayload.itemId ||
    navPayload.careerId ||
    navPayload.educationId ||
    navPayload.eventId ||
    navPayload.sourceId
  ));

    if (!hasSpecificItem) {
      requestAnimationFrame(() => {
        scrollToSection(sectionId, { behavior: 'smooth' });
      });
    }
  }
});

    if (!skipScroll) requestAnimationFrame(scrollToCurrentSection);
  };

  /* -----------------------------------------------------------------------
     8) ربط select الخاص بالأوضاع مع المتحكم
     - عند تغيير الوضع: نعيد الرسم باستخدام getter إن وجد
  ----------------------------------------------------------------------- */
  const bindModeSelect = (modeSelect, bioOrGetter, personObj, fam) => {
    state.modeSelect = modeSelect || null;
    state.getBio = (typeof bioOrGetter === 'function') ? bioOrGetter : null;

    if (!modeSelect) return;

    modeSelect.onchange = () => {
      state.mode = modeSelect.value || 'summary';

      const src = state.getBio || bioOrGetter;
      rerenderBio(src, personObj, fam);
    };
  };

  /* -----------------------------------------------------------------------
     9) API عام للاستخدام من app.js
  ----------------------------------------------------------------------- */
  return {
    registry: { MODE_MAIN_SECTION, SECTION_TO_MODE },

    setMode(nextMode) {
      state.mode = nextMode || 'summary';
      if (state.modeSelect) state.modeSelect.value = state.mode;
    },

    getMode() {
      return state.mode;
    },

    bindModeSelect,
    rerenderBio,
    scrollToCurrentSection,
    scrollToSection
  };
}
