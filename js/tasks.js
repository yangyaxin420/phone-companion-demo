/* ==================== 7. 日程 ==================== */
let tasks = lsGet('tasks', []);
let schedulePreview = null;

function renderSchedule() {
  const list = document.getElementById('scheduleList');
  list.innerHTML = '';
  if (schedulePreview && schedulePreview.length > 0) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'schedule-preview';
    previewDiv.innerHTML = '<div style="font-size:12px;font-weight:600;color:#e65100;margin-bottom:6px;">📋 AI建议的日程 — 点击确认或编辑</div>';
    schedulePreview.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'schedule-preview-item';
      row.innerHTML =
        '<span>' + escHtml(item.text) + '</span>' +
        '<span style="font-size:11px;color:#999;">' + (item.date||'') + ' ' + (item.time||'') + '</span>' +
        '<div>' +
        '<button class="schedule-confirm-btn schedule-edit-btn" onclick="editScheduleItem(' + i + ')">编辑</button>' +
        '<button class="schedule-confirm-btn" onclick="confirmScheduleItem(' + i + ')">✓确认</button>' +
        '</div>';
      previewDiv.appendChild(row);
    });
    const allBtn = document.createElement('button');
    allBtn.className = 'schedule-confirm-btn';
    allBtn.style.cssText = 'display:block;width:100%;margin-top:8px;padding:8px;';
    allBtn.textContent = '全部确认添加';
    allBtn.onclick = confirmAllSchedule;
    previewDiv.appendChild(allBtn);
    list.appendChild(previewDiv);
  }
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const sorted = [...tasks].sort((a,b) => (a.date||'') > (b.date||'') ? 1 : -1);
  let lastDate = '';
  sorted.forEach((t, i) => {
    if (t.date && t.date !== lastDate) {
      const dateLabel = document.createElement('div');
      dateLabel.className = 'schedule-date-group';
      dateLabel.textContent = t.date === todayStr ? '今天 ' + t.date : t.date;
      list.appendChild(dateLabel);
      lastDate = t.date;
    }
    const el = document.createElement('div');
    el.className = 'schedule-item' + (t.done ? ' done' : '');
    el.innerHTML =
      '<div class="schedule-check ' + (t.done?'checked':'') + '" onclick="toggleTask(' + tasks.indexOf(t) + ')">' + (t.done?'✓':'') + '</div>' +
      '<div class="schedule-text">' + escHtml(t.text) + (t.date||t.time ? '<span class="schedule-time"> '+(t.date&&t.date!==todayStr?t.date:'')+' '+(t.time||'')+'</span>' : '') + '</div>' +
      '<div class="schedule-del" onclick="delTask(' + tasks.indexOf(t) + ')">✕</div>';
    list.appendChild(el);
  });
}

function addTask() {
  const inp = document.getElementById('taskInput');
  const text = inp.value.trim();
  if (!text) return;
  tasks.push({ text, done:false, date:'', time:'' });
  lsSet('tasks', tasks);
  inp.value = '';
  renderSchedule();
}

function toggleTask(i) {
  if (!tasks[i]) return;
  tasks[i].done = !tasks[i].done;
  lsSet('tasks', tasks);
  renderSchedule();
}

function delTask(i) {
  if (!tasks[i]) return;
  tasks.splice(i, 1);
  lsSet('tasks', tasks);
  renderSchedule();
}

function confirmScheduleItem(i) {
  const item = schedulePreview[i];
  if (!item) return;
  tasks.push({ text: item.text, done: false, date: item.date || '', time: item.time || '' });
  lsSet('tasks', tasks);
  schedulePreview.splice(i, 1);
  if (schedulePreview.length === 0) schedulePreview = null;
  renderSchedule();
  requestNotificationPermission();
}

function editScheduleItem(i) {
  const item = schedulePreview[i];
  if (!item) return;
  const newText = prompt('任务内容：', item.text);
  if (!newText) return;
  const newDate = prompt('日期（YYYY-MM-DD，不填则不设）：', item.date || '');
  const newTime = prompt('时间（HH:MM，不填则不设）：', item.time || '');
  schedulePreview[i] = { text: newText, date: newDate || '', time: newTime || '' };
  renderSchedule();
}

function confirmAllSchedule() {
  if (!schedulePreview) return;
  schedulePreview.forEach(item => {
    tasks.push({ text: item.text, done: false, date: item.date || '', time: item.time || '' });
  });
  lsSet('tasks', tasks);
  schedulePreview = null;
  renderSchedule();
  requestNotificationPermission();
}

function addSchedulePreview(items) {
  schedulePreview = schedulePreview || [];
  items.forEach(item => {
    if (!schedulePreview.find(s => s.text === item.text)) {
      schedulePreview.push(item);
    }
  });
  renderSchedule();
  addChatSystem('📋 AI为你规划了' + items.length + '项日程，请到日程页面确认');
}

