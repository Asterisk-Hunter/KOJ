"""Small end-to-end verdict corpus for the host-toolchain rlimit backend."""

import pytest

from app.config import settings
from app.judge import JudgeCase, JudgeRequest, execute_judge

pytestmark = pytest.mark.integration

_HELLO_SUM = {
    "python": "a, b = map(int, input().split())\nprint(a + b)\n",
    "c": '#include <stdio.h>\nint main(void) { int a, b; scanf("%d%d", &a, &b); printf("%d\\n", a + b); }\n',
    "c++": '#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << a + b << "\\n"; }\n',
    "java": 'import java.util.*; public class Solution { public static void main(String[] args) { Scanner in = new Scanner(System.in); System.out.println(in.nextInt() + in.nextInt()); } }\n',
    "go": 'package main\nimport "fmt"\nfunc main() { var a, b int; fmt.Scan(&a, &b); fmt.Println(a + b) }\n',
    "rust": 'use std::io; fn main() { let mut s = String::new(); io::stdin().read_line(&mut s).unwrap(); let n: Vec<i32> = s.split_whitespace().map(|v| v.parse().unwrap()).collect(); println!("{}", n[0] + n[1]); }\n',
    "javascript": 'const fs = require("fs"); const [a, b] = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number); console.log(a + b);\n',
}


@pytest.fixture(autouse=True)
def use_rlimit_backend(monkeypatch):
    monkeypatch.setattr(settings, "JUDGE_SANDBOX_MODE", "rlimit")


@pytest.mark.parametrize("language,code", _HELLO_SUM.items())
def test_known_accepted_solution_for_each_language(language, code):
    response = execute_judge(
        JudgeRequest(
            language=language,
            code=code,
            cases=[JudgeCase(stdin="19 23\n", expected_stdout="42\n", is_sample=True)],
            time_limit_ms=5000,
            memory_mb=256,
        )
    )

    assert response.status == "accepted"
    assert response.passed_tests == 1
    assert response.cases[0].stdout.strip() == "42"


@pytest.mark.parametrize(
    "code,expected_status",
    [
        ("print('wrong')", "wrong_answer"),
        ("raise RuntimeError('expected')", "runtime_error"),
        ("def broken(:", "compilation_error"),
    ],
)
def test_known_python_verdicts(code, expected_status):
    response = execute_judge(
        JudgeRequest(
            language="python",
            code=code,
            cases=[JudgeCase(stdin="", expected_stdout="42\n", is_sample=False)],
            time_limit_ms=2000,
            memory_mb=256,
        )
    )

    assert response.status == expected_status
    assert response.cases[0].stdout == ""
    assert response.cases[0].stderr == ""


def test_known_python_timeout_verdict():
    response = execute_judge(
        JudgeRequest(
            language="python",
            code="while True: pass",
            cases=[JudgeCase(stdin="", expected_stdout="", is_sample=True)],
            time_limit_ms=250,
            memory_mb=256,
        )
    )

    assert response.status == "time_limit_exceeded"
