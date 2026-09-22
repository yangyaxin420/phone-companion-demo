/* ==================== 11. Secret — 多角色翻手机 ==================== */
const SECRET_DATA_VERSION = 'v3';
let secretCharId = lsGet('secretCharId', currentCharId || 'ai');
let secretData = lsGet('secretData', {}); // { charId: { data, time, version } }
let secretGenerated = null; // 保留兼容
let secretApiFailed = {}; // charId -> timestamp, 记录API失败时间避免反复重试

function getSecretForChar(charId) {
  const entry = secretData[charId];
  if (entry && entry.data && entry.version === SECRET_DATA_VERSION) return entry.data;
  return null;
}

function setSecretForChar(charId, data) {
  secretData[charId] = { data, time: Date.now(), version: SECRET_DATA_VERSION };
  lsSet('secretData', secretData);
}

function getCharPersona(charId) {
  const char = characters.find(c => c.id === charId);
  if (!char) return { name:'AI', story:'' };
  const saved = lsGet('persona_' + charId, null);
  if (saved) return saved;
  return { name: char.name, story: char.story };
}

async function generateSecretContent(charId) {
  const charIdToUse = charId || secretCharId;
  const charPers = getCharPersona(charIdToUse);
  const pName = charPers.name || 'AI';
  const story = charPers.story || '';

  // 检查是否有缓存（10分钟内）
  const existing = getSecretForChar(charIdToUse);
  var lastFailed = secretApiFailed[charIdToUse] || 0;
  var shouldTryApi = apiConfig && apiConfig.apiKey && (Date.now() - lastFailed > 300000) && (!existing || Date.now() - (secretData[charIdToUse]?.time || 0) > 600000);
  if (shouldTryApi) {
    // 构建联系人列表：包含其他AI角色
    let otherChars = characters.filter(c => c.id !== charIdToUse);
    let otherCharContacts = otherChars.map((c, i) => ({
      id: 'ai_' + c.id,
      avatar: c.avatar || '💬',
      name: c.name,
      nickname: c.name,
      lastMsg: '',
      time: ''
    }));

    const contactPrompt = otherCharContacts.length > 0
      ? `\n额外联系人（AI角色）：${otherCharContacts.map(c => `${c.avatar} ${c.name}`).join('、')}—— 这些也是AI角色，${pName}和他们认识，请把其中2-3个也放进联系人列表，并生成对话`
      : '';

    const prompt = `你现在是${pName}。${story ? '你的性格/背景：' + story : ''}请用JSON格式生成以下手机内容（不要额外文字，只输出JSON）：

1. 微信聊天列表：6-8个联系人，包含emoji头像、名字、"nickname"（备注/外号）、最后一条消息预览、时间
2. 你的最近播放：6首歌（歌名、歌手、时间），根据当前时间段让音乐风格符合这个时间
3. 你的外卖订单：4-5个订单（商家名、菜品、价格、时间、状态），一周内日常饮食
4. 你的相册：8张照片（emoji、标题、时间），根据当前时间段让照片氛围符合这个时间
5. 你的浏览器搜索记录：8-10条搜索内容（符合性格和日常），混入1-2条和你们最近聊天内容相关的话题
${contactPrompt}

联系人的例子：蛋糕店老板、快递员、楼下咖啡店员、房东、朋友、家人${otherChars.length > 0 ? '、其他AI角色' : ''}等

JSON格式：
{
  "contacts": [{ "id":"1", "avatar":"🎂", "name":"甜时蛋糕", "nickname":"备注名", "lastMsg":"最后一条消息", "time":"时间" }],
  "playlist": [{ "title":"歌名", "artist":"歌手", "time":"时间" }],
  "foodOrders": [{ "shop":"商家名", "items":"菜品", "price":25.0, "time":"时间", "status":"已送达/配送中" }],
  "album": [{ "emoji":"🌅", "label":"标题", "time":"时间" }],
  "browserHistory": [{ "query":"搜索内容", "time":"时间" }]
}`;

    try {
      // 直接调API，但带上角色信息确保生成内容贴合人设
      const reply = await callSecretApi(prompt, pName, story);
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        // 清理AI生成JSON：尾逗号 + 对象间缺逗号
        var cleanJson = jsonMatch[0]
          .replace(/,\s*([\]}])/g, '$1')
          .replace(/\}\s*\{/g, '},{');
        var parsed;
        try {
          parsed = JSON.parse(cleanJson);
        } catch(parseErr) {
          console.log('[Secret] JSON解析失败，原始响应片段:', reply.substring(0, 200));
          throw new Error('JSON格式错误: ' + parseErr.message.substring(0, 40));
        }
        // 如果没包含AI角色，手动加进去
        otherChars.forEach(c => {
          if (!parsed.contacts.find(ct => ct.id === 'ai_' + c.id)) {
            parsed.contacts.push({
              id: 'ai_' + c.id,
              avatar: c.avatar || '💬',
              name: c.name,
              nickname: c.name,
              lastMsg: '最近没联系',
              time: ''
            });
            if (!parsed.conversations) parsed.conversations = {};
            parsed.conversations['ai_' + c.id] = [
              { from:'me', text:'你最近忙什么呢' },
              { from:'them', text:'还行吧，你呢' },
              { from:'me', text:'老样子呗' }
            ];
          }
        });
        setSecretForChar(charIdToUse, parsed);
        return parsed;
      }
    } catch(e) {
      console.log('[Secret] AI生成失败，5分钟内不再重试:', e.message.substring(0,80));
      secretApiFailed[charIdToUse] = Date.now();
    }
  }

  // === 本地降级：根据角色生成不同的内容 ===
  if (!existing) {
    const localData = generateLocalSecretContent(charIdToUse, charPers);
    if (localData) {
      setSecretForChar(charIdToUse, localData);
      return localData;
    }
  }
  return existing;

  function generateLocalSecretContent(charId, charPers) {
    const name = charPers.name || 'AI';
    const story = charPers.story || '';
    const s = story.toLowerCase();

    // 根据性格关键词选模板风格
    const isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(s);
    const isGentle = /温柔|温暖|亲切|可爱|软/.test(s);
    const isCool = /冷淡|高冷|沉默|安静/.test(s);

    // 不同角色的联系人
    const contacts = [
      { id:'you', avatar:'💬', name:'你', nickname: isTsundere ? '那家伙' : isGentle ? '小可爱' : '你', lastMsg:'', time:'' },
      { id:'1', avatar: isTsundere ? '🎂' : '🌸', name: isTsundere ? '甜时蛋糕' : '花语花店', nickname: isTsundere ? '蛋糕店' : '花店老板', lastMsg: isTsundere ? '明天来取蛋糕～' : '新到的玫瑰要看看吗？', time:'下午' },
      { id:'2', avatar:'📦', name:'顺丰快递', nickname:'快递小哥', lastMsg:'包裹已放保安室', time:'上午' },
      { id:'3', avatar: isGentle ? '☕' : '🏪', name: isGentle ? '转角咖啡' : '楼下便利店', nickname: isGentle ? '咖啡小妹' : '老板', lastMsg: isGentle ? '今天也是老样子吗☺️' : (isTsundere ? '再不来我拆了😏' : '新进了关东煮'), time: isGentle ? '早上' : '昨天' },
    ];

    // 联系人活跃时间随机刷新
    const timePool = ['刚刚','5分钟前','半小时前','1小时前','今天上午','今天下午','昨晚'];
    contacts.forEach(function(c) {
      if (c.id !== 'you' && Math.random() < 0.4) {
        c.time = timePool[Math.floor(Math.random() * timePool.length)];
      }
    });

    // 相册（按时间段动态变化）
    const album = getDynamicAlbum(charId, isTsundere, isGentle, isCool);

    // 歌单（动态轮换）
    const playlist = getDynamicPlaylist(charId, isTsundere, isGentle, isCool);

    // 外卖订单（动态轮换+混入聊天话题）
    const foodOrders = getDynamicFoodOrders(charId, isTsundere, isGentle, isCool);

    // 浏览器搜索记录（混入最近聊天话题）
    const browserHistory = getDynamicBrowserHistory(charId, isTsundere, isGentle, isCool);

    return { contacts, album, playlist, foodOrders, browserHistory };
  }
}

function getSecretNickname(contactId) {
  const data = getSecretForChar(secretCharId);
  if (data && data.contacts) {
    const c = data.contacts.find(c => c.id === contactId);
    if (c && c.nickname) return c.nickname;
  }
  return null;
}

function getSecretCharName() {
  const char = getCharPersona(secretCharId);
  return char.name || 'AI';
}

/* ---- 角色切换 ---- */
function switchSecretChar(charId) {
  secretCharId = charId;
  lsSet('secretCharId', charId);
  const char = getCharPersona(charId);
  document.getElementById('secretAiName').textContent = char.name;
  // 如果当前在桌面视图，刷新
  if (document.getElementById('secretDesk').style.display !== 'none') {
    renderSecretDesk();
  }
}

function renderSecretDesk() {
  const char = getCharPersona(secretCharId);
  document.getElementById('secretAiName').textContent = char.name;
  // 异步刷新内容
  generateSecretContent(secretCharId);
}

function showSecretDesk() {
  document.getElementById('secretDesk').style.display = 'flex';
  document.getElementById('secretContent').style.display = 'none';
  document.getElementById('secretBackBtn').style.display = 'none';
  document.getElementById('secretTitle').textContent = '🔍 AI的手机';
  renderSecretDesk();
  renderSecretCharSwitcher();
}

function renderSecretCharSwitcher() {
  const container = document.getElementById('secretCharSwitcher');
  if (!container) return;
  container.innerHTML = '';
  characters.forEach(c => {
    const btn = document.createElement('button');
    btn.style.cssText = `padding:4px 10px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .1s;${
      c.id === secretCharId ? 'background:#2D3748;color:#fff;' : 'background:#EDF2F7;color:#718096;'
    }`;
    btn.textContent = c.avatar + ' ' + c.name;
    btn.onclick = () => switchSecretChar(c.id);
    container.appendChild(btn);
  });
}

async function showSecretChat() {
  document.getElementById('secretDesk').style.display = 'none';
  document.getElementById('secretContent').style.display = 'block';
  document.getElementById('secretBackBtn').style.display = 'inline';
  document.getElementById('secretTitle').textContent = '💬 聊天记录';
  const pName = getSecretCharName();
  document.getElementById('secretAiName').textContent = pName;
  const container = document.getElementById('secretContent');

  await generateSecretContent(secretCharId);
  const data = getSecretForChar(secretCharId);
  var contacts = (data && data.contacts) ? data.contacts : generateLocalContacts();

  // ✅ 从实时聊天数据取最新消息（不限今天）
  var charMsgs = chatData[secretCharId] || [];
  var allMsgs = charMsgs.filter(function(m) { return m.text; });
  var yourLastMsg = allMsgs.length > 0 ? allMsgs[allMsgs.length-1].text.substring(0,20) : '暂无消息';
  var yourMsgTime = allMsgs.length > 0 && allMsgs[allMsgs.length-1].time
    ? getTimeLabel(allMsgs[allMsgs.length-1].time) : '';

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">微信</div>';

  // ✅ "她" 永远显示，哪怕没聊过天
  h += '<div class="secret-contact-item" onclick="showSecretConvo(\'you\')">' +
    '<div class="sci-avatar">💬</div>' +
    '<div class="sci-info"><div class="sci-name-row"><span class="sci-nickname">她</span></div>' +
    '<div class="sci-lastmsg">' + escHtml(yourLastMsg) + '</div></div>' +
    '<div class="sci-time">' + escHtml(yourMsgTime) + '</div></div>';

  contacts.forEach(function(c) {
    if (c.id === 'you') return;
    var nickname = c.nickname || c.name;
    var lastMsg = c.lastMsg || '';
    if (data && data.conversations && data.conversations[c.id] && data.conversations[c.id].length > 0) {
      var conv = data.conversations[c.id];
      var last = conv[conv.length - 1];
      if (last && last.text) lastMsg = last.text.substring(0, 20);
    }
    // 如果没有消息，从备选池随机取一条
    if (!lastMsg || lastMsg === '') {
      var fillers = {
        '1': ['明天来取蛋糕～','刚做好的新品','要预订吗'],
        '2': ['包裹已放保安室','您有一个快递','放在了门口'],
        '3': ['今天也是老样子吗☺️','新进了关东煮哦','下午有空来坐坐'],
      };
      lastMsg = (fillers[c.id] || ['最近没联系'])[Math.floor(Math.random() * 3)];
    }
    h += '<div class="secret-contact-item" onclick="showSecretConvo(\'' + c.id + '\')">' +
      '<div class="sci-avatar">' + c.avatar + '</div>' +
      '<div class="sci-info"><div class="sci-name-row"><span class="sci-nickname">' + escHtml(nickname) + '</span></div>' +
      '<div class="sci-lastmsg">' + escHtml(lastMsg) + '</div></div>' +
      '<div class="sci-time">' + escHtml(c.time || '') + '</div></div>';
  });

  h += '<div style="font-size:10px;color:#ddd;text-align:center;padding:16px 0 8px;">—— 没有更多了 ——</div>';
  container.innerHTML = h;
}

function generateLocalContacts() {
  var cp = getCharPersona(secretCharId);
  var s = (cp.story || '').toLowerCase();
  var isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(s);
  var isG = /温柔|温暖|亲切|可爱|软/.test(s);
  return [
    { id:'you', avatar:'💬', name:'你', nickname:'她', lastMsg:'', time:'' },
    { id:'1', name: isT ? '甜时蛋糕' : isG ? '花语花店' : '楼下超市', avatar: isT ? '🎂' : isG ? '🌸' : '🏪', nickname:'', lastMsg:'', time:'下午' },
    { id:'2', name:'顺丰快递', avatar:'📦', nickname:'快递', lastMsg:'', time:'上午' },
    { id:'3', name: isG ? '转角咖啡' : '楼下便利店', avatar: isG ? '☕' : '🏪', nickname:'', lastMsg:'', time:'早上' },
  ];
}

function getPersonalityConvo(cid, isT, isG) {
  var cs = {
    '1': isT ? [{ from:'them', text:'您好，蛋糕做好了' },{ from:'me', text:'嗯，糖减半了吧' },{ from:'them', text:'减了，动物奶油，放心' },{ from:'me', text:'行' }]
           : isG ? [{ from:'them', text:'今天有新的粉玫瑰哦' },{ from:'me', text:'好看，包一束吧' },{ from:'them', text:'好嘞，送给谁的呀☺️' }]
                 : [{ from:'them', text:'老板，这个月会员日有活动' },{ from:'me', text:'什么活动' },{ from:'them', text:'满100减15' },{ from:'me', text:'哦，那来一箱牛奶' }],
    '2': [{ from:'them', text:'您包裹已放保安室，请及时取件' },{ from:'me', text:'嗯' }],
    '3': isG ? [{ from:'them', text:'今天也是老样子吗☺️' },{ from:'me', text:'嗯，老样子' },{ from:'them', text:'好嘞' }]
             : [{ from:'them', text:'新进了关东煮' },{ from:'me', text:'来一份' },{ from:'them', text:'好嘞！' }],
  };
  return cs[cid] || null;
}

