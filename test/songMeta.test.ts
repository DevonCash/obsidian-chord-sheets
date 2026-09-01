import {
	barDurationMs,
	beatDurationMs,
	beatsPerMeasure,
	defaultEmphasis,
	parseTempoUnit,
	tempoUnitNotation,
	TEMPO_UNITS,
	parseEmphasis,
	parseSongMeta,
	parseTimeSignature,
	patternToString,
	SongMetaDefaults,
	timeSignatureToString
} from "../src/metronome/songMeta";

const defaults: SongMetaDefaults = {tempo: 100, timeSignature: "4/4"};

describe("parseTimeSignature", () => {
	it.each([
		["4/4", 4, 4],
		["12/8", 12, 8],
		["8/4", 8, 4],
		["7/8", 7, 8],
		["5/4", 5, 4],
		["3/4", 3, 4],
		["6/8", 6, 8],
		["2/2", 2, 2],
		["11/16", 11, 16],
	])("parses %s without any whitelist of signatures", (input, beatsPerBar, beatUnit) => {
		expect(parseTimeSignature(input)).toEqual({beatsPerBar, beatUnit});
	});

	it("tolerates surrounding and inner whitespace", () => {
		expect(parseTimeSignature(" 12 / 8 ")).toEqual({beatsPerBar: 12, beatUnit: 8});
	});

	it.each(["4/", "/4", "x/y", "0/4", "4/0", "44", "", "4/4/4"])(
		"rejects malformed signature %p", (input) => {
			expect(parseTimeSignature(input)).toBeNull();
		});

	it("rejects an absurd numerator", () => {
		expect(parseTimeSignature("128/4")).toBeNull();
	});

	it("returns null for missing values", () => {
		expect(parseTimeSignature(undefined)).toBeNull();
		expect(parseTimeSignature(null)).toBeNull();
	});
});

describe("parseEmphasis", () => {
	it("keeps a full-length 12/8 pattern verbatim", () => {
		const pattern = parseEmphasis("X__x__x__x__", 12);
		expect(pattern).toHaveLength(12);
		expect(patternToString({pattern: pattern!})).toBe("X__x__x__x__");
	});

	it("keeps a full-length 8/4 pattern verbatim", () => {
		expect(patternToString({pattern: parseEmphasis("X___x___", 8)!})).toBe("X___x___");
	});

	it("keeps a 7/8 2+2+3 pattern verbatim", () => {
		expect(patternToString({pattern: parseEmphasis("X_x_x__", 7)!})).toBe("X_x_x__");
	});

	it("pads a short pattern with normal beats rather than cycling it", () => {
		expect(patternToString({pattern: parseEmphasis("X", 4)!})).toBe("Xxxx");
		expect(patternToString({pattern: parseEmphasis("X", 12)!})).toBe("Xxxxxxxxxxxx");
		expect(patternToString({pattern: parseEmphasis("X_", 4)!})).toBe("X_xx");
	});

	it("truncates an over-long pattern", () => {
		expect(patternToString({pattern: parseEmphasis("X_x_X_x_", 4)!})).toBe("X_x_");
	});

	it("accepts . as an alias for _", () => {
		expect(patternToString({pattern: parseEmphasis("X..x..x..x..", 12)!})).toBe("X__x__x__x__");
	});

	it.each(["Xo x", "X-x", "1,3", "X x", ""])("rejects illegal pattern %p", (input) => {
		expect(parseEmphasis(input, 4)).toBeNull();
	});
});

