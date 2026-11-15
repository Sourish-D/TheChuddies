"""Small local API for the farm dashboard's HLS NDVI analysis."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from math import isfinite
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from scripts.hls_ndvi import average_hls_ndvi, polygon_bounds
from scripts.smap_data import SmapDataError, get_smap_data


app = FastAPI()
cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["POST"],
        allow_headers=["Content-Type"],
    )

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class NdviRequest(BaseModel):
    bbox: tuple[float, float, float, float] | None = None
    geometry: dict[str, object] | None = None

    @model_validator(mode="after")
    def validate_field(self) -> NdviRequest:
        if self.geometry is None and self.bbox is None:
            raise ValueError("Provide either a bbox or a GeoJSON Polygon geometry.")
        if self.geometry is not None:
            polygon_bounds(self.geometry)
        return self


class PowerRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class SmapRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@app.post("/api/ndvi")
def calculate_ndvi(request: NdviRequest) -> dict[str, float | str]:
    try:
        end = date.today()
        bounding_box = (
            polygon_bounds(request.geometry)
            if request.geometry is not None
            else request.bbox
        )
        if bounding_box is None:
            raise ValueError("Provide either a bbox or a GeoJSON Polygon geometry.")
        score = average_hls_ndvi(
            bounding_box,
            (end - timedelta(days=14)).isoformat(),
            end.isoformat(),
            PROJECT_ROOT / "hls-data",
            field_geometry=request.geometry,
        )
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"average_ndvi": score, "start_date": (end - timedelta(days=14)).isoformat(),
            "end_date": end.isoformat()}


@app.post("/api/power")
def get_power_data(request: PowerRequest) -> dict[str, object]:
    """Fetch a recent month of daily NASA POWER agricultural climate data."""
    end = date.today() - timedelta(days=7)
    start = end - timedelta(days=29)
    return get_power_data_cached(request.latitude, request.longitude, start, end)


@app.post("/api/smap")
def get_smap_soil_moisture(request: SmapRequest) -> dict[str, object]:
    """Fetch the latest available NASA SMAP soil-moisture estimate."""
    try:
        now = datetime.now(timezone.utc)
        cache_bucket = now.replace(
            hour=(now.hour // 3) * 3,
            minute=0,
            second=0,
            microsecond=0,
        )
        return get_smap_data_cached(
            request.latitude,
            request.longitude,
            cache_bucket,
        )
    except SmapDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@lru_cache(maxsize=256)
def get_smap_data_cached(
    latitude: float,
    longitude: float,
    cache_bucket: datetime,
) -> dict[str, object]:
    if cache_bucket.tzinfo is None:
        raise ValueError("SMAP cache bucket must be timezone-aware.")
    return get_smap_data(latitude, longitude)


@lru_cache(maxsize=256)
def get_power_data_cached(
    latitude: float,
    longitude: float,
    start: date,
    end: date,
) -> dict[str, object]:
    parameters = (
        "T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN"
    )
    query = urlencode({
        "parameters": parameters,
        "community": "AG",
        "longitude": longitude,
        "latitude": latitude,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "time-standard": "UTC",
        "format": "JSON",
    })
    url = f"https://power.larc.nasa.gov/api/temporal/daily/point?{query}"

    try:
        with urlopen(url, timeout=30) as response:
            payload = json.load(response)
    except HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"NASA POWER returned HTTP {exc.code}."
        ) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not retrieve data from NASA POWER: {exc}"
        ) from exc

    properties = payload.get("properties", {})
    raw_parameters = properties.get("parameter", {})
    if not raw_parameters:
        messages = payload.get("messages", [])
        detail = "; ".join(messages) if messages else "NASA POWER returned no data."
        raise HTTPException(status_code=502, detail=detail)

    fill_value = payload.get("header", {}).get("fill_value", -999.0)

    def valid_values(name: str) -> list[float]:
        values = raw_parameters.get(name, {})
        return [
            float(value)
            for value in values.values()
            if value is not None
            and float(value) != fill_value
            and isfinite(float(value))
        ]

    daily_high = valid_values("T2M_MAX")
    daily_low = valid_values("T2M_MIN")
    precipitation = valid_values("PRECTOTCORR")
    humidity = valid_values("RH2M")
    solar = valid_values("ALLSKY_SFC_SW_DWN")
    if not any((daily_high, daily_low, precipitation, humidity, solar)):
        raise HTTPException(
            status_code=502,
            detail="NASA POWER returned no valid daily data for this location and date range.",
        )

    def average(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 2) if values else None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "summary": {
            "tmax_c_avg": average(daily_high),
            "tmin_c_avg": average(daily_low),
            "precipitation_mm_total": round(sum(precipitation), 2) if precipitation else None,
            "relative_humidity_pct_avg": average(humidity),
            "solar_mj_m2_day_avg": average(solar),
        },
        "valid_days": {
            "tmax": len(daily_high),
            "tmin": len(daily_low),
            "precipitation": len(precipitation),
            "humidity": len(humidity),
            "solar": len(solar),
        },
    }
