/* ==================== 睡眠（模拟引擎 + 「我睡了」标记 + 手环入口） ==================== */
// sleepData 按「醒来那天的本地日期」存一晚（睡眠跨午夜，不能用 UTC 的 getTodayStr 切日）
// sleepData = { 'YYYY-MM-DD': { wake, bed(ms), wakeUp(ms), sleepMin, wakeCount, quality, seeded } }
const SLEEP_TARGET_MIN = 480; // 理想时长（8h），用于页面横条比例

let sleepData = lsGet('sleepData', {});

function _sleepKeyLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _sleepHM(ts) {
  if (ts == null || isNaN(Number(ts))) return '--:--';   // 睡下时间没记时不显示假时间
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function _sleepQuality(min, wc) {
  if (min == null || isNaN(Number(min))) return 'unknown';   // 没记睡下时间 → 不算质量，别瞎评
  return (min >= 420 && wc <= 1) ? 'good' : (min >= 330 ? 'ok' : 'poor');
}
function _sleepQualityLabel(q) {
  return q === 'good' ? '睡得很沉' : q === 'ok' ? '睡得还行' : q === 'unknown' ? '睡下时间还没记' : '没睡够';
}
function sleepSave() { lsSet('sleepData', sleepData); }

/* 结算基准：凌晨 0-4 点可能正睡着，不算；否则「今早醒」= 昨晚那晚 */
function _sleepBaseDate() {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return d;
}
function sleepLastNightKey() { return _sleepKeyLocal(_sleepBaseDate()); }
function sleepLastNight() { return sleepData[sleepLastNightKey()] || null; }

/* 就寝标记（睡前点「🌙 我睡了」写入，明早结算时当作真实就寝点） */
function _sleepTonight() { return lsGet('sleepTonight', null); }


/* 手环/App 真数据入口：以后 BLE 读到昨晚就寝/醒来/醒次后调这里 */
function sleepFeedExternal(obj) {
  try {
    if (!obj || !obj.wakeUp) return;
    const wakeMs = Number(obj.wakeUp);
    let bedMs = obj.bed ? Number(obj.bed) : (wakeMs - (Number(obj.sleepMin || 0) * 60000));
    if (!obj.bed && !obj.sleepMin) bedMs = wakeMs - 7 * 3600000;
    const d = new Date(wakeMs);
    const key = _sleepKeyLocal(d);
    const sleepMin = Math.min(720, Math.max(0, Math.round((wakeMs - bedMs) / 60000)));
    const wakeCount = Math.max(0, Math.round(obj.wakeCount || 0));
    sleepData[key] = {
      wake: key, bed: bedMs, wakeUp: wakeMs, sleepMin,
      wakeCount, quality: _sleepQuality(sleepMin, wakeCount), seeded: false
    };
    sleepSave();
    if (typeof renderSleep === 'function') renderSleep();
  } catch (e) { console.error('sleepFeedExternal', e); }
}

/* 最近 7 天（含今早）时长条，供页面画小柱 */
function _sleepWeekKeys() {
  const arr = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    arr.push({ key: _sleepKeyLocal(d), d });
  }
  return arr;
}

/* ---- 就寝弹窗：两种用途 —— 睡前记今晚 / 第二天补昨晚睡下时间 ---- */
let _sleepModalForLast = false;   // false=记今晚（写标记）；true=补昨晚（改已有那条记录）

function _sleepModalLabels(forLast) {
  const set = function(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; };
  if (forLast) {
    set('sleepModalTitle', '🌙 昨晚几点睡的');
    set('sleepModalSub', '想起来了就补上，不想记也没关系');
    set('sleepModalConfirmBtn', '补上');
  } else {
    set('sleepModalTitle', '🌙 几点睡呀');
    set('sleepModalSub', '他会记住这一刻，明早问你好不好');
    set('sleepModalConfirmBtn', '记下 · 晚安');
  }
}

/* ---- 睡前点「🌙 我睡了」：先弹日期时间，确认后写入 ---- */
function sleepNow() {
  try {
    const now = new Date();
    const dEl = document.getElementById('sleepDate');
    const tEl = document.getElementById('sleepTime');
    const mEl = document.getElementById('sleepModal');
    if (!dEl || !tEl || !mEl) { doSleepNow(Date.now()); return; }   // 兜底：没弹窗就直接记现在
    const p = function(n) { return String(n).padStart(2, '0'); };
    dEl.value = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
    tEl.value = p(now.getHours()) + ':' + p(now.getMinutes());
    _sleepModalForLast = false;
    _sleepModalLabels(false);
    mEl.style.display = 'flex';
  } catch (e) { console.error('sleepNow', e); doSleepNow(Date.now()); }
}