describe("parseSongMeta", () => {
	it("returns null when no tempo is set, so the caller falls back to speed-based scrolling", () => {
		expect(parseSongMeta(undefined, defaults)).toBeNull();
		expect(parseSongMeta({}, defaults)).toBeNull();
		expect(parseSongMeta({"time-signature": "4/4"}, defaults)).toBeNull();
		expect(parseSongMeta({tempo: "not a number"}, defaults)).toBeNull();
	});

	it("reads tempo given as a string", () => {
		expect(parseSongMeta({tempo: "96"}, defaults)?.bpm).toBe(96);
	});

	it("clamps out-of-range tempos", () => {
		expect(parseSongMeta({tempo: 5}, defaults)?.bpm).toBe(20);
		expect(parseSongMeta({tempo: 9000}, defaults)?.bpm).toBe(400);
	});

	it("parses a full 12/8 song", () => {
		const meta = parseSongMeta(
			{tempo: 180, "time-signature": "12/8", emphasis: "X__x__x__x__"}, defaults
		)!;
		expect(meta.bpm).toBe(180);
		expect(meta.beatsPerBar).toBe(12);
		expect(meta.beatUnit).toBe(8);
		expect(timeSignatureToString(meta)).toBe("12/8");
		expect(patternToString(meta)).toBe("X__x__x__x__");
	});

	it("parses a full 8/4 song", () => {
		const meta = parseSongMeta(
			{tempo: 120, "time-signature": "8/4", emphasis: "X___x___"}, defaults
		)!;
		expect(meta.beatsPerBar).toBe(8);
		expect(patternToString(meta)).toBe("X___x___");
	});

	it("falls back to the default signature when the value is malformed", () => {
		const meta = parseSongMeta({tempo: 100, "time-signature": "nonsense"}, defaults)!;
		expect(timeSignatureToString(meta)).toBe("4/4");
	});

	it("falls back to how the meter is conventionally counted when the value is malformed", () => {
		const meta = parseSongMeta(
			{tempo: 100, "time-signature": "12/8", emphasis: "1,4,7,10"}, defaults
		)!;
		expect(patternToString(meta)).toBe("X__x__x__x__");
	});

	it("always produces a pattern exactly one bar long", () => {
		for (const timeSignature of ["4/4", "12/8", "8/4", "7/8", "5/4", "3/4"]) {
			const meta = parseSongMeta({tempo: 100, "time-signature": timeSignature}, defaults)!;
			expect(meta.pattern).toHaveLength(meta.beatsPerBar);
		}
	});
});

describe("beat and bar durations", () => {
	it("gives a 4s bar for 12/8 at 60 and 8/4 at 120, each counted its own way", () => {
		// 12/8 counts dotted quarters, four to the bar; 8/4 counts quarters, eight to the bar.
		const twelveEight = parseSongMeta({tempo: 60, "time-signature": "12/8"}, defaults)!;
		const eightFour = parseSongMeta({tempo: 120, "time-signature": "8/4"}, defaults)!;

		expect(beatDurationMs(twelveEight)).toBeCloseTo(1000 / 3);
		expect(barDurationMs(twelveEight)).toBeCloseTo(4000);
		expect(beatDurationMs(eightFour)).toBeCloseTo(500);
		expect(barDurationMs(eightFour)).toBeCloseTo(4000);
	});
});

