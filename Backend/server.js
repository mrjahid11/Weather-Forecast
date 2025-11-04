const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

// Simple in-memory cache for API responses (TTL in seconds)
const cache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 120 }); // 10 minute default TTL

const app = express();
app.use(express.json());

// Generate a lightweight mock forecast (used when upstream is unavailable).
function generateMockForecast(lat = 0, lon = 0) {
  const now = Date.now()
  const hours = 48
  const hourly = { time: [], temperature_2m: [], precipitation: [], weathercode: [], windspeed_10m: [] }
  for (let i = 0; i < hours; i++) {
    const ts = new Date(now + i * 60 * 60 * 1000)
    hourly.time.push(ts.toISOString())
    // simple diurnal temp oscillation
    const hour = ts.getHours()
    const base = 14 + (Math.sin((hour / 24) * Math.PI * 2) * 6)
    hourly.temperature_2m.push(Number((base + (Math.random() * 2 - 1)).toFixed(1)))
    // small random precipitation occasionally
    hourly.precipitation.push(Math.random() < 0.15 ? Number((Math.random() * 3).toFixed(1)) : 0)
    // map to simple weather codes: 0 clear day/night, 3 cloudy, 51 light rain, 95 thunder
    const wc = Math.random() < 0.05 ? 95 : (Math.random() < 0.1 ? 51 : (Math.random() < 0.2 ? 3 : 0))
    hourly.weathercode.push(wc)
    hourly.windspeed_10m.push(Math.round(5 + Math.random() * 15))
  }

  // daily for next 7 days
  const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [] }
  for (let d = 0; d < 7; d++) {
    const day = new Date(now + d * 24 * 60 * 60 * 1000)
    daily.time.push(day.toISOString().slice(0, 10))
    const highs = 18 + Math.round(Math.random() * 6)
    const lows = 8 + Math.round(Math.random() * 6)
    daily.temperature_2m_max.push(highs)
    daily.temperature_2m_min.push(lows)
  }

  // current weather based on first hourly
  const current = { time: hourly.time[0], temperature: hourly.temperature_2m[0], windspeed: hourly.windspeed_10m[0], is_day: (new Date(hourly.time[0]).getHours() >= 6 && new Date(hourly.time[0]).getHours() < 18) ? 1 : 0, weathercode: hourly.weathercode[0], interval: 900 }

  return { latitude: parseFloat(lat) || 0, longitude: parseFloat(lon) || 0, current_weather: current, hourly, daily }
}

// Serve frontend static files from /public (built React app will be copied here)
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter for API endpoints: limit to 60 requests per  minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Apply rate limit to the forecast API
app.use('/api/forecast', apiLimiter);
// Apply rate limit to air-quality API as well
app.use('/api/air-quality', apiLimiter);
// Apply rate limit to climate API as well
app.use('/api/climate', apiLimiter);

// Helper: fetch with simple timeout
async function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return resp;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Helper: fetch with retries and exponential backoff to handle transient upstream issues
async function fetchWithRetries(url, opts = {}, timeout = 10000, retries = 2, backoffBase = 300) {
  let attempt = 0
  let lastErr = null
  while (attempt <= retries) {
    try {
      const resp = await fetchWithTimeout(url, opts, timeout)
      // If upstream returns 5xx treat as retryable
      if (resp.ok || (resp.status < 500)) return resp
      lastErr = new Error(`Upstream responded ${resp.status}`)
    } catch (err) {
      lastErr = err
    }
    attempt++
    if (attempt > retries) break
    // exponential backoff with jitter
    const delay = Math.round(backoffBase * Math.pow(2, attempt - 1) * (0.75 + Math.random() * 0.5))
    await new Promise((r) => setTimeout(r, delay))
  }
  throw lastErr || new Error('fetchWithRetries: unknown error')
}