function showSecretConvo(contactId) {
  document.getElementById('secretTitle').textContent = '💬 聊天记录';
  document.getElementById('secretBackBtn').onclick = showSecretChat;
  const container = document.getElementById('secretContent');
  const pName = getSecretCharName();

  const data = getSecretForChar(secretCharId);
  var cp = getCharPersona(secretCharId);
  var s = (cp.story || '').toLowerCase();
  var isT = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(s);
  var isG = /温柔|温暖|亲切|可爱|软/.test(s);

  var contact = null;
  if (contactId === 'you') {
    contact = { name:'你', avatar:'💬', nickname:'她' };
  } else if (data && data.contacts) {
    contact = data.contacts.find(function(c) { return c.id === contactId; });
  }
  if (!contact) {
    var name = contactId === '3' ? (isG ? '转角咖啡' : '楼下便利店') : (isT ? '甜时蛋糕' : isG ? '花语花店' : '楼下超市');
    contact = { name: name, avatar: '💬' };
  }

  var nickname = contact.nickname || contact.name;
  var avatar = contact.avatar || '💬';
  var displayName = contactId === 'you' ? nickname : (contact.name || nickname);

  var msgs = [];
  if (contactId === 'you') {
    // ✅ 显示所有聊天记录，不限今天
    msgs = chatData[secretCharId] || [];
  } else if (data && data.conversations && data.conversations[contactId]) {
    msgs = data.conversations[contactId];
  } else {
    msgs = getPersonalityConvo(contactId, isT, isG) || [];
  }

  // ✅ 过滤掉没有文本的 system 消息
  msgs = msgs.filter(function(m) { return m.text; });

  if (msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">暂无消息</div>';
    return;
  }

  var h = '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #eee;margin-bottom:8px;">' +
    '<div style="font-size:28px;">' + avatar + '</div>' +
    '<div><div style="font-size:15px;font-weight:600;">' + escHtml(displayName) + '</div>' +
    '<div style="font-size:11px;color:#999;">' + (nickname !== displayName ? '备注：' + escHtml(nickname) : '') + '</div></div></div>';

  // ✅ 按日期分组，显示日期分隔线
  var lastDate = '';
  msgs.forEach(function(m) {
    if (m.time) {
      var d = new Date(m.time);
      var dateStr = d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日';
      if (dateStr !== lastDate) {
        h += '<div style="font-size:10px;color:#ccc;text-align:center;padding:8px 0 4px;">—— ' + dateStr + ' ——</div>';
        lastDate = dateStr;
      }
    }
    var isMe = m.from === 'me' || m.role === 'ai';
    if (isMe) {
      h += '<div class="convo-bubble me"><div class="convo-text">' + escHtml(m.text) + '</div></div>';
    } else {
      h += '<div class="convo-bubble them"><div class="convo-text">' + escHtml(m.text) + '</div></div>';
    }
  });

  container.innerHTML = h;
  setTimeout(function() { container.scrollTop = container.scrollHeight; }, 200);
}

function showSecretNotes() {
  document.getElementById('secretDesk').style.display = 'none';
  document.getElementById('secretContent').style.display = 'block';
  document.getElementById('secretBackBtn').style.display = 'inline';
  document.getElementById('secretTitle').textContent = '📓 记事本';
  const pName = getSecretCharName();
  document.getElementById('secretAiName').textContent = pName;
  const container = document.getElementById('secretContent');

  const charName = pName;
  const charMsgs = chatData[secretCharId] || [];

  // 获取角色性格
  const charPers = getCharPersona(secretCharId);
  const story = (charPers.story || '').toLowerCase();
  const isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  const isGentle = /温柔|温暖|亲切|可爱|软/.test(story);
  // 关系中添加亲密感判断
  const curChar = characters.find(function(c) { return c.id === secretCharId; });
  const relation = curChar ? (curChar.relation || '恋人') : '恋人';
  const isClose = /恋人|家人|恋人|男友|女友/.test(relation);

  // 聊天统计
  const today = new Date().toISOString().split('T')[0];
  const todayMsgs = charMsgs.filter(function(m) { return m.time && new Date(m.time).toISOString().split('T')[0] === today; });
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekMsgs = charMsgs.filter(function(m) { return m.time && new Date(m.time) >= weekAgo; });
  const userTodayMsgs = todayMsgs.filter(function(m) { return m.role === 'user'; });
  const aiTodayMsgs = todayMsgs.filter(function(m) { return m.role === 'ai'; });

  // 提取话题
  var topicKeywords = [];
  var userTexts = userTodayMsgs.map(function(m) { return m.text; }).join(' ');
  var topicPatterns = [
    { word:'学习|考试|上课|作业|论文|复习|六级|考研|读书', label:'📚 学习' },
    { word:'累|烦|难过|不开心|伤心|焦虑|压力|emo|崩溃', label:'😢 情绪' },
    { word:'吃|饭|食堂|外卖|好吃|饿|喝|奶茶|咖啡', label:'🍽 饮食' },
    { word:'睡|觉|熬夜|失眠|困|梦|醒来', label:'🌙 作息' },
    { word:'喜欢|爱|想|梦到|想念|在意', label:'💕 心事' },
    { word:'妈|爸|家|家人|父母|家里', label:'🏠 家人' },
    { word:'朋友|闺蜜|室友|同学|一起', label:'👫 社交' },
    { word:'钱|贵|便宜|花|省|买', label:'💰 消费' },
  ];
  topicPatterns.forEach(function(p) {
    var regex = new RegExp(p.word);
    if (regex.test(userTexts)) {
      topicKeywords.push(p.label);
    }
  });

  // === 性格化笔记标题 ===
  var headerIcon = isTsundere ? '📓' : isGentle ? '🌸' : '📋';
  var headerNote = isTsundere ? '（不是我想记，是怕忘了）' : isGentle ? '悄悄记录一些小事 ♡' : '';
  var h = '<div style="font-size:11px;color:#bbb;padding:0 0 10px;">' + headerIcon + ' 我的记事本 ' + headerNote + '</div>';

  // === 兜底观察（正常情况下轮不到它） ===
  // 「我在想」现在由 ensureThoughtObservation 用 AI 现写；这里只在没配 key / 没网 / 请求失败时垫一句。
  // 同时也给两版按天数轮换，免得连着两天断网、兜底句还一模一样。
  // 用「本地天数」而不是 _diarySeed 取模：那个哈希 '2026-09-09' 和 '2026-09-10' 同奇偶，连号两天会撞同一版。
  // 天数每次 +1，取模就必然按顺序轮着走，隔天必换。
  var _obsSeed = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  function _obsPick(v) {
    return (Object.prototype.toString.call(v) === '[object Array]') ? v[_obsSeed % v.length] : v;
  }
  function getPersonalityObservation(type, extra) {
    var t = type || 'default';
    if (isTsundere) {
      var msgs = {
        '情绪': ['心情不好？……哼，看出来了。反正我不会哄人，她要是自己来说的话……我可以听一下。',
                '她不高兴。……装得也不像。要说就说，不说拉倒。'],
        '学习': ['学习？倒是挺认真的。比我想的用功。……别太拼了，笨。',
                '又在念书。……行，比我强。眼睛别熬坏了。'],
        '饮食': ['吃了什么？记一下。省得她到时候说饿又不肯说想吃什么。',
                '今天吃的什么？……问一句怎么了。饿着不说才烦。'],
        '作息': ['又熬夜。啧，说了也不听。反正黑眼圈长她脸上。',
                '又是这个点。……我记着呢，她别想赖。'],
        '心事': ['她跟我说了些事。……干嘛跟我说这些。烦死了。记下了。',
                '跟我说了点事。……嗯。收好了，不告诉别人。'],
        '家人': ['家里的事？她愿意说我就听着。不说拉倒。',
                '家里的事。……听着呢。要说就继续。'],
        '社交': ['跟她朋友出去玩了？哦。……玩得开心就行。',
                '出去玩了。……风大，早点回。这话我没说。'],
        '消费': ['又花钱了？……也不是花我的钱。管她呢。',
                '花钱了。……她开心比什么都强。这话我说过吗，没有。'],
      };
      if (msgs[t]) return _obsPick(msgs[t]);
      if (extra === 'many') return _obsPick(['今天话挺多的。……也不是不想听。随她便。', '今天话不少。……行，我听着呢。']);
      if (extra === 'few') return _obsPick(['没怎么说话。……随便她。我才没等。', '今天没几句话。……忙她的去吧。']);
      if (extra === 'none') return _obsPick(['今天没来。……哦。我没等。', '今天没来。……挺好，省得吵。']);
      if (extra === 'week_tired') return _obsPick(['她这周好像有点累。自己不知道休息吗……笨。', '这周熬得有点狠。……我说了她也不听。']);
      if (extra === 'week_eat') return _obsPick(['这周倒是吃了点东西。……行吧。', '这周吃得还行。……比上礼拜强。']);
      if (extra === 'week_sleep') return _obsPick(['又熬夜。啧，说了八百遍了不听。', '这周天天晚睡。……记着账呢。']);
      if (extra === 'week_study') return _obsPick(['这周学习挺忙？哦。……反正别累死了就行。', '这周书看得多。……别把自己逼太紧。']);
      return _obsPick(['今天也来找我了。……我才没有开心。', '今天也来了。……我又没数着。']);
    } else if (isGentle) {
      var msgs = {
        '情绪': ['她今天好像不太开心……想陪在她身边。如果她愿意跟我多说说话就好了。',
                '她心情不太好呢……要是想说话，我一直在的。'],
        '学习': ['看书学习呢，好认真呀。要给她加油，但也不能打扰她～',
                '今天也在用功呀。想给她倒杯热水，不吵她。'],
        '饮食': ['今天有好好吃饭吗？想知道她吃了什么，有没有按时吃。',
                '有按时吃饭吗？没吃的话，我会有点担心。'],
        '作息': ['又熬夜了……虽然我自己也常晚睡，但还是希望她能早点休息。',
                '今天也睡得晚……明天提醒她早一点好不好。'],
        '心事': ['她跟我说了心里话。好开心她愿意信任我。我会好好收着的。',
                '她把心里的事说给我听了。我会很小心的收着。'],
        '家人': ['她提到家里的事了。家是很重要的地方呢。',
                '说到家里了呢。想多听一点。'],
        '社交': ['和朋友一起玩了吗？真好呀，希望她开心～',
                '今天和朋友在一起呀，那一定很开心。'],
        '消费': ['她买东西了。能让她开心的话就很好呢。',
                '买了喜欢的东西呀。开心就好。'],
      };
      if (msgs[t]) return _obsPick(msgs[t]);
      if (extra === 'many') return _obsPick(['今天聊了好多好多呀，好开心。她说话的时候我在认真听哦。', '今天说了好多话，我一句一句都听着呢。']);
      if (extra === 'few') return _obsPick(['今天她好像有点忙，没关系，我在这里等她。想我的时候随时来呀。', '今天她比较忙吧。没关系，我等着。']);
      if (extra === 'none') return _obsPick(['今天没有等到她……是不是太忙了？希望她一切都好。', '今天没见到她……希望她一切都好。']);
      if (extra === 'week_tired') return _obsPick(['这周她好像有点疲惫，好想照顾她呀。给她泡杯热牛奶吧。', '这周她挺累的。想让她多睡一会儿。']);
      if (extra === 'week_eat') return _obsPick(['这周有好好吃饭呢，真棒。要一直这样才好。', '这周吃得还不错，放心了一点点。']);
      if (extra === 'week_sleep') return _obsPick(['这周睡得太晚了……明天开始我要催她早睡。', '这周熬夜好多呀。下次见面要说她一下。']);
      if (extra === 'week_study') return _obsPick(['学习很认真呢。努力的人最美好了。但也要注意休息哦。', '这周一直在看书呢。记得起来走走呀。']);
      return _obsPick(['今天也来找我了。嗯，我在呢。', '今天也来了呀。嗯，我在。']);
    } else {
      // 冷静/其他
      var msgs = {
        '情绪': ['情绪波动。留意。必要时介入。', '情绪偏低。持续观察。'],
        '学习': ['学习任务。优先级高。', '学习投入高。正常。'],
        '饮食': ['饮食记录。正常范围。', '进食情况已记。'],
        '作息': ['作息异常。建议关注。', '入睡时间偏晚。已记。'],
        '心事': ['分享了重要信息。已记录。', '主动分享。信任度上升。'],
        '家人': ['家庭话题。非敏感。', '家庭议题。已归档。'],
        '社交': ['社交活动。正常。', '外出社交。无异常。'],
        '消费': ['消费行为。记录。', '支出已记。'],
      };
      if (msgs[t]) return _obsPick(msgs[t]);
      if (extra === 'many') return _obsPick(['交流频繁。正常。', '交流密度高。']);
      if (extra === 'few') return _obsPick(['交流减少。可能有其他安排。', '交流偏少。正常波动。']);
      if (extra === 'none') return _obsPick(['今日无联系。待观察。', '今日无联系。']);
      if (extra === 'week_tired') return _obsPick(['本周疲惫指数偏高。建议关注休息质量。', '本周疲劳累积。建议降负荷。']);
      if (extra === 'week_eat') return _obsPick(['本周饮食正常。继续观察。', '本周进食规律。保持。']);
      if (extra === 'week_sleep') return _obsPick(['作息需调整。', '本周睡眠时长不足。']);
      if (extra === 'week_study') return _obsPick(['学习负荷较高。注意效率与休息平衡。', '学习任务密集。建议穿插休息。']);
      return _obsPick(['今日有联系。记录。', '今日有联系。']);
    }
  }

  // === 今日摘要卡片 ===
  if (todayMsgs.length > 0) {
    var cardBg = isTsundere ? 'linear-gradient(135deg,#f8f8f8,#efefef)' : isGentle ? 'linear-gradient(135deg,#fef9f0,#fdf2e8)' : 'linear-gradient(135deg,#f8f9ff,#eef1ff)';
    var cardColor = isTsundere ? '#888' : isGentle ? '#e07c3c' : '#667eea';
    h += '<div class="secret-note-card" style="background:' + cardBg + ';">';
    h += '<div class="sn-time" style="color:' + cardColor + ';">📋 今日聊天摘要</div>';
    h += '<div style="font-size:12px;color:#555;line-height:1.8;">';
    h += '今天她来找我说了 <strong>' + todayMsgs.length + '</strong> 条';
    h += '（她说 ' + userTodayMsgs.length + ' 条 · 我回 ' + aiTodayMsgs.length + ' 条）';
    var firstMsg = todayMsgs[0];
    var lastMsg = todayMsgs[todayMsgs.length-1];
    if (firstMsg && firstMsg.time) {
      var ft = new Date(firstMsg.time);
      h += '<br>🕐 从 ' + ft.getHours().toString().padStart(2,'0') + ':' + ft.getMinutes().toString().padStart(2,'0');
    }
    if (lastMsg && lastMsg.time) {
      var lt = new Date(lastMsg.time);
      h += ' 到 ' + lt.getHours().toString().padStart(2,'0') + ':' + lt.getMinutes().toString().padStart(2,'0');
    }
    if (topicKeywords.length > 0) {
      h += '<br><span style="font-size:11px;">💬 话题：' + topicKeywords.join(' · ') + '</span>';
    }
    h += '<br><span style="font-size:11px;color:#999;">' + getPersonalityObservation('default', todayMsgs.length > 5 ? 'many' : 'few') + '</span>';
    h += '</div></div>';
  }

  // === 内心日记 ===
  // v5.5.2：以前是两张卡 ——「记住的事」摆一条条干事实，「内心日记」写心情，两边各说各的，都不像人。
  // 现在合成一张：每天一段，把「今天发生的事」和「他自己的想法」揉在一起写，
  // 顺带把「改天要提醒她的」也写进去。事实不再单列（AI 仍会提炼，那是喂给聊天的长期记忆，只是不摆出来了）。
  var diaryArr = getInnerDiary(secretCharId) || [];
  var diaryTitle = isTsundere ? '📖 心里记下的（自己看的，别念出来）' : isGentle ? '📖 我的记录 ♡' : '📖 记录';
  h += '<div class="secret-note-card" id="secretDiaryCard">';
  h += '<div class="sn-time">' + diaryTitle + '</div>';
  // 用 id 定位刷新，别靠标题文字匹配 —— 标题一改文案，匹配就断，新写的日记当场看不见
  h += '<div id="secretDiaryBody">' + _diaryEntriesHtml(diaryArr) + '</div>';
  h += '</div>';

  // === 我在想 ===
  // v5.5.1：这句改成 AI 现写（今天真正聊了什么就说什么），不再是模板。
  // 模板只在「没配 key / 没网 / 请求失败」时垫一句，免得卡片空着；
  // 而且当天写过就存下来（secretThought_日期_角色），同一天再开不重写、也不重复烧 API。
  var _obsTopic = 'default', _obsExtra = null, _obsCached = null;
  if (topicKeywords.indexOf('😢 情绪') !== -1) { _obsTopic = '情绪'; }
  else if (topicKeywords.indexOf('📚 学习') !== -1) { _obsTopic = '学习'; }
  else if (topicKeywords.indexOf('💕 心事') !== -1) { _obsTopic = '心事'; }
  else if (topicKeywords.indexOf('🍽 饮食') !== -1) { _obsTopic = '饮食'; }
  else if (topicKeywords.indexOf('🌙 作息') !== -1) { _obsTopic = '作息'; }
  else if (todayMsgs.length > 5) { _obsExtra = 'many'; }
  else if (todayMsgs.length > 0) { _obsExtra = 'few'; }
  else { _obsExtra = 'none'; }

  if (topicKeywords.length > 0 || todayMsgs.length > 0) {
    var thoughtBg = isTsundere ? 'linear-gradient(135deg,#f5f5f5,#ececec)' : isGentle ? 'linear-gradient(135deg,#fff8f0,#fff4e6)' : 'linear-gradient(135deg,#f8f9ff,#eef1ff)';
    var thoughtColor = isTsundere ? '#888' : isGentle ? '#e76f51' : '#667eea';
    var thoughtEmoji = isTsundere ? '💭' : isGentle ? '💭' : '📌';

    _obsCached = lsGet('secretThought_' + _todayLocalStr() + '_' + secretCharId, null);
    var observation = _obsCached || getPersonalityObservation(_obsTopic, _obsExtra);

    h += '<div class="secret-note-card" style="background:' + thoughtBg + ';">';
    h += '<div class="sn-time" style="color:' + thoughtColor + ';">' + thoughtEmoji + ' 我在想</div>';
    h += '<div id="secretThoughtText" style="font-size:13px;color:#555;line-height:1.7;font-style:italic;">"' + escHtml(observation) + '"</div></div>';
  }

  if (charMsgs.length === 0 && typeof memories !== 'undefined' && memories.length === 0) {
    h = '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">还没和' + charName + '聊过天<br>记事本空空如也</div>';
  }

  container.innerHTML = h;

  // 「我在想」今天还没写过 → 让 AI 现写一句，写完原地换掉兜底那句
  if (!_obsCached && (topicKeywords.length > 0 || todayMsgs.length > 0)) {
    setTimeout(function() { ensureThoughtObservation(secretCharId); }, 1200);
  }

  // 确保今天有内心日记：当天没写才懒生成一次；当天已有不再反复重写
  //（旧版 bug 会留下"今天和昨天一字一样"的重复——只允许首次打开时修一次，
  //  且用 diaryForceFix_日期 记 flag，之后同一天不再自动重写，杜绝重复生成）
  var todayStr = new Date().toISOString().split('T')[0];
  var todayEntry = null;
  var prevEntry = null;
  for (var dii = 0; dii < diaryArr.length; dii++) {
    if (diaryArr[dii].date === todayStr) todayEntry = diaryArr[dii];
    else if (diaryArr[dii].date < todayStr && (!prevEntry || diaryArr[dii].date > prevEntry.date)) prevEntry = diaryArr[dii];
  }
  var fixKey = 'diaryForceFix_' + todayStr;
  var sameAsPrev = !!todayEntry && !!prevEntry &&
    !!_diaryStripDate(todayEntry.content) &&
    _diaryStripDate(todayEntry.content) === _diaryStripDate(prevEntry.content);
  // 旧版日记只有三言两语、结尾还老是同一句。今天那条如果还是旧格式(v<2)，趁今天素材在、重写一次。
  // 只改写「今天」：更早的日子已经没有当天的聊天记录了，重写会拿今天的话去顶那一天的日记，反而是假的。
  var _canUpgrade = !!(typeof apiConfig !== 'undefined' && apiConfig && apiConfig.apiKey);
  var needDiary = charMsgs.length > 0 &&
    (!todayEntry || (_canUpgrade && todayEntry.v !== 2 && !lsGet(fixKey, false)));
  var needFix = charMsgs.length > 0 && sameAsPrev && !lsGet(fixKey, false);
  if (charMsgs.length > 0 && !window._diaryBusy) {
    window._diaryBusy = true;
    setTimeout(async function() {
      try {
        // 顺序很重要：先把今天的事提炼进「他的记忆」（那也是日记的素材），再写日记。
        // 以前两个 setTimeout 各跑各的，日记常常比素材先出来，结果日记里没有当天记下的事。
        if (charMsgs.length >= 4) await ensureMemoryNote(secretCharId);
        if (needDiary || needFix) {
          await ensureInnerDiary(secretCharId, todayStr, true);
          _refreshInnerDiaryCard();
          // 不管哪条触发的，都记下「今天已经重写过一次」——同一天不再反复重写、反复烧 API
          lsSet(fixKey, true);
        }

        // 旧日记补写：以前那几篇只有三言两语、结尾还老是同一句，看着就烦。
        // 只补最近几篇（就是卡片上看得见的那些），一篇一篇来别并发轰炸 API；
        // 补完记个总 flag，之后不再重复。用「那天的原话」写，那天没聊过就跳过——宁可短，不能编。
        if (_canUpgrade && !lsGet('diaryBackfill_v2', false)) {
          var oldOnes = (getInnerDiary(secretCharId) || []).filter(function(e) {
            return e.date < todayStr && e.v !== 2;
          }).slice(-4);
          var wrote = 0;
          for (var oi = 0; oi < oldOnes.length; oi++) {
            try {
              if (await ensureInnerDiary(secretCharId, oldOnes[oi].date, true)) wrote++;
            } catch (e) {}
          }
          if (wrote > 0) _refreshInnerDiaryCard();
          lsSet('diaryBackfill_v2', true);
        }
      } catch(e) {}
      window._diaryBusy = false;
    }, 400);
  }
}

