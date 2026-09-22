/* ==================== 4.5 天气 API ==================== */
let weatherData = lsGet('weather', null);
let weatherLatLon = lsGet('weatherGeo', null);
let weatherCity = lsGet('weatherCity', '');
let weatherLongPressTimer = null;

if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
  AbortSignal.timeout = function(ms) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  };
}

const WEATHER_CODES = {
  0:['晴','☀️'],1:['晴','🌤'],2:['多云','⛅'],3:['阴天','☁️'],
  45:['雾','🌫'],48:['雾凇','🌫'],
  51:['小毛毛雨','🌦'],53:['毛毛雨','🌦'],55:['大毛毛雨','🌦'],
  56:['冻毛毛雨','🌧'],57:['冻毛毛雨','🌧'],
  61:['小雨','🌧'],63:['中雨','🌧'],65:['大雨','🌧'],
  66:['冻雨','🌧'],67:['冻雨','🌧'],
  71:['小雪','🌨'],73:['中雪','🌨'],75:['大雪','🌨'],
  77:['冰粒','🌨'],
  80:['阵雨','🌦'],81:['中阵雨','🌦'],82:['大阵雨','🌧'],
  85:['阵雪','🌨'],86:['大阵雪','🌨'],
  95:['雷暴','⛈'],96:['雷暴+冰雹','⛈'],99:['强雷暴+冰雹','⛈']
};

function getWeatherInfo(code) {
  return WEATHER_CODES[code] || ['未知','🌡'];
}

function onWeatherCardClick() {
  if (weatherCity) {
    fetchWeather();
  } else {
    showWeatherCityInput();
  }
}

function showWeatherCityInput() {
  const city = prompt('请输入城市名（如：北京、上海、广州）', weatherCity || '');
  if (city === null) return;
  if (city.trim()) {
    weatherCity = city.trim();
    lsSet('weatherCity', weatherCity);
    weatherLatLon = null;
    lsSet('weatherGeo', null);
  }
  fetchWeather();
}

