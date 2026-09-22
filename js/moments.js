/* ==================== 11. 朋友圈 ==================== */
let moments = lsGet('moments', []);
// 迁移：清理历史动态里的配图字段（v5.4.0 起朋友圈不再配图）
var _momHasPhoto = moments.some(function(_m) { return !!_m.photo; });
if (_momHasPhoto) {
  moments.forEach(function(_m) { delete _m.photo; });
  lsSet('moments', moments);
}

function showMomentEditor() {
  const content = prompt('发布新动态：');
  if (content && content.trim()) {
    addMoment('我', content.trim());
    setTimeout(() => aiCommentMoment(0), 1500);
    setTimeout(() => respondToMoment(0), 2500);
  }
}

function addMoment(user, content) {
  const m = { user, content, time: Date.now(), likes: 0, liked: false, comments: [] };
  moments.unshift(m);
  lsSet('moments', moments);
  // 记录用户最近的动态，供他发圈呼应
  if (user === '我') {
    lsSet('lastUserMoment', { content: content, time: Date.now() });
  }
  renderMoments();
}

/* ---- 工具：判断 AI 回复是否有效（非空、非纯符号） ---- */
function isValidAiReply(text) {
  if (!text || text.length < 2) return false;
  // 纯标点/空格/语气词不算有效回复
  if (/^[。，、！？…\.\,\!\?\s\-\～\~]+$/.test(text)) return false;
  return true;
}

async function aiCommentMoment(index, charId) {
  if (!apiConfig || !apiConfig.apiKey || index >= moments.length) {
    console.log('[朋友圈] 跳过评论: 无API Key');
    return;
  }
  const m = moments[index];
  // 指定 charId 时用该角色的人设（如他回应）；不传则用当前选中角色
  const targetPers = charId ? lsGet('persona_' + charId, null) : null;
  const pName = charId
    ? (targetPers?.name || getCharById(charId)?.name || '小伴')
    : (personaData.name || '小伴');
  if (m.user === pName) return;
  const rawStory = charId
    ? (targetPers?.story || getCharById(charId)?.story || '')
    : (personaData.story || '');
  const rawSp = charId
    ? (lsGet('sp_' + charId, '') || '')
    : (systemPrompt || '');
  const charVoice = rawStory ? '你的性格/背景：' + rawStory : '';
  const charSp = rawSp ? '你的说话风格：' + rawSp : '';

  try {
    var resp = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
      body: JSON.stringify({
        model: apiConfig.model || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: '你叫' + pName + '。' + charVoice + (charSp ? '\n' + charSp : '') + '\n请评论好友的朋友圈，1-2句话。直接写评论内容，不要加引号和emoji。评论要针对内容来写。' + actionBanLine() },
          { role: 'user', content: m.content }
        ],
        max_tokens: 150,
        temperature: 0.85
      })
    });
    if (!resp.ok) {
      var errText = await resp.text().catch(function() { return ''; });
      console.log('[朋友圈] AI评论 API错误:', resp.status, errText.substring(0,80));
      var chatMsg = '⚠️ 朋友圈评论API错误(' + resp.status + ')，使用本地回复';
      if (typeof addChatSystem === 'function') addChatSystem(chatMsg);
    } else {
      var data = await resp.json();
      // 完整的API响应调试
      var choice0 = data.choices && data.choices[0];
      var msg = choice0 && choice0.message;
      var finishReason = choice0 && choice0.finish_reason;
      console.log('[朋友圈] API原始响应:', JSON.stringify({ model: data.model, finish: finishReason, contentLen: msg ? (msg.content || '').length : -1 }).substring(0, 120));
      var comment = msg ? (msg.content || '').trim() : '';
      if (comment && comment.length >= 2 && !/^[。，、！？…\.\,\!\?\s\-\～\~]+$/.test(comment)) {
        if (!moments[index].comments) moments[index].comments = [];
        moments[index].comments.push({ user: pName, content: comment, time: Date.now() });
        lsSet('moments', moments);
        renderMoments();
        return;
      }
      console.log('[朋友圈] AI评论内容无效:', JSON.stringify(comment || '(空/无内容)'), 'finish_reason:', finishReason);
    }
  } catch(e) {
    console.log('[朋友圈] AI评论异常:', e?.message?.substring(0,80));
    if (typeof addChatSystem === 'function') addChatSystem('⚠️ 朋友圈评论API异常: ' + e?.message?.substring(0,40));
  }

  // 降级
  var fb = _fallbackMomentComment(m.content, pName, rawStory);
  if (fb) {
    if (!moments[index].comments) moments[index].comments = [];
    moments[index].comments.push({ user: pName, content: fb, time: Date.now() });
    lsSet('moments', moments);
    renderMoments();
  }
}

