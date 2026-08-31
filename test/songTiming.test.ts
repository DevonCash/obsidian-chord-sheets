import {
	buildSongTimeline,
	chordAtBeat,
	countMeasures,
	entryIndexAtBeat,
	LineMarkerSettings,
	slotAtBeat,
	slotAtOffset,
	slotAtRenderedPosition
} from "../src/metronome/songTiming";
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

describe("chord occurrences", () => {
	function chordBeats(line: string, beatsPerBar = 4) {
		const doc = block(line);
		const timeline = buildSongTimeline(doc, "chords", markers, beatsPerBar);
		// Slice the chord symbol back out of the document to check the offsets point at the right text.
		return timeline.chords.map(c => [doc.slice(c.from, c.to), c.startBeat] as const);
	}

	it("splits a measure equally between the chords sharing it", () => {
		expect(chordBeats("| Em Am | C |")).toEqual([["Em", 0], ["Am", 2], ["C", 4]]);
	});

	it("gives each chord a whole measure when the line has no bar lines", () => {
		expect(chordBeats("Em Am C")).toEqual([["Em", 0], ["Am", 4], ["C", 8]]);
	});

	it("divides a measure between four chords", () => {
		expect(chordBeats("| Em Am C G |")).toEqual([["Em", 0], ["Am", 1], ["C", 2], ["G", 3]]);
	});

	it("treats % within a bar as a beat slot holding the previous chord", () => {
		// Em gets three of the four beats, Am the last.
		expect(chordBeats("| Em % % Am |")).toEqual([["Em", 0], ["Am", 3]]);
	});

	it.each([
		["| Em % Am % |", [["Em", 0], ["Am", 2]]],
		["| Em % % % |", [["Em", 0]]],
		["| Em % Am |", [["Em", 0], ["Am", 2 + 2 / 3]]],
		["| Em % % Am | C % % % |", [["Em", 0], ["Am", 3], ["C", 4]]],
	])("divides %p between its slots", (line, expected) => {
		const beats = chordBeats(line);
		expect(beats).toHaveLength(expected.length);
		beats.forEach(([symbol, beat], i) => {
			expect(symbol).toBe(expected[i][0]);
			expect(beat).toBeCloseTo(expected[i][1] as number);
		});
	});

	it("treats a chord before the first bar line as its own measure", () => {
		// "Em | Dm A |" is a bar of Em followed by a bar split between Dm and A.
		expect(chordBeats("Em | Dm A |")).toEqual([["Em", 0], ["Dm", 4], ["A", 6]]);
	});

	it.each([
		"Em | Dm A |",
		"Em | Dm A",
		"| Em | Dm A |",
	])("reads %p the same way whether the outer bar lines are written or not", (line) => {
		expect(chordBeats(line)).toEqual([["Em", 0], ["Dm", 4], ["A", 6]]);
		expect(buildSongTimeline(block(line), "chords", markers, 4).totalBeats).toBe(8);
	});

	it("counts / as a beat slot too", () => {
		expect(chordBeats("| Em / / Am |")).toEqual([["Em", 0], ["Am", 3]]);
	});

	it("scales slot division with the meter", () => {
		// Four slots across a 12/8 bar: three eighths each.
		expect(chordBeats("| Em % % Am |", 12)).toEqual([["Em", 0], ["Am", 9]]);
		// Four slots across an 8/4 bar: two quarters each.
		expect(chordBeats("| Em % % Am |", 8)).toEqual([["Em", 0], ["Am", 6]]);
	});

	it("keeps a slot-divided bar one measure long", () => {
		const timeline = buildSongTimeline(block("| Em % % Am |"), "chords", markers, 4);
		expect(timeline.entries[0].measures).toBe(1);
		expect(timeline.totalBeats).toBe(4);
	});

	it("keeps an N.C. bar occupying its measure", () => {
		expect(chordBeats("| N.C. | Am |")).toEqual([["Am", 4]]);
	});

	it("keeps later chords on the beat when a bar holds only repeat markers", () => {
		// The repeat bars belong to Em, which stays current until Am starts on the fourth bar.
		expect(chordBeats("| Em | % | % | Am |")).toEqual([["Em", 0], ["Am", 12]]);
	});

	it("scales with the meter", () => {
		expect(chordBeats("| Em Am | C |", 8)).toEqual([["Em", 0], ["Am", 4], ["C", 8]]);
		expect(chordBeats("| Em Am | C |", 12)).toEqual([["Em", 0], ["Am", 6], ["C", 12]]);
	});

	it("accumulates across lines and blocks", () => {
		const doc = [block("| Em | Am |", "lyrics here", "| C |"), block("| G |")].join("\n");
		const timeline = buildSongTimeline(doc, "chords", markers, 4);
		expect(timeline.chords.map(c => [doc.slice(c.from, c.to), c.startBeat])).toEqual([
			["Em", 0], ["Am", 4], ["C", 8], ["G", 12]
		]);
	});

	it("records where each chord is rendered, for reading mode", () => {
		const doc = [block("| Em | Am |", "lyrics here", "| C |"), block("| G |")].join("\n");
		const timeline = buildSongTimeline(doc, "chords", markers, 4);
		expect(timeline.chords.map(c => [c.blockIndex, c.lineInBlock, c.chordInLine])).toEqual([
			[0, 0, 0], [0, 0, 1], [0, 2, 0], [1, 0, 0]
		]);
	});

	it("records the fence line of each chord's block, so reading mode can locate it", () => {
		const doc = ["# Heading", "", block("| Em |"), "prose", block("| Am |")].join("\n");
		const timeline = buildSongTimeline(doc, "chords", markers, 4);
		// Fences are on document lines 2 and 6.
		expect(timeline.chords.map(c => c.blockStartLine)).toEqual([2, 6]);
		expect(timeline.entries.map(e => e.blockStartLine)).toEqual([2, 6]);
		expect(doc.split("\n")[2]).toBe("```chords");
		expect(doc.split("\n")[6]).toBe("```chords");
	});

	it.each([
		["|Em|Am|", [["Em", 0], ["Am", 4]]],
		["|Em Am|C|", [["Em", 0], ["Am", 2], ["C", 4]]],
		["Em|Dm A|", [["Em", 0], ["Dm", 4], ["A", 6]]],
		["|Em|%|%|Am|", [["Em", 0], ["Am", 12]]],
	])("reads %p written tight against the bar lines", (line, expected) => {
		expect(chordBeats(line)).toEqual(expected);
	});

	it("keeps slash chords intact, since a slash is not a bar line", () => {
		expect(chordBeats("C/G | D/F#")).toEqual([["C/G", 0], ["D/F#", 4]]);
		expect(chordBeats("|C/G|D/F#|")).toEqual([["C/G", 0], ["D/F#", 4]]);
	});
});

