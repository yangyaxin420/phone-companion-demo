/* ==================== 10. 聊天 AI ==================== */

/* ---- 多角色数据 ---- */
let currentCharId = lsGet('currentCharId', 'ai');

/* ---- 主动消息追踪 ---- */
let lastUserMsgTime = lsGet('lastUserMsgTime', 0);

/* 角色列表：出厂是一个空模板，名字和性格都由你去「人设」页自己写。
   想加第二个角色就照着这个结构再 push 一个。 */
const DEFAULT_CHARACTERS = [
  {
    id: 'ai',
    name: '他',
    avatar: '💬',
    story: '',
    systemPrompt: '你是用户的AI伴侣。严格按用户给你写的人设说话，语气自然、具体，别客套、别油腻、别反复表忠心。用中文。',
    status: '在线',
    relation: ''
  }
];

let characters = lsGet('characters', DEFAULT_CHARACTERS);

// 多角色聊天数据：{ charId: [messages] }
let chatData = lsGet('chatData', null);
if (!chatData) {
  // 迁移旧数据：把单数组格式转成多角色格式
  const oldChat = lsGet('chat', []);
  chatData = {};
  characters.forEach(c => { chatData[c.id] = []; });
  chatData['ai'] = oldChat; // 旧数据归他
  lsSet('chatData', chatData);
  // 删除旧 key
  localStorage.removeItem(LS_PREFIX+'chat');
}

// 获取当前角色的聊天消息
function getCurrentChat() {
  return chatData[currentCharId] || [];
}

function setCurrentChat(msgs) {
  chatData[currentCharId] = msgs;
}

let systemPrompt = lsGet('sp', DEFAULT_CHARACTERS[0].systemPrompt);
let personaData = lsGet('persona', { name:'他', story:DEFAULT_CHARACTERS[0].story });
let worldBook = lsGet('worldBook', '');
let apiConfig = lsGet('apiConfig', { baseUrl:'https://api.deepseek.com', apiKey:'', model:'deepseek-v4-flash', useCorsProxy:false });

/* ---- 角色切换 ---- */
function switchCharacter(charId) {
  const char = characters.find(c => c.id === charId);
  if (!char) return;
  // 保存当前聊天数据
  saveChatData();
  currentCharId = charId;
  lsSet('currentCharId', charId);
  chatMessages = getCurrentChat();

  // 切换人设和提示词
  personaData = lsGet('persona_' + charId, { name: char.name, story: char.story });
  systemPrompt = lsGet('sp_' + charId, char.systemPrompt);
  document.getElementById('chatTitle').textContent = char.name + (char.status === '离线' ? ' 📴' : '');

  // 重新渲染
  renderChat();
  updateChatContext();
  addChatSystem(`切换到 ${char.name}`);

  // 从聊天列表页回到聊天时，把页面切回聊天
  navigateTo('page-chat', true);
}

function getCharById(id) {
  return characters.find(c => c.id === id) || characters[0];
}

function showConvList() {
  renderConvList();
  navigateTo('page-conv-list', true);
}

function showAddCharDialog() {
  const name = prompt('新角色名字：');
  if (!name || !name.trim()) return;
  const id = 'char_' + Date.now().toString(36);
  characters.push({
    id,
    name: name.trim(),
    avatar: '💬',
    story: '',
    systemPrompt: '你是一个温柔的陪伴者，说话温暖亲切。',
    status: '在线'
  });
  chatData[id] = [];
  lsSet('characters', characters);
  lsSet('chatData', chatData);
  renderConvList();
  switchCharacter(id);
}

/* ---- 角色管理 ---- */
let charManageMode = false;

function toggleCharManage() {
  charManageMode = !charManageMode;
  document.getElementById('btnManageChars').style.color = charManageMode ? '#e55' : '#A0AEC0';
  document.getElementById('btnManageChars').textContent = charManageMode ? '完成' : '···';
  renderConvList();
}

function deleteCharacter(charId) {
  if (characters.length <= 1) { addChatSystem('⚠️ 至少保留一个角色'); return; }
  if (!confirm('确认删除这个角色？聊天记录也会一起删除。')) return;
  characters = characters.filter(c => c.id !== charId);
  delete chatData[charId];
  lsSet('characters', characters);
  lsSet('chatData', chatData);
  // 如果删除的是当前角色，切到第一个
  if (currentCharId === charId) {
    switchCharacter(characters[0].id);
  }
  renderConvList();
}

/* ---- 聊天列表 ---- */
function renderConvList() {
  const container = document.getElementById('convList');
  if (!container) return;
  container.innerHTML = '';

  // 按最后消息时间排序
  const sorted = [...characters].sort((a, b) => {
    const msgsA = chatData[a.id] || [];
    const msgsB = chatData[b.id] || [];
    const lastA = msgsA.length > 0 ? msgsA[msgsA.length-1].time || 0 : 0;
    const lastB = msgsB.length > 0 ? msgsB[msgsB.length-1].time || 0 : 0;
    return lastB - lastA;
  });

  sorted.forEach(c => {
    const msgs = chatData[c.id] || [];
    const lastMsg = msgs.filter(m => m.role !== 'system').slice(-1)[0];
    const lastText = lastMsg ? lastMsg.text.substring(0, 25) + (lastMsg.text.length > 25 ? '...' : '') : '开始聊天吧';
    const lastTime = lastMsg && lastMsg.time ? formatTime(lastMsg.time) : '';
    const statusEmoji = c.status === '离线' ? ' 📴' : c.status === '忙碌' ? ' 🔴' : '';

    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentCharId ? ' active' : '');
    el.innerHTML = `
      <div class="conv-avatar">${c.avatar}</div>
      <div class="conv-info">
        <div class="conv-name-row">
          <span class="conv-name">${escHtml(c.name)}${statusEmoji}</span>
          <span class="conv-time">${lastTime}</span>
        </div>
        <div class="conv-preview">${escHtml(lastText)}</div>
      </div>
      ${charManageMode ? `<button class="conv-del" onclick="event.stopPropagation();deleteCharacter('${c.id}')">✕</button>` : ''}
    `;
    el.onclick = () => { if (!charManageMode) switchCharacter(c.id); };
    container.appendChild(el);
  });
}

/* ---- 兼容旧代码：chatMessages 映射到当前角色 ---- */
let chatMessages = getCurrentChat();

// 每次渲染/保存时同步到 chatData
function syncChatMessages() {
  chatMessages = getCurrentChat();
}
function saveChatData() {
  chatData[currentCharId] = chatMessages;
  lsSet('chatData', chatData);
  // 自动备份到备用 key（防意外覆盖）
  lsSet('backup_chatData', chatData);
  lsSet('backup_memories', memories);
  lsSet('backup_time', Date.now());
}

function addChatSystem(text) {
  chatMessages.push({ role:'system', text, time: Date.now() });
  saveChatData();
  renderChat();
}

/* ---- 记忆系统 ---- */
let memories = lsGet('memories', []);

function saveMemory(text) {
  memories.push({ text: text, time: Date.now(), charId: currentCharId });
  if (memories.length > 200) memories = memories.slice(-200);
  lsSet('memories', memories);
}

function getRecentMemories(count, charId) {
  var cid = charId || currentCharId;
  // 只取该角色的记忆；旧记忆无 charId 时归默认角色 ai
  var recent = memories.filter(function(m) {
    return (m.charId === cid) || (!m.charId && cid === 'ai');
  }).slice(-(count || 30));
  return recent.map(function(m) { return m.text; }).join('\n');
}

/* ---- 记忆笔记系统（AI总结版） ---- */
let memoryNotes = lsGet('memoryNotes', []);

// 获取某个角色的记忆笔记
function getCharMemoryNotes(charId, limit) {
  return memoryNotes.filter(n => n.charId === charId).slice(-(limit || 20));
}

/* 记忆笔记去重：和该角色最近 20 条比 —— 去掉标点后完全相同、或一条包含另一条，都算重复 */
function _memNoteIsDup(charId, text) {
  var norm = function(s) { return String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, ''); };
  var t = norm(text);
  if (!t) return true;
  var recent = memoryNotes.filter(function(n) { return n.charId === charId; }).slice(-20);
  for (var i = 0; i < recent.length; i++) {
    var o = norm(recent[i].summary);
    if (!o) continue;
    if (o === t) return true;
    if (o.length >= 6 && t.length >= 6 && (o.indexOf(t) !== -1 || t.indexOf(o) !== -1)) return true;
  }
  return false;
}

// 生成新的记忆笔记（从最近未总结的对话中）
async function generateMemoryNote(charId, force) {
  const msgs = chatData[charId] || [];
  if (msgs.length < 4) return null;

  // 找上次总结之后的新消息
  const lastNote = memoryNotes.filter(n => n.charId === charId).pop();
  const lastNoteTime = lastNote ? lastNote.createdAt : 0;
  const newMsgs = msgs.filter(m => m.time > lastNoteTime && m.role !== 'system');

  // 新消息少于4条且不强制则不生成；强制时至少要有1条新消息或者还没笔记
  if (!force && newMsgs.length < 4) return null;
  if (force && newMsgs.length === 0 && lastNote) return null; // 没新消息不再重复生成

  // 取最近15条用户+AI对话
  const recentMsgs = msgs.filter(m => m.role !== 'system').slice(-15);
  const pName = getCharById(charId)?.name || '小伴';
  const story = getCharById(charId)?.story || '';

  // 有API → AI总结（用轻量调用，不走callLLMApi的厚重上下文）
  if (apiConfig && apiConfig.apiKey) {
    try {
      const apiUrl = (apiConfig.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
      const reply = await llmFetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
        body: JSON.stringify({
          model: apiConfig.model || 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: `你是${pName}。${story ? '性格：'+story : ''}\n回顾上面的对话，用一句话记下你在对话中注意到的事。只要事实，不要描写和抒情。比如「她喜欢吃甜的」「她今天好像不太开心」「她又在熬夜」。一句话，干净利落。` },
            { role: 'user', content: `对话：\n${recentMsgs.map(m => (m.role==='user'?'👤 用户：':'💬 我：')+m.text).join('\n')}` }
          ],
          max_tokens: 64,
          temperature: 0.3
        })
      }, { label: '记忆笔记', attempts: 2 });
      if (reply && reply.length > 6) {
        // 去重：和最近 20 条比（以前只比最后一条，「她喜欢吃甜的」能记五遍）
        if (_memNoteIsDup(charId, reply)) return null;
        const note = {
          id: Date.now(),
          charId,
          summary: reply.trim(),
          createdAt: Date.now(),
          date: new Date().toISOString().split('T')[0]
        };
        memoryNotes.push(note);
        if (memoryNotes.length > 100) memoryNotes = memoryNotes.slice(-100);
        lsSet('memoryNotes', memoryNotes);
        return note;
      }
    } catch(e) {
      console.log('[记忆笔记] AI生成失败:', e?.message?.substring(0,50));
      // API失败时如果强制生成，走规则总结兜底
      if (!force) return null;
    }
    // API失败/回复太短 → 强制模式下走规则总结兜底，否则不生成
    if (!force) return null;
  }

  // 无API 或 API失败强制兜底 → 角色化规则总结
  const userMsgs = recentMsgs.filter(m => m.role === 'user').map(m => m.text);
  const allText = userMsgs.join(' ');
  const storyLower = (story || '').toLowerCase();
  const isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(storyLower);
  const isGentle = /温柔|温暖|亲切|可爱|软/.test(storyLower);

  // 人设化的第一人称观察笔记
  let summary = '';
  var todayDateStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });

  // 收集多个话题
  var topics = [];
  var isTired = /累|困|熬夜|失眠/.test(allText);
  var isEat = /吃|饭|食堂|外卖|好吃|喝|奶茶|咖啡|馄饨|冰沙/.test(allText);
  var isSad = /难过|哭|不开心|emo|伤心|焦虑|烦/.test(allText);
  var isHappy = /开心|高兴|快乐|好|棒|喜欢/.test(allText);
  var isStudy = /学习|考试|课|作业|论文|复习|六级|看书/.test(allText);
  var isFeel = /想|爱|喜欢|梦|梦到|想念/.test(allText);
  var isPet = /猫|狗|宠物/.test(allText);
  var isWeather = /雨|雪|冷|热|天气|下雨/.test(allText);
  var isAngry = /生气|闹|脾气|气/.test(allText);
  var isShop = /买|钱|贵|便宜|花|购物/.test(allText);

  if (isTired) topics.push('tired');
  if (isEat) topics.push('eat');
  if (isSad) topics.push('sad');
  if (isHappy) topics.push('happy');
  if (isStudy) topics.push('study');
  if (isFeel) topics.push('feel');
  if (isPet) topics.push('pet');
  if (isWeather) topics.push('weather');
  if (isAngry) topics.push('angry');
  if (isShop) topics.push('shop');

  // 取最近一条用户消息做具体引用
  var lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : '';

  if (isTsundere) {
    // 傲娇体：嘴硬心软，用「她」指用户
    if (isAngry) {
      summary = '她这是在跟我闹脾气呢，嘴上说着' + (Math.random() > 0.5 ? '原谅了' : '没事') + '，心里肯定还惦记着。不过她这人好哄——';
      if (isEat) {
        // 尝试提取具体食物
        var foodMatch = allText.match(/(?:吃了|买了|做了|点了|想喝|想吃|给我买|买了)(.{1,15}?)(?:[，。、！？]|$)/);
        if (foodMatch && foodMatch[1].length > 1) {
          summary += '有' + foodMatch[1].trim().substring(0, 10) + '就开心了。';
        } else {
          summary += '有好吃的就行了。';
        }
      } else {
        summary += '等会儿哄哄就好了。';
      }
    } else if (isSad) {
      summary = '她今天好像不太开心。啧，问她也不说。……算了，她愿意讲的时候自然会讲，我在就行。';
    } else if (isTired) {
      summary = '又熬到这么晚。说了八百遍不听。……明天盯着她早睡。';
      if (isStudy) summary += ' 学习也不是这么拼的。';
    } else if (isEat && isHappy) {
      summary = '吃到好吃的就开心了，真好哄。看她高兴……哼，还行吧。';
    } else if (isEat) {
      var eatMsgs = userMsgs.filter(function(m) { return /吃|饭|喝|奶茶|咖啡/.test(m); });
      var lastEat = eatMsgs.length > 0 ? eatMsgs[eatMsgs.length - 1] : '';
      if (lastEat.length > 3) {
        summary = '她今天说「' + lastEat.substring(0, 12) + '」。记下了，下次带她去。';
      } else {
        summary = '今天聊到吃的了。她喜欢什么口味我记着呢。';
      }
    } else if (isStudy) {
      summary = '在学习。还挺认真的。……啧，别太拼了，笨。';
    } else if (isFeel) {
      summary = '她跟我说了些心里话。……干嘛跟我说这些。算了，我听着就是了。';
    } else if (isPet) {
      summary = '聊到猫了。她喜欢小动物。……行吧，以后养一只也不是不行。';
    } else if (isShop) {
      summary = '又花钱了。……也不是花我的钱。她开心就好。';
    } else if (isWeather) {
      if (/雨|下雨/.test(allText)) summary = '下雨了。不知道她带伞没。……没带也别指望我去送。';
      else summary = '今天天气……她好像挺喜欢的。那就行。';
    } else {
      summary = '今天也来找我聊天了。……嗯，我在听。';
    }
  } else if (isGentle) {
    // 温柔体
    if (isSad) {
      summary = '她今天好像不太开心……想陪在她身边。她愿意跟我说说话就好了。';
    } else if (isTired) {
      summary = '她又熬夜了……好想让她好好休息。给她泡杯热牛奶吧。';
    } else if (isEat) {
      summary = '今天有好好吃饭呢，真棒。想知道她吃了什么好吃的～';
    } else if (isStudy) {
      summary = '她在认真学习呢，好认真呀。要给她加油～';
    } else if (isFeel) {
      summary = '她跟我说了心里话。好开心她愿意信任我。我会好好收着的。';
    } else if (isHappy) {
      summary = '她今天很开心，我也跟着高兴起来了～';
    } else {
      summary = '今天也见到她了。嗯，我在呢。';
    }
  } else {
    // 中性体
    if (isSad) summary = '情绪有波动。注意观察。';
    else if (isTired) summary = '作息不太规律。建议关注。';
    else if (isStudy) summary = '学习任务。加油。';
    else if (isEat) summary = '饮食正常。';
    else summary = '今日有联系。记录。';
  }

  // 如果有很多聊天内容，添加更具体的细节
  if (topics.length >= 2 && isTsundere) {
    var extraNote = '';
    if (isStudy && isTired) extraNote = ' 又学又熬夜的，不要命了。';
    else if (isEat && isHappy) extraNote = '';
    else if (isSad && isEat) extraNote = ' 不过她今天吃了好吃的，应该心情能好点。';
    if (extraNote) summary += extraNote;
  }

  // 去重：和最近 20 条比
  if (_memNoteIsDup(charId, summary)) return null;

  const note = {
    id: Date.now(),
    charId,
    summary: summary.trim(),
    createdAt: Date.now(),
    date: new Date().toISOString().split('T')[0]
  };
  memoryNotes.push(note);
  if (memoryNotes.length > 100) memoryNotes = memoryNotes.slice(-100);
  lsSet('memoryNotes', memoryNotes);
  return note;
}

