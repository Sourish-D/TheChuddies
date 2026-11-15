# Local development

Install Node.js and Python 3, then from this directory run:

```sh
npm install
npm run setup
npm run auth
npm run dev
```

`npm run setup` creates a local Python virtual environment and installs the
backend dependencies. `npm run auth` prompts for Earthdata Login once and asks
earthaccess to save the credentials in your home directory's `.netrc` file
(`_netrc` on Windows). The NDVI API also persists credentials if you skip this
step. Do not commit or share that credentials file.

`npm run dev` starts both the Vite website and the Python API. Open the local
URL printed by Vite. Stop both services with Ctrl+C.

Each developer computer needs its own setup and Earthdata authentication. HLS
downloads are stored in a per-run temporary directory under the operating
system's temp folder. Pressing Ctrl+C stops the services and removes that
directory, along with any legacy repository `hls-data/` cache. SMAP is read
remotely and only its requested values are retained in memory. For a shared
deployed website, host the API on a server and configure Earthdata credentials
as server-side secrets; never put them in frontend code or the repository.

To use agronomy analysis locally, add your key to the repository-root `.env`:

```dotenv
GEMINI_API_KEY=your-key
# GEMINI_MODEL=gemini-3.6-flash
```

The API loads that file when it starts; `.env` is ignored by Git and is not
loaded into the browser. `GEMINI_MODEL` is optional and defaults to
`gemini-3.6-flash`. The API retries transient errors up to two times; an
optional `GEMINI_FALLBACK_MODEL` can be set if you want another model tried
after it. Restart `npm run dev` after changing the file.

## GitHub Pages deployment

The GitHub Actions workflow builds the frontend from this directory and
publishes `dist/` to the `gh-pages` branch when changes are pushed to `main`.
Configure GitHub Pages to deploy from the `gh-pages` branch and its root folder.
The frontend is static; GitHub Pages cannot run the Python API.

To enable farm data requests, deploy the Python API separately and set the
repository Actions variable `VITE_API_BASE_URL` to its HTTPS origin (for example,
`https://api.example.com`). Set `CORS_ORIGINS` on the API host to
`https://sourish-d.github.io`. Keep Earthdata credentials only in the API
host's secrets. Set `GEMINI_API_KEY` on the API host to enable agronomy analysis;
optionally set `GEMINI_MODEL` to choose another supported Gemini model. Never
put API keys in frontend code or repository files. Without the API variable, the
website still deploys, and data requests display a configuration message instead
of calling a missing endpoint.

The map opens at 43.095796, -80.047. Search, enter coordinates, or click the
map to choose a location, then draw an editable polygon around the field. The
displayed area is calculated from that polygon in acres. HLS NDVI searches up to
the latest 60 days of scenes with at most 30% cloud cover. Scene searches use
the polygon's bounding box, while NDVI pixels are masked to the actual polygon.
The API continues to accept the legacy `bbox` request for existing clients.

