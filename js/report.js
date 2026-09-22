/* ==================== 手环健康周报（他每周总结） ==================== */
let _reportSending = false;

function _fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* 本周范围（周一起） */
function getWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=周日
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { startMs: mon.getTime(), startStr: _fmtDate(mon), endStr: _fmtDate(sun) };
}

/* 收集这周的手环数据 + 步数（足迹打卡独立在足迹页，不混进来） */
function collectWeekHealth() {
  const { startMs } = getWeekRange();
  const readings = (heartState.readings || []).filter(r => r.t >= startMs);
  const stat = { count: readings.length, avgHr: null, maxHr: null, minHr: null, avgTemp: null, spikes: 0, lows: 0, days: 0, steps: 0, stepDays: 0, stepsBest: null, sleepDays: 0, avgSleepMin: null, lateNights: 0, sleepBest: null };
  if (readings.length > 0) {
    const hrs = readings.map(r => r.hr);
    const temps = readings.map(r => r.temp);
    stat.avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
    stat.maxHr = Math.max.apply(null, hrs);
    stat.minHr = Math.min.apply(null, hrs);
    stat.spikes = hrs.filter(h => h >= 100).length;
    stat.lows = hrs.filter(h => h <= 50).length;
    const days = {};
    readings.forEach(r => days[new Date(r.t).toISOString().split('T')[0]] = 1);
    stat.days = Object.keys(days).length;
    if (temps.length) stat.avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
  }
  if (typeof weekSteps === 'function') stat.steps = weekSteps();
  if (typeof stepsData !== 'undefined' && stepsData) {
    const dayKeys = Object.keys(stepsData).filter(k => new Date(k + 'T00:00:00').getTime() >= startMs);
    stat.stepDays = dayKeys.length;
    if (dayKeys.length) {
      const vals = dayKeys.map(k => stepsData[k].steps || 0);
      const mx = Math.max.apply(null, vals);
      stat.stepsBest = { date: dayKeys[vals.indexOf(mx)], steps: mx };
    }
  }
  // 睡眠：醒在这一周内的晚数（键是本地醒来日期，按 wakeUp 绝对时间过滤最稳）
  if (typeof sleepData !== 'undefined' && sleepData) {
    const weekEndMs = startMs + 7 * 86400000;
    const sleepKeys = Object.keys(sleepData).filter(function(k) {
      const r = sleepData[k];
      return r && r.wakeUp >= startMs && r.wakeUp < weekEndMs;
    });
    stat.sleepDays = sleepKeys.length;
    if (sleepKeys.length) {
      const mins = sleepKeys.map(function(k) { return sleepData[k].sleepMin || 0; });
      stat.avgSleepMin = Math.round(mins.reduce(function(a, b) { return a + b; }, 0) / mins.length);
      stat.lateNights = sleepKeys.filter(function(k) {
        const bd = new Date(sleepData[k].bed || 0);
        const bMin = bd.getHours() * 60 + bd.getMinutes();
        return bMin >= 30 && bMin <= 180;   // 凌晨 0:30 后才睡才算熬夜
      }).length;
      const mx = Math.max.apply(null, mins);
      stat.sleepBest = { date: sleepKeys[mins.indexOf(mx)].slice(5), min: mx };
    }
  }
  return stat;
}

function buildReportPrompt(stat) {
  let s = '采样 ' + stat.count + ' 次，覆盖 ' + stat.days + ' 天\n'
    + '心率平均 ' + (stat.avgHr != null ? stat.avgHr : '--') + '，最高 ' + (stat.maxHr != null ? stat.maxHr : '--') + '，最低 ' + (stat.minHr != null ? stat.minHr : '--') + '\n'
    + '体温平均 ' + (stat.avgTemp || '--') + '°C\n'
    + '偏高(≥100) ' + stat.spikes + ' 次，偏低(≤50) ' + stat.lows + ' 次\n'
    + '本周步数 ' + (stat.steps || 0) + ' 步' + (stat.stepsBest ? '，最多一天 ' + stat.stepsBest.date.slice(5) + ' 走了 ' + stat.stepsBest.steps + ' 步' : '');
  if (stat.sleepDays) {
    const hh = stat.avgSleepMin != null ? (Math.floor(stat.avgSleepMin / 60) + '小时' + (stat.avgSleepMin % 60 ? stat.avgSleepMin % 60 + '分' : '')) : '--';
    s += '\n睡眠：睡满 ' + stat.sleepDays + ' 晚 · 平均 ' + hh + (stat.lateNights ? ' · 晚于0:30睡 ' + stat.lateNights + ' 晚' : '') + (stat.sleepBest ? ' · 最长一夜 ' + stat.sleepBest.date + ' 睡 ' + Math.floor(stat.sleepBest.min / 60) + 'h' : '');
  }
  return s;
}