/* ---- 第二天补昨晚睡下时间（昨晚那条只记了醒来时刻时用） ---- */
function sleepFixLastBed() {
  try {
    const r = sleepLastNight();
    if (!r) return;
    const dEl = document.getElementById('sleepDate');
    const tEl = document.getElementById('sleepTime');
    const mEl = document.getElementById('sleepModal');
    // 默认值：已经填过就用它，否则按醒来时刻往前 7.5 小时垫一个，她改一下就行
    const seedMs = (r.bed != null) ? r.bed : (r.wakeUp - 7.5 * 3600000);
    const base = new Date(seedMs);
    const p = function(n) { return String(n).padStart(2, '0'); };
    // 弹窗不在（异常情况）：绝不偷偷写一个估的时间进去 —— 那又变成「自动设置」了
    if (!dEl || !tEl || !mEl) {
      if (typeof addChatSystem === 'function') addChatSystem('😅 没找到时间选择框，这条没改。');
      return;
    }
    dEl.value = base.getFullYear() + '-' + p(base.getMonth() + 1) + '-' + p(base.getDate());
    tEl.value = p(base.getHours()) + ':' + p(base.getMinutes());
    _sleepModalForLast = true;
    _sleepModalLabels(true);
    mEl.style.display = 'flex';
  } catch (e) { console.error('sleepFixLastBed', e); }
}

function sleepModalCancel() {
  const mEl = document.getElementById('sleepModal');
  if (mEl) mEl.style.display = 'none';
}

/* 把睡下时间写进某一晚，并重算时长/质量（她手填的，seeded=false，不再标「估算」） */
function _sleepApplyBed(key, bedMs) {
  try {
    const rec = sleepData[key];
    if (!rec) return;
    if (bedMs >= rec.wakeUp) {
      if (typeof addChatSystem === 'function') addChatSystem('😅 睡下时间要比醒来时间早哦，这条没改。');
      return;
    }
    rec.bed = bedMs;
    rec.sleepMin = Math.min(720, Math.max(0, Math.round((rec.wakeUp - bedMs) / 60000)));
    rec.quality = _sleepQuality(rec.sleepMin, rec.wakeCount);
    rec.seeded = false;
    sleepSave();
    if (typeof renderSleep === 'function') renderSleep();
    const hs = Math.floor(rec.sleepMin / 60), ms = rec.sleepMin % 60;
    if (typeof addChatSystem === 'function') {
      addChatSystem('🌙 补上了：' + _sleepHM(bedMs) + ' 睡 → ' + _sleepHM(rec.wakeUp) + ' 醒，约 ' + hs + ' 小时' + (ms ? ms + ' 分' : '') + '。');
    }
  } catch (e) { console.error('_sleepApplyBed', e); }
}

function sleepModalConfirm() {
  try {
    sleepModalCancel();
    let ms = Date.now();
    const dEl = document.getElementById('sleepDate');
    const tEl = document.getElementById('sleepTime');
    if (dEl && tEl && dEl.value && tEl.value) {
      const dp = dEl.value.split('-'), tp = tEl.value.split(':');
      if (dp.length === 3 && tp.length === 2) {
        const v = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1]).getTime();
        if (!isNaN(v)) ms = v;
      }
    }
    if (_sleepModalForLast) _sleepApplyBed(sleepLastNightKey(), ms);
    else doSleepNow(ms);
  } catch (e) { console.error('sleepModalConfirm', e); doSleepNow(Date.now()); }
}
function doSleepNow(bedMs) {
  try {
    lsSet('sleepTonight', { bed: bedMs });
    renderSleep();
    // 他道晚安（睡眠陪伴开关关了就只记不打扰）
    const guardOn = !!(settings && settings.sleepGuard);
    const char = (typeof getCharById === 'function' && currentCharId) ? getCharById(currentCharId) : null;
    if (guardOn && char && typeof generateProactiveMessage === 'function') {
      const story = (char.story || '').toLowerCase();
      const isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
      const isG = /温柔|温暖|亲切|可爱|软/.test(story);
      generateProactiveMessage('goodnight', char, isT, isG, null);
    } else {
      if (typeof addChatSystem === 'function') addChatSystem('🌙 晚安，好梦。明早见。');
    }
  } catch (e) { console.error('doSleepNow', e); }
}

