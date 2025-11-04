import React, { useState } from 'react'
import { Line } from 'react-chartjs-2'

// MarinePanel: fetches /api/marine and renders a multi-axis chart
export default function MarinePanel({ lat, lon }) {
  const [marineData, setMarineData] = useState(null)
  const [marineLoading, setMarineLoading] = useState(false)
  const [marineError, setMarineError] = useState(null)
  const [marineOpen, setMarineOpen] = useState(false)
  const [forecastMin15, setForecastMin15] = useState(96)
  const [pastMin15, setPastMin15] = useState(0)

  async function fetchMarine() {
  setMarineError(null)
  setMarineData(null)
  // allow 0 coordinates (valid at equator/prime meridian). Only bail if null/undefined
  if (lat == null || lon == null) return setMarineError('No coordinates available')
    setMarineLoading(true)
    try {
      const resp = await fetch(`/api/marine?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&forecast_minutely_15=${encodeURIComponent(forecastMin15)}&past_minutely_15=${encodeURIComponent(pastMin15)}`)
      if (!resp.ok) {
        const contentType = resp.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const e = await resp.json().catch(() => ({}))
          throw new Error(e.error || `Marine request failed: ${resp.status}`)
        }
        const txt = await resp.text().catch(() => '')
        throw new Error(txt ? `Marine request failed: ${resp.status} — ${txt.slice(0, 200)}` : `Marine request failed: ${resp.status}`)
      }
      const contentType = resp.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`Unexpected non-JSON response: ${txt ? txt.slice(0, 300) : 'no body'}`)
      }
      const json = await resp.json()
      setMarineData(json)
      setMarineOpen(true)
    } catch (err) {
      setMarineError(err.message)
    } finally {
      setMarineLoading(false)
    }
  }

  function buildChart(series) {
    if (!series || !series.time) return null
    const labels = series.time
    const wave = series.wave_height || series.wave || []
    const wind = series.windspeed_10m || series.wind || []
    const sw = series.shortwave_radiation || []
    const swp = series.significant_wave_period || series.significant_wave_period || []
    const swell = series.swell_height || []

    const datasets = []
    if (wave && wave.length) datasets.push({ label: 'Wave (m)', data: wave.map(v => v == null ? null : Number(v)), borderColor: 'rgba(34,147,214,0.95)', backgroundColor: 'rgba(34,147,214,0.12)', yAxisID: 'y', tension: 0.2, spanGaps: true })
    if (wind && wind.length) datasets.push({ label: 'Wind (m/s)', data: wind.map(v => v == null ? null : Number(v)), borderColor: 'rgba(255,159,64,0.95)', backgroundColor: 'rgba(255,159,64,0.12)', yAxisID: 'y1', tension: 0.2, spanGaps: true })
    if (sw && sw.length) datasets.push({ label: 'Solar (W/m²)', data: sw.map(v => v == null ? null : Number(v)), borderColor: 'rgba(102,187,106,0.9)', backgroundColor: 'rgba(102,187,106,0.12)', yAxisID: 'y2', tension: 0.2, spanGaps: true })
    if (swp && swp.length) datasets.push({ label: 'Sig. wave period (s)', data: swp.map(v => v == null ? null : Number(v)), borderColor: 'rgba(156,39,176,0.9)', backgroundColor: 'rgba(156,39,176,0.08)', yAxisID: 'y3', tension: 0.2, spanGaps: true })
    if (swell && swell.length) datasets.push({ label: 'Swell (m)', data: swell.map(v => v == null ? null : Number(v)), borderColor: 'rgba(63,81,181,0.9)', backgroundColor: 'rgba(63,81,181,0.08)', yAxisID: 'y', tension: 0.2, spanGaps: true })

    return {
      labels,
      datasets
    }
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { display: true },
      y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Wave / Swell (m)' } },
      y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Wind (m/s)' }, grid: { drawOnChartArea: false } },
      y2: { type: 'linear', display: false, position: 'right', title: { display: true, text: 'Solar (W/m²)' }, grid: { drawOnChartArea: false } },
      y3: { type: 'linear', display: false, position: 'right', title: { display: true, text: 'Period (s)' }, grid: { drawOnChartArea: false } }
    }
  }

  const series = marineData && marineData.series15 ? buildChart(marineData.series15) : null

  return (
    <div className="marine-block">
      <div className="marine-controls">
        <button type="button" className="link-btn" onClick={() => setMarineOpen(v => !v)}>{marineOpen ? 'Hide Marine' : 'Show Marine forecast'}</button>
        <label>Forecast 15-min steps:</label>
        <input type="number" min="0" value={forecastMin15} onChange={(e) => setForecastMin15(Math.max(0, parseInt(e.target.value || '0', 10)))} />
        <label>Past 15-min steps:</label>
        <input type="number" min="0" value={pastMin15} onChange={(e) => setPastMin15(Math.max(0, parseInt(e.target.value || '0', 10)))} />
        <button type="button" className="icon-btn" onClick={fetchMarine} disabled={marineLoading}>{marineLoading ? 'Loading...' : 'Load Marine'}</button>
      </div>

      {marineError && <div className="marine-error">Marine Error: {marineError}</div>}

      {marineOpen && series && (
        <div className="marine-chart-wrapper">
          <h3>Marine (15-min)</h3>
          <div style={{ height: 280 }}>
            <Line options={chartOptions} data={series} />
          </div>
          <div className="marine-note">Note: minutely-15 availability is limited; other regions may use interpolated hourly data. Solar radiation values are averaged over each 15-minute interval.</div>
        </div>
      )}
    </div>
  )
}
