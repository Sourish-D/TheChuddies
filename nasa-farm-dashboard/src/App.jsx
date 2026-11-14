import './App.css'
import { useState } from 'react'
import Geocoder from './components/Geocoder.jsx'
import MapRegion from './components/MapRegion.jsx'

function App() {
  const [coordinates, setCoordinates] = useState({ lat: 48.8566, lon: 2.3522 })
  const [ndviResult, setNdviResult] = useState(null)
  const [ndviError, setNdviError] = useState('')

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
      />
      <MapRegion
        lat={coordinates.lat}
        lon={coordinates.lon}
        onCoordinatesChange={setCoordinates}
        onNdviResult={setNdviResult}
        onNdviError={setNdviError}
      />
      {ndviResult && (
        <div className="alert alert-success mx-auto mt-4" style={{ maxWidth: '700px' }}>
          <strong>Average NDVI: {ndviResult.average_ndvi.toFixed(3)}</strong>
          <div className="small">Last 15 days: {ndviResult.start_date} to {ndviResult.end_date}</div>
        </div>
      )}
      {ndviError && <div className="alert alert-danger mx-auto mt-4" style={{ maxWidth: '700px' }}>{ndviError}</div>}
    </div>
    </>
  )
}

export default App
