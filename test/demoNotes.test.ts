/*
 * The demo vault notes (demo/notes, published by `npm run demo`) state concrete timings in their prose —
 * "each bar lasts 2.5 seconds", "Em takes three pulses". These tests hold the notes to those claims, so
 * the demo cannot drift away from what the plugin actually does.
 */

import * as fs from "fs";
import * as path from "path";
import {buildSongTimeline, chordAtBeat, SongTimeline} from "../src/metronome/songTiming";
import {
	barDurationMs,
	beatDurationMs,
	parseSongMeta,
	patternToString,
	SongMeta,
	tempoUnitNotation
} from "../src/metronome/songMeta";
import {tokenizeLine} from "../src/sheet-parsing/tokenizeLine";

const NOTES_DIR = path.join(__dirname, "..", "demo", "notes");
const markers = {chordLineMarker: "%c", textLineMarker: "%t"};
const defaults = {tempo: 100, timeSignature: "4/4", emphasis: "X"};

function loadNote(name: string): {text: string, meta: SongMeta | null, timeline: SongTimeline | null} {
	const text = fs.readFileSync(path.join(NOTES_DIR, name), "utf8");

	const frontmatter: Record<string, string> = {};
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	(match ? match[1].split("\n") : []).forEach((line: string) => {
		const keyValue = line.match(/^([\w-]+):\s*(.*)$/);
		if (keyValue) {
			frontmatter[keyValue[1]] = keyValue[2];
		}
	});

	const meta = parseSongMeta(frontmatter, defaults);
	return {text, meta, timeline: meta && buildSongTimeline(text, "chords", markers, meta.beatsPerBar)};
}

/** Every chord in the note, as [symbol, seconds from the start of the song]. */
function chordSeconds(name: string): [string, number][] {
	const {text, meta, timeline} = loadNote(name);
	return timeline!.chords.map(c => [text.slice(c.from, c.to), c.startBeat * beatDurationMs(meta!) / 1000]);
}