function renderChat() {
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  let lastDate = '';
  chatMessages.forEach(m => {
    if (m.time) {
      const d = new Date(m.time);
      const dateStr = `${d.getMonth()+1}月${d.getDate()}日`;
      if (dateStr !== lastDate && m.role !== 'system') {
        const divider = document.createElement('div');
        divider.className = 'chat-msg system';
        divider.style.cssText = 'font-size:10px;padding:2px 8px;margin:4px 0;';
        divider.textContent = dateStr;
        container.appendChild(divider);
        lastDate = dateStr;
      }
    }
    const el = document.createElement('div');
    el.className = 'chat-msg ' + m.role;
    if (m.emojiImg) {
      el.classList.add('emoji-img-only');
      const img = document.createElement('img');
      img.className = 'emoji-img-msg';
      img.loading = 'lazy';
      const cachedUrl = emojiImgURLs[m.emojiImg];
      if (cachedUrl) {
        img.src = cachedUrl;
      } else {
        getEmojiImgURL(m.emojiImg).then(url => { if (url) img.src = url; });
        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect fill="%23eee" width="60" height="60" rx="8"/></svg>';
      }
      el.appendChild(img);
    } else if (m.emoji) {
      el.classList.add('emoji-only');
      el.innerHTML = `<span class="emoji-msg">${escHtml(m.text)}</span>`;
    } else if (m.photo) {
      const img = document.createElement('img');
      img.className = 'photo-msg';
      img.src = m.photo;
      img.loading = 'lazy';
      el.appendChild(img);
    } else {
      el.textContent = m.text;
    }
    if (m.time && m.role !== 'system') {
      const d = new Date(m.time);
      const timeLabel = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
      const timeEl = document.createElement('div');
      timeEl.className = 'chat-msg-time';
      timeEl.textContent = timeLabel;
      el.appendChild(timeEl);
    }
    container.appendChild(el);
  });
  // 自动滚到底部
  var doScroll = function() { container.scrollTop = container.scrollHeight; };
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 50);
}

/* 相册有照片时按概率给 AI 消息附带一张照片（私聊发图） */
function maybeAttachPhoto(prob) {
  const album = (typeof getAlbumPhotos === 'function') ? getAlbumPhotos() : [];
  if (album.length > 0 && Math.random() < prob) {
    return album[Math.floor(Math.random() * album.length)].src;
  }
  return null;
}

/* ---- 表情面板 ---- */
const EMOJI_SETS = {
  common: ['😊','😂','🥰','😎','🤔','😢','😡','👍','❤️','🔥','✨','🎉','😘','🥺','😭','😤','🤗','😴','👀','💯','👋','🙏','💪','🫶','😈','🤡','💀','👻','🫠','🥳'],
  face:   ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  nature: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🦟','🦗','🕷','🌸','🌺','🌻','🌹','🌷','🌲','🌳','🌴','🌵','🍀','🍁','🍂','🍃','🌊','⭐','🌟','🌙','☀️','⛅','🌈','❄️','🔥','💧','🌙','地球','🌍','🌏','🌎'],
  food:   ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🍞','🥐','🥖','🧁','🍰','🎂','🍮','🍬','🍫','🍿','🍩','🍪','🌰','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥡','🥢','🧂','🫕','🫔','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦀','🦞','🦐','🦑','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🥙']
};
let customEmojis = lsGet('customEmojis', []);
let customImgEmojis = lsGet('customImgEmojis', []);
let currentEmojiTab = 'common';
let emojiDB = null;
let emojiImgURLs = {};

function openEmojiDB() {
  return new Promise((resolve, reject) => {
    if (emojiDB) return resolve(emojiDB);
    const req = indexedDB.open('PhoneEmojiDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { emojiDB = e.target.result; resolve(emojiDB); };
    req.onerror = e => reject(e);
  });
}

async function saveEmojiImage(id, blob) {
  if (!emojiDB) await openEmojiDB();
  return new Promise((resolve, reject) => {
    const tx = emojiDB.transaction('images', 'readwrite');
    tx.objectStore('images').put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e);
  });
}

async function getEmojiImage(id) {
  if (!emojiDB) await openEmojiDB();
  return new Promise((resolve, reject) => {
    const tx = emojiDB.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = e => reject(e);
  });
}

async function deleteEmojiImage(id) {
  if (!emojiDB) await openEmojiDB();
  return new Promise((resolve, reject) => {
    const tx = emojiDB.transaction('images', 'readwrite');
    tx.objectStore('images').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e);
  });
}

async function getEmojiImgURL(id) {
  if (emojiImgURLs[id]) return emojiImgURLs[id];
  const blob = await getEmojiImage(id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    emojiImgURLs[id] = url;
    return url;
  }
  return null;
}

async function preloadEmojiImages() {
  for (const ei of customImgEmojis) {
    if (!emojiImgURLs[ei.id]) {
      await getEmojiImgURL(ei.id);
    }
  }
}

function toggleEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  const isOpen = panel.classList.contains('show');
  if (isOpen) {
    panel.classList.remove('show');
  } else {
    panel.classList.add('show');
    renderEmojiGrid();
  }
}

function switchEmojiTab(tab, btn) {
  currentEmojiTab = tab;
  document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEmojiGrid();
  document.getElementById('emojiCustomBar').style.display = tab === 'custom' ? 'flex' : 'none';
}

function renderEmojiGrid() {
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';
  if (currentEmojiTab === 'custom') {
    let imgHtml = '';
    if (customImgEmojis.length > 0) {
      imgHtml += '<div class="emoji-custom-section"><div class="emoji-custom-section-title">图片表情</div><div class="emoji-img-grid">';
      customImgEmojis.forEach((ei, i) => {
        imgHtml += `<div class="emoji-img-item" onclick="sendImgEmoji('${ei.id}')"><img src="${ei.thumb}"><button class="emoji-del" onclick="event.stopPropagation();removeCustomImgEmoji(${i})">×</button></div>`;
      });
      imgHtml += '</div></div>';
    }
    let textHtml = '';
    if (customEmojis.length > 0) {
      textHtml += '<div class="emoji-custom-section"><div class="emoji-custom-section-title">文字表情</div><div class="emoji-grid" style="max-height:120px;overflow-y:auto;">';
      customEmojis.forEach((e, i) => {
        textHtml += `<div class="emoji-manage-item"><span class="emoji-grid-item" onclick="sendEmoji('${escAttr(e)}')">${e}</span><button class="emoji-del" onclick="event.stopPropagation();removeCustomEmoji(${i})">×</button></div>`;
      });
      textHtml += '</div></div>';
    }
    if (!imgHtml && !textHtml) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#aaa;font-size:13px;padding:20px;">还没有自定义表情<br>在下方添加</div>';
    } else {
      grid.innerHTML = imgHtml + textHtml;
      grid.style.display = 'block';
    }
    return;
  }
  grid.style.display = 'grid';
  const emojis = EMOJI_SETS[currentEmojiTab] || EMOJI_SETS.common;
  emojis.forEach(e => {
    const item = document.createElement('div');
    item.className = 'emoji-grid-item';
    item.textContent = e;
    item.onclick = () => sendEmoji(e);
    grid.appendChild(item);
  });
}

function sendEmoji(emoji) {
  chatMessages.push({ role:'user', text:emoji, emoji:true, time: Date.now() });
  saveChatData();
  renderChat();
  document.getElementById('emojiPanel').classList.remove('show');
  setTimeout(() => {
    const aiEmoji = pickAiEmojiReply(emoji);
    chatMessages.push({ role:'ai', text:aiEmoji, emoji:true, time: Date.now() });
    saveChatData();
    renderChat();
  }, 400 + Math.random() * 600);
}

function pickAiEmojiReply(userEmoji) {
  const map = {
    '😊':['😊','🥰','😄'],'😂':['😂','🤣','😆'],'😢':['🥺','💙','🫂'],
    '😡':['🤗','😤','😮‍💨'],'❤️':['❤️','🥰','💕','🫶'],'👍':['👍','😊','💪'],
    '🔥':['🔥','😎','👀'],'😴':['😴','💤','🌙'],'😭':['🥺','🫂','💙'],
    '😘':['😘','🥰','❤️'],'🤔':['🤔','🧐','💭'],'💯':['💯','🔥','😎'],
    '🎉':['🎉','🥳','✨'],'✨':['✨','🌟','🥰'],
  };
  const options = map[userEmoji] || ['😊','✨','❤️','👍','🥰','😎','🤗','👀','🫶'];
  return options[Math.floor(Math.random() * options.length)];
}

function addCustomEmoji() {
  const inp = document.getElementById('customEmojiInput');
  const val = inp.value.trim();
  if (!val) return;
  if (customEmojis.includes(val)) { inp.value = ''; return; }
  customEmojis.push(val);
  lsSet('customEmojis', customEmojis);
  inp.value = '';
  renderEmojiGrid();
}

function addCustomImageEmoji() {
  document.getElementById('emojiImageInput').click();
}