/* ---- 固定词汇降级（API全部失败时的最后防线） ---- */
function _fallbackMomentComment(content, pName, charStory) {
  var t = content || '';
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test((charStory || personaData.story || '').toLowerCase());
  if (/吃|饭|食堂|外卖|好吃|饿|喝|奶茶|咖啡/.test(t)) return isTsundere ? '又吃。' : '好吃吗？';
  if (/累|困|熬夜|失眠|辛苦/.test(t)) return isTsundere ? '……歇着吧。' : '辛苦了';
  if (/考试|学习|复习|作业|论文/.test(t)) return isTsundere ? '学你的吧。' : '加油';
  if (/开心|高兴|快乐|好玩|好棒/.test(t)) return isTsundere ? '啧。' : '真好呀';
  if (/难过|伤心|哭|不开心|emo/.test(t)) return isTsundere ? '……怎么了' : '抱抱';
  return isTsundere ? '……哦。' : '看到了';
}

/* ---- 他主动回应动态 + 私聊 ---- */
function _fallbackMomentDm(content) {
  var t = content || '';
  if (/吃|饭|食堂|外卖|好吃|饿|喝|奶茶|咖啡/.test(t)) return '啧，又吃。……好吃吗。';
  if (/累|困|熬夜|失眠|辛苦/.test(t)) return '……又熬夜。随你。';
  if (/难过|伤心|哭|不开心|emo/.test(t)) return '……看到你那条朋友圈了。别想太多。';
  if (/考试|学习|复习|作业|论文/.test(t)) return '学习？……行吧，别太拼。';
  if (/开心|高兴|快乐|好玩|好棒/.test(t)) return '……看到你发圈了。哼，还行。';
  return '……看到你发朋友圈了。';
}

async function generateMomentDm(content, ai) {
  if (apiConfig && apiConfig.apiKey) {
    var reply = await callLightLlm(
      '你是' + ai.name + '。' + (ai.story ? '你的性格/背景：' + ai.story : '') +
      '\n你刚在朋友圈看到用户发了一条动态，私聊她。1-2句话，符合你的性格：嘴硬、简短、带点在意。不要动作描写，不要emoji。',
      content
    );
    if (reply && reply.length > 2) return reply;
  }
  return _fallbackMomentDm(content);
}

// 用户发动态后，他主动回应（评论 + 概率私聊）
async function respondToMoment(index) {
  if (currentCharId === 'ai') return; // 当前已在他聊天，他自己发动态后会评论
  var ai = getCharById('ai');
  if (!ai) return;
  if (!apiConfig || !apiConfig.apiKey || index >= moments.length) return;
  var m = moments[index];
  if (!m || m.user !== '我') return; // 只回应用户发的动态

  // 2 小时冷却 + 每日 2 次
  var cd = lsGet('momentReplyCooldown', {});
  if (Date.now() - (cd.ai || 0) < 2 * 60 * 60 * 1000) return;
  var todayStr = new Date().toISOString().split('T')[0];
  var daily = lsGet('momentReplyDaily', {});
  if ((daily[todayStr] || 0) >= 2) return;

  // 他评论（有 API 走 aiCommentMoment，无 API 主动补降级）
  if (apiConfig.apiKey) {
    await aiCommentMoment(index, 'ai');
  } else {
    var pName = lsGet('persona_ai', null)?.name || ai.name || '他';
    var fb = _fallbackMomentComment(m.content, pName, ai.story);
    if (fb) {
      if (!moments[index].comments) moments[index].comments = [];
      moments[index].comments.push({ user: pName, content: fb, time: Date.now() });
      lsSet('moments', moments);
      renderMoments();
    }
  }

  // 40% 概率私聊
  if (Math.random() < 0.4) {
    var dm = await generateMomentDm(m.content, ai);
    if (dm) pushCharMessage('ai', dm);
  }

  // 25% 概率自己也发一条相关的圈（回应式发圈）
  if (Math.random() < 0.25) {
    postRelatedMoment(m.content);
  }

  cd.ai = Date.now();
  lsSet('momentReplyCooldown', cd);
  daily[todayStr] = (daily[todayStr] || 0) + 1;
  lsSet('momentReplyDaily', daily);
}

