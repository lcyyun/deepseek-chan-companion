// Native mouse state is a fallback for one DOM pointer session. Do not infer a
// release from the cached global button: it may belong to a preceding gesture.
function createPetPointerSession({ now = () => performance.now(), armingMs = 64,
  onChange = () => {}, onRelease = () => {} } = {}) {
  let session = null, lastSequence = -1, generation = 0;
  const state = () => ({ locked: Boolean(session), id: session?.id ?? null, nativeConfirmed: session?.confirmed === true });
  function clear() {
    if (!session) return false;
    session = null; generation++; onChange(state()); return true;
  }
  function control(value) {
    const legacy = typeof value === 'boolean';
    if (!legacy && (!value || typeof value.locked !== 'boolean' || typeof value.id !== 'string' || !value.id.length || value.id.length > 100)) throw new TypeError('桌宠指针会话无效');
    const locked = legacy ? value : value.locked, id = legacy ? null : value.id;
    if (!locked) {
      // An old boolean unlock has no authority over a new identified session.
      if (session && session.id === id) clear();
      return state();
    }
    if (session?.id === id) return state();
    session = { id, startedAt: now(), afterSequence: lastSequence, confirmed: false };
    generation++; onChange(state()); return state();
  }
  function sample({ down, seq } = {}) {
    if (typeof down !== 'boolean' || !Number.isSafeInteger(seq) || seq <= lastSequence) return;
    lastSequence = seq;
    const held = session;
    if (!held || seq <= held.afterSequence) return;
    if (!held.confirmed) {
      // Ignore queued press/release edges around the IPC boundary. Held native
      // samples arrive every 32ms; short clicks continue to use normal DOM up.
      if (down && now() - held.startedAt >= armingMs) held.confirmed = true;
      return;
    }
    if (down) return;
    session = null; const endingGeneration = ++generation;
    onChange(state()); // Restore the native shape before publishing completion.
    if (generation === endingGeneration) onRelease({ id: held.id });
  }
  return { control, sample, clear, state };
}

module.exports = { createPetPointerSession };
