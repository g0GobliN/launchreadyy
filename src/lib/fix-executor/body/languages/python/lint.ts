export const PYTEST_SETUP = `[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --tb=short"
`;

export const RUFF_CONFIG = `[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP"]
ignore = ["E501"]
`;

export const RUFF_TOML_CONFIG = `line-length = 100
target-version = "py312"

[lint]
select = ["E", "F", "I", "N", "UP"]
ignore = ["E501"]
`;