// 用户发动态后，他有概率也发一条相关的圈（回应式发圈）
function _fallbackRelatedMoment(userContent) {
  var t = userContent || '';
  if (/吃|饭|奶茶|咖啡|喝|好吃/.test(t)) return '今天喝了杯奶茶，还行。……某人倒是挺爱这口的。';
  if (/累|熬夜|困|失眠/.test(t)) return '……又是熬夜的一天。反正没人管。';
  if (/开心|高兴|好玩|好棒/.test(t)) return '今天天气不错。……也挺好。';
  if (/难过|哭|不开心|emo/.test(t)) return '窗外的灯还亮着。想说什么的时候，其实有人在听。';
  if (/学习|考试|作业|论文/.test(t)) return '今天居然翻了两页书。……别学我，我那是闲着。';
  return '今天没什么特别的。……嗯，就这样。';
}

async function postRelatedMoment(userContent) {
  var ai = getCharById('ai');
  if (!ai) return;
  var pers = lsGet('persona_ai', null);
  var pName = pers?.name || ai.name || '他';
  var story = pers?.story || ai.story || '';

  // 每天最多一条（自动 + 聊天 + 回应式都算）
  if (momentPostedToday(pName)) return;

  var content = null;
  if (apiConfig && apiConfig.apiKey) {
    var reply = await callLightLlm(
      '你是' + pName + '。' + (story ? '你的性格/背景：' + story : '') +
      '\n用户刚发了条朋友圈：「' + userContent.substring(0, 20) + '」，你也发一条朋友圈，有感而发、隐隐呼应她（别直接@她，别点破）。嘴硬声线，像真人的日常碎碎念，1-2句话，不用引号不用emoji，20字以内。',
      '发一条呼应她的朋友圈'
    );
    if (reply && reply.length >= 2) content = reply;
  }
  if (!content) content = _fallbackRelatedMoment(userContent);
  if (!content) return;

  moments.unshift({ user: pName, content: content, time: Date.now(), likes: 0, liked: false, comments: [] });
  lsSet('moments', moments);
  renderMoments();
}

function renderMoments() {
  const list = document.getElementById('momentsList');
  list.innerHTML = '';
  if (moments.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:14px;">还没有动态<br>点右上角 ✏️ 发一条吧</div>';
    return;
  }
  moments.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'moment-card';
    const timeStr = m.time ? formatTime(m.time) : '刚刚';
    const isAi = m.user !== '我';
    let commentsHtml = '';
    if (m.comments && m.comments.length > 0) {
      commentsHtml = '<div class="moment-comments">' + m.comments.map((c, ci) =>
        `<div class="moment-comment-item">
          <b>${escHtml(c.user)}</b>：${escHtml(c.content)}
          <span class="moment-reply-btn" onclick="replyToComment(${i},${ci})">回复</span>
        </div>`
      ).join('') + '</div>';
    }
    el.innerHTML = `
      <div class="moment-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="moment-user" style="${isAi?'font-style:italic;color:#666;':''}">${escHtml(m.user)}</div>
        </div>
        <div class="moment-time">${timeStr}</div>
      </div>
      <div class="moment-content">${escHtml(m.content)}</div>
      <div class="moment-actions">
        <div class="moment-like ${m.liked?'liked':''}" onclick="toggleLike(${i})">
          ${m.liked?'❤️':'🤍'} ${m.likes||0}
        </div>
        <div class="moment-comment" onclick="commentOnMoment(${i})">💬 ${m.comments?m.comments.length:0}</div>
      </div>
      ${commentsHtml}
    `;
    list.appendChild(el);
  });
}

