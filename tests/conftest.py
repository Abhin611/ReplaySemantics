"""Shared fixtures for Member 1's replay-core tests."""
import pytest

from policy_engine.benchmark.generator import generate_benchmark


@pytest.fixture(scope="session")
def bench_root(tmp_path_factory):
    """A small deterministic benchmark (7 families x 4 cases) in a temp dir."""
    root = tmp_path_factory.mktemp("bench")
    generate_benchmark(root, seed=7, per_family=4)
    return root


@pytest.fixture(autouse=True)
def _no_sign_in_for_pipeline_tests(request):
    """The pipeline tests call the API directly, with no user. test_account.py tests the sign-in itself."""
    if request.module.__name__.endswith("test_account"):
        yield
        return
    try:
        from api import app as api_module
    except ImportError:
        yield
        return
    async def nothing():
        return None
    api_module.app.dependency_overrides[api_module.scope_request] = nothing
    yield
    api_module.app.dependency_overrides.pop(api_module.scope_request, None)