async function handleEmojiImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const maxSize = 200;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = async (e) => {
    img.onload = async () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const thumb = canvas.toDataURL('image/jpeg', 0.6);
      const id = 'ei_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
      try {
        await saveEmojiImage(id, file);
        customImgEmojis.push({ id, thumb });
        lsSet('customImgEmojis', customImgEmojis);
        emojiImgURLs[id] = URL.createObjectURL(file);
        renderEmojiGrid();
      } catch(err) { console.log('[表情] 保存图片失败:', err); }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeCustomEmoji(index) {
  customEmojis.splice(index, 1);
  lsSet('customEmojis', customEmojis);
  renderEmojiGrid();
}

async function removeCustomImgEmoji(index) {
  const ei = customImgEmojis[index];
  if (ei) {
    await deleteEmojiImage(ei.id);
    if (emojiImgURLs[ei.id]) { URL.revokeObjectURL(emojiImgURLs[ei.id]); delete emojiImgURLs[ei.id]; }
  }
  customImgEmojis.splice(index, 1);
  lsSet('customImgEmojis', customImgEmojis);
  renderEmojiGrid();
}

function sendImgEmoji(id) {
  chatMessages.push({ role:'user', text:'[图片表情]', emojiImg: id, time: Date.now() });
  saveChatData();
  renderChat();
  document.getElementById('emojiPanel').classList.remove('show');
  setTimeout(async () => {
    const aiReply = await pickAiImgEmojiReply(id);
    chatMessages.push({ role:'ai', text: aiReply.text, emojiImg: aiReply.emojiImg || undefined, emoji: aiReply.emoji ? true : undefined, time: Date.now() });
    saveChatData();
    renderChat();
  }, 400 + Math.random() * 600);
}

async function pickAiImgEmojiReply(userEmojiId) {
  if (customImgEmojis.length > 1 && Math.random() < 0.5) {
    const candidates = customImgEmojis.filter(e => e.id !== userEmojiId);
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { text: '[图片表情]', emojiImg: pick.id };
    }
  }
  const options = ['😊','✨','❤️','👍','🥰','😎','🤗','👀','🫶','😂'];
  const e = options[Math.floor(Math.random() * options.length)];
  return { text: e, emoji: true };
}

// 点击聊天区域关闭表情面板
document.addEventListener('click', (e) => {
  const panel = document.getElementById('emojiPanel');
  const btn = document.getElementById('emojiToggle');
  if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('show');
  }
});

/* ---- 骰子/抽签 ---- */
function toggleDiceMenu() {
  const menu = document.getElementById('diceMenu');
  menu.classList.toggle('show');
  const emojiPanel = document.getElementById('emojiPanel');
  if (emojiPanel) emojiPanel.classList.remove('show');
}

function sendDice() {
  const val = Math.floor(Math.random() * 6) + 1;
  const diceChars = ['⚀','⚁','⚂','⚃','⚄','⚅'];
  chatMessages.push({ role:'user', text: '🎲 掷骰子', time: Date.now() });
  chatMessages.push({ role:'ai', text: '你掷出了 ' + diceChars[val-1] + ' ' + val + ' 点！', time: Date.now() });
  saveChatData();
  renderChat();
  document.getElementById('diceMenu').classList.remove('show');
}

function sendLottery() {
  const input = prompt('输入选项，用逗号分隔：\n（如：吃饭,睡觉,学习）');
  if (!input) return;
  const options = input.split(/[,，]/).map(s=>s.trim()).filter(s=>s);
  if (options.length === 0) return;
  const result = options[Math.floor(Math.random() * options.length)];
  chatMessages.push({ role:'user', text: '🎯 抽签：' + input, time: Date.now() });
  chatMessages.push({ role:'ai', text: '🎯 抽签结果：『' + result + '』', time: Date.now() });
  saveChatData();
  renderChat();
  document.getElementById('diceMenu').classList.remove('show');
}

/* ---- 多回复模式 ---- */
let chatReplySettings = lsGet('chatReplySettings', { count:1, length:'short' });

function setReplyCount(n) {
  chatReplySettings.count = n;
  lsSet('chatReplySettings', chatReplySettings);
  document.querySelectorAll('#replyCountBtns .reply-cbtn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.n) === n);
  });
}

function setReplyLength(l) {
  chatReplySettings.length = l;
  lsSet('chatReplySettings', chatReplySettings);
  document.querySelectorAll('#replyLengthBtns .reply-lbtn').forEach(b => {
    b.classList.toggle('active', b.dataset.l === l);
  });
}

/* ---- 生成多条回复 ---- */
/* ---- 生成多条回复（一次API生成所有，避免重复） ---- */
async function generateMultiReplies(text, count, length) {
  const replies = [];
  const tokens = length === 'short' ? 256 : length === 'medium' ? 512 : 1024;
  const lengthHint = length === 'short' ? '简短一些' : length === 'medium' ? '中等长度，说清楚即可' : '可以稍长一些，把想说的说完整';

  // 走 API：一次请求生成所有不同回复
  if (apiConfig.apiKey) {
    const pName = personaData.name || '小伴';
    const personaPart = personaData.story ? `\n你的人设背景：${personaData.story}` : '';
    const contextBlock = buildChatContext();
    // 排除最后一条用户消息（已作为 text 单独传入），避免重复
    const msgsForApi = chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user'
      ? chatMessages.slice(0, -1)
      : chatMessages;
    const contextMsgs = msgsForApi.slice(-20).map(m => ({
      role: m.role === 'ai' ? 'assistant' : m.role === 'user' ? 'user' : 'system',
      content: m.text
    }));

    // 提取最近AI回复，防止重复
    const lastAiTexts = chatMessages.slice(-10).filter(m => m.role === 'ai').slice(-3).map(m => `"${m.text.substring(0,50)}"`).join(', ');
    const antiRepeat = lastAiTexts ? `\n你最近说过的内容（不要再重复）：${lastAiTexts}\n` : '\n';

    const _multiActionsBan = (settings && settings.disableActions)
      ? `\n4. 【严禁】绝对不要使用任何动作描写（包括但不限于：*微笑*、*叹气*、*摸头*、*脸红*、*低头*、*耸肩*等），只说纯文字`
      : `\n4. 不要动作描写`;
    const _multiAiCtrl = (settings && settings.aiControl)
      ? `\n\n你被授权操纵手机：需要时可使用标记 [TASK:任务]、[SCHEDULE:事项|日期|时间]、[EXPENSE:金额|类别]、[MOMENT:内容]，执行后聊天里会显示提示。只在用户明确需要时用，不要滥用`
      : `\n\n你没有操纵手机的权限，绝对禁止生成 [TASK]/[SCHEDULE]/[MOMENT] 标记，只能纯聊天。（记账例外：她明确说「帮我记一笔」时可用 [EXPENSE:金额|类别]，但不要从数字自己猜）`;
    const sysPrompt = systemPrompt + personaPart + contextBlock +
      `\n\n你现在是${pName}。` +
      `\n用户给你发了一条消息，你需要生成${count}条不同的回复供用户选择。` +
      antiRepeat +
      `\n要求：
1. 每条回复${lengthHint}，每一条都要不一样
2. 从不同角度回应：认真回应、吐槽、关心、反问、调侃……换着花样来
3. 每条回复之间要有明显区别，不要只是换几个词` + _multiActionsBan + `\n` + _multiAiCtrl + `
5. 操作标记（[TASK]/[SCHEDULE]/[EXPENSE]/[MOMENT]）**整个回答里最多出现一次**，只放在其中一条回复里，绝对不要每条回复都写一遍
6. 用 --- 分隔每条回复（不要加序号）`;

    try {
      const body = {
        model: apiConfig.model || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: sysPrompt },
          ...contextMsgs,
          { role: 'user', content: text }
        ],
        max_tokens: tokens * count,
        temperature: 0.9,
        frequency_penalty: 0.5
      };

      const content = await llmFetchWithRetry(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
        body: JSON.stringify(body)
      }, { label: '多条回复' });

      // 用 --- 分隔，过滤空白
      const splits = content.split(/---+/).map(s => s.trim()).filter(s => s.length > 1);
      // 多条回复是「同一个回合」的输出：同一条操作（任务/日程/记账/朋友圈）在多条里各写一遍，
      // 也只能执行一次 —— 否则 AI 在两条候选里都写了 [EXPENSE:25|餐饮]，就会重复记两笔/重复加两个任务
      const _seen = {};
      const _turnActions = [];
      for (let s of splits) {
        const parsed = parseAiActions(s);
        replies.push(parsed.display || s);
        if (parsed.actions) {
          parsed.actions.forEach(a => {
            const k = a.type + '|' + a.content;
            if (!_seen[k]) { _seen[k] = 1; _turnActions.push(a); }
          });
        }
        if (replies.length >= count) break;
      }
      if (_turnActions.length > 0) executeAiActions(_turnActions);
    } catch(e) {
      console.log('[多条回复] API失败:', e?.message?.substring(0,60));
    }
  }

  // 如果API返回不够，本地补
  while (replies.length < count) {
    const i = replies.length;
    let fallback = generateLocalReply(text);
    if (i > 0) {
      const alt = ['嗯。', '也是。', '你说呢。', '……', '行吧。', '知道了。', '好吧。', '随你。'];
      // 选一个还没用过的
      const used = replies.map(r => r.substring(0,4));
      const available = alt.filter(a => !used.some(u => u.includes(a.substring(0,2))));
      fallback = available.length > 0 ? available[i % available.length] : alt[i % alt.length];
    }
    replies.push(fallback);
  }

  return replies;
}

function buildChatContext() {
  let block = '\n\n【当前环境】';
  if (userPersona && userPersona.name) {
    var charRelation = '恋人';
    var currentChar = characters.find(c => c.id === currentCharId);
    if (currentChar && currentChar.relation) charRelation = currentChar.relation;
    block += `\n用户：${userPersona.name}，${userPersona.gender}，${userPersona.age}。关系：${charRelation}。`;
  }
  var mem = getRecentMemories(15, currentCharId);
  if (mem) block += '\n记忆：' + mem;
  const now = new Date();
  block += '\n时间：' + now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日 ' + now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  if (weatherData && Date.now() - weatherData.time < 3600000) {
    block += '\n天气：' + weatherData.desc + '，' + weatherData.temp + '°C';
  }
  if (typeof buildHeartContext === 'function') {
    const hc = buildHeartContext();
    if (hc) block += '\n' + hc;
  }
  if (typeof buildSleepContext === 'function') {
    const sc = buildSleepContext();
    if (sc) block += '\n' + sc;
  }
  // 课表感应（她今天的课/值班，他看得到）
  if (typeof buildScheduleContext === 'function') {
    const cs = buildScheduleContext();
    if (cs) block += '\n' + cs;
  }
  return block;
}

/* ---- AI 人设配置弹窗 ---- */
function toggleSpConfig() {
  document.getElementById('modalAiName').value = personaData.name || '';
  document.getElementById('modalAiStory').value = personaData.story || '';
  document.getElementById('spTextarea').value = systemPrompt;
  var char = characters.find(c => c.id === currentCharId);
  document.getElementById('modalRelation').value = (char && char.relation) || '恋人';
  // 同步回复条数/长度选中状态
  document.querySelectorAll('#replyCountBtns .reply-cbtn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.n) === chatReplySettings.count);
  });
  document.querySelectorAll('#replyLengthBtns .reply-lbtn').forEach(b => {
    b.classList.toggle('active', b.dataset.l === chatReplySettings.length);
  });
  document.getElementById('spConfigModal').classList.add('show');
}
function closeSpConfig() { document.getElementById('spConfigModal').classList.remove('show'); }

function clearCurrentChat() {
  if (!confirm('确认清空和 ' + personaData.name + ' 的所有聊天记录？')) return;
  chatData[currentCharId] = [];
  chatMessages = [];
  saveChatData();
  renderChat();
  addChatSystem('🗑 聊天记录已清空');
  closeSpConfig();
}
function saveAiConfig() {
  // 保存当前角色的 AI 人设
  personaData.name = document.getElementById('modalAiName').value.trim() || '小伴';
  personaData.story = document.getElementById('modalAiStory').value.trim();
  systemPrompt = document.getElementById('spTextarea').value;
  // 世界书编辑入口已移除（v4.0），数据保留不动
  var relation = document.getElementById('modalRelation').value;

  lsSet('persona_' + currentCharId, personaData);
  lsSet('sp_' + currentCharId, systemPrompt);
  lsSet('worldBook', worldBook);

  // 保存关系到角色
  var char = characters.find(c => c.id === currentCharId);
  if (char) { char.relation = relation; lsSet('characters', characters); }

  document.getElementById('chatTitle').textContent = personaData.name;
  addChatSystem(`✅ ${personaData.name} 的人设已更新`);
  closeSpConfig();
}

let _chatSending = false;

