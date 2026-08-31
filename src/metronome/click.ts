/**
 * The metronome click, synthesized with the Web Audio API — no sample assets and no extra dependency.
 *
 * Beats are scheduled ahead of time against the AudioContext clock rather than fired from a timer, since
 * a bare setInterval is far too jittery to be usable as a metronome ("A Tale of Two Clocks"): a coarse
 * timer wakes up regularly and queues every beat that falls inside a short lookahead window, and the audio
 * hardware plays them at exactly the requested time.
 */

import {Transport} from "./transport";

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.1;

const ACCENT_FREQUENCY = 1500;
const NORMAL_FREQUENCY = 900;
const CLICK_DURATION_SECONDS = 0.03;

export class MetronomeClick {
	private audioContext: AudioContext | null = null;
	private schedulerId: number | null = null;
	/** Index of the next beat to be scheduled. */
	private nextBeat = 0;

	constructor(private transport: Transport, private volume: number, private muted = false) {
	}

	get isRunning(): boolean {
		return this.schedulerId !== null;
	}

	setVolume(volume: number) {
		this.volume = volume;
	}

	/**
	 * Silences the click without stopping it. The scheduler keeps running so that unmuting picks up on
	 * the beat rather than having to catch up.
	 */
	setMuted(muted: boolean) {
		this.muted = muted;
	}

	/**
	 * Creates and resumes the AudioContext. Must be called from a user gesture (a button click or a
	 * command), otherwise browsers keep the context suspended.
	 */
	async prepareAudio(): Promise<AudioContext | null> {
		try {
			if (!this.audioContext) {
				this.audioContext = new AudioContext();
			}
			if (this.audioContext.state === "suspended") {
				await this.audioContext.resume();
			}
			return this.audioContext;
		} catch (e) {
			console.error("Chord Sheets: could not start audio for the metronome", e);
			return null;
		}
	}

	start() {
		if (this.isRunning) {
			return;
		}
		// Do not replay beats that have already gone by while the click was muted.
		this.nextBeat = Math.ceil(this.transport.currentBeat());
		this.schedulerId = window.setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
	}

	/**
	 * Picks the beat count back up from wherever the transport now is. Needed after a seek: the next beat
	 * to schedule was chosen against the old position, and would otherwise fire a burst of catch-up
	 * clicks or go quiet until the song caught up again.
	 */
	resync() {
		this.nextBeat = Math.ceil(this.transport.currentBeat());
	}

	stop() {
		if (this.schedulerId !== null) {
			window.clearInterval(this.schedulerId);
			this.schedulerId = null;
		}
	}

	destroy() {
		this.stop();
		this.audioContext?.close().catch(() => { /* already closed */ });
		this.audioContext = null;
	}

	private schedule() {
		if (!this.audioContext || !this.transport.isRunning) {
			return;
		}

		const horizon = this.transport.now() + LOOKAHEAD_SECONDS;
		while (this.transport.timeOfBeat(this.nextBeat) < horizon) {
			this.playBeat(this.nextBeat, Math.max(this.transport.timeOfBeat(this.nextBeat), this.transport.now()));
			this.nextBeat++;
		}
	}

	private playBeat(beat: number, time: number) {
		const {beatsPerBar, pattern} = this.transport.songMeta;
		// Silent beats still advance the count, so a 12/8 "X__x__x__x__" sounds four times per bar while
		// the transport keeps running on eighth notes.
		const emphasis = pattern[((beat % beatsPerBar) + beatsPerBar) % beatsPerBar];
		if (emphasis === "silent" || this.muted || this.volume <= 0) {
			return;
		}

		const context = this.audioContext!;
		const oscillator = context.createOscillator();
		const gain = context.createGain();

		oscillator.frequency.value = emphasis === "accent" ? ACCENT_FREQUENCY : NORMAL_FREQUENCY;
		const peak = this.volume * (emphasis === "accent" ? 1 : 0.6);
		gain.gain.setValueAtTime(peak, time);
		gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DURATION_SECONDS);

		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start(time);
		oscillator.stop(time + CLICK_DURATION_SECONDS);
	}
}
