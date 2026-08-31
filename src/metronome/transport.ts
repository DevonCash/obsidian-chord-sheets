/**
 * The shared musical clock. Both the metronome click and the tempo-aware scroll read their position from
 * this one object, which is what keeps them locked in phase no matter which of them is running.
 *
 * Time is read from an AudioContext when one is available (its clock is far steadier than
 * performance.now()) and falls back to performance.now() when audio could not be started.
 */

import {SongMeta} from "./songMeta";

export class Transport {
	private running = false;
	/** Beat position at which the current run started, so pausing and resuming does not lose the place. */
	private beatOffset = 0;
	/** Clock reading, in seconds, at which the current run started. */
	private startedAt = 0;

	constructor(private meta: SongMeta, private audioContext: AudioContext | null = null) {
	}

	get isRunning(): boolean {
		return this.running;
	}

	get songMeta(): SongMeta {
		return this.meta;
	}

	setAudioContext(audioContext: AudioContext | null) {
		if (audioContext === this.audioContext) {
			return;
		}
		// Rebase onto the new clock so the beat position stays continuous.
		const beat = this.currentBeat();
		this.audioContext = audioContext;
		this.beatOffset = beat;
		this.startedAt = this.now();
	}

	/** Current clock reading in seconds. */
	now(): number {
		return this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
	}

	/** Fractional beats elapsed since the song started. */
	currentBeat(): number {
		if (!this.running) {
			return this.beatOffset;
		}
		return this.beatOffset + (this.now() - this.startedAt) * (this.meta.bpm / 60);
	}

	/** Clock time in seconds at which the given beat falls due. */
	timeOfBeat(beat: number): number {
		return this.startedAt + (beat - this.beatOffset) * (60 / this.meta.bpm);
	}

	start() {
		if (this.running) {
			return;
		}
		this.startedAt = this.now();
		this.running = true;
	}

	pause() {
		if (!this.running) {
			return;
		}
		this.beatOffset = this.currentBeat();
		this.running = false;
	}

	/**
	 * Moves playback to a given beat, keeping the bar phase that beat falls on — seeking to a chord that
	 * starts on beat 3 of its bar leaves the count on 3, rather than restarting it.
	 */
	seek(beat: number) {
		this.beatOffset = beat;
		this.startedAt = this.now();
	}

	/** Rewinds to the beginning of the song. */
	reset() {
		this.beatOffset = 0;
		this.startedAt = this.now();
	}

	/**
	 * Applies new song settings. A tempo change rebases the beat position so the count stays continuous
	 * rather than jumping.
	 */
	setSongMeta(meta: SongMeta) {
		const beat = this.currentBeat();
		this.meta = meta;
		this.beatOffset = beat;
		this.startedAt = this.now();
	}
}
