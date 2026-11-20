import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClusters,
  findOppositeSimilarities,
  getHiddenConnections,
  getOpinionShifts,
  getQuestionStats,
  hasCompletedPhase,
  predictNext,
  responseMatrix,
  similarity
} from "../src/lib/engine.js";

const questions = [
  { id: "q1", prompt: "Q1", options: ["A", "B"] },
  { id: "q2", prompt: "Q2", options: ["A", "B"] },
  { id: "q3", prompt: "Q3", options: ["A", "B"] },
  { id: "q4", prompt: "Q4", options: ["A", "B"] }
];
const row = (participant_id, question_id, answer, phase = "initial", created_at = "2026-01-01T00:00:00Z") => ({
  participant_id, question_id, answer, phase, created_at
});

test("similarity ignores unanswered questions and handles empty comparisons", () => {
  assert.equal(similarity(["A", null, "B"], ["A", "B", "B"]), 1);
  assert.equal(similarity([null], ["A"]), 0);
});

test("responseMatrix uses the latest response for a participant and question", () => {
  const responses = [
    row("p1", "q1", "A"),
    row("p1", "q1", "B", "initial", "2026-01-02T00:00:00Z")
  ];
  assert.deepEqual(responseMatrix(["p1"], questions.slice(0, 1), responses), [["B"]]);
});

test("hidden connections require enough shared questions and meaningful agreement", () => {
  const responses = [
    ...["q1", "q2", "q3"].map(q => row("p1", q, "A")),
    ...["q1", "q2", "q3"].map(q => row("p2", q, "A"))
  ];
  const matches = getHiddenConnections(["p2", "p1"], questions, responses);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].score, 100);
  assert.equal(matches[0].matches, 3);
  assert.equal(matches[0].first, "Stranger 001");
  assert.equal(matches[0].second, "Stranger 002");
});

test("hidden connections do not label a weak or tiny sample as a match", () => {
  const responses = [
    row("p1", "q1", "A"), row("p1", "q2", "A"),
    row("p2", "q1", "A"), row("p2", "q2", "B")
  ];
  assert.deepEqual(getHiddenConnections(["p1", "p2"], questions, responses), []);
});

test("clusters require at least two shared answers and complete-link agreement", () => {
  const responses = [
    ...["q1", "q2", "q3"].map(q => row("p1", q, "A")),
    ...["q1", "q2", "q3"].map(q => row("p2", q, "A")),
    ...["q1", "q2", "q3"].map(q => row("p3", q, "B"))
  ];
  const groups = buildClusters(["p3", "p2", "p1"], questions, responses);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].size, 2);
});

test("opinion shifts compare only submitted matching questions", () => {
  const responses = [
    row("p1", "q1", "A"), row("p1", "q2", "A"),
    row("p1", "q1", "B", "after_reveal"), row("p1", "q2", "A", "after_reveal")
  ];
  const shifts = getOpinionShifts(["p1"], questions, responses);
  assert.equal(shifts[0].changed, 1);
  assert.equal(shifts[0].unchanged, 1);
  assert.deepEqual(shifts[0].changes[0], { question: "Q1", before: "A", after: "B" });
});

test("question statistics deduplicate participants and reject invalid options", () => {
  const responses = [
    row("p1", "q1", "A"),
    row("p1", "q1", "B", "initial", "2026-01-02T00:00:00Z"),
    row("p2", "q1", "not-an-option")
  ];
  const stats = getQuestionStats(questions[0], responses);
  assert.equal(stats.total, 1);
  assert.deepEqual(stats.counts, { A: 0, B: 1 });
});

test("forecast stays disabled when comparable historical training data is absent", () => {
  const result = predictNext(questions, [], ["p1"]);
  assert.deepEqual(result.options, []);
  assert.match(result.reason, /comparable historical data/i);
});

test("opposite similarity findings require a meaningful mixed pattern", () => {
  const responses = [
    row("p1", "q1", "A"), row("p1", "q2", "A"), row("p1", "q3", "A"), row("p1", "q4", "A"),
    row("p2", "q1", "A"), row("p2", "q2", "B"), row("p2", "q3", "B"), row("p2", "q4", "B")
  ];
  const result = findOppositeSimilarities(["p1", "p2"], questions, responses);
  assert.equal(result.length, 1);
  assert.equal(result[0].score, 25);
  assert.equal(result[0].disagreements.length, 3);
});


test("reflection eligibility requires every initial answer from the same participant", () => {
  const responses = [
    row("p1", "q1", "A"),
    row("p1", "q2", "A"),
    row("p2", "q3", "B"),
    row("p1", "q4", "B", "after_reveal")
  ];
  assert.equal(hasCompletedPhase(responses, "p1", questions, "initial"), false);
  assert.equal(hasCompletedPhase([...responses, row("p1", "q3", "A"), row("p1", "q4", "A")], "p1", questions), true);
  assert.equal(hasCompletedPhase(responses, "p2", questions), false);
  assert.equal(hasCompletedPhase(responses, "p1", [], "initial"), false);
});


test("question statistics separate initial and reflection phases", () => {
  const responses = [
    row("p1", "q1", "A", "initial"),
    row("p1", "q1", "B", "after_reveal"),
    row("p2", "q1", "B", "after_reveal")
  ];
  assert.deepEqual(getQuestionStats(questions[0], responses, "initial").counts, { A: 1, B: 0 });
  assert.deepEqual(getQuestionStats(questions[0], responses, "after_reveal").counts, { A: 0, B: 2 });
});

test("question statistics ignore answers that are not valid options", () => {
  const responses = [
    row("p1", "q1", "A"),
    row("p2", "q1", "unexpected")
  ];
  const stats = getQuestionStats(questions[0], responses);
  assert.equal(stats.total, 1);
  assert.equal(stats.counts.A, 1);
  assert.equal(stats.counts.B, 0);
});

test("opinion shift analysis excludes incomplete second-round responses", () => {
  const responses = [
    row("p1", "q1", "A"),
    row("p1", "q2", "B"),
    row("p1", "q1", "B", "after_reveal")
  ];
  const shifts = getOpinionShifts(["p1"], questions, responses);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].compared, 1);
  assert.equal(shifts[0].changed, 1);
});

test("hidden connections ignore unanswered questions instead of treating them as agreement", () => {
  const responses = [
    row("p1", "q1", "A"), row("p1", "q2", "A"), row("p1", "q3", "A"),
    row("p2", "q1", "A"), row("p2", "q2", "A")
  ];
  assert.deepEqual(getHiddenConnections(["p1", "p2"], questions, responses), []);
});

test("reflection eligibility is false when participant identity or question list is missing", () => {
  assert.equal(hasCompletedPhase([], "", questions), false);
  assert.equal(hasCompletedPhase([], "p1", null), false);
  assert.equal(hasCompletedPhase([], "p1", []), false);
});