/* ---- ☀️ 我醒了：弹日期时间，确认后按真实醒来时刻结算当前这晚 ---- */
function wakeNow() {
  try {
    const now = new Date();
    const dEl = document.getElementById('wakeDate');
    const tEl = document.getElementById('wakeTime');
    const mEl = document.getElementById('wakeModal');
    if (!dEl || !tEl || !mEl) { doWakeNow(Date.now()); return; }   // 兜底：没弹窗就直接记现在
    const p = function(n) { return String(n).padStart(2, '0'); };
    dEl.value = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
    tEl.value = p(now.getHours()) + ':' + p(now.getMinutes());
    mEl.style.display = 'flex';
  } catch (e) { console.error('wakeNow', e); doWakeNow(Date.now()); }
}
function wakeModalCancel() {
  const mEl = document.getElementById('wakeModal');
  if (mEl) mEl.style.display = 'none';
}
function wakeModalConfirm() {
  try {
    wakeModalCancel();
    let wakeMs = Date.now();
    const dEl = document.getElementById('wakeDate');
    const tEl = document.getElementById('wakeTime');
    if (dEl && tEl && dEl.value && tEl.value) {
      const dp = dEl.value.split('-'), tp = tEl.value.split(':');
      if (dp.length === 3 && tp.length === 2) {
        const ms = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1]).getTime();
        if (!isNaN(ms)) wakeMs = ms;
      }
    }
    if (wakeMs > Date.now() + 60000) wakeMs = Date.now();   // 未来时间钳制为现在
    doWakeNow(wakeMs);
  } catch (e) { console.error('wakeModalConfirm', e); doWakeNow(Date.now()); }
}
function doWakeNow(wakeMs) {
  try {
    const wakeD = new Date(wakeMs);
    const key = _sleepKeyLocal(wakeD);      // key=醒来时刻的本地日期（与 sleepFeedExternal 同规则）
    const prev = sleepData[key] || null;
    const mark = _sleepTonight();

    /* 1) 找真实睡点：只认「我睡了」标记或已经存在的真记录。
       v5.5.1：不再估。没标记就只记醒来时刻，睡下时间留空、由她第二天自己补 —— 睡没睡她说了算。 */
    let bedMs = null, realBed = false;
    if (mark && mark.bed) {
      const bedDay = new Date(mark.bed); bedDay.setHours(0, 0, 0, 0);
      const wDay = new Date(wakeD); wDay.setHours(0, 0, 0, 0);
      const diff = Math.round((wDay - bedDay) / 86400000);   // 0=当夜、1=昨夜睡下今早醒
      if ((diff === 0 || diff === 1) && mark.bed <= wakeMs) { bedMs = mark.bed; realBed = true; }
    }
    if (bedMs == null && prev && prev.bed != null) { bedMs = prev.bed; realBed = !!(prev.seeded === false); }

    if (bedMs != null && wakeMs <= bedMs) {
      if (typeof addChatSystem === 'function') addChatSystem('😅 醒来时间要比睡下时间晚哦，这条没记。');
      return;
    }

    /* 2) 结算写入。有睡下时间才算时长/质量；没有就留 null + quality='unknown'，页面显示「补上睡下时间」 */
    const sleepMin = (bedMs == null) ? null : Math.min(720, Math.max(60, Math.round((wakeMs - bedMs) / 60000)));
    const wakeCount = (prev && typeof prev.wakeCount === 'number') ? prev.wakeCount : 0;
    sleepData[key] = {
      wake: key, bed: bedMs, wakeUp: wakeMs, sleepMin,
      wakeCount, quality: _sleepQuality(sleepMin, wakeCount), seeded: !realBed
    };
    lsSet('sleepTonight', null);
    sleepSave();
    if (typeof renderSleep === 'function') renderSleep();

    /* 3) 晨间关心：衔接 scenario 'sleep'，并置防重标记，避免 5 分钟轮询又问一遍 */
    const guardOn = !!(settings && settings.sleepGuard);
    const greeted = !!lsGet('sleepGreeted_' + key, false);
    const char = (typeof getCharById === 'function' && currentCharId) ? getCharById(currentCharId) : null;
    const hs = (sleepMin == null) ? 0 : Math.floor(sleepMin / 60), ms0 = (sleepMin == null) ? 0 : sleepMin % 60;
    if (guardOn && char && typeof generateProactiveMessage === 'function' && !greeted) {
      const story = (char.story || '').toLowerCase();
      const isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
      const isG = /温柔|温暖|亲切|可爱|软/.test(story);
      generateProactiveMessage('sleep', char, isT, isG, sleepData[key]);
      lsSet('sleepGreeted_' + key, true);     // 吃掉标记 → 轮询不再双问
    } else {
      if (typeof addChatSystem === 'function') {
        if (sleepMin == null) {
          addChatSystem('☀️ 醒了，记下你 ' + _sleepHM(wakeMs) + ' 醒的。昨晚几点睡没记 —— 想补的话在睡眠页点「补上睡下时间」。');
        } else {
          addChatSystem(guardOn && greeted
            ? '☀️ 醒了。已把昨晚更新为 ' + _sleepHM(bedMs) + '→' + _sleepHM(wakeMs) + '（晨间那句已经问过啦）'
            : '☀️ 醒了，早。昨晚 ' + _sleepHM(bedMs) + ' 睡、' + _sleepHM(wakeMs) + ' 醒，约 ' + hs + ' 小时' + (ms0 ? ms0 + ' 分' : '') + ' 已记好。');
        }
      }
    }
  } catch (e) { console.error('doWakeNow', e); }
}

