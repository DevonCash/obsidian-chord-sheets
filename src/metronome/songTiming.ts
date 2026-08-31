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

import {isChordToken, TokenizedLine} from "../sheet-parsing/tokens";
import {tokenizeLine} from "../sheet-parsing/tokenizeLine";
import escapeStringRegexp from "escape-string-regexp";

export interface TimelineEntry {
	/** Index of the chord block this line belongs to, counting from 0 in document order. */
	blockIndex: number;
	/** Index of this line within its chord block's content, counting from 0 after the opening fence. */
	lineInBlock: number;
	/** 0-based line number within the whole document. */
	docLine: number;
	measures: number;
	/** Beat at which this line starts, counted from the beginning of the song. */
	startBeat: number;
}

export interface SongTimeline {
	entries: TimelineEntry[];
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
	const lines = docText.split("\n");

	let blockIndex = -1;
	let lineInBlock = 0;
	let inBlock = false;
	let startBeat = 0;

	for (let docLine = 0; docLine < lines.length; docLine++) {
		const line = lines[docLine];

		if (!inBlock) {
			if (openingFence.test(line)) {
				inBlock = true;
				blockIndex++;
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
				entries.push({blockIndex, lineInBlock, docLine, measures, startBeat});
				startBeat += measures * beatsPerBar;
			}
		}

		lineInBlock++;
	}

	return {entries, totalBeats: startBeat, beatsPerBar};
}

/**
 * Finds the index of the last entry that has started at `beat`, or -1 if the song has not reached the
 * first chord line yet.
 */
export function entryIndexAtBeat(timeline: SongTimeline, beat: number): number {
	const {entries} = timeline;
	let low = 0;
	let high = entries.length - 1;
	let result = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		if (entries[mid].startBeat <= beat) {
			result = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return result;
}
