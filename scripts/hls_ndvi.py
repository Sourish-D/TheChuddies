"""Calculate average NDVI for a farm field from NASA HLSL30 data.

Install dependencies with:
    python -m pip install -r requirements-hls.txt

The first run opens an Earthdata Login flow.  An Earthdata account is
required to access HLS data.
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from math import isfinite
from pathlib import Path

import earthaccess
import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.warp import transform_geom


HLSL30_SHORT_NAME = "HLSS30"
HLSL30_LANDSAT_SHORT_NAME = "HLSL30"
MAX_SIDE_KM = 5.0
ANALYSIS_DAYS = 15


def polygon_bounds(geometry: dict[str, object]) -> tuple[float, float, float, float]:
    """Validate a GeoJSON Polygon and return its EPSG:4326 bounding box."""
    if geometry.get("type") != "Polygon":
        raise ValueError("geometry must be a GeoJSON Polygon")

    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise ValueError("geometry must contain at least one polygon ring")

    positions: list[tuple[float, float]] = []
    for ring in coordinates:
        if not isinstance(ring, list) or len(ring) < 4:
            raise ValueError("each polygon ring must contain at least four positions")

        ring_positions: list[tuple[float, float]] = []
        for position in ring:
            if (
                not isinstance(position, list)
                or len(position) < 2
                or isinstance(position[0], bool)
                or isinstance(position[1], bool)
                or not isinstance(position[0], (int, float))
                or not isinstance(position[1], (int, float))
            ):
                raise ValueError("polygon positions must contain longitude and latitude")
            longitude, latitude = float(position[0]), float(position[1])
            if (
                not isfinite(longitude)
                or not isfinite(latitude)
                or not -180 <= longitude <= 180
                or not -90 <= latitude <= 90
            ):
                raise ValueError("polygon coordinates must be valid EPSG:4326 values")
            ring_positions.append((longitude, latitude))

        if ring_positions[0] != ring_positions[-1]:
            raise ValueError("polygon rings must be closed")
        positions.extend(ring_positions)

    min_lon = min(longitude for longitude, _ in positions)
    min_lat = min(latitude for _, latitude in positions)
    max_lon = max(longitude for longitude, _ in positions)
    max_lat = max(latitude for _, latitude in positions)
    if min_lon == max_lon or min_lat == max_lat:
        raise ValueError("polygon must cover an area")
    return min_lon, min_lat, max_lon, max_lat


def _band_file(directory: Path, band: str) -> Path:
    """Find one HLS band GeoTIFF in a downloaded granule directory."""
    matches = sorted(directory.rglob(f"*{band}.tif"))
    if not matches:
        raise FileNotFoundError(f"Could not find HLSL30 {band} GeoTIFF in {directory}")
    return matches[0]


def _scene_ndvi(
    red_path: Path,
    nir_path: Path,
    field_geometry: dict[str, object],
) -> float:
    """Return mean NDVI for one scene, masking nodata and invalid reflectance."""
    with rasterio.open(red_path) as red_src, rasterio.open(nir_path) as nir_src:
        if red_src.crs != nir_src.crs or red_src.transform != nir_src.transform:
            raise ValueError(f"Red and NIR rasters are not aligned for {red_path.parent}")

        field_in_raster_crs = transform_geom(
            "EPSG:4326", red_src.crs, field_geometry, precision=15
        )
        red, _ = mask(red_src, [field_in_raster_crs], crop=True, filled=False)
        nir, _ = mask(nir_src, [field_in_raster_crs], crop=True, filled=False)

    red_values = np.ma.asarray(red[0], dtype=np.float32) * 0.0001
    nir_values = np.ma.asarray(nir[0], dtype=np.float32) * 0.0001
    valid = (
        ~np.ma.getmaskarray(red_values)
        & ~np.ma.getmaskarray(nir_values)
        & np.isfinite(red_values.data)
        & np.isfinite(nir_values.data)
        & (red_values.data >= 0)
        & (nir_values.data >= 0)
    )
    if not np.any(valid):
        raise ValueError(f"No valid surface-reflectance pixels intersect {red_path.parent}")

    denominator = nir_values.data + red_values.data
    valid &= denominator != 0
    if not np.any(valid):
        raise ValueError(f"No pixels with a non-zero NDVI denominator in {red_path.parent}")

    ndvi = (nir_values.data[valid] - red_values.data[valid]) / denominator[valid]
    return float(np.mean(ndvi))


def average_hls_ndvi(
    bounding_box: tuple[float, float, float, float],
    start_date: str,
    end_date: str,
    download_dir: str | Path = "hls-data",
    cloud_cover: tuple[float, float] = (0, 30),
    field_geometry: dict[str, object] | None = None,
) -> float:
    """Authenticate, download HLSL30 scenes, and return mean field NDVI.

    Args:
        bounding_box: (min_lon, min_lat, max_lon, max_lat) in EPSG:4326.
        field_geometry: Optional GeoJSON Polygon to mask within that bounding box.
        start_date: Inclusive ISO date, such as ``"2024-06-01"``.
        end_date: Inclusive ISO date, such as ``"2024-06-30"``.
        download_dir: Directory where Earthdata granules are downloaded.
        cloud_cover: Inclusive cloud-cover percentage range.
    """
    min_lon, min_lat, max_lon, max_lat = bounding_box
    if not (-180 <= min_lon < max_lon <= 180 and -90 <= min_lat < max_lat <= 90):
        raise ValueError("bounding_box must be (min_lon, min_lat, max_lon, max_lat)")
    if field_geometry is None:
        field_geometry = {
            "type": "Polygon",
            "coordinates": [[
                [min_lon, min_lat],
                [max_lon, min_lat],
                [max_lon, max_lat],
                [min_lon, max_lat],
                [min_lon, min_lat],
            ]],
        }
    elif polygon_bounds(field_geometry) != bounding_box:
        raise ValueError("bounding_box must match the geometry bounds")
    if start_date > end_date:
        raise ValueError("start_date must not be after end_date")
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if (end - start).days > ANALYSIS_DAYS:
        raise ValueError(f"Date range cannot exceed {ANALYSIS_DAYS} days")

    earthaccess.login(persist=True)
    granules = earthaccess.search_data(
        short_name=HLSL30_LANDSAT_SHORT_NAME,
        bounding_box=bounding_box,
        temporal=(start_date, end_date),
        cloud_cover=cloud_cover,
    )
    if not granules:
        raise ValueError("No HLSL30 granules matched the requested field and date range")

    download_root = Path(download_dir)
    downloaded = earthaccess.download(granules, local_path=download_root)
    scene_scores: list[float] = []
    scene_bands: dict[str, dict[str, Path]] = {}
    for item in downloaded:
        item_path = Path(item)
        paths = item_path.rglob("*.tif") if item_path.is_dir() else [item_path]
        for path in paths:
            for band in ("B04", "B05"):
                suffix = f".{band}.tif"
                if path.name.endswith(suffix):
                    scene_name = path.name.removesuffix(suffix)
                    scene_bands.setdefault(scene_name, {})[band] = path

    for bands in scene_bands.values():
        try:
            scene_scores.append(
                _scene_ndvi(
                    bands["B04"],
                    bands["B05"],
                    field_geometry,
                )
            )
        except (FileNotFoundError, KeyError):
            continue

    if not scene_scores:
        raise ValueError("No downloaded HLSL30 scene contained valid pixels for the field")
    return float(np.mean(scene_scores))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", nargs=4, type=float, required=True,
                        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"))
    parser.add_argument("--start", required=True, help="Inclusive ISO date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="Inclusive ISO date (YYYY-MM-DD)")
    parser.add_argument("--download-dir", default="hls-data")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    score = average_hls_ndvi(tuple(args.bbox), args.start, args.end, args.download_dir)
    print(f"Average NDVI: {score:.4f}")