// API: /api/forecast?city=CityName
// Uses Nominatim (OpenStreetMap) to geocode the city name, then Open-Meteo for weather
app.get('/api/forecast', async (req, res) => {
  const city = (req.query.city || '').trim();
  if (!city) return res.status(400).json({ error: 'Missing city query parameter' });

  // Use lowercase city as cache key (could be expanded with coords or query options)
  const cacheKey = `forecast:${city.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  // Optionally force a generated mock forecast (development convenience)
  if (process.env.USE_MOCK === 'true') {
    const mock = generateMockForecast(0, 0)
    const payload = { location: city, lat: 0, lon: 0, forecast: mock }
    // Do NOT cache forced mock responses so they update each refresh during development
    return res.json({ ...payload, cached: false, mock: true })
  }

  try {
    // Nominatim geocoding
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
  // Nominatim is a public service with rate limits; use retries with a slightly longer timeout
  const nomResp = await fetchWithRetries(nominatimUrl, { headers: { 'User-Agent': 'weather-app-example' } }, 10000, 2).catch((e) => { throw e });
  if (!nomResp.ok) throw new Error(`Nominatim failed: ${nomResp.status}`);
  const places = await nomResp.json();
    if (!places || places.length === 0) return res.status(404).json({ error: 'Location not found' });
    const { lat, lon, display_name } = places[0];

  // Open-Meteo forecast: include hourly variables so frontend can render a 24-hour view
  // Request hourly temperature, precipitation, weathercode and windspeed in addition to daily summaries
  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation,weathercode,windspeed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    // Use retries and a slightly longer timeout for the forecast request to reduce transient 504s
    let metData = null
    try {
      const metResp = await fetchWithRetries(meteoUrl, {}, 15000, 2)
      if (!metResp.ok) throw new Error(`Open-Meteo failed: ${metResp.status}`)
      metData = await metResp.json()
    } catch (err) {
      console.warn('Open-Meteo forecast failed, attempting lightweight fallback:', err && err.message)
      // Fallback: try a lightweight request asking only for current weather (smaller, faster)
      try {
        const lightweightUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
        const lwResp = await fetchWithRetries(lightweightUrl, {}, 8000, 1)
        if (lwResp.ok) {
          const lw = await lwResp.json()
          // Create a minimal shape with current_weather so frontend can at least show current
          metData = { latitude: lw.latitude, longitude: lw.longitude, current_weather: lw.current_weather }
        } else {
          throw new Error(`Lightweight Open-Meteo failed: ${lwResp.status}`)
        }
      } catch (err2) {
        // If fallback also fails, generate a local mock forecast so the app remains usable
        console.warn('Both full and lightweight Open-Meteo requests failed; returning generated mock forecast:', err2 && err2.message)
        metData = generateMockForecast(lat, lon)
        // Do not cache generated mock forecasts — keep them ephemeral so they change on refresh
        const payload = { location: display_name || city, lat, lon, forecast: metData }
        return res.json({ ...payload, cached: false, mock: true })
      }
    }

    const payload = { location: display_name, lat, lon, forecast: metData };
    // Store in cache
    cache.set(cacheKey, payload);

    return res.json({ ...payload, cached: false });
  } catch (err) {
    console.error(err);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timed out' });
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// API: /api/air-quality?lat=...&lon=...
// Uses Open-Meteo's Air Quality API (no API key required)
app.get('/api/air-quality', async (req, res) => {
  const lat = req.query.lat || req.query.latitude
  const lon = req.query.lon || req.query.longitude
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat and/or lon query parameters' })

  const cacheKey = `aq:${lat}:${lon}`
  const cached = cache.get(cacheKey)
  if (cached) return res.json({ ...cached, cached: true })

  try {
    // Request common pollutant concentrations (hourly); timezone=auto returns timestamps in local tz
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto`;
    const resp = await fetchWithTimeout(aqUrl, {}, 8000);
    if (!resp.ok) throw new Error(`AirQuality API failed: ${resp.status}`)
    const aqData = await resp.json()

    // Simplify: pick the latest non-null hour sample from hourly data
    const hourly = aqData.hourly || {}
    const times = hourly.time || []
    let latestIdx = -1
    for (let i = times.length - 1; i >= 0; i--) {
      // Check at least one pollutant exists for this hour
      if ((hourly.pm2_5 && hourly.pm2_5[i] != null) || (hourly.pm10 && hourly.pm10[i] != null)) { latestIdx = i; break }
    }

    const sample = latestIdx >= 0 ? {
      time: times[latestIdx],
      pm2_5: hourly.pm2_5 ? hourly.pm2_5[latestIdx] : null,
      pm10: hourly.pm10 ? hourly.pm10[latestIdx] : null,
      co: hourly.carbon_monoxide ? hourly.carbon_monoxide[latestIdx] : null,
      no2: hourly.nitrogen_dioxide ? hourly.nitrogen_dioxide[latestIdx] : null,
      so2: hourly.sulphur_dioxide ? hourly.sulphur_dioxide[latestIdx] : null,
      o3: hourly.ozone ? hourly.ozone[latestIdx] : null,
    } : null

    // Basic PM2.5 -> qualitative category (simple mapping)
    function pm25Category(v) {
      if (v == null) return { idx: 0, label: 'unknown' }
      if (v <= 12.0) return { idx: 1, label: 'Good' }
      if (v <= 35.4) return { idx: 2, label: 'Moderate' }
      if (v <= 55.4) return { idx: 3, label: 'Unhealthy for Sensitive Groups' }
      if (v <= 150.4) return { idx: 4, label: 'Unhealthy' }
      if (v <= 250.4) return { idx: 5, label: 'Very Unhealthy' }
      return { idx: 6, label: 'Hazardous' }
    }

    const category = sample ? pm25Category(sample.pm2_5) : { idx: 0, label: 'unknown' }

    const payload = { lat, lon, sample, category, source: 'open-meteo' }
    cache.set(cacheKey, payload, 60 * 5) // cache 5 minutes

    return res.json({ ...payload, cached: false })
  } catch (err) {
    console.error(err)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Upstream timed out' })
    return res.status(500).json({ error: 'Internal server error', details: err.message })
  }
})