describe("chordAtBeat", () => {
	const timeline = buildSongTimeline(block("| Em Am | C |", "| G |"), "chords", markers, 4);
	const at = (beat: number) => {
		const chord = chordAtBeat(timeline, beat);
		return chord && [chord.startBeat, chord.chordInLine, chord.lineInBlock];
	};

	it("returns nothing before the song starts", () => {
		expect(at(-1)).toBeNull();
	});

	it("holds a chord until the next one starts", () => {
		expect(at(0)).toEqual([0, 0, 0]);
		expect(at(1.9)).toEqual([0, 0, 0]);
		expect(at(2)).toEqual([2, 1, 0]);
		expect(at(3.9)).toEqual([2, 1, 0]);
		expect(at(4)).toEqual([4, 2, 0]);
	});

	it("carries on into the next line", () => {
		expect(at(8)).toEqual([8, 0, 1]);
		expect(at(999)).toEqual([8, 0, 1]);
	});
});

describe("slots", () => {
	// Every slot is somewhere the song can be moved to, including bars holding only repeat markers.
	const doc = block("| Em | % | % | Am |");
	const timeline = buildSongTimeline(doc, "chords", markers, 4);

	it("gives each repeat bar a slot of its own, on its own beat", () => {
		expect(timeline.slots.map(s => [doc.slice(s.from, s.to), s.startBeat])).toEqual([
			["Em", 0], ["%", 4], ["%", 8], ["Am", 12]
		]);
	});

	it("still reports only the chords as chords", () => {
		expect(timeline.chords.map(c => doc.slice(c.from, c.to))).toEqual(["Em", "Am"]);
	});

	it("resolves a click in the editor to the slot under it", () => {
		for (const [text, beat] of [["Em", 0], ["%", 4], ["Am", 12]] as [string, number][]) {
			const offset = doc.indexOf(text, text === "%" ? 0 : undefined);
			expect(slotAtOffset(timeline, offset)?.startBeat).toBe(beat);
		}
		// The second repeat bar, not the first.
		expect(slotAtOffset(timeline, doc.indexOf("%", doc.indexOf("%") + 1))?.startBeat).toBe(8);
	});

	it("returns nothing for a click outside any slot", () => {
		expect(slotAtOffset(timeline, 0)).toBeNull();
	});

	it("resolves a click in reading mode by the element's position in its line", () => {
		// Chords and rhythm markers render one element each, in tokenized order:
		// | Em | % | % | Am |  ->  0:|  1:Em  2:|  3:%  4:|  5:%  6:|  7:Am  8:|
		const at = (tokenIndex: number) =>
			slotAtRenderedPosition(timeline, 0, 0, tokenIndex)?.startBeat;
		expect(at(1)).toBe(0);
		expect(at(3)).toBe(4);
		expect(at(5)).toBe(8);
		expect(at(7)).toBe(12);
	});

	it("has no slot for a bare bar line, which is a divider rather than a beat", () => {
		expect(slotAtRenderedPosition(timeline, 0, 0, 0)).toBeNull();
		expect(slotAtRenderedPosition(timeline, 0, 0, 2)).toBeNull();
	});

	it("splits markers written together into a slot each", () => {
		const tight = block("| Em %% Am |");
		const tl = buildSongTimeline(tight, "chords", markers, 4);
		// Four slots across the bar: Em, two repeats, Am.
		expect(tl.slots.map(s => [tight.slice(s.from, s.to), s.startBeat])).toEqual([
			["Em", 0], ["%", 1], ["%", 2], ["Am", 3]
		]);
	});

	it("keeps a slash slot seekable too", () => {
		const strummed = block("| Em / / / |");
		const tl = buildSongTimeline(strummed, "chords", markers, 4);
		expect(tl.slots.map(s => s.startBeat)).toEqual([0, 1, 2, 3]);
	});

	it("has no slots for a line whose markers carry no measure", () => {
		// Without bar lines a line is measured by its chords, so markers weigh nothing.
		const tl = buildSongTimeline(block("Em Am"), "chords", markers, 4);
		expect(tl.slots.map(s => s.startBeat)).toEqual([0, 4]);
	});
});

