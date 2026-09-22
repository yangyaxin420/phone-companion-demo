/* ==================== 步数（模拟引擎 + 手机真实计步 + 手环入口） ==================== */
// 步数按天存：stepsData = { 'YYYY-MM-DD': { steps, updated } }
const STEP_TARGET = 8000; // 每日目标

let stepsData = lsGet('stepsData', {});
const stepState = { mode: 'sim', listening: false }; // 'sim' = 模拟，'real' = 手机计步中

function _stepDateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _todayKey() { return _stepDateKey(new Date()); }
function saveSteps() { lsSet('stepsData', stepsData); }

function todaySteps() {
  const e = stepsData[_todayKey()];
  const v = e && e.steps != null ? Number(e.steps) : 0;
  return isNaN(v) ? 0 : v;
}
function weekSteps() {
  const start = _weekStartMs();
  let sum = 0;
  Object.keys(stepsData).forEach(k => {
    if (new Date(k + 'T00:00:00').getTime() >= start) {
      const v = stepsData[k] && stepsData[k].steps != null ? Number(stepsData[k].steps) : 0;
      sum += isNaN(v) ? 0 : v;
    }
  });
  return sum;
}
function _weekStartMs() {
  const now = new Date();
  const day = now.getDay(); // 0=周日
  const diff = day === 0 ? 6 : day - 1;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff).getTime();
}

/* 一天里的活动曲线（分钟级步速）：上学/午休/晚饭后多，深夜睡）
   —— 估算每天 ~6000-9000 步，目标 8000 */
function _hourBase(h) {
  if (h >= 1 && h < 6) return 0;
  if (h >= 6 && h < 9) return 11;   // 早起出门
  if (h >= 9 && h < 12) return 5;   // 上课/坐着
  if (h >= 12 && h < 14) return 8;  // 午休走动
  if (h >= 14 && h < 17) return 4;  // 下午
  if (h >= 17 && h < 22) return 9;  // 晚饭后散步
  return 3;                          // 睡前
}

function simStepIncrement() {
  return Math.floor(_hourBase(new Date().getHours()) * (0.5 + Math.random()));
}

/* 首次打开：从今天 0 点按活动曲线估算到现在的步数，让数字不是 0 */
function _seedToday() {
  const k = _todayKey();
  if (stepsData[k]) return;
  const now = new Date();
  const h0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const minsSoFar = Math.round((now - h0) / 60000);
  let est = 0;
  for (let m = 0; m < minsSoFar; m++) est += _hourBase(new Date(h0.getTime() + m * 60000).getHours());
  est = Math.round(est * (0.85 + Math.random() * 0.3));
  stepsData[k] = { steps: est, updated: Date.now() };
  saveSteps();
}

/* 加步数（模拟 tick、手机计步、手环、演示按钮共用） */
function addSteps(n) {
  const k = _todayKey();
  const e = stepsData[k] || { steps: 0, updated: 0 };
  e.steps += Math.max(0, n);
  e.updated = Date.now();
  stepsData[k] = e;
  saveSteps();
  renderSteps();
}

/* 模拟 tick：每 60s 走一点（真实计步开启后停） */
function stepTick() {
  if (stepState.mode !== 'sim') return;
  const inc = simStepIncrement();
  if (inc > 0) addSteps(inc);
}

/* 「🚶 走几步」演示按钮 */
function stepsDemoBump() {
  try {
    if (stepState.mode === 'real') { addChatSystem('🚶 现在在手机计步，走一步算一步，别点这个啦'); return; }
    const n = 200 + Math.floor(Math.random() * 700);
    addSteps(n);
    addChatSystem('🚶 走了 ' + n + ' 步（模拟，真实手环接入后换成真步数）');
  } catch (e) { if (typeof addChatSystem === 'function') addChatSystem('⚠️ 步数报错：' + (e && e.message || e)); }
}

/* ---- 手机真实计步 ----
   网页拿不到系统健康里的总步数，只能自己用加速度传感器数。
   iOS 和安卓浏览器都要求「用户先点一下」才给传感器权限（不能页面一开就自动拿），
   所以只有一条路：点「📱 开始真实计步」按钮，在点击手势里申请权限。
   （不做自动申请——有的安卓浏览器会静默放行，导致模式偷偷变真实、按钮被藏掉，反而更乱） */