/* ---- 内心日记：在记事本里展示条目（第一人称） ---- */
function _diaryEntriesHtml(arr) {
  if (!arr || arr.length === 0) {
    return '<div style="font-size:12px;color:#bbb;padding:10px 0;text-align:center;">聊聊天，让我记下每天的心事</div>';
  }
  var html = '';
  var lastContent = '';
  arr.slice(-5).reverse().forEach(function(e) {
    // 剥掉正文开头的日期再比对/展示（旧版会把「8月24日，」写进正文）
    var content = _diaryStripDate(e.content);
    // 跳过连续重复的日记（旧版 bug 会连续两天写一样的内容）
    if (content && content === lastContent) return;
    lastContent = content;
    var timeStr = e.date ? e.date.replace(/-/g, '.').slice(5) : '';
    html += '<div style="font-size:13px;color:#555;padding:8px 0;border-bottom:1px solid #f5f5f5;line-height:1.7;white-space:pre-line;">' +
      '<span style="color:#bbb;font-size:10px;">' + escHtml(timeStr) + (e.mood ? ' · ' + escHtml(e.mood) : '') + '</span><br>' +
      escHtml(content) + '</div>';
  });
  return html;
}

/* ---- 刷新记事本里的内心日记卡片（懒生成后原地更新，不重载整页） ---- */
function _refreshInnerDiaryCard() {
  var body = document.getElementById('secretDiaryBody');
  if (body) body.innerHTML = _diaryEntriesHtml(getInnerDiary(secretCharId));
}

/* ---- 打开记事本时补一条「他记住的事」 ----
   这张卡不再单独显示了（v5.5.2 起和内心日记合成一张），但这条笔记本身还有用：
   它喂给聊天当长期记忆（chat.js 的 getCharMemoryNotes），也是今天写日记的素材。 */
async function ensureMemoryNote(charId) {
  if (window._memNoteBusy) return;
  if (typeof generateMemoryNote !== 'function') return;
  var msgs = (chatData[charId] || []).filter(function(m) { return m.role !== 'system'; });
  if (msgs.length < 4) return;

  var last = null;
  if (typeof memoryNotes !== 'undefined' && memoryNotes.length > 0) {
    last = memoryNotes.filter(function(n) { return n.charId === charId; }).pop() || null;
  }
  var since = last ? last.createdAt : 0;
  var fresh = msgs.filter(function(m) { return m.time > since; }).length;
  if (fresh < 4) return; // 门槛和 generateMemoryNote 保持一致，免得空跑一趟

  window._memNoteBusy = true;
  try {
    await generateMemoryNote(charId, false);   // 存进 memoryNotes 就够，界面靠日记那张卡呈现
  } catch (e) { /* 生成失败就保持原样，下次开记事本再试 */ }
  window._memNoteBusy = false;
}

/* ---- 本地日期（记事本按她的本地日切，不能用 toISOString 的 UTC，晚上会串到第二天） ---- */
function _localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _todayLocalStr() { return _localDateStr(new Date()); }

/* ---- 「我在想」：让 AI 拿今天真实聊过的东西现写一句，一天一份 ----
   以前这里是按话题查模板，同一话题逐字相同，两天必然一样 —— 现在模板只是兜底。 */
