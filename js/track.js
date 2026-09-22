/* ==================== NFC 足迹 · 打卡站 ====================
 * 扫码(?nfc=1)或手动打卡 → 定位 → 逆地理编码 → 他(跟随人设)说几句
 * → 存 phone_trackChecks → 足迹页(高德地图+轨迹) → 年度总结
 * ========================================================= */
let trackChecks = lsGet('trackChecks', []);
/* 高德 key 默认配置（设置页可改）。JS API key+安全密钥用于地图显示与逆地理编码，
 * Web服务 key 作为 JSONP 兜底。都是绑定域名的个人 key，公开展示影响有限。 */
let amapCfg = lsGet('amapCfg', {
  jsKey: 'c88739f0d6669aea8fd696c3bdc7ec0c',
  jsCode: '148d6c8cb3e835d70e23cb26a98de199',
  webKey: '78575354381e2ab5ac1fd2423411d32b'
});
let amapLoading = false;
let amapWaiters = [];
let trackPickMode = false;
let trackSummaryYear = new Date().getFullYear();

/* ---------- 通用工具 ---------- */
function trackTimeStr(ms) {
  const d = new Date(ms);
  return (d.getMonth()+1) + '月' + d.getDate() + '日 ' +
    String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function trackFullTime(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '年' + trackTimeStr(ms);
}
function trackToast(msg) {
  let el = document.getElementById('trackToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trackToast';
    el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:rgba(30,30,30,.92);color:#fff;padding:10px 16px;border-radius:20px;font-size:13px;z-index:9999;max-width:82%;text-align:center;pointer-events:none;transition:opacity .3s;line-height:1.5;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.style.opacity = '0'; }, 2600);
}
function trackDistKm(a, b) {
  const R = 6371, rad = Math.PI/180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function trackDistance(sorted) {
  let sum = 0;
  for (let i = 1; i < sorted.length; i++) sum += trackDistKm(sorted[i-1], sorted[i]);
  return sum;
}

/* ---------- 读取当前角色人设（跟随设置自动变化） ---------- */
function trackCharInfo() {
  const cid = (typeof currentCharId !== 'undefined') ? currentCharId : 'ai';
  let char = null;
  if (typeof characters !== 'undefined' && Array.isArray(characters)) char = characters.find(function(c){ return c.id === cid; });
  if (!char && typeof DEFAULT_CHARACTERS !== 'undefined') char = DEFAULT_CHARACTERS[0] || null;
  const pers = lsGet('persona_' + cid, null) || lsGet('persona', null) ||
    (char ? { name: char.name, story: char.story } : { name:'他', story:'' });
  const sp = lsGet('sp_' + cid, null) || lsGet('sp', null) || (char && char.systemPrompt) || '';
  const wb = lsGet('worldBook', '');
  return { name: pers.name || '他', story: pers.story || '', sp: sp, wb: wb };
}
function trackWeatherLine() {
  try {
    if (typeof weatherData !== 'undefined' && weatherData && weatherData.desc && (Date.now() - weatherData.time) < 3600000) {
      return '此刻天气：' + weatherData.desc + '，' + weatherData.temp + '°C。';
    }
  } catch(e) {}
  return '';
}
function trackAiFallback(place) {
  const arr = [
    '这个「' + place + '」，我替用户记下了。',
    '到了' + place + '啊。替我多看看。',
    '嗯，' + place + '。今天也来过了。',
    '路过' + place + '，记住了。'
  ];
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- 高德地图加载 ---------- */
function ensureAmap() {
  return new Promise(function(resolve) {
    if (!amapCfg.jsKey) return resolve(false);              // 没配 key → 走 Nominatim 兜底
    if (window.AMap) return resolve(true);
    if (amapLoading) { amapWaiters.push(function(){ resolve(!!window.AMap); }); return; }
    amapLoading = true;
    window._AMapSecurityConfig = { securityJsCode: amapCfg.jsCode || '' };
    const s = document.createElement('script');
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(amapCfg.jsKey);
    s.onload = function() {
      amapLoading = false;
      amapWaiters.splice(0).forEach(function(f){ f(); });
      resolve(true);
    };
    s.onerror = function() {
      amapLoading = false;
      amapWaiters.splice(0).forEach(function(f){ f(); });
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

/* ---------- 逆地理编码：坐标 → 地名 ----------
 * 优先 AMap.Geocoder（JS key）；失败用 Web服务 key 走 JSONP；最后 OSM 兜底 */
function trackReverseGeocode(lat, lng) {
  if (window.AMap) {
    return new Promise(function(resolve) {
      AMap.plugin('AMap.Geocoder', function() {
        const g = new AMap.Geocoder({ radius: 800 });
        g.getAddress([lng, lat], function(status, result) {
          if (status === 'complete' && result && result.regeocode) {
            const r = result.regeocode;
            const ac = r.addressComponent || {};
            resolve({ place: r.formattedAddress || '', city: ac.city || ac.province || '' });
          } else resolve(null);
        });
      });
    });
  }
  if (amapCfg.webKey) {
    return new Promise(function(resolve) {
      const cb = 'amap_regeo_' + Date.now();
      const done = function(data) {
        try { delete window[cb]; } catch(e) {}
        const s = document.getElementById(cb); if (s) s.remove();
        if (data && data.status === '1' && data.regeocode) {
          const ac = data.regeocode.addressComponent || {};
          resolve({ place: data.regeocode.formatted_address || '', city: ac.city || ac.province || '' });
        } else resolve(null);
      };
      window[cb] = done;
      const s = document.createElement('script');
      s.id = cb;
      s.src = 'https://restapi.amap.com/v3/geocode/regeo?location=' + lng + ',' + lat + '&key=' +
              encodeURIComponent(amapCfg.webKey) + '&output=json&callback=' + cb + '&radius=800';
      s.onerror = function() { done(null); };
      document.head.appendChild(s);
    });
  }
  // OSM Nominatim 兜底（免 key）
  return fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&accept-language=zh&zoom=16')
    .then(function(r){ return r.json(); })
    .then(function(d){ return d && d.display_name ? { place: d.display_name, city: '' } : null; })
    .catch(function(){ return null; });
}

/* 创建地图并给常见高德错误一个友好提示 */
function trackNewMap(el, opts) {
  try {
    return new AMap.Map(el, opts || { zoom: 11, resizeEnable: true });
  } catch(e) {
    const msg = (e && e.message) || '';
    el.innerHTML = '<div class="track-map-empty">🗺️ 地图初始化失败<br><span style="font-size:11px;">' + escHtml(msg) + '</span></div>';
    if (/INVALID|SCODE|DOMAIN|NOMATCH/i.test(msg)) {
      trackToast('⚠️ 高德 key 不对或域名没绑定，去 ⚙设置页 检查');
    }
    return null;
  }
}

/* ---------- 定位 ----------
 * 有高德 key 时优先走「高德定位插件」：它先试浏览器 GPS，失败自动切高德服务定位(IP)——
 * 国内无 Google 服务的安卓机(小米/华为/Edge等)也能拿到位置。没 key 才用裸浏览器定位。 */
function getGeo() {
  return new Promise(function(resolve, reject) {
    function rawGeo() {
      if (!navigator.geolocation) { reject(new Error('设备不支持定位')); return; }
      navigator.geolocation.getCurrentPosition(
        function(pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function(err) { reject(err); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    }
    if (!amapCfg.jsKey) { rawGeo(); return; }
    ensureAmap().then(function(ok) {
      if (!ok) { rawGeo(); return; }
      AMap.plugin('AMap.Geolocation', function() {
        const g = new AMap.Geolocation({
          enableHighAccuracy: true, timeout: 15000, GeoLocationFirst: true, maximumAge: 60000, showCircle: false
        });
        g.getCurrentPosition(function(status, result) {
          if (status === 'complete' && result && result.position) {
            resolve({ lat: result.position.getLat(), lng: result.position.getLng() });
          } else rawGeo();
        });
      });
    });
  });
}

/* ---------- AI 说话（跟随人设） ---------- */
async function trackAiSpeak(place, city) {
  const ci = trackCharInfo();
  const now = new Date();
  const timeStr = now.getHours() + '点' + (now.getMinutes() ? now.getMinutes() + '分' : '');
  const system =
    '你是' + ci.name + '。' + (ci.story ? '你的人设：' + ci.story + '。' : '') +
    (ci.sp ? '表达方式：' + ci.sp + '。' : '') +
    (ci.wb ? '世界观设定：' + ci.wb + '。' : '') +
    '\n你此刻陪在用户身边。用户刚到一个地方，用 NFC 打了卡：地点「' + place + '」' + (city ? '（' + city + '）' : '') +
    '，时间是' + timeStr + '。' + trackWeatherLine() +
    '\n请用你一贯的口吻，说 1-3 句话回应此刻的这个地点——可以是对这里的印象、关心、调侃、或替她记住的心情，但不要像导游一样介绍景点，不要喊口号。' +
    actionBanLine();
  const text = await callLightLlm(system, '直接输出你的回应，不要任何前缀。', 180, 0.9);
  return text || trackAiFallback(place);
}
async function trackAiYearSummary(year, list) {
  const ci = trackCharInfo();
  const system =
    '你是' + ci.name + '。' + (ci.story ? '你的人设：' + ci.story + '。' : '') +
    (ci.sp ? '表达方式：' + ci.sp + '。' : '') +
    '\n下面是用户在' + year + '年去过的所有地方（按时间顺序）。' +
    '请用你一贯的口吻，写一段年度足迹总结，3-6 句话。要像朋友翻完一整年照片后随口说的话，带一点具体的地点记忆和情感，不要列流水账，不要总结数据，不要鸡汤。' +
    actionBanLine();
  const text = await callLightLlm(system, list, 500, 0.9);
  return text || ('这一年，你去了不少地方。以后每一个，我都替你记着。');
}

/* ---------- 打卡主流程 ---------- */
async function doCheckin(lat, lng) {
  setTrackState('🔍', '正在翻译这个地点…', lat.toFixed(4) + ', ' + lng.toFixed(4));
  const geo = await trackReverseGeocode(lat, lng);
  const place = (geo && geo.place) ? geo.place : (lat.toFixed(4) + ', ' + lng.toFixed(4));
  const city = (geo && geo.city) || '';
  // 同地点 60 分钟内去重
  const last = trackChecks[trackChecks.length - 1];
  if (last && last.place === place && Date.now() - last.time < 3600000) {
    setTrackState('♻️', place, trackTimeStr(last.time) + ' 刚刚打过卡，就不重复记了');
    showTrackResult(last, true);
    return;
  }
  setTrackState('💭', place, '正在想该说什么…');
  const text = await trackAiSpeak(place, city);
  const check = { id: Date.now(), time: Date.now(), lat: lat, lng: lng, place: place, city: city, text: text };
  trackChecks.push(check);
  lsSet('trackChecks', trackChecks);
  showTrackResult(check, false);
}

function startNfcCheckin() {
  stripNfcParam();
  showTrackOverlay();
  setTrackState('📍', '正在确认你的位置…', '请允许浏览器获取定位');
  getGeo().then(function(pos) {
    return ensureAmap().then(function() { doCheckin(pos.lat, pos.lng); });
  }).catch(function(err) {
    const errBtns = [
      { t:'再试一次', f:'startNfcCheckin', cls:'primary' },
      { t:'🗺 手动选点', f:'goManualPick', cls:'' },
      { t:'完成', f:'closeTrackOverlay', cls:'ghost' }
    ];
    if (err && (err.code === 1 || (err.message && err.message.indexOf('denied') >= 0))) {
      setTrackState('🚫', '定位被拒绝了', '允许浏览器获取位置，或直接用「手动选点」在地图上选');
    } else if (err && err.code === 2) {
      setTrackState('🌐', '定位失败', '当前环境拿不到 GPS，试试「手动选点」');
    } else if (err && err.code === 3) {
      setTrackState('⏱', '定位超时', '拿不到位置，建议用「手动选点」在地图上点一下');
    } else {
      setTrackState('❌', '打卡失败', (err && err.message) || '未知错误');
    }
    setTrackActions(errBtns);
  });
}

/* ---------- 打卡 overlay ---------- */
function showTrackOverlay() {
  const o = document.getElementById('trackOverlay');
  if (o) o.style.display = 'flex';
  const rb = document.getElementById('trackResultBox');
  if (rb) rb.innerHTML = '';
  setTrackState('📍', '准备打卡…', '');
  setTrackActions([{ t:'取消', f:'closeTrackOverlay', cls:'ghost' }]);
}
/* 打卡成功后把 ?nfc=1 从地址栏去掉，刷新页面不会重复弹打卡 */
function stripNfcParam() {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('nfc') !== null) {
      u.searchParams.delete('nfc');
      history.replaceState(null, '', u.href);
    }
  } catch(e) {}
}
function closeTrackOverlay() {
  const o = document.getElementById('trackOverlay');
  if (o) o.style.display = 'none';
}
function setTrackState(icon, title, sub) {
  const i = document.getElementById('trackStateIcon'); if (i) i.textContent = icon;
  const t = document.getElementById('trackStateTitle'); if (t) t.textContent = title;
  const s = document.getElementById('trackStateSub'); if (s) s.textContent = sub || '';
}
function setTrackActions(btns) {
  const box = document.getElementById('trackActions');
  if (!box) return;
  box.innerHTML = '';
  (btns || []).forEach(function(b) {
    const el = document.createElement('button');
    el.textContent = b.t;
    el.className = 'track-btn' + (b.cls ? ' ' + b.cls : '');
    el.onclick = function() { (typeof b.f === 'string' ? window[b.f] : b.f)(); };
    box.appendChild(el);
  });
}
function showTrackResult(check, isDup) {
  setTrackState(isDup ? '♻️' : '📍', check.place, trackTimeStr(check.time) + (check.city ? ' · ' + check.city : ''));
  const rb = document.getElementById('trackResultBox');
  if (rb) rb.innerHTML = '<div class="track-result-text">' + escHtml(check.text || '') + '</div>';
  setTrackActions([
    { t:'🧭 看足迹', f:'goToTrackPage', cls:'primary' },
    { t:'完成', f:'closeTrackOverlay', cls:'' }
  ]);
  // 如果人就在足迹页，打卡后立即刷新地图和列表
  if (!isDup && typeof currentPage !== 'undefined' && currentPage === 'page-track') {
    setTimeout(function() { if (typeof showTrackPage === 'function') showTrackPage(); }, 400);
  }
}
function goToTrackPage() { closeTrackOverlay(); navigateTo('page-track'); }

/* ---------- 足迹页 ---------- */
function showTrackPage() {
  document.getElementById('trackViewList').style.display = 'block';
  document.getElementById('trackViewSummary').style.display = 'none';
  const lb = document.getElementById('trackViewListBtn'); if (lb) lb.classList.add('on');
  const sb = document.getElementById('trackViewSumBtn'); if (sb) sb.classList.remove('on');

  const listEl = document.getElementById('trackList');
  if (listEl) renderTrackList();

  // 地图永远先建好（这样「选点」在空地图上也能用），有记录才往上铺点
  ensureAmap().then(function(ok) {
    const mapEl = document.getElementById('trackMap');
    if (!mapEl) return;
    if (!ok) {
      mapEl.innerHTML = '<div class="track-map-empty">🗺️ 未配置高德 key，去 ⚙设置页 填一下就能看地图</div>';
      window.__trackMap = null;
      return;
    }
    mapEl.innerHTML = '';
    const map = trackNewMap(mapEl, { zoom: 11, resizeEnable: true });
    if (!map) { window.__trackMap = null; return; }
    window.__trackMap = map;
    if (trackChecks.length > 0) renderTrackMap(map);
  });
}

function renderTrackMap(map) {
  const sorted = trackChecks.slice().sort(function(a,b){ return a.time - b.time; });
  const markers = [];
  sorted.forEach(function(c, idx) {
    const marker = new AMap.Marker({
      position: [c.lng, c.lat],
      content: '<div class="track-marker">' + (idx + 1) + '</div>'
    });
    marker.on('click', function() {
      const info = new AMap.InfoWindow({
        content: '<div class="track-infowin"><div class="tw-place">📍 ' + escHtml(c.place) + '</div>' +
                 '<div class="tw-time">' + trackFullTime(c.time) + '</div>' +
                 (c.text ? '<div class="tw-text">' + escHtml(c.text) + '</div>' : '') + '</div>',
        offset: new AMap.Pixel(0, -30)
      });
      info.open(map, marker.getPosition());
    });
    map.add(marker);
    markers.push(marker);
  });
  if (sorted.length > 1) {
    map.add(new AMap.Polyline({
      path: sorted.map(function(c){ return [c.lng, c.lat]; }),
      strokeColor: '#667eea', strokeWeight: 4, strokeOpacity: 0.75, lineJoin: 'round', lineCap: 'round'
    }));
  }
  map.setFitView(markers, false, [50, 50, 50, 50]);
}

function renderTrackList() {
  const el = document.getElementById('trackList');
  if (trackChecks.length === 0) {
    el.innerHTML = '<div class="track-empty">还没有打卡记录<br><span>点右上角「📌 打卡」用定位记录当前位置，或「🗺 选点」在地图上点一下</span></div>';
    return;
  }
  const sorted = trackChecks.slice().sort(function(a,b){ return b.time - a.time; });
  el.innerHTML = '<div class="track-list-count">共 ' + trackChecks.length + ' 次打卡</div>' +
    sorted.map(function(c) {
      return '<div class="track-item" onclick="trackFocus(' + c.time + ')">' +
        '<div class="track-item-head"><span class="track-item-time">' + trackTimeStr(c.time) + '</span>' +
        '<button class="track-del" onclick="event.stopPropagation();trackDelete(' + c.time + ')">🗑</button></div>' +
        '<div class="track-item-place">📍 ' + escHtml(c.place) + '</div>' +
        (c.text ? '<div class="track-item-text">' + escHtml(c.text) + '</div>' : '') +
        '</div>';
    }).join('');
}

function trackFocus(time) {
  const map = window.__trackMap;
  const c = trackChecks.find(function(x){ return x.time === time; });
  if (!c) return;
  if (map) {
    map.setZoomAndCenter(14, [c.lng, c.lat]);
    trackToast(c.place);
  }
}
function trackDelete(time) {
  const idx = trackChecks.findIndex(function(c){ return c.time === time; });
  if (idx < 0) return;
  if (!confirm('删除这条打卡记录？')) return;
  trackChecks.splice(idx, 1);
  lsSet('trackChecks', trackChecks);
  if (currentPage === 'page-track') {
    if (document.getElementById('trackViewSummary').style.display !== 'none') renderTrackSummary();
    else showTrackPage();
  }
}

/* ---------- 手动打卡 ---------- */
function goManualPick() { closeTrackOverlay(); enterPickMode(); }
/* 「📌 打卡」：直接用 GPS 记当前位置（和 NFC 一样）；失败再落到地图选点 */
function manualCheckin() { startNfcCheckin(); }
/* 地图选点打卡（定位被拒/失败时的兜底） */
function enterPickMode() {
  trackToast('📌 在地图上点一个位置，就会打卡');
  navigateTo('page-track');
  // 轮询等地图真正就绪（最多 ~8 秒），起来了再进入选点
  let tries = 0;
  const timer = setInterval(function() {
    tries++;
    if (window.__trackMap) {
      clearInterval(timer);
      trackPickMode = true;
      window.__trackMap.on('click', onTrackMapPick);
      trackToast('👆 点击地图选择打卡位置');
    } else if (tries >= 16) {
      clearInterval(timer);
      trackToast('⚠️ 地图没起来，去 ⚙设置页 检查高德 key 和域名绑定');
    }
  }, 500);
}
function onTrackMapPick(e) {
  const map = window.__trackMap;
  if (!trackPickMode || !map) return;
  trackPickMode = false;
  map.off('click', onTrackMapPick);
  const lng = e.lnglat.getLng(), lat = e.lnglat.getLat();
  pickAndCheckin(lat, lng);
}
async function pickAndCheckin(lat, lng) {
  showTrackOverlay();
  setTrackState('📍', '在「' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '」打卡', '正在翻译位置…');
  const geo = await trackReverseGeocode(lat, lng);
  const place = (geo && geo.place) ? geo.place : (lat.toFixed(4) + ', ' + lng.toFixed(4));
  const city = (geo && geo.city) || '';
  setTrackState('💭', place, '正在想该说什么…');
  const text = await trackAiSpeak(place, city);
  const check = { id: Date.now(), time: Date.now(), lat: lat, lng: lng, place: place, city: city, text: text };
  trackChecks.push(check);
  lsSet('trackChecks', trackChecks);
  showTrackResult(check, false);
}

/* ---------- 年度总结 ---------- */
function switchTrackView(view) {
  const listV = document.getElementById('trackViewList');
  const sumV = document.getElementById('trackViewSummary');
  const lb = document.getElementById('trackViewListBtn');
  const sb = document.getElementById('trackViewSumBtn');
  if (view === 'summary') {
    listV.style.display = 'none';
    sumV.style.display = 'block';
    if (lb) lb.classList.remove('on');
    if (sb) sb.classList.add('on');
    renderTrackSummary();
  } else {
    listV.style.display = 'block';
    sumV.style.display = 'none';
    if (lb) lb.classList.add('on');
    if (sb) sb.classList.remove('on');
    showTrackPage();
  }
}

function renderTrackSummary() {
  const el = document.getElementById('trackViewSummary');
  if (!el) return;
  const year = trackSummaryYear;
  const inYear = trackChecks.filter(function(c){ return new Date(c.time).getFullYear() === year; });
  const sorted = inYear.slice().sort(function(a,b){ return a.time - b.time; });

  const places = {};
  inYear.forEach(function(c){ places[c.place] = (places[c.place] || 0) + 1; });
  const topKeys = Object.keys(places).sort(function(a,b){ return places[b] - places[a]; });
  const topPlace = topKeys[0] || '';
  const totalKm = trackDistance(sorted);
  const firstC = sorted[0], lastC = sorted[sorted.length - 1];

  let html =
    '<div class="track-sum-head">' +
      '<button class="track-sum-nav" onclick="trackSummaryYear--;renderTrackSummary()">◀</button>' +
      '<div class="track-sum-year">' + year + ' 年</div>' +
      '<button class="track-sum-nav" onclick="trackSummaryYear++;renderTrackSummary()">▶</button>' +
    '</div>';

  if (inYear.length === 0) {
    html += '<div class="track-empty">' + year + ' 年还没有打卡记录</div>';
  } else {
    html +=
      '<div class="track-stats">' +
        '<div class="track-stat"><div class="ts-num">' + inYear.length + '</div><div class="ts-label">打卡次数</div></div>' +
        '<div class="track-stat"><div class="ts-num">' + topKeys.length + '</div><div class="ts-label">去过的地点</div></div>' +
        '<div class="track-stat"><div class="ts-num">' + totalKm.toFixed(1) + '</div><div class="ts-label">累计里程 km</div></div>' +
      '</div>' +
      '<div class="track-top">🏆 去得最多：' + escHtml(topPlace) + ' · ' + places[topPlace] + ' 次</div>' +
      '<div class="track-map" id="trackSumMap"></div>' +
      '<div class="track-top">📌 首次：' + trackTimeStr(firstC.time) + ' · ' + escHtml(firstC.place) + '<br>📍 最近：' + trackTimeStr(lastC.time) + ' · ' + escHtml(lastC.place) + '</div>' +
      '<button class="track-btn primary track-sum-btn" onclick="genTrackSummary()">🤖 生成 ' + year + ' 年总结</button>' +
      '<div id="trackSummaryText"></div>' +
      '<div class="track-sum-list">' + sorted.map(function(c){
        return '<div class="track-item"><div class="track-item-head"><span class="track-item-time">' + trackTimeStr(c.time) + '</span></div>' +
          '<div class="track-item-place">📍 ' + escHtml(c.place) + '</div>' +
          (c.text ? '<div class="track-item-text">' + escHtml(c.text) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }
  el.innerHTML = html;

  if (inYear.length > 0) {
    ensureAmap().then(function(ok) {
      const mapEl = document.getElementById('trackSumMap');
      if (!mapEl) return;
      if (!ok) { mapEl.innerHTML = '<div class="track-map-empty">🗺️ 未配置高德 key，去设置页填一下</div>'; return; }
      mapEl.innerHTML = '';
      const map = trackNewMap(mapEl, { zoom: 11, resizeEnable: true });
      if (!map) return;
      const ms = sorted.map(function(c) {
        return new AMap.Marker({ position: [c.lng, c.lat], content: '<div class="track-marker sm">📍</div>' });
      });
      map.add(ms);
      if (sorted.length > 1) {
        map.add(new AMap.Polyline({
          path: sorted.map(function(c){ return [c.lng, c.lat]; }),
          strokeColor: '#667eea', strokeWeight: 4, strokeOpacity: 0.7, lineJoin: 'round'
        }));
      }
      map.setFitView(ms, false, [50, 50, 50, 50]);
    });
  }
}

async function genTrackSummary() {
  const el = document.getElementById('trackSummaryText');
  const year = trackSummaryYear;
  const inYear = trackChecks.filter(function(c){ return new Date(c.time).getFullYear() === year; })
    .sort(function(a,b){ return a.time - b.time; });
  if (!inYear.length || !el) return;
  const ci = trackCharInfo();
  el.innerHTML = '<div class="track-loading">🤖 ' + escHtml(ci.name) + ' 正在翻你这一年的轨迹…</div>';
  const list = inYear.map(function(c, i) {
    const d = new Date(c.time);
    return (i+1) + '. ' + (d.getMonth()+1) + '月' + d.getDate() + '日 · ' + c.place;
  }).join('\n');
  const text = await trackAiYearSummary(year, list);
  el.innerHTML = '<div class="track-summary-text">' + escHtml(text) + '</div>';
}

/* ---------- 设置：高德 key ---------- */
function loadAmapSettings() {
  const k = document.getElementById('amapJsKey'); if (k) k.value = amapCfg.jsKey || '';
  const c = document.getElementById('amapJsCode'); if (c) c.value = amapCfg.jsCode || '';
  const w = document.getElementById('amapWebKey'); if (w) w.value = amapCfg.webKey || '';
}
function saveAmapConfig() {
  const k = document.getElementById('amapJsKey');
  if (!k) return;
  const c = document.getElementById('amapJsCode');
  const w = document.getElementById('amapWebKey');
  amapCfg.jsKey = k.value.trim();
  amapCfg.jsCode = c ? c.value.trim() : '';
  amapCfg.webKey = w ? w.value.trim() : '';
  lsSet('amapCfg', amapCfg);
  trackToast('✅ 高德地图配置已保存');
}

/* ---------- 初始化：?nfc=1 自动打卡 ---------- */
function initTrack() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('nfc') !== null) {
      setTimeout(startNfcCheckin, 900);
    }
  } catch(e) {}
}
