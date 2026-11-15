# TheChuddies

We are the chuddies and we are here to win

## Run locally

Install Node.js and Python 3. From the repository root, set up the dashboard:

```sh
cd nasa-farm-dashboard
npm install
npm run setup
npm run auth
npm run dev
```

The frontend now includes a Gemini season-analysis panel after you confirm a
field. It fetches NASA POWER and Landsat/HLS observations for the selected date
range and the same dates in the previous year, then sends the aggregated data
and crop details to the backend for grounded Markdown analysis. Optional SMAP
data requires Earthdata login. No Random Forest model is included; any yield
estimate must come from an external model.

For local use, add `GEMINI_API_KEY=your-key` to the repository-root `.env`.
The backend reads this ignored file on startup; the frontend never receives
the key. Restart `npm run dev` after editing it. Never paste the key into the
React app or commit it. For deployment, configure it as a secret on the API
server. `VITE_API_BASE_URL` only points the browser to the API and must never
contain a Gemini key.

`npm run setup` creates a Python virtual environment and installs the backend
dependencies. `npm run auth` signs in to NASA Earthdata once and saves the
credentials locally in your home directory (`.netrc`, or `_netrc` on Windows).
Do not commit or share this credentials file. After setup, `npm run dev` starts
both the website and Python API; open the local URL printed by Vite and press
Ctrl+C to stop the services.

Each computer needs its own setup and Earthdata login. HLS downloads are cached
locally in the ignored `hls-data/` directory. To serve the app to everyone from
a shared deployment, host the Python API and store Earthdata credentials
securely on that server; never put credentials in the frontend or repository.

The Leaflet map opens at 43.095796, -80.047. Choose a location, draw and edit
the field boundary, review the calculated area in acres, and confirm it before
requesting data. HLS NDVI is masked to the selected polygon. NASA POWER provides
recent daily temperature, precipitation, humidity, and solar-energy summaries
near the confirmed field center. POWER data is provided at its native, regional
grid resolution, so it is context for the field rather than a field-scale
estimate. The app does not bilinearly interpolate coarse grid data over the
selected boundary.
The [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
is public and does not require Earthdata credentials.

The backend returns dated NASA POWER weather records and dated HLS scene NDVI
averages for seasonal comparisons, along with current NASA SMAP soil-moisture
context. `POST /api/agronomy/analyze` assembles season features (including GDD
and precipitation anomalies) and returns grounded Gemini Markdown for the
React client. Configure `GEMINI_API_KEY` on the API server to enable it.

The repository does not include a Random Forest model or yield-training dataset.
Yield predictions can be included in the analysis payload if supplied by an
external model; the backend does not create estimates.