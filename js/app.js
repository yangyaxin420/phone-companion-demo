/* ==================== 0. 常量 & 图标定义 ==================== */
const ICONS = [
  { id:'chat',     symbol:'▷', name:'聊天',  page:'page-conv-list' },
  { id:'daily',    symbol:'📋', name:'日报',  page:'page-daily' },
  { id:'track',    symbol:'🧭', name:'足迹',  page:'page-track' },
  { id:'tasks',    symbol:'☑', name:'任务',  page:'page-tasks' },
  { id:'course',   symbol:'📚', name:'课表',  page:'page-course' },
  { id:'companion',symbol:'⟳', name:'专注',  page:'page-companion' },
  { id:'moments',  symbol:'○', name:'朋友圈',page:'page-moments' },
  { id:'secret',   symbol:'◎', name:'Secret',page:'page-secret' },
  { id:'expense',  symbol:'￥', name:'记账',  page:'page-expense' },
  { id:'tide',     symbol:'☽', name:'潮汐',  page:'page-tide' },
  { id:'heart',    symbol:'💓', name:'心跳',  page:'page-heart' },
  { id:'sleep',    symbol:'💤', name:'睡眠',  page:'page-sleep' },
  { id:'persona',  symbol:'≡', name:'人设',  page:'page-persona' },
  { id:'settings', symbol:'⚙', name:'设置',  page:'page-settings' }
];

const COMPANION_ACTIVITIES = [
  { emoji:'😴', name:'睡觉' },
  { emoji:'🍚', name:'吃饭' },
  { emoji:'📚', name:'学习' },
  { emoji:'💪', name:'锻炼' },
  { emoji:'💼', name:'上班' },
  { emoji:'🚶', name:'散步' }
];
let customActivities = lsGet('customActs', []);

/* ==================== 1. 状态管理 ==================== */
let currentPage = 'page-main';
let currentMainScreen = 1;
let pageHistory = [];
let compState = { activity:null, running:false, seconds:0, interval:null, remindMin:0,
  mode:'countup', targetMinutes:25, taskName:'', aiBubbles:[], ringtoneName:'默认铃声', ringtoneData:null };

/* ==================== 3. 导航系统 ==================== */
const allPages = document.querySelectorAll('.page');

window.addEventListener("error", function(e) {
  var errEl = document.createElement("div");
  errEl.style.cssText = "position:fixed;top:0;left:0;width:100%;padding:16px;background:#e55;color:#fff;font-size:13px;z-index:9999;word-break:break-all;";
  errEl.textContent = "❌ " + (e.message || e.error?.message || "未知错误");
  document.body.prepend(errEl);
});

function navigateTo(pageId, skipAnim) {
  if (pageId === currentPage) return;
  const oldEl = document.getElementById(currentPage);
  const newEl = document.getElementById(pageId);
  if (!oldEl || !newEl) return;
  pageHistory.push(currentPage);
  if (skipAnim) {
    oldEl.classList.remove('active');
    newEl.classList.add('active');
  } else {
    oldEl.classList.add('anim-out-left');
    newEl.classList.add('active','anim-in-right');
    setTimeout(() => {
      oldEl.classList.remove('active','anim-out-left');
      newEl.classList.remove('anim-in-right');
    }, 300);
  }
  currentPage = pageId;

  // 页面显示回调
  if (pageId === 'page-comp-records') renderCompRecords();
  if (pageId === 'page-companion') renderCompanionActs();
  if (pageId === 'page-conv-list') renderConvList();
  if (pageId === 'page-secret') showSecretDesk();
  if (pageId === 'page-daily') showDaily();
  if (pageId === 'page-track' && typeof showTrackPage === 'function') showTrackPage();
  if (pageId === 'page-expense') renderExpenseCats();
  if (pageId === 'page-persona') loadUserPersona();
  if (pageId === 'page-settings') loadSettings();
  if (pageId === 'page-moments' && typeof renderMoments === 'function') renderMoments();
  if (pageId === 'page-sleep' && typeof renderSleep === 'function') renderSleep();
  if (pageId === 'page-course' && typeof renderCourse === 'function') renderCourse();
  if (pageId === 'page-main' && typeof renderTodaySchedule === 'function') renderTodaySchedule();
  const emojiPanel = document.getElementById('emojiPanel');
  if (emojiPanel) emojiPanel.classList.remove('show');
  updateNav();
}

