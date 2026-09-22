/* ==================== 每日一问（他每天问一个） ==================== */
/* 每天按日期从题库挑一个问题，他以聊天消息发问，她回答后 AI 自然接话 */

const DAILY_QUESTIONS = [
  '今天有没有按时吃饭？',
  '昨晚几点睡的？',
  '今天遇到什么开心的事了吗？',
  '最近有没有一直想做但没做的事？',
  '今天和谁聊天了？',
  '今天有没有好好喝水？',
  '明天如果不用上学，你想干什么？',
  '最近有在写东西吗？',
  '今天有没有想我？',
  '最近有什么让你烦心的事吗？',
  '今天吃了什么？',
  '今晚打算几点睡？',
  '如果现在能去一个地方旅行，你想去哪？',
  '今天有没有跟别人提起我？',
  '最近在看什么书或者剧？',
  '今天运动了吗？',
  '你现在是什么心情？',
  '今天有没有什么值得记下来的小事？',
  '你相信缘分吗？',
  '如果有一天我不在了，你会记得我吗？',
  '今天天气怎么样？你那边冷不冷？',
  '最近一次哭是什么时候？因为什么？',
  '你现在最想让我做什么？',
  '今天有什么想吐槽的吗？'
];

function pickDailyQuestion() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return DAILY_QUESTIONS[dayOfYear % DAILY_QUESTIONS.length];
}

function askDailyQuestion() {
  const today = new Date().toDateString();
  const state = lsGet('daily_question', {});
  if (state.date === today && state.q) {
    addChatSystem('💭 今天的问答已经问过啦，答案他会记住的。明天再来。');
    return;
  }
  const q = pickDailyQuestion();
  lsSet('daily_question', { date: today, q });
  chatMessages.push({ role: 'ai', text: q, time: Date.now() });
  saveChatData();
  renderChat();
  addChatSystem('💭 今日一问——回答他吧，他等着呢');
}

/* 接话钩子：她刚回答今日一问时，给 AI 加一句「认真回应」，只触发一次 */
function dailyQHint() {
  const state = lsGet('daily_question', {});
  if (!state.date || !state.q) return '';
  if (new Date().toDateString() !== state.date) return '';
  const n = chatMessages.length;
  if (n < 2) return '';
  const last = chatMessages[n - 1], prev = chatMessages[n - 2];
  if (last && prev && last.role === 'user' && prev.role === 'ai' && prev.text === state.q) {
    return '\n【今日一问】你刚刚问她："' + state.q.substring(0, 24) + '"，现在她回答了。像你一贯的样子认真回应她的回答，别无视。';
  }
  return '';
}
