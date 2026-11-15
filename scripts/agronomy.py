"""Agronomic feature extraction and grounded analysis payload assembly."""

from __future__ import annotations

from datetime import date
from math import isfinite
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FiniteModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class WeatherObservation(FiniteModel):
    date: date
    t2m_max_c: float | None = None
    t2m_min_c: float | None = None
    precipitation_mm: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_measurements(self) -> WeatherObservation:
        if (
            self.t2m_max_c is None
            and self.t2m_min_c is None
            and self.precipitation_mm is None
        ):
            raise ValueError("A weather observation must contain at least one measurement.")
        if (self.t2m_max_c is None) != (self.t2m_min_c is None):
            raise ValueError("Provide both maximum and minimum temperatures for GDD.")
        return self


class NdviObservation(FiniteModel):
    date: date
    ndvi: float | None = Field(default=None, ge=-1, le=1)
    red_dn: float | None = Field(default=None, ge=0)
    nir_dn: float | None = Field(default=None, ge=0)
    scale_factor: float = Field(default=0.0001, gt=0)

    @model_validator(mode="after")
    def validate_measurement(self) -> NdviObservation:
        if self.ndvi is None and (self.red_dn is None or self.nir_dn is None):
            raise ValueError("Provide NDVI or both red_dn and nir_dn reflectance bands.")
        if self.ndvi is not None and (self.red_dn is not None or self.nir_dn is not None):
            raise ValueError("Provide either NDVI or reflectance bands, not both.")
        if self.red_dn == 0 and self.nir_dn == 0:
            raise ValueError("Red and NIR reflectance cannot both be zero.")
        return self


class CropSeason(FiniteModel):
    year: int = Field(ge=1900, le=2200)
    start_date: date
    end_date: date
    weather: list[WeatherObservation] = Field(default_factory=list, max_length=400)
    ndvi: list[NdviObservation] = Field(default_factory=list, max_length=200)
    surface_soil_moisture_m3_m3: float | None = Field(default=None, ge=0)
    surface_normal_m3_m3: float | None = Field(default=None, ge=0)
    rootzone_soil_moisture_m3_m3: float | None = Field(default=None, ge=0)
    rootzone_normal_m3_m3: float | None = Field(default=None, ge=0)
    smap_start_time: str | None = Field(default=None, max_length=40)
    smap_end_time: str | None = Field(default=None, max_length=40)
    smap_resolution_km: float | None = Field(default=9.0, gt=0)
    precipitation_normal_mm: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_season(self) -> CropSeason:
        if self.start_date > self.end_date:
            raise ValueError("Season start_date must not be after end_date.")
        if any(not self.start_date <= item.date <= self.end_date for item in self.weather):
            raise ValueError("Weather observations must fall inside the season date range.")
        if any(not self.start_date <= item.date <= self.end_date for item in self.ndvi):
            raise ValueError("NDVI observations must fall inside the season date range.")
        if len({item.date for item in self.weather}) != len(self.weather):
            raise ValueError("Weather observations must have unique dates per season.")
        if len({item.date for item in self.ndvi}) != len(self.ndvi):
            raise ValueError("NDVI observations must have unique dates per season.")
        return self


class CropHistoryEntry(FiniteModel):
    year: int = Field(ge=1900, le=2200)
    crop: str = Field(min_length=1, max_length=100)


class CropProfile(FiniteModel):
    crop: str = Field(min_length=1, max_length=100)
    nitrogen_fixing: bool | None = None
    root_depth_class: str | None = Field(default=None, max_length=40)
    pest_host_groups: list[str] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(default=None, max_length=500)


class YieldPrediction(FiniteModel):
    year: int = Field(ge=1900, le=2200)
    crop: str = Field(min_length=1, max_length=100)
    predicted_yield: float = Field(ge=0)
    units: str = Field(min_length=1, max_length=40)
    model: str = Field(default="Random Forest", max_length=100)


class AgronomyAnalysisRequest(FiniteModel):
    seasons: list[CropSeason] = Field(min_length=1, max_length=20)
    crop_history: list[CropHistoryEntry] = Field(default_factory=list, max_length=50)
    crop_profiles: list[CropProfile] = Field(default_factory=list, max_length=30)
    yield_predictions: list[YieldPrediction] = Field(default_factory=list, max_length=20)
    gdd_base_temperature_c: float = Field(default=10.0, ge=0, le=30)

    @model_validator(mode="after")
    def validate_unique_seasons(self) -> AgronomyAnalysisRequest:
        if len({season.year for season in self.seasons}) != len(self.seasons):
            raise ValueError("Season years must be unique.")
        return self


def calculate_gdd(
    t2m_max_c: float,
    t2m_min_c: float,
    base_temperature_c: float = 10.0,
) -> float:
    """Return one day's growing degree days using the single-sine-free mean method."""
    values = (t2m_max_c, t2m_min_c, base_temperature_c)
    if not all(isfinite(value) for value in values):
        raise ValueError("Temperatures must be finite numbers.")
    if base_temperature_c < 0:
        raise ValueError("Base temperature must not be negative.")
    return max(0.0, (t2m_max_c + t2m_min_c) / 2 - base_temperature_c)