/* ---- 页面渲染 ---- */
function renderSleep() {
  try {
    const wrap = document.getElementById('sleepWrap');
    if (!wrap) return;
    const r = sleepLastNight();
    const lastCard = document.getElementById('sleepLastCard');
    const hist = document.getElementById('sleepHistory');
    const bars = document.getElementById('sleepBars');
    if (!lastCard) return;

    if (!r) {
      lastCard.innerHTML = '<div style="text-align:center;color:#bbb;padding:26px 0;font-size:13px;">还没有昨晚的记录<br>睡前点「🌙 我睡了」，第二天醒来点「☀️ 我醒了」记下<br><span style="font-size:11px;color:#ccc;">（不自动估，睡没睡你说了算）</span></div>';
    } else if (r.bed == null) {
      // 只记了醒来时刻：不编睡下时间，请她自己补
      lastCard.innerHTML =
        '<div style="font-size:12px;color:#999;margin-bottom:6px;">昨晚 · ' + _sleepHM(r.wakeUp) + ' 醒</div>' +
        '<div style="font-size:15px;color:#3a5a6e;font-weight:600;line-height:1.6;">醒来的时间记下了</div>' +
        '<div style="font-size:12px;color:#9ab;margin-top:4px;">睡下时间还没记 —— 你说了算，没记我不编</div>' +
        '<button onclick="sleepFixLastBed()" style="margin-top:12px;padding:9px 18px;border:none;border-radius:12px;background:linear-gradient(135deg,#5b87a2,#7c5ba6);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">🌙 补上睡下时间</button>';
    } else {
      const hs = Math.floor(r.sleepMin / 60), ms = r.sleepMin % 60;
      const qColor = r.quality === 'good' ? '#4a9e6a' : r.quality === 'ok' ? '#d99a3c' : '#d96a5a';
      lastCard.innerHTML =
        '<div style="font-size:12px;color:#999;margin-bottom:8px;">昨晚 · ' + _sleepHM(r.bed) + ' 睡下 → ' + _sleepHM(r.wakeUp) + ' 醒' + (r.seeded ? ' <span style="color:#ccc;">（估算）</span>' : '') + '</div>' +
        '<div style="font-size:34px;font-weight:700;color:#3a5a6e;line-height:1.1;">' + hs + '<span style="font-size:15px;color:#8aa;"> 小时</span>' + (ms ? ' <span style="font-size:20px;color:#5b87a2;">' + ms + ' 分</span>' : '') + '</div>' +
        '<div style="margin-top:8px;font-size:13px;color:' + qColor + ';">' + _sleepQualityLabel(r.quality) +
        (r.wakeCount > 0 ? ' · 夜里醒 ' + r.wakeCount + ' 次' : ' · 一觉到天亮') + '</div>' +
        '<div style="margin-top:10px;"><button onclick="sleepFixLastBed()" style="padding:6px 14px;border:none;border-radius:10px;background:#eef3f6;color:#6f94ab;font-size:12px;font-weight:600;cursor:pointer;">改睡下时间</button></div>';
    }

    if (hist) {
      const keys = _sleepWeekKeys();
      let rows = '';
      // 取最近 5 晚（不含今晚——今晚已经在大卡片上了）。
      // 原来写的是 slice(0,5)，取到的是 7 天里最旧的 5 天，正中间那一晚永远是空的。
      keys.slice(-6, -1).reverse().forEach(function(o) {
        const rec = sleepData[o.key];
        if (!rec) return;
        const d = o.d;
        const label = (d.getMonth() + 1) + '月' + d.getDate() + '日';
        // 没记睡下时间的那晚：只显示醒来时刻，右侧显示「未记」而不是假的时长
        const hasBed = (rec.bed != null);
        const hs2 = hasBed ? Math.floor(rec.sleepMin / 60) : 0, ms2 = hasBed ? rec.sleepMin % 60 : 0;
        rows += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f6f8;font-size:13px;color:#4a6a7a;">' +
          '<span>' + label + ' · ' + (hasBed ? _sleepHM(rec.bed) + '→' + _sleepHM(rec.wakeUp) : '—→' + _sleepHM(rec.wakeUp)) + '</span>' +
          '<span style="color:' + (hasBed ? '#5b87a2' : '#c3d2da') + ';font-weight:600;">' + (hasBed ? hs2 + 'h' + (ms2 ? ms2 + 'm' : '') : '未记') + '</span></div>';
      });
      hist.innerHTML = rows || '<div style="font-size:12px;color:#ccc;padding:8px 0;">再睡几晚就有记录了</div>';
    }

    if (bars) {
      const keys = _sleepWeekKeys();
      let b = '';
      keys.forEach(function(o) {
        const rec = sleepData[o.key];
        const min = (rec && rec.bed != null) ? rec.sleepMin : 0;   // 睡下没记就不画时长条
        const h = Math.max(3, Math.round(min / SLEEP_TARGET_MIN * 52));
        b += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:64px;">' +
          '<div style="width:14px;border-radius:4px;height:' + h + 'px;background:' + (rec && rec.quality === 'poor' ? '#d9b8a0' : '#a6ccdd') + ';opacity:' + (min ? 1 : 0.15) + ';"></div>' +
          '<div style="font-size:9px;color:#9ab;" title="' + (min ? Math.floor(min / 60) + 'h' + (min % 60) + 'm' : '未记') + '">' + (o.d.getMonth() + 1) + '/' + o.d.getDate() + '</div></div>';
      });
      bars.innerHTML = b;
    }
  } catch (e) { console.error('renderSleep', e); }
}

