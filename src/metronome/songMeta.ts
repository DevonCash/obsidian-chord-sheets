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

/** A note value the tempo can be counted in, as a fraction of a whole note. */
export interface TempoUnit {
	/** Fraction of a whole note: a quarter note is 0.25, a dotted quarter 0.375. */
	value: number;
	/** How it is written in the note's properties. */
	notation: string;
	label: string;
}

/** Note values a tempo is conventionally given in, longest first. */
export const TEMPO_UNITS: TempoUnit[] = [
	{value: 1, notation: "1/1", label: "Whole note"},
	{value: 0.75, notation: "3/4", label: "Dotted half note"},
	{value: 0.5, notation: "1/2", label: "Half note"},
	{value: 0.375, notation: "3/8", label: "Dotted quarter note"},
	{value: 0.25, notation: "1/4", label: "Quarter note"},
	{value: 0.1875, notation: "3/16", label: "Dotted eighth note"},
	{value: 0.125, notation: "1/8", label: "Eighth note"},
	{value: 0.0625, notation: "1/16", label: "Sixteenth note"}
];

export interface SongMeta {
	/** Beats per minute, where a "beat" is `tempoUnit` — conventionally a quarter note. */
	bpm: number;
	/**
	 * The note value the tempo counts, as a fraction of a whole note. Lets a compound meter be given the
	 * tempo it is conventionally written with: 12/8 at a dotted quarter of 60 rather than an eighth of
	 * 180. Everything else here is still measured in the denominator's note value.
	 */
	tempoUnit: number;
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
}

/**
 * How each time signature is counted when a note does not say. Written the way the property is: X accent,
 * x normal, _ silent.
 *
 * Simple meters accent the downbeat and click every beat. Compound meters click only their pulses —
 * 6/8 is two dotted quarters, not six eighths — and irregular meters follow their usual grouping.
 */
const DEFAULT_EMPHASIS: Record<string, string> = {
	"2/4": "Xx",
	"3/4": "Xxx",
	"4/4": "Xxxx",
	"5/4": "X__x_",          // 3+2
	"2/2": "Xx",
	"3/2": "Xxx",
	"4/2": "Xxxx",
	"3/8": "Xxx",
	"5/8": "X__x_",          // 3+2
	"6/8": "X__x__",         // 2 dotted quarters
	"7/8": "X_x_x__",        // 2+2+3
	"9/8": "X__x__x__",      // 3 dotted quarters
	"12/8": "X__x__x__x__"   // 4 dotted quarters
};

/** A meter of threes on a short note value is compound: it is counted in groups of three. */
function isCompound(beatsPerBar: number, beatUnit: number): boolean {
	return beatUnit >= 8 && beatsPerBar >= 6 && beatsPerBar % 3 === 0;
}

/**
 * The note value a beat is when the note does not say. A compound meter is counted in dotted notes —
 * 12/8 in dotted quarters, not eighths — which is both how its tempo is conventionally written and what
 * its default emphasis clicks.
 */
export function defaultTempoUnit(beatsPerBar: number, beatUnit: number): number {
	return isCompound(beatsPerBar, beatUnit) ? 3 / beatUnit : 1 / beatUnit;
}

/**
 * How a time signature is counted when the note does not say: from the table where it is listed, and
 * otherwise from its shape — groups of three for a compound meter, every beat for anything else.
 */
export function defaultEmphasis(beatsPerBar: number, beatUnit: number): Beat[] {
	const listed = DEFAULT_EMPHASIS[`${beatsPerBar}/${beatUnit}`];
	if (listed) {
		return parseEmphasis(listed, beatsPerBar)!;
	}

	const pattern: Beat[] = [];
	for (let beat = 0; beat < beatsPerBar; beat++) {
		const startsGroup = isCompound(beatsPerBar, beatUnit) ? beat % 3 === 0 : true;
		pattern.push(beat === 0 ? "accent" : startsGroup ? "normal" : "silent");
	}
	return pattern;
}

/**
 * Parses the note value a tempo is counted in, written the way it is in the properties ("1/4", "3/8").
 * Returns null for anything that is not one of the conventional note values.
 */
export function parseTempoUnit(value: unknown): number | null {
	const text = asText(value)?.trim();
	return TEMPO_UNITS.find(unit => unit.notation === text)?.value ?? null;
}

/**
 * How a tempo unit is offered in the interface: its name and the notation it is stored as, so the
 * dropdown and the note's `beat-unit` property visibly say the same thing.
 *
 * The proper musical glyphs are not used: U+1D15D onwards covers every note value needed, but does not
 * render in any font stack available here, and the glyphs that do render (U+2669 onwards) only cover
 * quarters and eighths — half the list would be lettered and half not.
 */
export function tempoUnitLabel(unit: TempoUnit): string {
	return `${unit.label} (${unit.notation})`;
}

/** How a tempo unit is written in the note's properties. */
export function tempoUnitNotation(meta: Pick<SongMeta, "tempoUnit">): string {
	return TEMPO_UNITS.find(unit => unit.value === meta.tempoUnit)?.notation ?? "1/4";
}

export const TEMPO_PROPERTY = "tempo";
export const BEAT_UNIT_PROPERTY = "beat-unit";
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
		?? defaultEmphasis(timeSignature.beatsPerBar, timeSignature.beatUnit);

	return {
		bpm: clamp(tempo, MIN_TEMPO, MAX_TEMPO),
		tempoUnit: parseTempoUnit(frontmatter?.[BEAT_UNIT_PROPERTY])
			?? defaultTempoUnit(timeSignature.beatsPerBar, timeSignature.beatUnit),
		beatsPerBar: timeSignature.beatsPerBar,
		beatUnit: timeSignature.beatUnit,
		pattern
	};
}

/**
 * Duration in milliseconds of one unit of the time signature's own note value — the unit measures, slots
 * and emphasis patterns are all counted in.
 *
 * The tempo may be given in a different note value, so it is converted: at a dotted quarter of 60 in
 * 12/8, each tempo beat covers three eighths, making an eighth 333ms.
 */
export function beatDurationMs(meta: Pick<SongMeta, "bpm" | "tempoUnit" | "beatUnit">): number {
	const signatureUnitsPerTempoUnit = meta.tempoUnit * meta.beatUnit;
	return 60000 / (meta.bpm * signatureUnitsPerTempoUnit);
}

/** Duration of one full bar in milliseconds. */
export function barDurationMs(meta: Pick<SongMeta, "bpm" | "tempoUnit" | "beatUnit" | "beatsPerBar">): number {
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
