import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ACRES_TO_SQUARE_METERS = 4046.8564224;

function getSquareBounds(region) {
  const sideLengthMeters = Math.sqrt(region.areaAcres * ACRES_TO_SQUARE_METERS);
  return L.latLng(region.lat, region.lon).toBounds(sideLengthMeters);
}

export default function RegionGridSnapshot({ region }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const gridLayerRef = useRef(null);
  const selectedCellsRef = useRef(new Set());
  const [selection, setSelection] = useState({ region: null, indices: [] });

  useEffect(() => {
    const map = L.map(mapContainerRef.current, {
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      gridLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = getSquareBounds(region);
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();
    const cellHeight = (north - south) / 10;
    const cellWidth = (east - west) / 10;
    const gridLayer = L.layerGroup();

    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const index = row * 10 + column;
        const cellBounds = L.latLngBounds(
          [north - (row + 1) * cellHeight, west + column * cellWidth],
          [north - row * cellHeight, west + (column + 1) * cellWidth]
        );
        const cell = L.rectangle(cellBounds, {
          color: '#084298',
          weight: 1,
          fillColor: '#0d6efd',
          fillOpacity: 0.12,
        });

        cell.on('click', () => {
          const nextSelected = new Set(selectedCellsRef.current);
          const isSelected = nextSelected.has(index);
          if (isSelected) {
            nextSelected.delete(index);
          } else {
            nextSelected.add(index);
          }

          cell.setStyle({
            fillColor: isSelected ? '#0d6efd' : '#ffc107',
            fillOpacity: isSelected ? 0.12 : 0.55,
          });
          selectedCellsRef.current = nextSelected;
          setSelection({ region, indices: [...nextSelected] });
        });

        cell.addTo(gridLayer);
      }
    }

    if (gridLayerRef.current) {
      gridLayerRef.current.remove();
    }

    gridLayer.addTo(map);
    gridLayerRef.current = gridLayer;
    selectedCellsRef.current = new Set();
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
  }, [region]);

  const cellAreaAcres = region.areaAcres / 100;
  const selectedCells = selection.region === region ? selection.indices : [];

  return (
    <section className="region-snapshot card shadow p-4 border-0 rounded-4 mt-4 mx-auto">
      <h2 className="h4 mb-2 fw-bold text-primary">Selected Region Copy</h2>
      <p className="small text-muted mb-3">
        {region.areaAcres} acres centered at {region.lat.toFixed(5)}, {region.lon.toFixed(5)}.
        Select grid cells to highlight them; each cell covers approximately {cellAreaAcres.toFixed(2)} acres.
        {' '}{selectedCells.length} of 100 cells selected.
      </p>
      <div
        ref={mapContainerRef}
        className="region-snapshot-map rounded-3 border shadow-sm"
        role="application"
        aria-label="Snapshot map with selectable 10 by 10 region grid"
      />
    </section>
  );
}