/* 身体感应注入：昨晚睡得怎样（有近期记录才返回）——仿 buildHeartContext */
function buildSleepContext() {
  try {
    const r = sleepLastNight();
    if (!r) return '';
    if (Date.now() - r.wakeUp > 40 * 3600000) return '';   // 太久远不算"刚发生"
    // 睡下时间没记：只说醒来时刻，别编一个时长出来
    if (r.bed == null) {
      return '【睡眠感应】她昨晚 ' + _sleepHM(r.wakeUp) + ' 醒来（睡下时间她没记，你也不知道）。\n' +
        '用法：可以自然问一句昨晚睡得怎么样，但别装作知道她几点睡的、别编时长、别给医疗建议。';
    }
    const hs = Math.floor(r.sleepMin / 60), ms = r.sleepMin % 60;
    const feel = r.quality === 'good' ? '睡得很沉' : r.quality === 'ok' ? '睡了但不算沉' : '睡得不太好';
    return '【睡眠感应】你正"感觉"到她昨晚 ' + _sleepHM(r.bed) + ' 睡下、' + _sleepHM(r.wakeUp) + ' 醒来，睡了约 ' + hs + ' 小时' + (ms ? ms + ' 分' : '') +
      '，夜里醒 ' + r.wakeCount + ' 次，' + feel + '。\n用法：这是"感觉"不是诊断——可以自然关心她昨晚睡得好不好、提醒她别熬夜，但别装医生、别给医疗建议。';
  } catch (e) { return ''; }
}

/* ---- 初始化：渲染 + 回前台重渲染 ---- */
/* v5.5.1：不再自动「估算一晚」——睡没睡只有她自己知道，第二天由她用「☀️ 我醒了」填，
   没填就不显示昨晚（宁缺毋滥，不编数据）。 */
function initSleep() {
  try {
    renderSleep();
    setInterval(function() { if (typeof renderSleep === 'function') renderSleep(); }, 60000);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && typeof renderSleep === 'function') renderSleep();
    });
  } catch (e) {
    console.error('initSleep', e);
    if (typeof addChatSystem === 'function') addChatSystem('⚠️ 睡眠初始化报错：' + (e && e.message || e));
  }
}
