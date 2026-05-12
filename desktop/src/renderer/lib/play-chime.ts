let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

function playNote(audio: AudioContext, freq: number, startAt: number, durationSec: number): void {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // 5ms attack, exponential release to ~0 to avoid clicks at note boundaries.
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec)
  osc.connect(gain).connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + durationSec + 0.02)
}

export function playAgentDoneChime(): void {
  try {
    const audio = getCtx()
    if (!audio) return
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime
    const noteDur = 0.14
    playNote(audio, 523.25, now, noteDur)
    playNote(audio, 659.25, now + noteDur, noteDur)
  } catch {
    // Audio failures (no output device, autoplay block) must never crash the renderer.
  }
}
