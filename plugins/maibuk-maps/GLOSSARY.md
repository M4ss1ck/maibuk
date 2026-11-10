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

**Element**:
Any one of the five kinds placed on a Map: a Map Line, a Fill, a Stamp, a Map Label, or a Map Image. Hidden and locked are Element properties, and an Element's order in the Elements list is its z-order.
_Avoid_: layer, shape, object

**Elements list**:
The editor panel that lists every Element of the open Map in z-order, where the author selects, renames, reorders, hides, locks, and deletes Elements.
_Avoid_: layer list, object list, outline

**Map Line**:
Any line drawn on a Map. Its style makes it a coast, a river, a road, a border, or a plain line, and decides whether it encloses Fills.
_Avoid_: path, route, stroke, shape (that is a Shape or a Canvas Shape)

**Shape**:
A Map Line drawn by the Ellipse, Rectangle, or Polygon tool. It keeps its exact geometry — its center, width, height, rotation, sides, and corner radius — which the properties panel edits as numbers, and it draws its outline from those numbers until something converts it; Roughen or an Eraser cut turns it into a point-by-point line that remembers the Shape it was.
_Avoid_: Canvas Shape (that is a core Maibuk term), primitive, figure

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

**Pencil**:
The editor tool that draws a Map Line freehand and smooths the stroke as the author draws.
_Avoid_: brush, freehand tool

**Select**:
The editor tool that picks one Element on the Map, to move, rename, hide, lock, or delete it.
_Avoid_: pointer, arrow, cursor

**Pen**:
The editor tool that draws a Map Line point by point: each click adds a straight point, Shift+click adds a curved point, and clicking the first point again closes the line. Its keyboard form moves a crosshair with the arrows and adds points with Enter.
_Avoid_: polyline tool, path tool, polygon tool

**Ellipse**:
The editor tool that draws a Shape as a closed oval: a drag sets its box, and Shift squares that box into a circle. Its keyboard form is its key and the Place button, which lands one at the view center.
_Avoid_: circle tool, oval tool, ellipse primitive

**Rectangle**:
The editor tool that draws a Shape as a closed four-cornered box: a drag sets its box, Shift squares it, and its corner radius rounds the corners. Its keyboard form is its key and the Place button.
_Avoid_: box tool, square tool, rectangle primitive

**Polygon**:
The editor tool that draws a Shape as a closed figure of straight sides inside its box: the side count runs from three to twelve. Its keyboard form is its key and the Place button.
_Avoid_: n-gon tool, regular polygon, polygon primitive

**Eraser**:
The editor tool that removes the parts of Map Lines a drag passes over, cutting a Map Line into pieces where the drag crosses it.
_Avoid_: rubber, delete tool, cutting tool

**Line style**:
The kind of Map Line a line is drawn as: a coast, a river, a road, a border, a coast ripple, or a plain line. Each kind has its own look and its own default for Encloses Fills.
_Avoid_: preset, brush, line type, stroke style

**Encloses Fills**:
A Map Line property: when it is set, a Fill inside the area the line encloses follows the line when it moves.
_Avoid_: closed shape, fill boundary, auto fill

**Roughen**:
The edit that redraws a Map Line in the rough.js hand-inked look, pushed off its path by the Roughen strength so it reads as drawn by hand.
_Avoid_: jitter (that is a defect, not an effect), wobble, noise, sketch

## Relationships

- A **Map** belongs to zero or one **Book**, starts from a **Map Template** or blank, is drawn in one **Map Style**, and holds **Map Lines**, **Fills**, **Stamps**, **Map Labels**, and **Map Images**.
- A **Fill** covers an area enclosed by **Map Lines** or an outline of its own; a **Fill** or **Map Line** can have a **Soft Edge**.
- **Custom Stamps** and **Custom Fills** belong to the **Library**; any **Map** can use them.
- Every **Map Line**, **Fill**, **Stamp**, **Map Label**, and **Map Image** is an **Element**; order in the **Elements list** is z-order.
- The **Pen** and the **Pencil** draw **Map Lines**; the **Eraser** cuts them into pieces, and **Roughen** redraws one in the rough.js ink look.
- The **Ellipse**, **Rectangle**, and **Polygon** draw a **Shape**, a **Map Line** that keeps its exact geometry; **Roughen** or an **Eraser** cut converts it into a point-by-point line.
- A **Map Line** has one **Line style**, which decides its look and its default **Encloses Fills**.
