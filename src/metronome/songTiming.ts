/**
 * Turns the raw text of a note into a timeline of its chord lines, so that autoscrolling can be driven by
 * the song's tempo instead of a unitless speed slider.
 *
 * Measure counting: a chord line containing bar lines is divided into measures by those bar lines
 * (`| Em Am | C |` is two measures); a chord line without bar lines counts one measure per chord symbol
 * (`Em Am C` is three measures). Each measure is worth `beatsPerBar` beats, so notating a song in 8/4 to
 * get two 4/4 bars' worth of time per chord needs no special handling here.
 *
 * Pure module (no obsidian imports) so it stays testable under the jest "node" environment. It scans for
 * chord block fences itself rather than reading the CodeMirror state field, because that field is lazily
 * parsed and exists only in edit mode, while this timeline is needed in reading mode too.
 */

import {ChordToken, isChordToken, isRhythmToken, Token, TokenizedLine} from "../sheet-parsing/tokens";
import {tokenizeLine} from "../sheet-parsing/tokenizeLine";
import escapeStringRegexp from "escape-string-regexp";

export interface TimelineEntry {
	/** Index of the chord block this line belongs to, counting from 0 in document order. */
	blockIndex: number;
	/** 0-based document line of the block's opening fence, used to identify the block once rendered. */
	blockStartLine: number;
	/** Index of this line within its chord block's content, counting from 0 after the opening fence. */
	lineInBlock: number;
	/** 0-based line number within the whole document. */
	docLine: number;
	measures: number;
	/** Beat at which this line starts, counted from the beginning of the song. */
	startBeat: number;
}

/**
 * A single chord as it is played. A chord stays current until the next one starts, which is what makes a
 * bar of repeat markers (`| Em | % | % |`) hold the preceding chord.
 */
export interface ChordOccurrence {
	startBeat: number;
	/** Absolute offsets of the chord symbol in the document, for highlighting in the editor. */
	from: number;
	to: number;
	/** Index of the chord line this chord sits on, into SongTimeline.entries. */
	entryIndex: number;
	/** Position of the chord in the rendered output, for highlighting in reading mode. */
	blockIndex: number;
	blockStartLine: number;
	lineInBlock: number;
	chordInLine: number;
}

export interface SongTimeline {
	entries: TimelineEntry[];
	chords: ChordOccurrence[];
	totalBeats: number;
	beatsPerBar: number;
}

export interface LineMarkerSettings {
	chordLineMarker: string;
	textLineMarker: string;
}

/**
 * Counts the measures represented by a single chord line. Non-chord lines (lyrics, section headers, blank
 * lines) are worth nothing and never reach here.
 */
export function countMeasures(tokenizedLine: TokenizedLine): number {
	// Reconstruct the line without its trailing line-type marker, so a "%c" is not mistaken for content.
	const text = tokenizedLine.tokens
		.filter(token => token.type !== "marker")
		.map(token => token.value)
		.join("");

	if (text.includes("|")) {
		// Each bar-delimited segment holding something is a measure. Splitting the text rather than
		// walking token boundaries also handles bar lines written without surrounding whitespace
		// (`|Em|Am|`), which the tokenizer folds into a single word token. Whitespace-only segments are
		// alignment padding, not measures.
		return text.split("|").filter(segment => segment.trim().length > 0).length;
	}

	return tokenizedLine.tokens.filter(token => isChordToken(token)).length;
}

function isBarLine(token: Token): boolean {
	return isRhythmToken(token) && token.value.includes("|");
}

/**
 * One subdivision of a measure. A measure is divided equally between its slots, so `| Em % % Am |` in 4/4
 * gives Em three beats and Am one: `%` (and `/`) hold the preceding chord for another slot.
 */
type MeasureSlot = ChordToken | "continue";

/**
 * Divides a chord line into measures, and each measure into slots. Measures holding no chord at all (a
 * bar of nothing but repeat markers, or an `N.C.`) are kept, so that later chords land on the right beat.
 */
function measureSlots(tokenizedLine: TokenizedLine): MeasureSlot[][] {
	const measures: MeasureSlot[][] = [];
	let current: MeasureSlot[] = [];

	const endMeasure = () => {
		if (current.length > 0) {
			measures.push(current);
			current = [];
		}
	};

	for (const token of tokenizedLine.tokens) {
		if (isChordToken(token)) {
			current.push(token);
			continue;
		}
		if (!isRhythmToken(token)) {
			continue;
		}

		// A rhythm token can run several markers together (`%%`, `%|`), so work through its characters.
		let addedSlot = false;
		let sawBarLine = false;
		for (const char of token.value) {
			if (char === "|") {
				endMeasure();
				sawBarLine = true;
			} else if (char === "%" || char === "/") {
				current.push("continue");
				addedSlot = true;
			}
		}
		// A marker such as N.C. occupies its measure without repeating anything.
		if (!addedSlot && !sawBarLine) {
			current.push("continue");
		}
	}
	endMeasure();

	return measures;
}