function goBack() {
  if (pageHistory.length === 0) return;
  const oldEl = document.getElementById(currentPage);
  const prevId = pageHistory.pop();
  const newEl = document.getElementById(prevId);
  oldEl.classList.add('anim-out-right');
  newEl.classList.add('active','anim-in-left');
  setTimeout(() => {
    oldEl.classList.remove('active','anim-out-right');
    newEl.classList.remove('anim-in-left');
  }, 300);
  currentPage = prevId;
  updateNav();
}

function goHome() {
  if (currentPage === 'page-main') return;
  const oldEl = document.getElementById(currentPage);
  const newEl = document.getElementById('page-main');
  pageHistory = [];
  oldEl.classList.add('anim-out-right');
  newEl.classList.add('active','anim-in-left');
  setTimeout(() => {
    oldEl.classList.remove('active','anim-out-right');
    newEl.classList.remove('anim-in-left');
  }, 300);
  currentPage = 'page-main';
  if (typeof renderTodaySchedule === 'function') renderTodaySchedule();
  updateNav();
}

function updateNav() {
  const nl = document.getElementById('navLeft');
  const nr = document.getElementById('navRight');
  if (currentPage === 'page-main') {
    nl.className = 'nav-enabled';
    nr.className = 'nav-enabled';
  } else {
    nl.className = 'nav-enabled';
    nr.className = 'nav-disabled';
  }
}

function updateChatContext() {
  const summary = document.getElementById('chatContextSummary');
  const detail = document.getElementById('chatContextDetail');
  const tags = [];
  const details = [];

  if (weatherData && Date.now() - weatherData.time < 3600000) {
    tags.push(`🌡${weatherData.temp}°`);
    details.push(`天气：${weatherData.desc}，${weatherData.temp}°C，湿度${weatherData.humidity}%`);
  }
  const undone = tasks.filter(t => !t.done).length;
  if (undone > 0) { tags.push(`☐${undone}`); details.push(`待办：${undone}个未完成`); }
  if (compState.running) { tags.push('⟳'); details.push(`专注：${compState.activity}`); }
  const todayStr = new Date().toISOString().split('T')[0];
  if (moodData[todayStr]) { tags.push(`${moodData[todayStr].emoji}`); details.push(`今日心情：${moodData[todayStr].label}`); }
  if (tideData.periods.length > 0) {
    const predictions = getPredictedPeriods();
    if (predictions.length > 0) {
      const daysUntil = Math.ceil((new Date(predictions[0].start) - new Date()) / (1000*60*60*24));
      if (daysUntil >= 0 && daysUntil <= 7) { tags.push('☽'); details.push(`经期：约${daysUntil}天后`); }
      else if (daysUntil < 0 && daysUntil >= -7) { tags.push('☽'); details.push('经期中'); }
    }
  }
  const hLast = (typeof heartLast === 'function') ? heartLast() : null;
  if (hLast) { tags.push('💓' + hLast.hr); details.push('心跳：' + hLast.hr + ' bpm · 体温 ' + hLast.temp.toFixed(1) + '°C'); }
  summary.textContent = tags.length > 0 ? tags.join(' ') : '无状态数据';
  detail.innerHTML = details.length > 0 ? details.join('<br>') : '暂无数据';
}

function toggleContextBar() {
  const d = document.getElementById('chatContextDetail');
  d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

function onNavLeft() {
  if (currentPage !== 'page-main') goBack();
}
function onNavHome() { goHome(); }
function onNavRight() {
  if (currentPage === 'page-main') {
    // 滚动到底部（查看倒数日和全部图标）
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTo({ top: mainContent.scrollHeight, behavior: 'smooth' });
  }
}

/* ==================== 4. 状态栏时钟 ==================== */
function updateClock() {
  const now = new Date();
  document.getElementById('statusTime').textContent =
    now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
}
setInterval(updateClock, 10000);
updateClock();
