import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WRONG_VERDICTS,
  countWrongBefore,
  penaltyMinutesForSolve,
} from "./scoring.ts";

describe("WRONG_VERDICTS", () => {
  it("does not include accepted", () => {
    assert.equal(WRONG_VERDICTS.has("accepted"), false);
  });
  it("does not include compilation_error", () => {
    assert.equal(WRONG_VERDICTS.has("compilation_error"), false);
  });
  it("includes wrong_answer", () => {
    assert.equal(WRONG_VERDICTS.has("wrong_answer"), true);
  });
});

describe("countWrongBefore", () => {
  it("excludes accepted from count", () => {
    assert.equal(
      countWrongBefore(["wrong_answer", "accepted"]),
      1,
    );
  });

  it("excludes pending/running/CE from count", () => {
    assert.equal(
      countWrongBefore([
        "compilation_error",
        "wrong_answer",
        "accepted",
      ]),
      1,
    );
  });

  it("counts multiple wrongs before first AC", () => {
    assert.equal(
      countWrongBefore([
        "wrong_answer",
        "runtime_error",
        "time_limit_exceeded",
        "accepted",
      ]),
      3,
    );
  });

  it("returns 0 for empty list", () => {
    assert.equal(countWrongBefore([]), 0);
  });

  it("returns 0 when first submission is accepted", () => {
    assert.equal(countWrongBefore(["accepted"]), 0);
  });

  it("counts all if no AC present", () => {
    assert.equal(
      countWrongBefore(["wrong_answer", "runtime_error"]),
      2,
    );
  });
});

describe("penaltyMinutesForSolve", () => {
  it("returns firstAcMinutes when wrongCount is 0", () => {
    assert.equal(penaltyMinutesForSolve(30, 0), 30);
  });

  it("adds 20 * wrongCount", () => {
    assert.equal(penaltyMinutesForSolve(30, 2), 70);
  });

  it("handles zeros", () => {
    assert.equal(penaltyMinutesForSolve(0, 0), 0);
  });

  it("firstAc=0 with wrongs", () => {
    assert.equal(penaltyMinutesForSolve(0, 3), 60);
  });
});
