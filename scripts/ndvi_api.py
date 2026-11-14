"""Small local API for the farm dashboard's HLS NDVI analysis."""

from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from scripts.hls_ndvi import average_hls_ndvi


app = FastAPI()


class NdviRequest(BaseModel):
    bbox: tuple[float, float, float, float]


@app.post("/api/ndvi")
def calculate_ndvi(request: NdviRequest) -> dict[str, float | str]:
    try:
        end = date.today()
        score = average_hls_ndvi(
            request.bbox,
            (end - timedelta(days=14)).isoformat(),
            end.isoformat(),
            Path("hls-data"),
        )
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"average_ndvi": score, "start_date": (end - timedelta(days=14)).isoformat(),
            "end_date": end.isoformat()}