def normalized_ndvi(
    red_dn: float,
    nir_dn: float,
    scale_factor: float = 0.0001,
) -> float:
    """Normalize HLS integer reflectance and calculate NDVI."""
    if not all(isfinite(value) for value in (red_dn, nir_dn, scale_factor)):
        raise ValueError("Reflectance values and scale factor must be finite.")
    if red_dn < 0 or nir_dn < 0 or scale_factor <= 0:
        raise ValueError("Reflectance values must be non-negative and scale_factor positive.")
    red = red_dn * scale_factor
    nir = nir_dn * scale_factor
    denominator = nir + red
    if denominator == 0:
        raise ValueError("NDVI cannot be calculated when red and NIR reflectance are both zero.")
    return (nir - red) / denominator


def _season_features(
    season: CropSeason,
    base_temperature_c: float,
) -> dict[str, Any]:
    weather = sorted(season.weather, key=lambda observation: observation.date)
    ndvi_observations = sorted(season.ndvi, key=lambda observation: observation.date)
    gdd_weather = [
        observation
        for observation in weather
        if observation.t2m_max_c is not None and observation.t2m_min_c is not None
    ]
    daily_gdd = []
    for observation in gdd_weather:
        t2m_max_c = observation.t2m_max_c
        t2m_min_c = observation.t2m_min_c
        if t2m_max_c is None or t2m_min_c is None:
            continue
        daily_gdd.append({
            "date": observation.date.isoformat(),
            "gdd_c_days": calculate_gdd(
                t2m_max_c,
                t2m_min_c,
                base_temperature_c,
            ),
        })
    gdd_total = sum(item["gdd_c_days"] for item in daily_gdd) if daily_gdd else None
    precipitation_weather = [
        observation for observation in weather if observation.precipitation_mm is not None
    ]
    precipitation_total = (
        sum(
            observation.precipitation_mm
            for observation in precipitation_weather
            if observation.precipitation_mm is not None
        )
        if precipitation_weather
        else None
    )
    precipitation_anomaly = (
        precipitation_total - season.precipitation_normal_mm
        if precipitation_total is not None and season.precipitation_normal_mm is not None
        else None
    )
    normalized_observations = [
        {
            "date": observation.date.isoformat(),
            "ndvi": (
                observation.ndvi
                if observation.ndvi is not None
                else normalized_ndvi(
                    observation.red_dn or 0.0,
                    observation.nir_dn or 0.0,
                    observation.scale_factor,
                )
            ),
        }
        for observation in ndvi_observations
    ]
    ndvi_values = [observation["ndvi"] for observation in normalized_observations]
    rootzone_anomaly = (
        season.rootzone_soil_moisture_m3_m3 - season.rootzone_normal_m3_m3
        if season.rootzone_soil_moisture_m3_m3 is not None
        and season.rootzone_normal_m3_m3 is not None
        else None
    )
    surface_anomaly = (
        season.surface_soil_moisture_m3_m3 - season.surface_normal_m3_m3
        if season.surface_soil_moisture_m3_m3 is not None
        and season.surface_normal_m3_m3 is not None
        else None
    )
    expected_days = (season.end_date - season.start_date).days + 1

    return {
        "year": season.year,
        "start_date": season.start_date.isoformat(),
        "end_date": season.end_date.isoformat(),
        "gdd_base_temperature_c": base_temperature_c,
        "gdd_total_c_days": round(gdd_total, 2) if gdd_total is not None else None,
        "weather_days_observed": len(weather),
        "weather_days_expected": expected_days,
        "gdd_days_observed": len(gdd_weather),
        "precipitation_days_observed": len(precipitation_weather),
        "weather_daily": [
            {
                "date": observation.date.isoformat(),
                "t2m_max_c": observation.t2m_max_c,
                "t2m_min_c": observation.t2m_min_c,
                "precipitation_mm": observation.precipitation_mm,
            }
            for observation in weather
        ],
        "precipitation_total_mm": round(precipitation_total, 2)
        if precipitation_total is not None
        else None,
        "precipitation_normal_mm": season.precipitation_normal_mm,
        "precipitation_anomaly_mm": round(precipitation_anomaly, 2)
        if precipitation_anomaly is not None
        else None,
        "drought_stress_anomaly_mm": round(max(0.0, -precipitation_anomaly), 2)
        if precipitation_anomaly is not None
        else None,
        "water_availability": {
            "seasonal_precipitation_mm": round(precipitation_total, 2)
            if precipitation_total is not None
            else None,
            "surface_soil_moisture_m3_m3": season.surface_soil_moisture_m3_m3,
            "surface_normal_m3_m3": season.surface_normal_m3_m3,
            "surface_anomaly_m3_m3": round(surface_anomaly, 4)
            if surface_anomaly is not None
            else None,
            "rootzone_soil_moisture_m3_m3": season.rootzone_soil_moisture_m3_m3,
            "rootzone_normal_m3_m3": season.rootzone_normal_m3_m3,
            "rootzone_anomaly_m3_m3": round(rootzone_anomaly, 4)
            if rootzone_anomaly is not None
            else None,
            "smap_start_time": season.smap_start_time,
            "smap_end_time": season.smap_end_time,
            "smap_resolution_km": season.smap_resolution_km,
        },
        "ndvi_observations": normalized_observations,
        "mean_ndvi": round(sum(ndvi_values) / len(ndvi_values), 4)
        if ndvi_values
        else None,
        "latest_ndvi": normalized_observations[-1] if normalized_observations else None,
        "daily_gdd": daily_gdd,
    }