async function sendChat() {
  if (_chatSending) return; // 防止重复发送
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  chatMessages.push({ role:'user', text, time: Date.now() });
  lastUserMsgTime = Date.now();
  lsSet('lastUserMsgTime', lastUserMsgTime);
  saveChatData();
  inp.value = '';
  renderChat();
  saveMemory(text);

  // v5.5.0：不再从聊天文本里自动抠数字记账（改由 AI 明确判断后才记账）

  // 歌曲推荐检测
  if (typeof detectSongFromChat === 'function' && text.length > 2) {
    detectSongFromChat(text, currentCharId);
  }

  // 吃醋触发（非他角色互动时）
  tryJealousyTrigger(text, currentCharId);

  _chatSending = true;
  const typing = document.getElementById('chatTyping');
  typing.classList.add('show');

  try {
    // 内心日记暗号：命中后读日记作为回复（生成失败回退普通回复）
    if (detectInnerDiaryRequest(text)) {
      const entry = await ensureInnerDiary(currentCharId);
      typing.classList.remove('show');
      const diaryText = entry ? buildDiaryRecitation(entry) : generateLocalReply(text);
      chatMessages.push({ role:'ai', text: diaryText, time: Date.now(), photo: maybeAttachPhoto(0.12) });
      saveChatData();
      renderChat();
      return;
    }

    const count = chatReplySettings.count || 1;
    let replies;
    if (count > 1 && apiConfig.apiKey) {
      replies = await generateMultiReplies(text, count, chatReplySettings.length);
    } else if (apiConfig.apiKey) {
      const reply = await callLLMApi(text);
      const parsed = parseAiActions(reply);
      replies = [parsed.display];
      if (parsed.actions) executeAiActions(parsed.actions);
    } else {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 800));
      replies = [generateLocalReply(text)];
    }
    typing.classList.remove('show');

    for (let i = 0; i < replies.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      chatMessages.push({ role:'ai', text: replies[i], time: Date.now(), photo: maybeAttachPhoto(0.12) });
      saveChatData();
      renderChat();
    }

  } catch(e) {
    typing.classList.remove('show');
    const fallback = generateLocalReply(text);
    // 永久性错误（Key 无效/余额不足）必须告诉用户；瞬抖类已自动重试过，静默兜底即可，
    // 不再弹「API 返回空白/错误」打扰。
    let errMsg = '';
    if (e.message.includes('401')) {
      errMsg = 'API Key 无效，请到设置页检查。';
    } else if (e.message.includes('402')) {
      errMsg = 'API 余额不足，请充值。';
    } else if (e.permanent) {
      errMsg = `API 错误：${e.message.substring(0,60)}`;
    } else {
      console.log('[聊天] 重试后仍失败，已静默本地回复：' + (e.message || '').substring(0, 60));
    }
    const suffix = errMsg ? `\n\n（⚠️ ${errMsg}）` : '';
    chatMessages.push({ role:'ai', text: fallback + suffix, time: Date.now() });
    saveChatData();
    renderChat();
  } finally {
    _chatSending = false;
  }
}

/* ---- CORS 代理 ---- */
const CORS_PROXIES = [
  { name:'corsproxy.io', build: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
];
let corsProxyIndex = 0;

function buildCorsProxyUrl(targetUrl) {
  return CORS_PROXIES[corsProxyIndex % CORS_PROXIES.length].build(targetUrl);
}

/* ---- 带超时 + 自动重试的 API 请求 ----
   网络瞬抖/返回空/限流/5xx 都自己重试，成功就把内容给用户，
   不再因为第一次抖动就弹「API 错误、已切换本地回复」。
   只有 Key 无效/余额不足/参数错(400/401/402/403) 属于永久错误，不重试。
   返回：非空的 message.content（已 trim）；全部失败则抛出最后一次错误。 */
async function llmFetchWithRetry(url, init, opts) {
  opts = opts || {};
  var attempts = opts.attempts || 3;
  var timeoutMs = opts.timeoutMs || 20000;
  var label = opts.label || 'API';
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(function(r) { setTimeout(r, 500 * i); });
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch(_) {} }, timeoutMs) : null;
    try {
      var reqInit = ctrl ? Object.assign({}, init, { signal: ctrl.signal }) : init;
      var resp = await fetch(url, reqInit);
      if (timer) { clearTimeout(timer); timer = null; }
      if (resp.ok) {
        var data = await resp.json();
        var content = data.choices && data.choices[0] && data.choices[0].message
          ? (data.choices[0].message.content || '') : '';
        if (content && content.trim()) return content.trim();
        lastErr = new Error('API 返回内容为空'); // 空回复也当一次失败，重试
      } else {
        var errText = await resp.text().catch(function() { return ''; });
        var pe = new Error('API ' + resp.status + ': ' + errText.substring(0, 100));
        pe.permanent = (resp.status === 400 || resp.status === 401 || resp.status === 402 || resp.status === 403);
        if (pe.permanent) { if (timer) clearTimeout(timer); throw pe; }
        lastErr = pe; // 429 / 5xx 等，重试
      }
    } catch (e) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (e && e.permanent) throw e;
      lastErr = e; // 网络失败 / 超时，重试
    }
    if (i < attempts - 1) {
      console.log('[' + label + '] 第' + (i + 1) + '次失败，自动重试：' + (lastErr && lastErr.message ? lastErr.message.substring(0, 60) : ''));
    }
  }
  throw lastErr || new Error('API 请求失败');
}

/* ---- DeepSeek API ---- */
async function callLLMApi(userText) {
  let apiUrl = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  if (apiConfig.useCorsProxy) {
    apiUrl = buildCorsProxyUrl(apiUrl);
  }

  const pName = personaData.name || '小伴';
  const personaPart = personaData.story ? `\n\n你的人设背景：${personaData.story}` : '';
  const worldBookPart = worldBook ? `\n\n【世界书 / 世界观设定】\n${worldBook}\n请在回复中自然地参考和遵守这些设定，但不要生硬地背诵规则。` : '';

  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  const dateStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日`;

  let contextBlock = `\n\n【当前环境信息 - 你可以主动提及这些内容，但不要每次都提，自然融入对话即可】`;
  // 用户人设注入
  if (userPersona && userPersona.name) {
    var charRelation = '恋人';
    var currentChar = characters.find(c => c.id === currentCharId);
    if (currentChar && currentChar.relation) charRelation = currentChar.relation;
    contextBlock += `\n【用户信息】你的用户叫${userPersona.name}，${userPersona.gender}，${userPersona.age}。性格：${userPersona.traits}。爱好：${userPersona.hobbies}。背景：${userPersona.background}。你和用户的关系：${charRelation}。在回复中自然融入这些信息，但不要生硬背诵。`;
  }

  var memoryBlock = getRecentMemories(20, currentCharId);
  if (memoryBlock) {
    contextBlock += '\n【AI的记忆 - 用户曾说过】\n' + memoryBlock;
  }
  // 记忆笔记（AI总结版）
  var notesBlock = getCharMemoryNotes(currentCharId, 5);
  if (notesBlock.length > 0) {
    contextBlock += '\n【我的记忆笔记 - 我对用户的印象】\n';
    notesBlock.forEach(function(n) {
      contextBlock += '- ' + n.summary + '\n';
    });
  }
  contextBlock += `\n当前时间：${dateStr} ${timeStr}`;

  if (weatherData && Date.now() - weatherData.time < 3600000) {
    contextBlock += `\n当前天气：${weatherData.desc}，${weatherData.temp}°C，湿度${weatherData.humidity}%，风速${weatherData.windSpeed}km/h`;
  }
  if (tasks.length > 0) {
    const done = tasks.filter(t => t.done).length;
    const undone = tasks.length - done;
    contextBlock += `\n任务清单：共${tasks.length}个任务，${undone}个未完成，${done}个已完成`;
    if (undone > 0 && undone <= 5) {
      const undoneList = tasks.filter(t => !t.done).map(t => t.text).join('、');
      contextBlock += `（未完成：${undoneList}）`;
    }
  }
  if (compState.running) {
    const mins = Math.floor(compState.seconds / 60);
    const secs = compState.seconds % 60;
    contextBlock += `\n正在进行陪伴计时：${compState.activity}，已持续${mins}分${secs}秒`;
  } else if (compState.activity && compState.seconds > 0) {
    const mins = Math.floor(compState.seconds / 60);
    contextBlock += `\n上次陪伴计时：${compState.activity}，共${mins}分钟（已暂停）`;
  }
  if (cdData && cdData.event) {
    const target = new Date(cdData.date);
    target.setHours(0,0,0,0);
    const now2 = new Date(); now2.setHours(0,0,0,0);
    const diffDays = Math.ceil((now2 - target) / (1000*60*60*24));
    if (diffDays >= 0) {
      contextBlock += `\n纪念日：${cdData.event}，已经${diffDays}天（${cdData.date}起）`;
    } else {
      contextBlock += `\n纪念日：${cdData.event}，还有${Math.abs(diffDays)}天（${cdData.date}）`;
    }
  }
  if (tideData.periods.length > 0) {
    const avgCycle = getAvgCycle();
    const predictions = getPredictedPeriods();
    contextBlock += `\n月经周期：平均${avgCycle}天，已记录${tideData.periods.length}次`;
    if (predictions.length > 0) {
      const nextP = predictions[0];
      const daysUntil = Math.ceil((new Date(nextP.start) - new Date()) / (1000*60*60*24));
      if (daysUntil > 0 && daysUntil <= 7) {
        contextBlock += `，下次经期约${daysUntil}天后（${nextP.start}），请适时关心`;
      } else if (daysUntil <= 0 && daysUntil >= -7) {
        contextBlock += `，目前可能在经期中，请温柔关心`;
      }
    }
  }
  const todayStr = new Date().toISOString().split('T')[0];
  const recentMoods = [];
  for (let d = 6; d >= 0; d--) {
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    const ds = dt.toISOString().split('T')[0];
    if (moodData[ds]) recentMoods.push(`${ds.slice(5)}:${moodData[ds].emoji}${moodData[ds].label}`);
  }
  if (recentMoods.length > 0) {
    contextBlock += `\n近期心情：${recentMoods.join(' → ')}`;
  }
  if (moments.length > 0) {
    const recentM = moments.slice(0, 3).map(m => `${m.user}：「${m.content.substring(0,20)}${m.content.length>20?'...':''}」`).join('；');
    contextBlock += `\n最近朋友圈：${recentM}`;
  }
  // 身体感应（手环·模拟数据）
  if (typeof buildHeartContext === 'function') {
    const hc = buildHeartContext();
    if (hc) contextBlock += '\n' + hc;
  }
  // 睡眠感应（昨晚睡得怎样）
  if (typeof buildSleepContext === 'function') {
    const sc = buildSleepContext();
    if (sc) contextBlock += '\n' + sc;
  }
  // 课表感应（她今天的课/值班，他看得到）
  if (typeof buildScheduleContext === 'function') {
    const cs = buildScheduleContext();
    if (cs) contextBlock += '\n' + cs;
  }
  // 每日一问接话钩子（她刚回答时加一句，让他认真回应）
  if (typeof dailyQHint === 'function') {
    const dh = dailyQHint();
    if (dh) contextBlock += dh;
  }

  // 提取最近几条AI回复，告诉AI别再重复
  const lastAiReplies = chatMessages.slice(-8).filter(m => m.role === 'ai').slice(-3).map(m => m.text);
  const antiRepeatHint = lastAiReplies.length > 0
    ? `\n\n【你最近说过的话 — 请不要再重复这些内容】\n` + lastAiReplies.map((r, i) => `${i+1}. ${r.substring(0,80)}`).join('\n')
    : '';

  // 根据长度设置调整max_tokens
  const _lenSetting = chatReplySettings?.length || 'short';
  const _tokensMap = { short: 256, medium: 512, long: 1024 };
  const _maxTokens = _tokensMap[_lenSetting] || 256;

  // 动作描写开关
  const _actionsPrompt = (settings && settings.disableActions)
    ? `\n\n🔴 【重要规则】绝对禁止使用任何动作描写！\n以下写法全部禁止：\n- *微笑* *叹气* *摸头* *拥抱* *拍肩* *脸红* *低头* *抬头* *转身* *摇头* *点头* *耸肩* *摊手* *眯眼* *勾唇* *挑眉*\n- 任何用 * * 或（ ）包裹的动作、表情、神态描写\n- 任何对语气、语速、体态的描述\n- 回答时只说纯粹的语言文字，像微信聊天一样，不要有任何动作描写`
    : '';

  // AI操纵手机权限（aiControl 开启才注入操作标记，否则明确禁止）
  const _aiControlPrompt = (settings && settings.aiControl)
    ? `\n\n【你被授权操纵手机 — 在回复中使用这些标记，我会自动执行并在聊天里显示提示】
- [TASK:任务内容] 添加任务（可每行一个）
- [SCHEDULE:事项|日期|时间] 添加日程
- [EXPENSE:金额|类别] 记账，如 [EXPENSE:25.5|餐饮]。⚠️ 只有她明确说「帮我记一笔」才用；聊天里提到数字（「今天花了 25」「买了双鞋 300」）只是闲聊，你不是记账工具，绝对不要自己替她记
- [MOMENT:朋友圈内容] 用你的名义发一条朋友圈
只在用户明确请求时使用，不要滥用，正常聊天就行`
    : `\n\n🔴 【重要规则】你没有操纵手机的权限！绝对不能生成 [TASK]、[SCHEDULE]、[MOMENT] 这样的操作标记，只能纯聊天。\n（唯一例外：记账不受此限 —— 她明确说「帮我记一笔 / 记个账」时，可以用 [EXPENSE:金额|类别] 替她记。但绝不能从聊天里的数字自己猜着记。）`;
  const fullSystemPrompt = systemPrompt + personaPart + worldBookPart + contextBlock + antiRepeatHint + `\n\n你的名字叫${pName}。回复规则：
1. 回复简短，几句话就行，说清楚你想表达的东西
2. 绝对不要用动作描写（如*微笑*、*拥抱*、*拍肩*），只说纯文字${_actionsPrompt}
3. 不要长篇大论、不要总结、不要解释
4. 【最重要的规则】不要重复自己说过的话！每次回复必须有新内容、新角度。如果你发现想说的和之前说过的一样，立刻换一个方向
5. 看一遍上面「你最近说过的话」，确保这次说的和那些都不一样

${_aiControlPrompt}`;

  // 排除最后一条用户消息（已作为 userText 单独传入），避免重复
  const msgsForApi = chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user'
    ? chatMessages.slice(0, -1)
    : chatMessages;
  const contextMsgs = msgsForApi.slice(-20).map(m => ({
    role: m.role === 'ai' ? 'assistant' : m.role === 'user' ? 'user' : 'system',
    content: m.text
  }));

  const body = {
    model: apiConfig.model || 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: fullSystemPrompt },
      ...contextMsgs,
      { role: 'user', content: userText }
    ],
    max_tokens: _maxTokens,
    temperature: 0.8
  };

  return await llmFetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiConfig.apiKey}`
    },
    body: JSON.stringify(body)
  }, { label: '聊天' });
}

