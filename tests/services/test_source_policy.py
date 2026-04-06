from __future__ import annotations

import pytest

from app.db.models import SourceRegion, SourceRole, SourceStatus, SourceType
from app.services.sources.policy import (
    build_source_policy_snapshot,
    default_editorial_priority_for_role,
    default_priority_weight_for_role,
    should_source_be_active,
    validate_source_region,
    validate_source_role,
    validate_source_status,
)


def test_source_policy_validation_and_defaults():
    assert validate_source_role("coding") is SourceRole.CODING
    assert validate_source_region("russia") is SourceRegion.RUSSIA
    assert validate_source_status("quarantine") is SourceStatus.QUARANTINE
    assert default_priority_weight_for_role(SourceRole.VERIFICATION) > default_priority_weight_for_role(SourceRole.RUSSIA)
    assert default_editorial_priority_for_role(SourceRole.VERIFICATION) > default_editorial_priority_for_role(SourceRole.RUSSIA)

    snapshot = build_source_policy_snapshot(
        source_type=SourceType.WEBSITE,
        role=None,
        region="global",
        status=None,
        priority_weight=None,
        editorial_priority=None,
        noise_score=None,
    )
    assert snapshot.role is SourceRole.SIGNAL_FEEDER
    assert snapshot.region is SourceRegion.GLOBAL
    assert snapshot.status is SourceStatus.ACTIVE
    assert snapshot.priority_weight == default_priority_weight_for_role(SourceRole.SIGNAL_FEEDER)
    assert snapshot.editorial_priority == default_editorial_priority_for_role(SourceRole.SIGNAL_FEEDER)
    assert snapshot.noise_score > 0


def test_source_policy_active_gate():
    assert should_source_be_active(status=SourceStatus.ACTIVE, is_active=True) is True
    assert should_source_be_active(status=SourceStatus.QUARANTINE, is_active=True) is False
    assert should_source_be_active(status=SourceStatus.DISABLED, is_active=False) is False


def test_source_policy_validation_rejects_unknown_values():
    with pytest.raises(ValueError):
        validate_source_role("unknown-role")
    with pytest.raises(ValueError):
        validate_source_region("emea")
    with pytest.raises(ValueError):
        validate_source_status("paused")
