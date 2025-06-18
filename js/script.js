// بيانات العائلتين
const familiesData = {
  family1: {
    grandfather: {
      name: "إدريس",
      role: "الجد",
      bio: {
        birthYear: "-",
        birthPlace: "-",
        description: "مؤسس العائلة وحامل إرثها العريق",
        education: "حافظ لكتاب الله"
      }
    },
    father: {
      name: "محمد",
      role: "الأب",
      bio: {
        birthYear: "-",
        birthPlace: "-",
        description: "قائد العائلة وحامل مسؤولياتها",
        education: "حافظ لكتاب الله"
      }
    },
    grandson: {
      name: "سَيْدِنا",
      role: "الحفيد",
      bio: {
        fullName: "أحمد محمد إدريس بُقَرْ",
        cognomen: "سَيْدِنا",
        tribe: "قٌرْعان",
        clan: "يِرِي",
        motherName: "-",
        motherClan: "يِرِي",
        description: "مؤسس العائلة وحامل إرثها العريق",
        education: "حافظ لكتاب الله",
        remark: "سَيْدِنا ومصطفى أشقاء",
        siblingsBrothers: [{ name: "مصطفى" }, { name: "مَلْ لَمين" }],
        siblingsSisters: [{ name: "رُوا" }, { name: "زينفة" }, { name: "مُرْمَ" }, { name: "جُلّي" }],
        wives: [
          { name: "مَرْ موسى رَوْ" },
          { name: "زهرة عَسْبَلَّ بُلْجي" },
          { name: "فاطمة علي عبد الكريم" },
          { name: "كُري بَتُرَنْ" }
        ]
      }
    },
    wives: [
      {
        name: "مَرْ موسى رَوْ",
        role: "الزوجة الأولى",
        bio: { fatherName: "مصطفى", motherName: "-", tribe: "قٌرْعان", clan: "كُشى" },
        children: [
          "آدام", "أبَكُرِى", "مَلْ علي", "مَلْ سِنِّي", "محمد نور", "إدريس", "زهرة", "لُكِي", "فاطمة"
        ].map(name => ({ name, role: name === "زهرة" || name === "لُكِي" || name === "فاطمة" ? "بنت" : "ابن", bio: { birthYear: "-", birthPlace: "-" } }))
      },
      {
        name: "زهرة عَسْبَلَّ بُلْجي",
        role: "الزوجة الثانية",
        bio: {
          fatherName: "-",
          motherName: "زاري فُزَرْياراي: من عشيرة: مِدْلِي",
          tribe: "قٌرْعان",
          clan: "كُمَّجِلي",
          remark: "هي أم لجدي محمد وجدي أبكر"
        },
        children: [
          { name: "محمد", role: "ابن", bio: { birthYear: "-", birthPlace: "-", remark: "جدي من جهة الأب" } },
          { name: "موسى", role: "ابن", bio: { birthYear: "-", birthPlace: "-", education: "حافظ لكتاب الله" } },
          { name: "أبكر", role: "ابن", bio: { birthYear: "-", birthPlace: "-", remark: "جدي من جهة الأم" } }
        ]
      },
      {
        name: "فاطمة علي عبد الكريم",
        role: "الزوجة الثالثة",
        bio: { fatherName: "علي", motherName: "-", tribe: "قٌرْعان", clan: "مِلاَّ", remark: "تزوجها أخوه مصطفى بعد وفاته" },
        children: [
          { name: "محمد", role: "ابن", bio: { birthYear: "-", birthPlace: "-" }, education: "حافظ لكتاب الله" },
          { name: "عبد الرحمن", role: "ابن", bio: { birthYear: "-", birthPlace: "-", cognomen: "أَدِّ" } },
          { name: "هرةَ شو", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } }
        ]
      },
      {
        name: "كُري بَتُرَنْ",
        role: "الزوجة الرابعة",
        bio: { fatherName: "بَتُرَنْ", motherName: "-", tribe: "قٌرْعان", clan: "بَرِيَ" },
        children: [{ name: "بشير", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } }]
      }
    ]
  },

  family2: {
    grandfather: {
      name: "قيلي",
      role: "الجد",
      bio: {
        birthYear: "-",
        birthPlace: "-",
        description: "مؤسس العائلة وحامل إرثها العريق",
        education: "حافظ لكتاب الله"
      }
    },
    father: {
      name: "موسى",
      role: "الأب",
      bio: {
        birthYear: "-",
        birthPlace: "-",
        description: "قائد العائلة وحامل مسؤولياتها",
        education: "حافظ لكتاب الله"
      }
    },
    grandson: {
      name: "كُبُرَ زين",
      role: "الحفيد",
      bio: {
        description: "مؤسس العائلة وحامل إرثها العريق",
        fullName: "محمد موسى قيلي أُبِي",
        cognomen: "كُبُرَ زين مَلْ مار جيلي",
        tribe: "قٌرْعان",
        clan: "ضولو",
        motherName: "شونُرا عَقِد مِلى",
        motherClan: "ضولو",
        education: "حافظ لكتاب الله",
        remark: "هو وأبوه وجده وأبو جده كلهم حُفَّاظ لكتاب الله",
        siblingsBrothers: [{ name: "سليمان" }, { name: "عمر شُوِي" }],
        siblingsSisters: [{ name: "كُرِي" }, { name: "مَرْمَ فُلْجِى" }, { name: "أمِنَة" }, { name: "جَنّبَ" }],
        wives: [
          { name: "أمِري علي دُو" },
          { name: "زينفة مري" },
          { name: "بِنْتِي آدم ميني" },
          { name: "كُرِي بُكِنِّ كُبُرِي" }
        ]
      }
    },
    wives: [
      {
        name: "أمِري علي دُو",
        role: "الزوجة الأولى",
        bio: { fatherName: "علي", motherName: "-", tribe: "قٌرْعان", clan: "ضولو" },
        children: [
          "إيطار", "مصطفى قوني", "كُبُرى", "بِنْتِي", "ميمونة", "ديرو", "شُو"
        ].map(name => ({
          name,
          role: ["كُبُرى", "شُو"].includes(name) ? "بنت" : (name === "بِنْتِي" ? "بنت" : "ابن"),
          bio: { birthYear: "-", birthPlace: "-", ...(name === "كُبُرى" || name === "شُو" ? { remark: "ليس لها أبناء" } : {}) }
        }))
      },
      {
        name: "زينفة مري",
        role: "الزوجة الثانية",
        bio: { fatherName: "حسن", motherName: "-", tribe: "قٌرْعان", clan: "كُدِرى" },
        children: [
          { name: "مَلْ لَمِين", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مَلْ حسن", role: "ابن", bio: { birthYear: "-", birthPlace: "-", remark: "هو أبو ما لا قا" } },
          { name: "تِجَّني", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "حامد", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "عيسى", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "زهرة إلِّي", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "فاطمة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "أمِنَة", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "أمِنَة هي أم مَلْ علي" } }
        ]
      },
      {
        name: "بِنْتِي آدم ميني",
        role: "الزوجة الثالثة",
        bio: { fatherName: "آدم", motherName: "-", tribe: "قٌرْعان", clan: "مُوسَوْرَوْ" },
        children: [
          { name: "عمر", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "آدم مِلي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "زهرة", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء" } },
          { name: "فاطمة", role: "بنت", bio: { birthYear: "-", birthPlace: "-", cognomen: "مشهورة ب لَبو", remark: "ليس لها أبناء" } },
          { name: "رُوا", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "بَتُل", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "حمزةَ", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء" } }
        ]
      },
      {
        name: "كُرِي بُكِنِّ كُبُرِي",
        role: "الزوجة الرابعة",
        bio: {
          fatherName: "بُكِنِّ",
          motherName: "لُكِي رُرُكْ عبد الكريم",
          tribe: "قٌرْعان",
          clan: "نوري رَوْ",
          remark: "سُمي أبي على أخيها سليمان الملقب ب كُري"
        },
        children: [
          { name: "بشير", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مريم", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "هي جدتي من جهة الأب" } }
        ]
      }
    ]
  }
};

// المفتاح الافتراضي للعائلة المختارة
let currentFamilyKey = localStorage.getItem('selectedFamily') || 'family1';

// تسميات الحقول للسيرة الذاتية
const LABELS = {
    fullName: 'الإسم',
    cognomen: 'اللقب',
    fatherName: 'اسم الأب',
    tribe: 'القبيلة',
    clan: 'العشيرة',
    motherName: 'اسم الأم',
    motherClan: 'عشيرة الأم',
    birthYear: 'تاريخ الميلاد',
    birthPlace: 'مكان الميلاد',
    occupation: 'المهنة'
};

// إنشاء بطاقة عضو
function createCard(person, className) {
    const card = document.createElement('div');
    card.className = `member-card ${className}`;
    card.innerHTML = `
    <div class="avatar">👤</div>
    <div class="name">${person.name}</div>
    <div class="role">${person.role}</div>
  `;
    card.onclick = () => showDetails(person);
    return card;
}

// رابط رأسي
function createConnector() {
    const line = document.createElement('div');
    line.className = 'connector';
    return line;
}

// إنشاء خط (رأسي أو أفقي) أو وصلات
const createLine = (className) => {
    const el = document.createElement('div');
    el.className = className;
    return el;
};

// إنشاء خط رأسياً بين الزوجة والأبناء
const createVerticalLineBetweenWifeAndChildren = () => createLine('vertical-line');

// إنشاء وصلات الأبناء تحت الزوجة
function createWifeChildrenConnector(count) {
    const wrap = document.createElement('div');
    wrap.className = 'connector-wrapper';
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;';

    wrap.append(createLine('vertical-line arrow-down'));

    const hLine = createLine('horizontal-children-line');
    hLine.style.cssText = `display:grid;grid-template-columns:repeat(${count},1fr);width:100%;`;
    for (let i = 0; i < count; i++) {
        hLine.append(createLine('child-connector'));
    }
    wrap.append(hLine);
    return wrap;
}

// إنشاء قسم الزوجة مع عداد الأبناء والبنات
function createWifeSection(wife, index) {
    const sec = document.createElement('div');
    sec.className = 'wife-section';

    const num = document.createElement('div');
    num.className = 'wife-number';
    num.textContent = index + 1;
    sec.append(num);

    const count = wife.children.reduce((acc, c) => {
        if (c.role === 'ابن') acc.sons++;
        else if (c.role === 'بنت') acc.daughters++;
        return acc;
    }, {
        sons: 0,
        daughters: 0
    });

    const total = count.sons + count.daughters;
    const wifeCard = createCard(wife, 'wife');

    const counterBox = document.createElement('div');
    counterBox.className = 'wife-counter';
    counterBox.innerHTML = `
    <p class="count-item"><span class="count-label">الأبناء:</span> <span class="count-value">${count.sons}</span></p>
    <p class="count-item"><span class="count-label">البنات:</span> <span class="count-value">${count.daughters}</span></p>
    <p class="count-item"><span class="count-label">الإجمال:</span> <span class="count-value">${total}</span></p>
  `;

    wifeCard.append(counterBox);
    sec.append(wifeCard);
    sec.append(createVerticalLineBetweenWifeAndChildren());
    sec.append(createWifeChildrenConnector(wife.children.length));

    const grid = document.createElement('div');
    grid.className = 'children-grid';
    wife.children.forEach(child => {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';
        wrapper.append(createCard(child, child.role === 'ابن' ? 'son' : 'daughter'));
        grid.append(wrapper);
    });
    sec.append(grid);
    return sec;
}

// عرض السيرة الذاتية في المودال
function showDetails(person) {
    const modal = document.getElementById('bioModal');
    document.getElementById('modalName').textContent = person.name;
    document.getElementById('modalRole').textContent = person.role;

    const bio = person.bio || {};
    let html = bio.description ? `<p class="bio-description">${bio.description}</p>` : '';

    // معلومات عامة
    html += '<div class="bio-info">';
    Object.keys(LABELS).forEach(field => {
        if (bio[field]) {
            html += `<div class="bio-field"><strong>${LABELS[field]}:</strong><span>${bio[field]}</span></div>`;
        }
    });
    html += '</div><div class="bio-details">';

    // ملاحظات، تعليم، إنجازات، هوايات
    if (bio.remark) html += `<div><h3>ملاحظة:</h3><p>${bio.remark}</p></div>`;
    if (bio.education) html += `<div><h3>التعليم:</h3><p>${bio.education}</p></div>`;
    if (bio.achievements?.length) {
        html += `<div><h3>الإنجازات</h3><ul>${bio.achievements.map(a => `<li>${a}</li>`).join('')}</ul></div>`;
    }
    if (bio.hobbies?.length) {
        html += `<div><h3>الهوايات</h3><div class="hobbies">${bio.hobbies.map(h => `<span class="hobby">${h}</span>`).join('')}</div></div>`;
    }

    // إخوة، أخوات، زوجات
  ['siblingsBrothers', 'siblingsSisters', 'wives'].forEach(key => {
        if (bio[key]?.length) {
            const labelsMap = {
                siblingsBrothers: 'الإخوة',
                siblingsSisters: 'الأخوات',
                wives: 'الزوجات'
            };
            html += `
        <div>
          <h3>${labelsMap[key]}: <span class="count">(${bio[key].length})</span></h3>
          <ul>${bio[key].map(s => `<li>${s.name}</li>`).join('')}</ul>
        </div>`;
        }
    });

    // أبناء وبنات الحفيد من العائلة الحالية
    if (person.role === 'الحفيد') {
        const fam = familiesData[currentFamilyKey];
        const allChildren = fam.wives.flatMap(w => w.children || []);
        const sons = allChildren.filter(c => c.role === 'ابن');
        const daughters = allChildren.filter(c => c.role === 'بنت');

        if (sons.length || daughters.length) {
            html += `<div class="bio-children">`;
            if (sons.length) html += `<div><h3>الأبناء: <span class="count">(${sons.length})</span></h3><ul>${sons.map(s => `<li>${s.name}</li>`).join('')}</ul></div>`;
            if (daughters.length) html += `<div><h3>البنات: <span class="count">(${daughters.length})</span></h3><ul>${daughters.map(d => `<li>${d.name}</li>`).join('')}</ul></div>`;
            html += `</div>`;
        }
    }

    // أبناء وبنات الزوجة
    if (Array.isArray(person.children)) {
        const sons = person.children.filter(c => c.role === 'ابن');
        const daughters = person.children.filter(c => c.role === 'بنت');

        html += `
      <div>
        <h3><span class="label">الأبناء:</span> <span class="count">(${sons.length})</span></h3>
        ${sons.length ? `<ul>${sons.map(s => `<li>${s.name}</li>`).join('')}</ul>` : ''}
      </div>
      <div>
        <h3><span class="label">البنات:</span> <span class="count">(${daughters.length})</span></h3>
        ${daughters.length ? `<ul>${daughters.map(d => `<li>${d.name}</li>`).join('')}</ul>` : ''}
      </div>`;
    }

    html += '</div>';
    document.getElementById('modalContent').innerHTML = html;
    modal.classList.add('active');
}

// عداد الإخوة والأخوات
const countSiblings = () => {
    const bio = familiesData[currentFamilyKey]?.grandson?.bio || {};
    return {
        brothers: bio.siblingsBrothers?.length || 0,
        sisters: bio.siblingsSisters?.length || 0,
        wives: bio.wives?.length || 0
    };
};

// عد الأبناء والبنات في العائلة
function countChildren(family) {
    if (!Array.isArray(family.wives)) return {
        sons: 0,
        daughters: 0,
        total: 0
    };
    return family.wives.reduce((acc, wife) => {
        (wife.children || []).forEach(c => {
            if (c.role === 'ابن') acc.sons++;
            else if (c.role === 'بنت') acc.daughters++;
        });
        acc.total = acc.sons + acc.daughters;
        return acc;
    }, {
        sons: 0,
        daughters: 0,
        total: 0
    });
}

// إنشاء صندوق عدد الأبناء
const Create_Children_CountBox = ({
    sons,
    daughters,
    total
}) => {
    const box = document.createElement('div');
    box.className = 'Create_Children_CountBox';
    box.innerHTML = `
    <p><span class="label">الأبناء: </span><span class="value">${sons}</span></p>
    <p><span class="label">البنات: </span><span class="value">${daughters}</span></p>
    <p><span class="label">الإجمال: </span><span class="value">${total}</span></p>
  `;
    return box;
};

// إنشاء عداد الإخوة والأخوات
const createSiblingCounter = ({
    brothers,
    sisters
}) => {
    const div = document.createElement('div');
    div.className = 'sibling-counter';
    div.innerHTML = `
    <p>الإخوة: <strong>${brothers}</strong></p>
    <p>الأخوات: <strong>${sisters}</strong></p>
  `;
    return div;
};

// ==========================================
// رسم شجرة العائلة
// ==========================================
function drawFamilyTree() {
    const tree = document.getElementById('familyTree');
    tree.innerHTML = '';

    const fam = familiesData[currentFamilyKey];
    const ancestors = [fam.grandfather, fam.father, fam.grandson];

    // تحديث عنوان الشجرة حسب العائلة المختارة
    const titleMap = {
        family1: 'عائلة: سَيْدِنا محمد إدريس بُقَرْ',
        family2: 'عائلة: كُبُرَ زين موسى قيلي أُبِي'
    };
    document.getElementById('treeTitle').textContent = titleMap[currentFamilyKey] || 'عائلة';

    ancestors.forEach((person, idx) => {
        const generation = document.createElement('div');
        generation.className = 'generation';

        const isGrandson = person.role === 'الحفيد';
        const card = createCard(person, `ancestor${isGrandson ? ' grandson' : ''}`);

        if (isGrandson) {
            card.append(createSiblingCounter(countSiblings()));
            card.append(createWivesCounter(fam.wives.length));
            card.append(Create_Children_CountBox(countChildren(fam)));
        }

        generation.append(card);

        // إضافة الخط الرابط بين الأجيال
        if (idx < ancestors.length - 1) {
            generation.append(createConnector());
        }

        tree.append(generation);
    });

    // عرض قسم الزوجات
    const wivesSection = document.createElement('div');
    wivesSection.className = 'generation';
    fam.wives.forEach((wife, i) => wivesSection.append(createWifeSection(wife, i)));
    tree.append(wivesSection);
}

function createWivesCounter(count) {
    const div = document.createElement('div');
    div.className = 'wife-count';
    div.innerHTML = `<p><span class="label">الزوجات: </span><span class="value">${count}</span></p>`;
    return div;
}

// ==========================================
// إدارة المودال
// ==========================================
const closeModal = () => document.getElementById('bioModal').classList.remove('active');

window.onclick = e => {
    if (e.target.classList.contains('modal')) closeModal();
};

// ==========================================
// إعدادات الدخول (مع تشفير كلمة المرور)
// ==========================================
const HASHED_PASSWORD = '44370fa6b87e60068a64f71bf6f3b251318cbf00df4b7d29bf740c3cc6fcfada';

async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function checkLoginStatus() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true',
          lastPassword = localStorage.getItem('loginPassword'),
          timestamp = +localStorage.getItem('loginTimestamp'),
          hoursPassed = (Date.now() - timestamp) / 36e5;

    if (isLoggedIn && (lastPassword !== HASHED_PASSWORD || hoursPassed >= 24)) {
        ['isLoggedIn', 'loginPassword', 'loginTimestamp'].forEach(localStorage.removeItem.bind(localStorage));
        return location.reload();
    }

    const show = !isLoggedIn;
    document.getElementById('loginPopup').classList.toggle('active', show);
    document.getElementById('familyTree').style.display = show ? 'none' : 'flex';
    document.getElementById('logoutBtn').style.display = show ? 'none' : 'block';
}

function showError(input, message) {
    const msgElem = document.getElementById('loginMessage');
    msgElem.textContent = message;
    input.classList.add('shake', 'input-error');
    clearTimeout(window.errorTimeout);
    window.errorTimeout = setTimeout(() => {
        msgElem.textContent = '';
        input.classList.remove('shake', 'input-error');
    }, 3000);
}

document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('passwordInput');
    input.classList.remove('shake', 'input-error');

    if (!input.value.trim()) {
        showError(input, 'يرجى إدخال كلمة المرور.');
        return;
    }

    const hashedInput = await hashPassword(input.value);
    if (hashedInput === HASHED_PASSWORD) {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('loginTimestamp', Date.now().toString());
        localStorage.setItem('loginPassword', HASHED_PASSWORD);
        checkLoginStatus();
        drawFamilyTree();
    } else {
        showError(input, 'كلمة المرور غير صحيحة.');
    }
});