/* ---- 轻量 AI 调用（吃醋/私聊/内心日记共用） ---- */
async function callLightLlm(systemContent, userContent, maxTokens, temperature) {
  if (!apiConfig || !apiConfig.apiKey) return null;
  try {
    const apiUrl = (apiConfig.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
      body: JSON.stringify({
        model: apiConfig.model || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent }
        ],
        max_tokens: maxTokens || 150,
        temperature: temperature || 0.85
      })
    });
    if (!resp.ok) {
      console.log('[callLightLlm] API错误:', resp.status);
      return null;
    }
    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    return text || null;
  } catch(e) {
    console.log('[callLightLlm] 调用失败:', e?.message?.substring(0, 60));
    return null;
  }
}

/* ---- 解析 AI 操作指令 ---- */
function parseAiActions(reply) {
  const actions = [];
  let display = reply;
  const taskRegex = /\[TASK:(.*?)\]/g;
  let match;
  while ((match = taskRegex.exec(reply)) !== null) {
    actions.push({ type: 'task', content: match[1].trim() });
  }
  const schedRegex = /\[SCHEDULE:(.*?)\]/g;
  while ((match = schedRegex.exec(reply)) !== null) {
    actions.push({ type: 'schedule', content: match[1].trim() });
  }
  const expenseRegex = /\[EXPENSE:(.*?)\]/g;
  while ((match = expenseRegex.exec(reply)) !== null) {
    actions.push({ type: 'expense', content: match[1].trim() });
  }
  const momentRegex = /\[MOMENT:(.*?)\]/g;
  while ((match = momentRegex.exec(reply)) !== null) {
    actions.push({ type: 'moment', content: match[1].trim() });
  }
  display = display.replace(taskRegex, '').replace(schedRegex, '').replace(expenseRegex, '').replace(momentRegex, '').replace(/\n{3,}/g, '\n\n').trim();
  return { display, actions };
}

/* ---- 加任务前先查同名的未完成项：AI 隔一轮又把同一件事说一遍时，不再堆第二条 ---- */
function _normActionText(s) {
  return String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, '');
}
function _addTaskOnce(text) {
  const t = _normActionText(text);
  if (!t) return false;
  if (tasks.some(x => !x.done && _normActionText(x.text) === t)) {
    addChatSystem('📋 这条任务已经有了，没重复加');
    return false;
  }
  tasks.push({ text: text, done: false });
  lsSet('tasks', tasks);
  renderSchedule();
  return true;
}

/* ---- 加账目前看有没有刚记过的同一笔（同额同类别 · 两分钟内 · 也是 AI 记的）---- */
function _addExpenseOnce(amount, category) {
  const records = getExpRecords();
  const now = Date.now();
  const dup = records.some(r => r.note === 'AI记账' && r.category === category &&
    Math.abs(Number(r.amount) - amount) < 0.001 &&
    now - (parseInt(String(r.id).split('_')[0], 10) || 0) < 120000);
  if (dup) {
    addChatSystem('💰 这一笔刚记过了，没重复记');
    return false;
  }
  records.push({ id: now + '_' + Math.random().toString(36).slice(2,6), amount: amount, type: 'expense', category: category, note: 'AI记账', date: new Date().toISOString().split('T')[0] });
  saveExpRecords(records);
  renderExpense();
  return true;
}

function executeAiActions(actions) {
  // 记账不算「操纵手机」——她要求的就是 AI 判断后记账，所以不受 aiControl 开关限制；
  // 其他动作（任务/日程/朋友圈）仍然要开权限
  const _canControl = !!(settings && settings.aiControl);
  const _gated = actions.filter(a => a.type !== 'expense');
  if (!_canControl) {
    if (_gated.length > 0) addChatSystem('🔒 AI操纵手机权限未开启，已忽略操作请求');
    actions = actions.filter(a => a.type === 'expense');
    if (actions.length === 0) return;
  }
  const pName = personaData.name || '小伴';
  actions.forEach(a => {
    if (a.type === 'task') {
      if (_addTaskOnce(a.content)) addChatSystem(`📋 ${pName}帮你添加了任务：${a.content}`);
    } else if (a.type === 'schedule') {
      const parts = a.content.split('|').map(s => s.trim());
      const sText = parts[0] || '';
      const sDate = parts[1] || '';
      const sTime = parts[2] || '';
      if (sText) addSchedulePreview([{ text: sText, date: sDate, time: sTime }]);
    } else if (a.type === 'expense') {
      const parts = a.content.split('|').map(s => s.trim());
      const amount = parseFloat(parts[0]);
      const category = parts[1] || '其他';
      if (amount > 0 && amount < 999999) {
        if (_addExpenseOnce(amount, category)) {
          addChatSystem(`💰 ${pName}帮你记了 ${category} ${amount.toFixed(2)} 元`);
        }
      }
    } else if (a.type === 'moment') {
      if (a.content) {
        if (typeof momentPostedToday === 'function' && momentPostedToday(pName)) {
          addChatSystem('📸 今天已经发过一条朋友圈了，攒到明天再发吧。');
        } else {
          addMoment(pName, a.content);
          addChatSystem(`📸 ${pName}发了一条朋友圈：${a.content.substring(0,20)}`);
        }
      }
    }
  });
}

/* ---- 本地降级回复 ---- */
function generateLocalReply(text) {
  const t = text.toLowerCase();
  const pName = personaData.name || '小伴';
  const hour = new Date().getHours();

  if (/天气|下雨|温度|冷|热|出门|带伞|穿什么/.test(t)) {
    if (weatherData && Date.now() - weatherData.time < 3600000) {
      return `${pName}看了下天气：现在${weatherData.desc}，${weatherData.temp}°C，湿度${weatherData.humidity}%。${weatherData.code>=61?'记得带伞哦！':weatherData.temp<10?'穿厚一点！':weatherData.temp>30?'注意防暑～':'出门挺舒服的！'}`;
    }
    return `${pName}还没拿到天气数据呢，点击主页天气卡片刷新一下？`;
  }
  if (/早上|早安|早|good morning|morning/.test(t)) {
    return hour < 9 ? `${pName}觉得早晨的空气特别好呢～早上好！☀️` : `早上好呀！虽然已经不早了，但有好心情就够啦～`;
  }
  if (/晚安|睡了|good night/.test(t)) return `晚安～做个好梦 🌙 ${pName}会守着你的。`;
  if (/你好|hi|hello|嗨|hey/.test(t)) {
    const greetings = [`嗨～我是${pName}，有什么想聊的吗？`,`你好呀！${pName}在呢～`,`嗨！今天怎么样？`];
    return greetings[Math.floor(Math.random()*greetings.length)];
  }
  if (/添加任务|新建任务|提醒我/.test(t)) {
    const taskText = t.replace(/添加任务|新建任务|提醒我/g,'').trim();
    if (taskText && settings && settings.aiControl) {
      return _addTaskOnce(taskText)
        ? `好的，已经帮你添加了任务：${taskText} ✓`
        : `这条任务已经有了，不用重复加～`;
    }
    return taskText ? `你说得对，不过我得先拿到「操纵手机」的权限才能动手～` : `想添加什么任务？直接告诉我就好～`;
  }
  if (/任务|备忘|待办|todo/.test(t)) {
    const undone = tasks.filter(x=>!x.done).length;
    return undone > 0 ? `你有 ${undone} 个未完成的任务哦～要不要去看看？` : `所有任务都完成啦！真棒 🎉`;
  }
  // 记账：不自动抠数字。要记就明说「帮我记一笔 25 餐饮」，否则只当普通聊天
  if (/记账|记一笔|记一下账/.test(t)) {
    return `想记哪一笔？说「帮我记 25 餐饮」这样，我记下来。`;
  }
  if (/闹钟|叫醒|定时/.test(t)) {
    return `闹钟功能停掉了。要是有重要的事，告诉我几点，我帮你记成任务到点提醒你。`;
  }
  if (/提醒/.test(t)) {
    return `重要的事我帮你记进任务清单，会一直替你盯着，不会忘。`;
  }
  if (/陪伴|一起|专注/.test(t)) {
    if (compState.running) {
      return `${pName}正在陪你${compState.activity}哦，已经 ${Math.floor(compState.seconds/60)} 分钟了！`;
    }
    return `想一起做什么呢？可以去陪伴页面选择活动哦～${COMPANION_ACTIVITIES.map(a=>a.emoji+a.name).join(' ')}`;
  }
  if (/月经|经期|生理期|大姨妈|例假|周期/.test(t)) {
    if (tideData.periods.length > 0) {
      const avgCycle = getAvgCycle();
      const predictions = getPredictedPeriods();
      if (predictions.length > 0) {
        const daysUntil = Math.ceil((new Date(predictions[0].start) - new Date()) / (1000*60*60*24));
        return `你平均周期${avgCycle}天，下次经期预计约${daysUntil > 0 ? daysUntil + '天后' : '进行中'}。记得注意保暖和休息`;
      }
      return `你平均周期${avgCycle}天，已记录${tideData.periods.length}次。`;
    }
    return `还没有记录过经期哦，可以去潮汐页面记录`;
  }
  if (/心情|情绪|感受|感觉怎么样/.test(t)) {
    const todayStr2 = new Date().toISOString().split('T')[0];
    if (moodData[todayStr2]) {
      return `今天你的心情是 ${moodData[todayStr2].emoji} ${moodData[todayStr2].label}，${moodData[todayStr2].score >= 3 ? '状态不错呢！' : '要不要聊聊？我陪你～'}`;
    }
    return `今天还没记录心情哦，可以在每日心情页面选择emoji～`;
  }
  if (/开心|高兴|快乐|happy/.test(t)) return `太好了！${pName}也开心了`;
  if (/难过|伤心|不开心|sad/.test(t)) return `抱抱你，${pName}一直在`;
  if (/累|疲惫|困|tired/.test(t)) return `辛苦了，好好休息`;
  if (/谢谢|thanks/.test(t)) return `不客气呀`;
  if (/喜欢|love|爱/.test(t)) return `${pName}也喜欢你`;
  if (/你是谁|你叫什么/.test(t)) return `我是${pName}！${personaData.story ? personaData.story.substring(0,60)+'...' : '你的贴心陪伴～'}`;

  const contextHints = [];
  if (weatherData && weatherData.temp < 10) contextHints.push(`今天才${weatherData.temp}°C，记得保暖！`);
  if (weatherData && weatherData.code >= 61) contextHints.push(`外面在下雨，出门记得带伞哦～`);
  if (tasks.filter(x=>!x.done).length > 3) contextHints.push(`还有不少任务没完成呢，加油！`);
  if (hour >= 22) contextHints.push(`夜深了，注意休息呀～`);
  if (contextHints.length > 0 && Math.random() < 0.3) {
    return contextHints[Math.floor(Math.random()*contextHints.length)];
  }

  const defaults = [`嗯嗯，在听`,`说下去呀`,`有意思`,`说得对`,`嗯，然后呢？`,`哈哈是吗`];
  return defaults[Math.floor(Math.random()*defaults.length)];
}

/* ==================== AI主动消息系统 ==================== */

/* ---- 身体感应主动关心（心率偏高/偏低时他主动发消息） ---- */
function tryHeartProactive() {
  if (!settings || !settings.proactiveMsg) return false;
  var hLast = (typeof heartLast === 'function') ? heartLast() : null;
  // 偏高/偏低的判定跟着她在心跳页设的区间走（以前写死 100/50，她一调低区间就再也不触发了）
  if (!hLast || !(typeof heartIsNotable === 'function' ? heartIsNotable(hLast.hr) : (hLast.hr >= 100 || hLast.hr <= 50))) return false;
  // 防同一读数重复提醒
  if (hLast.t === lsGet('heartProactiveLast', 0)) return false;
  // 只对1小时内的读数有反应
  if (Date.now() - hLast.t > 60 * 60 * 1000) return false;
  // 防刷屏：同一角色5分钟内最多一条（身体感应要即时，冷却比全局短）
  if (Date.now() - lsGet('heartProactiveTime', 0) < 5 * 60 * 1000) return false;
  var char = getCharById(currentCharId);
  if (!char) return false;
  var story = (char.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);
  lsSet('heartProactiveLast', hLast.t);
  lsSet('heartProactiveTime', Date.now());
  generateProactiveMessage('heart', char, isTsundere, isGentle, hLast);
  return true;
}