async function fetchWeather() {
  const tempEl = document.getElementById('weatherTemp');
  const descEl = document.getElementById('weatherDesc');
  const detailEl = document.getElementById('weatherDetail');
  const iconEl = document.getElementById('weatherIcon');

  if (weatherData) {
    tempEl.textContent = weatherData.temp + '°';
    descEl.textContent = weatherData.desc + (weatherCity ? ` · ${weatherCity}` : '');
    detailEl.textContent = `💧${weatherData.humidity}%  💨${weatherData.windSpeed}km/h`;
    iconEl.textContent = weatherData.emoji;
  } else {
    tempEl.textContent = '--°';
    descEl.textContent = '获取中...';
    detailEl.textContent = '';
  }

  try {
    let lat, lon;

    if (weatherCity) {
      try {
        const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(weatherCity)}&count=1&language=zh`, { signal: AbortSignal.timeout(6000) });
        if (geoResp.ok) {
          const geoData = await geoResp.json();
          if (geoData.results && geoData.results.length > 0) {
            lat = geoData.results[0].latitude;
            lon = geoData.results[0].longitude;
            weatherLatLon = { lat, lon };
            lsSet('weatherGeo', weatherLatLon);
          }
        }
      } catch(e) { console.log('[天气] geocoding失败:', e.message); }
    }

    if (!lat && weatherLatLon && weatherLatLon.lat) {
      lat = weatherLatLon.lat;
      lon = weatherLatLon.lon;
    }

    // 方案A: wttr.in
    if (weatherCity) {
      descEl.textContent = '获取天气...';
      try {
        const url = `https://wttr.in/${encodeURIComponent(weatherCity)}?format=j1`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data.current_condition && data.current_condition[0]) {
            const cur = data.current_condition[0];
            const temp = parseInt(cur.temp_C);
            const humidity = parseInt(cur.humidity);
            const windSpeed = parseInt(cur.windspeedKmph);
            const desc = cur.lang_zh && cur.lang_zh[0] ? cur.lang_zh[0].value : cur.weatherDesc[0].value;
            const emoji = desc.includes('雨') ? '🌧' : desc.includes('雪') ? '🌨' : desc.includes('阴') ? '☁️' : desc.includes('多云') ? '⛅' : '☀️';
            updateWeatherUI(tempEl, descEl, detailEl, iconEl, temp, humidity, windSpeed, 0, desc, emoji);
            return;
          }
        }
      } catch(e) { console.log('[天气] wttr.in失败:', e.message); }
    }

    // 方案B: Open-Meteo
    if (lat) {
      descEl.textContent = '获取天气...';
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto&forecast_days=1`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data.current) {
            const temp = Math.round(data.current.temperature_2m);
            const humidity = data.current.relative_humidity_2m;
            const windSpeed = Math.round(data.current.wind_speed_10m);
            const code = data.current.weather_code;
            const [desc, emoji] = getWeatherInfo(code);
            updateWeatherUI(tempEl, descEl, detailEl, iconEl, temp, humidity, windSpeed, code, desc, emoji);
            return;
          }
        }
      } catch(e) { console.log('[天气] Open-Meteo失败:', e.message); }
    }

    // 方案C: 中国天气网
    if (weatherCity) {
      const cityCode = getWeatherCityCode(weatherCity);
      if (cityCode) {
        try {
          const weatherResult = await fetchWeatherCn(cityCode);
          if (weatherResult) {
            updateWeatherUI(tempEl, descEl, detailEl, iconEl, weatherResult.temp, weatherResult.humidity, weatherResult.windSpeed, weatherResult.code, weatherResult.desc, weatherResult.emoji);
            return;
          }
        } catch(e) { console.log('[天气] weather.com.cn失败:', e.message); }
      }
    }

    throw new Error('无法获取天气');
  } catch(e) {
    if (weatherData && Date.now() - weatherData.time < 3600000) {
      tempEl.textContent = weatherData.temp + '°';
      descEl.textContent = weatherData.desc + (weatherCity ? ` · ${weatherCity}` : '');
      detailEl.textContent = `💧${weatherData.humidity}%  💨${weatherData.windSpeed}km/h`;
      iconEl.textContent = weatherData.emoji;
    } else {
      tempEl.textContent = '--°';
      descEl.textContent = '点击设置城市';
      detailEl.textContent = weatherCity ? '网络不可用，请稍后重试' : '点击输入城市名获取天气';
      iconEl.textContent = '🌡';
    }
  }
}

const WEATHER_CN_CODES = {
  '北京':101010100,'上海':101020100,'广州':101280101,'深圳':101280601,'杭州':101210101,
  '成都':101270101,'武汉':101200101,'南京':101190101,'重庆':101040100,'天津':101030100,
  '苏州':101190401,'西安':101110101,'长沙':101250101,'沈阳':101070101,'青岛':101120201,
  '郑州':101180101,'大连':101070201,'东莞':101281601,'宁波':101210401,'厦门':101230201,
  '福州':101230101,'哈尔滨':101050101,'长春':101060101,'昆明':101290101,'济南':101120101,
  '合肥':101220101,'佛山':101280800,'南昌':101240101,'贵阳':101260101,'南宁':101300101,
  '石家庄':101090101,'太原':101100101,'兰州':101160101,'海口':101310101,'呼和浩特':101080101,
  '乌鲁木齐':101130101,'银川':101170101,'西宁':101150101,'拉萨':101140101,'温州':101210701,
  '无锡':101190201,'常州':101191101,'徐州':101190301,'扬州':101190701,'珠海':101280701,
  '中山':101281701,'惠州':101280301,'烟台':101120501,'潍坊':101120601,'临沂':101120901,
  '嘉兴':101210301,'绍兴':101210501,'金华':101210901,'台州':101210201,'泉州':101230501,
  '漳州':101230601,'唐山':101090301,'秦皇岛':101091101,'保定':101090201,'邯郸':101090401,
  '洛阳':101180901,'南阳':101180701,'襄阳':101200201,'宜昌':101200901,'株洲':101250301,
  '岳阳':101250801,'常德':101250601,'桂林':101300501,'柳州':101300301,'三亚':101310201,
  '绵阳':101270401,'泸州':101271001,'遵义':101260301,'赣州':101240401,'九江':101240201,
};

function getWeatherCityCode(cityName) {
  if (WEATHER_CN_CODES[cityName]) return WEATHER_CN_CODES[cityName];
  const stripped = cityName.replace(/[省市县区]$/,'');
  if (WEATHER_CN_CODES[stripped]) return WEATHER_CN_CODES[stripped];
  return null;
}

async function fetchWeatherCn(cityCode) {
  try {
    const resp = await fetch(`https://www.weather.com.cn/weather/${cityCode}.html`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const html = await resp.text();
    // 简单解析
    const tempMatch = html.match(/<p class="tem">.*?<span>(.*?)<\/span><em>(.*?)℃/);
    if (!tempMatch) return null;
    const temp = parseInt(tempMatch[1] || tempMatch[2]);
    const weatherMatch = html.match(/<p class="wea">(.*?)<\/p>/);
    const desc = weatherMatch ? weatherMatch[1].trim() : '未知';
    const emoji = desc.includes('雨') ? '🌧' : desc.includes('雪') ? '🌨' : desc.includes('阴') ? '☁️' : desc.includes('多云') ? '⛅' : '☀️';
    return { temp, humidity: 0, windSpeed: 0, code: 0, desc, emoji };
  } catch(e) { return null; }
}

