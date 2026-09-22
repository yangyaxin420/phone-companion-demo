/* ==================== 10. 记账 ==================== */
let expType = 'expense';
let expenseActiveTab = 'expense';
const EXPENSE_CATS = ['餐饮','交通','购物','娱乐','学习','日用','通讯','其他'];
const INCOME_CATS = ['生活费','兼职','红包','理财','报销','其他收入'];

function renderExpense() {
  if (typeof renderExpenseList === 'function') renderExpenseList('expense');
}


function expSetType(type) {
  expType = type;
  renderExpenseCats();
}

function switchExpenseTab(tab) {
  expenseActiveTab = tab;
  document.querySelectorAll('.expense-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('.expense-tab[data-tab="' + tab + '"]').classList.add('active');
  if (tab === 'stats') {
    document.getElementById('expenseListArea').style.display = 'none';
    document.getElementById('expenseStatsArea').style.display = 'block';
    renderExpenseStats();
  } else {
    document.getElementById('expenseListArea').style.display = 'block';
    document.getElementById('expenseStatsArea').style.display = 'none';
    // 切换类型时也更新表单的分类按钮
    expSetType(tab);
    renderExpenseList(tab);
  }
}

function switchStatsTab(tab) {
  document.querySelectorAll('.expense-stats-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('.expense-stats-tab[data-stab="' + tab + '"]').classList.add('active');
  renderExpenseStats();
}

function renderExpenseList(type) {
  const records = getExpRecords();
  const filtered = records.filter(function(r) { return type === 'income' ? r.type === 'income' : r.type !== 'income'; });
  if (filtered.length === 0) {
    document.getElementById('expDetailList').innerHTML = '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">还没有' + (type==='income'?'收入':'支出') + '记录</div>';
    return;
  }
  const sorted = [...filtered].sort(function(a,b) { return (a.date||'') > (b.date||'') ? -1 : 1; });
  const groups = {};
  sorted.forEach(function(r) {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  });
  let h = '';
  Object.keys(groups).forEach(function(date) {
    const items = groups[date];
    h += '<div class="expense-date-group">' + escHtml(date) + '</div>';
    items.forEach(function(r) {
      h += '<div class="expense-detail-item">' +
        '<div class="edi-left"><span class="edi-cat">' + escHtml(r.category) + '</span>' +
        (r.note ? '<span class="edi-note">' + escHtml(r.note) + '</span>' : '') + '</div>' +
        '<div><span class="edi-amount ' + r.type + '">' + (r.type==='income'?'+':'-') + r.amount.toFixed(2) + '</span>' +
        '<span class="edi-del" onclick="delExpense(\'' + r.id + '\')">✕</span></div></div>';
    });
    const dayTotal = items.reduce(function(s,r) { return s + r.amount; }, 0);
    h += '<div style="font-size:11px;color:#999;text-align:right;padding:2px 8px 8px;border-bottom:1px solid #f0f0f0;">小计：' + dayTotal.toFixed(2) + '</div>';
  });
  document.getElementById('expDetailList').innerHTML = h;
}

function renderExpenseStats() {
  const records = getExpRecords();
  const now = new Date();
  const monthPrefix = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const monthRecs = records.filter(function(r) { return r.date && r.date.startsWith(monthPrefix); });
  const totalExpense = monthRecs.filter(function(r) { return r.type !== 'income'; }).reduce(function(s,r) { return s + r.amount; }, 0);
  const totalIncome = monthRecs.filter(function(r) { return r.type === 'income'; }).reduce(function(s,r) { return s + r.amount; }, 0);
  document.getElementById('expSummary').innerHTML =
    '<div class="expense-summary-item"><div class="amount expense">-' + totalExpense.toFixed(2) + '</div><div class="label">支出</div></div>' +
    '<div class="expense-summary-item"><div class="amount income">+' + totalIncome.toFixed(2) + '</div><div class="label">收入</div></div>' +
    '<div class="expense-summary-item"><div class="amount">' + (totalIncome - totalExpense).toFixed(2) + '</div><div class="label">结余</div></div>';
  renderExpensePieChart();
}

function renderExpensePieChart() {
  const canvas = document.getElementById('expChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const records = getExpRecords();
  const now = new Date();
  const monthPrefix = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const monthRecs = records.filter(function(r) { return r.date && r.date.startsWith(monthPrefix); });
  const statsType = document.querySelector('.expense-stats-tab.active')?.dataset?.stab || 'expense';
  const filtered = monthRecs.filter(function(r) { return statsType === 'income' ? r.type === 'income' : r.type !== 'income'; });
  if (filtered.length === 0) {
    ctx.fillStyle = '#ccc'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('暂无数据', w/2, h/2);
    return;
  }
  const catTotals = {};
  filtered.forEach(function(r) { if (!catTotals[r.category]) catTotals[r.category] = 0; catTotals[r.category] += r.amount; });
  const cats = Object.keys(catTotals);
  const total = filtered.reduce(function(s,r) { return s + r.amount; }, 0);
  const pieColors = ['#e76f51','#f4a261','#e9c46a','#2a9d8f','#264653','#a855f7','#ec4899','#f97316','#06b6d4','#84cc16'];
  var cx = 70, cy = 90, radius = 65;
  var angle = -Math.PI / 2;
  cats.forEach(function(cat, i) {
    var slice = (catTotals[cat] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = pieColors[i % pieColors.length];
    ctx.fill();
    angle += slice;
  });
  var lx = 150, ly = 8;
  cats.forEach(function(cat, i) {
    ctx.fillStyle = pieColors[i % pieColors.length];
    ctx.fillRect(lx, ly + i * 18, 12, 12);
    ctx.fillStyle = '#555';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    var pct = (catTotals[cat] / total * 100).toFixed(0);
    ctx.fillText(cat + ' ' + catTotals[cat].toFixed(0) + '元 (' + pct + '%)', lx + 16, ly + i * 18 + 10);
  });
}

function renderExpenseCats() {
  const grid = document.getElementById('expCatGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const cats = expType === 'expense' ? EXPENSE_CATS : INCOME_CATS;
  cats.forEach(function(c) {
    const btn = document.createElement('button');
    btn.className = 'expense-cat-btn' + (c === '其他' ? ' selected' : '');
    btn.textContent = c;
    btn.onclick = function() {
      grid.querySelectorAll('.expense-cat-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
    };
    grid.appendChild(btn);
  });
}

function addExpense() {
  const amount = parseFloat(document.getElementById('expAmount').value);
  if (!amount || amount <= 0) { alert('请输入有效金额'); return; }
  const date = document.getElementById('expDate').value || new Date().toISOString().split('T')[0];
  const recordType = expType; // 直接用当前选中的类型
  const selectedCat = document.getElementById('expCatGrid').querySelector('.expense-cat-btn.selected');
  const category = selectedCat ? selectedCat.textContent : '其他';
  const note = document.getElementById('expNote').value.trim();
  const records = getExpRecords();
  records.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2,6), amount, type: recordType, category, note, date });
  saveExpRecords(records);
  document.getElementById('expAmount').value = '';
  document.getElementById('expNote').value = '';
  renderExpense();
  addChatSystem('💰 已记录' + (recordType==='expense'?'支出':'收入') + '：' + category + ' ' + amount.toFixed(2) + '元' + (note?' ('+note+')':''));
}

function getExpRecords() { try { var r = JSON.parse(localStorage.getItem('expense_records')) || []; var changed = false; r.forEach(function(rec, i) { if (!rec.id) { rec.id = Date.now() + '_' + Math.random().toString(36).slice(2,8); changed = true; } }); if (changed) localStorage.setItem('expense_records', JSON.stringify(r)); return r; } catch(e) { return []; } }
function saveExpRecords(v) { localStorage.setItem('expense_records', JSON.stringify(v)); }

function delExpense(id) {
  var records = getExpRecords();
  records = records.filter(function(r) { return r.id !== id; });
  saveExpRecords(records);
  renderExpense();

}

function exportExpense() {
  const records = getExpRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '记账数据_' + new Date().toISOString().split('T')[0] + '.json';
  a.click(); URL.revokeObjectURL(url);
}

function clearAllExpense() {
  if (!confirm('确认清空所有记账数据？删除后不可恢复。建议先导出备份。')) return;
  if (!confirm('真的全部删除？')) return;
  saveExpRecords([]);
  renderExpense();
  addChatSystem('🗑 所有记账数据已清空');
}

function importExpense(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) { alert('文件格式不对，请选择正确的记账数据文件'); return; }
      const existing = getExpRecords();
      const merged = [...data, ...existing];
      saveExpRecords(merged);
      renderExpense();
      addChatSystem('✅ 已导入 ' + data.length + ' 条记账数据');
    } catch(err) {
      alert('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
}
