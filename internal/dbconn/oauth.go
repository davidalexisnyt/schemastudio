package dbconn

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// BigQuery OAuth2 scopes.
var bigqueryScopes = []string{
	"https://www.googleapis.com/auth/bigquery.readonly",
}

// OAuthClientConfig holds the OAuth2 client ID and secret.
type OAuthClientConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// tokenCacheDir returns the directory for caching OAuth tokens and config.
func tokenCacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".schemastudio")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// oauthClientConfigPath returns the path to the saved OAuth client configuration.
func oauthClientConfigPath() (string, error) {
	dir, err := tokenCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "oauth-client.json"), nil
}

// SaveOAuthClientConfig saves the OAuth client ID/secret to disk.
func SaveOAuthClientConfig(cfg OAuthClientConfig) error {
	path, err := oauthClientConfigPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// LoadOAuthClientConfig loads the saved OAuth client configuration.
func LoadOAuthClientConfig() (*OAuthClientConfig, error) {
	path, err := oauthClientConfigPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg OAuthClientConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
