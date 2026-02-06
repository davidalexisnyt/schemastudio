package dbconn

import (
	"encoding/json"
	"testing"
)

func TestNewInspector_ValidDrivers(t *testing.T) {
	for _, driver := range []string{"postgres", "mysql", "mssql", "bigquery"} {
		insp, err := NewInspector(driver)
		if err != nil {
			t.Errorf("NewInspector(%q) returned error: %v", driver, err)
		}
		if insp == nil {
			t.Errorf("NewInspector(%q) returned nil", driver)
		}
	}
}

func TestNewInspector_InvalidDriver(t *testing.T) {
	_, err := NewInspector("oracle")
	if err == nil {
		t.Error("expected error for unsupported driver")
	}
}

func TestConnectionConfig_JSON(t *testing.T) {
	cfg := ConnectionConfig{
		Driver:           "postgres",
		Host:             "localhost",
		Port:             5432,
		Database:         "testdb",
		Username:         "user",
		Password:         "pass",
		SSLMode:          "require",
		BigQueryAuthMode: "",
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded ConnectionConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Driver != "postgres" {
		t.Errorf("expected driver postgres, got %s", decoded.Driver)
	}
	if decoded.Host != "localhost" {
		t.Errorf("expected host localhost, got %s", decoded.Host)
	}
	if decoded.Port != 5432 {
		t.Errorf("expected port 5432, got %d", decoded.Port)
	}
	if decoded.Database != "testdb" {
		t.Errorf("expected database testdb, got %s", decoded.Database)
	}
	if decoded.SSLMode != "require" {
		t.Errorf("expected sslMode require, got %s", decoded.SSLMode)
	}
}

func TestConnectionConfig_BigQuery_JSON(t *testing.T) {
	cfg := ConnectionConfig{
		Driver:           "bigquery",
		Project:          "my-project",
		Dataset:          "my_dataset",
		CredentialsFile:  "/path/to/creds.json",
		BigQueryAuthMode: "service_account",
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded ConnectionConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Driver != "bigquery" {
		t.Errorf("expected driver bigquery, got %s", decoded.Driver)
	}
	if decoded.Project != "my-project" {
		t.Errorf("expected project my-project, got %s", decoded.Project)
	}
	if decoded.BigQueryAuthMode != "service_account" {
		t.Errorf("expected bigqueryAuthMode service_account, got %s", decoded.BigQueryAuthMode)
	}
}