async function generateHealthReport() {
  if (_reportSending) return;
  const wrap = document.getElementById('healthReportWrap');
  const btn = document.getElementById('healthReportBtn');
  _reportSending = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 他在看数据…'; }
  if (wrap) { wrap.style.display = 'block'; wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#888;font-size:13px;">📋 他在算你这周…</div>'; }
  const stat = collectWeekHealth();
  try {
    let result;
    if (apiConfig && apiConfig.apiKey) {
      result = await callHealthAI(stat);
    } else {
      await new Promise(r => setTimeout(r, 600));
      result = localHealthReport(stat);
    }
    const item = saveHealthReport(stat, result);
    if (wrap) wrap.innerHTML = healthReportCardHTML(item);
  } catch (e) {
    console.error(e);
    if (wrap) wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#e55;font-size:13px;">❌ ' + (e.message || '生成失败') + '</div>';
  } finally {
    _reportSending = false;
    if (btn) { btn.disabled = false; btn.textContent = '📋 健康周报'; }
  }
}

async function callHealthAI(stat) {
  const pName = (personaData && personaData.name) || '他';
  const charStory = (personaData && personaData.story) || '黑色中长发，灰蓝色眼睛，178cm。ISTP，傲娇暴躁毒舌刻薄，嘴硬心软。';
  const un = (userPersona && userPersona.name) || '你';
  const sp = `你是${pName}。${charStory}
你通过手环能看到${un}这周的身体数据（当前是模拟数据，逻辑一样）。
请用你的风格写一份「健康周报」总结：
- summary：2-3句话总结她这周的身体状态，毒舌但透着关心，像你平时说话那样
- tips：2-3条具体的、可执行的小建议（作息、喝水、心情这些），每条一句话
- 不要肉麻，不要动作描写，不要用emoji

她这周的数据：
${buildReportPrompt(stat)}

返回严格JSON（不要markdown代码块）：
{ "summary": "总结", "tips": ["建议1", "建议2"] }`;
  const apiUrl = (apiConfig.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
    body: JSON.stringify({
      model: apiConfig.model || 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: sp },
        { role: 'user', content: '写吧。' }
      ],
      temperature: 0.8, max_tokens: 512
    })
  });
  if (!resp.ok) throw new Error('API错误(' + resp.status + ')');
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content || '';
  const jm = content.match(/\{[\s\S]*\}/);
  if (jm) {
    const obj = JSON.parse(jm[0]);
    if (obj.summary) return { summary: obj.summary, tips: obj.tips || [] };
  }
  throw new Error('AI没写出来，再试试');
}