describe("the note value the tempo counts", () => {
	it("is a simple meter's own note value when the property is absent", () => {
		expect(parseSongMeta({tempo: 120, "time-signature": "4/4"}, defaults)!.tempoUnit).toBe(1 / 4);
		expect(parseSongMeta({tempo: 100, "time-signature": "2/2"}, defaults)!.tempoUnit).toBe(1 / 2);
		expect(parseSongMeta({tempo: 100, "time-signature": "3/8"}, defaults)!.tempoUnit).toBe(1 / 8);
	});

	it("is the dotted note for a compound meter, which is how its tempo is written", () => {
		// 12/8 is counted in dotted quarters, matching the four pulses its default emphasis clicks.
		expect(parseSongMeta({tempo: 60, "time-signature": "12/8"}, defaults)!.tempoUnit).toBe(3 / 8);
		expect(parseSongMeta({tempo: 80, "time-signature": "6/8"}, defaults)!.tempoUnit).toBe(3 / 8);
		expect(parseSongMeta({tempo: 80, "time-signature": "9/8"}, defaults)!.tempoUnit).toBe(3 / 8);
		expect(parseSongMeta({tempo: 80, "time-signature": "6/16"}, defaults)!.tempoUnit).toBe(3 / 16);
	});

	it("counts one tempo beat per pulse its emphasis clicks", () => {
		// The two defaults have to agree about what a beat is, or the click would not land on the count.
		for (const signature of ["4/4", "3/4", "6/8", "9/8", "12/8", "2/2", "6/16"]) {
			const meta = parseSongMeta({tempo: 100, "time-signature": signature}, defaults)!;
			const audible = meta.pattern.filter(beat => beat !== "silent").length;
			const tempoBeatsPerBar = barDurationMs(meta) / (60000 / meta.bpm);
			expect(tempoBeatsPerBar).toBeCloseTo(audible);
		}
	});

	it.each([
		["1/4", 0.25],
		["3/8", 0.375],
		["1/8", 0.125],
		["1/2", 0.5],
		["3/16", 0.1875],
	])("reads %p as a note value", (notation, value) => {
		expect(parseTempoUnit(notation)).toBe(value);
	});

	it.each(["", "2/5", "quarter", "1/3", "5/8"])("rejects %p", (notation) => {
		expect(parseTempoUnit(notation)).toBeNull();
	});

	it("round-trips every unit it offers", () => {
		for (const unit of TEMPO_UNITS) {
			expect(parseTempoUnit(unit.notation)).toBe(unit.value);
			expect(tempoUnitNotation({tempoUnit: unit.value})).toBe(unit.notation);
		}
	});

	it("lets a compound meter be given its conventional tempo", () => {
		// The same music, written the two ways: a dotted quarter of 60 is three eighths of 180.
		const conventional = parseSongMeta({tempo: 60, "time-signature": "12/8"}, defaults)!;
		const literal = parseSongMeta(
			{tempo: 180, "time-signature": "12/8", "beat-unit": "1/8"}, defaults
		)!;

		expect(beatDurationMs(conventional)).toBeCloseTo(beatDurationMs(literal));
		expect(barDurationMs(conventional)).toBeCloseTo(4000);
		expect(barDurationMs(literal)).toBeCloseTo(4000);
	});

	it("counts a half note in cut time", () => {
		// 2/2 at a half note of 100: two half notes a bar, so a bar is 1.2s.
		const cutTime = parseSongMeta({tempo: 100, "time-signature": "2/2", "beat-unit": "1/2"}, defaults)!;
		expect(beatDurationMs(cutTime)).toBeCloseTo(600);
		expect(barDurationMs(cutTime)).toBeCloseTo(1200);
	});

	it("leaves a quarter-note tempo in 4/4 exactly as it was", () => {
		const before = parseSongMeta({tempo: 96, "time-signature": "4/4"}, defaults)!;
		const after = parseSongMeta({tempo: 96, "time-signature": "4/4", "beat-unit": "1/4"}, defaults)!;
		expect(beatDurationMs(after)).toBeCloseTo(beatDurationMs(before));
		expect(beatDurationMs(after)).toBeCloseTo(625);
	});

	it("falls back to how the meter is counted when the property is malformed", () => {
		expect(parseSongMeta({tempo: 120, "time-signature": "4/4", "beat-unit": "nonsense"}, defaults)!
			.tempoUnit).toBe(1 / 4);
		expect(parseSongMeta({tempo: 60, "time-signature": "12/8", "beat-unit": "nonsense"}, defaults)!
			.tempoUnit).toBe(3 / 8);
	});
});

