/**
 * Parsing and serialization of the metronome properties stored in a note's YAML frontmatter:
 *
 *   tempo: 180             beats per minute, counting the note value in the time signature denominator
 *   time-signature: 12/8   any numerator / denominator, no whitelist of "common" signatures
 *   emphasis: X__x__x__x__ one character per beat: X accent, x normal, _ (or .) silent
 *
 * Pure module (no obsidian imports) so it stays testable under the jest "node" environment.
 */

export type Beat = "accent" | "normal" | "silent";

export interface SongMeta {
	/** Beats per minute, where a "beat" is the note value of the time signature denominator. */
	bpm: number;
	/** Time signature numerator. A measure is worth this many beats. */
	beatsPerBar: number;
	/** Time signature denominator. Kept for display; the timing math needs only bpm and beatsPerBar. */
	beatUnit: number;
	/** One entry per beat of a bar, always exactly beatsPerBar long. */
	pattern: Beat[];
}

export interface SongMetaDefaults {
	tempo: number;
	timeSignature: string;
	emphasis: string;
}

export const TEMPO_PROPERTY = "tempo";
export const TIME_SIGNATURE_PROPERTY = "time-signature";
export const EMPHASIS_PROPERTY = "emphasis";

export const MIN_TEMPO = 20;
export const MAX_TEMPO = 400;
const MAX_BEATS_PER_BAR = 64;

const TIME_SIGNATURE_PATTERN = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
const EMPHASIS_PATTERN = /^[Xx_.]+$/;

/** Frontmatter values arrive untyped; only primitives are meaningful here. */
function asText(value: unknown): string | null {
	return typeof value === "string" ? value
		: typeof value === "number" || typeof value === "boolean" ? String(value)
			: null;
}

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

/**
 * Parses a "n/d" time signature. Any positive numerator (up to 64 beats per bar) and denominator is
 * accepted, so odd meters like 12/8, 8/4 or 7/8 work without being enumerated anywhere.
 */
export function parseTimeSignature(value: unknown): { beatsPerBar: number, beatUnit: number } | null {
	const text = asText(value);
	if (text === null) {
		return null;
	}

	const match = text.match(TIME_SIGNATURE_PATTERN);
	if (!match) {
		return null;
	}

	const beatsPerBar = parseInt(match[1], 10);
	const beatUnit = parseInt(match[2], 10);
	if (beatsPerBar < 1 || beatsPerBar > MAX_BEATS_PER_BAR || beatUnit < 1) {
		return null;
	}

	return {beatsPerBar, beatUnit};
}

/**
 * Parses an emphasis pattern into exactly `beatsPerBar` beats. A pattern shorter than the bar is padded
 * with normal beats (so a bare "X" means "accent the downbeat, normal clicks after" in any meter) and a
 * longer one is truncated. Returns null if the value contains any character other than X, x, _ or .
 */
export function parseEmphasis(value: unknown, beatsPerBar: number): Beat[] | null {
	const text = asText(value)?.trim();
	if (!text || !EMPHASIS_PATTERN.test(text)) {
		return null;
	}

	const pattern: Beat[] = [];
	for (let i = 0; i < beatsPerBar; i++) {
		const char = text[i];
		pattern.push(
			char === undefined ? "normal"
				: char === "X" ? "accent"
					: char === "x" ? "normal"
						: "silent"
		);
	}
	return pattern;
}

/**
 * Builds the song's metronome settings from frontmatter, falling back to the plugin defaults for any
 * property that is missing or malformed. Returns null when no tempo is set at all — that is the signal
 * for the caller to fall back to legacy speed-based autoscrolling.
 */
export function parseSongMeta(
	frontmatter: Record<string, unknown> | undefined | null,
	defaults: SongMetaDefaults
): SongMeta | null {
	const rawTempo = frontmatter?.[TEMPO_PROPERTY];
	if (rawTempo === null || rawTempo === undefined || rawTempo === "") {
		return null;
	}

	const tempoText = asText(rawTempo);
	const tempo = tempoText === null ? NaN : parseFloat(tempoText);
	if (isNaN(tempo)) {
		return null;
	}

	const timeSignature = parseTimeSignature(frontmatter?.[TIME_SIGNATURE_PROPERTY])
		?? parseTimeSignature(defaults.timeSignature)
		?? {beatsPerBar: 4, beatUnit: 4};

	const pattern = parseEmphasis(frontmatter?.[EMPHASIS_PROPERTY], timeSignature.beatsPerBar)
		?? parseEmphasis(defaults.emphasis, timeSignature.beatsPerBar)
		?? parseEmphasis("X", timeSignature.beatsPerBar)!;

	return {
		bpm: clamp(tempo, MIN_TEMPO, MAX_TEMPO),
		beatsPerBar: timeSignature.beatsPerBar,
		beatUnit: timeSignature.beatUnit,
		pattern
	};
}

/** Duration of a single beat in milliseconds. */
export function beatDurationMs(meta: Pick<SongMeta, "bpm">): number {
	return 60000 / meta.bpm;
}

/** Duration of one full bar in milliseconds. */
export function barDurationMs(meta: Pick<SongMeta, "bpm" | "beatsPerBar">): number {
	return beatDurationMs(meta) * meta.beatsPerBar;
}

export function timeSignatureToString(meta: Pick<SongMeta, "beatsPerBar" | "beatUnit">): string {
	return `${meta.beatsPerBar}/${meta.beatUnit}`;
}

export function patternToString(meta: Pick<SongMeta, "pattern">): string {
	return meta.pattern.map(beat =>
		beat === "accent" ? "X" : beat === "normal" ? "x" : "_"
	).join("");
}
