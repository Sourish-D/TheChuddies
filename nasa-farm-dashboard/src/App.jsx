import './App.css'
import { useEffect, useState } from 'react'
import MapRegion from './components/MapRegion.jsx'

const routePaths = {
  home: '/',
  optimize: '/optimize',
  how: '/how-it-works',
}

function routeFromPath(pathname) {
  if (pathname === routePaths.optimize) return 'optimize'
  if (pathname === routePaths.how) return 'how'
  return 'home'
}

function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname))
  const [coordinates, setCoordinates] = useState({ lat: 43.095796, lon: -80.047 })
  const [selectedGeometry, setSelectedGeometry] = useState(null)
  const [selectionConfirmed, setSelectionConfirmed] = useState(false)
  const [fieldAreaAcres, setFieldAreaAcres] = useState(null)
  const [ndviResult, setNdviResult] = useState(null)
  const [ndviError, setNdviError] = useState('')
  const [powerResult, setPowerResult] = useState(null)
  const [powerError, setPowerError] = useState('')

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (nextRoute) => (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const path = routePaths[nextRoute]
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setRoute(nextRoute)
    window.scrollTo(0, 0)
  }

  const updateCoordinates = (nextCoordinates) => {
    setCoordinates(nextCoordinates)
    setSelectedGeometry(null)
    setSelectionConfirmed(false)
    setFieldAreaAcres(null)
    setNdviResult(null)
    setNdviError('')
    setPowerResult(null)
    setPowerError('')
  }

  const resetSelection = () => {
    setSelectedGeometry(null)
    setSelectionConfirmed(false)
    setFieldAreaAcres(null)
    setNdviResult(null)
    setNdviError('')
    setPowerResult(null)
    setPowerError('')
  }

  return (
    <div className="site-shell">
      <SiteHeader navigate={navigate} compact={route === 'optimize'} />
      {route === 'home' && <HomePage navigate={navigate} />}
      {route === 'how' && <ComingSoonPage navigate={navigate} />}
      {route === 'optimize' && (
        <FarmPage
          coordinates={coordinates}
          onCoordinatesChange={updateCoordinates}
          selectedGeometry={selectedGeometry}
          selectionConfirmed={selectionConfirmed}
          fieldAreaAcres={fieldAreaAcres}
          onSelectionConfirm={({ geometry, areaAcres, coordinates: center }) => {
            setSelectedGeometry(geometry)
            setFieldAreaAcres(areaAcres)
            setCoordinates(center)
            setSelectionConfirmed(true)
          }}
          onSelectionReset={resetSelection}
          ndviResult={ndviResult}
          ndviError={ndviError}
          powerResult={powerResult}
          powerError={powerError}
          setNdviResult={setNdviResult}
          setNdviError={setNdviError}
          setPowerResult={setPowerResult}
          setPowerError={setPowerError}
        />
      )}
    </div>
  )
}

function SiteHeader({ navigate, compact = false }) {
  return (
    <header className={`site-header${compact ? ' site-header--compact' : ''}`}>
      <a className="brand" href="/" onClick={navigate('home')} aria-label="chuDirt home">
        chu<span>Dirt</span>
      </a>
      {compact && (
        <a className="header-link" href="/" onClick={navigate('home')}>
          <span aria-hidden="true">←</span> Back to home
        </a>
      )}
    </header>
  )
}

function HomePage({ navigate }) {
  return (
    <main className="page-transition home-page">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-eyebrow">
          NASA EARTH OBSERVATION <span className="eyebrow-divider">·</span> AGRICULTURAL INTELLIGENCE
        </div>
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-wordmark">chuDirt</h1>
          <p className="hero-tagline">Intelligence beneath every field.</p>
        </div>
        <div className="hero-actions">
          <a className="button button--primary" href="/optimize" onClick={navigate('optimize')}>
            Optimize your farm <span aria-hidden="true">↗</span>
          </a>
          <a className="button button--secondary" href="/how-it-works" onClick={navigate('how')}>
            How it works <span aria-hidden="true">→</span>
          </a>
        </div>
        <LandscapeScene />
      </section>
    </main>
  )
}

function LandscapeScene() {
  return (
    <svg
      className="hero-landscape"
      viewBox="0 0 1440 760"
      preserveAspectRatio="xMidYMax slice"
      role="img"
      aria-label="A green field above rich, layered soil"
    >
      <defs>
        <linearGradient id="field-haze" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f2e8" stopOpacity="0" />
          <stop offset=".58" stopColor="#f4f2e8" stopOpacity=".1" />
          <stop offset="1" stopColor="#f4f2e8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="soil-layer" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#755337" />
          <stop offset=".22" stopColor="#62452f" />
          <stop offset="1" stopColor="#493727" />
        </linearGradient>
        <linearGradient id="grass-layer" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#7c9a5d" />
          <stop offset="1" stopColor="#a5b67a" />
        </linearGradient>
        <pattern id="soil-grain" width="48" height="32" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="8" r="1.2" fill="#d2a16a" opacity=".24" />
          <circle cx="31" cy="23" r=".9" fill="#261f18" opacity=".18" />
          <path d="M17 28l5-1" stroke="#d2a16a" strokeOpacity=".12" />
        </pattern>
      </defs>
      <path d="M0 400c172-42 275-3 424 22 169 29 289-69 457-58 187 13 311 60 559-1v397H0Z" fill="#dce4c9" />
      <path d="M0 457c180-65 311-40 451-9 174 38 273-68 463-61 186 7 342 67 526 20v353H0Z" fill="#c6d3ad" />
      <g fill="#6d8458">
        <path d="M0 432c80-69 161-71 246 0v55H0Zm249 20c70-82 148-92 228 0v47H249Zm725-20c77-88 171-82 247 0v59H974Zm232 12c67-77 143-77 234-2v67h-234Z" />
      </g>
      <g fill="#526f49">
        <path d="M102 440c-16-26-12-47 8-61 1-24 34-32 48-12 22 3 28 30 12 43 2 13-6 23-19 30Zm163 3c-17-24-11-46 6-59 0-23 32-32 48-13 22 4 28 29 13 43 3 13-5 24-19 30Zm818-5c-17-26-11-47 7-60 1-24 35-33 49-13 22 4 27 30 12 44 2 13-6 23-19 29Zm169 8c-17-25-10-47 7-60 0-25 34-32 49-13 21 3 27 29 12 43 3 13-5 24-19 30Z" />
      </g>
      <path d="M0 499c187-49 344-18 518 14 178 33 314-58 495-45 154 11 280 55 427 18v40c-184 54-303 12-469 2-172-10-315 67-490 37C298 536 162 498 0 547Z" fill="url(#grass-layer)" />
      <path d="M0 545c166-50 302-13 474 17 170 30 318-41 486-31 184 10 315 55 480 16v213H0Z" fill="url(#soil-layer)" />
      <path d="M0 545c166-50 302-13 474 17 170 30 318-41 486-31 184 10 315 55 480 16v213H0Z" fill="url(#soil-grain)" />
      <path d="M0 601c194-39 322 27 484 31 189 5 329-43 495-29 184 16 293 50 461 8v44c-173 43-304 4-474-7-177-11-332 43-510 10C288 629 156 590 0 646Z" fill="#8b6947" opacity=".42" />
      <rect width="1440" height="760" fill="url(#field-haze)" />
    </svg>
  )
}

