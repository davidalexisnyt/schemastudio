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
