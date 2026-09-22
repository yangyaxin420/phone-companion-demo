/* ==================== 工具函数 ==================== */

function lsGet(key, def) { try { const v = localStorage.getItem('phone_'+key); return v ? JSON.parse(v) : def; } catch(e) { return def; } }
function lsSet(key, val) { try { localStorage.setItem('phone_'+key, JSON.stringify(val)); } catch(e) { showStorageWarning(); } }
function showStorageWarning() { addChatSystem('⚠️ 存储空间不足，部分数据可能无法保存'); }

// 按「禁止动作描写」开关返回禁令文案（供所有 AI 生成路径拼进 prompt）
function actionBanLine() {
  return (settings && settings.disableActions)
    ? '绝对不要用任何动作描写（*微笑*、*叹气*、*摸头*、*脸红*、*低头*、*耸肩*等），只用纯文字。'
    : '';
}

function escHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatTime(ms) {
  const d = new Date(ms);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function formatDate(ms) {
  const d = new Date(ms);
  return (d.getMonth()+1) + '月' + d.getDate() + '日';
}
