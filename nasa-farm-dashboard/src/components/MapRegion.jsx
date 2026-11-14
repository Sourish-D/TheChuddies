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

function squareBounds(latitude, longitude, sideKm) {
  const halfSide = sideKm / 2;
  const latitudeOffset = halfSide / 111.32;
  const longitudeOffset = halfSide / (111.32 * Math.cos(latitude * Math.PI / 180));
  return [
    [latitude - latitudeOffset, longitude - longitudeOffset],
    [latitude + latitudeOffset, longitude + longitudeOffset],
  ];
}

export default function MapRegion({ lat, lon, onNdviResult, onNdviError }) {
  const [sideKm, setSideKm] = useState(1);
  const [loading, setLoading] = useState(false);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const rectangleRef = useRef(null);
  const initialCenterRef = useRef([lat, lon]);

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
      const bounds = squareBounds(initialLat, initialLon, sideKm);
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
      const bounds = squareBounds(lat, lon, sideKm);

      mapInstanceRef.current.setView(newLatLng);

      if (markerRef.current) {
        markerRef.current.setLatLng(newLatLng);
      }

      if (rectangleRef.current) {
        rectangleRef.current.setBounds(bounds);
      }
    }
  }, [lat, lon, sideKm]);

  const calculateNdvi = async () => {
    setLoading(true);
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
      onNdviError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mt-5" style={{ maxWidth: '700px' }}>
      <div className="card shadow p-4 border-0 rounded-4">
        <h2 className="h4 mb-3 fw-bold text-primary">Interactive Region Map & Scale Slider</h2>

        {/* Scale Slider */}
        <div className="mb-4">
          <label htmlFor="scaleSlider" className="form-label small fw-bold">
            Square side: <span className="text-primary">{sideKm} km</span>
          </label>
          <input
            type="range"
            className="form-range"
            id="scaleSlider"
            min="0.5"
            max="5"
            step="0.5"
            value={sideKm}
            onChange={(e) => setSideKm(Number(e.target.value))}
          />
        </div>
        <button className="btn btn-success mb-3" onClick={calculateNdvi} disabled={loading}>
          {loading ? 'Calculating...' : 'Calculate NDVI for selected square'}
        </button>

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