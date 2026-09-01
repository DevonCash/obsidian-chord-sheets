import {MarkdownView} from "obsidian";
import {ConstantSpeedPacer, TempoScrollPacer} from "../src/scrollPacer";
import {Transport} from "../src/metronome/transport";
import {buildSongTimeline} from "../src/metronome/songTiming";
import {parseSongMeta} from "../src/metronome/songMeta";
import {DEFAULT_CHORD_LINE_MARKER, DEFAULT_TEXT_LINE_MARKER} from "../src/chordSheetsSettings";

const markers = {
	chordLineMarker: DEFAULT_CHORD_LINE_MARKER,
	textLineMarker: DEFAULT_TEXT_LINE_MARKER
};
const defaults = {tempo: 100, timeSignature: "4/4"};

/** A scroll container of a fixed height that reports whatever scrollTop it was last given. */
function fakeScrollElem(clientHeight = 600, scrollHeight = 100000): HTMLElement {
	return {clientHeight, scrollHeight, scrollTop: 0} as HTMLElement;
}

/**
 * A stand-in for the MarkdownView whose lines are 100px tall, which is what the pacer would read out of
 * CodeMirror's line geometry. CodeMirror numbers lines from 1, so the first line of the document sits at
 * the top of the content.
 */
function fakeView(): MarkdownView {
	return {
		getMode: () => "source",
		editor: {
			cm: {
				state: {doc: {lines: 1000, line: (lineNumber: number) => ({from: lineNumber})}},
				lineBlockAt: (lineNumber: number) => ({top: (lineNumber - 1) * 100})
			}
		}
	} as unknown as MarkdownView;
}

/** A transport parked at a fixed beat, so the pacer can be sampled deterministically. */
function transportAtBeat(beat: number, beatsPerBar: number): Transport {
	const meta = parseSongMeta({tempo: 120, "time-signature": `${beatsPerBar}/4`}, defaults)!;
	const transport = new Transport(meta);
	jest.spyOn(transport, "currentBeat").mockReturnValue(beat);
	return transport;
}

describe("TempoScrollPacer", () => {
	// Two chord lines of one measure each, on document lines 1 and 2, i.e. 100px apart in the fake view.
	const doc = "```chords\n| Em |\n| Am |\n```";
	const anchorFraction = 0.3;

	function pacerAt(beat: number, beatsPerBar: number) {
		const timeline = buildSongTimeline(doc, "chords", markers, beatsPerBar);
		const transport = transportAtBeat(beat, beatsPerBar);
		return new TempoScrollPacer(fakeView(), transport, timeline, anchorFraction, "continuous");
	}

	// The fake view puts line 1 at 100px and line 2 at 200px; the anchor is 0.3 * 600 = 180px.
	it.each([
		["at the first beat, the first chord line sits at the anchor", 0, 100 - 180],
		["a quarter of the way through the bar", 1, 125 - 180],
		["halfway through the bar", 2, 150 - 180],
		["at the downbeat of the second bar, the second line sits at the anchor", 4, 200 - 180],
	])("%s", (_name, beat, expected) => {
		const pacer = pacerAt(beat, 4);
		expect(pacer.desiredScrollTop(fakeScrollElem(), 16)).toBeCloseTo(expected);
	});

	it("holds still before the song reaches the first chord line", () => {
		const pacer = pacerAt(-2, 4);
		expect(pacer.desiredScrollTop(fakeScrollElem(), 16)).toBeCloseTo(100 - 180);
	});

	it("keeps going past the last chord line at the rate of the final line", () => {
		// Beat 6 is halfway through the second (last) measure.
		const pacer = pacerAt(6, 4);
		expect(pacer.desiredScrollTop(fakeScrollElem(), 16)).toBeCloseTo(250 - 180);
	});

	describe("odd time signatures", () => {
		// The same notation must take twice as long per line in 8/4 as in 4/4, so at a given beat the
		// scroll has travelled half as far.
		it("is halfway down the first line at beat 2 in 4/4 but only a quarter in 8/4", () => {
			expect(pacerAt(2, 4).desiredScrollTop(fakeScrollElem(), 16)).toBeCloseTo(150 - 180);
			expect(pacerAt(2, 8).desiredScrollTop(fakeScrollElem(), 16)).toBeCloseTo(125 - 180);
		});

		it("reaches the second line on that meter's downbeat, whatever the meter", () => {
			for (const beatsPerBar of [3, 4, 5, 7, 8, 12]) {
				expect(pacerAt(beatsPerBar, beatsPerBar).desiredScrollTop(fakeScrollElem(), 16))
					.toBeCloseTo(200 - 180);
			}
		});
	});

	it("declines to scroll when the note has no chord lines to pace against", () => {
		const timeline = buildSongTimeline("no chord blocks here", "chords", markers, 4);
		const pacer = new TempoScrollPacer(fakeView(), transportAtBeat(0, 4), timeline, anchorFraction, "continuous");
		expect(pacer.desiredScrollTop(fakeScrollElem(), 16)).toBeNull();
	});
});

