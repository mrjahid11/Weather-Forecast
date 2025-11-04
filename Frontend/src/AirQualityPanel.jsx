import React from 'react'

function categoryColor(idx) {
  // Basic mapping similar to US AQI categories but simplified
  switch (idx) {
    case 1: return '#4caf50' // Good
    case 2: return '#ffeb3b' // Moderate
    case 3: return '#ff9800' // Unhealthy for sensitive
    case 4: return '#f44336' // Unhealthy
    case 5: return '#9c27b0' // Very Unhealthy
    case 6: return '#6b0000' // Hazardous
    default: return '#90a4ae' // Unknown/gray
  }
}

function healthAdvice(idx) {
  switch (idx) {
    case 1: return 'Air is good. Enjoy outdoor activities.'
    case 2: return 'Moderate. Unusually sensitive people should consider reducing prolonged outdoor exertion.'
    case 3: return 'Unhealthy for sensitive groups. Kids, older adults, and those with respiratory disease should limit prolonged outdoor exertion.'
    case 4: return 'Unhealthy. Reduce outdoor activities and consider masks for long exposure.'
    case 5: return 'Very unhealthy. Avoid outdoor exertion; consider staying indoors.'
    case 6: return 'Hazardous. Avoid all outdoor activities.'
    default: return 'Air quality data unavailable.'
  }
}

export default function AirQualityPanel({ airQuality, loading, error }) {
  if (loading) return (
    <div className="aq-tile">
      <div className="aq-loading">Loading air quality…</div>
    </div>
  )

  if (error) return (
    <div className="aq-tile">
      <div className="aq-error">Air quality unavailable: {String(error)}</div>
    </div>
  )

  if (!airQuality || !airQuality.sample) return (
    <div className="aq-tile">
      <div className="aq-empty">No air quality data</div>
    </div>
  )

  const cat = airQuality.category || { idx: 0, label: 'unknown' }
  const sample = airQuality.sample || {}
  const color = categoryColor(cat.idx)

  return (
    <div className="aq-tile">
      <div className="aq-header">
        <div className="aq-title">Air Quality</div>
        <div className="aq-badge" style={{ background: color }}>{cat.label}</div>
      </div>

      <div className="aq-main">
        <div className="aq-left">
          <div className="aq-large">{sample.pm2_5 != null ? sample.pm2_5.toFixed(1) : '—'}</div>
          <div className="aq-sub">PM2.5 µg/m³</div>
        </div>

        <div className="aq-right">
          <div className="aq-row"><strong>PM10:</strong> {sample.pm10 != null ? `${sample.pm10.toFixed(1)} µg/m³` : '—'}</div>
          <div className="aq-row"><strong>NO₂:</strong> {sample.no2 != null ? `${sample.no2.toFixed(1)} µg/m³` : '—'}</div>
          <div className="aq-row"><strong>O₃:</strong> {sample.o3 != null ? `${sample.o3.toFixed(1)} µg/m³` : '—'}</div>
        </div>
      </div>

      <div className="aq-advice">{healthAdvice(cat.idx)}</div>

      <div className="aq-meta">{airQuality.cached ? 'Recent (cached)' : 'Live'}</div>
    </div>
  )
}