describe("how a meter is counted when the note does not say", () => {
	const emphasisFor = (signature: string) => {
		const [beatsPerBar, beatUnit] = signature.split("/").map(Number);
		return patternToString({pattern: defaultEmphasis(beatsPerBar, beatUnit)});
	};

	describe("simple meters click every beat, accenting the first", () => {
		it.each([
			["2/4", "Xx"],
			["3/4", "Xxx"],
			["4/4", "Xxxx"],
			["2/2", "Xx"],
			["3/2", "Xxx"],
			["3/8", "Xxx"],
		])("counts %s as %s", (signature, expected) => {
			expect(emphasisFor(signature)).toBe(expected);
		});
	});

	describe("compound meters click their pulses, not every subdivision", () => {
		it.each([
			["6/8", "X__x__"],
			["9/8", "X__x__x__"],
			["12/8", "X__x__x__x__"],
		])("counts %s as %s", (signature, expected) => {
			expect(emphasisFor(signature)).toBe(expected);
		});

		it("derives the same shape for a meter not in the table", () => {
			// 12/16 is not listed, but is compound and so groups in threes like 12/8 does.
			expect(emphasisFor("12/16")).toBe("X__x__x__x__");
			expect(emphasisFor("6/16")).toBe("X__x__");
		});

		it("sounds one click per group of three", () => {
			for (const signature of ["6/8", "9/8", "12/8", "6/16"]) {
				const [beatsPerBar] = signature.split("/").map(Number);
				const audible = emphasisFor(signature).split("").filter(c => c !== "_").length;
				expect(audible).toBe(beatsPerBar / 3);
			}
		});
	});

	describe("irregular meters follow their usual grouping", () => {
		it.each([
			["5/4", "X__x_"],
			["5/8", "X__x_"],
			["7/8", "X_x_x__"],
		])("counts %s as %s", (signature, expected) => {
			expect(emphasisFor(signature)).toBe(expected);
		});

		it("falls back to clicking every beat for a meter with no usual grouping", () => {
			// 7/4 is not listed and is not compound, so nothing is assumed about how it is grouped.
			expect(emphasisFor("7/4")).toBe("Xxxxxxx");
			expect(emphasisFor("11/4")).toBe("Xxxxxxxxxxx");
		});
	});

	it("always accents the downbeat and fits the bar exactly", () => {
		for (const beatsPerBar of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 16]) {
			for (const beatUnit of [2, 4, 8, 16]) {
				const pattern = defaultEmphasis(beatsPerBar, beatUnit);
				expect(pattern).toHaveLength(beatsPerBar);
				expect(pattern[0]).toBe("accent");
			}
		}
	});
});

describe("measures per symbol", () => {
	it("is one when the note does not say", () => {
		expect(parseSongMeta({tempo: 120}, defaults)!.measuresPerSymbol).toBe(1);
	});

	it("reads the property", () => {
		expect(parseSongMeta({tempo: 120, "measures-per-symbol": 4}, defaults)!.measuresPerSymbol).toBe(4);
		expect(parseSongMeta({tempo: 120, "measures-per-symbol": "2"}, defaults)!.measuresPerSymbol).toBe(2);
	});

	it.each([0, -3, "nonsense", ""])("falls back to one for %p", (value) => {
		expect(parseSongMeta({tempo: 120, "measures-per-symbol": value}, defaults)!.measuresPerSymbol)
			.toBe(1);
	});

	it("clamps an absurd value", () => {
		expect(parseSongMeta({tempo: 120, "measures-per-symbol": 999}, defaults)!.measuresPerSymbol)
			.toBe(16);
	});

	it("stretches a notated measure by that many bars", () => {
		const once = parseSongMeta({tempo: 120, "time-signature": "4/4"}, defaults)!;
		const fourfold = parseSongMeta(
			{tempo: 120, "time-signature": "4/4", "measures-per-symbol": 4}, defaults
		)!;

		expect(beatsPerMeasure(once)).toBe(4);
		expect(beatsPerMeasure(fourfold)).toBe(16);
		// The beat itself is untouched — only how long a written measure lasts.
		expect(beatDurationMs(fourfold)).toBeCloseTo(beatDurationMs(once));
	});

	it("leaves the emphasis pattern a single bar long", () => {
		// The pattern is the bar the metronome clicks, not the span a symbol covers.
		const meta = parseSongMeta(
			{tempo: 120, "time-signature": "4/4", "measures-per-symbol": 4}, defaults
		)!;
		expect(meta.pattern).toHaveLength(4);
	});
});