/**
 * Assigns a start beat to every chord on a line. Measures divide equally between their slots, so
 * `| Em Am | C |` in 4/4 puts Em on beat 0, Am on 2 and C on 4, while `| Em % % Am |` puts Em on 0 and
 * Am on 3.
 */
function chordStartBeats(
	tokenizedLine: TokenizedLine,
	lineStartBeat: number,
	beatsPerBar: number
): {token: ChordToken, startBeat: number}[] {
	const chords: {token: ChordToken, startBeat: number}[] = [];

	if (tokenizedLine.tokens.some(token => isBarLine(token))) {
		measureSlots(tokenizedLine).forEach((slots, measureIndex) => {
			slots.forEach((slot, slotIndex) => {
				if (slot === "continue") {
					return;
				}
				const offset = (measureIndex + slotIndex / slots.length) * beatsPerBar;
				chords.push({token: slot, startBeat: lineStartBeat + offset});
			});
		});
		return chords;
	}

	// No bar lines: one measure per chord.
	for (const token of tokenizedLine.tokens) {
		if (isChordToken(token)) {
			chords.push({token, startBeat: lineStartBeat + chords.length * beatsPerBar});
		}
	}
	return chords;
}

function chordBlockFencePattern(languageSpecifier: string): RegExp {
	// Matches the opening fence of a chord block, with or without an instrument suffix
	// (```chords, ```chords-ukulele, ~~~chords).
	return new RegExp(`^\\s*(?:~{3,}|\`{3,})${escapeStringRegexp(languageSpecifier)}\\b`);
}

/**
 * Builds the beat timeline for every chord line in the document.
 */
export function buildSongTimeline(
	docText: string,
	languageSpecifier: string,
	settings: LineMarkerSettings,
	beatsPerBar: number
): SongTimeline {
	const openingFence = chordBlockFencePattern(languageSpecifier);
	const closingFence = /^\s*(?:~{3,}|`{3,})\s*$/;

	const entries: TimelineEntry[] = [];
	const chords: ChordOccurrence[] = [];
	const lines = docText.split("\n");

	let blockIndex = -1;
	let lineInBlock = 0;
	let inBlock = false;
	let blockStartLine = 0;
	let startBeat = 0;
	let lineStartOffset = 0;

	for (let docLine = 0; docLine < lines.length; docLine++) {
		const line = lines[docLine];
		const offset = lineStartOffset;
		lineStartOffset += line.length + 1;

		if (!inBlock) {
			if (openingFence.test(line)) {
				inBlock = true;
				blockIndex++;
				blockStartLine = docLine;
				lineInBlock = 0;
			}
			continue;
		}

		if (closingFence.test(line)) {
			inBlock = false;
			continue;
		}

		const tokenizedLine = tokenizeLine(line, 0, settings.chordLineMarker, settings.textLineMarker);
		if (tokenizedLine.isChordLine) {
			const measures = countMeasures(tokenizedLine);
			if (measures > 0) {
				entries.push({blockIndex, blockStartLine, lineInBlock, docLine, measures, startBeat});

				chordStartBeats(tokenizedLine, startBeat, beatsPerBar).forEach(({token, startBeat: beat}, i) => {
					// tokenizeLine was given a zero line index, so the token ranges are line-relative.
					chords.push({
						startBeat: beat,
						entryIndex: entries.length - 1,
						from: offset + token.range[0],
						to: offset + token.range[1],
						blockIndex,
						blockStartLine,
						lineInBlock,
						chordInLine: i
					});
				});

				startBeat += measures * beatsPerBar;
			}
		}

		lineInBlock++;
	}

	return {entries, chords, totalBeats: startBeat, beatsPerBar};
}

/**
 * Finds the index of the last item that has started at `beat`, or -1 if none has started yet.
 */
function indexAtBeat(items: {startBeat: number}[], beat: number): number {
	let low = 0;
	let high = items.length - 1;
	let result = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		if (items[mid].startBeat <= beat) {
			result = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return result;
}

/** Index of the chord line being played at `beat`, or -1 before the song reaches the first one. */
export function entryIndexAtBeat(timeline: SongTimeline, beat: number): number {
	return indexAtBeat(timeline.entries, beat);
}

/**
 * The chord being played at `beat`, or null before the first one. A chord stays current until the next
 * one starts.
 */
export function chordAtBeat(timeline: SongTimeline, beat: number): ChordOccurrence | null {
	return timeline.chords[indexAtBeat(timeline.chords, beat)] ?? null;
}
