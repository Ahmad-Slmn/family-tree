// بيانات عائلتين
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
        siblingsBrothers: [
          { name: "مصطفى" },
          { name: "مَلْ لَمين" }
        ],
        siblingsSisters: [
          { name: "رُوا" },
          { name: "زينفة" },
          { name: "مُرْمَ" },
          { name: "جُلّي" }
        ]
      }
    },
    wives: [
      // الزوجة الأولى
      {
        name: "مَرْ موسى رَوْ",
        role: "الزوجة الأولى",
        bio: {
          fatherName: "مصطفى",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "كُشى"
        },
        children: [
          { name: "آدام", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "ابَكُرِى", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مَلْ علي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مَلْ سِنِّي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "محمد نور", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "إدريس", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "زهرة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "لُكِي", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "فاطمة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } }
        ]
      },

      // الزوجة الثانية
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

      // الزوجة الثالثة
      {
        name: "فاطمة علي عبد الكريم",
        role: "الزوجة الثالثة",
        bio: {
          fatherName: "علي",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "مِلاَّ",
          remark: "تزوجها أخوه مصطفى بعد وفاته"
        },
        children: [
          { name: "محمد", role: "ابن", bio: { birthYear: "-", birthPlace: "-" }, education: "حافظ لكتاب الله" },
          { name: "عبد الرحمن", role: "ابن", bio: { birthYear: "-", birthPlace: "-", cognomen: "أَدِّ" } },
          { name: "هرةَ شو", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } }
        ]
      },

      // الزوجة الرابعة
      {
        name: "كُري بَتُرَنْ",
        role: "الزوجة الرابعة",
        bio: {
          fatherName: "بَتُرَنْ",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "بَرِيَ"
        },
        children: [
          { name: "بشير", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } }
        ]
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
      name: "محمد",
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
        siblingsBrothers: [
          { name: "سليمان" },
          { name: "عمر شُوِي" }
        ],
        siblingsSisters: [
          { name: "كُرِي" },
          { name: "مَرْمَ فُلْجِى" },
          { name: "أمِنَة" },
          { name: "جَنّبَ" }
        ]
      }
    },
    wives: [
        
    // الزوجة الأولى
      {
        name: "أمِري علي دُو",
        role: "الزوجة الأولى",
        bio: {
          fatherName: "علي",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "ضولو"
        },
        children: [
          { name: "إيطار", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مصطفى قوني", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "كُبُرى", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء" } },
          { name: "بِنْتِي", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "ميمونة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "ديرو", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "شُو", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء" } }
        ]
      },
        
    // الزوجة الثانية
      {
        name: "زينفة مري",
        role: "الزوجة الثانية",
        bio: {
          fatherName: "حسن",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "كُدِرى"
        },
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
        
    // الزوجة الثالثة
      {
        name: "بِنْتِي آدم ميني",
        role: "الزوجة الثالثة",
        bio: {
          fatherName: "آدم",
          motherName: "-",
          tribe: "قٌرْعان",
          clan: "مُوسَوْرَوْ"
        },
        children: [
          { name: "عمر", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "آدم مِلي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "زهرة", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء" } },
          { name: "فاطمة", role: "بنت", bio: { birthYear: "-", birthPlace: "-", cognomen: "مشهورة ب لَبو", remark: "ليس لها أبناء"  } },
          { name: "رُوا", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "بَتُل", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "حمزةَ", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "ليس لها أبناء"  } },
        ]
      },
        
    // الزوجة الرابعة
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
          { name: "مريم", role: "بنت", bio: { birthYear: "-", birthPlace: "-", remark: "هي جدتي من جهة الأب" } },
        ]
      },
    ]
  }
};

// المفتاح الافتراضي للعائلة المختارة
let currentFamilyKey = localStorage.getItem('selectedFamily') || 'family1';

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

