const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

// Simple in-memory cache for API responses (TTL in seconds)
const cache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 120 }); // 10 minute default TTL

const app = express();
app.use(express.json());

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

  try {
    // Nominatim geocoding
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const nomResp = await fetchWithTimeout(nominatimUrl, { headers: { 'User-Agent': 'weather-app-example' } }, 8000);
    if (!nomResp.ok) throw new Error(`Nominatim failed: ${nomResp.status}`);
    const places = await nomResp.json();
    if (!places || places.length === 0) return res.status(404).json({ error: 'Location not found' });
    const { lat, lon, display_name } = places[0];

    // Open-Meteo forecast
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const metResp = await fetchWithTimeout(meteoUrl, {}, 8000);
    if (!metResp.ok) throw new Error(`Open-Meteo failed: ${metResp.status}`);
    const metData = await metResp.json();

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

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
