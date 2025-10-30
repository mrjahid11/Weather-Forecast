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

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