function updateWeatherUI(tempEl, descEl, detailEl, iconEl, temp, humidity, windSpeed, code, desc, emoji) {
  weatherData = { temp, humidity, windSpeed, code, desc, emoji, time: Date.now() };
  lsSet('weather', weatherData);
  tempEl.textContent = temp + '°';
  descEl.textContent = desc + (weatherCity ? ` · ${weatherCity}` : '');
  detailEl.textContent = `💧${humidity}%  💨${windSpeed}km/h`;
  iconEl.textContent = emoji;
}

/* ==================== 5. 图标网格 & 拖拽 ==================== */
let savedOrder = lsGet('iconOrder', null);
const allIds = ICONS.map(i=>i.id);
// 合并新图标（用户可能保存了旧顺序）
if (savedOrder) {
  allIds.forEach(id => { if (!savedOrder.includes(id)) savedOrder.push(id); });
  // 移除不存在的图标
  savedOrder = savedOrder.filter(id => allIds.includes(id));
}
let iconOrder = savedOrder || [...allIds];

function renderIcons() {
  const grid = document.getElementById('iconGrid1');
  if (!grid) return;
  grid.innerHTML = '';
  iconOrder.forEach((id, idx) => {
    const icon = ICONS.find(i => i.id === id);
    if (!icon) return;
    const el = document.createElement('div');
    el.className = 'app-item';
    el.draggable = true;
    el.dataset.iconId = id;
    el.dataset.idx = idx;
    el.innerHTML = `<div class="app-icon">${icon.symbol}</div><div class="app-name">${icon.name}</div>`;
    el.onclick = () => navigateTo(icon.page);

    el.ondragstart = e => { e.dataTransfer.setData('text/plain', idx); el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag-over'); };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = idx;
      if (fromIdx === toIdx) return;
      const moved = iconOrder.splice(fromIdx, 1)[0];
      iconOrder.splice(toIdx, 0, moved);
      lsSet('iconOrder', iconOrder);
      renderIcons();
    };

    grid.appendChild(el);
  });
}

/* ==================== 6. 倒数日 ==================== */
let cdData = lsGet('countdown', { event:'纪念日', date:'', bg:'' });

function updateCountdown() {
  document.getElementById('cdEvent').textContent = cdData.event || '未设置';
  document.getElementById('cdDate').textContent = cdData.date || '';
  if (cdData.bg) {
    const card = document.getElementById('countdownCard');
    card.style.backgroundImage = `url(${cdData.bg})`;
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  // 还没设日期时 new Date('') 是 Invalid Date，减出来是 NaN，卡片上就会写「NaN 天后」
  const target = cdData.date ? new Date(cdData.date) : null;
  if (!target || isNaN(target.getTime())) {
    document.getElementById('cdDays').textContent = '--';
    document.getElementById('cdUnit').textContent = '';
    cdData._isFuture = false;
    return;
  }
  const now = new Date();
  now.setHours(0,0,0,0);
  target.setHours(0,0,0,0);
  const diffDays = Math.ceil((now - target) / (1000*60*60*24));
  if (diffDays >= 0) {
    document.getElementById('cdDays').textContent = diffDays;
    document.getElementById('cdUnit').textContent = '天';
  } else {
    document.getElementById('cdDays').textContent = Math.abs(diffDays);
    document.getElementById('cdUnit').textContent = '天后';
  }
  cdData._isFuture = diffDays < 0;
}

function openCdEdit() {
  document.getElementById('cdEditEvent').value = cdData.event;
  document.getElementById('cdEditDate').value = cdData.date;
  document.getElementById('cdEditBg').value = cdData.bg || '';
  document.getElementById('cdEditModal').classList.add('show');
}
function closeCdEdit() { document.getElementById('cdEditModal').classList.remove('show'); }
function saveCdEdit() {
  cdData.event = document.getElementById('cdEditEvent').value.trim() || '纪念日';
  cdData.date = document.getElementById('cdEditDate').value || '';
  cdData.bg = document.getElementById('cdEditBg').value.trim();
  lsSet('countdown', cdData);
  updateCountdown();
  closeCdEdit();
}
