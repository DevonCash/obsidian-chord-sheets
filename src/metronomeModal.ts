import {App, Modal, Setting, setTooltip, TextComponent} from "obsidian";
import {TapTempo} from "./metronome/tapTempo";
import {
	Beat,
	MAX_TEMPO,
	MIN_TEMPO,
	parseEmphasis,
	parseTimeSignature,
	patternToString,
	SongMeta,
	timeSignatureToString
} from "./metronome/songMeta";

/** Clicking a beat steps it through the three states. */
const NEXT_STATE: Record<Beat, Beat> = {
	accent: "normal",
	normal: "silent",
	silent: "accent"
};

const STATE_LABEL: Record<Beat, string> = {
	accent: "Accented",
	normal: "Normal",
	silent: "Silent"
};

/**
 * The song's metronome settings: tempo, time signature and the emphasis pattern. These are set once for
 * a song rather than adjusted while playing, so they live here rather than on the playback controls.
 *
 * Changes apply as they are made — the metronome keeps running while this is open, so a change can be
 * heard straight away.
 */
export class MetronomeModal extends Modal {
	private meta: SongMeta;
	private beatsEl: HTMLElement | null = null;
	private patternEl: HTMLElement | null = null;
	private tempoInput: TextComponent | null = null;
	private readonly tapTempo = new TapTempo();

	constructor(app: App, meta: SongMeta, private onChange: (meta: SongMeta) => void) {
		super(app);
		this.meta = {...meta, pattern: [...meta.pattern]};
	}

	onOpen() {
		const {contentEl, titleEl} = this;
		titleEl.setText("Metronome");

		new Setting(contentEl)
			.setName("Tempo")
			.setDesc("Beats per minute, counting the note value in the time signature's lower number. "
				+ "Tap the button in time to set it by ear.")
			.addText(text => {
				this.tempoInput = text;
				text.inputEl.type = "number";
				text.inputEl.min = String(MIN_TEMPO);
				text.inputEl.max = String(MAX_TEMPO);
				text.setValue(String(this.meta.bpm)).onChange(value => {
					const bpm = parseFloat(value);
					const valid = !isNaN(bpm) && bpm >= MIN_TEMPO && bpm <= MAX_TEMPO;
					text.inputEl.toggleClass("chord-sheet-invalid", !valid);
					if (valid) {
						// Typing a tempo abandons any tapping in progress.
						this.tapTempo.reset();
						this.apply({bpm});
					}
				});
			})
			.addButton(button => {
				button.buttonEl.addClass("chord-sheet-tap-tempo");
				button
					.setButtonText("Tap")
					.setTooltip("Tap in time with the music to set the tempo")
					.onClick(() => this.tap(button.buttonEl));
			});

		new Setting(contentEl)
			.setName("Time signature")
			.setDesc("Any signature, for example 4/4, 6/8, 7/8, 12/8 or 8/4.")
			.addText(text => text
				.setValue(timeSignatureToString(this.meta))
				.onChange(value => {
					const signature = parseTimeSignature(value);
					text.inputEl.toggleClass("chord-sheet-invalid", !signature);
					if (signature) {
						// A change of meter resizes the bar, so the pattern is refitted to it.
						this.apply({
							...signature,
							pattern: parseEmphasis(patternToString(this.meta), signature.beatsPerBar)!
						});
						this.renderBeats();
					}
				})
			);

		new Setting(contentEl)
			.setName("Emphasis")
			.setDesc("Click a beat to step it through accented, normal and silent.")
			.setHeading();

		this.beatsEl = contentEl.createDiv({cls: "chord-sheet-emphasis-beats"});
		this.patternEl = contentEl.createDiv({cls: "chord-sheet-emphasis-pattern"});

		const legendEl = contentEl.createDiv({cls: "chord-sheet-emphasis-legend"});
		for (const state of ["accent", "normal", "silent"] as Beat[]) {
			const item = legendEl.createDiv({cls: "chord-sheet-emphasis-legend-item"});
			item.createSpan({cls: ["chord-sheet-emphasis-swatch", `is-${state}`]});
			item.createSpan({text: STATE_LABEL[state]});
		}

		this.renderBeats();
	}

	onClose() {
		this.contentEl.empty();
	}

	/** One tap of the tempo: the first has no interval to measure, so it only invites another. */
	private tap(buttonEl: HTMLElement) {
		const bpm = this.tapTempo.tap(performance.now());
		// The tempo field is what shows the result, so the button only says whether it has enough to
		// work from yet.
		buttonEl.setText(bpm === null ? "Tap again" : "Tap");
		if (bpm === null) {
			return;
		}

		this.tempoInput?.setValue(String(bpm));
		this.tempoInput?.inputEl.removeClass("chord-sheet-invalid");
		this.apply({bpm});
	}

	private apply(changes: Partial<SongMeta>) {
		this.meta = {...this.meta, ...changes};
		this.onChange(this.meta);
	}

	private renderBeats() {
		const beatsEl = this.beatsEl;
		if (!beatsEl) {
			return;
		}

		beatsEl.empty();
		this.meta.pattern.forEach((state, index) => {
			const button = beatsEl.createEl("button", {
				cls: ["chord-sheet-emphasis-beat", `is-${state}`],
				text: String(index + 1)
			});
			setTooltip(button, `Beat ${index + 1}: ${STATE_LABEL[state]}`);
			button.addEventListener("click", () => {
				const pattern = [...this.meta.pattern];
				pattern[index] = NEXT_STATE[pattern[index]];
				this.apply({pattern});
				this.renderBeats();
			});
		});

		this.patternEl?.setText(patternToString(this.meta));
	}
}
