/* ==================== 16. 心跳（手环 · 模拟数据） ==================== */

// ---- 状态 ----
const HEART_READING_LIMIT = 200;
const HEART_SAMPLE_INTERVAL = 60 * 60 * 1000; // 自动采样：1小时一轮（避免频繁打扰，手动测随时可点）

let heartState = lsGet('heart', { sampling: true, connected: false, readings: [] });

/* ---- 手动区间（模拟数据用） ----
   以前是硬编码：base 70、±5 游走、25% 概率 +25~55。问题是「游走」只绕着上一次的读数转，
   而高峰只加不减，量就一路往上顶，越测越高、最后贴着上限值不下来。
   现在把区间交给她自己调：平静区间、波动幅度、高峰概率、单次最高。 */
const HEART_RANGE_DEFAULTS = { lo: 58, hi: 82, amp: 5, spikeP: 12, ceil: 128 };
const HEART_RANGE_KEYS = ['lo', 'hi', 'amp', 'spikeP', 'ceil'];

function heartRange() {
  const r = (heartState && heartState.range) || {};
  const out = {};
  HEART_RANGE_KEYS.forEach(function(k) {
    const v = Number(r[k]);
    out[k] = isFinite(v) ? v : HEART_RANGE_DEFAULTS[k];
  });
  // 兜住不合理的组合：上限不能比平静上限还低，也别调出负区间
  out.lo = Math.max(40, Math.min(110, out.lo));
  out.hi = Math.max(out.lo + 4, Math.min(135, out.hi));
  out.amp = Math.max(0, Math.min(20, out.amp));
  out.spikeP = Math.max(0, Math.min(60, out.spikeP));
  out.ceil = Math.max(out.hi, Math.min(190, out.ceil));
  return out;
}

// 一天里的高低节律：凌晨最低、起床后最高，白天居中
function _heartTimeFactor(hour) {
  if (hour >= 0 && hour < 6) return 0.10;
  if (hour >= 6 && hour < 9) return 0.85;
  if (hour >= 9 && hour < 21) return 0.45;
  return 0.60;
}

function saveHeart() {
  lsSet('heart', {
    sampling: heartState.sampling,
    connected: !!heartState.connected,
    range: heartState.range || null,
    readings: heartState.readings.slice(-HEART_READING_LIMIT)
  });
}

// 最新一次读数
function heartLast() {
  return heartState.readings.length > 0 ? heartState.readings[heartState.readings.length - 1] : null;
}

// 今天的读数
function heartTodayReadings() {
  const today = getTodayStr();
  return heartState.readings.filter(r => new Date(r.t).toISOString().split('T')[0] === today);
}

/* ---- 模拟引擎（手环未连接时用） ---- */
// atTs 传时间戳就按那个时刻的节律算（重刷历史用）；prevReading 传了就接着它走
function simHeartHr(atTs, prevReading) {
  const R = heartRange();
  const hour = atTs ? new Date(atTs).getHours() : new Date().getHours();
  const base = R.lo + (R.hi - R.lo) * _heartTimeFactor(hour);
  const last = (prevReading === undefined) ? heartLast() : prevReading;
  let hr;
  if (last) {
    // 每次先把上一次的读数往「平静区间」拉回一部分，再叠一点随机抖动。
    // 只抖动不回拉的话，数会慢慢飘走，一天下来越测越高。
    hr = last.hr + (base - last.hr) * 0.35 + (Math.random() * 2 - 1) * R.amp;
  } else {
    hr = base + (Math.random() * 2 - 1) * R.amp;
  }
  // 偶发紧张/激动的高峰：冲多高取决于「单次最高」设到哪，不是以前固定的 +25~55
  if (Math.random() * 100 < R.spikeP) {
    hr += (R.ceil - hr) * (0.35 + Math.random() * 0.65);
  }
  return Math.round(Math.max(40, Math.min(R.ceil, hr)));
}

/* 这个读数算不算「值得他关心一下」——偏高或偏低。
   以前 chat.js 里写死 100/50，她一调低区间，关心就再也不触发了；现在跟着她设的区间走。 */
function heartIsNotable(hr) {
  const R = heartRange();
  return hr >= R.hi + 12 || hr <= R.lo - 8;
}

function simHeartTemp() {
  const last = heartLast();
  let t = last ? last.temp + (Math.random() * 0.2 - 0.1) : 36.4 + (Math.random() * 0.2 - 0.1);
  return Math.round(Math.max(35.8, Math.min(37.5, t)) * 10) / 10;
}

