import { ensureAnonymousSession, getCurrentUserId, isCloudEnabled, supabase } from "./supabase";

const KEY = "secret-demo-v1";
const read = () => JSON.parse(localStorage.getItem(KEY) || '{"rooms":[],"questions":[],"responses":[]}');
const write = data => localStorage.setItem(KEY, JSON.stringify(data));
const code = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
};
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export const demoQuestions = [
  { prompt: "If everyone disagrees with you, would you change your decision?", options: ["Yes", "No", "It depends"] },
  { prompt: "Is telling a difficult truth better than protecting someone's feelings?", options: ["Always tell the truth", "Protect their feelings", "It depends"] },
  { prompt: "Would you choose a secure life over a risky opportunity you believe in?", options: ["Security", "Take the risk", "It depends"] },
  { prompt: "Should rules be followed when breaking them helps someone?", options: ["Follow the rules", "Help the person", "It depends"] },
  { prompt: "Can a group make a better decision than one thoughtful individual?", options: ["Usually yes", "Usually no", "Depends on the group"] },
  { prompt: "Would you change your answer after seeing what most people chose?", options: ["Yes", "No", "Maybe"] }
];

export async function createRoom(title = "Untitled experiment") {
  const roomCode = code();
  const room = { code: roomCode, title, status: "waiting", created_at: new Date().toISOString() };
  const questions = demoQuestions.map((q, i) => ({ ...q, id: `${roomCode}-q${i+1}`, room_code: roomCode, position: i+1 }));
  if (isCloudEnabled) {
    const user = await ensureAnonymousSession();
    room.host_user_id = user.id;
    const { error: roomError } = await supabase.from("rooms").insert(room);
    if (roomError) throw roomError;
    const { error: qError } = await supabase.from("questions").insert(questions);
    if (qError) {
      // Avoid leaving a host-owned room behind if its question batch fails.
      await supabase.from("rooms").delete().eq("code", roomCode);
      throw qError;
    }
  } else {
    const data = read(); data.rooms.push(room); data.questions.push(...questions); write(data);
  }
  localStorage.setItem("secret-host-" + roomCode, "yes");
  return roomCode;
}

export async function getRoomParticipantId(roomCode) {
  if (!isCloudEnabled) return null;
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc("get_room_participant_id", {
    p_room_code: roomCode
  });
  if (error) throw error;
  if (!data) throw new Error("Could not establish your anonymous participant identity.");
  return data;
}

export async function getRoom(roomCode) {
  if (isCloudEnabled) {
    await ensureAnonymousSession();
    const { data: bundle, error: roomError } = await supabase.rpc("get_room_bundle", {
      p_code: roomCode
    });
    if (roomError) throw roomError;
    if (!bundle) return null;
    const { data: responses, error: responseError } = await supabase
      .from("responses").select("id,room_code,question_id,participant_id,answer,phase,created_at").eq("room_code", roomCode);
    if (responseError) throw responseError;
    return {
      room: bundle.room,
      questions: bundle.questions || [],
      responses: responses || []
    };
  }
  const d = read();
  const room = d.rooms.find(r => r.code === roomCode);
  return room ? { room, questions: d.questions.filter(q=>q.room_code===roomCode), responses: d.responses.filter(r=>r.room_code===roomCode) } : null;
}

export async function submitResponse(roomCode, questionId, participantId, answer, phase = "initial") {
  const row = { id: uid(), room_code: roomCode, question_id: questionId, participant_id: participantId, answer, phase, created_at: new Date().toISOString() };
  if (isCloudEnabled) {
    const user = await ensureAnonymousSession();
    row.user_id = user.id;
    const { error } = await supabase.from("responses").upsert(row, { onConflict: "room_code,question_id,participant_id,phase" });
    if (error) throw error;
  } else {
    const d = read();
    const i = d.responses.findIndex(r=>r.room_code===roomCode && r.question_id===questionId && r.participant_id===participantId && r.phase===phase);
    if (i >= 0) d.responses[i] = row; else d.responses.push(row);
    write(d);
  }
  return row;
}

export async function updateRoom(roomCode, updates) {
  if (isCloudEnabled) {
    await ensureAnonymousSession();
    const { error } = await supabase.from("rooms").update(updates).eq("code", roomCode);
    if (error) throw error;
  } else {
    const d = read(); const room = d.rooms.find(r=>r.code===roomCode);
    if (room) Object.assign(room, updates);
    write(d);
  }
}

export function subscribeRoom(roomCode, callback) {
  if (!isCloudEnabled) return () => {};
  const channel = supabase.channel("room-" + roomCode)
    .on("postgres_changes", { event: "*", schema: "public", table: "responses", filter: `room_code=eq.${roomCode}` }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${roomCode}` }, callback)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function newParticipantId() {
  const id = uid();
  return id;
}

export { getCurrentUserId, isCloudEnabled };