function commentOnMoment(index) {
  const text = prompt('写评论：');
  if (text && text.trim()) {
    if (!moments[index].comments) moments[index].comments = [];
    moments[index].comments.push({ user: '我', content: text.trim(), time: Date.now() });
    lsSet('moments', moments);
    renderMoments();
    setTimeout(() => aiReplyComment(index), 1500);
  }
}

function replyToComment(momentIdx, commentIdx) {
  const m = moments[momentIdx];
  if (!m || !m.comments || !m.comments[commentIdx]) return;
  const target = m.comments[commentIdx];
  const text = prompt('回复 ' + target.user + '：');
  if (text && text.trim()) {
    if (!moments[momentIdx].comments) moments[momentIdx].comments = [];
    const replyText = '回复 @' + target.user + '：' + text.trim();
    moments[momentIdx].comments.push({ user: '我', content: replyText, time: Date.now() });
    lsSet('moments', moments);
    renderMoments();
    setTimeout(() => aiReplyComment(momentIdx), 1500);
  }
}

async function aiReplyComment(index) {
  if (!apiConfig || !apiConfig.apiKey || index >= moments.length) return;
  const m = moments[index];
  const pName = personaData.name || '小伴';
  var isMyMoment = m.user === pName;
  const lastComment = m.comments[m.comments.length - 1];
  if (!lastComment || lastComment.user === pName) return;
  const charVoice = personaData.story ? '你的性格/背景：' + personaData.story : '';
  const charSp = systemPrompt ? '你的说话风格：' + systemPrompt : '';
  var ownerLabel = isMyMoment ? "你的" : "用户的";

  try {
    var resp = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
      body: JSON.stringify({
        model: apiConfig.model || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: '你叫' + pName + '。' + charVoice + (charSp ? '\n' + charSp : '') + '\n回复对方的一句评论，1句话。直接写回复内容，不要加引号和emoji。' + actionBanLine() },
          { role: 'user', content: '原动态：' + m.content + '\n对方说：' + lastComment.content }
        ],
        max_tokens: 150,
        temperature: 0.85
      })
    });
    if (!resp.ok) {
      var errText2 = await resp.text().catch(function() { return ''; });
      console.log('[朋友圈] AI回复评论错误:', resp.status, errText2.substring(0, 60));
      if (typeof addChatSystem === 'function') addChatSystem('⚠️ 朋友圈评论回复API错误(' + resp.status + ')');
    } else {
      var data2 = await resp.json();
      var reply = data2.choices?.[0]?.message?.content?.trim();
      if (reply && reply.length >= 2 && !/^[。，、！？…\.\,\!\?\s\-\～\~]+$/.test(reply)) {
        moments[index].comments.push({ user: pName, content: reply, time: Date.now() });
        lsSet('moments', moments);
        renderMoments();
        return;
      }
      console.log('[朋友圈] AI回复评论内容无效:', reply);
    }
  } catch(e) {
    console.log('[朋友圈] AI回复评论异常:', e?.message?.substring(0, 80));
    if (typeof addChatSystem === 'function') addChatSystem('⚠️ 朋友圈评论回复异常: ' + e?.message?.substring(0, 40));
  }

  // 降级
  var fb2 = _fallbackCommentReply(lastComment.content);
  if (fb2) {
    moments[index].comments.push({ user: pName, content: fb2, time: Date.now() });
    lsSet('moments', moments);
    renderMoments();
  }
}

/* ---- 评论回复降级 ---- */
function _fallbackCommentReply(userText) {
  var isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test((personaData.story || '').toLowerCase());
  if (/好|不错|好看/.test(userText)) return isT ? '嗯。' : '谢谢';
  if (/问|吗|什么|怎么|哪/.test(userText)) return isT ? '自己想。' : '让我想想';
  return isT ? '啧。' : '嗯嗯';
}