NASA POWER provides a 30-day summary of maximum/minimum temperature,
precipitation, relative humidity, and solar energy for the confirmed field
center, ending seven days before today to account for data latency. Its daily
response also includes dated temperature and precipitation values; callers may
request a date range of up to ten years. POWER uses source-native spatial
resolutions, so these values are regional context rather than field-scale
measurements; the app does not bilinearly interpolate them across the field.
POWER data is public and does not require Earthdata credentials.
See the [NASA POWER Daily API documentation](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
for data and spatial-resolution details.

NASA SMAP provides the latest available 3-hourly surface (0–5 cm) and root-zone
(0–100 cm) soil-moisture estimates from the SPL4SMGP Version 8 product. The API
reads the grid cell nearest the confirmed field center from NASA's protected
HDF5 granule using ranged reads; it does not download the full global file.
SMAP is an assimilated/model product on an approximately 9 km grid, so values
are regional context rather than field-scale measurements. SMAP requires the
same Earthdata Login setup as HLS. See the [NASA NSIDC SMAP L4 product page](https://nsidc.org/data/spl4smgp/versions/8).

The NDVI endpoint returns dated HLS scene averages as well as the existing
window average. The default window is 60 days; explicit requests may cover up to
366 days, so query one growing season at a time for year-over-year comparisons.
The API computes NDVI from HLS surface reflectance after applying the 0.0001
scale factor.

`POST /api/agronomy/analyze` accepts dated weather and NDVI records grouped by
season, optional SMAP root-zone observations and baselines, crop history, crop
profiles, and externally generated yield predictions. It returns
`analysis_markdown`, `feature_payload`, and `random_forest_features` for a React
client. The feature assembler calculates daily and seasonal GDD (10 °C base by
default), cumulative precipitation and supplied-baseline anomalies, NDVI
summaries, root-zone moisture anomalies, and year-over-year comparisons. Keep
rainfall (mm) and volumetric soil moisture (m³/m³) as separate features; they
are not combined into an invented water-availability unit.

NDVI values are whole-field scene averages, not per-pixel vegetation; SMAP is
one nearest-grid-cell value, not field-scale soil moisture. These are not
rendered as map layers. The agronomy walkthrough smoothly reframes the selected
field and shows a pulsing numbered guide marker as its cards advance, without
implying within-field data. It requests exactly three qualified rotation ideas.

The Gemini system instruction keeps field-specific measurements grounded in
the supplied payload while allowing clearly labeled qualitative agronomy
knowledge for crop traits, synergies, and conditional rotation advice. It must
flag conflicts such as corn marked nitrogen-fixing, and cannot infer site
conditions, numeric yields, or exact input rates. It can compare observed
weather and vegetation with general crop needs, then provide a qualitative
yield outlook when supported; these are not local climate normals or a yield
prediction. Add crop history oldest-to-newest,
ideally with one year per line (for example `2023: corn`, `2024: soybeans`,
`2025: corn`) to enable useful rotation reasoning. Without sufficient history
or local soil and management details, recommendations remain conditional. This
repository does not include a Random Forest model or yield-training dataset:
the API accepts externally generated predictions but does not generate them.
Temporary Gemini 429/5xx service failures are retried up to two times.
SDK-internal retries are disabled and each attempt has a 45-second timeout,
so persistent provider failures return to the frontend instead of leaving the
request pending for several minutes. Analysis is limited to five concise
walkthrough cards with plain-text bullets.

The agronomy workflow requests NASA POWER once for the combined comparison
period, then splits the daily observations between seasons. If NASA POWER
returns HTTP 429, the API reports its rate-limit message as HTTP 503 rather
than masking it as a generic 502; wait and retry if NASA's limit is active.

The season records accept the daily field names returned by `/api/power` and
the `{date, ndvi}` observations returned by `/api/ndvi`. For example:

```json
{
  "seasons": [{
    "year": 2025,
    "start_date": "2025-05-01",
    "end_date": "2025-09-30",
    "weather": [{
      "date": "2025-05-01",
      "t2m_max_c": 20.0,
      "t2m_min_c": 10.0,
      "precipitation_mm": 3.2
    }],
    "ndvi": [{"date": "2025-05-01", "ndvi": 0.62}],
    "rootzone_soil_moisture_m3_m3": 0.28,
    "rootzone_normal_m3_m3": 0.31,
    "precipitation_normal_mm": 420.0
  }],
  "crop_history": [{"year": 2024, "crop": "soybean"}],
  "crop_profiles": [{
    "crop": "soybean",
    "nitrogen_fixing": true,
    "root_depth_class": "medium",
    "pest_host_groups": []
  }],
  "yield_predictions": [{
    "year": 2025,
    "crop": "corn",
    "predicted_yield": 185.5,
    "units": "bu/acre",
    "model": "Random Forest"
  }]
}
```

For reflectance-based NDVI input, provide `red_dn` and `nir_dn` instead of
`ndvi`; `scale_factor` defaults to the HLS value `0.0001`. Provide a
`precipitation_normal_mm` for the same seasonal date interval to calculate a
precipitation anomaly. SMAP anomaly requires a supplied
`rootzone_normal_m3_m3`. Missing observations and baselines stay null rather
than being estimated.