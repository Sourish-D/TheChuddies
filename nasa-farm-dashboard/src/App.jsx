import './App.css'
import { useState, useEffect, useRef } from 'react'
import Geocoder from './components/Geocoder.jsx'
import MapRegion from './components/MapRegion.jsx'
import RegionGridSnapshot from './components/RegionGridSnapshot.jsx'

const DEFAULT_ADDRESS = '1302 Hwy 54, Caledonia, ON N3W 2G9'

function App() {
  const [coordinates, setCoordinates] = useState({ lat: 43.07, lon: -79.95 })
  const [areaAcres, setAreaAcres] = useState(50)
  const [submittedRegion, setSubmittedRegion] = useState(null)
  const snapshotRef = useRef(null);

  useEffect(() => {
    if (submittedRegion) {
      snapshotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [submittedRegion]);
  const [ndviResult, setNdviResult] = useState(null)
  const [ndviError, setNdviError] = useState('')

  const handleNdviResult = (result) => {
    setNdviResult(result)
    setSubmittedRegion({ ...coordinates, areaAcres })
  }

  return (
    <>
    <div className="container text-center my-5">
      <h1 className="display-4 fw-bold text-primary">We are chuddies</h1>
    </div>
    <div className="container text-center my-5">
      <Geocoder
        lat={coordinates.lat}
        lon={coordinates.lon}
        onCoordinatesChange={setCoordinates}
        initialAddress={DEFAULT_ADDRESS}
      />
      <MapRegion
        lat={coordinates.lat}
        lon={coordinates.lon}
        areaAcres={areaAcres}
        onAreaAcresChange={setAreaAcres}
        onCoordinatesChange={setCoordinates}
        onNdviResult={handleNdviResult}
        onNdviError={setNdviError}
      />
      {ndviResult && (
        <div className="alert alert-success mx-auto mt-4" style={{ maxWidth: '700px' }}>
          <strong>Average NDVI: {ndviResult.average_ndvi.toFixed(3)}</strong>
          <div className="small">Last 15 days: {ndviResult.start_date} to {ndviResult.end_date}</div>
        </div>
      )}
      {ndviError && <div className="alert alert-danger mx-auto mt-4" style={{ maxWidth: '700px' }}>{ndviError}</div>}
      {submittedRegion && (
        <div ref={snapshotRef}>
          <RegionGridSnapshot region={submittedRegion} />
        </div>
      )}
    </div>
    </>
  )
}

export default App
