/* ==================== 设置页 ==================== */
const APP_VERSION = "v1.0.2 (2026.09.22)";

const DEFAULT_SETTINGS = {
  proactiveMsg: true,
  autoMoments: true,
  notifications: true,
  charPrivacy: false,
  disableActions: true,
  aiControl: false,
  sleepGuard: true,
  scheduleRemind: true
};

let settings = lsGet('settings', DEFAULT_SETTINGS);

function loadSettings() {
  var verEl = document.getElementById('appVersionDisplay');
  if (verEl && typeof APP_VERSION !== 'undefined') verEl.textContent = APP_VERSION;
  settings = lsGet('settings', DEFAULT_SETTINGS);
  // 老数据可能缺新增的默认项（如 scheduleRemind）：补上默认值，避免「开关显示关、实际却在生效」的不一致
  if (!settings || typeof settings !== 'object') {
    settings = Object.assign({}, DEFAULT_SETTINGS);
  } else {
    var _missing = false;
    for (var _k in DEFAULT_SETTINGS) {
      if (settings[_k] === undefined) { settings[_k] = DEFAULT_SETTINGS[_k]; _missing = true; }
    }
    if (_missing) lsSet('settings', settings);
  }
  const toggles = ['proactiveMsg','autoMoments','notifications','charPrivacy','disableActions','aiControl','sleepGuard','scheduleRemind'];
  toggles.forEach(function(key) {
    const el = document.getElementById('setting' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) {
      if (settings[key]) el.classList.add('on');
      else el.classList.remove('on');
    }
  });
  // 加载 API Key
  const apiKeyInput = document.getElementById('settingsApiKey');
  if (apiKeyInput && apiConfig) {
    apiKeyInput.value = apiConfig.apiKey || '';
  }
  // 加载高德地图配置（足迹用）
  if (typeof loadAmapSettings === 'function') loadAmapSettings();
}

function toggleSetting(el, key) {
  const isOn = el.classList.toggle('on');
  settings[key] = isOn;
  lsSet('settings', settings);
  // 通知权限
  if (key === 'notifications' && isOn) {
    requestNotificationPermission();
  }
  const labels = {
    proactiveMsg: 'AI主动消息',
    autoMoments: 'AI自动发朋友圈',
    notifications: '通知',
    charPrivacy: '角色隐私',
    disableActions: '禁止动作描写',
    aiControl: '允许AI操纵手机',
    sleepGuard: '睡眠陪伴',
    scheduleRemind: '上课提醒'
  };
  addChatSystem((isOn ? '✅ ' : '❌ ') + labels[key] + (isOn ? '已开启' : '已关闭'));
}

function saveSettingsApiConfig() {
  const keyInput = document.getElementById('settingsApiKey');
  if (!keyInput) return;
  const newKey = keyInput.value.trim();
  if (apiConfig) {
    apiConfig.apiKey = newKey;
    lsSet('apiConfig', apiConfig);
  }
  addChatSystem('✅ API Key 已保存');
  updateApiStatusBadge();
}

function testSettingsApiConnection() {
  if (typeof testApiConnection === 'function') {
    testApiConnection();
  } else {
    addChatSystem('⚠️ 请先保存 API Key');
  }
}

function restoreFromAutoBackup() {
  var backupData = lsGet('backup_chatData', null);
  var backupMemories = lsGet('backup_memories', null);
  var backupTime = lsGet('backup_time', 0);
  if (!backupData) {
    addChatSystem('❌ 没有找到自动备份数据');
    return;
  }
  if (!confirm('确定要从自动备份恢复所有聊天记录吗？\n当前数据将被覆盖。\n\n备份时间：' + new Date(backupTime).toLocaleString('zh-CN'))) return;
  lsSet('chatData', backupData);
  if (backupMemories) lsSet('memories', backupMemories);
  addChatSystem('✅ 已从自动备份恢复。正在刷新页面...');
  setTimeout(function() { location.reload(); }, 1500);
}
