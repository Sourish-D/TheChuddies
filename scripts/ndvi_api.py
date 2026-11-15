"""Small local API for the farm dashboard's HLS NDVI analysis."""

from __future__ import annotations

import json
import logging
import os
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from math import isfinite
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from scripts.agronomy import AgronomyAnalysisRequest, build_agronomy_payload
from scripts.gemini_agronomy import generate_agronomy_markdown
from scripts.hls_ndvi import (
    ANALYSIS_DAYS,
    MAX_TIMELINE_DAYS,
    hls_ndvi_timeseries,
    polygon_bounds,
)
from scripts.smap_data import SmapDataError, get_smap_data


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")
HLS_DATA_DIRECTORY = Path(
    os.environ.get("HLS_DATA_DIR", str(PROJECT_ROOT / "hls-data"))
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def api_lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    if os.environ.get("HLS_DATA_CLEANUP_BY_LAUNCHER") != "1":
        if HLS_DATA_DIRECTORY.exists():
            logger.info("Removing temporary HLS data directory %s", HLS_DATA_DIRECTORY)
            shutil.rmtree(HLS_DATA_DIRECTORY)


app = FastAPI(lifespan=api_lifespan)

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


class NdviRequest(BaseModel):
    bbox: tuple[float, float, float, float] | None = None
    geometry: dict[str, object] | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_field(self) -> NdviRequest:
        if self.geometry is None and self.bbox is None:
            raise ValueError("Provide either a bbox or a GeoJSON Polygon geometry.")
        if self.geometry is not None:
            polygon_bounds(self.geometry)
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("Provide both start_date and end_date, or neither.")
        if self.start_date is not None and self.end_date is not None:
            if self.start_date > self.end_date:
                raise ValueError("start_date must not be after end_date.")
            if (self.end_date - self.start_date).days + 1 > MAX_TIMELINE_DAYS:
                raise ValueError(f"Date range cannot exceed {MAX_TIMELINE_DAYS} days.")
        return self


class PowerRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_date_range(self) -> PowerRequest:
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("Provide both start_date and end_date, or neither.")
        if self.start_date is not None and self.end_date is not None:
            if self.start_date > self.end_date:
                raise ValueError("start_date must not be after end_date.")
            if (self.end_date - self.start_date).days > 365 * 10:
                raise ValueError("NASA POWER date range cannot exceed 10 years.")
        return self


class SmapRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@app.post("/api/agronomy/analyze")
def analyze_agronomy(request: AgronomyAnalysisRequest) -> dict[str, object]:
    """Return a model-ready feature payload and grounded Gemini Markdown."""
    payload = build_agronomy_payload(request)
    markdown, model = generate_agronomy_markdown(payload)
    return {
        "analysis_markdown": markdown,
        "feature_payload": payload,
        "random_forest_features": payload["random_forest_features"],
        "random_forest_yield_predictions": payload["random_forest_yield_predictions"],
        "model": model,
    }


@app.post("/api/ndvi")
def calculate_ndvi(request: NdviRequest) -> dict[str, object]:
    try:
        end = request.end_date or date.today()
        start = request.start_date or end - timedelta(days=ANALYSIS_DAYS - 1)
        bounding_box = (
            polygon_bounds(request.geometry)
            if request.geometry is not None
            else request.bbox
        )
        if bounding_box is None:
            raise ValueError("Provide either a bbox or a GeoJSON Polygon geometry.")
        observations = hls_ndvi_timeseries(
            bounding_box,
            start.isoformat(),
            end.isoformat(),
            HLS_DATA_DIRECTORY,
            field_geometry=request.geometry,
        )
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "average_ndvi": sum(float(item["ndvi"]) for item in observations)
        / len(observations),
        "observations": observations,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }


@app.post("/api/power")
def get_power_data(request: PowerRequest) -> dict[str, object]:
    """Fetch a recent month of daily NASA POWER agricultural climate data."""
    end = request.end_date or date.today() - timedelta(days=7)
    start = request.start_date or end - timedelta(days=29)
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

    daily_dates = sorted({
        observation_date
        for parameter_values in raw_parameters.values()
        for observation_date in parameter_values
    })

    def daily_value(parameter: str, observation_date: str) -> float | None:
        value = raw_parameters.get(parameter, {}).get(observation_date)
        if value is None:
            return None
        numeric_value = float(value)
        if numeric_value == fill_value or not isfinite(numeric_value):
            return None
        return numeric_value

    return {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": [
            {
                "date": datetime.strptime(day, "%Y%m%d").date().isoformat(),
                "t2m_max_c": daily_value("T2M_MAX", day),
                "t2m_min_c": daily_value("T2M_MIN", day),
                "precipitation_mm": daily_value("PRECTOTCORR", day),
            }
            for day in daily_dates
        ],
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
