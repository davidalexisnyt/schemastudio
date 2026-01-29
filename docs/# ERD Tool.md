# ERD Tool - Initial Prompt

I want to build an entity relationship diagram tool with the following capabilities

- Visually design a database schema by adding tables and editing table fields.
- The user should be able to re-arrange the tables by dragging them into different positions. Any relationship lines should follow the table as it is being dragged.
- The user should be able to add relationships between tables by clicking on a table and selecting a field to connect to another table, then dragging the relationship line to the target table and field.
- The user should be able to edit the relationship by clicking on the relationship line and editing the field names.
- The user should be able to delete a relationship by clicking on the relationship line and selecting "Delete".
- The user should be able to delete a table by clicking on the table and selecting "Delete".
- The user should be able to add a new table by clicking on the "Add Table" button.
- The user should be able to add a new field to a table by clicking on the table and selecting "Add Field".
- The user should be able to edit a field by clicking on the field and editing the field name and type.
- The user should be able to delete a field by clicking on the field and selecting "Delete".
- The user should be able to save the schema by clicking on the "Save" button.
- The user should be able to load a saved schema by clicking on the "Load" button.
- The user should be able to undo the last action by clicking on the "Undo" button.
- The user should be able to redo the last action by clicking on the "Redo" button.
- The JSON file format for saved schemas should follow the JSON Schema standard format.
- The user should be able to export the schema as a JSON file by clicking on the "Export" button.
- The user should be able to import a JSON file into the schema by clicking on the "Import" button.
- The user should be able to export the schema as a SQL file by clicking on the "Export" button.
- The user should be able to import a SQL file into the schema by clicking on the "Import" button.
- The user should be able to export the schema as a Mermaid diagram by clicking on the "Export" button.
- The user should be able to import a Mermaid diagram into the schema by clicking on the "Import" button.
- The user should be able to export the schema as a PNG image by clicking on the "Export" button.
- The user should be able to export the schema as a SVG image by clicking on the "Export" button.
- The user should be able to zoom the diagram in and out using the Ctrl + mouse wheel.
- The user should be able to pan the diagram by dragging the mouse.
- The user should be able to select a table by clicking on it.
- The user should be able to select a field by clicking on it.
- The user should be able to rearrange the layout of the diagram by clicking on the "Layout" button and selecting a layout option.
- The application should be written using standard web technologies, as much as possible, and should be compatible with modern browsers.
  - Web Components
  - HTML
  - CSS
  - JavaScript / TypeScript
- The application should be written like as a progressive web app (PWA) and should be installable on the user's device.

In deciding the technology stack and architecture, consider the following:

- It is highly preferable that the application be a desktop application, but if it is not possible, then a web application is acceptable.
- If is highly preferable that the backend for the desktop application be written in Go, but if it is not possible, then a Python application is acceptable.
- Python should be considered only if the plan includes how to package the application into a single executable file that can be run on the user's device.
- For the desktop application, consider the following options:
  - Electron (JavaScript / TypeScript)
  - Wails (Go)
  - Flet (Python)
  - Tauri (Rust)

The application architecture should be designed to be modular and easy to extend. This is especially important for the feature to export the schema to SQL.
The SQL export feature should be designed to be extensible to support multiple database systems.

Given the above requirements, please provide a detailed plan for the project including the following:

- The technology stack to use
- The architecture of the application
- The user interface design
- The user experience design
- The testing strategy
- The deployment strategy

---

# Addressing Issues in Inital Build

The initial build of the app looks great, but there are a few issues and unimplemented features. Let's work on them incrementally.

## Things That Work Well

- Add Table: The basic feature works well to add a new table template to the canvas. We need to work on what happens after the new table template is added to the canvas.
- Save: The save feature works as expected.
- Load: The load feature works as expected and the diagram gets displayed exactly as it was when it was saved.
- Undo and Redo: These work very well.

## Things That Need Work

- Table editing. This does not work. The Edit context menu is able to get displayed (with difficulty) only once, but does not seem to enable the table to be edited. Then the menu never shows up again.
- Connect: Connecting two tables works, and the relationship lines remain connected when the tables are dragged around. However, the UX is not ideal.
- Import: Does not seem to be implemented. Clicking on the button does nothing.
- Export: Does not seem to be implemented. Clicking on the button does nothing.
- Layout: Does not seem to be implemented. Clicking on the button does nothing.

Let's create a plan for addressing these issues in phases

## Phase 1 - Edit Tables

Let's change the UX for table editing.

