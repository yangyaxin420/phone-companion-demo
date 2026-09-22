/* ==================== 17. 潮汐（月经日历） ==================== */
let tideData = lsGet('tide', { periods:[] });
let tideViewYear, tideViewMonth;

function initTide() {
  const now = new Date();
  tideViewYear = now.getFullYear();
  tideViewMonth = now.getMonth();
  document.getElementById('tideStartDate').value = now.toISOString().split('T')[0];
  renderTideCalendar();
}

function tidePrevMonth() {
  tideViewMonth--;
  if (tideViewMonth < 0) { tideViewMonth = 11; tideViewYear--; }
  renderTideCalendar();
}

function tideNextMonth() {
  tideViewMonth++;
  if (tideViewMonth > 11) { tideViewMonth = 0; tideViewYear++; }
  renderTideCalendar();
}

function getAvgCycle() {
  if (tideData.periods.length < 2) return 28;
  const sorted = [...tideData.periods].sort((a,b) => new Date(a.start) - new Date(b.start));
  let totalDays = 0, count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i].start) - new Date(sorted[i-1].start)) / (1000*60*60*24);
    if (diff > 15 && diff < 60) { totalDays += diff; count++; }
  }
  return count > 0 ? Math.round(totalDays / count) : 28;
}

function getPredictedPeriods() {
  const sorted = [...tideData.periods].sort((a,b) => new Date(a.start) - new Date(b.start));
  if (sorted.length === 0) return [];
  const lastPeriod = sorted[sorted.length - 1];
  const avgCycle = getAvgCycle();
  const avgDuration = sorted.length > 0 ? Math.round(sorted.reduce((s,p)=>s+p.duration,0)/sorted.length) : 5;
  const predictions = [];
  let lastStart = new Date(lastPeriod.start);
  for (let i = 1; i <= 3; i++) {
    const nextStart = new Date(lastStart.getTime() + avgCycle * i * 24*60*60*1000);
    predictions.push({ start: nextStart.toISOString().split('T')[0], duration: avgDuration, predicted: true });
  }
  return predictions;
}

function isDateInPeriod(dateStr, periods) {
  for (const p of periods) {
    const start = new Date(p.start);
    const end = new Date(start.getTime() + (p.duration - 1) * 24*60*60*1000);
    const d = new Date(dateStr);
    if (d >= start && d <= end) return p.predicted ? 'predicted' : 'period';
  }
  return null;
}