function ComingSoonPage({ navigate }) {
  return (
    <main className="page-transition coming-soon-page">
      <div className="coming-soon-content">
        <h1>How it works</h1>
        <p>We're growing something.</p>
        <span className="coming-soon-badge">COMING SOON</span>
        <a className="button button--secondary" href="/" onClick={navigate('home')}>
          <span aria-hidden="true">←</span> Back to home
        </a>
      </div>
    </main>
  )
}

function FarmPage({
  coordinates,
  onCoordinatesChange,
  selectedGeometry,
  selectionConfirmed,
  fieldAreaAcres,
  onSelectionConfirm,
  onSelectionReset,
  ndviResult,
  ndviError,
  powerResult,
  powerError,
  setNdviResult,
  setNdviError,
  setPowerResult,
  setPowerError,
}) {
  return (
    <main className="page-transition farm-page">
      <div className="farm-heading">
        <div>
          <span className="section-kicker">NASA EARTH OBSERVATION · FIELD INTELLIGENCE</span>
          <h1>Optimize your farm</h1>
        </div>
        <p>Mark your field on the map. We’ll use its boundary to look up available satellite and climate data.</p>
      </div>
      <MapRegion
        lat={coordinates.lat}
        lon={coordinates.lon}
        onCoordinatesChange={onCoordinatesChange}
        selectedGeometry={selectedGeometry}
        selectionConfirmed={selectionConfirmed}
        fieldAreaAcres={fieldAreaAcres}
        onSelectionConfirm={onSelectionConfirm}
        onSelectionReset={onSelectionReset}
        onNdviResult={setNdviResult}
        onNdviError={setNdviError}
        onPowerResult={setPowerResult}
        onPowerError={setPowerError}
      />
      {(ndviResult || ndviError || powerResult || powerError) && (
        <section className="results-section" aria-label="Field data results">
          {ndviResult && (
            <article className="result-panel result-panel--ndvi">
              <span className="result-label">Satellite vegetation</span>
              <h2>Average NDVI <strong>{ndviResult.average_ndvi.toFixed(3)}</strong></h2>
              <p>{ndviResult.start_date} — {ndviResult.end_date}</p>
            </article>
          )}
          {ndviError && <p className="result-error" role="alert">{ndviError}</p>}
          {powerResult && <PowerSummary result={powerResult} />}
          {powerError && <p className="result-error" role="alert">{powerError}</p>}
        </section>
      )}
      <footer className="farm-footer">
        <span>NASA HLS · NASA POWER</span>
        <span>Climate data reflects source-grid resolution.</span>
      </footer>
    </main>
  )
}

function PowerSummary({ result }) {
  const values = [
    { key: 'tmax_c_avg', daysKey: 'tmax', label: 'Avg. daily high', unit: '°C' },
    { key: 'tmin_c_avg', daysKey: 'tmin', label: 'Avg. daily low', unit: '°C' },
    { key: 'precipitation_mm_total', daysKey: 'precipitation', label: 'Total precipitation', unit: 'mm' },
    { key: 'relative_humidity_pct_avg', daysKey: 'humidity', label: 'Avg. humidity', unit: '%' },
    { key: 'solar_mj_m2_day_avg', daysKey: 'solar', label: 'Avg. solar energy', unit: 'MJ/m²/day' },
  ]

  return (
    <article className="result-panel result-panel--power">
      <div className="power-heading">
        <div>
          <span className="result-label">NASA POWER · Daily summary</span>
          <p>{result.start_date} — {result.end_date} · near field center</p>
        </div>
        <span className="power-coordinate">{result.latitude.toFixed(3)}°, {result.longitude.toFixed(3)}°</span>
      </div>
      <div className="power-values">
        {values.map(({ key, daysKey, label, unit }) => (
          <div className="power-value" key={key}>
            <span>{label}</span>
            <strong>{result.summary[key] == null ? 'Unavailable' : `${result.summary[key]} ${unit}`}</strong>
            <small>{result.valid_days[daysKey]} valid days</small>
          </div>
        ))}
      </div>
      <p className="power-note">Regional grid context; not a field-scale measurement.</p>
    </article>
  )
}

export default App
