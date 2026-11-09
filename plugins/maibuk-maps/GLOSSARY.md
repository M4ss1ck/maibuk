# Maps

Maps is a Built-in Plugin where the author designs Maps of their world, in color or print-ready ink, to place in a Chapter or Note or save as an image. These terms bind only inside `plugins/maibuk-maps/`; Maibuk's own terms come from the root `GLOSSARY.md`.

**Map**:
A picture of the author's world, one of its regions, or a country and its provinces, to be placed in a Chapter or Note or saved as an image. A Map belongs to zero or one Book; it is kept with the Library and its Backups but is not a Synced Item (ADR 0039).
_Avoid_: world map (that is one kind of Map), atlas, canvas, drawing

**Map Template**:
A ready-made Map the author starts a new Map from.
_Avoid_: preset, base map

**Map Style**:
The named set of colors and fonts a Map is drawn in: land, water, each kind of Fill, ink, and labels. Any single element can override its color.
_Avoid_: theme (that is the app's light and dark), palette, skin

**Map Line**:
Any line drawn on a Map. Its style makes it a coast, a river, a road, a border, or a plain line, and decides whether it encloses Fills.
_Avoid_: path, route, stroke, shape (that is a Canvas Shape)

**Fill**:
The color, texture, or scatter of Stamps that covers one area of a Map: either an area enclosed by Map Lines, which it follows when they move, or an outline drawn just for it.
_Avoid_: paint, shape, region, terrain, zone

**Soft Edge**:
An edge of a Fill or Map Line that fades out instead of ending in a line, as on a forest or a tinted zone.
_Avoid_: blur, feather, fuzzy

**Custom Fill**:
A Fill the author defined, from a texture image or a set of their Stamps to scatter. It belongs to the Library.
_Avoid_: custom terrain, custom biome, custom texture

**Stamp**:
A single picture placed on a Map at one spot, such as a city, a castle, a lone mountain, a compass rose, or a ship.
_Avoid_: icon (that is a Plugin UI component), symbol (that is the Symbol inserter), marker, pin, decoration

**Custom Stamp**:
A Stamp made from an image the author uploaded. It belongs to the Library, so every Map can use it.
_Avoid_: uploaded icon, custom icon

**Map Label**:
A name written on a Map, straight or along a curve.
_Avoid_: text, caption, title (that is a Book's)

**Map Image**:
An image the author places on a Map as its own layer, such as a scanned map to trace over; it can be dimmed or left out of the exported picture.
_Avoid_: background, overlay, Custom Stamp (that is placed as a Stamp)

## Relationships

- A **Map** belongs to zero or one **Book**, starts from a **Map Template** or blank, is drawn in one **Map Style**, and holds **Map Lines**, **Fills**, **Stamps**, **Map Labels**, and **Map Images**.
- A **Fill** covers an area enclosed by **Map Lines** or an outline of its own; a **Fill** or **Map Line** can have a **Soft Edge**.
- **Custom Stamps** and **Custom Fills** belong to the **Library**; any **Map** can use them.
