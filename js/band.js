/* ==================== 18. 手环屏幕预览（0.96" OLED 128×64 单色屏的模拟） ==================== */
/* 手机页面上模拟手环 OLED 会显示的样子：时间 + 心形按 bpm 跳动 + 心电图式曲线 + 体温。
   配色海玻璃系：#ecf6f8 底 / #d0e6ee 框 / #a6ccdd 图形文字 / #c9e9ed 点缀。
   硬件做好后，这就是 ESP32 上那颗小屏幕的 UI 预演。 */

let bandRAF = null;
let bandLastT = 0;
let bandTime = 0; // 心电图滚动相位（秒）

// 从心跳页「⌚ 手环预览」进入
function openBandPreview() {
  if (typeof navigateTo === 'function') navigateTo('page-band');
  bandRefreshStatus();
  startBand();
}

function startBand() {
  if (bandRAF) return;
  bandLastT = 0;
  bandLoop();
}

// 动画循环：只在预览页激活时跑，离开自动停
function bandLoop() {
  bandRAF = requestAnimationFrame(bandLoop);
  const page = document.getElementById('page-band');
  if (!page || !page.classList.contains('active')) {
    cancelAnimationFrame(bandRAF);
    bandRAF = null;
    return;
  }
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (bandLastT === 0) bandLastT = now;
  const dt = Math.min(0.1, (now - bandLastT) / 1000);
  bandLastT = now;
  bandTime += dt;
  drawBand();
}

// 心电图波形：phase 0..1 → 幅值 -1..1（P波→QRS→T波）
function bandEcgValue(phase) {
  const g = (c, w, a) => a * Math.exp(-Math.pow((phase - c) / w, 2));
  return g(0.12, 0.025, 0.3)   // P波
       + g(0.30, 0.012, -0.2)  // Q
       + g(0.33, 0.012, 1.0)   // R峰（最高点）
       + g(0.37, 0.012, -0.3)  // S
       + g(0.52, 0.05, 0.55);  // T波
}

function drawBand() {
  const cv = document.getElementById('bandEcg');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  // 屏幕底色（海玻璃浅色）
  ctx.fillStyle = '#ecf6f8';
  ctx.fillRect(0, 0, W, H);

  const last = (typeof heartLast === 'function') ? heartLast() : null;
  const hr = last ? last.hr : 72;
  const beatDur = 60 / hr; // 一拍多少秒（bpm 越快，波形越密）

  // ---- 时间（大，顶部居中，像真实手环的表盘） ----
  const d = new Date();
  const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a6ccdd';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(timeStr, W / 2, 13);

  // ---- 心电图滚动（最右最新，向左滑） ----
  const yMid = 35, amp = 10;
  ctx.strokeStyle = '#a6ccdd';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const tGlobal = bandTime - (W - 1 - x) / W * beatDur;
    const phase = (((tGlobal % beatDur) + beatDur) % beatDur) / beatDur;
    const y = yMid - bandEcgValue(phase) * amp;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 基线
  ctx.strokeStyle = 'rgba(166,204,221,.35)';
  ctx.beginPath();
  ctx.moveTo(0, yMid); ctx.lineTo(W, yMid);
  ctx.stroke();

  // ---- 心形：R峰到来时鼓一下 ----
  const nowPhase = (((bandTime % beatDur) + beatDur) % beatDur) / beatDur;
  const dp = Math.min(1, Math.abs(nowPhase - 0.33) * 14);
  const pulse = 1 + Math.max(0, 1 - dp) * 0.25; // 峰值 1.25
  drawHeartShape(ctx, 16, 54, 5.5 * pulse);

  // ---- bpm（带单位标签，一眼能读） ----
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a6ccdd';
  ctx.font = 'bold 12px sans-serif';
  const hrW = ctx.measureText(String(hr)).width;
  ctx.fillText(hr, 27, 53);
  ctx.font = '7px sans-serif';
  ctx.fillStyle = 'rgba(166,204,221,.8)';
  ctx.fillText('bpm', 27 + hrW + 3, 53);

  // ---- 体温（右侧，带「体温」标签，清楚） ----
  if (last) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a6ccdd';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(last.temp.toFixed(1) + '°C', W - 6, 53);
    ctx.font = '6px sans-serif';
    ctx.fillStyle = 'rgba(166,204,221,.75)';
    ctx.fillText('体温', W - 6, 44);
  }

  // ---- 顶部名字 + 状态（一行，加粗加深，清楚）+ 电池 ----
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 7px sans-serif';
  ctx.fillStyle = '#a6ccdd';
  ctx.fillText('DEVICE 01 · ' + (heartState.connected ? 'LIVE' : 'SIM'), 2, 2);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < 4 ? '#a6ccdd' : 'rgba(166,204,221,.35)';
    ctx.fillRect(W - 13 + i * 3, 3, 2, 4);
  }
}

function drawHeartShape(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#a6ccdd';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.3);
  ctx.bezierCurveTo(s, -s * 0.5, s, s * 0.8, 0, s * 1.2);
  ctx.bezierCurveTo(-s, s * 0.8, -s, -s * 0.5, 0, s * 0.3);
  ctx.fill();
  ctx.restore();
}

// 预览页下面的连接状态
function bandRefreshStatus() {
  const el = document.getElementById('bandStatus');
  if (el) el.textContent = heartState.connected ? '● 手环已连接 · 真实数据' : '○ 模拟数据 · 和心跳页同一套读数';
}

// 预览页里的「模拟一次读数」（和心跳页「测一次」同一个动作）
function bandReMeasure() {
  if (typeof heartMeasureNow === 'function') heartMeasureNow();
  bandRefreshStatus();
}