// ==========================================
// تسجيل الخروج
// ==========================================
const confirmLogoutBox = document.getElementById('confirmLogout');
const noLogoutBtn = document.getElementById('noLogout');

document.getElementById('logoutBtn').addEventListener('click', () => {
    confirmLogoutBox.classList.add('active');
    noLogoutBtn.focus();
    noLogoutBtn.classList.add('shake');
    noLogoutBtn.addEventListener('animationend', () => noLogoutBtn.classList.remove('shake'), {
        once: true
    });
});

document.getElementById('yesLogout').addEventListener('click', () => {
    ['isLoggedIn', 'loginPassword', 'loginTimestamp'].forEach(key => localStorage.removeItem(key));
    location.reload();
});

document.getElementById('noLogout').addEventListener('click', () => {
    confirmLogoutBox.classList.remove('active');
});

confirmLogoutBox.addEventListener('click', e => {
    if (!e.target.closest('.confirm-box')) confirmLogoutBox.classList.remove('active');
});

// ==========================================
// التعامل مع زر Enter في كلمة المرور
// ==========================================
document.getElementById('passwordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('loginForm').dispatchEvent(new Event('submit'));
    }
});

// ==========================================
// عند تحميل الصفحة
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // تفعيل زر الدخول
    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    loginBtn?.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById('loginForm').dispatchEvent(new Event('submit'));
    });

    checkLoginStatus();
    applySavedTheme();
    drawFamilyTree();

    // تفعيل العائلة المختارة
    document.querySelectorAll('.family-button').forEach(btn => {
        btn.classList.toggle('active-family', btn.dataset.family === currentFamilyKey);
        btn.addEventListener('click', () => {
            document.querySelectorAll('.family-button').forEach(b => b.classList.remove('active-family'));
            btn.classList.add('active-family');
            currentFamilyKey = btn.dataset.family;
            localStorage.setItem('selectedFamily', currentFamilyKey);
            drawFamilyTree();
        });
    });

    // إغلاق المودال
    document.getElementById('closeModal')?.addEventListener('click', closeModal);

    // تبديل الثيمات
    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.addEventListener('click', () => {
            [...document.body.classList]
            .filter(c => c.startsWith('theme-'))
                .forEach(c => document.body.classList.remove(c));

            if (btn.dataset.theme !== 'default') {
                document.body.classList.add(`theme-${btn.dataset.theme}`);
            }

            localStorage.setItem('familyTreeTheme', btn.dataset.theme);
            document.querySelectorAll('.theme-button').forEach(b => b.classList.remove('active-theme'));
            btn.classList.add('active-theme');
            // إزالة التركيز من أي عنصر
            btn.blur();

        });
    });
    // إظهار / إخفاء كلمة المرور
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('passwordInput');
    togglePassword?.addEventListener('click', () => {
        const hidden = passwordInput.getAttribute('type') === 'password';
        passwordInput.setAttribute('type', hidden ? 'text' : 'password');
        togglePassword.textContent = hidden ? '🙈' : '👁️';
    });
});

// ==========================================
// تطبيق الثيم المحفوظ
// ==========================================
function applySavedTheme() {
    const theme = localStorage.getItem('familyTreeTheme') || 'default';
    if (theme !== 'default') document.body.classList.add(`theme-${theme}`);

    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.toggle('active-theme', btn.dataset.theme === theme);
    });
}