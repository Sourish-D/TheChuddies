"""Authenticate to Earthdata and save credentials for this computer."""

import earthaccess


auth = earthaccess.login(persist=True)
if not auth.authenticated:
    raise SystemExit(
        "Earthdata authentication failed. Check your Earthdata Login credentials and try again."
    )

print("Earthdata credentials saved locally for this computer.")