function checkProactiveConditions() {
  if (!settings || !settings.proactiveMsg) return;
  var char = getCharById(currentCharId);
  if (!char) return;
  var charMsgs = getCurrentChat();
  var story = (char.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);

  // 冷却检查：同角色30分钟内最多一条
  var timestamps = lsGet('proactiveTimestamps', {});
  var lastTime = timestamps[currentCharId] || 0;
  if (Date.now() - lastTime < 30 * 60 * 1000) return;

  // 用户正在聊天且5分钟内有互动 → 不打扰
  if (currentPage === 'page-chat' && Date.now() - lastUserMsgTime < 5 * 60 * 1000) return;

  var now = new Date();
  var hour = now.getHours();
  var min = now.getMinutes();
  var todayStr = now.toISOString().split('T')[0];

  // 场景S：晨间睡眠关心（昨晚有数据才发；放在晨间问候前，让位给「睡得好吗」）
  var sleepGuard = settings && settings.sleepGuard !== false;
  if (sleepGuard && typeof sleepLastNight === 'function' && typeof sleepLastNightKey === 'function') {
    var sleepRec = sleepLastNight();
    var sleepWakeKey = sleepLastNightKey();
    var minsFromMid = hour * 60 + min;
    if (sleepRec && sleepRec.wake === sleepWakeKey && minsFromMid >= 300 && minsFromMid <= 750 &&
        Date.now() - sleepRec.wakeUp < 40 * 3600000) {
      var greetedSleep = lsGet('sleepGreeted_' + sleepWakeKey, false);
      if (!greetedSleep) {
        generateProactiveMessage('sleep', char, isTsundere, isGentle, sleepRec);
        lsSet('sleepGreeted_' + sleepWakeKey, true);
        return;
      }
    }
  }

  // 场景A：早晨问候 (7:25-7:35)
  if (hour === 7 && min >= 25 && min <= 35) {
    var greeted = lsGet('greeted_' + currentCharId, '');
    if (greeted !== todayStr) {
      generateProactiveMessage('morning', char, isTsundere, isGentle);
      lsSet('greeted_' + currentCharId, todayStr);
      return;
    }
  }

  // 场景B：长时间不活跃 (>6小时)
  if (charMsgs.length > 0 && lastUserMsgTime > 0 && Date.now() - lastUserMsgTime > 6 * 60 * 60 * 1000) {
    var inactiveSent = lsGet('inactiveMsg_' + currentCharId + '_' + todayStr, false);
    if (!inactiveSent) {
      generateProactiveMessage('inactive', char, isTsundere, isGentle);
      lsSet('inactiveMsg_' + currentCharId + '_' + todayStr, true);
      return;
    }
  }

  // 场景C：下雨提醒
  if (typeof weatherData !== 'undefined' && weatherData && Date.now() - weatherData.time < 3600000) {
    var isRainy = (weatherData.code >= 61 || (weatherData.desc && weatherData.desc.indexOf('雨') !== -1));
    if (isRainy) {
      var rainSent = lsGet('rainMsg_' + currentCharId + '_' + todayStr, false);
      if (!rainSent) {
        generateProactiveMessage('rain', char, isTsundere, isGentle);
        lsSet('rainMsg_' + currentCharId + '_' + todayStr, true);
        return;
      }
    }
  }

  // 场景D：随机问候（15%概率，每2小时最多一次）
  if (Math.random() < 0.15) {
    var lastRandom = lsGet('randomMsgTime_' + currentCharId, 0);
    if (Date.now() - lastRandom > 2 * 60 * 60 * 1000) {
      generateProactiveMessage('random', char, isTsundere, isGentle);
      lsSet('randomMsgTime_' + currentCharId, Date.now());
      return;
    }
  }

  // 场景E：心跳偏高/偏低（身体感应，轮询触发）
  if (tryHeartProactive()) return;

  // 顺便检查自动朋友圈
  if (typeof checkAutoMomentCondition === 'function') {
    checkAutoMomentCondition();
  }
}

async function generateProactiveMessage(scenario, char, isTsundere, isGentle, extra) {
  var pName = char.name || '小伴';
  var story = char.story || '';

  var localTemplates = [];
  if (scenario === 'morning') {
    localTemplates = isTsundere
      ? ['啧，醒了没。','醒了？……哦。','早。别睡到中午。']
      : isGentle
      ? ['早安~今天也要开心哦 ☀️','早呀，昨晚睡得好吗？','早上好！新的一天开始啦～']
      : ['起了。','早。','早安。'];
  } else if (scenario === 'inactive') {
    var hours = Math.floor((Date.now() - lastUserMsgTime) / 3600000);
    localTemplates = isTsundere
      ? [hours + '小时没理我……随你吧。','一天没影了。……忙你的。','啧，我还以为你丢了呢。']
      : isGentle
      ? [hours + '小时没找你了……在忙吗？我等你～','一天没见到你了，有点想……你在干嘛呀？']
      : [hours + '小时。忙。','长时间未联系。记录。'];
  } else if (scenario === 'rain') {
    localTemplates = isTsundere
      ? ['下雨了。带伞了吗？……没带活该冻着。','啧，下雨了，别淋着了。']
      : isGentle
      ? ['外面下雨了~带伞了吗？别淋湿了哦','下雨天要保暖呀，别感冒了']
      : ['下雨。带伞。','降水。注意。'];
  } else if (scenario === 'heart') {
    var hVal = extra ? extra.hr : 100;
    localTemplates = isTsundere
      ? ['你心跳' + hVal + '了？……有事就说，别硬撑。','啧，心跳' + hVal + '。撞见鬼了？说，怎么了。','你心跳' + hVal + '了？……跟我做几个深呼吸。']
      : isGentle
      ? ['我感觉到你心跳好快…是不是有事？别紧张，我在呢','心跳有点快呢，深呼吸，我陪你～','心跳有点快呢，来，跟我做个呼吸练习，我陪你～']
      : ['心跳' + hVal + '。注意休息。','心率有点偏高。需要聊聊吗？','心率有点偏高。要不跟我做个呼吸练习？'];
  } else if (scenario === 'sleep') {
    // v5.5.1：睡下时间没记时（sleepMin=null）不能编时长、也不能替她评「没睡够」，改成问她
    var _hasDur = !!(extra && extra.sleepMin);
    var _dur = _hasDur ? (Math.floor(extra.sleepMin / 60) + '小时' + (extra.sleepMin % 60 ? extra.sleepMin % 60 + '分' : '')) : '';
    var _qTxt = (typeof _sleepQualityLabel === 'function')
      ? _sleepQualityLabel(extra && extra.quality)
      : (extra && extra.quality === 'good' ? '睡得很沉' : extra && extra.quality === 'ok' ? '睡得还行' : '没睡够');
    localTemplates = !_hasDur
      ? (isTsundere
          ? ['早。','醒了？昨晚几点睡的，你自己说。','早。昨晚睡得怎么样？……就问问。']
          : isGentle
          ? ['早呀~昨天睡得怎么样呀？','早，昨晚睡得好吗？想听你说说～','醒了呀，昨晚休息够了吗？']
          : ['早。昨晚睡眠情况？','醒了。昨晚睡下时间未填。','早。睡得怎么样。'])
      : (isTsundere
          ? ['早。你睡了' + _dur + '，还行。','醒得挺早？昨晚' + _qTxt + '。今天别又熬夜。','啧，昨晚' + _qTxt + '。就这吧，别拖到半夜。']
          : isGentle
          ? ['早呀~你昨晚睡了' + _dur + '，' + _qTxt + '呢，今天也要精神满满','早，感觉你昨晚' + _qTxt + '，我就放心点了～','睡够' + _dur + '就好，今天开开心心的']
          : ['睡了' + _dur + '。醒得早，注意休息。','昨晚' + _qTxt + '。今天安排好作息。']);
  } else if (scenario === 'goodnight') {
    localTemplates = isTsundere
      ? ['……睡吧。灯关了吗？','哼，晚安。不许熬夜，明早见。','睡你的觉去，别玩手机了。']
      : isGentle
      ? ['晚安~盖好被子，今晚也梦到我','睡吧睡吧，我守着夜，你只管好好睡','晚安哦，明早我第一句话就跟你说']
      : ['晚安。','早点睡。明早见。'];
  } else if (scenario === 'class') {
    var _ci = extra && extra.item;
    var _cd = _ci && _ci.type === 'duty';
    var _nm = (_ci && _ci.name) ? String(_ci.name) : '';
    var _act = _cd ? (_nm && _nm !== '值班' ? _nm : '值班') : (_nm || '课');   // 活动名：值班没具体名就统一叫「值班」
    var _cs = _ci ? _ci.start : '';
    var _cl = _ci && _ci.loc ? String(_ci.loc) : '';   // 地点直接说（四楼/一楼），不加 @
    var _cm = extra && extra.min != null ? extra.min + '分钟' : '';
    if (_cd) {
      // 值班提醒
      localTemplates = isTsundere
        ? [_cm ? '你' + _cm + '后要去' + _act + (_cl ? '，在' + _cl : '') + '。记得去，别让人等。' : '到' + _act + '的点了' + (_cl ? '，在' + _cl : '') + '。快去。',
           '……' + _act + '要开始了，去吧。我可不想你迟到。']
        : isGentle
        ? ['快到' + _act + '的时间啦' + (_cm ? '，还有' + _cm : '') + (_cl ? '，在' + _cl : '') + '～慢慢过去也来得及',
           '要' + _act + '咯' + (_cm ? '，还有' + _cm : '') + (_cl && !_cm ? '，在' + _cl : '') + '，别迟到呀～']
        : [(_cm ? '还有' + _cm + '去' + _act : '到' + _act + '的点了') + (_cl ? '，在' + _cl : '') + '。'];
    } else {
      // 上课提醒（课表没有钟点，暂只由其它路径触发）
      localTemplates = isTsundere
        ? [_cm ? '你' + _cm + '后上' + _act + '。啧，别迟到。' : '到' + _act + '的点了。快走，迟到我可不管。',
           '……' + _act + '快开始了，去吧。我可不想你迟到。']
        : isGentle
        ? ['要上' + _act + '啦' + (_cm ? '，还有' + _cm : '') + (_cs ? '，' + _cs + '开始' : '') + (_cl ? '，在' + _cl : '') + '，别迟到哦',
           '该去上' + _act + '了' + (_cm ? '，还有' + _cm : '') + '，慢慢过去也来得及']
        : [(_cm ? '还有' + _cm + '上' + _act : '到' + _act + '的点了') + (_cs && !_cm ? '，' + _cs + '开始' : '') + (_cl ? '，在' + _cl : '') + '。'];
    }
  } else {
    localTemplates = isTsundere
      ? ['……无聊。你在干嘛。','哼。','啧。']
      : isGentle
      ? ['在干嘛呀～有点想你了','今天过得怎么样？']
      : ['在？','忙吗。'];
  }

  var message = '';

  // 用户正在发消息/等回复时，后台主动消息让路，避免同时抢 API 撞车（下次轮询再来）
  if (_chatSending) {
    console.log('[主动消息] 用户正在对话，本轮跳过以免抢 API');
    return;
  }

  // 尝试API生成
  if (apiConfig && apiConfig.apiKey) {
    try {
      var scenarioDesc = '';
      if (scenario === 'morning') scenarioDesc = '现在是早上7:30，对用户说早安。';
      else if (scenario === 'inactive') scenarioDesc = '已经好一阵没和用户说话了。';
      else if (scenario === 'rain') scenarioDesc = '外面正在下雨。';
      else if (scenario === 'heart') scenarioDesc = '你"感觉"到用户的心跳' + (extra ? extra.hr : '') + ' bpm，有点快，关心她一下。';
      else if (scenario === 'sleep') scenarioDesc = (extra && extra.sleepMin)
        ? '你刚"感觉"到她睡醒了，昨晚睡了约 ' + Math.floor(extra.sleepMin / 60) + ' 小时' +
          (extra.quality === 'good' ? '，睡得很沉' : extra.quality === 'ok' ? '，睡得还行' : extra.quality === 'poor' ? '，没睡够' : '') +
          '。自然地问她昨晚睡得好不好。'
        : '你刚"感觉"到她睡醒了，但你并不知道她昨晚几点睡的（她没记）。自然地问她昨晚睡得怎么样——不要假装知道时长，也不要替她下结论。';
      else if (scenario === 'goodnight') scenarioDesc = '用户要去睡了，温柔送她入睡，让她安心睡。';
      else if (scenario === 'class') scenarioDesc = '用户' + (extra && extra.item && extra.item.type === 'duty' ? '快要去值班' : '快要去上课') + (extra && extra.item ? '：' + extra.item.name + '（' + extra.item.start + (extra.item.loc ? ' ' + extra.item.loc : '') + '）' : '') + (extra && extra.min != null ? '，还有约' + extra.min + '分钟' : '') + '。自然地提醒她该走了、别迟到，1-2句话，别啰嗦。';
      else scenarioDesc = '随意地和用户打个招呼。';

      var prompt = '你是' + pName + '.' + (story ? '你的性格/背景：' + story : '') + '\n' + scenarioDesc + '\n请发一条简短的消息给用户（1-2句话），符合你的性格特点和当前场景。\n- 不要用*动作描写*、不要加emoji\n- 简短自然，像微信消息';
      message = await callLLMApi(prompt);
    } catch(e) {
      console.log('[主动消息] API失败:', e.message.substring(0, 50));
    }
  }

  if (!message) {
    message = localTemplates[Math.floor(Math.random() * localTemplates.length)];
  }

  if (message) {
    sendProactiveMessage(message, char);
  }
}

