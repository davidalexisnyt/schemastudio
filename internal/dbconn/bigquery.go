package dbconn

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"cloud.google.com/go/bigquery"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"

	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

// BigQueryInspector implements SchemaInspector for Google BigQuery.
type BigQueryInspector struct {
	client  *bigquery.Client
	project string
}

func (b *BigQueryInspector) Connect(cfg ConnectionConfig) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var opts []option.ClientOption

	switch cfg.BigQueryAuthMode {
	case "service_account":
		if cfg.CredentialsFile == "" {
			return fmt.Errorf("bigquery service account: credentials file is required")
		}
		opts = append(opts, option.WithCredentialsFile(cfg.CredentialsFile))

	case "user_credentials":
		// User provides their own OAuth Client ID, Client Secret, and Refresh Token.
		// This creates a token source that uses the refresh token to obtain access tokens.
		if cfg.OAuthClientID == "" || cfg.OAuthClientSecret == "" || cfg.OAuthRefreshToken == "" {
			return fmt.Errorf("bigquery user credentials: client ID, client secret, and refresh token are all required")
		}
		oauthCfg := &oauth2.Config{
			ClientID:     cfg.OAuthClientID,
			ClientSecret: cfg.OAuthClientSecret,
			Endpoint:     google.Endpoint,
			Scopes:       bigqueryScopes,
		}
		token := &oauth2.Token{
			RefreshToken: cfg.OAuthRefreshToken,
		}
		ts := oauthCfg.TokenSource(ctx, token)
		opts = append(opts, option.WithTokenSource(ts))

	case "adc":
		// Application Default Credentials -- the BigQuery client library picks
		// these up automatically (e.g. from `gcloud auth application-default login`).
		// No extra options needed.

	default:
		// Backwards compat: treat "user_oauth" the same as "user_credentials" if
		// refresh token is provided, otherwise fall back to ADC.
		if cfg.OAuthRefreshToken != "" && cfg.OAuthClientID != "" && cfg.OAuthClientSecret != "" {
			oauthCfg := &oauth2.Config{
				ClientID:     cfg.OAuthClientID,
				ClientSecret: cfg.OAuthClientSecret,
				Endpoint:     google.Endpoint,
				Scopes:       bigqueryScopes,
			}
			token := &oauth2.Token{
				RefreshToken: cfg.OAuthRefreshToken,
			}
			ts := oauthCfg.TokenSource(ctx, token)
			opts = append(opts, option.WithTokenSource(ts))
		} else if cfg.CredentialsFile != "" {
			opts = append(opts, option.WithCredentialsFile(cfg.CredentialsFile))
		}
		// else: ADC
	}

	project := cfg.Project
	if project == "" {
		return fmt.Errorf("bigquery: project is required")
	}

	client, err := bigquery.NewClient(ctx, project, opts...)
	if err != nil {
		return fmt.Errorf("bigquery connect: %w", err)
	}
	b.client = client
	b.project = project
	return nil
}

func (b *BigQueryInspector) Close() error {
	if b.client != nil {
		return b.client.Close()
	}
	return nil
}

// ListSchemas returns the list of dataset IDs in the project.
func (b *BigQueryInspector) ListSchemas() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var datasets []string
	it := b.client.Datasets(ctx)
	for {
		ds, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("listing bigquery datasets: %w", err)
		}
		datasets = append(datasets, ds.DatasetID)
	}
	sort.Strings(datasets)
	return datasets, nil
}

// ListTables returns the list of table IDs in the given dataset.
func (b *BigQueryInspector) ListTables(schemaName string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var tables []string
	it := b.client.Dataset(schemaName).Tables(ctx)
	for {
		tbl, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("listing bigquery tables: %w", err)
		}
		tables = append(tables, tbl.TableID)
	}
	sort.Strings(tables)
	return tables, nil
}

// InspectSchema introspects BigQuery tables and returns a TableCatalog.
// BigQuery has no foreign key constraints, so relationships will be empty.
func (b *BigQueryInspector) InspectSchema(schemaName string, tableNames []string) (schema.TableCatalog, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout*2) // BQ can be slower
	defer cancel()

	// If no specific tables requested, list them all
	if len(tableNames) == 0 {
		var err error
		tableNames, err = b.ListTables(schemaName)
		if err != nil {
			return schema.TableCatalog{}, err
		}
	}

	gen := newIDGen()
	var tables []schema.Table
	tableSet := make(map[string]bool, len(tableNames))
	for _, t := range tableNames {
		tableSet[t] = true
	}

	sort.Strings(tableNames)
	cols := 3
	for i, tableName := range tableNames {
		if !tableSet[tableName] {
			continue
		}
		tbl := b.client.Dataset(schemaName).Table(tableName)
		md, err := tbl.Metadata(ctx)
		if err != nil {
			return schema.TableCatalog{}, fmt.Errorf("inspecting bigquery table %s: %w", tableName, err)
		}

		tID := gen.table()
		var fields []schema.Field
		for _, fs := range md.Schema {
			fID := gen.field()
			rawType := string(fs.Type)
			genericType, normLen, normPrec, normScale := sqlx.NormalizeType(rawType)

			f := schema.Field{
				ID:        fID,
				Name:      fs.Name,
				Type:      genericType,
				Nullable:  !fs.Required,
				Length:    normLen,
				Precision: normPrec,
				Scale:     normScale,
			}

			// Store the original BigQuery type as a dialect-specific override
			rawLower := strings.ToLower(strings.TrimSpace(rawType))
			if rawLower != genericType {
				f.TypeOverrides = map[string]schema.FieldTypeOverride{
					"bigquery": {Type: rawLower},
				}
			}

			fields = append(fields, f)
		}

		row, col := i/cols, i%cols
		tables = append(tables, schema.Table{
			ID:     tID,
			Name:   tableName,
			X:      float64(col * 320),
			Y:      float64(row * 240),
			Fields: fields,
		})
	}

	return schema.TableCatalog{
		ImportSource:  fmt.Sprintf("%s.%s (BigQuery)", b.project, schemaName),
		Tables:        tables,
		Relationships: nil,
	}, nil
}
