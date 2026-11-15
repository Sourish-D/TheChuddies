import { useState } from 'react'
import { apiUrl } from '../api.js'

function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function previousYearDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  const targetYear = year - 1
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function cropProfile(crop, nitrogenFixing, rootDepth, pestHostGroups) {
  const profile = { crop }
  if (nitrogenFixing !== '') profile.nitrogen_fixing = nitrogenFixing === 'yes'
  if (rootDepth) profile.root_depth_class = rootDepth
  if (pestHostGroups.trim()) {
    profile.pest_host_groups = pestHostGroups
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean)
  }
  return profile
}

async function postJson(path, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let data
    try {
      data = await response.json()
    } catch (error) {
      throw new Error(
        `The data API returned an unreadable response (HTTP ${response.status}).`,
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new Error(data.detail || `The data API request failed (HTTP ${response.status}).`)
    }
    return data
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${path} timed out after 3 minutes. Try a shorter date range and retry.`,
        { cause: error },
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function MarkdownContent({ markdown }) {
  const blocks = []
  let listItems = []
  let paragraph = []
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: 'list', content: listItems })
      listItems = []
    }
  }
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', content: paragraph.join(' ') })
      paragraph = []
    }
  }

  markdown.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      flushParagraph()
    } else if (trimmed.startsWith('## ')) {
      flushList()
      flushParagraph()
      blocks.push({ type: 'heading', content: trimmed.slice(3) })
    } else if (trimmed.startsWith('- ')) {
      flushParagraph()
      listItems.push(trimmed.slice(2))
    } else {
      flushList()
      paragraph.push(trimmed)
    }
  })
  flushList()
  flushParagraph()

  return (
    <div className="agronomy-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index}>{renderInline(block.content)}</h3>
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.content.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
            </ul>
          )
        }
        return <p key={index}>{renderInline(block.content)}</p>
      })}
    </div>
  )
}

export default function AgronomyAnalysis({ coordinates, geometry }) {
  const today = new Date()
  const recentEnd = new Date(today)
  recentEnd.setDate(recentEnd.getDate() - 7)
  const defaultSeasonEnd = recentEnd.getMonth() < 4
    ? new Date(recentEnd.getFullYear() - 1, 11, 31)
    : recentEnd
  const [startDate, setStartDate] = useState(`${defaultSeasonEnd.getFullYear()}-05-01`)
  const [endDate, setEndDate] = useState(localDateString(defaultSeasonEnd))
  const [currentCrop, setCurrentCrop] = useState('')
  const [previousCrop, setPreviousCrop] = useState('')
  const [currentNitrogenFixing, setCurrentNitrogenFixing] = useState('')
  const [previousNitrogenFixing, setPreviousNitrogenFixing] = useState('')
  const [currentRootDepth, setCurrentRootDepth] = useState('')
  const [previousRootDepth, setPreviousRootDepth] = useState('')
  const [currentPestGroups, setCurrentPestGroups] = useState('')
  const [previousPestGroups, setPreviousPestGroups] = useState('')
  const [precipitationNormal, setPrecipitationNormal] = useState('')
  const [rootzoneNormal, setRootzoneNormal] = useState('')
  const [includeSmap, setIncludeSmap] = useState(false)
  const [yieldValue, setYieldValue] = useState('')
  const [yieldUnits, setYieldUnits] = useState('bu/acre')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const runAnalysis = async (event) => {
    event.preventDefault()
    setError('')
    setResult(null)
    if (!geometry) {
      setError('Confirm a field boundary before requesting agronomy analysis.')
      return
    }
    if (!currentCrop.trim()) {
      setError('Enter the crop grown in the selected season.')
      return
    }
    if (!startDate || !endDate || startDate > endDate) {
      setError('Choose a valid growing-season date range.')
      return
    }
    if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
      setError('The growing-season start and end dates must be in the same year.')
      return
    }
    if (precipitationNormal && !Number.isFinite(Number(precipitationNormal))) {
      setError('Enter a valid precipitation normal or leave it blank.')
      return
    }
    if (rootzoneNormal && !Number.isFinite(Number(rootzoneNormal))) {
      setError('Enter a valid root-zone moisture normal or leave it blank.')
      return
    }
    if (yieldValue && (!Number.isFinite(Number(yieldValue)) || Number(yieldValue) < 0)) {
      setError('Enter a valid externally generated yield prediction or leave it blank.')
      return
    }

    setLoading(true)
    setProgress('Preparing the seasonal data requests…')
    try {
      const currentYear = Number(startDate.slice(0, 4))
      const seasons = [
        { year: currentYear, start_date: startDate, end_date: endDate },
        {
          year: currentYear - 1,
          start_date: previousYearDate(startDate),
          end_date: previousYearDate(endDate),
        },
      ]

      const observations = []
      for (const season of seasons) {
        setProgress(`Fetching ${season.year} NASA POWER and Landsat/HLS data…`)
        const [power, ndvi] = await Promise.all([
          postJson('/api/power', {
            latitude: coordinates.lat,
            longitude: coordinates.lon,
            start_date: season.start_date,
            end_date: season.end_date,
          }),
          postJson('/api/ndvi', {
            geometry,
            start_date: season.start_date,
            end_date: season.end_date,
          }),
        ])
        const weather = power.daily
          .filter((day) => (day.t2m_max_c != null && day.t2m_min_c != null)
            || day.precipitation_mm != null)
          .map((day) => ({
            date: day.date,
            t2m_max_c: day.t2m_max_c != null && day.t2m_min_c != null ? day.t2m_max_c : null,
            t2m_min_c: day.t2m_max_c != null && day.t2m_min_c != null ? day.t2m_min_c : null,
            precipitation_mm: day.precipitation_mm,
          }))
        observations.push({ ...season, weather, ndvi: ndvi.observations })
      }

      const currentSeason = observations[0]
      if (precipitationNormal) {
        currentSeason.precipitation_normal_mm = Number(precipitationNormal)
      }
      if (rootzoneNormal) {
        currentSeason.rootzone_normal_m3_m3 = Number(rootzoneNormal)
      }

      const cropProfiles = []
      if (previousCrop.trim()) {
        cropProfiles.push(cropProfile(
          previousCrop.trim(),
          previousNitrogenFixing,
          previousRootDepth,
          previousPestGroups,
        ))
      }
      cropProfiles.push(cropProfile(
        currentCrop.trim(),
        currentNitrogenFixing,
        currentRootDepth,
        currentPestGroups,
      ))
      const request = {
        seasons: observations,
        crop_history: previousCrop.trim()
          ? [{ year: currentYear - 1, crop: previousCrop.trim() }]
          : [],
        crop_profiles: cropProfiles,
        yield_predictions: yieldValue
          ? [{
            year: currentYear,
            crop: currentCrop.trim(),
            predicted_yield: Number(yieldValue),
            units: yieldUnits,
            model: 'Externally supplied prediction',
          }]
          : [],
      }

      if (includeSmap) {
        setProgress('Fetching the latest NASA SMAP soil-moisture data…')
        const smap = await postJson('/api/smap', {
          latitude: coordinates.lat,
          longitude: coordinates.lon,
        })
        currentSeason.surface_soil_moisture_m3_m3 = smap.surface_soil_moisture_m3_m3
        currentSeason.rootzone_soil_moisture_m3_m3 = smap.rootzone_soil_moisture_m3_m3
        currentSeason.smap_start_time = smap.start_time
        currentSeason.smap_end_time = smap.end_time
        currentSeason.smap_resolution_km = smap.resolution_km
      }

      setProgress('Sending the collected data to Gemini for analysis…')
      const analysis = await postJson('/api/agronomy/analyze', request)
      setResult(analysis)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Agronomy analysis failed.')
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  return (
    <section className="agronomy-analysis" aria-labelledby="agronomy-analysis-title">
      <div className="agronomy-analysis-heading">
        <span className="section-kicker">GEMINI · GROUNDED AGRONOMY</span>
        <h3 id="agronomy-analysis-title">Season analysis</h3>
        <p>Compare this season with the same dates last year using NASA data and crop details you provide.</p>
      </div>
      <form className="agronomy-form" onSubmit={runAnalysis}>
        <div className="agronomy-date-fields">
          <label>
            Season starts
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            Season ends
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
        <label>
          Current-season crop <span aria-hidden="true">*</span>
          <input
            type="text"
            value={currentCrop}
            onChange={(event) => setCurrentCrop(event.target.value)}
            placeholder="e.g. corn"
            maxLength={100}
            required
          />
        </label>
        <label>
          Previous year's crop
          <input
            type="text"
            value={previousCrop}
            onChange={(event) => setPreviousCrop(event.target.value)}
            placeholder="Optional"
            maxLength={100}
          />
        </label>
        <details className="agronomy-details">
          <summary>Optional crop traits and reference values</summary>
          <p>Only enter crop traits and historical normals you know; Gemini won't fill in missing values.</p>
          <div className="agronomy-trait-fields">
            <label>
              Current crop: nitrogen-fixing?
              <select value={currentNitrogenFixing} onChange={(event) => setCurrentNitrogenFixing(event.target.value)}>
                <option value="">Not provided</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label>
              Current crop: root depth
              <select value={currentRootDepth} onChange={(event) => setCurrentRootDepth(event.target.value)}>
                <option value="">Not provided</option>
                <option value="shallow">Shallow</option>
                <option value="medium">Medium</option>
                <option value="deep">Deep</option>
              </select>
            </label>
            <label>
              Current crop: pest-host groups
              <input
                type="text"
                value={currentPestGroups}
                onChange={(event) => setCurrentPestGroups(event.target.value)}
                placeholder="Comma-separated, optional"
              />
            </label>
            {previousCrop.trim() && (
              <>
                <label>
                  Previous crop: nitrogen-fixing?
                  <select value={previousNitrogenFixing} onChange={(event) => setPreviousNitrogenFixing(event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label>
                  Previous crop: root depth
                  <select value={previousRootDepth} onChange={(event) => setPreviousRootDepth(event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="shallow">Shallow</option>
                    <option value="medium">Medium</option>
                    <option value="deep">Deep</option>
                  </select>
                </label>
                <label>
                  Previous crop: pest-host groups
                  <input
                    type="text"
                    value={previousPestGroups}
                    onChange={(event) => setPreviousPestGroups(event.target.value)}
                    placeholder="Comma-separated, optional"
                  />
                </label>
              </>
            )}
          </div>
          <div className="agronomy-date-fields">
            <label>
              Seasonal precipitation normal (mm)
              <input
                type="number"
                min="0"
                step="any"
                value={precipitationNormal}
                onChange={(event) => setPrecipitationNormal(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Root-zone moisture normal (m³/m³)
              <input
                type="number"
                min="0"
                step="any"
                value={rootzoneNormal}
                onChange={(event) => setRootzoneNormal(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="agronomy-date-fields">
            <label>
              External yield estimate
              <input
                type="number"
                min="0"
                step="any"
                value={yieldValue}
                onChange={(event) => setYieldValue(event.target.value)}
                placeholder="Optional — no yield model is included"
              />
            </label>
            <label>
              Yield units
              <input
                type="text"
                value={yieldUnits}
                onChange={(event) => setYieldUnits(event.target.value)}
                maxLength={40}
              />
            </label>
          </div>
          <label className="agronomy-checkbox">
            <input
              type="checkbox"
              checked={includeSmap}
              onChange={(event) => setIncludeSmap(event.target.checked)}
            />
            Include latest SMAP soil moisture (requires NASA Earthdata login)
          </label>
        </details>
        <button className="button button--primary agronomy-submit" type="submit" disabled={loading}>
          {loading ? 'Working…' : 'Generate Gemini analysis'}
        </button>
        {loading && <p className="agronomy-progress" role="status" aria-live="polite">{progress}</p>}
        <p className="agronomy-note">
          Fetches NASA POWER and Landsat/HLS for both seasons. HLS availability and server response time can vary.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      {result && (
        <div className="agronomy-result" aria-live="polite">
          <div className="agronomy-result-heading">
            <span className="result-label">Gemini analysis</span>
            <span>{result.model}</span>
          </div>
          <MarkdownContent markdown={result.analysis_markdown} />
          <details className="agronomy-details agronomy-payload">
            <summary>View calculated data sent for analysis</summary>
            <pre>{JSON.stringify(result.random_forest_features, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  )
}
