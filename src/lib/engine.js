// Lightweight, transparent analytics. These are descriptive patterns, not psychological diagnoses.
export function responseMatrix(participants, questions, responses) {
  return participants.map(p => questions.map(q => {
    const r = responses.find(x => x.participant_id === p && x.question_id === q.id && x.phase === "initial");
    return r ? r.answer : null;
  }));
}

export function similarity(a, b) {
  let same = 0, compared = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] == null || b[i] == null) continue;
    compared++;
    if (a[i] === b[i]) same++;
  }
  return compared ? same / compared : 0;
}

export function buildClusters(participants, questions, responses) {
  const matrix = responseMatrix(participants, questions, responses);
  const groups = [];
  const threshold = 0.6;
  participants.forEach((id, i) => {
    let best = null, bestScore = -1;
    groups.forEach(g => {
      const score = Math.max(...g.indices.map(j => similarity(matrix[i], matrix[j])));
      if (score >= threshold && score > bestScore) { best = g; bestScore = score; }
    });
    if (best) best.indices.push(i);
    else groups.push({ indices: [i] });
  });
  return groups.map((g, index) => {
    const people = g.indices;
    const answers = people.flatMap(i => matrix[i]).filter(x => x != null);
    const counts = {};
    answers.forEach(a => counts[a] = (counts[a] || 0) + 1);
    const dominant = Object.entries(counts).sort((a,b) => b[1]-a[1])[0]?.[0] || "Mixed";
    return {
      name: `Pattern ${String.fromCharCode(65 + index)}`,
      size: people.length,
      dominant,
      indices: people
    };
  });
}

export function findOppositeSimilarities(participants, questions, responses) {
  const matrix = responseMatrix(participants, questions, responses);
  const findings = [];
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const shared = matrix[i].filter((x,k) => x != null && matrix[j][k] != null).length;
      if (shared < 2) continue;
      const score = similarity(matrix[i], matrix[j]);
      if (score >= 0.35 && score <= 0.75) {
        const opposite = matrix[i].some((x,k) => x != null && matrix[j][k] != null && x !== matrix[j][k]);
        if (opposite) findings.push({ score, label: "Different on some choices, similar across the wider pattern" });
      }
    }
  }
  return findings.slice(0, 5);
}

export function predictNext(questions, responses, participants) {
  const last = questions[questions.length - 1];
  const previous = questions.slice(0, -1);
  if (!last || previous.length === 0) return { options: [], confidence: "Not enough history yet" };
  const counts = {};
  participants.forEach(id => {
    const answers = previous.map(q => responses.find(r => r.participant_id === id && r.question_id === q.id && r.phase === "initial")?.answer);
    if (answers.every(x => x == null)) return;
    // Transparent baseline: use the most common answer across the participant's history
    const local = {};
    answers.filter(Boolean).forEach(a => local[a] = (local[a] || 0) + 1);
    const guess = Object.entries(local).sort((a,b) => b[1]-a[1])[0]?.[0];
    if (guess) counts[guess] = (counts[guess] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a,b) => a+b, 0);
  const options = Object.entries(counts).map(([answer,n]) => ({ answer, probability: total ? Math.round(n/total*100) : 0 })).sort((a,b)=>b.probability-a.probability);
  return { options, confidence: total >= 10 ? "Exploratory estimate" : "Low-data estimate" };
}

export function getQuestionStats(question, responses, phase = "initial") {
  const list = responses.filter(r => r.question_id === question.id && r.phase === phase);
  const counts = {};
  list.forEach(r => counts[r.answer] = (counts[r.answer] || 0) + 1);
  return { total: list.length, counts, options: question.options || [] };
}

// Pair-level matches for the host's Hidden Connections panel.
// Labels are anonymous and only ordinal within this room.
export function getHiddenConnections(participants, questions, responses) {
  const people = participants.map((id, index) => ({
    id,
    label: `Stranger ${String(index + 1).padStart(3, "0")}`
  }));
  const findings = [];

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const sharedAnswers = [];
      let compared = 0;
      let matches = 0;

      questions.forEach(question => {
        const a = responses.find(r =>
          r.participant_id === people[i].id &&
          r.question_id === question.id &&
          r.phase === "initial"
        )?.answer;
        const b = responses.find(r =>
          r.participant_id === people[j].id &&
          r.question_id === question.id &&
          r.phase === "initial"
        )?.answer;

        if (a == null || b == null) return;
        compared++;
        if (a === b) {
          matches++;
          sharedAnswers.push({ question: question.prompt, answer: a });
        }
      });

      if (compared < 2) continue;
      findings.push({
        first: people[i].label,
        second: people[j].label,
        compared,
        matches,
        score: Math.round(matches / compared * 100),
        sharedAnswers
      });
    }
  }

  return findings
    .sort((a, b) => b.score - a.score || b.matches - a.matches)
    .slice(0, 6);
}
