"""Stable stdin/stdout prompt contract shared by sampling and SFT."""


def build_prompt(problem: str) -> str:
    return (
        "Write a complete Python 3 program for the following programming problem. "
        "Read from standard input and write the answer to standard output.\n\n"
        f"Problem:\n{problem}\n\nPython solution:\n"
    )
