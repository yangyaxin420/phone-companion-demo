/* ==================== 课表（Excel式网格） + 值班（日期罗列） ==================== */
// 数据存 lsGet('course')。schema='course2'。
// 出厂课表是空的，去课表页自己加。下面是数据结构说明。
// 网格：横=周一~周五，纵=第1~12节单位行；课按 {s..e} 跨行(rowspan)。
// 周数变通：w1..w2 覆盖「前几周/后几周」，parity 单/双/每周；本周不在区间自动不显示。
// 命名：页级渲染入口 renderCourse()（renderSchedule 已被 tasks.js 占用，勿重名）。
const COURSE_WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const COURSE_PARITY_CN = { all: '每周', odd: '单周', even: '双周' };

/* ---- 出厂课表：留空。要预置就照下面的写法填 ---- */
const COURSE_DEFAULT = {
  semesterStart: '',      // 开学那一周的周一，例如 '2026-09-14'
  items: [
    // { day: 1, s: 1, e: 2, name: '课名', room: '教室', w1: 1, w2: 16, parity: 'all' },
  ],
  duties: []
};

// 每周固定值班表：出厂是空的，去课表页自己加
const DUTY_WEEKLY_DEFAULT = [];

let courseData = lsGet('course', null);
let _courseFormParity = 'all';   // 弹窗里当前选中的 每周/单/双
const _coursePalette = [
  { bg: '#e3eef6', bd: '#4a7ba6', fg: '#24496b' },
  { bg: '#e5f1ea', bd: '#3f8f6b', fg: '#2b5a44' },
  { bg: '#f6eee2', bd: '#c98a3c', fg: '#6b4a20' },
  { bg: '#eee8f6', bd: '#8a63b8', fg: '#4f3573' },
  { bg: '#fbe9e2', bd: '#d96a5a', fg: '#8a3528' },
  { bg: '#e4f2f1', bd: '#2f8f9e', fg: '#1c5963' }
];

