import React from 'react'

// Small inline SVG icons (sun/moon) with a soft glow
// We replaced sun/moon background SVGs with a neon-styled condition badge (see CSS)

// A small, present-to-24-hours horizontal list showing time, icon, temp and precipitation
export default function HourlyPanel({ forecast, unit = 'C' }) {
  if (!forecast || !forecast.hourly || !forecast.hourly.time) return null

  const times = forecast.hourly.time || []
  const temps = forecast.hourly.temperature_2m || []
  const precs = forecast.hourly.precipitation || []
  const codes = forecast.hourly.weathercode || []
  const winds = forecast.hourly.windspeed_10m || []

  // Find first index >= now (use local time strings from upstream)
  const nowTs = Date.now()
  let startIdx = 0
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i])
    if (!isNaN(t) && t >= nowTs) { startIdx = i; break }
  }

  // Take up to 24 entries from startIdx
  const slice = []
  for (let i = startIdx; i < Math.min(times.length, startIdx + 24); i++) {
    slice.push({
      time: times[i],
      temp: temps[i] != null ? temps[i] : null,
      prec: precs[i] != null ? precs[i] : null,
      code: codes[i] != null ? codes[i] : null,
      wind: winds[i] != null ? winds[i] : null,
    })
  }

  function mapWeatherCodeToEmoji(code) {
    if (code === 0) return '☀️'
    if (code === 1 || code === 2) return '🌤️'
    if (code === 3) return '☁️'
    if (code >= 45 && code <= 48) return '🌫️'
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️'
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return '❄️'
    if (code >= 95 && code <= 99) return '⛈️'
    return 'ℹ️'
  }

  function fmtHour(iso) {
    try {
      const d = new Date(iso)
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(d)
    } catch { return iso }
  }

  function fmtTemp(v) {
    if (v == null) return '—'
    if (unit === 'C') return `${Math.round(v)}°C`
    return `${Math.round((v * 9) / 5 + 32)}°F`
  }

  return (
    <div className="hourly-panel">
      <h3 style={{ margin: '6px 0' }}>Next 24 hours</h3>
      <div className="hourly-list" role="list">
          {slice.map((s, i) => {
          // determine day/night per slot using local hour (rough heuristic)
          let slotIsDay = true
          try {
            const d = new Date(s.time)
            const h = d.getHours()
            slotIsDay = h >= 6 && h < 18
          } catch {}
            return (
            <div key={s.time} className={`hour-slot ${slotIsDay ? 'day' : 'night'}`} role="listitem" title={s.time}>
              <div className="hour-time">{i === 0 ? 'Now' : fmtHour(s.time)}</div>
              <div className="hour-icon">
                <span className={`icon-neon ${slotIsDay ? 'neon-sun' : 'neon-moon'}`} aria-hidden />
                <span className="icon-fore" aria-hidden>{mapWeatherCodeToEmoji(s.code)}</span>
              </div>
              <div className="hour-temp">{fmtTemp(s.temp)}</div>
              <div className="hour-prec">{s.prec != null && s.prec > 0 ? `${s.prec} mm` : '—'}</div>
              <div className="hour-wind">{s.wind != null ? `${Math.round(s.wind)} km/h` : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
