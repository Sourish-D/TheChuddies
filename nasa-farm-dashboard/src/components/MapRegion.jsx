import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons missing in Leaflet when bundled with Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function getSquareBounds(latitude, longitude, areaAcres) {
  const sideLengthMeters = Math.sqrt(areaAcres * 4046.8564224);
  return L.latLng(latitude, longitude).toBounds(sideLengthMeters);
}

export default function MapRegion({
  lat,
  lon,
  areaAcres,
  onAreaAcresChange,
  onCoordinatesChange,
  onNdviResult,
  onNdviError,
}) {
  const [loading, setLoading] = useState(false);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const rectangleRef = useRef(null);
  const areaAcresRef = useRef(areaAcres);
  const onCoordinatesChangeRef = useRef(onCoordinatesChange);
  const initialCenterRef = useRef([lat, lon]);

  useEffect(() => {
    areaAcresRef.current = areaAcres;
    onCoordinatesChangeRef.current = onCoordinatesChange;
  }, [areaAcres, onCoordinatesChange]);

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
      const bounds = getSquareBounds(initialLat, initialLon, areaAcresRef.current);
      rectangleRef.current = L.rectangle(bounds, {
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.2,
      }).addTo(mapInstanceRef.current);

      const map = mapInstanceRef.current;
      const rectangle = rectangleRef.current;
      let dragStart = null;

      const startDragging = (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        L.DomEvent.preventDefault(event.originalEvent);
        dragStart = {
          pointer: event.latlng,
          center: rectangle.getBounds().getCenter(),
        };
        map.dragging.disable();
        map.on('mousemove', dragRegion);
        map.on('mouseup', stopDragging);
      };

      const dragRegion = (event) => {
        if (!dragStart) return;

        const center = L.latLng(
          dragStart.center.lat + event.latlng.lat - dragStart.pointer.lat,
          dragStart.center.lng + event.latlng.lng - dragStart.pointer.lng
        );
        rectangle.setBounds(getSquareBounds(center.lat, center.lng, areaAcresRef.current));
        markerRef.current.setLatLng(center);
      };

      const stopDragging = () => {
        if (!dragStart) return;

        dragStart = null;
        map.off('mousemove', dragRegion);
        map.off('mouseup', stopDragging);
        map.dragging.enable();

        const center = rectangle.getBounds().getCenter();
        onCoordinatesChangeRef.current({ lat: center.lat, lon: center.lng });
      };

      rectangle.on('mousedown', startDragging);
      rectangle.on('mouseover', () => {
        map.getContainer().style.cursor = 'move';
      });
      rectangle.on('mouseout', () => {
        map.getContainer().style.cursor = '';
      });
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
      const bounds = getSquareBounds(lat, lon, areaAcres);

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
            Region area: <span className="text-primary">{areaAcres} acres</span>
          </label>
          <input
            type="range"
            className="form-range"
            id="scaleSlider"
            min="50"
            max="1000"
            step="1"
            value={areaAcres}
            onChange={(e) => onAreaAcresChange(Number(e.target.value))}
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