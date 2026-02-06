package dbconn

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/oauth2"
)

func TestTokenCacheSaveLoad(t *testing.T) {
	// Use a temporary directory for the test
	tmpDir := t.TempDir()

	// Override the cache dir for testing
	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpDir)
	os.Setenv("USERPROFILE", tmpDir)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	token := &oauth2.Token{
		AccessToken:  "test-access-token",
		RefreshToken: "test-refresh-token",
		TokenType:    "Bearer",
	}

	project := "test-project"
	if err := SaveToken(project, token); err != nil {
		t.Fatalf("SaveToken: %v", err)
	}

	loaded, err := LoadToken(project)
	if err != nil {
		t.Fatalf("LoadToken: %v", err)
	}

	if loaded.AccessToken != token.AccessToken {
		t.Errorf("AccessToken: got %q, want %q", loaded.AccessToken, token.AccessToken)
	}
	if loaded.RefreshToken != token.RefreshToken {
		t.Errorf("RefreshToken: got %q, want %q", loaded.RefreshToken, token.RefreshToken)
	}
	if loaded.TokenType != token.TokenType {
		t.Errorf("TokenType: got %q, want %q", loaded.TokenType, token.TokenType)
	}
}

func TestTokenCacheLoadNonExistent(t *testing.T) {
	tmpDir := t.TempDir()

	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpDir)
	os.Setenv("USERPROFILE", tmpDir)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	_, err := LoadToken("nonexistent-project")
	if err == nil {
		t.Error("expected error loading non-existent token")
	}
}

func TestOAuthClientConfigSaveLoad(t *testing.T) {
	tmpDir := t.TempDir()

	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpDir)
	os.Setenv("USERPROFILE", tmpDir)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	cfg := OAuthClientConfig{
		ClientID:     "test-client-id",
		ClientSecret: "test-client-secret",
	}

	if err := SaveOAuthClientConfig(cfg); err != nil {
		t.Fatalf("SaveOAuthClientConfig: %v", err)
	}

	loaded, err := LoadOAuthClientConfig()
	if err != nil {
		t.Fatalf("LoadOAuthClientConfig: %v", err)
	}

	if loaded.ClientID != cfg.ClientID {
		t.Errorf("ClientID: got %q, want %q", loaded.ClientID, cfg.ClientID)
	}
	if loaded.ClientSecret != cfg.ClientSecret {
		t.Errorf("ClientSecret: got %q, want %q", loaded.ClientSecret, cfg.ClientSecret)
	}
}

func TestTokenCacheDir(t *testing.T) {
	tmpDir := t.TempDir()

	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpDir)
	os.Setenv("USERPROFILE", tmpDir)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	dir, err := tokenCacheDir()
	if err != nil {
		t.Fatalf("tokenCacheDir: %v", err)
	}

	expected := filepath.Join(tmpDir, ".schemastudio")
	if dir != expected {
		t.Errorf("tokenCacheDir: got %q, want %q", dir, expected)
	}

	// Verify directory was created
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat cache dir: %v", err)
	}
	if !info.IsDir() {
		t.Error("cache dir is not a directory")
	}
}

func TestDefaultOAuthConfig(t *testing.T) {
	cfg := DefaultOAuthConfig("test-id", "test-secret")
	if cfg.ClientID != "test-id" {
		t.Errorf("ClientID: got %q, want %q", cfg.ClientID, "test-id")
	}
	if cfg.ClientSecret != "test-secret" {
		t.Errorf("ClientSecret: got %q, want %q", cfg.ClientSecret, "test-secret")
	}
	if len(cfg.Scopes) == 0 {
		t.Error("expected non-empty scopes")
	}
}
