# Echoes

Echoes is a Built-in Plugin that points out words and phrases an author repeats. These terms bind only inside `plugins/maibuk-echoes/`; Maibuk's own terms come from the root `GLOSSARY.md`.

**Echo**:
A word or phrase repeated closely enough, or often enough, that a reader would notice. Echoes reports three kinds. A Note, and the Ephemeral, are checked on their own text only, never against a Book's Chapters.
_Avoid_: repetition, duplicate

**Nearby echo**:
A word that comes back within a few dozen words of its last use, counted by stem, inside one Chapter, one Note, or the Ephemeral.

**Overused word**:
A word used often enough across a Chapter, a Note, the Ephemeral, or a Book that its rate stands out, whatever the distance between uses.

**Repeated phrase**:
A run of three to five words that appears more than once in a Chapter, a Note, or the Ephemeral, or several times in a Book. A phrase inside a longer repeated one is reported as the longer one.

**Ignore list**:
Words the author told Echoes never to report. One list for the whole Library.

**Limited support**:
How Echoes runs for a language it has no stop words or stemmer for: words match only when spelled the same, and short common words are not filtered out.

**Echo color**:
The one color every occurrence of an Echo shares in the editor when the author colors highlights by Echo, so the words that belong together read as a group. An Echo keeps its color across Chapters and while the author types.
_Avoid_: group color, tone

**Palette**:
A preset set of Echo colors the author picks from. Two Echoes can share a color when there are more Echoes than colors.
