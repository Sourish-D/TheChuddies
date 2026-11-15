"""Read field-center soil moisture from the latest NASA SMAP L4 granule."""

from __future__ import annotations

from math import isfinite
from pathlib import Path
from typing import IO, Protocol, runtime_checkable

import earthaccess
import h5py
import numpy as np
from earthaccess.exceptions import LoginAttemptFailure, LoginStrategyUnavailable
from rasterio.warp import transform


SMAP_SHORT_NAME = "SPL4SMGP"
SMAP_VERSION = "008"
SMAP_DATASET_PATH = "Geophysical_Data"
X_COORDINATE_PATH = "x"
Y_COORDINATE_PATH = "y"


@runtime_checkable
class SeekableHdfSource(Protocol):
    def read(self, size: int = -1) -> bytes: ...

    def seek(self, offset: int, whence: int = 0) -> int: ...

    def tell(self) -> int: ...

    def close(self) -> None: ...


class SmapDataError(RuntimeError):
    """Raised when NASA SMAP data is unavailable or cannot be interpreted."""


def _login() -> None:
    try:
        earthaccess.login(strategy="environment", persist=False)
    except LoginStrategyUnavailable:
        try:
            earthaccess.login(strategy="netrc", persist=False)
        except (LoginAttemptFailure, LoginStrategyUnavailable) as exc:
            raise SmapDataError(
                "NASA SMAP requires Earthdata Login. Run `npm run auth` from "
                "nasa-farm-dashboard, or configure Earthdata environment credentials."
            ) from exc
    except LoginAttemptFailure as exc:
        raise SmapDataError(
            "Earthdata rejected the configured credentials. Check them with `npm run auth`."
        ) from exc


def _grid_cell(
    x_coordinates: np.ndarray,
    y_coordinates: np.ndarray,
    data_shape: tuple[int, ...],
    latitude: float,
    longitude: float,
) -> tuple[int, int, float, float]:
    if (
        x_coordinates.ndim != 1
        or y_coordinates.ndim != 1
        or data_shape != (y_coordinates.size, x_coordinates.size)
        or x_coordinates.size < 2
        or y_coordinates.size < 2
        or not np.all(np.isfinite(x_coordinates))
        or not np.all(np.isfinite(y_coordinates))
        or not np.all(np.diff(x_coordinates) > 0)
        or not np.all(np.diff(y_coordinates) < 0)
    ):
        raise SmapDataError("NASA SMAP coordinate axes do not match its data grid.")
    easting, northing, *_ = transform(
        "EPSG:4326",
        "EPSG:6933",
        [longitude],
        [latitude],
    )
    x_spacing = x_coordinates[1] - x_coordinates[0]
    y_spacing = y_coordinates[1] - y_coordinates[0]
    if not (
        x_coordinates[0] - x_spacing / 2
        <= easting[0]
        <= x_coordinates[-1] + x_spacing / 2
        and y_coordinates[-1] + y_spacing / 2
        <= northing[0]
        <= y_coordinates[0] - y_spacing / 2
    ):
        raise SmapDataError(
            "NASA SMAP has no grid cell covering this field location."
        )
    column = int(np.abs(x_coordinates - easting[0]).argmin())
    row = int(np.abs(y_coordinates - northing[0]).argmin())
    cell_x = float(x_coordinates[column])
    cell_y = float(y_coordinates[row])
    cell_longitude, cell_latitude, *_ = transform(
        "EPSG:6933",
        "EPSG:4326",
        [cell_x],
        [cell_y],
    )
    return row, column, cell_latitude[0], cell_longitude[0]


def _attribute_number(dataset: h5py.Dataset, name: str, default: float) -> float:
    value = dataset.attrs.get(name, default)
    values = np.asarray(value).reshape(-1)
    if values.size != 1:
        raise SmapDataError(f"NASA SMAP variable has an invalid {name} attribute.")
    try:
        return float(values[0])
    except (TypeError, ValueError) as exc:
        raise SmapDataError(
            f"NASA SMAP variable has an invalid {name} attribute."
        ) from exc


