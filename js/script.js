// بيانات عائلتين
const familiesData = {
  family1: {
    grandfather: {
      name: "إدريس",
      role: "الجد",
      bio: { birthYear: "-", birthPlace: "-", description: "مؤسس العائلة وحامل إرثها العريق", education: "حافظ لكتاب الله" }
    },
    father: {
      name: "محمد",
      role: "الأب",
      bio: { birthYear: "-", birthPlace: "-", description: "قائد العائلة وحامل مسؤولياتها", education: "حافظ لكتاب الله" }
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
        siblingsSisters: [{ name: "رُوا" }, { name: "زينفة" }, { name: "مُرْمَ" }, { name: "جُلّي" }]
        
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
          clan: "كُشى",
      
        },
        children: [
          { name: "آدام", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "أبكر", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مَلْ علي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "مَلْ سِنِّي", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "محمد نور", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "إدريس", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "زهرة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "لُكِي", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
          { name: "فاطمة", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
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
          { name: "أبكر", role: "ابن", bio: { birthYear: "-", birthPlace: "-", remark: "جدي من جهة الأم" } },
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
          { name: "هرْتَ شو", role: "بنت", bio: { birthYear: "-", birthPlace: "-" } },
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
          clan: "بَرِيَ",
        },
        children: [
          { name: "بشير", role: "ابن", bio: { birthYear: "-", birthPlace: "-" } },
        ]
      }
    ]
  },
  family2: {
    grandfather: { name: "علي", role: "الجد", bio: { birthYear: "-", birthPlace: "-", description: "جد العائلة الثانية", education: "حاصل على شهادة الدكتوراه" } },
    father:      { name: "سعيد", role: "الأب", bio: { birthYear: "-", birthPlace: "-", description: "رب الأسرة", education: "حائز على ماجستير" } },
    grandson:    { name: "خالد", role: "الحفيد", bio: { fullName: "خالد سعيد علي", description: "الحفيد", education: "طالب جامعي" } },
    wives: []
  }
};
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

