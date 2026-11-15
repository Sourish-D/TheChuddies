import { useState } from 'react'

export default function Geocoder({ lat: latitude, lon: longitude, onCoordinatesChange }) {
  const [address, setAddress] = useState('')
  const [displayName, setDisplayName] = useState('Manual or search input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCoordinateChange = (coordinate, value) => {
    const parsedValue = Number(value)
    const isLatitude = coordinate === 'lat'
    const isValid = Number.isFinite(parsedValue)
      && (isLatitude ? parsedValue >= -90 && parsedValue <= 90 : parsedValue >= -180 && parsedValue <= 180)

    if (isValid) {
      onCoordinatesChange({
        lat: isLatitude ? parsedValue : latitude,
        lon: isLatitude ? longitude : parsedValue,
      })
    }
  }

  const handleSearch = async (event) => {
    event.preventDefault()
    if (!address.trim()) return

    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`,
        { headers: { 'User-Agent': 'ViteReactGeocoderApp/1.0' } },
      )
      const data = await response.json()

      if (data?.length > 0) {
        const foundLat = Number(data[0].lat)
        const foundLon = Number(data[0].lon)

        if (
          !Number.isFinite(foundLat)
          || foundLat < -90
          || foundLat > 90
          || !Number.isFinite(foundLon)
          || foundLon < -180
          || foundLon > 180
        ) {
          setError('The location service returned invalid coordinates. Please try another search.')
          return
        }

        onCoordinatesChange({ lat: foundLat, lon: foundLon })
        setDisplayName(data[0].display_name)
      } else {
        setError('No coordinates found for this location. Try being more specific.')
      }
    } catch {
      setError('Failed to fetch coordinates. Please check your network connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="location-panel" aria-labelledby="location-title">
      <div className="panel-heading">
        <span className="panel-index">01</span>
        <h2 id="location-title">Field location</h2>
      </div>
      <form className="location-search" onSubmit={handleSearch}>
        <label htmlFor="addressInput">Search a place or address</label>
        <div className="search-control">
          <input
            type="text"
            id="addressInput"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Search a location"
          />
          <button type="submit" className="search-button" disabled={loading}>
            {loading ? '…' : 'Find'}
          </button>
        </div>
      </form>

      <div className="current-location">
        <span className="field-label">Selected location</span>
        <p title={displayName}>{displayName}</p>
      </div>

      <div className="coordinate-fields">
        <div className="coordinate-field">
          <label htmlFor="latInput">Latitude</label>
          <input
            type="number"
            step="any"
            id="latInput"
            value={latitude}
            onChange={(event) => handleCoordinateChange('lat', event.target.value)}
          />
        </div>
        <div className="coordinate-field">
          <label htmlFor="lonInput">Longitude</label>
          <input
            type="number"
            step="any"
            id="lonInput"
            value={longitude}
            onChange={(event) => handleCoordinateChange('lon', event.target.value)}
          />
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="location-hint">Search a place or enter coordinates directly.</p>
    </section>
  )
}
