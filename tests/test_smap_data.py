import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import h5py
import numpy as np

from fastapi import HTTPException

from scripts.ndvi_api import SmapRequest, get_smap_soil_moisture
from scripts.smap_data import (
    SMAP_DATASET_PATH,
    SmapDataError,
    _grid_cell,
    get_smap_data,
    read_smap_granule,
)


X_COORDINATES = np.array([-14000, -5000, 4000, 14000], dtype=np.float64)
Y_COORDINATES = np.array([14000, 5000, -4000, -14000], dtype=np.float64)


def create_test_granule(path: Path) -> None:
    with h5py.File(path, "w") as granule:
        granule.create_dataset("x", data=X_COORDINATES)
        granule.create_dataset("y", data=Y_COORDINATES)
        geophysical_data = granule.require_group(SMAP_DATASET_PATH)
        surface = geophysical_data.create_dataset(
            "sm_surface",
            data=np.arange(16, dtype=np.float32).reshape(4, 4) / 100,
        )
        surface.attrs["scale_factor"] = 2.0
        rootzone = geophysical_data.create_dataset(
            "sm_rootzone",
            data=np.arange(16, dtype=np.float32).reshape(4, 4) / 50,
        )
        rootzone.attrs["_FillValue"] = -9999.0


class SmapGridTests(unittest.TestCase):
    def test_grid_cell_uses_actual_coordinate_axes(self) -> None:
        row, column, latitude, longitude = _grid_cell(
            X_COORDINATES,
            Y_COORDINATES,
            (4, 4),
            0,
            0,
        )

        self.assertEqual((row, column), (2, 2))
        self.assertLess(latitude, 0)
        self.assertGreater(longitude, 0)
        self.assertLess(abs(latitude), 0.1)
        self.assertLess(abs(longitude), 0.1)

    def test_grid_cell_rejects_mismatched_coordinate_dimensions(self) -> None:
        with self.assertRaisesRegex(SmapDataError, "axes do not match"):
            _grid_cell(X_COORDINATES, Y_COORDINATES, (3, 4), 0, 0)

    def test_grid_cell_rejects_locations_outside_smap_coverage(self) -> None:
        with self.assertRaisesRegex(SmapDataError, "no grid cell covering"):
            _grid_cell(X_COORDINATES, Y_COORDINATES, (4, 4), 90, 0)

    def test_granule_reads_scaled_surface_and_rootzone_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "smap.h5"
            create_test_granule(path)

            values = read_smap_granule(path, 0, 0)

        self.assertAlmostEqual(values["surface_soil_moisture_m3_m3"], 0.2)
        self.assertAlmostEqual(values["rootzone_soil_moisture_m3_m3"], 0.2)

    def test_granule_rejects_fill_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "smap.h5"
            create_test_granule(path)
            with h5py.File(path, "a") as granule:
                rootzone = granule.get(f"{SMAP_DATASET_PATH}/sm_rootzone")
                if not isinstance(rootzone, h5py.Dataset):
                    self.fail("Synthetic granule did not create its root-zone dataset.")
                rootzone[2, 2] = -9999.0

            with self.assertRaisesRegex(SmapDataError, "missing soil-moisture"):
                read_smap_granule(path, 0, 0)

    def test_latest_granule_response_includes_timestamps_and_grid_values(self) -> None:
        class FakeGranule(dict):
            def __init__(self) -> None:
                super().__init__(
                    umm={
                        "TemporalExtent": {
                            "RangeDateTime": {
                                "BeginningDateTime": "2026-11-10T21:00:00Z",
                                "EndingDateTime": "2026-11-11T00:00:00Z",
                            }
                        }
                    }
                )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "smap.h5"
            create_test_granule(path)
            with (
                patch("scripts.smap_data._login"),
                patch(
                    "scripts.smap_data.earthaccess.search_data",
                    return_value=[FakeGranule()],
                ) as search_data,
                patch(
                    "scripts.smap_data.earthaccess.open",
                    return_value=[path.open("rb")],
                ),
            ):
                response = get_smap_data(0, 0)

        self.assertEqual(
            search_data.call_args.kwargs,
            {
                "count": 1,
                "short_name": "SPL4SMGP",
                "version": "008",
                "point": (0, 0),
                "sort_key": "-start_date",
            },
        )
        self.assertEqual(response["start_time"], "2026-11-10T21:00:00Z")
        self.assertEqual(response["end_time"], "2026-11-11T00:00:00Z")
        surface_moisture = response["surface_soil_moisture_m3_m3"]
        if not isinstance(surface_moisture, float):
            self.fail("SMAP surface soil moisture should be a float.")
        self.assertAlmostEqual(surface_moisture, 0.2)
        self.assertEqual(response["resolution_km"], 9)

    def test_api_forwards_the_confirmed_center_and_time_bucket(self) -> None:
        result = {"surface_soil_moisture_m3_m3": 0.2}
        with patch("scripts.ndvi_api.get_smap_data_cached", return_value=result) as fetch:
            response = get_smap_soil_moisture(
                SmapRequest(latitude=43.0, longitude=-80.0)
            )

        self.assertEqual(response, result)
        self.assertEqual(fetch.call_args.args[:2], (43.0, -80.0))
        self.assertIsNotNone(fetch.call_args.args[2].tzinfo)

    def test_api_returns_a_clear_data_error(self) -> None:
        with (
            patch(
                "scripts.ndvi_api.get_smap_data_cached",
                side_effect=SmapDataError("No current SMAP data."),
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            get_smap_soil_moisture(SmapRequest(latitude=43.0, longitude=-80.0))

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, "No current SMAP data.")


if __name__ == "__main__":
    unittest.main()
