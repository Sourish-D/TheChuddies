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

The current data API provides HLS NDVI and NASA POWER summaries. Historical
weather analysis and crop-yield prediction are not currently implemented.