describe("demo vault notes", () => {
	it("01 is 4/4 at 96, so a bar lasts 2.5 seconds", () => {
		const {meta} = loadNote("01 - 4-4 basics.md");
		expect(patternToString(meta!)).toBe("X_x_");
		expect(barDurationMs(meta!)).toBeCloseTo(2500);
	});

	it("02 is 12/8 at a dotted quarter of 60, so a bar lasts 4 seconds and sounds four times", () => {
		const {meta} = loadNote("02 - 12-8 compound.md");
		expect(meta!.bpm).toBe(60);
		expect(tempoUnitNotation(meta!)).toBe("3/8");
		expect(barDurationMs(meta!)).toBeCloseTo(4000);
		expect(meta!.pattern.filter(beat => beat !== "silent")).toHaveLength(4);
		expect(meta!.pattern.filter(beat => beat === "accent")).toHaveLength(1);
	});

	it("02 written conventionally runs at the same speed as counting eighths would", () => {
		// A dotted quarter of 60 is three eighths of 180; the demo says so, so it had better be true.
		const {meta} = loadNote("02 - 12-8 compound.md");
		const countingEighths = parseSongMeta({tempo: 180, "time-signature": "12/8"}, defaults)!;
		expect(beatDurationMs(meta!)).toBeCloseTo(beatDurationMs(countingEighths));
	});

	it("02 gives Em three pulses of its bar and Am the last", () => {
		// `| Em % % Am |` — the bar is 4s, so its four slots are a second each.
		const chords = chordSeconds("02 - 12-8 compound.md");
		const [emSymbol, emAt] = chords[4];
		const [amSymbol, amAt] = chords[5];
		expect([emSymbol, amSymbol]).toEqual(["Em", "Am"]);
		expect(amAt - emAt).toBeCloseTo(3);
	});

	it("03 and its 4/4 twin change chord at the same moments and run the same length", () => {
		const eightFour = chordSeconds("03 - 8-4 two bars per chord.md");
		const fourFour = chordSeconds("03b - 4-4 twin.md");

		expect(eightFour).toEqual([["Em", 0], ["Am", 4], ["C", 8], ["G", 12]]);
		// The twin writes each chord twice, so it repeats a chord midway through each of those spans.
		expect(fourFour.filter((_, i) => i % 2 === 0)).toEqual(eightFour);

		const total = (name: string) => {
			const {meta, timeline} = loadNote(name);
			return timeline!.totalBeats * beatDurationMs(meta!);
		};
		expect(total("03 - 8-4 two bars per chord.md"))
			.toBeCloseTo(total("03b - 4-4 twin.md"));
	});

	it("03 accents every other downbeat where its 4/4 twin accents every one", () => {
		// This is the difference the wider meter buys, and the notes now say so.
		expect(patternToString(loadNote("03 - 8-4 two bars per chord.md").meta!)).toBe("X___x___");
		expect(patternToString(loadNote("03b - 4-4 twin.md").meta!)).toBe("X___");
	});

	it("04 has no tempo, so it falls back to the speed slider", () => {
		expect(loadNote("04 - No tempo.md").meta).toBeNull();
	});

	describe("05 demonstrates each notation it claims to", () => {
		const chords = chordSeconds("05 - Notation edge cases.md");

		it("reads spaced and tight bar lines the same way", () => {
			// `| Em | Am |` then `|Em|Am|`, one bar each at 60 BPM in 4/4.
			expect(chords.slice(0, 4)).toEqual([["Em", 0], ["Am", 4], ["Em", 8], ["Am", 12]]);
		});

		it("gives a chord before the first bar line its own bar", () => {
			// `Em | Dm A |`
			expect(chords.slice(4, 7)).toEqual([["Em", 16], ["Dm", 20], ["A", 22]]);
		});

		it("holds a chord across repeat slots and repeat bars", () => {
			// `| Em % % Am |` gives Em three of four beats; `| Em | % | % | Am |` holds Em three bars.
			expect(chords.slice(7, 11)).toEqual([["Em", 24], ["Am", 27], ["Em", 28], ["Am", 40]]);
		});

		it("keeps slash chords whole and lets an N.C. bar hold its place", () => {
			expect(chords.slice(11, 14)).toEqual([["C/G", 44], ["D/F#", 48], ["Am", 56]]);
		});

		it.each([
			"Verse[2] of the song",
			"A day in the life",
			"Am I wrong to want you",
		])("leaves the lyric line %p alone", (line) => {
			const result = tokenizeLine(line, 0, markers.chordLineMarker, markers.textLineMarker);
			expect(result.isChordLine).toBe(false);
			expect(result.tokens.filter(t => t.type === "chord")).toHaveLength(0);
		});

		it("takes only the bracketed chord out of a lyric line", () => {
			const result = tokenizeLine("[G]Baby[1] come back", 0, markers.chordLineMarker, markers.textLineMarker);
			expect(result.isChordLine).toBe(false);
			expect(result.tokens.filter(t => t.type === "chord").map(t => t.value)).toEqual(["[G]"]);
		});
	});

	describe("07 counts in with a bar of repeat markers", () => {
		const chords = chordSeconds("07 - Count-in.md");

		it("delays the first chord by the bar of count-in", () => {
			// 4/4 at 96 BPM is a 2.5s bar. One bar of count-in, then two bars, then two bars of count-in.
			expect(chords).toEqual([
				["Em", 2.5], ["Am", 3.75], ["C", 5], ["G", 6.25],
				["Em", 12.5], ["Am", 13.75], ["C", 15], ["G", 16.25]
			]);
		});

		it("has nothing to highlight during the count-in", () => {
			const {timeline} = loadNote("07 - Count-in.md");
			expect(chordAtBeat(timeline!, 0)).toBeNull();
			expect(chordAtBeat(timeline!, 3.9)).toBeNull();
			expect(chordAtBeat(timeline!, 4)).not.toBeNull();
		});
	});

	it("06 is long enough to scroll for a few minutes", () => {
		const {meta, timeline} = loadNote("06 - Long song.md");
		expect(timeline!.totalBeats * beatDurationMs(meta!) / 1000).toBeGreaterThan(180);
		expect(timeline!.entries.length).toBeGreaterThan(40);
	});

	it("every note the vault ships either sets a tempo or is deliberately without one", () => {
		const withoutTempo = fs.readdirSync(NOTES_DIR)
			.filter(name => loadNote(name).meta === null);
		expect(withoutTempo.sort()).toEqual(["00 - Start here.md", "04 - No tempo.md"]);
	});
});
