
import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, ArrowRight, BarChart3, Check, Copy, DoorOpen,
  Eye, LockKeyhole, Plus, Radio, RefreshCw, Sparkles, Users, Zap
} from "lucide-react";
import {
  buildClusters, findOppositeSimilarities, getHiddenConnections, getOpinionShifts, getQuestionStats, predictNext
} from "./lib/engine";
import {
  createRoom, getRoom, isCloudEnabled, newParticipantId,
  submitResponse, subscribeRoom, updateRoom
} from "./lib/store";

const getPid = code => {
  const key = `secret-participant-${code}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = newParticipantId();
    localStorage.setItem(key, id);
  }
  return id;
};

// Restore previously saved answers for this participant.
// In round 2, start with round 1 answers so participants can keep or change them.
const makeDraftAnswers = (data, participantId, phase) => {
  const answers = {};

  if (!data || !participantId) return answers;

  data.responses
    .filter(r => r.participant_id === participantId)
    .forEach(r => {
      if (phase === "initial" && r.phase === "initial") {
        answers[r.question_id] = r.answer;
      }

      if (phase === "after_reveal" && r.phase === "initial") {
        answers[r.question_id] = r.answer;
      }

      if (phase === "after_reveal" && r.phase === "after_reveal") {
        answers[r.question_id] = r.answer;
      }
    });

  return answers;
};

export default function App() {
  const [view, setView] = useState("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomData, setRoomData] = useState(null);
  const [participantId, setParticipantId] = useState("");
  const [draftAnswers, setDraftAnswers] = useState({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState("initial");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const inviteUrl = useMemo(() => {
    if (!roomCode) return "";
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", roomCode);
    return url.toString();
  }, [roomCode]);

  const isHost = roomCode &&
    localStorage.getItem("secret-host-" + roomCode) === "yes";

  const questions = roomData?.questions || [];
  const responses = roomData?.responses || [];
  const question = questions[questionIndex];

  const participants = useMemo(
    () => [...new Set(
      responses
        .filter(r => r.phase === "initial")
        .map(r => r.participant_id)
    )].sort(),
    [responses]
  );

  // Check whether this participant has submitted every answer in this round.
  const phaseSubmitted = questions.length > 0 && questions.every(q =>
    responses.some(r =>
      r.question_id === q.id &&
      r.participant_id === participantId &&
      r.phase === phase
    )
  );

  const answeredCount = questions.filter(q => draftAnswers[q.id]).length;

  async function refresh(code = roomCode) {
    if (!code) return;
    const data = await getRoom(code);
    if (data) setRoomData(data);
  }

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search)
      .get("room")?.trim().toUpperCase();

    if (!inviteCode) return;

    let cancelled = false;

    (async () => {
      setBusy(true);
      setError("");

      try {
        const data = await getRoom(inviteCode);

        if (!data) {
          throw new Error(
            "This room link is invalid or the room is no longer available."
          );
        }

        if (cancelled) return;

        const pid = getPid(inviteCode);

        setRoomCode(inviteCode);
        setRoomData(data);
        setParticipantId(pid);
        setDraftAnswers(makeDraftAnswers(data, pid, "initial"));
        setView("participant");
        setQuestionIndex(0);
        setPhase("initial");
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Couldn't open this room link.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roomCode) return;

    refresh(roomCode).catch(e => setError(e.message));

    const unsubscribe = subscribeRoom(
      roomCode,
      () => refresh(roomCode).catch(() => {})
    );

    const timer = setInterval(
      () => refresh(roomCode).catch(() => {}),
      5000
    );

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [roomCode]);

  async function handleCreate() {
    setBusy(true);
    setError("");

    try {
      const code = await createRoom();

      setRoomCode(code);
      setParticipantId(getPid(code));
      setDraftAnswers({});
      setView("host");
      setQuestionIndex(0);
      setPhase("initial");

      await refresh(code);
    } catch (e) {
      setError(e.message || "Couldn't create room.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const code = joinCode.trim().toUpperCase();

    try {
      const data = await getRoom(code);

      if (!data) {
        throw new Error("Room not found. Check the PIN and try again.");
      }

      const pid = getPid(code);

      setRoomCode(code);
      setRoomData(data);
      setParticipantId(pid);
      setDraftAnswers(makeDraftAnswers(data, pid, "initial"));
      setView("participant");
      setQuestionIndex(0);
      setPhase("initial");
    } catch (e) {
      setError(e.message || "Couldn't join room.");
    } finally {
      setBusy(false);
    }
  }

  // Selecting an answer automatically moves to the next question.
  function chooseAnswer(answer) {
    if (!question || busy || phaseSubmitted) return;

    setDraftAnswers(previous => ({
      ...previous,
      [question.id]: answer
    }));

    if (questionIndex < questions.length - 1) {
      setQuestionIndex(index => index + 1);
    } else {
      // The last answer takes the participant to the review screen.
      setQuestionIndex(questions.length);
    }
  }

  // Save all answers after the participant confirms the review screen.
  async function submitAllAnswers() {
    if (busy || phaseSubmitted) return;

    const unanswered = questions.filter(q => !draftAnswers[q.id]);

    if (unanswered.length > 0) {
      setError("Please answer every question before submitting.");
      setQuestionIndex(questions.indexOf(unanswered[0]));
      return;
    }

    setBusy(true);
    setError("");

    try {
      for (const q of questions) {
        await submitResponse(
          roomCode,
          q.id,
          participantId,
          draftAnswers[q.id],
          phase
        );
      }

      await refresh();

      setNotice(
        phase === "initial"
          ? "Your answers have been submitted successfully."
          : "Your reflection answers have been submitted successfully."
      );
    } catch (e) {
      setError(
        e.message ||
        "Some answers could not be submitted. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    setBusy(true);

    try {
      await updateRoom(roomCode, { status: "revealed" });
      await refresh();
      setNotice("Results are now visible to the room.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startAgain() {
    setBusy(true);

    try {
      await updateRoom(roomCode, { status: "voting" });
      await refresh();
      setNotice("The room is open for the next round.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      setNotice(`Invite link: ${inviteUrl}`);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice(`Room PIN: ${roomCode}`);
    }
  }

  const initialCount = responses.filter(
    r => r.phase === "initial"
  ).length;

  const postResponses = responses.filter(
    r => r.phase === "after_reveal"
  );

  const postCount = postResponses.filter(after => {
    const before = responses.find(r =>
      r.phase === "initial" &&
      r.question_id === after.question_id &&
      r.participant_id === after.participant_id
    );

    return before && before.answer !== after.answer;
  }).length;

  const clusters = useMemo(
    () => buildClusters(participants, questions, responses),
    [participants, questions, responses]
  );

  const opposite = useMemo(
    () => findOppositeSimilarities(participants, questions, responses),
    [participants, questions, responses]
  );

  const hiddenConnections = useMemo(
    () => getHiddenConnections(participants, questions, responses),
    [participants, questions, responses]
  );

  const opinionShifts = useMemo(
    () => getOpinionShifts(participants, questions, responses),
    [participants, questions, responses]
  );

  const prediction = useMemo(
    () => predictNext(questions, responses, participants),
    [questions.length, responses.length, participants.length]
  );

  function goHome() {
    setView("home");
    setRoomCode("");
    setRoomData(null);
    setParticipantId("");
    setDraftAnswers({});
    setQuestionIndex(0);
    setPhase("initial");
    setError("");
    setNotice("");
  }

  function beginReflection() {
    setPhase("after_reveal");
    setDraftAnswers(
      makeDraftAnswers(roomData, participantId, "after_reveal")
    );
    setQuestionIndex(0);
    setNotice("You can now reconsider your answers.");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={goHome}>
          <span className="brand-mark">S</span>
          <span>SECRET<span className="dot">.</span></span>
        </button>

        <div className="top-meta">
          <span className="live-dot"></span>
          {isCloudEnabled ? "CLOUD SYNC" : "LOCAL DEMO"}
        </div>
      </header>

      {error && (
        <div className="toast error">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}

      {notice && (
        <div className="toast success">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}

      {view === "home" && (
        <main className="hero">
          <div className="eyebrow">
            <Sparkles size={14} /> A HUMAN DECISION EXPERIMENT
          </div>

          <h1>
            Think differently.<br />
            <span>Discover together.</span>
          </h1>

          <p className="hero-copy">
            Private thoughts. Collective discovery. Explore how people decide,
            where perspectives overlap, and how opinions shift.
          </p>

          <div className="home-grid">
            <section className="panel create-panel">
              <div className="panel-icon"><Plus /></div>
              <h2>Host an experiment</h2>
              <p>
                Create a private room, invite people, and reveal the patterns
                behind their decisions.
              </p>
              <button
                className="button primary full"
                disabled={busy}
                onClick={handleCreate}
              >
                {busy ? "Creating..." : "Create a room"}
                <ArrowRight size={17} />
              </button>
            </section>

            <section className="panel join-panel">
              <div className="panel-icon muted"><DoorOpen /></div>
              <h2>Join a room</h2>
              <p>Have a room PIN? Enter it to take part in the experiment.</p>

              <form onSubmit={handleJoin} className="join-form">
                <input
                  aria-label="Room PIN"
                  placeholder="ENTER ROOM PIN"
                  value={joinCode}
                  maxLength={6}
                  onChange={e =>
                    setJoinCode(e.target.value.toUpperCase())
                  }
                />
                <button
                  className="button secondary full"
                  disabled={busy || joinCode.trim().length < 4}
                >
                  {busy ? "Joining..." : "Join room"}
                  <ArrowRight size={17} />
                </button>
              </form>
            </section>
          </div>

          <div className="feature-strip">
            <span><LockKeyhole size={15} /> Anonymous by design</span>
            <span><Users size={15} /> Shared experiences</span>
            <span><Zap size={15} /> Live insights</span>
          </div>
        </main>
      )}

      {view === "host" && roomData && (
        <main className="workspace">
          <div className="workspace-head">
            <button className="back-link" onClick={goHome}>
              <ArrowLeft size={16} /> Home
            </button>
            <span className="status-pill">
              <span className="live-dot"></span> HOST CONTROL
            </span>
          </div>

          <div className="room-title">
            <div>
              <div className="eyebrow">YOUR EXPERIMENT</div>
              <h1>Room <span>{roomCode}</span></h1>
              <p>Invite participants by scanning this QR code.</p>
            </div>
            <button className="icon-button" onClick={copyCode}>
              <Copy size={17} /> {copied ? "Copied" : "Copy PIN"}
            </button>
          </div>

          <section className="panel invite-panel">
            <div className="invite-copy">
              <div className="eyebrow">SCAN TO JOIN</div>
              <h2>Bring everyone into the room.</h2>
              <p>
                Ask participants to scan this QR code with their phone camera.
                Their browser will open directly into your room.
              </p>
              <button
                className="button secondary"
                onClick={copyInviteLink}
              >
                <Copy size={16} />
                {linkCopied ? "Link copied" : "Copy invite link"}
              </button>
              <span className="invite-note">
                Room PIN {roomCode} remains available as a backup.
              </span>
            </div>

            <div className="qr-frame">
              <QRCodeSVG value={inviteUrl} size={184} level="H" includeMargin />
            </div>
          </section>

          <section className="panel host-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">LIVE PARTICIPATION</div>
                <h2>Room overview</h2>
              </div>
              <button className="icon-button" onClick={() => refresh()}>
                <RefreshCw size={16} /> Refresh
              </button>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <Users />
                <strong>{participants.length}</strong>
                <span>Participants</span>
              </div>
              <div className="stat-card">
                <BarChart3 />
                <strong>{initialCount}</strong>
                <span>Initial answers</span>
              </div>
              <div className="stat-card">
                <Radio />
                <strong>{postCount}</strong>
                <span>Changed answers</span>
              </div>
            </div>

            <div className="question-admin">
              <div className="eyebrow">
                QUESTION {questionIndex + 1} OF {questions.length}
              </div>
              <h3>{question?.prompt || "No question available"}</h3>
              <div className="question-nav">
                <button
                  className="button secondary"
                  disabled={questionIndex === 0}
                  onClick={() => setQuestionIndex(i => i - 1)}
                >
                  Previous
                </button>
                <button
                  className="button secondary"
                  disabled={questionIndex >= questions.length - 1}
                  onClick={() => setQuestionIndex(i => i + 1)}
                >
                  Next question
                </button>
              </div>
            </div>

            <div className="action-row">
              <button
                className="button primary"
                disabled={busy}
                onClick={reveal}
              >
                <Eye size={17} /> Reveal results
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={startAgain}
              >
                <RefreshCw size={16} /> Open response round
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">ROOM INTELLIGENCE</div>
                <h2>What the answers reveal</h2>
              </div>
              <span className="soft-label">Exploratory insights</span>
            </div>

            <div className="insight-grid">
              <div className="insight-card">
                <h3>Thinking patterns</h3>
                <p>Groups based on similarity across initial answers.</p>
                {clusters.length ? clusters.map(c => (
                  <div className="cluster-row" key={c.name}>
                    <span className="cluster-dot"></span>
                    <span>{c.name}</span>
                    <b>{c.size} people</b>
                  </div>
                )) : (
                  <p className="empty">
                    Waiting for at least a few responses.
                  </p>
                )}
              </div>

              <div className="insight-card">
                <h3>Unexpected overlap</h3>
                <p>
                  Participants can disagree on individual choices while
                  sharing broader response patterns.
                </p>
                <strong className="big-number">{opposite.length}</strong>
                <span className="small-muted">potential overlap signals</span>
              </div>
            </div>

            <div className="connections-panel">
              <div className="connections-heading">
                <div>
                  <div className="eyebrow">HIDDEN CONNECTIONS</div>
                  <h3>Strangers who think alike</h3>
                  <p>Anonymous matches based on answers both people submitted in round one.</p>
                </div>
                <span className="connection-count">{hiddenConnections.length} matches</span>
              </div>
              {hiddenConnections.length ? (
                <div className="connection-list">
                  {hiddenConnections.map(match => (
                    <article className="connection-card" key={match.first + match.second}>
                      <div className="connection-topline">
                        <div className="connection-people">
                          <span>{match.first}</span>
                          <span className="connection-link">↔</span>
                          <span>{match.second}</span>
                        </div>
                        <strong>{match.score}%</strong>
                      </div>
                      <div className="connection-meter">
                        <span style={{ width: `${match.score}%` }} />
                      </div>
                      <div className="connection-subtitle">
                        Agreed on {match.matches} of {match.compared} compared questions
                      </div>
                      {match.sharedAnswers.length ? (
                        <div className="shared-answers">
                          {match.sharedAnswers.slice(0, 3).map((item, answerIndex) => (
                            <div key={answerIndex}>
                              <span>{item.question}</span>
                              <b>{item.answer}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="connection-subtitle">No matching answers yet.</div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty connection-empty">
                  At least two participants need to answer two or more questions before connections can be calculated.
                </p>
              )}
              <p className="connection-footnote">
                This is a simple answer-overlap score, not a personality assessment.
              </p>
            </div>

            <div className="shift-panel">
              <div className="connections-heading">
                <div>
                  <div className="eyebrow">OPINION SHIFT ANALYSIS</div>
                  <h3>What changed after the reveal?</h3>
                  <p>Compares each participant's first-round answers with their submitted reflection answers.</p>
                </div>
                <span className="connection-count">
                  {postResponses.length ? `${postCount} changes` : "Awaiting round 2"}
                </span>
              </div>
              {opinionShifts.length ? (
                <div className="shift-list">
                  {opinionShifts.map(person => (
                    <article className="shift-card" key={person.label}>
                      <div className="shift-person">
                        <b>{person.label}</b>
                        <span>{person.changed} changed · {person.unchanged} stayed the same</span>
                      </div>
                      <div className="shift-details">
                        {person.changes.length ? person.changes.map((change, index) => (
                          <div className="shift-change" key={index}>
                            <span>{change.question}</span>
                            <div><b>{change.before}</b><span className="shift-arrow">→</span><b>{change.after}</b></div>
                          </div>
                        )) : (
                          <p className="empty">No answer changes in the submitted reflection.</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty connection-empty">
                  Opinion shifts will appear after participants submit their second-round answers.
                </p>
              )}
              <p className="connection-footnote">
                Only submitted answers are compared. A change does not prove that the group caused it.
              </p>
            </div>

            <div className="prediction-card">
              <div>
                <div className="eyebrow">RESPONSIBLE FORECASTING</div>
                <h3>Why no prediction is shown yet</h3>
                <p>{prediction.reason}</p>
                <p className="connection-footnote">
                  SECRET will only show a forecast when it has enough comparable historical data to support one.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">QUESTION RESULTS</div>
                <h2>Answer distribution</h2>
              </div>
            </div>

            {questions.map(
          
(q, i) => {
  const s = getQuestionStats(q, responses);

  return (
    <div className="result-row" key={q.id}>
      <div className="result-question">
        <span>Q{i + 1}</span>{q.prompt}
      </div>
      <div className="result-options">
        {q.options.map(opt => (
          <div className="result-option" key={opt}>
            <div className="bar-label">
              <span>{opt}</span>
              <b>{s.counts[opt] || 0}</b>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${
                    s.total
                      ? (s.counts[opt] || 0) / s.total * 100
                      : 0
                  }%`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
})}
          </section>
        </main>
      )}

      {view === "participant" && roomData && (
        <main className="participant-wrap">
          <div className="workspace-head">
            <button className="back-link" onClick={goHome}>
              <ArrowLeft size={16} /> Home
            </button>
            <span className="status-pill">ROOM {roomCode}</span>
          </div>

          <section className="panel participant-panel">
            <div className="eyebrow">YOUR PRIVATE RESPONSE</div>

            {roomData.room.status === "revealed" &&
            phase === "initial" ? (
              <>
                <div className="revealed-icon"><Eye size={22} /></div>
                <h1>The room has spoken.</h1>
                <p className="hero-copy">
                  The host has revealed the group's answers. Take a look at
                  the results, then consider whether you'd like to change
                  your answer.
                </p>

                {questions.map((q, i) => {
                  const s = getQuestionStats(q, responses);
                  return (
                    <div className="mini-result" key={q.id}>
                      <b>Q{i + 1}. {q.prompt}</b>
                      <span>
                        {s.total} responses ·{" "}
                        {Object.entries(s.counts)
                          .sort((a, b) => b[1] - a[1])[0]?.[0] ||
                          "No votes"} leads
                      </span>
                    </div>
                  );
                })}

                <button
                  className="button primary full"
                  onClick={beginReflection}
                >
                  Review my answers <ArrowRight size={17} />
                </button>
              </>
            ) : phaseSubmitted ? (
              <>
                <div className="revealed-icon"><Check size={22} /></div>
                <h1>You're all set.</h1>
                <p className="hero-copy">
                  {phase === "initial"
                    ? "Your personal answers have been submitted. Wait for the host to reveal the group's results."
                    : "Your reflection answers have been submitted. Thank you for taking part."}
                </p>
                <div className="mini-result">
                  <b>{questions.length} of {questions.length} answers submitted</b>
                  <span>Your responses have been recorded for this round.</span>
                </div>
              </>
            ) : questionIndex < questions.length ? (
              <>
                <div className="question-progress">
                  <span>QUESTION {questionIndex + 1} / {questions.length}</span>
                  <span>
                    {phase === "initial"
                      ? "ROUND 1 · PRIVATE"
                      : "ROUND 2 · REFLECTION"}
                  </span>
                </div>

                <h1>{question?.prompt || "Waiting for questions..."}</h1>
                <p className="hero-copy">
                  {phase === "initial"
                    ? "Choose the answer that feels right to you. Your choice stays private until the reveal."
                    : "You've seen the group's results. Would you like to keep or change your answer?"}
                </p>

                <div className="answer-list">
                  {(question?.options || []).map(opt => (
                    <button
                      key={opt}
                      className={`answer-option ${
                        draftAnswers[question.id] === opt ? "selected" : ""
                      }`}
                      disabled={busy}
                      onClick={() => chooseAnswer(opt)}
                    >
                      <span className="radio">
                        {draftAnswers[question.id] === opt &&
                          <Check size={14} />}
                      </span>
                      {opt}
                    </button>
                  ))}
                </div>

                <div className="question-nav">
                  <button
                    className="text-button"
                    disabled={questionIndex === 0 || busy}
                    onClick={() => setQuestionIndex(i => i - 1)}
                  >
                    <ArrowLeft size={15} /> Previous
                  </button>
                  <span className="small-muted">
                    {answeredCount} / {questions.length} answered
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="question-progress">
                  <span>FINAL REVIEW</span>
                  <span>
                    {phase === "initial"
                      ? "ROUND 1 · PRIVATE"
                      : "ROUND 2 · REFLECTION"}
                  </span>
                </div>

                <h1>Review your answers.</h1>
                <p className="hero-copy">
                  Check your choices below. You can edit any answer before
                  submitting your complete response.
                </p>

                {questions.map((q, i) => (
                  <div className="mini-result review-answer" key={q.id}>
                    <div>
                      <b>Q{i + 1}. {q.prompt}</b>
                      <span>
                        {draftAnswers[q.id] || "Not answered yet"}
                      </span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setQuestionIndex(i)}
                    >
                      Edit
                    </button>
                  </div>
                ))}

                <div className="small-muted review-count">
                  {answeredCount} of {questions.length} answers completed
                </div>

                <button
                  className="button primary full submit-button"
                  disabled={
                    busy ||
                    answeredCount !== questions.length ||
                    questions.length === 0
                  }
                  onClick={submitAllAnswers}
                >
                  {busy
                    ? "Submitting your answers..."
                    : "Submit Your Personal Answers"}
                  {!busy && <ArrowRight size={17} />}
                </button>

                <button
                  className="text-button review-back"
                  disabled={busy}
                  onClick={() =>
                    setQuestionIndex(Math.max(0, questions.length - 1))
                  }
                >
                  <ArrowLeft size={15} /> Back to answers
                </button>
              </>
            )}
          </section>
        </main>
      )}

      <footer className="footer">
        <span>SECRET<span className="dot">.</span></span>
        <span>Private thoughts. Collective discovery.</span>
        <span>{isCloudEnabled ? "Cloud-connected" : "Local demo mode"}</span>
      </footer>
    </div>
  );
                                                    }