// عرض السيرة الذاتية
function showDetails(person) {
    const modal = document.getElementById('bioModal');
    document.getElementById('modalName').textContent = person.name;
    document.getElementById('modalRole').textContent = person.role;

    const bio = person.bio;
    let html = bio.description ? `<p class="bio-description">${bio.description}</p>` : '';

    html += `<div class="bio-info">`;
    const fields = ['fullName', 'cognomen', 'fatherName', 'tribe', 'clan', 'motherName', 'motherClan', 'birthYear', 'birthPlace', 'occupation'];
    fields.forEach(field => {
        if (bio[field]) {
            html += `<div class="bio-field"><strong>${getLabel(field)}:</strong><span>${bio[field]}</span></div>`;
        }
    });
    html += `</div><div class="bio-details">`;

    if (bio.remark) html += `<div><h3>ملاحظة:</h3><p>${bio.remark}</p></div>`;
    if (bio.education) html += `<div><h3>التعليم:</h3><p>${bio.education}</p></div>`;
    if (bio.achievements) html += `<div><h3>الإنجازات</h3><ul>${bio.achievements.map(a => `<li>${a}</li>`).join('')}</ul></div>`;
    if (bio.hobbies) html += `<div><h3>الهوايات</h3><div class="hobbies">${bio.hobbies.map(h => `<span class="hobby">${h}</span>`).join('')}</div></div>`;

  ['siblingsBrothers', 'siblingsSisters'].forEach(key => {
        if (bio[key]?.length) {
            const label = key === 'siblingsBrothers' ? 'الإخوة' : 'الأخوات';
            html += `
        <div>
          <h3>${label}: <span class="count">(${bio[key].length})</span></h3>
          <ul>${bio[key].map(s => `<li>${s.name}</li>`).join('')}</ul>
        </div>`;
        }
    });

    // أبناء وبنات الحفيد
    if (person.role === 'الحفيد') {
        const fam = familiesData[currentFamilyKey];
        const allChildren = fam.wives.flatMap(wife => wife.children || []);
        const sons = allChildren.filter(c => c.role === 'ابن');
        const daughters = allChildren.filter(c => c.role === 'بنت');

        if (sons.length || daughters.length) {
            html += `<div class="bio-children">`;
            if (sons.length) {
                html += `<div><h3>الأبناء: <span class="count">(${sons.length})</span></h3><ul>${sons.map(s => `<li>${s.name}</li>`).join('')}</ul></div>`;
            }
            if (daughters.length) {
                html += `<div><h3>البنات: <span class="count">(${daughters.length})</span></h3><ul>${daughters.map(d => `<li>${d.name}</li>`).join('')}</ul></div>`;
            }
            html += `</div>`;
        }
    }

    // أبناء وبنات الزوجة
    if (Array.isArray(person.children)) {
        const sons = person.children.filter(c => c.role === 'ابن');
        const daughters = person.children.filter(c => c.role === 'بنت');

        html += `<div>`;
        html += `<h3><span class="label">الأبناء:</span> <span class="count">(${sons.length})</span></h3>`;
        if (sons.length) html += `<ul>${sons.map(s => `<li>${s.name}</li>`).join('')}</ul>`;
        html += `</div>`;

        html += `<div>`;
        html += `<h3><span class="label">البنات:</span> <span class="count">(${daughters.length})</span></h3>`;
        if (daughters.length) html += `<ul>${daughters.map(d => `<li>${d.name}</li>`).join('')}</ul>`;
        html += `</div>`;
    }

    html += `</div>`;
    document.getElementById('modalContent').innerHTML = html;
    modal.classList.add('active');
}

function getLabel(field) {
    const labels = {
        fullName: 'الإسم',
        cognomen: 'اللقب',
        tribe: 'القبيلة',
        clan: 'العشيرة',
        motherName: 'اسم الأم',
        motherClan: 'عشيرة الأم',
        fatherName: 'اسم الأب',
        birthYear: 'تاريخ الميلاد',
        birthPlace: 'مكان الميلاد',
        occupation: 'المهنة'
    };
    return labels[field] || field;
}

// خط رأسي بين الزوجة والأبناء
function createVerticalLineBetweenWifeAndChildren() {
    const line = document.createElement('div');
    line.className = 'vertical-line';
    return line;
}

// إنشاء قسم الزوجة
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

    wife.children.forEach(ch => {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';
        wrapper.append(createCard(ch, ch.role === 'ابن' ? 'son' : 'daughter'));
        grid.append(wrapper);
    });

    sec.append(grid);
    return sec;
}

// رسم خط الأبناء من الزوجة
function createWifeChildrenConnector(count) {
    const wrap = document.createElement('div');
    wrap.className = 'connector-wrapper';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';

    const v = document.createElement('div');
    v.className = 'vertical-line arrow-down';
    wrap.append(v);

    const h = document.createElement('div');
    h.className = 'horizontal-children-line';
    h.style.display = 'grid';
    h.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
    h.style.width = '100%';

    for (let i = 0; i < count; i++) {
        const seg = document.createElement('div');
        seg.className = 'child-connector';
        h.append(seg);
    }

    wrap.append(h);
    return wrap;
}

