/* ==================== 17. 呼吸练习（心跳偏高时他陪你平复） ==================== */

// 4-7-8 呼吸法：吸气4秒 → 屏住7秒 → 呼气8秒，共4轮
const BREATHE_PHASES = [
  { name: '吸气', dur: 4, from: 0.72, to: 1 },
  { name: '屏住', dur: 7, from: 1, to: 1 },
  { name: '呼气', dur: 8, from: 1, to: 0.72 }
];
const BREATHE_CYCLES = 4;

let breatheTimer = null;
let breatheState = null;

// 当前角色的名字（默认他）
function breatheCharName() {
  try {
    var c = getCharById(currentCharId);
    return (c && c.name) ? c.name : '他';
  } catch (e) {
    return '他';
  }
}

// 开始（心跳页「🌬 呼吸练习」按钮 → 这里）
function startBreathing() {
  const overlay = document.getElementById('breatheOverlay');
  if (!overlay) return;
  const titleEl = document.getElementById('breatheTitle');
  if (titleEl) titleEl.textContent = breatheCharName() + ' 陪你 4-7-8 呼吸';
  const last = (typeof heartLast === 'function') ? heartLast() : null;
  if (last && last.hr >= 100) {
    addChatSystem('🌬 ' + breatheCharName() + ' 感觉到你心跳偏快，带你做一组 4-7-8 呼吸…');
  }
  const doneEl = document.getElementById('breatheDone');
  if (doneEl) doneEl.style.display = 'none';
  const closeBtn = document.getElementById('breatheCloseBtn');
  if (closeBtn) { closeBtn.textContent = '结束'; closeBtn.style.display = ''; }
  overlay.style.display = 'flex';
  breatheState = { cycle: 1, phaseIdx: 0, phaseStart: Date.now() };
  breatheTick();
  if (breatheTimer) clearInterval(breatheTimer);
  breatheTimer = setInterval(breatheTick, 100);
}

// 每一帧：更新圆环缩放 + 阶段文字 + 倒计时
function breatheTick() {
  const st = breatheState;
  if (!st) return;
  const now = Date.now();
  let phase = BREATHE_PHASES[st.phaseIdx];
  let elapsed = (now - st.phaseStart) / 1000;
  if (elapsed >= phase.dur) {
    st.phaseIdx++;
    if (st.phaseIdx >= BREATHE_PHASES.length) {
      st.phaseIdx = 0;
      st.cycle++;
      if (st.cycle > BREATHE_CYCLES) { breatheFinish(); return; }
    }
    st.phaseStart = now;
    elapsed = 0;
    phase = BREATHE_PHASES[st.phaseIdx];
  }
  const progress = Math.min(1, elapsed / phase.dur);
  const scale = phase.from + (phase.to - phase.from) * progress;
  const circle = document.getElementById('breatheCircle');
  if (circle) circle.style.transform = 'scale(' + scale.toFixed(3) + ')';
  const phaseEl = document.getElementById('breathePhase');
  if (phaseEl) phaseEl.textContent = phase.name;
  const countEl = document.getElementById('breatheCount');
  if (countEl) countEl.textContent = Math.max(1, Math.ceil(phase.dur - elapsed));
  const roundsEl = document.getElementById('breatheRounds');
  if (roundsEl) roundsEl.textContent = '第 ' + st.cycle + ' 轮 / 共 ' + BREATHE_CYCLES + ' 轮';
}

// 4 轮做完
function breatheFinish() {
  if (breatheTimer) { clearInterval(breatheTimer); breatheTimer = null; }
  const doneEl = document.getElementById('breatheDone');
  if (doneEl) doneEl.style.display = 'block';
  const closeBtn = document.getElementById('breatheCloseBtn');
  if (closeBtn) closeBtn.textContent = '关闭';
  addChatSystem('💬 ' + breatheCharName() + '：呼——吸——好啦，做完了。心里那口气顺了吗？');
}

// 中途结束 / 关闭
function stopBreathing() {
  if (breatheTimer) { clearInterval(breatheTimer); breatheTimer = null; }
  breatheState = null;
  const overlay = document.getElementById('breatheOverlay');
  if (overlay) overlay.style.display = 'none';
}

// 做完呼吸后顺手测一次，能对比"练之前 vs 练之后"的心跳
function breatheFinishAndMeasure() {
  stopBreathing();
  if (typeof heartMeasureNow === 'function') heartMeasureNow();
}
