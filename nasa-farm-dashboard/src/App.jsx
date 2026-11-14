import "./App.css";
import { useState } from "react";
import Geocoder from "./components/Geocoder.jsx";
import MapRegion from "./components/MapRegion.jsx";
import RegionGridSnapshot from "./components/RegionGridSnapshot.jsx";

const DEFAULT_ADDRESS = "1302 Hwy 54, Caledonia, ON N3W 2G9";

function App() {
  const [coordinates, setCoordinates] = useState({ lat: 48.8566, lon: 2.3522 })
  const [areaAcres, setAreaAcres] = useState(1)
  const [ndviResult, setNdviResult] = useState(null)
  const [ndviError, setNdviError] = useState('')
  const [powerResult, setPowerResult] = useState(null)
  const [powerError, setPowerError] = useState('')
  const [submittedRegion, setSubmittedRegion] = useState(null)

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
        initialAddress={DEFAULT_ADDRESS}
        onCoordinatesChange={setCoordinates}
      />
      <MapRegion
        lat={coordinates.lat}
        lon={coordinates.lon}
        areaAcres={areaAcres}
        onAreaAcresChange={setAreaAcres}
        onCoordinatesChange={setCoordinates}
        onNdviResult={handleNdviResult}
        onNdviError={setNdviError}
        onPowerResult={setPowerResult}
        onPowerError={setPowerError}
      />
      {ndviResult && (
        <div className="alert alert-success mx-auto mt-4" style={{ maxWidth: '700px' }}>
          <strong>Average NDVI: {ndviResult.average_ndvi.toFixed(3)}</strong>
          <div className="small">Last 15 days: {ndviResult.start_date} to {ndviResult.end_date}</div>
        </div>
      )}
      {ndviError && <div className="alert alert-danger mx-auto mt-4" style={{ maxWidth: '700px' }}>{ndviError}</div>}
      {powerResult && (
        <div className="card shadow-sm mx-auto mt-4 text-start" style={{ maxWidth: '700px' }}>
          <div className="card-body">
            <h2 className="h5 card-title">NASA POWER daily climate summary</h2>
            <p className="small text-muted">
              {powerResult.start_date} to {powerResult.end_date} (UTC), near field center
              ({powerResult.latitude.toFixed(3)}, {powerResult.longitude.toFixed(3)}).
              Grid data is source-native resolution, not field-scale interpolation.
            </p>
            <div className="row g-2">
              <ClimateValue label="Average daily high" value={powerResult.summary.tmax_c_avg} unit="°C" days={powerResult.valid_days.tmax} />
              <ClimateValue label="Average daily low" value={powerResult.summary.tmin_c_avg} unit="°C" days={powerResult.valid_days.tmin} />
              <ClimateValue label="Total precipitation" value={powerResult.summary.precipitation_mm_total} unit="mm" days={powerResult.valid_days.precipitation} />
              <ClimateValue label="Average humidity" value={powerResult.summary.relative_humidity_pct_avg} unit="%" days={powerResult.valid_days.humidity} />
              <ClimateValue label="Average solar energy" value={powerResult.summary.solar_mj_m2_day_avg} unit="MJ/m²/day" days={powerResult.valid_days.solar} />
            </div>
          </div>
        </div>
      )}
      {powerError && <div className="alert alert-danger mx-auto mt-4" style={{ maxWidth: '700px' }}>{powerError}</div>}
      {submittedRegion && (
        <div>
          <RegionGridSnapshot region={submittedRegion} />
        </div>
      )}
    </div>
    </>
  );
}

function ClimateValue({ label, value, unit, days }) {
  return (
    <div className="col-12 col-sm-6">
      <div className="border rounded p-2 h-100">
        <div className="small text-muted">{label}</div>
        <strong>{value == null ? "Unavailable" : `${value} ${unit}`}</strong>
        <div className="small text-muted">{days} valid days</div>
      </div>
    </div>
  );
}

export default App;
