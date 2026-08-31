import {
	barDurationMs,
	beatDurationMs,
	parseEmphasis,
	parseSongMeta,
	parseTimeSignature,
	patternToString,
	SongMetaDefaults,
	timeSignatureToString
} from "../src/metronome/songMeta";

const defaults: SongMetaDefaults = {tempo: 100, timeSignature: "4/4", emphasis: "X"};

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

	it("falls back to the default emphasis when the value is malformed, sized to the meter", () => {
		const meta = parseSongMeta(
			{tempo: 100, "time-signature": "12/8", emphasis: "1,4,7,10"}, defaults
		)!;
		expect(patternToString(meta)).toBe("Xxxxxxxxxxxx");
	});

	it("always produces a pattern exactly one bar long", () => {
		for (const timeSignature of ["4/4", "12/8", "8/4", "7/8", "5/4", "3/4"]) {
			const meta = parseSongMeta({tempo: 100, "time-signature": timeSignature}, defaults)!;
			expect(meta.pattern).toHaveLength(meta.beatsPerBar);
		}
	});
});

describe("beat and bar durations", () => {
	it("counts the time signature denominator, so 12/8 at 180 and 8/4 at 120 both give a 4s bar", () => {
		const twelveEight = parseSongMeta({tempo: 180, "time-signature": "12/8"}, defaults)!;
		const eightFour = parseSongMeta({tempo: 120, "time-signature": "8/4"}, defaults)!;

		expect(beatDurationMs(twelveEight)).toBeCloseTo(1000 / 3);
		expect(barDurationMs(twelveEight)).toBeCloseTo(4000);
		expect(beatDurationMs(eightFour)).toBeCloseTo(500);
		expect(barDurationMs(eightFour)).toBeCloseTo(4000);
	});
});