function toggleLike(i) {
  moments[i].liked = !moments[i].liked;
  moments[i].likes = (moments[i].likes||0) + (moments[i].liked ? 1 : -1);
  lsSet('moments', moments);
  renderMoments();
}

async function addAiMoment() {
  const pName = personaData.name || '小伴';
  const story = personaData.story || '';
  const sp = systemPrompt || '';
  if (apiConfig.apiKey) {
    try {
      let contextInfo = '当前时间：' + new Date().toLocaleString('zh-CN');
      if (weatherData && Date.now() - weatherData.time < 3600000) contextInfo += `\n天气：${weatherData.desc}，${weatherData.temp}°C`;
      if (tasks.filter(t=>!t.done).length > 0) contextInfo += `\n未完成任务：${tasks.filter(t=>!t.done).length}个`;
      const todayStr = new Date().toISOString().split('T')[0];
      if (moodData[todayStr]) contextInfo += `\n今天心情：${moodData[todayStr].emoji} ${moodData[todayStr].label}`;
      if (tideData.periods.length > 0) {
        const predictions = getPredictedPeriods();
        if (predictions.length > 0) {
          const daysUntil = Math.ceil((new Date(predictions[0].start) - new Date()) / (1000*60*60*24));
          if (daysUntil > 0 && daysUntil <= 7) contextInfo += `\n用户经期约${daysUntil}天后`;
        }
      }

      const sysPrompt = `你是${pName}，要发一条朋友圈。${story ? '你的性格/背景：' + story : ''}${sp ? '\n你的说话风格：' + sp : ''}
根据当前环境信息写一条简短有趣的动态（1-2句话），符合你的性格，可以关心用户、分享心情、提建议等。

要求：
- 内容必须有实质性信息，不能只发标点符号或语气词
- 符合你的人设风格
- 结合环境信息自然表达，不要生硬罗列
- 不要用引号，不要加emoji
- 字数限制在20字以内，像真实朋友圈那样简洁`;

      if (checkRecentAiMoments(pName)) {
        contextInfo += '\n\n注意：你刚才已经发过动态了，这次发的内容不要和上一条重复，换个话题。';
      }

      const resp = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({ model: apiConfig.model || 'deepseek-v4-flash', messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: contextInfo }
        ], max_tokens: 64, temperature: 0.9 })
      });
      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (isValidAiReply(content)) {
          moments.unshift({ user: pName, content, time: Date.now(), likes: 0, liked: false, comments: [] });
          lsSet('moments', moments);
          renderMoments();
          return;
        }
      }
    } catch(e) { console.log('[朋友圈] AI发动态失败:', e?.message?.substring(0,60)); }
  }

  // 降级——人设感知
  var storyLower = (story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(storyLower);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(storyLower);
  var hour = new Date().getHours();
  var hasWeather = weatherData && Date.now() - weatherData.time < 3600000;
  var templates = [];

  if (isTsundere) {
    if (hour < 9) templates.push('……早。');
    else if (hour >= 22) templates.push('今天要结束了。');
    else templates.push('啧。','无聊。');
  } else if (isGentle) {
    if (hour < 9) templates.push('早安呀～');
    else if (hour >= 22) templates.push('晚安好梦🌙');
    else templates.push('今天也很好呢♡');
  } else {
    if (hour < 9) templates.push('早。');
    else if (hour >= 22) templates.push('夜。');
    else templates.push('今日。');
  }
  if (hasWeather) {
    if (weatherData.code >= 61) templates.push('下雨了。记得带伞。');
    else templates.push('今天天气不错。');
  }
  var content = templates[Math.floor(Math.random()*templates.length)];
  moments.unshift({ user: pName, content: content, time: Date.now(), likes: 0, liked: false, comments: [] });
  lsSet('moments', moments);
  renderMoments();
}

