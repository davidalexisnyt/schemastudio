# Rafactor Table Imports

The current SQL table import populates and returns a Diagram struct. This was a valid approach in the initial version of the code, where we were only working with a single diagram at a time. Now, we have the concept of a Workspace that contains a catalog of tables that can be used on multiple diagrams within the workspace. Although we can still open diagram files outside of a Workspace, the tables they can only work with the tables that are currently in them. To have access to a catalog of tables, diagrams must be created in the context of a Workspace.

Let's do a slight refactor of how the Import feature works. Instead of populating and returning a Diagram struct, it should now populate and return a TableCatalog struct:

```go
type TableCatalog struct {
	ImportSource   string   `json:"importSource"` // The file name that the catalog was imported from.
	Tables        []Table        `json:"tables"`
	Relationships []Relationship `json:"relationships"`
}
```

The TableCatalog struct is very similar to the Diagram struct.

When the Import Tables feature is used in the context of a Workspace, the returned TableCatalog struct is used to populate the Workspaces table catalog, and should not import tables to the active diagram as it currently does.

When the Import Tables feature is used in the context of an independently opened diagram, the returned TableCatalog is copied into a new Diagram instance and the tables are imported into the current diagram.

# Import Tables from CSV

The Tools -> Import Tables menu operation currently reads a .sql file containing table DDL statements in PostgreSQL syntax. Let's now create a new operation to import tables from a CSV file.

The CSV file format we will require must contain the following fields:

- schema: The name of the schema containing the table. For Postgres, this would represent the schema name. For BigQuery, this will represent the account and dataset in the format "<account>.<dataset>".
- table: The name of a table. The CSV file will contain a separate row per table column, so the `table` field value will be repeated for each column in a given table. e.g. If a table has 3 columns, there will be 3 rows in the CSV file with the same value for `table`.
- column: The name of a column.
- type: The data type of the column.
- is_nullable: A boolean value indicating whether the column is defined as nullable.
- field_order: The sequential order in which the column is defined in the table. The CSV file may have skipped `field_order` values since some fields in the source may not be useful and were filtered out. The `field_order` can be ignores other than to ensure that the fields are correctly sorted when our internal Table representation is created.

Import process:

- Read all of the CSV rows for the same table name
- Create and fill in Table struct instances with the table and column data
- Populate and return a TableCatalog struct, which should then be used for the rest of the import process - populating the Workspace table catalog or a standalone diagram.

See the @files/schemas.csv for a sample of the CSV input.

## Menus

Let's update the "Import Tables" menu on the Tools menu as follows:

- Import Tables
  - ..From SQL DDL
  - ..From CSV
