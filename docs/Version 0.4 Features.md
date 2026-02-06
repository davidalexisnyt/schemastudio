# Schema Studio - Version 0.4 Updates

## Feature/change list

[ ] Crows-foot relationship notation
[x] Add notes to image export
[x] Import from connection to a database
[x] Target/export metadata per workspace and table/fields
[ ] Get force-directed layout working. Make it just a view option instead of a layout.
[x] Text blocks on diagram - to do things like diagram titles, etc. Be able to modify font sizes, etc. No background.
[x] Diagrams/models show generic data types. Define default mappings to specific DBMSs - e.g. Postgres, BigQuery, SQLite, etc.

## Text Blocks

Let's add the ability to add text blocks to diagrams. We currently have yellow stickies, but text blocks serve a different purpose. We can use them to add titles, sub-titles, and descriptive text to diagrams. Whereas the sticky note is a short blob of contextual information with a yellow background, text blocks are text with no background color, tht are overlaid on the diagram. We should be able customize the font size, width, and position of a text block. We should also have the option to use markdown for larger text blocks. The text should be rendered with the markdown formatting (headers, bullet points, etc) applied.

### Updates/Fixes

- Remove the width field from the text block editor. Instead, the width should be dynamic based on the text entered.
- Display resize handles at the top, bottom, left, and right of the bounding box of the text block when the user hovers over it. The user can then drag these handles to resize the text block.
- Ensure that the height of the text block bounding box is the height of the text, with maybe a 1rem padding/gap.
- Reduce the thickness of the bounding box resize handles. In fact, just show it as a very subtle, 1px border while the user is hovering over it.
- Render the border around the text block bounding box while the user is resizing it. This is to give the user visual feedback while resizing.
- Creating a text block with Markdown does not work
  - When the OK button is pressed on the editor, the dialog is not dismissed. Also, all the tables on the diagram disappear, leaving the relationship lines. The Undo operation must be used to restore the tables to the diagram. Please investigate this issue.
- Markdown text blocks are now created without messing up the diagram. However, the markdown source of the text is displayed on the diagram. The text should be rendered with headers, lists, etc.

> The "Auto" model mode in Cursor is trash. I went back and forth trying to fix a text rendering issue and things just kept either not changing or getting worse. Switched to Claude 4.6 Opus High and the problem was solved in one go.

# Connecting to Databases Directly

We currently import tables from CSV files or DDL that the user created externally. It would be great if we can connect to a datbase back end of the user's choice, inspect the schema, run queries to generate the DDL or CSV data we need for table imports, run the queries to generate the DDL or CSV, then pass it to the existing table catalog import feature. We have a Typescript front-end engine and Go on the back end at our disposal. Research various options for database connectivity. Keep in mind that we would like to support various database back ends (PostgreSQL, MySQL, SQL Server, BigQuery) in the most efficient manner, using the least resources, while considering security, performance, package sizes, etc.

We need a way to clear the table catalog in a workspace. Let's add a "Clear Table Catalog" button in the Workspace Settings dialog.

For BigQuery the authentication method "Sign on with Google" will not work. Please implement OAuth 2.0, user credentials authentication.

## Changes to Import and Internal Schema Representation

- In the table object on a diagram, add a key icon to the left of the name of the primary key field(s). We may need to add a gutter to the left of the field name column to allow space for the icon.

### Data Type Representation

The set of field data types that we'll use in diagrams should be generic and not datbase platform specific. e.g. int, bigint, smalint, etc should be represented as "integer" in the models. Varchar, character varying, string should be represented in the models as "string". Let's ensure that our internal type list is generic, yet comprehensive enough to handle data types (FIELD_TYPES constant in types.ts) from all our target databases.

In order to properly support 2-way modeling (import from database, export to DDL), we'll need to define default mappings between our modelling types and the types for PostgreSQL, MySQL, SQL Server, and BigQuery.

Our internal representation of a table schema (surfaced in the Table Editor) should allow the user to specify custom type overrides per field for specific databases. e.g.The `phone` field in a `contacts` table might be represented as "string" in the model, but I might want to ensure that, when exported, the DDL would have the type as `varchar(15)` for Postgres but `string` for BigQuery. Each field should support custom mappings for multiple target databases. We also want to optionally specify the length of a string field (e.g. 15 for a string field so that it gets generated as varchar(15) for Postgres). Let's add a length entry on fields in the table editor.

Let's determine the best, cleanest UX for these updates to the Table Editor.

When we import tables from a database or DDL file, the target metadata for the specific database type should be populated in the internal table representation and data types should be converted to the internal modelling types. Ensure that varchar fields with lengths specified in the source (e.g. varchar(15)) have the length from the source captured in the internal representation.

Since field lengths are fairly common across many databases, let's surface a length entry for character fields in the Table Editor. Also surface entry for precision and scale for imported `numeric` data types.

# Some Fixes and Polish

- Very long table names sometimes exceeds the width of the table object on the diagram canvas. Change the calculation of the display width of a table to also include the table name.
- The hover styling of the Import button in the Import From Database dialog is black text on a black background. Change this to be readable. The button styling when clicked is also hard to read.
- The Import from Database dialog does not leave much space for the table list. Let's refactor the dialog to be like a wizard:
  - Step 1: Connection page. The buttons in the dialog footer should be "Save Profile", "Connect", "Cancel". Once the user clicks Connect and the connection to the database is established, the connection page is hidden and we go to the next step.
  - Step 2: Import page. This page shows the database schema / dataset selection and the list of tables available to be imported. The buttons in the dialog footer should be "Import" and "Cancel". Once the user clicks Import and the tables have been imported to the catalog, the dialog is dismissed.
- Allow the user to select multiple tables in the table catalog to be added to a diagram. The user can drag the selected tables to the diagram or right-click and select "Add to diagram".
- Allow the user to select multiple tables in the table catalog to be deleted/removed. After selecting tables, the user can right-click on the selection and select "Remove from Catalog" from the context menu options.

# Add notes and text blocks to image export

The current export to PNG and SVG do not properly render notes and text blocks that are on the diagram. Notes show up as a black box. Investigate and fix this problem.
Text blocks, a newly added feature, do not render at all on the images. Add text blocks to the image exports.

## Tech Research

- Go plugin alternatives that work on Windows

---

Relationship lines currently use an arrowhead on the foreign-key side. Let's make a couple updates to this:

1. Make the notation configurable. For now, let's add a Notation option to the Workspace settings with a dropdown of options (see https://www.softwareideas.net/erd-relation-arrows for the various options):
   - Crow's Foot
   - Min-Max
   - Backman
2. Implement all of the options as pluggable so the diagrams will immediately change when the option is changed in the Workspace settings.