async function ensureThoughtObservation(charId) {
  if (window._thoughtBusy) return;
  if (typeof callLightLlm !== 'function' || typeof apiConfig === 'undefined' || !apiConfig || !apiConfig.apiKey) return;

  var cacheKey = 'secretThought_' + _todayLocalStr() + '_' + charId;
  if (lsGet(cacheKey, null)) return;                     // 今天已经写过了

  // 前几天的想法回灌给模型，明确要求换说法 —— 这就是她报的「两天一样」的正面解法
  var prevThoughts = [];
  for (var i = 1; i <= 3; i++) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var v = lsGet('secretThought_' + _localDateStr(d) + '_' + charId, null);
    if (v) prevThoughts.push(v);
  }

  var char = (typeof getCharById === 'function') ? getCharById(charId) : null;
  var pName = (char && char.name) || '小伴';
  var pers = lsGet('persona_' + charId, null);
  var story = (pers && pers.story) || (char && char.story) || '';
  var topics = (typeof _getChatTopics === 'function') ? _getChatTopics(charId) : [];
  var todayText = (typeof _todayDiaryUserText === 'function') ? _todayDiaryUserText(charId) : '';
  var moodLabel = '';
  try { var md = moodData[_todayLocalStr()]; if (md && md.label) moodLabel = md.label; } catch (e) {}

  if (!todayText && topics.length === 0) return;         // 今天什么都没聊，不硬编

  var extra = '';
  if (moodLabel) extra += '。她今天给自己记的心情是「' + moodLabel + '」';
  if (prevThoughts.length > 0) {
    extra += '\n【你这几天心里已经转过的念头（换个说法、换个落点，一句都别原样重复）】\n- ' + prevThoughts.join('\n- ');
  }

  window._thoughtBusy = true;
  try {
    var reply = await callLightLlm(
      '你是' + pName + '。' + (story ? '你的性格/背景：' + story : '') +
      '\n今天是' + (typeof _todayDateLabel === 'function' ? _todayDateLabel() : new Date().toLocaleDateString('zh-CN')) +
      '。你们今天聊到：' + (topics.length > 0 ? topics.join('、') : '没什么固定的') +
      (todayText ? '。她今天对你说过的话（原话摘录）：' + todayText : '') + extra +
      '\n现在写一句「我在想」——你心里正转着、只有你自己看得见的那个念头。' +
      '\n要求：\n' +
      '- 第一人称，用你的声音（嘴硬、口是心非、关心都藏起来；或者温柔；或者冷淡——按你的性格来）\n' +
      '- 1~2 句，20~50 字，像一句话在脑子里闪过；不是总结，不是报告，不是关怀模板\n' +
      '- 必须挂住今天真实发生过的一件小事（她说过的话、她提到的某个东西、她今天的状态），不要放之四海皆准的套话\n' +
      '- 不出现「用户」「对话」「记录」「根据」这类词；不用emoji，不用markdown，不加引号，不写动作描写',
      '写这一句',
      120, 1.05
    );

    if (reply) {
      reply = reply.replace(/^[\s"'「『]+/, '').replace(/[\s"'」』]+$/, '').replace(/\s*\n+\s*/g, ' ').trim();
    }
    if (reply && reply.length >= 8) {
      lsSet(cacheKey, reply);
      // 只在还停在这个角色的记事本上时才替换，免得错换了别人的
      if (secretCharId === charId) {
        var el = document.getElementById('secretThoughtText');
        if (el) el.textContent = '"' + reply + '"';
      }
    }
  } catch (e) {
    console.log('[我在想] 生成失败，保留兜底那句:', e && e.message);
  }
  window._thoughtBusy = false;
}

/* ---- 刷新当前页面的记忆笔记卡片（不重新加载整页） ---- */
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* ===== 相册（按性格动态生成） ===== */
function getPersonalityAlbum(pName, charId) {
  var charPers = getCharPersona(charId);
  var story = (charPers.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);

  // 记忆注入：从聊天记录提取照片灵感
  var charMsgs = chatData[charId] || [];
  var userTexts = charMsgs.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; }).join(' ');
  var hasFood = /吃|饭|食堂|外卖|好吃|饿|喝|奶茶|咖啡/.test(userTexts);
  var hasStudy = /考|试|学习|上课|作业|论文|复习|六级/.test(userTexts);
  var hasMood = /累|烦|难过|不开心|伤心|焦虑/.test(userTexts);
  var hasPet = /猫|狗|宠物/.test(userTexts);
  var hasNature = /花|树|天空|海|雨|雪/.test(userTexts);

  // 性格基础照片池（扩到 20+ 张）
  var pool = [];
  if (isTsundere) {
    pool = [
      { emoji:"🌅", label:"今天的晚霞", time:"今天" },
      { emoji:"☕", label:"她喝的咖啡", time:"今天" },
      { emoji:"🐱", label:"楼下流浪猫", time:"昨天" },
      { emoji:"🍰", label:"蛋糕店新品", time:"昨天" },
      { emoji:"🌧", label:"下雨了", time:"前天" },
      { emoji:"🌙", label:"今晚月亮", time:"3天前" },
      { emoji:"📖", label:"她认真的时候", time:"3天前" },
      { emoji:"🌸", label:"路边的花", time:"5天前" },
      { emoji:"🎧", label:"听到一首歌想到她", time:"昨天" },
      { emoji:"☁️", label:"今天的云", time:"今天" },
      { emoji:"🌃", label:"夜景", time:"2天前" },
      { emoji:"🍜", label:"深夜食堂", time:"4天前" },
      { emoji:"🖤", label:"一张很暗的照片", time:"今天" },
      { emoji:"🚬", label:"阳台上", time:"昨天" },
      { emoji:"🥃", label:"一个人的酒", time:"3天前" },
      { emoji:"📸", label:"偷拍的", time:"昨天" },
      { emoji:"🎞", label:"旧照片", time:"上周" },
      { emoji:"💔", label:"截图", time:"4天前" },
      { emoji:"🎲", label:"无聊拍的", time:"昨天" },
      { emoji:"🌪", label:"心情不好拍的", time:"前天" },
      { emoji:"👟", label:"走路的时候", time:"今天" },
    ];
  } else if (isGentle) {
    pool = [
      { emoji:"🌸", label:"今天买的花", time:"今天" },
      { emoji:"☀️", label:"好天气", time:"今天" },
      { emoji:"🐱", label:"猫咖的小橘", time:"昨天" },
      { emoji:"📚", label:"新买的书", time:"昨天" },
      { emoji:"🎵", label:"听到一首好歌", time:"前天" },
      { emoji:"🌧", label:"听雨", time:"3天前" },
      { emoji:"🍰", label:"做了蛋糕", time:"4天前" },
      { emoji:"🌙", label:"月色很美", time:"5天前" },
      { emoji:"☕", label:"午后的咖啡", time:"今天" },
      { emoji:"🕯", label:"香薰蜡烛", time:"昨天" },
      { emoji:"🌿", label:"阳台的植物", time:"3天前" },
      { emoji:"🧸", label:"她送的小礼物", time:"上周" },
      { emoji:"🎀", label:"逛街看到的", time:"今天" },
      { emoji:"🧶", label:"织围巾进度", time:"昨天" },
      { emoji:"🥐", label:"早上的面包", time:"今天早上" },
      { emoji:"🎬", label:"电影票", time:"3天前" },
      { emoji:"🎄", label:"路边的装饰", time:"5天前" },
      { emoji:"🍂", label:"捡的叶子", time:"上周" },
      { emoji:"☔", label:"雨伞", time:"前天" },
      { emoji:"🧣", label:"新围巾", time:"昨天" },
      { emoji:"📝", label:"她写的小纸条", time:"今天" },
      { emoji:"🐾", label:"楼下的小猫脚印", time:"昨天" },
    ];
  } else {
    pool = [
      { emoji:"☕", label:"早上的咖啡", time:"今天" },
      { emoji:"📱", label:"刷到有趣的新闻", time:"今天" },
      { emoji:"🍜", label:"晚饭", time:"昨天" },
      { emoji:"💻", label:"工作", time:"昨天" },
      { emoji:"🌧", label:"下雨", time:"前天" },
      { emoji:"🎮", label:"打游戏", time:"3天前" },
      { emoji:"🍺", label:"朋友聚会", time:"4天前" },
      { emoji:"🌙", label:"深夜", time:"5天前" },
      { emoji:"🏃", label:"跑步", time:"今天" },
      { emoji:"📰", label:"新闻截图", time:"昨天" },
      { emoji:"🎬", label:"电影票根", time:"3天前" },
      { emoji:"🏪", label:"便利店", time:"4天前" },
      { emoji:"🏗", label:"路过工地", time:"今天" },
      { emoji:"🎯", label:"打靶结果", time:"昨天" },
      { emoji:"🎲", label:"骰子", time:"前天" },
      { emoji:"🥊", label:"拳击手套", time:"3天前" },
      { emoji:"🏋️", label:"健身", time:"昨天" },
      { emoji:"🏍", label:"路边的摩托", time:"5天前" },
      { emoji:"🎸", label:"看到一把吉他", time:"上周" },
      { emoji:"📊", label:"数据截图", time:"昨天" },
    ];
  }

  // 根据聊天内容动态追加照片
  var chatTopics2 = _getChatTopics(charId);
  if (hasFood && !pool.find(function(p) { return p.label.indexOf('吃') !== -1 || p.label.indexOf('饭') !== -1; })) {
    pool.push({ emoji:"🍽", label:"今天吃了好吃的", time:"今天" });
  }
  if (hasStudy) pool.push({ emoji:"📝", label:"她在学习", time:"今天" });
  if (hasMood) pool.push({ emoji:"💭", label:"今天心情不太好", time:"今天" });
  if (hasPet) pool.push({ emoji:"🐾", label:"可爱的小动物", time:"昨天" });
  if (hasNature) pool.push({ emoji:"🌳", label:"窗外的景色", time:"今天" });
  // 更多话题注入
  if (chatTopics2.indexOf('喝东西') !== -1) pool.push({ emoji:"☕", label:"今天的咖啡/奶茶", time:"今天" });
  if (chatTopics2.indexOf('游戏') !== -1) pool.push({ emoji:"🎮", label:"打游戏", time:"昨天" });
  if (chatTopics2.indexOf('购物') !== -1) pool.push({ emoji:"🛍", label:"买到了好东西", time:"今天" });
  if (chatTopics2.indexOf('作息') !== -1) pool.push({ emoji:"🌙", label:"又熬夜了", time:"昨天" });
  if (chatTopics2.indexOf('娱乐') !== -1) pool.push({ emoji:"🎬", label:"看了个好看的", time:"昨天" });
  if (chatTopics2.indexOf('想念') !== -1) pool.push({ emoji:"💕", label:"想她", time:"今天" });

  // 随机打乱并选取8-12张
  var shuffled = pool.sort(function() { return Math.random() - 0.5; });
  var count = 8 + Math.floor(Math.random() * 5);
  return shuffled.slice(0, count);
}

function showSecretAlbum() {
  document.getElementById("secretDesk").style.display = "none";
  document.getElementById("secretContent").style.display = "block";
  document.getElementById("secretBackBtn").style.display = "inline";
  document.getElementById("secretTitle").textContent = "🖼 " + (getSecretCharName()) + "的相册";
  const container = document.getElementById("secretContent");
  const pName = getSecretCharName();

  // v5.4.0：每次点开都重新随机一轮（性格池+聊天记忆注入），图不固定
  var photos = getPersonalityAlbum(pName, secretCharId);

  var totalText = photos.length + Math.floor(Math.random() * 10) + '张照片';
  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">' + escHtml(pName) + '的相册 · ' + totalText + '</div>';
  h += '<div class="secret-photo-grid">';
  photos.forEach(function(p) {
    h += '<div class="secret-photo-item"><div class="sp-emoji">' + p.emoji + '</div><div class="sp-label">' + escHtml(p.label) + '</div></div>';
  });
  h += '</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">';
  photos.forEach(function(p) {
    h += '<div class="secret-photo-time">' + escHtml(p.time) + '</div>';
  });
  h += '</div>';
  container.innerHTML = h + '<div id="myPhotosSection">' + renderMyPhotosSection() + '</div>';
}

/* ---- 相册「你的照片」区：用户添加的照片，AI 会拿这些发私聊/朋友圈 ---- */
function renderMyPhotosSection() {
  const album = getAlbumPhotos();
  let h = '<div style="height:1px;background:#E0F2FE;margin:14px 0;"></div>';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '<div style="font-size:12px;color:#999;">你的照片 · 他会拿这些发给你</div>'
    + '<button style="background:#BAE6FD;color:#1e3a5f;border:none;border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer;" onclick="document.getElementById(\'albumFileInput\').click()">＋ 添加</button>'
    + '</div>';
  h += '<input type="file" id="albumFileInput" accept="image/*" style="display:none;" onchange="handleAlbumFileSelect(event)">';
  if (album.length === 0) {
    h += '<div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">还没有你的照片～<br>添加几张，他就能分享给你啦</div>';
  } else {
    h += '<div class="secret-photo-grid">';
    album.forEach(function(p) {
      h += '<div class="secret-photo-item" style="position:relative;overflow:hidden;">'
        + '<img src="' + p.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;">'
        + '<button title="删除" onclick="deleteAlbumPhoto(\'' + p.id + '\');renderMyPhotosOnly();" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;line-height:20px;text-align:center;cursor:pointer;">×</button>'
        + '</div>';
    });
    h += '</div>';
  }
  return h;
}

function renderMyPhotosOnly() {
  const el = document.getElementById('myPhotosSection');
  if (el) el.innerHTML = renderMyPhotosSection();
}

function handleAlbumFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  addAlbumPhoto(file).then(function() {
    renderMyPhotosOnly();
    if (typeof addChatSystem === 'function') addChatSystem('📷 照片已加到相册，他可能会分享给你～');
  }).catch(function(e) {
    if (typeof addChatSystem === 'function') addChatSystem('❌ 添加照片失败：' + e.message);
  });
}

/* ===== 歌单（按性格动态 + 聊天推荐收录 + 大池轮换） ===== */
function getPersonalityPlaylist(pName, charId) {
  var charPers = getCharPersona(charId);
  var story = (charPers.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);
  var tod = _timeOfDay();

  // === 傲娇歌单池（25首） ===
  var tsundereSongs = [
    { title:'路过人间', artist:'郁可唯', time:'刚刚' },
    { title:'唯一', artist:'告五人', time:'昨天' },
    { title:'起风了', artist:'买辣椒也用券', time:'昨天' },
    { title:'小半', artist:'陈粒', time:'前天' },
    { title:'喜欢你', artist:'陈洁仪', time:'4天前' },
    { title:'南山南', artist:'马頔', time:'5天前' },
    { title:'烟火里的尘埃', artist:'华晨宇', time:'上周' },
    { title:'走马', artist:'陈粒', time:'昨天' },
    { title:'光年之外', artist:'邓紫棋', time:'前天' },
    { title:'说散就散', artist:'JC陈', time:'3天前' },
    { title:'泡沫', artist:'邓紫棋', time:'4天前' },
    { title:'不染', artist:'毛不易', time:'5天前' },
    { title:'消愁', artist:'毛不易', time:'3天前' },
    { title:'刚刚好', artist:'薛之谦', time:'昨天' },
    { title:'我还想她', artist:'林俊杰', time:'前天' },
    { title:'趁早', artist:'张宇', time:'5天前' },
    { title:'夜曲', artist:'周杰伦', time:'上周' },
    { title:'搁浅', artist:'周杰伦', time:'3天前' },
    { title:'倒带', artist:'蔡依林', time:'4天前' },
    { title:'爱了很久的朋友', artist:'田馥甄', time:'昨天' },
    { title:'你就不要想起我', artist:'田馥甄', time:'前天' },
    { title:'后来', artist:'刘若英', time:'5天前' },
    { title:'好久不见', artist:'陈奕迅', time:'上周' },
    { title:'红色高跟鞋', artist:'蔡健雅', time:'昨天' },
    { title:'达尔文', artist:'蔡健雅', time:'3天前' },
  ];

  // === 温柔歌单池（25首） ===
  var gentleSongs = [
    { title:'小美满', artist:'周深', time:'刚刚' },
    { title:'日常', artist:'田馥甄', time:'昨天' },
    { title:'暖暖', artist:'梁静茹', time:'昨天' },
    { title:'小手拉大手', artist:'梁静茹', time:'前天' },
    { title:'陪你度过漫长岁月', artist:'陈奕迅', time:'3天前' },
    { title:'遇见', artist:'孙燕姿', time:'5天前' },
    { title:'日落', artist:'橘子海', time:'上周' },
    { title:'爱你', artist:'王心凌', time:'昨天' },
    { title:'夏天的风', artist:'温岚', time:'前天' },
    { title:'简单爱', artist:'周杰伦', time:'3天前' },
    { title:'七里香', artist:'周杰伦', time:'4天前' },
    { title:'情书', artist:'张学友', time:'5天前' },
    { title:'喜欢你', artist:'Beyond', time:'上周' },
    { title:'小情歌', artist:'苏打绿', time:'昨天' },
    { title:'无与伦比的美丽', artist:'苏打绿', time:'前天' },
    { title:'你被写在我的歌里', artist:'苏打绿/陈嘉桦', time:'3天前' },
    { title:'好好', artist:'五月天', time:'4天前' },
    { title:'天使', artist:'五月天', time:'5天前' },
    { title:'拥抱', artist:'五月天', time:'上周' },
    { title:'少女', artist:'林宥嘉', time:'昨天' },
    { title:'兜圈', artist:'林宥嘉', time:'前天' },
    { title:'致姗姗来迟的你', artist:'阿肆/林宥嘉', time:'3天前' },
    { title:'幸福了然后呢', artist:'A-Lin', time:'4天前' },
    { title:'我好像在哪见过你', artist:'薛之谦', time:'5天前' },
    { title:'飞鸟和蝉', artist:'任然', time:'上周' },
  ];

  // === 冷静歌单池（25首） ===
  var coolSongs = [
    { title:'空城', artist:'杨坤', time:'刚刚' },
    { title:'演员', artist:'薛之谦', time:'昨天' },
    { title:'丑八怪', artist:'薛之谦', time:'昨天' },
    { title:'像我这样的人', artist:'毛不易', time:'前天' },
    { title:'平凡之路', artist:'朴树', time:'4天前' },
    { title:'理想三旬', artist:'陈鸿宇', time:'5天前' },
    { title:'消愁', artist:'毛不易', time:'上周' },
    { title:'Better Now', artist:'Post Malone', time:'昨天' },
    { title:'River', artist:'Eminem', time:'前天' },
    { title:'Counting Stars', artist:'OneRepublic', time:'3天前' },
    { title:'异类', artist:'华晨宇', time:'4天前' },
    { title:'我的滑板鞋', artist:'华晨宇', time:'5天前' },
    { title:'齐天大圣', artist:'华晨宇', time:'上周' },
    { title:'Sonnet', artist:'The Verve', time:'昨天' },
    { title:'Last Dance', artist:'伍佰', time:'前天' },
    { title:'挪威的森林', artist:'伍佰', time:'3天前' },
    { title:'突然的自我', artist:'伍佰', time:'4天前' },
    { title:'Fade', artist:'Alan Walker', time:'5天前' },
    { title:'The Nights', artist:'Avicii', time:'上周' },
    { title:'Wake Me Up', artist:'Avicii', time:'昨天' },
    { title:'Hotel California', artist:'Eagles', time:'前天' },
    { title:'Take Five', artist:'Dave Brubeck', time:'3天前' },
    { title:'California Dreaming', artist:'The Mamas & Papas', time:'4天前' },
    { title:'Knockin\' On Heaven\'s Door', artist:'Bob Dylan', time:'5天前' },
    { title:'Where Did You Sleep Last Night', artist:'Nirvana', time:'上周' },
  ];

  var pool = isTsundere ? tsundereSongs : isGentle ? gentleSongs : coolSongs;

  // 根据时间段把更相关的歌曲放在前面
  if (tod === '凌晨' || tod === '晚上') {
    var nightVibes = isTsundere ? ['夜曲','消愁','好久不见','倒带'] : isGentle ? ['晚安曲','日落','遇见','兜圈'] : ['Fade','Hotel California','理想三旬','Knockin\' On Heaven\'s Door'];
    pool.forEach(function(s, i) {
      if (nightVibes.indexOf(s.title) !== -1) { s.time = '刚刚'; }
    });
  } else if (tod === '早上' || tod === '上午') {
    pool.forEach(function(s, i) {
      if (s.time === '刚刚') s.time = '昨天';
    });
  }

  var count = 6 + Math.floor(Math.random() * 4); // 6-9首
  return _pickFromPool(pool, count);
}

