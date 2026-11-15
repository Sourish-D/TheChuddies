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
downloads are cached in the repository's ignored `hls-data/` directory, so each
computer downloads data as needed. For a shared deployed website, host the API
on a server and configure Earthdata credentials as server-side secrets; never
put them in frontend code or the repository.

## GitHub Pages deployment

The GitHub Actions workflow builds the frontend from this directory and
publishes `dist/` to the `gh-pages` branch when changes are pushed to `main`.
Configure GitHub Pages to deploy from the `gh-pages` branch and its root folder.
The frontend is static; GitHub Pages cannot run the Python API.

To enable farm data requests, deploy the Python API separately and set the
repository Actions variable `VITE_API_BASE_URL` to its HTTPS origin (for example,
`https://api.example.com`). Set `CORS_ORIGINS` on the API host to
`https://sourish-d.github.io`. Keep Earthdata credentials only in the API
host's secrets. Without the API variable, the website still deploys, and data
requests display a configuration message instead of calling a missing endpoint.

The map opens at 43.095796, -80.047. Search, enter coordinates, or click the
map to choose a location, then draw an editable polygon around the field. The
displayed area is calculated from that polygon in acres. HLS scene searches use
the polygon's bounding box, while NDVI pixels are masked to the actual polygon.
The API continues to accept the legacy `bbox` request for existing clients.

NASA POWER provides a 30-day daily summary of maximum/minimum temperature,
precipitation, relative humidity, and solar energy for the confirmed field
center, ending seven days before today to account for data latency. POWER uses
source-native spatial resolutions, so these values are regional context rather
than field-scale measurements; the app does not bilinearly interpolate them
across the field. POWER data is public and does not require Earthdata credentials.
See the [NASA POWER Daily API documentation](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
for data and spatial-resolution details.

NASA SMAP provides the latest available 3-hourly surface (0–5 cm) and root-zone
(0–100 cm) soil-moisture estimates from the SPL4SMGP Version 8 product. The API
reads the grid cell nearest the confirmed field center from NASA's protected
HDF5 granule using ranged reads; it does not download the full global file.
SMAP is an assimilated/model product on an approximately 9 km grid, so values
are regional context rather than field-scale measurements. SMAP requires the
same Earthdata Login setup as HLS. See the [NASA NSIDC SMAP L4 product page](https://nsidc.org/data/spl4smgp/versions/8).

The current data API provides HLS NDVI, NASA POWER summaries, and NASA SMAP
soil-moisture estimates. Historical weather analysis and crop-yield prediction
are not currently implemented.