describe("slotAtBeat", () => {
	const doc = block("| Em | % | % | Am |");
	const timeline = buildSongTimeline(doc, "chords", markers, 4);
	const at = (beat: number) => {
		const slot = slotAtBeat(timeline, beat);
		return slot && doc.slice(slot.from, slot.to);
	};

	it("returns nothing before the song starts", () => {
		expect(at(-1)).toBeNull();
	});

	it("advances onto the repeat bars rather than staying on the chord they hold", () => {
		// This is what makes the highlight track where the song is, not what it is on.
		expect(at(0)).toBe("Em");
		expect(at(3.9)).toBe("Em");
		expect(at(4)).toBe("%");
		expect(at(8)).toBe("%");
		expect(at(12)).toBe("Am");
	});

	it("distinguishes the two repeat bars", () => {
		expect(slotAtBeat(timeline, 4)!.startBeat).toBe(4);
		expect(slotAtBeat(timeline, 8)!.startBeat).toBe(8);
	});

	it("moves through slots within a bar", () => {
		const bar = block("| Em % % Am |");
		const tl = buildSongTimeline(bar, "chords", markers, 4);
		const slice = (beat: number) => {
			const slot = slotAtBeat(tl, beat);
			return slot && [bar.slice(slot.from, slot.to), slot.startBeat];
		};
		expect(slice(0)).toEqual(["Em", 0]);
		expect(slice(1)).toEqual(["%", 1]);
		expect(slice(2)).toEqual(["%", 2]);
		expect(slice(3)).toEqual(["Am", 3]);
	});

	it("still leaves the chord lookup reporting the chord being held", () => {
		// chordAtBeat and slotAtBeat answer different questions, and both are needed.
		expect(chordAtBeat(timeline, 8)).not.toBeNull();
		expect(doc.slice(chordAtBeat(timeline, 8)!.from, chordAtBeat(timeline, 8)!.to)).toBe("Em");
		expect(at(8)).toBe("%");
	});
});
