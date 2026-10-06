"""Server-owned adapters for research problems."""

from __future__ import annotations

import json
import re

STDIN_STDOUT_ADAPTER = "stdin_stdout"
PYTHON_ASSERTIONS_ADAPTER = "python_assertions"
_ENTRY_POINT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_FUNCTION_CHECKER = '''import json
import sys

def equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(equal(left[key], right[key]) for key in left)
    return left == right

try:
    payload = json.loads(sys.stdin.read())
    actual = json.loads(payload["actual_output"])
    expected = json.loads(payload["expected_output"])
    if not equal(actual, expected):
        raise ValueError("function result differs")
except Exception:
    raise SystemExit(1)
raise SystemExit(0)
'''


def _decode_json(value: str) -> object:
    def reject_constant(constant: str) -> None:
        raise ValueError(f"invalid JSON constant: {constant}")

    return json.loads(value, parse_constant=reject_constant)


def validate_adapter(
    adapter_kind: object,
    entry_point: object,
) -> tuple[str, str | None]:
    if not isinstance(adapter_kind, str):
        raise ValueError("research adapter kind must be a string")
    if adapter_kind == STDIN_STDOUT_ADAPTER:
        if entry_point is not None:
            raise ValueError("stdin/stdout adapter cannot define a function entry point")
        return adapter_kind, None
    if adapter_kind != PYTHON_ASSERTIONS_ADAPTER:
        raise ValueError("unsupported research adapter")
    if not isinstance(entry_point, str) or not _ENTRY_POINT.fullmatch(entry_point):
        raise ValueError("python assertion adapter requires a valid entry point")
    return adapter_kind, entry_point


def validate_function_cases(cases: list[dict[str, str]]) -> None:
    for case in cases:
        try:
            call = _decode_json(case["stdin"])
            _decode_json(case["expected_stdout"])
        except (KeyError, ValueError) as error:
            raise ValueError("function adapter tests must use JSON arguments and expected results") from error
        if (
            not isinstance(call, dict)
            or set(call) - {"args", "kwargs"}
            or not isinstance(call.get("args"), list)
            or not isinstance(call.get("kwargs", {}), dict)
        ):
            raise ValueError("function adapter test input must contain args and optional kwargs")


def build_python_function_program(candidate_code: str, entry_point: str) -> str:
    if not _ENTRY_POINT.fullmatch(entry_point):
        raise ValueError("python assertion adapter requires a valid entry point")
    return f'''import json as __koj_json
import sys as __koj_sys

{candidate_code}

__koj_call = __koj_json.loads(__koj_sys.stdin.read())
__koj_args = __koj_call["args"]
__koj_kwargs = __koj_call.get("kwargs", {{}})
__koj_target = globals().get({entry_point!r})
if not callable(__koj_target):
    raise TypeError("research function entry point is not callable")
__koj_result = __koj_target(*__koj_args, **__koj_kwargs)
__koj_sys.stdout.write(__koj_json.dumps(__koj_result, separators=(",", ":"), allow_nan=False))
'''


def function_checker_code() -> str:
    return _FUNCTION_CHECKER