// API: /api/climate?lat=...&lon=...&years=30
// Uses Open-Meteo Climate API to fetch daily mean temperature for the requested period,
// computes annual averages and a linear trend (°C/decade) and recent anomaly vs baseline.
app.get('/api/climate', async (req, res) => {
  const lat = req.query.lat || req.query.latitude
  const lon = req.query.lon || req.query.longitude
  const years = parseInt(req.query.years || '30', 10) || 30
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat and/or lon query parameters' })

  // Limit years to a reasonable range to avoid huge requests
  const clampYears = Math.min(Math.max(years, 10), 100)

  // Compute date range: start on January 1 (years ago) to today
  const now = new Date()
  const endDate = now.toISOString().slice(0, 10)
  const startYear = now.getUTCFullYear() - clampYears + 1
  const startDate = `${startYear}-01-01`

  const cacheKey = `climate:${lat}:${lon}:${clampYears}`
  const cached = cache.get(cacheKey)
  if (cached) return res.json({ ...cached, cached: true })

  try {
    const apiUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_mean&timezone=UTC`;
    const resp = await fetchWithTimeout(apiUrl, {}, 15000);
    if (!resp.ok) throw new Error(`Climate API failed: ${resp.status}`)
    const json = await resp.json()

    const daily = (json.daily && json.daily.time && json.daily.temperature_2m_mean) ? json.daily : null
    if (!daily) return res.status(502).json({ error: 'Climate data unavailable from upstream' })

    // Aggregate daily -> annual mean
    const time = daily.time || []
    const vals = daily.temperature_2m_mean || []
    const yearsMap = {} // year -> { sum, count }
    for (let i = 0; i < time.length; i++) {
      const t = time[i]
      const v = vals[i]
      if (v == null) continue
      const y = parseInt(t.slice(0, 4), 10)
      if (!yearsMap[y]) yearsMap[y] = { sum: 0, count: 0 }
      yearsMap[y].sum += v
      yearsMap[y].count += 1
    }

    const yearsArr = Object.keys(yearsMap).map((y) => parseInt(y, 10)).sort((a, b) => a - b)
    const annual = yearsArr.map((y) => {
      const s = yearsMap[y]
      return { year: y, mean: s.count ? s.sum / s.count : null }
    }).filter((r) => r.mean != null)

    if (annual.length < 5) return res.status(502).json({ error: 'Insufficient climate data returned' })

    // Compute linear trend (°C per year) via least squares on (year, mean)
    const n = annual.length
    const x = annual.map((r) => r.year)
    const y = annual.map((r) => r.mean)
    const xMean = x.reduce((a, b) => a + b, 0) / n
    const yMean = y.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (x[i] - xMean) * (y[i] - yMean)
      den += (x[i] - xMean) * (x[i] - xMean)
    }
    const slopePerYear = den === 0 ? 0 : num / den
    const slopePerDecade = slopePerYear * 10

    // Baseline: 1991-2020 (common climatological baseline). Compute baseline mean if available
    const baselineStart = 1991
    const baselineEnd = 2020
    const baselineVals = annual.filter((r) => r.year >= baselineStart && r.year <= baselineEnd).map((r) => r.mean)
    const baselineMean = baselineVals.length ? (baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length) : null

    // Recent anomaly: mean of last 5 years vs baseline
    const recentYears = 5
    const recentSlice = annual.slice(-recentYears).map((r) => r.mean)
    const recentMean = recentSlice.length ? (recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length) : null
    const recentAnomaly = (baselineMean != null && recentMean != null) ? (recentMean - baselineMean) : null

    const payload = {
      latitude: json.latitude || parseFloat(lat),
      longitude: json.longitude || parseFloat(lon),
      start_date: startDate,
      end_date: endDate,
      years: clampYears,
      annual,
      trend: { per_year: slopePerYear, per_decade: slopePerDecade },
      baseline: { period: `${baselineStart}-${baselineEnd}`, mean: baselineMean },
      recent: { years: recentYears, mean: recentMean, anomaly: recentAnomaly },
      source: 'open-meteo-climate'
    }

    cache.set(cacheKey, payload, 60 * 60 * 24) // cache 1 day
    return res.json({ ...payload, cached: false })
  } catch (err) {
    console.error(err)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Upstream timed out' })
    return res.status(500).json({ error: 'Internal server error', details: err.message })
  }
})

// API: /api/marine?lat=...&lon=...&forecast_minutely_15=96&past_minutely_15=0
// Provides marine-related variables and a 15-minute resampled series when requested.
app.get('/api/marine', async (req, res) => {
  const lat = parseFloat(req.query.lat || req.query.latitude)
  const lon = parseFloat(req.query.lon || req.query.longitude)
  console.log('Incoming /api/marine request', { lat: req.query.lat, lon: req.query.lon, qs: req.query })
  if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ error: 'Missing or invalid lat/lon' })

  // Number of 15-min steps forward/back. Defaults: forecast 96 (24h), past 0
  const forecastSteps = Math.max(0, parseInt(req.query.forecast_minutely_15 || '96', 10))
  const pastSteps = Math.max(0, parseInt(req.query.past_minutely_15 || '0', 10))

  const cacheKey = `marine:${lat}:${lon}:${forecastSteps}:${pastSteps}`
  const cached = cache.get(cacheKey)
  if (cached) return res.json({ ...cached, cached: true })

  // Rough region checks for native minutely-15 availability (approx)
  function inSupportedRegion(lat, lon) {
    // North America bounding box (approx): lat 15..75, lon -170..-50
    if (lat >= 15 && lat <= 75 && lon >= -170 && lon <= -50) return true
    // Central Europe approx: lat 35..70, lon -10..40
    if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 40) return true
    return false
  }

  try {
    // Request upstream hourly marine/sea variables via Open-Meteo's forecast API (common public endpoint)
    // We'll ask for hourly wave height and wind variables. If minutely data is available from upstream, we'll use/aggregate it.
  const hourlyParams = ['wave_height','windspeed_10m','winddirection_10m','shortwave_radiation','significant_wave_period','swell_height']
    let apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=${hourlyParams.join(',')}&timezone=auto`;
    let resp = await fetchWithTimeout(apiUrl, {}, 12000).catch((e) => { throw e })
    // If upstream rejected the full list (400), retry with a smaller, safer set of hourly variables
    if (!resp.ok) {
      console.warn('Upstream returned', resp.status, 'for marine hourly params, retrying with safe set')
      const safeParams = ['windspeed_10m','winddirection_10m','shortwave_radiation']
      apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=${safeParams.join(',')}&timezone=auto`;
      resp = await fetchWithTimeout(apiUrl, {}, 12000)
      if (!resp.ok) throw new Error(`Upstream failed: ${resp.status}`)
    }
    const json = await resp.json()

    // Prepare time series: prefer upstream minutely if present and we're in supported region
    const hasMinutely = json.minutely && Object.keys(json.minutely).length > 0
    const wantMinutely15 = (forecastSteps + pastSteps) > 0
    let series15 = null

    if (hasMinutely && inSupportedRegion(lat, lon)) {
      // If upstream provided minute-level data, aggregate into 15-min bins
      const minutely = json.minutely
      // Build time -> values mapping for each variable we care about (e.g., shortwave_radiation)
      const minTimes = minutely.time || []
      const stepMs = 15 * 60 * 1000
  series15 = { time: [], shortwave_radiation: [], wave_height: [], windspeed_10m: [], significant_wave_period: [], swell_height: [] }
      // Determine central window: pastSteps back and forecastSteps forward from now
      const now = Date.now()
      const startTs = now - (pastSteps * stepMs)
      const endTs = now + (forecastSteps * stepMs)

      // Convert minutely times to timestamps and group into 15-min buckets
      const buckets = {}
      for (let i = 0; i < minTimes.length; i++) {
        const t = new Date(minTimes[i]).getTime()
        if (t < startTs || t > endTs) continue
        const bucket = Math.floor(t / stepMs) * stepMs
        if (!buckets[bucket]) buckets[bucket] = { sum: 0, count: 0 }
        const val = (minutely.shortwave_radiation && minutely.shortwave_radiation[i] != null) ? Number(minutely.shortwave_radiation[i]) : 0
        buckets[bucket].sum += val
        buckets[bucket].count += 1
      }
      const keys = Object.keys(buckets).map(k => parseInt(k, 10)).sort((a,b) => a-b)
      for (const k of keys) {
        series15.time.push(new Date(k).toISOString())
        const b = buckets[k]
        series15.shortwave_radiation.push(b.count ? (b.sum / b.count) : null)
      }
    }

    // If upstream minutely isn't available or we're outside supported regions, fall back to hourly -> interpolate to 15-min
    if (!series15 && wantMinutely15) {
      const hourly = json.hourly || {}
      const times = hourly.time || []
      const wh = hourly.wave_height || []
      const ws = hourly.windspeed_10m || []
      const sw = hourly.shortwave_radiation || []
      const swp = hourly.significant_wave_period || []
      const swell = hourly.swell_height || []
      // Build arrays of {ts, val}
      const points = times.map((t, i) => ({
        ts: new Date(t).getTime(),
        wave: wh[i] != null ? Number(wh[i]) : null,
        wind: ws[i] != null ? Number(ws[i]) : null,
        sw: sw[i] != null ? Number(sw[i]) : null,
        period: swp[i] != null ? Number(swp[i]) : null,
        swell: swell[i] != null ? Number(swell[i]) : null,
      }))

      // Interpolate function for a numeric series
      function interp(ts) {
        // find surrounding points
        if (points.length === 0) return { wave: null, wind: null, sw: null }
        if (ts <= points[0].ts) return { wave: points[0].wave, wind: points[0].wind, sw: points[0].sw }
        if (ts >= points[points.length-1].ts) return { wave: points[points.length-1].wave, wind: points[points.length-1].wind, sw: points[points.length-1].sw }
        // find i where points[i].ts <= ts <= points[i+1].ts
        let i = 0
        while (i < points.length - 1 && points[i+1].ts < ts) i++
        const a = points[i]
        const b = points[i+1]
        if (!a || !b || a.ts === b.ts) return { wave: a.wave, wind: a.wind, sw: a.sw }
        const frac = (ts - a.ts) / (b.ts - a.ts)
        const mix = (aVal, bVal) => (aVal == null || bVal == null) ? (aVal != null ? aVal : bVal) : (aVal + (bVal - aVal) * frac)
        return { wave: mix(a.wave, b.wave), wind: mix(a.wind, b.wind), sw: mix(a.sw, b.sw) }
      }

      const stepMs = 15 * 60 * 1000
      const now = Date.now()
      const startTs = now - (pastSteps * stepMs)
      const endTs = now + (forecastSteps * stepMs)
  series15 = { time: [], wave_height: [], windspeed_10m: [], shortwave_radiation: [], significant_wave_period: [], swell_height: [] }
      for (let ts = startTs; ts <= endTs; ts += stepMs) {
        const v = interp(ts)
        series15.time.push(new Date(ts).toISOString())
        series15.wave_height.push(v.wave)
        series15.windspeed_10m.push(v.wind)
        series15.shortwave_radiation.push(v.sw)
        series15.significant_wave_period.push(v.period)
        series15.swell_height.push(v.swell)
      }
    }

    const payload = {
      latitude: json.latitude || lat,
      longitude: json.longitude || lon,
      source: json,
      series15
    }

    // Cache for short time
    cache.set(cacheKey, payload, 60 * 5)
    return res.json({ ...payload, cached: false })
  } catch (err) {
    console.error('Marine proxy error', err)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Upstream timed out' })
    return res.status(500).json({ error: 'Internal server error', details: err.message })
  }
})

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
