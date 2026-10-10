"""Shared fixtures for Member 1's replay-core tests."""
import pytest

from policy_engine.benchmark.generator import generate_benchmark


@pytest.fixture(scope="session")
def bench_root(tmp_path_factory):
    """A small deterministic benchmark (7 families x 4 cases) in a temp dir."""
    root = tmp_path_factory.mktemp("bench")
    generate_benchmark(root, seed=7, per_family=4)
    return root
