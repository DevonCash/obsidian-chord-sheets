import {TapTempo} from "../src/metronome/tapTempo";
import {MAX_TEMPO, MIN_TEMPO} from "../src/metronome/songMeta";

/** Taps at a steady interval, returning the tempo after the last one. */
function tapAt(tapTempo: TapTempo, intervalMs: number, times: number, from = 1000) {
	let bpm: number | null = null;
	for (let i = 0; i < times; i++) {
		bpm = tapTempo.tap(from + i * intervalMs);
	}
	return bpm;
}

describe("TapTempo", () => {
	it("has no tempo to report from a single tap", () => {
		expect(new TapTempo().tap(1000)).toBeNull();
	});

	it("reads a tempo from two taps", () => {
		expect(tapAt(new TapTempo(), 500, 2)).toBe(120);
	});

	it("averages across taps, so one unsteady tap does not throw it off", () => {
		const tapTempo = new TapTempo();
		// 500ms apart but for one late tap; the average still lands on 120.
		[0, 500, 1040, 1500, 2000].forEach(offset => tapTempo.tap(1000 + offset));
		expect(tapTempo.tap(3500)).toBe(120);
	});

	it.each([
		[500, 120],
		[1000, 60],
		[250, 240],
		[docsInterval(96), 96],
	])("reads %ims between taps as %i BPM", (interval, expected) => {
		expect(tapAt(new TapTempo(), interval, 4)).toBe(expected);
	});

	it("starts over when the taps stop for a while", () => {
		const tapTempo = new TapTempo();
		tapAt(tapTempo, 500, 4);
		expect(tapTempo.count).toBe(4);

		// A long pause, then a new tap: the old taps are not averaged into the new tempo.
		tapTempo.tap(1000 + 3 * 500 + 5000);
		expect(tapTempo.count).toBe(1);
	});

	it("follows a change of pace rather than averaging the whole session", () => {
		const tapTempo = new TapTempo();
		// Eight taps at 120, then eight at 60: only the most recent are kept.
		let now = 1000;
		for (let i = 0; i < 8; i++) { tapTempo.tap(now); now += 500; }
		let bpm = null;
		for (let i = 0; i < 8; i++) { bpm = tapTempo.tap(now); now += 1000; }
		expect(bpm).toBe(60);
	});

	it("clamps a tempo faster than the usable range", () => {
		expect(tapAt(new TapTempo(), 10, 4)).toBe(MAX_TEMPO);
	});

	it("cannot be tapped slower than the restart window allows", () => {
		// Taps far enough apart to read as a very slow tempo restart the measurement instead, so the
		// slowest reachable tempo is set by the restart window rather than by the lower tempo limit.
		expect(tapAt(new TapTempo(), 10000, 2)).toBeNull();
		expect(tapAt(new TapTempo(), 1900, 2)).toBeGreaterThan(MIN_TEMPO);
	});

	it("ignores taps landing at the same instant, which have no interval", () => {
		const tapTempo = new TapTempo();
		expect(tapAt(tapTempo, 0, 3)).toBeNull();
	});

	it("forgets its taps when reset", () => {
		const tapTempo = new TapTempo();
		tapAt(tapTempo, 500, 4);
		tapTempo.reset();
		expect(tapTempo.count).toBe(0);
		expect(tapTempo.tap(9999)).toBeNull();
	});
});

/** Interval between beats at a given tempo, as the metronome itself would use. */
function docsInterval(bpm: number): number {
	return 60000 / bpm;
}