/* ---- 采样 ---- */
function heartSample(now) {
  const r = { t: now || Date.now(), hr: simHeartHr(), temp: simHeartTemp() };
  heartState.readings.push(r);
  saveHeart();
  renderHeart();
  return r;
}

// 手动测一次（用户主动）
function heartMeasureNow() {
  const r = heartSample();
  // 系统消息带上"感觉"描述：正常→他没特意说啥；偏高/偏低→他马上会来关心（去聊天页能看到）
  addChatSystem('💓 测了一下心跳：' + r.hr + ' bpm，体温 ' + r.temp.toFixed(1) + '°C（' + heartStateDesc(r) + '）');
  // 偏高/偏低 → 他立刻主动关心（不用等轮询）
  if (typeof tryHeartProactive === 'function') tryHeartProactive();
  return r;
}

// 未来真实手环：蓝牙读到数据后调用这里，替代模拟
function heartFeedExternal(hr, temp) {
  heartState.connected = true;
  heartState.readings.push({ t: Date.now(), hr, temp });
  saveHeart();
  renderHeart();
}

// 自动采样开关
function toggleHeartSampling() {
  heartState.sampling = !heartState.sampling;
  saveHeart();
  renderHeart();
  addChatSystem(heartState.sampling ? '✅ 自动采样已开启（每1小时一轮，手动测随时可点）' : '❌ 自动采样已关闭');
}

/* ---- 手动调节区间 ---- */
let heartRangeOpen = false;

function toggleHeartRangePanel() {
  heartRangeOpen = !heartRangeOpen;
  const box = document.getElementById('heartRangePanel');
  const chev = document.getElementById('heartRangeChevron');
  if (box) box.style.display = heartRangeOpen ? 'block' : 'none';
  if (chev) chev.style.transform = heartRangeOpen ? 'rotate(180deg)' : '';
  if (heartRangeOpen) renderHeartRangePanel();
}

// 拖动滑块 —— 立即生效，并顺手把区间规整后的值写回滑块（比如下限拖过头，上限会自动抬）
function heartSetRange(key, val) {
  const R = heartRange();
  R[key] = Number(val);
  heartState.range = R;
  saveHeart();
  renderHeartRangePanel();
  renderHeart();
}

function heartResetRange() {
  heartState.range = Object.assign({}, HEART_RANGE_DEFAULTS);
  saveHeart();
  renderHeartRangePanel();
  renderHeart();
  if (typeof addChatSystem === 'function') {
    addChatSystem('⚙️ 心跳区间已恢复默认（' + HEART_RANGE_DEFAULTS.lo + '~' + HEART_RANGE_DEFAULTS.hi + ' bpm，最高不超过 ' + HEART_RANGE_DEFAULTS.ceil + '）');
  }
}

