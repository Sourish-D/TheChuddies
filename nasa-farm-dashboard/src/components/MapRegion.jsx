import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons missing in Leaflet when bundled with Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function MapRegion({
  lat,
  lon,
  onCoordinatesChange,
  areaAcres,
  onAreaAcresChange,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const rectangleRef = useRef(null);
  const areaAcresRef = useRef(areaAcres);
  const initialCenterRef = useRef([lat, lon]);
  const initialAreaRef = useRef(areaAcres);

  const getSquareBounds = (center, area) => L.latLng(center).toBounds(
    Math.sqrt(area * 4046.8564224)
  );

  // Initialize Map on mount
  useEffect(() => {
    if (!mapInstanceRef.current) {
      const [initialLat, initialLon] = initialCenterRef.current;
      const initialAreaAcres = initialAreaRef.current;
      mapInstanceRef.current = L.map(mapContainerRef.current).setView([initialLat, initialLon], 11);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(mapInstanceRef.current);

      // Initial marker and square highlighted region
      markerRef.current = L.marker([initialLat, initialLon]).addTo(mapInstanceRef.current);
      rectangleRef.current = L.rectangle(
        getSquareBounds([initialLat, initialLon], initialAreaAcres),
        {
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.2,
        }
      ).addTo(mapInstanceRef.current);

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
        rectangle.setBounds(getSquareBounds(center, areaAcresRef.current));
        markerRef.current.setLatLng(center);
      };

      const stopDragging = () => {
        if (!dragStart) return;

        dragStart = null;
        map.off('mousemove', dragRegion);
        map.off('mouseup', stopDragging);
        map.dragging.enable();

        const center = rectangle.getBounds().getCenter();
        onCoordinatesChange({ lat: center.lat, lon: center.lng });
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
  }, [onCoordinatesChange]);

  // Update map view, marker, and square highlight when coordinates or area change
  useEffect(() => {
    if (mapInstanceRef.current) {
      const newLatLng = [lat, lon];
      const bounds = getSquareBounds(newLatLng, areaAcres);

      mapInstanceRef.current.setView(newLatLng);

      if (markerRef.current) {
        markerRef.current.setLatLng(newLatLng);
      }

      if (rectangleRef.current) {
        rectangleRef.current.setBounds(bounds);
      }
    }
  }, [lat, lon, areaAcres]);

  return (
    <div className="container mt-5" style={{ maxWidth: '700px' }}>
      <div className="card shadow p-4 border-0 rounded-4">
        <h2 className="h4 mb-3 fw-bold text-primary">Interactive Region Map & Scale Slider</h2>

        {/* Scale Slider */}
        <div className="mb-4">
          <label htmlFor="scaleSlider" className="form-label small fw-bold">
            Region Area: <span className="text-primary">{areaAcres} acres</span>
          </label>
          <input
            type="range"
            className="form-range"
            id="scaleSlider"
            min="50"
            max="1000"
            step="1"
            value={areaAcres}
            onChange={(e) => {
              const nextAreaAcres = Number(e.target.value);
              areaAcresRef.current = nextAreaAcres;
              onAreaAcresChange(nextAreaAcres);
            }}
          />
        </div>

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