- Show a popup editor dialog with the table details when the user double-clicks on a table.
- Allow the user to make changes to the table name and fields, then click an OK button to persist the changes and update the diagram.

## Phase 2 - Connect

Let's improve the UX of the Connect feature

- Don't use the Connect button to initiate the feature. Let's remove the button.
- To connect tables, allow the user to click and drag from the field section of a table onto another table.
  - Once the user starts dragging, display a connection line that starts at the edge of the current table and ends at the mouse cursor. The line should follow the cursor until the user releases the mouse over the target table.
  - Display a popup dialog with the source table and target table names. Allow the user to specify one or more fields from the source table and one or more fields from the target table to define the table relationship.
    - Allow the user to enter a name for the relationship.
    - Allow the user to enter a note about the relationship.
    - Allow the user to specify the nature of the relationship: 1-to-1, 1-to-many, many-to-many, 0/1-to-0/many, etc.
  - The table editor dialog should be modal and should only be closed by the user clicking on OK or Cancel. It should not close if the user clicks outside the dialog.
  - Focus should go to the name entry for the new field when the user clicks the "Add field" button.

## Phase 3 - Import/Export

The code for SQL and Mermaid importers were generated in the initial build, but they don't seem to be connected to the UI. Let's get the "Import" button/dropdown functionality connected and working.

Code for exporters was also generated in the initial build, but the Export button/dropdown does nothing. Let's get that implemented.

## Phase 4 - Layout

This may be the most difficult to implement so let's leave it for later.

---

## Interim Prompts for Addressing Issues

1. The table editor dialog should not close if the user clicks outside of it. It should only close by clicking the OK or Cancel buttons.
2. In the table editor, focus should go to the name entry for the new field when the user clicks the "Add field" button.
3. The Import dropdown menu now works, but the only option that seems to be working is the JSON import. Selecting the SQL import allows a SQL file to be selected, but nothing happens. If there is an error occuring, the user is not notified. Let's add a collapsible, resizable bottom panel for displaying status info and errors. Determine why no diagram gets created when importing a SQL file.
4. When the bottom panel is collapsed by clicking the collapse button, it seems to completely go away. Provide a visual indicator of its collapsed state at the bottom of the screen and something that the user can click to show the panel again.
5. For the Layout feature, enforce a minimum gap between tables so that they don't end up looking connected.
6. The gap between the tables is now much larger than the defined MIN_LAYOUT_GAP value for all of the layout options. Please determine why this is, and address it.
7. Change the relationship lines to use "crow's foot" notation.
8. The crows-foot notation is not being displayed on the relationship lines. Please investigate and fix.
9. This is not working. Please revert all changed made to implement crows-foot notation.

## Some General Design Changes and Updates

1. Field data types should be converted to lowercase everywhere.
2. Add a line under the table name to separate the name from the fields. Use a darker background for the table name.
3. Relationship lines should connect to the side of the table closest to the connected table. This should be dynamically adjusted when a table dragged/repositioned.
4. Relationship lines should show a directional arrowhead indicator where the line connects to the foreign key table. The indicator must be displayed on the outside of the table border.
5. The PNG export does not work. The tables and and lines appear as black blobs. The PNG export should be styled as if in light mode.
6. Implement a dark/light mode theme switch.

## New/Updated Relationship Capabilities

Display the popup Relationship editor dialog when a relationship line is double clicked. This should be the same dialog displayed when the user is first creating a relationship.

Display an information tooltip when the user hovers over a relationship line. The tooltip should show the relationship name (if the user had entered one), the cardinality, and the source and target fields.

## Table Editor Changes

Fields

- Display as a table with headers - Name, Type, Nullable, Primary Key - and a final column for the Remove button.
- Allow the user to drag fields up or down in the table to reposition the order of the fields.
- Change the "Remove" button to have a delete icon instead of text.
- Change the "Add field" button to be a cleaner "+" button at the bottom of the table.
- Add a new section after the Fields table called Relationships.
  - The Relationships section should display any existing relationships.
  - Create an Add button that adds a new relationship.
  - Allow the user to specify whether the current table is the source or target of the relationship.
  - Each relationship shows a target table at the top and a table with Source Field and Target Field columns.
  - Allow the user to select from a dropdown of existing tables for the target table.
  - Allow the user to select a field (dropdown list) from the source current table and the associated field (dropdown) from the target table.
  - Display an Add Field button to allow the user to add more related fields.

### BigQuery Export

General Rules

- Do no surround field names with back-ticks unless the name has spaces