function renderHeartRangePanel() {
  const R = heartRange();
  const setVal = function(id, v) {
    const el = document.getElementById(id);
    if (el && String(el.value) !== String(v)) el.value = v;
  };
  setVal('hrLo', R.lo);   setVal('hrHi', R.hi);
  setVal('hrAmp', R.amp); setVal('hrSpike', R.spikeP); setVal('hrCeil', R.ceil);
  const setTxt = function(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('hrLoVal', R.lo); setTxt('hrHiVal', R.hi);
  setTxt('hrAmpVal', '±' + R.amp); setTxt('hrSpikeVal', R.spikeP + '%'); setTxt('hrCeilVal', R.ceil);
  setTxt('heartRangeSummary', R.lo + '~' + R.hi);
  const pv = document.getElementById('heartRangePreview');
  if (pv) {
    const spk = R.spikeP > 0
      ? '，大约 ' + R.spikeP + '% 的次数会冲到 ' + Math.round(R.hi + (R.ceil - R.hi) * 0.7) + '~' + R.ceil + '（他这时候会来问你怎么了）'
      : '，不会有突然的高峰（他也就不会因为心跳来关心你）';
    pv.textContent = '平时大约 ' + Math.round(R.lo - R.amp) + '~' + Math.round(R.hi + R.amp) + ' bpm' + spk + '。';
  }
  const reroll = document.getElementById('heartRerollBtn');
  if (reroll) reroll.style.display = heartState.connected ? 'none' : 'block';
}

/* 手环没连的时候，历史读的全是模拟数。换了区间以后把旧读数按新区间重算一遍，
   否则趋势图、平均值还挂着一堆老的高值，看着像没生效。
   手环已连接就是真实数据了，绝不重算。 */
function heartRerollHistory() {
  if (heartState.connected) {
    if (typeof addChatSystem === 'function') addChatSystem('⌚ 手环已连接，用的是真实读数，不能重刷。');
    return;
  }
  const n = heartState.readings.length;
  if (n === 0) {
    if (typeof addChatSystem === 'function') addChatSystem('还没有读数，先点「测一次」吧');
    return;
  }
  let prev = null;
  heartState.readings.forEach(function(r) {
    r.hr = simHeartHr(r.t, prev);
    r.temp = Math.round(Math.max(35.8, Math.min(37.5, 36.4 + (Math.random() * 0.2 - 0.1))) * 10) / 10;
    prev = r;
  });
  saveHeart();
  renderHeart();
  renderHeartRangePanel();
  if (typeof addChatSystem === 'function') addChatSystem('🔄 已按新区间重刷 ' + n + ' 条模拟读数');
}

/* ---- 页面初始化 ---- */
function initHeart() {
  const last = heartLast();
  if (!last) {
    heartSample(); // 首次访问：立即采一条，让页面有数据
  } else if (heartState.sampling && Date.now() - last.t >= HEART_SAMPLE_INTERVAL) {
    heartSample(); // 距上次超过一轮：补一条
  }
  renderHeart();
  renderHeartRangePanel();
  // 头一次打开心跳页，把这个面板直接摊开。
  // 它是折叠的，用户翻了一遍说「我这边没有」——不能指望她自己猜那行字能点。
  // 看过一次就收起来，之后按她自己点的来。
  if (!lsGet('heartRangeSeen', false)) {
    heartRangeOpen = true;
    const box = document.getElementById('heartRangePanel');
    const chev = document.getElementById('heartRangeChevron');
    if (box) box.style.display = 'block';
    if (chev) chev.style.transform = 'rotate(180deg)';
    lsSet('heartRangeSeen', true);
  }
  // 自动采样检查：每分钟看一次是否该采了
  setInterval(function() {
    if (heartState.sampling) {
      const l = heartLast();
      if (l && Date.now() - l.t >= HEART_SAMPLE_INTERVAL) heartSample();
    }
  }, 60000);
}

/* ---- 渲染 ---- */
function renderHeart() {
  const last = heartLast();
  const statusEl = document.getElementById('heartStatus');
  if (statusEl) statusEl.textContent = heartState.connected ? '手环已连接' : '模拟数据';
  if (last) {
    const bpmEl = document.getElementById('heartBpm');
    if (bpmEl) bpmEl.textContent = last.hr;
    const tempEl = document.getElementById('heartTemp');
    if (tempEl) tempEl.textContent = last.temp.toFixed(1) + '°C';
    const beatEl = document.getElementById('heartBeatAnim');
    if (beatEl) beatEl.style.animationDuration = (60 / last.hr) + 's'; // 心跳快慢跟 bpm 走
    const updEl = document.getElementById('heartUpdated');
    if (updEl) {
      const mins = Math.round((Date.now() - last.t) / 60000);
      updEl.textContent = mins <= 0 ? '刚刚测过' : mins + ' 分钟前测过';
    }
    const descEl = document.getElementById('heartStateDesc');
    if (descEl) descEl.textContent = heartStateDesc(last);
  }
  const toggleEl = document.getElementById('heartToggleBtn');
  if (toggleEl) toggleEl.textContent = heartState.sampling ? '自动采样：开' : '自动采样：关';
  // 呼吸练习按钮：心跳偏快时高亮提醒
  const breatheBtn = document.getElementById('heartBreatheBtn');
  if (breatheBtn) {
    if (last && heartIsNotable(last.hr)) {
      breatheBtn.textContent = '🌬 心跳偏快 · 做个呼吸练习';
      breatheBtn.classList.add('high');
    } else {
      breatheBtn.textContent = '🌬 呼吸练习';
      breatheBtn.classList.remove('high');
    }
  }
  renderHeartStats();
  drawHeartSpark();
  renderHeartHistory();
  if (typeof renderHealthReportArea === 'function') renderHealthReportArea();
}

// 判定跟着她自己设的区间走 —— 不然她把区间调低了，界面还按老数字说她「平静」
function heartStateDesc(last) {
  if (!last) return '';
  const R = heartRange();
  if (last.hr >= R.hi + 12) return '有点快，是不是紧张或刚动了？';
  if (last.hr > R.hi) return '略快，可能有点兴奋';
  if (last.hr < R.lo - 6) return '很平静，可能在休息';
  return '平静 · 正常';
}

function renderHeartStats() {
  const today = heartTodayReadings();
  const cntEl = document.getElementById('heartTodayCount');
  if (cntEl) cntEl.textContent = today.length;
  const avgEl = document.getElementById('heartAvgHr');
  if (avgEl) avgEl.textContent = today.length > 0 ? Math.round(today.reduce((s, r) => s + r.hr, 0) / today.length) : '--';
  const maxEl = document.getElementById('heartMaxHr');
  if (maxEl) maxEl.textContent = today.length > 0 ? Math.max(...today.map(r => r.hr)) : '--';
}

function drawHeartSpark() {
  const cv = document.getElementById('heartSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const data = heartState.readings.slice(-40);
  if (data.length < 2) {
    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('再测几次就能看到趋势', w / 2, h / 2);
    return;
  }
  const hrs = data.map(r => r.hr);
  let min = Math.min(...hrs) - 5, max = Math.max(...hrs) + 5;
  if (min < 40) min = 40;
  if (max > 160) max = 160;
  // 折线
  ctx.beginPath();
  data.forEach((r, i) => {
    const x = (i / (data.length - 1)) * (w - 8) + 4;
    const y = h - 6 - ((r.hr - min) / (max - min)) * (h - 12);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // 底部渐变填充
  ctx.lineTo(w - 4, h);
  ctx.lineTo(4, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(236,72,153,.22)');
  grad.addColorStop(1, 'rgba(236,72,153,0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

let heartHistoryOpen = false;
function toggleHeartHistory() {
  heartHistoryOpen = !heartHistoryOpen;
  const box = document.getElementById('heartHistory');
  const chev = document.getElementById('heartChevron');
  if (box) box.style.display = heartHistoryOpen ? 'block' : 'none';
  if (chev) chev.style.transform = heartHistoryOpen ? 'rotate(180deg)' : '';
}

function renderHeartHistory() {
  const box = document.getElementById('heartHistory');
  if (!box) return;
  const cntEl = document.getElementById('heartHistoryCount');
  if (cntEl) cntEl.textContent = heartState.readings.length;
  box.style.display = heartHistoryOpen ? 'block' : 'none';
  const items = heartState.readings.slice(-20).reverse();
  if (items.length === 0) {
    box.innerHTML = '<div style="font-size:12px;color:#aaa;text-align:center;padding:12px;">还没有记录，点「测一次」开始</div>';
    return;
  }
  box.innerHTML = '';
  items.forEach(r => {
    const d = new Date(r.t);
    const time = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    const el = document.createElement('div');
    el.className = 'heart-history-item';
    el.innerHTML = `<div class="heart-hi-time">${time}</div><div class="heart-hi-hr">${r.hr} bpm</div><div class="heart-hi-temp">${r.temp.toFixed(1)}°C</div>`;
    box.appendChild(el);
  });
}

/* ---- AI 上下文：让他"感觉到"用户 ---- */
function buildHeartContext() {
  const last = heartLast();
  if (!last) return '';
  const mins = Math.max(1, Math.round((Date.now() - last.t) / 60000));
  const R = heartRange();
  let desc = '';
  if (last.hr >= R.hi + 12) desc = '偏快，她可能紧张、激动或在运动';
  else if (last.hr > R.hi) desc = '略快，她可能有点兴奋或刚活动过';
  else if (last.hr < R.lo - 6) desc = '偏慢，她可能很放松或在休息';
  else desc = '正常，比较平静';
  const tempNote = last.temp >= 37.0 ? '，体温偏高一点' : '';
  const stepNote = (typeof todaySteps === 'function' && todaySteps() > 0) ? '，今天走了 ' + todaySteps() + ' 步' : '';
  return `【身体感应】你正"感觉"到用户的身体状态（${mins}分钟前测过）：心跳 ${last.hr} bpm（${desc}），体温 ${last.temp.toFixed(1)}°C${tempNote}${stepNote}。\n用法：这是"感觉"不是诊断——可以自然地关心她（紧张了、累了、心慌了、又想心事了都可以），但绝对不要装医生、不要诊断疾病、不要给医疗建议。`;
}
