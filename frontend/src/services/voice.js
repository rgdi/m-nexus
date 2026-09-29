/* services/voice.js — v2.38.1 dictation.
 *
 * Press a button, talk, and the words land in the field you were already
 * typing in.
 *
 * ── Why the Web Speech API and not audio_recorder ────────────────
 * The app already has `audio_recorder.js` for capturing lectures to
 * transcribe later. That is the wrong tool here: a capture meant for the
 * capture inbox is a thought you want in the field *now*, while you
 * remember it, and it is five seconds long, not fifty. Recognition runs
 * in the browser, needs no upload, and works with the phone in your
 * pocket.
 *
 * ── Platform reality ─────────────────────────────────────────────
 * `SpeechRecognition` is Chromium-only. Safari and Firefox do not have
 * it. So this never pretends: `voiceSupport()` is the single source of
 * truth and the UI hides the button entirely when the answer is no. The
 * alternative — showing a button that silently does nothing — is the
 * exact failure this project spent v2.37.0 cleaning up.
 *
 * Recognition is also network-dependent on Chrome: the audio goes to
 * Google's speech service for Chromium builds. That is a real privacy
 * consideration, so `isCloudBacked()` is exposed and the capture screen
 * says so in the toggle's title rather than leaving the user to guess.
 */

const SR = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

/** True only where the browser can actually transcribe. */
export function voiceSupport() {
  return !!SR;
}

/**
 * Chromium's implementation streams audio to a remote recogniser.
 * Worth telling the user before the mic opens, not after.
 */
export function isCloudBacked() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /Chrome|Chromium|Crios|Edg\//i.test(ua) && !/Firefox/i.test(ua);
}

let rec = null;

/**
 * Start dictating into a textarea.
 *
 * @param {HTMLTextAreaElement} target
 * @param {{
 *   onStart?: () => void,
 *   onPartial?: (text: string) => void,
 *   onEnd?: () => void,
 *   onError?: (msg: string) => void,
 *   lang?: string,
 * }} opts
 * @returns {boolean} false if unsupported or already running
 */
export function startDictation(target, opts = {}) {
  if (!SR) { opts.onError?.("Este navegador no reconoce voz"); return false; }
  if (rec) { opts.onError?.("Ya está escuchando"); return false; }

  const r = new SR();
  r.lang = opts.lang ?? (typeof navigator !== "undefined" ? navigator.language || "es-ES" : "es-ES");
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  // Where the dictated text gets inserted. Recorded once, because by the
  // time a result arrives the caret may have moved and the text would
  // land in the wrong place.
  let caret = target.selectionStart ?? target.value.length;
  let base = target.value;

  r.onstart = () => opts.onStart?.();

  r.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    // Re-apply from the recorded base each time, so interim text does
    // not accumulate on top of itself.
    target.value = base.slice(0, caret) + final + interim + base.slice(caret);
    const pos = base.slice(0, caret).length + final.length + interim.length;
    target.setSelectionRange(pos, pos);
    if (interim) opts.onPartial?.(interim);
  };

  r.onerror = (e) => {
    const msg =
      e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Permiso de micrófono denegado"
        : e.error === "no-speech"
          ? "No se detectó voz"
          : e.error === "network"
            ? "El reconocimiento necesita conexión"
            : `Error de voz: ${e.error}`;
    opts.onError?.(msg);
  };

  r.onend = () => {
    rec = null;
    opts.onEnd?.();
  };

  try {
    r.start();
    rec = r;
    return true;
  } catch (e) {
    opts.onError?.(String(e?.message ?? e));
    return false;
  }
}

export function stopDictation() {
  try { rec?.stop(); } catch { /* already stopped */ }
  rec = null;
}

export function isListening() {
  return rec !== null;
}
