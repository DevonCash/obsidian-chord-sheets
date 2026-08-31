# Chord Sheets demo vault

A throwaway vault for exercising the metronome, tempo-aware autoscroll and
current-chord highlight by hand. Regenerate it any time with `npm run demo`.

The plugin files are symlinked to the repo, so `npm run dev` in another terminal
rebuilds straight into this vault — use **Reload app without saving**
(`Ctrl/Cmd+P`) to pick up a rebuild.

## What to try

Open a note, then use the ribbon buttons at the top right, or the commands
`Toggle autoscroll` and `Toggle metronome`.

| Note | What it is for |
| --- | --- |
| [[01 - 4-4 basics]] | The ordinary case: click, scroll and highlight in 4/4 |
| [[02 - 12-8 compound]] | Four clicks per bar, not twelve |
| [[03 - 8-4 two bars per chord]] | Compare against its 4/4 twin — they should track identically |
| [[04 - No tempo]] | Falls back to the original speed slider |
| [[05 - Notation edge cases]] | Bar-line and repeat notations, and lines that must stay lyrics |
| [[06 - Long song]] | Long enough to actually scroll for a few minutes |
| [[07 - Count-in]] | A bar of `%` before the first chord counts you in |

## Two scrolling styles

Settings -> Chord Sheets -> **Tempo-aware scrolling style** switches between:

- **Hold the current chord at the reading line** (default) — the page stays
  still while a chord sounds, then glides on when the next one starts.
- **Scroll continuously at the song's pace** — a steady crawl, bringing each
  chord line to the reading line exactly as it begins.

**Reading position** sets where that reading line sits; 0.5 is the middle.
Worth trying both on [[06 - Long song]], where the difference is obvious.

## Worth watching for

- The click and the scroll must stay locked over a couple of minutes.
- Try each note in **both** live preview and reading mode.
- Typing in a note must not stop playback.
- In reading mode, scroll far down a long note first — sections unload, and the
  plugin has to still find the right block.
