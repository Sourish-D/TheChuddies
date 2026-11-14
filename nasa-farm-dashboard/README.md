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

The map area slider sets the square's area in acres. NASA POWER provides a
30-day daily summary of maximum/minimum temperature, precipitation, relative
humidity, and solar energy for the selected center point, ending seven days
before today to account for data latency. POWER uses source-native spatial
resolutions, so these climate values are regional context rather than
field-scale measurements; the app does not bilinearly interpolate them across
the field. POWER data is public and does not require Earthdata credentials.
See the [NASA POWER Daily API documentation](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
for data and spatial-resolution details.