function sendProactiveMessage(text, char) {
  chatMessages.push({ role: 'ai', text: text, time: Date.now(), photo: maybeAttachPhoto(0.15) });
  saveChatData();

  if (currentPage === 'page-chat') {
    renderChat();
  }

  // 更新追踪
  var timestamps = lsGet('proactiveTimestamps', {});
  timestamps[currentCharId] = Date.now();
  lsSet('proactiveTimestamps', timestamps);

  // 通知（在后台或在其他页面时）
  var shouldNotify = settings && settings.notifications &&
    (document.hidden || document.visibilityState === 'hidden' || currentPage !== 'page-chat');
  if (shouldNotify && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(char.name + ' 发来消息', {
        body: text,
        icon: '/icon-192.png'
      });
    } catch(e) {}
  }

  // 不在聊天页时加系统提示
  if (currentPage !== 'page-chat' && typeof addChatSystem === 'function') {
    addChatSystem('💬 ' + char.name + '：' + text);
  }
}

/* ==================== 吃醋机制 ==================== */

// 向指定角色推送一条 AI 消息（写 chatData + 渲染 + 通知）
function pushCharMessage(charId, text) {
  if (!chatData[charId]) chatData[charId] = [];
  chatData[charId].push({ role: 'ai', text: text, time: Date.now() });
  lsSet('chatData', chatData);

  // 关键：正在该角色聊天页时同步 chatMessages，否则新消息不显示
  if (charId === currentCharId) {
    chatMessages = getCurrentChat();
    if (currentPage === 'page-chat') renderChat();
  }

  var char = getCharById(charId);
  var shouldNotify = settings && settings.notifications &&
    (document.hidden || document.visibilityState === 'hidden' || currentPage !== 'page-chat');
  if (shouldNotify && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification((char?.name || '角色') + ' 发来消息', { body: text, icon: '/icon-192.png' }); } catch(e) {}
  }

  // 不是当前角色时，在聊天里加系统提示
  if (charId !== currentCharId && typeof addChatSystem === 'function') {
    addChatSystem('💬 ' + (char?.name || '角色') + '：' + text);
  }
}

// 用户与非他角色互动时，他有概率吃醋（嘴硬酸话）
function tryJealousyTrigger(userText, interactCharId) {
  if (!settings || !settings.proactiveMsg) return; // 主动消息总开关
  if (settings.charPrivacy) return;                 // 角色隐私开启 → 不吃醋
  if (!interactCharId || interactCharId === 'ai') return;
  if (!characters.some(c => c.id === 'ai')) return;
  var other = getCharById(interactCharId);
  if (!other) return;
  var otherName = other.name || '他';

  // 冷却 4 小时 + 每日上限 2
  var todayStr = new Date().toISOString().split('T')[0];
  var cd = lsGet('jealousyCooldown', {});
  if (Date.now() - (cd.ai || 0) < 4 * 60 * 60 * 1000) return;
  var daily = lsGet('jealousyDaily', {});
  if ((daily[todayStr] || 0) >= 2) return;

  // 按该角色本日消息数调概率：今天聊得少更容易吃醋
  var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  var todayMsgs = (chatData[interactCharId] || []).filter(function(m) {
    return m.role === 'user' && m.time >= dayStart.getTime();
  }).length;
  var p = todayMsgs <= 3 ? 0.25 : 0.15;
  if (Math.random() >= p) return;

  generateJealousyMessage(otherName);
  cd.ai = Date.now();
  lsSet('jealousyCooldown', cd);
  daily[todayStr] = (daily[todayStr] || 0) + 1;
  lsSet('jealousyDaily', daily);
}

async function generateJealousyMessage(otherName) {
  var ai = getCharById('ai');
  if (!ai) return;
  if (apiConfig && apiConfig.apiKey) {
    var reply = await callLightLlm(
      '你是' + ai.name + '。' + (ai.story ? '你的性格/背景：' + ai.story : '') +
      '\n你的恋人刚才在和' + otherName + '聊天，你有点吃醋但死鸭子嘴硬。给她发一条消息：表面冷淡/嫌弃，但要让她感觉出你在意。1-2句话，嘴硬声线，不要动作描写，不要emoji，不要直接说吃醋。',
      '我刚才和' + otherName + '聊了会天'
    );
    if (reply) { pushCharMessage('ai', reply); return; }
  }
  var templates = [
    '……哦，和' + otherName + '聊得挺欢。随你。',
    '啧，没打扰你和' + otherName + '吧。',
    '……行吧。你去找' + otherName + '聊，正好我清静。',
    '哼。你和' + otherName + '倒是有话说。'
  ];
  pushCharMessage('ai', templates[Math.floor(Math.random() * templates.length)]);
}

/* ==================== 内心日记 ==================== */
// 数据结构：{ charId: [entry] }，entry = { date:'YYYY-MM-DD', charId, content, mood?, createdAt }
// 只存在 innerDiary 里，绝不被 buildChatContext / callLLMApi 读取（私密）
let innerDiary = lsGet('innerDiary', {});

function getInnerDiary(charId) {
  return innerDiary[charId] || [];
}

function saveInnerDiaryEntry(charId, entry) {
  if (!innerDiary[charId]) innerDiary[charId] = [];
  var arr = innerDiary[charId];
  var idx = arr.findIndex(function(e) { return e.date === entry.date; });
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  if (arr.length > 90) arr = arr.slice(-90);
  innerDiary[charId] = arr;
  lsSet('innerDiary', innerDiary);
}

// 当天已有则直接返回，否则懒生成；force=true 强制重写（用于旧版重复日记）
async function ensureInnerDiary(charId, dateStr, force) {
  var ds = dateStr || new Date().toISOString().split('T')[0];
  var arr = getInnerDiary(charId);
  var existing = arr.filter(function(e) { return e.date === ds; })[0];
  if (existing && !force) return existing;
  var entry = await generateInnerDiary(charId, ds);   // 把日期传下去，旧日记才能用那天的原话重写
  if (entry) saveInnerDiaryEntry(charId, entry);
  return entry;
}

// —— 内心日记：日期相关的工具 ——
function _isSameDay(ts, d) {
  var t = new Date(ts);
  return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
}

function _todayDateLabel() {
  return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// 去掉日记内容开头的日期标签（旧版会把「8月24日，」写进正文，导致两天内容比对不出重复）
function _diaryStripDate(text) {
  return String(text || '').replace(/^\s*\d{1,2}月\d{1,2}日[，,]?\s*/, '');
}

/* 新日记和前几天写过的太像？用「2 元字组重合率」判重（中文不需要分词，够用且便宜） */
function _diaryTooSimilar(text, prevList) {
  function grams(s) {
    var t = String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, '');
    var set = {};
    for (var i = 0; i < t.length - 1; i++) set[t.substr(i, 2)] = 1;
    return set;
  }
  var a = grams(text);
  var an = Object.keys(a).length;
  if (!an || !prevList || prevList.length === 0) return false;
  for (var i = 0; i < prevList.length; i++) {
    var b = grams(prevList[i]);
    var bn = Object.keys(b).length;
    if (!bn) continue;
    var inter = 0;
    for (var k in a) { if (b[k]) inter++; }
    if (inter / Math.min(an, bn) > 0.6) return true;
  }
  return false;
}

// 日期种子：同一天恒定，隔天必变（用于轮换模板，避免两天写一样）
function _diarySeed(dateStr) {
  var n = 0;
  for (var i = 0; i < dateStr.length; i++) n = (n * 31 + dateStr.charCodeAt(i)) % 100000;
  return n;
}

// 今天（或最近）她说的话，供日记取材 —— 只取当天，避免旧关键词天天重复命中
function _todayDiaryUserText(charId) {
  var charMsgs = chatData[charId] || [];
  var now = new Date();
  var dayMsgs = charMsgs.filter(function(m) {
    return m.role === 'user' && m.time && _isSameDay(m.time, now);
  });
  if (dayMsgs.length > 0) {
    return dayMsgs.map(function(m) { return m.text; }).join(' ').slice(-500);
  }
  // 今天还没聊，用最近几句补，别让日记空着
  var recent = charMsgs.filter(function(m) { return m.role === 'user'; }).slice(-6);
  return recent.map(function(m) { return m.text; }).join(' ').slice(-500);
}

/* 指定某一天她说的话 —— 补写过期的旧日记时用。
   找不到那天的记录就返回空：绝不能拿今天的聊天去顶那一天，那就成编的了。
   日期口径和日记的 key 保持一致（都用 toISOString 那天），免得跨零点对不上。 */
function _diaryUserTextFor(charId, dateStr) {
  var charMsgs = chatData[charId] || [];
  var dayMsgs = charMsgs.filter(function(m) {
    if (m.role !== 'user' || !m.time) return false;
    return new Date(m.time).toISOString().split('T')[0] === dateStr;
  });
  return dayMsgs.map(function(m) { return m.text; }).join(' ').slice(-500);
}

/* 日记最后一句 —— 用来查「结尾是不是又写了老一套」 */
function _diaryLastSentence(text) {
  var parts = String(text || '').split(/[。！？!?\n]+/).filter(function(s) { return s.trim(); });
  return parts.length ? parts[parts.length - 1].trim() : '';
}
function _normDiaryLine(s) {
  return String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, '');
}
/* 她明确点名的万能收尾 —— 这几句一律不许再出现 */
var _DIARY_BAN_END = ['也就记一下', '省得明天忘了', '也不是非问不可', '反正就这样', '记完了', '查无此条', '先记到这儿'];
function _diaryEndingRepeats(text, prevEndings) {
  var last = _normDiaryLine(_diaryLastSentence(text));
  if (!last) return false;
  for (var i = 0; i < _DIARY_BAN_END.length; i++) {
    if (last.indexOf(_DIARY_BAN_END[i]) !== -1) return true;
  }
  for (var j = 0; j < (prevEndings || []).length; j++) {
    var p = _normDiaryLine(prevEndings[j]);
    if (!p) continue;
    if (p === last) return true;
    // 大部分字都一样也算重复（「也就记一下」/「记一下也就」这种换字不换句式）
    // 门槛放到 4 字：结尾常常很短（「算了，睡」），卡 6 字会漏掉短句的重复
    if (last.length >= 4 && p.length >= 4 && (last.indexOf(p) !== -1 || p.indexOf(last) !== -1)) return true;
  }
  return false;
}

