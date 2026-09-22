/* ==================== 15. 陪伴计时（增强版） ==================== */

// ---- 专注记录存储 ----
function getCompRecords() { return lsGet('compRecords', []); }
function saveCompRecords(v) { lsSet('compRecords', v); }

/* ---- 活动选择 ---- */
function renderCompanionActs() {
  const container = document.getElementById('companionActs');
  if (!container) return;
  container.innerHTML = '';
  const allActs = [...COMPANION_ACTIVITIES, ...customActivities];
  allActs.forEach((a, idx) => {
    const el = document.createElement('div');
    const isCustom = idx >= COMPANION_ACTIVITIES.length;
    el.className = 'companion-act-btn pressable' + (compState.activity===a.name?' selected':'');
    el.innerHTML = a.emoji + ' ' + escHtml(a.name) + (isCustom ? `<span style="font-size:10px;color:#999;margin-left:2px;" onclick="event.stopPropagation();removeCustomAct(${idx - COMPANION_ACTIVITIES.length})">×</span>` : '');
    el.onclick = () => selectActivity(a.name);
    container.appendChild(el);
  });
  const addBtn = document.createElement('div');
  addBtn.className = 'companion-act-btn pressable';
  addBtn.style.cssText = 'background:#e8e8e8;color:#999;font-size:16px;';
  addBtn.textContent = '+';
  addBtn.onclick = () => {
    const name = prompt('自定义活动名称：');
    if (!name || !name.trim()) return;
    const emoji = prompt('选一个 emoji（可选）：', '🎯') || '🎯';
    customActivities.push({ emoji, name: name.trim() });
    lsSet('customActs', customActivities);
    renderCompanionActs();
  };
  container.appendChild(addBtn);
}

function removeCustomAct(idx) {
  customActivities.splice(idx, 1);
  lsSet('customActs', customActivities);
  if (compState.activity && !COMPANION_ACTIVITIES.find(a => a.name === compState.activity) && !customActivities.find(a => a.name === compState.activity)) {
    compState.activity = null;
  }
  renderCompanionActs();
}

function selectActivity(name) {
  if (compState.running) compPause();
  compState.activity = name;
  compState.seconds = 0;
  compState.remindMin = 0;
  updateCompDisplay();
  renderCompanionActs();
}

/* ---- 显示更新 ---- */
function updateCompDisplay() {
  const el = document.getElementById('companionTimer');
  if (!el) return;
  const s = compState.mode === 'countdown'
    ? compState.targetMinutes * 60 - compState.seconds
    : compState.seconds;
  const displaySec = Math.max(0, s);
  const h = Math.floor(displaySec/3600).toString().padStart(2,'0');
  const m = Math.floor((displaySec%3600)/60).toString().padStart(2,'0');
  const sec = (displaySec%60).toString().padStart(2,'0');
  el.textContent = `${h}:${m}:${sec}`;
}

/* ---- 计时控制 ---- */
function compStart() {
  if (!compState.activity) { compState.activity = '专注'; }
  if (compState.running) return;

  // 如果是倒计时且已完成，重置
  if (compState.mode === 'countdown' && compState.seconds >= compState.targetMinutes * 60) {
    compState.seconds = 0;
  }

  compState.running = true;
  compState.aiBubbles = [];
  const taskText = document.getElementById('compTaskInput')?.value?.trim() || '';
  compState.taskName = taskText || compState.activity;
  addChatSystem(`🧘 ${compState.taskName} 陪伴开始，计时已启动${compState.mode==='countdown'?'（倒计时 '+compState.targetMinutes+'分钟）':''}`);

  // 自动进入全屏计时
  enterFullscreenTimer();

  compState.interval = setInterval(() => {
    compState.seconds++;
    updateCompDisplay();

    // 倒计时完成
    if (compState.mode === 'countdown' && compState.seconds >= compState.targetMinutes * 60) {
      compFinish();
      return;
    }

    // 每5分钟提醒
    const mins = Math.floor(compState.seconds / 60);
    if (mins > 0 && mins % 5 === 0 && mins !== compState.remindMin) {
      compState.remindMin = mins;
      addChatSystem(`✨ 你已经专注 ${mins} 分钟了！`);
    }
  }, 1000);
  renderCompanionActs();
}

