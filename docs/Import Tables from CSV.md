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
