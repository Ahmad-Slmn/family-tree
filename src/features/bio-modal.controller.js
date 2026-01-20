// src/features/bio-modal.controller.js
// متحكم مودال السيرة: إدارة الوضع (mode) + إعادة الرسم + التنقل بين الأقسام داخل المودال

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

  /* خريطة: الوضع الحالي ↔ القسم الرئيسي للتمرير */
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

  /* خريطة: عند الضغط على اختصار قسم، لأي وضع ننتقل */
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

  /* نفضل حاوية الأقسام إن وجدت، وإلا نستخدم محتوى المودال */
  const getContainer = () =>
    dom?.bioSectionsContainer ||
    byId?.('bioSectionsContainer') ||
    dom?.modalContent ||
    byId?.('modalContent') ||
    null;

  const resolveBio = (bioOrGetter) =>
    (typeof bioOrGetter === 'function' ? (bioOrGetter() || {}) : (bioOrGetter || {}));

  /* حالة داخلية: نحفظ mode + select + getter + nav + قفل لمنع rerender متداخل */
  const state = {
    mode: 'summary',
    modeSelect: null,
    getBio: null,
    __bioNav: null,
    __refreshing: false
  };

  /* مهم: نستهلك nav من state (مصدر الحقيقة) ثم نفرغه لمنع إعادة استخدامه */
  const consumeBioNav = () => {
    const nav = state.__bioNav || null;
    state.__bioNav = null;
    return nav;
  };

  const getBioSource = (bioOrGetter) => state.getBio || bioOrGetter;

  /* إذا كان التنقل يستهدف عنصر محدد داخل القسم، لا نعمل scroll للقسم (نتركه للـ section نفسه) */
  const hasSpecificNavItem = (navPayload) => !!(
    navPayload && (
      navPayload.itemId ||
      navPayload.careerId ||
      navPayload.educationId ||
      navPayload.eventId ||
      navPayload.sourceId
    )
  );

  const scrollToSection = (sectionId, { behavior = 'smooth' } = {}) => {
    const container = getContainer();
    if (!container || !sectionId) return;

    const sectionEl =
      container.querySelector(`.bio-section[data-section-id="${sectionId}"]`) ||
      container.querySelector(`.bio-section-${sectionId}`);

    if (!sectionEl) return;
    sectionEl.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
  };

  const scrollToCurrentSection = () => {
    const sectionId = MODE_MAIN_SECTION[state.mode];
    if (sectionId) scrollToSection(sectionId, { behavior: 'smooth' });
  };

  /* -----------------------------------------------------------------------
     rerenderBio: يعيد بناء أقسام السيرة داخل الحاوية
     - skipScroll: لمنع التمرير بعد الرسم (مفيد عند تبديل mode أو تحديث داخلي سريع)
  ----------------------------------------------------------------------- */
  const rerenderBio = (bioOrGetter, personObj, fam, { skipScroll = false } = {}) => {
    const target = getContainer();
    if (!target) return;

    target.innerHTML = '';
    const bio = resolveBio(bioOrGetter);

    TreeUI.renderBioSections(target, bio, personObj, fam, buildRenderHandlers({
      bioOrGetter,
      personObj,
      fam
    }));

    if (!skipScroll) requestAnimationFrame(scrollToCurrentSection);
  };

  function refreshModeSelectOptions(bioOrGetter, personObj, fam) {
  const sel = state.modeSelect;
  if (!sel) return;

  const bio = resolveBio(getBioSource(bioOrGetter));
  const modes = TreeUI.getAvailableBioModes?.(bio, personObj, fam) || [];

  const current = state.mode || sel.value || 'summary';

  // rebuild options
  sel.innerHTML = '';
  modes.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    sel.appendChild(opt);
  });

  // keep current mode if still valid
  const has = Array.from(sel.options).some(o => o.value === current);
  sel.value = has ? current : 'summary';
  state.mode = sel.value;
}

  /* -----------------------------------------------------------------------
     withShortcutsRefresh: غلاف لإعادة الرسم بعد تغييرات البيانات
     لماذا؟ لأن shortcuts/badges داخل الأقسام تحتاج تعكس التغييرات فورًا
     ملاحظة: نمنع rerender المتداخل باستخدام __refreshing ونحافظ على scrollTop
  ----------------------------------------------------------------------- */
  const withShortcutsRefresh = (bioOrGetter, personObj, fam, fn) => (...args) => {
    let ret;
    try {
      ret = fn?.(...args);
      return ret;
    } finally {
      if (state.__refreshing) return;
      state.__refreshing = true;

      try {
        const container = getContainer();
        const prevScrollTop = container ? container.scrollTop : 0;

        rerenderBio(getBioSource(bioOrGetter), personObj, fam, { skipScroll: true });
        refreshModeSelectOptions(bioOrGetter, personObj, fam);

        requestAnimationFrame(() => {
          const c2 = getContainer();
          if (c2) c2.scrollTop = prevScrollTop;
        });
      } finally {
        state.__refreshing = false;
      }
    }
  };

  /* نجمع كل handlers المرسلة لـ TreeUI في مكان واحد لتقليل التشعب */
  const buildRenderHandlers = ({ bioOrGetter, personObj, fam }) => ({
    ...handlers,

    // تحديثات تؤثر على عرض shortcuts/badges → نعيد الرسم مباشرة بعد التغيير
    onEventsChange: withShortcutsRefresh(bioOrGetter, personObj, fam, handlers?.onEventsChange),
    onPersonChange: withShortcutsRefresh(bioOrGetter, personObj, fam, handlers?.onPersonChange),
onUpdateSources: withShortcutsRefresh(bioOrGetter, personObj, fam, handlers?.onUpdateSources),

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

      // إذا الاختصار يتبع قسم في وضع مختلف: نغيّر mode ثم نعيد الرسم بدون scroll تلقائي
      if (shouldSwitchMode) {
        state.mode = nextMode;
        if (state.modeSelect) state.modeSelect.value = nextMode;

        rerenderBio(getBioSource(bioOrGetter), personObj, fam, { skipScroll: true });
      }

      // إذا ما فيه عنصر محدد داخل القسم: نمرر للقسم نفسه
      if (!hasSpecificNavItem(navPayload)) {
        requestAnimationFrame(() => scrollToSection(sectionId, { behavior: 'smooth' }));
      }
    }
  });

  /* ربط select بالأوضاع: تغيير الوضع يعيد الرسم باستخدام getter إن وجد */
  const bindModeSelect = (modeSelect, bioOrGetter, personObj, fam) => {
    state.modeSelect = modeSelect || null;
    state.getBio = (typeof bioOrGetter === 'function') ? bioOrGetter : null;

    if (!modeSelect) return;

    modeSelect.onchange = () => {
      state.mode = modeSelect.value || 'summary';
      rerenderBio(getBioSource(bioOrGetter), personObj, fam);
    };
  };

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