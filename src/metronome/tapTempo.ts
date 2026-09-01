/**
 * Works out a tempo from the intervals between taps.
 *
 * Pure (the caller supplies the clock) so it stays testable, and shared by the tap tempo command and the
 * button in the metronome dialog.
 */

import {MAX_TEMPO, MIN_TEMPO} from "./songMeta";

/**
 * Taps further apart than this start a new measurement rather than extending the last one.
 *
 * Derived from the slowest tempo allowed, with room to spare, so that every tempo in range can actually
 * be tapped. A fixed window cannot: a beat unit of a dotted half or a whole note is several seconds
 * long, and taps that far apart would restart the measurement every time.
 */
export const RESTART_AFTER_MS = (60000 / MIN_TEMPO) * 1.25;
/** Only the most recent taps are averaged, so speeding up or slowing down is followed. */
const MAX_TAPS = 8;

export class TapTempo {
	private taps: number[] = [];

	/** Number of taps in the current measurement. */
	get count(): number {
		return this.taps.length;
	}

	/**
	 * Records a tap and returns the tempo it implies, or null while there is only one tap to go on —
	 * a single tap has no interval, and so no tempo.
	 */
	tap(now: number): number | null {
		const last = this.taps[this.taps.length - 1];
		if (last !== undefined && now - last > RESTART_AFTER_MS) {
			this.taps = [];
		}

		this.taps.push(now);
		this.taps = this.taps.slice(-MAX_TAPS);

		if (this.taps.length < 2) {
			return null;
		}

		const averageInterval = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
		if (averageInterval <= 0) {
			return null;
		}

		const bpm = Math.round(60000 / averageInterval);
		return Math.min(Math.max(bpm, MIN_TEMPO), MAX_TEMPO);
	}

	reset() {
		this.taps = [];
	}
}
