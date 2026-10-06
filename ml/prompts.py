"""Stable stdin/stdout prompt contract shared by sampling and SFT."""


def build_prompt(
    problem: str,
    *,
    adapter_kind: str = "stdin_stdout",
    adapter_entry_point: str | None = None,
) -> str:
    if adapter_kind == "python_assertions":
        if not adapter_entry_point:
            raise ValueError("function adapter prompt requires an entry point")
        return (
            f"Write a complete Python 3 solution defining the function `{adapter_entry_point}` "
            "for the following programming problem. Do not read from standard input or write "
            "the answer to standard output.\n\n"
            f"Problem:\n{problem}\n\nPython solution:\n"
        )
    if adapter_kind != "stdin_stdout":
        raise ValueError("unsupported research adapter")
    return (
        "Write a complete Python 3 program for the following programming problem. "
        "Read from standard input and write the answer to standard output.\n\n"
        f"Problem:\n{problem}\n\nPython solution:\n"
    )
