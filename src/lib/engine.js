// Transparent, descriptive analytics for SECRET.
// These functions describe submitted answers; they do not diagnose personality
// or claim to predict an individual's behaviour.

function latestResponseMap(responses, phase = "initial") {
  const map = new Map();
  for (const response of responses || []) {
    if (!response || response.phase !== phase) continue;
    const key = `${response.participant_id}::${response.question_id}`;
    const previous = map.get(key);
    const currentTime = Date.parse(response.created_at || "") || 0;
    const previousTime = Date.parse(previous?.created_at || "") || 0;
    if (!previous || currentTime >= previousTime) map.set(key, response);
  }
  return map;
}

const responseKey = (participantId, questionId) =>
  `${participantId}::${questionId}`;

export function responseMatrix(participants, questions, responses) {
  const index = latestResponseMap(responses, "initial");
  return participants.map(participantId =>
    questions.map(question => {
      const response = index.get(responseKey(participantId, question.id));
      return response?.answer ?? null;
    })
  );
}

export function similarity(a = [], b = []) {
  let same = 0;
  let compared = 0;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] == null || b[i] == null) continue;
    compared++;
    if (a[i] === b[i]) same++;
  }
  return compared ? same / compared : 0;
}

function comparedCount(a = [], b = []) {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] != null && b[i] != null) count++;
  }
  return count;
}

// Complete-link grouping: a person joins a group only when they meet the
// threshold with every existing member. This avoids weak chain-linked groups.
export function buildClusters(participants, questions, responses) {
  const ids = [...new Set(participants || [])].sort();
  const matrix = responseMatrix(ids, questions || [], responses || []);
  const groups = [];
  const threshold = 0.6;
  const minimumCompared = 2;

  ids.forEach((id, index) => {
    if (matrix[index].filter(answer => answer != null).length < minimumCompared) return;

    let bestGroup = null;
    let bestAverage = -1;
    for (const group of groups) {
      const scores = group.indices.map(memberIndex => ({
        score: similarity(matrix[index], matrix[memberIndex]),
        compared: comparedCount(matrix[index], matrix[memberIndex])
      }));
      if (scores.some(item => item.compared < minimumCompared || item.score < threshold)) continue;
      const average = scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
      if (average > bestAverage) {
        bestAverage = average;
        bestGroup = group;
      }
    }
    if (bestGroup) bestGroup.indices.push(index);
    else groups.push({ indices: [index] });
  });

  return groups
    .filter(group => group.indices.length >= 2)
    .map((group, groupIndex) => {
      const answers = group.indices.flatMap(index => matrix[index]).filter(answer => answer != null);
      const counts = new Map();
      answers.forEach(answer => counts.set(answer, (counts.get(answer) || 0) + 1));
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || "Mixed";
      return {
        name: `Pattern ${String.fromCharCode(65 + groupIndex)}`,
        size: group.indices.length,
        dominant,
        indices: group.indices,
        participants: group.indices.map(index => ids[index])
      };
    });
}

export function findOppositeSimilarities(participants, questions, responses) {
  const ids = [...new Set(participants || [])].sort();
  const matrix = responseMatrix(ids, questions || [], responses || []);
  const findings = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const compared = comparedCount(matrix[i], matrix[j]);
      if (compared < 3) continue;
      const score = similarity(matrix[i], matrix[j]);
      if (score < 0.25 || score > 0.75) continue;
      const disagreements = [];
      for (let k = 0; k < (questions || []).length; k++) {
        const first = matrix[i][k];
        const second = matrix[j][k];
        if (first != null && second != null && first !== second) {
          disagreements.push({
            question: questions[k].prompt,
            firstAnswer: first,
            secondAnswer: second
          });
        }
      }
      if (!disagreements.length) continue;
      findings.push({
        first: `Stranger ${String(i + 1).padStart(3, "0")}`,
        second: `Stranger ${String(j + 1).padStart(3, "0")}`,
        compared,
        score: Math.round(score * 100),
        disagreements,
        label: "Some choices differ, while other answers overlap"
      });
    }
  }
  return findings.sort((a, b) => b.score - a.score || b.compared - a.compared).slice(0, 5);
}

export function predictNext(questions, responses, participants) {
  // A single room has no independent historical dataset for a future question.
  // Comparing answer labels across different prompts is statistically invalid.
  // Return no fabricated forecast until comparable, cross-room training data exists.
  return {
    options: [],
    confidence: "No reliable forecast is available from this room's data",
    reason: "Answers to different questions are not interchangeable. SECRET needs comparable historical data before making a responsible forecast."
  };
}

export function getQuestionStats(question, responses, phase = "initial") {
  const options = question?.options || [];
  const allowed = new Set(options);
  const latest = new Map();
  for (const response of responses || []) {
    if (response.question_id !== question?.id || response.phase !== phase) continue;
    if (!allowed.has(response.answer)) continue;
    const previous = latest.get(response.participant_id);
    const currentTime = Date.parse(response.created_at || "") || 0;
    const previousTime = Date.parse(previous?.created_at || "") || 0;
    if (!previous || currentTime >= previousTime) latest.set(response.participant_id, response);
  }
  const counts = Object.fromEntries(options.map(option => [option, 0]));
  latest.forEach(response => { counts[response.answer]++; });
  return { total: latest.size, counts, options };
}

// A match is shown only with at least 3 shared questions, 2 agreements,
// and a 60%+ agreement rate. Labels are stable for the same room participants.
export function getHiddenConnections(participants, questions, responses) {
  const ids = [...new Set(participants || [])].sort();
  const matrix = responseMatrix(ids, questions || [], responses || []);
  const findings = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sharedAnswers = [];
      const compared = comparedCount(matrix[i], matrix[j]);
      if (compared < 3) continue;

      for (let k = 0; k < (questions || []).length; k++) {
        const answer = matrix[i][k];
        if (answer != null && answer === matrix[j][k]) {
          sharedAnswers.push({ question: questions[k].prompt, answer });
        }
      }
      const matches = sharedAnswers.length;
      const score = Math.round(matches / compared * 100);
      if (matches < 2 || score < 60) continue;

      findings.push({
        first: `Stranger ${String(i + 1).padStart(3, "0")}`,
        second: `Stranger ${String(j + 1).padStart(3, "0")}`,
        compared,
        matches,
        score,
        sharedAnswers
      });
    }
  }

  return findings
    .sort((a, b) => b.score - a.score || b.matches - a.matches || b.compared - a.compared)
    .slice(0, 6);
}

export function getOpinionShifts(participants, questions, responses) {
  const ids = [...new Set(participants || [])].sort();
  const initial = latestResponseMap(responses, "initial");
  const afterReveal = latestResponseMap(responses, "after_reveal");
  const results = [];

  ids.forEach((participantId, index) => {
    const changes = [];
    let compared = 0;
    (questions || []).forEach(question => {
      const before = initial.get(responseKey(participantId, question.id))?.answer;
      const after = afterReveal.get(responseKey(participantId, question.id))?.answer;
      if (before == null || after == null) return;
      compared++;
      if (before !== after) changes.push({ question: question.prompt, before, after });
    });
    if (compared) {
      results.push({
        label: `Stranger ${String(index + 1).padStart(3, "0")}`,
        compared,
        changed: changes.length,
        unchanged: compared - changes.length,
        changes
      });
    }
  });
  return results.sort((a, b) => b.changed - a.changed || a.label.localeCompare(b.label));
}
