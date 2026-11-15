import io
import json
import os
import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai.errors import APIError

from scripts.agronomy import (
    AgronomyAnalysisRequest,
    build_agronomy_payload,
    calculate_gdd,
    normalized_ndvi,
)
from scripts.gemini_agronomy import (
    AGRONOMY_SYSTEM_INSTRUCTION,
    generate_agronomy_markdown,
)
from scripts.hls_ndvi import _scene_date
from scripts.ndvi_api import (
    NdviRequest,
    PowerRequest,
    app,
    calculate_ndvi,
    get_power_data_cached,
)


def example_request() -> AgronomyAnalysisRequest:
    return AgronomyAnalysisRequest.model_validate({
        "seasons": [
            {
                "year": 2024,
                "start_date": "2024-05-01",
                "end_date": "2024-05-02",
                "weather": [
                    {
                        "date": "2024-05-01",
                        "t2m_max_c": 20,
                        "t2m_min_c": 10,
                        "precipitation_mm": 4,
                    },
                ],
                "ndvi": [{"date": "2024-05-01", "ndvi": 0.4}],
                "rootzone_soil_moisture_m3_m3": 0.3,
                "rootzone_normal_m3_m3": 0.3,
            },
            {
                "year": 2025,
                "start_date": "2025-05-01",
                "end_date": "2025-05-02",
                "weather": [
                    {
                        "date": "2025-05-01",
                        "t2m_max_c": 24,
                        "t2m_min_c": 16,
                        "precipitation_mm": 5,
                    },
                    {
                        "date": "2025-05-02",
                        "t2m_max_c": 8,
                        "t2m_min_c": 2,
                        "precipitation_mm": 3,
                    },
                ],
                "ndvi": [
                    {"date": "2025-05-01", "red_dn": 2000, "nir_dn": 6000},
                    {"date": "2025-05-02", "ndvi": 0.7},
                ],
                "rootzone_soil_moisture_m3_m3": 0.25,
                "rootzone_normal_m3_m3": 0.3,
                "precipitation_normal_mm": 12,
            },
        ],
        "crop_history": [{"year": 2024, "crop": "soybean"}],
        "crop_profiles": [
            {"crop": "soybean", "nitrogen_fixing": True, "root_depth_class": "medium"}
        ],
        "yield_predictions": [
            {
                "year": 2025,
                "crop": "corn",
                "predicted_yield": 185.5,
                "units": "bu/acre",
            },
        ],
    })


class AgronomyFeatureTests(unittest.TestCase):
    def test_gdd_formula_and_base_temperature_floor(self) -> None:
        self.assertEqual(calculate_gdd(24, 16), 10)
        self.assertEqual(calculate_gdd(8, 2), 0)
        self.assertEqual(calculate_gdd(24, 16, 5), 15)

    def test_normalized_ndvi_uses_reflectance_scale(self) -> None:
        self.assertAlmostEqual(normalized_ndvi(2000, 6000), 0.5)

    def test_payload_aggregates_features_and_marks_missing_data(self) -> None:
        payload = build_agronomy_payload(example_request())
        current = payload["seasons"][1]

        self.assertEqual(current["gdd_total_c_days"], 10)
        self.assertEqual(current["precipitation_total_mm"], 8)
        self.assertEqual(current["precipitation_anomaly_mm"], -4)
        self.assertEqual(current["drought_stress_anomaly_mm"], 4)
        self.assertAlmostEqual(current["mean_ndvi"], 0.6)
        self.assertEqual(current["water_availability"]["rootzone_anomaly_m3_m3"], -0.05)
        self.assertEqual(payload["year_over_year"]["gdd_total_c_days_difference"], 5)
        self.assertEqual(payload["random_forest_features"]["previous_crop"], "soybean")
        self.assertEqual(payload["random_forest_yield_predictions"][0]["predicted_yield"], 185.5)
        self.assertIsNone(payload["seasons"][0]["precipitation_anomaly_mm"])
        self.assertIsNone(payload["seasons"][0]["drought_stress_anomaly_mm"])

    def test_comparison_is_missing_when_the_immediately_previous_year_is_absent(self) -> None:
        request = AgronomyAnalysisRequest.model_validate({
            "seasons": [
                {"year": 2023, "start_date": "2023-05-01", "end_date": "2023-05-01"},
                {"year": 2025, "start_date": "2025-05-01", "end_date": "2025-05-01"},
            ],
        })

        comparison = build_agronomy_payload(request)["year_over_year"]

        self.assertEqual(comparison["current_year"], 2025)
        self.assertIsNone(comparison["previous_year"])
        self.assertIsNone(comparison["gdd_total_c_days_difference"])

    def test_analysis_endpoint_returns_markdown_and_feature_payload(self) -> None:
        payload = build_agronomy_payload(example_request())
        client = TestClient(app)
        with patch(
            "scripts.ndvi_api.generate_agronomy_markdown",
            return_value="## Field summary\nGrounded results.",
        ):
            response = client.post(
                "/api/agronomy/analyze",
                json=example_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["analysis_markdown"], "## Field summary\nGrounded results.")
        self.assertEqual(body["feature_payload"], payload)
        self.assertEqual(body["random_forest_features"], payload["random_forest_features"])

    def test_gemini_requires_server_side_configuration(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            self.assertRaises(HTTPException) as raised,
        ):
            generate_agronomy_markdown({"seasons": []})
        self.assertEqual(raised.exception.status_code, 503)

    def test_gemini_receives_payload_with_strict_system_instruction(self) -> None:
        class FakeModels:
            def __init__(self) -> None:
                self.kwargs: dict[str, object] | None = None

            def generate_content(self, **kwargs):
                self.kwargs = kwargs

                class Response:
                    text = "## Field summary\nProvided values only."

                return Response()

        fake_models = FakeModels()

        class FakeClient:
            models = fake_models

            def __init__(self, *, api_key: str) -> None:
                self.api_key = api_key

        with (
            patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True),
            patch("scripts.gemini_agronomy.genai.Client", FakeClient),
        ):
            markdown = generate_agronomy_markdown({"year_over_year": {"ndvi": None}})

        self.assertIn("Provided values only", markdown)
        kwargs = fake_models.kwargs
        self.assertIsNotNone(kwargs)
        assert kwargs is not None
        self.assertIn(
            "ABSOLUTE DATA GROUNDING",
            getattr(kwargs["config"], "system_instruction"),
        )
        self.assertIn("crop rotation", AGRONOMY_SYSTEM_INSTRUCTION.lower())
        self.assertEqual(kwargs["model"], "gemini-3.8-flash")
        contents = kwargs["contents"]
        self.assertIsInstance(contents, str)
        if not isinstance(contents, str):
            self.fail("Gemini request contents should be text.")
        self.assertIn('"ndvi": null', contents)

    def test_gemini_api_error_is_reported_as_upstream_failure(self) -> None:
        class FakeModels:
            def generate_content(self, **kwargs):
                self.kwargs = kwargs
                raise APIError(
                    code=503,
                    response_json={"error": {"message": "temporarily unavailable"}},
                )

        class FakeClient:
            models = FakeModels()

            def __init__(self, *, api_key: str) -> None:
                self.api_key = api_key

        with (
            patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True),
            patch("scripts.gemini_agronomy.genai.Client", FakeClient),
            self.assertRaises(HTTPException) as raised,
        ):
            generate_agronomy_markdown({"seasons": []})

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("temporarily unavailable", raised.exception.detail)


