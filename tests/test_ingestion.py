"""
Unit tests for replay_core.ingestion.

Run with:  pytest tests/ -v
(from the ReplaySemantics/ root, with src/ on PYTHONPATH -- see pytest.ini)
"""

from pathlib import Path

import pytest

from replay_core.ingestion import OCELValidationError, load_ocel, validate_ocel
from replay_core.models import ObjectCentricLog

SAMPLE = Path(__file__).parent.parent / "data" / "raw" / "ocel20_example.jsonocel"


def test_sample_file_exists():
    assert SAMPLE.exists(), f"Sample OCEL file missing at {SAMPLE}"


def test_load_ocel_returns_object_centric_log():
    log = load_ocel(SAMPLE)
    assert isinstance(log, ObjectCentricLog)
    assert len(log.events) > 0
    assert len(log.objects) > 0


def test_events_sorted_by_timestamp():
    log = load_ocel(SAMPLE)
    timestamps = [e.timestamp for e in log.events]
    assert timestamps == sorted(timestamps)


def test_every_event_has_activity_and_id():
    log = load_ocel(SAMPLE)
    for e in log.events:
        assert e.event_id
        assert e.activity


def test_object_types_match_declared_set():
    log = load_ocel(SAMPLE)
    actual_types = {o.object_type for o in log.objects.values()}
    assert actual_types.issubset(set(log.object_types))


def test_events_for_object_returns_sorted_subsequence():
    log = load_ocel(SAMPLE)
    any_object_id = next(iter(log.objects))
    events = log.events_for_object(any_object_id)
    assert all(any_object_id in e.object_ids() for e in events)
    ts = [e.timestamp for e in events]
    assert ts == sorted(ts)


def test_summary_has_expected_keys():
    log = load_ocel(SAMPLE)
    summary = log.summary()
    for key in ["num_events", "num_objects", "object_types", "event_types", "time_span"]:
        assert key in summary


def test_unsupported_extension_raises(tmp_path):
    bad_file = tmp_path / "not_ocel.txt"
    bad_file.write_text("irrelevant")
    with pytest.raises(ValueError):
        load_ocel(bad_file, strict=False)


def test_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        load_ocel("data/raw/does_not_exist.jsonocel")


def test_validate_ocel_reports_valid_on_clean_sample():
    import pm4py

    raw = pm4py.read_ocel2_json(str(SAMPLE))
    report = validate_ocel(raw)
    assert report.is_valid, f"Expected clean sample to validate, got errors: {report.errors}"


# --- VBFA (large-scale SAP O2C) dataset tests ---

VBFA_OCEL = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"


@pytest.mark.skipif(not VBFA_OCEL.exists(), reason="VBFA-derived OCEL2 file not built yet")
def test_vbfa_ocel_loads_and_validates():
    log = load_ocel(VBFA_OCEL, strict=True)
    assert len(log.events) > 1000, "expected large-scale dataset (1000+ events)"
    assert len(log.objects) > 1000
    assert "Order" in log.object_types
    assert "Invoice" in log.object_types


@pytest.mark.skipif(not VBFA_OCEL.exists(), reason="VBFA-derived OCEL2 file not built yet")
def test_vbfa_ocel_events_are_time_ordered():
    log = load_ocel(VBFA_OCEL)
    timestamps = [e.timestamp for e in log.events]
    assert timestamps == sorted(timestamps)
