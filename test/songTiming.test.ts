import {buildSongTimeline, countMeasures, entryIndexAtBeat, LineMarkerSettings} from "../src/metronome/songTiming";
import {tokenizeLine} from "../src/sheet-parsing/tokenizeLine";
import {DEFAULT_CHORD_LINE_MARKER, DEFAULT_TEXT_LINE_MARKER} from "../src/chordSheetsSettings";

const markers: LineMarkerSettings = {
	chordLineMarker: DEFAULT_CHORD_LINE_MARKER,
	textLineMarker: DEFAULT_TEXT_LINE_MARKER
};

function measuresOf(line: string): number {
	const tokenized = tokenizeLine(line, 0, markers.chordLineMarker, markers.textLineMarker);
	return tokenized.isChordLine ? countMeasures(tokenized) : 0;
}

function block(...lines: string[]): string {
	return ["```chords", ...lines, "```"].join("\n");
}

describe("countMeasures", () => {
	describe("lines with bar lines", () => {
		it.each([
			["| Em Am | C |", 2],
			["| Em  Am | C      G |", 2],
			["|Em|Am|", 2],
			["| Em | Am | C | G |", 4],
			["| Em |", 1],
			["Em | Am", 2],
			["| Em Am | C", 2],
			["| Em |    | Am |", 2],
		])("counts %p as %i measures", (line, expected) => {
			expect(measuresOf(line)).toBe(expected);
		});

		it("counts a bar holding only a repeat marker", () => {
			expect(measuresOf("| Em | % | % | Am |")).toBe(4);
		});

		it("counts a bar holding only N.C.", () => {
			expect(measuresOf("| N.C. | Am |")).toBe(2);
		});
	});

	describe("lines without bar lines", () => {
		it.each([
			["Em Am C", 3],
			["Em", 1],
			["Am  C   G   D", 4],
		])("counts one measure per chord in %p", (line, expected) => {
			expect(measuresOf(line)).toBe(expected);
		});
	});

	describe("lines that are not chord lines", () => {
		it.each([
			"Some lyrics under the chords",
			"[Verse 1]",
			"",
			"   ",
		])("gives %p no measures", (line) => {
			expect(measuresOf(line)).toBe(0);
		});
	});
});

describe("buildSongTimeline", () => {
	it("only includes chord lines, tracking their document line numbers", () => {
		const doc = [
			"# A song",
			"",
			block(
				"[Verse 1]",
				"| Em Am | C G |",
				"Some lyrics under the chords",
				"| Em Am | C G |",
				"more lyrics"
			)
		].join("\n");

		const {entries} = buildSongTimeline(doc, "chords", markers, 4);

		expect(entries).toHaveLength(2);
		expect(entries.map(e => e.docLine)).toEqual([4, 6]);
		expect(entries.map(e => e.lineInBlock)).toEqual([1, 3]);
		expect(entries.map(e => e.measures)).toEqual([2, 2]);
		expect(entries.map(e => e.startBeat)).toEqual([0, 8]);
	});

	it("accumulates beats across multiple chord blocks", () => {
		const doc = [
			block("| Em | Am |"),
			"Some prose between the blocks",
			block("| C | G |")
		].join("\n");

		const {entries, totalBeats} = buildSongTimeline(doc, "chords", markers, 4);

		expect(entries.map(e => e.blockIndex)).toEqual([0, 1]);
		expect(entries.map(e => e.lineInBlock)).toEqual([0, 0]);
		expect(entries.map(e => e.startBeat)).toEqual([0, 8]);
		expect(totalBeats).toBe(16);
	});

	it("recognises fences with an instrument suffix and tilde fences", () => {
		const guitar = buildSongTimeline("```chords-ukulele\n| Em | Am |\n```", "chords", markers, 4);
		expect(guitar.entries).toHaveLength(1);

		const tildes = buildSongTimeline("~~~chords\n| Em | Am |\n~~~", "chords", markers, 4);
		expect(tildes.entries).toHaveLength(1);
	});

	it("ignores code blocks in other languages", () => {
		const doc = "```js\nconst Em = 1;\n```";
		expect(buildSongTimeline(doc, "chords", markers, 4).entries).toHaveLength(0);
	});

	it("honours a custom language specifier", () => {
		const doc = "```chordsheet\n| Em | Am |\n```";
		expect(buildSongTimeline(doc, "chordsheet", markers, 4).entries).toHaveLength(1);
		expect(buildSongTimeline(doc, "chords", markers, 4).entries).toHaveLength(0);
	});

	describe("odd time signatures", () => {
		// The same notation must stretch with the meter: notating in 8/4 is how you get two 4/4 bars'
		// worth of time per chord, so the timeline must be driven by beatsPerBar and never a hardcoded 4.
		const doc = block("| Em | Am |", "| C | G |");

		it.each([
			[4, [0, 8], 16],
			[8, [0, 16], 32],
			[12, [0, 24], 48],
			[7, [0, 14], 28],
			[5, [0, 10], 20],
			[3, [0, 6], 12],
		])("with %i beats per bar the lines start at %p", (beatsPerBar, startBeats, totalBeats) => {
			const timeline = buildSongTimeline(doc, "chords", markers, beatsPerBar);
			expect(timeline.entries.map(e => e.startBeat)).toEqual(startBeats);
			expect(timeline.totalBeats).toBe(totalBeats);
			expect(timeline.beatsPerBar).toBe(beatsPerBar);
		});
	});
});

describe("entryIndexAtBeat", () => {
	const timeline = buildSongTimeline(
		block("| Em | Am |", "| C | G |", "| D | A |"), "chords", markers, 4
	);

	it.each([
		[-1, -1],
		[0, 0],
		[7.9, 0],
		[8, 1],
		[16, 2],
		[999, 2],
	])("resolves beat %p to entry %i", (beat, expected) => {
		expect(entryIndexAtBeat(timeline, beat)).toBe(expected);
	});
});