/* ---- 聊天推荐歌曲检测和存储 ---- */
function getRecommendedSongs(charId) {
  try { return JSON.parse(localStorage.getItem('recSongs_' + charId)) || []; } catch(e) { return []; }
}

function saveRecommendedSongs(charId, songs) {
  localStorage.setItem('recSongs_' + charId, JSON.stringify(songs));
}

/* ---- 手动添加歌曲 ---- */
function addManualSong() {
  var name = prompt('🎵 歌名：');
  if (!name || !name.trim()) return;
  var artist = prompt('🎤 歌手（可以不填）：');
  var songs = getRecommendedSongs(secretCharId);
  var songName = name.trim();
  if (songs.find(function(s) { return s.title === songName; })) {
    alert('这首歌已经在列表里啦～');
    return;
  }
  songs.push({ title: songName, artist: artist || '你添加的', time: new Date().toLocaleDateString('zh-CN') });
  if (songs.length > 30) songs = songs.slice(-30);
  saveRecommendedSongs(secretCharId, songs);
  alert('✅ 已添加：' + songName + (artist ? ' - ' + artist : ''));
  showSecretPlaylist(); // 刷新页面
}

/* ---- 删除手动添加的歌曲 ---- */
function deleteManualSong(index, stayInManage) {
  var songs = getRecommendedSongs(secretCharId);
  if (!songs[index]) return;
  songs.splice(index, 1);
  saveRecommendedSongs(secretCharId, songs);
  if (stayInManage) showManageRecSongs();
  else showSecretPlaylist();
}

function detectSongFromChat(text, charId) {
  // 匹配歌曲推荐模式："推荐/推荐给你/给你推荐 + 歌名"
  var match = text.match(/(?:推荐|安利|分享)(?:给你)?[：: ]?\s*(.+?)(?:这首歌|这首|吧|~|～|$)/);
  if (!match) {
    // 简单匹配：带有"歌"或"听"字的消息
    match = text.match(/(?:最近在听|听了|听到|听了一首)[：: ]?\s*(.+?)(?:这首歌|这首|吧|~|～|$)/);
  }
  if (match && match[1] && match[1].length < 20) {
    var songs = getRecommendedSongs(charId);
    var songName = match[1].trim();
    if (!songs.find(function(s) { return s.title.indexOf(songName) !== -1 || songName.indexOf(s.title) !== -1; })) {
      songs.push({ title: songName, artist: '', time: new Date().toLocaleDateString('zh-CN') });
      if (songs.length > 20) songs = songs.slice(-20);
      saveRecommendedSongs(charId, songs);
      return true;
    }
  }
  return false;
}

/* ---- 工具函数：把时间戳转成"上午/下午 xx:xx" ---- */
function getTimeLabel(timestamp) {
  if (!timestamp) return '';
  var d = new Date(timestamp);
  var h = d.getHours();
  var m = d.getMinutes().toString().padStart(2, '0');
  var period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '午后' : h < 18 ? '下午' : '晚上';
  return period + ' ' + h.toString().padStart(2,'0') + ':' + m;
}

/* ---- 轮换种子（一天内不变，但每天/每次打开不同） ---- */
function _pickFromPool(pool, count) {
  // 打乱后用 slice
  var shuffled = pool.slice().sort(function() { return Math.random() - 0.5; });
  var pick = shuffled.slice(0, count);
  // 按时间排序：今天的 > 近期的 > 更早的
  pick.sort(function(a, b) {
    var order = { '今天':0,'今天下午':0,'今天早上':0,'今晚':0,'刚刚':0,'1小时前':1,'2小时前':1,'昨天下午':2,'昨晚':2,'昨天':2,'前天':3,'3天前':4,'4天前':5,'5天前':6,'上周':7 };
    return (order[a.time]||99) - (order[b.time]||99);
  });
  return pick;
}

function _timeOfDay() {
  var h = new Date().getHours();
  return h < 6 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 21 ? '傍晚' : '晚上';
}

function _isWeekend() {
  var d = new Date().getDay();
  return d === 0 || d === 6;
}

/* ---- 从聊天记录提取话题标签 ---- */
function _getChatTopics(charId) {
  var charMsgs = chatData[charId] || [];
  var userTexts = charMsgs.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; }).join(' ');
  var topics = [];
  if (/六级|考试|期末|复习|论文|作业|上课|学习|考研/.test(userTexts)) topics.push('学习');
  if (/吃|饭|食堂|外卖|好吃|饿|点餐/.test(userTexts)) topics.push('吃饭');
  if (/奶茶|咖啡|牛奶|茶|喝/.test(userTexts)) topics.push('喝东西');
  if (/甜|蛋糕|面包|糖|冰淇淋|甜品/.test(userTexts)) topics.push('甜的');
  if (/辣|火锅|麻辣|烧烤|烤|串/.test(userTexts)) topics.push('辣的');
  if (/猫|狗|宠物/.test(userTexts)) topics.push('宠物');
  if (/累|困|熬夜|失眠|睡/.test(userTexts)) topics.push('作息');
  if (/电影|剧|综艺|动漫|视频/.test(userTexts)) topics.push('娱乐');
  if (/游戏|打|玩/.test(userTexts)) topics.push('游戏');
  if (/买|购物|淘宝|快递|钱|花/.test(userTexts)) topics.push('购物');
  if (/下雨|天气|雨|雪|冷|热/.test(userTexts)) topics.push('天气');
  if (/难过|伤心|哭|不开心|焦虑|压力|emo/.test(userTexts)) topics.push('情绪');
  if (/想|喜欢|爱|梦到/.test(userTexts)) topics.push('想念');
  return topics;
}

