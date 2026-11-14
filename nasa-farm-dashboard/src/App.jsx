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
  const [weatherData, setWeatherData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const snapshotRef = useRef(null);

 useEffect(() => {
    // NASA POWER API URL for Guelph, Ontario (Agroclimatology community)
    const url = "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN&community=AG&longitude=-80.2482&latitude=43.5448&start=20260101&end=20261101&format=JSON";

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then((data) => {
        // Extract properties and daily parameter values
        setWeatherData(data.properties.parameter);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (submittedRegion) {
      snapshotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [submittedRegion]);

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
        onCoordinatesChange={setCoordinates}
        areaAcres={areaAcres}
        onAreaAcresChange={setAreaAcres}
      />
      <button
        type="button"
        className="btn btn-primary mt-3"
        onClick={() => setSubmittedRegion({ ...coordinates, areaAcres })}
      >
        Submit Region
      </button>
      {submittedRegion && (
        <div ref={snapshotRef}>
          <RegionGridSnapshot region={submittedRegion} />
        </div>
      )}
    </div>
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Ontario Farm Weather Dashboard (NASA POWER)</h1>
      <p>Location: Guelph, ON (Lat: 43.5448, Lon: -80.2482)</p>
      {loading && <p role="status">Loading NASA agricultural data...</p>}
      {error && <p role="alert" style={{ color: 'red' }}>Error loading NASA data: {error}</p>}
      {weatherData && (
        <>
          <h2>Recent Temperature Records (°C)</h2>
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #ccc', padding: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: '8px' }}>Date</th>
                  <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: '8px' }}>Mean Temp (°C)</th>
                  <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: '8px' }}>Max Temp (°C)</th>
                  <th style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: '8px' }}>Min Temp (°C)</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(weatherData.T2M).map((dateKey) => (
                  <tr key={dateKey}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{dateKey}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{weatherData.T2M[dateKey]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{weatherData.T2M_MAX[dateKey]}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{weatherData.T2M_MIN[dateKey]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
    </>
  )
}

export default App
