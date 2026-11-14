import { useCallback, useEffect, useRef, useState } from 'react';

export default function Geocoder({
  lat: latitude,
  lon: longitude,
  onCoordinatesChange,
  initialAddress = '',
}) {
  const [address, setAddress] = useState(initialAddress);
  const [displayName, setDisplayName] = useState(initialAddress || 'Manual or search input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const initialLookupStartedRef = useRef(false);

  const lookupAddress = useCallback(async (query) => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'ViteReactGeocoderApp/1.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error('Location lookup failed');
      }

      const data = await response.json();

      if (data && data.length > 0) {
        const foundLat = Number(data[0].lat);
        const foundLon = Number(data[0].lon);

        if (
          !Number.isFinite(foundLat)
          || foundLat < -90
          || foundLat > 90
          || !Number.isFinite(foundLon)
          || foundLon < -180
          || foundLon > 180
        ) {
          setError('The location service returned invalid coordinates. Please try another search.');
          return;
        }

        onCoordinatesChange({ lat: foundLat, lon: foundLon });
        setDisplayName(data[0].display_name);
      } else {
        setError('No coordinates found for this location. Try being more specific.');
      }
    } catch {
      setError('Failed to fetch coordinates. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  }, [onCoordinatesChange]);

  useEffect(() => {
    if (initialAddress && !initialLookupStartedRef.current) {
      initialLookupStartedRef.current = true;
      lookupAddress(initialAddress);
    }
  }, [initialAddress, lookupAddress]);

  const handleCoordinateChange = (coordinate, value) => {
    const parsedValue = Number(value);
    const isLatitude = coordinate === 'lat';
    const isValid = Number.isFinite(parsedValue)
      && (isLatitude ? parsedValue >= -90 && parsedValue <= 90 : parsedValue >= -180 && parsedValue <= 180);

    if (isValid) {
      onCoordinatesChange({
        lat: isLatitude ? parsedValue : latitude,
        lon: isLatitude ? longitude : parsedValue,
      });
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    await lookupAddress(address);
  };

  return (
    <div className="container mt-5" style={{ maxWidth: '600px' }}>
      <div className="card shadow p-4 border-0 rounded-4">
        <h2 className="h4 mb-3 fw-bold text-primary">Location & Coordinates Tool</h2>
        
        {/* Search Form */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="mb-3">
            <label htmlFor="addressInput" className="form-label text-muted">
              Search an address or landmark (Optional)
            </label>
            <div className="input-group">
              <input
                type="text"
                className="form-control"
                id="addressInput"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g., Eiffel Tower, Paris"
              />
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Searching...' : 'Lookup'}
              </button>
            </div>
          </div>
        </form>

        {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}

        {/* Always-Visible Coordinate Display & Manual Input Section */}
        <div className="p-3 bg-light rounded-3 border">
          <h5 className="h6 fw-bold text-dark mb-1">Coordinates Control</h5>
          <p className="small text-muted mb-3 text-truncate">
            <strong>Current Source/Location:</strong> {displayName}
          </p>
          
          <div className="row g-3">
            <div className="col-md-6">
              <label htmlFor="latInput" className="form-label small fw-bold">Latitude</label>
              <input
                type="number"
                step="any"
                className="form-control"
                id="latInput"
                value={latitude}
                onChange={(e) => handleCoordinateChange('lat', e.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label htmlFor="lonInput" className="form-label small fw-bold">Longitude</label>
              <input
                type="number"
                step="any"
                className="form-control"
                id="lonInput"
                value={longitude}
                onChange={(e) => handleCoordinateChange('lon', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}