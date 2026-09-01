import {TapTempo} from "../src/metronome/tapTempo";
import {
	barDurationMs,
	MAX_TEMPO,
	MIN_TEMPO,
	parseSongMeta,
	tempoFromTappedClicks
} from "../src/metronome/songMeta";

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

	it("can be tapped anywhere in the usable tempo range", () => {
		// A slow beat unit — a dotted half, a whole note — has seconds between beats, and has to be
		// tappable at that speed rather than restarting the measurement on every tap.
		for (const bpm of [MIN_TEMPO, 30, 40, 60, 120, 240]) {
			expect(tapAt(new TapTempo(), 60000 / bpm, 4)).toBe(bpm);
		}
	});

	it("still restarts when the taps stop being a tempo at all", () => {
		// Slower than anything in range: a new measurement, not a very slow one.
		expect(tapAt(new TapTempo(), 10000, 2)).toBeNull();
	});

	it("ignores taps landing at the same instant, which have no interval", () => {
		const tapTempo = new TapTempo();
		expect(tapAt(tapTempo, 0, 3)).toBeNull();
	});

	it.each([
		// Tap a beat, and a bar lasts however many of those beats it holds.
		["4/4", 750, 3000],    // 4 quarters
		["12/8", 750, 3000],   // 4 dotted quarters, not 12 eighths
		["6/8", 750, 1500],    // 2 dotted quarters
		["3/4", 500, 1500],    // 3 quarters
		["2/2", 1000, 2000],   // 2 half notes
	])("in %s, tapping every %ims makes a bar last %ims", (timeSignature, interval, expected) => {
		const bpm = tapAt(new TapTempo(), interval, 4)!;
		const meta = parseSongMeta(
			{tempo: bpm, "time-signature": timeSignature},
			{tempo: 100, timeSignature: "4/4"}
		)!;
		expect(barDurationMs(meta)).toBeCloseTo(expected);
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

describe("tapping along with the clicks", () => {
	const defaults = {tempo: 100, timeSignature: "4/4"};
	const meta = (frontmatter: Record<string, unknown>) =>
		parseSongMeta({tempo: 100, ...frontmatter}, defaults)!;

	/** What the clicks sound like per minute, for a song at a given tempo. */
	const clicksPerMinute = (m: ReturnType<typeof meta>) =>
		60000 / (barDurationMs(m) / m.pattern.filter(b => b !== "silent").length);

	it("reads back the tempo you tapped along with, whatever the meter is counted in", () => {
		// The reported case: 12/8 counted in eighths, sounding its four pulses. The clicks come at a
		// third of the tempo, so tapping them used to read a third of it back.
		const cases = [
			{tempo: 124, "time-signature": "12/8", "beat-unit": "1/8", emphasis: "X__X__X__X__"},
			{tempo: 124, "time-signature": "12/8", emphasis: "X__x__x__x__"},
			{tempo: 120, "time-signature": "4/4"},
			{tempo: 120, "time-signature": "4/4", "beat-unit": "1/2"},
			{tempo: 90, "time-signature": "6/8"},
			{tempo: 90, "time-signature": "7/8", emphasis: "X_x_x__"}
		];

		for (const frontmatter of cases) {
			const m = meta(frontmatter);
			expect(tempoFromTappedClicks(m, clicksPerMinute(m))).toBe(frontmatter.tempo);
		}
	});

	it("turns the reported case back into the tempo that was tapped", () => {
		// Tapping along at 124 read 42 before; the clicks really do come at 41.3 a minute.
		const m = meta({"time-signature": "12/8", "beat-unit": "1/8", emphasis: "X__X__X__X__"});
		expect(tempoFromTappedClicks(m, 41.3)).toBe(124);
	});

	it("changes nothing when the pattern already sounds once per beat", () => {
		// The common case: every tempo beat is clicked, so the taps are the tempo.
		for (const frontmatter of [{}, {"time-signature": "3/4"}, {"time-signature": "12/8"}]) {
			const m = meta(frontmatter);
			expect(tempoFromTappedClicks(m, 96)).toBe(96);
		}
	});

	it("takes the taps at face value when the pattern sounds nothing", () => {
		const m = meta({"time-signature": "4/4", emphasis: "____"});
		expect(tempoFromTappedClicks(m, 96)).toBe(96);
	});

	it("keeps the result inside the usable tempo range", () => {
		const m = meta({"time-signature": "12/8", "beat-unit": "1/8", emphasis: "X__X__X__X__"});
		expect(tempoFromTappedClicks(m, 400)).toBe(MAX_TEMPO);
		expect(tempoFromTappedClicks(m, 1)).toBe(MIN_TEMPO);
	});
});