function compPause() {
  if (!compState.running) return;
  compState.running = false;
  clearInterval(compState.interval);
  addChatSystem(`⏸ ${compState.taskName} 计时已暂停`);
  renderCompanionActs();
}

function compReset() {
  compState.running = false;
  clearInterval(compState.interval);
  compState.seconds = 0;
  compState.remindMin = 0;
  compState.aiBubbles = [];
  updateCompDisplay();
  renderCompanionActs();
}

function compFinish() {
  compState.running = false;
  clearInterval(compState.interval);
  const totalMins = Math.floor(compState.seconds / 60);
  addChatSystem(`✅ ${compState.taskName} 专注完成！共 ${totalMins} 分钟${compState.aiBubbles.length > 0 ? '，AI陪伴了'+compState.aiBubbles.length+'次' : ''}`);

  // 保存记录
  const records = getCompRecords();
  records.unshift({
    id: Date.now() + '_' + Math.random().toString(36).slice(2,6),
    task: compState.taskName,
    activity: compState.activity,
    duration: compState.seconds,
    mode: compState.mode,
    date: Date.now(),
    bubbles: compState.aiBubbles.length,
  });
  saveCompRecords(records.slice(0, 200)); // 保留最近200条
  compReset();
}

/* ---- 模式切换 ---- */
function setCompMode(mode) {
  if (compState.running) return;
  compState.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  compState.seconds = 0;
  updateCompDisplay();
}

function setCompDuration(minutes) {
  if (compState.running) return;
  compState.targetMinutes = Math.max(1, Math.min(999, minutes));
  document.getElementById('durationDisplay').textContent = compState.targetMinutes;
  if (compState.mode === 'countdown') updateCompDisplay();
}

/* ---- 铃声 ---- */
function initRingtone() {
  const saved = lsGet('compRingtone', null);
  if (saved) {
    compState.ringtoneData = saved.data;
    compState.ringtoneName = saved.name || '自定义铃声';
    document.getElementById('ringtoneStatus').textContent = compState.ringtoneName;
  }
}

function toggleRingtonePanel() {
  const panel = document.getElementById('ringtonePanel');
  const arrow = document.getElementById('ringtoneArrow');
  panel.classList.toggle('open');
  arrow.classList.toggle('open');
}

function uploadRingtone() {
  document.getElementById('ringtoneFileInput').click();
}

function handleRingtoneFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    compState.ringtoneData = ev.target.result;
    compState.ringtoneName = file.name;
    lsSet('compRingtone', { data: ev.target.result, name: file.name });
    document.getElementById('ringtoneStatus').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

function testRingtone() {
  if (compState.ringtoneData) {
    const audio = new Audio(compState.ringtoneData);
    audio.play().catch(e => console.log('铃声播放失败:', e));
  }
}

function resetRingtone() {
  compState.ringtoneData = null;
  compState.ringtoneName = '默认铃声';
  lsSet('compRingtone', null);
  document.getElementById('ringtoneStatus').textContent = '默认铃声';
}

/* 专注结束提示音（由原 playAlarmSound 迁移而来，仅专注提醒用） */
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    setTimeout(() => { osc.frequency.value = 660; }, 200);
    setTimeout(() => { osc.frequency.value = 880; }, 400);
    setTimeout(() => { osc.stop(); ctx.close(); }, 700);
  } catch(e) {}
}

function playCompCompleteSound() {
  if (compState.ringtoneData) {
    try {
      const audio = new Audio(compState.ringtoneData);
      audio.play().catch(e => {});
    } catch(e) {}
  } else {
    playBeep(); // 默认提示音
  }
}

/* ---- 专注记录页 ---- */
let compRecordsTab = 'week';