describe("TempoScrollPacer in chord mode", () => {
	// Two chords per line, so the target must move only when the song crosses to the next line.
	const doc = "```chords\n| Em | Am |\n| C | G |\n```";
	const anchorFraction = 0.5;
	// A 200px viewport centres on 100px. The fake view puts document line n at n * 100, and the chord
	// lines here are document lines 1 and 2 (line 0 is the opening fence).
	const viewportHeight = 200;
	const centredOnDocLine = (docLine: number) => docLine * 100 - viewportHeight * anchorFraction;
	const scrollElem = () => fakeScrollElem(viewportHeight);

	function pacerAt(beat: number) {
		const timeline = buildSongTimeline(doc, "chords", markers, 4);
		return new TempoScrollPacer(fakeView(), transportAtBeat(beat, 4), timeline, anchorFraction, "chord");
	}

	/** Runs enough frames for the easing to settle, and returns where it lands. */
	function settle(pacer: TempoScrollPacer, elem = scrollElem()): number {
		let position = 0;
		for (let i = 0; i < 200; i++) {
			position = pacer.desiredScrollTop(elem, 16)!;
		}
		return position;
	}

	it("centres the line of the chord being played", () => {
		expect(settle(pacerAt(0))).toBeCloseTo(centredOnDocLine(1));
	});

	it("holds still while a chord sounds, rather than drifting through it", () => {
		// Beats 0 and 3 are both on the first line, on Em and Am respectively.
		expect(settle(pacerAt(0))).toBeCloseTo(settle(pacerAt(3)));
	});

	it("moves on when the song reaches a chord on the next line", () => {
		expect(settle(pacerAt(8))).toBeCloseTo(centredOnDocLine(2));
		expect(settle(pacerAt(8))).toBeGreaterThan(settle(pacerAt(0)));
	});

	it("waits at the first chord before the song starts", () => {
		expect(settle(pacerAt(-4))).toBeCloseTo(centredOnDocLine(1));
	});

	it("glides towards the target rather than jumping to it", () => {
		const pacer = pacerAt(8);
		const elem = scrollElem();
		const target = centredOnDocLine(2);

		const firstFrame = pacer.desiredScrollTop(elem, 16)!;
		// One frame covers only part of the distance, in the right direction.
		expect(firstFrame).toBeGreaterThan(0);
		expect(firstFrame).toBeLessThan(target);
		expect(settle(pacer, elem)).toBeCloseTo(target);
	});

	it("covers the same distance regardless of frame rate", () => {
		// One 32ms frame must land where two 16ms frames do, or the glide would run at different speeds
		// on different displays.
		const sixty = pacerAt(8);
		const thirty = pacerAt(8);

		sixty.desiredScrollTop(scrollElem(), 16);
		const twoFrames = sixty.desiredScrollTop(scrollElem(), 16)!;
		const oneFrame = thirty.desiredScrollTop(scrollElem(), 32)!;
		expect(oneFrame).toBeCloseTo(twoFrames);
	});
});

describe("ConstantSpeedPacer", () => {
	it("advances by a fractional pixel amount proportional to the elapsed time", () => {
		const pacer = new ConstantSpeedPacer(10);
		const perMs = ConstantSpeedPacer.pixelsPerMs(10);
		const scrollElem = fakeScrollElem();

		expect(pacer.desiredScrollTop(scrollElem, 16)).toBeCloseTo(perMs * 16);
		expect(pacer.desiredScrollTop(scrollElem, 16)).toBeCloseTo(perMs * 32);
	});

	it("scrolls faster at a higher speed setting", () => {
		expect(ConstantSpeedPacer.pixelsPerMs(20)).toBeGreaterThan(ConstantSpeedPacer.pixelsPerMs(1));
	});

	it("stops accumulating at the end of the document", () => {
		const pacer = new ConstantSpeedPacer(20);
		const scrollElem = fakeScrollElem(600, 700);
		for (let i = 0; i < 1000; i++) {
			pacer.desiredScrollTop(scrollElem, 16);
		}
		expect(pacer.desiredScrollTop(scrollElem, 16)).toBe(100);
	});
});