def _read_variable(
    dataset: h5py.Dataset,
    row: int,
    column: int,
) -> float:
    raw_value = float(dataset[row, column])
    if not isfinite(raw_value):
        raise SmapDataError("NASA SMAP returned a missing soil-moisture value.")

    for attribute in ("_FillValue", "missing_value"):
        if attribute in dataset.attrs:
            fill_value = _attribute_number(dataset, attribute, 0)
            if raw_value == fill_value:
                raise SmapDataError("NASA SMAP returned a missing soil-moisture value.")

    value = (
        raw_value * _attribute_number(dataset, "scale_factor", 1)
        + _attribute_number(dataset, "add_offset", 0)
    )
    if not isfinite(value):
        raise SmapDataError("NASA SMAP returned an invalid soil-moisture value.")
    return value


def read_smap_granule(
    source: str | Path | IO[bytes] | SeekableHdfSource,
    latitude: float,
    longitude: float,
) -> dict[str, float]:
    """Read surface and root-zone values for the nearest EASE-Grid cell."""
    try:
        with h5py.File(source, "r") as granule:
            x_axis = granule.get(X_COORDINATE_PATH)
            y_axis = granule.get(Y_COORDINATE_PATH)
            surface = granule.get(f"{SMAP_DATASET_PATH}/sm_surface")
            rootzone = granule.get(f"{SMAP_DATASET_PATH}/sm_rootzone")
            if (
                not isinstance(x_axis, h5py.Dataset)
                or not isinstance(y_axis, h5py.Dataset)
                or not isinstance(surface, h5py.Dataset)
                or not isinstance(rootzone, h5py.Dataset)
            ):
                raise SmapDataError(
                    "The NASA SMAP granule is missing expected grid data."
                )
            row, column, cell_latitude, cell_longitude = _grid_cell(
                np.asarray(x_axis),
                np.asarray(y_axis),
                surface.shape,
                latitude,
                longitude,
            )
            if rootzone.shape != surface.shape:
                raise SmapDataError(
                    "NASA SMAP surface and root-zone grids do not match."
                )
            return {
                "surface_soil_moisture_m3_m3": _read_variable(
                    surface, row, column
                ),
                "rootzone_soil_moisture_m3_m3": _read_variable(
                    rootzone, row, column
                ),
                "grid_cell_latitude": cell_latitude,
                "grid_cell_longitude": cell_longitude,
            }
    except KeyError as exc:
        raise SmapDataError(
            "The NASA SMAP granule is missing expected grid data."
        ) from exc


def get_smap_data(latitude: float, longitude: float) -> dict[str, object]:
    """Fetch the latest available SMAP L4 three-hourly field-center estimate."""
    _login()
    try:
        granules = earthaccess.search_data(
            count=1,
            short_name=SMAP_SHORT_NAME,
            version=SMAP_VERSION,
            point=(longitude, latitude),
            sort_key="-start_date",
        )
    except RuntimeError as exc:
        raise SmapDataError(f"NASA Earthdata search failed: {exc}") from exc
    if not granules:
        raise SmapDataError("NASA SMAP has no granules covering this field location.")

    granule = granules[0]
    temporal_extent = granule.get("umm", {}).get("TemporalExtent", {})
    time_range = temporal_extent.get("RangeDateTime", {})
    start_time = time_range.get("BeginningDateTime")
    end_time = time_range.get("EndingDateTime")
    if not start_time or not end_time:
        raise SmapDataError("NASA SMAP granule metadata has no time interval.")

    try:
        remote_files = earthaccess.open(
            [granule],
            show_progress=False,
            open_kwargs={"cache_type": "blockcache", "block_size": 2 * 1024 * 1024},
        )
        if not remote_files:
            raise SmapDataError("NASA Earthdata returned no SMAP data file.")
        remote_file = remote_files[0]
        if not isinstance(remote_file, SeekableHdfSource):
            raise SmapDataError("NASA Earthdata returned an unreadable SMAP file handle.")
        try:
            values = read_smap_granule(remote_file, latitude, longitude)
        finally:
            remote_file.close()
    except SmapDataError:
        raise
    except (OSError, RuntimeError) as exc:
        raise SmapDataError(f"Could not read the NASA SMAP granule: {exc}") from exc

    return {
        "product": "SMAP L4 Global 3-hourly 9 km EASE-Grid",
        "product_version": "8",
        "start_time": start_time,
        "end_time": end_time,
        "latitude": latitude,
        "longitude": longitude,
        "resolution_km": 9,
        "units": "m³/m³",
        **values,
    }