function switchCompRecordsTab(tab) {
  compRecordsTab = tab;
  document.querySelectorAll('.records-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderCompRecords();
}

function renderCompRecords() {
  const container = document.getElementById('compRecordsContent');
  if (!container) return;
  const allRecords = getCompRecords();

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); weekStart.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let filtered = allRecords;
  if (compRecordsTab === 'week') filtered = allRecords.filter(r => r.date >= weekStart.getTime());
  else if (compRecordsTab === 'month') filtered = allRecords.filter(r => r.date >= monthStart.getTime());

  // 统计
  const totalTime = filtered.reduce((s, r) => s + r.duration, 0);
  const h = Math.floor(totalTime / 3600);
  const m = Math.floor((totalTime % 3600) / 60);
  document.getElementById('recordsCount').textContent = filtered.length;
  document.getElementById('recordsTime').textContent = h > 0 ? `${h}时${m}分` : `${m}分`;

  // 列表
  const list = document.getElementById('recordsList');
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div class="record-empty">还没有记录<br>开始一次专注吧</div>';
    return;
  }
  filtered.slice(0, 50).forEach(r => {
    const d = new Date(r.date);
    const dateStr = (d.getMonth()+1)+'月'+d.getDate()+'日';
    const mins = Math.floor(r.duration / 60);
    const secs = r.duration % 60;
    const el = document.createElement('div');
    el.className = 'record-item';
    el.innerHTML = `<div class="ri-left"><div class="ri-task">${escHtml(r.task || r.activity)}</div><div class="ri-time">${dateStr} · ${mins}分${secs}秒</div></div><div>${r.mode === 'countdown' ? '⏳' : '⌛'}</div>`;
    list.appendChild(el);
  });
}

/* ---- 全屏计时器（专注伴伴风格） ---- */
function enterFullscreenTimer() {
  const overlay = document.getElementById('timerFullscreen');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.getElementById('timerDisplay').textContent = document.getElementById('companionTimer').textContent;
  document.getElementById('timerStatusLine').textContent = compState.taskName || compState.activity;

  // 启动AI气泡定时器
  if (compState.running && apiConfig.apiKey) {
    scheduleAiBubble();
  }
}

function exitFullscreenTimer() {
  document.getElementById('timerFullscreen').style.display = 'none';
  clearTimeout(compState._bubbleTimer);
}

function scheduleAiBubble() {
  if (!compState.running) return;
  clearTimeout(compState._bubbleTimer);
  const delay = 30000 + Math.random() * 90000; // 30-120秒随机
  compState._bubbleTimer = setTimeout(async () => {
    if (!compState.running) return;
    await generateAiBubble();
    scheduleAiBubble();
  }, delay);
}

async function generateAiBubble() {
  if (!apiConfig.apiKey) return;
  const pName = personaData.name || '小伴';
  const mins = Math.floor(compState.seconds / 60);
  try {
    const prompt = `你是${pName}。${personaData.story ? '你的性格：'+personaData.story : ''}
用户正在专注「${compState.taskName}」，已经坚持了${mins}分钟。请说一句简短的话（1句话，不超过20字）：
- 可以鼓励、吐槽、闲聊，符合你性格
- 不要用动作描写，不要加emoji
- 语气自然，像微信消息`;

    const reply = await callLLMApi(prompt);
    if (reply && compState.running) {
      compState.aiBubbles.push(reply);
      showBubble(reply);
      addChatSystem(`💬 ${pName}：${reply}`);
    }
  } catch(e) {}
}

function showBubble(text) {
  const container = document.getElementById('bubbleContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'bubble';
  el.innerHTML = `<div class="bubble-ai-name">${escHtml(personaData.name || '小伴')}</div><div class="bubble-text">${escHtml(text)}</div>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .5s'; setTimeout(() => el.remove(), 500); }, 6000);
}

/* ---- visibilitychange ---- */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && compState.running) {
    compState._pausedByHidden = true;
    compPause();
  } else if (!document.hidden && compState._pausedByHidden) {
    delete compState._pausedByHidden;
    compStart();
  }
});