/* ==================== 工具 ==================== */
function _cPad(n) { return String(n).padStart(2, '0'); }
function _cEsc(s) { return typeof escHtml === 'function' ? escHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
function courseDateKey(d) { return d.getFullYear() + '-' + _cPad(d.getMonth() + 1) + '-' + _cPad(d.getDate()); }
function courseDayNum(d) { const g = d.getDay(); return g === 0 ? 7 : g; }
function courseMonday(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = r.getDay() === 0 ? -6 : 1 - r.getDay();
  r.setDate(r.getDate() + diff); r.setHours(0, 0, 0, 0);
  return r;
}
/* 第 week 周的周一（以开学周一为基准；未设开学日则退回当前周的相对推算） */
function courseWeekMonday(week) {
  const sd = courseData && courseData.semesterStart;
  let base = null;
  if (sd) {
    const p = String(sd).split('-');
    if (p.length === 3) base = courseMonday(new Date(+p[0], +p[1] - 1, +p[2]));
  }
  if (!base) base = courseMonday(new Date());
  const m = new Date(base);
  m.setDate(base.getDate() + ((week || 1) - 1) * 7);
  m.setHours(0, 0, 0, 0);
  return m;
}
function courseWeekNumber(day) {   // 开学日起算的第几周；未开学→0（day 可传，测试用）
  const sd = courseData && courseData.semesterStart;
  if (!sd) return 0;
  const p = String(sd).split('-');
  if (p.length !== 3) return 0;
  const startMs = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  const mon = courseMonday(day || new Date()).getTime();
  const diffDays = Math.floor((mon - startMs) / 86400000);
  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}
function _viewWeek() { const w = courseWeekNumber(); return w < 1 ? 1 : w; }   // 未开学→预览第1周
function courseIsOdd(week) { return week % 2 === 1; }
function courseActiveWeek(it, week) {   // 本周在不在课的周数区间（含单双）
  const w1 = it.w1 || 1, w2 = it.w2 || 16;
  if (week < w1 || week > w2) return false;
  if (it.parity === 'odd') return courseIsOdd(week);
  if (it.parity === 'even') return !courseIsOdd(week);
  return true;
}
function _courseUid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function _dayItems(day, week) {
  return courseData.items.filter(function(it) { return it.day === day && courseActiveWeek(it, week); })
    .sort(function(a, b) { return a.s - b.s; });
}
function _color(name) {
  let h = 0; const n = String(name || '');
  for (let i = 0; i < n.length; i++) h = (h + n.charCodeAt(i)) % 997;
  return _coursePalette[h % _coursePalette.length];
}

/* ==================== 存取 / 初始化默认 ==================== */
function courseSave() { if (courseData) lsSet('course', courseData); }
function courseSeedDefault() {
  courseData = { schema: 'course2', semesterStart: COURSE_DEFAULT.semesterStart, items: [], duties: [], dutyWeekly: [] };
  COURSE_DEFAULT.items.forEach(function(it) {
    courseData.items.push(Object.assign({ id: _courseUid() }, it));
  });
  DUTY_WEEKLY_DEFAULT.forEach(function(w) {
    courseData.dutyWeekly.push(Object.assign({ id: _courseUid() }, w));
  });
  courseSave();
}
function _dutyWeeklyFix(x) {          // 归一化每周值班条目字段
  if (!x) return null;
  x.day = (+x.day >= 1 && +x.day <= 7) ? +x.day : 7;
  x.t0 = String(x.t0 || '17:00').slice(0, 5);
  x.t1 = String(x.t1 || '').slice(0, 5);
  x.loc = String(x.loc || '').trim();
  return x;
}
function courseEnsure() {
  const raw = lsGet('course', null);
  if (raw && raw.schema === 'course2') {                       // 已是新版：修字段即可
    courseData = raw;
    if (!Array.isArray(courseData.items)) courseData.items = [];
    if (!Array.isArray(courseData.duties)) courseData.duties = [];
    let addedWeekly = false;
    if (!Array.isArray(courseData.dutyWeekly)) {               // 老数据补默认每周值班表
      courseData.dutyWeekly = [];
      DUTY_WEEKLY_DEFAULT.forEach(function(w) {
        courseData.dutyWeekly.push(Object.assign({ id: _courseUid() }, w));
      });
      addedWeekly = true;
    }
    courseData.dutyWeekly = courseData.dutyWeekly.map(_dutyWeeklyFix).filter(Boolean);
    if (addedWeekly) courseSave();                             // 默认值班表落盘，避免每次进来重新生成
    if (typeof courseData.semesterStart !== 'string') courseData.semesterStart = COURSE_DEFAULT.semesterStart;
    courseData.items.forEach(function(it) {
      if (!it) return;
      it.day = (+it.day >= 1 && +it.day <= 5) ? +it.day : 1;
      it.s = +it.s || 1; it.e = +it.e || it.s;
      if (it.e < it.s) { const t = it.s; it.s = it.e; it.e = t; }
      it.name = String(it.name || '').trim() || '课程';
      it.room = String(it.room || '').trim();
      it.w1 = +it.w1 || 1; it.w2 = +it.w2 || 16;
      if (it.w2 < it.w1) it.w2 = it.w1;
      it.parity = (it.parity === 'odd' || it.parity === 'even') ? it.parity : 'all';
    });
    return;
  }
  // 旧版(无 schema 或其它) → 备份后内置新默认
  if (raw) lsSet('course_v1_backup', raw);
  courseSeedDefault();
  if (typeof addChatSystem === 'function') addChatSystem('📚 已按你的 PDF 排好本学期课表（可进课表页改动）');
}

/* ==================== 页面渲染 ==================== */
function renderCourse() {
  try {
    if (!courseData) courseEnsure();
    const page = document.getElementById('page-course');
    if (!page) return;
    // 顶部：今日 + 第几周
    const now = new Date();
    const w = courseWeekNumber(now);
    const infoEl = document.getElementById('courseWeekInfo');
    if (infoEl) {
      infoEl.innerHTML = COURSE_WEEK_CN[courseDayNum(now) - 1] + ' · ' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    }
    const sdEl = document.getElementById('courseStartDate');
    if (sdEl && sdEl.value !== (courseData.semesterStart || '')) sdEl.value = courseData.semesterStart || '';
    const badge = document.getElementById('courseWeekBadge');
    if (badge) {
      if (w < 1) badge.innerHTML = '未开学 · <b>预览第1周</b>（' + (courseData.semesterStart || '?') + ' 开学）';
      else badge.innerHTML = '第 <b>' + w + '</b> 周 · ' + (courseIsOdd(w) ? '单周' : '双周');
    }
    courseRenderGrid(w < 1 ? 1 : w);
    courseRenderDuty();
  } catch (e) { console.error('renderCourse', e); }
}

/* 网格：行=第1~12节，列=周一~周五；课从第s节 rowspan 到第e节 */
function courseRenderGrid(week) {
  const el = document.getElementById('courseGrid');
  if (!el) return;
  const now = new Date();
  const mon = courseWeekMonday(week);          // 正在查看那一周的周一（不是当前周）
  const curWeek = courseWeekNumber(now);       // 0 = 未开学
  const isViewingThisWeek = (week === curWeek); // 只有看本周才高亮"今天"
  const today = isViewingThisWeek ? courseDayNum(now) : 0;
  const byDay = [null, [], [], [], [], []];      // 1..5
  courseData.items.forEach(function(it) { if (it.day >= 1 && it.day <= 5 && courseActiveWeek(it, week)) byDay[it.day].push(it); });
  for (let d = 1; d <= 5; d++) byDay[d].sort(function(a, b) { return a.s - b.s; });

  let h = '<table class="course-t"><colgroup><col style="width:42px"><col><col><col><col><col></colgroup><thead><tr><th class="course-dl"></th>';
  for (let d = 1; d <= 5; d++) {
    const dd = new Date(mon); dd.setDate(mon.getDate() + d - 1);
    const on = d === today;
    h += '<th class="course-dh' + (on ? ' on' : '') + '">' + COURSE_WEEK_CN[d - 1] +
      '<span>' + (dd.getMonth() + 1) + '/' + dd.getDate() + '</span></th>';
  }
  h += '</tr></thead><tbody>';

  const idx = [0, 0, 0, 0, 0, 0];                 // 每天读到第几条
  for (let p = 1; p <= 12; p++) {
    let cells = '<td class="course-pl">第' + p + '节</td>';
    for (let d = 1; d <= 5; d++) {
      const arr = byDay[d];
      const prev = idx[d] > 0 ? arr[idx[d] - 1] : null;   // 上一个已开始跨行的课
      const it = arr[idx[d]];
      if (it && p === it.s) { cells += courseBlockTd(it); idx[d]++; }
      else if (prev && p > prev.s && p <= prev.e) { /* 被 prev 的 rowspan 覆盖，本行不放格 */ }
      else cells += '<td class="course-open' + (d === today ? ' ctd' : '') + '" onclick="openCourseAdd(' + d + ',' + p + ')"></td>';
    }
    h += '<tr>' + cells + '</tr>';
  }
  h += '</tbody></table>';
  el.innerHTML = h;
}
function courseBlockTd(it) {
  const c = _color(it.name);
  const span = (it.e - it.s + 1);
  const sub = it.e > it.s ? '<div class="course-cs">' + it.s + '-' + it.e + '节</div>' : '';
  const rm = it.room ? '<div class="course-cr">' + _cEsc(it.room) + '</div>' : '';
  return '<td rowspan="' + span + '" class="course-block" onclick="openCourseEdit(\'' + it.id + '\')" style="background:' + c.bg + ';border-left:3px solid ' + c.bd + ';color:' + c.fg + ';">' +
    '<div class="course-cn">' + _cEsc(it.name) + '</div>' + sub + rm + '</td>';
}

/* 值班渲染：每周固定表（周一到周日，今天高亮/值班中/下次）+ 偶尔临时（按日期） */
function _cHhMm(v) { const p = String(v || '0:0').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
function courseDutyStatus(row, now) {   // 返回 { cls, tag } 之一
  const today = courseDayNum(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const t0 = _cHhMm(row.t0), t1 = row.t1 ? _cHhMm(row.t1) : t0 + 60;
  if (row.day === today) {
    if (nowMin >= t0 && nowMin <= t1) return { cls: ' duty-live', tag: '值班中' };
    if (nowMin < t0) return { cls: ' duty-today', tag: '今天 ' + (row.t0 || '') };
  }
  return { cls: '', tag: '' };
}
function _nextDutyWeekMin(rows, now) {   // 下一个未开始的班是哪个（跨周也算），返回 row 或 null
  const nowKey = (courseDayNum(now) - 1) * 1440 + now.getHours() * 60 + now.getMinutes();
  let best = null, bestKey = Infinity;
  rows.forEach(function(r) {
    let k = (r.day - 1) * 1440 + _cHhMm(r.t0);
    if (k <= nowKey) k += 7 * 1440;
    if (k < bestKey) { bestKey = k; best = r; }
  });
  return best;
}
function courseRenderDuty() {
  const el = document.getElementById('courseDutyList');
  const oEl = document.getElementById('courseOneoffList');
  const now = new Date();
  const wk = (courseData.dutyWeekly || []).slice();
  if (el) {
    if (!wk.length) {
      el.innerHTML = '<div style="font-size:12px;color:#c6d6df;text-align:center;padding:16px 0;">还没有固定值班班次<br><span style="font-size:11px;">点「➕ 加时段」排好每周班，他每周到点前提醒你</span></div>';
    } else {
      wk.sort(function(a, b) { return (a.day - b.day) || (_cHhMm(a.t0) - _cHhMm(b.t0)); });
      const next = _nextDutyWeekMin(wk, now);
      el.innerHTML = wk.map(function(x) {
        const st = courseDutyStatus(x, now);
        const tag = st.tag || (x === next ? '下次' : '');
        const main = (x.loc ? x.loc : '值班');
        return '<div class="duty-row' + st.cls + '" onclick="openDutyEdit(\'' + x.id + '\')">' +
          '<div class="duty-d">' + COURSE_WEEK_CN[x.day - 1] +
          '<span class="duty-t">' + (x.t0 || '') + (x.t1 ? '–' + x.t1 : '') + '</span></div>' +
          '<div class="duty-m">' + _cEsc(main) + (tag ? '<span class="duty-tag">' + tag + '</span>' : '') + '</div>' +
          '<button onclick="event.stopPropagation();deleteWeeklyDuty(\'' + x.id + '\')" class="duty-x">✕</button></div>';
      }).join('');
    }
  }
  if (oEl) {
    const od = (courseData.duties || []).slice();
    od.sort(function(a, b) { return (a.date < b.date) ? -1 : (a.date > b.date ? 1 : (a.t0 < b.t0 ? -1 : 1)); });
    const tk = courseDateKey(now);
    oEl.innerHTML = od.length
      ? od.map(function(x) {
          const past = x.date < tk;
          const today = x.date === tk;
          const dm = String(x.date).split('-');
          const dt = dm.length === 3 ? new Date(+dm[0], +dm[1] - 1, +dm[2]) : null;
          const dow = dt ? COURSE_WEEK_CN[courseDayNum(dt) - 1] : '';
          const main = (x.name ? x.name : '值班') + (x.loc ? ' · ' + x.loc : '');
          return '<div class="duty-row' + (today ? ' duty-today' : '') + (past ? ' duty-past' : '') + '" onclick="openOneoffEdit(\'' + x.id + '\')">' +
            '<div class="duty-d">' + (+dm[1]) + '月' + (+dm[2]) + '日 ' + dow +
            '<span class="duty-t">' + (x.t0 || '') + (x.t1 ? '–' + x.t1 : '') + '</span></div>' +
            '<div class="duty-m">' + _cEsc(main) + '</div>' +
            '<button onclick="event.stopPropagation();deleteDuty(\'' + x.id + '\')" class="duty-x">✕</button></div>';
        }).join('')
      : '<div style="font-size:11px;color:#c6d6df;text-align:center;padding:8px 0;">没有单次安排</div>';
  }
}

/* ==================== 课程增删改（点格弹窗） ==================== */
function openCourseAdd(day, p) {
  const m = document.getElementById('courseModal');
  if (!m) return;
  document.getElementById('courseModalTitle').textContent = '➕ 加课';
  document.getElementById('courseFormId').value = '';
  document.getElementById('courseFormDay').value = String(day || 1);
  document.getElementById('courseFormS').value = String(p || 1);
  document.getElementById('courseFormE').value = String(Math.min((p || 1) + 1, 12));
  document.getElementById('courseFormName').value = '';
  document.getElementById('courseFormRoom').value = '';
  document.getElementById('courseFormW1').value = '1';
  document.getElementById('courseFormW2').value = '16';
  setCourseParityForm('all');
  const del = document.getElementById('courseFormDel');
  if (del) del.style.display = 'none';
  m.style.display = 'flex';
}
function openCourseEdit(id) {
  const it = (courseData.items || []).find(function(x) { return x.id === id; });
  if (!it) return;
  const m = document.getElementById('courseModal');
  if (!m) return;
  document.getElementById('courseModalTitle').textContent = '✎ 编辑';
  document.getElementById('courseFormId').value = id;
  document.getElementById('courseFormDay').value = String(it.day);
  document.getElementById('courseFormS').value = String(it.s);
  document.getElementById('courseFormE').value = String(it.e);
  document.getElementById('courseFormName').value = it.name;
  document.getElementById('courseFormRoom').value = it.room || '';
  document.getElementById('courseFormW1').value = String(it.w1);
  document.getElementById('courseFormW2').value = String(it.w2);
  setCourseParityForm(it.parity || 'all');
  const del = document.getElementById('courseFormDel');
  if (del) del.style.display = 'inline-block';
  m.style.display = 'flex';
}
function courseFormCancel() { const m = document.getElementById('courseModal'); if (m) m.style.display = 'none'; }
function courseFormDelete() {
  const id = document.getElementById('courseFormId').value;
  if (!id || !confirm('删掉这门课吗？')) return;
  courseData.items = courseData.items.filter(function(x) { return x.id !== id; });
  courseSave(); courseFormCancel(); renderCourse();
}
function setCourseParityForm(k) {
  _courseFormParity = (k === 'odd' || k === 'even') ? k : 'all';
  ['all', 'odd', 'even'].forEach(function(v) {
    const el = document.getElementById('courseFormParity_' + v);
    if (!el) return;
    const on = v === _courseFormParity;
    el.className = 'course-seg' + (on ? ' on' : '');
    el.style.color = on ? (v === 'odd' ? '#2c5a78' : v === 'even' ? '#2c5a78' : '#2c5a78') : '#6f94ab';
  });
}
function courseFormTerm() {   // 快捷：整学期（1-16周，每周）
  const w1 = document.getElementById('courseFormW1');
  const w2 = document.getElementById('courseFormW2');
  if (w1) w1.value = '1';
  if (w2) w2.value = '16';
  setCourseParityForm('all');
}
function courseFormSave() {
  try {
    const id = document.getElementById('courseFormId').value;
    const name = (document.getElementById('courseFormName').value || '').trim();
    const day = +document.getElementById('courseFormDay').value || 1;
    const s = +document.getElementById('courseFormS').value || 1;
    let e = +document.getElementById('courseFormE').value || s;
    if (!name) { alert('给这门课起个名吧～'); return; }
    if (e < s) e = s;
    let w1 = parseInt(document.getElementById('courseFormW1').value, 10);
    let w2 = parseInt(document.getElementById('courseFormW2').value, 10);
    if (isNaN(w1) || w1 < 1) w1 = 1;
    if (isNaN(w2) || w2 < 1) w2 = w1;
    if (w2 < w1) w2 = w1;
    const obj = {
      day: day, s: s, e: e,
      name: name, room: (document.getElementById('courseFormRoom').value || '').trim(),
      w1: w1, w2: w2, parity: _courseFormParity
    };
    if (id) {
      const i = courseData.items.findIndex(function(x) { return x.id === id; });
      if (i >= 0) courseData.items[i] = Object.assign({}, courseData.items[i], obj);
    } else { obj.id = _courseUid(); courseData.items.push(obj); }
    courseSave(); courseFormCancel(); renderCourse();
  } catch (e) { console.error('courseFormSave', e); }
}

/* 开学时间（唯一保留设置） */
function courseSetStart(v) {
  if (!courseData) courseEnsure();
  courseData.semesterStart = v || '';
  courseSave(); renderCourse();
  if (v) addChatSystem('📅 开学第1周周一已设为 ' + v);
}

/* ==================== 每周固定值班增删（周几+钟点+楼层，每周循环） ==================== */
function dutyFormFill(x) {
  document.getElementById('dutyFormId').value = x.id || '';
  document.getElementById('dutyFormDay').value = String(x.day || 7);
  document.getElementById('dutyFormT0').value = x.t0 || '17:00';
  document.getElementById('dutyFormT1').value = x.t1 || '';
  document.getElementById('dutyFormName').value = x.name || '';
  document.getElementById('dutyFormLoc').value = x.loc || '';
  const del = document.getElementById('dutyFormDel');
  if (del) del.style.display = x.id ? 'inline-block' : 'none';
}
function openDutyAdd() {
  const m = document.getElementById('dutyModal');
  if (!m) return;
  const now = new Date();
  dutyFormFill({ id: '', day: courseDayNum(now), t0: '17:00', t1: '18:30', name: '', loc: '' });
  m.style.display = 'flex';
}
function openDutyEdit(id) {
  const x = (courseData.dutyWeekly || []).find(function(r) { return r.id === id; });
  if (!x) return;
  const m = document.getElementById('dutyModal');
  if (!m) return;
  dutyFormFill(x);
  m.style.display = 'flex';
}
function dutyFormCancel() { const m = document.getElementById('dutyModal'); if (m) m.style.display = 'none'; }
function dutyFormDelete() {
  const id = document.getElementById('dutyFormId').value;
  if (!id || !confirm('删掉这班固定值班吗？')) return;
  courseData.dutyWeekly = courseData.dutyWeekly.filter(function(x) { return x.id !== id; });
  courseSave(); dutyFormCancel(); renderCourse();
}
function deleteWeeklyDuty(id) {
  if (!confirm('删掉这班固定值班吗？')) return;
  courseData.dutyWeekly = courseData.dutyWeekly.filter(function(x) { return x.id !== id; });
  courseSave(); renderCourse();
}
function dutyFormSave() {
  try {
    const id = document.getElementById('dutyFormId').value;
    const day = +document.getElementById('dutyFormDay').value || 7;
    const t0 = document.getElementById('dutyFormT0').value;
    if (!t0) { alert('填个开始时间吧'); return; }
    const obj = {
      day: day, t0: t0, t1: document.getElementById('dutyFormT1').value,
      name: (document.getElementById('dutyFormName').value || '').trim(),
      loc: (document.getElementById('dutyFormLoc').value || '').trim()
    };
    if (!obj.loc && !obj.name) { alert('填个地点（如：四楼）吧，他才知道去哪提醒'); return; }
    if (id) {
      const i = courseData.dutyWeekly.findIndex(function(x) { return x.id === id; });
      if (i >= 0) courseData.dutyWeekly[i] = Object.assign({}, courseData.dutyWeekly[i], obj);
    } else { obj.id = _courseUid(); courseData.dutyWeekly.push(obj); }
    courseSave(); dutyFormCancel(); renderCourse();
    addChatSystem('🗓 每周' + COURSE_WEEK_CN[day - 1] + (obj.t1 ? ' ' + obj.t0 + '–' + obj.t1 : ' ' + obj.t0) + ' @' + obj.loc + ' 已记，到点前提醒你');
  } catch (e) { console.error('dutyFormSave', e); }
}

/* ==================== 偶尔一次性值班（具体日期，临时换班用） ==================== */
function openOneoffAdd() {
  const m = document.getElementById('oneoffModal');
  if (!m) return;
  document.getElementById('oneoffFormId').value = '';
  document.getElementById('oneoffFormDate').value = courseDateKey(new Date());
  document.getElementById('oneoffFormT0').value = '17:00';
  document.getElementById('oneoffFormT1').value = '18:30';
  document.getElementById('oneoffFormName').value = '';
  document.getElementById('oneoffFormLoc').value = '';
  const del = document.getElementById('oneoffFormDel');
  if (del) del.style.display = 'none';
  m.style.display = 'flex';
}
function openOneoffEdit(id) {
  const x = (courseData.duties || []).find(function(r) { return r.id === id; });
  if (!x) return;
  const m = document.getElementById('oneoffModal');
  if (!m) return;
  document.getElementById('oneoffFormId').value = id;
  document.getElementById('oneoffFormDate').value = x.date || '';
  document.getElementById('oneoffFormT0').value = x.t0 || '';
  document.getElementById('oneoffFormT1').value = x.t1 || '';
  document.getElementById('oneoffFormName').value = x.name || '';
  document.getElementById('oneoffFormLoc').value = x.loc || '';
  const del = document.getElementById('oneoffFormDel');
  if (del) del.style.display = 'inline-block';
  m.style.display = 'flex';
}
function oneoffFormCancel() { const m = document.getElementById('oneoffModal'); if (m) m.style.display = 'none'; }
function deleteDuty(id) {
  if (!confirm('删掉这次值班吗？')) return;
  courseData.duties = courseData.duties.filter(function(x) { return x.id !== id; });
  courseSave(); renderCourse();
}
function oneoffFormDelete() {
  const id = document.getElementById('oneoffFormId').value;
  if (!id || !confirm('删掉这次值班吗？')) return;
  courseData.duties = courseData.duties.filter(function(x) { return x.id !== id; });
  courseSave(); oneoffFormCancel(); renderCourse();
}
function oneoffFormSave() {
  try {
    const id = document.getElementById('oneoffFormId').value;
    const date = document.getElementById('oneoffFormDate').value;
    if (!date) { alert('选个日期吧'); return; }
    const obj = {
      date: date,
      t0: document.getElementById('oneoffFormT0').value || '00:00',
      t1: document.getElementById('oneoffFormT1').value,
      name: (document.getElementById('oneoffFormName').value || '').trim(),
      loc: (document.getElementById('oneoffFormLoc').value || '').trim()
    };
    if (id) {
      const i = courseData.duties.findIndex(function(x) { return x.id === id; });
      if (i >= 0) courseData.duties[i] = Object.assign({}, courseData.duties[i], obj);
    } else { obj.id = _courseUid(); courseData.duties.push(obj); }
    courseSave(); oneoffFormCancel(); renderCourse();
  } catch (e) { console.error('oneoffFormSave', e); }
}

/* ==================== AI 感知：他看得到今天的课/值班 ==================== */
function buildScheduleContext() {
  try {
    if (!courseData || (!courseData.items.length &&
        !(courseData.dutyWeekly && courseData.dutyWeekly.length) &&
        !(courseData.duties && courseData.duties.length))) return '';
    const now = new Date();
    const week = courseWeekNumber(now);
    const day = courseDayNum(now);
    const line = '【课表感应】今天是' + COURSE_WEEK_CN[day - 1] +
      (week < 1 ? '（还没开学）' : '，本学期第' + week + '周(' + (courseIsOdd(week) ? '单周' : '双周') + ')') + '。';
    const today = courseData.items.filter(function(it) { return it.day === day && courseActiveWeek(it, week < 1 ? 1 : week); })
      .sort(function(a, b) { return a.s - b.s; });
    let out = line;
    if (today.length) {
      out += '她今天有' + today.length + '门：' + today.map(function(it) {
        return '第' + it.s + (it.e > it.s ? '-' + it.e : '') + '节 ' + it.name + (it.room ? '@' + it.room : '');
      }).join('；') + '。';
    } else {
      out += '她今天没课。';
    }
    const tk = courseDateKey(now);
    const dutyStrs = [];
    (courseData.dutyWeekly || []).forEach(function(w) { if (w.day === day) dutyStrs.push((w.name || '值班') + (w.loc ? '@' + w.loc : '') + ' ' + (w.t0 || '') + (w.t1 ? '-' + w.t1 : '')); });
    (courseData.duties || []).forEach(function(x) { if (x.date === tk) dutyStrs.push((x.name || '值班') + (x.loc ? '@' + x.loc : '') + ' ' + (x.t0 || '') + (x.t1 ? '-' + x.t1 : '')); });
    if (dutyStrs.length) out += '她今天要值班：' + dutyStrs.join('；') + '。';
    out += '\n用法：这是"看见"——她聊到上课/值班/约饭/时间时自然接话；别死板复读，别每句都提课表。';
    return out;
  } catch (e) { console.error('buildScheduleContext', e); return ''; }
}

/* 值班准点前提醒（他说一句）；每周固定班(星期匹配) + 偶尔一次性(日期匹配)；课表无钟点则不做上课提醒 */
function courseCheckReminders() {
  try {
    if (!courseData) return;
    if (!settings || settings.proactiveMsg === false) return;
    if (settings.scheduleRemind === false) return;
    const now = new Date();
    const tk = courseDateKey(now);
    const today = courseDayNum(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inChat = typeof currentPage !== 'undefined' && currentPage === 'page-chat' &&
      typeof lastUserMsgTime === 'number' && now.getTime() - lastUserMsgTime < 5 * 60000;

    const cands = [];
    (courseData.dutyWeekly || []).forEach(function(x) {
      if (x.day === today && x.t0) cands.push({ id: x.id, weekly: true, t0: x.t0, t1: x.t1, name: x.name, loc: x.loc });
    });
    (courseData.duties || []).forEach(function(x) {
      if (x.date === tk && x.t0) cands.push({ id: x.id, weekly: false, t0: x.t0, t1: x.t1, name: x.name, loc: x.loc });
    });
    if (!cands.length) return;
    cands.sort(function(a, b) { return _cHhMm(a.t0) - _cHhMm(b.t0); });

    const doRemind = function(x, diff) {
      const key = (x.weekly ? 'wkNotified_' : 'otNotified_') + x.id + '_' + tk;
      if (lsGet(key, false)) return;
      if (inChat) { lsSet(key, true); return; }   // 正在聊不插话，但也不重复
      const char = (typeof getCharById === 'function' && typeof currentCharId !== 'undefined') ? getCharById(currentCharId) : null;
      if (!char || typeof generateProactiveMessage !== 'function') { lsSet(key, true); return; }
      const story = (char.story || '').toLowerCase();
      const isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
      const isG = /温柔|温暖|亲切|可爱|软/.test(story);
      generateProactiveMessage('class', char, isT, isG, { item: { type: 'duty', name: x.name || '值班', start: x.t0, end: x.t1, loc: x.loc }, min: Math.ceil(diff) });
      lsSet(key, true);
    };

    for (let i = 0; i < cands.length; i++) {
      const diff = _cHhMm(cands[i].t0) - nowMin;
      if (diff <= 0 || diff > 15) continue;
      doRemind(cands[i], diff);
      return;   // 每次只提醒最近一项
    }
  } catch (e) { console.error('courseCheckReminders', e); }
}

/* ==================== 主页「今日课表+值班」widget ==================== */
// 自动更新：切天/值班进行中/回到主页都由 initCourse 的轮询+可见性+app.js 跳转钩子触发
function renderTodaySchedule() {
  try {
    const el = document.getElementById('todayScheduleCard');
    if (!el) return;
    if (!courseData) courseEnsure();
    const now = new Date();
    const day = courseDayNum(now);
    const week = courseWeekNumber(now);
    const open = week >= 1;
    const tk = courseDateKey(now);
    const mon = courseMonday(now);
    const dd = new Date(mon); dd.setDate(mon.getDate() + day - 1);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowKey = (day - 1) * 1440 + nowMin;

    // 今天课程（未开学只显示开学倒数）
    const classes = [];
    if (open) {
      (courseData.items || []).forEach(function(it) { if (it.day === day && courseActiveWeek(it, week)) classes.push(it); });
      classes.sort(function(a, b) { return a.s - b.s; });
    }
    // 今天值班：每周固定(星期匹配) + 一次性(日期匹配)
    const shifts = [];
    (courseData.dutyWeekly || []).forEach(function(w) { if (w.day === day) shifts.push({ t0: w.t0, t1: w.t1, loc: w.loc, name: w.name }); });
    (courseData.duties || []).forEach(function(x) { if (x.date === tk) shifts.push({ t0: x.t0, t1: x.t1, loc: x.loc, name: x.name }); });
    shifts.sort(function(a, b) { return _cHhMm(a.t0) - _cHhMm(b.t0); });

    let h = '<div class="today-top"><span class="today-title">📅 今天 · ' + COURSE_WEEK_CN[day - 1] + '</span>' +
      '<span class="today-sub">' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日' + (open ? ' · 第' + week + '周 ' + (courseIsOdd(week) ? '单' : '双') : ' · 还没开学') + '</span></div>';

    // 课
    if (classes.length) {
      h += '<div class="today-block"><div class="today-block-t">📖 课</div>' + classes.map(function(it) {
        return '<div class="today-row"><span class="t-badge">' + it.s + (it.e > it.s ? '-' + it.e : '') + '节</span><span>' + _cEsc(it.name) + '</span>' + (it.room ? '<span class="t-loc">' + _cEsc(it.room) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    } else if (!open) {
      h += '<div class="today-empty">' + (courseData.semesterStart ? '离 ' + courseData.semesterStart + ' 开学，先歇着～' : '还没排课表') + '</div>';
    } else {
      h += '<div class="today-empty">今天没课，好好歇着</div>';
    }

    // 值班
    if (shifts.length) {
      h += '<div class="today-block duty-block"><div class="today-block-t">🗓 值班</div>' + shifts.map(function(s) {
        const live = nowMin >= _cHhMm(s.t0) && nowMin <= (s.t1 ? _cHhMm(s.t1) : _cHhMm(s.t0) + 60);
        return '<div class="today-row duty"><span class="t-badge">' + (s.t0 || '') + (s.t1 ? '-' + s.t1 : '') + '</span><span>' + _cEsc(s.name || '值班') + '</span>' +
          (s.loc ? '<span class="t-loc">' + _cEsc(s.loc) + '</span>' : '') +
          (live ? '<span class="today-now-tag">进行中</span>' : '') + '</div>';
      }).join('') + '</div>';
    }

    // 最近一班（未来 7 天内的固定班/单次，取最近）
    let best = null;
    for (let od = 0; od <= 6; od++) {
      const wd = ((day - 1 + od) % 7) + 1;
      const dk = courseDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + od));
      (courseData.dutyWeekly || []).forEach(function(r) {
        if (r.day !== wd) return;
        const k = od * 1440 + _cHhMm(r.t0);
        if (k <= nowKey) return;
        if (!best || k < best.k) best = { k: k, off: od, wd: wd, t0: r.t0, t1: r.t1, loc: r.loc };
      });
      (courseData.duties || []).forEach(function(x) {
        if (x.date !== dk) return;
        const k = od * 1440 + _cHhMm(x.t0);
        if (k <= nowKey) return;
        if (!best || k < best.k) best = { k: k, off: od, wd: wd, t0: x.t0, t1: x.t1, loc: x.loc };
      });
    }
    if (best) {
      const when = best.off === 0 ? '今天' : COURSE_WEEK_CN[best.wd - 1];
      h += '<div class="today-next">下一班：' + when + ' ' + (best.t0 || '') + (best.t1 ? '-' + best.t1 : '') + (best.loc ? ' · ' + _cEsc(best.loc) : '') + '</div>';
    }

    el.innerHTML = h;
    el.style.display = 'block';
  } catch (e) { console.error('renderTodaySchedule', e); }
}

/* ==================== 初始化 ==================== */
function initCourse() {
  try {
    courseEnsure();
    renderCourse();
    renderTodaySchedule();
    setInterval(function() {
      // 课表页可见才整表重绘（避免打断滚动）；主页「今日」组件与提醒照常刷新
      if (!document.hidden && typeof currentPage !== 'undefined' && currentPage === 'page-course') renderCourse();
      if (typeof renderTodaySchedule === 'function') renderTodaySchedule();
      if (typeof courseCheckReminders === 'function') courseCheckReminders();
    }, 60000);
    setTimeout(function() {
      if (typeof renderTodaySchedule === 'function') renderTodaySchedule();
      if (typeof courseCheckReminders === 'function') courseCheckReminders();
    }, 30000);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        renderCourse();
        if (typeof renderTodaySchedule === 'function') renderTodaySchedule();
        if (typeof courseCheckReminders === 'function') courseCheckReminders();
      }
    });
  } catch (e) {
    console.error('initCourse', e);
    if (typeof addChatSystem === 'function') addChatSystem('⚠️ 课表初始化报错：' + (e && e.message || e));
  }
}
