# Schema Studio Updates

## 0.2.0

## Features

### Workspace

A Workspace is a container for a table catalog and diagrams that use the tables in the catalog.

A workspace is stored in a folder, which contains the workspace configuration file, table catalog file, and diagram files. The folder is chosen by the user when they create a new workspace.

The workspace configuration file is a JSON file that contains the name of the workspace and a description of the workspace. The workspace configuration file is stored in the workspace folder as workspace.config.json.

#### Workspace View

The workspace view is the main view of the application. It consists of a left sidebar for the table catalog and a main content area for the diagrams, the status footer, and the menu bar.
The left sidebar will be a collapsible and resizeable.
It will contain the following sections as collapsible accordions:

- Table Catalog
- Diagrams
- Recent Activity
- Workspace Settings
- Content area: This is where diagrams would be displayed in a tabbed interface, allowing multiple diagrams to be open. Each tab will show its own diagram canvas. Users can close a diagram tab either from the File menu (defined below) or the Close icon on a tab.
- The status footer is a small area at the bottom of the application that displays the status of the application, such as the current workspace and the current diagram, and logs of recent activity.

### Table Catalog

A Table Catalog is a list of tables that the user can add to different diagrams.

A workspace has a catalog of tables that are available to all diagrams in the workspace. The catalog is stored in a file called table_catalog.json.

Tables are added to the catalog by using the Import SQL operation.
When a table is added to a diagram with the Add Table context menu option, it is also added to the catalog and will be available to all other diagrams in the workspace.
Tables in the catalog can be added to a diagram by being dragged from the catalog view onto the diagram.
Tables in the catalog can be edited by double-clicking on the table in the catalog view or using the table editor in a diagram.
Tables in the catalog can be deleted by using the Delete icon on the table in the catalog view.
The catalog stores the full definition of tables in a JSON format that is compatible with the diagram schema.

### Diagrams

Diagrams work exactly as they do currently, with the exception that they are stored in the workspace folder. Diagrams can be opened independently of the workspace or as part of the workspace.

When a diagram is opened as part of the workspace, the tables in the diagram are linked to the tables in the workspace catalog. Any changes made to the tables in the diagram are synced back to the workspace catalog and to all other diagrams in the workspace that use the table. This enables diagrams to be independent and sharable outside the workspace.

## Application Landing Page

The app currently opens onto a diagram canvas onto which we can load a saved diagram or by importing SQL DDL. With the changes we want to make to the application structure, this is no longer appropriate.

The app should start on a landing page similar to the funtionality of the Visual Studio Code Welcome screen.

- Application title at the top
- A "Start" section with the following options
  - New Workspace
  - Open Workspace
  - New Diagram
  - Open Diagram
- A "Recent" section showing the last 6 things the user worked on.
  - Each entry should indicate whether it was a workspace, diagram, or table catalog.

Reference image of the Visual Studio Code Welcome screen:
![image-20260129102022263](C:\Code\erd\docs\assets\image-20260129102022263.png)

## Application User Interface Changes

### Menu Bar

Add a menu bar to the application. The menu bar will contain the following items:

- File: New Workspace, Open Workspace, New Diagram, Open Diagram, Save, Close Diagram, Close Workspace, Close All Diagrams, Exit
- Edit: Workspace Settings, Undo, Redo, New Table, Toggle Light/Dark Theme
- Tools: Import Tables, Export (section) - SQL DDL, PNG, SVG, Mermaid, PlantUML

### Toolbar

Add a toolbar to the application. The toolbar will contain the following items:

- Add Table
- Save (icon)
- Undo (icon)
- Redo (icon)
- Layout (section) - Grid, Hierarchical, Force-directed
- Theme (icon) - Toggle Light/Dark Theme

Understand the current structure of the application and the above requested changes, and come up with a phased plan for implementing it as cleanly as possible with no regressions in the current core feature - the diagram editor. The current diagram editing capability, table editor, relationship editor, note editor, etc, should work as they currently do. Ask any clarifying questions you have about the work.