/* ---- 检查最近1小时内AI是否发过朋友圈 ---- */
function checkRecentAiMoments(pName) {
  const oneHourAgo = Date.now() - 3600000;
  return moments.some(m => m.user === pName && m.time > oneHourAgo);
}

/* ---- 今日是否已发（每天最多 1 条，自动 + 聊天触发共用） ---- */
function momentPostedToday(pName) {
  var todayStr = new Date().toISOString().split('T')[0];
  return moments.some(function(m) {
    return m.user === pName && m.time && new Date(m.time).toISOString().split('T')[0] === todayStr;
  });
}

/* ---- AI自动发朋友圈（由主动消息轮询触发，每天每角色最多 1 条） ---- */
function checkAutoMomentCondition() {
  if (!settings || !settings.autoMoments) return;
  characters.forEach(function(char) {
    if (momentPostedToday(char.name)) return;   // 每天最多一条
    var charMsgs = chatData[char.id] || [];
    if (charMsgs.length === 0 && Math.random() > 0.1) return;
    generateAutoMoment(char);
  });
}

async function generateAutoMoment(char) {
  var pName = char.name || '小伴';
  var story = char.story || '';
  var charSp = lsGet('sp_' + char.id, char.systemPrompt || '');
  var charPers = lsGet('persona_' + char.id, null);
  var charStory = (charPers && charPers.story) ? charPers.story : char.story;

  if (apiConfig && apiConfig.apiKey) {
    try {
      var contextInfo = '当前时间：' + new Date().toLocaleString('zh-CN');
      if (weatherData && Date.now() - weatherData.time < 3600000) {
        contextInfo += '\n天气：' + weatherData.desc + '，' + weatherData.temp + '°C（湿度' + weatherData.humidity + '%）';
      }
      // 今日心情
      if (typeof moodData !== 'undefined' && moodData) {
        var todayISO = new Date().toISOString().split('T')[0];
        if (moodData[todayISO]) contextInfo += '\n她今天心情：' + moodData[todayISO].emoji + moodData[todayISO].label;
      }
      // 当天倒数日
      if (typeof cdData !== 'undefined' && cdData && cdData.event) {
        contextInfo += '\n纪念日：' + cdData.event;
      }
      // 用户最近动态联动：他有感而发
      var lastUM = lsGet('lastUserMoment', null);
      if (lastUM && Date.now() - lastUM.time < 24 * 60 * 60 * 1000 && char.id === 'ai') {
        contextInfo += '\n用户最近发了条动态：「' + lastUM.content.substring(0, 20) + '」你可以有感而发回应一下（不要@她，就自然地提一嘴）。';
      }
      // 避免重复自己上一条
      var myLast = null;
      for (var mj = 0; mj < moments.length; mj++) {
        if (moments[mj].user === pName) { myLast = moments[mj]; break; }
      }
      if (myLast && myLast.content) {
        contextInfo += '\n你上一条朋友圈是：「' + myLast.content.substring(0, 40) + '」——这次别再发相似的了。';
      }
      var sysPrompt = '你是' + pName + '，今天想发一条朋友圈（一天就这一条，要值得发）。' +
        (charStory ? '\n你的性格/背景：' + charStory : '') +
        (charSp ? '\n你的说话风格：' + charSp : '') +
        '\n\n要求：\n- 像真人发朋友圈：记录当下真实的一刻，有画面、有细节、有情绪，不喊口号、不说教\n- 别写"今天也是美好的一天""又是充实的一天"这种空话，越具体越像真的\n- 可以带上此刻的天气/心情/在吃的东西/在忙的事\n- 写1-3句，读起来自然，别太工整，别用引号，别用emoji\n- 符合你的人设和性格，别跟上一条发过的重复\n- 内容必须有实质信息，不能只发符号或语气词';

      var resp = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
        body: JSON.stringify({ model: apiConfig.model || 'deepseek-v4-flash', messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: contextInfo }
        ], max_tokens: 220, temperature: 0.95 })
      });
      if (resp.ok) {
        var data = await resp.json();
        var content = data.choices?.[0]?.message?.content?.trim();
        if (isValidAiReply(content)) {
          moments.unshift({ user: pName, content: content, time: Date.now(), likes: 0, liked: false, comments: [] });
          lsSet('moments', moments);
          renderMoments();
          return;
        }
      }
    } catch(e) {
      console.log('[自动朋友圈] API失败:', e.message.substring(0, 50));
    }
  }

  // 本地降级——人设感知，动态内容（活人日常：细节+情绪+轻收束）
  var storyLower = (charStory || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(storyLower);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(storyLower);
  var hour = new Date().getHours();
  var templates = [];

  // 结合天气
  var hasWeather = weatherData && Date.now() - weatherData.time < 3600000;
  var isRainy = hasWeather && (weatherData.code >= 61 || (weatherData.desc && weatherData.desc.indexOf('雨') !== -1));
  var temp = hasWeather ? weatherData.temp : null;

  // 结合任务
  var undoneTasks = (typeof tasks !== 'undefined') ? tasks.filter(function(t) { return !t.done; }).length : 0;

  // 用户最近动态（他有感而发）
  var lastUM = lsGet('lastUserMoment', null);
  var hasRecentUserMoment = lastUM && Date.now() - lastUM.time < 24 * 60 * 60 * 1000 && char.id === 'ai';

  if (isTsundere) {
    if (hour < 9) {
      templates.push('……醒了没。','早。','一杯咖啡续命。');
    } else if (hour >= 22) {
      templates.push('今天要结束了。','夜深了。','啧，一天又没了。','台灯还亮着。习惯晚睡了。');
    } else {
      templates.push('今天天气还行。','无聊。','……在干嘛。','晒个太阳。','耳机里单曲循环。','便利店的热拿铁不错。','晚霞还行。拍了一张，懒得发。');
    }
    if (isRainy) templates.push('下雨了。……带伞没。','伞在门口。不知道给谁准备的了。');
    if (temp !== null && temp > 30) templates.push('热死了。…………','风扇呼呼转。');
    if (temp !== null && temp < 5) templates.push('冷。……穿厚点。');
    if (undoneTasks > 3) templates.push('任务还没做完吧你。','一堆破事。……慢慢做。');
  } else if (isGentle) {
    if (hour < 9) {
      templates.push('早安呀~今天也是美好的一天 ☀️','早～昨晚睡得好吗？','今天想喝杯热牛奶。');
    } else if (hour >= 22) {
      templates.push('夜深了，大家晚安好梦 🌙','今天也要结束了，希望你今天过得开心','窗帘拉上，晚安。');
    } else {
      templates.push('今天心情很好，希望你也一样 ♡','想分享今日份的温柔给你','悄悄许个愿，希望你开心','今天的天空很好看✨','路过一家花店，花香真好闻','泡了杯茶，慢慢喝。');
    }
    if (isRainy) templates.push('外面下雨了~记得带伞哦','下雨天适合窝在家里，泡杯热茶','雨声很好听。');
    if (temp !== null && temp > 30) templates.push('好热呀，注意防暑～');
    if (temp !== null && temp < 5) templates.push('好冷，记得多穿点呀');
    if (undoneTasks > 3) templates.push('任务有点多呢，慢慢来，不着急～');
  } else {
    if (hour < 9) templates.push('早。');
    else if (hour >= 22) templates.push('夜。','不早了。');
    else templates.push('今日。','记录一下。','天气不错。');
    if (isRainy) templates.push('下雨。带伞。');
  }

  // 通用
  if (hour >= 12 && hour <= 14) templates.push('午饭时间。','午休。饭点了。');
  if (isRainy) templates.push('下雨天。');
  if (temp !== null && temp < 5) templates.push('好冷。注意保暖。');

  // 他回应式发圈：用户最近发过动态时优先有感而发
  if (hasRecentUserMoment) {
    var related = _fallbackRelatedMoment(lastUM.content);
    if (related) templates.push(related);
  }

  var content = templates[Math.floor(Math.random() * templates.length)];
  moments.unshift({ user: pName, content: content, time: Date.now(), likes: 0, liked: false, comments: [] });
  lsSet('moments', moments);
  renderMoments();
}
