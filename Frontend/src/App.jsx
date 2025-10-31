import React, { useState, useMemo, useEffect } from 'react'
import MarinePanel from './MarinePanel'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

// Marine chart is implemented in the extracted MarinePanel component (Frontend/src/MarinePanel.jsx)

// Small mapping from Open-Meteo weather codes to emoji/icons.
function mapWeatherCodeToEmoji(code) {
  if (code === 0) return '☀️'
  if (code === 1 || code === 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code >= 45 && code <= 48) return '🌫️'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return '🌨️'
  if (code >= 95 && code <= 99) return '⛈️'
  return 'ℹ️'
}

function cToF(v) {
  return Math.round((v * 9) / 5 + 32)
}

export default function App() {
  const [city, setCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [airQuality, setAirQuality] = useState(null)
  const [aqLoading, setAqLoading] = useState(false)
  const [aqError, setAqError] = useState(null)
  const [climate, setClimate] = useState(null)
  const [climateLoading, setClimateLoading] = useState(false)
  const [climateError, setClimateError] = useState(null)
  
  const [unit, setUnit] = useState('C') // 'C' or 'F'
  const [theme, setTheme] = useState('default') // default | sunny-day | night | rain | storm | cloudy | snow | fog
  const [themeMode, setThemeMode] = useState('auto') // auto | light | dark
  const [motionPref, setMotionPref] = useState('auto') // auto | calm
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [climateOpen, setClimateOpen] = useState(false)

  // Moon phase approximation + waxing/waning. Returns { kind: 'full'|'half'|'other', age: number (0-29), waxing: boolean }
  function getMoonPhaseDetails(dateStr) {
    try {
      const d = dateStr ? new Date(dateStr) : new Date()
      // Conway's approximation
      let r = d.getUTCFullYear() % 100
      r %= 19
      if (r > 9) r -= 19
      r = ((r * 11) % 30) + d.getUTCMonth() + 1 + d.getUTCDate()
      if (d.getUTCMonth() < 2) r += 2
      const phase = (r < 0 ? r + 30 : r) % 30 // 0=new, 15=full approx
      // Map 0=new, ~15=full, ~7/22=quarters
      const kind = Math.abs(phase - 15) <= 2 ? 'full'
        : (Math.abs(phase - 7) <= 2 || Math.abs(phase - 22) <= 2) ? 'half'
        : 'other'
      // Waxing if age < 15 (increasing illumination), waning if > 15
      const waxing = phase < 15
      return { kind, age: phase, waxing }
    } catch {
      return { kind: 'other', age: 0, waxing: false }
    }
  }

  // Load saved preferences once
  useEffect(() => {
    try {
      const storedUnit = localStorage.getItem('pref.unit')
      const storedThemeMode = localStorage.getItem('pref.themeMode')
      const storedMotion = localStorage.getItem('pref.motion')
      if (storedUnit === 'C' || storedUnit === 'F') setUnit(storedUnit)
      if (storedThemeMode === 'auto' || storedThemeMode === 'light' || storedThemeMode === 'dark') setThemeMode(storedThemeMode)
      if (storedMotion === 'auto' || storedMotion === 'calm') setMotionPref(storedMotion)
    } catch {}
  }, [])

  // Persist preferences
  useEffect(() => {
    try { localStorage.setItem('pref.unit', unit) } catch {}
  }, [unit])
  useEffect(() => {
    try { localStorage.setItem('pref.themeMode', themeMode) } catch {}
  }, [themeMode])
  useEffect(() => {
    try { localStorage.setItem('pref.motion', motionPref) } catch {}
  }, [motionPref])

  async function submit(e) {
    e.preventDefault()
    if (!city.trim()) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const resp = await fetch(`/api/forecast?city=${encodeURIComponent(city)}`)
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || `Request failed: ${resp.status}`)
      }
      const json = await resp.json()
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Decide theme based on weather code and day/night flag
  useEffect(() => {
    if (!data || !data.forecast) {
      // When no data, preserve any existing theme, but still enforce chosen light/dark mode
      document.body.classList.remove('mode-dark','mode-light')
      if (themeMode === 'auto') {
        const darkish = document.body.classList.contains('theme-night') || document.body.classList.contains('theme-storm') || document.body.classList.contains('theme-rain')
        document.body.classList.add(darkish ? 'mode-dark' : 'mode-light')
      } else {
        document.body.classList.add(themeMode === 'dark' ? 'mode-dark' : 'mode-light')
      }
      // Apply motion preference even without data
      const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const reduce = motionPref === 'calm' || (motionPref === 'auto' && prefersReduced)
      document.body.classList.toggle('reduce-motion', !!reduce)
      document.body.classList.toggle('motion-calm', !!reduce)
      return
    }
    const cw = data.forecast.current_weather || {}
    const isDay = cw.is_day === 1 || (cw.time ? new Date(cw.time).getHours() >= 6 && new Date(cw.time).getHours() < 18 : true)
    const code = cw.weathercode ?? 0

    let t = 'sunny-day'
    if (code === 0) t = isDay ? 'sunny-day' : 'night'
    else if ([1,2,3].includes(code)) t = isDay ? 'cloudy' : 'night'
    else if ((code >= 45 && code <= 48)) t = 'fog'
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) t = 'rain'
    else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) t = 'snow'
    else if (code >= 95 && code <= 99) t = 'storm'

    setTheme(t)

    const classes = ['theme-sunny-day','theme-night','theme-rain','theme-storm','theme-cloudy','theme-snow','theme-fog']
    document.body.classList.remove(...classes)
    document.body.classList.add(`theme-${t}`)

    // light/dark mode: auto from theme or explicit
    document.body.classList.remove('mode-dark','mode-light')
    if (themeMode === 'auto') {
      const darkish = t === 'night' || t === 'storm' || t === 'rain'
      document.body.classList.add(darkish ? 'mode-dark' : 'mode-light')
    } else {
      document.body.classList.add(themeMode === 'dark' ? 'mode-dark' : 'mode-light')
    }
    // reduce motion handling
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const reduce = motionPref === 'calm' || (motionPref === 'auto' && prefersReduced)
    document.body.classList.toggle('reduce-motion', !!reduce)
    document.body.classList.toggle('motion-calm', !!reduce)
  }, [data, themeMode, motionPref])

  // Fetch air quality when we have coordinates from the forecast response
  useEffect(() => {
    async function fetchAQ() {
      setAqError(null)
      setAirQuality(null)
      if (!data || !data.lat || !data.lon) return
      setAqLoading(true)
      try {
        const resp = await fetch(`/api/air-quality?lat=${encodeURIComponent(data.lat)}&lon=${encodeURIComponent(data.lon)}`)
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}))
          throw new Error(e.error || `AQ request failed: ${resp.status}`)
        }
        const json = await resp.json()
        setAirQuality(json)
      } catch (err) {
        setAqError(err.message)
      } finally {
        setAqLoading(false)
      }
    }
    fetchAQ()
  }, [data])

  // Fetch climate trend when we have coordinates
  useEffect(() => {
    async function fetchClimate() {
      setClimateError(null)
      setClimate(null)
      if (!data || !data.lat || !data.lon) return
      setClimateLoading(true)
      try {
        const resp = await fetch(`/api/climate?lat=${encodeURIComponent(data.lat)}&lon=${encodeURIComponent(data.lon)}&years=30`)
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}))
          throw new Error(e.error || `Climate request failed: ${resp.status}`)
        }
        const json = await resp.json()
        setClimate(json)
      } catch (err) {
        setClimateError(err.message)
      } finally {
        setClimateLoading(false)
      }
    }
    fetchClimate()
  }, [data])

  

  const climateChart = useMemo(() => {
    if (!climate || !climate.annual) return null
    const labels = climate.annual.map((r) => String(r.year))
    const dataVals = climate.annual.map((r) => Number(r.mean.toFixed(3)))
    return {
      labels,
      datasets: [
        {
          label: 'Annual mean °C',
          data: dataVals,
          borderColor: 'rgba(255, 159, 64, 0.9)',
          backgroundColor: 'rgba(255, 159, 64, 0.12)',
          tension: 0.2,
          pointRadius: 2,
        },
      ],
    }
  }, [climate])

  const climateChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      x: { display: true, title: { display: false } },
      y: { display: true, title: { display: true, text: '°C' } }
    }
  }), [])

  const chartData = useMemo(() => {
    if (!data || !data.forecast || !data.forecast.daily) return null
    const daily = data.forecast.daily
    const labels = daily.time

    const rawMin = daily.temperature_2m_min || []
    const rawMax = daily.temperature_2m_max || []
    const min = rawMin.map((v) => (unit === 'C' ? v : cToF(v)))
    const max = rawMax.map((v) => (unit === 'C' ? v : cToF(v)))

    const today = new Date().toISOString().slice(0, 10)
    const todayIndex = labels.indexOf(today)
    const len = labels.length

    const makePointRadius = (highlightIndex) =>
      Array.from({ length: len }).map((_, i) => (i === highlightIndex ? 6 : 3))

    return {
      labels,
      datasets: [
        {
          label: `Min °${unit}`,
          data: min,
          borderColor: 'rgba(54, 162, 235, 0.95)',
          backgroundColor: 'rgba(54, 162, 235, 0.12)',
          tension: 0.3,
          pointRadius: makePointRadius(todayIndex),
          fill: '+1',
        },
        {
          label: `Max °${unit}`,
          data: max,
          borderColor: 'rgba(255, 99, 132, 0.95)',
          backgroundColor: 'rgba(255, 99, 132, 0.12)',
          tension: 0.3,
          pointRadius: makePointRadius(todayIndex),
          fill: false,
        },
      ],
    }
  }, [data, unit])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: '7-day min/max forecast' },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y}°${unit}`,
          afterLabel: (context) => {
            const idx = context.dataIndex
            if (!data || !data.forecast) return ''
            const daily = data.forecast.daily
            const date = daily.time[idx]
            const extras = []
            if (data.forecast.current_weather && data.forecast.current_weather.time.startsWith(date)) {
              const t = data.forecast.current_weather.temperature
              extras.push(`Current: ${unit === 'C' ? Math.round(t) : cToF(t)}°${unit}`)
              extras.push(`Wind: ${data.forecast.current_weather.windspeed} km/h`)
              extras.push(`Code: ${data.forecast.current_weather.weathercode}`)
            }
            return extras.join('\n')
          },
        },
      },
    },
    scales: {
      x: { display: true, title: { display: false } },
      y: { display: true, title: { display: true, text: `°${unit}` } },
    },
    animation: (() => {
      let prefersReduced = false
      try {
        prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {}
      const isCalm = motionPref === 'calm' || prefersReduced
      return isCalm ? { duration: 0 } : { duration: 1200, easing: 'easeOutQuart' }
    })(),
    transitions: {
      active: {
        animation: { duration: 200 }
      }
    },
  }), [unit, data, motionPref])

  const renderAmbient = () => {
    if (theme === 'sunny-day' || theme === 'cloudy') {
      return (
        <>
          {/* Sun for sunny or partially cloudy day */}
          {theme === 'sunny-day' && <div className="ambient-layer sun" aria-hidden></div>}
          <div className="ambient-layer clouds" aria-hidden>
            <span></span><span></span><span></span><span></span>
          </div>

          {/* Marine UI moved to Frontend/src/MarinePanel.jsx */}
        </>
      )
    }
    if (theme === 'night') {
      const code = data?.forecast?.current_weather?.weathercode ?? 0
      const cloudy = [1,2,3].includes(code)
      const phaseInfo = getMoonPhaseDetails(data?.forecast?.current_weather?.time)
      const phase = phaseInfo.kind
      // Hemisphere from geocoded latitude; default north if missing
      const lat = parseFloat(data?.lat ?? data?.forecast?.latitude ?? 0)
      const northern = isNaN(lat) ? true : (lat >= 0)
      // For half moon, determine which side is lit
      const rightLit = phase === 'half' ? (northern ? phaseInfo.waxing : !phaseInfo.waxing) : false
      return (
        <>
          <div className="ambient-layer stars" aria-hidden></div>
          <div className={`ambient-layer moon ${phase} ${phase === 'half' ? (rightLit ? 'right-lit' : 'left-lit') : ''}`} aria-hidden></div>
          {/* 2-3 shooting stars when motion allowed */}
          <div className="ambient-layer shooting" aria-hidden>
            <span className="shoot"></span>
            <span className="shoot delay"></span>
            <span className="shoot delay2"></span>
          </div>
          {cloudy && (
            <div className="ambient-layer clouds" aria-hidden>
              <span></span><span></span>
            </div>
          )}
        </>
      )
    }
    if (theme === 'rain') return (
      <div className="ambient-layer raindrops" aria-hidden>
        {Array.from({ length: 32 }).map((_, i) => (
          <span key={i} className="drop"></span>
        ))}
      </div>
    )
    if (theme === 'storm') return <>
      <div className="ambient-layer raindrops" aria-hidden>
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} className="drop"></span>
        ))}
      </div>
      <div className="ambient-layer lightning" aria-hidden></div>
    </>
    if (theme === 'snow') return <div className="ambient-layer precip" aria-hidden></div>
    if (theme === 'fog') return <div className="ambient-layer haze" aria-hidden></div>
    return null
  }

  return (
    <>
      {renderAmbient()}
      <div className="container">
      <div className="header-row">
        <h1>Weather Forecast</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            aria-label="Toggle dark/light"
            title={themeMode === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className="icon-btn"
            onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
          >
            {themeMode === 'dark' ? '🌙' : '☀️'}
          </button>
          <button type="button" aria-label="Open settings" className="icon-btn" onClick={() => setSettingsOpen((v) => !v)}>
            ⚙️
          </button>
        </div>
      </div>

      <form onSubmit={submit} className="form">
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Enter city (e.g. London)" />
        <button type="submit" disabled={loading}>{loading ? 'Loading...' : 'Search'}</button>

        <div className="unit-toggle" role="group" aria-label="Temperature units">
          <button type="button" className={unit === 'C' ? 'active' : ''} onClick={() => setUnit('C')}>°C</button>
          <button type="button" className={unit === 'F' ? 'active' : ''} onClick={() => setUnit('F')}>°F</button>
        </div>
        {/* Theme mode buttons removed from the form; single header toggle now controls light/dark. */}
        <div className="unit-toggle" role="group" aria-label="Motion preference" title="Motion preference">
          <button type="button" className={motionPref === 'auto' ? 'active' : ''} onClick={() => setMotionPref('auto')}>Motion: Auto</button>
          <button type="button" className={motionPref === 'calm' ? 'active' : ''} onClick={() => setMotionPref('calm')}>Calm</button>
        </div>
      </form>

      {error && <div className="error">{error}</div>}

      {settingsOpen && (
        <div className="settings-panel" role="dialog" aria-label="Preferences">
          <div className="row">
            <strong>Temperature</strong>
            <div className="unit-toggle">
              <button type="button" className={unit === 'C' ? 'active' : ''} onClick={() => setUnit('C')}>°C</button>
              <button type="button" className={unit === 'F' ? 'active' : ''} onClick={() => setUnit('F')}>°F</button>
            </div>
          </div>
          <div className="row">
            <strong>Theme</strong>
            <div className="unit-toggle">
              <button type="button" className={themeMode === 'auto' ? 'active' : ''} onClick={() => setThemeMode('auto')}>Auto</button>
              <button type="button" className={themeMode === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}>Light</button>
              <button type="button" className={themeMode === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}>Dark</button>
            </div>
          </div>
          <div className="row">
            <strong>Motion</strong>
            <div className="unit-toggle">
              <button type="button" className={motionPref === 'auto' ? 'active' : ''} onClick={() => setMotionPref('auto')}>Auto</button>
              <button type="button" className={motionPref === 'calm' ? 'active' : ''} onClick={() => setMotionPref('calm')}>Calm</button>
            </div>
          </div>
          <div className="row end">
            <button type="button" className="link-btn" onClick={() => { try { localStorage.removeItem('pref.unit'); localStorage.removeItem('pref.themeMode'); localStorage.removeItem('pref.motion'); } catch {}; setUnit('C'); setThemeMode('auto'); setMotionPref('auto'); }}>Reset to defaults</button>
          </div>
        </div>
      )}

      {data && (
        <div className="result">
          <h2>{data.location}</h2>

          {data.forecast && data.forecast.current_weather && (
            <div className="current">
              <strong>Current:</strong>{' '}
              {unit === 'C' ? Math.round(data.forecast.current_weather.temperature) : cToF(data.forecast.current_weather.temperature)}°{unit}
              {' '}— wind {data.forecast.current_weather.windspeed} km/h
              {data.cached ? <em> (cached)</em> : null}
              <span className="weather-icon"> {mapWeatherCodeToEmoji(data.forecast.current_weather.weathercode)}</span>
            </div>
          )}

          {/* Air quality block (fetched from /api/air-quality) */}
          <div className="air-quality-block">
            {aqLoading && <div className="aq-loading">Loading air quality...</div>}
            {aqError && <div className="aq-error">AQ Error: {aqError}</div>}
            {airQuality && airQuality.sample && (
              <div className="aq">
                <strong>Air Quality:</strong>{' '}
                <span className="aq-badge">{airQuality.category?.label ?? 'Unknown'}</span>
                <div className="aq-details">
                  <div>PM2.5: {airQuality.sample.pm2_5 != null ? `${airQuality.sample.pm2_5.toFixed(1)} µg/m³` : '—'}</div>
                  <div>PM10: {airQuality.sample.pm10 != null ? `${airQuality.sample.pm10.toFixed(1)} µg/m³` : '—'}</div>
                  <div>O₃: {airQuality.sample.o3 != null ? `${airQuality.sample.o3.toFixed(1)} µg/m³` : '—'}</div>
                  <div>NO₂: {airQuality.sample.no2 != null ? `${airQuality.sample.no2.toFixed(1)} µg/m³` : '—'}</div>
                </div>
                {airQuality.cached ? <em> (cached)</em> : null}
              </div>
            )}
          </div>

          {chartData ? (
            <div className="chart-wrapper">
              <Line options={chartOptions} data={chartData} />
            </div>
          ) : (
            data.forecast && data.forecast.daily ? (
              <div className="daily">
                <h3>Daily</h3>
                {data.forecast.daily.time.map((t, i) => (
                  <div key={t} className="day">
                    <strong>{t}</strong>: {data.forecast.daily.temperature_2m_min[i]}°C — {data.forecast.daily.temperature_2m_max[i]}°C
                  </div>
                ))}
              </div>
            ) : null
          )}

          {/* Marine panel (separate component) */}
          {data && (data.lat != null && data.lon != null) && (
            <div style={{ marginTop: 12 }}>
              <MarinePanel lat={data.lat} lon={data.lon} />
            </div>
          )}

            {/* Climate change summary (toggleable) */}
            <div style={{ marginTop: 12 }}>
              <button type="button" className="link-btn" onClick={() => setClimateOpen((v) => !v)}>{climateOpen ? 'Hide Climate' : 'Show Climate summary'}</button>
            </div>

            {climateOpen && (
              <div className="climate-block" style={{ marginTop: 8 }}>
                {climateLoading && <div className="climate-loading">Loading climate trend...</div>}
                {climateError && <div className="climate-error">Climate Error: {climateError}</div>}
                {climate && climate.trend && (
                  <div className="climate">
                    <h3>Climate summary (past {climate.years} years)</h3>
                    <div>Local trend: {climate.trend.per_decade >= 0 ? '+' : ''}{climate.trend.per_decade.toFixed(3)} °C/decade</div>
                    {climate.baseline && climate.baseline.mean != null && climate.recent && climate.recent.mean != null && (
                      <div>Recent anomaly (vs {climate.baseline.period}): {climate.recent.anomaly >= 0 ? '+' : ''}{climate.recent.anomaly.toFixed(2)} °C (last {climate.recent.years} yrs)</div>
                    )}
                    <details>
                      <summary>Annual means (click to expand)</summary>
                      <div className="climate-annual">
                        {climate.annual && climate.annual.map((r) => (
                          <div key={r.year}>{r.year}: {r.mean.toFixed(2)} °C</div>
                        ))}
                      </div>
                    </details>

                    {/* Small line chart for annual means */}
                    <div className="climate-chart" style={{ height: 180, marginTop: 12 }}>
                      {climateChart ? (
                        <Line data={climateChart} options={climateChartOptions} />
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      )}
      </div>
    </>
  )
}
