import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons missing in Leaflet when bundled with Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function squareBounds(latitude, longitude, areaAcres) {
  const sideKm = Math.sqrt(areaAcres * 0.0040468564224);
  const halfSide = sideKm / 2;
  const latitudeOffset = halfSide / 111.32;
  const longitudeOffset = halfSide / (111.32 * Math.cos(latitude * Math.PI / 180));
  return [
    [latitude - latitudeOffset, longitude - longitudeOffset],
    [latitude + latitudeOffset, longitude + longitudeOffset],
  ];
}

export default function MapRegion({
  lat,
  lon,
  onNdviResult,
  onNdviError,
  onPowerResult,
  onPowerError,
}) {
  const [areaAcres, setAreaAcres] = useState(1);
  const [loadingNdvi, setLoadingNdvi] = useState(false);
  const [loadingPower, setLoadingPower] = useState(false);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const rectangleRef = useRef(null);
  const initialCenterRef = useRef([lat, lon]);
  const initialAreaRef = useRef(areaAcres);

  // Initialize Map on mount
  useEffect(() => {
    if (!mapInstanceRef.current) {
      const [initialLat, initialLon] = initialCenterRef.current;
      mapInstanceRef.current = L.map(mapContainerRef.current).setView([initialLat, initialLon], 11);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(mapInstanceRef.current);

      // Initial marker and square highlighted region
      markerRef.current = L.marker([initialLat, initialLon]).addTo(mapInstanceRef.current);
      const bounds = squareBounds(initialLat, initialLon, initialAreaRef.current);
      rectangleRef.current = L.rectangle(bounds, {
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.2,
      }).addTo(mapInstanceRef.current);
    }

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map view, marker, and square highlight when coordinates or area change
  useEffect(() => {
    if (mapInstanceRef.current) {
      const newLatLng = [lat, lon];
      const bounds = squareBounds(lat, lon, areaAcres);

      mapInstanceRef.current.setView(newLatLng);

      if (markerRef.current) {
        markerRef.current.setLatLng(newLatLng);
      }

      if (rectangleRef.current) {
        rectangleRef.current.setBounds(bounds);
      }
    }
  }, [lat, lon, areaAcres]);

  const calculateNdvi = async () => {
    setLoadingNdvi(true);
    onNdviError('');
    onNdviResult(null);
    try {
      const { _southWest: southwest, _northEast: northeast } = rectangleRef.current.getBounds();
      const response = await fetch('/api/ndvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: [southwest.lng, southwest.lat, northeast.lng, northeast.lat] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'NDVI calculation failed.');
      onNdviResult(data);
    } catch (error) {
      onNdviError(error.message || 'NDVI calculation failed.');
    } finally {
      setLoadingNdvi(false);
    }
  };

  const fetchPowerData = async () => {
    setLoadingPower(true);
    onPowerError('');
    onPowerResult(null);
    try {
      const response = await fetch('/api/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lon }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'NASA POWER request failed.');
      onPowerResult(data);
    } catch (error) {
      onPowerError(error.message || 'NASA POWER request failed.');
    } finally {
      setLoadingPower(false);
    }
  };

  return (
    <div className="container mt-5" style={{ maxWidth: '700px' }}>
      <div className="card shadow p-4 border-0 rounded-4">
        <h2 className="h4 mb-3 fw-bold text-primary">Interactive Region Map & Scale Slider</h2>

        {/* Scale Slider */}
        <div className="mb-4">
          <label           htmlFor="areaSlider" className="form-label small fw-bold">
            Square area: <span className="text-primary">{areaAcres} {areaAcres === 1 ? 'acre' : 'acres'}</span>
          </label>
          <input
            type="range"
            className="form-range"
            id="areaSlider"
            min="1"
            max="6177"
            step="1"
            value={areaAcres}
            onChange={(e) => setAreaAcres(Number(e.target.value))}
          />
        </div>
        <div className="d-flex flex-column flex-sm-row gap-2 mb-3">
          <button className="btn btn-success" onClick={calculateNdvi} disabled={loadingNdvi}>
            {loadingNdvi ? 'Calculating...' : 'Calculate NDVI for selected square'}
          </button>
          <button className="btn btn-outline-primary" onClick={fetchPowerData} disabled={loadingPower}>
            {loadingPower ? 'Loading NASA POWER...' : 'Get NASA POWER climate data'}
          </button>
        </div>
        <p className="small text-muted text-start">
          NASA POWER climate data represents the source grid near the field center;
          its native resolution is much coarser than a farm field.
        </p>

        {/* Map Display Container */}
        <div 
          ref={mapContainerRef} 
          className="rounded-3 border shadow-sm" 
          style={{ height: '400px', width: '100%' }}
        />
      </div>
    </div>
  );
}