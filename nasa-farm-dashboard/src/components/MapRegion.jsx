import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import './leaflet-draw-init.js'
import Geocoder from './Geocoder.jsx'

const acresPerSquareMeter = 1 / 4046.8564224
const earthRadiusMeters = 6371008.8

function ringArea(ring) {
  let total = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [longitude1, latitude1] = ring[index]
    const [longitude2, latitude2] = ring[index + 1]
    total += (longitude2 - longitude1) * Math.PI / 180
      * (2 + Math.sin(latitude1 * Math.PI / 180) + Math.sin(latitude2 * Math.PI / 180))
  }
  return Math.abs(total * earthRadiusMeters ** 2 / 2)
}

function geometryAreaAcres(geometry) {
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return 0
  const [outerRing, ...holes] = geometry.coordinates
  if (!Array.isArray(outerRing)) return 0
  const area = ringArea(outerRing) - holes.reduce((total, ring) => total + ringArea(ring), 0)
  return Math.max(0, area * acresPerSquareMeter)
}

function formattedAcres(value) {
  return value < 10 ? value.toFixed(2) : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function shiftedLatLngs(latlngs, latitudeDelta, longitudeDelta) {
  if (Array.isArray(latlngs)) {
    return latlngs.map((latlng) => shiftedLatLngs(latlng, latitudeDelta, longitudeDelta))
  }
  return L.latLng(latlngs.lat + latitudeDelta, latlngs.lng + longitudeDelta)
}

function selectedCenter(layer) {
  const center = layer.getBounds().getCenter()
  return { lat: center.lat, lon: center.lng }
}

export default function MapRegion({
  lat,
  lon,
  onCoordinatesChange,
  selectedGeometry,
  selectionConfirmed,
  fieldAreaAcres,
  onSelectionConfirm,
  onSelectionReset,
  onNdviResult,
  onNdviError,
  onPowerResult,
  onPowerError,
}) {
  const [step, setStep] = useState(() => (selectionConfirmed ? 3 : 1))
  const [boundaryGeometry, setBoundaryGeometry] = useState(selectedGeometry)
  const [areaAcres, setAreaAcres] = useState(
    fieldAreaAcres ?? geometryAreaAcres(selectedGeometry),
  )
  const [isDrawing, setIsDrawing] = useState(false)
  const [vertexCount, setVertexCount] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [moveMode, setMoveMode] = useState(false)
  const [loadingNdvi, setLoadingNdvi] = useState(false)
  const [loadingPower, setLoadingPower] = useState(false)
  const [mapError, setMapError] = useState('')

  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const boundaryLayerRef = useRef(null)
  const stepRef = useRef(step)
  const moveModeRef = useRef(moveMode)
  const coordinatesRef = useRef({ lat, lon })
  const drawHandlerRef = useRef(null)
  const callbacksRef = useRef({ onCoordinatesChange, onSelectionReset })
  const initialValuesRef = useRef({ lat, lon, selectedGeometry })

  useEffect(() => {
    stepRef.current = step
    moveModeRef.current = moveMode
    coordinatesRef.current = { lat, lon }
    callbacksRef.current = { onCoordinatesChange, onSelectionReset }
  }, [lat, lon, moveMode, onCoordinatesChange, onSelectionReset, step])

  useEffect(() => {
    const initialValues = initialValuesRef.current
    const map = L.map(mapContainerRef.current, { crs: L.CRS.EPSG3857 })
      .setView([initialValues.lat, initialValues.lon], 12)
    mapInstanceRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    const markerIcon = L.divIcon({
      className: 'farm-marker-icon',
      html: '<span class="farm-marker"></span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    })
    markerRef.current = L.marker([initialValues.lat, initialValues.lon], { icon: markerIcon })
      .bindTooltip('Selected farm location')
      .addTo(map)

    const applyGeometry = (layer) => {
      boundaryLayerRef.current = layer
      layer.on('edit', () => {
        const geometry = layer.toGeoJSON().geometry
        setBoundaryGeometry(geometry)
        setAreaAcres(geometryAreaAcres(geometry))
      })
    }

    if (initialValues.selectedGeometry) {
      const feature = { type: 'Feature', properties: {}, geometry: initialValues.selectedGeometry }
      const existingLayer = L.geoJSON(feature, {
        style: { color: '#315b3b', fillColor: '#739968', fillOpacity: 0.3, weight: 3 },
      }).getLayers()[0]
      if (existingLayer) {
        existingLayer.addTo(map)
        applyGeometry(existingLayer)
      }
    }

    const handleMapClick = (event) => {
      if (stepRef.current === 1 && !moveModeRef.current) {
        const nextCoordinates = { lat: event.latlng.lat, lon: event.latlng.lng }
        coordinatesRef.current = nextCoordinates
        markerRef.current.setLatLng(event.latlng)
        callbacksRef.current.onCoordinatesChange(nextCoordinates)
        return
      }

      if (moveModeRef.current && boundaryLayerRef.current) {
        const center = boundaryLayerRef.current.getBounds().getCenter()
        const latitudeDelta = event.latlng.lat - center.lat
        const longitudeDelta = event.latlng.lng - center.lng
        boundaryLayerRef.current.setLatLngs(
          shiftedLatLngs(boundaryLayerRef.current.getLatLngs(), latitudeDelta, longitudeDelta),
        )
        boundaryLayerRef.current.redraw()
        markerRef.current.setLatLng(event.latlng)
        const geometry = boundaryLayerRef.current.toGeoJSON().geometry
        setBoundaryGeometry(geometry)
        setAreaAcres(geometryAreaAcres(geometry))
        coordinatesRef.current = { lat: event.latlng.lat, lon: event.latlng.lng }
        callbacksRef.current.onCoordinatesChange(coordinatesRef.current)
        callbacksRef.current.onSelectionReset()
        moveModeRef.current = false
        setMoveMode(false)
        setStep(3)
        stepRef.current = 3
      }
    }

    const handleCreated = (event) => {
      if (boundaryLayerRef.current) map.removeLayer(boundaryLayerRef.current)
      const layer = event.layer
      layer.setStyle({ color: '#315b3b', fillColor: '#739968', fillOpacity: 0.3, weight: 3 })
      layer.addTo(map)
      applyGeometry(layer)
      const geometry = layer.toGeoJSON().geometry
      setBoundaryGeometry(geometry)
      setAreaAcres(geometryAreaAcres(geometry))
      setIsDrawing(false)
      setIsEditing(false)
      setStep(3)
      stepRef.current = 3
      markerRef.current.setLatLng(layer.getBounds().getCenter())
    }

    const handleDrawStart = () => setIsDrawing(true)
    const handleDrawStop = () => setIsDrawing(false)
    const handleDrawVertex = (event) => setVertexCount(event.layers.getLayers().length)
    map.on('click', handleMapClick)
    map.on(L.Draw.Event.CREATED, handleCreated)
    map.on(L.Draw.Event.DRAWSTART, handleDrawStart)
    map.on(L.Draw.Event.DRAWSTOP, handleDrawStop)
    map.on(L.Draw.Event.DRAWVERTEX, handleDrawVertex)

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    resizeObserver.observe(mapContainerRef.current)
    const resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }))

    return () => {
      cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      drawHandlerRef.current?.disable()
      map.remove()
      mapInstanceRef.current = null
      markerRef.current = null
      boundaryLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    markerRef.current?.setLatLng([lat, lon])
    map.setView([lat, lon], map.getZoom(), { animate: false })
  }, [lat, lon])

  const forgetConfirmedSelection = () => {
    if (selectionConfirmed) onSelectionReset()
  }

  const startDrawing = () => {
    const map = mapInstanceRef.current
    if (!map || !L.Draw?.Polygon) {
      setMapError('The boundary drawing tools could not be loaded. Please reload the page and try again.')
      return
    }
    setMapError('')
    setVertexCount(0)
    forgetConfirmedSelection()
    const handler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: true,
      metric: false,
      shapeOptions: { color: '#315b3b', fillColor: '#739968', fillOpacity: 0.3, weight: 3 },
    })
    drawHandlerRef.current = handler
    handler.enable()
  }

  const finishDrawing = () => {
    if (vertexCount >= 3) drawHandlerRef.current?.completeShape()
  }

  const cancelDrawing = () => {
    drawHandlerRef.current?.disable()
    setIsDrawing(false)
    setVertexCount(0)
  }

  const startEditing = () => {
    if (!boundaryLayerRef.current?.editing) {
      setMapError('The boundary edit tools could not be loaded. Please redraw the boundary.')
      return
    }
    forgetConfirmedSelection()
    boundaryLayerRef.current.editing.enable()
    setIsEditing(true)
    setStep(2)
    stepRef.current = 2
  }

  const saveEdits = () => {
    boundaryLayerRef.current?.editing?.disable()
    if (boundaryLayerRef.current) {
      const geometry = boundaryLayerRef.current.toGeoJSON().geometry
      setBoundaryGeometry(geometry)
      setAreaAcres(geometryAreaAcres(geometry))
    }
    setIsEditing(false)
    setStep(3)
    stepRef.current = 3
  }

  const moveBoundary = () => {
    forgetConfirmedSelection()
    setMoveMode(true)
    moveModeRef.current = true
    setStep(2)
    stepRef.current = 2
  }

  const clearBoundary = () => {
    drawHandlerRef.current?.disable()
    if (boundaryLayerRef.current) {
      boundaryLayerRef.current.editing?.disable()
      mapInstanceRef.current?.removeLayer(boundaryLayerRef.current)
      boundaryLayerRef.current = null
    }
    setBoundaryGeometry(null)
    setAreaAcres(0)
    setIsDrawing(false)
    setIsEditing(false)
    setMoveMode(false)
    moveModeRef.current = false
  }

  const resetSelection = () => {
    clearBoundary()
    onSelectionReset()
    setStep(1)
    stepRef.current = 1
    setMapError('')
  }

  const confirmSelection = () => {
    if (!boundaryLayerRef.current || !boundaryGeometry) return
    const center = selectedCenter(boundaryLayerRef.current)
    markerRef.current?.setLatLng([center.lat, center.lon])
    onSelectionConfirm({ geometry: boundaryGeometry, areaAcres, coordinates: center })
    setStep(3)
    stepRef.current = 3
  }

  const calculateNdvi = async () => {
    setLoadingNdvi(true)
    onNdviError('')
    onNdviResult(null)
    try {
      const response = await fetch('/api/ndvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: selectedGeometry ?? boundaryGeometry }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'NDVI calculation failed.')
      onNdviResult(data)
    } catch (error) {
      onNdviError(error instanceof Error ? error.message : 'NDVI calculation failed.')
    } finally {
      setLoadingNdvi(false)
    }
  }

  const fetchPowerData = async () => {
    setLoadingPower(true)
    onPowerError('')
    onPowerResult(null)
    try {
      const response = await fetch('/api/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lon }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'NASA POWER request failed.')
      onPowerResult(data)
    } catch (error) {
      onPowerError(error instanceof Error ? error.message : 'NASA POWER request failed.')
    } finally {
      setLoadingPower(false)
    }
  }

  const handleCoordinatesChange = (nextCoordinates) => {
    onCoordinatesChange(nextCoordinates)
    setMapError('')
  }

  return (
    <section className="farm-workspace" aria-label="Farm location and boundary">
      <aside className="workflow-panel">
        <div className="workflow-progress" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((number) => (
            <div className={`workflow-progress-step${number === step ? ' is-active' : ''}${number < step ? ' is-complete' : ''}`} key={number}>
              <span>{number < step ? '✓' : `0${number}`}</span>
              <small>{['Location', 'Boundary', 'Confirm'][number - 1]}</small>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="workflow-content">
            <span className="section-kicker">STEP 1 · LOCATION</span>
            <h2>Select your farm location</h2>
            <p>Search for a place, enter coordinates, or click the map to set the centre of your field.</p>
            <Geocoder lat={lat} lon={lon} onCoordinatesChange={handleCoordinatesChange} />
            <button className="button button--primary workflow-button" onClick={() => {
              setStep(2)
              stepRef.current = 2
            }}>
              Use this location <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="workflow-content">
            <span className="section-kicker">STEP 2 · BOUNDARY</span>
            <h2>Outline your field</h2>
            {isDrawing ? (
              <p>Click the map to add points, then finish the outline.</p>
            ) : moveMode ? (
              <p>Click the map where you’d like to move the whole boundary.</p>
            ) : isEditing ? (
              <p>Drag the boundary points to refine the outline, then save your changes.</p>
            ) : (
              <p>Draw around the edge of your field, then finish the outline when it looks right.</p>
            )}
            <div className="boundary-actions">
              {isDrawing ? (
                <>
                  <button className="button button--primary" onClick={finishDrawing} disabled={vertexCount < 3}>
                    Finish boundary
                  </button>
                  <button className="button button--outline" onClick={cancelDrawing}>Cancel drawing</button>
                </>
              ) : isEditing ? (
                <button className="button button--primary" onClick={saveEdits}>Save boundary</button>
              ) : (
                <>
                  {!moveMode && (
                    <button className="button button--primary" onClick={startDrawing}>
                      {boundaryGeometry ? 'Redraw boundary' : 'Draw boundary'}
                    </button>
                  )}
                  {boundaryGeometry && !moveMode && (
                    <>
                      <button className="button button--outline" onClick={startEditing}>Edit points</button>
                      <button className="button button--outline" onClick={moveBoundary}>Move boundary</button>
                    </>
                  )}
                </>
              )}
              {boundaryGeometry && !moveMode && (
                <button className="text-button" onClick={() => {
                  clearBoundary()
                  setStep(2)
                  stepRef.current = 2
                }}>Clear boundary</button>
              )}
              {moveMode && (
                <button className="text-button" onClick={() => {
                  setMoveMode(false)
                  moveModeRef.current = false
                  setStep(3)
                  stepRef.current = 3
                }}>Cancel move</button>
              )}
              {!isEditing && !moveMode && boundaryGeometry && (
                <button className="button button--primary" onClick={() => {
                  setStep(3)
                  stepRef.current = 3
                }}>Review boundary <span aria-hidden="true">→</span></button>
              )}
            </div>
            {boundaryGeometry && <p className="area-readout">Selected area <strong>{formattedAcres(areaAcres)}</strong> acres</p>}
          </div>
        )}

        {step === 3 && boundaryGeometry && (
          <div className="workflow-content">
            <span className="section-kicker">STEP 3 · CONFIRM</span>
            <h2>{selectionConfirmed ? 'Your field is ready' : 'Review your field'}</h2>
            <p>Check that the outline follows your farm boundary. You can edit or move it before using the data tools.</p>
            <div className="selection-summary">
              <span>Selected area</span>
              <strong>{formattedAcres(areaAcres)} acres</strong>
              <small>{lat.toFixed(5)}°, {lon.toFixed(5)}° · WGS84</small>
            </div>
            <div className="boundary-actions">
              <button className="button button--outline" onClick={() => {
                forgetConfirmedSelection()
                setStep(2)
                stepRef.current = 2
              }}>Edit boundary</button>
              <button className="button button--outline" onClick={moveBoundary}>Move boundary</button>
              <button className="text-button" onClick={resetSelection}>Start over</button>
              {!selectionConfirmed && (
                <button className="button button--primary" onClick={confirmSelection}>
                  Confirm selection <span aria-hidden="true">✓</span>
                </button>
              )}
            </div>
            {selectionConfirmed && (
              <div className="data-actions">
                <p>Use your confirmed field for available satellite and climate data.</p>
                <button className="button button--primary" onClick={calculateNdvi} disabled={loadingNdvi}>
                  {loadingNdvi ? 'Reading satellite data…' : 'Calculate field NDVI'}
                </button>
                <button className="button button--outline" onClick={fetchPowerData} disabled={loadingPower}>
                  {loadingPower ? 'Loading climate…' : 'Get climate data'}
                </button>
              </div>
            )}
          </div>
        )}

        {mapError && <p className="form-error" role="alert">{mapError}</p>}
      </aside>

      <div className="map-panel">
        <div className="map-panel-heading">
          <div>
            <span className="section-kicker">INTERACTIVE FIELD MAP</span>
            <p>{step === 1 ? 'Pan and zoom, then click to choose a location.' : 'Use the map controls to shape your field boundary.'}</p>
          </div>
          {boundaryGeometry && <span className="area-readout"><strong>{formattedAcres(areaAcres)}</strong> acres</span>}
        </div>
        <div ref={mapContainerRef} className="field-map" />
        {isDrawing && <p className="map-hint" role="status">Add at least three points around your field.</p>}
      </div>
    </section>
  )
}