function renderTideCalendar() {
  document.getElementById('tideMonth').textContent = `${tideViewYear}年${tideViewMonth+1}月`;
  const grid = document.getElementById('tideCalGrid');
  grid.innerHTML = '';

  const firstDay = new Date(tideViewYear, tideViewMonth, 1);
  const lastDay = new Date(tideViewYear, tideViewMonth + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const allPeriods = [...tideData.periods, ...getPredictedPeriods()];

  const prevMonthDays = new Date(tideViewYear, tideViewMonth, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const el = document.createElement('div');
    el.className = 'tide-day other-month';
    el.textContent = prevMonthDays - i;
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${tideViewYear}-${(tideViewMonth+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'tide-day';
    if (dateStr === todayStr) el.classList.add('today');
    var dayMood = getTideMood(dateStr);
    const status = isDateInPeriod(dateStr, allPeriods);
    if (status === 'period') el.classList.add('period');
    else if (status === 'predicted') el.classList.add('predicted');
    const moodHtml = dayMood ? '<div style="font-size:11px;line-height:1;margin-top:1px;">' + dayMood.emoji + '</div>' : '';
    el.innerHTML = '<span>' + d + '</span>' + moodHtml + (status === 'period' ? '<span class="tide-dot"></span>' : status === 'predicted' ? '<span class="tide-dot predicted-dot"></span>' : '');
    el.onclick = function(ds) { return function() { showTideMoodPicker(ds); }; }(dateStr);
    grid.appendChild(el);
  }

  const totalCells = grid.children.length;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    const el = document.createElement('div');
    el.className = 'tide-day other-month';
    el.textContent = i;
    grid.appendChild(el);
  }
  renderTideInfo();
  renderTidePeriodList();
}

function renderTideInfo() {
  const infoEl = document.getElementById('tideInfo');
  const sorted = [...tideData.periods].sort((a,b) => new Date(b.start) - new Date(a.start));
  const avgCycle = getAvgCycle();
  const predictions = getPredictedPeriods();
  const today = new Date();
  let chips = [];
  if (sorted.length > 0) {
    const nextPred = predictions[0];
    if (nextPred) {
      const daysUntil = Math.ceil((new Date(nextPred.start) - today) / (1000*60*60*24));
      if (daysUntil > 0) chips.push({ text: `下次约 ${daysUntil} 天后`, cls: daysUntil <= 5 ? 'soon' : 'ok' });
      else if (daysUntil >= -5) chips.push({ text: '经期中', cls: 'urgent' });
    }
    chips.push({ text: `平均周期 ${avgCycle} 天`, cls: 'ok' });
  } else { chips.push({ text: '暂无记录', cls: '' }); }
  infoEl.innerHTML = chips.map(c => `<div class="tide-info-chip ${c.cls}">${c.text}</div>`).join('');
}

function renderTidePeriodList() {
  const list = document.getElementById('tidePeriodList');
  const sorted = [...tideData.periods].sort((a,b) => new Date(b.start) - new Date(a.start));
  list.innerHTML = '';
  sorted.forEach((p, idx) => {
    const origIdx = tideData.periods.indexOf(p);
    const startDate = new Date(p.start);
    const endDate = new Date(startDate.getTime() + (p.duration - 1)*24*60*60*1000);
    const endStr = endDate.toISOString().split('T')[0];
    const el = document.createElement('div');
    el.className = 'tide-period-item';
    el.innerHTML = `<span class="tpi-dates">${p.start} ~ ${endStr}</span><span class="tpi-len">${p.duration}天</span><span class="tpi-del" onclick="tideDelPeriod(${origIdx})">✕</span>`;
    list.appendChild(el);
  });
}

var tideMoodData = lsGet('tideMood', {});

function setTideMood(dateStr, mood) {
  tideMoodData[dateStr] = mood;
  lsSet('tideMood', tideMoodData);
  saveMemory('今天心情：' + mood.emoji + ' ' + mood.label);
  renderTideCalendar();
}

function getTideMood(dateStr) {
  return tideMoodData[dateStr] || null;
}

function tideAddPeriod() {
  const start = document.getElementById('tideStartDate').value;
  const duration = parseInt(document.getElementById('tideDuration').value) || 5;
  if (!start) return;
  const exists = tideData.periods.some(p => p.start === start);
  if (exists) { addChatSystem('⚠️ 该日期已有记录'); return; }
  tideData.periods.push({ start, duration });
  lsSet('tide', tideData);
  renderTideCalendar();
  addChatSystem(`🌙 已记录经期：${start}，持续${duration}天。平均周期${getAvgCycle()}天`);
}

function tideDelPeriod(idx) {
  tideData.periods.splice(idx, 1);
  lsSet('tide', tideData);
  renderTideCalendar();
}

function showTideMoodPicker(dateStr) {
  var picker = document.getElementById('tideMoodPicker');
  if (!picker) return;
  var options = document.getElementById('tideMoodOptions');
  if (!options) return;
  var moods = [
    { emoji:'😄', label:'开心', score:5 }, { emoji:'😊', label:'愉快', score:4 },
    { emoji:'😌', label:'平静', score:3 }, { emoji:'😐', label:'一般', score:2 },
    { emoji:'😔', label:'低落', score:1 }, { emoji:'😢', label:'难过', score:0 },
    { emoji:'😤', label:'生气', score:0 }, { emoji:'😰', label:'焦虑', score:0 }
  ];
  options.innerHTML = '';
  moods.forEach(function(m) {
    var btn = document.createElement('button');
    btn.style.cssText = 'padding:6px 10px;border-radius:10px;background:#f0f0f0;font-size:16px;cursor:pointer;margin:2px;';
    btn.textContent = m.emoji + ' ' + m.label;
    btn.onclick = function() { setTideMood(dateStr, m); picker.style.display = 'none'; };
    options.appendChild(btn);
  });
  picker.style.display = 'block';
}

function tideAutoPredict() {
  const predictions = getPredictedPeriods();
  if (predictions.length === 0) { addChatSystem('⚠️ 至少需要2次经期记录才能预测'); return; }
  const next = predictions[0];
  const daysUntil = Math.ceil((new Date(next.start) - new Date()) / (1000*60*60*24));
  addChatSystem(`🔮 预测下次经期：${next.start}（约${daysUntil}天后），持续约${next.duration}天。平均周期${getAvgCycle()}天`);
}

/* ==================== 18. 每日心情 ==================== */
const MOOD_EMOJIS = [
  { emoji:'😄', label:'开心', score:5 }, { emoji:'😊', label:'愉快', score:4 },
  { emoji:'😌', label:'平静', score:3 }, { emoji:'😐', label:'一般', score:2 },
  { emoji:'😔', label:'低落', score:1 }, { emoji:'😢', label:'难过', score:0 },
  { emoji:'😤', label:'生气', score:0 }, { emoji:'😰', label:'焦虑', score:0 }
];

const MOOD_KEYWORDS = {
  '😄': ['开心','高兴','快乐','棒','太好了','哈哈','嘻嘻','好开心','超开心','幸福','兴奋','爽'],
  '😊': ['不错','还好','挺好','满意','舒服','悠闲','惬意','愉快','喜欢'],
  '😌': ['平静','放松','安心','淡然','还好吧','一般般'],
  '😐': ['无聊','嗯','还行','就那样','随便','不知道'],
  '😔': ['低落','郁闷','失落','沮丧','唉','叹气','无奈','烦','心累'],
  '😢': ['难过','伤心','哭','想哭','心痛','悲伤','委屈','崩溃'],
  '😤': ['生气','愤怒','气死','烦死','恼火','火大','受不了','无语'],
  '😰': ['焦虑','紧张','害怕','担心','不安','压力','慌','慌张','恐惧','忐忑']
};

let moodData = lsGet('mood', {});
let moodViewYear, moodViewMonth;

function initMood() {
  // 如果 mood 元素不存在（页面未完整实现），静默跳过
  if (!document.getElementById('moodEmojiPicker')) return;
  const now = new Date();
  moodViewYear = now.getFullYear();
  moodViewMonth = now.getMonth();
  renderMoodEmojiPicker();
  renderMoodCalendar();
  renderMoodChart();
}

function moodPrevMonth() {
  moodViewMonth--;
  if (moodViewMonth < 0) { moodViewMonth = 11; moodViewYear--; }
  renderMoodCalendar();
}
function moodNextMonth() {
  moodViewMonth++;
  if (moodViewMonth > 11) { moodViewMonth = 0; moodViewYear++; }
  renderMoodCalendar();
}

function renderMoodEmojiPicker() {
  const picker = document.getElementById('moodEmojiPicker');
  if (!picker) return;
  const today = new Date().toISOString().split('T')[0];
  const todayMood = moodData[today];
  MOOD_EMOJIS.forEach(m => {
    const btn = document.createElement('span');
    btn.className = 'mood-emoji-btn' + (todayMood && todayMood.emoji === m.emoji ? ' selected' : '');
    btn.textContent = m.emoji;
    btn.title = m.label;
    btn.onclick = () => setTodayMood(m);
    picker.appendChild(btn);
  });
}

function setTodayMood(moodObj) {
  const today = new Date().toISOString().split('T')[0];
  moodData[today] = { emoji: moodObj.emoji, score: moodObj.score, label: moodObj.label };
  lsSet('mood', moodData);
  renderMoodEmojiPicker();
  renderMoodCalendar();
  renderMoodChart();
}

function renderMoodCalendar() {
  const monthEl = document.getElementById('moodMonth');
  const grid = document.getElementById('moodCalGrid');
  if (!monthEl || !grid) return;
  monthEl.textContent = `${moodViewYear}年${moodViewMonth+1}月`;
  grid.innerHTML = '';
  const firstDay = new Date(moodViewYear, moodViewMonth, 1);
  const lastDay = new Date(moodViewYear, moodViewMonth + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const prevMonthDays = new Date(moodViewYear, moodViewMonth, 0).getDate();
    const el = document.createElement('div');
    el.className = 'mood-day other-month';
    el.innerHTML = `<span class="mood-date">${prevMonthDays - i}</span>`;
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${moodViewYear}-${(moodViewMonth+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'mood-day';
    if (dateStr === todayStr) el.classList.add('today');
    const dayMood = moodData[dateStr];
    el.innerHTML = dayMood
      ? `<span class="mood-emoji">${dayMood.emoji}</span><span class="mood-date">${d}</span>`
      : `<span class="mood-date">${d}</span>`;
    grid.appendChild(el);
  }

  const totalCells = grid.children.length;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    const el = document.createElement('div');
    el.className = 'mood-day other-month';
    el.innerHTML = `<span class="mood-date">${i}</span>`;
    grid.appendChild(el);
  }
}

function renderMoodChart() {
  const chartEl = document.getElementById('moodChart');
  if (!chartEl) return;
  const days = 30;
  const data = [];
  const labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    labels.push(d.getMonth() + 1 + '/' + d.getDate());
    data.push(moodData[ds] ? moodData[ds].score : -1);
  }
  chartEl.innerHTML = '<div style="font-size:13px;font-weight:700;color:#666;margin-bottom:8px;">📊 最近30天心情趋势</div>';
  const barContainer = document.createElement('div');
  barContainer.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:80px;padding:4px 0;';
  data.forEach((score, i) => {
    if (score < 0) {
      const emptyBar = document.createElement('div');
      emptyBar.style.cssText = 'flex:1;height:4px;background:#f0f0f0;border-radius:2px;';
      barContainer.appendChild(emptyBar);
    } else {
      const bar = document.createElement('div');
      const pct = (score / 5) * 100;
      bar.style.cssText = `flex:1;height:${Math.max(8, pct * 0.7)}px;background:${score >= 3 ? '#4caf50' : '#ff9800'};border-radius:3px 3px 0 0;transition:height .3s;`;
      bar.title = labels[i] + ' ' + (moodData[labels[i].replace('/','-')]?.emoji || '');
      barContainer.appendChild(bar);
    }
  });
  chartEl.appendChild(barContainer);
}