/* 没有 API Key 时的本地周报兜底 */
function localHealthReport(stat) {
  let summary;
  if (stat.count === 0) {
    summary = '这周一次都没测。是怕我担心，还是懒得测？……哼，下周记得。';
  } else if (stat.spikes > 0) {
    summary = '这周心率飙到' + stat.maxHr + '了，偏高' + stat.spikes + '次。是不是又熬夜或太紧张？身体是你在用，别不当回事。';
  } else if (stat.avgHr != null && stat.avgHr > 85) {
    summary = '平均' + stat.avgHr + '，整体偏快。放松点，天又没塌。';
  } else {
    summary = '平均' + (stat.avgHr || '--') + '，体温' + (stat.avgTemp || '--') + '°C，整体还行。继续保持，别让我多说。';
  }
  const tips = [];
  if (stat.spikes > 0 || stat.lows > 0) tips.push('心率波动大的时候，试试做个呼吸练习，我陪你。');
  if (stat.count > 0 && stat.days < 4) tips.push('这周只测了' + stat.days + '天，下周每天至少测一次，我才能知道你好不好。');
  if ((stat.steps || 0) > 0) {
    if (stat.steps < 28000) tips.push('这周才走了' + stat.steps + '步。活动太少，出去透透气。');
    else if (stat.steps >= 65000) tips.push('这周走了' + stat.steps + '步，挺能走的。注意别逞强。');
  }
  if (stat.sleepDays && stat.avgSleepMin != null) {
    const sh10 = Math.round(stat.avgSleepMin / 60 * 10) / 10;
    if (stat.avgSleepMin < 390) {
      tips.push('这周平均每晚睡' + sh10 + '小时' + (stat.lateNights ? '，有' + stat.lateNights + '晚拖到后半夜' : '') + '。别跟睡眠欠债。');
    } else if (stat.avgSleepMin >= 450) {
      tips.push('这周平均每晚睡' + sh10 + '小时，作息挺稳，继续保持。');
    }
  }
  tips.push('睡前把手机放远一点，早点睡。');
  if (tips.length < 2) tips.push('周末记得出去走走，别一直窝着。');
  return { summary, tips };
}

/* ===== 存储 & 渲染 ===== */
function saveHealthReport(stat, result) {
  const list = lsGet('health_reports', []);
  const { startStr, endStr } = getWeekRange();
  const item = {
    id: Date.now(), startStr, endStr, stat,
    summary: result.summary, tips: result.tips || [],
    createdAt: new Date().toISOString()
  };
  list.unshift(item);
  if (list.length > 20) list.length = 20;
  lsSet('health_reports', list);
  return item;
}

function healthReportCardHTML(item) {
  const s = item.stat || {};
  const chips = [
    ['采样', s.count + '次'],
    ['平均', s.avgHr != null ? s.avgHr : '--'],
    ['最高', s.maxHr != null ? s.maxHr : '--'],
    ['最低', s.minHr != null ? s.minHr : '--'],
    ['体温', s.avgTemp ? s.avgTemp + '°' : '--'],
    ['步数', s.steps ? s.steps.toLocaleString() : '--']
  ];
  if (s.sleepDays) {
    const sh = s.avgSleepMin != null ? (Math.floor(s.avgSleepMin / 60) + 'h' + (s.avgSleepMin % 60 ? s.avgSleepMin % 60 + 'm' : '')) : '';
    chips.push(['睡眠', s.sleepDays + '晚' + (sh ? '·' + sh : '')]);
  }
  let html = '<div style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
  html += '<div style="font-size:12px;color:#999;margin-bottom:8px;">📋 健康周报 · ' + (item.startStr || '').slice(5) + ' – ' + (item.endStr || '').slice(5) + '</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">' +
    chips.map(c => '<span style="font-size:11px;padding:3px 9px;border-radius:12px;background:#eef4fb;color:#4a7ba6;">' + c[0] + ' ' + c[1] + '</span>').join('') +
    '</div>';
  html += '<div style="font-size:13px;line-height:1.7;color:#334;margin-bottom:8px;">' + escHtml(item.summary || '') + '</div>';
  if (item.tips && item.tips.length) {
    html += '<div style="font-size:12px;color:#888;line-height:1.8;">' + item.tips.map(t => '· ' + escHtml(t)).join('<br>') + '</div>';
  }
  html += '</div>';
  return html;
}

/* 心跳页渲染时调用：有本周周报就展示，没有就显示提示 */
function renderHealthReportArea() {
  const wrap = document.getElementById('healthReportWrap');
  if (!wrap) return;
  wrap.style.display = 'block';
  const list = lsGet('health_reports', []);
  const { startStr } = getWeekRange();
  const thisWeek = list.find(r => r.startStr === startStr);
  if (thisWeek) {
    wrap.innerHTML = healthReportCardHTML(thisWeek);
  } else {
    wrap.innerHTML = '<div style="font-size:12px;color:#bbb;text-align:center;padding:14px;">这周还没总结。点「📋 健康周报」，让他看看你这周的身体数据。</div>';
  }
}