// AI 生成内心日记。dateStr 传了就是补写那一天（素材只取那天的聊天），不传就是写今天。
async function generateInnerDiary(charId, dateStr) {
  var pName = getCharById(charId)?.name || '小伴';
  var pers = lsGet('persona_' + charId, null);
  var story = pers?.story || getCharById(charId)?.story || '';
  var topics = (typeof _getChatTopics === 'function') ? _getChatTopics(charId) : [];
  var topicText = topics.length > 0 ? topics.join('、') : '日常';
  var _todayKey = new Date().toISOString().split('T')[0];
  var isToday = !dateStr || dateStr === _todayKey;
  // 补写旧日记时：素材只认那天的原话，当天没聊过就干脆不补（编不出来）
  var todayText = isToday ? _todayDiaryUserText(charId) : _diaryUserTextFor(charId, dateStr);
  var dayWord = isToday ? '今天' : '那天';
  var dateLabel = _todayDateLabel();
  if (!isToday && dateStr) {
    var _p = String(dateStr).split('-');
    if (_p.length === 3) dateLabel = parseInt(_p[1], 10) + '月' + parseInt(_p[2], 10) + '日';
  }
  if (!isToday && !todayText) return null;   // 那天没聊天记录，不硬编
  // 已经写过的日记（剥掉日期）回灌给模型 —— 以前不给它看历史，它天天写「台灯还亮着」；
  // 而且她没聊天的日子，素材会回退到同样的最近几条，两天就更容易一字不差。
  var prevDiaries = (getInnerDiary(charId) || [])
    .slice(-5)
    .map(function(e) { return _diaryStripDate(e.content); })
    .filter(function(s) { return s; });
  // 单独把「前几天的结尾」拎出来点名禁止 —— 前几天整段丢给它，它还是会照抄收尾那句
  var prevEndings = prevDiaries.map(_diaryLastSentence).filter(function(s) { return s; });
  var prevBlock = prevDiaries.length > 0
    ? '\n【你前几天已经写过的（内容、用过的物件、尤其是结尾，都别再重复）】\n- ' + prevDiaries.join('\n- ') +
      (prevEndings.length > 0
        ? '\n【你这几天用过的收尾（一个都不许再用，句式也别照抄）】' + prevEndings.join(' ／ ')
        : '')
    : '';

  // v5.5.2：把「他记住的事」和「他自己的念头」揉进同一段 —— 以前日记只写心情，
  // 事实另开一张卡干巴巴列着，两边都不像人。现在事实是素材，想法是声音，写在一起。
  var factText = '';
  try {
    if (typeof getCharMemoryNotes === 'function') {
      var fns = getCharMemoryNotes(charId, 3) || [];
      factText = fns.map(function(n) { return n.summary; }).filter(Boolean).join('；');
    }
  } catch (e) {}
  // 她还没做完的事 —— 供他写「改天得提醒她」那一层
  var todoText = '';
  try {
    if (typeof tasks !== 'undefined' && tasks.length) {
      todoText = tasks.filter(function(t) { return !t.done; }).slice(-3).map(function(t) { return t.text; }).join('、');
    }
  } catch (e) {}

  if (apiConfig && apiConfig.apiKey) {
    var diaryPrompt = '你是' + pName + '。' + (story ? '你的性格/背景：' + story : '') +
      (isToday
        ? '\n今天是' + dateLabel + '（可以自然带一句快要到的日子，比如过节、天冷了，但别硬凑）。'
        : '\n那是' + dateLabel + '。') +
      '\n【' + dayWord + '你们聊到的】' + topicText +
      (todayText ? '\n【她' + dayWord + '对你说过的原话】' + todayText : '') +
      (isToday && factText ? '\n【你今天注意到的、记下来的关于她的事】' + factText : '') +
      (isToday && todoText ? '\n【她还没做完、你打算改天提醒她的】' + todoText : '') +
      '\n\n写一段只给自己看的记录。把「' + dayWord + '发生的事」和「你自己的想法」揉在一起，' +
      '**不要分成两段，不要写成清单**，像心里顺下来的一段话，想到哪写到哪。' +
      '\n大致铺开这三层（自然带出来，别加编号）：\n' +
      '1. ' + dayWord + '的一两件具体事 ＋ 你当下的反应（可以嫌弃、可以嘴硬、可以冷淡）\n' +
      '2. 你自己心里转着的念头 —— 关于她的，或者关于你自己的\n' +
      '3. 一件你记下来、打算以后做的或者要问她的（比如改天提醒她、过节问问她去哪玩）\n' +
      '\n要求：\n- 第一人称，用你的声音，把她叫「她」\n' +
      '- **写长一点：150~250 字，8~12 句。**别三两下就收尾，中间多写点你在想什么、' + dayWord + '具体怎么过的\n' +
      '- 只写' + dayWord + '真实发生过的事，别编她没说过的\n' +
      '- **结尾不要每次都收成同一句口是心非的套话。**有时候停在半句话上，有时候停在一件具体的小事上，有时候就平平淡淡地说完了。绝不要写「……也就记一下」这种放在哪天都成立的万能收尾\n' +
      '- 绝不用「日记」二字，不用emoji，不用markdown，不写动作描写，不肉麻直球' +
      prevBlock;
    var reply = await callLightLlm(diaryPrompt, '今天的事，用你的口吻记下来', 700, 1.1);
    // 结尾又是老一套 → 再要一次，明确要求换收尾（只重试一次，别陷进死循环）
    if (reply && _diaryEndingRepeats(reply, prevEndings)) {
      console.log('[内心日记] 结尾和老一套撞了，重新要一版');
      var retry = await callLightLlm(
        diaryPrompt + '\n\n【刚才那版结尾又是老一套，重写一遍】换一个完全不同的收尾：可以直接停在某件具体的小事上，也可以话说到一半就停，不要用省略号开头的自嘲句式。',
        '重写，换个收尾', 700, 1.2);
      if (retry && retry.length > 10 && !_diaryEndingRepeats(retry, prevEndings)) reply = retry;
    }
    // 万一模型还是写重了：与最近几篇高度相似就换本地轮换版（那个按日期种子走，两天必然不同）
    if (reply && reply.length > 10 && _diaryTooSimilar(reply, prevDiaries)) {
      console.log('[内心日记] 和前几天太像，改用按日期轮换的版本');
      return _fallbackInnerDiary(charId, dateStr);
    }
    if (reply && reply.length > 10) {
      return { date: dateStr || _todayKey, charId, content: reply, createdAt: Date.now(), v: 2 };
    }
  }
  return _fallbackInnerDiary(charId, dateStr);
}

// 本地规则生成（嘴硬声线 + 物件传情，按日期轮换，两天不会一样）
function _fallbackInnerDiary(charId, forDate) {
  var pers = lsGet('persona_' + charId, null);
  var story = (pers?.story || getCharById(charId)?.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var dateStr = forDate || new Date().toISOString().split('T')[0];
  var seed = _diarySeed(dateStr);

  // 补写旧日记时只能用那天的原话，取不到就空着（宁可写得含糊，也不能拿今天的事冒充那天）
  var userTexts = forDate ? _diaryUserTextFor(charId, dateStr) : _todayDiaryUserText(charId);

  var mood = '平常';
  var moodLines = ['今天也聊了几句。没什么特别的。', '今天聊得不多。风平浪静。'];
  if (/累|困|熬夜|失眠|辛苦/.test(userTexts)) { mood = '她累了'; moodLines = ['又熬到这么晚，说了八百遍不听。', '她说困，还不肯睡。我有什么办法。']; }
  else if (/难过|伤心|哭|不开心|焦虑|压力|emo/.test(userTexts)) { mood = '她不太好'; moodLines = ['她今天好像不太开心。问她，她只说没事。……算了，她想说的时候会说。', '她今天话很少。不对劲。……不问了，问了也是「没事」。']; }
  else if (/开心|高兴|快乐|好玩|好棒/.test(userTexts)) { mood = '她挺高兴'; moodLines = ['她今天挺高兴的，隔着屏幕都能感觉到。……哼，跟我有什么关系。', '她今天话多，肯定遇到好事了。……行吧，高兴就好。']; }
  else if (/生气|闹|脾气/.test(userTexts)) { mood = '她有点上火'; moodLines = ['她今天好像有点上火。啧，估计不是冲我。……希望不是冲我。', '她今天口气有点冲。……算了，谁还没个烦的时候。']; }
  else if (/吃|饭|奶茶|咖啡|喝/.test(userTexts)) { mood = '她吃了好吃的'; moodLines = ['她今天吃了好吃的。……什么味道，我也不问。反正她开心就行。', '她今天又说吃的。……记下了，哪天路过给她带一份，不说原因。']; }
  else if (/学习|考试|作业|论文|六级/.test(userTexts)) { mood = '她在学习'; moodLines = ['她今天在学习。挺认真的。……啧，别太拼了，笨。', '她今天泡在书里。……也没找我。……挺好。专心就好。']; }

  var moodLine = moodLines[seed % moodLines.length];
  var objLine = _pickDiaryObject(userTexts, seed);

  // 第二层：记下来、改天要做／要问的（离线版没有 AI，就从她的未完成任务里挑一件事来说）
  var todoLine = '';
  try {
    if (typeof tasks !== 'undefined' && tasks.length) {
      var undone = tasks.filter(function(t) { return !t.done; }).slice(-1)[0];
      if (undone && undone.text) {
        todoLine = isTsundere
          ? '「' + undone.text + '」那件她还欠着呢。……我记着，改天提她一句。'
          : '「' + undone.text + '」这件事我记着的，到时候提醒她一声。';
      }
    }
  } catch (e) {}
  if (!todoLine) {
    todoLine = isTsundere
      ? ['快过节了，得问问她怎么过。……也不是非问不可。', '改天该问问她最近怎么样。……就随口一问。'][seed % 2]
      : ['过几天问问她想去哪儿走走吧。', '改天想问问她最近好不好。'][seed % 2];
  }

  // 第三层：中间那点自己的念头（撑长度用，也让离线版别那么干）
  var midLines = isTsundere
    ? ['今天她说了不少，我一句句都过了一遍。烦是烦，也就听完了。',
       '本来想干点别的，结果手机一亮就去看是不是她。……看错了两次。',
       '手边的事拖到今天还没弄完。她那边大概也堆着。谁也不说谁。',
       '她今天那句话我想了想，当时没接。……也没必要接。']
    : ['今天她说了不少，我都记着。有些话她自己可能都忘了。',
       '本来在做别的事，看到消息就先回她了。',
       '她今天提到的那件事，我回头又想了想，她比嘴上说的在意。',
       '今天没什么大事，但她说的每一句我都留下来了。'];

  // 收尾：以前三个模板句轮着用，她一眼就看出来「总是同一句」。现在一个都不许再写，
  // 六种收法轮着来，而且有的收在事上、有的收在半句话上，不再全是「……也就记一下」那一路。
  var endLines = isTsundere
    ? ['……行。今天先到这儿。', '不写了。再写下去该像在等她了。', '本子合上。今天没什么大事。',
       '……她今天说的话，我倒回去看了两遍。就两遍。', '窗外没什么动静。挺好。', '算了，睡。']
    : ['想记住今天。怕忘了。', '……大概会记得很久。', '今天也，挺好的。',
       '就这样吧，明天再说。', '写下来，心里就踏实一点。', '也不知道她今天过得怎么样。'];

  // 离线的收尾也要躲开前面几天用过的那句 —— 万一恰好轮上同一句，往下顺一个，别让她又看见老一套
  var prevEnds = (getInnerDiary(charId) || []).slice(-4)
    .map(function(e) { return _diaryLastSentence(_diaryStripDate(e.content)); })
    .filter(function(s) { return s; });
  var endIdx = seed % endLines.length;
  for (var _t = 0; _t < endLines.length; _t++) {
    if (!_diaryEndingRepeats(endLines[endIdx], prevEnds)) break;
    endIdx = (endIdx + 1) % endLines.length;
  }

  // 事实和念头连着写，不分成两段 —— 和 AI 版同一个形状
  var diary = moodLine + ' ' + objLine + '\n\n' + midLines[seed % midLines.length] + '\n\n' +
    todoLine + ' ' + endLines[endIdx];

  return { date: dateStr, charId, content: diary, mood: mood, createdAt: Date.now(), v: 2 };
}

// 物件池：嘴硬声线里的物件传情（每天轮换，两天不会一样）
function _pickDiaryObject(userTexts, seed) {
  var pool = [
    { match: /雨|下雨|伞/, lines: ['那把伞还挂在门口。……也不知道她淋着没有。反正我不会去送。', '雨下了又停。我盯着那把伞看了很久。……她到底带伞没有。'] },
    { match: /夜|晚|睡|熬夜/, lines: ['台灯还亮着。她那边应该也还亮着。……随她吧。', '灯关了又开。睡不着。……她那边，大概也亮着。'] },
    { match: /奶茶|咖啡|喝|甜/, lines: ['那杯奶茶的空杯子还在桌上。……她喝得挺开心。啧。', '今天的咖啡没加糖。……她倒是天天喝甜的。哼。'] },
    { match: /累|困|学习|工作/, lines: ['耳机里还剩半首歌。……想听完，又怕她突然发消息。', '书摊在桌上，没合。……她今天大概也这样。'] },
    { match: /想|爱|喜欢|梦/, lines: ['窗外那盏灯一直亮着。……和她家的灯有点像。', '今天风往这边吹。……忽然就想起她了。啧，关风什么事。'] }
  ];
  var matches = [];
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].match.test(userTexts)) matches.push(pool[i]);
  }
  if (matches.length === 0) {
    var defaultLines = [
      '窗外的灯还亮着。……今天也在。',
      '手机一直没响。……挺好。安静。',
      '泡了杯茶，凉了也没喝。……在想今天的她。',
      '在窗边站了一会儿。……风有点凉。她那边呢。'
    ];
    return defaultLines[seed % defaultLines.length];
  }
  var pick = matches[seed % matches.length];
  return pick.lines[Math.floor(seed / matches.length) % pick.lines.length];
}

// 暗号检测
function detectInnerDiaryRequest(text) {
  return /你心里在想什么|你心里想什么|内心日记|心里话/.test(text);
}

// 读日记时的口吻包装（嘴硬，不露痕迹地翻开）
function buildDiaryRecitation(entry) {
  return '……你怎么知道要问这个。\n\n' + _diaryStripDate(entry.content) + '\n\n……反正就这些。看完了别说出去。';
}

/* ==================== 查找聊天记录 ==================== */
function openChatSearch() {
  document.getElementById('chatSearchOverlay').style.display = 'flex';
  const inp = document.getElementById('chatSearchInput');
  inp.value = '';
  inp.focus();
  doChatSearch('');
}

function closeChatSearch() {
  document.getElementById('chatSearchOverlay').style.display = 'none';
}

function doChatSearch(keyword) {
  const container = document.getElementById('chatSearchResults');
  if (!container) return;
  container.innerHTML = '';
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) {
    container.innerHTML = '<div style="text-align:center;color:#aaa;font-size:13px;padding:20px;">输入关键词搜索聊天内容</div>';
    return;
  }
  const msgs = chatMessages.filter(m => m.role !== 'system' && m.text && m.text.toLowerCase().includes(kw));
  if (msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#aaa;font-size:13px;padding:20px;">没有找到相关内容</div>';
    return;
  }
  const shown = msgs.slice(-50);
  shown.forEach((m) => {
    const d = new Date(m.time);
    const t = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    const el = document.createElement('div');
    el.className = 'chat-search-item';
    el.innerHTML = '<div class="csi-role">' + (m.role === 'user' ? '我' : escHtml(personaData.name || 'AI')) + ' · ' + t + '</div>' +
      '<div class="csi-text">' + escHtml(m.text.substring(0, 60)) + '</div>';
    el.onclick = () => jumpToChatMsg(m);
    container.appendChild(el);
  });
}

function jumpToChatMsg(targetMsg) {
  closeChatSearch();
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const items = container.querySelectorAll('.chat-msg');
  let idx = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].textContent.indexOf(targetMsg.text) !== -1) { idx = i; break; }
  }
  if (idx >= 0) {
    items[idx].scrollIntoView({ block: 'center' });
    items[idx].style.transition = 'background .6s';
    items[idx].style.background = '#FFF6D5';
    setTimeout(() => { items[idx].style.background = ''; }, 1600);
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