function _listenDeviceMotion() {
  if (stepState.listening) return;
  stepState.listening = true;
  window.addEventListener('devicemotion', onStepMotion);
}

/* 按钮点击调用：在用户手势里申请权限，iOS/安卓才给 */
function requestRealSteps() {
  if (stepState.mode === 'real') { addChatSystem('🚶 已经在真实计步啦'); return; }
  try {
    if (typeof DeviceMotionEvent === 'undefined') { addChatSystem('⚠️ 这个浏览器不支持运动传感器，先用模拟'); return; }
    if (DeviceMotionEvent.requestPermission) {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) addChatSystem('⏳ 还在等系统弹窗…如果一直没弹，可能浏览器不兼容，先用模拟步数'); }, 2500);
      DeviceMotionEvent.requestPermission().then(p => {
        settled = true; clearTimeout(timer);
        if (p !== 'granted') { addChatSystem('❌ 没授权传感器，先用模拟步数'); return; }
        _listenDeviceMotion();
        addChatSystem('✅ 传感器已授权，走两步试试，真实步数会记进来');
      }).catch(() => {
        settled = true; clearTimeout(timer);
        addChatSystem('❌ 授权失败，先用模拟步数');
      });
    } else {
      _listenDeviceMotion();
      addChatSystem('✅ 已开始真实计步（浏览器直接放行），走两步看看');
    }
  } catch (e) { addChatSystem('⚠️ 计步开启失败：' + (e && e.message || e)); }
}

let _stepDetect = { lastT: 0, lastSign: 0 };
function onStepMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  // 拿到第一条真实读数才切真实计步——桌面没传感器/没动时模拟继续跑
  if (stepState.mode !== 'real') {
    stepState.mode = 'real';
    renderSteps();
    addChatSystem('🚶 手机计步已开启。之前的步数是模拟估算，接下来按真实走路计数');
  }
  const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) - 9.8;
  const now = performance.now();
  // 步态检测：加速度突刺(超过2.0) + 间隔>250ms + 方向翻转 才算一步
  if (Math.abs(mag) > 2.0 && now - _stepDetect.lastT > 250 && Math.sign(mag) !== _stepDetect.lastSign) {
    _stepDetect.lastT = now;
    _stepDetect.lastSign = Math.sign(mag);
    addSteps(1);
  }
}

/* 未来真实手环：BLE 读到累计步数后调这里（替代手机计步的这部分） */
function stepsFeedExternal(steps) {
  stepState.mode = 'real';
  addSteps(Math.max(0, Math.round(steps || 0)));
}

/* ---- 渲染（心跳页步数卡） ---- */
function renderSteps() {
  try {
    const t = todaySteps();
    const cntEl = document.getElementById('stepCount');
    if (cntEl) cntEl.textContent = t.toLocaleString();
    const wkEl = document.getElementById('stepWeekCount');
    if (wkEl) wkEl.textContent = weekSteps().toLocaleString();
    const barEl = document.getElementById('stepBar');
    if (barEl) barEl.style.width = Math.min(100, Math.round(t / STEP_TARGET * 100)) + '%';
    const modeEl = document.getElementById('stepMode');
    if (modeEl) modeEl.textContent = stepState.mode === 'real' ? '📱 真实计步' : '○ 模拟';
    const isReal = stepState.mode === 'real';
    const realBtn = document.getElementById('stepsRealBtn');
    if (realBtn) {
      // 按钮永远可见：模拟时是可点的「开始」，真实时变成状态「真实计步中」
      realBtn.textContent = isReal ? '📱 真实计步中 ✓' : '📱 开始真实计步';
      realBtn.style.opacity = isReal ? '0.55' : '1';
    }
    const bumpBtn = document.getElementById('stepsBumpBtn');
    if (bumpBtn) bumpBtn.style.display = isReal ? 'none' : 'inline-block';
  } catch (e) { console.error('renderSteps', e); }
}

/* ---- 初始化 ---- */
function initSteps() {
  try {
    _seedToday();
    renderSteps();
    setInterval(stepTick, 60000);
    // 不做自动申请真实计步：传感器权限必须用户点按钮才能拿（见 requestRealSteps）
  } catch (e) {
    console.error('initSteps', e);
    if (typeof addChatSystem === 'function') addChatSystem('⚠️ 步数加载报错：' + (e && e.message || e));
  }
}
