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

function parseCropHistory(value, currentYear) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []

  const hasYearLabels = lines.some((line) => /^\d{4}\s*:/.test(line))
  if (hasYearLabels && lines.some((line) => !/^\d{4}\s*:\s*.+$/.test(line))) {
    throw new Error('Use a year and crop on every history line, for example “2024: soybeans”.')
  }

  const entries = hasYearLabels
    ? lines.flatMap((line) => {
      const [, year, crops] = line.match(/^(\d{4})\s*:\s*(.+)$/)
      return crops.split(',').map((crop) => ({ year: Number(year), crop: crop.trim() }))
    })
    : lines.flatMap((line) => line.split(',').map((crop) => crop.trim()).filter(Boolean))
      .map((crop, index, crops) => ({
        year: currentYear - crops.length + index,
        crop,
      }))

  if (entries.some(({ year, crop }) => year < 1900 || year >= currentYear || !crop || crop.length > 100)) {
    throw new Error(`Crop history must contain crop names (up to 100 characters) from years before ${currentYear}.`)
  }
  if (entries.length > 50) {
    throw new Error('Enter no more than 50 crop-history entries.')
  }
  return entries.sort((a, b) => a.year - b.year)
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

function parseAnalysisSlides(markdown) {
  const slides = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.match(/^#{1,3}\s+(.+?)\s*#*$/)
    if (heading) {
      slides.push({ title: heading[1].replace(/[*_`]/g, '').trim(), points: [] })
      continue
    }

    const text = trimmed
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/\*\*|__|[*_`~]/g, '')
      .trim()
    if (!text) continue
    if (!slides.length) slides.push({ title: 'Field insight', points: [] })
    slides[slides.length - 1].points.push(text)
  }
  return slides.filter((slide) => slide.points.length).map((slide) => ({
    ...slide,
    points: slide.points.slice(0, 2),
  }))
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
  const [activeSlide, setActiveSlide] = useState(0)
  const analysisSlides = result ? parseAnalysisSlides(result.analysis_markdown) : []

  const runAnalysis = async (event) => {
    event.preventDefault()
    setError('')
    setResult(null)
    setActiveSlide(0)
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

    const currentYear = Number(startDate.slice(0, 4))
    let cropHistoryEntries
    try {
      cropHistoryEntries = parseCropHistory(previousCrop, currentYear)
    } catch (historyError) {
      setError(historyError.message)
      return
    }

    setLoading(true)
    setProgress('Preparing the seasonal data requests…')
    try {
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

      const cropProfiles = cropHistoryEntries.map(({ crop }, index) => cropProfile(
        crop,
        index === cropHistoryEntries.length - 1 ? previousNitrogenFixing : '',
        index === cropHistoryEntries.length - 1 ? previousRootDepth : '',
        index === cropHistoryEntries.length - 1 ? previousPestGroups : '',
      ))
      cropProfiles.push(cropProfile(
        currentCrop.trim(),
        currentNitrogenFixing,
        currentRootDepth,
        currentPestGroups,
      ))
      const request = {
        seasons: observations,
        crop_history: cropHistoryEntries,
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
        <p>Compare NASA observations, then get qualified rotation suggestions informed by your crop history and general agronomy.</p>
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
          Recent crop history (oldest to newest)
          <textarea
            value={previousCrop}
            onChange={(event) => setPreviousCrop(event.target.value)}
            placeholder={'Optional; oldest first, one per line:\n2023: corn\n2024: soybeans\n2025: corn'}
            maxLength={2000}
            rows={3}
          />
        </label>
        <details className="agronomy-details">
          <summary>Optional crop traits and reference values</summary>
          <p>Crop traits are optional. Gemini can use general agronomy knowledge and will flag uncertain or conflicting information.</p>
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
                  Most recent historical crop: nitrogen-fixing?
                  <select value={previousNitrogenFixing} onChange={(event) => setPreviousNitrogenFixing(event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label>
                  Most recent historical crop: root depth
                  <select value={previousRootDepth} onChange={(event) => setPreviousRootDepth(event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="shallow">Shallow</option>
                    <option value="medium">Medium</option>
                    <option value="deep">Deep</option>
                  </select>
                </label>
                <label>
                  Most recent historical crop: pest-host groups
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
          {analysisSlides.length > 0 && (
            <div className="agronomy-story">
              <div className="agronomy-story-topline">
                <span>Your field, in a few quick takeaways</span>
                <span>{String(activeSlide + 1).padStart(2, '0')} / {String(analysisSlides.length).padStart(2, '0')}</span>
              </div>
              <div
                className="agronomy-story-progress"
                role="progressbar"
                aria-label="Walkthrough progress"
                aria-valuemin={1}
                aria-valuemax={analysisSlides.length}
                aria-valuenow={activeSlide + 1}
              >
                <span style={{ width: `${((activeSlide + 1) / analysisSlides.length) * 100}%` }} />
              </div>
              <article
                className={`agronomy-story-card agronomy-story-card--${activeSlide % 5}`}
                key={activeSlide}
                aria-label={`${activeSlide + 1} of ${analysisSlides.length}: ${analysisSlides[activeSlide].title}`}
                aria-roledescription="slide"
              >
                <span className="agronomy-story-index">
                  FIELD NOTE {String(activeSlide + 1).padStart(2, '0')}
                </span>
                <h4>{analysisSlides[activeSlide].title}</h4>
                <div className="agronomy-story-points">
                  {analysisSlides[activeSlide].points.map((point, index) => (
                    <p key={`${activeSlide}-${index}`}>{point}</p>
                  ))}
                </div>
              </article>
              <div className="agronomy-story-navigation">
                <button
                  type="button"
                  className="agronomy-story-arrow"
                  onClick={() => setActiveSlide((index) => Math.max(0, index - 1))}
                  disabled={activeSlide === 0}
                  aria-label="Previous takeaway"
                >
                  ← <span>Back</span>
                </button>
                <div className="agronomy-story-dots" aria-label="Choose a takeaway">
                  {analysisSlides.map((slide, index) => (
                    <button
                      type="button"
                      key={slide.title}
                      className={index === activeSlide ? 'is-active' : ''}
                      onClick={() => setActiveSlide(index)}
                      aria-label={`Go to takeaway ${index + 1}: ${slide.title}`}
                      aria-current={index === activeSlide ? 'step' : undefined}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="agronomy-story-arrow"
                  onClick={() => setActiveSlide((index) => Math.min(analysisSlides.length - 1, index + 1))}
                  disabled={activeSlide === analysisSlides.length - 1}
                  aria-label="Next takeaway"
                >
                  <span>Next</span> →
                </button>
              </div>
            </div>
          )}
          <details className="agronomy-details agronomy-payload">
            <summary>View calculated data sent for analysis</summary>
            <pre>{JSON.stringify(result.random_forest_features, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  )
}
