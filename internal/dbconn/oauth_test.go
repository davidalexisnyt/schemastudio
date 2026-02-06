package dbconn

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestLoadOAuthClientConfig_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()

	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpDir)
	os.Setenv("USERPROFILE", tmpDir)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	_, err := LoadOAuthClientConfig()
	if err == nil {
		t.Error("expected error loading non-existent config")
	}
}