def build_agronomy_payload(
    request: AgronomyAnalysisRequest,
) -> dict[str, Any]:
    """Assemble model-ready features and source data without inventing missing values."""
    seasons = sorted(request.seasons, key=lambda season: season.year)
    season_features = [
        _season_features(season, request.gdd_base_temperature_c)
        for season in seasons
    ]
    current = season_features[-1]
    previous = next(
        (
            season
            for season in reversed(season_features[:-1])
            if season["year"] == current["year"] - 1
        ),
        None,
    )
    comparisons: dict[str, float | int | None] = {
        "current_year": current["year"],
        "previous_year": previous["year"] if previous else None,
    }
    for metric in ("gdd_total_c_days", "precipitation_total_mm", "mean_ndvi"):
        current_value = current[metric]
        previous_value = previous[metric] if previous else None
        comparisons[f"{metric}_difference"] = (
            round(current_value - previous_value, 4)
            if current_value is not None and previous_value is not None
            else None
        )
    for soil_layer in ("surface", "rootzone"):
        metric = f"{soil_layer}_soil_moisture_m3_m3"
        current_moisture = current["water_availability"][metric]
        previous_moisture = previous["water_availability"][metric] if previous else None
        comparisons[f"{metric}_difference"] = (
            round(current_moisture - previous_moisture, 4)
            if current_moisture is not None and previous_moisture is not None
            else None
        )
    if current["latest_ndvi"] is not None and previous and previous["latest_ndvi"] is not None:
        comparisons["latest_ndvi_difference"] = round(
            current["latest_ndvi"]["ndvi"] - previous["latest_ndvi"]["ndvi"],
            4,
        )
    else:
        comparisons["latest_ndvi_difference"] = None

    latest_history = max(
        (item for item in request.crop_history if item.year < current["year"]),
        key=lambda item: item.year,
        default=None,
    )
    random_forest_features: dict[str, Any] = {
        "season_year": current["year"],
        "gdd_base_temperature_c": request.gdd_base_temperature_c,
        "gdd_total_c_days": current["gdd_total_c_days"],
        "precipitation_total_mm": current["precipitation_total_mm"],
        "precipitation_anomaly_mm": current["precipitation_anomaly_mm"],
        "surface_soil_moisture_m3_m3": current["water_availability"][
            "surface_soil_moisture_m3_m3"
        ],
        "surface_anomaly_m3_m3": current["water_availability"]["surface_anomaly_m3_m3"],
        "rootzone_soil_moisture_m3_m3": current["water_availability"][
            "rootzone_soil_moisture_m3_m3"
        ],
        "rootzone_anomaly_m3_m3": current["water_availability"][
            "rootzone_anomaly_m3_m3"
        ],
        "mean_ndvi": current["mean_ndvi"],
        "previous_crop": latest_history.crop if latest_history else None,
        "previous_crop_year": latest_history.year if latest_history else None,
        "previous_crop_history": [
            item.model_dump(mode="json")
            for item in sorted(
                (entry for entry in request.crop_history if entry.year < current["year"]),
                key=lambda entry: entry.year,
            )
        ],
    }

    return {
        "schema_version": 1,
        "data_sources": {
            "weather": {
                "product": "NASA POWER daily T2M_MAX, T2M_MIN, PRECTOTCORR",
                "spatial_support": "NASA POWER native regional grid; not field-scale",
            },
            "ndvi": {
                "product": "Landsat-based NASA HLS surface reflectance",
                "spatial_resolution_m": 30,
                "spatial_support": "NDVI observations masked to the supplied field polygon",
            },
            "soil_moisture": {
                "product": "Provided NASA SMAP surface and root-zone observations",
                "spatial_resolution_km": 9,
                "spatial_support": "Nearest regional grid cell; not field-scale",
            },
            "yield_predictions": "Provided Random Forest outputs; no prediction is generated here",
        },
        "gdd_base_temperature_c": request.gdd_base_temperature_c,
        "seasons": season_features,
        "year_over_year": comparisons,
        "crop_history": [
            item.model_dump(mode="json")
            for item in sorted(request.crop_history, key=lambda item: item.year)
        ],
        "crop_profiles": [
            profile.model_dump(mode="json") for profile in request.crop_profiles
        ],
        "random_forest_features": random_forest_features,
        "random_forest_yield_predictions": [
            prediction.model_dump(mode="json")
            for prediction in request.yield_predictions
        ],
    }