// عد الإخوة والأخوات
const countSiblings = () => {
    const g = familiesData[currentFamilyKey].grandson.bio;
    return {
        brothers: g.siblingsBrothers?.length || 0,
        sisters: g.siblingsSisters?.length || 0
    };
};

// عد الأبناء والبنات في العائلة
function countChildren(fam) {
    if (!Array.isArray(fam.wives)) return {
        sons: 0,
        daughters: 0,
        total: 0
    };

    return fam.wives.reduce((acc, wife) => {
        (wife.children || []).forEach(child => {
            if (child.role === 'ابن') acc.sons++;
            else if (child.role === 'بنت') acc.daughters++;
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
const createCountBox = ({
    sons,
    daughters,
    total
}) => {
    const b = document.createElement('div');
    b.className = 'countBox';
    b.innerHTML = `
    <p><span class="label">الأبناء: </span><span class="value">${sons}</span></p>
    <p><span class="label">البنات: </span><span class="value">${daughters}</span></p>
    <p><span class="label">الإجمال: </span><span class="value">${total}</span></p>
  `;
    return b;
};

// إنشاء عداد الإخوة والأخوات
const createSiblingCounter = ({
    brothers,
    sisters
}) => {
    const d = document.createElement('div');
    d.className = 'sibling-counter';
    d.innerHTML = `
    <p>الإخوة: <strong>${brothers}</strong></p>
    <p>الأخوات: <strong>${sisters}</strong></p>
  `;
    return d;
};

// ==========================================
// رسم شجرة العائلة
// ==========================================
function drawFamilyTree() {
    const tree = document.getElementById('familyTree');
    tree.innerHTML = '';

    const fam = familiesData[currentFamilyKey];
    const ancestors = [fam.grandfather, fam.father, fam.grandson];

    document.getElementById('treeTitle').textContent = currentFamilyKey === 'family1' ? 'عائلة: سَيْدِنا محمد إدريس بُقَرْ' : 'عائلة: كُبُرَ زين موسى قيلي أُبِي';

    ancestors.forEach((person, index) => {
        const generation = document.createElement('div');
        generation.className = 'generation';

        const isGrandson = person.role === 'الحفيد';
        const cardClass = 'ancestor' + (isGrandson ? ' grandson' : '');
        const card = createCard(person, cardClass);

        if (isGrandson) {
            card.append(createCountBox(countChildren(fam)));
            card.append(createSiblingCounter(countSiblings()));
        }

        generation.append(card);
        if (index < ancestors.length - 1) generation.append(createConnector());
        tree.append(generation);
    });

    // قسم الزوجات
    const wivesSection = document.createElement('div');
    wivesSection.className = 'generation';
    fam.wives.forEach((wife, i) => wivesSection.append(createWifeSection(wife, i)));
    tree.append(wivesSection);
}

// ==========================================
// إدارة المودال
// ==========================================
const closeModal = () => document.getElementById('bioModal').classList.remove('active');
window.onclick = e => {
    if (e.target.classList.contains('modal')) closeModal();
};

// ==========================================
// إعدادات الدخول
// ==========================================
const PASSWORD = '0055';

function checkLoginStatus() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const lastPassword = localStorage.getItem('loginPassword');
    const timestamp = parseInt(localStorage.getItem('loginTimestamp'), 10);
    const now = Date.now();

    // تسجيل خروج تلقائي بعد 24 ساعة أو تغيير كلمة المرور
    if (isLoggedIn) {
        const hoursPassed = (now - timestamp) / (1000 * 60 * 60);
        if (lastPassword !== PASSWORD || hoursPassed >= 24) {
            // حذف بيانات تسجيل الدخول فقط، مع الاحتفاظ بالنمط المختار والبيانات الأخرى
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('loginPassword');
            localStorage.removeItem('loginTimestamp');
            location.reload();
            return;
        }
    }

    document.getElementById('loginPopup').classList.toggle('active', !isLoggedIn);
    document.getElementById('familyTree').style.display = isLoggedIn ? 'flex' : 'none';
    document.getElementById('logoutBtn').style.display = isLoggedIn ? 'block' : 'none';
}

// ==========================================
// حدث تسجيل الدخول
// ==========================================
document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();

    const input = document.getElementById('passwordInput');
    const message = document.getElementById('loginMessage');

    message.textContent = '';
    input.classList.remove('shake', 'input-error');

    if (!input.value.trim()) {
        message.textContent = 'يرجى إدخال كلمة المرور.';
        input.classList.add('shake', 'input-error');
        clearTimeout(window.errorTimeout);
        window.errorTimeout = setTimeout(() => {
            message.textContent = '';
            input.classList.remove('shake', 'input-error');
        }, 3000);
        return;
    }

    if (input.value === PASSWORD) {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('loginTimestamp', Date.now().toString());
        localStorage.setItem('loginPassword', PASSWORD);
        input.classList.remove('input-error');
        checkLoginStatus();
        drawFamilyTree?.();
    } else {
        message.textContent = 'كلمة المرور غير صحيحة.';
        input.classList.add('shake', 'input-error');
        clearTimeout(window.errorTimeout);
        window.errorTimeout = setTimeout(() => {
            message.textContent = '';
            input.classList.remove('shake', 'input-error');
        }, 3000);
    }
});

// ==========================================
// تسجيل الخروج
// ==========================================
document.getElementById('logoutBtn').addEventListener('click', () => {
    const confirmBox = document.getElementById('confirmLogout');
    const noBtn = document.getElementById('noLogout');
    confirmBox.classList.add('active');
    noBtn.focus();
    noBtn.classList.add('shake');
    noBtn.addEventListener('animationend', () => noBtn.classList.remove('shake'), {
        once: true
    });
});

document.getElementById('yesLogout').addEventListener('click', () => {
    // حذف بيانات تسجيل الدخول فقط، مع الاحتفاظ بالنمط المختار والبيانات الأخرى
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('loginPassword');
    localStorage.removeItem('loginTimestamp');
    location.reload();
});

document.getElementById('noLogout').addEventListener('click', () => {
    document.getElementById('confirmLogout').classList.remove('active');
});

document.getElementById('confirmLogout').addEventListener('click', e => {
    const box = document.querySelector('.confirm-box');
    if (!box.contains(e.target)) {
        document.getElementById('confirmLogout').classList.remove('active');
    }
});

// ==========================================
// التعامل مع زر Enter في إدخال كلمة المرور
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
    // زر تسجيل الدخول
    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    if (loginBtn) {
        loginBtn.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById('loginForm').dispatchEvent(new Event('submit'));
        });
    }

    checkLoginStatus();
    applySavedTheme();
    drawFamilyTree();

    // تفعيل العائلة المختارة
    document.querySelectorAll('.family-button').forEach(btn => {
        btn.classList.toggle('active-family', btn.dataset.family === currentFamilyKey);
    });

    document.getElementById('closeModal')?.addEventListener('click', closeModal);

    // تبديل الثيمات
    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.body.classList.forEach(c => {
                if (c.startsWith('theme-')) document.body.classList.remove(c);
            });

            if (btn.dataset.theme !== 'default') {
                document.body.classList.add(`theme-${btn.dataset.theme}`);
            }

            localStorage.setItem('familyTreeTheme', btn.dataset.theme);
            document.querySelectorAll('.theme-button').forEach(b => b.classList.remove('active-theme'));
            btn.classList.add('active-theme');
            btn.blur();
        });
    });

    // اختيار عائلة
    document.querySelectorAll('.family-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.family-button').forEach(b => b.classList.remove('active-family'));
            btn.classList.add('active-family');
            currentFamilyKey = btn.dataset.family;
            localStorage.setItem('selectedFamily', currentFamilyKey);
            drawFamilyTree();
        });
    });

    // إظهار/إخفاء كلمة المرور
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('passwordInput');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const isHidden = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isHidden ? 'text' : 'password');
            togglePassword.textContent = isHidden ? '🙈' : '👁️';
        });
    }
});

// ==========================================
// تطبيق الثيم المحفوظ
// ==========================================
function applySavedTheme() {
    const theme = localStorage.getItem('familyTreeTheme') || 'default';
    if (theme !== 'default') {
        document.body.classList.add(`theme-${theme}`);
    }

    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.toggle('active-theme', btn.dataset.theme === theme);
    });
}