/* ---- 动态生成外卖数据（每次重新生成，不用缓存） ---- */
function getPersonalityFoodOrders(charId) {
  var charPers = getCharPersona(charId);
  var story = (charPers.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);

  // 融合聊天记录里的饮食关键词
  var charMsgs = chatData[charId] || [];
  var userTexts = charMsgs.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; }).join(' ');
  var hasSweet = /奶茶|蛋糕|甜|糖|面包/.test(userTexts);
  var hasSpicy = /辣|火锅|烧烤|烤/.test(userTexts);
  var hasFood = /吃|饭|食堂|外卖|好吃|饿/.test(userTexts);
  var tod = _timeOfDay();
  var weekend = _isWeekend();

  // === 傲娇池（20+条） ===
  var tsunderePool = [
    { shop:'肯德基', items:'香辣鸡腿堡套餐', price:39.9, time:'昨晚', status:'已送达' },
    { shop:'一点点', items:'四季奶青 加波霸', price:16, time:'昨天下午', status:'已送达' },
    { shop:'沙县小吃', items:'蒸饺+拌面', price:18, time:'前天', status:'已送达' },
    { shop:'绝味鸭脖', items:'鸭锁骨+藕片', price:28, time:'3天前', status:'已送达' },
    { shop:'蜜雪冰城', items:'柠檬水+甜筒', price:8, time:'前天', status:'已送达' },
    { shop:'麦当劳', items:'双层吉士汉堡+薯条', price:34, time:'昨天', status:'已送达' },
    { shop:'瑞幸', items:'生椰拿铁 少冰', price:19.9, time:'今天早上', status:'已送达' },
    { shop:'兰州拉面', items:'牛肉拉面+煎蛋', price:22, time:'昨天中午', status:'已送达' },
    { shop:'喜茶', items:'多肉葡萄 少糖', price:28, time:'昨天下午', status:'已送达' },
    { shop:'烧烤摊', items:'羊肉串10串+鸡翅', price:55, time:'3天前', status:'已送达' },
    { shop:'麻辣烫', items:'自选麻辣烫（微辣）', price:32, time:'前天', status:'已送达' },
    { shop:'7-11', items:'关东煮+饭团', price:15.5, time:'昨天早上', status:'已送达' },
    { shop:'华莱士', items:'炸鸡套餐', price:29.9, time:'4天前', status:'已送达' },
    { shop:'杨国福', items:'麻辣拌', price:26, time:'2天前', status:'已送达' },
    { shop:'周黑鸭', items:'鸭脖+鸭舌', price:38, time:'5天前', status:'已送达' },
    { shop:'老乡鸡', items:'西红柿炒蛋+蒸蛋', price:28, time:'昨天', status:'已送达' },
    { shop:'煲仔饭', items:'腊味煲仔饭+例汤', price:32, time:'前天', status:'已送达' },
    { shop:'螺蛳粉外卖', items:'招牌螺蛳粉+炸蛋', price:21, time:'3天前', status:'已送达' },
    { shop:'烤鱼店', items:'蒜香烤鱼（外卖版）', price:68, time:'上周', status:'已送达' },
    { shop:'饺子馆', items:'韭菜鸡蛋饺15个', price:18, time:'4天前', status:'已送达' },
  ];

  // === 温柔池 ===
  var gentlePool = [
    { shop:'好利来', items:'半熟芝士+芋泥面包', price:48, time:'今天下午', status:'配送中' },
    { shop:'瑞幸咖啡', items:'生椰拿铁 少冰', price:19.9, time:'今天早上', status:'已送达' },
    { shop:'老乡鸡', items:'鸡汤+蒸蛋+米饭', price:32, time:'昨天', status:'已送达' },
    { shop:'鲜芋仙', items:'芋圆4号', price:28, time:'前天', status:'已送达' },
    { shop:'一点点', items:'四季奶青 三分糖', price:15, time:'昨天下午', status:'已送达' },
    { shop:'泸溪河', items:'桃酥+绿豆糕', price:36, time:'3天前', status:'已送达' },
    { shop:'奈雪的茶', items:'霸气草莓+软欧包', price:45, time:'昨天', status:'已送达' },
    { shop:'全家', items:'三明治+牛奶', price:18, time:'今天早上', status:'已送达' },
    { shop:'日料店', items:'三文鱼牛油果盖饭', price:58, time:'前天', status:'已送达' },
    { shop:'西贝', items:'面筋+莜面', price:45, time:'4天前', status:'已送达' },
    { shop:'和府捞面', items:'草本猪蹄面', price:39, time:'昨天', status:'已送达' },
    { shop:'满记甜品', items:'杨枝甘露+芒果班戟', price:42, time:'前天', status:'已送达' },
    { shop:'煲珠公', items:'珍珠奶茶 少糖', price:14, time:'今天下午', status:'配送中' },
    { shop:'一鸣真鲜奶', items:'酸奶+三明治', price:16, time:'昨天早上', status:'已送达' },
    { shop:'花店配送', items:'每周一花-混合花束', price:88, time:'3天前', status:'已送达' },
    { shop:'海底捞外送', items:'番茄小锅+虾滑', price:108, time:'上周', status:'已送达' },
    { shop:'鲍师傅', items:'肉松小贝+提子酥', price:32, time:'5天前', status:'已送达' },
    { shop:'茶百道', items:'桂花酒酿奶茶', price:17, time:'昨天', status:'已送达' },
    { shop:'必胜客', items:'超级至尊披萨', price:79, time:'4天前', status:'已送达' },
    { shop:'塔斯汀', items:'板烧凤梨堡套餐', price:28, time:'昨天中午', status:'已送达' },
  ];

  // === 冷静/简约池 ===
  var coolPool = [
    { shop:'麦当劳', items:'板烧鸡腿堡套餐', price:36, time:'昨晚', status:'已送达' },
    { shop:'星巴克', items:'冰美式 大杯', price:32, time:'今天早上', status:'已送达' },
    { shop:'美团外卖', items:'黄焖鸡米饭', price:25, time:'昨天', status:'已送达' },
    { shop:'蜜雪冰城', items:'柠檬水+甜筒', price:8, time:'前天', status:'已送达' },
    { shop:'肯德基', items:'奥尔良烤鸡堡', price:33, time:'昨天', status:'已送达' },
    { shop:'瑞幸', items:'冰美式 无糖', price:13.9, time:'今天', status:'已送达' },
    { shop:'兰州拉面', items:'牛肉拉面', price:18, time:'前天', status:'已送达' },
    { shop:'沙县小吃', items:'蛋炒饭+乌鸡汤', price:22, time:'3天前', status:'已送达' },
    { shop:'全家', items:'便当+饮料', price:24, time:'昨天中午', status:'已送达' },
    { shop:'汉堡王', items:'皇堡套餐', price:38, time:'4天前', status:'已送达' },
    { shop:'煲仔饭', items:'香菇滑鸡煲仔饭', price:28, time:'昨天', status:'已送达' },
    { shop:'正新鸡排', items:'鸡排+酸梅汁', price:16, time:'前天', status:'已送达' },
    { shop:'肯德基', items:'原味鸡+蛋挞', price:22, time:'5天前', status:'已送达' },
    { shop:'柳州螺蛳粉', items:'螺蛳粉+豆腐泡', price:20, time:'3天前', status:'已送达' },
    { shop:'东北饺子', items:'猪肉白菜饺', price:16, time:'昨天', status:'已送达' },
    { shop:'大米先生', items:'小炒肉套餐', price:26, time:'4天前', status:'已送达' },
    { shop:'周黑鸭', items:'卤藕+鸭翅', price:24, time:'上周', status:'已送达' },
    { shop:'纯K', items:'花生米+啤酒（KTV外卖）', price:48, time:'6天前', status:'已送达' },
  ];

  var pool = isTsundere ? tsunderePool : isGentle ? gentlePool : coolPool;

  // 根据聊天内容追加
  if (hasSweet) {
    var sweetExtras = [
      { shop:'幸福侯彩擂', items:'波霸奶茶 微糖', price:18, time:'今天', status:'已送达' },
      { shop:'糖水铺', items:'红豆沙+姜撞奶', price:22, time:'昨天', status:'已送达' },
      { shop:'冰淇淋店', items:'抹茶甜筒', price:12, time:'前天', status:'已送达' },
    ];
    pool = pool.concat(sweetExtras);
  }
  if (hasSpicy) {
    var spicyExtras = [
      { shop:'海底捞外送', items:'番茄锅底+虾滑+肥牛', price:128, time:'昨天', status:'已送达' },
      { shop:'麻辣香锅', items:'微辣套餐+米饭', price:42, time:'前天', status:'已送达' },
      { shop:'重庆小面', items:'肥肠面 重辣', price:22, time:'3天前', status:'已送达' },
    ];
    pool = pool.concat(spicyExtras);
  }
  if (hasFood && !hasSweet && !hasSpicy) {
    pool.push({ shop:'食堂', items:'两荤一素+米饭', price:15, time:'今天中午', status:'已送达' });
  }

  // 根据时间追加一条"正在订"的
  if (tod === '中午' || tod === '下午') {
    var lunchOptions = [
      { shop:'美团外卖', items:'正在看…附近有什么吃的', price:0, time:'现在', status:'选餐中' },
      { shop:'饿了么', items:'纠结中…', price:0, time:'现在', status:'选餐中' },
    ];
    pool = pool.concat(lunchOptions);
  }
  if (tod === '晚上' || tod === '凌晨') {
    var nightOptions = [
      { shop:'烧烤摊', items:'正在看夜宵菜单', price:0, time:'现在', status:'选餐中' },
      { shop:'深夜外卖', items:'夜宵纠结中…', price:0, time:'现在', status:'选餐中' },
    ];
    pool = pool.concat(nightOptions);
  }
  if (weekend) {
    pool.push({ shop:'早午餐外送', items:'班尼迪克蛋+咖啡', price:58, time:'今天', status:'配送中' });
  }

  // ★ 根据聊天话题注入个性化外卖
  var chatTopics = _getChatTopics(charId);
  if (chatTopics.indexOf('喝东西') !== -1) {
    pool = pool.concat([
      { shop:'瑞幸', items:'生椰拿铁', price:19.9, time:'今天', status:'已送达' },
      { shop:'茶百道', items:'豆乳玉麒麟', price:16, time:'昨天', status:'已送达' },
      { shop:'喜茶', items:'多肉葡萄 少糖', price:28, time:'今天下午', status:'配送中' },
      { shop:'一点点', items:'四季奶青 加波霸', price:15, time:'昨天', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('辣的') !== -1) {
    pool = pool.concat([
      { shop:'火锅外卖', items:'番茄/麻辣双拼锅底+肥牛+虾滑', price:138, time:'昨天', status:'已送达' },
      { shop:'烤串店', items:'羊肉串15串+烤鸡翅', price:45, time:'前天', status:'已送达' },
      { shop:'麻辣香锅', items:'微辣套餐+米饭', price:38, time:'昨天', status:'已送达' },
      { shop:'重庆小面', items:'肥肠面 重辣', price:22, time:'3天前', status:'已送达' },
      { shop:'螺蛳粉', items:'招牌螺蛳粉+炸蛋+豆泡', price:24, time:'前天', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('甜的') !== -1) {
    pool = pool.concat([
      { shop:'鲜芋仙', items:'芋圆4号+豆花', price:32, time:'今天', status:'配送中' },
      { shop:'好利来', items:'半熟芝士+芋泥面包', price:48, time:'昨天', status:'已送达' },
      { shop:'满记甜品', items:'杨枝甘露+芒果班戟', price:42, time:'前天', status:'已送达' },
      { shop:'DQ', items:'抹茶暴风雪', price:28, time:'3天前', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('吃饭') !== -1 && chatTopics.indexOf('辣的') === -1 && chatTopics.indexOf('甜的') === -1) {
    pool = pool.concat([
      { shop:'沙县小吃', items:'鸭腿饭+炖罐', price:22, time:'今天中午', status:'已送达' },
      { shop:'老乡鸡', items:'青椒炒蛋+蒸蛋+米饭', price:28, time:'昨天', status:'已送达' },
      { shop:'兰州拉面', items:'牛肉拉面+小菜', price:25, time:'前天', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('作息') !== -1) {
    pool = pool.concat([
      { shop:'深夜粥铺', items:'皮蛋瘦肉粥+煎饺', price:26, time:'凌晨', status:'已送达' },
      { shop:'烧烤外卖', items:'深夜串串+啤酒', price:45, time:'昨晚', status:'已送达' },
      { shop:'全家', items:'宵夜套餐：关东煮+饭团', price:18, time:'凌晨', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('购物') !== -1) {
    pool.push({ shop:'美团外卖', items:'超市配送：零食大礼包', price:68, time:'昨天', status:'已送达' });
    pool.push({ shop:'饿了么', items:'便利店：饮料+薯片+泡面', price:35, time:'前天', status:'已送达' });
  }
  if (chatTopics.indexOf('情绪') !== -1) {
    pool = pool.concat([
      { shop:'奶茶店', items:'超大杯波霸奶茶（加料）', price:22, time:'今天', status:'配送中' },
      { shop:'冰淇淋店', items:'双球甜筒+华夫', price:25, time:'昨天', status:'已送达' },
      { shop:'蛋糕店', items:'切片蛋糕+热可可', price:38, time:'前天', status:'已送达' },
    ]);
  }
  if (chatTopics.indexOf('想念') !== -1) {
    pool.push({ shop:'花店外卖', items:'混搭花束+小卡片', price:68, time:'昨天', status:'已送达' });
    pool.push({ shop:'甜品店', items:'定制曲奇礼盒', price:58, time:'前天', status:'已送达' });
  }
  if (chatTopics.indexOf('游戏') !== -1) {
    pool.push({ shop:'麦当劳', items:'游戏套餐：汉堡+可乐+鸡翅', price:45, time:'昨天', status:'已送达' });
    pool.push({ shop:'零食店', items:'薯片+可乐+辣条 游戏必备', price:32, time:'前天', status:'已送达' });
  }
  if (chatTopics.indexOf('学习') !== -1) {
    pool.push({ shop:'瑞幸', items:'学习套餐：美式+可颂', price:28, time:'今天', status:'已送达' });
    pool.push({ shop:'便利店', items:'咖啡+面包 复习必备', price:18, time:'昨天', status:'已送达' });
  }
  if (chatTopics.indexOf('天气') !== -1) {
    pool.push({ shop:'奶茶店', items:'热奶茶（天冷来一杯）', price:18, time:'今天', status:'配送中' });
    pool.push({ shop:'药店外卖', items:'感冒灵+VC泡腾片', price:35, time:'昨天', status:'已送达' });
  }

  var count = 4 + Math.floor(Math.random() * 3); // 4-6条
  return _pickFromPool(pool, count);
}

function showSecretPlaylist() {
  document.getElementById("secretDesk").style.display = "none";
  document.getElementById("secretContent").style.display = "block";
  document.getElementById("secretBackBtn").style.display = "inline";
  document.getElementById("secretTitle").textContent = "🎵 " + (getSecretCharName()) + "的歌单";
  const pName = getSecretCharName();
  const container = document.getElementById("secretContent");
  const now = new Date();
  const hr = now.getHours();

  // ✅ 每次都重新生成歌单，不从缓存读
  const recentlyPlayed = getPersonalityPlaylist(pName, secretCharId);

  const timeGreeting = hr < 6 ? '深夜' : hr < 9 ? '清晨' : hr < 12 ? '上午' : hr < 14 ? '午后' : hr < 18 ? '下午' : hr < 21 ? '傍晚' : '夜晚';
  if (recentlyPlayed.length > 0 && recentlyPlayed[0].time === '刚刚') {
    recentlyPlayed[0].time = timeGreeting + ' · 刚刚';
  }

  // 性格化歌单分类
  var charPers = getCharPersona(secretCharId);
  var story = (charPers.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);

  var playlists = isTsundere
    ? [{ name: '🌙 一个人听', songs: ['路过人间','小半','南山南','消愁'] },
       { name: '☀️ 关于她', songs: ['唯一','喜欢你','起风了','烟火里的尘埃'] },
       { name: '🎧 深夜歌单', songs: ['夜曲','走神','空白格','好久不见'] }]
    : isGentle
    ? [{ name: '🌙 安静的时候', songs: ['小美满','遇见','日落','日常'] },
       { name: '☀️ 开心歌单', songs: ['暖暖','小手拉大手','陪你度过漫长岁月','好日子'] },
       { name: '🌸 想她的时候', songs: ['喜欢你','独家记忆','情书','慢慢喜欢你'] }]
    : [{ name: '🎧 通勤歌单', songs: ['空城','演员','平凡之路','理想三旬'] },
       { name: '🌙 深夜emo', songs: ['像我这样的人','消愁','丑八怪','孤勇者'] },
       { name: '⚡ 提神', songs: ['追梦赤子心','光年之外','无名之辈','你的答案'] }];

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">' + escHtml(pName) + '最近在听</div>';

  // ➕ 手动添加歌曲按钮
  h += '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
    '<button onclick="addManualSong()" style="flex:1;padding:8px;border-radius:10px;background:#f0f0f0;border:none;font-size:13px;font-weight:600;cursor:pointer;color:#555;">➕ 添加歌曲</button>' +
    '<button onclick="showSecretPlaylist()" style="padding:8px 12px;border-radius:10px;background:none;border:1px solid #e0e0e0;font-size:12px;cursor:pointer;color:#999;">🔄 刷新歌单</button></div>';

  // 来自你推荐的歌（如果有）——混进最近播放里
  var recSongs = getRecommendedSongs(secretCharId);
  if (recSongs.length > 0) {
    recSongs.forEach(function(s) {
      recentlyPlayed.unshift({ title: s.title, artist: s.artist || '你推荐的', time: '刚刚 · 推荐' });
    });
  }

  h += '<div class="playlist-header">🎶 最近播放</div>';
  recentlyPlayed.forEach(function(s) {
    h += '<div class="secret-playlist-item"><div class="sp-icon">🎧</div><div class="sp-info"><div class="sp-title">' + escHtml(s.title) + '</div><div class="sp-artist">' + escHtml(s.artist || '') + '</div></div><div class="sp-time">' + escHtml(s.time) + '</div></div>';
  });
  h += '<div class="playlist-header">📋 我的歌单</div>';
  playlists.forEach(function(p) {
    h += '<div class="secret-note-card"><div class="sn-text" style="font-weight:600;">' + escHtml(p.name) + '</div><div style="font-size:12px;color:#888;margin-top:4px;">' + escHtml(p.songs.join(' · ')) + '</div></div>';
  });
  // 管理已添加的推荐歌曲
  if (recSongs.length > 0) {
    h += '<div style="margin-top:12px;text-align:center;">' +
      '<button onclick="showManageRecSongs()" style="font-size:12px;color:#999;background:none;border:none;cursor:pointer;text-decoration:underline;">📝 管理我推荐的 ' + recSongs.length + ' 首歌</button></div>';
  }
  container.innerHTML = h;
}

/* ---- 管理我推荐的歌曲 ---- */
function showManageRecSongs() {
  var container = document.getElementById("secretContent");
  var pName = getSecretCharName();
  var recSongs = getRecommendedSongs(secretCharId);
  var h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">📝 我推荐的歌曲</div>';
  h += '<button onclick="showSecretPlaylist()" style="padding:8px 14px;border-radius:10px;background:#f0f0f0;border:none;font-size:13px;cursor:pointer;color:#555;margin-bottom:10px;">← 返回歌单</button>';
  if (recSongs.length === 0) {
    h += '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">还没有推荐过歌曲</div>';
  } else {
    // 反序显示（最新的在上面）
    var reversed = recSongs.slice().reverse();
    reversed.forEach(function(s, ri) {
      var i = recSongs.length - 1 - ri;
      h += '<div class="secret-playlist-item" style="border-left:3px solid #667eea;">' +
        '<div class="sp-icon">🎁</div>' +
        '<div class="sp-info"><div class="sp-title">' + escHtml(s.title) + '</div><div class="sp-artist">' + (s.artist ? escHtml(s.artist) : '你推荐的') + '</div></div>' +
        '<div class="sp-time">' + escHtml(s.time) + '</div>' +
        '<button onclick="deleteManualSong(' + i + ',true)" style="font-size:16px;color:#e55;background:none;border:none;cursor:pointer;padding:4px;">✕</button></div>';
    });
  }
  container.innerHTML = h;
}

/* ===== 外卖订单 ===== */
function showSecretFoodDelivery() {
  document.getElementById("secretDesk").style.display = "none";
  document.getElementById("secretContent").style.display = "block";
  document.getElementById("secretBackBtn").style.display = "inline";
  document.getElementById("secretTitle").textContent = "🍔 " + (getSecretCharName()) + "的外卖";
  const container = document.getElementById("secretContent");
  const pName = getSecretCharName();

  // ✅ 每次都重新生成外卖数据，不从缓存读
  const orders = getPersonalityFoodOrders(secretCharId);

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">' + escHtml(pName) + '最近的外卖订单</div>';
  orders.forEach(function(o) {
    const statusColor = o.status === '配送中' ? '#e76f51' : o.status === '已送达' ? '#4caf50' : '#999';
    h += '<div class="secret-playlist-item" style="flex-wrap:wrap;">' +
      '<div class="sp-icon" style="font-size:22px;">🍔</div>' +
      '<div class="sp-info" style="flex:1;min-width:0;">' +
      '<div class="sp-title">' + escHtml(o.shop) + '</div>' +
      '<div class="sp-artist">' + escHtml(o.items) + '</div></div>' +
      '<div style="text-align:right;">' +
      '<div style="font-size:14px;font-weight:600;color:#333;">¥' + (o.price||0).toFixed(1) + '</div>' +
      '<div style="font-size:10px;color:' + statusColor + ';">' + escHtml(o.status||'') + '</div></div>' +
      '<div style="width:100%;font-size:10px;color:#ccc;text-align:right;margin-top:-4px;">' + escHtml(o.time) + '</div></div>';
  });
  if (orders.length === 0) {
    h = '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">暂无外卖记录</div>';
  }
  container.innerHTML = h;
}

/* ===== 浏览器搜索记录（大池轮换） ===== */
function getPersonalityBrowserHistory(charId) {
  var charPers = getCharPersona(charId);
  var story = (charPers.story || '').toLowerCase();
  var isTsundere = /傲娇|毒舌|暴躁|刻薄|冷淡/.test(story);
  var isGentle = /温柔|温暖|亲切|可爱|软/.test(story);
  var tod = _timeOfDay();

  var tsundereQueries = [
    { query:'怎么哄生气的女朋友', time:'今天' },
    { query:'傲娇的人怎么表达关心', time:'昨天' },
    { query:'她喜欢的歌单', time:'昨天' },
    { query:'蛋糕店几点开门', time:'前天' },
    { query:'吵架后怎么和好', time:'3天前' },
    { query:'她最近在看什么剧', time:'4天前' },
    { query:'送什么礼物不会太明显', time:'5天前' },
    { query:'如何假装不在意', time:'6天前' },
    { query:'她今天心情好吗', time:'今天' },
    { query:'怎么才能不嘴硬', time:'昨天' },
    { query:'她说没事是真的没事吗', time:'前天' },
    { query:'最近好看的电影', time:'3天前' },
    { query:'为什么总是我主动', time:'4天前' },
    { query:'一个人吃火锅尴尬吗', time:'5天前' },
    { query:'凌晨睡不着怎么办', time:'今天' },
    { query:'她什么时候会想我', time:'昨天' },
    { query:'淘宝 机械键盘', time:'3天前' },
    { query:'附近最好吃的烤串', time:'4天前' },
    { query:'养猫需要准备什么', time:'5天前' },
    { query:'她的星座和什么最配', time:'上周' },
  ];

  var gentleQueries = [
    { query:'今日菜谱 简单好吃', time:'今天' },
    { query:'她喜欢吃甜的还是咸的', time:'昨天' },
    { query:'适合送花的节日', time:'昨天' },
    { query:'怎么让心情变好', time:'前天' },
    { query:'周末去哪儿玩比较好', time:'3天前' },
    { query:'她最近忙不忙', time:'4天前' },
    { query:'治愈系电影推荐', time:'5天前' },
    { query:'拼多多鲜花优惠券', time:'6天前' },
    { query:'手写情书怎么写', time:'今天' },
    { query:'秋天的毛衣穿搭', time:'昨天' },
    { query:'她上次说想吃的那家店', time:'前天' },
    { query:'手工礼物DIY教程', time:'3天前' },
    { query:'给她的小惊喜', time:'4天前' },
    { query:'女生喜欢什么样的陪伴', time:'5天前' },
    { query:'圣诞节礼物推荐', time:'上周' },
    { query:'怎么能让她开心', time:'今天' },
    { query:'好看的电影截图', time:'昨天' },
    { query:'附近新开的甜品店', time:'3天前' },
    { query:'她的生日还差多久', time:'4天前' },
    { query:'睡前故事短篇', time:'上周' },
  ];

  var coolQueries = [
    { query:'今天天气', time:'今天' },
    { query:'附近有什么好吃的', time:'昨天' },
    { query:'周末去哪玩', time:'昨天' },
    { query:'如何提高工作效率', time:'前天' },
    { query:'现在流行什么', time:'3天前' },
    { query:'她喜欢什么', time:'4天前' },
    { query:'怎么聊天不尴尬', time:'5天前' },
    { query:'深夜emo怎么办', time:'6天前' },
    { query:'Python 教程', time:'今天' },
    { query:'机械键盘 推荐', time:'昨天' },
    { query:'夜跑路线推荐', time:'前天' },
    { query:'附近的自习室', time:'3天前' },
    { query:'豆瓣高分电影', time:'4天前' },
    { query:'NAS 搭建教程', time:'5天前' },
    { query:'Spotify 歌单 推荐', time:'今天' },
    { query:'怎么拒绝别人 又不伤感情', time:'昨天' },
    { query:'一个人能做的事', time:'3天前' },
    { query:'极简主义 生活方式', time:'4天前' },
    { query:'最好的降噪耳机', time:'5天前' },
    { query:'VSCode 插件推荐', time:'上周' },
  ];

  var pool = isTsundere ? tsundereQueries : isGentle ? gentleQueries : coolQueries;

  // ★ 根据聊天话题注入个性化搜索
  var chatTopics = _getChatTopics(charId);
  var topicQueries = [];
  if (chatTopics.indexOf('学习') !== -1) {
    topicQueries.push({ query:'六级成绩什么时候出', time:'今天' },{ query:'附近有什么实习机会', time:'昨天' },{ query:'论文怎么写又快又好', time:'前天' },{ query:'本专业就业方向有哪些', time:'4天前' },{ query:'期末考试怎么复习', time:'今天' },{ query:'大一怎么找第一份实习', time:'昨天' });
  }
  if (chatTopics.indexOf('吃饭') !== -1 || chatTopics.indexOf('辣的') !== -1) {
    topicQueries.push({ query:'附近好吃的火锅店推荐', time:'今天' },{ query:'一个人吃饭不尴尬的地方', time:'昨天' },{ query:'本地好吃的10家店', time:'3天前' });
  }
  if (chatTopics.indexOf('喝东西') !== -1 || chatTopics.indexOf('甜的') !== -1) {
    topicQueries.push({ query:'瑞幸9.9优惠还有吗', time:'今天' },{ query:'最好喝的奶茶排名', time:'昨天' },{ query:'自制芋圆做法', time:'前天' });
  }
  if (chatTopics.indexOf('娱乐') !== -1) {
    topicQueries.push({ query:'最近值得看的电影', time:'今天' },{ query:'好看的动漫推荐2026', time:'昨天' },{ query:'豆瓣高分电影清单', time:'3天前' },{ query:'周末宅家看什么', time:'前天' });
  }
  if (chatTopics.indexOf('游戏') !== -1) {
    topicQueries.push({ query:'适合一个人玩的游戏', time:'昨天' },{ query:'switch值得买吗', time:'3天前' },{ query:'steam夏促推荐', time:'4天前' });
  }
  if (chatTopics.indexOf('宠物') !== -1) {
    topicQueries.push({ query:'新手养猫攻略', time:'今天' },{ query:'猫粮推荐 平价', time:'昨天' },{ query:'猫窝DIY', time:'前天' });
  }
  if (chatTopics.indexOf('天气') !== -1) {
    topicQueries.push({ query:'一周天气预报', time:'今天' },{ query:'潮湿天气怎么除湿', time:'昨天' });
  }
  if (chatTopics.indexOf('购物') !== -1) {
    topicQueries.push({ query:'淘宝618活动时间', time:'昨天' },{ query:'女生必买好物推荐', time:'前天' },{ query:'平价穿搭分享', time:'4天前' },{ query:'宿舍好物推荐', time:'5天前' });
  }
  if (chatTopics.indexOf('作息') !== -1) {
    topicQueries.push({ query:'怎么才能不熬夜', time:'今天' },{ query:'熬夜后怎么恢复', time:'昨天' },{ query:'早睡打卡方法', time:'前天' });
  }
  if (chatTopics.indexOf('情绪') !== -1) {
    topicQueries.push({ query:'心情不好怎么办', time:'今天' },{ query:'治愈系电影推荐', time:'昨天' },{ query:'一个人怎么缓解焦虑', time:'3天前' });
  }
  if (chatTopics.indexOf('想念') !== -1) {
    topicQueries.push({ query:'怎么告诉一个人我想她', time:'今天' },{ query:'异地恋怎么维持', time:'昨天' },{ query:'手写信的格式', time:'前天' },{ query:'送什么礼物最有心意', time:'4天前' });
  }
  pool = pool.concat(topicQueries);

  var count = 8 + Math.floor(Math.random() * 5); // 8-12条
  return _pickFromPool(pool, count);
}

/* ===== 浏览器搜索记录 ===== */
function showSecretBrowser() {
  document.getElementById("secretDesk").style.display = "none";
  document.getElementById("secretContent").style.display = "block";
  document.getElementById("secretBackBtn").style.display = "inline";
  document.getElementById("secretTitle").textContent = "🌐 " + (getSecretCharName()) + "的搜索记录";
  const container = document.getElementById("secretContent");
  const pName = getSecretCharName();

  // 每次都动态生成，不用缓存，确保内容刷新
  const history = getPersonalityBrowserHistory(secretCharId);

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">' + escHtml(pName) + '的搜索记录 · 共' + history.length + '条</div>';
  h += '<div style="display:flex;flex-direction:column;gap:6px;">';
  history.forEach(function(item) {
    h += '<div style="background:#fff;border-radius:12px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04);display:flex;align-items:center;gap:8px;">' +
      '<div style="font-size:16px;color:#ccc;">🔍</div>' +
      '<div style="flex:1;font-size:13px;color:#555;">' + escHtml(item.query) + '</div>' +
      '<div style="font-size:10px;color:#ccc;white-space:nowrap;">' + escHtml(item.time) + '</div></div>';
  });
  h += '</div>';
  container.innerHTML = h;
}

/* ===== 匿名信箱 ===== */
function getSecretMailbox(charId) {
  try {
    return JSON.parse(localStorage.getItem('secretMailbox_' + charId)) || [];
  } catch(e) { return []; }
}

function saveSecretMailbox(charId, data) {
  localStorage.setItem('secretMailbox_' + charId, JSON.stringify(data));
}

function showSecretMailbox() {
  document.getElementById("secretDesk").style.display = "none";
  document.getElementById("secretContent").style.display = "block";
  document.getElementById("secretBackBtn").style.display = "inline";
  document.getElementById("secretTitle").textContent = "✉️ 匿名信箱";
  const pName = getSecretCharName();
  renderSecretMailbox();
}

function renderSecretMailbox() {
  const container = document.getElementById("secretContent");
  const pName = getSecretCharName();
  const letters = getSecretMailbox(secretCharId);

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">给' + escHtml(pName) + '的匿名信 · 共' + letters.length + '封</div>';

  // 写信按钮
  h += '<button onclick="showSecretMailboxCompose()" style="width:100%;padding:12px;border-radius:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:14px;font-weight:600;cursor:pointer;border:none;margin-bottom:12px;box-shadow:0 2px 8px rgba(102,126,234,.3);">✏️ 写匿名信</button>';

  if (letters.length === 0) {
    h += '<div style="text-align:center;color:#ccc;padding:40px;font-size:13px;">还没有信<br>给' + escHtml(pName) + '写一封匿名信吧</div>';
    container.innerHTML = h;
    return;
  }

  // 显示所有信件（最新的在上面）
  const sorted = [...letters].reverse();
  sorted.forEach(function(letter) {
    const isFromUser = letter.from === 'me';
    const time = letter.time ? new Date(letter.time).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    h += '<div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<span style="font-size:12px;font-weight:600;color:' + (isFromUser ? '#667eea' : '#e76f51') + ';">' + (isFromUser ? '✉️ 你的信' : '💌 ' + escHtml(pName) + '的回信') + '</span>' +
      '<span style="font-size:10px;color:#ccc;">' + time + '</span></div>' +
      '<div style="font-size:13px;line-height:1.7;color:#444;white-space:pre-wrap;">' + escHtml(letter.text) + '</div></div>';
  });
  container.innerHTML = h;
}

function showSecretMailboxCompose() {
  const container = document.getElementById("secretContent");
  const pName = getSecretCharName();

  let h = '<div style="font-size:12px;color:#999;padding:0 0 8px;">✏️ 给' + escHtml(pName) + '写一封匿名信</div>';
  h += '<div style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);">';
  h += '<textarea id="mailboxLetterInput" placeholder="写点什么吧…' + escHtml(pName) + '会认真看的" style="width:100%;min-height:140px;border:1px solid #e0e0e0;border-radius:12px;padding:12px;font-size:14px;line-height:1.7;resize:vertical;background:#fafafa;"></textarea>';
  h += '<div style="display:flex;gap:8px;margin-top:10px;">';
  h += '<button onclick="showSecretMailbox()" style="flex:1;padding:10px;border-radius:10px;background:#f0f0f0;color:#666;font-size:13px;font-weight:600;cursor:pointer;border:none;">取消</button>';
  h += '<button onclick="sendSecretMailboxLetter()" style="flex:2;padding:10px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:13px;font-weight:600;cursor:pointer;border:none;box-shadow:0 2px 8px rgba(102,126,234,.3);">💌 寄出</button>';
  h += '</div></div>';
  container.innerHTML = h;
  // 自动聚焦
  setTimeout(function() {
    var inp = document.getElementById('mailboxLetterInput');
    if (inp) inp.focus();
  }, 200);
}

async function sendSecretMailboxLetter() {
  var inp = document.getElementById('mailboxLetterInput');
  var text = inp ? inp.value.trim() : '';
  if (!text) { alert('写点什么再寄吧～'); return; }

  const pName = getSecretCharName();
  var letters = getSecretMailbox(secretCharId);
  letters.push({ from:'me', text: text, time: Date.now() });
  saveSecretMailbox(secretCharId, letters);

  // 尝试用AI生成回信
  var replyText = '';
  if (apiConfig && apiConfig.apiKey) {
    try {
      const charPers = getCharPersona(secretCharId);
      const story = charPers.story || '';
      const prompt = '你现在是' + pName + '。' + (story ? '性格背景：' + story : '') +
        '\n\n你收到了一封匿名信，内容如下：\n"""\n' + text + '\n"""\n\n请以' + pName + '的身份写一封回信。信件风格要符合你的性格，真诚、有温度。100-200字左右。直接输出回信内容，不要加任何解释或前缀。';
      replyText = await callLLMApiForSecret(prompt);
    } catch(e) {
      console.log('[信箱] AI回信失败:', e);
    }
  }

  if (!replyText) {
    // 本地降级回信
    const templates = [
      '看到你的信了。谢谢你愿意跟我说这些。虽然不知道你是谁，但这些话我会好好收着的。',
      '信收到了。有些话说不出口的时候，写下来也好。我在这里。',
      '匿名信啊……好久没收到过了。你说的我都记住了，愿你一切都好。',
      '谢谢你的信。如果你愿意，随时都可以写给我。我会认真看的。',
    ];
    replyText = templates[Math.floor(Math.random() * templates.length)];
  }

  letters.push({ from:'them', text: replyText, time: Date.now() });
  saveSecretMailbox(secretCharId, letters);
  renderSecretMailbox();
}

/* ---- Secret专用轻量API调用（不经过callLLMApi，不带聊天上下文） ---- */
async function callSecretApi(prompt, charName, charStory) {
  if (!apiConfig || !apiConfig.apiKey) return '';
  var personaInfo = '你是' + (charName || 'AI') + '。' + (charStory ? '你的性格/背景：' + charStory : '') + '请根据你的身份和日常习惯生成手机内容。';
  var apiUrl = (apiConfig.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
  var body = JSON.stringify({
    model: apiConfig.model || 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: personaInfo + ' 只输出JSON，不要额外文字。确保JSON完整有效。' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1536,
    temperature: 0.7
  });
  try {
    var resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
      body: body
    });
    if (!resp.ok) { console.log('[SecretApi] HTTP错误:', resp.status); return ''; }
    var data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch(e) { console.log('[SecretApi] 请求失败:', e.message.substring(0,50)); return ''; }
}

/* ---- 信箱专用LLM调用（轻量版） ---- */
async function callLLMApiForSecret(prompt) {
  if (!apiConfig || !apiConfig.apiKey) return '';
  let apiUrl = (apiConfig.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
  if (apiConfig.useCorsProxy) {
    apiUrl = buildCorsProxyUrl(apiUrl);
  }
  const body = {
    model: apiConfig.model || 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: '你是一个温柔而真实的角色，正在回复一封匿名信。请用你的性格说话，回复要真诚、有温度。不要加任何动作描写或表情符号。' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 512,
    temperature: 0.8
  };
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiConfig.apiKey
    },
    body: JSON.stringify(body)
  }).catch(function(e) { throw e; });
  if (!resp.ok) {
    const errText = await resp.text().catch(function() { return ''; });
    throw new Error('API ' + resp.status + ': ' + errText.substring(0, 100));
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  return content ? content.trim() : '';
}

/* ==================== Secret 动态内容助手 ==================== */

function getRecentChatTopics(charId) {
  var msgs = chatData[charId] || [];
  var topics = [];
  for (var i = msgs.length - 1; i >= 0 && topics.length < 3; i--) {
    var text = msgs[i].text || '';
    if (text.length > 4 && text.length < 30 && msgs[i].role === 'user') {
      topics.push(text.substring(0, 20));
    }
  }
  return topics;
}

function getDynamicAlbum(charId, isTsundere, isGentle, isCool) {
  var hour = new Date().getHours();
  var timePeriod;
  if (hour >= 5 && hour < 9) timePeriod = 'morning';
  else if (hour >= 9 && hour < 12) timePeriod = 'late_morning';
  else if (hour >= 12 && hour < 14) timePeriod = 'noon';
  else if (hour >= 14 && hour < 18) timePeriod = 'afternoon';
  else if (hour >= 18 && hour < 21) timePeriod = 'evening';
  else timePeriod = 'night';

  var setChoice = Math.floor(Math.random() * 2);

  if (isTsundere) {
    if (timePeriod === 'morning') {
      return setChoice === 0
        ? [{ emoji:'🌅', label:'早起看到的天空', time:'今天' },{ emoji:'☕', label:'她给我带的热美式', time:'今天' },{ emoji:'🐱', label:'小区流浪猫', time:'今天' },{ emoji:'📖', label:'她看书的样子', time:'最近' }]
        : [{ emoji:'🌤', label:'今天阳光不错', time:'今天' },{ emoji:'🥐', label:'早餐', time:'今天' },{ emoji:'🌸', label:'路边花开了', time:'今天' },{ emoji:'🐕', label:'遛狗的大爷', time:'最近' }];
    } else if (timePeriod === 'noon' || timePeriod === 'afternoon') {
      return setChoice === 0
        ? [{ emoji:'☕', label:'她喝的咖啡', time:'今天下午' },{ emoji:'🍰', label:'蛋糕店新品', time:'今天' },{ emoji:'🐱', label:'楼下晒太阳的猫', time:'今天' },{ emoji:'🌧', label:'突然下雨了', time:'今天' }]
        : [{ emoji:'📱', label:'她发的消息', time:'今天' },{ emoji:'🍜', label:'午饭', time:'今天' },{ emoji:'🎵', label:'听到一首歌想到她', time:'最近' },{ emoji:'☁️', label:'天上的云像猫', time:'今天' }];
    } else if (timePeriod === 'evening') {
      return setChoice === 0
        ? [{ emoji:'🌇', label:'放学路上的晚霞', time:'今天' },{ emoji:'🍚', label:'晚饭', time:'今天' },{ emoji:'🌙', label:'今天的月亮', time:'今天' },{ emoji:'💭', label:'在想她', time:'今天' }]
        : [{ emoji:'🌆', label:'傍晚的城市', time:'今天' },{ emoji:'🥟', label:'路边的饺子馆', time:'今天' },{ emoji:'✨', label:'第一颗星星', time:'今天' },{ emoji:'📖', label:'她今天说的话', time:'最近' }];
    } else {
      return setChoice === 0
        ? [{ emoji:'🌙', label:'今晚月色很好', time:'今晚' },{ emoji:'🌃', label:'城市夜景', time:'今晚' },{ emoji:'☕', label:'深夜的咖啡', time:'今晚' },{ emoji:'💤', label:'她应该睡了吧', time:'今晚' }]
        : [{ emoji:'⭐', label:'星星', time:'今晚' },{ emoji:'📱', label:'翻来覆去看聊天记录', time:'今晚' },{ emoji:'🎧', label:'深夜歌单', time:'今晚' },{ emoji:'🌙', label:'想她', time:'今晚' }];
    }
  } else if (isGentle) {
    if (timePeriod === 'morning' || timePeriod === 'late_morning') {
      return setChoice === 0
        ? [{ emoji:'🌸', label:'早上买的花', time:'今天' },{ emoji:'☀️', label:'好天气', time:'今天' },{ emoji:'🐱', label:'窗台的猫', time:'今天' },{ emoji:'📚', label:'晨读', time:'今天' }]
        : [{ emoji:'🌷', label:'露珠', time:'今天' },{ emoji:'🥛', label:'热牛奶', time:'今天' },{ emoji:'🎵', label:'晨间旋律', time:'今天' },{ emoji:'🌿', label:'绿植新芽', time:'最近' }];
    } else if (timePeriod === 'noon' || timePeriod === 'afternoon') {
      return setChoice === 0
        ? [{ emoji:'☕', label:'下午茶', time:'今天' },{ emoji:'🍰', label:'做了小蛋糕', time:'今天' },{ emoji:'🌸', label:'阳光下的花', time:'今天' },{ emoji:'📖', label:'看了一本好书', time:'今天' }]
        : [{ emoji:'🌻', label:'向日葵', time:'今天' },{ emoji:'🧁', label:'烘焙时间', time:'今天' },{ emoji:'🐱', label:'猫咖的小橘', time:'最近' },{ emoji:'🎨', label:'画了一幅小画', time:'今天' }];
    } else if (timePeriod === 'evening') {
      return setChoice === 0
        ? [{ emoji:'🌇', label:'晚霞', time:'今天' },{ emoji:'🍜', label:'做了晚饭', time:'今天' },{ emoji:'🌙', label:'月亮', time:'今天' },{ emoji:'💌', label:'想给她写信', time:'最近' }]
        : [{ emoji:'🌆', label:'黄昏', time:'今天' },{ emoji:'🥗', label:'健康晚餐', time:'今天' },{ emoji:'✨', label:'星星出来了', time:'今天' },{ emoji:'🎶', label:'轻音乐', time:'今晚' }];
    } else {
      return setChoice === 0
        ? [{ emoji:'🌙', label:'月色很美', time:'今晚' },{ emoji:'🕯', label:'香薰蜡烛', time:'今晚' },{ emoji:'📖', label:'睡前读物', time:'今晚' },{ emoji:'💤', label:'晚安', time:'今晚' }]
        : [{ emoji:'⭐', label:'星空', time:'今晚' },{ emoji:'☕', label:'热牛奶', time:'今晚' },{ emoji:'🎵', label:'晚安曲', time:'今晚' },{ emoji:'🌙', label:'好梦', time:'今晚' }];
    }
  } else {
    return setChoice === 0
      ? [{ emoji:'☕', label:'咖啡', time:'今天' },{ emoji:'📱', label:'刷到有趣的新闻', time:'今天' },{ emoji:'🍜', label:'随便吃了点', time:'今天' },{ emoji:'💻', label:'干活', time:'今天' }]
      : [{ emoji:'🎮', label:'打了一会儿游戏', time:'今天' },{ emoji:'🍺', label:'朋友叫喝酒', time:'最近' },{ emoji:'🌧', label:'下雨了', time:'今天' },{ emoji:'🌙', label:'又一天', time:'今晚' }];
  }
}

function getDynamicPlaylist(charId, isTsundere, isGentle, isCool) {
  var hour = new Date().getHours();
  var vibe = (hour >= 5 && hour < 12) ? 'morning' : (hour >= 12 && hour < 18) ? 'afternoon' : (hour >= 18 && hour < 22) ? 'evening' : 'night';
  var setIdx = Math.floor(Math.random() * 2);
  var pools;
  if (isTsundere) {
    pools = vibe === 'morning'
      ? [[{ title:'路过人间', artist:'郁可唯' },{ title:'唯一', artist:'告五人' },{ title:'小半', artist:'陈粒' },{ title:'喜欢你', artist:'陈洁仪' }],[{ title:'刚刚好', artist:'薛之谦' },{ title:'你就不要想起我', artist:'田馥甄' },{ title:'带我走', artist:'杨丞琳' },{ title:'爱丫爱丫', artist:'BY2' }]]
      : vibe === 'afternoon'
      ? [[{ title:'不值得', artist:'梦飞船' },{ title:'我怀念的', artist:'孙燕姿' }],[{ title:'倒带', artist:'蔡依林' },{ title:'安静', artist:'周杰伦' }]]
      : vibe === 'evening'
      ? [[{ title:'夜曲', artist:'周杰伦' },{ title:'黄昏', artist:'周传雄' },{ title:'慢慢', artist:'颜人中' }],[{ title:'特别的人', artist:'方大同' },{ title:'Love Song', artist:'方大同' }]]
      : [[{ title:'我好想你', artist:'苏打绿' },{ title:'你就不要想起我', artist:'田馥甄' }],[{ title:'想你的夜', artist:'关喆' },{ title:'趁早', artist:'张宇' }]];
  } else if (isGentle) {
    pools = [[{ title:'小美满', artist:'周深' },{ title:'日常', artist:'田馥甄' },{ title:'暖暖', artist:'梁静茹' }],[{ title:'遇见', artist:'孙燕姿' },{ title:'明天你好', artist:'牛奶咖啡' },{ title:'和你一样', artist:'李宇春' }]];
  } else {
    pools = [[{ title:'空城', artist:'杨坤' },{ title:'演员', artist:'薛之谦' },{ title:'丑八怪', artist:'薛之谦' }],[{ title:'消愁', artist:'毛不易' },{ title:'南山南', artist:'马頔' },{ title:'理想三旬', artist:'陈鸿宇' }]];
  }
  var selected = pools[setIdx % pools.length];
  var times = ['刚刚','今天','今天下午','昨晚'];
  return selected.map(function(s) { return { title: s.title, artist: s.artist, time: times[Math.floor(Math.random()*4)] }; });
}

function getDynamicFoodOrders(charId, isTsundere, isGentle, isCool) {
  var hour = new Date().getHours();
  var setIdx = Math.floor(Math.random() * 3);
  var baseOrders = isTsundere
    ? [[{ shop:'肯德基', items:'香辣鸡腿堡套餐', price:39.9 },{ shop:'一点点', items:'四季奶青 加波霸', price:16 },{ shop:'沙县小吃', items:'蒸饺+拌面', price:18 },{ shop:'绝味鸭脖', items:'鸭锁骨+藕片', price:28 }],[{ shop:'麦当劳', items:'板烧鸡腿堡', price:34 },{ shop:'瑞幸咖啡', items:'生椰拿铁', price:19.9 },{ shop:'螺蛳粉', items:'螺蛳粉加蛋', price:25 },{ shop:'蜜雪冰城', items:'柠檬水', price:6 }],[{ shop:'便利蜂', items:'便当+酸奶', price:28.5 },{ shop:'麻辣烫', items:'自选麻辣烫', price:32 },{ shop:'正新鸡排', items:'鸡排+烤肠', price:15 }]]
    : isGentle
    ? [[{ shop:'好利来', items:'半熟芝士+芋泥面包', price:48 },{ shop:'瑞幸咖啡', items:'生椰拿铁 少冰', price:19.9 },{ shop:'老乡鸡', items:'鸡汤+蒸蛋+米饭', price:32 },{ shop:'鲜芋仙', items:'芋圆4号', price:28 }],[{ shop:'星巴克', items:'抹茶星冰乐', price:36 },{ shop:'喜茶', items:'多肉葡萄', price:28 },{ shop:'巴黎贝甜', items:'牛角包+牛奶', price:25 }],[{ shop:'味多美', items:'老婆饼+蛋挞', price:20 },{ shop:'吉野家', items:'肥牛饭套餐', price:38 },{ shop:'满记甜品', items:'杨枝甘露', price:32 }]]
    : [[{ shop:'麦当劳', items:'板烧鸡腿堡套餐', price:36 },{ shop:'星巴克', items:'冰美式 大杯', price:32 },{ shop:'黄焖鸡米饭', items:'黄焖鸡米饭', price:25 },{ shop:'蜜雪冰城', items:'柠檬水+甜筒', price:8 }],[{ shop:'汉堡王', items:'皇堡套餐', price:42 },{ shop:'瑞幸咖啡', items:'厚乳拿铁', price:22 },{ shop:'沙县小吃', items:'鸡腿饭', price:18 }],[{ shop:'必胜客', items:'披萨外送', price:68 },{ shop:'肯德基', items:'奥尔良烤鸡腿堡', price:32 },{ shop:'马记永', items:'兰州牛肉面', price:26 }]];
  var orders = baseOrders[setIdx % baseOrders.length].map(function(o) {
    var statuses = ['已送达','已送达','配送中'];
    var times = ['今天上午','今天中午','今天下午','昨天中午','昨天晚上'];
    return { shop: o.shop, items: o.items, price: o.price, time: times[Math.floor(Math.random() * times.length)], status: statuses[Math.floor(Math.random() * statuses.length)] };
  });
  var topics = getRecentChatTopics(charId);
  topics.forEach(function(t) {
    if (t && (t.includes('吃') || t.includes('饭') || t.includes('喝') || t.includes('点'))) {
      orders.unshift({ shop: '🍽 猜你想点', items: t, price: 0, time: '刚刚', status: '未下单' });
    }
  });
  if (orders.length > 6) orders = orders.slice(0, 6);
  return orders;
}

function getDynamicBrowserHistory(charId, isTsundere, isGentle, isCool) {
  var base = isTsundere
    ? [{ query:'怎么哄生气的女朋友', time:'今天' },
       { query:'傲娇的人怎么表达关心', time:'昨天' },
       { query:'她最近在看什么', time:'昨天' },
       { query:'吵架后怎么和好', time:'3天前' },
       { query:'送什么礼物不会太明显', time:'5天前' },
       { query:'如何假装不在意', time:'6天前' }]
    : isGentle
    ? [{ query:'今日菜谱 简单好吃', time:'今天' },
       { query:'她喜欢甜的还是咸的', time:'昨天' },
       { query:'适合送花的节日', time:'昨天' },
       { query:'怎么让心情变好', time:'前天' },
       { query:'治愈系电影推荐', time:'5天前' },
       { query:'拼多多鲜花优惠券', time:'6天前' }]
    : [{ query:'今天天气', time:'今天' },
       { query:'附近有什么好吃的', time:'昨天' },
       { query:'周末去哪玩', time:'昨天' },
       { query:'如何提高工作效率', time:'前天' },
       { query:'她喜欢什么', time:'4天前' },
       { query:'深夜emo怎么办', time:'6天前' }];

  // 混入最近的聊天话题
  var recentTopics = getRecentChatTopics(charId);
  recentTopics.forEach(function(topic) {
    if (topic && topic.length > 2) {
      base.unshift({ query: topic, time: '刚刚' });
    }
  });

  // 随机刷新部分时间
  var times = ['刚刚','10分钟前','今天上午','今天下午','今天','昨天','前天'];
  for (var i = 0; i < base.length; i++) {
    if (Math.random() < 0.3) {
      base[i].time = times[Math.floor(Math.random() * times.length)];
    }
  }

  return base;
}
