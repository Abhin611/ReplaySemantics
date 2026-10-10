"""Guards the real-data scope decision (docs/real_data_scope_decision.md):
real VBFA events carry no pricing fields, so stages 3-5 are not applicable to them."""
from decimal import Decimal as Dc
from pathlib import Path

import pytest

pytest.importorskip("pm4py")

from policy_engine import CaseReference, build_case, load_policy, unmapped_activities  # noqa: E402
from policy_engine.corrections import spec_for_activity  # noqa: E402
from replay_core.candidate_extraction import extract_candidate_events  # noqa: E402
from replay_core.graph import ObjectCentricGraph  # noqa: E402
from replay_core.ingestion import load_ocel  # noqa: E402
from replay_core.replay import ReplayOperator  # noqa: E402

VBFA = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
pytestmark = pytest.mark.skipif(not VBFA.exists(), reason="VBFA log not in this checkout")


@pytest.fixture(scope="module")
def graph():
    return ObjectCentricGraph(load_ocel(VBFA, strict=True, log_validation_report=False))


def test_no_vbfa_activity_maps_to_a_correction(graph):
    acts = {e.activity for e in graph.log.events}
    assert unmapped_activities(acts) == sorted(acts)
    assert not [a for a in acts if spec_for_activity(a)]


def test_vbfa_events_carry_none_of_the_pricing_fields(graph):
    keys = {k for e in graph.log.events for k in e.attributes}
    assert not keys & {"unit_price", "rate", "fx_rate", "slot", "decimals", "mode", "amount"}


@pytest.mark.parametrize("case_id", ["e977", "e34"])
def test_real_case_becomes_all_context_with_zero_loss_and_is_flagged_not_replayable(graph, case_id):
    """build_case does NOT raise on VBFA: every candidate silently becomes a null player.
    That is why is_replayable exists -- a PASS with nothing to attribute would be a false result."""
    ex = extract_candidate_events(graph, case_id, max_events=8)
    ref = CaseReference(Dc(1), Dc(1), Dc("0.1"), Dc(1))
    model = build_case(ex.candidate_events, load_policy("P-2026-Q3-001"), ref, ex.target_event)
    assert {t for n, t in model.ctx.node_types.items() if n != ex.target_event.event_id} == {"context"}
    op = ReplayOperator(model)
    assert op.active_ids == () and op.observed_loss == 0 and not op.is_replayable