class AgronomyRequestValidationTests(unittest.TestCase):
    def test_power_and_ndvi_date_range_validation(self) -> None:
        with self.assertRaises(ValueError):
            PowerRequest.model_validate({
                "latitude": 43,
                "longitude": -80,
                "start_date": "2025-05-01",
            })
        with self.assertRaises(ValueError):
            NdviRequest.model_validate({
                "bbox": (-80.1, 43.0, -80.0, 43.1),
                "start_date": "2024-01-01",
                "end_date": "2025-01-01",
            })

    def test_hls_scene_date_is_extracted_from_acquisition_timestamp(self) -> None:
        self.assertEqual(_scene_date("HLS.L30.T18TYM.2025140T154258.v2.0"), date(2025, 5, 20))

    def test_ndvi_endpoint_returns_historical_observations(self) -> None:
        request = NdviRequest.model_validate({
            "bbox": (-80.1, 43.0, -80.0, 43.1),
            "start_date": "2025-05-01",
            "end_date": "2025-05-02",
        })
        observations = [
            {"date": "2025-05-01", "ndvi": 0.4},
            {"date": "2025-05-02", "ndvi": 0.6},
        ]
        with patch("scripts.ndvi_api.hls_ndvi_timeseries", return_value=observations):
            response = calculate_ndvi(request)

        self.assertEqual(response["observations"], observations)
        average_ndvi = response["average_ndvi"]
        if not isinstance(average_ndvi, (int, float)):
            self.fail("Average NDVI should be numeric.")
        self.assertAlmostEqual(float(average_ndvi), 0.5)

    def test_power_daily_response_preserves_dated_observations(self) -> None:
        nasa_payload = {
            "header": {"fill_value": -999},
            "properties": {
                "parameter": {
                    "T2M_MAX": {"20250501": 20, "20250502": 22},
                    "T2M_MIN": {"20250501": 10, "20250502": 12},
                    "PRECTOTCORR": {"20250501": 3, "20250502": 4},
                    "RH2M": {"20250501": 50, "20250502": 60},
                    "ALLSKY_SFC_SW_DWN": {"20250501": 15, "20250502": 17},
                },
            },
        }
        get_power_data_cached.cache_clear()
        with patch(
            "scripts.ndvi_api.urlopen",
            return_value=io.BytesIO(json.dumps(nasa_payload).encode()),
        ):
            result = get_power_data_cached(
                43.0,
                -80.0,
                date(2025, 5, 1),
                date(2025, 5, 2),
            )

        daily = result["daily"]
        if not isinstance(daily, list):
            self.fail("POWER daily observations should be a list.")
        self.assertEqual(len(daily), 2)
        self.assertEqual(daily[0], {
            "date": "2025-05-01",
            "t2m_max_c": 20,
            "t2m_min_c": 10,
            "precipitation_mm": 3,
        })
        summary = result["summary"]
        if not isinstance(summary, dict):
            self.fail("POWER summary should be a dictionary.")
        self.assertEqual(summary["precipitation_mm_total"], 7)
        get_power_data_cached.cache_clear()


if __name__ == "__main__":
    unittest.main()