// عرض السيرة
function showDetails(person) {
    const modal = document.getElementById('bioModal');
    document.getElementById('modalName').textContent = person.name;
    document.getElementById('modalRole').textContent = person.role;
    const bio = person.bio;
    let html = bio.description ? `<p class="bio-description">${bio.description}</p>` : '';
    html += `<div class="bio-info">`;
  ['fullName', 'cognomen', 'fatherName', 'motherName', 'tribe', 'clan', 'motherClan', 'birthYear', 'birthPlace', 'occupation'].forEach(field => {
        if (bio[field]) html += `<div class="bio-field"><strong>${getLabel(field)}:</strong><span>${bio[field]}</span></div>`;
    });
    html += `</div><div class="bio-details">`;
    if (bio.remark) html += `<div><h3>ملاحظة:</h3><p>${bio.remark}</p></div>`;
    if (bio.education) html += `<div><h3>التعليم:</h3><p>${bio.education}</p></div>`;
    if (bio.achievements) html += `<div><h3>الإنجازات</h3><ul>${bio.achievements.map(a=>`<li>${a}</li>`).join('')}</ul></div>`;
    if (bio.hobbies) html += `<div><h3>الهوايات</h3><div class="hobbies">${bio.hobbies.map(h=>`<span class="hobby">${h}</span>`).join('')}</div></div>`;
// بعد عرض الإخوة والأخوات
['siblingsBrothers', 'siblingsSisters'].forEach(key => {
  if (bio[key] && Array.isArray(bio[key])) {
    const label = key === 'siblingsBrothers' ? 'الإخوة' : 'الأخوات';
    const count = bio[key].length;
    html += `<div><h3>${label}: <span class="count">(${count})</span></h3>`;
    html += `<ul>${bio[key].map(s => `<li>${s.name}</li>`).join('')}</ul></div>`;
  }
});

// ======== إضافة هذا الجزء لعرض أبناء وبنات الحفيد من كل زوجاته ========
if (person.role === 'الحفيد') {
  const fam = familiesData[currentFamilyKey];
  const allChildren = [];

  // استخراج كل الأبناء من جميع الزوجات
  fam.wives.forEach(wife => {
    if (Array.isArray(wife.children)) {
      wife.children.forEach(child => {
        allChildren.push({ ...child });
      });
    }
  });

  const sons = allChildren.filter(c => c.role === 'ابن');
  const daughters = allChildren.filter(c => c.role === 'بنت');

  if (sons.length || daughters.length) {
    html += `<div class="bio-children">`;

    if (sons.length) {
      html += `<div><h3>الأبناء: <span class="count">(${sons.length})</span></h3><ul>`;
      html += sons.map(s => `<li>${s.name}</li>`).join('');
      html += `</ul></div>`;
    }

    if (daughters.length) {
      html += `<div><h3>البنات: <span class="count">(${daughters.length})</span></h3><ul>`;
      html += daughters.map(d => `<li>${d.name}</li>`).join('');
      html += `</ul></div>`;
    }

    html += `</div>`;
  }
}
    
// عرض الأبناء والبنات إن وجدوا (خاص بالزوجات)
if (person.children && Array.isArray(person.children)) {
    const sons = person.children.filter(c => c.role === 'ابن');
    const daughters = person.children.filter(c => c.role === 'بنت');

    // قسم الأبناء
    html += `<div>`;
    html += `<h3><span class="label">الأبناء:</span> <span class="count">(${sons.length})</span></h3>`;
    if (sons.length) {
        html += `<ul>${sons.map(s => `<li>${s.name}</li>`).join('')}</ul>`;
    }
    html += `</div>`;

    // قسم البنات
    html += `<div>`;
    html += `<h3><span class="label">البنات:</span> <span class="count">(${daughters.length})</span></h3>`;
    if (daughters.length) {
        html += `<ul>${daughters.map(d => `<li>${d.name}</li>`).join('')}</ul>`;
    }
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

// قسم الزوجة
function createVerticalLineBetweenWifeAndChildren() {
    const line = document.createElement('div');
    line.className = 'vertical-line';
    return line;
}

function createWifeSection(wife, index) {
    const sec = Object.assign(document.createElement('div'), {
        className: 'wife-section'
    });

    sec.append(Object.assign(document.createElement('div'), {
        className: 'wife-number',
        textContent: index + 1,
    }));


    // حساب عدد الأبناء والبنات
    const count = wife.children.reduce((acc, c) => {
        if (c.role === 'ابن') acc.sons++;
        else if (c.role === 'بنت') acc.daughters++;
        return acc;
    }, {
        sons: 0,
        daughters: 0
    });

    const total = count.sons + count.daughters;

    // بطاقة الزوجة مع العداد
    const wifeCard = createCard(wife, 'wife');
    const counterBox = document.createElement('div');
    counterBox.className = 'wife-counter';

    const createLine = (label, value) =>
        `<p class="count-item"><span class="count-label">${label}:</span> <span class="count-value">${value}</span></p>`;

    counterBox.innerHTML = [
    createLine('الأبناء', count.sons),
    createLine('البنات', count.daughters),
    createLine('الإجمال', total),
  ].join('');

    wifeCard.append(counterBox);
    sec.append(wifeCard);
    sec.append(createVerticalLineBetweenWifeAndChildren());
    sec.append(createWifeChildrenConnector(wife.children.length));

    const grid = Object.assign(document.createElement('div'), {
        className: 'children-grid'
    });
    wife.children.forEach(ch => {
        const wrapper = Object.assign(document.createElement('div'), {
            className: 'relative'
        });
        wrapper.append(createCard(ch, ch.role === 'ابن' ? 'son' : 'daughter'));
        grid.append(wrapper);
    });

    sec.append(grid);
    return sec;
}


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
    h.style.gridTemplateColumns = `repeat(${count},1fr)`;
    h.style.width = '100%';
    for (let i = 0; i < count; i++) {
        const seg = document.createElement('div');
        seg.className = 'child-connector';
        h.append(seg);
    }
    wrap.append(h);
    return wrap;
}

// العدادات
const countSiblings = () => {
    const b = familiesData[currentFamilyKey].grandson.bio.siblingsBrothers?.length || 0;
    const s = familiesData[currentFamilyKey].grandson.bio.siblingsSisters?.length || 0;
    return {
        brothers: b,
        sisters: s
    };
};

function countChildren(fam) {
    if (!fam.wives || !Array.isArray(fam.wives)) {
        return {
            sons: 0,
            daughters: 0,
            total: 0
        };
    }

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

const createCountBox = ({
    sons,
    daughters,
    total
}) => {
    const b = document.createElement('div');
    b.className = 'countBox';
    b.innerHTML = `<p><span class="label">الأبناء: </span><span class="value">${sons}</span></p><p><span class="label">البنات: </span><span class="value">${daughters}</span></p> <p><span class="label">الإجمال: </span><span class="value">${total}</span></p>`;
    return b;
};
const createSiblingCounter = ({
    brothers,
    sisters
}) => {
    const d = document.createElement('div');
    d.className = 'sibling-counter';
    d.innerHTML = `<p>الإخوة: <strong>${brothers}</strong></p><p>الأخوات: <strong>${sisters}</strong></p>`;
    return d;
};

// رسم الشجرة
function drawFamilyTree() {
    const tree = document.getElementById('familyTree');
    tree.innerHTML = '';
    const fam = familiesData[currentFamilyKey];
    const ancestors = [fam.grandfather, fam.father, fam.grandson];
    document.getElementById('treeTitle').textContent = currentFamilyKey === 'family1' ? 'عائلة: سَيْدِنا محمد إدريس بُقَرْ' : 'عائلة كُبُرَ زين';
    ancestors.forEach((p, i) => {
        const gen = document.createElement('div');
        gen.className = 'generation';
        const cls = 'ancestor' + (p.role === 'الحفيد' ? ' grandson' : '');
        const card = createCard(p, cls);
        if (p.role === 'الحفيد') {
            card.append(createCountBox(countChildren(fam)));
            card.append(createSiblingCounter(countSiblings()));
        }
        gen.append(card);
        if (i < ancestors.length - 1) gen.append(createConnector());
        tree.append(gen);
    });
    const wivesSec = document.createElement('div');
    wivesSec.className = 'generation';
    fam.wives.forEach((w, i) => wivesSec.append(createWifeSection(w, i)));
    tree.append(wivesSec);
}

// إغلاق المودال
const closeModal = () => document.getElementById('bioModal').classList.remove('active');
window.onclick = e => e.target.classList.contains('modal') && closeModal();

const PASSWORD = '0055';

function checkLoginStatus() {
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const lastPassword = localStorage.getItem('loginPassword');
  const timestamp = parseInt(localStorage.getItem('loginTimestamp'), 10);
  const now = Date.now();

  // تسجيل خروج تلقائي إذا تغيّرت كلمة المرور أو مرّت 24 ساعة
  if (isLoggedIn) {
    const hoursPassed = (now - timestamp) / (1000 * 60 * 60);
    if (lastPassword !== PASSWORD || hoursPassed >= 24) {
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('loginTimestamp');
      localStorage.removeItem('loginPassword');
      location.reload();
      return;
    }
  }

  document.getElementById('loginPopup').classList.toggle('active', !isLoggedIn);
  document.getElementById('familyTree').style.display = isLoggedIn ? 'flex' : 'none';
  document.getElementById('logoutBtn').style.display = isLoggedIn ? 'block' : 'none';
}

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
    localStorage.setItem('loginTimestamp', Date.now().toString());  // تخزين وقت الدخول
    localStorage.setItem('loginPassword', PASSWORD);                // تخزين كلمة المرور الحالية
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

// بقية الكود كما هو دون تغيير ...

document.getElementById('logoutBtn').addEventListener('click', () => {
  const confirmLogout = document.getElementById('confirmLogout');
  const noBtn = document.getElementById('noLogout');
  confirmLogout.classList.add('active');
  noBtn.focus();
  noBtn.classList.add('shake');
  noBtn.addEventListener('animationend', () => {
    noBtn.classList.remove('shake');
  }, { once: true });
});

document.getElementById('yesLogout').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('loginTimestamp');
  localStorage.removeItem('loginPassword');
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

document.getElementById('passwordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.querySelector('#loginForm button[type="submit"]');
  if (loginButton) {
    loginButton.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('loginForm').dispatchEvent(new Event('submit'));
    });
  }

  checkLoginStatus();
  applySavedTheme();
  drawFamilyTree();

  // تفعيل الزر المناسب للعائلة المختارة
  document.querySelectorAll('.family-button').forEach(btn => {
    btn.classList.toggle('active-family', btn.dataset.family === currentFamilyKey);
  });

  document.getElementById('closeModal')?.addEventListener('click', closeModal);

  document.querySelectorAll('.theme-button').forEach(btn => btn.addEventListener('click', () => {
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
  }));

  document.querySelectorAll('.family-button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.family-button').forEach(b => b.classList.remove('active-family'));
    btn.classList.add('active-family');
    currentFamilyKey = btn.dataset.family;
    localStorage.setItem('selectedFamily', currentFamilyKey);
    drawFamilyTree();
  }));

  // ✅ إظهار/إخفاء كلمة المرور
  const passwordInput = document.getElementById('passwordInput');
  const togglePassword = document.getElementById('togglePassword');
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }
});

// تطبيق الثيم المحفوظ
function applySavedTheme() {
  const t = localStorage.getItem('familyTreeTheme') || 'default';
  if (t !== 'default') document.body.classList.add(`theme-${t}`);
  document.querySelectorAll('.theme-button').forEach(btn => btn.classList.toggle('active-theme', btn.dataset.theme === t));
}